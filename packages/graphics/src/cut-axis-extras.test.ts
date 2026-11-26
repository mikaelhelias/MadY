// Custom ticks and shaded bands on an axis with a cut.
//
// Guards against "Add tick" and "Bands" drawing nothing once a cut exists — silently, wherever they sit — which is
// what happens if `axisPixel` refuses any value on a broken axis (on Ridgeline and XY alike). A control that cannot
// act must say why (the scene's `warnings`), never go quiet.
//
// What the drawing owes the reader: a value in a visible stretch is placed in that stretch; a band that spans a cut
// is drawn in pieces, one per visible stretch, so it never bridges the gap and implies data that was cut away; a
// value inside the cut has no place on the axis at all and is refused out loud.
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene.js";
import type { PlotScene } from "./scene.js";

const xy: DataTable = {
  id: "t", kind: "xy", name: "T",
  columns: [{ id: "x", name: "X" }, { id: "a", name: "A" }],
  rows: [0, 2, 4, 6, 8, 10].map((x, i) => ({ id: `r${i}`, cells: { x, a: 10 + i } })),
};
const ridge: DataTable = {
  id: "t", kind: "column", name: "T",
  columns: [{ id: "w", name: "Week", role: "x" }, { id: "a", name: "A", role: "y" }, { id: "b", name: "B", role: "y" }],
  rows: [0, 2, 4, 6, 8, 10].map((w, i) => ({ id: `r${i}`, cells: { w, a: 3 + (i % 3), b: 5 - (i % 3) } })),
};
const SIZE = { width: 640, height: 420 };
const CUT = [{ from: 3, to: 6 }];

const build = (over: Partial<Plot>, table: DataTable = xy): PlotScene =>
  buildPlotScene(table, { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "xy", ...over } as Plot, SIZE);
const tickAt = (s: PlotScene, label: string) => s.x.ticks.find((t) => t.label === label);
const warned = (s: PlotScene, re: RegExp) => s.warnings.some((w) => re.test(w));

describe("a cut on the X axis: custom ticks", () => {
  it("a tick in a visible stretch is drawn, on the correct side of the cut", () => {
    const s = build({ xAxis: { breaks: CUT, extraTicks: [{ value: 8, label: "late" }] } });
    expect(s.x.breakMarks?.length, "the fixture drew no cut — it cannot show the defect").toBe(1);
    const t = tickAt(s, "late");
    expect(t, "the custom tick was dropped on an axis with a cut").toBeDefined();
    expect(t!.pos, "the tick is not beyond the cut, where its value lives").toBeGreaterThan(s.x.breakMarks![0]!);
    expect(t!.pos).toBeLessThanOrEqual(s.plot.x + s.plot.width + 0.5);
  });

  it("a tick before the cut lands in the first stretch", () => {
    const s = build({ xAxis: { breaks: CUT, extraTicks: [{ value: 1, label: "early" }] } });
    const t = tickAt(s, "early");
    expect(t, "the custom tick was dropped").toBeDefined();
    expect(t!.pos).toBeLessThan(s.x.breakMarks![0]!);
    expect(t!.pos).toBeGreaterThanOrEqual(s.plot.x - 0.5);
  });

  it("a tick inside the cut has nowhere to go — refused out loud, not silently dropped", () => {
    const s = build({ xAxis: { breaks: CUT, extraTicks: [{ value: 4.5, label: "gone" }] } });
    expect(tickAt(s, "gone"), "a tick was drawn inside the cut").toBeUndefined();
    expect(warned(s, /4\.5|cut/i), `no warning says why the tick is missing: ${JSON.stringify(s.warnings)}`).toBe(true);
  });
});

