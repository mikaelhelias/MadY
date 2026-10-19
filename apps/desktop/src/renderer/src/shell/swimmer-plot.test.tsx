// @vitest-environment jsdom
// Swimmer plot. One horizontal bar per
// subject from Start to End on a real time axis (the lollipop/forest row-per-row chassis),
// a response-interval overlay inside the bar, an arrow cap for ongoing subjects, and every
// further numeric column drawn as an event-glyph series (real series — standard marker,
// colour and legend controls). Sorted longest-first by default; rowId-keyed styles survive
// the sort (the waterfall rule). Brackets refused (subjects are not group comparisons).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { DataTable, Plot } from "@mady/core";
import { KIND_COLUMNS, TABLE_FORMATS } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { BRACKET_KINDS, Inspector } from "./Inspector";
import { PlotFigure } from "./PlotFigure";
import { galleryItems } from "./gallery";
import { NEW_GRAPH_GENRES } from "./newGraph";

afterEach(cleanup);

/** Five subjects with known durations (P2=20 · P5=17 · P1=14 · P3=8 · P4=6), three
 *  response intervals (P1 · P2 · P4), three ongoing (P1 · P2 · P5 — P4 carries an explicit
 *  0), and two event columns (Death: P3@9, P4@6 · Progression: P1@8, P3@6). */
function swimTable(): DataTable {
  const mk = (id: string, s: number, e: number, rs: number | "", re: number | "", on: number | "", d: number | "", p: number | "") =>
    ({ id, cells: { subj: id.toUpperCase(), s, e, rs, re, on, d, p } });
  return {
    id: "tsw", kind: "column", name: "Trial",
    columns: [
      { id: "subj", name: "Subject", role: "x" },
      { id: "s", name: "Start", role: "y" },
      { id: "e", name: "End", role: "y" },
      { id: "rs", name: "Response start", role: "y" },
      { id: "re", name: "Response end", role: "y" },
      { id: "on", name: "Ongoing", role: "y" },
      { id: "d", name: "Death", role: "y" },
      { id: "p", name: "Progression", role: "y" },
    ],
    rows: [
      mk("p1", 0, 14, 2, 10, 1, "", 8),
      mk("p2", 0, 20, 5, 20, 1, "", ""),
      mk("p3", 1, 9, "", "", "", 9, 6),
      mk("p4", 0, 6, 2, 5, 0, 6, ""),
      mk("p5", 0, 17, "", "", 1, "", ""),
    ],
  };
}

const swimPlot = (over: Partial<NonNullable<Plot["swimmer"]>> = {}, plotOver: Partial<Plot> = {}): Plot => ({
  id: "p", name: "Time on treatment", source: "tsw", status: "ok", styleOverrides: {}, kind: "swimmer",
  swimmer: { ...over }, ...plotOver,
});

