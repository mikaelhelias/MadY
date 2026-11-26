// @vitest-environment node
/**
 * Stacked row labels must not touch — horizontal bars, heatmap rows, dendrogram leaves, and the
 * UpSet matrix under its count axis.
 *
 * Guards against labels colliding on dense gallery cards (the ranked-dots bar chart, the split
 * heatmap, the dendrogram, the UpSet plot): a label drawn at its requested size when the row band
 * is a hair shorter than the text band puts every label's descender on the next label's ascender.
 * `fitStackedLabels` (also used by the paired dot plot) shrinks to the band first and thins only
 * past the readable floor; these builders use it. A tall figure is untouched — the fit only ever acts when the rows are too close.
 */
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene";

const base = (kind: Plot["kind"], extra: Partial<Plot> = {}): Plot => ({ id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind, ...extra });

function columnTable(n: number): DataTable {
  return {
    id: "t", kind: "column", name: "T",
    columns: [{ id: "x", name: "Name", role: "x" }, { id: "v", name: "Value", role: "y" }],
    rows: Array.from({ length: n }, (_, i) => ({ id: `r${i}`, cells: { x: `Row ${i + 1}`, v: (i * 7) % 23 } })),
  };
}
function matrixTable(rows: number, cols: number): DataTable {
  return {
    id: "t", kind: "grouped", name: "M",
    columns: [{ id: "g", name: "Gene", role: "x" }, ...Array.from({ length: cols }, (_, j) => ({ id: `c${j}`, name: `S${j + 1}`, role: "y" as const }))],
    rows: Array.from({ length: rows }, (_, i) => ({ id: `r${i}`, cells: { g: `GENE${i + 1}`, ...Object.fromEntries(Array.from({ length: cols }, (_, j) => [`c${j}`, ((i * 3 + j * 5) % 11) - 5])) } })),
  };
}

/** Adjacent labels along the vertical band are apart when text band + gap fits the row band. */
const TEXT_BAND = 1.2; // ascent + descent as a multiple of the font size (the builder's own ratio is ≥ this)

describe("horizontal bar charts: category labels shrink to their band, never overlap", () => {
  it("40 rows in a 560 px figure draw the category labels smaller than asked; a tall figure keeps the size", () => {
    const plot = base("bar", { barOrientation: "horizontal", xAxis: { tickFont: { size: 13 } } });
    const tight = buildPlotScene(columnTable(40), plot, { width: 600, height: 560 });
    const bandH = tight.plot.height / 40;
    expect(tight.fonts.yTick.size, "the label font must fit the row band").toBeLessThan(13);
    expect(tight.fonts.yTick.size * TEXT_BAND, "labels still taller than their band").toBeLessThanOrEqual(bandH);
    expect(tight.warnings.join("\n")).toMatch(/Category labels are drawn at \d+px, not the 13px asked for/);
    const tall = buildPlotScene(columnTable(40), plot, { width: 600, height: 1400 });
    expect(tall.fonts.yTick.size).toBe(13);
    expect(tall.warnings.join("\n")).not.toMatch(/Category labels are drawn at/);
  });

  it("hundreds of rows in a short figure thin the labels rather than shrink them past reading size", () => {
    const s = buildPlotScene(columnTable(300), base("bar", { barOrientation: "horizontal" }), { width: 600, height: 320 });
    expect(s.fonts.yTick.size).toBeGreaterThanOrEqual(7);
    const shown = s.y.ticks.filter((t) => t.label !== "").length;
    expect(shown).toBeGreaterThan(5);
    expect(shown).toBeLessThan(300);
    // A thinned label keeps its text on the tick (category grouping and identity run off it).
    expect(s.y.ticks.some((t) => t.label === "" && t.suppressedLabel)).toBe(true);
  });
});

describe("heatmap row labels shrink to the cell height", () => {
  it("40 rows in a 560 px figure draw the labels smaller than the default; a tall figure leaves the font alone", () => {
    const tight = buildPlotScene(matrixTable(40, 4), base("heatmap"), { width: 500, height: 560 });
    const cellH = tight.plot.height / 40;
    expect(tight.heatmap!.labelFont?.size, "no fitted label font on a dense heatmap").toBeDefined();
    expect(tight.heatmap!.labelFont!.size * TEXT_BAND).toBeLessThanOrEqual(cellH);
    const tall = buildPlotScene(matrixTable(40, 4), base("heatmap"), { width: 500, height: 1600 });
    expect(tall.heatmap!.labelFont).toBeUndefined();
  });

  it("a typed size is shrunk too — without a warning, because the house default writes that field on every heatmap", () => {
    const s = buildPlotScene(matrixTable(40, 4), base("heatmap", { heatmap: { labelFont: { size: 14 } } }), { width: 500, height: 560 });
    expect(s.heatmap!.labelFont!.size).toBeLessThan(14);
    expect(s.warnings).toEqual([]);
  });
});

