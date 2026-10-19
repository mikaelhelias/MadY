/**
 * The one resolution of "which palette does this plot's scene get built with".
 *
 * Two carriers exist and the last one the user touched wins:
 *   • `plot.paletteColors` — literal colours written by a style-preset apply
 *     (applyStylePreset / applyUserPreset / applyStyleParams clear `palette`);
 *   • `plot.palette` — a named registry choice from the Inspector's palette
 *     picker (which clears `paletteColors` when set).
 *
 * Every scene-building call site must resolve through here — a site that only
 * reads `plot.palette` silently ignores applied presets on the builder-coloured
 * kinds (survival/ROC/PCA/treemap/parallel/alluvial/corrmatrix/…), so e.g. the
 * heatmap would not restyle.
 *
 * Note: lives in `@mady/graphics`, beside the `PALETTES` registry it reads, so headless
 * callers obey the same rule. `describeScene` (the MCP server's read-back) is outside the app
 * and cannot import a renderer copy; the alternative would be a second palette resolution,
 * which could drift from this one and ignore applied presets as described above. The renderer's `shell/scenePalette.ts` re-exports this, so
 * every import keeps working. `buildAnalysisData` and `sciFormat` are shared the same way.
 */
import type { Plot } from "@mady/core";
import { PALETTES } from "./palette.js";

/** The palette option for `buildPlotScene`, or `{}` when the builder default applies. */
export function scenePaletteOpt(plot: Plot): { palette?: string[] } {
  if (plot.paletteColors?.length) return { palette: [...plot.paletteColors] };
  if (plot.palette && PALETTES[plot.palette]) return { palette: [...PALETTES[plot.palette]!] };
  return {};
}
