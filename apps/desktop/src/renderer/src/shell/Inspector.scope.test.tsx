// @vitest-environment jsdom
// Guards the style-apply scope in the series panel:
//   • whole-graph on   → the edit reaches every series (onSetSeriesStyleAll)
//   • whole-graph off  → the per-series routing applies:
//        - whole-series on  → just the selected series (onSetSeriesStyle)
//        - whole-series off + a point → just that point (onSetPointStyle)
// Covers box + scatter; the routing lives in one place (applyStyle), so it does not
// depend on the chart kind.
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { DataTable, Plot, PlotKind } from "@mady/core";
import { tableDatasets } from "@mady/core";
import { Inspector } from "./Inspector";
import type { GraphSelection } from "./AppShell";

afterEach(cleanup);
beforeEach(() => globalThis.localStorage?.clear()); // reset the persisted toggles

// A two-group column table (→ two series: A, B) — the shape behind box/scatter groups.
const table: DataTable = {
  id: "t",
  kind: "column",
  name: "Boxes",
  columns: [
    { id: "g", name: "Group" },
    { id: "a", name: "A" },
    { id: "b", name: "B" },
  ],
  rows: [
    { id: "r1", cells: { g: "x", a: 1, b: 5 } },
    { id: "r2", cells: { g: "y", a: 2, b: 6 } },
    { id: "r3", cells: { g: "z", a: 3, b: 7 } },
  ],
};
const seriesIds = tableDatasets(table).map((d) => d.id); // the dataset ids, in order

/**
 * The same groups, but with the values running down the rows and no lead column — so each dataset
 * pools into a mean ± SD and an error bar is actually drawable.
 *
 * `table` above is three categories carrying one value each. A chart drawn from it has no
 * spread of any kind, so the Error bars section is refused out loud rather than offering six
 * interval types that draw nothing. The positive controls below assert that a kind still offers
 * the section — a claim a fixture with no spread could never exhibit, and which would therefore
 * prove nothing about the kind gate.
 */
const spreadTable: DataTable = {
  id: "t-spread",
  kind: "column",
  name: "Groups",
  columns: [
    { id: "a", name: "A", role: "y" },
    { id: "b", name: "B", role: "y" },
  ],
  rows: [
    { id: "s1", cells: { a: 1, b: 5 } },
    { id: "s2", cells: { a: 2, b: 6 } },
    { id: "s3", cells: { a: 3, b: 7 } },
    { id: "s4", cells: { a: 5, b: 9 } },
  ],
};

/**
 * …and the other shape of the same idea: a lead column of categories with replicate subcolumns
 * under one Y, so each row has a spread of its own. This is what a lollipop (and an XY point)
 * needs — `spreadTable` above pools down the rows, which is a column bar's shape, and a lollipop
 * reads its rows as the categories, so every dataset there holds a single value per category.
 */
const repTable: DataTable = {
  id: "t-reps",
  kind: "xy",
  name: "Replicates",
  columns: [
    { id: "x", name: "X", role: "x" },
    { id: "a", name: "A", role: "y", group: "A" },
    { id: "a2", name: "A", role: "y", group: "A" },
  ],
  rows: [
    { id: "q1", cells: { x: 1, a: 2, a2: 3 } },
    { id: "q2", cells: { x: 2, a: 4, a2: 6 } },
    { id: "q3", cells: { x: 3, a: 7, a2: 9 } },
  ],
};


