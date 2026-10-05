import { describe, expect, it } from "vitest";
import { correlationMatrix } from "./correlation";

/** Independent Pearson via the raw-sums formula (a DIFFERENT algebra than the centered
 *  form in the impl) — the cross-check oracle. */
function pearsonSums(a: number[], b: number[]): number {
  const n = a.length;
  let sx = 0, sy = 0, sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sx += a[i]!; sy += b[i]!; sxy += a[i]! * b[i]!; sxx += a[i]! * a[i]!; syy += b[i]! * b[i]!;
  }
  return (n * sxy - sx * sy) / Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
}

describe("correlationMatrix", () => {
  it("perfect positive / negative correlations are ±1", () => {
    const m = correlationMatrix([
      [1, 2, 3, 4],
      [2, 4, 6, 8], // = 2·x  → +1
      [8, 6, 4, 2], // = −2·x + 10 → −1
    ]);
    expect(m[0]![1]!).toBeCloseTo(1, 12);
    expect(m[0]![2]!).toBeCloseTo(-1, 12);
    expect(m[1]![2]!).toBeCloseTo(-1, 12);
  });

  it("diagonal is 1 for varying columns, symmetric off-diagonal", () => {
    const m = correlationMatrix([
      [1, 2, 3, 4, 5],
      [2, 1, 4, 3, 6],
    ]);
    expect(m[0]![0]).toBe(1);
    expect(m[1]![1]).toBe(1);
    expect(m[0]![1]).toBe(m[1]![0]); // symmetric
  });

  it("matches an independent raw-sums Pearson on a hand dataset", () => {
    const x = [1, 2, 3, 4, 5];
    const y = [2, 1, 4, 3, 6];
    const m = correlationMatrix([x, y]);
    expect(m[0]![1]!).toBeCloseTo(pearsonSums(x, y), 12);
    expect(m[0]![1]!).toBeCloseTo(0.821995, 5); // hand-computed value
  });

  it("Spearman captures a monotonic non-linear relation Pearson misses", () => {
    const x = [1, 2, 3, 4];
    const y = [1, 4, 9, 16]; // y = x² — perfectly monotonic, not linear
    const pear = correlationMatrix([x, y], "pearson")[0]![1]!;
    expect(correlationMatrix([x, y], "spearman")[0]![1]!).toBeCloseTo(1, 12); // rank-perfect
    expect(pear).toBeCloseTo(pearsonSums(x, y), 12); // matches the independent oracle
    expect(pear).toBeGreaterThan(0.98); // ...but strictly below the Spearman 1
    expect(pear).toBeLessThan(1);
  });

  it("Spearman averages tied ranks (fractional ranks)", () => {
    // x has a tie at value 1 (ranks 1.5,1.5); y strictly increasing.
    const x = [1, 1, 2, 3];
    const y = [10, 20, 30, 40];
    // Spearman r = Pearson of ranks: xR=[1.5,1.5,3,4], yR=[1,2,3,4]
    const expected = pearsonSums([1.5, 1.5, 3, 4], [1, 2, 3, 4]);
    expect(correlationMatrix([x, y], "spearman")[0]![1]!).toBeCloseTo(expected, 12);
  });

  it("is complete-case per pair (ignores rows where either column is missing)", () => {
    // Row 2 has a null in column A → dropped for the (A,B) pair; the remaining
    // rows are perfectly correlated.
    const a = [1, 2, null, 4, 5];
    const b = [2, 4, 99, 8, 10];
    expect(correlationMatrix([a, b])[0]![1]!).toBeCloseTo(1, 12);
  });

  it("null when a pair shares fewer than minPairs finite points, or a column is constant", () => {
    // Only 2 shared finite points (< default minPairs 3) → null.
    const short = correlationMatrix([
      [1, 2, null, null],
      [3, 5, 7, 9],
    ]);
    expect(short[0]![1]).toBeNull();
    // A constant column → undefined correlation → null (and its diagonal is null too).
    const constCol = correlationMatrix([
      [5, 5, 5, 5],
      [1, 2, 3, 4],
    ]);
    expect(constCol[0]![1]).toBeNull();
    expect(constCol[0]![0]).toBeNull(); // constant column: no self-correlation
    expect(constCol[1]![1]).toBe(1);
  });

  it("clamps to [-1, 1] and honours a custom minPairs", () => {
    const m2 = correlationMatrix([[1, 2], [2, 4]], "pearson", 2); // allow 2-point pairs
    expect(m2[0]![1]!).toBeCloseTo(1, 12);
    expect(m2[0]![1]!).toBeLessThanOrEqual(1);
  });
});
