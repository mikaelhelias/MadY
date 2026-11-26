import { describe, expect, it } from "vitest";
import { annotationRenamePatch, formatSignificance, formatSignificanceWith, resolveThresholds } from "./model";

describe("formatSignificance", () => {
  // The factory star is ★, not the typographic asterisk (a design choice). The
  // cut-points below are the contract this test guards; the glyph is the
  // vocabulary, and it lives in one constant (FACTORY_SIGNIFICANCE_THRESHOLDS).
  it("stars use the canonical 0.05 / 0.01 / 0.001 / 0.0001 cut-points", () => {
    expect(formatSignificance(0.2, "stars")).toBe("ns");
    expect(formatSignificance(0.04, "stars")).toBe("★");
    expect(formatSignificance(0.004, "stars")).toBe("★★");
    expect(formatSignificance(0.0004, "stars")).toBe("★★★");
    expect(formatSignificance(0.00004, "stars")).toBe("★★★★");
  });

  it("threshold prints the strongest p<… bound met", () => {
    expect(formatSignificance(0.2, "threshold")).toBe("ns");
    expect(formatSignificance(0.03, "threshold")).toBe("p<0.05");
    expect(formatSignificance(0.005, "threshold")).toBe("p<0.01");
    expect(formatSignificance(0.0005, "threshold")).toBe("p<0.001");
    expect(formatSignificance(0.00005, "threshold")).toBe("p<0.0001");
  });

  it("numeric prints p=… to the requested decimals, with a floor below the smallest displayable", () => {
    expect(formatSignificance(0.012, "numeric", 3)).toBe("p=0.012");
    expect(formatSignificance(0.012, "numeric", 2)).toBe("p=0.01");
    expect(formatSignificance(0.00004, "numeric", 3)).toBe("p<0.001"); // below 10^-3 floor
    expect(formatSignificance(0.5, "numeric", 4)).toBe("p=0.5000");
  });

  it("defaults to stars, uses strict cut-points, and returns '' for a non-finite p", () => {
    expect(formatSignificance(0.0005)).toBe("★★★");
    expect(formatSignificance(0.001)).toBe("★★"); // p = 0.001 is not < 0.001
    expect(formatSignificance(NaN)).toBe("");
  });

  describe("exact small p (opt-in; the floor stays the default)", () => {
    it("prints a sub-floor p in typeset scientific form rather than the cap", () => {
      expect(formatSignificance(0.0000012, "numeric", 3, true)).toBe("p=1.2 × 10⁻⁶");
      expect(formatSignificance(0.0000012, "numeric", 3, false)).toBe("p<0.001"); // default
      expect(formatSignificance(0.0000012, "numeric", 3)).toBe("p<0.001"); // omitted = off
    });

    it("never emits JavaScript exponent notation, which reads as unfinished in a figure", () => {
      for (const p of [1e-6, 5e-8, 1.234e-11, 9.9e-300]) {
        const out = formatSignificance(p, "numeric", 3, true);
        expect(out).not.toMatch(/e[+-]?\d/);
        expect(out).toMatch(/^p=.*10[⁻⁰¹²³⁴⁵⁶⁷⁸⁹]+$/);
      }
    });

    it("leaves values at or above the floor as ordinary decimals", () => {
      expect(formatSignificance(0.012, "numeric", 3, true)).toBe("p=0.012");
      expect(formatSignificance(0.001, "numeric", 3, true)).toBe("p=0.001");
      expect(formatSignificance(0.5, "numeric", 4, true)).toBe("p=0.5000");
    });

    it("p = 0 keeps the cap — that is underflow, not a measurement, so there is no accurate exact form", () => {
      expect(formatSignificance(0, "numeric", 3, true)).toBe("p<0.001");
    });

    it("does not touch stars or threshold, which are cut-point vocabularies by definition", () => {
      expect(formatSignificance(0.0000012, "stars", 3, true)).toBe("★★★★");
      expect(formatSignificance(0.0000012, "threshold", 3, true)).toBe("p<0.0001");
    });
  });
});

