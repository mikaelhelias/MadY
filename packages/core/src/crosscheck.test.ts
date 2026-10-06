/**
 * Independent cross-check of the core TypeScript math. These calculations live in
 * `packages/core`, outside the Python
 * engine. Each check recomputes a quantity via a different method than the module
 * uses — an independent Abramowitz-Stegun normal CDF, round-trips through inverse
 * operations, and from-scratch loops — and asserts agreement. Pure TS, so unlike
 * the Python `crosscheck.py` this also runs in CI.
 */
import { describe, it, expect } from "vitest";
import { histogram, histogramTable, exactCumulativeTable } from "./histogram";
import { normalProbabilityPlot, lognormalProbabilityPlot, gwasQQ } from "./qqplot";
import { TRANSFORMS, transformById, normInv, type TransformId, type ColumnContext } from "./transform";
import { residualDiagnostics } from "./residuals";
import { recomputeDerived } from "./derive";
import type { TableDerivation } from "./model";
import type { NamedTable } from "./reshape";

// ── independent oracles (share no code with the modules under test) ──────────
/** Standard-normal CDF via the Abramowitz-Stegun 7.1.26 erf approximation — an
 *  independent implementation (transform.ts uses Acklam's inverse-CDF rational fit). */
function erf(x: number): number {
  const s = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) * Math.exp(-ax * ax);
  return s * y;
}
const Phi = (z: number): number => 0.5 * (1 + erf(z / Math.SQRT2));
const mean = (a: number[]): number => a.reduce((s, v) => s + v, 0) / a.length;
const sd1 = (a: number[]): number => {
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
};
const DUMMY_CTX: ColumnContext = { values: [], mean: 0, sd: 1, min: 0, max: 1, sum: 0, sorted: [] };
const ap = (id: TransformId, y: number, k = 0, ctx: ColumnContext = DUMMY_CTX): number | null =>
  transformById(id)!.apply(y, k, ctx, 0, 0.5);

describe("core cross-check — normInv (probit) vs an independent normal CDF", () => {
  it("Φ(normInv(p)) ≈ p across the range (round-trip through A&S erf)", () => {
    for (const p of [0.01, 0.05, 0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9, 0.95, 0.99]) {
      expect(Phi(normInv(p)!)).toBeCloseTo(p, 5);
    }
    expect(normInv(0.5)!).toBeCloseTo(0, 9);
    for (const p of [0.1, 0.3, 0.42]) expect(normInv(p)!).toBeCloseTo(-normInv(1 - p)!, 6); // symmetry
    expect(normInv(0)).toBeNull();
    expect(normInv(1)).toBeNull();
  });
});

