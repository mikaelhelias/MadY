// @vitest-environment jsdom
/**
 * The sunburst's Levels list ticks the columns drawn as rings.
 *
 * Until a column is chosen the sunburst draws every text column as a ring, and the list ticks each one, so it shows
 * which rings are drawn and that unticking is how one is left out. Ticked means drawn, unticking a ring the chart
 * picked keeps the others, and the last ring cannot be unticked.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { DataTable, Plot } from "@mady/core";
import { Inspector } from "./Inspector";

afterEach(cleanup);
afterEach(() => globalThis.localStorage?.clear());

const table: DataTable = {
  id: "t", kind: "multivariable", name: "Budget",
  columns: [{ id: "d", name: "Division" }, { id: "p", name: "Department" }, { id: "m", name: "Team" }, { id: "b", name: "Budget" }],
  rows: Array.from({ length: 8 }, (_, i) => ({ id: `r${i}`, cells: { d: `D${i % 2}`, p: `P${i % 4}`, m: `T${i}`, b: 100 + i } })),
};

function setup(sunburst?: Plot["sunburst"]) {
  const plot: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "sunburst", ...(sunburst ? { sunburst } : {}) };
  const h = {
    onSelect: vi.fn(), onSetAxis: vi.fn(), onSetAxisLength: vi.fn(), onSetAxisTitleFont: vi.fn(),
    onSetSeriesStyle: vi.fn(), onSetSeriesStyleAll: vi.fn(), onSetPointStyle: vi.fn(), onClearPointStyles: vi.fn(),
    onSetGrid: vi.fn(), onSetFrame: vi.fn(), onSetKind: vi.fn(), onSetBarLayout: vi.fn(), onSetBarShape: vi.fn(), onSetBoxWhisker: vi.fn(),
    onSetPlotOptions: vi.fn(), onSetGraphTitle: vi.fn(), onSetPlotFont: vi.fn(), onHomogenizeFont: vi.fn(),
    onSetLegend: vi.fn(), onSetSignificance: vi.fn(), onApplyPreset: vi.fn(),
    onApplyUserPreset: vi.fn(), onSaveUserPreset: vi.fn(), onDeleteUserPreset: vi.fn(), onSetProfileDefault: vi.fn(),
    annotationOps: { add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() },
  };
  const r = render(<Inspector activeSection="graphs" selection={{ kind: "plot" }} plot={plot} table={table} userPresets={[]} profileDefault={null} {...h} />);
  const row = [...r.container.querySelectorAll(".frow")].find((f) => (f.querySelector(":scope > span")?.textContent ?? "").trim() === "Levels")!;
  const boxes = Object.fromEntries([...row.querySelectorAll<HTMLLabelElement>("label.angroup")].map((l) => [(l.textContent ?? "").trim(), l.querySelector("input")!]));
  const ticked = () => Object.entries(boxes).filter(([, b]) => b.checked).map(([n]) => n);
  return { ...h, boxes, ticked };
}

describe("sunburst Levels list", () => {
  it("before any choice, the text columns drawn as rings are ticked, the number column is not", () => {
    expect(setup().ticked()).toEqual(["Division", "Department", "Team"]);
  });

  it("unticking Team leaves the other two rings", () => {
    const { boxes, onSetPlotOptions } = setup();
    fireEvent.click(boxes["Team"]!);
    expect(onSetPlotOptions).toHaveBeenLastCalledWith({ sunburst: { levelColumns: ["d", "p"] } });
  });

  it("with one ring drawn it cannot be unticked; another column can be added", () => {
    const { boxes, ticked, onSetPlotOptions } = setup({ levelColumns: ["p"] });
    expect(ticked()).toEqual(["Department"]);
    expect(boxes["Department"]!.disabled).toBe(true);
    fireEvent.click(boxes["Team"]!);
    expect(onSetPlotOptions).toHaveBeenLastCalledWith({ sunburst: { levelColumns: ["p", "m"] } });
  });
});
