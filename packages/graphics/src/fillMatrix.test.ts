// Fill-mode × chart-kind matrix. Guards against a scene builder that builds its own
// markers/fills and silently drops a fill mode (for example, a builder passing a raw
// "twotone" symbolFill that the renderer cannot fill, which draws a hollow marker).
//
// Two layers:
//  1. Per marker-kind: every symbolFill mode resolves to a renderer-drawable value
//     (twotone → an `open` marker with a concrete light fill + dark outline, never a
//     raw "twotone"/hollow).
//  2. Whole-scene scan: no built scene, for any kind, may leak a raw
//     `symbolFill:"twotone"` — it must always be resolved before it reaches SVG.
import { describe, it, expect } from "vitest";
import type { DataTable, Plot, PlotKind, SeriesStyle } from "@mady/core";
import { buildPlotScene } from "./buildScene.js";

const OPTS = { width: 480, height: 320 };
const mkPlot = (kind: PlotKind, source: string, extra: Partial<Plot> = {}): Plot => ({
  id: "p", name: "P", source, status: "ok", styleOverrides: {}, kind, ...extra,
});

// ── tables ───────────────────────────────────────────────────────────────────
const xyTable: DataTable = {
  id: "xy", kind: "xy", name: "XY",
  columns: [{ id: "x", name: "X", role: "x" }, { id: "y", name: "Y", role: "y" }],
  rows: [1, 2, 3, 4, 5].map((v, i) => ({ id: `r${i}`, cells: { x: v, y: v * 2 } })),
};
const catTable: DataTable = {
  id: "cat", kind: "column", name: "Cat",
  columns: [{ id: "c", name: "Group", role: "x" }, { id: "v", name: "Value", role: "y" }],
  rows: [["A", 20], ["B", 35], ["C", 10]].map(([c, v], i) => ({ id: `r${i}`, cells: { c: c as string, v: v as number } })),
};

const hex = (s: string): number[] => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];

// ── layer 1: marker kinds × symbolFill modes ──────────────────────────────────
// Each entry knows how to pull its primary resolved marker out of the scene.
type MarkerStyle = Pick<SeriesScene, "symbolFill" | "symbolFillColor" | "symbolOutline">;
interface SeriesScene { symbolFill?: string | undefined; symbolFillColor?: string | undefined; symbolOutline?: string | undefined }

const MARKER_KINDS: {
  kind: PlotKind;
  table: DataTable;
  seriesId: string;
  marker: (scene: ReturnType<typeof buildPlotScene>) => MarkerStyle;
}[] = [
  { kind: "xy", table: xyTable, seriesId: "y", marker: (s) => s.series[0]! },
  { kind: "scatter", table: catTable, seriesId: "v", marker: (s) => s.series[0]! },
  { kind: "lollipop", table: catTable, seriesId: "v", marker: (s) => s.lollipop!.rows[0]!.dots[0]! },
];

const BASE = "#2266cc";

describe("fill matrix — marker kinds resolve every symbolFill mode", () => {
  for (const { kind, table, seriesId } of MARKER_KINDS) {
    const style = (fill: SeriesStyle["symbolFill"]): Partial<Plot> => ({
      seriesStyles: { [seriesId]: { color: BASE, symbolFill: fill } },
    });
    const markerOf = MARKER_KINDS.find((m) => m.kind === kind)!.marker;

    it(`${kind}: two-tone → filled open marker with light interior + dark edge (never hollow)`, () => {
      const m = markerOf(buildPlotScene(table, mkPlot(kind, table.id, style("twotone")), OPTS));
      expect(m.symbolFill).toBe("open");
      expect(m.symbolFillColor).toBeTruthy();
      expect(m.symbolOutline).toBeTruthy();
      const base = hex(BASE), fill = hex(m.symbolFillColor!), edge = hex(m.symbolOutline!);
      for (let i = 0; i < 3; i++) {
        expect(fill[i]!).toBeGreaterThanOrEqual(base[i]!); // interior lighter
        expect(edge[i]!).toBeLessThanOrEqual(base[i]!); // outline darker
      }
    });

    it(`${kind}: solid stays solid, open stays open`, () => {
      const solid = markerOf(buildPlotScene(table, mkPlot(kind, table.id, style("solid")), OPTS));
      expect(solid.symbolFill).toBe("solid");
      const open = markerOf(buildPlotScene(table, mkPlot(kind, table.id, style("open")), OPTS));
      expect(open.symbolFill).toBe("open");
    });

    it(`${kind}: a custom two-tone edge colour overrides the derived edge (interior unchanged)`, () => {
      const seriesId = MARKER_KINDS.find((m) => m.kind === kind)!.seriesId;
      const derived = markerOf(buildPlotScene(table, mkPlot(kind, table.id, { seriesStyles: { [seriesId]: { color: BASE, symbolFill: "twotone" } } }), OPTS));
      const custom = markerOf(buildPlotScene(table, mkPlot(kind, table.id, { seriesStyles: { [seriesId]: { color: BASE, symbolFill: "twotone", twoToneEdge: "#ff0000" } } }), OPTS));
      expect(derived.symbolOutline).not.toBe("#ff0000");
      expect(custom.symbolOutline).toBe("#ff0000"); // edit the line/edge for any fill
      expect(custom.symbolFillColor).toBe(derived.symbolFillColor); // interior still hue-derived
    });
  }
});

