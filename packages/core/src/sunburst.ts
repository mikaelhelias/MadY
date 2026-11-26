/**
 * Sunburst hierarchy roll-up (the `sunburst` graph kind): given rows described by an ordered list
 * of category levels (Kingdom → Phylum → Class …) plus a leaf value, build the nested tree where
 * every node's value is the SUM of its descendants. Pure + DOM-free — the radial LAYOUT (angles,
 * ring radii, arc paths) lives in the graphics builder; this is the one computation worth an
 * independent test (a parent's value equals the sum of its children's).
 */

/** One node of the sunburst hierarchy. The root is depth 0 with an empty name. */
export interface SunburstNode {
  /** Category label at this node ("" for the synthetic root). */
  name: string;
  /** Ring depth: 0 = root (the centre), 1 = the innermost drawn ring, … */
  depth: number;
  /** Sum of the leaf values beneath this node. */
  value: number;
  /** Id of the level column this node's category came from (undefined for the root). */
  columnId?: string | undefined;
  /** A representative source row id passing through this node — the click-routing target. */
  rowId?: string | undefined;
  /** Children in first-appearance order. */
  children: SunburstNode[];
}

/** One input row: its category path (inner→outer), a leaf value, and its source row id. */
export interface SunburstItem {
  path: string[];
  value: number;
  rowId: string;
}

/**
 * Fold rows into a hierarchy. Children keep first-appearance order; each node's `value` is the sum
 * of the values routed through it, so a parent arc always spans exactly its children. A zero-length
 * or all-blank path is skipped (it belongs to no branch).
 */
export function sunburstHierarchy(items: readonly SunburstItem[], columnIds: readonly string[]): SunburstNode {
  const root: SunburstNode = { name: "", depth: 0, value: 0, children: [] };
  for (const it of items) {
    const path = it.path.map((s) => s.trim());
    if (path.length === 0 || path.every((s) => s === "")) continue;
    const v = Number.isFinite(it.value) ? it.value : 0;
    let node = root;
    node.value += v;
    if (node.rowId === undefined) node.rowId = it.rowId;
    for (let d = 0; d < path.length; d++) {
      const name = path[d]!;
      if (name === "") break; // a blank level ends this row's descent (a shallower leaf)
      let child = node.children.find((c) => c.name === name);
      if (!child) {
        child = { name, depth: d + 1, value: 0, columnId: columnIds[d], children: [] };
        node.children.push(child);
      }
      child.value += v;
      if (child.rowId === undefined) child.rowId = it.rowId;
      node = child;
    }
  }
  return root;
}

/** Depth of the deepest node (0 for an empty tree — root only). */
export function sunburstDepth(root: SunburstNode): number {
  let max = 0;
  const walk = (n: SunburstNode): void => {
    if (n.depth > max) max = n.depth;
    n.children.forEach(walk);
  };
  walk(root);
  return max;
}
