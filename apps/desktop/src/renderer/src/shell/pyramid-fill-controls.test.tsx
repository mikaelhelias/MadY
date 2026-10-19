// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { DataTable, Plot } from "@mady/core";
import { tableDatasets } from "@mady/core";
import { Inspector } from "./Inspector";

afterEach(cleanup);
afterEach(() => globalThis.localStorage?.clear());

/**
 * A population pyramid draws bars, so its series panel must offer the fill controls — not the
 * marker controls, which move nothing on it.
 *
 * Guards against `pyramid` falling through the kind chain to the "other point kinds" default
 * and getting `symbolFields`. Against the real builder, every one of shape / size / opacity /
 * symbol fill / symbol fill colour / outline / symbol border width leaves the drawing
 * untouched on this kind, while `fillColor`, `fillOpacity`, `fillType`, `borderWidth` and
 * `color` all move it.
 *
 * Note: asserted in both directions on purpose. Adding the fill controls while leaving the dead
 * marker ones would satisfy "the option has a control" and still leave the panel misleading.
 */
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

const table: DataTable = {
  id: "tp", kind: "column", name: "P",
  columns: [
    { id: "age", name: "Age band", role: "x" },
    { id: "m", name: "Male", role: "y" },
    { id: "f", name: "Female", role: "y" },
  ],
  rows: [
    { id: "r1", cells: { age: "0-9", m: 12, f: 11 } },
    { id: "r2", cells: { age: "10-19", m: 14, f: 13 } },
  ],
};

/**
 * The panel's control labels and group headings.
 *
 * Note: not `container.textContent`. That sweeps up the text of every hidden `<option>` too, so
 * it would match "Fill" from the marker Fill select and "Style" from somewhere invisible, and
 * pass even with the marker controls offered. Reading the labels is what makes the two field lists
 * distinguishable:
 *   fill controls   → ["Style","Fill","Opacity","Contour","Contour width","Type","▾Fill", …]
 *   marker controls → ["Shape","Size","Fill","Opacity","Colour","Outline width", "▾Data points", …]
 */
function seriesPanel(kind: Plot["kind"]): string[] {
  const plot = { id: "p", name: "P", source: "tp", status: "ok", styleOverrides: {}, kind } as Plot;
  const ds = tableDatasets(table)[0]!;
  const { container } = render(
    <Inspector activeSection="graphs" selection={{ kind: "series", columnId: ds.id, part: "points" }}
      plot={plot} table={table} userPresets={[]} profileDefault={null} {...handlers()} />,
  );
  return [...container.querySelectorAll("label > span:first-child, .inspsub, .insphd")]
    .map((e) => (e.textContent ?? "").trim())
    .filter(Boolean);
}

describe("pyramid series panel offers the controls that work", () => {
  it("guards the guard — the panel really rendered controls", () => {
    expect(seriesPanel("pyramid").length).toBeGreaterThan(4);
  });

  it("offers the Fill group (fillColor / fillOpacity / fillType all move a pyramid)", () => {
    const labels = seriesPanel("pyramid");
    expect(labels, "pyramid draws bars but its panel offers no fill controls").toContain("▾Fill");
    expect(labels, "the fillType row is the one that proves fillFields is rendered").toContain("Style");
    expect(labels).toContain("Contour");
  });

  it("does not offer the marker controls, which move nothing on a pyramid", () => {
    const labels = seriesPanel("pyramid");
    expect(labels, "pyramid offers a marker Shape control that changes nothing").not.toContain("Shape");
    expect(labels, "pyramid has no markers, so there is no Data points group to show").not.toContain("▾Data points");
  });

  it("a real marker kind still gets its Shape control (only kinds without markers lose it)", () => {
    expect(seriesPanel("xy")).toContain("Shape");
  });

  /**
   * The mirror case. A histogram draws both bars and individual data markers, so its panel must
   * offer controls for both. Against the real builder, symbol, symbolSize, symbolOpacity,
   * symbolFill and symbolBorderWidth all move a histogram, while `seriesStyles.lineWidth` there
   * moves nothing but the invisible clip boundary.
   */
  it("histogram draws markers, so it gets both the fill and the marker controls", () => {
    const labels = seriesPanel("histogram");
    expect(labels, "histogram bars need their fill controls").toContain("▾Fill");
    expect(labels, "histogram draws data markers but offered no control for them").toContain("Shape");
    expect(labels).toContain("Size");
  });
});
