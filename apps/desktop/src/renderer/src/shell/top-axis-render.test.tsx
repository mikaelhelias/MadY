// @vitest-environment jsdom
// The top (second) value axis of a horizontal bar — what the figure actually draws.
//
// The scene can say `y2.side = "top"`; that only matters if the renderer draws the axis line
// along the plot's top edge, its tick numbers above the plot and its title unrotated above them —
// not a rotated title on the right, where a vertical chart's second axis goes.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import type { DataTable, Plot, SeriesStyle } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";

const SIZE = { width: 640, height: 460 };
const t3: DataTable = {
  id: "t3", kind: "column", name: "T3",
  columns: [
    { id: "g", name: "Group", role: "x" },
    { id: "bar", name: "Sales", role: "y" },
    { id: "line", name: "Trend", role: "y" },
  ],
  rows: [
    { id: "r1", cells: { g: "A", bar: 2, line: 300 } },
    { id: "r2", cells: { g: "B", bar: 6, line: 500 } },
    { id: "r3", cells: { g: "C", bar: 10, line: 400 } },
  ],
};
const barPlot = (styles: Record<string, SeriesStyle>, over: Partial<Plot> = {}): Plot =>
  ({ id: "p", name: "P", source: "t3", kind: "bar", seriesStyles: styles, ...over }) as Plot;

function draw(p: Plot) {
  const scene = buildPlotScene(t3, p, SIZE);
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(createElement(PlotFigure, { scene }));
  const num = (el: Element, a: string): number => Number(el.getAttribute(a));
  const texts = [...host.querySelectorAll("svg text")];
  /** The y an unrotated text is drawn at: its own `y`, else the translate() of its transform. */
  const textY = (el: Element): number => {
    if (el.hasAttribute("y")) return num(el, "y");
    const m = /translate\(\s*[-\d.]+[ ,]\s*([-\d.]+)\)/.exec(el.getAttribute("transform") ?? "");
    return m ? Number(m[1]) : NaN;
  };
  return { scene, host, num, texts, textY };
}

describe("the top second axis of a horizontal bar — drawn on the figure", () => {
  const horizontal = barPlot({ line: { plotAs: "line", axis: "y2" } }, { barOrientation: "horizontal" });

  it("an axis line runs along the plot's top edge", () => {
    const { scene, host, num } = draw(horizontal);
    const { x, y, width } = scene.plot;
    // Note: axis lines only (square line caps). Counting every full-height line on the right edge
    // would catch the gridline of the last value tick (stroke var(--line), width 1) — a
    // measurement fault, not a drawn axis. The vertical case below proves this filter still finds one.
    const axisLines = [...host.querySelectorAll("svg line")].filter((l) => l.getAttribute("stroke-linecap") === "square");
    const top = axisLines.filter((l) =>
      Math.abs(num(l, "y1") - y) < 0.01 && Math.abs(num(l, "y2") - y) < 0.01 &&
      Math.abs(num(l, "x1") - x) < 0.01 && Math.abs(num(l, "x2") - (x + width)) < 0.01);
    expect(top.length, "no axis line along the top edge of the plot").toBeGreaterThan(0);
    // and no second axis line down the right edge
    const right = axisLines.filter((l) =>
      Math.abs(num(l, "x1") - (x + width)) < 0.01 && Math.abs(num(l, "x2") - (x + width)) < 0.01 && Math.abs(num(l, "y2") - num(l, "y1")) > 10);
    expect(right, `a right-hand axis line was drawn as well: ${right.map((l) => l.outerHTML).join(" | ")}`).toHaveLength(0);
  });

  it("its tick numbers sit above the plot", () => {
    const { scene, texts, textY } = draw(horizontal);
    const labels = new Set(scene.y2!.ticks.filter((t) => !t.minor && t.label).map((t) => t.label));
    const above = texts.filter((t) => labels.has((t.textContent ?? "").trim()) && textY(t) < scene.plot.y);
    expect(above.length, "no second-axis tick number drawn above the plot").toBeGreaterThanOrEqual(Math.min(2, labels.size));
  });

  it("its title reads horizontally above the plot, not rotated on the right", () => {
    const { scene, texts, textY } = draw(horizontal);
    const title = texts.find((t) => (t.textContent ?? "").trim() === "Trend" && textY(t) < scene.plot.y);
    expect(title, "no 'Trend' title above the plot").toBeDefined();
    expect(title!.getAttribute("transform") ?? "").not.toMatch(/rotate/);
  });

  it("a vertical bar's second axis keeps its rotated title on the right", () => {
    const { scene, texts, host, num } = draw(barPlot({ line: { plotAs: "line", axis: "y2" } }));
    // The square-cap axis-line filter the horizontal check relies on does find a real right axis here.
    const { x, width } = scene.plot;
    const rightAxis = [...host.querySelectorAll("svg line")].filter((l) => l.getAttribute("stroke-linecap") === "square"
      && Math.abs(num(l, "x1") - (x + width)) < 0.01 && Math.abs(num(l, "x2") - (x + width)) < 0.01 && Math.abs(num(l, "y2") - num(l, "y1")) > 10);
    expect(rightAxis.length, "the axis-line filter finds no right axis — the horizontal check would pass vacuously").toBeGreaterThan(0);
    // Rotated in either spelling: `translate(x y) rotate(90)` or `rotate(90 x y)` — the draggable
    // title rotates about its own anchor, as the main Y title does. Same geometry; a pattern matching
    // only the first spelling would read a rotated title as "not rotated".
    const title = texts.find((t) => (t.textContent ?? "").trim() === "Trend" && /rotate\(90[\s)]/.test(t.getAttribute("transform") ?? ""));
    expect(title, "the right axis title is not rotated").toBeDefined();
    expect(scene.y2!.side ?? "right").not.toBe("top");
  });
});
