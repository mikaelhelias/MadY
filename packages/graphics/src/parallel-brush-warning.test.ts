// A parallel-coordinates brush keeps the lines inside its range bright and dims the rest. A brush wholly outside its axis's
// range dims every line and has no rectangle to show why, so the scene says so.
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene";

const NAMES = ["Alcohol", "Malic acid", "Ash"];
const table: DataTable = {
  id: "pc", kind: "multivariable", name: "Wine",
  columns: [{ id: "s", name: "Sample", role: "x" }, ...NAMES.map((n, j) => ({ id: `c${j}`, name: n, role: "y" as const }))],
  rows: Array.from({ length: 20 }, (_, i) => ({ id: `r${i}`, cells: { s: `W${i}`, ...Object.fromEntries(NAMES.map((_n, j) => [`c${j}`, 11 + ((i * (j + 3)) % 9) * 0.5 + j * 4])) } })),
};
const build = (parallel: NonNullable<Plot["parallel"]>) =>
  buildPlotScene(table, { id: "p", name: "P", source: "pc", status: "ok", styleOverrides: {}, kind: "parallel", figureWidth: 600, figureHeight: 420, parallel }, { width: 600, height: 420 });
const brushWarnings = (parallel: NonNullable<Plot["parallel"]>): string[] => (build(parallel).warnings ?? []).filter((w) => /brush/i.test(w));

describe("a brush outside its axis", () => {
  it("wholly outside the axis range: one warning naming the axis, the brush and the axis range", () => {
    const w = brushWarnings({ brushes: { c0: [0.3, 0.9] } });
    expect(w.length).toBe(1);
    expect(w[0]).toContain("Alcohol");
    expect(w[0]).toContain("0.3");
    expect(w[0]).toMatch(/every line|all lines/i);
  });

  it("above the axis is outside too", () => {
    expect(brushWarnings({ brushes: { c1: [500, 900] } }).length).toBe(1);
  });

  it("partly outside: it is cut to the axis and keeps the lines inside it, so nothing to warn about", () => {
    expect(brushWarnings({ brushes: { c0: [12, 500] } })).toEqual([]);
  });

  it("inside the axis: no warning", () => {
    expect(brushWarnings({ brushes: { c0: [12, 13] } })).toEqual([]);
  });

  it("no brush: no warning", () => {
    expect(brushWarnings({})).toEqual([]);
  });

  it("the lines are dimmed: a brush outside the range keeps no line bright", () => {
    const s = build({ brushes: { c0: [0.3, 0.9] } });
    expect(s.parallel!.lines.length).toBeGreaterThan(0);
    expect(s.parallel!.lines.every((l) => l.dim === true)).toBe(true);
  });
});
