/** Waterfall and Pareto read their values down the rows of a Column sheet: one bar per row, not one pooled bar. */
import { describe, expect, it } from "vitest";
import { genreByKey } from "./newGraph";

describe("Waterfall and Pareto genres", () => {
  it("ask for one bar per row", () => {
    for (const k of ["waterfall", "pareto"]) expect(genreByKey(k)?.plotPatch?.barPerRow, k).toBe(true);
  });
  it("other bar-based genres keep the pooled column bars", () => {
    expect(genreByKey("abundance")?.plotPatch?.barPerRow).toBeUndefined();
  });
});
