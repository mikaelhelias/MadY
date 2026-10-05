/**
 * Per-method validation metadata: how each method's numbers are checked.
 * MadY's engine is validated two ways in CI: (1) `engine.test.ts` asserts results
 * against reference implementations (SciPy / statsmodels), and (2) `crosscheck.py`
 * re-derives the same numbers a second, independent way (stdlib / mpmath / closed-form
 * / literature, sharing no code with the engine). This module turns those checks into the
 * Validated badge and a citable statement shown to the user.
 *
 * Only methods covered by those checks appear here, and `crossChecked` is true only for
 * methods that `crosscheck.py` recomputes, so the badge never states more than the checks show.
 */

export interface MethodValidation {
  /**
   * What `references` names, and how the badge should word it:
   *  - `true`  → the referenced library (SciPy / statsmodels / NumPy) is what actually
   *              computes the result — the engine calls it. Badge says "Computed with …".
   *  - `false` → MadY implements the estimator itself (from scratch / closed form) and
   *              `references` names the published procedure or the equivalent library it
   *              is checked against. Badge says the method was computed in MadY and
   *              validated against that reference — not that the library produced it.
   * The distinction matters: for ANOVA the number is SciPy's, but a Kaplan–Meier curve,
   * a Deming fit, ROC/AUC, ROUT/Grubbs outliers, etc. are MadY's own code.
   */
  computedWith: boolean;
  /** Reference implementations / procedures the engine output is checked against. */
  references: string[];
  /** True when an independent recomputation cross-checks it (`crosscheck.py`). */
  crossChecked: boolean;
  /** One-line description of the validation basis (tooltip + report). */
  basis: string;
}

/**
 * Keyed by `Analysis.method` (the METHOD_INFO / dialog id). One entry per engine method —
 * `validation.test.ts` fails if an engine method has none, and derives `crossChecked` from
 * the methods `crosscheck.py` actually calls, so neither can drift from the engine.
 */
