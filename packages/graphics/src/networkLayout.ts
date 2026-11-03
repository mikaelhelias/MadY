/**
 * Node-link network layout (kind "network") — a self-contained, deterministic
 * graph layout for a general force-directed network graph.
 *
 * Input is an edge list (source, target, optional weight, optional per-node value);
 * nodes are derived from the unique endpoints. Two layouts are offered:
 *
 *  - **force**: a classic Fruchterman-Reingold spring embedding — every pair of
 *    nodes repels (∝ k²/d) and every edge attracts (∝ d²/k), annealed over a fixed
 *    iteration budget in a unit box. Edge weight strengthens the attraction.
 *  - **circular**: nodes placed evenly on a circle (cheap, always stable).
 *
 * Everything is pure and deterministic — a seeded PRNG (mulberry32, seeded from a
 * hash of the node ids) drives the initial placement, so the same graph lays out
 * identically across rebuilds and is unit-testable. Positions are returned in a
 * [0,1]×[0,1] box; the scene builder maps them into the plot rect.
 *
 * O(n²) per iteration — fine for the modest n a readable network draws; the builder
 * caps the node count and iteration budget.
 */

/** One resolved graph node (endpoints deduped, degree + optional value attached). */
export interface NetNode {
  /** Unique node id (the source/target cell text). */
  id: string;
  /** Display label (defaults to the id). */
  label: string;
  /** Number of incident edges. */
  degree: number;
  /** Optional per-node value (from the node-value column at first appearance);
   *  undefined = no value → neutral colour. */
  value: number | undefined;
  /** Optional per-node group (from the bound group column, same first-lead rule);
   *  undefined = no group → neutral colour when grouping is on. */
  group?: string | undefined;
  /** Optional per-node size metric (from the bound size column, same first-lead rule);
   *  undefined = no metric → the size-range floor when metric sizing is on. */
  metric?: number | undefined;
}

/** One resolved graph edge. */
export interface NetEdge {
  source: string;
  target: string;
  /** Edge weight magnitude — |cell| (defaults to 1 when no weight column / non-finite /
   *  zero, so widths and layout attraction stay positive). */
  weight: number;
  /** The weight cell's sign (+1 / −1; 0 = no usable weight). A correlation edge list
   *  carries signed rho — the magnitude drives width, the sign drives colour. */
  sign: -1 | 0 | 1;
}

/** A parsed graph: deduped nodes (first-appearance order) + edges. */
export interface Graph {
  nodes: NetNode[];
  edges: NetEdge[];
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

/** A stable 32-bit hash of a string (FNV-1a) — seeds the layout from the node ids
 *  so the same graph always starts from the same configuration. */
function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Build a graph from parallel source/target arrays (+ optional weight/value/group/metric).
 * Nodes are deduped in first-appearance order; a node's value / group / size metric is
 * taken from the first row where it appears as the source that carries a usable cell.
 * Self-loops (source === target) and rows with an empty endpoint are skipped.
 */
export function buildGraph(
  sources: ReadonlyArray<string>,
  targets: ReadonlyArray<string>,
  weights?: ReadonlyArray<number | undefined>,
  values?: ReadonlyArray<number | undefined>,
  groups?: ReadonlyArray<string | undefined>,
  metrics?: ReadonlyArray<number | undefined>,
): Graph {
  const nodeMap = new Map<string, NetNode>();
  const order: string[] = [];
  const ensure = (id: string, value: number | undefined, group: string | undefined, metric: number | undefined): NetNode => {
    let nd = nodeMap.get(id);
    if (!nd) {
      nd = { id, label: id, degree: 0, value: undefined };
      nodeMap.set(id, nd);
      order.push(id);
    }
    if (nd.value === undefined && value !== undefined && Number.isFinite(value)) nd.value = value;
    if (nd.group === undefined && group !== undefined && group.trim() !== "") nd.group = group.trim();
    if (nd.metric === undefined && metric !== undefined && Number.isFinite(metric)) nd.metric = metric;
    return nd;
  };
  const edges: NetEdge[] = [];
  const n = Math.min(sources.length, targets.length);
  for (let i = 0; i < n; i++) {
    const s = (sources[i] ?? "").trim();
    const t = (targets[i] ?? "").trim();
    if (!s || !t || s === t) continue;
    // Per-node attributes apply to the source node (a node's attributes travel with
    // its first appearance); a target-only node still picks them up when it later leads a row.
    const sn = ensure(s, values?.[i], groups?.[i], metrics?.[i]);
    const tn = ensure(t, undefined, undefined, undefined);
    const w = weights?.[i];
    // A signed weight (correlation rho) keeps its sign for colouring; the magnitude is
    // the drawn/attraction weight, floored to 1 when missing or zero so it stays positive.
    const usable = w !== undefined && Number.isFinite(w) && w !== 0;
    edges.push({
      source: s,
      target: t,
      weight: usable ? Math.abs(w) : 1,
      sign: usable ? (w > 0 ? 1 : -1) : 0,
    });
    sn.degree++;
    tn.degree++;
  }
  return { nodes: order.map((id) => nodeMap.get(id)!), edges };
}

export interface Pt {
  x: number;
  y: number;
}

/** Nodes placed evenly on a circle (radius 0.42 of the unit box), first-appearance
 *  order clockwise from the top. Deterministic, no simulation. */
export function circularLayout(nodes: ReadonlyArray<NetNode>): Pt[] {
  const n = nodes.length;
  if (n === 0) return [];
  if (n === 1) return [{ x: 0.5, y: 0.5 }];
  return nodes.map((_nd, i) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
    return { x: 0.5 + 0.42 * Math.cos(a), y: 0.5 + 0.42 * Math.sin(a) };
  });
}

