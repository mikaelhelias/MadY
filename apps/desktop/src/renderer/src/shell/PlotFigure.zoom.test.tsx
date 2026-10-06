// @vitest-environment jsdom
/**
 * The wheel must zoom exactly the axes the scene says are zoomable — and report each one
 * through the key the builder reads.
 *
 * Guards against the renderer deciding zoomability itself (e.g. from a hard-coded list of
 * kinds) while more builders honour a value-domain override. `zoomable.test.ts` proves the
 * declaration matches the builders; this file proves the renderer obeys the declaration.
 * Neither alone is enough — a correct declaration nothing reads changes no pixels, and a
 * renderer that reads it faithfully is only as good as what it was told.
 *
 * Caution: `clientToUser` goes through `getScreenCTM`, which jsdom does not implement — without
 * the stub below every handler bows out at the null check and the whole file passes while
 * testing nothing. The stub is an identity transform, so client coordinates are scene
 * coordinates; that is the only reason the event below can be aimed at the middle of the plot
 * rect.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import { FIX, buildFor } from "./plot-fixtures";

afterEach(cleanup);

beforeAll(() => {
  const identity = {
    inverse() {
      return this;
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (SVGElement.prototype as any).getScreenCTM = function getScreenCTM() {
    return identity;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).DOMPoint = class {
    constructor(public x: number, public y: number) {}
    matrixTransform(): { x: number; y: number } {
      return { x: this.x, y: this.y };
    }
  };
});

/** Confirm the stub is live before trusting a single "not called" below. */
describe("the CTM stub itself", () => {
  it("makes a screen point readable as a scene point", () => {
    const el = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    expect(typeof el.getScreenCTM).toBe("function");
    expect(el.getScreenCTM()).not.toBeNull();
  });
});

/**
 * Note: every render in the sweep passes `wheelZoom` (the ribbon's "Wheel zoom" tickbox, on).
 * The sweep proves the mechanism reaches each kind; the tickbox is off by default (the wheel
 * must scroll the page unless asked to zoom), and that default has its own guard below.
 * Turning the gate on in the harness keeps the sweep exactly as sharp — a kind whose wheel is
 * broken still fails — without depending on the default.
 */
describe("wheel zoom is off by default — the wheel scrolls the page", () => {
  const xy = FIX.find((f) => f.kind === "xy")!;
  const fire = (svg: SVGSVGElement, scene: ReturnType<typeof buildFor>): WheelEvent => {
    const ev = new WheelEvent("wheel", { deltaY: -100, clientX: scene.plot.x + scene.plot.width / 2, clientY: scene.plot.y + scene.plot.height / 2, bubbles: true, cancelable: true });
    svg.dispatchEvent(ev);
    return ev;
  };
  it("with no `wheelZoom` prop the wheel does not zoom and is not swallowed (page can scroll)", () => {
    const scene = buildFor(xy);
    const onViewChange = vi.fn();
    const { container } = render(<PlotFigure scene={scene} onViewChange={onViewChange} />);
    const ev = fire(container.querySelector("svg")!, scene);
    expect(onViewChange).not.toHaveBeenCalled(); // no zoom
    expect(ev.defaultPrevented).toBe(false); // …and the browser still gets to scroll
  });
  it("with `wheelZoom` the same wheel zooms and is swallowed (so the page does not also scroll)", () => {
    const scene = buildFor(xy);
    const onViewChange = vi.fn();
    const { container } = render(<PlotFigure scene={scene} wheelZoom onViewChange={onViewChange} />);
    const ev = fire(container.querySelector("svg")!, scene);
    expect(onViewChange).toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(true);
  });
  it("the gate covers the 3-D camera too", () => {
    const s3 = FIX.find((f) => f.kind === "scatter3d");
    if (!s3) return; // no 3-D fixture — nothing to claim
    const scene = buildFor(s3);
    const onCamera3D = vi.fn();
    const off = render(<PlotFigure scene={scene} onCamera3D={onCamera3D} />);
    fireEvent.wheel(off.container.querySelector("svg")!, { deltaY: -100 });
    expect(onCamera3D, "3-D wheel zoomed with the gate off").not.toHaveBeenCalled();
    cleanup();
    const on = render(<PlotFigure scene={scene} wheelZoom onCamera3D={onCamera3D} />);
    fireEvent.wheel(on.container.querySelector("svg")!, { deltaY: -100 });
    expect(onCamera3D, "3-D wheel did not zoom with the gate on").toHaveBeenCalled();
  });
});