// ── layer 2: no raw two-tone leaks into any built scene ───────────────────────
// A raw `symbolFill:"twotone"` reaching the scene = a bespoke builder that forgot
// to resolve it. Build a representative scene for every
// kind with a two-tone request and assert none leaks.
const ALL_KINDS: { kind: PlotKind; table: DataTable }[] = [
  { kind: "xy", table: xyTable },
  { kind: "scatter", table: catTable },
  { kind: "bar", table: catTable },
  { kind: "box", table: catTable },
  { kind: "violin", table: catTable },
  { kind: "lollipop", table: catTable },
  { kind: "area", table: xyTable },
  { kind: "pie", table: catTable },
];

describe("fill matrix — no built scene leaks a raw two-tone marker", () => {
  for (const { kind, table } of ALL_KINDS) {
    it(`${kind}: scene contains no unresolved symbolFill:"twotone"`, () => {
      const seriesId = table === xyTable ? "y" : "v";
      const scene = buildPlotScene(
        table,
        mkPlot(kind, table.id, {
          seriesStyles: { [seriesId]: { color: BASE, symbolFill: "twotone", fillType: "twotone" } },
        }),
        OPTS,
      );
      expect(JSON.stringify(scene)).not.toContain('"symbolFill":"twotone"');
    });
  }
});

// ── layer 3: the per-point two-tone edge ──────────────────────────────────────
// "Custom edge colour" is offered on the per-point panel as well as the per-series one, and
// `twoToneEdge` is in the Inspector's POINT_KEYS — so ticking it on one point writes
// `pointStyles[col:row].twoToneEdge`. `paintPointStyles` has to read that field rather than
// recompute the outline from `twoToneShade`, or the control is inert on every kind whose
// marks take per-point styling. The same code path could also drop a series-level custom edge
// the moment any per-point override exists, which is why both are asserted here.
describe("fill matrix — a per-point two-tone edge reaches the mark", () => {
  const twoTonePlot = (extra: Partial<Plot>): Plot =>
    mkPlot("xy", xyTable.id, { seriesStyles: { y: { color: BASE, symbolFill: "twotone" } }, ...extra });
  const markOf = (plot: Plot, rowId: string): { symbolOutline?: string; symbolFillColor?: string } =>
    buildPlotScene(xyTable, plot, OPTS).series[0]!.marks.find((m) => m.rowId === rowId)!;

  it("a custom edge on one point colours that point only", () => {
    const scene = twoTonePlot({ pointStyles: { "y:r0": { twoToneEdge: "#ff0000" } } });
    expect(markOf(scene, "r0").symbolOutline, "the per-point Custom edge colour never reached the drawing").toBe("#ff0000");
    expect(markOf(scene, "r1").symbolOutline).not.toBe("#ff0000");
  });

  it("the point's interior still derives from its hue", () => {
    // Note: a mark with no override carries no `symbolFillColor` of its own — it inherits the
    // series'. The comparison is therefore against the series value, not against the other mark.
    const plot = twoTonePlot({ pointStyles: { "y:r0": { twoToneEdge: "#ff0000" } } });
    const scene = buildPlotScene(xyTable, plot, OPTS);
    expect(markOf(plot, "r0").symbolFillColor).toBe(scene.series[0]!.symbolFillColor);
  });

  it("a per-point recolour does not silently clear a series-level custom edge", () => {
    const plot = mkPlot("xy", xyTable.id, {
      seriesStyles: { y: { color: BASE, symbolFill: "twotone", twoToneEdge: "#ff0000" } },
      pointStyles: { "y:r0": { color: "#00aa55" } },
    });
    expect(markOf(plot, "r0").symbolOutline, "recolouring a point threw away the series' pinned edge colour").toBe("#ff0000");
  });
});
