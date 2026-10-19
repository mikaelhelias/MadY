// The colour bar of a graph coloured by a numeric column: its heading, size and drag offset are the
// plot's own settings, honoured by the scene — the same three things the heatmap's colour bar offers.
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene";

const table: DataTable = {
  id: "t",
  kind: "xy",
  name: "T",
  columns: [
    { id: "x", name: "X" },
    { id: "y", name: "Y" },
    { id: "z", name: "Dose" },
  ],
  rows: [1, 2, 3, 4, 5].map((i) => ({ id: `r${i}`, cells: { x: i, y: i * 10, z: i * 2.5 } })),
};
const base: Plot = {
  id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "xy",
  seriesStyles: { y: { colorFromColumn: "z", colorFromMode: "continuous" } },
};
const sceneOf = (extra: Partial<Plot> = {}) => buildPlotScene(table, { ...base, ...extra }, { width: 800, height: 500 });

// The heatmap's and the parallel plot's colour bars take the same size setting.
describe("the heatmap's and the parallel plot's colour bars take the same size setting", () => {
  const heatTable: DataTable = {
    id: "h", kind: "xy", name: "Heat",
    columns: [{ id: "g", name: "Gene" }, { id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }],
    rows: ["G1", "G2", "G3", "G4"].map((g, i) => ({ id: `r${i}`, cells: { g, a: i, b: i * 2, c: 5 - i } })),
  };
  const heat = (extra: Partial<Plot> = {}) =>
    buildPlotScene(heatTable, { id: "p", name: "P", source: "h", status: "ok", styleOverrides: {}, kind: "heatmap", ...extra }, { width: 800, height: 500 });

  it("heatmap: the bar is thicker, never longer than the plot, and still inside the figure with its numbers", () => {
    const one = heat();
    const two = heat({ colorbarScale: 2 });
    expect(one.heatmap!.bar.w).toBe(14);
    expect(two.heatmap!.bar.w).toBe(28);
    expect(two.heatmap!.bar.h).toBe(one.heatmap!.bar.h);
    // the numbers go to the bar's right: room for them is left in the figure
    expect(two.heatmap!.bar.x + two.heatmap!.bar.w + 24).toBeLessThan(two.width);
  });

  it("heatmap: a smaller bar is shorter and centred on the plot", () => {
    const one = heat();
    const half = heat({ colorbarScale: 0.5 });
    expect(half.heatmap!.bar.h).toBeCloseTo(one.heatmap!.bar.h / 2, 5);
    expect(half.heatmap!.bar.y).toBeCloseTo(one.heatmap!.bar.y + one.heatmap!.bar.h / 4, 5);
  });

  const parTable: DataTable = {
    id: "pc", kind: "xy", name: "Par",
    columns: [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }, { id: "s", name: "Score" }],
    rows: [1, 2, 3, 4, 5].map((i) => ({ id: `r${i}`, cells: { a: i, b: i * 3 % 5, c: 9 - i, s: i * 1.5 } })),
  };
  const par = (extra: Partial<Plot> = {}) =>
    buildPlotScene(parTable, { id: "p", name: "P", source: "pc", status: "ok", styleOverrides: {}, kind: "parallel", parallel: { colorColumn: "s", colorScale: "value" }, ...extra }, { width: 800, height: 500 });

  it("parallel: the bar keeps its own default thickness, and scales", () => {
    expect(par().colorbar!.bar.w).toBe(12);
    expect(par({ colorbarScale: 2 }).colorbar!.bar.w).toBe(24);
    expect(par({ colorbarScale: 0.5 }).colorbar!.bar.h).toBeCloseTo(par().colorbar!.bar.h / 2, 5);
  });
});

describe("colour bar of a graph coloured by a column", () => {
  it("is drawn at the default size with the column's name as its heading", () => {
    const s = sceneOf();
    expect(s.colorbar).toBeDefined();
    expect(s.colorbar!.title).toBe("Dose");
    expect(s.colorbar!.bar.w).toBe(14);
    expect(s.colorbar!.bar.h).toBeCloseTo(s.plot.height, 5);
  });

  it("takes the heading the user typed; a blank heading draws none", () => {
    expect(sceneOf({ colorbarTitle: "Dose (mg)" }).colorbar!.title).toBe("Dose (mg)");
    expect(sceneOf({ colorbarTitle: "Dose (mg)", colorbarShowTitle: false }).colorbar!.title).toBeUndefined();
  });

  it("scales: a smaller bar is thinner and shorter, centred on the plot", () => {
    const full = sceneOf();
    const small = sceneOf({ colorbarScale: 0.5 });
    expect(small.colorbar!.bar.w).toBe(7);
    expect(small.colorbar!.bar.h).toBeCloseTo(small.plot.height / 2, 5);
    expect(small.colorbar!.bar.y).toBeCloseTo(small.plot.y + small.plot.height / 4, 5);
    expect(full.colorbar!.bar.y).toBeCloseTo(full.plot.y, 5);
  });

  it("scales up: a larger bar is thicker, and the plot gives up the room it takes", () => {
    const full = sceneOf();
    const big = sceneOf({ colorbarScale: 2 });
    expect(big.colorbar!.bar.w).toBe(28);
    expect(big.plot.width).toBeLessThan(full.plot.width);
    // the bar still sits clear of the plot's right edge
    expect(big.colorbar!.bar.x).toBeGreaterThan(big.plot.x + big.plot.width);
  });

  it("carries its own drag offset, separate from the heatmap/size-legend offset", () => {
    const s = sceneOf({ colorByBarOffset: { dx: -40, dy: 25 }, colorbarOffset: { dx: 5, dy: 6 } });
    expect(s.colorbar!.offset).toEqual({ dx: -40, dy: 25 });
    expect(s.colorbarOffset).toEqual({ dx: 5, dy: 6 });
    expect(sceneOf().colorbar!.offset).toBeUndefined();
  });
});
