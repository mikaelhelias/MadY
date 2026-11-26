/**
 * A fitted curve is drawn on the Y axis of the series it fitted: a series on the right-hand axis (Y2 / Y3) has its
 * curve read on that scale, through its own points, not on the left axis. A curve fitted to a series the graph does
 * not draw (a bubble chart's size column) is not drawn, and the graph says so.
 */
import { describe, expect, it } from "vitest";
import type { DataTable, Plot, PlotFit } from "@mady/core";
import { buildPlotScene } from "./buildScene.js";

const xs = [1, 2, 3, 4, 5, 6];
// A on the left axis (0–10), C ten times larger (0–100) on the right one: the two scales differ.
const table: DataTable = {
  id: "t", kind: "xy", name: "T",
  columns: [{ id: "x", name: "X", role: "x" }, { id: "a", name: "A", role: "y" }, { id: "c", name: "C", role: "y" }],
  rows: xs.map((x, i) => ({ id: `r${i}`, cells: { x, a: x * 1.5, c: x * 15 } })),
};
const fitC = (extra: Partial<PlotFit> = {}): PlotFit => ({
  label: "Fit C", points: xs.map((x) => [x, x * 15] as [number, number]), marker: { x: 3, y: 45, label: "EC50 = 3" }, ...extra,
});
const plotOf = (extra: Partial<Plot>): Plot => ({ id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "xy", ...extra } as Plot);
const pathPts = (d: string) => [...d.matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
/** How far, in pixels, the curve runs from its own series' points (the largest gap at their X). */
function gapToPoints(scene: ReturnType<typeof buildPlotScene>, fitPath: string, seriesId: string): number {
  const pts = pathPts(fitPath);
  const marks = scene.series.find((s) => s.id === seriesId)!.marks;
  return Math.max(...marks.map((m) => Math.min(...pts.map(([x, y]) => Math.hypot(x! - m.cx, y! - m.cy)))));
}

describe("a fit on its series' own Y axis", () => {
  const onY2 = { seriesStyles: { c: { axis: "y2" as const } } };

  it("the fixture can show the fault: read on the left axis, C's curve misses its points by far", () => {
    const s = buildPlotScene(table, plotOf({ ...onY2, fits: [fitC()] }), { width: 600, height: 400 });
    expect(s.y2, "C is drawn on a right-hand axis").toBeTruthy();
    expect(gapToPoints(s, s.fits![0]!.path, "c")).toBeGreaterThan(40);
  });

  it("a fit that names its series is drawn on that series' axis, through its points", () => {
    const s = buildPlotScene(table, plotOf({ ...onY2, fits: [fitC({ series: "c" })] }), { width: 600, height: 400 });
    expect(gapToPoints(s, s.fits![0]!.path, "c")).toBeLessThan(2);
  });

  it("its crosshair's response line runs to the right-hand axis, the one it is read on", () => {
    const s = buildPlotScene(table, plotOf({ ...onY2, fits: [fitC({ series: "c" })] }), { width: 600, height: 400 });
    const m = s.fits![0]!.marker!;
    expect(m.leftX).toBeCloseTo(s.plot.x + s.plot.width);
    const cMark = s.series.find((q) => q.id === "c")!.marks[2]!; // x = 3, y = 45: the crosshair's point
    expect(Math.abs(m.cy - cMark.cy)).toBeLessThan(1);
  });

  it("a series on the left axis, and a fit saved without its series, stay on the left axis as before", () => {
    const left = buildPlotScene(table, plotOf({ fits: [fitC({ series: "c" })] }), { width: 600, height: 400 });
    expect(gapToPoints(left, left.fits![0]!.path, "c")).toBeLessThan(2);
    expect(left.fits![0]!.marker!.leftX).toBeCloseTo(left.plot.x);
  });
});

describe("a fit of a series the graph does not draw", () => {
  it("a bubble chart draws its first column; a fit of the size column is left out, and the graph says why", () => {
    const fitA: PlotFit = { label: "Fit A", series: "a", points: xs.map((x) => [x, x * 1.5] as [number, number]) };
    const s = buildPlotScene(table, plotOf({ kind: "bubble", fits: [fitA, fitC({ series: "c" })] }), { width: 600, height: 400 });
    expect(s.series.map((q) => q.id)).toEqual(["a"]);
    expect(s.fits!.map((f) => f.label)).toEqual(["Fit A"]);
    expect(s.warnings.some((w) => w.includes('fitted curve of "C" is not drawn'))).toBe(true);
  });

  it("a hidden series keeps its fit (hiding a series is not asking to drop its curve)", () => {
    const s = buildPlotScene(table, plotOf({ seriesStyles: { c: { hidden: true } }, fits: [fitC({ series: "c" })] }), { width: 600, height: 400 });
    expect(s.fits?.length).toBe(1);
  });
});