describe("dendrogram leaves shrink to their band", () => {
  it("40 leaves in a 560 px figure draw the leaf labels smaller than the tick font; a tall figure keeps it", () => {
    const tight = buildPlotScene(matrixTable(40, 3), base("dendrogram", { dendrogram: { orientation: "horizontal" } }), { width: 600, height: 560 });
    const bandH = tight.plot.height / 40;
    expect(tight.fonts.yTick.size * TEXT_BAND).toBeLessThanOrEqual(bandH);
    const tall = buildPlotScene(matrixTable(40, 3), base("dendrogram", { dendrogram: { orientation: "horizontal" } }), { width: 600, height: 2400 });
    expect(tall.fonts.yTick.size).toBe(tall.fonts.tick.size);
  });
});

describe("heatmap: the colour bar's numbers are inside the figure", () => {
  it("a wide minimum label at a large legend font stays within the right edge", () => {
    const measure = (t: string, px: number): number => t.length * px * 0.6;
    const table = matrixTable(6, 4);
    for (const r of table.rows) r.cells.c0 = -1234.56; // a wide number at the bar's foot
    const s = buildPlotScene(table, base("heatmap", { fonts: { legend: { size: 22 } } }), { width: 520, height: 360, measure });
    const hm = s.heatmap!;
    const font = (hm.barFont ?? s.fonts.legend).size;
    const label = String(Math.round(hm.min * 100) / 100);
    const right = hm.bar.x + hm.bar.w + 4 + measure(label, font);
    expect(right, `the colour bar's "${label}" runs past the figure's right edge (${s.width})`).toBeLessThanOrEqual(s.width - 2);
  });

  it("on a narrow figure the numbers shrink to the column instead of the column eating the cells", () => {
    // A column that simply grew to the measured label would squeeze the cells of a narrow figure
    // to a thin strip. The column is capped at 15% of the width and the number font is fitted to
    // it (cbarFitted), so both the cells and the numbers keep their room.
    const measure = (t: string, px: number): number => t.length * px * 0.6;
    const table = matrixTable(6, 4);
    for (const r of table.rows) r.cells.c0 = -1234.56;
    const s = buildPlotScene(table, base("heatmap", { fonts: { legend: { size: 22 } } }), { width: 360, height: 250, measure });
    const hm = s.heatmap!;
    expect(hm.barFont, "the fitted number font must reach the drawing").toBeDefined();
    expect(hm.barFont!.size).toBeLessThan(22);
    expect(hm.barFont!.size).toBeGreaterThanOrEqual(7);
    const label = String(Math.round(hm.min * 100) / 100);
    expect(hm.bar.x + hm.bar.w + 4 + measure(label, hm.barFont!.size)).toBeLessThanOrEqual(s.width - 2);
    expect(s.plot.width, "the cells must keep most of a narrow figure").toBeGreaterThan(360 * 0.5);
  });
});

describe("UpSet: the matrix starts clear of the count axis's origin label", () => {
  it("the first set label sits below the '0' tick's text band", () => {
    const table: DataTable = {
      id: "t", kind: "column", name: "Sets",
      columns: [{ id: "a", name: "Drug A", role: "y" }, { id: "b", name: "Drug B", role: "y" }, { id: "c", name: "Drug C", role: "y" }],
      rows: Array.from({ length: 30 }, (_, i) => ({ id: `r${i}`, cells: { a: i % 2, b: i % 3 === 0 ? 1 : 0, c: i % 5 === 0 ? 1 : 0 } })),
    };
    const s = buildPlotScene(table, base("upset"), { width: 640, height: 420 });
    const baseline = s.plot.y + s.plot.height;
    const firstRow = s.upset!.sets[0]!;
    const rowH = Math.max(16, s.fonts.xTick.size + 8);
    // The gap between the bars' baseline and the first matrix row must clear the "0" tick's
    // half text band; a fixed 6 px gap is too small for it at card size.
    expect(firstRow.rowCy - rowH / 2 - baseline, "the matrix starts inside the '0' tick's text band").toBeGreaterThanOrEqual(6 + s.fonts.yTick.size * 0.6);
  });
});
