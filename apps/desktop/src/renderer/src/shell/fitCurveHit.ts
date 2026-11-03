/**
 * Picking a fitted curve by position. A fitted curve is drawn under the data, so a plain click on it lands on the data
 * line, the markers or a text block over it; Alt+click asks "which fitted curve is under the pointer?" instead.
 */

/** The points of a straight-segment path ("M x,y L x,y …"), in order. */
export function parseLinePath(d: string): [number, number][] {
  const nums = (d.match(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? []).map(Number);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) out.push([nums[i]!, nums[i + 1]!]);
  return out;
}

/** The shortest distance from a point to a polyline. */
export function distanceToPolyline(points: readonly [number, number][], p: readonly [number, number]): number {
  if (points.length === 0) return Infinity;
  if (points.length === 1) return Math.hypot(p[0] - points[0]![0], p[1] - points[0]![1]);
  let best = Infinity;
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1]!;
    const [bx, by] = points[i]!;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / len2));
    best = Math.min(best, Math.hypot(p[0] - (ax + t * dx), p[1] - (ay + t * dy)));
  }
  return best;
}

/** The curve nearest the point and within its own reach (`tolerance`), or null when none is that close. */
export function nearestFitCurve(
  curves: readonly { key: string; points: [number, number][]; tolerance: number }[],
  p: readonly [number, number],
): { key: string; distance: number } | null {
  let best: { key: string; distance: number } | null = null;
  for (const c of curves) {
    const distance = distanceToPolyline(c.points, p);
    if (distance <= c.tolerance && (!best || distance < best.distance)) best = { key: c.key, distance };
  }
  return best;
}
