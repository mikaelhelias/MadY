import { describe, expect, it } from "vitest";
import { buildScale } from "./scale";

/**
 * Degenerate axis bounds must not hang the process.
 *
 * Guards against a log axis with a manual minimum of `0` looping forever: `lb(0)` is -Infinity,
 * so a decade loop starting at `Math.floor(-Infinity)` never advances (-Infinity + 1 === -Infinity)
 * and appends ticks until the heap is exhausted. That kills the whole Electron renderer process —
 * which an ErrorBoundary cannot catch, so every unsaved edit is lost. It is reachable simply by
 * typing `0`, or the leading `0` of `0.5`, into the Inspector's axis Minimum field.
 *
 * A large `minorCount` is the same class of defect, so it is capped like `majorStep`.
 *
 * Note: every test here carries a timeout on purpose: the failure mode is a hang, not a wrong value,
 * so an un-timed assertion would take the whole test run down with it rather than reporting.
 */
const FAST = { timeout: 5000 };

describe("log axis with non-positive or non-finite bounds", () => {
  it.each([
    ["zero minimum", [0, 100]],
    ["negative minimum", [-50, 100]],
    ["both non-positive", [-10, -1]],
    ["NaN minimum", [NaN, 100]],
    ["NaN maximum", [0, NaN]],
    ["both NaN", [NaN, NaN]],
    ["-Infinity minimum", [-Infinity, 100]],
    ["Infinity maximum", [1, Infinity]],
    ["degenerate (min === max)", [10, 10]],
  ] as [string, [number, number]][])("terminates on a %s", FAST, (_name, domain) => {
    const s = buildScale("log10", domain, [0, 400], 6, true);
    expect(s.ticks.length).toBeLessThan(10_000);
    // Whatever was asked for, the resulting domain must be a usable positive window.
    expect(s.domain[0]).toBeGreaterThan(0);
    expect(s.domain[1]).toBeGreaterThan(s.domain[0]);
    expect(Number.isFinite(s.domain[0])).toBe(true);
    expect(Number.isFinite(s.domain[1])).toBe(true);
    // Every tick it does emit must be usable (a NaN position blanks the element).
    for (const t of s.ticks) expect(Number.isFinite(t.pos)).toBe(true);
  });

  it("still builds a normal log axis unchanged", FAST, () => {
    const s = buildScale("log10", [1, 1000], [0, 300], 6, true);
    expect(s.domain).toEqual([1, 1000]);
    const majors = s.ticks.filter((t) => !t.minor).map((t) => t.value);
    expect(majors).toEqual([1, 10, 100, 1000]);
  });
});

describe("minor-tick count is bounded", () => {
  it.each([
    ["a huge count", 99_999_999],
    ["Infinity", Infinity],
    ["NaN", NaN],
    ["a negative count", -5],
  ] as [string, number][])("terminates with %s", FAST, (_name, minorCount) => {
    const s = buildScale("linear", [0, 100], [0, 400], 6, false, undefined, { minorCount });
    expect(s.ticks.length).toBeLessThan(10_000);
    for (const t of s.ticks) expect(Number.isFinite(t.pos)).toBe(true);
  });

  it("an ordinary minor count still works", FAST, () => {
    const s = buildScale("linear", [0, 10], [0, 400], 6, false, undefined, { minorCount: 4 });
    expect(s.ticks.some((t) => t.minor)).toBe(true);
    expect(s.ticks.length).toBeLessThan(200);
  });
});
