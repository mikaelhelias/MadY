/**
 * Several fits on one graph: a potency label with no clear room at its crosshair moves along its own
 * curve, never to a far corner; a statistic ticked in Fit parameters shows on every fit's block.
 */
import { describe, expect, it } from "vitest";
import type { DataTable, Plot, PlotFit } from "@mady/core";
import { buildPlotScene } from "./buildScene.js";
import { besideCurve, placedBox } from "./labelPlacement.js";
import type { LabelRect } from "./labelPlacement.js";

describe("besideCurve", () => {
  const measure = (t: string, px: number): number => t.length * px * 0.55;
  const bounds = { x1: 0, y1: 0, x2: 400, y2: 300 };
  // A falling straight curve from the top-left to the bottom-right.
  const curve = Array.from({ length: 41 }, (_, i) => [i * 10, i * 7.5] as const);
  const label = { id: "a", text: "EC50 = 49.2", anchorX: 200, anchorY: 150 };

  it("with the anchor's own surroundings taken, it takes the nearest clear spot beside the curve", () => {
    const blocked: LabelRect = { x1: 120, y1: 90, x2: 300, y2: 210 };
    const p = besideCurve(label, curve, { fontPx: 12, measure, bounds, obstacles: [blocked] })!;
    expect(p, "a spot exists beside the curve").toBeDefined();
    expect(p.crowded).toBe(false);
    const box = placedBox(p, label.text, 12, measure);
    const gap = Math.min(...curve.map(([x, y]) => Math.hypot(Math.max(box.x1 - x, 0, x - box.x2), Math.max(box.y1 - y, 0, y - box.y2))));
    expect(gap, "the label is beside its curve").toBeLessThan(12 * 2);
    expect(box.x1 < blocked.x2 && blocked.x1 < box.x2 && box.y1 < blocked.y2 && blocked.y1 < box.y2, "the label sits on the obstacle").toBe(false);
  });

  it("no clear spot beside the curve: undefined, so the caller can say so", () => {
    const all: LabelRect = { x1: -10, y1: -10, x2: 410, y2: 310 };
    expect(besideCurve(label, curve, { fontPx: 12, measure, bounds, obstacles: [all] })).toBeUndefined();
  });
});

const fourPL = (x: number, e: number): number => 3 + 97 / (1 + e / x);
const doses = [1, 3, 10, 30, 100, 300, 1000, 3000, 10000];
const grid = Array.from({ length: 80 }, (_, i) => Math.pow(10, (i * 4) / 79));
const KEYS = ["Bottom", "Top", "logEC50", "Hill slope", "EC50", "R²"];
const fitFor = (e: number, hill: string): PlotFit => ({
  label: "Dose-response (4PL, variable slope)",
  points: grid.map((x) => [x, fourPL(x, e)] as [number, number]),
  params: ["Bottom = 3.17", "Top = 100", "logEC_{50} = 2.67", `Hill slope = ${hill}`, `EC_{50} = ${e}`, "R² = 0.9998"],
  paramKeys: KEYS,
  marker: { x: e, y: 51.5, label: `EC50 = ${e}` },
});
const table: DataTable = {
  id: "t", kind: "xy", name: "T",
  columns: [{ id: "x", name: "Dose" }, { id: "a", name: "A" }, { id: "b", name: "B" }],
  rows: doses.map((x, i) => ({ id: `r${i}`, cells: { x, a: fourPL(x, 52), b: fourPL(x, 468) } })),
};
const plotOf = (extra: Partial<Plot> = {}): Plot => ({
  id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "xy", xAxis: { scale: "log10" },
  fit: { ...fitFor(52, "1.14"), analysisSource: "an1" }, fits: [{ ...fitFor(468, "0.87"), analysisSource: "an2" }], ...extra,
});

describe("a potency label without room at its crosshair", () => {
  it("stays beside its own curve, clear of both curves", () => {
    // Large labels on a small graph: the spot within reach of the second crosshair lies on its own curve.
    const fontPx = 24;
    const bold = (t: string, px: number): number => t.length * px * 0.58;
    const s = buildPlotScene(table, plotOf({ refLineLabelFonts: { "fit-marker": { size: fontPx } } }), { width: 560, height: 420, measure: bold });
    const curves = [s.fit!, s.fits![0]!].map((f) => [...f.path.matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])] as const));
    for (const [i, m] of [s.fit!.marker!, s.fits![0]!.marker!].entries()) {
      const box = placedBox({ x: m.labelX, y: m.labelY - fontPx * 0.34, anchor: m.labelAnchor ?? "start" }, m.label, fontPx, bold);
      for (const pts of curves) expect(pts.some(([x, y]) => x >= box.x1 && x <= box.x2 && y >= box.y1 && y <= box.y2), `"${m.label}" prints over a curve`).toBe(false);
      const own = curves[i]!;
      const gap = Math.min(...own.map(([x, y]) => Math.hypot(Math.max(box.x1 - x, 0, x - box.x2), Math.max(box.y1 - y, 0, y - box.y2))));
      expect(gap, `"${m.label}" is not beside its own curve`).toBeLessThan(fontPx * 2);
    }
  });
});

