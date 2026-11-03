// @vitest-environment jsdom
/**
 * The alluvial's Axes list ticks the columns the diagram draws.
 *
 * Until a column is chosen the diagram draws every text column, and the list ticks each one, so it shows that a
 * Student column (one name per row, 90 one-person bars) is drawn and that unticking it is how it is left out. Ticked
 * means drawn, unticking a column the chart picked leaves the others, and the last two cannot be unticked (a diagram
 * needs two stages; a choice of one falls back to every text column without a word).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { DataTable, Plot } from "@mady/core";
import { Inspector } from "./Inspector";

afterEach(cleanup);
afterEach(() => globalThis.localStorage?.clear());

const majors = ["Biology", "Chemistry", "Physics", "Maths"];
const table: DataTable = {
  id: "t", kind: "multivariable", name: "Graduates",
  columns: [
    { id: "s", name: "Student", role: "x" }, { id: "m", name: "First-year major", role: "x" },
    { id: "f", name: "Final major", role: "x" }, { id: "j", name: "First job sector", role: "x" }, { id: "k", name: "Salary", role: "y" },
  ],
  rows: Array.from({ length: 12 }, (_, i) => ({ id: `r${i}`, cells: { s: `S${i + 1}`, m: majors[i % 4]!, f: majors[(i + 1) % 4]!, j: i % 2 ? "Research" : "Industry", k: 30 + i } })),
};

function setup(alluvial?: Plot["alluvial"]) {
  const plot: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "alluvial", ...(alluvial ? { alluvial } : {}) };
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
  const section = [...r.container.querySelectorAll(".inspsec")].find((s) => (s.querySelector("summary")?.textContent ?? "").includes("Alluvial / parallel sets"))!;
  const boxes = Object.fromEntries([...section.querySelectorAll<HTMLLabelElement>("label.angroup")].map((l) => [(l.textContent ?? "").trim(), l.querySelector("input")!]));
  const ticked = () => Object.entries(boxes).filter(([, b]) => b.checked).map(([n]) => n);
  return { ...h, boxes, ticked };
}

describe("alluvial Axes list", () => {
  it("before any choice, the text columns the diagram draws are ticked, the number column is not", () => {
    const { ticked } = setup();
    expect(ticked()).toEqual(["Student", "First-year major", "Final major", "First job sector"]);
  });

  it("unticking Student leaves the other three drawn", () => {
    const { boxes, onSetPlotOptions } = setup();
    fireEvent.click(boxes["Student"]!);
    expect(onSetPlotOptions).toHaveBeenLastCalledWith({ alluvial: { columns: ["m", "f", "j"] } });
  });

  it("a chosen list is ticked as chosen; with two drawn neither can be unticked, the others can be added", () => {
    const { boxes, ticked, onSetPlotOptions } = setup({ columns: ["m", "j"] });
    expect(ticked()).toEqual(["First-year major", "First job sector"]);
    expect(boxes["First-year major"]!.disabled).toBe(true);
    expect(boxes["First job sector"]!.disabled).toBe(true);
    expect(boxes["Student"]!.disabled).toBe(false);
    fireEvent.click(boxes["Final major"]!);
    expect(onSetPlotOptions).toHaveBeenLastCalledWith({ alluvial: { columns: ["m", "j", "f"] } });
  });
});
