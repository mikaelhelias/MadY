import type { AxisSpec } from "@mady/core";

/**
 * Axis tab ▸ Title direction — a vertical axis's title written at any angle, or level above its axis.
 *
 * Angles are degrees turned anticlockwise from level, as the user reads them: 0 = level, 90 = the left
 * axis's familiar turned title (reads upwards), 270 = a right axis's (reads downwards). The renderer draws
 * `translate(x y) rotate(-angle)` about the text's baseline-middle anchor.
 */

/** Glyph box above / below the baseline, in em — the builder's own `TEXT_ASCENT` / `TEXT_DESCENT`. */
const ASCENT = 1.08;
const DESCENT = 0.27;
/** `measure` under-reads; a title is treated as slightly longer than measured (as `fitTitle` does). */
const MEASURE_SLACK = 1.1;
/** A title that would need more than this share of the figure's width beside its axis is drawn turned,
 *  with a warning — the plot must not be squeezed to a sliver to make room for its own caption. */
export const TITLE_MAX_WIDTH_SHARE = 0.4;
/** A title written beside its axis at another angle breaks at spaces into lines no wider than this share of
 *  the figure (or its longest word): level, "Expression (a.u.)" at the house 22 px is already 43 % of a 580 px
 *  figure on one line, so without breaking almost every title would be refused. */
export const TITLE_WRAP_SHARE = 0.2;
/** Line spacing of a multi-line title, in em — `RichText`'s `1.2em`. */
const LINE_HEIGHT = 1.2;

export type TitleSide = "left" | "right";

/** The turn a vertical axis's title has when nobody chose one. */
export function defaultTitleAngle(side: TitleSide): number {
  return side === "left" ? 90 : 270;
}

/** Any angle as a whole degree in [0, 360). */
export function normalizeAngle(deg: number): number {
  return ((Math.round(deg) % 360) + 360) % 360;
}

/**
 * What the spec asks of a title on `side`: `undefined` when it is the default turned title (nothing to do),
 * else the angle and whether it goes above the axis. "Above" is honoured only for a level title; asked for at
 * another angle it is reported (`aboveRefused`) and the title stays beside the axis.
 */
export function requestedTurn(
  spec: Pick<AxisSpec, "titleAngle" | "titleAbove"> | undefined,
  side: TitleSide,
): { angle: number; above: boolean; aboveRefused: boolean } | undefined {
  const raw = spec?.titleAngle;
  const angle = raw != null && Number.isFinite(raw) ? normalizeAngle(raw) : defaultTitleAngle(side);
  const wantsAbove = spec?.titleAbove === true;
  const above = wantsAbove && angle === 0;
  if (angle === defaultTitleAngle(side) && !wantsAbove) return undefined;
  return { angle, above, aboveRefused: wantsAbove && !above };
}

/**
 * The ink of a title `len` px long at `size` px, turned `angle`°: half its width and height, and where its
 * baseline-middle anchor sits relative to the ink's centre. At 90° this is the default placement exactly:
 * the ink is (ascent + descent) wide and the anchor sits `descent` inside its right edge.
 */
export function turnedInk(angle: number, len: number, size: number, lines = 1): { hw: number; hh: number; ax: number; ay: number } {
  const r = (angle * Math.PI) / 180;
  const c = Math.abs(Math.cos(r));
  const s = Math.abs(Math.sin(r));
  // Lines after the first run down from the anchor's baseline (in the text's own direction).
  const extra = (lines - 1) * LINE_HEIGHT * size;
  const h = (ASCENT + DESCENT) * size + extra;
  const m = ((ASCENT - DESCENT) * size - extra) / 2;
  // The ink centre sits `m` above the baseline; turning by -angle in screen space moves it to
  // (-m sin a, -m cos a) from the anchor, so the anchor is the centre plus that vector reversed.
  return { hw: (c * len) / 2 + (s * h) / 2, hh: (s * len) / 2 + (c * h) / 2, ax: Math.sin(r) * m, ay: Math.cos(r) * m };
}

/** The title's length as the layout treats it. */
export function titleLength(title: string, size: number, measure: (text: string, px: number) => number): number {
  return measure(title, size) * MEASURE_SLACK;
}

/**
 * Break a title at spaces into lines no wider than `maxWidth` (a word longer than that keeps a line of its
 * own). Line breaks the user typed are kept as they are.
 */
