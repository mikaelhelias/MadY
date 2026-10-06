import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import type { DataTable, NodeId, TableKind, FitFlagThresholds } from "@mady/core";
import {
  tableDatasets,
  xColumn,
  TABLE_FORMATS,
  fitModelTemplate,
  rowGroupColumn,
  rowGroupId,
  rowGroupLevels,
  rowGroupsUsable,
  DEFAULT_FIT_FLAGS,
  CONSTRAINED_METHODS,
} from "@mady/core";
import { columnMode, CURVE_FIT_CONST_HINT, CURVE_FIT_CONSTS, CURVE_FIT_PARAM_INFO, CURVE_FIT_PARAMS, detectEquationParams, isXYMethod, METHOD_GROUPS, METHOD_INFO, ANALYSIS_GUIDANCE, variantGuidance, VARIANT_NOTE } from "./analysis";
import { DataIcon } from "./dataIcons";
import { DATA_TYPE_CARDS, METHOD_KINDS, methodFitsKind, rankGoals } from "./analyzeGoals";
import { clearAnalysisDefault, getAnalysisDefault, getAppDefaults, setAnalysisDefault } from "./profile";
import { suggestCurveModelsForTable, suggestVariantsForTable } from "./assistant";
import { isTextColumn } from "./newGraph";
import type { CurveModelGoal, CurveModelRecommendation, Suggestion, SuggestionChoice } from "./assistant";
import { GuideHelp } from "./guideLink";

/** What the user chose to run. Column ids are **dataset ids** (lead Y columns). */
export interface AnalyzeSpec {
  method: string;
  variant?: string | undefined;
  /** Second model for "compare models" (comparefits): `variant` is model A, this is model B. */
  variant2?: string;
  /** ROC DeLong compare: a second marker (score) column id. */
  marker2?: string;
  columns: NodeId[];
  mu?: number;
  /** Equivalence (TOST): the ±Δ bound, in the units named by `boundMode`. */
  bound?: number;
  /** Equivalence: "absolute" (raw units) | "sd" (Cohen's d) | "percent" (of the reference mean). */
  boundMode?: string;
  /** Permutation: random rearrangements to draw when exact enumeration is infeasible. */
  nResamples?: number;
  /** Bayes factor: Cauchy prior scale on effect size — "medium" | "wide" | "ultrawide". */
  rscale?: string;
  /** ANOVA post-hoc test + scheme + control group index (within `columns`). */
  posthoc?: string;
  scheme?: string;
  control?: number;
  /** Two-way ANOVA post-hoc comparison family: "rowmeans" | "colmeans" | "cellmeans". */
  compare?: string;
  /** Selected-pairs scheme: chosen [i, j] group-index pairs (indices into `columns`). */
  pairs?: number[][];
  /** Confidence level for reported CIs (0–1; default 0.95). */
  conf?: number;
  /** Contingency 2×2 effect-size CI method: "score" (Koopman RR + Newcombe risk-diff) | "log" (Katz + Wald). */
  ciMethod?: string;
  /** Survival (≥3 groups): also run pairwise log-rank comparisons of the curves. */
  pairwise?: boolean;
  /** Survival pairwise multiplicity correction: holm-sidak|bonferroni|sidak|none. */
  pairwiseMethod?: string;
  /** Bland-Altman: plot the difference as a percent of the mean instead of absolute units. */
  percent?: boolean;
  /** Bland-Altman: limits-of-agreement multiplier × SD of the differences (default 1.96). */
  agreementK?: number;
  /** Deming regression: error-variance ratio λ = σ²(Y)/σ²(X) (default 1 = orthogonal). */
  lambda?: number;
  /** AUC: drop peaks shorter than this fraction of the tallest peak's height (0 = keep all). */
  minPeakFraction?: number;
  /** AUC: numeric baseline value, used when the baseline variant is "custom". */
  baselineValue?: number;
  /** Direction for t-tests / correlation: "two-sided" (default) | "greater" | "less". */
  tail?: string;
  /** Curve-fit / regression weighting: "none"|"1/Y"|"1/Y2"|"1/YY"|"1/X"|"1/X2"|"1/SD2"|"poisson". */
  weighting?: string;
  /** Curve fit: identify + remove outliers (ROUT, Motulsky & Brown) before the least-squares fit. */
  rout?: boolean;
  /** Nonlinear fit: flag a questionable fit against user thresholds (engine returns `flagged`). */
  flag?: FitFlagThresholds;
  /** Curve transform (smooth): Savitzky-Golay window size (odd; 0 / omitted = auto ≈10% of points). */
  smoothWindow?: number;
  /** Melting temperature: sloped (linear) baselines on both plateaus. */
  sloped?: boolean;
  /** Melting temperature: the temperature window (either bound optional). */
  rangeFrom?: number;
  rangeTo?: number;
  /** Nonlinear fit (curvefit, variant "custom"): a user-defined equation `Y = f(X, …)`. */
  equation?: string;
  /** User-defined-equation fit: optional starting value per parameter name (default 1). */
  initialValues?: Record<string, number>;
  /** Linear regression: force the line through an arbitrary fixed point (x₀, y₀). */
  throughPoint?: { x: number; y: number };
  /** Nonlinear fit (curvefit/globalfit): fix parameters to a constant (name → value). */
  fixed?: Record<string, number>;
  /** Nonlinear fit: per-parameter [min, max] bounds (null = unbounded that side). */
  paramBounds?: Record<string, [number | null, number | null]>;
  /** Dose-response: also report EC/IC at these response percents (e.g. [10, 90]). */
  ecLevels?: number[] | undefined;
  /** Dose-response (inhibition): convert IC50 → Ki via Cheng-Prusoff, given [ligand] + its Kd. */
  chengProsuff?: { conc: number; kd: number } | undefined;
  /** Global-fit: parameter names shared across the selected datasets. */
  shared?: string[];
  /** Global-fit: also test whether one curve (every parameter shared) fits all the datasets. */
  compareOneCurve?: boolean;
  /** Global-fit with a per-dataset constant (e.g. enzyme-inhibition [I]): dataset id → value. */
  consts?: Record<string, number>;
  /** PCA: optional column id to group cases by (grouped score plot + ellipses). */
  groupBy?: NodeId;
  /** PCA: how many components to retain — parallel|kaiser|fixedk|variance|all. */
  componentSelection?: string;
  /** PCA (kaiser): retain eigenvalues above this threshold (default 1.0). */
  kaiserThreshold?: number;
  /** PCA (fixedk): retain exactly this many components. */
  fixedK?: number;
  /** PCA (variance): retain the fewest PCs reaching this cumulative-variance fraction (0–1). */
  varianceThreshold?: number;
  /** PCA (parallel analysis): percentile of the random eigenvalue distribution (default 95). */
  parallelPercentile?: number;
  /** Cluster analysis: number of clusters (k). */
  k?: number;
  /** Reproducible-run seed: the k-means++ init, and the permutation test's Monte Carlo. */
  seed?: number;
  /** Cluster analysis: z-score variables first. */
  standardize?: boolean;
  /** Cluster analysis: distance metric (euclidean|manhattan|cosine|correlation).
   *  Ordination (PCoA / NMDS) reads the same field, with braycurtis / jaccard / canberra too. */
  metric?: string;
  /** Ordination: the standardization applied before the distance (hellinger|chisq|wisconsin|…). */
  transform?: string;
  /** PCoA: negative-eigenvalue correction ("none" | "lingoes" | "cailliez"). */
  correction?: string;
  /** NMDS: how many axes the map has (default 2). */
  dimensions?: number;
  /** NMDS: random restarts — the fit can settle in a local minimum (default 20). */
  tries?: number;
  /** CA / RDA: whose distances the picture preserves ("symmetric"|"sites"|"species"). */
  scaling?: string;
  /** A constrained ordination (RDA): the explanatory columns, from the same sheet. */
  explanatory?: NodeId[];
  /** Variance partitioning: the second and (optional) third blocks, plus what to call all
   *  of them in the readout. `explanatory` above is the first block. */
  explanatory2?: NodeId[];
  explanatory3?: NodeId[];
  blockLabels?: string[];
  /** RDA: rearrangements for the permutation test of the model and of each term. */
  permutations?: number;
  /** Cluster analysis (hierarchical): linkage (ward|average|weighted|complete|single|centroid|median). */
  linkage?: string;
  /** Cluster analysis: scan k=2…kMax → elbow (within-SS) + silhouette per k + a suggested k. */
  scanK?: boolean;
  /** Cluster analysis (scanK): the largest k to try (default 10). */
  kMax?: number;
}

/** Curve-fit weighting options (the engine maps these to per-point sigma). */
const WEIGHTING: Array<{ id: string; label: string }> = [
  { id: "none", label: "No weighting (least squares)" },
  { id: "1/Y2", label: "Relative — 1/Y² (observed)" },
  { id: "1/YY", label: "Relative — 1/Ŷ² (predicted, iterative)" },
  { id: "1/Y", label: "1/Y" },
  { id: "1/X2", label: "1/X²" },
  { id: "1/X", label: "1/X" },
  { id: "1/SD2", label: "1/SD² (replicate / entered SD)" },
  { id: "poisson", label: "Poisson (count data)" },
];

/** ANOVA post-hoc options (the multiple-comparisons menu). */
const POSTHOC: Array<{ id: string; label: string }> = [
  { id: "tukey", label: "Tukey HSD (all pairs)" },
  { id: "games-howell", label: "Games-Howell (unequal SD)" },
  { id: "tamhane", label: "Tamhane T3 (unequal SD)" },
  { id: "bonferroni", label: "Bonferroni" },
  { id: "sidak", label: "Šídák" },
  { id: "holm-sidak", label: "Holm-Šídák" },
  { id: "fdr", label: "Benjamini-Hochberg FDR" },
  { id: "dunnett", label: "Dunnett (vs control)" },
];

const METHODS = [
  { id: "describe", label: "Descriptive statistics" },
  { id: "normality", label: "Normality tests (Shapiro / D'Agostino / Anderson-Darling / KS)" },
  { id: "outliers", label: "Identify outliers (Grubbs / ROUT)" },
  { id: "pcorrect", label: "P-value corrector (multiple comparisons)" },
  { id: "metaanalysis", label: "Meta-analysis (pool studies)" },
  { id: "publicationbias", label: "Publication bias (Egger + trim-and-fill)" },
  { id: "ttest", label: "t test" },
  { id: "equivalence", label: "Equivalence (TOST)" },
  { id: "permutation", label: "Permutation test" },
  { id: "bayesfactor", label: "Bayes factor (t test)" },
  { id: "anova", label: "One-way ANOVA" },
  { id: "twoway", label: "Two-way ANOVA" },
  { id: "multifactor", label: "Multifactor ANOVA (2–4 factors)" },
  { id: "mixedmodel", label: "Mixed-effects model (REML)" },
  { id: "rmanova", label: "Repeated-measures ANOVA" },
  { id: "mixedanova", label: "Two-way repeated-measures ANOVA (groups × time)" },
  { id: "nested", label: "Nested ANOVA / nested t" },
  { id: "survival", label: "Survival (Kaplan-Meier)" },
  { id: "cox", label: "Cox regression (proportional hazards)" },
  { id: "contingency", label: "Contingency (χ² / Fisher)" },
  { id: "goodnessoffit", label: "Goodness-of-fit (χ² / binomial)" },
  { id: "correlation", label: "Correlation" },
  { id: "corrmatrix", label: "Correlation matrix" },
  { id: "multipleregression", label: "Multiple linear regression" },
  { id: "logistic", label: "Logistic regression (binary)" },
  { id: "poisson", label: "Poisson regression (counts)" },
  { id: "deming", label: "Deming regression (method comparison)" },
  { id: "passingbablok", label: "Passing-Bablok (robust method comparison)" },
  { id: "blandaltman", label: "Bland-Altman (method agreement)" },
  { id: "pca", label: "Principal component analysis (PCA)" },
  { id: "ca", label: "Correspondence analysis (CA — counts, sites + species)" },
  { id: "rda", label: "Redundancy analysis (RDA — constrained by explanatory variables)" },
  { id: "cca", label: "Canonical correspondence analysis (CCA — constrained, counts)" },
  { id: "dbrda", label: "Distance-based RDA (db-RDA — constrained, any distance)" },
  { id: "permanova", label: "PERMANOVA (do groups of cases differ? any distance)" },
  { id: "varpart", label: "Variance partitioning (2-3 blocks of explanatory variables)" },
  { id: "pcoa", label: "Principal coordinates (PCoA — any distance)" },
  { id: "nmds", label: "Non-metric multidimensional scaling (NMDS)" },
  { id: "cluster", label: "Cluster analysis (k-means / hierarchical)" },
  { id: "regression", label: "Linear regression" },
  { id: "roc", label: "ROC curve" },
  { id: "curvefit", label: "Curve fit" },
  { id: "interpolate", label: "Interpolate a standard curve (X↔Y)" },
  { id: "globalfit", label: "Global curve fit (shared parameters)" },
  { id: "comparefits", label: "Compare models (AICc / extra-SS F)" },
  { id: "meltingtemp", label: "Melting temperature (Tm)" },
  { id: "auc", label: "Area under curve" },
  // Offered in the "XY - correlate, fit, classify" group of METHOD_GROUPS, so it must carry a
  // label here - without one the picker would show the identifier "curvetransform" to the user.
  { id: "curvetransform", label: "Transform a curve (smooth / derivative / integral)" },
  { id: "ancova", label: "Compare lines (ANCOVA)" },
];

/** Method id → its display label (from METHODS). Exported for the Settings saved-defaults list. */
export function methodLabel(id: string): string {
  return METHODS.find((m) => m.id === id)?.label ?? id;
}

