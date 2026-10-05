// @vitest-environment jsdom
/**
 * Focus on the charts that draw their own series.
 *
 * PCA scores, biplot, triplot, estimation, before–after, pyramid, scree and dendrogram draw their series under ids
 * that are not table columns (`pca-g0`, `g-ba-r0`, `scree`, `dendro-0`, the pyramid's two sides…). The drawing greys
 * the others when one of those ids carries `focus`; a Series list that wrote only column ids could never reach it.
 *
 * These charts list the series they draw, ring only (hiding means nothing there). This drives the real ring on
 * every gallery card of those kinds and checks, from the rebuilt scene, that the id it writes is drawn and that
 * focusing it greys another series.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { Plot, SeriesStyle } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { Inspector } from "./Inspector";
import { galleryItems } from "./gallery";

afterEach(cleanup);
const SIZE = { width: 620, height: 420 };
const KINDS = ["pcascore", "pcabiplot", "triplot", "estimation", "beforeafter", "pyramid", "scree", "dendrogram"];

function drive(item: { table: never; plot: Plot }) {
  const wrote: [string, SeriesStyle][] = [];
  const f = vi.fn();
  const h = {
    onSelect: f, onSetAxis: f, onSetAxisLength: f, onSetAxisTitleFont: f,
    onSetSeriesStyle: (id: string, d: SeriesStyle) => wrote.push([id, d]), onSetSeriesStyleAll: f, onSetPointStyle: f, onClearPointStyles: f,
    onSetGrid: f, onSetFrame: f, onSetKind: f, onSetBarLayout: f, onSetBarShape: f, onSetBoxWhisker: f,
    onSetPlotOptions: f, onSetGraphTitle: f, onSetPlotFont: f, onHomogenizeFont: f,
    onSetLegend: f, onSetSignificance: f, onApplyPreset: f,
    onApplyUserPreset: f, onSaveUserPreset: f, onDeleteUserPreset: f, onSetProfileDefault: f,
    annotationOps: { add: f, update: f, remove: f, reorder: f, align: f, group: f, ungroup: f, setLocked: f, addImage: f, replaceImage: f },
  };
  const { container } = render(
    <Inspector activeSection="graphs" selection={{ kind: "plot" }} plot={item.plot} table={item.table} userPresets={[]} profileDefault={null} {...h} />,
  );
  const rings = [...container.querySelectorAll<HTMLButtonElement>(".focusbtn")];
  const checkboxesInFocusList = container.querySelectorAll("[data-drawn-focus] input[type=checkbox]").length;
  if (rings[0]) fireEvent.click(rings[0]);
  return { rings: rings.length, wrote, checkboxesInFocusList };
}

describe("focus reaches the charts that draw their own series", () => {
  const cards = (galleryItems() as unknown as { table: never; plot: Plot }[]).filter((c) => KINDS.includes(c.plot.kind ?? "xy"));

  it("the gallery has a card for every one of the eight (the sweep can see them)", () => {
    expect(new Set(cards.map((c) => c.plot.kind)).size).toBe(KINDS.length);
  });

  it.each(KINDS)("%s: rings are offered, the ring writes a drawn series, and focusing it greys another", (kind) => {
    for (const card of cards.filter((c) => c.plot.kind === kind)) {
      const scene = buildPlotScene(card.table, card.plot, SIZE);
      if (scene.series.length < 2) continue;
      const { rings, wrote, checkboxesInFocusList } = drive(card);
      expect(rings, `${card.plot.name}: no focus ring`).toBeGreaterThanOrEqual(2);
      expect(checkboxesInFocusList, "hiding means nothing on these charts - the list is focus only").toBe(0);
      const [id, delta] = wrote.at(-1)!;
      expect(delta).toEqual({ focus: true });
      expect(scene.series.map((s) => s.id)).toContain(id);
      const focused = buildPlotScene(card.table, { ...card.plot, seriesStyles: { ...(card.plot.seriesStyles ?? {}), [id]: { ...(card.plot.seriesStyles?.[id] ?? {}), focus: true } } }, SIZE);
      const other = scene.series.findIndex((s) => s.id !== id);
      expect(focused.series[other]!.color, `${card.plot.name}: focusing ${id} greyed nothing`).not.toBe(scene.series[other]!.color);
      expect(focused.warnings.filter((w) => /focus/i.test(w))).toEqual([]);
      cleanup();
    }
  });
});
