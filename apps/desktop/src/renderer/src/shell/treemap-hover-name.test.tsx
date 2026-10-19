// @vitest-environment jsdom
/**
 * A treemap cell whose name does not fit keeps its name for the hover text, and the legend-key check catches a
 * region key that is not one of the region's drawn shades.
 */
import { describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { buildPlotScene } from "@mady/graphics";
import type { DataTable, Plot } from "@mady/core";
import { PlotFigure } from "./PlotFigure";
import { checkLegendKeys } from "./legendKeyCheck";
import { galleryItems } from "./gallery";

const rows: [string, number, string][] = [
  ["Laptops", 41, "Hardware"], ["Phones", 66, "Hardware"], ["Tablets", 18, "Hardware"], ["Wearables", 9, "Hardware"],
  ["Cloud", 52, "Services"], ["Support", 21, "Services"], ["Training", 7, "Services"],
];
const table: DataTable = {
  id: "t", kind: "partsofwhole", name: "Revenue",
  columns: [{ id: "p", name: "Product", role: "x" }, { id: "v", name: "Revenue", role: "y" }, { id: "d", name: "Division", role: "x" }],
  rows: rows.map(([p, v, d], i) => ({ id: `r${i}`, cells: { p, v, d } })),
};
const plot: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "treemap", treemap: { groupColumn: "d", showValues: true, labelSize: 26 } };
const small = () => buildPlotScene(table, plot, { width: 240, height: 200 });

describe("treemap cell names that are not drawn", () => {
  it("the cell's hover text still names it", () => {
    const s = small();
    const dropped = s.treemap!.cells.filter((c) => c.label === "");
    expect(dropped.length, "the fixture must drop a name").toBeGreaterThan(0);
    const { container } = render(<PlotFigure scene={s} />);
    const tips = [...container.querySelectorAll("polygon[data-mady-tip]")].map((e) => e.getAttribute("data-mady-tip") ?? "");
    for (const c of dropped) expect(c.suppressedLabel, "the scene keeps the name").toBeTruthy();
    for (const c of dropped) expect(tips.some((t) => t.split("\n")[0] === c.suppressedLabel), `no hover text names "${c.suppressedLabel}"`).toBe(true);
    for (const c of s.treemap!.cells.filter((k) => k.label !== "")) expect(c.suppressedLabel).toBeUndefined();
    cleanup();
  });
});

describe("treemap icons and names", () => {
  it("the gallery card names most of its states at a text width close to the app's real font, and reports the rest", () => {
    // 0.5 em a character is close to the real font; the test default (0.6 em) is wider and drops more names.
    // Names shrink to fit their cells, so most of the card's 15 states are named and the rest are reported.
    const card = galleryItems().find((g) => g.key === "treemap")!;
    const size = { width: card.plot.figureWidth ?? 580, height: card.plot.figureHeight ?? 380 };
    const s = buildPlotScene(card.table, card.plot, { ...size, measure: (t, px) => t.length * px * 0.5 });
    const cells = s.treemap!.cells;
    const dropped = cells.filter((c) => c.label === "");
    expect(cells.length - dropped.length, "states named").toBeGreaterThanOrEqual(11);
    for (const c of dropped) expect(c.suppressedLabel, "a name not drawn stays in the hover text").toBeTruthy();
    if (dropped.length > 0) expect(s.warnings.some((w) => /cell names? (is|are) not drawn/.test(w)), "and is reported").toBe(true);
  });

  it("the gallery card draws all four region headings: a heading slides along the ring before it is given up", () => {
    const card = galleryItems().find((g) => g.key === "treemap")!;
    const size = { width: card.plot.figureWidth ?? 580, height: card.plot.figureHeight ?? 380 };
    const heads = buildPlotScene(card.table, card.plot, size).treemap!.groupLabels ?? [];
    expect(heads.length).toBe(4);
    expect(heads.filter((g) => g.text === "").length).toBe(0);
  });

  it("a cell's icon never costs a neighbouring cell its name", () => {
    // The gallery card carries a badge on every state. Names drawn without badges are the most the card can show.
    const card = galleryItems().find((g) => g.key === "treemap")!;
    const size = { width: card.plot.figureWidth ?? 580, height: card.plot.figureHeight ?? 380 };
    const droppedNames = (p: Plot): string[] =>
      buildPlotScene(card.table, p, size).treemap!.cells.filter((c) => c.label === "").map((c) => c.id);
    const withIcons = droppedNames(card.plot);
    const without = droppedNames({ ...card.plot, treemap: { ...card.plot.treemap, iconColumn: undefined } });
    expect(buildPlotScene(card.table, card.plot, size).treemap!.cells.some((c) => c.icon), "the fixture must draw badges").toBe(true);
    expect(withIcons.filter((id) => !without.includes(id)), "names lost to a badge").toEqual([]);
  });
});

describe("the legend-key check on a treemap's region keys", () => {
  // Rows are matched by hover text, so name the cells after their legend rows.
  const named: DataTable = { ...table, rows: table.rows.map((r) => ({ ...r, cells: { ...r.cells, p: r.cells.d ?? null } })) };

  it("accepts a key that is one of the region's drawn shades", () => {
    const s = buildPlotScene(named, plot, { width: 700, height: 480 });
    const { container } = render(<PlotFigure scene={s} />);
    const r = checkLegendKeys(s, container, "t");
    expect(r.checked, "the fixture must compare a row").toBeGreaterThan(0);
    expect(r.bad).toEqual([]);
    cleanup();
  });

  it("still flags a key whose colour no cell of the row draws", () => {
    const s = buildPlotScene(named, plot, { width: 700, height: 480 });
    s.legend = s.legend.map((e, i) => (i === 0 ? { ...e, color: "#123456" } : e));
    const { container } = render(<PlotFigure scene={s} />);
    const r = checkLegendKeys(s, container, "t");
    expect(r.checked, "the fixture must compare a row").toBeGreaterThan(0);
    expect(r.bad.length, JSON.stringify(r)).toBeGreaterThan(0);
    cleanup();
  });
});
