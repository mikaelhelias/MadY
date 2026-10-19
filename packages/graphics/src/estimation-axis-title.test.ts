/**
 * The estimation plot's left axis holds both groups, so it takes no group's name as its title: with several groups every
 * other chart leaves the value-axis title blank (the scene's label reads "Value") and the reader or the Axis tab names
 * it. Over a plot of Batch 1 and Batch 2 it never reads "Batch 1". A title set by hand is kept, and a blank one gives
 * its band back to the plot.
 */
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene";

const table = (names: string[]): DataTable => ({
  id: "t", kind: "column", name: "t",
  columns: names.map((n, i) => ({ id: `c${i}`, name: n, role: "y" })),
  rows: Array.from({ length: 12 }, (_, r) => ({ id: `r${r}`, cells: Object.fromEntries(names.map((_n, i) => [`c${i}`, 10 + r * (i + 1) + i])) })),
} as unknown as DataTable);
const est = (names: string[], extra: Partial<Plot> = {}) =>
  buildPlotScene(table(names), { id: "p", name: "p", source: "t", status: "ok", styleOverrides: {}, kind: "estimation", ...extra } as unknown as Plot, { width: 640, height: 440 });

describe("estimation left-axis title", () => {
  it("two groups: not the first group's name — blank on the axis, 'Value' as the scene's label", () => {
    const s = est(["Batch 1", "Batch 2"]);
    expect(s.y.title).toBe("");
    expect(s.axisLabels.y).toBe("Value");
  });

  it("a title set by hand is kept", () => {
    const s = est(["Batch 1", "Batch 2"], { yAxis: { title: "Diameter (µm)" } } as Partial<Plot>);
    expect(s.y.title).toBe("Diameter (µm)");
    expect(s.axisLabels.y).toBe("Diameter (µm)");
  });

  it("a blank title gives its band back: the plot starts further left than with a title", () => {
    const blank = est(["Batch 1", "Batch 2"]);
    const titled = est(["Batch 1", "Batch 2"], { yAxis: { title: "Diameter (µm)" } } as Partial<Plot>);
    expect(blank.plot.x).toBeLessThan(titled.plot.x);
  });

  it("a single group still names the axis, as on every other chart", () => {
    expect(est(["Batch 1"]).y.title).toBe("Batch 1");
  });
});
