// A histogram with proportional-width bins draws its bins on a number axis. Its labels: one per bin edge while they all
// fit side by side (a few custom bins, whose edges are the point); otherwise the ordinary number ticks, so a hundred bins
// do not print a hundred labels on top of each other.
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene, edgeLabelsFit } from "./buildScene.js";

const SIZE = { width: 500, height: 320 };
const values = Array.from({ length: 1000 }, (_, i) => ((i * 37) % 1000) / 1000);
const table: DataTable = { id: "t", kind: "column", name: "T", columns: [{ id: "v", name: "Score", role: "y" }], rows: values.map((v, i) => ({ id: `r${i}`, cells: { v } })) };
const hist = (histogram: Plot["histogram"]): Plot => ({ id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "histogram", histogram }) as Plot;
const measure = (s: string, px: number): number => s.length * px * 0.6;

describe("proportional-width histogram labels", () => {
  it("100 bins: a handful of number ticks that do not overlap, not 101 edge labels", () => {
    const s = buildPlotScene(table, hist({ bins: 100, proportionalWidth: true }), SIZE);
    const major = s.x.ticks.filter((t) => !t.minor && t.label);
    expect(major.length).toBeGreaterThan(2);
    expect(major.length).toBeLessThan(15);
    expect(edgeLabelsFit(major, measure, s.fonts.xTick.size)).toBe(true);
  });

  it("4 custom bins of different widths: every edge keeps its label", () => {
    const s = buildPlotScene(table, hist({ binRanges: [[0, 0.1], [0.1, 0.3], [0.3, 0.6], [0.6, 1]], proportionalWidth: true }), SIZE);
    expect(s.x.ticks.map((t) => t.value)).toEqual([0, 0.1, 0.3, 0.6, 1]);
  });
});

describe("edgeLabelsFit", () => {
  it("labels far enough apart fit; labels closer than half their widths plus a gap do not", () => {
    expect(edgeLabelsFit([{ pos: 0, label: "0.0" }, { pos: 40, label: "0.5" }], measure, 10)).toBe(true);
    expect(edgeLabelsFit([{ pos: 0, label: "0.0" }, { pos: 10, label: "0.5" }], measure, 10)).toBe(false);
  });
});
