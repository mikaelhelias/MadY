/**
 * Which rows of a results table are the RESULT, and which are supporting detail.
 *
 * The tidy table renders every row the engine returns, flat and equally weighted.
 * That buries the answer: descriptive statistics returns 22 rows, contingency 14,
 * one-way ANOVA 10, linear regression 9 — so the mean sits between the Winsorized
 * mean and the geometric SD factor, and the p-value sits below three assumption
 * checks. Nothing is wrong with any of those numbers; they are simply not what the
 * reader came for.
 *
 * The split is expressed as what to DEMOTE, never as a list of what to keep. Two
 * reasons: rows are often named after the user's own groups ("Vehicle vs High dose"),
 * so a keep-list cannot name them; and a stats table must fail towards showing too
 * much — a new engine row appears as a headline result, and demoting it is a
 * deliberate act. Nothing is ever removed: the pane keeps a disclosure for the rest,
 * and exports are untouched.
 */
import type { TidyTerm } from "@mady/core";

/**
 * Assumption checks and lack-of-fit diagnostics. They qualify a result rather than
 * being one, and they are phrased the same way across every method, so one list
 * covers all of them.
 */
const DIAGNOSTIC_ROWS: RegExp[] = [
  /^Residual normality/i,
  /^Sample normality/i,
  /^Equal variances/i,
  /^Runs test/i,
  /^Homogeneity/i,
  /^Sphericity/i,
  // The engine indents sub-rows of the row above (e.g. a Bayes factor recomputed at
  // each prior scale). The indent already says "supporting detail".
  /^\s+/,
];

/**
 * Per-method secondary rows: alternative estimators and derived quantities that a
 * reader wants occasionally, not on first read. Each entry is deliberate — see the
 * comment against it for why that row is not the headline.
 */
const SECONDARY_ROWS: Record<string, Array<string | RegExp>> = {
  // 22 rows. Mean/SD/SEM/median/range are the descriptives people quote; the rest are
  // alternative centres and shape statistics.
  describe: [
    "Geometric mean",
    "Harmonic mean",
    "Quadratic mean (RMS)",
    /^Trimmed mean/,
    /^Winsorized mean/,
    "Geometric SD factor",
    "Variance",
    "Coefficient of variation (%CV)",
    "Skewness",
    "Kurtosis (excess)",
    "25th percentile",
    "75th percentile",
    "Range",
    "Interquartile range",
    "Sum",
  ],
  // Cohen's d is the effect size MadY leads with; the other two are alternatives.
  ttest: ["Hedges' g", /^Glass's/],
  // The omnibus test and the pairwise comparisons are the result.
  anova: [],
  // Slope / intercept / R² are the result; the rest are fit diagnostics and
  // re-expressions of the same line.
  regression: ["Sy.x (RMSE)", "X-intercept", "1/slope", /^F \(/],
  // The association test and its effect sizes lead; the diagnostic-accuracy battery
  // is a different question that only applies to a 2×2 of test-vs-truth.
  contingency: [
    "Yates-corrected χ²",
    "Risk difference",
    /^NNT/,
    "Sensitivity",
    "Specificity",
    "PPV",
    "NPV",
    "LR+",
    "LR−",
  ],
  // The four normality tests are the result; the model-preference meta-rows explain.
  normality: ["More consistent with", "P(preferred, by AIC)"],
  // 11 rows. The fitted parameters and EC50 are what the fit was for, with R² as the
  // one goodness-of-fit number people quote; the other three describe residual scatter
  // and belong with the diagnostics beneath.
  curvefit: ["Adjusted R²", "Sy.x (RMSE)", "Sum of squares"],
  globalfit: ["Adjusted R²", "Sy.x (RMSE)", "Sum of squares"],
  // 11 rows. BF10/BF01 with their plain-language reading are the result; log10 is a
  // re-expression, and the per-prior recomputations are a sensitivity check (they
  // arrive indented, so the global rule catches them too).
  bayesfactor: ["log10(BF10)", "Prior scale", "Conclusion stable across the three priors"],
  // 7 rows. The observed difference and its permutation p are the result; the rest
  // describes how the null distribution was built.
  permutation: [
    "Rearrangements at least as extreme",
    "Method",
    "Null distribution mean",
    "Null distribution SD",
  ],
  // 9 rows. The bounds define the test and stay; the two-sided contrast and the SD
  // re-expression are context.
  equivalence: ["Difference test (two-sided, for contrast)", "Bounds in SD units (Cohen's d)"],
};

const matches = (term: string, pattern: string | RegExp): boolean =>
  typeof pattern === "string" ? term === pattern : pattern.test(term);

/** Is this row supporting detail rather than the result itself? */
export function isSecondaryTerm(method: string, term: string): boolean {
  if (DIAGNOSTIC_ROWS.some((re) => re.test(term))) return true;
  return (SECONDARY_ROWS[method] ?? []).some((p) => matches(term, p));
}

/**
 * Split a results table into the rows that answer the question and the rest. Order is
 * preserved within each group. A method with nothing registered keeps every row
 * primary — silence means "show it".
 */
export function splitTerms(method: string, terms: TidyTerm[]): { primary: TidyTerm[]; secondary: TidyTerm[] } {
  const primary: TidyTerm[] = [];
  const secondary: TidyTerm[] = [];
  for (const t of terms) {
    (isSecondaryTerm(method, String(t["term"] ?? "")) ? secondary : primary).push(t);
  }
  // Never leave the table empty: if a registry entry over-matched, show everything
  // rather than an empty result with a "show more" link.
  return primary.length === 0 ? { primary: terms, secondary: [] } : { primary, secondary };
}
