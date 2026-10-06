// @vitest-environment node
/**
 * Margins must follow the text — the end-to-end figure-geometry test (`e2e/figure-geometry.spec.ts`)
 * enlarges every gallery card's tick font to 30 and axis-title font to 40 and fails on any chart
 * whose text then collides or leaves the canvas. Each such case has a scene-level guard here so it holds without a browser: the builder is what places the text, so the builder is what is measured.
 */
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene";

const TEXT_ASCENT = 1.08;
const TEXT_DESCENT = 0.27;
const TEXT_BAND = TEXT_ASCENT + TEXT_DESCENT;
const measure = (t: string, px: number): number => t.length * px * 0.6;
const BIG: Plot["fonts"] = { tick: { size: 30 }, axisTitle: { size: 40 } };

describe("swimmer plot: subject labels shrink to their band when the tick font grows", () => {
  const table: DataTable = {
    id: "t", kind: "column", name: "Subjects",
    columns: [{ id: "s", name: "Subject", role: "x" }, { id: "a", name: "Start", role: "y" }, { id: "b", name: "End", role: "y" }],
    rows: Array.from({ length: 20 }, (_, i) => ({ id: `r${i}`, cells: { s: `Pt ${String(i + 1).padStart(2, "0")}`, a: 0, b: 3 + ((i * 7) % 20) } })),
  };
  const plot: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "swimmer", fonts: BIG, yAxis: { tickFont: { size: 30 } } };

  it("20 subjects at a 30 px tick font in a 420 px figure: the labels fit their rows", () => {
    const s = buildPlotScene(table, plot, { width: 760, height: 420, measure });
    const band = s.plot.height / 20;
    expect(s.fonts.yTick.size, "the subject labels must shrink to the band").toBeLessThan(30);
    expect(s.fonts.yTick.size * TEXT_BAND).toBeLessThanOrEqual(band);
    expect(s.warnings.join("\n")).toMatch(/Subject labels are drawn at \d+px, not the 30px asked for/);
  });

  it("a tall figure keeps the size asked for", () => {
    const s = buildPlotScene(table, plot, { width: 760, height: 1200, measure });
    expect(s.fonts.yTick.size).toBe(30);
  });
});

describe("survival: the number-at-risk heading clears the X-axis title at a large font", () => {
  const table: DataTable = {
    id: "t", kind: "survival", name: "KM",
    columns: [{ id: "time", name: "Time", role: "x" }, { id: "ev", name: "Event", role: "y" }, { id: "g", name: "Group" }],
    rows: Array.from({ length: 24 }, (_, i) => ({ id: `r${i}`, cells: { time: 2 + i * 1.5, ev: i % 3 === 0 ? 0 : 1, g: i % 2 ? "A" : "B" } })),
  };
  const plot: Plot = {
    id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "survival", fonts: BIG,
    xAxis: { title: "Months from randomisation" },
    survivalAtRisk: { times: [0, 10, 20, 30], rows: [{ label: "A", atRisk: [12, 8, 4, 1] }, { label: "B", atRisk: [12, 9, 5, 2] }] },
  };

  it("the heading's glyph top sits below the title's descent", () => {
    const s = buildPlotScene(table, plot, { width: 700, height: 460, measure });
    const at = s.atRisk!;
    expect(s.x.titlePos, "the X title must be placed by the shared anchor").toBeDefined();
    const titleBottom = s.x.titlePos! + s.fonts.xAxisTitle.size * TEXT_DESCENT;
    const headingTop = at.top - s.fonts.tick.size * TEXT_ASCENT * 0.8;
    expect(headingTop, `"Number at risk" (top ${headingTop.toFixed(1)}) overlaps the X title (bottom ${titleBottom.toFixed(1)})`).toBeGreaterThanOrEqual(titleBottom);
    // …and the last row still lands inside the figure.
    expect(at.top + at.rows.length * at.rowH).toBeLessThanOrEqual(s.height);
  });
});

describe("categorical bars: the margins reserve what the enlarged text needs", () => {
  const table: DataTable = {
    id: "t", kind: "column", name: "Bins",
    columns: [{ id: "b", name: "Bin", role: "x" }, { id: "n", name: "Count", role: "y" }],
    rows: ["175–200", "250–275", "325–350", "400–425", "475–500", "550–575"].map((b, i) => ({ id: `r${i}`, cells: { b, n: 3 + i } })),
  };
  const base: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "bar", fonts: BIG };

  it("the last category label, centred on its band, ends on the canvas", () => {
    const s = buildPlotScene(table, base, { width: 640, height: 400, measure });
    const last = [...s.x.ticks].filter((t) => t.label !== "").sort((a, b) => a.pos - b.pos).pop()!;
    expect(last.pos + measure(last.label, s.fonts.xTick.size) / 2, `"${last.label}" runs past the right edge`).toBeLessThanOrEqual(s.width - 2);
  });

  it("value labels above the bars get a band of their own font above the plot", () => {
    const off = buildPlotScene(table, base, { width: 640, height: 400, measure });
    const on = buildPlotScene(table, { ...base, showValues: true, fonts: { ...BIG, valueLabel: { size: 24 } } }, { width: 640, height: 400, measure });
    expect(on.plot.y - off.plot.y, "the plot must start lower to make room for the labels").toBeGreaterThanOrEqual(24 * TEXT_BAND);
  });
});

