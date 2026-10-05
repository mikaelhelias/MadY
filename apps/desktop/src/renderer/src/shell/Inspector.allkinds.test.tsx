// @vitest-environment jsdom
// The Inspector must render for every plot kind in KINDS below and every selection
// facet (plot panel · series/point editor · line editor · a per-cell/slice editor
// where the kind has one) without throwing, and must always produce controls.
//
// Guards against a field-gating change (noErrorBars / showSeriesList / forest Type / etc.)
// silently breaking a kind's Inspector. Each render mounts the real Inspector + SchemaForm.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { DataTable, Plot, PlotKind } from "@mady/core";
import { tableDatasets } from "@mady/core";
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

// ---- shared tables ---------------------------------------------------------
const catTable: DataTable = {
  id: "tc", kind: "column", name: "C",
  columns: [{ id: "c", name: "Group", role: "x" }, { id: "a", name: "Baseline", role: "y" }, { id: "b", name: "Treated", role: "y" }],
  rows: [
    { id: "r1", cells: { c: "Alpha", a: 5, b: 8 } },
    { id: "r2", cells: { c: "Beta", a: 9, b: 4 } },
    { id: "r3", cells: { c: "Gamma", a: 6, b: 7 } },
  ],
};
const xyTable: DataTable = {
  id: "tx", kind: "xy", name: "X",
  columns: [{ id: "x", name: "X", role: "x" }, { id: "y", name: "Y", role: "y" }, { id: "z", name: "Z", role: "y" }],
  rows: [
    { id: "r1", cells: { x: 1, y: 2, z: 3 } },
    { id: "r2", cells: { x: 2, y: 5, z: 2 } },
    { id: "r3", cells: { x: 3, y: 4, z: 6 } },
  ],
};
const pieTable: DataTable = {
  id: "tp", kind: "partsofwhole", name: "P",
  columns: [{ id: "cat", name: "Category" }, { id: "val", name: "Sample 1" }],
  rows: [{ id: "rA", cells: { cat: "Alpha", val: 3 } }, { id: "rB", cells: { cat: "Beta", val: 5 } }],
};
const pcaGraph = {
  varLabels: ["V1", "V2", "V3"], pcLabels: ["PC1", "PC2", "PC3"],
  explained: [0.6, 0.25, 0.15], eigenvalues: [1.8, 0.75, 0.45],
  loadings: [[0.7, -0.2, 0.1], [0.5, 0.6, -0.3], [0.4, -0.1, 0.8]],
  scores: [[-1.5, 0.4, 0.1], [1.4, 0.5, -0.4]],
};

// one entry per covered plot kind (mirrors PlotFigure.matrix.test.tsx's FIX)
const KINDS: { kind: PlotKind; table: DataTable; extra?: Partial<Plot> }[] = [
  { kind: "xy", table: xyTable },
  { kind: "area", table: xyTable },
  { kind: "bar", table: catTable },
  { kind: "histogram", table: xyTable },
  { kind: "box", table: catTable },
  { kind: "violin", table: catTable },
  { kind: "scatter", table: catTable },
  { kind: "raincloud", table: catTable },
  { kind: "bubble", table: xyTable },
  { kind: "volcano", table: xyTable },
  { kind: "beforeafter", table: catTable },
  { kind: "pie", table: pieTable, extra: { pieLabels: "label" } },
  { kind: "treemap", table: pieTable },
  { kind: "heatmap", table: xyTable, extra: { heatmap: { mode: "matrix", showValues: true } } },
  { kind: "corrmatrix", table: xyTable },
  { kind: "alluvial", table: catTable },
  { kind: "radar", table: catTable },
  { kind: "parallel", table: catTable },
  { kind: "scatter3d", table: xyTable },
  { kind: "ridgeline", table: catTable },
  { kind: "lollipop", table: catTable },
  { kind: "paireddot", table: catTable },
  { kind: "network", table: catTable },
  { kind: "floatingbar", table: catTable },
  { kind: "estimation", table: catTable },
  { kind: "forest", table: catTable },
  { kind: "funnel", table: catTable },
  { kind: "venn", table: catTable },
  { kind: "blandaltman", table: catTable },
  { kind: "pyramid", table: catTable },
  { kind: "pcascore", table: xyTable, extra: { pca: pcaGraph } },
  { kind: "pcaload", table: xyTable, extra: { pca: pcaGraph } },
  { kind: "pcabiplot", table: xyTable, extra: { pca: pcaGraph } },
  { kind: "scree", table: xyTable, extra: { pca: pcaGraph } },
  { kind: "dendrogram", table: catTable },
  { kind: "survival", table: xyTable, extra: { survival: [{ label: "A", times: [0, 1, 2], surv: [1, 0.6, 0.3] }] } },
  { kind: "roc", table: xyTable, extra: { roc: [{ label: "T", points: [{ fpr: 0, tpr: 0 }, { fpr: 1, tpr: 1 }], auc: 0.8 }] } },
  { kind: "qq", table: xyTable },
  { kind: "manhattan", table: xyTable },
  { kind: "sunburst", table: catTable },
  { kind: "chord", table: catTable },
  { kind: "oncoprint", table: catTable },
];

function renderInspector(table: DataTable, kind: PlotKind, selection: GraphSelection, extra: Partial<Plot> = {}) {
  const plot: Plot = { id: "p", name: "P", source: table.id, status: "ok", styleOverrides: {}, kind, ...extra };
  return render(<Inspector activeSection="graphs" selection={selection} plot={plot} table={table} userPresets={[]} profileDefault={null} {...handlers()} />);
}
const controlCount = (c: HTMLElement): number => c.querySelectorAll(".frow, .inspsec, button, select, input").length;

describe("Inspector — renders for every kind + selection facet without throwing", () => {
  it.each(KINDS.map((k) => [k.kind, k] as const))("%s: plot panel renders with controls", (_kind, fx) => {
    const { container } = renderInspector(fx.table, fx.kind, { kind: "plot" }, fx.extra);
    expect(controlCount(container)).toBeGreaterThan(0);
  });

  it.each(KINDS.map((k) => [k.kind, k] as const))("%s: point + line series editors render without throwing", (_kind, fx) => {
    const ds0 = tableDatasets(fx.table)[0]?.id ?? fx.table.columns[0]!.id;
    for (const part of ["points", "line"] as const) {
      const { container } = renderInspector(fx.table, fx.kind, { kind: "series", columnId: ds0, part }, fx.extra);
      expect(controlCount(container)).toBeGreaterThan(0);
      cleanup();
    }
  });

  it("pie: the pie-slice editor renders for a row-keyed slice", () => {
    const { container } = renderInspector(pieTable, "pie", { kind: "pie-slice", datasetId: "rB" }, { pieLabels: "label" });
    expect(container.textContent).toContain("Beta"); // resolves the clicked row's label
  });
});
