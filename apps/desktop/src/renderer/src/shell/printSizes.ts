/**
 * Journal print sizes — one list, read by the Export dialog's print width and by the Graph size
 * section's Print size buttons, so the two can never disagree.
 *
 * A print size never re-lays-out the graph. The graph keeps its own Width and Height; the
 * print size is how wide the whole drawing prints, scaled uniformly — text, marks, lines and
 * margins together, exactly as a "Keep proportions" panel is. Setting Width/Height instead would
 * redraw the graph at e.g. 321 px with full-size text.
 *
 * Exact requirements vary by journal; these are the usual measures, offered as a starting point
 * rather than a compliance claim.
 */

export const MM_PER_IN = 25.4;
/** Points per inch — how print sizes of text are stated. */
export const PT_PER_IN = 72;

/** Common journal figure widths (mm), for the Export dialog's print width. */
export const PRINT_WIDTHS: ReadonlyArray<{ mm: number; label: string }> = [
  { mm: 85, label: "Single column — 85 mm" },
  { mm: 89, label: "Single column (wide) — 89 mm" },
  { mm: 114, label: "1.5 column — 114 mm" },
  { mm: 174, label: "Double column — 174 mm" },
  { mm: 183, label: "Double column (wide) — 183 mm" },
];

/** Physical length (mm) → pixels at a given DPI. */
export function mmToPx(mm: number, dpi: number): number {
  return Math.max(16, Math.round((mm / MM_PER_IN) * dpi));
}

/** One Print size button. A column is a width; a page (with `hMm`) is an area the graph must fit. */
export interface GraphPrintSize {
  label: string;
  wMm: number;
  hMm?: number | undefined;
}
/** The full-page area is a common journal type area, 174 × 235 mm. */
export const GRAPH_PRINT_SIZES: ReadonlyArray<GraphPrintSize> = [
  { label: "1 column", wMm: 85 },
  { label: "1.5 column", wMm: 114 },
  { label: "2 columns", wMm: 174 },
  { label: "Page ↕", wMm: 174, hMm: 235 },
  { label: "Page ↔", wMm: 235, hMm: 174 },
];

/**
 * The print width (mm) a button gives a graph of this shape (`aspect` = width ÷ height). A column
 * is its width. A page is the widest width at which the WHOLE graph still fits the page — the
 * graph keeps its shape, so a wide graph on a tall page is limited by the width, a tall one by the
 * height. One decimal.
 */
export function printWidthFor(size: GraphPrintSize, aspect: number): number {
  const w = size.hMm === undefined ? size.wMm : Math.min(size.wMm, size.hMm * Math.max(0.01, aspect));
  return Math.round(w * 10) / 10;
}

/** The size (pt) text drawn at `px` prints at, in a graph `figurePx` wide printed `printMm` wide. */
export function printedPt(px: number, figurePx: number, printMm: number): number {
  return (px * ((printMm / MM_PER_IN) * PT_PER_IN)) / Math.max(1, figurePx);
}

/** Below this, most journals reject figure text. */
export const MIN_PRINT_PT = 6;

/** A page a figure is laid out on (mm). The journal columns come from the one list above, at the
 *  common type-area height (235 mm); A4 and Letter are the paper sizes. Portrait; the Layout
 *  group's swap button turns one landscape. */
export interface PageSize { label: string; wMm: number; hMm: number }
export const PAGE_SIZES: ReadonlyArray<PageSize> = [
  ...GRAPH_PRINT_SIZES.filter((s) => s.hMm === undefined).map((s) => ({ label: s.label, wMm: s.wMm, hMm: 235 })),
  { label: "A4", wMm: 210, hMm: 297 },
  { label: "Letter", wMm: 216, hMm: 279 },
];

/** A page's size on the canvas (px) — 96 dpi, the same convention the rulers use. */
export function pagePx(page: { wMm: number; hMm: number }): { w: number; h: number } {
  return { w: mmToPx(page.wMm, 96), h: mmToPx(page.hMm, 96) };
}
