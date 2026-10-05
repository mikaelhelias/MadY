// @vitest-environment jsdom
// A second Y axis on a bar chart — the Axis tab half.
//
// The vertical bar builder draws a right-hand Y2 for any series with `axis: "y2"` (the
// "Bars + line" gallery card is built on it), and the Series tab's "Value axis" row writes it.
// The Axis tab offers the rest: a Y2 button and the "Series on this axis" tickboxes, so on a bar
// the second axis is not only reachable series by series.
//
// Y3 stays off on bars: the bar builder draws one right axis. A horizontal bar draws its second
// axis along the top (its value axis runs along X), offered as X2.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { buildPlotScene } from "@mady/graphics";
import type { AxisSpec, DataTable, Plot, SeriesStyle } from "@mady/core";
import { Inspector, rightValueAxes } from "./Inspector";
import type { GraphSelection } from "./AppShell";

afterEach(cleanup);
afterEach(() => globalThis.localStorage?.clear());

const SIZE = { width: 640, height: 460 };
const t3: DataTable = {
  id: "t3", kind: "column", name: "T3",
  columns: [
    { id: "g", name: "Group", role: "x" },
    { id: "bar", name: "Sales", role: "y" },
    { id: "line", name: "Trend", role: "y" },
  ],
  rows: [
    { id: "r1", cells: { g: "A", bar: 2, line: 300 } },
    { id: "r2", cells: { g: "B", bar: 6, line: 500 } },
    { id: "r3", cells: { g: "C", bar: 10, line: 400 } },
  ],
};
const barPlot = (over: Partial<Plot> = {}): Plot =>
  ({ id: "p", name: "P", source: "t3", status: "ok", styleOverrides: {}, kind: "bar", ...over }) as unknown as Plot;

type SetAxis = (axis: "x" | "y" | "y2" | "y3" | "z", patch: Partial<AxisSpec>) => void;
const handlers = (onSetSeriesStyle: (id: string, d: SeriesStyle) => void) => ({
  onSelect: vi.fn(),
  onSetAxis: vi.fn<SetAxis>(), onSetAxisLength: vi.fn(), onSetAxisTitleFont: vi.fn(),
  onSetSeriesStyle, onSetSeriesStyleAll: vi.fn(), onSetPointStyle: vi.fn(), onClearPointStyles: vi.fn(),
  onSetGrid: vi.fn(), onSetFrame: vi.fn(), onSetKind: vi.fn(), onSetBarLayout: vi.fn(), onSetBarShape: vi.fn(), onSetBoxWhisker: vi.fn(),
  onSetPlotOptions: vi.fn(), onSetGraphTitle: vi.fn(), onSetPlotFont: vi.fn(), onHomogenizeFont: vi.fn(),
  onSetLegend: vi.fn(), onSetSignificance: vi.fn(), onApplyPreset: vi.fn(),
  onApplyUserPreset: vi.fn(), onSaveUserPreset: vi.fn(), onDeleteUserPreset: vi.fn(), onSetProfileDefault: vi.fn(),
  annotationOps: { add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() },
});

function axisTab(plot: Plot, axis: "x" | "y" | "y2" | "y3", table: DataTable = t3) {
  const onSetSeriesStyle = vi.fn<(id: string, d: SeriesStyle) => void>();
  const selection: GraphSelection = { kind: "axis", axis };
  const { container } = render(
    <Inspector activeSection="graphs" selection={selection} plot={plot} table={table} userPresets={[]} profileDefault={null} {...handlers(onSetSeriesStyle)} />,
  );
  const switchButtons = (): string[] => {
    const row = [...container.querySelectorAll<HTMLElement>("div.frow")]
      .find((r) => (r.querySelector(":scope > span")?.textContent ?? "").trim() === "Axis");
    return row ? [...row.querySelectorAll("button")].map((b) => (b.textContent ?? "").trim()) : [];
  };
  const scaleTypeRow = (): Element | undefined =>
    [...(container.querySelector("#inspsub-scale")?.querySelectorAll("label.frow") ?? [])]
      .find((r) => (r.querySelector(":scope > span")?.textContent ?? "").trim() === "Type");
  return { container, onSetSeriesStyle, switchButtons, scaleTypeRow };
}

