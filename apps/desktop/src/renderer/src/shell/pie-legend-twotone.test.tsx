// @vitest-environment jsdom
/**
 * A pie / waffle legend key looks like its slice.
 *
 * A two-tone slice is drawn in a light tint with a darker edge; a key drawn in the full colour would leave the
 * reader unable to match key to slice. Read off the drawing: each key's dot must carry the fill the slices /
 * cells are drawn with, and a pie key the slices' edge. A slice set back to a plain fill keeps a plain key.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { buildPlotScene } from "@mady/graphics";
import type { Plot } from "@mady/core";
import { PlotFigure } from "./PlotFigure";
import { galleryItems } from "./gallery";

afterEach(cleanup);

const pie = galleryItems().find((g) => g.plot.kind === "pie" && g.table.kind === "partsofwhole")!;
const rowIds = pie.table.rows.map((r) => r.id);

/** The key of each legend row: its drawn element (a pie's is a wedge path), fill and edge. */
function keys(container: HTMLElement): Array<{ tag: string | null; round: boolean; fill: string | null; stroke: string | null }> {
  return [...container.querySelectorAll("[data-mady-legend-row]")].map((row) => {
    const k = row.querySelector(".gfx-legbar");
    return { tag: k?.tagName.toLowerCase() ?? null, round: !!row.querySelector("circle"), fill: k?.getAttribute("fill") ?? null, stroke: k?.getAttribute("stroke") ?? null };
  });
}

describe("pie / waffle legend keys match two-tone slices", () => {
  it("the fixture is two-tone (it can exhibit the defect)", () => {
    const scene = buildPlotScene(pie.table, pie.plot, { width: 580, height: 380 });
    const s = scene.pie!.slices[0]!;
    expect(s.strokeColor, "the gallery pie is not two-tone — this test would prove nothing").not.toBeNull();
    expect(scene.legend.length).toBeGreaterThanOrEqual(3);
  });

  it("pie: each key is a wedge with its slice's fill and edge", () => {
    const scene = buildPlotScene(pie.table, pie.plot, { width: 580, height: 380 });
    const { container } = render(<PlotFigure scene={scene} />);
    const k = keys(container);
    scene.pie!.slices.forEach((s, i) => {
      expect(k[i]!.tag, `${s.label}: the key is not a wedge`).toBe("path");
      expect(k[i]!.round, `${s.label}: a line-and-dot key is drawn`).toBe(false);
      expect(k[i]!.fill, `${s.label}: key fill`).toBe(s.color);
      expect(k[i]!.stroke, `${s.label}: key edge`).toBe(s.strokeColor);
    });
    // …and the drawn slices really are those colours (the scene is not the drawing).
    const fills = new Set([...container.querySelectorAll("svg.gfx-figure path")].map((p) => p.getAttribute("fill")));
    for (const s of scene.pie!.slices) expect(fills.has(s.color), `${s.label}: no slice drawn in ${s.color}`).toBe(true);
  });

  it("waffle: two-tone cells are drawn with the darker edge, and each key is a square like them", () => {
    // Guards against a waffle drawn in one tone (no darker outlines) with a round legend key beside
    // square data points. Read off the drawing: the cell squares, and the key block of each legend row.
    const plot = { ...pie.plot, pieDisplay: "waffle" } as Plot;
    const scene = buildPlotScene(pie.table, plot, { width: 580, height: 380 });
    const { container } = render(<PlotFigure scene={scene} />);
    const sq = [...container.querySelectorAll("svg.gfx-figure rect")].filter((r) => r.querySelector("title") && r.getAttribute("fill") !== "transparent");
    expect(sq.length, "no waffle cells drawn").toBeGreaterThanOrEqual(90);
    const drawn = new Map(sq.map((r) => [r.getAttribute("fill"), r.getAttribute("stroke")]));
    scene.pie!.slices.forEach((s) => {
      expect(drawn.has(s.color), `${s.label}: no cell drawn in the tint ${s.color}`).toBe(true);
      expect(drawn.get(s.color), `${s.label}: cells have no darker edge`).toBe(s.strokeColor);
    });
    const rows = [...container.querySelectorAll("[data-mady-legend-row]")];
    rows.forEach((row, i) => {
      const e = scene.legend[i]!;
      const s = scene.pie!.slices.find((x) => x.id === e.select!.id)!;
      expect(row.querySelector("circle"), `${e.label}: the key is round`).toBeNull();
      const block = row.querySelector("rect.gfx-legbar");
      expect(block, `${e.label}: no square key`).not.toBeNull();
      expect(block!.getAttribute("fill"), `${e.label}: key fill`).toBe(s.color);
      expect(block!.getAttribute("stroke"), `${e.label}: key edge`).toBe(s.strokeColor);
    });
  });

  it("waffle: a plain (not two-tone) category has plain cells and a plain square key", () => {
    const plot = { ...pie.plot, pieDisplay: "waffle", seriesStyles: { ...(pie.plot.seriesStyles ?? {}), [rowIds[0]!]: { fillType: "solid" } } } as Plot;
    const scene = buildPlotScene(pie.table, plot, { width: 580, height: 380 });
    const c0 = scene.pie!.cells!.find((c) => c.id === rowIds[0])!;
    expect(c0.outline).toBeUndefined();
    const { container } = render(<PlotFigure scene={scene} />);
    const block = container.querySelectorAll("[data-mady-legend-row]")[0]!.querySelector("rect.gfx-legbar")!;
    expect(block.getAttribute("fill")).toBe(c0.color);
    expect(block.getAttribute("stroke")).toBe(c0.color);
  });

  it("a slice set back to a plain fill keeps a full-colour key; the others stay two-tone", () => {
    const plot = { ...pie.plot, seriesStyles: { ...(pie.plot.seriesStyles ?? {}), [rowIds[0]!]: { fillType: "solid" } } } as Plot;
    const scene = buildPlotScene(pie.table, plot, { width: 580, height: 380 });
    const { container } = render(<PlotFigure scene={scene} />);
    const k = keys(container);
    const s0 = scene.pie!.slices[0]!;
    expect(s0.strokeColor).toBeNull();
    expect(k[0]!.tag).toBe("path");
    expect(k[0]!.fill).toBe(s0.color);
    expect(k[0]!.stroke).toBe(s0.color);
    expect(k[1]!.fill).toBe(scene.pie!.slices[1]!.color);
    expect(k[1]!.stroke).toBe(scene.pie!.slices[1]!.strokeColor);
  });
});

