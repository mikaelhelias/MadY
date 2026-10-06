// @vitest-environment jsdom
/**
 * A bubble's size key wears the marks' shape. Guards against a key that draws circles whatever
 * the series' symbol is (as when a preset's shape cycle reaches a single-series bubble): a key of
 * round spheres beside square marks keys nothing. The builder carries the series' symbol on the
 * size legend and the renderer draws the key with it — measured here off the rendered markup,
 * because the shape is a renderer prop, and a scene field the renderer ignores would pass a
 * check of the scene alone.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import { galleryItems } from "./gallery";

afterEach(cleanup);

const SIZE = { width: 620, height: 420 };
const card = (galleryItems() as unknown as { table: never; plot: Plot }[]).find((c) => (c.plot.kind ?? "xy") === "bubble")!;
const shaped = (symbol: "square" | "circle" | undefined): Plot => {
  const sid = Object.keys(card.plot.seriesStyles ?? {})[0]!;
  return { ...card.plot, seriesStyles: { ...card.plot.seriesStyles, [sid]: { ...card.plot.seriesStyles?.[sid], ...(symbol ? { symbol } : {}) } } };
};
/** The key's spheres: whatever the size legend draws that is not text or a leader line. */
const keyShapes = (plot: Plot): string[] => {
  const s = buildPlotScene(card.table, plot, SIZE);
  expect(s.bubbleLegend?.items.length ?? 0, "the fixture has no size key").toBeGreaterThan(0);
  const { container } = render(<PlotFigure scene={s} />);
  const g = container.querySelector("g.gfx-size-legend");
  expect(g, "no size legend drawn").toBeTruthy();
  return [...g!.querySelectorAll("circle, rect, path, polygon")].map((el) => el.tagName.toLowerCase());
};

describe("bubble size key — shape", () => {
  it("the builder carries the series' symbol on the size legend", () => {
    expect(buildPlotScene(card.table, shaped("square"), SIZE).bubbleLegend!.marker.symbol).toBe("square");
    expect(buildPlotScene(card.table, shaped(undefined), SIZE).bubbleLegend!.marker.symbol).toBe("circle");
  });

  it("square marks get a key of squares; round marks keep a key of circles", () => {
    const squares = keyShapes(shaped("square"));
    expect(squares.filter((t) => t === "rect").length, `the key drew ${squares.join(",")} for square marks`).toBeGreaterThan(0);
    expect(squares).not.toContain("circle");
    const circles = keyShapes(shaped("circle"));
    expect(circles).toContain("circle");
    expect(circles).not.toContain("rect");
  });
});
