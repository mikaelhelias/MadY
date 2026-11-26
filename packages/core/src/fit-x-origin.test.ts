/**
 * A fit on a date X is sent X as days since the column's first date: fitted on day numbers since 1970, a decay or
 * growth model starts some 19,000 days before the first measurement and its fitted times come out wrong.
 */
import { describe, expect, it } from "vitest";
import type { DataTable } from "./model";
import { buildAnalysisData, fitXOrigin } from "./analysisData";

const days = [19000, 19007, 19014, 19030];
const table = (type?: "date" | "elapsed"): DataTable => ({
  id: "t", kind: "xy", name: "Stability",
  columns: [{ id: "x", name: "Date", role: "x", ...(type ? { type } : {}) }, { id: "a", name: "Batch 1", role: "y" }, { id: "b", name: "Batch 2", role: "y" }],
  rows: days.map((d, i) => ({ id: `r${i}`, cells: { x: d, a: 100 - i * 10, b: 100 - i * 5 } })),
});

describe("the X a fit is sent", () => {
  it("a date column: days since its first date", () => {
    expect(fitXOrigin(table("date"), "x")).toBe(19000);
    const d = buildAnalysisData("curvefit", { columns: ["x", "a"], variant: "exp_decay" }, table("date")) as { x: number[] };
    expect(d.x).toEqual([0, 7, 14, 30]);
  });

  it("a global fit on a date column: every dataset measured from the same first date", () => {
    const d = buildAnalysisData("globalfit", { columns: ["a", "b"], variant: "exp_decay" }, table("date")) as { datasets: { x: number[] }[] };
    expect(d.datasets.map((s) => s.x)).toEqual([[0, 7, 14, 30], [0, 7, 14, 30]]);
  });

  it("a number or elapsed-time column: as entered", () => {
    expect(fitXOrigin(table(), "x")).toBe(0);
    expect(fitXOrigin(table("elapsed"), "x")).toBe(0);
    const d = buildAnalysisData("curvefit", { columns: ["x", "a"], variant: "exp_decay" }, table("elapsed")) as { x: number[] };
    expect(d.x).toEqual(days);
  });
});
