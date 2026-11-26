// @vitest-environment jsdom
/**
 * Icon array — the pie chart's waffle display drawn as shapes. The builder's half is in
 * buildScene.test.ts; this file holds the drawing and the controls to it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { DataTable, Plot, SeriesStyle } from "@mady/core";
import { buildPlotScene, WAFFLE_ICON_CYCLE, WAFFLE_OTHER_COLOR, WAFFLE_OTHER_ID } from "@mady/graphics";
import { Inspector, SHAPES } from "./Inspector";
import { PlotFigure } from "./PlotFigure";
import type { GraphSelection } from "./AppShell";

afterEach(cleanup);

const table: DataTable = {
  id: "t", kind: "partsofwhole", name: "PW",
  columns: [{ id: "cat", name: "Category", role: "x" }, { id: "v", name: "Count" }],
  rows: [{ id: "rA", cells: { cat: "Alpha", v: 30 } }, { id: "rB", cells: { cat: "Beta", v: 70 } }],
};
const scene = (extra: Partial<Plot>) =>
  buildPlotScene(table, { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "pie", pieDisplay: "waffle", ...extra }, { width: 460, height: 380 });

/** The 100 cells, found by the category name each carries as its hover text. */
function cellsOf(container: HTMLElement, name: string): Element[] {
  return Array.from(container.querySelectorAll("title")).filter((t) => t.textContent === name).map((t) => t.parentElement!);
}

describe("waffle as an icon array — the drawing", () => {
  it("off: every cell is a filled square in its category colour", () => {
    const s = scene({});
    const { container } = render(<PlotFigure scene={s} />);
    const a = cellsOf(container, "Alpha");
    expect(a).toHaveLength(30);
    expect(a.every((el) => el.tagName.toLowerCase() === "rect" && el.getAttribute("fill") === s.pie!.cells![0]!.color)).toBe(true);
  });

  it("on: each cell draws its category's shape inside the cell, and no coloured square", () => {
    // Legend hidden: its key draws the same shapes (checked in its own test below).
    const s = scene({ waffleIcons: true, legend: { show: false } });
    const { container } = render(<PlotFigure scene={s} />);
    const cellA = s.pie!.cells!.find((c) => c.id === "rA")!;
    const cellB = s.pie!.cells!.find((c) => c.id === "rB")!;
    expect(cellA.shape).toBe("circle");
    expect(cellB.shape).toBe("triangle");
    const a = cellsOf(container, "Alpha");
    const b = cellsOf(container, "Beta");
    expect(a).toHaveLength(30);
    expect(b).toHaveLength(70);
    // The click target is see-through; the colour is on the shape.
    for (const el of [...a, ...b]) {
      expect(el.getAttribute("fill"), "a cell still paints a coloured square").toBe("transparent");
    }
    // Alpha's cells hold circles, Beta's hold triangles, each centred in and inside its cell.
    const circles = Array.from(container.querySelectorAll("circle")).filter((c) => c.getAttribute("fill") === cellA.color);
    expect(circles).toHaveLength(30);
    for (const c of circles) {
      const cx = Number(c.getAttribute("cx")), cy = Number(c.getAttribute("cy")), r = Number(c.getAttribute("r"));
      const home = s.pie!.cells!.find((k) => k.id === "rA" && Math.abs(k.x + k.w / 2 - cx) < 1e-6 && Math.abs(k.y + k.h / 2 - cy) < 1e-6);
      expect(home, "a circle is not centred in any Alpha cell").toBeTruthy();
      expect(r).toBeGreaterThan(home!.w * 0.3);
      expect(r).toBeLessThanOrEqual(home!.w / 2);
    }
    const tris = Array.from(container.querySelectorAll("polygon")).filter((p) => p.getAttribute("fill") === cellB.color);
    expect(tris).toHaveLength(70);
    for (const p of tris) {
      const pts = (p.getAttribute("points") ?? "").trim().split(/\s+/).map((q) => q.split(",").map(Number) as [number, number]);
      expect(pts).toHaveLength(3);
      const home = s.pie!.cells!.find((k) => k.id === "rB" && pts.every(([x, y]) => x >= k.x - 0.01 && x <= k.x + k.w + 0.01 && y >= k.y - 0.01 && y <= k.y + k.h + 0.01));
      expect(home, "a triangle pokes out of its cell").toBeTruthy();
    }
  });

  it("on: clicking an icon still selects its category, like a square or a legend row", () => {
    const picks: GraphSelection[] = [];
    const { container } = render(<PlotFigure scene={scene({ waffleIcons: true })} onSelect={(sel) => picks.push(sel)} />);
    fireEvent.click(cellsOf(container, "Beta")[5]!);
    expect(picks.at(-1)).toEqual({ kind: "pie-slice", datasetId: "rB" });
  });

  it("on: the legend rows show the same shapes as the cells", () => {
    const s = scene({ waffleIcons: true, legend: { show: true } });
    expect(s.legend.map((e) => e.symbol)).toEqual(["circle", "triangle"]);
  });

  it("on: a two-tone category's key is drawn with the icons' light fill and darker edge", () => {
    const s = scene({ waffleIcons: true, legend: { show: true }, seriesStyles: { rB: { fillType: "twotone" } } });
    const cell = s.pie!.cells!.find((c) => c.id === "rB")!;
    const { container } = render(<PlotFigure scene={s} />);
    // Beta's cells are triangles; the key is the one triangle that is not in the grid.
    const tris = Array.from(container.querySelectorAll("polygon")).filter((p) => p.getAttribute("fill") === cell.color);
    expect(tris).toHaveLength(71);
    expect(tris.every((p) => p.getAttribute("stroke") === cell.outline), "a Beta icon or its key is drawn without the darker edge").toBe(true);
  });
});

