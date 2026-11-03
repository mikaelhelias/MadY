// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { TidyTerm } from "@mady/core";
import { fitLinesWithout, fitParamLines, fitParamRows, fmtFitValue, typedFitParamLines } from "./fitParams";

const t = (term: string, estimate: number | string | null, se?: number | null): TidyTerm =>
  ({ term, estimate, ...(se === undefined ? {} : { se }) }) as TidyTerm;

describe("fmtFitValue — never prints 1e-6", () => {
  it("uses 3 significant figures in the ordinary range", () => {
    expect(fmtFitValue(29)).toBe("29");
    expect(fmtFitValue(1.5)).toBe("1.5");
    expect(fmtFitValue(0.99812)).toBe("0.998");
    expect(fmtFitValue(53000)).toBe("53000");
  });

  it("switches to ×10ⁿ markup for extremes, never exponent-e", () => {
    expect(fmtFitValue(0.0000012)).toBe("1.2 × 10^{-6}");
    expect(fmtFitValue(2500000)).toBe("2.5 × 10^{6}");
    for (const v of [1e-9, 5e7, 1.234e-5]) expect(fmtFitValue(v)).not.toMatch(/e[+-]/);
  });

  it("degrades to a dash rather than printing NaN or Infinity", () => {
    expect(fmtFitValue(NaN)).toBe("—");
    expect(fmtFitValue(Infinity)).toBe("—");
  });
});

describe("fitParamLines — Michaelis–Menten, the reference case", () => {
  // a typical enzyme-kinetics panel: KM, kcat, and a fit-quality row
  const mm = [t("KM", 29, 3), t("kcat", 1.5, 0.1), t("R2", 0.9981)];

  it("typesets each parameter with its symbol, value and ± error", () => {
    expect(fitParamLines(mm)).toEqual([
      "K_{M} = 29 ± 3",
      "k_{cat} = 1.5 ± 0.1",
      "R² = 0.998",
    ]);
  });

  it("keeps the capital M of the Michaelis constant", () => {
    // the constant's correct form, used throughout the project
    expect(fitParamLines([t("KM", 29, 3)])[0]).toContain("K_{M}");
    expect(fitParamLines([t("Km", 29, 3)])[0]).toContain("K_{M}"); // normalised, not "K_{m}"
    expect(fitParamLines([t("KM", 29, 3)])[0]).not.toContain("K_{m}");
  });

  it("emits sub/superscript markup, so the renderer prints real subscripts", () => {
    const lines = fitParamLines([t("Vmax", 12.5, 0.4), t("EC50", 0.0000012, 1e-7)]);
    expect(lines[0]).toBe("V_{max} = 12.5 ± 0.4");
    // a mantissa of exactly 1 is dropped: "± 10^{-7}" reads better than "± 1 × 10^{-7}"
    expect(lines[1]).toBe("EC_{50} = 1.2 × 10^{-6} ± 10^{-7}");
  });
});

describe("fitParamLines — what it refuses to do", () => {
  it("never invents an error the engine did not report", () => {
    expect(fitParamLines([t("KM", 29)])).toEqual(["K_{M} = 29"]);
    expect(fitParamLines([t("KM", 29, null)])).toEqual(["K_{M} = 29"]);
    expect(fitParamLines([t("KM", 29, 0)])).toEqual(["K_{M} = 29"]); // a zero SE is not an error bar
  });

  it("never prints ± on a fit-quality row, where it would be meaningless", () => {
    expect(fitParamLines([t("R2", 0.98, 0.01)])).toEqual(["R² = 0.98"]);
  });

  it("skips rows whose estimate is not a number", () => {
    // tidy tables carry string estimates (a model-comparison winner, an F-test df "1, 7")
    const mixed = [t("KM", 29, 3), t("preferred model", "4PL"), t("df", "1, 7"), t("kcat", 2, 0.2)];
    expect(fitParamLines(mixed)).toEqual(["K_{M} = 29 ± 3", "k_{cat} = 2 ± 0.2"]);
  });

  it("never synthesises units — the engine does not know them", () => {
    // check the value side only — the symbol legitimately contains an M (K_{M})
    const value = fitParamLines([t("KM", 29, 3)])[0]!.split("=")[1]!;
    expect(value.trim()).toBe("29 ± 3");
    expect(value).not.toMatch(/µM|uM|mM|s⁻¹|min|mol/);
  });

  it("drops unnamed rows instead of printing a bare number", () => {
    expect(fitParamLines([t("", 5, 1), t("KM", 29, 3)])).toEqual(["K_{M} = 29 ± 3"]);
  });
});

