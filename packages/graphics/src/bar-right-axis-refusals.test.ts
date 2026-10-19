// A vertical bar chart draws one right-hand axis (Y2), linear. Two requests it cannot honour
// are reported as warnings instead of being dropped silently:
//   · a series set to the third axis (`axis: "y3"`) is drawn on the left axis;
//   · a log scale on Y2 is drawn linear.
// Both are reachable from outside the Inspector (the agent API, a preset, a saved file), so the
// builder has to say so rather than silently drop them.
import { describe, expect, it } from "vitest";
import type { DataTable, Plot, SeriesStyle } from "@mady/core";
import { buildPlotScene } from "./buildScene";

const SIZE = { width: 640, height: 460 };
const t3: DataTable = {
  id: "t3", kind: "column", name: "T3",
  columns: [
    { id: "g", name: "Group", role: "x" },
    { id: "bar", name: "Sales", role: "y" },
    { id: "line", name: "Trend", role: "y" },
  ],
  rows: [
    { id: "r1", cells: { g: "A", bar: 2, line: 300 } },
    { id: "r2", cells: { g: "B", bar: 6, line: 500 } },
    { id: "r3", cells: { g: "C", bar: 10, line: 400 } },
  ],
};
const bar = (styles: Record<string, SeriesStyle>, over: Partial<Plot> = {}): Plot =>
  ({ id: "p", name: "P", source: "t3", kind: "bar", seriesStyles: styles, ...over }) as Plot;
const warns = (p: Plot) => buildPlotScene(t3, p, SIZE).warnings;

describe("vertical bar — bars on the right (Y2) axis stand on zero", () => {
  // Bars are drawn from value 0, so a Y2 axis fitted to the values alone (e.g. 80–240 for values
  // 90–240) would put every bar's base below the plot, over the category names.
  const big: DataTable = {
    ...t3,
    rows: [
      { id: "r1", cells: { g: "A", bar: 2, line: 120 } },
      { id: "r2", cells: { g: "B", bar: 6, line: 240 } },
      { id: "r3", cells: { g: "C", bar: 10, line: 90 } },
    ],
  };
  it("a bars series on Y2: the right axis includes 0 and no bar reaches below the plot", () => {
    const scene = buildPlotScene(big, bar({ line: { axis: "y2" } }), SIZE);
    expect(scene.y2!.domain[0]).toBeLessThanOrEqual(0);
    const bottom = scene.plot.y + scene.plot.height;
    for (const m of scene.series.find((s) => s.id === "line")!.marks) {
      expect(m.bar!.y + m.bar!.h).toBeLessThanOrEqual(bottom + 1);
    }
  });
  it("an area on Y2 also fills from 0; a line on Y2 keeps a range fitted to its values", () => {
    expect(buildPlotScene(big, bar({ line: { axis: "y2", plotAs: "area" } }), SIZE).y2!.domain[0]).toBeLessThanOrEqual(0);
    expect(buildPlotScene(big, bar({ line: { axis: "y2", plotAs: "line" } }), SIZE).y2!.domain[0]).toBeGreaterThan(0);
  });
});

describe("vertical bar — the right (Y2) axis names its series, and brackets do not undo it", () => {
  it("one series on Y2 and no typed title: the right axis is titled with the series' name (the XY rule)", () => {
    expect(buildPlotScene(t3, bar({ line: { axis: "y2", plotAs: "line" } }), SIZE).y2!.title).toBe("Trend");
    expect(buildPlotScene(t3, bar({ line: { axis: "y2", plotAs: "line" } }, { y2Axis: { title: "Price" } }), SIZE).y2!.title).toBe("Price");
  });

  it("a planned significance bracket (\"Add to graph\") does not stretch the left axis back out", () => {
    // The planner pools every group's values into one range, so its height here is in the
    // Trend's units (~530) — read against the left axis it would re-stretch Sales to 0–600.
    const planned = { id: "b1", kind: "bracket" as const, from: 1, to: 3, bracketY: 530, plannedY: true, p: 0.001, role: "significance" as const };
    const scene = buildPlotScene(t3, bar({ line: { axis: "y2", plotAs: "line" } }, { annotations: [planned] }), SIZE);
    expect(scene.y.domain[1], "the planned height stretched the left axis").toBeLessThan(100);
    const b = scene.annotations.find((a) => a.id === "b1");
    expect(b?.path, "the bracket was not drawn").toBeTruthy();
    expect(b!.y1!).toBeGreaterThanOrEqual(scene.plot.y - 0.5);
  });
});

// ── the stacked vertical bar too ────────────────────────────────────────────────────────────────────
// On a stacked vertical bar a series on the second axis is not stacked. Given the grouped placement —
// `di * barW`, where barW is the whole slot when stacked — it would be shifted sideways by whole slots,
// e.g. the "Stacked bars + line (2nd axis)" card's line would sit a quarter of the plot too far right.
describe("stacked vertical bar — a series on the second axis stands on its own category", () => {
  it("a line on the second axis passes through each category's centre, like the stacked bars", () => {
    const s = buildPlotScene(t3, bar({ line: { axis: "y2", plotAs: "line" } }, { barLayout: "stacked" }), SIZE);
    const barCentres = s.series.find((x) => x.id === "bar")!.marks.map((m) => m.bar!.x + m.bar!.w / 2);
    const lineX = s.series.find((x) => x.id === "line")!.marks.map((m) => m.cx);
    expect(lineX).toHaveLength(barCentres.length);
    lineX.forEach((x, i) => expect(x, `category ${i + 1}`).toBeCloseTo(barCentres[i]!, 1));
  });

  it("bars on the second axis take their own category's slot, not another category's", () => {
    const s = buildPlotScene(t3, bar({ line: { axis: "y2" } }, { barLayout: "stacked" }), SIZE);
    const sales = s.series.find((x) => x.id === "bar")!.marks.map((m) => m.bar!.x);
    const trend = s.series.find((x) => x.id === "line")!.marks.map((m) => m.bar!.x);
    trend.forEach((x, i) => expect(x, `category ${i + 1}`).toBeCloseTo(sales[i]!, 1));
  });
});

describe("vertical bar — right-axis requests it cannot draw are refused out loud", () => {
  it("a series on Y3 warns, names the series, and no Y3 is drawn", () => {
    const scene = buildPlotScene(t3, bar({ line: { axis: "y3" } }), SIZE);
    expect(scene.y3).toBeUndefined();
    expect(scene.warnings.some((w) => /Trend/.test(w) && /third/i.test(w))).toBe(true);
    // the same series on Y2 is honoured and says nothing
    expect(warns(bar({ line: { axis: "y2" } })).some((w) => /third/i.test(w))).toBe(false);
  });

  it("a log scale on Y2 warns; a linear Y2 does not", () => {
    const logged = warns(bar({ line: { axis: "y2" } }, { y2Axis: { scale: "log10" } }));
    expect(logged.some((w) => /log/i.test(w) && /Y2|right/i.test(w))).toBe(true);
    expect(warns(bar({ line: { axis: "y2" } }, { y2Axis: { scale: "linear" } })).some((w) => /log/i.test(w))).toBe(false);
    // no right axis drawn → nothing to refuse
    expect(warns(bar({}, { y2Axis: { scale: "log10" } })).some((w) => /log/i.test(w))).toBe(false);
  });
});
