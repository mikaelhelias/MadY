/**
 * Fit the numbers over a vertical bar chart's bars so none prints on another.
 *
 * Names on a category axis are told apart by thinning; numbers are short, so shrinking them first usually clears the
 * crowd, and a number dropped is data the reader cannot read back. So: shrink to fit down to the smallest readable
 * size, and only past that keep every k-th number. This is the rule the horizontal bars' numbers already follow
 * (`fitStackedLabels`), measured the way vertical numbers collide: by their width along the axis and their height
 * where neighbouring bars end at similar heights.
 */
import { valueLabelPlace, fmtValueLabel } from "./valueLabelPlace.js";
import type { SeriesScene } from "./scene.js";

/** Below this a number is decoration, not information (the same floor as the stacked names). */
export const MIN_READABLE_NUMBER = 7;
/** Breathing room kept between two neighbouring numbers, px. */
const GAP = 2;

export interface NumberSpot {
  /** Where the number rests at the requested size: `valueLabelPlace`'s answer is recomputed per size from this bar. */
  bar: { x: number; y: number; w: number; h: number };
  value: number;
  text: string;
}

type Box = { x1: number; x2: number; y1: number; y2: number };

/** The boxes the numbers occupy at font `size`, as the renderer rests them (centred on the bar, above or inside it). */
function boxesAt(
  spots: readonly NumberSpot[],
  size: number,
  measure: (text: string, fontPx: number) => number,
  scene: { valueLabels?: { dy: number; placement?: "above" | "insideEnd" | "insideBase" | undefined } | undefined },
  dots: ReadonlyArray<{ cx: number; cy: number; r: number }>,
): Box[] {
  const sc = { barHorizontal: false, valueLabels: scene.valueLabels, fonts: { valueLabel: { size } } };
  return spots.map((s) => {
    const p = valueLabelPlace(sc, s.bar, s.value, s.text, dots);
    const w = measure(s.text, size);
    // The text spans from 0.8 of its size above the baseline to 0.2 below (as the renderer's own placement assumes).
    return { x1: p.baseX - w / 2, x2: p.baseX + w / 2, y1: p.baseY - size * 0.8, y2: p.baseY + size * 0.2 };
  });
}

/** Does any pair of the boxes (only those `live` at that index) overlap, with `GAP` between them? */
function anyOverlap(boxes: readonly Box[], live: (i: number) => boolean): boolean {
  const order = boxes.map((_, i) => i).filter(live).sort((a, b) => boxes[a]!.x1 - boxes[b]!.x1);
  for (let a = 0; a < order.length; a++) {
    const A = boxes[order[a]!]!;
    for (let b = a + 1; b < order.length; b++) {
      const B = boxes[order[b]!]!;
      if (B.x1 >= A.x2 + GAP) break; // sorted by left edge: nothing further right can touch A
      if (B.y1 < A.y2 + 1 && A.y1 < B.y2 + 1) return true;
    }
  }
  return false;
}

/**
 * The font to draw the numbers with and, when even the smallest readable size is crowded, which of them (by index in
 * `spots`) keep their text. `keep` is `null` when every number is kept.
 */
export function fitBarNumbers(
  spots: readonly NumberSpot[],
  requested: number,
  measure: (text: string, fontPx: number) => number,
  scene: { valueLabels?: { dy: number; placement?: "above" | "insideEnd" | "insideBase" | undefined } | undefined },
  dots: ReadonlyArray<{ cx: number; cy: number; r: number }> = [],
): { font: number; keep: Set<number> | null } {
  if (spots.length <= 1) return { font: requested, keep: null };
  const clear = (size: number): boolean => !anyOverlap(boxesAt(spots, size, measure, scene, dots), () => true);
  if (clear(requested)) return { font: requested, keep: null };
  const floor = Math.min(requested, MIN_READABLE_NUMBER);
  for (let size = Math.floor(requested) - 1; size >= floor; size--) if (clear(size)) return { font: size, keep: null };
  // Too crowded even at the floor: keep every k-th number, left to right, for the smallest k that clears.
  const boxes = boxesAt(spots, floor, measure, scene, dots);
  const byX = spots.map((_, i) => i).sort((a, b) => boxes[a]!.x1 - boxes[b]!.x1);
  for (let k = 2; k <= spots.length; k++) {
    const kept = new Set<number>(byX.filter((_, r) => r % k === 0));
    if (!anyOverlap(boxes, (i) => kept.has(i)) || k === spots.length) return { font: floor, keep: kept };
  }
  return { font: floor, keep: new Set([byX[0]!]) };
}

/** The numbers of a vertical bar chart's bars, in drawing order, ready for `fitBarNumbers`. */
export function barNumberSpots(series: readonly SeriesScene[], decimals: number | undefined): { spots: NumberSpot[]; marks: SeriesScene["marks"] } {
  const spots: NumberSpot[] = [];
  const marks: SeriesScene["marks"] = [];
  for (const s of series) {
    for (const m of s.marks) {
      if (!m.bar || !Number.isFinite(m.dy) || m.valueText === "") continue;
      spots.push({ bar: m.bar, value: m.dy, text: m.valueText ?? fmtValueLabel(m.dy, decimals) });
      marks.push(m);
    }
  }
  return { spots, marks };
}
