// @vitest-environment jsdom
/**
 * A bubble series coloured by a category column: every bubble takes its category's colour, so a series Colour reaches
 * no bubble. With "Apply to whole series" ticked and a bubble clicked, the Colour row recolours that bubble's
 * category — all its bubbles and its legend key. Guards against the row writing the series `color`, which the drawing
 * never reads (the colour changes in the panel and nothing on the graph), and against a Colour row offered when no
 * category is named (no bubble clicked) or when the colours come from a ramp.
 */
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { DataTable, Plot, SeriesStyle } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { Inspector } from "./Inspector";
import { galleryItems } from "./gallery";

afterEach(cleanup);
beforeEach(() => globalThis.localStorage?.removeItem("mady.applyWholeSeries"));
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

const SIZE = { width: 640, height: 460 };
const card = () => {
  const x = galleryItems().find((c) => c.key === "bubblecats");
  if (!x) throw new Error("no 'Bubbles by category' card");
  return { table: x.table as DataTable, plot: x.plot as Plot };
};
const rowOf = (table: DataTable, treatment: string) => table.rows.find((r) => r.cells["tr"] === treatment)!.id;

type SeriesSpy = (columnId: string, delta: SeriesStyle) => void;
type PointSpy = (columnId: string, rowId: string, delta: SeriesStyle) => void;
const panel = (plot: Plot, table: DataTable, rowId: string | undefined, spies: { series?: SeriesSpy; point?: PointSpy } = {}) =>
  render(
    <Inspector {...({} as ComponentProps<typeof Inspector>)} activeSection="graphs"
      selection={{ kind: "series", columnId: "nes", ...(rowId ? { rowId } : {}) } as never}
      plot={plot} table={table} userPresets={[]} profileDefault={null} wholeGraph={false} onSetWholeGraph={() => {}}
      onSelect={vi.fn()} onSetSeriesStyle={spies.series ?? vi.fn()} onSetPlotOptions={vi.fn()} onSetPointStyle={spies.point ?? vi.fn()} />,
  ).container;

/** The Data points rows whose label starts with "Colour" and which hold a colour input. */
const colourRows = (root: HTMLElement) =>
  [...root.querySelectorAll("label.frow")].filter((row) =>
    (row.querySelector(":scope > span")?.textContent ?? "").trim().startsWith("Colour") && row.querySelector("input[type=color]"));
const rowLabels = (root: HTMLElement) => [...root.querySelectorAll("label.frow > span, .frow > span")].map((s) => (s.textContent ?? "").trim());