describe("swimmer — the column contract", () => {
  it("bars from Start/End; Response/Ongoing recognised by name; other numerics = event series", () => {
    const scene = buildPlotScene(swimTable(), swimPlot());
    expect(scene.kind).toBe("swimmer");
    expect(scene.warnings).toEqual([]);
    const sw = scene.swimmer!;
    expect(sw.rows.length).toBe(5);
    expect(sw.startId).toBe("s");
    // events are real series — Death + Progression only, never Start/End/Response/Ongoing
    expect(scene.series.map((s) => s.name)).toEqual(["Death", "Progression"]);
    expect(scene.series[0]!.marks.length).toBe(2);
    expect(scene.series[1]!.marks.length).toBe(2);
    // response overlays on exactly P1 · P2 · P4; ongoing arrows on P1 · P2 · P5 (0 = no)
    expect(sw.rows.filter((r) => r.response).length).toBe(3);
    expect(sw.rows.filter((r) => r.ongoing).map((r) => r.subject).sort()).toEqual(["P1", "P2", "P5"]);
  });

  it("sorts longest bar first by default; sortBy \"table\" keeps the sheet order", () => {
    const def = buildPlotScene(swimTable(), swimPlot());
    expect(def.swimmer!.rows.map((r) => r.subject)).toEqual(["P2", "P5", "P1", "P3", "P4"]);
    // the subject axis ticks follow the sort (they are the row labels)
    expect(def.y.ticks.map((t) => t.label)).toEqual(["P2", "P5", "P1", "P3", "P4"]);
    const tab = buildPlotScene(swimTable(), swimPlot({ sortBy: "table" }));
    expect(tab.swimmer!.rows.map((r) => r.subject)).toEqual(["P1", "P2", "P3", "P4", "P5"]);
  });

  it("a per-subject bar colour is rowId-keyed on the Start dataset and survives the sort", () => {
    const scene = buildPlotScene(swimTable(), swimPlot({}, { pointStyles: { "s:p4": { color: "#ff0000" } } }));
    const p4 = scene.swimmer!.rows.find((r) => r.subject === "P4")!;
    expect(p4.color).toBe("#ff0000");
    expect(scene.swimmer!.rows.filter((r) => r.color === "#ff0000").length).toBe(1);
  });

  it("colour-by-column on the Start dataset paints bars by Stage (the classic look)", () => {
    const t = swimTable();
    t.columns.push({ id: "st", name: "Stage", role: "y" });
    for (const r of t.rows) r.cells["st"] = r.id === "p3" || r.id === "p4" ? "II" : "I";
    const scene = buildPlotScene(t, swimPlot({}, { seriesStyles: { s: { colorFromColumn: "st" } } }));
    // the text column is an attribute, never a series
    expect(scene.series.map((s) => s.name)).toEqual(["Death", "Progression"]);
    const colOf = (subj: string) => scene.swimmer!.rows.find((r) => r.subject === subj)!.color;
    expect(colOf("P1")).toBe(colOf("P2"));
    expect(colOf("P3")).toBe(colOf("P4"));
    expect(colOf("P1")).not.toBe(colOf("P3"));
    // the data-driven category legend replaces the event-series rows
    expect(scene.legend.map((l) => l.label)).toEqual(["I", "II"]);
  });

  it("the survival date-role pair draws elapsed bars and never becomes a series", () => {
    const t: DataTable = {
      id: "td", kind: "column", name: "Dates",
      columns: [
        { id: "subj", name: "Subject", role: "x" },
        { id: "cs", name: "Start date", role: "survStart", type: "date" },
        { id: "ce", name: "End date", role: "survEnd", type: "date" },
        { id: "d", name: "Death", role: "y" },
      ],
      rows: [
        { id: "r1", cells: { subj: "A", cs: 100, ce: 130, d: 15 } },
        { id: "r2", cells: { subj: "B", cs: 110, ce: 120, d: "" } },
      ],
    };
    const scene = buildPlotScene(t, swimPlot());
    const sw = scene.swimmer!;
    expect(sw.rows.map((r) => r.duration)).toEqual([30, 10]); // elapsed, longest first
    expect(scene.series.map((s) => s.name)).toEqual(["Death"]);
    expect(scene.x.domain[0]).toBeLessThanOrEqual(0); // elapsed bars start at 0
  });

  it("a table without Start and End columns refuses out loud", () => {
    const t = swimTable();
    t.columns = t.columns.slice(0, 2); // Subject + Start only
    const scene = buildPlotScene(t, swimPlot());
    expect(scene.warnings.some((w) => /start.*end|two numeric/i.test(w))).toBe(true);
  });
});

