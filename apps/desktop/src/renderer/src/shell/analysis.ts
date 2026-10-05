/**
 * Analysis helpers — pure mapping from a table + chosen datasets to the
 * engine's numeric `data` payload, plus a default name. Kept out of components so
 * the extraction is unit-tested and shared by run + re-run.
 *
 * A selected "column" id is a **dataset id** (its lead Y column). Replicate
 * subcolumns of one dataset are pooled as independent observations (the
 * conventional model: a t-test/ANOVA consumes the raw replicates, not the row means). XY
 * methods expand to (x, yᵢ) pairs — each row's X paired with each replicate Y.
 * A single-column table has dataset id == column id, so each column is its own
 * dataset.
 */
import type { Annotation, AnalysisParams, DataTable, NodeId, Project } from "@mady/core";
import {
  bracketGeometry,
  buildAnalysisData,
  columnValues,
  datasetName,
  datasetPointSD,
  datasetValues,
  datasetXY,
  planSignificanceBracketsWithSkips,
  resolveThresholds,
  tableDatasets,
  xColumn,
  xyExcludedRows,
} from "@mady/core";

// The engine-payload mapping + its pure helpers live in `@mady/core`
// (`analysisData.ts`) so the headless agent/MCP surface builds the identical
// payload from the same code. Re-exported here for the renderer's imports
// (`import { datasetValues, buildAnalysisData, … } from "./analysis"`).
export { buildAnalysisData, columnValues, datasetName, datasetPointSD, datasetValues, datasetXY, xyExcludedRows };

/**
 * The analyses whose significance markers this graph is carrying, newest binding first.
 *
 * Used to rebuild those markers when a setting that decides which comparisons are planned
 * changes on the graph — the "ns" tick (see `planAnalysisMarkers`): switching it on must
 * make the missing "ns" brackets appear, not wait for the next re-run of the analysis.
 */
export function analysesBoundTo(project: Pick<Project, "plots">, plotId: NodeId): NodeId[] {
  const plot = project.plots.find((p) => p.id === plotId);
  const ids: NodeId[] = [];
  for (const a of plot?.annotations ?? []) {
    const id = a.sig?.analysisId;
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/**
 * Analysis → graph significance markers, as pure data.
 *
 * The whole decision — which graph carries the markers, which comparisons become markers,
 * which group names map to which category positions — lives here rather than in the shell,
 * so the behaviour is testable without an app, a browser or the stats engine. The shell is
 * left with one job: hand the result to `syncAnalysisAnnotations` inside a mutation.
 *
 * Returns `undefined` when nothing can be placed, with the reason the user should be told.
 */
export function planAnalysisMarkers(
  project: Pick<Project, "analyses" | "tables" | "plots">,
  analysisId: NodeId,
  opts?: { control?: string | undefined },
): { plotId: NodeId; groups: string[]; annotations: Omit<Annotation, "id">[]; reason?: string } | { reason: string } {
  const a = project.analyses.find((x) => x.id === analysisId);
  const table = a ? project.tables.find((t) => t.id === a.source) : undefined;
  if (!a?.result || !table) return { reason: "This analysis has no result yet — run it first." };
  // Any kind whose bracket endpoints are categories: bars included, in either orientation.
  // A graph created BY this analysis wins over any other of the same table.
  const plots = project.plots.filter((p) => p.source === table.id);
  const target =
    plots.find((p) => p.analysisSource === analysisId && bracketGeometry(p).endpoints.startsWith("category")) ??
    plots.find((p) => bracketGeometry(p).endpoints.startsWith("category"));
  if (!target) {
    return { reason: "Open a graph whose groups sit on a category axis (bar, box, violin, column scatter, lollipop…) first." };
  }
  const geom = bracketGeometry(target);
  const datasets = tableDatasets(table);
  // Categories come from the datasets on a box/violin, but from the rows on a bar —
  // getting this backwards silently places every bracket on the wrong pair.
  const rowLabels = table.rows.map((r, i) => {
    const xc = xColumn(table);
    const raw = xc ? r.cells[xc.id] : null;
    return raw == null || String(raw).trim() === "" ? String(i + 1) : String(raw);
  });
  // Cell names ("Day 1 · Control") → sub-bar positions, for the within-group markers a
  // two-way cell-means run produces. Only where the drawing has a
  // sub-bar to stand on: row-category kinds, whose grouped layout draws one bar per
  // dataset inside each category. The " · " join mirrors the engine's own cell labels
  // (rowLabel · datasetName — `engine.py` two-way post-hoc).
  const cellCapable = geom.endpoints === "category-row";
  const groups = cellCapable ? rowLabels : datasets.map((d) => d.name);
  // The control picker also offers the series on a two-way — its factor-B control
  // ("Control" the dataset) is the reference the within-group comparisons run against.
  const controlChoices = cellCapable && a.method === "twoway" ? [...groups, ...datasets.map((d) => d.name)] : groups;
  const vals = datasets.flatMap((d) => datasetValues(table, d.id)).filter((v) => Number.isFinite(v));
  if (vals.length === 0) return { plotId: target.id, groups: controlChoices, annotations: [], reason: "This data has no numeric values." };
  const max = Math.max(...vals);
  const min = Math.min(...vals);
  const valueSpec = geom.valueAxis === "x" ? target.xAxis : target.yAxis;
  // The control is the plot's, unless the caller is applying a change in the same tick.
  const control = opts && "control" in opts ? opts.control : target.significanceControl;
  const { plans, skips } = planSignificanceBracketsWithSkips({
    terms: a.result.terms,
    categoryIndex: new Map(groups.map((n, i) => [n, i + 1])),
    ...(cellCapable
      ? { cellIndex: new Map(rowLabels.flatMap((r, ri) => datasets.map((d, di) => [`${r} · ${d.name}`, { cat: ri + 1, series: di + 1 }] as const))) }
      : {}),
    range: { min, max, span: max - min },
    thresholds: target.significance?.thresholds,
    // Every comparison, or only the significant ones — decided by the graph's own "ns" setting
    // (Annotate ▸ Significance ▸ Thresholds: the "hide" tickbox beside the not-significant label;
    // unticked, ns is shown). With ns shown the figure is meant to say
    // what happened to each treatment, so a comparison that missed the cut-off is drawn as "ns"
    // rather than dropped; the drawing then hides nothing the analysis found: it shows
    // significance for all treatments. With ns hidden (the default) an
    // unlabelled bracket would be meaningless, so those comparisons are not planned at all.
    onlySignificant: target.significance?.hideNs !== false,
    scale: valueSpec?.scale === "log10" || valueSpec?.scale === "log2" ? "log" : "linear",
    reversed: valueSpec?.reversed ?? false,
    ...(control ? { control } : {}),
  });
  const alpha = Math.max(...resolveThresholds(target.significance?.thresholds).map((t) => t.p));
  return {
    plotId: target.id,
    groups: controlChoices,
    // Provenance travels with every marker — which analysis, which tidy row, which two
    // groups — and is what lets a re-run replace exactly this set and nothing else.
    annotations: plans.map((b) => ({
      kind: "bracket" as const,
      from: b.from,
      to: b.to,
      ...(b.fromSeries != null ? { fromSeries: b.fromSeries } : {}),
      ...(b.toSeries != null ? { toSeries: b.toSeries } : {}),
      bracketY: b.bracketY,
      // The planner's data-unit height — the scene may lift the ladder clear of pixel ink;
      // a hand drag clears the flag (moveAnnotation).
      plannedY: true,
      p: b.p,
      role: "significance" as const,
      sig: {
        analysisId,
        term: b.term,
        groupA: b.groupA,
        groupB: b.groupB,
        domain:
          b.fromSeries != null || b.toSeries != null
            ? ("cell" as const)
            : geom.endpoints === "category-row"
              ? ("row" as const)
              : ("dataset" as const),
      },
    })),
    // An empty plan has three causes and only one of them is "nothing significant".
    // When significant comparisons exist but their names resolve to nothing on this
    // graph, saying "no significant comparisons" is false, so the placement cause must
    // win. On grouped (row-category) kinds cell terms place as within-group brackets,
    // so unmatched there means the names genuinely fit nothing; kinds without sub-bars
    // cannot draw a within-group comparison at all, and the message says which.
    ...(plans.length === 0
      ? {
          reason:
            skips.unmatchedSignificant > 0
              ? (skips.unmatchedSignificant === 1
                  ? `1 significant comparison exists ("${skips.unmatchedExample}"), but the groups it compares match `
                  : `${skips.unmatchedSignificant} significant comparisons exist (e.g. "${skips.unmatchedExample}"), but the groups they compare match `) +
                (cellCapable
                  ? `no category (or bar within one) on this graph.`
                  : `no category on this graph — within-group comparisons cannot be drawn on this graph kind.`)
              : control
                ? `No significant comparisons against "${control}" (all p ≥ ${alpha}).`
                : `No significant pairwise comparisons (all p ≥ ${alpha}).`,
        }
      : {}),
  };
}

/** A planned significance bracket (1-based group endpoints + height + label + p). */
export interface BracketPlan {
  from: number;
  to: number;
  bracketY: number;
  /** The comparison p-value. The label is derived from this at build time through the
   *  plot's threshold ladder — a frozen label here would pin the marker to one vocabulary
   *  and fight `labelOverride`. */
  p: number;
}

/**
 * Turn an analysis's pairwise comparison rows (tidy `term` "A vs B" + `p`) into
 * stacked significance brackets for a box/violin/column-scatter graph, where each
 * category = one group. `categoryIndex` maps a group/dataset name → its 1-based
 * category position on the graph; `range` is the data's {max, span} used to stack
 * the bracket heights above the data. Significant pairs (p < 0.05) only by
 * default; narrower spans stack lower so nested brackets read cleanly. Pairs whose
 * names aren't on the graph (or with no p) are skipped.
 */
export function buildSignificanceBrackets(
  terms: { term: string; p?: number | null }[],
  categoryIndex: Map<string, number>,
  range: { max: number; span: number },
  opts?: { onlySignificant?: boolean },
): BracketPlan[] {
  const onlySig = opts?.onlySignificant ?? true;
  const comps: { a: number; b: number; p: number }[] = [];
  for (const t of terms) {
    if (t.p == null || !Number.isFinite(t.p)) continue;
    const parts = t.term.split(" vs ");
    if (parts.length !== 2) continue;
    const ia = categoryIndex.get(parts[0]!.trim());
    const ib = categoryIndex.get(parts[1]!.trim());
    if (ia == null || ib == null || ia === ib) continue;
    if (onlySig && t.p >= 0.05) continue;
    comps.push({ a: Math.min(ia, ib), b: Math.max(ia, ib), p: t.p });
  }
  // Narrower spans first → they stack at lower heights (nested look).
  comps.sort((x, y) => x.b - x.a - (y.b - y.a) || x.a - y.a);
  const unit = range.span > 0 ? range.span : Math.max(Math.abs(range.max), 1);
  return comps.map((c, k) => ({
    from: c.a,
    to: c.b,
    bracketY: range.max + unit * (0.06 + k * 0.085),
    p: c.p,
  }));
}

/** One group's compact-letter assignment (the group name + its shared letters, e.g. "ab"). */
export interface LetterGroup {
  name: string;
  letters: string;
}

/**
 * Compact Letter Display (Piepho "insert-and-absorb"): assign each group a set of
 * letters such that two groups share a letter **iff** they are not significantly
 * different. Input is the ordered group names + the list of significantly-different
 * pairs (by name). Returns one entry per group, in input order, with letters
 * ordered left-to-right (the first letter-set spans the earliest groups).
 *
 * Algorithm: start with one letter-set containing every group; for each
 * significant pair, split every set that holds both (dropping one member each),
 * then "absorb" any set that is a subset of another. The surviving sets are the
 * letters. This is the standard compact letter display algorithm, as in R's multcompView package.
 */
export function compactLetterDisplay(
  groups: string[],
  significantPairs: Array<[string, string]>,
): LetterGroup[] {
  const index = new Map(groups.map((g, i) => [g, i] as const));
  // Letter-sets as sorted member arrays (sets of group names).
  let sets: string[][] = [groups.slice()];
  const key = (s: string[]): string => s.join("");
  const dedupe = (list: string[][]): string[][] => {
    const seen = new Set<string>();
    const out: string[][] = [];
    for (const s of list) {
      if (s.length === 0) continue;
      const k = key(s);
      if (!seen.has(k)) {
        seen.add(k);
        out.push(s);
      }
    }
    return out;
  };
  const subset = (a: string[], b: string[]): boolean => {
    const bs = new Set(b);
    return a.every((x) => bs.has(x));
  };
  const absorb = (list: string[][]): string[][] => {
    const clean = dedupe(list);
    return clean.filter((s, i) => !clean.some((o, j) => i !== j && subset(s, o) && (s.length < o.length || j < i)));
  };

  for (const [a, b] of significantPairs) {
    if (!index.has(a) || !index.has(b) || a === b) continue;
    const next: string[][] = [];
    for (const s of sets) {
      if (s.includes(a) && s.includes(b)) {
        next.push(s.filter((x) => x !== a));
        next.push(s.filter((x) => x !== b));
      } else {
        next.push(s);
      }
    }
    sets = absorb(next);
  }

  // Order letters by the earliest group they contain (so letters read a,b,c… L→R).
  sets.sort((x, y) => Math.min(...x.map((g) => index.get(g)!)) - Math.min(...y.map((g) => index.get(g)!)));
  const letterOf = (i: number): string => String.fromCharCode(97 + i); // a, b, c…
  const result = new Map<string, string>(groups.map((g) => [g, ""] as const));
  sets.forEach((s, li) => {
    for (const g of s) result.set(g, (result.get(g) ?? "") + letterOf(li));
  });
  return groups.map((g) => ({ name: g, letters: result.get(g) || letterOf(0) }));
}

/**
 * Plan compact-letter text annotations for a categorical (box/violin/scatter)
 * graph: one letter label centred above each group's band. `groups` are the
 * dataset names in left-to-right order; `significantPairs` come from the
 * analysis's pairwise rows (p < 0.05). Returns `{ x, y, label }` in fractional
 * plot-space (resize-safe), or [] when there are fewer than two groups.
 */
export function buildLetterAnnotations(
  groups: string[],
  significantPairs: Array<[string, string]>,
  y = 0.05,
): Array<{ x: number; y: number; label: string }> {
  if (groups.length < 2) return [];
  const cld = compactLetterDisplay(groups, significantPairs);
  const n = groups.length;
  return cld.map((g, i) => ({ x: (i + 0.5) / n, y, label: g.letters }));
}

/** Extract the significantly-different name pairs (p < 0.05) from tidy "A vs B" rows. */
export function significantPairs(terms: { term: string; p?: number | null }[]): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const t of terms) {
    if (t.p == null || !Number.isFinite(t.p) || t.p >= 0.05) continue;
    const parts = t.term.split(" vs ");
    if (parts.length !== 2) continue;
    out.push([parts[0]!.trim(), parts[1]!.trim()]);
  }
  return out;
}

/**
 * Per-test reference card (in-depth chooser): a compact equation outline, a
 * 2–3 sentence plain-language explanation, and a "when to use / when not to use"
 * pair shown in the Analyze dialog. Equations use plain Unicode (no LaTeX) and
 * are the standard textbook forms; explanations say what the test asks, what the
 * data should look like, and how to read it. The guidance lines give standard
 * chooser advice so the right test is obvious before running it.
 */
export interface MethodInfo {
  /** Compact equation outline (Unicode plain text). */
  equation: string;
  /** 2–3 sentence plain-language description. */
  explain: string;
  /** One line: the situation this test is the right tool for. */
  whenToUse: string;
  /** One line: a common situation where it is the wrong tool (omit if none stands out). */
  whenNotToUse?: string;
}

/**
 * Per-VARIANT guidance shown under the method card when a specific variant is
 * picked (the method card is per-method; these are the variant-level caveats —
 * Welch/Brown-Forsythe/KS/ratio/Friedman/etc.).
 * Keyed by `${method}:${variant}`.
 */
export const VARIANT_NOTE: Record<string, string> = {
  "ttest:welch": "Welch's t does not assume equal variances — prefer it by default when the two SDs may differ; with equal SDs it agrees with Student's t.",
  "ttest:mann-whitney": "Compares whole rank distributions — it tests a difference in medians only when the two distributions have the same shape; otherwise it tests stochastic dominance (one group tending to exceed the other).",
  "ttest:wilcoxon": "Paired rank test — assumes the paired differences are symmetric about the median; zero-differences are dropped.",
  "ttest:wilcoxon-1samp": "Tests the median against μ, assuming the distribution of (value − μ) is roughly symmetric.",
  "ttest:ks": "Sensitive to any difference between the two distributions (location, spread, shape) — low power for a pure shift in location, and the p-value is only approximate with ties / discrete data.",
  "ttest:ratio-paired": "For multiplicative / lognormal data: works on log(A/B) and tests whether the geometric-mean ratio = 1 (a constant fold-change). Needs all-positive values.",
  "anova:welch": "Welch's ANOVA relaxes the equal-SD assumption — prefer it (or Brown-Forsythe) when group SDs differ markedly; still assumes roughly normal groups.",
  "anova:brown-forsythe": "Brown-Forsythe F* compares group means under unequal variances — this is the means test, not the Levene-type variance test that shares the name.",
  "anova:kruskal": "Rank-based; like Mann-Whitney it compares medians only when the group distributions share the same shape.",
  "rmanova:friedman": "Nonparametric repeated measures; Dunn's post-hoc reports a Bonferroni-adjusted P only (no confidence interval).",
  "correlation:spearman": "Rank-based monotonic association — use it for non-linear-but-monotonic trends or ordinal data; no CI is reported for ρ.",
  "regression:origin": "Forcing the line through (0,0) is only valid when the response is known to be zero at x = 0 — it can badly bias the slope otherwise.",
  "regression:point": "Forces the line through the point (x₀, y₀) you enter (only the slope is fitted). Use only when that point is known independently — it biases the slope like force-through-origin does.",
  "curvefit:homologous_competition": "The same ligand is used hot + cold. In the Constraints panel below, fix 'Hot' to your known radioligand concentration — otherwise Kd and Hot are confounded (only their sum is defined by the curve). X = [cold competitor], fit on a log scale.",
  "curvefit:custom": "Type any Y = f(X, …); every name other than X (and pi/e) becomes a fitted parameter. The fit uses least squares — inheriting your weighting, initial values, and any fixed/bounded parameters — and reports each parameter with a 95% CI plus R², exactly like the built-in models.",
};

export interface VariantGuidance {
  explain: string;
  /** A test statistic, model definition, or symbolic equation for this option. */
  definition?: string;
  whenToUse: string;
  whenNotToUse?: string;
  assumptions: string[];
  warnings: string[];
  alternatives?: string[];
}

/** Detailed, model-specific guidance. The equation itself remains sourced from core. */
export const VARIANT_GUIDANCE: Record<string, VariantGuidance> = {
  "curvefit:3pl": {
    explain: "A three-parameter logistic dose-response curve with a fixed Hill slope of 1.",
    whenToUse: "Monotonic activation data when a constant-slope sigmoid is scientifically justified.",
    whenNotToUse: "Data with a variable or asymmetric slope, or data where both plateaus and slope must be estimated.",
    assumptions: ["X is positive dose or concentration data.", "The Hill slope is fixed at 1."],
    warnings: ["Fixing the slope can bias EC50 when the response transition is unusually steep or shallow."],
  },
  "curvefit:4pl": {
    explain: "The standard four-parameter logistic model estimates Bottom, Top, EC50, and Hill slope.",
    whenToUse: "Monotonic dose-response data with raw response values and enough coverage of the transition.",
    whenNotToUse: "Clearly asymmetric, non-monotonic, or too-sparse curves that cannot identify four parameters.",
    assumptions: ["X is positive dose or concentration data.", "The response is broadly monotonic."],
    warnings: ["Unobserved plateaus can make Bottom, Top, and potency weakly identifiable."],
  },
  "curvefit:5pl": {
    explain: "A five-parameter logistic model that adds an asymmetry parameter to the standard sigmoid.",
    whenToUse: "Monotonic curves with visible or scientifically expected asymmetry and enough dose levels.",
    whenNotToUse: "Sparse curves or data that do not support estimating the additional asymmetry parameter.",
    assumptions: ["The extra parameter is identifiable from the dose range.", "The response remains broadly monotonic."],
    warnings: ["5PL can overfit; compare uncertainty and residuals, not R-squared alone."],
  },
  "curvefit:dr_3pl_conc": {
    explain: "A constant-slope three-parameter logistic response written for concentration on X.",
    whenToUse: "Positive linear-concentration activation data when a fixed Hill slope is justified.",
    whenNotToUse: "Log-dose data, variable-slope responses, or responses with unknown plateaus that need to be estimated differently.",
    assumptions: ["X is positive concentration on its original linear scale.", "The Hill slope is fixed at 1."],
    warnings: ["Do not use this variant when the intended X scale is log concentration."],
  },
  "curvefit:dr_4pl_conc": {
    explain: "A four-parameter logistic activation model using concentration directly on X.",
    whenToUse: "Positive concentration data where the response rises or falls sigmoidally on the original X scale.",
    whenNotToUse: "Data intended for log-dose modeling or responses that are normalized with fixed plateaus.",
    assumptions: ["X is positive concentration on its original linear scale.", "The response is broadly monotonic."],
    warnings: ["The concentration and log-dose variants are different models; choose from the scientific measurement scale."],
  },
  "curvefit:dr_5pl_conc": {
    explain: "An asymmetric five-parameter logistic model using concentration directly on X.",
    whenToUse: "Positive concentration data with a monotonic but asymmetric response and strong dose coverage.",
    whenNotToUse: "Sparse data or data intended for log-dose modeling.",
    assumptions: ["X is positive concentration on its original linear scale.", "The asymmetry parameter is identifiable."],
    warnings: ["The extra parameter can be unstable when plateaus or transition points are poorly sampled."],
  },
  "curvefit:dr_norm_3pl": {
    explain: "A normalized 0-100% activation curve with a fixed Hill slope of 1 and a fitted EC50.",
    whenToUse: "Responses already normalized to a defensible 0-100% scale with positive log-dose X values.",
    whenNotToUse: "Raw response units with unknown plateaus, or data that are not meaningfully normalized.",
    assumptions: ["Bottom and Top are fixed at 0 and 100%.", "X is positive and modeled on a log-dose scale."],
    warnings: ["Normalization choices directly affect EC50 and should be documented."],
  },
  "curvefit:dr_norm_4pl": {
    explain: "A normalized variable-slope activation curve with Bottom and Top fixed at 0 and 100%.",
    whenToUse: "Responses already normalized to approximately 0-100% with positive dose data and a variable transition slope.",
    whenNotToUse: "Raw responses whose plateaus still need to be estimated, or data that are not normalized.",
    assumptions: ["Bottom = 0 and Top = 100% are scientifically defensible.", "X is positive and modeled on a log-dose scale."],
    warnings: ["Normalization and baseline choices affect the estimated EC50 and Hill slope."],
  },
  "curvefit:dr_norm_3pl_conc": {
    explain: "A normalized 0-100% activation curve with fixed slope using concentration directly on X.",
    whenToUse: "Normalized responses with positive linear-concentration values and a fixed Hill slope.",
    whenNotToUse: "Raw responses, log-dose data, or responses requiring fitted plateaus.",
    assumptions: ["Bottom = 0 and Top = 100%.", "X is positive concentration on its original scale."],
    warnings: ["Do not silently switch between linear concentration and log-dose interpretations."],
  },
  "curvefit:dr_norm_4pl_conc": {
    explain: "A normalized variable-slope activation curve using concentration directly on X.",
    whenToUse: "Normalized 0-100% responses with positive concentration values on the original scale.",
    whenNotToUse: "Raw responses, log-dose data, or responses whose plateaus are not known.",
    assumptions: ["Bottom = 0 and Top = 100%.", "X is positive concentration on its original scale."],
    warnings: ["The chosen X scale changes the model interpretation and potency estimate."],
  },
  "curvefit:ic50_3pl_log": {
    explain: "A constant-slope inhibition curve that estimates IC50 from log inhibitor data.",
    whenToUse: "Decreasing inhibition data with positive inhibitor values and a justified fixed slope.",
    whenNotToUse: "Activation data, non-normalized responses requiring different plateaus, or variable-slope transitions.",
    assumptions: ["X is modeled as log inhibitor concentration.", "The Hill slope is fixed at 1."],
    warnings: ["IC50 is meaningful only when X and Y have the intended inhibition semantics."],
  },
  "curvefit:ic50_4pl_log": {
    explain: "A four-parameter inhibition curve that estimates Bottom, Top, IC50, and Hill slope on log inhibitor data.",
    whenToUse: "Decreasing inhibition curves with raw response plateaus and positive inhibitor values.",
    whenNotToUse: "Activation curves or normalized data when the fixed 0-100% model is the intended biological scale.",
    assumptions: ["X is modeled as log inhibitor concentration.", "The response is broadly monotonic decreasing."],
    warnings: ["Do not interpret IC50 as Ki without the required binding assumptions and Cheng-Prusoff inputs."],
  },
  "curvefit:ic50_3pl_conc": {
    explain: "A constant-slope inhibition curve using concentration directly on X.",
    whenToUse: "Decreasing inhibition data measured on a positive linear concentration scale.",
    whenNotToUse: "Activation data, log-dose workflows, or responses with a variable slope.",
    assumptions: ["X is positive concentration on its original scale.", "The Hill slope is fixed at 1."],
    warnings: ["The concentration and log-inhibitor variants are not interchangeable."],
  },
  "curvefit:ic50_4pl_conc": {
    explain: "A variable-slope inhibition curve using concentration directly on X.",
    whenToUse: "Decreasing inhibition data with positive linear concentration values and raw response plateaus.",
    whenNotToUse: "Activation data or data intended for log inhibitor modeling.",
    assumptions: ["X is positive concentration on its original scale.", "The response is broadly monotonic decreasing."],
    warnings: ["IC50 outside the observed concentration range is extrapolation and should be flagged."],
  },
  "curvefit:ic50_norm_3pl": {
    explain: "A normalized 100-to-0% inhibition curve with a fixed Hill slope.",
    whenToUse: "Responses already normalized to a defensible 0-100% inhibition scale.",
    whenNotToUse: "Raw responses with unknown plateaus or activation data.",
    assumptions: ["Top = 100% and Bottom = 0% inhibition.", "X is modeled on a log inhibitor scale."],
    warnings: ["Normalization must represent the biological inhibition range."],
  },
  "curvefit:ic50_norm_4pl": {
    explain: "A normalized variable-slope inhibition curve with an absolute IC50.",
    whenToUse: "Decreasing responses already normalized to 100-to-0% with positive inhibitor data.",
    whenNotToUse: "Raw response data requiring fitted plateaus or activation data.",
    assumptions: ["Top = 100% and Bottom = 0% inhibition.", "X is modeled on a log inhibitor scale."],
    warnings: ["Normalization choices affect the absolute IC50 and any downstream Ki calculation."],
  },
  "curvefit:biphasic_dr": {
    explain: "A mixture of two logistic dose-response components with separate transition points.",
    whenToUse: "Strongly non-monotonic or clearly two-phase responses with well-separated transitions.",
    whenNotToUse: "A single apparent turning point, sparse data, or ordinary monotonic curves.",
    assumptions: ["Two biological response components are plausible.", "Both transitions have enough data support."],
    warnings: ["This model has many parameters and is sensitive to starting values and identifiability."],
  },
  "curvefit:biphasic_dr_conc": {
    explain: "A two-component biphasic dose-response model using concentration directly on X.",
    whenToUse: "Two-phase responses with positive concentration values on the original scale.",
    whenNotToUse: "Sparse data or curves that are adequately described by one logistic component.",
    assumptions: ["Two response components are scientifically plausible.", "Both transitions are sampled."],
    warnings: ["Use concentration-scale interpretation consistently when reporting both transition values."],
  },
  "curvefit:bell_dr": {
    explain: "A rise-then-fall dose-response model with separate upward and downward transitions.",
    whenToUse: "A reproducible bell-shaped response across a sufficiently broad dose range.",
    whenNotToUse: "Monotonic data or a single noisy turning point.",
    assumptions: ["Both the rising and falling limbs are observed.", "The bell shape is scientifically plausible."],
    warnings: ["Peak location and both transitions are unstable if either limb is poorly sampled."],
  },
  "curvefit:bell_dr_conc": {
    explain: "A bell-shaped rise-then-fall model using concentration directly on X.",
    whenToUse: "Bell-shaped responses with positive concentration values on the original scale.",
    whenNotToUse: "Monotonic curves or sparse data that cannot support both limbs.",
    assumptions: ["Both rising and falling limbs are observed.", "X is positive concentration."],
    warnings: ["Do not choose this model solely because one point reverses direction."],
  },
  "curvefit:hormesis_bc": {
    explain: "The Brain-Cousens hormesis model allows low-dose stimulation above a later inhibitory response.",
    whenToUse: "A reproducible low-dose stimulatory upturn followed by inhibition is biologically expected.",
    whenNotToUse: "Monotonic curves, sparse low-dose coverage, or unexplained noise.",
    assumptions: ["Low-dose stimulation is scientifically plausible.", "Positive log-dose values cover the upturn."],
    warnings: ["The hormesis parameter can be weakly identified and highly sensitive to low-dose points."],
  },
  "curvefit:probit_dr": {
    explain: "A cumulative-normal dose-response curve, common in toxicology and threshold-response work.",
    whenToUse: "Responses plausibly following a cumulative normal transition on the chosen concentration scale.",
    whenNotToUse: "Data requiring a log-logistic interpretation or non-monotonic response behavior.",
    assumptions: ["The response is monotonic and bounded by Bottom and Top.", "Sigma is positive and identifiable."],
    warnings: ["Model choice should follow the scientific response mechanism, not fit score alone."],
  },
  "curvefit:weibull_sigmoid": {
    explain: "An asymmetric Weibull cumulative-response curve with scale and shape parameters.",
    whenToUse: "Monotonic nonnegative dose-response data where a Weibull transition is scientifically appropriate.",
    whenNotToUse: "Negative or non-monotonic X data, or when a log-logistic potency definition is required.",
    assumptions: ["X is nonnegative on its original scale.", "The response is monotonic and bounded."],
    warnings: ["The scale parameter is not automatically equivalent to EC50 without checking the parameterization."],
  },
  "curvefit:richards_dr": {
    explain: "A generalized logistic curve with an additional shape parameter for asymmetry.",
    whenToUse: "Monotonic asymmetric responses with enough data to identify the generalized shape.",
    whenNotToUse: "Sparse curves or data adequately described by a standard 4PL/5PL.",
    assumptions: ["The extra shape parameter is identifiable.", "The response is monotonic."],
    warnings: ["Generalized logistic parameters can be strongly correlated and difficult to interpret."],
  },
  "curvefit:lowess": {
    explain: "A flexible local smoother that describes the observed shape without imposing a biological equation.",
    whenToUse: "Exploration, outlier inspection, and checking whether a parametric curve is plausible.",
    whenNotToUse: "Estimating EC50/IC50, comparing mechanistic parameters, or extrapolating beyond the observed range.",
    assumptions: ["The smoothing level is treated as exploratory."],
    warnings: ["LOWESS does not provide a mechanistic potency parameter."],
  },
  "curvefit:spline": {
    explain: "A cubic smoothing spline that follows the observed shape with a tunable amount of smoothness.",
    whenToUse: "Exploratory shape checking and diagnosing departures from a simple parametric model.",
    whenNotToUse: "Mechanistic interpretation, potency estimation, or unstable boundary extrapolation.",
    assumptions: ["The smoothing level is exploratory rather than a biological parameter."],
    warnings: ["Spline behavior near boundaries can be unstable and depends on smoothing."],
  },
  "curvefit:custom": {
    explain: "A user-defined equation Y = f(X, parameters) fit by least squares.",
    whenToUse: "A specific equation is scientifically justified and its parameters and starting values are understood.",
    whenNotToUse: "When a validated built-in model already represents the study design or when parameter identifiability is unknown.",
    assumptions: ["The equation is valid for the measured X range.", "Starting values and constraints are appropriate."],
    warnings: ["Custom fits are not automatically validated as biologically meaningful."],
  },
};

