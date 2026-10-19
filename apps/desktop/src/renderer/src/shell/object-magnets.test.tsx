// @vitest-environment jsdom
/**
 * Magnets for lines and objects — rotation, and the axes.
 *
 * On every graph, an added line or object has a rotation assist: it snaps magnetically at the
 * key angles 0, 45, 90, 135, 180 and so on, and it also snaps when it comes near an axis, so
 * it can sit flush against it.
 *
 * Guards both halves. Free rotation (with Shift for 15° steps) would make an exact right angle
 * a matter of luck; and if only a text box snapped to the plot's edges, a leader line could
 * never be parked flush against an axis.
 *
 * Note: the endpoint drags go through `clientToUser` → `getScreenCTM`, which jsdom does not
 * implement: without the stub below every handler bows out at the null check and this whole file
 * passes while testing nothing.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure, snapRotation, snapToGuides } from "./PlotFigure";

afterEach(cleanup);

beforeAll(() => {
  const identity = { inverse() { return this; } };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (SVGElement.prototype as any).getScreenCTM = function getScreenCTM() { return identity; };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).DOMPoint = class {
    constructor(public x: number, public y: number) {}
    matrixTransform(): { x: number; y: number } { return { x: this.x, y: this.y }; }
  };
});

describe("the CTM stub is live", () => {
  it("or every drag below would silently do nothing", () => {
    const el = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    expect(el.getScreenCTM()).not.toBeNull();
  });
});

describe("rotation magnets", () => {
  it("holds at each key angle from either side", () => {
    for (const key of [0, 45, 90, 135, 180, 225, 270, 315]) {
      expect(snapRotation(key + 3), `${key}° magnet does not pull from above`).toBe(key % 360);
      expect(snapRotation(key - 3), `${key}° magnet does not pull from below`).toBe(key % 360);
    }
  });

  it("leaves a deliberate angle outside the snap threshold alone", () => {
    // 37° is 8° from 45 — outside the threshold, so it must survive untouched.
    expect(snapRotation(37)).toBe(37);
    expect(snapRotation(20)).toBe(20);
    expect(snapRotation(112)).toBe(112);
  });

  it("Shift releases the magnet for fine work", () => {
    expect(snapRotation(43, true)).toBe(43);
    expect(snapRotation(43, false)).toBe(45);
  });

  it("always reports a whole degree in [0, 360)", () => {
    for (const d of [-3, -90, 359.6, 720.4, 1000]) {
      const r = snapRotation(d);
      expect(Number.isInteger(r)).toBe(true);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThan(360);
    }
  });
});

// A rect whose bounding box has a known centre, so a pointer offset produces a known angle.
const rectPlot: Plot = {
  id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "xy",
  annotations: [{ id: "box", kind: "rect", x: 0.3, y: 0.3, x2: 0.7, y2: 0.7 }],
};

describe("the rotation assist is visible, not just felt", () => {
  // Rotate the grip to a target angle and return the badge group after the move.
  const rotateTo = (deg: number, shift = false): { text: string | null; snapped: string | null; committed: number | undefined } => {
    const scene = buildPlotScene(table, rectPlot, { width: 520, height: 360 });
    let committed: number | undefined;
    const { container } = render(
      <PlotFigure
        scene={scene}
        selected={{ kind: "annotation", id: "box" }}
        onMoveAnnotation={(_id, patch) => { if (patch.rotation != null) committed = patch.rotation; }}
      />,
    );
    const g = container.querySelector('[data-ann-shape="box"]')!;
    const grip = g.querySelector("circle.gfx-annhandle");
    expect(grip, "no rotate grip on the selected box — the fixture can't exhibit the drag").toBeTruthy();
    // The grip's start() captures the shape centre; read it back off the rendered box rect
    // (the one without the handle class), so the fixture doesn't depend on a scene field name.
    const shapeRect = g.querySelector("rect:not(.gfx-annhandle)")!;
    const rx = Number(shapeRect.getAttribute("x"));
    const ry = Number(shapeRect.getAttribute("y"));
    const cx = rx + Number(shapeRect.getAttribute("width")) / 2;
    const cy = ry + Number(shapeRect.getAttribute("height")) / 2;
    // Pointer direction that yields `deg` (start() adds +90 to atan2 so straight-up = 0°).
    const rad = ((deg - 90) * Math.PI) / 180;
    const to = { clientX: cx + 60 * Math.cos(rad), clientY: cy + 60 * Math.sin(rad) };
    fireEvent.pointerDown(grip!, { clientX: cx, clientY: cy - 22 });
    fireEvent.pointerMove(grip!, { ...to, shiftKey: shift });
    const badge = g.querySelector("[data-rot-badge]");
    return {
      text: badge?.querySelector("text")?.textContent ?? null,
      snapped: badge?.getAttribute("data-rot-snapped") ?? null,
      committed,
    };
  };

  it("shows the committed angle in a badge while rotating", () => {
    const r = rotateTo(30);
    expect(r.committed, "the rotate drag never reached the handler").toBe(30);
    expect(r.text, "no angle badge appeared during the drag").toBe("30°");
    expect(r.snapped, "30° is not a key angle — the magnet must read as OFF").toBe("false");
  });

  it("lights the badge when the magnet locks to a key angle", () => {
    const r = rotateTo(90);
    expect(r.committed).toBe(90);
    expect(r.text).toBe("90°");
    expect(r.snapped, "90° is a key angle — the magnet must read as ON").toBe("true");
  });

  it("with Shift the badge shows the free angle and reads unlocked at a key angle", () => {
    const r = rotateTo(90, true);
    expect(r.committed).toBe(90);
    expect(r.snapped, "Shift releases the magnet — the badge must not claim a lock").toBe("false");
  });
});

describe("axis magnets", () => {
  const plot = { x: 100, y: 50, width: 400, height: 300 };

  it("the guides are the axes — 0 and 1 on each side, plus the centre", () => {
    // 2px inside the left axis → flush against it.
    expect(snapToGuides(2 / plot.width, 0.5, plot).fx).toBe(0);
    expect(snapToGuides(1 - 2 / plot.width, 0.5, plot).fx).toBe(1);
    expect(snapToGuides(0.5, 2 / plot.height, plot).fy).toBe(0);
    expect(snapToGuides(0.5, 1 - 2 / plot.height, plot).fy).toBe(1);
  });

  it("and it lets go further out", () => {
    // 20px from the axis is a deliberate gap, not a near miss.
    expect(snapToGuides(20 / plot.width, 0.4, plot).fx).toBeCloseTo(20 / plot.width, 6);
  });
});

// --------------------------------------------------------------------------------------
const table: DataTable = {
  id: "t", kind: "xy", name: "T",
  columns: [{ id: "x", name: "X", role: "x" }, { id: "y", name: "Y", role: "y" }],
  rows: [{ id: "r1", cells: { x: 1, y: 2 } }, { id: "r2", cells: { x: 5, y: 9 } }],
};
/** A diagonal segment whose first endpoint sits a hair inside the left axis. */
const withSegment = (x: number, y: number): Plot => ({
  id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "xy",
  annotations: [{ id: "seg", kind: "segment", x, y, x2: 0.8, y2: 0.7 }],
});

