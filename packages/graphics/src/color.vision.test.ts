// @vitest-environment node
/**
 * Colour-vision simulation + the editor's advice.
 *
 * The advice never refuses. A rainbow is a legitimate choice, offered by name;
 * the editor's job is to say what a reader will and will not be able to tell apart, not to
 * withhold the ramp. Every case here asserts the wording appears (or does not) — never that a
 * gradient was rejected.
 */
import { describe, expect, it } from "vitest";
import {
  colorDistance, gradientAdvice, resolveBuiltinRamp, resolveGradient, rgbToLab, simulateVision,
} from "./color.js";

describe("simulateVision", () => {
  it("greyscale collapses hue to luminance — white and black stay, pure red and pure green become different greys", () => {
    expect(simulateVision("#ffffff", "grayscale")).toBe("#ffffff");
    expect(simulateVision("#000000", "grayscale")).toBe("#000000");
    const r = simulateVision("#ff0000", "grayscale");
    const g = simulateVision("#00ff00", "grayscale");
    expect(r).not.toBe(g); // their luminance differs: red is far darker than green
    expect(colorDistance(r, "#ff0000")).toBeGreaterThan(20); // it really did change
  });

  it("deuteranopia collapses the red-green axis (not overall distance — brightness survives)", () => {
    // Note: the total ΔE does not necessarily shrink: a deuteranope still sees that #d62728
    // and #2ca02c differ in brightness. What is lost is the
    // red-green axis itself — Lab's a* — which is precisely what the simulation must show.
    const aStar = (hex: string): number => rgbToLab(hex)[1];
    const before = Math.abs(aStar("#d62728") - aStar("#2ca02c"));
    const after = Math.abs(
      aStar(simulateVision("#d62728", "deuteranopia")) - aStar(simulateVision("#2ca02c", "deuteranopia")),
    );
    expect(before).toBeGreaterThan(80); // they are opposite ends of red-green to start with
    expect(after).toBeLessThan(before / 4);
  });

  it("leaves greys alone whatever the deficiency", () => {
    for (const k of ["deuteranopia", "protanopia", "tritanopia"] as const) {
      expect(colorDistance(simulateVision("#808080", k), "#808080")).toBeLessThan(3);
    }
  });
});

describe("gradientAdvice", () => {
  it("says nothing about viridis — it is monotonic in lightness, which is the point of it", () => {
    expect(gradientAdvice(resolveBuiltinRamp("viridis"))).toEqual([]);
    expect(gradientAdvice(resolveBuiltinRamp("cividis"))).toEqual([]);
    expect(gradientAdvice(resolveBuiltinRamp("blues"))).toEqual([]);
  });

  it("warns that a rainbow brightens then darkens — but still returns it", () => {
    const said = gradientAdvice(resolveBuiltinRamp("rainbow"));
    expect(said.join(" ")).toMatch(/lighter and then darker/i);
    expect(said.join(" ")).not.toMatch(/cannot|refus|not allowed/i);
  });

  it("warns about a diverging ramp too — coolwarm is light in the middle by design", () => {
    expect(gradientAdvice(resolveBuiltinRamp("coolwarm")).join(" ")).toMatch(/lighter and then darker/i);
  });

  it("names two classes a colour-blind reader could not separate", () => {
    // Red → green in six classes: the middle pair is nearly identical under deuteranopia.
    const g = resolveGradient({
      id: "g", name: "R→G", mode: "stops", steps: 6,
      stops: [{ pos: 0, color: "#d62728" }, { pos: 1, color: "#2ca02c" }],
    });
    expect(gradientAdvice(g).join(" ")).toMatch(/look almost the same/i);
  });

  it("does not warn about indistinguishable classes on a continuous ramp — neighbouring samples are always close", () => {
    const g = resolveGradient({
      id: "g", name: "R→G", mode: "stops",
      stops: [{ pos: 0, color: "#d62728" }, { pos: 1, color: "#2ca02c" }],
    });
    expect(gradientAdvice(g).join(" ")).not.toMatch(/look almost the same/i);
  });

  it("says nothing about a well-separated stepped ramp", () => {
    const g = resolveGradient({
      id: "g", name: "OK", mode: "stops", steps: 4,
      stops: [{ pos: 0, color: "#f7fbff" }, { pos: 1, color: "#08306b" }],
    });
    expect(gradientAdvice(g)).toEqual([]);
  });
});
