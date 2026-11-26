// The second and third value axes carry their own title font. Their titles are sized, placed and drawn with
// that font, and the Axis tab's Y2/Y3 title-font block writes it, so a larger Y2 title can be set without
// enlarging the Y title too.
//
// Each axis reads its own `titleFont` first; a field it does not set follows the main Y axis's title font, then
// the chart-wide one. A graph with no second-axis font of its own keeps the main Y axis's look.
//
// Glyph outlines use ordinary ratios (0.8 of the font above the baseline, 0.2 below), not the builder's measure.
// A right-hand title is drawn turned 90° about `titleX`, so its glyphs reach 0.8 of its size to the right of it.
import { describe, expect, it } from "vitest";
import type { DataTable, FontSpec, Plot, SeriesStyle } from "@mady/core";
import type { AxisScene, PlotScene } from "./scene";
import { axisTitleFontSpec, buildPlotScene } from "./buildScene";

const OWN = 34;

describe("axisTitleFontSpec — which title font an axis draws with", () => {
  const plot = {
    fonts: { axisTitle: { size: 22, family: "Georgia" } },
    yAxis: { titleFont: { size: 26, bold: true } },
    y2Axis: { titleFont: { size: OWN } },
  } as Partial<Plot> as Plot;
  const pick = (f: FontSpec | undefined) => ({ size: f?.size, family: f?.family, bold: f?.bold });

  it("Y2's own field wins; the fields it does not set follow the main Y title font, then the chart-wide one", () => {
    expect(pick(axisTitleFontSpec(plot, "y2"))).toEqual({ size: OWN, family: "Georgia", bold: true });
  });
  it("Y3 with no font of its own draws exactly as the main Y title", () => {
    expect(pick(axisTitleFontSpec(plot, "y3"))).toEqual(pick(axisTitleFontSpec(plot, "y")));
  });
  it("Y2's own font does not reach the main Y or the X title", () => {
    expect(pick(axisTitleFontSpec(plot, "y"))).toEqual({ size: 26, family: "Georgia", bold: true });
    expect(pick(axisTitleFontSpec(plot, "x"))).toEqual({ size: 22, family: "Georgia", bold: undefined });
  });
  it("nothing set anywhere → nothing (the builder's default applies)", () => {
    expect(axisTitleFontSpec({} as Plot, "y2")).toBeUndefined();
  });
});

// ---- fixtures ---------------------------------------------------------------------------------------------------
const xyTable: DataTable = {
  id: "t", kind: "xy", name: "T",
  columns: [{ id: "x", name: "X" }, { id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }],
  rows: [
    { id: "r0", cells: { x: 1, a: 10, b: 1000, c: 0.1 } },
    { id: "r1", cells: { x: 2, a: 20, b: 2000, c: 0.2 } },
    { id: "r2", cells: { x: 3, a: 30, b: 3000, c: 0.3 } },
  ],
};
const barTable: DataTable = {
  id: "t", kind: "column", name: "T",
  columns: [{ id: "g", name: "Group", role: "x" }, { id: "bar", name: "Sales", role: "y" }, { id: "line", name: "Trend", role: "y" }],
  rows: [
    { id: "r1", cells: { g: "A", bar: 2, line: 300 } },
    { id: "r2", cells: { g: "B", bar: 6, line: 500 } },
    { id: "r3", cells: { g: "C", bar: 10, line: 400 } },
  ],
};
const distTable = {
  id: "t", kind: "column", name: "T",
  columns: [{ id: "w", name: "Weight (g)", role: "y" }, { id: "h", name: "Height (cm)", role: "y" }],
  rows: [2, 4, 6, 8, 10].map((w, i) => ({ id: `r${i}`, cells: { w, h: [150, 165, 172, 181, 190][i]! } })),
} as unknown as DataTable;
const estTable: DataTable = {
  id: "t", kind: "multivariable", name: "T",
  columns: [{ id: "ctrl", name: "Control" }, { id: "test", name: "Test" }],
  rows: [[10, 15], [12, 17], [11, 15], [13, 19], [10, 14], [12, 18]].map(([c, t], i) => ({ id: `r${i}`, cells: { ctrl: c!, test: t! } })),
};

type Case = { name: string; table: DataTable; plot: Partial<Plot>; axis: "y2" | "y3"; side: "right" | "top" };
const styles = (s: Record<string, SeriesStyle>) => ({ seriesStyles: s });
const CASES: Case[] = [
  { name: "XY, Y2", table: xyTable, plot: { kind: "xy", ...styles({ b: { axis: "y2" } }), y2Axis: { title: "B units" } }, axis: "y2", side: "right" },
  { name: "XY, Y3 (outside Y2)", table: xyTable, plot: { kind: "xy", ...styles({ b: { axis: "y2" }, c: { axis: "y3" } }), y2Axis: { title: "B units" }, y3Axis: { title: "C units" } }, axis: "y3", side: "right" },
  { name: "estimation, the Difference axis", table: estTable, plot: { kind: "estimation" }, axis: "y2", side: "right" },
  { name: "vertical bar, Y2", table: barTable, plot: { kind: "bar", ...styles({ line: { plotAs: "line", axis: "y2" } }), y2Axis: { title: "Trend" } }, axis: "y2", side: "right" },
  { name: "vertical box, Y2", table: distTable, plot: { kind: "box", ...styles({ h: { axis: "y2" } }), y2Axis: { title: "Height" } }, axis: "y2", side: "right" },
  { name: "horizontal bar, X2 along the top", table: barTable, plot: { kind: "bar", barOrientation: "horizontal", ...styles({ line: { plotAs: "line", axis: "y2" } }), y2Axis: { title: "Trend" } }, axis: "y2", side: "top" },
  { name: "horizontal box, X2 along the top", table: distTable, plot: { kind: "box", barOrientation: "horizontal", ...styles({ h: { axis: "y2" } }), y2Axis: { title: "Height" } }, axis: "y2", side: "top" },
];

