// @vitest-environment node
import { describe, expect, it } from "vitest";
import { KIND_HOUSE_DEFAULTS, MadyDocument, STYLE_PRESETS, applyKindHouseDefaults, tableDatasets } from "@mady/core";
import type { Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene.js";

// A ridgeline's fill opacity is set for the whole graph (Ridgeline ▸ Fill opacity, 0.55 by default); a series may
// override it. A preset's `fillOpacity` is a bar / box / area setting (0.95 on four built-ins), so it is not written
// onto the ridgeline series: there it would make each one an override, and the graph-wide control would do nothing.

describe("a ridgeline's fill opacity follows its own graph-wide setting under every preset", () => {
  const make = (): { doc: MadyDocument; plotId: string } => {
    const doc = new MadyDocument();
    const t = doc.addTable("Sites", "column", ["Lake A", "Lake B", "River C"], ["y", "y", "y"]);
    for (let i = 0; i < 24; i++) doc.addRow(t.id, [10 + (i % 7), 14 + (i % 5), 18 + (i % 9)]);
    const p = doc.addPlot("Ridgeline", t.id);
    doc.setPlotKind(p.id, "ridgeline");
    return { doc, plotId: p.id };
  };
  const opacities = (doc: MadyDocument, plotId: string): number[] => {
    const proj = doc.toJSON();
    const plot = proj.plots.find((p) => p.id === plotId)!;
    const table = proj.tables.find((t) => t.id === plot.source)!;
    return buildPlotScene(table, plot as Plot, { width: 600, height: 420 }).series.map((s) => s.fillOpacity);
  };

  for (const preset of STYLE_PRESETS) {
    it(`${preset.name}: no series carries the preset's opacity, so the graph-wide setting governs`, () => {
      const { doc, plotId } = make();
      doc.applyStylePreset(plotId, preset);
      applyKindHouseDefaults(doc, plotId, "ridgeline", tableDatasets);
      const plot = doc.toJSON().plots.find((p) => p.id === plotId)!;
      for (const [id, st] of Object.entries(plot.seriesStyles ?? {})) expect(st.fillOpacity, `${preset.name} · ${id}`).toBeUndefined();
      // …and the drawing shows it: the ridgeline's own default, then whatever the slider is moved to.
      expect(opacities(doc, plotId).every((o) => o === 0.55), `${preset.name}: ${JSON.stringify(opacities(doc, plotId))}`).toBe(true);
      doc.setPlotOptions(plotId, { ridgeline: { fillOpacity: 0.2 } });
      expect(opacities(doc, plotId).every((o) => o === 0.2), `${preset.name} after the slider`).toBe(true);
    });
  }

  it("a series' own opacity, set afterwards, still overrides the graph-wide one", () => {
    const { doc, plotId } = make();
    doc.applyStylePreset(plotId, STYLE_PRESETS[1]!);
    applyKindHouseDefaults(doc, plotId, "ridgeline", tableDatasets);
    const first = tableDatasets(doc.toJSON().tables[0]!)[0]!;
    doc.setSeriesStyle(plotId, first.id, { fillOpacity: 0.9 });
    const o = opacities(doc, plotId);
    expect(o[0]).toBe(0.9);
    expect(o.slice(1).every((v) => v === 0.55)).toBe(true);
  });

  it("the ridgeline house default clears the series opacity", () => {
    expect(KIND_HOUSE_DEFAULTS.ridgeline?.series).toHaveProperty("fillOpacity", undefined);
  });
});
