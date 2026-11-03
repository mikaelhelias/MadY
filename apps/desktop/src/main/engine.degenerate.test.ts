// @vitest-environment node
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SidecarSupervisor } from "./sidecar";

/**
 * Wrong answers on degenerate-but-ordinary input — a class that tests feeding well-formed data
 * never reach.
 *
 * `anova1` drops empty groups, and it must filter the labels and the control index the same
 * way. If the labels stayed unfiltered, every label would shift onto the next group's data:
 * with `[[], A, B, C]` the "Vehicle" row would report Drug A's mean, Drug C would vanish, and
 * Dunnett would compare against Drug A while the rows read "vs Vehicle" — a wrong number under
 * the user's own group name. A blank column produces exactly this input: the renderer sends
 * the groups as laid out.
 */
const enginePath = fileURLToPath(new URL("../../../../engines/py/engine.py", import.meta.url));
const py = process.platform === "win32" ? "py" : "python3";
// `py -3` rather than `py`: given a script and no version, the Windows launcher follows the
// script's `#!` line and can pick another Python found on PATH, one without the packages.
const pyArgs = process.platform === "win32" ? ["-3"] : [];
function hasScipy(): boolean {
  try { execSync(`${[py, ...pyArgs].join(" ")} -c "import scipy, numpy"`, { stdio: "ignore" }); return true; } catch { return false; }
}
const SCIPY = hasScipy();
const sup = (): SidecarSupervisor => new SidecarSupervisor({ command: py, args: [...pyArgs, enginePath], startTimeoutMs: 30_000 });

/** Groups whose means are far apart, so a mislabelled row is unmistakable. */
const A = [20, 22, 21, 23]; // mean 21.5
const B = [30, 31, 29, 32]; // mean 30.5
const C = [40, 41, 39, 42]; // mean 40.5
const LABELS = ["Vehicle", "Drug A", "Drug B", "Drug C"];
/** The per-group rows of an anova1 result, as label → mean. */
function groupMeans(r: Record<string, unknown>): Record<string, unknown> {
  const terms = r["terms"] as Array<Record<string, unknown>>;
  const out: Record<string, unknown> = {};
  for (const t of terms) {
    const term = String(t["term"]);
    if (t["estimate"] !== undefined && !term.includes(" vs ") && term !== "Between groups") out[term] = t["estimate"];
  }
  return out;
}
const comparisons = (r: Record<string, unknown>): string[] =>
  (r["terms"] as Array<Record<string, unknown>>).map((t) => String(t["term"])).filter((t) => t.includes(" vs "));

describe.skipIf(!SCIPY)("an empty group must not re-label everything after it", () => {
  it("each label reports its own mean, and the last group does not vanish", async () => {
    const s = sup();
    try {
      const r = await s.request("anova1", { groups: [[], A, B, C], labels: LABELS, variant: "oneway" });
      // Shifted labels would read {Vehicle: 21.5, "Drug A": 30.5, "Drug B": 40.5}.
      expect(groupMeans(r)).toEqual({ "Drug A": 21.5, "Drug B": 30.5, "Drug C": 40.5 });
    } finally {
      await s.stop();
    }
  }, 40_000);

  it("Dunnett against an empty control is a typed error, not a silent switch to another group", async () => {
    const s = sup();
    try {
      // Clamping the unusable index to group 0 would pick Drug A after filtering, so every
      // row would read "vs Vehicle" while the maths used Drug A.
      await expect(
        s.request("anova1", { groups: [[], A, B, C], labels: LABELS, variant: "oneway", posthoc: "dunnett", control: 0 }),
      ).rejects.toThrow(/control group \(Vehicle\) has no data/i);
    } finally {
      await s.stop();
    }
  }, 40_000);

  it("a control that survives the filter is remapped, so it stays the group the user picked", async () => {
    const s = sup();
    try {
      const r = await s.request("anova1", { groups: [[], A, B, C], labels: LABELS, variant: "oneway", posthoc: "dunnett", control: 1 });
      // control:1 = "Drug A" as sent; after dropping the empty group it is index 0.
      expect(comparisons(r).sort()).toEqual(["Drug B vs Drug A", "Drug C vs Drug A"]);
    } finally {
      await s.stop();
    }
  }, 40_000);

  it("an out-of-range control is refused rather than quietly becoming group 1", async () => {
    const s = sup();
    try {
      await expect(
        s.request("anova1", { groups: [A, B], labels: ["A", "B"], variant: "oneway", posthoc: "dunnett", control: 7 }),
      ).rejects.toThrow(/out of range/i);
    } finally {
      await s.stop();
    }
  }, 40_000);

  it("selected pairs follow the same remap — a pair naming an empty group is dropped, not slid onto its neighbour", async () => {
    const s = sup();
    try {
      // [1,3] as sent = Drug A vs Drug C. [0,2] names the empty Vehicle → uncomputable.
      const r = await s.request("anova1", {
        groups: [[], A, B, C], labels: LABELS, variant: "oneway",
        posthoc: "bonferroni", scheme: "selected-pairs", pairs: [[1, 3], [0, 2]],
      });
      expect(comparisons(r)).toEqual(["Drug A vs Drug C"]);
    } finally {
      await s.stop();
    }
  }, 40_000);

  it("control case: with no empty group, labels and the control index are untouched", async () => {
    const s = sup();
    try {
      const r = await s.request("anova1", {
        groups: [A, B, C], labels: ["Vehicle", "Drug A", "Drug B"], variant: "oneway", posthoc: "dunnett", control: 0,
      });
      expect(groupMeans(r)).toEqual({ Vehicle: 21.5, "Drug A": 30.5, "Drug B": 40.5 });
      expect(comparisons(r).sort()).toEqual(["Drug A vs Vehicle", "Drug B vs Vehicle"]);
    } finally {
      await s.stop();
    }
  }, 40_000);

  it("Kruskal-Wallis takes the same path (the filter is shared)", async () => {
    const s = sup();
    try {
      const r = await s.request("anova1", { groups: [[], A, B, C], labels: LABELS, variant: "kruskal" });
      expect(Object.keys(groupMeans(r))).toEqual(["Drug A", "Drug B", "Drug C"]);
    } finally {
      await s.stop();
    }
  }, 40_000);
});

