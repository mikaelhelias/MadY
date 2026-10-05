/**
 * Swimmer bar-end numbers fit their rows (e.g. with 40 patients the patient names shrink to the row height, and numbers
 * that did not would touch their neighbours). The numbers follow the same fit as the names (`fitStackedLabels`): a smaller font when rows are tight, every row still numbered while the readable floor
 * allows; a figure with room keeps the full size.
 */
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene";

function swimmer(rows: number, height: number) {
  const table = {
    id: "t", kind: "xy", name: "t",
    columns: [{ id: "pt", name: "Patient", role: "x" }, { id: "s", name: "Start" }, { id: "e", name: "End" }],
    rows: Array.from({ length: rows }, (_, i) => ({ id: `r${i}`, cells: { pt: `Pt ${i + 1}`, s: 0, e: 5 + ((i * 7) % 30) } })),
  } as unknown as DataTable;
  const plot = { id: "p", name: "p", source: "t", status: "ok", styleOverrides: {}, kind: "swimmer", showValues: true } as unknown as Plot;
  return buildPlotScene(table, plot, { width: 600, height });
}

describe("swimmer bar-end numbers fit their rows", () => {
  it("40 rows too tight for 13 px: the numbers shrink with the names, so a number is no taller than its row", () => {
    const s = swimmer(40, 620);
    const rows = s.swimmer!.rows;
    const band = s.plot.height / rows.length;
    expect(rows.filter((r) => r.label).length, "every row keeps its number").toBe(40);
    expect(s.fonts.valueLabel.size, "the numbers kept the full size").toBeLessThan(13);
    expect(s.fonts.valueLabel.size * 1.2 + 2).toBeLessThanOrEqual(band + 0.01);
    expect(s.fonts.valueLabel.size).toBe(s.fonts.yTick.size);
  });

  it("rows below the readable floor: numbers are thinned exactly like the names — the same rows keep both", () => {
    const s = swimmer(40, 380);
    const numbered = s.swimmer!.rows.map((r) => !!r.label);
    const named = [...s.y.ticks].sort((a, b) => a.pos - b.pos).map((t) => !!t.label);
    expect(numbered.filter(Boolean).length, "nothing was thinned — the fixture proves nothing").toBeLessThan(40);
    expect(numbered).toEqual(named);
  });

  it("few rows with room: the numbers keep their full size", () => {
    const s = swimmer(6, 380);
    expect(s.fonts.valueLabel.size).toBe(swimmer(6, 800).fonts.valueLabel.size);
    expect(s.swimmer!.rows.filter((r) => r.label).length).toBe(6);
  });
});
