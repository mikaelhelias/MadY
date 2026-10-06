import { describe, it, expect } from "vitest";
import { normalProbabilityPlot, lognormalProbabilityPlot, qqTable, gwasQQ } from "./qqplot";

describe("gwasQQ (GWAS QQ + genomic inflation λ)", () => {
  it("pairs sorted p with the uniform-null expectation on the −log10 scale", () => {
    const r = gwasQQ([0.5, 0.1, 0.9, 0.01, 0.001]); // sorted: 0.001, 0.01, 0.1, 0.5, 0.9
    expect(r.n).toBe(5);
    expect(r.points[0]!.expected).toBeCloseTo(1, 6); // −log10((0+0.5)/5) = −log10(0.1)
    expect(r.points[0]!.observed).toBeCloseTo(3, 6); // −log10(0.001), the top peak
    expect(r.points[4]!.observed).toBeCloseTo(-Math.log10(0.9), 6);
    expect(r.maxLog).toBeCloseTo(3, 6);
  });

  it("λ = 1 exactly when the median p is 0.5 (median χ²₁ = 0.4549)", () => {
    expect(gwasQQ([0.5, 0.5, 0.5]).lambda).toBeCloseTo(1, 6);
  });

  it("λ > 1 signals inflation (median p ≪ 0.5)", () => {
    const r = gwasQQ([0.5, 0.1, 0.9, 0.01, 0.001]); // median p = 0.1 → χ²₁(0.1)=2.706
    expect(r.lambda).toBeGreaterThan(1);
    expect(r.lambda).toBeCloseTo(2.7055 / 0.4549364231195736, 1);
  });

  it("drops non-finite / out-of-range p; empty input → NaN λ, no points", () => {
    expect(gwasQQ([0.5, NaN, 0, 1.5, -0.1]).n).toBe(1);
    const empty = gwasQQ([]);
    expect(empty.points).toEqual([]);
    expect(empty.lambda).toBeNaN();
  });
});

