// @vitest-environment jsdom
/**
 * Text that sits on the data must not be cut when it is moved.
 *
 * A value number, a point's name and a series' direct label drawn inside the plot area's clip would
 * be cut at the plot edge when moved off the plot — before the figure's own edge came into it at all
 * (e.g. the UpSet counts, the volcano's gene names, the ranked-dots numbers and the time-course
 * direct labels). Dragged text must never be cut; the fit block is handled the same way.
 *
 * The rule, and why it is written on the resting position:
 *  - a label you can see (its resting spot is inside the clip) is drawn in the figure's text layer,
 *    outside the clip — so wherever you drag it, nothing cuts it;
 *  - a label whose point has been zoomed or panned out of view stays inside the clip, so it stays
 *    hidden instead of floating in the margin.
 * The test asks the resting spot, never the dragged one, because the answer must not change mid-drag:
 * crossing the boundary would re-parent the element and destroy the pointer capture the drag runs on
 * (switching on "pointer is down" would stop the UpSet count moving at all) — that is what the
 * `identity` test below pins down.
 *
 * Every label searched for here is text no axis could also print: searching for "10" or "1" would
 * find the Y and X ticks, and the cases would pass against the wrong element.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { buildPlotScene } from "@mady/graphics";
import type { DataTable, Plot } from "@mady/core";
import { PlotFigure } from "./PlotFigure";

afterEach(cleanup);

const xyTable: DataTable = {
  id: "t", kind: "xy", name: "T",
  columns: [
    { id: "x", name: "Dose", role: "x" },
    { id: "a", name: "Alpha", role: "y" },
    { id: "b", name: "Beta", role: "y" },
    { id: "g", name: "Gene", type: "text" },
  ],
  rows: [[1, 5, 6], [2, 20, 12], [3, 80, 40], [4, 95, 85]].map((r, i) => ({
    id: `r${i}`, cells: { x: r[0]!, a: r[1]!, b: r[2]!, g: ["IL6", "CXCL8", "TNF", "CCL2"][i]! },
  })),
};
const barTable: DataTable = {
  id: "t", kind: "column", name: "T",
  // One row per column: a bar's value label is the column's mean, so three rows would label 138.
  columns: [{ id: "a", name: "Control", role: "y" }, { id: "b", name: "Treated", role: "y" }],
  rows: [{ id: "r0", cells: { a: 137, b: 212 } }],
};
const SIZE = { width: 640, height: 460 };

const clippedAncestor = (el: Element): Element | null => {
  for (let p = el.parentElement; p; p = p.parentElement) if (p.hasAttribute("clip-path")) return p;
  return null;
};
const text = (c: HTMLElement, re: RegExp): SVGTextElement | undefined =>
  [...c.querySelectorAll("text")].find((t) => re.test((t.textContent ?? "").trim()));

describe("a value label is drawn where the plot cannot cut it", () => {
  const barPlot = (extra: Partial<Plot> = {}): Plot => ({
    id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "bar", showValues: true, ...extra,
  });

  it("is outside the clip, so dragging it off the plot cannot cut it", () => {
    const { container } = render(<PlotFigure scene={buildPlotScene(barTable, barPlot(), SIZE)} />);
    const label = text(container, /^137$/);
    expect(label, "the value label is drawn at all").toBeTruthy();
    expect(clippedAncestor(label!), "the value label is inside the plot's clip").toBeNull();
  });

  it("identity: it does not change parents when its offset takes it off the plot", () => {
    // Guards against re-parenting on the way out: it looks fine in a static render but breaks the
    // drag itself — React unmounts the old node, the pointer capture dies with it, and the label
    // stops following the cursor.
    const probe = buildPlotScene(barTable, barPlot(), SIZE);
    const s0 = probe.series[0]!;
    const key = `${s0.id}:${s0.marks[0]!.rowId}`;
    const at = render(<PlotFigure scene={probe} />);
    const restingParent = text(at.container, /^137$/)!.parentElement!.getAttribute("class");
    cleanup();
    const moved = buildPlotScene(barTable, barPlot({ pointStyles: { [key]: { valueDx: 400, valueDy: 300 } } }), SIZE);
    const { container } = render(<PlotFigure scene={moved} />);
    const label = text(container, /^137$/);
    expect(label, "the moved value label is drawn at all").toBeTruthy();
    expect(clippedAncestor(label!), "a moved value label is cut by the plot").toBeNull();
    expect(label!.parentElement!.getAttribute("class"), "the label changed layers when it moved").toBe(restingParent);
  });
});

describe("a point label is drawn where the plot cannot cut it — unless its point is out of view", () => {
  const xyPlot = (extra: Partial<Plot> = {}): Plot => ({
    id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "xy",
    seriesStyles: { a: { pointLabels: "col", pointLabelColumn: "g" } }, ...extra,
  });

  it("a visible point's label is outside the clip", () => {
    const { container } = render(<PlotFigure scene={buildPlotScene(xyTable, xyPlot(), SIZE)} />);
    const label = text(container, /^IL6$/);
    expect(label, "the point label is drawn at all").toBeTruthy();
    expect(clippedAncestor(label!), "the point label is inside the plot's clip").toBeNull();
  });

  it("a label whose resting spot is off the plot stays inside the clip, so it stays hidden", () => {
    // The fixture is not a zoomed-away point: the builder's placement rule pulls such a label back
    // over the plot (IL6 at cx = −328 is labelled at x = +67), so it is never culled and cannot
    // exercise the clip. What is culled is a label whose own resting spot lands outside the
    // clip — here a bar taller than the Y window, whose value sits above the plot.
    const plot: Plot = {
      id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "bar", showValues: true,
      yAxis: { min: 0, max: 40 },
    };
    const { container } = render(<PlotFigure scene={buildPlotScene(barTable, plot, SIZE)} />);
    const off = text(container, /^137$/);
    expect(off, "the off-plot label is still in the DOM (clipped, not deleted)").toBeTruthy();
    expect(clippedAncestor(off!), "a label resting off the plot was promoted into the margin").not.toBeNull();
  });
});

describe("a series' direct label is drawn where the plot cannot cut it", () => {
  it("is outside the clip", () => {
    const plot: Plot = {
      id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "xy",
      legend: { show: true, position: "direct" },
    };
    const { container } = render(<PlotFigure scene={buildPlotScene(xyTable, plot, SIZE)} />);
    const label = text(container, /^Alpha$/);
    expect(label, "the direct label is drawn at all").toBeTruthy();
    expect(clippedAncestor(label!), "the direct label is inside the plot's clip").toBeNull();
  });
});
