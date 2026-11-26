/**
 * A histogram's bin labels name the bins it drew, and it says which columns it left out.
 *
 * Ratings 1–7 binned one wide from 0.5 (so each whole rating sits mid-bin) read "0.5–1.5",
 * "1.5–2.5"…: the label decimals follow the edges, not the bin width alone, which would print 0.5
 * as "1". Of a four-column sheet the first column is binned, and the others are named as not drawn.
 */
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene";

const ratings = [[4, 3, 5, 4], [5, 4, 6, 5], [3, 2, 4, 3], [6, 5, 7, 6], [4, 4, 5, 5], [2, 3, 3, 2], [7, 6, 7, 7], [5, 5, 5, 6]];
const table = {
  id: "t", kind: "column", name: "Ratings",
  columns: ["Clarity", "Pace", "Materials", "Overall"].map((n, j) => ({ id: `c${j}`, name: n, role: "y" })),
  rows: ratings.map((r, i) => ({ id: `r${i}`, cells: Object.fromEntries(r.map((v, j) => [`c${j}`, v])) })),
} as unknown as DataTable;
const plot = (histogram: Record<string, unknown>, over: Partial<Plot> = {}) => ({ id: "p", name: "H", source: "t", kind: "histogram", histogram, ...over }) as unknown as Plot;
const labels = (p: Plot) => buildPlotScene(table, p, { width: 600, height: 400 }).series[0]!.marks.map((m) => m.label);

describe("histogram bin labels", () => {
  it("bins of width 1 from 0.5 read 0.5–1.5, 1.5–2.5 …", () => {
    expect(labels(plot({ binWidth: 1, origin: 0.5 })).slice(0, 3)).toEqual(["0.5–1.5", "1.5–2.5", "2.5–3.5"]);
  });

  it("whole-number edges keep whole-number labels", () => {
    expect(labels(plot({ binWidth: 1, origin: 0 })).slice(0, 2)).toEqual(["0–1", "1–2"]);
  });

  it("custom bins with half-unit edges print them", () => {
    expect(labels(plot({ binRanges: [[0.5, 3.5], [3.5, 7.5]] }))).toEqual(["0.5–3.5", "3.5–7.5"]);
  });
});

describe("a histogram of a sheet with several value columns", () => {
  it("says it bins the first and names the ones it leaves out", () => {
    const w = buildPlotScene(table, plot({ binWidth: 1 }), { width: 600, height: 400 }).warnings;
    expect(w.some((x) => /"Clarity"/.test(x) && /"Pace"/.test(x) && /not drawn/.test(x))).toBe(true);
  });

  it("with the other columns hidden, nothing is left out and nothing is said", () => {
    const hidden = { seriesStyles: { c1: { hidden: true }, c2: { hidden: true }, c3: { hidden: true } } } as Partial<Plot>;
    const w = buildPlotScene(table, plot({ binWidth: 1 }, hidden), { width: 600, height: 400 }).warnings;
    expect(w.filter((x) => /not drawn/.test(x))).toEqual([]);
  });
});

describe("a histogram's bins run along the number line", () => {
  it("a Sort left on the plot by a bar chart does not reorder them", () => {
    // Switching a sorted bar chart to Histogram keeps `barSort`; the histogram has no Sort control to clear it.
    for (const barSort of ["desc", "asc"] as const) {
      const marks = buildPlotScene(table, plot({ binWidth: 1, origin: 0.5 }, { barSort }), { width: 600, height: 400 }).series[0]!.marks;
      const lows = marks.map((m) => Number(String(m.label).split("–")[0]));
      expect(lows.length, barSort).toBeGreaterThan(3);
      expect(lows, `${barSort}: bins in number order`).toEqual([...lows].sort((a, b) => a - b));
      const xs = marks.map((m) => m.cx);
      expect(xs, `${barSort}: bins drawn left to right in bin order`).toEqual([...xs].sort((a, b) => a - b));
    }
  });
});