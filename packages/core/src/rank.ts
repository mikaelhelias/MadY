/**
 * Competition ranking of a row of values (the bump-chart transform). The largest value gets
 * rank 1 by default (`highestFirst`); ties SHARE the lower rank and the next distinct value
 * skips to its ordinal position (1, 1, 3 — "1224" style), the convention readers expect on a
 * rankings chart. Values are assumed finite (the caller filters non-finite points out first).
 */
export function rankValues(values: readonly number[], highestFirst = true): number[] {
  const order = values.map((_, i) => i).sort((a, b) => (highestFirst ? values[b]! - values[a]! : values[a]! - values[b]!));
  const ranks = new Array<number>(values.length).fill(0);
  let rank = 0;
  let prev: number | null = null;
  let seen = 0;
  for (const i of order) {
    seen += 1;
    const v = values[i]!;
    if (prev === null || v !== prev) {
      rank = seen; // a new distinct value takes its ordinal position → competition ranking
      prev = v;
    }
    ranks[i] = rank;
  }
  return ranks;
}
