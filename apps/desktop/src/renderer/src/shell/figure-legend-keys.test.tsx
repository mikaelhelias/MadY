// @vitest-environment jsdom
/**
 * A figure's one legend (Arrange ▸ One legend) draws each key as the graphs' own legends do: for bar charts, a block
 * in the bar's fill — not a line with a dot, which keys points the bars never draw.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { DataTable, Plot, Project } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { LayoutPane } from "./panes";
import { PlotFigure } from "./PlotFigure";

afterEach(cleanup);

const table: DataTable = {
  id: "t", kind: "grouped", name: "T",
  columns: [
    { id: "g", name: "Group", role: "x" },
    { id: "a", name: "Method A", role: "y", group: "a" }, { id: "a2", name: "Method A 2", role: "y", group: "a" },
    { id: "b", name: "Method B", role: "y", group: "b" }, { id: "b2", name: "Method B 2", role: "y", group: "b" },
  ],
  rows: [{ id: "r1", cells: { g: "One", a: 1, a2: 2, b: 3, b2: 4 } }, { id: "r2", cells: { g: "Two", a: 2, a2: 3, b: 4, b2: 5 } }],
};
const plot = (id: string): Plot => ({
  id, name: id, source: "t", status: "ok", styleOverrides: {}, kind: "bar",
  seriesStyles: { a: { color: "#01665e", fillColor: "#01665e" }, b: { color: "#bf812d", fillColor: "#bf812d" } },
}) as Plot;
const project: Project = {
  schemaVersion: 5, tables: [table], plots: [plot("A"), plot("B")], analyses: [], log: [],
  layouts: [{ id: "L", name: "Figure", panels: ["A", "B"], columns: 2, mergedLegend: true }],
  workspace: { folders: [], loose: [] },
};

describe("a figure's one legend, for bar charts", () => {
  it("the fixture's own graph legend keys its bars as blocks (what the figure legend must match)", () => {
    const { container } = render(<PlotFigure scene={buildPlotScene(table, plot("A"), { width: 400, height: 300 })} />);
    expect(container.querySelectorAll("rect.gfx-legbar").length).toBe(2);
  });

  it("keys each bar series as a block in that series' fill, with no line or dot", () => {
    const { container } = render(<LayoutPane project={project} layoutId="L" onRemovePanel={() => {}} onOpenPlot={() => {}} onSetLayoutOptions={() => {}} />);
    const legend = container.querySelector(".layfiglegend svg");
    expect(legend, "the figure did not draw its one legend").toBeTruthy();
    const blocks = [...legend!.querySelectorAll("rect.gfx-legbar")];
    expect(blocks.map((b) => b.getAttribute("fill"))).toEqual(["#01665e", "#bf812d"]);
    expect(legend!.querySelectorAll("line").length).toBe(0);
    expect(legend!.querySelectorAll("circle").length).toBe(0);
  });
});
