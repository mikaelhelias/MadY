// @vitest-environment jsdom
/**
 * A bar chart series drawn as a line is keyed by a line — no dot (e.g. the 'growth' curve of "Stacked bars + line
 * (2nd axis)", which draws only a plain line).
 *
 * `plotAs: "line"` draws the series as a line through its category values and no markers (model.ts). A legend row with
 * the line stub plus the series' marker at its resolved size — on a bar chart the swarm-dot size (14 px under the house
 * defaults) — would carry a large dot the chart never draws. Read off the drawing, both orientations.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { buildPlotScene } from "@mady/graphics";
import type { Plot } from "@mady/core";
import { PlotFigure } from "./PlotFigure";
import { galleryItems } from "./gallery";

afterEach(cleanup);

const card = galleryItems().find((g) => g.title === "Stacked bars + line (2nd axis)")!;

function rowOf(container: HTMLElement, seriesId: string): Element {
  return [...container.querySelectorAll("[data-mady-legend-row]")].find((r) => r.getAttribute("data-mady-series") === seriesId)!;
}

describe("a bar-chart series drawn as a line has a line-only key", () => {
  it("the fixture draws Growth as a bare line (it can exhibit the defect)", () => {
    const scene = buildPlotScene(card.table, card.plot, { width: 700, height: 440 });
    const s = scene.series.find((x) => x.id === "g")!;
    expect(card.plot.seriesStyles?.["g"]?.plotAs).toBe("line");
    expect(s.symbol, "the series asks for a marker — the case where a key could wrongly draw one").not.toBe("none");
    const { container } = render(<PlotFigure scene={scene} />);
    const grp = [...container.querySelectorAll("svg.gfx-figure g.gfx-series")].find((e) => e.getAttribute("data-mady-series") === "g")!;
    expect(grp.querySelectorAll("circle").length, "the line draws no dots").toBe(0);
  });

  for (const orient of ["vertical", "horizontal"] as const) {
    it(`${orient}: the Growth key is the line, with no dot`, () => {
      const plot = { ...card.plot, ...(orient === "horizontal" ? { barOrientation: "horizontal" } : {}) } as Plot;
      const scene = buildPlotScene(card.table, plot, { width: 700, height: 440 });
      const { container } = render(<PlotFigure scene={scene} />);
      const row = rowOf(container, "g");
      expect(row, "no legend row for Growth").toBeDefined();
      expect(row.querySelector("line"), "the key lost its line").not.toBeNull();
      expect(row.querySelectorAll("circle, polygon, path:not(.gfx-legbar), rect:not([fill='transparent'])").length, "the key draws a marker the line never draws").toBe(0);
      // The bars keep their block keys.
      expect(rowOf(container, "a").querySelector(".gfx-legbar")).not.toBeNull();
    });
  }

  it("a series drawn as points keys its marker (it draws one)", () => {
    const plot = { ...card.plot, seriesStyles: { ...card.plot.seriesStyles, g: { ...card.plot.seriesStyles!["g"], plotAs: "points" } } } as Plot;
    const scene = buildPlotScene(card.table, plot, { width: 700, height: 440 });
    const { container } = render(<PlotFigure scene={scene} />);
    expect(rowOf(container, "g").querySelector("circle"), "a points series lost its marker key").not.toBeNull();
  });
});