const basePlot = (extra: Partial<Plot>): Plot => ({ id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "pie", pieDisplay: "waffle", ...extra });

function inspector(plot: Plot, selection: GraphSelection | null, spies: { opts?: (patch: Partial<Plot>) => void; style?: (id: string, delta: SeriesStyle) => void } = {}) {
  const { container } = render(
    <Inspector
      activeSection="graphs"
      selection={selection}
      plot={plot}
      table={table}
      userPresets={[]}
      profileDefault={null}
      onSelect={vi.fn()}
      onSetAxis={vi.fn()} onSetAxisLength={vi.fn()} onSetAxisTitleFont={vi.fn()}
      onSetSeriesStyle={spies.style ?? vi.fn()} onSetSeriesStyleAll={vi.fn()} onSetPointStyle={vi.fn()} onClearPointStyles={vi.fn()}
      onSetGrid={vi.fn()} onSetFrame={vi.fn()} onSetKind={vi.fn()} onSetBarLayout={vi.fn()} onSetBarShape={vi.fn()} onSetBoxWhisker={vi.fn()}
      onSetPlotOptions={spies.opts ?? vi.fn()} onSetGraphTitle={vi.fn()} onSetPlotFont={vi.fn()} onHomogenizeFont={vi.fn()}
      onSetLegend={vi.fn()} onSetSignificance={vi.fn()} onApplyPreset={vi.fn()}
      onApplyUserPreset={vi.fn()} onSaveUserPreset={vi.fn()} onDeleteUserPreset={vi.fn()} onSetProfileDefault={vi.fn()}
      annotationOps={{ add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() }}
    />,
  );
  return container;
}

/** The control on the `.frow` whose own label is exactly `label`. */
function control(container: HTMLElement, label: string): HTMLInputElement | HTMLSelectElement | undefined {
  for (const row of container.querySelectorAll<HTMLElement>(".frow")) {
    if (((row.querySelector(":scope > span")?.textContent) ?? "").trim() !== label) continue;
    const el = row.querySelector<HTMLInputElement | HTMLSelectElement>("input, select");
    if (el) return el;
  }
  return undefined;
}

