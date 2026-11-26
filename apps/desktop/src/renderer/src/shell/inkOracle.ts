import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { DataTable, NodeId, Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";

/**
 * "Does this option reach the page?" — the drawing, hashed.
 *
 * Note: this hashes the drawing, not the scene. A scene can carry a field (a series' symbol, say)
 * that its renderer never draws for this kind, and hashing the scene then reads "moved" for a
 * control that changes nothing a user can see (the banded ridgeline is one such case).
 *
 * Shared by the guards that ask whether a panel section is dead, so there is one answer to the
 * question rather than one per test file.
 */
export const INK_SIZE = { width: 640, height: 460 } as const;

export function ink(
  table: DataTable,
  plot: Plot,
  lookup?: ((id: NodeId) => DataTable | undefined) | undefined,
): string {
  const scene = buildPlotScene(table, plot, { ...INK_SIZE, ...(lookup ? { tables: lookup } : {}) });
  return renderToStaticMarkup(createElement(PlotFigure, { scene, zoom: 1 }));
}

/** Does the drawing tell these two plots apart? */
export const inkDiffers = (
  table: DataTable,
  a: Plot,
  b: Plot,
  lookup?: ((id: NodeId) => DataTable | undefined) | undefined,
): boolean => ink(table, a, lookup) !== ink(table, b, lookup);
