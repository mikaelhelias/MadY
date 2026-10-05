import { describe, expect, it } from "vitest";
import { chiSquareScale, covarianceEllipse } from "./ellipse";

describe("chiSquareScale", () => {
  it("returns the √χ²₂ radius scale for a confidence level", () => {
    expect(chiSquareScale(0.95)).toBeCloseTo(2.4477, 3); // the standard 95% ellipse
    // (NB: in 2-D the 68.27% confidence region is √2.296 ≈ 1.515σ, not 1σ.)
    expect(chiSquareScale(0.6827)).toBeCloseTo(1.515, 2);
    expect(chiSquareScale(0.99)).toBeCloseTo(3.0349, 3);
    expect(chiSquareScale(0.9)).toBeCloseTo(2.1460, 3);
  });
});

describe("covarianceEllipse", () => {
  it("returns null for fewer than 3 points", () => {
    expect(covarianceEllipse([{ x: 0, y: 0 }, { x: 1, y: 1 }], 2)).toBeNull();
  });

  it("an x-elongated cloud → major axis horizontal (angle ≈ 0, rx > ry)", () => {
    const pts = [
      { x: -2, y: 0.05 },
      { x: -1, y: -0.05 },
      { x: 0, y: 0.02 },
      { x: 1, y: -0.03 },
      { x: 2, y: 0.04 },
    ];
    const e = covarianceEllipse(pts, 2)!;
    expect(e).not.toBeNull();
    expect(Math.abs(e.angle)).toBeLessThan(5); // ~horizontal
    expect(e.rx).toBeGreaterThan(e.ry);
    expect(e.cx).toBeCloseTo(0, 5);
  });

  it("a y-elongated cloud → major axis vertical (|angle| ≈ 90)", () => {
    const pts = [
      { x: 0.05, y: -2 },
      { x: -0.05, y: -1 },
      { x: 0.02, y: 0 },
      { x: -0.03, y: 1 },
      { x: 0.04, y: 2 },
    ];
    const e = covarianceEllipse(pts, 2)!;
    expect(Math.abs(e.angle)).toBeCloseTo(90, 0);
    expect(e.rx).toBeGreaterThan(e.ry);
  });

  it("a 45° cloud → major axis at ~45°, scaled by nSigma", () => {
    const pts = [
      { x: -2, y: -2.02 },
      { x: -1, y: -0.98 },
      { x: 0, y: 0.01 },
      { x: 1, y: 1.03 },
      { x: 2, y: 1.98 },
    ];
    const e = covarianceEllipse(pts, 2)!;
    expect(e.angle).toBeCloseTo(45, 0);
    // larger nSigma → proportionally larger radii
    const e2 = covarianceEllipse(pts, 4)!;
    expect(e2.rx / e.rx).toBeCloseTo(2, 5);
  });
});