function setup(kind: PlotKind, selection: GraphSelection, tbl: DataTable = table, plotExtra: Partial<Plot> = {}) {
  const plot: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind, ...plotExtra };
  const h = {
    onSelect: vi.fn(),
    onSetAxis: vi.fn(), onSetAxisLength: vi.fn(), onSetAxisTitleFont: vi.fn(),
    onSetSeriesStyle: vi.fn(), onSetSeriesStyleAll: vi.fn(), onSetPointStyle: vi.fn(), onClearPointStyles: vi.fn(),
    onSetGrid: vi.fn(), onSetFrame: vi.fn(), onSetKind: vi.fn(), onSetBarLayout: vi.fn(), onSetBarShape: vi.fn(), onSetBoxWhisker: vi.fn(),
    onSetPlotOptions: vi.fn(), onSetGraphTitle: vi.fn(), onSetPlotFont: vi.fn(), onHomogenizeFont: vi.fn(),
    onSetLegend: vi.fn(), onSetSignificance: vi.fn(), onApplyPreset: vi.fn(), 
    onApplyUserPreset: vi.fn(), onSaveUserPreset: vi.fn(), onDeleteUserPreset: vi.fn(), onSetProfileDefault: vi.fn(),
    annotationOps: { add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() },
  };
  // "Apply to whole graph" is a controlled prop — AppShell owns it, so that canvas gestures
  // (the box-width drag) can honour the same scope the Inspector shows. Tests must therefore
  // supply the controller; without one the checkbox renders but can never turn on.
  function Harness() {
    const [wholeGraph, setWholeGraph] = useState(false);
    return (
      <Inspector
        activeSection="data" selection={selection} plot={plot} table={tbl}
        userPresets={[]} profileDefault={null}
        wholeGraph={wholeGraph} onSetWholeGraph={setWholeGraph}
        {...h}
      />
    );
  }
  const u = render(<Harness />);
  return { ...u, ...h };
}

/** The scope checkbox in the row labelled `label` (or null when that row isn't shown). */
function scopeToggle(container: HTMLElement, label: string): HTMLInputElement | null {
  const span = [...container.querySelectorAll(".frow > span")].find((s) => s.textContent === label);
  return span ? (span.parentElement!.querySelector('input[type="checkbox"]') as HTMLInputElement) : null;
}
/** Click the first colour/fill swatch — a style edit that flows through `applyStyle`. */
function clickSwatch(container: HTMLElement): void {
  fireEvent.click(container.querySelector("button.swbtn") as HTMLButtonElement);
}

