// The timeline tracks share their right margin: each numeric strip's key (a small colour bar and its two numbers) and the
// legend of the categorical strips. They are laid out side by side — keys first, then the legend, as the line chart
// stacks its second axis, colour bar and legend — so the legend never prints over a key.
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene";

const measure = (t: string, px: number): number => t.length * px * 0.55;
const table: DataTable = {
  id: "tt", kind: "xy", name: "T",
  columns: [{ id: "t", name: "Week", role: "x" }, { id: "diet", name: "Diet", role: "y" }, { id: "shan", name: "Shannon", role: "y" }, { id: "bac", name: "Bacteroides", role: "y" }],
  rows: Array.from({ length: 14 }, (_, i) => ({ id: `r${i}`, cells: { t: i, diet: i < 5 ? "Chow" : i < 10 ? "High-fat" : "Recovery", shan: 2 + (i % 5) * 0.4, bac: 20 + i * 2 } })),
};
const build = (h: number, over: Partial<Plot> = {}, tbl: DataTable = table) =>
  buildPlotScene(tbl, { id: "p", name: "P", source: "tt", status: "ok", styleOverrides: {}, kind: "tracks", ...over }, { width: 780, height: h, measure });

/** Where the legend box starts, as the renderer places it: the plot's right edge + the legend's gap + whatever stands before it. */
const legendLeft = (s: ReturnType<typeof build>): number => s.plot.x + s.plot.width + (s.legendLayout.gap ?? 12) + (s.legendLayout.outsidePad ?? 0);
/** How far right the keys' numbers reach. */
function keysRight(s: ReturnType<typeof build>): number {
  const font = s.fonts.legend.size;
  return Math.max(...s.tracks!.strips.filter((x) => x.colorbar).map((x) => {
    const cb = x.colorbar!;
    const size = cb.labelSize ?? font;
    const text = cb.combined ? `${cb.min}–${cb.max}` : [cb.min, cb.max].map((v) => String(Number.isInteger(v) ? v : Number(v.toFixed(2)))).sort((a, b) => b.length - a.length)[0]!;
    return cb.x + cb.w + 3 + measure(text, size);
  }));
}

describe("the tracks legend starts past the strips' keys", () => {
  it("at an ordinary height", () => {
    const s = build(420);
    expect(s.legend.length).toBeGreaterThan(0);
    expect(legendLeft(s)).toBeGreaterThanOrEqual(keysRight(s));
  });

  it("at short heights, where the numbers are smaller or combined", () => {
    for (const h of [300, 220, 170]) {
      const s = build(h);
      expect(legendLeft(s), `figure ${h} px tall`).toBeGreaterThanOrEqual(keysRight(s));
    }
  });

  it("with a bigger key (the Key size setting)", () => {
    const s = build(420, { tracks: { keyScale: 2 } });
    expect(legendLeft(s)).toBeGreaterThanOrEqual(keysRight(s));
  });

  it("with strips too short for stacked numbers (one combined label)", () => {
    const s = build(420, { tracks: { trackHeight: 10 } });
    expect(s.tracks!.strips.some((x) => x.colorbar?.combined)).toBe(true);
    expect(legendLeft(s)).toBeGreaterThanOrEqual(keysRight(s));
  });

  it("the keys and the legend fit within the figure's own width", () => {
    const s = build(420);
    const legendRight = legendLeft(s) + (s.legendLayout.swatchWidth ?? 18) + 80;
    expect(legendRight).toBeLessThanOrEqual(s.width + 40);
    expect(s.plot.width).toBeGreaterThan(300);
  });

  it("with no numeric strip there is nothing before the legend: it is not pushed", () => {
    const cat: DataTable = { ...table, columns: table.columns.filter((c) => c.id !== "shan" && c.id !== "bac") };
    const s = build(420, {}, cat);
    expect(s.legend.length).toBeGreaterThan(0);
    expect(s.legendLayout.outsidePad ?? 0).toBe(0);
  });

  it("with no legend (a numeric strip only) no legend offset is set", () => {
    const num: DataTable = { ...table, columns: table.columns.filter((c) => c.id !== "diet") };
    const s = build(420, {}, num);
    expect(s.legend.length).toBe(0);
    expect(s.legendLayout.outsidePad ?? 0).toBe(0);
  });

  it("a legend placed elsewhere (not right) is not pushed", () => {
    const s = build(420, { legend: { position: "top" } });
    expect(s.legendLayout.outsidePad ?? 0).toBe(0);
  });
});
