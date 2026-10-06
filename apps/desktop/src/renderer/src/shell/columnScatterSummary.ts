import type { ColumnScatterStyle } from "@mady/core";

/** Column-scatter centre + spread choices — one dropdown, each option naming its own
 *  centre, exactly as `ERROR_TYPES` (Inspector) and `RIBBON_ERROR_OPTS` (panes) do for
 *  the rest of the app. A separate Centre × Error grid could build the incoherent
 *  "median ± SD/SEM/95% CI": SD, SEM and 95% CI are spread about the mean, so
 *  they never pair with a median centre. IQR / range / none are centre-agnostic, so both a
 *  mean and a median marker are offered for those (a mean + IQR column scatter is a
 *  legitimate combo — a mean marker with the IQR as spread — and stays available).
 *
 *  The plot model keeps `center` and `error` as two independent fields; this module is the
 *  single source that pairs them coherently for the UI. It never rewrites a saved plot:
 *  a saved graph carrying an incoherent pair still draws as saved (see `scatterSummaryKey`). */

export type ScatterCenter = NonNullable<ColumnScatterStyle["center"]>; // "mean" | "median"
export type ScatterError = NonNullable<ColumnScatterStyle["error"]>; // sd | sem | ci95 | iqr | range | ciMedian | none

export interface ScatterSummaryOption {
  /** Stable <select> value; also the string passed to the ribbon's `onSetSummary`. */
  readonly key: string;
  readonly label: string;
  readonly center: ScatterCenter;
  readonly error: ScatterError;
}

/** The coherent (centre, spread) pairs, in menu order. Mean-centred spreads first, then the
 *  median-centred (centre-agnostic) ones. */
export const SCATTER_SUMMARY_OPTS: readonly ScatterSummaryOption[] = [
  { key: "mean-none", label: "Mean only", center: "mean", error: "none" },
  { key: "sd", label: "Mean ± SD", center: "mean", error: "sd" },
  { key: "sem", label: "Mean ± SEM", center: "mean", error: "sem" },
  { key: "ci95", label: "Mean ± 95% CI", center: "mean", error: "ci95" },
  { key: "mean-range", label: "Mean + range", center: "mean", error: "range" },
  { key: "mean-iqr", label: "Mean + IQR (Q1–Q3)", center: "mean", error: "iqr" },
  { key: "median-none", label: "Median only", center: "median", error: "none" },
  { key: "median-iqr", label: "Median + IQR (Q1–Q3)", center: "median", error: "iqr" },
  { key: "median-ci", label: "Median + 95% CI of the median", center: "median", error: "ciMedian" },
  { key: "median-range", label: "Median + range", center: "median", error: "range" },
];

/** A (centre, spread) pair is incoherent when a mean-only spread is drawn about a median, or the
 *  CI of the median about a mean. This is the rule the SCATTER_SUMMARY_OPTS list is checked against. */
export function isIncoherentScatterSummary(center: ScatterCenter, error: ScatterError): boolean {
  return (center === "median" && (error === "sd" || error === "sem" || error === "ci95"))
    || (center === "mean" && error === "ciMedian");
}

/** The (centre, spread) an option key selects. Unknown key → the default (mean ± SD). */
export function scatterSummaryPair(key: string): { center: ScatterCenter; error: ScatterError } {
  const o = SCATTER_SUMMARY_OPTS.find((x) => x.key === key);
  return o ? { center: o.center, error: o.error } : { center: "mean", error: "sd" };
}

/** The dropdown value for a saved style. Default (undefined) → mean ± SD.
 *  A saved plot with the incoherent median + SD/SEM/95% CI has no option of its own, so it is shown as
 *  the matching mean variant — a display-only choice that does not rewrite the saved plot;
 *  the graph keeps drawing what it was saved with until the user picks a coherent option. */
export function scatterSummaryKey(cs?: ColumnScatterStyle): string {
  const center = cs?.center ?? "mean";
  const error = cs?.error ?? "sd";
  const exact = SCATTER_SUMMARY_OPTS.find((o) => o.center === center && o.error === error);
  if (exact) return exact.key;
  const byError = SCATTER_SUMMARY_OPTS.find((o) => o.center === "mean" && o.error === error);
  return byError ? byError.key : "sd";
}
