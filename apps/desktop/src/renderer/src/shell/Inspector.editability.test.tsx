// @vitest-environment jsdom
// Inspector editability guards: for each chart kind covered here, its style controls are
// offered when they affect the drawing and route their edits to the field the builder
// reads. Three kinds have their own style editors:
//   • raincloud  — its own field set (cloud/box/rain controls) + violin-style whole-group
//                  routing, never the xy marker editor and never a dead per-point
//                  pointStyle key.
//   • scatter3d  — a "3-D scatter" Inspector section (marker + axis styling, editable
//                  axis titles).
//   • beforeafter— marker + line (no irrelevant error bars), and every edit routes to
//                  the selected subject's series style.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { Annotation, DataTable, Plot, PlotKind } from "@mady/core";
import { tableDatasets } from "@mady/core";
import { buildPlotScene, seriesColor } from "@mady/graphics";
import { Inspector } from "./Inspector";
import type { GraphSelection } from "./AppShell";

afterEach(cleanup);
afterEach(() => globalThis.localStorage?.clear());

const handlers = () => ({
  onSelect: vi.fn(),
  onSetAxis: vi.fn(), onSetAxisLength: vi.fn(), onSetAxisTitleFont: vi.fn(),
  onSetSeriesStyle: vi.fn(), onSetSeriesStyleAll: vi.fn(), onSetPointStyle: vi.fn(), onClearPointStyles: vi.fn(),
  onSetGrid: vi.fn(), onSetFrame: vi.fn(), onSetKind: vi.fn(), onSetBarLayout: vi.fn(), onSetBarShape: vi.fn(), onSetBoxWhisker: vi.fn(),
  onSetPlotOptions: vi.fn(), onSetGraphTitle: vi.fn(), onSetPlotFont: vi.fn(), onHomogenizeFont: vi.fn(),
  onSetLegend: vi.fn(), onSetSignificance: vi.fn(), onApplyPreset: vi.fn(), 
  onApplyUserPreset: vi.fn(), onSaveUserPreset: vi.fn(), onDeleteUserPreset: vi.fn(), onSetProfileDefault: vi.fn(),
  annotationOps: { add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() },
});

function setup(table: DataTable, kind: PlotKind, selection: GraphSelection, plotExtra: Partial<Plot> = {}) {
  const plot: Plot = { id: "p", name: "P", source: table.id, status: "ok", styleOverrides: {}, kind, ...plotExtra };
  const h = handlers();
  const u = render(
    <Inspector activeSection="graphs" selection={selection} plot={plot} table={table} userPresets={[]} profileDefault={null} {...h} />,
  );
  return { ...u, ...h };
}

/** The group labels (`.frow > span:first-child`) present anywhere in the panel. */
function fieldLabels(container: HTMLElement): string[] {
  return [...container.querySelectorAll(".frow > span:first-child")].map((s) => (s.textContent ?? "").trim());
}
function fieldByLabel(container: HTMLElement, label: string): HTMLInputElement {
  const span = [...container.querySelectorAll(".frow > span")].find((s) => s.textContent === label);
  if (!span) throw new Error(`no field labelled "${label}"`);
  return span.parentElement!.querySelector("input, select") as HTMLInputElement;
}
/** SchemaForm group headings (`button.inspsub`) — precise, unlike a textContent scan
 *  (which also picks up the always-present "Error bars need ≥2 replicates" note). */
function groupHeadings(container: HTMLElement): string[] {
  return [...container.querySelectorAll("button.inspsub")].map((b) => (b.textContent ?? "").replace("▾", "").trim());
}

// ── error-type menu gates to what a summary entry can actually draw ────────────
describe("Inspector — error-type menu honours the entry format", () => {
  const summaryTable: DataTable = {
    id: "t", kind: "column", name: "T",
    columns: [
      { id: "g", name: "", role: "x" },
      { id: "m", name: "Dose", role: "y" },
      { id: "s", name: "Dose SD", role: "sd", group: "m" }, // SD without N
    ],
    rows: [
      { id: "r0", cells: { g: "A", m: 10, s: 2 } },
      { id: "r1", cells: { g: "B", m: 20, s: 3 } },
    ],
  };
  const replicateTable: DataTable = {
    id: "t", kind: "column", name: "T",
    columns: [
      { id: "g", name: "", role: "x" },
      { id: "m", name: "Dose", role: "y" },
      { id: "m2", name: "Dose 2", role: "y", group: "m" },
    ],
    rows: [
      { id: "r0", cells: { g: "A", m: 10, m2: 12 } },
      { id: "r1", cells: { g: "B", m: 20, m2: 22 } },
    ],
  };
  const optionValues = (sel: HTMLElement) =>
    [...sel.querySelectorAll("option")].map((o) => (o as HTMLOptionElement).value);

  it("Mean+SD without N offers only None + SD (no SEM/CI/range/IQR to draw a blank)", () => {
    const d = setup(summaryTable, "bar", { kind: "series", columnId: "m" });
    expect(optionValues(fieldByLabel(d.container, "Type"))).toEqual(["none", "sd"]);
  });
  it("raw replicates keep the full error-type menu", () => {
    const d = setup(replicateTable, "bar", { kind: "series", columnId: "m" });
    expect(optionValues(fieldByLabel(d.container, "Type"))).toEqual(["none", "sd", "sem", "ci95", "range", "geoSd", "iqr"]);
  });
  it("Median+IQR entry gates the menu to None + IQR", () => {
    const iqrTable: DataTable = {
      id: "t", kind: "column", name: "T",
      columns: [
        { id: "g", name: "", role: "x" },
        { id: "m", name: "Med", role: "y" },
        { id: "a", name: "Q1", role: "q1", group: "m" },
        { id: "b", name: "Q3", role: "q3", group: "m" },
      ],
      rows: [{ id: "r0", cells: { g: "A", m: 5, a: 3, b: 8 } }],
    };
    const d = setup(iqrTable, "bar", { kind: "series", columnId: "m" });
    expect(optionValues(fieldByLabel(d.container, "Type"))).toEqual(["none", "iqr"]);
  });
});

