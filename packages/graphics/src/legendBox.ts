/**
 * Width (px) of a vertical legend's drawn box: the symbol column, the widest label at the
 * renderer's text estimate (len × font × 0.6), and the padding on both sides.
 *
 * One formula. The renderer (`Legend` in PlotFigure.tsx) draws the box with it, and category-group
 * names down the right edge are placed past it. A second estimate (e.g. the builder's text measure
 * plus a fixed 18px symbol column) would be narrower than the box as drawn, so the names would run
 * through the legend on horizontal bar charts with big legend symbols.
 *
 * The fallbacks (18px column, 6px padding) are the renderer's defaults when the layout sets none.
 */
export function legendBoxWidth(
  layout: { swatchWidth?: number | undefined; padding?: number | undefined },
  labels: readonly string[],
  fontSize: number,
): number {
  // A label on several lines (`\n`) is as wide as its widest LINE.
  const widest = Math.max(0, ...labels.flatMap((l) => l.split("\n")).map((l) => l.length * fontSize * 0.6));
  return (layout.swatchWidth ?? 18) + widest + 2 * (layout.padding ?? 6);
}

/** The text a legend row draws: its wrapped lines joined by line breaks, else its label. */
export function legendLabelText(e: { label: string; lines?: readonly string[] | undefined }): string {
  return e.lines ? e.lines.join("\n") : e.label;
}

/**
 * Break a legend label at its SPACES into lines no wider than `room` px (as `measure` reads them). Words are never cut —
 * nor is a value from its sign ("λ = 2.938") —
 * a single word longer than the room gets a line of its own, whole — and a label that fits comes back as one line.
 * A line break the user typed is kept.
 */
export function wrapLegendLabel(label: string, room: number, measure: (text: string) => number): string[] {
  const out: string[] = [];
  for (const para of label.split("\n")) {
    let line = "";
    // A lone sign ("=", "<", "±") is glued to the words either side of it: "λ = 2.938" is one value, never split.
    const words: string[] = [];
    let glue = false;
    for (const w of para.split(" ").filter((x) => x !== "")) {
      const sign = /^[=<>≤≥±≈~×+−-]$/.test(w);
      if ((sign || glue) && words.length > 0) words[words.length - 1] += ` ${w}`;
      else words.push(w);
      glue = sign;
    }
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (line && measure(next) > room) {
        out.push(line);
        line = word;
      } else line = next;
    }
    out.push(line);
  }
  return out;
}
