/**
 * The key result of every analysis — the 2–4 numbers a reader came for, named the way a
 * paper names them, plus the one-line verdict those numbers support.
 *
 * One registry, three consumers: the analysis pane's stat cards (`keyResultCards`), the
 * Methods/Results prose and the figure caption (`keyMetrics`, a list of `{label, value}`),
 * and the on-graph "key stats" annotation (`keyMetricLine`).
 * A method missing from the registry falls back to "whatever p is in glance", which shows
 * nothing for a Bayes factor, a PCA, a meta-analysis or a Bland-Altman. `keyResults.test.ts`
 * runs every method's real engine output (the fixture is captured from `crosscheck.py`'s
 * payloads) through this file and fails the build when a method has no headline.
 *
 * Reading order inside a spec is the reading order on screen: the decision first (a p, a
 * Bayes factor, a preferred model), then the size of the thing (an effect size, a slope, a
 * hazard ratio), then the fit or the count.
 */
import type { AnalysisResult, TidyTerm } from "@mady/core";
import { sciText } from "@mady/core";

export interface KeyMetric {
  label: string;
  value: string;
}

/** One stat card. `text` is the one-line "label = value" form the prose + captions print. */
export interface KeyResultCard {
  /** What the number is, as the reader names it ("p", "Cohen's d", "Hazard ratio"). */
  label: string;
  /** The formatted number (or word) shown large. */
  value: string;
  /** "label = value", or "p < 0.0001" — the one-line form. */
  text: string;
  /** Small print under the value: a CI, a df, an n. */
  detail?: string | undefined;
  /** How to colour it: a p at/over the threshold is muted, a p under it is emphasised;
   *  everything else is neutral. */
  tone: "sig" | "ns" | "neutral";
  /** True for a p-value card (drives the significance tone + the "p < 0.0001" floor). */
  isP: boolean;
  /** A p card's unrounded value. The verdict decides on this, never on `value`: 0.049975 prints "0.05". */
  pRaw?: number | undefined;
}

export interface KeyResult {
  cards: KeyResultCard[];
  /** The one-sentence decision the cards support ("Statistically significant at α = 0.05",
   *  "Equivalent within the bounds", "AICc prefers the 4PL model"), or undefined when the
   *  method makes no decision (descriptives, a PCA). */
  verdict?: string | undefined;
}

/** The significance threshold the engine's own wording uses (`_p_words`). One constant. */
export const P_THRESHOLD = 0.05;

/** p-value display with a custom label (default "p"): <0.0001 floor, else 3 sig figs. */
export function fmtP(p: number, label = "p"): string {
  const name = label || "p";
  return p < 0.0001 ? `${name} < 0.0001` : `${name} = ${Number(p.toPrecision(3))}`;
}
export function fmtNum(v: number): string {
  return sciText(v, 4);
}
const pValue = (p: number): string => (p < 0.0001 ? "< 0.0001" : String(Number(p.toPrecision(3))));

// ── the registry ───────────────────────────────────────────────────────────────

/**
 * Where a card's number comes from: a `glance` scalar (`key`), or a field of the first
 * results row whose name matches (`term` + `field`). `ci: true` prints the row's CI under
 * the value; `df` names the glance key that carries the statistic's df.
 */
interface CardSpec {
  label: string;
  key?: string;
  term?: RegExp;
  field?: "estimate" | "statistic" | "p" | "df";
  p?: boolean;
  ci?: boolean;
  df?: string;
  /** Print as a percentage of 1 (0.75 → 75%). */
  percent?: boolean;
  /** A unit the engine already applied (a value of 67.3 with `suffix: "%"` prints 67.3%). */
  suffix?: string;
  /** A whole number (n, a count). */
  int?: boolean;
  /** Name the card after the term row this matches, minus the pattern ("Pearson r (observed)" → "Pearson r"). */
  labelFrom?: RegExp;
  /** Show the card only when this holds for the result. */
  when?: (g: AnalysisResult["glance"]) => boolean;
  /** Print two glance keys as a range ("-0.5 to 0.5"). */
  range?: [string, string];
}

/**
 * The verdict, when the method makes a decision that is not simply "p under the
 * threshold": read a glance value and say it in words. `alpha` is the analysis's own level.
 */
type VerdictFn = (g: AnalysisResult["glance"], terms: TidyTerm[], alpha: number) => string | undefined;

/** A result shape whose cards cannot be read off fixed keys (they depend on what the run found). */
type CardsFn = (result: AnalysisResult, conf: number | undefined) => KeyResultCard[] | undefined;

/** "Significant at α = 0.05: A, B", or that nothing is — for results that test several effects at once. */
function effectsVerdict(effects: [string, unknown][]): string | undefined {
  const tested = effects.filter((e): e is [string, number] => isNum(e[1]));
  if (tested.length === 0) return undefined;
  const sig = tested.filter(([, p]) => p < P_THRESHOLD).map(([name]) => name);
  return sig.length ? `Significant at α = ${P_THRESHOLD}: ${sig.join(", ")}` : `No effect is statistically significant at α = ${P_THRESHOLD}`;
}

