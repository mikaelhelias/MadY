import { describe, it, expect } from "vitest";
import { rankValues } from "./rank";

describe("rankValues (bump-chart competition ranking)", () => {
  it("ranks the largest value 1 by default", () => {
    expect(rankValues([30, 10, 20])).toEqual([1, 3, 2]);
  });

  it("highestFirst = false ranks the smallest value 1", () => {
    expect(rankValues([30, 10, 20], false)).toEqual([3, 1, 2]);
  });

  it("ties SHARE the lower rank and the next value skips (1, 1, 3)", () => {
    expect(rankValues([30, 30, 10])).toEqual([1, 1, 3]);
    expect(rankValues([5, 10, 10, 2])).toEqual([3, 1, 1, 4]);
  });

  it("a single value is rank 1; empty stays empty", () => {
    expect(rankValues([42])).toEqual([1]);
    expect(rankValues([])).toEqual([]);
  });
});
