/**
 * `setPlotOptions` and `setSeriesStyle` take an optional coalesce tag: the calls of one drag merge into one undo entry
 * that goes back to the state before the drag. Without a tag every call stays its own step.
 */
import { describe, expect, it } from "vitest";
import { MadyDocument } from "./document.js";

function doc2() {
  const doc = new MadyDocument();
  const t = doc.addTable("T", "column", ["A", "B"], ["y", "y"]);
  const p = doc.addPlot("P", t.id);
  doc.commands.clear();
  const plot = () => doc.toJSON().plots.find((x) => x.id === p.id)!;
  const steps = () => { let n = 0; while (doc.commands.canUndo) { doc.commands.undo(); n++; } return n; };
  return { doc, id: p.id, plot, steps, a: t.columns[0]!.id, b: t.columns[1]!.id };
}

describe("setPlotOptions coalesce tag", () => {
  it("tagged: three calls are one step, undone to the value before the first", () => {
    const { doc, id, plot, steps } = doc2();
    for (const w of [0.5, 0.4, 0.3]) doc.setPlotOptions(id, { barWidth: w }, "drag");
    expect(plot().barWidth).toBe(0.3);
    expect(steps()).toBe(1);
    expect(plot().barWidth).toBeUndefined();
  });
  it("untagged: every call is its own step", () => {
    const { doc, id, steps } = doc2();
    for (const w of [0.5, 0.4, 0.3]) doc.setPlotOptions(id, { barWidth: w });
    expect(steps()).toBe(3);
  });
  it("a different tag starts a new step", () => {
    const { doc, id, steps } = doc2();
    doc.setPlotOptions(id, { barWidth: 0.5 }, "one");
    doc.setPlotOptions(id, { barWidth: 0.4 }, "two");
    expect(steps()).toBe(2);
  });
  it("redo replays the last value of the merged step", () => {
    const { doc, id, plot } = doc2();
    for (const w of [0.5, 0.4, 0.3]) doc.setPlotOptions(id, { barWidth: w }, "drag");
    doc.commands.undo();
    doc.commands.redo();
    expect(plot().barWidth).toBe(0.3);
  });
});

describe("setSeriesStyle coalesce tag", () => {
  it("tagged: three calls on one series are one step, undone to no style at all", () => {
    const { doc, id, plot, steps, a } = doc2();
    for (const w of [0.9, 0.8, 0.7]) doc.setSeriesStyle(id, a, { barWidth: w }, "drag");
    expect(plot().seriesStyles?.[a]?.barWidth).toBe(0.7);
    expect(steps()).toBe(1);
    expect(plot().seriesStyles).toBeUndefined();
  });
  it("the same tag on another series is another step", () => {
    const { doc, id, steps, a, b } = doc2();
    doc.setSeriesStyle(id, a, { barWidth: 0.9 }, "drag");
    doc.setSeriesStyle(id, b, { barWidth: 0.9 }, "drag");
    expect(steps()).toBe(2);
  });
  it("untagged: every call is its own step", () => {
    const { doc, id, steps, a } = doc2();
    for (const w of [0.9, 0.8, 0.7]) doc.setSeriesStyle(id, a, { barWidth: w });
    expect(steps()).toBe(3);
  });
});
