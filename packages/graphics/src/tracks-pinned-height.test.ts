// Timeline tracks: with a pinned strip height the Y is a fixed stack of strips — its height is the strips' heights plus the
// gaps between them. The plot is exactly that tall, so the x axis sits right under the last strip, and the figure follows it
// (shorter, or taller if the stack needs it) instead of leaving the strips at the top of a frame that runs on below them.
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene";

const table: DataTable = {
  id: "tt", kind: "xy", name: "T",
  columns: [{ id: "t", name: "Week", role: "x" }, { id: "diet", name: "Diet", role: "y" }, { id: "shan", name: "Shannon", role: "y" }, { id: "bac", name: "Bacteroides", role: "y" }],
  rows: Array.from({ length: 14 }, (_, i) => ({ id: `r${i}`, cells: { t: i, diet: i < 5 ? "Chow" : "High-fat", shan: 2 + (i % 5) * 0.4, bac: 20 + i * 2 } })),
};
const build = (tracks?: NonNullable<Plot["tracks"]>, h = 360, over: Partial<Plot> = {}) =>
  buildPlotScene(table, { id: "p", name: "P", source: "tt", status: "ok", styleOverrides: {}, kind: "tracks", figureHeight: h, ...(tracks ? { tracks } : {}), ...over }, { width: 780, height: h });
const N = 3; // Diet, Shannon, Bacteroides

describe("a pinned strip height", () => {
  it("makes the plot exactly the stack: the strips' heights plus the gaps between them", () => {
    const s = build({ trackHeight: 34 });
    expect(s.plot.height).toBeCloseTo(N * 34 + (N - 1) * 4, 6);
  });

  it("the last strip ends at the plot's foot, where the x axis is", () => {
    const s = build({ trackHeight: 34 });
    const last = s.tracks!.strips[N - 1]!;
    expect(last.y + last.h).toBeCloseTo(s.plot.y + s.plot.height, 6);
  });

  it("the figure follows the stack: shorter than asked when the stack is, with the same room below for the axis", () => {
    const s = build({ trackHeight: 34 });
    const free = build(undefined);
    expect(s.height).toBeLessThan(360);
    expect(s.height - (s.plot.y + s.plot.height)).toBeCloseTo(free.height - (free.plot.y + free.plot.height), 6);
    expect(s.plot.y).toBeCloseTo(free.plot.y, 6);
  });

  it("a stack taller than the figure makes the figure taller, never overflowing the plot", () => {
    const s = build({ trackHeight: 200 });
    expect(s.height).toBeGreaterThan(360);
    const last = s.tracks!.strips[N - 1]!;
    expect(last.y + last.h).toBeLessThanOrEqual(s.plot.y + s.plot.height + 0.01);
    expect(s.plot.height).toBeCloseTo(N * 200 + (N - 1) * 4, 6);
  });

  it("follows the strip gap too", () => {
    expect(build({ trackHeight: 34, trackGap: 0 }).plot.height).toBeCloseTo(N * 34, 6);
    expect(build({ trackHeight: 34, trackGap: 10 }).plot.height).toBeCloseTo(N * 34 + (N - 1) * 10, 6);
  });
});

describe("no pinned strip height", () => {
  it("the strips share the plot, and the figure is the size asked for", () => {
    const s = build(undefined);
    expect(s.height).toBe(360);
    const last = s.tracks!.strips[N - 1]!;
    expect(last.y + last.h).toBeCloseTo(s.plot.y + s.plot.height, 6);
  });

  it("other tracks settings do not pin it", () => {
    expect(build({ trackGap: 6, tileGap: 1 }).height).toBe(360);
  });
});
