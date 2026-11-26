/**
 * Two analyses of one sheet draw on one graph: the first curve is `Plot.fit`, the second a `Plot.fits` entry.
 * Their potency labels and parameter blocks are placed together, so no label prints on another label, and no
 * block prints on a curve, a data point, a crosshair or another block when a clear corner exists.
 */
import { describe, expect, it } from "vitest";
import type { DataTable, Plot, PlotFit } from "@mady/core";
import { buildPlotScene } from "./buildScene.js";
import { fitBlockBox } from "./fitBlockPlace.js";
import { placedBox, placeLabelsClear } from "./labelPlacement.js";
import type { LabelRect } from "./labelPlacement.js";
import type { PlotScene } from "./scene.js";

// The width the app's own font gives these lines: a 27-character parameter line at 12 px draws about 134 px wide.
const measure = (t: string, px: number): number => t.length * px * 0.42;
const SIZE = { width: 580, height: 380, measure };

const fourPL = (x: number, e: number): number => 3 + 97 / (1 + e / x);
const doses = [1, 3, 10, 30, 100, 300, 1000, 3000, 10000];
const grid = Array.from({ length: 80 }, (_, i) => Math.pow(10, (i * 4) / 79));
const fitFor = (e: number): PlotFit => ({
  label: "Dose-response (4PL, variable slope)",
  points: grid.map((x) => [x, fourPL(x, e)] as [number, number]),
  params: ["Bottom = 3.17 ± 0.399", "Top = 100 ± 0.941", "logEC_{50} = 2.67 ± 0.0139", "Hill slope = 0.952 ± 0.0251", `EC_{50} = ${e}`, "R² = 0.9998"],
  marker: { x: e, y: 51.5, label: `EC50 = ${e}` },
});
const table: DataTable = {
  id: "t", kind: "xy", name: "T",
  columns: [{ id: "x", name: "Dose" }, { id: "a", name: "A" }, { id: "b", name: "B" }],
  rows: doses.map((x, i) => ({ id: `r${i}`, cells: { x, a: fourPL(x, 52), b: fourPL(x, 468) } })),
};
// The full blocks are asked for (Fit parameters > Show all): with several fits a graph otherwise shows only each
// fit's key result, and these tests are about where whole blocks go.
const plotOf = (extra: Partial<Plot> = {}, second = 468): Plot => ({
  id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "xy", xAxis: { scale: "log10" },
  fit: { ...fitFor(52), analysisSource: "an1" }, fits: [{ ...fitFor(second), analysisSource: "an2" }], ...extra,
  fitParams: { show: true, ...(extra.fitParams ?? {}) },
});

type Fit = NonNullable<PlotScene["fit"]>;
type Marker = NonNullable<Fit["marker"]>;
const labelBox = (m: Marker, fontPx: number): LabelRect =>
  placedBox({ x: m.labelX + (m.labelOffset?.dx ?? 0), y: m.labelY + (m.labelOffset?.dy ?? 0) - fontPx * 0.34, anchor: m.labelAnchor ?? "start" }, m.label, fontPx, measure);
