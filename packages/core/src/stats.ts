/**
 * Replicate statistics for error bars.
 *
 * Pure, DOM-free, dependency-free. The renderer derives error bars on every
 * frame, so these run in TypeScript (the scipy sidecar is async + per-analysis,
 * not per-render). The numerically delicate piece — the Student-t quantile for
 * confidence intervals — is built from the inverse regularized incomplete beta
 * and **validated against reference critical values** (see stats.test.ts).
 *
 * Formulas follow the standard definitions exactly:
 *   SD  = sqrt( Σ(xᵢ−x̄)² / (N−1) )           (sample SD, N−1 denominator)
 *   SEM = SD / √N
 *   95% CI half-width = t(0.975, N−1) · SEM   (Student-t with N−1 df, not 1.96)
 *   geometric mean = exp(mean(ln xᵢ)); GSD factor = exp(SD(ln xᵢ)) — plotted ÷/×.
 * N counts only present (finite) replicates; N=1 yields no error (SD undefined).
 */

import type { BoxWhisker, ErrorBarType } from "./model";

// --- special functions (log-gamma, incomplete beta, and its inverse) --------

/** Lanczos log-gamma. Accurate to ~1e-13 for x > 0. */
export function logGamma(x: number): number {
  const g = [
    676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) {
    // reflection: Γ(x)Γ(1−x) = π / sin(πx)
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  }
  const z = x - 1;
  let a = 0.99999999999980993;
  const t = z + 7.5;
  for (let i = 0; i < g.length; i++) a += g[i]! / (z + i + 1);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Continued fraction for the incomplete beta (Numerical Recipes `betacf`). */
function betacf(a: number, b: number, x: number): number {
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 3e-15) break;
  }
  return h;
}

/** Regularized incomplete beta Iₓ(a,b) ∈ [0,1]. */
export function regIncBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lbeta = logGamma(a + b) - logGamma(a) - logGamma(b);
  const front = Math.exp(lbeta + a * Math.log(x) + b * Math.log(1 - x));
  // Use the continued fraction on the faster-converging side.
  if (x < (a + 1) / (a + b + 2)) return (front * betacf(a, b, x)) / a;
  return 1 - (front * betacf(b, a, 1 - x)) / b;
}

/** Inverse of Iₓ(a,b): the x with Iₓ(a,b)=p (Numerical Recipes `invbetai`). */
export function invRegIncBeta(p: number, a: number, b: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  const a1 = a - 1;
  const b1 = b - 1;
  const EPS = 1e-12;
  let x: number;
  // Initial guess.
  if (a >= 1 && b >= 1) {
    const pp = p < 0.5 ? p : 1 - p;
    const t = Math.sqrt(-2 * Math.log(pp));
    let xx = (2.30753 + t * 0.27061) / (1 + t * (0.99229 + t * 0.04481)) - t;
    if (p < 0.5) xx = -xx;
    const al = (xx * xx - 3) / 6;
    const h = 2 / (1 / (2 * a - 1) + 1 / (2 * b - 1));
    const w =
      (xx * Math.sqrt(al + h)) / h -
      (1 / (2 * b - 1) - 1 / (2 * a - 1)) * (al + 5 / 6 - 2 / (3 * h));
    x = a / (a + b * Math.exp(2 * w));
  } else {
    const lna = Math.log(a / (a + b));
    const lnb = Math.log(b / (a + b));
    const t = Math.exp(a * lna) / a;
    const u = Math.exp(b * lnb) / b;
    const w = t + u;
    x = p < t / w ? Math.pow(a * w * p, 1 / a) : 1 - Math.pow(b * w * (1 - p), 1 / b);
  }
  // Halley refinement.
  const afac = -logGamma(a) - logGamma(b) + logGamma(a + b);
  for (let j = 0; j < 12; j++) {
    if (x <= 0 || x >= 1) return Math.min(1, Math.max(0, x));
    const err = regIncBeta(x, a, b) - p;
    let t = Math.exp(a1 * Math.log(x) + b1 * Math.log(1 - x) + afac);
    const u = err / t;
    t = u / (1 - 0.5 * Math.min(1, u * (a1 / x - b1 / (1 - x))));
    x -= t;
    if (x <= 0) x = 0.5 * (x + t);
    if (x >= 1) x = 0.5 * (x + t + 1);
    if (Math.abs(t) < EPS * x && j > 0) break;
  }
  return x;
}

/**
 * Student-t quantile: the t with CDF_t(t; df)=p. Built from the inverse
 * incomplete beta via Iₓ(df/2, 1/2)=2·min(p,1−p) at x=df/(df+t²). Validated
 * against reference critical values (e.g. t(0.975,4)=2.776, →1.95996 as df→∞).
 */
