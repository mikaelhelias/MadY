// @vitest-environment jsdom
/**
 * A QQ plot draws its markers in the P-value column's style with its own ("qq") style laid over it. The series panel
 * read the "qq" style alone, so on a graph whose P column is two-tone (every graph a preset has styled) it showed
 * Fill as solid and offered Outline colour, which a two-tone marker never reads.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { DataTable, Plot } from "@mady/core";
import { qqPColumn } from "@mady/graphics";
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
const item = (galleryItems() as unknown as { table: DataTable; plot: Plot }[]).find((i) => i.plot.kind === "qq")!;
const labels = (plot: Plot): string[] => {
  const u = render(<Inspector activeSection="graphs" selection={{ kind: "series", columnId: "qq" }} plot={plot} table={item.table} userPresets={[]} profileDefault={null} {...handlers()} />);
  const out = [...u.container.querySelectorAll("label.frow > span:first-child")].map((e) => (e.textContent ?? "").trim());
  cleanup();
  return out;
};

describe("QQ series panel reads the style the markers are drawn in", () => {
  it("the gallery QQ plot's P column is two-tone (a fixture that can show the fault)", () => {
    const p = qqPColumn(item.table, item.plot)!;
    expect(item.plot.seriesStyles?.[p.id]?.symbolFill).toBe("twotone");
  });
  it("on two-tone markers Outline colour is not offered", () => {
    expect(labels(item.plot)).not.toContain("Outline colour");
  });
  it("on open markers it is", () => {
    const p = qqPColumn(item.table, item.plot)!;
    expect(labels({ ...item.plot, seriesStyles: { ...item.plot.seriesStyles, [p.id]: { ...item.plot.seriesStyles?.[p.id], symbolFill: "open" } } })).toContain("Outline colour");
  });
});
