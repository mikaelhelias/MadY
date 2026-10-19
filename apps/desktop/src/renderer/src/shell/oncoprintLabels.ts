import type { Column, DataTable, OncoprintStyle, Plot } from "@mady/core";

/**
 * An oncoprint's gene and sample names, renamed or dragged on the graph, so these axis labels
 * are clickable and editable like every other text.
 *
 * A name is the data — the heatmap's row-name rule: renaming "TP53" edits every cell of the gene column that holds it
 * (compared trimmed, the way the chart groups the rows), so the datasheet and the graph never disagree. A dragged name
 * is keyed by the name itself, and keeps its place when renamed.
 */
export type OncoprintAxis = "gene" | "sample";

/** The column a name lives in: the one chosen in Chart type, else the chart's default (sample = 1st, gene = 2nd). */
function columnOf(table: DataTable, style: OncoprintStyle | undefined, axis: OncoprintAxis): Column | undefined {
  const chosen = axis === "gene" ? style?.geneColumn : style?.sampleColumn;
  return (chosen ? table.columns.find((c) => c.id === chosen) : undefined) ?? table.columns[axis === "gene" ? 1 : 0];
}

const offsetsKey = (axis: OncoprintAxis): "geneLabelOffsets" | "sampleLabelOffsets" => (axis === "gene" ? "geneLabelOffsets" : "sampleLabelOffsets");

/** A rename: the cells to rewrite, plus (when the name had been dragged) the patch that moves its offset to the new name. */
export function oncoprintRename(
  table: DataTable,
  style: OncoprintStyle | undefined,
  axis: OncoprintAxis,
  oldName: string,
  newName: string,
): { cells: { rowId: string; columnId: string; value: string }[]; patch?: Partial<Plot> | undefined } {
  const to = newName.trim();
  const col = columnOf(table, style, axis);
  if (!col || to === "" || to === oldName) return { cells: [] };
  const cells = table.rows
    .filter((r) => String(r.cells[col.id] ?? "").trim() === oldName)
    .map((r) => ({ rowId: r.id, columnId: col.id, value: to }));
  const offs = style?.[offsetsKey(axis)];
  const moved = offs?.[oldName];
  if (!moved) return { cells };
  const next = { ...offs };
  delete next[oldName];
  next[to] = moved;
  return { cells, patch: { oncoprint: { ...(style ?? {}), [offsetsKey(axis)]: next } } };
}

/** A drag: this name's offset from where the chart places it, the others kept. */
export function oncoprintLabelMove(style: OncoprintStyle | undefined, axis: OncoprintAxis, name: string, dx: number, dy: number): Partial<Plot> {
  const st = style ?? {};
  return axis === "gene"
    ? { oncoprint: { ...st, geneLabelOffsets: { ...(st.geneLabelOffsets ?? {}), [name]: { dx, dy } } } }
    : { oncoprint: { ...st, sampleLabelOffsets: { ...(st.sampleLabelOffsets ?? {}), [name]: { dx, dy } } } };
}
