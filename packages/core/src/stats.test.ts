import { describe, expect, it } from "vitest";
import {
  asymmetricErrorPoint,
  boxStats,
  ciMultiplier,
  eggerTest,
  errorPoint,
  gaussianKde,
  invRegIncBeta,
  metaAnalysis,
  normalCiMultiplier,
  quantileSorted,
  regIncBeta,
  silvermanBandwidth,
  studentTInv,
  summarize,
  summaryErrorPoint,
  trimAndFill,
} from "./stats";

describe("studentTInv — validated against reference critical values", () => {
  // Two-tailed 95% critical values t(0.975, df) from standard t-tables.
  const REF_975: Array<[number, number]> = [
    [1, 12.7062],
    [2, 4.30265],
    [3, 3.18245],
    [4, 2.77645],
    [5, 2.57058],
    [9, 2.26216],
    [10, 2.22814],
    [29, 2.04523],
    [30, 2.04227],
    [60, 2.0003],
    [100, 1.98397],
    [1000, 1.96234],
  ];
  it.each(REF_975)("t(0.975, %i) ≈ %f", (df, expected) => {
    expect(studentTInv(0.975, df)).toBeCloseTo(expected, 3);
  });

  it("matches one-tailed and 99% reference values", () => {
    expect(studentTInv(0.95, 9)).toBeCloseTo(1.83311, 3); // one-tailed 95%
    expect(studentTInv(0.995, 4)).toBeCloseTo(4.60409, 3); // 99% two-tailed
    expect(studentTInv(0.975, 1e7)).toBeCloseTo(1.95996, 3); // → z as df→∞
  });

  it("is symmetric about 0.5 and zero at the median", () => {
    expect(studentTInv(0.5, 5)).toBe(0);
    expect(studentTInv(0.025, 4)).toBeCloseTo(-2.77645, 3);
    expect(studentTInv(0.975, 4)).toBeCloseTo(-studentTInv(0.025, 4), 9);
  });

  it("guards degenerate inputs", () => {
    expect(studentTInv(0.5, 0)).toBeNaN();
    expect(studentTInv(0, 5)).toBeNaN();
    expect(studentTInv(1, 5)).toBeNaN();
  });

  it("ciMultiplier wraps the two-sided t multiplier", () => {
    expect(ciMultiplier(0.95, 4)).toBeCloseTo(2.77645, 4);
    expect(ciMultiplier(0.99, 4)).toBeCloseTo(4.60409, 3);
  });
});

describe("incomplete beta + inverse round-trip", () => {
  it("regIncBeta hits known anchors", () => {
    expect(regIncBeta(0.5, 1, 1)).toBeCloseTo(0.5, 12); // uniform CDF
    expect(regIncBeta(0, 2, 3)).toBe(0);
    expect(regIncBeta(1, 2, 3)).toBe(1);
    expect(regIncBeta(0.5, 2, 2)).toBeCloseTo(0.5, 12); // symmetric a=b
  });
  it("invRegIncBeta inverts regIncBeta", () => {
    for (const [a, b] of [[2, 3], [0.5, 0.5], [5, 1], [10, 7]] as Array<[number, number]>) {
      for (const x of [0.1, 0.37, 0.5, 0.8, 0.95]) {
        const p = regIncBeta(x, a, b);
        expect(invRegIncBeta(p, a, b)).toBeCloseTo(x, 8);
      }
    }
  });
});

describe("summarize", () => {
  it("computes mean, sample SD (N−1), SEM, and range", () => {
    const s = summarize([1, 2, 3]);
    expect(s.n).toBe(3);
    expect(s.mean).toBeCloseTo(2, 12);
    expect(s.sd).toBeCloseTo(1, 12); // sample SD of 1,2,3
    expect(s.sem).toBeCloseTo(1 / Math.sqrt(3), 12);
    expect(s.min).toBe(1);
    expect(s.max).toBe(3);
  });

  it("computes geometric mean and SD factor for positive data", () => {
    const s = summarize([1, 2, 4]); // logs 0, ln2, 2ln2 → geomean 2, gsd factor 2
    expect(s.geoMean).toBeCloseTo(2, 12);
    expect(s.geoSdFactor).toBeCloseTo(2, 12);
  });

  it("drops non-finite values and counts only present replicates", () => {
    const s = summarize([5, NaN, 7, Infinity]);
    expect(s.n).toBe(2);
    expect(s.mean).toBeCloseTo(6, 12);
  });

  it("N=1 → no spread; N=0 → empty; non-positive → no geometric stats", () => {
    const one = summarize([42]);
    expect(one.n).toBe(1);
    expect(one.mean).toBe(42);
    expect(one.sd).toBeNaN();
    expect(summarize([]).n).toBe(0);
    expect(summarize([-1, 2, 3]).geoMean).toBeNaN();
  });
});

