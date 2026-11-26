/**
 * Re-export of the shared palette resolution, which lives in `@mady/graphics` beside the
 * `PALETTES` registry it reads, so headless callers — `describeScene`, the language-model
 * path — follow the same rule instead of growing a second resolution. Renderer files import it
 * from `./scenePalette`, the same way `analysis.ts` re-exports `buildAnalysisData`.
 *
 * The rule it enforces: every scene-building call site resolves through `scenePaletteOpt`.
 * A site that only reads `plot.palette` silently ignores applied style presets on the
 * builder-coloured kinds (e.g. the heatmap would not restyle).
 */
export { scenePaletteOpt } from "@mady/graphics";
