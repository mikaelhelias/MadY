/**
 * Turn an `AnalysisResult` into clean, exportable shapes — a rectangular grid of
 * its tidy results table (for CSV / Excel / clipboard) and the 1–2 headline "key
 * metrics" per method (for the stat-tab summary strip + the on-graph overlay).
 * Pure + DOM-free so it is unit-testable and reusable.
 */
import { fitEquation } from "@mady/core";
import { sciText } from "@mady/core";
import type { AnalysisResult, NodeId, Plot, TidyTerm } from "@mady/core";

/**
 * Canonical tidy-column order + human labels — the single source shared by the
 * on-screen TidyTable (panes.tsx) and the CSV/Excel/clipboard export, so an
 * exported table can never show a raw engine key ("aicc", "oddsRatio") where the
 * screen shows a proper label. `term`'s label is blank
 * because it is the row-label column; the export substitutes "Term" for its header.
 */
export const TIDY_COLUMNS: Array<{ key: string; label: string }> = [
  { key: "term", label: "" },
  { key: "estimate", label: "Estimate" },
  { key: "aicc", label: "AICc" },
  { key: "se", label: "SE" },
  { key: "statistic", label: "Statistic" },
  { key: "sse", label: "SSE" },
  { key: "params", label: "# params" },
  { key: "r2", label: "R²" },
  { key: "bic", label: "BIC" },
  { key: "probability", label: "Probability" },
  { key: "df", label: "df" },
  { key: "p", label: "p" },
  // An outlier's q-value (ROUT) and the critical G it was tested against (Grubbs): their own
  // columns, never ciLow, which is shown as a confidence limit.
  { key: "qValue", label: "q (FDR)" },
  { key: "gCritical", label: "Critical G" },
  { key: "ciLow", label: "95% CI low" },
  { key: "ciHigh", label: "95% CI high" },
  { key: "dependency", label: "Dependency" },
  { key: "skewness", label: "Skewness" },
  { key: "beta", label: "Std. β" },
  { key: "vif", label: "VIF" },
  { key: "oddsRatio", label: "Odds ratio" },
  { key: "orLow", label: "OR CI low" },
  { key: "orHigh", label: "OR CI high" },
  { key: "hazardRatio", label: "Hazard ratio" },
  { key: "hrLow", label: "HR CI low" },
  { key: "hrHigh", label: "HR CI high" },
  { key: "observed", label: "Observed" },
  { key: "expected", label: "Expected" },
  // A peak's x-extent (auc) — deliberately not ciLow/ciHigh: an x-range under a
  // "CI" header would present a number as a claim it is not.
  { key: "xFrom", label: "From X" },
  { key: "xTo", label: "To X" },
];

/** The display columns actually present in a tidy terms table (canonical order + labels;
 *  any unknown extra key is appended with the raw key as its label). `conf` is the
 *  analysis's confidence level: the CI column headers name it, so a 90/99% run is never
 *  exported under a "95%" label. */
export function tidyColumns(terms: TidyTerm[], conf?: number): Array<{ key: string; label: string }> {
  const pct = conf != null && conf > 0 && conf < 1 ? Math.round(conf * 1000) / 10 : 95;
  const relabel = (c: { key: string; label: string }): { key: string; label: string } =>
    c.key === "ciLow" ? { key: c.key, label: `${pct}% CI low` } :
    c.key === "ciHigh" ? { key: c.key, label: `${pct}% CI high` } : c;
  const known = new Set(TIDY_COLUMNS.map((c) => c.key));
  const extras = Array.from(new Set(terms.flatMap((t) => Object.keys(t)))).filter((k) => !known.has(k));
  return [...TIDY_COLUMNS.map(relabel), ...extras.map((k) => ({ key: k, label: k }))].filter((c) =>
    terms.some((t) => t[c.key] !== undefined && t[c.key] !== null),
  );
}

