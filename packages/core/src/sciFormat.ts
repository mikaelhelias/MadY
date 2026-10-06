/**
 * Scientific number typesetting.
 *
 * Journals write `1.0 × 10⁻⁶`. JavaScript writes `1e-6`, which must not reach MadY's drafted
 * captions and analysis text — `String(Number(x.toPrecision(3)))` falls back
 * to exponent notation below 1e-6 and above 1e21, and `toExponential` produces `1.20e-6`
 * outright. In a figure caption destined for a manuscript, `5e-8` reads as unfinished.
 *
 * Two output targets, because they need different characters:
 *   • `sciText`   → real Unicode superscripts (`1.2 × 10⁻⁶`) for anything a human copies:
 *     captions, alt text, clipboard, CSV/exported prose.
 *   • `sciMarkup` → the renderer's rich-text markup (`1.2 × 10^{-6}`) for SVG labels, which
 *     `RichText` turns into `<tspan baseline-shift="super">`.
 *
 * Note: not handled here: axis tick labels already do this correctly in `scale.ts` (Unicode
 * superscripts, its own tuned thresholds) — this module deliberately leaves that path alone
 * rather than introducing a second opinion about tick formatting.
 *
 * Pure + DOM-free → unit-testable.
 */

const SUPERSCRIPT: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴",
  "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  "-": "⁻", "+": "⁺",
};

/** An integer exponent as Unicode superscript (−6 → "⁻⁶"). */
export function superscript(n: number): string {
  return String(n)
    .split("")
    .map((c) => SUPERSCRIPT[c] ?? c)
    .join("");
}

/** Outside this band a plain decimal gets unreadable, so switch to ×10ⁿ. */
const SMALL = 1e-3;
const LARGE = 1e5;

/** Split a value into a mantissa string and an integer exponent at the given precision. */
function parts(v: number, sig: number): { mantissa: string; exponent: number } {
  const [mant, exp] = v.toExponential(Math.max(0, sig - 1)).split("e");
  return { mantissa: String(Number(mant)), exponent: Number(exp) };
}

/** True when this value should be written in ×10ⁿ form rather than as a plain decimal. */
export function needsExponent(v: number): boolean {
  if (!Number.isFinite(v) || v === 0) return false;
  const a = Math.abs(v);
  return a < SMALL || a >= LARGE;
}

/**
 * A number for prose — captions, alt text, anything copied into a manuscript.
 * Never emits `e` notation: `0.0000012` becomes `1.2 × 10⁻⁶`, not `1.2e-6`.
 */
export function sciText(v: number, sig = 3): string {
  if (!Number.isFinite(v)) return "—";
  if (!needsExponent(v)) return String(Number(v.toPrecision(sig)));
  const { mantissa, exponent } = parts(v, sig);
  // "10⁻⁶" rather than "1 × 10⁻⁶" — the leading 1 is noise.
  return mantissa === "1" ? `10${superscript(exponent)}` : `${mantissa} × 10${superscript(exponent)}`;
}

/**
 * A number for an SVG label, in the renderer's rich-text markup so the exponent becomes a
 * real raised tspan rather than a lookalike character.
 */
export function sciMarkup(v: number, sig = 3): string {
  if (!Number.isFinite(v)) return "—";
  if (!needsExponent(v)) return String(Number(v.toPrecision(sig)));
  const { mantissa, exponent } = parts(v, sig);
  return mantissa === "1" ? `10^{${exponent}}` : `${mantissa} × 10^{${exponent}}`;
}

/**
 * A numeric interval, written with an en dash as ranges take — "2.29–8.32".
 *
 * A hyphen is wrong typographically and, worse, ambiguous next to negative numbers, so a
 * range containing a negative bound is spelled with "to" instead of a dash: "−1.5 to 0.4"
 * reads unambiguously where "−1.5–0.4" does not.
 */
export function rangeText(lo: number, hi: number, sig = 3): string {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return "—";
  const a = sciText(lo, sig);
  const b = sciText(hi, sig);
  return lo < 0 || hi < 0 ? `${a} to ${b}` : `${a}–${b}`;
}
