import type { Plot } from "@mady/core";

/**
 * Which setting a colour-key drag writes. The figure raises one callback for every key that moves with the
 * `colorbarOffset` mechanism; `which` says which key it was, so two keys on one graph keep separate positions
 * (a bubble chart coloured by a column has a size legend and a colour bar; a timeline has a key per strip; a
 * scale bar is stored with the axis it measures).
 */
export type ColorbarDragTarget = "colorByBar" | "zoneKey" | `trackKey:${string}` | "scaleBar:x" | "scaleBar:y";

/** The plot patch that stores a drag of `which` to offset (dx, dy); no target = the heatmap bar / size legend / table. */
export function colorbarDragPatch(plot: Pick<Plot, "tracks" | "xAxis" | "yAxis">, dx: number, dy: number, which?: ColorbarDragTarget): Partial<Plot> {
  const offset = { dx, dy };
  if (which === "colorByBar") return { colorByBarOffset: offset };
  if (which === "zoneKey") return { zoneLegendOffset: offset };
  if (which === "scaleBar:x" || which === "scaleBar:y") {
    const key = which === "scaleBar:x" ? "xAxis" : "yAxis";
    const axis = plot[key];
    // Only a bar that exists moves: a drag with nothing to move writes nothing.
    if (!axis?.scaleBar) return {};
    return { [key]: { ...axis, scaleBar: { ...axis.scaleBar, offset } } };
  }
  if (which !== undefined && which.startsWith("trackKey:")) {
    const id = which.slice("trackKey:".length);
    return { tracks: { ...(plot.tracks ?? {}), keyOffsets: { ...(plot.tracks?.keyOffsets ?? {}), [id]: offset } } };
  }
  return { colorbarOffset: offset };
}
