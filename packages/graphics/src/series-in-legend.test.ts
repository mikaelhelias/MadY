// "Show in legend" off for one series: that series keeps drawing and loses only its legend row.
//
// A graph that draws a fitted curve or a reference series next to the data often names only the data in its key.
// Every legend passes `resolveLegend`, so the rule holds on every kind; XY, bar and before-after (whose rows are
// subjects, keyed by row id) are checked here.
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene.js";
import type { PlotScene } from "./scene.js";

const SIZE = { width: 640, height: 420 };
const xy: DataTable = {
  id: "t", kind: "xy", name: "T",
  columns: [{ id: "x", name: "X" }, { id: "a", name: "Data A" }, { id: "b", name: "Data B" }, { id: "f", name: "Fit" }],
  rows: [0, 1, 2, 3, 4].map((x, i) => ({ id: `r${i}`, cells: { x, a: x * 2, b: x * 3, f: x * 2.5 } })),
};
const plotOf = (kind: Plot["kind"], over: Partial<Plot> = {}): Plot =>
  ({ id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind, ...over }) as Plot;
const build = (table: DataTable, plot: Plot): PlotScene => buildPlotScene(table, plot, SIZE);
const labels = (s: PlotScene) => s.legend.map((e) => e.label);

describe("a series can be left out of the legend", () => {
  it("the fixture's legend lists all three series, so a missing row means something", () => {
    expect(labels(build(xy, plotOf("xy")))).toEqual(["Data A", "Data B", "Fit"]);
  });

  it("off: the row goes, the series still draws", () => {
    const s = build(xy, plotOf("xy", { seriesStyles: { f: { inLegend: false } } }));
    expect(labels(s)).toEqual(["Data A", "Data B"]);
    const fit = s.series.find((x) => x.id === "f");
    expect(fit?.marks.length, "the series stopped drawing").toBe(5);
  });

  it("explicitly on is the same as unset", () => {
    expect(labels(build(xy, plotOf("xy", { seriesStyles: { f: { inLegend: true } } })))).toEqual(["Data A", "Data B", "Fit"]);
  });

  it("the legend takes only the room of the rows it draws", () => {
    const all = build(xy, plotOf("xy", { legend: { show: true, position: "right" } }));
    const fewer = build(xy, plotOf("xy", { legend: { show: true, position: "right" }, seriesStyles: { a: { inLegend: false }, b: { inLegend: false } } }));
    expect(labels(fewer)).toEqual(["Fit"]);
    // "Data A" / "Data B" are wider than "Fit": with them gone, the plot gets back the width they used.
    expect(fewer.plot.width).toBeGreaterThan(all.plot.width);
  });

  it("with the legend on its own (auto): leaving one of two series out keeps the other's row", () => {
    // The automatic legend appears for a graph of two or more series; taking one row out is not asking to lose the
    // legend, so the other series keeps its row.
    const two: DataTable = { ...xy, columns: xy.columns.slice(0, 3) };
    expect(labels(build(two, plotOf("xy")))).toEqual(["Data A", "Data B"]);
    expect(labels(build(two, plotOf("xy", { seriesStyles: { a: { inLegend: false } } })))).toEqual(["Data B"]);
  });

  it("a one-series graph still has no automatic legend", () => {
    const one: DataTable = { ...xy, columns: xy.columns.slice(0, 2) };
    expect(labels(build(one, plotOf("xy")))).toEqual([]);
  });

  it("every row off: no empty legend block is drawn", () => {
    const s = build(xy, plotOf("xy", { legend: { show: true }, seriesStyles: { a: { inLegend: false }, b: { inLegend: false }, f: { inLegend: false } } }));
    expect(s.legend).toEqual([]);
  });

  it("on a bar chart", () => {
    const col: DataTable = {
      id: "t", kind: "column", name: "C",
      columns: [{ id: "a", name: "A", role: "y" }, { id: "b", name: "B", role: "y" }, { id: "c", name: "C", role: "y" }],
      rows: [0, 1, 2].map((i) => ({ id: `r${i}`, cells: { a: 1 + i, b: 2 + i, c: 3 + i } })),
    };
    const shown = labels(build(col, plotOf("bar", { legend: { show: true } })));
    expect(shown).toContain("B");
    expect(labels(build(col, plotOf("bar", { legend: { show: true }, seriesStyles: { b: { inLegend: false } } })))).toEqual(shown.filter((l) => l !== "B"));
  });

  it("on before-after, where a row is a subject keyed by its row id", () => {
    const pre: DataTable = {
      id: "t", kind: "column", name: "P",
      columns: [{ id: "pre", name: "Pre", role: "y" }, { id: "post", name: "Post", role: "y" }],
      rows: [0, 1, 2].map((i) => ({ id: `s${i}`, cells: { pre: 1 + i, post: 2 + i } })),
    };
    const shown = labels(build(pre, plotOf("beforeafter", { legend: { show: true } })));
    expect(shown).toEqual(["Subject 1", "Subject 2", "Subject 3"]);
    expect(labels(build(pre, plotOf("beforeafter", { legend: { show: true }, seriesStyles: { s1: { inLegend: false } } })))).toEqual(["Subject 1", "Subject 3"]);
  });
});