describe("Inspector — style-apply scope", () => {
  it("default (whole-series on): a box edit reaches only the selected series", () => {
    const d = setup("box", { kind: "series", columnId: "a", part: "points" });
    clickSwatch(d.container);
    expect(d.onSetSeriesStyle).toHaveBeenCalledTimes(1);
    expect(d.onSetSeriesStyle.mock.calls[0]![0]).toBe("a");
    expect(d.onSetSeriesStyleAll).not.toHaveBeenCalled();
  });

  it("'Apply to whole graph' on: the same box edit reaches every series", () => {
    const d = setup("box", { kind: "series", columnId: "a", part: "points" });
    fireEvent.click(scopeToggle(d.container, "Apply to whole graph")!);
    clickSwatch(d.container);
    expect(d.onSetSeriesStyleAll).toHaveBeenCalledTimes(1);
    expect(d.onSetSeriesStyleAll.mock.calls[0]![0]).toEqual(seriesIds); // all groups
    expect(d.onSetSeriesStyle).not.toHaveBeenCalled();
  });

  it("scatter behaves identically (whole graph → all series)", () => {
    const d = setup("scatter", { kind: "series", columnId: "a", part: "points" });
    fireEvent.click(scopeToggle(d.container, "Apply to whole graph")!);
    clickSwatch(d.container);
    expect(d.onSetSeriesStyleAll.mock.calls[0]![0]).toEqual(seriesIds);
  });

  it("whole-series off + a selected point → that point only", () => {
    const d = setup("box", { kind: "series", columnId: "a", part: "points", rowId: "r1" });
    fireEvent.click(scopeToggle(d.container, "Apply to whole series")!); // turn off
    clickSwatch(d.container);
    expect(d.onSetPointStyle).toHaveBeenCalled();
    expect(d.onSetPointStyle.mock.calls[0]![0]).toBe("a");
    expect(d.onSetPointStyle.mock.calls[0]![1]).toBe("r1");
    expect(d.onSetSeriesStyleAll).not.toHaveBeenCalled();
  });

  it("the per-series toggle stays visible (greyed/disabled) while whole-graph is on — no trap", () => {
    const d = setup("box", { kind: "series", columnId: "a", part: "points" });
    const ws = scopeToggle(d.container, "Apply to whole series")!;
    expect(ws).toBeTruthy();
    expect(ws.disabled).toBe(false); // active by default
    fireEvent.click(scopeToggle(d.container, "Apply to whole graph")!);
    const ws2 = scopeToggle(d.container, "Apply to whole series");
    expect(ws2).toBeTruthy(); // still shown (not hidden)
    expect(ws2!.disabled).toBe(true); // but disabled while whole-graph overrides
    expect(d.container.textContent).toContain("overridden by whole graph");
  });

  it("whole-graph is controlled — the Inspector never owns it, so a canvas drag can share it", () => {
    // The anti-stuck guarantee (a fresh graph starts off) belongs to AppShell, which resets
    // the scope per graph — proven end-to-end in `e2e/scope.spec.ts` ("resets when you
    // switch to a different graph"). What matters here is only that the
    // Inspector defers to its parent: it must render the parent's value and report changes up,
    // never keep a private copy, which the box-width drag on the canvas could not reach.
    const onSetWholeGraph = vi.fn();
    const plot: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "box" };
    const h = {
      onSelect: vi.fn(),
      onSetAxis: vi.fn(), onSetAxisLength: vi.fn(), onSetAxisTitleFont: vi.fn(),
      onSetSeriesStyle: vi.fn(), onSetSeriesStyleAll: vi.fn(), onSetPointStyle: vi.fn(), onClearPointStyles: vi.fn(),
      onSetGrid: vi.fn(), onSetFrame: vi.fn(), onSetKind: vi.fn(), onSetBarLayout: vi.fn(), onSetBarShape: vi.fn(), onSetBoxWhisker: vi.fn(),
      onSetPlotOptions: vi.fn(), onSetGraphTitle: vi.fn(), onSetPlotFont: vi.fn(), onHomogenizeFont: vi.fn(),
      onSetLegend: vi.fn(), onSetSignificance: vi.fn(), onApplyPreset: vi.fn(), 
      onApplyUserPreset: vi.fn(), onSaveUserPreset: vi.fn(), onDeleteUserPreset: vi.fn(), onSetProfileDefault: vi.fn(),
      annotationOps: { add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() },
    };
    const sel: GraphSelection = { kind: "series", columnId: "a", part: "points" };
    // Parent says off → renders off; clicking reports up rather than flipping a private copy.
    const off = render(<Inspector activeSection="data" selection={sel} plot={plot} table={table} userPresets={[]} profileDefault={null} wholeGraph={false} onSetWholeGraph={onSetWholeGraph} {...h} />);
    const box = scopeToggle(off.container, "Apply to whole graph")!;
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    expect(onSetWholeGraph).toHaveBeenCalledWith(true);
    expect(scopeToggle(off.container, "Apply to whole graph")!.checked, "must not self-toggle").toBe(false);
    cleanup();
    // Parent says on → renders on.
    const on = render(<Inspector activeSection="data" selection={sel} plot={plot} table={table} userPresets={[]} profileDefault={null} wholeGraph onSetWholeGraph={onSetWholeGraph} {...h} />);
    expect(scopeToggle(on.container, "Apply to whole graph")!.checked).toBe(true);
  });

  it("width honours the scope too — not just colour", () => {
    // The other cases here drive the scope through a colour swatch; this one drives the
    // width path. The canvas drag half is proven in `e2e/scope.spec.ts`; this is the
    // Inspector control.
    const d = setup("box", { kind: "series", columnId: "a", part: "points" });
    fireEvent.click(scopeToggle(d.container, "Apply to whole graph")!);
    const width = [...d.container.querySelectorAll<HTMLInputElement>("input.numin, input[type='range']")]
      .find((i) => (i.closest(".frow")?.querySelector("span")?.textContent ?? "").startsWith("Width"));
    expect(width, "no Width control in the box panel").toBeTruthy();
    fireEvent.change(width!, { target: { value: "0.7" } });
    expect(d.onSetSeriesStyleAll, "a width edit under whole-graph must fan out").toHaveBeenCalled();
    expect(d.onSetSeriesStyleAll.mock.calls[0]![0]).toEqual(seriesIds);
    expect(d.onSetSeriesStyleAll.mock.calls[0]![1]).toHaveProperty("boxWidth");
  });
});

