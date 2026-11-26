import { tableDatasets } from "@mady/core";
import type { CellValue, ColumnType, DataTable, NodeId, Plot } from "@mady/core";
import { highlightColumnOf } from "@mady/graphics";
import type { PlotScene } from "@mady/graphics";

/**
 * Box selection (Shift-drag). Shift-drag a rectangle over a scatter-type chart;
 * the data points inside are picked, and a small menu offers Exclude, Highlight by name and Copy to a new sheet. The
 * geometry and the three actions live here, pure, so they can be tested without a screen; PlotFigure draws the box and
 * the menu, AppShell applies the action.
 */

/** Chart types whose points are one row each of the sheet, so a picked point names a real cell. */
export const BOX_SELECT_KINDS: ReadonlySet<string> = new Set(["xy", "bubble", "volcano"]);

/** One picked data point: the series (its lead column) and the row it came from. */
export interface PickedPoint {
  columnId: NodeId;
  rowId: NodeId;
}

/**
 * The data points whose centre lies inside the box (two corners, figure pixels, any order). Series borrowed from
 * another sheet (`from`) are left out — their rows are not in this sheet, so nothing here could act on them.
 */
export function pointsInBox(scene: PlotScene, a: { x: number; y: number }, b: { x: number; y: number }): PickedPoint[] {
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
  const out: PickedPoint[] = [];
  for (const s of scene.series) {
    if (s.from) continue;
    for (const m of s.marks) {
      if (!Number.isFinite(m.cx) || !Number.isFinite(m.cy)) continue;
      if (m.cx >= x0 && m.cx <= x1 && m.cy >= y0 && m.cy <= y1) out.push({ columnId: s.id, rowId: m.rowId });
    }
  }
  return out;
}

/** The cells to exclude for the picked points: every replicate column of the point's dataset, in its row. */
export function cellsOfPoints(table: DataTable, points: readonly PickedPoint[]): { rowId: NodeId; colId: NodeId }[] {
  const reps = new Map(tableDatasets(table).map((d) => [d.id, d.replicates.length ? d.replicates : [d.id]]));
  const seen = new Set<string>();
  const out: { rowId: NodeId; colId: NodeId }[] = [];
  for (const p of points) {
    for (const colId of reps.get(p.columnId) ?? [p.columnId]) {
      const k = `${p.rowId}\u0000${colId}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ rowId: p.rowId, colId });
    }
  }
  return out;
}

/**
 * The names to add to each series' Find & highlight list, read from the series' name column (`highlightColumnOf`).
 * Null when the sheet has no column of names — the menu then says so instead of offering it.
 */
export function highlightNamesFor(table: DataTable, plot: Plot, points: readonly PickedPoint[]): Map<NodeId, string[]> | null {
  const rowById = new Map(table.rows.map((r) => [r.id, r]));
  const out = new Map<NodeId, string[]>();
  for (const p of points) {
    const col = highlightColumnOf(plot.seriesStyles?.[p.columnId] ?? {}, table);
    if (!col) return null;
    const v = rowById.get(p.rowId)?.cells[col];
    const name = v === null || v === undefined ? "" : String(v).trim();
    if (name === "") continue;
    const list = out.get(p.columnId) ?? [];
    if (!list.includes(name)) list.push(name);
    out.set(p.columnId, list);
  }
  return out;
}

/** The picked rows as a new sheet's contents: every column of the sheet, the rows in sheet order. */
export function rowsOfPoints(table: DataTable, points: readonly PickedPoint[]): { columnNames: string[]; rows: CellValue[][]; columnTypes: (ColumnType | undefined)[] } {
  const want = new Set(points.map((p) => p.rowId));
  return {
    columnNames: table.columns.map((c) => c.name),
    rows: table.rows.filter((r) => want.has(r.id)).map((r) => table.columns.map((c) => r.cells[c.id] ?? null)),
    columnTypes: table.columns.map((c) => c.type),
  };
}
