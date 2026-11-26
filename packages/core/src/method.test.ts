import { describe, expect, it } from "vitest";
import type { AnalysisParams, DataTable } from "./model";
import { analysisToMethod, methodApplyParams, methodToFile, parseMethodFile } from "./method";

/** A minimal table with named columns c0..c(n-1). */
function tbl(id: string, name: string, cols: string[]): DataTable {
  return { id, kind: "xy", name, columns: cols.map((c) => ({ id: c, name: c })), rows: [] };
}

const T1 = tbl("t1", "Table 1", ["a", "b", "c"]);
const T2 = tbl("t2", "Table 2", ["x", "y", "z"]); // same shape (3 cols), different ids
const T_SHORT = tbl("t3", "Short", ["p", "q"]); // only 2 cols

describe("analysisToMethod — capture an analysis as a table-independent method", () => {
  it("converts column ids → positions and preserves the rest of the params", () => {
    const params: AnalysisParams = { columns: ["b", "c"], variant: "welch", conf: 0.95, tail: "greater" };
    const m = analysisToMethod("m1", "My t-test", { method: "ttest", params }, T1);
    expect(m).toEqual({ id: "m1", name: "My t-test", method: "ttest", columns: [1, 2], params: { variant: "welch", conf: 0.95, tail: "greater" } });
    expect(m.params).not.toHaveProperty("columns"); // columns lifted out to positions
  });

  it("captures a PCA groupBy column as a position", () => {
    const params: AnalysisParams = { columns: ["a", "b"], groupBy: "c" };
    const m = analysisToMethod("m2", "PCA", { method: "pca", params }, T1);
    expect(m.columns).toEqual([0, 1]);
    expect(m.groupBy).toBe(2);
  });
});

describe("methodApplyParams — remap a method onto a target table", () => {
  it("maps positions → the target table's column ids (same-shaped table)", () => {
    const m = analysisToMethod("m1", "t", { method: "ttest", params: { columns: ["b", "c"], variant: "welch" } }, T1);
    const r = methodApplyParams(m, T2);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.params).toEqual({ variant: "welch", columns: ["y", "z"] }); // positions 1,2 → t2's y,z
  });

  it("round-trips onto the SAME table (positions → the original ids)", () => {
    const params: AnalysisParams = { columns: ["a", "c"], posthoc: "tukey", scheme: "all-pairs" };
    const m = analysisToMethod("m1", "aov", { method: "anova1", params }, T1);
    const r = methodApplyParams(m, T1);
    expect(r.ok && r.params.columns).toEqual(["a", "c"]);
  });

  it("remaps a groupBy column too", () => {
    const m = analysisToMethod("m2", "pca", { method: "pca", params: { columns: ["a", "b"], groupBy: "c" } }, T1);
    const r = methodApplyParams(m, T2);
    expect(r.ok && r.params.groupBy).toBe("z");
  });

  it("errors when the target table is a different (smaller) shape", () => {
    const m = analysisToMethod("m1", "t", { method: "ttest", params: { columns: ["b", "c"] } }, T1); // needs position 2
    const r = methodApplyParams(m, T_SHORT); // only positions 0,1 exist
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("no column at position 3");
  });
});

describe("method file — serialise / parse round-trip", () => {
  it("methodToFile → parseMethodFile recovers the method (minus id)", () => {
    const m = analysisToMethod("m1", "My method", { method: "regression", params: { columns: ["a", "b"], conf: 0.9 } }, T1);
    const parsed = parseMethodFile(methodToFile(m));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.method).toEqual({ name: "My method", method: "regression", columns: [0, 1], params: { conf: 0.9 } });
      expect(parsed.method).not.toHaveProperty("id"); // caller assigns a fresh id
    }
  });

  it("rejects non-method JSON and unparseable text with a friendly error", () => {
    expect(parseMethodFile("{not json").ok).toBe(false);
    expect(parseMethodFile(JSON.stringify({ type: "something-else" })).ok).toBe(false);
    const noMethod = parseMethodFile(JSON.stringify({ type: "mady-method", method: { columns: [0] } }));
    expect(noMethod.ok).toBe(false);
    const noCols = parseMethodFile(JSON.stringify({ type: "mady-method", method: { method: "ttest" } }));
    expect(noCols.ok).toBe(false);
  });

  it("defaults a missing name on import", () => {
    const r = parseMethodFile(JSON.stringify({ type: "mady-method", method: { method: "ttest", columns: [0, 1] } }));
    expect(r.ok && r.method.name).toBe("Imported method");
  });
});