// ── area: Spread band control only when NOT stacked ───────────────────────────
describe("Inspector — area Spread band control gating", () => {
  const areaTable: DataTable = {
    id: "t", kind: "xy", name: "T",
    columns: [{ id: "x", name: "X" }, { id: "y1", name: "A" }, { id: "y2", name: "B" }],
    rows: [
      { id: "r1", cells: { x: 1, y1: 2, y2: 3 } },
      { id: "r2", cells: { x: 2, y1: 4, y2: 5 } },
      { id: "r3", cells: { x: 3, y1: 6, y2: 7 } },
    ],
  };
  it("shows the Spread band control for an overlaid area", () => {
    const d = setup(areaTable, "area", { kind: "plot" }, { areaStack: "none" });
    expect(fieldLabels(d.container)).toContain("Spread band");
  });
  it("hides the Spread band control for a stacked area (the builder suppresses the band when stacked)", () => {
    for (const areaStack of ["stacked", "percent"] as const) {
      const d = setup(areaTable, "area", { kind: "plot" }, { areaStack });
      expect(fieldLabels(d.container)).not.toContain("Spread band");
      cleanup();
    }
  });

  // The rendered fill opacity default is 0.85 (stacked) vs 0.22 (overlaid),
  // so the unset Area-fill Opacity slider must reflect that — not a static 0.22.
  const rangeValues = (c: HTMLElement) => [...c.querySelectorAll('input[type="range"]')].map((i) => (i as HTMLInputElement).value);
  it("area-fill Opacity slider default is 0.85 when stacked, 0.22 when overlaid", () => {
    const stacked = setup(areaTable, "area", { kind: "series", columnId: "y1" }, { areaStack: "stacked" });
    expect(rangeValues(stacked.container)).toContain("0.85");
    expect(rangeValues(stacked.container)).not.toContain("0.22");
    cleanup();
    const overlaid = setup(areaTable, "area", { kind: "series", columnId: "y1" }, { areaStack: "none" });
    expect(rangeValues(overlaid.container)).toContain("0.22");
    expect(rangeValues(overlaid.container)).not.toContain("0.85");
  });
});

// ── bar: a Value-decimals control appears when Show values is on ──────────────────
describe("Inspector — bar value-label decimals", () => {
  const barTable: DataTable = {
    id: "t", kind: "column", name: "T",
    columns: [{ id: "g", name: "Group", role: "x" }, { id: "y", name: "Y", role: "y" }],
    rows: [{ id: "r1", cells: { g: 1, y: 3 } }, { id: "r2", cells: { g: 2, y: 5 } }],
  };
  it("hides the Value-decimals control until Show values is on, then sets valueDecimals", () => {
    const off = setup(barTable, "bar", { kind: "plot" });
    expect(fieldLabels(off.container)).not.toContain("Value decimals");
    cleanup();
    const on = setup(barTable, "bar", { kind: "plot" }, { showValues: true });
    expect(fieldLabels(on.container)).toContain("Value decimals");
    fireEvent.change(fieldByLabel(on.container, "Value decimals"), { target: { value: "2" } });
    expect(on.onSetPlotOptions).toHaveBeenCalledWith({ valueDecimals: 2 });
  });
});

// ── graduated fill: the ramp's manual bounds ──────────────────────────────────
describe("Inspector — graduated-fill scale bounds", () => {
  const barTable: DataTable = {
    id: "t", kind: "column", name: "T",
    columns: [{ id: "g", name: "Group", role: "x" }, { id: "y", name: "Y", role: "y" }],
    rows: [{ id: "r1", cells: { g: 1, y: 3 } }, { id: "r2", cells: { g: 2, y: 5 } }],
  };
  const sel: GraphSelection = { kind: "series", columnId: "y" };

  it("offers Scale min/max only for a graduated fill, and writes gradMin/gradMax", () => {
    // Not a graduated fill → the bounds are irrelevant and must not clutter the panel.
    const plain = setup(barTable, "bar", sel, { seriesStyles: { y: { fillType: "solid" } } });
    expect(fieldLabels(plain.container)).not.toContain("Scale min");
    cleanup();
    const grad = setup(barTable, "bar", sel, { seriesStyles: { y: { fillType: "graduated" } } });
    expect(fieldLabels(grad.container), "the graduated ramp's bounds are unreachable").toEqual(
      expect.arrayContaining(["Scale min", "Scale max"]),
    );
    fireEvent.change(fieldByLabel(grad.container, "Scale min"), { target: { value: "2" } });
    expect(grad.onSetSeriesStyle).toHaveBeenCalledWith("y", expect.objectContaining({ gradMin: 2 }));
    fireEvent.change(fieldByLabel(grad.container, "Scale max"), { target: { value: "9" } });
    expect(grad.onSetSeriesStyle).toHaveBeenCalledWith("y", expect.objectContaining({ gradMax: 9 }));
  });

  it("shows 'auto' when unset and clearing the box returns to auto (not 0 or NaN)", () => {
    const d = setup(barTable, "bar", sel, { seriesStyles: { y: { fillType: "graduated", gradMin: 2 } } });
    const min = fieldByLabel(d.container, "Scale min");
    expect(min.placeholder).toBe("auto");
    expect(min.value).toBe("2");
    fireEvent.change(min, { target: { value: "" } });
    // undefined = auto. A plain number field would coerce this to 0 and silently pin the
    // ramp's low end — which is why these fields use the `optnumber` kind.
    expect(d.onSetSeriesStyle).toHaveBeenCalledWith("y", expect.objectContaining({ gradMin: undefined }));
    cleanup();
    const unset = setup(barTable, "bar", sel, { seriesStyles: { y: { fillType: "graduated" } } });
    expect(fieldByLabel(unset.container, "Scale min").value).toBe("");
  });
});

// ── network link: style one link, or every link, from the link you clicked ─────
describe("Inspector — network link (edge) style scope", () => {
  const netTable: DataTable = { id: "t", kind: "xy", name: "T", columns: [{ id: "s", name: "Source" }], rows: [] };
  const sel: GraphSelection = { kind: "network-edge", edgeId: "IFNγ→STAT1" };
  const segment = (c: HTMLElement, text: string): HTMLButtonElement =>
    [...c.querySelectorAll("button.layseg-btn")].find((b) => b.textContent?.trim() === text) as HTMLButtonElement;

  it("names the link and defaults to styling that link only", () => {
    const d = setup(netTable, "network", sel);
    expect(d.container.textContent).toContain("IFNγ → STAT1");
    expect(segment(d.container, "This link").className).toContain("on");
    expect(segment(d.container, "All links").className).not.toContain("on");
    // colour / thickness / opacity all reachable
    expect(fieldLabels(d.container)).toEqual(expect.arrayContaining(["Link colour", "Thickness", "Opacity"]));
  });

  it("'This link' writes a per-edge override keyed by the edge, leaving the shared style alone", () => {
    const d = setup(netTable, "network", sel, { network: { edgeColor: "#5b6470", edgeWidth: 1 } });
    fireEvent.change(fieldByLabel(d.container, "Link colour"), { target: { value: "#ff0055" } });
    expect(d.onSetPlotOptions).toHaveBeenCalledWith({ network: { edgeColor: "#5b6470", edgeWidth: 1, edgeColors: { "IFNγ→STAT1": "#ff0055" } } });
    fireEvent.change(fieldByLabel(d.container, "Thickness"), { target: { value: "6" } });
    expect(d.onSetPlotOptions).toHaveBeenCalledWith({ network: { edgeColor: "#5b6470", edgeWidth: 1, edgeWidths: { "IFNγ→STAT1": 6 } } });
  });

  it("'All links' writes the shared edge style instead", () => {
    const d = setup(netTable, "network", sel, { network: { edgeColor: "#5b6470", edgeWidth: 1 } });
    fireEvent.click(segment(d.container, "All links"));
    expect(segment(d.container, "All links").className).toContain("on");
    fireEvent.change(fieldByLabel(d.container, "Link colour"), { target: { value: "#00aa88" } });
    expect(d.onSetPlotOptions).toHaveBeenCalledWith({ network: { edgeColor: "#00aa88", edgeWidth: 1 } });
    fireEvent.change(fieldByLabel(d.container, "Thickness"), { target: { value: "3" } });
    expect(d.onSetPlotOptions).toHaveBeenCalledWith({ network: { edgeColor: "#5b6470", edgeWidth: 3 } });
  });

  it("offers a Reset only once this link has been tuned, and it clears every override", () => {
    const plain = setup(netTable, "network", sel);
    expect(fieldLabels(plain.container)).not.toContain("This link");
    cleanup();
    const d = setup(netTable, "network", sel, { network: { edgeColor: "#5b6470", edgeColors: { "IFNγ→STAT1": "#ff0055" }, edgeWidths: { "IFNγ→STAT1": 6, "A→B": 2 } } });
    expect(fieldLabels(d.container)).toContain("This link");
    fireEvent.click([...d.container.querySelectorAll("button.swbtn")].find((b) => b.textContent === "Reset")!);
    // One patch that clears every override for this link at once. (Three sequential writes
    // would each rebuild from the same stale style, so the last would resurrect the first
    // two — assert the whole patch, not just its final key.)
    expect(d.onSetPlotOptions).toHaveBeenCalledTimes(1);
    expect(d.onSetPlotOptions).toHaveBeenCalledWith({
      network: {
        edgeColor: "#5b6470", // the shared style is untouched
        edgeColors: undefined, // emptied → dropped, no stray {}
        edgeWidths: { "A→B": 2 }, // ANOTHER link's override survives
        edgeOpacities: undefined,
      },
    });
  });
});

