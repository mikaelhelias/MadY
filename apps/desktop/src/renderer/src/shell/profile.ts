/**
 * User style profile — the person's personal default look, applied to every newly
 * created graph. The default can point at a **built-in**
 * style preset (core/presets.ts `STYLE_PRESETS`) or at one of the user's own saved
 * **custom presets** (`userPresets.ts`). Stored in localStorage so it persists
 * across sessions on the same computer.
 *
 * This is the identity/settings layer that is distinct from per-figure presets:
 * a preset is a one-click look you apply to one graph; the profile is the look a
 * *new* graph starts from.
 */

import { findPreset } from "@mady/core";
import type { AnalysisParams, DateOrder, ErrorBarType, PlotKind, SignificanceThreshold, StylePreset } from "@mady/core";
import { dGet, dRemove, dSet } from "./durableStore";

const KEY = "mady.profile.presetName";
/** Per-graph-type default overrides (a `PlotKind` absent from the map inherits the global default). */
const KIND_KEY = "mady.profile.perKind";
/** Global common style defaults layered on top of the resolved preset for every new graph. */
const PARAMS_KEY = "mady.profile.params";
/** Application-level preferences (default graph type, confidence, theme, autosave…). */
const APP_KEY = "mady.profile.app";
/** Per-analysis-method remembered option state (method id → whitelisted options). */
const ANALYSIS_DEFAULTS_KEY = "mady.profile.analysisDefaults";
/** Out-of-the-box default: every new graph starts in the house style. */
const DEFAULT_PRESET = "MadY default";
/** Sentinel stored when the user explicitly chooses "None" (distinct from never-set). */
const NONE = "__none__";

/**
 * What a new graph inherits: a built-in preset (by name), a custom user preset (by
 * id), or null = the user explicitly opted out ("None").
 */
export type ProfileDefault =
  | { kind: "builtin"; name: string }
  | { kind: "user"; id: string }
  | null;

/**
 * Resolve the saved default descriptor. Backward-compatible with the previous
 * format (a bare preset name string): a JSON object parses directly, the `__none__`
 * sentinel → null, any other bare string → a builtin reference, and never-set →
 * the house default.
 */
export function getProfileDefault(): ProfileDefault {
  const raw = dGet(KEY);
  if (raw === null) return { kind: "builtin", name: DEFAULT_PRESET }; // never set → house default
  if (raw === NONE) return null; // explicit opt-out
  if (raw.startsWith("{")) {
    try {
      const d = JSON.parse(raw) as ProfileDefault;
      if (d && (d.kind === "builtin" || d.kind === "user")) return d;
    } catch {
      /* fall through to legacy bare-name handling */
    }
  }
  return { kind: "builtin", name: raw }; // legacy: a bare preset name
}

/** Persist the user's default for new graphs (null = explicit "None"). Mirrored to
 *  the durable userData file (see durableStore) so it survives a localStorage wipe. */
export function setProfileDefault(d: ProfileDefault): void {
  dSet(KEY, d === null ? NONE : JSON.stringify(d));
}

/** Resolve the default to a concrete built-in preset, when it references one. */
export function getProfileBuiltinPreset(): StylePreset | undefined {
  const d = getProfileDefault();
  return d?.kind === "builtin" ? findPreset(d.name) : undefined;
}

// ── Per-graph-type defaults ──────────────────────────────────────────────────
// A user can pick a favourite look for each graph type (scatter → Scientific Journal, bar →
// Editorial…). A type absent from the map inherits the single global default
// above; a type present with a `null` value is an explicit "None" for that type.

/** The whole per-kind map (kind → its own default; absent = inherit global). */
export function getKindDefaults(): Partial<Record<PlotKind, ProfileDefault>> {
  const raw = dGet(KIND_KEY);
  if (!raw) return {};
  try {
    const m = JSON.parse(raw) as Partial<Record<PlotKind, ProfileDefault>>;
    return m && typeof m === "object" ? m : {};
  } catch {
    return {};
  }
}

