/**
 * Snap-to-region: compute the fractional plot-rect box (0..1) that tightly frames a
 * selected data region of a plot — used to "snap" a highlight-box annotation to the
 * data instead of hand-dragging it.
 *
 *  - A CATEGORY selection (`rowId`) frames every series' mark in that category/column
 *    (e.g. both the up + down bars of a diverging pair, plus a same-category point).
 *  - A SERIES selection (`columnId`, no `rowId`) frames that series across all categories.
 *  - No selection frames every mark (the whole plotted data area).
 *
 * The box is the pixel bounding box of the matched marks (bar rects, else point
 * positions ± the marker radius) grown by `margin` px and clamped to the plot rect,
 * then expressed as fractions of the plot rect so it stays put on resize/zoom (the
 * same coordinate space every rect/highlight annotation uses). Pure + deterministic.
 */
import type { PlotScene } from "./scene.js";

export interface SnapBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function snapRegionBox(
  scene: PlotScene,
  sel: { columnId?: string | undefined; rowId?: string | undefined } | null,
  margin = 8,
): SnapBox | null {
  const pr = scene.plot;
  if (!pr || pr.width <= 0 || pr.height <= 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let found = false;
  const grow = (x1: number, y1: number, x2: number, y2: number): void => {
    if (!Number.isFinite(x1) || !Number.isFinite(y1) || !Number.isFinite(x2) || !Number.isFinite(y2)) return;
    minX = Math.min(minX, x1, x2);
    maxX = Math.max(maxX, x1, x2);
    minY = Math.min(minY, y1, y2);
    maxY = Math.max(maxY, y1, y2);
    found = true;
  };

  for (const s of scene.series) {
    const r = Math.max(3, s.symbolSize ?? 4);
    const seriesMatch = !sel?.columnId || s.id === sel.columnId;
    for (const m of s.marks) {
      // A category (rowId) selection wins and spans every series in that column; else
      // fall back to the series match (or everything when no selection).
      if (sel?.rowId) {
        if (m.rowId !== sel.rowId) continue;
      } else if (!seriesMatch) {
        continue;
      }
      if (m.bar) grow(m.bar.x, m.bar.y, m.bar.x + m.bar.w, m.bar.y + m.bar.h);
      else grow(m.cx - r, m.cy - r, m.cx + r, m.cy + r);
    }
  }

  if (!found) return null;
  const x1 = Math.max(pr.x, minX - margin);
  const y1 = Math.max(pr.y, minY - margin);
  const x2 = Math.min(pr.x + pr.width, maxX + margin);
  const y2 = Math.min(pr.y + pr.height, maxY + margin);
  if (x2 <= x1 || y2 <= y1) return null;
  return {
    x: (x1 - pr.x) / pr.width,
    y: (y1 - pr.y) / pr.height,
    w: (x2 - x1) / pr.width,
    h: (y2 - y1) / pr.height,
  };
}
