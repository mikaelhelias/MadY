/**
 * The two pieces a preset apply uses to drop what was set by hand: an axis's own fonts, and colours the preset's
 * palette loop never reaches (category colours, and series that are not datasets). Applying a preset and undoing it
 * puts every one of them back.
 */
import { describe, expect, it } from "vitest";
import { axisWithoutFonts, axisWithoutPresetLook, kindLabelSizesCleared, MadyDocument, PRESET_LEGEND_KEYS, stylesWithoutHandColours } from "./document.js";
import { STYLE_PRESETS } from "./presets.js";
import type { Plot, Project } from "./model.js";

describe("axisWithoutFonts", () => {
  it("drops the label and title fonts and keeps the rest of the axis", () => {
    expect(axisWithoutFonts({ title: "Dose", lineWidth: 2, tickFont: { size: 23 }, titleFont: { size: 25 } })).toEqual({ title: "Dose", lineWidth: 2 });
  });
  it("hands back the same object when there is nothing to drop", () => {
    const a = { title: "Dose" };
    expect(axisWithoutFonts(a)).toBe(a);
    expect(axisWithoutFonts(undefined)).toBeUndefined();
  });
});

describe("axisWithoutPresetLook", () => {
  it("drops the fonts, the tick thickness and both gaps, and keeps the rest of the axis", () => {
    expect(axisWithoutPresetLook({ title: "Dose", min: 0, tickFont: { size: 23 }, tickWidth: 4, titleGap: 40, tickLabelGap: 15 })).toEqual({ title: "Dose", min: 0 });
  });
  it("hands back the same object when there is nothing to drop", () => {
    const a = { title: "Dose" };
    expect(axisWithoutPresetLook(a)).toBe(a);
  });
});

describe("kindLabelSizesCleared", () => {
  it("removes a chart's own label sizes from their blocks, keeps the rest of each block, and clears the at-risk font", () => {
    const plot = {
      heatmap: { labelFont: { size: 23 }, colormap: "viridis" }, treemap: { labelSize: 23, gap: 2 },
      significance: { labelSize: 23 }, survivalAtRiskFont: { size: 23 },
    } as unknown as Plot;
    const patch = kindLabelSizesCleared(plot);
    expect(patch).toEqual({ heatmap: { colormap: "viridis" }, treemap: { gap: 2 }, significance: {}, survivalAtRiskFont: undefined });
    expect("labelFont" in (patch.heatmap as object), "the field must be gone, not empty: the kind defaults fill only what is missing").toBe(false);
  });
  it("is empty when the graph has none", () => {
    expect(kindLabelSizesCleared({ heatmap: { colormap: "viridis" } } as unknown as Plot)).toEqual({});
  });
});

describe("stylesWithoutHandColours", () => {
  it("drops category colours everywhere and the colour of a series that is not a dataset", () => {
    const out = stylesWithoutHandColours({
      a: { color: "#111111", colorFromColumn: "g", colorFromColors: { A: "#ff0000" }, symbolSize: 6 },
      "est-diff": { color: "#00ff00", symbolSize: 9 },
    }, new Set(["a"]));
    expect(out).toEqual({ a: { color: "#111111", colorFromColumn: "g", symbolSize: 6 }, "est-diff": { symbolSize: 9 } });
  });
});

describe("the legend's box", () => {
  it("every legend field a built-in preset sets is one a preset clears (else it would stay under the next preset)", () => {
    const set = new Set(STYLE_PRESETS.flatMap((p) => Object.keys(p.legend ?? {})));
    expect(set.size, "no built-in preset sets a legend field — this proves nothing").toBeGreaterThan(0);
    for (const k of set) expect(PRESET_LEGEND_KEYS as readonly string[], `legend.${k}`).toContain(k);
  });

  it("one preset's legend box does not stay under the next, and undo brings it back", () => {
    const withBox = STYLE_PRESETS.find((p) => p.legend?.background)!;
    const without = STYLE_PRESETS.find((p) => !p.legend)!;
    const project = {
      schemaVersion: 4, analyses: [], log: [], workspace: { folders: [], loose: [] },
      plots: [{ id: "p", name: "P", kind: "xy", source: "t", status: "ok", styleOverrides: {}, legend: { show: true } }],
      tables: [{ id: "t", kind: "xy", name: "T", columns: [{ id: "x", name: "X" }, { id: "y", name: "Y" }], rows: [{ id: "r0", cells: { x: 1, y: 2 } }] }],
    } as unknown as Project;
    const doc = new MadyDocument(project);
    doc.applyStylePreset("p", withBox);
    expect(doc.toJSON().plots[0]!.legend?.background).toBe(true);
    doc.applyStylePreset("p", without);
    expect(doc.toJSON().plots[0]!.legend).toEqual({ show: true });
    doc.commands.undo();
    expect(doc.toJSON().plots[0]!.legend?.background).toBe(true);
  });
});

describe("applyStylePreset clears the hand edits, and undo restores them", () => {
  it("every axis's fonts and the category colours", () => {
    const plot = {
      id: "p", name: "P", kind: "xy", source: "t", status: "ok", styleOverrides: {},
      xAxis: { tickFont: { size: 23 } }, yAxis: { titleFont: { size: 25 } }, y2Axis: { tickFont: { size: 21 } },
      seriesStyles: { y: { colorFromColumn: "g", colorFromColors: { A: "#ff0000" } } },
    } as unknown as Plot;
    const project = {
      schemaVersion: 4, analyses: [], log: [], workspace: { folders: [], loose: [] }, plots: [plot],
      tables: [{ id: "t", kind: "xy", name: "T", columns: [{ id: "x", name: "X" }, { id: "y", name: "Y" }, { id: "g", name: "G", type: "text" }], rows: [{ id: "r0", cells: { x: 1, y: 2, g: "A" } }] }],
    } as unknown as Project;
    const doc = new MadyDocument(project);
    doc.applyStylePreset("p", STYLE_PRESETS[1]!);
    const after = doc.toJSON().plots[0]!;
    expect(after.xAxis?.tickFont).toBeUndefined();
    expect(after.yAxis?.titleFont).toBeUndefined();
    expect(after.y2Axis?.tickFont).toBeUndefined();
    expect(after.seriesStyles?.["y"]?.colorFromColors).toBeUndefined();
    doc.commands.undo();
    const back = doc.toJSON().plots[0]!;
    expect(back.xAxis?.tickFont).toEqual({ size: 23 });
    expect(back.yAxis?.titleFont).toEqual({ size: 25 });
    expect(back.y2Axis?.tickFont).toEqual({ size: 21 });
    expect(back.seriesStyles?.["y"]?.colorFromColors).toEqual({ A: "#ff0000" });
  });
});
