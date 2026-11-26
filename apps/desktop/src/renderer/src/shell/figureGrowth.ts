/**
 * The drawing grows to what is on it.
 *
 * On a busy graph, equations and other text can be moved outside the plot: the size of the
 * overall drawing adjusts to include them, and exports capture them.
 *
 * The figure keeps its own size — the corner grip still sets it, and the plot inside does not
 * shrink. What changes is the visible area: anything dragged past the figure's edge (a fit's
 * parameter line, a legend, a title) widens or heightens the drawing to include it, on screen
 * and — through the same `drawnBounds` measurement — in every export.
 *
 * Done on the rendered `<svg>` rather than in each figure component, so every
 * chart kind grows the same way from one place. Only the viewBox and the width/height attributes
 * change: pointer handling converts through ratios or the SVG's own transform, which both follow a
 * grown viewBox.
 */
import { drawnBounds } from "./exporters";

/** Grow (or shrink back) `svg` so its visible area is its figure box plus everything drawn.
 *  Returns the visible box it set. */
export function growFigureToDrawing(
  svg: SVGSVGElement,
  figureW: number,
  figureH: number,
  zoom: number,
): { x: number; y: number; w: number; h: number } {
  svg.setAttribute("data-figure-w", String(figureW));
  svg.setAttribute("data-figure-h", String(figureH));
  const m = drawnBounds(svg, { x: 0, y: 0, w: figureW, h: figureH });
  // The measurement adds a 1px bleed on every side for the export's anti-aliasing. A figure whose
  // backdrop simply fills its box would then grow 1-2px on screen for nothing, so a side moves only
  // when something is drawn past it by more than that bleed.
  const BLEED = 1;
  const x0 = m.x < -BLEED ? m.x : 0;
  const y0 = m.y < -BLEED ? m.y : 0;
  const x1 = m.x + m.w > figureW + BLEED ? m.x + m.w : figureW;
  const y1 = m.y + m.h > figureH + BLEED ? m.y + m.h : figureH;
  const b = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  svg.setAttribute("viewBox", `${b.x} ${b.y} ${b.w} ${b.h}`);
  svg.setAttribute("width", String(b.w * zoom));
  svg.setAttribute("height", String(b.h * zoom));
  return b;
}

/**
 * While a resize grip is held, the page keeps its height. With the graph's pane scrolled down,
 * shrinking the graph could make the page shorter than the pane; the browser would then snap the scroll back to 0 and the
 * graph would jump down by the scrolled distance under the held corner — dropping the corner somewhere the pointer never was. Holding the
 * host's height for the drag leaves the scroll nothing to give back; the release lets go. `onEnd` tells the caller the
 * resize drag is over (its per-drag state, `cornerResize`'s direction, starts fresh on the next press).
 *
 * Capture phase and a `window` release, for the reasons `unclipWhileDragging` below gives.
 */
export function holdHeightWhileResizing(host: HTMLElement, onEnd: () => void): () => void {
  let held = false;
  const down = (e: Event): void => {
    if (!(e.target instanceof Element) || !e.target.closest(".gfx-figresize")) return;
    host.style.minHeight = `${host.offsetHeight}px`;
    held = true;
  };
  const up = (): void => {
    if (!held) return;
    held = false;
    host.style.minHeight = "";
    onEnd();
  };
  host.addEventListener("pointerdown", down, true);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);
  return () => {
    host.removeEventListener("pointerdown", down, true);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
  };
}

/**
 * While a drag is in progress, the figure may draw past its own edge.
 *
 * `growFigureToDrawing` runs when the graph view re-renders, and a drag only re-renders the thing
 * being dragged — so between pressing and letting go the drawing never grows, and an `<svg>` hides
 * everything outside its viewBox. Without this, a legend dragged past the right edge would be
 * invisible for the whole drag and reappear, with the drawing widened, only on release.
 *
 * So the clip is lifted for the duration of the press. Growing the viewBox live instead would be the
 * other cure, and is worse: the drawing scales to fit the pane, so the item would slide away from the
 * cursor as it grew.
 *
 * Note: capture phase. Every drag handler in `PlotFigure` calls `stopPropagation()` on its
 * `pointerdown` so the press doesn't also pan the plot — a bubbling listener here would never hear
 * the drags this exists for. The release is heard on `window`, because the pointer is usually well
 * outside the figure (often outside the pane) by then.
 */
export function unclipWhileDragging(host: HTMLElement): () => void {
  const setOverflow = (v: string): void => {
    const svg = host.querySelector<SVGSVGElement>("svg.gfx-figure");
    if (svg) svg.style.overflow = v;
  };
  const down = (): void => setOverflow("visible");
  const up = (): void => setOverflow(""); // back to the `<svg>` default, which is `hidden`
  host.addEventListener("pointerdown", down, true);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);
  return () => {
    host.removeEventListener("pointerdown", down, true);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
  };
}
