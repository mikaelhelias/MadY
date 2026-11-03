import type { CSSProperties } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CellPattern, PatternKind } from "@mady/core";
import { patternTile } from "./PlotFigure";

/**
 * Datasheet cell patterns. A cell pattern is drawn as a repeating SVG
 * background-image on the `<td>`, on top of the cell's `cellFills` colour. The tile geometry
 * comes from the same `patternTile` the graphs use for series pattern fills, so a datasheet pattern and
 * the matching series fill look identical — no second pattern vocabulary.
 */

/** The curated set offered in the datasheet toolbar (the full `PatternKind` list is 22 — too
 *  many for a cell menu; these ten read clearly at cell size and cover the common looks). */
export const CURATED_CELL_PATTERNS: readonly PatternKind[] = [
  "hatch", "hatch-cross", "horizontal", "vertical", "grid",
  "dots", "checker", "zigzag", "diamond", "crosses",
];

/** kind|color → the finished CSS background props. Memoised: only a handful of (kind,colour)
 *  pairs are ever live, and each render otherwise re-serialises an SVG. */
const cache = new Map<string, CSSProperties>();

/** The CSS to paint one cell pattern as a repeating background image (transparent tile so the
 *  cell's own fill colour shows behind it). */
export function cellPatternBackground(pattern: CellPattern): CSSProperties {
  const key = `${pattern.kind}|${pattern.color}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const { w, h, content } = patternTile(pattern.kind, pattern.color);
  const inner = renderToStaticMarkup(content);
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'>${inner}</svg>`;
  const css: CSSProperties = {
    backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(svg)}")`,
    backgroundSize: `${w}px ${h}px`,
    backgroundRepeat: "repeat",
  };
  cache.set(key, css);
  return css;
}
