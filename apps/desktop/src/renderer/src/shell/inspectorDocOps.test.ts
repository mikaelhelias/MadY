/**
 * The Inspector's style handlers reach the open graph, each as one undoable step, and do nothing without a graph.
 */
import { describe, expect, it } from "vitest";
import { MadyDocument } from "@mady/core";
import type { Plot, Project } from "@mady/core";
import { inspectorDocOps } from "./inspectorDocOps";

function setup(open = true) {
  const project = {
    schemaVersion: 4, analyses: [], log: [], workspace: { folders: [], loose: [] },
    tables: [{ id: "t", kind: "xy", name: "T", columns: [{ id: "x", name: "X", role: "x" }, { id: "y", name: "Y", role: "y" }], rows: [{ id: "r0", cells: { x: 1, y: 2 } }] }],
    plots: [{ id: "p", name: "P", kind: "bar", source: "t", status: "ok", styleOverrides: {} }],
  } as unknown as Project;
  const doc = new MadyDocument(project);
  const ops = inspectorDocOps((fn) => fn(doc), () => (open ? "p" : undefined));
  const plot = (): Plot => doc.toJSON().plots[0]!;
  return { doc, ops, plot };
}

describe("inspectorDocOps", () => {
  it("each handler writes its field on the open graph as one undoable step", () => {
    const cases: [string, (o: ReturnType<typeof setup>["ops"]) => void, (p: Plot) => unknown, unknown][] = [
      ["setAxis", (o) => o.setAxis("y", { min: 3 }), (p) => p.yAxis?.min, 3],
      ["setAxisTitleFont", (o) => o.setAxisTitleFont("x", { size: 21 }), (p) => p.xAxis?.titleFont?.size, 21],
      ["setSeriesStyle", (o) => o.setSeriesStyle("y", { color: "#ff0000" }), (p) => p.seriesStyles?.["y"]?.color, "#ff0000"],
      ["setSeriesStyleAll", (o) => o.setSeriesStyleAll(["y"], { symbolSize: 9 }), (p) => p.seriesStyles?.["y"]?.symbolSize, 9],
      ["setPointStyle", (o) => o.setPointStyle("y", "r0", { color: "#00ff00" }), (p) => p.pointStyles?.["y:r0"]?.color, "#00ff00"],
      ["setGrid", (o) => o.setGrid({ show: true, width: 3 }), (p) => p.grid?.width, 3],
      ["setFrame", (o) => o.setFrame({ tickLen: 11 }), (p) => p.tickLen, 11],
      ["setBarLayout", (o) => o.setBarLayout("stacked"), (p) => p.barLayout, "stacked"],
      ["setBarShape", (o) => o.setBarShape("rounded"), (p) => p.barShape, "rounded"],
      ["setBoxWhisker", (o) => o.setBoxWhisker("minmax"), (p) => p.boxWhisker, "minmax"],
      ["setPlotOptions", (o) => o.setPlotOptions({ barWidth: 0.3 }), (p) => p.barWidth, 0.3],
      ["setPlotFont", (o) => o.setPlotFont("title", { size: 33 }), (p) => p.fonts?.title?.size, 33],
      ["setLegend", (o) => o.setLegend({ show: false }), (p) => p.legend?.show, false],
      ["setSignificance", (o) => o.setSignificance({ labelSize: 17 }), (p) => p.significance?.labelSize, 17],
    ];
    const wrong: string[] = [];
    for (const [name, call, read, want] of cases) {
      const { doc, ops, plot } = setup();
      const before = JSON.stringify(plot());
      call(ops);
      if (JSON.stringify(read(plot())) !== JSON.stringify(want)) wrong.push(`${name}: wrote ${JSON.stringify(read(plot()))}`);
      doc.commands.undo();
      if (JSON.stringify(plot()) !== before) wrong.push(`${name}: one Undo left ${JSON.stringify(plot()).slice(before.length - 1)}`);
    }
    expect(wrong).toEqual([]);
  });

  it("square bars are stored as no shape (the default), as the bar-shape picker means them", () => {
    const { ops, plot } = setup();
    ops.setBarShape("rounded");
    ops.setBarShape("square");
    expect(plot().barShape).toBeUndefined();
  });

  it("with no graph open nothing is written", () => {
    const { doc, ops, plot } = setup(false);
    const before = JSON.stringify(plot());
    ops.setPlotOptions({ barWidth: 0.3 });
    ops.setAxis("y", { min: 3 });
    expect(JSON.stringify(plot())).toBe(before);
    expect(doc.commands.canUndo).toBe(false);
  });
});
