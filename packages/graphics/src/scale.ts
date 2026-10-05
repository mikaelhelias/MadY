/**
 * Scale + tick geometry. D3 is used strictly as a math toolkit (no DOM, no
 * `d3-axis` — we own every emitted element). Linear scales use d3's "nice"
 * domain + tick algorithm; log10 scales snap to whole decades with 2–9×10^k
 * minor ticks, the publication-standard look.
 */

import { scaleLinear, scaleLog } from "d3-scale";
import { normInv, daysToISO, formatElapsed } from "@mady/core";
import type { NumberFormat, ThousandsSeparator, DecimalSeparator, ColumnType } from "@mady/core";
import type { ScaleType, AxisTick } from "./scene.js";

/** Map a data value to a pixel position. */
export type ScaleFn = (value: number) => number;

export interface BuiltScale {
  scale: ScaleFn;
  domain: [number, number];
  ticks: AxisTick[];
  /** Pixel positions of axis-break marks (compressed gaps); empty/absent = none. */
  breakMarks?: number[];
  /** Visible data ranges between the cuts, in raw data units (present only when the axis has
   *  breaks). A caller drawing a filled shape splits it at these so it doesn't bridge the gaps. */
  segments?: Array<{ from: number; to: number }>;
}

/** Tick-label format options (the AxisSpec subset the scale needs to render labels). */
export interface TickFormat {
  format?: NumberFormat | undefined;
  decimals?: number | undefined;
  prefix?: string | undefined;
  suffix?: string | undefined;
  /** Digit-grouping separator; default "none". */
  thousands?: ThousandsSeparator | undefined;
  /** Decimal mark; default "point". */
  decimalSep?: DecimalSeparator | undefined;
  /** Source column type — `date`/`elapsed` format ticks as ISO dates / h:mm:ss
   *  (from the numeric storage) instead of raw numbers. Omitted = numeric. */
  columnType?: ColumnType | undefined;
}

/** Manual tick spacing (linear axes): major interval + minor ticks per interval. */
export interface TickSpacing {
  majorStep?: number | undefined;
  minorCount?: number | undefined;
  /** Axis breaks: data ranges [from, to] to compress out. Works on linear and log
   *  axes (on log axes the gap is taken in decade space; only positive edges count). */
  breaks?: Array<{ from: number; to: number }> | undefined;
}

/**
 * Build a piecewise-linear map over [n0, n1] that compresses the given break
 * ranges to a small fixed pixel gap each (the broken-axis effect). Returns the
 * mapping fn + the pixel midpoints of each gap (for drawing break marks).
 * Honours range direction (ascending X or descending Y).
 */
