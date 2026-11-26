/**
 * A fit's key value keeps clear of the data as drawn: of the error bars on mean ± SEM points (each fit's value placed
 * beside its curve), and of the bubbles of a bubble chart (a single fit's label, which otherwise keeps a fixed spot
 * above-right of its crosshair).
 */
import { describe, expect, it } from "vitest";
import type { DataTable, Plot, PlotFit } from "@mady/core";
import { buildPlotScene } from "./buildScene.js";
import { fitBlockBox } from "./fitBlockPlace.js";
import { placedBox } from "./labelPlacement.js";

const measure = (t: string, px: number): number => t.length * px * 0.6;
type Box = { x1: number; y1: number; x2: number; y2: number };
const crossesSegment = (b: Box, x1: number, y1: number, x2: number, y2: number): boolean => {
  for (let i = 0; i <= 20; i++) {
    const x = x1 + ((x2 - x1) * i) / 20;
    const y = y1 + ((y2 - y1) * i) / 20;
    if (x > b.x1 + 1 && x < b.x2 - 1 && y > b.y1 + 1 && y < b.y2 - 1) return true;
  }
  return false;
};

describe("key values keep clear of error bars", () => {
  // Enzyme kinetics, three variants, mean ± SEM (n = 3): a bar on every point. Means and fitted Vmax / KM as measured.
  const S = [0.5, 1, 2, 4, 6, 8, 12, 16, 24, 32, 48];
  const means = [
    [20, 6.486, 3.238], [33.785, 11.301, 7.292], [50.824, 19.434, 14.372], [67.717, 31.097, 25.935], [76.092, 38.919, 35.256], [80.94, 44.646, 42.837],
    [86.336, 52.466, 54.364], [89.083, 57.67, 62.718], [92.04, 63.933, 74.242], [93.435, 67.758, 81.641], [95.023, 71.889, 90.922],
  ];
  const vmax = [99.5, 81.3, 118];
  const km = [1.9, 6.48, 14.1];
  const mm = (k: number, s: number) => (vmax[k]! * s) / (km[k]! + s);
  const names = ["Wild type", "Mutant 1", "Mutant 2"];
  const table: DataTable = {
    id: "t", kind: "xy", name: "Kinetics",
    columns: [{ id: "x", name: "Substrate", role: "x" }, ...names.flatMap((n, k) => [
      { id: `m${k}`, name: n, role: "y" as const, group: `m${k}` },
      { id: `e${k}`, name: `${n} SEM`, role: "sem" as const, group: `m${k}` },
      { id: `n${k}`, name: `${n} N`, role: "n" as const, group: `m${k}` },
    ])],
    rows: S.map((s, i) => ({ id: `r${i}`, cells: { x: s, ...Object.fromEntries(names.flatMap((_, k) => [[`m${k}`, means[i]![k]!], [`e${k}`, Math.max(0.5, means[i]![k]! * 0.05)], [`n${k}`, 3]])) } })),
  };
  const grid = Array.from({ length: 100 }, (_, i) => 0.5 + (i * 47.5) / 99);
  const fitOf = (k: number): PlotFit => ({ label: "Michaelis-Menten", series: `m${k}`, points: grid.map((s) => [s, mm(k, s)] as [number, number]), params: [`V_{max} = ${vmax[k]} ± 0.3`, `K_{M} = ${km[k]} ± 0.0282`, "R² = 0.9996"], paramKeys: ["Vmax", "KM", "R²"] });
  const plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "xy", fit: fitOf(0), fits: [fitOf(1), fitOf(2)] } as Plot;

  it("no key value prints across an error bar", () => {
    const s = buildPlotScene(table, plot, { width: 720, height: 500, measure });
    const fits = [s.fit!, ...s.fits!];
    const bars = s.series.flatMap((q) => q.marks.filter((m) => m.errLowCy !== undefined && m.errHighCy !== undefined));
    expect(bars.length, "the fixture must draw error bars").toBeGreaterThan(20);
    for (const f of fits) {
      const p = f.params!;
      const b = fitBlockBox(p.lines, p.size, p.x, p.y, p.anchor, measure);
      const hit = bars.filter((m) => crossesSegment(b, m.cx, m.errLowCy!, m.cx, m.errHighCy!));
      expect(hit.length, `"${p.lines[0]}" prints across ${hit.length} error bar(s)`).toBe(0);
    }
  });
});

describe("a single fit's label keeps clear of the bubbles", () => {
  // Life expectancy against income, the bubble sized by population; the EC50 falls on the largest bubble.
  const rows = [[5, 62, 30], [12, 70, 82], [22, 76, 15], [35, 80, 50], [48, 83, 8], [18, 73, 124], [28, 78, 41], [9, 66, 96], [40, 81, 22]];
  const table: DataTable = {
    id: "t", kind: "xy", name: "Countries",
    columns: [{ id: "x", name: "GDP", role: "x" }, { id: "y", name: "Life expectancy", role: "y" }, { id: "z", name: "Population", role: "y" }],
    rows: rows.map(([g, l, p], i) => ({ id: `r${i}`, cells: { x: g!, y: l!, z: p! } })),
  };
  const curve = (g: number) => 50 + (36 * g) / (g + 8);
  const fit: PlotFit = { label: "Fit", series: "y", points: Array.from({ length: 80 }, (_, i) => { const g = 5 + (i * 43) / 79; return [g, curve(g)] as [number, number]; }), marker: { x: 17.5, y: curve(17.5), label: "EC50 = 17.5" } };
  const plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "bubble", fit } as Plot;

  it("the EC50 label prints on no bubble", () => {
    const s = buildPlotScene(table, plot, { width: 720, height: 500, measure });
    const m = s.fit!.marker!;
    const px = s.fonts.tick.size;
    const b = placedBox({ x: m.labelX, y: m.labelY - px * 0.34, anchor: m.labelAnchor ?? "start" }, m.label, px, measure);
    const bubbles = s.series.flatMap((q) => q.marks.map((mk) => ({ cx: mk.cx, cy: mk.cy, r: mk.symbolSize ?? 4 })));
    expect(bubbles.some((q) => q.r > 15), "the fixture must draw large bubbles").toBe(true);
    const on = bubbles.filter((q) => Math.hypot(Math.max(b.x1 - q.cx, 0, q.cx - b.x2), Math.max(b.y1 - q.cy, 0, q.cy - b.y2)) < q.r - 2);
    expect(on.length, "the label prints on a bubble").toBe(0);
  });
});
