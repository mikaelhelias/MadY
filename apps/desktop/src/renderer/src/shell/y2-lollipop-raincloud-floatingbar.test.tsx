// @vitest-environment jsdom
/**
 * A second value axis on lollipop, raincloud and floating bar.
 *
 * A series put on Y2 there is drawn against a second axis, the way bar and box do: down the right on a
 * vertical chart, along the top on a horizontal one — not refused and drawn on the main axis.
 *
 * Asked of the drawing, both halves (the `right-axes-drawn.test.tsx` rule): the axis must be created by the
 * assignment and reach the markup (delete it from the scene and the picture changes), and the moved series must be
 * redrawn against it. That test skips lollipop - lollipop draws no generic series layer - which is why this one
 * exists.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { tableDatasets } from "@mady/core";
import type { Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import { Inspector, rightValueAxes } from "./Inspector";
import { galleryItems } from "./gallery";

afterEach(cleanup);
const SIZE = { width: 620, height: 420 };
const measure = (t: string, px: number): number => t.length * px * 0.6;
type Card = { key: string; table: never; plot: Plot };
const card = (kind: string): Card => (galleryItems() as unknown as Card[]).find((c) => c.plot.kind === kind)!;

/** Where the given dataset is drawn, as numbers that move when its value scale moves. */
function positions(kind: string, scene: ReturnType<typeof buildPlotScene>, id: string): number[] {
  if (kind === "lollipop") return scene.lollipop!.rows.flatMap((r) => r.dots.filter((d) => d.id === id).map((d) => (scene.lollipop!.horizontal ? d.cx : d.cy)));
  return scene.series.find((s) => s.id === id)!.marks.map((m) => m.cy);
}

const CASES: { kind: string; orientation: "vertical" | "horizontal" }[] = [
  { kind: "lollipop", orientation: "horizontal" },
  { kind: "lollipop", orientation: "vertical" },
  { kind: "raincloud", orientation: "vertical" },
  { kind: "floatingbar", orientation: "vertical" },
  { kind: "floatingbar", orientation: "horizontal" },
];

describe("a second value axis on lollipop, raincloud and floating bar", () => {
  it.each(CASES)("$kind ($orientation): the axis is drawn, on the right (along the top when horizontal), and the series is redrawn against it", ({ kind, orientation }) => {
    const c = card(kind);
    const plot: Plot = { ...c.plot, barOrientation: orientation };
    const ds = tableDatasets(c.table);
    expect(ds.length, "needs two series: one stays on the main axis").toBeGreaterThanOrEqual(2);
    const moved = ds[ds.length - 1]!.id;
    const base = buildPlotScene(c.table, plot, { measure, ...SIZE });
    const onY2: Plot = { ...plot, seriesStyles: { ...(plot.seriesStyles ?? {}), [moved]: { ...(plot.seriesStyles?.[moved] ?? {}), axis: "y2" } } };
    const scene = buildPlotScene(c.table, onY2, { measure, ...SIZE });

    expect(scene.warnings.filter((w) => /second value axis|draws no second/i.test(w))).toEqual([]);
    expect(base.y2).toBeUndefined();
    expect(scene.y2, "no second axis was built").toBeDefined();
    expect(scene.y2!.side === "top").toBe(orientation === "horizontal");
    const withAxis = renderToStaticMarkup(createElement(PlotFigure, { scene }));
    const without = renderToStaticMarkup(createElement(PlotFigure, { scene: { ...scene, y2: undefined } }));
    expect(withAxis, "the second axis is in the scene but not in the drawing").not.toBe(without);
    // The moved series follows its own axis: its positions change (a series on its own range spans it).
    expect(positions(kind, scene, moved)).not.toEqual(positions(kind, base, moved));
    // A series left on the main axis is not measured against the moved one's values, and is still drawn.
    expect(positions(kind, scene, ds[0]!.id).every((v) => Number.isFinite(v))).toBe(true);
  });

  it("the Axis tab offers the second axis on all three, in either orientation (the gate matches the drawing)", () => {
    for (const kind of ["lollipop", "raincloud", "floatingbar"]) {
      expect(rightValueAxes({ kind: kind as Plot["kind"] }), kind).toEqual(["y2"]);
      expect(rightValueAxes({ kind: kind as Plot["kind"], barOrientation: "horizontal" }), kind).toEqual(["y2"]);
    }
  });

  it("a third axis is refused with a warning (one second axis only)", () => {
    for (const kind of ["lollipop", "raincloud", "floatingbar"]) {
      const c = card(kind);
      const id = tableDatasets(c.table)[0]!.id;
      const s = buildPlotScene(c.table, { ...c.plot, seriesStyles: { ...(c.plot.seriesStyles ?? {}), [id]: { axis: "y3" } } }, { measure, ...SIZE });
      expect(s.warnings.some((w) => /third value axis/.test(w)), kind).toBe(true);
      expect(s.y2, kind).toBeUndefined();
    }
  });
});

