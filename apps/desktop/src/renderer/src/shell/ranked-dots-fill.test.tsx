// @vitest-environment jsdom
/**
 * Ranked dots — when the Inspector shows the points' colour as two-tone, the points are drawn two-tone. The style is
 * two-tone and the builder works out each dot's light interior + darker edge from the dot's own colour; guards against
 * the renderer dropping both for a dot drawn without a bar under it (a hollow ring), and against the Inspector
 * offering the bar's Fill group and "Match the bar" for a series that draws no bars, or a series Colour no dot uses.
 */
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { renderToStaticMarkup } from "react-dom/server";
import { PlotFigure } from "./PlotFigure";
import { Inspector } from "./Inspector";
import { galleryItems, galleryLookup } from "./gallery";

afterEach(cleanup);
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

const g = () => {
  const x = galleryItems().find((c) => c.title === "Ranked dots vs a reference");
  if (!x) throw new Error("no Ranked dots card");
  return { table: x.table as DataTable, plot: x.plot as Plot, lk: galleryLookup(x) };
};

describe("the drawing", () => {
  it("each dot is two-tone in its own colour: its light interior and darker edge, never a hollow ring", () => {
    const c = g();
    const scene = buildPlotScene(c.table, c.plot, { width: 640, height: 460, tables: c.lk });
    const marks = scene.series[0]!.marks.filter((m) => m.pointColor && (m.points?.length ?? 0) > 0);
    expect(marks.length, "no dot carries its own colour — this proves nothing").toBeGreaterThan(5);
    const { container } = render(<PlotFigure scene={scene} selected={null} />);
    const shapes = [...container.querySelectorAll("circle, path, rect, polygon")];
    for (const m of marks) {
      const dot = shapes.find((e) => e.getAttribute("stroke") === m.symbolOutline && e.getAttribute("fill") === m.symbolFillColor);
      expect(dot, `dot ${m.rowId}: no marker filled ${m.symbolFillColor} with edge ${m.symbolOutline}`).toBeDefined();
    }
    const hollow = shapes.filter((e) => e.getAttribute("fill") === "var(--bg)" && marks.some((m) => e.getAttribute("stroke") === m.pointColor));
    expect(hollow.length, "hollow rings").toBe(0);
  });

  it("no 'mean' bar through a lone dot, and the value labels take the card's own label colour", () => {
    // Guards against a bar through every dot (the column-scatter mean line, drawn for a single value) and against
    // value labels in the series colour although the card sets them grey (#374151), which the bar builder must pass on.
    const c = g();
    const scene = buildPlotScene(c.table, c.plot, { width: 640, height: 460, tables: c.lk });
    const s = scene.series[0]!;
    expect(s.marks.every((m) => (m.points?.length ?? 0) === 1), "the card's rows are not single dots — this proves nothing").toBe(true);
    const { container } = render(<PlotFigure scene={scene} selected={null} />);
    expect(container.querySelectorAll("line.gfx-scatter-mean").length, "mean lines through single dots").toBe(0);
    const want = (c.plot.seriesStyles!["ft"] as { pointLabelColor?: string }).pointLabelColor!;
    expect(want).toBeTruthy();
    expect(s.pointLabelColor).toBe(want);
    const label = [...container.querySelectorAll("text")].find((t) => t.textContent === s.marks[0]!.pointLabel);
    expect(label?.getAttribute("fill")).toBe(want);
  });

  it("'Fill lightness' writes what the dots read (twoToneTint on a points series, not the bar-swarm field)", () => {
    const c = g();
    const interior = (extra: Record<string, number>) => {
      const plot = { ...c.plot, seriesStyles: { ...c.plot.seriesStyles, ft: { ...c.plot.seriesStyles!["ft"], ...extra } } } as Plot;
      return buildPlotScene(c.table, plot, { width: 640, height: 460, tables: c.lk }).series[0]!.marks.find((m) => m.pointColor)!.symbolFillColor;
    };
    expect(interior({ twoToneTint: 0.2 })).not.toBe(interior({}));
  });
});