describe("a cut on the X axis: shaded bands", () => {
  const bandsOf = (s: PlotScene) => s.axisBands ?? [];

  it("a band inside one stretch is drawn once, within that stretch", () => {
    const s = build({ xAxis: { breaks: CUT, bands: [{ from: 1, to: 2, color: "#ff0000" }] } });
    const b = bandsOf(s);
    expect(b.length, "the band was dropped on an axis with a cut").toBe(1);
    expect(b[0]!.x + b[0]!.w).toBeLessThanOrEqual(s.x.breakMarks![0]! + 0.5);
    expect(b[0]!.w).toBeGreaterThan(1);
  });

  it("a band that spans the cut is drawn in two pieces, with the gap between them", () => {
    const s = build({ xAxis: { breaks: CUT, bands: [{ from: 2, to: 8, color: "#ff0000" }] } });
    const b = [...bandsOf(s)].sort((p, q) => p.x - q.x);
    expect(b.length, "a band spanning a cut must be drawn in pieces, never bridged").toBe(2);
    const mark = s.x.breakMarks![0]!;
    expect(b[0]!.x + b[0]!.w, "the first piece runs into the cut").toBeLessThanOrEqual(mark + 0.5);
    expect(b[1]!.x, "the second piece starts inside the cut").toBeGreaterThanOrEqual(mark - 0.5);
    for (const piece of b) expect(piece.w).toBeGreaterThan(1);
  });

  it("a band entirely inside the cut is refused out loud", () => {
    const s = build({ xAxis: { breaks: CUT, bands: [{ from: 4, to: 5, color: "#ff0000" }] } });
    expect(bandsOf(s).length, "a band was drawn inside the cut").toBe(0);
    expect(warned(s, /band|cut/i), `no warning says why the band is missing: ${JSON.stringify(s.warnings)}`).toBe(true);
  });

  it("with no cut, one band and one tick, and no warning", () => {
    const s = build({ xAxis: { extraTicks: [{ value: 8, label: "late" }], bands: [{ from: 2, to: 8, color: "#ff0000" }] } });
    expect(s.x.breakMarks ?? []).toEqual([]);
    expect((s.axisBands ?? []).length).toBe(1);
    expect(tickAt(s, "late")).toBeDefined();
    expect(s.warnings, "an uncut axis warned about nothing").toEqual([]);
  });
});

describe("a cut on the Y axis", () => {
  it("a band spanning the cut is drawn in two pieces down the plot", () => {
    const s = build({ yAxis: { breaks: [{ from: 12, to: 13.5 }], bands: [{ from: 11, to: 14, color: "#ff0000" }] } });
    expect(s.y.breakMarks?.length, "the fixture drew no cut on Y").toBe(1);
    const b = [...(s.axisBands ?? [])].sort((p, q) => p.y - q.y);
    expect(b.length, "a band spanning a Y cut must be drawn in pieces").toBe(2);
    const mark = s.y.breakMarks![0]!;
    expect(b[0]!.y + b[0]!.h).toBeLessThanOrEqual(mark + 0.5);
    expect(b[1]!.y).toBeGreaterThanOrEqual(mark - 0.5);
  });
});

describe("a ridgeline with a cut axis", () => {
  it("ridgeline: a custom tick and a band both reach the drawing across a cut", () => {
    const s = buildPlotScene(
      ridge,
      { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "ridgeline", ridgeline: { source: "profile" }, xAxis: { breaks: CUT, extraTicks: [{ value: 8, label: "late" }], bands: [{ from: 1, to: 2, color: "#ff0000" }] } } as Plot,
      SIZE,
    );
    expect(s.x.breakMarks?.length, "the fixture drew no cut").toBe(1);
    expect(tickAt(s, "late"), "the custom tick was dropped").toBeDefined();
    expect((s.axisBands ?? []).length, "the band was dropped").toBe(1);
  });
});

describe("the corner scale bar keeps refusing a cut axis — and says so", () => {
  it("drawn on a clean axis, refused with a warning once the axis is cut", () => {
    const clean = build({ xAxis: { scaleBar: { length: 4 } } });
    expect((clean.scaleBars ?? []).length, "the fixture drew no scale bar to compare with").toBe(1);
    const cut = build({ xAxis: { breaks: CUT, scaleBar: { length: 4 } } });
    expect((cut.scaleBars ?? []).length, "a scale bar across a cut would claim a length it does not draw").toBe(0);
    expect(warned(cut, /scale bar/i), `no warning says why the scale bar is missing: ${JSON.stringify(cut.warnings)}`).toBe(true);
  });
});
