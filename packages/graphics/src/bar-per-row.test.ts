/**
 * Plot.barPerRow: on a simple Column sheet the bar chart pools each column into one bar (its rows are
 * replicates). The waterfall and the Pareto read their values down the rows, so they ask for one bar per row.
 */
import { describe, expect, it } from "vitest";
import { barsArePerColumn, bracketGeometry } from "@mady/core";
import type { DataTable } from "@mady/core";
import { buildPlotScene } from "./buildScene";

const table = {
  id: "t", kind: "column", name: "Response",
  columns: [{ id: "c", name: "Change %", role: "y" }],
  rows: [12, -40, 5, -25, 30].map((v, i) => ({ id: `r${i}`, cells: { c: v } })),
} as unknown as DataTable;
const plot = (extra: object) => ({ id: "p", name: "W", source: "t", status: "ok", styleOverrides: {}, kind: "bar", ...extra }) as never;
const opts = { width: 560, height: 380 };

describe("one bar per row on a Column sheet", () => {
  it("by default a one-column sheet is one pooled bar", () => {
    const s = buildPlotScene(table, plot({}), opts);
    expect(s.x.ticks.map((t) => t.label)).toEqual(["Change %"]);
  });

  it("barPerRow draws one bar per row, named by row number", () => {
    const s = buildPlotScene(table, plot({ barPerRow: true }), opts);
    expect(s.x.ticks.map((t) => t.label)).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("the bracket planner agrees with the drawing", () => {
    expect(barsArePerColumn(table)).toBe(true);
    expect(barsArePerColumn(table, { barPerRow: true })).toBe(false);
    expect(bracketGeometry({ kind: "bar", barPerRow: true }, table).endpoints).toBe("category-row");
    expect(bracketGeometry({ kind: "bar" }, table).endpoints).toBe("category-dataset");
  });
});
