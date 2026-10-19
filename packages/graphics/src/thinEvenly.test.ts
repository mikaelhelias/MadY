import { describe, expect, it } from "vitest";
import type { AxisTick } from "./scene.js";
import { thinTicksEvenly } from "./thinEvenly.js";

const measure = (t: string, px: number): number => t.length * px * 0.6;
const tick = (pos: number, label: string, extra: Partial<AxisTick> = {}): AxisTick => ({ value: pos, pos, label, minor: false, ...extra });
const kept = (ts: AxisTick[]): number[] => ts.map((t, i) => (t.label !== "" ? i : -1)).filter((i) => i >= 0);

describe("thinTicksEvenly — crowded range labels are thinned by a constant stride", () => {
  // Five-character labels at 14 px are 42 px of text; with the 6 px gap that needs a 48 px pitch, so a 40 px pitch crowds them.
  const PITCH = 40;
  const labels = ["0–4", "4–8", "8–12", "12–16", "16–20", "20–24", "24–28", "28–32", "32–36", "36–40"];
  const crowded = labels.map((l, i) => tick(20 + i * PITCH, l));

  it("keeps every label when they all fit", () => {
    const roomy = labels.map((l, i) => tick(20 + i * 120, l));
    expect(kept(thinTicksEvenly(roomy, measure, 14))).toEqual(labels.map((_, i) => i));
  });

  it("keeps every k-th label, starting with the first, for the smallest k that clears", () => {
    const out = thinTicksEvenly(crowded, measure, 14);
    const idx = kept(out);
    expect(idx[0]).toBe(0);
    const steps = idx.slice(1).map((v, i) => v - idx[i]!);
    expect(new Set(steps).size, `kept ${idx.join(",")}`).toBe(1);
    expect(steps[0]).toBeGreaterThan(1);
  });

  it("uses the smallest stride that clears, not a larger one", () => {
    const idx = kept(thinTicksEvenly(crowded, measure, 14));
    const k = idx[1]! - idx[0]!;
    // a stride one smaller would put two kept labels in contact
    const half = (t: string): number => measure(t, 14) / 2;
    const touches = (stride: number): boolean => labels.some((l, i) => i + stride < labels.length && PITCH * stride - half(l) - half(labels[i + stride]!) < 6);
    expect(touches(k)).toBe(false);
    expect(touches(k - 1)).toBe(true);
  });

  it("a blanked label keeps its text in suppressedLabel and the tick itself stays", () => {
    const out = thinTicksEvenly(crowded, measure, 14);
    out.forEach((t, i) => {
      expect(t.pos).toBe(crowded[i]!.pos);
      if (t.label === "") expect(t.suppressedLabel).toBe(labels[i]);
    });
  });

  it("restores a label an earlier pass blanked, and leaves minor ticks and the input alone", () => {
    const earlier = crowded.map((t, i) => (i === 1 ? { ...t, label: "", suppressedLabel: t.label } : t));
    const minor = tick(45, "", { minor: true });
    const input = [crowded[0]!, minor, ...earlier.slice(1)];
    const snapshot = JSON.stringify(input);
    const out = thinTicksEvenly(input, measure, 14);
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(out[1]).toEqual(minor);
    const idx = out.filter((t) => !t.minor).map((t, i) => (t.label !== "" ? i : -1)).filter((i) => i >= 0);
    const steps = idx.slice(1).map((v, i) => v - idx[i]!);
    expect(new Set(steps).size).toBe(1);
  });

  it("copes with no ticks and a single tick", () => {
    expect(thinTicksEvenly([], measure, 14)).toEqual([]);
    expect(kept(thinTicksEvenly([tick(10, "0–4")], measure, 14))).toEqual([0]);
  });
});
