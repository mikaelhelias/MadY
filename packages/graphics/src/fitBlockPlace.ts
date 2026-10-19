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

/**
 * The corner of the plot a fit's parameter block takes. Bottom-right first — where fitted
 * parameters are usually printed — and it stays there whenever
 * it covers no data mark, no part of the curve and no reference line. Otherwise it moves to the first
 * fully clear corner of top-right, top-left, bottom-left. With none fully clear, the first corner clear
 * of the data and the curve (a line under the block is the lesser harm). With no corner clear of the
 * data it stays bottom-right — a move to another covered spot would change the figure without making it
 * readable — and the caller says how many marks it covers.
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
}): FitBlockSpot {
  const { lines, size, plot, inset, measure, marks, curve } = args;
  const right = plot.x + plot.width - inset;
  const left = plot.x + inset;
  const bottomY = plot.y + plot.height - inset - fitBlockHeight(lines, size);
  const topY = plot.y + inset + size * 0.85;
  const spots: Array<Omit<FitBlockSpot, "covered" | "crossesCurve" | "crossesLine">> = [
    { corner: "bottom-right", x: right, y: bottomY, anchor: "end" },
    { corner: "top-right", x: right, y: topY, anchor: "end" },
    { corner: "top-left", x: left, y: topY, anchor: "start" },
    { corner: "bottom-left", x: left, y: bottomY, anchor: "start" },
  ];
  const scored = spots.map((s) => {
    const box = fitBlockBox(lines, size, s.x, s.y, s.anchor, measure);
    const covered = marks.filter((m) => discHits(box, m.cx, m.cy, m.r)).length;
    let crossesCurve = false;
    for (let k = 1; k < curve.length && !crossesCurve; k++) crossesCurve = segmentHits(box, curve[k - 1]!, curve[k]!);
    const crossesLine = (args.refLines ?? []).some(([p, q]) => segmentHits(box, p, q));
    return { ...s, covered, crossesCurve, crossesLine };
  });
  return (
    scored.find((s) => s.covered === 0 && !s.crossesCurve && !s.crossesLine) ??
    scored.find((s) => s.covered === 0 && !s.crossesCurve) ??
    scored[0]!
  );
}