function pCard(label: string, p: number): KeyResultCard {
  return { label, value: pValue(p), text: fmtP(p, label === "p" ? "" : label), tone: p < P_THRESHOLD ? "sig" : "ns", isP: true, pRaw: p };
}

const CURVE_PARAMS = [
  ["EC50", "EC50"], ["IC50", "IC50"], ["ec50", "EC50"], ["ic50", "IC50"], ["kd", "Kd"], ["Kd", "Kd"],
  ["km", "KM"], ["KM", "KM"], ["vmax", "Vmax"], ["Vmax", "Vmax"], ["kcat", "kcat"], ["bmax", "Bmax"],
  ["Bmax", "Bmax"], ["k", "k"], ["half_life", "Half-life"], ["Half_life", "Half-life"], ["tau", "τ"], ["hill_slope", "Hill slope"],
  ["slope", "slope"], ["ki", "Ki"], ["Ki", "Ki"],
  // Two-site models carry two of each; without these a biphasic fit would headline Bottom and Top.
  ["EC50_1", "1st EC50"], ["EC50_2", "2nd EC50"], ["EC50_up", "Rising EC50"], ["EC50_down", "Falling EC50"],
  ["IC50_1", "1st IC50"], ["IC50_2", "2nd IC50"],
] as const;

const REGISTRY: Record<string, { cards: CardSpec[]; verdict?: VerdictFn; build?: CardsFn }> = {
  // Centre, spread, size — the three numbers every descriptives paragraph quotes.
  describe: { cards: [{ label: "Mean", key: "mean" }, { label: "SD", key: "sd" }, { label: "n", key: "n", int: true }] },
  normality: {
    cards: [{ label: "Shapiro-Wilk p", key: "shapiro_p", p: true }, { label: "W", key: "shapiro_W" }, { label: "n", key: "n", int: true }],
    // At the analysis's own level: the engine judges normality at α = 1 − confidence, so a 99% run
    // with p = 0.012 is consistent with normal (a fixed 0.05 would say otherwise).
    verdict: (g, _t, alpha) => {
      const p = g["shapiro_p"];
      const prefers = g["prefers"];
      const fit = typeof p === "number" ? (p < alpha ? "Departs from normal" : "Consistent with normal") : undefined;
      return [fit, typeof prefers === "string" ? `more consistent with ${prefers}` : undefined].filter(Boolean).join(" · ") || undefined;
    },
  },
  ttest: {
    cards: [
      { label: "p", key: "p", p: true },
      { label: "Cohen's d", key: "cohens_d" },
      // "Median − μ" is the one-sample Wilcoxon's effect; a ratio is not a difference (no change is 1, not 0).
      { label: "Difference", term: /^Difference|^Mean difference|^Median difference|^Mean of differences|^Median − /, field: "estimate", ci: true },
      { label: "Geometric mean ratio", term: /^Geometric mean ratio/, field: "estimate", ci: true },
      { label: "t", key: "t", df: "df" },
      { label: "U", key: "U" },
      { label: "W", key: "W" },
      { label: "D", key: "D" },
      { label: "Hedges' g", key: "hedges_g" },
    ],
  },
  equivalence: {
    cards: [
      { label: "TOST p", key: "p", p: true },
      { label: "Difference", key: "difference" },
      { label: "Bounds", range: ["bound_low", "bound_high"] },
    ],
    // The engine sends a JSON boolean here; the glance type does not name booleans.
    verdict: (g) => {
      const eq = g["equivalent"] as unknown;
      return eq === true ? "Equivalent within the bounds" : eq === false ? "Not shown equivalent" : undefined;
    },
  },
  permutation: {
    cards: [
      { label: "p (permutation)", key: "p", p: true },
      { label: "Observed", key: "statistic", labelFrom: / \(observed\)$/ },
      { label: "Rearrangements", key: "n_permutations", int: true },
    ],
  },
  bayesfactor: {
    cards: [
      { label: "BF10", key: "bf10" },
      { label: "BF01", key: "bf01" },
      { label: "Cohen's d", key: "cohens_d" },
    ],
    verdict: (_g, terms) => {
      const row = terms.find((t) => t["term"] === "Interpretation");
      const v = row?.["estimate"];
      return typeof v === "string" ? v.charAt(0).toUpperCase() + v.slice(1) : undefined;
    },
  },
  anova1: {
    cards: [
      { label: "p", key: "p", p: true },
      { label: "F", key: "F", df: "df_between,df_within" },
      { label: "H", key: "H" },
      { label: "χ²", key: "chi_sq" },
      { label: "η²", key: "eta_sq" },
    ],
  },
  rmanova: {
    cards: [
      { label: "p", key: "p", p: true },
      { label: "F", key: "F", df: "df_cond,df_resid" },
      { label: "χ²", key: "chi_sq" },
      { label: "partial η²", key: "partial_eta_sq" },
      { label: "Kendall's W", key: "kendalls_w" },
    ],
  },
  mixedanova: {
    cards: [
      { label: "p (groups)", key: "p_groups", p: true },
      { label: "p (time, Greenhouse-Geisser)", key: "p_time_gg", p: true },
      { label: "p (groups × time, Greenhouse-Geisser)", key: "p_inter_gg", p: true },
      { label: "Greenhouse-Geisser ε", key: "gg_epsilon" },
    ],
    // Three tests — one verdict each, never the first p for all three (as for the two-way ANOVA).
    verdict: (g) => effectsVerdict([["groups", g["p_groups"]], ["time", g["p_time_gg"]], ["groups × time", g["p_inter_gg"]]]),
  },
  twoway: {
    cards: [
      { label: "p (row factor)", key: "p_a", p: true },
      { label: "p (column factor)", key: "p_b", p: true },
      { label: "p (interaction)", key: "p_ab", p: true },
    ],
    // Three tests, so no single "significant / not": letting the first p decide it would make a column-only
    // effect (p < 0.0001) read "Not statistically significant".
    verdict: (g) => effectsVerdict([["row factor", g["p_a"]], ["column factor", g["p_b"]], ["interaction", g["p_ab"]]]),
  },
  multifactor: {
    cards: [{ label: "R²", key: "r_sq" }],
    // Every effect row by name, in table order (factors before their interactions), so the 2nd-4th factors get
    // cards too and the verdict covers every factor rather than following the first alone.
    build: (result) => {
      const effects = result.terms.filter((t) => String(t.term) !== "Residual" && isNum(t.p));
      const cards = effects.slice(0, 3).map((t) => pCard(`p (${String(t.term)})`, t.p as number));
      const r2 = result.glance?.["r_sq"];
      if (isNum(r2)) cards.push({ label: "R²", value: fmtNum(r2), text: `R² = ${fmtNum(r2)}`, tone: "neutral", isP: false });
      return cards;
    },
    verdict: (_g, terms) => effectsVerdict(terms.filter((t) => String(t.term) !== "Residual").map((t) => [String(t.term), t.p])),
  },
  nested: { cards: [{ label: "p", key: "p", p: true }, { label: "F", key: "f_groups", df: "df_groups,df_subgroups" }, { label: "Nested t", key: "t" }] },
  mixedmodel: {
    cards: [
      { label: "ICC", key: "icc" },
      { label: "Group variance", key: "group_var" },
      { label: "Residual variance", key: "resid_var" },
    ],
  },
  correlation: {
    cards: [{ label: "r", key: "r" }, { label: "ρ", key: "rho" }, { label: "τ", key: "tau" }, { label: "p", key: "p", p: true }, { label: "R²", key: "r_sq" }],
    // A Spearman run writes its ρ under glance `r` (and ρ² under `r_sq`); only the title says which it is.
    build: (result) => {
      if (!/Spearman/.test(result.title ?? "")) return undefined;
      return [
        buildCard({ label: "ρ", key: "r" }, result, undefined),
        buildCard({ label: "p", key: "p", p: true }, result, undefined),
        buildCard({ label: "ρ²", key: "r_sq" }, result, undefined),
      ].filter((c): c is KeyResultCard => !!c);
    },
  },
  corrmatrix: {
    cards: [
      { label: "Strongest |r|", term: /./, field: "estimate" },
      { label: "Variables", key: "variables", int: true },
      { label: "Pairs", key: "pairs", int: true },
    ],
  },
  regression: { cards: [{ label: "R²", key: "r_sq" }, { label: "slope", key: "slope" }, { label: "slope p", key: "p", p: true }] },
  multipleregression: { cards: [{ label: "R²", key: "r_sq" }, { label: "Adjusted R²", key: "adj_r_sq" }, { label: "Model p", key: "p", p: true }] },
  logistic: { cards: [{ label: "Model p", key: "p", p: true }, { label: "McFadden R²", key: "mcfadden_r_sq" }, { label: "Accuracy", key: "accuracy", percent: true }] },
  poisson: { cards: [{ label: "Model p", key: "p", p: true }, { label: "McFadden R²", key: "mcfadden_r_sq" }, { label: "Dispersion", key: "dispersion" }] },
  ancova: {
    cards: [{ label: "p (slopes equal)", key: "p_slope", p: true }, { label: "p (intercepts equal)", key: "p_intercept", p: true }, { label: "Slope difference", key: "slope_diff" }],
    // The engine's own reading: slopes first; only parallel lines make the intercept test mean anything. Letting the
    // first p decide would make parallel lines with clearly different intercepts read "Not statistically significant".
    verdict: (g) => {
      const ps = g["p_slope"];
      const pi = g["p_intercept"];
      if (!isNum(ps)) return undefined;
      if (ps < P_THRESHOLD) return "The slopes differ — the lines are not parallel";
      if (!isNum(pi)) return "Parallel slopes";
      return pi < P_THRESHOLD ? "Parallel slopes — the intercepts differ" : "Parallel slopes — the intercepts do not differ";
    },
  },
  contingency: {
    cards: [
      { label: "p", key: "p", p: true },
      { label: "χ²", key: "chi_sq", df: "df" },
      { label: "Odds ratio", key: "odds_ratio" },
      { label: "Cramér's V", key: "cramers_v" },
    ],
    // McNemar (paired 2×2) shares the method id. Its summary reports the exact p when there are fewer than 25
    // discordant pairs, while glance `p` is always the χ² one - and the two can fall on opposite sides of 0.05 (13 vs 4 pairs:
    // χ² p = 0.0523, exact p = 0.049). The card uses the p the summary uses. Same rule as `engine.contingency`.
    build: (result) => {
      const g = result.glance ?? {};
      if (!isNum(g["mcnemar_chi_sq"])) return undefined;
      const disc = Number(g["b"]) + Number(g["c"]);
      const exact = Number.isFinite(disc) && disc < 25 && isNum(g["exact_p"]);
      const cards: KeyResultCard[] = [];
      if (exact) cards.push(pCard("p (exact)", g["exact_p"] as number));
      else if (isNum(g["p"])) {
        cards.push(pCard("p", g["p"]));
        cards.push({ label: "McNemar χ²", value: fmtNum(g["mcnemar_chi_sq"]), text: `McNemar χ² = ${fmtNum(g["mcnemar_chi_sq"])}`, detail: dfText(g, "df"), tone: "neutral", isP: false });
      }
      return cards;
    },
  },
  goodnessoffit: { cards: [{ label: "p", key: "p", p: true }, { label: "χ²", key: "chi_sq", df: "df" }, { label: "N", key: "n", int: true }] },
  survival: {
    cards: [
      { label: "Log-rank p", key: "p", p: true },
      { label: "Hazard ratio", key: "hazard_ratio" },
      { label: "χ²", key: "chi_sq", df: "df" },
      { label: "Groups", key: "groups", int: true },
    ],
  },
  cox: { cards: [{ label: "Model p", key: "p", p: true }, { label: "Concordance", key: "concordance" }, { label: "Events", key: "events", int: true }] },
  roc: { cards: [{ label: "AUC", key: "auc", ci: true, term: /^AUC/ }, { label: "Sensitivity", key: "sensitivity", percent: true }, { label: "Specificity", key: "specificity", percent: true }] },
  auc: { cards: [{ label: "Net area", key: "net" }, { label: "Peak area", key: "peak_area" }, { label: "Peaks", key: "peaks", int: true }] },
  deming: {
    cards: [{ label: "Slope", term: /^Slope/, field: "estimate", ci: true }, { label: "Intercept", term: /^Intercept/, field: "estimate", ci: true }, { label: "r", key: "r" }],
    verdict: (_g, terms) => agreementVerdict(terms),
  },
  passingbablok: {
    cards: [{ label: "Slope", term: /^Slope/, field: "estimate", ci: true }, { label: "Intercept", term: /^Intercept/, field: "estimate", ci: true }, { label: "n", key: "n", int: true }],
    verdict: (_g, terms) => agreementVerdict(terms),
  },
  blandaltman: {
    cards: [{ label: "Bias", key: "bias" }, { label: "Lower LoA", key: "loa_lower" }, { label: "Upper LoA", key: "loa_upper" }],
    // A percent-difference run is in % of the mean; printed bare, -18.35 would read as measurement units.
    build: (result) => {
      const percent = (result.extra?.["blandaltman"] as { percent?: unknown } | undefined)?.percent === true;
      if (!percent) return undefined;
      return [["Bias", "bias"], ["Lower LoA", "loa_lower"], ["Upper LoA", "loa_upper"]].flatMap(([label, key]) => {
        const v = result.glance?.[key!];
        return isNum(v) ? [{ label: label!, value: `${fmtNum(v)}%`, text: `${label} = ${fmtNum(v)}%`, tone: "neutral" as const, isP: false }] : [];
      });
    },
  },
  pca: { cards: [{ label: "PC1", key: "pc1_pct", suffix: "%" }, { label: "PC2", key: "pc2_pct", suffix: "%" }, { label: "Retained", key: "retained", int: true }] },
  // An ordination has no p-value: the headline is how much of the structure the map shows.
  // A constrained ordination does have a p — it is the one ordination that tests something.
  rda: {
    cards: [{ label: "p", key: "p", p: true }, { label: "Adjusted R²", key: "adjR2" }, { label: "Pseudo-F", key: "pseudoF" }],
  },
  // …and the other two constrained ordinations report the same three, because they answer the
  // same question in a different geometry. Written out rather than aliased: the registry is a
  // default-deny list read key by key against the engine's real output, and a shared reference
  // would make a missing key look deliberate.
  cca: {
    cards: [{ label: "p", key: "p", p: true }, { label: "Adjusted R²", key: "adjR2" }, { label: "Pseudo-F", key: "pseudoF" }],
  },
  dbrda: {
    cards: [{ label: "p", key: "p", p: true }, { label: "Adjusted R²", key: "adjR2" }, { label: "Pseudo-F", key: "pseudoF" }],
  },
  // PERMANOVA: the permutation p leads, then how much the grouping explains and the pseudo-F; PERMDISP's p
  // is shown because a significant PERMANOVA with unequal spread is ambiguous, and the verdict says which case it is.
  permanova: {
    cards: [
      { label: "p (permutation)", key: "p", p: true },
      { label: "R²", key: "r2" },
      { label: "Pseudo-F", key: "pseudoF", df: "df_groups,df_resid" },
      { label: "PERMDISP p", key: "disp_p", p: true },
    ],
    verdict: (g) => {
      const p = g["p"];
      const dp = g["disp_p"];
      if (!isNum(p)) return undefined;
      if (p >= P_THRESHOLD) return `No significant difference between the groups at α = ${P_THRESHOLD}`;
      return isNum(dp) && dp < P_THRESHOLD
        ? "The groups differ — but so does their spread, so the difference may be in dispersion"
        : "The groups differ in position (their spread does not differ significantly)";
    },
  },
  // Variance partitioning has no single p — the shared fractions have no test at all — so the
  // headline is the split itself: how much the blocks explain together, how much nothing
  // explains, and which single fraction is the largest.
  varpart: {
    cards: [
      { label: "Explained", key: "explained", percent: true },
      { label: "Unexplained", key: "residual", percent: true },
      { label: "Blocks", key: "blocks", int: true },
    ],
    verdict: (g) => {
      const big = typeof g["largest"] === "string" ? (g["largest"] as string) : undefined;
      const pct = typeof g["largest_pct"] === "number" ? (g["largest_pct"] as number) : undefined;
      if (!big || pct === undefined) return undefined;
      return `Largest fraction: ${big} at ${pct.toFixed(1)}% of the variation.`;
    },
  },
  ca: { cards: [{ label: "CA1", key: "axis1_pct", suffix: "%" }, { label: "CA2", key: "axis2_pct", suffix: "%" }, { label: "Inertia", key: "inertia" }] },
  pcoa: { cards: [{ label: "PCoA1", key: "axis1_pct", suffix: "%" }, { label: "PCoA2", key: "axis2_pct", suffix: "%" }, { label: "Cases", key: "cases", int: true }] },
  nmds: {
    cards: [{ label: "Stress", key: "stress" }, { label: "Fit R²", key: "nonMetricR2" }, { label: "Dimensions", key: "dimensions", int: true }],
    // Stress is the whole verdict on an NMDS map — Clarke (1993)'s bands, said in words.
    verdict: (g) => {
      const s = typeof g["stress"] === "number" ? (g["stress"] as number) : undefined;
      if (s === undefined) return undefined;
      return s < 0.1 ? "Stress < 0.1 — a good map"
        : s < 0.2 ? "Stress < 0.2 — a usable map"
        : s < 0.3 ? "Stress < 0.3 — a poor map, read it with care"
        : "Stress ≥ 0.3 — close to arbitrary, do not interpret the layout";
    },
  },
  cluster: { cards: [{ label: "Clusters", key: "clusters", int: true }, { label: "Silhouette", key: "silhouette" }, { label: "Suggested k", key: "suggestedK", int: true }] },
  curvefit: { cards: [{ label: "R²", key: "r_sq" }] },
  globalfit: {
    cards: [{ label: "R²", key: "r_sq" }],
    // With "one curve for all datasets?" ticked, that test is the question asked: its p leads (then R² and the
    // fitted parameters, added below as for any global fit).
    build: (result) => {
      const p = result.glance?.["compare_p"];
      if (!isNum(p)) return undefined;
      const r2 = buildCard({ label: "R²", key: "r_sq" }, result, undefined);
      return [pCard("p (one curve for all)", p), ...(r2 ? [r2] : [])];
    },
    verdict: (g) => {
      const p = g["compare_p"];
      return isNum(p) ? (p < P_THRESHOLD ? "The datasets need separate curves" : "One curve fits all the datasets") : undefined;
    },
  },
  meltingtemp: {
    cards: [{ label: "Tm", key: "tm" }],
    // With a control, the shift is the question: ΔTm rows lead, then each sample's fitted Tm (up to four cards).
    build: (result) => {
      const rows = result.terms.filter((t) => isNum(t.estimate) && /^(ΔTm vs |Tm \(fit\) — )/.test(String(t.term)));
      rows.sort((a, b) => Number(!String(a.term).startsWith("ΔTm")) - Number(!String(b.term).startsWith("ΔTm")));
      return rows.slice(0, 4).map((t) => ({
        label: String(t.term), value: fmtNum(t.estimate as number), text: `${String(t.term)} = ${fmtNum(t.estimate as number)}`,
        tone: "neutral" as const, isP: false, detail: ciText(t, undefined),
      }));
    },
  },
  comparefits: {
    cards: [{ label: "ΔAICc", key: "delta_aicc" }, { label: "P (preferred)", key: "prob_b" }, { label: "Extra-SS F p", key: "f_p", p: true }],
    // `prob_b` is model B's probability whichever model won, so the preferred model's own key is read: a 3PL
    // preferred at 98.9% must show "P (preferred) = 0.989", not 0.011.
    build: (result) => {
      const g = result.glance ?? {};
      const probKey = g["preferred"] === g["model_a"] ? "prob_a" : "prob_b";
      return [
        buildCard({ label: "ΔAICc", key: "delta_aicc" }, result, undefined),
        buildCard({ label: "P (preferred)", key: probKey }, result, undefined),
        buildCard({ label: "Extra-SS F p", key: "f_p", p: true }, result, undefined),
      ].filter((c): c is KeyResultCard => !!c);
    },
    verdict: (g, terms) => (typeof g["preferred"] === "string" ? `AICc prefers ${titleOf(g, g["preferred"], terms)}` : undefined),
  },
  interpolate: {
    cards: [{ label: "Sy.x", key: "syx" }],
    // glance `n` is the number of standards on the curve; each unknown read is one "X @ Y=…" / "Y @ X=…" row.
    build: (result) => {
      const read = result.terms.filter((t) => / @ [XY]=/.test(String(t.term))).length;
      const syx = buildCard({ label: "Sy.x", key: "syx" }, result, undefined);
      return [{ label: "Unknowns read", value: String(read), text: `Unknowns read = ${read}`, tone: "neutral" as const, isP: false }, ...(syx ? [syx] : [])];
    },
  },
  curvetransform: { cards: [{ label: "Vmax (implied)", key: "vmax" }, { label: "KM (implied)", key: "km" }, { label: "Slope", key: "slope" }, { label: "Area", key: "area" }] },
  montecarlo: { cards: [{ label: "Fits", key: "iterations", int: true }, { label: "Converged", key: "conv_rate", suffix: "%" }] },
  outliers: { cards: [{ label: "Outliers removed", key: "removed", int: true }, { label: "n (input)", key: "n_in", int: true }, { label: "n (cleaned)", key: "n_clean", int: true }] },
  pcorrect: { cards: [{ label: "Significant", key: "n_significant", int: true }, { label: "of", key: "n", int: true }, { label: "α", key: "alpha" }] },
  metaanalysis: {
    cards: [
      { label: "Pooled (random)", term: /^Pooled — random/, field: "estimate", ci: true },
      { label: "p (random)", term: /^Pooled — random/, field: "p", p: true },
      { label: "I²", key: "I² (%)", suffix: "%" },
      { label: "Studies", key: "k", int: true },
    ],
  },
  publicationbias: {
    cards: [
      { label: "Egger p", key: "Egger p", p: true },
      { label: "Imputed studies", key: "k₀ (imputed)", int: true },
      { label: "Adjusted (random)", key: "adjusted (random)" },
    ],
    verdict: (g) => {
      const p = g["Egger p"];
      return typeof p === "number" ? (p < P_THRESHOLD ? "Funnel asymmetry detected" : "No significant funnel asymmetry") : undefined;
    },
  },
  power: {
    // "n per group" only for a design with groups: a paired t, a one-sample t, an ANOVA's total or a correlation's n is not.
    cards: [{ label: "Power", key: "power" }, { label: "n per group", key: "n", int: true, when: (g) => g["per_group"] === true }, { label: "Effect size", key: "effect" }, { label: "Total N", key: "total", int: true }],
  },
};
// The UI names one-way ANOVA "anova"; the engine stamps "anova1". Same headline.
REGISTRY["anova"] = REGISTRY["anova1"]!;

