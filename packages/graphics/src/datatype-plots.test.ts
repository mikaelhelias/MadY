/**
 * Per-format plot validation — for each MadY table format, build a synthetic
 * dataset, render its appropriate graph through the real `buildPlotScene`, and
 * assert the scene is a correct representation of the data (right number of
 * categories / series / marks / slices, values in the right place). The numeric
 * analyses are validated separately against scipy/statsmodels
 * (`engines/py/validate_datatypes.py` + `engine.test.ts`).
 */
import { describe, it, expect } from "vitest";
import { MadyDocument } from "@mady/core";
import type { PlotKind, TableKind, CellValue } from "@mady/core";
import { buildPlotScene } from "./buildScene.js";

/** Build a one-table, one-plot doc of a given format + graph kind, return the scene. */
function scene(kind: TableKind, columns: string[], rows: CellValue[][], plotKind: PlotKind) {
  const doc = new MadyDocument();
  const t = doc.addTable("T", kind, columns);
  for (const r of rows) doc.addRow(t.id, r);
  const p = doc.addPlot("P", t.id);
  doc.setPlotKind(p.id, plotKind);
  const json = doc.toJSON();
  const table = json.tables.find((x) => x.id === t.id)!;
  const plot = json.plots.find((x) => x.id === p.id)!;
  return buildPlotScene(table, plot, { xScale: "linear", yScale: "linear" });
}

