// @vitest-environment jsdom
// Waterfall — a bar option, not a new kind: `Plot.barSort` orders the
// categories by value, and the one-click "Waterfall (response)" genre/card adds the RECIST
// look (descending sort + graduated value fill + data-anchored ±20/+30% threshold zones).
// Also guards transposed bands: a data-anchored band marks a value range, so on horizontal
// bars it must draw on the value (X) axis — the same swap rule
// reference lines already follow.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { Inspector } from "./Inspector";
import { galleryItems } from "./gallery";
import { NEW_GRAPH_GENRES } from "./newGraph";

afterEach(cleanup);

const table: DataTable = {
  id: "t", kind: "column", name: "T",
  columns: [
    { id: "x", name: "Patient", role: "x" },
    { id: "v", name: "Change %", role: "y" },
  ],
  rows: [
    { id: "rA", cells: { x: "A", v: 10 } },
    { id: "rB", cells: { x: "B", v: -35 } },
    { id: "rC", cells: { x: "C", v: 25 } },
    { id: "rD", cells: { x: "D", v: -10 } },
  ],
};
const barPlot = (over: Partial<Plot> = {}): Plot => ({
  id: "p", name: "W", source: "t", status: "ok", styleOverrides: {}, kind: "bar", ...over,
});

const tickLabels = (s: ReturnType<typeof buildPlotScene>): string[] =>
  s.x.ticks.filter((t) => !t.minor).map((t) => t.label);

describe("barSort — categories ordered by value", () => {
  it("desc puts the largest bar first; asc reverses; none keeps table order", () => {
    expect(tickLabels(buildPlotScene(table, barPlot()))).toEqual(["A", "B", "C", "D"]);
    expect(tickLabels(buildPlotScene(table, barPlot({ barSort: "desc" })))).toEqual(["C", "A", "D", "B"]);
    expect(tickLabels(buildPlotScene(table, barPlot({ barSort: "asc" })))).toEqual(["B", "D", "A", "C"]);
  });

  it("a per-bar colour (rowId-keyed) follows its bar through the sort", () => {
    const plot = barPlot({ barSort: "desc", pointStyles: { "v:rB": { fillColor: "#ff0000" } } });
    const scene = buildPlotScene(table, plot);
    const marks = scene.series[0]!.marks;
    // B sorted last — its mark (rowId rB) must carry the red, and sit at the largest cx
    const red = marks.find((m) => m.rowId === "rB")!;
    expect(red.fill).toBe("#ff0000");
    expect(red.cx).toBe(Math.max(...marks.map((m) => m.cx)));
  });

  it("a bracket keeps pointing at its own categories after the sort (indices remapped)", () => {
    const plot = barPlot({
      barSort: "desc",
      annotations: [{ id: "br", kind: "bracket", from: 1, to: 2, label: "*" }], // A vs B, pre-sort indices
    });
    const scene = buildPlotScene(table, plot);
    const br = scene.annotations.find((a) => a.id === "br")!;
    const tick = (label: string) => scene.x.ticks.find((t) => t.label === label)!.pos;
    const ends = [br.x1!, br.x2!].sort((a, b) => a - b);
    const want = [tick("A"), tick("B")].sort((a, b) => a - b);
    expect(ends[0]).toBeCloseTo(want[0]!, 1);
    expect(ends[1]).toBeCloseTo(want[1]!, 1);
  });

  it("three-way grouped clusters refuse the sort with a warning (contiguity would tear)", () => {
    const plot = barPlot({ barSort: "desc", barSeriesGroups: { v: "G1" } });
    const scene = buildPlotScene(table, plot);
    expect(scene.warnings.some((w) => /sort/i.test(w))).toBe(true);
    expect(tickLabels(scene)).toEqual(["A", "B", "C", "D"]);
  });
});

describe("transposed data-anchored bands", () => {
  it("on horizontal bars a value-anchored band draws across the value (X) axis", () => {
    const plot = barPlot({
      barOrientation: "horizontal",
      annotations: [
        { id: "zone", kind: "hband", bandLo: -30, bandHi: -20, fill: "#00aa00" },
        { id: "ref", kind: "hline", value: -30 },
      ],
    });
    const scene = buildPlotScene(table, plot);
    const zone = scene.annotations.find((a) => a.id === "zone");
    expect(zone, "the value zone must not be dropped on a horizontal bar").toBeTruthy();
    const ref = scene.annotations.find((a) => a.id === "ref")!;
    // the band's low edge must sit exactly where the -30 reference line draws (value axis = X)
    expect(Math.min(zone!.x1!, zone!.x2!)).toBeCloseTo(ref.x1!, 1);
    // and it spans the full category (Y) extent like the line does
    expect(Math.abs(zone!.y2! - zone!.y1!)).toBeCloseTo(Math.abs(ref.y2! - ref.y1!), 1);
  });
});

