// @vitest-environment node
/**
 * A label may not sit on anything else.
 *
 * The rule: a label never collides with data points, an axis, the legend or any other text. This is that rule, measured — every
 * case here is a collision the placer has to resolve, not a shape it happens to produce.
 */
import { describe, expect, it } from "vitest";
import { discObstacle, leaderFor, placeLabelsClear, segmentObstacles } from "./labelPlacement";
import type { LabelRect } from "./labelPlacement";

const measure = (t: string, px: number): number => t.length * px * 0.5;
const FONT = 10;
const BOUNDS: LabelRect = { x1: 0, y1: 0, x2: 400, y2: 300 };
const boxOf = (p: { x: number; y: number; anchor: "start" | "end" }, text: string): LabelRect => {
  const w = measure(text, FONT) * 1.15;
  return { x1: p.anchor === "end" ? p.x - w : p.x, y1: p.y - FONT * 0.6, x2: p.anchor === "end" ? p.x : p.x + w, y2: p.y + FONT * 0.6 };
};
const hits = (a: LabelRect, b: LabelRect): boolean => a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;

describe("what a label must clear", () => {
  it("a data point — it never covers the thing it names, or its neighbours", () => {
    // Three marks in a row; the label's subject is the middle one.
    const marks = [discObstacle(180, 150, 6), discObstacle(200, 150, 6), discObstacle(220, 150, 6)];
    const p = placeLabelsClear([{ id: "a", text: "Festuca", anchorX: 200, anchorY: 150 }],
      { fontPx: FONT, measure, bounds: BOUNDS, obstacles: marks }).get("a")!;
    for (const m of marks) expect(hits(boxOf(p, "Festuca"), m), "the label sits on a data point").toBe(false);
    expect(p.crowded).toBe(false);
  });

  it("an arrow — a label on the line reads as if it belonged to it", () => {
    const arrow = segmentObstacles(20, 280, 200, 150);
    const p = placeLabelsClear([{ id: "a", text: "Water table", anchorX: 200, anchorY: 150 }],
      { fontPx: FONT, measure, bounds: BOUNDS, obstacles: arrow }).get("a")!;
    for (const seg of arrow) expect(hits(boxOf(p, "Water table"), seg), "the label sits on the arrow").toBe(false);
  });

  it("the legend box", () => {
    const legend: LabelRect = { x1: 300, y1: 10, x2: 395, y2: 70 };
    const p = placeLabelsClear([{ id: "a", text: "Thymus", anchorX: 320, anchorY: 40 }],
      { fontPx: FONT, measure, bounds: BOUNDS, obstacles: [legend] }).get("a")!;
    expect(hits(boxOf(p, "Thymus"), legend), "the label sits on the legend").toBe(false);
  });

  it("another label — two subjects in the same place still get two readable names", () => {
    const placed = placeLabelsClear(
      [{ id: "a", text: "Sphagnum", anchorX: 100, anchorY: 100 }, { id: "b", text: "Water table", anchorX: 104, anchorY: 102 }],
      { fontPx: FONT, measure, bounds: BOUNDS, obstacles: [] },
    );
    expect(hits(boxOf(placed.get("a")!, "Sphagnum"), boxOf(placed.get("b")!, "Water table")),
      "two labels printed through each other").toBe(false);
  });

  it("the plot edge — a label never runs out over the axis", () => {
    const p = placeLabelsClear([{ id: "a", text: "A very long variable name", anchorX: 395, anchorY: 150 }],
      { fontPx: FONT, measure, bounds: BOUNDS, obstacles: [] }).get("a")!;
    const b = boxOf(p, "A very long variable name");
    expect(b.x2).toBeLessThanOrEqual(BOUNDS.x2);
    expect(b.x1).toBeGreaterThanOrEqual(BOUNDS.x1);
  });
});