describe("swimmer — axes + annotations", () => {
  it("real time axis on X (consumes yAxisLength; log refused out loud)", () => {
    const scene = buildPlotScene(swimTable(), swimPlot());
    expect(scene.valueAxis).toBe("x");
    expect(scene.x.domain[1]).toBeGreaterThanOrEqual(20);
    const sized = buildPlotScene(swimTable(), swimPlot({}, { yAxisLength: 260 }));
    expect(sized.plot.height).toBeCloseTo(260, 5);
    const log = buildPlotScene(swimTable(), swimPlot({}, { xAxis: { scale: "log10" } }));
    expect(log.x.type).toBe("linear");
    expect(log.warnings.some((w) => /log/i.test(w))).toBe(true);
  });

  it("reference lines mark time points (the transposed value-line rule); brackets are refused", () => {
    expect(BRACKET_KINDS.has("swimmer")).toBe(false);
    const scene = buildPlotScene(swimTable(), swimPlot({}, {
      annotations: [
        { id: "v", kind: "vline", value: 12 },
        // hline names a value, and on a transposed chart the value axis is X — it draws
        // vertically too, exactly like the horizontal lollipop/forest (the swap rule).
        { id: "h", kind: "hline", value: 10 },
        { id: "br", kind: "bracket", from: 1, to: 2, bracketY: 15 },
      ],
    }));
    for (const id of ["v", "h"]) {
      const a = scene.annotations.find((x) => x.id === id);
      expect(a, `${id} must draw as a value line`).toBeTruthy();
      expect(a!.x1).toBeCloseTo(a!.x2!, 5); // vertical, at the time value
    }
    expect(scene.annotations.some((a) => a.kind === "bracket")).toBe(false);
    expect(scene.warnings.some((w) => /bracket/i.test(w) && /subject|group/i.test(w))).toBe(true);
  });

  it("duration labels ride the standard showValues + value-label font", () => {
    const off = buildPlotScene(swimTable(), swimPlot());
    expect(off.swimmer!.rows.every((r) => r.label == null)).toBe(true);
    const on = buildPlotScene(swimTable(), swimPlot({}, { showValues: true }));
    expect(on.swimmer!.rows.every((r) => r.label != null)).toBe(true);
    expect(on.swimmer!.rows[0]!.label!.text).toBe("20");
  });
});

describe("swimmer — the drawing + interactions", () => {
  it("bars, response overlays and ongoing arrows render; a bar click selects the Start point", () => {
    const scene = buildPlotScene(swimTable(), swimPlot());
    const onSelect = vi.fn();
    const { container } = render(<PlotFigure scene={scene} selected={null} zoom={1} onSelect={onSelect} />);
    expect(container.querySelectorAll("rect.swimbar").length).toBe(5);
    expect(container.querySelectorAll("rect.swimresp").length).toBe(3);
    expect(container.querySelectorAll("path.swimarrow").length).toBe(3);
    // the event glyphs must actually paint (the marker branch is gated on isCategoryKind —
    // a swimmer is marker-bearing like the forest, not a category-glyph kind)
    expect(container.querySelectorAll("g[id^='mark-d-']").length).toBe(2); // Death
    expect(container.querySelectorAll("g[id^='mark-p-']").length).toBe(2); // Progression
    const bars = container.querySelectorAll("rect.swimbar");
    fireEvent.click(bars[0]!);
    const call = onSelect.mock.calls.find((c) => c[0]?.kind === "series");
    expect(call, "a bar click must select the Start series' point").toBeTruthy();
    expect(call![0].columnId).toBe("s");
    expect(call![0].rowId).toBe("p2"); // the first (longest) drawn bar
  });

  it("duration labels draw as their own texts when switched on", () => {
    const scene = buildPlotScene(swimTable(), swimPlot({}, { showValues: true }));
    const { container } = render(<PlotFigure scene={scene} selected={null} zoom={1} />);
    expect(container.querySelectorAll("text.swimdur").length).toBe(5);
  });

  it("hiding an event column removes its glyph series (the hide contract)", () => {
    const scene = buildPlotScene(swimTable(), swimPlot({}, { seriesStyles: { d: { hidden: true } } }));
    expect(scene.series.map((s) => s.name)).toEqual(["Progression"]);
  });
});

