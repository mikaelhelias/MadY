/**
 * A preset restyles the whole graph: on every chart type, a graph whose axis fonts, data colours and the chart's own
 * label sizes were changed by hand draws exactly what the same preset draws on the untouched graph. Guards against a
 * hand-set axis label or title size (`AxisSpec.tickFont` / `titleFont`), a category colour
 * (`SeriesStyle.colorFromColors`) and a chart's own label size (a heatmap's row / column labels, the radar's spoke
 * labels, the significance stars, …) outliving every preset, built-in or saved, so that every preset looks the same.
 *
 * The comparison is the whole built drawing, so any hand edit that survives shows up, not only the ones named here.
 */
import { describe, expect, it } from "vitest";
import { MadyDocument, STYLE_PRESETS } from "@mady/core";
import type { DataTable, Plot, Project, SeriesStyle } from "@mady/core";
import { buildPlotScene, ddColorMode, ddRowCategory } from "@mady/graphics";
import { galleryItems } from "./gallery";
import { captureSharedStyle } from "./presetKeys";
import { scenePaletteOpt } from "./scenePalette";
import { applyPresetWithKindDefaults, applyUserPresetWithKindDefaults } from "./seedStyle";

const measure = (t: string, px: number): number => t.length * px * 0.6; // node has no canvas
const SIZE = { width: 580, height: 380 };
const AXES = ["xAxis", "yAxis", "y2Axis", "y3Axis", "zAxis"] as const;

/** A chart type's own label sizes: the block, the field, and whether it holds a font or a bare size. */
const KIND_LABELS: readonly { block: string; field: string; font: boolean; kinds: readonly string[] }[] = [
  { block: "heatmap", field: "labelFont", font: true, kinds: ["heatmap"] },
  { block: "heatmap", field: "splitLabelFont", font: true, kinds: ["heatmap"] },
  { block: "heatmap", field: "trackFont", font: true, kinds: ["heatmap"] },
  { block: "heatmap", field: "colorbarFont", font: true, kinds: ["heatmap"] },
  { block: "corrmatrix", field: "labelFont", font: true, kinds: ["corrmatrix"] },
  { block: "radar", field: "labelFont", font: true, kinds: ["radar"] },
  { block: "radar", field: "ringFont", font: true, kinds: ["radar"] },
  { block: "network", field: "labelSize", font: false, kinds: ["network"] },
  { block: "treemap", field: "labelSize", font: false, kinds: ["treemap"] },
  { block: "sunburst", field: "labelSize", font: false, kinds: ["sunburst"] },
  { block: "chord", field: "labelSize", font: false, kinds: ["chord"] },
  { block: "oncoprint", field: "labelSize", font: false, kinds: ["oncoprint"] },
  // The bar and raincloud cards draw significance marks without a block of their own; any other graph with one too.
  { block: "significance", field: "labelSize", font: false, kinds: ["bar", "raincloud"] },
];

/** The chart's own label sizes set by hand, on the charts that draw them. */
function labelsEdited(p: Plot, only?: (typeof KIND_LABELS)[number]): Plot {
  const out = JSON.parse(JSON.stringify(p)) as Plot & Record<string, unknown>;
  for (const l of only ? [only] : KIND_LABELS) {
    const has = l.kinds.includes(out.kind ?? "xy") || (l.block === "significance" && out[l.block] !== undefined);
    if (!has) continue;
    out[l.block] = { ...((out[l.block] as object | undefined) ?? {}), [l.field]: l.font ? { size: 23 } : 23 };
  }
  if (!only && out.kind === "survival") out.survivalAtRiskFont = { size: 23 };
  return out;
}

/** The hand edits: every axis the graph has gets its own label and title size, every series its own colour, a
 *  series coloured by categories its first category's colour, and the chart's own label sizes are set. */
function handEdited(plot: Plot, table: DataTable): Plot {
  const p = labelsEdited(plot);
  p.legend = { ...(p.legend ?? {}), background: true, backgroundColor: "#ffeecc" };
  // Ticks, gaps and the grid's look.
  p.tickLen = 14;
  p.grid = { ...(p.grid ?? {}), show: true, width: 3, dash: "dotted", color: "#ff8800", density: 12 };
  for (const a of AXES) {
    if (a === "xAxis" || a === "yAxis" || p[a]) p[a] = { ...(p[a] ?? {}), tickFont: { size: 23 }, titleFont: { size: 25 } };
  }
  for (const a of AXES) if (p[a]) p[a] = { ...p[a], tickWidth: 4, titleGap: 40, tickLabelGap: 15 };
  const styles: Record<string, SeriesStyle> = { ...(p.seriesStyles ?? {}) };
  for (const [id, st] of Object.entries(styles)) {
    // Colour, a marker shape and see-through markers. A series drawn without markers stays so: giving it a shape
    // would switch its markers on, which no preset switches off again.
    const next: SeriesStyle = { ...st, color: "#ff00ff", symbol: st?.symbol === "none" ? "none" : "diamond", symbolOpacity: 0.35 };
    const col = st?.colorFromColumn;
    if (col && ddColorMode(st, table, col) === "category") {
      const cat = table.rows.map((r) => ddRowCategory(table, col, r.id)).find((c) => c !== null);
      if (cat != null) next.colorFromColors = { [cat]: "#00ff66" };
    }
    styles[id] = next;
  }
  p.seriesStyles = styles;
  return p;
}

