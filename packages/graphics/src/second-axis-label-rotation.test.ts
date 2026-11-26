// Rotated labels on the second and third value axes — the layout half (Y2 / Y3 / X2).
// The Axis tab offers "Label rotation" there, so the chart must draw the angle and make room for it: guards against
// sizing the right margin from the labels' flat width and the top band from one line of text.
//
// Labels are placed the way the renderer places them (`yTickLabelPlacement` on the right, `xTickLabelPlacement`
// along the top — the helpers are checked against SVG's own rotate arithmetic in `xTickLabel-sides.test.ts`), and
// their corners come from that arithmetic with ordinary glyph ratios (0.55 of the font per character, 0.8 above the
// baseline, 0.2 below), not the builder's measure.
//
// The fixtures must be able to show the fault. A turned single-digit number in a large font reaches further
// beside a right-hand axis than its flat width (at 90° it needs a line's thickness, 1.1× the font, against 0.55×);
// a turned three-digit number stands taller above a top axis than the one line the band was sized for.
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene.js";
import type { AxisScene, PlotScene } from "./scene.js";
import { xTickLabelPlacement, yTickLabelPlacement } from "./xTickLabel.js";

const FONT = 22;

// ---- fixtures ---------------------------------------------------------------------------------------------------
const xyTable: DataTable = {
  id: "t", kind: "xy", name: "T",
  columns: [{ id: "x", name: "X" }, { id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }],
  rows: [[1, 10, 2, 1], [2, 20, 4, 3], [3, 30, 8, 5]].map(([x, a, b, c], i) => ({ id: `r${i}`, cells: { x: x!, a: a!, b: b!, c: c! } })),
};
const barTable = (trend: number[]): DataTable => ({
  id: "t", kind: "column", name: "T",
  columns: [{ id: "g", name: "Group", role: "x" }, { id: "bar", name: "Sales", role: "y" }, { id: "line", name: "Trend", role: "y" }],
  rows: trend.map((line, i) => ({ id: `r${i}`, cells: { g: "ABC"[i]!, bar: [2, 6, 10][i]!, line } })),
});
const distTable = (h: number[]): DataTable =>
  ({
    id: "t", kind: "column", name: "T",
    columns: [{ id: "w", name: "Weight (g)", role: "y" }, { id: "h", name: "Height", role: "y" }],
    rows: [2, 4, 6, 8, 10].map((w, i) => ({ id: `r${i}`, cells: { w, h: h[i]! } })),
  }) as unknown as DataTable;
const estTable: DataTable = {
  id: "t", kind: "multivariable", name: "T",
  columns: [{ id: "ctrl", name: "Control" }, { id: "test", name: "Test" }],
  rows: [[10, 15], [12, 17], [11, 15], [13, 19], [10, 14], [12, 18]].map(([c, t], i) => ({ id: `r${i}`, cells: { ctrl: c!, test: t! } })),
};

type Case = { name: string; table: DataTable; plot: Partial<Plot>; axis: "y2" | "y3" };
const CASES: Case[] = [
  { name: "XY, Y2", table: xyTable, plot: { kind: "xy", seriesStyles: { b: { axis: "y2" } }, y2Axis: { title: "Beta" } }, axis: "y2" },
  { name: "XY, Y2 with a Y3 beside it", table: xyTable, plot: { kind: "xy", seriesStyles: { b: { axis: "y2" }, c: { axis: "y3" } }, y2Axis: { title: "Beta" }, y3Axis: { title: "Gamma" } }, axis: "y2" },
  { name: "XY, Y3 (outside Y2)", table: xyTable, plot: { kind: "xy", seriesStyles: { b: { axis: "y2" }, c: { axis: "y3" } }, y2Axis: { title: "Beta" }, y3Axis: { title: "Gamma" } }, axis: "y3" },
  { name: "estimation, the Difference axis", table: estTable, plot: { kind: "estimation" }, axis: "y2" },
  { name: "vertical bar, Y2", table: barTable([3, 5, 4]), plot: { kind: "bar", seriesStyles: { line: { plotAs: "line", axis: "y2" } }, y2Axis: { title: "Trend" } }, axis: "y2" },
  { name: "vertical box, Y2", table: distTable([3, 5, 6, 8, 9]), plot: { kind: "box", seriesStyles: { h: { axis: "y2" } }, y2Axis: { title: "Height" } }, axis: "y2" },
  { name: "horizontal bar, X2 along the top", table: barTable([300, 500, 400]), plot: { kind: "bar", barOrientation: "horizontal", seriesStyles: { line: { plotAs: "line", axis: "y2" } }, y2Axis: { title: "Trend" } }, axis: "y2" },
  { name: "horizontal box, X2 along the top", table: distTable([150, 165, 172, 181, 190]), plot: { kind: "box", barOrientation: "horizontal", seriesStyles: { h: { axis: "y2" } }, y2Axis: { title: "Height" } }, axis: "y2" },
];

const build = (c: Case, rotation: number): PlotScene => {
  const key = c.axis === "y2" ? "y2Axis" : "y3Axis";
  const plot = {
    id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, fonts: { tick: { size: FONT } }, ...c.plot,
    [key]: { ...(c.plot[key] ?? {}), tickRotation: rotation },
  } as Plot;
  return buildPlotScene(c.table, plot, { width: 720, height: 460 });
};
const axisOf = (s: PlotScene, c: Case): AxisScene => {
  const ax = c.axis === "y2" ? s.y2 : s.y3;
  if (!ax) throw new Error(`${c.name}: the fixture drew no ${c.axis} axis`);
  return ax;
};

