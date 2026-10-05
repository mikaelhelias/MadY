// @vitest-environment node
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SidecarSupervisor } from "./sidecar";

const enginePath = fileURLToPath(new URL("../../../../engines/py/engine.py", import.meta.url));
const py = process.platform === "win32" ? "py" : "python3";

/** SciPy availability — the numeric validation needs it; skip cleanly otherwise. */
function hasScipy(): boolean {
  try {
    execSync(`${py} -c "import scipy, numpy"`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
const SCIPY = hasScipy();

function sup(): SidecarSupervisor {
  return new SidecarSupervisor({ command: py, args: [enginePath], startTimeoutMs: 30_000 });
}

/**
 * Validate the stats engine against reference values computed independently
 * (hand-calculation / textbook). Each method returns the tidy contract.
 */
describe.skipIf(!SCIPY)("stats engine — validated against reference values", () => {
  it("describe: full descriptives (classic SD example)", async () => {
    const s = sup();
    try {
      // [2,4,4,4,5,5,7,9] → mean 5, population SD 2, sample SD ≈ 2.1381.
      const r = await s.request("describe", { values: [2, 4, 4, 4, 5, 5, 7, 9] });
      expect(r["method"]).toBe("describe");
      const g = r["glance"] as Record<string, number>;
      expect(g["n"]).toBe(8);
      expect(g["mean"]).toBeCloseTo(5, 6);
      expect(g["sd"]).toBeCloseTo(2.1381, 3);
      expect(typeof r["summary"]).toBe("string");
    } finally {
      await s.stop();
    }
  }, 20_000);

  it("describe: CI of the geometric mean + distribution-free CI of the median", async () => {
    const s = sup();
    try {
      const find = (terms: Array<Record<string, unknown>>, term: string) =>
        terms.find((t) => t["term"] === term) as Record<string, number>;
      // Geometric mean of [2,4,8] = 4; CI = exp(mean(log) ± t·SE(log)) = [0.7149, 22.38].
      const gm = find((await s.request("describe", { values: [2, 4, 8] }))["terms"] as Array<Record<string, unknown>>, "Geometric mean");
      expect(gm["estimate"]).toBeCloseTo(4.0, 6);
      expect(gm["ciLow"]).toBeCloseTo(0.71492, 4);
      expect(gm["ciHigh"]).toBeCloseTo(22.38, 2);
      // Median CI for 1..10 (n=10) is the order-statistic interval [X(2), X(9)] = [2, 9] (textbook).
      const md = find((await s.request("describe", { values: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }))["terms"] as Array<Record<string, unknown>>, "Median");
      expect(md["ciLow"]).toBe(2);
      expect(md["ciHigh"]).toBe(9);
      // n=5 is too few for a 95% distribution-free median CI → no CI.
      const md5 = find((await s.request("describe", { values: [1, 2, 3, 4, 5] }))["terms"] as Array<Record<string, unknown>>, "Median");
      expect(md5["ciLow"]).toBeNull();
    } finally {
      await s.stop();
    }
  }, 20_000);

  it("normality: Shapiro-Wilk on a known sample", async () => {
    const s = sup();
    try {
      const r = await s.request("normality", { values: [2, 4, 4, 4, 5, 5, 7, 9, 6, 5, 4, 3] });
      const g = r["glance"] as Record<string, number | string>;
      expect(g["shapiro_W"]).toBeCloseTo(0.9283, 3);
      expect(g["shapiro_p"]).toBeCloseTo(0.362, 2);
      // The secondary tests carried in the result.
      const terms = r["terms"] as Array<Record<string, number | string>>;
      const by = (t: string) => terms.find((x) => x.term === t);
      for (const name of ["D'Agostino-Pearson", "Anderson-Darling", "Kolmogorov-Smirnov (Lilliefors)"]) {
        const row = by(name);
        expect(row, name).toBeTruthy();
        const p = row!.p as number;
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(1);
      }
      // Normal-vs-lognormal preference (these values are all positive → the test runs).
      expect(["normal", "lognormal"]).toContain(g["prefers"]);
      expect(g["lognormal_prob"] as number).toBeGreaterThan(0.5);
      expect(by("P(preferred, by AIC)")).toBeTruthy();
    } finally {
      await s.stop();
    }
  }, 20_000);

  it("ttest one-sample: t/df/p/Cohen's d match hand-calc", async () => {
    const s = sup();
    try {
      // [3,4,5,4,6,5,4,5,4,6] vs μ=4 → mean 4.6, sd 0.9661, t 1.964, df 9, p 0.0811, d 0.621.
      const g = (await s.request("ttest", {
        variant: "one-sample",
        a: [3, 4, 5, 4, 6, 5, 4, 5, 4, 6],
        mu: 4,
      }))["glance"] as Record<string, number>;
      expect(g["t"]).toBeCloseTo(1.964, 2);
      expect(g["df"]).toBe(9);
      expect(g["p"]).toBeCloseTo(0.0811, 3);
      expect(g["cohens_d"]).toBeCloseTo(0.621, 2);
      expect(g["hedges_g"]).toBeCloseTo(0.5678, 3); // d × (1 − 3/(4·9−1))
      // Diagnostic: sample-normality (Shapiro-Wilk) on the sample itself.
      const t1 = (await s.request("ttest", { variant: "one-sample", a: [3, 4, 5, 4, 6, 5, 4, 5, 4, 6], mu: 4 }))["terms"] as Array<Record<string, unknown>>;
      expect((t1.find((t) => t["term"] === "Sample normality (Shapiro-Wilk)") as Record<string, number>)["statistic"]).toBeCloseTo(0.90444, 4);
    } finally {
      await s.stop();
    }
  }, 20_000);

  it("ttest paired: matched-pairs t", async () => {
    const s = sup();
    try {
      const g = (await s.request("ttest", {
        variant: "paired",
        a: [20, 22, 19, 24, 25],
        b: [18, 20, 18, 23, 22],
      }))["glance"] as Record<string, number>;
      expect(g["t"]).toBeCloseTo(4.8107, 3);
      expect(g["df"]).toBe(4);
      expect(g["p"]).toBeCloseTo(0.00858, 4);
      expect(g["hedges_g"]).toBeCloseTo(1.72113, 4); // 2.15141 × 0.8
      // Diagnostic: normality of the paired differences (the paired-t assumption).
      const tp = (await s.request("ttest", { variant: "paired", a: [20, 22, 19, 24, 25], b: [18, 20, 18, 23, 22] }))["terms"] as Array<Record<string, unknown>>;
      expect((tp.find((t) => t["term"] === "Difference normality (Shapiro-Wilk)") as Record<string, number>)["statistic"]).toBeCloseTo(0.88104, 4);
    } finally {
      await s.stop();
    }
  }, 20_000);

  it("ttest effect-size CIs: exact noncentral-t CI for Cohen's d", async () => {
    const s = sup();
    try {
      const find = (terms: Array<Record<string, unknown>>, term: string) =>
        terms.find((t) => t["term"] === term) as Record<string, number>;
      // one-sample d=0.621, df=9, n=10. Inverting nct.cdf at the bounds gives exactly 0.975/0.025.
      const os = (await s.request("ttest", { variant: "one-sample", a: [3, 4, 5, 4, 6, 5, 4, 5, 4, 6], mu: 4 }))["terms"] as Array<Record<string, unknown>>;
      const d1 = find(os, "Cohen's d");
      expect(d1["ciLow"]).toBeCloseTo(-0.07416, 4);
      expect(d1["ciHigh"]).toBeCloseTo(1.28826, 4);
      // unpaired d=−1.2, df=8, n_eff=2.5.
      const up = (await s.request("ttest", { variant: "unpaired", a: [1, 2, 3, 4, 5], b: [2, 4, 6, 8, 10] }))["terms"] as Array<Record<string, unknown>>;
      const d2 = find(up, "Cohen's d");
      expect(d2["ciLow"]).toBeCloseTo(-2.5377, 4);
      expect(d2["ciHigh"]).toBeCloseTo(0.19787, 4);
    } finally {
      await s.stop();
    }
  }, 20_000);

  it("ttest Welch vs Student: same t, different df/p under unequal variance", async () => {
    const s = sup();
    try {
      const welch = (await s.request("ttest", { variant: "welch", a: [1, 2, 3, 4, 5], b: [2, 4, 6, 8, 10] }))["glance"] as Record<string, number>;
      const student = (await s.request("ttest", { variant: "unpaired", a: [1, 2, 3, 4, 5], b: [2, 4, 6, 8, 10] }))["glance"] as Record<string, number>;
      expect(welch["t"]).toBeCloseTo(-1.8974, 3);
      expect(student["t"]).toBeCloseTo(-1.8974, 3);
      expect(student["df"]).toBe(8);
      expect(welch["df"]).toBeCloseTo(5.882, 2); // Welch–Satterthwaite
      expect(welch["p"]).toBeCloseTo(0.1075, 3);
      expect(student["p"]).toBeCloseTo(0.0944, 3);
      // Effect sizes (pooled-SD d, Hedges' g, Glass's Δ with group B as control).
      expect(student["cohens_d"]).toBeCloseTo(-1.2, 6);
      expect(student["hedges_g"]).toBeCloseTo(-1.08387, 4);
      expect(student["glass_delta"]).toBeCloseTo(-0.94868, 4);
      // Diagnostics: F test for equal variances (F=10/2.5=4, two-sided p=0.208) + residual normality.
      const terms = (await s.request("ttest", { variant: "unpaired", a: [1, 2, 3, 4, 5], b: [2, 4, 6, 8, 10] }))["terms"] as Array<Record<string, unknown>>;
      const find = (term: string) => terms.find((t) => t["term"] === term) as Record<string, number>;
      expect(find("Equal variances (F test)")["statistic"]).toBeCloseTo(4.0, 6);
      expect(find("Equal variances (F test)")["p"]).toBeCloseTo(0.208, 3);
      expect(find("Residual normality (Shapiro-Wilk)")["statistic"]).toBeCloseTo(0.98240, 4);
    } finally {
      await s.stop();
    }
  }, 20_000);

  it("one-tailed: t-test + correlation one-sided p = half two-sided, with a one-sided CI", async () => {
    const s = sup();
    try {
      const a = [5, 6, 7, 8, 9];
      const b = [1, 2, 3, 4, 5];
      const diffRow = (terms: Array<Record<string, unknown>>) =>
        terms.find((t) => String(t["term"]).startsWith("Difference")) as Record<string, number | null>;
      const two = diffRow((await s.request("ttest", { variant: "unpaired", a, b }))["terms"] as Array<Record<string, unknown>>);
      const gt = diffRow((await s.request("ttest", { variant: "unpaired", a, b, tail: "greater" }))["terms"] as Array<Record<string, unknown>>);
      const lt = diffRow((await s.request("ttest", { variant: "unpaired", a, b, tail: "less" }))["terms"] as Array<Record<string, unknown>>);
      // p(greater) = p(two-sided)/2 when the effect is in the predicted direction.
      expect(gt["p"]!).toBeCloseTo(two["p"]! / 2, 6);
      expect(lt["p"]!).toBeCloseTo(1 - two["p"]! / 2, 6);
      // One-sided CIs are open on the far side (null = ±∞).
      expect(gt["ciLow"]).not.toBeNull();
      expect(gt["ciHigh"]).toBeNull();
      expect(lt["ciLow"]).toBeNull();
      expect(lt["ciHigh"]).not.toBeNull();

      // Correlation: same halving + one-sided CI; conf level honoured.
      const c2 = (await s.request("correlation", { variant: "pearson", a: [1, 2, 3, 4, 5], b: [2, 4, 5, 4, 6] }))["terms"] as Array<Record<string, number | null>>;
      const cg = (await s.request("correlation", { variant: "pearson", a: [1, 2, 3, 4, 5], b: [2, 4, 5, 4, 6], tail: "greater" }))["terms"] as Array<Record<string, number | null>>;
      expect(cg[0]!["p"]!).toBeCloseTo((c2[0]!["p"] as number) / 2, 6);
      expect(cg[0]!["ciHigh"]).toBeNull();
      expect(cg[0]!["ciLow"]).not.toBeNull();
    } finally {
      await s.stop();
    }
  }, 20_000);

  it("one-sample Wilcoxon: signed-rank vs μ matches scipy + reports the median", async () => {
    const s = sup();
    try {
      const a = [3, 5, 8, 2, 9, 11, 4, 7];
      const r = await s.request("ttest", { variant: "wilcoxon-1samp", a, mu: 4 });
      const terms = r["terms"] as Array<Record<string, unknown>>;
      const find = (term: string) => terms.find((t) => t["term"] === term) as Record<string, number>;
      expect(find("Wilcoxon W")["statistic"]).toBeCloseTo(4.5, 6);
      expect(find("Wilcoxon W")["p"]).toBeCloseTo(0.125, 4);
      expect(find("Median")["estimate"]).toBeCloseTo(6, 6);
      // one-tailed halves the p-value
      const gt = (await s.request("ttest", { variant: "wilcoxon-1samp", a, mu: 4, tail: "greater" }))["glance"] as Record<string, number>;
      expect(gt["p"]).toBeCloseTo(0.0625, 4);
    } finally {
      await s.stop();
    }
  }, 20_000);

  /**
   * Sign convention of the rank-biserial correlation. Guards against the sign being
   * inverted: +1 for a group lying entirely below the other would contradict the medians
   * reported in the same result (Median A = 3 against Median B = 8).
   *
   * The convention is fixed independently of the engine by counting pairs (Kerby's
   * simple-difference form, r = P(a>b) − P(a<b), no U involved): A entirely below B → −1,
   * A entirely above → +1, identical → 0, A mostly below → −0.75.
   */
  it("ttest Mann-Whitney: A entirely below B → U=0 and rank-biserial=−1 (sign agrees with the medians)", async () => {
    const s = sup();
    try {
      const r = await s.request("ttest", { variant: "mann-whitney", a: [1, 2, 3, 4, 5], b: [6, 7, 8, 9, 10] });
      const g = r["glance"] as Record<string, number>;
      expect(g["U"]).toBe(0);
      expect(g["rank_biserial"]).toBeCloseTo(-1, 6);
      expect(g["p"]).toBeCloseTo(0.00794, 4);
      // The effect size must not disagree with the medians the same result prints.
      const med = (t: string): number =>
        (r["terms"] as Array<Record<string, unknown>>).find((x) => x["term"] === t)!["estimate"] as number;
      expect(Math.sign(g["rank_biserial"]!)).toBe(Math.sign(med("Median A") - med("Median B")));
    } finally {
      await s.stop();
    }
  }, 20_000);

  it("ttest Mann-Whitney: reversing the groups flips the sign to +1", async () => {
    const s = sup();
    try {
      const g = (await s.request("ttest", { variant: "mann-whitney", a: [6, 7, 8, 9, 10], b: [1, 2, 3, 4, 5] }))["glance"] as Record<string, number>;
      expect(g["rank_biserial"]).toBeCloseTo(1, 6);
    } finally {
      await s.stop();
    }
  }, 20_000);

  it("ttest Mann-Whitney: partial overlap gives the definitional −0.75, and identical groups 0", async () => {
    const s = sup();
    try {
      // [1,2,3,4] vs [3,4,5,6]: 16 pairs — 2 with a>b, 14 with a<b → (2−14)/16 = −0.75.
      const g = (await s.request("ttest", { variant: "mann-whitney", a: [1, 2, 3, 4], b: [3, 4, 5, 6] }))["glance"] as Record<string, number>;
      expect(g["rank_biserial"]).toBeCloseTo(-0.75, 6);
      const same = (await s.request("ttest", { variant: "mann-whitney", a: [1, 2, 3], b: [1, 2, 3] }))["glance"] as Record<string, number>;
      expect(same["rank_biserial"]).toBeCloseTo(0, 6);
    } finally {
      await s.stop();
    }
  }, 20_000);

  it("ttest KS + ratio-paired: two-sample KS D + geometric-mean ratio", async () => {
    const s = sup();
    try {
      // Complete separation → KS D = 1 (max ECDF gap); scipy exact p.
      const ks = (await s.request("ttest", { variant: "ks", a: [1, 2, 3, 4], b: [5, 6, 7, 8] }))["glance"] as Record<string, number>;
      expect(ks["D"]).toBeCloseTo(1.0, 6);
      expect(ks["p"]).toBeCloseTo(0.028571, 4);
      const ksp = (await s.request("ttest", { variant: "ks", a: [1, 2, 3, 4, 5, 6], b: [4, 5, 6, 7, 8, 9] }))["glance"] as Record<string, number>;
      expect(ksp["D"]).toBeCloseTo(0.5, 6); // max ECDF gap by hand

      // Ratio paired t on log(A/B): ratios [2,4,4] → geo-mean ratio 32^(1/3) = 3.1748, t = 5, df 2.
      const rt = (await s.request("ttest", { variant: "ratio-paired", a: [2, 4, 8], b: [1, 1, 2] }))["glance"] as Record<string, number>;
      expect(rt["geo_mean_ratio"]).toBeCloseTo(3.1748, 4);
      expect(rt["t"]).toBeCloseTo(5.0, 4);
      expect(rt["df"]).toBe(2);
      expect(rt["p"]).toBeCloseTo(0.03775, 4);
    } finally {
      await s.stop();
    }
  }, 20_000);

  it("anova1: one-way ANOVA F/df/eta² + Kruskal-Wallis", async () => {
    const s = sup();
    try {
      const a = (await s.request("anova1", { groups: [[1, 2, 3, 4], [2, 3, 4, 5], [6, 7, 8, 9]] }))["glance"] as Record<string, number>;
      expect(a["F"]).toBeCloseTo(16.8, 1);
      expect(a["df_between"]).toBe(2);
      expect(a["df_within"]).toBe(9);
      expect(a["p"]).toBeCloseTo(0.000916, 5);
      expect(a["eta_sq"]).toBeCloseTo(0.7887, 3);
      const k = (await s.request("anova1", { variant: "kruskal", groups: [[1, 2, 3], [4, 5, 6], [7, 8, 9]] }))["glance"] as Record<string, number>;
      expect(k["H"]).toBeCloseTo(7.2, 2);
      expect(k["p"]).toBeCloseTo(0.0273, 3);
      // The UI names this method "anova" — it must resolve to the same engine fn.
      const aliased = (await s.request("anova", { groups: [[1, 2, 3, 4], [2, 3, 4, 5], [6, 7, 8, 9]] }))["glance"] as Record<string, number>;
      expect(aliased["F"]).toBeCloseTo(16.8, 1);
    } finally {
      await s.stop();
    }
  }, 20_000);

  it("posthoc: CIs of the difference for Tukey / Bonferroni / Dunnett (Holm = P only)", async () => {
    const s = sup();
    try {
      const data = { groups: [[1, 2, 3, 4], [2, 3, 4, 5], [6, 7, 8, 9]] }; // means 2.5/3.5/7.5, MSE 5/3, df 9
      const find = (terms: Array<Record<string, unknown>>, term: string) =>
        terms.find((t) => t["term"] === term) as Record<string, number>;

      const tuk = (await s.request("anova1", { ...data, posthoc: "tukey" }))["terms"] as Array<Record<string, unknown>>;
      const t13 = find(tuk, "Group 1 vs Group 3");
      expect(t13["estimate"]).toBeCloseTo(-5, 6);
      expect(t13["ciLow"]).toBeCloseTo(-7.54874, 4); // scipy tukey_hsd confidence_interval
      expect(t13["ciHigh"]).toBeCloseTo(-2.45126, 4);

      const bon = (await s.request("anova1", { ...data, posthoc: "bonferroni" }))["terms"] as Array<Record<string, unknown>>;
      const b13 = find(bon, "Group 1 vs Group 3");
      expect(b13["ciLow"]).toBeCloseTo(-7.67775, 4); // diff ± t.ppf(1 − 0.05/3/2, 9)·SE
      expect(b13["ciHigh"]).toBeCloseTo(-2.32225, 4);
      // Tukey is tighter than Bonferroni for all-pairs.
      expect(Math.abs(t13["ciHigh"]! - t13["ciLow"]!)).toBeLessThan(Math.abs(b13["ciHigh"]! - b13["ciLow"]!));

      const dun = (await s.request("anova1", { ...data, posthoc: "dunnett" }))["terms"] as Array<Record<string, unknown>>;
      const d31 = find(dun, "Group 3 vs Group 1");
      expect(d31["estimate"]).toBeCloseTo(5, 6);
      // Dunnett's CI has no closed form — SciPy integrates the multivariate t by Monte-Carlo —
      // so the engine seeds it. Asserted to 5 places, not loosely, because a seeded result is a
      // fixed number; an unseeded one moves by ~0.0026 between identical runs.
      expect(d31["ciLow"]).toBeCloseTo(2.615887, 5);
      expect(d31["ciHigh"]).toBeCloseTo(7.384113, 5);

      // The property that matters most: asking the same question twice gives the same
      // answer. Closeness to a constant does not test that — an interval that changes on every
      // run can still pass it, and would move a published number.
      const again = (await s.request("anova1", { ...data, posthoc: "dunnett" }))["terms"] as Array<Record<string, unknown>>;
      expect(
        JSON.stringify(find(again, "Group 3 vs Group 1")),
        "the same Dunnett request returned a different confidence interval the second time",
      ).toBe(JSON.stringify(d31));

      // Holm-Šídák is step-down → adjusted P only, no simultaneous CI.
      const holm = (await s.request("anova1", { ...data, posthoc: "holm-sidak" }))["terms"] as Array<Record<string, unknown>>;
      expect(find(holm, "Group 1 vs Group 3")["ciLow"]).toBeUndefined();
    } finally {
      await s.stop();
    }
  }, 20_000);

  it("posthoc: Games-Howell (unequal-variance CIs) + Benjamini-Hochberg FDR (≤ Bonferroni)", async () => {
    const s = sup();
    try {
      const data = { groups: [[1, 2, 3, 4], [2, 3, 4, 5], [6, 7, 8, 9]] }; // means 2.5 / 3.5 / 7.5
      const find = (terms: Array<Record<string, unknown>>, term: string) =>
        terms.find((t) => t["term"] === term) as Record<string, number>;
      const pairs = ["Group 1 vs Group 2", "Group 1 vs Group 3", "Group 2 vs Group 3"];

      // Games-Howell: per-pair unequal-variance CI (does not pool); the far-apart pair is significant.
      const gh = (await s.request("anova1", { ...data, posthoc: "games-howell" }))["terms"] as Array<Record<string, unknown>>;
      const g13 = find(gh, "Group 1 vs Group 3");
      expect(g13["estimate"]).toBeCloseTo(-5, 6);
      expect(typeof g13["ciLow"]).toBe("number");
      expect(g13["ciLow"]!).toBeLessThan(g13["ciHigh"]!);
      expect(g13["p"]).toBeGreaterThanOrEqual(0);
      expect(g13["p"]).toBeLessThan(0.05); // 2.5 vs 7.5 clearly differ

      // Benjamini-Hochberg FDR: adjusted q-values, always ≤ the Bonferroni-adjusted p (less conservative),
      // and (like Holm) no simultaneous CI. The ≤ relation is a mathematical guarantee → self-validating.
      const fdr = (await s.request("anova1", { ...data, posthoc: "fdr" }))["terms"] as Array<Record<string, unknown>>;
      const bon = (await s.request("anova1", { ...data, posthoc: "bonferroni" }))["terms"] as Array<Record<string, unknown>>;
      for (const pair of pairs) {
        const pf = find(fdr, pair)["p"]!;
        const pb = find(bon, pair)["p"]!;
        expect(pf).toBeLessThanOrEqual(pb + 1e-9);
        expect(pf).toBeGreaterThanOrEqual(0);
        expect(pf).toBeLessThanOrEqual(1);
      }
      expect(find(fdr, "Group 1 vs Group 3")["ciLow"]).toBeUndefined();
    } finally {
      await s.stop();
    }
  }, 20_000);

  it("posthoc: Tamhane T3 (unequal variance) reduces to Welch's t at k=2 and is multiplicity-monotone", async () => {
    const s = sup();
    const find = (terms: Array<Record<string, unknown>>, term: string) =>
      terms.find((t) => t["term"] === term) as Record<string, number>;
    try {
      // k=2 (m=1): Tamhane T3 must equal Welch's unpaired t-test — p + CI (scipy reference).
      const two = { groups: [[5.0, 6.0, 7.0, 6.0, 5.5, 6.5, 5.8], [7.0, 8.0, 6.5, 9.0, 7.5, 8.2]] };
      const t2 = (await s.request("anova1", { ...two, posthoc: "tamhane" }))["terms"] as Array<Record<string, unknown>>;
      const r2 = find(t2, "Group 1 vs Group 2");
      expect(r2["p"]).toBeCloseTo(0.00346084, 5); // scipy ttest_ind(equal_var=False)
      expect(r2["ciLow"]).toBeCloseTo(-2.72392, 4);
      expect(r2["ciHigh"]).toBeCloseTo(-0.73323, 4);

      // k=3: adjusted p in [0,1], the far-apart pair significant; fewer comparisons (vs-control, m=2)
      // give a ≤ adjusted p than all-pairs (m=3) for the same pair — the multiplicity is monotone.
      const data3 = { groups: [[10, 12, 11, 13, 9, 11, 12], [15, 18, 16, 20, 14, 17, 19], [10.5, 11.5, 10, 12, 9.5, 11]] };
      const allp = (await s.request("anova1", { ...data3, posthoc: "tamhane" }))["terms"] as Array<Record<string, unknown>>;
      const vsc = (await s.request("anova1", { ...data3, posthoc: "tamhane", scheme: "vs-control", control: 0 }))["terms"] as Array<Record<string, unknown>>;
      expect(find(allp, "Group 1 vs Group 2")["p"]).toBeLessThan(0.05);
      // vs-control orders the pair "Group 2 vs Group 1" (same pair, m=2 < the all-pairs m=3).
      expect(find(vsc, "Group 2 vs Group 1")["p"]!).toBeLessThanOrEqual(find(allp, "Group 1 vs Group 2")["p"]! + 1e-9);
      for (const r of allp.filter((t) => String(t["term"]).includes(" vs "))) {
        expect(r["p"] as number).toBeGreaterThanOrEqual(0);
        expect(r["p"] as number).toBeLessThanOrEqual(1);
        expect(r["ciLow"] as number).toBeLessThan(r["ciHigh"] as number);
      }
    } finally {
      await s.stop();
    }
  }, 20_000);

  it("posthoc: selected-pairs corrects for the chosen count (m), not all pairs, and guards misuse", async () => {
    const s = sup();
    const find = (terms: Array<Record<string, unknown>>, term: string) =>
      terms.find((t) => t["term"] === term) as Record<string, number>;
    const comps = (terms: Array<Record<string, unknown>>) => terms.filter((t) => String(t["term"]).includes(" vs "));
    try {
      const data = { groups: [[10, 12, 11, 13], [14, 15, 13, 16], [9, 8, 10, 11], [20, 22, 21, 19]] };
      // Pick 2 of the 6 possible pairs → only those two comparison rows appear.
      const sel = (await s.request("anova1", { ...data, posthoc: "bonferroni", scheme: "selected-pairs", pairs: [[0, 1], [0, 3]] }))["terms"] as Array<Record<string, unknown>>;
      expect(comps(sel).map((t) => t["term"])).toEqual(["Group 1 vs Group 2", "Group 1 vs Group 4"]);
      // Bonferroni over m=2 (selected) vs m=6 (all pairs): same raw p, so p_sel = p_all·(2/6).
      const all = (await s.request("anova1", { ...data, posthoc: "bonferroni", scheme: "all-pairs" }))["terms"] as Array<Record<string, unknown>>;
      const pSel = find(sel, "Group 1 vs Group 2")["p"]!;
      const pAll = find(all, "Group 1 vs Group 2")["p"]!;
      expect(pSel).toBeCloseTo((pAll * 2) / 6, 4);
      // …and the selected CI is narrower (smaller tcrit at m=2 than m=6).
      const wSel = find(sel, "Group 1 vs Group 2");
      const wAll = find(all, "Group 1 vs Group 2");
      expect(Math.abs(wSel["ciHigh"]! - wSel["ciLow"]!)).toBeLessThan(Math.abs(wAll["ciHigh"]! - wAll["ciLow"]!));

      // Duplicate + reversed pairs collapse to a single comparison (dedup by unordered identity).
      const dup = (await s.request("anova1", { ...data, posthoc: "bonferroni", scheme: "selected-pairs", pairs: [[0, 1], [1, 0], [0, 1]] }))["terms"] as Array<Record<string, unknown>>;
      expect(comps(dup)).toHaveLength(1);

      // Guards: Tukey (studentized range = all pairs) is rejected for selected pairs; empty selection too.
      await expect(s.request("anova1", { ...data, posthoc: "tukey", scheme: "selected-pairs", pairs: [[0, 1]] })).rejects.toThrow(/selected pairs/i);
      await expect(s.request("anova1", { ...data, posthoc: "bonferroni", scheme: "selected-pairs", pairs: [] })).rejects.toThrow(/at least one/i);
    } finally {
      await s.stop();
    }
  }, 20_000);

  it("anova1 welch + brown-forsythe: unequal-variance ANOVAs match statsmodels", async () => {
    const s = sup();
    try {
      // Unequal spreads. statsmodels anova_oneway(use_var='unequal'/'bf') is the reference;
      // the engine computes Welch by an independent numpy formula (hand-verified F=8.688, df2=4.1767).
      const data = { groups: [[1, 2, 3, 4, 5], [10, 20, 30], [5, 6, 7, 8]] };
      const w = (await s.request("anova1", { ...data, variant: "welch" }))["glance"] as Record<string, number>;
      expect(w["F"]).toBeCloseTo(8.687971, 4);
      expect(w["df_between"]).toBeCloseTo(2, 6);
      expect(w["df_within"]).toBeCloseTo(4.176669, 4);
      expect(w["p"]).toBeCloseTo(0.032487, 5);
      const bf = (await s.request("anova1", { ...data, variant: "brown-forsythe" }))["glance"] as Record<string, number>;
      expect(bf["F"]).toBeCloseTo(7.26983, 4); // SSB/Σ(1−n_i/N)s_i² = 563.9/77.57 by hand
      expect(bf["df_within"]).toBeCloseTo(2.138667, 4);
      expect(bf["p"]).toBeCloseTo(0.107041, 5);
    } finally {
      await s.stop();
    }
  }, 20_000);

  it("anova1 residual diagnostics: residual normality + homoscedasticity vs scipy", async () => {
    const s = sup();
    try {
      const find = (terms: Array<Record<string, unknown>>, term: string) =>
        terms.find((t) => t["term"] === term) as Record<string, number>;
      // Equal-spread groups → Bartlett & Brown-Forsythe both 0 (p=1); Shapiro on pooled residuals.
      const eq = (await s.request("anova1", { groups: [[1, 2, 3, 4], [2, 3, 4, 5], [6, 7, 8, 9]] }))["terms"] as Array<Record<string, unknown>>;
      expect(find(eq, "Residual normality (Shapiro-Wilk)")["statistic"]).toBeCloseTo(0.876187, 4);
      expect(find(eq, "Residual normality (Shapiro-Wilk)")["p"]).toBeCloseTo(0.078338, 4);
      expect(find(eq, "Equal variances (Bartlett)")["p"]).toBeCloseTo(1.0, 6);
      expect(find(eq, "Equal variances (Brown-Forsythe)")["p"]).toBeCloseTo(1.0, 6);
      // Unequal spreads → Bartlett flags it (steers the user to Welch).
      const uneq = (await s.request("anova1", { groups: [[1, 2, 3, 4, 5], [10, 20, 30], [5, 6, 7, 8]] }))["terms"] as Array<Record<string, unknown>>;
      expect(find(uneq, "Equal variances (Bartlett)")["p"]).toBeCloseTo(0.002266, 5);
    } finally {
      await s.stop();
    }
  }, 20_000);

  it("correlation: Pearson + Spearman", async () => {
    const s = sup();
    try {
      const p = (await s.request("correlation", { a: [1, 2, 3, 4, 5], b: [2, 4, 5, 4, 6] }))["glance"] as Record<string, number>;
      expect(p["r"]).toBeCloseTo(0.8528, 3);
      expect(p["r_sq"]).toBeCloseTo(0.7273, 3);
      const sp = (await s.request("correlation", { variant: "spearman", a: [1, 2, 3, 4, 5], b: [2, 4, 5, 4, 6] }))["glance"] as Record<string, number>;
      expect(sp["r"]).toBeCloseTo(0.8208, 3);
    } finally {
      await s.stop();
    }
  }, 20_000);

  it("rmanova: one-way RM ANOVA matches statsmodels AnovaRM + GG correction", async () => {
    const s = sup();
    try {
      // rows = subjects, cols = conditions. statsmodels AnovaRM: F=1.0, df 2/6, p=0.421875.
      const g = (await s.request("rmanova", { data: [[8, 7, 6], [5, 6, 4], [6, 5, 7], [7, 8, 5]] }))["glance"] as Record<string, number>;
      expect(g["F"]).toBeCloseTo(1.0, 6);
      expect(g["df_cond"]).toBe(2);
      expect(g["df_resid"]).toBe(6);
      expect(g["p"]).toBeCloseTo(0.421875, 5);
      expect(g["partial_eta_sq"]).toBeCloseTo(0.25, 4);
      expect(g["gg_epsilon"]).toBeCloseTo(0.6316, 3); // Greenhouse-Geisser ε
      expect(g["n_subjects"]).toBe(4);
      expect(g["k_conditions"]).toBe(3);
    } finally {
      await s.stop();
    }
  }, 20_000);

  it("rmanova friedman: χ² + Dunn's post-hoc match hand-calc", async () => {
    const s = sup();
    try {
      // Same RM data; within-subject ranks → rank sums [9,9,6]. χ²_r = 12/(4·3·4)·198 − 48 = 1.5,
      // df 2, p = exp(−0.75) ≈ 0.4724. Dunn's (Bonferroni ×3): z = 3/√8 = 1.06066 for the 9-vs-6 pairs.
      const r = await s.request("rmanova", { variant: "friedman", data: [[8, 7, 6], [5, 6, 4], [6, 5, 7], [7, 8, 5]] });
      const g = r["glance"] as Record<string, number>;
      expect(g["chi_sq"]).toBeCloseTo(1.5, 6);
      expect(g["df"]).toBe(2);
      expect(g["p"]).toBeCloseTo(0.472367, 5);
      const terms = r["terms"] as Array<Record<string, unknown>>;
      const find = (term: string) => terms.find((t) => t["term"] === term) as Record<string, number>;
      expect(find("Cond 1 vs Cond 3")["statistic"]).toBeCloseTo(1.06066, 4); // 3/√8
      expect(find("Cond 1 vs Cond 3")["p"]).toBeCloseTo(0.86653, 4); // 2·Φ(−1.06066)·3
      expect(find("Cond 1 vs Cond 2")["p"]).toBeCloseTo(1.0, 6); // equal rank sums

      // Tied data: Dunn's SE is tie-corrected (Σ 2·s²_b·k/(k−1) = 2.4495 < untied √8),
      // so z = ΔR/2.4495. Keeps the post-hoc consistent with scipy's tie-corrected χ².
      const rt = await s.request("rmanova", { variant: "friedman", data: [[1, 1, 2], [1, 2, 2], [1, 1, 3], [2, 2, 3]] });
      const tt = rt["terms"] as Array<Record<string, unknown>>;
      const findt = (term: string) => tt.find((t) => t["term"] === term) as Record<string, number>;
      expect(findt("Cond 1 vs Cond 3")["statistic"]).toBeCloseTo(2.44949, 4); // 6 / 2.4495 (tie-corrected SE)
      expect(findt("Cond 1 vs Cond 3")["p"]).toBeCloseTo(0.042918, 5);
    } finally {
      await s.stop();
    }
  }, 20_000);

  it("survival: KM medians + log-rank match the canonical Gehan dataset", async () => {
    const s = sup();
    try {
      // Gehan/Freireich leukemia data (weeks): textbook log-rank χ² ≈ 16.79, p ≈ 4.2e-5.
      const r = await s.request("survival", {
        groups: [
          { label: "6-MP", time: [6, 6, 6, 7, 10, 13, 16, 22, 23, 6, 9, 10, 11, 17, 19, 20, 25, 32, 32, 34, 35], event: [1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
          { label: "Placebo", time: [1, 1, 2, 2, 3, 4, 4, 5, 5, 8, 8, 8, 8, 11, 11, 12, 12, 15, 17, 22, 23], event: new Array(21).fill(1) },
        ],
      });
      const g = r["glance"] as Record<string, number>;
      expect(g["chi_sq"]).toBeCloseTo(16.793, 2);
      expect(g["df"]).toBe(1);
      expect(g["p"]).toBeCloseTo(4.17e-5, 6);
      const terms = r["terms"] as Array<Record<string, number>>;
      expect(terms[0]!["estimate"]).toBe(23); // 6-MP median
      expect(terms[0]!["events"]).toBe(9);
      expect(terms[1]!["estimate"]).toBe(8); // placebo median
      // Greenwood CI + censoring times are emitted per curve.
      const curves = (r["extra"] as Record<string, unknown>)["curves"] as Array<Record<string, number[]>>;
      const mp = curves[0]!;
      expect(mp["censor"]!.length).toBeGreaterThan(0); // 6-MP has censored subjects
      expect(mp["lower"]!.length).toBe(mp["times"]!.length);
      expect(mp["upper"]!.length).toBe(mp["times"]!.length);
      for (let k = 0; k < mp["surv"]!.length; k++) {
        expect(mp["lower"]![k]!).toBeLessThanOrEqual(mp["surv"]![k]! + 1e-9);
        expect(mp["upper"]![k]!).toBeGreaterThanOrEqual(mp["surv"]![k]! - 1e-9);
        expect(mp["lower"]![k]!).toBeGreaterThanOrEqual(0);
        expect(mp["upper"]![k]!).toBeLessThanOrEqual(1);
      }
      expect((curves[1]!["censor"] ?? []).length).toBe(0); // placebo: every subject had an event

      // --- reporting layer ---------------------------------------------------
      const byTerm = Object.fromEntries((r["terms"] as Array<Record<string, number | string>>).map((t) => [t["term"], t]));
      // Median 95% CI (Brookmeyer-Crowley): placebo median 8 → band [4, 11]; 6-MP upper not reached.
      const placeboMed = (r["terms"] as Array<Record<string, number>>)[1]!;
      expect(placeboMed["ciLow"]).toBe(4);
      expect(placeboMed["ciHigh"]).toBe(11);
      // Hazard ratio (6-MP / placebo) via the log-rank O/E method (the default estimate).
      const hr = byTerm["Hazard ratio (6-MP / Placebo)"] as Record<string, number>;
      expect(hr["estimate"]).toBeCloseTo(0.2393, 3);
      expect(hr["ciHigh"]).toBeLessThan(1); // CI [0.113, 0.505] excludes 1 → significant
      // Gehan-Breslow-Wilcoxon: the classic published statistic for this dataset (~13.46).
      const gehan = byTerm["Gehan-Breslow-Wilcoxon"] as Record<string, number>;
      expect(gehan["statistic"]).toBeCloseTo(13.458, 2);
      expect(gehan["p"]).toBeLessThan(0.001);
      // Number-at-risk table: 6 time points, both groups start with all 21 at risk.
      const atrisk = (r["extra"] as { atrisk: { times: number[]; rows: { label: string; atRisk: number[] }[] } }).atrisk;
      expect(atrisk.times).toHaveLength(6);
      expect(atrisk.rows).toHaveLength(2);
      expect(atrisk.rows[0]!.atRisk[0]).toBe(21);
      expect(atrisk.rows[1]!.atRisk[0]).toBe(21);
    } finally {
      await s.stop();
    }
  }, 20_000);

  it("survival: log-rank test for trend across 3 ordered dose groups", async () => {
    const s = sup();
    try {
      // Increasing hazard with dose → a significant monotone trend.
      const r = await s.request("survival", {
        groups: [
          { label: "Low", time: [12, 14, 16, 9, 20, 18, 22, 25], event: new Array(8).fill(1) },
          { label: "Mid", time: [8, 10, 7, 12, 9, 11, 14, 6], event: new Array(8).fill(1) },
          { label: "High", time: [3, 5, 4, 6, 2, 7, 5, 4], event: new Array(8).fill(1) },
        ],
      });
      const byTerm = Object.fromEntries((r["terms"] as Array<Record<string, number | string>>).map((t) => [t["term"], t]));
      const trend = byTerm["Log-rank for trend"] as Record<string, number>;
      expect(trend).toBeTruthy();
      expect(trend["df"]).toBe(1);
      expect(trend["p"]).toBeLessThan(0.001); // clear dose-ordered trend
      // no hazard ratio for >2 groups; the omnibus log-rank is still reported.
      expect(byTerm["Hazard ratio"]).toBeUndefined();
      expect((r["glance"] as Record<string, number>)["chi_sq"]).toBeGreaterThan(0);
    } finally {
      await s.stop();
    }
  }, 20_000);

  it("survival: pairwise log-rank comparisons of ≥3 curves with a multiplicity correction", async () => {
    const s = sup();
    try {
      const groups = [
        { label: "Low", time: [12, 14, 16, 9, 20, 18, 22, 25], event: new Array(8).fill(1) },
        { label: "Mid", time: [8, 10, 7, 12, 9, 11, 14, 6], event: new Array(8).fill(1) },
        { label: "High", time: [3, 5, 4, 6, 2, 7, 5, 4], event: new Array(8).fill(1) },
      ];
      const rows = (r: Record<string, unknown>) =>
        Object.fromEntries((r["terms"] as Array<Record<string, number | string>>).map((t) => [t["term"], t]));
      // Holm-Šídák (default). Three curves → three pairwise log-rank rows.
      const hs = await s.request("survival", { groups, pairwise: true, pairwiseMethod: "holm-sidak" });
      const bh = rows(hs);
      for (const term of ["Low vs Mid (log-rank)", "Low vs High (log-rank)", "Mid vs High (log-rank)"]) {
        expect(bh[term]).toBeTruthy();
        expect((bh[term] as Record<string, number>)["df"]).toBe(1);
        expect((bh[term] as Record<string, number>)["statistic"]).toBeGreaterThan(0);
      }
      expect((hs["glance"] as Record<string, number | string>)["pairwise_comparisons"]).toBe(3);
      // Bonferroni adjusts each raw p by ×3, so its p ≥ the raw (uncorrected) p.
      const raw = rows(await s.request("survival", { groups, pairwise: true, pairwiseMethod: "none" }));
      const bon = rows(await s.request("survival", { groups, pairwise: true, pairwiseMethod: "bonferroni" }));
      const pRaw = (raw["Low vs High (log-rank)"] as Record<string, number>)["p"]!;
      const pBon = (bon["Low vs High (log-rank)"] as Record<string, number>)["p"]!;
      expect(pBon).toBeCloseTo(Math.min(1, pRaw * 3), 5);
      // Two groups → no pairwise rows even when requested; default (no flag) → none.
      const two = await s.request("survival", { groups: groups.slice(0, 2), pairwise: true });
      expect((two["terms"] as Array<{ term: string }>).some((t) => t.term.includes("(log-rank)"))).toBe(false);
      const def = await s.request("survival", { groups });
      expect((def["terms"] as Array<{ term: string }>).some((t) => t.term.includes("(log-rank)"))).toBe(false);
    } finally {
      await s.stop();
    }
  }, 25_000);

  it("twoway: balanced 2×2 ANOVA SS partition + F/p match hand-calc", async () => {
    const s = sup();
    try {
      // cells[A][B], n=2: A0=[[1,2],[3,4]], A1=[[5,6],[7,8]].
      // Hand: SS_A 32, SS_B 8, SS_AB 0, SS_resid 2 (Σ=42); F_A 64, F_B 16.
      const g = (await s.request("twoway", { cells: [[[1, 2], [3, 4]], [[5, 6], [7, 8]]] }))["glance"] as Record<string, number>;
      expect(g["ss_a"]).toBeCloseTo(32, 6);
      expect(g["ss_b"]).toBeCloseTo(8, 6);
      expect(g["ss_ab"]).toBeCloseTo(0, 6);
      expect(g["ss_resid"]).toBeCloseTo(2, 6);
      expect(g["F_a"]).toBeCloseTo(64, 5);
      expect(g["F_b"]).toBeCloseTo(16, 5);
      expect(g["p_a"]).toBeCloseTo(0.00132, 4);
      expect(g["df_resid"]).toBe(4);
      expect(g["n_per_cell"]).toBe(2);
    } finally {
      await s.stop();
    }
  }, 20_000);

  it("twoway post-hoc: opt-in multiple comparisons on the pooled MS_residual (absent by default)", async () => {
    const s = sup();
    try {
      const cells = [[[1, 2], [3, 4]], [[5, 6], [7, 8]]]; // row0 mean 2.5, row1 mean 6.5
      // Without `posthoc`: just the 4-row ANOVA table, no comparison rows.
      const base = (await s.request("twoway", { cells }))["terms"] as { term: string }[];
      expect(base.some((t) => / vs /.test(t.term))).toBe(false);
      expect(base).toHaveLength(4);
      // Row-means Šídák → one comparison (2 rows → 1 pair); estimate = 2.5 − 6.5.
      const ph = (await s.request("twoway", { cells, rowLabels: ["R0", "R1"], posthoc: "sidak", compare: "rowmeans" }))["terms"] as { term: string; estimate: number; p: number }[];
      const cmp = ph.find((t) => t.term === "R0 vs R1")!;
      expect(cmp).toBeDefined();
      expect(cmp.estimate).toBeCloseTo(-4, 6);
      expect(cmp.p).toBeGreaterThan(0);
      expect(cmp.p).toBeLessThan(0.01); // strongly significant (t=8, df=4); exact p validated in crosscheck.py
      // Cell-means family on 4 cells → C(4,2) = 6 comparison rows.
      const cm = (await s.request("twoway", { cells, posthoc: "tukey", compare: "cellmeans" }))["terms"] as { term: string }[];
      expect(cm.filter((t) => / vs /.test(t.term))).toHaveLength(6);
    } finally {
      await s.stop();
    }
  }, 20_000);

  it("multifactor: N-way factorial ANOVA (Type II) — 2-factor equals two-way, 3-way recovers effects", async () => {
    const s = sup();
    try {
      const by = (r: Record<string, unknown>, t: string) =>
        (r["terms"] as Array<Record<string, unknown>>).find((z) => z["term"] === t) as Record<string, number>;
      // The same balanced 2×2 as the two-way test above → Type II SS must match it exactly
      // (SS_A 32, SS_B 8, SS_AB 0, F_A 64) — cross-validates against the from-scratch two-way.
      const mf2 = await s.request("multifactor", {
        value: [1, 2, 3, 4, 5, 6, 7, 8],
        factors: [["A0", "A0", "A0", "A0", "A1", "A1", "A1", "A1"], ["B0", "B0", "B1", "B1", "B0", "B0", "B1", "B1"]],
        factorLabels: ["Diet", "Time"],
      });
      expect(mf2["title"]).toBe("2-way ANOVA");
      expect(by(mf2, "Diet").estimate).toBeCloseTo(32, 6);
      expect(by(mf2, "Time").estimate).toBeCloseTo(8, 6);
      expect(by(mf2, "Diet × Time").estimate).toBeCloseTo(0, 6);
      expect(by(mf2, "Diet").statistic).toBeCloseTo(64, 5);
      // Residual arrays surface (feeds the residual-diagnostic graphs, like the other ANOVAs).
      expect((mf2["extra"] as { residuals: { resid: number[] } }).residuals.resid).toHaveLength(8);

      // 3-way additive design: all three main effects strong, every interaction ≈ 0.
      const val: number[] = [], f0: string[] = [], f1: string[] = [], f2: string[] = [];
      for (const A of ["a1", "a2"]) for (const B of ["b1", "b2"]) for (const C of ["c1", "c2"]) {
        const base = (A === "a2" ? 3 : 0) + (B === "b2" ? 2 : 0) + (C === "c2" ? 1 : 0);
        for (const r of [0.1, -0.1, 0.0]) { val.push(base + r); f0.push(A); f1.push(B); f2.push(C); }
      }
      const mf3 = await s.request("multifactor", { value: val, factors: [f0, f1, f2], factorLabels: ["Diet", "Sex", "Strain"] });
      expect(mf3["title"]).toBe("3-way ANOVA");
      expect(by(mf3, "Diet").p!).toBeLessThan(0.001);
      expect(by(mf3, "Sex").p!).toBeLessThan(0.001);
      expect(by(mf3, "Diet × Sex × Strain").p!).toBeGreaterThan(0.5); // additive → no 3-way interaction
      expect((mf3["glance"] as Record<string, number>)["factors"]).toBe(3);

      // Unbalanced (one fewer observation) still fits via Type II SS.
      const u = await s.request("multifactor", {
        value: [1, 2, 3, 4, 5, 6, 7],
        factors: [["A0", "A0", "A0", "A0", "A1", "A1", "A1"], ["B0", "B0", "B1", "B1", "B0", "B0", "B1"]],
        factorLabels: ["A", "B"],
      });
      expect((u["glance"] as Record<string, number>)["n"]).toBe(7);
      // Guards: ≥ 2 factors, and each factor ≥ 2 levels.
      await expect(s.request("multifactor", { value: [1, 2, 3], factors: [["a", "b", "a"]] })).rejects.toThrow();
    } finally {
      await s.stop();
    }
  }, 25_000);

  it("mixedmodel: REML variance components == balanced one-way random-effects closed form", async () => {
    const s = sup();
    try {
      const vals: Record<string, number[]> = {
        g0: [9, 11, 10, 12, 8, 10], g1: [13, 12, 14, 11, 13, 15], g2: [7, 8, 6, 9, 7, 8], g3: [11, 10, 12, 11, 13, 9],
      };
      const value: number[] = [], group: string[] = [];
      for (const k of Object.keys(vals)) for (const v of vals[k]!) { value.push(v); group.push(k); }
      const r = await s.request("mixedmodel", { value, group, groupLabel: "Batch" });
      const gl = r["glance"] as Record<string, number>;
      // Closed-form (balanced one-way random effects): σ²_res = MSW, σ²_grp = (MSB−MSW)/n.
      const G = 4, n = 6;
      const gmean = value.reduce((a, b) => a + b, 0) / value.length;
      const gmeans: Record<string, number> = {};
      for (const [k, vv] of Object.entries(vals)) gmeans[k] = vv.reduce((a, b) => a + b, 0) / vv.length;
      const msb = (n * Object.keys(vals).reduce((acc, k) => acc + (gmeans[k]! - gmean) ** 2, 0)) / (G - 1);
      const msw = Object.entries(vals).reduce((acc, [k, vv]) => acc + vv.reduce((a, v) => a + (v - gmeans[k]!) ** 2, 0), 0) / (G * (n - 1));
      expect(gl["resid_var"]).toBeCloseTo(msw, 3);
      expect(gl["group_var"]).toBeCloseTo((msb - msw) / n, 3);
      expect(gl["icc"]).toBeCloseTo(((msb - msw) / n) / ((msb - msw) / n + msw), 3);
      expect(gl["groups"]).toBe(4);
      expect(r["title"]).toBe("Mixed-effects model (REML)");
      // ML variant switches the title (for likelihood-ratio model comparison).
      const ml = await s.request("mixedmodel", { value, group, reml: false });
      expect(ml["title"]).toBe("Mixed-effects model (ML)");
      // Guard: the random grouping factor needs ≥ 2 groups.
      await expect(s.request("mixedmodel", { value: [1, 2, 3], group: ["a", "a", "a"] })).rejects.toThrow();
    } finally {
      await s.stop();
    }
  }, 25_000);

  it("contingency: χ²/df/p + Cramér's V + Fisher (2×2) match hand-calc", async () => {
    const s = sup();
    try {
      // [[20,30],[30,20]]: expected all 25 → χ² = Σ(5²/25) = 4.0, df 1, V = √(4/100) = 0.2.
      const g = (await s.request("contingency", { table: [[20, 30], [30, 20]] }))["glance"] as Record<string, number>;
      expect(g["chi_sq"]).toBeCloseTo(4.0, 6);
      expect(g["df"]).toBe(1);
      expect(g["p"]).toBeCloseTo(0.0455, 4);
      expect(g["cramers_v"]).toBeCloseTo(0.2, 6);
      expect(g["odds_ratio"]).toBeCloseTo(0.4444, 3); // (20·20)/(30·30)
      expect(g["fisher_p"]).toBeCloseTo(0.0713, 3);
      // 2×3 → χ² = 20, df 2; no Fisher (only 2×2).
      const g3 = (await s.request("contingency", { table: [[10, 20, 30], [30, 20, 10]] }))["glance"] as Record<string, number>;
      expect(g3["chi_sq"]).toBeCloseTo(20.0, 6);
      expect(g3["df"]).toBe(2);
      expect(g3["fisher_p"]).toBeUndefined();
      // Fisher-Freeman-Halton exact (the r×c generalisation of Fisher's exact).
      const gf = (await s.request("contingency", { table: [[4, 1, 2], [1, 3, 5]] }))["glance"] as Record<string, number>;
      expect(gf["ffh_p"]).toBeCloseTo(0.23514, 5);
      const gf3 = (await s.request("contingency", { table: [[3, 1, 2], [1, 4, 1], [2, 0, 3]] }))["glance"] as Record<string, number>;
      expect(gf3["ffh_p"]).toBeCloseTo(0.248126, 5);
      // blank/empty grid rows are dropped so χ² stays defined.
      const gz = (await s.request("contingency", { table: [[0, 0], [20, 30], [0, 0], [30, 20]] }))["glance"] as Record<string, number>;
      expect(gz["chi_sq"]).toBeCloseTo(4.0, 6);
    } finally {
      await s.stop();
    }
  }, 20_000);

  it("contingency clinical 2×2 toolkit: RR/OR + CI, sens/spec/PPV/NPV, Yates (match statsmodels)", async () => {
    const s = sup();
    type Row = { term: string; estimate?: number; statistic?: number; p?: number; ciLow?: number; ciHigh?: number };
    try {
      // [[20,10],[5,25]] — RR/OR + log CIs (Katz/Woolf) verified against statsmodels Table2x2.
      const t = (await s.request("contingency", { table: [[20, 10], [5, 25]], conf: 0.95, ciMethod: "log" }))["terms"] as Row[];
      const by = Object.fromEntries(t.map((r) => [r.term, r]));
      expect(by["Relative risk"]!.estimate).toBeCloseTo(4.0, 4);
      expect(by["Relative risk"]!.ciLow).toBeCloseTo(1.728213, 4); // Katz log CI
      expect(by["Relative risk"]!.ciHigh).toBeCloseTo(9.258118, 4);
      expect(by["Odds ratio"]!.estimate).toBeCloseTo(10.0, 4);
      expect(by["Odds ratio"]!.ciLow).toBeCloseTo(2.940525, 4);
      expect(by["Odds ratio"]!.ciHigh).toBeCloseTo(34.007538, 3);
      expect(by["Sensitivity"]!.estimate).toBeCloseTo(0.8, 4); // 20/(20+5)
      expect(by["Specificity"]!.estimate).toBeCloseTo(0.714286, 4); // 25/(10+25)
      expect(by["PPV"]!.estimate).toBeCloseTo(0.666667, 4); // 20/(20+10)
      expect(by["NPV"]!.estimate).toBeCloseTo(0.833333, 4); // 25/(5+25)
      expect(by["Yates-corrected χ²"]!.statistic).toBeCloseTo(13.44, 2);
    } finally {
      await s.stop();
    }
  }, 20_000);

  it("contingency 2×2 score CIs (default): Koopman RR + Newcombe risk-difference", async () => {
    const s = sup();
    type Row = { term: string; estimate?: number; ciLow?: number; ciHigh?: number };
    try {
      // Default (no ciMethod) → score-based CIs. [[20,10],[5,25]]: RR=4, risk diff=0.5.
      const t = (await s.request("contingency", { table: [[20, 10], [5, 25]], conf: 0.95 }))["terms"] as Row[];
      const by = Object.fromEntries(t.map((r) => [r.term, r]));
      // Koopman asymptotic-score CI for RR (vs the Katz log 1.7282/9.2581 above).
      expect(by["Relative risk"]!.estimate).toBeCloseTo(4.0, 4);
      expect(by["Relative risk"]!.ciLow).toBeCloseTo(1.865337, 3);
      expect(by["Relative risk"]!.ciHigh).toBeCloseTo(9.369877, 3);
      // Newcombe hybrid-score CI for the risk difference (matches statsmodels 'newcomb').
      expect(by["Risk difference"]!.estimate).toBeCloseTo(0.5, 4);
      expect(by["Risk difference"]!.ciLow).toBeCloseTo(0.253938, 4);
      expect(by["Risk difference"]!.ciHigh).toBeCloseTo(0.669098, 4);
      // Baptista-Pike exact conditional CI for the odds ratio (vs the Woolf 2.9405/34.0075 above).
      expect(by["Odds ratio"]!.estimate).toBeCloseTo(10.0, 4);
      expect(by["Odds ratio"]!.ciLow).toBeCloseTo(2.6483, 2);
      expect(by["Odds ratio"]!.ciHigh).toBeCloseTo(33.6682, 1);
      // The score RR interval brackets the estimate and differs from the log interval.
      expect(by["Relative risk"]!.ciLow!).toBeGreaterThan(1.728213);
      // Baptista-Pike matches R's ORCI::BPexact.CI on [[2,12],[1,10]] → [0.1127829, 53.0112493].
      const ref = Object.fromEntries(((await s.request("contingency", { table: [[2, 12], [1, 10]] }))["terms"] as Row[]).map((r) => [r.term, r]));
      expect(ref["Odds ratio"]!.ciLow).toBeCloseTo(0.1127829, 5);
      expect(ref["Odds ratio"]!.ciHigh).toBeCloseTo(53.0112493, 3);
    } finally {
      await s.stop();
    }
  }, 20_000);

  it("contingency McNemar (paired) + Cochran-Armitage trend match references", async () => {
    const s = sup();
    type Row = { term: string; estimate?: number; statistic?: number; p?: number };
    try {
      // McNemar [[30,12],[5,40]] — χ² 2.117647 (statsmodels), exact binomial 0.143463.
      const mp = (await s.request("contingency", { table: [[30, 12], [5, 40]], variant: "paired" }))["terms"] as Row[];
      const m = Object.fromEntries(mp.map((r) => [r.term, r]));
      expect(m["McNemar χ² (Yates)"]!.statistic).toBeCloseTo(2.117647, 4);
      expect(m["McNemar χ² (Yates)"]!.p).toBeCloseTo(0.14561, 4);
      expect(m["Exact (binomial)"]!.p).toBeCloseTo(0.143463, 4);
      // Cochran-Armitage trend across an ordered 2×4 table (classic N-variance form).
      const ct = (await s.request("contingency", { table: [[10, 15, 20, 25], [40, 35, 30, 25]] }))["terms"] as Row[];
      const ca = Object.fromEntries(ct.map((r) => [r.term, r])) as Record<string, Row>;
      expect(ca["Cochran-Armitage trend"]!.statistic).toBeCloseTo(3.314968, 4);
      expect(ca["Cochran-Armitage trend"]!.p).toBeCloseTo(0.000917, 5);
    } finally {
      await s.stop();
    }
  }, 20_000);

  it("goodnessoffit: χ² + exact binomial match scipy.chisquare / binomtest", async () => {
    const s = sup();
    try {
      // [30,50,20] vs uniform (expected 100/3 each): χ² = Σ(O−E)²/E.
      const r = await s.request("goodnessoffit", { observed: [30, 50, 20], labels: ["Alpha", "Beta", "Gamma"] });
      const g = r["glance"] as Record<string, number>;
      expect(g["chi_sq"]).toBeCloseTo(14.0, 4);   // scipy.chisquare([30,50,20]) = 14.0
      expect(g["df"]).toBe(2);
      expect(g["p"]).toBeCloseTo(0.000912, 5);
      // per-category breakdown carries observed + expected.
      const terms = r["terms"] as Array<Record<string, number | string>>;
      const beta = terms.find((t) => t.term === "Beta")!;
      expect(beta.observed).toBe(50);
      expect(beta.expected).toBeCloseTo(33.3333, 3);
      // two categories → exact binomial test added (binomtest(8,20,0.5) = 0.503445).
      const r2 = await s.request("goodnessoffit", { observed: [8, 12] });
      expect((r2["glance"] as Record<string, number>)["binom_p"]).toBeCloseTo(0.503445, 5);
      // expected proportions honoured: a perfect fit gives χ² = 0.
      const r3 = await s.request("goodnessoffit", { observed: [40, 30, 20, 10], expected: [0.4, 0.3, 0.2, 0.1] });
      expect((r3["glance"] as Record<string, number>)["chi_sq"]).toBeCloseTo(0, 9);
      await expect(s.request("goodnessoffit", { observed: [5] })).rejects.toThrow();
    } finally {
      await s.stop();
    }
  }, 20_000);

  it("nested: hierarchical SS partition + nested F match an independent derivation", async () => {
    const s = sup();
    try {
      // 2 groups × 3 subgroups × 4 reps; subgroup base = groupBase + 0.5·si, reps [-1,0,1,2].
      const groups = [10, 16].map((gb) => ({
        label: `G${gb}`,
        subgroups: [0, 1, 2].map((si) => [-1, 0, 1, 2].map((v) => gb + 0.5 * si + v)),
      }));
      const r = await s.request("nested", { groups });
      const terms = r["terms"] as Array<Record<string, number | string>>;
      const by = (t: string) => terms.find((x) => x.term === t)! as Record<string, number>;
      // Independent pandas-groupby derivation: SS_groups=216, SS_subs=4, SS_within=30 (sum=250).
      expect(by("Groups").estimate).toBeCloseTo(216, 4);
      expect(by("Subgroups within groups").estimate).toBeCloseTo(4, 4);
      expect(by("Residual (within subgroups)").estimate).toBeCloseTo(30, 4);
      // Nested F = MS_groups/MS_subgroups = (216/1)/(4/4) = 216 (not against the within MS).
      const g = r["glance"] as Record<string, number>;
      expect(g["f_groups"]).toBeCloseTo(216, 3);
      expect(g["df_groups"]).toBe(1);
      expect(g["df_subgroups"]).toBe(4);
      expect(g["df_within"]).toBe(18);
      // two groups → a signed nested t = ±√F.
      expect(Math.abs(g["t"]!)).toBeCloseTo(Math.sqrt(216), 3);
      await expect(s.request("nested", { groups: [groups[0]!] })).rejects.toThrow(); // need ≥2 groups
    } finally {
      await s.stop();
    }
  }, 20_000);

  it("roc: AUC (Mann-Whitney) + sensitivity/specificity match hand-calc", async () => {
    const s = sup();
    try {
      // scores [.1,.4,.35,.8] / labels [0,0,1,1] → AUC 0.75 (3 of 4 pos>neg pairs).
      const g = (await s.request("roc", { scores: [0.1, 0.4, 0.35, 0.8], labels: [0, 0, 1, 1] }))["glance"] as Record<string, number>;
      expect(g["auc"]).toBeCloseTo(0.75, 6);
      expect(g["n_pos"]).toBe(2);
      expect(g["n_neg"]).toBe(2);
      expect(g["cutoff"]).toBeCloseTo(0.35, 6);
      expect(g["sensitivity"]).toBeCloseTo(1.0, 6);
      expect(g["specificity"]).toBeCloseTo(0.5, 6);
      // perfect separation → AUC 1.0.
      const perfect = (await s.request("roc", { scores: [1, 2, 3, 4, 5, 6], labels: [0, 0, 0, 1, 1, 1] }))["glance"] as Record<string, number>;
      expect(perfect["auc"]).toBeCloseTo(1.0, 6);
      // DeLong comparison of two correlated ROC curves (same subjects, two markers).
      const cmp = (await s.request("roc", {
        scores: [0.1, 0.3, 0.2, 0.6, 0.4, 0.5, 0.7, 0.8, 0.65, 0.9],
        scores2: [0.2, 0.1, 0.5, 0.3, 0.55, 0.45, 0.6, 0.5, 0.7, 0.85],
        labels: [0, 0, 0, 0, 0, 1, 1, 1, 1, 1],
      }))["glance"] as Record<string, number>;
      expect(cmp["auc1"]).toBeCloseTo(0.96, 6);
      expect(cmp["auc2"]).toBeCloseTo(0.86, 6);
      expect(cmp["auc_diff"]).toBeCloseTo(0.1, 6);
      expect(cmp["se_diff"]).toBeCloseTo(0.126491, 5);
      expect(cmp["z"]).toBeCloseTo(0.790569, 5);
      expect(cmp["p"]).toBeCloseTo(0.429195, 5);
      // The Confidence level sets the level of the AUC CI. On an
      // overlapping dataset (AUC < 1) the CI widens as conf rises; se/auc are unchanged.
      const at = async (conf: number) =>
        (await s.request("roc", { scores: [1, 2, 3, 4, 5, 6, 7, 8], labels: [0, 0, 1, 0, 1, 0, 1, 1], conf }))["glance"] as Record<string, number>;
      const [c90, c95, c99] = [await at(0.9), await at(0.95), await at(0.99)];
      expect(c95["auc"]).toBeCloseTo(c90["auc"]!, 6); // point estimate independent of conf
      expect(c90["ci_low"]).toBeGreaterThan(c95["ci_low"]!);
      expect(c95["ci_low"]).toBeGreaterThan(c99["ci_low"]!);
    } finally {
      await s.stop();
    }
  }, 20_000);

  it("roc: extra.roc ships the curve points (anchored 0,0→1,1) + a per-cutoff table for plotting", async () => {
    const s = sup();
    type Cut = { cutoff: number; sensitivity: number; specificity: number; sensLow: number; sensHigh: number; specLow: number; specHigh: number };
    type Roc = { points: { fpr: number; tpr: number }[]; cutoffs: Cut[]; auc: number };
    try {
      const res = await s.request("roc", { scores: [1, 2, 3, 4, 5, 6, 7, 8], labels: [0, 0, 0, 0, 1, 1, 1, 1] });
      const roc = (res["extra"] as { roc: Roc }).roc;
      expect(roc.auc).toBeCloseTo(1.0, 6);
      // curve is anchored at (0,0) and (1,1) and monotonic non-decreasing in both coords.
      expect(roc.points[0]).toEqual({ fpr: 0, tpr: 0 });
      expect(roc.points[roc.points.length - 1]).toEqual({ fpr: 1, tpr: 1 });
      for (let i = 1; i < roc.points.length; i++) {
        expect(roc.points[i]!.fpr).toBeGreaterThanOrEqual(roc.points[i - 1]!.fpr);
        expect(roc.points[i]!.tpr).toBeGreaterThanOrEqual(roc.points[i - 1]!.tpr);
      }
      // per-cutoff table: one row per unique score, each with sens+spec in [0,1] and a Wilson CI.
      expect(roc.cutoffs).toHaveLength(8);
      for (const c of roc.cutoffs) {
        expect(c.sensitivity).toBeGreaterThanOrEqual(0);
        expect(c.sensitivity).toBeLessThanOrEqual(1);
        expect(c.specificity).toBeGreaterThanOrEqual(0);
        expect(c.specificity).toBeLessThanOrEqual(1);
        // Wilson CI brackets the point estimate and stays within [0,1].
        expect(c.sensLow).toBeLessThanOrEqual(c.sensitivity + 1e-9);
        expect(c.sensHigh).toBeGreaterThanOrEqual(c.sensitivity - 1e-9);
        expect(c.sensLow).toBeGreaterThanOrEqual(0);
        expect(c.sensHigh).toBeLessThanOrEqual(1);
        expect(c.specLow).toBeLessThanOrEqual(c.specificity + 1e-9);
        expect(c.specHigh).toBeGreaterThanOrEqual(c.specificity - 1e-9);
      }
    } finally {
      await s.stop();
    }
  }, 20_000);

  it("regression: OLS slope/intercept/R²", async () => {
    const s = sup();
    try {
      const g = (await s.request("regression", { x: [1, 2, 3, 4, 5], y: [2.1, 3.9, 6.1, 8.0, 9.9] }))["glance"] as Record<string, number>;
      expect(g["slope"]).toBeCloseTo(1.97, 2);
      expect(g["intercept"]).toBeCloseTo(0.09, 2);
      expect(g["r_sq"]).toBeCloseTo(0.9992, 3);
    } finally {
      await s.stop();
    }
  }, 20_000);

  it("regression: full OLS report — intercept CI, Sy.x, F(1,df), X-intercept, 1/slope (vs statsmodels)", async () => {
    const s = sup();
    try {
      const r = await s.request("regression", { x: [1, 2, 3, 4, 5, 6, 7, 8], y: [2.1, 3.9, 6.2, 7.8, 10.1, 11.7, 14.2, 15.9] });
      const terms = r["terms"] as Array<Record<string, unknown>>;
      const by = (t: string) => terms.find((x) => x["term"] === t) as Record<string, number>;
      // The intercept carries a 95% CI — matches sm.OLS.conf_int.
      expect(by("Intercept").estimate).toBeCloseTo(0.046429, 4);
      expect(by("Intercept").ciLow).toBeCloseTo(-0.336123, 4);
      expect(by("Intercept").ciHigh).toBeCloseTo(0.42898, 4);
      expect(by("Sy.x (RMSE)").estimate).toBeCloseTo(0.200644, 5);
      expect(by("F (1, 6)").estimate).toBeCloseTo(4118.6215, 1); // = slope-t², matches sm F
      expect(by("X-intercept").estimate).toBeCloseTo(-0.023367, 4); // −intercept/slope
      expect(by("1/slope").estimate).toBeCloseTo(0.503295, 4);
      // Adjustable CI level: a 90% slope CI is narrower than the default 95%.
      const r90 = await s.request("regression", { x: [1, 2, 3, 4, 5, 6, 7, 8], y: [2.1, 3.9, 6.2, 7.8, 10.1, 11.7, 14.2, 15.9], conf: 0.9 });
      const slope95 = by("Slope"); const slope90 = (r90["terms"] as Array<Record<string, unknown>>).find((x) => x["term"] === "Slope") as Record<string, number>;
      expect(slope90.ciHigh! - slope90.ciLow!).toBeLessThan(slope95.ciHigh! - slope95.ciLow!);
    } finally {
      await s.stop();
    }
  }, 20_000);

  it("regression: WLS weighting + force-through-a-point + replicates lack-of-fit (vs statsmodels / hand-computed)", async () => {
    const s = sup();
    try {
      const x = [1, 2, 3, 4, 5, 6, 7, 8];
      const y = [2.1, 3.9, 6.2, 7.8, 10.1, 12.2, 13.8, 16.3];
      const by = (r: Record<string, unknown>, t: string) =>
        (r["terms"] as Array<Record<string, unknown>>).find((z) => z["term"] === t) as Record<string, number>;

      // (a) 1/Y² weighted least squares — matches sm.WLS(weights=1/y²) exactly.
      const wls = await s.request("regression", { x, y, weighting: "1/Y2" });
      expect(wls["title"]).toBe("Linear regression (weighted)");
      expect(by(wls, "Slope").estimate).toBeCloseTo(1.986166, 5);
      expect(by(wls, "Slope").se).toBeCloseTo(0.030273, 5);
      expect(by(wls, "Intercept").estimate).toBeCloseTo(0.081904, 5);

      // (b) Force the line through (2, 3.9): slope-only fit; intercept = y0 − slope·x0.
      const tp = await s.request("regression", { x, y, throughPoint: { x: 2, y: 3.9 } });
      expect(tp["title"]).toBe("Linear regression (through a fixed point)");
      const sl = by(tp, "Slope").estimate;
      expect(sl).toBeCloseTo(2.03913, 4);
      expect(by(tp, "Slope").se).toBeCloseTo(0.021552, 4);
      // intercept = y0 − slope·x0 = 3.9 − 2.03913·2.
      expect(by(tp, "Intercept").estimate).toBeCloseTo(-0.178261, 5);

      // (c) Replicates lack-of-fit F (Draper & Smith) — hand-computed on paired X.
      const lof = await s.request("regression", { x: [1, 1, 2, 2, 3, 3, 4, 4, 5, 5], y: [1.0, 1.2, 2.1, 1.9, 3.2, 3.4, 5.1, 4.8, 8.0, 7.6] });
      const lofTerm = by(lof, "Lack of fit (replicates)");
      expect(lofTerm.estimate).toBeCloseTo(24.60811, 3);
      expect(lofTerm.p).toBeCloseTo(0.00202, 4);
      expect(lofTerm.df).toBe(3); // df_lof = (#X levels) − 2
      expect(lofTerm.ciLow).toBe(5); // df_pe = n − (#X levels), carried in ciLow
      // No replicates → the lack-of-fit test is undefined and omitted.
      const noRep = await s.request("regression", { x: [1, 2, 3, 4, 5], y: [1, 2, 3, 4, 6] });
      expect((noRep["terms"] as Array<Record<string, unknown>>).some((z) => z["term"] === "Lack of fit (replicates)")).toBe(false);

      // (d) Without weights or a fixed point, the fit is plain OLS (slope matches scipy).
      const ols = await s.request("regression", { x, y });
      expect(ols["title"]).toBe("Linear regression");
      expect(by(ols, "Slope").estimate).toBeCloseTo(2.014286, 5);
    } finally {
      await s.stop();
    }
  }, 20_000);

  it("multipleregression: OLS coefficients/R²/F + VIF + listwise drop", async () => {
    const s = sup();
    try {
      // y = 1 + 2·x1 − 3·x2 exactly (no noise) → coefficients recovered, R² = 1.
      const x1 = [1, 2, 3, 4, 5, 6, 7, 8];
      const x2 = [2, 1, 3, 5, 4, 6, 8, 7];
      const y = x1.map((a, i) => 1 + 2 * a - 3 * x2[i]!);
      const r = await s.request("multipleregression", {
        y, predictors: [x1, x2], labels: ["x1", "x2"], outcomeLabel: "Y", conf: 0.95,
      });
      const terms = r["terms"] as Array<Record<string, number | string>>;
      const by = (t: string) => terms.find((x) => x.term === t)!;
      expect(by("Intercept").estimate).toBeCloseTo(1, 6);
      expect(by("x1").estimate).toBeCloseTo(2, 6);
      expect(by("x2").estimate).toBeCloseTo(-3, 6);
      // VIF present for ≥2 predictors and finite (these two are only mildly collinear).
      expect(by("x1").vif).toBeGreaterThan(1);
      const g = r["glance"] as Record<string, number>;
      expect(g["r_sq"]).toBeCloseTo(1, 9);
      expect(g["n"]).toBe(8);
      expect(g["k"]).toBe(2);
      // Residuals (fitted + resid) flow to the diagnostic-plot pipeline; ~0 here.
      const resid = (r["extra"] as { residuals: { fitted: number[]; resid: number[] } }).residuals;
      expect(resid.resid).toHaveLength(8);
      expect(resid.resid.every((v) => Math.abs(v) < 1e-6)).toBe(true);

      // Listwise deletion: a blank in any chosen cell drops that whole row (n falls to 7).
      const y2 = [...y]; y2[3] = null as unknown as number;
      const r2 = await s.request("multipleregression", { y: y2, predictors: [x1, x2], labels: ["x1", "x2"] });
      expect((r2["glance"] as Record<string, number>)["n"]).toBe(7);

      // A constant predictor is a typed bad_request (singular design).
      await expect(s.request("multipleregression", { y, predictors: [x1.map(() => 5)], labels: ["c"] }))
        .rejects.toThrow();
    } finally {
      await s.stop();
    }
  }, 20_000);

  it("multipleregression: matches statsmodels OLS on a noisy 3-predictor fit", async () => {
    const s = sup();
    try {
      // Fixed (deterministic) design + response; reference values from statsmodels OLS.
      const x1 = [0.1, 0.4, 0.35, 0.8, 0.55, 0.2, 0.9, 0.6, 0.3, 0.75];
      const x2 = [1.0, 0.2, 0.7, 0.3, 0.9, 0.5, 0.1, 0.65, 0.45, 0.85];
      const x3 = [5, 3, 8, 2, 6, 4, 9, 7, 1, 10];
      const y = [2.3, 1.1, 3.4, 0.9, 3.0, 1.8, 1.2, 2.9, 0.6, 4.1];
      const r = await s.request("multipleregression", {
        y, predictors: [x1, x2, x3], labels: ["x1", "x2", "x3"],
      });
      const terms = r["terms"] as Array<Record<string, number | string>>;
      const by = (t: string) => terms.find((x) => x.term === t)!;
      // Reference: statsmodels sm.OLS(y, add_constant([x1,x2,x3])).fit()
      expect(by("Intercept").estimate).toBeCloseTo(-0.499713, 4);
      expect(by("x1").estimate).toBeCloseTo(0.189903, 4);
      expect(by("x2").estimate).toBeCloseTo(2.364642, 4);
      expect(by("x3").estimate).toBeCloseTo(0.218125, 4);
      const g = r["glance"] as Record<string, number>;
      expect(g["r_sq"]).toBeCloseTo(0.883866, 4);
      expect(g["adj_r_sq"]).toBeCloseTo(0.825799, 4);
    } finally {
      await s.stop();
    }
  }, 20_000);

  it("logistic: Logit coefficients/odds ratios/pseudo-R²/accuracy match statsmodels", async () => {
    const s = sup();
    try {
      // Fixed, well-conditioned (non-separable) 60-row binary dataset; references
      // from statsmodels sm.Logit(y, add_constant([x1,x2])).fit().
      const x1 = [2.1, -0.34, -0.58, -3.18, -0.01, -0.38, -0.64, 0.38, 0.51, -1.28, -1.06, -0.57, 0.83, 0.67, -1.57, -1.34, 0.88, 1.89, -0.04, -0.82, 1.31, -0.37, 0.87, 1.86, 0.76, 0.09, 0.88, -0.77, -0.21, -0.69, -0.25, -0.58, -0.22, -0.46, 0.11, 0.08, 0.36, 1.68, -1.86, 1.55, -0.28, -1.48, -0.21, 0.11, 1.28, -1.27, 0.26, 0.14, -2.02, -1.42, 0.72, 0.83, 1.31, 0.64, 0.47, 0.15, 1.45, -1.01, -0.17, 0.46];
      const x2 = [-1.89, 1.57, -0.95, -0.09, 2.59, -1.0, -0.64, 1.87, -1.3, -0.52, 0.62, 0.55, 0.71, 0.44, 1.61, 1.22, 0.71, -0.82, -0.86, -2.29, 0.82, -2.19, 1.05, 2.22, -1.27, -0.82, -0.57, 1.0, -1.04, -0.16, -0.63, -0.3, 1.55, -1.16, 0.09, 0.33, 1.03, -1.52, 1.34, 0.52, 1.05, 0.09, -1.97, -0.78, 0.98, 0.04, -0.06, 2.15, 2.64, -0.04, 2.32, -2.39, -2.46, 1.04, -0.31, 0.69, 0.62, -0.11, 0.82, 0.18];
      const y = [1, 1, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 1, 1, 0, 0, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 0, 1, 0, 0, 0, 0, 1, 1, 0, 1, 1, 1, 0, 1, 1];
      const r = await s.request("logistic", { y, predictors: [x1, x2], labels: ["x1", "x2"], outcomeLabel: "event" });
      const terms = r["terms"] as Array<Record<string, number | string>>;
      const by = (t: string) => terms.find((x) => x.term === t)!;
      expect(by("Intercept").estimate).toBeCloseTo(0.3845, 3);
      expect(by("x1").estimate).toBeCloseTo(0.65677, 3);
      expect(by("x2").estimate).toBeCloseTo(-0.52755, 3);
      expect(by("x1").oddsRatio).toBeCloseTo(1.92855, 3);
      // OR CI brackets the OR; an x1 unit raises the odds (OR > 1, CI low > 0).
      expect(by("x1").orLow as number).toBeLessThan(by("x1").oddsRatio as number);
      expect(by("x1").orHigh as number).toBeGreaterThan(by("x1").oddsRatio as number);
      expect(by("McFadden R²").estimate).toBeCloseTo(0.1351, 3);
      expect(by("Nagelkerke R²").estimate).toBeCloseTo(0.22642, 3);
      expect(by("Accuracy (p≥0.5)").estimate).toBeCloseTo(0.75, 4);
      const g = r["glance"] as Record<string, number>;
      expect(g["n"]).toBe(60);

      // Non-binary outcome → typed bad_request; perfectly separable → typed error.
      await expect(s.request("logistic", { y: [0, 1, 2, 0, 1, 2], predictors: [[1, 2, 3, 4, 5, 6]], labels: ["a"] }))
        .rejects.toThrow();
      await expect(s.request("logistic", {
        y: [0, 0, 0, 1, 1, 1], predictors: [[1, 2, 3, 7, 8, 9]], labels: ["sep"],
      })).rejects.toThrow();
    } finally {
      await s.stop();
    }
  }, 20_000);

  it("poisson: GLM log-rate coefficients + rate ratios match statsmodels", async () => {
    const s = sup();
    try {
      // Fixed counts; references from sm.GLM(y, add_constant(x), family=Poisson()).fit().
      const r = await s.request("poisson", { y: [2, 3, 5, 8, 10, 15, 20, 30], predictors: [[1, 2, 3, 4, 5, 6, 7, 8]], labels: ["dose"], outcomeLabel: "count" });
      const terms = r["terms"] as Array<Record<string, number | string>>;
      const by = (t: string) => terms.find((x) => x.term === t)!;
      expect(by("dose").estimate).toBeCloseTo(0.364105, 4); // log-rate slope
      expect(by("dose").rateRatio).toBeCloseTo(1.439225, 4); // exp(β) rate ratio
      expect((by("dose").rrLow as number)).toBeLessThan(by("dose").rateRatio as number);
      expect((by("dose").rrHigh as number)).toBeGreaterThan(by("dose").rateRatio as number);
      expect(by("Intercept").estimate).toBeCloseTo(0.488766, 4);
      expect(by("LR χ² (model)").estimate as number).toBeCloseTo(53.3435, 2);
      expect(by("McFadden R²").estimate).toBeCloseTo(0.62418, 3);
      // Dispersion (Pearson χ²/df) + deviance.
      const g = r["glance"] as Record<string, number>;
      expect(g["dispersion"]).toBeCloseTo(0.049169, 4); // Pearson χ²/df (well-fit → < 1)
      expect(g["deviance"]).toBeCloseTo(0.293174, 4);
      // A non-integer / negative outcome → typed bad_request.
      await expect(s.request("poisson", { y: [1.5, 2, 3, 4], predictors: [[1, 2, 3, 4]], labels: ["x"] })).rejects.toThrow();
    } finally {
      await s.stop();
    }
  }, 20_000);

  it("deming: errors-in-variables slope/intercept match scipy.odr at λ=1 (orthogonal)", async () => {
    const s = sup();
    try {
      // λ=1 Deming == orthogonal regression; references from scipy.odr on this data.
      const x = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const y = [1.1, 2.3, 2.9, 4.2, 5.1, 5.8, 7.3, 7.9, 9.2, 10.1];
      const r = await s.request("deming", { x, y });
      const terms = r["terms"] as Array<Record<string, number | string>>;
      const by = (t: string) => terms.find((x) => x.term === t)!;
      expect(by("Slope").estimate).toBeCloseTo(0.99738, 4);
      expect(by("Intercept").estimate).toBeCloseTo(0.104409, 4);
      // Jackknife CI brackets the slope and (here) includes 1 → methods agree.
      expect(by("Slope").ciLow as number).toBeLessThan(1);
      expect(by("Slope").ciHigh as number).toBeGreaterThan(1);
      const g = r["glance"] as Record<string, number>;
      expect(g["lambda"]).toBe(1);
      expect(g["n"]).toBe(10);
      // The error-variance ratio λ (set from the UI) shifts the slope.
      const r4 = await s.request("deming", { x, y, lambda: 4 });
      const g4 = r4["glance"] as Record<string, number>;
      const slope4 = (r4["terms"] as Array<Record<string, number | string>>).find((t) => t.term === "Slope")!.estimate as number;
      expect(g4["lambda"]).toBe(4);
      expect(slope4).not.toBeCloseTo(by("Slope").estimate as number, 4); // λ genuinely changes the fit
      await expect(s.request("deming", { x, y, lambda: 0 })).rejects.toThrow(); // λ must be > 0
      await expect(s.request("deming", { x: [1, 2], y: [1, 2] })).rejects.toThrow(); // < 3 points
    } finally {
      await s.stop();
    }
  }, 20_000);

  it("auc: trapezoidal integration + custom baseline + min-peak-height filter", async () => {
    const s = sup();
    try {
      // A curve with two peaks above y=0: a small bump (height 3) and a tall one (height 5).
      const x = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const y = [0, 1, 3, 1, 0, 0, 2, 5, 2, 0, 0];
      const zero = (await s.request("auc", { x, y, baseline: "zero" }))["glance"] as Record<string, number>;
      expect(zero["baseline"]).toBe(0);
      expect(zero["peaks"]).toBe(2);
      expect(zero["net"]).toBeCloseTo(14, 6); // trapezoidal area above y=0
      // A custom numeric baseline (set from the UI) shifts area + baseline.
      const cust = (await s.request("auc", { x, y, baseline: 1.5 }))["glance"] as Record<string, number>;
      expect(cust["baseline"]).toBe(1.5);
      expect(cust["peak_area"]).toBeLessThan(zero["peak_area"]!);
      // Min-peak-height filter drops the short peak (3 < 0.7·5) → one peak remains.
      const filt = (await s.request("auc", { x, y, baseline: "zero", minPeakFraction: 0.7 }))["glance"] as Record<string, number>;
      expect(filt["peaks"]).toBe(1);
    } finally {
      await s.stop();
    }
  }, 20_000);

  it("blandaltman: bias + limits of agreement + CIs match closed-form", async () => {
    const s = sup();
    type Row = { term: string; estimate?: number; ciLow?: number; ciHigh?: number };
    try {
      const A = [1.0, 2.1, 3.0, 4.2, 5.1, 6.0, 7.3, 8.1, 9.0, 10.2];
      const B = [1.1, 2.0, 3.3, 4.0, 5.4, 5.8, 7.0, 8.4, 9.1, 10.0];
      const t = (await s.request("blandaltman", { x: A, y: B, conf: 0.95 }))["terms"] as Row[];
      const by = Object.fromEntries(t.map((r) => [r.term, r]));
      expect(by["Bias (mean difference)"]!.estimate).toBeCloseTo(-0.01, 5);
      expect(by["SD of differences"]!.estimate).toBeCloseTo(0.237814, 4);
      expect(by["Upper limit of agreement"]!.estimate).toBeCloseTo(0.456116, 4); // bias + 1.96·SD
      expect(by["Lower limit of agreement"]!.estimate).toBeCloseTo(-0.476116, 4);
      expect(by["Bias (mean difference)"]!.ciHigh).toBeCloseTo(0.160116, 4); // t_{9}·SE
      expect(by["Upper limit of agreement"]!.ciHigh).toBeCloseTo(0.757301, 4);
      // extra carries the paired points for the spawned Bland-Altman plot.
      const ex = ((await s.request("blandaltman", { x: A, y: B }))["extra"] as { blandaltman: { pairs: number[][] } }).blandaltman;
      expect(ex.pairs).toHaveLength(10);
      // Percent variant + the < 2-pairs guard.
      const g = (await s.request("blandaltman", { x: A, y: B, percent: true }))["glance"] as Record<string, number>;
      expect(g["bias"]).toBeCloseTo(-1.0181, 3);
      await expect(s.request("blandaltman", { x: [1], y: [1] })).rejects.toThrow();
    } finally {
      await s.stop();
    }
  }, 20_000);

  it("passingbablok: robust regression — exact on a line, resists an outlier", async () => {
    const s = sup();
    type Row = { term: string; estimate?: number; ciLow?: number; ciHigh?: number };
    try {
      // Exact line y = 2x + 3 → every pairwise slope is 2; PB recovers (2, 3), CI collapses.
      const x = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
      const y = x.map((v) => 2 * v + 3);
      const t = (await s.request("passingbablok", { x, y }))["terms"] as Row[];
      const by = Object.fromEntries(t.map((r) => [r.term, r]));
      expect(by["Slope"]!.estimate).toBeCloseTo(2, 6);
      expect(by["Intercept"]!.estimate).toBeCloseTo(3, 6);
      expect(by["Slope"]!.ciLow).toBeCloseTo(2, 6);
      expect(by["Slope"]!.ciHigh).toBeCloseTo(2, 6);
      // Robust: an aberrant point barely moves the PB slope (OLS would swing ~0.4).
      const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const ys = [1.1, 2.0, 2.9, 4.2, 5.1, 5.8, 7.3, 7.9, 9.2, 10.1];
      const clean = ((await s.request("passingbablok", { x: xs, y: ys }))["glance"] as Record<string, number>)["slope"]!;
      const withOut = ((await s.request("passingbablok", { x: [...xs, 11], y: [...ys, 2.0] }))["glance"] as Record<string, number>)["slope"]!;
      expect(Math.abs(withOut - clean)).toBeLessThan(0.1);
      await expect(s.request("passingbablok", { x: [1, 2], y: [1, 2] })).rejects.toThrow(); // < 3 points
    } finally {
      await s.stop();
    }
  }, 20_000);

  it("pca: SVD eigenvalues / % variance / loadings match sklearn (standardized)", async () => {
    const s = sup();
    try {
      // v2 ≈ 2·v1 (highly correlated) so PC1 dominates; v3 is near-independent.
      const v1 = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 2.5, 5.5];
      const v2 = [2.1, 3.9, 6.2, 7.8, 10.1, 12.0, 13.9, 16.1, 5.0, 11.2];
      const v3 = [5.0, 3.0, 6.0, 2.0, 7.0, 1.0, 8.0, 4.0, 9.0, 3.5];
      const r = await s.request("pca", { columns: [v1, v2, v3], labels: ["v1", "v2", "v3"], standardize: true });
      const ex = (r["extra"] as { pca: { eigenvalues: number[]; explained: number[]; loadings: number[][]; scores: number[][] } }).pca;
      // % variance explained matches sklearn PCA.explained_variance_ratio_ exactly.
      expect(ex.explained[0]).toBeCloseTo(0.673346, 5);
      expect(ex.explained[1]).toBeCloseTo(0.326516, 5);
      expect(ex.explained[2]).toBeCloseTo(0.000138, 5);
      // Correlation-matrix PCA: eigenvalues sum to the variable count (p = 3).
      expect(ex.eigenvalues.reduce((a, b) => a + b, 0)).toBeCloseTo(3, 6);
      expect(ex.eigenvalues[0]).toBeCloseTo(2.020038, 4);
      // Shapes: loadings = vars × PCs, scores = cases × PCs.
      expect(ex.loadings).toHaveLength(3);
      expect(ex.loadings[0]).toHaveLength(3);
      expect(ex.scores).toHaveLength(10);
      // PC1 loads v1 and v2 together (same sign, large) — they co-vary.
      expect(Math.sign(ex.loadings[0]![0]!)).toBe(Math.sign(ex.loadings[1]![0]!));
      const g = r["glance"] as Record<string, number>;
      expect(g["variables"]).toBe(3);
      expect(g["cases"]).toBe(10);
      expect(g["pc1_pct"]).toBeCloseTo(67.3346, 3);

      // < 2 variables and a constant variable are typed bad_requests.
      await expect(s.request("pca", { columns: [v1], labels: ["v1"] })).rejects.toThrow();
      await expect(s.request("pca", { columns: [v1, v1.map(() => 4)], labels: ["v1", "c"] })).rejects.toThrow();

      // Without `groups`: no groups key on the payload.
      expect("groups" in ex).toBe(false);
    } finally {
      await s.stop();
    }
  }, 20_000);

  /**
   * Ordination. A gradient community: each species peaks at its own position along one
   * gradient, so the sites have a real order to recover. A random matrix would let a
   * broken ordination pass — there would be nothing to get wrong.
   */
  function gradientColumns(nSites: number, nSpecies: number, width = 0.02): number[][] {
    const cols: number[][] = [];
    for (let j = 0; j < nSpecies; j++) {
      const peak = j / (nSpecies - 1);
      cols.push(Array.from({ length: nSites }, (_, i) => {
        const pos = i / (nSites - 1);
        return Math.round(30 * Math.exp(-((pos - peak) ** 2) / width));
      }));
    }
    return cols;
  }

  it("pcoa: maps a Bray-Curtis distance matrix, recovers the gradient, and reports the negative eigenvalues", async () => {
    const s = sup();
    try {
      // Note: width 0.08. With narrower niches (0.02) the species turn over completely between
      // the ends, and a PCoA of that arches — the textbook horseshoe, where the extreme sites
      // fold back and axis 1 no longer orders them (Spearman −0.92, not −1). That is the
      // method behaving correctly, so the ordering claim is made on a gradient it can hold.
      const cols = gradientColumns(12, 6, 0.08);
      const labels = ["Sp1", "Sp2", "Sp3", "Sp4", "Sp5", "Sp6"];
      const r = await s.request("pcoa", { columns: cols, labels, metric: "braycurtis" });
      const ex = (r["extra"] as { ordination: { scores: number[][]; eigenvalues: number[]; explained: number[]; pcLabels: string[]; correction: string; speciesScores: number[][] } }).ordination;
      expect(ex.scores).toHaveLength(12);
      expect(ex.pcLabels[0]).toBe("PCoA1");
      // The sites lie on a gradient, so axis 1 must order them — that is the whole claim.
      const axis1 = ex.scores.map((row) => row[0]!);
      const rank = [...axis1.keys()].sort((a, b) => axis1[a]! - axis1[b]!);
      const forward = rank.every((v, i) => v === i);
      const backward = rank.every((v, i) => v === 11 - i);
      expect(forward || backward, "PCoA1 did not recover the site order").toBe(true);
      // Explained fractions descend and sum to 1 over the positive axes.
      expect(ex.explained[0]!).toBeGreaterThan(ex.explained[1]!);
      expect(ex.explained.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
      // Bray-Curtis is not Euclidean-embeddable → the count is reported, not hidden…
      const g = r["glance"] as Record<string, number>;
      expect(g["negativeEigenvalues"]).toBeGreaterThan(0);
      expect(ex.correction).toBe("none");
      // …and a correction removes them.
      const fixed = await s.request("pcoa", { columns: cols, labels, metric: "braycurtis", correction: "lingoes" });
      expect((fixed["glance"] as Record<string, number>)["negativeEigenvalues"]).toBe(0);
      // Species are placed by weighted averaging — one point per species, not a loading.
      expect(ex.speciesScores).toHaveLength(6);
      // Identity: on Euclidean distances a PCoA is a covariance PCA (see crosscheck.py).
      const eu = await s.request("pcoa", { columns: cols, labels, metric: "euclidean" });
      const pca = await s.request("pca", { columns: cols, labels, standardize: false, componentSelection: "all" });
      const a1 = (eu["extra"] as { ordination: { scores: number[][] } }).ordination.scores.map((r2) => r2[0]!);
      const p1 = (pca["extra"] as { pca: { scores: number[][] } }).pca.scores.map((r2) => r2[0]!);
      const diff = Math.min(
        Math.max(...a1.map((v, i) => Math.abs(v - p1[i]!))),
        Math.max(...a1.map((v, i) => Math.abs(v + p1[i]!))),
      );
      expect(diff).toBeLessThan(1e-5);
      // Fewer than 2 variables is a typed bad_request.
      await expect(s.request("pcoa", { columns: [cols[0]!], labels: ["Sp1"] })).rejects.toThrow();
    } finally {
      await s.stop();
    }
  }, 30_000);

  it("rda: what the explanatory variables explain, tested by permutation, with LC and WA both returned", async () => {
    const s = sup();
    try {
      // Species genuinely driven by two environmental variables, plus one that is noise.
      const n = 24;
      const e1 = Array.from({ length: n }, (_, i) => Math.sin(i * 1.7) * 2);
      const e2 = Array.from({ length: n }, (_, i) => Math.cos(i * 0.9) * 2);
      const jitter = (i: number) => ((i * 37) % 11) / 20 - 0.25;
      const cols = [
        e1.map((v, i) => 3 * v + jitter(i)),
        e1.map((v, i) => 2.5 * v + jitter(i + 3)),
        e1.map((v, i) => -2 * v + jitter(i + 7)),
        e2.map((v, i) => 2 * v + jitter(i + 1)),
        Array.from({ length: n }, (_, i) => jitter(i * 5)),
      ];
      const labels = ["S1", "S2", "S3", "S4", "S5"];
      const r = await s.request("rda", {
        columns: cols, labels, explanatory: [e1, e2], explanatoryLabels: ["Temp", "pH"],
        permutations: 199, seed: 7,
      });
      const ex = (r["extra"] as { ordination: { lcScores: number[][]; waScores: number[][]; envScores: number[][]; envLabels: string[]; constrained: number; totalVariance: number; unconstrainedEigenvalues: number[]; r2: number; adjR2: number; p: number; siteScores: string; speciesScores: number[][] } }).ordination;
      // The partition closes: what the constraints explain plus what they do not is the
      // whole variance. A constrained ordination that does not close is not a decomposition.
      expect(ex.constrained + ex.unconstrainedEigenvalues.reduce((a2, b2) => a2 + b2, 0)).toBeCloseTo(ex.totalVariance, 4);
      expect(ex.r2).toBeGreaterThan(0.8);
      expect(ex.adjR2, "adjusted R² must be below the raw one").toBeLessThan(ex.r2);
      expect(ex.p).toBeLessThanOrEqual(0.05);

      // LC and WA are two different placements of the same cases, and both are returned so
      // the graph can offer the choice the literature argues about.
      expect(ex.lcScores).toHaveLength(n);
      expect(ex.waScores).toHaveLength(n);
      expect(ex.lcScores).not.toEqual(ex.waScores);
      expect(ex.siteScores).toBe("lc");
      // …on shared axes, so they must track each other closely
      const lc1 = ex.lcScores.map((row) => row[0]!);
      const wa1 = ex.waScores.map((row) => row[0]!);
      const mean = (a2: number[]) => a2.reduce((x, y) => x + y, 0) / a2.length;
      const corr = (a2: number[], b2: number[]) => {
        const ma = mean(a2); const mb = mean(b2);
        const num = a2.reduce((acc, v, i) => acc + (v - ma) * (b2[i]! - mb), 0);
        const da = Math.sqrt(a2.reduce((acc, v) => acc + (v - ma) ** 2, 0));
        const db = Math.sqrt(b2.reduce((acc, v) => acc + (v - mb) ** 2, 0));
        return num / (da * db);
      };
      expect(Math.abs(corr(lc1, wa1))).toBeGreaterThan(0.9);

      // The environment arrows exist, one per explanatory column, and are correlations.
      expect(ex.envLabels).toEqual(["Temp", "pH"]);
      expect(ex.envScores).toHaveLength(2);
      for (const row of ex.envScores) for (const v of row) expect(Math.abs(v)).toBeLessThanOrEqual(1.0001);
      // Species keep their place in the picture too.
      expect(ex.speciesScores).toHaveLength(5);

      // A term that drives the response is significant; an uninformative term is not.
      const terms = (r["terms"] as { term: string; p?: number }[]);
      expect(terms[0]!.term).toBe("Constrained (model)");
      expect(terms.find((t) => t.term === "Temp")!.p).toBeLessThanOrEqual(0.05);
      const unrelated = Array.from({ length: n }, (_, i) => ((i * 13) % 7) - 3);
      const r2 = await s.request("rda", {
        columns: cols, labels, explanatory: [e1, unrelated], explanatoryLabels: ["Temp", "unrelated"],
        permutations: 199, seed: 5,
      });
      expect((r2["terms"] as { term: string; p?: number }[]).find((t) => t.term === "unrelated")!.p).toBeGreaterThan(0.05);

      // A categorical explanatory column is expanded to indicator columns rather than refused.
      const arm = Array.from({ length: n }, (_, i) => (i % 3 === 0 ? "wet" : i % 3 === 1 ? "dry" : "mid"));
      const r3 = await s.request("rda", { columns: cols, labels, explanatory: [arm], explanatoryLabels: ["Habitat"], permutations: 99, seed: 2 });
      const e3 = (r3["extra"] as { ordination: { envLabels: string[] } }).ordination;
      expect(e3.envLabels, "a 3-level factor becomes 2 indicator columns").toEqual(["Habitat: dry", "Habitat: mid"]);

      // Refusals, out loud.
      await expect(s.request("rda", { columns: cols, labels, permutations: 99 })).rejects.toThrow();
      await expect(s.request("rda", { columns: cols, labels, explanatory: [new Array(n).fill(4)], explanatoryLabels: ["k"], permutations: 99 })).rejects.toThrow();
    } finally {
      await s.stop();
    }
  }, 60_000);

  it("cca + dbrda: the two other constrained ordinations, each holding its own identity", async () => {
    const s = sup();
    try {
      // ── db-RDA: the identity is the test. On Euclidean distances, distance-based RDA is
      //    redundancy analysis — the principal coordinates of a Euclidean distance matrix are
      //    the centred data rotated, and everything RDA reports is rotation-invariant. Any
      //    slip in the centring, the axis selection or the permutation breaks the equality.
      const n = 24;
      const e1 = Array.from({ length: n }, (_, i) => Math.sin(i * 1.7) * 2);
      const e2 = Array.from({ length: n }, (_, i) => Math.cos(i * 0.9) * 2);
      const jitter = (i: number) => ((i * 37) % 11) / 20 - 0.25;
      // Non-negative, because db-RDA's own distances and its weighted-average variable
      // positions are defined for abundances.
      const cols = [
        e1.map((v, i) => 3 * v + jitter(i) + 8),
        e1.map((v, i) => 2.5 * v + jitter(i + 3) + 8),
        e1.map((v, i) => -2 * v + jitter(i + 7) + 8),
        e2.map((v, i) => 2 * v + jitter(i + 1) + 8),
        Array.from({ length: n }, (_, i) => jitter(i * 5) + 8),
      ];
      const labels = ["S1", "S2", "S3", "S4", "S5"];
      const shared = { columns: cols, labels, explanatory: [e1, e2], explanatoryLabels: ["Temp", "pH"], permutations: 199, seed: 7 };
      type Ord = { constrained: number; totalVariance: number; unconstrainedEigenvalues: number[]; eigenvalues: number[]; r2: number; adjR2: number; pseudoF: number; p: number; siteScores: string; lcScores: number[][]; waScores: number[][]; envLabels: string[]; envScores: number[][]; speciesScores?: number[][]; negativeEigenvalues?: number; metric?: string; rowMasses?: number[] };
      const ordOf = (r: Record<string, unknown>): Ord => (r["extra"] as { ordination: Ord }).ordination;

      const ref = ordOf(await s.request("rda", shared));
      const euc = ordOf(await s.request("dbrda", { ...shared, metric: "euclidean" }));
      for (const key of ["r2", "adjR2", "pseudoF", "p", "totalVariance", "constrained"] as const) {
        expect(euc[key], `db-RDA on Euclidean distances must BE an RDA — ${key} differs`).toBeCloseTo(ref[key], 9);
      }
      expect(euc.eigenvalues.length).toBe(ref.eigenvalues.length);
      euc.eigenvalues.forEach((v, i) => expect(v).toBeCloseTo(ref.eigenvalues[i]!, 9));

      // ── …and on Bray-Curtis, the distance the method exists for, it is a different answer
      //    that still closes, still reports what it had to drop, and still finds the effect.
      const bray = ordOf(await s.request("dbrda", { ...shared, metric: "bray" }));
      expect(bray.metric).toBe("braycurtis");
      expect(bray.r2, "a different geometry must give a different answer, or the metric is being ignored").not.toBeCloseTo(ref.r2, 6);
      expect(bray.constrained + bray.unconstrainedEigenvalues.reduce((a, b) => a + b, 0)).toBeCloseTo(bray.totalVariance, 3);
      expect(bray.p).toBeLessThanOrEqual(0.05);
      expect(bray.adjR2).toBeLessThan(bray.r2);
      // The variables are positions (weighted averages), so the default drawn placement is WA.
      expect(bray.siteScores).toBe("wa");
      expect(bray.speciesScores).toHaveLength(5);

      // ── CCA: the identity is against CA. Constrain a CCA by CA's own first axis and the
      //    fitted space is exactly that axis, so the constrained inertia must come back as
      //    CA's first eigenvalue. An unweighted fit — the classic mistake — misses it.
      const counts = [
        [12, 8, 3, 0, 0, 0, 1, 5, 9, 14, 11, 6, 2, 0, 0, 0, 3, 7, 10, 13, 9, 4, 1, 0],
        [2, 6, 11, 14, 9, 4, 0, 0, 1, 3, 7, 12, 15, 10, 5, 1, 0, 0, 2, 4, 8, 13, 11, 6],
        [0, 0, 1, 4, 9, 13, 15, 10, 6, 2, 0, 0, 1, 5, 11, 14, 12, 7, 3, 1, 0, 0, 2, 8],
        [5, 4, 6, 5, 4, 6, 5, 6, 4, 5, 6, 4, 5, 6, 4, 5, 6, 4, 5, 6, 4, 5, 6, 4],
      ];
      const clab = ["Sp1", "Sp2", "Sp3", "Sp4"];
      const caRes = await s.request("ca", { columns: counts, labels: clab });
      const caOrd = (caRes["extra"] as { ordination: { eigenvalues: number[]; scores: number[][]; totalInertia: number } }).ordination;
      const axis1 = caOrd.scores.map((row) => row[0]!);
      const ident = ordOf(await s.request("cca", {
        columns: counts, labels: clab, explanatory: [axis1], explanatoryLabels: ["CA1"], permutations: 99, seed: 3,
      }));
      expect(ident.eigenvalues[0], "CCA constrained by CA's own axis 1 must recover CA's eigenvalue 1")
        .toBeCloseTo(caOrd.eigenvalues[0]!, 6);
      expect(ident.totalVariance).toBeCloseTo(caOrd.totalInertia, 6);

      // …and a real CCA on a gradient: it closes, it detects the driver, and the masses are real.
      const grad = Array.from({ length: n }, (_, i) => i / 4 - 3);
      const unrelated = Array.from({ length: n }, (_, i) => ((i * 13) % 7) - 3);
      const ccaRes = await s.request("cca", {
        columns: counts, labels: clab, explanatory: [grad, unrelated], explanatoryLabels: ["Gradient", "unrelated"],
        permutations: 199, seed: 5,
      });
      const cc = ordOf(ccaRes);
      expect(cc.constrained + cc.unconstrainedEigenvalues.reduce((a, b) => a + b, 0)).toBeCloseTo(cc.totalVariance, 3);
      expect(cc.adjR2).toBeLessThan(cc.r2);
      expect(cc.rowMasses!.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
      expect(cc.siteScores).toBe("wa");
      expect(cc.lcScores).not.toEqual(cc.waScores);
      expect(cc.envLabels).toEqual(["Gradient", "unrelated"]);
      const terms = ccaRes["terms"] as { term: string; p?: number }[];
      expect(terms[0]!.term).toBe("Constrained (model)");
      expect(terms.find((t) => t.term === "unrelated")!.p).toBeGreaterThan(0.05);

      // Refusals, out loud — both methods, both kinds.
      await expect(s.request("cca", { columns: counts, labels: clab, permutations: 99 })).rejects.toThrow();
      await expect(s.request("dbrda", { columns: cols, labels, permutations: 99 })).rejects.toThrow();
      await expect(s.request("cca", {
        columns: [[1, -2, 3, 4], [2, 1, 1, 5]], labels: ["a", "b"],
        explanatory: [[1, 2, 3, 4]], explanatoryLabels: ["g"], permutations: 99,
      }), "negative counts have no chi-square profile").rejects.toThrow();
    } finally {
      await s.stop();
    }
  }, 90_000);

  it("varpart: the fractions are a partition, the shared one has no test, and a negative one is reported", async () => {
    const s = sup();
    try {
      // A fixture where the answer is known by construction: block A drives the response, B is
      // built to overlap A (so a big shared fraction must appear), C is uninformative. A fixture with
      // independent blocks could not exhibit the thing this method exists to show.
      const n = 30;
      const a1 = Array.from({ length: n }, (_, i) => Math.sin(i * 1.1) * 2);
      const a2 = Array.from({ length: n }, (_, i) => Math.cos(i * 0.7) * 2);
      const jitter = (i: number) => ((i * 29) % 13) / 20 - 0.3;
      const b1 = a1.map((v, i) => 0.8 * v + jitter(i + 2));   // overlaps A on purpose
      const b2 = Array.from({ length: n }, (_, i) => jitter(i * 3));
      const c1 = Array.from({ length: n }, (_, i) => jitter(i * 7 + 1));  // uninformative
      const cols = [
        a1.map((v, i) => 3 * v + jitter(i)),
        a2.map((v, i) => -2 * v + jitter(i + 5)),
        b2.map((v, i) => 2 * v + jitter(i + 9)),
      ];
      const labels = ["S1", "S2", "S3"];
      type VP = {
        blockLabels: string[];
        blocks: { label: string; adjR2: number; columns: number }[];
        fractions: { label: string; adjR2: number; testable: boolean; p?: number }[];
        explained: number; residual: number;
      };
      const vpOf = (r: Record<string, unknown>): VP => (r["extra"] as { varpart: VP }).varpart;

      const two = await s.request("varpart", {
        columns: cols, labels,
        explanatory: [a1, a2], explanatoryLabels: ["T", "P"],
        explanatory2: [b1, b2], explanatoryLabels2: ["pH", "N"],
        blockLabels: ["Climate", "Soil"], permutations: 199, seed: 4,
      });
      const vp = vpOf(two);
      expect(vp.fractions.map((f) => f.label)).toEqual(["[a] Climate alone", "[b] shared", "[c] Soil alone"]);

      // It is a partition: every fraction plus what nothing explains is the whole.
      const sum = vp.fractions.reduce((t, f) => t + f.adjR2, 0) + vp.residual;
      expect(sum, "the fractions and the residual must sum to 1 — otherwise it is not a partition").toBeCloseTo(1, 5);
      expect(vp.residual).toBeCloseTo(1 - vp.explained, 6);

      // Identity against a validated method: the total explained is an RDA's adjusted R² on the
      // two blocks joined.
      const joined = await s.request("rda", {
        columns: cols, labels, explanatory: [a1, a2, b1, b2],
        explanatoryLabels: ["T", "P", "pH", "N"], permutations: 99, seed: 4,
      });
      expect(vp.explained).toBeCloseTo(
        (joined["extra"] as { ordination: { adjR2: number } }).ordination.adjR2, 6);

      // Only the unique fractions carry a p. A shared fraction is a difference between two
      // models, not the fit of one — there is nothing to permute, and any p reported for it
      // would be invented.
      const byLabel = Object.fromEntries(vp.fractions.map((f) => [f.label, f]));
      expect(byLabel["[a] Climate alone"]!.testable).toBe(true);
      expect(byLabel["[a] Climate alone"]!.p).toBeLessThanOrEqual(0.05);
      expect(byLabel["[b] shared"]!.testable).toBe(false);
      expect(byLabel["[b] shared"]!.p, "a shared fraction must not carry a p-value").toBeUndefined();
      // …and the blocks really do overlap, or this fixture proves nothing about sharing.
      expect(byLabel["[b] shared"]!.adjR2).toBeGreaterThan(0.2);

      // Each block's own total is what a single-block RDA reports.
      const solo = await s.request("rda", {
        columns: cols, labels, explanatory: [a1, a2], explanatoryLabels: ["T", "P"], permutations: 99, seed: 4,
      });
      expect(vp.blocks.find((b) => b.label === "Climate")!.adjR2).toBeCloseTo(
        (solo["extra"] as { ordination: { adjR2: number } }).ordination.adjR2, 6);

      // ── Three blocks: seven fractions, the uninformative block at nothing, negatives reported ──
      const three = await s.request("varpart", {
        columns: cols, labels,
        explanatory: [a1, a2], explanatoryLabels: ["T", "P"],
        explanatory2: [b1, b2], explanatoryLabels2: ["pH", "N"],
        explanatory3: [c1], explanatoryLabels3: ["X"],
        blockLabels: ["Climate", "Soil", "Space"], permutations: 199, seed: 4,
      });
      const vp3 = vpOf(three);
      expect(vp3.fractions).toHaveLength(7);
      const sum3 = vp3.fractions.reduce((t, f) => t + f.adjR2, 0) + vp3.residual;
      expect(sum3).toBeCloseTo(1, 5);
      const by3 = Object.fromEntries(vp3.fractions.map((f) => [f.label, f]));
      expect(Math.abs(by3["[c] Space alone"]!.adjR2), "an uninformative block must explain ~nothing uniquely").toBeLessThan(0.05);
      expect(by3["[c] Space alone"]!.p).toBeGreaterThan(0.05);
      // A negative fraction is a real result and must be reported, not clamped: clamping it
      // would silently break the sum above.
      expect(Math.min(...vp3.fractions.map((f) => f.adjR2))).toBeLessThan(0);
      expect((three["glance"] as Record<string, number>)["negativeFractions"]).toBeGreaterThan(0);

      // Refusals, out loud.
      await expect(s.request("varpart", {
        columns: cols, labels, explanatory: [a1], explanatoryLabels: ["T"], permutations: 99,
      }), "one block is not a partition").rejects.toThrow();
      await expect(s.request("varpart", {
        columns: cols, labels,
        explanatory: [new Array(n).fill(4)], explanatoryLabels: ["k"],
        explanatory2: [b1], explanatoryLabels2: ["pH"], permutations: 99,
      }), "a constant block explains nothing and must be refused, not silently counted as zero").rejects.toThrow();
    } finally {
      await s.stop();
    }
  }, 90_000);

  it("ca: sites and species on one set of axes, and the arch it is famous for", async () => {
    const s = sup();
    try {
      const cols = gradientColumns(10, 6, 0.08);
      const labels = Array.from({ length: 6 }, (_, j) => `Sp${j + 1}`);
      const r = await s.request("ca", { columns: cols, labels });
      const ex = (r["extra"] as { ordination: { scores: number[][]; speciesScores: number[][]; eigenvalues: number[]; explained: number[]; pcLabels: string[]; totalInertia: number; scaling: string } }).ordination;
      expect(ex.scores).toHaveLength(10);
      // The point of the method: the species are in the same picture, one point each.
      expect(ex.speciesScores).toHaveLength(6);
      expect(ex.pcLabels[0]).toBe("CA1");
      // CA1 orders the sites along the gradient…
      const a1 = ex.scores.map((row) => row[0]!);
      const rank = [...a1.keys()].sort((p, q) => a1[p]! - a1[q]!);
      expect(rank.every((v, i) => v === i) || rank.every((v, i) => v === 9 - i)).toBe(true);
      // …and the species are ordered the same way, which is what "a site sits near the
      // species it is rich in" means. Both families must therefore share the axis.
      const sp1 = ex.speciesScores.map((row) => row[0]!);
      const spRank = [...sp1.keys()].sort((p, q) => sp1[p]! - sp1[q]!);
      expect(spRank.every((v, i) => v === i) || spRank.every((v, i) => v === 5 - i)).toBe(true);
      // …and they must run the same way. Each family ordered correctly but mirrored against
      // the other is the joint plot's one fatal defect: every site would then sit beside the
      // species it has least of. (Flipping one family's axis sign alone passes every
      // per-family check and fails only here.)
      expect(Math.sign(a1[a1.length - 1]! - a1[0]!), "the species run opposite to the sites")
        .toBe(Math.sign(sp1[sp1.length - 1]! - sp1[0]!));
      // The inertia adds up and descends.
      expect(ex.eigenvalues.reduce((x, y) => x + y, 0)).toBeCloseTo(ex.totalInertia, 5);
      expect(ex.explained[0]!).toBeGreaterThan(ex.explained[1]!);
      const g = r["glance"] as Record<string, number>;
      expect(g["inertia"]).toBeCloseTo(ex.totalInertia, 6);

      // Scaling changes the size of the picture, not its shape: the site coordinates scale
      // by sqrt(eigenvalue) between symmetric and sites — a control that changed nothing
      // would read as a choice that does not exist.
      const sites = await s.request("ca", { columns: cols, labels, scaling: "sites" });
      const sa1 = (sites["extra"] as { ordination: { scores: number[][] } }).ordination.scores.map((row) => row[0]!);
      expect(sa1[0]).not.toBeCloseTo(a1[0]!, 6);
      expect(Math.abs(sa1[0]! / a1[0]!)).toBeCloseTo(Math.sqrt(ex.eigenvalues[0]!) ** 0.5, 3);

      // Refusals, out loud: negative values, an empty case, an unknown scaling.
      await expect(s.request("ca", { columns: cols.map((c, j) => (j === 0 ? c.map((v) => -v) : c)), labels })).rejects.toThrow();
      await expect(s.request("ca", { columns: [[1, 0], [2, 0]], labels: ["a", "b"] })).rejects.toThrow();
      await expect(s.request("ca", { columns: cols, labels, scaling: "sideways" })).rejects.toThrow();
    } finally {
      await s.stop();
    }
  }, 30_000);

  it("nmds: stress, the Shepard diagram, reproducibility, and the transformations", async () => {
    const s = sup();
    try {
      const cols = gradientColumns(14, 8);
      const labels = Array.from({ length: 8 }, (_, j) => `Sp${j + 1}`);
      const spec = { columns: cols, labels, metric: "braycurtis", tries: 10, seed: 77 };
      const r = await s.request("nmds", spec);
      const ex = (r["extra"] as { ordination: { scores: number[][]; stress: number; shepard: { dissimilarity: number[]; distance: number[]; fitted: number[] }; pcLabels: string[]; nonMetricR2: number } }).ordination;
      expect(ex.scores).toHaveLength(14);
      expect(ex.scores[0]).toHaveLength(2);
      expect(ex.pcLabels).toEqual(["NMDS1", "NMDS2"]);
      // A gradient in 2-D is an easy fit: stress must be in the "good" band, or the map is misleading.
      expect(ex.stress).toBeLessThan(0.1);
      expect(ex.nonMetricR2).toBeCloseTo(1 - ex.stress ** 2, 5);
      // The Shepard diagram carries every pair, and its fitted values never decrease.
      const pairs = (14 * 13) / 2;
      expect(ex.shepard.dissimilarity).toHaveLength(pairs);
      expect(ex.shepard.distance).toHaveLength(pairs);
      const byDiss = [...ex.shepard.dissimilarity.keys()].sort(
        (a, b) => ex.shepard.dissimilarity[a]! - ex.shepard.dissimilarity[b]!,
      );
      const fitted = byDiss.map((i) => ex.shepard.fitted[i]!);
      expect(fitted.every((v, i) => i === 0 || v >= fitted[i - 1]! - 1e-9), "the fitted step is not monotone").toBe(true);
      // The disparities are a monotone fit to the map distances, never a copy of them.
      // If they were copied the reported stress would be 0 by construction — a number that
      // always looks perfect and means nothing — and every "stress < 0.1" check would pass.
      expect(ex.shepard.fitted).not.toEqual(ex.shepard.distance);
      expect(ex.stress).toBeGreaterThan(0);
      // The claim of NMDS: the map's distances must follow the order of the dissimilarities.
      const dOrder = [...ex.shepard.distance.keys()].sort((a, b) => ex.shepard.distance[a]! - ex.shepard.distance[b]!);
      const agree = dOrder.filter((v, i) => Math.abs(byDiss.indexOf(v) - i) <= pairs * 0.1).length / pairs;
      expect(agree).toBeGreaterThan(0.7);
      // Same seed → the same map, so a published figure is reproducible.
      const again = await s.request("nmds", spec);
      expect((again["extra"] as { ordination: { scores: number[][] } }).ordination.scores).toEqual(ex.scores);
      // A transformation changes the map (it is applied, not accepted and dropped).
      const hellingerRun = await s.request("nmds", { ...spec, transform: "hellinger", metric: "euclidean" });
      expect((hellingerRun["extra"] as { ordination: { scores: number[][] } }).ordination.scores).not.toEqual(ex.scores);
      // A transformation that needs non-negative data refuses negative data out loud.
      await expect(s.request("nmds", { columns: cols.map((c, j) => (j === 0 ? c.map((v) => -v - 1) : c)), labels, transform: "hellinger" })).rejects.toThrow();
    } finally {
      await s.stop();
    }
  }, 40_000);

  it("pca: component-selection rules (kaiser / fixed-k / variance / all) + parallel shape", async () => {
    const s = sup();
    try {
      const v1 = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 2.5, 5.5];
      const v2 = [2.1, 3.9, 6.2, 7.8, 10.1, 12.0, 13.9, 16.1, 5.0, 11.2];
      const v3 = [5.0, 3.0, 6.0, 2.0, 7.0, 1.0, 8.0, 4.0, 9.0, 3.5];
      const base = { columns: [v1, v2, v3], labels: ["v1", "v2", "v3"], standardize: true };
      const ret = async (extra: Record<string, unknown>) =>
        ((await s.request("pca", { ...base, ...extra }))["glance"] as Record<string, number>)["retained"];
      // Deterministic rules (functions of the eigenvalues [~2.02, ~0.98, ~0]).
      expect(await ret({ componentSelection: "all" })).toBe(3);
      expect(await ret({ componentSelection: "fixedk", fixedK: 2 })).toBe(2);
      expect(await ret({ componentSelection: "fixedk", fixedK: 99 })).toBe(3); // clamped to p
      expect(await ret({ componentSelection: "variance", varianceThreshold: 0.9 })).toBe(2);
      expect(await ret({ componentSelection: "variance", varianceThreshold: 0.6 })).toBe(1);
      expect(await ret({ componentSelection: "kaiser", kaiserThreshold: 1.0 })).toBe(1);
      expect(await ret({ componentSelection: "kaiser", kaiserThreshold: 0.5 })).toBe(2);

      // Parallel analysis: correct shape + reproducible; exposes per-PC noise thresholds.
      const par = await s.request("pca", { ...base, componentSelection: "parallel", parallelSims: 300, seed: 7 });
      const pg = par["glance"] as Record<string, number | string>;
      expect(pg["selection"]).toBe("parallel");
      expect(pg["retained"]).toBeGreaterThanOrEqual(0);
      expect(pg["retained"]).toBeLessThanOrEqual(3);
      const pex = (par["extra"] as { pca: { parallelThresholds: number[]; retainedFlags: boolean[] } }).pca;
      expect(pex.parallelThresholds).toHaveLength(3);
      expect(pex.retainedFlags).toHaveLength(3);
      // The results pane marks retained components straight from these flags rather
      // than re-deriving them, so the flags must agree with the count.
      expect(pex.retainedFlags.filter(Boolean)).toHaveLength(pg["retained"] as number);

      // No selection → Kaiser; every term carries a `retained` flag.
      const def = await s.request("pca", base);
      expect((def["glance"] as Record<string, string>)["selection"]).toBe("kaiser");
      expect("retained" in (def["terms"] as Array<Record<string, unknown>>)[0]!).toBe(true);
    } finally {
      await s.stop();
    }
  }, 25_000);

  it("pca: optional per-case groups are carried through the listwise mask, aligned to the kept scores", async () => {
    const s = sup();
    try {
      const v1 = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 2.5, 5.5];
      const v2 = [2.1, 3.9, 6.2, 7.8, 10.1, 12.0, 13.9, 16.1, 5.0, 11.2];
      const v3 = [5.0, 3.0, 6.0, 2.0, 7.0, 1.0, 8.0, 4.0, 9.0, 3.5];
      const grp = ["A", "A", "A", "A", "A", "B", "B", "B", "B", "B"];
      // Drop case index 2 (an "A") via a blank variable cell → its group must drop too.
      const v1miss = v1.slice();
      (v1miss as Array<number | string>)[2] = "";
      const r = await s.request("pca", { columns: [v1miss, v2, v3], labels: ["v1", "v2", "v3"], groups: grp });
      const ex = (r["extra"] as { pca: { scores: number[][]; groups: string[] } }).pca;
      // 9 complete cases kept; groups array aligns 1-1 with the kept score rows.
      expect(ex.scores).toHaveLength(9);
      expect(ex.groups).toHaveLength(9);
      expect(ex.groups.filter((g) => g === "A")).toHaveLength(4); // one A dropped
      expect(ex.groups.filter((g) => g === "B")).toHaveLength(5);
      // A blank label becomes "Ungrouped".
      const grpBlank = ["A", "A", "A", "A", "A", "B", "B", "B", "B", ""];
      const rb = await s.request("pca", { columns: [v1, v2, v3], labels: ["v1", "v2", "v3"], groups: grpBlank });
      const exb = (rb["extra"] as { pca: { groups: string[] } }).pca;
      expect(exb.groups[9]).toBe("Ungrouped");
    } finally {
      await s.stop();
    }
  }, 20_000);

  it("cluster: k-means + hierarchical recover 3 well-separated blobs (high silhouette)", async () => {
    const s = sup();
    try {
      // Three tight blobs of 6 points each: near (0,0), (10,10), (0,10).
      const x = [0, 0.2, -0.1, 0.1, -0.2, 0.15, 10, 10.2, 9.9, 10.1, 9.8, 10.15, 0, 0.1, -0.1, 0.2, -0.15, 0.05];
      const y = [0, -0.1, 0.2, 0.1, 0.05, -0.2, 10, 9.9, 10.1, 10.2, 9.85, 10.0, 10, 10.1, 9.9, 10.2, 9.95, 10.15];
      for (const variant of ["kmeans", "hierarchical"] as const) {
        const r = await s.request("cluster", { columns: [x, y], labels: ["x", "y"], variant, k: 3, seed: 42 });
        const g = r["glance"] as Record<string, number>;
        const ex = (r["extra"] as { cluster: { labels: number[]; sizes: number[]; silhouette: number } }).cluster;
        expect(g["clusters"]).toBe(3);
        expect(g["cases"]).toBe(18);
        expect(g["silhouette"]).toBeGreaterThan(0.9); // very well separated
        expect(ex.sizes.slice().sort()).toEqual([6, 6, 6]);
        // Each true blob (rows 0-5, 6-11, 12-17) is a single cluster.
        for (const b of [0, 6, 12]) {
          const block = ex.labels.slice(b, b + 6);
          expect(new Set(block).size).toBe(1);
        }
      }
    } finally {
      await s.stop();
    }
  }, 20_000);

  it("cluster: every advertised distance metric × linkage runs ('manhattan' must not crash)", async () => {
    const s = sup();
    try {
      // Two clean blocks any metric separates. The UI offers these four metrics; a metric
      // name scipy's pdist does not recognise (e.g. raw 'manhattan') throws engine_internal,
      // so this matrix checks that every advertised combination reaches a working path.
      // Three features with within-row variation so the correlation metric (undefined for
      // zero-variance rows) is finite too.
      const c1 = [0, 0.2, 10, 10.2];
      const c2 = [0.1, 0, 10.1, 10.0];
      const c3 = [0.2, 0.1, 10.3, 10.1];
      for (const metric of ["euclidean", "manhattan", "cosine", "correlation"] as const) {
        for (const linkage of ["average", "complete", "single", "weighted", "ward"] as const) {
          const r = await s.request("cluster", { columns: [c1, c2, c3], variant: "hierarchical", k: 2, metric, linkage, standardize: false });
          expect((r["glance"] as Record<string, number>)["clusters"]).toBe(2);
        }
      }
    } finally {
      await s.stop();
    }
  }, 30_000);

  it("cluster: silhouette honours the clustering metric (cosine separation ≈ 1, not the Euclidean value)", async () => {
    const s = sup();
    try {
      // Direction-separated points: cosine groups {(1,1),(5,5)} vs {(1,-1),(5,-5)} perfectly.
      // The reported silhouette uses the cosine geometry that formed the clusters → ~1.0
      // (a Euclidean silhouette would give ~0.078).
      const xs = [1, 5, 1, 5];
      const ys = [1, 5, -1, -5];
      const cos = await s.request("cluster", { columns: [xs, ys], variant: "hierarchical", k: 2, metric: "cosine", linkage: "average", standardize: false });
      expect((cos["glance"] as Record<string, number>)["silhouette"]).toBeGreaterThan(0.95);
      // The same labels judged by Euclidean geometry score far lower — proving the metric matters.
      const euc = await s.request("cluster", { columns: [xs, ys], variant: "hierarchical", k: 2, metric: "euclidean", linkage: "average", standardize: false });
      expect((euc["glance"] as Record<string, number>)["silhouette"]).toBeLessThan(0.5);
    } finally {
      await s.stop();
    }
  }, 20_000);

  it("cluster: k-selection scan reports elbow + silhouette per k and suggests k=3 (three blobs)", async () => {
    const s = sup();
    try {
      const x = [0, 0.2, -0.1, 0.1, -0.2, 0.15, 10, 10.2, 9.9, 10.1, 9.8, 10.15, 0, 0.1, -0.1, 0.2, -0.15, 0.05];
      const y = [0, -0.1, 0.2, 0.1, 0.05, -0.2, 10, 9.9, 10.1, 10.2, 9.85, 10.0, 10, 10.1, 9.9, 10.2, 9.95, 10.15];
      for (const variant of ["kmeans", "hierarchical"] as const) {
        const r = await s.request("cluster", { columns: [x, y], labels: ["x", "y"], variant, k: 3, seed: 42, scanK: true, kMax: 6 });
        const g = r["glance"] as Record<string, number>;
        const scan = (r["extra"] as { cluster: { kScan: { ks: number[]; withinSS: number[]; silhouette: Array<number | null>; bestKSilhouette: number; elbowK: number } } }).cluster.kScan;
        // Scan spans k=2…6; the three well-separated blobs peak the silhouette at k=3.
        expect(scan.ks).toEqual([2, 3, 4, 5, 6]);
        expect(scan.withinSS).toHaveLength(5);
        expect(scan.silhouette).toHaveLength(5);
        expect(scan.bestKSilhouette).toBe(3);
        expect(g["suggestedK"]).toBe(3);
        expect(g["elbowK"]).toBeGreaterThanOrEqual(2);
        // Within-cluster SS is monotone non-increasing in k (more clusters fit tighter).
        for (let i = 1; i < scan.withinSS.length; i++) expect(scan.withinSS[i]!).toBeLessThanOrEqual(scan.withinSS[i - 1]! + 1e-9);
      }
      // Without a scan: no kScan block and no suggestedK.
      const plain = await s.request("cluster", { columns: [x, y], labels: ["x", "y"], variant: "kmeans", k: 3, seed: 42 });
      expect("kScan" in (plain["extra"] as { cluster: Record<string, unknown> }).cluster).toBe(false);
      expect("suggestedK" in (plain["glance"] as Record<string, unknown>)).toBe(false);
    } finally {
      await s.stop();
    }
  }, 25_000);

  it("cluster: k-means is reproducible per seed; random data scores a low silhouette; degenerate rejected", async () => {
    const s = sup();
    try {
      const x = [0, 0.2, -0.1, 8, 8.2, 7.9, 0.1, -0.2, 8.1];
      const y = [0, -0.1, 0.2, 8, 7.9, 8.1, 0.05, -0.15, 8.0];
      const a = await s.request("cluster", { columns: [x, y], labels: ["x", "y"], variant: "kmeans", k: 2, seed: 7 });
      const b = await s.request("cluster", { columns: [x, y], labels: ["x", "y"], variant: "kmeans", k: 2, seed: 7 });
      const labA = (a["extra"] as { cluster: { labels: number[] } }).cluster.labels;
      const labB = (b["extra"] as { cluster: { labels: number[] } }).cluster.labels;
      expect(labA).toEqual(labB); // same seed → identical assignment
      // Structureless data → a much lower silhouette than the well-separated case.
      const rnd = Array.from({ length: 30 }, (_v, i) => Math.sin(i * 12.9898) * 43758.5453 % 1);
      const rnd2 = Array.from({ length: 30 }, (_v, i) => Math.sin(i * 78.233) * 12345.678 % 1);
      const rr = await s.request("cluster", { columns: [rnd, rnd2], labels: ["a", "b"], variant: "kmeans", k: 3, seed: 1 });
      expect((rr["glance"] as Record<string, number>)["silhouette"]).toBeLessThan(0.75);
      // Fewer than 2 complete cases → a typed bad_request.
      await expect(s.request("cluster", { columns: [[1], [2]], labels: ["a", "b"], variant: "kmeans", k: 2 })).rejects.toThrow();
    } finally {
      await s.stop();
    }
  }, 20_000);

  it("cluster: cosine metric groups by direction; centroid/median/weighted linkages separate blobs", async () => {
    const s = sup();
    try {
      type Res = { extra: { cluster: { labels: Array<number | null> } } };
      // Cosine is magnitude-invariant → groups by direction: A1(1,1),A2(5,5) vs B1(1,-1),B2(5,-5).
      const lab = (nums: number[], ys: number[], metric: string, linkage: string): Promise<Res> =>
        s.request("cluster", { columns: [nums, ys], variant: "hierarchical", k: 2, metric, linkage, standardize: false }) as unknown as Promise<Res>;
      const lc = (await lab([1, 5, 1, 5], [1, 5, -1, -5], "cosine", "average")).extra.cluster.labels;
      expect(lc[0]).toBe(lc[1]); // A1,A2 same direction → same cluster
      expect(lc[0]).not.toBe(lc[2]); // A vs B differ in direction
      // Each of the weighted, centroid and median linkages recovers two well-separated blobs.
      const bx = [0, 0.1, 0, 10, 10.1, 10], by = [0, 0, 0.1, 10, 10, 10.1];
      for (const linkage of ["weighted", "centroid", "median"]) {
        const b = (await lab(bx, by, "euclidean", linkage)).extra.cluster.labels;
        expect(b[0]).toBe(b[2]);
        expect(b[0]).not.toBe(b[3]);
      }
    } finally {
      await s.stop();
    }
  }, 20_000);

  it("residual diagnostics: regression / ANOVA / t-tests return ŷ + residual arrays", async () => {
    const s = sup();
    try {
      type Resid = { x?: number[]; fitted: number[]; resid: number[] };
      const resOf = (r: Record<string, unknown>) =>
        (r["extra"] as { residuals?: Resid } | undefined)?.residuals;
      const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

      // Regression: fitted = ŷ on the line, residual = y − ŷ (sums to ~0 with an intercept).
      const reg = resOf(await s.request("regression", { x: [1, 2, 3, 4, 5], y: [2.1, 3.9, 6.1, 8.0, 9.9] }))!;
      expect(reg.resid).toHaveLength(5);
      expect(reg.fitted).toEqual([2.06, 4.03, 6.0, 7.97, 9.94]);
      expect(reg.resid).toEqual([0.04, -0.13, 0.1, 0.03, -0.04]);
      expect(sum(reg.resid)).toBeCloseTo(0, 9);

      // One-way ANOVA: each obs's fitted value is its group mean; residual = value − mean.
      const anv = resOf(await s.request("anova1", { groups: [[1, 2, 3, 4], [2, 3, 4, 5], [6, 7, 8, 9]] }))!;
      expect(anv.fitted).toEqual([2.5, 2.5, 2.5, 2.5, 3.5, 3.5, 3.5, 3.5, 7.5, 7.5, 7.5, 7.5]);
      expect(anv.resid).toEqual([-1.5, -0.5, 0.5, 1.5, -1.5, -0.5, 0.5, 1.5, -1.5, -0.5, 0.5, 1.5]);

      // Unpaired t: within-group deviations; fitted = the two group means.
      const up = resOf(await s.request("ttest", { variant: "unpaired", a: [1, 2, 3, 4], b: [5, 6, 7, 8] }))!;
      expect(up.fitted).toEqual([2.5, 2.5, 2.5, 2.5, 6.5, 6.5, 6.5, 6.5]);
      expect(up.resid).toEqual([-1.5, -0.5, 0.5, 1.5, -1.5, -0.5, 0.5, 1.5]);

      // Paired t: residuals of the differences about their mean.
      const pr = resOf(await s.request("ttest", { variant: "paired", a: [1, 2, 3, 4], b: [1.5, 2.5, 2.0, 5.0] }))!;
      expect(pr.resid).toEqual([-0.25, -0.25, 1.25, -0.75]);

      // One-sample t: residuals about the sample mean.
      const os = resOf(await s.request("ttest", { variant: "one-sample", a: [2, 4, 6, 8], mu: 0 }))!;
      expect(os.fitted).toEqual([5, 5, 5, 5]);
      expect(os.resid).toEqual([-3, -1, 1, 3]);

      // Nonparametric variants assume no normal residuals → they ship no residual arrays.
      expect(resOf(await s.request("ttest", { variant: "mann-whitney", a: [1, 2, 3], b: [4, 5, 6] }))).toBeUndefined();
    } finally {
      await s.stop();
    }
  }, 20_000);

  it("residual diagnostics: curvefit / two-way / ANCOVA / RM ANOVA return ŷ + residuals", async () => {
    const s = sup();
    try {
      type Resid = { x?: number[]; fitted: number[]; resid: number[] };
      const resOf = (r: Record<string, unknown>) =>
        (r["extra"] as { residuals?: Resid } | undefined)?.residuals;
      const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

      // Curve fit (linear): fitted = ŷ on the line; same data as the OLS regression test.
      const cl = resOf(await s.request("curvefit", { model: "linear", x: [1, 2, 3, 4, 5], y: [2.1, 3.9, 6.1, 8.0, 9.9] }))!;
      expect(cl.fitted).toEqual([2.06, 4.03, 6.0, 7.97, 9.94]);
      expect(sum(cl.resid)).toBeCloseTo(0, 9);
      // 4PL ships residuals too (over the positive-dose subset).
      const c4 = resOf(await s.request("curvefit", { model: "4pl", x: [0.1, 1, 10, 100, 1000], y: [5, 20, 50, 80, 95] }))!;
      expect(c4.resid).toHaveLength(5);

      // Two-way ANOVA: fitted = cell mean; residual = obs − cell mean.
      const tw = resOf(await s.request("twoway", { cells: [[[1, 2], [3, 4]], [[5, 6], [7, 8]]] }))!;
      expect(tw.fitted).toEqual([1.5, 1.5, 3.5, 3.5, 5.5, 5.5, 7.5, 7.5]);
      expect(tw.resid).toEqual([-0.5, 0.5, -0.5, 0.5, -0.5, 0.5, -0.5, 0.5]);

      // ANCOVA: residuals from each group's own (separate-line) fit. G1 is a perfect
      // line (residuals 0); G2 has scatter.
      const an = resOf(await s.request("ancova", {
        groups: [
          { label: "G1", x: [1, 2, 3, 4], y: [2, 4, 6, 8] },
          { label: "G2", x: [1, 2, 3, 4], y: [3.0, 5.0, 7.0, 9.5] },
        ],
      }))!;
      expect(an.fitted).toEqual([2.0, 4.0, 6.0, 8.0, 2.9, 5.05, 7.2, 9.35]);
      expect(an.resid.slice(0, 4)).toEqual([0, 0, 0, 0]);
      expect(sum(an.resid)).toBeCloseTo(0, 6);

      // Slope difference (G1 − G2) + CI — pairwise detail behind the omnibus slope F.
      // b1=2, b2=2.15 → Δ=−0.15; SE=√(0.075/4)·√(1/5+1/5)=0.086603; F_slope = t² = 3.
      const an2 = (await s.request("ancova", {
        groups: [
          { label: "G1", x: [1, 2, 3, 4], y: [2, 4, 6, 8] },
          { label: "G2", x: [1, 2, 3, 4], y: [3.0, 5.0, 7.0, 9.5] },
        ],
      })) as { glance: Record<string, number>; terms: Array<{ term: string; estimate?: number; se?: number; ciLow?: number; ciHigh?: number }> };
      const sd = an2.terms.find((t) => t.term.startsWith("Slope difference"))!;
      expect(sd.estimate).toBeCloseTo(-0.15, 6);
      expect(sd.se).toBeCloseTo(0.086603, 5);
      expect(sd.ciLow).toBeCloseTo(-0.390456, 4);
      expect(sd.ciHigh).toBeCloseTo(0.090456, 4);
      expect(an2.glance.slope_diff).toBeCloseTo(-0.15, 6);
      expect(an2.glance.F_slope).toBeCloseTo(3.0, 6);

      // RM ANOVA: additive-model residuals (subject + condition − grand), sum to ~0.
      const rm = resOf(await s.request("rmanova", { data: [[1, 2, 3], [2, 3, 4], [4, 5, 7]] }))!;
      expect(rm.resid).toHaveLength(9);
      expect(sum(rm.resid)).toBeCloseTo(0, 6);
      // Friedman (nonparametric) ships none.
      expect(resOf(await s.request("rmanova", { variant: "friedman", data: [[1, 2, 3], [2, 3, 4], [4, 5, 7]] }))).toBeUndefined();
    } finally {
      await s.stop();
    }
  }, 25_000);

  it("curvefit 4PL: recovers known dose-response parameters", async () => {
    const s = sup();
    try {
      // Synthesize from bottom=5, top=95, EC50=10 (logEC50=1), hill=1.2.
      const dose = [0.1, 0.3, 1, 3, 10, 30, 100, 300];
      const y = dose.map((dx) => 5 + 90 / (1 + 10 ** ((1 - Math.log10(dx)) * 1.2)));
      const g = (await s.request("curvefit", { model: "4pl", x: dose, y }))["glance"] as Record<string, number>;
      expect(g["EC50"]).toBeCloseTo(10, 1);
      expect(g["hill_slope"]).toBeCloseTo(1.2, 2);
      expect(g["top"]).toBeCloseTo(95, 0);
      expect(g["bottom"]).toBeCloseTo(5, 0);
      expect(g["r_sq"]).toBeCloseTo(1, 4);
      const curve = (await s.request("curvefit", { model: "4pl", x: dose, y }))["curve"] as { x: number[] };
      expect(curve.x.length).toBe(80); // sampled curve for overlay
    } finally {
      await s.stop();
    }
  }, 20_000);

  it("curvefit kcat: with Et constrained, recovers kcat = Vmax/Et", async () => {
    const s = sup();
    try {
      // Synthesize from Et=2, kcat=10, KM=5 → Vmax = Et·kcat = 20.
      const x = [1, 2, 5, 10, 20, 35, 50, 75, 100];
      const y = x.map((xi) => (2 * 10 * xi) / (5 + xi));
      // Et must be constrained (else Et·kcat is confounded); fix it to its known value.
      const g = (await s.request("curvefit", { model: "kcat", x, y, fixed: { Et: 2 } }))["glance"] as Record<string, number>;
      expect(g["kcat"]).toBeCloseTo(10, 2); // = Vmax / Et = 20 / 2
      expect(g["km"]).toBeCloseTo(5, 2);
      expect(g["Vmax"]).toBeCloseTo(20, 1); // derived = Et·kcat, confirms Et held at 2
      // Specificity constant (catalytic efficiency) = kcat/KM = 10/5 = 2. Slash sanitized
      // to an underscore in the glance key, like every other derived label.
      expect(g["kcat_KM"] ?? g["kcat_km"]).toBeCloseTo(2, 3);
      expect(g["r_sq"]).toBeCloseTo(1, 4);
    } finally {
      await s.stop();
    }
  }, 20_000);

  it("curvefit enzyme_progress: integrated-MM progress curve recovers Vmax/KM/S0", async () => {
    const s = sup();
    try {
      // Product vs time generated from the implicit integrated-MM relation
      // KM·ln(S0/S) + (S0−S) = Vmax·t (solved by bisection — independent of the engine's
      // Lambert-W form); the fit must invert it back to the generating parameters.
      const prog = (t: number, Vmax: number, KM: number, S0: number): number => {
        const target = Vmax * t;
        let lo = 1e-9, hi = S0;
        for (let i = 0; i < 100; i++) {
          const mid = 0.5 * (lo + hi);
          const f = KM * Math.log(S0 / mid) + (S0 - mid); // decreasing in mid
          if (f > target) lo = mid;
          else hi = mid;
        }
        return S0 - 0.5 * (lo + hi);
      };
      const t = [0, 1, 2, 3, 4, 5, 7, 9, 12, 15, 20, 25, 30, 40];
      const y = t.map((ti) => prog(ti, 10, 20, 100));
      const g = (await s.request("curvefit", { model: "enzyme_progress", x: t, y }))["glance"] as Record<string, number>;
      expect(g["vmax"]).toBeCloseTo(10, 1);
      expect(g["km"]).toBeCloseTo(20, 1);
      expect(g["s0"]).toBeCloseTo(100, 0);
      expect(g["r_sq"]).toBeCloseTo(1, 4);
    } finally {
      await s.stop();
    }
  }, 20_000);

  it("curvefit allosteric_binding: ternary-complex titration recovers Bmax/KB/α (A,KA fixed)", async () => {
    const s = sup();
    try {
      // Radioligand binding (A=2, KA=5 known/fixed) shifted by an allosteric modulator B;
      // KA,obs = KA·(1+[B]/KB)/(1+α[B]/KB). Recover Bmax=1000, KB=100, α=0.2 (negative coop).
      const Bmax = 1000, A = 2, KA = 5, KB = 100, alpha = 0.2;
      const f = (B: number) => (1 + B / KB) / (1 + (alpha * B) / KB);
      const xb = [1, 3.16, 10, 31.6, 100, 316, 1000, 3160, 10000];
      const y = xb.map((B) => (Bmax * A) / (A + KA * f(B)));
      const g = (await s.request("curvefit", { model: "allosteric_binding", x: xb, y, fixed: { A, KA } }))["glance"] as Record<string, number>;
      expect(g["bmax"]).toBeCloseTo(1000, 0);
      expect(g["KB"]).toBeCloseTo(100, 0);
      expect(g["Alpha"]).toBeCloseTo(0.2, 2);
      expect(g["r_sq"]).toBeCloseTo(1, 4);
    } finally {
      await s.stop();
    }
  }, 20_000);

  it("curvefit ic50_norm: normalized inhibition recovers the absolute IC50 (100→0% range)", async () => {
    const s = sup();
    try {
      // Normalized inhibition 100/(1+10^((log10 x − logIC50)·hill)); IC50 = 10, hill = 1.
      const dose = [0.1, 0.3, 1, 3, 10, 30, 100, 300, 1000];
      const y = dose.map((dx) => 100 / (1 + 10 ** ((Math.log10(dx) - 1) * 1)));
      const g4 = (await s.request("curvefit", { model: "ic50_norm_4pl", x: dose, y }))["glance"] as Record<string, number>;
      expect(g4["IC50"]).toBeCloseTo(10, 1); // = 10^logIC50 = the absolute IC50 (50% of 0–100)
      expect(g4["r_sq"]).toBeCloseTo(1, 4);
      const g3 = (await s.request("curvefit", { model: "ic50_norm_3pl", x: dose, y }))["glance"] as Record<string, number>;
      expect(g3["IC50"]).toBeCloseTo(10, 1);
      // The fitted curve runs from ~100 (low inhibitor) down to ~0 (high inhibitor).
      const curve = (await s.request("curvefit", { model: "ic50_norm_4pl", x: dose, y }))["curve"] as { y: number[] };
      expect(curve.y[0]!).toBeGreaterThan(curve.y[curve.y.length - 1]!);
    } finally {
      await s.stop();
    }
  }, 20_000);

  it("curvefit: reports residual diagnostics on the nonlinear fit (adj-R², Sy.x, runs, lack-of-fit, normality)", async () => {
    const s = sup();
    try {
      // A straight line 2x+1 fit through the nonlinear driver, with replicate X's so the
      // replicates lack-of-fit F is defined (5 X-levels × 2 reps) and the runs test has
      // signed residuals.
      const x = [1, 1, 2, 2, 3, 3, 4, 4, 5, 5];
      const y = [3.1, 2.9, 5.05, 4.95, 7.1, 6.9, 9.05, 8.95, 11.1, 10.9];
      const r = await s.request("curvefit", { model: "custom", equation: "A*X+B", x, y, initialValues: { A: 1, B: 0 } });
      const terms = r["terms"] as Array<Record<string, unknown>>;
      const by = (name: string) => terms.find((t) => t["term"] === name);
      const g = r["glance"] as Record<string, number>;
      // Goodness-of-fit rows (the pack the linear path already reports).
      expect(by("Adjusted R²")!.estimate as number).toBeGreaterThan(0.99);
      expect(by("Sy.x (RMSE)")!.estimate as number).toBeGreaterThan(0);
      expect(by("Sum of squares")!.df).toBe(8); // n(10) − free params(2)
      expect(g["adj_r_sq"]).toBeGreaterThan(0.99);
      expect(g["syx"]).toBeCloseTo(by("Sy.x (RMSE)")!.estimate as number, 6);
      expect(g["df"]).toBe(8);
      // Runs test present (residual sign pattern).
      expect(by("Runs test (lack of fit)")).toBeDefined();
      // Replicates lack-of-fit F present (data have replicate Y's); df_lof = 5 levels − 2 params.
      expect(by("Lack of fit (replicates)")!.df).toBe(3);
      expect(typeof by("Lack of fit (replicates)")!.p).toBe("number");
      // Residual-normality battery (at least Shapiro-Wilk).
      expect(by("Residual normality (Shapiro-Wilk)")).toBeDefined();
    } finally {
      await s.stop();
    }
  }, 20_000);

  it("curvefit: the lack-of-fit row is absent without replicates (goodness-of-fit rows still appear)", async () => {
    const s = sup();
    try {
      const x = [1, 2, 3, 4, 5, 6, 7]; // all-distinct X → no pure-error term → no LOF F
      const y = x.map((v) => 2 * v + 1 + (v % 2 ? 0.05 : -0.05));
      const r = await s.request("curvefit", { model: "custom", equation: "A*X+B", x, y, initialValues: { A: 1, B: 0 } });
      const terms = r["terms"] as Array<Record<string, unknown>>;
      expect(terms.some((t) => t["term"] === "Lack of fit (replicates)")).toBe(false);
      expect(terms.some((t) => t["term"] === "Sy.x (RMSE)")).toBe(true);
    } finally {
      await s.stop();
    }
  }, 20_000);

  it("curvefit: nonlinear confidence + prediction bands overlay the fitted curve", async () => {
    const s = sup();
    try {
      type Curve = { x: number[]; y: number[]; ciLow?: number[]; ciHigh?: number[]; piLow?: number[]; piHigh?: number[] };
      // Michaelis-Menten (Vmax=100, KM=10): the delta-method band must bracket the
      // fitted curve, and the prediction band must contain the confidence band.
      const xm = [0.5, 1, 2, 3, 5, 8, 12, 20, 30, 50];
      const ym = xm.map((v) => (100 * v) / (10 + v));
      const cm = (await s.request("curvefit", { model: "mm", x: xm, y: ym }))["curve"] as Curve;
      expect(cm.ciLow).toHaveLength(80);
      expect(cm.ciHigh).toHaveLength(80);
      expect(cm.piLow).toHaveLength(80);
      expect(cm.piHigh).toHaveLength(80);
      for (let i = 0; i < 80; i++) {
        expect(cm.ciLow![i]!).toBeLessThanOrEqual(cm.y[i]! + 1e-6); // CI brackets the curve
        expect(cm.ciHigh![i]!).toBeGreaterThanOrEqual(cm.y[i]! - 1e-6);
        expect(cm.piLow![i]!).toBeLessThanOrEqual(cm.ciLow![i]! + 1e-6); // PI ⊇ CI
        expect(cm.piHigh![i]!).toBeGreaterThanOrEqual(cm.ciHigh![i]! - 1e-6);
      }

      // A user-defined (custom) equation fit through the same driver also ships bands,
      // and its linear band is hyperbolic — narrowest at the data centroid (x̄=3 ≈ idx 40).
      const cc = (await s.request("curvefit", {
        model: "custom", equation: "A*X + B", x: [1, 2, 3, 4, 5], y: [2.1, 3.9, 6.1, 8.0, 9.9], initialValues: { A: 1, B: 0 },
      }))["curve"] as Curve;
      expect(cc.ciLow).toHaveLength(80);
      expect(cc.piHigh).toHaveLength(80);
      const halfCi = (i: number): number => (cc.ciHigh![i]! - cc.ciLow![i]!) / 2;
      expect(halfCi(0)).toBeGreaterThan(halfCi(40));
      expect(halfCi(79)).toBeGreaterThan(halfCi(40));

      // Model-free smoothers have no covariance ⇒ no bands (only x + y on the curve).
      const sp = (await s.request("curvefit", { model: "spline", x: [1, 2, 3, 4, 5, 6], y: [1, 4, 9, 16, 25, 36], frac: 0.5 }))["curve"] as Curve;
      expect(sp.ciLow).toBeUndefined();
      expect(sp.piLow).toBeUndefined();
    } finally {
      await s.stop();
    }
  }, 20_000);

  it("curvefit: parameter correlation matrix + dependency diagnostics", async () => {
    const s = sup();
    try {
      type Term = { term: string; dependency?: number };
      type Res = { terms: Term[]; glance: Record<string, number>; extra: { paramCorrelation?: { params: string[]; matrix: number[][] } }; assumptions: string[] };
      // Michaelis-Menten: each free param gets a dependency in [0,1]; the correlation
      // matrix is symmetric with a unit diagonal; max_dependency is reported.
      const xm = [0.5, 1, 2, 3, 5, 8, 12, 20];
      const rm = (await s.request("curvefit", { model: "mm", x: xm, y: xm.map((v) => (100 * v) / (10 + v)) })) as unknown as Res;
      const pc = rm.extra.paramCorrelation!;
      expect(pc.params).toEqual(["Vmax", "KM"]);
      expect(pc.matrix[0]![0]).toBe(1); // unit diagonal
      expect(pc.matrix[1]![1]).toBe(1);
      expect(pc.matrix[0]![1]).toBeCloseTo(pc.matrix[1]![0]!, 9); // symmetric
      for (const nm of ["Vmax", "KM"]) {
        const dep = rm.terms.find((t) => t.term === nm)!.dependency!;
        expect(dep).toBeGreaterThanOrEqual(0);
        expect(dep).toBeLessThanOrEqual(1);
      }
      // 2-param identity: dependency == correlation² (both params share it).
      expect(rm.terms.find((t) => t.term === "Vmax")!.dependency!).toBeCloseTo(pc.matrix[0]![1]! ** 2, 4);
      expect(rm.glance["max_dependency"]).toBeGreaterThan(0);

      // Two-phase decay with near-equal rates → unidentifiable → dependency ≈ 1 + a flag.
      const xd = Array.from({ length: 39 }, (_, i) => 0.1 * (i + 1));
      const yd = xd.map((t) => 2 + 5 * Math.exp(-0.5 * t) + 5 * Math.exp(-0.55 * t));
      const rd = (await s.request("curvefit", { model: "exp_decay2", x: xd, y: yd })) as unknown as Res;
      expect(rd.glance["max_dependency"]).toBeGreaterThan(0.99);
      expect(rd.assumptions.some((a) => /dependency/i.test(a))).toBe(true);

      // A single free parameter has nothing to correlate with ⇒ dependency 0.
      const rg = (await s.request("curvefit", { model: "exp_growth", x: [0, 1, 2, 3, 4], y: [1, 2, 4, 8, 16], fixed: { Y0: 1 } })) as unknown as Res;
      expect(rg.terms.find((t) => t.term === "K")!.dependency).toBe(0);
    } finally {
      await s.stop();
    }
  }, 20_000);

  it("curvefit weighting: 1/SD² matches weighted OLS; Poisson reweights by 1/Ŷ", async () => {
    const s = sup();
    try {
      // 1/SD²: per-point SD (unsorted x) → the weighted normal-equations solution.
      const x = [5, 1, 3, 2, 4], y = [11.1, 3.2, 7.0, 5.1, 9.0], sd = [2, 0.5, 1, 0.7, 1.5];
      const w = sd.map((v) => 1 / (v * v));
      const Sw = w.reduce((a, b) => a + b, 0);
      const Swx = w.reduce((a, wi, i) => a + wi * x[i]!, 0);
      const Swy = w.reduce((a, wi, i) => a + wi * y[i]!, 0);
      const Swxx = w.reduce((a, wi, i) => a + wi * x[i]! * x[i]!, 0);
      const Swxy = w.reduce((a, wi, i) => a + wi * x[i]! * y[i]!, 0);
      const slope = (Sw * Swxy - Swx * Swy) / (Sw * Swxx - Swx * Swx);
      const inter = (Swy - slope * Swx) / Sw;
      const g = (await s.request("curvefit", { model: "custom", equation: "A*X+B", x, y, sd, weighting: "1/SD2", initialValues: { A: 1, B: 0 } }))["glance"] as Record<string, number>;
      expect(g["a"]).toBeCloseTo(slope, 4);
      expect(g["b"]).toBeCloseTo(inter, 4);

      // 1/SD² without any SD → a clear error (never a silent mis-weight).
      await expect(s.request("curvefit", { model: "mm", x: [1, 2, 3, 4], y: [1, 2, 3, 4], weighting: "1/SD2" })).rejects.toThrow();

      // Poisson: iteratively reweighted by 1/Ŷ → the converged IRLS fixed point (≠ OLS).
      const xp = [1, 2, 3, 4, 5, 6, 7, 8], yp = [3, 5, 8, 11, 16, 22, 30, 41];
      const gp = (await s.request("curvefit", { model: "custom", equation: "A*X+B", x: xp, y: yp, weighting: "poisson", initialValues: { A: 1, B: 0 } }))["glance"] as Record<string, number>;
      const gu = (await s.request("curvefit", { model: "custom", equation: "A*X+B", x: xp, y: yp, initialValues: { A: 1, B: 0 } }))["glance"] as Record<string, number>;
      expect(gp["a"]).toBeCloseTo(4.309674, 3); // the IRLS(1/Ŷ) slope
      expect(Math.abs(gp["a"]! - gu["a"]!)).toBeGreaterThan(0.3); // weighting genuinely changed the fit
    } finally {
      await s.stop();
    }
  }, 20_000);

  it("curvefit: profile-likelihood (asymmetric) confidence intervals", async () => {
    const s = sup();
    try {
      type Term = { term: string; ciLow?: number; ciHigh?: number; estimate?: number };
      type Res = { terms: Term[]; assumptions: string[] };
      // A straight-line fit → the profile CI collapses to the symmetric Wald interval,
      // and the profile-likelihood note fires.
      const r = (await s.request("curvefit", { model: "custom", equation: "A*X+B", x: [0, 1, 2, 3, 4, 5, 6, 7], y: [1, 2.9, 5.2, 6.8, 9.1, 10.8, 13.2, 15.1], initialValues: { A: 1, B: 0 } })) as unknown as Res;
      const A = r.terms.find((t) => t.term === "A")!;
      expect(A.ciLow!).toBeLessThan(A.estimate!);
      expect(A.ciHigh!).toBeGreaterThan(A.estimate!);
      expect(Math.abs((A.ciHigh! - A.estimate!) - (A.estimate! - A.ciLow!))).toBeLessThan(1e-3); // symmetric
      expect(r.assumptions.some((a) => /profile-likelihood/i.test(a))).toBe(true);

      // A nonlinear fit (real scatter): every fitted parameter's CI brackets its estimate.
      const xd = [0, 0.5, 1, 1.5, 2, 3, 4, 6, 8], yd = [104, 78, 60, 42, 33, 22, 12, 8, 6];
      const rd = (await s.request("curvefit", { model: "exp_decay", x: xd, y: yd })) as unknown as Res;
      const fitted = rd.terms.filter((t) => t.ciLow != null && t.ciHigh != null);
      expect(fitted.length).toBeGreaterThanOrEqual(2);
      for (const t of fitted) {
        expect(t.ciLow!).toBeLessThan(t.estimate!);
        expect(t.ciHigh!).toBeGreaterThan(t.estimate!);
      }

      // Poisson skips profiling (each refit re-runs the IRLS) → no profile note.
      const rp = (await s.request("curvefit", { model: "custom", equation: "A*X+B", x: [1, 2, 3, 4, 5, 6, 7, 8], y: [3, 5, 8, 11, 16, 22, 30, 41], weighting: "poisson", initialValues: { A: 1, B: 0 } })) as unknown as Res;
      expect(rp.assumptions.some((a) => /profile-likelihood/i.test(a))).toBe(false);
    } finally {
      await s.stop();
    }
  }, 20_000);

  it("curvefit: Hougaard skewness diagnostic", async () => {
    const s = sup();
    try {
      type Term = { term: string; skewness?: number };
      type Res = { terms: Term[]; glance: Record<string, number> };
      // A linear model has zero curvature ⇒ Hougaard's skewness ≈ 0 for every parameter.
      const rl = (await s.request("curvefit", { model: "custom", equation: "A*X+B", x: [0, 1, 2, 3, 4, 5, 6, 7], y: [1, 2.9, 5.2, 6.8, 9.1, 10.8, 13.2, 15.1], initialValues: { A: 1, B: 0 } })) as unknown as Res;
      for (const nm of ["A", "B"]) expect(Math.abs(rl.terms.find((t) => t.term === nm)!.skewness!)).toBeLessThan(1e-3);

      // A nonlinear fit → each fitted parameter gets a finite skewness; glance carries the max.
      const xd = [0, 0.5, 1, 1.5, 2, 3, 4, 6, 8], yd = [104, 75, 63, 44, 39, 20, 15, 6, 2];
      const rd = (await s.request("curvefit", { model: "exp_decay", x: xd, y: yd })) as unknown as Res;
      const withSkew = rd.terms.filter((t) => t.skewness != null);
      expect(withSkew.length).toBeGreaterThanOrEqual(2);
      for (const t of withSkew) expect(Number.isFinite(t.skewness!)).toBe(true);
      expect(rd.glance["max_skewness"]).toBeGreaterThan(0);
    } finally {
      await s.stop();
    }
  }, 20_000);

  it("curvefit: ROUT automatic outlier removal", async () => {
    const s = sup();
    try {
      type Res = { glance: Record<string, number>; extra: { routOutliers?: number[] }; title: string };
      const x = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], noise = [0.1, -0.1, 0.05, -0.05, 0.1, -0.1, 0.05, -0.05, 0.1, -0.1];
      const yc = x.map((xi, i) => 2 * xi + 1 + noise[i]!);
      // Clean data → nothing removed; the result is a normal least-squares fit (title tagged).
      const rc = (await s.request("curvefit", { model: "custom", equation: "A*X+B", x, y: yc, initialValues: { A: 1, B: 0 }, rout: true })) as unknown as Res;
      expect(rc.glance["outliers_removed"]).toBe(0);
      expect(rc.title).toMatch(/ROUT/);
      // One planted outlier at index 5 → flagged + removed; the cleaned slope recovers ≈2 and
      // beats the naive fit that the outlier pulls off-course.
      const yo = [...yc]; yo[5]! += 15;
      const ro = (await s.request("curvefit", { model: "custom", equation: "A*X+B", x, y: yo, initialValues: { A: 1, B: 0 }, rout: true })) as unknown as Res;
      expect(ro.glance["outliers_removed"]).toBe(1);
      expect(ro.extra.routOutliers).toEqual([5]);
      expect(ro.glance["a"]).toBeCloseTo(2, 1);
      const naive = (await s.request("curvefit", { model: "custom", equation: "A*X+B", x, y: yo, initialValues: { A: 1, B: 0 } })) as unknown as Res;
      expect(Math.abs(ro.glance["a"]! - 2)).toBeLessThan(Math.abs(naive.glance["a"]! - 2));
    } finally {
      await s.stop();
    }
  }, 20_000);

  it("curvetransform: smooth / differentiate / integrate a curve", async () => {
    const s = sup();
    try {
      type Res = { extra: { curve: { x: number[]; y: number[]; yTitle: string } }; glance: Record<string, number> };
      const x = Array.from({ length: 11 }, (_, i) => i);
      // Differentiate a straight line → the constant slope 2 everywhere; carries a yTitle.
      const rd = (await s.request("curvetransform", { x, y: x.map((xi) => 2 * xi + 1), variant: "differentiate" })) as unknown as Res;
      expect(rd.extra.curve.y.every((v) => Math.abs(v - 2) < 1e-6)).toBe(true);
      expect(rd.extra.curve.yTitle).toBe("dY/dX");
      // Integrate a constant → a ramp = X; the running total lands in glance.area.
      const ri = (await s.request("curvetransform", { x, y: x.map(() => 1), variant: "integrate" })) as unknown as Res;
      for (let i = 0; i < x.length; i++) expect(ri.extra.curve.y[i]).toBeCloseTo(x[i]!, 9);
      expect(ri.glance["area"]).toBeCloseTo(10, 9);
      // Smooth preserves a straight line (Savitzky-Golay).
      const rs = (await s.request("curvetransform", { x, y: x.map((xi) => 2 * xi + 1), variant: "smooth" })) as unknown as Res;
      for (let i = 0; i < x.length; i++) expect(rs.extra.curve.y[i]).toBeCloseTo(2 * x[i]! + 1, 6);
    } finally {
      await s.stop();
    }
  }, 20_000);

  it("equivalence (TOST): decides by CI containment and separates the four outcomes", async () => {
    const s = sup();
    try {
      type Res = { glance: Record<string, number | boolean>; summary: string; terms: Array<{ term: string; estimate?: unknown }> };
      // Two groups with near-identical means and small spread.
      const A = [10.1, 9.8, 10.3, 10.0, 9.9, 10.2, 10.05, 9.95, 10.15, 9.85];
      const B = [10.0, 10.1, 9.9, 10.2, 9.95, 10.05, 10.1, 9.9, 10.0, 10.1];

      // A generous bound → equivalent. The defining property of TOST is that the verdict
      // equals "the (1−2α) CI lies inside the bounds"; assert the identity, not just the flag.
      const wide = (await s.request("equivalence", { variant: "unpaired", a: A, b: B, bound: 0.5 })) as unknown as Res;
      const g = wide.glance;
      expect(g["equivalent"]).toBe(true);
      expect(g["bound_low"] as number).toBeLessThan(g["ci_low"] as number);
      expect(g["ci_high"] as number).toBeLessThan(g["bound_high"] as number);
      expect(g["p"]).toBe(Math.max(g["p1"] as number, g["p2"] as number)); // p_TOST = max of the two

      // A bound tighter than the CI → not equivalent, and since the difference test is also
      // non-significant this must be reported as inconclusive rather than as "the same".
      const tight = (await s.request("equivalence", { variant: "unpaired", a: A, b: B, bound: 0.02 })) as unknown as Res;
      expect(tight.glance["equivalent"]).toBe(false);
      expect(tight.glance["p_difference"] as number).toBeGreaterThan(0.05);
      expect(tight.summary).toMatch(/inconclusive/);

      // A large, precisely-measured difference: significantly different and, against a wide
      // enough bound, practically equivalent. Both facts must be reported, not just one.
      const C = A.map((v) => v + 0.2);
      const both = (await s.request("equivalence", { variant: "unpaired", a: C, b: A, bound: 1.0 })) as unknown as Res;
      expect(both.glance["equivalent"]).toBe(true);
      expect(both.glance["p_difference"] as number).toBeLessThan(0.05);
      expect(both.summary).toMatch(/statistically different but practically equivalent/);

      // Bound modes resolve to raw units: 1 SD in d-units must equal the pooled SD.
      const sd = (await s.request("equivalence", { variant: "unpaired", a: A, b: B, bound: 1, boundMode: "sd" })) as unknown as Res;
      expect(sd.glance["bound_high"] as number).toBeGreaterThan(0);
      expect(Math.abs(sd.glance["bound_low"] as number)).toBeCloseTo(sd.glance["bound_high"] as number, 9);

      // Paired + one-sample designs run.
      const paired = (await s.request("equivalence", { variant: "paired", a: A, b: B, bound: 0.5 })) as unknown as Res;
      expect(paired.glance["equivalent"]).toBe(true);
      const one = (await s.request("equivalence", { variant: "one-sample", a: A, mu: 10.0, bound: 0.3 })) as unknown as Res;
      expect(one.glance["equivalent"]).toBe(true);

      // A zero-width bound is rejected rather than silently producing "not equivalent".
      await expect(s.request("equivalence", { variant: "unpaired", a: A, b: B, bound: 0 })).rejects.toThrow();
    } finally {
      await s.stop();
    }
  }, 30_000);

  it("permutation: exact when enumerable, seeded Monte Carlo otherwise, and p is never 0", async () => {
    const s = sup();
    try {
      type Res = {
        glance: Record<string, number | boolean | null>;
        summary: string;
        extra: { nullDistribution: { values: number[]; observed: number; truncated: boolean; total: number } };
      };
      const A = [1, 2, 3, 4, 5];
      const B = [6, 7, 8, 9, 10];

      // C(10,5) = 252 rearrangements → enumerated exactly, so no seed is involved.
      const ex = (await s.request("permutation", { variant: "unpaired", a: A, b: B })) as unknown as Res;
      expect(ex.glance["exact"]).toBe(true);
      expect(ex.glance["n_permutations"]).toBe(252);
      expect(ex.glance["seed"]).toBeNull(); // an exact result must not claim to depend on a seed
      // A is entirely below B, so only the two extreme splits are as extreme → 2/252.
      // 7 places, not more: `glance` is rounded to 6 significant figures for display
      // (`_r`), so the full-precision agreement with scipy is asserted in crosscheck.py.
      expect(ex.glance["p"] as number).toBeCloseTo(2 / 252, 7);

      // The observed arrangement is itself a rearrangement, so p can never be 0.
      expect(ex.glance["p"] as number).toBeGreaterThanOrEqual(1 / 252);

      // Forcing the Monte Carlo path must respect the resample count and the +1 floor.
      const mc = (await s.request("permutation", { variant: "unpaired", a: A, b: B, maxExact: 1, nResamples: 999, seed: 7 })) as unknown as Res;
      expect(mc.glance["exact"]).toBe(false);
      expect(mc.glance["n_permutations"]).toBe(999);
      expect(mc.glance["seed"]).toBe(7);
      expect(mc.glance["p"] as number).toBeGreaterThanOrEqual(1 / 1000);
      expect(mc.glance["p_ci_low"]).not.toBeUndefined(); // a sampled p carries its own error

      // Same seed → identical p. This is the only thing that makes a Monte Carlo p citable.
      const mcAgain = (await s.request("permutation", { variant: "unpaired", a: A, b: B, maxExact: 1, nResamples: 999, seed: 7 })) as unknown as Res;
      expect(mcAgain.glance["p"]).toBe(mc.glance["p"]);
      // A different seed gives a different sample but the same answer to within MC error.
      const mcOther = (await s.request("permutation", { variant: "unpaired", a: A, b: B, maxExact: 1, nResamples: 5000, seed: 99 })) as unknown as Res;
      expect(Math.abs((mcOther.glance["p"] as number) - (ex.glance["p"] as number))).toBeLessThan(0.02);

      // Tails must not be swapped: A lies below B, so "less" is the significant side.
      const less = (await s.request("permutation", { variant: "unpaired", a: A, b: B, tail: "less" })) as unknown as Res;
      const greater = (await s.request("permutation", { variant: "unpaired", a: A, b: B, tail: "greater" })) as unknown as Res;
      expect(less.glance["p"] as number).toBeLessThan(0.01);
      expect(greater.glance["p"] as number).toBeGreaterThan(0.9);

      // Paired enumerates 2^n sign flips; correlation enumerates the re-pairings.
      const X = [5.1, 4.8, 6.2, 5.5, 5.9, 6.1, 4.9, 5.3];
      const Y = [4.7, 4.9, 5.5, 5.0, 5.4, 5.6, 4.6, 5.1];
      const paired = (await s.request("permutation", { variant: "paired", a: X, b: Y })) as unknown as Res;
      expect(paired.glance["exact"]).toBe(true);
      expect(paired.glance["n_permutations"]).toBe(2 ** 8);
      const corr = (await s.request("permutation", { variant: "correlation", a: [1, 2, 3, 4, 5, 6], b: [2, 1, 4, 3, 6, 5] })) as unknown as Res;
      expect(corr.glance["n_permutations"]).toBe(720); // 6!

      // The null distribution rides along so it can be plotted, capped to stay small.
      expect(ex.extra.nullDistribution.values.length).toBe(252);
      expect(ex.extra.nullDistribution.truncated).toBe(false);
      const big = (await s.request("permutation", { variant: "unpaired", a: A, b: B, maxExact: 1, nResamples: 20000, seed: 3 })) as unknown as Res;
      expect(big.extra.nullDistribution.truncated).toBe(true);
      expect(big.extra.nullDistribution.values.length).toBe(5000);
      expect(big.extra.nullDistribution.total).toBe(20000);
    } finally {
      await s.stop();
    }
  }, 60_000);

  it("bayesfactor: reports evidence both ways, and flags a prior-sensitive conclusion", async () => {
    const s = sup();
    try {
      type Res = { glance: Record<string, number | boolean>; summary: string; terms: Array<{ term: string; estimate?: unknown }>; warnings?: string[] };

      // Two clearly different groups → strong evidence for an effect.
      const A = [10.2, 9.8, 10.5, 10.1, 9.9, 10.3, 10.0, 10.4, 9.7, 10.6];
      const B = [13.1, 12.8, 13.4, 13.0, 12.9, 13.3, 13.2, 12.7, 13.5, 13.0];
      const big = (await s.request("bayesfactor", { variant: "unpaired", a: A, b: B })) as unknown as Res;
      expect(big.glance["bf10"] as number).toBeGreaterThan(100);
      expect(big.glance["bf01"] as number).toBeCloseTo(1 / (big.glance["bf10"] as number), 6);

      // Two nearly identical groups → the factor must favour the null. This is the whole
      // point of a Bayes factor: a p-value could never express this.
      const C = A.map((v) => v + 0.02);
      const nul = (await s.request("bayesfactor", { variant: "unpaired", a: A, b: C })) as unknown as Res;
      expect(nul.glance["bf10"] as number).toBeLessThan(1);
      expect(nul.summary).toMatch(/for H0/);

      // Prior scale must actually change the answer, and be reported.
      const wide = (await s.request("bayesfactor", { variant: "unpaired", a: A, b: B, rscale: "wide" })) as unknown as Res;
      expect(wide.glance["rscale"] as number).toBeCloseTo(1.0, 9);
      expect(wide.glance["bf10"]).not.toBe(big.glance["bf10"]);
      // Every run reports all three scales, so prior sensitivity is visible, not hidden.
      for (const scale of ["medium", "wide", "ultrawide"]) {
        expect(big.terms.some((t) => t.term.includes(scale)), `missing the ${scale} sensitivity row`).toBe(true);
      }
      // An overwhelming effect is stable across priors; the null case here is too.
      expect(big.glance["stable"]).toBe(true);

      // paired must equal one-sample on the differences — that is what paired means.
      const X = [5.1, 4.8, 6.2, 5.5, 5.9, 6.1, 4.9, 5.3];
      const Y = [4.7, 4.9, 5.5, 5.0, 5.4, 5.6, 4.6, 5.1];
      const paired = (await s.request("bayesfactor", { variant: "paired", a: X, b: Y })) as unknown as Res;
      const diffs = X.map((v, i) => v - Y[i]!);
      const oneSamp = (await s.request("bayesfactor", { variant: "one-sample", a: diffs, mu: 0 })) as unknown as Res;
      expect(paired.glance["bf10"]).toBe(oneSamp.glance["bf10"]);

      // A Bayes factor is evidence, not a decision — every result must say so.
      expect((big.warnings ?? []).join(" ")).toMatch(/not a decision|no 0\.05/i);
      // An unknown prior scale is rejected rather than silently falling back to a default.
      await expect(s.request("bayesfactor", { variant: "unpaired", a: A, b: B, rscale: "enormous" })).rejects.toThrow();
    } finally {
      await s.stop();
    }
  }, 60_000);

  it("curvefit mm/kcat: emits linearization diagnostics read off the nonlinear fit", async () => {
    const s = sup();
    try {
      type Lin = { title: string; xTitle: string; yTitle: string; x: number[]; y: number[]; slope: number; intercept: number };
      type Res = { terms: Array<{ term: string; estimate: number | null }>; extra: { linearizations?: Record<string, Lin> } };
      const VMAX = 100, KM = 5;
      const S = [1, 2, 5, 10, 20, 35, 50, 75, 100];
      const v = S.map((si) => (VMAX * si) / (KM + si));
      const r = (await s.request("curvefit", { model: "mm", x: S, y: v })) as unknown as Res;
      const lins = r.extra.linearizations!;
      expect(Object.keys(lins).sort()).toEqual(["eadie_hofstee", "hanes_woolf", "lineweaver_burk"]);
      // The line must come from the fitted Vmax/KM, not from a regression on these axes.
      expect(lins["lineweaver_burk"]!.slope).toBeCloseTo(KM / VMAX, 6);
      expect(lins["lineweaver_burk"]!.intercept).toBeCloseTo(1 / VMAX, 6);
      expect(lins["eadie_hofstee"]!.slope).toBeCloseTo(-KM, 6);
      expect(lins["hanes_woolf"]!.slope).toBeCloseTo(1 / VMAX, 6);
      // …and the points must be the transformed data.
      for (let i = 0; i < S.length; i++) {
        expect(lins["lineweaver_burk"]!.x[i]).toBeCloseTo(1 / S[i]!, 6);
        expect(lins["hanes_woolf"]!.y[i]).toBeCloseTo(S[i]! / v[i]!, 6);
      }
      const term = (t: string) => r.terms.find((row) => row.term === t)?.estimate;
      expect(term("Lineweaver-Burk slope (KM/Vmax)")).toBeCloseTo(KM / VMAX, 6);
      expect(term("Eadie-Hofstee slope (−KM)")).toBeCloseTo(-KM, 6);

      // kcat is the same hyperbola reparameterised — Vmax = Et·kcat — so it must produce
      // the identical linearization, which is the check that mm_constants is right there.
      const rk = (await s.request("curvefit", { model: "kcat", x: S, y: v, fixed: { Et: 2 } })) as unknown as Res;
      expect(rk.extra.linearizations!["lineweaver_burk"]!.intercept).toBeCloseTo(1 / VMAX, 6);
      expect(rk.extra.linearizations!["hanes_woolf"]!.slope).toBeCloseTo(1 / VMAX, 6);

      // A non-enzyme model must not carry the block.
      const r4 = (await s.request("curvefit", { model: "onesite", x: S, y: v })) as unknown as Res;
      expect(r4.extra.linearizations).toBeUndefined();
    } finally {
      await s.stop();
    }
  }, 30_000);

  it("curvetransform: the three Michaelis-Menten linearizations recover Vmax/KM exactly", async () => {
    const s = sup();
    try {
      type Res = {
        extra: { curve: { x: number[]; y: number[]; xTitle: string; yTitle: string } };
        glance: Record<string, number>;
        warnings?: string[];
      };
      // Noise-free MM data: Vmax = 100, KM = 5. On exact data every linearization is an
      // exact straight line, so all three must return the same constants — that is the
      // strongest available check that each rearrangement is algebraically right.
      const VMAX = 100, KM = 5;
      const S = [1, 2, 5, 10, 20, 35, 50, 75, 100];
      const v = S.map((si) => (VMAX * si) / (KM + si));

      const lb = (await s.request("curvetransform", { x: S, y: v, variant: "lineweaver_burk" })) as unknown as Res;
      expect(lb.glance["vmax"]).toBeCloseTo(VMAX, 6);
      expect(lb.glance["km"]).toBeCloseTo(KM, 6);
      expect(lb.extra.curve.xTitle).toBe("1 / [S]");
      expect(lb.extra.curve.yTitle).toBe("1 / v");
      // Axes really are the reciprocals, not the raw data.
      for (let i = 0; i < S.length; i++) {
        expect(lb.extra.curve.x[i]).toBeCloseTo(1 / S[i]!, 6);
        expect(lb.extra.curve.y[i]).toBeCloseTo(1 / v[i]!, 6);
      }
      // slope = KM/Vmax, intercept = 1/Vmax
      expect(lb.glance["slope"]).toBeCloseTo(KM / VMAX, 6);
      expect(lb.glance["intercept"]).toBeCloseTo(1 / VMAX, 6);

      const eh = (await s.request("curvetransform", { x: S, y: v, variant: "eadie_hofstee" })) as unknown as Res;
      expect(eh.glance["vmax"]).toBeCloseTo(VMAX, 6);
      expect(eh.glance["km"]).toBeCloseTo(KM, 6);
      expect(eh.glance["slope"]).toBeCloseTo(-KM, 6); // slope is −KM
      expect(eh.extra.curve.xTitle).toBe("v / [S]");
      for (let i = 0; i < S.length; i++) expect(eh.extra.curve.x[i]).toBeCloseTo(v[i]! / S[i]!, 6);

      const hw = (await s.request("curvetransform", { x: S, y: v, variant: "hanes_woolf" })) as unknown as Res;
      expect(hw.glance["vmax"]).toBeCloseTo(VMAX, 6);
      expect(hw.glance["km"]).toBeCloseTo(KM, 6);
      expect(hw.glance["slope"]).toBeCloseTo(1 / VMAX, 6); // slope is 1/Vmax
      expect(hw.extra.curve.yTitle).toBe("[S] / v");
      for (let i = 0; i < S.length; i++) expect(hw.extra.curve.y[i]).toBeCloseTo(S[i]! / v[i]!, 6);

      // Every linearization must carry the "diagnostic, not an estimator" warning.
      for (const r of [lb, eh, hw]) expect((r.warnings ?? []).join(" ")).toMatch(/diagnostic|not valid|descriptive/i);
    } finally {
      await s.stop();
    }
  }, 20_000);

  it("curvetransform linearizations: undefined points are dropped, not silently NaN", async () => {
    const s = sup();
    try {
      type Res = { extra: { curve: { x: number[]; y: number[] } }; glance: Record<string, number>; summary: string };
      // S = 0 is undefined for all three (÷[S]); v = 0 is undefined for LB and HW (÷v).
      const S = [0, 1, 2, 5, 10, 20, 50];
      const v = [0, 16.7, 28.6, 50, 66.7, 80, 90.9];

      const lb = (await s.request("curvetransform", { x: S, y: v, variant: "lineweaver_burk" })) as unknown as Res;
      expect(lb.glance["dropped"]).toBe(1); // the (0, 0) point
      expect(lb.extra.curve.x.length).toBe(6);
      expect(lb.extra.curve.x.every((n) => Number.isFinite(n))).toBe(true);
      expect(lb.extra.curve.y.every((n) => Number.isFinite(n))).toBe(true);
      expect(lb.summary).toMatch(/dropped/i);

      // Eadie-Hofstee divides only by [S], so v = 0 is a legitimate point at the origin.
      // Here S=0 still goes, but a v=0 point at S>0 must be kept.
      const eh = (await s.request("curvetransform", { x: [1, 2, 5, 10], y: [0, 28.6, 50, 66.7], variant: "eadie_hofstee" })) as unknown as Res;
      expect(eh.glance["dropped"]).toBe(0);
      expect(eh.extra.curve.x.length).toBe(4);
    } finally {
      await s.stop();
    }
  }, 20_000);

  it("interpolate: reads X-from-Y and Y-from-X off a standard curve (linear + 4PL)", async () => {
    const s = sup();
    try {
      type Row = { term: string; estimate: number | null; ciLow?: number; ciHigh?: number; note?: string };
      // Linear standard y = 2x + 1: Y=6 → X=2.5; X=2.5 → Y=6 (exact fit → CI collapses).
      const lin = (await s.request("interpolate", {
        model: "linear", x: [1, 2, 3, 4, 5], y: [3, 5, 7, 9, 11], unknownsY: [6, 99], unknownsX: [2.5],
      }))["terms"] as Row[];
      expect(lin[0]!.estimate).toBeCloseTo(2.5, 6);
      expect(lin[1]!.estimate).toBeNull(); // Y=99 is off the standard range
      expect(lin[1]!.note).toMatch(/range/);
      expect(lin[2]!.estimate).toBeCloseTo(6, 6);

      // 4PL standard (bottom 0, top 100, EC50 10, hill 1): the 50% response reads back X = EC50 = 10.
      const dose = [0.1, 0.3, 1, 3, 10, 30, 100, 300, 1000];
      const y = dose.map((dx) => 100 / (1 + 10 ** ((1 - Math.log10(dx)) * 1)));
      const fpl = (await s.request("interpolate", { model: "4pl", x: dose, y, unknownsY: [50] }))["terms"] as Row[];
      expect(fpl[0]!.estimate).toBeCloseTo(10, 1);
    } finally {
      await s.stop();
    }
  }, 20_000);

  it("curvefit registry: 3PL/5PL/MM/binding/exponential/Gaussian recover known parameters", async () => {
    const s = sup();
    try {
      const dose = [0.1, 0.3, 1, 3, 10, 30, 100, 300];
      const y4 = dose.map((dx) => 5 + 90 / (1 + 10 ** ((1 - Math.log10(dx)) * 1.2)));
      // 3PL (Hill = 1) + 5PL (asymmetry = 1) recover EC50 = 10 on the 4PL data.
      expect(((await s.request("curvefit", { model: "3pl", x: dose, y: y4 }))["glance"] as Record<string, number>)["EC50"]).toBeCloseTo(10, 0);
      expect(((await s.request("curvefit", { model: "5pl", x: dose, y: y4 }))["glance"] as Record<string, number>)["EC50"]).toBeCloseTo(10, 0);

      // Michaelis-Menten: Vmax = 100, KM = 5.
      const xm = [0.5, 1, 2, 4, 8, 16, 32, 64];
      const ym = xm.map((x) => (100 * x) / (5 + x));
      const gm = (await s.request("curvefit", { model: "mm", x: xm, y: ym }))["glance"] as Record<string, number>;
      expect(gm["vmax"]).toBeCloseTo(100, 2);
      expect(gm["km"]).toBeCloseTo(5, 3);

      // One-site binding shares the form with different labels (Bmax, Kd).
      const gb = (await s.request("curvefit", { model: "onesite", x: xm, y: ym }))["glance"] as Record<string, number>;
      expect(gb["bmax"]).toBeCloseTo(100, 2);
      expect(gb["kd"]).toBeCloseTo(5, 3);

      // One-phase decay: Y0=100, plateau=10, K=0.5 → half-life = ln2/0.5 ≈ 1.386.
      const xd = Array.from({ length: 15 }, (_, i) => i * (10 / 14));
      const yd = xd.map((x) => 10 + 90 * Math.exp(-0.5 * x));
      const gd = (await s.request("curvefit", { model: "exp_decay", x: xd, y: yd }))["glance"] as Record<string, number>;
      expect(gd["k"]).toBeCloseTo(0.5, 4);
      expect(gd["Half_life"]).toBeCloseTo(Math.LN2 / 0.5, 3);

      // Gaussian: A=50, mean=3, SD=1.5.
      const xg = Array.from({ length: 25 }, (_, i) => -2 + i * (10 / 24));
      const yg = xg.map((x) => 50 * Math.exp(-((x - 3) ** 2) / (2 * 1.5 ** 2)));
      const gg = (await s.request("curvefit", { model: "gaussian", x: xg, y: yg }))["glance"] as Record<string, number>;
      expect(gg["amplitude"]).toBeCloseTo(50, 2);
      expect(gg["mean"]).toBeCloseTo(3, 3);
      expect(gg["sd"]).toBeCloseTo(1.5, 3);

      // Weighting option is accepted + still recovers (1/Y²).
      const gw = (await s.request("curvefit", { model: "mm", x: xm, y: ym, weighting: "1/Y2" }))["glance"] as Record<string, number>;
      expect(gw["vmax"]).toBeCloseTo(100, 1);

      // Smoothing spline (model-free): frac 0 interpolates (R²≈1); a higher
      // smoothing factor loosens the fit (R² < 1) but stays close, and the curve samples.
      const sx = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
      const sy = [0.1, 0.9, 2.2, 2.8, 4.1, 5.2, 5.8, 7.1, 7.9, 9.2];
      const interp = (await s.request("curvefit", { model: "spline", x: sx, y: sy, frac: 0 }))["glance"] as Record<string, number>;
      expect(interp["r_sq"]).toBeCloseTo(1, 3);
      const smooth = await s.request("curvefit", { model: "spline", x: sx, y: sy, frac: 0.6 });
      const sg = smooth["glance"] as Record<string, number>;
      expect(sg["r_sq"]).toBeLessThan(1);
      expect(sg["r_sq"]).toBeGreaterThan(0.9);
      expect(smooth["title"]).toBe("Smoothing spline");
      expect((smooth["curve"] as { x: number[] }).x.length).toBe(120);
    } finally {
      await s.stop();
    }
  }, 30_000);

  it("curvefit / globalfit parameter constraints: fix-to-value + per-parameter bounds", async () => {
    const s = sup();
    try {
      const dose = [0.1, 0.3, 1, 3, 10, 30, 100, 300, 1000];
      const y4 = dose.map((d) => 100 / (1 + 10 ** ((1 - Math.log10(d)) * 1))); // Bottom0 Top100 EC50=10 Hill1
      const by = (r: Record<string, unknown>, t: string) =>
        (r["terms"] as Array<Record<string, unknown>>).find((z) => z["term"] === t) as Record<string, number>;

      // Single-curve: fix Bottom = 0 → reported as "Bottom (fixed)", the rest still recover (R²=1).
      const rf = await s.request("curvefit", { model: "4pl", x: dose, y: y4, fixed: { Bottom: 0 } });
      expect(by(rf, "Bottom (fixed)").estimate).toBe(0);
      expect(by(rf, "Top").estimate).toBeCloseTo(100, 2);
      expect((rf["glance"] as Record<string, number>)["r_sq"]).toBeCloseTo(1, 5);

      // Per-parameter bound: constrain the Hill slope to [0.5, 1.5]; the estimate stays inside.
      const rb = await s.request("curvefit", { model: "4pl", x: dose, y: y4, paramBounds: { "Hill slope": [0.5, 1.5] } });
      const hill = by(rb, "Hill slope").estimate;
      expect(hill).toBeGreaterThanOrEqual(0.5 - 1e-6);
      expect(hill).toBeLessThanOrEqual(1.5 + 1e-6);

      // Fixing every parameter is rejected (nothing left to fit).
      await expect(s.request("curvefit", { model: "onesite", x: dose, y: y4, fixed: { Bmax: 100, Kd: 10 } })).rejects.toThrow();

      // Global fit honours a per-parameter bound across the shared theta vector (converges).
      const ds = [0, 1, 2].map((k) => ({ label: `d${k}`, x: dose, y: dose.map((d) => 100 / (1 + 10 ** ((k - Math.log10(d)) * 1))) }));
      const rg = await s.request("globalfit", { model: "4pl", datasets: ds, shared: ["Bottom", "Top", "Hill slope"], paramBounds: { logEC50: [-1, 3] } });
      expect((rg["glance"] as Record<string, number>)["r_sq"]).toBeCloseTo(1, 3);

      // Homologous competition (the constraints mechanism in action): fix Hot → the confounded
      // Kd/Hot pair separates, so Bmax/logKd/NS recover the known truth at R²=1.
      const cold = Array.from({ length: 14 }, (_, i) => 10 ** (-2 + (6 * i) / 13));
      const yh = cold.map((c) => (100 * 2) / (2 + c + 10) + 5); // Bmax100 Kd10(logKd1) NS5 Hot2
      const rh = await s.request("curvefit", { model: "homologous_competition", x: cold, y: yh, fixed: { Hot: 2 } });
      expect(by(rh, "Bmax").estimate).toBeCloseTo(100, 1);
      expect(by(rh, "logKd").estimate).toBeCloseTo(1, 2);
      expect(by(rh, "NS").estimate).toBeCloseTo(5, 1);
      expect((rh["glance"] as Record<string, number>)["r_sq"]).toBeCloseTo(1, 4);

      // Motulsky-Mahan competitive binding kinetics — a global fit across
      // [I] with L fixed recovers every rate constant + Bmax at R²=1.
      const mm = (t: number, L: number, I: number, k1: number, k2: number, k3: number, k4: number, bmax: number): number => {
        const KA = k1 * L + k2, KB = k3 * I + k4;
        const S = Math.sqrt((KA - KB) ** 2 + 4 * k1 * k3 * L * I);
        const KF = 0.5 * (KA + KB + S), KS = 0.5 * (KA + KB - S), dd = KF - KS;
        const Q = (bmax * k1 * L) / dd;
        return Q * ((k4 * dd) / (KF * KS) + ((k4 - KF) / KF) * Math.exp(-KF * t) - ((k4 - KS) / KS) * Math.exp(-KS * t));
      };
      const tt = [0.1, 0.3, 0.5, 1, 2, 3, 5, 8, 12, 20];
      const dsm = [0, 0.5, 2, 10].map((I) => ({ label: `I=${I}`, x: tt, y: tt.map((t) => mm(t, 1, I, 2, 0.2, 1, 0.05, 100)), consts: [I] }));
      const rm = await s.request("globalfit", { model: "motulsky_mahan", datasets: dsm, shared: ["kon_L", "koff_L", "kon_I", "koff_I", "Bmax"], fixed: { L: 1 } });
      const shm = (t: string) => (rm["terms"] as Array<Record<string, unknown>>).find((z) => z["term"] === t) as Record<string, number>;
      expect(shm("kon_L (shared)").estimate).toBeCloseTo(2, 2);
      expect(shm("Bmax (shared)").estimate).toBeCloseTo(100, 1);
      expect((rm["glance"] as Record<string, number>)["r_sq"]).toBeCloseTo(1, 3);
    } finally {
      await s.stop();
    }
  }, 30_000);

  it("montecarlo: recovers 'true' params, quantifies their SD, reproducible + guarded", async () => {
    const s = sup();
    const term = (r: Record<string, unknown>, t: string) =>
      (r["terms"] as Array<Record<string, unknown>>).find((z) => z["term"] === t) as Record<string, number>;
    try {
      // Michaelis-Menten: true Vmax=100 / KM=10, a 12-point design, SD=5 scatter, 300 iterations.
      const spec = { model: "mm", trueParams: [100, 10], xStart: 1, xEnd: 100, xCount: 12, noise: { type: "sd", value: 5 }, iterations: 300, seed: 42 };
      const r = await s.request("montecarlo", spec);
      expect((r["glance"] as Record<string, number>)["converged"]).toBeGreaterThan(280);
      const vmax = term(r, "Vmax");
      expect(vmax["estimate"]).toBeCloseTo(100, 0); // mean of the fits ≈ true (unbiased design)
      expect(term(r, "KM")["estimate"]).toBeCloseTo(10, 0);
      expect(vmax["true"]).toBe(100);
      expect(Math.abs(vmax["bias"]!)).toBeLessThan(1.5); // small bias
      expect(vmax["sd"]!).toBeGreaterThan(0); // a real spread of fitted values
      expect(vmax["ciLow"]!).toBeLessThan(100); // the 95% CI brackets the truth
      expect(vmax["ciHigh"]!).toBeGreaterThan(100);
      // reproducible in the seed
      expect((await s.request("montecarlo", spec))["terms"]).toEqual(r["terms"]);
      // More noise → a wider parameter SD.
      const noisier = await s.request("montecarlo", { ...spec, noise: { type: "sd", value: 15 } });
      expect(term(noisier, "Vmax")["sd"]!).toBeGreaterThan(vmax["sd"]!);
      // The relative-noise, xLog, and replicates code paths.
      const rel = await s.request("montecarlo", { ...spec, noise: { type: "relative", value: 10 } });
      expect(term(rel, "Vmax")["estimate"]).toBeCloseTo(100, 0); // recovers the truth under relative noise
      expect(term(rel, "Vmax")["sd"]!).toBeGreaterThan(0);
      const dose = { model: "4pl", trueParams: [0, 100, 1, 1], xStart: 0.1, xEnd: 1000, xCount: 8, xLog: true, noise: { type: "sd", value: 5 }, iterations: 200, seed: 7 };
      const rlog = await s.request("montecarlo", dose);
      expect((rlog["glance"] as Record<string, number>)["converged"]).toBeGreaterThan(150); // log-spaced X design runs
      const reps = await s.request("montecarlo", { ...spec, replicates: 3, iterations: 100 });
      expect((reps["glance"] as Record<string, number>)["converged"]).toBeGreaterThan(80); // replicate observations per point
      // Guard: a wrong 'true'-parameter count is a typed error.
      await expect(s.request("montecarlo", { model: "mm", trueParams: [100], noise: { type: "sd", value: 1 } })).rejects.toThrow();
    } finally {
      await s.stop();
    }
  }, 30_000);

  it("corrmatrix: K×K Pearson/Spearman r + R² matrix", async () => {
    const s = sup();
    try {
      // A: 1..7; B tracks A (r≈+1); C reverses A (r≈−1).
      const A = [1, 2, 3, 4, 5, 6, 7];
      const B = [2.1, 3.9, 6.2, 7.8, 10.1, 12.0, 13.9];
      const C = [7, 6, 5, 4, 3, 2, 1];
      const r = await s.request("corrmatrix", { columns: [A, B, C], labels: ["A", "B", "C"], variant: "pearson" });
      const by = (res: Record<string, unknown>, t: string) => (res["terms"] as Array<Record<string, number | string>>).find((z) => z.term === t)!;
      expect(by(r, "A vs B").estimate as number).toBeCloseTo(0.9997, 3); // near-perfect positive
      expect(by(r, "A vs C").estimate as number).toBeCloseTo(-1.0, 6); // exact reversal
      expect(by(r, "A vs C").r2 as number).toBeCloseTo(1.0, 6);
      const mat = (r["extra"] as { matrix: { r: number[][] } }).matrix.r;
      expect(mat[0]![0]).toBe(1.0); // unit diagonal
      expect(mat[0]![2]).toBeCloseTo(-1.0, 6); // symmetric off-diagonal
      // Spearman on a monotonic-but-nonlinear pair → ρ = 1.
      const sp = await s.request("corrmatrix", { columns: [A, [1, 4, 9, 16, 25, 36, 49], C], labels: ["A", "Asq", "C"], variant: "spearman" });
      expect(by(sp, "A vs Asq").estimate as number).toBeCloseTo(1.0, 6);
    } finally {
      await s.stop();
    }
  }, 20_000);

  it("curvefit registry: allosteric/inhibition/Hill/2-phase/Boltzmann/poly/line/Lorentzian", async () => {
    const s = sup();
    try {
      const lin = (x: number[]) => x;
      // Allosteric sigmoidal: Vmax=100, Khalf=10, h=2.
      const xa = [1, 2, 4, 7, 10, 15, 20, 30, 50];
      const ya = xa.map((x) => (100 * x ** 2) / (10 ** 2 + x ** 2));
      const ga = (await s.request("curvefit", { model: "allosteric", x: lin(xa), y: ya }))["glance"] as Record<string, number>;
      expect(ga["vmax"]).toBeCloseTo(100, 2); expect(ga["khalf"]).toBeCloseTo(10, 3); expect(ga["h"]).toBeCloseTo(2, 3);

      // Substrate inhibition: Vmax=200, KM=5, Ki=50.
      const xs = [1, 2, 5, 10, 20, 40, 80, 150];
      const ys = xs.map((x) => (200 * x) / (5 + x * (1 + x / 50)));
      const gi = (await s.request("curvefit", { model: "substrate_inhibition", x: xs, y: ys }))["glance"] as Record<string, number>;
      expect(gi["vmax"]).toBeCloseTo(200, 1); expect(gi["ki"]).toBeCloseTo(50, 2);

      // Two-phase decay: plateau=5, fast K=2, slow K=0.2.
      const xd = Array.from({ length: 60 }, (_, i) => i * (25 / 59));
      const yd = xd.map((x) => 5 + 60 * Math.exp(-2 * x) + 35 * Math.exp(-0.2 * x));
      const gd = (await s.request("curvefit", { model: "exp_decay2", x: xd, y: yd }))["glance"] as Record<string, number>;
      expect(gd["kfast"]).toBeCloseTo(2, 2); expect(gd["kslow"]).toBeCloseTo(0.2, 3); expect(gd["r_sq"]).toBeCloseTo(1, 5);

      // Boltzmann: bottom 0, top 100, V50 10, slope 3.
      const xb = Array.from({ length: 30 }, (_, i) => -5 + i * (30 / 29));
      const yb = xb.map((x) => 100 / (1 + Math.exp((10 - x) / 3)));
      const gb = (await s.request("curvefit", { model: "boltzmann", x: xb, y: yb }))["glance"] as Record<string, number>;
      expect(gb["v50"]).toBeCloseTo(10, 3); expect(gb["slope"]).toBeCloseTo(3, 3);

      // Quadratic + cubic + line-through-origin + Lorentzian.
      const xp = Array.from({ length: 20 }, (_, i) => -3 + i * (6 / 19));
      const g2 = (await s.request("curvefit", { model: "poly2", x: xp, y: xp.map((x) => 3 + 2 * x - 0.5 * x ** 2) }))["glance"] as Record<string, number>;
      expect(g2["b0"]).toBeCloseTo(3, 6); expect(g2["b2"]).toBeCloseTo(-0.5, 6);
      const g3 = (await s.request("curvefit", { model: "poly3", x: xp, y: xp.map((x) => 1 - 2 * x + 0.3 * x ** 2 + 0.1 * x ** 3) }))["glance"] as Record<string, number>;
      expect(g3["b3"]).toBeCloseTo(0.1, 6);
      const go = (await s.request("curvefit", { model: "line_origin", x: [1, 2, 3, 4, 5], y: [3, 6, 9, 12, 15] }))["glance"] as Record<string, number>;
      expect(go["slope"]).toBeCloseTo(3, 6);
      const xl = Array.from({ length: 30 }, (_, i) => -5 + i * (10 / 29));
      const gl = (await s.request("curvefit", { model: "lorentzian", x: xl, y: xl.map((x) => 40 / (1 + ((x - 1) / 2) ** 2)) }))["glance"] as Record<string, number>;
      expect(gl["amplitude"]).toBeCloseTo(40, 2); expect(gl["center"]).toBeCloseTo(1, 3); expect(gl["width"]).toBeCloseTo(2, 3);
    } finally {
      await s.stop();
    }
  }, 30_000);

  it("curvefit registry: binding/dose-conc/growth/peak/power/periodic recover known parameters", async () => {
    const s = sup();
    const g = async (model: string, x: number[], y: number[]) =>
      (await s.request("curvefit", { model, x, y }))["glance"] as Record<string, number>;
    try {
      const xc = Array.from({ length: 40 }, (_, i) => 0.5 + i * (20 / 39));
      // Binding
      const gts = await g("twosite", xc, xc.map((x) => (3 * x) / (0.5 + x) + (5 * x) / (8 + x)));
      expect(gts["r_sq"]).toBeCloseTo(1, 4); // two-site is order-ambiguous → check fit quality
      const gns = await g("onesite_ns", xc, xc.map((x) => (10 * x) / (2 + x) + 0.2 * x));
      expect(gns["kd"]).toBeCloseTo(2, 2); expect(gns["ns"]).toBeCloseTo(0.2, 3);
      const gho = await g("hyperbola_offset", xc, xc.map((x) => 1 + (9 * x) / (3 + x)));
      expect(gho["background"]).toBeCloseTo(1, 2); expect(gho["kd"]).toBeCloseTo(3, 2);
      // Dose-response (X = concentration)
      const g3c = await g("dr_3pl_conc", xc, xc.map((x) => 2 + (18 * x) / (5 + x)));
      expect(g3c["ec50"]).toBeCloseTo(5, 2);
      const g4c = await g("dr_4pl_conc", xc, xc.map((x) => 2 + (18 * x ** 1.5) / (5 ** 1.5 + x ** 1.5)));
      expect(g4c["ec50"]).toBeCloseTo(5, 2); expect(g4c["hill_slope"]).toBeCloseTo(1.5, 2);
      // Exponential (two-phase association)
      const gba = await g("biexp_assoc", xc, xc.map((x) => 1 + 6 * (1 - Math.exp(-0.8 * x)) + 4 * (1 - Math.exp(-0.1 * x))));
      expect(gba["r_sq"]).toBeCloseTo(1, 4);
      // Growth
      const grc = await g("richards", xc, xc.map((x) => 100 / (1 + 1 * Math.exp(-0.5 * (x - 10))) ** (1 / 1)));
      expect(grc["asymptote"]).toBeCloseTo(100, 1);
      const gwb = await g("weibull_growth", xc, xc.map((x) => 50 * (1 - Math.exp(-((x / 6) ** 1.5)))));
      expect(gwb["asymptote"]).toBeCloseTo(50, 1); expect(gwb["shape"]).toBeCloseTo(1.5, 2);
      const gvb = await g("von_bertalanffy", xc, xc.map((x) => 40 * (1 - Math.exp(-0.2 * (x - -1)))));
      expect(gvb["linf"]).toBeCloseTo(40, 1);
      // Peak
      const ggb = await g("gaussian_baseline", xc, xc.map((x) => 2 + 8 * Math.exp(-((x - 10) ** 2) / (2 * 3 ** 2))));
      expect(ggb["mean"]).toBeCloseTo(10, 2); expect(ggb["sd"]).toBeCloseTo(3, 2); expect(ggb["baseline"]).toBeCloseTo(2, 2);
      const gln = await g("lognormal_peak", xc, xc.map((x) => 10 * Math.exp(-(Math.log(x / 8) ** 2) / (2 * 0.5 ** 2))));
      expect(gln["center"]).toBeCloseTo(8, 2); expect(gln["r_sq"]).toBeCloseTo(1, 4);
      // Polynomial (higher order)
      const gp4 = await g("poly4", xc, xc.map((x) => 1 + 2 * x - 0.3 * x ** 2 + 0.02 * x ** 3 - 0.0004 * x ** 4));
      expect(gp4["r_sq"]).toBeCloseTo(1, 5);
      const gp5 = await g("poly5", xc, xc.map((x) => 1 + 2 * x - 0.3 * x ** 2 + 0.02 * x ** 3 - 0.0004 * x ** 4 + 1e-6 * x ** 5));
      expect(gp5["r_sq"]).toBeCloseTo(1, 5);
      // Power
      const gpw = await g("power", xc, xc.map((x) => 2.5 * x ** 1.3));
      expect(gpw["a"]).toBeCloseTo(2.5, 2); expect(gpw["b"]).toBeCloseTo(1.3, 3);
      const gpo = await g("power_offset", xc, xc.map((x) => 2.5 * x ** 1.3 + 4));
      expect(gpo["c"]).toBeCloseTo(4, 1); expect(gpo["r_sq"]).toBeCloseTo(1, 4);
      // Periodic
      const xsn = Array.from({ length: 60 }, (_, i) => i * (12 / 59));
      const gsn = await g("sine", xsn, xsn.map((x) => 3 + 2 * Math.sin((2 * Math.PI * x) / 5 + 0.4)));
      expect(gsn["period"]).toBeCloseTo(5, 2); expect(gsn["r_sq"]).toBeCloseTo(1, 4);
    } finally {
      await s.stop();
    }
  }, 30_000);

  it("curvefit registry: decay-variants/growth-4P/inhibition/peaks/simple recover known parameters", async () => {
    const s = sup();
    const g = async (model: string, x: number[], y: number[]) =>
      (await s.request("curvefit", { model, x, y }))["glance"] as Record<string, number>;
    try {
      const x = Array.from({ length: 45 }, (_, i) => 0.5 + i * (20 / 44));
      // Exponential variants
      const gel = await g("exp_linear", x, x.map((v) => 5 * Math.exp(-0.5 * v) + 0.3 * v + 2));
      expect(gel["r_sq"]).toBeCloseTo(1, 4);
      const ge3 = await g("exp_decay3", x, x.map((v) => 2 + 30 * Math.exp(-1.5 * v) + 20 * Math.exp(-0.4 * v) + 10 * Math.exp(-0.08 * v)));
      expect(ge3["r_sq"]).toBeCloseTo(1, 4); // three-phase (well-separated rates)
      const gse = await g("stretched_exp", x, x.map((v) => 10 * Math.exp(-((v / 6) ** 1.4))));
      expect(gse["beta"]).toBeCloseTo(1.4, 2);
      // Growth (4-parameter)
      const gl4 = await g("logistic4_growth", x, x.map((v) => 5 + 95 / (1 + Math.exp(-0.6 * (v - 10)))));
      expect(gl4["midpoint"]).toBeCloseTo(10, 2); expect(gl4["top"]).toBeCloseTo(100, 1);
      const gg4 = await g("gompertz4", x, x.map((v) => 3 + 50 * Math.exp(-Math.exp(-0.4 * (v - 8)))));
      expect(gg4["r_sq"]).toBeCloseTo(1, 4);
      const gcr = await g("chapman_richards", x, x.map((v) => 60 * (1 - Math.exp(-0.25 * v)) ** 1.4));
      expect(gcr["asymptote"]).toBeCloseTo(60, 0);
      // Inhibition dose-response (X = concentration)
      const gic = await g("ic50_4pl_conc", x, x.map((v) => 10 + 80 / (1 + (v / 6) ** 1.3)));
      expect(gic["ic50"]).toBeCloseTo(6, 1);
      // Peaks
      const xg = Array.from({ length: 60 }, (_, i) => i * (30 / 59));
      const gp2 = await g("gaussian2", xg, xg.map((v) => 8 * Math.exp(-((v - 8) ** 2) / (2 * 2 ** 2)) + 6 * Math.exp(-((v - 20) ** 2) / (2 * 3 ** 2))));
      expect(gp2["r_sq"]).toBeCloseTo(1, 4);
      const xv = Array.from({ length: 60 }, (_, i) => -5 + i * (20 / 59));
      const gpv = await g("pseudo_voigt", xv, xv.map((v) => 0.5 * (10 / (1 + ((v - 5) / 2) ** 2)) + 0.5 * (10 * Math.exp(-((v - 5) ** 2) / (2 * 2 ** 2)))));
      expect(gpv["center"]).toBeCloseTo(5, 2); expect(gpv["r_sq"]).toBeCloseTo(1, 4);
      // Periodic (damped)
      const xd = Array.from({ length: 80 }, (_, i) => i * (12 / 79));
      const gds = await g("damped_sine", xd, xd.map((v) => 3 + 4 * Math.exp(-0.2 * v) * Math.sin((2 * Math.PI * v) / 3 + 0.5)));
      expect(gds["period"]).toBeCloseTo(3, 2); expect(gds["r_sq"]).toBeCloseTo(1, 4);
      // Simple forms
      const glg = await g("logarithmic", x, x.map((v) => 2 + 3 * Math.log(v)));
      expect(glg["a"]).toBeCloseTo(2, 3); expect(glg["b"]).toBeCloseTo(3, 3);
      const grc = await g("reciprocal", x, x.map((v) => 1 + 8 / v));
      expect(grc["a"]).toBeCloseTo(1, 3); expect(grc["b"]).toBeCloseTo(8, 3);
      const grt = await g("rational11", x, x.map((v) => (2 + 3 * v) / (1 + 0.2 * v)));
      expect(grt["r_sq"]).toBeCloseTo(1, 5);
      const gsq = await g("sqrt_fit", x, x.map((v) => 1 + 2 * Math.sqrt(v)));
      expect(gsq["a"]).toBeCloseTo(1, 3); expect(gsq["b"]).toBeCloseTo(2, 3);
      const gp6 = await g("poly6", x, x.map((v) => 1 + 0.5 * v - 0.1 * v ** 2 + 0.01 * v ** 3 - 4e-4 * v ** 4 + 7e-6 * v ** 5 - 4e-8 * v ** 6));
      expect(gp6["r_sq"]).toBeCloseTo(1, 5);
    } finally {
      await s.stop();
    }
  }, 30_000);

  it("curvefit registry: normalized/inhibition DR, biphasic/bell, competition/total binding, plateau-phase, segmental, MMF, 3-Gaussian recover known parameters", async () => {
    const s = sup();
    const g = async (model: string, x: number[], y: number[]) =>
      (await s.request("curvefit", { model, x, y }))["glance"] as Record<string, number>;
    const geo = (n: number, a: number, b: number) =>
      Array.from({ length: n }, (_, i) => 10 ** (Math.log10(a) + (Math.log10(b) - Math.log10(a)) * (i / (n - 1))));
    const lin = (n: number, a: number, b: number) => Array.from({ length: n }, (_, i) => a + (b - a) * (i / (n - 1)));
    try {
      // Dose-response — normalized (Bottom/Top fixed at 0/100); EC50 is a derived (upper-case) key.
      const xd = geo(12, 0.1, 1000);
      const gn3 = await g("dr_norm_3pl", xd, xd.map((v) => (100 * v) / (v + 10)));
      expect(gn3["EC50"]).toBeCloseTo(10, 0);
      const gn4 = await g("dr_norm_4pl", xd, xd.map((v) => (100 * v ** 2) / (v ** 2 + 100)));
      expect(gn4["EC50"]).toBeCloseTo(10, 0); expect(gn4["hill_slope"]).toBeCloseTo(2, 1);
      const xnc = lin(40, 0.5, 30);
      const gnc = await g("dr_norm_4pl_conc", xnc, xnc.map((v) => (100 * v ** 1.5) / (5 ** 1.5 + v ** 1.5)));
      expect(gnc["ec50"]).toBeCloseTo(5, 1); expect(gnc["hill_slope"]).toBeCloseTo(1.5, 1);
      // Dose-response — inhibition (decreasing); IC50 derived (log forms) or direct (conc form).
      const gi4 = await g("ic50_4pl_log", xd, xd.map((v) => 10 + 90 / (1 + 10 ** ((Math.log10(v) - 1) * 1.5))));
      expect(gi4["IC50"]).toBeCloseTo(10, 0);
      const gi3 = await g("ic50_3pl_log", xd, xd.map((v) => 5 + 90 / (1 + 10 ** (Math.log10(v) - 0.7))));
      expect(gi3["IC50"]).toBeCloseTo(10 ** 0.7, 1);
      const xicc = lin(40, 0.5, 60);
      const gicc = await g("ic50_3pl_conc", xicc, xicc.map((v) => 5 + 90 / (1 + v / 8)));
      expect(gicc["ic50"]).toBeCloseTo(8, 1);
      // 5PL asymmetric (concentration): hill/asymmetry trade off → assert fit quality + EC50 bracket.
      const x5 = lin(45, 0.5, 60);
      const g5 = await g("dr_5pl_conc", x5, x5.map((v) => 100 / (1 + (10 / v) ** 1.2) ** 2));
      expect(g5["r_sq"]).toBeCloseTo(1, 4); expect(g5["ec50"]).toBeGreaterThan(3); expect(g5["ec50"]).toBeLessThan(30);
      // Biphasic + bell-shaped (well-separated components) — derived EC50s.
      const xbi = geo(30, 1e-3, 1e4);
      const gbi = await g("biphasic_dr", xbi, xbi.map((v) => 100 * (0.5 / (1 + 10 ** (-1 - Math.log10(v))) + 0.5 / (1 + 10 ** (2 - Math.log10(v))))));
      expect(gbi["r_sq"]).toBeCloseTo(1, 4);
      expect(gbi["EC50_1"]).toBeCloseTo(0.1, 2);
      expect(gbi["EC50_2"]).toBeGreaterThan(80); expect(gbi["EC50_2"]).toBeLessThan(120);
      const xbe = geo(40, 1e-2, 1e4);
      const gbe = await g("bell_dr", xbe, xbe.map((v) => 100 * (1 / (1 + 10 ** (0 - Math.log10(v)))) * (1 / (1 + 10 ** (Math.log10(v) - 2)))));
      expect(gbe["r_sq"]).toBeCloseTo(1, 3);
      expect(gbe["EC50_up"]).toBeCloseTo(1, 1);
      expect(gbe["EC50_down"]).toBeGreaterThan(80); expect(gbe["EC50_down"]).toBeLessThan(120);
      // Competition binding (X = log[competitor]).
      const xk = lin(30, -9, -4);
      const gc1 = await g("competition_1site", xk, xk.map((v) => 100 + 900 / (1 + 10 ** (v + 7))));
      expect(gc1["logic50"]).toBeCloseTo(-7, 1);
      const xk2 = lin(40, -10, -4);
      const gc2 = await g("competition_2site", xk2, xk2.map((v) => 100 + 900 * (0.5 / (1 + 10 ** (v + 8)) + 0.5 / (1 + 10 ** (v + 6)))));
      expect(gc2["r_sq"]).toBeCloseTo(1, 3);
      // One-site total binding (specific + nonspecific + background).
      const xt = lin(40, 0.5, 60);
      const gt = await g("total_binding", xt, xt.map((v) => 5 + (20 * v) / (3 + v) + 0.5 * v));
      expect(gt["kd"]).toBeCloseTo(3, 1); expect(gt["bmax"]).toBeCloseTo(20, 0); expect(gt["ns"]).toBeCloseTo(0.5, 1);
      // Plateau then a phase (piecewise at X0).
      const xp = lin(60, 0, 15);
      const gpd = await g("plateau_then_decay", xp, xp.map((v) => (v < 3 ? 10 : 2 + 8 * Math.exp(-0.8 * (v - 3)))));
      expect(gpd["x0"]).toBeCloseTo(3, 1); expect(gpd["plateau"]).toBeCloseTo(2, 1); expect(gpd["k"]).toBeCloseTo(0.8, 1);
      const gpa = await g("plateau_then_assoc", xp, xp.map((v) => (v < 2 ? 1 : 1 + 9 * (1 - Math.exp(-0.5 * (v - 2))))));
      expect(gpa["x0"]).toBeCloseTo(2, 1); expect(gpa["plateau"]).toBeCloseTo(10, 0);
      // Association then dissociation (surge; rate assignment ambiguous → quality only).
      const xs = lin(80, 0, 20);
      const gad = await g("assoc_then_dissoc", xs, xs.map((v) => 10 * (Math.exp(-0.2 * v) - Math.exp(-1.0 * v))));
      expect(gad["r_sq"]).toBeCloseTo(1, 4);
      // Segmental (broken-line / hockey-stick).
      const xseg = lin(50, 0, 10);
      const gsg = await g("segmental", xseg, xseg.map((v) => (v < 5 ? 10 + 2 * (v - 5) : 10 - 1 * (v - 5))));
      expect(gsg["x0"]).toBeCloseTo(5, 1); expect(gsg["slope1"]).toBeCloseTo(2, 1); expect(gsg["slope2"]).toBeCloseTo(-1, 1);
      // Morgan-Mercer-Flodin growth (half-max at x = 10).
      const xm = lin(45, 0, 40);
      const gm = await g("mmf_growth", xm, xm.map((v) => (2 * 100 + 50 * v ** 2) / (100 + v ** 2)));
      expect(gm["asymptote"]).toBeCloseTo(50, 0); expect(gm["y0"]).toBeCloseTo(2, 1);
      // Sum of three Gaussians (separated peaks).
      const xg3 = lin(90, 0, 30);
      const gg3 = await g("gaussian3", xg3, xg3.map((v) => 8 * Math.exp(-((v - 5) ** 2) / (2 * 1.5 ** 2)) + 10 * Math.exp(-((v - 15) ** 2) / (2 * 1.5 ** 2)) + 6 * Math.exp(-((v - 25) ** 2) / (2 * 1.5 ** 2))));
      expect(gg3["r_sq"]).toBeCloseTo(1, 4);
    } finally {
      await s.stop();
    }
  }, 30_000);

  it("curvefit registry: Morrison/depletion, Voigt/EMG/Pearson-VII peaks, harmonic/drift sine, double-Boltzmann, power-cutoff, probit/Weibull/conc-biphasic·bell/Richards/hormesis recover known parameters", async () => {
    const s = sup();
    const g = async (model: string, x: number[], y: number[]) =>
      (await s.request("curvefit", { model, x, y }))["glance"] as Record<string, number>;
    const lin = (n: number, a: number, b: number) => Array.from({ length: n }, (_, i) => a + (b - a) * (i / (n - 1)));
    const geo = (n: number, a: number, b: number) =>
      Array.from({ length: n }, (_, i) => 10 ** (Math.log10(a) + (Math.log10(b) - Math.log10(a)) * (i / (n - 1))));
    // Voigt / EMG / probit need special functions (Faddeeva / erfcx / normal-CDF) JS lacks →
    // exact data computed in Python (scipy.special.wofz / erfc / ndtr).
    const VOIGT_X = [-4, -3.21739, -2.43478, -1.65217, -0.869565, -0.0869565, 0.695652, 1.47826, 2.26087, 3.04348, 3.82609, 4.6087, 5.3913, 6.17391, 6.95652, 7.73913, 8.52174, 9.30435, 10.087, 10.8696, 11.6522, 12.4348, 13.2174, 14];
    const VOIGT_Y = [0.072975, 0.0881912, 0.108834, 0.137919, 0.181012, 0.249615, 0.372115, 0.636024, 1.32591, 3.09398, 6.35739, 9.49481, 9.49481, 6.35739, 3.09398, 1.32591, 0.636024, 0.372115, 0.249615, 0.181012, 0.137919, 0.108834, 0.0881912, 0.072975];
    const EMG_X = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25];
    const EMG_Y = [8.79717e-15, 1.79606e-11, 1.37106e-08, 3.93214e-06, 0.000426726, 0.0177208, 0.286907, 1.87218, 5.24428, 7.12852, 5.83519, 3.76904, 2.29979, 1.39521, 0.846242, 0.513272, 0.311315, 0.188822, 0.114526, 0.0694638, 0.0421319, 0.0255543, 0.0154995, 0.0094009, 0.00570193, 0.0034584];
    const PROBIT_X = [0, 1.14286, 2.28571, 3.42857, 4.57143, 5.71429, 6.85714, 8, 9.14286, 10.2857, 11.4286, 12.5714, 13.7143, 14.8571, 16, 17.1429, 18.2857, 19.4286, 20.5714, 21.7143, 22.8571, 24];
    const PROBIT_Y = [0.042906, 0.157667, 0.5064, 1.42449, 3.51848, 7.65637, 14.7407, 25.2493, 38.7548, 53.7937, 68.3031, 80.4317, 89.216, 94.7281, 97.725, 99.1366, 99.7127, 99.9163, 99.9787, 99.9953, 99.9991, 99.9998];
    try {
      // Enzyme (tight-binding) + binding with depletion — quadratic-solution models.
      const xi = lin(40, 0, 20);
      const gmk = await g("morrison_ki", xi, xi.map((i) => 100 * (1 - ((5 + i + 2) - Math.sqrt(Math.max((5 + i + 2) ** 2 - 4 * 5 * i, 0))) / (2 * 5))));
      expect(gmk["v0"]).toBeCloseTo(100, 0); expect(gmk["ki"]).toBeCloseTo(2, 1); expect(gmk["r_sq"]).toBeCloseTo(1, 4);
      const xb = lin(40, 0, 100);
      const gbd = await g("binding_depletion", xb, xb.map((v) => 0.5 * ((v + 10 + 50) - Math.sqrt(Math.max((v + 60) ** 2 - 4 * v * 50, 0)))));
      expect(gbd["bmax"]).toBeCloseTo(50, 0); expect(gbd["kd"]).toBeCloseTo(10, 0);
      // Peaks — Voigt / EMG / Pearson VII (embedded exact data for the special-function ones).
      const gv = await g("voigt", VOIGT_X, VOIGT_Y);
      expect(gv["center"]).toBeCloseTo(5, 1); expect(gv["r_sq"]).toBeCloseTo(1, 4);
      const ge = await g("emg", EMG_X, EMG_Y);
      expect(ge["center"]).toBeCloseTo(8, 1); expect(ge["tau"]).toBeCloseTo(2, 1); expect(ge["r_sq"]).toBeCloseTo(1, 4);
      const xpe = lin(70, -5, 15);
      const gpe = await g("pearson7", xpe, xpe.map((v) => 10 / (1 + ((v - 5) / 2) ** 2 * (2 ** (1 / 2) - 1)) ** 2));
      expect(gpe["center"]).toBeCloseTo(5, 1); expect(gpe["width"]).toBeCloseTo(2, 1); expect(gpe["r_sq"]).toBeCloseTo(1, 4);
      // Periodic — two harmonics + linear drift.
      const xh = lin(80, 0, 12);
      const gs2 = await g("sine2", xh, xh.map((v) => 2 + 3 * Math.sin((2 * Math.PI * v) / 6 + 0.3) + 1.5 * Math.sin((4 * Math.PI * v) / 6 + 0.6)));
      expect(gs2["period"]).toBeCloseTo(6, 1); expect(gs2["r_sq"]).toBeCloseTo(1, 4);
      const xsd = lin(80, 0, 15);
      const gsd = await g("sine_drift", xsd, xsd.map((v) => 1 + 0.5 * v + 3 * Math.sin((2 * Math.PI * v) / 5 + 0.4)));
      expect(gsd["period"]).toBeCloseTo(5, 1); expect(gsd["slope"]).toBeCloseTo(0.5, 1);
      // Sigmoidal — two transitions.
      const xdb = lin(80, 0, 18);
      const gdb = await g("boltzmann_double", xdb, xdb.map((v) => 5 / (1 + Math.exp((3 - v) / 0.5)) + 8 / (1 + Math.exp((12 - v) / 1.0))));
      expect(gdb["r_sq"]).toBeCloseTo(1, 4);
      // Power law with exponential cutoff.
      const xpc = lin(60, 0.5, 40);
      const gpc = await g("power_law_cutoff", xpc, xpc.map((v) => 2 * v ** 1.5 * Math.exp(-v / 10)));
      expect(gpc["b"]).toBeCloseTo(1.5, 1); expect(gpc["c"]).toBeCloseTo(10, 0);
      // Dose-response — probit / Weibull / concentration biphasic·bell / normalized / Richards / hormesis.
      const gpr = await g("probit_dr", PROBIT_X, PROBIT_Y);
      expect(gpr["mu"]).toBeCloseTo(10, 1); expect(gpr["sigma"]).toBeCloseTo(3, 1);
      const xw = lin(50, 0.1, 30);
      const gw = await g("weibull_sigmoid", xw, xw.map((v) => 50 * (1 - Math.exp(-((v / 8) ** 2)))));
      expect(gw["scale"]).toBeCloseTo(8, 1); expect(gw["shape"]).toBeCloseTo(2, 1);
      const xbc = geo(30, 0.01, 10000);
      const gbi = await g("biphasic_dr_conc", xbc, xbc.map((v) => 100 * (0.5 / (1 + (1 / v) ** 1) + 0.5 / (1 + (100 / v) ** 1))));
      expect(gbi["r_sq"]).toBeCloseTo(1, 4);
      const xbe = geo(40, 0.01, 10000);
      const gbe = await g("bell_dr_conc", xbe, xbe.map((v) => 100 * (1 / (1 + (1 / v) ** 1)) * (1 / (1 + (v / 100) ** 1))));
      expect(gbe["r_sq"]).toBeCloseTo(1, 3);
      const xn = lin(40, 0.5, 60);
      const gn = await g("dr_norm_3pl_conc", xn, xn.map((v) => (100 * v) / (5 + v)));
      expect(gn["ec50"]).toBeCloseTo(5, 1);
      const xr = lin(50, 0, 25);
      const gr = await g("richards_dr", xr, xr.map((v) => 100 / (1 + 1 * Math.exp(-0.5 * (v - 10))) ** (1 / 1)));
      expect(gr["midpoint"]).toBeCloseTo(10, 0); expect(gr["r_sq"]).toBeCloseTo(1, 4);
      const xho = geo(30, 0.1, 1000);
      const gho = await g("hormesis_bc", xho, xho.map((v) => (100 + 5 * v) / (1 + 10 ** ((1 - Math.log10(v)) * 1))));
      expect(gho["r_sq"]).toBeCloseTo(1, 3); expect(gho["EC50"]).toBeCloseTo(10, 0);
    } finally {
      await s.stop();
    }
  }, 30_000);

  it("globalfit: shared + fixed + local parameters across datasets", async () => {
    const s = sup();
    try {
      const dose = [0.01, 0.03, 0.1, 0.3, 1, 3, 10, 30, 100, 300, 1000];
      const fourpl = (x: number, b: number, t: number, le: number, h: number) =>
        b + (t - b) / (1 + 10 ** ((le - Math.log10(x)) * h));
      // 3 curves: shared Bottom=0, Top=100; local logEC50 {0,1,2}, Hill {1,1.5,0.8}.
      const specs: Array<[number, number]> = [[0, 1.0], [1, 1.5], [2, 0.8]];
      const datasets = specs.map(([le, h], i) => ({
        label: `Drug ${String.fromCharCode(65 + i)}`,
        x: dose, y: dose.map((x) => fourpl(x, 0, 100, le, h)),
      }));
      const r = await s.request("globalfit", { model: "4pl", datasets, shared: ["Bottom", "Top"] });
      const terms = r["terms"] as Array<Record<string, number | string>>;
      const by = (t: string) => terms.find((x) => x.term === t)! as Record<string, number>;
      // shared parameters take a single value across all curves.
      expect(by("Bottom (shared)").estimate).toBeCloseTo(0, 4);
      expect(by("Top (shared)").estimate).toBeCloseTo(100, 3);
      // each curve keeps its own EC50.
      expect(by("EC50 — Drug A").estimate).toBeCloseTo(1, 4);
      expect(by("EC50 — Drug B").estimate).toBeCloseTo(10, 3);
      expect(by("EC50 — Drug C").estimate).toBeCloseTo(100, 2);
      const g = r["glance"] as Record<string, number>;
      expect(g["datasets"]).toBe(3);
      expect(g["shared"]).toBe(2);
      expect(g["free_params"]).toBe(8); // 2 shared + 3×2 local (logEC50, Hill)
      expect(g["r_sq"]).toBeCloseTo(1, 5);
      // one sampled curve per dataset for overlay.
      const curves = (r["extra"] as { curves: Array<{ label: string; x: number[] }> }).curves;
      expect(curves.map((c) => c.label)).toEqual(["Drug A", "Drug B", "Drug C"]);

      // Fixed parameter: hold Hill = 1 → it drops out of the free set.
      const rf = await s.request("globalfit", {
        model: "4pl", datasets: datasets.slice(0, 2), shared: ["Bottom", "Top"], fixed: { "Hill slope": 1.0 },
      });
      const tf = rf["terms"] as Array<Record<string, number | string>>;
      expect(tf.some((t) => t.term === "Hill slope (fixed)")).toBe(true);
      expect((rf["glance"] as Record<string, number>)["free_params"]).toBe(4); // 2 shared + 2 local logEC50

      await expect(s.request("globalfit", { model: "mm", datasets: [datasets[0]!] })).rejects.toThrow(); // ≥2 datasets
    } finally {
      await s.stop();
    }
  }, 30_000);

  it("globalfit + per-dataset constant: enzyme mechanism inhibition recovers Vmax/KM/Ki/α; const-models are global-only", async () => {
    const s = sup();
    const S = [1, 2, 5, 10, 20, 35, 50, 75, 100];
    const Is = [0, 5, 10, 20];
    const [VMAX, KM, KI, ALPHA] = [100, 10, 5, 2];
    const mk = (f: (sv: number, i: number) => number) =>
      Is.map((I) => ({ label: `I=${I}`, x: S, y: S.map((sv) => f(sv, I)), consts: [I] }));
    const sharedEst = (terms: Array<Record<string, number | string>>, name: string) =>
      terms.find((t) => t.term === `${name} (shared)`)?.estimate as number;
    try {
      const cases: Array<[string, (sv: number, i: number) => number, Record<string, number>]> = [
        ["competitive_inhibition", (sv, i) => (VMAX * sv) / (KM * (1 + i / KI) + sv), { Vmax: VMAX, KM: KM, Ki: KI }],
        ["noncompetitive_inhibition", (sv, i) => (VMAX * sv) / ((KM + sv) * (1 + i / KI)), { Vmax: VMAX, KM: KM, Ki: KI }],
        ["uncompetitive_inhibition", (sv, i) => (VMAX * sv) / (KM + sv * (1 + i / KI)), { Vmax: VMAX, KM: KM, Ki: KI }],
        ["mixed_inhibition", (sv, i) => (VMAX * sv) / (KM * (1 + i / KI) + sv * (1 + i / (ALPHA * KI))), { Vmax: VMAX, KM: KM, Ki: KI, Alpha: ALPHA }],
      ];
      for (const [model, f, want] of cases) {
        const r = await s.request("globalfit", { model, datasets: mk(f), shared: Object.keys(want) });
        const terms = r["terms"] as Array<Record<string, number | string>>;
        expect((r["glance"] as Record<string, number>)["r_sq"]).toBeCloseTo(1, 4);
        for (const [p, v] of Object.entries(want)) expect(sharedEst(terms, p)).toBeCloseTo(v, 1);
      }
      // A const-model can't be fit as a single curve (KM/Ki confounded) — must be rejected.
      await expect(s.request("curvefit", { model: "competitive_inhibition", x: S, y: S })).rejects.toThrow();
      // Global fit without the per-dataset constant is rejected.
      await expect(s.request("globalfit", {
        model: "competitive_inhibition",
        datasets: [{ label: "a", x: S, y: S }, { label: "b", x: S, y: S }], shared: ["Vmax", "KM", "Ki"],
      })).rejects.toThrow();
    } finally {
      await s.stop();
    }
  }, 30_000);

  it("curvefit/globalfit: centered polynomials (data-derived const) + multi-[L] association kinetics", async () => {
    const s = sup();
    const lin = (n: number, a: number, b: number) => Array.from({ length: n }, (_, i) => a + (b - a) * (i / (n - 1)));
    try {
      // Centered polynomials: X̄ is a data-derived fit-level constant; the fitted
      // coefficients are the Taylor expansion about xc = mean(x).
      const x = lin(20, 0.5, 6);
      const xc = x.reduce((a, b) => a + b, 0) / x.length;
      const y2 = x.map((v) => 1 + 2 * v - 0.3 * v ** 2); // p(x) = 1 + 2x − 0.3x²
      const g2 = (await s.request("curvefit", { model: "poly2_centered", x, y: y2 }))["glance"] as Record<string, number>;
      expect(g2["r_sq"]).toBeCloseTo(1, 6);
      expect(g2["b0"]).toBeCloseTo(1 + 2 * xc - 0.3 * xc ** 2, 4); // b0 = p(xc)
      expect(g2["b1"]).toBeCloseTo(2 - 0.6 * xc, 4); // b1 = p'(xc)
      expect(g2["b2"]).toBeCloseTo(-0.3, 5); // b2 = ½·p''(xc)
      const y6 = x.map((v) => 1 + 0.5 * v - 0.1 * v ** 2 + 0.01 * v ** 3 - 4e-4 * v ** 4 + 7e-6 * v ** 5 - 4e-8 * v ** 6);
      const g6 = (await s.request("curvefit", { model: "poly6_centered", x, y: y6 }))["glance"] as Record<string, number>;
      expect(g6["r_sq"]).toBeCloseTo(1, 5);

      // Multi-[L] association kinetics: [L] a per-dataset const; global fit shares kon/koff, plateau local.
      const t = lin(30, 0, 20);
      const [KON, KOFF] = [0.5, 0.1];
      const mk = (L: number, plat: number) => ({ label: `L=${L}`, x: t, y: t.map((ti) => plat * (1 - Math.exp(-(KON * L + KOFF) * ti))), consts: [L] });
      const r = await s.request("globalfit", { model: "assoc_kinetics", datasets: [mk(1, 100), mk(3, 90), mk(10, 80)], shared: ["kon", "koff"] });
      const terms = r["terms"] as Array<Record<string, number | string>>;
      const sh = (name: string) => terms.find((tm) => tm.term === `${name} (shared)`)?.estimate as number;
      expect(sh("kon")).toBeCloseTo(KON, 3);
      expect(sh("koff")).toBeCloseTo(KOFF, 3);
      expect((r["glance"] as Record<string, number>)["r_sq"]).toBeCloseTo(1, 5);
      // assoc_kinetics is global-only (kon/koff confounded on a single curve).
      await expect(s.request("curvefit", { model: "assoc_kinetics", x: t, y: t })).rejects.toThrow();
    } finally {
      await s.stop();
    }
  }, 30_000);

  it("globalfit: Gaddum/Schild, operational agonism, total+nonspecific binding recover known parameters", async () => {
    const s = sup();
    const loglin = (n: number, lo: number, hi: number) =>
      Array.from({ length: n }, (_, i) => 10 ** (Math.log10(lo) + (Math.log10(hi) - Math.log10(lo)) * (i / (n - 1))));
    const est = (terms: Array<Record<string, number | string>>, name: string) =>
      terms.find((t) => t.term === name)?.estimate as number;
    const sh = (terms: Array<Record<string, number | string>>, name: string) => est(terms, `${name} (shared)`);
    try {
      // ── Gaddum/Schild EC50 shift: [B] per-dataset const; every parameter shared. ──
      const doses = loglin(14, 1e-10, 1e-3);
      const [BOT, TOP, LEC, HILL, PA2, SLOPE] = [0, 100, -7, 1, 8, 1];
      const schildY = (x: number, B: number) => {
        const dr = B === 0 ? 1 : 1 + (B * 10 ** PA2) ** SLOPE;
        return BOT + (TOP - BOT) / (1 + (dr * 10 ** (LEC - Math.log10(x))) ** HILL);
      };
      const dsS = [0, 1e-8, 1e-7, 1e-6].map((B) => ({ label: `B=${B}`, x: doses, y: doses.map((x) => schildY(x, B)), consts: [B] }));
      const rS = await s.request("globalfit", { model: "schild", datasets: dsS, shared: ["Bottom", "Top", "logEC50", "HillSlope", "pA2", "SchildSlope"] });
      const tS = rS["terms"] as Array<Record<string, number | string>>;
      expect((rS["glance"] as Record<string, number>)["r_sq"]).toBeCloseTo(1, 5);
      expect(sh(tS, "pA2")).toBeCloseTo(8, 2);
      expect(sh(tS, "SchildSlope")).toBeCloseTo(1, 2);
      expect(sh(tS, "logEC50")).toBeCloseTo(-7, 2);
      expect(sh(tS, "Top")).toBeCloseTo(100, 1);

      // ── Allosteric EC50 shift: a modulator [B] scales EC50 by
      //    (1+B/KB)/(1+α·B/KB); all params shared across [B]. Recover them at R²=1. ──
      const dosesA = loglin(12, 0.01, 1e4);
      const KB = 1, ALPHA = 0.1; // logKB = 0, logAlpha = −1 (negative cooperativity)
      const allosY = (x: number, B: number) => {
        const ec = (10 * (1 + B / KB)) / (1 + (ALPHA * B) / KB); // control EC50 = 10 (logEC50 = 1)
        return 0 + (100 - 0) / (1 + (ec / x) ** 1); // Bottom 0, Top 100, Hill 1
      };
      const dsA = [0, 1, 10].map((B) => ({ label: `B=${B}`, x: dosesA, y: dosesA.map((x) => allosY(x, B)), consts: [B] }));
      const rA = await s.request("globalfit", { model: "allosteric_ec50", datasets: dsA, shared: ["Bottom", "Top", "logEC50", "HillSlope", "logKB", "logAlpha"] });
      const tA = rA["terms"] as Array<Record<string, number | string>>;
      expect((rA["glance"] as Record<string, number>)["r_sq"]).toBeCloseTo(1, 5);
      expect(sh(tA, "logEC50")).toBeCloseTo(1, 2);
      expect(sh(tA, "logKB")).toBeCloseTo(0, 2);
      expect(sh(tA, "logAlpha")).toBeCloseTo(-1, 2);
      expect(sh(tA, "Top")).toBeCloseTo(100, 1);

      // ── Operational model (partial agonist): system Emax/Basal/n shared, each ligand
      //    local logKA/logTau. A near-full agonist pins Emax; the near-full ligand's own
      //    logKA/logTau are non-identifiable (receptor reserve) so we assert only the
      //    partial agonists' local values + the shared system params + R²=1. ──
      const doses2 = loglin(16, 1e-11, 1e-2);
      const opY = (x: number, lka: number, lta: number) => (100 * (10 ** lta * x)) / ((10 ** lka + x) + 10 ** lta * x); // Basal 0, n 1
      const ags: Array<[string, number, number]> = [["full", -7, 3], ["pB", -6, 0], ["pC", -5.5, -0.7]];
      const dsO = ags.map(([lab, lka, lta]) => ({ label: lab, x: doses2, y: doses2.map((x) => opY(x, lka, lta)) }));
      const rO = await s.request("globalfit", { model: "operational", datasets: dsO, shared: ["Basal", "Emax", "n"] });
      const tO = rO["terms"] as Array<Record<string, number | string>>;
      expect((rO["glance"] as Record<string, number>)["r_sq"]).toBeCloseTo(1, 5);
      expect(sh(tO, "Emax")).toBeCloseTo(100, 0);
      expect(sh(tO, "n")).toBeCloseTo(1, 2);
      expect(est(tO, "logKA — pB")).toBeCloseTo(-6, 2);
      expect(est(tO, "logTau — pB")).toBeCloseTo(0, 2);
      expect(est(tO, "logKA — pC")).toBeCloseTo(-5.5, 2);
      expect(est(tO, "logTau — pC")).toBeCloseTo(-0.7, 2);

      // ── Operational model — receptor depletion: q per-dataset const, all params shared. ──
      const opdY = (x: number, q: number) => (100 * (q * 10 * x)) / ((1e-6 + x) + q * 10 * x); // KA 1e-6, τmax 10, n1, Emax100
      const dsD = [1, 0.5, 0.25, 0.1].map((q) => ({ label: `q=${q}`, x: doses2, y: doses2.map((x) => opdY(x, q)), consts: [q] }));
      const rD = await s.request("globalfit", { model: "operational_depletion", datasets: dsD, shared: ["Basal", "Emax", "n", "logKA", "logTau"] });
      const tD = rD["terms"] as Array<Record<string, number | string>>;
      expect((rD["glance"] as Record<string, number>)["r_sq"]).toBeCloseTo(1, 5);
      expect(sh(tD, "Emax")).toBeCloseTo(100, 1);
      expect(sh(tD, "logKA")).toBeCloseTo(-6, 2);
      expect(sh(tD, "logTau")).toBeCloseTo(1, 2);

      // ── One-site total & nonspecific binding: Spec∈{1,0} per-dataset const, all shared. ──
      const X = [0.5, 1, 2, 3, 5, 8, 12, 20, 35, 50, 75, 100, 150, 200];
      const [BMAX, KD, NS, BG] = [100, 5, 2, 1];
      const dsTN = [
        { label: "total", x: X, y: X.map((x) => (BMAX * x) / (KD + x) + NS * x + BG), consts: [1] },
        { label: "nonspecific", x: X, y: X.map((x) => NS * x + BG), consts: [0] },
      ];
      const rTN = await s.request("globalfit", { model: "total_nonspecific", datasets: dsTN, shared: ["Bmax", "Kd", "NS", "Background"] });
      const tTN = rTN["terms"] as Array<Record<string, number | string>>;
      expect((rTN["glance"] as Record<string, number>)["r_sq"]).toBeCloseTo(1, 5);
      expect(sh(tTN, "Bmax")).toBeCloseTo(100, 2);
      expect(sh(tTN, "Kd")).toBeCloseTo(5, 3);
      expect(sh(tTN, "NS")).toBeCloseTo(2, 3);
      expect(sh(tTN, "Background")).toBeCloseTo(1, 3);

      // ── Two-site total & nonspecific binding (well-separated sites). ──
      const X2 = loglin(20, 0.1, 500);
      const [B1, K1, B2, K2, NS2, BG2] = [100, 1, 60, 50, 1.5, 0.5];
      const dsT2 = [
        { label: "total", x: X2, y: X2.map((x) => (B1 * x) / (K1 + x) + (B2 * x) / (K2 + x) + NS2 * x + BG2), consts: [1] },
        { label: "nonspecific", x: X2, y: X2.map((x) => NS2 * x + BG2), consts: [0] },
      ];
      const rT2 = await s.request("globalfit", { model: "total_nonspecific_2site", datasets: dsT2, shared: ["Bmax1", "Kd1", "Bmax2", "Kd2", "NS", "Background"] });
      const tT2 = rT2["terms"] as Array<Record<string, number | string>>;
      expect((rT2["glance"] as Record<string, number>)["r_sq"]).toBeCloseTo(1, 4);
      expect(sh(tT2, "Bmax1")).toBeCloseTo(100, 1);
      expect(sh(tT2, "Kd1")).toBeCloseTo(1, 2);
      expect(sh(tT2, "Bmax2")).toBeCloseTo(60, 1);
      expect(sh(tT2, "Kd2")).toBeCloseTo(50, 1);

      // One-site total binding with ligand depletion (single curve): free ligand
      // solved from the mass-conservation quadratic; recovers Bmax/Kd/NS from a depleted curve.
      const XD = [0.5, 1, 2, 3, 5, 8, 12, 20, 35, 50, 75, 100, 150, 200, 300, 500];
      const [BM, KDv, NSv] = [100, 5, 2];
      const dep = (x: number) => {
        const a = 1 + NSv, b = KDv + BM + NSv * KDv - x, c = -x * KDv;
        const F = (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
        return (BM * F) / (KDv + F) + NSv * F;
      };
      const rDep = await s.request("curvefit", { model: "binding_depletion_ns", x: XD, y: XD.map(dep) });
      const gDep = rDep["glance"] as Record<string, number>;
      expect(gDep["r_sq"]).toBeCloseTo(1, 6);
      expect(gDep["bmax"]).toBeCloseTo(100, 2);
      expect(gDep["kd"]).toBeCloseTo(5, 3);
      expect(gDep["ns"]).toBeCloseTo(2, 4);

      // Global total + nonspecific with depletion: total (Spec=1) + nonspecific (Spec=0)
      // share Bmax/Kd/NS; free ligand solved per curve. Spec gates the specific term in both.
      const depS = (x: number, spec: number) => {
        const a = 1 + NSv, b = KDv + spec * BM + NSv * KDv - x, c = -x * KDv;
        const F = (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
        return spec * (BM * F) / (KDv + F) + NSv * F;
      };
      const dsDep = [
        { label: "total", x: XD, y: XD.map((x) => depS(x, 1)), consts: [1] },
        { label: "nonspecific", x: XD, y: XD.map((x) => depS(x, 0)), consts: [0] },
      ];
      const rGDep = await s.request("globalfit", { model: "total_nonspecific_depletion", datasets: dsDep, shared: ["Bmax", "Kd", "NS"] });
      const tGDep = rGDep["terms"] as Array<Record<string, number | string>>;
      expect((rGDep["glance"] as Record<string, number>)["r_sq"]).toBeCloseTo(1, 5);
      expect(sh(tGDep, "Bmax")).toBeCloseTo(100, 2);
      expect(sh(tGDep, "Kd")).toBeCloseTo(5, 3);
      expect(sh(tGDep, "NS")).toBeCloseTo(2, 4);
      // const-model → single-curve rejected.
      await expect(s.request("curvefit", { model: "total_nonspecific_depletion", x: XD, y: XD })).rejects.toThrow();

      // Global-only guards: operational (no const) + schild (const) rejected single-curve.
      await expect(s.request("curvefit", { model: "operational", x: X, y: X })).rejects.toThrow();
      await expect(s.request("curvefit", { model: "schild", x: X, y: X })).rejects.toThrow();
      // Missing the per-dataset constant is rejected.
      await expect(s.request("globalfit", {
        model: "total_nonspecific",
        datasets: [{ label: "a", x: X, y: X }, { label: "b", x: X, y: X }], shared: ["Bmax", "Kd", "NS", "Background"],
      })).rejects.toThrow();
    } finally {
      await s.stop();
    }
  }, 40_000);

  it("outliers ROUT (Motulsky-Brown): robust SD ≈ σ, flags gross outliers, FDR-monotone, iterative Grubbs removes gross points", async () => {
    const s = sup();
    // A fixed pseudo-normal column (mean ≈ 50, SD ≈ 5) so the test is deterministic.
    const clean = [
      50.6, 45.2, 54.9, 48.1, 51.7, 43.8, 56.2, 49.4, 52.3, 47.0,
      53.5, 44.6, 55.1, 50.0, 46.3, 51.1, 48.8, 53.9, 45.9, 52.8,
      49.1, 54.2, 47.7, 50.4, 46.8, 53.1, 48.4, 51.9, 44.1, 55.7,
    ];
    try {
      const clg = (r: Record<string, unknown>) => r["glance"] as Record<string, number>;
      // Clean data: RSDR recovers σ≈5 within ~15%; ~no outliers at Q=1%.
      const rc = await s.request("outliers", { values: clean, variant: "rout", Q: 0.01 });
      expect(clg(rc)["rsdr"]).toBeGreaterThan(3); // a sensible robust scale (data spread ≈ 4)
      expect(clg(rc)["rsdr"]).toBeLessThan(7);
      expect(clg(rc)["center"]).toBeGreaterThan(48);
      expect(clg(rc)["center"]).toBeLessThan(52);
      expect(clg(rc)["removed"]).toBe(0);
      // Two gross outliers → both flagged, exactly.
      const withOut = [...clean, 200, -80];
      const ro = await s.request("outliers", { values: withOut, variant: "rout", Q: 0.01 });
      expect(clg(ro)["removed"]).toBe(2);
      const flagged = (ro["terms"] as Array<Record<string, number | string>>)
        .filter((t) => String(t.term).startsWith("Outlier "))
        .map((t) => t.estimate as number)
        .sort((a, b) => a - b);
      expect(flagged).toEqual([-80, 200]);
      expect((ro["cleaned"] as number[]).length).toBe(clean.length); // outliers stripped
      // FDR monotone: a larger Q removes ≥ as many.
      const counts = await Promise.all([0.001, 0.01, 0.05, 0.2].map((Q) =>
        s.request("outliers", { values: withOut, variant: "rout", Q }).then((r) => clg(r)["removed"])));
      for (let i = 1; i < counts.length; i++) expect(counts[i]!).toBeGreaterThanOrEqual(counts[i - 1]!);
      // Degenerate (>68% identical) → RSDR 0, nothing flagged, no crash.
      const rd = await s.request("outliers", { values: [7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 99], variant: "rout", Q: 0.01 });
      expect(clg(rd)["rsdr"]).toBe(0);
      expect(clg(rd)["removed"]).toBe(0);
      // The iterative Grubbs path removes both gross points.
      const rg = await s.request("outliers", { values: withOut, variant: "iterative" });
      expect(clg(rg)["removed"]).toBe(2);
    } finally {
      await s.stop();
    }
  }, 30_000);

  it("outliers: the ROUT q-value and the Grubbs critical G have columns of their own, never the confidence-limit column", async () => {
    // A q-value or a critical G written into ciLow is shown under "95% CI low" in the results
    // table and the export, where a reader takes it for a confidence limit.
    const s = sup();
    const values = [50.6, 45.2, 54.9, 48.1, 51.7, 43.8, 56.2, 49.4, 52.3, 47.0, 53.5, 44.6, 200, -80];
    const rows = (r: Record<string, unknown>) =>
      (r["terms"] as Array<Record<string, unknown>>).filter((t) => /^(Outlier \d|Most extreme)/.test(String(t["term"])));
    try {
      const rout = rows(await s.request("outliers", { values, variant: "rout", Q: 0.01 }));
      const iter = rows(await s.request("outliers", { values, variant: "iterative" }));
      const ns = rows(await s.request("outliers", { values: [10, 11, 12, 13, 14, 15], variant: "single" }));
      expect(rout.length, "the fixture must flag outliers").toBeGreaterThan(0);
      expect(iter.length, "the fixture must flag outliers").toBeGreaterThan(0);
      expect(ns.length, "the not-significant path must report its most extreme value").toBe(1);
      for (const t of [...rout, ...iter, ...ns]) {
        expect(t, `${String(t["term"])} carries a confidence-limit field`).not.toHaveProperty("ciLow");
        expect(t).not.toHaveProperty("ciHigh");
      }
      for (const t of rout) expect(typeof t["qValue"], "ROUT row without its q-value").toBe("number");
      for (const t of [...iter, ...ns]) expect(typeof t["gCritical"], "Grubbs row without its critical G").toBe("number");
    } finally {
      await s.stop();
    }
  }, 30_000);

  it("cox: statsmodels PHReg (Efron ties) — coefficients/SE/LRχ² + the Freireich HR", async () => {
    const s = sup();
    const est = (terms: Array<Record<string, number | string>>, name: string, key = "estimate") =>
      terms.find((t) => t.term === name)?.[key] as number;
    try {
      // Compact dataset with tied event times (exercises Efron). Reference from
      // statsmodels PHReg (ties='efron'): coef=[1.266313,-0.108113] se=[0.396702,0.493501] LRχ²=10.9496.
      const time = [4, 4, 5, 6, 6, 7, 8, 8, 9, 10, 11, 12, 13, 14, 15, 4, 5, 6, 7, 9, 10, 12, 14, 16, 18];
      const event = [1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 0, 1, 1, 0, 1, 1, 1, 1, 1, 1, 0, 1, 1, 0, 1];
      const x1 = [2, 1, 2, 1, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 3, 2, 2, 1, 1, 0, 1, 0, 1, 0];
      const x2 = [1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 1, 0, 1, 0, 1, 0, 0, 1, 0];
      const r = await s.request("cox", { time, event, predictors: [x1, x2], names: ["dose", "marker"] });
      const tm = r["terms"] as Array<Record<string, number | string>>;
      expect(est(tm, "dose")).toBeCloseTo(1.266313, 4);
      expect(est(tm, "dose", "se")).toBeCloseTo(0.396702, 4);
      expect(est(tm, "dose", "hazardRatio")).toBeCloseTo(Math.exp(1.266313), 3);
      expect(est(tm, "marker")).toBeCloseTo(-0.108113, 4);
      expect(est(tm, "marker", "se")).toBeCloseTo(0.493501, 4);
      expect((r["glance"] as Record<string, number>)["lr_chi2"]).toBeCloseTo(10.9496, 3);
      expect((r["glance"] as Record<string, number>)["events"]).toBe(20);
      // Concordance is a valid probability, and > 0.5 for a fit with signal.
      expect((r["glance"] as Record<string, number>)["concordance"]).toBeGreaterThan(0.5);
      expect((r["glance"] as Record<string, number>)["concordance"]).toBeLessThanOrEqual(1);

      // Freireich leukemia (single covariate): the classic Cox HR ≈ 4.28 (PHReg + literature).
      const ftime = [6, 6, 6, 7, 10, 13, 16, 22, 23, 6, 9, 10, 11, 17, 19, 20, 25, 32, 32, 34, 35, 1, 1, 2, 2, 3, 4, 4, 5, 5, 8, 8, 8, 8, 11, 11, 12, 12, 15, 17, 22, 23];
      const fevent = [1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
      const fgrp = [...Array(21).fill(0), ...Array(21).fill(1)];
      const rf = await s.request("cox", { time: ftime, event: fevent, predictors: [fgrp], names: ["placebo"] });
      const tf = rf["terms"] as Array<Record<string, number | string>>;
      expect(est(tf, "placebo")).toBeCloseTo(1.45393, 4);
      expect(est(tf, "placebo", "se")).toBeCloseTo(0.39735, 4);
      expect(est(tf, "placebo", "hazardRatio")).toBeCloseTo(4.27992, 3);

      // Guards: no predictors, and no events → rejected.
      await expect(s.request("cox", { time, event, predictors: [] })).rejects.toThrow();
      await expect(s.request("cox", { time, event: event.map(() => 0), predictors: [x1] })).rejects.toThrow();
    } finally {
      await s.stop();
    }
  }, 30_000);

  it("power: sample-size / power for six designs matches Cohen references, both directions", async () => {
    const s = sup();
    const g = (r: Record<string, unknown>, k: string) => (r["glance"] as Record<string, number>)[k];
    try {
      // Solve for N — Cohen's canonical tables (α=.05, power=.80).
      expect(g(await s.request("power", { test: "ttest-two", solve: "n", effect: 0.5, power: 0.8 }), "n")).toBe(64); // ~64/grp
      expect(g(await s.request("power", { test: "ttest-paired", solve: "n", effect: 0.5, power: 0.8 }), "n")).toBe(34);
      expect(g(await s.request("power", { test: "ttest-onesample", solve: "n", effect: 0.5, power: 0.8 }), "n")).toBe(34);
      expect(g(await s.request("power", { test: "twoproportions", solve: "n", p1: 0.6, p2: 0.4, power: 0.8 }), "n")).toBe(97);
      expect(g(await s.request("power", { test: "anova", solve: "n", effect: 0.25, power: 0.8, kGroups: 4 }), "n")).toBe(179); // total
      expect(g(await s.request("power", { test: "correlation", solve: "n", effect: 0.3, power: 0.8 }), "n")).toBe(85);

      // Solve for power (round-trips ≈ .80 at the N above).
      expect(g(await s.request("power", { test: "ttest-two", solve: "power", effect: 0.5, n: 64 }), "power")).toBeCloseTo(0.8, 2);
      expect(g(await s.request("power", { test: "anova", solve: "power", effect: 0.25, n: 180, kGroups: 4 }), "power")).toBeCloseTo(0.8, 2);
      expect(g(await s.request("power", { test: "correlation", solve: "power", effect: 0.3, n: 85 }), "power")).toBeCloseTo(0.8, 2);

      // Solve for detectable effect (round-trips ≈ the input effect).
      expect(g(await s.request("power", { test: "ttest-two", solve: "effect", n: 64, power: 0.8 }), "effect")).toBeCloseTo(0.5, 2);
      expect(g(await s.request("power", { test: "correlation", solve: "effect", n: 85, power: 0.8 }), "effect")).toBeCloseTo(0.3, 2);

      // One-sided needs fewer subjects than two-sided.
      const oneSided = g(await s.request("power", { test: "ttest-two", solve: "n", effect: 0.5, power: 0.8, tail: "larger" }), "n");
      expect(oneSided).toBeLessThan(64);

      // Tradeoff table: required N rises monotonically with the target power.
      const r = await s.request("power", { test: "ttest-two", solve: "n", effect: 0.5, power: 0.8 });
      const tr = (r["extra"] as { tradeoff: { power: number[]; n: number[]; total: number[] } }).tradeoff;
      expect(tr.power).toEqual([0.7, 0.8, 0.9, 0.95, 0.99]);
      for (let i = 1; i < tr.n.length; i++) expect(tr.n[i]!).toBeGreaterThan(tr.n[i - 1]!);
      expect(tr.total[1]).toBe(128); // 64/grp × 2

      // Guards: missing a required input, and a bad α.
      await expect(s.request("power", { test: "ttest-two", solve: "n", effect: 0.5 })).rejects.toThrow();
      await expect(s.request("power", { test: "ttest-two", solve: "power", effect: 0.5, n: 64, alpha: 1.5 })).rejects.toThrow();
    } finally {
      await s.stop();
    }
  }, 30_000);

  it("comparefits: AICc + extra-sum-of-squares F choose between nested models", async () => {
    const s = sup();
    try {
      const dose = [0.001, 0.003, 0.01, 0.03, 0.1, 0.3, 1, 3, 10, 30, 100];
      const fourpl = (x: number, b: number, t: number, le: number, h: number) =>
        b + (t - b) / (1 + 10 ** ((le - Math.log10(x)) * h));
      // Data generated from a true 4PL (Hill = 2): the variable-slope model should win.
      const yVar = dose.map((x) => fourpl(x, 0, 100, 0, 2));
      const rv = await s.request("comparefits", { x: dose, y: yVar, modelA: "3pl", modelB: "4pl" });
      const gv = rv["glance"] as Record<string, number | string>;
      expect(gv["preferred"]).toBe("4pl");
      expect(gv["prob_b"] as number).toBeGreaterThan(0.9); // 4PL strongly favoured
      expect(gv["f_p"] as number).toBeLessThan(0.05); // extra Hill parameter justified
      const tv = rv["terms"] as Array<Record<string, number | string>>;
      expect(tv.some((t) => String(t.term).startsWith("Extra-SS F"))).toBe(true);

      // Data from a true 3PL (Hill = 1): parsimony should keep the simpler model.
      const yFix = dose.map((x) => fourpl(x, 0, 100, 0, 1));
      const rf = await s.request("comparefits", { x: dose, y: yFix, modelA: "3pl", modelB: "4pl" });
      const gf = rf["glance"] as Record<string, number | string>;
      expect(gf["preferred"]).toBe("3pl");

      // Non-nested pair → AICc only, no F test.
      const xp = [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5];
      const yp = xp.map((x) => 10 * Math.exp(-((x - 0.5) ** 2) / (2 * 1.2 ** 2)));
      const rn = await s.request("comparefits", { x: xp, y: yp, modelA: "gaussian", modelB: "lorentzian" });
      expect((rn["extra"] as { ftest: unknown }).ftest).toBeNull();

      // A log-dose model vs a linear-X model uses different point counts → rejected.
      await expect(s.request("comparefits", { x: xp, y: yp, modelA: "4pl", modelB: "poly2" })).rejects.toThrow();
      // Two identical models → rejected.
      await expect(s.request("comparefits", { x: dose, y: yVar, modelA: "4pl", modelB: "4pl" })).rejects.toThrow();
    } finally {
      await s.stop();
    }
  }, 30_000);

  it("curvefit linear + lowess", async () => {
    const s = sup();
    try {
      const lin = (await s.request("curvefit", { model: "linear", x: [1, 2, 3, 4, 5], y: [2.1, 3.9, 6.1, 8.0, 9.9] }))["glance"] as Record<string, number>;
      expect(lin["slope"]).toBeCloseTo(1.97, 2);
      expect(lin["r_sq"]).toBeCloseTo(0.9992, 3);
      const lo = await s.request("curvefit", { model: "lowess", x: [1, 2, 3, 4, 5, 6], y: [1, 3, 2, 5, 4, 6] });
      expect((lo["curve"] as { x: number[] }).x.length).toBeGreaterThan(0);
    } finally {
      await s.stop();
    }
  }, 20_000);

  it("returns a typed bad_request for an unknown variant", async () => {
    const s = sup();
    try {
      await expect(s.request("ttest", { variant: "nope", a: [1, 2], b: [3, 4] })).rejects.toMatchObject({
        code: "bad_request",
      });
    } finally {
      await s.stop();
    }
  }, 20_000);
});
