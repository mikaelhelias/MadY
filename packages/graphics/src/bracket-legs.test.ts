/**
 * Significance brackets whose legs reach the bars: an option for the
 * brackets' legs to go down and reach low bars; without it, every bracket's legs are identical
 * and stay on top.
 *
 * `significance.legs = "reach"`: each leg runs from the bracket bar down to 4 px above the ink
 * under its own end (bar top · error-bar tip · swarm point). Default "equal" = the flat bracket,
 * byte-identical to leaving the option unset.
 */
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene";

const table: DataTable = {
  id: "t", kind: "column", name: "T",
  columns: [{ id: "c", name: "Group", role: "x" }, { id: "a", name: "Tall", role: "y" }, { id: "b", name: "Short", role: "y" }],
  rows: [{ id: "r1", cells: { c: "A", a: 90, b: 20 } }],
};
// A grouped bar: category 1 holds two side-by-side bars, tall (Tall) and short (Short).
// showBarPoints off: the pure bar geometry (a drawn dot on the bar top is ink the legs must clear
// too — covered by its own case below).
const plot = (over: Partial<Plot> = {}): Plot => ({
  id: "p", name: "P", source: "t", kind: "bar", barLayout: "grouped", showBarPoints: false,
  annotations: [{ id: "br", kind: "bracket", from: 1, to: 1, fromSeries: 1, toSeries: 2, bracketY: 100, label: "*" }],
  ...over,
}) as Plot;
const build = (over: Partial<Plot> = {}) => buildPlotScene(table, plot(over), { width: 600, height: 400 });

/** The two leg lengths from the bracket path "M x1,y1+t1 L x1,y1 L x2,y2 L x2,y2+t2". */
function legs(path: string): { t1: number; t2: number; bar: number } {
  const nums = [...path.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])] as const);
  const [p0, p1, , p3] = nums;
  return { t1: p0![1] - p1![1], t2: p3![1] - nums[2]![1], bar: p1![1] };
}

