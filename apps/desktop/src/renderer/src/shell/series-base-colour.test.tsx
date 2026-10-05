// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { DataTable, Plot, PlotKind } from "@mady/core";
import { tableDatasets } from "@mady/core";
import { Inspector } from "./Inspector";

afterEach(cleanup);
afterEach(() => globalThis.localStorage?.clear());

/**
 * Every fill-based kind must offer its series base colour.
 *
 * `seriesStyles.color` is not the same field as the Fill row's `fillColor`: it is what the
 * legend swatch, the default fill and the derived two-tone shades come from. Against the real
 * builder, box, floatingbar, histogram, pyramid and violin all move when it changes, so each of
 * them — like raincloud — must render a control for it.
 *
 * Note: pyramid is in this list on purpose: swapping its panel from the marker fields to the
 * fill fields can take its "Colour" row away with them. This test keeps that trade from being
 * made silently.
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

const table: DataTable = {
  id: "t", kind: "column", name: "T",
  columns: [{ id: "g", name: "Group", role: "x" }, { id: "a", name: "A", role: "y" }, { id: "b", name: "B", role: "y" }],
  rows: [
    { id: "r1", cells: { g: "Alpha", a: 5, b: 8 } },
    { id: "r2", cells: { g: "Beta", a: 9, b: 4 } },
    { id: "r3", cells: { g: "Gamma", a: 7, b: 6 } },
  ],
};

/** Control labels + group headings of the series panel. Not textContent — that includes the
 *  text of hidden <option>s and would make this style of test unable to fail. */
function labels(kind: PlotKind): string[] {
  const plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind } as Plot;
  const ds = tableDatasets(table)[0]!;
  const { container } = render(
    <Inspector activeSection="graphs" selection={{ kind: "series", columnId: ds.id, part: "points" }}
      plot={plot} table={table} userPresets={[]} profileDefault={null} {...handlers()} />,
  );
  return [...container.querySelectorAll("label > span:first-child, .inspsub, .insphd")]
    .map((e) => (e.textContent ?? "").trim())
    .filter(Boolean);
}

const FILL_KINDS: PlotKind[] = ["box", "floatingbar", "histogram", "pyramid", "violin", "raincloud"];

describe("fill-based kinds offer the series base colour", () => {
  it("guards the guard — the panels render controls", () => {
    for (const k of FILL_KINDS) expect(labels(k).length, `${k} rendered nothing`).toBeGreaterThan(3);
  });

  for (const kind of FILL_KINDS) {
    it(`${kind}: has a Colour group`, () => {
      expect(
        labels(kind),
        `${kind} honours seriesStyles.color but its panel offers no control for it`,
      ).toContain("▾Colour");
    });
  }
});
