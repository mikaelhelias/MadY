import { describe, expect, it } from "vitest";
import { fmtRulerTick, niceRulerStep, pxPerUnit } from "./panes";

/**
 * Pure helpers behind the graph/panel measuring ruler. Covered end-to-end by the ruler e2e
 * specs; each function also has its own unit test here.
 */
describe("ruler helpers", () => {
  it("pxPerUnit — a scene px is a 96-dpi pixel (inch = 96px, cm = 96/2.54)", () => {
    expect(pxPerUnit("px")).toBe(1);
    expect(pxPerUnit("in")).toBe(96);
    expect(pxPerUnit("cm")).toBeCloseTo(96 / 2.54, 6); // ≈ 37.795
  });

  it("niceRulerStep — snaps to the nearest 1 / 2 / 5 × 10ᵏ", () => {
    expect(niceRulerStep(1)).toBe(1);
    expect(niceRulerStep(3)).toBe(2); // 2 ≤ 3 < 5
    expect(niceRulerStep(7)).toBe(5); // ≥ 5
    expect(niceRulerStep(80)).toBe(50); // px ruler at scale 1, ~80px target
    expect(niceRulerStep(123)).toBe(100);
    // fractional steps for physical units (no floor-to-1)
    expect(niceRulerStep(80 / 96)).toBeCloseTo(0.5, 10); // inches: 0.5-in ticks
    expect(niceRulerStep(80 / (96 / 2.54))).toBe(2); // cm: 2-cm ticks
  });

  it("fmtRulerTick — whole numbers for coarse steps, minimal decimals for fine ones", () => {
    expect(fmtRulerTick(50, 50)).toBe("50");
    expect(fmtRulerTick(3, 3)).toBe("3");
    expect(fmtRulerTick(0.5, 0.5)).toBe("0.5");
    expect(fmtRulerTick(1.5, 0.5)).toBe("1.5");
    expect(fmtRulerTick(2, 0.5)).toBe("2"); // trailing ".0" trimmed
    expect(fmtRulerTick(0.2, 0.2)).toBe("0.2");
    expect(fmtRulerTick(0.1, 0.1)).toBe("0.1");
  });
});