describe("waterfall — the one-click door", () => {
  it("the wizard genre exists and patches a descending-sorted bar with threshold zones", () => {
    const g = NEW_GRAPH_GENRES.find((x) => x.key === "waterfall");
    expect(g, "no waterfall genre").toBeTruthy();
    expect(g!.plotKind).toBe("bar");
    const patch = g!.plotPatch as Partial<Plot>;
    expect(patch.barSort).toBe("desc");
    expect((patch.annotations ?? []).filter((a) => a.kind === "hband" && a.bandLo != null).length).toBeGreaterThanOrEqual(2);
  });

  it("the gallery card (key = genre key) builds warning-free with the sort applied", () => {
    const card = galleryItems().find((x) => x.key === "waterfall");
    expect(card, "no waterfall gallery card").toBeTruthy();
    const scene = buildPlotScene(card!.table, card!.plot);
    expect(scene.warnings).toEqual([]);
    const labels = tickLabels(scene);
    const labelCol = card!.table.columns[0]!.id;
    const valueCol = card!.table.columns[1]!.id;
    // 13 bars may thin their tick labels — check the labels that are shown appear in the
    // value-sorted order (largest first), which pins the sort without depending on thinning.
    const rowsByValue = [...card!.table.rows]
      .sort((a, b) => Number(b.cells[valueCol]) - Number(a.cells[valueCol]))
      .map((r) => String(r.cells[labelCol]));
    const shown = labels.filter((l) => l !== "" && rowsByValue.includes(l));
    expect(shown.length, "no readable category labels to check the sort by").toBeGreaterThan(2);
    const idxs = shown.map((l) => rowsByValue.indexOf(l));
    expect([...idxs].sort((a, b) => a - b), "shown labels must appear in value-sorted order").toEqual(idxs);
    // The two zone labels sit inside their own bands — not both at the plot top, overtyping
    // each other.
    const zones = scene.annotations.filter((a) => a.kind === "band" && a.label);
    expect(zones.length).toBe(2);
    expect(Math.abs(zones[0]!.labelY! - zones[1]!.labelY!), "zone labels must not overprint").toBeGreaterThan(40);
    for (const z of zones) {
      const yTop = Math.min(z.y1!, z.y2!);
      const yBot = Math.max(z.y1!, z.y2!);
      expect(z.labelY!).toBeGreaterThanOrEqual(yTop);
      expect(z.labelY!).toBeLessThanOrEqual(yBot);
    }
  });
});

describe("barSort — the Inspector control", () => {
  it("Sort bars writes plot.barSort (bar kind only)", () => {
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
      <Inspector activeSection="graphs" selection={{ kind: "plot" }} plot={barPlot()} table={table}
        userPresets={[]} profileDefault={null} wholeGraph={false} onSetWholeGraph={() => {}} {...h} />,
    );
    const row = [...container.querySelectorAll("label")].find((l) => (l.querySelector("span:first-child")?.textContent ?? "").trim() === "Sort bars");
    expect(row, "no Sort bars control in the bar section").toBeTruthy();
    fireEvent.change(row!.querySelector("select")!, { target: { value: "desc" } });
    expect((onSetPlotOptions.mock.calls.at(-1)![0] as Partial<Plot>).barSort).toBe("desc");
  });
});

