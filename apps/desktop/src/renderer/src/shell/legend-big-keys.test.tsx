// @vitest-environment jsdom
/**
 * Legend keys made bigger (Legend > Symbol size) stay inside their own rows: the first one does not ride up into the
 * legend's heading. A key no taller than the font is centred, with its words, half a font height below its row's
 * top; a key scaled up past that still stays inside its row, clear of the heading above it.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { buildPlotScene } from "@mady/graphics";
import type { DataTable, Plot } from "@mady/core";
import { PlotFigure } from "./PlotFigure";

afterEach(cleanup);

const table: DataTable = {
  id: "t", kind: "xy", name: "T",
  columns: [{ id: "x", name: "X", role: "x" }, { id: "a", name: "Drug A", role: "y" }, { id: "b", name: "Drug B", role: "y" }, { id: "c", name: "Drug C", role: "y" }],
  rows: [[1, 2, 3, 4], [2, 3, 4, 5], [3, 5, 6, 7]].map((r, i) => ({ id: `r${i}`, cells: { x: r[0]!, a: r[1]!, b: r[2]!, c: r[3]! } })),
};
const plot = (symbolScale: number): Plot => ({
  id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "xy",
  legend: { position: "right", title: "Treatment", symbolScale },
  seriesStyles: Object.fromEntries(["a", "b", "c"].map((id) => [id, { symbolSize: 6.5, symbol: "circle" }])),
} as Plot);

/** The legend's heading, and its rows: each key's top and bottom and its words' y, in drawing order. */
function legendOf(symbolScale: number) {
  const scene = buildPlotScene(table, plot(symbolScale), { width: 700, height: 450 });
  const { container } = render(<PlotFigure scene={scene} />);
  const legend = container.querySelector("g.gfx-legend")!;
  const fs = scene.fonts.legend.size;
  const heading = [...legend.querySelectorAll("text")].find((t) => t.textContent === "Treatment")!;
  const keys = [...legend.querySelectorAll("circle")].filter((c) => c.getAttribute("fill") !== "transparent" && Number(c.getAttribute("r")) > 0);
  const words = ["Drug A", "Drug B", "Drug C"].map((w) => Number([...legend.querySelectorAll("text")].find((t) => t.textContent === w)!.getAttribute("y")));
  return {
    fs,
    headingBottom: Number(heading.getAttribute("y")) + fs * 0.5,
    keys: keys.map((c) => ({ cy: Number(c.getAttribute("cy")), top: Number(c.getAttribute("cy")) - Number(c.getAttribute("r")), bottom: Number(c.getAttribute("cy")) + Number(c.getAttribute("r")) })),
    words,
  };
}

describe("big legend keys", () => {
  it("the first key stays below the heading, and no two keys overlap", () => {
    const L = legendOf(2.2);
    expect(L.keys.length).toBe(3);
    expect(L.keys[0]!.top, "the first key reaches into the heading").toBeGreaterThanOrEqual(L.headingBottom);
    for (let i = 1; i < L.keys.length; i++) expect(L.keys[i]!.top).toBeGreaterThanOrEqual(L.keys[i - 1]!.bottom);
  });

  it("a key no taller than the font sits half a font height below its row's top", () => {
    // Keys no taller than half the font: each key centred half a font height below its row's top (the heading takes
    // 1.5 font heights, rounded; its centre 0.55 below the legend's top).
    const L = legendOf(1);
    const legendTop = L.headingBottom - L.fs * 0.5 - L.fs * 0.55;
    expect(L.keys[0]!.cy - (legendTop + Math.round(L.fs * 1.5))).toBeCloseTo(L.fs * 0.5, 5);
  });
});