// ── PCA loadings: a colour control for the arrows/labels ─────────────────────
describe("Inspector — PCA loadings colour control", () => {
  const pcaData = { varLabels: ["Va", "Vb"], pcLabels: ["PC1", "PC2"], explained: [0.6, 0.4], eigenvalues: [1.5, 0.5], loadings: [[0.7, -0.2], [0.5, 0.6]], scores: [[-1, 0.4], [1, -0.3]] };
  const xyTable: DataTable = { id: "t", kind: "xy", name: "T", columns: [{ id: "x", name: "X" }], rows: [] };
  /**
   * The arrow opens "Vector colour" (writes `arrowColors`) and the label opens "Label colour"
   * (writes `varLabelColors`), so an arrow and its variable name can differ. For both ids this
   * checks that the panel does not report the arrow as removed, names the variable, and commits
   * the row through the clicked id.
   */
  it("selecting one loading arrow (or its label) offers a per-vector colour and names its variable", () => {
    for (const [id, row] of [["pca-arrow-1", "Vector colour"], ["pca-vlabel-1", "Label colour"]] as const) {
      const d = setup(xyTable, "pcabiplot", { kind: "annotation", id }, { pca: pcaData });
      // a fall-through would tell the user a builder-owned arrow had been "removed"
      expect(d.container.textContent ?? "").not.toMatch(/was removed/i);
      expect(d.container.textContent ?? "").toContain("Vb"); // names the variable it belongs to
      expect(fieldLabels(d.container)).toContain(row);
      fireEvent.change(fieldByLabel(d.container, row), { target: { value: "#ff0055" } });
      expect(d.annotationOps.update).toHaveBeenCalledWith(id, { color: "#ff0055" });
      cleanup();
    }
  });

  it("shows a Loadings colour control for pcaload/pcabiplot (not pcascore), wired to seriesStyles['pca-loadings']", () => {
    // pcascore draws only scores — no loading arrows, so no control
    expect(fieldLabels(setup(xyTable, "pcascore", { kind: "plot" }, { pca: pcaData }).container)).not.toContain("Loadings colour");
    cleanup();
    for (const kind of ["pcaload", "pcabiplot"] as const) {
      const d = setup(xyTable, kind, { kind: "plot" }, { pca: pcaData });
      expect(fieldLabels(d.container)).toContain("Loadings colour");
      fireEvent.change(fieldByLabel(d.container, "Loadings colour"), { target: { value: "#00aa88" } });
      expect(d.onSetSeriesStyle).toHaveBeenCalledWith("pca-loadings", { color: "#00aa88" });
      cleanup();
    }
  });
});

// ── alluvial: node-block labels get a reachable tick-font control ─────────────
describe("Inspector — alluvial node-label font", () => {
  const alTable: DataTable = {
    id: "t", kind: "multivariable", name: "T",
    columns: [{ id: "a", name: "A" }, { id: "b", name: "B" }],
    rows: [{ id: "r1", cells: { a: "x", b: "y" } }, { id: "r2", cells: { a: "x", b: "z" } }],
  };
  it("exposes a node-label tick font control that calls onSetPlotFont('tick', ...)", () => {
    const d = setup(alTable, "alluvial", { kind: "plot" });
    const headings = [...d.container.querySelectorAll(".inspsub")].map((s) => (s.textContent ?? "").trim());
    expect(headings).toContain("Node label font");
    fireEvent.change(fieldByLabel(d.container, "Size"), { target: { value: "18" } });
    expect(d.onSetPlotFont).toHaveBeenCalledWith("tick", { size: 18 });
  });
});

describe("Inspector — pyramid value-label font", () => {
  const pyrTable: DataTable = {
    id: "t", kind: "column", name: "T",
    columns: [{ id: "age", name: "Age", role: "x" }, { id: "m", name: "Male", role: "y" }, { id: "f", name: "Female", role: "y" }],
    rows: [{ id: "r0", cells: { age: "0-14", m: 62, f: 59 } }],
  };
  const headings = (c: HTMLElement) => [...c.querySelectorAll(".inspsub")].map((s) => (s.textContent ?? "").trim());
  it("exposes a Value label font control when Show values is on; calls onSetPlotFont('valueLabel', ...)", () => {
    const on = setup(pyrTable, "pyramid", { kind: "plot" }, { pyramid: { showValues: true } });
    expect(headings(on.container)).toContain("Value label font");
    fireEvent.change(fieldByLabel(on.container, "Size"), { target: { value: "16" } });
    expect(on.onSetPlotFont).toHaveBeenCalledWith("valueLabel", { size: 16 });
    // hidden when Show values is off (the font only affects the tip numbers)
    const off = setup(pyrTable, "pyramid", { kind: "plot" }, { pyramid: { showValues: false } });
    expect(headings(off.container)).not.toContain("Value label font");
  });
});

// ── estimation: the difference glyph swatch = seriesColor(2) ─────────────────
describe("Inspector — estimation difference glyph colour default", () => {
  const estTable: DataTable = {
    id: "t", kind: "column", name: "T",
    columns: [{ id: "g", name: "Row", role: "x" }, { id: "c", name: "Control", role: "y" }, { id: "t2", name: "Test", role: "y" }],
    rows: [1, 2, 3, 4].map((v, i) => ({ id: `r${i}`, cells: { g: i + 1, c: v, t2: v + 3 } })),
  };
  it("the click-selected est-diff series defaults its colour swatch to seriesColor(2), not seriesColor(0)", () => {
    const d = setup(estTable, "estimation", { kind: "series", columnId: "est-diff" });
    const colour = fieldByLabel(d.container, "Colour");
    expect(colour.value.toLowerCase()).toBe(seriesColor(2).toLowerCase());
    expect(colour.value.toLowerCase()).not.toBe(seriesColor(0).toLowerCase());
  });
});

