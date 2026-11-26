/**
 * A simple column bar draws one bar per column, pooling that column's replicates — the
 * same per-column summary box / violin / column-scatter show. The bar builder's categorical
 * path makes its categories from rows (see `buildCategoricalScene`), so a column table with
 * replicates entered down the rows would draw one bar per replicate value and cluster them
 * like a grouped chart. These guards pin the per-column shape and confirm a real grouped
 * table keeps its grouped shape.
 *
 * With `colMode` forced off in buildScene.ts, the first test sees 6 bars (3 rows × 2 series)
 * instead of 2, and the centres land on single replicate values.
 */
import { describe, it, expect } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene.js";

const mkPlot = (over: Partial<Plot> = {}): Plot => ({
  id: "p",
  name: "P",
  source: "t",
  status: "ok",
  styleOverrides: {},
  kind: "bar",
  ...over,
});

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

describe("simple Column bar — one bar per column, replicates pooled down the rows", () => {
  // Control / Treated, each a single Y column, replicates entered vertically (3 rows).
  const control = [20, 22, 24];
  const treated = [30, 33, 36];
  const table: DataTable = {
    id: "t",
    kind: "column",
    name: "T",
    columns: [
      { id: "g", name: "", role: "x" }, // the lead/labels column a Column sheet seeds — ignored here
      { id: "c", name: "Control", role: "y" },
      { id: "d", name: "Treated", role: "y" },
    ],
    rows: control.map((cv, i) => ({ id: `r${i}`, cells: { g: "", c: cv, d: treated[i]! } })),
  };

  const scene = buildPlotScene(table, mkPlot(), {});
  const bars = scene.series.flatMap((s) => s.marks.filter((m) => m.bar));

  it("draws exactly one bar per column (not one per replicate row)", () => {
    expect(bars.length).toBe(2);
    expect(scene.series.length).toBe(2); // each column stays its own series → per-column colour + click target
    expect(scene.series.every((s) => s.marks.filter((m) => m.bar).length === 1)).toBe(true);
  });

  it("each bar's height is the column's pooled mean", () => {
    const byName = new Map(scene.series.map((s) => [s.name, s.marks.find((m) => m.bar)!]));
    expect(byName.get("Control")!.dy).toBeCloseTo(mean(control), 6);
    expect(byName.get("Treated")!.dy).toBeCloseTo(mean(treated), 6);
  });

  it("the two bars sit in two distinct category bands", () => {
    const centres = bars.map((m) => m.cx).sort((a, b) => a - b);
    expect(centres[1]! - centres[0]!).toBeGreaterThan(1);
  });

  it("horizontal orientation pools per column too (separate code path)", () => {
    const h = buildPlotScene(table, mkPlot({ barOrientation: "horizontal" }), {});
    const hbars = h.series.flatMap((s) => s.marks.filter((m) => m.bar));
    expect(hbars.length).toBe(2);
    const byName = new Map(h.series.map((s) => [s.name, s.marks.find((m) => m.bar)!]));
    expect(byName.get("Control")!.dy).toBeCloseTo(mean(control), 6);
  });
});

describe("a grouped table bar takes its categories from the rows", () => {
  const table: DataTable = {
    id: "t",
    kind: "grouped",
    name: "T",
    columns: [
      { id: "x", name: "Timepoint", role: "x" },
      { id: "c", name: "Control", role: "y" },
      { id: "d", name: "Treated", role: "y" },
    ],
    rows: [
      { id: "r0", cells: { x: "Day 1", c: 20, d: 30 } },
      { id: "r1", cells: { x: "Day 2", c: 24, d: 41 } },
    ],
  };
  const scene = buildPlotScene(table, mkPlot(), {});
  it("2 rows × 2 series = 4 bars, banded by row", () => {
    const bars = scene.series.flatMap((s) => s.marks.filter((m) => m.bar));
    expect(bars.length).toBe(4);
  });
});
