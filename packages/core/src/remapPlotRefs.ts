/**
 * Rewrite every column / row / table reference a Plot holds through one id map — the one
 * place that knows where a plot points at its sheet.
 *
 * Why one place. `insertGraph` (a gallery card or a template becoming a real graph) gives
 * every column and row a fresh id, and remapping the plot's bindings by hand, field by field,
 * easily misses some — qq / manhattan / sunburst / chord / oncoprint columns, `barSeriesGroups`,
 * the per-point styles, venn / upset / ternary label offsets, an axis's category groups. Each
 * missed one is a binding that silently falls back to nothing. `remapPlotRefs.test.ts`
 * reads the model and refuses a NodeId-typed field this function does not know about.
 *
 * Pure: returns a deep copy; the input is untouched. Ids the map does not know are kept as
 * they are (a `pointStyles` key's second half may be a category value, not a row id).
 */
import type { NodeId, Plot } from "./model";

export function remapPlotIds<T extends Partial<Plot>>(plot: T, remap: (id: NodeId) => NodeId): T {
  const p = JSON.parse(JSON.stringify(plot)) as Plot;
  const keys = <T>(rec: Record<string, T>): Record<string, T> =>
    Object.fromEntries(Object.entries(rec).map(([k, v]) => [remap(k), v]));

  // Per-series styles: keyed by dataset (column) id, and three fields inside name a column.
  if (p.seriesStyles) {
    p.seriesStyles = keys(p.seriesStyles);
    for (const st of Object.values(p.seriesStyles)) {
      if (st.colorFromColumn) st.colorFromColumn = remap(st.colorFromColumn);
      if (st.symbolFromColumn) st.symbolFromColumn = remap(st.symbolFromColumn);
      if (st.pointLabelColumn) st.pointLabelColumn = remap(st.pointLabelColumn);
      if (st.highlightColumn) st.highlightColumn = remap(st.highlightColumn);
    }
  }
  // Per-point styles: `${columnId}:${rowId}` (the alluvial uses `${columnId}:${category}` —
  // an unknown second half is kept verbatim).
  if (p.pointStyles) {
    p.pointStyles = Object.fromEntries(
      Object.entries(p.pointStyles).map(([k, v]) => {
        const i = k.indexOf(":");
        return [i < 0 ? remap(k) : `${remap(k.slice(0, i))}:${remap(k.slice(i + 1))}`, v];
      }),
    );
  }
  if (p.barSeriesGroups) p.barSeriesGroups = keys(p.barSeriesGroups);
  if (p.splitFrom) p.splitFrom = { plot: remap(p.splitFrom.plot), series: remap(p.splitFrom.series) };
  for (const ax of [p.xAxis, p.yAxis, p.y2Axis, p.y3Axis]) {
    if (ax?.categoryGroups?.column) ax.categoryGroups.column = remap(ax.categoryGroups.column);
  }
  if (p.treemap) {
    if (p.treemap.groupColumn) p.treemap.groupColumn = remap(p.treemap.groupColumn);
    if (p.treemap.iconColumn) p.treemap.iconColumn = remap(p.treemap.iconColumn);
  }
  if (p.parallel) {
    if (p.parallel.colorColumn) p.parallel.colorColumn = remap(p.parallel.colorColumn);
    if (p.parallel.axisOrder) p.parallel.axisOrder = p.parallel.axisOrder.map(remap);
    if (p.parallel.brushes) p.parallel.brushes = keys(p.parallel.brushes);
    if (p.parallel.perAxis) p.parallel.perAxis = keys(p.parallel.perAxis);
  }
  if (p.alluvial?.columns) p.alluvial.columns = p.alluvial.columns.map(remap);
  if (p.network) {
    if (p.network.groupColumn) p.network.groupColumn = remap(p.network.groupColumn);
    if (p.network.sizeColumn) p.network.sizeColumn = remap(p.network.sizeColumn);
  }
  if (p.heatmap) {
    if (p.heatmap.rowTracks) for (const t of p.heatmap.rowTracks) if (t.column) t.column = remap(t.column);
    if (p.heatmap.colTracks) for (const t of p.heatmap.colTracks) if (t.values) t.values = keys(t.values);
  }
  if (p.qq?.pColumn) p.qq.pColumn = remap(p.qq.pColumn);
  if (p.manhattan) {
    if (p.manhattan.pColumn) p.manhattan.pColumn = remap(p.manhattan.pColumn);
    if (p.manhattan.chrColumn) p.manhattan.chrColumn = remap(p.manhattan.chrColumn);
    if (p.manhattan.posColumn) p.manhattan.posColumn = remap(p.manhattan.posColumn);
  }
  if (p.sunburst) {
    if (p.sunburst.levelColumns) p.sunburst.levelColumns = p.sunburst.levelColumns.map(remap);
    if (p.sunburst.valueColumn) p.sunburst.valueColumn = remap(p.sunburst.valueColumn);
  }
  if (p.chord) {
    if (p.chord.sourceColumn) p.chord.sourceColumn = remap(p.chord.sourceColumn);
    if (p.chord.targetColumn) p.chord.targetColumn = remap(p.chord.targetColumn);
    if (p.chord.weightColumn) p.chord.weightColumn = remap(p.chord.weightColumn);
    if (p.chord.groupColumn) p.chord.groupColumn = remap(p.chord.groupColumn);
  }
  if (p.oncoprint) {
    if (p.oncoprint.sampleColumn) p.oncoprint.sampleColumn = remap(p.oncoprint.sampleColumn);
    if (p.oncoprint.geneColumn) p.oncoprint.geneColumn = remap(p.oncoprint.geneColumn);
    if (p.oncoprint.alterationColumn) p.oncoprint.alterationColumn = remap(p.oncoprint.alterationColumn);
  }
  if (p.venn?.labelOffsets) p.venn.labelOffsets = keys(p.venn.labelOffsets);
  if (p.upset?.labelOffsets) p.upset.labelOffsets = keys(p.upset.labelOffsets);
  if (p.ternary?.axisLabelOff) p.ternary.axisLabelOff = keys(p.ternary.axisLabelOff);
  // A borrowed series names its sheet AND its column.
  if (p.overlays) p.overlays = p.overlays.map((o) => ({ ...o, table: remap(o.table), column: remap(o.column) }));
  for (const fit of [p.fit, ...(p.fits ?? [])]) if (fit?.analysisSource) fit.analysisSource = remap(fit.analysisSource);
  return p as unknown as T;
}