describe("statistics ticked in Fit parameters", () => {
  it("with several fits, a ticked line shows on every fit's block with that fit's own value", () => {
    const s = buildPlotScene(table, plotOf({ fitParams: { lines: { "Hill slope": { show: true } } } }), { width: 720, height: 500 });
    expect(s.fit!.params!.lines).toEqual(["Hill slope = 1.14"]);
    expect(s.fits![0]!.params!.lines).toEqual(["Hill slope = 0.87"]);
  });

  it("a line's typed text stays the single fit's own", () => {
    const s = buildPlotScene(table, plotOf({ fitParams: { lines: { "Hill slope": { show: true, text: "nH = 1.1" } } } }), { width: 720, height: 500 });
    expect(s.fit!.params!.lines).toEqual(["nH = 1.1"]);
    expect(s.fits![0]!.params!.lines).toEqual(["Hill slope = 0.87"]);
  });

  it("each fit's ticked statistics print under its own potency label, on the same side, clear of both curves", () => {
    const measure = (t: string, px: number): number => t.length * px * 0.55;
    const s = buildPlotScene(table, plotOf({ fitParams: { lines: { "Hill slope": { show: true }, "R²": { show: true } } } }), { width: 1000, height: 700, measure });
    const fits = [s.fit!, s.fits![0]!];
    const curves = fits.map((f) => [...f.path.matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])] as const));
    for (const f of fits) {
      const m = f.marker!;
      const p = f.params!;
      expect(p.lines).toHaveLength(2);
      expect(p.x, "the block is not aligned with its label").toBeCloseTo(m.labelX);
      expect(p.anchor).toBe(m.labelAnchor ?? "start");
      const below = p.y - m.labelY;
      expect(below, "the block is not just under its label").toBeGreaterThan(0);
      expect(below).toBeLessThan(s.fonts.tick.size * 2.5);
      const w = Math.max(...p.lines.map((l) => measure(l, p.size)));
      const box = { x1: p.anchor === "end" ? p.x - w : p.x, x2: p.anchor === "end" ? p.x : p.x + w, y1: p.y - p.size, y2: p.y + p.size * 1.5 };
      for (const pts of curves) expect(pts.some(([x, y]) => x >= box.x1 && x <= box.x2 && y >= box.y1 && y <= box.y2), `"${p.lines[0]}" prints over a curve`).toBe(false);
    }
  });

  it("statistics with no room beside their curve take a clear corner, and the label stays beside its curve alone", () => {
    const measure = (t: string, px: number): number => t.length * px * 0.55;
    const ticks = { "Hill slope": { show: true }, "R²": { show: true }, "Top": { show: true }, "Bottom": { show: true }, "logEC50": { show: true } };
    const s = buildPlotScene(table, plotOf({ fitParams: { lines: ticks } }), { width: 460, height: 320, measure });
    const fits = [s.fit!, s.fits![0]!];
    const cornered = fits.filter((f) => Math.abs(f.params!.x - f.marker!.labelX) > 1 || f.params!.anchor !== (f.marker!.labelAnchor ?? "start"));
    expect(cornered.length, "the fixture must leave a fit's statistics no room beside its curve").toBeGreaterThan(0);
    const curves = fits.map((f) => [...f.path.matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])] as const));
    const fontPx = s.fonts.tick.size;
    for (const [i, f] of fits.entries()) {
      const m = f.marker!;
      const label = placedBox({ x: m.labelX, y: m.labelY - fontPx * 0.34, anchor: m.labelAnchor ?? "start" }, m.label, fontPx, measure);
      for (const pts of curves) expect(pts.some(([x, y]) => x >= label.x1 && x <= label.x2 && y >= label.y1 && y <= label.y2), `"${m.label}" prints over a curve`).toBe(false);
      const gap = Math.min(...curves[i]!.map(([x, y]) => Math.hypot(Math.max(label.x1 - x, 0, x - label.x2), Math.max(label.y1 - y, 0, y - label.y2))));
      expect(gap, `"${m.label}" is not beside its own curve`).toBeLessThan(fontPx * 2.5);
    }
    for (const f of cornered) {
      const p = f.params!;
      const w = Math.max(...p.lines.map((l) => measure(l, p.size)));
      const box = { x1: p.anchor === "end" ? p.x - w : p.x, x2: p.anchor === "end" ? p.x : p.x + w, y1: p.y - p.size, y2: p.y + p.size * (p.lines.length + 0.5) };
      for (const g of fits) {
        const m = g.marker!;
        const label = placedBox({ x: m.labelX, y: m.labelY - fontPx * 0.34, anchor: m.labelAnchor ?? "start" }, m.label, fontPx, measure);
        expect(box.x1 < label.x2 && label.x1 < box.x2 && box.y1 < label.y2 && label.y1 < box.y2, `a corner block prints on "${m.label}"`).toBe(false);
      }
    }
  });

  it("Show all keeps the full blocks in the corners, not under the labels", () => {
    const s = buildPlotScene(table, plotOf({ fitParams: { show: true } }), { width: 720, height: 500 });
    expect(s.fit!.params!.lines).toHaveLength(6);
    expect(s.fit!.params!.x).not.toBeCloseTo(s.fit!.marker!.labelX);
  });

  it("a per-series fit alone on its graph is still drawn whole", () => {
    const s = buildPlotScene(table, plotOf({ fit: undefined, fitParams: { lines: { "Hill slope": { show: false } } } }), { width: 720, height: 500 });
    expect(s.fits![0]!.params!.lines).toHaveLength(6);
  });
});
