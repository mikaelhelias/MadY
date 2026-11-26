import type { FontSpec } from "@mady/core";

/** What the shared legend of a multi-panel figure is drawn with: the panels' legend font, over which the figure's own font settings win. */
export interface FigureLegendFont {
  size: number;
  family?: string | null | undefined;
  bold?: boolean | undefined;
  italic?: boolean | undefined;
  color?: string | undefined;
}

/** The figure's own legend font (`FigureLayout.legendFont`) laid over the font the panels' legends use. */
export function figureLegendFont(panelFont: { size: number; family?: string | null | undefined }, own: FontSpec | undefined): FigureLegendFont {
  const family = own?.family ?? panelFont.family;
  return {
    size: own?.size ?? panelFont.size,
    ...(family ? { family } : {}),
    ...(own?.bold ? { bold: true } : {}),
    ...(own?.italic ? { italic: true } : {}),
    ...(own?.color ? { color: own.color } : {}),
  };
}

/** Smallest and largest key size (a multiple of the default 1). */
export const FIGURE_LEGEND_SCALE_MIN = 0.5;
export const FIGURE_LEGEND_SCALE_MAX = 2;

export function figureLegendScale(scale: number | undefined): number {
  if (scale === undefined || !Number.isFinite(scale)) return 1;
  return Math.min(FIGURE_LEGEND_SCALE_MAX, Math.max(FIGURE_LEGEND_SCALE_MIN, scale));
}

export interface FigureLegendLayout {
  /** The drawing's size, px. */
  w: number;
  h: number;
  /** Height (px) of the heading row above the keys; 0 without a heading. */
  headH: number;
  /** The keys' swatch column width and gap between entries, px, after the key size. */
  swatchW: number;
  gap: number;
  pad: number;
  /** Where each entry starts along the row, px. */
  starts: number[];
}

/**
 * Geometry of the figure's one shared legend: a centred horizontal row of keys, with an optional heading row above.
 * The key size multiplies the swatch and the gap, not the words — the words are sized by the font.
 */
export function figureLegendLayout(labels: readonly string[], fs: number, scale: number, title: string | undefined): FigureLegendLayout {
  const k = figureLegendScale(scale);
  const swatchW = 18 * k;
  const gap = 14 * k;
  const pad = 6;
  const estW = (s: string): number => s.length * fs * 0.6;
  const starts: number[] = [];
  let acc = pad;
  for (const l of labels) {
    starts.push(acc);
    acc += swatchW + estW(l) + gap;
  }
  const rowsW = Math.max(0, acc - gap - pad);
  const headH = title ? Math.round(fs * 1.5) : 0;
  const headW = title ? title.length * fs * 0.66 : 0;
  const w = Math.max(1, Math.max(rowsW, headW) + pad * 2);
  const h = headH + Math.max(fs, 12 * k) + 6 + pad * 2;
  return { w, h, headH, swatchW, gap, pad, starts };
}
