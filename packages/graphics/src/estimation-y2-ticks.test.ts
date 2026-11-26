/**
 * An estimation plot's difference axis (Y2) takes its own Tick interval and Minor ticks. Its range is tied to the
 * left axis, but its ticks are its own: the scale was built without the axis's spacing, so both rows did nothing.
 */
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene";

const t: DataTable = {
  id: "t", name: "T",
  columns: [{ id: "a", name: "Control", role: "y" }, { id: "b", name: "Test", role: "y" }],
  rows: Array.from({ length: 12 }, (_, i) => ({ id: `r${i}`, cells: { a: 10 + (i % 5), b: 18 + ((i * 3) % 7) } })),
} as unknown as DataTable;
const plot = (y2: Record<string, unknown> = {}): Plot => ({ id: "p", name: "E", kind: "estimation", source: "t", y2Axis: y2 }) as unknown as Plot;
const ticks = (p: Plot) => buildPlotScene(t, p, { width: 620, height: 420 }).y2!.ticks;

describe("estimation difference axis ticks", () => {
  it("Tick interval sets the step between its numbers", () => {
    const majors = ticks(plot({ majorStep: 1 })).filter((x) => !x.minor).map((x) => x.value);
    expect(majors.length).toBeGreaterThan(3);
    for (let i = 1; i < majors.length; i++) expect(Math.abs(majors[i]! - majors[i - 1]!)).toBeCloseTo(1, 6);
  });
  it("Minor ticks adds minor ticks between them", () => {
    expect(ticks(plot()).some((x) => x.minor)).toBe(false);
    expect(ticks(plot({ minorCount: 4 })).some((x) => x.minor)).toBe(true);
  });
});
