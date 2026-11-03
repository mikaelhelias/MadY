/**
 * Colour ramps for value-graduated fills (DOM-free, deterministic). A ramp maps a
 * normalised value t∈[0,1] → a fill colour + opacity, so a series of bars/boxes
 * can shade light→dark (or by a scientific colormap) with their value. Covers the
 * simple ramps (lightness / transparency / two-colour) plus a generous set of
 * perceptual + classic colormaps.
 *
 * One resolver for every drawing site. `resolveRamp()` turns a `GradRamp` reference —
 * a built-in name, or `custom:<id>` pointing at a user-built [[Gradient]] — into a
 * `ResolvedRamp`, and `makeRamp()` turns that into the single function `(t) => paint`
 * that every site uses. The shaping knobs (midpoint · gamma · discrete steps ·
 * interpolation space · opacity curve) therefore exist once and reach the graduated
 * fills, the per-point colour-from-column, all four colour bars (plot · parallel · ternary ·
 * per-track), both heatmap builders, the parallel lines, the ridgeline spectrum and the
 * timeline tracks together. Each site passes its own `RampShape` — the plot's shaping knobs
 * plus the data range they are measured against.
 *
 * The 17 built-ins render bit-identically to a pinned baseline: every card, screenshot and
 * test fixture is drawn with them. `color.identity.test.ts` pins all 17 against
 * `ramp-baseline.json`.
 */

import type { GradRamp, GradSpace, GradStop, Gradient } from "@mady/core";
import { customRampId, isCustomRamp } from "@mady/core";

type RGB = [number, number, number];

function hexToRgb(hex: string): RGB {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full.slice(0, 6).padEnd(6, "0"), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]: RGB): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Linear blend of two colours (amount 0 → a, 1 → b). */
export function mix(a: string, b: string, amount: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  const t = Math.max(0, Math.min(1, amount));
  return rgbToHex([r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t]);
}

/** Sample an evenly-spaced colour-stop array at t∈[0,1] (linear interpolation). */
function sample(stops: readonly string[], t: number): string {
  const u = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.floor(u);
  if (i >= stops.length - 1) return stops[stops.length - 1]!;
  return mix(stops[i]!, stops[i + 1]!, u - i);
}

/** Perceptual + classic colormaps (evenly-spaced stops; interpolated by `sample`). */
export const COLORMAPS: Record<string, readonly string[]> = {
  viridis: ["#440154", "#472d7b", "#3b528b", "#2c728e", "#21918c", "#28ae80", "#5ec962", "#addc30", "#fde725"],
  magma: ["#000004", "#1c1044", "#4f127b", "#812581", "#b5367a", "#e55064", "#fb8761", "#fec287", "#fcfdbf"],
  plasma: ["#0d0887", "#5302a3", "#8b0aa5", "#b83289", "#db5c68", "#f48849", "#febd2a", "#f0f921"],
  inferno: ["#000004", "#1b0c41", "#4a0c6b", "#781c6d", "#a52c60", "#cf4446", "#ed6925", "#fb9b06", "#fcffa4"],
  cividis: ["#00204d", "#00336f", "#39486b", "#575d6d", "#707173", "#8a8779", "#a69d75", "#c4b56c", "#fee838"],
  turbo: ["#30123b", "#4458cb", "#3e9bfe", "#18d6cb", "#46f884", "#a4fc3c", "#e2dc37", "#fb8022", "#c42503", "#7a0403"],
  grayscale: ["#f5f5f5", "#111111"],
  rainbow: ["#ff0000", "#ff8000", "#ffff00", "#00d000", "#00d0d0", "#0000ff", "#8000ff"],
  blues: ["#f7fbff", "#c6dbef", "#6baed6", "#2171b5", "#08306b"],
  reds: ["#fff5f0", "#fcae91", "#fb6a4a", "#cb181d", "#67000d"],
  greens: ["#f7fcf5", "#c7e9c0", "#74c476", "#238b45", "#00441b"],
  spectral: ["#9e0142", "#f46d43", "#fee08b", "#ffffbf", "#e6f598", "#66c2a5", "#5e4fa2"],
  coolwarm: ["#3b4cc0", "#7b9ff9", "#c0d4f5", "#f2cbb7", "#ee8468", "#b40426"],
};

export interface RampPaint {
  color: string;
  opacity: number;
}