// ── raincloud ────────────────────────────────────────────────────────────────
const distTable: DataTable = {
  id: "t", kind: "column", name: "Groups",
  columns: [
    { id: "g", name: "Group" },
    { id: "a", name: "Control" },
    { id: "b", name: "Treated" },
  ],
  rows: [
    { id: "r1", cells: { g: 1, a: 3, b: 8 } },
    { id: "r2", cells: { g: 2, a: 4, b: 9 } },
    { id: "r3", cells: { g: 3, a: 5, b: 7 } },
    { id: "r4", cells: { g: 4, a: 6, b: 10 } },
  ],
};

describe("Inspector — raincloud style editor", () => {
  const dsId = tableDatasets(distTable)[0]!.id;

  it("shows the cloud/box/rain controls (not the bare xy marker editor)", () => {
    const d = setup(distTable, "raincloud", { kind: "series", columnId: dsId });
    const labels = fieldLabels(d.container);
    // Fill + contour (cloud silhouette & inner box)
    expect(labels).toContain("Style");
    expect(labels).toContain("Contour");
    // Silhouette smoothness (KDE bandwidth) + inner box
    expect(labels).toContain("Smoothness");
    expect(d.container.textContent).toContain("Inner box");
    // Whisker / median styling
    expect(d.container.textContent).toContain("Whiskers");
    // The rain swarm
    expect(groupHeadings(d.container)).toContain("Rain points");
    // not the error-bars group (that belongs to the xy editor)
    expect(groupHeadings(d.container)).not.toContain("Error bars");
  });

  it("routes an edit to the series style, never a dead per-point key", () => {
    const d = setup(distTable, "raincloud", { kind: "series", columnId: dsId });
    fireEvent.change(fieldByLabel(d.container, "Smoothness"), { target: { value: "2" } });
    // whole-series default ON → all rainclouds; never onSetPointStyle
    expect(d.onSetPointStyle).not.toHaveBeenCalled();
    expect(d.onSetSeriesStyle.mock.calls.length + d.onSetSeriesStyleAll.mock.calls.length).toBeGreaterThan(0);
  });
});

describe("Inspector — column scatter centre / error controls", () => {
  const dsId = tableDatasets(distTable)[0]!.id;
  it("exposes an editable Centre & error colour + thickness group", () => {
    const d = setup(distTable, "scatter", { kind: "series", columnId: dsId });
    expect(groupHeadings(d.container)).toContain("Centre & error");
    fireEvent.change(fieldByLabel(d.container, "Thickness"), { target: { value: "3" } });
    const calls = [...d.onSetSeriesStyle.mock.calls, ...d.onSetSeriesStyleAll.mock.calls];
    expect(calls.some((c) => (c.find((a) => a && typeof a === "object" && "errorWidth" in a) as { errorWidth?: number } | undefined)?.errorWidth === 3)).toBe(true);
  });
});

// ── scatter3d ────────────────────────────────────────────────────────────────
const xyzTable: DataTable = {
  id: "t3", kind: "column", name: "3D",
  columns: [
    { id: "cx", name: "Length" },
    { id: "cy", name: "Width" },
    { id: "cz", name: "Height" },
  ],
  rows: [
    { id: "r1", cells: { cx: 1, cy: 2, cz: 3 } },
    { id: "r2", cells: { cx: 4, cy: 5, cz: 6 } },
  ],
};

describe("Inspector — scatter3d section", () => {
  it("renders the 3-D scatter section with X/Y/Z titles + marker + axis + grid", () => {
    const d = setup(xyzTable, "scatter3d", { kind: "plot" });
    expect(d.container.textContent).toContain("3-D scatter");
    const labels = fieldLabels(d.container);
    for (const l of ["X axis title", "Y axis title", "Z axis title", "Point colour", "Point size", "Axis colour", "Axis thickness", "Floor grid", "Grid colour"]) {
      expect(labels).toContain(l);
    }
  });

  it("editing the X title calls onSetAxis, Z title + grid go to onSetPlotOptions", () => {
    const d = setup(xyzTable, "scatter3d", { kind: "plot" });
    fireEvent.change(fieldByLabel(d.container, "X axis title"), { target: { value: "Custom X" } });
    expect(d.onSetAxis).toHaveBeenCalledWith("x", { title: "Custom X" });
    fireEvent.change(fieldByLabel(d.container, "Z axis title"), { target: { value: "Custom Z" } });
    const zCall = d.onSetPlotOptions.mock.calls.find((c) => c[0]?.scatter3d?.zTitle === "Custom Z");
    expect(zCall).toBeTruthy();
  });

  it("point size edits the y-column series style", () => {
    const d = setup(xyzTable, "scatter3d", { kind: "plot" });
    fireEvent.change(fieldByLabel(d.container, "Point size"), { target: { value: "9" } });
    expect(d.onSetSeriesStyle).toHaveBeenCalledWith("cy", { symbolSize: 9 });
  });
});

