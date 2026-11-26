/**
 * A column of names is not a bar series. In an imported plate sheet (Well, Sample = "Blank", "Std1", …, OD450), "Sample"
 * drawn as a series would have no bars: a legend row for nothing, and a reserved slot that makes the real bars half-width
 * and off-centre. XY charts skip such a column (`xyFamilyDatasets`), and so do bars where rows are the categories.
 * A simple Column sheet (each column a group, no row labels) keeps every column: a group of all text is an empty
 * group the reader should see, not one to hide.
 */
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { barDatasets, buildPlotScene } from "./buildScene";

const plate = (names: unknown[] = ["Blank", "Std1", "Std2", "Ctrl"]): DataTable => ({
  id: "t", kind: "xy", name: "t",
  columns: [{ id: "w", name: "Well" }, { id: "s", name: "Sample" }, { id: "od", name: "OD450" }],
  rows: names.map((n, i) => ({ id: `r${i}`, cells: { w: `A${i + 1}`, s: n, od: 0.2 + i * 0.3 } })),
} as unknown as DataTable);

const barPlot = (extra: Partial<Plot> = {}): Plot =>
  ({ id: "p", name: "p", source: "t", status: "ok", styleOverrides: {}, kind: "bar", ...extra }) as unknown as Plot;
const build = (table: DataTable, plot: Plot = barPlot()) => buildPlotScene(table, plot, { width: 640, height: 440 });

describe("barDatasets", () => {
  it("leaves out a column of names where the rows are the categories", () => {
    expect(barDatasets(plate()).map((d) => d.id)).toEqual(["od"]);
  });
  it("keeps a blank column (data still to be typed) and a column with one number among its names", () => {
    expect(barDatasets(plate(["", null, "", ""])).map((d) => d.id)).toEqual(["s", "od"]);
    expect(barDatasets(plate(["Blank", 4, "Std2", "Ctrl"])).map((d) => d.id)).toEqual(["s", "od"]);
  });
  it("keeps every column of a simple Column sheet: each is a group, an all-text group included", () => {
    const col = {
      id: "t", kind: "column", name: "t",
      columns: [{ id: "x", name: "", role: "x" }, { id: "a", name: "A", role: "y" }, { id: "b", name: "B", role: "y" }],
      rows: [{ id: "r0", cells: { x: null, a: 1, b: "n/a" } }, { id: "r1", cells: { x: null, a: 2, b: "n/a" } }],
    } as unknown as DataTable;
    expect(barDatasets(col).map((d) => d.id)).toEqual(["a", "b"]);
  });
  it("a labelled Column sheet has row categories, so it skips a column of names like any other", () => {
    const col = {
      id: "t", kind: "column", name: "t",
      columns: [{ id: "x", name: "Row", role: "x" }, { id: "a", name: "A", role: "y" }, { id: "b", name: "Note", role: "y" }],
      rows: [{ id: "r0", cells: { x: "one", a: 1, b: "ok" } }, { id: "r1", cells: { x: "two", a: 2, b: "ok" } }],
    } as unknown as DataTable;
    expect(barDatasets(col).map((d) => d.id)).toEqual(["a"]);
  });
});

describe("a bar chart does not draw a column of names", () => {
  it("no series, no legend row, no reserved slot: the bars match a sheet without that column", () => {
    const withNames = build(plate());
    const without = build({ ...plate(), columns: plate().columns.filter((c) => c.id !== "s") } as DataTable);
    expect(withNames.series.map((s) => s.id)).toEqual(["od"]);
    expect(withNames.legend.map((l) => l.label)).not.toContain("Sample");
    expect(withNames.barsPerBand).toBe(1);
    const w = (s: typeof withNames) => s.series[0]!.marks.map((m) => m.bar!.w);
    expect(w(withNames)).toEqual(w(without));
    expect(withNames.plot.width).toBe(without.plot.width);
  });

  it("the hand-set look of the real series is untouched", () => {
    const s = build(plate(), barPlot({ seriesStyles: { od: { color: "#112233" } } } as Partial<Plot>));
    expect(s.series[0]!.color).toBe("#112233");
  });

  it("a name-only table has nothing to draw, and the figure says so rather than drawing an empty slot", () => {
    const t = { ...plate(), columns: plate().columns.filter((c) => c.id !== "od") } as DataTable;
    const s = build(t);
    expect(s.series).toHaveLength(0);
    expect(s.warnings.length).toBeGreaterThan(0);
  });

  it("a simple Column sheet still shows its all-text group as an empty category", () => {
    const col = {
      id: "t", kind: "column", name: "t",
      columns: [{ id: "x", name: "", role: "x" }, { id: "a", name: "A", role: "y" }, { id: "b", name: "B", role: "y" }],
      rows: [{ id: "r0", cells: { x: null, a: 1, b: "n/a" } }, { id: "r1", cells: { x: null, a: 2, b: "n/a" } }],
    } as unknown as DataTable;
    const s = build(col);
    expect(s.x.ticks.map((t) => t.label)).toEqual(expect.arrayContaining(["A", "B"]));
  });
});
