// Horizontal box / violin / column scatter / floating bar: the bottom band follows the font the numbers are drawn
// with (the distribution charts' bottom band margin, like the bar chart's). On these flipped charts the value numbers
// run along the bottom and are drawn with the X tick font (`fonts.xTick`); sizing their band from the shared tick
// font would let larger numbers run into the value-axis title under them. The horizontal bar twin is
// `horizontal-tick-fonts.test.ts`.
//
// Outlines use ordinary glyph ratios (0.8 of the font above the baseline, 0.2 below), not the builder's own measure.
// Where the renderer draws them: a flat number's baseline sits `font + gap` below the plot; the bottom title's
// baseline sits 7px above the figure's lower edge.
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene.js";

const table: DataTable = {
  id: "t", kind: "column", name: "T",
  columns: [{ id: "c", name: "Row", role: "x" }, { id: "a", name: "Control", role: "y" }, { id: "b", name: "Treated", role: "y" }],
  rows: [
    { id: "r1", cells: { c: "1", a: 5, b: 8 } },
    { id: "r2", cells: { c: "2", a: 9, b: 4 } },
    { id: "r3", cells: { c: "3", a: 6, b: 7 } },
    { id: "r4", cells: { c: "4", a: 3, b: 9 } },
  ],
};
const KINDS = ["box", "violin", "scatter", "floatingbar"] as const;
const at = (kind: (typeof KINDS)[number], over: Partial<Plot>) =>
  buildPlotScene(table, { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind, barOrientation: "horizontal", ...over } as Plot, { width: 580, height: 400 });
const bottomBand = (s: ReturnType<typeof at>) => s.height - (s.plot.y + s.plot.height);

describe.each(KINDS)("horizontal %s: the bottom band follows the value numbers' font", (kind) => {
  it("larger numbers reserve a taller bottom band, and the left margin does not move", () => {
    const small = at(kind, { yAxis: { title: "Value" }, xAxis: { tickFont: { size: 10 } } });
    const large = at(kind, { yAxis: { title: "Value" }, xAxis: { tickFont: { size: 30 } } });
    expect(large.distHorizontal, "the fixture did not build the horizontal form").toBe(true);
    expect(large.fonts.xTick.size, "the fixture's numbers are not drawn larger — it cannot show the margin").toBe(30);
    expect(bottomBand(large), "30px numbers reserved no more room than 10px ones").toBeGreaterThan(bottomBand(small));
    expect(large.plot.x, "the value font moved the left margin").toBe(small.plot.x);
  });

  it("numbers drawn at a large per-axis size stay clear of the value-axis title below them", () => {
    const s = at(kind, { yAxis: { title: "Value" }, xAxis: { tickFont: { size: 30 } } });
    const font = s.fonts.xTick.size;
    const gap = s.axisGaps?.xTick ?? 6;
    const numbersBottom = s.plot.y + s.plot.height + font + gap + 0.2 * font;
    const titleFont = s.x.titleFont ?? s.fonts.xAxisTitle.size;
    const titleTop = (s.x.titlePos ?? s.height - 7) - 0.8 * titleFont;
    expect(s.x.ticks.some((t) => !t.minor && t.label !== ""), "no numbers drawn along the bottom").toBe(true);
    expect(numbersBottom, "the numbers sit on the title").toBeLessThanOrEqual(titleTop);
  });
});
