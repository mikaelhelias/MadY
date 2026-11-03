// @vitest-environment jsdom
/**
 * A pie slice of a parts-of-whole sheet is drawn in its value column's style (colour excepted) with its own laid
 * over it, so a preset's two-tone reaches every slice. The slice panel read the slice's own style alone: it showed
 * Fill style "Solid" on a two-tone slice and offered Border, which a two-tone slice never reads (its edge is derived).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { tableDatasets } from "@mady/core";
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
const pie = (galleryItems() as unknown as { title: string; table: DataTable; plot: Plot }[]).find((i) => i.title === "Pie")!;
const panel = (plot: Plot) => {
  const u = render(<Inspector activeSection="graphs" selection={{ kind: "pie-slice", datasetId: pie.table.rows[0]!.id } as never} plot={plot} table={pie.table} userPresets={[]} profileDefault={null} {...handlers()} />);
  const rows = [...u.container.querySelectorAll("label.frow")];
  const fillStyle = rows.find((l) => l.querySelector(":scope > span")?.textContent?.trim() === "Fill style")?.querySelector("select")?.value;
  const labels = rows.map((l) => l.querySelector(":scope > span")?.textContent?.trim());
  cleanup();
  return { fillStyle, labels };
};

describe("pie slice panel reads the style the slice is drawn in", () => {
  it("the gallery pie's value column is two-tone (a fixture that can show the fault)", () => {
    expect(pie.table.kind).toBe("partsofwhole");
    expect(pie.plot.seriesStyles?.[tableDatasets(pie.table)[0]!.id]?.fillType).toBe("twotone");
  });
  it("a two-tone slice shows Two-tone and offers no Border", () => {
    const p = panel(pie.plot);
    expect(p.fillStyle).toBe("twotone");
    expect(p.labels).not.toContain("Border");
  });
  it("a slice set to solid shows Solid and offers Border", () => {
    const p = panel({ ...pie.plot, seriesStyles: { ...pie.plot.seriesStyles, [pie.table.rows[0]!.id]: { fillType: "solid" } } });
    expect(p.fillStyle).toBe("solid");
    expect(p.labels).toContain("Border");
  });
});
