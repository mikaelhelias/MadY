/**
 * The Analyze landing's goal tiles ("Choose what you want to do") and the data-type
 * map behind them.
 *
 * A fixed list, identical for every datasheet, would show someone holding a table of
 * groups dose-response / enzyme-kinetics / binding first, with nothing indicating what
 * actually applies to their data. `rankGoals` orders and
 * flags them from the sheet's kind plus the live recommendations, so the landing
 * itself carries the advice. Nothing is ever hidden: a goal that does not match is
 * de-emphasised, never removed, because the catalogue must stay complete.
 */
import type { TableKind } from "@mady/core";

export interface GoalTile {
  key: string;
  label: string;
  sub: string;
  /** The analysis method the tile opens. */
  method: string;
  /** Optional guided focus (a curve-fit family) the tile scopes to. */
  focus?: string;
  /**
   * Other methods this tile stands for. "Compare groups" opens a t test but is also
   * the door to ANOVA and the other two-group tests — without this an ANOVA
   * recommendation would leave every tile unbadged, since no tile's `method` is "anova".
   */
  covers?: string[];
}

export const COMMON_ANALYSES: GoalTile[] = [
  { key: "dose-response", label: "Dose-response", sub: "EC50 / IC50", method: "curvefit", focus: "dose-response" },
  { key: "enzyme", label: "Enzyme kinetics", sub: "Vmax · KM", method: "curvefit", focus: "enzyme-kinetics" },
  { key: "binding", label: "Binding", sub: "Bmax · Kd", method: "curvefit", focus: "binding" },
  { key: "curvefit", label: "Curve fitting", sub: "any equation", method: "curvefit" },
  { key: "melt", label: "Melting temperature", sub: "Tm · ΔTm", method: "meltingtemp" },
  { key: "compare", label: "Compare groups", sub: "t-test · ANOVA", method: "ttest", covers: ["anova", "rmanova", "mixedanova", "equivalence", "permutation", "bayesfactor", "nested", "twoway", "mixedmodel", "multifactor"] },
  { key: "correlation", label: "Correlation", sub: "Pearson · Spearman", method: "correlation" },
  { key: "regression", label: "Regression", sub: "linear fit", method: "regression", covers: ["multipleregression", "logistic", "poisson", "ancova"] },
  { key: "survival", label: "Survival", sub: "Kaplan-Meier", method: "survival", covers: ["cox"] },
  { key: "roc", label: "ROC / diagnostic", sub: "sensitivity · AUC", method: "roc" },
  { key: "pca", label: "Multivariable", sub: "PCA · clustering", method: "pca", covers: ["cluster", "corrmatrix", "ca", "pcoa", "nmds", "rda", "cca", "dbrda", "permanova", "varpart"] },
  // These give every datasheet kind at least one tile that fits it — a contingency
  // or parts-of-whole sheet matches none of the tiles above.
  { key: "contingency", label: "Contingency", sub: "χ² · Fisher", method: "contingency" },
  { key: "proportions", label: "Proportions", sub: "goodness-of-fit", method: "goodnessoffit" },
  { key: "meta", label: "Meta-analysis", sub: "pool studies", method: "metaanalysis", covers: ["publicationbias"] },
];

/**
 * Landing-page data-type cards: each maps a `TableKind` to the analyses it unlocks —
 * a clean partition of every method, and the source of the method → kind map below.
 */
export const DATA_TYPE_CARDS: Array<{ kind: TableKind; blurb: string; methods: string[] }> = [
  // Equivalence / permutation / Bayes factor are two-group tests → column;
  // curve transform reads an X/Y pair → xy. A method on no card would read
  // "Not typical for this datasheet" everywhere and vanish under every filter.
  { kind: "column", blurb: "Groups of values", methods: ["describe", "normality", "outliers", "pcorrect", "ttest", "equivalence", "permutation", "bayesfactor", "anova"] },
  { kind: "grouped", blurb: "Two factors · repeated", methods: ["twoway", "rmanova", "mixedanova", "mixedmodel"] },
  { kind: "xy", blurb: "Correlate · fit · classify", methods: ["correlation", "regression", "deming", "passingbablok", "blandaltman", "curvefit", "interpolate", "globalfit", "comparefits", "meltingtemp", "roc", "auc", "curvetransform", "ancova"] },
  { kind: "contingency", blurb: "Counts in a table", methods: ["contingency"] },
  { kind: "partsofwhole", blurb: "Slices / proportions", methods: ["goodnessoffit"] },
  { kind: "survival", blurb: "Time-to-event", methods: ["survival", "cox"] },
  // A multivariable sheet supports correlation + regression explicitly —
  // not the whole XY set, which would make dose-response "suit" a table of Iris measurements.
  { kind: "multivariable", blurb: "Many measures per case", methods: ["correlation", "regression", "corrmatrix", "multipleregression", "logistic", "poisson", "ancova", "multifactor", "cox", "pca", "ca", "pcoa", "nmds", "rda", "cca", "dbrda", "permanova", "varpart", "cluster", "pcorrect"] },
  { kind: "nested", blurb: "Subgroups within groups", methods: ["nested"] },
  { kind: "meta", blurb: "Studies to pool", methods: ["metaanalysis", "publicationbias"] },
];

