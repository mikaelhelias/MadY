import { describe, it, expect } from "vitest";
import { histogram, histogramTable, histogramTableMulti, exactCumulativeTable, gaussianExpected } from "./histogram";

describe("histogram binning", () => {
  it("bins evenly with an explicit width and closes the final bin on the right", () => {
    // 0..10, width 5 → bins [0,5) and [5,10]; the 10 lands in the last bin.
    const bins = histogram([0, 1, 4, 5, 6, 9, 10], { binWidth: 5, range: [0, 10] });
    expect(bins).toHaveLength(2);
    expect(bins[0]).toMatchObject({ start: 0, end: 5, center: 2.5, count: 3 }); // 0,1,4
    expect(bins[1]).toMatchObject({ start: 5, end: 10, center: 7.5, count: 4 }); // 5,6,9,10
  });

  it("counts sum to N and fractions to 1", () => {
    const bins = histogram([1, 2, 2, 3, 3, 3, 4], { bins: 4 });
    const total = bins.reduce((a, b) => a + b.count, 0);
    expect(total).toBe(7);
    expect(bins.reduce((a, b) => a + b.fraction, 0)).toBeCloseTo(1, 10);
    expect(bins.reduce((a, b) => a + b.percent, 0)).toBeCloseTo(100, 8);
  });

  it("cumulative count climbs to N from the low end", () => {
    const bins = histogram([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], { binWidth: 2, range: [0, 10] });
    expect(bins.map((b) => b.count)).toEqual([2, 2, 2, 2, 2]);
    expect(bins.map((b) => b.cumCount)).toEqual([2, 4, 6, 8, 10]);
    expect(bins[bins.length - 1]!.cumPercent).toBeCloseTo(100);
  });

  it("cumulativeFromTop accumulates from the high end", () => {
    const bins = histogram([0, 1, 2, 3], { binWidth: 1, range: [0, 4], cumulativeFromTop: true });
    // counts: [1,1,1,1]; cum from top: bin3=1, bin2=2, bin1=3, bin0=4
    expect(bins.map((b) => b.cumCount)).toEqual([4, 3, 2, 1]);
  });

  it("auto bin count is √n clamped", () => {
    const bins = histogram(Array.from({ length: 100 }, (_, i) => i));
    expect(bins).toHaveLength(10); // √100 = 10
  });

  it("respects an explicit origin (first-bin lower edge)", () => {
    const bins = histogram([2, 3, 4], { binWidth: 2, origin: 0 });
    expect(bins[0]!.start).toBe(0);
  });

  it("drops out-of-range values when a range is given", () => {
    const bins = histogram([-5, 1, 2, 99], { binWidth: 1, range: [0, 3] });
    expect(bins.reduce((a, b) => a + b.count, 0)).toBe(2); // only 1 and 2 survive
  });

  it("empty input yields no bins", () => {
    expect(histogram([])).toEqual([]);
    expect(histogram([NaN, Infinity])).toEqual([]);
  });

  it("a single distinct value still produces one bin holding all counts", () => {
    const bins = histogram([5, 5, 5]);
    expect(bins).toHaveLength(1);
    expect(bins[0]!.count).toBe(3);
  });
});

describe("histogramTable", () => {
  it("emits a plot-ready grid: bin centre + count/%/cumulative columns", () => {
    const bins = histogram([0, 1, 2, 3], { binWidth: 2, range: [0, 4] });
    const t = histogramTable(bins, "Score");
    expect(t.columnNames).toEqual([
      "Score (bin centre)",
      "Count",
      "Relative %",
      "Cumulative count",
      "Cumulative %",
    ]);
    expect(t.rows).toHaveLength(2);
    expect(t.rows[0]).toEqual([1, 2, 50, 2, 50]); // centre 1, count 2, 50%, cum 2, 50%
    expect(t.rows[1]).toEqual([3, 2, 50, 4, 100]);
  });

  it("includeFractions appends relative + cumulative fraction columns", () => {
    const bins = histogram([0, 1, 2, 3], { binWidth: 2, range: [0, 4] });
    const t = histogramTable(bins, "Score", true);
    expect(t.columnNames).toEqual([
      "Score (bin centre)",
      "Count",
      "Relative %",
      "Relative fraction",
      "Cumulative count",
      "Cumulative %",
      "Cumulative fraction",
    ]);
    expect(t.rows[0]).toEqual([1, 2, 50, 0.5, 2, 50, 0.5]);
    expect(t.rows[1]).toEqual([3, 2, 50, 0.5, 4, 100, 1]);
  });
});

