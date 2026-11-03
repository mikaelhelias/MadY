/**
 * Methods / Results prose drafting.
 *
 * Turns a completed analysis into a publication-style **Methods** paragraph and a
 * **Results** sentence — the reporting boilerplate a researcher writes by hand — so
 * it can be copied into a manuscript and edited. It reads only what the analysis
 * already carries (`result.title`/`summary`/`assumptions`/`cite`/`terms`/`glance`),
 * plus the per-method purpose clause; it never fabricates numbers and is never
 * auto-inserted anywhere (the UI is an opt-in draft the user reviews).
 *
 * Pure + DOM-free → unit-testable.
 */
import type { Analysis, AnalysisParams, AnalysisResult, DataTable, NodeId, Project } from "@mady/core";
import { fmtNum, fmtP, keyMetrics } from "./analysisExport";
import { datasetName, datasetValues, datasetXY, xyExcludedRows } from "./analysis";

export interface DraftedProse {
  methods: string;
  results: string;
  /**
   * Informative software-stack footnote (Python / NumPy / SciPy / statsmodels with
   * their real versions). Kept out of the Methods paragraph: from the author's point
   * of view they used MadY, and the stack underneath is a footnote, not a claim
   * they need to make in the manuscript body.
   */
  footnote: string;
  /** Formal citations for the software named in the footnote. */
  references?: string[];
}

/**
 * Versions of what actually computed the numbers, read from the running app + stats
 * engine (never hardcoded — a frozen build ships different wheels from a dev
 * checkout). Everything is optional: with nothing supplied the drafted prose simply
 * names the software without versions rather than inventing any.
 */
export interface SoftwareVersions {
  /** MadY's own version. */
  app?: string | undefined;
  /** python / numpy / scipy / statsmodels, as reported by the engine handshake. */
  libraries?: Record<string, string> | undefined;
}

/** Display names + formal citations for the libraries the engine may report. */
const SOFTWARE_CITATIONS: Array<{ key: string; label: string; reference?: string }> = [
  { key: "python", label: "Python" },
  {
    key: "numpy",
    label: "NumPy",
    reference:
      "Harris CR, Millman KJ, van der Walt SJ, et al. Array programming with NumPy. Nature. 2020;585(7825):357–362. doi:10.1038/s41586-020-2649-2",
  },
  {
    key: "scipy",
    label: "SciPy",
    reference:
      "Virtanen P, Gommers R, Oliphant TE, et al. SciPy 1.0: fundamental algorithms for scientific computing in Python. Nature Methods. 2020;17(3):261–272. doi:10.1038/s41592-019-0686-2",
  },
  {
    key: "statsmodels",
    label: "statsmodels",
    reference:
      "Seabold S, Perktold J. statsmodels: econometric and statistical modeling with Python. Proceedings of the 9th Python in Science Conference. 2010:92–96. doi:10.25080/Majora-92bf1922-011",
  },
];

/** "NumPy 2.4.2" — or just "NumPy" when the version is unknown. */
const named = (label: string, version?: string): string => (version ? `${label} ${version}` : label);

/**
 * The Methods sentence naming the software the author actually used: MadY, with its
 * real version when known. The computational stack underneath (Python / NumPy / SciPy /
 * statsmodels) deliberately does not appear here — it is informative only, so it is
 * drafted as a separate footnote (`softwareFootnote`) instead of a claim in the body.
 */
export function softwareNote(versions?: SoftwareVersions): string {
  return `Statistical analysis was performed in ${named("MadY", versions?.app)}.`;
}

/**
 * The informative footnote stating what computes under MadY's hood, with the real
 * versions where they are known. Only libraries the engine actually reported are
 * named: citing statsmodels when it never loaded would be a false claim in a paper.
 */