describe("each table format plots a correct representation", () => {
  it("XY → line/scatter: one series, one mark per (x,y) point", () => {
    const rows = [1, 2, 3, 4, 5, 6, 7, 8].map((x) => [x, 2 * x + 1]);
    const s = scene("xy", ["X", "Y"], rows, "xy");
    expect(s.series).toHaveLength(1);
    expect(s.series[0]!.marks).toHaveLength(8);
    // y = 2x+1 is monotonically increasing → mark cy strictly decreases (pixel y grows downward).
    const cys = s.series[0]!.marks.map((m) => m.cy);
    expect(cys.every((v, i) => i === 0 || v < cys[i - 1]!)).toBe(true);
  });

  it("Column → box: one box per group column (leading label excluded)", () => {
    // 3 groups as columns, replicate values down the rows + a leading label column.
    const rows = [
      ["r1", 2, 4, 6], ["r2", 3, 5, 7], ["r3", 4, 6, 8], ["r4", 5, 7, 9], ["r5", 6, 8, 10],
    ];
    const s = scene("column", ["", "Ctrl", "A", "B"], rows, "box");
    // One distribution glyph (series, 1 box mark each) per group — the 3 value
    // columns, not the leading label column.
    expect(s.series).toHaveLength(3);
    expect(s.series.map((ser) => ser.marks.length)).toEqual([1, 1, 1]);
  });

  it("Grouped → grouped bars: 2 series (factor B) × 2 categories (factor A)", () => {
    // rows = factor-A levels (Low/High); 2 datasets = factor-B levels (Ctrl/Drug).
    const rows = [
      ["Low", 10, 12], ["High", 20, 24],
    ];
    const s = scene("grouped", ["", "Ctrl", "Drug"], rows, "bar");
    expect(s.series).toHaveLength(2);                       // Ctrl + Drug
    expect(s.series[0]!.marks).toHaveLength(2);             // Low + High categories
    expect(s.legend.map((l) => l.label)).toEqual(["Ctrl", "Drug"]); // bars label the legend
    // High/Ctrl (20) bar is taller than Low/Ctrl (10): smaller cy (further up).
    const ctrl = s.series[0]!.marks;
    expect(ctrl[1]!.cy).toBeLessThan(ctrl[0]!.cy);
  });

  it("Contingency → count bars: one series per outcome column, one mark per row category, counts as heights", () => {
    const rows = [
      ["Exposed", 30, 10], ["Unexposed", 15, 45],
    ];
    const s = scene("contingency", ["", "Disease", "Healthy"], rows, "bar");
    expect(s.series).toHaveLength(2);                       // Disease + Healthy
    expect(s.series.map((ser) => ser.name)).toEqual(["Disease", "Healthy"]);
    expect(s.series[0]!.marks).toHaveLength(2);             // 2 row categories
    // mark.dy per (series, category) = the source counts (not just the count of marks)
    expect(s.series[0]!.marks.map((m) => m.dy)).toEqual([30, 15]); // Disease: Exposed 30, Unexposed 15
    expect(s.series[1]!.marks.map((m) => m.dy)).toEqual([10, 45]); // Healthy: Exposed 10, Unexposed 45
    // category labels come from the leading row column
    expect(s.series[0]!.marks.map((m) => m.label)).toEqual(["Exposed", "Unexposed"]);
  });

  it("Survival → Kaplan-Meier: one step curve per group (analysis-driven)", () => {
    // The KM graph plots the curves the survival analysis computes (validated vs
    // statsmodels in validate_datatypes.py), not the raw event table. Inject the
    // computed curves the way the analysis does and confirm both render as steps.
    const doc = new MadyDocument();
    const t = doc.addTable("T", "survival", ["Time", "Group A", "Group B"]);
    doc.addRow(t.id, [6, 1, 1]);
    const p = doc.addPlot("P", t.id);
    doc.setPlotKind(p.id, "survival");
    const json = doc.toJSON();
    const table = json.tables.find((x) => x.id === t.id)!;
    const plot = {
      ...json.plots.find((x) => x.id === p.id)!,
      survival: [
        { label: "A", times: [0, 6, 10, 15], surv: [1, 0.8, 0.6, 0.4] },
        { label: "B", times: [0, 3, 5, 9], surv: [1, 0.7, 0.5, 0.2] },
      ],
    };
    const s = buildPlotScene(table, plot, { xScale: "linear", yScale: "linear" });
    expect(s.series).toHaveLength(2);                       // one KM curve per group
    // KM curves render as a stepped line path (not point marks).
    expect(s.series[0]!.linePath.length).toBeGreaterThan(0);
    expect(s.series[1]!.linePath.length).toBeGreaterThan(0);
    // survival fraction stays within [0,1] on the Y axis.
    expect(s.y.domain[0]).toBeGreaterThanOrEqual(0);
    expect(s.y.domain[1]).toBeLessThanOrEqual(1.001);
  });

  it("Parts of whole → pie: one slice per row, fractions match the data", () => {
    const rows = [["Alpha", 30], ["Beta", 50], ["Gamma", 20]];
    const s = scene("partsofwhole", ["Slice", "Sample"], rows, "pie");
    expect(s.pie).toBeTruthy();
    expect(s.pie!.slices).toHaveLength(3);                  // one slice per ROW
    expect(s.pie!.slices.map((sl) => sl.label)).toEqual(["Alpha", "Beta", "Gamma"]);
    // fractions: 30/100, 50/100, 20/100 → sum to 1, Beta is the half.
    const fr = s.pie!.slices.map((sl) => sl.fraction);
    expect(fr.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    expect(fr[1]).toBeCloseTo(0.5, 6);                      // Beta = 50%
    expect(fr[0]).toBeCloseTo(0.3, 6);                      // Alpha = 30%
  });

  it("Multiple variables → scatter builds without error (no lead X column)", () => {
    const rows = [
      [1, 2, 8], [2, 1, 6], [3, 4, 5], [4, 3, 9], [5, 6, 4],
    ];
    const s = scene("multivariable", ["x1", "x2", "y"], rows, "scatter");
    // Every column is a variable; the scene paints marks (one or more series).
    expect(s.series.length).toBeGreaterThanOrEqual(1);
    expect(s.series.reduce((n, ser) => n + ser.marks.length, 0)).toBeGreaterThan(0);
  });

  it("Nested → box: one glyph per nested group", () => {
    const rows = [
      ["s1", 10, 20], ["s2", 11, 22], ["s3", 9, 19], ["s4", 12, 21],
    ];
    const s = scene("nested", ["", "Group A", "Group B"], rows, "box");
    expect(s.series).toHaveLength(2);                       // one box per nested group
    expect(s.series.map((ser) => ser.marks.length)).toEqual([1, 1]);
  });
});
