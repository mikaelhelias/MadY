/**
 * Fit-parameter block — turn a curve fit's tidy terms into
 * the typeset block published figures print inside the axes:
 *
 *     K_M   = 29 ± 3
 *     k_cat = 1.5 ± 0.1
 *     R²    = 0.998
 *
 * Journal kinetics panels commonly carry one, and MadY already computes every number in
 * it — so this is a typeset-and-place problem, not a maths one.
 *
 * Emits rich-text markup (`_{…}` / `^{…}`), which the renderer's `RichText` already turns
 * into real sub/superscript tspans, so `KM` prints as K with a subscript M rather than as
 * two capitals.
 *
 * Pure + DOM-free → unit-testable.
 */
import type { FitParamLine, PlotFit, TidyTerm } from "@mady/core";
import { sciMarkup } from "@mady/core";

/**
 * How a fitted parameter's name is typeset.
 *
 * Keyed by the engine's own term names (`engine.py` "params" lists). Anything not listed
 * falls through to a generic rule, so a new model's parameters still render sensibly
 * instead of being dropped.
 *
 * Note: `KM` keeps its capital M — that is the Michaelis constant's correct form and the
 * form this project uses throughout.
 */
const SYMBOL: Record<string, string> = {
  KM: "K_{M}",
  Km: "K_{M}", // engine variants — normalise to the correct capital M
  Ki: "K_{i}",
  Kd: "K_{d}",
  Khalf: "K_{half}",
  Vmax: "V_{max}",
  kcat: "k_{cat}",
  kuncat: "k_{uncat}",
  kobs: "k_{obs}",
  Et: "E_{t}",
  S0: "S_{0}",
  EC50: "EC_{50}",
  IC50: "IC_{50}",
  R2: "R²",
  r2: "R²",
  "R^2": "R²",
  adjR2: "adjusted R²",
  Bottom: "Bottom",
  Top: "Top",
  h: "h",
  "Hill slope": "Hill slope",
};

/** Generic typesetting for a parameter this table doesn't name explicitly. */
function symbolOf(term: string): string {
  const known = SYMBOL[term];
  if (known) return known;
  // A trailing number is nearly always a subscript ("EC90" → EC_{90}, "pKa2" → pKa_{2}).
  const m = /^([A-Za-z]+)(\d+)$/.exec(term);
  if (m) return `${m[1]}_{${m[2]}}`;
  return term;
}

/** 3 significant figures, switching to ×10ⁿ for extremes — published figures do not print `1e-6`.
 *  Markup form: the block is drawn as an SVG label, so the exponent must become a real
 *  raised tspan rather than a Unicode lookalike. */
export function fmtFitValue(v: number): string {
  return sciMarkup(v);
}

/** Terms that are diagnostics rather than fitted parameters, printed without a ± error. */
// Note: the list includes the names the engine prints ("R²", "Adjusted R²", "Sy.x (RMSE)"…) as
// well as "R2"-style spellings, so `includeFitQuality: false` removes every R² line.
const NO_ERROR = new Set([
  "R2", "r2", "R^2", "R²", "adjR2", "Adjusted R²", "n", "df", "AIC", "AICc", "BIC", "RMSE", "Sy.x", "Sy.x (RMSE)",
  "Sum of squares", "Runs test (lack of fit)",
]);

export interface FitParamOptions {
  /** Include the goodness-of-fit rows (R² and friends). Default true. */
  includeFitQuality?: boolean | undefined;
  /** Cap the number of lines; the block is an annotation, not a results table. Default 6. */
  max?: number | undefined;
}

/**
 * Build the block's lines from an analysis's tidy terms.
 *
 * Only rows with a numeric estimate become lines: a tidy table can carry string estimates
 * (a model-comparison winner's name, an F-test's "1, 7" df) and those are not parameters.
 * The standard error is printed as `± se` when the engine reported one — never invented,
 * and never shown for a diagnostic like R² where it would be meaningless.
 *
 * Units are deliberately not synthesised. The engine does not know them, and guessing
 * "µM" onto a fitted constant would be a fabrication; the block is editable so the user
 * can add the real units.
 */