/**
 * Build a filled band `[x, low, high][]` from the parallel arrays an engine curve
 * ships (e.g. `curve.ciLow`/`curve.ciHigh` from a regression or nonlinear fit),
 * dropping any non-finite point. Returns undefined when the arrays are absent or
 * fewer than two finite points survive (nothing to fill) — so a fit without a band
 * cleanly overlays as just its line. Pure, so the overlay wiring is unit-testable.
 */
export function engineBand(
  x: readonly (number | null)[] | undefined,
  low: readonly (number | null)[] | undefined,
  high: readonly (number | null)[] | undefined,
): Array<[number, number, number]> | undefined {
  if (!x || !low || !high) return undefined;
  const fin = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);
  const band = x
    .map((xv, i) => [xv, low[i]!, high[i]!] as [number | null, number | null, number | null])
    .filter((p): p is [number, number, number] => fin(p[0]) && fin(p[1]) && fin(p[2]));
  return band.length >= 2 ? band : undefined;
}

/** The plot kinds whose builder draws `plot.fit` / `plot.fits` (the continuous-XY path). */
const FIT_OVERLAY_KINDS: ReadonlySet<string> = new Set(["xy", "area", "bubble", "volcano"]);

/**
 * The graph a fitted curve (curve fit · regression · global fit) should be written to:
 * the active plot when it is an XY-family plot of the source table, else the table's
 * first XY-family plot, else undefined. Never a plot of another kind: a bar/box builder
 * never reads `plot.fit`, so the fit would go nowhere.
 */
export function fitOverlayTarget(plots: readonly Plot[], tableId: NodeId, activePlotId: NodeId | undefined): Plot | undefined {
  const qualifies = (p: Plot): boolean => p.source === tableId && FIT_OVERLAY_KINDS.has(p.kind ?? "xy");
  const active = activePlotId ? plots.find((p) => p.id === activePlotId) : undefined;
  if (active && qualifies(active)) return active;
  return plots.find(qualifies);
}

export interface ResultGrid {
  columns: string[];
  /** Numbers stay numeric (so Excel gets real numbers); text stays text; blanks null. */
  rows: (string | number | null)[][];
}

/** PCA payload carried in `result.extra.pca` (mirrors the pane's PcaData). */
interface PcaExtra {
  varLabels: string[];
  pcLabels: string[];
  loadings: number[][];
  eigenvalues: number[];
  explained: number[];
}
/** Cluster payload carried in `result.extra.cluster` (mirrors the pane's ClusterData). */
interface ClusterExtra {
  sizes: number[];
  withinSS: number[];
  silhouette: number;
  centroids: number[][];
  varLabels: string[];
  standardized: boolean;
}

/** PCA export: the scree table with correct headers (eigenvalue / % variance / cumulative)
 *  + the loadings matrix — instead of the generic tidy labels ("95% CI low" etc.) that the
 *  on-screen pane refuses to use. */
function pcaGrid(p: PcaExtra): ResultGrid {
  const columns = ["Component", "Eigenvalue", "% variance", "Cumulative %"];
  const rows: (string | number | null)[][] = [];
  let cum = 0;
  p.pcLabels.forEach((pc, k) => {
    const pct = (p.explained[k] ?? 0) * 100;
    cum += pct;
    rows.push([pc, p.eigenvalues[k] ?? null, pct, cum]);
  });
  if (p.loadings?.length && p.varLabels?.length) {
    rows.push([]);
    rows.push(["Loadings (variable → component)"]);
    rows.push(["Variable", ...p.pcLabels]);
    p.varLabels.forEach((v, i) => rows.push([v, ...p.pcLabels.map((_, k) => p.loadings[i]?.[k] ?? null)]));
  }
  return { columns, rows };
}

/** Cluster export: per-cluster size / share / within-SS + the mean silhouette + the centroid
 *  matrix — the same figures the pane shows, correctly labelled. */
