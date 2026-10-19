// @vitest-environment jsdom
/**
 * The polar histogram's compass letters — each can be edited and dragged. Each of the
 * N / NE / E … (or 0° / 45° …) labels drags on its own (`RoseStyle.directionOffsets`) and
 * double-click renames it (`RoseStyle.directionText`), both keyed by the label's own default text — so "N" renamed to
 * "North" stays on North and does not jump to 0° when the compass convention is switched off. A click opens
 * their font (Title & legend ▸ Compass & ring label font). The ring numbers are a count scale and stay put.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import { galleryItems, galleryLookup } from "./gallery";
import { roseDirectionMove, roseDirectionRename } from "./roseLabels";

beforeAll(() => {
  // jsdom has no getScreenCTM: without it every drag is a no-op in the harness (see text-draggable.sweep).
  const proto = (globalThis as unknown as { SVGSVGElement?: { prototype: Record<string, unknown> } }).SVGSVGElement?.prototype;
  if (proto && typeof proto.getScreenCTM !== "function") {
    proto.getScreenCTM = function getScreenCTM() {
      return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0, inverse: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) };
    };
  }
  if (typeof (globalThis as { DOMPoint?: unknown }).DOMPoint !== "function") {
    class P { x: number; y: number; constructor(x = 0, y = 0) { this.x = x; this.y = y; } matrixTransform() { return this; } }
    (globalThis as { DOMPoint?: unknown }).DOMPoint = P;
  }
});
afterEach(cleanup);

const rose = (patch: NonNullable<Plot["rose"]> = {}) => {
  const g = galleryItems().find((x) => x.plot.kind === "rose");
  if (!g) throw new Error("no rose card");
  const plot = { ...g.plot, rose: { ...(g.plot.rose ?? {}), ...patch } } as Plot;
  return { table: g.table as DataTable, plot, scene: buildPlotScene(g.table, plot, { width: 640, height: 560, tables: galleryLookup(g) }) };
};
const labelEl = (c: HTMLElement, text: string) => [...c.querySelectorAll(".gfx-rose text")].find((t) => t.textContent === text);

describe("compass letters — the drawing", () => {
  it("untouched: each label carries only its text and position", () => {
    const s = rose().scene;
    expect(s.rose!.directionLabels.map((d) => d.text)).toEqual(["N", "NE", "E", "SE", "S", "SW", "W", "NW"]);
    expect(Object.keys(s.rose!.directionLabels[0]!).sort()).toEqual(["text", "x", "y"]);
  });

  it("a renamed letter draws its new words, keyed by its own default", () => {
    const d = rose({ directionText: { N: "North" } }).scene.rose!.directionLabels;
    expect(d[0]).toMatchObject({ text: "North", key: "N" });
    expect(d.slice(1).map((x) => x.text)).toEqual(["NE", "E", "SE", "S", "SW", "W", "NW"]);
    // Switched to degrees, "N" is not drawn, so the rename is not either.
    expect(rose({ directionText: { N: "North" }, compass: false }).scene.rose!.directionLabels.map((x) => x.text)).not.toContain("North");
  });

  it("a moved letter carries its offset; the others do not", () => {
    const d = rose({ directionOffsets: { E: { dx: 12, dy: -7 } } }).scene.rose!.directionLabels;
    expect(d[2]).toMatchObject({ text: "E", off: { dx: 12, dy: -7 } });
    expect(d.filter((x) => x.off)).toHaveLength(1);
  });

  it("the drawn letter sits at its anchor plus its offset", () => {
    const base = rose();
    const moved = rose({ directionOffsets: { E: { dx: 12, dy: -7 } } });
    const at = (s: typeof base.scene) => {
      const { container } = render(<PlotFigure scene={s} />);
      const g = labelEl(container, "E")!;
      // DraggableTitle draws the offset as a translate on the text itself.
      const box = { x: Number(g.getAttribute("x")), y: Number(g.getAttribute("y")), t: g.getAttribute("transform") ?? "" };
      cleanup();
      return box;
    };
    expect(JSON.stringify(at(moved.scene)), "the offset did not reach the drawing").not.toBe(JSON.stringify(at(base.scene)));
  });
});

describe("compass letters — drag, rename, click", () => {
  it("dragging NE reports NE and where it went", () => {
    const onMove = vi.fn();
    const { container } = render(<PlotFigure scene={rose().scene} onMoveRoseDirectionLabel={onMove} onSelect={vi.fn()} />);
    const el = labelEl(container, "NE")!;
    fireEvent.pointerDown(el, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 130, clientY: 120, pointerId: 1 });
    fireEvent.pointerUp(el, { clientX: 130, clientY: 120, pointerId: 1 });
    expect(onMove).toHaveBeenCalled();
    const [key, dx, dy] = onMove.mock.calls.at(-1)!;
    expect(key).toBe("NE");
    expect(Math.abs(dx) + Math.abs(dy)).toBeGreaterThan(0);
  });

  it("double-click opens an editor on the letter; Enter renames it by its key", () => {
    const onEditText = vi.fn();
    const { container } = render(<PlotFigure scene={rose({ directionText: { S: "South" } }).scene} onEditText={onEditText} onSelect={vi.fn()} />);
    fireEvent.doubleClick(labelEl(container, "South")!);
    const editor = container.querySelector<HTMLInputElement | HTMLTextAreaElement>("textarea, input");
    expect(editor, "no editor on double-click").toBeTruthy();
    fireEvent.change(editor!, { target: { value: "Sud" } });
    fireEvent.keyDown(editor!, { key: "Enter" });
    expect(onEditText).toHaveBeenCalledWith({ kind: "roseDirection", key: "S" }, "Sud");
  });

  it("a click opens the letters' font", () => {
    const onSelect = vi.fn();
    const { container } = render(<PlotFigure scene={rose().scene} onSelect={onSelect} />);
    // A draggable label selects on press + release without moving (it owns a drag, so it cannot wait for "click").
    const w = labelEl(container, "W")!;
    fireEvent.pointerDown(w, { clientX: 50, clientY: 50, pointerId: 1 });
    fireEvent.pointerUp(w, { clientX: 50, clientY: 50, pointerId: 1 });
    expect(onSelect).toHaveBeenCalledWith({ kind: "chart-section", title: "Title & legend" });
  });
});

describe("compass letters — what gets written", () => {
  it("rename: new words stored under the key; blank or the default words clear it", () => {
    expect(roseDirectionRename({ sectors: 8 }, "N", " North ")).toEqual({ rose: { sectors: 8, directionText: { N: "North" } } });
    expect(roseDirectionRename({ directionText: { N: "North", E: "East" } }, "N", "  ")).toEqual({ rose: { directionText: { E: "East" } } });
    expect(roseDirectionRename({ directionText: { N: "North" } }, "N", "N")).toEqual({ rose: { directionText: undefined } });
  });

  it("move: the offset stored under the key, the others kept", () => {
    expect(roseDirectionMove({ directionOffsets: { E: { dx: 1, dy: 2 } } }, "N", 5, -3)).toEqual({ rose: { directionOffsets: { E: { dx: 1, dy: 2 }, N: { dx: 5, dy: -3 } } } });
  });
});
