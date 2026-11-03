// @vitest-environment jsdom
/**
 * The 3-D scatter section chooses the columns on X, Y and Z, beside the axis titles, the way the chord and network
 * sections choose their source and target columns. Auto names the column it stands for, and the title boxes name
 * the columns drawn.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { DataTable, Plot } from "@mady/core";
import { Inspector } from "./Inspector";

afterEach(cleanup);
afterEach(() => globalThis.localStorage?.clear());

const table: DataTable = {
  id: "t", kind: "multivariable", name: "Penguins",
  columns: [{ id: "n", name: "Bird" }, { id: "b", name: "Bill" }, { id: "f", name: "Flipper" }, { id: "m", name: "Mass" }],
  rows: [{ id: "r1", cells: { n: "P1", b: 39, f: 181, m: 3750 } }],
};

function setup(scatter3d?: Plot["scatter3d"]) {
  const plot: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "scatter3d", ...(scatter3d ? { scatter3d } : {}) };
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
  const sel = (label: string) => container.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`);
  const placeholder = (label: string) => [...container.querySelectorAll(".frow")].find((f) => f.querySelector("span")?.textContent === label)?.querySelector("input")?.placeholder;
  return { ...h, sel, placeholder };
}

describe("3-D scatter column pickers", () => {
  it("X, Y and Z column are offered; Auto names the first, second and third column", () => {
    const { sel } = setup();
    expect(sel("X column")!.options[0]!.text).toBe("Auto (Bird)");
    expect(sel("Y column")!.options[0]!.text).toBe("Auto (Bill)");
    expect(sel("Z column")!.options[0]!.text).toBe("Auto (Flipper)");
  });

  it("choosing a column writes it; Auto clears it", () => {
    const { sel, onSetPlotOptions } = setup({ xColumn: "b" });
    fireEvent.change(sel("Z column")!, { target: { value: "m" } });
    expect(onSetPlotOptions).toHaveBeenLastCalledWith({ scatter3d: { xColumn: "b", zColumn: "m" } });
    fireEvent.change(sel("X column")!, { target: { value: "" } });
    expect(onSetPlotOptions).toHaveBeenLastCalledWith({ scatter3d: { xColumn: undefined } });
  });

  it("the axis-title boxes name the columns drawn", () => {
    const { placeholder } = setup({ xColumn: "b", yColumn: "f", zColumn: "m" });
    expect([placeholder("X axis title"), placeholder("Y axis title"), placeholder("Z axis title")]).toEqual(["Bill", "Flipper", "Mass"]);
  });
});
