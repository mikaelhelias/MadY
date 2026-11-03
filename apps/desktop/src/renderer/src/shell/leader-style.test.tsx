// @vitest-environment jsdom
/**
 * Leader lines' own look. A leader is the line the builder draws from a moved name (or value label) back to its
 * point — on the time-course card, the line between "Treated" and the LOD. Clicking it selects its series, and a
 * "Leader line" group in that series' Data tab — Show, Colour, Width (`SeriesStyle.leaderShow / leaderColor /
 * leaderWidth`) — styles every leader the series draws: its name's and its value labels'. Unset, a leader draws in the
 * series colour at 0.75 px and 60 % opacity; a colour of its own draws at full strength.
 */
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { DataTable, Plot, SeriesStyle } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import { Inspector } from "./Inspector";
import { galleryItems, galleryLookup } from "./gallery";

afterEach(cleanup);
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

const card = (name: string) => {
  const g = galleryItems().find((x) => x.plot.name === name || x.plot.id === name);
  if (!g) throw new Error(`no card ${name}`);
  return { table: g.table as DataTable, plot: g.plot as Plot, lk: galleryLookup(g) };
};
const TIME = "Biomarker over 24 h"; // the "Treated" name has a leader
const RANKED = "Assay recovery by laboratory — target 78%"; // value-label leaders
const styled = (name: string, pick: (s: ReturnType<typeof buildPlotScene>) => string, st: SeriesStyle) => {
  const c = card(name);
  const base = buildPlotScene(c.table, c.plot, { width: 640, height: 480, tables: c.lk });
  const id = pick(base);
  const plot = { ...c.plot, seriesStyles: { ...c.plot.seriesStyles, [id]: { ...(c.plot.seriesStyles?.[id] ?? {}), ...st } } } as Plot;
  return { c, id, plot, base, scene: buildPlotScene(c.table, plot, { width: 640, height: 480, tables: c.lk }) };
};
const withName = (s: ReturnType<typeof buildPlotScene>) => s.series.find((x) => x.directLabel?.leader)!.id;
const withPointLeader = (s: ReturnType<typeof buildPlotScene>) => s.series.find((x) => x.marks.some((m) => m.pointLabelLeader))!.id;

describe("leader lines — the drawing", () => {
  it("unset: drawn in the series colour at 0.75 px and 60 % opacity", () => {
    const c = card(TIME);
    const { container } = render(<PlotFigure scene={buildPlotScene(c.table, c.plot, { width: 640, height: 480, tables: c.lk })} />);
    const ld = container.querySelector("line[data-leader]");
    expect(ld, "the card draws no name leader - this proves nothing").not.toBeNull();
    expect(ld!.getAttribute("stroke-width")).toBe("0.75");
    expect(ld!.getAttribute("opacity")).toBe("0.6");
  });

  it("a name's leader takes the series' colour and width; a colour of its own draws at full strength", () => {
    const { scene, id } = styled(TIME, withName, { leaderColor: "#ff0000", leaderWidth: 2 });
    const { container } = render(<PlotFigure scene={scene} />);
    const ld = container.querySelector(`line[data-leader="${id}"]`)!;
    expect(ld.getAttribute("stroke")).toBe("#ff0000");
    expect(ld.getAttribute("stroke-width")).toBe("2");
    expect(ld.getAttribute("opacity")).toBe("1");
  });

  it("value-label leaders take the same settings", () => {
    const { scene, id } = styled(RANKED, withPointLeader, { leaderColor: "#00aa00", leaderWidth: 1.5 });
    const { container } = render(<PlotFigure scene={scene} />);
    const lds = [...container.querySelectorAll(`line[data-point-leader^="${id}:"]`)];
    expect(lds.length, "the card draws no value-label leader - this proves nothing").toBeGreaterThan(0);
    for (const l of lds) {
      expect(l.getAttribute("stroke")).toBe("#00aa00");
      expect(l.getAttribute("stroke-width")).toBe("1.5");
    }
  });

  it("Show off: no leader and no click target, the name and labels stay", () => {
    const a = styled(TIME, withName, { leaderShow: false });
    expect(a.scene.series.find((s) => s.id === a.id)!.directLabel?.leader).toBeUndefined();
    expect(a.scene.series.find((s) => s.id === a.id)!.directLabel?.text).toBe(a.base.series.find((s) => s.id === a.id)!.directLabel?.text);
    const { container } = render(<PlotFigure scene={a.scene} onSelect={vi.fn()} />);
    expect(container.querySelector(`line[data-leader-hit="${a.id}"]`)).toBeNull();
    cleanup();
    const b = styled(RANKED, withPointLeader, { leaderShow: false });
    expect(b.scene.series.find((s) => s.id === b.id)!.marks.some((m) => m.pointLabelLeader)).toBe(false);
  });

  it("another series' leaders are not touched", () => {
    const { scene, base, id } = styled(TIME, withName, { leaderColor: "#ff0000" });
    for (const s of scene.series.filter((x) => x.id !== id)) expect(JSON.stringify(s)).toBe(JSON.stringify(base.series.find((b) => b.id === s.id)));
  });
});

