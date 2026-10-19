/**
 * Figure caption + alt-text drafting.
 *
 * Two things every paper needs:
 *   • a journal-style **caption** ("Figure 2. Dose–response of …"), and
 *   • an accurate **alt-text** description — increasingly required by journals and
 *     the thing that makes a figure readable by a screen reader.
 *
 * Both are derived from what the figure actually is (its kind, axes, series and the
 * data's real range) plus an optional one-line statistic from a linked analysis, so
 * the text never invents anything. Nothing is auto-inserted: the UI offers it as a
 * draft to copy and edit — the same opt-in contract as `methodsProse.ts`.
 *
 * Pure + DOM-free → unit-testable.
 */
import type { DataTable, NodeId, Plot } from "@mady/core";
import { tableDatasets, xColumn } from "@mady/core";
import { sciText } from "@mady/core";

export interface FigureText {
  /** A journal-style figure caption the user edits and pastes. */
  caption: string;
  /** A plain, accurate description for screen readers / the `alt` attribute. */
  altText: string;
}

export interface CaptionOptions {
  /** Figure number for the caption lead ("Figure 2. …"). Omit for no number. */
  index?: number | undefined;
  /** A one-line key statistic to fold in (e.g. `keyMetricLine` of a linked analysis). */
  statLine?: string | undefined;
}

/** How each chart type is named in prose. */
const KIND_NOUN: Record<string, string> = {
  image: "image",
  xy: "XY plot",
  area: "area chart",
  bar: "bar chart",
  box: "box-and-whisker plot",
  violin: "violin plot",
  scatter: "column scatter plot",
  raincloud: "raincloud plot",
  bubble: "bubble chart",
  histogram: "histogram",
  volcano: "volcano plot",
  survival: "Kaplan–Meier survival plot",
  roc: "ROC curve",
  beforeafter: "before–after plot",
  pie: "pie chart",
  heatmap: "heatmap",
  corrmatrix: "correlation matrix",
  alluvial: "alluvial diagram",
  network: "network graph",
  treemap: "treemap",
  radar: "radar chart",
  parallel: "parallel-coordinates plot",
  scatter3d: "3-D scatter plot",
  ridgeline: "ridgeline plot",
  lollipop: "lollipop chart",
  paireddot: "paired dot plot",
  floatingbar: "floating-bar chart",
  estimation: "estimation (Gardner–Altman) plot",
  forest: "forest plot",
  funnel: "funnel plot",
  venn: "Venn diagram",
  upset: "UpSet plot",
  swimmer: "swimmer plot",
  ternary: "ternary plot",
  rose: "wind rose",
  tracks: "timeline tracks",
  blandaltman: "Bland–Altman plot",
  pyramid: "population pyramid",
  // "ordination", not "PCA": the same kinds also draw a PCoA, an NMDS and a correspondence
  // analysis, and a caption that names the wrong method is worse than a generic one.
  pcascore: "ordination plot",
  pcaload: "ordination loadings plot",
  pcabiplot: "ordination biplot",
  triplot: "ordination triplot",
  scree: "scree plot",
  dendrogram: "dendrogram",
};

/** Kinds with no conventional numeric X/Y pair — described by composition, not axes. */
const NON_AXIS = new Set([
  "image",
  "pie", "heatmap", "corrmatrix", "alluvial", "network", "treemap", "radar", "parallel", "scatter3d", "dendrogram",
]);

/** Compact number for prose. Routed through `sciText` so a caption destined for a
 *  manuscript reads "5 × 10⁻⁸" rather than "5e-8". */
function num(x: number): string {
  return sciText(x);
}

/** Min/max across the given columns of a table, or null when there are no numbers. */
function numericRange(table: DataTable, colIds: readonly NodeId[]): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const row of table.rows) {
    for (const id of colIds) {
      const v = row.cells[id];
      if (typeof v === "number" && Number.isFinite(v)) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
  }
  return lo <= hi ? [lo, hi] : null;
}

