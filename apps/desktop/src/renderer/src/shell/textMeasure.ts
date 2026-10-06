/**
 * Canvas-backed text measurement — the real `TextMeasurer` impl,
 * injected into the DOM-free scene builder so axis margins, legend width, and
 * tick-label de-overlap use true glyph widths (not the glyph-count estimate).
 * Falls back to an estimate if a 2D context isn't available (e.g. SSR/tests).
 */
const FONT_STACK = `ui-sans-serif, system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;

let ctx: CanvasRenderingContext2D | null | undefined;

/** `family` = the CSS font stack the text is drawn in (the graph's own font), else the app's. Measuring a Georgia
 *  label in the app's sans-serif would under-read it and let widened numbers collide. */
export function measureText(text: string, fontPx: number, family?: string | null): number {
  if (ctx === undefined) ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return text.length * fontPx * 0.6;
  ctx.font = `${fontPx}px ${family ? `${family}, ${FONT_STACK}` : FONT_STACK}`;
  return ctx.measureText(text).width;
}
