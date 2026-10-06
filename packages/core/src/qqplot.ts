/**
 * Normal probability (QQ) plot: for a column of
 * values, pair each ordered observation with its theoretical normal quantile, so
 * the points fall on a straight line when the data are Gaussian. Pure + DOM-free
 * so the dialog previews cheaply and the result flows into `importTable` like a
 * transform — then it is charted as an XY scatter (points) plus the reference
 * line. Reuses the inverse-normal CDF from `transform.ts` (`normInv`).
 */
import type { CellValue } from "./model";
import type { NamedTable } from "./reshape";
import { normInv } from "./transform";

/** Plotting-position convention → the `(i − a)/(n + 1 − 2a)` offset `a`. */
export type PlotPosition = "blom" | "hazen" | "weibull";

const POSITION_A: Record<PlotPosition, number> = {
  blom: 0.375, // (i − 3/8)/(n + 1/4) — best for a normal QQ (the conventional default)
  hazen: 0.5, // (i − 1/2)/n
  weibull: 0.0, // i/(n + 1)
};

export interface QQPoint {
  /** Theoretical standard-normal quantile (x-axis). */
  z: number;
  /** Ordered sample value (y-axis). */
  value: number;
  /** Reference-line y at this z: mean + z·SD (where the points lie if Gaussian). */
  reference: number;
}

export interface QQResult {
  points: QQPoint[];
  /** Reference line y = intercept + slope·z, with slope = SD, intercept = mean. */
  slope: number;
  intercept: number;
  mean: number;
  sd: number;
  n: number;
}

/** Parse a cell to a finite number, or null. */
function asNumber(v: CellValue | undefined): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Build the normal-probability points for a set of values: sort ascending, assign
 * each a plotting position `pᵢ = (i − a)/(n + 1 − 2a)`, take the standard-normal
 * quantile `zᵢ = Φ⁻¹(pᵢ)`, and pair it with the ordered value. The reference line
 * is `mean + z·SD` — where the points would lie under perfect normality.
 */
export function normalProbabilityPlot(values: readonly number[], position: PlotPosition = "blom"): QQResult {
  const xs = values.filter((v) => Number.isFinite(v)).slice().sort((p, q) => p - q);
  const n = xs.length;
  if (n === 0) return { points: [], slope: NaN, intercept: NaN, mean: NaN, sd: NaN, n: 0 };
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  let sd = NaN;
  if (n > 1) {
    let ss = 0;
    for (const v of xs) ss += (v - mean) * (v - mean);
    sd = Math.sqrt(ss / (n - 1));
  }
  const a = POSITION_A[position];
  const denom = n + 1 - 2 * a;
  const points: QQPoint[] = [];
  for (let i = 0; i < n; i++) {
    const p = (i + 1 - a) / denom; // i is 0-based → rank i+1
    const z = normInv(p) ?? 0;
    points.push({ z, value: xs[i]!, reference: mean + z * (Number.isFinite(sd) ? sd : 0) });
  }
  return { points, slope: Number.isFinite(sd) ? sd : NaN, intercept: mean, mean, sd, n };
}

/**
 * Log-normal probability plot: the normal QQ computed on `log(values)`,
 * with the reference line back-transformed to the original scale (`exp`). The
 * ordered values then fall on a straight line — when charted against the normal
 * quantile on a **log Y-axis** — exactly when the data are log-normal. Non-positive
 * values are dropped (log-normal support is x > 0). `mean` is the geometric mean and
 * `sd` the geometric SD factor; `slope`/`intercept` are the fit on the log scale.
 */
export function lognormalProbabilityPlot(values: readonly number[], position: PlotPosition = "blom"): QQResult {
  const logs = values.filter((v) => Number.isFinite(v) && v > 0).map((v) => Math.log(v));
  const n = logs.length;
  if (n === 0) return { points: [], slope: NaN, intercept: NaN, mean: NaN, sd: NaN, n: 0 };
  const base = normalProbabilityPlot(logs, position); // fit on the log scale
  const points: QQPoint[] = base.points.map((p) => ({
    z: p.z,
    value: Math.exp(p.value), // ordered original value (log is monotonic → order preserved)
    reference: Math.exp(p.reference), // straight-line reference, back on the original scale
  }));
  return {
    points,
    slope: base.slope, // SD of log(values)
    intercept: base.intercept, // mean of log(values)
    mean: Math.exp(base.mean), // geometric mean
    sd: Number.isFinite(base.sd) ? Math.exp(base.sd) : NaN, // geometric SD factor
    n,
  };
}

