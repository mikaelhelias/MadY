// @vitest-environment jsdom
/**
 * "Loadings colour" colours the loading arrows of a loadings plot or biplot. A triplot draws no loadings (its arrows
 * are the explanatory variables, each coloured on its own), so there the row did nothing; the font row beside it
 * does reach a triplot's drawing and stays.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
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
const card = (kind: string) => (galleryItems() as unknown as { table: DataTable; plot: Plot }[]).find((i) => i.plot.kind === kind)!;
const offered = (kind: string): boolean => {
  const c = card(kind);
  const u = render(<Inspector activeSection="graphs" selection={{ kind: "plot" }} plot={c.plot} table={c.table} userPresets={[]} profileDefault={null} {...handlers()} />);
  const tab = [...u.container.querySelectorAll<HTMLButtonElement>("button.inspcat")].find((b) => b.textContent?.trim() === "Chart");
  if (tab) act(() => { fireEvent.click(tab); });
  const has = u.container.querySelector('[aria-label="Loadings colour"]') !== null;
  cleanup();
  return has;
};
const moves = (kind: string): boolean => {
  const c = card(kind);
  const S = { width: 620, height: 420 };
  return renderFingerprint(c.table, { ...c.plot, seriesStyles: { ...c.plot.seriesStyles, "pca-loadings": { color: "#ff00aa" } } } as Plot, S) !== renderFingerprint(c.table, c.plot, S);
};

describe("Loadings colour", () => {
  it("is withheld on a triplot, where it moves nothing", () => {
    expect(moves("triplot")).toBe(false);
    expect(offered("triplot")).toBe(false);
  });
  for (const kind of ["pcaload", "pcabiplot"]) {
    it(`is offered on ${kind}, where it colours the loadings`, () => {
      expect(moves(kind)).toBe(true);
      expect(offered(kind)).toBe(true);
    });
  }
});
