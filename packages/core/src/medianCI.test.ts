import { describe, expect, it } from "vitest";
import { medianCI } from "./stats";

// Oracle: every expected value below was computed OUTSIDE this code, in Python with exact
// integer binomial sums (math.comb, no floating point) — the same order-statistic rule the
// engine's `describe` uses and `crosscheck.py` re-derives. The expected ranks match the
// published sign-test tables (n = 20 → 6th value, n = 100 → 40th).

/** 1..n in a scrambled order, so the helper has to sort; the kth smallest value is k. */
function ranks(n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(((i * 7919) % n) + 1);
  return out;
}

describe("medianCI — exact order-statistic 95% CI of the median", () => {
  it("n = 6 is the smallest n that reaches 95% (the min and the max)", () => {
    expect(medianCI([3.1, 1.2, 5.5, 2.2, 4.8, 0.9])).toEqual({ low: 0.9, high: 5.5, rank: 1 });
  });

  it("n = 7, unsorted input", () => {
    expect(medianCI([12, 15, 9, 20, 11, 14, 13])).toEqual({ low: 9, high: 20, rank: 1 });
  });

  it("n = 30 (a real-looking sample)", () => {
    const xs = [47.44, 55.11, 47.74, 46.85, 40.7, 47.87, 61.12, 54.24, 60.37, 52.49, 53.95, 51.85, 33.34, 58.55,
      55.06, 54.99, 33.09, 32.56, 41.1, 45.32, 53.05, 49.54, 55.21, 43.58, 53.09, 53.94, 43.39, 67.18, 55.57, 61.97];
    expect(medianCI(xs)).toEqual({ low: 47.44, high: 54.99, rank: 10 });
  });

  it.each([
    [20, 6],
    [100, 40],
    [1500, 712],
    [5000, 2431], // 0.5^5000 underflows a double: the tail must be summed in log space
  ])("n = %i → the %ith smallest and largest values", (n, k) => {
    expect(medianCI(ranks(n))).toEqual({ low: k, high: n - k + 1, rank: k });
  });

  it("below n = 6 no 95% interval exists — undefined, never a made-up one", () => {
    expect(medianCI([1, 2, 3, 4, 5])).toBeUndefined();
    expect(medianCI([])).toBeUndefined();
  });

  it("blanks and non-numbers are dropped before counting", () => {
    expect(medianCI([12, NaN, 15, 9, 20, Infinity, 11, 14, 13])).toEqual({ low: 9, high: 20, rank: 1 });
    expect(medianCI([1, 2, 3, NaN, 4, 5, NaN])).toBeUndefined();
  });
});