type Pt = { x: number; y: number };
/** Where the renderer draws each label of the axis, as the four corners SVG's rotate() puts it at. */
function drawnLabels(s: PlotScene, c: Case): { label: string; pts: Pt[] }[] {
  const ax = axisOf(s, c);
  const rot = ax.tickRotation ?? 0;
  const font = (c.axis === "y2" ? s.fonts.y2Tick : s.fonts.y3Tick).size;
  const a = (rot * Math.PI) / 180;
  const len = (ax.tickLen ?? s.axisStyle.tickLen) + (ax.lineWidth ?? 1.25) / 2;
  const out = s.axisStyle.tickDir === "out" || s.axisStyle.tickDir === "both" ? len : 0;
  return ax.ticks.filter((t) => !t.minor && t.label !== "").map((t) => {
    const w = t.label.length * font * 0.55;
    const p = ax.side === "top"
      ? xTickLabelPlacement(t.pos, s.plot.y - out, font, s.axisGaps?.xTick ?? 6, rot, w, "top")
      : yTickLabelPlacement(t.pos, c.axis === "y3" ? ax.axisX! : s.plot.x + s.plot.width, font, s.axisGaps?.yTick ?? 8, rot, w, "right");
    const x0 = p.anchor === "start" ? p.x : p.anchor === "end" ? p.x - w : p.x - w / 2;
    const cx = p.pivot?.x ?? p.x;
    const cy = p.pivot?.y ?? p.y;
    const pts = [[x0, p.y - 0.8 * font], [x0 + w, p.y - 0.8 * font], [x0 + w, p.y + 0.2 * font], [x0, p.y + 0.2 * font]]
      .map(([x, y]) => ({ x: cx + (x! - cx) * Math.cos(a) - (y! - cy) * Math.sin(a), y: cy + (x! - cx) * Math.sin(a) + (y! - cy) * Math.cos(a) }));
    return { label: t.label, pts };
  });
}
const titleSize = (s: PlotScene, c: Case, ax: AxisScene): number =>
  c.axis === "y3" ? (s.fonts.y3AxisTitle ?? s.fonts.yAxisTitle).size : (s.fonts.y2AxisTitle ?? (ax.side === "top" ? s.fonts.xAxisTitle : s.fonts.yAxisTitle)).size;

describe.each(CASES)("$name: turned labels", (c) => {
  for (const rot of [45, 90, -45, -90]) {
    it(`${rot}°: every label is drawn beside its axis, on the figure, and the axis title clears every label`, () => {
      const s = build(c, rot);
      const ax = axisOf(s, c);
      expect(ax.tickRotation, `${rot}°: the chart did not keep the turn`).toBe(rot);
      const labels = drawnLabels(s, c);
      expect(labels.length, "the fixture's axis has too few labels to show anything").toBeGreaterThan(2);
      const pts = labels.flatMap((l) => l.pts.map((p) => ({ ...p, label: l.label })));
      for (const p of pts) {
        expect(p.x, `"${p.label}" runs off the left or right of the figure`).toBeGreaterThanOrEqual(-0.5);
        expect(p.x, `"${p.label}" runs off the right of the figure`).toBeLessThanOrEqual(s.width + 0.5);
        expect(p.y, `"${p.label}" runs off the top of the figure`).toBeGreaterThanOrEqual(-0.5);
        expect(p.y, `"${p.label}" runs off the bottom of the figure`).toBeLessThanOrEqual(s.height + 0.5);
      }
      const size = titleSize(s, c, ax);
      if (ax.side === "top") {
        for (const p of pts) expect(p.y, `"${p.label}" reaches down into the plot`).toBeLessThanOrEqual(s.plot.y + 0.5);
        expect(ax.titlePos, "no placed title").toBeTypeOf("number");
        const highest = Math.min(...pts.map((p) => p.y));
        // The title's baseline sits above the labels; its glyphs dip 0.2 of its size below it.
        expect(ax.titlePos! + 0.2 * size, `${rot}°: the X2 title sits on the labels`).toBeLessThanOrEqual(highest + 0.5);
      } else {
        const edge = c.axis === "y3" ? ax.axisX! : s.plot.x + s.plot.width;
        for (const p of pts) expect(p.x, `"${p.label}" reaches across its axis into the plot`).toBeGreaterThanOrEqual(edge - 0.5);
        expect(ax.titleX, "no placed title").toBeTypeOf("number");
        const rightmost = Math.max(...pts.map((p) => p.x));
        // The title is drawn turned 90° about titleX: its glyphs reach 0.2 of its size to the left, toward the labels.
        expect(ax.titleX! - 0.2 * size, `${rot}°: the ${c.axis.toUpperCase()} title sits on the labels`).toBeGreaterThanOrEqual(rightmost - 0.5);
        if (c.axis === "y2" && s.y3) {
          expect(rightmost, `${rot}°: a Y2 label reaches the Y3 axis`).toBeLessThanOrEqual(s.y3.axisX! + 0.5);
          expect(ax.titleX! + 0.8 * size, `${rot}°: the Y2 title reaches the Y3 axis`).toBeLessThanOrEqual(s.y3.axisX! + 0.5);
        }
      }
    });
  }
});