// The plot-panel "Series" list is keyed by the table's datasets. Kinds that draw
// synthetic series (clustering tree / PCA groups + loadings / scree components) don't
// map to those datasets, so the list would have no effect and would mislead — it is hidden.
describe("Inspector — no Series list for kinds that draw synthetic series", () => {
  const sectionTitles = (c: HTMLElement): string[] =>
    [...c.querySelectorAll(".inspsec > summary")].map((s) => (s.textContent ?? "").trim());

  /**
   * Every hide-toggle and colour swatch in a datasets-keyed list would write keys the builder
   * never reads; these series are styled by clicking them on the canvas. The Series section
   * instead carries a sentence naming what to click, so per-element styling is discoverable.
   *
   * The check is on the list itself: no list rows, no visibility checkboxes, no colour swatch.
   * That is stronger than checking for a section titled "Series" — a re-added list fails here
   * even though the section title is expected.
   */
  it.each(["dendrogram", "scree", "pcascore", "pcaload", "pcabiplot"] as const)(
    "%s: no datasets-keyed Series list — only the note saying what to click",
    (kind) => {
      const d = setup(distTable, kind, { kind: "plot" });
      expect(d.container.querySelectorAll(".serieslist-row"), `${kind}: a datasets-keyed Series list is drawn, though it styles nothing on this kind`).toHaveLength(0);
      const series = [...d.container.querySelectorAll(".inspsec")].find((s) => (s.querySelector("summary")?.textContent ?? "").trim() === "Series");
      if (series) {
        expect(series.querySelectorAll("input[type=checkbox], input[type=color]"), `${kind}: the Series section offers controls, though they style nothing on this kind`).toHaveLength(0);
        expect((series.textContent ?? ""), `${kind}: the Series section says something other than what to click`).toMatch(/Click .+ on the graph to style it/);
      }
    },
  );

  it("lollipop (real datasets-keyed series) still shows the Series section", () => {
    const d = setup(distTable, "lollipop", { kind: "plot" });
    expect(sectionTitles(d.container)).toContain("Series");
  });

  /**
   * Selecting the dendrogram tree line must not show a mis-seeded swatch (`seriesColor(0)`),
   * because `dendro-N` is not a table dataset.
   *
   * A branch of the real figure emits `{kind:"series", columnId:"dendro-0", part:"line"}`, the
   * editor opens, and styling that id changes the drawing — so the selection is reachable, and
   * `synthetic-swatch.test.tsx` checks it shows the correct colour for all five kinds plus ROC.
   * What stays here is the half this file owns: no inert list to select a phantom series from.
   */
  it("dendrogram offers no phantom 'dendro' row to select from", () => {
    const d = setup(distTable, "dendrogram", { kind: "plot" });
    expect(d.container.querySelectorAll(".serieslist-row")).toHaveLength(0);
  });

  // ROC draws one curve per plot.roc entry (keyed roc-i), not the source table columns —
  // so the Series list must list the curves, whose show/hide the builder reads.
  it("ROC: the Series list lists the curves (labels), not the source table columns", () => {
    const d = setup(distTable, "roc", { kind: "plot" }, {
      roc: [
        { label: "Marker A", auc: 0.82, points: [{ fpr: 0, tpr: 0 }, { fpr: 1, tpr: 1 }] },
        { label: "Marker B", auc: 0.7, points: [{ fpr: 0, tpr: 0 }, { fpr: 1, tpr: 1 }] },
      ],
    });
    const rows = [...d.container.querySelectorAll(".serieslist-row")].map((r) => (r.textContent ?? "").trim());
    expect(rows).toHaveLength(2); // one row per curve
    expect(rows[0]).toContain("Marker A");
    expect(rows[1]).toContain("Marker B");
    expect(rows.join(" ")).not.toContain("Control"); // not the source table columns
  });
});

// Axis-less kinds (corrmatrix / radar / scatter3d) render their labels with a font role
// (tick / axisTitle) whose control lives only in AxisPanel — which these kinds never show.
// Each needs its own FontControls in its panel.
describe("Inspector — label font controls for axis-less kinds", () => {
  // Fire the Size input that follows a FontControls heading; assert the plot-font write.
  const editFontSize = (container: HTMLElement, heading: string, size: number): void => {
    const nodes = [...container.querySelectorAll(".inspsub, input, select")];
    const hPos = nodes.findIndex((e) => e.classList.contains("inspsub") && e.textContent === heading);
    expect(hPos).toBeGreaterThanOrEqual(0);
    const sizeInput = nodes.slice(hPos + 1).find((el) => el.tagName === "INPUT" && (el as HTMLInputElement).type === "number") as HTMLInputElement;
    fireEvent.change(sizeInput, { target: { value: String(size) } });
  };

  /**
   * Same shape as the radar case below. The builder draws these labels at
   * `labelFont?.size ?? min(fonts.tick.size, 12)`, so a write into `fonts.tick` above 12 would
   * change nothing on the figure (set it to 20, labels stay 12). The control writes
   * `corrmatrix.labelFont`, the field with no cap, and this checks the builder reads it rather
   * than just that something was called.
   */
  it("corrmatrix exposes a 'Label font' control that reaches the drawing (not the capped tick font)", () => {
    const d = setup(distTable, "corrmatrix", { kind: "plot" });
    editFontSize(d.container, "Label font", 20);
    const patch = d.onSetPlotOptions.mock.calls.at(-1)?.[0] as { corrmatrix?: { labelFont?: { size?: number } } } | undefined;
    expect(patch?.corrmatrix?.labelFont?.size, "the label font control did not write corrmatrix.labelFont").toBe(20);
    const scene = buildPlotScene(distTable, { id: "p", name: "C", source: distTable.id, status: "ok", styleOverrides: {}, kind: "corrmatrix", corrmatrix: { labelFont: { size: 20 } } } as Plot, { width: 620, height: 420 });
    expect(scene.corrmatrix!.labelSize, "the builder ignores corrmatrix.labelFont.size").toBe(20);
  });

  /**
   * The radar's labels have their own font (`radar.labelFont`, with `radar.ringFont` for the
   * numbers), and `fonts.tick` remains the fallback.
   *
   * This guards that a radar's labels have a reachable font control, and checks the drawing as
   * well as the write.
   */
  it("radar exposes an edge-label font control that reaches the drawing", () => {
    const d = setup(distTable, "radar", { kind: "plot" });
    editFontSize(d.container, "Edge label font", 18);
    const patch = d.onSetPlotOptions.mock.calls.at(-1)?.[0] as { radar?: { labelFont?: { size?: number } } } | undefined;
    expect(patch?.radar?.labelFont?.size, "the edge-label font control wrote nothing the radar reads").toBe(18);
    // …and the builder reads it. (`radar-web.test.tsx` takes this the rest of the way, to the
    // rendered <text>; here it is enough that the write is not into a field nobody consumes.)
    const scene = buildPlotScene(distTable, { id: "p", name: "R", source: distTable.id, status: "ok", styleOverrides: {}, kind: "radar", radar: { labelFont: { size: 18 } } } as Plot, { width: 620, height: 420 });
    expect(scene.radar!.labelFont!.size).toBe(18);
  });

  it("radar's ring value labels have their own font, separate from the edge labels", () => {
    const d = setup(distTable, "radar", { kind: "plot" });
    editFontSize(d.container, "Ring value font", 9);
    const patch = d.onSetPlotOptions.mock.calls.at(-1)?.[0] as { radar?: { ringFont?: { size?: number } } } | undefined;
    expect(patch?.radar?.ringFont?.size).toBe(9);
  });

  it("scatter3d exposes an axis-title font control that writes fonts.axisTitle", () => {
    const d = setup(xyzTable, "scatter3d", { kind: "plot" });
    editFontSize(d.container, "Axis title font", 22);
    expect(d.onSetPlotFont).toHaveBeenCalledWith("axisTitle", { size: 22 });
  });

  it("alluvial exposes a node-label font control that writes fonts.tick", () => {
    const d = setup(distTable, "alluvial", { kind: "plot" });
    editFontSize(d.container, "Node label font", 15);
    expect(d.onSetPlotFont).toHaveBeenCalledWith("tick", { size: 15 });
  });

  // These two axis-less kinds render tick-font labels and have no AxisPanel, so they need a
  // tick-font control of their own.
  /**
   * The builder reads `treemap.labelSize ?? fonts.tick.size`, so a Size that wrote `fonts.tick`
   * would go dead as soon as the "Label size" row above it was touched (two controls for one
   * text, one always losing). The font block's Size writes `treemap.labelSize` (the winning
   * field); family/weight/colour go to the shared tick font, which is what draws them.
   */
  it("treemap exposes a cell-label font control whose size writes the field the builder reads", () => {
    const d = setup(distTable, "treemap", { kind: "plot" });
    editFontSize(d.container, "Cell label font", 19);
    const patch = d.onSetPlotOptions.mock.calls.at(-1)?.[0] as { treemap?: { labelSize?: number } } | undefined;
    expect(patch?.treemap?.labelSize, "the cell-label Size did not write treemap.labelSize").toBe(19);
  });

  /**
   * Parallel draws two kinds of text on its axes with two different fonts: the variable name
   * (fonts.axisTitle) and the tick values (fonts.tick). Both need a control or half the axis is
   * unstyleable, so both are guarded.
   */
  it("parallel exposes a tick-value font control that writes fonts.tick", () => {
    const d = setup(distTable, "parallel", { kind: "plot" });
    editFontSize(d.container, "Tick value font", 17);
    expect(d.onSetPlotFont).toHaveBeenCalledWith("tick", { size: 17 });
  });

  it("parallel exposes a variable-name font control that writes fonts.axisTitle", () => {
    const d = setup(distTable, "parallel", { kind: "plot" });
    editFontSize(d.container, "Variable name font", 21);
    expect(d.onSetPlotFont).toHaveBeenCalledWith("axisTitle", { size: 21 });
  });
});

