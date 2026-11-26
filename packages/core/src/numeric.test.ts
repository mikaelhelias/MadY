import { describe, expect, it } from "vitest";
import { numericCell } from "./numeric";

/**
 * `numericCell` is the single gate every cell passes through on its way into a statistic or the
 * analysis payload sent to Python. It must turn any non-number — a blank, a null, or a leftover
 * text marker like "NA" — into null, so a missing value can never reach the engine as a string
 * or a NaN. (This is why importing "NA" as null is safe: numericCell already treats a stray "NA"
 * string identically to null, so graphs and analyses see the same "missing" either way.)
 */
describe("numericCell — the gate into stats/analysis", () => {
  it("passes finite numbers through", () => {
    expect(numericCell(0)).toBe(0);
    expect(numericCell(-3.5)).toBe(-3.5);
    expect(numericCell("42")).toBe(42);
    expect(numericCell("1e3")).toBe(1000);
  });

  it("maps every kind of missing to null (blank, null, undefined, NaN)", () => {
    expect(numericCell(null)).toBeNull();
    expect(numericCell(undefined)).toBeNull();
    expect(numericCell("")).toBeNull();
    expect(numericCell("   ")).toBeNull();
    expect(numericCell(NaN)).toBeNull();
    expect(numericCell(Infinity)).toBeNull();
  });

  it("treats a leftover text marker the same as null — so an imported \"NA\" and a blank read alike downstream", () => {
    for (const marker of ["NA", "N/A", "null", "NaN", "-", "missing", "n.d."]) {
      expect(numericCell(marker), `${marker} must read as missing`).toBeNull();
    }
  });
});
