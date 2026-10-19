/**
 * The builder-made reference lines — one registry, because they are one kind of object.
 *
 * Several chart kinds draw a guide line the user never added: Bland-Altman's bias and limits,
 * the forest no-effect line, the pyramid's centre, the PCA origin cross, estimation's control
 * mean, the volcano thresholds, the ROC chance diagonal, the paired dot's section dividers.
 * They have no entry in `plot.annotations` — the builder recomputes them from the data on
 * every rebuild — so without this registry a click on one would land on *"This annotation was
 * removed"*, and a panel writing to `seriesStyles` would change nothing.
 *
 * A horizontal threshold line must be stylable: a click on it opens its settings, with the
 * same edits an axis line has (thickness, colour, dash type, and so on).
 *
 * These lines sit at computed statistics, so they cannot be dragged or deleted: a bias line
 * moved by hand asserts a bias the data does not have, and a delete could not stick. The
 * supported operations are style and hide, which is what this registry is for.
 *
 * Note: the id is the key everywhere: the scene annotation's id, the selection's id, and the key
 * in `plot.refLineStyles` / `refLineHidden` / `refLineLabels`. Two of them (`roc-diag`,
 * `pd-section`) are not scene annotations — the ROC diagonal is a series and the paired-dot
 * dividers are part of that chart's geometry — but they are the same object to the user, so
 * they answer to the same panel and the same style keys.
 */
import type { LineDash, Plot, PlotKind } from "./model";

export interface ReferenceLineInfo {
  /** Stable id — the scene annotation id, and the key in `plot.refLineStyles`. */
  id: string;
  /** Panel heading. Names the line, never the mechanism. */
  name: string;
  /** One line saying what the line means, so the panel explains why it can't be dragged. */
  hint: string;
  /** Chart kinds that draw it. */
  kinds: PlotKind[];
  /** The look it has when nothing is overridden — shown as the "Auto" state of each control. */
  dash: LineDash;
  /** Built-in thickness px when nothing is overridden (the panel opens showing it). Default 1. */
  width?: number | undefined;
  /** Some lines exist only once an analysis has put something on the plot (the EC50/IC50
   *  marker needs a fit with a potency estimate) or the user has opted in (identity,
   *  trim-and-fill). Undefined = drawn on every plot of `kinds`. */
  present?: ((plot: Pick<Plot, "fit" | "fits" | "showIdentity" | "funnel" | "qq" | "manhattan">) => boolean) | undefined;
}

