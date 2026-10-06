// Where an X tick label is drawn — one formula for the renderer that draws it and the layout that
// makes room below it. Guards against rotated labels that end at the tick whichever way they turn,
// so +45° and +90° run up into the plot, with no room made for the length they hang down.
import { describe, expect, it } from "vitest";
import { xTickLabelPlacement } from "./xTickLabel.js";

const AXIS = 400; // the plot's bottom edge
const FONT = 13;
const GAP = 6;

/**
 * The oracle: apply SVG's own rotate(θ cx cy) to the corners of the text as SVG lays it out —
 * `start` runs right from x, `end` runs left to x; glyphs from 0.8 of the font above the baseline to
 * 0.2 below — and return the drawn corners. Shares no code with the formula under test.
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

describe("xTickLabelPlacement", () => {
  it("leaves a horizontal label at the renderer's default position", () => {
    const p = xTickLabelPlacement(120, AXIS, FONT, GAP, 0, 50);
    expect(p).toMatchObject({ x: 120, y: AXIS + FONT + GAP, anchor: "middle" });
    expect(p.pivot).toBeUndefined();
  });

  for (const rot of [45, 90, -45, -90, 30, -60]) {
    it(`${rot}°: every drawn corner is below the axis and inside the reported outline`, () => {
      for (const width of [8, 60, 180]) {
        const p = xTickLabelPlacement(120, AXIS, FONT, GAP, rot, width);
        const pts = drawnCorners(p, rot, width);
        for (const c of pts) {
          expect(c.y, `${rot}° width ${width}: a corner reaches up into the plot`).toBeGreaterThan(AXIS);
          expect(c.y).toBeGreaterThanOrEqual(p.box.y1 - 0.5);
          expect(c.y).toBeLessThanOrEqual(p.box.y2 + 0.5);
          expect(c.x).toBeGreaterThanOrEqual(p.box.x1 - 0.5);
          expect(c.x).toBeLessThanOrEqual(p.box.x2 + 0.5);
        }
      }
    });
  }

  it("a positive turn starts at the tick and runs down to the right; a negative one ends at the tick, coming up from the left", () => {
    const down = xTickLabelPlacement(120, AXIS, FONT, GAP, 45, 100);
    const up = xTickLabelPlacement(120, AXIS, FONT, GAP, -45, 100);
    expect(down.anchor).toBe("start");
    expect(up.anchor).toBe("end");
    expect(down.box.x2 - 120).toBeGreaterThan(60);
    expect(120 - up.box.x1).toBeGreaterThan(60);
  });

  it("a 90° label is centred on its tick and hangs down by its own length", () => {
    for (const rot of [90, -90]) {
      const p = xTickLabelPlacement(120, AXIS, FONT, GAP, rot, 100);
      const pts = drawnCorners(p, rot, 100);
      const mid = (Math.min(...pts.map((c) => c.x)) + Math.max(...pts.map((c) => c.x))) / 2;
      expect(Math.abs(mid - 120), `${rot}°: the label is off to one side of its tick`).toBeLessThan(FONT * 0.15);
      expect(p.box.y2 - p.box.y1).toBeCloseTo(100, 5);
    }
  });

  it("a longer label reaches further down; a steeper turn reaches further down", () => {
    const at = (rot: number, w: number) => xTickLabelPlacement(120, AXIS, FONT, GAP, rot, w).box.y2;
    expect(at(45, 120)).toBeGreaterThan(at(45, 60));
    expect(at(90, 120)).toBeGreaterThan(at(45, 120));
  });

  it("a rotated label starts no further from the axis than a horizontal one does", () => {
    const flatTop = AXIS + GAP + FONT - 0.8 * FONT;
    for (const rot of [45, 90, -45, -90]) {
      const p = xTickLabelPlacement(120, AXIS, FONT, GAP, rot, 80);
      expect(p.box.y1).toBeLessThanOrEqual(flatTop + 1);
    }
  });
});
