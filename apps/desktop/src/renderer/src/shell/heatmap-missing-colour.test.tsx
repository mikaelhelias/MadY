// @vitest-environment jsdom
/**
 * Heatmap ▸ Missing colour paints the tiles of empty cells. On a bubble grid an empty cell draws no bubble at all, so
 * the colour had nothing to paint and the row did nothing there; it stays on a tile heatmap, where it draws.
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
const byTitle = (t: string) => (galleryItems() as unknown as { title: string; table: DataTable; plot: Plot }[]).find((i) => i.title === t)!;
/** The sheet with its first value cell emptied. */
const blank = (t: DataTable): DataTable => {
  const id = tableDatasets(t)[0]!.id;
  return { ...t, rows: t.rows.map((r, i) => (i === 0 ? { ...r, cells: { ...r.cells, [id]: null } } : r)) } as DataTable;
};
const offered = (c: { table: DataTable; plot: Plot }): boolean => {
  const u = render(<Inspector activeSection="graphs" selection={{ kind: "plot" }} plot={c.plot} table={c.table} userPresets={[]} profileDefault={null} {...handlers()} />);
  const tab = [...u.container.querySelectorAll<HTMLButtonElement>("button.inspcat")].find((b) => b.textContent?.trim() === "Chart");
  if (tab) act(() => { fireEvent.click(tab); });
  const has = [...u.container.querySelectorAll("label.frow > span:first-child")].some((e) => e.textContent?.trim() === "Missing colour");
  cleanup();
  return has;
};
const paints = (c: { table: DataTable; plot: Plot }): boolean => {
  const t = blank(c.table);
  return renderFingerprint(t, { ...c.plot, heatmap: { ...c.plot.heatmap, nanColor: "#ff00aa" } } as Plot, SIZE) !== renderFingerprint(t, c.plot, SIZE);
};

describe("Heatmap Missing colour", () => {
  it("is withheld on a bubble grid, where an empty cell draws nothing", () => {
    const c = byTitle("Bubble-grid heatmap");
    expect(paints(c)).toBe(false);
    expect(offered(c)).toBe(false);
  });
  it("stays on a tile heatmap, where it paints the empty cell", () => {
    const c = byTitle("Heatmap");
    expect(paints(c)).toBe(true);
    expect(offered(c)).toBe(true);
  });
});