export const VARIANTS: Record<string, Array<{ id: string; label: string; group?: string }>> = {
  ttest: [
    { id: "one-sample", label: "One-sample" },
    { id: "wilcoxon-1samp", label: "One-sample Wilcoxon (nonparametric)" },
    { id: "unpaired", label: "Unpaired — Student" },
    { id: "welch", label: "Unpaired — Welch" },
    { id: "paired", label: "Paired" },
    { id: "mann-whitney", label: "Mann-Whitney (nonparametric)" },
    { id: "wilcoxon", label: "Wilcoxon (nonparametric)" },
    { id: "ks", label: "Kolmogorov-Smirnov (two-sample)" },
    { id: "ratio-paired", label: "Ratio paired (lognormal)" },
  ],
  // Equivalence (TOST). Welch is the default for the same reason it is for the t test:
  // it does not assume the two SDs match, and agrees with Student when they do.
  equivalence: [
    { id: "unpaired", label: "Unpaired — Welch" },
    { id: "paired", label: "Paired" },
    { id: "one-sample", label: "One-sample (vs a reference value)" },
  ],
  // Permutation tests. Each variant differs in what gets rearranged, which is exactly
  // what the null hypothesis says is irrelevant — labels, signs, or the pairing itself.
  permutation: [
    { id: "unpaired", label: "Unpaired — permute group labels" },
    { id: "paired", label: "Paired — flip the sign of each difference" },
    { id: "one-sample", label: "One-sample — flip signs about a reference value" },
    { id: "correlation", label: "Correlation — re-pair Y against X" },
  ],
  bayesfactor: [
    { id: "unpaired", label: "Unpaired (two independent groups)" },
    { id: "paired", label: "Paired" },
    { id: "one-sample", label: "One-sample (vs a reference value)" },
  ],
  anova: [
    { id: "anova", label: "One-way ANOVA + Tukey" },
    { id: "welch", label: "Welch's ANOVA (unequal SD)" },
    { id: "brown-forsythe", label: "Brown-Forsythe ANOVA (unequal SD)" },
    { id: "kruskal", label: "Kruskal-Wallis (nonparametric)" },
  ],
  rmanova: [
    { id: "rmanova", label: "RM ANOVA + Greenhouse-Geisser" },
    { id: "friedman", label: "Friedman (nonparametric) + Dunn's" },
  ],
  contingency: [
    { id: "independent", label: "Independent (χ² · Fisher · risk/OR · trend)" },
    { id: "paired", label: "Paired (McNemar, 2×2)" },
  ],
  correlation: [
    { id: "pearson", label: "Pearson" },
    { id: "spearman", label: "Spearman (rank)" },
  ],
  corrmatrix: [
    { id: "pearson", label: "Pearson" },
    { id: "spearman", label: "Spearman (rank)" },
  ],
  pca: [
    { id: "standardize", label: "Standardized (correlation matrix)" },
    { id: "center", label: "Centred only (covariance matrix)" },
  ],
  regression: [
    { id: "ols", label: "Least squares (slope + intercept)" },
    { id: "origin", label: "Force through the origin (0, 0)" },
    { id: "point", label: "Force through a point (x₀, y₀)" },
  ],
  mixedmodel: [
    { id: "reml", label: "REML (restricted ML — unbiased variances)" },
    { id: "ml", label: "ML (maximum likelihood — for model comparison)" },
  ],
  curvefit: [
    { id: "4pl", label: "4PL — variable slope", group: "Dose-response" },
    { id: "3pl", label: "3PL — fixed slope", group: "Dose-response" },
    { id: "5pl", label: "5PL — asymmetric", group: "Dose-response" },
    { id: "mm", label: "Michaelis-Menten", group: "Enzyme kinetics" },
    { id: "kcat", label: "Michaelis-Menten — determine kcat", group: "Enzyme kinetics" },
    { id: "allosteric", label: "Allosteric sigmoidal", group: "Enzyme kinetics" },
    { id: "substrate_inhibition", label: "Substrate inhibition", group: "Enzyme kinetics" },
    { id: "enzyme_progress", label: "Enzyme progress curve (integrated MM)", group: "Enzyme kinetics" },
    { id: "onesite", label: "One-site specific binding", group: "Binding" },
    { id: "hill_binding", label: "Specific binding (Hill slope)", group: "Binding" },
    { id: "boltzmann", label: "Boltzmann sigmoid", group: "Sigmoidal" },
    { id: "exp_decay", label: "One-phase decay", group: "Exponential" },
    { id: "exp_decay2", label: "Two-phase decay", group: "Exponential" },
    { id: "exp_assoc", label: "One-phase association", group: "Exponential" },
    { id: "exp_growth", label: "Exponential growth", group: "Exponential" },
    { id: "gompertz", label: "Gompertz growth", group: "Growth" },
    { id: "logistic_growth", label: "Logistic growth", group: "Growth" },
    { id: "gaussian", label: "Gaussian peak", group: "Peak" },
    { id: "lorentzian", label: "Lorentzian peak", group: "Peak" },
    { id: "poly2", label: "Quadratic", group: "Polynomial" },
    { id: "poly3", label: "Cubic", group: "Polynomial" },
    { id: "line_origin", label: "Line through the origin", group: "Lines" },
    // ── more models (grouped by family — the select collects by `group`) ──
    { id: "dr_3pl_conc", label: "3PL — X is concentration", group: "Dose-response" },
    { id: "dr_4pl_conc", label: "4PL — X is concentration", group: "Dose-response" },
    { id: "twosite", label: "Two-site specific binding", group: "Binding" },
    { id: "onesite_ns", label: "One-site + nonspecific", group: "Binding" },
    { id: "homologous_competition", label: "Homologous competition (fix Hot)", group: "Binding" },
    { id: "allosteric_binding", label: "Allosteric modulator (ternary complex; fix A, KA)", group: "Binding" },
    { id: "hyperbola_offset", label: "Hyperbola with offset", group: "Binding" },
    { id: "biexp_assoc", label: "Two-phase association", group: "Exponential" },
    { id: "richards", label: "Richards (generalized logistic)", group: "Growth" },
    { id: "weibull_growth", label: "Weibull growth", group: "Growth" },
    { id: "von_bertalanffy", label: "Von Bertalanffy growth", group: "Growth" },
    { id: "gaussian_baseline", label: "Gaussian with baseline", group: "Peak" },
    { id: "lognormal_peak", label: "Log-normal peak", group: "Peak" },
    { id: "poly4", label: "Quartic", group: "Polynomial" },
    { id: "poly5", label: "Quintic", group: "Polynomial" },
    { id: "sine", label: "Sine wave", group: "Periodic" },
    { id: "power", label: "Power law (A·xᴮ)", group: "Power" },
    { id: "power_offset", label: "Power law + offset", group: "Power" },
    // ── more models (collected by `group`) ──
    { id: "ic50_4pl_conc", label: "Inhibition 4PL — X is concentration", group: "Dose-response" },
    { id: "exp_linear", label: "Decay + linear drift", group: "Exponential" },
    { id: "exp_decay3", label: "Three-phase decay", group: "Exponential" },
    { id: "stretched_exp", label: "Stretched exponential (KWW)", group: "Exponential" },
    { id: "logistic4_growth", label: "Logistic growth (4-parameter)", group: "Growth" },
    { id: "gompertz4", label: "Gompertz (4-parameter)", group: "Growth" },
    { id: "chapman_richards", label: "Chapman-Richards growth", group: "Growth" },
    { id: "gaussian2", label: "Sum of two Gaussians", group: "Peak" },
    { id: "pseudo_voigt", label: "Pseudo-Voigt", group: "Peak" },
    { id: "damped_sine", label: "Damped sine wave", group: "Periodic" },
    { id: "poly6", label: "Sextic", group: "Polynomial" },
    { id: "logarithmic", label: "Logarithmic (A + B·ln x)", group: "Simple" },
    { id: "reciprocal", label: "Reciprocal (A + B/x)", group: "Simple" },
    { id: "rational11", label: "Rational (1,1)", group: "Simple" },
    { id: "sqrt_fit", label: "Square-root (A + B·√x)", group: "Simple" },
    // ── more models (collected by `group`) ──
    { id: "dr_norm_3pl", label: "Normalized response — constant slope", group: "Dose-response" },
    { id: "dr_norm_4pl", label: "Normalized response — variable slope", group: "Dose-response" },
    { id: "dr_norm_4pl_conc", label: "Normalized — variable slope, X is concentration", group: "Dose-response" },
    { id: "ic50_4pl_log", label: "Inhibition 4PL — log(inhibitor)", group: "Dose-response" },
    { id: "ic50_3pl_log", label: "Inhibition 3PL — log(inhibitor)", group: "Dose-response" },
    { id: "ic50_norm_4pl", label: "Inhibition, normalized — variable slope (absolute IC50)", group: "Dose-response" },
    { id: "ic50_norm_3pl", label: "Inhibition, normalized — constant slope (absolute IC50)", group: "Dose-response" },
    { id: "ic50_3pl_conc", label: "Inhibition 3PL — X is concentration", group: "Dose-response" },
    { id: "dr_5pl_conc", label: "5PL asymmetric — X is concentration", group: "Dose-response" },
    { id: "biphasic_dr", label: "Biphasic dose-response", group: "Dose-response" },
    { id: "bell_dr", label: "Bell-shaped dose-response", group: "Dose-response" },
    { id: "competition_1site", label: "One-site competition (log inhibitor)", group: "Binding" },
    { id: "competition_2site", label: "Two-site competition (log inhibitor)", group: "Binding" },
    { id: "total_binding", label: "One-site total binding", group: "Binding" },
    { id: "assoc_then_dissoc", label: "Association then dissociation", group: "Binding" },
    { id: "plateau_then_decay", label: "Plateau then one-phase decay", group: "Exponential" },
    { id: "plateau_then_assoc", label: "Plateau then one-phase association", group: "Exponential" },
    { id: "mmf_growth", label: "Morgan-Mercer-Flodin", group: "Growth" },
    { id: "gaussian3", label: "Sum of three Gaussians", group: "Peak" },
    { id: "segmental", label: "Segmental (broken line / hockey-stick)", group: "Lines" },
    // ── more models (collected by `group`) ──
    { id: "morrison_ki", label: "Morrison tight-binding Ki", group: "Enzyme kinetics" },
    { id: "binding_depletion", label: "One-site binding with ligand depletion", group: "Binding" },
    { id: "binding_depletion_ns", label: "Total binding with ligand depletion", group: "Binding" },
    { id: "voigt", label: "Voigt peak", group: "Peak" },
    { id: "emg", label: "Exponentially-modified Gaussian", group: "Peak" },
    { id: "pearson7", label: "Pearson VII peak", group: "Peak" },
    { id: "sine2", label: "Sum of two harmonics", group: "Periodic" },
    { id: "sine_drift", label: "Sine wave with linear drift", group: "Periodic" },
    { id: "boltzmann_double", label: "Double Boltzmann (two transitions)", group: "Sigmoidal" },
    { id: "power_law_cutoff", label: "Power law with exponential cutoff", group: "Power" },
    { id: "probit_dr", label: "Probit (cumulative normal)", group: "Dose-response" },
    { id: "weibull_sigmoid", label: "Weibull sigmoid", group: "Dose-response" },
    { id: "biphasic_dr_conc", label: "Biphasic — X is concentration", group: "Dose-response" },
    { id: "bell_dr_conc", label: "Bell-shaped — X is concentration", group: "Dose-response" },
    { id: "dr_norm_3pl_conc", label: "Normalized — constant slope, X is concentration", group: "Dose-response" },
    { id: "richards_dr", label: "Richards (asymmetric)", group: "Dose-response" },
    { id: "hormesis_bc", label: "Hormesis (Brain-Cousens)", group: "Dose-response" },
    // ── centered polynomials (fit about the mean X; reduces collinearity) ──
    { id: "poly2_centered", label: "Quadratic (centered)", group: "Polynomial" },
    { id: "poly3_centered", label: "Cubic (centered)", group: "Polynomial" },
    { id: "poly4_centered", label: "Quartic (centered)", group: "Polynomial" },
    { id: "poly5_centered", label: "Quintic (centered)", group: "Polynomial" },
    { id: "poly6_centered", label: "Sextic (centered)", group: "Polynomial" },
    { id: "linear", label: "Linear", group: "Model-free" },
    { id: "lowess", label: "LOWESS smoother", group: "Model-free" },
    { id: "spline", label: "Smoothing spline (cubic)", group: "Model-free" },
    // A headline capability: type any Y = f(X, params…) and fit it. Kept last so
    // the default curvefit model stays 4PL (the first entry), and given its own group.
    { id: "custom", label: "Enter your own equation…", group: "User-defined" },
  ],
  auc: [
    { id: "zero", label: "Baseline at Y = 0" },
    { id: "min", label: "Baseline at the minimum Y" },
    { id: "mean", label: "Baseline at the mean Y" },
    { id: "custom", label: "Baseline at a custom Y value" },
  ],
  curvetransform: [
    { id: "smooth", label: "Smooth (Savitzky-Golay)" },
    { id: "differentiate", label: "First derivative (dY/dX)" },
    { id: "differentiate2", label: "Second derivative (d²Y/dX²)" },
    { id: "integrate", label: "Integrate (cumulative ∫Y·dX)" },
    // Michaelis-Menten linearizations — diagnostic views (X = [S], Y = v). They are
    // offered so a kineticist can eyeball the mechanism the familiar way; the engine
    // labels the implied Vmax/KM as diagnostic and points back at the nonlinear fit.
    { id: "lineweaver_burk", label: "Lineweaver-Burk — 1/v vs 1/[S] (diagnostic)" },
    { id: "eadie_hofstee", label: "Eadie-Hofstee — v vs v/[S] (diagnostic)" },
    { id: "hanes_woolf", label: "Hanes-Woolf — [S]/v vs [S] (diagnostic)" },
  ],
  outliers: [
    { id: "iterative", label: "Iterative Grubbs (remove + repeat)" },
    { id: "single", label: "Single (most-extreme only)" },
    { id: "rout", label: "ROUT (FDR-based, handles multiple)" },
  ],
  metaanalysis: [
    { id: "linear", label: "Effects are differences (pool as entered)" },
    { id: "log", label: "Effects are ratios — pool in log space (OR / RR / HR)" },
  ],
  publicationbias: [
    { id: "linear", label: "Effects are differences (assess as entered)" },
    { id: "log", label: "Effects are ratios — assess in log space (OR / RR / HR)" },
  ],
  pcorrect: [
    { id: "holm", label: "Holm (Holm-Bonferroni, step-down)", group: "Family-wise error rate" },
    { id: "bonferroni", label: "Bonferroni", group: "Family-wise error rate" },
    { id: "holm-sidak", label: "Holm-Šídák (step-down)", group: "Family-wise error rate" },
    { id: "sidak", label: "Šídák (single-step)", group: "Family-wise error rate" },
    { id: "fdr_bh", label: "Benjamini-Hochberg (FDR)", group: "False-discovery rate" },
    { id: "fdr_by", label: "Benjamini-Yekutieli (FDR)", group: "False-discovery rate" },
  ],
};
// Global fit + Compare models offer the same registry equations as Curve fit, minus
// the model-free smoothers (AICc needs a counted parameter set).
// Global fit additionally offers the enzyme mechanism-discrimination models — global-fit
// only (each curve is one inhibitor concentration [I], a per-dataset constant; a single
// curve can't separate KM from Ki), so they are absent from curvefit/comparefits/interpolate.
const GLOBALFIT_ONLY: Array<{ id: string; label: string; group?: string }> = [
  { id: "competitive_inhibition", label: "Competitive inhibition", group: "Enzyme inhibition" },
  { id: "noncompetitive_inhibition", label: "Noncompetitive inhibition", group: "Enzyme inhibition" },
  { id: "uncompetitive_inhibition", label: "Uncompetitive inhibition", group: "Enzyme inhibition" },
  { id: "mixed_inhibition", label: "Mixed-model inhibition", group: "Enzyme inhibition" },
  { id: "assoc_kinetics", label: "Association kinetics (multiple [ligand])", group: "Binding kinetics" },
  { id: "motulsky_mahan", label: "Competitive binding kinetics (Motulsky-Mahan; fix L)", group: "Binding kinetics" },
  // ── pharmacology tail (all global fits) ──
  { id: "schild", label: "Gaddum/Schild EC50 shift (antagonist [B])", group: "Dose-response (special)" },
  { id: "allosteric_ec50", label: "Allosteric EC50 shift (modulator [B])", group: "Dose-response (special)" },
  { id: "operational", label: "Operational model — partial agonist", group: "Dose-response (special)" },
  { id: "operational_depletion", label: "Operational model — receptor depletion (q)", group: "Dose-response (special)" },
  { id: "total_nonspecific", label: "Total & nonspecific binding — one site", group: "Binding (global)" },
  { id: "total_nonspecific_2site", label: "Total & nonspecific binding — two sites", group: "Binding (global)" },
  { id: "total_nonspecific_depletion", label: "Total & nonspecific binding — with ligand depletion", group: "Binding (global)" },
];
// The user-defined ("custom") entry only carries its equation through the curvefit
// payload — global fit / compare / interpolate don't forward it, so exclude it there.
VARIANTS["globalfit"] = [...VARIANTS["curvefit"]!.filter((v) => v.group !== "Model-free" && v.id !== "custom"), ...GLOBALFIT_ONLY];
VARIANTS["comparefits"] = VARIANTS["curvefit"]!.filter((v) => v.group !== "Model-free" && v.id !== "custom");
// Interpolation reuses every fittable equation (linear + all nonlinear) — but not the
// model-free smoothers (LOWESS / spline), which have no invertible closed form to read X
// off, nor the user-defined equation (no forwarded formula / general inverse).
VARIANTS["interpolate"] = VARIANTS["curvefit"]!.filter((v) => v.id !== "lowess" && v.id !== "spline" && v.id !== "custom");

/** A model row in the Type picker. `viaMethod` marks a model offered under one method's
 *  family door but fittable only by another — picking it switches the method. */
interface CurveModelOption {
  id: string;
  label: string;
  group?: string | undefined;
  viaMethod?: string | undefined;
}
/** Curve-fit families that additionally offer models belonging to another method, keyed by
 *  the equation `group` of the door. The enzyme door names the mechanism-inhibition models
 *  in its banner; they are global-fit only, so it offers them and routes the user there. */
const CROSS_METHOD_OFFERS: Record<string, { method: string; ids: string[] }> = {
  "Enzyme kinetics": {
    method: "globalfit",
    ids: ["competitive_inhibition", "noncompetitive_inhibition", "uncompetitive_inhibition", "mixed_inhibition"],
  },
};

/** Two-field labels per method. XY methods take an X column + a Y dataset. */
const TWO_LABELS: Record<string, [string, string]> = {
  correlation: ["Variable X", "Variable Y"],
  regression: ["Predictor (x)", "Outcome (y)"],
  curvefit: ["X (dose)", "Y (response)"],
  deming: ["Method X", "Method Y"],
  passingbablok: ["Method X", "Method Y"],
  blandaltman: ["Method A", "Method B"],
  interpolate: ["X (blank row = unknown)", "Y (blank row = unknown)"],
  comparefits: ["X (dose)", "Y (response)"],
  roc: ["Predictor (score)", "Outcome (0 / 1)"],
  auc: ["X (e.g. time)", "Y (response)"],
  curvetransform: ["X", "Y (curve)"],
  // Permutation reads two groups for most variants but an X/Y pair for `correlation`,
  // so the labels name both readings rather than mislabelling one of them.
  permutation: ["Group A / X", "Group B / Y"],
};

/** "Common analyses" tiles — a by-purpose (scientific-domain) fast path at the top
 *  of the Analyze landing, so the enzyme-kinetics / binding / dose-response curve
 *  fits (and the top statistical goals) aren't buried in a flat list. Each tile
 *  jumps straight into that method's configure view, scoped to its equation family
 *  where relevant (`focus` → ANALYZE_FOCUS group + banner). */
// The tile list, the data-type cards and the ranking live in `analyzeGoals.ts` so the
// applicability rules can be tested across every table kind.

/** Small inline glyph for a Common-analysis tile (20×20, stroked). */
function GoalIcon({ goal }: { goal: string }): ReactElement {
  const P: Record<string, ReactElement> = {
    "dose-response": <path d="M3 16c3 0 3.5-1 5-6s2-6 4-6 3 5 5 5" />, // sigmoid-ish
    enzyme: <path d="M3 16c4 0 6-2 7-5s3-5 7-5" />, // hyperbola → plateau
    binding: <><circle cx="10" cy="10" r="5" /><circle cx="10" cy="10" r="1.6" /></>, // target
    curvefit: <><path d="M3 15c4-1 6-8 14-9" /><circle cx="6" cy="13" r="1" /><circle cx="12" cy="8" r="1" /></>,
    compare: <><rect x="4" y="9" width="4" height="8" /><rect x="12" y="5" width="4" height="12" /></>, // bars
    correlation: <><circle cx="6" cy="14" r="1.2" /><circle cx="10" cy="10" r="1.2" /><circle cx="14" cy="7" r="1.2" /><path d="M4 16L16 6" /></>,
    regression: <><path d="M3 16L17 6" /><circle cx="7" cy="12" r="1.2" /><circle cx="13" cy="8" r="1.2" /></>,
    survival: <path d="M3 5v4h4v4h4v4h6" />, // step-down staircase
    roc: <><path d="M4 16v-4l4-4 8-2" /><path d="M4 16L16 4" strokeDasharray="2 2" /></>,
    pca: <><path d="M10 3v14M3 10h14" opacity="0.5" /><circle cx="13" cy="7" r="1.3" /><circle cx="7" cy="13" r="1.3" /><circle cx="12" cy="12" r="1.3" /></>,
  };
  return (
    <svg viewBox="0 0 20 20" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {P[goal] ?? P.curvefit}
    </svg>
  );
}

/**
 * Landing-page data-type cards. Each card maps a `TableKind` (the data type /
 * graph type the analysis applies to) to the analyses it unlocks — a clean
 * partition of every method. The card matching the current table is highlighted;
 * clicking a card filters the analysis list below to that data type. The cards
 * group the analyses by the data type they apply to; the text list under them
 * keeps the question-based grouping (`METHOD_GROUPS`).
 */

const FIT_PREVIEW_METHODS = new Set(["curvefit", "interpolate", "comparefits", "globalfit"]);
const MODEL_EQUATION_PLACEHOLDER: Record<string, string> = {
  lowess: "Flexible smoother; no fixed equation.",
  spline: "Cubic smoothing spline; shape depends on smoothing.",
};

/** Shared details renderer for landing cards and the active configuration. */
function InfoPanel({
  method,
  variant,
  modelTemplate,
  customEquation,
}: {
  method: string;
  variant?: string | undefined;
  modelTemplate?: string | null | undefined;
  customEquation?: string | undefined;
}): ReactElement | null {
  const info = METHOD_INFO[method];
  if (!info) return null;
  const guidance = variant ? variantGuidance(method, variant) : undefined;
  const methodGuidance = ANALYSIS_GUIDANCE[method];
  const activeGuidance = guidance ?? methodGuidance;
  const note = variant ? VARIANT_NOTE[`${method}:${variant}`] : undefined;
  const isModelFit = !!variant && FIT_PREVIEW_METHODS.has(method);
  const equation = modelTemplate
    ?? (method === "curvefit" && variant === "custom" && customEquation?.trim() ? "Y = " + customEquation.trim() : undefined)
    ?? (method === "curvefit" && variant ? MODEL_EQUATION_PLACEHOLDER[variant] : undefined)
    ?? (isModelFit ? "Equation preview unavailable for this model." : activeGuidance?.definition ?? info.equation);
  return (
    <div className="aninfo" aria-label="About this test">
      <div className="aninfo-eq">{equation}</div>
      <p className="aninfo-ex">{activeGuidance?.explain ?? info.explain}</p>
      {guidance && <p className="aninfo-context">General context: {info.explain}</p>}
      <p className="aninfo-use">
        <span className="aninfo-tag aninfo-do">Use when</span> {activeGuidance?.whenToUse ?? info.whenToUse}
      </p>
      {(activeGuidance?.whenNotToUse ?? info.whenNotToUse) && (
        <p className="aninfo-use">
          <span className="aninfo-tag aninfo-dont">Not for</span> {activeGuidance?.whenNotToUse ?? info.whenNotToUse}
        </p>
      )}
      {(activeGuidance?.assumptions ?? []).map((assumption) => (
        <p className="aninfo-use" key={`assumption-${assumption}`}>
          <span className="aninfo-tag aninfo-note">Assumes</span> {assumption}
        </p>
      ))}
      {(activeGuidance?.warnings ?? []).map((warning) => (
        <p className="aninfo-use" key={`warning-${warning}`}>
          <span className="aninfo-tag aninfo-dont">Check</span> {warning}
        </p>
      ))}
      {(activeGuidance?.alternatives ?? []).map((alternative) => (
        <p className="aninfo-use" key={alternative}>
          <span className="aninfo-tag aninfo-note">Alternative</span> {alternative}
        </p>
      ))}
      {note && (
        <p className="aninfo-use">
          <span className="aninfo-tag aninfo-note">This option</span> {note}
        </p>
      )}
    </div>
  );
}
interface Opt {
  id: NodeId;
  name: string;
}

/**
 * Methods whose column selection is a set of groups, so row categories can stand in
 * for datasets. Deliberately excludes the methods that share the same picker for
 * something else: PCA / correlation-matrix / multiple-regression / Cox / mixed pick
 * variables, and goodness-of-fit reads its chosen column's cells directly.
 */
/** The paired / matched two-sample t-test variants. Their 3+-group analog is a
 *  repeated-measures ANOVA, not a one-way ANOVA, so the "vs a control" nudge skips them. */
const PAIRED_TTEST_VARIANTS = new Set(["paired", "wilcoxon", "ratio-paired"]);

/** Unpaired parametric t-test variants that can run "every group vs one control" directly from the
 *  t-test path — each maps to the matching t-based multiple-vs-control test. (Mann-Whitney has no
 *  rank-based vs-control post-hoc in the engine, so it keeps the "switch to ANOVA" nudge instead.) */
const TTEST_VS_CONTROL_VARIANTS = new Set(["unpaired", "welch"]);

/**
 * The analysis to run when the user designates a control on the t-test path. "Each group vs one
 * control, corrected for the multiple tests" is a one-way ANOVA post-hoc — Dunnett for equal
 * variances (Student), Games-Howell for unequal (Welch) — so this builds exactly that spec from the
 * t-test's own variant. Both post-hocs are independently cross-checked (crosscheck.py).
 * `controlIndex` indexes into `columns` (all the groups, in table order).
 */
export function ttestVsControlSpec(args: {
  variant: string | undefined;
  columns: NodeId[];
  controlIndex: number;
  conf: number;
}): AnalyzeSpec {
  return {
    method: "anova",
    variant: "anova",
    columns: args.columns,
    conf: args.conf,
    posthoc: args.variant === "welch" ? "games-howell" : "dunnett",
    scheme: "vs-control",
    control: args.controlIndex >= 0 ? args.controlIndex : 0,
  };
}

const ROW_GROUP_METHODS = new Set([
  "describe",
  "normality",
  "outliers",
  "ttest",
  "equivalence",
  "permutation",
  "bayesfactor",
  "anova",
]);

/**
 * AnalyzeDialog — pick a test + the source table's dataset(s) + options, then run
 * Groups are **datasets**: a dataset's replicate subcolumns are pooled as
 * independent observations. One dataset (describe/normality/one-sample),
 * two (t test = two groups; correlation/regression/curvefit = X column + Y
 * dataset), or many (ANOVA groups).
 */
/** A guided "front door" — a named entry that opens this dialog focused on one analysis
 *  family, with a plain-English title + banner (and, for curve fits, a preselected equation
 *  family). The dialog looks these up by `focusKind`; AppShell's front-door commands just pass
 *  the kind. Every analysis family that is otherwise hard to find can have one. */
interface AnalyzeFocus {
  /** The method this focus applies to — the banner/title show only while this method is selected. */
  method: string;
  /** Dialog title (overrides the plain method label). */
  title: string;
  /** For curve-fit families: the equation `group` to preselect + scope the model list to. */
  group?: string;
  /** Guided-workflow banner shown under the header. */
  blurb: ReactNode;
}
export const ANALYZE_FOCUS: Record<string, AnalyzeFocus> = {
  "dose-response": {
    method: "curvefit",
    title: "Dose-response — EC50 / IC50 curve fit",
    group: "Dose-response",
    blurb: (
      <>
        <p className="aninfo-ex" style={{ margin: "0 0 6px", opacity: 0.85 }}>
          Fit a dose-response curve to estimate <strong>EC50 / IC50</strong> and the Hill slope. Pick a
          model below — <strong>4PL (variable slope)</strong> is the usual choice; use <em>Inhibition</em>
          {" "}models for a decreasing curve, or <em>Normalized</em> if your Y runs 0–100 %.
        </p>
        <p className="aninfo-ex" style={{ margin: "0 0 8px", opacity: 0.7, fontSize: 11 }}>
          Constrain a plateau (fix <em>Bottom</em>/<em>Top</em>) just below. To ask whether two curves'
          EC50s differ, fit them with <strong>Global curve fit</strong> (share logEC50) or{" "}
          <strong>Compare models</strong>; to read unknown concentrations off a standard curve, use{" "}
          <strong>Interpolate a standard curve</strong> — all in the test list above.
        </p>
      </>
    ),
  },
  "enzyme-kinetics": {
    method: "curvefit",
    title: "Enzyme kinetics — Michaelis-Menten & inhibition",
    group: "Enzyme kinetics",
    blurb: (
      <p className="aninfo-ex" style={{ margin: "0 0 8px", opacity: 0.85 }}>
        Fit enzyme-kinetics models to estimate <strong>Vmax</strong> and <strong>KM</strong>.
        Michaelis-Menten is the classic; <em>kcat</em> adds the turnover number and the specificity
        constant kcat/KM, and the allosteric sigmoidal covers cooperativity. The <em>inhibition</em>{" "}
        models (competitive / noncompetitive / uncompetitive / mixed) are in the list below marked{" "}
        <strong>global fit</strong> — they need one curve per [inhibitor] to separate <strong>Ki</strong>{" "}
        from KM, so picking one opens it in <strong>Global curve fit</strong>.
      </p>
    ),
  },
  binding: {
    method: "curvefit",
    title: "Receptor binding — saturation / competition",
    group: "Binding",
    blurb: (
      <p className="aninfo-ex" style={{ margin: "0 0 8px", opacity: 0.85 }}>
        Fit receptor-binding models. <strong>One-site saturation</strong> gives <strong>Bmax</strong> and
        {" "}<strong>Kd</strong>; use the competition models for a displacement curve, or the kinetics models
        for association / dissociation. For a competitive IC50 → <strong>Ki</strong>, the Dose-response
        analysis offers a Cheng-Prusoff option for its inhibition models.
      </p>
    ),
  },
  interpolate: {
    method: "interpolate",
    title: "Interpolate a standard curve (read unknowns)",
    blurb: (
      <p className="aninfo-ex" style={{ margin: "0 0 8px", opacity: 0.85 }}>
        Read unknown concentrations off a fitted standard curve: enter your standards as (X, Y) rows and
        {" "}<strong>leave X blank</strong> on a row to interpolate its concentration (or leave Y blank to read
        Y). Pick the standard-curve model below. Each answer carries a CI; out-of-range unknowns are flagged,
        not extrapolated.
      </p>
    ),
  },
  "melting-temperature": {
    method: "meltingtemp",
    title: "Melting temperature — Tm and ΔTm",
    blurb: (
      <p className="aninfo-ex" style={{ margin: "0 0 8px", opacity: 0.85 }}>
        Find the <strong>Tm</strong> of melt curves (thermal shift, CD, absorbance, DNA/RNA): temperature in X, one
        {" "}column per sample, replicates as subcolumns. Each replicate gets a Tm by sigmoid fit and by first
        {" "}derivative; pick a <strong>control sample</strong> for ΔTm, and set a temperature window to leave out a
        {" "}signal drop after the melt.
      </p>
    ),
  },
  "method-comparison": {
    method: "deming",
    title: "Method comparison — Deming / Passing-Bablok / Bland-Altman",
    blurb: (
      <p className="aninfo-ex" style={{ margin: "0 0 8px", opacity: 0.85 }}>
        Compare two measurement methods. <strong>Deming</strong> fits a line accounting for error in both;
        {" "}<strong>Passing-Bablok</strong> is robust / nonparametric; <strong>Bland-Altman</strong> plots each
        pair's difference vs mean with the bias and 95% limits of agreement. Switch among them in the Test
        list above.
      </p>
    ),
  },
};

