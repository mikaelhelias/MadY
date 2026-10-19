// @vitest-environment jsdom
/**
 * UpSet bar-edge drag keeps the bar where the pointer is. Guards against the resize jumping: the
 * drag divides by one intersection's slot, not the whole plot width, which would make grabbing a
 * bar's edge without moving shrink the bars (the histogram drag has the same pitfall).
 * The check: press an edge, move onto the same spot — the width written must be the width already drawn.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import { galleryItems, galleryLookup } from "./gallery";

// jsdom has no screen matrix: a 1:1 one, so client pixels are figure pixels.
const proto = SVGElement.prototype as unknown as { getScreenCTM?: (() => unknown) | undefined };
const had = proto.getScreenCTM;
beforeAll(() => {
  const identity = { inverse: () => identity, a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  proto.getScreenCTM = () => identity;
  const g = globalThis as unknown as { DOMPoint?: unknown };
  if (!g.DOMPoint) g.DOMPoint = class { constructor(public x = 0, public y = 0) {} matrixTransform() { return this; } };
});
afterAll(() => { proto.getScreenCTM = had; cleanup(); });

const card = (title: string) => {
  const g = galleryItems().find((x) => x.title === title);
  if (!g) throw new Error(`no gallery card "${title}"`);
  return { table: g.table as DataTable, plot: g.plot as Plot, lk: galleryLookup(g) };
};

describe.each(["UpSet plot", "Simple column bar (one factor)"])("%s", (title) => {
  it("pressing a bar's edge and not moving writes the width already drawn", () => {
    const c = card(title);
    const scene = buildPlotScene(c.table, c.plot, { width: 640, height: 460, tables: c.lk });
    const onWidthResize = vi.fn();
    const { container } = render(<PlotFigure scene={scene} selected={null} onSelect={vi.fn()} onWidthResize={onWidthResize} />);
    const s = scene.series.find((x) => x.marks.some((m) => m.bar))!;
    const bar = s.marks.find((m) => m.bar)!.bar!;
    const slot = scene.plot.width / s.marks.length;
    const drawnFill = bar.w / slot;
    const edge = [...container.querySelectorAll('rect[style*="ew-resize"]')].find((r) => Math.abs(Number(r.getAttribute("x")) + 3.5 - (bar.x + bar.w)) < 0.01);
    expect(edge, "no edge handle on the first bar").toBeDefined();
    const svg = container.querySelector("svg.gfx-figure")!;
    fireEvent.pointerDown(edge!, { clientX: bar.x + bar.w, clientY: bar.y + 5, pointerId: 1, button: 0 });
    fireEvent.pointerMove(svg, { clientX: bar.x + bar.w, clientY: bar.y + 5, pointerId: 1 });
    fireEvent.pointerUp(svg, { clientX: bar.x + bar.w, clientY: bar.y + 5, pointerId: 1 });
    expect(onWidthResize).toHaveBeenCalled();
    const written = onWidthResize.mock.calls.at(-1)![1] as number;
    expect(written, `drawn fill ${drawnFill.toFixed(3)}, written ${written.toFixed(3)}`).toBeCloseTo(drawnFill, 2);
    cleanup();
  });
});
