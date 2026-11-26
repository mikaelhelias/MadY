// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { DataTable, Plot, PlotKind } from "@mady/core";
import { Inspector } from "./Inspector";

afterEach(cleanup);
afterEach(() => globalThis.localStorage?.clear());

/**
 * The axis Spacing controls must exist on both axis panels.
 *
 * The axis inspector has two branches: a continuous one and, behind an early `if (bandX)
 * return`, a category one. The "Spacing" sub-section — gap between tick labels and the axis,
 * and between the axis title and the labels — has to be rendered in both. The builder
 * honours `tickLabelGap` / `titleGap` on every axis, so on the five kinds whose X actually
 * bands (bar, box, violin, scatter, before-after) a Spacing section missing from the category
 * branch would leave a working setting that nothing can reach.
 *
 * `categoryGroupsSection` has the mirror requirement: it belongs in the category branch, since
 * the continuous branch ignores category groups. Anything defined inside one branch can end up
 * missing from the other.
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

const catTable: DataTable = {
  id: "tc", kind: "column", name: "C",
  columns: [{ id: "c", name: "Group", role: "x" }, { id: "a", name: "Baseline", role: "y" }, { id: "b", name: "Treated", role: "y" }],
  rows: [
    { id: "r1", cells: { c: "Alpha", a: 5, b: 8 } },
    { id: "r2", cells: { c: "Beta", a: 9, b: 4 } },
  ],
};
const xyTable: DataTable = {
  id: "tx", kind: "xy", name: "X",
  columns: [{ id: "x", name: "X", role: "x" }, { id: "y", name: "Y", role: "y" }],
  rows: [{ id: "r1", cells: { x: 1, y: 2 } }, { id: "r2", cells: { x: 2, y: 5 } }],
};

/** Does the X-axis panel for this kind expose the two spacing inputs? */
function xAxisPanel(kind: PlotKind, table: DataTable): HTMLElement {
  const plot = { id: "p", name: "P", source: table.id, status: "ok", styleOverrides: {}, kind } as Plot;
  const { container } = render(
    <Inspector activeSection="graphs" selection={{ kind: "axis", axis: "x" }} plot={plot} table={table}
      userPresets={[]} profileDefault={null} {...handlers()} />,
  );
  return container;
}

/** The five kinds whose X axis bands — the category branch. */
const BAND_KINDS: PlotKind[] = ["bar", "box", "violin", "scatter", "beforeafter"];

describe("axis Spacing controls exist on the category branch too", () => {
  it("guards the guard — the continuous branch really has them", () => {
    const c = xAxisPanel("xy", xyTable);
    expect(/Labels ↔ axis/.test(c.textContent ?? ""), "continuous X panel lost its Spacing section").toBe(true);
    expect(/Title ↔ labels/.test(c.textContent ?? "")).toBe(true);
  });

  for (const kind of BAND_KINDS) {
    it(`${kind}: the category X panel offers both spacing gaps`, () => {
      const c = xAxisPanel(kind, catTable);
      // Confirm we are really on the category branch, not silently on the continuous one.
      expect(/axis \(categories\)/i.test(c.textContent ?? ""), `${kind} did not render the category axis panel`).toBe(true);
      expect(
        /Labels ↔ axis/.test(c.textContent ?? ""),
        `${kind}: the builder honours xAxis.tickLabelGap but the category axis panel offers no control for it`,
      ).toBe(true);
      expect(
        /Title ↔ labels/.test(c.textContent ?? ""),
        `${kind}: the builder honours xAxis.titleGap but the category axis panel offers no control for it`,
      ).toBe(true);
    });
  }
});