export function softwareFootnote(versions?: SoftwareVersions): string {
  const libs = versions?.libraries ?? {};
  const present = SOFTWARE_CITATIONS.filter((c) => libs[c.key]);
  const mady = named("MadY", versions?.app);
  if (present.length === 0) {
    // Nothing reported (engine not started, or an older engine) — name the stack
    // without versions rather than printing a placeholder.
    return `${mady} performs its statistical computations using NumPy and SciPy.`;
  }
  const list = present.map((c) => named(c.label, libs[c.key]));
  const tail = list.length === 1 ? list[0]! : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]!}`;
  return `${mady} performs its statistical computations using ${tail}.`;
}

/** Formal citations for the libraries actually used, in a stable order. */
export function softwareReferences(versions?: SoftwareVersions): string[] {
  const libs = versions?.libraries ?? {};
  return SOFTWARE_CITATIONS.filter((c) => c.reference && (libs[c.key] || Object.keys(libs).length === 0))
    .map((c) => c.reference!)
    .filter(Boolean);
}

/** What each method does — the purpose clause for the Methods sentence ("… was used to X"). */
const PURPOSE: Record<string, string> = {
  describe: "summarise the distribution of the sample",
  normality: "test whether the data are normally distributed",
  ttest: "compare the means of the two groups",
  anova: "compare the means across the groups",
  twoway: "test the effects of the two factors and their interaction",
  multifactor: "test the effects of the factors and their interactions",
  rmanova: "compare the repeated-measures conditions",
  mixedanova: "test the effects of the groups, of time and of their interaction, with each subject measured at every time point",
  mixedmodel: "model the fixed and random effects",
  correlation: "quantify the association between the two variables",
  corrmatrix: "quantify the pairwise associations among the variables",
  regression: "model the linear relationship between the variables",
  curvefit: "fit the model to the dose–response data",
  contingency: "test the association between the two categorical variables",
  survival: "compare survival between the groups",
  roc: "assess the classifier's diagnostic performance",
  pca: "reduce the dimensionality of the data",
  ca: "map the cases and the variables together from their chi-square distances",
  rda: "measure how much of the response the explanatory variables explain, and which of them carry it",
  cca: "measure what the explanatory variables explain about a table of counts, in the chi-square geometry correspondence analysis uses",
  dbrda: "measure what the explanatory variables explain about any dissimilarity — Bray-Curtis included — not just a Euclidean one",
  permanova: "test whether the groups of cases differ on the chosen distance, with their spread checked separately (PERMDISP)",
  varpart: "separate what each block of explanatory variables explains on its own from what the blocks explain jointly",
  pcoa: "map the cases from their dissimilarities (principal coordinates)",
  nmds: "map the cases from the rank order of their dissimilarities",
  cluster: "group the observations into clusters",
  ancova: "compare the group means after adjusting for the covariate",
  deming: "compare the two measurement methods",
  passingbablok: "compare the two measurement methods",
  blandaltman: "assess the agreement between the two measurement methods",
  // Without a purpose clause these methods would draft the bare
  // "{Test} was performed" fallback.
  outliers: "screen the data for outliers",
  pcorrect: "correct the P values for multiple comparisons",
  metaanalysis: "pool the study estimates into an overall effect",
  publicationbias: "assess publication bias in the pooled studies (Egger's test and trim-and-fill)",
  equivalence: "test for equivalence within a pre-specified bound",
  permutation: "compare the groups without assuming a particular distribution",
  bayesfactor: "weigh the evidence for and against a difference between the groups",
  nested: "compare the groups given the nested subgroup structure",
  goodnessoffit: "test whether the observed counts fit the expected distribution",
  cox: "model the hazard of the event from the covariates",
  interpolate: "read unknown values off the fitted standard curve",
  globalfit: "fit the model to every dataset with shared parameters",
  meltingtemp: "find the melting temperature (Tm) of each sample",
  comparefits: "compare the candidate models and select the better-supported one",
  auc: "measure the area under the curve",
  curvetransform: "transform the curve",
  multipleregression: "model the outcome from several predictors",
  logistic: "model the probability of the binary outcome from the predictors",
  poisson: "model the count outcome from the predictors",
};

/** The conventional test-statistic symbol for a method/variant (blank = generic). */
function statSymbol(method: string, variant: string | undefined): string {
  const v = variant ?? "";
  switch (method) {
    case "ttest":
      return v === "mann-whitney" ? "U" : v === "wilcoxon" || v === "wilcoxon-1samp" ? "W" : "t";
    case "anova":
      return v === "kruskal" ? "H" : "F";
    case "twoway":
    case "multifactor":
    case "rmanova":
    case "mixedanova":
    case "ancova":
    case "regression":
    case "mixedmodel":
      return "F";
    case "correlation":
      return v === "spearman" ? "ρ" : "r";
    case "contingency":
    case "survival":
      return "χ²";
    default:
      return "";
  }
}

/** Degrees of freedom as text ("18" or the pre-formatted "2, 27"). */
function fmtDf(df: number | string | null | undefined): string | null {
  if (df == null) return null;
  return typeof df === "number" ? String(Number(df.toPrecision(4))) : String(df);
}

/** Methods that reduce to a single "symbol(df) = statistic, p" report. */
const STAT_METHODS = new Set(["ttest", "anova", "rmanova", "contingency", "survival"]);

/** Effect-size glance scalars worth appending to the parenthetical, in order. */
const EFFECT_SIZES: Array<{ key: string; label: string }> = [
  { key: "cohens_d", label: "Cohen's d" },
  { key: "hedges_g", label: "Hedges' g" },
  { key: "eta_sq", label: "η²" },
  { key: "partial_eta_sq", label: "partial η²" },
  { key: "cramers_v", label: "Cramér's V" },
];

/**
 * Does the engine's `summary` already state this quantity, so repeating it in the
 * parenthetical would say the same thing twice in one sentence?
 *
 * The Results sentence is `summary` + a stats parenthetical, and the engine's summaries
 * often already state these quantities, for example:
 *   curve fit  "… Hill slope = 1.01; R² = 0.999."            → R² and Hill repeated
 *   t test     "… significant (p = 1.782e-09)."               → p repeated
 *   ANOVA      "F(2, 21) = 125.7, p = 2.062e-12 … (η² = …)"   → F, p and η² repeated
 *   regression "y = 0.7566·x + 32.54; R² = 0.5364 (slope p …)" → R², slope, slope p repeated
 *
 * Matched on the label, not the value, because the two sides legitimately render the same
 * number differently: `fmtP` floors at "p < 0.0001" where the engine prints the exact
 * "p = 1.782e-09". A value comparison would call those distinct and keep the repeat —
 * which reads worse than the repeat itself, since the reader sees two different p's.
 *
 * The label must begin at a word boundary and be followed by a non-word character, then
 * reach an "=" or "<" within the same clause. That boundary is what saves "EC50 = 3.439"
 * from the summary's "logEC50 = 0.5364": a different quantity that merely spells EC50
 * inside its own name. The gap tolerates "(2, 21) " and " slope ", so "F(2, 21) = …" and
 * "Hill slope = …" are recognised as the same quantity as "F" and "Hill".
 */
function statedInSummary(summary: string, label: string): boolean {
  const name = label.trim();
  if (!name) return false;
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^0-9A-Za-z_])${esc}(?![0-9A-Za-z_])[^;=<]{0,24}?[=<]`).test(summary);
}

/**
 * A publication-style statistics parenthetical. For a single-statistic test the
 * classic "t(18) = 3.42, p = 0.003" (+ an effect size when present); otherwise the
 * method's curated headline metrics (e.g. correlation "r = 0.45, p = 0.01, R² = 0.20").
 *
 * Anything `summary` already states is dropped — see `statedInSummary`. Dropping every
 * part is a legitimate outcome (an ANOVA summary is already a full report); the caller
 * handles an empty parenthetical by omitting it.
 */