/** Deming / Passing-Bablok: the methods agree when the slope CI holds 1 and the intercept CI holds 0. */
function agreementVerdict(terms: TidyTerm[]): string | undefined {
  const slope = terms.find((t) => /^Slope/.test(String(t["term"])));
  const icpt = terms.find((t) => /^Intercept/.test(String(t["term"])));
  const holds = (t: TidyTerm | undefined, v: number): boolean | undefined =>
    t && typeof t.ciLow === "number" && typeof t.ciHigh === "number" ? t.ciLow <= v && v <= t.ciHigh : undefined;
  const s = holds(slope, 1);
  const i = holds(icpt, 0);
  if (s === undefined || i === undefined) return undefined;
  if (s && i) return "The methods agree (slope CI holds 1, intercept CI holds 0)";
  return s ? "Constant bias — the intercept CI excludes 0" : i ? "Proportional bias — the slope CI excludes 1" : "The methods differ";
}

function titleOf(g: AnalysisResult["glance"], id: string, terms: TidyTerm[] = []): string {
  // comparefits stores model ids in glance; the human titles are its first two term rows, model A then model B.
  // The engine writes no `title_a`/`title_b`, so the term row supplies the title; the upper-cased id is the last resort.
  const idx = g["model_a"] === id ? 0 : g["model_b"] === id ? 1 : -1;
  const key = idx === 0 ? "title_a" : idx === 1 ? "title_b" : undefined;
  const t = key ? g[key] : undefined;
  if (typeof t === "string") return t;
  const row = idx >= 0 ? terms[idx]?.term : undefined;
  return typeof row === "string" && row ? row : String(id).toUpperCase();
}