/**
 * Resolve a graduated fill at normalised value `t`. `base` is the series colour
 * (used by the lightness / transparency / two-colour ramps; `to` is the high end
 * for two-colour). `reversed` flips the ramp (so low values can read dark/opaque).
 */
export function rampColor(
  ramp: GradRamp,
  t: number,
  base: string,
  to: string,
  reversed: boolean,
): RampPaint {
  return makeRamp(resolveBuiltinRamp(ramp), base, to, reversed)(t);
}

// ---------------------------------------------------------------------------
// Colour spaces. RGB is the default; HSL keeps a
// rainbow vivid instead of passing through grey between its stops; Lab is
// perceptually even. Only used when a gradient asks for them — the built-ins are
// RGB, so nothing already drawn moves.
// ---------------------------------------------------------------------------

/** sRGB hex → HSL (h 0..360, s/l 0..1). */
export function rgbToHsl(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255) as RGB;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  const d = mx - mn;
  if (d === 0) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h: number;
  if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (mx === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return [h, s, l];
}

/** HSL (h in degrees, wrapped; s/l 0..1) → sRGB hex. Also the sweep generator's paint. */
export function hslToHex(h: number, s: number, l: number): string {
  const hh = ((h % 360) + 360) % 360;
  const ss = Math.max(0, Math.min(1, s));
  const ll = Math.max(0, Math.min(1, l));
  const c = (1 - Math.abs(2 * ll - 1)) * ss;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = ll - c / 2;
  const seg = Math.floor(hh / 60) % 6;
  const [r, g, b] = (
    seg === 0 ? [c, x, 0] : seg === 1 ? [x, c, 0] : seg === 2 ? [0, c, x] :
    seg === 3 ? [0, x, c] : seg === 4 ? [x, 0, c] : [c, 0, x]
  ) as RGB;
  return rgbToHex([(r + m) * 255, (g + m) * 255, (b + m) * 255]);
}

const srgbToLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (c: number): number => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
// D65 white point.
const XN = 0.95047, YN = 1.0, ZN = 1.08883;
const fwd = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29);
const inv = (t: number): number => (t > 6 / 29 ? t ** 3 : (108 / 841) * (t - 4 / 29));

