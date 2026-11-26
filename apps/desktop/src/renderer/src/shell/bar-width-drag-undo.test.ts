// @vitest-environment node
/**
 * A bar chart's edge drag is one Undo step. The figure reports the new width on every pointer move; each report is
 * written to the document, and the whole drag must come back with one Undo, to the width from before the drag.
 */
import { describe, expect, it } from "vitest";
import { MadyDocument } from "@mady/core";
import { applyBarWidthDrag } from "./barWidth";

function barDoc() {
  const doc = new MadyDocument();
  const t = doc.addTable("T", "column", ["A", "B"], ["y", "y"]);
  const p = doc.addPlot("P", t.id);
  doc.setPlotOptions(p.id, { kind: "bar", barWidth: 0.6 });
  doc.commands.clear();
  const plot = () => doc.toJSON().plots.find((x) => x.id === p.id)!;
  const steps = () => { let n = 0; while (doc.commands.canUndo) { doc.commands.undo(); n++; } return n; };
  return { doc, plot, steps, a: t.columns[0]!.id, b: t.columns[1]!.id };
}
// six pointer moves, as a short drag reports them
const SHARES = [0.55, 0.5, 0.45, 0.4, 0.35, 0.3];

describe("a bar-edge drag is one Undo step", () => {
  it("whole graph: six moves, one step, back to the width before the drag", () => {
    const { doc, plot, steps } = barDoc();
    for (const s of SHARES) applyBarWidthDrag(doc, plot(), "x", s, true);
    expect(plot().barWidth).toBe(0.3);
    expect(steps()).toBe(1);
    expect(plot().barWidth).toBe(0.6);
  });

  it("one series: six moves, one step, and that series has no width of its own again", () => {
    const { doc, plot, steps, a } = barDoc();
    for (const s of SHARES) applyBarWidthDrag(doc, plot(), a, s, false);
    expect(plot().seriesStyles?.[a]?.barWidth).toBe(0.5);
    expect(steps()).toBe(1);
    expect(plot().seriesStyles?.[a]?.barWidth).toBeUndefined();
  });

  it("whole graph over series with their own widths: one step puts every own width back", () => {
    const { doc, plot, steps, a } = barDoc();
    doc.setSeriesStyle(plot().id, a, { barWidth: 0.7, color: "#f00" });
    doc.commands.clear();
    for (const s of SHARES) applyBarWidthDrag(doc, plot(), a, s, true);
    expect(plot().seriesStyles?.[a]).toEqual({ color: "#f00" });
    expect(steps()).toBe(1);
    expect(plot().seriesStyles?.[a]).toEqual({ barWidth: 0.7, color: "#f00" });
    expect(plot().barWidth).toBe(0.6);
  });

  it("a drag on one series, then on another: two steps", () => {
    const { doc, plot, steps, a, b } = barDoc();
    for (const s of SHARES) applyBarWidthDrag(doc, plot(), a, s, false);
    for (const s of SHARES) applyBarWidthDrag(doc, plot(), b, s, false);
    expect(steps()).toBe(2);
  });
});