/**
 * A single blank in the Expected column must not silently change the hypothesis.
 *
 * `_num` compacts, so one blank makes the column "the wrong length"; falling through to the
 * uniform default there would test a hypothesis the user never chose. Observed [10,20,30,40]
 * against an expected column of the same numbers is a perfect fit (p = 1.0); the uniform
 * default on the same observations gives p = 0.00017 — the opposite conclusion.
 */
describe.skipIf(!SCIPY)("an incomplete Expected column must not silently become uniform", () => {
  it("a complete Expected column is honoured", async () => {
    const s = sup();
    try {
      const r = await s.request("goodnessoffit", { observed: [10, 20, 30, 40], expected: [10, 20, 30, 40] });
      expect((r["glance"] as Record<string, number>)["p"]).toBeCloseTo(1, 6);
    } finally {
      await s.stop();
    }
  }, 40_000);

  it("an empty Expected column still means uniform — the documented default", async () => {
    const s = sup();
    try {
      const r = await s.request("goodnessoffit", { observed: [10, 20, 30, 40] });
      expect((r["glance"] as Record<string, number>)["p"]).toBeCloseTo(0.00016974, 8);
    } finally {
      await s.stop();
    }
  }, 40_000);

  it("a partially filled Expected column is refused, and names the empty category", async () => {
    const s = sup();
    try {
      await expect(
        s.request("goodnessoffit", { observed: [10, 20, 30, 40], expected: [10, null, 30, 40], labels: ["W", "X", "Y", "Z"] }),
      ).rejects.toThrow(/Expected column is incomplete \(X\)/);
    } finally {
      await s.stop();
    }
  }, 40_000);

  it("an Expected column of the wrong length is refused rather than reinterpreted", async () => {
    const s = sup();
    try {
      await expect(
        s.request("goodnessoffit", { observed: [10, 20, 30, 40], expected: [10, 20, 30] }),
      ).rejects.toThrow(/incomplete/i);
    } finally {
      await s.stop();
    }
  }, 40_000);
});

/**
 * Zero variance must not claim certainty from data that cannot support any.
 *
 * scipy returns p = 0.0 when the within-group variance is zero; passed through, the result
 * would assert "the group means differ significantly" while every post-hoc comparison beside
 * it reported p = 1.0 — the same result contradicting itself. An undefined statistic is
 * reported as unavailable, never as a number, and the post-hocs are skipped rather than
 * printed, because they all divide by that same zero variance.
 */
