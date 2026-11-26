import { describe, expect, it } from "vitest";
import { imageInsertBox } from "./imageInsert";

describe("imageInsertBox — aspect-preserving default box", () => {
  it("a square image on a 1.3 plot → a fractionally-taller box (so the pixels come out square)", () => {
    const b = imageInsertBox(100, 100, 1.3);
    expect(b.w).toBeCloseTo(0.35, 6);
    expect(b.h).toBeCloseTo((0.35 * 1.3) / 1, 6); // 0.455
    expect(b.x).toBeCloseTo(0.5 - b.w / 2, 6); // centred
    expect(b.y).toBeCloseTo(0.5 - b.h / 2, 6);
  });

  it("a wide image (2:1) → a short box", () => {
    const b = imageInsertBox(200, 100, 1.3);
    expect(b.w).toBeCloseTo(0.35, 6);
    expect(b.h).toBeCloseTo((0.35 * 1.3) / 2, 6); // 0.2275
  });

  it("a very tall image is clamped to maxH=0.7, width scaled down to keep the aspect + stays on-plot", () => {
    const b = imageInsertBox(100, 1000, 1.3); // ratio 0.1 → raw h = 4.55 → clamp
    expect(b.h).toBeCloseTo(0.7, 6);
    expect(b.w).toBeCloseTo(0.35 * (0.7 / 4.55), 6);
    expect(b.x).toBeGreaterThanOrEqual(0.02);
    expect(b.y).toBeGreaterThanOrEqual(0.02);
    expect(b.y + b.h).toBeLessThanOrEqual(0.98 + 1e-9);
  });

  it("a very wide image is clamped to minH, width capped ≤0.9 + stays on-plot", () => {
    const b = imageInsertBox(10000, 100, 1.3); // ratio 100 → raw h ≈ 0.0046 → below minH
    expect(b.h).toBeCloseTo(0.06, 6);
    expect(b.w).toBeLessThanOrEqual(0.9 + 1e-9);
    expect(b.x + b.w).toBeLessThanOrEqual(0.98 + 1e-9);
  });

  it("degenerate (0×0) dimensions default to ratio 1 without producing NaN", () => {
    const b = imageInsertBox(0, 0);
    expect(Number.isFinite(b.w)).toBe(true);
    expect(Number.isFinite(b.h)).toBe(true);
    expect(b.w).toBeGreaterThan(0);
    expect(b.h).toBeGreaterThan(0);
  });
});
