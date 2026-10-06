// @vitest-environment node
/**
 * A numeric strip must carry a key.
 *
 * A categorical strip explains itself — it draws its words. A numeric one shades through a ramp,
 * and without a key beside it the reader sees that one row is darker and never learns what that
 * means, or in which direction.
 *
 * The key is the same drawable the `tracks` kind already gives its numeric strips: a small colour
 * bar with the value range at its ends, plus a caption saying what it decodes.
 */
import { describe, expect, it } from "vitest";
import type { DataTable, HeatTrack, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene";

const SIZE = { width: 700, height: 460 };
const table: DataTable = {
  id: "t", kind: "xy", name: "T",
  columns: [
    { id: "g", name: "Gene" }, { id: "score", name: "Tumour purity" }, { id: "arm", name: "Arm" },
    { id: "c0", name: "S1" }, { id: "c1", name: "S2" }, { id: "c2", name: "S3" },
  ],
  rows: ["G1", "G2", "G3", "G4"].map((g, i) => ({
    id: `r${i}`,
    cells: { g, score: 10 + i * 5, arm: i < 2 ? "Ctrl" : "Treated", c0: i + 1, c1: i + 2, c2: i + 3 },
  })),
};
const build = (heatmap: NonNullable<Plot["heatmap"]>, fonts?: Plot["fonts"]) =>
  buildPlotScene(table, { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "heatmap", heatmap, ...(fonts ? { fonts } : {}) }, SIZE);
const rowStrip = (t: HeatTrack) => build({ rowTracks: [t] }).heatmap!.tracks![0]!;

describe("the key exists exactly where it is needed", () => {
  it("a numeric strip gets one", () => {
    const tr = rowStrip({ column: "score" });
    expect(tr.numeric).toBe(true);
    expect(tr.key, "a numeric strip has no key — nothing decodes its ramp").toBeTruthy();
    expect(tr.key!.min).toBe(10);
    expect(tr.key!.max).toBe(25);
    expect(tr.key!.bar.w).toBeGreaterThan(0);
    expect(tr.key!.bar.h).toBeGreaterThan(0);
  });

  it("a categorical strip does not — its own words are the key", () => {
    const tr = rowStrip({ column: "arm" });
    expect(tr.numeric).toBe(false);
    expect(tr.key).toBeUndefined();
    // …and it really does draw those words (or this case would prove the wrong thing)
    expect(tr.runs.some((r) => r.label !== "")).toBe(true);
  });

  it("switched off, no numeric strip draws one", () => {
    const s = build({ rowTracks: [{ column: "score" }], trackKeys: false });
    expect(s.heatmap!.tracks![0]!.key).toBeUndefined();
  });
});

describe("the key says what it decodes", () => {
  it("the strip's own name when it has one", () => {
    expect(rowStrip({ column: "score", name: "Purity" }).key!.caption).toBe("Purity");
  });

  it("the source column when it does not — a strip is added unnamed", () => {
    // A bar with numbers and no subject is an unreadable key.
    expect(rowStrip({ column: "score" }).key!.caption).toBe("Tumour purity");
  });
});

describe("the key is drawn where it can be read", () => {
  it("outside the cells, in the right margin", () => {
    const s = build({ rowTracks: [{ column: "score" }] });
    const key = s.heatmap!.tracks![0]!.key!;
    const plot = s.plot;
    expect(key.bar.x, "the key is drawn over the matrix").toBeGreaterThan(plot.x + plot.width);
    expect(key.bar.x + key.bar.w, "the key runs off the figure").toBeLessThanOrEqual(s.width);
    expect(key.nameY).toBeLessThan(key.bar.y);
  });

  it("the matrix gives up the width for it — the key is not drawn on something else", () => {
    const withKey = build({ rowTracks: [{ column: "score" }] });
    const without = build({ rowTracks: [{ column: "score" }], trackKeys: false });
    expect(withKey.plot.width).toBeLessThan(without.plot.width);
  });

  it("a long caption widens the reserved column — the margin measures what it draws", () => {
    // Without this the key is drawn into whatever slack the default margin happens to leave,
    // and any caption longer than that slack prints off the edge of the figure, cut short.
    const short = build({ rowTracks: [{ column: "score", name: "P" }] });
    const long = build({ rowTracks: [{ column: "score", name: "Tumour purity fraction, deconvolved" }] });
    expect(long.plot.width).toBeLessThan(short.plot.width);
    const key = long.heatmap!.tracks![0]!.key!;
    expect(key.nameX + 34 * 6, "the caption runs off the figure").toBeLessThanOrEqual(long.width);
  });

  it("it clears the main colour bar (both live in the right margin)", () => {
    const s = build({ rowTracks: [{ column: "score" }] });
    const hm = s.heatmap!;
    expect(hm.tracks![0]!.key!.bar.x).toBeGreaterThanOrEqual(hm.bar.x + hm.bar.w);
  });

  it("it clears the colour bar's numbers and title, not just the bar", () => {
    // Clearing the bar alone is not enough: with the default fonts the caption would print straight
    // through the colour bar's numbers. Its labels and rotated title must be cleared too.
    const big = build({
      rowTracks: [{ column: "score", name: "Purity" }],
      colorbarTitle: "expression",
      colorbarFont: { size: 18 },
      valueMin: -1000.25,
      valueMax: 1000.75,
    });
    const hm = big.heatmap!;
    // the widest thing the bar draws to its right: its end numbers, then the rotated title
    const numRight = hm.bar.x + hm.bar.w + 4 + "-1000.25".length * 18 * 0.5;
    const titleRight = hm.bar.x + hm.bar.w + 34 + 18;
    expect(hm.tracks![0]!.key!.nameX, "the key is drawn over the colour bar's own labels")
      .toBeGreaterThanOrEqual(Math.max(numRight, titleRight));
  });

  it("…measured at the size the colour bar is actually drawn at, not the raw default", () => {
    // A preset scales the fonts. Clearing a bar measured at DEFAULTS.legendFont would leave the
    // caption sitting on the bar's numbers whenever the preset's fonts are larger.
    const big = build({ rowTracks: [{ column: "score", name: "Purity" }], valueMin: -1000.25, valueMax: 1000.75 }, { legend: { size: 22 } });
    const hm = big.heatmap!;
    // The size the numbers are drawn at: the legend font, unless the column was capped and the
    // numbers fitted to it (`barFont` then carries the fitted size — see stacked-labels.test).
    const drawn = (hm.barFont ?? { size: 22 }).size;
    expect(drawn).toBeGreaterThanOrEqual(14);
    expect(hm.tracks![0]!.key!.nameX, "the key clears a small bar but not the one on screen")
      .toBeGreaterThanOrEqual(hm.bar.x + hm.bar.w + 4 + "-1000.25".length * drawn * 0.5);
  });

  it("two numeric strips take one slot each, and neither overlaps the other", () => {
    const s = build({ rowTracks: [{ column: "score", name: "A" }], colTracks: [{ name: "B", values: { c0: "1", c1: "2", c2: "3" } }] });
    const keys = s.heatmap!.tracks!.filter((t) => t.key).map((t) => t.key!);
    expect(keys).toHaveLength(2);
    expect(keys[0]!.bar.x, "they stack in one column, not one column each").toBe(keys[1]!.bar.x);
    const [a, b] = [...keys].sort((p, q) => p.bar.y - q.bar.y);
    expect(a!.bar.y + a!.bar.h, "the bars overlap").toBeLessThanOrEqual(b!.nameY - 2);
  });

  it("a stepped ramp keys as a staircase, so the bar says what the strip says", () => {
    // Two stops share an offset at each class edge — the same rule the main colour bar follows.
    const tr = rowStrip({ column: "score", ramp: "viridis" });
    const stops = tr.key!.stops;
    expect(stops.length).toBeGreaterThan(2);
    expect(stops[0]!.offset).toBe(0);
    expect(stops[stops.length - 1]!.offset).toBe(1);
  });

  it("the strip's own ramp paints its key — not the heatmap's colormap", () => {
    const blues = rowStrip({ column: "score", ramp: "blues" }).key!.stops.map((s) => s.color);
    const magma = rowStrip({ column: "score", ramp: "magma" }).key!.stops.map((s) => s.color);
    expect(magma).not.toEqual(blues);
  });
});
