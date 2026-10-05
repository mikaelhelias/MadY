// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { DataTable, Plot } from "@mady/core";
import { Inspector } from "./Inspector";

afterEach(cleanup);
afterEach(() => globalThis.localStorage?.clear());

/**
 * A drawn value label must be restyleable.
 *
 * `fonts.valueLabel` is honoured by the builder; guards against its control living only inside
 * the pyramid block, which would leave bar, histogram, lollipop, xy, area, bubble and volcano
 * drawing value labels with no way to change their font.
 *
 * Both halves are asserted. The control must appear when labels are drawn and must not appear
 * when they are not: a font control for text that is not on the page would do nothing, and
 * showing it everywhere is the easy way to pass the first half wrongly.
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
  columns: [{ id: "c", name: "Group", role: "x" }, { id: "a", name: "Baseline", role: "y" }],
  rows: [{ id: "r1", cells: { c: "Alpha", a: 5 } }, { id: "r2", cells: { c: "Beta", a: 9 } }],
};
const xyTable: DataTable = {
  id: "tx", kind: "xy", name: "X",
  columns: [{ id: "x", name: "X", role: "x" }, { id: "y", name: "Y", role: "y" }],
  rows: [{ id: "r1", cells: { x: 1, y: 2 } }, { id: "r2", cells: { x: 2, y: 5 } }],
};

function offersValueLabelFont(table: DataTable, plot: Partial<Plot>): boolean {
  const full: Plot = { id: "p", name: "P", source: table.id, status: "ok", styleOverrides: {}, ...plot } as Plot;
  const { container } = render(
    <Inspector activeSection="graphs" selection={{ kind: "plot" }} plot={full} table={table} userPresets={[]} profileDefault={null} {...handlers()} />,
  );
  return /Value label font/i.test(container.textContent ?? "");
}

describe("value-label font control follows the drawn label", () => {
  it("guards the guard — the Inspector really rendered", () => {
    const { container } = render(
      <Inspector activeSection="graphs" selection={{ kind: "plot" }} plot={{ id: "p", name: "P", source: "tc", status: "ok", styleOverrides: {}, kind: "bar" } as Plot} table={catTable} userPresets={[]} profileDefault={null} {...handlers()} />,
    );
    // If this is ever 0 the assertions below are vacuous, not passing.
    expect(container.querySelectorAll(".frow, .inspsec, button, select, input").length).toBeGreaterThan(10);
    expect(/Legend font/i.test(container.textContent ?? ""), "the Title & legend section must be rendered").toBe(true);
  });

  it("bar with values ON offers the font", () => {
    expect(offersValueLabelFont(catTable, { kind: "bar", showValues: true })).toBe(true);
  });

  it("bar with values OFF does not", () => {
    expect(offersValueLabelFont(catTable, { kind: "bar", showValues: false })).toBe(false);
  });

  it("xy with per-series point labels ON offers the font", () => {
    expect(offersValueLabelFont(xyTable, { kind: "xy", seriesStyles: { y: { pointLabels: "y" } } })).toBe(true);
  });

  it("xy with point labels set to none does not", () => {
    expect(offersValueLabelFont(xyTable, { kind: "xy", seriesStyles: { y: { pointLabels: "none" } } })).toBe(false);
  });
});
