/**
 * The one definition of "the default look" — what a graph of kind K starts life as,
 * under the user's current settings.
 *
 * Three surfaces show or produce that look, and they must never disagree:
 *   • creating a graph (AppShell `seedNewPlot`),
 *   • a chart-gallery card (`gallery.ts applyHouseStyle` — the card is the preview
 *     of "this is what you get"),
 *   • applying a preset from the Inspector picker ("MadY default" there must equal
 *     the default it is named after).
 *
 * If the gallery hardcoded the "MadY default" preset while creation followed the user's
 * profile (which can point at an old saved preset), new graphs and gallery cards would
 * look different. Both paths call the same function here, so the gallery previews
 * whatever a new graph would actually get, whatever the settings say.
 *
 * The layering, in order (each refines the previous):
 *   1. the user's default preset — the per-kind override if set, else the global
 *      default; a built-in or a saved user preset ("None" skips this layer),
 *   2. the global common params (title font/size, axis width/colour, grid, palette),
 *   3. the chart type's own house defaults (`KIND_HOUSE_DEFAULTS` — kind-specific
 *      refinements applied whatever the preset, exactly as at creation).
 */
import { applyKindHouseDefaults, findPreset, KIND_HOUSE_DEFAULTS, tableDatasets } from "@mady/core";
import type { MadyDocument, NodeId, Plot, PlotKind, StylePreset } from "@mady/core";
import { getGlobalParams, getProfileForKind } from "./profile";
import { SHARED_KEYS } from "./templates";
import { findUserPreset } from "./userPresets";
import type { UserPreset } from "./userPresets";

/** Style a plot as "the default look" for its kind under the user's settings. */
export function seedPlotStyle(doc: MadyDocument, plotId: NodeId, kind: PlotKind | undefined): void {
  const def = getProfileForKind(kind ?? "xy");
  let builtin: StylePreset | undefined;
  if (def?.kind === "builtin") {
    builtin = findPreset(def.name);
    if (builtin) doc.applyStylePreset(plotId, builtin);
  } else if (def?.kind === "user") {
    const u = findUserPreset(def.id);
    if (u) {
      // The same three steps as `applyUserPresetWithKindDefaults`, with the global common params
      // between the shared look and the house defaults — exactly the picker's apply, plus params.
      doc.applyUserPreset(plotId, u.style, u.palette, SHARED_KEYS, u.shapes);
      const params = getGlobalParams();
      if (Object.keys(params).length > 0) doc.applyStyleParams(plotId, params);
      applyKindHouseDefaults(doc, plotId, kind, tableDatasets);
      applyPresetKindSection(doc, plotId, kind, u);
      return;
    }
  }
  const params = getGlobalParams();
  if (Object.keys(params).length > 0) doc.applyStyleParams(plotId, params);
  applyKindHouseDefaults(doc, plotId, kind, tableDatasets);
  if (builtin) applyPresetKindColors(doc, plotId, kind, builtin);
}

/**
 * The preset's section for this graph type, written last. Scalars replace (a bar width the
 * house floor would otherwise reset — `applyKindHouseDefaults` floor-merges objects only);
 * blocks merge over what is there, so a section naming only `heatmap.colormap` keeps the house
 * cell gap. A preset without a section for this type writes nothing.
 */
function applyPresetKindSection(doc: MadyDocument, plotId: NodeId, kind: PlotKind | undefined, preset: Pick<UserPreset, "kinds">): void {
  const section = preset.kinds?.[kind ?? "xy"];
  if (!section || Object.keys(section).length === 0) return;
  const plot = doc.toJSON().plots.find((p) => p.id === plotId) as Record<string, unknown> | undefined;
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(section as Record<string, unknown>)) {
    const existing = plot?.[k];
    patch[k] =
      v && typeof v === "object" && !Array.isArray(v) && existing && typeof existing === "object" && !Array.isArray(existing)
        ? { ...(existing as object), ...(v as object) }
        : v;
  }
  doc.setPlotOptions(plotId, patch as Partial<Plot>);
}