// ── building the cards ──────────────────────────────────────────────────────────

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function dfText(g: AnalysisResult["glance"], spec: string | undefined): string | undefined {
  if (!spec) return undefined;
  const parts = spec.split(",").map((k) => g[k.trim()]).filter((v) => v !== null && v !== undefined);
  return parts.length ? `df ${parts.map(String).join(", ")}` : undefined;
}

function ciText(t: TidyTerm | undefined, conf: number | undefined): string | undefined {
  if (!t || !isNum(t.ciLow) || !isNum(t.ciHigh)) return undefined;
  const level = conf ? Math.round(conf * 100) : 95;
  return `${level}% CI ${fmtNum(t.ciLow)} to ${fmtNum(t.ciHigh)}`;
}

function buildCard(spec: CardSpec, result: AnalysisResult, conf: number | undefined, alpha = P_THRESHOLD): KeyResultCard | undefined {
  const g = result.glance ?? {};
  if (spec.when && !spec.when(g)) return undefined;
  if (spec.range) {
    const [lo, hi] = [g[spec.range[0]], g[spec.range[1]]];
    if (!isNum(lo) || !isNum(hi)) return undefined;
    const value = `${fmtNum(lo)} to ${fmtNum(hi)}`;
    return { label: spec.label, value, text: `${spec.label} = ${value}`, tone: "neutral", isP: false };
  }
  let raw: number | string | boolean | null | undefined;
  let row: TidyTerm | undefined;
  if (spec.term) {
    if (spec.label === "Strongest |r|") {
      row = result.terms.filter((t) => isNum(t.estimate)).sort((a, b) => Math.abs(b.estimate as number) - Math.abs(a.estimate as number))[0];
      // A Spearman matrix holds ρ, and its title says so.
      const sym = /Spearman/.test(result.title ?? "") ? "ρ" : "r";
      if (row) return { label: `Strongest: ${row.term}`, value: fmtNum(row.estimate as number), text: `${sym}(${row.term}) = ${fmtNum(row.estimate as number)}`, tone: "neutral", isP: false, detail: isNum(row.p) ? fmtP(row.p) : undefined };
      return undefined;
    }
    row = result.terms.find((t) => spec.term!.test(String(t["term"] ?? "")));
    raw = row?.[spec.field ?? "estimate"];
    if ((raw === null || raw === undefined) && spec.key) raw = g[spec.key];
  } else if (spec.key) {
    raw = g[spec.key];
    if (spec.ci) row = result.terms.find((t) => (spec.term ?? /a^/).test(String(t["term"] ?? "")));
  }
  if (raw === null || raw === undefined) return undefined;
  const named = spec.labelFrom ? result.terms.find((t) => spec.labelFrom!.test(String(t["term"] ?? ""))) : undefined;
  const label = named ? String(named.term).replace(spec.labelFrom!, "") : spec.label;
  if (typeof raw === "string") return { label, value: raw, text: `${label} = ${raw}`, tone: "neutral", isP: false };
  if (!isNum(raw)) return undefined;
  if (spec.p) {
    return { label, value: pValue(raw), text: fmtP(raw, label === "p" ? "" : label), tone: raw < alpha ? "sig" : "ns", isP: true, pRaw: raw };
  }
  const value = spec.int ? String(Math.round(raw)) : spec.percent ? `${sciText(raw * 100, 3)}%` : spec.suffix ? `${sciText(raw, 3)}${spec.suffix}` : fmtNum(raw);
  const detail = [spec.ci ? ciText(row, conf) : undefined, dfText(g, spec.df)].filter(Boolean).join(" · ") || undefined;
  return { label, value, text: `${label} = ${value}`, detail, tone: "neutral", isP: false };
}

