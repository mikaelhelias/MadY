/**
 * The size to draw a graph title or subtitle at so it does not run past the figure.
 *
 * Returns `size` when the text fits `available` px; otherwise the largest whole size that does, never below
 * `floor` (a title already smaller than the floor is left alone, and a title never grows). The longest line
 * of a multi-line text decides. `measure` under-reads by a few per cent, so the text is treated as 10%
 * wider than measured: over-shrinking by a point is invisible, a clipped title is not.
 */
export function fitHeadingSize(
  text: string,
  size: number,
  measure: (text: string, px: number) => number,
  available: number,
  floor: number,
): number {
  if (!text || !(available > 0) || size <= floor) return size;
  const SLACK = 1.1;
  const longest = (px: number): number => Math.max(...text.split("\n").map((line) => measure(line, px))) * SLACK;
  if (longest(size) <= available) return size;
  let fit = Math.floor((size * available) / longest(size));
  // Measure may not be linear in the size; settle on the largest whole size that really fits.
  while (fit > floor && longest(fit) > available) fit -= 1;
  while (fit + 1 < size && longest(fit + 1) <= available) fit += 1;
  return Math.max(floor, Math.min(size, fit));
}
