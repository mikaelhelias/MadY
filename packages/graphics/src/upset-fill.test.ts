import { describe, expect, it } from "vitest";
import type { CellValue, DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene";

/**
 * The UpSet plot does not reserve its margins twice.
 *
 * The bars are drawn by the bar builder, which keeps its own margins; guards against the UpSet
 * reserving its own on top. Bottom: the dot matrix plus the bar builder's band for category names,
 * which the UpSet deletes — reserving both leaves a blank strip under the last matrix row. Left:
 * the set names + set-size bars plus the count axis's margin, which sits beside the bars above the
 * matrix and can share that width — reserving both leaves a blank strip at the far left.
 *
 * Text as PlotFigure draws it: set names end at labelX, totals end 4px left of their bar, both in the
 * x-tick font.
 */
const measure = (text: string, px: number): number => text.length * px * 0.58;
const rows: CellValue[][] = [
  ["ATF3", 1, "", "", "", ""], ["FOS", 1, "", "", "", ""], ["JUN", 1, "", "", "", ""], ["EGR1", 1, "", "", "", ""], ["KLF2", 1, "", "", "", ""], ["IER2", 1, "", "", "", ""],
  ["MYC", "", 1, "", "", ""], ["KLF4", "", 1, "", "", ""], ["SOX2", "", 1, "", "", ""], ["TP53", "", "", 1, "", ""], ["CDKN1A", "", "", 1, "", ""],
  ["HSPA5", 1, 1, "", "", ""], ["DDIT3", 1, 1, "", "", ""], ["ATF4", 1, 1, "", "", ""], ["XBP1", 1, 1, 1, "", ""], ["NFKB1", 1, 1, 1, "", ""],
  ["GADD45A", "", "", "", 1, ""], ["SESN2", "", "", "", 1, 1], ["TRIB3", "", "", "", "", 1], ["ASNS", 1, "", "", 1, 1], ["PPP1R15A", 1, 1, "", 1, ""], ["VEGFA", "", "", 1, "", 1],
];
const ids = ["a", "b", "c", "d", "e"];
const table: DataTable = {
  id: "t", kind: "sets", name: "T",
  columns: [{ id: "g", name: "Gene", role: "x" }, ...["Drug A", "Drug B", "Combo", "24 h", "72 h"].map((n, i) => ({ id: ids[i]!, name: n, role: "y" as const }))],
  rows: rows.map((r, i) => ({ id: `r${i}`, cells: Object.fromEntries([["g", r[0]], ...ids.map((id, k) => [id, r[k + 1]])]) })),
};
const plotOf = (size: number, patch: Partial<Plot> = {}): Plot => ({
  id: "p", name: "UpSet plot", title: "UpSet plot", source: "t", status: "ok", styleOverrides: {}, kind: "upset", showValues: true,
  fonts: { tick: { size }, xTick: { size }, yTick: { size }, axisTitle: { size: size + 2 } }, ...patch,
}) as Plot;

describe("upset: no double margins — the drawing reaches the left and bottom edges", () => {
  for (const [w, h] of [[720, 620], [580, 380], [900, 700]] as const) {
    for (const size of [13, 20]) {
      it(`${w}×${h}, fonts ${size}px`, () => {
        const s = buildPlotScene(table, plotOf(size), { width: w, height: h, measure });
        const u = s.upset!;
        const fs = s.fonts.xTick.size;
        let left = Infinity;
        for (const set of u.sets) {
          left = Math.min(left, set.labelX - measure(set.label, fs));
          if (set.bar) left = Math.min(left, set.bar.x, set.bar.x - 4 - measure(String(set.total), fs));
        }
        const lastRowBottom = u.sets[u.sets.length - 1]!.rowCy + u.matrix.rowH / 2;
        expect(left, `the left strip is ${left.toFixed(0)}px wide`).toBeLessThanOrEqual(20);
        expect(left, "drawn past the left edge").toBeGreaterThanOrEqual(0);
        expect(h - lastRowBottom, `${(h - lastRowBottom).toFixed(0)}px blank below the matrix`).toBeLessThanOrEqual(20);
        expect(lastRowBottom, "the matrix runs off the bottom").toBeLessThanOrEqual(h);
        // The count axis still stands beside the bars, the matrix below them.
        expect(u.matrix.top, "the matrix climbed into the bar plot").toBeGreaterThanOrEqual(s.plot.y + s.plot.height);
        expect(s.plot.x - Math.max(...u.sets.map((x) => x.labelX)), "the set names reach into the bars' column").toBeGreaterThan(0);
      });
    }
  }
});