function piecewise(
  n0: number,
  n1: number,
  range: [number, number],
  rawBreaks: Array<{ from: number; to: number }>,
): { scale: ScaleFn; breakMarks: number[]; segments: Array<{ from: number; to: number }> } {
  // Clean: clamp into (n0,n1), drop empties, sort, merge overlaps.
  const span = n1 - n0;
  const cleaned = rawBreaks
    .map((b) => ({ from: Math.max(n0, Math.min(b.from, b.to)), to: Math.min(n1, Math.max(b.from, b.to)) }))
    .filter((b) => b.to > b.from && b.from > n0 && b.to < n1)
    .sort((a, b) => a.from - b.from);
  const merged: Array<{ from: number; to: number }> = [];
  for (const b of cleaned) {
    const last = merged[merged.length - 1];
    if (last && b.from <= last.to) last.to = Math.max(last.to, b.to);
    else merged.push({ ...b });
  }
  const px0 = range[0];
  const px1 = range[1];
  const dir = px1 >= px0 ? 1 : -1;
  const totalPx = Math.abs(px1 - px0);
  // Visible (non-broken) data span; each break eats a fixed pixel gap.
  const brokenSpan = merged.reduce((s, b) => s + (b.to - b.from), 0);
  const visibleSpan = Math.max(1e-9, span - brokenSpan);
  const gap = Math.min(18, totalPx * 0.05);
  const usablePx = Math.max(1, totalPx - gap * merged.length);
  const pxPerData = usablePx / visibleSpan;
  // Segment boundaries: [n0, b0.from], [b0.to, b1.from], … [bk.to, n1].
  const segs: Array<{ d0: number; d1: number; p0: number; p1: number }> = [];
  let cursorD = n0;
  let cursorP = px0;
  const breakMarks: number[] = [];
  for (const b of merged) {
    const segData = b.from - cursorD;
    const segPx = segData * pxPerData;
    segs.push({ d0: cursorD, d1: b.from, p0: cursorP, p1: cursorP + dir * segPx });
    const gapStart = cursorP + dir * segPx;
    breakMarks.push(gapStart + dir * (gap / 2));
    cursorP = gapStart + dir * gap;
    cursorD = b.to;
  }
  const lastPx = px0 + dir * usablePx + dir * gap * merged.length; // == px1
  segs.push({ d0: cursorD, d1: n1, p0: cursorP, p1: lastPx });
  const scale: ScaleFn = (v) => {
    if (v <= n0) return px0;
    if (v >= n1) return px1;
    for (const b of merged) if (v > b.from && v < b.to) v = b.from; // collapse into a break → its near edge
    for (const s of segs) {
      if (v >= s.d0 && v <= s.d1) {
        const t = s.d1 > s.d0 ? (v - s.d0) / (s.d1 - s.d0) : 0;
        return s.p0 + (s.p1 - s.p0) * t;
      }
    }
    return px1;
  };
  // The visible data ranges between the cuts (the `segs` boundaries), so a caller that draws a
  // filled shape can split it at the gaps instead of re-deriving the break intervals itself.
  const segments = segs.map((s) => ({ from: s.d0, to: s.d1 }));
  return { scale, breakMarks, segments };
}

const TARGET_TICKS = 6;

const SUP: Record<string, string> = {
  "-": "⁻", "0": "⁰", "1": "¹", "2": "²", "3": "³",
  "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
};

/** Render an integer exponent as Unicode superscript (e.g. -3 → "⁻³"). */
function superscript(n: number): string {
  return String(n)
    .split("")
    .map((c) => SUP[c] ?? c)
    .join("");
}

/** Base of a log scale type (10 / 2 / e); null for linear. */
function logBase(type: ScaleType): number | null {
  if (type === "log10") return 10;
  if (type === "log2") return 2;
  if (type === "ln") return Math.E;
  return null;
}

const baseLabel = (base: number): string => (Math.abs(base - Math.E) < 1e-9 ? "e" : String(base));

/**
 * Suggest a scale type for a set of values: log10 when every value is strictly
 * positive and the data spans at least two orders of magnitude (the classic
 * dose/concentration axis); linear otherwise.
 */
export function suggestScale(values: readonly number[]): ScaleType {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length < 2) return "linear";
  let min = Infinity;
  let max = -Infinity;
  for (const v of finite) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (min <= 0) return "linear";
  return max / min >= 100 ? "log10" : "linear";
}

/** Trim a number to clean text: 12 sig-figs to kill binary-float dust, no zeros. */
function trimNumber(v: number): string {
  if (v === 0) return "0";
  return Number(v.toPrecision(12)).toString();
}

/** Format a log decade value: 0.001, 0.01, 0.1, 1, 10, 100, … (no exponent in range). */
function formatDecade(v: number): string {
  if (v >= 1) return trimNumber(v);
  if (v <= 0) return "0";
  // Sub-unit decades: render as a plain decimal with the right number of places.
  // Clamp to toFixed's legal 0…100 range (a degenerate near-0 decade must not crash).
  const places = Math.min(100, Math.max(0, Math.round(-Math.log10(v))));
  return v.toFixed(places);
}

/** Scientific notation: 1.5×10³ (mantissa × base-10 power, Unicode superscript). */
function formatScientific(v: number, decimals: number | undefined): string {
  if (v === 0) return "0";
  const exp = Math.floor(Math.log10(Math.abs(v)));
  const mant = v / Math.pow(10, exp);
  const mantStr = decimals === undefined ? trimNumber(mant) : mant.toFixed(decimals);
  return `${mantStr}×10${superscript(exp)}`;
}