describe("the user's own threshold ladder", () => {
  const ladder = [
    { p: 0.1, symbol: "†" },
    { p: 0.01, symbol: "‡" },
  ];

  it("prints the user's symbols at the user's cut-points", () => {
    const f = (p: number): string => formatSignificance(p, "stars", 3, false, { thresholds: ladder });
    expect(f(0.05)).toBe("†"); // clears 0.1 but not 0.01
    expect(f(0.005)).toBe("‡"); // clears the strongest rung
    expect(f(0.5)).toBe("ns"); // clears nothing
  });

  it("draws brackets a stricter default would have refused", () => {
    // The point of an editable ladder: a lab working at α = 0.10 gets a marker at p = 0.08,
    // where the factory ladder says "ns".
    expect(formatSignificance(0.08, "stars", 3, false, { thresholds: ladder })).toBe("†");
    expect(formatSignificance(0.08, "stars")).toBe("ns");
  });

  it("uses the ladder for the threshold vocabulary too", () => {
    expect(formatSignificance(0.05, "threshold", 3, false, { thresholds: [{ p: 0.1, symbol: "p<0.1" }] })).toBe("p<0.1");
  });

  it("honours a custom ns label, and hides nothing on its own", () => {
    expect(formatSignificance(0.9, "stars", 3, false, { nsSymbol: "n.s." })).toBe("n.s.");
    expect(formatSignificance(0.9, "numeric", 2, false, { nsSymbol: "n.s." })).toBe("p=0.90");
  });

  it("backward compatibility: undefined and [] both reproduce the factory output exactly", () => {
    for (const p of [0.2, 0.049, 0.009, 0.0009, 0.00009]) {
      expect(formatSignificance(p, "stars", 3, false, { thresholds: undefined })).toBe(formatSignificance(p, "stars"));
    }
    // An empty ladder is legal and means "nothing clears" — not "fall back to factory",
    // which would make an emptied editor silently ignore the user.
    expect(formatSignificance(0.0001, "stars", 3, false, { thresholds: [] })).toBe("ns");
  });

  it("normalises invalid input instead of throwing — an editor passes through every half-typed state", () => {
    const messy = [
      { p: 0.01, symbol: "b" },
      { p: 0.05, symbol: "a" }, // out of order
      { p: 0.01, symbol: "dup" }, // duplicate cut-point
      { p: 0, symbol: "zero" }, // out of range
      { p: 2, symbol: "big" }, // out of range
      { p: 0.5, symbol: "" }, // blank symbol
      { p: Number.NaN, symbol: "nan" },
    ];
    const got = resolveThresholds(messy);
    expect(got).toEqual([{ p: 0.01, symbol: "b" }, { p: 0.05, symbol: "a" }]);
    expect(() => formatSignificance(0.02, "stars", 3, false, { thresholds: messy })).not.toThrow();
    expect(formatSignificance(0.02, "stars", 3, false, { thresholds: messy })).toBe("a");
  });

  it("formatSignificanceWith reads the whole style, so the ladder cannot be dropped", () => {
    expect(formatSignificanceWith(0.05, { display: "stars", thresholds: ladder })).toBe("†");
    expect(formatSignificanceWith(0.9, { nsSymbol: "—" })).toBe("—");
    expect(formatSignificanceWith(0.004)).toBe("★★"); // no style at all = factory
  });
});

describe("annotationRenamePatch — which field a rename types into", () => {
  it("routes a p-carrying bracket to labelOverride, keeping the p", () => {
    expect(annotationRenamePatch({ p: 0.004 }, "my label")).toEqual({ labelOverride: "my label" });
  });
  it("routes a plain annotation to label", () => {
    expect(annotationRenamePatch({}, "my label")).toEqual({ label: "my label" });
  });
  it("clears rather than storing an empty string, so the p-derived label comes back", () => {
    expect(annotationRenamePatch({ p: 0.004 }, "   ")).toEqual({ labelOverride: undefined });
  });
});