// Zone names clear of the bars — guards against a zone caption at a fixed spot (the top of its zone)
// whatever is drawn there, which on the horizontal waterfall prints "Progression" across the top
// patient's bar. The caption boxes below use ordinary glyph ratios (0.6 of the font per character, 0.8
// above the baseline, 0.2 below), not the builder's own measure.
describe("zone names stay clear of the bars", () => {
  type Scene = ReturnType<typeof buildPlotScene>;
  type Ann = Scene["annotations"][number];
  const card = () => galleryItems().find((x) => x.key === "waterfall")!;
  const bars = (s: Scene) => s.series.flatMap((se) => se.marks.flatMap((m) => (m.bar ? [m.bar] : [])));
  const captionAt = (s: Scene, a: Ann, x: number, y: number, anchor: string) => {
    const f = a.fontSize ?? s.fonts.legend.size;
    const w = a.label!.length * f * 0.6;
    const x1 = anchor === "start" ? x : anchor === "end" ? x - w : x - w / 2;
    return { x1, x2: x1 + w, y1: y - 0.8 * f, y2: y + 0.2 * f };
  };
  const onBar = (c: { x1: number; x2: number; y1: number; y2: number }, b: { x: number; y: number; w: number; h: number }) =>
    c.x1 < b.x + b.w && b.x < c.x2 && c.y1 < b.y + b.h && b.y < c.y2;
  const horizontal = () => { const c = card(); return buildPlotScene(c.table, { ...c.plot, barOrientation: "horizontal" }); };

  it("the fixture can show the fault: at the top of its zone \"Progression\" lands on a bar", () => {
    const s = horizontal();
    const a = s.annotations.find((x) => x.kind === "band" && x.label === "Progression")!;
    const old = captionAt(s, a, (a.x1! + a.x2!) / 2, Math.min(a.y1!, a.y2!) + 12, "middle");
    expect(bars(s).some((b) => onBar(old, b))).toBe(true);
  });

  it("on the horizontal waterfall no zone name is drawn across a bar or a dot; a moved name stays in its zone on the plot", () => {
    const s = horizontal();
    const zones = s.annotations.filter((x) => x.kind === "band" && x.label);
    expect(zones.map((z) => z.label).sort()).toEqual(["Progression", "Response"]);
    // The dots at the bar ends, at the size the renderer draws them (0.6 of the series symbol size).
    const dots = s.series.flatMap((se) => se.marks.flatMap((m) => (m.points ?? []).map((p) => {
      const r = Math.max(2, (se.symbolSize ?? 4) * 0.6);
      return { x: p.cx - r, y: p.cy - r, w: 2 * r, h: 2 * r };
    })));
    for (const a of zones) {
      const c = captionAt(s, a, a.labelX!, a.labelY!, a.labelAnchor ?? "middle");
      for (const b of [...bars(s), ...dots]) expect(onBar(c, b), `"${a.label}" is drawn across a bar or a dot`).toBe(false);
      // A name whose default spot (the top of its zone) touches nothing stays exactly there — checked clear
      // just above. Only a moved name has to land inside its zone on the plot.
      const stayed = a.labelAnchor === "middle"
        && Math.abs(a.labelX! - (a.x1! + a.x2!) / 2) < 1e-6
        && Math.abs(a.labelY! - (Math.min(a.y1!, a.y2!) + 12)) < 1e-6;
      if (a.label === "Progression") expect(stayed, "Progression did not move off the bar").toBe(false);
      if (stayed) continue;
      const mid = (c.x1 + c.x2) / 2;
      expect(mid, `"${a.label}" left its zone`).toBeGreaterThanOrEqual(Math.min(a.x1!, a.x2!));
      expect(mid, `"${a.label}" left its zone`).toBeLessThanOrEqual(Math.max(a.x1!, a.x2!));
      expect(c.y1).toBeGreaterThanOrEqual(s.plot.y - 1);
      expect(c.y2).toBeLessThanOrEqual(s.plot.y + s.plot.height + 1);
    }
    expect(s.warnings.join(" ")).not.toMatch(/zone label/);
  });

  it("a zone name that was already clear does not move (the vertical waterfall card)", () => {
    const c = card();
    const s = buildPlotScene(c.table, c.plot);
    const zones = s.annotations.filter((x) => x.kind === "band" && x.label);
    expect(zones.length).toBe(2);
    for (const a of zones) {
      expect(a.labelAnchor).toBe("middle");
      expect(a.labelX).toBeCloseTo((a.x1! + a.x2!) / 2, 6);
      expect(a.labelY).toBeCloseTo(Math.min(a.y1!, a.y2!) + 12, 6);
    }
  });

  it("a zone covered by bars everywhere keeps its name on the plot and says so", () => {
    const full: DataTable = {
      ...table,
      rows: Array.from({ length: 30 }, (_, i) => ({ id: `r${i}`, cells: { x: `P${i}`, v: 95 } })),
    };
    const s = buildPlotScene(full, barPlot({
      barOrientation: "horizontal",
      annotations: [{ id: "z", kind: "vband", bandLo: 20, bandHi: 100, label: "Progression" }],
    }), { width: 500, height: 260 });
    const a = s.annotations.find((x) => x.id === "z")!;
    expect(a.label).toBe("Progression");
    const cap = captionAt(s, a, a.labelX!, a.labelY!, a.labelAnchor ?? "middle");
    expect(cap.y1).toBeGreaterThanOrEqual(s.plot.y - 1);
    expect(cap.y2).toBeLessThanOrEqual(s.plot.y + s.plot.height + 1);
    expect(s.warnings.join(" ")).toMatch(/zone label "Progression" could not be placed clear of the data/);
  });
});