const drawing = (table: DataTable, plot: Plot): string => JSON.stringify(buildPlotScene(table, plot, { measure, ...SIZE, ...scenePaletteOpt(plot) }));

function applied(item: ReturnType<typeof galleryItems>[number], plot: Plot, apply: (doc: MadyDocument, id: string, kind: Plot["kind"]) => void): string {
  const project: Project = {
    schemaVersion: 4, tables: [item.table, ...(item.extraTables ?? [])], plots: [JSON.parse(JSON.stringify(plot)) as Plot],
    analyses: [], log: [], workspace: { folders: [], loose: [] },
  };
  const doc = new MadyDocument(project);
  apply(doc, plot.id, plot.kind);
  return drawing(item.table, doc.toJSON().plots[0]!);
}

describe("a preset replaces the axis fonts and data colours set by hand, on every chart type", () => {
  const items = galleryItems();

  it("the fixture can show the bug: the hand edits change the drawing of nearly every card before any preset", () => {
    const moved = items.filter((it) => drawing(it.table, handEdited(it.plot, it.table)) !== drawing(it.table, it.plot));
    expect(items.length).toBeGreaterThan(55);
    expect(moved.length, "the hand edits draw nothing on most cards — this would prove nothing").toBeGreaterThan(items.length - 5);
    expect(items.filter((it) => Object.values(it.plot.seriesStyles ?? {}).some((st) => st?.colorFromColumn)).length,
      "no card is coloured by a column — the category colour is not exercised").toBeGreaterThanOrEqual(2);
  });

  it("the fixture can show the bug for each chart's own label sizes: every one changes some card's drawing", () => {
    const dead = KIND_LABELS.filter((l) => !items.some((it) => drawing(it.table, labelsEdited(it.plot, l)) !== drawing(it.table, it.plot)))
      .map((l) => `${l.block}.${l.field}`);
    const survival = items.find((it) => it.plot.kind === "survival")!;
    if (drawing(survival.table, { ...survival.plot, survivalAtRiskFont: { size: 23 } }) === drawing(survival.table, survival.plot)) dead.push("survivalAtRiskFont");
    expect(dead, "label sizes that draw nothing on any card — this would prove nothing for them").toEqual([]);
  });

  it.each(STYLE_PRESETS.map((p) => [p.name, p] as const))("built-in preset %s", (_name, preset) => {
    const kept = items
      .filter((it) => applied(it, handEdited(it.plot, it.table), (d, id, k) => applyPresetWithKindDefaults(d, id, k, preset)) !== applied(it, it.plot, (d, id, k) => applyPresetWithKindDefaults(d, id, k, preset)))
      .map((it) => it.key);
    expect(kept, "cards where a hand edit outlives the preset").toEqual([]);
  });

  it("one preset leaves nothing of its own look under the next: every preset after every other one", () => {
    const kept: string[] = [];
    for (const first of STYLE_PRESETS) {
      for (const preset of STYLE_PRESETS.filter((p) => p !== first)) {
        for (const it of items) {
          const after = applied(it, it.plot, (d, id, k) => { applyPresetWithKindDefaults(d, id, k, first); applyPresetWithKindDefaults(d, id, k, preset); });
          if (after !== applied(it, it.plot, (d, id, k) => applyPresetWithKindDefaults(d, id, k, preset))) kept.push(`${it.key}: ${first.name} → ${preset.name}`);
        }
      }
    }
    expect(kept, "cards where the earlier preset's look outlives the later one").toEqual([]);
  }, 120_000);

  it("a saved preset", () => {
    const src = items[0]!;
    const saved = { style: captureSharedStyle(src.plot), palette: ["#123456", "#abcdef", "#fedcba"] };
    const kept = items
      .filter((it) => applied(it, handEdited(it.plot, it.table), (d, id, k) => applyUserPresetWithKindDefaults(d, id, k, saved)) !== applied(it, it.plot, (d, id, k) => applyUserPresetWithKindDefaults(d, id, k, saved)))
      .map((it) => it.key);
    expect(kept, "cards where a hand edit outlives the saved preset").toEqual([]);
  });

  it("a saved preset from a graph without some axis still clears that axis's own fonts", () => {
    const it0 = items.find((it) => it.key === "bubblecats")!;
    const style = captureSharedStyle(it0.plot);
    delete style.xAxis;
    delete style.yAxis;
    const saved = { style, palette: ["#123456"] };
    const edited = applied(it0, handEdited(it0.plot, it0.table), (d, id, k) => applyUserPresetWithKindDefaults(d, id, k, saved));
    const plain = applied(it0, it0.plot, (d, id, k) => applyUserPresetWithKindDefaults(d, id, k, saved));
    expect(edited).toBe(plain);
  });
});