describe("Bubbles by category: the Colour row with Apply to whole series ticked", () => {
  it("names the clicked bubble's category and writes that category's colour, not the series colour", () => {
    const { table, plot } = card();
    const series = vi.fn<SeriesSpy>();
    const root = panel(plot, table, rowOf(table, "Drug A"), { series });
    const rows = colourRows(root).filter((r) => (r.querySelector(":scope > span")?.textContent ?? "").includes("Drug A"));
    expect(rows.length, `no Colour row for "Drug A": ${rowLabels(root).join(" | ")}`).toBe(1);
    fireEvent.change(rows[0]!.querySelector("input")!, { target: { value: "#123456" } });
    expect(series).toHaveBeenCalledWith("nes", { colorFromColors: { "Drug A": "#123456" } });
    expect(series.mock.calls.some(([, d]) => "color" in (d as object)), "the series colour, which no bubble reads, was written").toBe(false);
  });

  it("what it writes recolours every Drug A bubble and the Drug A key, and nothing else", () => {
    const { table, plot } = card();
    const before = buildPlotScene(table, plot, SIZE);
    const st = plot.seriesStyles!["nes"] as SeriesStyle;
    const after = buildPlotScene(table, { ...plot, seriesStyles: { ...plot.seriesStyles, nes: { ...st, colorFromColors: { "Drug A": "#123456" } } } }, SIZE);
    const drugA = new Set(table.rows.filter((r) => r.cells["tr"] === "Drug A").map((r) => r.id));
    expect(drugA.size).toBe(4);
    for (const m of after.series[0]!.marks) {
      const was = before.series[0]!.marks.find((b) => b.rowId === m.rowId)!.fill;
      if (drugA.has(m.rowId)) expect(m.fill, `Drug A bubble ${m.rowId}`).toBe("#123456");
      else expect(m.fill, `bubble ${m.rowId} is not Drug A but changed`).toBe(was);
    }
    expect(after.legend.filter((e) => e.dataDriven).map((e) => [e.label, e.color])).toEqual(
      before.legend.filter((e) => e.dataDriven).map((e) => [e.label, e.label === "Drug A" ? "#123456" : e.color]));
  });

  it("shows the category's current colour, including one set before", () => {
    const { table, plot } = card();
    const drawn = buildPlotScene(table, plot, SIZE).series[0]!.marks.find((m) => m.rowId === rowOf(table, "Drug B"))!.fill!;
    const shown = (p: Plot) => (colourRows(panel(p, table, rowOf(table, "Drug B")))[0]!.querySelector("input") as HTMLInputElement).value.toLowerCase();
    expect(shown(plot)).toBe(drawn.toLowerCase());
    cleanup();
    const st = plot.seriesStyles!["nes"] as SeriesStyle;
    expect(shown({ ...plot, seriesStyles: { ...plot.seriesStyles, nes: { ...st, colorFromColors: { "Drug B": "#abcdef" } } } })).toBe("#abcdef");
  });

  it("no bubble clicked: no Colour row, and a note says how to recolour a category", () => {
    const { table, plot } = card();
    const root = panel(plot, table, undefined);
    expect(colourRows(root).length, rowLabels(root).join(" | ")).toBe(0);
    expect(root.textContent).toContain("Click a point to recolour its whole category");
  });

  it("colours from a ramp: no Colour row, and a note names the column", () => {
    const { table, plot } = card();
    const st = plot.seriesStyles!["nes"] as SeriesStyle;
    const ramp = { ...plot, seriesStyles: { ...plot.seriesStyles, nes: { ...st, colorFromColumn: "n", colorFromMode: "continuous" } } } as Plot;
    const root = panel(ramp, table, rowOf(table, "Drug A"));
    expect(colourRows(root).length, rowLabels(root).join(" | ")).toBe(0);
    expect(root.textContent).toContain("takes its colour from its “Gene set size” value");
  });

  it("unticked: the clicked bubble alone still takes the colour", () => {
    globalThis.localStorage?.setItem("mady.applyWholeSeries", "0");
    const { table, plot } = card();
    const series = vi.fn<SeriesSpy>();
    const point = vi.fn<PointSpy>();
    const root = panel(plot, table, rowOf(table, "Drug A"), { series, point });
    const rows = colourRows(root);
    expect(rows.length).toBeGreaterThan(0);
    fireEvent.change(rows[0]!.querySelector("input")!, { target: { value: "#123456" } });
    expect(point.mock.calls.some(([, , d]) => (d as SeriesStyle)?.color === "#123456"), JSON.stringify(point.mock.calls)).toBe(true);
    expect(series.mock.calls.some(([, d]) => "colorFromColors" in (d as object))).toBe(false);
  });
});

