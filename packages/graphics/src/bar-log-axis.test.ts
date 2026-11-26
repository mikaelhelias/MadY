// Bars and histograms on a log Y axis: the bars rise from the bottom of the axis (a log axis has no 0), a bar of 0 or
// less is left out and counted in a warning, an error end at or below 0 stops at the axis, and stacked bars keep a
// linear axis and say why.
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene.js";
import type { PlotScene } from "./scene.js";

const SIZE = { width: 500, height: 360 };
const table = (vals: number[]): DataTable => ({
  id: "t", kind: "column", name: "T",
  columns: [{ id: "lab", name: "Name", role: "x" }, { id: "v", name: "Value", role: "y" }],
  rows: vals.map((v, i) => ({ id: `r${i}`, cells: { lab: `c${i}`, v } })),
});
const bar = (over: Partial<Plot> = {}): Plot => ({ id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "bar", yAxis: { scale: "log10" }, ...over }) as Plot;
const bars = (s: PlotScene) => s.series[0]!.marks.filter((m) => m.bar && Number.isFinite(m.cy));
const linearWarning = (s: PlotScene) => s.warnings.some((w) => /linear Y axis/.test(w));

describe("vertical bars on a log Y axis", () => {
  it("the axis stays log and every bar rises from the axis bottom", () => {
    const s = buildPlotScene(table([1, 10, 100]), bar(), SIZE);
    expect(s.y.type).toBe("log10");
    expect(linearWarning(s)).toBe(false);
    const bottom = s.plot.y + s.plot.height;
    for (const m of bars(s)) expect(m.bar!.y + m.bar!.h).toBeCloseTo(bottom, 6);
  });

  it("heights follow the log scale: 10 sits halfway between 1 and 100", () => {
    const s = buildPlotScene(table([1, 10, 100]), bar({ yAxis: { scale: "log10", min: 1, max: 100 } }), SIZE);
    const [a, b, c] = bars(s).map((m) => m.cy);
    expect(b!).toBeCloseTo((a! + c!) / 2, 6);
  });

  it("the smallest bar has a height: the automatic axis bottom sits at the power of the base below it", () => {
    // Counts within one decade (a histogram's 2…11): the range the axis would fit starts at the smallest bar itself.
    const s = buildPlotScene(table([2, 5, 11]), bar(), SIZE);
    expect(s.y.domain[0]).toBeCloseTo(1, 9);
    for (const m of bars(s)) expect(m.bar!.h).toBeGreaterThan(5);
    const two = buildPlotScene(table([0.5, 3, 8]), bar({ yAxis: { scale: "log2" } }), SIZE);
    expect(two.y.domain[0]).toBeCloseTo(0.25, 9);
    // A value that is itself a power of the base still gets a bar: the bottom is the power below it.
    expect(buildPlotScene(table([10, 50]), bar(), SIZE).y.domain[0]).toBeCloseTo(1, 9);
  });

  it("a minimum the user sets is kept as it is", () => {
    const s = buildPlotScene(table([2, 10, 100]), bar({ yAxis: { scale: "log10", min: 2 } }), SIZE);
    expect(s.y.domain[0]).toBeCloseTo(2, 9);
  });

  it("a bar of 0 is left out and counted", () => {
    const s = buildPlotScene(table([0, 10, 100]), bar(), SIZE);
    expect(bars(s).length).toBe(2);
    expect(s.warnings.some((w) => /1 bar of 0 or less is left out/.test(w))).toBe(true);
  });

  it("a bar below the axis start (a set minimum) is not drawn as a line along the bottom", () => {
    const s = buildPlotScene(table([0.001, 10, 100]), bar({ yAxis: { scale: "log10", min: 0.01, max: 100 } }), SIZE);
    expect(bars(s).map((m) => m.dy)).toEqual([10, 100]);
  });

  it("an error bar reaching below 0 stops at the axis bottom", () => {
    const t: DataTable = {
      id: "t", kind: "column", name: "T",
      columns: [{ id: "lab", name: "Name", role: "x" }, { id: "v", name: "Value", role: "y" }, { id: "e", name: "SD", role: "sd", group: "v" }],
      rows: [{ id: "r0", cells: { lab: "a", v: 2, e: 5 } }, { id: "r1", cells: { lab: "b", v: 50, e: 5 } }],
    };
    const s = buildPlotScene(t, bar({ seriesStyles: { v: { errorBars: "sd" } } }), SIZE);
    const m = bars(s)[0]!;
    expect(m.errLowCy).toBeCloseTo(s.plot.y + s.plot.height, 6);
  });

  it("stacked bars keep a linear axis and say why", () => {
    const s = buildPlotScene(table([1, 10, 100]), bar({ barLayout: "stacked" }), SIZE);
    expect(s.y.type).toBe("linear");
    expect(s.warnings.some((w) => /Stacked bars use a linear Y axis/.test(w))).toBe(true);
  });
});

it("horizontal bars on a log axis start at the axis start", () => {
  const s = buildPlotScene(table([1, 10, 100]), bar({ barOrientation: "horizontal" }), SIZE);
  expect(linearWarning(s)).toBe(false);
  for (const m of bars(s)) expect(m.bar!.x).toBeCloseTo(s.plot.x, 6);
});

describe("a histogram on a log Y axis", () => {
  const values = [...Array.from({ length: 990 }, () => 0.99), ...Array.from({ length: 10 }, (_, i) => i / 100)];
  const t: DataTable = { id: "t", kind: "column", name: "T", columns: [{ id: "v", name: "Score", role: "y" }], rows: values.map((v, i) => ({ id: `r${i}`, cells: { v } })) };
  const hist = (over: Partial<Plot> = {}): Plot => ({ id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "histogram", histogram: { bins: 20, freq: "percent" }, yAxis: { scale: "log10" }, ...over }) as Plot;

  it("keeps the log axis; the small bins stay visible from the axis bottom, empty bins are left blank", () => {
    const s = buildPlotScene(t, hist(), SIZE);
    expect(s.y.type).toBe("log10");
    const drawn = bars(s);
    const bottom = s.plot.y + s.plot.height;
    for (const m of drawn) expect(m.bar!.y + m.bar!.h).toBeCloseTo(bottom, 6);
    // The 0.1% bins have a bar of real height (on a linear axis next to a 99% bin they would be about 0).
    const small = drawn.filter((m) => m.dy > 0 && m.dy < 1);
    expect(small.length).toBeGreaterThan(0);
    for (const m of small) expect(m.bar!.h).toBeGreaterThan(5);
  });

  it("the normal curve is refused out loud on a log axis, not drawn in the wrong place", () => {
    const s = buildPlotScene(t, hist({ histogram: { bins: 20, freq: "percent", normalCurve: true } }), SIZE);
    expect(s.distributionCurves ?? []).toEqual([]);
    expect(s.warnings.some((w) => /curves are drawn on a linear Y axis only/.test(w))).toBe(true);
  });
});