export function studentTInv(p: number, df: number): number {
  if (!(df > 0) || p <= 0 || p >= 1) return NaN;
  if (p === 0.5) return 0;
  const lower = p < 0.5;
  const tail = lower ? p : 1 - p; // one-sided tail area
  const x = invRegIncBeta(2 * tail, df / 2, 0.5);
  const t = Math.sqrt((df * (1 - x)) / x);
  return lower ? -t : t;
}

// --- replicate summaries ----------------------------------------------------

export interface ReplicateSummary {
  /** Count of present (finite) replicates. */
  n: number;
  /** Arithmetic mean (NaN if n=0). */
  mean: number;
  /** Sample SD (N−1). NaN if n<2. */
  sd: number;
  /** Standard error of the mean = sd/√n. NaN if n<2. */
  sem: number;
  /** min / max of the replicates (NaN if n=0). */
  min: number;
  max: number;
  /** Geometric mean (NaN if any value ≤ 0 or n=0). */
  geoMean: number;
  /** Geometric SD factor (≥1, unitless). NaN if n<2 or any value ≤ 0. */
  geoSdFactor: number;
  /**
   * Median and quartiles (type-7, the numpy/R default — `quantileSorted`).
   *
   * Used by the median-centred XY curve: a curve tracing the median needs an interval that
   * is meaningful around a median, and "median ± SD" is not it. `q1`/`q3` are that interval.
   * Note: not a new statistic — the same `quantileSorted` the box plot uses, whose
   * independent recomputation is `pure_percentile` in `engines/py/crosscheck.py`.
   */
  median: number;
  q1: number;
  q3: number;
}

const EMPTY: ReplicateSummary = {
  n: 0,
  mean: NaN,
  sd: NaN,
  sem: NaN,
  min: NaN,
  max: NaN,
  geoMean: NaN,
  geoSdFactor: NaN,
  median: NaN,
  q1: NaN,
  q3: NaN,
};

