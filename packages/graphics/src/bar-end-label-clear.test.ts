/**
 * A horizontal bar's number rests just past the bar's end. A bar that ends at the plot's right edge (every 100 %
 * stacked row, or the longest bar on an axis that stops at its value) puts that number past the edge — into the
 * space the right-hand legend is drawn in. The figure moves the legend right by the overhang, so the numbers and the legend never share space.
 */
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene";
import { fmtValueLabel, valueLabelPlace } from "./valueLabelPlace";

const measure = (t: string, s: number): number => t.length * s * 0.6;

function survey(extra: Partial<Plot> = {}, rows: number[][] = [[4, 9, 18, 41, 28], [7, 15, 22, 36, 20], [12, 21, 30, 25, 12], [3, 6, 14, 38, 39]]) {
  const ids = ["a", "b", "c", "d", "e"];
  const names = ["Strongly disagree", "Disagree", "Neutral", "Agree", "Strongly agree"];
  const table = {
    id: "t", kind: "grouped", name: "t",
    columns: [{ id: "x", name: "Statement", role: "x" }, ...ids.map((id, i) => ({ id, name: names[i], role: "y" }))],
    rows: rows.map((r, i) => ({ id: `r${i}`, cells: { x: `Statement ${i + 1}`, ...Object.fromEntries(ids.map((id, k) => [id, r[k]])) } })),
  } as unknown as DataTable;
  const plot = { id: "p", name: "p", source: "t", status: "ok", styleOverrides: {}, kind: "bar", barOrientation: "horizontal", barLayout: "stacked", showValues: true, ...extra } as unknown as Plot;
  return buildPlotScene(table, plot, { width: 640, height: 440, measure });
}

/** Right end of every value number as the renderer places it, and the left edge of the legend box. */
function reaches(s: ReturnType<typeof survey>) {
  const size = s.fonts.valueLabel.size;
  const right = s.series.flatMap((ser) => ser.marks.filter((m) => m.bar && m.valueText !== "").map((m) => {
    const text = m.valueText ?? fmtValueLabel(m.dy, s.valueLabels?.decimals);
    const p = valueLabelPlace(s, m.bar!, m.dy, text, undefined);
    return p.baseX + measure(text, size);
  }));
  const legendLeft = s.plot.x + s.plot.width + (s.legendLayout.gap ?? 12) + (s.legendLayout.outsidePad ?? 0) - 4;
  return { maxRight: Math.max(...right), legendLeft };
}

describe("bar-end numbers stay clear of the right-hand legend", () => {
  it("100 % stacked rows: the last number ends before the legend box starts", () => {
    const r = reaches(survey());
    expect(r.maxRight, `last number ends at ${r.maxRight.toFixed(1)}, legend starts at ${r.legendLeft.toFixed(1)}`).toBeLessThanOrEqual(r.legendLeft);
  });

  it("the room is made by moving the legend, not by drawing it over the figure's edge", () => {
    const s = survey();
    expect(s.legendLayout.outsidePad ?? 0, "legend was not moved").toBeGreaterThan(0);
    const noValues = survey({ showValues: false });
    expect(s.plot.width, "the plot did not give up the room").toBeLessThan(noValues.plot.width);
    expect(s.width, "the figure width must not change").toBe(noValues.width);
  });

  it("bars that stop short of the edge ask for nothing: same plot, legend where it was", () => {
    const short = survey({}, [[3, 4, 5, 6, 5], [2, 2, 2, 2, 2]]);
    const base = survey({ showValues: false }, [[3, 4, 5, 6, 5], [2, 2, 2, 2, 2]]);
    const r = reaches(short);
    expect(r.maxRight, "the numbers already clear the legend — the fixture proves nothing about the unchanged case").toBeLessThanOrEqual(r.legendLeft);
    expect(short.plot.width).toBe(base.plot.width);
    expect(short.legendLayout.outsidePad ?? 0).toBe(0);
  });

  it("with no legend there is nothing to clear: the plot keeps its width", () => {
    const s = survey({ legend: { show: false } } as Partial<Plot>);
    const base = survey({ showValues: false, legend: { show: false } } as Partial<Plot>);
    expect(s.plot.width).toBe(base.plot.width);
  });

  it("numbers inside the bars (inside end) reach nothing past the edge: nothing is reserved", () => {
    const s = survey({ valuePlacement: "insideEnd" } as Partial<Plot>);
    const base = survey({ showValues: false });
    expect(s.plot.width).toBe(base.plot.width);
  });

  it("single-series horizontal bars to the axis end are cleared too", () => {
    const s = survey({ barLayout: "grouped" } as Partial<Plot>, [[10, 20, 30, 40, 100]]);
    const r = reaches(s);
    expect(r.maxRight).toBeLessThanOrEqual(r.legendLeft);
  });
});