/** Curve-fit-derived methods reuse the curvefit variant guidance — their variant ids are the
 *  same curve models, but their lookup keys use the derived method name (globalfit:4pl, …). */
const CURVE_DERIVED_METHODS = new Set(["globalfit", "comparefits", "interpolate"]);
/** Resolve variant-specific guidance for a `(method, variant)`, falling back to the shared
 *  `curvefit:` entry for the derived curve methods. Use this everywhere a variant description is
 *  needed (the About panel, the type picker, the completeness test) so all three stay consistent. */
export function variantGuidance(method: string, variant: string): VariantGuidance | undefined {
  return VARIANT_GUIDANCE[`${method}:${variant}`] ?? (CURVE_DERIVED_METHODS.has(method) ? VARIANT_GUIDANCE[`curvefit:${variant}`] : undefined);
}

Object.assign(VARIANT_GUIDANCE, {
  "bayesfactor:unpaired": {
    explain: "The JZS Bayes factor for two independent groups, built on the pooled-variance t and the effective sample size n₁n₂/(n₁+n₂).",
    whenToUse: "Two independent groups where you want to quantify evidence either way — including evidence that the groups do not differ.",
    whenNotToUse: "Matched or repeated measurements — use the paired variant, which has different degrees of freedom.",
    assumptions: ["The groups are independent and approximately normal.", "The Cauchy prior scale represents a defensible expectation about effect size."],
    warnings: ["Uses the pooled-variance t, so markedly unequal variances undermine it in the same way they undermine Student's t test."],
    alternatives: ["Welch's t test when variances differ", "Equivalence testing for a bounded no-difference claim"],
  },
  "bayesfactor:paired": {
    explain: "The Bayes factor computed on the within-pair differences — identical to running the one-sample factor on those differences.",
    whenToUse: "Matched pairs or before/after measurements, especially when you want to argue the change was negligible.",
    whenNotToUse: "Independent groups — pairing unmatched values invents precision.",
    assumptions: ["Rows are genuinely matched pairs.", "The paired differences are approximately normal."],
    warnings: ["With very few pairs the Bayes factor is dominated by the prior; a factor near 1 reflects that, not an absence of effect."],
    alternatives: ["Paired t test", "Paired equivalence testing"],
  },
  "bayesfactor:one-sample": {
    explain: "The Bayes factor for one sample against a reference value, with a Cauchy prior on the standardized difference from that reference.",
    whenToUse: "Testing one sample against a known or nominal value when evidence for 'it matches' would be a meaningful result.",
    whenNotToUse: "Comparing two measured groups — use the unpaired or paired variant.",
    assumptions: ["The reference value is exact, not itself estimated.", "The sample is approximately normal."],
    warnings: ["Treating an estimated reference as exact overstates the evidence in either direction."],
    alternatives: ["One-sample t test", "One-sample equivalence testing"],
  },
  "permutation:unpaired": {
    explain: "Pools the two groups and repeatedly re-deals the group labels. If the groups really come from the same distribution, the observed difference should be unremarkable among those re-dealings.",
    whenToUse: "Two independent groups, especially with small samples or a distribution a t test would misjudge.",
    whenNotToUse: "Matched or repeated measurements — permuting labels there destroys the pairing that carries the information.",
    assumptions: ["The two samples are exchangeable under the null (same distribution).", "Observations are independent."],
    warnings: ["Permuting labels tests whether the whole distributions differ, not the means alone — a pure difference in spread can also produce a small p."],
    alternatives: ["Welch's t test when normality is reasonable", "Mann-Whitney for a rank-based comparison"],
  },
  "permutation:paired": {
    explain: "Flips the sign of each within-pair difference at random. Under the null the differences are symmetric about zero, so a plus or a minus is equally likely for every pair.",
    whenToUse: "Matched pairs or before/after measurements, particularly with few pairs where a t test's normality assumption is untestable.",
    whenNotToUse: "Independent groups — use the unpaired variant, which permutes labels instead.",
    assumptions: ["Rows are genuinely matched pairs.", "Under the null the paired differences are symmetric about zero."],
    warnings: ["With n pairs there are only 2ⁿ sign patterns, so very small samples have a floor on the p-value they can ever reach — with 8 pairs the smallest two-sided p is 2/256 = 1/128 (one-sided, 1/256)."],
    alternatives: ["Paired t test", "Wilcoxon signed-rank"],
  },
  "permutation:one-sample": {
    explain: "Flips the sign of each value's deviation from a reference, building the null that the sample is centred on that reference.",
    whenToUse: "Testing one sample against a known value without assuming normality.",
    whenNotToUse: "Comparing two measured groups — use the unpaired or paired variant.",
    assumptions: ["Under the null, deviations from the reference are symmetric about zero.", "The reference value is exact, not itself estimated."],
    warnings: ["Symmetry is a real assumption — a skewed distribution centred on the reference can still yield a small p."],
    alternatives: ["One-sample t test", "One-sample Wilcoxon"],
  },
  "permutation:correlation": {
    explain: "Shuffles Y against X so every pairing is equally likely, which is exactly the null that the two variables are unrelated. The observed correlation is then read against that distribution.",
    whenToUse: "Testing a correlation with small n, non-normal marginals, or influential points that would distort the parametric p-value.",
    whenNotToUse: "When the observations are ordered in a way that matters — a time series is not exchangeable, so shuffling it is not a valid null.",
    assumptions: ["Rows are genuinely paired observations.", "Under the null, any pairing of Y with X is equally likely."],
    warnings: ["Tests association, not linearity — and it inherits Pearson r's sensitivity to outliers, since r is still the statistic being permuted."],
    alternatives: ["Pearson or Spearman correlation with their parametric p-values"],
  },
  "equivalence:unpaired": {
    explain: "Two one-sided tests on the difference between two independent groups, using Welch's standard error. Concludes equivalence only when the whole 90% CI sits inside your bound.",
    whenToUse: "Two independent groups where the claim you want to support is that they do not differ meaningfully.",
    whenNotToUse: "Matched or repeated measurements (use paired), or when you cannot justify a bound.",
    assumptions: ["The two groups are independent.", "The bound was chosen before the analysis, on scientific grounds."],
    warnings: ["Failing both one-sided tests is inconclusive — it is not evidence that the groups are the same."],
    alternatives: ["Paired equivalence when the observations are matched", "A plain t test when the question really is whether they differ"],
  },
  "equivalence:paired": {
    explain: "TOST on the within-pair differences — the paired analogue, which removes between-subject variation and so usually needs a smaller sample to demonstrate equivalence.",
    whenToUse: "Matched pairs or repeated measurements on the same subjects (before/after, two methods on one sample).",
    whenNotToUse: "Independent groups — pairing values that are not genuinely matched invents precision that is not there.",
    assumptions: ["Rows are genuinely matched pairs.", "The paired differences are approximately normal."],
    warnings: ["Pairing must be real row-level alignment, not a visual side-by-side layout."],
    alternatives: ["Unpaired equivalence for independent groups"],
  },
  "equivalence:one-sample": {
    explain: "TOST against a reference value: tests whether the sample mean is within ±Δ of a target, rather than merely failing to differ from it.",
    whenToUse: "Checking a measurement against a specification, a nominal value, or a published constant.",
    whenNotToUse: "Comparing two measured groups — use the unpaired or paired variant.",
    assumptions: ["The reference value is exact, not itself estimated from data.", "The sample is approximately normal."],
    warnings: ["Treating an estimated reference as exact understates the uncertainty."],
    alternatives: ["Unpaired equivalence when the comparator is a measured group"],
  },
  "ttest:unpaired": {
    explain: "Student's independent-samples t test compares two means using a pooled variance estimate.",
    definition: "t = (x̄₁ − x̄₂) / SE_pooled",
    whenToUse: "Two independent groups when equal population variances are scientifically and diagnostically plausible.",
    whenNotToUse: "Unequal variances, paired observations, ordinal outcomes, or severe outliers.",
    assumptions: ["The two groups are independent.", "The group variances are sufficiently similar for pooling."],
    warnings: ["Welch's t is safer when variance equality is uncertain."],
    alternatives: ["Welch's t", "Mann–Whitney for rank-based comparison"],
  },
  "ttest:welch": {
    explain: "Welch's independent-samples t test compares two means without pooling the variances.",
    definition: "t = (x̄₁ − x̄₂) / √(s₁²/n₁ + s₂²/n₂)",
    whenToUse: "Two independent numeric groups when sample sizes or variances may differ.",
    whenNotToUse: "Paired observations or a clearly non-numeric/rank-based outcome.",
    assumptions: ["The two groups are independent.", "The outcome is reasonably well behaved for a mean comparison."],
    warnings: ["Independence matters more than a normality p-value; inspect design and outliers."],
    alternatives: ["Student's t when equal variances are justified", "Mann–Whitney for rank-based inference"],
  },
  "ttest:paired": {
    explain: "The paired t test evaluates the mean within-pair difference.",
    definition: "t = d̄ / (s_d/√n)",
    whenToUse: "Before/after or matched observations with an explicit one-to-one pairing.",
    whenNotToUse: "Two unrelated groups, shuffled rows, or repeated observations without a subject/pair identifier.",
    assumptions: ["Each value has exactly one valid partner.", "The distribution of within-pair differences is suitable for a mean comparison."],
    warnings: ["Pairing is a data relationship, not merely two columns with the same row count."],
    alternatives: ["Wilcoxon paired rank test", "Independent Welch's t when pairing is not defensible"],
  },
  "ttest:mann-whitney": {
    explain: "Mann–Whitney compares the rank distributions of two independent groups.",
    definition: "U = rank-sum statistic for two independent samples",
    whenToUse: "Independent groups with ordinal outcomes, strong skew, or outliers where a rank comparison answers the question.",
    whenNotToUse: "Paired observations or when a mean difference is the required estimand.",
    assumptions: ["Observations are independent.", "Interpretation as a median shift requires similarly shaped distributions."],
    warnings: ["It is not automatically a test of medians when shapes differ."],
    alternatives: ["Welch's t", "Permutation or robust location comparison"],
  },
  "ttest:wilcoxon": {
    explain: "Wilcoxon signed-rank compares paired within-subject differences using their ranks.",
    definition: "W = signed-rank sum of non-zero paired differences",
    whenToUse: "Explicitly paired before/after or matched data with a symmetric difference distribution.",
    whenNotToUse: "Independent groups or highly asymmetric differences without a defensible rank interpretation.",
    assumptions: ["Pairs are valid and independent of other pairs.", "Non-zero differences are approximately symmetric."],
    warnings: ["Zero differences are omitted; report the usable paired n."],
    alternatives: ["Paired t", "A sign test when symmetry is not plausible"],
  },
  "anova:anova": {
    explain: "One-way ANOVA compares group means with Tukey-adjusted pairwise follow-ups.",
    definition: "F = MS_between / MS_within",
    whenToUse: "Three or more independent groups with broadly comparable variances and a mean-based question.",
    whenNotToUse: "Paired/repeated data, strong variance imbalance, or a rank-based scientific question.",
    assumptions: ["Independent experimental units.", "Residuals are reasonably compatible with the model.", "Group variances are not severely different."],
    warnings: ["Tukey comparisons follow a significant or scientifically motivated omnibus analysis; multiplicity is controlled."],
    alternatives: ["Welch ANOVA + Games–Howell", "Kruskal–Wallis + Dunn's"],
  },
  "anova:welch": {
    explain: "Welch's ANOVA compares group means without assuming equal variances.",
    definition: "Welch F = variance-weighted between-group signal / adjusted within-group error",
    whenToUse: "Three or more independent groups with unequal variances or unbalanced sample sizes.",
    whenNotToUse: "Paired/repeated observations or an ordinal/rank-based question.",
    assumptions: ["Groups are independent.", "The outcome supports a mean comparison."],
    warnings: ["Use the matching unequal-variance post-hoc method rather than ordinary Tukey."],
    alternatives: ["One-way ANOVA when variance equality is justified", "Kruskal–Wallis for rank-based inference"],
  },
  "anova:kruskal": {
    explain: "Kruskal–Wallis compares independent groups using pooled outcome ranks.",
    definition: "H = rank-based between-group statistic",
    whenToUse: "Three or more independent groups when rank ordering is more defensible than a mean/normal model.",
    whenNotToUse: "Paired data or when group distributions differ in shape and a location-shift interpretation is required.",
    assumptions: ["Groups are independent.", "The measurement has a meaningful ordering."],
    warnings: ["A significant result does not identify which groups differ; use an appropriate corrected follow-up."],
    alternatives: ["Welch ANOVA", "One-way ANOVA"],
  },
  "correlation:pearson": {
    explain: "Pearson correlation measures linear association on the original numeric scale.",
    definition: "r = cov(X,Y)/(s_X s_Y)",
    whenToUse: "Paired numeric measurements with an approximately linear association and no dominating leverage points.",
    whenNotToUse: "Agreement, prediction, curved association, or severe outlier influence.",
    assumptions: ["Rows are correctly paired.", "The linear association is scientifically meaningful."],
    warnings: ["Correlation does not test interchangeability or causation."],
    alternatives: ["Spearman for monotonic rank association", "Regression for prediction"],
  },
  "correlation:spearman": {
    explain: "Spearman correlation measures monotonic association after replacing values by ranks.",
    definition: "ρ = correlation(rank(X), rank(Y))",
    whenToUse: "Monotonic relationships with ordinal data, skew, or unequal scales.",
    whenNotToUse: "Agreement or non-monotonic relationships that ranks cannot summarize.",
    assumptions: ["Pairs are correctly aligned.", "The question concerns monotonic association."],
    warnings: ["Ties and many repeated values reduce the effective information."],
    alternatives: ["Pearson for a linear association", "Regression or curve fitting for a directional model"],
  },
});

// Structured guidance for the remaining non-curve variants, so every type the picker offers has
// a variant-specific description (not just method-level fallback text).
Object.assign(VARIANT_GUIDANCE, {
  "ttest:one-sample": {
    explain: "A one-sample t test compares the mean of a single group to a fixed reference value.",
    definition: "t = (x̄ − μ₀) / (s/√n)",
    whenToUse: "One group of continuous measurements tested against a known target, baseline, or theoretical value.",
    whenNotToUse: "Comparing two groups (use a two-sample test), or a small non-normal sample (use one-sample Wilcoxon).",
    assumptions: ["The values are an independent sample from a roughly normal population.", "The reference value μ₀ is meaningful and pre-specified."],
    warnings: ["μ₀ must be chosen independently of the data, not read off it."],
    alternatives: ["One-sample Wilcoxon for non-normal data", "Two-sample t test to compare two groups"],
  },
  "ttest:wilcoxon-1samp": {
    explain: "The one-sample Wilcoxon signed-rank test compares a group's median to a reference value without assuming normality.",
    definition: "Signed-rank statistic of (xᵢ − μ₀)",
    whenToUse: "One group tested against a reference value when the data are ordinal or not normal.",
    whenNotToUse: "Two-group comparisons, or when a mean (not median) difference is required.",
    assumptions: ["The differences from the reference are roughly symmetric.", "Observations are independent."],
    warnings: ["Low power at very small n; many ties weaken the test."],
    alternatives: ["One-sample t test when the data are roughly normal"],
  },
  "ttest:ks": {
    explain: "The two-sample Kolmogorov-Smirnov test compares the entire shape of two distributions, not just their means.",
    definition: "D = maxₓ |F₁(x) − F₂(x)| (largest gap between the empirical CDFs)",
    whenToUse: "Detecting any difference — location, spread, or shape — between two independent samples.",
    whenNotToUse: "When only a difference in centre matters (a t test or Mann-Whitney is more powerful for that).",
    assumptions: ["Two independent samples of a continuous variable."],
    warnings: ["A significant result does not say why the distributions differ.", "Reduced power with heavy ties (discrete data)."],
    alternatives: ["Mann-Whitney for a location shift", "Welch's t test for a mean difference"],
  },
  "ttest:ratio-paired": {
    explain: "A ratio paired t test works on the log scale, so it tests multiplicative (fold-change) rather than additive differences.",
    definition: "Paired t test on ln(after) − ln(before)",
    whenToUse: "Paired data where the effect is proportional (fold-changes, concentrations spanning orders of magnitude).",
    whenNotToUse: "Additive differences, values that are zero or negative, or unpaired groups.",
    assumptions: ["Rows are matched pairs.", "The log-ratios are roughly normal; all values are positive."],
    warnings: ["Undefined for zero/negative values; report the result as a geometric-mean ratio."],
    alternatives: ["Ordinary paired t test for additive differences", "Wilcoxon for non-normal paired data"],
  },
  "anova:brown-forsythe": {
    explain: "The Brown-Forsythe test is a one-way ANOVA that does not assume equal group variances.",
    definition: "F* with a variance-weighted denominator (unequal-variance ANOVA)",
    whenToUse: "Comparing three or more group means when the SDs differ markedly.",
    whenNotToUse: "Equal-variance data (standard ANOVA is more powerful) or matched/repeated designs.",
    assumptions: ["Groups are independent.", "Residuals are roughly normal within each group."],
    warnings: ["Welch's ANOVA is usually preferred for unequal variances; pair with a Games-Howell post-hoc."],
    alternatives: ["Welch's ANOVA", "Kruskal-Wallis for non-normal data"],
  },
  "rmanova:rmanova": {
    explain: "Repeated-measures ANOVA compares three or more conditions measured on the same subjects, removing between-subject variability.",
    definition: "Within-subjects F with a subject blocking factor",
    whenToUse: "Matched/longitudinal designs where every subject is measured under every condition.",
    whenNotToUse: "Independent groups (use one-way ANOVA), or subjects missing conditions (use a mixed model).",
    assumptions: ["Each subject is measured in every condition.", "Sphericity — equal variances of the condition differences (Greenhouse-Geisser corrects departures)."],
    warnings: ["A subject with any missing condition is dropped entirely; consider a mixed-effects model."],
    alternatives: ["Friedman for non-normal data", "Mixed-effects model for unbalanced/longitudinal data"],
  },
  "rmanova:friedman": {
    explain: "The Friedman test is the nonparametric repeated-measures comparison — rank-based across matched conditions.",
    definition: "Rank-based statistic across conditions within each subject block",
    whenToUse: "Matched conditions with ordinal or non-normal responses.",
    whenNotToUse: "Independent groups, or when a mean (not rank) difference is required.",
    assumptions: ["Each subject is measured in every condition.", "Responses are at least ordinal."],
    warnings: ["A significant result needs a rank-based post-hoc (e.g. Dunn's) to locate the differences."],
    alternatives: ["Repeated-measures ANOVA when the data are roughly normal"],
  },
  "corrmatrix:pearson": {
    explain: "A Pearson correlation matrix reports the linear association between every pair of numeric variables.",
    definition: "rᵢⱼ = cov(Xᵢ, Xⱼ) / (sᵢ sⱼ) for each pair",
    whenToUse: "Exploring linear relationships and redundancy among several continuous variables.",
    whenNotToUse: "Monotonic-but-non-linear or ordinal data (use a Spearman matrix).",
    assumptions: ["Pairwise-linear relationships; roughly continuous variables."],
    warnings: ["Pairwise correlations are exploratory — read with multiplicity in mind; sensitive to outliers."],
    alternatives: ["Spearman matrix for rank association", "PCA to summarize the joint structure"],
  },
  "corrmatrix:spearman": {
    explain: "A Spearman correlation matrix uses ranks, capturing monotonic association and resisting outliers.",
    definition: "ρᵢⱼ = correlation(rank(Xᵢ), rank(Xⱼ))",
    whenToUse: "Ordinal data or monotonic non-linear relationships across several variables.",
    whenNotToUse: "When a linear coefficient is specifically required.",
    assumptions: ["Monotonic pairwise relationships."],
    warnings: ["Many ties reduce the effective information."],
    alternatives: ["Pearson matrix for linear association"],
  },
  "pca:standardize": {
    explain: "Standardized PCA works from the correlation matrix — every variable is scaled to unit variance so each contributes comparably.",
    definition: "PCA of the correlation matrix (z-scored variables)",
    whenToUse: "Variables measured on different units or very different scales (the usual default).",
    whenNotToUse: "When the absolute variance differences between variables are themselves the signal.",
    assumptions: ["Variables are on an intentional, comparable-after-scaling footing."],
    warnings: ["Standardizing discards information about which variables are intrinsically more variable."],
    alternatives: ["Covariance PCA when the scales are already comparable"],
  },
  "pca:center": {
    explain: "Covariance PCA (centred only) works from the covariance matrix, so high-variance variables influence the components more.",
    definition: "PCA of the covariance matrix (mean-centred, not scaled)",
    whenToUse: "Variables on the same units/scale where their real variance differences matter.",
    whenNotToUse: "Mixed units or very different scales (one variable will dominate).",
    assumptions: ["Variables share comparable units and scale."],
    warnings: ["A single high-variance column can dominate the first components."],
    alternatives: ["Standardized (correlation) PCA for mixed scales"],
  },
  "regression:ols": {
    explain: "Ordinary least-squares fits the straight line that minimizes the squared vertical residuals, estimating a slope and intercept.",
    definition: "Y = β₀ + β₁X + ε, minimizing Σ(residual²)",
    whenToUse: "A roughly linear relationship where you want the slope, intercept, and their confidence intervals.",
    whenNotToUse: "Curved relationships (use nonlinear fitting), or when both variables carry error (use Deming).",
    assumptions: ["Linear relationship.", "Residuals are independent with roughly constant spread (homoscedastic)."],
    warnings: ["Sensitive to influential outliers; check a residual plot for curvature."],
    alternatives: ["Nonlinear curve fitting for curved data", "Deming/Passing-Bablok when X also has error"],
  },
  "regression:origin": {
    explain: "Forces the regression line through the origin (0, 0), estimating only a slope.",
    definition: "Y = β₁X (intercept fixed at 0)",
    whenToUse: "When the response must be exactly zero at X = 0 by physical or design necessity.",
    whenNotToUse: "When a non-zero intercept is plausible — forcing the origin then biases the slope.",
    assumptions: ["A zero intercept is justified independently of the data."],
    warnings: ["R² is not comparable to an ordinary regression; a wrong zero-intercept assumption distorts the slope."],
    alternatives: ["Ordinary least squares when the intercept is unknown"],
  },
  "regression:point": {
    explain: "Forces the line through a specified fixed point (x₀, y₀).",
    definition: "Y − y₀ = β₁(X − x₀)",
    whenToUse: "A known calibration anchor or control point the line must pass through.",
    whenNotToUse: "When no anchor point is justified by the science.",
    assumptions: ["The fixed point is known and correct."],
    warnings: ["Constrains the fit; an incorrect anchor biases the slope."],
    alternatives: ["Ordinary least squares for an unconstrained line"],
  },
  "contingency:independent": {
    explain: "Tests whether two categorical variables are associated in an r×c table of counts (chi-square, Fisher's exact for small counts, plus risk/odds ratios and a trend test).",
    definition: "χ² = Σ (observed − expected)² / expected",
    whenToUse: "Counts cross-classified by two independent categorical factors from separate subjects.",
    whenNotToUse: "Paired/matched categorical data on the same subjects (use McNemar).",
    assumptions: ["Observations are independent (each subject counted once).", "Categories are mutually exclusive."],
    warnings: ["Small expected counts (<5) fall back to Fisher's exact automatically."],
    alternatives: ["McNemar for a paired 2×2", "Goodness-of-fit for one variable versus expected proportions"],
  },
  "contingency:paired": {
    explain: "McNemar's test compares two paired binary measurements on the same subjects (e.g. before vs after), using only the discordant pairs.",
    definition: "χ² = (b − c)² / (b + c) from the off-diagonal counts of a 2×2",
    whenToUse: "A paired 2×2 — the same subjects classified twice (before/after, or two tests per subject).",
    whenNotToUse: "Independent groups (use the ordinary independence test).",
    assumptions: ["Each row is a matched pair.", "Both measurements are binary."],
    warnings: ["Only the discordant pairs carry information — you need enough of them; small counts use an exact binomial version."],
    alternatives: ["Independence test (chi-square/Fisher) for unpaired groups"],
  },
  "mixedmodel:reml": {
    explain: "A linear mixed-effects model fitted by REML — the default: unbiased random-effect variances (subject/batch/site) alongside the fixed effects and the ICC.",
    definition: "y = Xβ + Zu + ε, u ~ N(0, σ²_group); restricted maximum likelihood",
    whenToUse: "Clustered or repeated data where observations within a group (subject/batch/site) are correlated.",
    whenNotToUse: "Comparing models with different fixed effects by likelihood (use ML), or independent data (use ANOVA/regression).",
    assumptions: ["The random-effect grouping is scientifically meaningful.", "Residuals and random effects are roughly normal."],
    warnings: ["REML likelihoods are not comparable across different fixed-effect structures."],
    alternatives: ["ML for fixed-effect model comparison", "Repeated-measures ANOVA for a balanced complete design"],
  },
  "mixedmodel:ml": {
    explain: "A mixed-effects model fitted by maximum likelihood — use it only to compare models that differ in their fixed effects.",
    definition: "The same model fitted by (unrestricted) maximum likelihood",
    whenToUse: "Formally comparing nested models with different fixed-effect terms by likelihood ratio.",
    whenNotToUse: "Reporting the final variance components (ML biases them downward — use REML).",
    assumptions: ["As for the REML fit."],
    warnings: ["ML variance-component estimates are biased low; report the REML fit for the final model."],
    alternatives: ["REML for the reported model"],
  },
  "auc:zero": {
    explain: "Computes the area under the curve using Y = 0 as the baseline — the usual choice.",
    definition: "AUC = ∫ Y dX with baseline 0 (trapezoidal)",
    whenToUse: "When zero is the meaningful baseline for the response.",
    whenNotToUse: "When the response has a non-zero floor that should be excluded first.",
    assumptions: ["Zero is a meaningful reference for the measurement."],
    warnings: ["Regions below zero subtract from the total unless handled separately."],
    alternatives: ["Baseline at the minimum or the mean Y"],
  },
  "auc:min": {
    explain: "Computes the area above a baseline set at the minimum observed Y.",
    definition: "AUC = ∫ (Y − min Y) dX",
    whenToUse: "When a constant floor should be subtracted before integrating.",
    whenNotToUse: "When zero is the true baseline.",
    assumptions: ["The minimum is a stable, meaningful baseline."],
    warnings: ["Sensitive to a single low point, which sets the whole baseline."],
    alternatives: ["Baseline at 0 or at the mean"],
  },
  "auc:mean": {
    explain: "Computes the area relative to a baseline at the mean Y.",
    definition: "AUC = ∫ (Y − mean Y) dX",
    whenToUse: "When deviations above and below the average are of interest.",
    whenNotToUse: "When an absolute area from zero is required.",
    assumptions: ["The mean is a meaningful reference."],
    warnings: ["Uncommon; positive and negative areas cancel around the mean."],
    alternatives: ["Baseline at 0 or the minimum"],
  },
  "auc:custom": {
    explain: "Computes the area above a baseline you set to a specific Y value.",
    definition: "AUC = ∫ (Y − baseline) dX, baseline = a chosen constant",
    whenToUse: "When the meaningful floor is a known value (e.g. an assay blank or a threshold) rather than 0, the minimum, or the mean.",
    whenNotToUse: "When the baseline is better estimated from the data (use minimum or mean) or is truly zero.",
    assumptions: ["The chosen baseline is the correct reference for integration."],
    warnings: ["Regions below the baseline subtract from the total; a mis-set baseline biases every peak area."],
    alternatives: ["Baseline at 0, the minimum, or the mean Y"],
  },
  "curvetransform:smooth": {
    explain: "Savitzky-Golay smoothing fits a local polynomial in a sliding window, cutting noise while preserving peak height and width better than a moving average.",
    definition: "Local least-squares polynomial in a moving window",
    whenToUse: "Noisy curves where the underlying shape (peaks, slopes) should be preserved.",
    whenNotToUse: "When exact original values are needed, or the noise itself is the signal.",
    assumptions: ["The feature of interest is broader than the noise."],
    warnings: ["Too wide a window or too high an order distorts sharp features."],
    alternatives: ["Fit a parametric model instead of smoothing"],
  },
  "curvetransform:differentiate": {
    explain: "Computes the first derivative dY/dX, highlighting slopes and locating inflection points.",
    definition: "dY/dX (finite differences)",
    whenToUse: "Finding rates of change, peak positions of the original signal, or transition midpoints.",
    whenNotToUse: "Noisy data without prior smoothing (differentiation amplifies noise).",
    assumptions: ["X is ordered and reasonably evenly spaced."],
    warnings: ["Amplifies noise — smooth first."],
    alternatives: ["Smooth, or fit a model and differentiate it analytically"],
  },
  "curvetransform:differentiate2": {
    explain: "Computes the second derivative d²Y/dX², highlighting curvature and resolving overlapping features.",
    definition: "d²Y/dX² (finite differences)",
    whenToUse: "Detecting curvature, shoulders, or overlapping peaks.",
    whenNotToUse: "Noisy data (very sensitive), or when only slope matters.",
    assumptions: ["X is ordered and evenly spaced."],
    warnings: ["Extremely noise-sensitive; smooth before differentiating twice."],
    alternatives: ["First derivative, or model fitting"],
  },
  "curvetransform:integrate": {
    explain: "Computes the cumulative integral ∫Y·dX — the running area under the curve.",
    definition: "Cumulative trapezoidal ∫ Y dX",
    whenToUse: "Converting a rate into an accumulated quantity (e.g. flux → total).",
    whenNotToUse: "When the instantaneous value, not the accumulation, is of interest.",
    assumptions: ["X is ordered.", "The baseline is meaningful."],
    warnings: ["Any constant baseline offset accumulates across the range."],
    alternatives: ["Area-under-curve analysis for a single summary number"],
  },
  "curvetransform:lineweaver_burk": {
    explain: "The double-reciprocal view of Michaelis-Menten kinetics: plotting 1/v against 1/[S] straightens the hyperbola, so the slope is KM/Vmax and the Y-intercept is 1/Vmax.",
    definition: "1/v = (KM/Vmax)·(1/[S]) + 1/Vmax",
    whenToUse: "Eyeballing linearity, spotting a bad point, or presenting kinetics in the classical form. Inhibition mechanisms are traditionally read from where the lines intersect.",
    whenNotToUse: "Estimating Vmax or KM to report — fit the nonlinear Michaelis-Menten model for that.",
    assumptions: ["X is substrate concentration [S] and Y is an initial velocity v.", "Points with [S] = 0 or v = 0 are undefined here and are dropped."],
    warnings: [
      "This is a diagnostic view, not an estimator. Taking reciprocals compresses the high-substrate points and hugely inflates the error on the low-velocity ones, so least squares on these axes is badly biased — Lineweaver-Burk is the worst offender of the three.",
      "The Vmax and KM shown are what the fitted line implies; report the nonlinear fit's values instead.",
    ],
    alternatives: ["Nonlinear Michaelis-Menten fit (the estimate to report)", "Eadie-Hofstee or Hanes-Woolf, which distort less"],
  },
  "curvetransform:eadie_hofstee": {
    explain: "Plots v against v/[S], giving a straight line whose slope is −KM and whose Y-intercept is Vmax. It spreads the points more evenly than the double-reciprocal plot.",
    definition: "v = −KM·(v/[S]) + Vmax",
    whenToUse: "A linearized view that shows departures from Michaelis-Menten behaviour clearly, since deviations are not compressed into one corner.",
    whenNotToUse: "Estimating the constants to report — fit the nonlinear model.",
    assumptions: ["X is substrate concentration [S] and Y is an initial velocity v.", "Points with [S] = 0 are dropped; v = 0 is kept, mapping to the origin."],
    warnings: ["Velocity appears on both axes, so the errors in X and Y are correlated by construction and ordinary least squares is not valid here."],
    alternatives: ["Nonlinear Michaelis-Menten fit (the estimate to report)", "Hanes-Woolf"],
  },
  "curvetransform:hanes_woolf": {
    explain: "Plots [S]/v against [S], giving a straight line of slope 1/Vmax and Y-intercept KM/Vmax. Of the three classical linearizations this one distorts the error structure least.",
    definition: "[S]/v = (1/Vmax)·[S] + KM/Vmax",
    whenToUse: "The best-behaved of the classical straight-line views, and the usual choice when a linearization must be shown.",
    whenNotToUse: "Estimating the constants to report — fit the nonlinear model.",
    assumptions: ["X is substrate concentration [S] and Y is an initial velocity v.", "Points with [S] = 0 or v = 0 are undefined here and are dropped."],
    warnings: ["Substrate concentration appears on both axes, so the residuals are correlated; treat the line as descriptive."],
    alternatives: ["Nonlinear Michaelis-Menten fit (the estimate to report)", "Eadie-Hofstee"],
  },
  "outliers:iterative": {
    explain: "Grubbs' test removes the single most-extreme point, then repeats on the reduced data until none is flagged.",
    definition: "Repeated Grubbs G = max|xᵢ − x̄| / s",
    whenToUse: "Roughly normal data with a few isolated outliers.",
    whenNotToUse: "Non-normal data, or when several outliers cluster and mask each other.",
    assumptions: ["The underlying data are approximately normal."],
    warnings: ["Can over-remove points; masking hides multiple close outliers."],
    alternatives: ["ROUT for multiple outliers", "Single Grubbs for at most one"],
  },
  "outliers:single": {
    explain: "Grubbs' test applied once — flags only the single most-extreme value.",
    definition: "Grubbs G = max|xᵢ − x̄| / s (one pass)",
    whenToUse: "When at most one outlier is plausible.",
    whenNotToUse: "When several outliers may be present (they mask each other).",
    assumptions: ["Approximately normal data."],
    warnings: ["Misses multiple outliers."],
    alternatives: ["Iterative Grubbs or ROUT for several outliers"],
  },
  "outliers:rout": {
    explain: "ROUT combines robust nonlinear regression with a false-discovery-rate rule to identify several outliers at once.",
    definition: "Robust fit + FDR (Q) threshold on residuals",
    whenToUse: "Identifying multiple outliers with a controlled false-discovery rate (the safe default).",
    whenNotToUse: "When removing outliers is not scientifically justified at all.",
    assumptions: ["Outlier removal is defensible; the chosen Q sets how aggressive it is."],
    warnings: ["Removing points changes results — always report how many were removed and why."],
    alternatives: ["Grubbs (single/iterative) for approximately normal data"],
  },
});