/** Summarize a row's replicate values (non-finite entries are dropped). */
export function summarize(values: ReadonlyArray<number>): ReplicateSummary {
  const xs = values.filter((v) => Number.isFinite(v));
  const n = xs.length;
  if (n === 0) return EMPTY;
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  for (const v of xs) {
    sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const mean = sum / n;
  let sd = NaN;
  let sem = NaN;
  if (n >= 2) {
    let ss = 0;
    for (const v of xs) ss += (v - mean) * (v - mean);
    sd = Math.sqrt(ss / (n - 1));
    sem = sd / Math.sqrt(n);
  }
  // Geometric stats require strictly positive data.
  let geoMean = NaN;
  let geoSdFactor = NaN;
  if (xs.every((v) => v > 0)) {
    const logs = xs.map((v) => Math.log(v));
    const logMean = logs.reduce((a, b) => a + b, 0) / n;
    geoMean = Math.exp(logMean);
    if (n >= 2) {
      let ls = 0;
      for (const l of logs) ls += (l - logMean) * (l - logMean);
      geoSdFactor = Math.exp(Math.sqrt(ls / (n - 1)));
    }
  }
  // Median + quartiles. One sort, reused for all three; `quantileSorted` is the same type-7
  // rule the box plot uses, so a median here and a median in a box plot of the same numbers
  // can never disagree.
  const sorted = [...xs].sort((a, b) => a - b);
  const median = quantileSorted(sorted, 0.5);
  const q1 = quantileSorted(sorted, 0.25);
  const q3 = quantileSorted(sorted, 0.75);
  return { n, mean, sd, sem, min, max, geoMean, geoSdFactor, median, q1, q3 };
}

/** A plotted point: where the symbol sits, and the error-bar reach above/below. */
export interface ErrorPoint {
  /** Plotted Y (arithmetic mean, or geometric mean for `geoSd`). */
  center: number;
  /** Lower / upper absolute data-space coordinates of the bar ends. */
  low: number;
  high: number;
  /** True when an error bar should be drawn (n≥2, finite, type≠none). */
  hasError: boolean;
  n: number;
}

/** Two-sided t multiplier for a confidence level (default 95%) at df. */
export function ciMultiplier(conf: number, df: number): number {
  return studentTInv((1 + conf) / 2, df);
}

/** Two-sided normal (z) quantile for a confidence level — e.g. 1.95996 for 95%, 1.64485 for
 *  90%, 2.57583 for 99%. The t multiplier at a huge df converges to the normal quantile. */
export function normalCiMultiplier(conf: number): number {
  return studentTInv((1 + conf) / 2, 1e9);
}

// --- meta-analysis (forest pooling) -----------------------------------------

/** One study for `metaAnalysis`: a point estimate with its entered confidence limits. */
export interface MetaStudy {
  est: number;
  lo: number;
  hi: number;
}

export interface MetaResult {
  /** Pooled estimate + CI, in the same (data) space as the inputs. */
  est: number;
  lo: number;
  hi: number;
  /** SE of the pooled estimate (transformed space). */
  se: number;
  /** Each pooled study's normalized weight (0–1), in input order (unusable studies dropped). */
  weights: number[];
  /** Cochran's Q, its df (k−1), the DerSimonian-Laird between-study variance τ² (transformed
   *  space) and I² (%). τ² and I² describe the data's heterogeneity regardless of the model. */
  q: number;
  df: number;
  tau2: number;
  i2: number;
  /** Studies actually pooled (finite, positive width; strictly positive on a log axis). */
  k: number;
  model: "fixed" | "random";
}

/**
 * Inverse-variance meta-analysis of study estimates from their confidence limits.
 *
 * Each study's variance is back-calculated from its entered CI: SE = (t(hi) − t(lo)) / (2·z),
 * where z is the normal quantile for `inputConf` (the level the limits were entered at — 1.96 for
 * 95%, 1.645 for 90%, 2.576 for 99%; not hardcoded) and t = log for a ratio (log-axis) measure,
 * else identity. Fixed-effect weights = 1/vᵢ. Random-effects (DerSimonian-Laird): τ² = max(0,
 * (Q − df)/C) with C = Σw − Σw²/Σw, then reweight wᵢ* = 1/(vᵢ + τ²). Heterogeneity Q, df = k−1
 * and I² = max(0, (Q − df)/Q)·100 are reported for either model. The pooled CI uses `pooledConf`
 * (conventionally 95%). Returns null when no study is usable. Cross-checked against
 * statsmodels.stats.meta_analysis.combine_effects (method_re="chi2") — see stats.test.ts.
 */
/**
 * One study's standard error, back-calculated from its reported CI: (t(hi) − t(lo)) / (2z),
 * where t = log on a ratio (log-axis) effect and z matches the CI's confidence level.
 * The single shared formula — `metaAnalysis` and the forest/funnel builders all derive SE this way;
 * NaN when the interval is malformed (hi ≤ lo, or non-positive values on a log effect).
 */
export function studySE(lo: number, hi: number, z: number, log: boolean): number {
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return NaN;
  if (log && (lo <= 0 || hi <= 0)) return NaN;
  const tf = log ? Math.log : (x: number): number => x;
  const se = (tf(hi) - tf(lo)) / (2 * z);
  return se > 0 ? se : NaN;
}

export function metaAnalysis(
  studies: readonly MetaStudy[],
  opts: { model: "fixed" | "random"; inputConf: number; pooledConf: number; log: boolean },
): MetaResult | null {
  const { model, inputConf, pooledConf, log } = opts;
  const zIn = normalCiMultiplier(inputConf);
  const zPool = normalCiMultiplier(pooledConf);
  const tf = log ? Math.log : (x: number): number => x;
  const tinv = log ? Math.exp : (x: number): number => x;
  const y: number[] = [];
  const v: number[] = [];
  for (const s of studies) {
    if (!Number.isFinite(s.est) || !Number.isFinite(s.lo) || !Number.isFinite(s.hi) || s.hi <= s.lo) continue;
    if (log && (s.est <= 0 || s.lo <= 0 || s.hi <= 0)) continue;
    const se = (tf(s.hi) - tf(s.lo)) / (2 * zIn);
    if (!(se > 0)) continue;
    y.push(tf(s.est));
    v.push(se * se);
  }
  const k = y.length;
  if (k === 0) return null;
  const wF = v.map((vi) => 1 / vi);
  const swF = wF.reduce((a, b) => a + b, 0);
  const mF = y.reduce((acc, yi, i) => acc + wF[i]! * yi, 0) / swF;
  const df = k - 1;
  const q = y.reduce((acc, yi, i) => acc + wF[i]! * (yi - mF) ** 2, 0);
  const c = swF - wF.reduce((acc, w) => acc + w * w, 0) / swF;
  // τ² and I² describe the data's spread — computed regardless of which model is drawn.
  const tau2 = c > 0 ? Math.max(0, (q - df) / c) : 0;
  const i2 = q > df && q > 0 ? ((q - df) / q) * 100 : 0;
  const w = model === "random" ? v.map((vi) => 1 / (vi + tau2)) : wF;
  const sw = w.reduce((a, b) => a + b, 0);
  const m = y.reduce((acc, yi, i) => acc + w[i]! * yi, 0) / sw;
  const se = Math.sqrt(1 / sw);
  return {
    est: tinv(m),
    lo: tinv(m - zPool * se),
    hi: tinv(m + zPool * se),
    se,
    weights: w.map((wi) => wi / sw),
    q,
    df,
    tau2,
    i2,
    k,
    model,
  };
}

// --- publication bias (Egger + trim-and-fill) --------------------------------

/** `eggerTest`'s regression readout. All values live in transformed (log on a ratio
 *  measure) space — the intercept is a pure asymmetry number, not an effect size. */
export interface EggerResult {
  /** Regression intercept — the bias term. 0 under a symmetric funnel. */
  intercept: number;
  interceptSe: number;
  /** Intercept CI limits at `ciConf` (t-based, df = k − 2). */
  ciLow: number;
  ciHigh: number;
  /** Slope of standardized effect on precision — the underlying pooled-effect scale. */
  slope: number;
  slopeSe: number;
  /** t = intercept / se, df = k − 2, two-sided p. */
  t: number;
  df: number;
  p: number;
  /** Studies the regression used. */
  k: number;
}

/** Shared study filter: (y, v) pairs in transformed space, the same usability rules
 *  `metaAnalysis` applies, keeping the source index for later mirroring. */
function usableStudies(
  studies: readonly MetaStudy[],
  inputConf: number,
  log: boolean,
): { y: number[]; v: number[]; src: number[] } {
  const zIn = normalCiMultiplier(inputConf);
  const tf = log ? Math.log : (x: number): number => x;
  const y: number[] = [];
  const v: number[] = [];
  const src: number[] = [];
  studies.forEach((s, i) => {
    if (!Number.isFinite(s.est) || !Number.isFinite(s.lo) || !Number.isFinite(s.hi) || s.hi <= s.lo) return;
    if (log && (s.est <= 0 || s.lo <= 0 || s.hi <= 0)) return;
    const se = (tf(s.hi) - tf(s.lo)) / (2 * zIn);
    if (!(se > 0)) return;
    y.push(tf(s.est));
    v.push(se * se);
    src.push(i);
  });
  return { y, v, src };
}

/**
 * Egger's regression test for funnel asymmetry: OLS of the standardized effect
 * zᵢ = yᵢ/SEᵢ on precision 1/SEᵢ. A non-zero intercept means small (imprecise) studies
 * report systematically different effects than large ones — the funnel leans. Two-sided
 * t test on the intercept at df = k − 2. Runs in log space on a ratio measure (the same
 * rule as `metaAnalysis`). Returns null below 3 usable studies or when every study has
 * the same precision (the regression is singular). Cross-checked against a statsmodels
 * OLS in engines/py/crosscheck.py; the engine's hand-rolled twin is engine.py
 * `publicationbias`.
 */
export function eggerTest(
  studies: readonly MetaStudy[],
  opts: { inputConf: number; log: boolean; ciConf?: number },
): EggerResult | null {
  const { y, v } = usableStudies(studies, opts.inputConf, opts.log);
  const k = y.length;
  if (k < 3) return null;
  const x = v.map((vi) => 1 / Math.sqrt(vi)); // precision
  const z = y.map((yi, i) => yi * x[i]!); // standardized effect
  const xBar = x.reduce((a, b) => a + b, 0) / k;
  const zBar = z.reduce((a, b) => a + b, 0) / k;
  // Relative guard, not an exact zero: back-calculated precisions of equal-width CIs
  // differ by float noise (~1e-16), and a near-singular Sxx would amplify it into a
  // meaningless intercept instead of a clean refusal.
  const sxx = x.reduce((acc, xi) => acc + (xi - xBar) ** 2, 0);
  if (!(sxx > k * xBar * xBar * 1e-12)) return null;
  const sxz = x.reduce((acc, xi, i) => acc + (xi - xBar) * (z[i]! - zBar), 0);
  const slope = sxz / sxx;
  const intercept = zBar - slope * xBar;
  const df = k - 2;
  const rss = z.reduce((acc, zi, i) => acc + (zi - intercept - slope * x[i]!) ** 2, 0);
  const s2 = rss / df;
  const interceptSe = Math.sqrt(s2 * (1 / k + (xBar * xBar) / sxx));
  const slopeSe = Math.sqrt(s2 / sxx);
  const t = interceptSe > 0 ? intercept / interceptSe : intercept === 0 ? 0 : Infinity * Math.sign(intercept);
  // Two-sided p from the regularized incomplete beta: P(|T| > t) = I_x(df/2, ½) at
  // x = df/(df + t²) — no separate t-CDF needed.
  const p = Number.isFinite(t) ? regIncBeta(df / (df + t * t), df / 2, 0.5) : 0;
  const tc = studentTInv((1 + (opts.ciConf ?? 0.95)) / 2, df);
  return {
    intercept, interceptSe, ciLow: intercept - tc * interceptSe, ciHigh: intercept + tc * interceptSe,
    slope, slopeSe, t, df, p, k,
  };
}

/** `trimAndFill`'s outcome: the imputed mirror studies plus the re-pooled result. */
export interface TrimFillResult {
  /** Estimated number of suppressed studies (L0, rounded half-up, floored at 0). */
  k0: number;
  /** The side the missing studies sit on ("left" = small effects suppressed). */
  side: "left" | "right";
  /** The mirrored studies in data space, limits reconstructed at `inputConf` — ready to
   *  pool or to draw on the funnel at (est, its source study's SE). */
  imputed: MetaStudy[];
  /** Pooling of observed + imputed under `model` — `metaAnalysis` re-run, no second
   *  pooling implementation. Equals the plain pooling when k0 = 0. */
  adjusted: MetaResult;
  /** Trimming iterations until k0 stabilized. */
  iterations: number;
}

/**
 * Duval-Tweedie trim-and-fill: estimate how many small studies a lopsided funnel is
 * missing (the L0 estimator), mirror the surplus extreme studies about the trimmed
 * centre, and re-pool with the mirrors included — a sensitivity answer to "what would
 * the pooled effect be without the suppression?".
 *
 * Mechanics (all in transformed space): iterate { trim the l most extreme same-side
 * studies → fixed-effect centre μ̂ of the rest → rank |yᵢ − μ̂| over all observed
 * (average ranks on ties) → Tn = Σ ranks of the positive deviations →
 * L0 = (4Tn − k(k+1)) / (2k − 1) → l = round(L0) } until l repeats (cap 50, and l is
 * clamped to k − 2 so at least two studies always remain). Side "auto" follows the
 * Egger intercept's sign (missing on the left when small studies overshoot); ties in y trim
 * in input order. Fixed-effect centring during trimming is Duval & Tweedie's original;
 * the adjusted pooling honours `model`. Returns null below 3 usable studies.
 * Verified three ways: engine.py `publicationbias` (hand-rolled twin) and an
 * independent stdlib recomputation + constructed-suppression fixtures in crosscheck.py.
 */
export function trimAndFill(
  studies: readonly MetaStudy[],
  opts: { model: "fixed" | "random"; inputConf: number; pooledConf: number; log: boolean; side?: "left" | "right" | "auto" },
): TrimFillResult | null {
  const { model, inputConf, pooledConf, log } = opts;
  const { y, v, src } = usableStudies(studies, inputConf, log);
  const k = y.length;
  if (k < 3) return null;
  let side: "left" | "right";
  if (opts.side === "left" || opts.side === "right") side = opts.side;
  else {
    // Missing on the left (small studies overshoot) when the Egger intercept is ≥ 0; a
    // singular regression (no precision spread) defaults to "left" — with no lean
    // signal the estimator lands on k0 = 0 from either side.
    const egger = eggerTest(studies, { inputConf, log });
    side = egger == null || egger.intercept >= 0 ? "left" : "right";
  }
  // Work on the "missing left" orientation: mirror the data when the right side is missing.
  const flip = side === "right" ? -1 : 1;
  const yw = y.map((yi) => flip * yi);
  const zIn = normalCiMultiplier(inputConf);
  const tinv = log ? Math.exp : (x: number): number => x;
  // Extremity order: largest first (ties by input order) — who gets trimmed/mirrored.
  const order = yw.map((_, i) => i).sort((a, b) => yw[b]! - yw[a]! || a - b);
  const fixedCentre = (skip: Set<number>): number => {
    let sw = 0;
    let swy = 0;
    yw.forEach((yi, i) => {
      if (skip.has(i)) return;
      const w = 1 / v[i]!;
      sw += w;
      swy += w * yi;
    });
    return swy / sw;
  };
  let l = 0;
  let iterations = 0;
  let centre = fixedCentre(new Set());
  for (let step = 0; step < 50; step++) {
    iterations = step + 1;
    centre = fixedCentre(new Set(order.slice(0, l)));
    const d = yw.map((yi) => yi - centre);
    // Average ranks of |d| (ties share their rank block's mean).
    const byAbs = d.map((di, i) => ({ abs: Math.abs(di), i })).sort((a, b) => a.abs - b.abs);
    const rank = new Array<number>(k);
    for (let j = 0; j < k; ) {
      let j2 = j;
      while (j2 + 1 < k && byAbs[j2 + 1]!.abs === byAbs[j]!.abs) j2++;
      const avg = (j + j2 + 2) / 2; // ranks are 1-based
      for (let m = j; m <= j2; m++) rank[byAbs[m]!.i] = avg;
      j = j2 + 1;
    }
    const tn = d.reduce((acc, di, i) => acc + (di > 0 ? rank[i]! : 0), 0);
    const l0 = (4 * tn - k * (k + 1)) / (2 * k - 1);
    const next = Math.min(k - 2, Math.max(0, Math.floor(l0 + 0.5)));
    if (next === l) break;
    l = next;
  }
  const imputed: MetaStudy[] = order.slice(0, l).map((i) => {
    const yStar = flip * (2 * centre - yw[i]!); // mirror, back in the un-flipped space
    const se = Math.sqrt(v[i]!);
    return { est: tinv(yStar), lo: tinv(yStar - zIn * se), hi: tinv(yStar + zIn * se) };
  });
  const observed = src.map((i) => studies[i]!);
  const adjusted = metaAnalysis([...observed, ...imputed], { model, inputConf, pooledConf, log })!;
  return { k0: l, side, imputed, adjusted, iterations };
}

/**
 * Turn a replicate summary into a plotted point for the chosen error-bar type.
 * `conf` is the CI level (default 0.95). Range/geoSd are asymmetric; SD/SEM/CI
 * are symmetric about the mean. N=1 (or non-finite spread) → center only.
 */
export function errorPoint(
  s: ReplicateSummary,
  type: ErrorBarType,
  conf = 0.95,
): ErrorPoint {
  // Note: the centre follows the interval, not the other way round: `iqr` is a median-centred
  // interval (Q1–Q3 straddles the median, not the mean), exactly as `geoSd` is a geometric-mean
  // one. Drawing Q1–Q3 around an arithmetic mean would put the "middle" outside its own box
  // whenever the replicates are skewed.
  const center = type === "geoSd" ? s.geoMean : type === "iqr" ? s.median : s.mean;
  const none: ErrorPoint = { center, low: center, high: center, hasError: false, n: s.n };
  if (type === "none" || s.n < 2 || !Number.isFinite(center)) return none;
  if (type === "iqr" && Number.isFinite(s.q1) && Number.isFinite(s.q3)) {
    return { center, low: s.q1, high: s.q3, hasError: true, n: s.n };
  }
  if (type === "sd" && Number.isFinite(s.sd)) {
    return { center, low: center - s.sd, high: center + s.sd, hasError: true, n: s.n };
  }
  if (type === "sem" && Number.isFinite(s.sem)) {
    return { center, low: center - s.sem, high: center + s.sem, hasError: true, n: s.n };
  }
  if (type === "ci95" && Number.isFinite(s.sem)) {
    const h = ciMultiplier(conf, s.n - 1) * s.sem;
    return { center, low: center - h, high: center + h, hasError: true, n: s.n };
  }
  if (type === "range" && Number.isFinite(s.min) && Number.isFinite(s.max)) {
    return { center, low: s.min, high: s.max, hasError: true, n: s.n };
  }
  if (type === "geoSd" && Number.isFinite(s.geoSdFactor)) {
    return { center, low: center / s.geoSdFactor, high: center * s.geoSdFactor, hasError: true, n: s.n };
  }
  return none;
}

// --- box-and-whisker statistics --------------------------------------------

/**
 * Quantile of an ascending-sorted array via linear interpolation (numpy/R
 * "type 7" — the default in numpy.percentile and R quantile). `p` in [0,1].
 */
export function quantileSorted(sorted: ReadonlyArray<number>, p: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  if (n === 1) return sorted[0]!;
  const idx = (n - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  const frac = idx - lo;
  return sorted[lo]! * (1 - frac) + sorted[hi]! * frac;
}

/**
 * Distribution-free CI of the median from order statistics (the sign-test interval):
 * [X₍k₎, X₍n+1−k₎], k = the largest rank whose lower binomial tail P(Bin(n, ½) ≤ k−1) is
 * ≤ α/2. The same rule as the engine's `describe` (engine.py), so the drawn interval and the
 * Describe result always agree. Coverage is at least `conf`, never less.
 * Undefined when no rank reaches the coverage (n < 6 at 95%) — a missing interval is said,
 * never faked. Non-finite values are dropped first.
 */
export function medianCI(
  values: ReadonlyArray<number>,
  conf = 0.95,
): { low: number; high: number; rank: number } | undefined {
  const xs = values.filter((v) => Number.isFinite(v)).slice().sort((a, b) => a - b);
  const n = xs.length;
  const tail = (1 - conf) / 2;
  // pmf(i) built as a running log: 0.5ⁿ underflows a double past n ≈ 1074, the terms that
  // decide k (near the median) do not.
  let logPmf = -n * Math.LN2;
  let cdf = 0;
  let rank = 0;
  for (let k = 1; k <= Math.floor(n / 2); k++) {
    cdf += Math.exp(logPmf); // + P(Bin = k−1)
    if (cdf > tail) break;
    rank = k;
    logPmf += Math.log(n - k + 1) - Math.log(k); // → P(Bin = k)
  }
  return rank >= 1 ? { low: xs[rank - 1]!, high: xs[n - rank]!, rank } : undefined;
}

export interface BoxSummary {
  n: number;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  /** Whisker ends (depend on the whisker definition). */
  whiskerLow: number;
  whiskerHigh: number;
  /** Values beyond the whiskers (plotted as individual outlier points). */
  outliers: number[];
}

const EMPTY_BOX: BoxSummary = {
  n: 0,
  min: NaN,
  q1: NaN,
  median: NaN,
  q3: NaN,
  max: NaN,
  whiskerLow: NaN,
  whiskerHigh: NaN,
  outliers: [],
};

/**
 * Five-number summary + whiskers for a box plot. Quartiles use the type-7
 * quantile (numpy/R default). Whisker definitions:
 *   tukey   — whiskers to the most extreme value within 1.5·IQR; rest = outliers.
 *   minmax  — whiskers to min/max (no outliers).
 *   p10_90 / p5_95 / p2_5_97_5 / p1_99 — whiskers at those percentiles; values beyond = outliers.
 */
export function boxStats(values: ReadonlyArray<number>, whisker: BoxWhisker = "tukey"): BoxSummary {
  const xs = values.filter((v) => Number.isFinite(v)).slice().sort((a, b) => a - b);
  const n = xs.length;
  if (n === 0) return EMPTY_BOX;
  const min = xs[0]!;
  const max = xs[n - 1]!;
  const q1 = quantileSorted(xs, 0.25);
  const median = quantileSorted(xs, 0.5);
  const q3 = quantileSorted(xs, 0.75);
  let whiskerLow: number;
  let whiskerHigh: number;
  let outliers: number[] = [];
  // Mean-centered whiskers: the box collapses to the mean and the whiskers
  // reach mean ± SD / SEM / 95% CI — a "mean ± error" glyph for box/violin/raincloud, the way
  // bars and scatter offer SD/SEM/CI. Not a quartile box: SEM/CI are often narrower than the IQR,
  // so keeping the q1–q3 box would draw whisker caps inside it (a backwards whisker) — collapsing
  // to the mean is the accurate representation. N<2 → no spread, so the whiskers vanish (center only).
  if (whisker === "sd" || whisker === "sem" || whisker === "ci95") {
    const mean = xs.reduce((a, v) => a + v, 0) / n;
    let sd = NaN;
    let sem = NaN;
    if (n >= 2) {
      let ss = 0;
      for (const v of xs) ss += (v - mean) * (v - mean);
      sd = Math.sqrt(ss / (n - 1));
      sem = sd / Math.sqrt(n);
    }
    const err = whisker === "sd" ? sd : whisker === "sem" ? sem : ciMultiplier(0.95, n - 1) * sem;
    const reach = Number.isFinite(err) ? err : 0;
    return { n, min, q1: mean, median: mean, q3: mean, max, whiskerLow: mean - reach, whiskerHigh: mean + reach, outliers: [] };
  }
  if (whisker === "minmax") {
    whiskerLow = min;
    whiskerHigh = max;
  } else if (whisker === "tukey") {
    const iqr = q3 - q1;
    const fenceLow = q1 - 1.5 * iqr;
    const fenceHigh = q3 + 1.5 * iqr;
    whiskerLow = xs.find((v) => v >= fenceLow) ?? min;
    whiskerHigh = [...xs].reverse().find((v) => v <= fenceHigh) ?? max;
    outliers = xs.filter((v) => v < fenceLow || v > fenceHigh);
  } else {
    const PCTS: Record<string, [number, number]> = {
      p10_90: [0.1, 0.9], p5_95: [0.05, 0.95], p2_5_97_5: [0.025, 0.975], p1_99: [0.01, 0.99],
    };
    const [lo, hi] = PCTS[whisker] ?? [0.1, 0.9];
    whiskerLow = quantileSorted(xs, lo);
    whiskerHigh = quantileSorted(xs, hi);
    outliers = xs.filter((v) => v < whiskerLow || v > whiskerHigh);
  }
  return { n, min, q1, median, q3, max, whiskerLow, whiskerHigh, outliers };
}

// --- kernel density estimation (violin plots) ------------------------------

const INV_SQRT_2PI = 1 / Math.sqrt(2 * Math.PI);

/**
 * Silverman's rule-of-thumb bandwidth for a Gaussian KDE:
 *   h = 0.9 · min(SD, IQR/1.349) · n^(-1/5)
 * (Silverman 1986, eq. 3.31 — the standard default in R `density(bw="nrd0")` and
 * scipy/seaborn). Uses the IQR-based robust scale when it is smaller than the SD
 * (heavy tails), and falls back to whichever spread is positive. Returns 0 when
 * the data has no spread (all values identical) or n < 2 — callers treat 0 as
 * "no smoothing possible" and skip the density.
 */
export function silvermanBandwidth(values: ReadonlyArray<number>): number {
  const xs = values.filter((v) => Number.isFinite(v));
  const n = xs.length;
  if (n < 2) return 0;
  const { sd } = summarize(xs);
  const sorted = xs.slice().sort((a, b) => a - b);
  const iqr = quantileSorted(sorted, 0.75) - quantileSorted(sorted, 0.25);
  const robust = iqr > 0 ? iqr / 1.349 : Infinity;
  // Smallest positive scale; if SD is degenerate use the robust one and vice-versa.
  const scale = Math.min(sd > 0 ? sd : Infinity, robust);
  if (!Number.isFinite(scale) || scale <= 0) return 0;
  return 0.9 * scale * Math.pow(n, -1 / 5);
}

/**
 * Gaussian kernel density estimate of `values`, evaluated at each point in
 * `evalPoints`. Density at x is (1/(n·h))·Σ φ((x−xᵢ)/h) with φ the standard
 * normal pdf — a smooth, non-negative curve that integrates to ~1 over the real
 * line (the basis of a violin's silhouette). `bandwidth` defaults to Silverman's
 * rule. Pure + deterministic. Returns all-zeros when n<2 or the bandwidth is
 * non-positive (degenerate data) so violins degrade gracefully to their box.
 */
export function gaussianKde(
  values: ReadonlyArray<number>,
  evalPoints: ReadonlyArray<number>,
  bandwidth?: number,
): number[] {
  const xs = values.filter((v) => Number.isFinite(v));
  const n = xs.length;
  const h = bandwidth ?? silvermanBandwidth(xs);
  if (n < 1 || !(h > 0)) return evalPoints.map(() => 0);
  const norm = 1 / (n * h);
  return evalPoints.map((x) => {
    let sum = 0;
    for (const xi of xs) {
      const u = (x - xi) / h;
      sum += INV_SQRT_2PI * Math.exp(-0.5 * u * u);
    }
    return norm * sum;
  });
}

/**
 * Plotted point from pre-computed summary stats (error values computed
 * elsewhere): a mean plus an error magnitude that is SD or SEM, with N. The
 * requested display type is converted using N (SD↔SEM↔CI need N).
 */
export function summaryErrorPoint(
  mean: number,
  error: number,
  n: number,
  errorIsSem: boolean,
  type: ErrorBarType,
  conf = 0.95,
): ErrorPoint {
  const none: ErrorPoint = { center: mean, low: mean, high: mean, hasError: false, n };
  if (type === "none" || !Number.isFinite(mean) || !Number.isFinite(error) || error < 0) return none;
  const sd = errorIsSem ? (Number.isFinite(n) && n >= 1 ? error * Math.sqrt(n) : NaN) : error;
  const sem = errorIsSem ? error : Number.isFinite(n) && n >= 1 ? error / Math.sqrt(n) : NaN;
  let h: number;
  if (type === "sd") h = sd;
  else if (type === "sem") h = sem;
  else if (type === "ci95") h = Number.isFinite(n) && n >= 2 ? ciMultiplier(conf, n - 1) * sem : NaN;
  else return none; // range/geoSd need raw replicates
  if (!Number.isFinite(h)) return none;
  return { center: mean, low: mean - h, high: mean + h, hasError: true, n };
}

/**
 * Plotted point from pre-entered asymmetric error values (the "Mean ± error" and
 * "Mean with upper & lower limits" data-entry formats). `low`/`high` are the final
 * bar endpoints in data units — used exactly as entered, with no SD/SEM/CI
 * derivation — so this drives the `asymmetric` error-bar type. Ordered so low ≤ high;
 * `n` is unknown (NaN). A `none` type (or a non-finite input) yields no error reach.
 */
export function asymmetricErrorPoint(
  mean: number,
  low: number,
  high: number,
  type: ErrorBarType = "asymmetric",
): ErrorPoint {
  const none: ErrorPoint = { center: mean, low: mean, high: mean, hasError: false, n: NaN };
  if (type === "none" || !Number.isFinite(mean) || !Number.isFinite(low) || !Number.isFinite(high)) return none;
  return { center: mean, low: Math.min(low, high), high: Math.max(low, high), hasError: true, n: NaN };
}
