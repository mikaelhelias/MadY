/** Unicode superscript digits (and minus) — the exponent of 1.5×10³, 10⁻², e². */
const SUP = "[⁻⁰¹²³⁴⁵⁶⁷⁸⁹]+";
/** A plain number with any of the digit-grouping marks the Numbering tab offers (1,000 · 1.000 · 1 000 · 1’000). */
const NUM = "[-−]?\\d[\\d,. '’]*";
/** Every way MadY writes a tick number: plain, E notation (1.5E3), scientific (1.5×10³), power (10³, 2³, e²),
 *  short (1.5k — the k is suffix). An optional non-letter prefix ("$") and non-digit suffix ("%", " h", "k"). */
const NUMBER_LABEL = new RegExp(`^[^\\dA-Za-z]*(?:${NUM}(?:e[+-]?\\d+|×10${SUP})?|(?:10|2|e)${SUP})[^\\d]*$`, "i");

/**
 * Does this axis letter NUMBERS, or names? A linear axis can be lettered "Control | Low dose" (estimation)
 * or "PC1 | PC2" (scree) — number format, prefix and decimals then have nothing to act on. A number may
 * carry the axis's own prefix / suffix ("$5", "10%", "−2.5 h"), but a LETTER prefix makes it a name.
 * Dates (1970-01-02) and clock times (1:01:05) are not numbers either: the number formats do not reach them.
 *
 * Every number style the Numbering tab can produce must read as a number here — the right-click menu on
 * an axis's numbers is offered only when this says so, so a style it missed would take the menu away the
 * moment it was picked.
 */
export function axisTicksAreNumbers(axis: { ticks?: { label?: string }[] } | undefined): boolean {
  const labels = (axis?.ticks ?? []).map((tk) => (tk.label ?? "").trim()).filter(Boolean);
  return labels.length > 0 && labels.every((l) => NUMBER_LABEL.test(l));
}