function reportStat(result: AnalysisResult, method: string, variant: string | undefined, summary: string): string {
  const fresh = (parts: Array<{ label: string; text: string }>): string =>
    parts.filter((p) => !statedInSummary(summary, p.label)).map((p) => p.text).join(", ");
  const sym = statSymbol(method, variant);
  const primary = result.terms.find((t) => typeof t.statistic === "number" && t.p != null);
  if (STAT_METHODS.has(method) && sym && primary && typeof primary.statistic === "number") {
    const df = fmtDf(primary.df);
    const parts = [{ label: sym, text: `${sym}${df ? `(${df})` : ""} = ${fmtNum(primary.statistic)}` }];
    if (typeof primary.p === "number") parts.push({ label: "p", text: fmtP(primary.p) });
    for (const e of EFFECT_SIZES) {
      const v = result.glance[e.key];
      if (typeof v === "number" && Number.isFinite(v)) {
        parts.push({ label: e.label, text: `${e.label} = ${fmtNum(v)}` });
        break; // one effect size is enough for a sentence
      }
    }
    return fresh(parts);
  }
  // Correlation / regression / curve-fit / etc.: the curated headline value pairs
  // with the coefficient (r, R², slope…), not the raw test statistic.
  // A p-value metric carries an empty label and renders as "p = …" / "p < …".
  return fresh(keyMetrics(result).map((m) => ({ label: m.label || "p", text: m.value })));
}

// ── Significance threshold ──────────────────────────────────────────────────────
// The sentence stating the decision rule is not a fixed constant ("A two-sided P value
// below 0.05 …"), but the test's direction and confidence level are chosen in the
// dialog. A fixed sentence would misstate a one-tailed test at 99%. These derive the
// real sentence from `analysis.params`.

/** Methods whose test has a direction — a one-sided option is meaningful. An F-test
 *  (ANOVA) or a χ² has no side, so `tail` there is noise and must be ignored. */
const DIRECTIONAL_METHODS = new Set(["ttest", "correlation", "permutation", "equivalence"]);

/** The α threshold from the chosen confidence level (default 0.95 → 0.05). */
function alphaOf(params: AnalysisParams): number {
  const c = typeof params.conf === "number" && params.conf > 0 && params.conf < 1 ? params.conf : 0.95;
  return 1 - c;
}