export function wrapTitle(title: string, size: number, measure: (text: string, px: number) => number, maxWidth: number): string[] {
  if (title.includes("\n")) return title.split("\n");
  const words = title.split(/\s+/).filter((w) => w !== "");
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (line && titleLength(next, size, measure) > maxWidth) {
      lines.push(line);
      line = w;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [title];
}

/** A title laid out to be written beside its axis at `angle`: its lines, its longest line, and whether it is
 *  still too wide to write there (see `TITLE_MAX_WIDTH_SHARE`). */
export function besideLayout(
  title: string,
  angle: number,
  size: number,
  measure: (text: string, px: number) => number,
  canvasWidth: number,
): { lines: string[]; len: number; tooWide: boolean } {
  const lines = wrapTitle(title, size, measure, TITLE_WRAP_SHARE * canvasWidth);
  const len = Math.max(...lines.map((l) => titleLength(l, size, measure)));
  return { lines, len, tooWide: 2 * turnedInk(angle, len, size, lines.length).hw > TITLE_MAX_WIDTH_SHARE * canvasWidth };
}

/**
 * The width a right axis's title takes from the right margin — what `textBand(size, gap)` reserved for the
 * turned title, widened to the real ink when the title is turned some other way. Equal to that band for the
 * default, for "above" and for a title too wide to write beside (which is drawn turned), so a graph nobody
 * changed lays out exactly as the default does.
 */
export function rightTitleBand(
  spec: Pick<AxisSpec, "titleAngle" | "titleAbove"> | undefined,
  title: string,
  size: number,
  gap: number,
  measure: (text: string, px: number) => number,
  canvasWidth: number,
): number {
  const flat = Math.ceil((ASCENT + DESCENT) * size) + gap;
  const turn = requestedTurn(spec, "right");
  if (!turn || turn.above || !title) return flat;
  const lay = besideLayout(title, turn.angle, size, measure, canvasWidth);
  if (lay.tooWide) return flat;
  return Math.max(flat, Math.ceil(2 * turnedInk(turn.angle, lay.len, size, lay.lines.length).hw) + gap);
}

export interface TurnedTitlePlacement {
  turn: { angle: number; x: number; y: number; anchor: "start" | "middle" | "end"; text?: string | undefined };
  /** Px the title pokes past the figure's left edge (a left title) — the room a rebuild must add. */
  overflowLeft: number;
  /** Px past the right edge (a right title) — the canvas grows by this. */
  overflowRight: number;
}

/**
 * Place a title beside its axis at `angle`. `edge` is the x the ink must stay clear of: the left edge of the
 * space beside a left axis (its tick labels minus the gap), or the right edge beside a right axis.
 * `along` is the centre of the title along the axis; the ink is kept on the canvas vertically.
 */
export function placeBeside(
  side: TitleSide,
  angle: number,
  lines: readonly string[],
  len: number,
  size: number,
  edge: number,
  along: number,
  canvas: { width: number; height: number },
): TurnedTitlePlacement {
  const ink = turnedInk(angle, len, size, lines.length);
  const cx = side === "left" ? edge - ink.hw : edge + ink.hw;
  const lo = ink.hh + 2;
  const hi = canvas.height - ink.hh - 2;
  const cy = lo <= hi ? Math.min(Math.max(along, lo), hi) : canvas.height / 2;
  return {
    turn: { angle, x: round2(cx + ink.ax), y: round2(cy + ink.ay), anchor: "middle", ...(lines.length > 1 ? { text: lines.join("\n") } : {}) },
    overflowLeft: side === "left" ? Math.max(0, 2 - (cx - ink.hw)) : 0,
    overflowRight: side === "right" ? Math.max(0, cx + ink.hw + 2 - canvas.width) : 0,
  };
}

/**
 * Place a level title above the top end of its axis: starting at the tick labels' left edge over a left axis,
 * ending at their right edge over a right axis, pulled in when it would leave the figure. `baseline` is where
 * its baseline goes; `undefined` when the title is wider than the figure.
 */
export function placeAbove(
  side: TitleSide,
  len: number,
  labelsEdge: number,
  baseline: number,
  canvasWidth: number,
): TurnedTitlePlacement | undefined {
  if (len > canvasWidth - 4) return undefined;
  const turn = side === "left"
    ? { angle: 0, x: round2(Math.max(2, Math.min(labelsEdge, canvasWidth - 2 - len))), y: round2(baseline), anchor: "start" as const }
    : { angle: 0, x: round2(Math.min(canvasWidth - 2, Math.max(labelsEdge, 2 + len))), y: round2(baseline), anchor: "end" as const };
  return { turn, overflowLeft: 0, overflowRight: 0 };
}

/** The height a level title above its axis takes: its glyphs, and the gap under them. */
export function aboveBand(size: number, gap: number): number {
  return Math.ceil((ASCENT + DESCENT) * size) + gap;
}

/** Descent below the baseline, px — to put the glyph bottom (not the baseline) on a limit. */
export function titleDescent(size: number): number {
  return DESCENT * size;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