describe("errorPoint", () => {
  const s = summarize([1, 2, 3]); // mean 2, sd 1, sem 1/√3

  it("SD / SEM bars are symmetric about the mean", () => {
    const sd = errorPoint(s, "sd");
    expect(sd.hasError).toBe(true);
    expect(sd.center).toBeCloseTo(2, 12);
    expect(sd.low).toBeCloseTo(1, 12);
    expect(sd.high).toBeCloseTo(3, 12);
    const sem = errorPoint(s, "sem");
    expect(sem.low).toBeCloseTo(2 - 1 / Math.sqrt(3), 12);
    expect(sem.high).toBeCloseTo(2 + 1 / Math.sqrt(3), 12);
  });

  it("95% CI uses t(0.975, N−1)·SEM", () => {
    const ci = errorPoint(s, "ci95");
    const h = 4.30265 * (1 / Math.sqrt(3)); // t(0.975,2)·SEM
    expect(ci.low).toBeCloseTo(2 - h, 3);
    expect(ci.high).toBeCloseTo(2 + h, 3);
  });

  it("range spans min→max; geoSd plots geomean ÷/×", () => {
    expect(errorPoint(s, "range")).toMatchObject({ low: 1, high: 3, center: 2 });
    const g = errorPoint(summarize([1, 2, 4]), "geoSd"); // geomean 2, gsd 2
    expect(g.center).toBeCloseTo(2, 12);
    expect(g.low).toBeCloseTo(1, 12);
    expect(g.high).toBeCloseTo(4, 12);
  });

  it("suppresses the bar at N=1 and for type none", () => {
    expect(errorPoint(summarize([5]), "sd").hasError).toBe(false);
    expect(errorPoint(s, "none").hasError).toBe(false);
  });
});

describe("quantileSorted (type-7, numpy/R default)", () => {
  it("matches numpy.percentile on 1..9", () => {
    const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    expect(quantileSorted(xs, 0.25)).toBeCloseTo(3, 12);
    expect(quantileSorted(xs, 0.5)).toBeCloseTo(5, 12);
    expect(quantileSorted(xs, 0.75)).toBeCloseTo(7, 12);
    expect(quantileSorted(xs, 0)).toBe(1);
    expect(quantileSorted(xs, 1)).toBe(9);
  });
  it("interpolates between points", () => {
    expect(quantileSorted([1, 2, 3, 4], 0.5)).toBeCloseTo(2.5, 12); // (2+3)/2
    expect(quantileSorted([10, 20], 0.25)).toBeCloseTo(12.5, 12);
  });
});

