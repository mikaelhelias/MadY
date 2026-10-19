import { describe, expect, it } from "vitest";
import type { PlotScene } from "./scene.js";
import { staggerLineCaptions } from "./lineCaptions.js";

const m = (t: string, px: number): number => t.length * px * 0.6;
const scene = (xs: [number, string][]): PlotScene =>
  ({ fonts: { legend: { size: 10 } }, annotations: xs.map(([x, label], i) => ({ id: `v${i}`, kind: "line", x1: x, x2: x, y1: 20, y2: 200, label, labelX: x + 4, labelY: 32, labelAnchor: "start" })) }) as unknown as PlotScene;

describe("staggerLineCaptions", () => {
  it("leaves names that do not touch where they were", () => {
    const s = scene([[10, "A"], [100, "B"]]);
    staggerLineCaptions(s, m);
    expect(s.annotations.map((a) => a.labelY)).toEqual([32, 32]);
  });
  it("drops a name that would run into its neighbour one line lower, and no two names overlap", () => {
    const s = scene([[10, "Disease onset"], [40, "Treatment"], [120, "Later"]]);
    staggerLineCaptions(s, m);
    expect(s.annotations.map((a) => a.labelY)).toEqual([32, 44.5, 32]);
  });
  it("reuses the top line once it is free again", () => {
    const s = scene([[10, "Travel"], [30, "Diet change"], [60, "Onset"]]);
    staggerLineCaptions(s, m);
    const ys = s.annotations.map((a) => a.labelY);
    expect(ys[1]).toBeGreaterThan(32);
    expect(ys[2]).toBe(32);
  });
});