/**
 * The Axis tab names the second axis where the chart draws it. A lollipop is horizontal when no orientation is set
 * (unlike a bar) and its value spec is `xAxis` - not "transposed" in the data sense, so `isTransposedPlot` says no;
 * going by that alone, the tab would call a top axis "Y2" and put "Series on this axis" on the category axis's tab.
 */
describe("lollipop's Axis tab follows its orientation", () => {
  const f = vi.fn();
  const h = {
    onSelect: f, onSetAxis: f, onSetAxisLength: f, onSetAxisTitleFont: f,
    onSetSeriesStyle: f, onSetSeriesStyleAll: f, onSetPointStyle: f, onClearPointStyles: f,
    onSetGrid: f, onSetFrame: f, onSetKind: f, onSetBarLayout: f, onSetBarShape: f, onSetBoxWhisker: f,
    onSetPlotOptions: f, onSetGraphTitle: f, onSetPlotFont: f, onHomogenizeFont: f,
    onSetLegend: f, onSetSignificance: f, onApplyPreset: f,
    onApplyUserPreset: f, onSaveUserPreset: f, onDeleteUserPreset: f, onSetProfileDefault: f,
    annotationOps: { add: f, update: f, remove: f, reorder: f, align: f, group: f, ungroup: f, setLocked: f, addImage: f, replaceImage: f },
  };
  const tab = (orientation: "vertical" | "horizontal" | undefined, axis: "x" | "y" | "y2") => {
    const c = card("lollipop");
    const plot = { ...c.plot, barOrientation: orientation } as Plot;
    const { container } = render(<Inspector activeSection="graphs" selection={{ kind: "axis", axis }} plot={plot} table={c.table} userPresets={[]} profileDefault={null} {...h} />);
    const row = [...container.querySelectorAll<HTMLElement>("div.frow")].find((r) => (r.querySelector(":scope > span")?.textContent ?? "").trim() === "Axis");
    const buttons = row ? [...row.querySelectorAll("button")].map((b) => (b.textContent ?? "").trim()) : [];
    const picker = [...container.querySelectorAll("summary, .inspsub, h4, div")].some((e) => (e.textContent ?? "").trim() === "Series on this axis");
    cleanup();
    return { buttons, picker };
  };

  it("horizontal (the default): the button is X2, and the series picker sits on the value axis (X) and X2", () => {
    for (const o of [undefined, "horizontal"] as const) {
      expect(tab(o, "x").buttons).toContain("X2");
      expect(tab(o, "x").picker, "X is the value axis").toBe(true);
      expect(tab(o, "y").picker, "Y holds the categories").toBe(false);
      expect(tab(o, "y2").picker).toBe(true);
    }
  });

  it("vertical: the button is Y2, and the picker sits on Y and Y2", () => {
    expect(tab("vertical", "y").buttons).toContain("Y2");
    expect(tab("vertical", "y").picker).toBe(true);
    expect(tab("vertical", "x").picker).toBe(false);
  });
});

/**
 * A vertical lollipop's category names follow the same collision rule as the box and bar charts: in the narrower
 * plot a second axis leaves, a name that would land on its neighbour ("Accuracy" into "Stamina") is dropped
 * (`deOverlapX`, the name kept on the tick for grouping), and the figure draws only the names the scene keeps.
 */
describe("a vertical lollipop's category names never run into each other", () => {
  it("crowded names are thinned like the box chart's, and the figure draws only the kept ones", () => {
    const c = card("lollipop");
    const ds = tableDatasets(c.table);
    const plot = { ...c.plot, barOrientation: "vertical", seriesStyles: { ...(c.plot.seriesStyles ?? {}), [ds[1]!.id]: { axis: "y2" } } } as Plot;
    const scene = buildPlotScene(c.table, plot, { measure, width: 420, height: 360 });
    const kept = scene.x.ticks.filter((t) => t.label !== "");
    expect(kept.length, "the fixture must crowd its names or this proves nothing").toBeLessThan(scene.x.ticks.length);
    const boxes = kept.map((t) => [t.pos - measure(t.label, scene.fonts.xTick.size) / 2, t.pos + measure(t.label, scene.fonts.xTick.size) / 2] as const);
    for (let i = 1; i < boxes.length; i++) expect(boxes[i]![0]).toBeGreaterThan(boxes[i - 1]![1]);
    const html = renderToStaticMarkup(createElement(PlotFigure, { scene }));
    for (const t of scene.x.ticks) {
      const drawn = html.includes(`>${t.suppressedLabel ?? t.label}</text>`);
      expect(drawn, `"${t.suppressedLabel ?? t.label}"`).toBe(t.label !== "");
    }
    // every name still identifies its tick (grouping reads it)
    const tbl = c.table as unknown as { rows: { cells: Record<string, unknown> }[]; columns: { id: string; role?: string }[] };
    const xId = tbl.columns.find((col) => col.role === "x")!.id;
    expect(scene.x.ticks.map((t) => t.suppressedLabel || t.label)).toEqual(tbl.rows.map((r) => String(r.cells[xId])));
  });
});