describe("what it must NOT do", () => {
  it("never drops a label — a hidden name loses information silently", () => {
    // Fenced in on every side: no placement is clear.
    const wall: LabelRect[] = [];
    for (let x = 0; x <= 400; x += 8) for (let y = 0; y <= 300; y += 8) wall.push(discObstacle(x, y, 6));
    const p = placeLabelsClear([{ id: "a", text: "Boxed in", anchorX: 200, anchorY: 150 }],
      { fontPx: FONT, measure, bounds: BOUNDS, obstacles: wall }).get("a")!;
    expect(p, "the label vanished").toBeTruthy();
    expect(p.crowded, "a forced placement must say it was forced, so the builder can warn").toBe(true);
  });

  it("leaves an uncrowded figure exactly where it was — the smallest move that works", () => {
    const p = placeLabelsClear([{ id: "a", text: "Alone", anchorX: 200, anchorY: 150 }],
      { fontPx: FONT, measure, bounds: BOUNDS, obstacles: [] }).get("a")!;
    expect(p.anchor).toBe("start");
    expect(p.x - 200).toBeLessThanOrEqual(FONT); // beside the point, not flung across the plot
    expect(p.y).toBe(150);
  });

  it("a point on the right of the plot labels leftward, so long names stay inside", () => {
    const p = placeLabelsClear([{ id: "a", text: "Management: grazed", anchorX: 380, anchorY: 150 }],
      { fontPx: FONT, measure, bounds: BOUNDS, obstacles: [] }).get("a")!;
    expect(p.anchor).toBe("end");
  });
});

/**
 * Leader lines — the thin line from a moved label back to the thing it names.
 *
 * The rule buys legibility by moving labels; in a crowded corner it can move one far enough
 * that the pairing stops being obvious. The leader restores it — and only where it is needed,
 * or a clean figure gains a spray of lines that say nothing.
 */
describe("leader lines", () => {
  const box = (x1: number, y1: number, x2: number, y2: number): LabelRect => ({ x1, y1, x2, y2 });

  it("a label beside its point gets no leader — that line would be pure clutter", () => {
    expect(leaderFor(100, 100, box(107, 94, 150, 106), 4, 8)).toBeNull();
  });

  it("a label moved away does get one", () => {
    const l = leaderFor(100, 100, box(180, 60, 230, 72), 4, 8);
    expect(l, "no leader on a label 80px from its point").toBeTruthy();
  });

  it("it touches neither the mark nor the glyphs — it starts outside the dot and stops short of the text", () => {
    const r = 6;
    const b = box(180, 60, 230, 72);
    const l = leaderFor(100, 100, b, r, 8)!;
    const dStart = Math.hypot(l.x1 - 100, l.y1 - 100);
    expect(dStart, "the leader starts inside the mark").toBeGreaterThanOrEqual(r);
    const inBox = l.x2 >= b.x1 - 0.01 && l.x2 <= b.x2 + 0.01 && l.y2 >= b.y1 - 0.01 && l.y2 <= b.y2 + 0.01;
    expect(inBox, "the leader ends inside the label's box, under the text").toBe(false);
  });

  it("it points AT the label — the two ends line up with the subject and the nearest corner", () => {
    const b = box(180, 60, 230, 72);
    const l = leaderFor(100, 100, b, 4, 8)!;
    // the direction from the subject to the near corner (180,72) and to the leader's end agree
    const a1 = Math.atan2(72 - 100, 180 - 100);
    const a2 = Math.atan2(l.y2 - 100, l.x2 - 100);
    expect(Math.abs(a1 - a2)).toBeLessThan(1e-6);
  });
});

/**
 * The least-bad spot is still a spot on the page.
 *
 * Being outside `bounds` costs 4 and touching one obstacle costs 10, so when a figure runs out of
 * room the cheapest candidate would be to step off the plot. A label far enough out is not
 * "least-bad", it is invisible — the one outcome this module exists to prevent. A crowded right
 * edge (e.g. several ranked lines converging there, with large label text) must not push names
 * off the figure.
 */
