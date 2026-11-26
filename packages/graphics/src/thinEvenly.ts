import type { AxisTick } from "./scene.js";

/** Gap kept between two neighbouring labels (the same breathing room `deOverlapX` leaves). */
const PAD = 6;

/**
 * Thin crowded range labels ("8–12", "12–16") by a constant stride: the first label, then every
 * k-th one, for the smallest k at which no two kept labels touch. A greedy left-to-right rule that
 * drops only the label colliding with the previous kept one leaves an uneven run (three in a row,
 * then every other), which reads as labels lost by accident; numbers on an axis thin evenly.
 *
 * A blanked label keeps its text in `suppressedLabel` and its tick stays, as in `deOverlapX`. A label
 * an earlier pass blanked is considered again. Minor ticks pass through; the input is not modified.
 */
export function thinTicksEvenly(
  ticks: readonly AxisTick[],
  measure: (text: string, fontPx: number) => number,
  fontPx: number,
): AxisTick[] {
  const text = (t: AxisTick): string => (t.label !== "" ? t.label : (t.suppressedLabel ?? ""));
  const named = ticks.filter((t) => !t.minor && text(t) !== "").sort((a, b) => a.pos - b.pos);
  if (named.length < 2) return ticks.map((t) => ({ ...t }));
  const clears = (k: number): boolean => {
    for (let i = 0; i + k < named.length; i += k) {
      const a = named[i]!, b = named[i + k]!;
      if (b.pos - measure(text(b), fontPx) / 2 < a.pos + measure(text(a), fontPx) / 2 + PAD) return false;
    }
    return true;
  };
  let stride = 1;
  while (stride < named.length && !clears(stride)) stride += 1;
  const keep = new Set<AxisTick>(named.filter((_, i) => i % stride === 0));
  return ticks.map((t) => {
    if (t.minor || text(t) === "") return { ...t };
    if (keep.has(t)) {
      const { suppressedLabel: _s, ...rest } = t;
      return { ...rest, label: text(t) };
    }
    return { ...t, label: "", suppressedLabel: text(t) };
  });
}