// Volcano paints each marker by significance zone (up/down/ns), which overrides the
// whole-series marker colour + forces a solid fill with a var(--bg) ring. Those
// whole-series controls would therefore change nothing and are hidden at that scope — but
// the per-point recolour path (plot.pointStyles) works, so they stay for a point.
describe("Inspector — volcano whole-series controls that cannot change the drawing", () => {
  const vtable: DataTable = {
    id: "t", kind: "xy", name: "V",
    columns: [{ id: "fc", name: "log2FC", role: "x" }, { id: "p", name: "-log10p", role: "y" }],
    rows: [{ id: "up", cells: { fc: 2, p: 4 } }, { id: "dn", cells: { fc: -2, p: 4 } }],
  };
  const hasRow = (c: HTMLElement, label: string): boolean =>
    [...c.querySelectorAll(".frow > span")].some((s) => s.textContent === label);
  const optionLabels = (c: HTMLElement): (string | null)[] =>
    [...c.querySelectorAll("select")].flatMap((sel) => [...sel.options].map((o) => o.textContent));

  it("whole-series scope hides the ineffective Colour + Outline controls and the open/clear fill options", () => {
    const d = setup("volcano", { kind: "series", columnId: "p", part: "points" }, vtable);
    // whole-series is the default scope → the ineffective controls are hidden.
    expect(hasRow(d.container, "Colour")).toBe(false);
    expect(hasRow(d.container, "Outline colour")).toBe(false);
    const opts = optionLabels(d.container);
    expect(opts).not.toContain("Open (hollow)");
    expect(opts).not.toContain("Clear (see-through)");
    expect(opts).toContain("Solid"); // solid + two-tone survive (both render)
  });

  it("per-point scope keeps them — per-point recolour works", () => {
    const d = setup("volcano", { kind: "series", columnId: "p", part: "points", rowId: "up" }, vtable);
    fireEvent.click(scopeToggle(d.container, "Apply to whole series")!); // off → per-point
    expect(hasRow(d.container, "Colour")).toBe(true);
    expect(hasRow(d.container, "Outline colour")).toBe(true);
    expect(optionLabels(d.container)).toContain("Open (hollow)");
  });

  it("exposes the Point-labels control (gene names) but not the colour/symbol-by-column binding", () => {
    const d = setup("volcano", { kind: "series", columnId: "p", part: "points" }, vtable);
    expect(hasRow(d.container, "Label points")).toBe(true); // point labels enabled for volcano
    expect(hasRow(d.container, "Colour by")).toBe(false); // colour-by-column would override the zone hue
    expect(hasRow(d.container, "Shape by")).toBe(false);
  });
});

