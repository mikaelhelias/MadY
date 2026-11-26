// "Each row is a mean ± error" (`SeriesStyle.pointErrors`): a box / violin group entered as mean ± error is read as one
// subject's mean per row. The box is drawn from the means, and each dot carries its own row's error line.
import { describe, expect, it } from "vitest";
import type { DataTable, Plot, SeriesStyle } from "@mady/core";
import { buildPlotScene } from "./buildScene.js";
import type { PlotScene } from "./scene.js";

const SIZE = { width: 640, height: 420 };
// Six mice: mean in `m`, its SEM in `e` (grouped with `m`). Distinct means so each dot can be matched to its row.
const MEANS = [-20, -10, -5, 0, 4, 12];
const SEMS = [3, 1, 6, 2, 0, 4];
const table: DataTable = {
  id: "t", kind: "column", name: "T",
  columns: [{ id: "m", name: "Mice", role: "y" }, { id: "e", name: "SEM", role: "sem", group: "m" }, { id: "s", name: "Shuffled", role: "y" }],
  rows: MEANS.map((v, i) => ({ id: `r${i}`, cells: { m: v, e: SEMS[i]!, s: (i % 3) - 1 } })),
};
const build = (kind: "box" | "violin", m: SeriesStyle, over: Partial<Plot> = {}): PlotScene =>
  buildPlotScene(table, { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind, seriesStyles: { m }, ...over } as Plot, SIZE);
const markOf = (s: PlotScene, id: string) => s.series.find((x) => x.id === id)!.marks[0];

for (const kind of ["box", "violin"] as const) {
  describe(`${kind}: each row is a mean ± error`, () => {
    it("off: the group draws no box and the warning names the option (today's refusal, kept)", () => {
      const s = build(kind, { showPoints: true });
      const m = markOf(s, "m");
      expect(m?.box ?? m?.violin).toBeUndefined();
      expect(s.warnings.some((w) => w.includes("Mice") && w.includes("Each row is a mean ± error"))).toBe(true);
    });

    it("on: the box is drawn from the row means, with no warning about the group", () => {
      const s = build(kind, { pointErrors: true });
      const m = markOf(s, "m")!;
      expect(m.box ?? m.violin).toBeDefined();
      expect(s.warnings.some((w) => w.includes("Mice") && w.includes("mean±error"))).toBe(false);
    });

    it("on, with dots: each dot carries its own row's error line, mean − SEM to mean + SEM", () => {
      const s = build(kind, { pointErrors: true, showPoints: true });
      const m = markOf(s, "m")!;
      const pts = m.points!;
      expect(pts.length).toBe(6);
      expect(m.pointErrors!.length).toBe(6);
      // The means are distinct, so a dot's height says which row it is: the highest dot is the largest mean.
      const byHeight = [...pts.keys()].sort((a, b) => pts[a]!.cy - pts[b]!.cy);
      const desc = [...MEANS].sort((a, b) => b - a);
      const vOfDot = (k: number) => desc[byHeight.indexOf(k)]!;
      // Read the axis back from the top and bottom dots: value = v0 + (pixel − y0) / slope.
      const [top, bottom] = [byHeight[0]!, byHeight[byHeight.length - 1]!];
      const slope = (pts[bottom]!.cy - pts[top]!.cy) / (vOfDot(bottom) - vOfDot(top));
      const val = (px: number) => vOfDot(top) + (px - pts[top]!.cy) / slope;
      pts.forEach((_, i) => {
        const row = MEANS.indexOf(vOfDot(i));
        const e = m.pointErrors![i]!;
        expect(Math.min(val(e.low), val(e.high))).toBeCloseTo(MEANS[row]! - SEMS[row]!, 6);
        expect(Math.max(val(e.low), val(e.high))).toBeCloseTo(MEANS[row]! + SEMS[row]!, 6);
      });
    });

    it("on, without dots: no error lines (they belong to the dots)", () => {
      const m = markOf(build(kind, { pointErrors: true }), "m")!;
      expect(m.points).toBeUndefined();
      expect(m.pointErrors).toBeUndefined();
    });
  });
}

it("box, horizontal: the error lines run along X, matching the dots there", () => {
  const s = build("box", { pointErrors: true, showPoints: true }, { barOrientation: "horizontal" });
  const m = markOf(s, "m")!;
  expect(m.pointErrors!.length).toBe(6);
  m.points!.forEach((p, i) => {
    const e = m.pointErrors![i]!;
    expect(Math.min(e.low, e.high)).toBeLessThanOrEqual(p.cx);
    expect(Math.max(e.low, e.high)).toBeGreaterThanOrEqual(p.cx);
  });
  // The mouse with SEM 0 has a zero-length line; every other one has length.
  expect(m.pointErrors!.filter((e) => e.low === e.high).length).toBe(1);
});

it("a group of raw values is untouched by the option: no error lines", () => {
  const raw: DataTable = { ...table, columns: [{ id: "m", name: "Mice", role: "y" }, { id: "s", name: "Shuffled", role: "y" }] };
  const s = buildPlotScene(raw, { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "box", seriesStyles: { m: { pointErrors: true, showPoints: true } } } as Plot, SIZE);
  expect(markOf(s, "m")!.pointErrors).toBeUndefined();
});
