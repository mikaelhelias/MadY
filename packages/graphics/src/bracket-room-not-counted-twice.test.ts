// A planned bracket that already has room above it must not stretch the value axis.
//
// Guards against the planned-bracket pass testing "does the label still fit under the frame?" with the label's
// height on both sides of the comparison (`here - reach` against a `limit` that already holds `reach`). That
// would report any bracket within two label-heights of the top as short of room and widen the axis for room it
// already has: the Y axis would end past its last numbered tick, with empty plot area above the stars.
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene";

const table: DataTable = {
  id: "t", kind: "grouped", name: "T",
  columns: [
    { id: "g", name: "Day", role: "x" },
    { id: "u1", name: "Control", role: "y" },
    { id: "v1", name: "Treated", role: "y" },
  ],
  rows: [
    { id: "r1", cells: { g: "A", u1: 20, v1: 30 } },
    { id: "r2", cells: { g: "B", u1: 22, v1: 52 } },
  ],
};
const SIZE = { width: 580, height: 380 };
const STAR = 24;
const plotWith = (bracketY: number, planned: boolean): Plot => ({
  id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "bar",
  fonts: { significance: { size: STAR } },
  annotations: [{ id: "b", kind: "bracket", from: 2, to: 2, fromSeries: 1, toSeries: 2, bracketY, p: 0.001, role: "significance", ...(planned ? { plannedY: true } : {}) }],
} as Plot);

describe("a planned bracket's room is counted once", () => {
  it("a bracket well under the frame leaves the axis exactly where a hand-placed one leaves it", () => {
    const hand = buildPlotScene(table, plotWith(60, false), SIZE);
    const planned = buildPlotScene(table, plotWith(60, true), SIZE);
    const rail = planned.annotations.find((a) => a.id === "b")!;
    // The fixture must sit in the band that exhibits the defect: clear of the frame by more than one label
    // height (so there is room) but less than two (so counting the height twice calls it short).
    const roomAbove = rail.y1! - planned.plot.y;
    expect(roomAbove).toBeGreaterThan(STAR * 1.3);
    expect(roomAbove).toBeLessThan(STAR * 2.6);
    expect(planned.y.domain).toEqual(hand.y.domain);
  });

  it("a bracket that really has no room still makes the axis grow", () => {
    const hand = buildPlotScene(table, plotWith(59.5, false), { ...SIZE, height: 380 });
    const top = hand.y.domain[1]!;
    const tight = buildPlotScene(table, plotWith(top - 0.5, true), SIZE);
    expect(tight.y.domain[1]!).toBeGreaterThan(top);
  });
});