/** sRGB hex → CIE L*a*b* (D65). */
export function rgbToLab(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex).map((v) => srgbToLinear(v / 255)) as RGB;
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / XN;
  const y = (0.2126 * r + 0.7152 * g + 0.0722 * b) / YN;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / ZN;
  const fx = fwd(x), fy = fwd(y), fz = fwd(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIE L*a*b* (D65) → sRGB hex (clamped into gamut). */
export function labToHex(L: number, a: number, bb: number): string {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - bb / 200;
  const x = inv(fx) * XN, y = inv(fy) * YN, z = inv(fz) * ZN;
  const r = 3.2406 * x - 1.5372 * y - 0.4986 * z;
  const g = -0.9689 * x + 1.8758 * y + 0.0415 * z;
  const b = 0.0557 * x - 0.204 * y + 1.057 * z;
  return rgbToHex([linearToSrgb(r) * 255, linearToSrgb(g) * 255, linearToSrgb(b) * 255] as RGB);
}

/** Blend two colours in the requested space. `rgb` delegates to `mix`, so an RGB
 *  gradient is bit-identical to `mix`. */
export function mixIn(space: GradSpace, a: string, b: string, amount: number): string {
  const t = Math.max(0, Math.min(1, amount));
  if (space === "rgb") return mix(a, b, t);
  if (space === "hsl") {
    const [h1, s1, l1] = rgbToHsl(a);
    const [h2, s2, l2] = rgbToHsl(b);
    // Shortest arc round the wheel, so blue→red goes through magenta, not through grey.
    let dh = h2 - h1;
    if (dh > 180) dh -= 360;
    if (dh < -180) dh += 360;
    return hslToHex(h1 + dh * t, s1 + (s2 - s1) * t, l1 + (l2 - l1) * t);
  }
  const [L1, a1, b1] = rgbToLab(a);
  const [L2, a2, b2] = rgbToLab(b);
  return labToHex(L1 + (L2 - L1) * t, a1 + (a2 - a1) * t, b1 + (b2 - b1) * t);
}

// ---------------------------------------------------------------------------
// Resolution: a GradRamp reference → the mapping it describes.
// ---------------------------------------------------------------------------

/** A ramp reference resolved into the data `makeRamp` needs. Either a `derived`
 *  built-in (whose colours come from the caller's base/to) or a stop list. */
export interface ResolvedRamp {
  /** Built-ins whose colours are computed from the caller's base/to colours. */
  derived?: "lightness" | "transparency" | "lightness-transparency" | "twocolor" | undefined;
  /** Evenly-spaced colour list — the built-in colormaps. Sampled by the even-spacing
   *  path so those ramps stay bit-identical to the baseline (see the file header). */
  evenColors?: readonly string[] | undefined;
  /** Positional stops — a user-built gradient. */
  stops?: readonly GradStop[] | undefined;
  space: GradSpace;
  midpoint?: number | undefined;
  gamma?: number | undefined;
  steps?: number | undefined;
  /** Class edges in t-space (ascending, strictly inside 0..1), when the classes are not equal
   *  intervals — quantile classes, or the user's own break values. `steps` still says how many
   *  there are; this says where they fall, and the colour bar draws them at these widths. */
  stepEdges?: number[] | undefined;
  /** How the class edges are chosen when `steps` >= 2 (the rule lives on the gradient; the
   *  data it needs comes from the site, in `RampShape`). */
  stepMode?: "equal" | "quantile" | "breaks" | undefined;
  /** The user's own cut values, in data units, when `stepMode` is "breaks". */
  breaks?: number[] | undefined;
  opacityCurve?: [number, number] | undefined;
  /** Carried through for the drawing sites that honour them (missing / out-of-range
   *  cells); `makeRamp` itself never applies these. */
  nanColor?: string | undefined;
  underColor?: string | undefined;
  overColor?: string | undefined;
}

const DERIVED = new Set(["lightness", "transparency", "lightness-transparency", "twocolor"]);

/** Resolve a built-in ramp name. A `custom:` reference resolves to viridis here — use
 *  `resolveRamp` (or a `RampResolver`) when a gradient registry is available. */
export function resolveBuiltinRamp(ramp: GradRamp): ResolvedRamp {
  if (DERIVED.has(ramp)) return { derived: ramp as ResolvedRamp["derived"], space: "rgb" };
  return { evenColors: COLORMAPS[ramp] ?? COLORMAPS.viridis!, space: "rgb" };
}

/** Materialise a gradient's stops — generating them from `sweep` when it is a
 *  generated ("parametric rainbow") gradient that has not been frozen to stops. */
export function gradientStops(g: Gradient): GradStop[] {
  if (g.mode !== "sweep" || !g.sweep) return g.stops;
  const s = g.sweep;
  const n = Math.max(2, Math.min(256, Math.round(s.sweepStops ?? 33)));
  const cycles = Math.max(0.01, s.hueCycles ?? 1);
  const dir = s.hueDirection === "ccw" ? -1 : 1;
  // Travel from hueFrom to hueTo the requested way round, then repeat for extra cycles.
  let span = (s.hueTo - s.hueFrom) * dir;
  span = ((span % 360) + 360) % 360;
  if (span === 0) span = 360; // from == to means the whole wheel, not a flat colour
  const pair = (v: number | [number, number] | undefined, dflt: number): [number, number] =>
    v === undefined ? [dflt, dflt] : typeof v === "number" ? [v, v] : v;
  const [s0, s1] = pair(s.saturation, 1);
  const [l0, l1] = pair(s.lightness, 0.5);
  const out: GradStop[] = [];
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    out.push({
      pos: u,
      color: hslToHex(s.hueFrom + dir * span * cycles * u, s0 + (s1 - s0) * u, l0 + (l1 - l0) * u),
    });
  }
  return out;
}

/** Resolve a gradient document object into a mapping. */
export function resolveGradient(g: Gradient): ResolvedRamp {
  const stops = [...gradientStops(g)].sort((a, b) => a.pos - b.pos);
  return {
    stops: stops.length ? stops : [{ pos: 0, color: "#cccccc" }, { pos: 1, color: "#333333" }],
    space: g.space ?? "rgb",
    midpoint: g.midpoint,
    gamma: g.gamma,
    steps: g.steps,
    stepMode: g.stepMode,
    breaks: g.breaks,
    opacityCurve: g.opacityCurve,
    nanColor: g.nanColor,
    underColor: g.underColor,
    overColor: g.overColor,
  };
}

