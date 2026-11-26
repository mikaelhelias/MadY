// @vitest-environment jsdom
/**
 * Texts that used to stay put now drag on their own (every text on a graph drags): a Venn region's count, an
 * oncoprint gene's percentage, a treemap cell's value (it moves with its cell's name: they share one offset) and a
 * chord diagram's node name. Each drag reaches the document, is stored, and is drawn where it was dropped. A chord
 * name also renames on double-click, editing the data it was read from.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import { galleryItems } from "./gallery";
import { chordLabelMove, chordRename } from "./chordLabels";
import { oncoprintLabelMove, oncoprintRename } from "./oncoprintLabels";

afterEach(cleanup);

const SIZE = { width: 640, height: 480 };
const card = (title: string) => {
  const g = galleryItems().find((x) => x.title === title);
  if (!g) throw new Error(`no gallery card "${title}"`);
  return { table: g.table, plot: g.plot as Plot };
};

/** Drag the drawn text that reads `words` by (+20, +10) and return the props' calls. */
function drag(plot: Plot, table: ReturnType<typeof card>["table"], words: string, props: Record<string, ReturnType<typeof vi.fn>>) {
  const { container } = render(<PlotFigure scene={buildPlotScene(table, plot, SIZE)} {...props} />);
  const text = [...container.querySelectorAll("text")].find((t) => (t.textContent ?? "").trim() === words);
  expect(text, `no drawn text "${words}"`).toBeTruthy();
  const grp = text!.parentElement as unknown as SVGGElement;
  fireEvent.pointerDown(grp, { clientX: 100, clientY: 100, pointerId: 1 });
  fireEvent.pointerMove(grp, { clientX: 120, clientY: 110, pointerId: 1 });
  fireEvent.pointerUp(grp, { clientX: 120, clientY: 110, pointerId: 1 });
  return container;
}

describe("Venn region counts", () => {
  it("drag, keyed by the region's sets, and are drawn where dropped", () => {
    const { table, plot } = card("Venn diagram");
    const zone = buildPlotScene(table, plot, SIZE).venn!.zones.find((z) => z.key.length === 2 && z.text !== "")!;
    const onMoveVennCount = vi.fn();
    drag(plot, table, zone.text, { onMoveVennCount });
    expect(onMoveVennCount.mock.calls[0]).toEqual([zone.setKey, 20, 10]);
    expect(zone.setKey.split("+")).toHaveLength(2);
    const moved = { ...plot, venn: { ...(plot.venn ?? {}), countOffsets: { [zone.setKey]: { dx: 20, dy: 10 } } } };
    expect(buildPlotScene(table, moved, SIZE).venn!.zones.find((z) => z.setKey === zone.setKey)!.countOff).toEqual({ dx: 20, dy: 10 });
  });
});

describe("oncoprint percentages", () => {
  it("drag, keyed by gene; a gene rename carries the percentage's place", () => {
    const { table, plot } = card("Oncoprint");
    const pct = buildPlotScene(table, plot, SIZE).oncoprint!.percentLabels[0]!;
    const onMoveOncoprintLabel = vi.fn();
    drag(plot, table, pct.text, { onMoveOncoprintLabel });
    expect(onMoveOncoprintLabel.mock.calls[0]).toEqual(["percent", pct.gene, 20, 10]);
    const moved = { ...plot, ...oncoprintLabelMove(plot.oncoprint, "percent", pct.gene, 20, 10) } as Plot;
    expect(buildPlotScene(table, moved, SIZE).oncoprint!.percentLabels.find((p) => p.gene === pct.gene)!.off).toEqual({ dx: 20, dy: 10 });
    const renamed = oncoprintRename(table, moved.oncoprint, "gene", pct.gene, "NEWGENE");
    expect(renamed.patch?.oncoprint?.percentLabelOffsets).toEqual({ NEWGENE: { dx: 20, dy: 10 } });
  });
});

describe("treemap values", () => {
  it("drag with their cell's name", () => {
    const { table, plot } = card("Treemap");
    const cell = buildPlotScene(table, plot, SIZE).treemap!.cells.find((c) => c.valueLabel)!;
    const onMoveValueLabel = vi.fn();
    drag(plot, table, cell.valueLabel!, { onMoveValueLabel });
    expect(onMoveValueLabel.mock.calls[0]).toEqual([cell.id, cell.id, 20, 10]);
  });
});