describe("wind rose: the compass letters clear the outer ring's value label", () => {
  it("N sits a descent past the ring at a 30 px tick font", () => {
    const table: DataTable = {
      id: "t", kind: "column", name: "Wind",
      columns: [{ id: "d", name: "Direction", role: "x" }, { id: "v", name: "Speed", role: "y" }],
      rows: Array.from({ length: 120 }, (_, i) => ({ id: `r${i}`, cells: { d: (i * 37) % 360, v: 2 + (i % 13) } })),
    };
    const s = buildPlotScene(table, { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "rose", fonts: BIG }, { width: 640, height: 600, measure });
    const rose = (s as unknown as { rose?: { rings: { labelY: number }[]; directionLabels: { text: string; y: number }[] } }).rose!;
    const north = rose.directionLabels.find((d) => d.text === "N")!;
    const outer = rose.rings.reduce((a, b) => (b.labelY < a.labelY ? b : a));
    // N's baseline + descent must sit above the outer ring label's glyph top.
    expect(north.y + s.fonts.tick.size * TEXT_DESCENT).toBeLessThanOrEqual(outer.labelY - s.fonts.tick.size * TEXT_ASCENT * 0.8);
  });
});

describe("chord: neighbouring radial labels keep a text band between them", () => {
  it("of two adjacent small arcs at a 30 px label, only one keeps its label", () => {
    const table: DataTable = {
      id: "t", kind: "column", name: "Links",
      columns: [{ id: "a", name: "From" }, { id: "b", name: "To" }, { id: "w", name: "Weight", role: "y" }],
      rows: ([
        ["Tumour", "Macrophage", 40], ["Tumour", "T cell", 35], ["Macrophage", "Fibroblast", 30], ["T cell", "Fibroblast", 25],
        ["Endothelial", "Tumour", 4], ["B cell", "Tumour", 3], ["Endothelial", "B cell", 1],
      ] as Array<[string, string, number]>).map(([a, b, w], i) => ({ id: `r${i}`, cells: { a, b, w } })),
    };
    const s = buildPlotScene(table, { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "chord", chord: { labelSize: 30 } }, { width: 700, height: 620, measure });
    const ch = s.chord!;
    const shown = ch.arcs.filter((a) => a.showLabel);
    const angle = (a: { labelX: number; labelY: number }): number => Math.atan2(a.labelX - ch.cx, -(a.labelY - ch.cy));
    for (let i = 0; i < shown.length; i++) for (let j = i + 1; j < shown.length; j++) {
      const d = Math.abs(angle(shown[i]!) - angle(shown[j]!)) % (2 * Math.PI);
      const apart = Math.min(d, 2 * Math.PI - d) * (ch.r + 6);
      expect(apart, `"${shown[i]!.name}" and "${shown[j]!.name}" are drawn ${apart.toFixed(0)} px apart along the ring`).toBeGreaterThanOrEqual(30 * TEXT_BAND);
    }
    expect(shown.length, "the big arcs keep their labels").toBeGreaterThanOrEqual(4);
  });
});

describe("sunburst: a radial label that would leave the canvas is not drawn", () => {
  const table: DataTable = {
    id: "t", kind: "column", name: "Taxa",
    columns: [{ id: "l1", name: "Domain" }, { id: "l2", name: "Class" }, { id: "n", name: "Reads", role: "y" }],
    rows: ([["Bacteria", "Gammaproteobacteria", 40], ["Bacteria", "Bacilli", 30], ["Bacteria", "Bacteroidia", 25], ["Archaea", "Halobacteria", 5]] as Array<[string, string, number]>)
      .map(([l1, l2, n], i) => ({ id: `r${i}`, cells: { l1, l2, n } })),
  };
  const plot: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "sunburst", sunburst: { labelSize: 26 } };
  it("a long class name is labelled on a roomy canvas and dropped on a tight one", () => {
    const roomy = buildPlotScene(table, plot, { width: 1200, height: 1100, measure });
    const tight = buildPlotScene(table, plot, { width: 360, height: 330, measure });
    const seg = (s: typeof roomy) => (s as unknown as { sunburst?: { segments: { label: string; showLabel: boolean }[] } }).sunburst!.segments.find((x) => x.label === "Gammaproteobacteria")!;
    expect(seg(roomy).showLabel).toBe(true);
    expect(seg(tight).showLabel, "the label would run off the canvas").toBe(false);
  });
});
