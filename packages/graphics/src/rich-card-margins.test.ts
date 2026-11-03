/**
 * Two margins that realistic gallery sheets depend on:
 *  - a volcano plot reserves its y-title band even when the sheet has a gene column;
 *  - a survival number-at-risk table reserves room for its row labels.
 */
import { describe, expect, it } from "vitest";
import { buildPlotScene } from "./buildScene";
import type { DataTable, Plot } from "@mady/core";

const SIZE = { width: 700, height: 520 };
const base = (id: string): Plot => ({ id: "p", name: "P", source: id, status: "ok", styleOverrides: {} });

describe("volcano y-axis title margin", () => {
  const rows = [[0.2, 0.4], [-1.6, 3.2], [2.1, 4.8], [-0.3, 0.9], [1.4, 2.6]] as const;
  const bare: DataTable = {
    id: "v1", kind: "xy", name: "V",
    columns: [{ id: "fc", name: "log2 fold-change", role: "x" }, { id: "p", name: "-log10 p", role: "y" }],
    rows: rows.map((r, i) => ({ id: `r${i}`, cells: { fc: r[0], p: r[1] } })),
  };
  const withGene: DataTable = {
    ...bare, id: "v2",
    columns: [...bare.columns, { id: "gene", name: "Gene" }],
    rows: rows.map((r, i) => ({ id: `r${i}`, cells: { fc: r[0], p: r[1], gene: `G${i}` } })),
  };
  it("a gene column does not cost the y-axis title its band (every real volcano sheet has one)", () => {
    // The title is fixed ("−log₁₀ p") whatever the sheet, so the margin must reserve for it
    // whatever the sheet — with a third column the auto-label goes blank, and without this the
    // band would vanish, leaving the title drawn over the tick numbers.
    const a = buildPlotScene(bare, { ...base("v1"), kind: "volcano" }, SIZE);
    const b = buildPlotScene(withGene, { ...base("v2"), kind: "volcano" }, SIZE);
    expect(b.y.title).toBe(a.y.title);
    expect(b.plot.x).toBe(a.plot.x);
  });
});

describe("survival number-at-risk row labels", () => {
  const table: DataTable = {
    id: "s", kind: "survival", name: "S",
    columns: [{ id: "t", name: "Months", role: "x" }, { id: "a", name: "Placebo" }, { id: "b", name: "Combination therapy" }],
    rows: [{ id: "r0", cells: { t: 3, a: 1, b: null } }, { id: "r1", cells: { t: 9, a: null, b: 1 } }],
  };
  const plot: Plot = {
    ...base("s"), kind: "survival",
    survival: [
      { label: "Placebo", times: [0, 3, 9], surv: [1, 0.5, 0.25] },
      { label: "Combination therapy", times: [0, 3, 9], surv: [1, 0.9, 0.8] },
    ],
    survivalAtRisk: { times: [0, 3, 6, 9], rows: [{ label: "Placebo", atRisk: [48, 40, 30, 20] }, { label: "Combination therapy", atRisk: [48, 46, 44, 40] }] },
  };
  it("the widest row label ends before the first count column", () => {
    const measure = (t: string, px: number): number => t.length * px * 0.6;
    const s = buildPlotScene(table, plot, { ...SIZE, measure });
    const at = s.atRisk!;
    const widest = Math.max(...at.rows.map((r) => measure(r.label, s.fonts.tick.size)));
    // The count at t = 0 is centred on the axis origin; its left half starts half a number
    // ("48") to the left of it. The label must end before that.
    const firstCountLeft = at.cols[0]! - measure("48", s.fonts.tick.size) / 2;
    expect(at.labelX + widest, "the row label runs under the first count").toBeLessThan(firstCountLeft);
  });
});
