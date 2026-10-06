// @vitest-environment node
import { describe, expect, it } from "vitest";
import { clampZoom, ZOOM_MAX, ZOOM_MIN, zoomLabel, zoomStep } from "./zoom";

describe("clampZoom", () => {
  it("bounds to [MIN, MAX] and recovers from NaN", () => {
    expect(clampZoom(1)).toBe(1);
    expect(clampZoom(99)).toBe(ZOOM_MAX);
    expect(clampZoom(0.01)).toBe(ZOOM_MIN);
    expect(clampZoom(NaN)).toBe(1);
  });
});

describe("zoomStep", () => {
  it("steps up and down and stays in range", () => {
    expect(zoomStep(1, 1)).toBeGreaterThan(1);
    expect(zoomStep(1, -1)).toBeLessThan(1);
    expect(zoomStep(ZOOM_MAX, 1)).toBe(ZOOM_MAX);
    expect(zoomStep(ZOOM_MIN, -1)).toBe(ZOOM_MIN);
  });

  it("round-trips approximately (in then out ≈ 1)", () => {
    expect(Math.abs(zoomStep(zoomStep(1, 1), -1) - 1)).toBeLessThan(0.1);
  });
});

describe("zoomLabel", () => {
  it("formats as a percentage", () => {
    expect(zoomLabel(1)).toBe("100%");
    expect(zoomLabel(0.5)).toBe("50%");
    expect(zoomLabel(2)).toBe("200%");
  });
});
