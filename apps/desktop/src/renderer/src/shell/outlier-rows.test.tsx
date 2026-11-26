// @vitest-environment jsdom
/**
 * The Outliers rows (Show points, Size) only where outliers can be drawn. A floating bar spans min→max and a raincloud
 * draws every value as its rain, so neither ever has an outlier dot: the rows there could never change the drawing.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { tableDatasets } from "@mady/core";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { Inspector } from "./Inspector";
import { galleryItems } from "./gallery";
import { renderFingerprint } from "./drawingMarkup";

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
  annotationOps: { add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() },
});
const card = (kind: string) => (galleryItems() as unknown as { table: DataTable; plot: Plot }[]).find((i) => i.plot.kind === kind)!;
const outlierRows = (kind: string): boolean => {
  const c = card(kind);
  const u = render(
    <Inspector activeSection="graphs" selection={{ kind: "series", columnId: tableDatasets(c.table)[0]!.id }} plot={c.plot} table={c.table}
      userPresets={[]} profileDefault={null} {...handlers()} />,
  );
  // A group heading is a button: its chevron, then the group's name.
  const has = [...u.container.querySelectorAll(".inspgroup > button")].some((e) => (e.textContent ?? "").trim().endsWith("Outliers"));
  cleanup();
  return has;
};

describe("Outliers rows", () => {
  it("are withheld on a floating bar and a raincloud", () => {
    expect(outlierRows("floatingbar")).toBe(false);
    expect(outlierRows("raincloud")).toBe(false);
  });
  it("stay on a box plot, where an outlier is drawn and Show points hides it", () => {
    expect(outlierRows("box")).toBe(true);
    const c = card("box");
    const id = tableDatasets(c.table)[0]!.id;
    // One far value makes an outlier.
    const table = { ...c.table, rows: c.table.rows.map((r, i) => (i === 0 ? { ...r, cells: { ...r.cells, [id]: 1e4 } } : r)) } as DataTable;
    const outliers = buildPlotScene(table, c.plot, { width: 620, height: 420 }).series.flatMap((s) => s.marks).reduce((n, m) => n + (m.box?.outliers.length ?? 0), 0);
    expect(outliers).toBeGreaterThan(0);
    const hidden = { ...c.plot, seriesStyles: { ...c.plot.seriesStyles, [id]: { ...c.plot.seriesStyles?.[id], showOutliers: false } } } as Plot;
    expect(renderFingerprint(table, hidden, { width: 620, height: 420 })).not.toBe(renderFingerprint(table, c.plot, { width: 620, height: 420 }));
  });
});