describe("a point's own colour still reaches the drawing on the swarm kinds", () => {
  // A dot with its own colour draws the builder's two-tone interior + edge; guards against the builder working
  // those out from the series colour when the override is `pointColor` (what a clicked dot's Colour writes), which
  // would stop the colour reaching the page on column scatter and estimation. Static markup: deterministic, so a
  // difference is the drawing, never React's ids.
  it.each(["Column scatter", "Estimation (Gardner-Altman)"])("%s", (title) => {
    const x = galleryItems().find((c) => c.title === title)!;
    const table = x.table as DataTable;
    const plot = x.plot as Plot;
    const size = { width: 620, height: 420 };
    const key = `${buildPlotScene(table, plot, size).series[0]!.id}:${buildPlotScene(table, plot, size).series[0]!.marks[0]!.rowId}`;
    const draw = (pointColor?: string) =>
      renderToStaticMarkup(<PlotFigure scene={buildPlotScene(table, pointColor ? { ...plot, pointStyles: { ...plot.pointStyles, [key]: { pointColor } } } : plot, size)} selected={null} />);
    const red = draw("#ff0000");
    expect(red, "a red point draws the same as no colour at all").not.toBe(draw());
    expect(red, "red and green draw the same — the colour is not what reaches the page").not.toBe(draw("#00aa55"));
  });
});

describe("the Inspector, for a bar-chart series drawn as points", () => {
  const panel = (plot: Plot, onSetSeriesStyle = vi.fn()) => {
    const c = g();
    return render(
      <Inspector {...({} as ComponentProps<typeof Inspector>)} activeSection="graphs" selection={{ kind: "series", columnId: "ft" } as never}
        plot={plot} table={c.table} userPresets={[]} profileDefault={null} wholeGraph={false} onSetWholeGraph={() => {}}
        onSelect={vi.fn()} onSetSeriesStyle={onSetSeriesStyle} onSetPlotOptions={vi.fn()} onSetPointStyle={vi.fn()} />,
    ).container;
  };
  const labels = (root: HTMLElement) => [...root.querySelectorAll("label.frow > span, .frow > span")].map((s) => (s.textContent ?? "").trim());

  it("offers no bar Fill group and no 'Match the bar' — there is no bar", () => {
    const root = panel(g().plot);
    const l = labels(root);
    expect(l).not.toContain("Match the bar");
    // The bar Fill group's own rows: its Style list is the one that offers "Gradient".
    expect([...root.querySelectorAll("option")].map((o) => o.textContent)).not.toContain("Gradient");
    // …and still the dots' own controls.
    expect(l).toContain("Shape");
    expect(l).toContain("Fill lightness");
  });

  /** The Colour rows that set the series colour. Asked by what the control writes, not by its word: the series'
   *  Leader line group has a "Colour" of its own, which writes `leaderColor`. */
  const seriesColourRows = (plot: Plot) => {
    const set = vi.fn();
    const root = panel(plot, set);
    return [...root.querySelectorAll("label.frow")].filter((row) => {
      if ((row.querySelector(":scope > span")?.textContent ?? "").trim() !== "Colour") return false;
      set.mockClear();
      fireEvent.change(row.querySelector("input")!, { target: { value: "#123456" } });
      return set.mock.calls.some(([, patch]) => "color" in (patch as object));
    }).length;
  };

  it("says each point has its own colour instead of offering a series Colour no dot uses", () => {
    const root = panel(g().plot);
    expect(root.textContent).toContain("has its own colour");
    cleanup();
    expect(seriesColourRows(g().plot)).toBe(0);
    // Without per-point colours the series Colour is back.
    const plain = { ...g().plot, pointStyles: {} } as Plot;
    cleanup();
    expect(seriesColourRows(plain)).toBe(1);
  });
});