describe("core cross-check — transforms vs independent recompute", () => {
  it("element transforms match a different formula / an inverse round-trip", () => {
    for (const y of [0.5, 2, 5, 10]) {
      expect(ap("log10", y)!).toBeCloseTo(Math.log(y) / Math.LN10, 12); // ≠ the module's Math.log10
      expect(Math.exp(ap("ln", y)!)).toBeCloseTo(y, 10); // ln round-trips through exp
      expect(ap("pow10", ap("log10", y)!)!).toBeCloseTo(y, 8); // 10^log10(y) = y
      expect(ap("sqrt", y)! ** 2).toBeCloseTo(y, 10); // (√y)² = y
      expect(ap("square", y)!).toBeCloseTo(y * y, 12);
      expect(ap("cube", y)!).toBeCloseTo(y ** 3, 10);
      expect(ap("reciprocal", y)! * y).toBeCloseTo(1, 12);
      expect(ap("pow-k", y, 3)!).toBeCloseTo(y ** 3, 10);
    }
    for (const y of [0.1, 0.3, 0.7, 0.9]) {
      expect(ap("logit", y)!).toBeCloseTo(Math.log(y) - Math.log(1 - y), 12); // ≠ ln(y/(1−y))
      expect(Math.sin(ap("arcsin-sqrt", y)!) ** 2).toBeCloseTo(y, 10); // sin²(asin√y) = y
    }
    expect(ap("probit", 0.975)!).toBeCloseTo(normInv(0.975)!, 12);
  });

  it("domain guards return null out of domain", () => {
    expect(ap("log10", -1)).toBeNull();
    expect(ap("log10", 0)).toBeNull();
    expect(ap("sqrt", -4)).toBeNull();
    expect(ap("logit", 1)).toBeNull();
    expect(ap("logit", 0)).toBeNull();
    expect(ap("reciprocal", 0)).toBeNull();
    expect(ap("div-k", 5, 0)).toBeNull();
    expect(ap("arcsin-sqrt", 1.5)).toBeNull();
  });

  it("column-aware transforms (z-score / center / normalize / rank) match independent stats", () => {
    const vals = [4, 8, 15, 16, 23, 42];
    const m = mean(vals);
    const s = sd1(vals);
    const mn = Math.min(...vals);
    const mx = Math.max(...vals);
    const sum = vals.reduce((a, b) => a + b, 0);
    const ctx: ColumnContext = { values: vals, mean: m, sd: s, min: mn, max: mx, sum, sorted: [...vals].sort((a, b) => a - b) };
    const z = vals.map((y) => ap("zscore", y, 0, ctx)!);
    expect(mean(z)).toBeCloseTo(0, 10); // z-scores have mean 0
    expect(sd1(z)).toBeCloseTo(1, 10); // and SD 1
    for (const y of vals) {
      expect(ap("zscore", y, 0, ctx)!).toBeCloseTo((y - m) / s, 12);
      expect(ap("center", y, 0, ctx)!).toBeCloseTo(y - m, 12);
      expect(ap("normalize01", y, 0, ctx)!).toBeCloseTo((y - mn) / (mx - mn), 12);
      expect(ap("normalize100", y, 0, ctx)!).toBeCloseTo((100 * (y - mn)) / (mx - mn), 10);
      expect(ap("fraction-total", y, 0, ctx)!).toBeCloseTo(y / sum, 12);
      expect(ap("percent-total", y, 0, ctx)!).toBeCloseTo((100 * y) / sum, 10);
    }
    // average-tie rank
    const dr = [10, 20, 20, 30];
    const cr: ColumnContext = { values: dr, mean: mean(dr), sd: sd1(dr), min: 10, max: 30, sum: 80, sorted: [10, 20, 20, 30] };
    expect(ap("rank", 10, 0, cr)!).toBeCloseTo(1, 10);
    expect(ap("rank", 20, 0, cr)!).toBeCloseTo(2.5, 10); // tie of the 2nd & 3rd positions
    expect(ap("rank", 30, 0, cr)!).toBeCloseTo(4, 10);
  });

  it("every transform id resolves to a distinct registered function", () => {
    const ids = new Set(TRANSFORMS.map((t) => t.id));
    expect(ids.size).toBe(TRANSFORMS.length); // no duplicate ids
    for (const t of TRANSFORMS) expect(transformById(t.id)).toBe(t);
  });
});

describe("core cross-check — histogram vs independent binning", () => {
  it("bin counts / fractions / cumulative match a from-scratch loop", () => {
    const data = [0.3, 1.1, 1.9, 2.2, 2.8, 3.4, 3.9, 4.1, 4.7, 0.8, 2.5, 3.1];
    const bins = histogram(data, { binWidth: 1, range: [0, 5] });
    const lo = 0;
    const hi = 5;
    const w = 1;
    const nb = 5;
    const counts = new Array<number>(nb).fill(0);
    for (const v of data) {
      if (v < lo || v > hi) continue;
      let i = Math.floor((v - lo) / w);
      if (i >= nb) i = nb - 1;
      counts[i]! += 1;
    }
    const total = counts.reduce((a, b) => a + b, 0);
    let cum = 0;
    bins.forEach((b, i) => {
      cum += counts[i]!;
      expect(b.count).toBe(counts[i]);
      expect(b.fraction).toBeCloseTo(counts[i]! / total, 12);
      expect(b.percent).toBeCloseTo((100 * counts[i]!) / total, 10);
      expect(b.cumCount).toBe(cum);
      expect(b.cumFraction).toBeCloseTo(cum / total, 12);
    });
  });

  it("exactCumulativeTable = the independent empirical CDF", () => {
    const data = [3, 1, 4, 1, 5, 9, 2, 6];
    const t = exactCumulativeTable(data, "X");
    const sorted = [...data].sort((a, b) => a - b);
    const distinct = [...new Set(sorted)];
    expect(t.rows).toHaveLength(distinct.length);
    t.rows.forEach((row, i) => {
      const v = distinct[i]!;
      const leq = sorted.filter((x) => x <= v).length;
      expect(row[0]).toBe(v);
      expect(row[1]).toBe(leq);
      expect(row[2] as number).toBeCloseTo(leq / data.length, 12);
    });
  });
});

