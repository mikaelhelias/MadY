// Dots on one box (or violin) only: a series' own "Show points" (`SeriesStyle.showPoints`) wins over the graph's
// "Show all points" (`Plot.showBoxPoints`), both ways. A group of 1,500 resampled values beside 15 measured ones is the
// case: the 15 are shown as dots, the 1,500 only as their box.
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene.js";
import type { PlotScene } from "./scene.js";

const SIZE = { width: 640, height: 420 };
const table: DataTable = {
  id: "t", kind: "column", name: "T",
  columns: [{ id: "a", name: "Measured", role: "y" }, { id: "b", name: "Shuffled", role: "y" }, { id: "c", name: "Third", role: "y" }],
  rows: Array.from({ length: 12 }, (_, i) => ({ id: `r${i}`, cells: { a: i, b: 20 - i * 0.5, c: 5 + (i % 4) } })),
};
const build = (kind: "box" | "violin", over: Partial<Plot>): PlotScene =>
  buildPlotScene(table, { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind, ...over } as Plot, SIZE);
const dots = (s: PlotScene, id: string): number =>
  s.series.find((x) => x.id === id)!.marks.reduce((n, m) => n + (m.points?.length ?? 0), 0);

for (const kind of ["box", "violin"] as const) {
  describe(`${kind}: dots per series`, () => {
    it("the graph's switch alone: all or none (today's behaviour, and the fixture draws dots when asked)", () => {
      const on = build(kind, { showBoxPoints: true });
      for (const id of ["a", "b", "c"]) expect(dots(on, id)).toBe(12);
      const off = build(kind, {});
      for (const id of ["a", "b", "c"]) expect(dots(off, id)).toBe(0);
    });

    it("graph on, one series off: that series has no dots, the others keep theirs", () => {
      const s = build(kind, { showBoxPoints: true, seriesStyles: { b: { showPoints: false } } });
      expect(dots(s, "b")).toBe(0);
      expect(dots(s, "a")).toBe(12);
      expect(dots(s, "c")).toBe(12);
    });

    it("graph off, one series on: only that series has dots", () => {
      const s = build(kind, { seriesStyles: { a: { showPoints: true } } });
      expect(dots(s, "a")).toBe(12);
      expect(dots(s, "b")).toBe(0);
      expect(dots(s, "c")).toBe(0);
    });

    it("two series off does not take a third, unstyled one with them", () => {
      const s = build(kind, { showBoxPoints: true, seriesStyles: { a: { showPoints: false }, b: { showPoints: false } } });
      expect(dots(s, "c")).toBe(12);
    });
  });
}

it("box: a series without dots keeps drawing its outliers; one with dots shows them as dots instead", () => {
  const outl: DataTable = {
    id: "t", kind: "column", name: "O",
    columns: [{ id: "a", name: "A", role: "y" }, { id: "b", name: "B", role: "y" }],
    rows: [...Array.from({ length: 11 }, (_, i) => ({ id: `r${i}`, cells: { a: 10 + (i % 3), b: 10 + (i % 3) } })), { id: "rx", cells: { a: 90, b: 90 } }],
  };
  const s = buildPlotScene(outl, { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "box", showBoxPoints: true, seriesStyles: { b: { showPoints: false } } } as Plot, SIZE);
  const box = (id: string) => s.series.find((x) => x.id === id)!.marks[0]!.box!;
  expect(box("a").outliers).toEqual([]);
  expect(box("b").outliers.length).toBe(1);
});