describe("swimmer — Inspector + doors", () => {
  it("the Swimmer section controls write plot.swimmer (Duration labels writes showValues)", () => {
    const onSetPlotOptions = vi.fn();
    const h = {
      onSelect: vi.fn(), onSetAxis: vi.fn(), onSetAxisLength: vi.fn(), onSetAxisTitleFont: vi.fn(),
      onSetSeriesStyle: vi.fn(), onSetSeriesStyleAll: vi.fn(), onSetPointStyle: vi.fn(), onClearPointStyles: vi.fn(),
      onSetGrid: vi.fn(), onSetFrame: vi.fn(), onSetKind: vi.fn(), onSetBarLayout: vi.fn(), onSetBarShape: vi.fn(), onSetBoxWhisker: vi.fn(),
      onSetPlotOptions, onSetGraphTitle: vi.fn(), onSetPlotFont: vi.fn(), onHomogenizeFont: vi.fn(),
      onSetLegend: vi.fn(), onSetSignificance: vi.fn(), onApplyPreset: vi.fn(), 
      onApplyUserPreset: vi.fn(), onSaveUserPreset: vi.fn(), onDeleteUserPreset: vi.fn(), onSetProfileDefault: vi.fn(),
      annotationOps: { add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() },
    };
    const { container } = render(
      <Inspector activeSection="graphs" selection={{ kind: "plot" }} plot={swimPlot()} table={swimTable()}
        userPresets={[]} profileDefault={null} wholeGraph={false} onSetWholeGraph={() => {}} {...h} />,
    );
    const row = (label: string) => [...container.querySelectorAll("label")].find((l) => (l.querySelector("span:first-child")?.textContent ?? "").trim() === label);
    const sort = row("Sort subjects");
    expect(sort, "no Swimmer section").toBeTruthy();
    fireEvent.change(sort!.querySelector("select")!, { target: { value: "table" } });
    expect((onSetPlotOptions.mock.calls.at(-1)![0] as Partial<Plot>).swimmer?.sortBy).toBe("table");
    expect(row("Bar thickness")).toBeTruthy();
    expect(row("Ongoing arrow")).toBeTruthy();
    expect(row("Response colour")).toBeTruthy();
    expect(row("Response opacity")).toBeTruthy();
    const dur = row("Duration labels");
    expect(dur).toBeTruthy();
    fireEvent.click(dur!.querySelector("input")!);
    expect((onSetPlotOptions.mock.calls.at(-1)![0] as Partial<Plot>).showValues).toBe(true);
  });

  it("the Subject-timeline format is the entry point — own registry entry, no statistics; column sheets keep working", () => {
    // The dedicated format: an accurate picker entry, an empty
    // analyses list (a timeline sheet unlocks no statistics — it is a drawing format), and
    // the swimmer as its advertised graph. The generic Column format does not advertise it.
    expect(TABLE_FORMATS.timeline).toBeTruthy();
    expect(TABLE_FORMATS.timeline.replicates).toBe(false);
    expect(TABLE_FORMATS.timeline.analyses).toEqual([]);
    expect(TABLE_FORMATS.timeline.graphs.some((g) => /swimmer/i.test(g))).toBe(true);
    expect(TABLE_FORMATS.column.graphs.some((g) => /swimmer/i.test(g))).toBe(false);
    expect(KIND_COLUMNS.timeline.lead).toBe("Subject");
    const g = NEW_GRAPH_GENRES.find((x) => x.key === "swimmer");
    expect(g).toBeTruthy();
    expect(g!.formats[0]).toBe("timeline"); // the wizard's default sheet
    expect(g!.formats).toContain("column"); // existing Column-sheet swimmers keep the door
    const card = galleryItems().find((x) => x.key === "swimmer");
    expect(card).toBeTruthy();
    expect(card!.table.kind).toBe("timeline");
    const scene = buildPlotScene(card!.table, card!.plot);
    expect(scene.warnings).toEqual([]);
    expect(scene.swimmer!.rows.length).toBeGreaterThanOrEqual(8);
    expect(scene.series.length).toBeGreaterThanOrEqual(2); // event-glyph series with legend rows
    expect(scene.swimmer!.rows.some((r) => r.ongoing)).toBe(true);
    expect(scene.swimmer!.rows.some((r) => r.response)).toBe(true);
  });
});
