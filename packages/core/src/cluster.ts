/**
 * Agglomerative hierarchical clustering — pure, DOM-free, sidecar-free. Powers the
 * dendrogram graph and the clustered heatmap (row/column reordering + attached trees).
 *
 * Bottom-up: every observation starts as its own cluster; the two closest clusters
 * merge repeatedly until one remains. Inter-cluster distances update by the
 * Lance-Williams recurrence, so single / complete / average / Ward all share one
 * simple loop (n² memory, ~n³ time — fine for the few hundred rows a heatmap holds).
 * Merge heights match `scipy.cluster.hierarchy.linkage` for all four linkages; the tests
 * check them against scipy's values and against hand-computed fixtures.
 */

/** Distance between two observation vectors. */
export type ClusterMetric = "euclidean" | "manhattan" | "correlation";
/** How the distance between two clusters is defined (the linkage). */
export type ClusterLinkage = "single" | "complete" | "average" | "ward";

/** One node of the merge tree. Leaves are ids 0…n-1 (an original observation);
 *  internal nodes are ids n…2n-2 (a merge), the last (2n-2) being the root. */
export interface DendroNode {
  id: number;
  /** Child node ids (null for a leaf). `left` holds the sub-tree with the smaller
   *  minimum leaf index, so the default leaf order reads left→right without crossings. */
  left: number | null;
  right: number | null;
  /** Merge distance (0 for a leaf). Non-decreasing from leaves to root for
   *  single/complete/average on any metric, and for ward — which [[hclust]]
   *  computes on Euclidean distance regardless of the requested metric, because
   *  Ward's Lance-Williams recurrence is only defined on Euclidean geometry. */
  height: number;
  /** Number of leaves under this node. */
  size: number;
}

export interface HClustResult {
  /** Number of leaves (observations). */
  n: number;
  /** All 2n-1 nodes, indexable by id. */
  nodes: DendroNode[];
  /** Leaf ids in dendrogram (left→right) order — a permutation of 0…n-1. */
  order: number[];
  /** Root node id (2n-2), or 0 when n = 1. */
  root: number;
}

/** Pearson correlation of two equal-length vectors (0 when either is constant). */
function pearson(a: readonly number[], b: readonly number[]): number {
  const n = a.length;
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
  return den > 0 ? num / den : 0;
}

/** Distance between two observation vectors under `metric` (NaN-tolerant: pairs with a
 *  non-finite component are skipped; euclidean/manhattan rescale to the used dimensions). */
export function vectorDistance(a: readonly number[], b: readonly number[], metric: ClusterMetric): number {
  if (metric === "correlation") {
    // Complete-case correlation over the finite pairs.
    const av: number[] = [];
    const bv: number[] = [];
    for (let i = 0; i < a.length; i++) {
      if (Number.isFinite(a[i]) && Number.isFinite(b[i])) {
        av.push(a[i]!);
        bv.push(b[i]!);
      }
    }
    if (av.length < 2) return 1;
    return 1 - pearson(av, bv);
  }
  let acc = 0;
  let used = 0;
  for (let i = 0; i < a.length; i++) {
    if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) continue;
    const d = a[i]! - b[i]!;
    acc += metric === "manhattan" ? Math.abs(d) : d * d;
    used++;
  }
  if (used === 0) return 0;
  // Rescale to the full dimensionality so partial-overlap pairs stay comparable.
  const scaled = (acc * a.length) / used;
  return metric === "manhattan" ? scaled : Math.sqrt(scaled);
}

/** Full n×n pairwise distance matrix (symmetric, zero diagonal). */
export function pairwiseDistances(data: readonly (readonly number[])[], metric: ClusterMetric): number[][] {
  const n = data.length;
  const D: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = vectorDistance(data[i]!, data[j]!, metric);
      D[i]![j] = d;
      D[j]![i] = d;
    }
  }
  return D;
}

/** Lance-Williams update: distance from the just-merged cluster {i∪j} to another
 *  cluster k, from the old distances d(i,k), d(j,k), d(i,j) and the cluster sizes. */
