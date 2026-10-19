/**
 * An XY series set to a way of drawing an XY graph does not offer says what it is drawn as.
 *
 * "Bars" is a bar chart's Render as; an XY graph offers line, points and area. A series carrying
 * it (set through the agent tools, or kept from a bar chart switched to XY) is drawn as a line
 * with markers, and a warning says so.
 */
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene";

const table = {
  id: "t", kind: "xy", name: "Price",
  columns: [{ id: "d", name: "Day", role: "x" }, { id: "c", name: "Close", role: "y" }, { id: "v", name: "Volume", role: "y" }],
  rows: [[1, 49, 1.1], [2, 50, 0.9], [3, 48, 1.3], [4, 51, 1.0]].map(([d, c, v], i) => ({ id: `r${i}`, cells: { d, c, v } })),
} as unknown as DataTable;
const warn = (plotAs: string) =>
  buildPlotScene(table, { id: "p", name: "P", source: "t", kind: "xy", seriesStyles: { v: { plotAs } } } as unknown as Plot, { width: 560, height: 400 })
    .warnings.filter((w) => /Volume/.test(w) && /Render as/.test(w));

describe("Render as on an XY series", () => {
  it("bars, which an XY graph does not draw: said, with what it is drawn as", () => {
    expect(warn("bars")).toHaveLength(1);
  });
  it.each(["auto", "line", "points", "area"])("%s, which it does draw: nothing said", (v) => {
    expect(warn(v)).toEqual([]);
  });
});
