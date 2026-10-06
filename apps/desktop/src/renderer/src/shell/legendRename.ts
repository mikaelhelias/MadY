import type { DataTable, Plot } from "@mady/core";

/**
 * Rename a legend row on the graph (every text on a graph is editable, legend rows included).
 * Double-click a row's words; what the new words change depends on what the row names:
 *  - a data column (an xy / bar series): the column is renamed — the rule every other label naming a column follows
 *    (direct labels, Venn / UpSet sets, ternary edges), so the name changes everywhere at once;
 *  - a line the user listed in the legend: that line's caption;
 *  - anything else (a sunburst branch, an oncoprint alteration type, a rose speed band, an ordination group, a volcano
 *    zone, a pie slice): the row's display name, stored on the plot (`Plot.legendLabels`) — the data is untouched.
 * Empty words, or the built label again, put a renamed row back as it was built.
 */
export interface LegendRowTarget {
  kind: "legendRow";
  /** The row's label as the chart builds it — the key a stored display name is kept under. */
  label: string;
  /** The series the row keys, when it keys one. */
  seriesId?: string | undefined;
  /** The drawn line the row keys, when it is a listed line. */
  annotationId?: string | undefined;
}

export type LegendRowEdit =
  | { do: "renameColumn"; columnId: string; name: string }
  | { do: "annotationLabel"; id: string; label: string }
  | { do: "legendLabels"; legendLabels: Record<string, string> | undefined }
  | { do: "nothing" };

export function legendRowEdit(plot: Pick<Plot, "legendLabels">, table: Pick<DataTable, "columns"> | undefined, target: LegendRowTarget, value: string): LegendRowEdit {
  const v = value.trim();
  if (target.annotationId) return v ? { do: "annotationLabel", id: target.annotationId, label: v } : { do: "nothing" };
  if (target.seriesId && table?.columns.some((c) => c.id === target.seriesId)) {
    return v ? { do: "renameColumn", columnId: target.seriesId, name: v } : { do: "nothing" };
  }
  const next = { ...(plot.legendLabels ?? {}) };
  if (v === "" || v === target.label) delete next[target.label];
  else next[target.label] = v;
  return { do: "legendLabels", legendLabels: Object.keys(next).length ? next : undefined };
}
