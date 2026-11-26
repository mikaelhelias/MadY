// Dots beside the box: a box or violin series' `pointSide` moves its data points out of the box to one side, a small
// gap from the box's edge, keeping every dot and its value.
import { describe, expect, it } from "vitest";
import type { DataTable, Plot, SeriesStyle } from "@mady/core";
import { buildPlotScene } from "./buildScene.js";
import type { PlotScene } from "./scene.js";

const SIZE = { width: 640, height: 420 };
const table: DataTable = {
  id: "t", kind: "column", name: "T",
  columns: [{ id: "a", name: "Mice", role: "y" }, { id: "b", name: "Shuffled", role: "y" }],
  rows: Array.from({ length: 12 }, (_, i) => ({ id: `r${i}`, cells: { a: i % 5, b: 20 - i * 0.5 } })),
};
const build = (kind: "box" | "violin", a: SeriesStyle, over: Partial<Plot> = {}): PlotScene =>
  buildPlotScene(table, { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind, showBoxPoints: true, seriesStyles: { a }, ...over } as Plot, SIZE);
const markOf = (s: PlotScene, id: string) => s.series.find((x) => x.id === id)!.marks[0]!;

describe("box: dots beside the box", () => {
  it("over the box when unset: the dots straddle the box's centre (the fixture draws dots, and they overlap the box)", () => {
    const m = markOf(build("box", {}), "a");
    const xs = m.points!.map((p) => p.cx);
    expect(xs.length).toBe(12);
    expect(Math.min(...xs)).toBeLessThan(m.cx);
    expect(Math.max(...xs)).toBeGreaterThan(m.cx);
  });

  it("left: every dot is left of the box, just clear of its edge", () => {
    const m = markOf(build("box", { pointSide: "left" }), "a");
    const xs = m.points!.map((p) => p.cx);
    expect(xs.length).toBe(12);
    const edge = m.box!.x;
    expect(Math.max(...xs)).toBeLessThan(edge - 3);
    expect(Math.max(...xs)).toBeGreaterThan(edge - 12); // hugs the box, does not drift away
  });

  it("right: every dot is right of the box, just clear of its edge", () => {
    const m = markOf(build("box", { pointSide: "right" }), "a");
    const xs = m.points!.map((p) => p.cx);
    const edge = m.box!.x + m.box!.w;
    expect(Math.min(...xs)).toBeGreaterThan(edge + 3);
    expect(Math.min(...xs)).toBeLessThan(edge + 12);
  });

  it("the dots keep their values: the same heights as over the box", () => {
    const over = markOf(build("box", {}), "a").points!.map((p) => p.cy).sort((x, y) => x - y);
    const side = markOf(build("box", { pointSide: "left" }), "a").points!.map((p) => p.cy).sort((x, y) => x - y);
    expect(side).toEqual(over);
  });

  it("only the series asked moves: the other series keeps its dots over its box", () => {
    const m = markOf(build("box", { pointSide: "left" }), "b");
    const xs = m.points!.map((p) => p.cx);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(m.box!.x);
    expect(Math.max(...xs)).toBeLessThanOrEqual(m.box!.x + m.box!.w);
  });

  it("horizontal: left puts the dots above the box, right below", () => {
    const up = markOf(build("box", { pointSide: "left" }, { barOrientation: "horizontal" }), "a");
    expect(Math.max(...up.points!.map((p) => p.cy))).toBeLessThan(up.box!.x - 3);
    const down = markOf(build("box", { pointSide: "right" }, { barOrientation: "horizontal" }), "a");
    expect(Math.min(...down.points!.map((p) => p.cy))).toBeGreaterThan(down.box!.x + down.box!.w + 3);
  });
});

it("violin: left puts the dots outside the violin, left of its widest point", () => {
  const over = markOf(build("violin", {}), "a");
  const m = markOf(build("violin", { pointSide: "left" }), "a");
  // The violin's half-width is the box's band half-width; its widest point reaches at least as far as any dot over it.
  const reach = Math.max(...over.points!.map((p) => Math.abs(p.cx - over.cx)));
  expect(Math.max(...m.points!.map((p) => p.cx))).toBeLessThan(m.cx - reach - 3);
});
