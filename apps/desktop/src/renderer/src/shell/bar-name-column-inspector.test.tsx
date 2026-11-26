// @vitest-environment jsdom
/**
 * The Series list names the series the chart draws. A bar chart draws no series for a column of names (`barDatasets`), so
 * the list must not offer one — a row whose every control changes nothing — and the colour a series is seeded with must be
 * the one the chart draws it in, which counts only the drawn series.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene, seriesColor } from "@mady/graphics";
import { Inspector } from "./Inspector";

afterEach(cleanup);

const table = {
  id: "t", kind: "xy", name: "Plate",
  columns: [{ id: "w", name: "Well" }, { id: "s", name: "Sample" }, { id: "od", name: "OD450" }],
  rows: ["Blank", "Std1", "Std2", "Ctrl"].map((n, i) => ({ id: `r${i}`, cells: { w: `A${i + 1}`, s: n, od: 0.2 + i * 0.3 } })),
} as unknown as DataTable;
const plot = { id: "p", name: "Plate", source: "t", status: "ok", styleOverrides: {}, kind: "bar" } as unknown as Plot;

const handlers = {
  onSelect: vi.fn(),
  onSetAxis: vi.fn(), onSetAxisLength: vi.fn(), onSetAxisTitleFont: vi.fn(),
  onSetSeriesStyle: vi.fn(), onSetSeriesStyleAll: vi.fn(), onSetPointStyle: vi.fn(), onClearPointStyles: vi.fn(),
  onSetGrid: vi.fn(), onSetFrame: vi.fn(), onSetKind: vi.fn(), onSetBarLayout: vi.fn(), onSetBarShape: vi.fn(), onSetBoxWhisker: vi.fn(),
  onSetPlotOptions: vi.fn(), onSetGraphTitle: vi.fn(), onSetPlotFont: vi.fn(), onHomogenizeFont: vi.fn(),
  onSetLegend: vi.fn(), onSetSignificance: vi.fn(), onApplyPreset: vi.fn(),
  onApplyUserPreset: vi.fn(), onSaveUserPreset: vi.fn(), onDeleteUserPreset: vi.fn(), onSetProfileDefault: vi.fn(),
  annotationOps: { add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() },
};
const panel = (selection: object) =>
  render(
    <Inspector activeSection="graphs" selection={selection as never} plot={plot} table={table as never}
      userPresets={[]} profileDefault={null} wholeGraph={false} onSetWholeGraph={() => {}} {...handlers} />,
  ).container;

describe("the Series list of a bar chart", () => {
  it("lists the series the chart draws and not the column of names", () => {
    const drawn = buildPlotScene(table, plot, { width: 640, height: 440 }).series.map((s) => s.name);
    expect(drawn).toEqual(["OD450"]);
    const text = panel({ kind: "plot" }).textContent ?? "";
    expect(text).toContain("OD450");
    expect(text, "the column of names is offered as a series").not.toContain("Sample");
  });

  it("a selected series is seeded with the colour the chart draws it in (the first of the palette)", () => {
    const drawn = buildPlotScene(table, plot, { width: 640, height: 440 }).series[0]!.color;
    expect(drawn).toBe(seriesColor(0));
    const c = panel({ kind: "series", columnId: "od" });
    const swatches = [...c.querySelectorAll("input[type=color]")].map((i) => (i as HTMLInputElement).value.toLowerCase());
    expect(swatches, "the colour control shows another colour than the one drawn").toContain(drawn.toLowerCase());
  });
});
