/**
 * Startup fit — how big an unsized figure should be drawn, given the space available.
 *
 * A graph with no `figureWidth`/`figureHeight` otherwise draws at a hard-coded 580 × 380
 * no matter how much room there is: in a medium window that fills about half of the document
 * column, and on a 1920 × 1080 screen under a fifth of it.
 *
 * Three rules, and each one is a deliberate refusal to do something more clever:
 *
 * 1. **Measured once, at startup.** Re-fitting on every window resize would leave figures
 *    reflowing under the cursor while an edge is dragged, which is worse than wasting the
 *    space. So this takes an already-measured number; nothing here listens to anything.
 * 2. **Uniform scale — the box keeps its proportions exactly.** Both sides multiply by the
 *    same `k`, so a fitted figure is the same shape as an unfitted one, never stretched to
 *    fill. (Fonts and margins are fixed px, so the plot area grows faster than the figure —
 *    that is the point: more room for data at an unchanged, readable type size.)
 * 3. **Never smaller than the default.** Below 1× the figure is too small to read, and the
 *    pane already scrolls. Shrinking would trade wasted space for an unusable graph.
 *
 * Note: this never writes to a document. It is a fallback used at render time where no explicit
 * size exists, so it cannot dirty a file, cannot enter the undo stack, and is undone by
 * turning the preference off (or by giving the figure a size of its own, which always wins).
 */

/** The renderer's built-in figure size — the shape a fitted figure keeps. */
export const FIGURE_DEFAULT_W = 580;
export const FIGURE_DEFAULT_H = 380;

/**
 * Ceiling on the scale. An unclamped fit reaches 2.26× on a
 * 1920 × 1080 screen, which is a fine thing to look at but makes the default export size grow
 * with the monitor it happened to be created on. 1.6× is generous on screen without that.
 */
export const FIGURE_FIT_MAX_SCALE = 1.6;

/** Breathing room kept between the figure and the edges of its column, px. */
export const FIGURE_FIT_PAD = 28;

export interface FigureSize {
  width: number;
  height: number;
}

/**
 * The size to draw an unsized figure at, or `null` for "leave it at the default".
 *
 * `null` rather than the default size on purpose: the caller then omits the width/height
 * options entirely and the renderer's own defaults apply, so there is exactly one place that
 * decides what 580 × 380 means.
 */
export function fitFigureSize(availWidth: number, availHeight: number): FigureSize | null {
  if (!Number.isFinite(availWidth) || !Number.isFinite(availHeight)) return null;
  const w = availWidth - FIGURE_FIT_PAD;
  const h = availHeight - FIGURE_FIT_PAD;
  if (w <= 0 || h <= 0) return null;
  const k = Math.min(w / FIGURE_DEFAULT_W, h / FIGURE_DEFAULT_H, FIGURE_FIT_MAX_SCALE);
  // Only ever scale up. `k <= 1` means the column is no roomier than the default.
  if (!(k > 1)) return null;
  return { width: Math.round(FIGURE_DEFAULT_W * k), height: Math.round(FIGURE_DEFAULT_H * k) };
}