/** Round for display without trailing-zero noise. */
function r(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}

/**
 * A plot-ready `NamedTable` for the QQ plot: the theoretical normal quantile (X),
 * the ordered sample value (Y points), and the reference line (Y line). Charted as
 * an XY graph, column 1 is X, column 2 the scatter, column 3 the straight line.
 */
export function qqTable(res: QQResult, label = "Value"): NamedTable {
  return {
    columnNames: ["Normal quantile (z)", `${label} (ordered)`, "Reference line"],
    rows: res.points.map((p) => [r(p.z), r(p.value), r(p.reference)]),
  };
}

// ---------------------------------------------------------------------------------------------
// GWAS QQ plot (the `qq` graph kind) — a different QQ from the normal-probability plot above: it
// compares a column of association p-values against the uniform null on the −log10 scale, and
// reports the genomic inflation factor λ. Peaks (small p) pull away from the diagonal upward.
// ---------------------------------------------------------------------------------------------

/** One QQ point on the −log10 scale: expected (uniform null) vs observed. */
export interface GwasQQPoint {
  /** −log10 of the expected p under the uniform null at this rank (x-axis). */
  expected: number;
  /** −log10 of the observed p (y-axis). */
  observed: number;
}

export interface GwasQQResult {
  points: GwasQQPoint[];
  /** Genomic inflation factor λ = median(χ²₁) / 0.4549 — 1.0 = well-calibrated, >1 = inflation. */
  lambda: number;
  /** Count of usable p-values (0 < p ≤ 1). */
  n: number;
  /** The largest −log10 on either axis (for a square domain + the y = x line). */
  maxLog: number;
}

