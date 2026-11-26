import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";

/**
 * The figure as the user would see it, as markup: two calls compare equal exactly when the drawing is the same.
 * A pure function of (table, plot, size), with no Node-only imports, so the Inspector can ask it at run time
 * (which rows reach the drawing) as well as the tests and sweeps that measure options with it.
 *
 * Note: effects do not run under static markup. Both sides of every comparison are rendered the same way, so a
 * difference is still a difference, but it measures the first paint, not post-effect state.
 */
export function renderFingerprint(
  table: DataTable,
  plot: Plot,
  size: { width: number; height: number } | null,
): string {
  try {
    const scene = size ? buildPlotScene(table, plot, size) : buildPlotScene(table, plot, {});
    return renderToStaticMarkup(createElement(PlotFigure, { scene }));
  } catch (e) {
    return `THREW:${(e as Error).message}`;
  }
}