describe("boxStats", () => {
  it("five-number summary; Tukey whiskers flag the outlier", () => {
    const b = boxStats([1, 2, 3, 4, 5, 6, 7, 8, 9, 100], "tukey");
    expect(b.q1).toBeCloseTo(3.25, 10);
    expect(b.median).toBeCloseTo(5.5, 10);
    expect(b.q3).toBeCloseTo(7.75, 10);
    expect(b.min).toBe(1);
    expect(b.max).toBe(100);
    expect(b.whiskerHigh).toBe(9); // furthest value within 1.5·IQR
    expect(b.whiskerLow).toBe(1);
    expect(b.outliers).toEqual([100]);
  });

  it("min-max whiskers span the full range with no outliers", () => {
    const b = boxStats([1, 2, 3, 4, 5, 6, 7, 8, 9, 100], "minmax");
    expect(b.whiskerLow).toBe(1);
    expect(b.whiskerHigh).toBe(100);
    expect(b.outliers).toEqual([]);
  });

  it("percentile whiskers (10-90) sit at the percentiles", () => {
    const xs = Array.from({ length: 11 }, (_, i) => i); // 0..10
    const b = boxStats(xs, "p10_90");
    expect(b.whiskerLow).toBeCloseTo(1, 10); // 10th pct of 0..10
    expect(b.whiskerHigh).toBeCloseTo(9, 10);
    expect(b.outliers).toEqual([0, 10]);
  });

  it("percentile whiskers 2.5-97.5 and 1-99 sit at their percentiles (type-7)", () => {
    const xs = Array.from({ length: 11 }, (_, i) => i); // 0..10 → (n-1)=10
    const b = boxStats(xs, "p2_5_97_5");
    expect(b.whiskerLow).toBeCloseTo(0.25, 10); // 10·0.025
    expect(b.whiskerHigh).toBeCloseTo(9.75, 10); // 10·0.975
    const c = boxStats(xs, "p1_99");
    expect(c.whiskerLow).toBeCloseTo(0.1, 10); // 10·0.01
    expect(c.whiskerHigh).toBeCloseTo(9.9, 10); // 10·0.99
  });

  it("drops non-finite values; empty → n=0", () => {
    expect(boxStats([5, NaN, 7, Infinity], "minmax").n).toBe(2);
    expect(boxStats([]).n).toBe(0);
  });

  it("SD/SEM/CI whiskers are mean-centered — box collapses to the mean, whiskers = mean ± error", () => {
    const xs = [2, 4, 6, 8, 10]; // mean 6, SD √10≈3.1623, SEM √10/√5=√2≈1.4142
    const sd = boxStats(xs, "sd");
    // box body collapses to the mean (no quartile rectangle)
    expect([sd.q1, sd.median, sd.q3]).toEqual([6, 6, 6]);
    expect(sd.whiskerLow).toBeCloseTo(6 - Math.sqrt(10), 10);
    expect(sd.whiskerHigh).toBeCloseTo(6 + Math.sqrt(10), 10);
    expect(sd.outliers).toEqual([]);

    const sem = boxStats(xs, "sem");
    expect(sem.whiskerHigh).toBeCloseTo(6 + Math.SQRT2, 10);

    // 95% CI uses the t multiplier at df=4 (t.975,4 ≈ 2.7764) × SEM
    const ci = boxStats(xs, "ci95");
    expect(ci.whiskerHigh).toBeCloseTo(6 + 2.7764451 * Math.SQRT2, 5);

    // n<2 → no spread: the whiskers vanish onto the mean (center only), never NaN geometry.
    const one = boxStats([7], "sd");
    expect([one.median, one.whiskerLow, one.whiskerHigh]).toEqual([7, 7, 7]);
  });
});

describe("summaryErrorPoint (error values computed elsewhere)", () => {
  it("interconverts SD ↔ SEM ↔ CI via N", () => {
    // mean 10, SD 2, N 4 → SEM 1
    expect(summaryErrorPoint(10, 2, 4, false, "sd")).toMatchObject({ low: 8, high: 12 });
    expect(summaryErrorPoint(10, 2, 4, false, "sem")).toMatchObject({ low: 9, high: 11 });
    const ci = summaryErrorPoint(10, 2, 4, false, "ci95");
    expect(ci.high - 10).toBeCloseTo(3.18245 * 1, 3); // t(0.975,3)·SEM
    // mean 10, SEM 1, N 4 → SD 2
    expect(summaryErrorPoint(10, 1, 4, true, "sd")).toMatchObject({ low: 8, high: 12 });
  });

  it("range/geoSd need raw replicates → no bar; negative error → no bar", () => {
    expect(summaryErrorPoint(10, 2, 4, false, "range").hasError).toBe(false);
    expect(summaryErrorPoint(10, -1, 4, false, "sd").hasError).toBe(false);
  });

  it("without N (Mean+SD / Mean+SEM): draws the entered error, but can't derive the others", () => {
    // Mean+SD, no N: SD draws directly; SEM/CI can't be derived → no bar (never wrong).
    expect(summaryErrorPoint(10, 2, NaN, false, "sd")).toMatchObject({ low: 8, high: 12, hasError: true });
    expect(summaryErrorPoint(10, 2, NaN, false, "sem").hasError).toBe(false);
    expect(summaryErrorPoint(10, 2, NaN, false, "ci95").hasError).toBe(false);
    // Mean+SEM, no N: SEM draws; SD/CI can't be derived → no bar.
    expect(summaryErrorPoint(10, 1, NaN, true, "sem")).toMatchObject({ low: 9, high: 11, hasError: true });
    expect(summaryErrorPoint(10, 1, NaN, true, "sd").hasError).toBe(false);
  });
});

