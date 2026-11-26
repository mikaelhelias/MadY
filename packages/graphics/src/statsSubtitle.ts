import type { Plot } from "@mady/core";

/**
 * The key-stats label of a graph, drawn where the reader looks for a result: as a line under the title.
 *
 * "Key stats as a label" stores a text annotation (`role: "stats"`) that starts at the top centre INSIDE the plot,
 * which is where the data, the variable names and the reference lines are. While the label is still at that
 * starting place and the graph shows its title, it is drawn under the title instead (the way a survival graph
 * shows its hazard ratio), and the plot keeps the whole area for the data.
 *
 * The annotation stays the stored object — so the toggle, undo, the figure assembler (which hides panel titles,
 * leaving the label in the plot) and old files all keep working. A label the user has dragged or resized is
 * theirs and stays where they put it.
 */

/** Where `keyStatsAnnotation` puts the label (a fraction of the plot): a label still here has not been moved. */
const HOME = { x: 0.5, y: 0.07, w: 0.9 };

export interface RoutedStats {
  /** The plot with the label moved into its subtitle (the annotation is removed from the copy). */
  plot: Plot;
  /** The text added to the subtitle (already broken into lines that fit). */
  text: string;
}

type PlotAnnotation = NonNullable<Plot["annotations"]>[number];

const isHomeStats = (a: PlotAnnotation): boolean => {
  const t = a as unknown as { kind?: string; role?: string; x?: number; y?: number; w?: number; label?: string; rotation?: number };
  return t.kind === "text" && t.role === "stats" && !!t.label && t.x === HOME.x && t.y === HOME.y && t.w === HOME.w && !t.rotation;
};

/** Break a result line at its " · " separators into lines no wider than `maxWidth` (a single part wider than that stays whole). */
export function wrapStatsLine(line: string, maxWidth: number, measure: (text: string) => number): string {
  const parts = line.split(/\s+·\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const part of parts) {
    const next = cur ? `${cur}  ·  ${part}` : part;
    if (cur && measure(next) > maxWidth) { lines.push(cur); cur = part; } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines.join("\n");
}

/**
 * The plot with its home-position key-stats label moved into the subtitle, or undefined when it stays in the plot
 * (no such label, the title is hidden, or the label has been moved).
 */
export function routeStatsToSubtitle(plot: Plot, maxWidth: number, measure: (text: string) => number): RoutedStats | undefined {
  if (plot.showTitle === false) return undefined;
  const annotations = plot.annotations ?? [];
  const stat = annotations.find(isHomeStats);
  if (!stat) return undefined;
  const text = wrapStatsLine(String((stat as unknown as { label: string }).label), maxWidth, measure);
  const subtitle = plot.subtitle ? `${plot.subtitle}\n${text}` : text;
  return { plot: { ...plot, subtitle, annotations: annotations.filter((a) => a !== stat) }, text };
}

/** The stats line of a label that would be drawn under the title (see routeStatsToSubtitle), or undefined. */
export function homeStatsLabel(plot: Plot): string | undefined {
  if (plot.showTitle === false) return undefined;
  const stat = (plot.annotations ?? []).find(isHomeStats);
  return stat ? String((stat as unknown as { label: string }).label) : undefined;
}

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A subtitle as the reader sees it, without the routed stats text: the inline editor shows (and returns) the whole
 * drawn subtitle, and writing it back as it is would store the stats line twice. The line is found by its parts,
 * so it is found however it was broken into lines.
 */
export function withoutRoutedStats(drawn: string, statsLabel: string): string {
  const parts = statsLabel.split(/\s+·\s+/).filter(Boolean);
  if (!parts.length) return drawn;
  const tail = new RegExp(`(?:^|\\n)${parts.map(escapeRegex).join("\\s*(?:·\\s*)?")}\\s*$`);
  return tail.test(drawn) ? drawn.replace(tail, "") : drawn;
}
