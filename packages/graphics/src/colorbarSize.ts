/**
 * Size and heading of a colour bar.
 *
 * One definition, used by every builder that draws a colour bar (the XY family, the ternary plot, the
 * heatmap and the parallel plot), so the margin the builder reserves for the bar and the bar it then draws
 * cannot disagree, and one `Plot.colorbarScale` sizes them all.
 */
import type { Plot } from "@mady/core";

/** The bar's thickness at the default size, px. */
export const COLORBAR_W = 14;
/** Room beside the bar for its min/max labels and its rotated heading, px. */
export const COLORBAR_SIDE = 60;
export const COLORBAR_SCALE_MIN = 0.4;
export const COLORBAR_SCALE_MAX = 2;

/** The size multiplier in force: `plot.colorbarScale` kept inside its range, else 1. */
export function colorbarScale(plot: Pick<Plot, "colorbarScale">): number {
  const s = plot.colorbarScale;
  if (s === undefined || !Number.isFinite(s)) return 1;
  return Math.min(COLORBAR_SCALE_MAX, Math.max(COLORBAR_SCALE_MIN, s));
}

/** The bar's thickness, px; `base` is the chart's own default thickness (the parallel plot draws 12). */
export function colorbarWidth(plot: Pick<Plot, "colorbarScale">, base: number = COLORBAR_W): number {
  return Math.round(base * colorbarScale(plot) * 10) / 10;
}

/** How much wider than its default the bar is, px: what a builder adds to the room it reserved for the bar. */
export function colorbarExtraWidth(plot: Pick<Plot, "colorbarScale">, base: number = COLORBAR_W): number {
  return colorbarWidth(plot, base) - base;
}

/** The room the right margin must hold for the bar, its labels and its heading. */
export function colorbarMarginFor(plot: Pick<Plot, "colorbarScale">): number {
  return colorbarWidth(plot) + COLORBAR_SIDE;
}

/**
 * The bar's rectangle inside a plot band `[top, top + height]`: as long as the band at the default size,
 * shorter when scaled down (centred on the band), and never longer than the band.
 */
export function colorbarBarRect(plot: Pick<Plot, "colorbarScale">, x: number, top: number, height: number, base: number = COLORBAR_W): { x: number; y: number; w: number; h: number } {
  const h = Math.max(8, Math.min(height, height * colorbarScale(plot)));
  return { x, y: top + (height - h) / 2, w: colorbarWidth(plot, base), h };
}

/** The heading: none when it is switched off, else the user's words (blank = the colour column's name). */
export function colorbarHeading(plot: Pick<Plot, "colorbarTitle" | "colorbarShowTitle">, columnName: string): string {
  if (plot.colorbarShowTitle === false) return "";
  return plot.colorbarTitle?.trim() ? plot.colorbarTitle : columnName;
}
