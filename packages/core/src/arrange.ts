/**
 * arrange.ts — a pure, DOM-free align / distribute / equalise-size engine.
 *
 * Given N axis-aligned boxes and an operation, it returns the new boxes (same
 * order). It is deliberately *unit-agnostic*: the boxes may be fractional
 * plot-space rects (annotation arrange) OR pixel rects (layout-panel
 * arrange) — the geometry is identical. All ops are idempotent and leave
 * the input untouched (a fresh array of fresh boxes is returned).
 *
 * The engine is the shared core of the "Arrange" toolbar; the callers translate
 * the box deltas back onto their own model (annotation anchors / panel
 * positions / panel sizes).
 */

/** One arrange operation. */
export type AlignOp =
  /** Align every box's LEFT edge to the group's leftmost left edge. */
  | "left"
  /** Align every box's RIGHT edge to the group's rightmost right edge. */
  | "right"
  /** Align every box's TOP edge to the group's topmost top edge. */
  | "top"
  /** Align every box's BOTTOM edge to the group's bottommost bottom edge. */
  | "bottom"
  /** Align every box's horizontal CENTRE to the group's overall centre-X (a shared vertical line). */
  | "center-x"
  /** Align every box's vertical CENTRE to the group's overall centre-Y (a shared horizontal line). */
  | "center-y"
  /** Distribute horizontally: equal GAPS between boxes (extremes fixed). Needs ≥3. */
  | "distribute-h"
  /** Distribute vertically: equal GAPS between boxes (extremes fixed). Needs ≥3. */
  | "distribute-v"
  /** Make every box the WIDTH of the widest (top-left held). */
  | "equalize-w"
  /** Make every box the HEIGHT of the tallest (top-left held). */
  | "equalize-h";

/** An axis-aligned box: top-left (`x`,`y`) + size (`w`,`h`). A zero-size box is a
 *  point (a text anchor); align/distribute treat it as a degenerate rect. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const clone = (b: Box): Box => ({ x: b.x, y: b.y, w: b.w, h: b.h });

/**
 * Apply `op` to `boxes`, returning the repositioned/resized boxes in the SAME
 * order. Fewer than 2 boxes → returned unchanged (nothing to align against);
 * distribute additionally needs ≥3 (with 2, the extremes are already the ends).
 */
export function arrangeBoxes(boxes: Box[], op: AlignOp): Box[] {
  const out = boxes.map(clone);
  if (out.length < 2) return out;

  // Group extents (union bounding box).
  const minX = Math.min(...out.map((b) => b.x));
  const maxR = Math.max(...out.map((b) => b.x + b.w));
  const minY = Math.min(...out.map((b) => b.y));
  const maxB = Math.max(...out.map((b) => b.y + b.h));

  switch (op) {
    case "left":
      for (const b of out) b.x = minX;
      return out;
    case "right":
      for (const b of out) b.x = maxR - b.w;
      return out;
    case "top":
      for (const b of out) b.y = minY;
      return out;
    case "bottom":
      for (const b of out) b.y = maxB - b.h;
      return out;
    case "center-x": {
      const c = (minX + maxR) / 2;
      for (const b of out) b.x = c - b.w / 2;
      return out;
    }
    case "center-y": {
      const c = (minY + maxB) / 2;
      for (const b of out) b.y = c - b.h / 2;
      return out;
    }
    case "distribute-h":
      return distribute(out, "h");
    case "distribute-v":
      return distribute(out, "v");
    case "equalize-w": {
      const refW = Math.max(...out.map((b) => b.w));
      for (const b of out) b.w = refW; // grow from the top-left (x held)
      return out;
    }
    case "equalize-h": {
      const refH = Math.max(...out.map((b) => b.h));
      for (const b of out) b.h = refH;
      return out;
    }
    default:
      return out; // unknown op → no-op (defensive)
  }
}

/**
 * Even-GAP distribution along one axis. The two extreme boxes stay put; the
 * leftover space (span − Σ sizes) is split into equal gaps between consecutive
 * boxes, ordered by their current position. Returns boxes in the ORIGINAL order.
 */
function distribute(boxes: Box[], axis: "h" | "v"): Box[] {
  if (boxes.length < 3) return boxes; // 2 boxes are already the two ends
  const pos = (b: Box): number => (axis === "h" ? b.x : b.y);
  const size = (b: Box): number => (axis === "h" ? b.w : b.h);
  // Sort a copy of the indices by leading edge (stable tie-break on index).
  const order = boxes.map((_, i) => i).sort((a, c) => pos(boxes[a]!) - pos(boxes[c]!) || a - c);
  const first = boxes[order[0]!]!;
  const last = boxes[order[order.length - 1]!]!;
  const spanStart = pos(first);
  const spanEnd = pos(last) + size(last);
  const totalSize = order.reduce((s, i) => s + size(boxes[i]!), 0);
  const gap = (spanEnd - spanStart - totalSize) / (order.length - 1);
  let cursor = spanStart;
  for (const i of order) {
    const b = boxes[i]!;
    if (axis === "h") b.x = cursor;
    else b.y = cursor;
    cursor += size(b) + gap;
  }
  return boxes;
}