function lanceWilliams(
  linkage: ClusterLinkage,
  dik: number,
  djk: number,
  dij: number,
  si: number,
  sj: number,
  sk: number,
): number {
  switch (linkage) {
    case "single":
      return Math.min(dik, djk);
    case "complete":
      return Math.max(dik, djk);
    case "average":
      return (si * dik + sj * djk) / (si + sj);
    case "ward": {
      const t = si + sj + sk;
      return Math.sqrt(Math.max(0, ((si + sk) * dik * dik + (sj + sk) * djk * djk - sk * dij * dij) / t));
    }
  }
}

/**
 * Cluster `data` (each row an observation vector) into a merge tree. Returns the node
 * list, the root, and the crossing-free leaf order. n ≤ 1 yields a trivial tree.
 */
export function hclust(
  data: readonly (readonly number[])[],
  metric: ClusterMetric = "euclidean",
  linkage: ClusterLinkage = "average",
): HClustResult {
  const n = data.length;
  const nodes: DendroNode[] = [];
  for (let i = 0; i < n; i++) nodes.push({ id: i, left: null, right: null, height: 0, size: 1 });
  if (n <= 1) return { n, nodes, order: n === 1 ? [0] : [], root: 0 };

  // Ward's Lance-Williams recurrence is only valid on (squared-)Euclidean geometry;
  // feeding it Manhattan or 1−correlation distances yields a tree with no valid
  // interpretation. Force Euclidean for ward, exactly as the scipy analysis path does
  // (engine.py: `met = "euclidean" if linkage_m in ("ward",…)`). Callers that let the
  // user pick both must warn when they override the metric (see buildScene dendrogram/
  // heatmap) — this coercion keeps the maths sound; the warning keeps the user informed.
  const effMetric: ClusterMetric = linkage === "ward" ? "euclidean" : metric;
  const D = pairwiseDistances(data, effMetric);
  // Active clusters: `active[a]` true while cluster slot a survives; `nodeId[a]` is the
  // tree node it represents; `size[a]` its leaf count. Slots reuse the 0…n-1 indexing.
  const active = new Array<boolean>(n).fill(true);
  const nodeId = Array.from({ length: n }, (_v, i) => i);
  const size = new Array<number>(n).fill(1);
  let nextId = n;

  for (let step = 0; step < n - 1; step++) {
    // Closest surviving pair.
    let bi = -1;
    let bj = -1;
    let best = Infinity;
    for (let i = 0; i < n; i++) {
      if (!active[i]) continue;
      for (let j = i + 1; j < n; j++) {
        if (!active[j]) continue;
        if (D[i]![j]! < best) {
          best = D[i]![j]!;
          bi = i;
          bj = j;
        }
      }
    }
    const a = nodes[nodeId[bi]!]!;
    const b = nodes[nodeId[bj]!]!;
    // Order children so the sub-tree with the smaller min-leaf sits on the left.
    const minLeaf = (id: number): number => {
      let node = nodes[id]!;
      while (node.left !== null) node = nodes[node.left]!;
      return node.id;
    };
    const [leftId, rightId] = minLeaf(a.id) <= minLeaf(b.id) ? [a.id, b.id] : [b.id, a.id];
    const merged: DendroNode = { id: nextId++, left: leftId, right: rightId, height: best, size: a.size + b.size };
    nodes.push(merged);

    // Update distances from the merged cluster (kept in slot bi) to every other active k.
    for (let k = 0; k < n; k++) {
      if (!active[k] || k === bi || k === bj) continue;
      D[bi]![k] = D[k]![bi] = lanceWilliams(linkage, D[bi]![k]!, D[bj]![k]!, best, size[bi]!, size[bj]!, size[k]!);
    }
    size[bi] = a.size + b.size;
    nodeId[bi] = merged.id;
    active[bj] = false;
  }

  const root = nextId - 1;
  const order: number[] = [];
  const walk = (id: number): void => {
    const node = nodes[id]!;
    if (node.left === null) {
      order.push(node.id);
      return;
    }
    walk(node.left);
    walk(node.right!);
  };
  walk(root);
  return { n, nodes, order, root };
}

