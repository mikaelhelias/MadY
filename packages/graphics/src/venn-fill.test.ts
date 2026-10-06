import { describe, expect, it } from "vitest";
import type { CellValue, DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene";

/**
 * The Venn fills its figure.
 *
 * Rule: grow the drawing inside the box it is given. A strip for the set names is reserved only where a
 * name sits — on the gallery card the two lower names sit inside their discs, so a bottom strip (~26px)
 * would never be used and would make the discs smaller than the figure allows.
 *
 * Measured against the canvas below the heading. Set names are centred on their baseline, zone counts
 * centred with their baseline 0.34·size below the spot (PlotFigure), both in the legend font.
 */
const measure = (text: string, px: number): number => text.length * px * 0.58;
const rows: [string, CellValue, CellValue, CellValue][] = [
  ["ATF3", 1, "", ""], ["FOS", 1, "", ""], ["JUN", 1, "", ""], ["EGR1", 1, "", ""], ["MYC", "", 1, ""], ["KLF4", "", 1, ""], ["SOX2", "", 1, ""],
  ["TP53", "", "", 1], ["CDKN1A", "", "", 1], ["HSPA5", 1, 1, ""], ["DDIT3", 1, 1, ""], ["GADD45A", 1, "", 1], ["XBP1", "", 1, 1], ["NFKB1", 1, 1, 1], ["STAT3", 1, 1, 1],
];
const table: DataTable = {
  id: "t", kind: "sets", name: "T",
  columns: [{ id: "g", name: "Gene", role: "x" }, { id: "a", name: "Up in drug A", role: "y" }, { id: "b", name: "Up in drug B", role: "y" }, { id: "c", name: "Up in combo", role: "y" }],
  rows: rows.map((r, i) => ({ id: `r${i}`, cells: { g: r[0], a: r[1], b: r[2], c: r[3] } })),
};
const plotOf = (patch: Partial<Plot> = {}): Plot => ({ id: "p", name: "Venn diagram", title: "Venn diagram", source: "t", status: "ok", styleOverrides: {}, kind: "venn", ...patch }) as Plot;

function extent(s: ReturnType<typeof buildPlotScene>) {
  const v = s.venn!;
  const fs = s.fonts.legend.size;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const pt = (x: number, y: number) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  const text = (t: string, cx: number, base: number) => { if (!t) return; const hw = measure(t, fs) / 2; pt(cx - hw, base - fs * 0.8); pt(cx + hw, base + fs * 0.25); };
  for (const c of v.circles) { pt(c.cx - c.r, c.cy - c.r); pt(c.cx + c.r, c.cy + c.r); text(c.label, c.labelX, c.labelY); }
  for (const z of v.zones) text(z.text, z.labelX, z.labelY + fs * 0.34);
  return { x0, y0, x1, y1 };
}

describe("venn: discs, set names and counts fill the figure", () => {
  for (const [w, h] of [[540, 600], [640, 600], [580, 380], [420, 620]] as const) {
    for (const size of [13, 22]) {
      it(`${w}×${h}, names ${size}px: fills the limiting side of the canvas and stays on it`, () => {
        const s = buildPlotScene(table, plotOf({ fonts: { legend: { size } } } as Partial<Plot>), { width: w, height: h, measure });
        const e = extent(s);
        const top = 8 + s.fonts.title.size * 1.1; // the one-line heading's bottom (PlotFigure baseline 8 + 0.85·size)
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
