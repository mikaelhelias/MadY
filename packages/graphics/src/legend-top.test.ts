/**
 * The outside-top legend (`legend.position = "top"`) — the key in a row between the title and
 * the plot, as in ggplot's top legend placement.
 *
 * What is held here:
 *  1. The wrap helper and the band arithmetic, alone.
 *  2. The builder reserves the band: the plot gets shorter by exactly the height the rows need,
 *     and no narrower — the outside-right column is not taken as well.
 *  3. The wrap is decided by the builder and handed to the renderer (`topRows`), and the band
 *     reserved is the band those rows need — the two cannot drift.
 *  4. A band that would eat a third of the figure moves the legend inside instead (the
 *     outside-right rule), reserving nothing.
 *  5. Every gallery card that draws a legend honours it. The band rides on the plot's top
 *     padding, which every builder reads — this is the sweep that proves "every".
 */
import { describe, expect, it } from "vitest";
import type { DataTable, LegendPosition, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene.js";
import { LEGEND_ITEM_GAP, legendRowMetrics, topLegendBand, wrapLegendRows } from "./legendTop.js";
import type { PlotScene } from "./scene.js";

const estimate = (t: string, px: number): number => t.length * px * 0.6;

const table = (names: string[]): DataTable => ({
  id: "t",
  kind: "xy",
  name: "T",
  columns: [{ id: "x", name: "X" }, ...names.map((n, i) => ({ id: `y${i}`, name: n }))],
  rows: [0, 2, 4, 6].map((v, r) => ({
    id: `r${r}`,
    cells: Object.fromEntries([["x", v], ...names.map((_, i) => [`y${i}`, v * (i + 1)])]),
  })),
});
const base: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {} };
const at = (position: LegendPosition, extra: Partial<Plot> = {}): Plot =>
  ({ ...base, ...extra, legend: { ...extra.legend, show: true, position } });
const SIZE = { width: 620, height: 420, xScale: "linear" as const, yScale: "linear" as const };

/** The band the renderer will draw for this scene's rows — from the scene, the way the builder computed it. */
const drawnBand = (s: PlotScene): number => topLegendBand((s.legendLayout.topRows ?? []).length, legendRowMetrics(s, estimate));

describe("wrapLegendRows / topLegendBand", () => {
  it("packs items greedily and starts a new row when the next one would not fit", () => {
    expect(wrapLegendRows([10, 10, 10], 5, 26)).toEqual([[0, 1], [2]]);
    expect(wrapLegendRows([10, 10, 10], 5, 40)).toEqual([[0, 1, 2]]);
  });
  it("never drops or cuts an item — one wider than the row gets a row of its own", () => {
    expect(wrapLegendRows([50, 10, 10], 5, 30)).toEqual([[0], [1, 2]]);
    expect(wrapLegendRows([], 5, 30)).toEqual([]);
  });
  it("the band is rows × row height + the frame padding on both sides + the gap to the plot", () => {
    expect(topLegendBand(0, { rowH: 20, pad: 6, outGap: 12 })).toBe(0);
    expect(topLegendBand(2, { rowH: 20, pad: 6, outGap: 12 })).toBe(2 * 20 + 12 + 12);
  });
});

describe("the builder reserves the band", () => {
  const two = table(["Alpha", "Beta"]);

  it("the plot gets shorter by the band and no narrower — the right column is not taken too", () => {
    const none = buildPlotScene(two, at("none"), SIZE);
    const top = buildPlotScene(two, at("top"), SIZE);
    expect(top.legend).toHaveLength(2);
    expect(top.legendLayout.position).toBe("top");
    expect(top.legendLayout.orientation).toBe("horizontal");
    expect(top.legendLayout.topRows).toEqual([[0, 1]]);
    const band = drawnBand(top);
    expect(band).toBeGreaterThan(0);
    expect(top.plot.y - none.plot.y).toBe(band);
    expect(none.plot.height - top.plot.height).toBe(band);
    expect(top.plot.x).toBe(none.plot.x);
    expect(top.plot.width).toBe(none.plot.width);
  });

  it("an outside row is horizontal whatever orientation the spec asked for", () => {
    const s = buildPlotScene(two, at("top", { legend: { orientation: "vertical" } }), SIZE);
    expect(s.legendLayout.orientation).toBe("horizontal");
  });

  it("names wider than the plot wrap into more rows, and the band grows with them", () => {
    const many = table(["Placebo, twice daily", "Low dose, twice daily", "High dose, twice daily", "Reference compound", "Vehicle control", "Untreated"]);
    const s = buildPlotScene(many, at("top"), SIZE);
    const rows = s.legendLayout.topRows ?? [];
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.flat()).toEqual(s.legend.map((_, i) => i)); // every entry, once, in order
    const one = buildPlotScene(two, at("top"), SIZE);
    expect(drawnBand(s)).toBeGreaterThan(drawnBand(one));
    const none = buildPlotScene(many, at("none"), SIZE);
    expect(s.plot.y - none.plot.y).toBe(drawnBand(s));
  });

  it("a band that would eat a third of the figure moves the legend inside and reserves nothing", () => {
    const many = table(["Placebo, twice daily", "Low dose, twice daily", "High dose, twice daily", "Reference compound", "Vehicle control", "Untreated", "Sham", "Naive"]);
    const short = { ...SIZE, width: 300, height: 160 };
    const s = buildPlotScene(many, at("top"), short);
    expect(s.legendLayout.position).toBe("bottomright");
    expect(s.legendLayout.topRows).toBeUndefined();
    const none = buildPlotScene(many, at("none"), short);
    expect(s.plot.y).toBe(none.plot.y);
    expect(s.legend).toHaveLength(8); // nothing lost
  });

  it("a legend with no rows reserves no band (single series, auto-hidden)", () => {
    const one = table(["Alpha"]);
    const s = buildPlotScene(one, { ...base, legend: { position: "top" } }, SIZE);
    expect(s.legend).toHaveLength(0);
    const none = buildPlotScene(one, at("none"), SIZE);
    expect(s.plot.y).toBe(none.plot.y);
  });

  it("the user's own top padding is kept underneath the band", () => {
    const padded = buildPlotScene(two, at("top", { plotPad: { top: 30 } }), SIZE);
    const paddedNone = buildPlotScene(two, at("none", { plotPad: { top: 30 } }), SIZE);
    expect(padded.plot.y - paddedNone.plot.y).toBe(drawnBand(padded));
    const plain = buildPlotScene(two, at("none"), SIZE);
    expect(paddedNone.plot.y - plain.plot.y).toBe(30);
  });

  it("the right column and the inside corners are untouched by the top machinery", () => {
    const right = buildPlotScene(two, at("right"), SIZE);
    expect(right.legendLayout.topRows).toBeUndefined();
    const corner = buildPlotScene(two, at("topleft"), SIZE);
    expect(corner.legendLayout.topRows).toBeUndefined();
    expect(corner.legendLayout.orientation).toBe("vertical");
  });
});
