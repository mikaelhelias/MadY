/**
 * Dendrogram ▸ Standardise: with it on, every variable is z-scored across the leaves before
 * clustering, so a column in large units does not decide the tree. Off, the raw values are used.
 */
import { describe, expect, it } from "vitest";
import { hclust } from "@mady/core";
import type { DataTable } from "@mady/core";
import { buildPlotScene } from "./buildScene";

// Column "Small" separates {G1, G2} from {G3, G4}; column "Big" is in units a thousand times larger
// and orders the genes differently. Raw, "Big" decides everything; z-scored, both count equally.
const small = [1.0, 1.1, 5.0, 5.1];
const big = [3000, 1000, 2000, 4000];
const table: DataTable = {
  id: "t", kind: "multivariable", name: "Genes",
  columns: [
    { id: "g", name: "Gene", role: "x" },
    { id: "s", name: "Small", role: "y" },
    { id: "b", name: "Big", role: "y" },
  ],
  rows: ["G1", "G2", "G3", "G4"].map((g, i) => ({ id: `r${i}`, cells: { g, s: small[i]!, b: big[i]! } })),
} as unknown as DataTable;
const labels = ["G1", "G2", "G3", "G4"];
const zscore = (v: number[]): number[] => {
  const m = v.reduce((a, x) => a + x, 0) / v.length;
  const sd = Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / (v.length - 1));
  return v.map((x) => (x - m) / sd);
};
const orderOf = (cols: number[][], linkage: "average" | "complete"): string[] =>
  hclust(labels.map((_, i) => cols.map((c) => c[i]!)), "euclidean", linkage).order.map((i) => labels[i]!);
const scene = (standardize?: boolean) =>
  buildPlotScene(table, { id: "p", name: "D", source: "t", status: "ok", styleOverrides: {}, kind: "dendrogram", dendrogram: { linkage: "average", ...(standardize === undefined ? {} : { standardize }) } } as never, { width: 560, height: 380 });

describe("dendrogram Standardise", () => {
  it("off (and absent): the tree is built on the raw values, as before", () => {
    const want = orderOf([small, big], "average");
    expect(scene().x.ticks.map((t) => t.label)).toEqual(want);
    expect(scene(false).x.ticks.map((t) => t.label)).toEqual(want);
  });

  it("on: the tree is built on the z-scored columns", () => {
    expect(scene(true).x.ticks.map((t) => t.label)).toEqual(orderOf([zscore(small), zscore(big)], "average"));
  });

  it("the two trees really differ on this data, so the option is not a no-op", () => {
    expect(scene(true).x.ticks.map((t) => t.label)).not.toEqual(scene(false).x.ticks.map((t) => t.label));
  });
});
