import { describe, expect, it } from "vitest";
import { distanceToPolyline, nearestFitCurve, parseLinePath } from "./fitCurveHit";

describe("parseLinePath", () => {
  it("reads the points of a d3 line path", () => {
    expect(parseLinePath("M10.5,20L30,40.25L50,-5")).toEqual([[10.5, 20], [30, 40.25], [50, -5]]);
  });
  it("reads exponent and leading-dot numbers, and an empty path gives no points", () => {
    expect(parseLinePath("M1e2,.5L3,4")).toEqual([[100, 0.5], [3, 4]]);
    expect(parseLinePath("")).toEqual([]);
  });
});

describe("distanceToPolyline", () => {
  const line: [number, number][] = [[0, 0], [10, 0], [10, 10]];
  it("is zero on the line and the perpendicular distance beside a segment", () => {
    expect(distanceToPolyline(line, [5, 0])).toBe(0);
    expect(distanceToPolyline(line, [5, 3])).toBe(3);
    expect(distanceToPolyline(line, [13, 5])).toBe(3);
  });
  it("measures to the end point beyond a segment's end", () => {
    expect(distanceToPolyline(line, [-3, -4])).toBe(5);
  });
  it("a single point or no points", () => {
    expect(distanceToPolyline([[1, 1]], [4, 5])).toBe(5);
    expect(distanceToPolyline([], [0, 0])).toBe(Infinity);
  });
});

describe("nearestFitCurve", () => {
  const a = { key: "a", points: [[0, 0], [100, 0]] as [number, number][], tolerance: 7 };
  const b = { key: "b", points: [[0, 4], [100, 4]] as [number, number][], tolerance: 7 };
  it("picks the nearer of two curves close to the point", () => {
    expect(nearestFitCurve([a, b], [50, 3])?.key).toBe("b");
    expect(nearestFitCurve([a, b], [50, 1])?.key).toBe("a");
  });
  it("picks nothing when no curve is within its reach", () => {
    expect(nearestFitCurve([a, b], [50, 40])).toBeNull();
  });
  it("each curve has its own reach", () => {
    expect(nearestFitCurve([{ ...a, tolerance: 2 }], [50, 5])).toBeNull();
    expect(nearestFitCurve([{ ...a, tolerance: 6 }], [50, 5])?.key).toBe("a");
  });
});
