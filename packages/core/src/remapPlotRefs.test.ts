/**
 * Two guards on `remapPlotIds`:
 *  1. a CENSUS read off `model.ts` — every NodeId-typed field reachable from `Plot` must be
 *     either remapped here or excused with a reason (default-deny: a new binding field fails);
 *  2. a SENTINEL — a plot pointing every binding at old ids comes back with none of them.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plot } from "./model";
import { remapPlotIds, stripPlotRefs } from "./remapPlotRefs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MODEL = readFileSync(join(HERE, "model.ts"), "utf8").replace(/\r\n/g, "\n"); // CRLF checkout

/** Every `export interface X { … }` body in model.ts, by name. */
function interfaces(): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of MODEL.matchAll(/^export interface (\w+)[^{]*\{\n([\s\S]*?)^\}/gm)) out.set(m[1]!, m[2]!);
  return out;
}

/** Field name → type text, for one interface body (doc comments stripped). */
function fields(body: string): [string, string][] {
  const clean = body.replace(/\/\*\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  return [...clean.matchAll(/^\s*(\w+)\??:\s*([^;]+);/gm)].map((m) => [m[1]!, m[2]!.trim()]);
}

/** `Interface.field` for every NodeId-typed field reachable from Plot. */
function nodeIdFieldsReachableFromPlot(): string[] {
  const all = interfaces();
  const seen = new Set<string>();
  const queue = ["Plot"];
  const found: string[] = [];
  while (queue.length) {
    const name = queue.shift()!;
    if (seen.has(name) || !all.has(name)) continue;
    seen.add(name);
    for (const [f, t] of fields(all.get(name)!)) {
      if (/\bNodeId\b/.test(t)) found.push(`${name}.${f}`);
      for (const ref of t.matchAll(/\b([A-Z]\w+)\b/g)) if (all.has(ref[1]!)) queue.push(ref[1]!);
    }
  }
  return found.sort();
}

/** Remapped by `remapPlotIds` — keep in step with the function. */
const COVERED = [
  "Plot.seriesStyles", "Plot.barSeriesGroups", "Plot.splitFrom", // (`Plot.overlays` is typed PlotOverlay[]; its ids are listed under PlotOverlay)
  "SeriesStyle.colorFromColumn", "SeriesStyle.symbolFromColumn", "SeriesStyle.pointLabelColumn", "SeriesStyle.highlightColumn",
  "CategoryGroupSpec.column",
  "TreemapStyle.groupColumn", "TreemapStyle.iconColumn",
  "ParallelStyle.colorColumn", "ParallelStyle.axisOrder", "ParallelStyle.perAxis",
  "AlluvialStyle.columns",
  "NetworkStyle.groupColumn", "NetworkStyle.sizeColumn",
  "HeatTrack.column",
  "QQStyle.pColumn",
  "ManhattanStyle.pColumn", "ManhattanStyle.chrColumn", "ManhattanStyle.posColumn",
  "SunburstStyle.levelColumns", "SunburstStyle.valueColumn",
  "ChordStyle.sourceColumn", "ChordStyle.targetColumn", "ChordStyle.weightColumn", "ChordStyle.groupColumn",
  "OncoprintStyle.sampleColumn", "OncoprintStyle.geneColumn", "OncoprintStyle.alterationColumn",
  "VennStyle.labelOffsets", "UpsetStyle.labelOffsets", "TernaryStyle.axisLabelOff",
  "PlotOverlay.table", "PlotOverlay.column",
  "PlotFit.analysisSource",
];
/** NodeId-typed but NOT a sheet reference — say why. */
const EXCUSED: Record<string, string> = {
  "Plot.id": "the plot's own id — insertGraph mints a fresh one itself",
  "Plot.source": "the source table id — insertGraph points it at the new table itself",
  "Annotation.id": "an annotation's own id (plot-scoped, re-minted by clonePlot)",
  "Annotation.group": "an annotation GROUP id — names other annotations, not the sheet",
  "PlotOverlay.id": "the overlay's own id",
  "Plot.analysisSource": "the ANALYSIS that spawned the plot (lineage), not the sheet — a card has none",
  "SignificanceRef.analysisId": "the ANALYSIS a significance marker came from, not the sheet",
};
/** Typed `Record<string, …>` yet keyed by sheet ids — invisible to the census, covered by the
 *  sentinel below: `Plot.pointStyles` (`column:row`), `ParallelStyle.brushes`, `HeatTrack.values`. */

describe("remapPlotIds knows every sheet reference a plot can hold", () => {
  it("census: every NodeId-typed field reachable from Plot is remapped or excused", () => {
    const found = nodeIdFieldsReachableFromPlot();
    expect(found.length, "the census read nothing — the model parse is broken").toBeGreaterThan(20);
    const known = new Set([...COVERED, ...Object.keys(EXCUSED)]);
    const unknown = found.filter((f) => !known.has(f));
    expect(unknown, `NodeId-typed fields remapPlotIds does not know — add them to the function (and COVERED) or excuse them with a reason: ${unknown.join(", ")}`).toEqual([]);
    const stale = [...known].filter((k) => !found.includes(k));
    expect(stale, `listed but no longer in the model: ${stale.join(", ")}`).toEqual([]);
  });

  it("sentinel: a plot pointing every binding at old ids comes back with none of them", () => {
    const plot = everyBinding();
    const map: Record<string, string> = { cx: "X", c1: "A", c2: "B", c3: "C", c9: "Z", row2: "R2", t2: "T2", an1: "ANALYSIS" };
    const out = remapPlotIds(plot, (id) => map[id] ?? id);
    const json = JSON.stringify(out);
    const leaked = Object.keys(map).filter((id) => new RegExp(`"${id}"|"${id}:|:${id}"`).test(json));
    expect(leaked).toEqual([]);
    expect(Object.keys(out.pointStyles!)).toEqual(["A:R2", "B:SomeCategory"]); // an unknown second half is kept
    expect(out.overlays).toEqual([{ id: "ov", table: "T2", column: "Z" }]);
    expect(JSON.stringify(plot)).toContain('"c1:row2"'); // the input is untouched
  });
});

/** A plot pointing EVERY binding the model has at sheet ids — shared by both sentinel tests. */
function everyBinding(): Plot {
  return {
      id: "p", name: "P", kind: "xy", source: "t", status: "ok", styleOverrides: {},
      seriesStyles: { c1: { colorFromColumn: "c3", symbolFromColumn: "c3", pointLabelColumn: "c3", highlightColumn: "c2" } },
      pointStyles: { "c1:row2": { color: "#123456" }, "c2:SomeCategory": { color: "#654321" } },
      barSeriesGroups: { c1: "G1", c2: "G2" },
      splitFrom: { plot: "p0", series: "c1" },
      xAxis: { categoryGroups: { column: "c3" } }, y2Axis: { categoryGroups: { column: "c1" } },
      treemap: { groupColumn: "c3", iconColumn: "c2" },
      parallel: { colorColumn: "c3", axisOrder: ["c2", "c1"], brushes: { c1: [0, 1] }, perAxis: { c2: { tickCount: 5 } } },
      alluvial: { columns: ["c3", "c1"] },
      network: { groupColumn: "c3", sizeColumn: "c2" },
      heatmap: { rowTracks: [{ column: "c3" }], colTracks: [{ values: { c1: "a", c2: "b" } }] },
      qq: { pColumn: "c2" },
      manhattan: { pColumn: "c2", chrColumn: "c1", posColumn: "cx" },
      sunburst: { levelColumns: ["c3"], valueColumn: "c1" },
      chord: { sourceColumn: "c3", targetColumn: "c1", weightColumn: "c2", groupColumn: "cx" },
      oncoprint: { sampleColumn: "cx", geneColumn: "c1", alterationColumn: "c3" },
      venn: { labelOffsets: { c1: { dx: 1, dy: 1 } } },
      upset: { labelOffsets: { c2: { dx: 1, dy: 1 } } },
      ternary: { axisLabelOff: { c1: { dx: 1, dy: 1 } } },
      overlays: [{ id: "ov", table: "t2", column: "c9" }],
      fit: { label: "Fit", points: [[1,2]], analysisSource: "an1" },
      fits: [{ label: "Global", points: [[1,3]], analysisSource: "an1" }],
  };
}

/**
 * `stripPlotRefs` — a captured STYLE must not carry another sheet's column / row / table ids.
 * Built on `remapPlotIds`, so the census above keeps it complete; this pins what "stripped"
 * means: no id, no sentinel left behind, no container emptied by the stripping, no heatmap
 * track without its binding — and everything that is NOT a reference kept as it was.
 */
describe("stripPlotRefs drops every sheet reference and nothing else", () => {
  const IDS = ["cx", "c1", "c2", "c3", "c9", "row2", "t2", "an1"];
  const emptyContainers = (node: unknown, path = "plot"): string[] => {
    if (Array.isArray(node)) return node.length === 0 ? [path] : node.flatMap((v, i) => emptyContainers(v, `${path}[${i}]`));
    if (node && typeof node === "object") {
      const keys = Object.keys(node as object);
      return keys.length === 0 ? [path] : keys.flatMap((k) => emptyContainers((node as Record<string, unknown>)[k], `${path}.${k}`));
    }
    return [];
  };

  it("the every-binding plot comes back with no id, no sentinel and no emptied container", () => {
    const plot: Plot = {
      ...everyBinding(),
      barWidth: 0.5,
      heatmap: { rowTracks: [{ column: "c3", name: "Tissue" }], colTracks: [{ values: { c1: "a", c2: "b" } }], colormap: "reds" },
    };
    const before = JSON.stringify(plot);
    const out = stripPlotRefs(plot);
    const json = JSON.stringify(out);
    const leaked = IDS.filter((id) => new RegExp(`"${id}"|"${id}:|:${id}"`).test(json));
    expect(leaked, "sheet ids survived the strip").toEqual([]);
    expect(json.includes("stripped-ref"), "the stripping sentinel leaked into the output").toBe(false);
    // Only containers the stripping EMPTIED count: styleOverrides is {} on the way in as well.
    const emptiedByStrip = emptyContainers(out).filter((path) => !emptyContainers(plot).includes(path));
    expect(emptiedByStrip, "a container emptied by the stripping was left behind").toEqual([]);
    // Bindings whose whole meaning was the id are gone, not left as husks.
    expect(out.pointStyles).toBeUndefined();
    expect(out.seriesStyles).toBeUndefined();
    expect(out.barSeriesGroups).toBeUndefined();
    expect(out.overlays).toBeUndefined();
    expect(out.xAxis, "categoryGroups held only a column, so the axis spec is empty and goes").toBeUndefined();
    expect(out.heatmap?.rowTracks, "a track without its column is a dead track, not a style").toBeUndefined();
    expect(out.heatmap?.colTracks).toBeUndefined();
    // …and everything that is not a reference is kept exactly.
    expect(out.barWidth).toBe(0.5);
    expect(out.heatmap?.colormap).toBe("reds");
    expect(out.parallel?.perAxis, "an id-keyed record loses its keys and so itself").toBeUndefined();
    expect(JSON.stringify(plot), "the input must be untouched").toBe(before);
  });

  it("a plot with no references is returned as an equal deep copy", () => {
    const plot: Partial<Plot> = { barWidth: 0.4, heatmap: { colormap: "viridis", cellBorderWidth: 2 }, fonts: { title: { size: 20 } } };
    const out = stripPlotRefs(plot);
    expect(out).toEqual(plot);
    expect(out).not.toBe(plot);
  });
});
