// The swarm dot radius — one formula for the dots the renderer draws and the ink labels must clear.
import { describe, expect, it } from "vitest";
import { swarmDotRadius } from "./markGeometry.js";

describe("swarmDotRadius", () => {
  it("is 0.6 of the series symbol size (the waterfall's size 14 draws 8.4px dots)", () => {
    expect(swarmDotRadius(14)).toBeCloseTo(8.4, 9);
    expect(swarmDotRadius(10)).toBeCloseTo(6, 9);
  });

  it("uses the house symbol size 4 when the series sets none", () => {
    expect(swarmDotRadius(undefined)).toBeCloseTo(2.4, 9);
  });

  it("never draws a dot smaller than 2px", () => {
    expect(swarmDotRadius(1)).toBe(2);
    expect(swarmDotRadius(0)).toBe(2);
  });
});