// P-value corrector — one entry per correction method. Family-wise-error methods
// (Bonferroni/Holm/Holm-Šídák/Šídák) bound the chance of any false positive; false-
// discovery methods (Benjamini-Hochberg/Yekutieli) bound the expected fraction of false
// positives among the significant, trading a weaker guarantee for more power.
Object.assign(VARIANT_GUIDANCE, {
  "metaanalysis:linear": {
    explain: "Pools the estimates exactly as entered — for effects measured as differences (mean difference, risk difference), whose null is 0.",
    whenToUse: "Mean differences, standardized differences, risk differences — anything already on an additive scale.",
    whenNotToUse: "Ratio measures (OR, RR, HR) — their sampling distribution is symmetric in log space, not as entered.",
    assumptions: ["The entered CIs are symmetric around the estimate on this scale."],
    warnings: ["Pooling a ratio on the linear scale biases the result toward values above 1."],
    alternatives: ["The log-space option for OR / RR / HR"],
  },
  "metaanalysis:log": {
    explain: "Transforms every estimate and limit to logs before pooling and back-transforms the result — the convention for ratio measures, whose null is 1.",
    whenToUse: "Odds ratios, risk ratios, hazard ratios — any multiplicative effect.",
    whenNotToUse: "Differences (their scale is already additive), or studies containing zero/negative limits — those cannot be logged and are left out, counted in the notes.",
    assumptions: ["All estimates and limits are strictly positive.", "The entered CIs are symmetric in log space (the usual construction)."],
    warnings: ["A study whose interval touches 0 cannot be used on this scale."],
    alternatives: ["The linear option for difference measures"],
  },
  "publicationbias:linear": {
    explain: "Assesses the funnel exactly as entered — for effects measured as differences (mean difference, risk difference), whose null is 0.",
    whenToUse: "Difference measures — anything already on an additive scale.",
    whenNotToUse: "Ratio measures (OR, RR, HR) — assess them in log space, where their sampling distribution is symmetric.",
    assumptions: ["The entered CIs are symmetric around the estimate on this scale."],
    warnings: ["Assessing a ratio on the linear scale distorts the funnel it is judging."],
    alternatives: ["The log-space option for OR / RR / HR"],
  },
  "publicationbias:log": {
    explain: "Transforms every estimate and limit to logs before assessing the funnel — the convention for ratio measures, whose null is 1. Imputed studies back-transform for display.",
    whenToUse: "Odds ratios, risk ratios, hazard ratios — any multiplicative effect.",
    whenNotToUse: "Differences (their scale is already additive), or studies containing zero/negative limits — those cannot be logged and are left out, counted in the notes.",
    assumptions: ["All estimates and limits are strictly positive.", "The entered CIs are symmetric in log space (the usual construction)."],
    warnings: ["A study whose interval touches 0 cannot be used on this scale."],
    alternatives: ["The linear option for difference measures"],
  },
  "pcorrect:holm": {
    explain: "Holm's step-down procedure: sort the P values, apply the Bonferroni factor to the smallest and a shrinking factor to the rest, so it is uniformly more powerful than plain Bonferroni while giving the same family-wise-error guarantee.",
    definition: "adjusted P₍ᵢ₎ = max over k≤i of (m − k + 1)·P₍ₖ₎",
    whenToUse: "A good default when you need to control the family-wise error rate and want more power than Bonferroni.",
    whenNotToUse: "Very large families where controlling the false-discovery rate would be more appropriate.",
    assumptions: ["The P values form a complete, pre-specified family."],
    warnings: ["Still conservative for large families — consider an FDR method there."],
    alternatives: ["Bonferroni (simpler, slightly weaker)", "Benjamini-Hochberg for many tests"],
  },
  "pcorrect:bonferroni": {
    explain: "Multiplies every P value by the number of tests. The simplest family-wise-error control and the most conservative — it makes no assumption about how the tests relate.",
    definition: "adjusted P = min(1, m · P)",
    whenToUse: "A small number of tests, or when you want the most transparent, defensible correction.",
    whenNotToUse: "Many tests, where it becomes very conservative and costs real power.",
    assumptions: ["The P values form a complete, pre-specified family."],
    warnings: ["Over-corrects as the family grows — few effects survive."],
    alternatives: ["Holm (uniformly more powerful, same guarantee)", "Benjamini-Hochberg for many tests"],
  },
  "pcorrect:holm-sidak": {
    explain: "Holm's step-down procedure using the Šídák factor instead of Bonferroni at each step — slightly more powerful than Holm when the tests are independent.",
    definition: "adjusted P₍ᵢ₎ = max over k≤i of [1 − (1 − P₍ₖ₎)^(m − k + 1)]",
    whenToUse: "Family-wise-error control with independent (or nearly independent) tests.",
    whenNotToUse: "Strongly dependent tests, where the Šídák assumption is not met.",
    assumptions: ["Tests are independent for the Šídák step to be exact."],
    warnings: ["The independence assumption makes it slightly anticonservative under strong dependence."],
    alternatives: ["Holm (no independence assumption)", "Benjamini-Hochberg for many tests"],
  },
  "pcorrect:sidak": {
    explain: "A single-step correction assuming independent tests: the chance that at least one of m independent tests is a false positive is 1 − (1 − P)^m.",
    definition: "adjusted P = 1 − (1 − P)^m",
    whenToUse: "A small family of independent tests where a single-step correction is wanted.",
    whenNotToUse: "Dependent tests, or large families (a step-down method is more powerful).",
    assumptions: ["Tests are independent."],
    warnings: ["Anticonservative if the tests are positively dependent."],
    alternatives: ["Holm-Šídák (step-down, more powerful)", "Bonferroni (no independence assumption)"],
  },
  "pcorrect:fdr_bh": {
    explain: "Benjamini-Hochberg controls the false-discovery rate — the expected fraction of false positives among the tests you call significant — rather than the chance of any false positive. Much more powerful for large families.",
    definition: "q₍ᵢ₎ = min over k≥i of (m/k)·P₍ₖ₎ (step-up)",
    whenToUse: "Many tests (screens, -omics, many endpoints) where a few false positives among many discoveries is acceptable.",
    whenNotToUse: "When even one false positive is costly — use a family-wise-error method.",
    assumptions: ["Tests are independent or positively dependent."],
    warnings: ["The guarantee is on the false-discovery rate, not on any individual test being correct."],
    alternatives: ["Benjamini-Yekutieli (holds under any dependence)", "Holm for strict error control"],
  },
  "pcorrect:fdr_by": {
    explain: "Benjamini-Yekutieli controls the false-discovery rate under any dependence structure, at the cost of a harmonic-number penalty that makes it more conservative than Benjamini-Hochberg.",
    definition: "q₍ᵢ₎ = min over k≥i of (m·c/k)·P₍ₖ₎,  c = Σ 1/j (step-up)",
    whenToUse: "False-discovery control when the tests may be arbitrarily (e.g. negatively) dependent.",
    whenNotToUse: "Independent or positively dependent tests, where Benjamini-Hochberg is more powerful.",
    assumptions: ["No assumption on the dependence between tests."],
    warnings: ["More conservative than Benjamini-Hochberg because of the c = Σ1/j factor."],
    alternatives: ["Benjamini-Hochberg (more powerful under independence/positive dependence)"],
  },
});

// Curve-fit family descriptions (the equation itself is shown from core; here we give what the
// model means, when to reach for it, and its pitfalls): enzyme kinetics + binding.
Object.assign(VARIANT_GUIDANCE, {
  "curvefit:mm": {
    explain: "Michaelis-Menten relates initial reaction velocity to substrate concentration, estimating the maximum rate Vmax and the half-saturating concentration Km.",
    whenToUse: "Initial-velocity enzyme assays across a range of substrate concentrations.",
    whenNotToUse: "Cooperative (sigmoidal) or substrate-inhibited kinetics, or non-initial-rate data.",
    assumptions: ["Measurements are true initial velocities.", "A single catalytic site with no cooperativity or substrate inhibition."],
    warnings: ["Estimating Km well needs points below and around Km, not only near saturation."],
    alternatives: ["Allosteric sigmoidal for cooperativity", "Substrate inhibition when velocity falls at high substrate"],
  },
  "curvefit:kcat": {
    explain: "A Michaelis-Menten fit parameterized to return the turnover number kcat (Vmax = kcat·[E]), the catalytic events per enzyme per second.",
    whenToUse: "Initial-velocity data where the active-enzyme concentration is known, so kcat is meaningful.",
    whenNotToUse: "Unknown enzyme concentration (fit plain Michaelis-Menten for Vmax instead).",
    assumptions: ["The active enzyme concentration is known and correct.", "Standard Michaelis-Menten conditions hold."],
    warnings: ["kcat is only as accurate as the active-enzyme concentration."],
    alternatives: ["Plain Michaelis-Menten when [E] is unknown"],
  },
  "curvefit:allosteric": {
    explain: "An allosteric (sigmoidal) enzyme model — velocity rises cooperatively with substrate, with a Hill coefficient h describing the steepness.",
    whenToUse: "Enzymes whose velocity-vs-substrate curve is S-shaped (positive cooperativity).",
    whenNotToUse: "Hyperbolic (non-cooperative) kinetics — use Michaelis-Menten.",
    assumptions: ["Cooperative binding across multiple sites.", "Data are initial velocities."],
    warnings: ["The Hill coefficient is an empirical steepness, not literally the number of sites."],
    alternatives: ["Michaelis-Menten for non-cooperative enzymes"],
  },
  "curvefit:substrate_inhibition": {
    explain: "Substrate-inhibition kinetics — velocity rises then falls as high substrate concentrations become inhibitory, adding a Ki term to Michaelis-Menten.",
    whenToUse: "Enzyme curves that peak and then decline at high substrate.",
    whenNotToUse: "Monotonic saturating curves (use Michaelis-Menten).",
    assumptions: ["Excess substrate is inhibitory.", "Data span the peak and the decline."],
    warnings: ["Km and Ki are poorly determined without points on both sides of the peak."],
    alternatives: ["Michaelis-Menten when there is no high-substrate decline"],
  },
  "curvefit:enzyme_progress": {
    explain: "The integrated Michaelis-Menten equation fitted to a full product-versus-time progress curve, extracting kinetic parameters from a single reaction.",
    whenToUse: "Continuous product-vs-time traces where substrate is depleted over the run.",
    whenNotToUse: "Discrete initial-velocity points (fit Michaelis-Menten instead).",
    assumptions: ["No product inhibition or enzyme inactivation during the run.", "Well-mixed, single-substrate reaction."],
    warnings: ["Product inhibition or enzyme decay biases the parameters; check the residuals along the curve."],
    alternatives: ["Michaelis-Menten on initial velocities"],
  },
  "curvefit:morrison_ki": {
    explain: "The Morrison tight-binding equation estimates a true Ki for inhibitors whose potency is comparable to the enzyme concentration (so the free-inhibitor approximation fails).",
    whenToUse: "Tight-binding inhibitors where a large fraction of inhibitor is enzyme-bound.",
    whenNotToUse: "Weak inhibitors where [I] ≫ [E] (a standard IC50 model suffices).",
    assumptions: ["The enzyme concentration is known.", "Reversible, tight-binding inhibition at equilibrium."],
    warnings: ["Requires an accurate active-enzyme concentration; apparent Ki depends on substrate."],
    alternatives: ["Standard competition/IC50 models for weak inhibitors"],
  },
  "curvefit:onesite": {
    explain: "One-site specific binding — bound ligand rises hyperbolically to a maximum Bmax, with Kd the concentration giving half-maximal binding.",
    whenToUse: "Saturation binding of a ligand to a single class of sites (specific binding only).",
    whenNotToUse: "Data that include nonspecific binding, or two site classes.",
    assumptions: ["A single class of independent sites.", "Equilibrium; free-ligand concentration is X."],
    warnings: ["Determining Bmax needs concentrations well above Kd; determining Kd needs points near it."],
    alternatives: ["One-site + nonspecific for raw total binding", "Two-site for a biphasic curve"],
  },
  "curvefit:hill_binding": {
    explain: "Specific binding with a Hill slope — a one-site saturation curve allowing cooperativity (a steeper or shallower approach to Bmax).",
    whenToUse: "Saturation binding that is steeper or shallower than a simple hyperbola.",
    whenNotToUse: "Clearly two-site binding, or when the Hill slope is not interpretable.",
    assumptions: ["Cooperative binding summarized by one Hill coefficient."],
    warnings: ["A Hill slope far from 1 may actually indicate multiple sites or artifacts."],
    alternatives: ["One-site (no Hill) or two-site binding"],
  },
  "curvefit:twosite": {
    explain: "Two-site specific binding — the sum of two independent one-site curves, each with its own Bmax and Kd (a high- and a low-affinity site).",
    whenToUse: "Biphasic saturation or competition curves suggesting two affinity classes.",
    whenNotToUse: "Monophasic data (a two-site fit will be over-parameterized).",
    assumptions: ["Two independent, non-interacting site classes.", "Enough points to resolve both affinities."],
    warnings: ["Two-site fits are unstable unless the affinities differ enough and the data are rich; compare with the one-site fit."],
    alternatives: ["One-site binding when a single site suffices"],
  },
  "curvefit:onesite_ns": {
    explain: "One specific site plus a linear nonspecific term — fits raw total binding (specific saturable + nonspecific proportional to ligand).",
    whenToUse: "Total-binding data where nonspecific binding was not subtracted separately.",
    whenNotToUse: "Already-corrected specific binding (use plain one-site).",
    assumptions: ["Nonspecific binding is linear in free ligand.", "A single specific site class."],
    warnings: ["The nonspecific slope and Bmax trade off; a separate nonspecific control constrains the fit."],
    alternatives: ["One-site specific binding on subtracted data"],
  },
  "curvefit:homologous_competition": {
    explain: "Homologous competition — unlabeled ligand competes with a fixed concentration of the same labeled ligand, yielding Kd and Bmax from one experiment.",
    whenToUse: "Competition assays where the hot and cold ligands are identical.",
    whenNotToUse: "Heterologous competition (a different competitor — use the competition/IC50 models).",
    assumptions: ["Hot and cold ligands bind identically.", "The labeled-ligand concentration is known and fixed."],
    warnings: ["Fix the hot concentration to its known value; leaving it free makes the fit unstable."],
    alternatives: ["One-site competition (log inhibitor) for a different competitor"],
  },
  "curvefit:allosteric_binding": {
    explain: "An allosteric ternary-complex model — a modulator changes a ligand's binding via a cooperativity factor, holding the modulator's own affinity fixed.",
    whenToUse: "Binding shifted by an allosteric modulator (rather than direct competition).",
    whenNotToUse: "Simple orthosteric competition.",
    assumptions: ["A ternary complex forms.", "The modulator affinity (KA) is fixed to a known value."],
    warnings: ["Highly parameterized — fix what you can and interpret the cooperativity factor cautiously."],
    alternatives: ["Competition models for orthosteric inhibitors"],
  },
  "curvefit:hyperbola_offset": {
    explain: "A rectangular hyperbola with a baseline offset — a one-site saturation curve that does not start at zero.",
    whenToUse: "Saturating data with a non-zero baseline signal.",
    whenNotToUse: "Data that genuinely start at zero (use plain one-site binding).",
    assumptions: ["A constant baseline plus a single saturable component."],
    warnings: ["The offset and Bmax can trade off if the baseline is not well sampled."],
    alternatives: ["One-site binding without an offset"],
  },
  "curvefit:competition_1site": {
    explain: "One-site competitive binding versus log(inhibitor) — the classic sigmoidal displacement curve giving IC50 (and Ki via Cheng-Prusoff).",
    whenToUse: "A single competitor displacing a labeled ligand from one site.",
    whenNotToUse: "Biphasic displacement (two sites) or non-competitive mechanisms.",
    assumptions: ["A single site.", "X is log(inhibitor concentration)."],
    warnings: ["Converting IC50 to Ki needs the radioligand concentration and its Kd (Cheng-Prusoff)."],
    alternatives: ["Two-site competition for biphasic curves"],
  },
  "curvefit:competition_2site": {
    explain: "Two-site competitive binding versus log(inhibitor) — a biphasic displacement curve with a fraction bound to a high- and a low-affinity site.",
    whenToUse: "Displacement curves with two clear phases.",
    whenNotToUse: "Monophasic displacement (use one-site competition).",
    assumptions: ["Two independent site classes.", "X is log(inhibitor concentration)."],
    warnings: ["Unstable unless the two affinities differ and both plateaus are sampled; compare with the one-site fit."],
    alternatives: ["One-site competition for a single phase"],
  },
  "curvefit:total_binding": {
    explain: "One-site total binding — specific saturable binding plus a nonspecific component, fitting the raw (unsubtracted) signal.",
    whenToUse: "Raw total-binding data with both components present.",
    whenNotToUse: "Data already corrected to specific binding.",
    assumptions: ["One specific site plus nonspecific binding.", "Equilibrium."],
    warnings: ["Constrain the nonspecific term with a separate control where possible."],
    alternatives: ["One-site specific binding on subtracted data"],
  },
  "curvefit:assoc_then_dissoc": {
    explain: "An association-then-dissociation kinetic curve — binding rises to a plateau while ligand is present, then decays after washout.",
    whenToUse: "Time-course binding experiments with an association phase followed by dissociation.",
    whenNotToUse: "Equilibrium saturation data (fit a binding isotherm instead).",
    assumptions: ["Known time of the wash/dissociation switch.", "Pseudo-first-order kinetics."],
    warnings: ["The observed association rate depends on ligand concentration; report kon/koff, not just kobs."],
    alternatives: ["Association-only or dissociation-only exponential models"],
  },
  "curvefit:binding_depletion": {
    explain: "One-site binding corrected for ligand depletion — used when enough ligand is bound that the free concentration is noticeably lower than the added amount.",
    whenToUse: "Binding assays where a large fraction of the added ligand becomes bound.",
    whenNotToUse: "Assays with ligand in large excess (use plain one-site binding on free ligand).",
    assumptions: ["The total added ligand and the assay volume are known.", "A single site class."],
    warnings: ["Ignoring depletion inflates the apparent Kd; this model needs accurate concentrations."],
    alternatives: ["One-site binding when depletion is negligible"],
  },
  "curvefit:binding_depletion_ns": {
    explain: "Total binding with ligand depletion — specific plus nonspecific binding, accounting for depletion of the added ligand.",
    whenToUse: "Raw total-binding data where a large fraction of ligand is bound.",
    whenNotToUse: "Ligand-excess conditions or already-subtracted data.",
    assumptions: ["Known total ligand and volume.", "One specific site plus nonspecific binding."],
    warnings: ["Highly parameterized; constrain nonspecific binding with a control."],
    alternatives: ["One-site binding with depletion on subtracted data"],
  },
});

// Curve-fit family descriptions: growth · exponential · sigmoidal.
Object.assign(VARIANT_GUIDANCE, {
  "curvefit:gompertz": {
    explain: "Gompertz growth is an asymmetric sigmoid — growth accelerates early then slows toward an asymptote, with the inflection below the midpoint (unlike the symmetric logistic).",
    whenToUse: "Growth or accumulation that rises fast then decelerates asymmetrically toward a ceiling (tumours, bacterial growth).",
    whenNotToUse: "Symmetric S-curves (use logistic) or non-saturating growth.",
    assumptions: ["A single upper asymptote.", "Data span the acceleration and the plateau."],
    warnings: ["The asymptote is poorly determined without points near the plateau."],
    alternatives: ["Logistic growth for a symmetric curve", "Richards for tunable asymmetry"],
  },
  "curvefit:logistic_growth": {
    explain: "The logistic (Verhulst) model is a symmetric S-curve rising to a carrying capacity, with the steepest growth at the midpoint.",
    whenToUse: "Self-limiting growth toward a ceiling with roughly symmetric acceleration and deceleration.",
    whenNotToUse: "Asymmetric growth (use Gompertz/Richards) or unbounded growth.",
    assumptions: ["A single carrying capacity.", "Symmetric approach to the plateau."],
    warnings: ["Estimating the carrying capacity needs data approaching the plateau."],
    alternatives: ["Gompertz for asymmetry", "Exponential growth when unbounded"],
  },
  "curvefit:richards": {
    explain: "The Richards (generalized logistic) growth model adds a shape parameter that tunes where the inflection sits, spanning logistic, Gompertz, and von Bertalanffy behaviour.",
    whenToUse: "Sigmoidal growth whose asymmetry you want the data to determine.",
    whenNotToUse: "Sparse data — the extra shape parameter is hard to pin down.",
    assumptions: ["A single asymptote.", "Enough points to resolve the shape parameter."],
    warnings: ["The shape parameter trades off with the rate; over-flexible for small datasets."],
    alternatives: ["Logistic or Gompertz for a fixed shape"],
  },
  "curvefit:weibull_growth": {
    explain: "A Weibull-type growth curve — a flexible sigmoid whose approach to the asymptote is governed by a shape exponent.",
    whenToUse: "Growth to a plateau where the standard logistic/Gompertz shapes fit poorly.",
    whenNotToUse: "When a mechanistic model is preferred, or data are sparse.",
    assumptions: ["A single asymptote."],
    warnings: ["Empirical shape — parameters are descriptive, not mechanistic."],
    alternatives: ["Logistic, Gompertz, or Richards growth"],
  },
  "curvefit:von_bertalanffy": {
    explain: "The von Bertalanffy model describes growth toward an asymptotic size, with the rate proportional to the remaining gap — a standard for organism length/size over age.",
    whenToUse: "Size-at-age data approaching a maximum size (fisheries, animal growth).",
    whenNotToUse: "Sigmoidal growth with an early acceleration phase (use logistic/Gompertz).",
    assumptions: ["Growth rate declines monotonically toward an asymptote."],
    warnings: ["The asymptotic size is uncertain without older/larger individuals."],
    alternatives: ["Chapman-Richards for a generalized form"],
  },
  "curvefit:logistic4_growth": {
    explain: "A 4-parameter logistic growth curve with both a lower and an upper asymptote, so growth need not start from zero.",
    whenToUse: "Symmetric S-shaped growth with a non-zero baseline.",
    whenNotToUse: "Growth that genuinely starts at zero (the 3-parameter logistic is simpler).",
    assumptions: ["Two asymptotes are both sampled."],
    warnings: ["Both plateaus must be observed or constrained."],
    alternatives: ["3-parameter logistic growth from zero"],
  },
  "curvefit:gompertz4": {
    explain: "A 4-parameter Gompertz growth curve — asymmetric sigmoid with a lower and an upper asymptote.",
    whenToUse: "Asymmetric growth with a non-zero baseline.",
    whenNotToUse: "Growth from zero (use the 3-parameter Gompertz).",
    assumptions: ["Both asymptotes are sampled."],
    warnings: ["Needs data near both plateaus to be identifiable."],
    alternatives: ["3-parameter Gompertz", "4-parameter logistic growth"],
  },
  "curvefit:chapman_richards": {
    explain: "The Chapman-Richards model — a generalized von Bertalanffy growth curve widely used for biomass, height, and yield over time.",
    whenToUse: "Forestry/biomass growth to an asymptote with a flexible shape.",
    whenNotToUse: "Short time series without an approach to the asymptote.",
    assumptions: ["A single asymptote; growth decelerates over time."],
    warnings: ["Correlated parameters; the asymptote needs late-time data."],
    alternatives: ["Von Bertalanffy or Richards growth"],
  },
  "curvefit:mmf_growth": {
    explain: "The Morgan-Mercer-Flodin (MMF) model — a flexible sigmoidal growth curve with an adjustable steepness, common for nutrition-response and growth data.",
    whenToUse: "Saturating growth where the shape is not well captured by logistic/Gompertz.",
    whenNotToUse: "When a mechanistic interpretation is required.",
    assumptions: ["A single upper asymptote."],
    warnings: ["Empirical; parameters are descriptive."],
    alternatives: ["Logistic, Gompertz, or Weibull growth"],
  },
  "curvefit:exp_decay": {
    explain: "One-phase exponential decay — Y falls from its starting value to a plateau at a single rate constant k (half-life = ln2/k).",
    whenToUse: "A single decaying process reaching a floor (dissociation, clearance, washout).",
    whenNotToUse: "Multi-phase decay (use two/three-phase) or decay with drift.",
    assumptions: ["A single first-order process.", "The plateau is sampled or known."],
    warnings: ["A poorly sampled plateau makes the rate and plateau trade off."],
    alternatives: ["Two-phase decay for a curved semilog plot"],
  },
  "curvefit:exp_decay2": {
    explain: "Two-phase exponential decay — the sum of a fast and a slow decaying component, each with its own rate and amplitude.",
    whenToUse: "Decay that is curved on a semilog plot (two first-order processes).",
    whenNotToUse: "Single-phase decay (one-phase is simpler and more stable).",
    assumptions: ["Two independent first-order processes.", "The rates differ enough to resolve."],
    warnings: ["Unstable unless the two rates are well separated and the data are rich."],
    alternatives: ["One-phase decay, or three-phase for more components"],
  },
  "curvefit:exp_assoc": {
    explain: "One-phase association — Y rises from a baseline to a plateau at a single rate constant (a saturating approach).",
    whenToUse: "A single process approaching equilibrium (binding association, uptake).",
    whenNotToUse: "Two-phase kinetics or curves with an initial lag.",
    assumptions: ["A single first-order approach to a plateau."],
    warnings: ["The observed rate depends on concentration in binding assays."],
    alternatives: ["Two-phase association, or plateau-then-association for a lag"],
  },
  "curvefit:exp_growth": {
    explain: "Exponential growth — Y increases at a rate proportional to itself, with no upper bound (constant doubling time).",
    whenToUse: "Early, unconstrained growth (log phase) before any saturation.",
    whenNotToUse: "Growth that saturates (use a logistic/Gompertz growth model).",
    assumptions: ["No resource limitation over the fitted range."],
    warnings: ["Extrapolation explodes; only valid in the unconstrained regime."],
    alternatives: ["Logistic growth once saturation appears"],
  },
  "curvefit:biexp_assoc": {
    explain: "Two-phase association — the sum of a fast and a slow approach to a plateau.",
    whenToUse: "Uptake or binding with two kinetic components.",
    whenNotToUse: "Single-phase association.",
    assumptions: ["Two independent first-order processes with separable rates."],
    warnings: ["Needs well-separated rates and dense sampling to be identifiable."],
    alternatives: ["One-phase association"],
  },
  "curvefit:exp_linear": {
    explain: "One-phase decay plus a linear drift — an exponential decay superimposed on a steady baseline slope.",
    whenToUse: "Decay data with an underlying linear trend (baseline drift or ongoing production).",
    whenNotToUse: "Pure decay (use one-phase) — the extra slope over-fits clean data.",
    assumptions: ["One decaying process plus a constant-rate linear term."],
    warnings: ["The linear slope and the plateau can trade off."],
    alternatives: ["One-phase decay without drift"],
  },
  "curvefit:exp_decay3": {
    explain: "Three-phase exponential decay — the sum of three decaying components (fast, medium, slow).",
    whenToUse: "Decay with three resolvable kinetic components.",
    whenNotToUse: "Fewer phases (over-parameterized and unstable otherwise).",
    assumptions: ["Three independent first-order processes with distinct rates."],
    warnings: ["Very hard to identify; only with excellent, wide-range data."],
    alternatives: ["Two-phase decay, or a stretched exponential for a continuum"],
  },
  "curvefit:stretched_exp": {
    explain: "A stretched exponential (Kohlrausch-Williams-Watts) — decay with a stretch exponent β<1 that captures a distribution of relaxation times.",
    whenToUse: "Heterogeneous relaxation/decay that is not a clean sum of a few exponentials.",
    whenNotToUse: "A clearly discrete number of phases (use multi-exponential).",
    assumptions: ["A continuous distribution of rates summarized by β."],
    warnings: ["β and the characteristic time are correlated; β is descriptive."],
    alternatives: ["Two/three-phase decay for discrete components"],
  },
  "curvefit:plateau_then_decay": {
    explain: "A flat baseline followed by one-phase decay after a lag time X0 — nothing changes until the decay begins.",
    whenToUse: "Decay that starts only after a delay (a lag before clearance).",
    whenNotToUse: "Decay from t=0 (use one-phase decay).",
    assumptions: ["A distinct onset time before decay.", "A single decaying process after the lag."],
    warnings: ["The lag time needs points on both sides of the onset."],
    alternatives: ["One-phase decay without a lag"],
  },
  "curvefit:plateau_then_assoc": {
    explain: "A flat baseline followed by one-phase association after a lag time — the rise begins only after a delay.",
    whenToUse: "Association/uptake that starts after a delay.",
    whenNotToUse: "Association from t=0 (use one-phase association).",
    assumptions: ["A distinct onset time before the rise."],
    warnings: ["The onset time needs points bracketing it."],
    alternatives: ["One-phase association without a lag"],
  },
  "curvefit:boltzmann": {
    explain: "A Boltzmann sigmoid — a symmetric S-curve parameterized by the midpoint V50 and a slope factor, classic for voltage-activation and thermal-melt curves.",
    whenToUse: "A single symmetric transition between two plateaus (activation, unfolding).",
    whenNotToUse: "Two transitions (use double Boltzmann) or asymmetric curves.",
    assumptions: ["Two plateaus are sampled.", "A single symmetric transition."],
    warnings: ["The slope factor and V50 need points across the transition, not only the plateaus."],
    alternatives: ["Double Boltzmann for two transitions", "4PL for a general sigmoid"],
  },
  "curvefit:boltzmann_double": {
    explain: "A double Boltzmann — the sum of two sigmoidal transitions, for curves with two distinct steps.",
    whenToUse: "Two-step transitions (e.g. two unfolding events).",
    whenNotToUse: "A single transition (use the single Boltzmann).",
    assumptions: ["Two resolvable transitions with intervening plateau."],
    warnings: ["Unstable unless the two midpoints are well separated."],
    alternatives: ["Single Boltzmann"],
  },
});

