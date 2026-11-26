/**
 * Several fits on a graph, each showing its key value, where the model draws no crosshair (peaks, decays, growth
 * curves): each value is placed beside its own curve, clear of every curve, data point and other value — not stacked
 * in a corner over the data.
 */
import { describe, expect, it } from "vitest";
import type { DataTable, Plot, PlotFit } from "@mady/core";
import { buildPlotScene } from "./buildScene.js";
import { fitBlockBox } from "./fitBlockPlace.js";

const xs = Array.from({ length: 15 }, (_, i) => i * 2);
const centres = [8, 14, 20];
const gauss = (x: number, c: number) => 3 + 80 * Math.exp(-((x - c) ** 2) / 18);
const table: DataTable = {
  id: "t", kind: "xy", name: "Peaks",
  columns: [{ id: "x", name: "X", role: "x" }, ...centres.map((_, k) => ({ id: `y${k}`, name: `Peak ${k + 1}`, role: "y" as const }))],
  rows: xs.map((x, i) => ({ id: `r${i}`, cells: { x, ...Object.fromEntries(centres.map((c, k) => [`y${k}`, gauss(x, c)])) } })),
};
const fitOf = (k: number): PlotFit => ({
  label: "Gaussian", series: `y${k}`,
  points: Array.from({ length: 120 }, (_, i) => { const x = (i * 28) / 119; return [x, gauss(x, centres[k]!)] as [number, number]; }),
  params: [`Amplitude = 80`, `Mean = ${centres[k]}`, "SD = 3", "R² = 0.999"], paramKeys: ["Amplitude", "Mean", "SD", "R²"],
});
const plotOf = (extra: Partial<Plot> = {}): Plot =>
  ({ id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "xy", fit: fitOf(0), fits: [fitOf(1), fitOf(2)], ...extra }) as Plot;
const measure = (t: string, px: number): number => t.length * px * 0.55;
const SIZE = { width: 720, height: 500, measure };

type Fit = NonNullable<ReturnType<typeof buildPlotScene>["fit"]>;
const pathPts = (f: Fit) => [...f.path.matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])] as const);
const boxOf = (f: Fit) => fitBlockBox(f.params!.lines, f.params!.size, f.params!.x, f.params!.y, f.params!.anchor, measure);
const inside = (b: { x1: number; y1: number; x2: number; y2: number }, x: number, y: number) => x >= b.x1 && x <= b.x2 && y >= b.y1 && y <= b.y2;

describe("key values of fits with no crosshair", () => {
  it("each sits beside its own curve, on no curve, no data point and no other value", () => {
    const s = buildPlotScene(table, plotOf(), SIZE);
    const fits = [s.fit!, ...s.fits!];
    expect(fits.map((f) => f.params!.lines)).toEqual([["Mean = 8"], ["Mean = 14"], ["Mean = 20"]]);
    const boxes = fits.map(boxOf);
    const marks = s.series.flatMap((q) => q.marks);
    fits.forEach((f, i) => {
      const b = boxes[i]!;
      for (const g of fits) expect(pathPts(g).some(([x, y]) => inside(b, x, y)), `"${f.params!.lines[0]}" prints over a curve`).toBe(false);
      expect(marks.some((m) => inside(b, m.cx, m.cy)), `"${f.params!.lines[0]}" prints over a data point`).toBe(false);
      boxes.forEach((o, j) => { if (j !== i) expect(b.x1 < o.x2 && o.x1 < b.x2 && b.y1 < o.y2 && o.y1 < b.y2, "two values overlap").toBe(false); });
      const own = pathPts(f);
      const gap = Math.min(...own.map(([x, y]) => Math.hypot(Math.max(b.x1 - x, 0, x - b.x2), Math.max(b.y1 - y, 0, y - b.y2))));
      expect(gap, `"${f.params!.lines[0]}" is not beside its own curve`).toBeLessThan(f.params!.size * 3);
    });
    expect(s.warnings.filter((w) => /fit parameter/i.test(w))).toEqual([]);
  });

  it("three peaks with wide values: each value sits beside its own peak, none in a corner", () => {
    // Values as wide as the gap between peaks: placed one after another at the spot nearest each peak, the first
    // ones take the room the last one needs.
    const wide = (k: number): PlotFit => ({ ...fitOf(k), params: [`Mean = ${centres[k]}.1 ± 0.0854`, "R² = 0.999"], paramKeys: ["Mean", "R²"] });
    const m6 = (t: string, px: number): number => t.length * px * 0.6;
    for (const [w, h] of [[720, 500], [600, 420]] as const) {
      const s = buildPlotScene(table, plotOf({ fit: wide(0), fits: [wide(1), wide(2)] }), { width: w, height: h, measure: m6 });
      const fits = [s.fit!, ...s.fits!];
      const boxes = fits.map((f) => fitBlockBox(f.params!.lines, f.params!.size, f.params!.x, f.params!.y, f.params!.anchor, m6));
      fits.forEach((f, i) => {
        const b = boxes[i]!;
        const own = pathPts(f);
        const gap = Math.min(...own.map(([x, y]) => Math.hypot(Math.max(b.x1 - x, 0, x - b.x2), Math.max(b.y1 - y, 0, y - b.y2))));
        expect(gap, `"${f.params!.lines[0]}" is not beside its own peak at ${w} x ${h}`).toBeLessThan(f.params!.size * 3);
        // It reads as its own peak's: no other curve is clearly nearer (by more than half a line).
        for (const g of fits) {
          if (g === f) continue;
          const other = Math.min(...pathPts(g).map(([x, y]) => Math.hypot(Math.max(b.x1 - x, 0, x - b.x2), Math.max(b.y1 - y, 0, y - b.y2))));
          expect(other, `"${f.params!.lines[0]}" is nearer another peak at ${w} x ${h}`).toBeGreaterThan(gap - f.params!.size / 2);
        }
        boxes.forEach((o, j) => { if (j !== i) expect(b.x1 < o.x2 && o.x1 < b.x2 && b.y1 < o.y2 && o.y1 < b.y2, "two values overlap").toBe(false); });
      });
    }
  });

  it("Show all and a side chosen for the blocks keep the corner placement", () => {
    const all = buildPlotScene(table, plotOf({ fitParams: { show: true } }), SIZE);
    expect(all.fit!.params!.lines).toHaveLength(4);
    const left = buildPlotScene(table, plotOf({ fitParams: { align: "left" } }), SIZE);
    expect(left.fit!.params!.x).toBeCloseTo(left.plot.x + 8);
  });
});
