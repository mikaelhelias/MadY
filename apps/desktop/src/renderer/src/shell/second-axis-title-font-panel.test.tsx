// @vitest-environment jsdom
// The Axis tab's Y2 / Y3 title-font block edits that axis's own font (each of Y2 / Y3 has its own title
// font). Guards against a block that shows the second axis's own title font but writes the main Y axis's,
// so enlarging the Y2 title would enlarge the Y title too, and the box could show a size nothing is drawn at.
//
// Each block shows the font its title is drawn with — the axis's own title font over the main Y title font over
// the chart-wide one — and writes that axis. On a horizontal chart the second axis runs along the top and the panel
// calls it X2, so the block does too.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { buildPlotScene } from "@mady/graphics";
import type { DataTable, Plot } from "@mady/core";
import { Inspector } from "./Inspector";
import type { GraphSelection } from "./AppShell";

afterEach(cleanup);
afterEach(() => globalThis.localStorage?.clear());

const xyTable: DataTable = {
  id: "t", kind: "xy", name: "T",
  columns: [{ id: "x", name: "X" }, { id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }],
  rows: [[1, 10, 1000, 0.1], [2, 20, 2000, 0.2], [3, 30, 3000, 0.3]].map(([x, a, b, c], i) => ({ id: `r${i}`, cells: { x: x!, a: a!, b: b!, c: c! } })),
};
const barTable: DataTable = {
  id: "t", kind: "column", name: "T",
  columns: [{ id: "g", name: "Group", role: "x" }, { id: "bar", name: "Sales", role: "y" }, { id: "line", name: "Trend", role: "y" }],
  rows: [{ id: "r1", cells: { g: "A", bar: 2, line: 300 } }, { id: "r2", cells: { g: "B", bar: 6, line: 500 } }, { id: "r3", cells: { g: "C", bar: 10, line: 400 } }],
};

function panel(plot: Plot, table: DataTable, axis: "x" | "y" | "y2" | "y3") {
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
  const selection: GraphSelection = { kind: "axis", axis };
  const { container } = render(
    <Inspector activeSection="graphs" selection={selection} plot={plot} table={table} userPresets={[]} profileDefault={null} {...h} />,
  );
  return { container, ...h };
}

/** The Size box and Bold tick of the font block headed `label` (null when the block is absent). */
function fontRows(c: HTMLElement, label: string) {
  const head = [...c.querySelectorAll(".inspsub")].find((e) => e.textContent === label);
  if (!head) return null;
  const rows: Element[] = [];
  for (let e = head.nextElementSibling; e && !e.classList.contains("inspsub"); e = e.nextElementSibling) rows.push(e);
  const row = (name: string) => rows.find((r) => r.matches("label.frow") && r.querySelector(":scope > span")?.textContent === name);
  return {
    size: row("Size")?.querySelector("input") as HTMLInputElement,
    bold: row("Style")?.querySelector('input[type="checkbox"]') as HTMLInputElement,
  };
}

const plotOf = (over: Partial<Plot>): Plot => ({ id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "xy", ...over }) as Plot;
// The chart-wide title size (a house style's 22), a main Y title font of its own (26), and a second axis that sets
// only Bold — so the box must show 26 inherited from the main Y, not 22 and not the grey built-in 15.
const XY = plotOf({
  seriesStyles: { b: { axis: "y2" }, c: { axis: "y3" } },
  fonts: { axisTitle: { size: 22 } },
  yAxis: { title: "Alpha", titleFont: { size: 26 } },
  y2Axis: { title: "Beta", titleFont: { bold: true } },
  y3Axis: { title: "Gamma", titleFont: { size: 31 } },
});

describe("Axis tab — the Y2 / Y3 / X2 title-font block shows and edits that axis's own title font", () => {
  it("Y2: shows the size its title is drawn at (inherited from the main Y), and Bold writes Y2 — not Y", () => {
    const scene = buildPlotScene(xyTable, XY, { width: 720, height: 380 });
    expect(scene.fonts.yAxisTitle.size, "the fixture's main Y title is not at its own size").toBe(26);
    const d = panel(XY, xyTable, "y2");
    const r = fontRows(d.container, "Y2-axis title font");
    expect(r, "no Y2-axis title font block").not.toBeNull();
    expect(r!.size.value, "the box does not show the size the Y2 title is drawn at").toBe("26");
    expect(r!.bold.checked, "Y2's own Bold is not shown").toBe(true);
    fireEvent.click(r!.bold);
    expect(d.onSetAxisTitleFont, "the Y2 block wrote another axis").toHaveBeenLastCalledWith("y2", { bold: undefined });
  });

  it("Y3: shows its own size, and a size typed there writes Y3", () => {
    const d = panel(XY, xyTable, "y3");
    const r = fontRows(d.container, "Y3-axis title font");
    expect(r, "no Y3-axis title font block").not.toBeNull();
    expect(r!.size.value).toBe("31");
    fireEvent.change(r!.size, { target: { value: "40" } });
    expect(d.onSetAxisTitleFont, "the Y3 block wrote another axis").toHaveBeenLastCalledWith("y3", { size: 40 });
  });

  it("the main Y block is unchanged: shows its own size, writes Y", () => {
    const d = panel(XY, xyTable, "y");
    const r = fontRows(d.container, "Y-axis title font")!;
    expect(r.size.value).toBe("26");
    fireEvent.click(r.bold);
    expect(d.onSetAxisTitleFont).toHaveBeenLastCalledWith("y", { bold: true });
  });

  it("horizontal bar: the TOP second axis's block is named X2, shows the chart-wide size, and writes Y2's font", () => {
    const plot = plotOf({ kind: "bar", barOrientation: "horizontal", seriesStyles: { line: { plotAs: "line", axis: "y2" } }, fonts: { axisTitle: { size: 22 } }, y2Axis: { title: "Trend units" } });
    const d = panel(plot, barTable, "y2");
    expect(fontRows(d.container, "Y2-axis title font"), "the top axis's block is still called Y2 under an \"X2 axis (top)\" heading").toBeNull();
    const r = fontRows(d.container, "X2-axis title font");
    expect(r, "no X2-axis title font block").not.toBeNull();
    expect(r!.size.value).toBe("22");
    fireEvent.click(r!.bold);
    expect(d.onSetAxisTitleFont).toHaveBeenLastCalledWith("y2", { bold: true });
  });
});
