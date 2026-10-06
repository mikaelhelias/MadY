/**
 * LineagePanel — the interactive provenance / "Family" view.
 *
 * Renders the whole-project lineage DAG (`doc.projectLineage()`) as a left-to-right
 * flow: data → derived data → analysis → graph → figure. Layout is by **topological
 * depth** (a node sits one column right of its deepest source), so provenance reads
 * as a river. Each sheet is a clickable node (→ opens its tab); its border colour
 * encodes freshness (ok / stale / error); hovering a node spotlights its immediate
 * family and dims the rest. A one-click "Re-run stale (N)" refreshes everything the
 * document knows is out of date.
 *
 * Implementation is a hybrid: absolutely-positioned HTML `<button>` nodes (so they
 * get real icons + text + focus) layered over a full-canvas SVG edge layer (bezier
 * `path`s). Positions are computed once per lineage in `layout()`.
 */
import { useMemo, useState } from "react";
import { LayoutGrid, LineChart, RefreshCw, Sigma, Table } from "lucide-react";
import type { Lineage, LineageNode, NodeId } from "@mady/core";

const NODE_W = 158;
const NODE_H = 48;
const COL_GAP = 66;
const ROW_GAP = 16;
const PAD = 24;

// Match the Navigator's icon vocabulary for the same object kinds.
const KIND_ICON = { table: Table, analysis: Sigma, plot: LineChart, layout: LayoutGrid } as const;
const KIND_LABEL = { table: "Data", analysis: "Analysis", plot: "Graph", layout: "Figure" } as const;

interface Props {
  lineage: Lineage;
  /** Open a sheet (table/analysis/plot → tab; layout → its dedicated view). */
  onOpen: (kind: LineageNode["kind"], id: NodeId) => void;
  /** Re-run every stale analysis + refresh stale derived data. */
  onRerunStale: () => void;
}

interface Placed {
  node: LineageNode;
  x: number;
  y: number;
}
interface LaidEdge {
  from: NodeId;
  to: NodeId;
  d: string;
}

/** Topological-depth column layout + bezier edge paths for one lineage graph. */
function layout(lineage: Lineage): {
  placed: Placed[];
  edges: LaidEdge[];
  width: number;
  height: number;
  staleCount: number;
} {
  const ids = new Set(lineage.nodes.map((n) => n.id));
  const parents = new Map<NodeId, NodeId[]>();
  for (const e of lineage.edges) {
    if (!ids.has(e.from) || !ids.has(e.to)) continue;
    const arr = parents.get(e.to);
    if (arr) arr.push(e.from);
    else parents.set(e.to, [e.from]);
  }

  // depth(n) = 0 if no incoming edge, else 1 + max(parent depths). Memoised DFS
  // with a "computing" guard so a stray cycle can't spin forever.
  const depth = new Map<NodeId, number>();
  const computing = new Set<NodeId>();
  const visit = (id: NodeId): number => {
    const cached = depth.get(id);
    if (cached !== undefined) return cached;
    if (computing.has(id)) return 0;
    computing.add(id);
    const ps = parents.get(id) ?? [];
    const d = ps.length ? 1 + Math.max(...ps.map(visit)) : 0;
    computing.delete(id);
    depth.set(id, d);
    return d;
  };
  for (const n of lineage.nodes) visit(n.id);

  // Group into columns by depth (stable node order within a column).
  const byDepth = new Map<number, LineageNode[]>();
  for (const n of lineage.nodes) {
    const d = depth.get(n.id) ?? 0;
    const arr = byDepth.get(d);
    if (arr) arr.push(n);
    else byDepth.set(d, [n]);
  }
  const maxDepth = Math.max(0, ...byDepth.keys());

  const placed: Placed[] = [];
  const pos = new Map<NodeId, { x: number; y: number }>();
  let maxRows = 1;
  for (let d = 0; d <= maxDepth; d++) {
    const col = byDepth.get(d) ?? [];
    maxRows = Math.max(maxRows, col.length);
    col.forEach((node, i) => {
      const x = PAD + d * (NODE_W + COL_GAP);
      const y = PAD + i * (NODE_H + ROW_GAP);
      pos.set(node.id, { x, y });
      placed.push({ node, x, y });
    });
  }
  const width = PAD * 2 + (maxDepth + 1) * NODE_W + maxDepth * COL_GAP;
  const height = PAD * 2 + maxRows * NODE_H + (maxRows - 1) * ROW_GAP;

  // Edges: a horizontal-tangent cubic from the source's right edge to the target's
  // left edge. In a depth-layered DAG every child sits strictly right of its parent,
  // so paths always flow forward.
  const edges: LaidEdge[] = [];
  for (const e of lineage.edges) {
    const a = pos.get(e.from);
    const b = pos.get(e.to);
    if (!a || !b) continue;
    const x1 = a.x + NODE_W;
    const y1 = a.y + NODE_H / 2;
    const x2 = b.x;
    const y2 = b.y + NODE_H / 2;
    const dx = Math.max(28, Math.abs(x2 - x1) / 2);
    edges.push({ from: e.from, to: e.to, d: `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}` });
  }

  const staleCount = lineage.nodes.filter((n) => n.status === "stale").length;
  return { placed, edges, width, height, staleCount };
}

