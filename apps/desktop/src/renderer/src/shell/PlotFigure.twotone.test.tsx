// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { buildPlotScene, PALETTES } from "@mady/graphics";
import type { PlotScene } from "@mady/graphics";
import type { DataTable, Plot, SeriesStyle } from "@mady/core";
import { galleryItems, type GalleryItem } from "./gallery";
import { measureText } from "./textMeasure";

/**
 * The house default draws data-point markers two-tone (a lighter fill under a darker
 * outline). Guards against whole chart families (PCA, network, radar) silently drawing solid
 * points: the preset stamps `symbolFill: "twotone"` onto the source-table series, but those
 * kinds re-key their points to synthetic ids (`pca-g0`, a radar dataset, a before-after subject
 * row) the preset never writes to. `effectiveMarkerStyle` makes them inherit the intent.
 *
 * An aggregate circle count would be satisfied by the kinds that work and blind to the ones
 * that do not. This asserts per kind, at the scene level (so a legend swatch, which is
 * legitimately solid, can never be mistaken for a data marker).
 */
const PAL = Object.keys(PALETTES)[0]!;
const leadY = (t: DataTable): string[] => t.columns.filter((c) => c.role === "y" && !c.group).map((c) => c.id);
/** Mirror GalleryPane's styledPlot: the house preset is already baked in by galleryItems(). */
function styled(item: GalleryItem): Plot {
  const palette = PALETTES[PAL]!;
  const ss: Record<string, SeriesStyle> = { ...(item.plot.seriesStyles ?? {}) };
  leadY(item.table).forEach((id, i) => { ss[id] = { ...(ss[id] ?? {}), color: palette[i % palette.length]!, lineWidth: 2, symbolSize: 4 }; });
  return { ...item.plot, seriesStyles: ss };
}
const lum = (h: string): number => parseInt(h.slice(1, 3), 16) + parseInt(h.slice(3, 5), 16) + parseInt(h.slice(5, 7), 16);
const isHex = (s: string | null | undefined): s is string => !!s && /^#[0-9a-fA-F]{6}$/.test(s);

/** Every data-point marker the scene will draw, as {fill, outline} — from series marks,
 *  radar vertices and network nodes. Legend entries live in `scene.legend`, never here. */
function dataMarkerPaints(scene: PlotScene): { fill: string; outline: string | null }[] {
  const out: { fill: string; outline: string | null }[] = [];
  for (const s of scene.series ?? []) {
    if (!s.marks?.length || s.symbol === "none") continue;
    const fill = s.symbolFill === "open" ? (s.symbolFillColor ?? s.color) : s.color;
    out.push({ fill, outline: s.symbolOutline ?? null });
  }
  for (const p of scene.radar?.polygons ?? []) out.push({ fill: p.vertexFill ?? p.color, outline: p.vertexOutline ?? null });
  for (const nd of scene.network?.nodes ?? []) out.push({ fill: nd.color, outline: nd.stroke ?? null });
  return out;
}
const twoTone = (p: { fill: string; outline: string | null }): boolean => isHex(p.fill) && isHex(p.outline) && lum(p.fill) > lum(p.outline!);

const scenesByKind = (): Map<string, PlotScene> => {
  const m = new Map<string, PlotScene>();
  for (const it of galleryItems()) {
    // First card of a kind = the canonical one (GALLERY_ORDER files the plain card first). A
    // last-wins map would silently swap in a later card such as "Stream graph", whose series
    // deliberately draw no markers — changing the fixture under the guard.
    if (m.has(it.plot.kind ?? "xy")) continue;
    m.set(it.plot.kind ?? "xy", buildPlotScene(it.table, styled(it), { measure: measureText, width: 360, height: 250, palette: PALETTES[PAL]! }));
  }
  return m;
};

