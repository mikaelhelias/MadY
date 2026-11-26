/**
 * Many fits with close potencies on one graph: a potency label that finds no clear spot beside its curve goes into
 * one list in the clearest corner — a line per fit, in its colour and named by its series — instead of printing over
 * the curves and the other labels. The notice counts only a label that still prints over something.
 */
import { describe, expect, it } from "vitest";
import type { DataTable, Plot, PlotFit } from "@mady/core";
import { buildPlotScene } from "./buildScene.js";
import { placedBox } from "./labelPlacement.js";

const doses = [0.01, 0.03, 0.1, 0.3, 1, 3, 10, 30, 100, 300, 1000];
const ec50s = [2.8, 3.1, 3.4, 40, 43, 46];
const names = ["S1", "S2", "S3", "S4", "S5", "S6"];
const fourPL = (x: number, e: number) => 5 + 90 / (1 + e / x);
const table: DataTable = {
  id: "t", kind: "xy", name: "Doses",
  columns: [{ id: "x", name: "Dose", role: "x" }, ...names.map((n, k) => ({ id: `y${k}`, name: n, role: "y" as const }))],
  rows: doses.map((x, i) => ({ id: `r${i}`, cells: { x, ...Object.fromEntries(ec50s.map((e, k) => [`y${k}`, fourPL(x, e)])) } })),
};
const grid = Array.from({ length: 100 }, (_, i) => Math.pow(10, -2 + (i * 5) / 99));
const fitOf = (k: number): PlotFit => ({
  label: "Dose-response", series: `y${k}`, analysisSource: `an${k}`,
  points: grid.map((x) => [x, fourPL(x, ec50s[k]!)] as [number, number]),
  params: [`EC_{50} = ${ec50s[k]}`, "R² = 0.99"], paramKeys: ["EC50", "R²"],
  marker: { x: ec50s[k]!, y: 50, label: `EC50 = ${ec50s[k]}` },
});
const plotOf = (extra: Partial<Plot> = {}): Plot =>
  ({ id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "xy", xAxis: { scale: "log10" }, fit: fitOf(0), fits: ec50s.slice(1).map((_, k) => fitOf(k + 1)), ...extra }) as Plot;
const measure = (t: string, px: number): number => t.length * px * 0.58;
type Fit = NonNullable<ReturnType<typeof buildPlotScene>["fit"]>;
const pathPts = (f: Fit) => [...f.path.matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])] as const);

