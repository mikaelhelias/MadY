import type { Plot, SeriesStyle } from "@mady/core";

/**
 * Bar width, whole graph or one series (the same pattern as Point spread). One slider on
 * the Data tab with a "whole graph" tick box beside it:
 *  - ticked: `Plot.barWidth`, the share of the category band the bars fill (0.1–1, default 0.82) — every bar;
 *  - unticked: `SeriesStyle.barWidth`, this series' share of its own place in the group (0.1–1; 100 % fills it, the
 *    default). A narrower bar keeps its centre, so its neighbours never move or overlap.
 */
const GRAPH_DEFAULT = 0.82;
const clamp = (n: number): number => Math.min(1, Math.max(0.1, n));

/** What the slider shows: the graph's width (ticked) or the clicked series' own (unticked). */
export function barWidthShown(plot: Pick<Plot, "barWidth" | "seriesStyles">, seriesId: string, whole: boolean): number {
  return whole ? plot.barWidth ?? GRAPH_DEFAULT : plot.seriesStyles?.[seriesId]?.barWidth ?? 1;
}

/** The one patch that sets every bar: the graph's width, with every series' own width cleared (one undo step). */
export function barWidthWholeGraph(plot: Pick<Plot, "seriesStyles">, n: number): Partial<Plot> {
  const patch: Partial<Plot> = { barWidth: clamp(n) };
  const styles = plot.seriesStyles ?? {};
  if (!Object.values(styles).some((s) => s?.barWidth !== undefined)) return patch;
  const next: Record<string, SeriesStyle> = {};
  for (const [id, st] of Object.entries(styles)) {
    if (st.barWidth === undefined) {
      next[id] = st;
      continue;
    }
    const { barWidth: _own, ...rest } = st;
    if (Object.keys(rest).length > 0) next[id] = rest;
  }
  patch.seriesStyles = next;
  return patch;
}

/**
 * A drag of a bar's edge. The figure reports the band share the dragged bar implies; ticked, that
 * is the graph's width; unticked, over the graph's share it is the series' own share of its place.
 */
export function barWidthFromDrag(
  plot: Pick<Plot, "barWidth" | "seriesStyles">,
  seriesId: string,
  bandShare: number,
  whole: boolean,
): { plot?: Partial<Plot>; series?: { id: string; barWidth: number } } {
  if (whole) return { plot: barWidthWholeGraph(plot, bandShare) };
  return { series: { id: seriesId, barWidth: Math.round(clamp(bandShare / (plot.barWidth ?? GRAPH_DEFAULT)) * 100) / 100 } };
}
