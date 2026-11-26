// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { TidyTerm } from "@mady/core";
import { isSecondaryTerm, splitTerms } from "./analysisEmphasis";

/**
 * Row lists as the Python engine returns them, so the split is judged
 * against what the pane actually renders. The counts in each test are the point:
 * a reader should not have to find the mean among 22 rows.
 */
const ROWS: Record<string, string[]> = {
  describe: [
    "n", "Mean", "Median", "Geometric mean", "Harmonic mean", "Quadratic mean (RMS)",
    "Trimmed mean (10%)", "Winsorized mean (10%)", "SD", "Variance", "SEM",
    "Geometric SD factor", "Coefficient of variation (%CV)", "Skewness", "Kurtosis (excess)",
    "Min", "25th percentile", "75th percentile", "Max", "Range", "Interquartile range", "Sum",
  ],
  ttest: [
    "Group A mean", "Group B mean", "Difference (A − B)", "Cohen's d", "Hedges' g",
    "Glass's Δ (vs Group B SD)", "Equal variances (F test)", "Residual normality (Shapiro-Wilk)",
  ],
  anova: [
    "a", "b", "c", "Between groups", "a vs b", "a vs c", "b vs c",
    "Residual normality (Shapiro-Wilk)", "Equal variances (Bartlett)", "Equal variances (Brown-Forsythe)",
  ],
  regression: [
    "Slope", "Intercept", "R²", "Sy.x (RMSE)", "F (1, 3)", "X-intercept", "1/slope",
    "Runs test (lack of fit)", "Residual normality (Shapiro)",
  ],
  contingency: [
    "Pearson χ²", "Cramer's V", "Yates-corrected χ²", "Fisher's exact (2-sided)", "Relative risk",
    "Odds ratio", "Risk difference", "NNT (1/|risk diff|)", "Sensitivity", "Specificity",
    "PPV", "NPV", "LR+", "LR−",
  ],
  normality: [
    "Shapiro-Wilk", "D'Agostino-Pearson", "Anderson-Darling", "Kolmogorov-Smirnov (Lilliefors)",
    "More consistent with", "P(preferred, by AIC)",
  ],
  outliers: ["Outliers removed", "n (input → cleaned)", "Outlier 1"],
  curvefit: [
    "Bottom", "Top", "logEC50", "Hill slope", "EC50", "R²", "Adjusted R²", "Sy.x (RMSE)",
    "Sum of squares", "Runs test (lack of fit)", "Residual normality (Shapiro-Wilk)",
  ],
  bayesfactor: [
    "BF10 (evidence for an effect)", "BF01 (evidence for no effect)", "log10(BF10)", "Interpretation",
    "t", "Standardized effect size (Cohen's d)", "Prior scale",
    "  BF10 at the medium prior (r = 0.7071)", "  BF10 at the wide prior (r = 1)",
    "  BF10 at the ultrawide prior (r = 1.414)", "Conclusion stable across the three priors",
  ],
  permutation: [
    "Difference in means (observed)", "p (permutation)", "Rearrangements at least as extreme",
    "Rearrangements evaluated", "Method", "Null distribution mean", "Null distribution SD",
  ],
  survival: [
    "A — median survival", "B — median survival", "Log-rank (Mantel-Cox)",
    "Gehan-Breslow-Wilcoxon", "Hazard ratio (A / B)",
  ],
  comparefits: [
    "Dose-response (4PL, variable slope)", "Dose-response (3PL, fixed slope)", "ΔAICc",
    "Preferred (lower AICc)", "Extra-SS F", "F-test prefers (α=0.05)",
  ],
};

const split = (method: string) => splitTerms(method, ROWS[method]!.map((term) => ({ term }) as TidyTerm));
const names = (ts: TidyTerm[]): string[] => ts.map((t) => String(t["term"]));

