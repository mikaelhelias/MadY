// Top and right-hand axes — the same label placement, mirrored, for label
// rotation on Y2 / Y3 / X2 axes. The second value axis runs down the right of a vertical chart (Y3 beyond it) and along the top of a
// horizontal one. Guards against their Axis tab's "Label rotation" being stored while every label is drawn
// level because nothing places a turned label on those sides.
import { describe, expect, it } from "vitest";
import { xTickLabelPlacement, yTickLabelPlacement } from "./xTickLabel.js";

const FONT = 13;
const GAP = 6;

/**
 * The oracle: apply SVG's own rotate(θ cx cy) to the corners of the text as SVG lays it out — `start` runs right
 * from x, `end` runs left to x; glyphs from 0.8 of the font above the baseline to 0.2 below. Shares no code with
 * the formula under test.
 */
function drawnCorners(p: ReturnType<typeof xTickLabelPlacement>, rot: number, width: number): { x: number; y: number }[] {
  const x0 = p.anchor === "start" ? p.x : p.anchor === "end" ? p.x - width : p.x - width / 2;
  const corners = [
    [x0, p.y - 0.8 * FONT], [x0 + width, p.y - 0.8 * FONT],
    [x0, p.y + 0.2 * FONT], [x0 + width, p.y + 0.2 * FONT],
  ];
  const cx = p.pivot?.x ?? 0;
  const cy = p.pivot?.y ?? 0;
  const a = (rot * Math.PI) / 180;
  return corners.map(([x, y]) => ({
    x: cx + (x! - cx) * Math.cos(a) - (y! - cy) * Math.sin(a),
    y: cy + (x! - cx) * Math.sin(a) + (y! - cy) * Math.cos(a),
  }));
}
const inside = (c: { x: number; y: number }, b: { x1: number; y1: number; x2: number; y2: number }): boolean =>
  c.x >= b.x1 - 0.5 && c.x <= b.x2 + 0.5 && c.y >= b.y1 - 0.5 && c.y <= b.y2 + 0.5;

describe("xTickLabelPlacement on a top axis (the X2 axis of a horizontal chart)", () => {
  const EDGE = 60; // where the ticks end, above the plot

  it("places a level label centred just above the top axis", () => {
    const p = xTickLabelPlacement(120, EDGE, FONT, GAP, 0, 50, "top");
    expect(p).toMatchObject({ x: 120, y: EDGE - GAP, anchor: "middle" });
    expect(p.pivot).toBeUndefined();
  });

  for (const rot of [45, 90, -45, -90, 30, -60]) {
    it(`${rot}°: every drawn corner is above the axis and inside the reported outline`, () => {
      for (const width of [8, 60, 180]) {
        const p = xTickLabelPlacement(120, EDGE, FONT, GAP, rot, width, "top");
        expect(p.pivot, `${rot}°: a turned label has no turning point`).toBeDefined();
        for (const c of drawnCorners(p, rot, width)) {
          expect(c.y, `${rot}° width ${width}: a corner reaches down past the ticks into the plot`).toBeLessThanOrEqual(EDGE);
          expect(inside(c, p.box), `${rot}° width ${width}: a corner lies outside the reported outline`).toBe(true);
        }
      }
    });
  }

  it("a turned label comes no closer to the axis than a horizontal label's baseline", () => {
    for (const rot of [45, 90, -45, -90]) {
      expect(xTickLabelPlacement(120, EDGE, FONT, GAP, rot, 80, "top").box.y2).toBeLessThanOrEqual(EDGE - GAP + 0.5);
    }
  });

  it("a 90° label is centred on its tick and rises by its own length", () => {
    for (const rot of [90, -90]) {
      const p = xTickLabelPlacement(120, EDGE, FONT, GAP, rot, 100, "top");
      const xs = drawnCorners(p, rot, 100).map((c) => c.x);
      expect(Math.abs((Math.min(...xs) + Math.max(...xs)) / 2 - 120), `${rot}°: off to one side of its tick`).toBeLessThan(FONT * 0.15);
      expect(p.box.y2 - p.box.y1).toBeCloseTo(100, 5);
    }
  });
});

describe("yTickLabelPlacement on a right-hand axis (Y2, and Y3 beyond it)", () => {
  const AXIS = 500; // the axis line the labels sit beside

  it("places a level label just right of the right axis", () => {
    const p = yTickLabelPlacement(200, AXIS, FONT, GAP, 0, 40, "right");
    expect(p).toMatchObject({ x: AXIS + GAP, y: 200 + FONT * 0.34, anchor: "start" });
    expect(p.pivot).toBeUndefined();
  });

  for (const rot of [45, 90, -45, -90, 30, -60]) {
    it(`${rot}°: every drawn corner is right of the axis and inside the reported outline`, () => {
      for (const width of [8, 60, 180]) {
        const p = yTickLabelPlacement(200, AXIS, FONT, GAP, rot, width, "right");
        expect(p.pivot, `${rot}°: a turned label has no turning point`).toBeDefined();
        for (const c of drawnCorners(p, rot, width)) {
          expect(c.x, `${rot}° width ${width}: a corner reaches left across the axis into the plot`).toBeGreaterThanOrEqual(AXIS + GAP - 0.5);
          expect(inside(c, p.box), `${rot}° width ${width}: a corner lies outside the reported outline`).toBe(true);
        }
      }
    });
  }

  it("±90° is centred on its tick", () => {
    for (const rot of [90, -90]) {
      const p = yTickLabelPlacement(200, AXIS, FONT, GAP, rot, 100, "right");
      const ys = drawnCorners(p, rot, 100).map((c) => c.y);
      expect(Math.abs((Math.min(...ys) + Math.max(...ys)) / 2 - 200), `${rot}°: not centred on its tick`).toBeLessThan(1);
    }
  });

  it("a turned label needs the same room beside the axis on the right as on the left", () => {
    for (const rot of [45, 90, -45, -90]) {
      const left = yTickLabelPlacement(200, AXIS, FONT, GAP, rot, 70);
      const right = yTickLabelPlacement(200, AXIS, FONT, GAP, rot, 70, "right");
      expect(right.box.x2 - (AXIS + GAP)).toBeCloseTo(AXIS - GAP - left.box.x1, 6);
    }
  });
});