describe("parallel-coordinates axis names", () => {
  it("rename on double-click (the name is its column's)", () => {
    const { table, plot } = card("Parallel coordinates");
    const ax = buildPlotScene(table, plot, SIZE).parallel!.axes.find((a) => a.colId)!;
    const { container } = render(<PlotFigure scene={buildPlotScene(table, plot, SIZE)} onEditText={vi.fn()} onParallelEdit={vi.fn()} />);
    const text = [...container.querySelectorAll("text")].find((t) => (t.textContent ?? "").trim() === ax.label)!;
    expect(text, "fixture: the axis name is drawn").toBeTruthy();
    fireEvent.doubleClick(text);
    expect(container.querySelector("input, textarea"), "double-click opened no editor").toBeTruthy();
  });
});

describe("the footer", () => {
  it("each text drags, is drawn where dropped, and edits on double-click", () => {
    const { table, plot: base } = card("XY (points + fitted curve)");
    const plot = { ...base, footer: { left: "Source: lab", right: "Fig. 1" } } as Plot;
    const onMoveFooter = vi.fn();
    drag(plot, table, "Fig. 1", { onMoveFooter });
    expect(onMoveFooter.mock.calls[0]).toEqual(["right", 20, 10]);
    cleanup();
    const moved = { ...plot, footerOffsets: { right: { dx: 20, dy: 10 } } };
    expect(buildPlotScene(table, moved, SIZE).footer!.rightOff).toEqual({ dx: 20, dy: 10 });
    const { container } = render(<PlotFigure scene={buildPlotScene(table, plot, SIZE)} onEditText={vi.fn()} />);
    fireEvent.doubleClick([...container.querySelectorAll("text")].find((t) => (t.textContent ?? "").trim() === "Source: lab")!);
    expect(container.querySelector("input, textarea"), "double-click opened no editor").toBeTruthy();
  });
});

describe("chord node names", () => {
  it("drag, keyed by the name, and are drawn where dropped", () => {
    const { table, plot } = card("Chord / circos");
    const arc = buildPlotScene(table, plot, SIZE).chord!.arcs.find((a) => a.showLabel)!;
    const onMoveChordLabel = vi.fn();
    drag(plot, table, arc.name, { onMoveChordLabel });
    expect(onMoveChordLabel.mock.calls[0]).toEqual([arc.name, 20, 10]);
    const moved = { ...plot, ...chordLabelMove(plot.chord, arc.name, 20, 10) } as Plot;
    expect(buildPlotScene(table, moved, SIZE).chord!.arcs.find((a) => a.name === arc.name)!.labelOff).toEqual({ dx: 20, dy: 10 });
  });

  it("rename on double-click edits the data the name was read from, and keeps its place and colour", () => {
    const { table, plot } = card("Chord / circos");
    const scene = buildPlotScene(table, plot, SIZE);
    const arc = scene.chord!.arcs.find((a) => a.showLabel)!;
    const onEditText = vi.fn();
    const { container } = render(<PlotFigure scene={scene} onEditText={onEditText} />);
    const text = [...container.querySelectorAll("text")].find((t) => (t.textContent ?? "").trim() === arc.name)!;
    fireEvent.doubleClick(text);
    expect(container.querySelector("input, textarea"), "double-click opened no editor").toBeTruthy();
    const styled = { ...plot, seriesStyles: { ...(plot.seriesStyles ?? {}), [arc.name]: { color: "#123456" } }, ...chordLabelMove(plot.chord, arc.name, 5, 5) } as Plot;
    const r = chordRename(table, styled, scene.chord!.names, arc.name, "Renamed");
    const holders = scene.chord!.names.cellColumns.flatMap((c) => table.rows.filter((row) => String(row.cells[c] ?? "").trim() === arc.name));
    expect(r.cells.length + r.columns.length, "the rename edits nothing").toBeGreaterThan(0);
    expect(r.cells.length).toBe(holders.length);
    expect(r.patch?.chord?.labelOffsets).toEqual({ Renamed: { dx: 5, dy: 5 } });
    expect(r.patch?.seriesStyles?.["Renamed"]?.color).toBe("#123456");
  });
});