// The Error-bars control group must not appear for kinds whose builders draw no error
// bars (ROC/Bland-Altman/scatter3d/ridgeline/parallel) — there it would change nothing and
// mislead. It must appear for the kinds that do draw them (bar points, xy line).
describe("Inspector — Error-bars group gated for error-less kinds", () => {
  const hasGroup = (c: HTMLElement, name: string): boolean =>
    [...c.querySelectorAll("button.inspsub")].some((b) => (b.textContent ?? "").includes(name));

  // Lollipop is not in the error-less set: the builder draws an opt-in mean±error
  // whisker on the dot (default type "none"), so the group changes the drawing.
  it("lollipop point panel shows the Error bars group (the opt-in whisker is drawn)", () => {
    const d = setup("lollipop", { kind: "series", columnId: "a", part: "points" }, repTable);
    expect(hasGroup(d.container, "Error bars")).toBe(true);
  });

  it("scatter3d point panel omits the Error bars group", () => {
    const d = setup("scatter3d", { kind: "series", columnId: "a", part: "points" });
    expect(hasGroup(d.container, "Error bars")).toBe(false);
  });

  it("ROC line panel omits the Error bars group", () => {
    const d = setup("roc", { kind: "series", columnId: "a", part: "line" });
    expect(hasGroup(d.container, "Error bars")).toBe(false);
  });

  // buildParallelScene draws per-axis polylines only (no errLow/errHigh), so both the point
  // editor (fall-through "other point kinds") and the line editor must omit the group.
  it("parallel point + line panels omit the Error bars group", () => {
    const pts = setup("parallel", { kind: "series", columnId: "a", part: "points" });
    expect(hasGroup(pts.container, "Error bars")).toBe(false);
    cleanup();
    const line = setup("parallel", { kind: "series", columnId: "a", part: "line" });
    expect(hasGroup(line.container, "Error bars")).toBe(false);
  });

  it("bar point panel shows the Error bars group (positive control)", () => {
    const d = setup("bar", { kind: "series", columnId: "a", part: "points" }, spreadTable);
    expect(hasGroup(d.container, "Error bars")).toBe(true);
  });

  it("xy line panel shows the Error bars group (positive control)", () => {
    const d = setup("xy", { kind: "series", columnId: "a", part: "line" }, repTable);
    expect(hasGroup(d.container, "Error bars")).toBe(true);
  });

  // The ridgeline builder paints series.fillSpec, so the Area-fill group is offered for
  // ridgeline too, not only for kind==="area".
  it("ridgeline line panel exposes the Area fill group", () => {
    const d = setup("ridgeline", { kind: "series", columnId: "a", part: "line" });
    expect(hasGroup(d.container, "Area fill")).toBe(true);
  });
});

// Forest CI whiskers come from the lower/upper columns, so the error-bar Type dropdown
// would change nothing, and its "none" default must not hide the whisker Direction/Caps/
// Colour/Width controls (which do apply to the drawn whiskers).
describe("Inspector — forest error-bar Type gated, whisker controls reachable", () => {
  const hasField = (c: HTMLElement, label: string): boolean =>
    [...c.querySelectorAll(".frow > span")].some((s) => s.textContent === label);

  it("forest hides the ineffective Type dropdown but exposes Direction + Caps", () => {
    const d = setup("forest", { kind: "series", columnId: "a", part: "points" });
    expect(hasField(d.container, "Type")).toBe(false); // changes nothing → hidden for forest
    expect(hasField(d.container, "Direction")).toBe(true); // whisker controls stay reachable
    expect(hasField(d.container, "Caps")).toBe(true);
  });

  it("bar shows the error-bar Type dropdown (positive control)", () => {
    const d = setup("bar", { kind: "series", columnId: "a", part: "points" }, spreadTable);
    expect(hasField(d.container, "Type")).toBe(true);
  });
});

// The "Render as" / "Value axis" (Plot as) controls follow what the bar builder draws in
// each orientation.
describe("Inspector — bar 'Plot as' controls gated to vertical bars", () => {
  const hasField = (c: HTMLElement, label: string): boolean =>
    [...c.querySelectorAll(".frow > span")].some((s) => s.textContent === label);

  it("a vertical bar shows Render as + Value axis", () => {
    const d = setup("bar", { kind: "series", columnId: "a", part: "points" }, table, { barOrientation: "vertical" });
    expect(hasField(d.container, "Render as")).toBe(true);
    expect(hasField(d.container, "Value axis")).toBe(true);
  });

  // The horizontal builder draws the transposed line / points / area, so "Render as" stays.
  // Horizontal bars draw their second axis along the top (bar-horizontal-top-axis.test.ts),
  // so "Value axis" is live too (it reads Bottom / Top).
  it("a horizontal bar keeps Render as and Value axis — both draw", () => {
    const d = setup("bar", { kind: "series", columnId: "a", part: "points" }, table, { barOrientation: "horizontal" });
    expect(hasField(d.container, "Render as")).toBe(true);
    expect(hasField(d.container, "Value axis")).toBe(true);
  });
});

