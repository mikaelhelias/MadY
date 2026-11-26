/**
 * The series a bubble chart draws: its first value column sets the vertical position and is drawn; the second sets
 * each bubble's size and the rest at most its colour, so neither is a series. A table with a single value column draws
 * that column. A column of names is never one of them. The builder and the Analyze dialog share this definition.
 */
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { bubbleSeriesDatasets, buildPlotScene, fitSeriesNotDrawn } from "./buildScene";

type Col = { id: string; name: string; role: "x" | "y" };
const sheet = (cols: Col[], rows: unknown[][]): DataTable => ({
  id: "t", kind: "xy", name: "Countries", columns: cols,
  rows: rows.map((r, i) => ({ id: `r${i}`, cells: Object.fromEntries(cols.map((c, j) => [c.id, r[j]])) })),
} as unknown as DataTable);

const bubble = { id: "p", name: "p", source: "t", status: "ok", styleOverrides: {}, kind: "bubble" } as unknown as Plot;
const drawn = (table: DataTable) => buildPlotScene(table, bubble, { width: 640, height: 440 }).series.map((s) => s.id);

const X: Col = { id: "x", name: "GDP", role: "x" };
const Y: Col = { id: "y", name: "Life expectancy", role: "y" };
const SIZE: Col = { id: "s", name: "Population", role: "y" };
const COLOUR: Col = { id: "c", name: "CO2", role: "y" };
const NAME: Col = { id: "n", name: "Country", role: "y" };

describe("bubbleSeriesDatasets", () => {
  it("position, size and colour columns: only the position column is a series, and only it is drawn", () => {
    const t = sheet([X, Y, SIZE, COLOUR], [[5, 62, 30, 3], [12, 70, 82, 8], [22, 76, 15, 14]]);
    expect(bubbleSeriesDatasets(t).map((d) => d.id)).toEqual(["y"]);
    expect(drawn(t)).toEqual(["y"]);
  });

  it("a single value column is kept and drawn", () => {
    const t = sheet([X, Y], [[5, 62], [12, 70], [22, 76]]);
    expect(bubbleSeriesDatasets(t).map((d) => d.id)).toEqual(["y"]);
    expect(drawn(t)).toEqual(["y"]);
  });

  it("a column of names ahead of the values is not counted as the position column", () => {
    const t = sheet([X, NAME, Y, SIZE], [[5, "Chad", 62, 30], [12, "Peru", 70, 82], [22, "Chile", 76, 15]]);
    expect(bubbleSeriesDatasets(t).map((d) => d.id)).toEqual(["y"]);
    expect(drawn(t)).toEqual(["y"]);
  });

  it("no value column: no series", () => {
    expect(bubbleSeriesDatasets(sheet([X], [[5], [12]]))).toEqual([]);
  });
});

describe("fitSeriesNotDrawn", () => {
  const t = sheet([X, Y, SIZE, COLOUR], [[5, 62, 30, 3], [12, 70, 82, 8], [22, 76, 15, 14]]);
  const xy = { kind: "xy" } as Pick<Plot, "kind">;
  const bub = { kind: "bubble" } as Pick<Plot, "kind">;

  it("a bubble chart: the curves of its size and colour columns are not drawn, and are named", () => {
    expect(fitSeriesNotDrawn(bub, t, { series: "s" })).toEqual({ id: "s", name: "Population" });
    expect(fitSeriesNotDrawn(bub, t, { series: "c" })).toEqual({ id: "c", name: "CO2" });
    expect(fitSeriesNotDrawn(bub, t, { series: "y" })).toBeUndefined();
  });

  it("an XY chart draws every series, so every curve", () => {
    for (const s of ["y", "s", "c"]) expect(fitSeriesNotDrawn(xy, t, { series: s })).toBeUndefined();
  });

  it("a fit that names no series, or one not on this sheet, is drawn as before", () => {
    expect(fitSeriesNotDrawn(bub, t, {})).toBeUndefined();
    expect(fitSeriesNotDrawn(bub, t, { series: "gone" })).toBeUndefined();
  });
});
