import { describe, it, expect } from "vitest";
import {
  clipHalfPlane,
  ellipsePolygon,
  polygonArea,
  polygonCentroid,
  powerCell,
  rectPolygon,
  voronoiTreemap,
  type Polygon,
} from "./voronoiTreemap.js";

const UNIT_SQUARE: Polygon = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

describe("polygon primitives", () => {
  it("polygonArea: unit square = 1, winding-agnostic", () => {
    expect(polygonArea(UNIT_SQUARE)).toBeCloseTo(1, 10);
    expect(polygonArea([...UNIT_SQUARE].reverse())).toBeCloseTo(1, 10);
  });
  it("polygonArea: right triangle = 0.5; degenerate < 3 pts = 0", () => {
    expect(polygonArea([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 2 }])).toBeCloseTo(2, 10);
    expect(polygonArea([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(0);
  });
  it("polygonCentroid: unit square = (0.5, 0.5)", () => {
    const c = polygonCentroid(UNIT_SQUARE);
    expect(c.x).toBeCloseTo(0.5, 10);
    expect(c.y).toBeCloseTo(0.5, 10);
  });
});

describe("clipHalfPlane", () => {
  it("clips the unit square by x ≤ 0.5 → left half (area 0.5)", () => {
    const clipped = clipHalfPlane(UNIT_SQUARE, 1, 0, 0.5);
    expect(polygonArea(clipped)).toBeCloseTo(0.5, 10);
    for (const p of clipped) expect(p.x).toBeLessThanOrEqual(0.5 + 1e-9);
  });
  it("keeps a fully-inside polygon unchanged and drops a fully-outside one", () => {
    expect(polygonArea(clipHalfPlane(UNIT_SQUARE, 1, 0, 5))).toBeCloseTo(1, 10);
    expect(clipHalfPlane(UNIT_SQUARE, 1, 0, -5)).toHaveLength(0);
  });
});

describe("powerCell", () => {
  it("with equal weights, the bisector is the midline (ordinary Voronoi)", () => {
    const sites = [{ x: 0.25, y: 0.5 }, { x: 0.75, y: 0.5 }];
    const cell0 = powerCell(0, sites, [0, 0], UNIT_SQUARE);
    // Equal-weight bisector of two horizontally-separated sites is x = 0.5.
    expect(polygonArea(cell0)).toBeCloseTo(0.5, 6);
    for (const p of cell0) expect(p.x).toBeLessThanOrEqual(0.5 + 1e-6);
  });
  it("a larger weight pushes the bisector toward the other site (bigger cell)", () => {
    const sites = [{ x: 0.25, y: 0.5 }, { x: 0.75, y: 0.5 }];
    const heavy = powerCell(0, sites, [0.05, 0], UNIT_SQUARE);
    expect(polygonArea(heavy)).toBeGreaterThan(0.5);
  });
});

describe("voronoiTreemap", () => {
  const boundary = rectPolygon(0, 0, 100, 100);
  const boundaryArea = 100 * 100;

  it("tiles the boundary: cell areas sum to the boundary area", () => {
    const cells = voronoiTreemap([3, 2, 1, 1, 1], boundary);
    const sum = cells.reduce((a, c) => a + c.area, 0);
    expect(sum).toBeCloseTo(boundaryArea, 2);
    for (const c of cells) expect(c.polygon.length).toBeGreaterThanOrEqual(3);
  });

  it("is deterministic for a fixed seed", () => {
    const a = voronoiTreemap([2, 1, 1], boundary, { seed: 42 });
    const b = voronoiTreemap([2, 1, 1], boundary, { seed: 42 });
    expect(a.map((c) => c.polygon)).toEqual(b.map((c) => c.polygon));
  });

  it("makes cell area roughly proportional to weight (skewed 4:1)", () => {
    const cells = voronoiTreemap([4, 1], boundary, { maxIterations: 300 });
    const ratio = cells[0]!.area / cells[1]!.area;
    // Converges near 4; allow a generous band (treemaps are approximate).
    expect(ratio).toBeGreaterThan(3);
    expect(ratio).toBeLessThan(5);
  });

  it("gives near-equal cells for equal weights", () => {
    const cells = voronoiTreemap([1, 1, 1, 1], boundary, { maxIterations: 300 });
    const targetEach = boundaryArea / 4;
    for (const c of cells) {
      expect(c.area).toBeGreaterThan(targetEach * 0.7);
      expect(c.area).toBeLessThan(targetEach * 1.3);
    }
  });

  it("respects area proportions within tolerance on an ellipse boundary", () => {
    const ell = ellipsePolygon(50, 50, 50, 40);
    const ellArea = polygonArea(ell);
    const weights = [5, 3, 2, 1];
    const cells = voronoiTreemap(weights, ell, { maxIterations: 300 });
    const total = weights.reduce((a, b) => a + b, 0);
    cells.forEach((c, i) => {
      const targetFrac = weights[i]! / total;
      const actualFrac = c.area / ellArea;
      expect(Math.abs(actualFrac - targetFrac)).toBeLessThan(0.08);
    });
  });

  it("a single positive weight fills the whole boundary", () => {
    const cells = voronoiTreemap([0, 5, 0], boundary);
    expect(cells[1]!.area).toBeCloseTo(boundaryArea, 6);
    expect(cells[0]!.polygon).toHaveLength(0);
    expect(cells[2]!.polygon).toHaveLength(0);
  });

  it("zero / negative weights produce empty cells, positives still tile", () => {
    const cells = voronoiTreemap([2, 0, -3, 1], boundary);
    expect(cells[1]!.polygon).toHaveLength(0);
    expect(cells[2]!.polygon).toHaveLength(0);
    const sum = cells.reduce((a, c) => a + c.area, 0);
    expect(sum).toBeCloseTo(boundaryArea, 2);
  });

  it("handles an empty input and a zero-area boundary gracefully", () => {
    expect(voronoiTreemap([], boundary)).toEqual([]);
    const flat = voronoiTreemap([1, 1], rectPolygon(0, 0, 0, 10));
    for (const c of flat) expect(c.area).toBe(0);
  });
});
