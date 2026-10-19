// Horizontal bar charts: the margins follow the tick fonts the labels are drawn with.
// On a horizontal bar the category names run down the left axis and are drawn
// with the Y tick font (`fonts.yTick`, the axis the Axis tab's "Category label font" writes); the value numbers run
// along the bottom with the X tick font. Guards against sizing both margins from the shared tick font, where a larger
// per-axis size draws names past the left margin and numbers into the bottom one. The vertical case is guarded in
// `bar-points.test.ts`; this is its horizontal twin.
//
// Name outlines use ordinary glyph ratios (0.55 of the font per character, 0.8 above the baseline, 0.2 below), not
// the builder's own text measure.
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene.js";

const table: DataTable = {
  id: "t", kind: "column", name: "T",
  columns: [{ id: "c", name: "Group", role: "x" }, { id: "v", name: "Value", role: "y" }],
  rows: [
    { id: "r0", cells: { c: "Control", v: 5 } },
    { id: "r1", cells: { c: "Low dose", v: 8 } },
    { id: "r2", cells: { c: "Very high dose group", v: 7 } },
  ],
};
const horizontal = (over: Partial<Plot>): Plot => ({
  id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "bar", barOrientation: "horizontal", ...over,
});
const at = (over: Partial<Plot>) => buildPlotScene(table, horizontal(over), { width: 580, height: 400 });

describe("horizontal bar charts: margins follow the per-axis tick fonts", () => {
  it("a larger category-name font reserves a wider left margin", () => {
    const small = at({ xAxis: { title: "Group" }, yAxis: { tickFont: { size: 10 } } });
    const large = at({ xAxis: { title: "Group" }, yAxis: { tickFont: { size: 30 } } });
    expect(large.fonts.yTick.size, "the fixture's names are not drawn larger — it cannot show the margin").toBe(30);
    expect(large.plot.x, "30px names reserved no more room than 10px ones").toBeGreaterThan(small.plot.x);
  });

  it("names drawn at a large per-axis size stay on the figure and clear of the axis title beside them", () => {
    const s = at({ xAxis: { title: "Group" }, yAxis: { tickFont: { size: 30 } } });
    const font = s.fonts.yTick.size;
    const gap = s.axisGaps?.yTick ?? 8;
    const titleFont = s.y.titleFont ?? s.fonts.yAxisTitle.size;
    expect(s.y.titlePos, "no placed title beside the names").toBeTypeOf("number");
    for (const t of s.y.ticks.filter((k) => !k.minor && k.label !== "")) {
      const left = s.plot.x - gap - t.label.length * font * 0.55;
      expect(left, `"${t.label}" runs off the left of the figure`).toBeGreaterThanOrEqual(0);
      // The side title is drawn turned −90° about titlePos: its glyphs reach 0.2 of its size to the right.
      expect(s.y.titlePos! + 0.2 * titleFont, `the title sits on "${t.label}"`).toBeLessThanOrEqual(left);
    }
  });

  it("larger value numbers reserve a taller bottom band, and the left margin does not move", () => {
    const small = at({ yAxis: { title: "Value" }, xAxis: { tickFont: { size: 10 } } });
    const large = at({ yAxis: { title: "Value" }, xAxis: { tickFont: { size: 30 } } });
    expect(large.fonts.xTick.size, "the fixture's numbers are not drawn larger — it cannot show the margin").toBe(30);
    const bottomBand = (sc: typeof small) => sc.height - (sc.plot.y + sc.plot.height);
    expect(bottomBand(large), "30px numbers reserved no more room than 10px ones").toBeGreaterThan(bottomBand(small));
    expect(large.plot.x, "the value font moved the left margin").toBe(small.plot.x);
  });
});