// Curve-fit family descriptions: peak · periodic · power · simple.
Object.assign(VARIANT_GUIDANCE, {
  "curvefit:gaussian": {
    explain: "A Gaussian (normal) peak — a symmetric bell defined by its amplitude, centre, and width (σ).",
    whenToUse: "A single symmetric peak (a spectral band, a distribution mode).",
    whenNotToUse: "Asymmetric or heavy-tailed peaks, or overlapping peaks.",
    assumptions: ["One symmetric peak on a flat baseline."],
    warnings: ["A sloping baseline biases the width and amplitude — use the baseline variant."],
    alternatives: ["Gaussian with baseline, Lorentzian, or Voigt for heavier tails"],
  },
  "curvefit:lorentzian": {
    explain: "A Lorentzian (Cauchy) peak — symmetric but with heavier tails than a Gaussian, the natural line shape for many resonances.",
    whenToUse: "Spectral lines / resonances with broad wings (NMR, some spectroscopy).",
    whenNotToUse: "Gaussian-shaped peaks or asymmetric peaks.",
    assumptions: ["One symmetric peak with Lorentzian tails."],
    warnings: ["Its wide tails make area sensitive to the fit range."],
    alternatives: ["Gaussian for lighter tails, Voigt/pseudo-Voigt for a mix"],
  },
  "curvefit:gaussian_baseline": {
    explain: "A Gaussian peak plus a baseline (offset/slope), so the peak sits on a non-flat background.",
    whenToUse: "A symmetric peak on a sloping or raised baseline.",
    whenNotToUse: "A truly flat baseline (the plain Gaussian is simpler).",
    assumptions: ["One symmetric peak plus a smooth background."],
    warnings: ["The baseline and peak wings can trade off; sample enough baseline on both sides."],
    alternatives: ["Plain Gaussian on subtracted data"],
  },
  "curvefit:lognormal_peak": {
    explain: "A log-normal peak — asymmetric, skewed toward larger X, useful for size distributions and skewed responses.",
    whenToUse: "A peak with a longer right tail (particle sizes, skewed spectra).",
    whenNotToUse: "Symmetric peaks (use Gaussian).",
    assumptions: ["Positive X; a single right-skewed peak."],
    warnings: ["Undefined for X ≤ 0; the skew and width are correlated."],
    alternatives: ["EMG for a Gaussian with an exponential tail"],
  },
  "curvefit:gaussian2": {
    explain: "The sum of two Gaussian peaks — for two overlapping symmetric bands.",
    whenToUse: "Two partially resolved peaks.",
    whenNotToUse: "A single peak (over-parameterized) or more than two components.",
    assumptions: ["Two symmetric peaks on a flat baseline."],
    warnings: ["Badly overlapping peaks are hard to separate; constrain positions if known."],
    alternatives: ["Single Gaussian, or three-Gaussian for more peaks"],
  },
  "curvefit:pseudo_voigt": {
    explain: "A pseudo-Voigt peak — a weighted sum of a Gaussian and a Lorentzian, a fast approximation to the true Voigt profile.",
    whenToUse: "Peaks whose shape is between Gaussian and Lorentzian (common in diffraction/spectroscopy).",
    whenNotToUse: "When a rigorous Voigt convolution is required.",
    assumptions: ["One peak with a mixed Gaussian/Lorentzian character."],
    warnings: ["The mixing fraction is empirical, not the physical Gaussian/Lorentzian widths."],
    alternatives: ["True Voigt, or pure Gaussian/Lorentzian"],
  },
  "curvefit:gaussian3": {
    explain: "The sum of three Gaussian peaks — for three overlapping symmetric bands.",
    whenToUse: "Three partially resolved peaks.",
    whenNotToUse: "Fewer peaks (over-parameterized).",
    assumptions: ["Three symmetric peaks on a flat baseline."],
    warnings: ["Highly correlated parameters; fix or bound positions where known."],
    alternatives: ["Two-Gaussian, or a peak-deconvolution tool for many peaks"],
  },
  "curvefit:voigt": {
    explain: "A Voigt peak — the convolution of a Gaussian and a Lorentzian, the physically correct line shape when both Doppler (Gaussian) and pressure/lifetime (Lorentzian) broadening are present.",
    whenToUse: "High-resolution spectral lines with both broadening mechanisms.",
    whenNotToUse: "When a fast approximate shape suffices (use pseudo-Voigt).",
    assumptions: ["One peak; both broadening widths are resolvable."],
    warnings: ["The two widths are correlated and need high-quality data to separate."],
    alternatives: ["Pseudo-Voigt for speed, Gaussian/Lorentzian for one mechanism"],
  },
  "curvefit:emg": {
    explain: "An exponentially-modified Gaussian — a Gaussian convolved with an exponential tail, the standard model for tailing chromatographic peaks.",
    whenToUse: "Peaks with a symmetric front and an exponential tail (chromatography, flow injection).",
    whenNotToUse: "Symmetric peaks (use Gaussian).",
    assumptions: ["One peak with a right-side exponential tail."],
    warnings: ["The tail time constant and Gaussian width can trade off."],
    alternatives: ["Log-normal peak for a different asymmetry, Gaussian if symmetric"],
  },
  "curvefit:pearson7": {
    explain: "A Pearson VII peak — a symmetric profile whose tail weight is tunable by an exponent, interpolating between Gaussian and Lorentzian.",
    whenToUse: "Peaks whose tail heaviness you want the data to determine (X-ray diffraction).",
    whenNotToUse: "When a specific physical line shape is required.",
    assumptions: ["One symmetric peak."],
    warnings: ["The shape exponent is empirical and correlates with the width."],
    alternatives: ["Pseudo-Voigt or Voigt for a physical mix"],
  },
  "curvefit:sine": {
    explain: "A sine wave defined by amplitude, frequency, phase, and offset — the basic model for a periodic oscillation.",
    whenToUse: "Regular oscillations of roughly constant amplitude (circadian, cyclic signals).",
    whenNotToUse: "Decaying oscillations (use damped sine) or trends (add drift).",
    assumptions: ["A single stable frequency over the range."],
    warnings: ["Provide a good frequency starting value — sine fits have many local minima."],
    alternatives: ["Damped sine, sine + drift, or a two-harmonic sum"],
  },
  "curvefit:damped_sine": {
    explain: "A sine wave whose amplitude decays exponentially — for ringing that dies out.",
    whenToUse: "Oscillations that decay over time (relaxation ringing, damped resonance).",
    whenNotToUse: "Sustained oscillations (use plain sine).",
    assumptions: ["A single frequency with exponential amplitude decay."],
    warnings: ["Frequency and damping need several visible cycles."],
    alternatives: ["Plain sine for undamped oscillation"],
  },
  "curvefit:sine2": {
    explain: "The sum of two sine harmonics — a periodic signal with two frequency components.",
    whenToUse: "Oscillations that are clearly not a single sinusoid (two rhythms).",
    whenNotToUse: "A single frequency (use plain sine).",
    assumptions: ["Two stable frequencies."],
    warnings: ["Both frequencies need good starting values; risk of aliasing with sparse sampling."],
    alternatives: ["Single sine, or spectral analysis for many components"],
  },
  "curvefit:sine_drift": {
    explain: "A sine wave superimposed on a linear trend — an oscillation riding on a baseline drift.",
    whenToUse: "Periodic data with an underlying upward/downward trend.",
    whenNotToUse: "Stationary oscillation (use plain sine).",
    assumptions: ["A single frequency plus a constant-rate drift."],
    warnings: ["The drift slope and offset can trade off if fewer than a couple of cycles are seen."],
    alternatives: ["Plain sine after detrending"],
  },
  "curvefit:power": {
    explain: "A power law, Y = A·Xᴮ — a straight line on a log-log plot, with exponent B setting the scaling.",
    whenToUse: "Scaling relationships spanning a wide range (allometry, physical power laws).",
    whenNotToUse: "Data with a baseline offset or an exponential cutoff.",
    assumptions: ["Positive X and Y; a single scaling exponent over the range."],
    warnings: ["Undefined at X ≤ 0; fitting on raw (not log) scale weights large values heavily."],
    alternatives: ["Power + offset, or power law with cutoff"],
  },
  "curvefit:power_offset": {
    explain: "A power law plus a constant offset, Y = A·Xᴮ + C — a scaling relationship on a non-zero baseline.",
    whenToUse: "Power-law behaviour that levels off to a baseline rather than passing through zero.",
    whenNotToUse: "Clean power laws through the origin (use the plain power law).",
    assumptions: ["Positive X; a single exponent plus a baseline."],
    warnings: ["The offset and exponent can trade off if the baseline is not sampled."],
    alternatives: ["Plain power law"],
  },
  "curvefit:power_law_cutoff": {
    explain: "A power law with an exponential cutoff — scales as a power law at small X but is exponentially suppressed beyond a cutoff scale.",
    whenToUse: "Distributions that follow a power law then fall off faster (network degrees, sizes).",
    whenNotToUse: "Pure power laws with no cutoff.",
    assumptions: ["Positive X; power-law regime plus a cutoff scale."],
    warnings: ["The cutoff is only determined if the data extend past it."],
    alternatives: ["Plain power law when no cutoff is seen"],
  },
  "curvefit:logarithmic": {
    explain: "A logarithmic curve, Y = A + B·ln(X) — slow, ever-decreasing growth with no plateau.",
    whenToUse: "Responses that keep rising but with diminishing returns (learning curves, some dose ranges).",
    whenNotToUse: "Saturating responses (use a sigmoid) or X ≤ 0.",
    assumptions: ["Positive X."],
    warnings: ["Undefined at X ≤ 0; never saturates, so do not extrapolate to a plateau."],
    alternatives: ["Square-root or a saturating (hyperbola/sigmoid) model"],
  },
  "curvefit:reciprocal": {
    explain: "A reciprocal curve, Y = A + B/X — a hyperbolic decay toward the asymptote A as X grows.",
    whenToUse: "Quantities that fall off as 1/X toward a floor.",
    whenNotToUse: "X spanning zero, or non-hyperbolic decay.",
    assumptions: ["X does not cross zero over the range."],
    warnings: ["Diverges near X = 0; the asymptote A needs large-X data."],
    alternatives: ["One-phase decay, or a rational function"],
  },
  "curvefit:rational11": {
    explain: "A rational (1,1) function — the ratio of two linear terms, (a+bX)/(1+dX), a flexible saturating/hyperbolic shape.",
    whenToUse: "Saturating or hyperbola-like data where a simple mechanistic model does not fit.",
    whenNotToUse: "When a mechanistic (binding/kinetic) model is preferred.",
    assumptions: ["No pole (denominator zero) within the data range."],
    warnings: ["Watch for a denominator root that makes the curve blow up."],
    alternatives: ["One-site binding / Michaelis-Menten for a mechanistic hyperbola"],
  },
  "curvefit:sqrt_fit": {
    explain: "A square-root curve, Y = A + B·√X — diminishing-returns growth slower than linear, faster than logarithmic.",
    whenToUse: "Responses that grow sublinearly (diffusion-limited signals, some scaling).",
    whenNotToUse: "Saturating responses or negative X.",
    assumptions: ["Non-negative X."],
    warnings: ["Undefined for X < 0; does not plateau."],
    alternatives: ["Logarithmic, or a saturating model"],
  },
});

// Curve-fit family descriptions: polynomial · lines · model-free linear.
Object.assign(VARIANT_GUIDANCE, {
  "curvefit:poly2": {
    explain: "A quadratic polynomial (degree 2) — a single smooth bend (one maximum or minimum).",
    whenToUse: "Gentle curvature or an empirical trend with one turning point.",
    whenNotToUse: "Mechanistic questions, or extrapolation beyond the data.",
    assumptions: ["The curvature is well captured by one bend."],
    warnings: ["Polynomials are descriptive, not mechanistic, and diverge outside the fitted range."],
    alternatives: ["A mechanistic model, or the centered quadratic for stability"],
  },
  "curvefit:poly3": {
    explain: "A cubic polynomial (degree 3) — allows one inflection (an S-like empirical shape).",
    whenToUse: "Empirical trends with a single inflection.",
    whenNotToUse: "Mechanistic interpretation or extrapolation.",
    assumptions: ["The shape needs at most one inflection."],
    warnings: ["Higher orders overfit noise; never extrapolate."],
    alternatives: ["A sigmoid for a real S-curve, or the centered cubic"],
  },
  "curvefit:poly4": {
    explain: "A quartic polynomial (degree 4) — up to two bends; a flexible empirical curve.",
    whenToUse: "Wiggly empirical data that lower orders miss.",
    whenNotToUse: "Whenever a lower order or a mechanistic model fits.",
    assumptions: ["Enough well-spread points to constrain four-plus coefficients."],
    warnings: ["Prone to overfitting and edge oscillation; use the centered form for conditioning."],
    alternatives: ["Lower-order polynomial, spline, or a mechanistic model"],
  },
  "curvefit:poly5": {
    explain: "A quintic polynomial (degree 5) — a very flexible empirical curve with up to three bends.",
    whenToUse: "Complex empirical shapes when a spline is not desired.",
    whenNotToUse: "Almost always prefer a spline or a mechanistic model.",
    assumptions: ["Many well-distributed points."],
    warnings: ["Strong overfitting and boundary oscillation; do not extrapolate."],
    alternatives: ["Smoothing spline or LOWESS"],
  },
  "curvefit:poly6": {
    explain: "A sextic polynomial (degree 6) — maximum built-in flexibility; almost always overkill.",
    whenToUse: "Only when a specific high-order empirical form is genuinely required.",
    whenNotToUse: "Essentially always — a spline is safer.",
    assumptions: ["A large, dense dataset."],
    warnings: ["Severe overfitting and Runge-type oscillation; never extrapolate."],
    alternatives: ["Smoothing spline"],
  },
  "curvefit:poly2_centered": {
    explain: "A quadratic in (X − mean X) — the same parabola, re-centered so the coefficients are less correlated and the fit is numerically stable.",
    whenToUse: "A quadratic trend, especially when X values are large or far from zero.",
    whenNotToUse: "Mechanistic questions.",
    assumptions: ["One bend suffices."],
    warnings: ["Coefficients are relative to the mean X, not to zero."],
    alternatives: ["Uncentered quadratic (same shape)"],
  },
  "curvefit:poly3_centered": {
    explain: "A cubic in (X − mean X) — a re-centered cubic for better numerical conditioning.",
    whenToUse: "A cubic trend with large or offset X values.",
    whenNotToUse: "Mechanistic interpretation.",
    assumptions: ["At most one inflection."],
    warnings: ["Coefficients are relative to the mean X."],
    alternatives: ["Uncentered cubic, or a sigmoid"],
  },
  "curvefit:poly4_centered": {
    explain: "A quartic in (X − mean X) — re-centered for stability at higher order.",
    whenToUse: "A quartic empirical trend with large/offset X.",
    whenNotToUse: "When a lower order or spline fits.",
    assumptions: ["Enough well-spread points."],
    warnings: ["Still overfits; centering only helps conditioning."],
    alternatives: ["Lower-order polynomial or spline"],
  },
  "curvefit:poly5_centered": {
    explain: "A quintic in (X − mean X) — re-centered high-order polynomial.",
    whenToUse: "Complex empirical shapes with large/offset X.",
    whenNotToUse: "Prefer a spline.",
    assumptions: ["Many well-distributed points."],
    warnings: ["Overfitting persists despite centering."],
    alternatives: ["Smoothing spline"],
  },
  "curvefit:poly6_centered": {
    explain: "A sextic in (X − mean X) — the highest-order centered polynomial offered.",
    whenToUse: "Only when a specific high-order form is required, with large/offset X.",
    whenNotToUse: "Almost always prefer a spline.",
    assumptions: ["A large, dense dataset."],
    warnings: ["Severe overfitting; centering only aids conditioning."],
    alternatives: ["Smoothing spline"],
  },
  "curvefit:line_origin": {
    explain: "A straight line through the origin, Y = B·X — a proportional relationship with no intercept.",
    whenToUse: "Calibration or scaling where Y must be 0 at X = 0 by design.",
    whenNotToUse: "When a non-zero intercept is plausible (fit a full line).",
    assumptions: ["A zero intercept is justified independently of the data."],
    warnings: ["Forcing the origin biases the slope if the true intercept is not zero."],
    alternatives: ["Ordinary linear regression with an intercept"],
  },
  "curvefit:segmental": {
    explain: "A segmental (broken-line / hockey-stick) fit — two straight segments meeting at a breakpoint the fit estimates.",
    whenToUse: "Data with a clear change of slope (a threshold or transition point).",
    whenNotToUse: "Smoothly curving data (use a curve) — a break is an artifact there.",
    assumptions: ["Two roughly linear regimes with a single breakpoint."],
    warnings: ["The breakpoint needs points on both sides; a smooth curve can masquerade as a break."],
    alternatives: ["A smooth curve, or two separate regressions"],
  },
  "curvefit:linear": {
    explain: "A straight line, Y = A + B·X — the simplest shape check (slope + intercept).",
    whenToUse: "A quick linearity check or a genuinely linear relationship.",
    whenNotToUse: "Curved data, or when EC50/IC50-style parameters are needed.",
    assumptions: ["An approximately linear relationship over the range."],
    warnings: ["Not a dose-response model; check residuals for curvature."],
    alternatives: ["Nonlinear curve fitting for curved data"],
  },
});

// Global-fit-only mechanisms (available under the Global fit method). These are fitted across a
// family of curves that share mechanism parameters, so their keys use the `globalfit:` prefix.
Object.assign(VARIANT_GUIDANCE, {
  "globalfit:competitive_inhibition": {
    explain: "Competitive inhibition — the inhibitor competes with substrate, raising the apparent Km while leaving Vmax unchanged. Fitted globally across inhibitor concentrations to share Vmax, Km, and Ki.",
    whenToUse: "Enzyme velocity curves at several inhibitor concentrations, to estimate a single Ki.",
    whenNotToUse: "A single curve, or a non-competitive mechanism.",
    assumptions: ["Reversible competitive inhibition.", "True initial velocities; shared Vmax/Km across curves."],
    warnings: ["Distinguishing the inhibition type needs curves at several [I] and [S]."],
    alternatives: ["Noncompetitive / uncompetitive / mixed inhibition", "Morrison Ki for tight binders"],
  },
  "globalfit:noncompetitive_inhibition": {
    explain: "Noncompetitive inhibition — the inhibitor lowers Vmax without changing Km. Global fit shares the mechanism parameters across inhibitor concentrations.",
    whenToUse: "Inhibitor-series velocity data where Km appears unchanged but Vmax falls.",
    whenNotToUse: "Competitive or uncompetitive patterns.",
    assumptions: ["Inhibitor binds equally to E and ES.", "Initial velocities."],
    warnings: ["Requires several [I] to separate the mechanism from mixed inhibition."],
    alternatives: ["Competitive / uncompetitive / mixed inhibition"],
  },
  "globalfit:uncompetitive_inhibition": {
    explain: "Uncompetitive inhibition — the inhibitor binds only the enzyme-substrate complex, lowering both Vmax and Km in the same proportion.",
    whenToUse: "Inhibitor series where Vmax and Km fall together.",
    whenNotToUse: "Competitive or noncompetitive patterns.",
    assumptions: ["Inhibitor binds only ES.", "Initial velocities."],
    warnings: ["Best resolved at high substrate; needs several [I]."],
    alternatives: ["Competitive / noncompetitive / mixed inhibition"],
  },
  "globalfit:mixed_inhibition": {
    explain: "Mixed-model inhibition — the general case: the inhibitor affects both Vmax and Km via a factor α, with competitive/noncompetitive/uncompetitive as special cases.",
    whenToUse: "Inhibitor series when the mechanism is unknown and you want α to decide.",
    whenNotToUse: "When a specific simpler mechanism is already established.",
    assumptions: ["Reversible inhibition; shared parameters across [I]."],
    warnings: ["The extra α parameter needs rich data across [I] and [S] to pin down."],
    alternatives: ["The specific competitive/noncompetitive/uncompetitive models"],
  },
  "globalfit:assoc_kinetics": {
    explain: "Association kinetics fitted globally across several ligand concentrations — the observed rate varies with [ligand], so a shared fit recovers the true kon and koff.",
    whenToUse: "On-rate time courses recorded at multiple ligand concentrations.",
    whenNotToUse: "A single association trace (kobs alone cannot give kon/koff).",
    assumptions: ["Pseudo-first-order binding.", "The ligand concentrations are known."],
    warnings: ["kobs depends on concentration — report kon/koff from the global fit, not kobs."],
    alternatives: ["Single-curve association for kobs only"],
  },
  "globalfit:motulsky_mahan": {
    explain: "The Motulsky-Mahan model for competitive binding kinetics — the time course of a labeled ligand in the presence of a competitor, globally fitted to recover the competitor's kon/koff.",
    whenToUse: "Kinetic competition experiments where a competitor slows labeled-ligand binding.",
    whenNotToUse: "Equilibrium competition (use a displacement isotherm).",
    assumptions: ["Known, fixed labeled-ligand concentration.", "Simple competitive kinetics."],
    warnings: ["Fix the labeled-ligand concentration and its rate constants; otherwise unstable."],
    alternatives: ["Equilibrium competition (log inhibitor)"],
  },
  "globalfit:schild": {
    explain: "The Gaddum/Schild model — a competitive antagonist shifts the agonist dose-response to the right; a global fit across antagonist concentrations yields the antagonist affinity (pA2/Kb).",
    whenToUse: "Agonist dose-response families at several antagonist concentrations.",
    whenNotToUse: "Non-competitive/insurmountable antagonism.",
    assumptions: ["Surmountable competitive antagonism (parallel rightward shifts, common maximum)."],
    warnings: ["A depressed maximum signals non-competitive antagonism — Schild then does not apply."],
    alternatives: ["Allosteric EC50 shift for allosteric modulators"],
  },
  "globalfit:allosteric_ec50": {
    explain: "An allosteric EC50-shift model — an allosteric modulator changes the agonist EC50 via a cooperativity factor, fitted globally across modulator concentrations.",
    whenToUse: "Agonist curves shifted by an allosteric modulator (not orthosteric competition).",
    whenNotToUse: "Orthosteric competitive antagonism (use Schild).",
    assumptions: ["An allosteric ternary-complex mechanism."],
    warnings: ["Highly parameterized; constrain what is known and interpret cooperativity cautiously."],
    alternatives: ["Gaddum/Schild for competitive antagonists"],
  },
  "globalfit:operational": {
    explain: "The operational (Black-Leff) model of agonism — separates a partial agonist's affinity (KA) from its efficacy (τ), fitted globally across the agonist family.",
    whenToUse: "Quantifying partial-agonist efficacy vs affinity from concentration-response data.",
    whenNotToUse: "When only a potency (EC50) is needed (use a sigmoid).",
    assumptions: ["A defined maximal system response.", "The operational model applies to the pathway."],
    warnings: ["τ and KA trade off unless the data span sub-maximal to maximal responses."],
    alternatives: ["A plain 4PL for EC50 without a mechanistic split"],
  },
  "globalfit:operational_depletion": {
    explain: "The operational model with a receptor-depletion parameter (q) — for systems where agonist occupancy depletes available receptors.",
    whenToUse: "Operational-model analyses where receptor depletion is significant.",
    whenNotToUse: "Standard operational fits without depletion.",
    assumptions: ["The depletion term q is identifiable from the data."],
    warnings: ["Adds a parameter that needs rich data to estimate."],
    alternatives: ["The standard operational model"],
  },
  "globalfit:total_nonspecific": {
    explain: "A global fit of total and nonspecific binding to one site — sharing Bmax/Kd across total and nonspecific-control curves to extract specific binding.",
    whenToUse: "Paired total + nonspecific saturation curves fitted together.",
    whenNotToUse: "Already-subtracted specific-binding data (use one-site binding).",
    assumptions: ["One specific site plus linear nonspecific binding.", "Shared parameters across the curve set."],
    warnings: ["Needs a genuine nonspecific control to constrain the fit."],
    alternatives: ["One-site specific binding on subtracted data"],
  },
  "globalfit:total_nonspecific_2site": {
    explain: "A global total-and-nonspecific binding fit with two specific sites — two affinity classes plus nonspecific binding, shared across the curve family.",
    whenToUse: "Biphasic saturation with total + nonspecific curves.",
    whenNotToUse: "Monophasic binding (use the one-site version).",
    assumptions: ["Two specific sites plus nonspecific binding."],
    warnings: ["Unstable unless the two affinities differ and both plateaus are sampled."],
    alternatives: ["One-site total-and-nonspecific global fit"],
  },
  "globalfit:total_nonspecific_depletion": {
    explain: "A global total-and-nonspecific binding fit that also accounts for ligand depletion — for high-fraction-bound assays.",
    whenToUse: "Total + nonspecific binding where a large fraction of ligand is bound.",
    whenNotToUse: "Ligand-excess conditions.",
    assumptions: ["Known total ligand and volume.", "One specific site plus nonspecific binding."],
    warnings: ["Highly parameterized; constrain nonspecific binding and use accurate concentrations."],
    alternatives: ["Total-and-nonspecific global fit without depletion"],
  },
});
/**
 * Shared method-level and non-curve variant guidance. METHOD_INFO and VARIANT_NOTE are
 * the fallbacks where this registry has no entry; this registry supplies the structured
 * content used by the picker and the active configuration panel.
 */
