/**
 * Colour by a category column wears the graph's palette, not always the default one.
 *
 * Guards against points coloured by a text column (e.g. a ternary's texture classes) staying
 * Okabe-Ito blue / orange / green under another palette such as "Warm". Three places resolve
 * these colours (the marks in `paintDataDriven`, the legend in `dataDrivenLegend`, the swimmer's
 * lanes), and each must take the graph's own palette rather than `OKABE_ITO`. The marks and the
 * legend must also agree: the same category takes the same colour in both.
 */
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene.js";

const GREYS = ["#111111", "#555555", "#999999"];
const OKABE_FIRST = ["#0072B2", "#E69F00", "#009E73"];
const base = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {} } as const;

const xyTable: DataTable = {
  id: "t", kind: "xy", name: "T",
  columns: [{ id: "x", name: "X" }, { id: "y", name: "Y" }, { id: "g", name: "Group", type: "text" }],
  rows: ([[1, 2, "A"], [2, 3, "B"], [3, 5, "C"], [4, 4, "A"], [5, 6, "B"]] as const).map((v, i) => ({ id: `r${i}`, cells: { x: v[0], y: v[1], g: v[2] } })),
} as unknown as DataTable;
const xyPlot = { ...base, kind: "xy", seriesStyles: { y: { colorFromColumn: "g", colorFromMode: "category" } } } as unknown as Plot;

const ternTable = {
  id: "t", kind: "column", name: "T",
  columns: [{ id: "s", name: "Sample", role: "x" }, { id: "a", name: "Sand", role: "y" }, { id: "b", name: "Silt", role: "y" }, { id: "c", name: "Clay", role: "y" }, { id: "g", name: "Class", role: "y" }],
  rows: ([[90, 5, 5, "Sand"], [65, 25, 10, "Loam"], [20, 60, 20, "Silt"], [10, 30, 60, "Silt"]] as const).map((v, i) => ({ id: `r${i}`, cells: { s: `S${i}`, a: v[0], b: v[1], c: v[2], g: v[3] } })),
} as unknown as DataTable;
const ternPlot = { ...base, kind: "ternary", seriesStyles: { a: { colorFromColumn: "g", colorFromMode: "category" } } } as unknown as Plot;

const swimTable = {
  id: "t", kind: "xy", name: "T",
  columns: [{ id: "pt", name: "Patient", role: "x" }, { id: "s", name: "Start" }, { id: "e", name: "End" }, { id: "arm", name: "Arm", type: "text" }],
  rows: ([["P1", 0, 10, "Drug"], ["P2", 0, 8, "Placebo"], ["P3", 0, 6, "Drug"]] as const).map((v, i) => ({ id: `r${i}`, cells: { pt: v[0], s: v[1], e: v[2], arm: v[3] } })),
} as unknown as DataTable;
const swimPlot = { ...base, kind: "swimmer", seriesStyles: { s: { colorFromColumn: "arm", colorFromMode: "category" } } } as unknown as Plot;

const up = (c: string) => c.toUpperCase();
/** Every colour a scene uses, upper-cased, from its serialised form. */
const inks = (s: unknown): Set<string> => new Set((JSON.stringify(s).match(/#[0-9a-fA-F]{6}\b/g) ?? []).map(up));

describe("colour by a category column follows the graph's palette", () => {
  it("xy: each point takes its category's palette colour, and its legend row the same colour", () => {
    const s = buildPlotScene(xyTable, xyPlot, { palette: GREYS });
    const byRow = new Map(s.series[0]!.marks.map((m) => [m.rowId, up(m.fill ?? "")]));
    // Categories in first-seen order: A, B, C.
    expect(["r0", "r1", "r2", "r3", "r4"].map((r) => byRow.get(r))).toEqual([GREYS[0], GREYS[1], GREYS[2], GREYS[0], GREYS[1]]);
    expect(s.legend.map((e) => [e.label, up(e.color)])).toEqual([["A", GREYS[0]], ["B", GREYS[1]], ["C", GREYS[2]]]);
  });

  it("ternary: the classes and their legend wear the palette; no default colour is left", () => {
    const s = buildPlotScene(ternTable, ternPlot, { palette: GREYS, width: 580, height: 380 });
    expect(s.legend.map((e) => up(e.color))).toEqual(GREYS);
    const used = inks(s.series); // the points are one marker series
    for (const c of OKABE_FIRST) expect(used.has(c), `${c} (the default palette) is still drawn`).toBe(false);
    for (const c of GREYS) expect(used.has(c), `${c} (the graph's palette) is not drawn`).toBe(true);
  });

  it("swimmer: lanes coloured by a category take the palette, matching the legend", () => {
    const s = buildPlotScene(swimTable, swimPlot, { palette: GREYS, width: 580, height: 380 });
    expect(s.swimmer!.rows.map((r) => up(r.color))).toEqual([GREYS[0], GREYS[1], GREYS[0]]);
    expect(s.legend.map((e) => [e.label, up(e.color)])).toEqual([["Drug", GREYS[0]], ["Placebo", GREYS[1]]]);
  });

  it("a continuous colour key starts from the same series colour as its points", () => {
    // A "lightness" ramp shades the series colour. Guards against the points taking the palette's
    // colour while the colour bar falls back to the default palette, so the key describes different colours.
    const t = { ...xyTable, columns: [...xyTable.columns, { id: "v", name: "Value" }], rows: xyTable.rows.map((r, i) => ({ ...r, cells: { ...r.cells, v: i } })) } as unknown as DataTable;
    const plot = { ...base, kind: "xy", seriesStyles: { y: { colorFromColumn: "v", colorFromMode: "continuous", colorFromRamp: "lightness" } } } as unknown as Plot;
    const s = buildPlotScene(t, plot, { palette: GREYS });
    const top = s.series[0]!.marks.find((m) => m.rowId === "r4")!; // the highest value
    const stops = s.colorbar!.stops;
    expect(up(stops[stops.length - 1]!.color), "the key's top colour is not the top point's colour").toBe(up(top.fill!));
  });

  it("no palette given: the default palette (Okabe-Ito first)", () => {
    const s = buildPlotScene(xyTable, xyPlot);
    expect(s.legend.map((e) => up(e.color))).toEqual(OKABE_FIRST);
  });
});
