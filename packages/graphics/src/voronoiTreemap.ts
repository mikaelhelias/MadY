/**
 * Voronoi treemap geometry — a weighted, area-proportional tessellation of an
 * arbitrary convex boundary (kind "treemap").
 *
 * Each input weight is mapped to a cell whose area is proportional to that
 * weight; the cells tile the boundary with no gaps or overlaps: one convex cell
 * per datum, sized by value, coloured by group.
 *
 * The algorithm is a self-contained implementation of the classic approach
 * (Balzer & Deussen 2005, "Voronoi Treemaps"): iterate a **power diagram**
 * (additively-weighted Voronoi) of moving sites — Lloyd relaxation moves each
 * site to its cell centroid, and a per-site weight is nudged so each cell's area
 * converges toward its target. No external dependency: the power cell of a site
 * is the boundary polygon clipped by the power-bisector half-plane against every
 * other site (O(n²) per iteration — fine for the small n a treemap draws).
 *
 * All geometry is pure and deterministic (seeded PRNG for the initial site
 * placement), so the layout is stable across rebuilds and unit-testable.
 */

export interface Pt {
  x: number;
  y: number;
}

/** A simple polygon as an ordered vertex ring (winding-agnostic; area uses abs). */
export type Polygon = Pt[];

export interface TreemapCell {
  /** Index into the input `weights` array (result order matches input order). */
  index: number;
  /** The cell's convex polygon (pixel space). Empty ring if the site was starved. */
  polygon: Polygon;
  /** Cell area (px²). */
  area: number;
  /** The generating site (also a good label anchor — near the visual centre). */
  site: Pt;
}

export interface VoronoiTreemapOptions {
  /** PRNG seed for the initial site scatter (deterministic layout). Default 20260709. */
  seed?: number;
  /** Max relaxation iterations. Default 160. */
  maxIterations?: number;
  /** Stop early when the worst relative area error drops below this. Default 0.01 (1%). */
  convergence?: number;
}

const EPS = 1e-9;

