// One dot of a box / violin swarm with its own look: each dot knows its table row (`pointRows`), and a point style
// keyed by series and row (`Plot.pointStyles["m:r2"]`) reaches that dot alone (`pointLooks`).
import { describe, expect, it } from "vitest";
import type { DataTable, Plot, SeriesStyle } from "@mady/core";
import { buildPlotScene } from "./buildScene.js";
import type { PlotScene } from "./scene.js";

const SIZE = { width: 640, height: 420 };
const VALUES = [3, -8, 11, 0, 6, -2, 9];
const table: DataTable = {
  id: "t", kind: "column", name: "T",
  columns: [{ id: "m", name: "Mice", role: "y" }, { id: "s", name: "Shuffled", role: "y" }],
  rows: VALUES.map((v, i) => ({ id: `r${i}`, cells: { m: v, s: i % 2 } })),
};
const build = (kind: "box" | "violin", pointStyles: Record<string, SeriesStyle> = {}, over: Partial<Plot> = {}): PlotScene =>
  buildPlotScene(table, { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind, showBoxPoints: true, pointStyles, ...over } as Plot, SIZE);
const markOf = (s: PlotScene, id: string) => s.series.find((x) => x.id === id)!.marks[0]!;

for (const kind of ["box", "violin"] as const) {
  describe(`${kind}: one dot's own look`, () => {
    it("each dot knows its row: the dot's height orders the rows by value", () => {
      const m = markOf(build(kind), "m");
      expect(m.pointRows!.length).toBe(VALUES.length);
      // Higher value = higher on the page = smaller pixel y.
      const byPixel = m.points!.map((p, i) => ({ y: p.cy, v: VALUES[Number(m.pointRows![i]!.slice(1))]! }));
      for (const a of byPixel) for (const b of byPixel) if (a.v > b.v) expect(a.y).toBeLessThan(b.y);
    });

    it("no point styles: no dot has a look of its own", () => {
      expect(markOf(build(kind), "m").pointLooks).toBeUndefined();
    });

    it("an open fill on row r2 reaches that dot alone", () => {
      const m = markOf(build(kind, { "m:r2": { symbolFill: "open" } }), "m");
      m.pointRows!.forEach((row, i) => {
        if (row === "r2") expect(m.pointLooks![i]).toEqual({ symbolFill: "open" });
        else expect(m.pointLooks![i]).toBeUndefined();
      });
    });

    it("the other series is untouched, and the box's own style key still styles the box only", () => {
      const s = build(kind, { "m:r2": { symbolFill: "open" }, "m:m": { fillColor: "#ff0000" } });
      expect(markOf(s, "s").pointLooks).toBeUndefined();
      expect(markOf(s, "m").pointLooks!.filter(Boolean).length).toBe(1);
    });

    it("two-tone on one dot is worked out from its colour and drawn as an open marker", () => {
      const m = markOf(build(kind, { "m:r0": { symbolFill: "twotone", pointColor: "#3366cc" } }), "m");
      const look = m.pointLooks![m.pointRows!.indexOf("r0")]!;
      expect(look.symbolFill).toBe("open");
      expect(look.symbolFillColor).toBeDefined();
      expect(look.symbolOutline).toBeDefined();
      expect(look.symbolFillColor).not.toBe(look.symbolOutline);
    });
  });
}

it("box, horizontal: dots know their rows and looks too", () => {
  const m = markOf(build("box", { "m:r4": { symbolFill: "open" } }, { barOrientation: "horizontal" }), "m");
  expect(m.pointLooks![m.pointRows!.indexOf("r4")]).toEqual({ symbolFill: "open" });
  // Along X here: a higher value is further right.
  const at = (r: string) => m.points![m.pointRows!.indexOf(r)]!.cx;
  expect(at("r2")).toBeGreaterThan(at("r1")); // 11 > −8
});