/** Set (or, with "inherit", clear) one graph type's default. `null` = explicit None. */
export function setKindDefault(kind: PlotKind, ref: ProfileDefault | "inherit"): void {
  const m = getKindDefaults();
  if (ref === "inherit") delete m[kind];
  else m[kind] = ref;
  dSet(KIND_KEY, JSON.stringify(m));
}

/** Resolve the default a new graph of this kind starts from: its own override if
 *  set (including an explicit None), else the single global default. */
export function getProfileForKind(kind: PlotKind): ProfileDefault {
  const m = getKindDefaults();
  return kind in m ? (m[kind] ?? null) : getProfileDefault();
}

// ── Global common style params ───────────────────────────────────────────────
// A curated subset of a preset (title font/size, axis thickness/colour, grid,
// palette) the user sets once and has layered on top of every new graph's preset.

/** Curated global style defaults (a `StylePreset` subset) applied to every new graph. */
export type GlobalStyleParams = Partial<
  Pick<StylePreset, "fontFamily" | "titleSize" | "titleBold" | "axisThickness" | "axisColor" | "gridShow" | "palette">
>;

/** The saved global params ({} when unset). */
export function getGlobalParams(): GlobalStyleParams {
  const raw = dGet(PARAMS_KEY);
  if (!raw) return {};
  try {
    const p = JSON.parse(raw) as GlobalStyleParams;
    return p && typeof p === "object" ? p : {};
  } catch {
    return {};
  }
}

/** Persist the global params (pass {} to clear). Empty values are pruned. */
export function setGlobalParams(p: GlobalStyleParams): void {
  const pruned: GlobalStyleParams = {};
  for (const [k, v] of Object.entries(p) as [keyof GlobalStyleParams, unknown][]) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    (pruned as Record<string, unknown>)[k] = v;
  }
  dSet(PARAMS_KEY, JSON.stringify(pruned));
}

// ── Application-level defaults ────────────────────────────────────────────────
// The app-wide preferences usually found in an `Edit → Preferences` panel
// that the style-defaults layer above doesn't cover: which graph type / error-bar
// / confidence a new document starts from, theme, and the autosave cadence. Each
// field is optional and, when unset, the consumer falls back to its built-in
// default — so an empty store is exactly the zero-config behaviour.