describe("waffle as an icon array — the controls", () => {
  const PIE_SECTION: GraphSelection = { kind: "chart-section", title: "Pie chart" };

  it("the Pie chart section offers 'Cells as shapes' for the waffle only, and it writes what it shows", () => {
    const opts = vi.fn<(patch: Partial<Plot>) => void>();
    const c = inspector(basePlot({}), PIE_SECTION, { opts });
    const box = control(c, "Cells as shapes") as HTMLInputElement | undefined;
    expect(box, "no 'Cells as shapes' control on a waffle").toBeTruthy();
    expect(box!.checked).toBe(false);
    fireEvent.click(box!);
    expect(opts).toHaveBeenLastCalledWith({ waffleIcons: true });
    cleanup();
    const on = control(inspector(basePlot({ waffleIcons: true }), PIE_SECTION), "Cells as shapes") as HTMLInputElement;
    expect(on.checked).toBe(true);
    cleanup();
    // A pie has no cells: the control would govern nothing, so it is not offered.
    expect(control(inspector(basePlot({ pieDisplay: "pie" }), PIE_SECTION), "Cells as shapes")).toBeUndefined();
  });

  it("a clicked category offers its Shape when cells are shapes — showing the shape it is drawn with — and not otherwise", () => {
    const style = vi.fn<(id: string, delta: SeriesStyle) => void>();
    const sel: GraphSelection = { kind: "pie-slice", datasetId: "rB" };
    const c = inspector(basePlot({ waffleIcons: true }), sel, { style });
    const pick = control(c, "Shape") as HTMLSelectElement | undefined;
    expect(pick, "no Shape control for a category of an icon waffle").toBeTruthy();
    // Beta is the 2nd category: the default it shows is the shape the builder draws.
    expect(pick!.value).toBe(WAFFLE_ICON_CYCLE[1]);
    expect(pick!.value).toBe(buildPlotScene(table, basePlot({ waffleIcons: true }), { width: 400, height: 300 }).pie!.cells!.find((k) => k.id === "rB")!.shape);
    // Every shape that draws is offered; "none" is not (it would empty the category's cells).
    const offered = Array.from(pick!.options).map((o) => o.value);
    expect(offered).toEqual(SHAPES.map(([v]) => v).filter((v) => v !== "none"));
    fireEvent.change(pick!, { target: { value: "octagon" } });
    expect(style).toHaveBeenLastCalledWith("rB", expect.objectContaining({ symbol: "octagon" }));
    cleanup();
    expect(control(inspector(basePlot({}), sel), "Shape"), "Shape offered while cells are squares").toBeUndefined();
  });
});

describe("count waffle — the caption under the grid", () => {
  const countScene = (extra: Partial<Plot>) => scene({ waffleUnit: "count", waffleIcons: true, waffleUnitName: "patient", ...extra });
  const captionEl = (container: HTMLElement, text: string): SVGTextElement | undefined =>
    [...container.querySelectorAll("text")].find((t) => (t.textContent ?? "").trim() === text) as SVGTextElement | undefined;

  it("draws the caption, and only in count mode", () => {
    const { container } = render(<PlotFigure scene={countScene({})} />);
    expect(captionEl(container, "1 icon = 1 patient"), "the caption is not on the page").toBeTruthy();
    cleanup();
    const plain = render(<PlotFigure scene={scene({ waffleIcons: true, waffleUnitName: "patient" })} />).container;
    expect([...plain.querySelectorAll("text")].some((t) => /icon =/.test(t.textContent ?? ""))).toBe(false);
  });

  it("drags, like every text on the graph: the gesture raises onMoveWaffleCaption", () => {
    const onMoveWaffleCaption = vi.fn();
    const { container } = render(<PlotFigure scene={countScene({})} onSelect={() => {}} onMoveWaffleCaption={onMoveWaffleCaption} />);
    const el = captionEl(container, "1 icon = 1 patient")!;
    expect(el.style.cursor, "the caption does not advertise that it drags").toBe("move");
    fireEvent.pointerDown(el, { clientX: 200, clientY: 300 });
    fireEvent.pointerMove(el, { clientX: 230, clientY: 310 });
    fireEvent.pointerUp(el, { clientX: 230, clientY: 310 });
    expect(onMoveWaffleCaption).toHaveBeenCalledWith(expect.any(Number), expect.any(Number));
  });

  it("a click opens the Pie chart section, where its words and font are set", () => {
    const picks: GraphSelection[] = [];
    const { container } = render(<PlotFigure scene={countScene({})} onSelect={(s) => picks.push(s)} onMoveWaffleCaption={() => {}} />);
    const el = captionEl(container, "1 icon = 1 patient")!;
    fireEvent.pointerDown(el, { clientX: 200, clientY: 300 });
    fireEvent.pointerUp(el, { clientX: 200, clientY: 300 });
    fireEvent.click(el);
    expect(picks.at(-1)).toEqual({ kind: "chart-section", title: "Pie chart" });
  });

  it("a double-click edits it in place, and the new words go to the caption", () => {
    const onEditText = vi.fn();
    const { container } = render(<PlotFigure scene={countScene({})} onEditText={onEditText} onMoveWaffleCaption={() => {}} />);
    fireEvent.doubleClick(captionEl(container, "1 icon = 1 patient")!);
    // A one-line caption opens a one-line box (an input); a title opens a textarea.
    const editor = container.querySelector("input, textarea") as HTMLInputElement | null;
    expect(editor?.value).toBe("1 icon = 1 patient");
    fireEvent.change(editor!, { target: { value: "Each icon: one mouse" } });
    fireEvent.blur(editor!);
    expect(onEditText).toHaveBeenCalledWith({ kind: "waffleCaption" }, "Each icon: one mouse");
  });

  it("is drawn in the legend font, and where it was dropped", () => {
    const s = countScene({ waffleCaptionOffset: { dx: 20, dy: -6 } });
    const { container } = render(<PlotFigure scene={s} />);
    const el = captionEl(container, "1 icon = 1 patient")!;
    expect(Number(el.getAttribute("font-size") ?? el.style.fontSize.replace("px", ""))).toBe(s.fonts.legend.size);
    const t = /translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)\s*\)/.exec(el.getAttribute("transform") ?? el.parentElement?.getAttribute("transform") ?? "");
    expect(t && [Number(t[1]), Number(t[2])]).toEqual([20, -6]);
  });
});

