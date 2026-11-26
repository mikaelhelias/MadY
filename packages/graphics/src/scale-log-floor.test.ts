// The power of a log axis's base strictly below a value: where a log axis starts so that a bar of that value has a
// height.
import { describe, expect, it } from "vitest";
import { logFloorBelow } from "./scale.js";

describe("logFloorBelow", () => {
  it("log10: the power of ten below the value", () => {
    expect(logFloorBelow(2, "log10")).toBeCloseTo(1, 12);
    expect(logFloorBelow(0.5, "log10")).toBeCloseTo(0.1, 12);
    expect(logFloorBelow(250, "log10")).toBeCloseTo(100, 12);
  });
  it("a value that is itself a power of the base steps one power down", () => {
    expect(logFloorBelow(10, "log10")).toBeCloseTo(1, 12);
    expect(logFloorBelow(1, "log10")).toBeCloseTo(0.1, 12);
    expect(logFloorBelow(8, "log2")).toBeCloseTo(4, 12);
  });
  it("log2 and ln use their own base", () => {
    expect(logFloorBelow(3, "log2")).toBeCloseTo(2, 12);
    expect(logFloorBelow(3, "ln")).toBeCloseTo(Math.E, 12);
  });
  it("a linear axis, or a value that is not positive, is left as it is", () => {
    expect(logFloorBelow(2, "linear")).toBe(2);
    expect(logFloorBelow(0, "log10")).toBe(0);
    expect(logFloorBelow(-3, "log10")).toBe(-3);
  });
});