describe.skipIf(!SCIPY)("zero variance reports 'undefined', not p = 0", () => {
  const CONSTANT = { groups: [[5, 5, 5], [5, 5, 5], [9, 9, 9]], labels: ["A", "B", "C"], variant: "oneway" };

  it("ANOVA: F and p are unavailable, no post-hoc is printed, and the reason is stated", async () => {
    const s = sup();
    try {
      const r = await s.request("anova1", { ...CONSTANT, posthoc: "tukey" });
      const g = r["glance"] as Record<string, unknown>;
      expect(g["F"]).toBeNull();
      expect(g["p"]).toBeNull();
      expect(comparisons(r)).toEqual([]);
      expect(String(r["summary"])).toMatch(/variance is zero/i);
      expect((r["assumptions"] as string[]).join(" ")).toMatch(/no P value exists/i);
      // The means themselves are exact and must still be reported.
      expect(groupMeans(r)).toEqual({ A: 5, B: 5, C: 9 });
    } finally {
      await s.stop();
    }
  }, 40_000);

  it("t test: an unavailable statistic means an unavailable p, and it does not read as 'not significant'", async () => {
    const s = sup();
    try {
      const r = await s.request("ttest", { a: [5, 5, 5, 5], b: [7, 7, 7, 7], variant: "welch" });
      const g = r["glance"] as Record<string, unknown>;
      expect(g["t"]).toBeNull();
      expect(g["p"]).toBeNull();
      // "not statistically significant" would be a finding the data cannot support.
      expect(String(r["summary"])).not.toMatch(/not statistically significant/i);
      expect(String(r["summary"])).toMatch(/not determinable/i);
    } finally {
      await s.stop();
    }
  }, 40_000);

  it("control case: ordinary data is unaffected — F, p and the post-hocs all still appear", async () => {
    const s = sup();
    try {
      const r = await s.request("anova1", { groups: [[1, 2, 3], [4, 5, 6], [7, 8, 9]], labels: ["A", "B", "C"], variant: "oneway", posthoc: "tukey" });
      const g = r["glance"] as Record<string, number>;
      expect(g["F"]).toBeCloseTo(27, 6);
      expect(g["p"]).toBeCloseTo(0.001, 6);
      expect(comparisons(r)).toHaveLength(3);
    } finally {
      await s.stop();
    }
  }, 40_000);

  it("control case: the nonparametric test is still computable on constant groups", async () => {
    const s = sup();
    try {
      const r = await s.request("ttest", { a: [5, 5, 5, 5], b: [7, 7, 7, 7], variant: "mann-whitney" });
      expect((r["glance"] as Record<string, number>)["p"]).toBeGreaterThan(0);
    } finally {
      await s.stop();
    }
  }, 40_000);
});

/**
 * A perfectly separated fit must be refused, not reported as valid.
 *
 * statsmodels only warns on separation: left unchecked, a separated logistic fit reports a
 * huge intercept and slope with p ≈ 1, McFadden R² = 1.0 and accuracy 1.0. PHReg (Cox) does
 * not raise on failure either; a separated Cox fit reports a huge β with p ≈ 1 and
 * Harrell's C = 1.0, so convergence has to be read from the fit, not assumed.
 *
 * The maximum-likelihood fit does not exist in either case; the coefficients are just
 * where the optimiser stopped. The p ≈ 1 (Hauck-Donner) invites exactly the wrong
 * reading — "this predictor doesn't matter" — from data it predicts perfectly.
 */
describe.skipIf(!SCIPY)("a fit that does not exist is refused, not reported as a result", () => {
  it("logistic: perfect separation is refused, naming the remedy", async () => {
    const s = sup();
    try {
      await expect(
        s.request("logistic", { y: [0, 0, 0, 0, 1, 1, 1, 1], predictors: [[1, 2, 3, 4, 10, 11, 12, 13]], labels: ["x"] }),
      ).rejects.toThrow(/perfectly separated[\s\S]*Firth|Firth[\s\S]*separat/i);
    } finally {
      await s.stop();
    }
  }, 40_000);

  it("logistic: the assumption list claims no check it did not run", async () => {
    const s = sup();
    try {
      const r = await s.request("logistic", {
        y: [0, 0, 1, 0, 1, 1, 0, 1, 1, 1], predictors: [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]], labels: ["x"],
      });
      expect((r["assumptions"] as string[]).join(" ")).toMatch(/separation is checked for and refused/i);
    } finally {
      await s.stop();
    }
  }, 40_000);

  it("Cox: a non-converged (separated) fit is refused", async () => {
    const s = sup();
    try {
      await expect(
        s.request("cox", {
          time: [1, 2, 3, 4, 50, 60, 70, 80], event: [1, 1, 1, 1, 1, 1, 1, 1],
          predictors: [[1, 2, 3, 4, 10, 11, 12, 13]], labels: ["x"],
        }),
      ).rejects.toThrow(/did not converge/i);
    } finally {
      await s.stop();
    }
  }, 40_000);

  it("control case: ordinary logistic and Cox fits still work", async () => {
    const s = sup();
    try {
      const lg = await s.request("logistic", {
        y: [0, 0, 1, 0, 1, 1, 0, 1, 1, 1], predictors: [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]], labels: ["x"],
      });
      expect((lg["glance"] as Record<string, number>)["accuracy"]).toBeGreaterThan(0);
      const cx = await s.request("cox", {
        time: [5, 8, 12, 15, 20, 25, 30, 40], event: [1, 1, 0, 1, 1, 0, 1, 1],
        predictors: [[2, 5, 1, 7, 3, 9, 4, 8]], labels: ["x"],
      });
      expect(Number.isFinite((cx["terms"] as Array<Record<string, number>>)[0]!["estimate"])).toBe(true);
    } finally {
      await s.stop();
    }
  }, 60_000);
});