const VALIDATION: Record<string, MethodValidation> = {
  // ── Computed by the referenced library (SciPy / statsmodels) ─────────────────
  describe: { computedWith: true, references: ["SciPy", "NumPy", "Python statistics"], crossChecked: true, basis: "Descriptive statistics re-derived from Python's stdlib statistics module." },
  normality: { computedWith: true, references: ["SciPy scipy.stats.shapiro / normaltest / anderson"], crossChecked: true, basis: "Normality tests + the normal-vs-lognormal decision cross-checked independently." },
  ttest: { computedWith: true, references: ["SciPy scipy.stats.ttest_ind / ttest_rel / ttest_1samp / mannwhitneyu / wilcoxon"], crossChecked: true, basis: "Pooled / Welch / paired / one-sample t (and p) recomputed from scratch (mpmath); rank tests by exact enumeration." },
  anova: { computedWith: true, references: ["SciPy scipy.stats.f_oneway / kruskal / tukey_hsd / dunnett"], crossChecked: true, basis: "Sums of squares, F, and p re-derived by hand from the group means; Tukey checked against statsmodels. Bonferroni / Šídák / Holm-Šídák comparisons are MadY's own, on the pooled error." },
  correlation: { computedWith: true, references: ["SciPy scipy.stats.pearsonr / spearmanr"], crossChecked: true, basis: "r and its p-value re-derived independently." },
  corrmatrix: { computedWith: true, references: ["SciPy scipy.stats.pearsonr / spearmanr"], crossChecked: true, basis: "Each pairwise correlation re-derived from the stdlib statistics module." },
  contingency: { computedWith: true, references: ["SciPy scipy.stats.chi2_contingency / fisher_exact"], crossChecked: true, basis: "χ², p, and effect sizes re-derived from the table by hand." },
  goodnessoffit: { computedWith: true, references: ["SciPy scipy.stats.chisquare / binomtest"], crossChecked: true, basis: "Chi-square recomputed in closed form; the exact binomial p from scratch." },
  multipleregression: { computedWith: true, references: ["statsmodels OLS"], crossChecked: true, basis: "Coefficients recomputed from the normal equations and by scikit-learn." },
  logistic: { computedWith: true, references: ["statsmodels Logit"], crossChecked: true, basis: "Coefficients + odds ratios re-fit by scikit-learn's unpenalised logistic regression." },
  poisson: { computedWith: true, references: ["statsmodels Poisson GLM"], crossChecked: true, basis: "Rate ratios re-fit by direct maximum likelihood (a different optimiser)." },
  multifactor: { computedWith: true, references: ["statsmodels anova_lm (Type II)"], crossChecked: true, basis: "N-way factorial SS reproduces a from-scratch two-way exactly." },
  mixedmodel: { computedWith: true, references: ["statsmodels MixedLM (REML)"], crossChecked: true, basis: "REML variance components match the balanced one-way random-effects closed form." },
  cox: { computedWith: true, references: ["statsmodels PHReg (Efron ties)"], crossChecked: true, basis: "Coefficients re-fit from a from-scratch Efron partial likelihood. Harrell's C is MadY's own." },
  pcorrect: { computedWith: true, references: ["statsmodels multipletests"], crossChecked: true, basis: "Adjusted P values recomputed from scratch (Bonferroni / Holm / Benjamini-Hochberg)." },
  power: { computedWith: true, references: ["statsmodels.stats.power (noncentral t / F)"], crossChecked: true, basis: "Power recomputed from the noncentral-t tail in mpmath." },
  curvefit: { computedWith: true, references: ["SciPy scipy.optimize.curve_fit"], crossChecked: true, basis: "Fits re-run with a different optimiser (Nelder-Mead) and known-parameter recovery; derived values in closed form." },
  interpolate: { computedWith: true, references: ["SciPy scipy.optimize.curve_fit"], crossChecked: true, basis: "Interpolated values + standard errors recomputed from a stdlib linear fit." },
  globalfit: { computedWith: true, references: ["SciPy scipy.optimize.least_squares"], crossChecked: true, basis: "Shared parameters recovered from independent rate laws and a hand-stacked fit." },
  meltingtemp: { computedWith: true, references: ["SciPy scipy.optimize.curve_fit"], crossChecked: true, basis: "Tm recomputed from an independent Boltzmann fit and a smoothed-derivative peak." },
  montecarlo: { computedWith: true, references: ["numpy default_rng + SciPy curve_fit"], crossChecked: true, basis: "The empirical parameter SD matches the closed-form OLS standard error." },
  // ── Implemented in MadY; the reference is the published procedure or the
  //    equivalent library it is validated against ─────────────────────────────
  regression: { computedWith: false, references: ["ordinary / weighted least squares (Python statistics.linear_regression)"], crossChecked: true, basis: "Slope, intercept, SE, R², p — and WLS / through-point / lack-of-fit — recomputed from the normal equations." },
  twoway: { computedWith: false, references: ["balanced two-way ANOVA; Tukey vs statsmodels pairwise_tukeyhsd"], crossChecked: true, basis: "Sums of squares from the balanced closed form. Tukey uses the model's pooled error (SciPy's tukey_hsd would recompute a different one), checked against statsmodels and R's TukeyHSD(warpbreaks)." },
  nested: { computedWith: false, references: ["nested (hierarchical) ANOVA"], crossChecked: true, basis: "Hierarchical sums of squares recomputed in closed form; F tail via mpmath." },
  rmanova: { computedWith: false, references: ["repeated-measures ANOVA / Friedman"], crossChecked: true, basis: "RM sums of squares (+ sphericity) computed from scratch; F/p cross-checked independently." },
  mixedanova: { computedWith: false, references: ["split-plot (mixed) ANOVA; Greenhouse-Geisser (1959) from the pooled within-group covariance"], crossChecked: true, basis: "Sums of squares, F and p checked against pingouin's mixed ANOVA; with unequal groups, the Type III time test against statsmodels; ε from the pooled covariance's eigenvalues; a post-hoc comparison recomputed by hand." },
  ancova: { computedWith: false, references: ["extra-sum-of-squares F (Zar ch. 18)"], crossChecked: true, basis: "Slope and elevation F tests recomputed from full/reduced least-squares fits." },
  survival: { computedWith: false, references: ["Kaplan–Meier + log-rank (statsmodels SurvfuncRight / survdiff)"], crossChecked: true, basis: "KM step estimates + the log-rank statistic computed from scratch and cross-checked against statsmodels." },
  roc: { computedWith: false, references: ["ROC / AUC (scikit-learn roc_auc_score, Hanley–McNeil, DeLong)"], crossChecked: true, basis: "AUC + the ROC curve computed from scratch and cross-checked against scikit-learn." },
  auc: { computedWith: false, references: ["trapezoidal AUC"], crossChecked: true, basis: "Area under the curve computed by the trapezoid rule and cross-checked." },
  deming: { computedWith: false, references: ["Deming regression (scipy.odr)"], crossChecked: true, basis: "Deming slope/intercept from the closed form; jackknife SEs and λ≠1 checked against scipy.odr." },
  passingbablok: { computedWith: false, references: ["Passing-Bablok regression"], crossChecked: true, basis: "Shifted-median slope recomputed independently; exact line recovery." },
  blandaltman: { computedWith: false, references: ["Bland-Altman limits of agreement"], crossChecked: true, basis: "Bias, SD and limits of agreement recomputed in closed form." },
  outliers: { computedWith: false, references: ["ROUT (FDR) + Grubbs"], crossChecked: true, basis: "Grubbs G and its critical value recomputed via mpmath; ROUT from the robust median + RSDR." },
  cluster: { computedWith: false, references: ["k-means (Lloyd, k-means++) + SciPy hierarchical linkage; scikit-learn KMeans / silhouette_score"], crossChecked: true, basis: "Hierarchical linkage is SciPy's; k-means + silhouette are MadY's own, checked against scikit-learn." },
  equivalence: { computedWith: false, references: ["TOST (statsmodels ttost_ind / ttost_paired)"], crossChecked: true, basis: "Both one-sided tests checked against statsmodels." },
  permutation: { computedWith: false, references: ["permutation test (scipy.stats.permutation_test)"], crossChecked: true, basis: "p-values checked against SciPy and exact enumeration." },
  bayesfactor: { computedWith: false, references: ["JZS Bayes factor (pingouin bayesfactor_ttest)"], crossChecked: true, basis: "BF₁₀ checked against pingouin's values." },
  comparefits: { computedWith: false, references: ["AICc + extra-sum-of-squares F-test"], crossChecked: true, basis: "Model comparison (AICc, F) computed from the residual sums of squares and cross-checked." },
  curvetransform: { computedWith: false, references: ["smoothing / differentiation / integration of a curve"], crossChecked: true, basis: "Derivatives and integrals checked against closed forms; smoothing preserves polynomials." },
  metaanalysis: { computedWith: false, references: ["fixed-effect + DerSimonian-Laird pooling (statsmodels combine_effects)"], crossChecked: true, basis: "Pooled estimates recomputed by hand and checked against statsmodels." },
  publicationbias: { computedWith: false, references: ["Egger's test + Duval-Tweedie trim-and-fill"], crossChecked: true, basis: "Egger's test checked against statsmodels OLS; trim-and-fill recomputed by hand." },
  pca: { computedWith: false, references: ["PCA on NumPy's SVD (scikit-learn PCA)"], crossChecked: true, basis: "Eigenvalues, loadings, and scores checked against scikit-learn; parallel analysis recomputed independently." },
  pcoa: { computedWith: false, references: ["principal coordinates analysis"], crossChecked: true, basis: "On Euclidean distances it must equal covariance PCA; negative-eigenvalue corrections checked." },
  nmds: { computedWith: false, references: ["non-metric MDS (scikit-learn IsotonicRegression)"], crossChecked: true, basis: "Stress recomputed from the returned map; monotone regression checked against scikit-learn." },
  ca: { computedWith: false, references: ["correspondence analysis"], crossChecked: true, basis: "Checked by reciprocal averaging, SciPy's chi-square and the transition formula." },
  rda: { computedWith: false, references: ["redundancy analysis"], crossChecked: true, basis: "Variance partition closes; equals PCA when unconstrained; checked against statsmodels OLS." },
  cca: { computedWith: false, references: ["canonical correspondence analysis"], crossChecked: true, basis: "Equals CA when saturated; SciPy chi-square; variance partition closes." },
  dbrda: { computedWith: false, references: ["distance-based redundancy analysis"], crossChecked: true, basis: "On Euclidean distances it must equal RDA; variance partition closes." },
  permanova: { computedWith: false, references: ["PERMANOVA (Anderson 2001)"], crossChecked: true, basis: "Pseudo-F checked by the coordinate SS identity, the Gower trace form and exact enumeration." },
  varpart: { computedWith: false, references: ["variance partitioning (Legendre & Legendre)"], crossChecked: true, basis: "Fractions recomputed from statsmodels OLS and by hand; must agree with RDA." },
};

/** Validation metadata for an engine method, or undefined when it has none. */
export function methodValidation(method: string): MethodValidation | undefined {
  return VALIDATION[method];
}

/** A citeable one-sentence validation statement for a result (for the "Copy" action / reports). */
export function validationStatement(title: string, v: MethodValidation): string {
  const refs = v.references.join(", ");
  const independent = v.crossChecked
    ? ", and independently cross-checked against a second, from-scratch recomputation in MadY's open validation suite"
    : ", and verified against reference values in MadY's test suite";
  // "using X" when the library X computes the number; "— X" (the procedure/equivalent) when
  // MadY implements the estimator itself. The `independent` clause carries the validation claim.
  const core = v.computedWith ? `was computed in MadY using ${refs}` : `was computed in MadY — ${refs}`;
  return `“${title}” ${core}${independent}.`;
}
