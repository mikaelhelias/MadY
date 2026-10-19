// @vitest-environment node
import { describe, expect, it } from "vitest";
import { needsExponent, rangeText, sciMarkup, sciText, superscript } from "./sciFormat";

describe("sciText — for prose a human will copy into a manuscript", () => {
  it("leaves ordinary numbers as plain decimals", () => {
    expect(sciText(0.5)).toBe("0.5");
    expect(sciText(1200)).toBe("1200");
    expect(sciText(29)).toBe("29");
    expect(sciText(0.99812)).toBe("0.998");
    expect(sciText(0)).toBe("0");
  });

  it("writes small and large values as ×10ⁿ, never as e-notation", () => {
    expect(sciText(0.0000012)).toBe("1.2 × 10⁻⁶");
    expect(sciText(5e-8)).toBe("5 × 10⁻⁸");
    expect(sciText(2.5e6)).toBe("2.5 × 10⁶");
    expect(sciText(1.23e-7)).toBe("1.23 × 10⁻⁷");
  });

  it("drops a redundant leading 1 — the mantissa adds nothing there", () => {
    expect(sciText(1e-6)).toBe("10⁻⁶");
    expect(sciText(1e9)).toBe("10⁹");
  });

  it("NEVER emits e-notation for any magnitude", () => {
    for (const v of [1e-21, 5e-9, 1e-7, 3.3e12, 9e20, 1e21]) {
      expect(sciText(v), String(v)).not.toMatch(/e[+-]?\d/i);
    }
  });

  it("degrades to a dash rather than printing NaN or Infinity", () => {
    expect(sciText(NaN)).toBe("—");
    expect(sciText(-Infinity)).toBe("—");
  });

  it("keeps the sign of a negative value", () => {
    expect(sciText(-0.0000012)).toBe("-1.2 × 10⁻⁶");
    expect(sciText(-42)).toBe("-42");
  });

  it("honours the requested significant figures", () => {
    expect(sciText(1.23456, 3)).toBe("1.23");
    expect(sciText(1.23456, 5)).toBe("1.2346");
    expect(sciText(1.23456e-7, 2)).toBe("1.2 × 10⁻⁷");
  });
});

describe("sciMarkup — for SVG labels, where the exponent must be a real raised tspan", () => {
  it("emits the renderer's rich-text markup rather than Unicode", () => {
    expect(sciMarkup(0.0000012)).toBe("1.2 × 10^{-6}");
    expect(sciMarkup(2.5e6)).toBe("2.5 × 10^{6}");
    expect(sciMarkup(1e-6)).toBe("10^{-6}");
  });

  it("agrees with sciText everywhere an exponent is not needed", () => {
    for (const v of [0.5, 29, 1200, 0.998, 0]) expect(sciMarkup(v)).toBe(sciText(v));
  });
});

describe("superscript", () => {
  it("maps digits and both signs", () => {
    expect(superscript(-6)).toBe("⁻⁶");
    expect(superscript(12)).toBe("¹²");
    expect(superscript(0)).toBe("⁰");
  });
});

describe("needsExponent — the switchover band", () => {
  it("keeps readable magnitudes plain", () => {
    for (const v of [0.001, 0.5, 1, 999, 99999]) expect(needsExponent(v), String(v)).toBe(false);
  });
  it("switches outside it", () => {
    for (const v of [0.0009, 1e-6, 1e5, 5e7]) expect(needsExponent(v), String(v)).toBe(true);
  });
  it("treats zero and non-finite values as plain", () => {
    expect(needsExponent(0)).toBe(false);
    expect(needsExponent(NaN)).toBe(false);
  });
});

describe("rangeText — intervals take an en dash, not a hyphen", () => {
  it("writes a positive interval with an en dash", () => {
    expect(rangeText(2.29, 8.32)).toBe("2.29–8.32");
    expect(rangeText(2.29, 8.32)).toContain("–"); // en dash U+2013
    expect(rangeText(2.29, 8.32)).not.toContain("-"); // not a hyphen
  });

  // "−1.5–0.4" is unreadable: the dash and the minus sign collide.
  it("spells out a range containing a negative bound", () => {
    expect(rangeText(-1.5, 0.4)).toBe("-1.5 to 0.4");
    expect(rangeText(-3, -1)).toBe("-3 to -1");
  });

  it("carries the ×10ⁿ treatment into the bounds", () => {
    expect(rangeText(1.2e-7, 4.5e-6)).toBe("1.2 × 10⁻⁷–4.5 × 10⁻⁶");
  });

  it("degrades rather than printing a half-range", () => {
    expect(rangeText(NaN, 5)).toBe("—");
    expect(rangeText(1, Infinity)).toBe("—");
  });
});
