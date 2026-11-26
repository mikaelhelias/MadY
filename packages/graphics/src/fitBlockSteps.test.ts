import { describe, expect, it } from "vitest";
import type { DataTable, Plot, PlotFit } from "@mady/core";
import { buildPlotScene } from "./buildScene";
import { FIT_LINE_EM, SCRIPT_CLEARANCE_EM, fitBlockOffsetEm, fitBlockSteps } from "./fitBlockSteps";

const closeTo = (got: number[], want: number[]): void => { expect(got).toHaveLength(want.length); got.forEach((g, i) => expect(g).toBeCloseTo(want[i]!, 9)); };

describe("fitBlockSteps", () => {
  it("plain lines keep the plain step", () => {
    closeTo(fitBlockSteps(["Bottom = 1", "Top = 2", "Hill slope = 3"]), [0, FIT_LINE_EM, FIT_LINE_EM]);
  });
  it("a subscript leaves room below its line, a superscript above its own", () => {
    // "R²" carries the superscript character, which counts as a superscript.
    closeTo(fitBlockSteps(["EC_{50} = 1", "R² = 0.9"]), [0, FIT_LINE_EM + 2 * SCRIPT_CLEARANCE_EM]);
    closeTo(fitBlockSteps(["Top = 1", "Bottom = 2"]), [0, FIT_LINE_EM]);
    closeTo(fitBlockSteps(["EC_{50} = 1", "R^{2} = 0.9"]), [0, FIT_LINE_EM + 2 * SCRIPT_CLEARANCE_EM]);
    closeTo(fitBlockSteps(["Top = 1", "R^{2} = 0.9"]), [0, FIT_LINE_EM + SCRIPT_CLEARANCE_EM]);
    closeTo(fitBlockSteps(["K_{M} = 1", "Top = 2"]), [0, FIT_LINE_EM + SCRIPT_CLEARANCE_EM]);
  });
  it("the exponent of a number counts as a superscript", () => {
    expect(fitBlockSteps(["a = 1", "b = 2.9 × 10^{-4}"])[1]).toBeCloseTo(FIT_LINE_EM + SCRIPT_CLEARANCE_EM, 9);
  });
  it("offsets are running sums, and a missing step falls back to the plain one", () => {
    const s = fitBlockSteps(["K_{M} = 1", "R^{2} = 2", "Top = 3"]);
    expect(fitBlockOffsetEm(s, 0)).toBe(0);
    expect(fitBlockOffsetEm(s, 2)).toBeCloseTo(s[1]! + s[2]!, 9);
    expect(fitBlockOffsetEm([0], 2)).toBeCloseTo(2 * FIT_LINE_EM, 9);
  });
  it("no lines, no steps", () => {
    expect(fitBlockSteps([])).toEqual([]);
  });
});

describe("the block is placed by the same steps", () => {
  const table = {
    id: "t", kind: "xy", name: "t",
    columns: [{ id: "x", name: "x", role: "x" }, { id: "y", name: "y", role: "y" }],
    rows: [1, 2, 3, 4, 5].map((v, i) => ({ id: `r${i}`, cells: { x: v, y: v * 2 } })),
  } as unknown as DataTable;
  const build = (params: string[]) => {
    const fit: PlotFit = { label: "f", points: [[1, 2], [5, 10]], params, paramKeys: params.map((_, i) => `k${i}`) };
    const plot = { id: "p", name: "p", source: "t", status: "ok", styleOverrides: {}, kind: "xy", fit } as unknown as Plot;
    return buildPlotScene(table, plot, { width: 600, height: 400 }).fit!.params!;
  };

  it("a block with subscripts and superscripts starts higher than the same block of plain lines, by the room it needs", () => {
    const plain = build(["a = 1", "b = 2", "c = 3"]);
    const scripted = build(["V_{max} = 1", "R^{2} = 2", "c = 3"]);
    const extra = scripted.y - plain.y;
    expect(extra, "a scripted block did not move up").toBeLessThan(0);
    const steps = fitBlockSteps(["V_{max} = 1", "R^{2} = 2", "c = 3"]);
    const needed = (fitBlockOffsetEm(steps, 2) - 2 * FIT_LINE_EM) * plain.size;
    expect(-extra).toBeCloseTo(needed, 6);
  });

  it("a block of plain lines stacks upward by 1.25 lines from its bottom line", () => {
    const p = build(["a = 1", "b = 2", "c = 3"]);
    const bottom = p.y + 2 * p.size * 1.25; // plain lines stack upward by 1.25 lines from the bottom edge
    expect(bottom).toBeGreaterThan(p.y);
    const one = build(["a = 1"]);
    expect(one.y).toBeCloseTo(bottom, 6);
  });
});