// Survival draws one KM curve per plot.survival entry (keyed surv-i), not the source
// table columns — so the series panel must resolve its list + colour from those curves
// (looking surv-i up among tableDatasets would find nothing → seriesColor(0) + wrong name).
describe("Inspector — survival series panel is curve-keyed", () => {
  it("lists the KM curves (distinct labels), not the source table columns", () => {
    const d = setup(distTable, "survival", { kind: "series", columnId: "surv-0", part: "line" }, {
      survival: [
        { label: "Arm A", times: [0, 1, 2], surv: [1, 0.6, 0.3] },
        { label: "Arm B", times: [0, 1, 2], surv: [1, 0.4, 0.2] },
      ],
    });
    const rows = [...d.container.querySelectorAll(".serieslist-row")].map((r) => (r.textContent ?? "").trim());
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("Arm A"); // the KM curves
    expect(rows[1]).toContain("Arm B");
    expect(rows.join(" ")).not.toContain("Control"); // not the source columns (distTable: Control/Treated)
  });
});

// Bland-Altman draws one "Difference" series keyed by the 2nd method column; listing the
// two method columns (whose defaults don't match, and where only one maps to the series)
// is misleading. The list must collapse to a single "Difference" entry.
describe("Inspector — Bland-Altman single Difference series", () => {
  it("lists one 'Difference' entry, not the two method columns", () => {
    const d = setup(distTable, "blandaltman", { kind: "plot" });
    const rows = [...d.container.querySelectorAll(".serieslist-row")].map((r) => (r.textContent ?? "").trim());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain("Difference");
    expect(rows.join(" ")).not.toContain("Treated"); // not the source method columns
  });
});

// A parts-of-whole pie draws one slice per row keyed by row.id. The slice editor must
// resolve the clicked slice's name + default colour from that row, not datasets[0]
// (which would give every slice the value-column name + seriesColor(0)).
describe("Inspector — pie slice editor is row-keyed (parts-of-whole)", () => {
  const pieTable: DataTable = {
    id: "t", kind: "partsofwhole", name: "P",
    columns: [{ id: "cat", name: "Category" }, { id: "val", name: "Sample 1" }],
    rows: [
      { id: "rA", cells: { cat: "Alpha", val: 3 } },
      { id: "rB", cells: { cat: "Beta", val: 5 } },
      { id: "rC", cells: { cat: "Gamma", val: 2 } },
    ],
  };

  it("resolves the slice name + default colour from the clicked row, not datasets[0]", () => {
    const dA = setup(pieTable, "pie", { kind: "pie-slice", datasetId: "rA" });
    expect(dA.container.textContent).toContain("Alpha"); // the row's label, not "Sample 1"
    const colorA = fieldByLabel(dA.container, "Colour").value;
    const dB = setup(pieTable, "pie", { kind: "pie-slice", datasetId: "rB" });
    expect(dB.container.textContent).toContain("Beta");
    const colorB = fieldByLabel(dB.container, "Colour").value;
    expect(colorA).not.toBe(colorB); // per-row palette colour, not a constant datasets[0] colour
  });

  it("a slice colour edit writes seriesStyles under the row id (the key the builder reads)", () => {
    const d = setup(pieTable, "pie", { kind: "pie-slice", datasetId: "rB" });
    fireEvent.change(fieldByLabel(d.container, "Colour"), { target: { value: "#123456" } });
    expect(d.onSetSeriesStyle).toHaveBeenCalledWith("rB", { color: "#123456" });
  });

  it("the Data rail tab selects the first slice's row id, not the value-column id", () => {
    const d = setup(pieTable, "pie", { kind: "plot" });
    const dataTab = [...d.container.querySelectorAll('button[role="tab"]')].find((b) => (b.textContent ?? "").trim() === "Data");
    expect(dataTab).toBeTruthy();
    fireEvent.click(dataTab!);
    expect(d.onSelect).toHaveBeenCalledWith({ kind: "pie-slice", datasetId: "rA" });
  });
});

// ── border colour pickers reflect the theme background, not a hardcoded white ──
// A pie slice's / treemap cell's unstyled border renders as var(--bg); the picker
// default must resolve that CSS var so it isn't misleading on a dark theme.
describe("Inspector — border colour pickers resolve the theme background", () => {
  const powTable: DataTable = {
    id: "t", kind: "partsofwhole", name: "P",
    columns: [{ id: "cat", name: "Category" }, { id: "val", name: "Sample 1" }],
    rows: [
      { id: "rA", cells: { cat: "Alpha", val: 3 } },
      { id: "rB", cells: { cat: "Beta", val: 5 } },
    ],
  };
  afterEach(() => document.documentElement.style.removeProperty("--bg"));

  it("a pie slice's Border default shows the resolved --bg (dark), not #ffffff", () => {
    document.documentElement.style.setProperty("--bg", "#14171c");
    const d = setup(powTable, "pie", { kind: "pie-slice", datasetId: "rA" });
    expect(fieldByLabel(d.container, "Border").value).toBe("#14171c");
  });

  it("the Border default falls back to #ffffff when --bg is unset / non-hex", () => {
    document.documentElement.style.removeProperty("--bg");
    const d = setup(powTable, "pie", { kind: "pie-slice", datasetId: "rA" });
    expect(fieldByLabel(d.container, "Border").value).toBe("#ffffff");
  });

  it("a treemap cell exposes a per-cell Border + width and writes them under the cell id", () => {
    const d = setup(powTable, "treemap", { kind: "treemap-cell", cellId: "rA" });
    expect(fieldLabels(d.container)).toEqual(expect.arrayContaining(["Border", "Border width"]));
    fireEvent.change(fieldByLabel(d.container, "Border"), { target: { value: "#00ff00" } });
    expect(d.onSetSeriesStyle).toHaveBeenCalledWith("rA", { sliceStroke: "#00ff00" });
    fireEvent.change(fieldByLabel(d.container, "Border width"), { target: { value: "3" } });
    expect(d.onSetSeriesStyle).toHaveBeenCalledWith("rA", { sliceStrokeWidth: 3 });
  });
});

