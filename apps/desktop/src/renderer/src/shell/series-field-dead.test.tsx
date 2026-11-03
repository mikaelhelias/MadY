// @vitest-environment jsdom
/**
 * `DEAD_SERIES_FIELDS`: single series-panel rows a kind's drawing never reads. Both halves are checked:
 *  - each listed key really does nothing on that kind's gallery graph (so the list cannot outlive the builder);
 *  - the series panel does not offer the row there, and does offer it where the drawing reads it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { tableDatasets } from "@mady/core";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import type { GraphSelection } from "./AppShell";
import { Inspector } from "./Inspector";
import { galleryItems } from "./gallery";
import { DEAD_SERIES_FIELDS } from "./deadControls";
import { renderFingerprint } from "./drawingMarkup";

afterEach(cleanup);
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
const SIZE = { width: 620, height: 420 };
const PROBE: Record<string, unknown> = { color: "#ff00aa", symbolFill: "open", symbolFillColor: "#ff00aa", symbolOutline: "#ff00aa", connect: "none", whiskerCaps: false, whiskerCapWidth: 0.45 };
const LABELS: Record<string, string[]> = { color: ["Colour", "Palette"], symbolFill: ["Fill"], symbolFillColor: ["Fill colour"], symbolOutline: ["Outline colour"], connect: ["Connect"], whiskerCaps: ["End caps"], whiskerCapWidth: ["Cap width"] };
const LINE_PART = new Set(["survival", "dendrogram"]);
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
const seriesId = (c: { table: DataTable; plot: Plot }): string => buildPlotScene(c.table, c.plot, SIZE).series[0]?.id ?? tableDatasets(c.table)[0]!.id;
const rowLabels = (c: { table: DataTable; plot: Plot }, sel: GraphSelection): string[] => {
  const u = render(<Inspector activeSection="graphs" selection={sel} plot={c.plot} table={c.table} userPresets={[]} profileDefault={null} {...handlers()} />);
  const out = [...u.container.querySelectorAll("label.frow > span:first-child")].map((e) => (e.textContent ?? "").trim());
  cleanup();
  return out;
};

describe("series rows a kind's drawing never reads", () => {
  for (const [kind, entry] of Object.entries(DEAD_SERIES_FIELDS)) {
    it(`${kind}: each listed key leaves the drawing unchanged`, () => {
      const c = card(kind);
      const id = seriesId(c);
      const base = renderFingerprint(c.table, c.plot, SIZE);
      for (const key of entry.keys) {
        const p = { ...c.plot, seriesStyles: { ...c.plot.seriesStyles, [id]: { ...c.plot.seriesStyles?.[id], [key]: PROBE[key] } } } as Plot;
        expect(renderFingerprint(c.table, p, SIZE), `${kind}.${key} moves the drawing — take it off the list`).toBe(base);
      }
    });
    it(`${kind}: the series panel does not offer them`, () => {
      const c = card(kind);
      const labels = rowLabels(c, { kind: "series", columnId: seriesId(c), ...(LINE_PART.has(kind) ? { part: "line" } : {}) } as GraphSelection);
      for (const key of entry.keys) for (const l of LABELS[key]!) expect(labels, `${kind}: "${l}" is offered`).not.toContain(l);
    });
  }
  it("an XY series panel still offers Colour and Connect", () => {
    const c = card("xy");
    expect(rowLabels(c, { kind: "series", columnId: seriesId(c) })).toContain("Colour");
    expect(rowLabels(c, { kind: "series", columnId: seriesId(c), part: "line" } as GraphSelection)).toContain("Connect");
  });
});