describe("fitParamLines — options and unknown parameters", () => {
  it("can omit the fit-quality rows", () => {
    const lines = fitParamLines([t("KM", 29, 3), t("R2", 0.99)], { includeFitQuality: false });
    expect(lines).toEqual(["K_{M} = 29 ± 3"]);
  });

  it("caps the block — it is an annotation, not a results table", () => {
    const many = Array.from({ length: 20 }, (_, i) => t(`p${i}`, i + 1, 0.1));
    expect(fitParamLines(many)).toHaveLength(6);
    expect(fitParamLines(many, { max: 2 })).toHaveLength(2);
  });

  it("handles a model whose parameters it has never seen", () => {
    // a trailing number is nearly always a subscript; otherwise pass the name through
    expect(fitParamLines([t("EC90", 4, 0.5)])[0]).toBe("EC_{90} = 4 ± 0.5");
    expect(fitParamLines([t("Hill slope", 1.2, 0.1)])[0]).toBe("Hill slope = 1.2 ± 0.1");
    expect(fitParamLines([t("wobble", 3)])[0]).toBe("wobble = 3");
  });

  it("returns nothing for an analysis with no fitted parameters", () => {
    expect(fitParamLines([])).toEqual([]);
    expect(fitParamLines([t("preferred model", "4PL")])).toEqual([]);
  });
});

describe("fitParamRows — every number the fit reports, keyed by its statistic", () => {
  // The terms a Boltzmann fit returns from engine.py.
  const boltzmann = [
    t("Bottom", -0.057, 0.448), t("Top", 99.94, 0.447), t("V50", 54.97, 0.093), t("Slope", 3.0, 0.083),
    t("R²", 0.9998), t("Adjusted R²", 0.9997), t("Sy.x (RMSE)", 0.807), t("Sum of squares", 4.56),
    t("Runs test (lack of fit)", 11), t("Residual normality (Shapiro-Wilk)", null),
  ];
  it("is not capped at six: all nine numeric rows, in the engine's order, each with its term as key", () => {
    const rows = fitParamRows(boltzmann);
    expect(rows.map((r) => r.key)).toEqual(["Bottom", "Top", "V50", "Slope", "R²", "Adjusted R²", "Sy.x (RMSE)", "Sum of squares", "Runs test (lack of fit)"]);
    expect(rows[2]!.text).toBe("V_{50} = 55 ± 0.093");
  });
  it("the block's default lines are its first six rows, unchanged", () => {
    expect(fitParamLines(boltzmann)).toEqual(fitParamRows(boltzmann).slice(0, 6).map((r) => r.text));
  });
  it("drops the engine's fit-quality names when asked (not only \"R2\" spellings)", () => {
    expect(fitParamRows(boltzmann, { includeFitQuality: false }).map((r) => r.key)).toEqual(["Bottom", "Top", "V50", "Slope"]);
  });
  it("two terms with one name get two keys, so they never share a stored choice", () => {
    expect(fitParamRows([t("k", 1, 0.1), t("k", 2, 0.1)]).map((r) => r.key)).toEqual(["k", "k (2)"]);
  });
});

describe("fitLinesWithout", () => {
  it("removes one field from every line, dropping lines left empty", () => {
    expect(fitLinesWithout({
      V50: { offset: { dx: 3, dy: 4 }, text: "Tm = 55 °C", fittedText: "V_{50} = 55" },
      Top: { offset: { dx: 1, dy: 1 } },
      R2: { show: false },
    }, "offset")).toEqual({ V50: { text: "Tm = 55 °C", fittedText: "V_{50} = 55" }, R2: { show: false } });
  });
  it("gives undefined when nothing is left, and for no lines at all", () => {
    expect(fitLinesWithout({ Top: { offset: { dx: 1, dy: 1 } } }, "offset")).toBeUndefined();
    expect(fitLinesWithout(undefined, "offset")).toBeUndefined();
  });
});

describe("typedFitParamLines — typing on the graph", () => {
  const fit = { params: ["Top = 100", "V_{50} = 55", "R² = 0.99"], paramKeys: ["Top", "V50", "R²"] };
  it("keeps typed text with the fitted text it replaced", () => {
    expect(typedFitParamLines(fit, undefined, ["V50"], "Tm = 55 °C")).toEqual({ V50: { text: "Tm = 55 °C", fittedText: "V_{50} = 55" } });
  });
  it("typing the fitted text back clears the override but keeps the line's position", () => {
    const lines = { V50: { text: "Tm = 55 °C", fittedText: "V_{50} = 55", offset: { dx: 2, dy: 3 } } };
    expect(typedFitParamLines(fit, lines, ["V50"], "V_{50} = 55")).toEqual({ V50: { offset: { dx: 2, dy: 3 } } });
  });
  it("an emptied line is hidden", () => {
    expect(typedFitParamLines(fit, { R2: { text: "x" } }, ["R²"], "  ")).toEqual({ R2: { text: "x" }, "R²": { show: false } });
  });
  it("a whole-block edit maps typed lines to the shown lines in order; extra keys untouched", () => {
    const out = typedFitParamLines(fit, { "R²": { offset: { dx: 1, dy: 1 } } }, ["Top", "V50", "R²"], "Top = 100\nTm = 55 °C");
    expect(out).toEqual({ Top: {}, V50: { text: "Tm = 55 °C", fittedText: "V_{50} = 55" }, "R²": { offset: { dx: 1, dy: 1 } } });
  });
  it("a fit saved without keys is addressed by position", () => {
    expect(typedFitParamLines({ params: ["a = 1", "b = 2"] }, undefined, ["#1"], "b = 2 mM")).toEqual({ "#1": { text: "b = 2 mM", fittedText: "b = 2" } });
  });
});
