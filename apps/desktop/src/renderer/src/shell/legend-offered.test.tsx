// @vitest-environment jsdom
// The Legend section is offered only where a legend can be drawn.
//
// Guards against the Inspector showing the whole Legend block — Show, Position, Layout, Border,
// Background, Gap, legend font — on a kind where setting "Show → Always" produces nothing at all.
// Two different cases, with two different answers:
//
//  • box · violin · scatter · raincloud · floating bar · ridgeline · before–after have legend
//    entries (their groups, or in before–after their subjects). Those builders resolve a real
//    legend, off by default so no saved figure changes.
//  • heatmap · corrmatrix · alluvial · network · 3-D scatter · dendrogram · forest · estimation ·
//    PCA loadings cannot produce a per-series legend that would be accurate — their datasets are not
//    what the drawing distinguishes (a forest's three columns are one forest; a dendrogram's five
//    samples are one tree; alluvial's two columns are the ends of the flows). Those keep no
//    legend and the section is hidden.
//
// Both halves are derived here from the builder, never from a copy of the list, so the Inspector
// and the drawing cannot drift apart unnoticed.
//
// Note: two conditions, not one. `fonts.legend.*` is also the fallback font for the heatmap colour
// bar, the correlation-matrix ramp and the alluvial labels — measured live on those kinds — so
// the font control stays where the legend rows go away.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { PlotFigure } from "./PlotFigure";
import { Inspector } from "./Inspector";
import { galleryItems } from "./gallery";

afterEach(cleanup);

const SIZE = { width: 620, height: 420 };
const shown = (plot: Plot): Plot => ({ ...plot, legend: { ...plot.legend, show: true } });

/** Does this kind resolve any legend entry when the legend is explicitly switched on?
 *
 *  A card that has chosen direct labels (`legend.position: "direct"` — the "Time course" card)
 *  draws its key on the series, not as a block, so "Show → Always" alone yields no
 *  entry. Its Position control is exactly the way back to a block, so the probe asks the second
 *  question too: does a block draw once the position is a real one? That keeps the guard on a
 *  kind that can draw no legend while not failing a card that merely chose the other form. */
const canLegend = (item: { table: never; plot: Plot }): boolean => {
  if (buildPlotScene(item.table, shown(item.plot), SIZE).legend.length > 0) return true;
  if (item.plot.legend?.position !== "direct") return false;
  return buildPlotScene(item.table, { ...item.plot, legend: { ...item.plot.legend, show: true, position: "right" } }, SIZE).legend.length > 0;
};

/** Does the legend font change the drawing — through the legend, or through a colour bar / ramp
 *  that falls back to it? Rendered, not inspected: the scene records the font table for every
 *  kind whether or not a glyph uses it. */
const legendFontLive = (item: { table: never; plot: Plot }): boolean => {
  const draw = (p: Plot): string =>
    renderToStaticMarkup(createElement(PlotFigure, { scene: buildPlotScene(item.table, p, SIZE) }));
  const base = shown(item.plot);
  const bigger: Plot = { ...base, fonts: { ...base.fonts, legend: { ...base.fonts?.legend, size: 27 } } };
  return draw(base) !== draw(bigger);
};

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

/** Control labels, never `textContent` — matching the text of hidden <option> elements lets a
 *  guard pass on broken code. */
function labels(item: { table: never; plot: Plot }): string[] {
  const { container } = render(
    <Inspector activeSection="graphs" selection={{ kind: "plot" }} plot={item.plot} table={item.table}
      userPresets={[]} profileDefault={null} {...handlers()} />,
  );
  const out = [...container.querySelectorAll("label > span:first-child, .inspsub, .insphd")]
    .map((e) => (e.textContent ?? "").trim()).filter(Boolean);
  cleanup();
  return out;
}