/** Format α as a clean decimal: 0.05, 0.01, 0.1 (no float dust, no trailing zeros). */
function fmtAlpha(a: number): string {
  return a.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

/** Whether this analysis was run one-sided (only where a direction exists). */
function isOneSided(method: string, params: AnalysisParams): boolean {
  return DIRECTIONAL_METHODS.has(method) && (params.tail === "greater" || params.tail === "less");
}

/** The significance sentence for one analysis, from its real settings. */
function significanceNote(method: string, params: AnalysisParams): string {
  const sided = isOneSided(method, params) ? "one-sided" : "two-sided";
  return `A ${sided} P value below ${fmtAlpha(alphaOf(params))} was considered statistically significant.`;
}

/**
 * One significance sentence for a whole project. If every analysis used the same
 * (direction, α) it is the single sentence `significanceNote` writes; if they differ, it states every threshold used
 * rather than asserting a single one that would be false for some tests.
 */
function projectSignificanceNote(analyses: Analysis[]): string {
  const combos = new Map<string, { sided: string; alpha: string }>();
  for (const a of analyses) {
    const sided = isOneSided(a.method, a.params) ? "one-sided" : "two-sided";
    const alpha = fmtAlpha(alphaOf(a.params));
    combos.set(`${sided}|${alpha}`, { sided, alpha });
  }
  const list = [...combos.values()];
  if (list.length <= 1) {
    const only = list[0] ?? { sided: "two-sided", alpha: "0.05" };
    return `A ${only.sided} P value below ${only.alpha} was considered statistically significant.`;
  }
  const phrases = list.map((c) => `${c.alpha} (${c.sided})`);
  const joined = phrases.length === 2 ? `${phrases[0]} and ${phrases[1]}` : `${phrases.slice(0, -1).join(", ")}, and ${phrases[phrases.length - 1]}`;
  return `Statistical significance was assessed at ${joined}, according to each test.`;
}

// ── Post-hoc procedure ──────────────────────────────────────────────────────────
// The multiple-comparison test a user picked (Tukey / Dunnett / Holm-Šídák…) and its
// scheme (all-pairs vs vs-control) are part of the analysis and change the claim, so
// `posthocNote` states them when configured.

/** Prose name of each post-hoc procedure (mirrors the dialog's POSTHOC labels). */
const POSTHOC_PROSE: Record<string, string> = {
  tukey: "Tukey's HSD test",
  "games-howell": "the Games-Howell test",
  tamhane: "Tamhane's T3 test",
  bonferroni: "the Bonferroni correction",
  sidak: "the Šídák correction",
  "holm-sidak": "the Holm-Šídák correction",
  fdr: "the Benjamini-Hochberg false-discovery-rate correction",
  dunnett: "Dunnett's test",
};

/**
 * The Methods sentence describing the post-hoc comparisons, or undefined when none was
 * configured (e.g. Kruskal-Wallis, or a t-test). Reads `params.posthoc/scheme/control`.
 */
function posthocNote(params: AnalysisParams, labels: ProseLabels): string | undefined {
  const name = params.posthoc ? POSTHOC_PROSE[params.posthoc] : undefined;
  if (!name) return undefined;
  // Dunnett is inherently vs-control; otherwise the scheme says how pairs were formed.
  const vsControl = params.posthoc === "dunnett" || params.scheme === "vs-control";
  if (vsControl) {
    const control = typeof params.control === "number" ? labels.groups?.[params.control] : undefined;
    const ctlPhrase = control ? ` (${control})` : "";
    return `Post-hoc comparisons of each group against the control${ctlPhrase} used ${name}.`;
  }
  const scope = params.scheme === "selected-pairs" ? "the selected pairwise comparisons" : "all pairwise comparisons";
  return `Post-hoc ${scope} used ${name}.`;
}

// ── Curve-fit details ───────────────────────────────────────────────────────────
// Weighting, constrained parameters and ROUT outlier removal are all chosen in the
// dialog and make two fits with the same model genuinely different analyses, so the
// draft states them.

/** Prose form of each weighting scheme (mirrors the dialog's WEIGHTING labels). */
const WEIGHTING_PROSE: Record<string, string> = {
  "1/Y2": "1/Y² (relative) weighting",
  "1/YY": "1/Ŷ² (relative, iterative) weighting",
  "1/Y": "1/Y weighting",
  "1/X2": "1/X² weighting",
  "1/X": "1/X weighting",
  "1/SD2": "weighting by 1/SD² (from the replicate scatter)",
  poisson: "Poisson weighting",
};

/**
 * The Methods sentences describing how a curve/regression fit was run — weighting,
 * constrained parameters, ROUT outlier removal — or undefined when it was an ordinary
 * unweighted fit with nothing constrained. Only the parts that were set are stated.
 */
function fitDetailsNote(params: AnalysisParams): string | undefined {
  const bits: string[] = [];
  const w = params.weighting && params.weighting !== "none" ? WEIGHTING_PROSE[params.weighting] : undefined;
  if (w) bits.push(`The fit used ${w} rather than ordinary least squares.`);
  const fixed = params.fixed ? Object.entries(params.fixed).filter(([, v]) => typeof v === "number" && Number.isFinite(v)) : [];
  if (fixed.length) {
    const list = fixed.map(([k, v]) => `${k} at ${fmtNum(v)}`);
    const joined = list.length === 1 ? list[0] : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
    bits.push(`The parameter${fixed.length > 1 ? "s" : ""} ${joined} ${fixed.length > 1 ? "were" : "was"} held constant.`);
  }
  if (params.rout) bits.push("Outliers were identified and removed using the ROUT method before fitting.");
  return bits.length ? bits.join(" ") : undefined;
}

// ── Test-specific settings ──────────────────────────────────────────────────────
// A bare purpose verb is not enough for tests whose whole point is a parameter: the
// equivalence bound is the equivalence test, and a Bayes factor is always relative to
// its prior. These state the setting so the draft is not misleadingly incomplete.

// No inner parentheses: the value already wraps these, e.g. "±0.5 (…)".
const BOUND_UNITS: Record<string, string> = {
  absolute: "raw data units",
  sd: "standard-deviation units",
  percent: "percent of the reference mean",
};

const RSCALE_PROSE: Record<string, string> = {
  medium: "medium (r = √2/2)",
  wide: "wide (r = 1)",
  ultrawide: "ultrawide (r = √2)",
};

/** The Methods sentence for a test whose key setting is a chosen parameter, or
 *  undefined for methods that have none. */
function testDetailsNote(method: string, params: AnalysisParams): string | undefined {
  if (method === "equivalence") {
    if (typeof params.boundLow === "number" && typeof params.boundHigh === "number") {
      return `Equivalence was tested against bounds of ${fmtNum(params.boundLow)} and ${fmtNum(params.boundHigh)} (raw units), chosen in advance.`;
    }
    if (typeof params.bound === "number") {
      const unit = BOUND_UNITS[params.boundMode ?? "absolute"] ?? "raw units";
      return `Equivalence was tested against a bound of ±${fmtNum(params.bound)} (${unit}), chosen in advance.`;
    }
    return undefined;
  }
  if (method === "bayesfactor") {
    const scale = typeof params.rscale === "string" ? RSCALE_PROSE[params.rscale] : typeof params.rscale === "number" ? `r = ${fmtNum(params.rscale)}` : RSCALE_PROSE.medium;
    return `A JZS Cauchy prior on the standardized effect size was used, at the ${scale} scale.`;
  }
  if (method === "permutation" && typeof params.nResamples === "number") {
    return `The null distribution was built from ${params.nResamples} random rearrangements.`;
  }
  return undefined;
}

// ── Complete-case / exclusions ──────────────────────────────────────────────────
// An XY fit (regression, correlation, curve fit) drops rows with missing data in the
// renderer, before the engine ever sees them, so the engine cannot report the
// exclusion (unlike the multivariable/survival methods, which send dense arrays and
// report listwise deletion in their own assumptions). That silent drop is stated here.

/** Methods whose payload is built by `datasetXY`, so the renderer does the dropping. */
const XY_FIT_METHODS = new Set(["regression", "correlation", "curvefit", "interpolate", "comparefits", "globalfit", "auc", "curvetransform"]);

/**
 * The complete-case sentence for an XY analysis, or undefined when nothing was
 * excluded (or the method / columns can't be resolved). Best-effort against the
 * current table, like the variable naming.
 */
function exclusionNote(analysis: Analysis, project: Project): string | undefined {
  if (!XY_FIT_METHODS.has(analysis.method)) return undefined;
  const table = project.tables.find((t) => t.id === analysis.source);
  const [xCol, yDataset] = analysis.params.columns ?? [];
  if (!table || !xCol || !yDataset) return undefined;
  const n = xyExcludedRows(table, xCol, yDataset);
  if (n <= 0) return undefined;
  return `${n} ${n === 1 ? "row" : "rows"} with missing values ${n === 1 ? "was" : "were"} excluded (complete-case analysis).`;
}

// ── Sample size ────────────────────────────────────────────────────────────────
// Counted from the current table with the same helpers that build the payload
// (`datasetValues` pools replicates and resolves row groups; `datasetXY` forms
// pairs), so the reported n matches what the test actually used — after exclusions.
// Best-effort, like the naming: unresolved → no sentence, never a fabricated count.

/** Methods whose selection is one group per column (the whole ANOVA family). */
const N_GROUP_METHODS = new Set(["anova", "rmanova", "nested"]);
/** Methods that read two groups (unless a one-sample variant). */
const TWO_GROUP_N_METHODS = new Set(["ttest", "equivalence", "permutation", "bayesfactor"]);
/** Single measured column. */
const SINGLE_VAR_METHODS = new Set(["describe", "normality", "outliers"]);

/** Join numbers as "3 and 2" (2) or "3, 3, and 2" (≥3). */
function numberList(ns: number[]): string {
  return ns.length === 2 ? `${ns[0]} and ${ns[1]}` : `${ns.slice(0, -1).join(", ")}, and ${ns[ns.length - 1]}`;
}

/** The sample-size sentence for an analysis, or undefined when n can't be counted. */
function sampleSizeNote(analysis: Analysis, project: Project): string | undefined {
  const table = project.tables.find((t) => t.id === analysis.source);
  if (!table?.columns?.length || !table.rows?.length) return undefined;
  const cols = analysis.params.columns ?? [];
  const method = analysis.method;
  const v = analysis.params.variant;
  const count = (id: NodeId | undefined): number => (id ? datasetValues(table, id).length : 0);

  if (SINGLE_VAR_METHODS.has(method)) {
    const n = count(cols[0]);
    return n > 0 ? `The sample size was n = ${n}.` : undefined;
  }
  const oneSample = v === "one-sample" || v === "wilcoxon-1samp";
  if (TWO_GROUP_N_METHODS.has(method)) {
    if (oneSample) {
      const n = count(cols[0]);
      return n > 0 ? `The sample size was n = ${n}.` : undefined;
    }
    const na = count(cols[0]);
    const nb = count(cols[1]);
    if (na <= 0 || nb <= 0) return undefined;
    return na === nb ? `Each group had n = ${na}.` : `Group sizes were n = ${na} and ${nb}.`;
  }
  if (N_GROUP_METHODS.has(method)) {
    const ns = cols.map(count);
    if (ns.some((n) => n <= 0) || ns.length < 2) return undefined;
    return ns.every((n) => n === ns[0])
      ? `Each of the ${ns.length} groups had n = ${ns[0]}.`
      : `Group sizes were n = ${numberList(ns)}.`;
  }
  if (XY_FIT_METHODS.has(method) && cols[0] && cols[1]) {
    const pairs = datasetXY(table, cols[0], cols[1]).x.length;
    return pairs > 0 ? `The fit used n = ${pairs} observations.` : undefined;
  }
  return undefined;
}

// ── Effect size ────────────────────────────────────────────────────────────────
// The Results sentence already reports the effect-size value; Methods should name
// which one. Only the well-defined cases, and the nonparametric variants are gated
// out (a Mann-Whitney does not report Cohen's d) rather than mislabelled.

/** Effect size named in Methods, per method. A function so a variant can veto it. */
function effectSizeName(method: string, variant: string | undefined): string | undefined {
  switch (method) {
    case "ttest":
      return variant === "mann-whitney" || variant === "wilcoxon" || variant === "wilcoxon-1samp" || variant === "ks"
        ? undefined
        : "Cohen's d (with Hedges' g)";
    case "anova":
      return variant === "kruskal" ? undefined : "η² (eta squared)";
    case "rmanova":
      return variant === "friedman" ? undefined : "partial η²";
    case "mixedanova":
      return "partial η²";
    case "correlation":
      return "the correlation coefficient r and R²";
    case "regression":
      return "R²";
    case "contingency":
      return "Cramér's V";
    default:
      return undefined;
  }
}

/** The Methods sentence naming the effect size + how its CI was formed. */
function effectSizeNote(method: string, variant: string | undefined): string | undefined {
  const name = effectSizeName(method, variant);
  return name ? `Effect size is reported as ${name} with a 95% confidence interval.` : undefined;
}

/** Variable / group names resolved from the source table, injected into the prose. */
interface ProseLabels {
  /** Comparison levels — t test (2) / ANOVA (N). */
  groups?: string[] | undefined;
  /** Predictor / X variable — correlation, regression. */
  x?: string | undefined;
  /** Response / Y variable, or the single analysed variable. */
  y?: string | undefined;
  /** Two-way ANOVA factor names, when known. */
  factors?: string[] | undefined;
}

/** A resolved dataset name, or undefined when it can't be named (missing → "?"). */
function safeName(table: DataTable, id: NodeId | undefined): string | undefined {
  if (!id) return undefined;
  try {
    const n = datasetName(table, id);
    return n && n !== "?" ? n : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolve the variable / group names an analysis reads, keyed by method — mirroring
 * `buildAnalysisData`'s column→role convention (c0 = X / first group, c1 = Y / second
 * group). Best-effort: any name that can't be resolved is dropped so the prose falls
 * back to generic wording (and the fake tables in tests resolve to nothing → generic).
 */
function proseLabels(analysis: Analysis, project: Project): ProseLabels {
  const table = project.tables.find((t) => t.id === analysis.source);
  if (!table) return {};
  const cols = analysis.params.columns ?? [];
  const nm = (i: number): string | undefined => safeName(table, cols[i]);
  const v = analysis.params.variant;
  // The first two columns as a group pair (t-test, method comparison).
  const twoNamed = (): ProseLabels => ({ groups: [nm(0), nm(1)].filter((s): s is string => !!s) });
  // Every column as a group — all-or-nothing, since a partial list misnames the set.
  const allNamed = (): ProseLabels => {
    const groups = cols.map((_, i) => nm(i)).filter((s): s is string => !!s);
    return groups.length === cols.length && groups.length >= 2 ? { groups } : {};
  };
  switch (analysis.method) {
    case "describe":
    case "normality":
    case "outliers":
      return { y: nm(0) };
    case "ttest":
    case "equivalence":
    case "permutation":
    case "bayesfactor":
      // A one-sample variant reads one column; otherwise the first two are the groups.
      return v === "one-sample" || v === "wilcoxon-1samp" ? { y: nm(0) } : twoNamed();
    case "anova":
    case "rmanova":
    case "mixedanova":
    case "nested":
    case "meltingtemp":
      return allNamed();
    // Regression family: the first column is the outcome, the rest are predictors.
    case "multipleregression":
    case "logistic":
    case "poisson":
      return { y: nm(0) };
    case "correlation":
    case "regression":
    case "curvefit":
    case "auc":
    case "curvetransform":
      return { x: nm(0), y: nm(1) };
    // Method comparison reads two measurement methods, not an X/Y pair.
    case "deming":
    case "passingbablok":
    case "blandaltman":
      return twoNamed();
    default:
      return {};
  }
}

/** Join names as "A and B" (2) or "A, B, and C" (≥3). */
function nameList(names: string[]): string {
  return names.length === 2
    ? `${names[0]} and ${names[1]}`
    : `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

/** The purpose clause for the Methods lead — name-aware, else the generic PURPOSE map. */
function purposeClause(method: string, labels: ProseLabels): string | undefined {
  const groups = labels.groups?.filter(Boolean) as string[] | undefined;
  const named = groups && groups.length >= 2 ? nameList(groups) : null;
  switch (method) {
    case "describe":
      return labels.y ? `summarise the distribution of ${labels.y}` : PURPOSE.describe;
    case "normality":
      return labels.y ? `test whether ${labels.y} is normally distributed` : PURPOSE.normality;
    case "ttest":
      return named ? `compare the means of ${named}` : PURPOSE.ttest;
    case "anova":
      return named ? `compare the means across ${named}` : PURPOSE.anova;
    case "outliers":
      return labels.y ? `screen ${labels.y} for outliers` : PURPOSE.outliers;
    case "rmanova":
      return named ? `compare ${named} across the repeated measurements` : PURPOSE.rmanova;
    case "mixedanova":
      return named ? `compare ${named} over the repeated time points` : PURPOSE.mixedanova;
    case "nested":
      return named ? `compare ${named} given the nested subgroup structure` : PURPOSE.nested;
    case "meltingtemp":
      return named ? `find the melting temperature (Tm) of ${named}` : PURPOSE.meltingtemp;
    case "equivalence":
      return named ? `test whether ${named} are equivalent within a pre-specified bound` : PURPOSE.equivalence;
    case "permutation":
      return named ? `compare ${named} without assuming a particular distribution` : PURPOSE.permutation;
    case "bayesfactor":
      return named ? `weigh the evidence for and against a difference between ${named}` : PURPOSE.bayesfactor;
    case "multipleregression":
      return labels.y ? `model ${labels.y} from several predictors` : PURPOSE.multipleregression;
    case "logistic":
      return labels.y ? `model the probability of ${labels.y} from the predictors` : PURPOSE.logistic;
    case "poisson":
      return labels.y ? `model the count of ${labels.y} from the predictors` : PURPOSE.poisson;
    case "auc":
      return labels.y ? `measure the area under the ${labels.y} curve` : PURPOSE.auc;
    case "curvetransform":
      return labels.y ? `transform ${labels.y}` : PURPOSE.curvetransform;
    case "correlation":
      return labels.x && labels.y
        ? `quantify the association between ${labels.x} and ${labels.y}`
        : PURPOSE.correlation;
    case "regression":
      return labels.x && labels.y
        ? `model the linear relationship between ${labels.x} and ${labels.y}`
        : PURPOSE.regression;
    case "curvefit":
      return labels.x && labels.y
        ? `fit the model of ${labels.y} against ${labels.x}`
        : PURPOSE.curvefit;
    case "deming":
    case "passingbablok":
      return named ? `compare the ${named} measurement methods` : PURPOSE[method];
    case "blandaltman":
      return named ? `assess the agreement between ${named}` : PURPOSE.blandaltman;
    default:
      return PURPOSE[method];
  }
}

/** The opening Methods sentence for one analysis: "{Test} was used to {purpose} (data: …)." */
function leadSentence(analysis: Analysis, r: AnalysisResult, project: Project, labels: ProseLabels): string {
  const sourceName = project.tables.find((t) => t.id === analysis.source)?.name;
  const testName = (r.title || analysis.name).trim();
  const purpose = purposeClause(analysis.method, labels);
  return purpose
    ? `${testName} was used to ${purpose}${sourceName ? ` (data: “${sourceName}”)` : ""}.`
    : `${testName} was performed${sourceName ? ` on the data in “${sourceName}”` : ""}.`;
}

/**
 * All three effects of a two-way ANOVA as one sentence (main A, main B, interaction) —
 * read from the glance F/df/p scalars. Returns null (→ generic path) if the glance
 * lacks the balanced-two-way scalars.
 */
function twowayResults(r: AnalysisResult, labels: ProseLabels): string | null {
  const g = r.glance;
  const gn = (k: string): number | null => (typeof g[k] === "number" && Number.isFinite(g[k]) ? (g[k] as number) : null);
  if (["F_a", "F_b", "F_ab", "p_a", "p_b", "p_ab"].some((k) => gn(k) === null)) return null;
  const dfR = fmtDf(g["df_resid"] as number | string | null) ?? "?";
  const A = labels.factors?.[0] || "the row factor";
  const B = labels.factors?.[1] || "the column factor";
  const eff = (fKey: string, dfKey: string, pKey: string): string =>
    `F(${fmtDf(g[dfKey] as number | string | null) ?? "?"}, ${dfR}) = ${fmtNum(gn(fKey)!)}, ${fmtP(gn(pKey)!)}`;
  const sig = (pKey: string): boolean => gn(pKey)! < 0.05;
  const main = (name: string, fKey: string, dfKey: string, pKey: string): string =>
    `${sig(pKey) ? "a significant" : "no significant"} main effect of ${name} (${eff(fKey, dfKey, pKey)})`;
  const interaction = `${sig("p_ab") ? "a significant" : "no significant"} interaction (${eff("F_ab", "df_ab", "p_ab")})`;
  return `A two-way ANOVA found ${main(A, "F_a", "df_a", "p_a")}, ${main(B, "F_b", "df_b", "p_b")}, and ${interaction}.`;
}

/**
 * All three effects of a mixed (split-plot) ANOVA as one sentence — groups (against subjects within groups), time and
 * groups × time (against the residual, Greenhouse-Geisser-corrected). Null (→ generic path) if the glance lacks them.
 */
function mixedAnovaResults(r: AnalysisResult): string | null {
  const g = r.glance;
  const gn = (k: string): number | null => (typeof g[k] === "number" && Number.isFinite(g[k]) ? (g[k] as number) : null);
  if (["F_groups", "p_groups", "F_time", "p_time_gg", "F_inter", "p_inter_gg", "gg_epsilon"].some((k) => gn(k) === null)) return null;
  const df = (k: string): string => fmtDf(g[k] as number | string | null) ?? "?";
  const sig = (p: string): string => (gn(p)! < 0.05 ? "a significant" : "no significant");
  const eps = fmtNum(gn("gg_epsilon")!);
  return (
    `A mixed ANOVA found ${sig("p_groups")} difference between the groups (F(${df("df_groups")}, ${df("df_subjects")}) = ${fmtNum(gn("F_groups")!)}, ${fmtP(gn("p_groups")!)}), ` +
    `${sig("p_time_gg")} change over time (F(${df("df_time")}, ${df("df_resid")}) = ${fmtNum(gn("F_time")!)}, Greenhouse-Geisser ${fmtP(gn("p_time_gg")!)}, ε = ${eps}), ` +
    `and ${sig("p_inter_gg")} groups × time interaction (F(${df("df_inter")}, ${df("df_resid")}) = ${fmtNum(gn("F_inter")!)}, Greenhouse-Geisser ${fmtP(gn("p_inter_gg")!)}).`
  );
}

/** The Results sentence for one analysis: interpretation + the stats parenthetical. */
function resultsSentence(analysis: Analysis, r: AnalysisResult, labels: ProseLabels): string {
  if (analysis.method === "twoway") {
    const tw = twowayResults(r, labels);
    if (tw) return tw;
  }
  if (analysis.method === "mixedanova") {
    const mx = mixedAnovaResults(r);
    if (mx) return mx;
  }
  const testName = (r.title || analysis.name).trim();
  const base = (r.summary ?? "").trim().replace(/\s*\.\s*$/, "");
  // `base` is passed in so the parenthetical can drop whatever it already says.
  const stat = reportStat(r, analysis.method, analysis.params.variant, base);
  return base
    ? `${base}${stat ? ` (${stat})` : ""}.`
    : stat
      ? `${testName}: ${stat}.`
      : `${testName} was completed.`;
}

/**
 * Fold the engine's assumption notes into the paragraph as a single flowing bit.
 *
 * The engine authors these as terse annotations for the results-pane bullet list, so
 * one of them can duplicate a sentence the draft writes better itself: when a weighting
 * scheme was chosen, `fitDetailsNote` states it in full ("… used 1/Y² (relative)
 * weighting rather than ordinary least squares"), so the engine's raw "Weighting: 1/Y2."
 * note is dropped here to avoid saying it twice in one paragraph. Everything else passes
 * through verbatim.
 */
function foldedAssumptions(analysis: Analysis): string[] {
  const raw = analysis.result?.assumptions;
  if (!raw?.length) return [];
  const w = analysis.params.weighting;
  const replacedByFitDetails = !!(w && w !== "none" && WEIGHTING_PROSE[w]);
  const kept = raw.filter((a) => !(replacedByFitDetails && /^\s*Weighting:/i.test(a)));
  return kept.length ? [kept.join(" ")] : [];
}

/**
 * The citation / reference sentence, or undefined when it would only restate the model
 * already named in the lead. For a curve fit the lead's title IS the model ("Dose-response
 * (4PL, variable slope) was used to …"), so the engine's model-description `cite`
 * ("Four-parameter logistic (Hill) dose-response; EC50 from the log fit.") is a redundant
 * fragment in prose — dropped. For every other method the cite is a genuine reference
 * (e.g. "Welch, B. L. (1947)") and is kept, normalised to end in a period.
 */
function citeNote(analysis: Analysis): string | undefined {
  const cite = analysis.result?.cite?.trim();
  if (!cite || analysis.method === "curvefit") return undefined;
  return cite.replace(/\.?\s*$/, ".");
}

// ── Curve-fit prose (author it; do not fold the engine diagnostics) ───────────────
// A curve fit's `assumptions` are results-pane caveats written for someone inspecting a
// single fit — the log-transform mechanics ("non-positive doses excluded"), the
// per-parameter CI fallback ("profile-likelihood where the profile converged, else
// SE-based"), the dependency/skew warnings. Grammatical or not, that is software-internal
// bookkeeping, not something a Methods paragraph says. So for a curve fit the draft states
// how the fit was done in its own clean words instead of reproducing those notes; the notes
// still show as bullets on the results pane, where they belong.

/**
 * The base "how it was fit" sentence for a curve fit: just the regression method. The
 * weighting / fixed-parameter / ROUT choices are stated separately by `fitDetailsNote`,
 * and that note phrases a weighted fit as weighted least squares — so when a weighting
 * scheme is set the base statement is omitted to avoid saying "least squares" twice.
 */
function curveFitHowFit(analysis: Analysis): string[] {
  const w = analysis.params.weighting;
  const weighted = !!(w && w !== "none" && WEIGHTING_PROSE[w]);
  return weighted ? [] : ["The curve was fit by nonlinear least-squares regression."];
}

/**
 * The confidence-interval sentence for a curve fit, stated as the intended method without
 * the engine's "…otherwise standard-error-based" per-parameter fallback branch (which is
 * meaningless in prose). Emitted only when the fit actually used profiling.
 */
function curveFitCiNote(analysis: Analysis): string | undefined {
  return (analysis.result?.assumptions ?? []).some((a) => /profile-likelihood/i.test(a))
    ? "95% confidence intervals for the fitted parameters were computed by the profile-likelihood method."
    : undefined;
}

/**
 * The per-analysis method-detail sentences, in reading order: sample size, how the fit /
 * test was done (a curve fit gets clean authored prose; every other method folds its own
 * grammatical assumption sentences), complete-case exclusions, weighting / constraints,
 * the CI method, test-specific settings, post-hoc, effect size, and finally the citation —
 * all before the shared "performed in MadY" + significance sentences. Shared by the
 * single-analysis and whole-project drafts so the two can never drift.
 */
function methodDetailBits(analysis: Analysis, project: Project, labels: ProseLabels): string[] {
  const isCurveFit = analysis.method === "curvefit";
  const bits: string[] = [];
  const sampleSize = sampleSizeNote(analysis, project);
  if (sampleSize) bits.push(sampleSize);
  if (isCurveFit) bits.push(...curveFitHowFit(analysis));
  else bits.push(...foldedAssumptions(analysis));
  const exclusion = exclusionNote(analysis, project);
  if (exclusion) bits.push(exclusion);
  const fitDetails = fitDetailsNote(analysis.params);
  if (fitDetails) bits.push(fitDetails);
  if (isCurveFit) {
    const ci = curveFitCiNote(analysis);
    if (ci) bits.push(ci);
  }
  const testDetails = testDetailsNote(analysis.method, analysis.params);
  if (testDetails) bits.push(testDetails);
  const posthoc = posthocNote(analysis.params, labels);
  if (posthoc) bits.push(posthoc);
  const effectSize = effectSizeNote(analysis.method, analysis.params.variant);
  if (effectSize) bits.push(effectSize);
  const cite = citeNote(analysis);
  if (cite) bits.push(cite);
  return bits;
}

/**
 * Draft a Methods paragraph + a Results sentence for a completed analysis.
 * Returns null when the analysis has not run yet (no result to describe).
 */
export function draftMethodsResults(
  analysis: Analysis,
  project: Project,
  versions?: SoftwareVersions,
): DraftedProse | null {
  const r = analysis.result;
  if (!r) return null;
  const labels = proseLabels(analysis, project);

  // --- Methods --- lead → per-analysis detail (incl. citation) → shared software +
  // significance sentences. The citation sits with the method detail, before "performed
  // in MadY", so a reference never lands after the software note.
  const methodsBits: string[] = [
    leadSentence(analysis, r, project, labels),
    ...methodDetailBits(analysis, project, labels),
    softwareNote(versions),
    significanceNote(analysis.method, analysis.params),
  ];

  return {
    methods: methodsBits.join(" "),
    results: resultsSentence(analysis, r, labels),
    footnote: softwareFootnote(versions),
    references: softwareReferences(versions),
  };
}

/** One analysis's drafted Results sentence, tagged with its sheet name. */
export interface DraftedResult {
  name: string;
  results: string;
}

/**
 * Assemble a single, paper-ready **Methods** paragraph + a per-analysis **Results**
 * list for a whole project — the reproducible-bundle counterpart of the per-analysis
 * `draftMethodsResults`. The shared software / significance-threshold sentences appear
 * once at the end (not repeated per analysis); each analysis contributes its lead
 * sentence, assumption notes and citation. Returns null when nothing has run yet.
 */
export function draftProjectMethods(
  project: Project,
  versions?: SoftwareVersions,
): { methods: string; results: DraftedResult[]; footnote: string; references: string[] } | null {
  const done = project.analyses.filter((a): a is Analysis & { result: AnalysisResult } => !!a.result);
  if (done.length === 0) return null;

  const bits: string[] = [];
  const seen = new Set<string>();
  for (const a of done) {
    const labels = proseLabels(a, project);
    // Dedupe on the analysis identity (method + variant + columns), not the rendered
    // sentence: two genuinely different analyses can render the same generic lead (when
    // their variable names don't resolve), and collapsing those would drop one from the
    // Methods paragraph entirely.
    const key = `${a.method}|${a.params.variant ?? ""}|${(a.params.columns ?? []).join(",")}`;
    if (!seen.has(key)) {
      seen.add(key);
      bits.push(leadSentence(a, a.result, project, labels), ...methodDetailBits(a, project, labels));
    }
  }
  // One significance sentence for the whole bundle — states every threshold used when
  // the analyses disagree, rather than asserting a single one that would be false.
  bits.push(softwareNote(versions), projectSignificanceNote(done));

  return {
    methods: bits.join(" "),
    results: done.map((a) => ({ name: a.name, results: resultsSentence(a, a.result, proseLabels(a, project)) })),
    footnote: softwareFootnote(versions),
    references: softwareReferences(versions),
  };
}
