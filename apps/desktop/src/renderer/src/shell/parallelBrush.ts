/**
 * The rectangle that shows a parallel-coordinates axis's brush, in pixels down the axis.
 *
 * The brush is stored in data units. Dragging on an axis never leaves it, but a range that was typed, set by a script,
 * or made before the data (and so the axis's range) changed can reach past an end — and the pixel an unclamped value
 * maps to can be thousands of pixels away. The rectangle is therefore cut to the axis, and a range wholly outside it
 * has none to draw. Which end is the top is decided from the two pixels, not from the order of the values, so a
 * reversed axis (its minimum at the top) draws as it should.
 */
export type BrushAxis = { yAtMin: number; yAtMax: number; min: number; max: number };

export function brushRectPx(ax: BrushAxis, brush: [number, number]): { top: number; bottom: number } | null {
  const px = (v: number): number => ax.yAtMin + ((v - ax.min) / (ax.max - ax.min || 1)) * (ax.yAtMax - ax.yAtMin);
  const axisTop = Math.min(ax.yAtMin, ax.yAtMax);
  const axisBottom = Math.max(ax.yAtMin, ax.yAtMax);
  const a = px(brush[0]);
  const b = px(brush[1]);
  const top = Math.max(axisTop, Math.min(a, b));
  const bottom = Math.min(axisBottom, Math.max(a, b));
  return bottom > top ? { top, bottom } : null;
}
