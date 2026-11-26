import { describe, expect, it } from "vitest";
import { planEqualAspect, buildScale } from "./scale";

/**
 * Equal aspect — the plan that makes one data unit the same length on both axes.
 *
 * The invariant every case here checks is the same one the drawing depends on: after the plan is
 * applied, span/pixels must be equal on X and Y. Two properties are load-bearing beyond that —
 * the widened axis never loses any of the range it had (a point cannot be pushed out of view),
 * and an axis the user pinned by hand is never silently widened.
 */

/** Units of data per pixel — the quantity equal aspect equalises. */
const upx = (d: [number, number], px: number): number => Math.abs(d[1] - d[0]) / px;

describe("planEqualAspect", () => {
  it("widens the axis that is packed too tightly, and the two scales then match", () => {
    // X: 10 units over 400px = 0.025 u/px. Y: 10 units over 200px = 0.05 u/px.
    // Y is the coarser scale, so X must GROW to 0.05 u/px = 20 units over its 400px.
    const plan = planEqualAspect({ domain: [0, 10], px: 400 }, { domain: [0, 10], px: 200 });
    expect(plan.kind).toBe("ok");
    if (plan.kind !== "ok") return;
    expect(plan.axis).toBe("x");
    expect(plan.domain[1] - plan.domain[0]).toBeCloseTo(20, 9);
    expect(upx(plan.domain, 400)).toBeCloseTo(upx([0, 10], 200), 12);
  });

  it("grows the widened axis about its own centre, so the old range stays inside it", () => {
    const plan = planEqualAspect({ domain: [4, 6], px: 400 }, { domain: [0, 10], px: 200 });
    if (plan.kind !== "ok") throw new Error("expected a plan");
    expect(plan.domain[0]).toBeLessThan(4);
    expect(plan.domain[1]).toBeGreaterThan(6);
    expect((plan.domain[0] + plan.domain[1]) / 2).toBeCloseTo(5, 9);
  });

  it("widens Y when Y is the tighter axis", () => {
    const plan = planEqualAspect({ domain: [0, 100], px: 400 }, { domain: [0, 10], px: 400 });
    if (plan.kind !== "ok") throw new Error("expected a plan");
    expect(plan.axis).toBe("y");
    expect(upx(plan.domain, 400)).toBeCloseTo(upx([0, 100], 400), 12);
  });

  it("reports 'already' when the scales agree — a square box over a square domain", () => {
    expect(planEqualAspect({ domain: [0, 10], px: 300 }, { domain: [-5, 5], px: 300 }).kind).toBe("already");
  });

  it("refuses when both axes are pinned — there is nothing left to move", () => {
    const plan = planEqualAspect(
      { domain: [0, 10], px: 400, fixed: true },
      { domain: [0, 10], px: 200, fixed: true },
    );
    expect(plan.kind).toBe("blocked");
    if (plan.kind !== "blocked") return;
    expect(plan.reason).toMatch(/both axes/i);
  });

  it("a pinned axis is never re-ranged — the free one matches it instead", () => {
    // X is pinned. At rest X is the axis that would have grown; because it is pinned, Y follows.
    const plan = planEqualAspect({ domain: [0, 10], px: 400, fixed: true }, { domain: [0, 10], px: 200 });
    expect(plan.kind).toBe("ok");
    if (plan.kind !== "ok") return;
    expect(plan.axis).toBe("y");
    expect(upx(plan.domain, 200)).toBeCloseTo(upx([0, 10], 400), 12);
  });

  /**
   * The only case where shrinking is allowed. At rest an axis is never narrowed — that would crop
   * data nobody asked to hide. But a pinned axis states what the user wants to look at
   * (a hand-typed range, or the zoom window in force), so the free axis follows them in whichever
   * direction keeps the picture 1:1. Without this, zooming in on X leaves the map stretched again.
   */
  it("the free axis shrinks to follow a pinned axis when that is what 1:1 needs", () => {
    // X pinned to a narrow window: 1 unit over 400px. Y currently spans 10 over 200px.
    const plan = planEqualAspect({ domain: [4, 5], px: 400, fixed: true }, { domain: [0, 10], px: 200 });
    if (plan.kind !== "ok") throw new Error("expected a plan");
    expect(plan.axis).toBe("y");
    expect(plan.domain[1] - plan.domain[0]).toBeLessThan(10);
    expect(upx(plan.domain, 200)).toBeCloseTo(upx([4, 5], 400), 12);
    // …still about its own centre, so the window stays where the user put it.
    expect((plan.domain[0] + plan.domain[1]) / 2).toBeCloseTo(5, 9);
  });

  it("refuses a degenerate axis instead of dividing by zero", () => {
    expect(planEqualAspect({ domain: [3, 3], px: 400 }, { domain: [0, 10], px: 200 }).kind).toBe("blocked");
    expect(planEqualAspect({ domain: [0, 10], px: 0 }, { domain: [0, 10], px: 200 }).kind).toBe("blocked");
  });

  it("the plan survives the round trip through buildScale: a unit is the same pixels on both axes", () => {
    // The real use: rebuild the widened axis as an EXACT range and measure the drawn pixels.
    const plan = planEqualAspect({ domain: [0, 10], px: 400 }, { domain: [0, 10], px: 200 });
    if (plan.kind !== "ok") throw new Error("expected a plan");
    const xb = buildScale("linear", plan.domain, [0, 400], 6, true);
    const yb = buildScale("linear", [0, 10], [200, 0], 6, true);
    const pxPerUnitX = Math.abs(xb.scale(1) - xb.scale(0));
    const pxPerUnitY = Math.abs(yb.scale(1) - yb.scale(0));
    expect(pxPerUnitX).toBeCloseTo(pxPerUnitY, 9);
  });
});