describe("a label that fits nowhere is still put somewhere it can be seen", () => {
  const measure = (t: string, px: number) => t.length * px * 0.6;
  const bounds = { x1: 0, y1: 0, x2: 200, y2: 100 };
  /** Every candidate spot is blocked: one obstacle covering the whole plot. */
  const wall = [{ x1: -1000, y1: -1000, x2: 1000, y2: 1000 }];

  it("comes back inside the bounds rather than off the page", () => {
    const placed = placeLabelsClear(
      [{ id: "a", text: "Team A", anchorX: 195, anchorY: 50 }],
      { fontPx: 18, measure, bounds, obstacles: wall },
    );
    const p = placed.get("a")!;
    expect(p.crowded, "nothing was clear, so it must say so").toBe(true);
    const w = measure("Team A", 18) * 1.15;
    const x1 = p.anchor === "end" ? p.x - w : p.x;
    expect(x1, "the label starts left of the plot").toBeGreaterThanOrEqual(bounds.x1 - 0.5);
    expect(x1 + w, "the label runs off the right of the plot").toBeLessThanOrEqual(bounds.x2 + 0.5);
    expect(p.y).toBeGreaterThanOrEqual(bounds.y1 - 0.5);
    expect(p.y).toBeLessThanOrEqual(bounds.y2 + 0.5);
  });

  it("left-aligns inside when the name is simply wider than the plot", () => {
    const narrow = { x1: 0, y1: 0, x2: 40, y2: 100 };
    const placed = placeLabelsClear(
      [{ id: "a", text: "A very long series name", anchorX: 20, anchorY: 50 }],
      { fontPx: 14, measure, bounds: narrow, obstacles: wall },
    );
    const p = placed.get("a")!;
    const w = measure("A very long series name", 14) * 1.15;
    const x1 = p.anchor === "end" ? p.x - w : p.x;
    // It cannot fit — so it starts at the left edge and overflows right, which is readable.
    // Starting off the left would hide the beginning of the name, which is not.
    expect(x1).toBeCloseTo(narrow.x1, 1);
  });
});

describe("an arrow's label goes where the arrow points", () => {
  it("with a direction, the first candidate is beyond the tip along it — not beside it", () => {
    // A loading arrow pointing straight up: its name belongs above the tip. Without `dir` the
    // ring tries "to the right of the point" first and the name sits beside the arrowhead,
    // reading as if it named whatever is to the right (on a biplot, often another arrow).
    const placed = placeLabelsClear(
      [{ id: "a", text: "Texture", anchorX: 200, anchorY: 100, dir: { dx: 0, dy: -1 } }],
      { fontPx: 12, measure: (t, px) => t.length * px * 0.6, bounds: { x1: 0, y1: 0, x2: 400, y2: 300 }, obstacles: [] },
    );
    const p = placed.get("a")!;
    expect(p.crowded).toBe(false);
    expect(p.y, "the label is above the tip").toBeLessThan(100 - 6);
    expect(Math.abs(p.x - 200), "…and centred on it, not off to one side").toBeLessThan(40);
  });
});

describe("a label with no clear spot", () => {
  it("goes on a dot rather than on another label", () => {
    // The only spot next to "B" that misses every dot is the one "A" already took; every other
    // spot covers a dot. Either way B overlaps something; on a dot it can still be read.
    const a = { id: "a", text: "Alpha", anchorX: 200, anchorY: 150 };
    const aBox = boxOf(placeLabelsClear([a], { fontPx: FONT, measure, bounds: BOUNDS, obstacles: [] }).get("a")!, a.text);
    const m = 4; // more than the placer's padding, so the dots leave A's spot itself clear
    const dots: LabelRect[] = [
      { x1: 0, y1: 0, x2: aBox.x1 - m, y2: 300 },
      { x1: aBox.x2 + m, y1: 0, x2: 400, y2: 300 },
      { x1: 0, y1: 0, x2: 400, y2: aBox.y1 - m },
      { x1: 0, y1: aBox.y2 + m, x2: 400, y2: 300 },
    ];
    const b = { id: "b", text: "Alpha", anchorX: 200, anchorY: 150 };
    const placed = placeLabelsClear([a, b], { fontPx: FONT, measure, bounds: BOUNDS, obstacles: dots });
    expect(boxOf(placed.get("a")!, a.text), "the fixture: A keeps its clear spot").toEqual(aBox);
    expect(placed.get("b")!.crowded, "the fixture: B has no clear spot").toBe(true);
    expect(hits(boxOf(placed.get("b")!, b.text), aBox), "B was printed over A").toBe(false);
  });
});
