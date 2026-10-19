/**
 * The columns an alluvial draws, which the Inspector's Axes list ticks: the chosen ones when at least two are chosen,
 * else every mostly-text column, else the first two.
 */
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { alluvialAxisColumns, buildPlotScene } from "./buildScene";

const table = {
  id: "t", kind: "multivariable", name: "T",
  columns: [{ id: "a", name: "A" }, { id: "n", name: "N" }, { id: "b", name: "B" }, { id: "c", name: "C" }],
  rows: Array.from({ length: 8 }, (_, i) => ({ id: `r${i}`, cells: { a: `a${i % 3}`, n: i, b: `b${i % 2}`, c: `c${i % 4}` } })),
} as unknown as DataTable;
const plot = (columns?: string[]) => ({ id: "p", name: "P", source: "t", kind: "alluvial", ...(columns ? { alluvial: { columns } } : {}) }) as unknown as Plot;

describe("alluvialAxisColumns", () => {
  it("with nothing chosen: every text column, in table order", () => {
    expect(alluvialAxisColumns(table, plot())).toEqual(["a", "b", "c"]);
  });
  it("two or more chosen: those, in the chosen order; a missing id is ignored", () => {
    expect(alluvialAxisColumns(table, plot(["c", "a", "gone"]))).toEqual(["c", "a"]);
  });
  it("one chosen is not a diagram: every text column again", () => {
    expect(alluvialAxisColumns(table, plot(["c"]))).toEqual(["a", "b", "c"]);
  });
  it("fewer than two text columns: the first two columns", () => {
    const nums = { ...table, rows: table.rows.map((r) => ({ ...r, cells: { a: 1, n: 2, b: 3, c: "x" } })) } as unknown as DataTable;
    expect(alluvialAxisColumns(nums, plot())).toEqual(["a", "n"]);
  });
  it("is what the diagram draws", () => {
    for (const cols of [undefined, ["c", "a"], ["b", "c", "a"]]) {
      const names = buildPlotScene(table, plot(cols), { width: 500, height: 360 }).alluvial!.axisLabels.map((x) => x.label);
      const want = alluvialAxisColumns(table, plot(cols)).map((id) => table.columns.find((c) => c.id === id)!.name);
      expect(names).toEqual(want);
    }
  });
});
