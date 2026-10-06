// @vitest-environment jsdom
// UpSet plot. The Venn's any-number-of-sets sibling on the same "sets"
// membership door: exclusive-intersection bars on a real count Y axis (built by the bar
// builder from a synthesised one-row-per-intersection table — the histogram delegation
// pattern, so yAxisLength/brackets/hlines/value-labels are the bar's own), the membership
// dot matrix under the bars on the shared column grid, and set-size bars at the left.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { DataTable, Plot } from "@mady/core";
import { TABLE_FORMATS } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { BRACKET_KINDS, Inspector, NO_SERIES_LEGEND } from "./Inspector";
import { PlotFigure } from "./PlotFigure";
import { galleryItems } from "./gallery";
import { NEW_GRAPH_GENRES } from "./newGraph";

afterEach(cleanup);

/** Membership fixture with known exclusive intersections:
 *  A=5 · A∩B=4 · B=3 · C=2 · A∩B∩C=2 · D=1 · B∩D=1 (18 items).
 *  Set totals: |A|=11 · |B|=10 · |C|=4 · |D|=2. One A cell is text ("x" = member) and one
 *  D cell is 0 (0 = not a member) — the membership rule, same as the Venn's. */
function fourSets(): DataTable {
  const rows: DataTable["rows"] = [];
  let n = 0;
  const add = (a: string | number, b: string | number, c: string | number, d: string | number) => {
    rows.push({ id: `r${n}`, cells: { item: `g${n}`, a, b, c, d } });
    n += 1;
  };
  for (let i = 0; i < 5; i++) add(i === 0 ? "x" : 1, "", "", i === 1 ? 0 : ""); // A only
  for (let i = 0; i < 4; i++) add(1, 1, "", ""); // A∩B
  for (let i = 0; i < 3; i++) add("", 1, "", ""); // B only
  for (let i = 0; i < 2; i++) add("", "", 1, ""); // C only
  for (let i = 0; i < 2; i++) add(1, 1, 1, ""); // A∩B∩C
  add("", "", "", 1); // D only
  add("", 1, "", 1); // B∩D
  return {
    id: "tu", kind: "sets", name: "U",
    columns: [
      { id: "item", name: "Item", role: "x" },
      { id: "a", name: "Set A", role: "y" },
      { id: "b", name: "Set B", role: "y" },
      { id: "c", name: "Set C", role: "y" },
      { id: "d", name: "Set D", role: "y" },
    ],
    rows,
  };
}

const upsetPlot = (over: Partial<NonNullable<Plot["upset"]>> = {}, plotOver: Partial<Plot> = {}): Plot => ({
  id: "p", name: "Overlap", source: "tu", status: "ok", styleOverrides: {}, kind: "upset",
  upset: { ...over }, ...plotOver,
});

describe("upset — intersections from membership", () => {
  it("computes exclusive intersections, sorted largest first (ties: fewest sets, then set order)", () => {
    const scene = buildPlotScene(fourSets(), upsetPlot());
    expect(scene.kind).toBe("upset");
    expect(scene.warnings).toEqual([]);
    const u = scene.upset!;
    expect(u.columns.map((col) => col.key)).toEqual(["A", "AB", "B", "C", "ABC", "D", "BD"]);
    expect(u.columns.map((col) => col.count)).toEqual([5, 4, 3, 2, 2, 1, 1]);
    expect(u.columns[1]!.members).toEqual([0, 1]);
    expect(u.sets.map((s) => s.total)).toEqual([11, 10, 4, 2]);
  });

  it("sortBy \"degree\" orders by how many sets, then size", () => {
    const scene = buildPlotScene(fourSets(), upsetPlot({ sortBy: "degree" }));
    expect(scene.upset!.columns.map((col) => col.key)).toEqual(["A", "B", "C", "D", "AB", "BD", "ABC"]);
  });

  it("maxIntersections truncates with a warning saying how many are hidden", () => {
    const scene = buildPlotScene(fourSets(), upsetPlot({ maxIntersections: 4 }));
    expect(scene.upset!.columns.length).toBe(4);
    expect(scene.warnings.some((w) => w.includes("3") && /hidden|not shown/i.test(w))).toBe(true);
  });

  it("minSize filters small intersections; showEmpty adds the zero-count combinations", () => {
    const min = buildPlotScene(fourSets(), upsetPlot({ minSize: 2 }));
    expect(min.upset!.columns.map((col) => col.key)).toEqual(["A", "AB", "B", "C", "ABC"]);
    const empty = buildPlotScene(fourSets(), upsetPlot({ showEmpty: true }));
    expect(empty.upset!.columns.length).toBe(15); // 2⁴ − 1 combinations, all within the cap
    expect(empty.upset!.columns.filter((col) => col.count === 0).length).toBe(8);
  });

  it("hiding a set column recomputes without it (visibleDatasets honoured)", () => {
    const scene = buildPlotScene(fourSets(), upsetPlot({}, { seriesStyles: { d: { hidden: true } } }));
    const u = scene.upset!;
    expect(u.sets.length).toBe(3);
    // B-only absorbs the B∩D item → B ties AB at 4; the tie-break (fewest sets first) puts B first
    expect(u.columns.map((col) => col.key)).toEqual(["A", "B", "AB", "C", "ABC"]);
    expect(u.columns.map((col) => col.count)).toEqual([5, 4, 4, 2, 2]);
  });

  it("a table with no set columns refuses out loud", () => {
    const t = fourSets();
    t.columns = t.columns.slice(0, 1);
    const scene = buildPlotScene(t, upsetPlot());
    expect(scene.warnings.some((w) => /set column/i.test(w))).toBe(true);
  });
});

