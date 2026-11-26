// `thinCrowdedNumbers` — numbers along an axis that would sit on each other are thinned to every k-th.
// The gallery-wide check is apps/desktop/src/renderer/src/shell/tick-numbers-never-stack.test.ts; this pins the rule itself.
import { describe, expect, it } from "vitest";
import { thinCrowdedNumbers } from "./buildScene";
import type { AxisScene, AxisTick } from "./scene";

const measure = (text: string, px: number): number => text.length * px * 0.556;
const axis = (values: number[], pitch: number, extra: Partial<AxisScene> = {}): AxisScene => ({
  type: "linear",
  domain: [values[0]!, values[values.length - 1]!],
  range: [values.length * pitch, 0],
  ticks: values.map((v, i): AxisTick => ({ value: v, pos: (values.length - i) * pitch, label: String(v), minor: false })),
  title: "",
  ...extra,
} as AxisScene);
const shown = (ax: AxisScene): string[] => ax.ticks.filter((t) => t.label !== "").map((t) => t.label);

describe("thinCrowdedNumbers", () => {
  it("leaves an axis alone when its numbers already clear each other", () => {
    const ax = axis([1, 2, 3, 4, 5, 6, 7, 8], 60);
    expect(thinCrowdedNumbers(ax, 30, "y", measure)).toBe(0);
    expect(shown(ax)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8"]);
  });

  it("keeps every 2nd number when 30 px type is stacked 28 px apart (as on a QQ plot)", () => {
    const ax = axis([1, 2, 3, 4, 5, 6, 7, 8], 28.4);
    expect(thinCrowdedNumbers(ax, 30, "y", measure)).toBe(4);
    expect(shown(ax)).toEqual(["1", "3", "5", "7"]);
    // Only the text goes: the tick keeps its mark, its gridline and its identity.
    expect(ax.ticks).toHaveLength(8);
    expect(ax.ticks.find((t) => t.value === 2)?.suppressedLabel).toBe("2");
  });

  it("takes a wider step when every 2nd still collides", () => {
    const ax = axis([1, 2, 3, 4, 5, 6, 7, 8, 9], 15);
    thinCrowdedNumbers(ax, 30, "y", measure);
    expect(shown(ax)).toEqual(["1", "4", "7"]);
  });

  it("keeps zero among the numbers that stay", () => {
    const ax = axis([-1.5, -1, -0.5, 0, 0.5, 1, 1.5], 28);
    thinCrowdedNumbers(ax, 30, "y", measure);
    expect(shown(ax)).toEqual(["-1", "0", "1"]);
  });

  it("thins along X by the labels' width — the forest plot's 0.4 × 0.6", () => {
    const ax = axis([0.4, 0.6, 0.8, 1, 1.2, 1.4], 35.5);
    thinCrowdedNumbers(ax, 30, "x", measure);
    expect(shown(ax)).toEqual(["0.4", "0.8", "1.2"]);
  });

  it("never thins category names, turned labels, a hidden axis, or a tick the user added", () => {
    const names = axis([1, 2, 3, 4], 10, { band: true });
    expect(thinCrowdedNumbers(names, 30, "y", measure)).toBe(0);
    const turned = axis([1, 2, 3, 4], 10, { tickRotation: 45 });
    expect(thinCrowdedNumbers(turned, 30, "y", measure)).toBe(0);
    const hidden = axis([1, 2, 3, 4], 10, { hidden: true });
    expect(thinCrowdedNumbers(hidden, 30, "y", measure)).toBe(0);

    const ax = axis([1, 2, 3, 4, 5, 6, 7, 8], 28.4);
    const mine = ax.ticks.find((t) => t.value === 2)!;
    thinCrowdedNumbers(ax, 30, "y", measure, new Set([mine]));
    expect(mine.label).toBe("2");
  });
});