/**
 * The node ids of the k sub-tree roots left after cutting below the k-1 tallest merges,
 * ordered left→right by their leftmost leaf. `k` is clamped to 1…n.
 */
export function cutClusters(result: HClustResult, k: number): number[] {
  const { n, nodes, root } = result;
  if (n === 0) return [];
  const kk = Math.max(1, Math.min(n, Math.floor(k)));
  let clusters: number[] = [root];
  while (clusters.length < kk) {
    // Split whichever surviving cluster has the tallest root merge.
    let idx = -1;
    let tallest = -Infinity;
    for (let c = 0; c < clusters.length; c++) {
      const node = nodes[clusters[c]!]!;
      if (node.left !== null && node.height > tallest) {
        tallest = node.height;
        idx = c;
      }
    }
    if (idx < 0) break; // all remaining clusters are single leaves
    const node = nodes[clusters[idx]!]!;
    clusters.splice(idx, 1, node.left!, node.right!);
  }
  const minLeaf = (id: number): number => {
    let node = nodes[id]!;
    while (node.left !== null) node = nodes[node.left]!;
    return node.id;
  };
  return clusters.slice().sort((p, q) => minLeaf(p) - minLeaf(q));
}

/** All node ids in the sub-tree rooted at `id` (inclusive) — used to colour a cut cluster. */
export function subtreeNodes(result: HClustResult, id: number): number[] {
  const out: number[] = [];
  const stack = [id];
  while (stack.length) {
    const node = result.nodes[stack.pop()!]!;
    out.push(node.id);
    if (node.left !== null) {
      stack.push(node.left);
      stack.push(node.right!);
    }
  }
  return out;
}

/**
 * Cut the tree into exactly `k` clusters (1 ≤ k ≤ n) and return a per-leaf label in
 * 0…k-1, assigned in left→right leaf order (so adjacent leaves share a label when they
 * cluster together).
 */
export function clusterLabels(result: HClustResult, k: number): number[] {
  const labels = new Array<number>(result.n).fill(0);
  if (result.n === 0) return labels;
  cutClusters(result, k).forEach((cid, label) => {
    for (const id of subtreeNodes(result, cid)) {
      if (result.nodes[id]!.left === null) labels[id] = label;
    }
  });
  return labels;
}

/**
 * Where the blocks end when the tree is cut into `k` clusters — the display positions after
 * which a break falls, so a split heatmap can take its breaks from the clustering instead of
 * from hand-placed numbers.
 *
 * Returned in display order (the order the leaves are drawn in, `result.order`), because that is
 * the only order a drawing can use: leaf ids mean nothing once the tree has reordered them.
 * `k = 3` over six leaves ordered [A B | C D E | F] returns [1, 4].
 *
 * Fewer than k blocks can come back when the tree cannot be cut that finely (ties, or k > n);
 * that is the accurate answer rather than inventing a break.
 */
export function clusterBreaks(result: HClustResult, k: number): number[] {
  if (result.n < 2 || k < 2) return [];
  const labels = clusterLabels(result, k);
  const out: number[] = [];
  for (let i = 0; i < result.order.length - 1; i++) {
    if (labels[result.order[i]!] !== labels[result.order[i + 1]!]) out.push(i);
  }
  return out;
}

/**
 * Position of every node along the leaf axis, in leaf-slot units (0…n-1): a leaf sits at
 * its index in `order`; an internal node at the midpoint of its two children. Feeds the
 * dendrogram renderer (map these to pixels for the perpendicular-to-height axis).
 */
export function dendrogramCoords(result: HClustResult): number[] {
  const pos = new Array<number>(result.nodes.length).fill(0);
  result.order.forEach((leaf, i) => (pos[leaf] = i));
  // Nodes are id-ordered (leaves 0…n-1, then merges), so children precede parents.
  for (const node of result.nodes) {
    if (node.left !== null) pos[node.id] = (pos[node.left]! + pos[node.right!]!) / 2;
  }
  return pos;
}
