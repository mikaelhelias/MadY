// @vitest-environment jsdom
/**
 * Chart type › Type names the graph's own kind.
 *
 * The list offers the kinds a graph can be switched to. A kind not in it (sunburst, chord, oncoprint, rose, Manhattan,
 * Q-Q, ternary, survival …) is listed under its own name while the graph is of that kind, so the list never shows
 * another kind in its place (a sunburst reading "XY (points / line)").
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { DataTable, Plot, PlotKind } from "@mady/core";
import { Inspector, SWITCHABLE_KINDS } from "./Inspector";

afterEach(cleanup);
afterEach(() => globalThis.localStorage?.clear());

const table: DataTable = {
  id: "t", kind: "multivariable", name: "T",
  columns: [{ id: "a", name: "Section" }, { id: "b", name: "Shelf" }, { id: "v", name: "Loans", role: "y" }],
  rows: [{ id: "r1", cells: { a: "Fiction", b: "Novels", v: 3 } }],
};
const typeOf = (kind: PlotKind) => {
  const plot: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind };
  const noop = vi.fn();
  const h = {
    onSelect: noop, onSetAxis: noop, onSetAxisLength: noop, onSetAxisTitleFont: noop, onSetSeriesStyle: noop, onSetSeriesStyleAll: noop,
    onSetPointStyle: noop, onClearPointStyles: noop, onSetGrid: noop, onSetFrame: noop, onSetKind: noop, onSetBarLayout: noop, onSetBarShape: noop,
    onSetBoxWhisker: noop, onSetPlotOptions: noop, onSetGraphTitle: noop, onSetPlotFont: noop, onHomogenizeFont: noop, onSetLegend: noop,
    onSetSignificance: noop, onApplyPreset: noop, onApplyUserPreset: noop, onSaveUserPreset: noop, onDeleteUserPreset: noop, onSetProfileDefault: noop,
    annotationOps: { add: noop, update: noop, remove: noop, reorder: noop, align: noop, group: noop, ungroup: noop, setLocked: noop, addImage: noop, replaceImage: noop },
  };
  const { container } = render(<Inspector activeSection="graphs" selection={{ kind: "plot" }} plot={plot} table={table} userPresets={[]} profileDefault={null} {...h} />);
  const row = [...container.querySelectorAll(".frow")].find((f) => f.querySelector("span")?.textContent === "Type");
  const sel = row!.querySelector("select")!;
  const out = { value: sel.value, text: sel.options[sel.selectedIndex]?.text };
  cleanup();
  return out;
};

describe("Chart type › Type", () => {
  it.each([["sunburst", "Sunburst"], ["chord", /chord/i], ["oncoprint", /oncoprint/i]] as const)("a %s graph reads as itself", (kind, name) => {
    const t = typeOf(kind);
    expect(t.value).toBe(kind);
    expect(t.text).toMatch(name);
  });
  it("a kind in the list reads as its own list entry", () => {
    expect(typeOf("treemap")).toEqual({ value: "treemap", text: "Treemap (Voronoi)" });
  });
  it("the list's entries are exactly SWITCHABLE_KINDS (no extra entry for a kind it switches to)", () => {
    const plot: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "xy" };
    const noop = vi.fn();
    const { container } = render(<Inspector activeSection="graphs" selection={{ kind: "plot" }} plot={plot} table={table} userPresets={[]} profileDefault={null}
      onSelect={noop} onSetAxis={noop} onSetAxisLength={noop} onSetAxisTitleFont={noop} onSetSeriesStyle={noop} onSetSeriesStyleAll={noop} onSetPointStyle={noop}
      onClearPointStyles={noop} onSetGrid={noop} onSetFrame={noop} onSetKind={noop} onSetBarLayout={noop} onSetBarShape={noop} onSetBoxWhisker={noop}
      onSetPlotOptions={noop} onSetGraphTitle={noop} onSetPlotFont={noop} onHomogenizeFont={noop} onSetLegend={noop} onSetSignificance={noop} onApplyPreset={noop}
      onApplyUserPreset={noop} onSaveUserPreset={noop} onDeleteUserPreset={noop} onSetProfileDefault={noop}
      annotationOps={{ add: noop, update: noop, remove: noop, reorder: noop, align: noop, group: noop, ungroup: noop, setLocked: noop, addImage: noop, replaceImage: noop }} />);
    const row = [...container.querySelectorAll(".frow")].find((f) => f.querySelector("span")?.textContent === "Type")!;
    expect([...row.querySelector("select")!.options].map((o) => o.value).sort()).toEqual([...SWITCHABLE_KINDS].sort());
  });
});