/**
 * Fruchterman-Reingold force-directed layout in a [0,1]×[0,1] box. Repulsion
 * between every pair (k²/d), attraction along edges (d²/k · weight), annealed with
 * a linearly-cooling temperature. Deterministic: initial placement is a seeded
 * jittered circle. Returns one position per node (index-aligned with `nodes`).
 */
export function forceLayout(
  nodes: ReadonlyArray<NetNode>,
  edges: ReadonlyArray<NetEdge>,
  opts: { iterations?: number; seed?: number } = {},
): Pt[] {
  const n = nodes.length;
  if (n === 0) return [];
  if (n === 1) return [{ x: 0.5, y: 0.5 }];
  const iterations = opts.iterations ?? Math.min(400, 120 + n * 4);
  const seed = opts.seed ?? hashString(nodes.map((nd) => nd.id).join(""));
  const rng = mulberry32(seed);
  // Ideal edge length in the unit box (k = sqrt(area / n)).
  const k = Math.sqrt(1 / n);
  const idx = new Map(nodes.map((nd, i) => [nd.id, i]));
  // Initial placement: a jittered circle so nothing is coincident (repulsion → ∞).
  const pos: Pt[] = nodes.map((_nd, i) => {
    const a = (2 * Math.PI * i) / n;
    return {
      x: 0.5 + 0.3 * Math.cos(a) + (rng() - 0.5) * 0.02,
      y: 0.5 + 0.3 * Math.sin(a) + (rng() - 0.5) * 0.02,
    };
  });
  let temp = 0.1;
  const cool = temp / (iterations + 1);
  const disp: Pt[] = pos.map(() => ({ x: 0, y: 0 }));
  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < n; i++) {
      disp[i]!.x = 0;
      disp[i]!.y = 0;
    }
    // Repulsion (all pairs).
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = pos[i]!.x - pos[j]!.x;
        let dy = pos[i]!.y - pos[j]!.y;
        let dist = Math.hypot(dx, dy);
        if (dist < 1e-4) {
          // Coincident → nudge apart deterministically.
          dx = (rng() - 0.5) * 1e-3;
          dy = (rng() - 0.5) * 1e-3;
          dist = Math.hypot(dx, dy) || 1e-4;
        }
        const rep = (k * k) / dist;
        const ux = dx / dist;
        const uy = dy / dist;
        disp[i]!.x += ux * rep;
        disp[i]!.y += uy * rep;
        disp[j]!.x -= ux * rep;
        disp[j]!.y -= uy * rep;
      }
    }
    // Attraction (edges) — heavier edges pull harder (clamped so one giant weight
    // can't collapse the graph).
    for (const e of edges) {
      const i = idx.get(e.source);
      const j = idx.get(e.target);
      if (i === undefined || j === undefined) continue;
      const dx = pos[i]!.x - pos[j]!.x;
      const dy = pos[i]!.y - pos[j]!.y;
      const dist = Math.hypot(dx, dy) || 1e-4;
      const att = ((dist * dist) / k) * Math.min(3, e.weight);
      const ux = dx / dist;
      const uy = dy / dist;
      disp[i]!.x -= ux * att;
      disp[i]!.y -= uy * att;
      disp[j]!.x += ux * att;
      disp[j]!.y += uy * att;
    }
    // Apply, capped by the temperature, and keep inside the box.
    for (let i = 0; i < n; i++) {
      const d = Math.hypot(disp[i]!.x, disp[i]!.y) || 1e-4;
      const lim = Math.min(d, temp);
      pos[i]!.x = Math.max(0, Math.min(1, pos[i]!.x + (disp[i]!.x / d) * lim));
      pos[i]!.y = Math.max(0, Math.min(1, pos[i]!.y + (disp[i]!.y / d) * lim));
    }
    temp = Math.max(cool, temp - cool);
  }
  return pos;
}