describe("asymmetricErrorPoint (pre-entered ± / upper-lower limits)", () => {
  it("draws the entered low/high directly, ordered low ≤ high", () => {
    expect(asymmetricErrorPoint(10, 8.5, 11.5)).toMatchObject({ center: 10, low: 8.5, high: 11.5, hasError: true });
    // swapped inputs are re-ordered
    expect(asymmetricErrorPoint(10, 12, 9)).toMatchObject({ low: 9, high: 12 });
  });
  it("yields no error for a none type or non-finite bound", () => {
    expect(asymmetricErrorPoint(10, 8, 12, "none").hasError).toBe(false);
    expect(asymmetricErrorPoint(10, NaN, 12).hasError).toBe(false);
    expect(asymmetricErrorPoint(NaN, 8, 12).hasError).toBe(false);
  });
});

describe("silvermanBandwidth — validated against R bw.nrd0", () => {
  it("matches R's nrd0 on a known sample", () => {
    // R: bw.nrd0(c(1,2,3,4,5)) → 0.9670892 (0.9·min(sd,IQR/1.349)·n^-0.2,
    //   sd=1.581139, IQR=2 (type-7), so min=IQR/1.349=1.482580)
    expect(silvermanBandwidth([1, 2, 3, 4, 5])).toBeCloseTo(0.96709, 4);
    // R: bw.nrd0(c(2,4,4,4,5,5,7,9)) → 0.660248
    //   sd=2.138090, IQR=1.5 (type-7), min=IQR/1.349=1.111935, n^-0.2=8^-0.2
    expect(silvermanBandwidth([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(0.6602, 3);
  });

  it("is 0 for degenerate data (no spread / n<2)", () => {
    expect(silvermanBandwidth([3, 3, 3, 3])).toBe(0);
    expect(silvermanBandwidth([7])).toBe(0);
    expect(silvermanBandwidth([])).toBe(0);
  });
});

describe("gaussianKde — density properties", () => {
  const grid = (lo: number, hi: number, n: number): number[] =>
    Array.from({ length: n }, (_, i) => lo + ((hi - lo) * i) / (n - 1));

  it("integrates to ~1 over a wide grid (trapezoidal)", () => {
    const data = [1, 2, 2, 3, 5, 8, 8, 9];
    const xs = grid(-15, 30, 4001);
    const d = gaussianKde(data, xs);
    let area = 0;
    for (let i = 1; i < xs.length; i++) area += ((d[i]! + d[i - 1]!) / 2) * (xs[i]! - xs[i - 1]!);
    expect(area).toBeCloseTo(1, 2);
  });

  it("is symmetric for data symmetric about its mean", () => {
    const data = [-2, -1, 0, 1, 2]; // mean 0
    const [left, right] = [gaussianKde(data, [-1.3]), gaussianKde(data, [1.3])];
    expect(left[0]!).toBeCloseTo(right[0]!, 12);
    // peak density sits at the centre
    const center = gaussianKde(data, [0])[0]!;
    expect(center).toBeGreaterThan(left[0]!);
  });

  it("is non-negative everywhere and 0 for degenerate data", () => {
    const d = gaussianKde([1, 2, 3, 100], grid(-50, 150, 200));
    expect(d.every((v) => v >= 0)).toBe(true);
    expect(gaussianKde([5, 5, 5], [4, 5, 6])).toEqual([0, 0, 0]); // bw 0 → flat
    expect(gaussianKde([], [1, 2])).toEqual([0, 0]);
  });

  it("respects an explicit bandwidth", () => {
    // A single point with bw h: density at the point is φ(0)/h = 0.3989/h.
    expect(gaussianKde([0], [0], 2)[0]!).toBeCloseTo(0.39894 / 2, 5);
    expect(gaussianKde([0], [2], 2)[0]!).toBeCloseTo((0.39894 * Math.exp(-0.5)) / 2, 5);
  });
});

describe("normalCiMultiplier", () => {
  it("is the normal z quantile for common levels", () => {
    expect(normalCiMultiplier(0.95)).toBeCloseTo(1.959964, 5);
    expect(normalCiMultiplier(0.9)).toBeCloseTo(1.644854, 5);
    expect(normalCiMultiplier(0.99)).toBeCloseTo(2.575829, 5);
  });
});

describe("metaAnalysis (forest pooling)", () => {
  // Oracle: reference values from statsmodels.stats.meta_analysis.combine_effects(method_re="chi2")
  // — DerSimonian-Laird — with variances back-calculated from 95% CIs via scipy norm.ppf(0.975).
  // Independent recomputation (different library, different code path).
  const studies = [
    { est: 2.0, lo: 1.0, hi: 3.0 },
    { est: 2.5, lo: 2.0, hi: 3.0 },
    { est: 1.0, lo: 0.2, hi: 1.8 },
    { est: 3.0, lo: 2.5, hi: 3.5 },
  ];
  it("fixed-effect pooled estimate + CI match statsmodels", () => {
    const r = metaAnalysis(studies, { model: "fixed", inputConf: 0.95, pooledConf: 0.95, log: false })!;
    expect(r.k).toBe(4);
    expect(r.est).toBeCloseTo(2.4201183432, 6);
    expect(r.lo).toBeCloseTo(2.1124260355, 6);
    expect(r.hi).toBeCloseTo(2.7278106509, 6);
  });
  it("random-effects (DerSimonian-Laird) pooled estimate + CI match statsmodels", () => {
    const r = metaAnalysis(studies, { model: "random", inputConf: 0.95, pooledConf: 0.95, log: false })!;
    expect(r.est).toBeCloseTo(2.1779017865, 6);
    expect(r.lo).toBeCloseTo(1.3736096323, 6);
    expect(r.hi).toBeCloseTo(2.9821939407, 6);
  });
  it("heterogeneity Q, τ² and I² match statsmodels (same for either model — a data property)", () => {
    for (const model of ["fixed", "random"] as const) {
      const r = metaAnalysis(studies, { model, inputConf: 0.95, pooledConf: 0.95, log: false })!;
      // 4-dp tolerance: cross-library float noise (our z from studentTInv vs scipy norm.ppf)
      // is ~1e-6; a real pooling error would be orders of magnitude larger.
      expect(r.q).toBeCloseTo(18.0480372996, 4);
      expect(r.df).toBe(3);
      expect(r.tau2).toBeCloseTo(0.5435294662, 5);
      expect(r.i2).toBeCloseTo(83.3776939276, 4);
    }
  });
  it("honours the entered CI level: a 90% CI implies a smaller SE than the same width read as 95%", () => {
    const one = [{ est: 2, lo: 1, hi: 3 }];
    // se = width/(2·z); z(90%) < z(95%) → se larger at 90% → wider pooled CI at 90% input.
    const at95 = metaAnalysis(one, { model: "fixed", inputConf: 0.95, pooledConf: 0.95, log: false })!;
    const at90 = metaAnalysis(one, { model: "fixed", inputConf: 0.9, pooledConf: 0.95, log: false })!;
    expect(at90.hi - at90.lo).toBeGreaterThan(at95.hi - at95.lo);
    // Concretely: se = (hi−lo)/(2·z₉₀) = 2/(2·1.644854); pooled 95% half-width = 1.959964·se.
    const se90 = (3 - 1) / (2 * 1.6448536);
    expect(at90.hi - at90.est).toBeCloseTo(1.959964 * se90, 5);
  });
  it("log space (ratio measures): pools in log units, returns to ratio space", () => {
    const r = metaAnalysis([{ est: 2, lo: 1, hi: 4 }], { model: "fixed", inputConf: 0.95, pooledConf: 0.95, log: true })!;
    expect(r.est).toBeCloseTo(2, 6); // a single study's pooled estimate is itself
    // symmetric in LOG space → geometric CI: lo·hi = est²
    expect(r.lo * r.hi).toBeCloseTo(4, 4);
  });
  it("returns null when no study is usable", () => {
    expect(metaAnalysis([], { model: "fixed", inputConf: 0.95, pooledConf: 0.95, log: false })).toBeNull();
    expect(metaAnalysis([{ est: 1, lo: 2, hi: 1 }], { model: "fixed", inputConf: 0.95, pooledConf: 0.95, log: false })).toBeNull();
  });
});

/** Build a study whose back-calculated SE is exactly `se`: limits are est ± z·se at 95%. */
function studyOf(est: number, se: number, log = false): { est: number; lo: number; hi: number } {
  const z = normalCiMultiplier(0.95);
  if (log) return { est: Math.exp(est), lo: Math.exp(est - z * se), hi: Math.exp(est + z * se) };
  return { est, lo: est - z * se, hi: est + z * se };
}

describe("eggerTest (funnel asymmetry)", () => {
  // Oracle: the whole OLS derived by hand, no shared code. Precisions x = [1, 2, 3]
  // (se = 1, 1/2, 1/3) and standardized effects z = y/se = [3, 5, 8] (y = 3, 2.5, 8/3).
  //   x̄ = 2 · z̄ = 16/3 · Sxx = 2 · Sxz = 5  →  slope = 5/2, intercept = 16/3 − 5 = 1/3.
  //   RSS = (1/6)² summed = 1/6 → s² = RSS/(k−2) = 1/6.
  //   se(intercept) = √(s²·(1/k + x̄²/Sxx)) = √(7/18) = 0.6236096.
  //   t = (1/3)/√(7/18) = 0.5345225, df = 1; at df = 1 the t is a Cauchy, so the
  //   two-sided p has the closed form 1 − (2/π)·atan|t| = 0.6875050 — no t-CDF shared.
  const THREE = [studyOf(3, 1), studyOf(2.5, 0.5), studyOf(8 / 3, 1 / 3)];
  it("intercept, slope, se, t, df and p match the hand-computed OLS", () => {
    const r = eggerTest(THREE, { inputConf: 0.95, log: false })!;
    expect(r.intercept).toBeCloseTo(1 / 3, 8);
    expect(r.slope).toBeCloseTo(2.5, 8);
    expect(r.interceptSe).toBeCloseTo(Math.sqrt(7 / 18), 8);
    expect(r.slopeSe).toBeCloseTo(Math.sqrt(1 / 12), 8);
    expect(r.t).toBeCloseTo(0.5345225, 6);
    expect(r.df).toBe(1);
    expect(r.p).toBeCloseTo(1 - (2 / Math.PI) * Math.atan(0.5345225), 6);
  });
  it("the intercept CI uses the t quantile at df = k − 2", () => {
    const r = eggerTest(THREE, { inputConf: 0.95, log: false })!;
    const tc = studentTInv(0.975, 1); // 12.7062
    expect(r.ciLow).toBeCloseTo(1 / 3 - tc * Math.sqrt(7 / 18), 4);
    expect(r.ciHigh).toBeCloseTo(1 / 3 + tc * Math.sqrt(7 / 18), 4);
  });
  it("log variant: exp-transformed studies give the same regression (it runs in log space)", () => {
    const logged = [studyOf(3, 1, true), studyOf(2.5, 0.5, true), studyOf(8 / 3, 1 / 3, true)];
    const r = eggerTest(logged, { inputConf: 0.95, log: true })!;
    expect(r.intercept).toBeCloseTo(1 / 3, 8);
    expect(r.slope).toBeCloseTo(2.5, 8);
    expect(r.p).toBeCloseTo(1 - (2 / Math.PI) * Math.atan(0.5345225), 6);
  });
  it("needs 3 usable studies and a precision spread — else null", () => {
    expect(eggerTest(THREE.slice(0, 2), { inputConf: 0.95, log: false })).toBeNull();
    // Equal precisions: Sxx = 0, the regression is singular.
    expect(eggerTest([studyOf(0, 1), studyOf(1, 1), studyOf(2, 1)], { inputConf: 0.95, log: false })).toBeNull();
  });
});

describe("trimAndFill (Duval-Tweedie L0)", () => {
  // Oracle: the full iteration derived by hand. Three precise studies at 0 (se = 0.1,
  // w = 100) and two imprecise high ones at 1 and 2 (se = 1, w = 1) — the classic
  // one-sided funnel. Iter 1: μ̂ = 3/302; deviations rank (2,2,2 | 4,5) → Tn = 9,
  // L0 = (4·9 − 5·6)/9 = 2/3 → k0 = 1. Iter 2 (trim y = 2): μ̂ = 1/301; same ranks,
  // L0 = 2/3 → 1 → converged. Fill mirrors y = 2 about μ̂: y* = 2/301·1 − 2 = −1.9933555.
  // Adjusted fixed pool over 6: Σwy = 3 − 1.9933555 = 1.0066445, Σw = 303
  // → est = 0.00332226, se = 1/√303 = 0.05744850.
  const SKEWED = [studyOf(0, 0.1), studyOf(0, 0.1), studyOf(0, 0.1), studyOf(1, 1), studyOf(2, 1)];
  it("estimates k0 = 1 on the missing-left side and fills the mirrored study", () => {
    const r = trimAndFill(SKEWED, { model: "fixed", inputConf: 0.95, pooledConf: 0.95, log: false })!;
    expect(r.side).toBe("left");
    expect(r.k0).toBe(1);
    expect(r.imputed).toHaveLength(1);
    expect(r.imputed[0]!.est).toBeCloseTo(2 / 301 - 2, 6);
    // The imputed study carries its source's SE: limits est ± 1.959964·1.
    expect(r.imputed[0]!.hi - r.imputed[0]!.lo).toBeCloseTo(2 * normalCiMultiplier(0.95), 5);
  });
  it("adjusted pooled effect matches the hand computation (and pools k + k0 studies)", () => {
    const r = trimAndFill(SKEWED, { model: "fixed", inputConf: 0.95, pooledConf: 0.95, log: false })!;
    expect(r.adjusted.k).toBe(6);
    expect(r.adjusted.est).toBeCloseTo(1.0066445 / 303, 7);
    expect(r.adjusted.se).toBeCloseTo(1 / Math.sqrt(303), 7);
  });
  it("mirror invariance: negating every effect flips the side, keeps k0, negates the estimate", () => {
    const flipped = SKEWED.map((s) => ({ est: -s.est, lo: -s.hi, hi: -s.lo }));
    const r = trimAndFill(flipped, { model: "fixed", inputConf: 0.95, pooledConf: 0.95, log: false })!;
    expect(r.side).toBe("right");
    expect(r.k0).toBe(1);
    expect(r.imputed[0]!.est).toBeCloseTo(2 - 2 / 301, 6);
    expect(r.adjusted.est).toBeCloseTo(-1.0066445 / 303, 7);
  });
  it("a symmetric funnel imputes nothing: k0 = 0 and adjusted ≡ the plain pooling", () => {
    // y = [−1, 0, 1], se = [1, 1/2, 1]: Σwy = 0 → μ̂ = 0; ranks (1 | 2.5, 2.5),
    // Tn = 2.5 → L0 = (10 − 12)/5 < 0 → k0 = 0.
    const sym = [studyOf(-1, 1), studyOf(0, 0.5), studyOf(1, 1)];
    const r = trimAndFill(sym, { model: "fixed", inputConf: 0.95, pooledConf: 0.95, log: false })!;
    expect(r.k0).toBe(0);
    expect(r.imputed).toHaveLength(0);
    const plain = metaAnalysis(sym, { model: "fixed", inputConf: 0.95, pooledConf: 0.95, log: false })!;
    expect(r.adjusted.est).toBeCloseTo(plain.est, 10);
    expect(r.adjusted.lo).toBeCloseTo(plain.lo, 10);
  });
  it("log variant mirrors in LOG space: imputed estimates are reciprocals about the centre", () => {
    const logged = SKEWED.map((s) => ({ est: Math.exp(s.est), lo: Math.exp(s.lo), hi: Math.exp(s.hi) }));
    const r = trimAndFill(logged, { model: "fixed", inputConf: 0.95, pooledConf: 0.95, log: true })!;
    expect(r.k0).toBe(1);
    expect(Math.log(r.imputed[0]!.est)).toBeCloseTo(2 / 301 - 2, 6);
    expect(Math.log(r.adjusted.est)).toBeCloseTo(1.0066445 / 303, 7);
  });
  it("random-effects adjusted pooling reports wider uncertainty on this heterogeneous set", () => {
    const fixed = trimAndFill(SKEWED, { model: "fixed", inputConf: 0.95, pooledConf: 0.95, log: false })!;
    const random = trimAndFill(SKEWED, { model: "random", inputConf: 0.95, pooledConf: 0.95, log: false })!;
    expect(random.adjusted.model).toBe("random");
    expect(random.adjusted.hi - random.adjusted.lo).toBeGreaterThan(fixed.adjusted.hi - fixed.adjusted.lo);
  });
  it("needs 3 usable studies — else null", () => {
    expect(trimAndFill(SKEWED.slice(0, 2), { model: "fixed", inputConf: 0.95, pooledConf: 0.95, log: false })).toBeNull();
    expect(trimAndFill([], { model: "fixed", inputConf: 0.95, pooledConf: 0.95, log: false })).toBeNull();
  });
});
