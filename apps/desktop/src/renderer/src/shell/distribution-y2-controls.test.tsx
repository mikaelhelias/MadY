// @vitest-environment jsdom
// A second Y axis on box, violin and column scatter charts — the controls.
//
// Placed where every other kind already has them: the Axis tab's Y2 button with its
// "Series on this axis" tickboxes, and the per-series "Plot on" row in the "Value axis" group the
// XY family uses. Only the axes the drawing has are offered — Y2, never Y3 — and nothing at all
// on the horizontal versions, whose value axis runs along X.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { DataTable, Plot, SeriesStyle } from "@mady/core";
import { Inspector, rightValueAxes } from "./Inspector";
import type { GraphSelection } from "./AppShell";

afterEach(cleanup);
afterEach(() => globalThis.localStorage?.clear());

const T: DataTable = {
  id: "t", kind: "column", name: "T",
  columns: [
    { id: "w", name: "Weight (g)", role: "y" },
    { id: "h", name: "Height (cm)", role: "y" },
  ],
  rows: [2, 4, 6, 8, 10].map((w, i) => ({ id: `r${i}`, cells: { w, h: 150 + i * 10 } })),
} as unknown as DataTable;
const XY: DataTable = {
  id: "t", kind: "xy", name: "T",
  columns: [{ id: "x", name: "X", role: "x" }, { id: "y", name: "Y", role: "y" }],
  rows: [{ id: "r1", cells: { x: 1, y: 2 } }, { id: "r2", cells: { x: 2, y: 3 } }],
} as unknown as DataTable;
const plotOf = (kind: string, over: Partial<Plot> = {}): Plot =>
  ({ id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind, ...over }) as unknown as Plot;

function inspector(plot: Plot, selection: GraphSelection, table: DataTable = T) {
  const written: [string, SeriesStyle][] = [];
  const h = {
    onSelect: vi.fn(),
    onSetAxis: vi.fn(), onSetAxisLength: vi.fn(), onSetAxisTitleFont: vi.fn(),
    onSetSeriesStyle: (id: string, d: SeriesStyle) => written.push([id, d]),
    onSetSeriesStyleAll: (ids: string[], d: SeriesStyle) => ids.forEach((id) => written.push([id, d])),
    onSetPointStyle: vi.fn(), onClearPointStyles: vi.fn(),
    onSetGrid: vi.fn(), onSetFrame: vi.fn(), onSetKind: vi.fn(), onSetBarLayout: vi.fn(), onSetBarShape: vi.fn(), onSetBoxWhisker: vi.fn(),
    onSetPlotOptions: vi.fn(), onSetGraphTitle: vi.fn(), onSetPlotFont: vi.fn(), onHomogenizeFont: vi.fn(),
    onSetLegend: vi.fn(), onSetSignificance: vi.fn(), onApplyPreset: vi.fn(),
    onApplyUserPreset: vi.fn(), onSaveUserPreset: vi.fn(), onDeleteUserPreset: vi.fn(), onSetProfileDefault: vi.fn(),
    annotationOps: { add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() },
  };
  const { container } = render(
    <Inspector activeSection="graphs" selection={selection} plot={plot} table={table} userPresets={[]} profileDefault={null}
      wholeGraph={false} onSetWholeGraph={() => {}} {...h} />,
  );
  const rowSelect = (label: string): HTMLSelectElement | undefined =>
    [...container.querySelectorAll("label")]
      .find((l) => (l.querySelector("span:first-child")?.textContent ?? "").trim() === label)
      ?.querySelector("select") ?? undefined;
  const switchButtons = (): string[] => {
    const row = [...container.querySelectorAll<HTMLElement>("div.frow")]
      .find((r) => (r.querySelector(":scope > span")?.textContent ?? "").trim() === "Axis");
    return row ? [...row.querySelectorAll("button")].map((b) => (b.textContent ?? "").trim()) : [];
  };
  return { container, written, rowSelect, switchButtons };
}
const seriesSel = (columnId: string): GraphSelection => ({ kind: "series", columnId, part: "points" }) as unknown as GraphSelection;

