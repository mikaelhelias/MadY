import { describe, expect, it } from "vitest";
import { buildAnalysisData } from "./analysisData";
import type { DataTable } from "./model";

/**
 * Standalone P-value corrector — the client reads one column of P values and passes
 * them with the chosen method + α (from the Confidence selector) to the engine, which
 * does the adjusting via statsmodels multipletests. This guards the payload wiring; the
 * engine's adjusted values are checked independently in crosscheck.py (`check_pcorrect`).
 */
const table: DataTable = {
  id: "t", kind: "multivariable", name: "T",
  columns: [{ id: "cp", name: "P", role: "y" }],
  rows: [0.001, 0.02, 0.2, 0.9].map((v, i) => ({ id: `r${i}`, cells: { cp: v } })),
} as never;

const payload = (params: Record<string, unknown>): Record<string, unknown> =>
  buildAnalysisData("pcorrect", { columns: ["cp"], ...params } as never, table);

describe("pcorrect payload", () => {
  it("passes the column's values as pvalues + the chosen method", () => {
    const p = payload({ variant: "fdr_bh" });
    expect(p.pvalues).toEqual([0.001, 0.02, 0.2, 0.9]);
    expect(p.method).toBe("fdr_bh");
  });

  it("defaults the method to Holm", () => {
    expect(payload({}).method).toBe("holm");
  });

  it("maps the Confidence selector to α (95% → 0.05; 99% → 0.01)", () => {
    expect(payload({ conf: 0.95 }).alpha).toBeCloseTo(0.05, 10);
    expect(payload({ conf: 0.99 }).alpha).toBeCloseTo(0.01, 10);
    expect(payload({}).alpha).toBe(0.05); // no conf → default
  });
});