describe("histogramTableMulti (per-subcolumn frequency, shared grid)", () => {
  it("bins several columns on ONE shared grid → a Count column per input", () => {
    const t = histogramTableMulti(
      [{ label: "A", values: [0, 1, 2, 3] }, { label: "B", values: [4, 5, 6, 7] }],
      { binWidth: 4 },
    );
    expect(t.columnNames).toEqual(["Bin centre", "A", "B"]);
    expect(t.rows).toEqual([[2, 4, 0], [6, 0, 4]]); // shared centres 2 & 6; A fills bin 0, B fills bin 1
    // each column's counts sum to its N
    expect(t.rows.reduce((s, r) => s + (r[1] as number), 0)).toBe(4);
    expect(t.rows.reduce((s, r) => s + (r[2] as number), 0)).toBe(4);
  });

  it("the shared grid spans the POOLED range so every column uses identical bins", () => {
    const t = histogramTableMulti(
      [{ label: "Lo", values: [1, 1, 2] }, { label: "Hi", values: [9, 10] }],
      { bins: 3 },
    );
    const loCol = t.rows.map((r) => r[1] as number);
    const hiCol = t.rows.map((r) => r[2] as number);
    expect(loCol[0]).toBe(3); // all three "Lo" values in the lowest shared bin
    expect(hiCol[hiCol.length - 1]).toBe(2); // both "Hi" values in the top shared bin
    expect(loCol.reduce((a, b) => a + b, 0)).toBe(3);
    expect(hiCol.reduce((a, b) => a + b, 0)).toBe(2);
  });

  it("empty / no-value input → just the bin-centre header, no rows", () => {
    expect(histogramTableMulti([], {}).rows).toHaveLength(0);
    expect(histogramTableMulti([{ label: "A", values: [] }], {}).columnNames).toEqual(["Bin centre"]);
  });
});

describe("exactCumulativeTable (unbinned ECDF)", () => {
  it("emits one row per distinct value with cumulative count/fraction/percent", () => {
    const t = exactCumulativeTable([1, 2, 2, 3], "X");
    expect(t.columnNames).toEqual(["X", "Cumulative count", "Cumulative fraction", "Cumulative %"]);
    expect(t.rows).toEqual([
      [1, 1, 0.25, 25], // one value ≤ 1
      [2, 3, 0.75, 75], // three ≤ 2
      [3, 4, 1, 100], // all four ≤ 3
    ]);
  });

  it("fromTop counts values ≥ each distinct value", () => {
    const t = exactCumulativeTable([1, 2, 2, 3], "X", { fromTop: true });
    expect(t.rows.map((row) => row[1])).toEqual([4, 3, 1]); // ≥1: 4, ≥2: 3, ≥3: 1
    expect(t.rows[0]).toEqual([1, 4, 1, 100]);
  });

  it("empty input yields no rows", () => {
    expect(exactCumulativeTable([]).rows).toEqual([]);
  });
});

describe("gaussianExpected (normal overlay)", () => {
  const vals = [3, 5, 5, 6, 7, 8, 8, 9, 11, 4, 6, 7, 10, 6, 8];
  const n = vals.length;
  const mean = vals.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1));

  it("integrates the normal mass per bin — matches the textbook ±1σ (68.27%) and ±3σ (99.73%) coverage", () => {
    const one = histogram(vals, { binWidth: 2 * sd, range: [mean - sd, mean + sd] });
    expect(one).toHaveLength(1);
    expect(gaussianExpected(vals, one)![0]!.fraction).toBeCloseTo(0.6827, 3);
    const three = histogram(vals, { binWidth: 6 * sd, range: [mean - 3 * sd, mean + 3 * sd] });
    expect(three).toHaveLength(1);
    expect(gaussianExpected(vals, three)![0]!.fraction).toBeCloseTo(0.9973, 3);
  });

  it("expected mass is symmetric about the mean and peaks at the centre bin", () => {
    const sym = [-2, -1, -1, 0, 0, 0, 1, 1, 2]; // mean 0
    const bins = histogram(sym, { binWidth: 1, range: [-2.5, 2.5] }); // 5 bins, centres -2..2
    const exp = gaussianExpected(sym, bins)!;
    expect(exp).toHaveLength(5);
    expect(exp[0]!.count).toBeCloseTo(exp[4]!.count, 9); // symmetric tails
    expect(exp[1]!.count).toBeCloseTo(exp[3]!.count, 9);
    expect(exp[2]!.count).toBeGreaterThan(exp[1]!.count); // peak at centre
    const total = bins.reduce((a, b) => a + b.count, 0);
    for (const e of exp) {
      expect(e.count).toBeCloseTo(total * e.fraction, 9); // count = total·fraction
      expect(e.percent).toBeCloseTo(100 * e.fraction, 9); // percent = 100·fraction
    }
  });

  it("returns null when the SD is undefined (all values equal or n<2)", () => {
    const bins = histogram([5, 5, 5], { bins: 3 });
    expect(gaussianExpected([5, 5, 5], bins)).toBeNull();
    expect(gaussianExpected([5], bins)).toBeNull();
  });
});

describe("histogramTable Gaussian overlay", () => {
  const vals = [0, 1, 1, 2, 2, 2, 3, 3, 4];
  it("appends Expected count/% columns when raw values are supplied", () => {
    const t = histogramTable(histogram(vals, { binWidth: 1, range: [0, 5] }), "X", false, vals);
    expect(t.columnNames.slice(-2)).toEqual(["Expected count", "Expected %"]);
    expect(t.rows[0]!).toHaveLength(t.columnNames.length); // every row filled
  });

  it("with fractions also appends Expected fraction", () => {
    const t = histogramTable(histogram(vals, { binWidth: 1, range: [0, 5] }), "X", true, vals);
    expect(t.columnNames.slice(-3)).toEqual(["Expected count", "Expected %", "Expected fraction"]);
  });

  it("omits the overlay columns for degenerate (zero-SD) data or when no values are passed", () => {
    expect(histogramTable(histogram([5, 5, 5], { bins: 1 }), "X", false, [5, 5, 5]).columnNames).not.toContain("Expected count");
    expect(histogramTable(histogram(vals, { binWidth: 1 }), "X").columnNames).not.toContain("Expected count");
  });
});
