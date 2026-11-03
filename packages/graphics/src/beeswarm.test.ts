import { describe, expect, it } from "vitest";
import { beeswarmOffsets } from "./beeswarm";

/** Pairs of dots closer than their diameter (the overlap the swarm exists to remove). */
function overlaps(v: number[], o: number[], r: number): number {
  let n = 0;
  for (let i = 0; i < v.length; i++) for (let j = i + 1; j < v.length; j++) if (Math.hypot(v[i]! - v[j]!, o[i]! - o[j]!) < 2 * r - 1e-6) n++;
  return n;
}

describe("beeswarmOffsets", () => {
  it("dots far apart in value stay on the centre line", () => {
    expect(beeswarmOffsets([0, 50, 100], 5, 40)).toEqual([0, 0, 0]);
  });

  it("dots at the same value sit side by side, one diameter + the gap apart, alternating sides", () => {
    const o = beeswarmOffsets([10, 10, 10], 5, 100);
    expect(o[0]).toBe(0);
    expect(new Set(o.map((x) => Math.round(Math.abs(x))))).toEqual(new Set([0, 11]));
    expect(Math.sign(o[1]!)).toBe(-Math.sign(o[2]!));
    expect(overlaps([10, 10, 10], o, 5)).toBe(0);
  });

  it("no two dots overlap when the cap leaves room, whatever the values", () => {
    const v = [12, 13, 13.5, 15, 16, 16.2, 17, 20, 21, 21.5, 22, 30];
    const o = beeswarmOffsets(v, 6, 200);
    expect(overlaps(v, o, 6)).toBe(0);
    // …and the swarm is never wider than all its dots laid in one row (half of it on each side).
    expect(Math.max(...o.map(Math.abs))).toBeLessThanOrEqual((v.length * 13) / 2);
  });

  it("never leaves the cap: a crowded group keeps inside its bar", () => {
    const v = Array.from({ length: 20 }, () => 50);
    const o = beeswarmOffsets(v, 8, 12);
    expect(Math.max(...o.map(Math.abs))).toBeLessThanOrEqual(12 + 1e-9);
  });

  it("is deterministic and keeps the input order", () => {
    const v = [5, 1, 3, 1, 4];
    expect(beeswarmOffsets(v, 4, 30)).toEqual(beeswarmOffsets(v, 4, 30));
    expect(beeswarmOffsets(v, 4, 30)).toHaveLength(5);
  });

  it("the spread multiplier widens the spacing; a non-finite value stays at the centre", () => {
    const a = beeswarmOffsets([0, 0], 5, 100, 1);
    const b = beeswarmOffsets([0, 0], 5, 100, 2);
    expect(Math.abs(b[1]!)).toBeCloseTo(2 * Math.abs(a[1]!));
    expect(beeswarmOffsets([Number.NaN, 0], 5, 100)).toEqual([0, 0]);
  });
  it("a per-dot limit holds each dot inside its own cap; the others keep maxHalf", () => {
    const v = [10, 10, 10, 10, 10];
    const free = beeswarmOffsets(v, 5, 100);
    expect(Math.max(...free.map(Math.abs)), "the fixture must spread past the limit, or it proves nothing").toBeGreaterThan(8);
    const held = beeswarmOffsets(v, 5, 100, 1, 1, [3, 3, 3, 3, undefined]);
    for (let i = 0; i < 4; i++) expect(Math.abs(held[i]!), `dot ${i}`).toBeLessThanOrEqual(3 + 1e-9);
    expect(Math.abs(held[4]!)).toBeGreaterThan(3);
    // No limit given = exactly the unlimited layout.
    expect(beeswarmOffsets(v, 5, 100, 1, 1)).toEqual(free);
  });
});