/**
 * Resolve any ramp reference. `lookup` supplies user-built gradients by id; a
 * `custom:<id>` that it cannot find returns `null` — the caller must fall back and say
 * so (a silent substitution is exactly the defect `strict.ts` and the scene `warnings`
 * exist to prevent). `RampResolver` does both for you.
 */
export function resolveRamp(
  ramp: GradRamp,
  lookup?: ((id: string) => Gradient | undefined) | undefined,
): ResolvedRamp | null {
  if (!isCustomRamp(ramp)) return resolveBuiltinRamp(ramp);
  const g = lookup?.(customRampId(ramp));
  return g ? resolveGradient(g) : null;
}

/**
 * Where the class edges fall, in t-space, when the classes are not equal intervals.
 *
 *  • "quantile" — equal counts per class, the choropleth convention: on skewed data, equal
 *    intervals put almost every value in one class and the map goes flat. Needs the values,
 *    which is why `RampShape` carries them.
 *  • "breaks"   — the user's own cut values, in data units, converted against the mapped range.
 *
 * Returns undefined when the ramp is not stepped, when the rule is the default equal-interval
 * one, or when the data cannot support the rule (too few values) — in which case the caller
 * keeps equal intervals rather than drawing something the rule did not ask for.
 */
function classEdges(r: ResolvedRamp, s: RampShape): number[] | undefined {
  const n = Math.floor(s.steps ?? r.steps ?? 0);
  if (n < 2) return undefined;
  const lo = s.lo ?? 0;
  const hi = s.hi ?? 1;
  const norm = (v: number): number => (hi > lo ? (v - lo) / (hi - lo) : 0);
  if (r.stepMode === "breaks") {
    const cuts = (r.breaks ?? []).map(norm).filter((v) => v > 0 && v < 1).sort((a, b) => a - b);
    return cuts.length === n - 1 ? cuts : undefined;
  }
  if (r.stepMode !== "quantile") return undefined;
  const vals = (s.values ?? []).filter((v) => Number.isFinite(v)).map(norm).sort((a, b) => a - b);
  if (vals.length < n) return undefined;
  const out: number[] = [];
  for (let k = 1; k < n; k++) {
    // Nearest-rank quantile — no interpolation, so an edge always sits on a real value.
    const idx = Math.min(vals.length - 1, Math.max(0, Math.round((k / n) * vals.length) - 1));
    const e = Math.max(0, Math.min(1, vals[idx]!));
    if (e > 0 && e < 1 && (out.length === 0 || e > out[out.length - 1]!)) out.push(e);
  }
  return out.length === n - 1 ? out : undefined;
}

/**
 * Stops for the SVG gradient that draws a ramp.
 *
 * A stepped ramp gets a staircase, not a smooth sweep sampled at the class colours. An SVG
 * `linearGradient` interpolates between whatever stops it is given, so sampling a 5-class
 * ramp at six points would produce a *banded but blended* bar — the key saying "continuous"
 * while the cells say "five classes". Two stops per class (its start and its end, same colour) makes the
 * edges edges. The duplicate offsets are deliberate.
 */
export function rampBarStops(
  r: ResolvedRamp,
  base: string,
  to: string,
  reversed: boolean,
  samples = 12,
): { offset: number; color: string }[] {
  const paint = makeRamp(r, base, to, reversed);
  const n = Math.floor(r.steps ?? 0);
  if (n >= 2) {
    const edges = r.stepEdges && r.stepEdges.length === n - 1 ? r.stepEdges : null;
    const bound = (k: number): number => (k === 0 ? 0 : k === n ? 1 : edges ? edges[k - 1]! : k / n);
    const out: { offset: number; color: string }[] = [];
    for (let k = 0; k < n; k++) {
      const a = bound(k);
      const b = bound(k + 1);
      const color = paint((a + b) / 2).color;
      out.push({ offset: a, color }, { offset: b, color });
    }
    return out;
  }
  return Array.from({ length: samples + 1 }, (_v, i) => ({ offset: i / samples, color: paint(i / samples).color }));
}

