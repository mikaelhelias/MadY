import type { PlotScene } from "./scene.js";

/**
 * Does this scene draw anything? Lives here (not in the renderer's New-graph module) so the build
 * choke point can use it too: a builder that places nothing and says nothing is a silent no-op,
 * which the project forbids — the choke point warns when a sheet with data produced no ink and no
 * warning (e.g. Chart ▸ Type on a sheet the kind cannot read would otherwise draw an empty frame
 * silently).
 *
 * Ink = a series with marks or a path, a finite heatmap / correlation cell, or a non-empty
 * node / line / point / slice / cell / row list on the kind-specific scene block.
 */
export function sceneHasInk(scene: PlotScene): boolean {
  // A series draws with marks, a line, an area, an overlay line, a band (the error ribbon /
  // survival CI) or nested level bands (the ridgeline's banded fold, which has no marks).
  if (scene.series.some((s) => s.marks.length > 0 || s.linePath !== "" || (s.areaPath ?? "") !== "" || (s.overlayLine ?? "") !== "" || (s.bandPath ?? "") !== "" || (s.levelBands?.length ?? 0) > 0)) return true;
  if (scene.heatmap && (scene.heatmap.cells.some((c) => c.value !== null && Number.isFinite(c.value)) || (scene.heatmap.hexes?.length ?? 0) > 0)) return true;
  if (scene.corrmatrix?.cells.some((c) => c.r !== null && Number.isFinite(c.r))) return true;
  if ((scene.network?.nodes.length ?? 0) > 0) return true;
  if ((scene.parallel?.lines.length ?? 0) > 0) return true;
  if ((scene.scatter3d?.points.length ?? 0) > 0) return true;
  if ((scene.pie?.slices.length ?? 0) > 0) return true;
  if ((scene.treemap?.cells.length ?? 0) > 0) return true;
  if ((scene.alluvial?.ribbons.length ?? 0) > 0 || (scene.alluvial?.nodes.length ?? 0) > 0) return true;
  if ((scene.radar?.polygons.length ?? 0) > 0) return true;
  // A category row with no dot / mark is a bare label, not ink (an all-text sheet keeps its
  // rows and places nothing on them).
  if (scene.paireddot?.rows.some((r) => r.marks.length > 0)) return true;
  if (scene.lollipop?.rows.some((r) => r.dots.some((d) => Number.isFinite(d.value)))) return true;
  // A venn's ink is its discs — an empty membership sheet draws none.
  if ((scene.venn?.circles.length ?? 0) > 0 && (scene.venn?.zones.some((z) => z.count > 0) ?? false)) return true;
  // An upset's ink is its intersection bars — all-empty memberships draw none.
  if (scene.upset?.columns.some((c) => c.count > 0) ?? false) return true;
  // A swimmer's ink is its timeline bars — a drawn row implies a usable Start/End.
  if ((scene.swimmer?.rows.length ?? 0) > 0) return true;
  // A rose's ink is its wedges — a sheet with no usable angle bins nothing.
  if (scene.rose?.wedges.some((w) => w.count > 0) ?? false) return true;
  // Timeline tracks' ink is its tiles — a strip with tiles is drawn ink.
  if (scene.tracks?.strips.some((s) => s.tiles.length > 0) ?? false) return true;
  // A sunburst's ink is its ring segments — a sheet with no hierarchy draws nothing.
  if ((scene.sunburst?.segments.length ?? 0) > 0) return true;
  // A chord's ink is its node arcs (ribbons ride on them) — no links, no ink.
  if ((scene.chord?.arcs.length ?? 0) > 0) return true;
  // An oncoprint's ink is its tiles — no events, no grid.
  if ((scene.oncoprint?.tiles.length ?? 0) > 0) return true;
  return false;
}
