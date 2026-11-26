// @vitest-environment jsdom
/**
 * Chart type rows that apply to one form of a chart only, offered where that form is drawn:
 *  - a lollipop's Baseline / index is the line single-series stems rise from; a two-series (dumbbell) chart draws its
 *    stems between the two values and reads no baseline;
 *  - a ridgeline's Smoothing is the bandwidth of each row's density; rows drawn as values over X are not smoothed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { tableDatasets } from "@mady/core";
import type { DataTable, Plot } from "@mady/core";
import { Inspector } from "./Inspector";
import { galleryItems } from "./gallery";
import { renderFingerprint } from "./drawingMarkup";

afterEach(cleanup);
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
const SIZE = { width: 620, height: 420 };
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
const card = (kind: string) => (galleryItems() as unknown as { table: DataTable; plot: Plot }[]).find((i) => i.plot.kind === kind)!;
const chartRows = (table: DataTable, plot: Plot): string[] => {
  const u = render(<Inspector activeSection="graphs" selection={{ kind: "plot" }} plot={plot} table={table} userPresets={[]} profileDefault={null} {...handlers()} />);
  const tab = [...u.container.querySelectorAll<HTMLButtonElement>("button.inspcat")].find((b) => b.textContent?.trim() === "Chart");
  if (tab) act(() => { fireEvent.click(tab); });
  const out = [...u.container.querySelectorAll("label.frow > span:first-child")].map((e) => (e.textContent ?? "").trim());
  cleanup();
  return out;
};

describe("lollipop Baseline / index", () => {
  const c = card("lollipop");
  const [a, b] = tableDatasets(c.table);
  const single = { ...c.plot, seriesStyles: { ...c.plot.seriesStyles, [b!.id]: { ...c.plot.seriesStyles?.[b!.id], hidden: true } } } as Plot;
  it("is withheld on a two-series (dumbbell) chart, where it moves nothing", () => {
    expect(a && b).toBeTruthy();
    expect(renderFingerprint(c.table, { ...c.plot, lollipop: { ...c.plot.lollipop, baseline: 2 } } as Plot, SIZE)).toBe(renderFingerprint(c.table, c.plot, SIZE));
    expect(chartRows(c.table, c.plot)).not.toContain("Baseline / index");
  });
  it("is offered on a single-series chart, where it moves the stems", () => {
    expect(renderFingerprint(c.table, { ...single, lollipop: { ...single.lollipop, baseline: 2 } } as Plot, SIZE)).not.toBe(renderFingerprint(c.table, single, SIZE));
    expect(chartRows(c.table, single)).toContain("Baseline / index");
  });
});

describe("ridgeline Smoothing", () => {
  const c = card("ridgeline");
  const density = { ...c.plot, ridgeline: { ...c.plot.ridgeline, source: undefined } } as Plot;
  it("is withheld on rows drawn as values over X", () => {
    expect(c.plot.ridgeline?.source).toBe("profile");
    expect(chartRows(c.table, c.plot)).not.toContain("Smoothing");
  });
  it("is offered on density rows, where it changes them", () => {
    expect(renderFingerprint(c.table, { ...density, ridgeline: { ...density.ridgeline, bandwidth: 2 } } as Plot, SIZE)).not.toBe(renderFingerprint(c.table, density, SIZE));
    expect(chartRows(c.table, density)).toContain("Smoothing");
  });
});