/** App-wide defaults. Every field optional: unset ⇒ the consumer's built-in fallback. */
export interface AppDefaults {
  /** `NEW_GRAPH_GENRES` key a fresh document/graph starts on (unset ⇒ the first genre). */
  defaultGenre?: string;
  /** Default confidence level as a percent (e.g. 95 = 95%); the engine derives α = 1 − conf/100. */
  conf?: number;
  /** Default error-bar type for new error-capable graphs. */
  errorBars?: ErrorBarType;
  /** Persisted UI theme (unset ⇒ "light"). */
  theme?: "light" | "dark";
  /** Autosave debounce in ms (unset ⇒ the built-in AUTOSAVE_DEBOUNCE_MS). */
  autosaveMs?: number;
  /** Whether autosave is enabled (unset ⇒ true). */
  autosaveEnabled?: boolean;
  /** Default significance threshold ladder for new graphs (unset ⇒ the built-in one).
   *  Stamped onto a graph at creation rather than read at render, so a `.mady` file is
   *  self-contained and a figure never changes because a setting moved under it. */
  significanceThresholds?: SignificanceThreshold[];
  /** Default label for a comparison that clears no threshold (unset ⇒ "ns"). */
  significanceNsSymbol?: string;
  /**
   * Scale an unsized graph up to the space available, measured once at startup
   * (unset ⇒ true). See `figureFit.ts`.
   *
   * Note: read at render time, not stamped onto graphs — unlike `significanceThresholds`
   * above, which is deliberately baked in at creation so a saved figure never changes
   * because a setting moved under it. The difference is that this one has to be
   * reversible: turning it off must put every fitted figure straight back to 580 × 380,
   * which a stamped value could not do. Nothing it affects is ever written to a `.mady`
   * file, so the file stays self-contained either way.
   */
  fitGraphsToWindow?: boolean;
  /**
   * How a purely-numeric slash/dash date typed into a `date` column is read — "mdy" (US
   * month/day/year) or "dmy" (day/month/year, the international order). Unset ⇒ "Auto", which
   * infers from the OS locale (see {@link resolveDateOrder}). ISO and textual-month dates are
   * unambiguous and ignore this. Only affects how new input is parsed, never stored dates.
   */
  dateOrder?: DateOrder;
  /**
   * Comma-separated tokens the importer reads as missing (→ blank), seeding the Import dialog's
   * "Missing values" field. Unset ⇒ the built-in {@link DEFAULT_MISSING_VALUES}; an explicit
   * empty string means "treat nothing but a blank cell as missing". Only text imports use it.
   */
  missingValues?: string;
  /**
   * Round the numbers in on-screen results tables to this many significant figures. Unset or 0
   * ⇒ off: the table shows the engine's full precision (rounding is an option,
   * never systematic). Display only — exports, Copy, the key-result cards (which have their
   * own fixed precision) and the numbers themselves are untouched. p-values keep their own
   * 3-figure / "<0.0001" convention regardless.
   */
  resultDigits?: number;
  /** Interactive HTML export: show each mark's values on hover (unset ⇒ true). The Export dialog's
   *  "Show values on hover" box starts from this; unticking it there changes that one export only. */
  exportHoverValues?: boolean;
}

/** Built-in default for the importer's missing-value tokens: empty — keep every value as
 *  imported. A truly blank cell is always missing regardless; treating text markers like "NA"
 *  as missing is opt-in (type them into the import dialog, or set a default in Settings).
 *  The user must never have to clear a field to keep their data — keep-all is the
 *  default, excluding NA is the deliberate choice. */
export const DEFAULT_MISSING_VALUES = "";

/**
 * The date order to use for numeric slash/dash entry: the saved preference, else inferred from
 * the OS locale — US month/day for a US locale, day/month everywhere else (the world is majority
 * DMY and the setting is one click away). Deterministic and overridable, so "05/06/2020" is never
 * left to V8's silent US guess.
 */
export function resolveDateOrder(): DateOrder {
  const pref = getAppDefaults().dateOrder;
  if (pref === "mdy" || pref === "dmy") return pref;
  try {
    const loc = (typeof navigator !== "undefined" && navigator.language) || "";
    return /-US$/i.test(loc) ? "mdy" : "dmy";
  } catch {
    return "dmy";
  }
}

/** The default missing-value tokens: the saved preference, else the built-in set. An explicit
 *  empty string is honoured (the user chose "blank cells only"). */
export function resolveMissingValues(): string {
  const pref = getAppDefaults().missingValues;
  return pref === undefined ? DEFAULT_MISSING_VALUES : pref;
}

/** The saved app defaults ({} when never set or unparseable). */
export function getAppDefaults(): AppDefaults {
  const raw = dGet(APP_KEY);
  if (!raw) return {};
  try {
    const d = JSON.parse(raw) as AppDefaults;
    return d && typeof d === "object" ? d : {};
  } catch {
    return {};
  }
}

/** A patch to {@link AppDefaults}: a field set to `undefined` clears it (explicit
 *  `undefined` is permitted under `exactOptionalPropertyTypes` for that reason). */
export type AppDefaultsPatch = { [K in keyof AppDefaults]?: AppDefaults[K] | undefined };

/**
 * Merge a patch into the saved app defaults. Only the keys present in `patch`
 * change; a key set to `undefined`/`null` is cleared (reverts to the consumer's
 * built-in fallback). Pass `{}` to leave everything as-is.
 */
