import type { Plot } from "@mady/core";

/**
 * Loose legend rows: a row pulled out of the legend block is drawn on its own where it was
 * dropped. `Plot.legendLoose` maps the row's built label (the key a rename writes under) to its place in figure px;
 * a row put back loses its entry, so it returns to its own slot in the series order.
 */
export function legendLooseSet(plot: Pick<Plot, "legendLoose">, key: string, at: { x: number; y: number } | null): Partial<Plot> {
  const next = { ...(plot.legendLoose ?? {}) };
  if (at) next[key] = { x: Math.round(at.x), y: Math.round(at.y) };
  else delete next[key];
  return { legendLoose: Object.keys(next).length ? next : undefined };
}
