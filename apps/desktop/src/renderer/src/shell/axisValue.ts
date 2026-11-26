/**
 * Pixel ↔ axis value on a drawn figure — the one conversion the figure's drags use (value reference lines, brackets,
 * the zoom box) and the Inspector's "pin to a data value" seeding, so an annotation switched to a data anchor
 * starts from exactly where it sits.
 */

/** Axis type → scale-space transform (log axes pan/zoom in decade space). */
export const toS = (v: number, type: string): number =>
  type === "log10" ? Math.log10(v) : type === "log2" ? Math.log2(v) : type === "ln" ? Math.log(v) : v;
export const fromS = (s: number, type: string): number =>
  type === "log10" ? Math.pow(10, s) : type === "log2" ? Math.pow(2, s) : type === "ln" ? Math.exp(s) : s;

/**
 * The axis value at pixel `px` on a drawn axis.
 *
 * Read from the axis's own ticks (value + pixel), between the two nearest: an axis is not always drawn edge to edge
 * of the plot — a log axis sits inset (for example 0.01 at 99 px on a plot starting at 85) — so mapping the
 * domain onto the plot rectangle can misplace a pinned text by several pixels (5.6 px in that example). Ticks are where the builder really put the values,
 * and between two neighbours an axis is straight in scale space (linear or log), so this is exact and stays close
 * across an axis break. Fewer than two usable ticks → the plot-rectangle mapping (X ascends, Y descends).
 */
export function valueAtPx(
  axis: { domain: readonly [number, number] | number[]; type: string; ticks?: ReadonlyArray<{ value: number; pos: number }> | undefined },
  plot: { x: number; y: number; width: number; height: number },
  px: number,
  along: "x" | "y",
): number {
  const log = axis.type === "log10" || axis.type === "log2" || axis.type === "ln";
  const ts = (axis.ticks ?? [])
    .filter((t) => Number.isFinite(t.value) && Number.isFinite(t.pos) && (!log || t.value > 0))
    .slice()
    .sort((a, b) => a.pos - b.pos);
  const uniq = ts.filter((t, i) => i === 0 || Math.abs(t.pos - ts[i - 1]!.pos) > 1e-9);
  if (uniq.length >= 2) {
    let i = uniq.findIndex((t) => t.pos >= px) - 1;
    if (i < 0) i = px < uniq[0]!.pos ? 0 : uniq.length - 2;
    i = Math.min(i, uniq.length - 2);
    const a = uniq[i]!, b = uniq[i + 1]!;
    const sa = toS(a.value, axis.type), sb = toS(b.value, axis.type);
    return fromS(sa + ((px - a.pos) / (b.pos - a.pos)) * (sb - sa), axis.type);
  }
  const s0 = toS(axis.domain[0]!, axis.type);
  const s1 = toS(axis.domain[1]!, axis.type);
  return along === "x"
    ? fromS(s0 + ((px - plot.x) / plot.width) * (s1 - s0), axis.type)
    : fromS(s1 + ((px - plot.y) / plot.height) * (s0 - s1), axis.type);
}