export function LineagePanel({ lineage, onOpen, onRerunStale }: Props) {
  const [hoverId, setHoverId] = useState<NodeId | null>(null);

  const { placed, edges, width, height, staleCount } = useMemo(() => layout(lineage), [lineage]);

  // Undirected adjacency for hover spotlighting (a node's immediate family).
  const neighbors = useMemo(() => {
    const m = new Map<NodeId, Set<NodeId>>();
    const add = (a: NodeId, b: NodeId): void => {
      const s = m.get(a);
      if (s) s.add(b);
      else m.set(a, new Set([b]));
    };
    for (const e of lineage.edges) {
      add(e.from, e.to);
      add(e.to, e.from);
    }
    return m;
  }, [lineage]);

  if (lineage.nodes.length === 0) {
    return (
      <div className="lineage lineage-empty" data-testid="lineage-empty">
        <div>
          <h3>No lineage yet</h3>
          <p>
            Import data, run an analysis, or make a graph — the provenance of every sheet
            (data → analysis → graph → figure) will map here.
          </p>
        </div>
      </div>
    );
  }

  const dimNode = (id: NodeId): boolean =>
    hoverId !== null && id !== hoverId && !neighbors.get(hoverId)?.has(id);

  return (
    <div className="lineage">
      <div className="lineage-head">
        <div className="lineage-title">
          <strong>Lineage</strong>
          <span className="lineage-counts">
            {lineage.nodes.length} sheets · {lineage.edges.length} links
          </span>
        </div>
        <div className="lineage-legend">
          <span className="lin-key">
            <i className="lin-dot lin-dot--ok" />
            OK
          </span>
          <span className="lin-key">
            <i className="lin-dot lin-dot--stale" />
            Stale
          </span>
          <span className="lin-key">
            <i className="lin-dot lin-dot--error" />
            Error
          </span>
        </div>
        {staleCount > 0 && (
          <button
            className="lineage-rerun"
            onClick={onRerunStale}
            title="Re-run every stale analysis and refresh derived data"
          >
            <RefreshCw size={13} /> Re-run stale ({staleCount})
          </button>
        )}
      </div>
      <div className="lineage-scroll">
        <div className="lineage-canvas" style={{ width, height }}>
          <svg className="lineage-edges" width={width} height={height} aria-hidden="true">
            {edges.map((e, i) => {
              const hot = hoverId !== null && (e.from === hoverId || e.to === hoverId);
              const dim = hoverId !== null && !hot;
              return (
                <path
                  key={i}
                  className={`lin-edge${hot ? " lin-edge--hot" : ""}${dim ? " lin-edge--dim" : ""}`}
                  d={e.d}
                />
              );
            })}
          </svg>
          {placed.map((p) => {
            const Icon = KIND_ICON[p.node.kind];
            return (
              <button
                key={p.node.id}
                type="button"
                className={`lin-node lin-node--${p.node.status}${dimNode(p.node.id) ? " lin-node--dim" : ""}`}
                style={{ left: p.x, top: p.y, width: NODE_W, height: NODE_H }}
                onMouseEnter={() => setHoverId(p.node.id)}
                onMouseLeave={() => setHoverId(null)}
                onClick={() => onOpen(p.node.kind, p.node.id)}
                title={`Open ${p.node.name}`}
              >
                <Icon size={15} className="lin-node-icon" />
                <span className="lin-node-body">
                  <span className="lin-node-name">{p.node.name}</span>
                  <span className="lin-node-kind">
                    {KIND_LABEL[p.node.kind]}
                    {p.node.status !== "ok" ? ` · ${p.node.status}` : ""}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
