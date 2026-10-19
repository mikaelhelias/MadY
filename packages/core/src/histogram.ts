/**
 * Frequency distribution: bin a
 * column of values into a histogram table — counts, relative frequency, and the
 * cumulative versions — ready to plot as bars or a cumulative line. Pure +
 * DOM-free so the dialog previews cheaply and the result flows into `importTable`
 * like a reshape/transform.
 */
import type { NamedTable } from "./reshape";

export interface HistogramOptions {
  /** Explicit bin width. Overrides `bins` when > 0. */
  binWidth?: number;
  /** Target number of bins (used when no `binWidth`). Default: auto (√n, capped). */
  bins?: number;
  /** Start of the first bin (lower edge). Default: the data minimum. */
  origin?: number;
  /** Clamp the binned range to [min, max]; values outside are dropped. Default: data range. */
  range?: [number, number];
  /** Cumulate from the high end instead of the low end. Default false. */
  cumulativeFromTop?: boolean;
}

export interface HistogramBin {
  start: number;
  center: number;
  end: number;
  count: number;
  /** count / N. */
  fraction: number;
  /** 100 · fraction. */
  percent: number;
  cumCount: number;
  cumFraction: number;
  cumPercent: number;
}

/** Parse a cell to a finite number, or null. */


/**
 * Auto bin count — √n rounded, clamped to [1, 100]. (A common automatic
 * heuristic; the user can always override with width or count.)
 */
function autoBins(n: number): number {
  return Math.max(1, Math.min(100, Math.round(Math.sqrt(n))));
}

/**
 * Bin `values` into a histogram. A value lands in bin `i` when
 * `start + i·w ≤ v < start + (i+1)·w`; the final bin is closed on the right so
 * the maximum is included. Returns one entry per bin (empty bins included so the
 * axis stays evenly spaced).
 */
export function histogram(values: readonly number[], opts: HistogramOptions = {}): HistogramBin[] {
  const xs = values.filter((v) => Number.isFinite(v));
  const n = xs.length;
  if (n === 0) return [];
  let lo = opts.range ? opts.range[0] : Math.min(...xs);
  let hi = opts.range ? opts.range[1] : Math.max(...xs);
  if (opts.origin != null) lo = opts.origin;
  if (hi < lo) [lo, hi] = [hi, lo];
  const span = hi - lo;

  let width: number;
  let count: number;
  if (span <= 0) {
    // All values identical → a single degenerate bin holding every count.
    width = opts.binWidth && opts.binWidth > 0 ? opts.binWidth : 1;
    count = 1;
  } else if (opts.binWidth && opts.binWidth > 0) {
    width = opts.binWidth;
    count = Math.max(1, Math.ceil((span - 1e-9) / width));
  } else {
    count = Math.max(1, Math.floor(opts.bins ?? autoBins(n)));
    width = span / count;
  }

  const counts = new Array<number>(count).fill(0);
  const inRange = opts.range ? (v: number) => v >= lo && v <= hi : () => true;
  for (const v of xs) {
    if (!inRange(v)) continue;
    let idx = width > 0 ? Math.floor((v - lo) / width) : 0;
    if (idx < 0) idx = 0;
    if (idx >= count) idx = count - 1; // closed-right final bin (includes hi)
    counts[idx]! += 1;
  }
  const total = counts.reduce((a, b) => a + b, 0) || 1;

  const bins: HistogramBin[] = [];
  let cum = 0;
  const order = opts.cumulativeFromTop ? [...counts.keys()].reverse() : [...counts.keys()];
  const cumCounts = new Array<number>(count).fill(0);
  for (const i of order) {
    cum += counts[i]!;
    cumCounts[i] = cum;
  }
  for (let i = 0; i < count; i++) {
    const start = lo + i * width;
    const end = start + width;
    const c = counts[i]!;
    const cc = cumCounts[i]!;
    bins.push({
      start,
      end,
      center: start + width / 2,
      count: c,
      fraction: c / total,
      percent: (100 * c) / total,
      cumCount: cc,
      cumFraction: cc / total,
      cumPercent: (100 * cc) / total,
    });
  }
  return bins;
}

/** Round for display without trailing-zero noise. */
function r(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}

/** Standard-normal CDF Φ(z) via the Abramowitz-Stegun 7.1.26 erf (|error| < 1.5e-7). */
function normCdf(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const erf =
    1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) * Math.exp(-(z * z) / 2);
  const sign = z >= 0 ? 1 : -1;
  return 0.5 * (1 + sign * erf);
}

/** Mean + sample (n−1) SD of finite values. Returns null SD when n < 2 or SD = 0. */
function meanSd(xs: readonly number[]): { mean: number; sd: number | null; n: number } {
  const v = xs.filter((x) => Number.isFinite(x));
  const n = v.length;
  if (n === 0) return { mean: 0, sd: null, n: 0 };
  const mean = v.reduce((a, b) => a + b, 0) / n;
  if (n < 2) return { mean, sd: null, n };
  const ss = v.reduce((a, b) => a + (b - mean) ** 2, 0);
  const sd = Math.sqrt(ss / (n - 1));
  return { mean, sd: sd > 0 ? sd : null, n };
}

/**
 * Expected frequencies per bin under a Gaussian with the sample mean & SD of
 * `values` — the exact normal probability mass ∫ over each bin, Φ((end−μ)/σ) −
 * Φ((start−μ)/σ). Returns the expected count (mass · total), percent (100 · mass)
 * and fraction (mass) aligned to each bin, so it overlays the histogram bars on
 * the matching Y scale. Empty (null) when the SD is undefined (n<2 or all equal).
 */
