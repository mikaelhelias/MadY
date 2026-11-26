import { describe, expect, it } from "vitest";
import { spreadAlong } from "./spreadAlong";

const clear = (items: { center: number; length: number }[], at: number[], gap: number): boolean => {
  const e = items.map((it, i) => ({ lo: at[i]! - it.length / 2, hi: at[i]! + it.length / 2 })).sort((a, b) => a.lo - b.lo);
  return e.every((x, i) => i === 0 || x.lo >= e[i - 1]!.hi + gap - 1e-6);
};

describe("spreadAlong", () => {
  it("does not move labels that already clear each other", () => {
    expect(spreadAlong([{ center: 50, length: 40 }, { center: 150, length: 40 }], 0, 200, 6)).toEqual([50, 150]);
  });

  it("shares the push equally between two names that overlap", () => {
    // Groups 97 px apart; the names are 94 and 111 px long, so they overlap by 5.5 px before any gap.
    const items = [{ center: 167.5, length: 94 }, { center: 264.5, length: 111 }];
    const at = spreadAlong(items, 0, 380, 6)!;
    expect(clear(items, at, 6)).toBe(true);
    expect(167.5 - at[0]!).toBeCloseTo(at[1]! - 264.5, 6); // each gives way by the same amount
    expect(167.5 - at[0]!).toBeCloseTo((5.5 + 6) / 2, 6);
  });

  it("keeps every label on the line, pushing back from an end", () => {
    const items = [{ center: 20, length: 60 }, { center: 50, length: 60 }, { center: 80, length: 60 }];
    const at = spreadAlong(items, 0, 200, 4)!;
    expect(clear(items, at, 4)).toBe(true);
    expect(at[0]! - 30).toBeGreaterThanOrEqual(-1e-6);
    expect(at[2]! + 30).toBeLessThanOrEqual(200 + 1e-6);
  });

  it("keeps the labels in order and answers in the order it was asked", () => {
    const items = [{ center: 120, length: 80 }, { center: 100, length: 80 }];
    const at = spreadAlong(items, 0, 400, 0)!;
    expect(at[1]!).toBeLessThan(at[0]!);
    expect(clear(items, at, 0)).toBe(true);
  });

  it("returns null when the labels are together longer than the line — moving cannot help", () => {
    expect(spreadAlong([{ center: 50, length: 120 }, { center: 150, length: 120 }], 0, 200, 6)).toBeNull();
  });

  it("an empty list is an empty answer", () => {
    expect(spreadAlong([], 0, 100, 6)).toEqual([]);
  });
});
