import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { probeRows } from "./edgePin";
import { scenePaletteOpt } from "./scenePalette";

/**
 * The colour each series is drawn in, by series id, read from the drawing with the graph's own palette.
 *
 * The panel's swatches and Colour rows show these, so they say what the graph shows. A series without a colour of its
 * own takes the colour of its place in the drawing, which is not always its place in the sheet (a swimmer colours its
 * event series among the events, after the columns that draw the lanes), and the palette is the graph's, which Colour
 * scheme ▸ Palette changes. Drawn from the first rows (`probeRows`): a series' colour does not depend on how many rows
 * it has, and the panel asks on every render. Empty rather than throwing: a panel must never take the figure down
 * with it.
 */
export function drawnSeriesColours(table: DataTable, plot: Plot): Map<string, string> {
  try {
    const scene = buildPlotScene(probeRows(table), plot, { width: 620, height: 420, ...scenePaletteOpt(plot) });
    return new Map(scene.series.map((s) => [s.id, s.color] as const));
  } catch {
    return new Map();
  }
}

/**
 * The series a graph draws, in drawing order, for a list of them: id, a name made unique (a dendrogram's branches are
 * all "Cluster": "Cluster 1", "Cluster 2", …) and the colour drawn with the graph's palette. For graphs whose series
 * are not the sheet's columns (ordination groups and loadings, scree lines, dendrogram branches). Drawn from the whole
 * sheet: a dendrogram's branches depend on every row.
 */
export function drawnSeriesList(table: DataTable, plot: Plot): { id: string; name: string; color: string }[] {
  const ser = buildPlotScene(table, plot, scenePaletteOpt(plot)).series;
  const count = new Map<string, number>();
  for (const x of ser) count.set(x.name, (count.get(x.name) ?? 0) + 1);
  const nth = new Map<string, number>();
  return ser.map((x) => {
    const k = (nth.get(x.name) ?? 0) + 1;
    nth.set(x.name, k);
    return { id: x.id, name: (count.get(x.name) ?? 0) > 1 ? `${x.name} ${k}` : x.name, color: x.color };
  });
}