export function gaussianExpected(
  values: readonly number[],
  bins: readonly HistogramBin[],
): { count: number; percent: number; fraction: number }[] | null {
  const { mean, sd } = meanSd(values);
  if (sd == null || bins.length === 0) return null;
  const total = bins.reduce((a, b) => a + b.count, 0) || 1;
  return bins.map((b) => {
    const mass = normCdf((b.end - mean) / sd) - normCdf((b.start - mean) / sd);
    return { count: total * mass, percent: 100 * mass, fraction: mass };
  });
}

/**
 * Build a plot-ready `NamedTable` from a histogram: a bin-centre X column plus
 * count / percent / cumulative columns, so the result can be charted as bars (use
 * Count or Relative %) or a cumulative line. `label` names the value column. With
 * `includeFractions`, the relative + cumulative frequencies are also emitted as
 * fractions (0–1), not only percentages — the "tabulate as fraction" option.
 */
export function histogramTable(
  bins: HistogramBin[],
  label = "Value",
  includeFractions = false,
  gaussianValues?: readonly number[],
): NamedTable {
  // Optional Gaussian overlay: expected frequencies per bin under the data's
  // best-fit normal (sample mean/SD), appended as extra Y columns aligned to the
  // bin-centre X so they overlay the bars as a bell curve.
  const exp = gaussianValues ? gaussianExpected(gaussianValues, bins) : null;
  const gCols = exp ? (includeFractions ? ["Expected count", "Expected %", "Expected fraction"] : ["Expected count", "Expected %"]) : [];
  const gRow = (i: number): number[] => {
    if (!exp) return [];
    const e = exp[i]!;
    return includeFractions ? [r(e.count), r(e.percent), r(e.fraction)] : [r(e.count), r(e.percent)];
  };
  if (includeFractions) {
    return {
      columnNames: [
        `${label} (bin centre)`, "Count", "Relative %", "Relative fraction",
        "Cumulative count", "Cumulative %", "Cumulative fraction", ...gCols,
      ],
      rows: bins.map((b, i) => [
        r(b.center), b.count, r(b.percent), r(b.fraction), b.cumCount, r(b.cumPercent), r(b.cumFraction), ...gRow(i),
      ]),
    };
  }
  return {
    columnNames: [`${label} (bin centre)`, "Count", "Relative %", "Cumulative count", "Cumulative %", ...gCols],
    rows: bins.map((b, i) => [r(b.center), b.count, r(b.percent), b.cumCount, r(b.cumPercent), ...gRow(i)]),
  };
}

/** Count `values` into `count` bins of the fixed grid at `lo` with width `w` (values
 *  clamp into the closed end bins). Used to re-bin each column onto a shared grid. */
function binCounts(values: readonly number[], lo: number, w: number, count: number): number[] {
  const counts = new Array<number>(count).fill(0);
  if (w <= 0) return counts;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    let idx = Math.floor((v - lo) / w);
    if (idx < 0) idx = 0;
    if (idx >= count) idx = count - 1;
    counts[idx]! += 1;
  }
  return counts;
}

/**
 * Multi-column frequency distribution (per-column / per-subcolumn binning):
 * bin several columns onto one shared bin grid — the grid is fixed from the pooled
 * values (respecting the same width/count/origin options) so the bars align across
 * columns, then each column is counted on that grid. Emits a bin-centre X column +
 * one Count column per input, ready to chart as grouped / overlaid histogram bars.
 */
export function histogramTableMulti(
  columns: { label: string; values: readonly number[] }[],
  opts: HistogramOptions = {},
): NamedTable {
  const all = columns.flatMap((c) => c.values.filter((v) => Number.isFinite(v)));
  if (columns.length === 0 || all.length === 0) return { columnNames: ["Bin centre"], rows: [] };
  const grid = histogram(all, opts); // pooled histogram fixes the shared bin edges
  if (grid.length === 0) return { columnNames: ["Bin centre"], rows: [] };
  const lo = grid[0]!.start;
  const w = grid[0]!.end - grid[0]!.start;
  const perCol = columns.map((c) => binCounts(c.values, lo, w, grid.length));
  return {
    columnNames: ["Bin centre", ...columns.map((c) => c.label)],
    rows: grid.map((b, i) => [r(b.center), ...perCol.map((cc) => cc[i]!)]),
  };
}

/**
 * Exact (unbinned) cumulative distribution — the empirical CDF, one row per
 * *distinct* value: the cumulative count / fraction / percent of observations
 * ≤ that value (or ≥, with `fromTop`). No bin-width choice is needed, which is
 * why it is recommended for cumulative plots. Charts as a step/line.
 */
export function exactCumulativeTable(
  values: readonly number[],
  label = "Value",
  opts: { fromTop?: boolean } = {},
): NamedTable {
  const columnNames = [label, "Cumulative count", "Cumulative fraction", "Cumulative %"];
  const xs = values.filter((v) => Number.isFinite(v)).slice().sort((a, b) => a - b);
  const n = xs.length;
  if (n === 0) return { columnNames, rows: [] };
  const rows: number[][] = [];
  let i = 0;
  while (i < n) {
    let j = i;
    while (j < n && xs[j] === xs[i]) j++;
    // j = # values ≤ xs[i]; i = # values < xs[i].
    const cc = opts.fromTop ? n - i : j;
    rows.push([r(xs[i]!), cc, r(cc / n), r((100 * cc) / n)]);
    i = j;
  }
  return { columnNames, rows };
}
