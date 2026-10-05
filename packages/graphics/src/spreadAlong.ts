/**
 * Slide labels apart along one line — by the least movement that stops them touching.
 *
 * For text written in a row along an axis, each piece centred on the thing it names: category-group names
 * down the right edge of a horizontal chart, or beneath a vertical one. A name longer than its group reaches
 * past the group's end and into its neighbour (e.g. "First group" and "Second group" on a 194 px tall plot).
 * A name the user typed must not be dropped or shortened; moving it a few pixels off centre is invisible.
 *
 * Order is kept. A label that already clears its neighbours does not move. Everything stays inside
 * `[lo, hi]`. Returns `null` when the labels are, together, longer than the line — nothing can be done by
 * moving, and the caller must report it rather than draw the overlap silently.
 */
export function spreadAlong(
  items: readonly { center: number; length: number }[],
  lo: number,
  hi: number,
  gap: number,
): number[] | null {
  const n = items.length;
  if (n === 0) return [];
  const need = items.reduce((s, it) => s + it.length, 0) + gap * (n - 1);
  if (need > hi - lo) return null;
  const order = items.map((_, i) => i).sort((a, b) => items[a]!.center - items[b]!.center);
  const c = order.map((i) => items[i]!.center);
  const len = order.map((i) => items[i]!.length);
  // Meet in the middle: each colliding pair shares the push, so neither name drifts further than it must.
  for (let pass = 0; pass < 4 * n; pass++) {
    let moved = false;
    for (let k = 1; k < n; k++) {
      const overlap = c[k - 1]! + len[k - 1]! / 2 + gap - (c[k]! - len[k]! / 2);
      if (overlap > 1e-9) {
        c[k - 1]! -= overlap / 2;
        c[k]! += overlap / 2;
        moved = true;
      }
    }
    if (!moved) break;
  }
  // Back onto the line: forward from the start, then backward from the end. `need` fits, so this settles.
  c[0] = Math.max(c[0]!, lo + len[0]! / 2);
  for (let k = 1; k < n; k++) c[k] = Math.max(c[k]!, c[k - 1]! + len[k - 1]! / 2 + gap + len[k]! / 2);
  c[n - 1] = Math.min(c[n - 1]!, hi - len[n - 1]! / 2);
  for (let k = n - 2; k >= 0; k--) c[k] = Math.min(c[k]!, c[k + 1]! - len[k + 1]! / 2 - gap - len[k]! / 2);
  const out = new Array<number>(n);
  order.forEach((i, k) => { out[i] = c[k]!; });
  return out;
}
