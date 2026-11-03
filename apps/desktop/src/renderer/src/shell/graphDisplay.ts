/**
 * How big a graph is shown: a uniform scale of the whole drawing, never a re-layout.
 *
 * Resizing keeps proportions. Re-laying the graph out at the new size, with its
 * text, markers and legend at their fixed px sizes, would not give a smaller copy: the legend would take more and
 * more of the width as the graph shrinks, until the plot almost vanishes. Instead a graph is laid out
 * at its own size (`figureWidth` × `figureHeight`, or 580 × 380) and shown at `displayScale` × that — every resize
 * (the corner, the Graph size box, the window fit) changes only the scale. Print size and the panels'
 * Keep proportions follow the same rule; the drawing is scaled through the renderer's `zoom`, exactly as a miniature is.
 */
import type { Plot } from "@mady/core";
import { FIGURE_DEFAULT_H, FIGURE_DEFAULT_W, type FigureSize } from "./figureFit";

/** The scale range — the view zoom's own limits. */
export const DISPLAY_SCALE_MIN = 0.25;
export const DISPLAY_SCALE_MAX = 4;

/** The size a graph is laid out at: its own, or the renderer's default. */
export function graphLayoutSize(plot: Pick<Plot, "figureWidth" | "figureHeight">): FigureSize {
  return { width: plot.figureWidth ?? FIGURE_DEFAULT_W, height: plot.figureHeight ?? FIGURE_DEFAULT_H };
}

/**
 * The scale a graph is shown at. The user's own scale wins; a graph with no size and no scale of its own takes the
 * window fit (a uniform scale of the default layout, not a bigger layout); otherwise 1.
 */
export function graphDisplayScale(plot: Pick<Plot, "figureWidth" | "figureHeight" | "displayScale">, fit?: FigureSize | null): number {
  if (plot.displayScale != null && Number.isFinite(plot.displayScale)) return clampScale(plot.displayScale);
  if (fit && plot.figureWidth == null && plot.figureHeight == null) return clampScale(fit.width / FIGURE_DEFAULT_W);
  return 1;
}

/**
 * The scale a resize gesture asks for. `patch` is where the dragged edge now is, in the drawing's own units (the
 * figure handles report it through the drawing's coordinate transform, so the current scale is already divided out):
 * the new scale is the old one times how far the edge moved relative to the drawing. A corner follows whichever edge
 * moved further, so the graph grows to the pointer and keeps its shape.
 */
export function scaleForResize(current: number, drawing: FigureSize, patch: { figureWidth?: number; figureHeight?: number }): number {
  const rw = patch.figureWidth != null && drawing.width > 0 ? patch.figureWidth / drawing.width : undefined;
  const rh = patch.figureHeight != null && drawing.height > 0 ? patch.figureHeight / drawing.height : undefined;
  const r = rw != null && rh != null ? (Math.abs(rw - 1) >= Math.abs(rh - 1) ? rw : rh) : rw ?? rh ?? 1;
  return clampScale(current * r);
}

/** How far (as a share of the size at the press) the pointer must move before a corner drag picks its direction. */
const CORNER_LOCK = 0.02;

/**
 * The scale a corner drag asks for — one direction for the whole drag. `scaleForResize` alone
 * re-picks the edge on every move, relative to the size just drawn, so a pointer moving steadily inward but not along
 * the diagonal would flip between following x and y: the graph would flicker bigger and smaller and the drop would
 * depend on which the last event followed. Here the direction is picked once, when the pointer has moved `CORNER_LOCK` from the press —
 * whichever moved further — and `drag.axis` keeps it until the release (the caller makes a fresh `drag` per press).
 * Until then the graph holds still. An edge grip (one of the two sizes) is not a corner and goes through
 * `scaleForResize`.
 */
export function cornerResize(
  drag: { start: number; axis: "w" | "h" | null },
  current: number,
  drawing: FigureSize,
  patch: { figureWidth?: number; figureHeight?: number },
): number {
  if (patch.figureWidth == null || patch.figureHeight == null || drawing.width <= 0 || drawing.height <= 0) return scaleForResize(current, drawing, patch);
  const byW = (current * patch.figureWidth) / drawing.width;
  const byH = (current * patch.figureHeight) / drawing.height;
  if (!drag.axis) {
    const dW = Math.abs(byW / drag.start - 1);
    const dH = Math.abs(byH / drag.start - 1);
    if (Math.max(dW, dH) < CORNER_LOCK) return clampScale(drag.start);
    drag.axis = dW >= dH ? "w" : "h";
  }
  return clampScale(drag.axis === "w" ? byW : byH);
}

function clampScale(k: number): number {
  return Math.min(DISPLAY_SCALE_MAX, Math.max(DISPLAY_SCALE_MIN, k));
}