export const ANALYSIS_GUIDANCE: Record<string, VariantGuidance> = {
  metaanalysis: {
    definition: "ŷ = Σwᵢyᵢ/Σwᵢ, wᵢ = 1/SEᵢ² · τ² = max(0, (Q − df)/C)",
    explain: "Inverse-variance meta-analysis pools one estimate per study (entered with its confidence limits) into an overall effect, reporting fixed-effect and DerSimonian-Laird random-effects results side by side with heterogeneity (Q, τ², I²) and per-study weights.",
    whenToUse: "A Study · Estimate · Lower · Upper sheet of published or per-experiment results you want combined into a single pooled effect — the numbers behind the forest and funnel plots.",
    whenNotToUse: "Raw per-subject data (analyse each study first), or estimates whose intervals are not inverse-variance based — the back-calculated weights would be wrong.",
    assumptions: ["Each row is an independent study.", "The entered limits are symmetric inverse-variance CIs at the stated level (in log space for ratio measures)."],
    warnings: ["Report the random-effects result when I² is material.", "Pooling cannot repair publication bias — read the funnel plot alongside it."],
    alternatives: ["The forest plot's summary diamond for the same pooling shown graphically"],
  },
  publicationbias: {
    definition: "Egger: yᵢ/SEᵢ = β₀ + β₁/SEᵢ · trim-and-fill: L0 = (4Tₙ − k(k+1))/(2k − 1)",
    explain: "Asks whether the funnel leans: Egger's regression tests the intercept of standardized effect on precision (a non-zero intercept means small studies report systematically different effects), and Duval-Tweedie trim-and-fill estimates how many small studies are missing, mirrors them in, and re-pools — the adjusted estimate is a sensitivity answer.",
    whenToUse: "After pooling a Study · Estimate · Lower · Upper sheet, to judge whether publication bias could explain the result — the numbers to quote next to the funnel plot.",
    whenNotToUse: "Fewer than ~10 studies make both tests weak (they still run from 3); a significant Egger test says the funnel leans, not why.",
    assumptions: ["Each row is an independent study with inverse-variance CIs at the stated level.", "Trim-and-fill assumes the missing studies mirror the most extreme observed ones."],
    warnings: ["Heterogeneity alone can lean a funnel — read Egger's p together with I².", "The adjusted estimate is a sensitivity check, never a corrected result."],
    alternatives: ["The funnel plot's Trim-and-fill overlay for the same imputation drawn graphically"],
  },
  describe: {
    definition: "x̄ = (Σxᵢ)/n · s = √[Σ(xᵢ − x̄)²/(n − 1)]",
    explain: "Descriptive statistics summarize location, spread, shape, and uncertainty without testing a hypothesis.",
    whenToUse: "Any numeric dataset when you need to understand its scale, variability, distribution, and usable sample size before choosing a formal analysis.",
    whenNotToUse: "A question about a specific group difference, association, or prediction that requires an inferential method.",
    assumptions: ["Values are measured on a meaningful numeric scale.", "Missing values and replicate structure are understood before interpreting n."],
    warnings: ["A summary cannot establish causation or replace a study-design-aware test."],
    alternatives: ["Normality or outlier checks for data quality", "A group comparison or regression for an inferential question"],
  },
  normality: {
    definition: "H₀: the observed values follow the selected reference distribution",
    explain: "Normality tests and diagnostic summaries assess whether a numeric sample is compatible with a normal distribution.",
    whenToUse: "As a diagnostic alongside a histogram or Q–Q plot, especially before relying on a small-sample parametric model.",
    whenNotToUse: "As the sole decision rule for selecting a test; large samples flag trivial departures and small samples have low power.",
    assumptions: ["Observations are independent within the selected dataset."],
    warnings: ["Inspect the distribution and study design; do not automatically transform or discard data because of one p-value."],
    alternatives: ["Histogram and Q–Q plot", "Robust or rank-based analysis when the scientific question permits"],
  },
  outliers: {
    definition: "Extreme-value score compared with a sample-size-specific reference distribution",
    explain: "Outlier methods flag observations that are unusually far from the rest of a dataset; they do not decide whether a value is erroneous.",
    whenToUse: "For transparent screening of extreme values before analysis, with domain and measurement review.",
    whenNotToUse: "To remove inconvenient observations solely because they weaken a result.",
    assumptions: ["The retained distribution is approximately compatible with the method.", "A flagged value can be investigated independently of its effect on significance."],
    warnings: ["Record any exclusion rule and rerun the primary analysis with and without flagged observations."],
  },
  pcorrect: {
    definition: "adjusted P = correct(P₁…Pₘ) at family size m",
    explain: "Multiple-comparison correction adjusts a family of P values so that the chance of any false positive (family-wise error) — or the expected fraction of false positives among the significant ones (false-discovery rate) — is controlled at the chosen level.",
    whenToUse: "When a set of P values together answers one question and reporting each at its raw threshold would inflate false positives.",
    whenNotToUse: "A single test, or a subset cherry-picked from a larger family — the correction assumes the complete family is present.",
    assumptions: ["The P values are a complete, pre-specified family of tests.", "Family-wise methods (Bonferroni/Holm/Šídák) make no dependence assumption; Benjamini-Hochberg assumes independence or positive dependence, Benjamini-Yekutieli holds under any dependence."],
    warnings: ["Correcting a hand-picked or partial stack biases the result — include every test in the family.", "A larger family makes each individual test harder to call significant; that is the intended cost of controlling error."],
    alternatives: ["Built-in post-hoc corrections inside ANOVA / survival / contingency analyses", "Pre-registering fewer primary endpoints to reduce the multiplicity burden"],
  },
  ttest: {
    definition: "t = (estimated mean difference − null difference) / standard error",
    explain: "t-based and rank-based two-group workflows compare one or two groups while reporting effect estimates and uncertainty.",
    whenToUse: "When the outcome and grouping/paired structure are explicit and the target question is a two-group difference.",
    whenNotToUse: "More than two independent groups, repeated observations without a pairing identifier, or a relationship/prediction question.",
    assumptions: ["The observations used by the chosen variant match its independent or paired design.", "The outcome scale supports a mean or rank comparison."],
    warnings: ["Pairing must be real row-level or subject-level alignment; do not choose Paired from a visual layout alone."],
    alternatives: ["Welch for unequal variances", "Mann–Whitney or Wilcoxon for rank-based inference", "Descriptive effect sizes and confidence intervals"],
  },
  equivalence: {
    definition: "Two one-sided tests against ±Δ; p_TOST = max(p₁, p₂)",
    explain: "Equivalence testing asks whether a difference is small enough to be unimportant, rather than whether it is non-zero. The two questions are independent: a difference can be statistically significant and still practically equivalent, or non-significant and simply inconclusive.",
    whenToUse: "When the claim you want to support is that two groups do not differ meaningfully, with a bound you can defend.",
    whenNotToUse: "As a rescue for a non-significant t test. If the bound is chosen after seeing the data, the result means nothing.",
    assumptions: ["The equivalence bound was chosen on scientific grounds, before analysis.", "The same distributional assumptions as the corresponding t test."],
    warnings: [
      "Failing both tests is an inconclusive result, not evidence of equivalence — it means the data cannot rule out a difference larger than the bound.",
      "A non-significant difference test is never by itself evidence that two groups are the same.",
    ],
    alternatives: ["A confidence interval read against the bound (the same decision, shown directly)", "Bayes factors for evidence in favour of the null"],
  },
  bayesfactor: {
    definition: "BF₁₀ = marginal likelihood under H₁ / marginal likelihood under H₀",
    explain: "A continuous measure of relative evidence for two hypotheses, which can favour either one. Uses the JZS default: a Cauchy prior on the standardized effect size.",
    whenToUse: "Quantifying evidence for a null, or reporting how strongly the data favour one hypothesis over the other without a threshold.",
    whenNotToUse: "When no prior on the effect size is defensible, or when error-rate control is the actual requirement.",
    assumptions: ["The alternative is the specified Cauchy(0, r) prior on effect size — the factor is relative to that alternative.", "The same normality and independence assumptions as the corresponding t test."],
    warnings: [
      "A Bayes factor is evidence, not a decision. The anecdotal / moderate / strong labels are descriptive conventions, not cutoffs, and there is no Bayesian equivalent of p < 0.05.",
      "The result depends on the prior scale. All three conventional scales are reported; if they disagree, the conclusion is prior-sensitive and should be stated as such.",
      "A factor near 1 means the data barely distinguish the hypotheses — that is uninformative data, not evidence of no effect.",
    ],
    alternatives: ["Equivalence testing (TOST) for a bounded 'no meaningful difference' claim", "A t test when a frequentist p-value is what is expected"],
  },
  permutation: {
    definition: "p = proportion of rearrangements at least as extreme as the observed one",
    explain: "A distribution-free p-value constructed by rearranging the data the way the null hypothesis says is irrelevant. Assumes exchangeability and nothing else about distributional shape.",
    whenToUse: "Small or non-normal samples, or when you want a p-value that does not lean on a parametric approximation.",
    whenNotToUse: "When the observations are not exchangeable under the null — the rearrangement has to be one the null actually licenses.",
    assumptions: ["Observations are exchangeable under the null hypothesis.", "The rearrangement matches the design (labels for independent groups, signs for paired data)."],
    warnings: [
      "A Monte Carlo p-value is an estimate: report the seed and the resample count with it, and remember that no run can report a p smaller than 1/(resamples + 1).",
      "Exchangeability is the whole assumption. Trends over time, clustering, or nested structure break it, and no amount of resampling repairs that.",
    ],
    alternatives: ["A t test when its assumptions genuinely hold (it is more powerful)", "Rank-based tests such as Mann-Whitney or Wilcoxon"],
  },
  anova: {
    definition: "F = mean square for the tested effect / mean square for its error term",
    explain: "One-way group comparisons test whether three or more group means or distributions differ, followed by an appropriate multiplicity-controlled comparison.",
    whenToUse: "Three or more independent groups with a defined outcome and group structure.",
    whenNotToUse: "Paired/repeated observations without a supported repeated-measures structure, or a single two-group comparison where a t workflow is clearer.",
    assumptions: ["Observations are independent between experimental units.", "The selected variant's variance and distribution assumptions are considered."],
    warnings: ["A significant omnibus result does not identify which groups differ; post-hoc choices and multiplicity matter."],
    alternatives: ["Welch or Brown–Forsythe for variance imbalance", "Kruskal–Wallis for rank-based inference", "Repeated-measures ANOVA/Friedman when pairing is explicit"],
  },
  correlation: {
    definition: "r = standardized association between paired X and Y values",
    explain: "Correlation quantifies association, not agreement, causation, or a prediction equation.",
    whenToUse: "When the scientific question is whether two measured variables move together.",
    whenNotToUse: "For calibration, method agreement, causal claims, or strongly curved/non-monotonic relationships.",
    assumptions: ["X/Y pairs are correctly aligned.", "Pearson requires a meaningful linear association; Spearman targets monotonic association."],
    warnings: ["A high correlation can coexist with systematic bias or poor agreement."],
    alternatives: ["Regression for prediction or calibration", "Bland–Altman for agreement", "Deming/Passing–Bablok for method comparison"],
  },
  regression: {
    definition: "y = β₀ + β₁x + ε; estimate coefficients by minimizing residual error",
    explain: "Regression estimates a relationship for prediction, calibration, or adjusted effect interpretation.",
    whenToUse: "When one variable is an outcome and the other is a predictor with a directional scientific role.",
    whenNotToUse: "When both methods have comparable measurement error and agreement is the goal, or when a nonlinear model is required.",
    assumptions: ["Rows are paired correctly.", "Residual structure, leverage, and variance are checked rather than inferred from R² alone."],
    warnings: ["Do not interpret association as causation; extrapolation beyond observed X is risky."],
    alternatives: ["Correlation for symmetric association", "Deming or Passing–Bablok for method comparison", "Curve fitting for a mechanistic nonlinear shape"],
  },
  contingency: {
    definition: "χ² = Σ (O − E)²/E; exact alternatives use the observed 2×2 margins",
    explain: "Contingency analyses compare categorical counts across independent or explicitly paired observations.",
    whenToUse: "When rows/columns are category counts and the sampling/design relationship is known.",
    whenNotToUse: "Continuous outcomes, parts-of-whole data with no second categorical variable, or paired data treated as independent.",
    assumptions: ["Counts are correctly tabulated.", "Expected-count checks support the selected approximation."],
    warnings: ["Sparse expected counts require exact or simulated alternatives; pairing requires McNemar rather than ordinary chi-square."],
    alternatives: ["Fisher exact for sparse 2×2 tables", "McNemar for paired binary outcomes", "Goodness-of-fit for one categorical variable versus expected proportions"],
  },
  goodnessoffit: {
    definition: "χ² = Σ (Oᵢ − Eᵢ)²/Eᵢ",
    explain: "Goodness-of-fit compares one set of category counts with specified expected proportions.",
    whenToUse: "Parts-of-whole or categorical counts with a pre-specified expected distribution.",
    whenNotToUse: "Comparing two categorical variables; use a contingency analysis for that question.",
    assumptions: ["Expected proportions are specified independently of the observed counts."],
    warnings: ["Small expected counts weaken the chi-square approximation; use an exact alternative where available."],
    alternatives: ["Exact binomial for two categories", "Contingency table for association between two categorical variables"],
  },
  survival: {
    definition: "Ŝ(t) = product over event times of (1 − events / individuals at risk)",
    explain: "Survival analysis estimates time-to-event distributions while retaining right-censored observations.",
    whenToUse: "When each observation has a follow-up time and a clearly coded event/censor status.",
    whenNotToUse: "A binary endpoint with no meaningful follow-up time, or when censoring is handled as an ordinary zero.",
    assumptions: ["Censoring is interpreted correctly and is independent of the future event time conditional on the design."],
    warnings: ["Do not mix time units or encode events and censoring inconsistently."],
    alternatives: ["Cox regression when covariates are needed", "Log-rank comparison for independent survival curves"],
  },
  cox: {
    definition: "h(t|x) = h₀(t) exp(βᵀx)",
    explain: "Cox regression relates time-to-event outcomes to covariates through hazard ratios.",
    whenToUse: "Time/event data with explicit covariates and a question about adjusted relative event risk.",
    whenNotToUse: "No follow-up time, no covariates, or clear violation of proportional hazards without a planned extension.",
    assumptions: ["The proportional-hazards interpretation is appropriate or checked.", "Time and event columns are correctly identified."],
    warnings: ["A hazard ratio is not a risk ratio; proportional hazards and censoring diagnostics are essential."],
    alternatives: ["Kaplan–Meier/log-rank for unadjusted curves", "Parametric survival models when a time-distribution model is justified"],
  },
  corrmatrix: {
    definition: "Rᵢⱼ = corr(variableᵢ, variableⱼ)",
    explain: "A correlation matrix is an exploratory scan of pairwise relationships among several variables.",
    whenToUse: "Before modelling or dimension reduction when many numeric measures may be redundant or related.",
    whenNotToUse: "As confirmation of one pre-specified hypothesis without multiplicity control.",
    assumptions: ["Variables are numeric and rows are aligned across columns."],
    warnings: ["Pairwise missingness can give different n per cell; inspect multiplicity and missingness."],
    alternatives: ["PCA for lower-dimensional structure", "Multiple regression for an explicit outcome"],
  },
  pca: {
    definition: "Find directions w maximizing variance subject to ||w|| = 1",
    explain: "Principal component analysis rotates many variables into orthogonal components ordered by explained variance.",
    whenToUse: "Exploring multivariable structure, redundancy, and dominant axes when no single outcome is required.",
    whenNotToUse: "Confirming a causal or supervised hypothesis, or when components must have pre-specified meanings.",
    assumptions: ["Rows represent comparable cases and numeric variables are on an intentional scale."],
    warnings: ["Scaling changes the result; component labels are descriptive, not automatically biological factors."],
    alternatives: ["Correlation matrix for direct pairwise inspection", "Clustering for grouping cases", "Regression for a defined outcome"],
  },
  rda: {
    definition: "Force the ordination axes to be linear combinations of the explanatory variables",
    explain: "Redundancy analysis is the constrained ordination — 'direct gradient analysis'. It fits the response variables on the explanatory ones and ordinates what the fit explains, so the axes answer what those variables account for rather than what the response does on its own. The rest is reported as the unconstrained remainder.",
    whenToUse: "When you measured explanatory variables and want to know how much of the response they explain, and which of them carry it.",
    whenNotToUse: "Exploring the response's own structure (use PCA or an unconstrained ordination), or when the explanatory variables outnumber the cases.",
    assumptions: ["A linear response to the explanatory variables; a species matrix usually needs the Hellinger transformation first.", "Significance is by permutation, so the cases must be exchangeable under the null."],
    warnings: ["R² rises with every variable added — report the adjusted R².", "Each term is tested when entered last, so two collinear variables can both look unimportant."],
    alternatives: ["CCA when the response is counts with unimodal responses", "db-RDA to constrain any distance", "Unconstrained ordination + fitting the variables afterwards"],
  },
  cca: {
    definition: "Constrain a correspondence analysis by the explanatory variables",
    explain: "Canonical correspondence analysis is CA's constrained form: the axes are forced to be linear combinations of the explanatory variables, in the chi-square geometry CA works in. Sites carry their row masses, so a case with more counts weighs more — that is what separates it from an RDA on transformed data. It is the standard direct gradient analysis for count data with unimodal responses.",
    whenToUse: "Species or category counts per case, with measured explanatory variables, when the response rises and falls along a gradient rather than tracking it linearly.",
    whenNotToUse: "Measurements on different scales or with negative values (use RDA), short gradients where the response really is linear (RDA on Hellinger-transformed data), or fewer cases than explanatory columns.",
    assumptions: ["Non-negative counts on one common scale; every case and every variable needs at least one non-zero count.", "Unimodal responses along the gradient.", "Significance is by permutation, so the cases must be exchangeable under the null."],
    warnings: ["A site with more counts weighs more — a very uneven sampling effort quietly becomes a weighting.", "R² rises with every variable added; report the adjusted R².", "The arch (horseshoe) effect can still appear on a long single gradient."],
    alternatives: ["RDA on Hellinger-transformed data for a short gradient", "db-RDA to constrain a Bray-Curtis distance", "CA when there is nothing to constrain by"],
  },
  dbrda: {
    definition: "Constrain any dissimilarity by the explanatory variables",
    explain: "Distance-based RDA turns the dissimilarity you chose — Bray-Curtis, Jaccard, anything — into coordinates first (that is a PCoA), then runs redundancy analysis on those. It is the way to constrain a distance that is not Euclidean, which is the usual case for community data. On Euclidean distances it reproduces RDA exactly.",
    whenToUse: "When the distance that matters is not Euclidean and you have explanatory variables to test against it.",
    whenNotToUse: "When a Euclidean geometry is right (use RDA, which is the same answer more directly), or when the variables themselves — not the distances — are the subject.",
    assumptions: ["The chosen dissimilarity is the one the question is about; the result changes with it.", "Significance is by permutation, so the cases must be exchangeable under the null."],
    warnings: ["A non-Euclidean dissimilarity produces negative eigenvalues; those axes cannot be represented and are dropped before the regression, and the count is reported.", "The variables are placed by weighted averaging — positions, not loadings, so there are no variable arrows.", "R² rises with every variable added; report the adjusted R²."],
    alternatives: ["RDA when Euclidean geometry is right", "CCA for counts with unimodal responses", "PERMANOVA to test whether groups of cases differ on the same distance"],
  },
  permanova: {
    definition: "Test whether groups of cases differ, on any distance",
    explain: "PERMANOVA asks whether the groups sit in different places in multivariate space, judged on the dissimilarity you chose. Its pseudo-F compares distances between groups with distances within them, and its p comes from shuffling the group labels, so no normal distribution is assumed. PERMDISP is reported beside it: PERMANOVA also reacts to groups that differ only in spread, and PERMDISP says whether they do.",
    whenToUse: "Groups of cases measured on many variables — the clusters you see on a PCA or PCoA map — when you want a p-value for whether those groups really differ.",
    whenNotToUse: "A single measured variable (use ANOVA), a question about which variables drive the difference (use RDA or db-RDA with the group as the explanatory variable), or paired / repeated designs, whose cases are not exchangeable.",
    assumptions: ["Cases are independent and exchangeable under the null hypothesis (the labels are permuted).", "The chosen distance is the one the question is about; the result changes with it."],
    warnings: ["A significant result with a significant PERMDISP may be a difference in spread, not in position.", "Unbalanced group sizes combined with unequal spread make the test too liberal or too conservative.", "With very small groups the number of distinct rearrangements is small, which limits the smallest p."],
    alternatives: ["ANOVA for one variable", "db-RDA with the group column as the explanatory variable", "PCoA or NMDS to look at the groups before testing them"],
  },
  varpart: {
    definition: "Split the explained variation between two or three blocks of explanatory variables",
    explain: "Climate, soil and space each look important on their own because they overlap. Variance partitioning runs redundancy analysis on every combination of the blocks and takes the differences, so the variation splits into what is unique to each block, what they share, and what nothing explains. Every fraction is an adjusted R², because a raw one would reward the widest block.",
    whenToUse: "Two or three sets of explanatory variables that plausibly overlap, when the question is which of them carries the signal.",
    whenNotToUse: "A single set of explanatory variables (that is an ordinary RDA), or when the blocks are so collinear that the unique fractions are all near zero.",
    assumptions: ["A column belongs to exactly one block — a column counted twice is shared with itself.", "Linear (RDA) geometry; a species matrix usually wants the Hellinger transformation first.", "The unique fractions are tested by permutation, so the cases must be exchangeable under the null."],
    warnings: ["A shared fraction has no test and gets no p-value: it is a difference between two models, not the fit of one.", "A shared fraction can be negative. That is a real result — the blocks together explain less than the sum of their separate explanations — not an error to hide.", "Adjusted R² is what makes the fractions comparable, and it is not defined for correspondence analysis, so this is not offered there."],
    alternatives: ["RDA with all the variables in one block", "Partial RDA to test one block with another held constant", "Model selection if the question is which single variables matter"],
  },
  ca: {
    definition: "Decompose the chi-square distances between the rows' profiles (and the columns')",
    explain: "Correspondence analysis puts the cases and the variables on the same axes, so a site sits near the species it is relatively rich in. It reads counts, and assumes species rise and fall along a gradient rather than tracking it linearly — which is what an abundance table usually shows and what PCA gets wrong.",
    whenToUse: "Counts of categories or species per case, when you want the two families read together in one picture.",
    whenNotToUse: "Measurements on different scales, negative values, or data where a linear response is right (use PCA).",
    assumptions: ["Non-negative counts on one common scale; every case and every variable must have at least one non-zero count."],
    warnings: ["A strong single gradient produces the arch (horseshoe) effect: axis 2 is then a curved artefact of axis 1, not a second gradient.", "The scaling chosen decides whose distances the picture preserves — sites', species', or a compromise."],
    alternatives: ["Detrended CA when the arch dominates (not offered here)", "NMDS on a Bray-Curtis distance", "PCA on Hellinger-transformed data"],
  },
  pcoa: {
    definition: "Place the cases so their Euclidean distances match a chosen dissimilarity",
    explain: "Principal coordinates analysis maps a distance matrix: it double-centres the squared dissimilarities and decomposes them, so any distance — Bray-Curtis, Jaccard, Manhattan — can be drawn, not only the Euclidean one PCA is fixed to.",
    whenToUse: "Community / abundance data, presence-absence data, or anything where the meaningful distance is not Euclidean.",
    whenNotToUse: "Testing a hypothesis (there are no p-values), or when the variables themselves — not the distances — are the subject; use PCA for that.",
    assumptions: ["The chosen dissimilarity is the one that matches the question — the map is only as meaningful as the distance behind it."],
    warnings: ["A non-Euclidean dissimilarity produces negative eigenvalues: the axes are still the best fit, and a Cailliez or Lingoes correction removes them."],
    alternatives: ["NMDS when only the order of the dissimilarities is trustworthy", "PCA when Euclidean distance is right", "Clustering for discrete groups"],
  },
  nmds: {
    definition: "Arrange the cases so the order of the map distances matches the order of the dissimilarities",
    explain: "Non-metric multidimensional scaling uses ranks only, so it is unaffected by the shape of the dissimilarity scale. The mismatch between the two orders is Kruskal's stress; the fit is iterative and restarted from several starts because it can settle in a local minimum.",
    whenToUse: "Community ecology and any data where the dissimilarities are ordinal in spirit — the usual first choice for species counts with many zeros.",
    whenNotToUse: "When the distances themselves carry meaning you want preserved (use PCoA), or when a reproducible eigenvalue decomposition is required.",
    assumptions: ["Only the rank order of the dissimilarities is used, so the axes have no units and their scale is arbitrary."],
    warnings: ["Stress above ~0.2 means the layout is unreliable, and above 0.3 close to arbitrary (Clarke 1993).", "The solution can differ between runs; the seed and the number of starts are reported so a figure can be reproduced."],
    alternatives: ["PCoA when the distances should be preserved, not just their order", "PCA on Hellinger-transformed data", "Clustering for discrete groups"],
  },
  cluster: {
    definition: "Assign cases to groups that minimize within-cluster dissimilarity",
    explain: "Clustering is exploratory: it groups cases by profile similarity using the selected distance and algorithm.",
    whenToUse: "Discovering candidate subgroups when the number and meaning of clusters are open questions.",
    whenNotToUse: "Testing pre-defined group differences or claiming stable classes without validation.",
    assumptions: ["The distance metric and scaling reflect scientific similarity.", "The chosen k or hierarchy is assessed with diagnostics and domain knowledge."],
    warnings: ["Different scaling, seeds, metrics, or k values can change the partition."],
    alternatives: ["PCA for visualization", "ANOVA or regression when groups and outcomes are pre-defined"],
  },
  multifactor: {
    definition: "Y = μ + Σ main effects + Σ interactions + ε   (Type II SS)",
    explain:
      "Multifactor (N-way) ANOVA tests 2–4 crossed factors plus every interaction from long-format data — pick the numeric value column first, then the categorical factor columns. Type II sums of squares handle unbalanced designs and reduce to the classic two-way when the data are balanced.",
    whenToUse: "Three or more crossed factors, or two factors with an unbalanced number of observations per cell (where a balanced two-way would be biased).",
    whenNotToUse: "Repeated measures on a factor (use RM ANOVA), nested rather than crossed factors (use nested ANOVA), or a random-effects design (use a mixed model).",
    assumptions: ["Factors are crossed (every combination is observed), not nested.", "Residuals are approximately normal with similar variance across cells.", "Observations are independent."],
    warnings: ["Interpret a main effect cautiously when a strong interaction involving that factor is present.", "Sparse or empty cells can make some effects unestimable."],
    alternatives: ["Two-way ANOVA for a balanced two-factor design.", "Nested ANOVA for nested (not crossed) factors.", "Mixed-effects model for random factors or clustered data."],
  },
  twoway: {
    definition: "F_effect = MS_effect / MS_error",
    explain: "Two-way ANOVA separates effects of two factors and their interaction, with optional planned post-hoc comparisons.",
    whenToUse: "A factorial design with two categorical factors and an outcome measured on comparable experimental units.",
    whenNotToUse: "A single factor, nested or repeated observations without the appropriate structure, or when factors are not defined.",
    assumptions: ["Independent experimental units.", "Residuals and variance structure are reasonably compatible with the model.", "The factor coding reflects the intended design."],
    warnings: ["An interaction changes how main effects should be interpreted; inspect cell sizes and the interaction first."],
    alternatives: ["One-way ANOVA for one factor", "Mixed or repeated-measures models for clustered observations"],
  },
  rmanova: {
    definition: "F = MS_effect / MS_error with a within-subject covariance correction",
    explain: "Repeated-measures ANOVA compares conditions measured repeatedly on the same subjects while accounting for within-subject dependence.",
    whenToUse: "The same subjects or matched units are observed under three or more conditions with complete or supported repeated structure.",
    whenNotToUse: "Independent groups or repeated rows whose subject identity and condition alignment are unknown.",
    assumptions: ["Subject/condition alignment is explicit.", "Sphericity or its correction is considered."],
    warnings: ["Missing or misaligned repeated observations can invalidate the repeated-measures interpretation."],
    alternatives: ["Friedman for rank-based repeated measures", "Mixed-effects model for incomplete or hierarchical data"],
  },
  mixedanova: {
    definition: "F = MS_effect / MS_error, with the between-subjects effect tested against subjects within groups and the within-subjects effects against the residual",
    explain: "A mixed (split-plot) ANOVA compares groups of different subjects (between) that are each measured at the same time points (within), and asks whether the groups differ, the time points differ, and whether the groups change differently over time.",
    whenToUse: "Two or more groups of subjects, each subject measured at every one of two or more time points — e.g. treatment groups followed over time.",
    whenNotToUse: "Every subject seen in every combination of both factors (both factors within), independent observations at each time point, or subjects missing time points you cannot leave out.",
    assumptions: ["Each subject is one replicate subcolumn, measured down the same rows.", "Sphericity, or its Greenhouse-Geisser correction.", "Normal residuals and equal covariance across groups."],
    warnings: ["A subject with any missing time point is left out.", "With unequal group sizes the time effect uses Type III sums of squares (the unweighted mean of the group means)."],
    alternatives: ["Mixed-effects model when time points are missing", "Two-way ANOVA when each time point has different subjects"],
  },
  mixedmodel: {
    definition: "y = fixed effects + random effects + residual error",
    explain: "Mixed-effects models separate fixed effects of interest from random variation attributable to subjects, groups, or other clusters.",
    whenToUse: "Measurements are clustered, nested, or repeated and a random-effect structure is scientifically identifiable.",
    whenNotToUse: "Independent observations with no meaningful grouping variable or when the random structure is guessed from column order.",
    assumptions: ["The outcome and grouping columns are correctly assigned.", "The random-effect structure is supported by the design and enough clusters."],
    warnings: ["Few clusters can make variance components unstable; report the grouping structure and convergence diagnostics."],
    alternatives: ["Repeated-measures ANOVA for a complete simple design", "Nested ANOVA when the hierarchy is strictly nested"],
  },
  nested: {
    definition: "F_groups = MS_groups / MS_subgroups",
    explain: "Nested ANOVA uses subgroups as the error term when observations are organised inside higher-level groups.",
    whenToUse: "Subjects or subgroups are sampled within treatment groups and are the true experimental units.",
    whenNotToUse: "Repeated measurements with crossed factors or data with no defensible subgroup identifier.",
    assumptions: ["Subgroups are genuinely nested and independent at the appropriate level."],
    warnings: ["Treating repeated readings as independent inflates apparent replication."],
    alternatives: ["Mixed-effects model for richer random structures", "One-way ANOVA for a single independent level"],
  },
  deming: {
    definition: "Estimate a line while allowing measurement error in both X and Y",
    explain: "Deming regression is a method-comparison regression that accounts for error in both measurements.",
    whenToUse: "Two assays or instruments measure the same samples and neither axis is error-free.",
    whenNotToUse: "Prediction from a controlled error-free predictor or when agreement is assessed only by correlation.",
    assumptions: ["Pairs represent the same samples.", "The error-variance ratio is known or reasonably specified.", "The relationship is approximately linear."],
    warnings: ["Slope/intercept agreement must be interpreted with confidence intervals and a Bland–Altman view."],
    alternatives: ["Passing–Bablok for robust nonparametric comparison", "Bland–Altman for interchangeability"],
  },
  passingbablok: {
    definition: "slope = median of pairwise slopes; intercept = median(y − slope·x)",
    explain: "Passing–Bablok estimates a robust linear relationship when both methods have error and outliers are a concern.",
    whenToUse: "Linear method comparison with non-normal data or potential outliers.",
    whenNotToUse: "Prediction with an error-free X or a markedly nonlinear relationship.",
    assumptions: ["Pairs are matched samples.", "The relationship is approximately linear over the observed range."],
    warnings: ["Agreement requires checking slope against 1 and intercept against 0 with uncertainty, not just visual fit."],
    alternatives: ["Deming regression", "Bland–Altman agreement analysis"],
  },
  blandaltman: {
    definition: "bias = mean(A − B); limits = bias ± k·SD(A − B)",
    explain: "Bland–Altman evaluates whether two measurement methods agree closely enough to be interchangeable.",
    whenToUse: "Paired measurements of the same samples where bias and limits of agreement are the estimands.",
    whenNotToUse: "A calibration equation, prediction problem, or ordinary association question.",
    assumptions: ["Each pair is correctly aligned.", "The acceptable difference is defined scientifically."],
    warnings: ["Correlation is not an agreement analysis; inspect proportional bias and the width of the limits."],
    alternatives: ["Deming or Passing–Bablok for comparison regression", "Correlation for association only"],
  },
  ancova: {
    definition: "F_slope compares common versus separate slopes; elevation is tested only when slopes are compatible",
    explain: "ANCOVA compares linear relationships across groups while adjusting the group comparison for a continuous covariate.",
    whenToUse: "Groups share a continuous predictor/outcome relationship and the question concerns slope or adjusted elevation differences.",
    whenNotToUse: "Curved relationships, nonparallel slopes interpreted as adjusted means, or absent group/covariate roles.",
    assumptions: ["Linearity and comparable residual variance.", "The covariate is measured before the outcome and is not a post-treatment mediator."],
    warnings: ["Do not interpret adjusted group differences when the slope interaction is important."],
    alternatives: ["Regression with an interaction term", "Mixed model for clustered observations"],
  },
  roc: {
    definition: "ROC plots sensitivity against 1 − specificity over all score thresholds",
    explain: "ROC analysis evaluates how well a continuous marker discriminates two known outcome classes.",
    whenToUse: "A continuous score and a clearly defined binary reference outcome are available.",
    whenNotToUse: "Uncertain class labels, multiclass outcomes without a defined one-vs-rest plan, or a continuous prediction target.",
    assumptions: ["Positive and negative classes are correctly coded.", "The evaluation sample and threshold goal are clearly defined."],
    warnings: ["AUC does not establish calibration, prevalence-adjusted clinical utility, or causal value."],
    alternatives: ["AUC summary for discrimination", "Logistic regression for adjusted classification"],
  },
  auc: {
    definition: "AUC = Σ ½(yᵢ + yᵢ₊₁ − 2·baseline)·Δx",
    explain: "AUC integrates an XY curve relative to a selected baseline and reports the resulting area.",
    whenToUse: "Exposure, response, or peak-area summaries where integration over X is scientifically meaningful.",
    whenNotToUse: "Comparing methods or groups without carrying the per-curve areas into a separate inferential analysis.",
    assumptions: ["X is ordered and its units support integration.", "The baseline is scientifically justified."],
    warnings: ["AUC is descriptive; uncertainty and group comparisons require a follow-up analysis of per-curve AUCs."],
    alternatives: ["Curve transformation for derivatives/integrals as a generated curve", "Regression or curve fitting for a mechanistic model"],
  },
  curvetransform: {
    definition: "Y′ = smooth(Y), dY/dX, d²Y/dX², or cumulative ∫Y·dX",
    explain: "Curve transformations create a smoothed, differentiated, or integrated curve for diagnostics and downstream analysis.",
    whenToUse: "When rate, inflection, cumulative exposure, or noise-reduced shape is the target.",
    whenNotToUse: "As a substitute for a fitted mechanistic model or when smoothing would erase scientifically important features.",
    assumptions: ["X is ordered with suitable spacing.", "The smoothing window and numerical approximation are appropriate."],
    warnings: ["Derivatives amplify noise and smoothing changes the result; inspect the generated curve."],
    alternatives: ["Curve fit for a parametric model", "LOWESS/spline for exploratory shape inspection"],
  },
  interpolate: {
    definition: "Solve y = f(x; θ̂) for an unknown x or predict y from a fitted standard curve",
    explain: "Interpolation fits a calibration or standard curve and reads unknown values within the observed standards.",
    whenToUse: "Complete standards plus unknown rows with one measured coordinate missing.",
    whenNotToUse: "Non-monotonic curves with ambiguous inverse values or unknowns outside the calibrated range.",
    assumptions: ["The selected curve is appropriate and invertible over the target range.", "Standards and unknowns share units and processing."],
    warnings: ["Extrapolation beyond standards is flagged and should not be treated as validated interpolation."],
    alternatives: ["Curve fitting to inspect the standard relationship", "Descriptive QC for standards"],
  },
  globalfit: {
    definition: "Minimize pooled residual error across curves with shared and local parameters",
    explain: "Global fitting estimates shared parameters from related curves while retaining curve-specific parameters where justified.",
    whenToUse: "Several curves were collected under a common protocol and have parameters that are scientifically shared.",
    whenNotToUse: "Unrelated curves or a single curve with no defensible shared structure.",
    assumptions: ["Curves use compatible units and an aligned model family.", "Shared/local choices are specified from design knowledge."],
    warnings: ["Pooling can create precise but misleading estimates when the shared-parameter assumption is wrong."],
    alternatives: ["Single-curve fit", "Compare fits when the model family itself is uncertain"],
  },
  meltingtemp: {
    definition: "Tm = the midpoint of a two-state sigmoid fitted to the melt curve, and the temperature of its steepest point",
    explain: "Melting temperature analysis finds the temperature at which half of the sample has unfolded (or melted), for every replicate of every sample, and the shift of each sample's Tm from a control.",
    whenToUse: "Thermal melt curves — protein unfolding by fluorescence (thermal shift), CD or absorbance, and DNA/RNA melting — with temperature as X and one Y column per sample or replicate.",
    whenNotToUse: "Curves with more than one transition in the window, or data that never reach both plateaus.",
    assumptions: ["One two-state transition inside the temperature window.", "Both plateaus are sampled (flat, or drifting in a straight line with sloped baselines)."],
    warnings: ["A signal drop after the peak (aggregation in dye-based thermal shift) biases Tm — set the window's upper bound before the drop.", "Tm by derivative depends on the smoothing window on noisy curves."],
    alternatives: ["Double Boltzmann curve fit for two transitions", "Smooth / derivative transform to inspect the curve"],
  },
  comparefits: {
    definition: "AICc balances residual fit against parameter count; nested models may use an extra-sum-of-squares test",
    explain: "Model comparison evaluates competing equations fitted to the same data.",
    whenToUse: "Two plausible candidate models address the same curve and the comparison rule is chosen before inspecting the result.",
    whenNotToUse: "Different datasets, model-free smoothers with no comparable parameter count, or choosing solely by R².",
    assumptions: ["Models are fitted to the same observations and comparable error structure."],
    warnings: ["AICc and nested tests answer different questions; model plausibility and identifiability still matter."],
    alternatives: ["Diagnostics and residual inspection", "Global fit when curves share structure"],
  },
  curvefit: {
    definition: "Estimate parameters θ by minimizing Σ(yᵢ − f(xᵢ; θ))²",
    explain: "Curve fitting estimates a chosen nonlinear or exploratory relationship between X and Y.",
    whenToUse: "A scientific model or clearly stated exploratory shape connects an ordered predictor to a response.",
    whenNotToUse: "Too few points for the chosen parameters, unsupported extrapolation, or selecting a model only because it maximizes R².",
    assumptions: ["X/Y pairs are aligned.", "The chosen equation is identifiable over the observed range.", "Residuals and weighting are inspected."],
    warnings: ["Good fit statistics do not validate a model's biological meaning or out-of-range potency estimate."],
    alternatives: ["Linear regression for a straight-line question", "LOWESS/spline for exploratory shape checks", "Model comparison for competing equations"],
  },
  multipleregression: {
    definition: "y = β₀ + β₁x₁ + … + βₚxₚ + ε",
    explain: "Multiple regression estimates one continuous outcome from several predictors while holding the others fixed.",
    whenToUse: "A continuous outcome and explicit predictor roles are available with enough independent rows.",
    whenNotToUse: "Binary/count outcomes, too many predictors for the sample, or an outcome role inferred only from column order.",
    assumptions: ["Linearity, residual behavior, and predictor collinearity are assessed.", "Rows are independent or clustering is modeled."],
    warnings: ["Holding other predictors fixed is an adjusted association, not automatically a causal effect."],
    alternatives: ["Logistic regression for binary outcomes", "Poisson regression for counts", "PCA for outcome-free exploration"],
  },
  logistic: {
    definition: "logit(p) = β₀ + βᵀx; odds ratio = exp(β)",
    explain: "Logistic regression models a binary outcome and reports predictor effects as odds ratios.",
    whenToUse: "A clearly coded yes/no outcome and one or more predictors are available.",
    whenNotToUse: "Continuous or count outcomes, multiclass outcomes without a planned extension, or complete separation.",
    assumptions: ["Rows are independent or clustered structure is modeled.", "The log-odds relationship is appropriate for continuous predictors."],
    warnings: ["Odds ratios are not risk ratios; sparse events and separation can destabilize estimates."],
    alternatives: ["Multiple regression for continuous outcomes", "Poisson regression for counts"],
  },
  poisson: {
    definition: "log(E[Y]) = β₀ + βᵀx; rate ratio = exp(β)",
    explain: "Poisson regression models event counts or rates from predictors.",
    whenToUse: "Nonnegative integer counts with an explicit outcome and predictor roles.",
    whenNotToUse: "Continuous, binary, or severely overdispersed outcomes without an appropriate count model.",
    assumptions: ["The mean-variance and exposure structure are appropriate or checked.", "Rows and offsets are correctly represented."],
    warnings: ["Overdispersion can make Poisson uncertainty too small; inspect the dispersion diagnostic."],
    alternatives: ["Logistic regression for binary outcomes", "Negative-binomial or robust count modelling (not offered here)"],
  },
};
export const METHOD_INFO: Record<string, MethodInfo> = {
  metaanalysis: {
    equation: "ŷ = Σwᵢyᵢ / Σwᵢ,    wᵢ = 1/SEᵢ²    ·    τ² = max(0, (Q − df)/C)   (DerSimonian-Laird)",
    explain:
      "Pools one effect estimate per study (entered with its confidence limits) into a single overall effect. Each study's SE is back-calculated from its CI; fixed-effect and DerSimonian-Laird random-effects results are reported side by side, with heterogeneity (Cochran's Q, τ², I²) and every study's weight under both models. Ratio measures (OR/RR/HR) pool in log space.",
    whenToUse: "Combining published or per-experiment estimates — a Study · Estimate · Lower · Upper sheet — into a pooled effect with heterogeneity; the numbers behind the forest and funnel plots.",
    whenNotToUse: "Raw per-subject data (analyse each study first), or estimates whose CIs are not inverse-variance based — the back-calculated weights would be wrong.",
  },
  publicationbias: {
    equation: "Egger: yᵢ/SEᵢ = β₀ + β₁·(1/SEᵢ)    ·    trim-and-fill: L0 = (4Tₙ − k(k+1)) / (2k − 1)",
    explain:
      "Assesses publication bias on a meta-analysis sheet. Egger's regression tests whether small (imprecise) studies report systematically different effects — the intercept of standardized effect on precision, with a t test at df = k − 2. Duval-Tweedie trim-and-fill estimates how many extreme small studies the lopsided funnel is missing (L0), mirrors them about the trimmed centre, and reports the re-pooled effect (fixed and random) with the imputed studies listed. Ratio measures are assessed in log space.",
    whenToUse: "Judging whether a pooled effect could be an artefact of missing small studies — the Egger p and adjusted estimate papers quote next to a funnel plot.",
    whenNotToUse: "As a correction: the adjusted estimate is a sensitivity answer. Both tests are weak below ~10 studies (they run from 3).",
  },
  describe: {
    equation: "x̄ = (Σxᵢ)/n    ·    s = √[ Σ(xᵢ − x̄)² / (n − 1) ]",
    explain:
      "Summarises one group of numbers: its centre (mean, median, geometric/harmonic/quadratic means), spread (SD, variance, SEM, range, IQR, %CV), shape (skewness, excess kurtosis), and the t-based 95% confidence interval of the mean. No hypothesis is tested.",
    whenToUse: "Characterising a single sample — its centre, spread, and the precision of its mean — before testing, or to report summary statistics.",
    whenNotToUse: "Comparing groups or testing a hypothesis — descriptives report no p-value; use a t test, ANOVA, or correlation instead.",
  },
  normality: {
    equation: "W = (Σ aᵢ x₍ᵢ₎)² / Σ(xᵢ − x̄)²    (Shapiro-Wilk)",
    explain:
      "Asks whether one group plausibly comes from a normal (Gaussian) distribution, running four tests at once — Shapiro-Wilk, D'Agostino-Pearson, Anderson-Darling, and Kolmogorov-Smirnov/Lilliefors. A small p (< 0.05) means the values depart from normality, hinting that a nonparametric or transformed analysis may be safer.",
    whenToUse: "Checking the normality assumption behind a t test, ANOVA, or regression — ideally read alongside a histogram or QQ plot.",
    whenNotToUse: "As the sole basis for picking a test: power is poor at small n and trivial deviations are flagged at large n; skip it below n ≈ 7.",
  },
  ttest: {
    equation: "t = (x̄₁ − x̄₂) / SE,    SE = sₚ·√(1/n₁ + 1/n₂)",
    explain:
      "Compares the means of two groups (or one group against a hypothetical value) and asks whether the difference exceeds chance. Student's assumes equal variances, Welch's does not, and paired compares matched observations. Mann-Whitney and Wilcoxon are the rank-based nonparametric alternatives.",
    whenToUse: "Comparing the means of exactly two groups (unpaired), matched pairs (paired), or one group against a known value (one-sample).",
    whenNotToUse: "Three or more groups — repeated two-group t tests inflate the false-positive rate; use one-way ANOVA instead.",
  },
  equivalence: {
    equation: "p_TOST = max(p₁, p₂),   reject both  ⟺  the (1 − 2α) CI lies inside [−Δ, +Δ]",
    explain:
      "Tests whether two groups are close enough to be treated as the same. A non-significant t test does not show that — it shows the data could not tell them apart, which is a much weaker claim. TOST runs two one-sided tests against an equivalence bound Δ you choose, and concludes equivalence only when both reject, i.e. when the whole 90% confidence interval sits inside ±Δ.",
    whenToUse: "When your scientific claim is 'no meaningful difference' — method agreement, non-inferiority, showing a change did not break something, or backing up a null result.",
    whenNotToUse: "When you have no defensible bound. Δ is the smallest difference that would matter and must be justified before seeing the data; picking it afterwards to get equivalence is circular.",
  },
  bayesfactor: {
    equation: "BF₁₀ = P(data | H₁) / P(data | H₀),   δ ~ Cauchy(0, r)",
    explain:
      "Weighs the two hypotheses against each other instead of only trying to reject one. BF₁₀ = 3 means the data are three times more likely if there is an effect; BF₁₀ = ⅓ means three times more likely if there is none. Unlike a p-value it can therefore support a null, and it does not need a significance threshold. The alternative has to be made concrete first — as a Cauchy prior on the effect size — so the answer depends on that prior, and all three conventional scales are reported together as a sensitivity check.",
    whenToUse: "When you want to quantify evidence for no effect, or report continuous evidence rather than a reject/don't-reject verdict.",
    whenNotToUse: "When you cannot justify any prior on the effect size, or when a decision rule with controlled error rates is what is actually required.",
  },
  permutation: {
    equation: "p = (# rearrangements at least as extreme) / (total),  the observed one included",
    explain:
      "Builds the null distribution from your own data instead of assuming one. Whatever the null hypothesis says is irrelevant — the group labels, the sign of each difference, the pairing — is rearranged thousands of times, recomputing the statistic each time; the p-value is how often chance alone produced something as extreme. Nothing is assumed about the shape of the distribution. When every rearrangement can be enumerated the p-value is exact; otherwise it is sampled from a seeded generator and reported as an estimate.",
    whenToUse: "Small samples, obviously non-normal data, or any statistic with no clean sampling theory — and whenever you would rather assume less.",
    whenNotToUse: "When observations are not exchangeable under the null (strong time trends, clustered or nested data) — then the rearrangement itself is invalid.",
  },
  anova: {
    equation: "F = MS_between / MS_within",
    explain:
      "One-way ANOVA compares the means of three or more groups across a single factor. A significant F means at least one group differs; a post-hoc test (Tukey all-pairs, or Dunnett/Bonferroni/Šídák/Holm-Šídák, vs a control or across all pairs) then identifies which. Kruskal-Wallis is the rank-based nonparametric version.",
    whenToUse: "Comparing the means of three or more independent groups defined by one factor, then locating the differing pairs with a post-hoc test.",
    whenNotToUse: "Two factors at once (use two-way ANOVA) or repeated measurements on the same subjects (use repeated-measures ANOVA).",
  },
  twoway: {
    equation: "Yᵢⱼₖ = μ + αᵢ + βⱼ + (αβ)ᵢⱼ + εᵢⱼₖ",
    explain:
      "Two-way ANOVA tests two factors at once (e.g. treatment × time) plus their interaction — whether one factor's effect depends on the other. It needs a balanced design (equal replicates per cell). Each main effect and the interaction get their own F and p.",
    whenToUse: "Two independent (crossed) factors when you also want their interaction, with a balanced number of replicates in every cell.",
    whenNotToUse: "Unbalanced cells or repeated measures on a factor — the balanced model's F-tests would be biased.",
  },
  multifactor: {
    equation: "Y = μ + Σ main effects + Σ interactions + ε   (Type II SS)",
    explain:
      "Multifactor (N-way) ANOVA tests 2–4 crossed factors at once plus every interaction, from long-format data: pick the numeric value column first, then the categorical factor columns. Uses Type II sums of squares, so it handles unbalanced designs (and equals the classic two-way when the data are balanced). Each main effect and interaction gets its own F and p.",
    whenToUse: "Three or more crossed factors, or two factors with an unbalanced number of observations per cell (where the balanced two-way would be biased).",
    whenNotToUse: "Repeated measures on a factor (use RM ANOVA), nested rather than crossed factors (use nested ANOVA), or a random-effects design (needs a mixed model).",
  },
  mixedmodel: {
    equation: "y = Xβ (fixed) + Zu (random) + ε,   u ~ N(0, σ²_group),  ε ~ N(0, σ²_resid)",
    explain:
      "A linear mixed-effects model separates fixed effects (the factors you care about) from a random effect — a random intercept for each level of a grouping factor (subject, batch, site…), which absorbs the correlation between observations that share a group. Fit by REML, it reports the fixed-effect coefficients, the group and residual variance components, and the ICC (the fraction of variance between groups). For a balanced one-way random design its variance components equal the classic ANOVA estimates.",
    whenToUse: "Clustered / hierarchical data — repeated measures per subject, samples within batches, sites in a multi-centre study — where observations in a group are correlated, or the grouping levels are a random sample.",
    whenNotToUse: "A small number of groups (variance components are then poorly estimated), or purely fixed crossed factors with no clustering (use multifactor ANOVA).",
  },
  rmanova: {
    equation: "F = MS_condition / MS_(condition × subject)",
    explain:
      "Repeated-measures ANOVA compares three or more conditions measured on the same subjects, removing between-subject variation for extra power. Use it for within-subject designs (e.g. each patient at several timepoints). The Greenhouse-Geisser correction guards against sphericity violations.",
    whenToUse: "Three or more conditions measured on the same subjects (longitudinal / within-subject), to gain power by removing between-subject variation.",
    whenNotToUse: "Independent groups (use one-way ANOVA), or subjects with a missing condition — only complete cases are analysed.",
  },
  mixedanova: {
    equation: "F_groups = MS_groups / MS_subjects(groups);  F_time = MS_time / MS_residual;  F_groups×time = MS_groups×time / MS_residual",
    explain:
      "A mixed (split-plot) ANOVA tests one factor between subjects (the groups) and one within them (the repeated time points), plus their interaction: do the groups change differently over time? The groups are tested against the variation between subjects, the time effects against the variation within subjects, and the Greenhouse-Geisser correction guards the within-subject tests against unequal variances of the differences between time points.",
    whenToUse: "Groups of different subjects, each subject measured at every time point — e.g. treated and control animals weighed every week. Lay it out as a Grouped sheet: one dataset per group, one subcolumn per subject, one row per time point.",
    whenNotToUse: "Different subjects at each time point (use two-way ANOVA), every subject in both factors' combinations, or many missing time points (use a mixed-effects model — a subject missing a time point is left out here).",
  },
  contingency: {
    equation: "χ² = Σ (Oᵢⱼ − Eᵢⱼ)² / Eᵢⱼ",
    explain:
      "Tests whether two categorical variables are associated by comparing observed counts with those expected under independence. For a 2×2 table it also reports the clinical toolkit — relative risk and odds ratio with CIs, risk difference and NNT, and sensitivity/specificity/PPV/NPV with Wilson CIs — plus Yates' correction and Fisher's exact; ordered 2×k tables add a Cochran-Armitage trend test. Switch the variant to Paired for McNemar's test on matched data.",
    whenToUse: "Testing association between two categorical variables from a table of counts (e.g. treatment × outcome), or reading risk/odds/diagnostic measures off a 2×2.",
    whenNotToUse: "Cells holding means or measurements rather than counts. A paired before/after design needs the Paired (McNemar) variant.",
  },
  survival: {
    equation: "Ŝ(t) = Π_{tᵢ ≤ t} (1 − dᵢ/nᵢ)",
    explain:
      "Kaplan-Meier estimates the fraction surviving over time, correctly handling censored subjects who have not yet had the event. The log-rank test compares whole survival curves between groups. Use it for time-to-event data such as death, relapse, or failure.",
    whenToUse: "Time-to-event data with censoring (death, relapse, failure), and comparing whole survival curves between groups.",
    whenNotToUse: "A simple yes/no outcome with no follow-up time — use a contingency table instead.",
  },
  correlation: {
    equation: "r = Σ(xᵢ−x̄)(yᵢ−ȳ) / √[ Σ(xᵢ−x̄)² · Σ(yᵢ−ȳ)² ]",
    explain:
      "Measures how strongly two variables move together, from −1 to +1. Pearson assumes a linear relationship and roughly normal data; Spearman ranks the values first, capturing any monotonic trend. Correlation is not causation, and a high r alone does not imply a good predictive model.",
    whenToUse: "Quantifying how strongly two continuous variables move together, with no assumption about which causes which.",
    whenNotToUse: "Inferring causation, or summarising a curved (non-monotonic) relationship — r can be near zero despite a strong pattern.",
  },
  regression: {
    equation: "y = β₀ + β₁x + ε    (minimise Σ(yᵢ − ŷᵢ)²)",
    explain:
      "Fits a straight line predicting Y from X by least squares, returning slope, intercept, and R² — optionally forced through the origin. A Wald-Wolfowitz runs test and a residual-normality check flag when a straight line is the wrong model. Use it to quantify a trend or predict/interpolate Y.",
    whenToUse: "Modelling a straight-line dependence of Y on X — to estimate the slope, test a trend, or predict Y at a new X.",
    whenNotToUse: "Curved data (the runs test will flag it — fit a nonlinear model instead) or when X carries substantial measurement error.",
  },
  curvefit: {
    equation: "4PL:  y = Bottom + (Top − Bottom) / (1 + (x / EC50)^(−Hill))",
    explain:
      "Fits a nonlinear model to dose-response or kinetic data by least squares. The 4-parameter logistic returns EC50/IC50, the Hill slope, and the plateaus; linear and LOWESS fits are also offered. Use it to estimate potency or to interpolate from a standard curve.",
    whenToUse: "Dose-response or kinetic data — to estimate EC50/IC50, Hill slope, and plateaus, or to interpolate unknowns from a standard curve.",
    whenNotToUse: "Straight-line data (use linear regression) or too few points to define every parameter of the chosen model.",
  },
  interpolate: {
    equation: "solve  y = f(x; θ̂)  for x   (CI by inverting the fit's confidence band)",
    explain:
      "Fits a standard curve (linear or any of the nonlinear equations) to your standards, then reads unknowns off it: a row with a Y value but a blank X returns the interpolated X (the classic 'read concentration off an ELISA standard curve'); a blank Y returns the interpolated Y. Each answer carries a confidence interval obtained by inverting the fit's confidence band, and unknowns that fall outside the standard range are flagged rather than extrapolated.",
    whenToUse: "Reading unknown concentrations/values off a calibration or standard curve — enter the standards as complete rows and the unknowns with the value you measured and the other cell left blank.",
    whenNotToUse: "The curve isn't monotonic over the standard range (X-from-Y is ambiguous), or you have no fitted standards to interpolate from.",
  },
  globalfit: {
    equation: "minimise Σ_curves Σ_i (yᵢ − f(xᵢ; θ_shared, θ_local))²",
    explain:
      "Fits one equation to several datasets at once, with each parameter either shared across all curves (one value), or local (fit per curve). Pooling the curves to estimate the shared parameters makes every estimate tighter and is the right way to compare potencies. The classic use: a family of dose-response curves sharing Top and Bottom (the same assay floor/ceiling) while each compound keeps its own EC50.",
    whenToUse: "Several related curves measured the same way — share the parameters that should be common (plateaus, Hill slope) and compare the ones that differ (EC50, Vmax).",
    whenNotToUse: "A single curve (use Curve fit), or curves with no parameters genuinely in common.",
  },
  meltingtemp: {
    equation: "Y = Bottom + (Top − Bottom) / (1 + exp((Tm − T)/Slope))   ·   Tm (derivative) = T at the extreme of dY/dT",
    explain:
      "Finds the melting temperature of each melt curve two ways. The sigmoid fit gives Tm as the midpoint of a two-state transition, with its standard error and 95% confidence interval; optional sloped baselines let each plateau drift in a straight line. The first-derivative method smooths the curve and takes the temperature where it changes fastest. Each replicate column gets its own Tm; a sample reports their mean and SD, and — with a control chosen — ΔTm = Tm − Tm(control) with a confidence interval from both standard errors.",
    whenToUse: "Thermal shift (DSF), CD or absorbance protein melts, and DNA/RNA melting curves: temperature in X, one Y column per sample, replicates as subcolumns.",
    whenNotToUse: "More than one transition inside the window (use a double Boltzmann curve fit), or curves that do not reach both plateaus.",
  },
  comparefits: {
    equation: "AICc = N·ln(SSE/N) + 2K + 2K(K+1)/(N−K−1)   ·   F = (ΔSSE/Δdf) / (SSE_complex/df_complex)",
    explain:
      "Fits two nonlinear models to the same data and asks which one the data prefer. AICc (a small-sample-corrected information criterion) ranks the models trading goodness-of-fit against the number of parameters; the ΔAICc converts to an Akaike weight — the probability each model is the better choice. When the simpler model is a special case of the more complex one (nested, e.g. 3PL ⊂ 4PL), it adds the extra-sum-of-squares F test: is the extra parameter worth keeping? Use it to justify a variable Hill slope, a second decay phase, or a higher polynomial.",
    whenToUse: "Deciding between two candidate equations for the same curve — e.g. 3PL vs 4PL, one- vs two-phase decay, quadratic vs cubic.",
    whenNotToUse: "Comparing fits to different datasets, or comparing a model to a model-free smoother (AICc needs a counted parameter set).",
  },
  roc: {
    equation: "ROC: TPR vs FPR over thresholds;   AUC = P(score₊ > score₋)",
    explain:
      "Evaluates how well a continuous score separates two classes by sweeping the decision threshold. The area under the curve (AUC) is the probability a random positive outranks a random negative — 0.5 is chance, 1.0 is perfect. Youden's index suggests an optimal cutoff.",
    whenToUse: "Judging how well a continuous score discriminates two known classes, independent of any single chosen cutoff.",
    whenNotToUse: "More than two outcome classes, or when the positive/negative labels are themselves uncertain.",
  },
  auc: {
    equation: "AUC = Σ ½·(yᵢ + yᵢ₊₁ − 2·baseline)·(xᵢ₊₁ − xᵢ)",
    explain:
      "Integrates an XY curve by the trapezoid rule relative to a baseline (Y = 0, the minimum, or the mean). It splits the curve into peaks — contiguous runs above the baseline — and reports each peak's start/end X, height, and area, plus the total net and positive-peak area.",
    whenToUse: "Total exposure or response over time/dose — pharmacokinetic AUC, chromatogram peaks, or any integrated 'area' measure.",
    whenNotToUse: "Comparing groups statistically — AUC is a descriptive value per curve; feed the per-curve AUCs into a t test or ANOVA for that.",
  },
  curvetransform: {
    equation: "Y′ = smooth(Y)  |  dY/dX  |  d²Y/dX²  |  ∫Y·dX",
    explain:
      "Transforms an XY curve into a new curve: a Savitzky-Golay smooth, the numerical derivative (first or second) by central differences, or the cumulative integral ∫Y·dX by the trapezoid rule — all at the same X values — plus the Michaelis-Menten linearizations (Lineweaver-Burk / Eadie-Hofstee / Hanes-Woolf), which rescale both axes. Because the result has different units, it spawns its own table + graph you can then analyse or style.",
    whenToUse: "Rate-of-change work (velocity/acceleration from a position curve), locating a peak/inflection via the derivative, cumulative exposure from a rate curve, or taming noise before a fit.",
    whenNotToUse: "Fitting a model (use nonlinear regression) or one-off visual smoothing (a LOWESS/spline curve-fit overlays without spawning a table).",
  },
  outliers: {
    equation: "G = max|xᵢ − x̄| / s    (compare to the critical G at α)",
    explain:
      "Grubbs' test flags the single most-extreme value as an outlier when its distance from the mean (in SDs) exceeds the critical value for the sample size; iterative Grubbs removes that point and repeats. ROUT (Motulsky-Brown) instead uses a robust centre (median) + robust SD and the false-discovery-rate Q to flag several outliers at once. Both assume the rest of the data are roughly normal.",
    whenToUse: "Screening a single column of roughly-normal data for extreme values before analysis (ROUT when several may be present).",
    whenNotToUse: "Several suspected outliers (Grubbs masks them — ROUT is better), tiny samples, or merely to delete inconvenient data.",
  },
  pcorrect: {
    equation: "adjusted P = correct(P₁…Pₘ)    (Bonferroni · Holm · Benjamini-Hochberg …)",
    explain:
      "Takes a column of P values from a family of tests and adjusts them for multiple comparisons, then marks which stay significant at α. Bonferroni, Holm (Holm-Bonferroni step-down), Holm-Šídák and Šídák control the family-wise error rate; Benjamini-Hochberg and Benjamini-Yekutieli control the false-discovery rate (more powerful, a weaker guarantee). Use it to correct a stack of P values you already have — from analyses run here or elsewhere.",
    whenToUse: "Correcting a set of P values that together answer one question — several endpoints, many pairwise tests, a screen — so a chance low P among many isn't over-read.",
    whenNotToUse: "A single test, or a hand-picked subset of P values — the correction assumes the whole family is present.",
  },
  ancova: {
    equation: "F_slope = [(SSE_common − SSE_sep)/(k−1)] / [SSE_sep/(N−2k)]",
    explain:
      "Compares the regression lines of two or more groups (ANCOVA). First an F-test asks whether the slopes are equal (parallel lines); if they are, a second F-test asks whether the intercepts (elevations) differ. Each group also reports its own slope and intercept. Use it to ask 'does the relationship between X and Y depend on the group?'",
    whenToUse: "Asking whether two or more groups share the same linear X→Y relationship — equal slope (parallel) and/or equal intercept (elevation).",
    whenNotToUse: "Curved relationships, or interpreting the intercept test when the slopes are not parallel (the elevation comparison is then meaningless).",
  },
  multipleregression: {
    equation: "y = β₀ + β₁x₁ + … + βₖxₖ + ε    (minimise Σ(yᵢ − ŷᵢ)²)",
    explain:
      "Models one continuous outcome from several predictors at once by least squares, so each coefficient is the effect of its predictor holding the others fixed. Reports each slope with its CI and p, the standardized β, R²/adjusted R², the overall F-test, and a variance-inflation factor that flags collinear (redundant) predictors. The first selected variable is the outcome; the rest are predictors.",
    whenToUse: "Quantifying how several predictors jointly relate to one continuous outcome, or adjusting one effect for others (confounders).",
    whenNotToUse: "A binary/categorical outcome (use logistic regression), or far more predictors than rows (the fit overfits and CIs explode).",
  },
  logistic: {
    equation: "logit(p) = ln(p/(1−p)) = β₀ + β₁x₁ + … + βₖxₖ    ·    OR = exp(β)",
    explain:
      "Models the probability of a binary (0/1) outcome from one or more predictors by maximum likelihood. Each coefficient is reported as an odds ratio with its CI — the multiplicative change in the odds of the event per unit predictor, holding the others fixed. Pseudo-R² (McFadden/Nagelkerke/Tjur), a likelihood-ratio test of the whole model, and the classification accuracy summarise fit. The first selected variable is the outcome; the rest are predictors.",
    whenToUse: "A yes/no (binary) outcome predicted from continuous or coded categorical variables — to estimate odds ratios or classify cases.",
    whenNotToUse: "A continuous outcome (use multiple regression), >2 outcome classes (multinomial/ordinal logistic), or perfectly separable data (the fit won't converge).",
  },
  poisson: {
    equation: "ln(E[Y]) = β₀ + β₁x₁ + … + βₖxₖ    ·    rate ratio = exp(β)",
    explain:
      "Models a count outcome (0, 1, 2, …) with a log-link GLM. Each coefficient is reported as a rate ratio with its CI — the multiplicative change in the expected count per unit predictor. A likelihood-ratio χ², McFadden pseudo-R², the deviance, and a dispersion check (Pearson χ²/df) summarise fit; dispersion ≫ 1 warns of overdispersion. The first selected variable is the outcome; the rest are predictors.",
    whenToUse: "Counts or rates of events (cases, defects, arrivals) predicted from other variables — to estimate rate ratios.",
    whenNotToUse: "A continuous outcome (use regression), a binary outcome (logistic), or strongly overdispersed counts (needs negative-binomial).",
  },
  cox: {
    equation: "h(t | x) = h₀(t) · exp(β₁x₁ + … + βₖxₖ)    ·    hazard ratio = exp(β)",
    explain:
      "Relates survival time (with right-censoring) to one or more predictors without assuming a shape for the baseline hazard. Each coefficient is reported as a hazard ratio with its CI — the multiplicative change in the instantaneous risk of the event per unit predictor, holding the others fixed. A likelihood-ratio χ² tests the whole model and Harrell's C measures how well the risk scores rank survival. The first selected column is the time, the second is the event (1) / censored (0) indicator, the rest are predictors.",
    whenToUse: "Time-to-event data with censoring, when you want to adjust the risk for covariates or estimate a hazard ratio (e.g. treatment effect adjusted for age).",
    whenNotToUse: "No follow-up time (use logistic regression on the event), or when hazards are clearly non-proportional (crossing survival curves).",
  },
  deming: {
    equation: "orthogonal-type fit with both axes in error; λ = σ²ₑᵣᵣ(Y)/σ²ₑᵣᵣ(X)",
    explain:
      "Method-comparison regression for when both measurements carry error (e.g. two assays of the same samples) — ordinary regression is biased there. Returns slope + intercept with jackknife CIs; if the slope CI includes 1 and the intercept CI includes 0, the two methods agree. λ = 1 (default) treats the two errors as equal (orthogonal regression).",
    whenToUse: "Comparing two measurement methods/instruments on the same samples, where each has its own measurement error.",
    whenNotToUse: "One variable is an error-free predictor (use ordinary regression), or the errors are proportional to level (needs weighted Deming / Passing-Bablok).",
  },
  passingbablok: {
    equation: "slope = shifted median of all pairwise slopes   ·   intercept = median(y − slope·x)",
    explain:
      "Passing-Bablok is a non-parametric, outlier-robust method-comparison regression: it assumes neither method is error-free and makes no distributional assumption. The slope is the (shifted) median of every pairwise slope and the intercept the median of the residuals, so a few aberrant points barely move the fit. If the slope CI includes 1 and the intercept CI includes 0, the two methods agree (no proportional or constant bias).",
    whenToUse: "Comparing two measurement methods when the data may be non-normal or contain outliers, and you want a robust slope/intercept with distribution-free CIs.",
    whenNotToUse: "A markedly non-linear relationship (Passing-Bablok assumes linearity over the range), or a simple X→Y prediction (use ordinary regression).",
  },
  blandaltman: {
    equation: "bias = mean(A − B)   ·   limits of agreement = bias ± 1.96·SD(A − B)",
    explain:
      "Bland-Altman assesses agreement between two methods measuring the same samples: it plots each pair's difference against its mean and summarises the bias (mean difference) and the 95% limits of agreement (bias ± 1.96·SD of the differences) — the range within which most differences fall. Reports each with a confidence interval. Unlike correlation, it answers 'do the methods give interchangeable values?', not 'are they related?'.",
    whenToUse: "Judging whether two measurement methods/instruments agree closely enough to be used interchangeably.",
    whenNotToUse: "Establishing a calibration relationship or converting between methods (use Deming / Passing-Bablok regression), or a simple X→Y prediction (use regression).",
  },
  pca: {
    equation: "maximise Var(Zw)  s.t.  ‖w‖ = 1    ·    Σλₖ = p (standardized)",
    explain:
      "Re-expresses many correlated variables as a few uncorrelated principal components — orthogonal axes ordered by the variance they capture. Reports each component's eigenvalue, % variance explained and cumulative %, the variable loadings (which variables define each axis), and the case scores. Standardized (correlation-matrix) PCA by default so variables on different scales compare fairly. It's exploratory — for spotting structure, redundancy, or clusters, not for testing a hypothesis.",
    whenToUse: "Reducing many correlated measures to a few interpretable axes, or visualising the dominant structure / clusters in multivariate data.",
    whenNotToUse: "Testing a specific hypothesis (PCA has no p-values), or when components must map to pre-defined factors (use confirmatory factor analysis).",
  },
  rda: {
    equation: "Ŷ = X (XᵀX)⁻¹ XᵀY    ·    axes = PCA(Ŷ)    ·    F = (SS_con/q) / (SS_res/(n−q−1))",
    explain:
      "The constrained ordination. It regresses every response variable on the explanatory block, then ordinates the fitted values, so the axes are by construction linear combinations of the explanatory variables — the 'direct gradient analysis' of the ecology literature. Reports the share of variance constrained (with Ezekiel's adjusted R², the one to quote), the constrained and unconstrained eigenvalues, a permutation test of the whole model and of each term entered last, and both ways of placing the cases: LC (fitted, from the explanatory variables) and WA (from the observed responses).",
    whenToUse: "You have measured explanatory variables and want to know how much of the response they explain and which ones matter.",
    whenNotToUse: "Exploring the response alone (use PCA), counts with unimodal responses along a long gradient (use CCA), or fewer cases than explanatory columns.",
  },
  cca: {
    equation: "Q̄ = D_r^(−½)(P − r cᵀ)D_c^(−½)    ·    axes = SVD(P_X Q̄),  P_X weighted by the row masses",
    explain:
      "Correspondence analysis, constrained. It fits the chi-square residual matrix on the explanatory block — weighted by each site's row mass, which is what makes it CCA and not an RDA on transformed data — and ordinates the fit, so the axes are linear combinations of the explanatory variables in CA's own geometry. Reports the constrained and unconstrained inertia, the share explained (with Ezekiel's adjusted R², the one to quote), a permutation test of the model and of each term entered last, both LC and WA case placements, and the variable positions.",
    whenToUse: "Species or category counts per case with measured explanatory variables, especially on a long gradient where responses are unimodal.",
    whenNotToUse: "Measurements on different scales or with negative values, a short gradient where responses are linear (use RDA on Hellinger-transformed data), or fewer cases than explanatory columns.",
  },
  dbrda: {
    equation: "G = −½ J D² J    ·    Y = U√Λ    ·    then RDA(Y ~ X)",
    explain:
      "Redundancy analysis on any dissimilarity. The distance matrix is turned into coordinates (a PCoA) and those coordinates are the response the explanatory block is fitted to — so Bray-Curtis, Jaccard or any other non-Euclidean distance can be constrained and tested, which plain RDA cannot do. Reports exactly what RDA does; on Euclidean distances it reproduces RDA to the last digit. Axes with negative eigenvalues cannot be represented and are dropped before the regression, and their count is reported.",
    whenToUse: "Community data where the meaningful distance is not Euclidean, with explanatory variables to test against it.",
    whenNotToUse: "When Euclidean geometry is right (RDA gives the same answer more directly), or when the variables themselves are the subject.",
  },
  permanova: {
    equation: "F = [SS_between / (a − 1)] / [SS_within / (N − a)],  SS from squared distances;  p by permuting the group labels",
    explain:
      "PERMANOVA (Anderson 2001): a one-way analysis of variance on a distance matrix. The total, within-group and between-group sums of squares come from the squared dissimilarities, the pseudo-F compares them, and the p is the share of label rearrangements whose F is at least as large. PERMDISP (Anderson 2006) is reported with it: each case's distance to its group centroid, compared across groups by ANOVA — because PERMANOVA cannot tell groups that differ in position from groups that differ in spread.",
    whenToUse: "Groups of cases on many variables, on Euclidean (standardised) or any other distance, when the question is whether the groups differ.",
    whenNotToUse: "One variable (ANOVA), which variables carry the difference (db-RDA), or non-exchangeable cases (paired or repeated measures).",
  },
  varpart: {
    equation: "[a] = R²adj(X+W) − R²adj(W)    ·    [shared] = R²adj(X) + R²adj(W) − R²adj(X+W)",
    explain:
      "Splits what a set of explanatory variables explains into what each block explains alone and what they explain jointly, by running redundancy analysis on every combination of the blocks and taking the differences. Two blocks give three fractions plus the residual; three blocks give seven. Every fraction is Ezekiel's adjusted R² — with a raw R² the widest block would win by being wide. The unique fractions are tested by partial RDA (that block with the others held constant); a shared fraction is a difference between two models, so it has no test and can legitimately be negative.",
    whenToUse: "Two or three overlapping sets of explanatory variables — climate vs soil vs space is the classic case — when you need to know which of them is actually carrying the signal.",
    whenNotToUse: "One set of variables (run RDA), or a chi-square geometry (adjusted R² is not defined for CCA).",
  },
  ca: {
    equation: "S = D_r^(−½) (P − r cᵀ) D_c^(−½) = U Σ Vᵀ    ·    inertia = Σ λ = χ² / N",
    explain:
      "The ordination for a table of counts. It decomposes the chi-square distances between the row profiles, and because rows and columns come out of the same decomposition it draws both in one picture: a site sits near the species it is relatively rich in. Reports the inertia each axis carries (the axes' shares of χ²/N), the site and species coordinates, and the masses behind them. Assumes unimodal responses along a gradient, which is what an abundance table usually shows — the case PCA handles badly.",
    whenToUse: "Species or category counts per case, especially when you want sites and species read together.",
    whenNotToUse: "Measurements on different scales or with negative values (use PCA), or when a strong single gradient makes the arch effect dominate the second axis.",
  },
  pcoa: {
    equation: "G = −½ J D² J,   J = I − 11ᵀ/n    ·    coordinates = U √Λ",
    explain:
      "Maps a distance matrix. PCA is fixed to Euclidean distance; this takes any dissimilarity — Bray-Curtis, Jaccard, Manhattan — double-centres the squared distances and decomposes them, so each axis carries a share of the total variation and the picture reflects the distance you actually meant. On Euclidean distances it reproduces PCA exactly. A non-Euclidean dissimilarity produces negative eigenvalues, which are reported and can be removed with a Cailliez or Lingoes correction. Species can be added by weighted averaging.",
    whenToUse: "Community or abundance data, presence-absence data, or any table where the meaningful distance between cases is not Euclidean.",
    whenNotToUse: "Testing a hypothesis (no p-values), or when the variables' own directions matter — PCA gives loadings, this does not.",
  },
  nmds: {
    equation: "minimise stress₁ = √( Σ(d − d̂)² / Σ d² ),   d̂ monotone in the dissimilarity",
    explain:
      "Arranges the cases so the rank order of the map distances matches the rank order of the dissimilarities — it uses no distance sizes at all, which is why it copes with species counts full of zeros. The mismatch is Kruskal's stress-1: below 0.1 is a good map, below 0.2 usable, above 0.3 close to arbitrary (Clarke 1993). The fit is iterative and can settle in a local minimum, so it is restarted from several seeded starts plus the PCoA solution and the best kept; the result is rotated to principal axes. The Shepard plot shows the fit directly.",
    whenToUse: "Community ecology and any data where only the ordering of the dissimilarities is trustworthy — the usual first choice for a species matrix.",
    whenNotToUse: "When the distances themselves should be preserved (use PCoA), or when the axes need to mean something in units — NMDS axes have no scale.",
  },
  goodnessoffit: {
    equation: "χ² = Σ (Oᵢ − Eᵢ)² / Eᵢ    (df = k − 1)",
    explain:
      "Tests whether a set of observed category counts matches an expected distribution — uniform by default, or proportions you supply. Reports Pearson's χ² with k−1 degrees of freedom and a per-category observed-vs-expected breakdown; with exactly two categories it adds an exact binomial test. Use it for parts-of-whole / counts data (e.g. do the slice counts depart from equal?).",
    whenToUse: "One column of category counts you want to compare against an expected (often uniform) distribution — Mendelian ratios, equal-preference, observed vs theoretical.",
    whenNotToUse: "Continuous data, very small expected counts (< ~5 per cell — use the exact/binomial test), or comparing two grouping variables (use a contingency table).",
  },
  nested: {
    equation: "F_groups = MS_groups / MS_subgroups    (subgroups are the error term)",
    explain:
      "Hierarchical ANOVA for data with random subgroups nested inside groups (e.g. several animals per treatment, several readings per animal). The group effect is tested against the among-subgroup mean square — the correct error term — so repeated readings of the same subject don't masquerade as independent replicates (pseudo-replication). Two groups also yield a nested t.",
    whenToUse: "Hierarchically structured data — subjects within groups, measured repeatedly — where the experimental unit is the subgroup, not the individual reading.",
    whenNotToUse: "A single level of replication (use a plain t test / one-way ANOVA) or fixed (not randomly sampled) subgroups.",
  },
  corrmatrix: {
    equation: "Rᵢⱼ = corr(varᵢ, varⱼ)    ·    R²ᵢⱼ = Rᵢⱼ²",
    explain:
      "Computes every pairwise correlation among the selected variables — the full K×K matrix of r (and R²) with two-tailed p-values, using pairwise-complete observations. Pearson captures linear association; Spearman ranks first for any monotonic trend.",
    whenToUse: "Scanning many continuous variables at once for related or redundant measures before modelling or dimension reduction.",
    whenNotToUse: "Confirming one specific hypothesis — the many pairwise p-values invite false positives unless you correct for multiplicity.",
  },
  cluster: {
    equation: "k-means: min Σₖ Σ_{i∈Cₖ} ‖xᵢ − μₖ‖²    ·    hierarchical: merge nearest clusters (Ward/…)",
    explain:
      "Groups cases by how similar their variable profiles are — k-means (partition into k clusters around moving centroids, seeded k-means++ init restarted for the best fit) or agglomerative hierarchical (repeatedly merge the closest clusters, then cut into k). Variables are z-scored by default so units compare fairly. Reports each cluster's size and within-cluster sum of squares, and the mean silhouette width (−1…1) as an overall separation score. Exploratory — it always returns clusters, so judge them by the silhouette and by domain sense.",
    whenToUse: "Discovering natural groupings in multivariate data — sample types, expression patterns, customer segments — or ordering rows/columns of a heatmap.",
    whenNotToUse: "Testing whether pre-defined groups differ (use ANOVA / discriminant analysis); k-means also assumes roughly round, similar-size clusters.",
  },
};

