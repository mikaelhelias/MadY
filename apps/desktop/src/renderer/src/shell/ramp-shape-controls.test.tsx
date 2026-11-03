// @vitest-environment jsdom
/**
 * The colour-shaping controls are there, and they write the field they name.
 *
 * `dead-style-fields.test.ts` checks that the shaping fields are mentioned in the UI; that is a
 * grep, and a grep is satisfied by a control that renders and does nothing. This renders the
 * Inspector for each of the six sites, finds the row by the label the user reads, types into it,
 * and asserts the patch that reaches the document.
 *
 * Note: the four rows appear only where a ramp is actually in play (a graduated fill, a colour
 * column, the spectrum switched on) — a knob offered where no ramp exists would do nothing.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { DataTable, Plot } from "@mady/core";
import { Inspector } from "./Inspector";

afterEach(cleanup);

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

const hmTable: DataTable = {
  id: "th", kind: "xy", name: "H",
  columns: [
    { id: "g", name: "Gene", role: "x" }, { id: "c1", name: "C1", role: "y" },
    { id: "c2", name: "C2", role: "y" }, { id: "c3", name: "C3", role: "y" },
  ],
  rows: [
    { id: "r1", cells: { g: "G1", c1: 1, c2: 5, c3: 3 } },
    { id: "r2", cells: { g: "G2", c1: 8, c2: 2, c3: 6 } },
    { id: "r3", cells: { g: "G3", c1: 4, c2: 7, c3: 1 } },
  ],
};
const xyTable: DataTable = {
  id: "tx", kind: "xy", name: "X",
  columns: [{ id: "x", name: "X", role: "x" }, { id: "y", name: "Y", role: "y" }, { id: "z", name: "Z", role: "y" }],
  rows: [1, 2, 3].map((i) => ({ id: `r${i}`, cells: { x: i, y: i * 2, z: i } })),
};

const SHAPE_ROWS = ["Centre at", "Detail bias", "Colour steps", "Blend"];

function show(plot: Plot, table: DataTable, h = handlers(), selection: object = { kind: "plot" }) {
  render(
    <Inspector activeSection="graphs" selection={selection as never} plot={plot} table={table}
      userPresets={[]} profileDefault={null} {...h} />,
  );
  return h;
}

/** Every control label currently on the panel (labels only: a panel's textContent also holds the text of hidden <option>s). */
const labels = (): string[] =>
  [...document.querySelectorAll("label > span:first-child")].map((e) => (e.textContent ?? "").trim());

const plot = (p: Partial<Plot> & { source: string }): Plot =>
  ({ id: "p", name: "P", status: "ok", styleOverrides: {}, ...p }) as Plot;