// With Connect="None" an xy series draws no line, so the line panel (only reachable by
// clicking the line) becomes unreachable — stranding the Connect control. It must stay
// reachable from the point editor (as it is for before-after).
describe("Inspector — Connect reachable from the xy point panel", () => {
  const hasField = (c: HTMLElement, label: string): boolean =>
    [...c.querySelectorAll(".frow > span")].some((s) => s.textContent === label);

  it("xy point panel exposes the Connect control", () => {
    const d = setup("xy", { kind: "series", columnId: "a", part: "points" });
    expect(hasField(d.container, "Connect")).toBe(true);
  });

  it("bar point panel does not show Connect (no connecting line — negative control)", () => {
    const d = setup("bar", { kind: "series", columnId: "a", part: "points" });
    expect(hasField(d.container, "Connect")).toBe(false);
  });
});

// Floating bar renders a min→max box with a centre line — it needs Fill/Contour/Opacity +
// Width + Centre-line controls, not the xy marker + error-bar fields.
describe("Inspector — floatingbar series panel", () => {
  const groups = (c: HTMLElement): string[] => [...c.querySelectorAll("button.inspsub")].map((b) => (b.textContent ?? "").replace("▾", "").trim());
  const has = (c: HTMLElement, label: string): boolean => [...c.querySelectorAll(".frow > span")].some((s) => s.textContent === label);

  it("exposes Fill/Contour + Centre line, and leaves out the marker + error-bar groups it does not draw", () => {
    const d = setup("floatingbar", { kind: "series", columnId: "a", part: "points" });
    const g = groups(d.container);
    expect(g).toContain("Fill"); // box fill + contour + opacity
    expect(g).toContain("Centre line"); // the defining median/mean line
    expect(g).not.toContain("Data points"); // no xy marker group: no markers are drawn
    expect(g).not.toContain("Error bars"); // no error-bar group: no error bars are drawn
    expect(has(d.container, "Contour")).toBe(true); // fillFields Contour colour
    expect(has(d.container, "Opacity")).toBe(true); // fill opacity
  });
});

/**
 * The two scope rows must be individually addressable.
 *
 * If both carried only `.ppoint`, `querySelector(".ppoint")` would return the whole-graph row
 * when a caller meant the whole-series one. A test that toggled "the scope checkbox" would
 * then flip the wrong switch and leave whole-series on — which recolours every point and
 * looks exactly like a broken per-point scope. This keeps the two class names apart.
 */
describe("Inspector — the scope rows are distinguishable", () => {
  it("gives the whole-graph and whole-series rows distinct classes", () => {
    const d = setup("scatter", { kind: "series", columnId: "a", part: "points", rowId: "r1" });
    const graph = d.container.querySelectorAll(".ppoint-graph");
    const series = d.container.querySelectorAll(".ppoint-series");
    expect(graph.length, "no whole-graph scope row").toBe(1);
    expect(series.length, "no whole-series scope row").toBe(1);
    expect(graph[0]).not.toBe(series[0]);
    // Each class must land on the row carrying its own label, not merely be present.
    expect(graph[0]!.textContent).toContain("Apply to whole graph");
    expect(series[0]!.textContent).toContain("Apply to whole series");
    // And the shared marker still selects both, for anything that wants the pair.
    expect(d.container.querySelectorAll(".ppoint").length).toBe(2);
  });
});

/**
 * Clicking the category axis must offer its typography.
 *
 * On a bar chart the category axis carries the treatment names, so it is the obvious place
 * to look for their size. Guards against that branch returning early — before the Fonts
 * section — with only a note pointing elsewhere. A note is not a control.
 */