/**
 * The Analyze chooser grouped by question / data shape. Each
 * group lists method ids in display order; the dialog renders these as labelled
 * sections (`<optgroup>`s).
 */
export const METHOD_GROUPS: { label: string; methods: string[] }[] = [
  { label: "Column data — describe one group", methods: ["describe", "normality", "outliers", "pcorrect"] },
  { label: "Column data — compare groups", methods: ["ttest", "equivalence", "permutation", "bayesfactor", "anova"] },
  { label: "Grouped / repeated measures", methods: ["twoway", "rmanova", "mixedanova", "mixedmodel", "nested"] },
  { label: "Categorical, counts & survival", methods: ["contingency", "goodnessoffit", "survival", "cox"] },
  { label: "XY — correlate, fit, classify", methods: ["correlation", "regression", "deming", "passingbablok", "blandaltman", "curvefit", "interpolate", "globalfit", "comparefits", "meltingtemp", "roc", "auc", "curvetransform", "ancova"] },
  { label: "Multiple variables", methods: ["corrmatrix", "multipleregression", "logistic", "poisson", "multifactor", "pca", "cluster"] },
  // Ordination — the map methods. PCA sits above with the other multivariable tools; these are
  // the ones for data PCA cannot properly handle (any distance, or ranks only).
  { label: "Ordination (community / distance data)", methods: ["ca", "pcoa", "nmds", "rda", "cca", "dbrda", "permanova", "varpart"] },
  { label: "Meta-analysis", methods: ["metaanalysis", "publicationbias"] },
];