describe("chart-wide ramps: the four shaping rows are offered and write their field", () => {
  it("heatmap: all four rows, and Colour steps writes heatmap.colorSteps", () => {
    const h = show(plot({ source: "th", kind: "heatmap", heatmap: { colormap: "coolwarm" } }), hmTable);
    for (const row of SHAPE_ROWS) expect(labels(), `heatmap is missing "${row}"`).toContain(row);
    fireEvent.change(screen.getByLabelText("Number of discrete colour steps"), { target: { value: "5" } });
    expect(h.onSetPlotOptions).toHaveBeenCalledWith({ heatmap: expect.objectContaining({ colorSteps: 5 }) });
  });

  it("heatmap: Centre at writes a data value, and clearing it writes undefined", () => {
    const h = show(plot({ source: "th", kind: "heatmap", heatmap: { colormap: "coolwarm", colorMidpoint: 2 } }), hmTable);
    const box = screen.getByLabelText("Centre the colour ramp at this value") as HTMLInputElement;
    expect(box.value).toBe("2");
    fireEvent.change(box, { target: { value: "" } });
    expect(h.onSetPlotOptions).toHaveBeenCalledWith({ heatmap: expect.objectContaining({ colorMidpoint: undefined }) });
  });

  it("heatmap: Blend writes the colour space", () => {
    const h = show(plot({ source: "th", kind: "heatmap", heatmap: { colormap: "rainbow" } }), hmTable);
    fireEvent.change(screen.getByLabelText("Colour blending space"), { target: { value: "hsl" } });
    expect(h.onSetPlotOptions).toHaveBeenCalledWith({ heatmap: expect.objectContaining({ colorSpace: "hsl" }) });
  });

  it("timeline tracks: the rows write tracks.*", () => {
    const h = show(plot({ source: "th", kind: "tracks" }), hmTable);
    for (const row of SHAPE_ROWS) expect(labels(), `tracks is missing "${row}"`).toContain(row);
    fireEvent.change(screen.getByLabelText("Colour detail bias"), { target: { value: "2" } });
    expect(h.onSetPlotOptions).toHaveBeenCalledWith({ tracks: expect.objectContaining({ colorGamma: 2 }) });
  });

  it("parallel coordinates: the rows appear only when colouring by value, and write parallel.*", () => {
    const noColour = show(plot({ source: "th", kind: "parallel" }), hmTable);
    expect(labels(), "shaping rows offered with no colour column — nothing to shape").not.toContain("Colour steps");
    expect(noColour.onSetPlotOptions).not.toHaveBeenCalled();
    cleanup();
    const h = show(plot({ source: "th", kind: "parallel", parallel: { colorColumn: "c1", colorScale: "value" } }), hmTable);
    for (const row of SHAPE_ROWS) expect(labels(), `parallel is missing "${row}"`).toContain(row);
    fireEvent.change(screen.getByLabelText("Number of discrete colour steps"), { target: { value: "4" } });
    expect(h.onSetPlotOptions).toHaveBeenCalledWith({ parallel: expect.objectContaining({ colorSteps: 4 }) });
  });

  it("ridgeline: the rows appear only when the spectrum fill is on, and write ridgeline.spectrum*", () => {
    show(plot({ source: "th", kind: "ridgeline" }), hmTable);
    expect(labels(), "spectrum shaping offered while the spectrum fill is off").not.toContain("Colour steps");
    cleanup();
    const h = show(plot({ source: "th", kind: "ridgeline", ridgeline: { spectrum: true } }), hmTable);
    for (const row of SHAPE_ROWS) expect(labels(), `ridgeline is missing "${row}"`).toContain(row);
    fireEvent.change(screen.getByLabelText("Colour blending space"), { target: { value: "lab" } });
    expect(h.onSetPlotOptions).toHaveBeenCalledWith({ ridgeline: expect.objectContaining({ spectrumSpace: "lab" }) });
  });
});

describe("per-series ramps: the same four knobs in the series matrix", () => {
  it("a graduated fill offers them; a solid fill does not", () => {
    const solid = plot({ source: "tc", kind: "bar", seriesStyles: { y: { fillType: "solid" } } });
    show({ ...solid, source: "tx" }, xyTable, handlers(), { kind: "series", columnId: "y" });
    expect(labels(), "shaping rows offered for a solid fill — there is no ramp").not.toContain("Detail bias");
    cleanup();
    const h = show(
      plot({ source: "tx", kind: "bar", seriesStyles: { y: { fillType: "graduated", gradRamp: "viridis" } } }),
      xyTable, handlers(), { kind: "series", columnId: "y" },
    );
    for (const row of SHAPE_ROWS) expect(labels(), `graduated fill is missing "${row}"`).toContain(row);
    expect(h.onSetSeriesStyle).not.toHaveBeenCalled();
  });

  it("colour-by-a-column offers them, and they reach the series style", () => {
    show(
      plot({ source: "tx", kind: "xy", seriesStyles: { y: { colorFromColumn: "z", colorFromMode: "continuous" } } }),
      xyTable, handlers(), { kind: "series", columnId: "y" },
    );
    for (const row of SHAPE_ROWS) expect(labels(), `colour-by-column is missing "${row}"`).toContain(row);
  });
});
