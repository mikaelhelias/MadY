// @vitest-environment jsdom
/**
 * The line from a name to its point (time-course card): the leader the builder draws between "Treated" and LOD
 * when it has to move the series name "Treated" away from its last point. Guards against the leader ignoring
 * clicks, and against dragging the name moving both ends and pulling the line off the point it names: its point
 * end stays on the point, and a click selects its series.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import { galleryItems, galleryLookup } from "./gallery";

afterEach(cleanup);

const tc = () => {
  const g = galleryItems().find((x) => x.title === "Time course + bands, window, limit");
  if (!g) throw new Error("no time-course card");
  return { table: g.table as DataTable, plot: g.plot as Plot, lk: galleryLookup(g) };
};
const sceneOf = (plot: Plot) => { const c = tc(); return buildPlotScene(c.table, plot, { width: c.plot.figureWidth ?? 700, height: c.plot.figureHeight ?? 440, tables: c.lk }); };

describe("the leader from a direct label to its point", () => {
  it("clicking it selects the series it belongs to", () => {
    const scene = sceneOf(tc().plot);
    const s = scene.series.find((x) => x.directLabel?.leader);
    expect(s, "the card draws no leader — this proves nothing").toBeDefined();
    const onSelect = vi.fn();
    const { container } = render(<PlotFigure scene={scene} selected={null} onSelect={onSelect} />);
    const hit = container.querySelector(`line[data-leader-hit="${s!.id}"]`);
    expect(hit, "the leader has no click target").not.toBeNull();
    fireEvent.click(hit!);
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "series", columnId: s!.id, part: "line" });
  });

  it("dragging the name moves only the NAME's end — the point end stays on the point", () => {
    const base = sceneOf(tc().plot);
    const s = base.series.find((x) => x.directLabel?.leader)!;
    const lead = s.directLabel!.leader!;
    const plot = { ...tc().plot, seriesStyles: { ...tc().plot.seriesStyles, [s.id]: { ...(tc().plot.seriesStyles?.[s.id] ?? {}), directLabelOffset: { dx: 40, dy: -25 } } } } as Plot;
    const scene = sceneOf(plot);
    const moved = scene.series.find((x) => x.id === s.id)!;
    expect(moved.directLabel?.offset, "the drag offset did not reach the scene — this proves nothing").toEqual({ dx: 40, dy: -25 });
    const { container } = render(<PlotFigure scene={scene} selected={null} />);
    const line = container.querySelector(`line[data-leader="${s.id}"]`)!;
    const l2 = moved.directLabel!.leader ?? lead;
    const n = (a: string) => Number(line.getAttribute(a));
    expect([n("x1"), n("y1")]).toEqual([l2.x1, l2.y1]);
    expect([n("x2"), n("y2")]).toEqual([l2.x2 + 40, l2.y2 - 25]);
  });
});

describe("the leader from a point's value label to its point (same rule)", () => {
  it("dragging the label moves only the label's end", () => {
    const g = galleryItems().find((x) => x.title === "Ranked dots vs a reference")!;
    const table = g.table as DataTable, lk = galleryLookup(g);
    const base = buildPlotScene(table, g.plot as Plot, { width: 640, height: 460, tables: lk });
    const s = base.series.find((x) => x.marks.some((m) => m.pointLabelLeader))!;
    expect(s, "no point label draws a leader — this proves nothing").toBeDefined();
    const m0 = s.marks.find((m) => m.pointLabelLeader)!;
    const key = `${s.id}:${m0.rowId}`;
    const pointStyles = { ...((g.plot as Plot).pointStyles ?? {}), [key]: { ...((g.plot as Plot).pointStyles?.[key] ?? {}), valueDx: 20, valueDy: 10 } };
    const scene = buildPlotScene(table, { ...(g.plot as Plot), pointStyles } as Plot, { width: 640, height: 460, tables: lk });
    const m = scene.series.find((x) => x.id === s.id)!.marks.find((x) => x.rowId === m0.rowId)!;
    expect(m.valueDx, "the drag offset did not reach the scene — this proves nothing").toBe(20);
    const { container } = render(<PlotFigure scene={scene} selected={null} />);
    const line = container.querySelector(`line[data-point-leader="${key}"]`);
    expect(line, "no leader drawn after the drag").not.toBeNull();
    const n = (a: string) => Number(line!.getAttribute(a));
    const ld = m.pointLabelLeader!;
    expect([n("x1"), n("y1")]).toEqual([ld.x1, ld.y1]);
    expect([n("x2"), n("y2")]).toEqual([ld.x2 + 20, ld.y2 + 10]);
  });
});