/** Curve fits: R² plus the model's own headline parameters, in the order a paper quotes them. */
function curveParamCards(result: AnalysisResult): KeyResultCard[] {
  const g = result.glance ?? {};
  const out: KeyResultCard[] = [];
  const seen = new Set<string>();
  if (result.method === "globalfit") {
    /*
     * A global fit's glance holds no parameter values (datasets, shared, n, R² only), so a glance lookup would
     * always miss and a fallback would show the first two table rows - "Bottom (shared)", "Top (shared)" - leaving
     * the EC50s unshown. Its parameters are table rows named "EC50 (shared)" or "EC50 — Cpd A". Ki leads: in an
     * inhibition fit it is the result.
     */
    const labels = [...new Set(["Ki", ...CURVE_PARAMS.map(([, l]) => l)])];
    for (const label of labels) {
      const rows = result.terms.filter((t) => isNum(t.estimate) && (String(t.term) === label || String(t.term).startsWith(`${label} (shared)`) || String(t.term).startsWith(`${label} — `)));
      rows.sort((a, b) => Number(!String(a.term).includes("(shared)")) - Number(!String(b.term).includes("(shared)")));
      for (const t of rows) {
        out.push({ label: String(t.term), value: fmtNum(t.estimate as number), text: `${String(t.term)} = ${fmtNum(t.estimate as number)}`, tone: "neutral", isP: false, detail: ciText(t, undefined) });
        if (out.length === 2) return out;
      }
    }
    if (out.length) return out;
  }
  for (const [key, label] of CURVE_PARAMS) {
    const v = g[key];
    if (!isNum(v) || seen.has(label)) continue;
    const row = result.terms.find((t) => String(t["term"]).toLowerCase() === label.toLowerCase() || String(t["term"]).toLowerCase() === key.toLowerCase());
    out.push({ label, value: fmtNum(v), text: `${label} = ${fmtNum(v)}`, tone: "neutral", isP: false, detail: ciText(row, undefined) });
    seen.add(label);
    if (out.length === 2) break;
  }
  if (out.length === 0) {
    // A model without a named headline parameter (polynomial, user equation): its first
    // two fitted parameters, straight from the table.
    for (const t of result.terms) {
      if (!isNum(t.estimate) || /^R²|^Adjusted|^Sy\.x|^Sum of squares|^Points|^Overall/.test(String(t.term))) continue;
      out.push({ label: String(t.term), value: fmtNum(t.estimate), text: `${String(t.term)} = ${fmtNum(t.estimate)}`, tone: "neutral", isP: false, detail: ciText(t, undefined) });
      if (out.length >= 2) break;
    }
  }
  return out;
}