/** Absolute area of a simple polygon (shoelace). */
export function polygonArea(poly: Polygon): number {
  const n = poly.length;
  if (n < 3) return 0;
  let a = 0;
  for (let i = 0; i < n; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % n]!;
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

/** Area-weighted centroid of a simple polygon; falls back to the vertex mean for
 *  a degenerate (near-zero-area) ring. */
export function polygonCentroid(poly: Polygon): Pt {
  const n = poly.length;
  if (n === 0) return { x: 0, y: 0 };
  if (n < 3) {
    let sx = 0;
    let sy = 0;
    for (const p of poly) {
      sx += p.x;
      sy += p.y;
    }
    return { x: sx / n, y: sy / n };
  }
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % n]!;
    const cross = p.x * q.y - q.x * p.y;
    a += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  if (Math.abs(a) < EPS) {
    let sx = 0;
    let sy = 0;
    for (const p of poly) {
      sx += p.x;
      sy += p.y;
    }
    return { x: sx / n, y: sy / n };
  }
  a /= 2;
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

/** Clip a convex polygon by the half-plane { (x,y) : a·x + b·y ≤ c } (Sutherland-
 *  Hodgman against a single edge). Keeps the sub-polygon on the ≤ side. */
export function clipHalfPlane(poly: Polygon, a: number, b: number, c: number): Polygon {
  const n = poly.length;
  if (n === 0) return [];
  const out: Pt[] = [];
  const dist = (p: Pt): number => a * p.x + b * p.y - c;
  for (let i = 0; i < n; i++) {
    const cur = poly[i]!;
    const prev = poly[(i + n - 1) % n]!;
    const dCur = dist(cur);
    const dPrev = dist(prev);
    const curIn = dCur <= EPS;
    const prevIn = dPrev <= EPS;
    if (curIn) {
      if (!prevIn) {
        const t = dPrev / (dPrev - dCur);
        out.push({ x: prev.x + t * (cur.x - prev.x), y: prev.y + t * (cur.y - prev.y) });
      }
      out.push(cur);
    } else if (prevIn) {
      const t = dPrev / (dPrev - dCur);
      out.push({ x: prev.x + t * (cur.x - prev.x), y: prev.y + t * (cur.y - prev.y) });
    }
  }
  return out;
}

/** The power cell of site i: the boundary clipped by the power-bisector against
 *  every other site. For sites pᵢ with weights wᵢ, cellᵢ keeps x where
 *  |x−pᵢ|²−wᵢ ≤ |x−pⱼ|²−wⱼ, i.e. 2(pⱼ−pᵢ)·x ≤ (|pⱼ|²−wⱼ) − (|pᵢ|²−wᵢ). */
export function powerCell(i: number, sites: Pt[], weights: number[], boundary: Polygon): Polygon {
  let cell = boundary;
  const pi = sites[i]!;
  const wi = weights[i]!;
  const ni = pi.x * pi.x + pi.y * pi.y - wi;
  for (let j = 0; j < sites.length; j++) {
    if (j === i) continue;
    const pj = sites[j]!;
    const wj = weights[j]!;
    const a = 2 * (pj.x - pi.x);
    const b = 2 * (pj.y - pi.y);
    const c = pj.x * pj.x + pj.y * pj.y - wj - ni;
    cell = clipHalfPlane(cell, a, b, c);
    if (cell.length === 0) break;
  }
  return cell;
}

/** Axis-aligned bounds of a polygon. */
function boundsOf(poly: Polygon): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/** Even-odd point-in-polygon test. */
function pointInPolygon(p: Pt, poly: Polygon): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const pi = poly[i]!;
    const pj = poly[j]!;
    if (pi.y > p.y !== pj.y > p.y && p.x < ((pj.x - pi.x) * (p.y - pi.y)) / (pj.y - pi.y) + pi.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** Deterministic PRNG (mulberry32) in [0,1). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A convex polygon approximating an ellipse (or circle when rx===ry). */
export function ellipsePolygon(cx: number, cy: number, rx: number, ry: number, segments = 128): Polygon {
  const pts: Pt[] = [];
  for (let i = 0; i < segments; i++) {
    const t = (i / segments) * 2 * Math.PI;
    pts.push({ x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) });
  }
  return pts;
}

/** An axis-aligned rectangle polygon. */
export function rectPolygon(x: number, y: number, w: number, h: number): Polygon {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
}

/**
 * Compute a Voronoi treemap: one cell per weight, cell area ∝ weight, tiling
 * `boundary` (which must be convex — an ellipse/rect polygon). Results are in
 * input order. Zero/negative weights are treated as absent (empty cell).
 */
export function voronoiTreemap(weights: number[], boundary: Polygon, opts: VoronoiTreemapOptions = {}): TreemapCell[] {
  const nAll = weights.length;
  const boundaryArea = polygonArea(boundary);
  const empty = (i: number): TreemapCell => ({ index: i, polygon: [], area: 0, site: { x: 0, y: 0 } });
  if (nAll === 0 || boundaryArea < EPS) return weights.map((_, i) => empty(i));

  // Only rows with a positive weight get a cell; run the solver over that compact
  // active set so inactive sites never carve gaps, then scatter cells back to the
  // original index positions.
  const active: number[] = [];
  weights.forEach((w, i) => {
    if (Number.isFinite(w) && w > 0) active.push(i);
  });
  const totalW = active.reduce((a, i) => a + weights[i]!, 0);
  if (active.length === 0 || totalW < EPS) return weights.map((_, i) => empty(i));

  const centre = polygonCentroid(boundary);
  const result: TreemapCell[] = weights.map((_, i) => empty(i));
  if (active.length === 1) {
    const only = active[0]!;
    result[only] = { index: only, polygon: boundary.map((p) => ({ ...p })), area: boundaryArea, site: centre };
    return result;
  }

  const n = active.length;
  const seed = opts.seed ?? 20260709;
  const maxIter = opts.maxIterations ?? 160;
  const convergence = opts.convergence ?? 0.01;
  const rand = mulberry32(seed);
  const bbox = boundsOf(boundary);
  const target = active.map((i) => (weights[i]! / totalW) * boundaryArea);

  // Initial sites: rejection-sample inside the boundary (fall back to the centre).
  const sites: Pt[] = [];
  for (let k = 0; k < n; k++) {
    let placed: Pt | null = null;
    for (let tries = 0; tries < 200 && !placed; tries++) {
      const cand = {
        x: bbox.minX + rand() * (bbox.maxX - bbox.minX),
        y: bbox.minY + rand() * (bbox.maxY - bbox.minY),
      };
      if (pointInPolygon(cand, boundary)) placed = cand;
    }
    sites.push(placed ?? { x: centre.x, y: centre.y });
  }

  // Initial weights: equal (≈ an ordinary Voronoi diagram) sized to the mean cell.
  const meanR2 = boundaryArea / (n * Math.PI);
  const w = sites.map(() => meanR2);

  let best: Polygon[] | null = null;
  let bestErr = Infinity;

  for (let iter = 0; iter < maxIter; iter++) {
    const cells = sites.map((_, k) => powerCell(k, sites, w, boundary));
    const areas = cells.map(polygonArea);

    // Worst relative area error over the cells.
    let err = 0;
    for (let k = 0; k < n; k++) err = Math.max(err, Math.abs(areas[k]! - target[k]!) / target[k]!);
    if (err < bestErr) {
      bestErr = err;
      best = cells.map((c) => c.map((p) => ({ ...p })));
    }
    if (err < convergence) break;

    // Recover starved (empty) sites: reseed them into the currently-largest cell,
    // which is over target and has room to give.
    for (let k = 0; k < n; k++) {
      if (areas[k]! <= EPS) {
        let big = -1;
        let bigArea = -Infinity;
        for (let j = 0; j < n; j++) {
          if (areas[j]! > bigArea) {
            bigArea = areas[j]!;
            big = j;
          }
        }
        if (big >= 0) {
          const c = polygonCentroid(cells[big]!);
          // Nudge slightly off the host centroid so the two sites separate.
          sites[k] = { x: c.x + (rand() - 0.5) * 1e-3, y: c.y + (rand() - 0.5) * 1e-3 };
          w[k] = meanR2;
        }
      }
    }

    if (iter === maxIter - 1) break;

    // Lloyd relaxation: move each site to its cell centroid (always inside, since
    // boundary is convex ⇒ every cell is convex).
    for (let k = 0; k < n; k++) if (areas[k]! > EPS) sites[k] = polygonCentroid(cells[k]!);

    // Balzer weight adaptation: nudge each cell's effective radius toward target.
    for (let k = 0; k < n; k++) {
      const curR = Math.sqrt(Math.max(areas[k]!, EPS) / Math.PI);
      const tgtR = Math.sqrt(target[k]! / Math.PI);
      const sq = Math.sqrt(Math.max(w[k]!, 0)) + (tgtR - curR);
      w[k] = sq * sq;
    }

    // Clamp weights so no site's power circle swallows a neighbour: √wₖ < nnDistₖ.
    // Power diagrams are invariant to a global weight shift, so re-baseline to keep
    // the numbers well-conditioned.
    for (let k = 0; k < n; k++) {
      let nn = Infinity;
      for (let j = 0; j < n; j++) {
        if (j === k) continue;
        nn = Math.min(nn, Math.hypot(sites[k]!.x - sites[j]!.x, sites[k]!.y - sites[j]!.y));
      }
      if (Number.isFinite(nn)) {
        const cap = 0.95 * nn * (0.95 * nn);
        if (w[k]! > cap) w[k] = cap;
      }
    }
    let minW = Infinity;
    for (let k = 0; k < n; k++) minW = Math.min(minW, w[k]!);
    if (Number.isFinite(minW)) for (let k = 0; k < n; k++) w[k] = w[k]! - minW;
  }

  const finalCells = best ?? sites.map((_, k) => powerCell(k, sites, w, boundary));
  active.forEach((orig, k) => {
    const poly = finalCells[k]!;
    result[orig] = {
      index: orig,
      polygon: poly,
      area: polygonArea(poly),
      site: poly.length >= 3 ? polygonCentroid(poly) : { x: 0, y: 0 },
    };
  });
  return result;
}