describe("leader lines — the controls, in the series' Data tab", () => {
  const panel = (name: string, pick: (s: ReturnType<typeof buildPlotScene>) => string, part?: "line") => {
    const c = card(name);
    const id = pick(buildPlotScene(c.table, c.plot, { width: 640, height: 480, tables: c.lk }));
    const onSetSeriesStyle = vi.fn();
    const { container } = render(
      <Inspector {...({} as ComponentProps<typeof Inspector>)} activeSection="graphs" selection={{ kind: "series", columnId: id, ...(part ? { part } : {}) } as never}
        plot={c.plot} table={c.table} userPresets={[]} profileDefault={null} wholeGraph={false} onSetWholeGraph={() => {}} onSelect={vi.fn()}
        onSetSeriesStyle={onSetSeriesStyle} onSetSeriesStyleAll={vi.fn()} onSetPointStyle={vi.fn()} />,
    );
    return { container, onSetSeriesStyle, id };
  };
  // The group's box: its heading is a collapse toggle ("▾" + the name).
  const groupEl = (c: HTMLElement) => [...c.querySelectorAll(".inspgroup")].find((g) => (g.querySelector(".inspsub")?.textContent ?? "").endsWith("Leader line"));
  const group = (c: HTMLElement) => [...(groupEl(c)?.querySelectorAll("label.frow > span:first-child") ?? [])].map((s) => s.textContent);

  it("clicking a leader opens its series' line panel, and the group is there: Show, Colour, Width", () => {
    const { container } = panel(TIME, withName, "line");
    expect(group(container)).toEqual(["Show", "Colour", "Width"]);
  });

  it("each control writes its own field on the series", () => {
    const { container, onSetSeriesStyle, id } = panel(TIME, withName, "line");
    const rows = [...(groupEl(container)?.querySelectorAll("label.frow") ?? [])];
    const show = rows.find((r) => r.querySelector(":scope > span")?.textContent === "Show")!;
    fireEvent.click(show.querySelector("input")!);
    expect(onSetSeriesStyle).toHaveBeenLastCalledWith(id, expect.objectContaining({ leaderShow: false }));
    const width = rows.find((r) => r.querySelector(":scope > span")?.textContent === "Width")!;
    fireEvent.change(width.querySelector("input")!, { target: { value: "2.5" } });
    expect(onSetSeriesStyle).toHaveBeenLastCalledWith(id, expect.objectContaining({ leaderWidth: 2.5 }));
  });

  it("value-label leaders: the group is in that series' panel too", () => {
    expect(group(panel(RANKED, withPointLeader).container)).toEqual(["Show", "Colour", "Width"]);
  });
});