/** How many source datasets a method reads: one · two (X/Y) · many (groups). */
export function columnMode(method: string, variant?: string): "one" | "two" | "many" {
  if (method === "anova" || method === "contingency" || method === "twoway" || method === "survival" || method === "rmanova" || method === "mixedanova" || method === "corrmatrix" || method === "ancova" || method === "multipleregression" || method === "logistic" || method === "poisson" || method === "multifactor" || method === "mixedmodel" || method === "cox" || method === "pca" || method === "ca" || method === "pcoa" || method === "nmds" || method === "rda" || method === "cca" || method === "dbrda" || method === "permanova" || method === "varpart" || method === "cluster" || method === "nested" || method === "globalfit" || method === "meltingtemp" || method === "metaanalysis" || method === "publicationbias")
    return "many";
  if (method === "correlation" || method === "regression" || method === "deming" || method === "blandaltman" || method === "passingbablok" || method === "curvefit" || method === "interpolate" || method === "comparefits" || method === "roc" || method === "auc" || method === "curvetransform") return "two";
  if (method === "ttest" && variant !== "one-sample" && variant !== "wilcoxon-1samp") return "two";
  if (method === "equivalence" && variant !== "one-sample") return "two";
  if (method === "permutation" && variant !== "one-sample") return "two";
  if (method === "bayesfactor" && variant !== "one-sample") return "two";
  return "one";
}

/** XY methods take an X column + a Y dataset (not two groups). */
export function isXYMethod(method: string): boolean {
  return method === "correlation" || method === "regression" || method === "deming" || method === "blandaltman" || method === "passingbablok" || method === "curvefit" || method === "interpolate" || method === "comparefits" || method === "roc" || method === "auc" || method === "curvetransform";
}

/**
 * The whitelist of function + constant names the engine's user-equation compiler
 * (`_compile_user_equation`) recognises, so the client's parameter detection
 * agrees with what the engine will actually fit. It must mirror the engine's FUNCS /
 * CONSTS sets exactly (`engines/py/engine.py`).
 */
const EQ_FUNCS = new Set([
  "exp", "ln", "log", "log10", "log2", "sqrt", "sqr", "abs", "sin", "cos", "tan",
  "asin", "acos", "atan", "atan2", "sinh", "cosh", "tanh", "sign", "floor", "ceil",
  "if", "min", "max", "mod", "pow",
]);
const EQ_CONSTS = new Set(["pi", "e"]);

/**
 * Detect the fittable parameters in a user-typed nonlinear equation, mirroring the
 * engine's rule: `X` (any case) is the independent variable, `pi`/`e` are constants,
 * every recognised function name is a call — and every other identifier is a
 * parameter to fit, in first-appearance order (deduped). Used to render one
 * initial-value / constraint input per parameter before the equation is sent to the
 * engine (which stays the source of truth for validation). A leading `Y =` /
 * `y =` / `f(x) =` / `f =` is stripped first, exactly as the engine does.
 */
