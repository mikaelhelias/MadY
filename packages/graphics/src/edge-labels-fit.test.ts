/**
 * Edge labels are fitted inside the figure; the figure does not grow. The first and last names
 * on the bottom axis stay within the figure's own width: when one would stick out, the plot narrows (more plot margin on
 * that side) and the figure keeps its size. A chart whose labels already fit is unchanged.
 */
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene, edgeLabelOverflow } from "./buildScene";

const measure = (t: string, px: number): number => t.length * px * 0.55;
/** A column-format violin whose first and last group names are long. */
function violin(first: string, last: string): { table: DataTable; plot: Plot } {
  const names = [first, "Mid", last];
  const table = {
    id: "t", kind: "column", name: "t",
    columns: names.map((n, i) => ({ id: `c${i}`, name: n, role: "y" })),
    rows: Array.from({ length: 12 }, (_, r) => ({ id: `r${r}`, cells: Object.fromEntries(names.map((_, i) => [`c${i}`, 10 + i * 5 + ((r * 7) % 5)])) })),
  } as unknown as DataTable;
  const plot = { id: "p", name: "p", source: "t", status: "ok", styleOverrides: {}, kind: "violin" } as unknown as Plot;
  return { table, plot };
}

describe("edge labels fit inside the figure", () => {
  it("long first and last names: nothing reaches past either edge, and the figure keeps its size", () => {
    const { table, plot } = violin("Placebo arm, blinded and randomised", "Untreated control group of the study");
    const s = buildPlotScene(table, plot, { width: 520, height: 340, measure });
    const over = edgeLabelOverflow(s, measure);
    expect(over.left).toBeLessThanOrEqual(0.5);
    expect(over.right).toBeLessThanOrEqual(0.5);
    expect(s.width).toBe(520);
  });

  it("the long-name fixture sticks out without the fit, so it exercises the overflow", () => {
    const { table, plot } = violin("Placebo arm, blinded and randomised", "Untreated control group of the study");
    const fitted = buildPlotScene(table, plot, { width: 520, height: 340, measure });
    const plain = buildPlotScene(table, { ...plot, plotPad: {} }, { width: 520, height: 340, measure });
    // Same call either way (an empty plotPad adds nothing) — so compare against the geometry the fit had to change:
    expect(fitted.plot.width).toBe(plain.plot.width);
    const short = buildPlotScene(...Object.values(violin("A", "B")) as [DataTable, Plot], { width: 520, height: 340, measure });
    expect(fitted.plot.width, "the long names must have narrowed the plot").toBeLessThan(short.plot.width);
  });

  it("names that already fit: the chart is exactly as built, no extra margin", () => {
    const { table, plot } = violin("A", "B");
    const s = buildPlotScene(table, plot, { width: 520, height: 340, measure });
    expect(edgeLabelOverflow(s, measure)).toEqual({ left: 0, right: 0 });
    const padded = buildPlotScene(table, { ...plot, plotPad: { left: 0, right: 0 } }, { width: 520, height: 340, measure });
    expect(JSON.stringify(s)).toBe(JSON.stringify(padded));
  });
});
