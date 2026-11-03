// @vitest-environment jsdom
/**
 * Frame ▸ Graph size ▸ Layout presets place the title, the legend and the frame together. On a graph type that draws
 * no legend, a preset that differs from an earlier one only in the legend draws the same graph, so each distinct
 * layout is offered once there; where a legend is drawn, all of them are.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { DataTable, Plot } from "@mady/core";
import { Inspector } from "./Inspector";
import { galleryItems } from "./gallery";
import { renderFingerprint } from "./drawingMarkup";

afterEach(cleanup);
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
const handlers = (onSetPlotOptions = vi.fn()) => ({
  onSelect: vi.fn(), wholeGraph: false, onSetWholeGraph: vi.fn(),
  onSetAxis: vi.fn(), onSetAxisLength: vi.fn(), onSetAxisTitleFont: vi.fn(),
  onSetSeriesStyle: vi.fn(), onSetSeriesStyleAll: vi.fn(), onSetPointStyle: vi.fn(), onClearPointStyles: vi.fn(),
  onSetGrid: vi.fn(), onSetFrame: vi.fn(), onSetKind: vi.fn(), onSetBarLayout: vi.fn(), onSetBarShape: vi.fn(), onSetBoxWhisker: vi.fn(),
  onSetPlotOptions, onSetGraphTitle: vi.fn(), onSetPlotFont: vi.fn(), onHomogenizeFont: vi.fn(),
  onSetLegend: vi.fn(), onSetSignificance: vi.fn(), onApplyPreset: vi.fn(),
  onApplyUserPreset: vi.fn(), onSaveUserPreset: vi.fn(), onDeleteUserPreset: vi.fn(), onSetProfileDefault: vi.fn(),
  annotationOps: {} as never,
});
const card = (kind: string) => (galleryItems() as unknown as { table: DataTable; plot: Plot }[]).find((i) => i.plot.kind === kind)!;
/** The layout buttons offered, with the plot each one writes (applied to the card, a title set so alignment shows). */
const presets = (kind: string): { label: string; plot: Plot }[] => {
  const c = card(kind);
  const plot = { ...c.plot, title: "A title" } as Plot;
  const set = vi.fn();
  const u = render(<Inspector activeSection="graphs" selection={{ kind: "plot" }} plot={plot} table={c.table} userPresets={[]} profileDefault={null} {...handlers(set)} />);
  const tab = [...u.container.querySelectorAll<HTMLButtonElement>("button.inspcat")].find((b) => b.textContent?.trim() === "Frame");
  if (tab) act(() => { fireEvent.click(tab); });
  const row = [...u.container.querySelectorAll(".frow")].find((r) => r.querySelector(":scope > span")?.textContent?.trim() === "Layout")!;
  const out = [...row.querySelectorAll("button")].map((b) => {
    set.mockClear();
    fireEvent.click(b);
    return { label: b.textContent?.trim() ?? "", plot: { ...plot, ...(set.mock.calls[0]![0] as Partial<Plot>) } as Plot };
  });
  cleanup();
  return out;
};

describe("layout presets", () => {
  for (const kind of ["venn", "funnel", "estimation", "corrmatrix"]) {
    it(`${kind} (no legend): every offered preset draws a different graph`, () => {
      const c = card(kind);
      const prints = presets(kind).map((p) => renderFingerprint(c.table, p.plot, { width: 620, height: 420 }));
      expect(new Set(prints).size, presets(kind).map((p) => p.label).join(", ")).toBe(prints.length);
    });
  }
  // Kinds that can draw a legend, on graphs that draw none: one series (a histogram), or one drawn series (Bland-Altman).
  for (const kind of ["blandaltman", "histogram"]) {
    it(`${kind} (a graph that draws no legend): every offered preset draws a different graph`, () => {
      const c = card(kind);
      const prints = presets(kind).map((p) => renderFingerprint(c.table, p.plot, { width: 620, height: 420 }));
      expect(new Set(prints).size, presets(kind).map((p) => p.label).join(", ")).toBe(prints.length);
    });
  }
  it("an XY graph (with a legend) offers all four", () => {
    expect(presets("xy").map((p) => p.label)).toEqual(["Default", "Compact", "Manuscript", "Banner"]);
  });
});