function clusterGrid(c: ClusterExtra): ResultGrid {
  const total = c.sizes.reduce((a, b) => a + b, 0) || 1;
  const columns = ["Cluster", "Size", "% of cases", "Within-SS"];
  const rows: (string | number | null)[][] = c.sizes.map((sz, i) => [
    `Cluster ${i + 1}`, sz, (sz / total) * 100, c.withinSS[i] ?? null,
  ]);
  rows.push([]);
  rows.push(["Mean silhouette width", Number.isFinite(c.silhouette) ? c.silhouette : null]);
  if (c.centroids?.length && c.varLabels?.length) {
    rows.push([]);
    rows.push([`Centroids (cluster → variable ${c.standardized ? "z-score" : "mean"})`]);
    rows.push(["Cluster", ...c.varLabels]);
    c.centroids.forEach((row, i) => rows.push([`Cluster ${i + 1}`, ...row]));
  }
  return { columns, rows };
}

/** A clean rectangular grid of an analysis's results table (header = column labels). PCA and
 *  cluster carry their real results in `result.extra` (not the tidy terms), so they get a
 *  dedicated, correctly-labelled grid; every other method uses the tidy columns. */
export function analysisResultGrid(result: AnalysisResult, conf?: number): ResultGrid {
  const extra = result.extra as { pca?: PcaExtra; cluster?: ClusterExtra } | undefined;
  if (extra?.pca && Array.isArray(extra.pca.loadings)) return pcaGrid(extra.pca);
  if (extra?.cluster && Array.isArray(extra.cluster.sizes)) return clusterGrid(extra.cluster);
  const cols = tidyColumns(result.terms, conf);
  // The term column's on-screen label is blank (row labels); an exported table needs a
  // real header for its first column.
  const columns = cols.map((c) => (c.key === "term" ? "Term" : c.label));
  const rows = result.terms.map((t) =>
    cols.map((c) => {
      const v = t[c.key];
      if (v === null || v === undefined) return null;
      return typeof v === "number" ? v : String(v);
    }),
  );
  return { columns, rows };
}

