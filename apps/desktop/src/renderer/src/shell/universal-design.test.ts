/**
 * The "Universal design" preset — MadY's reading of ggplotplus (Dr Alex Bajcz, MIT), checked against
 * that package's own numbers and measured on the drawing.
 *
 * Why this file is specific: the look depends on details that are easy to get wrong without the
 * source — no gridlines (theme_plus eliminates them), viridis truncated at 0.72 rather than
 * Okabe–Ito, the warm paper, the bold axis titles and the heavier geometry. Every assertion below names the ggplotplus behaviour it pins, so the
 * preset stays tied to the source rather than to personal taste.
 */
import { describe, expect, it } from "vitest";
import { MadyDocument, STYLE_PRESETS, findPreset } from "@mady/core";
import type { Plot, Project } from "@mady/core";
import { buildPlotScene, rampColor } from "@mady/graphics";
import { galleryItems } from "./gallery";
import { scenePaletteOpt } from "./scenePalette";
import { applyPresetWithKindDefaults } from "./seedStyle";

const measure = (t: string, px: number): number => t.length * px * 0.6;
const SIZE = { width: 580, height: 380 };
const NAME = "Universal design";

function applied(item: { table: never; plot: Plot }, presetName: string) {
  const p = JSON.parse(JSON.stringify(item.plot)) as Plot;
  const project: Project = { schemaVersion: 4, tables: [item.table], plots: [p], analyses: [], log: [], workspace: { folders: [], loose: [] } };
  const doc = new MadyDocument(project);
  applyPresetWithKindDefaults(doc, p.id, item.plot.kind ?? "xy", findPreset(presetName)!);
  const plot = doc.toJSON().plots[0]!;
  return { plot, scene: buildPlotScene(item.table, plot, { measure, ...SIZE, ...scenePaletteOpt(plot) }) };
}
const hex = (c: string): number[] => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const dist = (a: string, b: string): number => Math.hypot(...hex(a).map((v, i) => v - hex(b)[i]!));