describe("dragging a line endpoint parks it on the axis", () => {
  const drag = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const scene = buildPlotScene(table, withSegment(from.x, from.y), { width: 520, height: 360 });
    const patches: Record<string, number>[] = [];
    const { container } = render(
      <PlotFigure
        scene={scene}
        // Note: selected, or the endpoint grips are not drawn and the drag has nothing to grab —
        // a fixture that cannot exhibit the gesture cannot guard it.
        selected={{ kind: "annotation", id: "seg" }}
        onMoveAnnotation={(_id, patch) => patches.push(patch as Record<string, number>)}
      />,
    );
    const g = container.querySelector('[data-ann-shape="seg"]');
    expect(g, "the segment did not render — the fixture cannot exhibit the drag").toBeTruthy();
    const handles = g!.querySelectorAll(".gfx-annhandle");
    expect(handles.length, "no endpoint grips — nothing to drag").toBe(2);
    const p = scene.plot;
    const at = (fx: number, fy: number) => ({ clientX: p.x + fx * p.width, clientY: p.y + fy * p.height });
    fireEvent.pointerDown(handles[0]!, at(from.x, from.y));
    fireEvent.pointerMove(handles[0]!, at(to.x, to.y));
    fireEvent.pointerUp(handles[0]!, at(to.x, to.y));
    return patches;
  };

  it("a drag that lands near the left axis commits exactly 0", () => {
    // 0.35 → 0.004 of the width is ~2px on a 520-wide figure: inside the magnet.
    const patches = drag({ x: 0.35, y: 0.5 }, { x: 0.004, y: 0.5 });
    expect(patches.length, "no move was committed — the drag never reached the handler").toBeGreaterThan(0);
    const last = patches[patches.length - 1]!;
    expect(last.x, "the endpoint stopped short of the axis instead of parking on it").toBe(0);
  });

  it("a drag that lands well inside the plot keeps the exact position", () => {
    const patches = drag({ x: 0.35, y: 0.5 }, { x: 0.62, y: 0.5 });
    const last = patches[patches.length - 1]!;
    expect(last.x).toBeGreaterThan(0.55);
    expect(last.x).toBeLessThan(0.7);
  });
});
