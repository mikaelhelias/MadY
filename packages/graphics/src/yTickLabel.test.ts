// Where a Y tick label is drawn — one formula for the renderer and the layout. Checks that a turned Y label
// ends at the label gap whichever way it turns, rather than leaning into the plot (+45° / +90°) or running
// along the axis from the tick instead of sitting on it (±90°).
import { describe, expect, it } from "vitest";
import { yTickLabelPlacement } from "./xTickLabel.js";

const AXIS = 80; // the plot's left edge
const FONT = 13;
const GAP = 8;

/** SVG's own rotate(θ cx cy) applied to the text as SVG lays it out (glyphs 0.8 above the baseline, 0.2 below). */
function drawnCorners(p: ReturnType<typeof yTickLabelPlacement>, rot: number, width: number): { x: number; y: number }[] {
  const x0 = p.anchor === "start" ? p.x : p.anchor === "end" ? p.x - width : p.x - width / 2;
  const corners = [[x0, p.y - 0.8 * FONT], [x0 + width, p.y - 0.8 * FONT], [x0, p.y + 0.2 * FONT], [x0 + width, p.y + 0.2 * FONT]];
  const cx = p.pivot?.x ?? 0;
  const cy = p.pivot?.y ?? 0;
  const a = (rot * Math.PI) / 180;
  return corners.map(([x, y]) => ({
    x: cx + (x! - cx) * Math.cos(a) - (y! - cy) * Math.sin(a),
    y: cy + (x! - cx) * Math.sin(a) + (y! - cy) * Math.cos(a),
  }));
}

describe("yTickLabelPlacement", () => {
  it("places a level label end-anchored at the label gap, centred on its tick", () => {
    const p = yTickLabelPlacement(200, AXIS, FONT, GAP, 0, 40);
    expect(p).toMatchObject({ x: AXIS - GAP, y: 200 + FONT * 0.34, anchor: "end" });
    expect(p.pivot).toBeUndefined();
  });

  for (const rot of [45, 90, -45, -90, 30, -60, 85]) {
    it(`${rot}°: every drawn corner stays left of the axis and inside the reported outline`, () => {
      for (const width of [8, 60, 180]) {
        const p = yTickLabelPlacement(200, AXIS, FONT, GAP, rot, width);
        for (const c of drawnCorners(p, rot, width)) {
          expect(c.x, `${rot}° width ${width}: a corner reaches into the plot`).toBeLessThanOrEqual(AXIS - GAP + 0.5);
          expect(c.x).toBeGreaterThanOrEqual(p.box.x1 - 0.5);
          expect(c.x).toBeLessThanOrEqual(p.box.x2 + 0.5);
          expect(c.y).toBeGreaterThanOrEqual(p.box.y1 - 0.5);
          expect(c.y).toBeLessThanOrEqual(p.box.y2 + 0.5);
        }
      }
    });
  }

  it("a 90° label is centred on its tick and spans its own length along the axis", () => {
    for (const rot of [90, -90]) {
      const p = yTickLabelPlacement(200, AXIS, FONT, GAP, rot, 100);
      const ys = drawnCorners(p, rot, 100).map((c) => c.y);
      expect(Math.abs((Math.min(...ys) + Math.max(...ys)) / 2 - 200), `${rot}°: not centred on its tick`).toBeLessThan(0.5);
      expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(100, 0);
    }
  });

  it("+45° runs up from its tick and −45° runs down, both away from the plot", () => {
    const up = drawnCorners(yTickLabelPlacement(200, AXIS, FONT, GAP, 45, 100), 45, 100);
    const down = drawnCorners(yTickLabelPlacement(200, AXIS, FONT, GAP, -45, 100), -45, 100);
    expect(Math.min(...up.map((c) => c.y))).toBeLessThan(200 - 60);
    expect(Math.max(...up.map((c) => c.y))).toBeLessThan(200 + FONT);
    expect(Math.max(...down.map((c) => c.y))).toBeGreaterThan(200 + 60);
    expect(Math.min(...down.map((c) => c.y))).toBeGreaterThan(200 - FONT);
  });
});
