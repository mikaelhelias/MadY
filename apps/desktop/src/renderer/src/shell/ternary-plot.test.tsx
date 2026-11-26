// @vitest-environment jsdom
// Ternary plot (a chart type of its own). Each row a 3-part
// composition normalized per row, drawn as one point inside an equilateral triangle (the
// barycentric transform of a scatter). Points are a real marker series (per-point styles,
// colour-by-column); the triangle/ticks/grid/edge-titles are scene.ternary chrome.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { DataTable, Plot } from "@mady/core";
import { bracketGeometry, TABLE_FORMATS } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { BRACKET_KINDS, Inspector } from "./Inspector";
import { isCategoryKind, PlotFigure } from "./PlotFigure";
import { galleryItems } from "./gallery";
import { NEW_GRAPH_GENRES } from "./newGraph";

afterEach(cleanup);

/** A 3-component sheet: sand/silt/clay percentages + a text category column (colour-by
 *  fodder — never warned about) + a numeric extra (pH — warned as not drawn). */
const soilTable: DataTable = {
  id: "tt", kind: "multivariable", name: "Soils",
  columns: [
    { id: "s", name: "Sample", role: "x" },
    { id: "a", name: "Sand", role: "y" },
    { id: "b", name: "Silt", role: "y" },
    { id: "c", name: "Clay", role: "y" },
    { id: "g", name: "Type", role: "y" },
    { id: "ph", name: "pH", role: "y" },
  ],
  rows: [
    { id: "r1", cells: { s: "S1", a: 100, b: 0, c: 0, g: "Sandy", ph: 6.5 } },
    { id: "r2", cells: { s: "S2", a: 0, b: 0, c: 100, g: "Clayey", ph: 7.1 } },
    { id: "r3", cells: { s: "S3", a: 20, b: 30, c: 50, g: "Clayey", ph: 6.9 } },
    { id: "r4", cells: { s: "S4", a: 2, b: 3, c: 5, g: "Clayey", ph: 7.4 } },
    { id: "r5", cells: { s: "S5", a: -1, b: 60, c: 41, g: "Bad", ph: 6.2 } }, // negative → not placeable
  ],
};

const ternaryPlot = (over: Partial<NonNullable<Plot["ternary"]>> = {}, plotOver: Partial<Plot> = {}): Plot => ({
  id: "p", name: "Ternary", source: "tt", status: "ok", styleOverrides: {}, kind: "ternary",
  ternary: { ...over }, ...plotOver,
});

describe("ternary — builder geometry", () => {
  it("places each composition at its barycentric point; corners and centroid land exactly", () => {
    const scene = buildPlotScene(soilTable, ternaryPlot());
    expect(scene.kind).toBe("ternary");
    const t = scene.ternary!;
    const [A, B, C] = t.corners;
    const marks = scene.series[0]!.marks;
    expect(marks.length).toBe(4); // r5 dropped
    // r1 = pure Sand → corner A; r2 = pure Clay → corner C.
    expect(marks[0]!.cx).toBeCloseTo(A.x, 6);
    expect(marks[0]!.cy).toBeCloseTo(A.y, 6);
    expect(marks[1]!.cx).toBeCloseTo(C.x, 6);
    expect(marks[1]!.cy).toBeCloseTo(C.y, 6);
    // the triangle is equilateral: |AB| = |AC| = |BC|
    const d = (p: { x: number; y: number }, q: { x: number; y: number }) => Math.hypot(p.x - q.x, p.y - q.y);
    expect(d(A, B)).toBeCloseTo(d(A, C), 6);
    expect(d(A, B)).toBeCloseTo(d(B, C), 6);
  });

  it("normalizes per row: (20,30,50) and (2,3,5) are the same point", () => {
    const scene = buildPlotScene(soilTable, ternaryPlot());
    const marks = scene.series[0]!.marks;
    expect(marks[2]!.cx).toBeCloseTo(marks[3]!.cx, 6);
    expect(marks[2]!.cy).toBeCloseTo(marks[3]!.cy, 6);
  });

  it("says what it cannot draw: the unusable row, the unused numeric extra, too few columns", () => {
    const scene = buildPlotScene(soilTable, ternaryPlot());
    expect(scene.warnings.some((w) => /1 row is not placeable/i.test(w))).toBe(true);
    // pH (numeric, unused) warns; Type (text — grouping/colour-by fodder) does not.
    expect(scene.warnings.some((w) => /"pH".*not drawn/i.test(w))).toBe(true);
    expect(scene.warnings.some((w) => /"Type"/.test(w))).toBe(false);
    const thin: DataTable = { ...soilTable, columns: soilTable.columns.slice(0, 3) };
    expect(buildPlotScene(thin, ternaryPlot()).warnings.some((w) => /three value columns/i.test(w))).toBe(true);
  });

  it("the triangular grid honours the standard Grid options (density = divisions)", () => {
    const off = buildPlotScene(soilTable, ternaryPlot());
    expect(off.ternary!.gridLines.length).toBe(0); // grid.show defaults false (the global rule)
    const on = buildPlotScene(soilTable, ternaryPlot({}, { grid: { show: true, density: 4 } }));
    expect(on.ternary!.gridLines.length).toBe(3 * 3); // three families × (divisions − 1)
    const denser = buildPlotScene(soilTable, ternaryPlot({}, { grid: { show: true, density: 10 } }));
    expect(denser.ternary!.gridLines.length).toBe(3 * 9);
  });

  it("tick labels read percent by default and fractions when percent is off", () => {
    const pct = buildPlotScene(soilTable, ternaryPlot({}, { grid: { density: 5 } }));
    expect(pct.ternary!.ticks.some((t) => t.label === "60")).toBe(true);
    const frac = buildPlotScene(soilTable, ternaryPlot({ percent: false }, { grid: { density: 5 } }));
    expect(frac.ternary!.ticks.some((t) => t.label === "0.6")).toBe(true);
  });

  it("edge titles are the column names and carry their drag offsets", () => {
    const scene = buildPlotScene(soilTable, ternaryPlot({ axisLabelOff: { a: { dx: 9, dy: -4 } } }));
    const titles = scene.ternary!.axisTitles;
    expect(titles.map((t) => t.text)).toEqual(["Sand", "Silt", "Clay"]);
    expect(titles.find((t) => t.datasetId === "a")!.off).toEqual({ dx: 9, dy: -4 });
  });

  it("colour-by-column reaches the points and builds the category legend", () => {
    const plot = ternaryPlot();
    plot.seriesStyles = { a: { colorFromColumn: "g", colorFromMode: "category" } };
    const scene = buildPlotScene(soilTable, plot);
    const colors = new Set(scene.series[0]!.marks.map((m) => m.symbolFillColor ?? scene.series[0]!.color));
    expect(colors.size, "colour binding must give the groups distinct colours").toBeGreaterThan(1);
    expect(scene.legend.length, "a categorical binding earns its legend").toBeGreaterThanOrEqual(2);
  });

  it("value-anchored lines are refused with a warning (no rectangular axes)", () => {
    const plot = ternaryPlot();
    plot.annotations = [{ id: "h1", kind: "hline", value: 0.5 }];
    const scene = buildPlotScene(soilTable, plot);
    expect(scene.annotations.some((a) => a.id === "h1")).toBe(false);
    expect(scene.warnings.length).toBeGreaterThan(0);
  });
});