/** Power notation for log axes: 10², 2³, e² (base⁰ → "1"). Falls back to scientific off the grid. */
function formatPower(v: number, base: number, decimals: number | undefined): string {
  if (v <= 0) return formatScientific(v, decimals);
  const exp = Math.log(v) / Math.log(base);
  const rounded = Math.round(exp);
  if (Math.abs(exp - rounded) < 1e-9) {
    return rounded === 0 ? "1" : `${baseLabel(base)}${superscript(rounded)}`;
  }
  return formatScientific(v, decimals);
}

/** E notation: 1.5E3, 2E-3 (mantissa E base-10 power, plain ASCII). */
function formatENotation(v: number, decimals: number | undefined): string {
  if (v === 0) return "0";
  const exp = Math.floor(Math.log10(Math.abs(v)));
  const mant = v / Math.pow(10, exp);
  const mantStr = decimals === undefined ? trimNumber(mant) : mant.toFixed(decimals);
  return `${mantStr}E${exp}`;
}

/** Antilog: the plain value with no exponent anywhere (1e-7 → "0.0000001"), 12 significant
 *  digits like `trimNumber`. `toString` switches to exponent text below 1e-6, so small values
 *  are written with `toFixed` and their trailing zeros trimmed. */
function formatAntilog(v: number, decimals: number | undefined): string {
  if (decimals !== undefined) return v.toFixed(decimals);
  if (v === 0) return "0";
  const p = Number(v.toPrecision(12));
  if (Math.abs(p) >= 1e-6) return p.toString();
  const places = Math.min(100, 11 - Math.floor(Math.log10(Math.abs(p))));
  return p.toFixed(places).replace(/\.?0+$/, "");
}

const SI_STEPS: Array<[number, string]> = [[1e12, "T"], [1e9, "G"], [1e6, "M"], [1e3, "k"]];

/** Shortened with k / M / G / T (1500 → 1.5k). Below 1000 the value is written plainly. */
function formatSI(v: number, decimals: number | undefined): string {
  const step = SI_STEPS.find(([f]) => Math.abs(v) >= f);
  if (!step) return decimals === undefined ? trimNumber(v) : v.toFixed(decimals);
  const m = v / step[0];
  return `${decimals === undefined ? trimNumber(m) : m.toFixed(decimals)}${step[1]}`;
}

/** Auto label for a log tick: decade decimals (base 10/2), power-of-e for ln. */
function formatLogAuto(v: number, base: number): string {
  if (base === 10) return formatDecade(v);
  if (Math.abs(base - Math.E) < 1e-9) return formatPower(v, base, undefined);
  return trimNumber(v); // base 2 → clean powers (…0.5, 1, 2, 4, 8)
}

const THOUSANDS_CHAR: Record<ThousandsSeparator, string> = {
  none: "",
  comma: ",",
  period: ".",
  space: " ", // a plain space digit-group separator (1 000 000)
  apostrophe: "’",
};
const DECIMAL_CHAR: Record<DecimalSeparator, string> = { point: ".", comma: "," };

/**
 * Apply a digit-grouping (thousands) separator and/or a decimal mark to the leading
 * numeric run of a formatted label body. Operates only on the ASCII number at the
 * start, so a trailing "%", "×10³", superscript exponent, etc. are left untouched.
 * A strict no-op under the defaults (no grouping, "." decimal), so a label with no
 * separator chosen is returned exactly as formatted.
 */
function applySeparators(
  body: string,
  thousands: ThousandsSeparator | undefined,
  decimalSep: DecimalSeparator | undefined,
): string {
  const tSep = THOUSANDS_CHAR[thousands ?? "none"] ?? "";
  const dSep = DECIMAL_CHAR[decimalSep ?? "point"] ?? ".";
  if (!tSep && dSep === ".") return body;
  return body.replace(/^(-?)(\d+)(?:\.(\d+))?/, (_m, sign: string, int: string, frac?: string) => {
    const grouped = tSep ? int.replace(/\B(?=(\d{3})+(?!\d))/g, tSep) : int;
    return frac !== undefined ? `${sign}${grouped}${dSep}${frac}` : `${sign}${grouped}`;
  });
}

