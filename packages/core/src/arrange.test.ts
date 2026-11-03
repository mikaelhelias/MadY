import { describe, expect, it } from "vitest";
import { arrangeBoxes, type Box } from "./arrange";

/** Three boxes at varying positions/sizes for the align/distribute cases. */
const boxes = (): Box[] => [
  { x: 0, y: 0, w: 10, h: 4 }, // A
  { x: 20, y: 10, w: 6, h: 8 }, // B
  { x: 5, y: 30, w: 4, h: 4 }, // C
];

describe("arrangeBoxes — degenerate cases", () => {
  it("0 or 1 boxes are returned unchanged (a fresh copy)", () => {
    expect(arrangeBoxes([], "left")).toEqual([]);
    const one: Box[] = [{ x: 3, y: 7, w: 2, h: 2 }];
    const r = arrangeBoxes(one, "center-x");
    expect(r).toEqual(one);
    expect(r[0]).not.toBe(one[0]); // does not mutate the input box
  });
  it("does not mutate the input array/boxes", () => {
    const inp = boxes();
    const snapshot = JSON.stringify(inp);
    arrangeBoxes(inp, "right");
    expect(JSON.stringify(inp)).toBe(snapshot);
  });
});

describe("arrangeBoxes — edge alignment", () => {
  it("left: every left edge → group min-left (A: 0)", () => {
    const r = arrangeBoxes(boxes(), "left");
    expect(r.map((b) => b.x)).toEqual([0, 0, 0]);
    expect(r.map((b) => b.w)).toEqual([10, 6, 4]); // widths unchanged
  });
  it("right: every right edge → group max-right (B: 20+6=26)", () => {
    const r = arrangeBoxes(boxes(), "right");
    expect(r.map((b) => b.x + b.w)).toEqual([26, 26, 26]);
  });
  it("top: every top edge → group min-top (0)", () => {
    const r = arrangeBoxes(boxes(), "top");
    expect(r.map((b) => b.y)).toEqual([0, 0, 0]);
  });
  it("bottom: every bottom edge → group max-bottom (C: 30+4=34)", () => {
    const r = arrangeBoxes(boxes(), "bottom");
    expect(r.map((b) => b.y + b.h)).toEqual([34, 34, 34]);
  });
});

describe("arrangeBoxes — centring", () => {
  it("center-x: every centre-X → union centre ((0..26)/2 = 13)", () => {
    const r = arrangeBoxes(boxes(), "center-x");
    for (const b of r) expect(b.x + b.w / 2).toBeCloseTo(13, 10);
  });
  it("center-y: every centre-Y → union centre ((0..34)/2 = 17)", () => {
    const r = arrangeBoxes(boxes(), "center-y");
    for (const b of r) expect(b.y + b.h / 2).toBeCloseTo(17, 10);
  });
});

describe("arrangeBoxes — distribute (equal gaps)", () => {
  it("distribute-h keeps the extremes fixed and equalises the gaps", () => {
    // Three boxes of equal width, sorted by x: A(0..10), B(40..50), C(90..100).
    const bs: Box[] = [
      { x: 0, y: 0, w: 10, h: 2 }, // leftmost
      { x: 40, y: 0, w: 10, h: 2 }, // middle-ish
      { x: 90, y: 0, w: 10, h: 2 }, // rightmost
    ];
    const r = arrangeBoxes(bs, "distribute-h");
    // span = 0..100 = 100; total width = 30; leftover 70 / 2 gaps = 35 each.
    expect(r[0]!.x).toBeCloseTo(0, 10); // first stays
    expect(r[1]!.x).toBeCloseTo(45, 10); // 0 + 10 + 35
    expect(r[2]!.x + r[2]!.w).toBeCloseTo(100, 10); // last right edge stays
    // Equal gaps: A→B = 45 − 10 = 35; B→C = 90 − (45 + 10) = 35.
    expect(r[2]!.x).toBeCloseTo(90, 10);
  });
  it("distribute preserves the original order while positioning by sorted order", () => {
    const bs: Box[] = [
      { x: 90, y: 0, w: 10, h: 2 }, // originally last, positionally rightmost
      { x: 0, y: 0, w: 10, h: 2 }, // originally middle, positionally leftmost
      { x: 40, y: 0, w: 10, h: 2 }, // originally first-index-2
    ];
    const r = arrangeBoxes(bs, "distribute-h");
    expect(r[1]!.x).toBeCloseTo(0, 10); // the positional-leftmost stays put
    expect(r[0]!.x + r[0]!.w).toBeCloseTo(100, 10); // the positional-rightmost stays put
    expect(r[2]!.x).toBeCloseTo(45, 10); // the middle one evenly spaced
  });
  it("distribute-v works on the Y axis", () => {
    const bs: Box[] = [
      { x: 0, y: 0, w: 2, h: 10 },
      { x: 0, y: 30, w: 2, h: 10 },
      { x: 0, y: 90, w: 2, h: 10 },
    ];
    const r = arrangeBoxes(bs, "distribute-v");
    expect(r[0]!.y).toBeCloseTo(0, 10);
    expect(r[1]!.y).toBeCloseTo(45, 10);
    expect(r[2]!.y + r[2]!.h).toBeCloseTo(100, 10);
  });
  it("2 boxes: distribute is a no-op (they are already the extremes)", () => {
    const bs: Box[] = [{ x: 0, y: 0, w: 4, h: 4 }, { x: 50, y: 0, w: 4, h: 4 }];
    expect(arrangeBoxes(bs, "distribute-h")).toEqual(bs);
  });
});

describe("arrangeBoxes — equalise size", () => {
  it("equalize-w sets every width to the max (top-left held)", () => {
    const r = arrangeBoxes(boxes(), "equalize-w");
    expect(r.map((b) => b.w)).toEqual([10, 10, 10]); // max width = 10
    expect(r.map((b) => b.x)).toEqual([0, 20, 5]); // x (left) unchanged
  });
  it("equalize-h sets every height to the max (top held)", () => {
    const r = arrangeBoxes(boxes(), "equalize-h");
    expect(r.map((b) => b.h)).toEqual([8, 8, 8]); // max height = 8
    expect(r.map((b) => b.y)).toEqual([0, 10, 30]); // y (top) unchanged
  });
});

describe("arrangeBoxes — point boxes (zero-size text anchors)", () => {
  it("align/centre a set of points collapses them onto a shared line", () => {
    const pts: Box[] = [
      { x: 2, y: 5, w: 0, h: 0 },
      { x: 8, y: 1, w: 0, h: 0 },
      { x: 4, y: 9, w: 0, h: 0 },
    ];
    // center-x → all share the mid-X of [2..8] = 5.
    const cx = arrangeBoxes(pts, "center-x");
    for (const b of cx) expect(b.x).toBeCloseTo(5, 10);
    // top → all share min-y = 1.
    const t = arrangeBoxes(pts, "top");
    for (const b of t) expect(b.y).toBe(1);
  });
});