describe("count waffle — the controls", () => {
  const PIE_SECTION: GraphSelection = { kind: "chart-section", title: "Pie chart" };

  it("'Each cell is' is offered on a waffle only, shows what is drawn, and writes what it shows", () => {
    const opts = vi.fn<(patch: Partial<Plot>) => void>();
    const pick = control(inspector(basePlot({}), PIE_SECTION, { opts }), "Each cell is") as HTMLSelectElement | undefined;
    expect(pick, "no 'Each cell is' control on a waffle").toBeTruthy();
    expect(pick!.value).toBe("percent");
    expect(Array.from(pick!.options).map((o) => o.value)).toEqual(["percent", "count"]);
    fireEvent.change(pick!, { target: { value: "count" } });
    expect(opts).toHaveBeenLastCalledWith({ waffleUnit: "count" });
    cleanup();
    expect(control(inspector(basePlot({ pieDisplay: "pie" }), PIE_SECTION), "Each cell is")).toBeUndefined();
  });

  it("'Unit name' and 'Caption' appear in count mode only; each writes what was typed; blank clears", () => {
    const opts = vi.fn<(patch: Partial<Plot>) => void>();
    expect(control(inspector(basePlot({}), PIE_SECTION), "Unit name"), "Unit name offered with no caption to name").toBeUndefined();
    cleanup();
    const c = inspector(basePlot({ waffleUnit: "count", waffleUnitName: "mouse" }), PIE_SECTION, { opts });
    const unit = control(c, "Unit name") as HTMLInputElement;
    expect(unit.value).toBe("mouse");
    fireEvent.change(unit, { target: { value: "patient" } });
    expect(opts).toHaveBeenLastCalledWith({ waffleUnitName: "patient" });
    fireEvent.change(unit, { target: { value: "" } });
    expect(opts).toHaveBeenLastCalledWith({ waffleUnitName: undefined });
    const cap = control(c, "Caption") as HTMLInputElement;
    // Empty box, with the automatic words shown as its placeholder: what the graph says now.
    expect(cap.value).toBe("");
    expect(cap.placeholder).toBe(buildPlotScene(table, basePlot({ waffleUnit: "count", waffleUnitName: "mouse" }), { width: 400, height: 300 }).pie!.caption!.text);
    fireEvent.change(cap, { target: { value: "Each square: one mouse" } });
    expect(opts).toHaveBeenLastCalledWith({ waffleCaption: "Each square: one mouse" });
    cleanup();
    const typed = control(inspector(basePlot({ waffleUnit: "count", waffleCaption: "Mine" }), PIE_SECTION, { opts }), "Caption") as HTMLInputElement;
    expect(typed.value).toBe("Mine");
    fireEvent.change(typed, { target: { value: "" } });
    expect(opts).toHaveBeenLastCalledWith({ waffleCaption: undefined });
  });

  it("the caption's font is set where its click lands: a font size in the Pie chart section", () => {
    const font = vi.fn();
    const { container } = render(
      <Inspector
        activeSection="graphs" selection={{ kind: "chart-section", title: "Pie chart" }} plot={basePlot({ waffleUnit: "count" })} table={table}
        userPresets={[]} profileDefault={null} onSelect={vi.fn()}
        onSetAxis={vi.fn()} onSetAxisLength={vi.fn()} onSetAxisTitleFont={vi.fn()}
        onSetSeriesStyle={vi.fn()} onSetSeriesStyleAll={vi.fn()} onSetPointStyle={vi.fn()} onClearPointStyles={vi.fn()}
        onSetGrid={vi.fn()} onSetFrame={vi.fn()} onSetKind={vi.fn()} onSetBarLayout={vi.fn()} onSetBarShape={vi.fn()} onSetBoxWhisker={vi.fn()}
        onSetPlotOptions={vi.fn()} onSetGraphTitle={vi.fn()} onSetPlotFont={font} onHomogenizeFont={vi.fn()}
        onSetLegend={vi.fn()} onSetSignificance={vi.fn()} onApplyPreset={vi.fn()}
        onApplyUserPreset={vi.fn()} onSaveUserPreset={vi.fn()} onDeleteUserPreset={vi.fn()} onSetProfileDefault={vi.fn()}
        annotationOps={{ add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() }}
      />,
    );
    // The font block under its own heading: the Size row that follows it.
    const head = [...container.querySelectorAll(".inspsub")].find((e) => (e.textContent ?? "").trim() === "Caption font (shared with the legend)");
    expect(head, "no caption font block in the Pie chart section").toBeTruthy();
    let size: HTMLInputElement | null = null;
    for (let el = head!.nextElementSibling; el && !el.classList.contains("inspsub"); el = el.nextElementSibling) {
      if ((el.querySelector(":scope > span")?.textContent ?? "").trim() === "Size") size = el.querySelector("input");
    }
    expect(size, "no caption font size in the Pie chart section").toBeTruthy();
    fireEvent.change(size!, { target: { value: "15" } });
    // The caption is drawn in the legend font, so that is the font this control sets.
    expect(font).toHaveBeenCalledWith("legend", expect.objectContaining({ size: 15 }));
  });
});

