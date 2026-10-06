/**
 * Where an X-axis tick label is drawn, and the outline it covers, at any label rotation.
 *
 * One formula. The renderer (PlotFigure.tsx) draws the labels with it, and the layout (`buildScene`)
 * reads the same outline to make room below them: the group-name row, the axis title, the outer group
 * row and the number-at-risk table all sit past its lowest point.
 *
 * A positive turn starts at the tick and runs down to the right, a negative one ends at the tick
 * coming up from the lower left, and both are centred across their tick. A label that ended at its
 * tick whichever way it turned would run up into the plot at +45° and +90°; and without room for the
 * length a rotated label hangs down, −45° and −90° would run off the bottom of the figure and under
 * the axis title.
 *
 * A horizontal label keeps the renderer's default position.
 *
 * The same two formulas serve the second value axis: along the top of a horizontal chart (X2) and down the right of
 * a vertical one (Y2, and Y3 beyond it) — the mirror image. Those axes offer "Label rotation" too, so their labels
 * must turn by the same rule.
 */

/** Half the thickness of a line of text, as a multiple of the font (glyphs 0.8 above the baseline, 0.2 below, and a little air). */
const HALF = 0.55;
/** How far the baseline sits below the middle of the glyphs, as a multiple of the font. */
const MID = 0.32;
/** A horizontal label's glyph tops sit this far below `axis + gap`, as a multiple of the font; a rotated label starts there too. */
const TOP = 0.25;
/** The builder's text band for a horizontal line (ascent 1.08 + descent 0.27). */
const FLAT_BAND = 1.08 + 0.27;

export interface XTickLabelPlacement {
  /** The text's x / y attributes (y is the baseline). */
  x: number;
  y: number;
  anchor: "start" | "middle" | "end";
  /** Centre of `rotate(θ px py)`; absent for a horizontal label. */
  pivot?: { x: number; y: number } | undefined;
  /** Upright box around the drawn label, in figure pixels. */
  box: { x1: number; y1: number; x2: number; y2: number };
}

/**
 * @param pos      the tick's x
 * @param axisY    bottom: the plot's bottom edge. top: where the ticks end above the plot (a horizontal label's
 *                 baseline sits `gap` above it, the top axis's default position)
 * @param font     the tick font size
 * @param gap      the label gap (`axisGaps.xTick`)
 * @param rotation degrees, as stored in `tickRotation` (positive turns clockwise)
 * @param width    the label's text width; only the outline depends on it
 * @param side     "bottom" (the X axis) or "top" (the second value axis of a horizontal chart)
 */
export function xTickLabelPlacement(pos: number, axisY: number, font: number, gap: number, rotation: number, width = 0, side: "bottom" | "top" = "bottom"): XTickLabelPlacement {
  if (side === "top") {
    const base = axisY - gap;
    if (!rotation) {
      return { x: pos, y: base, anchor: "middle", box: { x1: pos - width / 2, x2: pos + width / 2, y1: base - 1.08 * font, y2: base + 0.27 * font } };
    }
    const a = (Math.abs(rotation) * Math.PI) / 180;
    const s = Math.sin(a);
    const c = Math.cos(a);
    const half = HALF * font;
    // The mirror of the bottom axis: the label's corner nearest the axis sits on a horizontal label's baseline, and
    // the text rises away from the plot — a positive turn ends at its tick coming down from the upper left, a
    // negative one starts at its tick and runs up to the right.
    const py = base - half * c;
    const y1 = py - width * s - half * c;
    const along = width * c;
    const across = half * s;
    return {
      x: pos,
      y: py + MID * font,
      anchor: rotation > 0 ? "end" : "start",
      pivot: { x: pos, y: py },
      box: rotation > 0
        ? { x1: pos - along - across, x2: pos + across, y1, y2: base }
        : { x1: pos - across, x2: pos + along + across, y1, y2: base },
    };
  }
  if (!rotation) {
    const y = axisY + font + gap;
    const half = FLAT_BAND * font * 0.5;
    return { x: pos, y, anchor: "middle", box: { x1: pos - width / 2, x2: pos + width / 2, y1: y - half, y2: y + half } };
  }
  const a = (Math.abs(rotation) * Math.PI) / 180;
  const s = Math.sin(a);
  const c = Math.cos(a);
  const half = HALF * font;
  // The line through the middle of the glyphs passes through the pivot, so the label's upper corner is
  // `half` above it (times cos) — placed where a horizontal label's glyph tops are.
  const py = axisY + gap + font * TOP + half * c;
  const y1 = py - half * c;
  const y2 = py + width * s + half * c;
  const along = width * c;
  const across = half * s;
  return {
    x: pos,
    y: py + MID * font,
    anchor: rotation > 0 ? "start" : "end",
    pivot: { x: pos, y: py },
    box: rotation > 0
      ? { x1: pos - across, x2: pos + along + across, y1, y2 }
      : { x1: pos - along - across, x2: pos + across, y1, y2 },
  };
}