/**
 * Per-scene ramp resolution: resolves any reference, falls back to viridis for a
 * gradient that no longer exists, and remembers the missing ids so the builder can put
 * them in the scene's `warnings`. One of these is made per scene build; every drawing
 * site takes its paint function from it.
 */
/**
 * The per-plot shaping knobs, as the drawing sites hold them (`heatmap.colorMidpoint`,
 * `seriesStyles.*.gradGamma`, …), plus the data range the site is mapping.
 *
 * Note: `midpointValue` is a data value, not a fraction: the user types "0", not "0.42". It is
 * converted here, against `lo`/`hi`, into the fraction the resolver works in — which is why the
 * range has to travel with it. A midpoint outside the range cannot centre anything, so it is
 * refused with a warning rather than silently dropped.
 */
export interface RampShape {
  midpointValue?: number | undefined;
  gamma?: number | undefined;
  steps?: number | undefined;
  space?: GradSpace | undefined;
  /** The data range being mapped (needed only to place `midpointValue`). */
  lo?: number | undefined;
  hi?: number | undefined;
  /** The values being mapped. Needed only for quantile classes — the rule is "equal counts
   *  per class", which cannot be known from the range alone. The site already has them. */
  values?: readonly number[] | undefined;
}

/** The line a builder shows when a pinned colour midpoint falls outside the data. */
export const midpointOutOfRangeWarning = (v: number, lo: number, hi: number): string =>
  `The colour midpoint (${v}) is outside the data (${lo} to ${hi}), so the ramp was left centred.`;

export interface RampResolver {
  /** The mapping for a reference, already bound to the caller's colours and shaping. */
  ramp(ref: GradRamp, base: string, to: string, reversed: boolean, shape?: RampShape | undefined): (t: number) => RampPaint;
  /** The resolved description (for sites that need `nanColor` / stop lists). */
  resolve(ref: GradRamp): ResolvedRamp;
  /** Gradient stops for a reference, for the sites that emit an SVG gradient rather than
   *  sampling per mark. `fallback` supplies the stops for a *derived* ramp, which has no
   *  colours of its own. */
  stops(ref: GradRamp, fallback: GradRamp, shape?: RampShape | undefined): { offset: number; color: string }[];
  /** Stops for a colour bar: a hard staircase when the ramp is stepped, so the key says the
   *  same thing the marks do. */
  barStops(ref: GradRamp, base: string, to: string, reversed: boolean, shape?: RampShape | undefined): { offset: number; color: string }[];
  /** One line per referenced gradient that could not be found (empty when all resolved). */
  warnings(): string[];
}

/** The line a builder shows when a plot references a gradient the project no longer has. */
export const missingGradientWarning = (id: string): string =>
  `The gradient "${id}" this graph uses is not in the project — viridis is drawn instead.`;

/**
 * @param lookup  user-built gradients by id (the project's + library's registry)
 * @param sink    the builder's `warnings` array. A missing gradient is reported into it at
 *                resolve time, so a builder with several return points cannot forget to
 *                attach it. Deduped, so two resolvers over one scene say it once.
 */
