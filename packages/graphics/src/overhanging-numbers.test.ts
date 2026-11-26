/**
 * A number printed on a glyph stays readable when it is wider than the glyph.
 *
 * A number's colour is picked for the glyph's fill — white on a dark circle — but "-0.83" is wider
 * than a small circle, so in that colour its ends would run white onto the white page, and on a
 * bubble grid a dark number would sit half on a small dark bubble. A number that overhangs its glyph
 * is drawn in page ink with a page-coloured halo, which reads over the glyph and over the page; one
 * that fits keeps the colour picked for the fill.
 */
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene";

const measure = (t: string, px: number): number => t.length * px * 0.6;
const size = { width: 520, height: 520, measure };

describe("correlation matrix, circles with values", () => {
  // Two variables strongly and weakly related, so one circle is large and one small.
  const n = 12;
  const a = Array.from({ length: n }, (_, i) => i);
  const b = a.map((v, i) => v + (i % 2 ? 3 : -3)); // r ≈ 0.85 with a
  const c = a.map((_, i) => [3, -1, 4, 1, -5, 9, -2, 6, -5, 3, -5, 8][i]!); // weak
  const table = {
    id: "t", kind: "multivariable", name: "M",
    columns: [{ id: "a", name: "A", role: "y" }, { id: "b", name: "B", role: "y" }, { id: "c", name: "C", role: "y" }],
    rows: a.map((_, i) => ({ id: `r${i}`, cells: { a: a[i], b: b[i], c: c[i] } })),
  } as unknown as DataTable;
  const plot = { id: "p", name: "C", source: "t", kind: "corrmatrix", corrmatrix: { glyph: "circle", showValues: true } } as unknown as Plot;

  it("a number wider than its circle gets page ink and a halo; one that fits keeps the circle's contrast", () => {
    const cells = buildPlotScene(table, plot, size).corrmatrix!.cells.filter((x) => x.label);
    const diag = cells.find((x) => x.row === x.col)!; // r = 1: "1" fits the full circle
    const weak = cells.find((x) => x.row !== x.col && Math.abs(x.r ?? 0) < 0.4)!; // small circle, "-0.1"-wide label
    expect(diag.labelHalo, "a label that fits needs no halo").toBeUndefined();
    expect(weak.labelHalo, "the overhanging number would run onto the page in the circle's ink").toBe("var(--bg)");
    expect(weak.labelColor).toBe("var(--ink)");
  });
});

describe("bubble heatmap with values", () => {
  const table = {
    id: "t", kind: "multivariable", name: "H",
    columns: [{ id: "n", name: "Athlete", role: "x" }, { id: "s", name: "Sprint", role: "y" }, { id: "e", name: "Endurance", role: "y" }],
    rows: [["Ana", 82, 64], ["Ben", 58, 88], ["Dev", 66, 59]].map(([n, s, e], i) => ({ id: `r${i}`, cells: { n, s, e } })),
  } as unknown as DataTable;
  const plot = { id: "p", name: "H", source: "t", kind: "heatmap", heatmap: { cellShape: "bubble", showValues: true } } as unknown as Plot;

  it("a number on a bubble smaller than the number gets page ink and a halo; on a big bubble it does not", () => {
    const cells = buildPlotScene(table, plot, size).heatmap!.cells.filter((x) => x.label);
    const big = cells.reduce((p, q) => ((q.r ?? 0) > (p.r ?? 0) ? q : p));
    const small = cells.filter((x) => x.r != null && x.r * 2 < measure(x.label, 12)).reduce((p, q) => ((q.r ?? 0) < (p.r ?? 0) ? q : p));
    expect(big.labelHalo).toBeUndefined();
    expect(small.labelHalo).toBe("var(--bg)");
    expect(small.labelColor).toBe("var(--ink)");
  });
});