export function AnalyzeDialog({
  table,
  onRun,
  onCancel,
  initialMethod,
  initialVariant,
  focusKind,
  initialSuggestion,
  recommendations = [],
  curveModelRecommendations = [],
}: {
  table: DataTable;
  onRun: (spec: AnalyzeSpec) => void;
  onCancel: () => void;
  /** Open straight to this method (e.g. the Dose-response front door → "curvefit"). */
  initialMethod?: string | undefined;
  /** Preselect this model/variant on open (e.g. "4pl"). */
  initialVariant?: string | undefined;
  /** Opened via a guided front door → key into ANALYZE_FOCUS for a title + banner (+ family scope). */
  focusKind?: string | undefined;
  /** Optional analysis suggestion selected before the dialog opened. */
  initialSuggestion?: Suggestion | undefined;
  /** Ranked analysis suggestions shown on the landing page. */
  recommendations?: Suggestion[] | undefined;
  /** Ranked curve-fit model choices shown inside the Type picker. */
  curveModelRecommendations?: CurveModelRecommendation[] | undefined;
}) {
  const datasets = tableDatasets(table);
  const dsOpts: Opt[] = datasets.map((d) => ({ id: d.id, name: d.name }));
  const colOpts: Opt[] = table.columns.map((c) => ({ id: c.id, name: c.name }));
  const xColId = xColumn(table)?.id ?? colOpts[0]?.id ?? "";
  // ── Group-by-row-category ──────────────────────────────────────────────────────
  // A tidy sheet ("Group" column of categories + one value dataset) states its groups
  // in rows. `rowGroupsUsable` decides whether that reading applies (see its guards);
  // when it does, the group pickers offer the categories instead of the lone dataset,
  // addressed by virtual ids that `datasetValues`/`datasetName` resolve. Everything
  // else — the fit/outcome/event selects — keeps using the real datasets.
  const rowGroupsAvailable = rowGroupsUsable(table);
  const labelColId = rowGroupColumn(table) ?? xColId;
  const labelColName = table.columns.find((c) => c.id === labelColId)?.name ?? "the first column";
  const rowOpts: Opt[] = rowGroupsAvailable
    ? rowGroupLevels(table, labelColId).map((lv) => ({ id: rowGroupId(labelColId, lv), name: lv }))
    : [];
  // Default on where available: otherwise the only thing the pickers can offer is the
  // single value column twice over, which is a dead end.
  const [groupsFromRows, setGroupsFromRows] = useState(true);
  const useRowGroups = rowGroupsAvailable && groupsFromRows;
  const seedSuggestion = initialSuggestion?.kind === "analysis" ? initialSuggestion : undefined;
  const seedColumns = seedSuggestion?.columns ?? [];
  const seedMethod = seedSuggestion?.method ?? initialMethod ?? "describe";
  const seedVariant = seedSuggestion?.variant ?? initialVariant ?? "unpaired";
  const seedFocusKind = seedSuggestion?.focusKind ?? focusKind;
  const seedXy = isXYMethod(seedMethod);
  const seedMode = columnMode(seedMethod, seedVariant);
  // Seeds for the group pickers come from whichever list those pickers will show.
  const seedPick: Opt[] = rowGroupsAvailable && !seedXy ? rowOpts : dsOpts;
  const seedDatasetIds = seedColumns.filter((id) => seedPick.some((d) => d.id === id));
  const seedX = seedXy ? seedColumns[0] ?? xColId : xColId;
  const seedA = seedXy ? seedColumns[1] ?? dsOpts[0]?.id ?? "" : seedDatasetIds[0] ?? seedPick[0]?.id ?? "";
  const seedB = seedDatasetIds.find((id) => id !== seedA) ?? seedPick.find((d) => d.id !== seedA)?.id ?? seedA;
  /**
   * Variable-set methods (PCA · correlation matrix · clustering) take every numeric column by
   * default and never a text one: a "first two datasets" seed would tick "Cell type" (text)
   * and "Size" for a PCA of the demo sheet and leave the other three measures unticked.
   * Two-group tests keep the first two.
   */
  const VARIABLE_SET_METHODS = new Set(["pca", "corrmatrix", "cluster", "permanova"]);
  const numericIds = (opts: Opt[]): NodeId[] => opts.filter((o) => !isTextColumn(table, o.id)).map((o) => o.id);
  const textIds = (opts: Opt[]): NodeId[] => opts.filter((o) => isTextColumn(table, o.id)).map((o) => o.id);
  const seedGroups =
    seedMode === "many" && seedDatasetIds.length ? seedDatasetIds
    : VARIABLE_SET_METHODS.has(seedMethod) && numericIds(seedPick).length >= 2 ? numericIds(seedPick)
    : seedPick.slice(0, 2).map((d) => d.id);
  // PCA "Group by": the sheet's one text column, when it has exactly one (the grouping label).
  const seedGroupBy: NodeId | "" = (seedMethod === "pca" || seedMethod === "permanova") && textIds(dsOpts).length === 1 ? textIds(dsOpts)[0]! : "";

  const [method, setMethod] = useState(seedMethod);
  const [variant, setVariant] = useState(seedVariant);
  // Curve-fit equation family filter ("" = all). Front doors open scoped to their family; the
  // in-dialog picker lets the user browse every family without a flat 100-model dropdown.
  const [family, setFamily] = useState<string>(() => (seedFocusKind && ANALYZE_FOCUS[seedFocusKind]?.group) || "");
  // Active guided-focus key (banner + family scope). Seeded from the prop; a
  // Common-analysis tile sets it so its curve-fit family opens focused too.
  const [focusKey, setFocusKey] = useState<string | undefined>(seedFocusKind);
  // "Make these the default for this analysis": remember a whitelist of the
  // current option state (never columns/data) so the dialog re-opens pre-configured.
  // Initialised to whether this method already has a saved default.
  const [makeDefault, setMakeDefault] = useState(() => getAnalysisDefault(method) != null);
  // Contingency 2×2 effect-size CI method: "score" (Koopman RR + Newcombe risk-diff) | "log" (Katz + Wald).
  const [ciMethod, setCiMethod] = useState("score");
  // Survival: pairwise log-rank comparisons of ≥3 curves + the multiplicity correction.
  const [survPairwise, setSurvPairwise] = useState(false);
  const [survPwMethod, setSurvPwMethod] = useState("holm-sidak");
  // Bland-Altman: percent-of-mean difference + the limits-of-agreement multiplier.
  const [baPercent, setBaPercent] = useState(false);
  const [baK, setBaK] = useState(1.96);
  // Deming: error-variance ratio λ = σ²(Y)/σ²(X) (1 = orthogonal/geometric-mean regression).
  const [demingLambda, setDemingLambda] = useState(1);
  // AUC: tiny-peak height filter (fraction of the tallest peak) + optional custom baseline value.
  const [aucMinPeak, setAucMinPeak] = useState(0);
  const [aucBaselineValue, setAucBaselineValue] = useState(0);
  // Second model for "compare models" (model B; `variant` is model A).
  const [variant2, setVariant2] = useState("3pl");
  // Landing (chooser) vs configure (options + Run). The dialog opens on the landing.
  // Opened via a preset door (e.g. Dose-response → curvefit) → jump straight to the
  // configure form for that method instead of the method-picker landing page.
  const [view, setView] = useState<"landing" | "configure">(seedSuggestion || initialMethod ? "configure" : "landing");
  // Optional data-type filter applied to the landing analysis list (clickable cards).
  const [filterKind, setFilterKind] = useState<TableKind | null>(null);
  // Guided landing is the default; the complete expert catalog remains one click away.
  const [showCatalog, setShowCatalog] = useState(false);
  const [catalogQuery, setCatalogQuery] = useState("");
  // Which recommendation/method has its details panel expanded on the landing.
  const [expandedRecommendation, setExpandedRecommendation] = useState<string | null>(null);
  const [detailsFor, setDetailsFor] = useState<string | null>(null);
  const [typePickerOpen, setTypePickerOpen] = useState(false);
  const [curveModelSearch, setCurveModelSearch] = useState("");
  const [curveGoal, setCurveGoal] = useState<CurveModelGoal | "">("");
  const [expandedCurveModel, setExpandedCurveModel] = useState<string | null>(null);
  const typePickerRef = useRef<HTMLDivElement>(null);// colA/colB are datasets (groups / Y); xSel is the X column for XY methods.
  const [colA, setColA] = useState<NodeId>(seedA);
  const [colB, setColB] = useState<NodeId>(seedB);
  const [xSel, setXSel] = useState<NodeId>(seedX);
  const [rocCompare, setRocCompare] = useState(false);
  const [marker2, setMarker2] = useState<NodeId>("");
  const [mu, setMu] = useState(0);
  // Equivalence bound. 0 is not a usable default — it is the "unset" state, and Run is
  // blocked until the user supplies a real bound (see canRun).
  const [bound, setBound] = useState(0);
  const [boundMode, setBoundMode] = useState("absolute");
  // Resampling. The seed is exposed rather than hidden: a Monte Carlo p-value is only
  // reproducible if the reader can see (and re-use) the seed that produced it.
  const [nResamples, setNResamples] = useState(10000);
  const [seed, setSeed] = useState(12345);
  const [rscale, setRscale] = useState("medium");
  const [weighting, setWeighting] = useState("none");
  const [rout, setRout] = useState(false);
  // Nonlinear "flag poor fits": master toggle + per-criterion thresholds (kept as strings so a
  // field can be blanked to disable that one criterion; parsed into spec.flag on Run).
  const [flagOn, setFlagOn] = useState(false);
  const [flagThresholds, setFlagThresholds] = useState<Record<keyof FitFlagThresholds, string>>({
    enabled: "",
    rSqBelow: String(DEFAULT_FIT_FLAGS.rSqBelow),
    nBelow: String(DEFAULT_FIT_FLAGS.nBelow),
    dependencyAbove: String(DEFAULT_FIT_FLAGS.dependencyAbove),
    skewnessAbove: String(DEFAULT_FIT_FLAGS.skewnessAbove),
    residNormalityBelow: String(DEFAULT_FIT_FLAGS.residNormalityBelow),
    outliersAbove: String(DEFAULT_FIT_FLAGS.outliersAbove),
  });
  // Dose-response extras: EC levels at any response (comma-separated %) + Cheng-Prusoff Ki inputs.
  const [ecLevelsText, setEcLevelsText] = useState("");
  const [kiConc, setKiConc] = useState("");
  const [kiKd, setKiKd] = useState("");
  const [smoothWindow, setSmoothWindow] = useState(0); // 0 = auto
  // Linear regression: coordinates of the fixed point the line is forced through (variant "point").
  const [throughX, setThroughX] = useState(0);
  const [throughY, setThroughY] = useState(0);
  const [sharedParams, setSharedParams] = useState<Set<string>>(new Set());
  const [compareOneCurve, setCompareOneCurve] = useState(false);
  // Nonlinear parameter constraints (curvefit/globalfit): fix a parameter to a value, or
  // bound it. Kept as strings (raw input); parsed into spec.fixed / spec.paramBounds on Run.
  const [fixedParams, setFixedParams] = useState<Record<string, string>>({});
  const [paramBounds, setParamBounds] = useState<Record<string, { lo?: string; hi?: string }>>({});
  // User-defined-equation fit (curvefit variant "custom"): the raw equation text + a
  // starting value per detected parameter (raw strings; parsed to numbers on Run).
  const [equation, setEquation] = useState("");
  const [initValues, setInitValues] = useState<Record<string, string>>({});
  // Global-fit with a per-dataset constant (enzyme inhibition): dataset id → [I] value.
  const [constVals, setConstVals] = useState<Record<string, number>>({});
  const [groups, setGroups] = useState<Set<NodeId>>(new Set(seedGroups));
  // PCA: optional grouping column (cases coloured + an ellipse per group). "" = none.
  const [groupBy, setGroupBy] = useState<NodeId | "">(seedGroupBy);
  // PCA: how many components to retain + the chosen rule's parameter.
  const [pcaSelection, setPcaSelection] = useState("kaiser");
  const [pcaKaiser, setPcaKaiser] = useState(1);
  const [pcaFixedK, setPcaFixedK] = useState(2);
  const [pcaVariancePct, setPcaVariancePct] = useState(80);
  const [pcaParallelPct, setPcaParallelPct] = useState(95);
  const [posthoc, setPosthoc] = useState("tukey");
  const [scheme, setScheme] = useState("all-pairs");
  // Two-way ANOVA post-hoc: which family of means to compare ("none" = no post-hoc) + the test.
  const [twowayCompare, setTwowayCompare] = useState("none");
  const [twowayPosthoc, setTwowayPosthoc] = useState("tukey");
  const [mixedCompare, setMixedCompare] = useState("none");
  const [controlId, setControlId] = useState<NodeId>(dsOpts[0]?.id ?? "");
  // The control group chosen on the t-test path ("every group vs this control"). Separate from the
  // ANOVA `controlId` above because the t-test path picks from all datasets (pickOpts), not the
  // ANOVA checkbox set.
  const [ttestControlId, setTtestControlId] = useState<NodeId>("");
  // Melting temperature: baselines, the temperature window (blank = no bound) and the control
  // sample for ΔTm ("" = none). The control picks from the samples ticked above.
  const [meltSloped, setMeltSloped] = useState(false);
  const [meltFrom, setMeltFrom] = useState("");
  const [meltTo, setMeltTo] = useState("");
  const [meltControlId, setMeltControlId] = useState<NodeId>("");
  // Selected-pairs scheme: the chosen (datasetIdA, datasetIdB) comparisons (converted to
  // group indices at run time, mirroring the control chooser).
  const [selectedPairs, setSelectedPairs] = useState<Array<[NodeId, NodeId]>>([]);
  // Multiple regression: the outcome (Y) is chosen explicitly; the checkboxes are predictors.
  // For Cox, `outcomeId` doubles as the time column and `eventId` as the event indicator.
  const [outcomeId, setOutcomeId] = useState<NodeId>(dsOpts[0]?.id ?? "");
  const [eventId, setEventId] = useState<NodeId>(dsOpts[1]?.id ?? dsOpts[0]?.id ?? "");
  // Default confidence from Settings, clamped to an offered option (90/95/99).
  const [confPct, setConfPct] = useState(() => {
    const c = getAppDefaults().conf;
    return c === 90 || c === 95 || c === 99 ? c : 95;
  });
  const [tail, setTail] = useState("two-sided");
  // Cluster-analysis params.
  const [clusterVariant, setClusterVariant] = useState("kmeans");
  const [clusterK, setClusterK] = useState(3);
  const [clusterStd, setClusterStd] = useState(true);
  const [clusterSeed, setClusterSeed] = useState(20240704);
  const [clusterMetric, setClusterMetric] = useState("euclidean");
  const [clusterLinkage, setClusterLinkage] = useState("ward");
  // k-selection scan: sweep k=2…kMax and report elbow (within-SS) + silhouette per k.
  const [clusterScanK, setClusterScanK] = useState(false);
  const [clusterKMax, setClusterKMax] = useState(10);
  // Ordination (PCoA / NMDS). The distance and the transformation are the two choices
  // that decide what the map means, so they lead; Bray-Curtis + none is the ecology
  // default the methods exist for.
  const [ordMetric, setOrdMetric] = useState("braycurtis");
  const [ordTransform, setOrdTransform] = useState("none");
  const [ordCorrection, setOrdCorrection] = useState("none");
  const [ordDimensions, setOrdDimensions] = useState(2);
  const [ordTries, setOrdTries] = useState(20);
  const [ordSeed, setOrdSeed] = useState(20240704);
  const [ordPermutations, setOrdPermutations] = useState(999);
  // PERMANOVA's distance. Euclidean on standardised variables by default: the geometry of the PCA score plot the
  // groups are usually looked at on (the ordinations default to Bray-Curtis, the community-data convention).
  const [permMetric, setPermMetric] = useState("euclidean");
  // CA scaling: whose distances the drawn picture preserves.
  const [caScaling, setCaScaling] = useState("symmetric");
  /**
   * A constrained ordination reads two blocks of columns from the one sheet:
   * the ticked list above is the response, and these are the
   * explanatory variables. A column can only be one or the other, so ticking it here unticks
   * it there — the same rule multiple regression's outcome follows.
   */
  const [explanatoryIds, setExplanatoryIds] = useState<Set<NodeId>>(new Set());
  // Variance partitioning: the other one or two blocks, and what to call all three. A column
  // may sit in only one block — the pickers below grey it out everywhere else, because a
  // column in two blocks is not a partition.
  const [explanatory2Ids, setExplanatory2Ids] = useState<Set<NodeId>>(new Set());
  const [explanatory3Ids, setExplanatory3Ids] = useState<Set<NodeId>>(new Set());
  const [blockNames, setBlockNames] = useState<string[]>(["", "", ""]);

  // Re-hydrate a method's saved option defaults whenever the user switches to
  // it (mount + every Test-list change). Idempotent: a front-door `initialVariant`
  // wins on its own method; the saved default fills the rest. Stale values are
  // harmless — the effVariant/valid() clamps below neutralise them.
  useEffect(() => {
    const d = getAnalysisDefault(method);
    setMakeDefault(d != null);
    if (!d) return;
    const frontDoorVariant = method === initialMethod && !!initialVariant;
    if (d.variant) {
      if (method === "cluster") setClusterVariant(d.variant);
      else if (!frontDoorVariant) setVariant(d.variant);
    }
    if (d.variant2) setVariant2(d.variant2);
    if (d.tail) setTail(d.tail);
    if (d.weighting) setWeighting(d.weighting);
    if (d.rout != null) setRout(d.rout);
    if (d.flag) {
      setFlagOn(!!d.flag.enabled);
      setFlagThresholds((prev) => {
        const next = { ...prev };
        for (const k of ["rSqBelow", "nBelow", "dependencyAbove", "skewnessAbove", "residNormalityBelow", "outliersAbove"] as const) {
          const v = d.flag![k];
          next[k] = v == null ? "" : String(v);
        }
        return next;
      });
    }
    if (d.ecLevels?.length) setEcLevelsText(d.ecLevels.join(", "));
    if (d.ciMethod) setCiMethod(d.ciMethod);
    if (d.posthoc) setPosthoc(d.posthoc);
    if (d.scheme) setScheme(d.scheme);
    if (d.pairwise != null) setSurvPairwise(d.pairwise);
    if (d.pairwiseMethod) setSurvPwMethod(d.pairwiseMethod);
    if (d.percent != null) setBaPercent(d.percent);
    if (d.agreementK != null) setBaK(d.agreementK);
    if (d.lambda != null) setDemingLambda(d.lambda);
    if (d.minPeakFraction != null) setAucMinPeak(d.minPeakFraction);
    if (d.baselineValue != null) setAucBaselineValue(d.baselineValue);
    if (d.smoothWindow != null) setSmoothWindow(d.smoothWindow);
    if (d.sloped != null) setMeltSloped(d.sloped);
    if (d.conf != null) {
      const pct = Math.round(d.conf * 100);
      if (pct === 90 || pct === 95 || pct === 99) setConfPct(pct);
    }
    if (d.k != null) setClusterK(d.k);
    if (d.standardize != null) setClusterStd(d.standardize);
    if (d.seed != null) setClusterSeed(d.seed);
    if (d.metric) setClusterMetric(d.metric);
    if (d.linkage) setClusterLinkage(d.linkage);
    if (d.scanK != null) setClusterScanK(d.scanK);
    if (d.kMax != null) setClusterKMax(d.kMax);
    if (d.componentSelection) setPcaSelection(d.componentSelection);
    if (d.kaiserThreshold != null) setPcaKaiser(d.kaiserThreshold);
    if (d.fixedK != null) setPcaFixedK(d.fixedK);
    if (d.varianceThreshold != null) setPcaVariancePct(Math.round(d.varianceThreshold * 100));
    if (d.parallelPercentile != null) setPcaParallelPct(d.parallelPercentile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method]);
  useEffect(() => {
    if (!typePickerOpen) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setTypePickerOpen(false);
    };
    const onPointerDown = (event: PointerEvent): void => {
      if (typePickerRef.current && !typePickerRef.current.contains(event.target as Node)) setTypePickerOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [typePickerOpen]);
  const variantOpts = useMemo(() => VARIANTS[method] ?? [], [method]);
  // Guided front-door focus: title + banner (+ family scope) — active only while its method is selected,
  // so switching the Test dropdown away returns to the plain dialog.
  const focus = focusKey && ANALYZE_FOCUS[focusKey]?.method === method ? ANALYZE_FOCUS[focusKey] : undefined;
  // Curve-fit families (equation `group`s). When one is chosen, the model list is filtered to it.
  const curvefitGroups = method === "curvefit" ? [...new Set(variantOpts.map((v) => v.group ?? "").filter(Boolean))] : [];
  const familyActive = method === "curvefit" && family !== "" && curvefitGroups.includes(family);
  const familyFiltered = familyActive ? variantOpts.filter((v) => (v.group ?? "") === family) : variantOpts;
  const shownVariantOpts = familyFiltered.length ? familyFiltered : variantOpts; // never empty
  const effVariant = shownVariantOpts.some((v) => v.id === variant) ? variant : shownVariantOpts[0]?.id;
  // Symbolic equation preview (parameter names, pre-fit) for the chosen model —
  // null for custom equations / smoothers / untemplated models (hidden then).
  // Ranked type recommendations for the picker — curve-fit keeps its live goal-aware recompute;
  // every other method gets data-aware recommendations too.
  const activeVariantRecommendations = useMemo(() => {
    if (method === "curvefit") {
      const selectionChanged = xSel !== seedX || colA !== seedA;
      if (!selectionChanged && !curveGoal && curveModelRecommendations.length) return curveModelRecommendations;
      return suggestCurveModelsForTable(table, { xId: xSel, yId: colA, goal: curveGoal || undefined, availableVariants: VARIANTS.curvefit });
    }
    return suggestVariantsForTable(method, table, { xId: xSel, yId: colA, availableVariants: variantOpts });
  }, [colA, curveGoal, curveModelRecommendations, method, seedA, seedX, table, variantOpts, xSel]);
  const modelTemplate = fitModelTemplate(method, effVariant);
  // Compare models: a second equation picker (model B), distinct from model A.
  const isCompare = method === "comparefits";
  // Single-curve nonlinear fits share one clean X + Y data shape, so their config is
  // laid out in labelled sections (Model · Data · Parameters · Options). Global fit is
  // excluded — it keeps its specialised multi-curve flow.
  const isFitConfig = method === "curvefit" || method === "interpolate" || method === "comparefits";
  const effVariant2 = variantOpts.some((v) => v.id === variant2) ? variant2 : variantOpts[0]?.id;
  const mode = columnMode(method, effVariant);
  const xy = isXYMethod(method);
  const oneSampleT = (method === "ttest" && (effVariant === "one-sample" || effVariant === "wilcoxon-1samp"))
    || (method === "equivalence" && effVariant === "one-sample")
    || (method === "permutation" && effVariant === "one-sample")
    || (method === "bayesfactor" && effVariant === "one-sample");
  // The Cauchy prior scale. Exposed because the Bayes factor is a comparison against a
  // specific alternative — a result reported without its prior is not interpretable.
  const showPrior = method === "bayesfactor";
  // Resampling controls. Shown for permutation only; they matter solely when exact
  // enumeration is infeasible, which the engine decides and reports.
  const showResampling = method === "permutation";
  // Equivalence needs its bound. There is deliberately no default that means anything:
  // Δ is the smallest difference that would matter, which only the user can supply.
  const showBound = method === "equivalence";
  // Post-hoc multiple comparisons apply to the parametric one-way ANOVA only.
  const showPosthoc = method === "anova" && effVariant === "anova";
  // One-tailed direction applies to t-tests + correlation (mapped to scipy alternative=).
  const showTail = method === "ttest" || method === "correlation" || method === "permutation";
  // Weighting applies to the nonlinear curve-fit models (least squares only for linear/LOWESS).
  const showWeighting =
    ((method === "curvefit" || method === "interpolate") && effVariant !== "linear" && effVariant !== "lowess" && effVariant !== "spline") ||
    method === "globalfit" ||
    method === "regression" ||
    isCompare;
  // ROUT (automatic outlier removal) applies to the parametric curve-fit models only.
  const showRout = method === "curvefit" && effVariant !== "linear" && effVariant !== "lowess" && effVariant !== "spline";
  // "Flag poor fits" — the diagnostics it reads (R²/dependency/skewness/residual normality/outliers)
  // exist only for the parametric nonlinear models, so gate it exactly like ROUT.
  const showFlag = showRout;
  // Dose-response EC levels / Cheng-Prusoff apply to the monotonic log-dose models
  // (must mirror the engine's `ecf`-flagged models). IC = inhibition (Ki applies).
  const isICModel = method === "curvefit" && (effVariant === "ic50_4pl_log" || effVariant === "ic50_3pl_log" || effVariant === "ic50_norm_4pl" || effVariant === "ic50_norm_3pl");
  const isECModel =
    method === "curvefit" &&
    (["3pl", "4pl", "5pl", "dr_norm_3pl", "dr_norm_4pl"].includes(effVariant ?? "") || isICModel);
  const ecPrefix = isICModel ? "IC" : "EC";
  const parseEcLevels = (): number[] =>
    [...new Set(ecLevelsText.split(/[\s,]+/).map(Number).filter((v) => Number.isFinite(v) && v > 0 && v < 100 && v !== 50))];
  // Linear regression: force the line through an arbitrary point (x₀, y₀) — extra inputs.
  const showThroughPoint = method === "regression" && effVariant === "point";
  // User-defined-equation fit: the equation's parameters are detected client-side
  // (mirroring the engine) so we can render an initial-value + constraint input per
  // parameter before running.
  const isCustomFit = method === "curvefit" && effVariant === "custom";
  const customParams = isCustomFit ? detectEquationParams(equation) : [];
  // Global fit: the chosen equation's parameters, each shareable across datasets.
  const fitParams = method === "globalfit" ? CURVE_FIT_PARAMS[effVariant ?? "4pl"] ?? [] : [];
  // Parameters that can carry a fix/bound constraint — the registry params of the chosen
  // nonlinear model (or the detected params of a user-defined equation; empty for the
  // model-free linear/LOWESS/spline fits).
  const constraintParams = isCustomFit
    ? customParams
    : method === "curvefit" || method === "globalfit"
    ? CURVE_FIT_PARAMS[effVariant ?? ""] ?? []
    : [];
  // Global-fit models needing a per-dataset constant (e.g. enzyme inhibition [I]); when present,
  // all params are shared (enzyme constants) and the UI collects one constant value per curve.
  const constNames = method === "globalfit" ? CURVE_FIT_CONSTS[effVariant ?? ""] ?? [] : [];
  // Selected-pairs applies to the m-based corrections (pooled-t families + Tamhane); Tukey's
  // studentized range, Dunnett's vs-control, and Games-Howell are all-pairs / vs-control designs.
  const selectedPairsOk = posthoc !== "tukey" && posthoc !== "dunnett" && posthoc !== "games-howell";
  const effScheme = scheme === "selected-pairs" && !selectedPairsOk ? "all-pairs" : scheme;
  const needsControl = showPosthoc && (posthoc === "dunnett" || effScheme === "vs-control");
  // What the group pickers offer: row categories when this sheet keeps its groups in
  // rows, else the column datasets. Restricted to the methods whose selection really
  // is a set of groups — the "many" checkbox list is also how PCA/correlation-matrix/
  // multiple-regression choose variables, and goodness-of-fit reads its column raw, so
  // those must keep pointing at real columns.
  const useRowGroupsHere = useRowGroups && !xy && ROW_GROUP_METHODS.has(method);
  const pickOpts: Opt[] = useRowGroupsHere ? rowOpts : dsOpts;
  // Groups currently picked, in table order (control chooser source).
  const groupOpts = pickOpts.filter((d) => groups.has(d.id));
  const effControl = groupOpts.some((d) => d.id === controlId) ? controlId : groupOpts[0]?.id ?? "";
  const effMeltControl = groupOpts.some((d) => d.id === meltControlId) ? meltControlId : "";
  const meltNum = (s: string): number | undefined => (s.trim() !== "" && Number.isFinite(Number(s)) ? Number(s) : undefined);
  const meltRangeOk = !(meltNum(meltFrom) !== undefined && meltNum(meltTo) !== undefined && meltNum(meltFrom)! >= meltNum(meltTo)!);
  const [labelA, labelB] = TWO_LABELS[method] ?? ["Group A", "Group B"];
  // "Each treatment vs one control in one run" lives under ANOVA → Dunnett, but a user who
  // reaches for a t test never sees it — the t test only pits two groups against each other.
  // When the sheet holds three or more groups, offer the door from inside the t test, so a
  // control can be defined and every group compared to it in one operation. Paired and
  // one-sample variants have a different multi-group analog (RM-ANOVA), so leave those alone.
  const suggestVsControl =
    method === "ttest" && !oneSampleT && !PAIRED_TTEST_VARIANTS.has(effVariant ?? "") && pickOpts.length >= 3;
  // Parametric unpaired t tests (Student / Welch) can run "every group vs one control" right here,
  // from a control field on the t-test, so a user who starts from the t test does not have to
  // find the ANOVA + Dunnett route. Mann-Whitney falls through to the switch nudge below.
  const ttestVsControl = suggestVsControl && TTEST_VS_CONTROL_VARIANTS.has(effVariant ?? "");
  const effTtestControl = pickOpts.some((d) => d.id === ttestControlId) ? ttestControlId : pickOpts[0]?.id ?? "";
  const runTtestVsControl = (): void => {
    const columns = pickOpts.map((d) => d.id); // all groups, table order
    onRun(ttestVsControlSpec({ variant: effVariant, columns, controlIndex: columns.indexOf(effTtestControl), conf: confPct / 100 }));
  };
  const switchToVsControl = (): void => {
    setGroups(new Set(pickOpts.map((d) => d.id))); // ttest + anova share pickOpts, so this is the ANOVA's group set
    setMethod("anova");
    setVariant("anova");
    setPosthoc("dunnett");
  };

  const valid = (opts: Opt[], id: NodeId): boolean => opts.some((o) => o.id === id);
  // Clamp selections to the current option lists (method switches change them).
  const effA = valid(pickOpts, colA) ? colA : pickOpts[0]?.id ?? "";
  const effB = valid(pickOpts, colB) ? colB : pickOpts[1]?.id ?? pickOpts[0]?.id ?? "";
  const effX = valid(colOpts, xSel) ? xSel : xColId;
  const effMarker2 = valid(colOpts, marker2) ? marker2 : (colOpts.find((c) => c.id !== effX)?.id ?? colOpts[0]?.id ?? "");

  // Multiple linear + logistic regression share the outcome + predictors picker.
  const isMReg = method === "multipleregression" || method === "logistic" || method === "poisson" || method === "multifactor";
  // Cox reuses that picker with two special columns: time (outcomeId) + event (eventId).
  const isCox = method === "cox";
  // Mixed model reuses the two-special-column picker: value (outcomeId) + random group
  // (eventId) + optional fixed factors (predictors).
  const isMixed = method === "mixedmodel";
  /** A constrained ordination: the sheet supplies a response block and an explanatory block.
   *  From the one list in core, not a chain of `===` — the same list `ordinationGraphPlan`
   *  and the payload builder read, so a fourth constrained method cannot reach two of the
   *  three and be silently missing from the third. */
  const isConstrained = CONSTRAINED_METHODS.has(method);
  /** Variance partitioning: the explanatory side arrives in 2-3 blocks, not one. */
  const isPartition = method === "varpart";
  /** …and everything the two share: a response block, an explanatory picker, the same
   *  greying rule and the same permutation controls. */
  const hasExplanatory = isConstrained || isPartition;
  /** …and of those, the one whose geometry comes from a distance the user picks. */
  const isDistanceConstrained = method === "dbrda";
  const explanatoryList = pickOpts.filter((d) => explanatoryIds.has(d.id) && !groups.has(d.id));
  const explanatory2List = pickOpts.filter((d) => explanatory2Ids.has(d.id) && !groups.has(d.id));
  const explanatory3List = pickOpts.filter((d) => explanatory3Ids.has(d.id) && !groups.has(d.id));
  const blockLists = [explanatoryList, explanatory2List, explanatory3List];
  const blockSetters = [setExplanatoryIds, setExplanatory2Ids, setExplanatory3Ids];
  const blockIdSets = [explanatoryIds, explanatory2Ids, explanatory3Ids];
  const effOutcome = valid(dsOpts, outcomeId) ? outcomeId : dsOpts[0]?.id ?? "";
  const effEvent = valid(dsOpts, eventId) && eventId !== effOutcome ? eventId : dsOpts.find((d) => d.id !== effOutcome)?.id ?? "";
  // Predictors = checked datasets minus the special column(s) so they can't predict themselves.
  const predictorIds = datasets
    .filter((d) => groups.has(d.id) && d.id !== effOutcome && ((!isCox && !isMixed) || d.id !== effEvent))
    .map((d) => d.id);
  const sameGroups = mode === "two" && !xy && effA === effB; // two groups must differ
  const sameModels = isCompare && effVariant === effVariant2; // compare needs two distinct models
  // A zero bound is not a permissive default — it makes equivalence impossible to
  // conclude, so running with it would quietly produce a guaranteed "not equivalent".
  // Require a real bound rather than inventing one the user cannot defend.
  const boundOk = !showBound || Math.abs(bound) > 0;
  const canRun = boundOk && (
    isCox
      ? Boolean(effOutcome) && Boolean(effEvent) && effOutcome !== effEvent && predictorIds.length >= 1
      : isMixed
      ? Boolean(effOutcome) && Boolean(effEvent) && effOutcome !== effEvent // value + random group; fixed factors optional
      : isMReg
      ? Boolean(effOutcome) && predictorIds.length >= (method === "multifactor" ? 2 : 1)
      : isPartition
      ? groups.size >= 2 && blockLists.filter((b) => b.length > 0).length >= 2
      : method === "permanova"
      ? Boolean(groupBy) && [...groups].filter((id) => id !== groupBy).length >= 2
      : isConstrained
      ? groups.size >= 2 && explanatoryList.length >= 1
      : method === "meltingtemp"
      ? groups.size >= 1 && meltRangeOk
      : mode === "many"
      ? groups.size >= 2
      : mode === "two"
        ? xy
          ? Boolean(effX) && Boolean(effA) && !sameModels && (!isCustomFit || equation.trim() !== "")
          : Boolean(effA) && Boolean(effB) && !sameGroups
        : Boolean(effA));

  const run = (): void => {
    const columns =
      isCox || isMixed
        ? [effOutcome, effEvent, ...predictorIds] // time/value, event/group, then predictors/fixed
        : isMReg
        ? [effOutcome, ...predictorIds] // outcome first, then predictors
        : mode === "many"
        ? datasets.filter((d) => groups.has(d.id)).map((d) => d.id) // table order
        : mode === "two"
          ? xy
            ? [effX, effA] // X column + Y dataset
            : [effA, effB] // two groups
          : [effA];
    const spec: AnalyzeSpec = { method, columns, conf: confPct / 100 };
    if (effVariant) spec.variant = effVariant;
    if (isCompare && effVariant2) spec.variant2 = effVariant2;
    if (method === "roc" && rocCompare && effMarker2) spec.marker2 = effMarker2;
    if (oneSampleT) spec.mu = mu;
    if (showBound) {
      spec.bound = Math.abs(bound);
      spec.boundMode = boundMode;
    }
    if (showResampling) {
      spec.nResamples = nResamples;
      spec.seed = seed;
    }
    if (showPrior) spec.rscale = rscale;
    if (showTail && tail !== "two-sided") spec.tail = tail;
    if (showWeighting && weighting !== "none") spec.weighting = weighting;
    if (showRout && rout) spec.rout = true;
    if (showFlag && flagOn) {
      // Parse each threshold field; a blank disables that one criterion (undefined).
      const num = (s: string): number | undefined => {
        const v = Number(s);
        return s.trim() !== "" && Number.isFinite(v) ? v : undefined;
      };
      spec.flag = {
        enabled: true,
        rSqBelow: num(flagThresholds.rSqBelow),
        nBelow: num(flagThresholds.nBelow),
        dependencyAbove: num(flagThresholds.dependencyAbove),
        skewnessAbove: num(flagThresholds.skewnessAbove),
        residNormalityBelow: num(flagThresholds.residNormalityBelow),
        outliersAbove: num(flagThresholds.outliersAbove),
      };
    }
    if (isECModel) {
      const lv = parseEcLevels();
      if (lv.length) spec.ecLevels = lv;
      if (isICModel) {
        const conc = Number(kiConc);
        const kd = Number(kiKd);
        if (kiConc.trim() !== "" && kiKd.trim() !== "" && Number.isFinite(conc) && conc >= 0 && Number.isFinite(kd) && kd > 0) {
          spec.chengProsuff = { conc, kd };
        }
      }
    }
    if (method === "curvetransform" && effVariant === "smooth" && smoothWindow > 0) spec.smoothWindow = smoothWindow;
    if (showThroughPoint) spec.throughPoint = { x: throughX, y: throughY };
    if (constraintParams.length > 0) {
      const fx: Record<string, number> = {};
      for (const p of constraintParams) {
        const v = fixedParams[p];
        if (v != null && v.trim() !== "" && Number.isFinite(Number(v))) fx[p] = Number(v);
      }
      if (Object.keys(fx).length) spec.fixed = fx;
      const pb: Record<string, [number | null, number | null]> = {};
      for (const p of constraintParams) {
        if (p in fx) continue; // a fixed parameter isn't bounded
        const b = paramBounds[p];
        const lo = b?.lo != null && b.lo.trim() !== "" && Number.isFinite(Number(b.lo)) ? Number(b.lo) : null;
        const hi = b?.hi != null && b.hi.trim() !== "" && Number.isFinite(Number(b.hi)) ? Number(b.hi) : null;
        if (lo !== null || hi !== null) pb[p] = [lo, hi];
      }
      if (Object.keys(pb).length) spec.paramBounds = pb;
    }
    if (isCustomFit) {
      spec.equation = equation.trim();
      // Only forward the parameters the equation actually uses, with finite values.
      const iv: Record<string, number> = {};
      for (const p of customParams) {
        const v = initValues[p];
        if (v != null && v.trim() !== "" && Number.isFinite(Number(v))) iv[p] = Number(v);
      }
      if (Object.keys(iv).length) spec.initialValues = iv;
    }
    if (method === "meltingtemp") {
      if (meltSloped) spec.sloped = true;
      const f = meltNum(meltFrom);
      const t = meltNum(meltTo);
      if (f !== undefined) spec.rangeFrom = f;
      if (t !== undefined) spec.rangeTo = t;
      if (smoothWindow > 0) spec.smoothWindow = smoothWindow;
      const ci = effMeltControl ? columns.indexOf(effMeltControl) : -1;
      if (ci >= 0) spec.control = ci;
    }
    if (method === "globalfit") {
      if (constNames.length > 0) {
        // Enzyme constants (Vmax/KM/Ki/α) are shared across every [I] curve; pass each curve's [I].
        spec.shared = fitParams;
        spec.consts = Object.fromEntries(columns.map((id) => [id, constVals[id] ?? 0]));
      } else {
        spec.shared = fitParams.filter((p) => sharedParams.has(p));
        // Only while something is left per curve: with every parameter shared there is nothing to compare.
        if (compareOneCurve && fitParams.some((p) => !sharedParams.has(p))) spec.compareOneCurve = true;
      }
    }
    if (method === "permanova") {
      if (groupBy) spec.groupBy = groupBy;
      spec.metric = permMetric;
      spec.permutations = ordPermutations;
      spec.seed = ordSeed;
    }
    if (method === "pca") {
      if (groupBy) spec.groupBy = groupBy;
      spec.componentSelection = pcaSelection;
      if (pcaSelection === "kaiser") spec.kaiserThreshold = pcaKaiser;
      else if (pcaSelection === "fixedk") spec.fixedK = pcaFixedK;
      else if (pcaSelection === "variance") spec.varianceThreshold = pcaVariancePct / 100;
      else if (pcaSelection === "parallel") spec.parallelPercentile = pcaParallelPct;
    }
    if (method === "contingency") spec.ciMethod = ciMethod; // engine uses it only on the independent 2×2 path
    if (method === "blandaltman") {
      spec.percent = baPercent;
      spec.agreementK = baK;
    }
    if (method === "deming") spec.lambda = demingLambda;
    if (method === "auc") {
      if (aucMinPeak > 0) spec.minPeakFraction = aucMinPeak;
      if (effVariant === "custom") spec.baselineValue = aucBaselineValue;
    }
    if (method === "survival" && survPairwise) {
      spec.pairwise = true;
      spec.pairwiseMethod = survPwMethod;
    }
    if (method === "cluster") {
      spec.variant = clusterVariant;
      spec.k = clusterK;
      spec.standardize = clusterStd;
      spec.seed = clusterSeed;
      spec.metric = clusterMetric;
      spec.linkage = clusterLinkage;
      if (clusterScanK) {
        spec.scanK = true;
        spec.kMax = clusterKMax;
      }
    }
    if (method === "ca") spec.scaling = caScaling;
    if (isPartition) {
      spec.explanatory = explanatoryList.map((d) => d.id);
      spec.explanatory2 = explanatory2List.map((d) => d.id);
      if (explanatory3List.length) spec.explanatory3 = explanatory3List.map((d) => d.id);
      // A blank name falls back to "Block A/B/C" in the engine, so only what was typed travels.
      spec.blockLabels = blockNames.slice(0, explanatory3List.length ? 3 : 2).map((v, i) => v.trim() || `Block ${"ABC"[i]}`);
      spec.transform = ordTransform;
      spec.permutations = ordPermutations;
      spec.seed = ordSeed;
    }
    if (isConstrained) {
      spec.explanatory = explanatoryList.map((d) => d.id);
      spec.scaling = caScaling;
      spec.permutations = ordPermutations;
      spec.seed = ordSeed;
      // CCA takes no transformation: its geometry is the chi-square one, applied inside the
      // method; sending a transform would put a control on screen that the engine ignores.
      if (method !== "cca") spec.transform = ordTransform;
      if (isDistanceConstrained) spec.metric = ordMetric;
    }
    if (method === "pcoa" || method === "nmds") {
      spec.metric = ordMetric;
      spec.transform = ordTransform;
      if (method === "pcoa") spec.correction = ordCorrection;
      else {
        spec.dimensions = ordDimensions;
        spec.tries = ordTries;
        spec.seed = ordSeed;
      }
    }
    if (showPosthoc) {
      spec.posthoc = posthoc;
      spec.scheme = posthoc === "dunnett" ? "vs-control" : effScheme;
      const ci = columns.indexOf(effControl);
      spec.control = ci >= 0 ? ci : 0;
      if (spec.scheme === "selected-pairs") {
        spec.pairs = selectedPairs
          .map(([a, b]) => [columns.indexOf(a), columns.indexOf(b)] as [number, number])
          .filter(([i, j]) => i >= 0 && j >= 0 && i !== j);
      }
    }
    if (method === "twoway" && twowayCompare !== "none") {
      spec.compare = twowayCompare;
      spec.posthoc = twowayPosthoc;
    }
    if (method === "mixedanova" && mixedCompare !== "none") spec.compare = mixedCompare;
    // Persist / clear this method's remembered options (the store whitelists —
    // `method`, `columns` and every data-bound field in `spec` are stripped).
    if (makeDefault) setAnalysisDefault(method, spec);
    else clearAnalysisDefault(method);
    onRun(spec);
  };

  // Pick an analysis from the landing page → switch to the options/configure view.
  const selectMethod = (id: string): void => {
    setMethod(id);
    setFocusKey(undefined);
    setView("configure");
    seedForVariableSet(id);
  };
  /** Switching to a variable-set method inside the dialog re-seeds the same way the open does. */
  const seedForVariableSet = (id: string): void => {
    if (!VARIABLE_SET_METHODS.has(id)) return;
    const nums = numericIds(rowGroupsAvailable ? rowOpts : dsOpts);
    if (nums.length >= 2) setGroups(new Set(nums));
    if ((id === "pca" || id === "permanova") && textIds(dsOpts).length === 1) setGroupBy(textIds(dsOpts)[0]!);
  };
  // Pick a Common-analysis tile → configure that method, scoped to its equation
  // family + guided banner where relevant (dose-response / enzyme / binding).
  const selectGoal = (g: { method: string; focus?: string }): void => {
    setMethod(g.method);
    setFocusKey(g.focus);
    setFamily(g.focus ? (ANALYZE_FOCUS[g.focus]?.group ?? "") : "");
    setView("configure");
    seedForVariableSet(g.method);
  };

  const applyRecommendation = (rec: Suggestion, choice?: SuggestionChoice): void => {
    const selected: Suggestion = choice
      ? { ...rec, method: choice.method ?? rec.method, variant: choice.variant ?? rec.variant, focusKind: choice.focusKind ?? rec.focusKind }
      : rec;
    if (!selected.method) return;
    const recColumns = selected.columns ?? [];
    const recMode = columnMode(selected.method, selected.variant);
    const recXy = isXYMethod(selected.method);
    // Match the recommendation's ids against the same list its pickers will show —
    // a suggestion over row categories carries virtual ids, which are absent from
    // `dsOpts` and would otherwise be filtered away, leaving nothing selected.
    const recPick: Opt[] =
      rowGroupsAvailable && groupsFromRows && !recXy && ROW_GROUP_METHODS.has(selected.method) ? rowOpts : dsOpts;
    const recDatasetIds = recColumns.filter((id) => recPick.some((d) => d.id === id));
    const recA = recXy ? recColumns[1] ?? dsOpts[0]?.id ?? "" : recDatasetIds[0] ?? recPick[0]?.id ?? "";
    const recB = recDatasetIds.find((id) => id !== recA) ?? recPick.find((d) => d.id !== recA)?.id ?? recA;
    setMethod(selected.method);
    if (selected.variant) {
      if (selected.method === "cluster") setClusterVariant(selected.variant);
      else setVariant(selected.variant);
    }
    setFocusKey(selected.focusKind);
    setFamily(selected.focusKind ? (ANALYZE_FOCUS[selected.focusKind]?.group ?? "") : "");
    if (recXy) setXSel(recColumns[0] ?? xColId);
    setColA(recA);
    setColB(recB);
    if (recMode === "many") setGroups(new Set(recDatasetIds.length ? recDatasetIds : recPick.slice(0, 2).map((d) => d.id)));
    setOutcomeId(recDatasetIds[0] ?? dsOpts[0]?.id ?? "");
    setEventId(recDatasetIds[1] ?? dsOpts[1]?.id ?? dsOpts[0]?.id ?? "");
    setView("configure");
  };
  const analysisRecommendations = recommendations.filter((r) => r.kind === "analysis" && r.method);
  // The landing tiles follow the data: what the suggester actually proposed first,
  // then what suits this datasheet's kind, then the rest (dimmed, never hidden).
  // Methods the suggester proposed, for badging both the tiles and the catalogue.
  const recommendedMethods = useMemo(
    () => new Set(analysisRecommendations.map((r) => r.method as string)),
    [analysisRecommendations],
  );
  /** Catalogue sort band: recommended → suits this datasheet → the rest. */
  const catalogRank = (m: string): number => (recommendedMethods.has(m) ? 0 : methodFitsKind(m, table.kind) ? 1 : 2);
  const rankedGoals = useMemo(
    () =>
      rankGoals(table.kind, [
        ...analysisRecommendations.map((r) => r.method as string),
        ...analysisRecommendations.map((r) => r.focusKind).filter((f): f is string => Boolean(f)),
      ]),
    [table.kind, analysisRecommendations],
  );

  const Select = ({
    value,
    set,
    label,
    options,
    required,
  }: {
    value: NodeId;
    set: (v: NodeId) => void;
    label: string;
    options: Opt[];
    required?: boolean;
  }) => (
    <label className="anrow">
      <span>{label}{required && <span className="an-req" title="Required">*</span>}</span>
      <select aria-label={label} value={value} onChange={(e) => set(e.target.value)}>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );

  // Whether the sectioned fit layout shows an "Options" group.
  const showFitOptions = showWeighting || showRout || showFlag || isECModel || isICModel;
  // Parameter constraints block, extracted so the sectioned fit layout can place it
  // under a "Parameters" header while every other method keeps it inline.
  const constraintsBlock =
    constraintParams.length > 0 ? (
      <div className="anrow" style={{ alignItems: "flex-start" }}>
        <span title="Optional. Hold a parameter at a fixed value (it isn't fitted), or bound it to a min/max range — e.g. fix Bottom = 0. Hover each parameter name for what it means.">Constraints <span style={{ opacity: 0.55, fontWeight: 400, fontSize: 11 }}>(optional)</span></span>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
          {constraintParams.map((p) => {
            const isFixed = p in fixedParams;
            const pInfo = CURVE_FIT_PARAM_INFO[p] ?? "A fitted parameter of this model. Fix it to a known value, or bound it to a plausible range, to stabilise the fit.";
            return (
              <div key={p} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 11, flexWrap: "wrap" }}>
                <span style={{ minWidth: 88, cursor: "help", textDecoration: "underline dotted 1px", textUnderlineOffset: 2 }} title={pInfo}>{p}</span>
                <label style={{ display: "inline-flex", gap: 3, alignItems: "center" }}>
                  <input
                    type="checkbox"
                    aria-label={`Fix ${p}`}
                    checked={isFixed}
                    onChange={(e) => setFixedParams((s) => { const n = { ...s }; if (e.target.checked) n[p] = n[p] ?? "0"; else delete n[p]; return n; })}
                  />
                  Fix
                </label>
                {isFixed ? (
                  <input type="number" step="any" aria-label={`${p} value`} placeholder="value" style={{ width: 68 }}
                    value={fixedParams[p] ?? ""} onChange={(e) => setFixedParams((s) => ({ ...s, [p]: e.target.value }))} />
                ) : (
                  <>
                    <input type="number" step="any" aria-label={`${p} min`} placeholder="min" style={{ width: 58 }}
                      value={paramBounds[p]?.lo ?? ""} onChange={(e) => setParamBounds((s) => ({ ...s, [p]: { ...(s[p] ?? {}), lo: e.target.value } }))} />
                    <input type="number" step="any" aria-label={`${p} max`} placeholder="max" style={{ width: 58 }}
                      value={paramBounds[p]?.hi ?? ""} onChange={(e) => setParamBounds((s) => ({ ...s, [p]: { ...(s[p] ?? {}), hi: e.target.value } }))} />
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    ) : null;

  const curveModelGoalLabels: Record<CurveModelGoal, string> = {
    potency: "Estimate EC50 / IC50",
    shape: "Fit curve shape",
    compare: "Compare curves",
    interpolate: "Interpolate",
    explore: "Explore",
  };
  // A family door can name models that its own method cannot fit. The enzyme door's banner
  // points at the mechanism-inhibition models, but those are global-fit only (one curve
  // confounds KM with Ki — see GLOBALFIT_ONLY). So they are offered here, badged, and
  // picking one switches the method, rather than hiding what the banner promises.
  const crossOffer = method === "curvefit" && familyActive ? CROSS_METHOD_OFFERS[family] : undefined;
  const crossOptions: CurveModelOption[] = crossOffer
    ? (VARIANTS[crossOffer.method] ?? [])
        .filter((v) => crossOffer.ids.includes(v.id))
        // Re-grouped onto the door's family so the family filter shows them.
        .map((v) => ({ ...v, group: family, viaMethod: crossOffer.method }))
    : [];
  const curveModelOptions: CurveModelOption[] = [...variantOpts, ...crossOptions];
  const curveModelLabel = (id: string): string => curveModelOptions.find((v) => v.id === id)?.label ?? id;
  const curveModelQuery = curveModelSearch.trim().toLowerCase();
  const matchesCurveModel = (id: string, group?: string): boolean => {
    if (familyActive && group !== family) return false;
    if (!curveModelQuery) return true;
    return `${id} ${curveModelLabel(id)} ${group ?? ""}`.toLowerCase().includes(curveModelQuery);
  };
  const visibleCurveRecommendations = activeVariantRecommendations.filter((rec) => {
    if (curveGoal && !rec.goals.includes(curveGoal)) return false;
    return matchesCurveModel(rec.variant, rec.family);
  });
  // The "Recommended for this data" section: curve-fit shows its ranked shortlist of the
  // recommended + alternative models only, so caution/expert rows never sit under a
  // heading calling them recommended; other methods (whose recommender returns every
  // variant) show only the genuinely recommended ones.
  const recommendedRows = method === "curvefit"
    ? visibleCurveRecommendations.filter((rec) => rec.suitability === "recommended" || rec.suitability === "alternative").slice(0, 8)
    : visibleCurveRecommendations.filter((rec) => rec.suitability === "recommended");
  const anyRecommended = recommendedRows.some((rec) => rec.suitability === "recommended");
  const visibleCurveOptions = curveModelOptions.filter((option) => matchesCurveModel(option.id, option.group));
  const selectCurveModel = (id: string): void => {
    const option = curveModelOptions.find((v) => v.id === id);
    if (!option) return;
    setVariant(id);
    if (option.viaMethod) {
      // Cross-method offer: hand the choice to the method that can actually fit it. The
      // family filter is curvefit-only, so clear it or the target list would be scoped away.
      setMethod(option.viaMethod);
      setFamily("");
    } else if (method === "curvefit") {
      setFamily(option.group ?? "");
    }
    setExpandedCurveModel(null);
    setTypePickerOpen(false);
  };
  const renderCurveModelRow = (id: string, rec?: CurveModelRecommendation): ReactElement => {
    const option = curveModelOptions.find((v) => v.id === id);
    if (!option) return <></>;
    const guidance = variantGuidance(method, id);
    const equation = FIT_PREVIEW_METHODS.has(method) ? fitModelTemplate(method, id) : guidance?.definition ?? ANALYSIS_GUIDANCE[method]?.definition;
    const equationLabel = equation ?? MODEL_EQUATION_PLACEHOLDER[id] ?? "Equation preview unavailable for this model.";
    const expanded = expandedCurveModel === id;
    const current = effVariant === id;
    return (
      <div className={`an-model-row${current ? " is-current" : ""}`} key={id} data-variant={id}>
        <button type="button" className="an-model-main" aria-label={`Select ${option.label}`} aria-pressed={current} onClick={() => selectCurveModel(id)}>
          <span className="an-model-copy">
            <span className="an-model-name">{option.label}</span>
            <span className="an-model-sub">
              {option.viaMethod
                ? `Needs a curve per [inhibitor] — opens in ${methodLabel(option.viaMethod)}.`
                : rec?.reasons[0] ?? guidance?.explain ?? `${option.group ?? "Other"} model`}
            </span>
          </span>
          {option.viaMethod && <span className="an-model-badge an-model-expert" title={`Fitted with ${methodLabel(option.viaMethod)}`}>global fit</span>}
          {rec && <span className={`an-model-badge an-model-${rec.suitability}`}>{rec.suitability}</span>}
          {rec?.suitability === "recommended" && <span className={`an-model-conf an-rec-confidence an-rec-${rec.confidence}`} title={`${rec.confidence} confidence`}>{rec.confidence}</span>}
          {current && <span className="an-model-current">Current</span>}
        </button>
        <button type="button" className="an-model-details" aria-label={`Details for ${option.label}`} aria-expanded={expanded} onClick={() => setExpandedCurveModel(expanded ? null : id)}>
          {expanded ? "Hide" : "Why?"}
        </button>
        {expanded && (
          <div className="an-model-detail" aria-label={`Explanation for ${option.label}`}>
            <div className="an-model-equation">{equationLabel}</div>
            {rec && (
              <div><b>Recommendation evidence</b>
                {rec.reasons.length > 0 && <ul>{rec.reasons.map((reason) => <li key={`rec-reason-${reason}`}>{reason}</li>)}</ul>}
                {rec.warnings.length > 0 && <ul>{rec.warnings.map((warning) => <li key={`rec-warning-${warning}`}>{warning}</li>)}</ul>}
              </div>
            )}
            {guidance ? (
              <>
                <div><b>What it is</b><p>{guidance.explain}</p></div>
                <div><b>Use when</b><p>{guidance.whenToUse}</p></div>
                {guidance.whenNotToUse && <div><b>Not for</b><p>{guidance.whenNotToUse}</p></div>}
                {guidance.assumptions.length > 0 && <div><b>Assumptions</b><ul>{guidance.assumptions.map((item, index) => <li key={`assumption-${index}`}>{item}</li>)}</ul></div>}
                {guidance.warnings.length > 0 && <div><b>Check before running</b><ul>{guidance.warnings.map((item, index) => <li key={`warning-${index}`}>{item}</li>)}</ul></div>}
              </>
            ) : rec ? (
              <>
                {rec.reasons.length > 0 && <div><b>Why</b><ul>{rec.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></div>}
                {rec.assumptions.length > 0 && <div><b>Assumptions</b><ul>{rec.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}</ul></div>}
                {rec.warnings.length > 0 && <div><b>Check before running</b><ul>{rec.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div>}
              </>
            ) : <div>This model is available for expert selection. Check its assumptions and fit diagnostics before interpreting it.</div>}
          </div>
        )}
      </div>
    );
  };  return (
    <div className="modalov" onClick={onCancel}>
      <div className="modal modal-analyze" role="dialog" aria-label="Analyze" onClick={(e) => e.stopPropagation()}>
        <div className="modalh-row">
          <h3 className="modalh">Analyze — {table.name}</h3>
          <GuideHelp target={{ entry: "action:analyze" }} what="Analyze" />
        </div>

        {view === "landing" ? (
          <>
            <div className="an-scroll">
              {analysisRecommendations.length > 0 && (
                <div className="an-recs" aria-label="Recommended for your data">
                  <div className="an-group-h">Recommended for your data</div>
                  <div className="an-rec-list">
                    {analysisRecommendations.map((rec) => {
                      const open = expandedRecommendation === rec.id;
                      return (
                        <div key={rec.id} className={`an-rec${open ? " is-open" : ""}`}>
                          <button
                            type="button"
                            className="an-rec-head"
                            aria-expanded={open}
                            onClick={() => setExpandedRecommendation(open ? null : rec.id)}
                          >
                            <span className="an-rec-main">
                              <span className="an-rec-title">{rec.method ? methodLabel(rec.method) : rec.text}</span>
                              <span className="an-rec-text">{rec.text}</span>
                            </span>
                            <span className={`an-rec-confidence an-rec-${rec.confidence ?? "medium"}`}>{rec.confidence ?? "medium"}</span>
                            <span className="an-rec-go">{open ? "Hide details" : "Details"}</span>
                          </button>
                          {open && (
                            <div className="an-rec-details">
                              {rec.reasons?.length ? (
                                <div className="an-rec-section">
                                  <div className="an-rec-section-title">Why this</div>
                                  <ul className="an-rec-bullets">{rec.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
                                </div>
                              ) : null}
                              {(rec.caveats?.length || rec.assumptions?.length) ? (
                                <div className="an-rec-section">
                                  <div className="an-rec-section-title">Check before running</div>
                                  <ul className="an-rec-bullets">{[...(rec.assumptions ?? []), ...(rec.caveats ?? [])].map((r) => <li key={r}>{r}</li>)}</ul>
                                </div>
                              ) : null}
                              {rec.question?.choices.length ? (
                                <div className="an-rec-section an-rec-question">
                                  <div className="an-rec-section-title">Confirm the study design</div>
                                  <div className="an-rec-question-prompt">{rec.question.prompt}</div>
                                  <div className="an-rec-choice-list">
                                    {rec.question.choices.map((choice) => (
                                      <button key={choice.id} type="button" className="btn-mini" title={choice.description} onClick={() => applyRecommendation(rec, choice)}>
                                        {choice.label}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              ) : null}
                              {rec.alternatives?.length ? (
                                <div className="an-rec-section">
                                  <div className="an-rec-section-title">Other reasonable choices</div>
                                  <ul className="an-rec-bullets">{rec.alternatives.map((r) => <li key={r}>{r}</li>)}</ul>
                                </div>
                              ) : null}
                              {rec.notRecommendedBecause?.length ? (
                                <div className="an-rec-section">
                                  <div className="an-rec-section-title">Not recommended here</div>
                                  <ul className="an-rec-bullets">{rec.notRecommendedBecause.map((r) => <li key={r}>{r}</li>)}</ul>
                                </div>
                              ) : null}
                              <div className="an-rec-actions"><button type="button" className="btn-mini" onClick={() => applyRecommendation(rec)}>Configure</button></div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* By-purpose fast path - the scientific-domain goals up front. */}
              {!showCatalog && (
                <>
                  <div className="an-group-h an-goals-h">
                    Choose what you want to do
                    <span className="an-goals-hint"> — ordered for your {TABLE_FORMATS[table.kind]?.label ?? table.kind} data</span>
                  </div>
                  <div className="an-cards an-goals" role="group" aria-label="Choose what you want to do">
                    {rankedGoals.map((g) => (
                      <button
                        key={g.key}
                        type="button"
                        data-goal={g.key}
                        data-applies={g.applies ? "yes" : "no"}
                        className={`an-card an-goal${g.recommended ? " is-recommended" : ""}${g.applies ? "" : " is-offkind"}`}
                        aria-label={`${g.label} - ${g.sub}${g.recommended ? " (recommended for your data)" : g.applies ? "" : " (not typical for this datasheet)"}`}
                        title={
                          g.recommended
                            ? "Recommended for your data."
                            : g.applies
                              ? `Suits a ${TABLE_FORMATS[table.kind]?.label ?? table.kind} datasheet.`
                              : `Not typical for a ${TABLE_FORMATS[table.kind]?.label ?? table.kind} datasheet — still available if you need it.`
                        }
                        onClick={() => selectGoal(g)}
                      >
                        <span className="an-card-ico"><GoalIcon goal={g.key} /></span>
                        <span className="an-card-h">{g.label}</span>
                        <span className="an-card-sub">{g.sub}</span>
                        {g.recommended && <span className="an-card-badge">Recommended</span>}
                      </button>
                    ))}
                  </div>
                </>
              )}

              <p className="an-current">
                Your data:{" "}
                <span className="an-kindbadge">{TABLE_FORMATS[table.kind]?.label ?? table.kind}</span>
                  <span className="an-currenthint"> — recommendations are guidance; the complete catalog is always available.</span>
              </p>

              {!showCatalog && <div className="an-guided-actions">
                <button type="button" className="btn-mini" onClick={() => setShowCatalog(true)}>
                  Browse all analyses
                </button>
                <span className="an-guided-note">Expert mode: every method, variant, and option is available.</span>
              </div>}

              {showCatalog && <div className="an-catalog-head">
                <div>
                  <div className="an-group-h">Browse all analyses</div>
                  <div className="an-guided-note">Every method and variant is listed below.</div>
                </div>
                <button type="button" className="btn-mini" onClick={() => { setShowCatalog(false); setFilterKind(null); setCatalogQuery(""); }}>
                  Back to guidance
                </button>
              </div>}

              {showCatalog && <input
                className="an-catalog-search"
                aria-label="Search all analyses"
                placeholder="Search analyses..."
                value={catalogQuery}
                onChange={(e) => setCatalogQuery(e.target.value)}
              />}

              {showCatalog && <div className="an-cards" role="group" aria-label="Choose by data type">
                {DATA_TYPE_CARDS.map((c) => {
                  const fmt = TABLE_FORMATS[c.kind];
                  const isCurrent = c.kind === table.kind;
                  const active = filterKind === c.kind;
                  return (
                    <button
                      key={c.kind}
                      type="button"
                      className={`an-card${active ? " is-active" : ""}${isCurrent ? " is-current" : ""}`}
                      aria-pressed={active}
                      aria-label={`${fmt.label} — ${c.methods.length} ${c.methods.length === 1 ? "test" : "tests"}`}
                      title={`${fmt.description}\nGraphs: ${fmt.graphs.join(", ")}`}
                      onClick={() => setFilterKind(active ? null : c.kind)}
                    >
                      <span className="an-card-ico"><DataIcon kind={c.kind} /></span>
                      <span className="an-card-h">{fmt.label}</span>
                      <span className="an-card-sub">{c.blurb}</span>
                      {isCurrent && <span className="an-card-badge">Your data</span>}
                    </button>
                  );
                })}
              </div>}

              {showCatalog && filterKind && (
                <p className="an-filterbar">
                  Showing <b>{TABLE_FORMATS[filterKind].label}</b> tests
                  <button type="button" className="an-clear" onClick={() => setFilterKind(null)}>
                    Show all
                  </button>
                </p>
              )}

              {showCatalog && <div className="an-list">
                {METHOD_GROUPS.map((g) => {
                  const query = catalogQuery.trim().toLowerCase();
                  const methods = g.methods.filter((m) => {
                    // A method can belong to more than one data type (Cox is survival
                    // and multivariable) — match any of them, or it disappears from a
                    // filter it genuinely belongs to.
                    if (filterKind && !(METHOD_KINDS[m] ?? []).includes(filterKind)) return false;
                    if (!query) return true;
                    return methodLabel(m).toLowerCase().includes(query) || g.label.toLowerCase().includes(query);
                  });
                  if (methods.length === 0) return null;
                  // Within a group: what the suggester proposed first, then what suits
                  // this datasheet. The grouping itself stays put so the catalogue
                  // remains a stable, browsable map.
                  const ordered = [...methods].sort(
                    (a, b) => catalogRank(a) - catalogRank(b) || methods.indexOf(a) - methods.indexOf(b),
                  );
                  return (
                    <div className="an-group" key={g.label}>
                      <div className="an-group-h">{g.label}</div>
                      {ordered.map((m) => (
                        <div className="an-item" key={m}>
                          <div className="an-itemrow">
                            <button
                              type="button"
                              className={`an-pick${recommendedMethods.has(m) ? " is-recommended" : ""}${methodFitsKind(m, table.kind) ? "" : " is-offkind"}`}
                              data-method={m}
                              data-fits={methodFitsKind(m, table.kind) ? "yes" : "no"}
                              aria-label={`Configure ${methodLabel(m)}${recommendedMethods.has(m) ? " (recommended for your data)" : methodFitsKind(m, table.kind) ? "" : " (not typical for this datasheet)"}`}
                              title={
                                recommendedMethods.has(m)
                                  ? "Recommended for your data."
                                  : methodFitsKind(m, table.kind)
                                    ? `Suits a ${TABLE_FORMATS[table.kind]?.label ?? table.kind} datasheet.`
                                    : `Not typical for a ${TABLE_FORMATS[table.kind]?.label ?? table.kind} datasheet — still available.`
                              }
                              onClick={() => selectMethod(m)}
                            >
                              <span className="an-pick-name">{methodLabel(m)}</span>
                              {recommendedMethods.has(m) && <span className="an-pick-tag">Recommended</span>}
                              <span className="an-pick-go">Configure →</span>
                            </button>
                            <button
                              type="button"
                              className={`an-detailsbtn${detailsFor === m ? " is-open" : ""}`}
                              aria-label={`Details for ${methodLabel(m)}`}
                              aria-expanded={detailsFor === m}
                              onClick={() => setDetailsFor(detailsFor === m ? null : m)}
                            >
                              Details
                            </button>
                          </div>
                          {detailsFor === m && <InfoPanel method={m} />}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>}
            </div>
            <div className="modalbtns">
              <button className="btn-ghost" onClick={onCancel}>
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="an-confhead">
              <button type="button" className="an-back" onClick={() => setView("landing")}>
                ← All tests
              </button>
              <span className="an-conftitle">{focus ? focus.title : methodLabel(method)}</span>
            </div>
            <div className="an-scroll">
              {focus && focus.blurb}

        {isFitConfig && <div className="an-sec">Model</div>}
        <label className="anrow">
          <span>Test</span>
          <select aria-label="Test" value={method} onChange={(e) => { setMethod(e.target.value); setFamily(""); }}>
            {METHOD_GROUPS.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.methods.map((id) => (
                  <option key={id} value={id}>
                    {methodLabel(id)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>

        {curvefitGroups.length > 0 && (
          <label className="anrow" title="Filter the equation list to one family (dose-response, enzyme kinetics, binding…).">
            <span>Family</span>
            <select aria-label="Equation family" value={familyActive ? family : ""} onChange={(e) => setFamily(e.target.value)}>
              <option value="">All families</option>
              {curvefitGroups.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </label>
        )}

        {shownVariantOpts.length > 0 && (
          <label className="anrow">
            <span>{isCompare ? "Model A" : "Type"}{isFitConfig && <span className="an-req" title="Required">*</span>}</span>
            {(method === "curvefit" || variantOpts.length > 0) ? (
              <>
                {method !== "curvefit" && (
                  <select
                    aria-label={isCompare ? "Model A" : "Type"}
                    value={effVariant}
                    onChange={(e) => setVariant(e.target.value)}
                    tabIndex={-1}
                    style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
                  >
                    {shownVariantOpts.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                  </select>
                )}
                <div className="an-type-picker" ref={typePickerRef}>
                  <button
                    type="button"
                    className={"an-type-trigger" + (typePickerOpen ? " is-open" : "")}
                    aria-label={method === "curvefit" ? "Type" : "Choose analysis variant"}
                    aria-haspopup="dialog"
                    aria-expanded={typePickerOpen}
                    onClick={() => setTypePickerOpen((open) => !open)}
                  >
                    <span>{curveModelLabel(effVariant ?? "")}</span><span className="an-type-chevron">▾</span>
                  </button>
                  {typePickerOpen && (
                    <div className="an-type-popover" role="dialog" aria-label={method === "curvefit" ? "Choose equation model" : "Choose analysis variant"}>
                      <div className="an-type-popover-head">
                        <div>
                          <b>{method === "curvefit" ? "Choose an equation model" : "Choose an analysis variant"}</b>
                          <span>{curveModelOptions.length} {method === "curvefit" ? "models" : "options"} available</span>
                        </div>
                        {method === "curvefit" && familyActive && <button type="button" className="an-type-link" onClick={() => setFamily("")}>Browse all models</button>}
                      </div>
                      <div className="an-type-search-row">
                        <input autoFocus className="an-type-search" aria-label="Search models" placeholder={method === "curvefit" ? "Search models or families..." : "Search options..."} value={curveModelSearch} onChange={(event) => setCurveModelSearch(event.target.value)} />
                        {curveModelSearch && <button type="button" className="an-type-clear" onClick={() => setCurveModelSearch("")}>Clear</button>}
                      </div>
                      {method === "curvefit" && (
                        <>
                          <div className="an-type-goals" aria-label="Curve fitting goals">
                            {(["potency", "shape", "compare", "interpolate", "explore"] as CurveModelGoal[]).map((goalId) => (
                              <button key={goalId} type="button" className={"an-type-chip" + (curveGoal === goalId ? " is-active" : "")} aria-pressed={curveGoal === goalId} onClick={() => setCurveGoal(curveGoal === goalId ? "" : goalId)}>
                                {curveModelGoalLabels[goalId]}
                              </button>
                            ))}
                          </div>
                          <div className="an-type-families" aria-label="Model families">
                            <button type="button" className={"an-type-family" + (!familyActive ? " is-active" : "")} onClick={() => setFamily("")}>All families</button>
                            {curvefitGroups.map((group) => <button key={group} type="button" className={"an-type-family" + (familyActive && family === group ? " is-active" : "")} onClick={() => setFamily(group)}>{group}</button>)}
                          </div>
                        </>
                      )}
                      {/* Recommended for this data — shown for every method, not just curve-fit. */}
                      {recommendedRows.length > 0 ? (
                        <section className="an-type-section" aria-label="Recommended for this data">
                          <div className="an-type-section-head">{anyRecommended ? "Recommended for this data" : "Models for this data — none is recommended"}</div>
                          {recommendedRows.map((rec) => renderCurveModelRow(rec.variant, rec))}
                        </section>
                      ) : method === "curvefit" ? (
                        <div className="an-type-empty">No clear model yet. Use the full model list for exploratory or expert selection.</div>
                      ) : null}
                      <section className="an-type-section an-type-all" aria-label={method === "curvefit" ? "All models" : "All variants"}>
                        <div className="an-type-section-head">{method === "curvefit" ? "All models" : "All variants"}</div>
                        {visibleCurveOptions.map((option) => renderCurveModelRow(option.id, activeVariantRecommendations.find((rec) => rec.variant === option.id)))}
                      </section>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <select aria-label={isCompare ? "Model A" : "Type"} value={effVariant} onChange={(e) => setVariant(e.target.value)}>
                {shownVariantOpts.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
              </select>
            )}          </label>
        )}
        {isCompare && (
          <label className="anrow">
            <span>Model B</span>
            <select aria-label="Model B" value={effVariant2} onChange={(e) => setVariant2(e.target.value)}>
              {[...new Map(variantOpts.map((v) => [v.group ?? "", true])).keys()].map((g) => (
                <optgroup key={g} label={g}>
                  {variantOpts.filter((v) => (v.group ?? "") === g).map((v) => (
                    <option key={v.id} value={v.id}>{v.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
        )}

        {sameModels && (
          <p className="note" style={{ fontSize: 11, color: "var(--danger, #c0392b)" }}>
            Pick two <b>different</b> models to compare.
          </p>
        )}

        {modelTemplate && (
          <div className="an-eqpreview" aria-label="Model equation">
            <span className="an-eqpreview-lbl">{isCompare ? "Model A" : "Equation"}</span>
            <span className="aninfo-eq">{modelTemplate}</span>
          </div>
        )}

        {isCustomFit && (
          <>
            <label className="anrow" style={{ alignItems: "center" }}>
              <span title="Type any function of X. Use X as the independent variable, ^ for powers, and functions like exp, ln, log, sqrt, sin. Every other name (Vmax, KM, A, k…) becomes a parameter to fit.">
                Equation&nbsp;&nbsp;Y =
              </span>
              <input
                type="text"
                aria-label="Equation"
                placeholder="e.g.  Vmax*X/(KM+X)"
                value={equation}
                spellCheck={false}
                onChange={(e) => setEquation(e.target.value)}
                style={{ flex: 1, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
              />
            </label>
            <p className="note" style={{ fontSize: 11 }}>
              Use <b>X</b> as the variable and <b>^</b> for powers; functions{" "}
              <code>exp, ln, log, sqrt, sin, cos, abs, if(cond,a,b)</code>. Every other name is a parameter to fit.
            </p>
            {customParams.length > 0 ? (
              <div className="anrow" style={{ alignItems: "flex-start" }}>
                <span title="Optional starting guess for each parameter (defaults to 1). A good guess helps the fit converge.">
                  Initial values
                </span>
                <div className="angroups">
                  {customParams.map((p) => (
                    <label className="angroup" key={p} style={{ gap: 4 }}>
                      <span style={{ opacity: 0.8 }}>{p}</span>
                      <input
                        type="number"
                        step="any"
                        aria-label={`Initial value for ${p}`}
                        placeholder="1"
                        style={{ width: 64 }}
                        value={initValues[p] ?? ""}
                        onChange={(e) => setInitValues((v) => ({ ...v, [p]: e.target.value }))}
                      />
                    </label>
                  ))}
                </div>
              </div>
            ) : (
              equation.trim() !== "" && (
                <p className="note" style={{ fontSize: 11, color: "var(--danger, #c0392b)" }}>
                  No parameters detected — the equation needs at least one unknown besides X (e.g. <code>A*X+B</code>).
                </p>
              )
            )}
          </>
        )}

        {isFitConfig && (
          <>
            <div className="an-sec">Data</div>
            <Select value={effX} set={setXSel} label={labelA} options={colOpts} required />
            <Select value={effA} set={setColA} label={labelB} options={dsOpts} required />
            {constraintsBlock && (
              <>
                <div className="an-sec">Parameters</div>
                {constraintsBlock}
              </>
            )}
            {showFitOptions && <div className="an-sec">Options</div>}
          </>
        )}

        {showWeighting && (
          <label className="anrow" title="Weight each point's contribution. Use 1/Y² (relative weighting) when the scatter grows with Y — common in dose-response/kinetics — so small and large values are fit with comparable relative error.">
            <span>Weighting</span>
            <select aria-label="Weighting" value={weighting} onChange={(e) => setWeighting(e.target.value)}>
              {WEIGHTING.map((w) => (
                <option key={w.id} value={w.id}>{w.label}</option>
              ))}
            </select>
          </label>
        )}

        {showRout && (
          <label className="anrow" title="ROUT (Motulsky & Brown): a robust fit flags outliers by false-discovery-rate, removes them, then fits the rest by least squares. Use when a few aberrant points would otherwise distort the fit.">
            <span>Outliers</span>
            <span>
              <input type="checkbox" aria-label="Identify and remove outliers (ROUT)" checked={rout} onChange={(e) => setRout(e.target.checked)} />{" "}
              Identify &amp; remove outliers (ROUT)
            </span>
          </label>
        )}

        {showFlag && (
          <label className="anrow" title="Flag the fit as questionable when a diagnostic breaches its threshold. The fit still runs; it just carries a ⚑ with the reasons. Clear a field to switch that one check off.">
            <span>Flag poor fits</span>
            <span>
              <input type="checkbox" aria-label="Flag questionable fits" checked={flagOn} onChange={(e) => setFlagOn(e.target.checked)} />{" "}
              Flag questionable fits
            </span>
          </label>
        )}
        {showFlag && flagOn && (
          <div className="anrow" style={{ alignItems: "start" }}>
            <span>When</span>
            <div style={{ display: "grid", gridTemplateColumns: "auto 84px", gap: "4px 8px", alignItems: "center" }}>
              {([
                ["rSqBelow", "R² is below", "R² below this ⇒ poor overall fit"],
                ["nBelow", "n is below", "Fewer points than this ⇒ too little data"],
                ["dependencyAbove", "dependency is above", "Max parameter dependency above this ⇒ parameters barely separable"],
                ["skewnessAbove", "|skewness| is above", "Max Hougaard |skewness| above this ⇒ SE-based CIs unreliable"],
                ["residNormalityBelow", "residual-normality p is below", "Shapiro p on residuals below this ⇒ residuals non-normal"],
                ["outliersAbove", "outliers removed above", "More ROUT-removed outliers than this (only when ROUT is on)"],
              ] as ReadonlyArray<readonly [keyof FitFlagThresholds, string, string]>).map(([key, label, tip]) => (
                <Fragment key={key}>
                  <span style={{ fontSize: 12 }} title={tip}>{label}</span>
                  <input
                    type="number"
                    className="numin"
                    style={{ width: 80 }}
                    aria-label={`Flag threshold: ${label}`}
                    placeholder="off"
                    value={flagThresholds[key]}
                    onChange={(e) => setFlagThresholds((prev) => ({ ...prev, [key]: e.target.value }))}
                  />
                </Fragment>
              ))}
            </div>
          </div>
        )}

        {isECModel && (
          <label className="anrow" title={`Also report the dose giving any response %, e.g. ${ecPrefix}80 and ${ecPrefix}90. ${ecPrefix}50 is always reported. Comma-separate the levels.`}>
            <span>Also report {ecPrefix}</span>
            <input
              type="text"
              className="numin"
              style={{ width: 120 }}
              aria-label="Report EC at percents"
              placeholder="e.g. 10, 90"
              value={ecLevelsText}
              onChange={(e) => setEcLevelsText(e.target.value)}
            />
          </label>
        )}

        {isICModel && (
          <label className="anrow" title="Cheng-Prusoff: convert the fitted IC50 to an inhibition constant Ki = IC50 / (1 + [ligand]/Kd) for a competitive inhibitor. Enter the ligand/substrate concentration used and its Kd/KM (same units as the doses). Leave blank to skip.">
            <span>Ki from IC50</span>
            <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="number" className="numin" style={{ width: 74 }} aria-label="Ligand concentration" placeholder="[ligand]" value={kiConc} onChange={(e) => setKiConc(e.target.value)} />
              <span style={{ opacity: 0.6 }}>Kd</span>
              <input type="number" className="numin" style={{ width: 74 }} aria-label="Ligand Kd" placeholder="Kd" value={kiKd} onChange={(e) => setKiKd(e.target.value)} />
            </span>
          </label>
        )}

        {method === "meltingtemp" && (
          <>
            <p className="note" style={{ fontSize: 11 }}>
              Temperature is the sheet&apos;s X column. Each dataset ticked above is a sample; every replicate
              subcolumn gets its own Tm, by sigmoid fit and by first derivative, and the sample reports their mean ± SD.
            </p>
            <label className="anrow" title="Let each plateau drift in a straight line (2 more parameters: needs more points on each plateau).">
              <span>Sloped baselines</span>
              <input type="checkbox" aria-label="Sloped baselines" checked={meltSloped} onChange={(e) => setMeltSloped(e.target.checked)} />
            </label>
            <label className="anrow" title="Only temperatures from here up are used. Blank = from the lowest.">
              <span>Temperature from</span>
              <input type="number" step="any" className="numin" aria-label="Temperature from" placeholder="lowest" value={meltFrom} onChange={(e) => setMeltFrom(e.target.value)} />
            </label>
            <label className="anrow" title="Only temperatures up to here are used — set it before a signal drop after the melt (aggregation). Blank = to the highest.">
              <span>Temperature to</span>
              <input type="number" step="any" className="numin" aria-label="Temperature to" placeholder="highest" value={meltTo} onChange={(e) => setMeltTo(e.target.value)} />
            </label>
            <label className="anrow" title="Savitzky-Golay window for the derivative Tm (number of neighbouring points, made odd). Larger = smoother. 0 = automatic (≈10% of the points).">
              <span>Smoothing window</span>
              <input type="number" aria-label="Derivative smoothing window" min={0} max={999} step={2} value={smoothWindow} onChange={(e) => setSmoothWindow(Math.max(0, Number(e.target.value) || 0))} />
            </label>
            <label className="anrow" title="ΔTm = each sample's Tm minus the control's, with a confidence interval from both standard errors.">
              <span>Control sample</span>
              <select aria-label="Control sample" value={effMeltControl} onChange={(e) => setMeltControlId(e.target.value)}>
                <option value="">None (no ΔTm)</option>
                {groupOpts.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            {!meltRangeOk && <p className="note">The temperature window is empty: &quot;from&quot; needs to be below &quot;to&quot;.</p>}
          </>
        )}

        {method === "curvetransform" && effVariant === "smooth" && (
          <label className="anrow" title="Savitzky-Golay smoothing window (number of neighbouring points, made odd). Larger = smoother. Leave 0 for an automatic window (≈10% of the points).">
            <span>Smoothing window</span>
            <input type="number" aria-label="Smoothing window" min={0} max={999} step={2} value={smoothWindow} onChange={(e) => setSmoothWindow(Math.max(0, Number(e.target.value) || 0))} />
          </label>
        )}

        {showThroughPoint && (
          <label className="anrow" title="Force the fitted line through this exact point (x₀, y₀); only the slope is then estimated. Use when the response is known at a reference point (e.g. a calibrated blank).">
            <span>Through point (x₀, y₀)</span>
            <span style={{ display: "inline-flex", gap: 6 }}>
              <input aria-label="Through-point x₀" type="number" step="any" value={throughX} style={{ width: 72 }} onChange={(e) => setThroughX(Number(e.target.value) || 0)} />
              <input aria-label="Through-point y₀" type="number" step="any" value={throughY} style={{ width: 72 }} onChange={(e) => setThroughY(Number(e.target.value) || 0)} />
            </span>
          </label>
        )}

        {!isFitConfig && constraintsBlock}

        {method === "globalfit" && constNames.length > 0 && (
          <>
            <p className="note" style={{ fontSize: 11 }}>
              {CURVE_FIT_CONST_HINT[effVariant ?? ""] ?? (
                <>
                  Fit to every curve at once, sharing <b>{fitParams.join(", ")}</b> (enzyme constants). Each curve is one{" "}
                  <b>{constNames[0]}</b> (e.g. inhibitor concentration) — enter it for each dataset. Include an
                  uninhibited curve ({constNames[0]} = 0) so KM and Ki separate.
                </>
              )}
            </p>
            <div className="anrow" style={{ alignItems: "flex-start" }}>
              <span>{constNames[0]} per curve</span>
              <div className="angroups">
                {groupOpts.map((d) => (
                  <label className="angroup" key={d.id} style={{ gap: 4 }}>
                    <span style={{ opacity: 0.8 }}>{d.name}</span>
                    <input
                      type="number"
                      step="any"
                      aria-label={`${constNames[0]} for ${d.name}`}
                      style={{ width: 64 }}
                      value={constVals[d.id] ?? ""}
                      onChange={(e) => setConstVals((v) => ({ ...v, [d.id]: Number(e.target.value) }))}
                    />
                  </label>
                ))}
              </div>
            </div>
          </>
        )}

        {method === "globalfit" && constNames.length === 0 && (
          <>
            <p className="note" style={{ fontSize: 11 }}>
              One equation is fit to every dataset you pick above (they share the table&apos;s X column). Tick the
              parameters to <b>share</b> across the curves — a single value is estimated for those; the rest are fit
              per curve. (e.g. share <b>Top</b> + <b>Bottom</b>, let each curve keep its own EC50.)
            </p>
            <div className="anrow" style={{ alignItems: "flex-start" }}>
              <span>Shared</span>
              <div className="angroups">
                {fitParams.map((p) => (
                  <label className="angroup" key={p}>
                    <input
                      type="checkbox"
                      checked={sharedParams.has(p)}
                      onChange={(e) =>
                        setSharedParams((s) => {
                          const next = new Set(s);
                          e.target.checked ? next.add(p) : next.delete(p);
                          return next;
                        })
                      }
                    />
                    {p}
                  </label>
                ))}
              </div>
            </div>
            <label
              className="anrow"
              title="Fits the curves twice - as set above, and as one curve with every parameter shared - and asks whether the separate curves fit significantly better (extra-sum-of-squares F test, plus AICc)."
            >
              <span>Compare</span>
              <span>
                <input
                  type="checkbox"
                  aria-label="Test whether one curve fits all datasets"
                  checked={compareOneCurve && fitParams.some((p) => !sharedParams.has(p))}
                  disabled={!fitParams.some((p) => !sharedParams.has(p))}
                  onChange={(e) => setCompareOneCurve(e.target.checked)}
                />{" "}
                Test whether one curve fits all datasets
              </span>
            </label>
          </>
        )}

        {/* Where the groups live. Only shown when the sheet genuinely supports both
            readings, so it never appears as a puzzling extra control. */}
        {rowGroupsAvailable && !xy && ROW_GROUP_METHODS.has(method) && (
          <label
            className="anrow"
            title={`This datasheet has one value column and a "${labelColName}" column of categories. "Rows of ${labelColName}" compares those categories; "Columns" compares the value columns (there is only one here).`}
          >
            <span>Groups from</span>
            <select
              aria-label="Groups from"
              value={groupsFromRows ? "rows" : "columns"}
              onChange={(e) => setGroupsFromRows(e.target.value === "rows")}
            >
              <option value="rows">Rows of {labelColName}</option>
              <option value="columns">Columns (data columns)</option>
            </select>
          </label>
        )}

        {mode === "one" && (
          <Select value={effA} set={setColA} label={useRowGroupsHere ? "Group" : "Dataset"} options={pickOpts} />
        )}
        {mode === "two" && xy && !isFitConfig && (
          <>
            <Select value={effX} set={setXSel} label={labelA} options={colOpts} />
            <Select value={effA} set={setColA} label={labelB} options={dsOpts} />
          </>
        )}
        {method === "roc" && (
          <label className="anrow">
            <input type="checkbox" checked={rocCompare} onChange={(e) => setRocCompare(e.target.checked)} />{" "}
            Compare to a second marker (DeLong test)
          </label>
        )}
        {method === "roc" && rocCompare && (
          <Select value={effMarker2} set={setMarker2} label="Second marker (score)" options={colOpts} />
        )}
        {mode === "two" && !xy && (
          <>
            <Select value={effA} set={setColA} label={labelA} options={pickOpts} />
            <Select value={effB} set={setColB} label={labelB} options={pickOpts} />
          </>
        )}
        {ttestVsControl ? (
          <div className="an-vscontrol an-vscontrol-run">
            <label className="anrow" title="Test every group against one control group in a single run. Each comparison is a t test (Student → Dunnett; Welch → Games-Howell), corrected together for the multiple comparisons.">
              <span>Control group</span>
              <select aria-label="Control group (t test)" value={effTtestControl} onChange={(e) => setTtestControlId(e.target.value)}>
                {pickOpts.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <p className="note" style={{ fontSize: 11, margin: "2px 0 6px" }}>
              A t test compares two groups. To compare every group with one <b>control</b> in a single run — each as a t
              test, corrected together for the multiple comparisons — pick the control above and run{" "}
              {effVariant === "welch" ? "Games-Howell" : "Dunnett"}&apos;s comparisons.{" "}
              <button type="button" className="btn-mini" onClick={runTtestVsControl}>
                Compare every group to “{pickOpts.find((d) => d.id === effTtestControl)?.name ?? "control"}”
              </button>
            </p>
          </div>
        ) : suggestVsControl ? (
          <p className="note an-vscontrol" style={{ fontSize: 11 }}>
            A t test compares two groups. To test every group against one <b>control</b> in a single run —
            corrected for the multiple comparisons — use a one-way ANOVA with Dunnett&apos;s.{" "}
            <button type="button" className="btn-mini" onClick={switchToVsControl}>
              Switch to ANOVA + Dunnett
            </button>
          </p>
        ) : null}
        {method === "twoway" && (
          <>
            <p className="note" style={{ fontSize: 11 }}>
              Factor A = the table rows (X-column levels); factor B = the columns you pick below. Each cell uses that
              column&apos;s replicate subcolumns — the design must be balanced (equal replicates per cell).
            </p>
            <label className="anrow" title="Post-hoc multiple comparisons after the two-way ANOVA. All comparisons share the model's residual (MS_residual) as the pooled error term.">
              <span>Multiple comparisons</span>
              <select aria-label="Two-way comparisons" value={twowayCompare} onChange={(e) => setTwowayCompare(e.target.value)}>
                <option value="none">None</option>
                <option value="rowmeans">Compare row means (factor A)</option>
                <option value="colmeans">Compare column means (factor B)</option>
                <option value="cellmeans">Compare all cell means</option>
              </select>
            </label>
            {twowayCompare !== "none" && (
              <label className="anrow" title="Post-hoc test / multiplicity correction. Tukey = all-pairs; the others also allow selected schemes.">
                <span>Post-hoc test</span>
                <select aria-label="Two-way post-hoc test" value={twowayPosthoc} onChange={(e) => setTwowayPosthoc(e.target.value)}>
                  <option value="tukey">Tukey HSD</option>
                  <option value="bonferroni">Bonferroni</option>
                  <option value="sidak">Šídák</option>
                  <option value="holm-sidak">Holm-Šídák</option>
                  <option value="fdr">Benjamini-Hochberg FDR</option>
                </select>
              </label>
            )}
          </>
        )}
        {method === "survival" && (
          <>
            <label className="anrow" title="With 3 or more groups, run a log-rank test between each pair of survival curves, with a multiplicity correction across the comparisons. The overall (omnibus) log-rank is always reported.">
              <span>Pairwise curve comparisons</span>
              <input aria-label="Pairwise curve comparisons" type="checkbox" checked={survPairwise} onChange={(e) => setSurvPairwise(e.target.checked)} />
            </label>
            {survPairwise && (
              <label className="anrow" title="How the per-pair p-values are corrected for multiple comparisons. Holm-Šídák is the recommended step-down method.">
                <span>Multiplicity correction</span>
                <select aria-label="Multiplicity correction" value={survPwMethod} onChange={(e) => setSurvPwMethod(e.target.value)}>
                  <option value="holm-sidak">Holm-Šídák</option>
                  <option value="bonferroni">Bonferroni</option>
                  <option value="sidak">Šídák</option>
                  <option value="none">None (raw p)</option>
                </select>
              </label>
            )}
            <p className="note" style={{ fontSize: 11 }}>
              The X column is the elapsed time; each column you pick below is a group, its cells <b>1</b> = event /
              <b> 0</b> = censored. A subject is a row where the group cell is filled.
              {survPairwise && <> With 3+ groups, each pair of curves also gets its own log-rank test.</>}
            </p>
          </>
        )}
        {method === "rmanova" && (
          <p className="note" style={{ fontSize: 11 }}>
            Each row is a subject; each column you pick is a condition / timepoint (within-subjects). Only complete
            rows (a value in every condition) are used.
          </p>
        )}
        {method === "mixedanova" && (
          <>
            <p className="note" style={{ fontSize: 11 }}>
              Each dataset you pick is a <b>group</b> (between subjects); each of its <b>subcolumns</b> is one subject,
              measured down the rows; each <b>row</b> is a time point (within subjects). A subject missing a time point
              is left out.
            </p>
            <label className="anrow" title="Multiple comparisons after the mixed ANOVA, Šídák-adjusted over the whole family.">
              <span>Multiple comparisons</span>
              <select aria-label="Mixed ANOVA comparisons" value={mixedCompare} onChange={(e) => setMixedCompare(e.target.value)}>
                <option value="none">None</option>
                <option value="groups">Compare the groups at each time point</option>
                <option value="times">Compare the time points within each group</option>
              </select>
            </label>
          </>
        )}
        {method === "nested" && (
          <p className="note" style={{ fontSize: 11 }}>
            Each column you pick is a <b>group</b>; its <b>replicate subcolumns</b> are the random subgroups
            (e.g. subjects), each subcolumn&apos;s values the replicate measurements. The group effect is tested
            against the among-subgroup variation. Raise <b>Replicates</b> on the data sheet to add subgroup columns.
          </p>
        )}
        {method === "goodnessoffit" && (
          <p className="note" style={{ fontSize: 11 }}>
            Pick the column of <b>observed counts</b> (one per row); each row is a category, labelled by the table&apos;s
            label column. Expected counts default to <b>uniform</b> (equal). Two categories also get an exact binomial test.
          </p>
        )}
        {method === "ancova" && (
          <p className="note" style={{ fontSize: 11 }}>
            The X column is the table&apos;s first column; each dataset you pick below is one regression line (group).
            The test compares their slopes, then — if parallel — their intercepts.
          </p>
        )}
        {isMReg && method !== "multifactor" && (
          <p className="note" style={{ fontSize: 11 }}>
            Pick the <b>outcome</b>{" "}
            {method === "logistic" ? "(the binary 0/1 variable to predict)" : "(the continuous variable to predict)"}, then
            tick the <b>predictors</b>. Each coefficient is that predictor&apos;s effect holding the others fixed
            {method === "logistic" ? " (reported as an odds ratio)" : " (VIF flags collinear predictors)"}. Rows missing
            any chosen value are dropped (complete-case).
          </p>
        )}
        {method === "multifactor" && (
          <p className="note" style={{ fontSize: 11 }}>
            Pick the numeric <b>value</b> (the outcome), then tick 2–4 categorical <b>factor</b> columns — each column&apos;s
            cell values are its levels. Every main effect and interaction gets its own F and p (Type II SS, so an unbalanced
            design is fine). Rows missing the value or any factor level are dropped.
          </p>
        )}
        {isCox && (
          <p className="note" style={{ fontSize: 11 }}>
            Pick the survival <b>time</b> and the <b>event</b> column (1 = event occurred, 0 = censored), then tick
            the <b>predictors</b>. Each coefficient is reported as a <b>hazard ratio</b> — the multiplicative change in
            risk per unit predictor, holding the others fixed. Rows missing any value (or with a non-positive time) are
            dropped.
          </p>
        )}
        {isMixed && (
          <p className="note" style={{ fontSize: 11 }}>
            Pick the numeric <b>value</b> and the <b>random group</b> column (e.g. subject, batch, site — each level is a
            random intercept), then optionally tick <b>fixed factors</b>. Reports the fixed-effect coefficients plus the
            group and residual <b>variance components</b> and the <b>ICC</b>. Fit by REML. Rows missing the value or the
            group are dropped.
          </p>
        )}
        {isMReg && (
          <Select value={effOutcome} set={setOutcomeId} label={method === "multifactor" ? "Value (Y)" : "Outcome (Y)"} options={dsOpts} />
        )}
        {isCox && (
          <>
            <Select value={effOutcome} set={setOutcomeId} label="Time" options={dsOpts} />
            <Select value={effEvent} set={setEventId} label="Event (1) / censored (0)" options={dsOpts.filter((d) => d.id !== effOutcome)} />
          </>
        )}
        {isMixed && (
          <>
            <Select value={effOutcome} set={setOutcomeId} label="Value (Y)" options={dsOpts} />
            <Select value={effEvent} set={setEventId} label="Random group" options={dsOpts.filter((d) => d.id !== effOutcome)} />
          </>
        )}
        {(mode === "many" || isMReg || isCox || isMixed) && (
          <div className="anrow" style={{ alignItems: "flex-start" }}>
            <span>
              {method === "multifactor"
                ? "Factors"
                : isMixed
                ? "Fixed factors (optional)"
                : isMReg || isCox
                ? "Predictors"
                : method === "contingency"
                ? "Count columns"
                : method === "twoway"
                  ? "Factor-B columns"
                  : method === "survival"
                    ? "Group columns"
                    : method === "rmanova"
                      ? "Condition columns"
                      : method === "mixedanova"
                      ? "Groups (datasets)"
                      : method === "nested"
                        ? "Group columns"
                        : method === "globalfit"
                        ? "Curves (Y datasets)"
                        : method === "meltingtemp"
                        ? "Samples (Y datasets)"
                        : hasExplanatory
                        ? "Response variables"
                        : method === "corrmatrix" || method === "pca"
                          ? "Variables"
                          : method === "ancova"
                            ? "Line groups"
                            : "Groups"}
            </span>
            <div className="angroups">
              {pickOpts.map((d) => {
                const special = (isMReg && d.id === effOutcome) || ((isCox || isMixed) && (d.id === effOutcome || d.id === effEvent))
                  || (hasExplanatory && blockIdSets.some((set) => set.has(d.id)));
                return (
                <label className="angroup" key={d.id} style={special ? { opacity: 0.4 } : undefined}>
                  <input
                    type="checkbox"
                    checked={groups.has(d.id)}
                    disabled={special}
                    onChange={(e) =>
                      setGroups((s) => {
                        const next = new Set(s);
                        e.target.checked ? next.add(d.id) : next.delete(d.id);
                        return next;
                      })
                    }
                  />
                  {d.name}
                </label>
                );
              })}
            </div>
          </div>
        )}
        {method === "contingency" && effVariant !== "paired" && (
          <label className="anrow" title="Confidence-interval method for the 2×2 effect sizes. Score/exact (Koopman for relative risk, Baptista-Pike exact for the odds ratio, Newcombe for the risk difference) are the recommended defaults and behave well near 0/1 and with small counts; log-based is the classic Katz / Woolf / Wald method.">
            <span>Effect-size CI method</span>
            <select aria-label="Effect-size CI method" value={ciMethod} onChange={(e) => setCiMethod(e.target.value)}>
              <option value="score">Score / exact — Koopman · Baptista-Pike · Newcombe</option>
              <option value="log">Log — Katz · Woolf · Wald</option>
            </select>
          </label>
        )}
        {method === "blandaltman" && (
          <>
            <label className="anrow" title="Plot each pair's difference as a percentage of its mean (100·(A−B)/mean) instead of absolute units — use this when the scatter of the differences grows with the measurement level (proportional bias).">
              <span>Percent difference</span>
              <input aria-label="Percent difference" type="checkbox" checked={baPercent} onChange={(e) => setBaPercent(e.target.checked)} />
            </label>
            <label className="anrow" title="How many SDs of the differences define the limits of agreement. 1.96 gives the classic 95% limits.">
              <span>Agreement (× SD)</span>
              <input aria-label="Agreement multiplier" type="number" min={0.5} max={4} step={0.01} value={baK} onChange={(e) => setBaK(Math.max(0.5, Math.min(4, Number(e.target.value) || 1.96)))} />
            </label>
            <p className="note" style={{ fontSize: 11 }}>
              Pick the two paired measurement columns (methods A and B). Reports the <b>bias</b> + <b>limits of agreement</b> (bias ± {baK}·SD),
              each with a 95% CI, and adds a <b>Bland-Altman plot</b>.
            </p>
          </>
        )}
        {method === "deming" && (
          <label className="anrow" title="λ = the ratio of the two methods' error variances, σ²(Y)/σ²(X). Leave at 1 for orthogonal (geometric-mean) Deming regression when both methods are equally precise; set λ = (SD_Y/SD_X)² when the analytical SDs differ (e.g. λ = 4 if Y is twice as noisy as X).">
            <span>Error-variance ratio λ</span>
            <input aria-label="Error-variance ratio lambda" type="number" min={0.01} step={0.1} value={demingLambda} onChange={(e) => setDemingLambda(Math.max(0.01, Number(e.target.value) || 1))} />
          </label>
        )}
        {method === "auc" && (
          <>
            {effVariant === "custom" && (
              <label className="anrow" title="Integrate the area relative to this baseline Y value. Peaks are the contiguous runs where Y rises above it.">
                <span>Custom baseline (Y)</span>
                <input aria-label="Custom baseline value" type="number" step="any" value={aucBaselineValue} onChange={(e) => setAucBaselineValue(Number(e.target.value) || 0)} />
              </label>
            )}
            <label className="anrow" title="Ignore peaks shorter than this fraction of the tallest peak's height — a noise filter for small bumps above the baseline. 0 keeps every peak.">
              <span>Min peak height (× tallest)</span>
              <input aria-label="Minimum peak height fraction" type="number" min={0} max={1} step={0.05} value={aucMinPeak} onChange={(e) => setAucMinPeak(Math.max(0, Math.min(1, Number(e.target.value) || 0)))} />
            </label>
          </>
        )}
        {method === "permanova" && (
          <>
            <label className="anrow" title="The column that says which group each case is in. It is left out of the variables.">
              <span>Groups</span>
              <select aria-label="PERMANOVA groups" value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
                <option value="">Choose the group column…</option>
                {dsOpts.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </label>
            <label className="anrow" title="The dissimilarity between two cases. Euclidean works on standardised variables, the geometry of a standardised PCA; Bray-Curtis is the ecology default for abundance data.">
              <span>Distance</span>
              <select aria-label="PERMANOVA distance" value={permMetric} onChange={(e) => setPermMetric(e.target.value)}>
                <option value="euclidean">Euclidean (standardised variables)</option>
                <option value="braycurtis">Bray-Curtis (abundance)</option>
                <option value="jaccard">Jaccard (presence/absence)</option>
                <option value="manhattan">Manhattan (cityblock)</option>
                <option value="canberra">Canberra</option>
                <option value="correlation">1 − correlation</option>
                <option value="cosine">Cosine (direction)</option>
              </select>
            </label>
            <label className="anrow" title="Rearrangements of the group labels for the permutation test. The smallest reachable p is 1/(permutations + 1).">
              <span>Permutations</span>
              <input aria-label="Permutations" type="number" min={99} max={9999} step={100} value={ordPermutations}
                onChange={(e) => setOrdPermutations(Math.max(99, Math.min(9999, Math.floor(Number(e.target.value) || 999))))} />
            </label>
            <label className="anrow" title="Random-number seed for those rearrangements (same seed → same p).">
              <span>Seed</span>
              <input aria-label="Permutation seed" type="number" value={ordSeed} onChange={(e) => setOrdSeed(Math.floor(Number(e.target.value) || 0))} />
            </label>
            {!groupBy ? (
              <p className="note" style={{ fontSize: 11 }}>
                Pick the <b>group column</b> — PERMANOVA compares groups, and Run stays off until it has one.
              </p>
            ) : [...groups].filter((id) => id !== groupBy).length < 2 && (
              <p className="note" style={{ fontSize: 11 }}>
                Pick at least <b>two variables</b> besides the group column to compare the groups on.
              </p>
            )}
            <p className="note" style={{ fontSize: 11 }}>
              Asks whether the groups sit in <b>different places</b> on the chosen distance (pseudo-F, significance by
              permuting the group labels). It also reports <b>PERMDISP</b>, whether the groups differ in <b>spread</b>:
              PERMANOVA reacts to both, so a significant result with unequal spread may not be a difference in position.
            </p>
          </>
        )}
        {method === "pca" && (
          <>
            <label className="anrow" title="Optional: colour the score plot by a categorical column and draw a 95% confidence ellipse per group. The grouping column is excluded from the variables.">
              <span>Group by (optional)</span>
              <select aria-label="Group by" value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
                <option value="">None (single ellipse)</option>
                {dsOpts.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </label>
            <label className="anrow" title="How many principal components to keep. Parallel analysis (Horn's) compares each eigenvalue against random-data noise; Kaiser keeps eigenvalues above a threshold; or fix a count, a cumulative-variance target, or keep all.">
              <span>Components to retain</span>
              <select aria-label="Components to retain" value={pcaSelection} onChange={(e) => setPcaSelection(e.target.value)}>
                <option value="parallel">Parallel analysis (Horn's)</option>
                <option value="kaiser">Kaiser — eigenvalue &gt; threshold</option>
                <option value="fixedk">Fixed number</option>
                <option value="variance">Cumulative variance ≥ …</option>
                <option value="all">All components</option>
              </select>
            </label>
            {pcaSelection === "kaiser" && (
              <label className="anrow" title="Retain components whose eigenvalue exceeds this value. 1.0 (Kaiser's rule) keeps above-average components of the correlation matrix.">
                <span>Eigenvalue threshold</span>
                <input aria-label="Eigenvalue threshold" type="number" min={0} step={0.1} value={pcaKaiser} onChange={(e) => setPcaKaiser(Math.max(0, Number(e.target.value) || 0))} />
              </label>
            )}
            {pcaSelection === "fixedk" && (
              <label className="anrow" title="Keep exactly this many components (clamped to the number of variables).">
                <span>Number of components</span>
                <input aria-label="Number of components" type="number" min={1} step={1} value={pcaFixedK} onChange={(e) => setPcaFixedK(Math.max(1, Math.floor(Number(e.target.value) || 1)))} />
              </label>
            )}
            {pcaSelection === "variance" && (
              <label className="anrow" title="Keep the fewest components whose cumulative % of variance reaches this target.">
                <span>Variance target (%)</span>
                <input aria-label="Variance target" type="number" min={1} max={100} step={1} value={pcaVariancePct} onChange={(e) => setPcaVariancePct(Math.max(1, Math.min(100, Number(e.target.value) || 1)))} />
              </label>
            )}
            {pcaSelection === "parallel" && (
              <label className="anrow" title="Retain a component while its eigenvalue exceeds this percentile of the random-data (noise) eigenvalue distribution. 95 is the usual choice.">
                <span>Random percentile</span>
                <input aria-label="Random percentile" type="number" min={50} max={99.9} step={1} value={pcaParallelPct} onChange={(e) => setPcaParallelPct(Math.max(50, Math.min(99.9, Number(e.target.value) || 95)))} />
              </label>
            )}
            <p className="note" style={{ fontSize: 11 }}>
              Running PCA also draws a <b>PC1 vs PC2 score plot</b> with a 95% covariance ellipse
              {groupBy ? " per group" : " around the cases"}.
            </p>
          </>
        )}
        {method === "cluster" && (
          <>
            <label className="anrow" title="k-means (Lloyd's, seeded k-means++ init) or agglomerative hierarchical clustering cut into k groups.">
              <span>Method</span>
              <select aria-label="Cluster method" value={clusterVariant} onChange={(e) => setClusterVariant(e.target.value)}>
                <option value="kmeans">k-means</option>
                <option value="hierarchical">Hierarchical (agglomerative)</option>
              </select>
            </label>
            <label className="anrow" title="Number of clusters to form.">
              <span>Clusters (k)</span>
              <input aria-label="Clusters" type="number" min={2} max={20} value={clusterK} onChange={(e) => setClusterK(Math.max(2, Math.min(20, Math.floor(Number(e.target.value) || 2))))} />
            </label>
            <label className="anrow" title="Z-score each variable so different units/scales compare fairly.">
              <span>Standardize</span>
              <input aria-label="Standardize" type="checkbox" checked={clusterStd} onChange={(e) => setClusterStd(e.target.checked)} />
            </label>
            {clusterVariant === "kmeans" && (
              <label className="anrow" title="Random-number seed for the k-means++ starting centres (same seed → same clusters).">
                <span>Seed</span>
                <input aria-label="Seed" type="number" value={clusterSeed} onChange={(e) => setClusterSeed(Math.floor(Number(e.target.value) || 0))} />
              </label>
            )}
            {clusterVariant === "hierarchical" && (
              <>
                <label className="anrow" title="Distance metric between observations. Ward / centroid / median force Euclidean.">
                  <span>Distance</span>
                  <select aria-label="Distance" value={clusterMetric} onChange={(e) => setClusterMetric(e.target.value)}>
                    <option value="euclidean">Euclidean</option>
                    <option value="manhattan">Manhattan (cityblock)</option>
                    <option value="cosine">Cosine (direction)</option>
                    <option value="correlation">1 − correlation</option>
                  </select>
                </label>
                <label className="anrow" title="How the distance between two clusters is defined. Ward / centroid / median require the Euclidean metric.">
                  <span>Linkage</span>
                  <select aria-label="Linkage" value={clusterLinkage} onChange={(e) => setClusterLinkage(e.target.value)}>
                    <option value="ward">Ward</option>
                    <option value="average">Average (UPGMA)</option>
                    <option value="weighted">Weighted (WPGMA)</option>
                    <option value="complete">Complete (farthest)</option>
                    <option value="single">Single (nearest)</option>
                    <option value="centroid">Centroid (UPGMC)</option>
                    <option value="median">Median (WPGMC)</option>
                  </select>
                </label>
              </>
            )}
            <label className="anrow" title="Cluster over a range of k and report the within-cluster SS (elbow) + mean silhouette for each, then suggest the best k. The reported clustering above stays at your chosen k.">
              <span>Scan k (elbow + silhouette)</span>
              <input aria-label="Scan k" type="checkbox" checked={clusterScanK} onChange={(e) => setClusterScanK(e.target.checked)} />
            </label>
            {clusterScanK && (
              <label className="anrow" title="The largest k to try in the scan (from k=2).">
                <span>Max k to scan</span>
                <input aria-label="Max k to scan" type="number" min={3} max={30} value={clusterKMax} onChange={(e) => setClusterKMax(Math.max(3, Math.min(30, Math.floor(Number(e.target.value) || 10))))} />
              </label>
            )}
            <p className="note" style={{ fontSize: 11 }}>
              Reports each cluster's size, within-cluster sum of squares, and the mean <b>silhouette width</b>
              {" "}(−1…1; higher = better-separated). Every selected column is a variable.
              {clusterScanK && <> Scanning k also adds a <b>silhouette-vs-k</b> graph to pick the best k.</>}
            </p>
          </>
        )}
        {isPartition && (
          <>
            {/* Two or three blocks, and a column may be in only one. The fractions are
                differences between models fitted on these blocks, so a column counted twice
                would be shared with itself and the partition would stop summing to 1. */}
            {[0, 1, 2].map((bi) => (
              <div className="anrow" style={{ alignItems: "flex-start" }} key={`blk-${bi}`}>
                <span>
                  <input
                    type="text"
                    className="selin"
                    style={{ width: 96 }}
                    aria-label={`Block ${"ABC"[bi]} name`}
                    placeholder={`Block ${"ABC"[bi]}`}
                    value={blockNames[bi] ?? ""}
                    onChange={(e) => setBlockNames((prev) => prev.map((v, i) => (i === bi ? e.target.value : v)))}
                  />
                  {bi === 2 ? <div className="note" style={{ fontSize: 10 }}>optional</div> : null}
                </span>
                <div className="angroups">
                  {pickOpts.map((d) => {
                    const elsewhere = blockIdSets.some((set, i) => i !== bi && set.has(d.id));
                    return (
                      <label className="angroup" key={`b${bi}-${d.id}`} style={groups.has(d.id) || elsewhere ? { opacity: 0.4 } : undefined}>
                        <input
                          type="checkbox"
                          aria-label={"Block " + "ABC"[bi] + " " + d.name}
                          checked={blockIdSets[bi]!.has(d.id)}
                          disabled={groups.has(d.id) || elsewhere}
                          onChange={(e) =>
                            blockSetters[bi]!((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(d.id);
                              else next.delete(d.id);
                              return next;
                            })
                          }
                        />
                        {d.name}
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
            <label className="anrow" title="Standardise the response matrix before it is centred. Hellinger is the usual fix for a species matrix.">
              <span>Transform response</span>
              <select aria-label="Ordination transformation" value={ordTransform} onChange={(e) => setOrdTransform(e.target.value)}>
                <option value="none">None (raw values)</option>
                <option value="hellinger">Hellinger (√ relative abundance)</option>
                <option value="chisq">Chi-square</option>
                <option value="wisconsin">Wisconsin double standardization</option>
                <option value="total">Relative abundance (rows = 1)</option>
                <option value="sqrt">Square root</option>
                <option value="log1p">log(1 + x)</option>
              </select>
            </label>
            <label className="anrow" title="Rearrangements for the permutation test of each unique fraction. The smallest reachable p is 1/(permutations + 1).">
              <span>Permutations</span>
              <input aria-label="Permutations" type="number" min={99} max={9999} step={100} value={ordPermutations}
                onChange={(e) => setOrdPermutations(Math.max(99, Math.min(9999, Math.floor(Number(e.target.value) || 999))))} />
            </label>
            <label className="anrow" title="Random-number seed for those rearrangements (same seed → same p).">
              <span>Seed</span>
              <input aria-label="Permutation seed" type="number" value={ordSeed} onChange={(e) => setOrdSeed(Math.floor(Number(e.target.value) || 0))} />
            </label>
            {blockLists.filter((b) => b.length > 0).length < 2 && (
              <p className="note" style={{ fontSize: 11 }}>
                Put explanatory columns into at least two blocks. With one block there is nothing to
                partition — that is an ordinary redundancy analysis.
              </p>
            )}
            <p className="note" style={{ fontSize: 11 }}>
              Every fraction is an adjusted R². The unique fractions are tested by permutation; a shared
              fraction is a difference between two models, not the fit of one, so it gets no p-value — and
              it can come out negative, which is a real result.
            </p>
          </>
        )}
        {isConstrained && (
          <>
            {/* The second block. A constrained ordination asks what the explanatory
                variables explain about the response, so it needs both lists — and a column
                can only be in one of them, which is why ticking it here greys it above. */}
            <div className="anrow" style={{ alignItems: "flex-start" }}>
              <span>Explanatory variables</span>
              <div className="angroups">
                {pickOpts.map((d) => (
                  <label className="angroup" key={`x-${d.id}`} style={groups.has(d.id) ? { opacity: 0.4 } : undefined}>
                    <input
                      type="checkbox"
                      aria-label={`Explanatory ${d.name}`}
                      checked={explanatoryIds.has(d.id)}
                      disabled={groups.has(d.id)}
                      onChange={(e) =>
                        setExplanatoryIds((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(d.id);
                          else next.delete(d.id);
                          return next;
                        })
                      }
                    />
                    {d.name}
                  </label>
                ))}
              </div>
            </div>
            {isDistanceConstrained && (
              <label className="anrow" title="The dissimilarity between two cases, turned into coordinates before the regression. Bray-Curtis is the ecology default for abundance data; Jaccard reads presence/absence only.">
                <span>Distance</span>
                <select aria-label="Ordination distance" value={ordMetric} onChange={(e) => setOrdMetric(e.target.value)}>
                  <option value="braycurtis">Bray-Curtis (abundance)</option>
                  <option value="jaccard">Jaccard (presence/absence)</option>
                  <option value="euclidean">Euclidean</option>
                  <option value="manhattan">Manhattan (cityblock)</option>
                  <option value="canberra">Canberra</option>
                  <option value="correlation">1 − correlation</option>
                  <option value="cosine">Cosine (direction)</option>
                </select>
              </label>
            )}
            {method !== "cca" && (
            <label className="anrow" title="Standardise the response matrix before it is centred. Hellinger is the usual fix for a species matrix — it makes a Euclidean-geometry method valid on counts.">
              <span>Transform response</span>
              <select aria-label="Ordination transformation" value={ordTransform} onChange={(e) => setOrdTransform(e.target.value)}>
                <option value="none">None (raw values)</option>
                <option value="hellinger">Hellinger (√ relative abundance)</option>
                <option value="chisq">Chi-square</option>
                <option value="wisconsin">Wisconsin double standardization</option>
                <option value="total">Relative abundance (rows = 1)</option>
                <option value="sqrt">Square root</option>
                <option value="log1p">log(1 + x)</option>
              </select>
            </label>
            )}
            {method === "cca" && (
              <p className="note" style={{ fontSize: 11 }}>
                CCA needs no transformation: the chi-square geometry it works in is itself the standardisation,
                applied inside the method. Sites keep their row masses, so a case with more counts weighs more.
              </p>
            )}
            <label className="anrow" title="Whose distances the drawn picture preserves. Symmetric splits the difference and is the usual choice when the cases and the variables are read together.">
              <span>Scaling</span>
              <select aria-label="CA scaling" value={caScaling} onChange={(e) => setCaScaling(e.target.value)}>
                <option value="symmetric">Symmetric (read both together)</option>
                <option value="sites">Cases (distances between cases)</option>
                <option value="species">Variables (distances between variables)</option>
              </select>
            </label>
            <label className="anrow" title="Rearrangements for the permutation test of the model and of each term. The smallest reachable p is 1/(permutations + 1).">
              <span>Permutations</span>
              <input aria-label="Permutations" type="number" min={99} max={9999} step={100} value={ordPermutations}
                onChange={(e) => setOrdPermutations(Math.max(99, Math.min(9999, Math.floor(Number(e.target.value) || 999))))} />
            </label>
            <label className="anrow" title="Random-number seed for those rearrangements (same seed → same p).">
              <span>Seed</span>
              <input aria-label="Permutation seed" type="number" value={ordSeed} onChange={(e) => setOrdSeed(Math.floor(Number(e.target.value) || 0))} />
            </label>
            {explanatoryList.length === 0 && (
              <p className="note" style={{ fontSize: 11 }}>
                Pick at least one <b>explanatory variable</b> — a constrained ordination needs something to
                constrain the axes with, and Run stays off until it has one.
              </p>
            )}
            <p className="note" style={{ fontSize: 11 }}>
              Forces the axes to be <b>linear combinations of the explanatory variables</b>, so the answer is how
              much of the response they explain (reported as R² and Ezekiel&apos;s adjusted R²) and which of them
              carry it. Significance is by <b>permutation</b>, for the whole model and for each term entered last.
            </p>
          </>
        )}
        {method === "ca" && (
          <>
            <label className="anrow" title="Which family's chi-square distances the drawn picture preserves. Symmetric splits the difference and is the usual choice when sites and species are read together.">
              <span>Scaling</span>
              <select aria-label="CA scaling" value={caScaling} onChange={(e) => setCaScaling(e.target.value)}>
                <option value="symmetric">Symmetric (read both together)</option>
                <option value="sites">Sites (distances between cases)</option>
                <option value="species">Species (distances between variables)</option>
              </select>
            </label>
            <p className="note" style={{ fontSize: 11 }}>
              Puts the <b>cases and the variables on the same axes</b> — a case sits near the variables it is
              relatively rich in. Reads <b>counts</b>; every case and every variable needs at least one non-zero
              value. Watch for the <b>arch</b>: a strong single gradient can bend the second axis into a curve of
              the first.
            </p>
          </>
        )}
        {(method === "pcoa" || method === "nmds") && (
          <>
            <label className="anrow" title="The dissimilarity between two cases. Bray-Curtis is the ecology default for abundance data; Jaccard reads presence/absence only.">
              <span>Distance</span>
              <select aria-label="Ordination distance" value={ordMetric} onChange={(e) => setOrdMetric(e.target.value)}>
                <option value="braycurtis">Bray-Curtis (abundance)</option>
                <option value="jaccard">Jaccard (presence/absence)</option>
                <option value="euclidean">Euclidean</option>
                <option value="manhattan">Manhattan (cityblock)</option>
                <option value="canberra">Canberra</option>
                <option value="correlation">1 − correlation</option>
                <option value="cosine">Cosine (direction)</option>
              </select>
            </label>
            <label className="anrow" title="Standardise the matrix before the distance is taken. Hellinger and chi-square are the two that make a Euclidean-geometry method valid on counts; Wisconsin is the usual NMDS pre-treatment.">
              <span>Transform first</span>
              <select aria-label="Ordination transformation" value={ordTransform} onChange={(e) => setOrdTransform(e.target.value)}>
                <option value="none">None (raw values)</option>
                <option value="hellinger">Hellinger (√ relative abundance)</option>
                <option value="chisq">Chi-square</option>
                <option value="wisconsin">Wisconsin double standardization</option>
                <option value="total">Relative abundance (rows = 1)</option>
                <option value="sqrt">Square root</option>
                <option value="log1p">log(1 + x)</option>
              </select>
            </label>
            {method === "pcoa" && (
              <label className="anrow" title="A non-Euclidean dissimilarity produces negative eigenvalues. A correction adds a constant to the distances so the map is exactly Euclidean; without one the axes are still the best fit and the count is reported.">
                <span>Negative eigenvalues</span>
                <select aria-label="Negative eigenvalue correction" value={ordCorrection} onChange={(e) => setOrdCorrection(e.target.value)}>
                  <option value="none">Report them (no correction)</option>
                  <option value="lingoes">Lingoes correction</option>
                  <option value="cailliez">Cailliez correction</option>
                </select>
              </label>
            )}
            {method === "nmds" && (
              <>
                <label className="anrow" title="How many axes the map has. Two is what a figure shows; three lowers the stress but cannot be drawn flat.">
                  <span>Dimensions</span>
                  <input aria-label="Dimensions" type="number" min={1} max={5} value={ordDimensions} onChange={(e) => setOrdDimensions(Math.max(1, Math.min(5, Math.floor(Number(e.target.value) || 2))))} />
                </label>
                <label className="anrow" title="NMDS can settle in a local minimum, so the fit is restarted from this many starts and the lowest-stress solution kept.">
                  <span>Random starts</span>
                  <input aria-label="Random starts" type="number" min={1} max={200} value={ordTries} onChange={(e) => setOrdTries(Math.max(1, Math.min(200, Math.floor(Number(e.target.value) || 20))))} />
                </label>
                <label className="anrow" title="Random-number seed for those starts (same seed → same map).">
                  <span>Seed</span>
                  <input aria-label="Ordination seed" type="number" value={ordSeed} onChange={(e) => setOrdSeed(Math.floor(Number(e.target.value) || 0))} />
                </label>
              </>
            )}
            <p className="note" style={{ fontSize: 11 }}>
              {method === "pcoa"
                ? <>Maps the cases from their <b>distances</b>, so any dissimilarity can be drawn — not only the Euclidean one PCA is fixed to. Each axis carries a share of the variation. Every selected column is a variable.</>
                : <>Uses only the <b>rank order</b> of the dissimilarities. The fit is reported as Kruskal&apos;s <b>stress</b> (&lt; 0.1 good, &lt; 0.2 usable, &gt; 0.3 close to arbitrary), and a <b>Shepard plot</b> shows it directly. Every selected column is a variable.</>}
            </p>
          </>
        )}
        {showPosthoc && (
          <>
            <label className="anrow">
              <span>Post-hoc test</span>
              <select aria-label="Post-hoc test" value={posthoc} onChange={(e) => setPosthoc(e.target.value)}>
                {POSTHOC.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            {posthoc !== "tukey" && posthoc !== "dunnett" && (
              <label className="anrow">
                <span>Comparisons</span>
                <select aria-label="Comparison scheme" value={effScheme} onChange={(e) => setScheme(e.target.value)}>
                  <option value="all-pairs">All pairs of means</option>
                  <option value="vs-control">Each mean vs a control</option>
                  {selectedPairsOk && <option value="selected-pairs">Selected pairs of means</option>}
                </select>
              </label>
            )}
            {needsControl && (
              <label className="anrow">
                <span>Control group</span>
                <select aria-label="Control group" value={effControl} onChange={(e) => setControlId(e.target.value)}>
                  {groupOpts.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {effScheme === "selected-pairs" && (
              <div className="anrow" style={{ alignItems: "flex-start" }}>
                <span>Selected pairs</span>
                <div style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: 168, overflowY: "auto" }}>
                  {groupOpts.length < 2 ? (
                    <p className="note" style={{ fontSize: 11, margin: 0 }}>Pick at least two groups above.</p>
                  ) : (
                    groupOpts.flatMap((a, i) =>
                      groupOpts.slice(i + 1).map((b) => {
                        const on = selectedPairs.some(([x, y]) => (x === a.id && y === b.id) || (x === b.id && y === a.id));
                        return (
                          <label key={`${a.id}|${b.id}`} style={{ display: "flex", gap: 6, fontSize: 12, alignItems: "center" }}>
                            <input
                              type="checkbox"
                              checked={on}
                              onChange={() =>
                                setSelectedPairs((prev) =>
                                  on
                                    ? prev.filter(([x, y]) => !((x === a.id && y === b.id) || (x === b.id && y === a.id)))
                                    : [...prev, [a.id, b.id]],
                                )
                              }
                            />
                            <span>{a.name} vs {b.name}</span>
                          </label>
                        );
                      }),
                    )
                  )}
                  {groupOpts.length >= 2 && selectedPairs.length === 0 && (
                    <p className="note" style={{ fontSize: 11, margin: "2px 0 0" }}>
                      Choose the pairs to compare — the correction (Bonferroni / Šídák / …) counts only these.
                    </p>
                  )}
                </div>
              </div>
            )}
            {posthoc === "holm-sidak" && (
              <p className="note" style={{ fontSize: 11 }}>
                Holm-Šídák is a step-down method — it reports a multiplicity-adjusted P for each pair but no
                confidence interval of the difference (use Tukey, Bonferroni, or Šídák if you need CIs).
              </p>
            )}
          </>
        )}

        {oneSampleT && (
          <label className="anrow">
            <span>Hypothetical mean (μ)</span>
            <input type="number" value={mu} onChange={(e) => setMu(Number(e.target.value) || 0)} />
          </label>
        )}

        {showBound && (
          <>
            <label className="anrow" title="The smallest difference that would actually matter. Choose it on scientific grounds before looking at the data — picking a bound afterwards to obtain equivalence is circular.">
              <span>Equivalence bound (±Δ)<span className="an-req" title="Required">*</span></span>
              <input
                type="number"
                aria-label="Equivalence bound"
                value={bound}
                step="any"
                onChange={(e) => setBound(Number(e.target.value) || 0)}
              />
            </label>
            <label className="anrow" title="How the bound is expressed. Raw units are the clearest when the scale is meaningful; SD units (Cohen's d) suit unfamiliar scales; percent suits ratio measures.">
              <span>Bound units</span>
              <select aria-label="Bound units" value={boundMode} onChange={(e) => setBoundMode(e.target.value)}>
                <option value="absolute">Raw data units</option>
                <option value="sd">SD units (Cohen's d)</option>
                <option value="percent">% of the reference mean</option>
              </select>
            </label>
            {/* Run is blocked until a real bound is given, and a lone red asterisk is
                too easy to miss — the user just saw a dead button. There is
                deliberately no default bound (see `boundOk`), so say that plainly. */}
            {!boundOk && (
              <p className="note" style={{ color: "var(--danger)" }}>
                Enter an equivalence bound above to run this test. There is deliberately no default: ±Δ is the smallest
                difference that would actually matter, and it has to be chosen on scientific grounds{" "}
                <b>before</b> looking at the data.
              </p>
            )}
          </>
        )}

        {showPrior && (
          <label className="anrow" title="The Cauchy prior on the standardized effect size — how large an effect you consider plausible before seeing the data. The Bayes factor is a comparison against this alternative, so the result is always reported with the prior. All three scales are computed either way, as a sensitivity check.">
            <span>Prior scale</span>
            <select aria-label="Prior scale" value={rscale} onChange={(e) => setRscale(e.target.value)}>
              <option value="medium">Medium — r = 0.707 (default)</option>
              <option value="wide">Wide — r = 1.0</option>
              <option value="ultrawide">Ultrawide — r = 1.414</option>
            </select>
          </label>
        )}

        {showResampling && (
          <>
            <label className="anrow" title="Only used when the data are too large to enumerate every rearrangement exactly. When exact enumeration is possible the engine does that instead and says so, and this value is ignored.">
              <span>Resamples</span>
              <input
                type="number"
                aria-label="Resamples"
                min={99}
                step={1000}
                value={nResamples}
                onChange={(e) => setNResamples(Math.max(99, Number(e.target.value) || 99))}
              />
            </label>
            <label className="anrow" title="The random seed. Re-running with the same seed reproduces the same p-value exactly — report it alongside a Monte Carlo p.">
              <span>Random seed</span>
              <input type="number" aria-label="Random seed" step={1} value={seed} onChange={(e) => setSeed(Number(e.target.value) || 0)} />
            </label>
          </>
        )}

        {showTail && (
          <label className="anrow" title="Use a one-tailed test only when the direction of the effect was predicted in advance; it reports a one-sided confidence interval.">
            <span>Direction</span>
            <select aria-label="Test direction" value={tail} onChange={(e) => setTail(e.target.value)}>
              <option value="two-sided">Two-tailed</option>
              <option value="greater">One-tailed (greater)</option>
              <option value="less">One-tailed (less)</option>
            </select>
          </label>
        )}

        {/* With row grouping off (or unavailable) a one-dataset sheet cannot fill two
            pickers, so "pick two different datasets" would be impossible advice —
            name the real cause and the way out instead. */}
        {sameGroups && (
          <p className="note" style={{ color: "var(--danger)" }}>
            {pickOpts.length < 2 ? (
              <>
                This datasheet has only one data column ({dsOpts[0]?.name ?? "one dataset"}), so there is no second
                group to compare it with.{" "}
                {rowGroupsAvailable ? (
                  <>
                    Its groups look like they are the rows of <b>{labelColName}</b> — switch <b>Groups from</b> to{" "}
                    <b>Rows of {labelColName}</b> above.
                  </>
                ) : (
                  <>
                    In a Column datasheet <b>each group is its own column</b> — if your groups are rows, use{" "}
                    <b>Data → Transpose rows and columns</b>, then analyze the transposed sheet.
                  </>
                )}
              </>
            ) : (
              "Pick two different datasets."
            )}
          </p>
        )}
        {method === "meltingtemp" && groups.size < 1 && <p className="note">Pick at least one sample.</p>}
        {mode === "many" && method !== "meltingtemp" && groups.size < 2 && (
          <p className="note">
            {pickOpts.length < 2
              ? "This datasheet has only one data column, so there are no groups to compare. In a Column datasheet each group is its own column — if your groups are rows, use Data → Transpose rows and columns."
              : "Pick at least two groups."}
          </p>
        )}
        {method === "meltingtemp" && datasets.some((d) => d.replicates.length > 1) && (
          <p className="note" style={{ fontSize: 11 }}>
            Replicate subcolumns are fitted one by one — a Tm each — and each sample reports their mean ± SD.
          </p>
        )}
        {method !== "meltingtemp" && datasets.some((d) => d.replicates.length > 1) && (
          <p className="note" style={{ fontSize: 11 }}>
            Replicate subcolumns are pooled as independent observations — the test runs on the raw
            values, not the means.
          </p>
        )}
            <div className="an-sec">About this analysis</div>
            <InfoPanel method={method} variant={effVariant} modelTemplate={modelTemplate} customEquation={isCustomFit ? equation : undefined} />
            </div>

            <div className="modalbtns">
              <label className="grbsel" style={{ marginRight: "auto" }} title="Confidence level for reported intervals (means, effect sizes, post-hoc differences, medians)">
                Confidence
                <select aria-label="Confidence level" value={confPct} onChange={(e) => setConfPct(Number(e.target.value))}>
                  <option value={90}>90%</option>
                  <option value={95}>95%</option>
                  <option value={99}>99%</option>
                </select>
              </label>
              <label className="grbsel" style={{ gap: 6 }} title="Remember these options (not your data or column choices) as the default the next time you run this analysis.">
                <input type="checkbox" aria-label="Make these settings the default for this analysis" checked={makeDefault} onChange={(e) => setMakeDefault(e.target.checked)} />
                Make default
              </label>
              <button className="btn-ghost" onClick={onCancel}>
                Cancel
              </button>
              <button className="btn" disabled={!canRun} onClick={run}>
                Run
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
