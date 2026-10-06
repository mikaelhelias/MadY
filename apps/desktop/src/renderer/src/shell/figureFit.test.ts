// @vitest-environment node
/**
 * The startup fit. Pure maths, so the parts that matter are cheap to pin:
 * the proportions are kept, the scale is capped, and the fit declines where it cannot help.
 */
import { describe, expect, it } from "vitest";
import {
  FIGURE_DEFAULT_H,
  FIGURE_DEFAULT_W,
  FIGURE_FIT_MAX_SCALE,
  FIGURE_FIT_PAD,
  fitFigureSize,
} from "./figureFit";

const ASPECT = FIGURE_DEFAULT_W / FIGURE_DEFAULT_H;

describe("fitFigureSize", () => {
  it("keeps the figure's proportions exactly — it scales, never stretches", () => {
    // Every roomy shape, including absurdly wide and tall ones, must come back at the same
    // aspect ratio as the default.
    const shapes: Array<[number, number]> = [[900, 700], [4000, 700], [900, 4000], [1339, 944], [689, 630]];
    for (const [w, h] of shapes) {
      const got = fitFigureSize(w, h);
      if (!got) continue;
      expect(got.width / got.height, `${w}x${h} came back distorted`).toBeCloseTo(ASPECT, 2);
    }
  });

  it("never exceeds the scale cap, however much room there is", () => {
    const huge = fitFigureSize(10000, 10000)!;
    expect(huge.width).toBe(Math.round(FIGURE_DEFAULT_W * FIGURE_FIT_MAX_SCALE));
    expect(huge.height).toBe(Math.round(FIGURE_DEFAULT_H * FIGURE_FIT_MAX_SCALE));
  });

  it("fits inside the space, with room to breathe on both axes", () => {
    const shapes: Array<[number, number]> = [[900, 700], [1339, 944], [1000, 520]];
    for (const [w, h] of shapes) {
      const got = fitFigureSize(w, h);
      if (!got) continue;
      expect(got.width, `${w}x${h}: overflows horizontally`).toBeLessThanOrEqual(w - FIGURE_FIT_PAD);
      expect(got.height, `${w}x${h}: overflows vertically`).toBeLessThanOrEqual(h - FIGURE_FIT_PAD);
    }
  });

  it("is limited by the tighter axis — a wide, short column does not grow the figure tall", () => {
    // 2000px wide but only 420 tall: the height is what binds.
    const got = fitFigureSize(2000, 420);
    expect(got).not.toBeNull();
    expect(got!.height).toBeLessThanOrEqual(420 - FIGURE_FIT_PAD);
  });

  it("declines rather than shrinking below the default", () => {
    // Below 1x a figure stops being readable, and the pane already scrolls.
    expect(fitFigureSize(FIGURE_DEFAULT_W, FIGURE_DEFAULT_H)).toBeNull();
    expect(fitFigureSize(400, 300)).toBeNull();
    expect(fitFigureSize(FIGURE_DEFAULT_W + FIGURE_FIT_PAD, FIGURE_DEFAULT_H + FIGURE_FIT_PAD)).toBeNull();
  });

  it("declines on a space that has not been laid out yet, or is invalid", () => {
    // The first paint measures 0 — fitting to that would latch a broken size for the session.
    expect(fitFigureSize(0, 0)).toBeNull();
    expect(fitFigureSize(-100, 500)).toBeNull();
    expect(fitFigureSize(NaN, 500)).toBeNull();
    expect(fitFigureSize(Infinity, 500)).toBeNull();
  });

  it("grows the figure in typical window sizes", () => {
    // A 1269x766 window leaves a 689x630 column; 1920x1080 leaves 1339x944. Both use more than the default.
    const small = fitFigureSize(689, 630)!;
    const large = fitFigureSize(1339, 944)!;
    expect(small.width).toBeGreaterThan(FIGURE_DEFAULT_W);
    expect(large.width).toBeGreaterThan(small.width);
    expect(large.width).toBe(Math.round(FIGURE_DEFAULT_W * FIGURE_FIT_MAX_SCALE)); // capped
  });
});