/**
 * Drop every column / row / table reference a (partial) plot holds — for a captured STYLE that
 * will be applied to a graph drawn from a different sheet, where those ids mean nothing, or
 * worse, something else. Built on `remapPlotIds`, so the census that keeps that function
 * complete keeps this one complete too.
 */
export function stripPlotRefs<T extends Partial<Plot>>(plot: T): T {
  const p = remapPlotIds(plot, () => STRIPPED) as Record<string, unknown>;
  prune(p);
  // A borrowed series IS its table + column; with those gone the entry is nothing.
  delete p.overlays;
  // A heatmap track without its binding is a dead track, not a style: a row track names a
  // column, a column track carries per-column values (already emptied and removed by `prune`).
  const h = p.heatmap as { rowTracks?: { column?: unknown }[]; colTracks?: { values?: unknown }[] } | undefined;
  if (h) {
    if (h.rowTracks) {
      h.rowTracks = h.rowTracks.filter((t) => t.column !== undefined);
      if (h.rowTracks.length === 0) delete h.rowTracks;
    }
    if (h.colTracks) {
      h.colTracks = h.colTracks.filter((t) => t.values !== undefined);
      if (h.colTracks.length === 0) delete h.colTracks;
    }
    if (Object.keys(h).length === 0) delete p.heatmap;
  }
  return p as unknown as T;
}

/** What every reference becomes before pruning — a string no real id or label contains. */
const STRIPPED = "\u0000stripped-ref";
const isStripped = (v: unknown): boolean => typeof v === "string" && v.includes(STRIPPED);
const isEmpty = (v: object): boolean => (Array.isArray(v) ? v.length === 0 : Object.keys(v).length === 0);

/**
 * Remove stripped ids in place — as array members, record keys (a `column:row` point key has
 * one in either half) and values — and drop any container the removal left empty. Returns
 * whether anything was removed inside `node`, so an emptied container is told apart from one
 * that was empty to begin with.
 */
function prune(node: unknown): boolean {
  let removed = false;
  if (Array.isArray(node)) {
    for (let i = node.length - 1; i >= 0; i--) {
      const v: unknown = node[i];
      if (isStripped(v)) { node.splice(i, 1); removed = true; continue; }
      if (v && typeof v === "object") {
        const inner = prune(v);
        removed ||= inner;
        if (inner && isEmpty(v)) node.splice(i, 1);
      }
    }
  } else if (node && typeof node === "object") {
    const rec = node as Record<string, unknown>;
    for (const k of Object.keys(rec)) {
      const v = rec[k];
      if (isStripped(k) || isStripped(v)) { delete rec[k]; removed = true; continue; }
      if (v && typeof v === "object") {
        const inner = prune(v);
        removed ||= inner;
        if (inner && isEmpty(v)) delete rec[k];
      }
    }
  }
  return removed;
}