describe("waffle — small groups combined into 'Other': the controls", () => {
  const PIE_SECTION: GraphSelection = { kind: "chart-section", title: "Pie chart" };
  const four: DataTable = {
    id: "t", kind: "partsofwhole", name: "PW",
    columns: [{ id: "cat", name: "Category", role: "x" }, { id: "v", name: "Count" }],
    rows: [["Alpha", 40], ["Beta", 30], ["Gamma", 20], ["Delta", 10]].map(([c, v], i) => ({ id: `r${i}`, cells: { cat: c as string, v: v as number } })),
  };

  it("'Groups shown' is on the waffle only; blank = all; it writes the number typed", () => {
    const opts = vi.fn<(patch: Partial<Plot>) => void>();
    const box = control(inspector(basePlot({}), PIE_SECTION, { opts }), "Groups shown") as HTMLInputElement | undefined;
    expect(box, "no 'Groups shown' on a waffle").toBeTruthy();
    expect(box!.value).toBe("");
    fireEvent.change(box!, { target: { value: "3" } });
    expect(opts).toHaveBeenLastCalledWith({ waffleMaxGroups: 3 });
    cleanup();
    const set = control(inspector(basePlot({ waffleMaxGroups: 3 }), PIE_SECTION, { opts }), "Groups shown") as HTMLInputElement;
    expect(set.value).toBe("3");
    fireEvent.change(set, { target: { value: "" } });
    expect(opts).toHaveBeenLastCalledWith({ waffleMaxGroups: undefined });
    cleanup();
    expect(control(inspector(basePlot({ pieDisplay: "pie" }), PIE_SECTION), "Groups shown")).toBeUndefined();
  });

  it("'Name for the rest' appears once groups are limited, and writes what was typed", () => {
    expect(control(inspector(basePlot({}), PIE_SECTION), "Name for the rest")).toBeUndefined();
    cleanup();
    const opts = vi.fn<(patch: Partial<Plot>) => void>();
    const name = control(inspector(basePlot({ waffleMaxGroups: 2, waffleOtherName: "Rest" }), PIE_SECTION, { opts }), "Name for the rest") as HTMLInputElement;
    expect(name.value).toBe("Rest");
    expect(name.placeholder).toBe("Other");
    fireEvent.change(name, { target: { value: "Minor" } });
    expect(opts).toHaveBeenLastCalledWith({ waffleOtherName: "Minor" });
    fireEvent.change(name, { target: { value: "" } });
    expect(opts).toHaveBeenLastCalledWith({ waffleOtherName: undefined });
  });

  it("clicking 'Other' opens a panel named for it, showing the colour and shape it is drawn with", () => {
    const plot = basePlot({ waffleMaxGroups: 2, waffleIcons: true, waffleOtherName: "Rest" });
    const s = buildPlotScene(four, plot, { width: 400, height: 300 });
    const other = s.pie!.cells!.find((c) => c.id === WAFFLE_OTHER_ID)!;
    expect(other.color).toBe(WAFFLE_OTHER_COLOR);
    const style = vi.fn<(id: string, delta: SeriesStyle) => void>();
    const { container } = render(
      <Inspector
        activeSection="graphs" selection={{ kind: "pie-slice", datasetId: WAFFLE_OTHER_ID }} plot={plot} table={four}
        userPresets={[]} profileDefault={null} onSelect={vi.fn()}
        onSetAxis={vi.fn()} onSetAxisLength={vi.fn()} onSetAxisTitleFont={vi.fn()}
        onSetSeriesStyle={style} onSetSeriesStyleAll={vi.fn()} onSetPointStyle={vi.fn()} onClearPointStyles={vi.fn()}
        onSetGrid={vi.fn()} onSetFrame={vi.fn()} onSetKind={vi.fn()} onSetBarLayout={vi.fn()} onSetBarShape={vi.fn()} onSetBoxWhisker={vi.fn()}
        onSetPlotOptions={vi.fn()} onSetGraphTitle={vi.fn()} onSetPlotFont={vi.fn()} onHomogenizeFont={vi.fn()}
        onSetLegend={vi.fn()} onSetSignificance={vi.fn()} onApplyPreset={vi.fn()}
        onApplyUserPreset={vi.fn()} onSaveUserPreset={vi.fn()} onDeleteUserPreset={vi.fn()} onSetProfileDefault={vi.fn()}
        annotationOps={{ add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() }}
      />,
    );
    expect(container.querySelector(".insphd")?.textContent).toBe("Rest");
    const colour = container.querySelector<HTMLInputElement>('input[type="color"]');
    expect(colour?.value.toLowerCase()).toBe(WAFFLE_OTHER_COLOR);
    const shape = control(container, "Shape") as HTMLSelectElement;
    expect(shape.value).toBe(other.shape);
    fireEvent.change(shape, { target: { value: "octagon" } });
    expect(style).toHaveBeenLastCalledWith(WAFFLE_OTHER_ID, expect.objectContaining({ symbol: "octagon" }));
  });
});

