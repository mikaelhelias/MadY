import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene";
import { legendBoxWidth } from "./legendBox";

/**
 * The ternary triangle fills its figure.
 *
 * The drawing grows to fill the box it is given. Guards against reserving flat, equal strips left,
 * right and below for tick numbers and edge names that are larger than those need, with the triangle
 * fitted inside them (on the gallery card, 660×600, that would leave tens of pixels blank on each side).
 *
 * Measured against the canvas below the heading, not the scene's plot rect (a plot rect that already
 * excludes the strips would pass trivially). Text boxes use the width function the builder
 * is given; tick numbers sit on their baseline with their own anchor, edge names are centred on their
 * baseline and turned about their anchor (PlotFigure).
 */
const measure = (text: string, px: number): number => text.length * px * 0.58;
const table: DataTable = {
  id: "t", kind: "column", name: "T",
  columns: [{ id: "s", name: "Sample", role: "x" }, { id: "a", name: "Sand", role: "y" }, { id: "b", name: "Silt", role: "y" }, { id: "c", name: "Clay", role: "y" }, { id: "g", name: "Class", role: "y" }],
  rows: ([[90, 5, 5, "Sand"], [80, 12, 8, "Sand"], [65, 25, 10, "Loam"], [40, 40, 20, "Loam"], [20, 60, 20, "Silt"], [10, 30, 60, "Clay"]] as const).map((v, i) => ({ id: `r${i}`, cells: { s: `S${i}`, a: v[0], b: v[1], c: v[2], g: v[3] } })),
};
// As the gallery card: points coloured by the Class column, which adds a legend in its own strip on the right.
const plotOf = (patch: Partial<Plot> = {}): Plot => ({ id: "p", name: "Ternary plot", title: "Ternary plot", source: "t", status: "ok", styleOverrides: {}, kind: "ternary", seriesStyles: { a: { colorFromColumn: "g", colorFromMode: "category" } }, ...patch }) as Plot;

function extent(s: ReturnType<typeof buildPlotScene>) {
  const t = s.ternary!;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const pt = (x: number, y: number) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  for (const c of t.corners) pt(c.x, c.y);
  const tick = s.fonts.tick.size, title = s.fonts.xAxisTitle.size;
  for (const k of t.ticks) {
    pt(k.x2, k.y2);
    if (!k.label) continue;
    const w = measure(k.label, tick);
    const left = k.anchor === "start" ? k.lx : k.anchor === "end" ? k.lx - w : k.lx - w / 2;
    pt(left, k.ly - tick * 0.8); pt(left + w, k.ly + tick * 0.25);
  }
  for (const a of t.axisTitles) {
    const hw = measure(a.text, title) / 2, rad = (a.angle * Math.PI) / 180;
    for (const [lx, ly] of [[-hw, -title * 0.8], [hw, -title * 0.8], [-hw, title * 0.25], [hw, title * 0.25]] as const) {
      pt(a.x + lx * Math.cos(rad) - ly * Math.sin(rad), a.y + lx * Math.sin(rad) + ly * Math.cos(rad));
    }
  }
  for (const m of s.series.flatMap((x) => x.marks)) { const r = (m.symbolSize ?? 6) / 2 + 1; pt(m.cx - r, m.cy - r); pt(m.cx + r, m.cy + r); }
  // The legend, where PlotFigure draws an outside-right one: 12px (gap) past the plot rect, box width from
  // the shared formula, rows at least font + 6 tall.
  const L = s.legendLayout;
  if (s.legend.length && L.position === "right") {
    const fs = s.fonts.legend.size;
    const bx = s.plot.x + s.plot.width + (L.gap ?? 12) + (L.outsidePad ?? 0);
    pt(bx, s.plot.y + 8);
    pt(bx + legendBoxWidth(L, s.legend.map((e) => e.label), fs), s.plot.y + 8 + s.legend.length * (fs + 6) + 2 * (L.padding ?? 6));
  }
  return { x0, y0, x1, y1 };
}

describe("ternary: triangle, tick numbers and edge names fill the figure", () => {
  for (const [w, h] of [[660, 600], [580, 380], [900, 500], [420, 620]] as const) {
    for (const size of [13, 22]) {
      it(`${w}×${h}, fonts ${size}px: fills the limiting side of the canvas and stays on it`, () => {
        const s = buildPlotScene(table, plotOf({ fonts: { tick: { size }, xAxisTitle: { size } } } as Partial<Plot>), { width: w, height: h, measure });
        const e = extent(s);
        // The one-line heading's bottom: PlotFigure puts its baseline at 8 + 0.85·size, descenders ~0.25·size.
        const top = 8 + s.fonts.title.size * 1.1;
        const fillW = (e.x1 - e.x0) / w, fillH = (e.y1 - e.y0) / (h - top);
        expect(Math.max(fillW, fillH), `the drawing spans ${(fillW * 100).toFixed(0)}% of the width and ${(fillH * 100).toFixed(0)}% of the height below the heading`).toBeGreaterThanOrEqual(0.93);
        expect(e.x0, "drawn past the left edge").toBeGreaterThanOrEqual(0);
        expect(e.y0, "drawn onto the heading").toBeGreaterThanOrEqual(top + 2);
        expect(e.x1, "drawn past the right edge").toBeLessThanOrEqual(w);
        expect(e.y1, "drawn past the bottom edge").toBeLessThanOrEqual(h);
      });
    }
  }
});
