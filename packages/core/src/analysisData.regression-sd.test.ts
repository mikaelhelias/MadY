/**
 * Regression payload: 1/SD² weighting needs the per-point SD, row-aligned with X and Y — the
 * same way the curve fit gets it. Without it the engine has nothing to weight by.
 */
import { describe, expect, it } from "vitest";
import { buildAnalysisData } from "./analysisData";
import type { DataTable } from "./model";

const table = {
  id: "t", kind: "xy", name: "Std curve",
  columns: [
    { id: "x", name: "Conc", role: "x" },
    { id: "y1", name: "Signal", role: "y" },
    { id: "y2", name: "Signal B", role: "y", group: "y1" },
    { id: "y3", name: "Signal C", role: "y", group: "y1" },
  ],
  rows: [
    { id: "r0", cells: { x: 1, y1: 2, y2: 4, y3: 3 } },
    { id: "r1", cells: { x: 2, y1: 5, y2: 7, y3: 9 } },
    { id: "r2", cells: { x: 3, y1: 8, y2: 12, y3: 10 } },
  ],
} as unknown as DataTable;

describe("regression payload with 1/SD² weighting", () => {
  it("carries one SD per plotted point, taken from the replicate scatter of its row", () => {
    const p = buildAnalysisData("regression", { columns: ["x", "y1"], weighting: "1/SD2" } as never, table) as {
      x: number[]; y: number[]; sd?: number[]; weighting?: string;
    };
    expect(p.weighting).toBe("1/SD2");
    expect(p.y).toHaveLength(9);
    expect(p.sd).toHaveLength(p.y.length);
    expect(p.sd![0]).toBeCloseTo(1, 10);          // row 0: replicates 2, 4, 3
    expect(p.sd![3]).toBeCloseTo(2, 10);          // row 1: 5, 7, 9
    expect(p.sd![6]).toBeCloseTo(2, 10);          // row 2: 8, 12, 10
  });

  it("sends no SD for any other weighting", () => {
    const p = buildAnalysisData("regression", { columns: ["x", "y1"], weighting: "1/Y2" } as never, table) as { sd?: number[] };
    expect(p.sd).toBeUndefined();
  });
});
