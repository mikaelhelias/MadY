// A paired dot chart groups its rows into sections, with a dashed divider at the head of each. A row's value labels sit above
// its dots, so on a short row the first row of a section has its labels right under the divider. The divider keeps its
// clear distance from them: it moves up into the gap above (between the rows' ink) just far enough, and no further.
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene";

const SCHOOLS: Array<[string, string, number, number]> = [
  ["Ashford", "Urban", 46.6, 49.4], ["Brookside", "Urban", 48.8, 55.1], ["Cedar Hill", "Urban", 47.5, 48.4], ["Dunmore", "Urban", 52.8, 53.2], ["Elmwood", "Urban", 61.7, 62.9],
  ["Fairview", "Rural", 59.7, 67.5], ["Greenfield", "Rural", 52, 53.6], ["Hollow Creek", "Rural", 54.7, 62.2], ["Ivy Lane", "Rural", 50.4, 59.8],
  ["Jetty Road", "Coastal", 60, 60.9], ["Kelp Bay", "Coastal", 59.7, 64], ["Lantern Point", "Coastal", 48.6, 52.3],
];
const STARTS = [0, 5, 9]; // the first row of each section
const table: DataTable = {
  id: "pd", kind: "column", name: "Schools",
  columns: [{ id: "n", name: "School", role: "x" }, { id: "g", name: "Setting", role: "y" }, { id: "b", name: "Before", role: "y" }, { id: "a", name: "After", role: "y" }],
  rows: SCHOOLS.map(([n, g, b, a], i) => ({ id: `r${i}`, cells: { n, g, b, a } })),
};
const build = (h: number, pd: NonNullable<Plot["paireddot"]> = { showValues: true, connector: "dumbbell", showSections: true }, over: Partial<Plot> = {}) =>
  buildPlotScene(table, { id: "p", name: "P", source: "pd", status: "ok", styleOverrides: {}, kind: "paireddot", figureWidth: 640, figureHeight: h, paireddot: pd, ...over }, { width: 640, height: h });

/** Where a mark's label is drawn: its baseline is 9 px above the dot (PlotFigure's gap) plus the scene's own shift; digits stand ~0.78 of the size tall. */
const labelTop = (s: ReturnType<typeof build>, m: { cy: number; labelDy?: number | undefined; valueDy?: number | undefined }): number =>
  m.cy - 9 + (m.labelDy ?? 0) + (m.valueDy ?? 0) - 0.78 * s.fonts.valueLabel.size;
const firstRowLabelTop = (s: ReturnType<typeof build>, row: number): number => Math.min(...s.paireddot!.rows[row]!.marks.filter((m) => m.label).map((m) => labelTop(s, m)));
const dividers = (s: ReturnType<typeof build>): number[] => s.paireddot!.sections.map((x) => x.divider!.y1);

describe("section dividers keep clear of the first row's value labels", () => {
  it("at the default height, where the rows are short enough for the labels to reach the divider", () => {
    const s = build(480);
    const ys = dividers(s);
    expect(ys.length).toBe(3);
    STARTS.forEach((r, k) => expect(ys[k]! + 2, `section ${k}: divider ${ys[k]!.toFixed(1)} vs labels' top ${firstRowLabelTop(s, r).toFixed(1)}`).toBeLessThanOrEqual(firstRowLabelTop(s, r)));
  });

  it("and at other heights where there is room for it", () => {
    for (const h of [480, 520, 600, 800]) {
      const s = build(h);
      const band = s.paireddot!.rows[1]!.cy - s.paireddot!.rows[0]!.cy;
      expect(band, `figure ${h}`).toBeGreaterThanOrEqual(30); // enough for a row's dots, a divider and the next row's labels
      const ys = dividers(s);
      STARTS.forEach((r, k) => expect(ys[k]! + 2, `figure ${h}: section ${k}`).toBeLessThanOrEqual(firstRowLabelTop(s, r)));
    }
  });

  it("a figure too short for any divider to clear both neighbours gets the best the dots allow, never a line through them", () => {
    const s = build(360);
    const natural = build(360, { showValues: false, connector: "dumbbell", showSections: true });
    const ys = dividers(s);
    [1, 2].forEach((k) => {
      const prev = s.paireddot!.rows[STARTS[k]! - 1]!;
      const inkBottom = Math.max(...prev.marks.map((m) => m.cy + (m.size ?? s.paireddot!.dotSize)));
      expect(ys[k]!, `section ${k}`).toBeGreaterThanOrEqual(inkBottom);
      expect(ys[k]!, `section ${k}`).toBeLessThanOrEqual(dividers(natural)[k]!);
    });
  });

  it("a divider between sections stays below the previous row's dots", () => {
    const s = build(480);
    const ys = dividers(s);
    [1, 2].forEach((k) => {
      const prev = s.paireddot!.rows[STARTS[k]! - 1]!;
      const inkBottom = Math.max(...prev.marks.map((m) => m.cy + (m.size ?? s.paireddot!.dotSize)));
      expect(ys[k]!).toBeGreaterThanOrEqual(inkBottom);
    });
  });

  it("it moves only as far as it needs to: a few pixels, not the whole gap", () => {
    const s = build(480);
    const natural = build(480, { showValues: false, connector: "dumbbell", showSections: true });
    dividers(s).forEach((y, k) => {
      const moved = dividers(natural)[k]! - y;
      expect(moved).toBeGreaterThanOrEqual(0);
      expect(moved).toBeLessThan(8);
    });
  });

  it("with no value labels the dividers sit at the head of each section's first band", () => {
    const s = build(480, { showValues: false, connector: "dumbbell", showSections: true });
    const band = s.paireddot!.rows[1]!.cy - s.paireddot!.rows[0]!.cy;
    STARTS.forEach((r, k) => expect(dividers(s)[k]!).toBeCloseTo(s.paireddot!.rows[r]!.cy - band / 2, 6));
  });

  it("a tall figure, whose labels never reach the divider, keeps each divider at the head of its section's first band", () => {
    const s = build(1100);
    const band = s.paireddot!.rows[1]!.cy - s.paireddot!.rows[0]!.cy;
    STARTS.forEach((r, k) => expect(dividers(s)[k]!).toBeCloseTo(s.paireddot!.rows[r]!.cy - band / 2, 6));
  });

  it("the section headings stay centred on their sections", () => {
    const withLabels = build(480).paireddot!.sections.map((x) => x.labelY);
    const without = build(480, { showValues: false, connector: "dumbbell", showSections: true }).paireddot!.sections.map((x) => x.labelY);
    expect(withLabels).toEqual(without);
  });

  it("with the dividers switched off there are none to place", () => {
    const s = build(480, { showValues: true, connector: "dumbbell", showSections: true }, { refLineHidden: { "pd-section": true } });
    expect(s.paireddot!.sections.every((x) => x.divider === undefined)).toBe(true);
  });
});