describe("core cross-check — QQ plot vs independent recompute", () => {
  it("plotting positions + Φ(z)=p round-trip + reference line", () => {
    const data = [5, 2, 8, 3, 9, 1, 7, 4, 6];
    const res = normalProbabilityPlot(data, "blom");
    const n = data.length;
    const a = 0.375;
    const m = mean(data);
    const s = sd1(data);
    const sorted = [...data].sort((x, y) => x - y);
    res.points.forEach((pt, i) => {
      const p = (i + 1 - a) / (n + 1 - 2 * a);
      expect(pt.value).toBe(sorted[i]); // sorted ascending
      expect(Phi(pt.z)).toBeCloseTo(p, 5); // z = Φ⁻¹(p) → Φ(z) = p via the independent CDF
      expect(pt.reference).toBeCloseTo(m + pt.z * s, 10); // reference line = mean + z·SD
    });
    expect(res.mean).toBeCloseTo(m, 12);
    expect(res.sd).toBeCloseTo(s, 12);
  });

  it("lognormal QQ = normal QQ on logs, geometric mean back-transformed", () => {
    const data = [2, 4, 8, 16, 3, 6, 12];
    const res = lognormalProbabilityPlot(data, "blom");
    const logs = data.map((v) => Math.log(v));
    const ml = mean(logs);
    const sl = sd1(logs);
    expect(res.mean).toBeCloseTo(Math.exp(ml), 10); // geometric mean
    const sortedLog = [...logs].sort((x, y) => x - y);
    res.points.forEach((pt, i) => {
      expect(Math.log(pt.value)).toBeCloseTo(sortedLog[i]!, 10); // ordered original values
      expect(Math.log(pt.reference)).toBeCloseTo(ml + pt.z * sl, 8); // straight on the log scale
    });
  });
});

describe("core cross-check — GWAS QQ (gwasQQ) vs independent recompute", () => {
  it("uniform-null expectations are arithmetic; λ round-trips through the independent normal CDF", () => {
    const ps = [0.001, 0.01, 0.1, 0.5, 0.9];
    const r = gwasQQ(ps);
    const n = ps.length;
    const sorted = [...ps].sort((a, b) => a - b);
    r.points.forEach((pt, i) => {
      expect(pt.expected).toBeCloseTo(-Math.log10((i + 0.5) / n), 12); // uniform-null −log10 expectation
      expect(pt.observed).toBeCloseTo(-Math.log10(sorted[i]!), 12); // sorted observed −log10 p
    });
    // λ·median(χ²₁) = the median χ²₁; χ² is monotone in p, so that median is χ²₁(median p).
    // Verify without the engine's normInv: χ²₁ = z² where Φ(z) = 1−p/2, so 2(1−Φ(√χ²)) must
    // return the median p through the test's own independent Φ (erf-based).
    const medP = sorted[Math.floor(n / 2)]!; // 0.1
    const chiMed = r.lambda * 0.4549364231195736;
    expect(2 * (1 - Phi(Math.sqrt(chiMed)))).toBeCloseTo(medP, 5);
  });

  it("well-calibrated data (median p = 0.5) has λ = 1", () => {
    expect(gwasQQ([0.2, 0.5, 0.8]).lambda).toBeCloseTo(1, 6); // median p = 0.5 → χ²₁ = 0.4549
  });
});

describe("core cross-check — residual diagnostics vs independent recompute", () => {
  it("sorted pairs + scale-location √|r/sd| match", () => {
    const fitted = [3, 1, 4, 1.5, 5, 9, 2];
    const resid = [0.2, -0.5, 0.1, 0.3, -0.2, 0.4, -0.1];
    const d = residualDiagnostics(fitted, resid)!;
    const pts = fitted
      .map((f, i) => [f, resid[i]!] as [number, number])
      .filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))
      .sort((a, b) => a[0] - b[0]);
    const s = sd1(pts.map((p) => p[1]));
    expect(d.n).toBe(pts.length);
    d.residualVsPredicted.rows.forEach((row, i) => {
      expect(row[0]).toBe(pts[i]![0]);
      expect(row[1]).toBe(pts[i]![1]);
    });
    d.scaleLocation!.rows.forEach((row, i) => {
      expect(row[1]).toBeCloseTo(Math.sqrt(Math.abs(pts[i]![1] / s)), 10);
    });
  });
});

describe("core cross-check — reactive derivation = direct computation", () => {
  const src: NamedTable = { columnNames: ["X", "Y"], rows: [[1, 2], [2, 8], [3, 18], [4, 32]] };

  it("transform derivation matches an independent recompute", () => {
    const der = recomputeDerived({ source: "s", op: "transform", spec: { fn: "sqrt", columns: [1] } } as TableDerivation, src);
    der.rows.forEach((row, i) => {
      expect(row[1] as number).toBeCloseTo(Math.sqrt(src.rows[i]![1] as number), 10);
    });
  });

  it("frequency derivation matches a direct histogramTable", () => {
    const freq = recomputeDerived({ source: "s", op: "frequency", spec: { col: 1, mode: "count", bins: 2 } } as TableDerivation, src);
    const direct = histogramTable(histogram([2, 8, 18, 32], { bins: 2 }), "Y");
    expect(freq.columnNames).toEqual(direct.columnNames);
    expect(freq.rows).toEqual(direct.rows);
  });
});