export const REFERENCE_LINES: readonly ReferenceLineInfo[] = [
  { id: "ba-bias", name: "Bias line", hint: "The mean difference between the two methods.", kinds: ["blandaltman"], dash: "solid" },
  // Note: "Upper limit" / "Lower limit", not "…of agreement": `blandaltman-reflines.test.tsx`
  // finds these switches by label, and it is the guard that proves hiding one line reaches
  // the drawing. Renaming the control would silently disable that guard.
  { id: "ba-loa-hi", name: "Upper limit", hint: "Bias + k × SD of the differences (the upper limit of agreement).", kinds: ["blandaltman"], dash: "dashed" },
  { id: "ba-loa-lo", name: "Lower limit", hint: "Bias − k × SD of the differences (the lower limit of agreement).", kinds: ["blandaltman"], dash: "dashed" },
  { id: "forest-ref", name: "No-effect line", hint: "The null value the studies are compared against (1 for ratios, 0 for differences).", kinds: ["forest"], dash: "dashed" },
  { id: "funnel-pooled", name: "Pooled-effect line", hint: "The meta-analysis pooled effect the funnel is centred on (fixed- or random-effects, per the Funnel panel).", kinds: ["funnel"], dash: "dashed" },
  { id: "funnel-adjusted", name: "Adjusted-effect line (trim-and-fill)", hint: "The pooled effect after trim-and-fill adds the imputed (hollow) studies. Drawn only while the Funnel panel's Trim-and-fill overlay is on and imputes at least one study.", kinds: ["funnel"], dash: "dotted", present: (p) => p.funnel?.trimFill === true },
  { id: "pyr-center", name: "Centre line", hint: "The zero axis the two groups mirror around.", kinds: ["pyramid"], dash: "solid" },
  { id: "pca-vzero", name: "Origin line (vertical)", hint: "Component 1 = 0.", kinds: ["pcascore", "pcaload", "pcabiplot", "triplot"], dash: "dotted" },
  { id: "pca-hzero", name: "Origin line (horizontal)", hint: "Component 2 = 0.", kinds: ["pcascore", "pcaload", "pcabiplot", "triplot"], dash: "dotted" },
  { id: "est-zero", name: "Control-mean line", hint: "Where the effect axis reads zero — the control group's mean.", kinds: ["estimation"], dash: "dashed" },
  { id: "vc-fc-pos", name: "Fold-change threshold (up)", hint: "The positive log₂ fold-change cut-off.", kinds: ["volcano"], dash: "dashed" },
  { id: "vc-fc-neg", name: "Fold-change threshold (down)", hint: "The negative log₂ fold-change cut-off.", kinds: ["volcano"], dash: "dashed" },
  { id: "vc-p", name: "Significance threshold", hint: "The −log₁₀ p cut-off.", kinds: ["volcano"], dash: "dashed" },
  { id: "roc-diag", name: "Chance diagonal", hint: "The line a test with no discrimination would follow (AUC 0.5).", kinds: ["roc"], dash: "dashed" },
  // GWAS QQ + Manhattan builder lines (registered so a click on them does not dead-end). The QQ
  // null diagonal is a series (id `qq-identity`) and the two Manhattan thresholds are hline scene
  // annotations, but they answer to the same style panel and `refLineStyles` keys — the roc-diag
  // precedent. Each is opt-out via its own toggle in the Chart-type panel, so `present` mirrors that.
  { id: "qq-identity", name: "y = x line", hint: "The uniform-null diagonal a well-calibrated set of p-values follows; real associations pull away above it at the top.", kinds: ["qq"], dash: "dashed", present: (p) => p.qq?.showIdentityLine !== false },
  { id: "manhattan-genomewide", name: "Genome-wide line", hint: "The genome-wide significance threshold (−log₁₀ of the P cut-off, p = 5×10⁻⁸ by default).", kinds: ["manhattan"], dash: "dashed", present: (p) => p.manhattan?.genomeWideLine !== false },
  { id: "manhattan-suggestive", name: "Suggestive line", hint: "The suggestive significance threshold (p = 1×10⁻⁵ by default).", kinds: ["manhattan"], dash: "dashed", present: (p) => p.manhattan?.suggestiveLine !== false },
  { id: "pd-section", name: "Section dividers", hint: "The rules between the labelled groups of rows. All of them share one style.", kinds: ["paireddot"], dash: "dashed" },
  // Line of identity (y = x): the diagonal a perfect agreement would follow, for
  // method-comparison scatter (Deming / Passing-Bablok / any XY). Opt-in — present only
  // when the user turns it on (`showIdentity`), so an ordinary XY graph is unchanged.
  { id: "identity", name: "Line of identity (y = x)", hint: "The diagonal a perfect X = Y agreement would follow. Drawn where the X and Y ranges overlap.", kinds: ["xy"], dash: "dashed", present: (p) => p.showIdentity === true },
  // The dose-response potency crosshair: a drop-line from the fitted curve to the dose axis
  // and a segment to the response axis, at the EC50/IC50 the fit found. Both lines share one
  // style. Present only once a fit with a potency estimate is attached
  // (fit-result lines must be selectable and styled like any other line). The kinds are the
  // ones whose builder draws `plot.fit` at all — the continuous XY family — and
  // `fit-style.test.tsx` derives that list from the builder.
  {
    id: "fit-marker",
    name: "EC50 / IC50 marker",
    hint: "The dose (and response) the fit found for the EC50 / IC50 — a drop-line to each axis.",
    kinds: ["xy", "area", "bubble", "volcano"],
    dash: "dashed",
    width: 1.5,
    present: (p) => !!(p.fit?.marker || p.fits?.some((f) => f.marker)),
  },
];

const BY_ID = new Map(REFERENCE_LINES.map((r) => [r.id, r]));

/** The registry entry for an id, or undefined when the id is an ordinary annotation. */
export function referenceLine(id: string): ReferenceLineInfo | undefined {
  return BY_ID.get(id);
}

/** Is this id a builder-made reference line? The renderer uses it to send a click on the line
 *  to the reference-line panel instead of the annotation panel. */
export function isReferenceLine(id: string): boolean {
  return BY_ID.has(id);
}

/** Every reference line a given chart kind can draw, in registry order. Pass the plot to
 *  drop the lines that need an attached analysis result it does not have (the EC50/IC50
 *  marker on a fit-less XY graph); without a plot, every line the kind can draw is listed. */
export function referenceLinesFor(kind: PlotKind | undefined, plot?: Pick<Plot, "fit" | "fits" | "showIdentity" | "funnel">): ReferenceLineInfo[] {
  const k = kind ?? "xy";
  return REFERENCE_LINES.filter((r) => r.kinds.includes(k) && (!plot || !r.present || r.present(plot)));
}