/** Reverse map: method id → its data-type card kind (filtering + "applies to your data"). */
export const METHOD_KIND: Record<string, TableKind> = Object.fromEntries(
  DATA_TYPE_CARDS.flatMap((c) => c.methods.map((m) => [m, c.kind])),
);

/**
 * Method id → every data type it belongs to. Some methods sit on two cards — Cox
 * regression is both a survival method and a multivariable one — and the single-valued
 * map above silently keeps only the last, so filtering on it would drop such a method out
 * of one of the catalogue's data-type filters.
 */
export const METHOD_KINDS: Record<string, TableKind[]> = DATA_TYPE_CARDS.reduce<Record<string, TableKind[]>>(
  (acc, card) => {
    for (const m of card.methods) (acc[m] ??= []).push(card.kind);
    return acc;
  },
  {},
);

/**
 * Which method-kinds suit each datasheet kind. Mostly identity, with the deliberate
 * widenings: grouped/nested sheets are still group comparisons. (A survival sheet does
 * not "fit" the column tests — that would be a t test on censored times — and a
 * multivariable sheet lists correlation/regression on its own card instead of borrowing
 * the whole XY set.)
 */
const KIND_FITS: Record<TableKind, TableKind[]> = {
  xy: ["xy"],
  column: ["column"],
  // A membership sheet unlocks no statistics — its analyses list is empty by design.
  sets: ["sets"],
  // A subject timeline is a drawing format too (a t test over Start vs End would be
  // offered but meaningless — the reason the swimmer has its own format, not the generic Column one).
  timeline: ["timeline"],
  // An edge list's rows are links, not cases — correlation/PCA/regression over its
  // (weight, node-attribute) columns would be offered but meaningless, the reason the
  // network has its own format rather than the Multiple-variables one.
  edgelist: ["edgelist"],
  // A meta-analysis sheet unlocks exactly one statistic — the pooling itself
  // (the "metaanalysis" method); Lower/Upper are a study's own confidence limits,
  // never groups to compare.
  meta: ["meta"],
  // A GWAS association sheet is a drawing format — its rows are pre-computed per-SNP
  // results (Chr/Position/P), not cases; t-tests/ANOVA/regression over them mislead.
  // The only statistic is the QQ's genomic inflation λ, computed by the drawing.
  association: ["association"],
  // An alterations sheet is a drawing format — its rows are alteration events (Sample/Gene/type),
  // not cases; case statistics do not apply. It only draws the oncoprint.
  alterations: ["alterations"],
  grouped: ["column", "grouped"],
  nested: ["column", "nested"],
  contingency: ["contingency"],
  partsofwhole: ["partsofwhole"],
  survival: ["survival"],
  multivariable: ["multivariable"],
  // A PCA / ordination sheet fits the same methods as multivariable (PCA, clustering, correlation
  // matrix) — those map to the "multivariable" method-kind.
  pca: ["multivariable", "pca"],
};

/**
 * Does this analysis suit that datasheet? Used by the catalogue list to mark what
 * fits — the same judgement the goal tiles use, so the two agree.
 */
export function methodFitsKind(method: string, kind: TableKind | undefined): boolean {
  const fits = (kind && KIND_FITS[kind]) || [];
  return (METHOD_KINDS[method] ?? []).some((k) => fits.includes(k));
}

export interface RankedGoal extends GoalTile {
  /** Suits this datasheet — shown at full strength. */
  applies: boolean;
  /** The live suggester proposed exactly this — badged. */
  recommended: boolean;
}

/**
 * Order the goal tiles for a datasheet: recommended first, then those that suit the
 * kind, then the rest (each band keeps its declared order). `recommended` accepts
 * method ids and guided-focus keys, so a dose-response suggestion lights the
 * Dose-response tile rather than all four curve-fit tiles at once.
 */
export function rankGoals(kind: TableKind | undefined, recommended: string[]): RankedGoal[] {
  const hits = new Set(recommended);
  const fits = (kind && KIND_FITS[kind]) || [];
  // Methods a recommendation pinned to a specific family (e.g. curvefit → the
  // dose-response family). The generic tile for such a method steps aside so the badge
  // lands on one tile: "Dose-response", not "Dose-response" and "Curve fitting".
  const focused = new Set(COMMON_ANALYSES.filter((g) => g.focus && hits.has(g.focus)).map((g) => g.method));
  const ranked = COMMON_ANALYSES.map((g) => {
    // A tile is hit by its own method or by any method it stands for.
    const hit = hits.has(g.method) || (g.covers ?? []).some((m) => hits.has(m));
    // A focused tile needs its focus named too, else every curve-fit recommendation
    // would badge Dose-response, Enzyme kinetics and Binding together.
    const isRecommended = hit && (g.focus ? hits.has(g.focus) : !focused.has(g.method));
    return {
      ...g,
      recommended: isRecommended,
      // The suggester read the actual values, so it outranks the coarse kind map.
      applies: isRecommended || hit || (METHOD_KINDS[g.method] ?? []).some((k) => fits.includes(k)),
    };
  });
  const band = (g: RankedGoal): number => (g.recommended ? 0 : g.applies ? 1 : 2);
  return ranked.map((g, i) => ({ g, i })).sort((a, b) => band(a.g) - band(b.g) || a.i - b.i).map(({ g }) => g);
}