describe("the Shape a category panel shows is the shape it is drawn with", () => {
  it("even when an empty row before it shifts the drawing's order", () => {
    // Row 0 has no count, so the builder skips it: Beta is the first drawn category (a circle),
    // though it is the table's second row. Reading the table position would show a triangle.
    const gap: DataTable = {
      id: "t", kind: "partsofwhole", name: "PW",
      columns: [{ id: "cat", name: "Category", role: "x" }, { id: "v", name: "Count" }],
      rows: [{ id: "r0", cells: { cat: "Empty", v: 0 } }, { id: "r1", cells: { cat: "Beta", v: 60 } }, { id: "r2", cells: { cat: "Gamma", v: 40 } }],
    };
    const plot = basePlot({ waffleIcons: true });
    const drawn = buildPlotScene(gap, plot, { width: 400, height: 300 }).pie!.cells!.find((c) => c.id === "r1")!.shape;
    expect(drawn).toBe(WAFFLE_ICON_CYCLE[0]);
    const { container } = render(
      <Inspector
        activeSection="graphs" selection={{ kind: "pie-slice", datasetId: "r1" }} plot={plot} table={gap}
        userPresets={[]} profileDefault={null} onSelect={vi.fn()}
        onSetAxis={vi.fn()} onSetAxisLength={vi.fn()} onSetAxisTitleFont={vi.fn()}
        onSetSeriesStyle={vi.fn()} onSetSeriesStyleAll={vi.fn()} onSetPointStyle={vi.fn()} onClearPointStyles={vi.fn()}
        onSetGrid={vi.fn()} onSetFrame={vi.fn()} onSetKind={vi.fn()} onSetBarLayout={vi.fn()} onSetBarShape={vi.fn()} onSetBoxWhisker={vi.fn()}
        onSetPlotOptions={vi.fn()} onSetGraphTitle={vi.fn()} onSetPlotFont={vi.fn()} onHomogenizeFont={vi.fn()}
        onSetLegend={vi.fn()} onSetSignificance={vi.fn()} onApplyPreset={vi.fn()}
        onApplyUserPreset={vi.fn()} onSaveUserPreset={vi.fn()} onDeleteUserPreset={vi.fn()} onSetProfileDefault={vi.fn()}
        annotationOps={{ add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() }}
      />,
    );
    expect((control(container, "Shape") as HTMLSelectElement).value).toBe(drawn);
  });
});
