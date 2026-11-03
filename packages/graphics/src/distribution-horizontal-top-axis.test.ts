// A second value axis on horizontal box, violin and column scatter charts, along the top.
//
// The same top axis the horizontal bar chart draws: the values run left to right, so the second
// value axis sits above the plot. Same setting as a vertical chart's second axis
// (`seriesStyles.axis = "y2"`, `plot.y2Axis`), drawn with `side: "top"`.
import { describe, expect, it } from "vitest";
import type { DataTable, Plot, SeriesStyle } from "@mady/core";
import type { PlotScene } from "./scene";
import { buildPlotScene } from "./buildScene";

const SIZE = { width: 640, height: 460 };
const measure = (t: string, px: number): number => t.length * px * 0.6;

const tableOf = (heights: number[]): DataTable =>
  ({
    id: "t", kind: "column", name: "T",
    columns: [
      { id: "w", name: "Weight (g)", role: "y" },
      { id: "h", name: "Height (cm)", role: "y" },
    ],
    rows: [2, 4, 6, 8, 10].map((w, i) => ({ id: `r${i}`, cells: { w, h: heights[i]! } })),
  }) as unknown as DataTable;
const T = tableOf([150, 165, 172, 181, 190]);
const WEIGHT_ONLY = { ...T, columns: T.columns.filter((c) => c.id === "w") } as DataTable;

const hplot = (kind: string, styles: Record<string, SeriesStyle> = {}, over: Partial<Plot> = {}): Plot =>
  ({ id: "p", name: "P", source: "t", kind, barOrientation: "horizontal", seriesStyles: styles, ...over }) as Plot;
const build = (p: Plot, t: DataTable = T): PlotScene => buildPlotScene(t, p, { ...SIZE, measure });

/** Every horizontal pixel a series' glyph uses: box quartiles + whiskers, swarm dots, violin outline. */
function glyphXs(s: PlotScene, id: string): number[] {
  const se = s.series.find((x) => x.id === id);
  if (!se) throw new Error(`no series ${id}`);
  const xs: number[] = [];
  for (const m of se.marks) {
    // On a horizontal chart the box's quartile / whisker fields hold X pixels.
    if (m.box) xs.push(m.box.q1, m.box.q3, m.box.whiskerLow, m.box.whiskerHigh);
    for (const p of m.points ?? []) xs.push(p.cx);
    const v = (m as { violin?: { path?: string } }).violin?.path;
    if (typeof v === "string") xs.push(...(v.match(/-?\d+(\.\d+)?/g) ?? []).map(Number).filter((_, i) => i % 2 === 0));
  }
  return xs;
}
const insideX = (s: PlotScene, x: number): boolean => x >= s.plot.x - 1 && x <= s.plot.x + s.plot.width + 1;

describe.each(["box", "violin", "scatter"])("horizontal %s chart — a series on the second axis gets a TOP value axis", (kind) => {
  it("Height on the second axis: a top axis fitted to Height, the bottom axis fits Weight alone, every glyph inside the plot", () => {
    const plain = build(hplot(kind));
    const s = build(hplot(kind, { h: { axis: "y2" } }));
    expect(s.y2, "no second axis was drawn").toBeDefined();
    expect(s.y2!.side).toBe("top");
    expect(s.y2!.domain[0]).toBeLessThanOrEqual(150);
    expect(s.y2!.domain[1]).toBeGreaterThanOrEqual(190);
    // the bottom axis is exactly the axis of a chart with no Height series at all
    expect(s.x.domain).toEqual(build(hplot(kind), WEIGHT_ONLY).x.domain);
    expect(s.x.domain[1]).toBeLessThan(100);
    expect(s.y2!.range).toEqual([s.plot.x, s.plot.x + s.plot.width]);
    expect(s.plot.y, "no room was reserved above the plot for the top axis").toBeGreaterThan(plain.plot.y);
    expect(s.y2!.titlePos!, "the top axis title is not above the plot").toBeLessThan(s.plot.y);
    for (const x of [...glyphXs(s, "w"), ...glyphXs(s, "h")]) expect(insideX(s, x), `glyph at x=${x} outside the plot`).toBe(true);
    expect(s.warnings.some((w) => /second value axis/i.test(w)), "the second axis is still refused").toBe(false);
  });

  it("the top axis is titled with its series' name unless a title is typed", () => {
    expect(build(hplot(kind, { h: { axis: "y2" } })).y2!.title).toBe("Height (cm)");
    expect(build(hplot(kind, { h: { axis: "y2" } }, { y2Axis: { title: "Stature" } })).y2!.title).toBe("Stature");
  });

  it("a log scale on the top axis is honoured over all-positive values, and refused out loud over a zero", () => {
    expect(build(hplot(kind, { h: { axis: "y2" } }, { y2Axis: { scale: "log10" } })).y2!.type).toBe("log10");
    const zero = build(hplot(kind, { h: { axis: "y2" } }, { y2Axis: { scale: "log10" } }), tableOf([0, 165, 172, 181, 190]));
    expect(zero.y2!.type).toBe("linear");
    expect(zero.warnings.some((w) => /log/i.test(w))).toBe(true);
  });

  it("a planned significance bracket does not stretch the bottom axis back out", () => {
    const planned = { id: "b1", kind: "bracket" as const, from: 1, to: 2, bracketY: 190 + 188 * 0.06, plannedY: true, p: 0.001, role: "significance" as const };
    const s = build(hplot(kind, { h: { axis: "y2" } }, { annotations: [planned] }));
    expect(s.x.domain[1], "the planned height stretched the bottom axis").toBeLessThan(100);
    expect(s.annotations.find((a) => a.id === "b1")?.path, "the bracket was not drawn").toBeTruthy();
  });

  it("nothing on the second axis: no top axis", () => {
    expect(build(hplot(kind)).y2).toBeUndefined();
  });
});
