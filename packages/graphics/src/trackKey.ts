/**
 * The size and place of a numeric strip's key inside its strip, so the key's two numbers never meet.
 *
 * The key is a colour bar with its largest number at the head and its smallest at the foot. The bar is inset from
 * the strip's ends by about a number's height, so the numbers stay inside their own strip and two stacked strips'
 * numbers do not meet. On a short strip that leaves a bar shorter than the two numbers are tall, and they print on
 * top of each other. Short strips come from a pinned track height, a short figure or many tracks.
 *
 * Largest to smallest, the first that fits:
 *   1. the numbers at the size asked for, the bar inset as above (`keyScale` shortens it, but never below what the
 *      numbers need);
 *   2. smaller numbers, down to a readable minimum, in a bar that has room for them;
 *   3. one label, "min–max", beside the middle of the bar: a strip too short to stack two readable numbers.
 */
export interface TrackKeyLayout {
  /** Offset of the bar's top from the strip's top. */
  top: number;
  /** The bar's height. */
  h: number;
  /** The numbers' font size, px. */
  labelSize: number;
  /** One "min–max" label instead of two stacked numbers. */
  combined: boolean;
}

/** Below this a number is decoration, not information (the same floor as the stacked category labels). */
const MIN_READABLE = 7;

/**
 * The bar height two stacked numbers of `size` need: the foot number's top clears the head number's baseline with a
 * pixel to spare. The renderer puts the head baseline a third of a size below the bar's top and the foot baseline 0.3
 * of a size above its end, and a digit stands about 0.72 of a size tall (so ≈1.02·size + 5); the margin is rounded up.
 */
function barNeeded(size: number): number {
  return 1.05 * size + 6;
}

export function trackKeyLayout(bandH: number, fontSize: number, keyScale: number): TrackKeyLayout {
  const place = (size: number, combined: boolean): TrackKeyLayout => {
    const inset = combined ? Math.min(1.5, bandH / 4) : Math.min(bandH / 3, size * 0.75);
    const avail = Math.max(4, bandH - 2 * inset);
    const asked = Math.max(4, Math.min(avail, avail * keyScale));
    const h = combined ? asked : Math.max(asked, Math.min(avail, barNeeded(size)));
    return { top: inset + (avail - h) / 2, h, labelSize: size, combined };
  };
  for (let size = fontSize; size >= MIN_READABLE; size = Math.ceil(size) - 1) {
    const inset = Math.min(bandH / 3, size * 0.75);
    const avail = Math.max(4, bandH - 2 * inset);
    if (avail >= barNeeded(size)) return place(size, false);
  }
  // Not even the smallest readable numbers stack: one label, as large as the strip allows but no larger than asked.
  return place(Math.min(fontSize, Math.max(5, bandH - 2)), true);
}
