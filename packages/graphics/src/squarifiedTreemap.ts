/**
 * Squarified rectangular treemap (Bruls, Huizing & van Wijk 2000) — the classic
 * non-Voronoi treemap: subdivide a rectangle into sub-rectangles whose AREA is
 * proportional to each value, laid out to keep aspect ratios as close to square
 * as possible (the disk-usage / market-map look). Deterministic, no iteration.
 *
 * `squarifyLayout` is the primitive: it tiles one rectangle and returns rects in
 * INPUT order (a 0-size rect for non-positive weights). `buildTreemapScene` calls
 * it once for a flat treemap, or twice for a grouped (hierarchical) one — groups
 * into the plot rect, then each group's cells inside its rectangle.
 */

import type { TreemapCell, Polygon } from "./voronoiTreemap.js";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The worst (largest) aspect ratio in a row of areas laid along a side of the
 *  given length — the squarify quality metric (lower is squarer). */
function worstRatio(areas: number[], side: number): number {
  let s = 0;
  let mx = -Infinity;
  let mn = Infinity;
  for (const a of areas) {
    s += a;
    if (a > mx) mx = a;
    if (a < mn) mn = a;
  }
  if (s <= 0 || side <= 0) return Infinity;
  const s2 = s * s;
  const side2 = side * side;
  return Math.max((side2 * mx) / s2, s2 / (side2 * mn));
}

/** Convert a rectangle to a closed 4-vertex polygon (CW in screen space). */
export function rectToPolygon(r: Rect): Polygon {
  return [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h },
    { x: r.x, y: r.y + r.h },
  ];
}

/**
 * Squarified layout of `values` into `rect`. Rects are returned in INPUT order
 * (a zero-size rect at the input position for a non-positive / non-finite value);
 * areas are proportional to value and the sub-rects exactly tile `rect`.
 */
export function squarifyLayout(values: number[], rect: Rect): Rect[] {
  const out: Rect[] = values.map(() => ({ x: rect.x, y: rect.y, w: 0, h: 0 }));
  const W = Math.max(0, rect.w);
  const H = Math.max(0, rect.h);
  const rectArea = W * H;
  const active = values.map((v, i) => ({ v: Number.isFinite(v) && v > 0 ? v : 0, i })).filter((a) => a.v > 0);
  const total = active.reduce((s, a) => s + a.v, 0);
  if (active.length === 0 || total <= 0 || rectArea <= 0) return out;

  const scale = rectArea / total;
  const items = active.map((a) => ({ area: a.v * scale, i: a.i })).sort((p, q) => q.area - p.area);

  const free = { x: rect.x, y: rect.y, w: W, h: H };

  const layoutRow = (row: { area: number; i: number }[]): void => {
    const s = row.reduce((a, b) => a + b.area, 0);
    if (s <= 0) return;
    if (free.w <= free.h) {
      // Shorter side = width → a horizontal strip across the top; strip height = s / w.
      const stripH = Math.min(free.h, s / free.w);
      let x = free.x;
      for (const it of row) {
        const w = stripH > 0 ? it.area / stripH : 0;
        out[it.i] = { x, y: free.y, w, h: stripH };
        x += w;
      }
      free.y += stripH;
      free.h -= stripH;
    } else {
      // Shorter side = height → a vertical strip on the left; strip width = s / h.
      const stripW = Math.min(free.w, s / free.h);
      let y = free.y;
      for (const it of row) {
        const h = stripW > 0 ? it.area / stripW : 0;
        out[it.i] = { x: free.x, y, w: stripW, h };
        y += h;
      }
      free.x += stripW;
      free.w -= stripW;
    }
  };

  let row: { area: number; i: number }[] = [];
  let idx = 0;
  while (idx < items.length) {
    const side = Math.min(free.w, free.h);
    const it = items[idx]!;
    if (side <= 0) {
      // Numerically exhausted — dump the rest into the current row to avoid a hang.
      row.push(it);
      idx++;
      continue;
    }
    const rowAreas = row.map((r) => r.area);
    const without = row.length ? worstRatio(rowAreas, side) : Infinity;
    const withNew = worstRatio([...rowAreas, it.area], side);
    if (row.length === 0 || withNew <= without) {
      row.push(it);
      idx++;
    } else {
      layoutRow(row);
      row = [];
    }
  }
  if (row.length) layoutRow(row);
  return out;
}

/** Full squarified treemap as `TreemapCell[]` (rectangle polygons), input order. */
export function squarifiedTreemap(weights: number[], rect: Rect): TreemapCell[] {
  const rects = squarifyLayout(weights, rect);
  return rects.map((r, i) => {
    const ok = Number.isFinite(weights[i]!) && weights[i]! > 0 && r.w > 0 && r.h > 0;
    return {
      index: i,
      polygon: ok ? rectToPolygon(r) : [],
      area: ok ? r.w * r.h : 0,
      site: ok ? { x: r.x + r.w / 2, y: r.y + r.h / 2 } : { x: 0, y: 0 },
    };
  });
}