/**
 * ROC comparing two markers on the same subjects (DeLong). The engine keeps the method id `roc` for both shapes, so
 * the single-marker spec (AUC · sensitivity · specificity) would otherwise read this one too - and show only the
 * first marker's AUC, with no p and no verdict. The comparison is the result: the DeLong p
 * first, then the AUC difference with its CI, then each marker's AUC by name. Recognised by `auc_diff`, which only
 * the comparison writes.
 */
function rocCompareCards(result: AnalysisResult, conf: number | undefined): KeyResultCard[] | undefined {
  const g = result.glance ?? {};
  if (result.method !== "roc" || !isNum(g["auc_diff"])) return undefined;
  const out: KeyResultCard[] = [];
  const p = g["p"];
  if (isNum(p)) out.push({ label: "DeLong p", value: pValue(p), text: fmtP(p, "DeLong p"), tone: p < P_THRESHOLD ? "sig" : "ns", isP: true, pRaw: p });
  const diff = result.terms.find((t) => /^AUC difference/.test(String(t["term"] ?? "")));
  if (diff && isNum(diff.estimate)) {
    const label = String(diff.term);
    out.push({ label, value: fmtNum(diff.estimate), text: `${label} = ${fmtNum(diff.estimate)}`, detail: ciText(diff, conf), tone: "neutral", isP: false });
  }
  for (const t of result.terms.filter((r) => /^AUC \(/.test(String(r["term"] ?? "")))) {
    if (!isNum(t.estimate)) continue;
    const label = String(t.term);
    out.push({ label, value: fmtNum(t.estimate), text: `${label} = ${fmtNum(t.estimate)}`, tone: "neutral", isP: false });
  }
  return out;
}

/**
 * The key result of an analysis: 1–4 cards + a verdict. `conf` (the analysis's own
 * confidence level) labels any CI printed under a card.
 */
export function keyResultCards(result: AnalysisResult, conf?: number | undefined): KeyResult {
  const spec = REGISTRY[result.method];
  const cards: KeyResultCard[] = [];
  const seen = new Set<string>();
  const push = (c: KeyResultCard | undefined): void => {
    if (!c || seen.has(c.label) || cards.length >= 4) return;
    seen.add(c.label);
    cards.push(c);
  };
  // Normality is judged at the analysis's own level, as the engine judges it (α = 1 − confidence).
  const alpha = result.method === "normality" && isNum(conf) ? 1 - conf : P_THRESHOLD;
  const rocCompare = rocCompareCards(result, conf);
  const built = rocCompare ? undefined : spec?.build?.(result, conf);
  if (rocCompare) {
    for (const c of rocCompare) push(c);
  } else if (built) {
    for (const c of built) push(c);
  } else if (spec) {
    for (const s of spec.cards) {
      push(buildCard(s, result, conf, alpha));
      if (cards.length >= (result.method === "curvefit" || result.method === "globalfit" ? 1 : 4)) break;
    }
  }
  if (result.method === "curvefit" || result.method === "globalfit") for (const c of curveParamCards(result)) push(c);
  // Fallback for a method the registry does not know: any p-value in glance.
  if (cards.length === 0 && isNum(result.glance?.["p"])) push(pCard("p", result.glance["p"] as number));
  let verdict = spec?.verdict?.(result.glance ?? {}, result.terms, alpha);
  if (!verdict) {
    const p = cards.find((c) => c.isP);
    if (p) {
      // The unrounded p. `value` is rounded to 3 figures, so p = 0.049975 prints "0.05"; judging on it would
      // call the result not significant while the card itself is toned significant.
      const raw = isNum(p.pRaw) ? p.pRaw : Number(p.value.replace(/[<\s]/g, ""));
      verdict = (Number.isFinite(raw) && raw < P_THRESHOLD) || (!isNum(p.pRaw) && p.value.startsWith("<"))
        ? `Statistically significant at α = ${P_THRESHOLD}`
        : `Not statistically significant at α = ${P_THRESHOLD}`;
    }
  }
  return { cards, verdict };
}

/**
 * The 1–3 headline metrics of an analysis as "label = value" strings (t-test → p +
 * Cohen's d; regression → R² + slope + slope p). The prose and caption consumers; the same
 * registry as the cards, so the paragraph and the pane cannot disagree.
 */
export function keyMetrics(result: AnalysisResult): KeyMetric[] {
  return keyResultCards(result).cards.slice(0, 3).map((c) => ({ label: c.isP && c.label === "p" ? "" : c.label, value: c.text }));
}

/** One-line key-metric string for an on-graph stats annotation, e.g. "p < 0.0001 · Cohen's d = 1.2". */
export function keyMetricLine(result: AnalysisResult): string {
  return keyMetrics(result).map((m) => m.value).join("  ·  ");
}
