import type { Plot, PlotKind, SeriesStyle } from "@mady/core";

/**
 * Point spread — one control on the Data tab, with a "whole graph" tick box beside it.
 *
 * Where the value lives:
 *  - the whole graph: `Plot.pointSpread`;
 *  - one series (tick box unticked): `SeriesStyle.pointSpread`, which beats the graph's;
 *  - a column scatter saved with a series width (`SeriesStyle.boxWidth`, 0.5 = 1×): read only while
 *    the series has no `pointSpread` of its own — the builder reads it the same way, so a saved graph keeps its look.
 */

/** What the slider shows for the clicked series: what that series draws. */
export function pointSpreadShown(plot: Pick<Plot, "pointSpread">, style: SeriesStyle | undefined, kind: PlotKind): number {
  if (style?.pointSpread !== undefined) return style.pointSpread;
  if (kind === "scatter" && style?.boxWidth !== undefined) return Math.round((Math.min(0.9, Math.max(0.1, style.boxWidth)) / 0.5) * 100) / 100;
  return plot.pointSpread ?? 1;
}

/**
 * The single patch that sets the whole graph to `n`: the graph's value, with every series' own spread cleared — and a
 * column scatter's saved `boxWidth`, which would otherwise keep beating it. One write, so one undo step.
 */
export function pointSpreadWholeGraph(plot: Pick<Plot, "pointSpread" | "seriesStyles" | "kind">, n: number): Partial<Plot> {
  const patch: Partial<Plot> = { pointSpread: n === 1 ? undefined : n };
  const styles = plot.seriesStyles ?? {};
  let changed = false;
  const next: Record<string, SeriesStyle> = {};
  for (const [id, st] of Object.entries(styles)) {
    if (st.pointSpread === undefined && !(plot.kind === "scatter" && st.boxWidth !== undefined)) {
      next[id] = st;
      continue;
    }
    changed = true;
    const { pointSpread: _own, ...rest } = st;
    const kept: SeriesStyle = rest;
    if (plot.kind === "scatter") delete kept.boxWidth;
    if (Object.keys(kept).length > 0) next[id] = kept;
  }
  if (changed) patch.seriesStyles = next;
  return patch;
}
