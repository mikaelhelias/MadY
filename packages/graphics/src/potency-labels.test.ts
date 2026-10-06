/**
 * Potency labels ("EC50 = …") are routed when a figure has more than one fit.
 *
 * A single fit's label sits at a fixed offset above-right of its own crosshair; at that offset
 * two fits with nearby potencies would print touching labels. So with two or more fits every
 * label the user has not dragged goes through the shared placer (`placeLabelsClear`): clear of
 * both crosshairs, both curves, the marks, the parameter blocks and each other. Held here off
 * the built pixels:
 *   - two close potencies → two label boxes that do not overlap and do not cross the other
 *     fit's crosshair;
 *   - a dragged label stays where the user put it, and the free one clears it;
 *   - a single fit keeps the fixed offset (byte-identical scenes for every saved graph);
 *   - the anchor the router chose reaches the scene (the renderer reads it).
 */
import { describe, expect, it } from "vitest";
import type { DataTable, Plot, PlotFit } from "@mady/core";
import { buildPlotScene } from "./buildScene.js";
import { placedBox, segmentObstacles } from "./labelPlacement.js";
import type { LabelRect } from "./labelPlacement.js";
import type { PlotScene } from "./scene.js";

const measure = (t: string, px: number): number => t.length * px * 0.6;
const SIZE = { width: 620, height: 420, xScale: "log10" as const, yScale: "linear" as const, measure };

const fourPL = (x: number, b: number, t: number, e: number, h: number): number => b + (t - b) / (1 + Math.pow(e / x, h));
const grid = Array.from({ length: 60 }, (_, i) => Math.pow(10, -2 + (i * 5) / 59));
const fitFor = (name: string, e: number, h = 1.1, b = 4, t = 96): PlotFit => ({
  label: `${name} (4PL)`,
  points: grid.map((x) => [x, fourPL(x, b, t, e, h)] as [number, number]),
  params: [`EC_{50} = ${e} µM`, `Hill slope = ${h}`],
  marker: { x: e, y: (t + b) / 2, label: `EC50 = ${e} µM` },
});

const table: DataTable = {
  id: "t", kind: "xy", name: "T",
  columns: [{ id: "x", name: "Conc" }, { id: "a", name: "A" }, { id: "b", name: "B" }],
  rows: [0.01, 0.1, 1, 10, 100, 1000].map((x, i) => ({ id: `r${i}`, cells: { x, a: fourPL(x, 4, 96, 2.8, 1.1), b: fourPL(x, 4, 96, 4.1, 1.1) } })),
};
const plotWith = (fits: PlotFit[], extra: Partial<Plot> = {}): Plot => ({
  id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "xy",
  seriesStyles: { a: { plotAs: "points" }, b: { plotAs: "points" } },
  xAxis: { scale: "log10" }, fits, ...extra,
});

type Marker = NonNullable<NonNullable<PlotScene["fits"]>[number]["marker"]>;
/** The drawn box of a potency label: renderer baseline = labelY (+ drag), anchor as carried. */
const labelBox = (m: Marker, fontPx: number): LabelRect =>
  placedBox({ x: m.labelX + (m.labelOffset?.dx ?? 0), y: m.labelY + (m.labelOffset?.dy ?? 0) - fontPx * 0.34, anchor: m.labelAnchor ?? "start" }, m.label, fontPx, measure);
const overlaps = (a: LabelRect, b: LabelRect): boolean => a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;
const crosshair = (m: Marker): LabelRect[] => [...segmentObstacles(m.vx, m.cy, m.vx, m.baseY, 2), ...segmentObstacles(m.leftX, m.cy, m.vx, m.cy, 2)];

describe("potency labels — routed clear of each other", () => {
  it("two fits with close potencies: neither label touches the other, nor the other's crosshair", () => {
    const s = buildPlotScene(table, plotWith([fitFor("A", 2.8), fitFor("B", 4.1)]), SIZE);
    const ms = (s.fits ?? []).map((f) => f.marker!).filter(Boolean);
    expect(ms, "the fixture did not build two potency markers").toHaveLength(2);
    const fs = s.fonts.tick.size;
    const [a, b] = ms.map((m) => labelBox(m, fs)) as [LabelRect, LabelRect];
    // Guarding the guard: at the single-fit fixed offset these two boxes do overlap.
    const fixed = ms.map((m) => placedBox({ x: m.vx + 5, y: m.cy - 5 - fs * 0.34, anchor: "start" }, m.label, fs, measure)) as [LabelRect, LabelRect];
    expect(overlaps(fixed[0], fixed[1]), "the fixture cannot exhibit the defect — its fixed-offset labels do not touch").toBe(true);
    expect(overlaps(a, b), "the two potency labels overlap").toBe(false);
    for (const [box, other] of [[a, ms[1]!], [b, ms[0]!]] as const) {
      for (const seg of crosshair(other)) expect(overlaps(box, seg), "a potency label sits on the other fit's crosshair").toBe(false);
    }
    // Both stay inside the plot, so neither runs into an axis.
    for (const box of [a, b]) {
      expect(box.x1).toBeGreaterThanOrEqual(s.plot.x - 0.5);
      expect(box.x2).toBeLessThanOrEqual(s.plot.x + s.plot.width + 0.5);
    }
    expect(s.warnings.filter((w) => w.includes("potency"))).toEqual([]);
  });

  it("a label the user dragged stays put, and the free one clears it", () => {
    const dragged = { dx: -150, dy: -12 };
    const s = buildPlotScene(table, plotWith([fitFor("A", 2.8), fitFor("B", 4.1)], { fitsOffsets: { "0": { label: dragged } } }), SIZE);
    const [a, b] = (s.fits ?? []).map((f) => f.marker!) as [Marker, Marker];
    // Untouched: the fixed-offset anchor, the drag carried verbatim, no router anchor.
    expect(a.labelX).toBe(a.vx + 5);
    expect(a.labelY).toBe(a.cy - 5);
    expect(a.labelOffset).toEqual(dragged);
    expect(a.labelAnchor).toBeUndefined();
    const fs = s.fonts.tick.size;
    expect(overlaps(labelBox(a, fs), labelBox(b, fs))).toBe(false);
  });

  it("a single fit keeps the fixed offset — nothing saved changes", () => {
    const s = buildPlotScene(table, plotWith([fitFor("A", 2.8)]), SIZE);
    const m = s.fits![0]!.marker!;
    expect(m.labelX).toBe(m.vx + 5);
    expect(m.labelY).toBe(m.cy - 5);
    expect(m.labelAnchor).toBeUndefined();
    // …and so does the single `plot.fit` path, which the router never sees.
    const one = buildPlotScene(table, { ...plotWith([]), fits: undefined, fit: fitFor("A", 2.8) }, SIZE);
    expect(one.fit!.marker!.labelX).toBe(one.fit!.marker!.vx + 5);
  });

  it("the router's anchor reaches the scene when a label had to go left", () => {
    // Potency near the plot's right edge: right of the crosshair there is no room, so the
    // router must answer "end" and the renderer must be told.
    const s = buildPlotScene(table, plotWith([fitFor("A", 700), fitFor("B", 900)]), SIZE);
    const ms = (s.fits ?? []).map((f) => f.marker!);
    expect(ms).toHaveLength(2);
    expect(ms.some((m) => m.labelAnchor === "end"), "no label went left although the crosshairs sit at the right edge").toBe(true);
    const fs = s.fonts.tick.size;
    expect(overlaps(labelBox(ms[0]!, fs), labelBox(ms[1]!, fs))).toBe(false);
  });
});
