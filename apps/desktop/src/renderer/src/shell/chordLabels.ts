import type { ChordStyle, DataTable, Plot } from "@mady/core";

/**
 * A chord diagram's node names, renamed or dragged on the graph, like every other text.
 *
 * A name is the data (the oncoprint's rule): renaming "Macrophage" edits every cell that holds it in the columns the
 * names were read from, and — in the matrix layout, where a target is a column's name — that column's name, so the
 * datasheet and the graph never disagree. The name's own colour and dragged place move to the new name.
 */
export interface ChordNameSources {
  /** Columns whose cells hold node names. */
  cellColumns: readonly string[];
  /** Whether other columns' names are node names too (the matrix layout). */
  columnNames: boolean;
}

export interface ChordRename {
  cells: { rowId: string; columnId: string; value: string }[];
  columns: { columnId: string; name: string }[];
  patch?: Partial<Plot> | undefined;
}

export function chordRename(table: DataTable, plot: Pick<Plot, "chord" | "seriesStyles">, sources: ChordNameSources, oldName: string, newName: string): ChordRename {
  const to = newName.trim();
  if (to === "" || to === oldName) return { cells: [], columns: [] };
  const cells = sources.cellColumns.flatMap((columnId) =>
    table.rows.filter((r) => String(r.cells[columnId] ?? "").trim() === oldName).map((r) => ({ rowId: r.id, columnId, value: to })));
  const columns = sources.columnNames
    ? table.columns.filter((c) => !sources.cellColumns.includes(c.id) && c.name.trim() === oldName).map((c) => ({ columnId: c.id, name: to }))
    : [];
  const patch: Partial<Plot> = {};
  const off = plot.chord?.labelOffsets?.[oldName];
  if (off) {
    const next = { ...plot.chord!.labelOffsets };
    delete next[oldName];
    next[to] = off;
    patch.chord = { ...(plot.chord ?? {}), labelOffsets: next };
  }
  // A node's own colour is kept under its name (as on the sunburst).
  const style = plot.seriesStyles?.[oldName];
  if (style) {
    const next = { ...plot.seriesStyles };
    delete next[oldName];
    next[to] = style;
    patch.seriesStyles = next;
  }
  return { cells, columns, ...(Object.keys(patch).length ? { patch } : {}) };
}

/** A drag: this name's offset from where the chart places it, the others kept. */
export function chordLabelMove(style: ChordStyle | undefined, name: string, dx: number, dy: number): Partial<Plot> {
  const st = style ?? {};
  return { chord: { ...st, labelOffsets: { ...(st.labelOffsets ?? {}), [name]: { dx, dy } } } };
}
