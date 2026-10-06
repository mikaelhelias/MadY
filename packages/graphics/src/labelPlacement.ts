/**
 * Label placement — the rule that a drawn label may not sit on top of anything else.
 *
 * A label must not collide with data points, an axis, the legend, or any other text (the
 * triplot card is a typical crowded case).
 *
 * A label names something, so it has to sit near its subject; that is the only reason it can
 * collide with anything at all. This picks the nearest place around the subject where the
 * label's box is clear of everything it was given, and prefers the smallest move — so in an
 * uncrowded figure every label stays at its natural spot.
 *
 * It never drops a label. A hidden label loses information silently, which is worse than a
 * crowded one; when nothing is clear it returns the least-bad placement
 * and says so in `crowded`, and the caller can warn.
 *
 * Note: it is deliberately geometric and caller-driven: the caller says what the obstacles are
 * (marks, arrows, the legend, the plot frame), because only the builder knows what it drew.
 */

/** A rectangle in scene pixels. */
export interface LabelRect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** One label to place: its text, and the point it names. */
export interface LabelToPlace {
  id: string;
  text: string;
  /** The subject's position — the label is placed around this. */
  anchorX: number;
  anchorY: number;
  /** Which side to try first; "auto" reads the anchor's side of the plot. */
  prefer?: "left" | "right" | "auto" | undefined;
  /** The subject's direction (an arrow's, tip minus tail — any length): the first candidates
   *  are beyond the anchor along it, where an arrow's name belongs. Undefined = a point. */
  dir?: { dx: number; dy: number } | undefined;
}

/** Where a label ended up. `anchor` is the SVG text-anchor its x refers to. */
export interface PlacedLabel {
  x: number;
  y: number;
  anchor: "start" | "end";
  /** True when nothing was clear and this is the least-bad spot (the caller may warn). */
  crowded: boolean;
}

export interface PlaceOptions {
  fontPx: number;
  measure: (text: string, fontPx: number) => number;
  /** The label must stay inside this — pass the plot rect to keep text off the axes. */
  bounds: LabelRect;
  /** Everything the label must not touch: marks, arrow segments, the legend, other chrome. */
  obstacles: readonly LabelRect[];
  /** Gap in px between a label box and anything else. Default 3. */
  pad?: number | undefined;
}

/** `measure` under-reads non-Latin text, so every box is widened a little (the network
 *  graph's label deconfliction uses the same 1.15 and for the same reason). */
const SAFETY = 1.15;

const overlaps = (a: LabelRect, b: LabelRect, pad: number): boolean =>
  a.x1 < b.x2 + pad && b.x1 < a.x2 + pad && a.y1 < b.y2 + pad && b.y1 < a.y2 + pad;

const inside = (a: LabelRect, b: LabelRect): boolean =>
  a.x1 >= b.x1 && a.x2 <= b.x2 && a.y1 >= b.y1 && a.y2 <= b.y2;

/** A line segment as a chain of small boxes — enough for an arrow to push a label aside. */
export function segmentObstacles(x1: number, y1: number, x2: number, y2: number, thickness = 4): LabelRect[] {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const steps = Math.max(2, Math.min(40, Math.ceil(len / 8)));
  const h = thickness / 2;
  const out: LabelRect[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = x1 + (x2 - x1) * t;
    const y = y1 + (y2 - y1) * t;
    out.push({ x1: x - h, y1: y - h, x2: x + h, y2: y + h });
  }
  return out;
}

/**
 * A quadratic curve as a chain of boxes — a network's edges are drawn curved, and a label
 * that clears the straight line between two nodes can still sit right on the arc.
 */
export function curveObstacles(
  x1: number, y1: number, cx: number, cy: number, x2: number, y2: number, thickness = 4,
): LabelRect[] {
  const steps = 24;
  const h = thickness / 2;
  const out: LabelRect[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    const x = u * u * x1 + 2 * u * t * cx + t * t * x2;
    const y = u * u * y1 + 2 * u * t * cy + t * t * y2;
    out.push({ x1: x - h, y1: y - h, x2: x + h, y2: y + h });
  }
  return out;
}

