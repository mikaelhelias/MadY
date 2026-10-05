import { describe, it, expect } from "vitest";
import { squarifyLayout, squarifiedTreemap, rectToPolygon, type Rect } from "./squarifiedTreemap.js";

const RECT: Rect = { x: 0, y: 0, w: 600, h: 400 };
const rectArea = 600 * 400;

/** True if two rects overlap on a positive-area region. */
function overlaps(a: Rect, b: Rect): boolean {
  const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return ix > 1e-6 && iy > 1e-6;
}

describe("squarifyLayout", () => {
  it("tiles the rect: sub-rect areas sum to the rect area", () => {
    const rects = squarifyLayout([6, 4, 3, 2, 1], RECT);
    const sum = rects.reduce((a, r) => a + r.w * r.h, 0);
    expect(sum).toBeCloseTo(rectArea, 4);
  });

  it("areas are proportional to the weights", () => {
    const weights = [6, 4, 3, 2, 1];
    const rects = squarifyLayout(weights, RECT);
    const totalW = weights.reduce((a, b) => a + b, 0);
    rects.forEach((r, i) => {
      expect((r.w * r.h) / rectArea).toBeCloseTo(weights[i]! / totalW, 5);
    });
  });

  it("returns rects in input order and produces no overlaps", () => {
    const rects = squarifyLayout([3, 1, 5, 2, 4], RECT);
    expect(rects).toHaveLength(5);
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        expect(overlaps(rects[i]!, rects[j]!), `rect ${i} vs ${j} overlap`).toBe(false);
      }
    }
    // Every rect stays inside the bounds.
    for (const r of rects) {
      expect(r.x).toBeGreaterThanOrEqual(-1e-6);
      expect(r.y).toBeGreaterThanOrEqual(-1e-6);
      expect(r.x + r.w).toBeLessThanOrEqual(RECT.x + RECT.w + 1e-6);
      expect(r.y + r.h).toBeLessThanOrEqual(RECT.y + RECT.h + 1e-6);
    }
  });

  it("keeps aspect ratios reasonably square for a balanced set", () => {
    const rects = squarifyLayout([5, 5, 4, 4, 3, 3, 2, 2], RECT);
    for (const r of rects) {
      const ar = Math.max(r.w / r.h, r.h / r.w);
      expect(ar).toBeLessThan(6); // no absurdly thin slivers
    }
  });

  it("a single weight fills the whole rect", () => {
    const rects = squarifyLayout([0, 7, 0], RECT);
    expect(rects[1]!.w * rects[1]!.h).toBeCloseTo(rectArea, 4);
    expect(rects[0]!.w * rects[0]!.h).toBe(0);
    expect(rects[2]!.w * rects[2]!.h).toBe(0);
  });

  it("zero / negative / empty inputs degrade gracefully", () => {
    const z = squarifyLayout([2, 0, -3, 5], RECT);
    expect(z[1]!.w * z[1]!.h).toBe(0);
    expect(z[2]!.w * z[2]!.h).toBe(0);
    expect(z.reduce((a, r) => a + r.w * r.h, 0)).toBeCloseTo(rectArea, 4);
    expect(squarifyLayout([], RECT)).toEqual([]);
    expect(squarifyLayout([1, 1], { x: 0, y: 0, w: 0, h: 10 }).every((r) => r.w * r.h === 0)).toBe(true);
  });

  it("is deterministic (same input → identical rects)", () => {
    expect(squarifyLayout([4, 2, 1, 3], RECT)).toEqual(squarifyLayout([4, 2, 1, 3], RECT));
  });
});

describe("squarifiedTreemap", () => {
  it("returns 4-vertex rectangle polygons, area-proportional, in input order", () => {
    const cells = squarifiedTreemap([5, 3, 2], RECT);
    expect(cells).toHaveLength(3);
    for (const c of cells) expect(c.polygon).toHaveLength(4);
    expect(cells[0]!.area).toBeGreaterThan(cells[1]!.area);
    expect(cells[1]!.area).toBeGreaterThan(cells[2]!.area);
    // The site sits at the rectangle centre.
    const c0 = cells[0]!;
    const xs = c0.polygon.map((p) => p.x);
    expect(c0.site.x).toBeCloseTo((Math.min(...xs) + Math.max(...xs)) / 2, 6);
  });

  it("rectToPolygon makes a closed axis-aligned rectangle", () => {
    const poly = rectToPolygon({ x: 10, y: 20, w: 30, h: 40 });
    expect(poly).toEqual([
      { x: 10, y: 20 },
      { x: 40, y: 20 },
      { x: 40, y: 60 },
      { x: 10, y: 60 },
    ]);
  });
});