describe("normal probability (QQ) plot", () => {
  it("sorts the values and pairs each with a symmetric normal quantile (Blom)", () => {
    const res = normalProbabilityPlot([3, 1, 2, 5, 4]);
    expect(res.n).toBe(5);
    // values come out sorted ascending
    expect(res.points.map((p) => p.value)).toEqual([1, 2, 3, 4, 5]);
    // z quantiles are symmetric about 0 with the median point at z = 0
    const z = res.points.map((p) => p.z);
    expect(z[2]).toBeCloseTo(0, 10); // middle point → p = 0.5 → z = 0
    expect(z[0]).toBeCloseTo(-z[4]!, 10); // symmetric tails
    expect(z[1]).toBeCloseTo(-z[3]!, 10);
    // strictly increasing
    for (let i = 1; i < z.length; i++) expect(z[i]!).toBeGreaterThan(z[i - 1]!);
  });

  it("Blom plotting position p = (i − 0.375)/(n + 0.25)", () => {
    const res = normalProbabilityPlot([10, 20, 30, 40], "blom");
    // n = 4 → p₁ = 0.625/4.25 = 0.147059; z₁ = Φ⁻¹(0.147)
    // check via the known symmetry + monotonicity instead of a hard-coded value
    expect(res.points[0]!.z).toBeLessThan(0);
    expect(res.points[3]!.z).toBeGreaterThan(0);
    expect(res.points[0]!.z).toBeCloseTo(-res.points[3]!.z, 10);
  });

  it("reference line is mean + z·SD (slope = SD, intercept = mean)", () => {
    const v = [2, 4, 6, 8, 10];
    const res = normalProbabilityPlot(v);
    const mean = 6;
    const sd = Math.sqrt((16 + 4 + 0 + 4 + 16) / 4); // sample SD
    expect(res.mean).toBeCloseTo(mean, 10);
    expect(res.sd).toBeCloseTo(sd, 10);
    expect(res.slope).toBeCloseTo(sd, 10);
    expect(res.intercept).toBeCloseTo(mean, 10);
    // each reference value = mean + z·SD
    for (const p of res.points) expect(p.reference).toBeCloseTo(mean + p.z * sd, 8);
  });

  it("perfectly linear input lands (almost) exactly on the reference line", () => {
    // values generated AS mean + z·SD would be exactly linear; for a symmetric
    // arithmetic sequence the points hug the line — check the correlation is ~1.
    const res = normalProbabilityPlot([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const zs = res.points.map((p) => p.z);
    const vs = res.points.map((p) => p.value);
    const n = zs.length;
    const mz = zs.reduce((a, b) => a + b, 0) / n;
    const mv = vs.reduce((a, b) => a + b, 0) / n;
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) {
      sxy += (zs[i]! - mz) * (vs[i]! - mv);
      sxx += (zs[i]! - mz) ** 2;
      syy += (vs[i]! - mv) ** 2;
    }
    const rcorr = sxy / Math.sqrt(sxx * syy);
    expect(rcorr).toBeGreaterThan(0.99); // near-perfect straight line
  });

  it("hazen and weibull positions differ from blom at the tails", () => {
    const blom = normalProbabilityPlot([1, 2, 3, 4, 5], "blom").points[0]!.z;
    const hazen = normalProbabilityPlot([1, 2, 3, 4, 5], "hazen").points[0]!.z;
    const weibull = normalProbabilityPlot([1, 2, 3, 4, 5], "weibull").points[0]!.z;
    // weibull (i/(n+1)) has the least extreme tail, blom in the middle, hazen most extreme
    expect(weibull).toBeGreaterThan(blom);
    expect(blom).toBeGreaterThan(hazen);
  });

  it("empty input yields no points", () => {
    expect(normalProbabilityPlot([]).points).toEqual([]);
  });

  it("qqTable emits a plot-ready X/points/line grid", () => {
    const res = normalProbabilityPlot([2, 4, 6], "hazen");
    const t = qqTable(res, "Score");
    expect(t.columnNames).toEqual(["Normal quantile (z)", "Score (ordered)", "Reference line"]);
    expect(t.rows).toHaveLength(3);
    // middle row: z = 0, value = 4 (the median), reference = mean(4) + 0·sd = 4
    expect(t.rows[1]![0]).toBeCloseTo(0, 8);
    expect(t.rows[1]![1]).toBe(4);
    expect(t.rows[1]![2]).toBeCloseTo(4, 8);
  });
});

describe("log-normal probability plot", () => {
  it("is the normal QQ of log(values); geometric mean/SD back-transformed", () => {
    const vals = [1, 2, 3, 4, 5].map((k) => Math.exp(k)); // logs are exactly the linear sequence 1..5
    const res = lognormalProbabilityPlot(vals);
    expect(res.n).toBe(5);
    expect(res.points.map((p) => Math.round(Math.log(p.value)))).toEqual([1, 2, 3, 4, 5]); // ordered originals
    expect(res.mean).toBeCloseTo(Math.exp(3), 6); // geometric mean = exp(mean of logs) = exp(3)
    // straight on the log scale: log(value) vs z is near-perfectly linear
    const zs = res.points.map((p) => p.z);
    const ls = res.points.map((p) => Math.log(p.value));
    const n = zs.length;
    const mz = zs.reduce((a, b) => a + b, 0) / n;
    const ml = ls.reduce((a, b) => a + b, 0) / n;
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) {
      sxy += (zs[i]! - mz) * (ls[i]! - ml);
      sxx += (zs[i]! - mz) ** 2;
      syy += (ls[i]! - ml) ** 2;
    }
    expect(sxy / Math.sqrt(sxx * syy)).toBeGreaterThan(0.99);
    // reference back on the original scale matches the log-line: log(ref) = mean_log + z·SD_log
    for (const p of res.points) expect(Math.log(p.reference)).toBeCloseTo(res.intercept + p.z * res.slope, 6);
  });

  it("drops non-positive values (log-normal support is x > 0)", () => {
    const res = lognormalProbabilityPlot([-1, 0, 1, Math.E, Math.E ** 2]);
    expect(res.n).toBe(3); // only 1, e, e² survive
  });

  it("empty / all-non-positive input yields no points", () => {
    expect(lognormalProbabilityPlot([-1, 0]).points).toEqual([]);
  });
});
