import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene";
import { legendBoxWidth } from "./legendBox";

/**
 * The pie fills its figure.
 *
 * Guards against a flat radius rule — side/2 − 8 − side·(rim + largest explode)·½ on every side —
 * which leaves blank bands below and to the left of the pie: a slice only moves out along its own
 * direction by explode·r, and centring the disc (not what is drawn) wastes the rest. The builder
 * grows the drawing inside the box it is given.
 *
 * The oracle does not read the builder's angles: each wedge is rebuilt from its `fraction` (clockwise
 * from 12 o'clock, the default start) at the scene's r, shifted by its own (ox, oy), sampled along the
 * rim; labels are centred with their baseline 0.34·size below the anchor (PlotFigure).
 */
const measure = (text: string, px: number): number => text.length * px * 0.58;
const table: DataTable = {
  id: "t", kind: "partsofwhole", name: "T",
  columns: [{ id: "slice", name: "Compartment" }, { id: "v", name: "Protein (%)", role: "y" }],
  rows: [["Mitochondria", 42], ["Cytosol", 28], ["Nucleus", 18], ["Membrane", 12]].map(([n, v], i) => ({ id: `r${i}`, cells: { slice: n as string, v: v as number } })),
};
const plotOf = (patch: Partial<Plot> = {}): Plot => ({
  id: "p", name: "Pie", title: "Pie", source: "t", status: "ok", styleOverrides: {}, kind: "pie",
  seriesStyles: { v: { sliceExplode: 0.12 } }, legend: { symbolScale: 1.7 }, fonts: { legend: { size: 15 } }, ...patch,
}) as Plot;

function extent(s: ReturnType<typeof buildPlotScene>) {
  const p = s.pie!;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const pt = (x: number, y: number) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  let a = 0;
  for (const sl of p.slices) {
    const a0 = a, a1 = a + sl.fraction * 2 * Math.PI;
    a = a1;
    const cx = p.cx + sl.ox, cy = p.cy + sl.oy;
    pt(cx, cy);
    for (let k = 0; k <= 64; k++) { const t = a0 + ((a1 - a0) * k) / 64; pt(cx + Math.sin(t) * p.r, cy - Math.cos(t) * p.r); }
    if (sl.labelText) {
      const size = (sl.labelFont ?? s.fonts.sliceLabel).size, hw = measure(sl.labelText, size) / 2, base = sl.labelY + size * 0.34;
      pt(sl.labelX - hw, base - size * 0.8); pt(sl.labelX + hw, base + size * 0.25);
    }
  }
  const L = s.legendLayout;
  if (s.legend.length && L.position === "right") {
    const fs = s.fonts.legend.size;
    const bx = s.plot.x + s.plot.width + (L.gap ?? 12) + (L.outsidePad ?? 0);
    pt(bx, s.plot.y + 8);
    pt(bx + legendBoxWidth(L, s.legend.map((e) => e.label), fs), s.plot.y + 8 + s.legend.length * (fs + 6) + 2 * (L.padding ?? 6));
  }
  return { x0, y0, x1, y1 };
}

describe("pie: the slices (as exploded), their labels and the legend fill the figure", () => {
  for (const [w, h] of [[665, 644], [580, 380], [900, 500], [420, 620]] as const) {
    for (const labels of ["inside", "outside"] as const) {
      it(`${w}×${h}, labels ${labels}`, () => {
        const s = buildPlotScene(table, plotOf({ pieLabelPosition: labels, pieLabels: "label-percent" }), { width: w, height: h, measure });
        const e = extent(s);
        const top = 8 + s.fonts.title.size * 1.1; // the one-line heading's bottom
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
