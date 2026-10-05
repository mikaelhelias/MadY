/**
 * The gallery's Colour ramp control reaches every card that draws a continuous colour ramp — and
 * nothing else.
 *
 * A palette is a list of separate colours; a heatmap draws a smooth ramp with its own Colormap
 * control (the Inspector hides the palette on a heatmap), so the gallery's Palette does not
 * recolour it. The gallery's second control, Colour ramp, holds the same list the heatmap's
 * Colormap offers.
 *
 * Checked on the drawing, both ways, over every card: a card with a ramp must draw differently
 * when the ramp is moved (a setting written but not drawn is a control that does nothing), and a
 * card without one must draw exactly as it does with the default (the control must not reach
 * anything it does not name).
 */
import { describe, expect, it } from "vitest";
import { buildPlotScene } from "@mady/graphics";
import { galleryItems, galleryLookup, type GalleryItem } from "./gallery";
import { DEFAULT_STYLE, styledPlot, type GalleryStyle } from "./GalleryPane";
import { scenePaletteOpt } from "./scenePalette";

const draw = (it: GalleryItem, style: GalleryStyle): string => {
  const plot = styledPlot(it, style);
  const scene = buildPlotScene(it.table, plot, { tables: galleryLookup(it), width: 580, height: 380, ...scenePaletteOpt(plot) });
  return JSON.stringify(scene);
};

const MAGMA = { ...DEFAULT_STYLE, ramp: "magma" };

describe("gallery Colour ramp control", () => {
  it("starts on the cards' own ramps — an untouched control changes nothing", () => {
    expect(DEFAULT_STYLE.ramp).toBe("");
    for (const it of galleryItems()) expect(styledPlot(it, DEFAULT_STYLE), it.key).toBe(it.plot);
  });

  it("every card that draws a ramp redraws in the chosen one; every other card draws exactly as with the default", () => {
    const changed: string[] = [];
    const untouched: string[] = [];
    for (const it of galleryItems()) {
      const wrote = JSON.stringify(styledPlot(it, MAGMA)) !== JSON.stringify(it.plot);
      const drewDifferently = draw(it, MAGMA) !== draw(it, DEFAULT_STYLE);
      // A setting written that the drawing ignores is a control that does nothing; a drawing that moved
      // without a ramp setting being written means the control reached something it does not name.
      expect(drewDifferently, `${it.key}: ramp ${wrote ? "written but not drawn" : "not written, yet the drawing moved"}`).toBe(wrote);
      (wrote ? changed : untouched).push(it.key);
    }
    // The ramp cards, by name — the heatmaps first of all.
    for (const k of ["heatmap", "bubblegrid", "heatmapsplit", "tracks"]) expect(changed, `${k} did not take the ramp`).toContain(k);
    expect(untouched.length, "the ramp reached cards that have no ramp").toBeGreaterThan(40);
  });

  it("the heatmap cards carry the ramp into the graph a card opens as", () => {
    const hm = galleryItems().find((i) => i.key === "heatmap")!;
    expect(styledPlot(hm, MAGMA).heatmap?.colormap).toBe("magma");
  });
});
