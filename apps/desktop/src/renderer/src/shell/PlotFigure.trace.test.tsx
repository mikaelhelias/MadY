// @vitest-environment jsdom
/**
 * Composite bars + line: the overlaid trace (a plotAs:"line" series) must render on
 * top of every bar, regardless of the line series' position among the bar series —
 * in overlay/diverging mode the bars are full-width and would otherwise hide it.
 * Guards the DOM paint order.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";

afterEach(cleanup);

// 3 series where the middle one (net) is the trace — a worst case for paint order.
const table: DataTable = {
  id: "t", kind: "column", name: "T",
  columns: [
    { id: "m", name: "Month", role: "x" },
    { id: "buy", name: "Purchases", role: "y" },
    { id: "net", name: "Net", role: "y" },
    { id: "sell", name: "Sales", role: "y" },
  ],
  rows: [
    { id: "r1", cells: { m: "Q1", buy: 52, net: 40, sell: -12 } },
    { id: "r2", cells: { m: "Q2", buy: 46, net: 4, sell: -42 } },
    { id: "r3", cells: { m: "Q3", buy: 33, net: 13, sell: -20 } },
  ],
};
const plot: Plot = {
  id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "bar",
  barLayout: "overlay",
  seriesStyles: { net: { plotAs: "line", color: "#1f3a5f" } },
};

describe("composite trace paints on top of the bars", () => {
  it("the overlay line path comes after every bar rect in DOM order (even though it is the middle series)", () => {
    const scene = buildPlotScene(table, plot, { width: 500, height: 320 });
    const { container } = render(<PlotFigure scene={scene} selected={null} />);
    // Note: scoped to the clipped series layer, where the bars and the trace are painted. A
    // proxy of "any filled rect in the svg" would count the legend's bar-key rect: the legend
    // renders after the plot, so its key would read as "the last bar" and the guard would fail
    // on correct output. This measures the same claim more precisely — the trace paints after
    // every rect that is actually a bar.
    const nodes = [...container.querySelectorAll("svg.gfx-figure g[clip-path] rect, svg.gfx-figure g[clip-path] path")];
    const lastBar = nodes.reduce((acc, el, i) => (el.tagName.toLowerCase() === "rect" && el.getAttribute("fill") && el.getAttribute("fill") !== "transparent" && el.getAttribute("fill") !== "none" ? i : acc), -1);
    // the visible trace stroke = the net colour
    const traceIdx = nodes.findIndex((el) => el.tagName.toLowerCase() === "path" && el.getAttribute("stroke") === "#1f3a5f");
    expect(traceIdx).toBeGreaterThan(-1);
    expect(lastBar).toBeGreaterThan(-1);
    expect(traceIdx).toBeGreaterThan(lastBar); // trace is painted after (on top of) the last bar
  });
});
