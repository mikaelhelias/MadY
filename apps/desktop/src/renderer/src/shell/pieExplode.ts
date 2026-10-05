import { tableDatasets, type DataTable, type Plot, type SeriesStyle } from "@mady/core";

/**
 * Explode the whole pie (an "explode" slider on the Chart tab, under "donut hole", to bring the slices together or
 * explode them all). One slider sets every slice's gap from the centre at once — the per-slice slider
 * (Data tab, click a slice) still refines one. The builder already reads `sliceExplode` per slice: this only writes it.
 *
 * Where a slice's explode lives:
 *  - a parts-of-whole pie (one value column, a slice per row): the value column's style is every slice's base and a
 *    row's own style overrides it — so "all slices" = the column's value, with every row's own override cleared;
 *  - a column pie (a slice per column): each column's own style.
 * One `seriesStyles` patch, so the whole move is one undo step.
 */
function sliceIds(table: DataTable): { base?: string; own: string[] } {
  const ds = tableDatasets(table);
  if (table.kind === "partsofwhole" && ds.length >= 1) return { base: ds[0]!.id, own: table.rows.map((r) => r.id) };
  return { own: ds.map((d) => d.id) };
}

/**
 * The value the slider shows: the largest explode any slice draws (a slice's own, else the shared base). Reading the
 * base alone would show 0 on a pie whose slices were pulled out one by one - and 0 is then no change, so the slider
 * could not bring that pie together. All slices equal → that value.
 */
export function pieExplodeShown(plot: Pick<Plot, "seriesStyles">, table: DataTable): number {
  const { base, own } = sliceIds(table);
  const shared = (base ? plot.seriesStyles?.[base]?.sliceExplode : undefined) ?? 0;
  return own.reduce((m, id) => Math.max(m, plot.seriesStyles?.[id]?.sliceExplode ?? shared), own.length ? 0 : shared);
}

/** The patch that sets every slice to `amount` (0 = the pie brought together). */
export function pieExplodeAll(plot: Pick<Plot, "seriesStyles">, table: DataTable, amount: number): Pick<Plot, "seriesStyles"> {
  const { base, own } = sliceIds(table);
  const next: Record<string, SeriesStyle> = { ...(plot.seriesStyles ?? {}) };
  const set = (id: string, v: number | undefined): void => {
    const s: SeriesStyle = { ...(next[id] ?? {}) };
    if (v === undefined) delete s.sliceExplode;
    else s.sliceExplode = v;
    if (Object.keys(s).length) next[id] = s;
    else delete next[id];
  };
  if (base) {
    set(base, amount);
    for (const id of own) if (next[id]?.sliceExplode !== undefined) set(id, undefined);
  } else {
    for (const id of own) set(id, amount);
  }
  return { seriesStyles: next };
}
