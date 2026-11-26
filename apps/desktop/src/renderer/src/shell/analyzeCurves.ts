import { tableDatasets } from "@mady/core";
import type { DataTable, NodeId, Plot } from "@mady/core";
import { bubbleSeriesDatasets } from "@mady/graphics";
import type { AnalyzeSpec } from "./AnalyzeDialog";

/**
 * The datasets a graph draws as series, as ids: what `graphCurves` starts from. A bubble chart draws only its first
 * dataset; the second sets the bubble size and the rest at most the colour, so a fit of them would be a curve with no
 * points under it.
 */
export function graphDatasetIds(plot: Pick<Plot, "kind">, table: DataTable): NodeId[] {
  return (plot.kind === "bubble" ? bubbleSeriesDatasets(table) : tableDatasets(table)).map((d) => d.id);
}

/** The series a graph puts in front of the Analyze dialog, as dataset ids. */
export interface GraphCurves {
  /** The series selected on the graph, when one is. */
  selected?: NodeId | undefined;
  /** Every series the graph draws (hidden ones left out), in table order. */
  shown: NodeId[];
}

/**
 * What the Analyze dialog starts from when it is opened on a graph: the series selected on it,
 * and the series the graph draws. A series hidden on the graph is left out; when every series is
 * hidden, all of them count, so the dialog never starts with nothing to analyze.
 */
export function graphCurves(plot: Pick<Plot, "seriesStyles">, datasetIds: readonly NodeId[], selectedId?: NodeId | undefined): GraphCurves {
  const drawn = datasetIds.filter((id) => !plot.seriesStyles?.[id]?.hidden);
  const shown = drawn.length ? drawn : [...datasetIds];
  const selected = selectedId !== undefined && datasetIds.includes(selectedId) ? selectedId : undefined;
  return selected !== undefined ? { selected, shown } : { shown };
}

/**
 * The curves a method starts with when opened from a graph: the selected series, else every
 * series shown. A method that needs at least `min` curves (a global fit shares parameters across
 * two or more) takes every shown series when the selection alone is too few.
 */
export function startingCurves(curves: GraphCurves, min = 1): NodeId[] {
  return curves.selected !== undefined && min <= 1 ? [curves.selected] : curves.shown;
}

/**
 * A curve fit of several ticked series is several ordinary fits: one per series, each with the
 * same X column and the same model and settings. Every other run passes through as it is.
 */
export function oneSpecPerCurve(spec: AnalyzeSpec): AnalyzeSpec[] {
  if (spec.method !== "curvefit" || spec.columns.length <= 2) return [spec];
  const [x, ...ys] = spec.columns;
  return ys.map((y) => ({ ...spec, columns: [x!, y] }));
}
