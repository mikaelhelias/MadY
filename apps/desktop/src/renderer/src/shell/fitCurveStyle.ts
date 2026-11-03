import { fitCurves } from "@mady/core";
import type { FitCurveStyle, FitStyle, Plot } from "@mady/core";

/** Which curve the Fitted curve panel is styling: every curve, or one by its key (`"fit"`, `"0"`, `"1"`…). */
export type FitScope = "all" | string;

/** The two `FitStyle` fields that belong to the graph, never to one curve. */
const GRAPH_WIDE = new Set<keyof FitStyle>(["inLegend", "markerDelta"]);

const live = <T extends object>(o: T): T | undefined => {
  const kept = Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
  return Object.keys(kept).length ? (kept as T) : undefined;
};

/**
 * The plot fields to write when `patch` is applied to `scope`.
 *  - one curve: its fields go to `fitStyles[id]`; the graph-wide two still go to `fitStyle`.
 *  - every curve: the fields go to `fitStyle`, and are taken off every curve's own entry, so "all" really is all
 *    (a curve that kept an old colour of its own would otherwise ignore it).
 * A field set to undefined is removed, and an entry left empty is dropped, so a Reset returns to a fresh graph.
 */
export function fitStylePatch(plot: Pick<Plot, "fitStyle" | "fitStyles">, scope: FitScope, patch: Partial<FitStyle>): Pick<Plot, "fitStyle" | "fitStyles"> {
  const keys = Object.keys(patch) as (keyof FitStyle)[];
  const wide = Object.fromEntries(keys.filter((k) => GRAPH_WIDE.has(k)).map((k) => [k, patch[k]]));
  const curve = Object.fromEntries(keys.filter((k) => !GRAPH_WIDE.has(k)).map((k) => [k, patch[k]]));
  const own = { ...(plot.fitStyles ?? {}) };
  if (scope === "all") {
    for (const [id, entry] of Object.entries(own)) {
      const kept = live(Object.fromEntries(Object.entries(entry).filter(([k]) => !(k in curve))) as FitCurveStyle);
      if (kept) own[id] = kept; else delete own[id];
    }
    return { fitStyle: live({ ...(plot.fitStyle ?? {}), ...wide, ...curve } as FitStyle), fitStyles: live(own) };
  }
  const entry = live({ ...(own[scope] ?? {}), ...curve } as FitCurveStyle);
  if (entry) own[scope] = entry; else delete own[scope];
  return { fitStyle: live({ ...(plot.fitStyle ?? {}), ...wide } as FitStyle), fitStyles: live(own) };
}

/**
 * The plot fields to write to take one fitted curve off a graph: it leaves its slot, and its own style and dragged
 * offsets go with it. The other curves, and the graph-wide style, are untouched.
 */
export function fitCurveRemoval(plot: Pick<Plot, "fit" | "fits" | "fitStyles" | "fitsOffsets">, key: string): Pick<Plot, "fit" | "fits" | "fitStyles" | "fitsOffsets"> {
  const gone = fitCurves(plot).find((c) => c.key === key);
  if (!gone) return { fit: plot.fit, fits: plot.fits, fitStyles: plot.fitStyles, fitsOffsets: plot.fitsOffsets };
  const fits = gone.slot === "fit" ? plot.fits : (plot.fits ?? []).filter((_, i) => i !== gone.slot);
  const drop = <T extends object>(rec: Record<string, T> | undefined, ...keys: string[]): Record<string, T> | undefined => {
    if (!rec) return undefined;
    const kept = Object.fromEntries(Object.entries(rec).filter(([k]) => !keys.includes(k)));
    return Object.keys(kept).length ? kept : undefined;
  };
  return {
    fit: gone.slot === "fit" ? undefined : plot.fit,
    fits: fits && fits.length ? fits : undefined,
    fitStyles: drop(plot.fitStyles, key),
    // Its offsets live under its key, or (saved graphs) under its position.
    fitsOffsets: drop(plot.fitsOffsets, key, ...(typeof gone.slot === "number" ? [String(gone.slot)] : [])),
  };
}

/** Reset: every curve clears the graph-wide style and every curve's own; one curve clears only its own entry. */
export function fitStyleReset(plot: Pick<Plot, "fitStyle" | "fitStyles">, scope: FitScope): Pick<Plot, "fitStyle" | "fitStyles"> {
  if (scope === "all") return { fitStyle: undefined, fitStyles: undefined };
  const own = { ...(plot.fitStyles ?? {}) };
  delete own[scope];
  return { fitStyle: plot.fitStyle, fitStyles: live(own) };
}
