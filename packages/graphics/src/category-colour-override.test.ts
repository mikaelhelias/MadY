/**
 * A colour set for one category of a colour column (`colorFromColors`) recolours exactly that category: every point
 * of it and its legend key, and nothing else. The other categories keep their palette colours.
 */
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene, ddCategoryColour, ddRowCategory } from "./buildScene.js";

const GREYS = ["#111111", "#555555", "#999999"];
const RED = "#FF0000";
const base = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {} } as const;
const up = (c: string) => c.toUpperCase();

const xyTable: DataTable = {
  id: "t", kind: "xy", name: "T",
  columns: [{ id: "x", name: "X" }, { id: "y", name: "Y" }, { id: "g", name: "Group", type: "text" }],
  rows: ([[1, 2, "A"], [2, 3, "B"], [3, 5, "C"], [4, 4, "A"], [5, 6, "B"]] as const).map((v, i) => ({ id: `r${i}`, cells: { x: v[0], y: v[1], g: v[2] } })),
} as unknown as DataTable;

const ternTable = {
  id: "t", kind: "column", name: "T",
  columns: [{ id: "s", name: "Sample", role: "x" }, { id: "a", name: "Sand", role: "y" }, { id: "b", name: "Silt", role: "y" }, { id: "c", name: "Clay", role: "y" }, { id: "g", name: "Class", role: "y" }],
  rows: ([[90, 5, 5, "Sand"], [65, 25, 10, "Loam"], [20, 60, 20, "Silt"], [10, 30, 60, "Silt"]] as const).map((v, i) => ({ id: `r${i}`, cells: { s: `S${i}`, a: v[0], b: v[1], c: v[2], g: v[3] } })),
} as unknown as DataTable;

const swimTable = {
  id: "t", kind: "xy", name: "T",
  columns: [{ id: "pt", name: "Patient", role: "x" }, { id: "s", name: "Start" }, { id: "e", name: "End" }, { id: "arm", name: "Arm", type: "text" }],
  rows: ([["P1", 0, 10, "Drug"], ["P2", 0, 8, "Placebo"], ["P3", 0, 6, "Drug"]] as const).map((v, i) => ({ id: `r${i}`, cells: { pt: v[0], s: v[1], e: v[2], arm: v[3] } })),
} as unknown as DataTable;

describe("ddCategoryColour / ddRowCategory", () => {
  it("a set colour wins for its own category only; the rest keep the palette by first-seen index", () => {
    const st = { colorFromColors: { B: RED } };
    expect(ddCategoryColour(st, ["A", "B", "C"], "B", GREYS)).toBe(RED);
    expect(ddCategoryColour(st, ["A", "B", "C"], "A", GREYS)).toBe(GREYS[0]);
    expect(ddCategoryColour(st, ["A", "B", "C"], "C", GREYS)).toBe(GREYS[2]);
    expect(ddCategoryColour({}, ["A", "B", "C", "D"], "D", GREYS), "the palette wraps").toBe(GREYS[0]);
  });

  it("names the category of one row, and null for a row that is not in the table", () => {
    expect(ddRowCategory(xyTable, "g", "r1")).toBe("B");
    expect(ddRowCategory(xyTable, "g", "r3")).toBe("A");
    expect(ddRowCategory(xyTable, "g", "nope")).toBeNull();
  });
});

describe("a colour set for one category reaches its points and its legend key", () => {
  it("xy: the B points and the B key turn red; A and C stay as they were", () => {
    const plot = { ...base, kind: "xy", seriesStyles: { y: { colorFromColumn: "g", colorFromMode: "category", colorFromColors: { B: RED } } } } as unknown as Plot;
    const s = buildPlotScene(xyTable, plot, { palette: GREYS });
    const byRow = new Map(s.series[0]!.marks.map((m) => [m.rowId, up(m.fill ?? "")]));
    expect(["r0", "r1", "r2", "r3", "r4"].map((r) => byRow.get(r))).toEqual([GREYS[0], RED, GREYS[2], GREYS[0], RED]);
    expect(s.legend.map((e) => [e.label, up(e.color)])).toEqual([["A", GREYS[0]], ["B", RED], ["C", GREYS[2]]]);
  });

  it("ternary: the Silt points and key turn red", () => {
    const plot = { ...base, kind: "ternary", seriesStyles: { a: { colorFromColumn: "g", colorFromMode: "category", colorFromColors: { Silt: RED } } } } as unknown as Plot;
    const s = buildPlotScene(ternTable, plot, { palette: GREYS, width: 580, height: 380 });
    expect(s.legend.map((e) => [e.label, up(e.color)])).toEqual([["Sand", GREYS[0]], ["Loam", GREYS[1]], ["Silt", RED]]);
    const silt = s.series[0]!.marks.filter((m) => m.rowId === "r2" || m.rowId === "r3");
    expect(silt.length).toBe(2);
    for (const m of silt) expect(up(m.fill ?? "")).toBe(RED);
  });

  it("swimmer: the Placebo lane and key turn red", () => {
    const plot = { ...base, kind: "swimmer", seriesStyles: { s: { colorFromColumn: "arm", colorFromMode: "category", colorFromColors: { Placebo: RED } } } } as unknown as Plot;
    const s = buildPlotScene(swimTable, plot, { palette: GREYS, width: 580, height: 380 });
    expect(s.swimmer!.rows.map((r) => up(r.color))).toEqual([GREYS[0], RED, GREYS[0]]);
    expect(s.legend.map((e) => [e.label, up(e.color)])).toEqual([["Drug", GREYS[0]], ["Placebo", RED]]);
  });
});
