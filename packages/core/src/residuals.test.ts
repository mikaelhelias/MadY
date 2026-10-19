import { describe, expect, it } from "vitest";
import { residualDiagnostics } from "./residuals";

describe("residualDiagnostics", () => {
  // A clean linear case with a known, non-trivial residual pattern.
  const fitted = [1, 2, 3, 4, 5, 6, 7, 8];
  const resid = [0.5, -0.5, 1, -1, 0.5, -0.5, 1, -1]; // mean 0, varied spread

  it("returns null for fewer than 3 finite paired points", () => {
    expect(residualDiagnostics([1, 2], [0.1, 0.2])).toBeNull();
    expect(residualDiagnostics([1, NaN, 3], [0.1, 0.2, NaN])).toBeNull(); // only 1 finite pair
  });

  it("residual-vs-predicted pairs each ŷ with its residual + a zero baseline, sorted by ŷ", () => {
    const d = residualDiagnostics(fitted, resid)!;
    expect(d.n).toBe(8);
    expect(d.residualVsPredicted.columns).toEqual(["Predicted", "Residual", "Zero baseline"]);
    // sorted by predicted ascending; third column is always 0 (the flat baseline).
    const preds = d.residualVsPredicted.rows.map((r) => r[0]);
    expect(preds).toEqual([...preds].sort((a, b) => a! - b!));
    expect(d.residualVsPredicted.rows.every((r) => r[2] === 0)).toBe(true);
    expect(d.residualVsPredicted.rows[0]).toEqual([1, 0.5, 0]);
  });

  it("QQ table has the normal-probability columns + one row per residual", () => {
    const d = residualDiagnostics(fitted, resid)!;
    expect(d.qq.columns).toEqual(["Normal quantile (z)", "Residual (ordered)", "Reference line"]);
    expect(d.qq.rows).toHaveLength(8);
  });

  it("histogram bins the residuals (counts sum to n)", () => {
    const d = residualDiagnostics(fitted, resid)!;
    expect(d.histogram).not.toBeNull();
    const total = d.histogram!.rows.reduce((s, r) => s + r[1]!, 0);
    expect(total).toBe(8);
  });

  it("scale-location = √|residual / sd| vs ŷ", () => {
    const d = residualDiagnostics(fitted, resid)!;
    expect(d.scaleLocation).not.toBeNull();
    // sample SD of resid → standardise → √|·|. Check the first sorted point.
    const mean = resid.reduce((s, v) => s + v, 0) / resid.length; // 0
    const sd = Math.sqrt(resid.reduce((s, v) => s + (v - mean) ** 2, 0) / (resid.length - 1));
    const first = d.scaleLocation!.rows[0]!; // ŷ = 1, residual 0.5
    expect(first[0]).toBe(1);
    expect(first[1]).toBeCloseTo(Math.sqrt(Math.abs(0.5 / sd)), 10);
    // every √|standardised residual| is ≥ 0.
    expect(d.scaleLocation!.rows.every((r) => r[1]! >= 0)).toBe(true);
  });

  it("degenerate all-zero residuals: no crash, scale-location omitted (zero spread)", () => {
    const d = residualDiagnostics([1, 2, 3, 4], [0, 0, 0, 0])!;
    expect(d).not.toBeNull();
    expect(d.residualVsPredicted.rows.every((r) => r[1] === 0)).toBe(true);
    expect(d.scaleLocation).toBeNull(); // sd = 0 → skipped, not NaN
    expect(d.qq.rows).toHaveLength(4); // still produced, just flat
  });

  it("constant predicted (ŷ all equal): scale-location omitted (degenerate axis)", () => {
    const d = residualDiagnostics([5, 5, 5, 5], [1, -1, 2, -2])!;
    expect(d.scaleLocation).toBeNull(); // distinctFitted < 2
  });

  it("drops non-finite pairs before building", () => {
    const d = residualDiagnostics([1, 2, NaN, 4, 5], [0.1, -0.2, 9, Infinity, 0.3])!;
    expect(d.n).toBe(3); // (1,0.1),(2,-0.2),(5,0.3) — the NaN ŷ and Infinity residual pairs are dropped
  });
});