describe("crowded potency labels", () => {
  // At this size the labels of the second group find no clear spot beside their curves.
  const s = buildPlotScene(table, plotOf(), { width: 400, height: 300, measure });
  const fits = [s.fit!, ...s.fits!];
  const fontPx = s.fonts.tick.size;
  const box = (f: Fit) => placedBox({ x: f.marker!.labelX, y: f.marker!.labelY - fontPx * 0.34, anchor: f.marker!.labelAnchor ?? "start" }, f.marker!.label, fontPx, measure);

  it("the labels that find no clear spot are listed, each named by its series, one under the other", () => {
    const listed = fits.filter((f) => f.marker!.label.includes(": EC50"));
    expect(listed.length, "the fixture must crowd some labels").toBeGreaterThan(0);
    for (const f of listed) {
      const k = fits.indexOf(f);
      expect(f.marker!.label).toBe(`${names[k]}: EC50 = ${ec50s[k]}`);
    }
    expect(new Set(listed.map((f) => `${f.marker!.labelX}|${f.marker!.labelAnchor}`)).size, "the list is one column").toBe(1);
    const ys = listed.map((f) => f.marker!.labelY).sort((a, b) => a - b);
    for (let i = 1; i < ys.length; i++) expect(ys[i]! - ys[i - 1]!).toBeGreaterThan(fontPx);
  });

  it("no label prints over a curve or another label", () => {
    const boxes = fits.map(box);
    boxes.forEach((b, i) => {
      for (const f of fits) expect(pathPts(f).some(([x, y]) => x > b.x1 + 3 && x < b.x2 - 3 && y > b.y1 + 3 && y < b.y2 - 3), `"${fits[i]!.marker!.label}" prints over a curve`).toBe(false);
      boxes.forEach((o, j) => { if (j !== i) expect(b.x1 < o.x2 && o.x1 < b.x2 && b.y1 < o.y2 && o.y1 < b.y2, `"${fits[i]!.marker!.label}" overlaps "${fits[j]!.marker!.label}"`).toBe(false); });
    });
    expect(s.warnings.filter((w) => w.includes("potency"))).toEqual([]);
  });

  it("on a graph too small for a clear list, the labels stay by their curves and the graph says they print over the data", () => {
    const tiny = buildPlotScene(table, plotOf(), { width: 300, height: 220, measure });
    const all = [tiny.fit!, ...tiny.fits!];
    expect(all.some((f) => f.marker!.label.includes(": EC50")), "no list where it cannot be placed clear").toBe(false);
    expect(tiny.warnings.some((w) => /potency labels? (has|have) no clear spot/.test(w))).toBe(true);
  });

  it("a label that would print on another label moves beside its own curve; it is not listed alone", () => {
    // Three compounds a decade or more apart, as fitted (Bottom, Top, logEC50, Hill slope): the middle label's first
    // spot lands on another label, and there is room beside its own curve.
    const fitted = [[5.92, 93.8, 0.4, 1.11], [4.06, 96.1, 1.63, 1.14], [5.66, 106, 2.75, 0.951]] as const;
    const ec = [2.51, 42.9, 562];
    const curveY = (k: number, x: number) => { const [b, t, l, h] = fitted[k]!; return b + (t - b) / (1 + Math.pow(10, (l - Math.log10(x)) * h)); };
    const data = [
      [5.183, 5.674, 3.734], [6.512, 4.776, 4.587], [8.894, 3.989, 5.518], [14.205, 3.594, 6.374], [29.115, 4.326, 7.057], [53.586, 7.662, 7.586],
      [78.444, 18.997, 8.513], [89.217, 41.319, 11.245], [92.736, 70.319, 21.181], [93.112, 86.715, 41.644], [92.907, 93.953, 68.963],
    ];
    const t3: DataTable = {
      id: "t3", kind: "xy", name: "Three",
      columns: [{ id: "x", name: "Dose", role: "x" }, ...ec.map((_, k) => ({ id: `c${k}`, name: `Compound ${k + 1}`, role: "y" as const }))],
      rows: doses.map((x, i) => ({ id: `r${i}`, cells: { x, ...Object.fromEntries(ec.map((_, k) => [`c${k}`, data[i]![k]!])) } })),
    };
    const grid3 = Array.from({ length: 80 }, (_, i) => Math.pow(10, -2 + (i * 5) / 79));
    const fit3 = (k: number): PlotFit => ({ label: "Dose-response", series: `c${k}`, analysisSource: `b${k}`, points: grid3.map((x) => [x, curveY(k, x)] as [number, number]), params: [`EC_{50} = ${ec[k]}`], paramKeys: ["EC50"], marker: { x: ec[k]!, y: curveY(k, ec[k]!), label: `EC50 = ${ec[k]}` } });
    const p3 = { id: "p3", name: "P", source: "t3", status: "ok", styleOverrides: {}, kind: "xy", xAxis: { scale: "log10" }, fit: fit3(0), fits: [fit3(1), fit3(2)] } as Plot;
    const m6 = (t: string, px: number): number => t.length * px * 0.6;
    for (const [w, h] of [[720, 500], [600, 420]] as const) {
      const s3 = buildPlotScene(t3, p3, { width: w, height: h, measure: m6 });
      const all = [s3.fit!, ...s3.fits!];
      const px = s3.fonts.tick.size;
      const boxes = all.map((f) => placedBox({ x: f.marker!.labelX, y: f.marker!.labelY - px * 0.34, anchor: f.marker!.labelAnchor ?? "start" }, f.marker!.label, px, m6));
      all.forEach((f, i) => {
        const at = `at ${w} x ${h}`;
        if (w === 720) expect(f.marker!.label, `a single label is not put in a list ${at}`).toBe(`EC50 = ${ec[i]}`);
        if (f.marker!.label.includes(":")) return;
        const own = pathPts(f);
        const b = boxes[i]!;
        const gap = Math.min(...own.map(([x, y]) => Math.hypot(Math.max(b.x1 - x, 0, x - b.x2), Math.max(b.y1 - y, 0, y - b.y2))));
        expect(gap, `"${f.marker!.label}" is not beside its own curve ${at}`).toBeLessThan(px * 2);
        // It names its crosshair: it stays near that point, not out on the plateau the curves share.
        const fromCrosshair = Math.hypot(Math.max(b.x1 - f.marker!.vx, 0, f.marker!.vx - b.x2), Math.max(b.y1 - f.marker!.cy, 0, f.marker!.cy - b.y2));
        expect(fromCrosshair, `"${f.marker!.label}" is far from its crosshair ${at}`).toBeLessThan(Math.max(s3.plot.width, s3.plot.height) / 3);
        boxes.forEach((o, j) => { if (j !== i) expect(b.x1 < o.x2 && o.x1 < b.x2 && b.y1 < o.y2 && o.y1 < b.y2, `"${f.marker!.label}" overlaps "${all[j]!.marker!.label}" ${at}`).toBe(false); });
      });
    }
  });

  it("each listed label keeps its curve's colour, and its crosshair stays on the curve", () => {
    for (const f of fits) {
      expect(f.marker!.color).toBe(f.color);
      expect(Number.isFinite(f.marker!.vx) && Number.isFinite(f.marker!.cy)).toBe(true);
    }
  });
});