export function makeRampResolver(
  lookup?: ((id: string) => Gradient | undefined) | undefined,
  sink?: string[] | undefined,
): RampResolver {
  const missing: string[] = [];
  const resolve = (ref: GradRamp): ResolvedRamp => {
    const r = resolveRamp(ref, lookup);
    if (r) return r;
    const id = customRampId(ref);
    if (!missing.includes(id)) missing.push(id);
    const line = missingGradientWarning(id);
    if (sink && !sink.includes(line)) sink.push(line);
    return resolveBuiltinRamp("viridis");
  };
  /**
   * Lay the plot's shaping over the gradient's own, field by field — the `titleFont` merge
   * idiom. A knob the user has not set is `undefined` and inherits; a built-in ramp brings no
   * shaping, so for one of those the plot's knobs are the whole story.
   */
  const shaped = (r: ResolvedRamp, s: RampShape | undefined): ResolvedRamp => {
    if (!s) return r;
    const out: ResolvedRamp = { ...r };
    const edges = classEdges(r, s);
    if (edges) out.stepEdges = edges;
    if (s.gamma !== undefined) out.gamma = s.gamma;
    if (s.steps !== undefined) out.steps = s.steps;
    if (s.space !== undefined) out.space = s.space;
    if (s.midpointValue !== undefined) {
      const lo = s.lo ?? 0;
      const hi = s.hi ?? 1;
      const f = hi > lo ? (s.midpointValue - lo) / (hi - lo) : NaN;
      // Outside the data there is no middle to pin. It is refused visibly: the ramp stays centred
      // and the builder says why, rather than the user wondering which knob did nothing.
      if (f > 0 && f < 1) out.midpoint = f;
      else {
        const line = midpointOutOfRangeWarning(s.midpointValue, lo, hi);
        if (sink && !sink.includes(line)) sink.push(line);
      }
    }
    return out;
  };
  return {
    resolve,
    ramp: (ref, base, to, reversed, shape) => makeRamp(shaped(resolve(ref), shape), base, to, reversed),
    barStops: (ref, base, to, reversed, shape) => rampBarStops(shaped(resolve(ref), shape), base, to, reversed, 5),
    stops: (ref, fallback, shape) => {
      const r = shaped(resolve(ref), shape);
      const isShaped =
        r.midpoint !== undefined || (r.gamma !== undefined && r.gamma !== 1) || (r.steps ?? 0) >= 2
        // An SVG gradient blends in sRGB whatever we say, so a non-RGB space only reaches the
        // drawing as densely sampled stops.
        || r.space !== "rgb";
      if (!isShaped) {
        // Unshaped: emit the ramp's own stops, so a built-in colormap produces exactly the
        // gradient pinned in the baseline.
        if (r.evenColors) {
          const n = r.evenColors.length;
          return r.evenColors.map((color, k) => ({ offset: n > 1 ? k / (n - 1) : 0, color }));
        }
        if (r.stops) return r.stops.map((s) => ({ offset: s.pos, color: s.color }));
      }
      if (!r.stops && !r.evenColors) {
        // A derived ramp has no colours of its own — keep the caller's stated fallback.
        return makeRampResolver(lookup, sink).stops(fallback, fallback, shape);
      }
      // Shaped: a staircase when stepped, else dense enough that a non-RGB blend is honoured
      // (an SVG gradient interpolates in sRGB whatever we say).
      return rampBarStops(r, "#ffffff", "#000000", false, 64);
    },
    warnings: () => missing.map(missingGradientWarning),
  };
}

// ---------------------------------------------------------------------------
// The mapping itself.
// ---------------------------------------------------------------------------

/** Position along the ramp after the shaping knobs. With no knobs set this returns `u`
 *  unchanged — which is why the built-ins are unmoved. */
function shapeT(u: number, r: ResolvedRamp): number {
  let v = u;
  const m = r.midpoint;
  if (m !== undefined && m > 0 && m < 1) v = v <= m ? 0.5 * (v / m) : 0.5 + 0.5 * ((v - m) / (1 - m));
  const g = r.gamma;
  if (g !== undefined && g > 0 && g !== 1) v = v ** g;
  const n = Math.floor(r.steps ?? 0);
  // Discrete classes: every value in a class takes the colour at the class centre, so n
  // classes yield exactly n colours (and the two ends are not over-weighted). With explicit
  // edges (quantile / the user's breaks) the classes are unequal, so the centre is the middle
  // of its own class rather than of an equal slice.
  if (n >= 2) {
    const edges = r.stepEdges;
    if (edges && edges.length === n - 1) {
      let k = 0;
      while (k < edges.length && v > edges[k]!) k++;
      const lo = k === 0 ? 0 : edges[k - 1]!;
      const hi = k === edges.length ? 1 : edges[k]!;
      v = (lo + hi) / 2;
    } else {
      v = (Math.min(n - 1, Math.floor(v * n)) + 0.5) / n;
    }
  }
  return v;
}

/** An evenly-spaced built-in colormap as positional stops (for the non-RGB blend paths). */
function evenStops(colors: readonly string[] | undefined): GradStop[] | undefined {
  if (!colors || colors.length === 0) return undefined;
  const n = colors.length;
  return colors.map((color, i) => ({ pos: n > 1 ? i / (n - 1) : 0, color }));
}

