// @vitest-environment jsdom
/**
 * A computed series (an ordination group, the loadings, a scree line) and a before-after subject are drawn with the
 * graph's marker look underneath their own style: the fill style and size a style preset gave the sheet's columns.
 * Their panel shows the same, so Fill and Size read what is drawn (the panel read "Solid" and 4 beside two-tone dots
 * of the preset's size).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { buildPlotScene } from "@mady/graphics";
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
const FILL: Record<string, string> = { solid: "Solid", open: "Open (hollow)", twotone: "Two-tone (light fill + dark edge)", clear: "Clear (see-through)" };

describe("a computed series' panel shows the marker look it is drawn with", () => {
  for (const title of ["Ordination — sites", "Ordination — variables", "Ordination — biplot", "Ordination — triplot (constrained)", "Scree plot", "Before–after (paired)"]) {
    it(title, () => {
      const item = (galleryItems() as unknown as { title: string; table: DataTable; plot: Plot }[]).find((i) => i.title === title)!;
      const s = buildPlotScene(item.table, item.plot, { width: 620, height: 420 }).series.find((x) => x.marks.length > 0)!;
      const u = render(<Inspector activeSection="graphs" selection={{ kind: "series", columnId: s.id, part: "points" }} plot={item.plot} table={item.table} userPresets={[]} profileDefault={null} {...handlers()} />);
      const row = (label: string) => [...u.container.querySelectorAll("label.frow, div.frow")].find((r) => r.querySelector(":scope > span")?.textContent?.trim() === label);
      const fill = row("Fill")?.querySelector("select");
      const size = row("Size")?.querySelector<HTMLInputElement>("input");
      // The graph's marker look: the first fill style a column of the sheet carries (a style preset writes one on each).
      const intent = Object.values(item.plot.seriesStyles ?? {}).find((x) => x?.symbolFill)?.symbolFill;
      expect(intent, "the card carries a preset's marker look, so it can show the fault").toBe("twotone");
      // Drawn two-tone: an outlined marker with a light fill of its own.
      expect(s.symbolFill).toBe("open");
      expect(s.symbolFillColor).toBeTruthy();
      expect(fill, "Fill row").toBeTruthy();
      expect(fill!.options[fill!.selectedIndex]!.textContent?.trim()).toBe(FILL.twotone);
      expect(Number(size!.value)).toBe(s.symbolSize);
    });
  }
});