describe("rightValueAxes — which right-hand value axes the Axis tab offers", () => {
  it("XY-family kinds keep Y2 and Y3", () => {
    for (const kind of ["xy", "area", "bubble", "volcano"] as const) {
      expect(rightValueAxes({ kind }), kind).toEqual(["y2", "y3"]);
    }
  });
  /**
   * A histogram is not in the Y2+Y3 list above: it is drawn by the bar builder, which refuses
   * Y3 with a warning, so a Y3 button would have exactly one outcome — the refusal.
   * `right-axes-drawn.test.tsx` asks the drawing directly, in both directions, rather than
   * repeating the list being guarded.
   */
  it("a histogram gets Y2 only — the bar builder draws one right axis and refuses Y3 with a warning", () => {
    expect(rightValueAxes({ kind: "histogram" })).toEqual(["y2"]);
  });
  it("a vertical bar gets Y2 only — its builder draws one right axis", () => {
    expect(rightValueAxes({ kind: "bar" })).toEqual(["y2"]);
    expect(rightValueAxes({ kind: "bar", barOrientation: "vertical" })).toEqual(["y2"]);
  });
  // A horizontal bar's second axis is drawn along the top (its value axis runs left to right).
  it("a horizontal bar gets the second axis too — drawn along its top", () => {
    expect(rightValueAxes({ kind: "bar", barOrientation: "horizontal" })).toEqual(["y2"]);
  });
  // box · violin · scatter have a second axis (distribution-y2-controls.test.tsx covers them).
  it("kinds whose drawing has no second value axis get none", () => {
    // raincloud · floating bar · lollipop have a second axis too, so they are not listed here.
    for (const kind of ["survival", "pie", "paireddot", "forest"] as const) {
      expect(rightValueAxes({ kind }), kind).toEqual([]);
    }
  });
});

describe("bar chart — the Axis tab offers the second Y axis", () => {
  it("vertical bar, Y axis: a Y2 button (no Y3) and the Series on this axis tickboxes", () => {
    const { container, switchButtons } = axisTab(barPlot(), "y");
    expect(switchButtons()).toContain("Y2");
    expect(switchButtons()).not.toContain("Y3");
    expect(container.querySelectorAll(".seriesaxis-row")).toHaveLength(2);
  });

  // A horizontal bar's second axis runs along the top, so the button reads X2 (the values run
  // along X there), never "Y2".
  it("horizontal bar: the bottom (value) axis offers an X2 button and the tickboxes; the category axis no tickboxes", () => {
    const value = axisTab(barPlot({ barOrientation: "horizontal" }), "x");
    expect(value.switchButtons()).toContain("X2");
    expect(value.switchButtons()).not.toContain("Y2");
    expect(value.container.querySelectorAll(".seriesaxis-row")).toHaveLength(2);
    cleanup();
    const cats = axisTab(barPlot({ barOrientation: "horizontal" }), "y");
    expect(cats.container.querySelectorAll(".seriesaxis-row")).toHaveLength(0);
  });

  it("ticking a series on Y2 writes axis:y2 — and that draws a right axis the series is scaled to", () => {
    const { container, onSetSeriesStyle } = axisTab(barPlot(), "y2");
    const row = [...container.querySelectorAll(".seriesaxis-row")].find((r) => r.textContent?.includes("Trend"))!;
    fireEvent.click(row.querySelector("input[type=checkbox]")!);
    expect(onSetSeriesStyle).toHaveBeenCalledWith("line", { axis: "y2" });

    const before = buildPlotScene(t3, barPlot(), SIZE);
    const after = buildPlotScene(t3, barPlot({ seriesStyles: { line: { axis: "y2" } } }), SIZE);
    expect(before.y2).toBeUndefined();
    expect(after.y2).toBeDefined();
    // the Sales bars are no longer squashed under a 0–500 axis: their tops move
    const top = (s: typeof before) => s.series.find((x) => x.id === "bar")!.marks.map((m) => Math.round(m.bar!.y));
    expect(top(after)).not.toEqual(top(before));
  });

  it("Y2 on a bar has no Scale Type row (the bar's right axis is drawn linear); XY's Y2 keeps it", () => {
    expect(axisTab(barPlot({ seriesStyles: { line: { axis: "y2" } } }), "y2").scaleTypeRow()).toBeUndefined();
    cleanup();
    const xyTable: DataTable = {
      id: "t", kind: "xy", name: "T",
      columns: [{ id: "x", name: "X", role: "x" }, { id: "y", name: "Y", role: "y" }],
      rows: [{ id: "r1", cells: { x: 1, y: 2 } }, { id: "r2", cells: { x: 2, y: 3 } }],
    } as unknown as DataTable;
    const xy = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "xy", seriesStyles: { y: { axis: "y2" } } } as unknown as Plot;
    expect(axisTab(xy, "y2", xyTable).scaleTypeRow()).toBeDefined();
  });
});
