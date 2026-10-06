// @vitest-environment jsdom
// Styling that can be reached by clicking must be advertised somewhere.
//
// The ordination kinds (scores, loadings, biplot, triplot), the scree plot and the dendrogram draw
// synthetic series, with ids such as `pca-g0`, `scree-cum` and `dendro-0`, keyed independently of
// the table's columns, so `syntheticSeries` in `Inspector.tsx` withholds the Series list for them
// (a datasets-keyed list would write ids the builder never reads). This test checks five of them;
// the triplot is not in its set. That leaves per-element styling working but invisible
// unless the panel says so: click a PCA score and the editor appears.
//
// `Inspector.tsx` leaves naming the element to a pass that verifies each kind. This test is that
// pass, and it re-runs every time: it clicks the real figure, finds which elements emit a
// per-element selection, and requires the panel to advertise exactly those kinds.
//
// Note: the advertised noun is not checked against the tag — "a point" for a `circle` is a judgement,
// not a fact. What is checked is that a kind with a click path says something, and a kind with
// none says nothing.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import { Inspector } from "./Inspector";
import { galleryItems } from "./gallery";

afterEach(cleanup);

const SIZE = { width: 620, height: 420 };

/** Kinds checked here whose Series list is withheld because their series are not table columns. */
const SYNTHETIC = new Set(["pcascore", "pcabiplot", "pcaload", "scree", "dendrogram"]);

/** Does clicking the figure ever produce a per-element (series) selection? */
function clickReachesSeries(item: { table: never; plot: Plot }): boolean {
  let hit = false;
  const scene = buildPlotScene(item.table, item.plot, SIZE);
  const { container } = render(
    <PlotFigure scene={scene} zoom={1} onSelect={(s) => { if ((s as unknown as { kind: string }).kind === "series") hit = true; }} />,
  );
  // Only the data layer: a legend row also emits a series selection, and a chart with no legend
  // would then look unreachable for the wrong reason.
  for (const el of container.querySelectorAll("g.gfx-series *")) fireEvent.click(el);
  cleanup();
  return hit;
}

const handlers = () => ({
  onSelect: vi.fn(),
  onSetAxis: vi.fn(), onSetAxisLength: vi.fn(), onSetAxisTitleFont: vi.fn(),
  onSetSeriesStyle: vi.fn(), onSetSeriesStyleAll: vi.fn(), onSetPointStyle: vi.fn(), onClearPointStyles: vi.fn(),
  onSetGrid: vi.fn(), onSetFrame: vi.fn(), onSetKind: vi.fn(), onSetBarLayout: vi.fn(), onSetBarShape: vi.fn(), onSetBoxWhisker: vi.fn(),
  onSetPlotOptions: vi.fn(), onSetGraphTitle: vi.fn(), onSetPlotFont: vi.fn(), onHomogenizeFont: vi.fn(),
  onSetLegend: vi.fn(), onSetSignificance: vi.fn(), onApplyPreset: vi.fn(), 
  onApplyUserPreset: vi.fn(), onSaveUserPreset: vi.fn(), onDeleteUserPreset: vi.fn(), onSetProfileDefault: vi.fn(),
  annotationOps: { add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() },
});

/** The "Click … on the graph to style it" note, if the panel shows one. */
function clickNote(item: { table: never; plot: Plot }): string {
  const { container } = render(
    <Inspector activeSection="graphs" selection={{ kind: "plot" }} plot={item.plot} table={item.table}
      userPresets={[]} profileDefault={null} {...handlers()} />,
  );
  const note = [...container.querySelectorAll("p.note")]
    .map((e) => (e.textContent ?? "").trim())
    .find((t) => /^Click .* on the graph to style it/.test(t)) ?? "";
  cleanup();
  return note;
}

describe("the synthetic-series kinds advertise the element you click", () => {
  const items = galleryItems() as unknown as { table: never; plot: Plot }[];

  it("guards the guard — those kinds really do have a click path", () => {
    const reachable = items.filter((i) => SYNTHETIC.has(i.plot.kind ?? "") && clickReachesSeries(i));
    expect(reachable.length, "no synthetic-series kind emits a series click — the click check is broken").toBe(SYNTHETIC.size);
  });

  for (const item of items) {
    const kind = item.plot.kind ?? "xy";
    if (!SYNTHETIC.has(kind)) continue;
    it(`${kind}: the panel names what to click`, () => {
      const note = clickNote(item);
      expect(note, `${kind}: per-element styling is reachable by clicking and nothing in the panel says so`).toBeTruthy();
      expect(note, `${kind}: the note does not name an element`).toMatch(/^Click a .+ on the graph to style it/);
    });
  }

  it("…and a kind with no click path is not told to click one", () => {
    // The negative control. Heatmap / corrmatrix / alluvial / network style their parts in their
    // own Chart sections; pointing them at a series editor would be the wrong instruction.
    for (const item of items) {
      const kind = item.plot.kind ?? "xy";
      if (!["heatmap", "corrmatrix", "alluvial", "network"].includes(kind)) continue;
      expect(clickNote(item), `${kind}: told to click for a series editor it does not use`).toBe("");
    }
  });
});
