// @vitest-environment node
/**
 * The built-in ramps must not move.
 *
 * Every gallery card, guide screenshot and test fixture in the program is drawn with the
 * 17 built-in ramps. The gradient resolver (`resolveRamp` / `makeRamp`) must reproduce them
 * exactly, and that has to be provable, not asserted: `ramp-baseline.json` holds the colours
 * computed by an implementation independent of the resolver, and this test replays them.
 *
 * 17 ramps × 21 positions × 4 base/to/reversed combinations = 1428 pinned colours.
 *
 * If this fails, the resolver changed a built-in — fix the resolver. Never regenerate the
 * baseline to make it pass: the file is an oracle only because it does not come from the code
 * under test.
 */
import { describe, expect, it } from "vitest";
import type { GradRamp } from "@mady/core";
import { BUILTIN_GRAD_RAMPS } from "@mady/core";
import baseline from "./ramp-baseline.json" with { type: "json" };
import { makeRamp, rampColor, resolveBuiltinRamp } from "./color.js";

const cases = baseline.cases as { base: string; to: string; reversed: boolean }[];
const table = baseline.table as Record<string, string[]>;

describe("built-in ramps are unchanged by the gradient resolver", () => {
  it("covers all 17 built-ins in the baseline", () => {
    expect(BUILTIN_GRAD_RAMPS).toHaveLength(17);
    for (const ramp of BUILTIN_GRAD_RAMPS) expect(table[`${ramp}|0`], `${ramp} missing`).toBeTruthy();
  });

  for (const ramp of BUILTIN_GRAD_RAMPS as readonly GradRamp[]) {
    it(`${ramp} matches the independent baseline at every sampled position`, () => {
      for (let ci = 0; ci < cases.length; ci++) {
        const c = cases[ci]!;
        const want = table[`${ramp}|${ci}`]!;
        const got: string[] = [];
        for (let i = 0; i <= 20; i++) {
          const p = rampColor(ramp, i / 20, c.base, c.to, c.reversed);
          got.push(`${p.color}@${p.opacity.toFixed(4)}`);
        }
        expect(got, `${ramp} case ${ci}`).toEqual(want);
      }
    });
  }

  it("makeRamp(resolveBuiltinRamp(x)) is rampColor(x) — the wrapper adds nothing", () => {
    for (const ramp of BUILTIN_GRAD_RAMPS as readonly GradRamp[]) {
      const paint = makeRamp(resolveBuiltinRamp(ramp), "#2266cc", "#1a1a1a", false);
      for (let i = 0; i <= 10; i++) {
        expect(paint(i / 10)).toEqual(rampColor(ramp, i / 10, "#2266cc", "#1a1a1a", false));
      }
    }
  });

  it("an unknown ramp name falls back to viridis", () => {
    expect(rampColor("nonsense" as GradRamp, 0.5, "#000000", "#ffffff", false)).toEqual(
      rampColor("viridis", 0.5, "#000000", "#ffffff", false),
    );
  });
});
