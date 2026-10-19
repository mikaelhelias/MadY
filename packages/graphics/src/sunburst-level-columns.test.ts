/**
 * The columns a sunburst draws as rings, which the Inspector's Levels list ticks: the chosen ones, else every mostly-text
 * column, else the first column.
 */
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene, sunburstLevelColumns } from "./buildScene";

const table = {
  id: "t", kind: "multivariable", name: "T",
  columns: [{ id: "a", name: "Division" }, { id: "b", name: "Department" }, { id: "n", name: "Budget" }],
  rows: Array.from({ length: 6 }, (_, i) => ({ id: `r${i}`, cells: { a: `D${i % 2}`, b: `P${i % 3}`, n: 10 + i } })),
} as unknown as DataTable;
const plot = (levelColumns?: string[]) => ({ id: "p", name: "P", source: "t", kind: "sunburst", ...(levelColumns ? { sunburst: { levelColumns } } : {}) }) as unknown as Plot;

describe("sunburstLevelColumns", () => {
  it("with nothing chosen: every text column", () => {
    expect(sunburstLevelColumns(table, plot())).toEqual(["a", "b"]);
  });
  it("chosen: those, in the chosen order; a missing id is ignored", () => {
    expect(sunburstLevelColumns(table, plot(["b", "gone"]))).toEqual(["b"]);
  });
  it("no text column: the first column", () => {
    const nums = { ...table, rows: table.rows.map((r) => ({ ...r, cells: { a: 1, b: 2, n: 3 } })) } as unknown as DataTable;
    expect(sunburstLevelColumns(nums, plot())).toEqual(["a"]);
  });
  it("is what the sunburst draws: one ring per level", () => {
    for (const cols of [undefined, ["b"], ["b", "a"]]) {
      const depth = Math.max(...buildPlotScene(table, plot(cols), { width: 500, height: 400 }).sunburst!.segments.map((s) => s.depth));
      expect(depth, String(cols)).toBe(sunburstLevelColumns(table, plot(cols)).length);
    }
  });
});
