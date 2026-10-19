/**
 * A graph says when a column it draws holds text a reader takes for a number.
 *
 * A detection limit written "<10" or a count written "1,160,799" is text to the program, so every
 * graph skips those cells. The drawing then shows a series ending early, or no series at all, and
 * the notices under the graph are the only place that can say why.
 */
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene";

const table = {
  id: "t", kind: "xy", name: "Kill curves",
  columns: [
    { id: "h", name: "Hour", role: "x" },
    { id: "u", name: "Untreated", role: "y" },
    { id: "a", name: "Antibiotic", role: "y" },
  ],
  rows: [
    { id: "r0", cells: { h: 0, u: 120000, a: 130000 } },
    { id: "r1", cells: { h: 2, u: 980000, a: 21000 } },
    { id: "r2", cells: { h: 4, u: 8100000, a: 1900 } },
    { id: "r3", cells: { h: 6, u: 60000000, a: "<10" } },
    { id: "r4", cells: { h: 8, u: 390000000, a: "<10" } },
  ],
} as unknown as DataTable;
const plot = (over: Partial<Plot> = {}): Plot => ({ id: "p", name: "P", source: "t", kind: "xy", ...over }) as Plot;
const said = (p: Plot) => buildPlotScene(table, p, { width: 600, height: 400 }).warnings.filter((w) => /written as text/.test(w));

describe("a graph names the text cells it had to skip", () => {
  it.each(["xy", "bar", "box", "scatter", "histogram"] as const)("%s: the <10 cells are named", (kind) => {
    expect(said(plot({ kind }))).toEqual(['"Antibiotic" has 2 cells written as text ("<10"), so graphs and analyses skip them. Enter them as a number, or exclude them.']);
  });

  it("a hidden series is not drawn, so its text is not reported on this graph", () => {
    expect(said(plot({ seriesStyles: { a: { hidden: true } } }))).toEqual([]);
  });

  it("excluded cells are not reported", () => {
    expect(said({ ...plot() })).toHaveLength(1);
    const t2 = { ...table, excluded: { r3: ["a"], r4: ["a"] } } as unknown as DataTable;
    expect(buildPlotScene(t2, plot(), { width: 600, height: 400 }).warnings.filter((w) => /written as text/.test(w))).toEqual([]);
  });
});
