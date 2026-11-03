import type { PlotScene } from "./scene.js";

/**
 * Names on vertical reference lines never print on each other. Every vertical line's name sits at the same height, just
 * right of its line, so two lines closer than a name's width would print one name over the other (e.g. the stream
 * graph's "Disease onset" and "Treatment", or on a narrower figure "Travel" and "Diet change").
 *
 * Left to right, a name that would run into one already placed drops one line lower, to the first free line. A name
 * that fits stays exactly where it was, so a chart whose names never touched is unchanged.
 */
export function staggerLineCaptions(scene: PlotScene, measure: (text: string, px: number) => number): void {
  const names = scene.annotations
    .filter((a) => a.kind === "line" && a.label && a.x1 != null && a.x1 === a.x2 && a.labelAnchor === "start" && a.labelX != null && a.labelY != null)
    .sort((a, b) => a.labelX! - b.labelX!);
  const rightEnds: number[] = []; // per line of names: where the last name placed on it ends
  for (const a of names) {
    const fs = a.fontSize ?? scene.fonts.legend.size;
    const x = a.labelX!;
    let level = rightEnds.findIndex((end) => end + fs * 0.4 <= x);
    if (level < 0) level = rightEnds.length;
    rightEnds[level] = x + measure(a.label!, fs);
    if (level > 0) a.labelY = a.labelY! + level * fs * 1.25;
  }
}
