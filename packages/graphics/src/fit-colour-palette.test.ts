/**
 * A fitted curve wears the preset's colour, not the default palette's.
 *
 * Guards against `buildFit` falling back to `seriesColor(i)` with the default palette: under
 * Grayscale (print) the XY showcase card's two 4PL curves, their EC50 labels and parameter blocks
 * would stay Okabe-Ito blue and orange while every point is grey. The fallback reads the palette
 * the build was given — the same one the series take — so a curve matches its own points under
 * every preset. An explicit fit colour still wins.
 */
import { describe, expect, it } from "vitest";
import type { DataTable, Plot, PlotFit } from "@mady/core";
import { buildPlotScene } from "./buildScene.js";

const GREYS = ["#1A1A1A", "#5C5C5C", "#8A8A8A"];
const fit = (label: string, k: number): PlotFit => ({ label, points: [0, 1, 2, 3].map((x) => [x, k * x] as [number, number]), marker: { x: 1.5, y: 1.5 * k, label: `EC50 ${label}` } });
const table: DataTable = {
  id: "t", kind: "xy", name: "T",
  columns: [{ id: "x", name: "X" }, { id: "a", name: "A" }, { id: "b", name: "B" }],
  rows: [0, 1, 2, 3].map((x, i) => ({ id: `r${i}`, cells: { x, a: x, b: 2 * x } })),
};
const base: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "xy" };

describe("fitted curves follow the build's palette", () => {
  it("per-series fits take the palette colour of their position — the colour their points wear", () => {
    const s = buildPlotScene(table, { ...base, fits: [fit("A", 1), fit("B", 2)] }, { palette: GREYS });
    expect(s.fits!.map((f) => f.color)).toEqual(["#1A1A1A", "#5C5C5C"]);
    expect(s.series.map((x) => x.color)).toEqual(["#1A1A1A", "#5C5C5C"]); // the same colours
    expect(s.fits!.map((f) => f.marker?.color)).toEqual(["#1A1A1A", "#5C5C5C"]); // and the EC50 crosshair + label
  });
  it("the single fit takes the palette's second colour, standing apart from a single series", () => {
    const s = buildPlotScene(table, { ...base, fit: fit("A", 1) }, { palette: GREYS });
    expect(s.fit!.color).toBe("#5C5C5C");
  });
  it("no palette given → the default palette", () => {
    const s = buildPlotScene(table, { ...base, fits: [fit("A", 1), fit("B", 2)] });
    expect(s.fits!.map((f) => f.color)).toEqual(["#0072B2", "#E69F00"]);
  });
  it("an explicit fit colour still wins over the palette", () => {
    const s = buildPlotScene(table, { ...base, fits: [{ ...fit("A", 1), color: "#123456" }] }, { palette: GREYS });
    expect(s.fits![0]!.color).toBe("#123456");
  });
});
