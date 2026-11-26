/**
 * No empty band above a bar chart that draws no bars.
 *
 * With "Show values" on and Value position "Above" (the default), the bar builder keeps a band of free space
 * above the plot so the tallest bar's number does not run into the title. On a bar chart whose series are all
 * drawn as dots or a line there is no bar to stand a number on - the numbers ride the dots - so the band would
 * stay empty (~20 px on a 380 px figure). The band is not drawn for such a chart, so its plot is taller.
 *
 * Both directions, because each alone is easy to pass wrongly:
 *   • no bar left (points only, line only)                → no band;
 *   • any bar left (plain bars, one bar series among dots,
 *     a stacked chart, where points and area are refused) → the band stays, or the top number meets the title.
 */
import { describe, expect, it } from "vitest";
import type { DataTable, Plot, SeriesStyle } from "@mady/core";
import { buildPlotScene } from "./buildScene.js";

const table: DataTable = {
  id: "t", kind: "column", name: "T",
  columns: [{ id: "g", name: "Treatment", role: "x" }, { id: "a", name: "Survival", role: "y" }, { id: "b", name: "Relapse", role: "y" }],
  rows: [["Control", 42, 30], ["Drug A", 61, 22], ["Drug B", 78, 15], ["Combo", 88, 9]]
    .map(([g, a, b], i) => ({ id: `r${i}`, cells: { g: g as string, a: a as number, b: b as number } })),
};
const SIZE = { width: 520, height: 380 };
const plotY = (styles: Record<string, SeriesStyle>, extra: Partial<Plot> = {}, showValues = true): number =>
  buildPlotScene(table, {
    id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "bar", title: "Survival", legend: { show: false },
    showValues, seriesStyles: styles, ...extra,
  } as Plot, SIZE).plot.y;

/** How far "Show values" pushes the plot down: the band, if there is one. */
const band = (styles: Record<string, SeriesStyle>, extra: Partial<Plot> = {}): number =>
  plotY(styles, extra, true) - plotY(styles, extra, false);

describe("the band for bar value labels is kept only where a bar carries one", () => {
  it("every series drawn as dots: no band", () => {
    expect(band({ a: { plotAs: "points" }, b: { plotAs: "points" } })).toBe(0);
  });

  it("every series drawn as a line: no band", () => {
    expect(band({ a: { plotAs: "line" }, b: { plotAs: "line" } })).toBe(0);
  });

  it("plain bars keep the band (the number above the tallest bar needs it)", () => {
    expect(band({})).toBeGreaterThan(10);
  });

  it("one series still drawn as bars among dots keeps the band", () => {
    expect(band({ b: { plotAs: "points" } })).toBeGreaterThan(10);
  });

  it("a stacked chart keeps it: points and area are refused there and stay bars", () => {
    expect(band({ a: { plotAs: "points" }, b: { plotAs: "points" } }, { barLayout: "stacked" })).toBeGreaterThan(10);
  });

  it("inside placements have no band, with bars or without", () => {
    expect(band({}, { valuePlacement: "insideEnd" })).toBe(0);
    expect(band({ a: { plotAs: "points" }, b: { plotAs: "points" } }, { valuePlacement: "insideBase" })).toBe(0);
  });
});