/**
 * A leader line — the thin line from a label back to the thing it names.
 *
 * The placement rule buys legibility by moving a label, and in a crowded corner it can move it
 * far enough that which name goes with which point stops being obvious. A leader restores that
 * for free, and only where it is needed: near labels get none, because a line to a name already
 * beside its point is pure clutter.
 *
 * Returns null when the label is close enough to read without one. The segment stops at the
 * subject's radius and at the label's box, so it touches neither the mark nor the glyphs.
 */
export function leaderFor(
  anchorX: number,
  anchorY: number,
  box: LabelRect,
  radius: number,
  minGap: number,
): { x1: number; y1: number; x2: number; y2: number } | null {
  // The nearest point of the label box to the subject.
  const nx = Math.max(box.x1, Math.min(anchorX, box.x2));
  const ny = Math.max(box.y1, Math.min(anchorY, box.y2));
  const dx = nx - anchorX;
  const dy = ny - anchorY;
  const gap = Math.hypot(dx, dy);
  if (gap <= minGap) return null;            // already beside its point — a line would be noise
  const ux = dx / gap;
  const uy = dy / gap;
  // start just outside the mark, stop just short of the text
  const startAt = radius + 1;
  const endAt = Math.max(startAt, gap - 1.5);
  if (endAt <= startAt) return null;
  return { x1: anchorX + ux * startAt, y1: anchorY + uy * startAt, x2: anchorX + ux * endAt, y2: anchorY + uy * endAt };
}

/** The box a placed label occupies — the same geometry the placer used. */
export function placedBox(
  p: { x: number; y: number; anchor: "start" | "end" },
  text: string,
  fontPx: number,
  measure: (t: string, px: number) => number,
): LabelRect {
  const w = measure(text, fontPx) * SAFETY;
  return {
    x1: p.anchor === "end" ? p.x - w : p.x,
    y1: p.y - fontPx * 0.6,
    x2: p.anchor === "end" ? p.x : p.x + w,
    y2: p.y + fontPx * 0.6,
  };
}

/** A drawn mark as an obstacle box. */
export function discObstacle(cx: number, cy: number, r: number): LabelRect {
  return { x1: cx - r, y1: cy - r, x2: cx + r, y2: cy + r };
}

/**
 * Place every label clear of the obstacles and of each other.
 *
 * Labels are placed in the order given, so the caller should pass the ones that matter most
 * (or are hardest to place — the longest) first: the first label gets the best spot.
 */
