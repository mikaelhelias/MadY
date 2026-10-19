/**
 * "Show values" on a bar series drawn as points.
 *
 * With `showValues: true` and `plotAs: "points"` (as on the "Ranked dots vs a reference" gallery
 * card), the value label cannot be drawn from the bar's rectangle, because the points conversion
 * deletes that rectangle; without handling, the option would be accepted and silently dropped
 * (a silent no-op, which this project counts as a defect). Each point mark therefore carries the
 * value as its point label, the same field the XY path uses, so the renderer's point-label branch
 * draws it.
 */
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene";

const table: DataTable = {
  id: "t", kind: "xy", name: "t",
  columns: [{ id: "x", name: "Player", role: "x" }, { id: "v", name: "FT (%)", role: "y" }],
  rows: ([["A", 95], ["B", 78.5], ["C", 47]] as Array<[string, number]>).map(([x, v], i) => ({ id: `r${i}`, cells: { x, v } })),
};
const plot = (patch: Partial<Plot>): Plot => ({ id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "bar", ...patch });
const SIZE = { width: 600, height: 400 };

describe("bar series drawn as points, with Show values on", () => {
  for (const barOrientation of ["vertical", "horizontal"] as const) {
    it(`${barOrientation}: every dot carries its value as a point label`, () => {
      const s = buildPlotScene(table, plot({ barOrientation, showValues: true, showBarPoints: false, seriesStyles: { v: { plotAs: "points" } } }), SIZE);
      const marks = s.series[0]!.marks;
      expect(marks.every((m) => m.bar === undefined), "still bars").toBe(true);
      expect(marks.map((m) => m.pointLabel)).toEqual(["95", "78.5", "47"]);
      expect(s.warnings).toEqual([]);
    });
  }

  it("with Show values off, the dots carry no label", () => {
    const s = buildPlotScene(table, plot({ showBarPoints: false, seriesStyles: { v: { plotAs: "points" } } }), SIZE);
    expect(s.series[0]!.marks.every((m) => !m.pointLabel)).toBe(true);
  });

  it("plain bars are untouched: the value label stays the bar's own, not a point label", () => {
    const s = buildPlotScene(table, plot({ showValues: true }), SIZE);
    expect(s.valueLabels?.show).toBe(true);
    expect(s.series[0]!.marks.every((m) => m.bar !== undefined && !m.pointLabel)).toBe(true);
  });
});

describe("a per-point pointColor override on a bar series drawn as points", () => {
  it("reaches the mark as its own dot colour, and only that field", () => {
    const s = buildPlotScene(
      table,
      plot({ showBarPoints: false, seriesStyles: { v: { plotAs: "points" } }, pointStyles: { "v:r0": { pointColor: "#1a9e5c" }, "v:r2": { pointColor: "#d0342c" } } }),
      SIZE,
    );
    expect(s.series[0]!.marks.map((m) => m.pointColor)).toEqual(["#1a9e5c", undefined, "#d0342c"]);
  });
  it("a per-point fill or colour alone sets no dot colour — a swarm is not recoloured by those", () => {
    const s = buildPlotScene(
      table,
      plot({ showBarPoints: false, seriesStyles: { v: { plotAs: "points" } }, pointStyles: { "v:r0": { fillColor: "#ff0000" }, "v:r1": { color: "#00ff00" } } }),
      SIZE,
    );
    expect(s.series[0]!.marks.every((m) => m.pointColor === undefined)).toBe(true);
  });
});