/** "A and B" / "A, B, and C". */
function nameList(names: readonly string[]): string {
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

const isLog = (scale: unknown): boolean => typeof scale === "string" && scale.startsWith("log");

/**
 * Draft a caption + alt-text for a graph. `table` may be undefined (an unresolved
 * source) — the text then describes the figure without data ranges rather than inventing them.
 */
export function figureCaption(plot: Plot, table: DataTable | undefined, opts: CaptionOptions = {}): FigureText {
  const kind = plot.kind ?? "xy";
  // An image panel has no data to describe, so its own alt text is the only reliable source —
  // the drafter cannot see the picture and must not invent what it shows.
  if (kind === "image") {
    const lead = opts.index != null ? `Figure ${opts.index}. ` : "";
    const title = (plot.title ?? plot.name ?? "").trim();
    const described = (plot.image?.alt ?? "").trim();
    // The alt text often starts out as the panel name (both seed from the file name), so
    // leading with the title would stutter — "western-blot. western-blot." Say it once.
    const echoes = described.toLowerCase() === title.toLowerCase();
    const body = described || (title ? `Image: ${title}.` : "Image.");
    const leadTitle = title && described && !echoes ? `${title}. ` : "";
    return {
      caption: `${lead}${leadTitle}${body}`.replace(/\s+/g, " ").trim(),
      altText: body.replace(/\s+/g, " ").trim(),
    };
  }
  const noun = KIND_NOUN[kind] ?? "graph";
  const title = (plot.title ?? plot.name ?? "").trim();

  const datasets = table ? tableDatasets(table) : [];
  const seriesNames = datasets.map((d) => d.name.trim()).filter((n) => n.length > 0);
  const xCol = table ? xColumn(table) : undefined;

  const xTitle = (plot.xAxis?.title ?? xCol?.name ?? "").trim();
  // With several series the first series' name is not the axis meaning ("…of Control
  // versus Dose for Control and Treated" reads wrong) — fall back to a generic phrase.
  const yTitle = (plot.yAxis?.title ?? (datasets.length === 1 ? datasets[0]?.name : undefined) ?? "").trim();
  const logX = isLog(plot.xAxis?.scale);
  const logY = isLog(plot.yAxis?.scale);

  const xRange = table && xCol ? numericRange(table, [xCol.id]) : null;
  const yRange = table ? numericRange(table, datasets.flatMap((d) => d.replicates)) : null;

  // Naming the lone series is redundant when it is the Y-axis meaning ("Vertical axis:
  // Response … It shows a single series (Response)") — still say there is one, without echoing.
  const loneSeriesEchoesY =
    !NON_AXIS.has(kind) && seriesNames.length === 1 && yTitle !== "" && seriesNames[0]!.trim() === yTitle;
  const seriesClause =
    seriesNames.length === 0
      ? ""
      : loneSeriesEchoesY
        ? "a single data series"
        : seriesNames.length === 1
          ? `a single series (${seriesNames[0]})`
          : `${seriesNames.length} series: ${nameList(seriesNames)}`;

  // --- alt text: structural, literal, screen-reader first ---
  const altBits: string[] = [`${sentenceCase(noun)}${title ? ` titled “${title}”` : ""}.`];
  if (!NON_AXIS.has(kind)) {
    altBits.push(axisSentence("Horizontal", xTitle || "X", logX, xRange));
    altBits.push(axisSentence("Vertical", yTitle || "value", logY, yRange));
  }
  if (seriesClause) altBits.push(`It shows ${seriesClause}.`);
  if (opts.statLine) altBits.push(`Reported statistic: ${opts.statLine}.`);

  // --- caption: publication-style lead ---
  const lead = opts.index != null ? `Figure ${opts.index}. ` : "";
  const body = NON_AXIS.has(kind)
    ? `${sentenceCase(noun)}${title ? ` of ${title}` : ""}${seriesClause ? ` showing ${seriesClause}` : ""}.`
    : `${sentenceCase(noun)} of ${yTitle || "the measured value"} versus ${xTitle || "the independent variable"}` +
      `${seriesNames.length > 1 ? ` for ${nameList(seriesNames)}` : ""}.`;
  const titleClause = title && !NON_AXIS.has(kind) ? `${title}. ` : "";
  const statClause = opts.statLine ? ` ${opts.statLine}.` : "";

  return {
    caption: `${lead}${titleClause}${body}${statClause}`.replace(/\s+/g, " ").trim(),
    altText: altBits.join(" ").replace(/\s+/g, " ").trim(),
  };
}

function axisSentence(which: string, label: string, log: boolean, range: [number, number] | null): string {
  const scale = log ? " on a log scale" : "";
  const span = range ? `, ranging from ${num(range[0])} to ${num(range[1])}` : "";
  return `${which} axis: ${label}${scale}${span}.`;
}

function sentenceCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The two drafts joined for copy-to-clipboard. */
export function figureTextBlock(t: FigureText): string {
  return `Caption\n${t.caption}\n\nAlt text\n${t.altText}`;
}

/** One panel of a multi-panel figure: its graph, that graph's table, the letter it is
 *  labelled with on screen, and an optional headline statistic from a linked analysis. */
export interface CaptionPanel {
  plot: Plot;
  table: DataTable | undefined;
  /** The label the panel actually shows ("A", "(a)", "S1", …). "" = unlabelled. */
  letter: string;
  statLine?: string | undefined;
}

/** Strip a trailing full stop so a clause can be re-punctuated inside a longer sentence. */
function unperiod(s: string): string {
  return s.replace(/\.\s*$/, "");
}

/**
 * Draft a caption + alt-text for a multi-panel figure (the assembler's Caption button).
 *
 * Built by describing each panel with the same `figureCaption` machinery and stitching the
 * results under the panel letters — "(A) … (B) …", the form every journal uses. Like the
 * single-graph drafter it invents nothing: each clause and every number comes from that
 * panel's own plot, table and linked analysis. Nothing is auto-inserted; the UI offers it
 * as an editable draft.
 */
export function multiPanelCaption(
  figureName: string,
  panels: readonly CaptionPanel[],
  opts: { index?: number | undefined } = {},
): FigureText {
  const lead = opts.index != null ? `Figure ${opts.index}. ` : "";
  const name = figureName.trim();
  // The figure's own name leads the caption — unless it is a bare placeholder ("Figure 1"),
  // which would just restate the lead.
  const nameClause = name && !/^figure\s*\d*$/i.test(name) ? `${unperiod(name)}. ` : "";

  if (panels.length === 0) {
    return {
      caption: `${lead}${nameClause}`.trim(),
      altText: "Empty figure — no panels.",
    };
  }

  const per = panels.map((p) => {
    const t = figureCaption(p.plot, p.table, p.statLine ? { statLine: p.statLine } : {});
    // Captions cite panels as "(A)". A label the user already bracketed themselves — "(a)",
    // "[i]" — is used as-is rather than double-wrapped into "((a))".
    const bracketed = /^[([].*[)\]]$/.test(p.letter.trim());
    const tag = p.letter ? `${bracketed ? p.letter.trim() : `(${p.letter})`} ` : "";
    return { tag, ...t };
  });

  const captionBody = per.map((p) => `${p.tag}${unperiod(p.caption)}.`).join(" ");
  const altHead =
    panels.length === 1
      ? "Single-panel figure."
      : `Multi-panel figure with ${panels.length} panels${nameClause ? `, ${unperiod(nameClause)}` : ""}.`;
  const altBody = per.map((p) => `${p.tag}${unperiod(p.altText)}.`).join(" ");

  return {
    caption: `${lead}${nameClause}${captionBody}`.replace(/\s+/g, " ").trim(),
    altText: `${altHead} ${altBody}`.replace(/\s+/g, " ").trim(),
  };
}
