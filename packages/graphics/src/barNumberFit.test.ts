import { describe, expect, it } from "vitest";
import { barNumberSpots, fitBarNumbers, type NumberSpot } from "./barNumberFit";

const measure = (t: string, s: number): number => t.length * s * 0.6;
const scene = { valueLabels: { dy: 0 } };
/** `n` bars `pitch` px apart, all as tall as each other, each carrying `text`. */
const row = (n: number, pitch: number, text = "1.96"): NumberSpot[] =>
  Array.from({ length: n }, (_, i) => ({ bar: { x: i * pitch + 2, y: 100, w: pitch - 4, h: 80 }, value: 1.96, text }));

describe("fitBarNumbers", () => {
  it("keeps the size asked for when the numbers already clear each other", () => {
    expect(fitBarNumbers(row(5, 60), 13, measure, scene)).toEqual({ font: 13, keep: null });
  });

  it("one number, or none, has nothing to collide with", () => {
    expect(fitBarNumbers(row(1, 5), 13, measure, scene)).toEqual({ font: 13, keep: null });
    expect(fitBarNumbers([], 13, measure, scene)).toEqual({ font: 13, keep: null });
  });

  it("shrinks to the largest whole size at which neighbours clear, and drops nothing", () => {
    const r = fitBarNumbers(row(10, 24), 13, measure, scene);
    expect(r.keep).toBeNull();
    expect(r.font).toBeLessThan(13);
    expect(r.font).toBeGreaterThanOrEqual(7);
    // One size larger would collide: 4 chars x 0.6 x size + 2 px gap > the 24 px pitch.
    expect(measure("1.96", r.font + 1) + 2).toBeGreaterThan(24);
    expect(measure("1.96", r.font) + 2).toBeLessThanOrEqual(24);
  });

  it("neighbours at clearly different heights do not collide, so nothing shrinks", () => {
    const spots = row(6, 20).map((s, i) => ({ ...s, bar: { ...s.bar, y: 40 + i * 30 } }));
    expect(fitBarNumbers(spots, 13, measure, scene)).toEqual({ font: 13, keep: null });
  });

  it("past the readable floor keeps every k-th number from the left, the same stride all along", () => {
    const r = fitBarNumbers(row(40, 12), 13, measure, scene);
    expect(r.font).toBe(7);
    expect(r.keep).not.toBeNull();
    const kept = [...r.keep!].sort((a, b) => a - b);
    const stride = kept[1]! - kept[0]!;
    expect(stride).toBeGreaterThanOrEqual(2);
    kept.slice(1).forEach((v, i) => expect(v - kept[i]!).toBe(stride));
    expect(kept[0]).toBe(0);
  });

  it("a requested size already under the floor is never raised", () => {
    expect(fitBarNumbers(row(40, 12), 6, measure, scene).font).toBe(6);
  });
});

describe("barNumberSpots", () => {
  const mark = (dy: number, extra: Record<string, unknown> = {}) => ({ rowId: "r", rowNumber: 1, dx: 1, dy, cx: 0, cy: 0, n: 1, label: "a", bar: { x: 0, y: 0, w: 10, h: 10 }, ...extra });
  const series = [{ marks: [mark(1.5), mark(NaN), mark(2, { valueText: "" }), mark(3, { valueText: "three" }), { ...mark(4), bar: undefined }] }] as never;

  it("lists only the bars that print a number, in drawing order, with the text the renderer prints", () => {
    const { spots, marks } = barNumberSpots(series, 1);
    expect(spots.map((s) => s.text)).toEqual(["1.5", "three"]);
    expect(marks).toHaveLength(2);
  });
});