// Clicking a corrmatrix glyph opens a per-cell colour editor that overrides the r→colour
// scale for just that cell.
describe("Inspector — corrmatrix per-cell colour editor", () => {
  const cmTable: DataTable = {
    id: "t", kind: "multivariable", name: "M",
    columns: [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }],
    rows: [
      { id: "r0", cells: { a: 1, b: 2, c: 3 } },
      { id: "r1", cells: { a: 4, b: 5, c: 6 } },
    ],
  };
  it("a cell colour edit writes plot.corrmatrix.cellColors under the row:col key", () => {
    const d = setup(cmTable, "corrmatrix", { kind: "corr-cell", row: 1, col: 0 });
    fireEvent.change(fieldByLabel(d.container, "Cell colour"), { target: { value: "#abcdef" } });
    expect(d.onSetPlotOptions).toHaveBeenCalledWith({ corrmatrix: { cellColors: { "1:0": "#abcdef" } } });
  });
  it("Reset clears just this cell's override", () => {
    const d = setup(cmTable, "corrmatrix", { kind: "corr-cell", row: 1, col: 0 }, { corrmatrix: { cellColors: { "1:0": "#abcdef" } } });
    const reset = [...d.container.querySelectorAll("button.swbtn")].find((b) => (b.textContent ?? "").trim() === "Reset")!;
    fireEvent.click(reset);
    expect(d.onSetPlotOptions).toHaveBeenCalledWith({ corrmatrix: { cellColors: undefined } });
  });
});

// ── beforeafter ──────────────────────────────────────────────────────────────
describe("Inspector — before-after paired editor", () => {
  it("shows markers + line but not error bars, and hides the per-point toggle", () => {
    const d = setup(distTable, "beforeafter", { kind: "series", columnId: "r1", rowId: "r1" });
    const groups = groupHeadings(d.container);
    expect(groups).toContain("Data points"); // markers
    expect(groups).toContain("Line"); // connector
    expect(groups).not.toContain("Error bars");
    expect(d.container.textContent).toContain("Apply to whole graph");
    expect(d.container.textContent).not.toContain("Apply to whole series");
  });

  it("routes an edit to the selected subject's series style", () => {
    const d = setup(distTable, "beforeafter", { kind: "series", columnId: "r1", rowId: "r1" });
    fireEvent.change(fieldByLabel(d.container, "Thickness"), { target: { value: "3" } });
    expect(d.onSetPointStyle).not.toHaveBeenCalled();
    expect(d.onSetSeriesStyle).toHaveBeenCalledWith("r1", expect.objectContaining({ lineWidth: 3 }));
  });
});

// ── area ─────────────────────────────────────────────────────────────────────
const areaTable: DataTable = {
  id: "ta", kind: "xy", name: "A",
  columns: [{ id: "x", name: "X" }, { id: "y", name: "Y" }],
  rows: [
    { id: "r1", cells: { x: 1, y: 2 } },
    { id: "r2", cells: { x: 2, y: 5 } },
    { id: "r3", cells: { x: 3, y: 3 } },
  ],
};

describe("Inspector — area baseline + fill suite", () => {
  it("overlaid area shows a Fill baseline control that routes to areaBaseline", () => {
    const d = setup(areaTable, "area", { kind: "plot" });
    expect(fieldLabels(d.container)).toContain("Fill baseline");
    fireEvent.change(fieldByLabel(d.container, "Fill baseline"), { target: { value: "-5" } });
    expect(d.onSetPlotOptions).toHaveBeenCalledWith({ areaBaseline: -5 });
  });

  it("area fill Style offers two-tone + pattern (not just solid/gradient)", () => {
    const d = setup(areaTable, "area", { kind: "series", columnId: "y" });
    const styleSel = fieldByLabel(d.container, "Style") as unknown as HTMLSelectElement;
    const opts = [...styleSel.options].map((o) => o.value);
    expect(opts).toEqual(expect.arrayContaining(["solid", "twotone", "pattern", "gradient"]));
  });
});

// ── lollipop ─────────────────────────────────────────────────────────────────
describe("Inspector — lollipop stem controls", () => {
  it("exposes Stem width + Stem colour that route to plot.lollipop", () => {
    const d = setup(distTable, "lollipop", { kind: "plot" });
    const labels = fieldLabels(d.container);
    expect(labels).toContain("Stem width");
    expect(labels).toContain("Stem colour");
    fireEvent.change(fieldByLabel(d.container, "Stem width"), { target: { value: "4" } });
    expect(d.onSetPlotOptions.mock.calls.some((c) => c[0]?.lollipop?.stemWidth === 4)).toBe(true);
  });
});

// ── survival ─────────────────────────────────────────────────────────────────
describe("Inspector — survival section", () => {
  it("shows CI + censor toggles that route to plot options", () => {
    const d = setup(areaTable, "survival", { kind: "plot" });
    expect(d.container.textContent).toContain("Survival (Kaplan-Meier)");
    const labels = fieldLabels(d.container);
    expect(labels).toContain("Confidence band");
    expect(labels).toContain("Censor ticks");
    fireEvent.click(fieldByLabel(d.container, "Confidence band"));
    expect(d.onSetPlotOptions).toHaveBeenCalledWith({ survivalShowCI: false });
  });
});

// ── radar ────────────────────────────────────────────────────────────────────
describe("Inspector — radar chart section", () => {
  it("renders the Radar chart section with grid/spoke/scale/vertex controls", () => {
    const d = setup(distTable, "radar", { kind: "plot" });
    expect(d.container.textContent).toContain("Radar chart");
    const labels = fieldLabels(d.container);
    for (const l of ["Scale max", "Rings", "Grid colour", "Grid width", "Spoke colour", "Spoke width", "Vertex dots", "Dot size"]) {
      expect(labels).toContain(l);
    }
  });

  it("editing ring count / grid width routes to plot.radar", () => {
    const d = setup(distTable, "radar", { kind: "plot" });
    fireEvent.change(fieldByLabel(d.container, "Rings"), { target: { value: "6" } });
    expect(d.onSetPlotOptions.mock.calls.some((c) => c[0]?.radar?.ringCount === 6)).toBe(true);
    fireEvent.change(fieldByLabel(d.container, "Grid width"), { target: { value: "2" } });
    expect(d.onSetPlotOptions.mock.calls.some((c) => c[0]?.radar?.gridWidth === 2)).toBe(true);
  });
});

