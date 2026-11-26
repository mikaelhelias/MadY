// @vitest-environment jsdom
/**
 * A histogram draws its individual data points only with Chart type ▸ Data points on (off by default). The series
 * panel offered the marker rows (Shape, Size, Fill, Opacity, Outline width) either way, where they styled nothing.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { tableDatasets } from "@mady/core";
import type { DataTable, Plot } from "@mady/core";
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
  annotationOps: {} as never,
});
const item = (galleryItems() as unknown as { title: string; table: DataTable; plot: Plot }[]).find((i) => i.title === "Histogram")!;
const id = tableDatasets(item.table)[0]!.id;
const labels = (plot: Plot): string[] => {
  const u = render(<Inspector activeSection="graphs" selection={{ kind: "series", columnId: id }} plot={plot} table={item.table} userPresets={[]} profileDefault={null} {...handlers()} />);
  const out = [...u.container.querySelectorAll("label.frow > span:first-child")].map((e) => (e.textContent ?? "").trim());
  cleanup();
  return out;
};
const withPoints = { ...item.plot, histogram: { ...item.plot.histogram, showPoints: true } } as Plot;

describe("histogram marker rows", () => {
  it("are withheld while the histogram draws no points", () => {
    expect(item.plot.histogram?.showPoints ?? false).toBe(false);
    const l = labels(item.plot);
    expect(l).not.toContain("Shape");
    expect(l).not.toContain("Outline width");
  });
  it("are offered, and draw, once Data points is on", () => {
    const l = labels(withPoints);
    expect(l).toContain("Shape");
    const square = { ...withPoints, seriesStyles: { ...withPoints.seriesStyles, [id]: { ...withPoints.seriesStyles?.[id], symbol: "square" } } } as Plot;
    expect(renderFingerprint(item.table, square, { width: 620, height: 420 })).not.toBe(renderFingerprint(item.table, withPoints, { width: 620, height: 420 }));
  });
});
