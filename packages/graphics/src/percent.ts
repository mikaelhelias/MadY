/**
 * A share of a whole as printed text ("31.5" -> "32"). A fraction computed as value / total carries binary dust
 * (31.5 of 100.00000000000001 is 0.31499999999999995), so rounding it directly would turn an exact half down: 31.5 %
 * would read "31 %" while 8.5 % reads "9 %". The dust is cleared first, then halves go up, as everywhere else on the figure.
 */
export function percentText(fraction: number, digits = 0): string {
  if (!Number.isFinite(fraction)) return "";
  const scale = 10 ** digits;
  const clean = (n: number): number => Number(n.toPrecision(12));
  const scaled = clean(clean(fraction * 100) * scale);
  const rounded = Math.round(scaled) / scale;
  // A share that is there but rounds to nothing is not "0", and one short of the whole is not "100".
  const step = (1 / scale).toFixed(digits);
  if (fraction > 0 && rounded === 0) return `<${step}`;
  if (fraction < 1 && rounded === 100) return `>${(100 - 1 / scale).toFixed(digits)}`;
  return rounded.toFixed(digits);
}