describe("Inspector — the category axis carries its own font controls", () => {
  const catAxis = { kind: "axis", axis: "x" } as GraphSelection;
  const text = (c: HTMLElement): string => (c.querySelector(".inspbody")?.textContent ?? "").replace(/\s+/g, " ");

  it("offers a Fonts section on a bar chart's category axis", () => {
    const d = setup("bar", catAxis);
    expect(text(d.container), "the category axis has no Fonts section").toMatch(/Fonts/);
    // Named for what these labels are here — they are category names, not tick numbers.
    expect(text(d.container), "no control for the category label size").toMatch(/Category label font/);
    expect(text(d.container), "no per-axis title font on the category axis").toMatch(/axis title font/i);
  });

  it("does not warn that the size is shared — it is per-axis", () => {
    // Sizing is per-axis (AxisSpec.tickFont), so a label saying it is shared with the value
    // axis would be false: a caveat that does not apply is as misleading as a missing one.
    const d = setup("bar", catAxis);
    expect(text(d.container)).not.toMatch(/shared with the value axis/i);
    expect(text(d.container), "the category label control disappeared").toMatch(/Category label font/);
  });

  it("keeps scale/range off the category axis (they belong to the value axis)", () => {
    // The category-axis branch keeps numeric controls off a category axis; offering fonts
    // there must not bring them in.
    const d = setup("bar", catAxis);
    expect(text(d.container)).not.toMatch(/Log₁₀|Minor ticks/);
    expect(text(d.container), "the signpost to the value axis is missing").toMatch(/value \(Y\) axis/);
  });
});

/**
 * Flipped charts: the tick-font controls show, and edit, the font the labels are drawn with.
 * On a horizontal bar / box / violin / column scatter / floating
 * bar the names down the left are drawn with the left axis's own tick font (`plot.yAxis.tickFont` → `fonts.yTick`)
 * and the numbers along the bottom with the bottom axis's (`plot.xAxis.tickFont`); both controls write there. Guards
 * against the controls displaying, and merging every edit into, the swapped data axis's font: the names' Size box
 * showing the numbers' size, and ticking Bold copying the numbers' size and family onto the names.
 *
 * The oracle is the scene: the Size box must show the size the builder draws those labels at.
 */