describe("results emphasis", () => {
  it("cuts descriptive statistics from 22 rows to the ones people quote", () => {
    const { primary, secondary } = split("describe");
    expect(names(primary)).toEqual(["n", "Mean", "Median", "SD", "SEM", "Min", "Max"]);
    expect(secondary).toHaveLength(15);
  });

  it("leads a t test with the two means, the difference and Cohen's d", () => {
    const { primary } = split("ttest");
    expect(names(primary)).toEqual(["Group A mean", "Group B mean", "Difference (A − B)", "Cohen's d"]);
  });

  it("keeps every ANOVA group and pairwise row — they are named after the user's data", () => {
    const { primary, secondary } = split("anova");
    expect(names(primary)).toEqual(["a", "b", "c", "Between groups", "a vs b", "a vs c", "b vs c"]);
    // Only the three assumption checks move.
    expect(names(secondary)).toEqual([
      "Residual normality (Shapiro-Wilk)", "Equal variances (Bartlett)", "Equal variances (Brown-Forsythe)",
    ]);
  });

  it("leads a regression with slope, intercept and R²", () => {
    expect(names(split("regression").primary)).toEqual(["Slope", "Intercept", "R²"]);
  });

  it("leads contingency with the test and its effect sizes, not the diagnostic battery", () => {
    expect(names(split("contingency").primary)).toEqual([
      "Pearson χ²", "Cramer's V", "Fisher's exact (2-sided)", "Relative risk", "Odds ratio",
    ]);
  });

  it("treats assumption checks as supporting detail across every method", () => {
    expect(isSecondaryTerm("ttest", "Residual normality (Shapiro-Wilk)")).toBe(true);
    expect(isSecondaryTerm("anova", "Equal variances (Bartlett)")).toBe(true);
    expect(isSecondaryTerm("rmanova", "Sphericity (Mauchly)")).toBe(true);
    expect(isSecondaryTerm("regression", "Runs test (lack of fit)")).toBe(true);
  });

  // The flagship analysis: this is what a dose-response fit actually returns.
  it("leads a curve fit with its fitted parameters, EC50 and R²", () => {
    const { primary, secondary } = split("curvefit");
    expect(names(primary)).toEqual(["Bottom", "Top", "logEC50", "Hill slope", "EC50", "R²"]);
    expect(names(secondary)).toEqual([
      "Adjusted R²", "Sy.x (RMSE)", "Sum of squares",
      "Runs test (lack of fit)", "Residual normality (Shapiro-Wilk)",
    ]);
  });

  it("leads a Bayes factor with BF10/BF01 and drops the per-prior sensitivity rows", () => {
    const { primary } = split("bayesfactor");
    expect(names(primary)).toEqual([
      "BF10 (evidence for an effect)", "BF01 (evidence for no effect)", "Interpretation",
      "t", "Standardized effect size (Cohen's d)",
    ]);
  });

  it("treats an indented sub-row as detail whatever the method", () => {
    expect(isSecondaryTerm("anything", "  BF10 at the wide prior (r = 1)")).toBe(true);
    expect(isSecondaryTerm("anything", "BF10 at the wide prior (r = 1)")).toBe(false);
  });

  it("leads a permutation test with the difference and its p", () => {
    expect(names(split("permutation").primary)).toEqual([
      "Difference in means (observed)", "p (permutation)", "Rearrangements evaluated",
    ]);
  });

  it("leaves already-tight tables alone (survival, compare-models)", () => {
    expect(split("survival").secondary).toHaveLength(0);
    expect(split("comparefits").secondary).toHaveLength(0);
  });

  it("shows everything for a method with nothing registered", () => {
    const { primary, secondary } = split("outliers");
    expect(primary).toHaveLength(3);
    expect(secondary).toHaveLength(0);
  });

  it("never hides an unfamiliar row — a new engine result is a headline by default", () => {
    const { primary } = splitTerms("describe", [{ term: "Median absolute deviation" } as TidyTerm]);
    expect(names(primary)).toEqual(["Median absolute deviation"]);
  });

  /**
   * The coverage guard. A method missing from the emphasis registry renders its whole
   * table flat — for a dose-response fit, all 11 rows. Any method that returns a long
   * table must actually get shorter — silence in the registry is only acceptable for
   * tables that are already tight.
   */
  it("no results table leads with more than seven rows", () => {
    // "It got shorter" is too weak a bar: the global diagnostic rules trim a row or
    // two from almost anything, so a method can look covered while rows such as
    // Adjusted R² / Sy.x / Sum of squares sit beside the EC50. A headline table has
    // to be scannable at a glance, so hold it to a hard ceiling.
    for (const [method, rowNames] of Object.entries(ROWS)) {
      const { primary } = split(method);
      expect(
        primary.length,
        `"${method}" leads with ${primary.length} of ${rowNames.length} rows — decide which are the result`,
      ).toBeLessThanOrEqual(7);
    }
  });

  it("falls back to the whole table rather than showing an empty one", () => {
    // Every row demoted → the split would leave nothing to read.
    const only = splitTerms("ttest", [{ term: "Hedges' g" } as TidyTerm]);
    expect(only.primary).toHaveLength(1);
    expect(only.secondary).toHaveLength(0);
  });
});
