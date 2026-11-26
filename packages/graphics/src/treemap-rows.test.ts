/**
 * A treemap draws one cell per row of a sheet that is not Parts of whole, when asked.
 *
 * By default a Division · Department · Team · Budget · Staff sheet draws one cell per value column: two cells, "Budget"
 * and "Staff". Treemap › One cell per › Row draws a cell per team, named by the last text column (or the Label column),
 * sized by the first value column (or the Value column), and lets Colour by group and Cell icon work as on a Parts of
 * whole sheet. The default is one cell per value column, so a graph saved without the option keeps its cells.
 */
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene, treemapCells } from "./buildScene";

const rows: [string, string, string, number, number][] = [
  ["Research", "Biology", "Cell lab", 820, 14], ["Research", "Chemistry", "Synthesis", 510, 8], ["Operations", "IT", "Servers", 290, 4],
  ["Operations", "IT", "Help desk", 220, 7], ["Admin", "Finance", "Payroll", 240, 5],
];
const table = {
  id: "t", kind: "multivariable", name: "Budget",
  columns: [{ id: "d", name: "Division", role: "x" }, { id: "p", name: "Department", role: "x" }, { id: "m", name: "Team", role: "x" }, { id: "b", name: "Budget", role: "y" }, { id: "s", name: "Staff", role: "y" }],
  rows: rows.map(([d, p, m, b, s], i) => ({ id: `r${i}`, cells: { d, p, m, b, s } })),
} as unknown as DataTable;
const plot = (treemap: Record<string, unknown> = {}) => ({ id: "p", name: "T", source: "t", kind: "treemap", treemap }) as unknown as Plot;
const scene = (treemap: Record<string, unknown> = {}) => buildPlotScene(table, plot(treemap), { width: 640, height: 560 });
const cells = (s: ReturnType<typeof scene>) => s.treemap!.cells.map((c) => ({ ...c, label: c.label || c.suppressedLabel || "" }));

describe("treemapCells", () => {
  it("default on this sheet: one cell per value column", () => {
    expect(treemapCells(table, plot())).toEqual({ perRow: false, labelColumn: undefined, valueColumn: undefined });
  });
  it("row: named by the last text column, sized by the first value column unless chosen", () => {
    expect(treemapCells(table, plot({ cellsPer: "row" }))).toEqual({ perRow: true, labelColumn: "m", valueColumn: undefined });
    expect(treemapCells(table, plot({ cellsPer: "row", labelColumn: "p", valueColumn: "s" }))).toEqual({ perRow: true, labelColumn: "p", valueColumn: "s" });
  });
  it("a Parts of whole sheet is always one cell per row, named by its label column", () => {
    const pow = { ...table, kind: "partsofwhole", columns: [{ id: "m", name: "Team", role: "x" }, { id: "b", name: "Budget", role: "y" }] } as unknown as DataTable;
    expect(treemapCells(pow, plot({ cellsPer: "column" }))).toEqual({ perRow: true, labelColumn: "m", valueColumn: undefined });
  });
});

describe("treemap, one cell per row", () => {
  it("default: two cells, one per value column", () => {
    expect(cells(scene()).map((c) => c.label)).toEqual(["Budget", "Staff"]);
  });

  it("row: a cell per team, sized by budget; the second value column is named as not drawn", () => {
    const s = scene({ cellsPer: "row" });
    expect(cells(s).map((c) => c.label).sort()).toEqual(["Cell lab", "Help desk", "Payroll", "Servers", "Synthesis"]);
    const v = Object.fromEntries(cells(s).map((c) => [c.label, c.value]));
    expect(v["Cell lab"]).toBe(820);
    expect(s.warnings.some((w) => /Only the first value column \(Budget\)/.test(w))).toBe(true);
  });

  it("a chosen value and label column: sized by staff, named by department, and nothing said about the other column", () => {
    const s = scene({ cellsPer: "row", valueColumn: "s", labelColumn: "p" });
    expect(Object.fromEntries(cells(s).map((c) => [c.id, c.value]))).toEqual({ r0: 14, r1: 8, r2: 4, r3: 7, r4: 5 });
    expect(cells(s).find((c) => c.id === "r0")!.label).toBe("Biology");
    expect(s.warnings.filter((w) => /value column/.test(w))).toEqual([]);
  });

  it("the chosen value column hidden in the Series list: cells sized by the shown one, and the graph says so", () => {
    const s = buildPlotScene(table, { ...plot({ cellsPer: "row", valueColumn: "b" }), seriesStyles: { b: { hidden: true } } } as Plot, { width: 640, height: 560 });
    expect(Object.fromEntries(cells(s).map((c) => [c.id, c.value]))).toEqual({ r0: 14, r1: 8, r2: 4, r3: 7, r4: 5 });
    expect(s.warnings.some((w) => /value column \(Budget\) is hidden/.test(w) && /sized by Staff/.test(w))).toBe(true);
  });

  it("Colour by group works per row: one legend row per division, no 'not used' warning", () => {
    const s = scene({ cellsPer: "row", valueColumn: "b", groupColumn: "d" });
    expect(s.legend.map((l) => l.label)).toEqual(["Research", "Operations", "Admin"]);
    expect(s.warnings.filter((w) => /not used/.test(w))).toEqual([]);
  });

  it("one cell per value column with a group column set: the warning names the control", () => {
    expect(scene({ groupColumn: "d" }).warnings.some((w) => /not used/.test(w) && /One cell per › Row/.test(w))).toBe(true);
  });
});
