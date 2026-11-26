import { fitBlockHeight } from "./fitBlockSteps.js";

/** A box in pixels. */
export interface PxBox { x1: number; y1: number; x2: number; y2: number }

/** Where a fit-parameter block goes: its first line's baseline, its anchor, and what it covers there. */
export interface FitBlockSpot {
  corner: "bottom-right" | "top-right" | "top-left" | "bottom-left";
  x: number;
  y: number;
  anchor: "start" | "end";
  /** Data marks the block's box covers. */
  covered: number;
  /** Whether the fitted curve runs through the box. */
  crossesCurve: boolean;
  /** Whether a reference line (y = x, a line at a value) runs through the box. */
  crossesLine: boolean;
  /** Whether the box sits on a block already placed. */
  overBlock: boolean;
}

/** Everything a parameter block must keep off: the data marks, the curves, straight lines and the other blocks. */
export interface FitBlockSurroundings {
  marks: ReadonlyArray<{ cx: number; cy: number; r: number }>;
  curves: ReadonlyArray<ReadonlyArray<readonly [number, number]>>;
  /** Straight lines in pixels (y = x, a line at a value, a potency crosshair), each as its two ends. */
  refLines?: ReadonlyArray<readonly [readonly [number, number], readonly [number, number]]> | undefined;
  /** The boxes of the blocks already placed. */
  taken?: readonly PxBox[] | undefined;
}

/** The box the block's lines take when its first baseline is at `y` and it is anchored at `x`. */
export function fitBlockBox(lines: readonly string[], size: number, x: number, y: number, anchor: "start" | "end", measure: (t: string, px: number) => number): PxBox {
  const w = Math.max(0, ...lines.map((l) => measure(l, size)));
  const h = fitBlockHeight(lines, size);
  return { x1: anchor === "end" ? x - w : x, y1: y - size * 0.85, x2: anchor === "end" ? x : x + w, y2: y + h + size * 0.25 };
}

const discHits = (b: PxBox, cx: number, cy: number, r: number): boolean => {
  const nx = Math.max(b.x1, Math.min(cx, b.x2));
  const ny = Math.max(b.y1, Math.min(cy, b.y2));
  return (cx - nx) ** 2 + (cy - ny) ** 2 <= r * r;
};

/** Whether the segment p–q passes through the box (sampled finely enough for a drawn curve). */
const segmentHits = (b: PxBox, p: readonly [number, number], q: readonly [number, number]): boolean => {
  const n = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / 2));
  for (let i = 0; i <= n; i++) {
    const x = p[0] + ((q[0] - p[0]) * i) / n;
    const y = p[1] + ((q[1] - p[1]) * i) / n;
    if (x >= b.x1 && x <= b.x2 && y >= b.y1 && y <= b.y2) return true;
  }
  return false;
};

/** What a block's box would sit on. */
export function fitBlockConflicts(box: PxBox, around: FitBlockSurroundings): Pick<FitBlockSpot, "covered" | "crossesCurve" | "crossesLine" | "overBlock"> {
  const covered = around.marks.filter((m) => discHits(box, m.cx, m.cy, m.r)).length;
  const crossesCurve = around.curves.some((curve) => {
    for (let k = 1; k < curve.length; k++) if (segmentHits(box, curve[k - 1]!, curve[k]!)) return true;
    return false;
  });
  const crossesLine = (around.refLines ?? []).some(([p, q]) => segmentHits(box, p, q));
  const overBlock = (around.taken ?? []).some((t) => box.x1 < t.x2 && t.x1 < box.x2 && box.y1 < t.y2 && t.y1 < box.y2);
  return { covered, crossesCurve, crossesLine, overBlock };
}

/**
 * The corner of the plot a fit's parameter block takes. Bottom-right first — where fitted
 * parameters are usually printed — and it stays there whenever
 * it covers no data mark, no part of the curve and no reference line. Otherwise it moves to the first
 * fully clear corner of top-right, top-left, bottom-left. With none fully clear, the first corner clear
 * of the data and the curve (a line under the block is the lesser harm). With no corner clear of the
 * data it stays bottom-right — a move to another covered spot would change the figure without making it
 * readable — and the caller says how many marks it covers. A corner holding a block already placed is
 * taken only when every corner does.
 */
export function chooseFitBlockSpot(args: {
  lines: readonly string[];
  size: number;
  plot: { x: number; y: number; width: number; height: number };
  inset: number;
  measure: (t: string, px: number) => number;
  marks: ReadonlyArray<{ cx: number; cy: number; r: number }>;
  curve: ReadonlyArray<readonly [number, number]>;
  /** Straight reference lines in pixels (y = x, a line at a value), each as its two ends. */
  refLines?: ReadonlyArray<readonly [readonly [number, number], readonly [number, number]]> | undefined;
  /** The curves of the other fits on the graph. */
  otherCurves?: ReadonlyArray<ReadonlyArray<readonly [number, number]>> | undefined;
  /** The boxes of the blocks already placed. */
  taken?: readonly PxBox[] | undefined;
}): FitBlockSpot {
  const { lines, size, plot, inset, measure, marks, curve } = args;
  const around: FitBlockSurroundings = { marks, curves: [curve, ...(args.otherCurves ?? [])], refLines: args.refLines, taken: args.taken };
  const right = plot.x + plot.width - inset;
  const left = plot.x + inset;
  const bottomY = plot.y + plot.height - inset - fitBlockHeight(lines, size);
  const topY = plot.y + inset + size * 0.85;
  const spots: Array<Omit<FitBlockSpot, "covered" | "crossesCurve" | "crossesLine" | "overBlock">> = [
    { corner: "bottom-right", x: right, y: bottomY, anchor: "end" },
    { corner: "top-right", x: right, y: topY, anchor: "end" },
    { corner: "top-left", x: left, y: topY, anchor: "start" },
    { corner: "bottom-left", x: left, y: bottomY, anchor: "start" },
  ];
  const scored = spots.map((s) => {
    const box = fitBlockBox(lines, size, s.x, s.y, s.anchor, measure);
    return { ...s, ...fitBlockConflicts(box, around), shared: blockOverlap(box, args.taken ?? []) };
  });
  const best =
    scored.find((s) => s.covered === 0 && !s.crossesCurve && !s.crossesLine && !s.overBlock) ??
    scored.find((s) => s.covered === 0 && !s.crossesCurve && !s.overBlock) ??
    scored.find((s) => !s.overBlock) ??
    // Every corner sits on a placed block (blocks taller or wider than half the plot): the corner
    // sharing the least of its area with them, so the lines of the two blocks print over as few
    // of each other's as they can.
    scored.reduce((a, b) => (b.shared < a.shared ? b : a));
  const { shared: _shared, ...spot } = best;
  return spot;
}

/** The area the box shares with the blocks already placed, in square pixels. */
export function blockOverlap(box: PxBox, taken: readonly PxBox[]): number {
  return taken.reduce((sum, t) => {
    const w = Math.min(box.x2, t.x2) - Math.max(box.x1, t.x1);
    const h = Math.min(box.y2, t.y2) - Math.max(box.y1, t.y1);
    return sum + (w > 0 && h > 0 ? w * h : 0);
  }, 0);
}
