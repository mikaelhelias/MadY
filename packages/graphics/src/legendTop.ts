/**
 * The outside-top legend — the geometry the builder and the renderer must agree on.
 *
 * `legend.position = "top"` puts the key in a horizontal row between the title and the plot,
 * the way ggplot's `legend.position = "top"` does. Unlike an inside corner it takes real room:
 * the builder reserves a band above the plot rect (the plot gets shorter, never narrower), so
 * the reservation and the drawing have to be computed from the same numbers — the same row
 * height, the same item widths, the same wrap. Everything the two sides share lives here.
 *
 * Caution: `legendRowMetrics` mirrors the renderer's `Legend` (PlotFigure.tsx): font-derived row
 * height, symbol-coupled row height, the bar-block row, the swatch column, the 14-px item gap,
 * the 6-px default pad. Change one and change the other — `legend-top.test.ts` holds the
 * band to the rows it was reserved for.
 */
import type { LegendEntry, PlotScene } from "./scene.js";

/** Spacing between items in a horizontal legend row (px) — the renderer's `gap`. */
export const LEGEND_ITEM_GAP = 14;

export interface LegendRowMetrics {
  /** Height of one row (px), from the legend font and the biggest symbol it must hold. */
  rowH: number;
  /** Width of each entry's swatch + label (px), in `PlotScene.legend` order. */
  itemWidths: number[];
  /** Padding between the frame and the rows (px). */
  pad: number;
  /** Distance between the plot edge and the legend frame (px). */
  outGap: number;
}

/**
 * Row height and item widths for a legend block, computed the way the renderer draws it.
 * `measure` is the text measure the builder is using (a canvas measure in the app, the 0.6-em
 * estimate elsewhere) — whichever it is, the wrap is decided once with it and handed to the
 * renderer as `topRows`.
 */
export function legendRowMetrics(scene: PlotScene, measure: (text: string, fontPx: number) => number): LegendRowMetrics {
  const L = scene.legendLayout;
  const entries = scene.legend;
  const fs = scene.fonts.legend.size;
  const symMul = L.symbolScale ?? 1;
  const seriesById = new Map(scene.series.map((s) => [s.id, s] as const));
  const isBarRow = (e: LegendEntry): boolean => e.swatch === "bar";
  const baseR = (e: LegendEntry): number => {
    if (isBarRow(e)) return 4;
    const ser = e.select?.as === "series" ? seriesById.get(e.select.id) : e.select ? undefined : scene.series.find((s) => s.name === e.label);
    return ser?.symbolSize ?? e.symbolSize ?? 4;
  };
  const maxSym = Math.max(4, ...entries.map(baseR));
  const barBlockH = 1.25 * fs * symMul;
  const rowH = Math.max(fs + 6, 2 * maxSym * symMul + 6, entries.some(isBarRow) ? barBlockH + 6 : 0);
  const swatchW = L.swatchWidth ?? 18;
  return {
    rowH,
    itemWidths: entries.map((e) => swatchW + measure(e.label, fs)),
    pad: L.padding ?? 6,
    outGap: L.gap ?? 12,
  };
}

/**
 * Greedy wrap: items go into a row until the next one would not fit `maxWidth`; an item wider
 * than the whole row still gets a row of its own (a legend label is information — it is never
 * dropped or cut, see the outside-right note in `resolveLegend`). Returns entry indices per row.
 */
export function wrapLegendRows(itemWidths: readonly number[], gap: number, maxWidth: number): number[][] {
  const rows: number[][] = [];
  let row: number[] = [];
  let used = 0;
  itemWidths.forEach((w, i) => {
    const next = row.length === 0 ? w : used + gap + w;
    if (row.length > 0 && next > maxWidth) {
      rows.push(row);
      row = [];
      used = w;
    } else {
      used = next;
    }
    row.push(i);
  });
  if (row.length > 0) rows.push(row);
  return rows;
}

/** Height (px) the outside-top legend needs above the plot rect: its rows, its frame padding
 *  on both sides, and the gap between the frame and the plot. */
export function topLegendBand(rowCount: number, m: Pick<LegendRowMetrics, "rowH" | "pad" | "outGap">): number {
  if (rowCount <= 0) return 0;
  return rowCount * m.rowH + 2 * m.pad + m.outGap;
}