describe("waffle keys are square, like the cells", () => {
  it("each waffle key is as wide as it is tall", () => {
    const plot = { ...pie.plot, pieDisplay: "waffle" } as Plot;
    const scene = buildPlotScene(pie.table, plot, { width: 580, height: 380 });
    const { container } = render(<PlotFigure scene={scene} />);
    for (const k of container.querySelectorAll("[data-mady-legend-row] rect.gfx-legbar")) {
      expect(Number(k.getAttribute("width")), "the waffle key is not square").toBeCloseTo(Number(k.getAttribute("height")));
    }
    expect(container.querySelectorAll("[data-mady-legend-row] rect.gfx-legbar").length).toBe(scene.legend.length);
  });
});

describe("the label keeps its fixed gap past a wedge / square key", () => {
  for (const display of ["pie", "waffle"] as const) {
    it(`${display}: each label starts the legend's text gap past its key's right edge`, () => {
      const plot = { ...pie.plot, ...(display === "waffle" ? { pieDisplay: "waffle" } : {}) } as Plot;
      const scene = buildPlotScene(pie.table, plot, { width: 580, height: 380 });
      const { container } = render(<PlotFigure scene={scene} />);
      const fs = scene.fonts.legend.size;
      const gap = 6 * (fs / 13) * (scene.legendLayout.symbolScale ?? 1);
      for (const row of container.querySelectorAll("[data-mady-legend-row]")) {
        const k = row.querySelector(".gfx-legbar")!;
        const right = k.tagName.toLowerCase() === "rect"
          ? Number(k.getAttribute("x")) + Number(k.getAttribute("width"))
          : Math.max(...[...(k.getAttribute("d") ?? "").matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => Number(m[1])));
        const textX = Number(row.querySelector("text")!.getAttribute("x"));
        expect(textX - right, `${display}: label ${textX - right}px from its key`).toBeGreaterThanOrEqual(gap - 0.5);
        expect(textX - right, `${display}: label ${textX - right}px from its key`).toBeLessThanOrEqual(gap + 1);
      }
    });
  }
});