export function placeLabelsClear(
  labels: readonly LabelToPlace[],
  opts: PlaceOptions,
): Map<string, PlacedLabel> {
  const { fontPx, measure, bounds } = opts;
  const pad = opts.pad ?? 3;
  const half = fontPx * 0.6;          // half the text's line box
  const gap = Math.max(4, fontPx * 0.5);
  const out = new Map<string, PlacedLabel>();
  const taken: LabelRect[] = [];

  /**
   * Candidate offsets, in preference order: beside the point first (that is where a reader
   * looks), then above and below, then the diagonals, then further out. `sx` is the side, so
   * the box is mirrored rather than the anchor moved.
   */
  const RING: { dx: number; dy: number; side: "start" | "end" }[] = [];
  // The far radii exist for one case: the subject itself sits under something big (a point
  // beneath the legend). A label 60px from its point is poor, but a label printed across the
  // legend is wrong — and `crowded` tells the builder which happened.
  for (const r of [1, 1.8, 2.8, 4, 6, 9, 13]) {
    RING.push(
      { dx: gap * r, dy: 0, side: "start" },
      { dx: -gap * r, dy: 0, side: "end" },
      { dx: 0, dy: -gap * r * 1.2, side: "start" },
      { dx: 0, dy: gap * r * 1.2, side: "start" },
      { dx: gap * r, dy: -gap * r, side: "start" },
      { dx: -gap * r, dy: -gap * r, side: "end" },
      { dx: gap * r, dy: gap * r, side: "start" },
      { dx: -gap * r, dy: gap * r, side: "end" },
    );
  }

  for (const l of labels) {
    const w = measure(l.text, fontPx) * SAFETY;
    const boxFor = (x: number, y: number, side: "start" | "end"): LabelRect => ({
      x1: side === "end" ? x - w : x,
      y1: y - half,
      x2: side === "end" ? x : x + w,
      y2: y + half,
    });
    // "auto": a point on the right half of the plot puts its label to the left, so long names
    // near the edge do not run off it.
    const midX = (bounds.x1 + bounds.x2) / 2;
    const preferLeft = l.prefer === "left" || (l.prefer !== "right" && l.anchorX > midX);
    let ring = preferLeft
      ? [...RING].sort((a, b) => (a.side === "end" ? -1 : 1) - (b.side === "end" ? -1 : 1))
      : RING;
    // An arrow's name goes where the arrow points: try beyond the tip along its direction
    // first, at the same radii, before the compass ring. The side follows the direction (a
    // leftward arrow's name hangs to the left) so the box grows away from the arrow; a
    // near-vertical one is centred over the tip by nudging the anchor half a box across.
    const d = l.dir;
    const len = d ? Math.hypot(d.dx, d.dy) : 0;
    if (d && len > 0) {
      const ux = d.dx / len, uy = d.dy / len;
      const along = [1, 1.8, 2.8, 4].map((r) => {
        const side: "start" | "end" = Math.abs(ux) < 0.35 ? (preferLeft ? "end" : "start") : ux >= 0 ? "start" : "end";
        // Centre a near-vertical name on the tip: shift the anchor half the box width against the side.
        const centre = Math.abs(ux) < 0.35 ? (side === "start" ? -w / 2 : w / 2) : 0;
        return { dx: ux * gap * r * 1.2 + centre, dy: uy * gap * r * 1.2, side };
      });
      ring = [...along, ...ring];
    }

    let best: { p: PlacedLabel; cost: number } | null = null;
    for (const c of ring) {
      const x = l.anchorX + c.dx;
      const y = l.anchorY + c.dy;
      const box = boxFor(x, y, c.side);
      const off = inside(box, bounds) ? 0 : 1;
      const obstacleHits = opts.obstacles.filter((o) => overlaps(box, o, pad)).length;
      const labelHits = taken.filter((o) => overlaps(box, o, pad)).length;
      const hits = obstacleHits + labelHits;
      // When no spot is clear, a label on a dot or a line is still readable; a label on another
      // label makes both unreadable, so that costs more.
      const cost = obstacleHits * 10 + labelHits * 30 + off * 4 + Math.hypot(c.dx, c.dy) / 100;
      if (hits === 0 && off === 0) {
        taken.push(box);
        out.set(l.id, { x, y, anchor: c.side, crowded: false });
        best = null;
        break;
      }
      if (!best || cost < best.cost) best = { p: { x, y, anchor: c.side, crowded: true }, cost };
    }
    /**
     * Nothing was clear: keep the least-bad spot rather than hiding the label.
     *
     * The spot is first moved back inside `bounds`. Being outside costs 4 above and touching one
     * obstacle costs 10, so when a figure runs out of room the cheapest candidate is to step off
     * the plot — and a label far enough out is not "least-bad", it is invisible, which is the one
     * outcome this function exists to prevent. For example, on a bump chart four ranked lines
     * converging at the right edge with a large legend font would otherwise place names past
     * the plot's right edge, leaving only their first letters visible.
     *
     * A crowded label overlaps something wherever it goes. Overlapping inside the plot can be
     * read, clicked and dragged; sitting off the canvas can do none of those. So the box is
     * shifted the minimum distance that puts it back in bounds (and left-aligned when it is
     * simply wider than the plot), keeping `crowded` true so the caller still warns.
     */
    if (!out.has(l.id) && best) {
      const b = boxFor(best.p.x, best.p.y, best.p.anchor);
      let sx = 0;
      let sy = 0;
      if (b.x2 - b.x1 >= bounds.x2 - bounds.x1) sx = bounds.x1 - b.x1;
      else if (b.x2 > bounds.x2) sx = bounds.x2 - b.x2;
      else if (b.x1 < bounds.x1) sx = bounds.x1 - b.x1;
      if (b.y2 - b.y1 >= bounds.y2 - bounds.y1) sy = bounds.y1 - b.y1;
      else if (b.y2 > bounds.y2) sy = bounds.y2 - b.y2;
      else if (b.y1 < bounds.y1) sy = bounds.y1 - b.y1;
      const p = sx || sy ? { ...best.p, x: best.p.x + sx, y: best.p.y + sy } : best.p;
      taken.push(boxFor(p.x, p.y, p.anchor));
      out.set(l.id, p);
    }
  }
  return out;
}