describe("house default: data-point markers render two-tone across kinds", () => {
  const scenes = scenesByKind();

  // The kinds that draw point markers via the shared marker path. The first block is the
  // synthetic-id family (the kinds whose re-keyed points the preset never writes to); the
  // rest guard the shared path.
  /**
   * Note: `network` is handled separately, because its house default draws no two-tone ring.
   *
   * A dark 1px ring on a 9px node eats the fill, and the modern node-link convention is a light
   * page-colour halo that separates overlapping nodes without darkening them, so
   * `KIND_HOUSE_DEFAULTS.network` sets `nodeTwoTone: false` with `nodeStroke: var(--bg)`.
   *
   * The wiring must still work: network re-keys its nodes to synthetic ids, so the two-tone
   * intent has to be able to reach them. That is pinned by its own test below, driven from an
   * explicit `nodeTwoTone: true`.
   */
  /**
   * Note: `histogram` is handled separately too, for the same reason as `network` above. A
   * histogram draws no data-point markers by default (the dots read as noise on a frequency
   * chart — the bar is the data; `HistogramStyle.showPoints` is off by default). The two-tone
   * wiring is still pinned by its own test below, driven from an explicit `showPoints: true`.
   */
  const FULLY_TWO_TONE = [
    "pcascore", "pcaload", "pcabiplot", "scree", "radar", "beforeafter", // synthetic ids
    "xy", "area", "bar", "box", "violin", "scatter", "raincloud", "floatingbar",     // guards
    "forest", "blandaltman", "pyramid", "bubble", "volcano",
  ];

  it.each(FULLY_TWO_TONE)("%s draws its data markers two-tone (none solid)", (kind) => {
    const scene = scenes.get(kind);
    expect(scene, `no gallery scene for kind "${kind}"`).toBeTruthy();
    const paints = dataMarkerPaints(scene!);
    expect(paints.length, `${kind} exposed no data markers to check`).toBeGreaterThan(0);
    const solid = paints.filter((p) => !twoTone(p));
    expect(solid, `${kind} has ${solid.length}/${paints.length} solid data markers: ${JSON.stringify(solid.slice(0, 3))}`).toHaveLength(0);
  });

  it("histogram markers are two-tone when data points are turned on (wiring still pinned)", () => {
    const item = galleryItems().find((i) => (i.plot.kind ?? "xy") === "histogram")!;
    const plot = { ...styled(item), histogram: { ...(item.plot.histogram ?? {}), showPoints: true } };
    const scene = buildPlotScene(item.table, plot, { measure: measureText, width: 360, height: 250, palette: PALETTES[PAL]! });
    const paints = dataMarkerPaints(scene);
    expect(paints.length, "showPoints did not restore the histogram's data markers").toBeGreaterThan(0);
    expect(paints.filter((p) => !twoTone(p)), "histogram markers are not two-tone when shown").toHaveLength(0);
  });

  it("network nodes carry a light page-colour halo by default, not a dark ring", () => {
    // Every node still has an outline — the halo is what
    // separates overlapping nodes — but it is the page colour, so it must not be a hex darker
    // than the fill the way a two-tone contour is.
    const nodes = scenes.get("network")!.network!.nodes;
    expect(nodes.length).toBeGreaterThan(0);
    for (const nd of nodes) {
      expect(nd.stroke, `node ${nd.id} lost its outline entirely — overlapping nodes now merge`).toBeTruthy();
      if (isHex(nd.stroke)) {
        expect(
          lum(nd.stroke!),
          `node ${nd.id} still has a dark two-tone ring; the house default sets nodeTwoTone:false`,
        ).toBeGreaterThan(lum(nd.color));
      }
    }
  });

  /**
   * …and the two-tone wiring must still work. Network re-keys its nodes to synthetic
   * ids, so the two-tone intent has to reach them; guards against it silently not doing so.
   * Driven from an explicit `nodeTwoTone: true`.
   */
  it("still draws a darker two-tone contour when nodeTwoTone is asked for", () => {
    const item = galleryItems().find((i) => i.plot.kind === "network")!;
    const plot = { ...styled(item), network: { ...(item.plot.network ?? {}), nodeTwoTone: true, nodeStroke: undefined } };
    const scene = buildPlotScene(item.table, plot, { measure: measureText, width: 360, height: 250, palette: PALETTES[PAL]! });
    const nodes = scene.network!.nodes;
    expect(nodes.length).toBeGreaterThan(0);
    for (const nd of nodes) {
      expect(isHex(nd.stroke), `node ${nd.id} has no derived outline`).toBe(true);
      expect(lum(nd.stroke!), `node ${nd.id} did not get a darker contour`).toBeLessThan(lum(nd.color));
    }
  });
});
