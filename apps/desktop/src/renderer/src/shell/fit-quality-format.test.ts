/**
 * R² is printed with enough digits not to read as a perfect fit. Numbers in the fit block are rounded to 3 significant
 * figures, which would print an R² of 0.99974 as "1", as if the fit were exact. A value that would round to 1 without
 * being 1 keeps the digits that tell it from 1. Every other number, and every R² that does not round to 1, prints at 3
 * significant figures.
 */
import { describe, expect, it } from "vitest";
import type { TidyTerm } from "@mady/core";
import { fitParamRows, fmtFitQuality } from "./fitParams";

const row = (term: string, estimate: number): string => fitParamRows([{ term, estimate } as TidyTerm])[0]!.text;

describe("fmtFitQuality", () => {
  it("a value that rounds to 1 without being 1 keeps its digits", () => {
    expect(fmtFitQuality(0.999741)).toBe("0.9997");
    expect(fmtFitQuality(0.99996)).toBe("0.99996");
    expect(fmtFitQuality(0.9996)).toBe("0.9996");
  });
  it("a value that does not round to 1 prints as 3 significant figures", () => {
    expect(fmtFitQuality(0.993147)).toBe("0.993");
    expect(fmtFitQuality(0.9994)).toBe("0.999");
    expect(fmtFitQuality(0.5)).toBe("0.5");
    expect(fmtFitQuality(0)).toBe("0");
  });
  it("exactly 1 is 1", () => {
    expect(fmtFitQuality(1)).toBe("1");
  });
  it("a value that rounds to -1 keeps its digits too (an adjusted R² can go below zero)", () => {
    expect(fmtFitQuality(-0.99974)).toBe("-0.9997");
  });
});

describe("the fit block", () => {
  it("R² and adjusted R² of 0.99974 do not read as 1", () => {
    expect(row("R²", 0.999741)).toBe("R² = 0.9997");
    expect(row("Adjusted R²", 0.999741)).toBe("Adjusted R² = 0.9997");
    expect(row("R2", 0.999741)).toBe("R² = 0.9997");
  });
  it("an R² that rounds fine is unchanged", () => {
    expect(row("R²", 0.993147)).toBe("R² = 0.993");
  });
  it("a fitted parameter that rounds to 1 is not given extra digits", () => {
    expect(row("Top", 0.99974)).toBe("Top = 1");
  });
});