export function fitParamLines(terms: readonly TidyTerm[], opts: FitParamOptions = {}): string[] {
  return fitParamRows(terms, { max: 6, ...opts }).map((r) => r.text);
}

/**
 * Every line the block can show, each with the engine's term name as its key — what a fit
 * attaches to a graph. No cap: which lines are shown is the user's choice
 * (`Plot.fitParams.lines`, the first six by default), so every number the fit reports must be
 * there to choose from. Same formatting rules as `fitParamLines`.
 */
export function fitParamRows(terms: readonly TidyTerm[], opts: FitParamOptions = {}): { key: string; text: string }[] {
  const includeQuality = opts.includeFitQuality ?? true;
  const max = opts.max ?? Infinity;
  const out: { key: string; text: string }[] = [];
  const seen = new Set<string>();
  for (const t of terms) {
    if (out.length >= max) break;
    const name = (t.term ?? "").trim();
    if (!name) continue;
    if (typeof t.estimate !== "number" || !Number.isFinite(t.estimate)) continue;
    const quality = NO_ERROR.has(name);
    if (quality && !includeQuality) continue;
    // A repeated term name would make two lines share one stored choice — keep them apart.
    let key = name;
    for (let k = 2; seen.has(key); k++) key = `${name} (${k})`;
    seen.add(key);
    const value = fmtFitValue(t.estimate);
    const se = !quality && typeof t.se === "number" && Number.isFinite(t.se) && t.se > 0 ? ` ± ${fmtFitValue(t.se)}` : "";
    out.push({ key, text: `${symbolOf(name)} = ${value}${se}` });
  }
  return out;
}

/**
 * The per-line choices with one field removed from every line (e.g. every drag offset, when the
 * lines are joined back into a block or their positions reset). A line left with no choices at
 * all is dropped, and undefined comes back when nothing is left, so a reset leaves no residue.
 */
export function fitLinesWithout(
  lines: Record<string, FitParamLine> | undefined,
  field: keyof FitParamLine,
): Record<string, FitParamLine> | undefined {
  if (!lines) return undefined;
  const out: Record<string, FitParamLine> = {};
  for (const [key, line] of Object.entries(lines)) {
    const { [field]: _gone, ...rest } = line;
    if (Object.values(rest).some((v) => v !== undefined)) out[key] = rest;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * What typing on the graph does to the per-line choices. `keys` = the lines edited: one when a
 * line is edited on its own, every shown line (in order) when the block is edited whole, one
 * typed line each.
 *  - text equal to the fitted text → the override is cleared (the line follows the fit again);
 *  - an emptied line → hidden (its override cleared too);
 *  - anything else → kept as the line's text, with the fitted text it replaced, so a re-fit
 *    that changes the number keeps the text and warns.
 * A whole-block edit with fewer lines than keys leaves the lines past the end alone.
 */
export function typedFitParamLines(
  fit: Pick<PlotFit, "params" | "paramKeys">,
  lines: Record<string, FitParamLine> | undefined,
  keys: readonly string[],
  value: string,
): Record<string, FitParamLine> {
  const fitted = (key: string): string | undefined => {
    const k = fit.paramKeys ? fit.paramKeys.indexOf(key) : /^#\d+$/.test(key) ? Number(key.slice(1)) : -1;
    return k >= 0 ? fit.params?.[k] : undefined;
  };
  const typed = value.split("\n");
  const out = { ...(lines ?? {}) };
  keys.forEach((key, n) => {
    if (keys.length > 1 && n >= typed.length) return;
    const text = (keys.length === 1 ? value : typed[n] ?? "").trim();
    const was = fitted(key);
    const { text: _t, fittedText: _f, ...rest } = out[key] ?? {};
    if (text === "") out[key] = { ...rest, show: false };
    else if (text === was) out[key] = rest;
    else out[key] = { ...rest, text, ...(was !== undefined ? { fittedText: was } : {}) };
  });
  return out;
}