describe("wheel zoom follows scene.zoomable", () => {
  for (const fx of FIX) {
    const scene = buildFor(fx);
    const declared = scene.zoomable ?? [];

    it(`${fx.kind}: ${declared.length ? `zooms ${declared.map((z) => z.visual).join("+")}` : "does not zoom"}`, () => {
      const onViewChange = vi.fn();
      const { container } = render(<PlotFigure scene={scene} wheelZoom onViewChange={onViewChange} />);
      const svg = container.querySelector("svg");
      expect(svg).not.toBeNull();
      // Aim at the middle of the plot rect: a wheel outside it still zooms, but the centre
      // keeps the arithmetic obvious if this ever has to be debugged.
      svg!.dispatchEvent(
        new WheelEvent("wheel", {
          deltaY: -100,
          clientX: scene.plot.x + scene.plot.width / 2,
          clientY: scene.plot.y + scene.plot.height / 2,
          bubbles: true,
          cancelable: true,
        }),
      );

      if (declared.length === 0) {
        expect(onViewChange).not.toHaveBeenCalled();
        return;
      }
      expect(onViewChange).toHaveBeenCalledTimes(1);
      const view = onViewChange.mock.calls[0]![0] as { xDomain?: unknown; yDomain?: unknown };
      // Exactly the declared keys come back — not the visual axes. On a flipped chart those
      // differ, and sending the visual one is the failure this whole field exists to stop.
      const keys = declared.map((z) => `${z.key}Domain`).sort();
      expect(Object.keys(view).filter((k) => view[k as "xDomain"] !== undefined).sort()).toEqual(keys);
      // Zooming in narrows: the new window must be shorter than the home extent.
      for (const z of declared) {
        const d = (z.key === "x" ? view.xDomain : view.yDomain) as [number, number];
        const home = z.visual === "x" ? scene.auto.x : scene.auto.y;
        expect(Math.abs(d[1] - d[0])).toBeLessThan(Math.abs(home[1] - home[0]));
      }
    });
  }

  /**
   * Every zoomable kind must offer the way back, not just the way in.
   *
   * XY graphs snap back to the original view (the "magnetic" reset); other kinds must too.
   * The kinds that draw their own SVG (`lollipop`, `paireddot`) are the ones at risk: with only
   * the wheel and no drag-to-pan, double-click reset or grab cursor, zooming in is a one-way
   * door.
   *
   * Caution: spreading `{...viewProps}` above the <svg>'s own `onPointerDown`/`onPointerMove`/
   * `onPointerUp` silently overrides them. The handlers are composed, as the file's own
   * `figResize` note warns.
   */
  for (const fx of FIX) {
    const scene = buildFor(fx);
    const declared = scene.zoomable ?? [];
    if (declared.length === 0) continue;
    it(`${fx.kind}: offers the ways back once zoomed`, () => {
      // A view zoomed into the middle half of whichever axis is zoomable.
      const over: Record<string, [number, number]> = {};
      for (const a of declared) {
        const d = a.visual === "x" ? scene.x.domain : scene.y.domain;
        const mid = (d[0] + d[1]) / 2;
        const q = (d[1] - d[0]) / 4;
        over[`${a.key}Domain`] = [mid - q, mid + q];
      }
      const plot: Plot = { id: "p", name: "P", source: fx.table.id, status: "ok", styleOverrides: {}, kind: fx.kind, ...(fx.extra ?? {}) };
      const zoomed = buildPlotScene(fx.table, plot, { width: 520, height: 360, ...over });
      let view: unknown = "untouched";
      let reset = false;
      const { container } = render(
        <PlotFigure scene={zoomed} wheelZoom onViewChange={(v) => { view = v; }} onResetView={() => { reset = true; }} />,
      );
      const svg = container.querySelector("svg")!;
      expect((svg as unknown as SVGSVGElement).style.cursor, "no grab cursor — the chart does not look draggable").toBe("grab");

      // 1. double-click puts it back
      fireEvent.doubleClick(svg);
      expect(reset, "double-click does not reset the view").toBe(true);

      // 2. a drag pans it
      const at = (fx2: number, fy: number) => ({
        clientX: zoomed.plot.x + fx2 * zoomed.plot.width,
        clientY: zoomed.plot.y + fy * zoomed.plot.height,
        button: 0, buttons: 1, pointerId: 1, isPrimary: true,
      });
      fireEvent.pointerDown(svg, at(0.5, 0.5));
      fireEvent.pointerMove(svg, at(0.72, 0.72));
      fireEvent.pointerUp(svg, at(0.72, 0.72));
      expect(view, "dragging does not pan the view").not.toBe("untouched");
    });
  }

  it("a categorical chart zooms its value axis and leaves the category band alone", () => {
    const bar = FIX.find((f) => f.kind === "bar")!;
    const scene = buildFor(bar);
    const onViewChange = vi.fn();
    const { container } = render(<PlotFigure scene={scene} wheelZoom onViewChange={onViewChange} />);
    container.querySelector("svg")!.dispatchEvent(
      new WheelEvent("wheel", { deltaY: -100, clientX: scene.plot.x + 10, clientY: scene.plot.y + 10, bubbles: true, cancelable: true }),
    );
    const view = onViewChange.mock.calls[0]![0] as { xDomain?: unknown; yDomain?: unknown };
    expect(view.yDomain).toBeDefined();
    // The X band is never pinned to a window: an undefined domain means "auto extent", and
    // half a category is not a view anyone asked for.
    expect(view.xDomain).toBeUndefined();
  });

  it("a flipped bar reports its X drag through yDomain", () => {
    const bar = FIX.find((f) => f.kind === "bar")!;
    const scene = buildFor(bar, { barOrientation: "horizontal" });
    expect(scene.zoomable).toEqual([{ visual: "x", key: "y" }]);
    const onViewChange = vi.fn();
    const { container } = render(<PlotFigure scene={scene} wheelZoom onViewChange={onViewChange} />);
    container.querySelector("svg")!.dispatchEvent(
      new WheelEvent("wheel", { deltaY: -100, clientX: scene.plot.x + scene.plot.width / 2, clientY: scene.plot.y + 10, bubbles: true, cancelable: true }),
    );
    const view = onViewChange.mock.calls[0]![0] as { xDomain?: unknown; yDomain?: unknown };
    expect(view.yDomain).toBeDefined();
    expect(view.xDomain).toBeUndefined();
  });
});