describe("rightValueAxes — box, violin and column scatter", () => {
  it.each(["box", "violin", "scatter"])("vertical %s: Y2 only", (kind) => {
    expect(rightValueAxes({ kind: kind as Plot["kind"] })).toEqual(["y2"]);
  });
  // A horizontal chart draws its second axis along the top.
  it.each(["box", "violin", "scatter"])("horizontal %s: the second axis too (drawn along the top)", (kind) => {
    expect(rightValueAxes({ kind: kind as Plot["kind"], barOrientation: "horizontal" })).toEqual(["y2"]);
  });
  // Raincloud and floating bar draw a Y2 axis in both orientations.
  it.each(["raincloud", "floatingbar"])("%s: Y2 only, in either orientation", (kind) => {
    expect(rightValueAxes({ kind: kind as Plot["kind"] })).toEqual(["y2"]);
    expect(rightValueAxes({ kind: kind as Plot["kind"], barOrientation: "horizontal" })).toEqual(["y2"]);
  });
});

describe.each(["box", "violin", "scatter"])("%s chart — the second-axis controls", (kind) => {
  it("Axis tab: a Y2 button (no Y3) and a tickbox per series", () => {
    const { container, switchButtons } = inspector(plotOf(kind), { kind: "axis", axis: "y" });
    expect(switchButtons()).toContain("Y2");
    expect(switchButtons()).not.toContain("Y3");
    expect(container.querySelectorAll(".seriesaxis-row")).toHaveLength(2);
  });

  it("series panel: a \"Plot on\" row offering Left (Y) and Right (Y2) only — choosing Y2 writes axis:y2", () => {
    const { rowSelect, written } = inspector(plotOf(kind), seriesSel("h"));
    const sel = rowSelect("Plot on");
    expect(sel, `no "Plot on" row on the ${kind} series panel`).toBeDefined();
    expect([...sel!.options].map((o) => o.textContent)).toEqual(["Left (Y)", "Right (Y2)"]);
    fireEvent.change(sel!, { target: { value: "y2" } });
    expect(written.some(([, d]) => d.axis === "y2")).toBe(true);
  });

  // On a horizontal chart the second axis runs along the top, so the row reads
  // Bottom (X) / Top (X2) and the button X2 — never "Y2".
  it("horizontal: a \"Plot on\" row reading Bottom (X) / Top (X2), and an X2 button on the value axis", () => {
    const horizontal = plotOf(kind, { barOrientation: "horizontal" });
    const { rowSelect, written } = inspector(horizontal, seriesSel("h"));
    const sel = rowSelect("Plot on");
    expect(sel, `no "Plot on" row on a horizontal ${kind} series panel`).toBeDefined();
    expect([...sel!.options].map((o) => o.textContent)).toEqual(["Bottom (X)", "Top (X2)"]);
    fireEvent.change(sel!, { target: { value: "y2" } });
    expect(written.some(([, d]) => d.axis === "y2")).toBe(true);
    cleanup();
    const buttons = inspector(horizontal, { kind: "axis", axis: "x" }).switchButtons();
    expect(buttons).toContain("X2");
    expect(buttons).not.toContain("Y2");
  });
});

describe("the other kinds keep what they had", () => {
  it("XY: \"Plot on\" still offers Y, Y2 and Y3", () => {
    const sel = inspector(plotOf("xy"), seriesSel("y"), XY).rowSelect("Plot on");
    expect([...sel!.options].map((o) => o.value)).toEqual(["y", "y2", "y3"]);
  });
  it("bar: no \"Plot on\" row — its second axis stays the \"Value axis\" row under Plot as", () => {
    const { rowSelect } = inspector(plotOf("bar", { showBarPoints: true }), seriesSel("h"));
    expect(rowSelect("Plot on")).toBeUndefined();
    expect(rowSelect("Value axis")).toBeDefined();
  });
});
