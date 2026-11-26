import { describe, expect, it } from "vitest";
import { MadyDocument } from "./document";
import { tableDatasets } from "./dataset";
import { deriveSplitCopy, isPositionKey, keepPositions, sameJson, splitRefusal } from "./splitCopies";
import type { Plot } from "./model";

/** A line graph over three series (A, B, C) — the smallest sheet that has something to split. */
function setup(kind: Plot["kind"] = "xy") {
  const doc = new MadyDocument();
  const table = doc.addTable("T", "xy", ["X", "A", "B", "C"]);
  doc.addRow(table.id, [1, 2, 20, 200]);
  doc.addRow(table.id, [2, 3, 30, 300]);
  const plot = doc.addPlot("Growth", table.id);
  if (kind !== "xy") doc.setPlotKind(plot.id, kind);
  const series = tableDatasets(doc.toJSON().tables[0]!).map((d) => d.id);
  const live = () => doc.toJSON().plots;
  const get = (id: string) => live().find((p) => p.id === id)!;
  return { doc, table, plot, series, get };
}

describe("small graphs: which settings are the copy's own", () => {
  it("every setting a drag writes counts as a position", () => {
    // What each on-graph drag writes (AppShell's onMove*/resize handlers and the document
    // methods they call). `split-drag-keys.test.ts` checks this list against AppShell itself.
    for (const k of [
      "titleOffset", "subtitleOffset", "legendOffset", "colorbarOffset", "waffleCaptionOffset", "fitLabelOffset",
      "fitsOffsets", "offset", "labelOffset", "nameOffset", "keyOffset", "labelOffsets", "rowLabelOffsets",
      "colLabelOffsets", "axisLabelOff", "groupLabelOffsets", "nodePositions", "sectionLabelOffsets", "nameOffsets",
      "zTitleOffset", "directLabelOffset", "valueDx", "valueDy", "refLineLabelOffsets", "valueLabelPos", "labelPos",
      "figureWidth", "figureHeight", "displayScale", "xAxisLength", "yAxisLength", "valueLabelDy", "legendLoose",
    ]) expect(isPositionKey(k), k).toBe(true);
  });

  it("style choices made in the Inspector are not positions", () => {
    for (const k of ["color", "legend", "legendPosition", "pieLabelPosition", "valuePlacement", "min", "max", "title", "hidden", "position", "lineWidth"]) {
      expect(isPositionKey(k), k).toBe(false);
    }
  });

  it("keeps the copy's positions, deep inside, and takes everything else from the original", () => {
    const made = { legendOffset: { dx: 0, dy: 0 }, color: "red", heatmap: { rowTracks: [{ nameOffset: { dx: 1, dy: 1 }, color: "blue" }] } };
    const own = { legendOffset: { dx: 9, dy: 9 }, color: "green", heatmap: { rowTracks: [{ nameOffset: { dx: 5, dy: 5 }, color: "pink" }] } };
    expect(keepPositions(made, own)).toEqual({
      legendOffset: { dx: 9, dy: 9 }, color: "red", heatmap: { rowTracks: [{ nameOffset: { dx: 5, dy: 5 }, color: "blue" }] },
    });
  });

  it("keeps a moved note (matched by id) but drops a note that exists only on the copy", () => {
    const made = { annotations: [{ id: "a1", kind: "text", label: "orig", x: 0.1, y: 0.1 }] };
    // The copy-only note comes first, so matching by list position would hand a1 its place.
    const own = { annotations: [{ id: "a2", kind: "text", label: "extra", x: 0, y: 0 }, { id: "a1", kind: "text", label: "edited", x: 0.7, y: 0.8 }] };
    expect(keepPositions(made, own)).toEqual({ annotations: [{ id: "a1", kind: "text", label: "orig", x: 0.7, y: 0.8 }] });
  });

  it("sameJson treats a missing key and an undefined one alike", () => {
    expect(sameJson({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(sameJson({ a: [1, 2] }, { a: [1, 3] })).toBe(false);
  });

  it("the copy shows only its series and carries the pinned range", () => {
    const { plot, series, get } = setup();
    const src = get(plot.id);
    const named = series.map((id, i) => ({ id, name: ["A", "B", "C"][i]! }));
    const copy = deriveSplitCopy(src, { ...src, id: "c", splitFrom: { plot: src.id, series: series[1]! } }, named, { y: [0, 400] });
    expect(copy.title, "a small graph is titled with its series").toBe("B");
    expect(series.map((s) => copy.seriesStyles?.[s]?.hidden ?? false)).toEqual([true, false, true]);
    expect([copy.yAxis?.min, copy.yAxis?.max]).toEqual([0, 400]);
  });

  it("refuses kinds and graphs that have nothing to split, with the reason", () => {
    const { plot, get } = setup();
    expect(splitRefusal(get(plot.id), 3)).toBeNull();
    expect(splitRefusal(get(plot.id), 1)).toMatch(/only one series/);
    expect(splitRefusal({ ...get(plot.id), kind: "pie" }, 3)).toMatch(/can be split/);
    expect(splitRefusal({ ...get(plot.id), splitFrom: { plot: "p", series: "s" } }, 3)).toMatch(/already/);
  });
});

describe("small graphs: the document", () => {
  it("one command makes a copy per series and a figure page; one undo removes them all", () => {
    const { doc, plot, series } = setup();
    const before = doc.toJSON();
    const { layout, plots } = doc.splitIntoSmallGraphs(plot.id);
    expect(plots.map((p) => p.splitFrom?.series)).toEqual(series);
    expect(plots.map((p) => p.name)).toEqual(["Growth · A", "Growth · B", "Growth · C"]);
    const after = doc.toJSON();
    expect(after.layouts?.find((l) => l.id === layout.id)?.panels).toEqual(plots.map((p) => p.id));
    expect(after.workspace.loose.filter((r) => r.kind === "plot").length).toBe(4);
    doc.commands.undo();
    expect(doc.toJSON().plots).toEqual(before.plots);
    expect(doc.toJSON().layouts ?? []).toEqual(before.layouts ?? []);
  });

  it("a change to the original reaches every copy; undoing it takes it back", () => {
    const { doc, plot, series, get } = setup();
    const { plots } = doc.splitIntoSmallGraphs(plot.id);
    doc.syncSplitCopies();
    doc.setPlotAxis(plot.id, "y", { title: "Weight (g)" });
    expect(doc.syncSplitCopies()).toEqual([]);
    for (const p of plots) expect(get(p.id).yAxis?.title).toBe("Weight (g)");
    doc.setSeriesStyle(plot.id, series[0]!, { color: "#ff0000" });
    doc.syncSplitCopies();
    expect(get(plots[0]!.id).seriesStyles?.[series[0]!]?.color).toBe("#ff0000");
    expect(get(plots[0]!.id).seriesStyles?.[series[0]!]?.hidden).toBeUndefined();
    doc.commands.undo();
    doc.commands.undo();
    expect(doc.syncSplitCopies()).toEqual([]);
    for (const p of plots) expect(get(p.id).yAxis?.title).toBeUndefined();
  });

  it("a position moved on a copy stays, even when the original then changes", () => {
    const { doc, plot, get } = setup();
    const { plots } = doc.splitIntoSmallGraphs(plot.id);
    doc.syncSplitCopies();
    const c = plots[1]!.id;
    doc.setLegendOffset(c, 40, 12);
    doc.setTitleOffset(c, 5, 6);
    doc.resizeFigure(c, { figureWidth: 333 });
    expect(doc.syncSplitCopies()).toEqual([]);
    doc.setPlotAxis(plot.id, "x", { title: "Day" });
    doc.setLegendOffset(plot.id, 1, 1);
    expect(doc.syncSplitCopies()).toEqual([]);
    const copy = get(c);
    expect(copy.legendOffset).toEqual({ dx: 40, dy: 12 });
    expect(copy.titleOffset).toEqual({ dx: 5, dy: 6 });
    expect(copy.figureWidth).toBe(333);
    expect(copy.xAxis?.title).toBe("Day");
  });

  it("any other edit on a copy is undone with a message naming the original", () => {
    const { doc, plot, series, get } = setup();
    const { plots } = doc.splitIntoSmallGraphs(plot.id);
    doc.syncSplitCopies();
    const c = plots[0]!.id;
    doc.setSeriesStyle(c, series[0]!, { color: "#00ff00" });
    const msgs = doc.syncSplitCopies();
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatch(/"Growth · A" is a small graph made from "Growth"/);
    expect(get(c).seriesStyles?.[series[0]!]?.color).toBeUndefined();
  });

  it("a note added on a copy is refused, a note moved on a copy is kept", () => {
    const { doc, plot, get } = setup();
    const note = doc.addAnnotation(plot.id, { kind: "text", label: "hi", x: 0.2, y: 0.2 });
    const { plots } = doc.splitIntoSmallGraphs(plot.id);
    doc.syncSplitCopies();
    const c = plots[2]!.id;
    doc.moveAnnotation(c, note.id, { x: 0.6, y: 0.7 });
    expect(doc.syncSplitCopies()).toEqual([]);
    expect(get(c).annotations?.[0]).toMatchObject({ x: 0.6, y: 0.7, label: "hi" });
    doc.addAnnotation(c, { kind: "text", label: "mine", x: 0.5, y: 0.5 });
    expect(doc.syncSplitCopies()).toHaveLength(1);
    expect(get(c).annotations).toHaveLength(1);
  });

  it("detach makes an ordinary graph; undoing the detach re-links it without a refusal", () => {
    const { doc, plot, series, get } = setup();
    const { plots } = doc.splitIntoSmallGraphs(plot.id);
    doc.syncSplitCopies();
    const c = plots[0]!.id;
    doc.detachSmallGraph(c);
    doc.setSeriesStyle(c, series[0]!, { color: "#123456" });
    expect(doc.syncSplitCopies()).toEqual([]);
    expect(get(c).seriesStyles?.[series[0]!]?.color).toBe("#123456");
    doc.commands.undo(); // the colour
    doc.commands.undo(); // the detach
    expect(doc.syncSplitCopies()).toEqual([]);
    expect(get(c).splitFrom).toBeDefined();
    expect(() => doc.detachSmallGraph(plot.id)).toThrow(/not a small graph/);
  });

  it("the pinned range comes from the caller and reaches every copy", () => {
    const { doc, plot, get } = setup();
    const { plots } = doc.splitIntoSmallGraphs(plot.id, { y: [0, 350] });
    doc.syncSplitCopies(() => ({ y: [0, 350] }));
    for (const p of plots) expect([get(p.id).yAxis?.min, get(p.id).yAxis?.max]).toEqual([0, 350]);
  });

  /** Every document call an on-graph drag makes (AppShell's onMove… and resize handlers). The app
   *  test `split-drag-keys.test.ts` checks AppShell's handlers use only these, or write a
   *  position-named setting through setPlotOptions / setPlotAxis / setPointStyle / setSeriesStyle. */
  const DRAG_CALLS: Record<string, (doc: MadyDocument, id: string, series: string[], row: string) => void> = {
    setTitleOffset: (d, id) => d.setTitleOffset(id, 3, 4),
    setLegendOffset: (d, id) => d.setLegendOffset(id, 3, 4),
    setAxisTitleOffset: (d, id) => d.setAxisTitleOffset(id, "y", 3, 4),
    moveRefLineLabel: (d, id) => d.moveRefLineLabel(id, "identity", 3, 4),
    resizeFigure: (d, id) => d.resizeFigure(id, { figureWidth: 410, figureHeight: 300 }),
    scaleFigure: (d, id) => d.scaleFigure(id, 1.3),
    setAxisLength: (d, id) => d.setAxisLength(id, "x", 250),
    setPointStyle: (d, id, s, row) => d.setPointStyle(id, s[0]!, row, { valueDx: 5, valueDy: 6 }),
    setSeriesStyle: (d, id, s) => d.setSeriesStyle(id, s[0]!, { directLabelOffset: { dx: 5, dy: 6 } }),
  };

  it.each(Object.keys(DRAG_CALLS))("a drag on a small graph (%s) is kept, not refused", (name) => {
    const { doc, plot, series, get } = setup();
    const { plots } = doc.splitIntoSmallGraphs(plot.id);
    doc.syncSplitCopies();
    const c = plots[0]!.id;
    const before = JSON.stringify(get(c));
    const row = doc.toJSON().tables[0]!.rows[0]!.id;
    DRAG_CALLS[name]!(doc, c, series, row);
    const moved = JSON.stringify(get(c));
    expect(moved, "the drag changed nothing — this row proves nothing").not.toBe(before);
    expect(doc.syncSplitCopies()).toEqual([]);
    expect(JSON.stringify(get(c))).toBe(moved);
  });

  it("a legend row pulled out on a small graph stays where it was dropped (legendLoose is a place)", () => {
    const { doc, plot, get } = setup();
    const { plots } = doc.splitIntoSmallGraphs(plot.id);
    doc.syncSplitCopies();
    const c = plots[0]!.id;
    doc.setPlotOptions(c, { legendLoose: { A: { x: 40, y: 50 } } });
    expect(doc.syncSplitCopies()).toEqual([]);
    expect(get(c).legendLoose).toEqual({ A: { x: 40, y: 50 } });
  });

  it("refuses to split a pie chart, saying why", () => {
    const { doc, plot } = setup("pie");
    expect(() => doc.splitIntoSmallGraphs(plot.id)).toThrow(/can be split/);
  });

  it("a deleted original leaves its copies as they are, and editable", () => {
    const { doc, plot, series, get } = setup();
    const { plots } = doc.splitIntoSmallGraphs(plot.id);
    doc.syncSplitCopies();
    doc.removePlot(plot.id);
    doc.setSeriesStyle(plots[0]!.id, series[0]!, { color: "#abcdef" });
    expect(doc.syncSplitCopies()).toEqual([]);
    expect(get(plots[0]!.id).seriesStyles?.[series[0]!]?.color).toBe("#abcdef");
  });
});