export function detectEquationParams(expr: string): string[] {
  let src = (expr ?? "").trim();
  const eq = src.indexOf("=");
  if (eq >= 0) {
    const lhs = src.slice(0, eq).trim().toLowerCase().replace(/\s+/g, "");
    if (lhs === "y" || lhs === "f(x)" || lhs === "f") src = src.slice(eq + 1);
  }
  const ids = src.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    const low = id.toLowerCase();
    if (low === "x" || EQ_CONSTS.has(low) || EQ_FUNCS.has(low)) continue;
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/** Plain-language glossary for the curve-fit parameters — what each value means
 *  and when to fix it. Feeds the per-parameter tooltips in the fit-config panel so
 *  a user doesn't face bare names like "logEC50". Uncovered params fall back to a
 *  generic note. */
export const CURVE_FIT_PARAM_INFO: Record<string, string> = {
  Bottom: "Lower plateau — the response at very low / zero dose (the baseline). Fix it to 0 when your baseline is a true zero.",
  Top: "Upper plateau — the maximal response. Fix it (e.g. to 100) when you know the assay ceiling or your data don't reach saturation.",
  logEC50: "log₁₀ of the half-maximal concentration; EC50 = 10^logEC50. Fitting in log space gives more symmetric confidence intervals.",
  EC50: "Half-maximal effective concentration — the potency (dose giving 50% of the effect between Bottom and Top). Smaller = more potent.",
  logIC50: "log₁₀ of the IC50; IC50 = 10^logIC50.",
  IC50: "Half-maximal inhibitory concentration — the potency of an inhibitor (dose giving 50% inhibition). Smaller = more potent.",
  "Hill slope": "Steepness of the curve at its midpoint. 1 = a standard curve; >1 steeper, <1 shallower. Fix to 1 for a standard (non-variable-slope) fit.",
  HillSlope: "Steepness of the curve at its midpoint. 1 = a standard curve; >1 steeper, <1 shallower.",
  Asymmetry: "5PL asymmetry factor. 1 = symmetric (reduces to 4PL); values ≠ 1 skew the curve toward one plateau.",
  Vmax: "Maximum reaction velocity — the rate when the enzyme is saturated with substrate.",
  KM: "Michaelis constant — the substrate concentration at half-Vmax. A smaller KM means higher apparent affinity.",
  kcat: "Turnover number — reactions catalysed per active site per unit time (Vmax / total enzyme).",
  Et: "Total active enzyme concentration (used to convert Vmax to kcat). Fix it to your known enzyme amount.",
  Ki: "Inhibition constant — the inhibitor's affinity. Smaller = more potent inhibitor.",
  Bmax: "Maximum specific binding — the total number of binding sites at saturation.",
  Kd: "Equilibrium dissociation constant — the ligand concentration at half-maximal binding. Smaller = higher affinity.",
  KA: "Agonist / ligand equilibrium dissociation constant (affinity).",
  logKB: "log₁₀ of the modulator / antagonist affinity constant.",
  logAlpha: "log₁₀ of the cooperativity factor α (allosteric): α>1 raises affinity/potency, α<1 lowers it.",
  Y0: "The value of Y at X = 0 — the starting value of the curve.",
  Plateau: "The value the curve approaches at large X (the asymptote).",
  Span: "The distance between the start and the plateau (e.g. Top − Bottom, or Y0 − Plateau).",
  K: "Rate constant — larger K = faster approach to the plateau (half-time = ln2 / K).",
  Kfast: "Rate constant of the fast phase of a two-phase curve.",
  Kslow: "Rate constant of the slow phase of a two-phase curve.",
  SpanFast: "Amplitude of the fast phase of a two-phase curve.",
  SpanSlow: "Amplitude of the slow phase of a two-phase curve.",
  Background: "A constant baseline / offset added to every point (non-specific signal).",
  NS: "Non-specific binding — the part that rises linearly with ligand and doesn't saturate.",
  X0: "The X value where the two phases of a piecewise curve meet.",
  S0: "Initial substrate concentration at the start of the reaction.",
  Frac: "Fraction of the response belonging to the first (high-affinity) phase of a biphasic curve.",
  Amplitude: "Height of the peak above the baseline.",
  Center: "X position of the peak.",
  Width: "Width of the peak (larger = broader).",
  Rate: "Growth / decay rate constant.",
  Midpoint: "The X value at the curve's inflection point.",
  Shape: "Shape / asymmetry exponent of the growth curve.",
  Asymptote: "The maximum the growth curve approaches.",
  pA2: "−log₁₀ of the antagonist Kb (Schild): the antagonist concentration that shifts the agonist EC50 two-fold.",
  // ── enzyme / binding extras ──
  Khalf: "Substrate concentration giving half-maximal velocity in an allosteric (sigmoidal) enzyme — the analogue of KM when the Hill slope ≠ 1.",
  h: "Hill coefficient — cooperativity / steepness. h = 1 is non-cooperative; h > 1 positive cooperativity, h < 1 negative. Fix to 1 for a simple hyperbola.",
  Bmax1: "Maximum specific binding of the first (higher-affinity) site in a two-site fit.",
  Kd1: "Dissociation constant of the first binding site (its half-saturation concentration). Smaller = higher affinity.",
  Bmax2: "Maximum specific binding of the second site.",
  Kd2: "Dissociation constant of the second binding site.",
  logKd: "log₁₀ of the dissociation constant; Kd = 10^logKd. Fitting in log space gives more symmetric confidence intervals.",
  Hot: "The fixed radioligand (“hot”) concentration in a homologous-competition fit — fix it to its known value, or Kd and Hot are confounded.",
  Alpha: "Cooperativity factor α (allosteric): α > 1 strengthens, α < 1 weakens the interaction; α = 1 is neutral.",
  Kon: "Association rate constant — how fast the complex forms (per unit concentration·time).",
  Koff: "Dissociation rate constant — how fast the complex falls apart (per unit time).",
  Spec: "Marks each curve in a paired global fit as total binding (1) or nonspecific-only (0).",
  // ── sigmoidal / Boltzmann ──
  V50: "The X value (e.g. voltage) at the midpoint of a Boltzmann sigmoid — halfway between Bottom and Top.",
  Slope: "Steepness of the transition (the slope factor). A smaller value makes a sharper switch; units of X.",
  Intercept: "The Y value where the line crosses X = 0.",
  // ── growth ──
  Capacity: "Carrying capacity — the maximum the logistic-growth curve approaches at large X.",
  Displacement: "Gompertz displacement (b) — sets the lag before growth accelerates; larger shifts the rise to the right.",
  Linf: "Asymptotic maximum size (L∞) the von Bertalanffy growth curve approaches.",
  t0: "The (theoretical) age/X at which size would be zero in a growth fit.",
  // ── peaks ──
  Mean: "Center of a Gaussian peak — the X position of its maximum.",
  SD: "Standard deviation (width) of a Gaussian peak — larger is broader.",
  Sigma: "Gaussian width component of a peak (standard deviation); larger is broader.",
  Mu: "Center / location of the peak or distribution (its X position).",
  Baseline: "A constant level the whole curve (e.g. a peak) sits on.",
  Eta: "Mixing fraction of a pseudo-Voigt peak: 0 = pure Gaussian, 1 = pure Lorentzian.",
  // ── polynomial / generic ──
  A: "A fitted coefficient — e.g. the scale factor of a power law A·X^B.",
  B: "A fitted coefficient — e.g. the exponent of a power law A·X^B.",
  C: "A fitted constant offset added to the curve.",
  B0: "Polynomial constant term (the Y-intercept).",
  B1: "Polynomial first-order (linear) coefficient.",
  B2: "Polynomial second-order (quadratic) coefficient.",
  B3: "Polynomial third-order (cubic) coefficient.",
  B4: "Polynomial fourth-order coefficient.",
  B5: "Polynomial fifth-order coefficient.",
  B6: "Polynomial sixth-order coefficient.",
  // ── periodic ──
  Period: "The length of one full cycle of a periodic (sine) fit.",
  Phase: "Horizontal shift of a periodic fit — where the cycle starts.",
  Tau: "A characteristic time constant (e.g. an exponential tail or transducer term); larger = slower.",
  Beta: "Stretching exponent of a stretched exponential; 1 = an ordinary single exponential.",
  Scale: "A scaling constant of the model (in units of X).",
  // ── operational / pharmacology ──
  Emax: "The maximal effect the system can produce (operational model of agonism).",
  Basal: "The response with no agonist present — the baseline of the operational model.",
  n: "Transducer slope — links receptor occupancy to the observed response.",
  logKA: "log₁₀ of the agonist equilibrium dissociation constant (affinity).",
  logTau: "log₁₀ of the transducer coefficient τ — the agonist's efficiency / signal amplification.",
};

/** Curve-fit equation id → its parameter names (mirrors the engine `_nl_models`
 *  registry exactly — global fitting passes these names as the shared set). */
export const CURVE_FIT_PARAMS: Record<string, string[]> = {
  "4pl": ["Bottom", "Top", "logEC50", "Hill slope"],
  "3pl": ["Bottom", "Top", "logEC50"],
  "5pl": ["Bottom", "Top", "logEC50", "Hill slope", "Asymmetry"],
  mm: ["Vmax", "KM"],
  kcat: ["Et", "kcat", "KM"],
  enzyme_progress: ["Vmax", "KM", "S0"],
  allosteric: ["Vmax", "Khalf", "h"],
  substrate_inhibition: ["Vmax", "KM", "Ki"],
  onesite: ["Bmax", "Kd"],
  hill_binding: ["Bmax", "Kd", "h"],
  boltzmann: ["Bottom", "Top", "V50", "Slope"],
  exp_decay: ["Y0", "Plateau", "K"],
  exp_decay2: ["Plateau", "SpanFast", "Kfast", "SpanSlow", "Kslow"],
  exp_assoc: ["Y0", "Plateau", "K"],
  exp_growth: ["Y0", "K"],
  gompertz: ["Asymptote", "Displacement", "Rate"],
  logistic_growth: ["Capacity", "Rate", "Midpoint"],
  gaussian: ["Amplitude", "Mean", "SD"],
  lorentzian: ["Amplitude", "Center", "Width"],
  poly2: ["B0", "B1", "B2"],
  poly3: ["B0", "B1", "B2", "B3"],
  line_origin: ["Slope"],
  // ── further curve-fit models: binding, growth, peaks, power (must mirror the engine registry param names exactly) ──
  twosite: ["Bmax1", "Kd1", "Bmax2", "Kd2"],
  onesite_ns: ["Bmax", "Kd", "NS"],
  homologous_competition: ["Bmax", "logKd", "NS", "Hot"],
  allosteric_binding: ["Bmax", "A", "KA", "logKB", "logAlpha"],
  hyperbola_offset: ["Background", "Bmax", "Kd"],
  dr_3pl_conc: ["Bottom", "Top", "EC50"],
  dr_4pl_conc: ["Bottom", "Top", "EC50", "Hill slope"],
  biexp_assoc: ["Y0", "SpanFast", "Kfast", "SpanSlow", "Kslow"],
  richards: ["Asymptote", "Rate", "Midpoint", "Shape"],
  weibull_growth: ["Asymptote", "Scale", "Shape"],
  von_bertalanffy: ["Linf", "K", "t0"],
  gaussian_baseline: ["Baseline", "Amplitude", "Mean", "SD"],
  lognormal_peak: ["Amplitude", "Center", "Width"],
  sine: ["Amplitude", "Period", "Phase", "Offset"],
  poly4: ["B0", "B1", "B2", "B3", "B4"],
  poly5: ["B0", "B1", "B2", "B3", "B4", "B5"],
  power: ["A", "B"],
  power_offset: ["A", "B", "C"],
  // ── further curve-fit models: decays, growth, peaks, periodic, simple ──
  exp_linear: ["A", "K", "B", "C"],
  exp_decay3: ["Plateau", "Span1", "K1", "Span2", "K2", "Span3", "K3"],
  stretched_exp: ["Amplitude", "Tau", "Beta"],
  logistic4_growth: ["Bottom", "Top", "Rate", "Midpoint"],
  gompertz4: ["Offset", "Span", "Rate", "Inflection"],
  chapman_richards: ["Asymptote", "Rate", "Shape"],
  ic50_4pl_conc: ["Bottom", "Top", "IC50", "Hill slope"],
  gaussian2: ["Amp1", "Mean1", "SD1", "Amp2", "Mean2", "SD2"],
  pseudo_voigt: ["Amplitude", "Center", "Width", "Eta"],
  damped_sine: ["Amplitude", "Decay", "Period", "Phase", "Offset"],
  logarithmic: ["A", "B"],
  reciprocal: ["A", "B"],
  rational11: ["A", "B", "C"],
  sqrt_fit: ["A", "B"],
  poly6: ["B0", "B1", "B2", "B3", "B4", "B5", "B6"],
  // ── normalized dose-response, inhibition, competition, kinetics (must mirror the engine registry param names exactly) ──
  dr_norm_3pl: ["logEC50"],
  dr_norm_4pl: ["logEC50", "Hill slope"],
  dr_norm_4pl_conc: ["EC50", "Hill slope"],
  ic50_4pl_log: ["Bottom", "Top", "logIC50", "Hill slope"],
  ic50_3pl_log: ["Bottom", "Top", "logIC50"],
  ic50_norm_4pl: ["logIC50", "Hill slope"],
  ic50_norm_3pl: ["logIC50"],
  ic50_3pl_conc: ["Bottom", "Top", "IC50"],
  dr_5pl_conc: ["Bottom", "Top", "EC50", "Hill slope", "Asymmetry"],
  biphasic_dr: ["Bottom", "Top", "Frac", "logEC50_1", "nH1", "logEC50_2", "nH2"],
  bell_dr: ["Base", "Amplitude", "logEC50_up", "nH_up", "logEC50_down", "nH_down"],
  competition_1site: ["Bottom", "Top", "logIC50"],
  competition_2site: ["Bottom", "Top", "Frac1", "logIC50_1", "logIC50_2"],
  total_binding: ["Bmax", "Kd", "NS", "Background"],
  plateau_then_decay: ["X0", "Y0", "Plateau", "K"],
  plateau_then_assoc: ["X0", "Y0", "Plateau", "K"],
  assoc_then_dissoc: ["Amplitude", "Kon", "Koff", "Baseline"],
  segmental: ["X0", "Y0", "Slope1", "Slope2"],
  mmf_growth: ["Y0", "Asymptote", "K", "Shape"],
  gaussian3: ["Amp1", "Mean1", "SD1", "Amp2", "Mean2", "SD2", "Amp3", "Mean3", "SD3"],
  // ── tight binding, peaks, periodic, sigmoids (must mirror the engine registry param names exactly) ──
  morrison_ki: ["V0", "Et", "Ki"],
  binding_depletion: ["Bmax", "Kd"],
  voigt: ["Amplitude", "Center", "SigmaG", "GammaL"],
  emg: ["Amplitude", "Center", "Sigma", "Tau"],
  pearson7: ["Amplitude", "Center", "Width", "Shape"],
  sine2: ["Offset", "A1", "Period", "Phase1", "A2", "Phase2"],
  sine_drift: ["Offset", "Slope", "Amplitude", "Period", "Phase"],
  boltzmann_double: ["Bottom", "Amp1", "V1", "Slope1", "Amp2", "V2", "Slope2"],
  power_law_cutoff: ["A", "B", "C"],
  probit_dr: ["Bottom", "Top", "Mu", "Sigma"],
  weibull_sigmoid: ["Bottom", "Top", "Scale", "Shape"],
  biphasic_dr_conc: ["Bottom", "Top", "Frac", "EC50_1", "nH1", "EC50_2", "nH2"],
  bell_dr_conc: ["Base", "Amplitude", "EC50_up", "nH_up", "EC50_down", "nH_down"],
  dr_norm_3pl_conc: ["EC50"],
  richards_dr: ["Bottom", "Top", "Midpoint", "Rate", "Shape"],
  hormesis_bc: ["Bottom", "Top", "f", "logEC50", "Slope"],
  // ── enzyme mechanism inhibition (global-fit only; [I] per-dataset constant) ──
  competitive_inhibition: ["Vmax", "KM", "Ki"],
  noncompetitive_inhibition: ["Vmax", "KM", "Ki"],
  uncompetitive_inhibition: ["Vmax", "KM", "Ki"],
  mixed_inhibition: ["Vmax", "KM", "Ki", "Alpha"],
  // ── centered polynomials (single-curve; X̄ is a data-derived const) + assoc kinetics ──
  poly2_centered: ["B0", "B1", "B2"],
  poly3_centered: ["B0", "B1", "B2", "B3"],
  poly4_centered: ["B0", "B1", "B2", "B3", "B4"],
  poly5_centered: ["B0", "B1", "B2", "B3", "B4", "B5"],
  poly6_centered: ["B0", "B1", "B2", "B3", "B4", "B5", "B6"],
  assoc_kinetics: ["Plateau", "kon", "koff"],
  motulsky_mahan: ["kon_L", "koff_L", "kon_I", "koff_I", "Bmax", "L"],
  // ── pharmacology: Schild, allosteric, operational, total/nonspecific (global fits; must mirror the engine registry) ──
  schild: ["Bottom", "Top", "logEC50", "HillSlope", "pA2", "SchildSlope"],
  allosteric_ec50: ["Bottom", "Top", "logEC50", "HillSlope", "logKB", "logAlpha"],
  operational: ["Basal", "Emax", "n", "logKA", "logTau"],
  operational_depletion: ["Basal", "Emax", "n", "logKA", "logTau"],
  total_nonspecific: ["Bmax", "Kd", "NS", "Background"],
  total_nonspecific_2site: ["Bmax1", "Kd1", "Bmax2", "Kd2", "NS", "Background"],
  // ── ligand depletion ──
  binding_depletion_ns: ["Bmax", "Kd", "NS"],
  total_nonspecific_depletion: ["Bmax", "Kd", "NS"],
};

/**
 * Curve-fit models that need a per-dataset constant (not a fitted parameter): id →
 * constant names, mirroring the engine registry's `consts`. These are global-fit-only
 * (each dataset is one value of the constant, e.g. the inhibitor concentration [I]).
 */
export const CURVE_FIT_CONSTS: Record<string, string[]> = {
  competitive_inhibition: ["[I]"],
  noncompetitive_inhibition: ["[I]"],
  uncompetitive_inhibition: ["[I]"],
  mixed_inhibition: ["[I]"],
  assoc_kinetics: ["[L]"],
  motulsky_mahan: ["[I]"],
  // ── pharmacology ──
  schild: ["[B]"],
  allosteric_ec50: ["[B]"],
  operational_depletion: ["q"],
  total_nonspecific: ["Spec"],
  total_nonspecific_2site: ["Spec"],
  total_nonspecific_depletion: ["Spec"],
};

/**
 * A tailored explanation for each per-dataset-constant global fit, shown beside the
 * constant's inputs in the fit settings.
 * Falls back to the enzyme-[I] wording when a model isn't listed here.
 */
export const CURVE_FIT_CONST_HINT: Record<string, string> = {
  motulsky_mahan:
    "Each curve is one competitor concentration [I] (X = time); enter it for every dataset — include an [I] = 0 (radioligand-alone) curve. Fix 'L' (the radioligand concentration, same for all) in the Constraints panel; the rate constants kon_L/koff_L/kon_I/koff_I and Bmax are shared across all curves.",
  schild:
    "Each curve is one antagonist concentration [B]; enter it for every dataset. Include a [B] = 0 (no-antagonist) reference curve. pA2 = −log(antagonist Kb) and the Schild slope are shared with the dose-response parameters across all curves.",
  allosteric_ec50:
    "Each curve is one allosteric-modulator concentration [B]; enter it for every dataset. Include a [B] = 0 reference. logKB (modulator affinity) and logAlpha (cooperativity: α>1 raises potency, α<1 lowers it) are shared with the dose-response parameters across all curves.",
  operational_depletion:
    "Each curve is measured at a known fractional receptor number q ∈ (0,1] (q = 1 for the untreated/control curve, smaller after receptor inactivation). Enter q for every dataset; the operational parameters (Emax, Basal, n, logKA, logTau) are shared.",
  total_nonspecific:
    "Mark each curve with Spec: 1 = total binding (specific + nonspecific), 0 = the nonspecific-only curve. Bmax, Kd, the nonspecific slope NS and background are shared across both.",
  total_nonspecific_2site:
    "Mark each curve with Spec: 1 = total binding, 0 = the nonspecific-only curve. Both sites' Bmax/Kd, the nonspecific slope NS and background are shared across the pair.",
  total_nonspecific_depletion:
    "Mark each curve with Spec: 1 = total binding, 0 = the nonspecific-only curve. Bmax/Kd/NS are shared; free ligand is solved per curve from mass conservation (use when a large fraction of the added ligand binds).",
};

/** Curve-fit equation id → a short analysis-name label (mirrors the engine registry). */
const CURVE_FIT_LABEL: Record<string, string> = {
  "4pl": "Dose-response 4PL", "3pl": "Dose-response 3PL", "5pl": "Dose-response 5PL",
  mm: "Michaelis-Menten", allosteric: "Allosteric sigmoidal", substrate_inhibition: "Substrate inhibition",
  enzyme_progress: "Enzyme progress curve",
  onesite: "One-site binding", hill_binding: "Specific binding (Hill)",
  boltzmann: "Boltzmann sigmoid",
  exp_decay: "One-phase decay", exp_decay2: "Two-phase decay", exp_assoc: "One-phase association",
  exp_growth: "Exponential growth", gompertz: "Gompertz growth", logistic_growth: "Logistic growth",
  gaussian: "Gaussian fit", lorentzian: "Lorentzian fit", poly2: "Quadratic fit", poly3: "Cubic fit",
  line_origin: "Line through origin", linear: "Linear fit", lowess: "LOWESS", spline: "Smoothing spline",
  // ── binding, growth, peaks, power ──
  twosite: "Two-site binding", onesite_ns: "One-site + nonspecific", hyperbola_offset: "Hyperbola + offset",
  homologous_competition: "Homologous competition",
  allosteric_binding: "Allosteric modulator (binding)",
  dr_3pl_conc: "Dose-response 3PL (conc)", dr_4pl_conc: "Dose-response 4PL (conc)",
  biexp_assoc: "Two-phase association", richards: "Richards growth", weibull_growth: "Weibull growth",
  von_bertalanffy: "Von Bertalanffy growth", gaussian_baseline: "Gaussian + baseline",
  lognormal_peak: "Log-normal peak", sine: "Sine wave", poly4: "Quartic fit", poly5: "Quintic fit",
  power: "Power law", power_offset: "Power law + offset",
  // ── decays, growth, peaks, periodic, simple ──
  exp_linear: "Decay + linear drift", exp_decay3: "Three-phase decay", stretched_exp: "Stretched exponential",
  logistic4_growth: "Logistic growth (4P)", gompertz4: "Gompertz (4P)", chapman_richards: "Chapman-Richards growth",
  ic50_4pl_conc: "Inhibition 4PL (conc)", gaussian2: "Double Gaussian", pseudo_voigt: "Pseudo-Voigt peak",
  damped_sine: "Damped sine", logarithmic: "Logarithmic", reciprocal: "Reciprocal", rational11: "Rational (1,1)",
  sqrt_fit: "Square-root", poly6: "Sextic fit",
  // ── normalized dose-response, inhibition, competition, kinetics ──
  dr_norm_3pl: "Normalized DR (3PL)", dr_norm_4pl: "Normalized DR (4PL)", dr_norm_4pl_conc: "Normalized DR 4PL (conc)",
  ic50_4pl_log: "Inhibition 4PL (log)", ic50_3pl_log: "Inhibition 3PL (log)", ic50_3pl_conc: "Inhibition 3PL (conc)",
  ic50_norm_4pl: "Inhibition normalized (4PL)", ic50_norm_3pl: "Inhibition normalized (3PL)",
  dr_5pl_conc: "Dose-response 5PL (conc)", biphasic_dr: "Biphasic dose-response", bell_dr: "Bell-shaped dose-response",
  competition_1site: "One-site competition", competition_2site: "Two-site competition",
  total_binding: "One-site total binding", plateau_then_decay: "Plateau then decay",
  plateau_then_assoc: "Plateau then association", assoc_then_dissoc: "Association then dissociation",
  segmental: "Segmental (broken line)", mmf_growth: "Morgan-Mercer-Flodin growth", gaussian3: "Sum of three Gaussians",
  // ── tight binding, peaks, periodic, sigmoids ──
  morrison_ki: "Morrison tight-binding Ki", binding_depletion: "Binding + ligand depletion",
  voigt: "Voigt peak", emg: "Exp-modified Gaussian", pearson7: "Pearson VII peak",
  sine2: "Two-harmonic sine", sine_drift: "Sine + linear drift", boltzmann_double: "Double Boltzmann",
  power_law_cutoff: "Power law + cutoff", probit_dr: "Probit dose-response", weibull_sigmoid: "Weibull sigmoid",
  biphasic_dr_conc: "Biphasic DR (conc)", bell_dr_conc: "Bell-shaped DR (conc)", dr_norm_3pl_conc: "Normalized DR 3PL (conc)",
  richards_dr: "Richards dose-response", hormesis_bc: "Hormesis (Brain-Cousens)",
  // ── enzyme mechanism inhibition ──
  competitive_inhibition: "Competitive inhibition", noncompetitive_inhibition: "Noncompetitive inhibition",
  uncompetitive_inhibition: "Uncompetitive inhibition", mixed_inhibition: "Mixed-model inhibition",
  // ── centered polynomials + association kinetics ──
  poly2_centered: "Quadratic (centered)", poly3_centered: "Cubic (centered)", poly4_centered: "Quartic (centered)",
  poly5_centered: "Quintic (centered)", poly6_centered: "Sextic (centered)", assoc_kinetics: "Association kinetics (multi-[L])",
  motulsky_mahan: "Competitive binding kinetics (Motulsky-Mahan)",
  // ── pharmacology ──
  schild: "Gaddum/Schild EC50 shift", allosteric_ec50: "Allosteric EC50 shift", operational: "Operational model (partial agonist)",
  operational_depletion: "Operational model (depletion)", total_nonspecific: "Total & nonspecific binding",
  total_nonspecific_2site: "Total & nonspecific binding (two sites)",
  binding_depletion_ns: "Total binding + ligand depletion",
  total_nonspecific_depletion: "Total & nonspecific binding + depletion",
};

const TTEST_LABEL: Record<string, string> = {
  "one-sample": "one-sample t",
  unpaired: "unpaired t",
  welch: "Welch t",
  paired: "paired t",
  "mann-whitney": "Mann-Whitney",
  wilcoxon: "Wilcoxon",
  "wilcoxon-1samp": "one-sample Wilcoxon",
  ks: "Kolmogorov-Smirnov",
  "ratio-paired": "ratio paired t",
};

/** A default analysis name from the method + chosen dataset names. */
export function defaultAnalysisName(method: string, params: AnalysisParams, table: DataTable): string {
  const name = (id?: NodeId): string => datasetName(table, id);
  const [c0, c1] = params.columns;
  if (method === "describe") return `Descriptives — ${name(c0)}`;
  if (method === "normality") return `Normality — ${name(c0)}`;
  if (method === "outliers") return `Outliers (${params.variant === "rout" ? "ROUT" : "Grubbs"}) — ${name(c0)}`;
  if (method === "pcorrect") {
    const LABEL: Record<string, string> = { bonferroni: "Bonferroni", holm: "Holm", "holm-sidak": "Holm-Šídák", sidak: "Šídák", fdr_bh: "BH FDR", fdr_by: "BY FDR" };
    return `P-value correction (${LABEL[params.variant ?? "holm"] ?? "Holm"}) — ${name(c0)}`;
  }
  if (method === "anova") {
    const label = params.variant === "kruskal" ? "Kruskal-Wallis" : "ANOVA";
    return `${label} — ${params.columns.map(name).join(", ")}`;
  }
  if (method === "metaanalysis") return `Meta-analysis${params.variant === "log" ? " (log scale)" : ""} — ${table.name}`;
  if (method === "publicationbias") return `Publication bias${params.variant === "log" ? " (log scale)" : ""} — ${table.name}`;
  if (method === "equivalence") {
    return params.variant === "one-sample"
      ? `Equivalence (TOST) — ${name(c0)}`
      : `Equivalence (TOST) — ${name(c0)} vs ${name(c1)}`;
  }
  if (method === "permutation") {
    return params.variant === "one-sample"
      ? `Permutation test — ${name(c0)}`
      : `Permutation test — ${name(c0)} vs ${name(c1)}`;
  }
  if (method === "bayesfactor") {
    return params.variant === "one-sample"
      ? `Bayes factor — ${name(c0)}`
      : `Bayes factor — ${name(c0)} vs ${name(c1)}`;
  }
  if (method === "twoway") return `Two-way ANOVA — ${params.columns.map(name).join(", ")}`;
  if (method === "nested") return `Nested ANOVA — ${params.columns.map(name).join(", ")}`;
  if (method === "goodnessoffit") return `Goodness-of-fit (χ²) — ${name(c0)}`;
  if (method === "rmanova") return `RM ANOVA — ${params.columns.map(name).join(", ")}`;
  if (method === "mixedanova") return `Mixed ANOVA — ${params.columns.map(name).join(", ")}`;
  if (method === "survival") return `Survival — ${params.columns.map(name).join(", ")}`;
  if (method === "cox") return `Cox regression — ${params.columns.slice(2).map(name).join(", ") || "time-to-event"}`;
  // The Paired variant runs McNemar's test, not χ² of independence — name it accordingly.
  if (method === "contingency") return `${params.variant === "paired" ? "McNemar" : "Chi-square"} — ${params.columns.map(name).join(" × ")}`;
  if (method === "correlation") {
    const label = params.variant === "spearman" ? "Spearman" : "Pearson";
    return `${label} — ${name(c0)} vs ${name(c1)}`;
  }
  if (method === "corrmatrix") {
    const label = params.variant === "spearman" ? "Spearman" : "Pearson";
    return `Correlation matrix (${label}) — ${params.columns.length} variables`;
  }
  if (method === "pca") return `PCA — ${params.columns.length} variables`;
  if (method === "pcoa" || method === "nmds") {
    const lbl = method === "pcoa" ? "PCoA" : "NMDS";
    const dist = params.metric ? ` (${params.metric})` : "";
    return `${lbl}${dist} — ${params.columns.length} variables`;
  }
  if (method === "ca") return `Correspondence analysis — ${params.columns.length} variables`;
  if (method === "varpart") {
    const blocks = [params.explanatory ?? [], params.explanatory2 ?? [], params.explanatory3 ?? []].filter((b) => b.length);
    const used = new Set(blocks.flat());
    const resp = params.columns.filter((c) => !used.has(c)).length;
    return `Variance partitioning — ${resp} response ~ ${blocks.length} blocks`;
  }
  if (method === "permanova") {
    const nv = params.columns.filter((c) => c !== params.groupBy).length;
    return `PERMANOVA (${params.metric ?? "euclidean"}) — ${nv} variables by ${params.groupBy ? name(params.groupBy) : "group"}`;
  }
  if (method === "rda" || method === "cca" || method === "dbrda") {
    const nx = params.explanatory?.length ?? 0;
    const resp = params.columns.filter((c) => !(params.explanatory ?? []).includes(c)).length;
    // db-RDA is the constrained method whose answer depends on the distance, so the title
    // names it — the same reason PCoA's does. RDA and CCA carry their geometry in the name.
    const lbl = method === "cca" ? "CCA" : method === "dbrda" ? `db-RDA (${params.metric ?? "braycurtis"})` : "RDA";
    return `${lbl} — ${resp} response ~ ${nx} explanatory`;
  }
  if (method === "cluster") {
    const kind = params.variant === "hierarchical" ? "Hierarchical clustering" : "k-means clustering";
    return `${kind} (k = ${params.k ?? 3}) — ${params.columns.length} variables`;
  }
  if (method === "regression") return `Regression — ${name(c1)} ~ ${name(c0)}`;
  if (method === "deming") return `Deming regression — ${name(c1)} vs ${name(c0)}`;
  if (method === "passingbablok") return `Passing-Bablok — ${name(c1)} vs ${name(c0)}`;
  if (method === "blandaltman") return `Bland-Altman — ${name(c0)} vs ${name(c1)}`;
  if (method === "multipleregression" || method === "logistic" || method === "poisson") {
    const [outcome, ...preds] = params.columns;
    const lbl = method === "logistic" ? "Logistic regression" : method === "poisson" ? "Poisson regression" : "Multiple regression";
    return `${lbl} — ${name(outcome)} ~ ${preds.map(name).join(" + ")}`;
  }
  if (method === "ancova") return `Compare lines (ANCOVA) — ${params.columns.map(name).join(", ")}`;
  if (method === "roc") return params.marker2 ? `Compare ROC — ${name(c0)} vs ${name(params.marker2)}` : `ROC — ${name(c1)} by ${name(c0)}`;
  if (method === "auc") return `Area under curve — ${name(c1)} vs ${name(c0)}`;
  if (method === "curvetransform") {
    const v = params.variant ?? "smooth";
    const label = v === "differentiate" ? "dY/dX" : v === "differentiate2" ? "d²Y/dX²" : v === "integrate" ? "∫Y·dX"
      : v === "lineweaver_burk" ? "Lineweaver-Burk" : v === "eadie_hofstee" ? "Eadie-Hofstee" : v === "hanes_woolf" ? "Hanes-Woolf"
      : "Smooth";
    return `${label} — ${name(c1)} vs ${name(c0)}`;
  }
  if (method === "curvefit") {
    return `${CURVE_FIT_LABEL[params.variant ?? "4pl"] ?? "Curve fit"} — ${name(c1)} vs ${name(c0)}`;
  }
  if (method === "interpolate") {
    return `Interpolate (${CURVE_FIT_LABEL[params.variant ?? "linear"] ?? "curve"}) — ${name(c1)} vs ${name(c0)}`;
  }
  if (method === "globalfit") {
    return `Global fit (${CURVE_FIT_LABEL[params.variant ?? "4pl"] ?? "curve"}) — ${params.columns.length} curves`;
  }
  if (method === "meltingtemp") {
    return `Melting temperature (Tm) — ${params.columns.length === 1 ? name(c0) : `${params.columns.length} samples`}`;
  }
  if (method === "comparefits") {
    const a = CURVE_FIT_LABEL[params.variant ?? "3pl"] ?? "model A";
    const b = CURVE_FIT_LABEL[params.variant2 ?? "4pl"] ?? "model B";
    return `Compare models (${a} vs ${b}) — ${name(c1)} vs ${name(c0)}`;
  }
  const label = TTEST_LABEL[params.variant ?? "unpaired"] ?? "t test";
  if (params.variant === "one-sample" || params.variant === "wilcoxon-1samp") return `${label} — ${name(c0)}`;
  return `${label} — ${name(c0)} vs ${name(c1)}`;
}

/** PCA result payload (the `extra.pca` block from the engine) needed to plot scores. */
export interface PcaScores {
  pcLabels: string[];
  scores: number[][]; // cases × PCs
  explained: number[]; // variance ratio per PC (0–1)
  groups?: Array<string | number | null> | undefined; // optional per-case group label
}

/** A score-plot table + its axis titles, derived from a PCA result. */
export interface PcaScorePlot {
  tableName: string;
  plotName: string;
  /** XY-table column names: [PC1, PC2] ungrouped, or [PC1, <group…>] grouped (shared X). */
  columnNames: string[];
  rows: Array<Array<number | string | null>>;
  xTitle: string;
  yTitle: string;
  /** True when split by group (each group is a series → its own confidence ellipse). */
  grouped: boolean;
}

/**
 * Build the PC1-vs-PC2 score-plot table from a PCA result. When per-case group
 * labels are present (and there's more than one group), every case keeps its own
 * X (PC1) on the shared X column and its PC2 goes into its group's Y column —
 * blank elsewhere — so each group renders as its own series (and thus its own
 * covariance/confidence ellipse). Without groups it's a single PC1/PC2 series.
 * Returns null when there aren't ≥ 3 cases with ≥ 2 components.
 */
export function buildPcaScorePlot(pca: PcaScores, sourceName: string): PcaScorePlot | null {
  const scores = pca.scores ?? [];
  if (scores.length < 3 || (scores[0]?.length ?? 0) < 2) return null;
  const l1 = pca.pcLabels?.[0] ?? "PC1";
  const l2 = pca.pcLabels?.[1] ?? "PC2";
  const pct = (i: number): string =>
    pca.explained?.[i] != null ? ` (${(pca.explained[i]! * 100).toFixed(1)}%)` : "";
  const xTitle = `${l1}${pct(0)}`;
  const yTitle = `${l2}${pct(1)}`;

  const groups = pca.groups;
  const grouped =
    !!groups && groups.length === scores.length && new Set(groups.map((g) => String(g))).size > 1;

  if (grouped) {
    const uniq = [...new Set(groups!.map((g) => String(g)))];
    const columnNames = [l1, ...uniq];
    const rows = scores.map((s, i) => {
      const row: Array<number | string | null> = new Array(1 + uniq.length).fill(null);
      row[0] = s[0]!;
      row[1 + uniq.indexOf(String(groups![i]))] = s[1]!;
      return row;
    });
    return { tableName: `PCA scores — ${sourceName}`, plotName: `PCA score plot — ${sourceName}`, columnNames, rows, xTitle, yTitle, grouped: true };
  }
  return {
    tableName: `PCA scores — ${sourceName}`,
    plotName: `PCA score plot — ${sourceName}`,
    columnNames: [l1, l2],
    rows: scores.map((s) => [s[0]!, s[1]!]),
    xTitle,
    yTitle,
    grouped: false,
  };
}