describe("Universal design — pinned to ggplotplus's own numbers", () => {
  const items = galleryItems() as unknown as { table: never; plot: Plot }[];
  const preset = findPreset(NAME);
  const xy = () => items.find((i) => (i.plot.kind ?? "xy") === "xy")!;

  it("is a real preset the pickers can reach", () => {
    expect(preset, "no preset by that name").toBeTruthy();
    expect(STYLE_PRESETS.map((p) => p.name)).toContain(NAME);
  });

  /** `theme_plus`'s own comment says to eliminate major and minor gridlines. Gridlines come back
   *  only through the separate opt-in `gridlines_plus`. */
  it("draws no gridlines, as theme_plus does", () => {
    expect(preset!.gridShow).toBe(false);
    expect(applied(xy(), NAME).scene.grid?.show ?? false).toBe(false);
  });

  /** Viridis, truncated at 0.72 — not Okabe–Ito. The cut-off drops viridis's pale yellow
   *  end, which disappears on paper. Recomputed here from the app's own ramp, so a typo in the
   *  preset's literals fails instead of becoming the new truth. */
  it("uses viridis sampled 0 to 0.72, not the house palette", () => {
    const expected = Array.from({ length: 8 }, (_, i) => rampColor("viridis", (i / 7) * 0.72, "#000000", "#ffffff", false).color.toLowerCase());
    const got = preset!.palette.map((c) => c.toLowerCase());
    expect(got).toHaveLength(8);
    for (const c of got) expect(expected, c + " is not a viridis sample in 0…0.72").toContain(c);
    expect(got, "the palette is the Okabe–Ito set, not viridis").not.toContain("#0072b2");
  });

  /**
   * And its order must separate the first few. ggplotplus samples viridis across the actual
   * number of groups, so two groups get the two ends. MadY cycles a fixed list by index, so
   * ramp order would hand a two-series chart #440154 and #462574 — two dark purples that are
   * nearly indistinguishable (visible on the xy card). The list is interleaved for this reason.
   */
  it("keeps consecutive series far apart in colour", () => {
    const p = preset!.palette;
    expect(dist(p[0]!, p[1]!), "the first two palette colours are too close for a two-series chart").toBeGreaterThan(150);
    expect(dist(p[1]!, p[2]!)).toBeGreaterThan(60);
    const cols = applied(xy(), NAME).scene.series.map((s) => s.color);
    expect(cols.length).toBeGreaterThan(1);
    expect(dist(cols[0]!, cols[1]!), "the two drawn curves are nearly the same colour").toBeGreaterThan(150);
  });

  /** The warm off-white paper ggplotplus pairs with dropping ggplot's grey panel — and it
   *  must reach the plot, not just sit in the preset. */
  it("puts the warm off-white paper on the graph", () => {
    expect(preset!.background?.toUpperCase()).toBe("#FFFEFD");
    expect(applied(xy(), NAME).plot.background?.toUpperCase()).toBe("#FFFEFD");
    // …and switching to a preset that sets none clears it, or the colour would linger.
    expect(applied(xy(), "MadY default").plot.background, "the paper colour survives a switch to another preset").toBeUndefined();
  });

  /** Axis titles bold — the label a reader needs before the numbers mean anything.
   *  `titleBold` is the graph title; this is its own field. */
  it("bolds the axis titles, on the drawing", () => {
    expect(preset!.axisTitleBold).toBe(true);
    expect(applied(xy(), NAME).scene.fonts.axisTitle.weight).toBeGreaterThanOrEqual(700);
    expect(applied(xy(), "MadY default").scene.fonts.axisTitle.weight, "every preset bolds them, so the check proves nothing").toBeLessThan(700);
  });

  /** Geometry: point size 5, fillable circle with a black border at 1.2, line width 1.35. */
  it("carries ggplotplus's mark geometry", () => {
    expect(preset!.markerSize).toBe(5);
    expect(preset!.symbolFill).toBe("solid");
    expect(preset!.symbolOutline?.toUpperCase()).toBe("#000000");
    expect(preset!.symbolBorderWidth).toBe(1.2);
    expect(preset!.seriesLineWidth).toBe(1.35);
  });

  /**
   * And it sets no `fillOpacity`. Forcing 1.0 paints one radar polygon solid over the other,
   * hiding a whole series. Opacity is the one thing a chart kind knows better than a look.
   */
  it("leaves fill opacity to the chart type, so overlapping fills still show through", () => {
    expect(preset!.fillOpacity).toBeUndefined();
    const radar = items.find((i) => (i.plot.kind ?? "xy") === "radar")!;
    const after = Object.values(applied(radar, NAME).plot.seriesStyles ?? {}).map((v) => (v as { fillOpacity?: number }).fillOpacity);
    expect(after.every((v) => v == null), "the preset wrote an opacity onto the radar's series").toBe(true);
    const other = Object.values(applied(radar, "Scientific Journal").plot.seriesStyles ?? {}).map((v) => (v as { fillOpacity?: number }).fillOpacity);
    expect(other.some((v) => v != null), "no preset writes one, so the check above proves nothing").toBe(true);
  });

  /**
   * Tick and spacing parameters from ggplotplus, converted by ratio to the type size, not
   * by absolute size, because MadY keeps its own 26/22/20 rather than ggplotplus's 16 pt
   * base. base = 16 pt, MadY tick font = 20 px, throughout.
   */
  it("carries the tick and spacing parameters, at ggplotplus's ratios", () => {
    // 0.2 cm = 5.67 pt = 0.354 × base → 20 × 0.354 ≈ 7
    expect(preset!.tickLen).toBe(7);
    // rel(0.75) × base linewidth 1.2 = 0.9 — ticks lighter than the axis line they sit on
    expect(preset!.tickWidth).toBe(0.9);
    // 10 pt = 0.625 × base → 20 × 0.625 ≈ 12  (Note: ggplotplus sets x 10 pt / y 15 pt; a preset
    // carries one titleGap for both axes, so this takes the x value.)
    expect(preset!.titleGap).toBe(12);
    // …and they reach the graph, not just the preset.
    const out = applied(xy(), NAME);
    expect(out.plot.tickLen).toBe(7);
    expect(out.plot.xAxis?.tickWidth).toBe(0.9);
    expect(out.plot.yAxis?.titleGap).toBe(12);
    expect(out.scene.axisStyle.tickLen).toBe(7);
  });

  /**
   * Redundant encoding — shape as well as colour. This is
   * ggplotplus's principle, not its theme: `geom_point_plus` is a separate opt-in function
   * there and `theme_plus` defaults every series to shape 21. The order matters more than the
   * membership — most figures have two to four series, so the first few must be unmistakable
   * at 5 px.
   */
  it("cycles distinct marker shapes across the series", () => {
    const shapes = preset!.symbolShapes ?? [];
    expect(shapes.length).toBe(8);
    expect(new Set(shapes).size, "the cycle repeats a shape").toBe(shapes.length);
    // The first four are what a normal figure actually gets, and they must differ from each
    // other — a cycle that opened circle/hexagon/pentagon would be no encoding at all.
    expect(new Set(shapes.slice(0, 4)).size).toBe(4);
    expect(shapes[0]).toBe("circle");
  });

  /**
   * The PCA / ordination plots draw their groups (`pca-g0`…) — series the table's datasets never
   * name. Guards against them drawing solid, opaque circles under a preset whose columns are
   * shape-cycled and see-through: they take the same classic cycle and marker look. (The
   * package's own losange · waffle · oval symbols are not used there — they do not read well.)
   */
  it("gives the PCA plots' groups the preset's marker look — round where the dots are depth-sized, the classic cycle otherwise", () => {
    for (const kind of ["pcascore", "pcabiplot", "triplot"] as const) {
      const card = items.find((i) => i.plot.kind === kind)!;
      const scene = applied(card, NAME).scene;
      const groups = scene.series.filter((x) => x.id.startsWith("pca-g"));
      expect(groups.length, `${kind}: the card has no groups to test`).toBeGreaterThan(1);
      // Sites and biplot stay round because their legend is a bubble key, differing only by
      // colour — the PC3 size key beside them is drawn as circles. The triplot has no
      // size key and keeps the cycle.
      const depthSized = groups.some((g) => new Set(g.marks.map((m) => m.symbolSize)).size > 1);
      expect(depthSized, `${kind}: is it depth-sized?`).toBe(kind !== "triplot");
      expect(groups.map((x) => x.symbol)).toEqual(depthSized ? groups.map(() => "circle") : ["circle", "triangle", "square"].slice(0, groups.length));
      for (const g of groups) {
        expect(g.symbolFill, `${kind} ${g.id}`).toBe("solid");
        expect(g.symbolOutline, `${kind} ${g.id}: the black edge`).toBe("#000000");
        expect(g.symbolOpacity, `${kind} ${g.id}: not transparent`).toBe(0.7);
        expect(g.symbol, `${kind} ${g.id}: the series draws its own shape instead of the preset's cycle`).not.toMatch(/squircle|waffle|oval|ring/);
      }
    }
    // …and no other built-in reaches them: their look under MadY default is unchanged.
    const card = items.find((i) => i.plot.kind === "pcascore")!;
    const plain = applied(card, "MadY default").scene.series.filter((x) => x.id.startsWith("pca-g"));
    for (const g of plain) expect(g.symbolOpacity).toBe(1);
    // …and it reaches the drawing: consecutive series get different marks.
    const s = applied(xy(), NAME).scene;
    expect(s.series.length).toBeGreaterThan(1);
    expect(s.series[0]!.symbol).not.toBe(s.series[1]!.symbol);
  });

  /** `theme_plus` gives the legend the same warm paper as the figure, and no frame: the
   *  "legend frame" in its source is the colour bar's, not the series key's box. */
  it("gives the legend the figure's own paper, and no frame", () => {
    expect(preset!.legend?.background).toBe(true);
    expect(preset!.legend?.backgroundColor?.toUpperCase()).toBe("#FFFEFD");
    expect(preset!.legend?.border, "ggplotplus draws no box around the series key").toBeUndefined();
    const out = applied(xy(), NAME);
    expect(out.plot.legend?.backgroundColor?.toUpperCase()).toBe("#FFFEFD");
  });

  /** The house headline type sizes (26 / 22 / 20) are carried across, never shrunk. */
  it("never shrinks the house title, axis-title or tick sizes", () => {
    const house = findPreset("MadY default")!;
    expect(preset!.titleSize).toBeGreaterThanOrEqual(house.titleSize);
    expect(preset!.axisTitleSize).toBeGreaterThanOrEqual(house.axisTitleSize);
    expect(preset!.tickSize).toBeGreaterThanOrEqual(house.tickSize);
  });
});
