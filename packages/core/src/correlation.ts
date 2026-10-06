/**
 * Pairwise correlation of numeric columns — the data behind the correlation-matrix
 * graph (kind "corrmatrix"). Pure + reactive (no engine round-trip), so the matrix
 * regenerates live when the table changes, and independently unit-tested. Pearson
 * (linear) or Spearman (rank / monotonic). Each pair is complete-case: only rows
 * where BOTH columns are finite contribute, so ragged missing data doesn't bias one
 * pair by another's gaps.
 */

export type CorrelationMethod = "pearson" | "spearman";

/** Fractional ranks (ties share the average rank) — the Spearman rank transform. */
function fractionalRanks(v: readonly number[]): number[] {
  const idx = v.map((_x, i) => i).sort((a, b) => v[a]! - v[b]!);
  const r = new Array<number>(v.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && v[idx[j + 1]!]! === v[idx[i]!]!) j++;
    const rank = (i + j) / 2 + 1; // 1-based average rank of this tie block
    for (let k = i; k <= j; k++) r[idx[k]!] = rank;
    i = j + 1;
  }
  return r;
}

/** Pearson r of two equal-length vectors; null if < 2 points or either is constant. */
function pearsonR(a: readonly number[], b: readonly number[]): number | null {
  const n = a.length;
  if (n < 2) return null;
  let sa = 0;
  let sb = 0;
  for (let i = 0; i < n; i++) {
    sa += a[i]!;
    sb += b[i]!;
  }
  const ma = sa / n;
  const mb = sb / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i]! - ma;
    const y = b[i]! - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  const den = Math.sqrt(da * db);
  if (!(den > 0)) return null; // a constant column → correlation is undefined
  return Math.max(-1, Math.min(1, num / den)); // clamp the tiny FP overshoot at ±1
}

/** True when the column has at least 2 finite values that are not all identical. */
function varies(col: ReadonlyArray<number | null | undefined>): boolean {
  let first: number | undefined;
  let seen = 0;
  let differs = false;
  for (const v of col) {
    if (Number.isFinite(v as number)) {
      seen++;
      if (first === undefined) first = v as number;
      else if (v !== first) differs = true;
    }
  }
  return seen >= 2 && differs;
}

/**
 * The N×N pairwise correlation matrix of the given columns (variables). Off-diagonal
 * pair (i,j) uses only rows where both columns are finite (complete-case); a pair with
 * fewer than `minPairs` shared points, or against a constant column, yields null.
 * Spearman ranks each column's shared values (fractional ranks for ties) before the
 * Pearson step. The diagonal is 1 for a varying column, null for an all-missing /
 * constant one. Always symmetric: out[i][j] === out[j][i].
 */
export function correlationMatrix(
  columns: ReadonlyArray<ReadonlyArray<number | null | undefined>>,
  method: CorrelationMethod = "pearson",
  minPairs = 3,
): (number | null)[][] {
  const n = columns.length;
  const out: (number | null)[][] = Array.from({ length: n }, () => new Array<number | null>(n).fill(null));
  for (let i = 0; i < n; i++) {
    out[i]![i] = varies(columns[i]!) ? 1 : null;
    for (let j = i + 1; j < n; j++) {
      const ci = columns[i]!;
      const cj = columns[j]!;
      const m = Math.min(ci.length, cj.length);
      const ai: number[] = [];
      const bj: number[] = [];
      for (let k = 0; k < m; k++) {
        const x = ci[k];
        const y = cj[k];
        if (Number.isFinite(x as number) && Number.isFinite(y as number)) {
          ai.push(x as number);
          bj.push(y as number);
        }
      }
      let r: number | null = null;
      if (ai.length >= minPairs) {
        r = method === "spearman" ? pearsonR(fractionalRanks(ai), fractionalRanks(bj)) : pearsonR(ai, bj);
      }
      out[i]![j] = r;
      out[j]![i] = r;
    }
  }
  return out;
}
