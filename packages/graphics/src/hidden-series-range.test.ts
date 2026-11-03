/**
 * A hidden series is not drawn, so it does not size the axes.
 *
 * With a series that runs 22–28 hidden next to one that runs 1.2–1.5, the Y axis fits the drawn
 * series rather than 0–30, which would squash it into a flat line at the bottom. A hidden series is kept only to feed
 * the spread band; when a band is shown it sizes the axes through the band itself.
 */
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene";

const table = {
  id: "t", kind: "xy", name: "Coffee",
  columns: [
    { id: "x", name: "Brew time (s)", role: "x" },
    { id: "tds", name: "TDS (%)", role: "y" },
    { id: "ey", name: "Extraction yield (%)", role: "y" },
  ],
  rows: [20, 24, 28, 32, 36, 40, 44].map((x, i) => ({ id: `r${i}`, cells: { x, tds: 1.2 + 0.05 * i, ey: 22 + i } })),
} as unknown as DataTable;
const plot = (over: Partial<Plot> = {}): Plot => ({ id: "p", name: "P", source: "t", kind: "xy", ...over }) as Plot;
const yDomain = (p: Plot) => buildPlotScene(table, p, { width: 600, height: 400 }).y.domain;
const hideEy = { seriesStyles: { ey: { hidden: true } } } as Partial<Plot>;

describe("the axes follow the series that are drawn", () => {
  it("with the 22–28 series hidden, the Y axis fits the 1.2–1.5 series", () => {
    const [lo, hi] = yDomain(plot(hideEy));
    expect(hi, "the hidden series still stretches the axis").toBeLessThan(2);
    expect(lo).toBeGreaterThanOrEqual(0);
  });

  it("both shown: the axis covers both", () => {
    expect(yDomain(plot())[1]).toBeGreaterThanOrEqual(28);
  });

  it("a hidden series on the right axis does not size it either", () => {
    const s = buildPlotScene(table, plot({ seriesStyles: { ey: { axis: "y2", hidden: true }, tds: { axis: "y2" } } }), { width: 600, height: 400 });
    expect(s.y2!.domain[1]).toBeLessThan(2);
  });

  it("with a spread band shown, the band (which the hidden series feeds) still fits", () => {
    const [, hi] = yDomain(plot({ ...hideEy, spread: { mode: "range" } }));
    expect(hi).toBeGreaterThanOrEqual(28);
  });

  it("a small graph (the other series hidden by the split) keeps its original's range, so the panels compare", () => {
    const [, hi] = yDomain(plot({ ...hideEy, splitFrom: { plot: "orig", series: "tds" } }));
    expect(hi).toBeGreaterThanOrEqual(28);
  });

  it("every series hidden: the axes keep the data's range instead of collapsing", () => {
    const [lo, hi] = yDomain(plot({ seriesStyles: { ey: { hidden: true }, tds: { hidden: true } } }));
    expect(hi - lo).toBeGreaterThan(20);
  });
});