/** Build a tick label per the requested NumberFormat, with grouping/decimal-mark + prefix/suffix. */
export function makeTickLabel(value: number, type: ScaleType, fmt: TickFormat | undefined): string {
  // Date / elapsed-time columns format the numeric storage (days / seconds) as an
  // ISO date / h:mm:ss — taking precedence over any numeric NumberFormat.
  if (fmt?.columnType === "date") return daysToISO(Math.round(value));
  if (fmt?.columnType === "elapsed") return formatElapsed(value);
  const f = fmt?.format ?? "auto";
  const dec = fmt?.decimals;
  const base = logBase(type);
  let body: string;
  if (f === "scientific") body = formatScientific(value, dec);
  else if (f === "power10") body = formatPower(value, base ?? 10, dec);
  else if (f === "decimal") body = dec === undefined ? trimNumber(value) : value.toFixed(dec);
  // Percentage: the axis value is the fraction/number; ×100 with a "%" (0.25 → "25%").
  else if (f === "percent") body = `${dec === undefined ? trimNumber(value * 100) : (value * 100).toFixed(dec)}%`;
  else if (f === "enotation") body = formatENotation(value, dec);
  else if (f === "antilog") body = formatAntilog(value, dec);
  else if (f === "si") body = formatSI(value, dec);
  else body = base !== null ? formatLogAuto(value, base) : trimNumber(value); // auto
  body = applySeparators(body, fmt?.thousands, fmt?.decimalSep);
  return `${fmt?.prefix ?? ""}${body}${fmt?.suffix ?? ""}`;
}

function buildLinear(
  data: [number, number],
  range: [number, number],
  tickCount: number,
  exact: boolean,
  fmt: TickFormat | undefined,
  spacing: TickSpacing | undefined,
): BuiltScale {
  let [d0, d1] = data;
  if (!(d1 > d0)) {
    // Degenerate domain (single value / no spread): pad to a visible window.
    const pad = d0 === 0 ? 1 : Math.abs(d0) * 0.5;
    d0 -= pad;
    d1 += pad;
  }
  // `exact` (axis pan/zoom or manual range) keeps the requested window as-is;
  // otherwise `nice()` rounds the domain to clean bounds.
  const s = scaleLinear().domain([d0, d1]).range(range);
  if (!exact) s.nice(tickCount);
  const [n0, n1] = s.domain() as [number, number];
  // Manual major interval (every `majorStep`) overrides d3's auto tick count.
  const step = spacing?.majorStep;
  const majors =
    step && step > 0 && (n1 - n0) / step <= 1000
      ? majorsByStep(n0, n1, step)
      : s.ticks(tickCount);
  // Capped like `majorStep` above (which refuses > 1000 majors). Uncapped, a large
  // minorCount — reachable because an HTML `max` is advisory and React still receives whatever
  // is typed — would emit minors until the heap runs out and the renderer process dies. The
  // Inspector's own limit is 20; 50 leaves headroom without ever approaching a hang.
  const rawMinor = spacing?.minorCount;
  const minorN = typeof rawMinor === "number" && Number.isFinite(rawMinor) && rawMinor > 0
    ? Math.min(50, Math.floor(rawMinor))
    : 0;
  // Axis breaks (cuts): swap in a piecewise scale that compresses the broken
  // ranges, and drop any tick that lands inside a break.
  const pw = spacing?.breaks && spacing.breaks.length ? piecewise(n0, n1, range, spacing.breaks) : null;
  const posFn: ScaleFn = pw ? pw.scale : (v) => s(v);
  const inBreak = (v: number): boolean =>
    !!spacing?.breaks?.some((b) => v > Math.min(b.from, b.to) && v < Math.max(b.from, b.to));
  const ticks: AxisTick[] = [];
  for (let i = 0; i < majors.length; i++) {
    const value = majors[i]!;
    if (!inBreak(value)) ticks.push({ value, pos: posFn(value), label: makeTickLabel(value, "linear", fmt), minor: false });
    // Minor ticks evenly between this major and the next.
    const next = majors[i + 1];
    if (minorN > 0 && next !== undefined) {
      const d = (next - value) / (minorN + 1);
      for (let k = 1; k <= minorN; k++) {
        const mv = value + d * k;
        if (!inBreak(mv)) ticks.push({ value: mv, pos: posFn(mv), label: "", minor: true });
      }
    }
  }
  return { scale: posFn, domain: [n0, n1], ticks, ...(pw ? { breakMarks: pw.breakMarks, segments: pw.segments } : {}) };
}