describe("the Legend section is offered only where a legend can be drawn", () => {
  for (const item of galleryItems() as unknown as { table: never; plot: Plot }[]) {
    const kind = item.plot.kind ?? "xy";
    it(`${kind}: panel and builder agree`, () => {
      const can = canLegend(item);
      const l = labels(item);
      // The heading is on every kind — a section that vanishes reads as a bug in the program.
      expect(l.includes("Legend"), `${kind}: the Legend heading disappeared`).toBe(true);
      // The controls are what follows the builder. One row is enough to catch a half-shown block.
      expect(l.includes("Position"), can
        ? `${kind}: a legend DOES draw here, but its controls are withheld`
        : `${kind}: legend controls are offered, and "Show → Always" produces no legend at all`,
      ).toBe(can);
    });

    it(`${kind}: a withheld legend says why, in a sentence`, () => {
      if (canLegend(item)) return; // nothing to explain
      const { container } = render(
        <Inspector activeSection="graphs" selection={{ kind: "plot" }} plot={item.plot} table={item.table}
          userPresets={[]} profileDefault={null} {...handlers()} />,
      );
      // Note: structural, not a keyword match: the sentence has to sit directly under the Legend
      // heading. A text search for "legend|key|axis|…" can pass on a kind that has an unrelated
      // hint elsewhere in the panel — a guard that can be satisfied by the wrong element is not
      // a guard.
      const heading = [...container.querySelectorAll(".inspsub")].find((e) => (e.textContent ?? "").trim() === "Legend");
      const next = heading?.nextElementSibling;
      const said = next?.classList.contains("hint") ? (next.textContent ?? "").trim() : "";
      cleanup();
      expect(heading, `${kind}: the Legend heading is gone`).toBeTruthy();
      expect(said, `${kind}: the legend controls are withheld with no explanation under the heading — that reads as a bug`).toBeTruthy();
      expect(said.length, `${kind}: the explanation is too short to say anything`).toBeGreaterThan(20);
    });

    it(`${kind}: the legend font is offered iff it changes something`, () => {
      const live = canLegend(item) || legendFontLive(item);
      expect(labels(item).includes("Legend font"), live
        ? `${kind}: the legend font changes the drawing but has no control`
        : `${kind}: a "Legend font" control that styles nothing on this kind`,
      ).toBe(live);
    });
  }

  it("switching the legend on does not change a figure that never asked for one", () => {
    // The reason these legends default to off: a saved box plot must look identical.
    for (const item of galleryItems()) {
      const kind = item.plot.kind ?? "xy";
      if (!["box", "violin", "scatter", "raincloud", "floatingbar", "ridgeline", "beforeafter"].includes(kind)) continue;
      // A banded ridgeline asks for its key: the band legend is what decodes the levels (the
      // ridgeline card uses the horizon fold). A plain density ridge stays silent.
      if (kind === "ridgeline" && item.plot.ridgeline?.bands) continue;
      const scene = buildPlotScene(item.table, item.plot, SIZE);
      expect(scene.legend.length, `${kind}: a legend appeared without being asked for`).toBe(0);
    }
  });

  it("a legend switched on is drawn, and the plot makes room for it", () => {
    // "It reached the scene" is not the claim: a kind can resolve an entry its figure never
    // renders. Read it back out of the DOM, and check the plot narrowed.
    for (const item of galleryItems()) {
      const kind = item.plot.kind ?? "xy";
      if (!["box", "violin", "scatter", "raincloud", "floatingbar", "ridgeline", "beforeafter"].includes(kind)) continue;
      if (kind === "ridgeline" && item.plot.ridgeline?.bands) continue; // its band key is already drawn (see above)
      const on = buildPlotScene(item.table, shown(item.plot), SIZE);
      const { container } = render(<PlotFigure scene={on} zoom={1} onSelect={vi.fn()} />);
      const text = container.textContent ?? "";
      cleanup();
      expect(on.legend.length, `${kind}: no legend entries to draw`).toBeGreaterThan(0);
      for (const e of on.legend) expect(text.includes(e.label), `${kind}: legend row "${e.label}" never reached the figure`).toBe(true);
      expect(
        on.plot.width,
        `${kind}: the legend is drawn in the outside-right column but no room was reserved — it will sit on the data`,
      ).toBeLessThan(buildPlotScene(item.table, item.plot, SIZE).plot.width);
    }
  });

  it("before-after legends its subjects, and exactly the ones it draws", () => {
    const item = galleryItems().find((g) => g.plot.kind === "beforeafter")!;
    const scene = buildPlotScene(item.table, shown(item.plot), SIZE);
    expect(scene.legend.map((e) => e.label)).toEqual(scene.series.map((s) => s.name));
    expect(scene.legend.map((e) => e.color)).toEqual(scene.series.map((s) => s.color));
  });
});
