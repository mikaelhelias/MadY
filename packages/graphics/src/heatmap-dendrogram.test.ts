// @vitest-environment node
/**
 * A heatmap's dendrograms must not be drawn through its labels.
 *
 * The margin reserves `dendrogram + labels` on each side, so the band beside the cells is
 * [tree][labels][cells]. Guards against measuring both inward from the plot edge, which paints
 * the tree straight over the names and leaves every label unreadable once clustering is on.
 *
 * The assertion is on the tree's path geometry rather than on rendered text, so it needs no
 * DOM: `measure` is injected, which makes the label strip an exact number here.
 */
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene";

/** Deterministic text metrics: every glyph 7px wide at any size. */
const CHAR_W = 7;
const measure = (t: string): number => t.length * CHAR_W;

const ROWS = ["GeneAlpha", "GeneBeta", "GeneGamma", "GeneDelta", "GeneEpsilon", "GeneZeta"];
const COLS = ["Control", "Drug A", "Drug B", "Drug C"];

const table: DataTable = {
  id: "t",
  kind: "xy",
  name: "T",
  columns: [{ id: "x", name: "Gene" }, ...COLS.map((c, j) => ({ id: `c${j}`, name: c }))],
  rows: ROWS.map((name, i) => ({
    id: `r${i}`,
    cells: Object.fromEntries([["x", name], ...COLS.map((_c, j) => [`c${j}`, (i + 1) * (j + 2) + (i % 3)])]),
  })),
};

const plotWith = (heatmap: NonNullable<Plot["heatmap"]>): Plot => ({
  id: "p", name: "HM", source: "t", status: "ok", styleOverrides: {}, kind: "heatmap", heatmap,
});

const scene = (heatmap: NonNullable<Plot["heatmap"]>) =>
  buildPlotScene(table, plotWith(heatmap), { measure, width: 620, height: 420 });

/** Extent of every coordinate in an SVG path's M/L commands. */
function pathExtent(d: string): { minX: number; maxX: number; minY: number; maxY: number } {
  const pts = [...d.matchAll(/[ML]\s*(-?[\d.]+),(-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])] as const);
  expect(pts.length, "the tree path has no points").toBeGreaterThan(0);
  return {
    minX: Math.min(...pts.map((p) => p[0])), maxX: Math.max(...pts.map((p) => p[0])),
    minY: Math.min(...pts.map((p) => p[1])), maxY: Math.max(...pts.map((p) => p[1])),
  };
}

describe("heatmap dendrograms clear the labels", () => {
  const clustered = { cluster: "both" as const, showDendrogram: true };

  it("the row tree stops short of where the row labels begin", () => {
    const s = scene(clustered);
    const row = s.heatmap?.dendrograms?.row;
    expect(row, "no row dendrogram was drawn").toBeTruthy();
    // Labels are drawn ending at plot.x - 6, so they occupy [plot.x - 6 - widest, plot.x - 6].
    const widest = Math.max(...ROWS.map(measure));
    const labelsStartAt = s.plot.x - 6 - widest;
    expect(
      pathExtent(row!).maxX,
      "the row dendrogram is drawn over the row labels",
    ).toBeLessThanOrEqual(labelsStartAt);
  });

  it("the column tree stops above where the column labels begin", () => {
    const s = scene(clustered);
    const col = s.heatmap?.dendrograms?.col;
    expect(col, "no column dendrogram was drawn").toBeTruthy();
    // Column labels sit in the strip immediately above the cells.
    expect(
      pathExtent(col!).maxY,
      "the column dendrogram is drawn over the column labels",
    ).toBeLessThan(s.plot.y - 8);
  });

  it("both trees stay inside the figure, and inside the margin reserved for them", () => {
    const s = scene(clustered);
    const row = pathExtent(s.heatmap!.dendrograms!.row!);
    const col = pathExtent(s.heatmap!.dendrograms!.col!);
    expect(row.minX, "the row tree runs off the left edge").toBeGreaterThanOrEqual(0);
    expect(col.minY, "the column tree runs off the top edge").toBeGreaterThanOrEqual(0);
    expect(row.maxX).toBeLessThan(s.plot.x);
    expect(col.maxY).toBeLessThan(s.plot.y);
  });

  it("still draws a complete tree — one bracket per merge", () => {
    // The layout must not quietly drop links: n leaves cluster in n-1 merges, and each
    // bracket is 4 points (down, across, up).
    const s = scene(clustered);
    const rowPts = [...s.heatmap!.dendrograms!.row!.matchAll(/[ML]/g)].length;
    const colPts = [...s.heatmap!.dendrograms!.col!.matchAll(/[ML]/g)].length;
    expect(rowPts, `expected ${ROWS.length - 1} row merges`).toBe((ROWS.length - 1) * 4);
    expect(colPts, `expected ${COLS.length - 1} column merges`).toBe((COLS.length - 1) * 4);
  });

  it("draws no tree at all when clustering is off", () => {
    expect(scene({ cluster: "none" }).heatmap?.dendrograms).toBeUndefined();
  });
});