/**
 * A preset's heatmap colormap. The heatmap colours from a named colormap
 * (`hs.colormap ?? "viridis"`), never from the palette, so a preset's palette alone
 * does not restyle it. Each
 * non-default preset picks the built-in colormap that suits its look; "MadY
 * default" is absent on purpose, so applying it clears the field back to the
 * builder's own viridis — the default look is untouched, and Scientific Journal →
 * MadY default round-trips clean.
 */
const PRESET_HEATMAP_COLORMAP: Record<string, NonNullable<NonNullable<import("@mady/core").Plot["heatmap"]>["colormap"]>> = {
  "Scientific Journal": "reds",
  "Bold infographic": "plasma",
  Editorial: "magma",
  "Grayscale (print)": "grayscale",
  // Continuous scales use cividis (viridis option "E"), the perceptually
  // uniform map built for colour-vision deficiency.
  "Universal design": "cividis",
};

/**
 * Per-kind colour carriers a preset must reach that neither `seriesStyles` nor the
 * scene `palette` option covers. Values for "MadY default" reproduce the house look
 * exactly (the kind-default ramp / the builder default), so the default never moves.
 */
function applyPresetKindColors(doc: MadyDocument, plotId: NodeId, kind: PlotKind | undefined, preset: StylePreset): void {
  if (kind !== "heatmap" && kind !== "network") return;
  const plot = doc.toJSON().plots.find((p) => p.id === plotId);
  if (!plot) return;
  if (kind === "heatmap") {
    doc.setPlotOptions(plotId, { heatmap: { ...(plot.heatmap ?? {}), colormap: PRESET_HEATMAP_COLORMAP[preset.name] } });
  } else {
    // The network's value ramp: its house low/high live in KIND_HOUSE_DEFAULTS and are
    // written at creation, so a floor-merge can never move them — a preset must write
    // them outright. "MadY default" writes the house values back (a byte-level no-op
    // on a default graph); other presets derive the ramp from their palette.
    const houseNet = KIND_HOUSE_DEFAULTS.network?.plot?.network;
    const house = preset.name === "MadY default";
    doc.setPlotOptions(plotId, {
      network: {
        ...(plot.network ?? {}),
        lowColor: house ? houseNet?.lowColor : (preset.palette[1] ?? preset.palette[0]),
        highColor: house ? houseNet?.highColor : preset.palette[0],
      },
    });
  }
}

/**
 * Apply a built-in preset the way the picker means it: the preset plus the chart
 * type's house refinements — i.e. exactly the look a new graph under that preset
 * gets. Without the second step, picking "MadY default" in the Inspector would give
 * a graph a different look (e.g. smaller dots and legend on a bar chart) from the
 * gallery card and a new graph of the same kind — same name, different look.
 */
export function applyPresetWithKindDefaults(doc: MadyDocument, plotId: NodeId, kind: PlotKind | undefined, preset: StylePreset): void {
  doc.applyStylePreset(plotId, preset);
  applyKindHouseDefaults(doc, plotId, kind, tableDatasets);
  applyPresetKindColors(doc, plotId, kind, preset);
}

/**
 * The user-preset twin of {@link applyPresetWithKindDefaults} (the "My presets" picker): the
 * shared look, the kind house defaults, then the preset's section for this graph type.
 */
export function applyUserPresetWithKindDefaults(
  doc: MadyDocument,
  plotId: NodeId,
  kind: PlotKind | undefined,
  preset: Pick<UserPreset, "style" | "palette"> & Partial<Pick<UserPreset, "shapes" | "kinds">>,
): void {
  doc.applyUserPreset(plotId, preset.style, preset.palette, SHARED_KEYS, preset.shapes);
  applyKindHouseDefaults(doc, plotId, kind, tableDatasets);
  applyPresetKindSection(doc, plotId, kind, preset);
}
