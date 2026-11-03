/**
 * A text box's layout: the lines a label wraps into, where they are
 * drawn, and the box behind them — for a text annotation, a callout's words and a text object on the
 * figure canvas alike.
 *
 * The box is centred on the text's own point (`anchorX`), the way the point sits under the
 * middle of a plain text; `align` lines the words up inside the box, so changing alignment never moves the
 * box. A wrap width fixes the inside width; without one the box hugs the longest line. Text width is
 * the legend frame's estimate (`len × size × 0.6`) — `buildAnnotations` has no text measurer, and the
 * legend frame is the precedent. `anchorY` is the first line's baseline, as on the `<text>` itself.
 */
import { wrapLegendLabel } from "./legendBox.js";

export type TextAlign = "start" | "middle" | "end";

/** How long a line reads, in px, at `fontSize`. */
export function estimateTextWidth(text: string, fontSize: number): number {
  return text.length * fontSize * 0.6;
}

export interface TextBoxLayout {
  /** The display lines (a typed line break and every wrap). */
  lines: string[];
  /** The x every line is drawn at, with `anchor`. */
  x: number;
  anchor: TextAlign;
  /** The box behind the words (its outer edge). */
  box: { x: number; y: number; w: number; h: number; rx: number };
}

export function layoutTextBox(
  label: string,
  opts: { fontSize: number; align?: TextAlign | undefined; wrapPx?: number | undefined; padding?: number | undefined; radius?: number | undefined },
  anchorX: number,
  anchorY: number,
): TextBoxLayout {
  const fs = opts.fontSize;
  const measure = (t: string): number => estimateTextWidth(t, fs);
  const wrap = opts.wrapPx != null && opts.wrapPx > 0 ? opts.wrapPx : undefined;
  const lines = wrap != null ? wrapLegendLabel(label, wrap, measure) : label.split("\n");
  const inner = wrap ?? Math.max(0, ...lines.map(measure));
  // The callout's box padded 6 across and 4 down; a padding the user sets is both.
  const padX = opts.padding ?? 6;
  const padY = opts.padding ?? 4;
  const anchor = opts.align ?? "middle";
  const x = anchor === "start" ? anchorX - inner / 2 : anchor === "end" ? anchorX + inner / 2 : anchorX;
  return {
    lines,
    x,
    anchor,
    box: {
      x: anchorX - inner / 2 - padX,
      y: anchorY - fs * 0.85 - padY,
      w: inner + 2 * padX,
      h: lines.length * fs * 1.2 + 2 * padY,
      rx: opts.radius ?? 4,
    },
  };
}