describe("multivariable heatmap — a leading text column is the row labels, not grey cells", () => {
  const mv = (firstCol: { name: string; role?: "x" }, firstVals: (string | number)[]): DataTable => ({
    id: "mv", kind: "multivariable", name: "MV",
    columns: [{ id: "c0", ...firstCol }, { id: "s", name: "Size" }, { id: "g", name: "Granularity" }],
    rows: firstVals.map((v, i) => ({ id: `r${i}`, cells: { c0: v, s: 1 + i, g: 10 - i } })),
  });
  const plot: Plot = { id: "p", name: "P", source: "mv", kind: "heatmap" } as Plot;
  const build = (t: DataTable) => buildPlotScene(t, plot, { width: 600, height: 400 });

  it("untagged text column → used as row labels and left out of the matrix, with no warning because this is the intended reading", () => {
    const s = build(mv({ name: "Cell type" }, ["Neuron", "Glia", "Stem"]));
    expect(s.heatmap!.colLabels.map((c) => c.label)).toEqual(["Size", "Granularity"]); // no grey "Cell type" column
    expect(s.heatmap!.rowLabels.map((r) => r.label)).toEqual(["Neuron", "Glia", "Stem"]); // not 1, 2, 3
    expect(s.heatmap!.cells.every((c) => c.color !== "#dddddd"), "no NaN-grey cells").toBe(true);
    expect(s.warnings, "no warning: this must rank as a CLEAN drawing in the graph suggestions").toEqual([]);
  });
  it("an explicitly tagged (role x) column is the labels too", () => {
    const s = build(mv({ name: "Cell type", role: "x" }, ["Neuron", "Glia", "Stem"]));
    expect(s.heatmap!.rowLabels.map((r) => r.label)).toEqual(["Neuron", "Glia", "Stem"]);
    expect(s.warnings.some((w) => /used as the row labels/.test(w))).toBe(false);
  });
  it("a numeric first column stays data — nothing changes for an all-number sheet", () => {
    const s = build(mv({ name: "Age" }, [40, 55, 61]));
    expect(s.heatmap!.colLabels.map((c) => c.label)).toEqual(["Age", "Size", "Granularity"]);
    expect(s.heatmap!.rowLabels.map((r) => r.label)).toEqual(["1", "2", "3"]);
    expect(s.warnings.some((w) => /used as the row labels/.test(w))).toBe(false);
  });
});

// Ward's Lance-Williams recurrence is only valid on Euclidean geometry; the builder must not
// silently cluster on a metric the user chose but the math overrides. `hclust` forces Euclidean
// for ward; the scene must say it did (a silent override reads as "your metric was honoured").
describe("heatmap clustering — Ward forces Euclidean and says so", () => {
  const wardWarn = /Ward linkage requires Euclidean/;
  it("ward + a non-euclidean metric warns", () => {
    expect(scene({ cluster: "both", clusterLinkage: "ward", clusterMetric: "manhattan" }).warnings.some((w) => wardWarn.test(w))).toBe(true);
    expect(scene({ cluster: "rows", clusterLinkage: "ward", clusterMetric: "correlation" }).warnings.some((w) => wardWarn.test(w))).toBe(true);
  });
  it("ward + euclidean, or any other linkage on a non-euclidean metric, does not warn", () => {
    expect(scene({ cluster: "both", clusterLinkage: "ward", clusterMetric: "euclidean" }).warnings.some((w) => wardWarn.test(w))).toBe(false);
    expect(scene({ cluster: "both", clusterLinkage: "average", clusterMetric: "manhattan" }).warnings.some((w) => wardWarn.test(w))).toBe(false);
    expect(scene({ cluster: "none", clusterLinkage: "ward", clusterMetric: "manhattan" }).warnings.some((w) => wardWarn.test(w))).toBe(false);
  });
});