export function setAppDefaults(patch: AppDefaultsPatch): void {
  const merged = { ...getAppDefaults(), ...patch };
  const pruned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(merged)) {
    if (v === undefined || v === null) continue;
    pruned[k] = v;
  }
  dSet(APP_KEY, JSON.stringify(pruned));
}

// ── Per-method analysis defaults ──────────────────────────────────────────────
// A user can pin the option state of an analysis (e.g. always Welch's t-test, or
// always weight 1/Y² with ROUT on) so the Analyze dialog re-opens pre-configured.
// Hard rule: only method-configuration fields are ever remembered — never column
// selections or any data-bound value — enforced by the allow-list below so a new
// AnalysisParams field can never silently leak a data selection into the profile.

/** The AnalysisParams fields safe to remember as a per-method default (options, never data). */
const ANALYSIS_OPTION_KEYS = [
  "variant", "variant2", "conf", "ciMethod", "pairwise", "pairwiseMethod",
  "percent", "agreementK", "lambda", "minPeakFraction", "baselineValue", "tail", "posthoc", "scheme", "compare", "weighting", "rout", "flag",
  "smoothWindow", "ecLevels", "componentSelection", "kaiserThreshold", "fixedK",
  "varianceThreshold", "parallelPercentile", "k", "seed", "standardize",
  "metric", "linkage", "scanK", "kMax", "sloped",
] as const satisfies readonly (keyof AnalysisParams)[];

/** The remembered option subset for one method (never includes columns/data selections). */
export type AnalysisDefault = Partial<Pick<AnalysisParams, (typeof ANALYSIS_OPTION_KEYS)[number]>>;

const OPTION_KEY_SET = new Set<string>(ANALYSIS_OPTION_KEYS);

/** Keep only whitelisted option fields; drop `undefined`/`null` and anything data-bound. */
function pickOptions(opts: Partial<AnalysisParams>): AnalysisDefault {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(opts)) {
    if (!OPTION_KEY_SET.has(k)) continue; // data-bound / unknown → never stored
    if (v === undefined || v === null) continue;
    out[k] = v;
  }
  return out as AnalysisDefault;
}

/** The whole method → saved-options map (`{}` when unset). */
function getAnalysisDefaults(): Record<string, AnalysisDefault> {
  const raw = dGet(ANALYSIS_DEFAULTS_KEY);
  if (!raw) return {};
  try {
    const m = JSON.parse(raw) as Record<string, AnalysisDefault>;
    return m && typeof m === "object" ? m : {};
  } catch {
    return {};
  }
}

/** The saved option defaults for one analysis method, or `undefined` if none. */
export function getAnalysisDefault(method: string): AnalysisDefault | undefined {
  return getAnalysisDefaults()[method];
}

/**
 * Remember the option state for a method (the Analyze dialog re-hydrates from it).
 * Only allow-listed configuration fields are stored; column/data selections are
 * stripped. Storing an empty option set clears any existing default for the method.
 */
export function setAnalysisDefault(method: string, opts: Partial<AnalysisParams>): void {
  const picked = pickOptions(opts);
  const all = getAnalysisDefaults();
  if (Object.keys(picked).length === 0) delete all[method];
  else all[method] = picked;
  if (Object.keys(all).length === 0) dRemove(ANALYSIS_DEFAULTS_KEY);
  else dSet(ANALYSIS_DEFAULTS_KEY, JSON.stringify(all));
}

/** Forget the saved default for one method (no-op if there wasn't one). */
export function clearAnalysisDefault(method: string): void {
  const all = getAnalysisDefaults();
  if (!(method in all)) return;
  delete all[method];
  if (Object.keys(all).length === 0) dRemove(ANALYSIS_DEFAULTS_KEY);
  else dSet(ANALYSIS_DEFAULTS_KEY, JSON.stringify(all));
}

/** Method ids that currently have a saved default (for the Settings "clear" list). */
export function listAnalysisDefaults(): string[] {
  return Object.keys(getAnalysisDefaults());
}