/**
 * Layered (Sugiyama-style) layout: rank each node into an ordered left→right layer,
 * then order the nodes within each layer to reduce edge crossings. Suits the
 * multi-column node-link form (gene → gene-score → concept → …).
 *
 * Layers come from a **longest-path** ranking: a node's layer is one past the
 * deepest source that reaches it. The ranking is a fixed-point relaxation over the
 * edges — exact for a DAG (≤ longest-path passes), and cycle-safe (capped at n
 * passes, layers clamped) so a graph with a back-edge still lays out sensibly.
 *
 * Within-layer order is refined by a few **barycentre** sweeps (each node drifts
 * toward the mean position of its neighbours, then the layer is re-sorted) — the
 * classic crossing-reduction heuristic. Positions are returned in the unit box:
 * x = layer / maxLayer, y = evenly spaced by the node's order in its layer.
 */
export function layeredLayout(nodes: ReadonlyArray<NetNode>, edges: ReadonlyArray<NetEdge>): Pt[] {
  const n = nodes.length;
  if (n === 0) return [];
  if (n === 1) return [{ x: 0.5, y: 0.5 }];
  const idx = new Map(nodes.map((nd, i) => [nd.id, i]));

  // Longest-path layering via edge relaxation (cycle-safe: capped + clamped).
  const layer = new Array<number>(n).fill(0);
  for (let pass = 0; pass < n; pass++) {
    let changed = false;
    for (const e of edges) {
      const u = idx.get(e.source);
      const v = idx.get(e.target);
      if (u === undefined || v === undefined) continue;
      if (layer[v]! < layer[u]! + 1) {
        layer[v] = layer[u]! + 1;
        changed = true;
      }
    }
    if (!changed) break;
  }
  for (let i = 0; i < n; i++) layer[i] = Math.min(layer[i]!, n - 1);
  const maxLayer = Math.max(...layer);

  // Bucket node indices by layer (first-appearance order within each layer).
  const layers: number[][] = Array.from({ length: maxLayer + 1 }, () => []);
  for (let i = 0; i < n; i++) layers[layer[i]!]!.push(i);

  // Undirected neighbour lists for the barycentre ordering.
  const nbr: number[][] = nodes.map(() => []);
  for (const e of edges) {
    const u = idx.get(e.source);
    const v = idx.get(e.target);
    if (u === undefined || v === undefined || u === v) continue;
    nbr[u]!.push(v);
    nbr[v]!.push(u);
  }
  const yOf = new Array<number>(n).fill(0.5);
  const recomputeY = (): void => {
    for (const L of layers) L.forEach((ni, k) => (yOf[ni] = L.length > 1 ? k / (L.length - 1) : 0.5));
  };
  recomputeY();
  // A few barycentre sweeps — sort each layer by the mean y of its neighbours.
  for (let it = 0; it < 6; it++) {
    for (const L of layers) {
      if (L.length < 2) continue;
      const bary = new Map<number, number>();
      for (const ni of L) {
        const ns = nbr[ni]!;
        bary.set(ni, ns.length ? ns.reduce((a, b) => a + yOf[b]!, 0) / ns.length : yOf[ni]!);
      }
      L.sort((a, b) => bary.get(a)! - bary.get(b)!);
    }
    recomputeY();
  }

  const pos: Pt[] = new Array(n);
  for (const L of layers) {
    L.forEach((ni, k) => {
      pos[ni] = {
        x: maxLayer > 0 ? layer[ni]! / maxLayer : 0.5,
        y: L.length > 1 ? k / (L.length - 1) : 0.5,
      };
    });
  }
  return pos;
}

/** Rescale a set of unit-box points to tightly fill [0,1]×[0,1] (preserving aspect
 *  is the caller's job when mapping to the plot rect). Guards a degenerate (zero-
 *  span) axis by centring it. */
export function normalizePositions(pos: ReadonlyArray<Pt>): Pt[] {
  if (pos.length === 0) return [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pos) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  return pos.map((p) => ({
    x: spanX > 1e-9 ? (p.x - minX) / spanX : 0.5,
    y: spanY > 1e-9 ? (p.y - minY) / spanY : 0.5,
  }));
}