/** Sample a positional stop list at v∈[0,1] in the ramp's space. */
function sampleStops(stops: readonly GradStop[], v: number, space: GradSpace): RampPaint {
  const first = stops[0]!;
  const last = stops[stops.length - 1]!;
  if (v <= first.pos) return { color: first.color, opacity: first.opacity ?? 1 };
  if (v >= last.pos) return { color: last.color, opacity: last.opacity ?? 1 };
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i]!;
    const b = stops[i + 1]!;
    if (v > b.pos) continue;
    const span = b.pos - a.pos;
    const local = span > 0 ? (v - a.pos) / span : 0;
    return {
      color: mixIn(space, a.color, b.color, local),
      opacity: (a.opacity ?? 1) + ((b.opacity ?? 1) - (a.opacity ?? 1)) * local,
    };
  }
  return { color: last.color, opacity: last.opacity ?? 1 };
}

/**
 * The mapping every drawing site uses: a resolved ramp + the caller's colours →
 * `(t) => { color, opacity }`. `reversed` flips the ramp before the shaping knobs, so
 * one saved gradient serves both directions.
 */
export function makeRamp(
  r: ResolvedRamp,
  base: string,
  to: string,
  reversed: boolean,
): (t: number) => RampPaint {
  return (t: number): RampPaint => {
    // out of range, when the user pinned the scale: a value below/above the pinned bounds gets
    // its own colour instead of the end colour, so a clipped scale reads as clipped rather than
    // as a flat band of "the maximum". Checked before the clamp, and before `reversed` — under
    // means below the data bound, not below the ramp's start.
    if (Number.isFinite(t)) {
      if (t < 0 && r.underColor) return { color: r.underColor, opacity: 1 };
      if (t > 1 && r.overColor) return { color: r.overColor, opacity: 1 };
    }
    const u0 = reversed ? 1 - Math.max(0, Math.min(1, t)) : Math.max(0, Math.min(1, t));
    const u = shapeT(u0, r);
    let paint: RampPaint;
    switch (r.derived) {
      case "lightness":
        // low → a light tint of the base, high → a dark shade.
        paint = { color: u < 0.5 ? mix("#ffffff", base, 0.3 + u) : mix(base, "#1a1a1a", (u - 0.5) * 0.7), opacity: 1 };
        break;
      case "transparency":
        // low → faint, high → opaque (the "inverse transparency" ramp).
        paint = { color: base, opacity: 0.15 + 0.85 * u };
        break;
      case "lightness-transparency":
        paint = { color: u < 0.5 ? mix("#ffffff", base, 0.3 + u) : mix(base, "#1a1a1a", (u - 0.5) * 0.7), opacity: 0.25 + 0.75 * u };
        break;
      case "twocolor":
        // In the requested space: `mix` is RGB only, so using it would leave the Blend control
        // without effect on the two-colour ramp. `rgb` still delegates to `mix`.
        paint = { color: mixIn(r.space, base, to, u), opacity: 1 };
        break;
      default:
        // `evenColors` is the bit-exact fast path for the built-in colormaps — and it can
        // only blend in RGB. Taking it when the user asks for HSL/Lab would leave the Blend
        // control without effect for all 17 built-ins (guarded by gradient-shaping.test.ts, at the
        // six sites that expose it).
        paint = r.evenColors && r.space === "rgb"
          ? { color: sample(r.evenColors, u), opacity: 1 }
          : sampleStops(r.stops ?? evenStops(r.evenColors) ?? [{ pos: 0, color: base }, { pos: 1, color: to }], u, r.space);
    }
    const oc = r.opacityCurve;
    if (!oc) return paint;
    return { color: paint.color, opacity: paint.opacity * (oc[0] + (oc[1] - oc[0]) * u) };
  };
}

// ---------------------------------------------------------------------------
// Colour-vision simulation + the advice the gradient editor shows.
//
// Not decoration: "rainbow" is the ramp people reach for and the one that misleads, because it
// is not monotonic in lightness — it brightens to yellow in the middle and darkens again, so
// two very different values can print as the same grey and read as the same colour to a
// deuteranope. The editor says so, and never refuses: a rainbow is a legitimate choice, and
// people ask for it by name.
// ---------------------------------------------------------------------------

/** The forms of colour vision the preview simulates. */
export type ColorVision = "deuteranopia" | "protanopia" | "tritanopia" | "grayscale";