describe("Inspector — tick-font controls show and edit the font the labels are drawn with, flipped or not", () => {
  /** The Size box and the Bold tick of the font block headed `label`. */
  const fontRows = (c: HTMLElement, label: string) => {
    const head = [...c.querySelectorAll(".inspsub")].find((e) => e.textContent === label);
    if (!head) return null;
    const rows: Element[] = [];
    for (let e = head.nextElementSibling; e && !e.classList.contains("inspsub"); e = e.nextElementSibling) rows.push(e);
    const row = (name: string) => rows.find((r) => r.matches("label.frow") && r.querySelector(":scope > span")?.textContent === name);
    return {
      size: row("Size")?.querySelector("input") as HTMLInputElement | undefined,
      bold: row("Style")?.querySelector('input[type="checkbox"]') as HTMLInputElement | undefined,
    };
  };
  // A different font on each axis, so a control reading the wrong one cannot show the right size by chance.
  const X_FONT = { size: 30, family: "Georgia" };
  const Y_FONT = { size: 11 };
  const CASES = [
    { kind: "bar", orient: "horizontal", axis: "y", label: "Category label font", drawn: "yTick", own: Y_FONT },
    { kind: "bar", orient: "horizontal", axis: "x", label: "Tick label font", drawn: "xTick", own: X_FONT },
    { kind: "box", orient: "horizontal", axis: "y", label: "Category label font", drawn: "yTick", own: Y_FONT },
    { kind: "box", orient: "horizontal", axis: "x", label: "Tick label font", drawn: "xTick", own: X_FONT },
    // Not flipped: the data axis and the on-screen axis are the same one.
    { kind: "bar", orient: "vertical", axis: "x", label: "Category label font", drawn: "xTick", own: X_FONT },
    { kind: "bar", orient: "vertical", axis: "y", label: "Tick label font", drawn: "yTick", own: Y_FONT },
  ] as const;

  for (const c of CASES) {
    it(`${c.orient} ${c.kind}, clicked ${c.axis.toUpperCase()} axis: "${c.label}"`, async () => {
      const { buildPlotScene } = await import("@mady/graphics");
      const extra: Partial<Plot> = { barOrientation: c.orient, xAxis: { tickFont: X_FONT }, yAxis: { tickFont: Y_FONT } };
      const plot: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: c.kind, ...extra };
      const drawn = buildPlotScene(table, plot, { width: 580, height: 400 }).fonts[c.drawn].size;
      expect(drawn, "these labels are not drawn with the clicked axis's own font — the fixture cannot show the mismatch").toBe(c.own.size);

      const d = setup(c.kind, { kind: "axis", axis: c.axis } as GraphSelection, table, extra);
      const r = fontRows(d.container, c.label);
      expect(r?.size, `no "${c.label}" Size box on this axis`).toBeTruthy();
      expect(Number(r!.size!.value), "the Size box shows a size these labels are not drawn at").toBe(drawn);

      fireEvent.click(r!.bold!);
      expect(d.onSetAxis, "Bold did not land on the clicked axis's own font, or carried the other axis's fields").toHaveBeenLastCalledWith(
        c.axis,
        { tickFont: { ...c.own, bold: true } },
      );
    });
  }

  // An axis's own font that sets only some fields inherits the rest from the chart-wide font, field by field — and so
  // must the box. A house style sets the chart-wide sizes (axis titles 22), so the common case is an axis with no size
  // of its own: the title box must not show the grey built-in "15" about a title drawn at 22, nor a tick box whose
  // axis font set only Bold show "13" about labels drawn at the chart-wide size.
  const INHERIT = [
    { orient: "horizontal", axis: "y", tick: "Category label font", title: "Y-axis title font" },
    { orient: "horizontal", axis: "x", tick: "Tick label font", title: "X-axis title font" },
    { orient: "vertical", axis: "x", tick: "Category label font", title: "X-axis title font" },
    { orient: "vertical", axis: "y", tick: "Tick label font", title: "Y-axis title font" },
  ] as const;
  const inheriting = async (orient: "horizontal" | "vertical", axis: "x" | "y") => {
    const { buildPlotScene } = await import("@mady/graphics");
    const extra: Partial<Plot> = {
      barOrientation: orient,
      fonts: { tick: { size: 19 }, axisTitle: { size: 22 } },
      xAxis: { title: "Group", tickFont: { bold: true } },
      yAxis: { title: "Value", tickFont: { bold: true } },
    };
    const plot: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "bar", ...extra };
    const sc = buildPlotScene(table, plot, { width: 580, height: 400 });
    const drawn = { tick: sc.fonts[axis === "x" ? "xTick" : "yTick"].size, title: sc.fonts[axis === "x" ? "xAxisTitle" : "yAxisTitle"].size };
    expect(drawn, "the chart-wide sizes do not reach the drawing — the fixture cannot show the default leaking through").toEqual({ tick: 19, title: 22 });
    return { d: setup("bar", { kind: "axis", axis } as GraphSelection, table, extra), drawn };
  };
  for (const c of INHERIT) {
    it(`${c.orient} bar, clicked ${c.axis.toUpperCase()} axis: "${c.tick}" shows the size inherited from the chart-wide tick font`, async () => {
      const { d, drawn } = await inheriting(c.orient, c.axis);
      expect(fontRows(d.container, c.tick)?.size?.value, "the Size box does not show the size the labels are drawn at").toBe(String(drawn.tick));
      fireEvent.click(fontRows(d.container, c.tick)!.bold!);
      // Un-ticking Bold must not bake the chart-wide size into the axis's own font.
      expect(d.onSetAxis).toHaveBeenLastCalledWith(c.axis, { tickFont: { bold: undefined } });
    });
    it(`${c.orient} bar, clicked ${c.axis.toUpperCase()} axis: "${c.title}" shows the size inherited from the chart-wide title font`, async () => {
      const { d, drawn } = await inheriting(c.orient, c.axis);
      expect(fontRows(d.container, c.title)?.size?.value, "the Size box does not show the size the title is drawn at").toBe(String(drawn.title));
    });
  }
});
