import { describe, expect, it } from "vitest";
import type { DataTable } from "@mady/core";
import { graphCurves, graphDatasetIds, startingCurves } from "./analyzeCurves";

const ids = ["a", "b", "c"];

describe("graphDatasetIds", () => {
  // Life expectancy against income: Population sets the bubble size, CO2 at most its colour.
  const table: DataTable = {
    id: "t", kind: "xy", name: "Countries",
    columns: [{ id: "x", name: "GDP", role: "x" }, { id: "y", name: "Life expectancy", role: "y" }, { id: "s", name: "Population", role: "y" }, { id: "c", name: "CO2", role: "y" }],
    rows: [[5, 62, 30, 3], [12, 70, 82, 8], [22, 76, 15, 14]].map(([x, y, s, c], i) => ({ id: `r${i}`, cells: { x: x!, y: y!, s: s!, c: c! } })),
  };

  it("a bubble chart: only the series it draws, so Analyze does not start by fitting the bubble size", () => {
    expect(graphDatasetIds({ kind: "bubble" }, table)).toEqual(["y"]);
    expect(startingCurves(graphCurves({}, graphDatasetIds({ kind: "bubble" }, table)))).toEqual(["y"]);
  });

  it("an XY chart: every series", () => {
    expect(graphDatasetIds({ kind: "xy" }, table)).toEqual(["y", "s", "c"]);
  });
});

describe("graphCurves", () => {
  it("lists every series the graph draws, leaving hidden ones out", () => {
    expect(graphCurves({ seriesStyles: { b: { hidden: true } } }, ids)).toEqual({ shown: ["a", "c"] });
  });

  it("keeps the selected series when it belongs to the sheet", () => {
    expect(graphCurves({}, ids, "b")).toEqual({ selected: "b", shown: ids });
  });

  it("ignores a selection that is not one of the sheet's series", () => {
    expect(graphCurves({}, ids, "elsewhere")).toEqual({ shown: ids });
  });

  it("counts every series when all of them are hidden", () => {
    const all = { a: { hidden: true }, b: { hidden: true }, c: { hidden: true } };
    expect(graphCurves({ seriesStyles: all }, ids).shown).toEqual(ids);
  });
});

describe("startingCurves", () => {
  it("starts on the selected series", () => {
    expect(startingCurves({ selected: "b", shown: ids })).toEqual(["b"]);
  });

  it("starts on every shown series when none is selected", () => {
    expect(startingCurves({ shown: ["a", "c"] })).toEqual(["a", "c"]);
  });

  it("a method needing two curves takes every shown series even with one selected", () => {
    expect(startingCurves({ selected: "b", shown: ids }, 2)).toEqual(ids);
  });
});