describe("the same Colour row on the other kinds that colour every point by a column", () => {
  /** Gallery card, the series whose points are coloured, the text column coloured by, and whether the kind draws a
   *  colour key (a funnel draws none). */
  const CASES = [
    { key: "ternary", series: "a", col: "g", hasKey: true },
    { key: "funnel", series: "e", col: "s", hasKey: false },
    { key: "swimmer", series: "s", col: "subj", hasKey: true },
  ] as const;

  it.each(CASES)("$key: shows the clicked point's category colour, writes it, and the drawing and the key take it", ({ key, series: sid, col, hasKey }) => {
    const x = galleryItems().find((c) => c.key === key)!;
    const table = x.table as DataTable;
    const st = { ...(x.plot.seriesStyles?.[sid] as SeriesStyle | undefined), colorFromColumn: col, colorFromMode: "category" as const };
    const plot = { ...x.plot, seriesStyles: { ...x.plot.seriesStyles, [sid]: st } } as Plot;
    // Not the first category: that one wears the first palette colour, the same as the series' own default, so a row
    // showing the series colour would pass.
    const first = String(table.rows[0]!.cells[col]);
    const row = table.rows.find((r) => String(r.cells[col]) !== first)!;
    const cat = String(row.cells[col]);
    const before = buildPlotScene(table, plot, SIZE);
    const drawn = (sc: typeof before) =>
      (sc.swimmer?.startId === sid ? sc.swimmer.rows.find((r) => r.rowId === row.id)?.color : sc.series.find((s) => s.id === sid)?.marks.find((m) => m.rowId === row.id)?.fill)?.toLowerCase();
    expect(drawn(before), "the clicked row is not drawn — this proves nothing").toBeTruthy();

    const set = vi.fn();
    const root = render(
      <Inspector {...({} as ComponentProps<typeof Inspector>)} activeSection="graphs" selection={{ kind: "series", columnId: sid, rowId: row.id } as never}
        plot={plot} table={table} userPresets={[]} profileDefault={null} wholeGraph={false} onSetWholeGraph={() => {}}
        onSelect={vi.fn()} onSetSeriesStyle={set} onSetPlotOptions={vi.fn()} onSetPointStyle={vi.fn()} />,
    ).container;
    const rows = colourRows(root).filter((r) => (r.querySelector(":scope > span")?.textContent ?? "").includes(`“${cat}”`));
    expect(rows.length, `no Colour row for “${cat}”: ${rowLabels(root).join(" | ")}`).toBe(1);
    expect((rows[0]!.querySelector("input") as HTMLInputElement).value.toLowerCase(), "the row does not show the colour drawn").toBe(drawn(before));
    fireEvent.change(rows[0]!.querySelector("input")!, { target: { value: "#123456" } });
    expect(set).toHaveBeenCalledWith(sid, { colorFromColors: { [cat]: "#123456" } });

    const after = buildPlotScene(table, { ...plot, seriesStyles: { ...plot.seriesStyles, [sid]: { ...st, colorFromColors: { [cat]: "#123456" } } } }, SIZE);
    expect(drawn(after)).toBe("#123456");
    if (hasKey) expect(after.legend.find((e) => e.label === cat)?.color, "the key").toBe("#123456");
    else expect(after.legend, "a key appeared: say so in CASES").toEqual([]);
  });

  it("whole graph: the category colour goes to every series coloured by the same column", () => {
    const { table, plot } = card();
    const set = vi.fn();
    render(
      <Inspector {...({} as ComponentProps<typeof Inspector>)} activeSection="graphs" selection={{ kind: "series", columnId: "nes", rowId: rowOf(table, "Control") } as never}
        plot={plot} table={table} userPresets={[]} profileDefault={null} wholeGraph={true} onSetWholeGraph={() => {}}
        onSelect={vi.fn()} onSetSeriesStyle={set} onSetSeriesStyleAll={vi.fn()} onSetPlotOptions={vi.fn()} onSetPointStyle={vi.fn()} />,
    );
    const row = colourRows(document.body as HTMLElement).find((r) => (r.querySelector(":scope > span")?.textContent ?? "").includes("Control"))!;
    fireEvent.change(row.querySelector("input")!, { target: { value: "#123456" } });
    expect(set).toHaveBeenCalledWith("nes", { colorFromColors: { Control: "#123456" } });
  });
});

describe("a bubble's size", () => {
  it("offers no Data points Size (the radius comes from the data) and points to Min / Max radius", () => {
    const { table, plot } = card();
    const root = panel(plot, table, undefined);
    expect(rowLabels(root)).not.toContain("Size");
    expect(root.textContent).toContain("Min radius and Max radius");
  });
});
