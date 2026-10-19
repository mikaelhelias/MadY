/**
 * Every preset restyles every chart kind's colours.
 *
 * Several kinds (heatmap · corrmatrix · treemap · network · alluvial · parallel · survival ·
 * roc · the PCA family · scree · dendrogram · beforeafter) colour from the scene builder's
 * `palette` option or from a named colormap rather than from per-dataset series styles, so a
 * preset apply must write one of those for its palette to reach the drawing.
 *
 * What this pins:
 *   • `Plot.paletteColors` — applyStylePreset/applyUserPreset/applyStyleParams write the
 *     preset's palette as literal colours; every scene-building call site resolves it
 *     through `scenePaletteOpt`, so the builder-coloured kinds follow the preset;
 *   • the heatmap restyles via a per-preset colormap (`PRESET_HEATMAP_COLORMAP` in
 *     seedStyle.ts) since its cells never read a palette; "MadY default" clears it back
 *     to the builder's viridis — the default look is untouched by design.
 *
 * The check reads the drawing: the built scene must contain the preset's own hues (or, for
 * the heatmap, its colormap's end stops). A kind whose colours a preset cannot move
 * fails here by name.
 */
import { describe, expect, it } from "vitest";
import { MadyDocument, STYLE_PRESETS } from "@mady/core";
import type { Plot, Project } from "@mady/core";
import { buildPlotScene, COLORMAPS } from "@mady/graphics";
import { galleryItems } from "./gallery";
import { scenePaletteOpt } from "./scenePalette";
import { applyPresetWithKindDefaults } from "./seedStyle";

const measure = (t: string, px: number): number => t.length * px * 0.6; // node has no canvas
const SIZE = { width: 580, height: 380 };

/** Build the scene the way the app does — palette resolved through scenePaletteOpt. */
function sceneOf(table: Parameters<typeof buildPlotScene>[0], plot: Plot): string {
  return JSON.stringify(buildPlotScene(table, plot, { measure, ...SIZE, ...scenePaletteOpt(plot) })).toLowerCase();
}

/** The per-preset heatmap colormap names — must mirror seedStyle's PRESET_HEATMAP_COLORMAP. */
const HEATMAP_CMAP: Record<string, string> = {
  "Scientific Journal": "reds",
  "Bold infographic": "plasma",
  Editorial: "magma",
  "Grayscale (print)": "grayscale",
  "Universal design": "cividis",
};

describe("preset-restyle efficacy — every preset's colours reach every kind's drawing", () => {
  const items = galleryItems();

  it("covers the whole gallery (the loop below cannot pass by iterating nothing)", () => {
    expect(items.length).toBeGreaterThan(30);
    expect(STYLE_PRESETS.length).toBeGreaterThan(3);
  });

  it.each(items.map((i) => [i.plot.kind ?? "xy", i] as const))("%s", (kind, item) => {
    const dead: string[] = [];
    for (const preset of STYLE_PRESETS) {
      if (preset.name === "MadY default") continue; // the default is pinned by one-default-look.test.ts
      const project: Project = {
        schemaVersion: 4, tables: [item.table], plots: [JSON.parse(JSON.stringify(item.plot)) as Plot],
        analyses: [], log: [], workspace: { folders: [], loose: [] },
      };
      const doc = new MadyDocument(project);
      applyPresetWithKindDefaults(doc, item.plot.id, kind, preset);
      const scene = sceneOf(item.table, doc.toJSON().plots[0]!);
      const stops = COLORMAPS[HEATMAP_CMAP[preset.name] ?? ""] ?? [];
      const probes = kind === "heatmap" ? [stops[0]!, stops[stops.length - 1]!] : preset.palette.slice(0, 4);
      if (!probes.some((hue) => scene.includes(hue.toLowerCase()))) dead.push(preset.name);
    }
    expect(dead, `presets whose colours never reach a ${kind}'s drawing`).toEqual([]);
  });
});