const blockBox = (f: Fit): LabelRect => {
  const p = f.params!;
  return fitBlockBox(p.lines, p.size, p.x + (p.offset?.dx ?? 0), p.y + (p.offset?.dy ?? 0), p.anchor, measure);
};
const overlaps = (a: LabelRect, b: LabelRect): boolean => a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;
/** The curve's points in pixels, read back from the scene's own path, so the check sees what is drawn. */
const curvePoints = (f: Fit): [number, number][] =>
  [...f.path.matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
const hitsPoint = (b: LabelRect, x: number, y: number): boolean => x >= b.x1 && x <= b.x2 && y >= b.y1 && y <= b.y2;

describe("two analyses on one graph", () => {
  const scene = (extra: Partial<Plot> = {}, second = 468) => buildPlotScene(table, plotOf(extra, second), SIZE);

  it("close potencies: the labels would touch at the fixed offset, and are moved apart", () => {
    const s = scene({}, 80);
    const [a, b] = [s.fit!.marker!, s.fits![0]!.marker!];
    const fs = s.fonts.tick.size;
    const fixed = [a, b].map((m) => placedBox({ x: m.vx + 5, y: m.cy - 5 - fs * 0.34, anchor: "start" }, m.label, fs, measure));
    expect(overlaps(fixed[0]!, fixed[1]!), "the fixture cannot exhibit the overlap").toBe(true);
    expect(overlaps(labelBox(a, fs), labelBox(b, fs)), "the two EC50 labels overlap").toBe(false);
  });

  it("the potency labels of the two analyses do not touch, and neither sits on a parameter block", () => {
    const s = scene();
    const fs = s.fonts.tick.size;
    const a = labelBox(s.fit!.marker!, fs);
    const b = labelBox(s.fits![0]!.marker!, fs);
    expect(overlaps(a, b), "the two EC50 labels overlap").toBe(false);
    for (const f of [s.fit!, s.fits![0]!]) {
      expect(overlaps(a, blockBox(f)), "the first label sits on a parameter block").toBe(false);
      expect(overlaps(b, blockBox(f)), "the second label sits on a parameter block").toBe(false);
    }
  });

  it("the first analysis's label moves too: it is routed with the other, not left at its fixed offset", () => {
    const m = scene().fit!.marker!;
    expect(m.labelAnchor, "the first label was never routed").toBeDefined();
  });

  it("the two parameter blocks sit on no curve, no data point and no crosshair, and not on each other", () => {
    const s = scene();
    const fits = [s.fit!, s.fits![0]!];
    const boxes = fits.map(blockBox);
    expect(overlaps(boxes[0]!, boxes[1]!), "the blocks overprint").toBe(false);
    const marks = s.series.flatMap((q) => q.marks);
    for (const box of boxes) {
      for (const f of fits) {
        const pts = curvePoints(f);
        expect(pts.length, "the curve's path could not be read back").toBeGreaterThan(10);
        expect(pts.some(([x, y]) => hitsPoint(box, x, y)), "a block sits on a curve").toBe(false);
        const m = f.marker!;
        expect(m.vx >= box.x1 && m.vx <= box.x2 && box.y2 >= m.cy, "a block sits on a crosshair").toBe(false);
      }
      expect(marks.some((k) => hitsPoint(box, k.cx, k.cy)), "a block sits on a data point").toBe(false);
    }
  });

  it("each label stays beside its own crosshair, not across the other curve", () => {
    // A bold 18 px "EC50 = 468" draws about 105 px wide: too wide to clear the plot's right edge beside this crosshair.
    const fontPx = 18;
    const bold = (t: string, px: number): number => t.length * px * 0.58;
    const s = buildPlotScene(table, plotOf({ fitParams: { show: false }, refLineLabelFonts: { "fit-marker": { size: fontPx } } }), { ...SIZE, width: 460, measure: bold });
    expect(s.plot.x + s.plot.width - s.fits![0]!.marker!.vx, "the fixture leaves room beside the crosshair").toBeLessThan(fontPx * bold("EC50 = 468", 1) * 1.15 + fontPx);
    const boxOf = (m: Marker): LabelRect =>
      placedBox({ x: m.labelX, y: m.labelY - fontPx * 0.34, anchor: m.labelAnchor ?? "start" }, m.label, fontPx, bold);
    for (const m of [s.fit!.marker!, s.fits![0]!.marker!]) {
      const box = boxOf(m);
      const dx = Math.max(box.x1 - m.vx, 0, m.vx - box.x2);
      const dy = Math.max(box.y1 - m.cy, 0, m.cy - box.y2);
      expect(Math.hypot(dx, dy), `"${m.label}" is far from its crosshair`).toBeLessThan(fontPx * 3);
    }
    expect(boxOf(s.fits![0]!.marker!).x2, "the second label sits left of the first curve's crosshair").toBeGreaterThan(s.fit!.marker!.vx);
  });

  it("a label with no clear spot near its crosshair is not left over a curve when a clear spot beside its own exists", () => {
    // Large labels on a small graph with only the key results shown: no spot within reach of the second crosshair is clear.
    // (Here the spot within reach puts the second label on its own curve and both its crosshair lines.)
    const fontPx = 24;
    const bold = (t: string, px: number): number => t.length * px * 0.58;
    const s = buildPlotScene(table, plotOf({ fitParams: { show: false }, refLineLabelFonts: { "fit-marker": { size: fontPx } } }), { width: 560, height: 420, measure: bold });
    const curves = [s.fit!, s.fits![0]!].map(curvePoints);
    for (const m of [s.fit!.marker!, s.fits![0]!.marker!]) {
      const box = placedBox({ x: m.labelX, y: m.labelY - fontPx * 0.34, anchor: m.labelAnchor ?? "start" }, m.label, fontPx, bold);
      for (const pts of curves) expect(pts.some(([x, y]) => hitsPoint(box, x, y)), `"${m.label}" prints over a curve`).toBe(false);
    }
    expect(s.warnings.filter((w) => w.includes("potency label")), "a label was left crowded").toEqual([]);
  });

  it("maxReach: the placer keeps a label near its subject instead of taking a clear spot far away", () => {
    const opts = { fontPx: 12, measure, bounds: { x1: 0, y1: 0, x2: 400, y2: 400 }, obstacles: [{ x1: 120, y1: 120, x2: 280, y2: 280 }] };
    const label = { id: "a", text: "EC50 = 468", anchorX: 200, anchorY: 200, prefer: "right" as const };
    const far = placeLabelsClear([label], opts).get("a")!;
    expect(far.crowded, "the fixture has no far clear spot").toBe(false);
    const near = placeLabelsClear([label], { ...opts, maxReach: 2 }).get("a")!;
    expect(near.crowded).toBe(true);
    expect(Math.hypot(near.x - 200, near.y - 200)).toBeLessThan(Math.hypot(far.x - 200, far.y - 200));
  });

  it("with no clear corner, the graph says so instead of printing over a curve in silence", () => {
    const wide = (t: string, px: number): number => t.length * px * 0.6;
    const s = buildPlotScene(table, plotOf(), { ...SIZE, measure: wide });
    expect(s.warnings.some((w) => w.includes("no clear corner")), `warnings: ${s.warnings.join(" | ")}`).toBe(true);
    expect(scene().warnings.filter((w) => w.includes("no clear corner"))).toEqual([]);
  });

  it("a block the user dragged stays, and the other block keeps clear of it", () => {
    const dragged = { dx: -30, dy: -20 };
    const s = scene({ fitParams: { offset: dragged } });
    expect(s.fit!.params!.offset).toEqual(dragged);
    expect(overlaps(blockBox(s.fit!), blockBox(s.fits![0]!)), "the free block prints on the dragged one").toBe(false);
  });

  it("a side the user chose for the blocks is left alone", () => {
    const s = scene({ fitParams: { align: "left" } });
    expect(s.fit!.params!.anchor).toBe("start");
    expect(s.fit!.params!.x).toBeCloseTo(s.plot.x + 8);
  });

  it("the second analysis alone, or one fit alone, draws as it always did", () => {
    const one = buildPlotScene(table, plotOf({ fits: undefined }), SIZE).fit!;
    expect(one.marker!.labelX).toBe(one.marker!.vx + 5);
    expect(one.marker!.labelAnchor).toBeUndefined();
    const only = buildPlotScene(table, plotOf({ fit: undefined }), SIZE).fits![0]!;
    expect(only.marker!.labelX).toBe(only.marker!.vx + 5);
    expect(only.params!.anchor).toBe("end");
  });
});