describe("upset — the composite geometry", () => {
  it("bars ride a real linear count axis inside the plot rect; the matrix sits below it", () => {
    const scene = buildPlotScene(fourSets(), upsetPlot());
    expect(scene.y.type).toBe("linear");
    expect(scene.y.domain[1]).toBeGreaterThanOrEqual(5);
    expect(scene.y.ticks.length).toBeGreaterThan(1);
    const u = scene.upset!;
    const { x, y, width, height } = scene.plot;
    for (const col of u.columns) {
      expect(col.cx).toBeGreaterThan(x);
      expect(col.cx).toBeLessThan(x + width);
    }
    // columns left→right in drawn order
    for (let i = 1; i < u.columns.length; i++) expect(u.columns[i]!.cx).toBeGreaterThan(u.columns[i - 1]!.cx);
    // matrix rows are below the bar region; set-size bars sit left of it
    for (const s of u.sets) {
      expect(s.rowCy).toBeGreaterThan(y + height);
      expect(s.bar).toBeTruthy();
      expect(s.bar!.x + s.bar!.w).toBeLessThanOrEqual(x + 1);
    }
    // bar heights follow the sorted counts (marks are the bar builder's own)
    const hs = (scene.series[0]?.marks ?? []).map((m) => m.bar!.h);
    for (let i = 1; i < hs.length; i++) expect(hs[i]!).toBeLessThanOrEqual(hs[i - 1]! + 0.01);
  });

  it("consumes yAxisLength like a bar chart (panel alignment)", () => {
    const scene = buildPlotScene(fourSets(), upsetPlot({}, { yAxisLength: 250 }));
    expect(scene.plot.height).toBeCloseTo(250, 5);
  });

  it("a log count axis is refused out loud and drawn linear", () => {
    const scene = buildPlotScene(fourSets(), upsetPlot({}, { yAxis: { scale: "log10" } }));
    expect(scene.y.type).toBe("linear");
    expect(scene.warnings.some((w) => /log/i.test(w))).toBe(true);
  });

  it("set-size bars can be turned off", () => {
    const scene = buildPlotScene(fourSets(), upsetPlot({ showSetSizes: false }));
    expect(scene.upset!.sets.every((s) => s.bar == null)).toBe(true);
  });

  it("counts above bars ride the standard value-label machinery (plot.showValues)", () => {
    const scene = buildPlotScene(fourSets(), upsetPlot({}, { showValues: true }));
    expect(scene.valueLabels?.show).toBe(true);
  });
});

describe("upset — annotations + brackets", () => {
  it("a manual bracket spans drawn intersection columns (1-based, left→right)", () => {
    expect(BRACKET_KINDS.has("upset")).toBe(true);
    const scene = buildPlotScene(fourSets(), upsetPlot({}, {
      // height inside the axis: a hand bracket keeps the exact domain (the bar contract —
      // only role:"significance" brackets get the count-based headroom ladder)
      annotations: [{ id: "br", kind: "bracket", from: 1, to: 2, bracketY: 4.5 }],
    }));
    const br = scene.annotations.find((a) => a.kind === "bracket");
    expect(br, `warnings: ${scene.warnings.join(" | ")}`).toBeTruthy();
    const u = scene.upset!;
    expect(Math.min(br!.x1!, br!.x2!)).toBeCloseTo(u.columns[0]!.cx, 0);
    expect(Math.max(br!.x1!, br!.x2!)).toBeCloseTo(u.columns[1]!.cx, 0);
  });

  it("hlines draw at count values; vlines are refused with the categorical-X reason", () => {
    const scene = buildPlotScene(fourSets(), upsetPlot({}, {
      annotations: [
        { id: "h", kind: "hline", value: 3 },
        { id: "v", kind: "vline", value: 2 },
      ],
    }));
    const h = scene.annotations.find((a) => a.id === "h");
    expect(h).toBeTruthy();
    expect(h!.y1).toBeGreaterThan(scene.plot.y);
    expect(h!.y1).toBeLessThan(scene.plot.y + scene.plot.height);
    expect(scene.annotations.some((a) => a.id === "v")).toBe(false);
    expect(scene.warnings.some((w) => w.includes("continuous X axis"))).toBe(true);
  });
});