const csvField = (v: string | number | null): string => {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV of an analysis: a title line, the results table, then the plain-language summary. */
export function analysisToCsv(result: AnalysisResult, conf?: number): string {
  const grid = analysisResultGrid(result, conf);
  const body = [grid.columns, ...grid.rows].map((row) => row.map(csvField).join(",")).join("\r\n");
  const tail = result.summary ? `\r\n\r\n${csvField(result.summary)}` : "";
  return `${csvField(result.title)}\r\n\r\n${body}${tail}`;
}

/** Tab-separated results table (+ title/summary) for the clipboard — pastes cleanly
 *  into Excel / Sheets / Word as a real table. */
export function analysisToTsv(result: AnalysisResult, conf?: number): string {
  const grid = analysisResultGrid(result, conf);
  const cell = (v: string | number | null): string => (v == null ? "" : String(v));
  const body = [grid.columns, ...grid.rows].map((row) => row.map(cell).join("\t")).join("\n");
  const tail = result.summary ? `\n\n${result.summary}` : "";
  return `${result.title}\n\n${body}${tail}`;
}

/** Excel sheet names cap at 31 chars and forbid : \ / ? * [ ]. */
export function excelSheetName(title: string): string {
  return (title.replace(/[:\\/?*[\]]/g, " ").trim() || "Analysis").slice(0, 31);
}

// --- key metrics ----------------------------------------------------------
// The registry of every method's headline numbers lives in `keyResults.ts` (one source for
// the pane's stat cards, the prose, the caption and the on-graph annotation). Re-exported
// here for the modules that import them from this one.
export { fmtNum, fmtP, keyMetricLine, keyMetrics, type KeyMetric } from "./keyResults";


/**
 * The on-graph "best-fit equation" label for a curve fit / regression: the true
 * equation with fitted values where a closed form exists (`fitEquation`), else the
 * engine's parameter-value summary (a trailing period dropped). `null` for methods
 * that aren't a fit. `model` = the nonlinear model id (`analysis.params.variant`).
 */
export function fitEquationLabel(method: string, model: string | undefined, result: AnalysisResult): string | null {
  if (method !== "curvefit" && method !== "regression") return null;
  const eq = fitEquation(method, model, result.glance as Record<string, number | string | null | undefined>);
  if (eq) return eq;
  const s = result.summary?.trim();
  return s ? s.replace(/\.\s*$/, "") : null;
}

/** Compact dose formatting for the potency label (3 sig-figs, ×10ⁿ for extremes).
 *  Unicode rather than markup: this label is also copied out as plain text. */
function fmtDose(v: number): string {
  return sciText(v);
}

/** Linear-interpolate `ys` at `x` over ascending `xs`; null if `x` is outside the range. */
function interpAt(xs: readonly number[], ys: readonly number[], x: number): number | null {
  const lo = xs[0]!;
  const hi = xs[xs.length - 1]!;
  if (x < Math.min(lo, hi) || x > Math.max(lo, hi)) return null;
  for (let i = 1; i < xs.length; i++) {
    const x0 = xs[i - 1]!;
    const x1 = xs[i]!;
    if ((x >= x0 && x <= x1) || (x <= x0 && x >= x1)) {
      if (x1 === x0) return ys[i - 1]!;
      const t = (x - x0) / (x1 - x0);
      return ys[i - 1]! + t * (ys[i]! - ys[i - 1]!);
    }
  }
  return ys[ys.length - 1]!;
}

/**
 * The crosshair for a melting-temperature curve: Tm on X, the fitted signal at Tm read off the
 * sampled curve, labelled "Tm = 52.1 °C" (one decimal; the unit as written in X's header, none when
 * blank). Drop-line only: the signal level at Tm is not a result.
 * `null` when Tm is missing or outside the sampled curve.
 */
export function meltMarker(curve: { x: readonly number[]; y: readonly number[] }, tm: number | null | undefined, unit: string): { x: number; y: number; label: string; dropOnly: true } | null {
  if (tm == null || !Number.isFinite(tm) || curve.x.length < 2 || curve.x.length !== curve.y.length) return null;
  const y = interpAt(curve.x, curve.y, tm);
  if (y == null || !Number.isFinite(y)) return null;
  // One decimal, always ("52.0", not "52" beside "55.4") — how a melting temperature is quoted.
  const txt = Math.abs(tm) < 1e4 ? tm.toFixed(1) : fmtDose(tm);
  return { x: tm, y, label: `Tm = ${txt}${unit ? ` ${unit}` : ""}`, dropOnly: true };
}

/**
 * The dose-response potency crosshair for a curve fit: the EC50/IC50 dose (from
 * `glance`, already in concentration units) + the response at that dose (read off
 * the fitted curve) + a value label. `null` for fits with no potency estimate, or
 * when the dose falls outside the sampled curve. Feeds `PlotFit.marker` so the
 * graph draws a drop-line to the X-axis at the dose (rather than a horizontal line at 50%).
 */
export function fitDoseMarker(result: AnalysisResult): { x: number; y: number; label: string } | null {
  const g = result.glance as Record<string, number | string | null | undefined>;
  const ic = typeof g["IC50"] === "number" ? (g["IC50"] as number) : undefined;
  const ec = typeof g["EC50"] === "number" ? (g["EC50"] as number) : undefined;
  const dose = ic ?? ec;
  if (dose == null || !Number.isFinite(dose)) return null;
  const curve = (result as unknown as { curve?: { x?: number[]; y?: number[] } }).curve;
  const xs = curve?.x;
  const ys = curve?.y;
  if (!xs || !ys || xs.length < 2 || xs.length !== ys.length) return null;
  const y = interpAt(xs, ys, dose);
  if (y == null || !Number.isFinite(y)) return null;
  return { x: dose, y, label: `${ic != null ? "IC50" : "EC50"} = ${fmtDose(dose)}` };
}