// ── lollipop stem line ─────────────────────────────────────────────────────────
// The stem line is edited next to the dots (the Data-points panel), with an
// enable/override toggle. The "Match line colour" checkbox is not offered there: a
// lollipop has no connecting line, so it would do nothing.
describe("Inspector — lollipop stem line editing", () => {
  const lollipopTable: DataTable = {
    id: "lt", kind: "column", name: "Q",
    columns: [{ id: "x", name: "Metric" }, { id: "v", name: "Score" }],
    rows: [{ id: "r0", cells: { x: "Q1", v: 20 } }, { id: "r1", cells: { x: "Q2", v: 35 } }],
  };
  const dsId = tableDatasets(lollipopTable)[0]!.id;
  const sel: GraphSelection = { kind: "series", columnId: dsId, part: "points", rowId: "r0" };

  it("shows a Stem line section with a 'Link colour to data' toggle + Stem width, not 'Match line colour'", () => {
    const { container } = setup(lollipopTable, "lollipop", sel);
    const labels = fieldLabels(container);
    expect(labels).toContain("Link colour to data"); // link toggle
    expect(labels).toContain("Stem width");
    expect(labels).not.toContain("Match line colour"); // a lollipop has no connecting line to match
    expect(container.textContent).toContain("Stem line");
  });

  it("unlinked (default) shows a Stem colour picker; linked hides it", () => {
    const unlinked = setup(lollipopTable, "lollipop", sel);
    expect(fieldLabels(unlinked.container)).toContain("Stem colour"); // palette/picker shown
    const linked = setup(lollipopTable, "lollipop", sel, { lollipop: { stemLinkColor: true } });
    expect(fieldLabels(linked.container)).not.toContain("Stem colour"); // follows data → hidden
  });

  it("still shows 'Match line colour' on an xy chart (points have a real connecting line)", () => {
    const { container } = setup(lollipopTable, "xy", { kind: "series", columnId: dsId, part: "points" });
    expect(fieldLabels(container)).toContain("Match line colour");
  });

  it("toggling 'Link colour to data' on writes stemLinkColor:true; editing the picker writes stemColor", () => {
    const d = setup(lollipopTable, "lollipop", sel);
    const toggle = fieldByLabel(d.container, "Link colour to data");
    expect(toggle.checked).toBe(false); // unlinked by default
    fireEvent.click(toggle);
    expect(d.onSetPlotOptions.mock.calls.some((c) => c[0]?.lollipop?.stemLinkColor === true)).toBe(true);
    // while unlinked, the stem colour picker sets an independent colour
    fireEvent.input(fieldByLabel(d.container, "Stem colour"), { target: { value: "#ff0000" } });
    expect(d.onSetPlotOptions.mock.calls.some((c) => c[0]?.lollipop?.stemColor === "#ff0000")).toBe(true);
  });

  it("shows a Δ% colour control when Δ% labels are on; editing it writes deltaColor", () => {
    const on = setup(lollipopTable, "lollipop", { kind: "plot" }, { lollipop: { showDelta: true } });
    expect(fieldLabels(on.container)).toContain("Δ% colour");
    fireEvent.input(fieldByLabel(on.container, "Δ% colour"), { target: { value: "#ff0000" } });
    expect(on.onSetPlotOptions.mock.calls.some((c) => c[0]?.lollipop?.deltaColor === "#ff0000")).toBe(true);
    // hidden when Δ% labels are off
    const off = setup(lollipopTable, "lollipop", { kind: "plot" }, { lollipop: { showDelta: false } });
    expect(fieldLabels(off.container)).not.toContain("Δ% colour");
  });

  it("editing Stem width routes to plot.lollipop.stemWidth", () => {
    const d = setup(lollipopTable, "lollipop", sel);
    fireEvent.change(fieldByLabel(d.container, "Stem width"), { target: { value: "4" } });
    expect(d.onSetPlotOptions.mock.calls.some((c) => c[0]?.lollipop?.stemWidth === 4)).toBe(true);
  });

  it("a two-tone marker exposes a 'Custom edge colour' toggle that routes twoToneEdge (edge editable for any fill)", () => {
    const d = setup(lollipopTable, "lollipop", sel, { seriesStyles: { [dsId]: { symbolFill: "twotone" } } });
    expect(fieldLabels(d.container)).toContain("Custom edge colour");
    fireEvent.click(fieldByLabel(d.container, "Custom edge colour"));
    // routes a custom edge colour through the series (default) or per-point style
    const routed =
      d.onSetSeriesStyle.mock.calls.some((c) => typeof c[1]?.twoToneEdge === "string") ||
      d.onSetPointStyle.mock.calls.some((c) => typeof c[2]?.twoToneEdge === "string");
    expect(routed).toBe(true);
  });

  it("no 'Custom edge colour' toggle for a solid-fill marker (only appears on two-tone)", () => {
    const d = setup(lollipopTable, "lollipop", sel, { seriesStyles: { [dsId]: { symbolFill: "solid" } } });
    expect(fieldLabels(d.container)).not.toContain("Custom edge colour");
  });
});

// ── Arrange (multi-object) toolbar ─────────────────────────────────────────────
describe("Inspector — Arrange objects panel", () => {
  const xyTable: DataTable = {
    id: "t", kind: "xy", name: "T",
    columns: [{ id: "x", name: "X" }, { id: "y", name: "Y" }],
    rows: [{ id: "r1", cells: { x: 1, y: 2 } }],
  };
  const anns: Annotation[] = [
    { id: "a1", kind: "rect", x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
    { id: "a2", kind: "rect", x: 0.6, y: 0.5, w: 0.2, h: 0.2 },
    { id: "a3", kind: "text", label: "hi", x: 0.4, y: 0.4 },
  ];
  const rowOf = (c: HTMLElement, label: string): HTMLElement =>
    [...c.querySelectorAll<HTMLElement>(".frow")].find((r) => r.querySelector("span")?.textContent === label)!;

  it("renders Align/Distribute/Equal-size rows and dispatches ops.align with the ids", () => {
    const d = setup(xyTable, "xy", { kind: "annotations", ids: ["a1", "a2", "a3"] }, { annotations: anns });
    expect(fieldLabels(d.container)).toEqual(expect.arrayContaining(["Align", "Distribute", "Equal size"]));
    fireEvent.click(rowOf(d.container, "Align").querySelector("button")!); // first = align left
    expect(d.annotationOps.align).toHaveBeenCalledWith(["a1", "a2", "a3"], "left");
    // Distribute-horizontal (first button of the Distribute row).
    fireEvent.click(rowOf(d.container, "Distribute").querySelector("button")!);
    expect(d.annotationOps.align).toHaveBeenLastCalledWith(["a1", "a2", "a3"], "distribute-h");
  });

  it("gates by arrangeable count: Distribute needs ≥3, Equal-size needs ≥2 boxes", () => {
    // 2 objects, only one of them a box (rect a1 + text a3).
    const d = setup(xyTable, "xy", { kind: "annotations", ids: ["a1", "a3"] }, { annotations: anns });
    const disabled = (label: string) => [...rowOf(d.container, label).querySelectorAll("button")].every((b) => (b as HTMLButtonElement).disabled);
    expect(disabled("Align")).toBe(false); // 2 arrangeable → align enabled
    expect(disabled("Distribute")).toBe(true); // needs 3
    expect(disabled("Equal size")).toBe(true); // needs 2 boxes, only 1
  });
});
