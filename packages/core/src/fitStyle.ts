import type { FitStyle, Plot, PlotFit } from "./model";

/** One drawn fitted curve of a plot: where it is stored and the key its own style and label offsets are stored under. */
export interface FitCurveRef {
  key: string;
  pf: PlotFit;
  /** `"fit"` for the single-fit slot, else the position in `plot.fits`. */
  slot: "fit" | number;
}

/**
 * The fitted curves of a plot in drawing order (the single fit first, then `fits`), each with its key.
 *
 * A curve an analysis made is keyed by that analysis and its own name (`<analysis id>:<curve name>`), so its style and
 * dragged labels stay with it when other curves come and go and when the analysis is re-run. A curve with no analysis
 * behind it is keyed by where it is stored: `"fit"` for the single slot, `"0"`, `"1"`… for `fits[i]`. A key met twice
 * (two curves with one name from one analysis) gets `#2`, `#3`… so each curve still has its own.
 */
export function fitCurves(plot: Pick<Plot, "fit" | "fits">): FitCurveRef[] {
  const seen = new Map<string, number>();
  const unique = (base: string): string => {
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}#${n}`;
  };
  const keyOf = (pf: PlotFit, positional: string): string => (pf.analysisSource ? `${pf.analysisSource}:${pf.label}` : positional);
  const out: FitCurveRef[] = [];
  if (plot.fit) out.push({ key: unique(keyOf(plot.fit, "fit")), pf: plot.fit, slot: "fit" });
  (plot.fits ?? []).forEach((pf, i) => out.push({ key: unique(keyOf(pf, String(i))), pf, slot: i }));
  return out;
}

/**
 * The dragged label / parameter-block offsets of one curve in `plot.fitsOffsets`. Saved graphs stored them under the
 * curve's position; that entry is still read when the curve has none under its key.
 */
export function fitOffsetsOf(plot: Pick<Plot, "fitsOffsets">, ref: Pick<FitCurveRef, "key" | "slot">): NonNullable<Plot["fitsOffsets"]>[string] | undefined {
  return plot.fitsOffsets?.[ref.key] ?? (typeof ref.slot === "number" ? plot.fitsOffsets?.[String(ref.slot)] : undefined);
}

/**
 * The look of one fitted curve: the graph-wide `fitStyle`, with the fields that curve's own `fitStyles[key]` sets laid
 * over it. A field the curve leaves out, or sets to undefined, keeps the graph-wide value.
 */
export function resolveFitStyle(plot: Pick<Plot, "fitStyle" | "fitStyles">, key: string): FitStyle {
  const own = plot.fitStyles?.[key];
  if (!own) return plot.fitStyle ?? {};
  const out: Record<string, unknown> = { ...(plot.fitStyle ?? {}) };
  for (const [k, v] of Object.entries(own)) if (v !== undefined) out[k] = v;
  return out as FitStyle;
}
