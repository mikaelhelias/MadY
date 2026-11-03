// @vitest-environment jsdom
/**
 * The Treemap section on a sheet that is not Parts of whole: "One cell per" chooses Value column (the default) or
 * Row; with Row it names the label and value columns, and the group / icon controls that only one cell per row can
 * use appear. A Parts of whole sheet, always one cell per row, has no such choice.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { DataTable, Plot } from "@mady/core";
import { Inspector } from "./Inspector";

afterEach(cleanup);
afterEach(() => globalThis.localStorage?.clear());

const hierarchy: DataTable = {
  id: "t", kind: "multivariable", name: "Budget",
  columns: [{ id: "d", name: "Division", role: "x" }, { id: "m", name: "Team", role: "x" }, { id: "b", name: "Budget", role: "y" }, { id: "s", name: "Staff", role: "y" }],
  rows: [{ id: "r1", cells: { d: "Research", m: "Cell lab", b: 820, s: 14 } }, { id: "r2", cells: { d: "Admin", m: "Payroll", b: 240, s: 5 } }],
};

function setup(table: DataTable, treemap?: Plot["treemap"]) {
  const plot: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "treemap", ...(treemap ? { treemap } : {}) };
  const h = {
    onSelect: vi.fn(), onSetAxis: vi.fn(), onSetAxisLength: vi.fn(), onSetAxisTitleFont: vi.fn(),
    onSetSeriesStyle: vi.fn(), onSetSeriesStyleAll: vi.fn(), onSetPointStyle: vi.fn(), onClearPointStyles: vi.fn(),
    onSetGrid: vi.fn(), onSetFrame: vi.fn(), onSetKind: vi.fn(), onSetBarLayout: vi.fn(), onSetBarShape: vi.fn(), onSetBoxWhisker: vi.fn(),
    onSetPlotOptions: vi.fn(), onSetGraphTitle: vi.fn(), onSetPlotFont: vi.fn(), onHomogenizeFont: vi.fn(),
    onSetLegend: vi.fn(), onSetSignificance: vi.fn(), onApplyPreset: vi.fn(),
    onApplyUserPreset: vi.fn(), onSaveUserPreset: vi.fn(), onDeleteUserPreset: vi.fn(), onSetProfileDefault: vi.fn(),
    annotationOps: { add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() },
  };
  const { container } = render(<Inspector activeSection="graphs" selection={{ kind: "plot" }} plot={plot} table={table} userPresets={[]} profileDefault={null} {...h} />);
  const sec = [...container.querySelectorAll(".inspsec")].find((s) => (s.querySelector("summary")?.textContent ?? "").trim().startsWith("Treemap"))!;
  const row = (label: string) => [...sec.querySelectorAll(".frow")].find((f) => f.querySelector("span")?.textContent === label) ?? null;
  return { ...h, row, sel: (label: string) => row(label)?.querySelector("select") ?? null };
}

describe("Treemap › One cell per", () => {
  it("on a hierarchy sheet: offered at Value column, with no row-only controls", () => {
    const { sel, row } = setup(hierarchy);
    expect(sel("One cell per")!.value).toBe("column");
    for (const label of ["Label column", "Value column", "Colour by group", "Cell icon"]) expect(row(label), label).toBeNull();
  });

  it("choosing Row writes it", () => {
    const { sel, onSetPlotOptions } = setup(hierarchy);
    fireEvent.change(sel("One cell per")!, { target: { value: "row" } });
    expect(onSetPlotOptions).toHaveBeenLastCalledWith({ treemap: { cellsPer: "row" } });
  });

  it("with Row: the label column names its Auto choice, and the value, group and icon controls are offered", () => {
    const { sel, row, onSetPlotOptions } = setup(hierarchy, { cellsPer: "row" });
    expect(sel("Label column")!.options[0]!.text).toBe("Auto (Team)");
    for (const label of ["Value column", "Colour by group", "Cell icon"]) expect(row(label), label).not.toBeNull();
    fireEvent.change(sel("Value column")!, { target: { value: "s" } });
    expect(onSetPlotOptions).toHaveBeenLastCalledWith({ treemap: { cellsPer: "row", valueColumn: "s" } });
  });

  it("on a Parts of whole sheet: no choice, and the group control is offered", () => {
    const pow = { ...hierarchy, kind: "partsofwhole" } as DataTable;
    const { row } = setup(pow);
    expect(row("One cell per")).toBeNull();
    expect(row("Label column")).toBeNull();
    expect(row("Colour by group")).not.toBeNull();
  });
});
