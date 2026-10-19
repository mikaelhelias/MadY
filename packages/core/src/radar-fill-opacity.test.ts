// @vitest-environment node
import { describe, expect, it } from "vitest";
import { KIND_HOUSE_DEFAULTS, STYLE_PRESETS, applyKindHouseDefaults } from "./presets";
import { MadyDocument } from "./document";
import { tableDatasets } from "./dataset";

/**
 * A preset's `fillOpacity` is a bar / box / area setting (0.95 on four built-ins). A radar draws its series as
 * overlapping polygons, which only read through a translucent fill, so the radar's house default sets its own:
 * under any built-in preset each polygon keeps the translucent fill the radar is drawn with by default (0.18).
 */
describe("radar polygons stay translucent under every preset", () => {
  const radar = (): { doc: MadyDocument; plotId: string } => {
    const doc = new MadyDocument();
    const t = doc.addTable("Models", "grouped", ["Attribute", "Model A", "Model B", "Model C"]);
    for (const r of [["Speed", 80, 60, 70], ["Power", 63, 88, 75], ["Range", 68, 48, 90]] as const) doc.addRow(t.id, [...r]);
    const p = doc.addPlot("Radar", t.id);
    doc.setPlotKind(p.id, "radar");
    return { doc, plotId: p.id };
  };

  it("the radar house default carries the translucent fill", () => {
    expect(KIND_HOUSE_DEFAULTS.radar?.series?.fillOpacity).toBe(0.18);
  });

  for (const preset of STYLE_PRESETS) {
    it(`${preset.name}: every series keeps the translucent fill`, () => {
      const { doc, plotId } = radar();
      doc.applyStylePreset(plotId, preset);
      applyKindHouseDefaults(doc, plotId, "radar", tableDatasets);
      const plot = doc.toJSON().plots.find((p) => p.id === plotId)!;
      const table = doc.toJSON().tables.find((t) => t.id === plot.source)!;
      const ds = tableDatasets(table);
      expect(ds.length).toBeGreaterThan(1);
      for (const d of ds) expect(plot.seriesStyles?.[d.id]?.fillOpacity, `${preset.name} · ${d.id}`).toBe(0.18);
    });
  }

  it("a fill the user sets afterwards is kept", () => {
    const { doc, plotId } = radar();
    const preset = STYLE_PRESETS[0]!;
    doc.applyStylePreset(plotId, preset);
    applyKindHouseDefaults(doc, plotId, "radar", tableDatasets);
    const table = doc.toJSON().tables[0]!;
    const first = tableDatasets(table)[0]!;
    doc.setSeriesStyle(plotId, first.id, { fillOpacity: 0.6 });
    expect(doc.toJSON().plots[0]!.seriesStyles?.[first.id]?.fillOpacity).toBe(0.6);
  });
});
