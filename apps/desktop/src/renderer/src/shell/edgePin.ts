import type { DataTable, NodeId, Plot } from "@mady/core";
import { renderFingerprint } from "./drawingMarkup";

const SIZE = { width: 620, height: 420 };
/** The sheet cut to its first `limit` rows (plus `keepRowId`), for a probe the panel runs on every render. */
export function probeRows(table: DataTable, keepRowId?: string | undefined, limit = 40): DataTable {
  if (table.rows.length <= limit) return table;
  const rows = table.rows.slice(0, limit);
  const keep = keepRowId ? table.rows.find((r) => r.id === keepRowId) : undefined;
  if (keep && !rows.includes(keep)) rows.push(keep);
  return { ...table, rows };
}

/**
 * Does the "Custom edge colour" pin (`twoToneEdge`) reach this series' drawing?
 *
 * The pin colours the edge of a two-tone marker. A style preset marks every series two-tone, so "the series is
 * two-tone" no longer says whether it draws a marker: bars, boxes, a pyramid, a ridgeline, a histogram without its
 * points and a track strip draw none, and a volcano's points take their edge from their zone. The scene does not
 * settle it either: it carries the series' resolved outline whether or not a marker is drawn with it. So it is asked
 * of the rendered figure: two different colours are pinned on the series (or on the one point, for the per-point
 * panel), and the pin is offered only where the two figures differ.
 */
export function edgePinReachesDrawing(table: DataTable, plot: Plot, colId: NodeId, pointKey?: string | undefined): boolean {
  // Whether a series draws a marker does not depend on how many rows it has, and the panel asks on every render:
  // the figures are drawn from a few rows (the clicked point's row among them), not the whole sheet.
  const rowId = pointKey?.slice(pointKey.indexOf(":") + 1);
  table = probeRows(table, rowId);
  const withPin = (c: string): Plot => pointKey
    ? { ...plot, pointStyles: { ...(plot.pointStyles ?? {}), [pointKey]: { ...(plot.pointStyles?.[pointKey] ?? {}), twoToneEdge: c } } }
    : { ...plot, seriesStyles: { ...(plot.seriesStyles ?? {}), [colId]: { ...(plot.seriesStyles?.[colId] ?? {}), twoToneEdge: c } } };
  const a = renderFingerprint(table, withPin("#010203"), SIZE);
  return !a.startsWith("THREW") && a !== renderFingerprint(table, withPin("#fefdfc"), SIZE);
}