describe("bracket legs", () => {
  it("default (equal): both legs are the tick length, the same as unset", () => {
    const s = build();
    const br = s.annotations.find((a) => a.id === "br")!;
    const l = legs(br.path!);
    expect(l.t1).toBeCloseTo(6, 3);
    expect(l.t2).toBeCloseTo(6, 3);
    expect(build({ significance: { legs: "equal" } }).annotations.find((a) => a.id === "br")!.path).toBe(br.path);
  });

  it("reach: the leg over the short bar is long (down to 4 px above its top), the tall bar's stays short", () => {
    const s = build({ significance: { legs: "reach" } });
    const br = s.annotations.find((a) => a.id === "br")!;
    const l = legs(br.path!);
    const tall = s.series[0]!.marks[0]!.bar!;
    const short = s.series[1]!.marks[0]!.bar!;
    expect(short.y).toBeGreaterThan(tall.y); // fixture: the short bar's top is lower on screen
    // Leg 1 (over Tall) ends 4 px above the tall bar's top; leg 2 (over Short) ends 4 px above the short bar's top.
    expect(l.bar + l.t1).toBeCloseTo(tall.y - 4, 3);
    expect(l.bar + l.t2).toBeCloseTo(short.y - 4, 3);
    expect(l.t2).toBeGreaterThan(l.t1 + 20);
    // …and never shorter than the tick: a bracket sitting right on a bar keeps its 6 px.
    expect(l.t1).toBeGreaterThanOrEqual(6);
  });

  it("reach: an error bar or a swarm point above the bar pushes the leg's end up to clear it", () => {
    const withErr: DataTable = {
      ...table,
      columns: [{ id: "c", name: "Group", role: "x" }, { id: "a", name: "Tall", role: "y" }, { id: "b", name: "Short", role: "y" }, { id: "b2", name: "Short 2", role: "y", group: "b" }],
      rows: [{ id: "r1", cells: { c: "A", a: 90, b: 10, b2: 30 } }], // Short mean 20 ± SD → error bar reaches ~34
    };
    const s = buildPlotScene(withErr, plot({ significance: { legs: "reach" }, seriesStyles: { b: { errorBars: "sd" } } }), { width: 600, height: 400 });
    const br = s.annotations.find((a) => a.id === "br")!;
    const l = legs(br.path!);
    const mk = s.series[1]!.marks[0]!;
    expect(mk.errHighCy, "fixture: no error bar drawn").toBeDefined();
    expect(l.bar + l.t2).toBeCloseTo(mk.errHighCy! - 4, 3);
  });

  it("reach: a swarm point above the bar is cleared by its radius, not just its centre", () => {
    const withPts: DataTable = {
      ...table,
      columns: [{ id: "c", name: "Group", role: "x" }, { id: "a", name: "Tall", role: "y" }, { id: "b", name: "Short", role: "y" }, { id: "b2", name: "Short 2", role: "y", group: "b" }],
      rows: [{ id: "r1", cells: { c: "A", a: 90, b: 10, b2: 30 } }],
    };
    const s = buildPlotScene(withPts, plot({ significance: { legs: "reach" }, showBarPoints: true, seriesStyles: { b: { errorBars: "none" } } }), { width: 600, height: 400 });
    const br = s.annotations.find((a) => a.id === "br")!;
    const l = legs(br.path!);
    const se = s.series[1]!;
    const topPt = Math.min(...(se.marks[0]!.points ?? []).map((pt) => pt.cy));
    expect(Number.isFinite(topPt), "fixture: no swarm points").toBe(true);
    // Leg end sits above the point's top edge (centre − radius) plus the 4 px gap.
    expect(l.bar + l.t2).toBeLessThanOrEqual(topPt - (se.symbolSize ?? 4) - 4 + 0.001);
  });

  it("horizontal bars: legs reach left to each bar's end", () => {
    const s = build({ significance: { legs: "reach" }, barOrientation: "horizontal", annotations: [{ id: "br", kind: "bracket", from: 1, to: 1, fromSeries: 1, toSeries: 2, bracketY: 100 }] });
    const br = s.annotations.find((a) => a.id === "br")!;
    const nums = [...br.path!.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])] as const);
    const barX = nums[1]![0];
    const tall = s.series[0]!.marks[0]!.bar!;
    const short = s.series[1]!.marks[0]!.bar!;
    expect(nums[0]![0]).toBeCloseTo(tall.x + tall.w + 4, 3);
    expect(nums[3]![0]).toBeCloseTo(short.x + short.w + 4, 3);
    expect(nums[0]![0]).toBeLessThan(barX);
  });

  it("an auto-placed bracket (no bracketY) keeps its leg ends on the ink after the layout pass lifts the rail", () => {
    // Guards against the auto pass shifting the whole path up, which drags the leg ends down into the bars.
    const t5: DataTable = { id: "t", kind: "column", name: "T", columns: [{ id: "c", name: "M", role: "x" }, { id: "s", name: "Score", role: "y" }],
      rows: [["Q1", 22], ["Q2", 30], ["Q3", 18], ["Q4", 41], ["Q5", 27]].map(([c, v], i) => ({ id: "r" + i, cells: { c: c!, s: v! } })) };
    const s = buildPlotScene(t5, { id: "p", name: "P", source: "t", kind: "bar", showBarPoints: false, significance: { legs: "reach" }, annotations: [{ id: "b1", kind: "bracket", from: 3, to: 4, p: 0.004 }] } as Plot, { width: 600, height: 400 });
    const br = s.annotations.find((a) => a.id === "b1")!;
    expect(br.autoY).toBe(true);
    const l = legs(br.path!);
    const q3 = s.series[0]!.marks[2]!.bar!;
    const q4 = s.series[0]!.marks[3]!.bar!;
    expect(l.bar + l.t1).toBeCloseTo(q3.y - 4, 3);
    expect(l.bar + l.t2).toBeCloseTo(q4.y - 4, 3);
    // …and the rail itself sits above the taller bar (the auto pass still did its job).
    expect(l.bar).toBeLessThan(q4.y);
  });

  it("per-bracket override: a bracket's own Legs wins over the graph's, both ways", () => {
    const own = build({ annotations: [{ id: "br", kind: "bracket", from: 1, to: 1, fromSeries: 1, toSeries: 2, bracketY: 100, bracketLegs: "reach" }] });
    const l = legs(own.annotations.find((a) => a.id === "br")!.path!);
    expect(l.t2).toBeGreaterThan(l.t1 + 20); // reaches although the graph default is equal
    const back = build({ significance: { legs: "reach" }, annotations: [{ id: "br", kind: "bracket", from: 1, to: 1, fromSeries: 1, toSeries: 2, bracketY: 100, bracketLegs: "equal" }] });
    const l2 = legs(back.annotations.find((a) => a.id === "br")!.path!);
    expect(l2.t1).toBeCloseTo(6, 3);
    expect(l2.t2).toBeCloseTo(6, 3); // equal although the graph default is reach
  });

  it("brace and line shapes keep their look under reach (no straight legs to lengthen)", () => {
    for (const shape of ["brace", "line"] as const) {
      const eq = build({ significance: { shape } }).annotations.find((a) => a.id === "br")!.path;
      const re = build({ significance: { shape, legs: "reach" } }).annotations.find((a) => a.id === "br")!.path;
      expect(re, shape).toBe(eq);
    }
  });

  it("a kind whose builder cannot report bar tops refuses out loud and keeps equal legs", () => {
    const boxT: DataTable = { ...table, rows: [{ id: "r1", cells: { c: "A", a: 90, b: 20 } }, { id: "r2", cells: { c: "B", a: 80, b: 25 } }] };
    const s = buildPlotScene(boxT, { id: "p", name: "P", source: "t", kind: "box", significance: { legs: "reach" }, annotations: [{ id: "br", kind: "bracket", from: 1, to: 2 }] } as Plot, { width: 600, height: 400 });
    const br = s.annotations.find((a) => a.id === "br");
    expect(br?.path, "fixture: the bracket was not drawn at all").toBeDefined();
    expect(s.warnings.some((w) => /reach the bars are drawn on bar charts only/.test(w))).toBe(true);
    const l = legs(br!.path!);
    expect(l.t1).toBeCloseTo(l.t2, 3);
  });
});