/**
 * Where a Y-axis tick label is drawn, and its outline — the Y twin of `xTickLabelPlacement`, used by every
 * renderer site that draws Y labels and by the layout (title, corner and edge rules, crowded names).
 *
 * Nothing reaches right of the label gap: a (near-)vertical label is centred on its tick, a slanted one
 * ends at its tick and runs away from the plot. A label that ended at the gap whichever way it turned
 * would lean across the axis into the plot at +45° / +90°, and at ±90° would run along the axis from its
 * tick instead of sitting on it, so the bottom name would hang into the X axis numbers.
 *
 * A horizontal label keeps the renderer's default position.
 *
 * @param pos      the tick's y
 * @param axisX    left: the plot's left edge. right: the right-hand axis line (the plot's right edge for Y2, `axisX`
 *                 for Y3)
 * @param font     the tick font size
 * @param gap      the label gap (`axisGaps.yTick`)
 * @param rotation degrees, as stored in `tickRotation` (positive turns clockwise)
 * @param width    the label's text width; only the outline depends on it
 * @param side     "left" (the Y axis) or "right" (Y2 / Y3) — the mirror image: nothing reaches left of the gap
 */
export function yTickLabelPlacement(pos: number, axisX: number, font: number, gap: number, rotation: number, width = 0, side: "left" | "right" = "left"): XTickLabelPlacement {
  if (side === "right") {
    const left = axisX + gap;
    if (!rotation) {
      const y = pos + font * 0.34;
      const half = FLAT_BAND * font * 0.5;
      return { x: left, y, anchor: "start", box: { x1: left, x2: left + width, y1: y - half, y2: y + half } };
    }
    const a = (Math.abs(rotation) * Math.PI) / 180;
    const s = Math.sin(a);
    const c = Math.cos(a);
    const half = HALF * font;
    if (Math.abs(rotation) >= 80) {
      // Centred on the tick: the text runs half its length each way along the axis.
      const reach = (width / 2) * c + half * s;
      const px = left + reach;
      return {
        x: px, y: pos + MID * font, anchor: "middle", pivot: { x: px, y: pos },
        box: { x1: left, x2: px + reach, y1: pos - (width / 2) * s - half * c, y2: pos + (width / 2) * s + half * c },
      };
    }
    // Starts at its tick: +θ runs down and away to the right, −θ up and away to the right.
    const px = left + half * s;
    const x2 = px + width * c + half * s;
    return {
      x: px, y: pos + MID * font, anchor: "start", pivot: { x: px, y: pos },
      box: rotation > 0
        ? { x1: left, x2, y1: pos - half * c, y2: pos + width * s + half * c }
        : { x1: left, x2, y1: pos - width * s - half * c, y2: pos + half * c },
    };
  }
  const right = axisX - gap;
  if (!rotation) {
    const y = pos + font * 0.34;
    const half = FLAT_BAND * font * 0.5;
    return { x: right, y, anchor: "end", box: { x1: right - width, x2: right, y1: y - half, y2: y + half } };
  }
  const a = (Math.abs(rotation) * Math.PI) / 180;
  const s = Math.sin(a);
  const c = Math.cos(a);
  const half = HALF * font;
  if (Math.abs(rotation) >= 80) {
    // Centred on the tick: the text runs half its length each way along the axis.
    const reach = (width / 2) * c + half * s;
    const px = right - reach;
    return {
      x: px, y: pos + MID * font, anchor: "middle", pivot: { x: px, y: pos },
      box: { x1: px - reach, x2: right, y1: pos - (width / 2) * s - half * c, y2: pos + (width / 2) * s + half * c },
    };
  }
  // Ends at its tick: +θ runs up and away to the left, −θ down and away to the left.
  const px = right - half * s;
  const x1 = px - width * c - half * s;
  return {
    x: px, y: pos + MID * font, anchor: "end", pivot: { x: px, y: pos },
    box: rotation > 0
      ? { x1, x2: right, y1: pos - width * s - half * c, y2: pos + half * c }
      : { x1, x2: right, y1: pos - half * c, y2: pos + width * s + half * c },
  };
}
