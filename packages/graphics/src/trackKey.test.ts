// The numeric-strip key of the timeline tracks: a colour bar with its min number at the foot and its max at the head.
// The two numbers must never be drawn on top of each other, whatever the strip's height.
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene";
import { trackKeyLayout } from "./trackKey";

/** Where the renderer puts the two numbers (PlotFigure: head baseline at size/3, foot baseline 0.3·size above the bar's
 *  end), and how tall a digit stands (0.72·size). True when the foot number's top clears the head number's baseline. */
function numbersClear(barH: number, size: number): boolean {
  const headBaseline = size / 3;
  const footTop = barH - 0.3 * size - 0.72 * size;
  return footTop >= headBaseline + 1;
}

describe("trackKeyLayout", () => {
  it("on a roomy strip the bar fills the strip less a label's height at each end, numbers at the full size", () => {
    const l = trackKeyLayout(60, 12, 1);
    expect(l.labelSize).toBe(12);
    expect(l.combined).toBe(false);
    expect(l.h).toBe(60 - 2 * 9); // inset = 0.75 × 12
    expect(l.top).toBe(9);
  });

  it("a smaller key scale shortens the bar but keeps it centred", () => {
    const full = trackKeyLayout(60, 12, 1);
    const half = trackKeyLayout(60, 12, 0.5);
    expect(half.h).toBeLessThan(full.h);
    expect(half.top + half.h / 2).toBeCloseTo(full.top + full.h / 2, 6);
  });

  it("never lets the two numbers meet: a strip that cannot hold them at this size gets smaller numbers", () => {
    for (const band of [60, 50, 40, 34, 30, 26, 22, 18, 16]) {
      const l = trackKeyLayout(band, 12, 1);
      if (l.combined) continue;
      expect(numbersClear(l.h, l.labelSize), `band ${band}: bar ${l.h}, numbers ${l.labelSize}px`).toBe(true);
      expect(l.labelSize).toBeLessThanOrEqual(12);
      expect(l.labelSize).toBeGreaterThanOrEqual(7);
    }
  });

  it("a small key scale cannot shorten the bar below what the numbers need", () => {
    const l = trackKeyLayout(34, 12, 0.5);
    expect(numbersClear(l.h, l.labelSize)).toBe(true);
  });

  it("keeps the bar and its numbers inside the strip", () => {
    for (const band of [60, 40, 30, 20]) {
      const l = trackKeyLayout(band, 12, 1);
      if (l.combined) continue;
      expect(l.top).toBeGreaterThanOrEqual(0);
      expect(l.top + l.h).toBeLessThanOrEqual(band);
    }
  });

  it("when even the smallest readable numbers cannot be stacked, the two are written as one 'min–max' label", () => {
    const l = trackKeyLayout(12, 12, 1);
    expect(l.combined).toBe(true);
    expect(l.labelSize).toBeLessThanOrEqual(12);
    expect(l.h).toBeGreaterThanOrEqual(4);
  });

  it("numbers are never larger than the font asked for", () => {
    expect(trackKeyLayout(30, 8, 1).labelSize).toBeLessThanOrEqual(8);
  });
});

describe("the key on a drawn tracks graph", () => {
  const table: DataTable = {
    id: "tt", kind: "xy", name: "T",
    columns: [{ id: "t", name: "Week", role: "x" }, { id: "diet", name: "Diet", role: "y" }, { id: "shan", name: "Shannon", role: "y" }, { id: "bac", name: "Bacteroides", role: "y" }, { id: "wt", name: "Weight", role: "y" }],
    rows: Array.from({ length: 14 }, (_, i) => ({ id: `r${i}`, cells: { t: i, diet: i < 5 ? "Chow" : "High-fat", shan: 2 + (i % 5) * 0.4, bac: 20 + i * 2, wt: 22 + i * 0.6 } })),
  };
  const build = (h: number, tracks?: NonNullable<Plot["tracks"]>) => buildPlotScene(table, { id: "p", name: "P", source: "tt", status: "ok", styleOverrides: {}, kind: "tracks", ...(tracks ? { tracks } : {}) }, { width: 780, height: h });
  const keysOf = (h: number, tracks?: NonNullable<Plot["tracks"]>) => {
    const s = build(h, tracks);
    return s.tracks!.strips.filter((x) => x.colorbar).map((x) => ({ strip: x, cb: x.colorbar!, font: s.fonts.legend.size }));
  };

  it("at an ordinary height the key keeps its numbers at the legend size, not combined", () => {
    for (const { cb } of keysOf(420)) {
      expect(cb.labelSize).toBeUndefined();
      expect(cb.combined).toBeUndefined();
    }
  });

  it("no strip's two numbers meet at any figure height, with the default strip height", () => {
    for (const h of [420, 340, 280, 240, 200, 170, 140, 110]) {
      for (const { cb, font, strip } of keysOf(h)) {
        if (cb.combined) continue;
        expect(numbersClear(cb.h, cb.labelSize ?? font), `figure ${h} px tall: strip ${Math.round(strip.h)} px, bar ${Math.round(cb.h)} px`).toBe(true);
      }
    }
  });

  it("nor with a pinned strip height of 34 px", () => {
    for (const { cb, font } of keysOf(360, { trackHeight: 34 })) {
      if (cb.combined) continue;
      expect(numbersClear(cb.h, cb.labelSize ?? font)).toBe(true);
    }
  });

  it("a strip too short for stacked numbers carries one combined label, and the margin has room for it", () => {
    const short = build(360, { trackHeight: 10 });
    const normal = build(360);
    const cb = short.tracks!.strips.find((x) => x.colorbar)!.colorbar!;
    expect(cb.combined).toBe(true);
    expect(short.plot.width).toBeLessThan(normal.plot.width);
  });

  it("the key stays inside its own strip", () => {
    for (const h of [420, 240, 170]) {
      for (const { strip, cb } of keysOf(h)) {
        if (cb.combined) continue;
        expect(cb.y).toBeGreaterThanOrEqual(strip.y - 0.01);
        expect(cb.y + cb.h).toBeLessThanOrEqual(strip.y + strip.h + 0.01);
      }
    }
  });
});