/** Major-tick values at every `step` across [lo,hi] (aligned to multiples of step). */
function majorsByStep(lo: number, hi: number, step: number): number[] {
  const out: number[] = [];
  const start = Math.ceil(lo / step) * step;
  for (let v = start; v <= hi + step * 1e-9; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

function buildLogBase(
  type: ScaleType,
  base: number,
  data: [number, number],
  range: [number, number],
  exact: boolean,
  fmt: TickFormat | undefined,
  spacing: TickSpacing | undefined,
): BuiltScale {
  // A log axis is undefined at and below zero. A manual minimum of 0 would make `lb(0)` return
  // -Infinity, so `kLo` below would be -Infinity and the decade loop would never advance
  // (-Infinity + 1 === -Infinity): it would append ticks until the heap runs out, taking the
  // whole renderer process with it. That is unrecoverable — a heap OOM cannot be caught by an
  // ErrorBoundary — so the domain is clamped to a positive, finite window here as the last
  // line of defence. The Inspector also rejects the value at the source (`numProps`).
  const [rawMin, rawMax] = data;
  const hiPos = Number.isFinite(rawMax) && rawMax > 0 ? rawMax : 1;
  let loPos = Number.isFinite(rawMin) && rawMin > 0 ? rawMin : hiPos / 1000;
  if (loPos >= hiPos) loPos = hiPos / 10; // guarantee a positive, non-degenerate span
  const min = loPos;
  const max = hiPos;
  const lb = (x: number): number => Math.log(x) / Math.log(base);
  // Auto axis snaps outward to whole powers for a clean look; a zoom window /
  // manual range (`exact`) keeps the requested bounds.
  const lo = exact ? min : Math.pow(base, Math.floor(lb(min)));
  const hi = exact ? max : Math.pow(base, Math.ceil(lb(max)));
  const s = scaleLog().base(base).domain([lo, hi]).range(range);

  // Axis breaks on a log axis: run the same piecewise compressor, but in log
  // space — transform the domain + each break's [from,to] through `lb` so the
  // gaps land in decade space, then map data values via lb before the piecewise
  // scale. Only positive break edges are valid on a log axis.
  const logBreaks = (spacing?.breaks ?? [])
    .filter((b) => b.from > 0 && b.to > 0)
    .map((b) => ({ from: lb(b.from), to: lb(b.to) }));
  const pw = logBreaks.length ? piecewise(lb(lo), lb(hi), range, logBreaks) : null;
  const posFn: ScaleFn = pw ? (v) => pw.scale(lb(v)) : (v) => s(v);
  const inBreak = (v: number): boolean =>
    !!spacing?.breaks?.some((b) => v > Math.min(b.from, b.to) && v < Math.max(b.from, b.to));

  const kLo = Math.floor(lb(lo));
  // Defence in depth: even with a sane domain, never let the decade loop run unbounded.
  // Doubles span ~630 decades, so this cap can only ever trim genuinely absurd input.
  const MAX_DECADES = 1000;
  const kHi = Math.min(Math.ceil(lb(hi)), kLo + MAX_DECADES);
  const ticks: AxisTick[] = [];
  for (let k = kLo; k <= kHi; k++) {
    const power = Math.pow(base, k);
    if (power >= lo && power <= hi && !inBreak(power)) {
      ticks.push({ value: power, pos: posFn(power), label: makeTickLabel(power, type, fmt), minor: false });
    }
    // Sub-power minor ticks only make a clean grid on base 10 (the 2–9 lines).
    if (base === 10) {
      for (let m = 2; m <= 9; m++) {
        const v = m * power;
        if (v >= lo && v <= hi && !inBreak(v)) ticks.push({ value: v, pos: posFn(v), label: "", minor: true });
      }
    }
  }
  // piecewise ran in log space, so invert its segment boundaries back to raw data units.
  return {
    scale: posFn,
    domain: [lo, hi],
    ticks,
    ...(pw ? { breakMarks: pw.breakMarks, segments: pw.segments.map((sg) => ({ from: Math.pow(base, sg.from), to: Math.pow(base, sg.to) })) } : {}),
  };
}

/**
 * Build a scale of the requested type over `data` extent, mapping to `range`
 * pixels. `exact` (default false) keeps the domain exactly as given — used for
 * axis pan/zoom and manual range, where `nice()`/power-snapping would undo it.
 * `fmt` controls tick-label formatting (number format, decimals, prefix/suffix).
 */
/** Conventional probability tick positions for a probit ("probability paper") axis. */
const PROBIT_TICKS = [
  0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.98, 0.99, 0.995, 0.998, 0.999,
];

/**
 * Probit ("normal-probability paper") scale: the domain is a probability in (0,1),
 * positioned by its inverse-normal quantile z = Φ⁻¹(p) mapped linearly to pixels, so a
 * normal cumulative distribution plots as a straight line. Ticks sit at the conventional
 * probability values; the scale self-clamps values to (ε, 1−ε) so 0 / 1 / out-of-range
 * points land on the edge rather than at ±∞.
 */
function buildProbit(
  data: [number, number],
  range: [number, number],
  exact: boolean,
  fmt: TickFormat | undefined,
): BuiltScale {
  const EPS = 1e-4;
  const clamp = (p: number): number => Math.max(EPS, Math.min(1 - EPS, p));
  let d0 = clamp(data[0]);
  let d1 = clamp(data[1]);
  if (!(d1 > d0)) {
    d0 = 0.01;
    d1 = 0.99;
  }
  // Auto (non-exact) widens to the conventional ticks that bracket the data extent, so
  // the axis reads on clean probability gridlines. A manual range (exact) keeps as-is.
  if (!exact) {
    const below = PROBIT_TICKS.filter((t) => t <= d0);
    const above = PROBIT_TICKS.filter((t) => t >= d1);
    if (below.length) d0 = below[below.length - 1]!;
    if (above.length) d1 = above[0]!;
  }
  const z0 = normInv(d0) ?? -3.7;
  const z1 = normInv(d1) ?? 3.7;
  const zSpan = z1 - z0 || 1;
  const scale: ScaleFn = (p) => {
    const z = normInv(clamp(p)) ?? 0;
    return range[0] + (range[1] - range[0]) * ((z - z0) / zSpan);
  };
  const ticks: AxisTick[] = PROBIT_TICKS.filter((p) => p >= d0 - 1e-9 && p <= d1 + 1e-9).map((p) => ({
    value: p,
    pos: scale(p),
    label: makeTickLabel(p, "probit", fmt),
    minor: false,
  }));
  return { scale, domain: [d0, d1], ticks };
}

export function buildScale(
  type: ScaleType,
  data: [number, number],
  range: [number, number],
  tickCount: number = TARGET_TICKS,
  exact = false,
  fmt?: TickFormat,
  spacing?: TickSpacing,
): BuiltScale {
  if (type === "probit") return buildProbit(data, range, exact, fmt);
  const base = logBase(type);
  return base !== null
    ? buildLogBase(type, base, data, range, exact, fmt, spacing)
    : buildLinear(data, range, tickCount, exact, fmt, spacing);
}

/**
 * Equal aspect — one data unit is the same number of pixels on X and Y.
 *
 * On an ordination map (and any scatter where the two axes carry the same kind of number) the
 * distance between two points is the reading. Stretch the figure and that distance is misleading: two
 * sites 1 unit apart along PC1 draw further apart than two sites 1 unit apart along PC2.
 *
 * `fixed` = the user has said what this axis shows — a hand-typed min/max, or the pan/zoom
 * window they are looking through. A fixed axis is never re-ranged behind their back, and it is
 * what decides how the two are matched:
 *
 *   • Neither fixed (the resting view) — the axis packed into too few units per pixel grows
 *     about its own centre until the scales match. Growing only ever shows more of the plane,
 *     so no data point can be pushed out of sight. Shrinking here would crop data nobody asked
 *     to hide, and re-sizing the plot box would fight the figure layout, the panel grid and the
 *     axis-length control.
 *   • One fixed — the other axis is set to exactly match it, growing or shrinking. Shrinking is
 *     appropriate here and only here: the user has already chosen to look at a window, so following
 *     them on the other axis is what keeps the picture 1:1 while they zoom.
 *   • Both fixed — there is nothing left to move. Refused, and the caller reports it in a warning.
 */
export type EqualAspectPlan =
  /** Re-range `axis` to `domain` (about its centre) so the two scales match. */
  | { kind: "ok"; axis: "x" | "y"; domain: [number, number] }
  /** The two scales already agree — nothing to do. */
  | { kind: "already" }
  /** Cannot be honoured; `reason` is user-facing prose for the scene's warnings. */
  | { kind: "blocked"; reason: string };

/** One axis as equal aspect sees it: what it spans, over how many pixels, and whether it is free. */
export interface EqualAspectAxis {
  domain: [number, number];
  px: number;
  /** The user pinned this axis (hand-typed range, or the pan/zoom window they are looking at). */
  fixed?: boolean | undefined;
}

/** Units of data per pixel on an axis, or null when the inputs cannot describe a scale. */
function unitsPerPx(domain: [number, number], px: number): number | null {
  const span = Math.abs(domain[1] - domain[0]);
  const len = Math.abs(px);
  if (!Number.isFinite(span) || !Number.isFinite(len) || span <= 0 || len <= 0) return null;
  return span / len;
}

/** Re-range one axis about its own centre to exactly `target` units per pixel. */
function reRange(side: EqualAspectAxis, target: number): [number, number] {
  const centre = (side.domain[0] + side.domain[1]) / 2;
  const half = (target * Math.abs(side.px)) / 2;
  return [centre - half, centre + half];
}

/**
 * Plan the domain change that makes X and Y share a pixel scale. Pure geometry — the caller
 * rebuilds the affected scale over the returned domain (as an exact range, so the change is
 * not rounded away by `nice()`).
 */
export function planEqualAspect(x: EqualAspectAxis, y: EqualAspectAxis): EqualAspectPlan {
  const ux = unitsPerPx(x.domain, x.px);
  const uy = unitsPerPx(y.domain, y.px);
  if (ux === null || uy === null) return { kind: "blocked", reason: "Equal aspect needs both axes to span a real range." };
  // Within a rounding whisker of each other: leave the nice domains alone rather than
  // rebuilding them as exact ranges and losing the round tick values for nothing.
  if (Math.abs(ux - uy) <= 1e-9 * Math.max(ux, uy)) return { kind: "already" };
  const xFixed = x.fixed === true;
  const yFixed = y.fixed === true;
  if (xFixed && yFixed) {
    return {
      kind: "blocked",
      reason: "Equal aspect could not be applied: both axes are showing a range you set, so neither is free to change.",
    };
  }
  // One axis pinned → the free one matches it, in whichever direction that takes.
  if (xFixed) return { kind: "ok", axis: "y", domain: reRange(y, ux) };
  if (yFixed) return { kind: "ok", axis: "x", domain: reRange(x, uy) };
  // Neither pinned → grow the tighter one; never crop.
  const target = Math.max(ux, uy);
  return ux > uy ? { kind: "ok", axis: "y", domain: reRange(y, target) } : { kind: "ok", axis: "x", domain: reRange(x, target) };
}
