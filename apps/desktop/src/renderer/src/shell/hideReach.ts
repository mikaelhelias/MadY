import type { DataTable, NodeId, Plot } from "@mady/core";
import { renderFingerprint } from "./drawingMarkup";
import { probeRows } from "./edgePin";

/**
 * Kinds whose builders honour `seriesStyles[id].hidden` for every series their lists show: the XY family keeps a
 * hidden series in the spread band and average and drops it at the drawing step, and the bar and distribution
 * builders read their datasets through `visibleDatasets`. Checked against the drawing by `hide-box-draws.test.tsx`;
 * they skip the per-row check below, which would otherwise draw a large sheet once per series on every edit.
 */
const HIDE_HONOURED = new Set([
  "xy", "area", "bubble", "bar", "box", "violin", "scatter", "raincloud", "floatingbar", "histogram", "ridgeline", "lollipop", "paireddot",
]);

/**
 * The rows of a series list whose show/hide box changes the drawing.
 *
 * Elsewhere a box is not a given. Some graphs read their columns by position (an estimation plot's control and test,
 * a pyramid's two sides) or draw series of their own (ordination groups, the scree line), and their builders ignore
 * `hidden` on purpose; others list columns the drawing does not plot (a volcano's gene names). A box there would be a
 * control that does nothing, so each row is asked of the rendered figure: flipping its hidden flag must change it.
 */
export function hideReachIds(table: DataTable, plot: Plot, ids: readonly NodeId[]): Set<NodeId> {
  if (HIDE_HONOURED.has(plot.kind ?? "xy")) return new Set(ids);
  // Exact up to 400 rows. The answer can depend on the data (a volcano labels its genes only when few enough points
  // leave room, so hiding the gene column matters on a short sheet and not on a long one); past that the figures
  // are drawn from the first 400 rows, which keeps the panel quick on a large sheet.
  table = probeRows(table, undefined, 400);
  const size = { width: 620, height: 420 };
  const base = renderFingerprint(table, plot, size);
  const out = new Set<NodeId>();
  for (const id of ids) {
    const flipped: Plot = { ...plot, seriesStyles: { ...(plot.seriesStyles ?? {}), [id]: { ...(plot.seriesStyles?.[id] ?? {}), hidden: !(plot.seriesStyles?.[id]?.hidden ?? false) } } };
    if (renderFingerprint(table, flipped, size) !== base) out.add(id);
  }
  return out;
}
