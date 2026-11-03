// @vitest-environment jsdom
/**
 * A column annotation strip carries one value per matrix column. The editor listed every column of the sheet, including
 * one a row strip reads (the clustered card's "Pathway"), which the drawing takes out of the matrix: a value typed for it
 * was never drawn. The editor lists the matrix's columns.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { DataTable, Plot } from "@mady/core";
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
const c = (galleryItems() as unknown as { title: string; table: DataTable; plot: Plot }[]).find((i) => i.title === "Heatmap — clustered, split, annotated")!;

describe("column strip editor", () => {
  it("lists the matrix's columns, not the column a row strip reads", () => {
    const rowStripCols = (c.plot.heatmap?.rowTracks ?? []).map((t) => t.column).filter(Boolean) as string[];
    expect(rowStripCols.length).toBeGreaterThan(0);
    const u = render(<Inspector activeSection="graphs" selection={{ kind: "plot" }} plot={c.plot} table={c.table} userPresets={[]} profileDefault={null} {...handlers()} />);
    const tab = [...u.container.querySelectorAll<HTMLButtonElement>("button.inspcat")].find((b) => b.textContent?.trim() === "Chart");
    if (tab) act(() => { fireEvent.click(tab); });
    const inputs = [...u.container.querySelectorAll("input")].map((e) => e.getAttribute("aria-label") ?? "").filter((l) => /^column strip \d+ value for /.test(l));
    expect(inputs.length).toBeGreaterThan(0);
    for (const id of rowStripCols) {
      const name = c.table.columns.find((col) => col.id === id)!.name;
      expect(inputs.some((l) => l.endsWith(` value for ${name}`)), name).toBe(false);
    }
  });
});
