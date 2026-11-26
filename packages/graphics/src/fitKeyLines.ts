import type { Plot } from "@mady/core";

/**
 * The parameters that are a fit's headline result, by the engine's term names: the potency of a dose-response (both
 * potencies of a biphasic or bell-shaped one), the affinity or Michaelis constant and turnover of a binding or
 * kinetics fit, the midpoint of a sigmoid (Boltzmann, Richards, logistic, probit, Weibull, Gompertz inflection), the
 * rate of a decay or growth (half-life, doubling time, fast and slow rates, stretched-exponential tau), the centre of a
 * peak, the slope of a line, a segmental breakpoint, a melting point.
 */
const KEY_TERMS = new Set([
  "EC50", "IC50", "ED50", "LD50", "EC50_1", "EC50_2", "EC50_up", "EC50_down", "IC50_1", "IC50_2",
  "KM", "Km", "Kd", "Kd1", "Kd2", "logKd", "Ki", "Khalf", "kcat",
  "V50", "Midpoint", "Inflection", "Mu", "Scale",
  "Half-life", "half-life", "t1/2", "Doubling time", "Kfast", "Kslow", "Tau",
  "Mean", "Center", "Tm",
]);

/** Headline values only when nothing above is: a straight line's slope (Boltzmann and segmental fits also report a
 *  "Slope", their steepness, beside the midpoint that is their result) and a breakpoint or lag time. */
const FALLBACK_TERMS = new Set(["Slope", "X0"]);
/** The potencies a fit's crosshair label already prints ("EC50 = 2.9"). */
const MARKER_TERMS = new Set(["EC50", "IC50", "ED50", "LD50"]);

/**
 * Which lines of a fit's parameter block are its key result, by position. A key value the fit's
 * potency label already prints on the graph is left out, so a dose-response with a crosshair needs no
 * block at all: its coloured label is the result. A fit with no named key value (a polynomial, a power law, the
 * user's own equation) shows its R², how well the curve describes the data; a model-free curve (LOWESS, spline)
 * shows nothing, its lines being smoothing settings.
 */
export function fitKeyLines(keys: readonly string[], lineCount: number, hasMarker: boolean): Set<number> {
  const out = new Set<number>();
  keys.forEach((k, i) => {
    if (i < lineCount && KEY_TERMS.has(k) && !(hasMarker && MARKER_TERMS.has(k))) out.add(i);
  });
  if (out.size === 0) keys.forEach((k, i) => { if (i < lineCount && FALLBACK_TERMS.has(k)) out.add(i); });
  // A fit with a crosshair label has its result printed there (a fit saved without line keys included).
  if (out.size === 0 && !hasMarker) {
    const r2 = keys.findIndex((k, i) => i < lineCount && (k === "R²" || k === "R2"));
    if (r2 >= 0) out.add(r2);
    // A fit saved without line names cannot be read: its first line, as before.
    else if (keys.length === 0 && lineCount > 0) out.add(0);
  }
  return out;
}

/** Whether the graph draws two or more fits with fitted values: each then shows only its key result. */
export function severalFitBlocks(plot: Pick<Plot, "fit" | "fits">): boolean {
  const withParams = [plot.fit, ...(plot.fits ?? [])].filter((f) => f && f.points.length > 0 && (f.params?.length ?? 0) > 0);
  return withParams.length >= 2;
}