describe("ternary — the figure paints (it is not drawn as a category kind)", () => {
  it("is not a category kind, and its glyphs + chrome really render", () => {
    expect(isCategoryKind("ternary")).toBe(false);
    const scene = buildPlotScene(soilTable, ternaryPlot({}, { grid: { show: true } }), { width: 640, height: 560 });
    const { container } = render(<PlotFigure scene={scene} selected={null} />);
    expect(container.querySelectorAll("g[id^='mark-']").length, "the composition points must paint").toBe(4);
    expect(container.querySelector(".gfx-ternary"), "the triangle chrome must paint").toBeTruthy();
    expect(container.querySelectorAll(".gfx-ternary .terngrid line").length).toBeGreaterThan(0);
  });
});

describe("ternary — brackets refused by geometry (not silence)", () => {
  it("is not a bracket kind and its planner endpoints are none", () => {
    expect(BRACKET_KINDS.has("ternary")).toBe(false);
    expect(bracketGeometry({ kind: "ternary" }).endpoints).toBe("none");
  });
});

describe("ternary — Inspector section (Chart tab, standard placement)", () => {
  function renderInspector(plot: Plot) {
    const onSetPlotOptions = vi.fn();
    const h = {
      onSelect: vi.fn(), onSetAxis: vi.fn(), onSetAxisLength: vi.fn(), onSetAxisTitleFont: vi.fn(),
      onSetSeriesStyle: vi.fn(), onSetSeriesStyleAll: vi.fn(), onSetPointStyle: vi.fn(), onClearPointStyles: vi.fn(),
      onSetGrid: vi.fn(), onSetFrame: vi.fn(), onSetKind: vi.fn(), onSetBarLayout: vi.fn(), onSetBarShape: vi.fn(), onSetBoxWhisker: vi.fn(),
      onSetPlotOptions, onSetGraphTitle: vi.fn(), onSetPlotFont: vi.fn(), onHomogenizeFont: vi.fn(),
      onSetLegend: vi.fn(), onSetSignificance: vi.fn(), onApplyPreset: vi.fn(), 
      onApplyUserPreset: vi.fn(), onSaveUserPreset: vi.fn(), onDeleteUserPreset: vi.fn(), onSetProfileDefault: vi.fn(),
      annotationOps: { add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() },
    };
    const { container } = render(
      <Inspector activeSection="graphs" selection={{ kind: "plot" }} plot={plot} table={soilTable}
        userPresets={[]} profileDefault={null} wholeGraph={false} onSetWholeGraph={() => {}} {...h} />,
    );
    return { container, onSetPlotOptions };
  }
  const row = (container: HTMLElement, label: string) =>
    [...container.querySelectorAll("label")].find((l) => (l.querySelector("span:first-child")?.textContent ?? "").trim() === label);

  it("Percent labels writes plot.ternary.percent", () => {
    const { container, onSetPlotOptions } = renderInspector(ternaryPlot());
    const pct = row(container, "Percent labels");
    expect(pct, "no Ternary plot section").toBeTruthy();
    fireEvent.click(pct!.querySelector("input")!);
    expect((onSetPlotOptions.mock.calls.at(-1)![0] as { ternary: { percent?: boolean } }).ternary.percent).toBe(false);
  });
});

describe("ternary — from the datasheet", () => {
  it("multivariable format advertises it; the genre + gallery card exist and agree", () => {
    expect(TABLE_FORMATS.multivariable.graphs).toContain("Ternary plot");
    const g = NEW_GRAPH_GENRES.find((x) => x.key === "ternary");
    expect(g, "no ternary genre").toBeTruthy();
    expect(g!.formats[0]).toBe("multivariable");
    expect(g!.formats).toContain("column");
    const card = galleryItems().find((x) => x.key === "ternary");
    expect(card, "no ternary gallery card — the gallery-wide tests would not cover it").toBeTruthy();
    expect(card!.table.kind).toBe("multivariable");
    expect((card!.plot.kind ?? "xy")).toBe("ternary");
  });
});