// Brettel/Viénot-style linear approximations in linear-light sRGB. Adequate for "can these two
// swatches be told apart", which is all this is used for.
const VISION_MATRIX: Record<Exclude<ColorVision, "grayscale">, number[]> = {
  deuteranopia: [0.625, 0.375, 0, 0.7, 0.3, 0, 0, 0.3, 0.7],
  protanopia: [0.567, 0.433, 0, 0.558, 0.442, 0, 0, 0.242, 0.758],
  tritanopia: [0.95, 0.05, 0, 0, 0.433, 0.567, 0, 0.475, 0.525],
};

/** How a colour appears to a viewer with the given colour vision. */
export function simulateVision(hex: string, kind: ColorVision): string {
  const [r, g, b] = hexToRgb(hex).map((v) => srgbToLinear(v / 255)) as RGB;
  if (kind === "grayscale") {
    const y = linearToSrgb(0.2126 * r + 0.7152 * g + 0.0722 * b) * 255;
    return rgbToHex([y, y, y]);
  }
  const m = VISION_MATRIX[kind];
  return rgbToHex([
    linearToSrgb(m[0]! * r + m[1]! * g + m[2]! * b) * 255,
    linearToSrgb(m[3]! * r + m[4]! * g + m[5]! * b) * 255,
    linearToSrgb(m[6]! * r + m[7]! * g + m[8]! * b) * 255,
  ]);
}

/**
 * The same simulation as an SVG `<feColorMatrix type="matrix">` values string (4×5, row-major),
 * so a whole drawing can be previewed at once through a CSS filter. Exact only when the filter
 * runs in linear light (`color-interpolation-filters="linearRGB"`), which is the space
 * `simulateVision` works in — color.visionMatrix.test.ts holds the two to 1/255.
 */
export function visionMatrixValues(kind: ColorVision): string {
  const m = kind === "grayscale" ? [0.2126, 0.7152, 0.0722, 0.2126, 0.7152, 0.0722, 0.2126, 0.7152, 0.0722] : VISION_MATRIX[kind];
  const row = (i: number): string => `${m[i]} ${m[i + 1]} ${m[i + 2]} 0 0`;
  return `${row(0)} ${row(3)} ${row(6)} 0 0 0 1 0`;
}

/** Perceptual distance between two colours (CIE76 ΔE in L*a*b*). Below ~10 they are hard to
 *  tell apart side by side; below ~3 most people cannot at all. */
export function colorDistance(a: string, b: string): number {
  const [l1, a1, b1] = rgbToLab(a);
  const [l2, a2, b2] = rgbToLab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

/** Human-readable advice about a resolved ramp. Empty = nothing to say. Never a refusal. */
export function gradientAdvice(r: ResolvedRamp, base = "#2266cc", to = "#1a1a1a"): string[] {
  const paint = makeRamp(r, base, to, false);
  const out: string[] = [];
  const n = (r.steps ?? 0) >= 2 ? Math.floor(r.steps!) : 24;
  const swatches = Array.from({ length: n }, (_v, i) => paint(n === 1 ? 0 : i / (n - 1)).color);

  // 1. Lightness must climb (or fall) all the way, or the ramp cannot be read in greyscale.
  const light = swatches.map((c) => rgbToLab(c)[0]);
  const ups = light.slice(1).filter((v, i) => v > light[i]! + 0.5).length;
  const downs = light.slice(1).filter((v, i) => v < light[i]! - 0.5).length;
  if (ups > 0 && downs > 0 && Math.min(ups, downs) > light.length * 0.12) {
    out.push(
      "This ramp gets lighter and then darker again, so two different values can print as the same grey. Fine on screen; risky in a printed figure.",
    );
  }

  // 2. Neighbouring classes a colour-blind reader cannot separate. Only meaningful for a
  //    stepped ramp — on a continuous one, neighbouring samples are always close.
  if ((r.steps ?? 0) >= 2) {
    for (const kind of ["deuteranopia", "protanopia", "grayscale"] as const) {
      const seen = swatches.map((c) => simulateVision(c, kind));
      const clash = seen.findIndex((c, i) => i > 0 && colorDistance(c, seen[i - 1]!) < 8);
      if (clash > 0) {
        out.push(
          `Classes ${clash} and ${clash + 1} look almost the same ${
            kind === "grayscale" ? "in greyscale" : `to a reader with ${kind}`
          }. Fewer classes, or a different ramp, would separate them.`,
        );
        break; // one warning is a signal; three is noise
      }
    }
  }
  return out;
}
