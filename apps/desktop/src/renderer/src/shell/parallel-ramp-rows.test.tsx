// @vitest-environment jsdom
/**
 * Parallel coordinates coloured by a column draw a value ramp (and a colour bar) when that column holds numbers, and
 * hues when it holds names. Under "Auto" the panel read the setting, not what Auto resolves to, so on a names column it
 * offered the ramp rows and the Colour bar section, which the hues never read.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { DataTable, Plot } from "@mady/core";
import { parallelColoursByValue } from "@mady/graphics";
import { Inspector } from "./Inspector";
import { galleryItems } from "./gallery";

afterEach(cleanup);
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
const handlers = () => ({
  onSelect: vi.fn(), wholeGraph: false, onSetWholeGraph: vi.fn(),
  onSetAxis: vi.fn(), onSetAxisLength: vi.fn(), onSetAxisTitleFont: vi.fn(),
  onSetSeriesStyle: vi.fn(), onSetSeriesStyleAll: vi.fn(), onSetPointStyle: vi.fn(), onClearPointStyles: vi.fn(),
  onSetGrid: vi.fn(), onSetFrame: vi.fn(), onSetKind: vi.fn(), onSetBarLayout: vi.fn(), onSetBarShape: vi.fn(), onSetBoxWhisker: vi.fn(),
  onSetPlotOptions: vi.fn(), onSetGraphTitle: vi.fn(), onSetPlotFont: vi.fn(), onHomogenizeFont: vi.fn(),
  onSetLegend: vi.fn(), onSetSignificance: vi.fn(), onApplyPreset: vi.fn(),
  onApplyUserPreset: vi.fn(), onSaveUserPreset: vi.fn(), onDeleteUserPreset: vi.fn(), onSetProfileDefault: vi.fn(),
  annotationOps: {} as never,
});
const c = (galleryItems() as unknown as { table: DataTable; plot: Plot }[]).find((i) => i.plot.kind === "parallel")!;
const panel = (plot: Plot): { ramp: boolean; colourBar: boolean } => {
  const u = render(<Inspector activeSection="graphs" selection={{ kind: "plot" }} plot={plot} table={c.table} userPresets={[]} profileDefault={null} {...handlers()} />);
  const tab = [...u.container.querySelectorAll<HTMLButtonElement>("button.inspcat")].find((b) => b.textContent?.trim() === "Chart");
  if (tab) act(() => { fireEvent.click(tab); });
  const labels = [...u.container.querySelectorAll("label.frow > span:first-child")].map((e) => e.textContent?.trim());
  const out = { ramp: labels.includes("Ramp"), colourBar: (u.container.textContent ?? "").includes("Colour bar (legend)") };
  cleanup();
  return out;
};

describe("parallel coordinates colour rows", () => {
  it("names under Auto: no ramp rows and no Colour bar section", () => {
    expect(c.plot.parallel?.colorColumn).toBeTruthy();
    expect(parallelColoursByValue(c.table, c.plot)).toBe(false);
    expect(panel(c.plot)).toEqual({ ramp: false, colourBar: false });
  });
  it("a numbers column (or Continuous) offers them", () => {
    const numeric = c.table.columns.find((col) => col.id !== c.plot.parallel?.colorColumn && c.table.rows.every((r) => Number.isFinite(Number(r.cells[col.id]))))!;
    const byValue = { ...c.plot, parallel: { ...c.plot.parallel, colorColumn: numeric.id } } as Plot;
    expect(parallelColoursByValue(c.table, byValue)).toBe(true);
    expect(panel(byValue)).toEqual({ ramp: true, colourBar: true });
  });
});