describe("upset — the drawing + interactions", () => {
  it("matrix dots, membership connectors and set-size bars render; a set bar click selects the set", () => {
    const scene = buildPlotScene(fourSets(), upsetPlot());
    const onSelect = vi.fn();
    const { container } = render(<PlotFigure scene={scene} selected={null} zoom={1} onSelect={onSelect} />);
    expect(container.querySelectorAll("circle.upsetdot").length).toBe(28); // 4 sets × 7 columns
    expect(container.querySelectorAll("circle.upsetdot.on").length).toBe(11); // memberships
    expect(container.querySelectorAll("line.upsetlink").length).toBe(3); // AB · ABC · BD
    const bars = container.querySelectorAll("rect.upsetsetbar");
    expect(bars.length).toBe(4);
    fireEvent.click(bars[0]!);
    expect(onSelect).toHaveBeenCalledWith({ kind: "upset-set", datasetId: "a" });
    const texts = [...container.querySelectorAll("text")].map((t) => t.textContent);
    expect(texts.some((t) => t?.includes("Set A"))).toBe(true);
  });

  it("an intersection bar click selects the chart section, never a phantom series", () => {
    const scene = buildPlotScene(fourSets(), upsetPlot());
    const onSelect = vi.fn();
    const { container } = render(<PlotFigure scene={scene} selected={null} zoom={1} onSelect={onSelect} />);
    const bar0 = scene.series[0]!.marks[0]!.bar!;
    const rect = [...container.querySelectorAll("rect")].find(
      (r) => Math.abs(Number(r.getAttribute("x")) - bar0.x) < 0.5 && Math.abs(Number(r.getAttribute("width")) - bar0.w) < 0.5,
    );
    expect(rect, "no bar rect drawn").toBeTruthy();
    fireEvent.click(rect!);
    expect(onSelect).toHaveBeenCalled();
    for (const call of onSelect.mock.calls) expect(call[0].kind).not.toBe("series");
  });

  it("a per-set series colour reaches the set's matrix dots and its size bar", () => {
    const scene = buildPlotScene(fourSets(), upsetPlot({}, { seriesStyles: { b: { color: "#ff0000" } } }));
    const u = scene.upset!;
    expect(u.sets[1]!.color).toBe("#ff0000");
    expect(u.sets[0]!.color).not.toBe("#ff0000");
  });
});

describe("upset — refusals + Inspector", () => {
  it("no series legend (stated in its registry)", () => {
    expect(NO_SERIES_LEGEND.has("upset")).toBe(true);
  });

  it("the UpSet section controls write plot.upset (and Counts writes the standard showValues)", () => {
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
      <Inspector activeSection="graphs" selection={{ kind: "plot" }} plot={upsetPlot()} table={fourSets()}
        userPresets={[]} profileDefault={null} wholeGraph={false} onSetWholeGraph={() => {}} {...h} />,
    );
    const row = (label: string) => [...container.querySelectorAll("label")].find((l) => (l.querySelector("span:first-child")?.textContent ?? "").trim() === label);
    const sort = row("Sort by");
    expect(sort, "no UpSet section").toBeTruthy();
    fireEvent.change(sort!.querySelector("select")!, { target: { value: "degree" } });
    expect((onSetPlotOptions.mock.calls.at(-1)![0] as Partial<Plot>).upset?.sortBy).toBe("degree");
    expect(row("Max intersections")).toBeTruthy();
    expect(row("Min size")).toBeTruthy();
    expect(row("Empty intersections")).toBeTruthy();
    expect(row("Set-size bars")).toBeTruthy();
    expect(row("Bar colour")).toBeTruthy();
    expect(row("Dot colour")).toBeTruthy();
    const counts = row("Counts above bars");
    expect(counts).toBeTruthy();
    fireEvent.click(counts!.querySelector("input")!);
    expect((onSetPlotOptions.mock.calls.at(-1)![0] as Partial<Plot>).showValues).toBe(true);
  });
});

describe("upset — the doors", () => {
  it("wizard genre + gallery card exist on the sets format; the card out-draws a Venn", () => {
    expect(TABLE_FORMATS.sets.graphs.some((g) => /upset/i.test(g))).toBe(true);
    const g = NEW_GRAPH_GENRES.find((x) => x.key === "upset");
    expect(g).toBeTruthy();
    expect(g!.formats[0]).toBe("sets");
    const card = galleryItems().find((x) => x.key === "upset");
    expect(card).toBeTruthy();
    const scene = buildPlotScene(card!.table, card!.plot);
    expect(scene.warnings).toEqual([]);
    expect(scene.upset!.sets.length).toBeGreaterThanOrEqual(4); // more sets than a Venn can draw
    expect(scene.upset!.columns.length).toBeGreaterThanOrEqual(6);
  });
});