const build = (c: Case, over: Partial<Plot> = {}): PlotScene => {
  const axisKey = c.axis === "y2" ? "y2Axis" : "y3Axis";
  const base = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, ...c.plot } as Plot;
  const merged = { ...base, ...over, [axisKey]: { ...(base[axisKey] ?? {}), ...(over[axisKey] ?? {}) } } as Plot;
  return buildPlotScene(c.table, merged, { width: 620, height: 420 });
};
const axisOf = (s: PlotScene, c: Case): AxisScene => {
  const ax = c.axis === "y2" ? s.y2 : s.y3;
  if (!ax) throw new Error(`${c.name}: the fixture drew no ${c.axis} axis`);
  return ax;
};
const rightBand = (s: PlotScene) => s.width - (s.plot.x + s.plot.width);
const withOwn = (c: Case, size = OWN): Partial<Plot> => ({ [c.axis === "y2" ? "y2Axis" : "y3Axis"]: { titleFont: { size } } });

describe.each(CASES)("$name: the axis title has its own font", (c) => {
  it("a larger own title font reserves more room, and the title stays on the figure", () => {
    const plain = build(c);
    const own = build(c, withOwn(c));
    const ax = axisOf(own, c);
    expect(ax.title, "the fixture's axis has no title — it cannot show the font").toBeTruthy();
    if (c.side === "right") {
      expect(rightBand(own), `a ${OWN}px own title reserved no more room than the default`).toBeGreaterThan(rightBand(plain));
      expect(ax.titleX, "no placed title").toBeTypeOf("number");
      expect(ax.titleX! + 0.8 * OWN, "the title runs off the right of the figure").toBeLessThanOrEqual(own.width);
    } else {
      expect(own.plot.y, `a ${OWN}px own title reserved no more room above the plot than the default`).toBeGreaterThan(plain.plot.y);
      expect(ax.titlePos, "no placed title").toBeTypeOf("number");
      expect(ax.titlePos! - 0.8 * OWN, "the title runs off the top of the figure").toBeGreaterThanOrEqual(0);
    }
  });

  it("the scene carries the font the renderer draws the title with", () => {
    const own = build(c, withOwn(c));
    expect((c.axis === "y2" ? own.fonts.y2AxisTitle : own.fonts.y3AxisTitle)?.size).toBe(OWN);
  });

  it("the main value axis is untouched: same title font, same margin on its side", () => {
    const plain = build(c);
    const own = build(c, withOwn(c));
    expect(own.fonts.yAxisTitle.size).toBe(plain.fonts.yAxisTitle.size);
    expect(own.fonts.xAxisTitle.size).toBe(plain.fonts.xAxisTitle.size);
    expect(own.plot.x, "the left margin moved").toBe(plain.plot.x);
    if (c.side === "right") expect(own.height - (own.plot.y + own.plot.height), "the bottom band moved").toBe(plain.height - (plain.plot.y + plain.plot.height));
  });

  it("with no font of its own, the axis title still follows the main Y title font — saved graphs keep their look", () => {
    const mainOnly = build(c, { yAxis: { ...(c.plot.yAxis ?? {}), titleFont: { size: 26 } } });
    const both = build(c, { yAxis: { ...(c.plot.yAxis ?? {}), titleFont: { size: 26 } }, ...withOwn(c, 26) });
    // Absent, not merely equal: the scene of a graph that never set a second-axis font must stay byte-identical to
    // a scene without the field — every built-in preset × gallery card is fingerprinted
    // (preset-invariance.test.ts), and writing the field on every scene would change all of those fingerprints.
    expect(mainOnly.fonts.y2AxisTitle, "a Y2 title font was written into a scene that set none").toBeUndefined();
    expect(mainOnly.fonts.y3AxisTitle, "a Y3 title font was written into a scene that set none").toBeUndefined();
    expect(c.side === "right" ? rightBand(mainOnly) : mainOnly.plot.y, "with no font of its own the title did not get the main Y title's room").toBe(c.side === "right" ? rightBand(both) : both.plot.y);
  });
});

describe("XY with Y2 and Y3: each title's font moves only its own axis", () => {
  const c = CASES[1]!;
  it("a larger Y3 title leaves the Y2 title where it was beside its own axis", () => {
    const plain = build(c);
    const own = build(c, withOwn(c));
    // Measured from the plot's right edge: the figure keeps its width, so a larger Y3 title narrows the plot and
    // moves everything beside it; Y2's own band must not change.
    const fromPlotEdge = (s: PlotScene) => s.y2!.titleX! - (s.plot.x + s.plot.width);
    expect(fromPlotEdge(own), "Y3's font changed the room beside Y2").toBe(fromPlotEdge(plain));
    expect(own.fonts.y2AxisTitle, "Y3's own font reached Y2").toBeUndefined();
  });
});