describe("significance label default size (larger than the legend font)", () => {
  const br = (over: Partial<Plot> = {}) => build(over).annotations.find((a) => a.id === "br")!;
  it("an unsized star is drawn at 1.4× the legend font, not the legend font itself", () => {
    const s = build();
    // Fixture check: nothing sets a size. Guards against falling back to the legend size in the
    // renderer (fontSize left undefined here), which draws the star no larger than the legend text.
    expect(br().fontSize).toBe(Math.round(s.fonts.legend.size * 1.4));
    expect(br().fontSize).toBeGreaterThan(s.fonts.legend.size);
  });
  it("…and it follows the preset: a bigger legend font → a bigger default star", () => {
    const small = br({ fonts: { legend: { size: 10 } } }).fontSize!;
    const big = br({ fonts: { legend: { size: 20 } } }).fontSize!;
    expect(small).toBe(14);
    expect(big).toBe(28);
  });
  it("a size the user set — per bracket or plot-wide — is left exactly alone", () => {
    expect(br({ annotations: [{ id: "br", kind: "bracket", from: 1, to: 1, fromSeries: 1, toSeries: 2, bracketY: 100, label: "*", size: 9 }] }).fontSize).toBe(9);
    expect(br({ significance: { labelSize: 11 } }).fontSize).toBe(11);
  });
});