/** Median of an array (unsorted input is sorted here). */
function median(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** χ²₁ = z² where z = Φ⁻¹(1 − p/2) — the one-df chi-square a two-sided p maps to. */
const MEDIAN_CHISQ1 = 0.4549364231195736; // qchisq(0.5, df=1)

/**
 * GWAS QQ transform: sort the p-values, pair each rank with its uniform-null expectation
 * (expectedᵢ = (i − 0.5)/n) on the −log10 scale, and compute the genomic inflation factor λ
 * = median(χ²₁ from each p) / median(χ²₁). Non-finite / out-of-(0,1] p-values are dropped.
 */
export function gwasQQ(pvalues: readonly number[]): GwasQQResult {
  const ps = pvalues.filter((p) => Number.isFinite(p) && p > 0 && p <= 1).sort((a, b) => a - b);
  const n = ps.length;
  if (n === 0) return { points: [], lambda: NaN, n: 0, maxLog: 0 };
  const points: GwasQQPoint[] = ps.map((p, i) => ({
    expected: -Math.log10((i + 0.5) / n),
    observed: -Math.log10(p),
  }));
  const chisq = ps.map((p) => { const z = normInv(1 - p / 2) ?? 0; return z * z; });
  const lambda = median(chisq) / MEDIAN_CHISQ1;
  const maxLog = points.reduce((m, pt) => Math.max(m, pt.expected, pt.observed), 0);
  return { points, lambda, n, maxLog };
}

// ---------------------------------------------------------------------------------------------
// GWAS Manhattan plot (the `manhattan` graph kind) — the genome-axis layout: chromosomes laid
// end to end by their base-pair span, one tick at each chromosome's midpoint. Pure so the axis
// ruler is independently testable; the pixel decimation of the dense cloud lives in the graphics
// builder (it needs the resolved plot geometry).
// ---------------------------------------------------------------------------------------------

/** One chromosome's span on the Manhattan genome axis. */
export interface ChromosomeSpan {
  /** Chromosome label as it prints on the axis (e.g. "1", "X"), verbatim from the data. */
  name: string;
  /** Smallest / largest base-pair position seen for this chromosome. */
  minPos: number;
  maxPos: number;
  /** Genome-axis coordinate where this chromosome's span begins. */
  offset: number;
  /** Genome-axis width of the span (maxPos − minPos, floored at 1 so a single-SNP chromosome
   *  still gets room). */
  width: number;
  /** Genome-axis coordinate of the chromosome's midpoint — its tick position. */
  mid: number;
}

export interface ManhattanLayout {
  /** Chromosomes in genome order (1..22, X, Y, M, then any unknown labels alphabetically). */
  chromosomes: ChromosomeSpan[];
  /** Total genome-axis length (the right edge of the last chromosome's span, gaps included). */
  total: number;
  /** Genome-axis coordinate of a marker, or NaN if its chromosome is not in the layout. */
  posOf: (chr: string, pos: number) => number;
}

/** Order key for a chromosome label: 1..22 by value, then X, Y, M/MT, then unknowns (pushed to
 *  the end, ordered by their label). A leading "chr" / "chr_" prefix is ignored. */
export function chromosomeOrder(chr: string): number {
  const c = chr.trim().replace(/^chr[_-]?/i, "").toUpperCase();
  if (/^\d+$/.test(c)) return Number(c);
  if (c === "X") return 1000;
  if (c === "Y") return 1001;
  if (c === "M" || c === "MT") return 1002;
  return 2000; // unknown labels sort last; ties broken alphabetically by the caller
}

/**
 * Lay a set of (chromosome, position) markers out along a single genome axis: sort the
 * chromosomes into genome order, place each one's [minPos, maxPos] span end to end with a small
 * gap between chromosomes, and record each chromosome's midpoint (its tick). `gapFraction` is the
 * inter-chromosome gap as a fraction of the mean chromosome width (default 0.005).
 */
export function manhattanLayout(
  items: readonly { chr: string; pos: number }[],
  gapFraction = 0.005,
): ManhattanLayout {
  // Group finite-position markers by chromosome label, tracking min/max position.
  const byChr = new Map<string, { min: number; max: number }>();
  for (const it of items) {
    if (!Number.isFinite(it.pos)) continue;
    const key = it.chr.trim();
    if (key === "") continue;
    const cur = byChr.get(key);
    if (cur) { cur.min = Math.min(cur.min, it.pos); cur.max = Math.max(cur.max, it.pos); }
    else byChr.set(key, { min: it.pos, max: it.pos });
  }
  const names = [...byChr.keys()].sort((a, b) => {
    const d = chromosomeOrder(a) - chromosomeOrder(b);
    return d !== 0 ? d : a.localeCompare(b);
  });
  const widths = names.map((n) => Math.max(1, byChr.get(n)!.max - byChr.get(n)!.min));
  const meanWidth = widths.length ? widths.reduce((s, w) => s + w, 0) / widths.length : 1;
  const gap = meanWidth * gapFraction;

  const chromosomes: ChromosomeSpan[] = [];
  const offsetByName = new Map<string, { offset: number; min: number }>();
  let cursor = 0;
  names.forEach((name, i) => {
    const { min, max } = byChr.get(name)!;
    const width = widths[i]!;
    const offset = cursor;
    chromosomes.push({ name, minPos: min, maxPos: max, offset, width, mid: offset + width / 2 });
    offsetByName.set(name, { offset, min });
    cursor = offset + width + gap;
  });
  const total = chromosomes.length ? cursor - gap : 0; // no trailing gap past the last chromosome

  const posOf = (chr: string, pos: number): number => {
    const e = offsetByName.get(chr.trim());
    return e ? e.offset + (pos - e.min) : NaN;
  };
  return { chromosomes, total, posOf };
}

/** Extract finite numeric cells of one grid column (helper for the dialog). */
export function columnNumbers(rows: CellValue[][], col: number): number[] {
  const out: number[] = [];
  for (const row of rows) {
    const v = asNumber(row[col]);
    if (v !== null) out.push(v);
  }
  return out;
}
