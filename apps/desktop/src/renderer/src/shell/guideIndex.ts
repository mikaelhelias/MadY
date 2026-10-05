/**
 * The function index — every thing the program can do, with where you press it.
 *
 * The manual (`guide.ts`) is topic-shaped: it explains axes, or exporting, in prose a person
 * reads. That answers "how does this work". It does not answer the other question people
 * actually arrive with — "where is the control for X" — because prose has no list of controls
 * in it. This file is that list: one entry per function, each carrying at least one `where`
 * (the menu path, the toolbar button, the Inspector tab + section, the gesture) and the id of
 * the chapter that explains it.
 *
 * Most of it is derived, and that is the point. The command registry, the toolbar, the table
 * formats, the analysis methods, the chart gallery, the transform list and the export formats
 * all already exist as data; re-typing them here would produce a manual that is wrong the first
 * time someone adds a command. So the index reads those registries, and `guideIndex.test.ts` is
 * default-deny in the other direction: a new command with no `ACTION_DOCS` row fails the build.
 *
 * What is hand-written is what no registry holds: the sentence saying what a command is for,
 * and the gestures (drag a title, Ctrl+D to fill down) that live in event handlers rather than
 * in a list.
 *
 * Note: not indexed here, on purpose: the Inspector's hundreds of individual control rows and the
 * `FIELD_HINTS`. The Inspector is indexed per section, with the rows
 * named in the chapter's prose — an index of hundreds of rows named `twoToneTint` is not useful to a
 * reader, and the labels only exist inside JSX, so they cannot be derived reliably anyway.
 */
import { TRANSFORMS, tableFormatList } from "@mady/core";
import { actionCatalogue } from "./actions";
import { METHOD_GROUPS, METHOD_INFO } from "./analysis";
import { methodLabel } from "./AnalyzeDialog";
import { EXPORT_FORMAT_LABEL, PLOT_EXPORT_FORMATS, TABLE_EXPORT_FORMATS } from "./exporters";
import { galleryItems } from "./gallery";
import { AXIS_GROUPS, INSPECTOR_SECTIONS, INSPECTOR_TABS, tabForSection } from "./Inspector";
import { axisEntryId, inspectorEntryId, inspectorTabEntryId } from "./guideIds";
import { HOW_TO, HOW_TO_PAGE } from "./howTo";
import { HOME_GROUP, type ToolbarItemId } from "./toolbar";

/** The kinds of place a function can live. One per surface a user can reach. */
export type GuideVia = "menu" | "toolbar" | "inspector" | "context" | "figure" | "sheet" | "dialog" | "keys";

/** The Inspector's rail tabs, as the user sees them named. */
export type InspectorTab = "Chart" | "Frame" | "Axis" | "Data" | "Text" | "Annotate" | "Style";

/**
 * Where a function is. Discriminated on `via` so each surface can carry what actually
 * identifies a control there — a menu has a path, the Inspector has a tab and a section, a
 * gesture has neither.
 */
export type GuideWhere =
  | { via: "menu"; path: string; shortcut?: string | undefined }
  | { via: "toolbar"; button: string }
  | { via: "inspector"; tab: InspectorTab; section: string; row?: string | undefined }
  | { via: "context"; on: string; item: string }
  | { via: "figure"; gesture: string }
  | { via: "sheet"; gesture: string }
  | { via: "dialog"; name: string; control?: string | undefined }
  | { via: "keys"; keys: string };

export interface GuideEntry {
  /** Stable, namespaced by source: `action:save`, `chart:volcano`, `method:ttest`. */
  id: string;
  /** What a reader would call it — the label on the control, not an identifier. */
  name: string;
  /** One plain sentence: what pressing it does. */
  what: string;
  /** At least one route to it. Several when the same function has several doors. */
  where: GuideWhere[];
  /** Extra words someone might search for. Never displayed. */
  keywords?: string[] | undefined;
  /** The `GUIDE` section that explains it. Must exist — the test checks. */
  section: string;
  /** A manual snapshot showing it, and which numbered call-out on that shot points at it. */
  shot?: { file: string; mark?: number | undefined } | undefined;
}

/** Is there an entry with this id? The "?" button is only drawn when the manual can answer. */
export function hasGuideEntry(id: string): boolean {
  return guideIndex().some((e) => e.id === id);
}

/** A `where` as one readable line — the "where" under a search hit's name. */
export function whereLine(w: GuideWhere): string {
  switch (w.via) {
    case "menu":
      return w.shortcut ? `${w.path}  ·  ${w.shortcut}` : w.path;
    case "toolbar":
      return `Toolbar ▸ ${w.button}`;
    case "inspector":
      return `Inspector ▸ ${w.tab} ▸ ${w.section}${w.row ? ` ▸ ${w.row}` : ""}`;
    case "context":
      return `Right-click ${w.on} ▸ ${w.item}`;
    case "figure":
      return `On the figure: ${w.gesture}`;
    case "sheet":
      return `In the datasheet: ${w.gesture}`;
    case "dialog":
      return w.control ? `${w.name} dialog ▸ ${w.control}` : `${w.name} dialog`;
    case "keys":
      return `Keyboard: ${w.keys}`;
  }
}

/**
 * What each command is for, and which chapter explains it — the one thing the action registry
 * does not carry (a menu label is a name, not an explanation).
 *
 * Default-deny: `guideIndex.test.ts` fails when a command in `actions.ts` has no row here. The
 * generated `new-table-*` commands are the single exception, and they are not an exemption —
 * they are derived from the table-format registry instead, which already describes each format
 * better than a row here could.
 */
export const ACTION_DOCS: Record<string, { what: string; section: string; keywords?: string[] }> = {
  // ── File ────────────────────────────────────────────────────────────────────────
  open: { what: "Open a saved MadY project (.mady), or a data file, from disk. The foot of the File menu lists the last eight.", section: "saving", keywords: ["open", "load", "project", "mady file", "recent"] },
  import: { what: "Bring a data file in — CSV, TSV, text, Excel, JSON or a .pzfx sheet — through the import dialog, where you set the separator, headers, decimal mark and what to do with the columns.", section: "import", keywords: ["csv", "tsv", "txt", "dat", "prn", "json", "ndjson", "jsonl", "xlsx", "xls", "xlsb", "ods", "pzfx", "excel", "spreadsheet", "open data"] },
  "import-ggplot": { what: "Read a ggplot2 R script and turn its chain into a MadY graph on a datasheet you pick, with a report of what was honoured, approximated or refused.", section: "import", keywords: ["ggplot", "ggplot2", "R", "rscript", "geom", "aes", "theme"] },
  "paste-data": { what: "Turn whatever is on the clipboard into a new datasheet.", section: "import", keywords: ["clipboard", "paste"] },
  save: { what: "Save to a .mady file — the whole project, or just one project folder, one experiment or one graph.", section: "saving", keywords: ["save as", "mady", "write", "store"] },
  export: { what: "Export whatever is in front — a graph, a figure or a table — as an image, a vector file or data.", section: "export", keywords: ["png", "svg", "pdf", "tiff", "jpeg", "eps", "save as picture", "figure file"] },
  print: { what: "Send the graph, figure or datasheet in front to the system print dialog.", section: "export", keywords: ["paper", "printer"] },
  "export-all": { what: "Export every graph and figure of the project into one folder at once, in one format — each file exactly what the Export dialog would write for it.", section: "export", keywords: ["batch", "all graphs", "every figure", "folder", "bulk export"] },
  "export-script": { what: "Write out a Python script that reproduces every analysis in the project.", section: "reproducibility", keywords: ["python", "code", "script"] },
  "export-repro": { what: "Write out a reproducibility bundle: provenance, the analysis script and a file manifest, in one Markdown document.", section: "reproducibility", keywords: ["bundle", "provenance", "manifest", "methods"] },
  "new-project": { what: "Start a new, empty project — no datasheets, no graphs, nothing carried over.", section: "saving", keywords: ["blank", "start over", "empty"] },
  "new-dataset-dialog": { what: "Open the creator: pick the shape of your data, then the graph it supports. Finishes at a datasheet, a graph, or both.", section: "new-datasheet", keywords: ["wizard", "creator", "new", "sample data"] },

  // ── Edit ────────────────────────────────────────────────────────────────────────
  undo: { what: "Undo the last change. Every change in MadY is undoable, including edits you made by dragging something on a figure.", section: "workspace", keywords: ["back", "revert", "mistake"] },
  redo: { what: "Put back a change you have just undone.", section: "workspace", keywords: ["repeat", "again"] },
  "copy-cells": { what: "Copy the selected block of cells to the clipboard, ready to paste here or into another program.", section: "select-copy", keywords: ["clipboard", "duplicate values"] },
  "cut-cells": { what: "Copy the selected block of cells to the clipboard and clear them from the sheet.", section: "select-copy", keywords: ["clipboard", "move values"] },
  "paste-cells": { what: "Paste whatever is on the clipboard into the sheet, starting at the selected cell.", section: "select-copy", keywords: ["clipboard", "insert values"] },

  // ── Insert ──────────────────────────────────────────────────────────────────────
  "new-dataset": { what: "Add an empty XY datasheet — one X column and as many Y datasets as you need.", section: "new-datasheet", keywords: ["blank sheet", "add table"] },
  "new-layout": { what: "Start a multi-panel figure: pick the graphs, then arrange them into lettered panels.", section: "figures", keywords: ["figure", "panel", "montage", "composite"] },

  // ── Data ────────────────────────────────────────────────────────────────────────
  "exclude-values": { what: "Exclude the selected values: they stay visible in the sheet but stop feeding graphs and statistics.", section: "exclude", keywords: ["omit", "ignore", "outlier", "strike out"] },
  "include-values": { what: "Put excluded values back into use.", section: "exclude", keywords: ["restore", "un-exclude"] },
  transform: { what: "Apply a function to the values — logs, powers, reciprocals, standardising, trigonometry — into a new datasheet or in place.", section: "datamenu", keywords: ["log", "sqrt", "z-score", "normalise", "function of y"] },
  colmath: { what: "Subtract a baseline column, or divide, add or multiply one column by another.", section: "datamenu", keywords: ["baseline", "subtract", "normalize", "ratio"] },
  rowstats: { what: "Compute mean, SD, SEM, n and more across each row, into a new datasheet.", section: "datamenu", keywords: ["mean", "average", "sd", "sem", "per row"] },
  frequency: { what: "Count values into bins — the numbers behind a histogram, with cumulative and relative options.", section: "datamenu", keywords: ["histogram", "bins", "counts", "distribution"] },
  qqplot: { what: "Build a normal-probability (QQ) datasheet, to see whether values follow a normal distribution.", section: "datamenu", keywords: ["quantile", "normality", "probability plot"] },
  prune: { what: "Keep only some rows — the first or last n, every nth, or a range.", section: "datamenu", keywords: ["thin", "subset", "filter rows"] },
  extract: { what: "Pick out and reorder columns into a new datasheet.", section: "datamenu", keywords: ["select columns", "rearrange", "subset"] },
  transpose: { what: "Swap rows and columns, so what ran across the sheet now runs down it.", section: "datamenu", keywords: ["flip", "rotate table", "turn"] },
  "split-text": { what: "Split one column's text at a separator — \"Liver_Day7\" at \"_\" gives Liver and Day7 — into a new sheet that follows this one. Parts that are numbers become numbers.", section: "datamenu", keywords: ["text to columns", "delimiter", "separate"] },
  "find-replace": { what: "Replace text in the whole sheet or one column, in one step Undo reverses. Shows how many cells will change before anything does.", section: "datamenu", keywords: ["search", "substitute", "recode", "rename values"] },
  "merge-data": { what: "Join two sheets row by row on a column they share, such as a sample ID, into a new sheet. A one-time copy: later edits to the two sheets do not change it.", section: "datamenu", keywords: ["join", "combine sheets", "lookup", "match rows"] },
  reshape: { what: "Convert between wide and long layouts — one column per group, or one column of group names.", section: "datamenu", keywords: ["pivot", "melt", "stack", "unstack", "tidy"] },
  "sort-data": { what: "Reorder the rows by the values in one column, ascending or descending.", section: "sort-freeze", keywords: ["order", "ascending", "descending", "rank rows"] },
  "duplicate-data": { what: "Make a second copy of the datasheet, so you can change one without touching the other.", section: "sort-freeze", keywords: ["copy sheet", "clone"] },

  // ── Analyze ─────────────────────────────────────────────────────────────────────
  analyze: { what: "Open the analysis chooser: goal tiles, a recommendation for the sheet in front, a search box and the full catalogue.", section: "choosing", keywords: ["statistics", "test", "run analysis"] },
  doseresponse: { what: "Fit a dose-response curve and read EC50 or IC50 off it.", section: "curvefit", keywords: ["ec50", "ic50", "sigmoid", "four-parameter logistic", "4pl", "potency"] },
  "enzyme-kinetics": { what: "Fit enzyme kinetics — Michaelis-Menten and the inhibition models.", section: "curvefit", keywords: ["km", "vmax", "kcat", "lineweaver-burk", "substrate"] },
  binding: { what: "Fit receptor binding — saturation and competition models.", section: "curvefit", keywords: ["kd", "bmax", "ligand", "radioligand"] },
  "interpolate-curve": { what: "Fit a standard curve and read unknown concentrations off it.", section: "curvefit", keywords: ["standard curve", "elisa", "unknowns", "read off"] },
  "melting-temperature": { what: "Find the melting temperature (Tm) of melt curves, and ΔTm against a control.", section: "curvefit", keywords: ["tm", "melting temperature", "thermal shift", "dsf", "unfolding", "melt curve", "delta tm"] },
  "method-comparison": { what: "Compare two measurement methods — Deming, Passing-Bablok and Bland-Altman.", section: "analysis", keywords: ["agreement", "bias", "assay comparison"] },
  power: { what: "Work out the sample size you need, or the power you have.", section: "planning", keywords: ["sample size", "n per group", "effect size", "beta"] },
  simulate: { what: "Generate synthetic data from a distribution you choose, with a seed so it is reproducible.", section: "planning", keywords: ["random", "synthetic", "fake data", "seed"] },
  montecarlo: { what: "Run an analysis over many simulated datasets and summarise how it behaves.", section: "planning", keywords: ["resampling", "bootstrap", "simulation study"] },

  // ── View ────────────────────────────────────────────────────────────────────────
  "nav-back": { what: "Go back to the tab you were looking at before. This walks your viewing history, not your edits — nothing is undone.", section: "workspace", keywords: ["history", "previous"] },
  "nav-forward": { what: "Go forward again through the tabs you visited, after going back.", section: "workspace", keywords: ["history", "next"] },
  "command-palette": { what: "Open a search box over the whole command list — type a few letters of any command and run it without hunting through menus.", section: "shortcuts", keywords: ["search commands", "quick open", "ctrl k"] },
  "view-lineage": { what: "See the provenance map: which datasheet each graph and analysis came from.", section: "reproducibility", keywords: ["provenance", "map", "where did this come from", "dependencies"] },
  settings: { what: "Open Settings: the look new graphs start from, defaults for analyses, and application preferences.", section: "settings", keywords: ["preferences", "options", "defaults", "configuration"] },
  "zoom-in": { what: "Magnify the graph, figure or datasheet in front. The document is unchanged — only how large it is drawn on screen.", section: "moving", keywords: ["magnify", "bigger", "enlarge"] },
  "zoom-out": { what: "Draw the graph, figure or datasheet in front smaller, so more of it fits on screen.", section: "moving", keywords: ["smaller", "shrink", "zoom out"] },
  "zoom-reset": { what: "Put the zoom back to 100%, so what you see is the size the figure really is.", section: "moving", keywords: ["fit", "actual size", "100%", "reset"] },
  "set-zoom": { what: "Type an exact zoom percentage instead of stepping in and out.", section: "moving", keywords: ["percentage", "scale view", "exact"] },
  "toggle-theme": { what: "Switch the program between its light and dark appearance. Your figures are unaffected.", section: "interface", keywords: ["dark mode", "light mode", "night"] },
  "graph-ruler": { what: "Show a ruler around the figure, so you can measure and line things up.", section: "moving", keywords: ["measure", "guides", "margins", "mm"] },
  "color-vision": { what: "See the graph or figure in front as a colour-blind reader or a greyscale printer would — deuteranopia, protanopia, tritanopia or greyscale, chosen in the graph toolbar's View group. A screen-only preview: exports never change.", section: "colours", keywords: ["colour blind", "colorblind", "deuteranopia", "protanopia", "tritanopia", "greyscale", "grayscale", "accessibility", "simulate"] },
  layouts: { what: "Save the current arrangement of the window's panels under a name, and switch back to it later.", section: "interface", keywords: ["workspace", "panels", "dock", "arrangement"] },
  "reset-layout": { what: "Put every panel back to the position and size it started at.", section: "interface", keywords: ["restore", "default panels"] },
  "reset-toolbar": { what: "Put the toolbar's buttons and groups back in their default order.", section: "interface", keywords: ["restore toolbar", "default buttons"] },

  // ── Graph ───────────────────────────────────────────────────────────────────────
  "new-graph-create": { what: "Open the creator to make a new graph — the same door as File ▸ New datasheet / graph.", section: "new-graph", keywords: ["create chart", "wizard"] },
  gallery: { what: "Browse every chart type as a live card, then start from the one you want.", section: "graphs", keywords: ["chart types", "examples", "catalogue", "browse"] },
  "new-graph": { what: "Draw a new graph straight from the datasheet in front, without going through the creator.", section: "new-graph", keywords: ["chart this data", "graph this table"] },
  "clone-graph": { what: "Copy this graph, keeping its styling, so you can vary one without losing the other.", section: "new-graph", keywords: ["copy graph", "duplicate chart"] },
  "split-graph": { what: "Make one small graph per series, on the same axis range, laid out on a new figure page; they follow the original.", section: "new-graph", keywords: ["small multiples", "facet", "one graph per series", "split graph"] },
  "detach-small-graph": { what: "Stop a small graph following its original, so it can be edited on its own.", section: "new-graph", keywords: ["unlink small graph", "small multiples"] },
  "apply-look": { what: "Copy this graph's whole look onto other graphs you choose.", section: "presets", keywords: ["copy style", "homogenise", "match", "same look"] },
  "copy-picture": { what: "Put the graph or figure in front on the clipboard as a PNG — the picture the Export dialog would start with — ready to paste into a slide or a document.", section: "export", keywords: ["clipboard", "copy image", "paste", "powerpoint", "word", "slide", "picture"] },
  "copy-svg": { what: "Put the graph or figure in front on the clipboard as SVG markup, for a vector editor or a web page.", section: "export", keywords: ["clipboard", "vector", "svg markup", "inkscape", "illustrator"] },

  // ── Design ──────────────────────────────────────────────────────────────────────
  "design-sig-brackets": { what: "Draw significance brackets straight from an analysis's pairwise comparisons, with their p-values.", section: "significance", keywords: ["stars", "asterisks", "p value", "comparison bars"] },
  "design-sig-letters": { what: "Label the groups with compact-letter-display letters from an analysis: groups sharing a letter did not differ.", section: "significance", keywords: ["cld", "compact letter display", "abc"] },
  "design-sig-bracket": { what: "Add an empty significance bracket, then pick its two groups and its p in the Inspector.", section: "significance", keywords: ["manual bracket", "star", "asterisk"] },
  "design-sig-options": { what: "Set the p thresholds, the symbols they print and how 'not significant' is written.", section: "significance", keywords: ["alpha", "cutoff", "threshold", "ns", "stars"] },
  "design-text": { what: "Put a text box on the graph, then drag it where you want it and type into it.", section: "annotations", keywords: ["label", "caption", "annotate", "note"] },
  "design-arrow": { what: "Put an arrow on the graph; drag either end to point it at what you mean.", section: "annotations", keywords: ["pointer", "annotate"] },
  "design-segment": { what: "Put a straight line on the graph; drag either end to place it.", section: "annotations", keywords: ["rule", "stroke", "annotate"] },
  "design-rect": { what: "Put a rectangle on the graph — an outline or a filled box, to frame part of the plot.", section: "annotations", keywords: ["rectangle", "frame", "annotate"] },
  "design-highlight": { what: "Shade a rectangular region of the graph, the way a highlighter pen would.", section: "annotations", keywords: ["shade", "marker pen", "annotate"] },
  "design-ellipse": { what: "Put an ellipse or a circle on the graph, to ring a group of points.", section: "annotations", keywords: ["circle", "oval", "annotate"] },
  "design-callout": { what: "Put a callout on the graph — a text bubble with a pointer you aim at one feature.", section: "annotations", keywords: ["speech bubble", "annotate"] },
  "design-hline": { what: "Draw a horizontal reference line at a value you choose.", section: "annotations", keywords: ["threshold", "baseline", "cutoff line"] },
  "design-vline": { what: "Draw a vertical reference line at a value you choose.", section: "annotations", keywords: ["threshold", "marker line"] },
  "design-vband": { what: "Shade a vertical band between two X values.", section: "annotations", keywords: ["zone", "region", "shaded range"] },
  "design-hband": { what: "Shade a horizontal band between two Y values.", section: "annotations", keywords: ["zone", "reference range", "normal range"] },

  // ── Help ────────────────────────────────────────────────────────────────────────
  welcome: { what: "Go back to the welcome page — the doors into a new project, the gallery and this manual.", section: "workspace", keywords: ["home", "start", "landing"] },
  guide: { what: "Open this manual — how the program works, plus the index of every function and where to press it.", section: "overview", keywords: ["help", "docs", "documentation", "manual", "how to", "f1"] },
  "tour-first-graph": { what: "Run the first-graph walkthrough inside the program: the window dims, the next control to press lights up, and each step completes when you have done it. Nothing is locked while it runs.", section: "guided-tours", keywords: ["tour", "tutorial", "walkthrough", "guided", "beginner", "learn", "show me"] },
  "tour-datasheet": { what: "A guided tour of the datasheet: add a column and type into it, select values and exclude them so every graph and analysis skips them, then bring them back.", section: "guided-tours", keywords: ["tour", "tutorial", "walkthrough", "guided", "learn"] },
  "tour-axes": { what: "A guided tour of the Axis tab on the graph in front: set the range, space the tick marks, add minor ticks, and cut the axis.", section: "guided-tours", keywords: ["tour", "tutorial", "walkthrough", "guided", "learn"] },
  "tour-looks": { what: "A guided tour of a graph's look: grid lines, the frame style, the paper colour behind the graph, and a style preset.", section: "guided-tours", keywords: ["tour", "tutorial", "walkthrough", "guided", "learn"] },
  "tour-series": { what: "A guided tour of one series: its colour, marker shape, how its points are joined, its line thickness, then a fitted curve through it.", section: "guided-tours", keywords: ["tour", "tutorial", "walkthrough", "guided", "learn"] },
  "tour-annotate": { what: "A guided tour of annotations on the graph in front: a text box, an arrow and a shaded band, each a real object that moves and exports with the graph.", section: "guided-tours", keywords: ["tour", "tutorial", "walkthrough", "guided", "learn"] },
  "tour-dose-response": { what: "A guided tour of the dose–response front door: open it on a graph, fit a four-parameter logistic in one press, and read the EC50 in the result tab.", section: "guided-tours", keywords: ["tour", "tutorial", "walkthrough", "guided", "learn"] },
  "tour-figure": { what: "A guided tour of multi-panel figures: make a figure, pick two graphs as panels, arrange them, and export them as one image.", section: "guided-tours", keywords: ["tour", "tutorial", "walkthrough", "guided", "learn"] },
  "tour-compare": { what: "A guided tour from a Column sheet to a t test or ANOVA, the significance markers bound to it, and how the brackets look.", section: "guided-tours", keywords: ["tour", "tutorial", "walkthrough", "guided", "learn"] },
  "save-manual": { what: "Write the whole manual out as one self-contained HTML file you can keep, print or send. It is the same file this tab shows.", section: "help", keywords: ["manual", "documentation", "offline", "html", "print"] },
  "report-bug": { what: "Write up a problem with the diagnostics attached. Nothing is uploaded — you copy the report and send it yourself.", section: "help", keywords: ["feedback", "issue", "crash", "problem"] },
  about: { what: "The version, the licence, how to cite MadY, and who wrote it.", section: "licence", keywords: ["version", "credits", "citation", "copyright"] },
};

/**
 * What each Inspector section is for, and which chapter explains it.
 *
 * The Inspector is where nearly every visual decision is made: hundreds of control rows behind
 * its tabs and collapsible headings, none of them named anywhere a search could otherwise
 * reach. It is indexed per section — the heading you open — with the rows named in the
 * chapter's prose.
 *
 * The tab is not written here. `tabForSection()` is the app's own routing (it decides which
 * tab shows a section), so the index reads it rather than keeping a second copy that could send
 * a reader to the wrong tab.
 *
 * Default-deny: `guideIndex.test.ts` reads every `<Section title=…>` out of `Inspector.tsx` and
 * fails on a section with no row here.
 */
export const INSPECTOR_DOCS: Record<string, { what: string; section: string; keywords?: string[] }> = {
  Series: { what: "Which datasets are drawn, in what order, and whether each one is shown. Also where series borrowed from a second datasheet are added.", section: "styling", keywords: ["datasets", "hide series", "order", "second sheet", "overlay"] },
  "Chart type": { what: "Change what kind of graph this is, without losing the styling or the data behind it.", section: "graphs", keywords: ["change chart", "switch type", "kind"] },
  "Colour scheme": { what: "The palette every series takes its colour from, and the colourblind-safe choices.", section: "colours", keywords: ["palette", "okabe-ito", "viridis", "colourblind", "recolour"] },
  "Style preset": { what: "One click restyles the whole graph — fonts, axes, grid and palette. Also where you save the current look as your own preset (with the graph type's own settings, if you leave the tick on), add a type to a preset, set which one new graphs start from, and export or import a preset as a file.", section: "presets", keywords: ["theme", "house style", "default look", "journal", "export preset", "import preset", "bar width"] },
  "Graph size": { what: "The figure's width and height in pixels, and the journal widths to fit.", section: "moving", keywords: ["width", "height", "size", "dimensions", "resize"] },
  "Plot margins": { what: "The white space between the plot and the edge of the figure, on each side.", section: "moving", keywords: ["padding", "whitespace", "inset", "border space"] },
  "Pie chart": { what: "Slice order, the hole in the middle, exploded slices, and what each slice's label says.", section: "graphs", keywords: ["donut", "slice", "explode", "percent"] },
  "Survival (Kaplan-Meier)": { what: "Censor ticks, the confidence band, the numbers-at-risk table and whether the curve climbs or falls.", section: "graphs", keywords: ["kaplan", "censor", "at risk", "survival curve"] },
  "3-D scatter": { what: "The viewing angle, the depth cue and the cube's edges for a three-dimensional scatter.", section: "graphs", keywords: ["3d", "rotate", "perspective", "cube"] },
  "Radar chart": { what: "The spokes, the rings, whether the area is filled, and where the first axis points.", section: "graphs", keywords: ["spider", "web", "polar", "spokes"] },
  "Parallel coordinates": { what: "The axes each line crosses, how they are scaled, and how the lines are bundled.", section: "graphs", keywords: ["parallel", "multivariate", "lines"] },
  "Colour bar (legend)": { what: "The continuous colour scale beside a heatmap or a value-coloured chart — its position, size, ticks and title.", section: "legend", keywords: ["scale bar", "gradient legend", "ramp", "key"] },
  "Fit parameters": { what: "What the fitted-curve readout prints on the graph — the equation, R², the parameters and their confidence limits.", section: "curvefit", keywords: ["equation", "r2", "ec50", "parameters", "readout"] },
  Image: { what: "A picture used as a panel: how it is fitted, rotated, cropped, and its alt text.", section: "figures", keywords: ["photo", "crop", "rotate", "micrograph", "gel"] },
  Treemap: { what: "How the rectangles are laid out and nested, and what each tile's label says.", section: "graphs", keywords: ["tiles", "nested", "hierarchy"] },
  "Correlation matrix": { what: "Which half of the matrix is drawn, how each cell is shown, and whether the coefficient is printed in it.", section: "graphs", keywords: ["corrmatrix", "triangle", "coefficients"] },
  "Alluvial / parallel sets": { what: "The stages, the gap between them, and how the ribbons are ordered and curved.", section: "graphs", keywords: ["sankey", "flow", "ribbons", "stages"] },
  "Network graph": { what: "How the nodes are laid out, what sizes and colours them, and how the edges are drawn.", section: "graphs", keywords: ["nodes", "edges", "layout", "graph", "correlation network"] },
  Heatmap: { what: "The colour scale, the cell shape, clustering and dendrograms, the row and column strips, and the labels.", section: "graphs", keywords: ["cells", "cluster", "dendrogram", "tiles", "bubble grid", "strips"] },
  "Grid, frame & axes": { what: "The gridlines, the box around the plot, and which edges carry a line and ticks.", section: "axes", keywords: ["gridlines", "box", "border", "spines", "frame"] },
  Background: { what: "What sits behind the plot — a colour, or none at all.", section: "colours", keywords: ["backdrop", "paper", "fill", "transparent"] },
  "Title & legend": { what: "The graph's title and footer, and where the legend goes — including outside the plot on the right or in a row above it.", section: "legend", keywords: ["heading", "caption", "key", "legend position", "outside top", "footer"] },
  Annotations: { what: "Every object drawn on top of this graph, listed — select, reorder, lock or delete one.", section: "annotations", keywords: ["objects", "list", "arrows", "text boxes", "reference lines"] },
  "Significance brackets": { what: "The comparison bars and their stars: which groups each spans, the p it prints, and how high it sits.", section: "significance", keywords: ["stars", "asterisks", "p value", "comparison", "ladder"] },
  "Confidence ellipse": { what: "The ellipse drawn round a group of points, and how much of the group it covers.", section: "annotations", keywords: ["ellipse", "cluster", "95%", "pca"] },
  "Fitted curve": { what: "How a fitted line or curve is drawn, and whether its confidence and prediction bands show.", section: "curvefit", keywords: ["regression line", "trend", "band", "confidence band"] },
  "Bubble size legend": { what: "The key that says what a bubble's size means, and which values it shows.", section: "legend", keywords: ["size key", "bubble", "area", "legend"] },
  "Homogenise type across graphs": { what: "Push this graph's look onto every other graph of the same kind.", section: "presets", keywords: ["match", "copy style", "same look", "apply to all"] },
};

/**
 * The Axis tab's groups. The one panel with no `<Section>`s of its own — and the test of this
 * whole index (a search for "axis" must answer where axis tuning is), so its
 * groups are indexed individually rather than as one "Axis" entry.
 */
export const AXIS_DOCS: Record<string, { what: string; keywords?: string[] }> = {
  Scale: { what: "Linear, log, square-root, probability or a reversed axis.", keywords: ["log", "log10", "ln", "sqrt", "reverse", "probit", "logarithmic"] },
  Range: { what: "The lowest and highest value the axis shows. Leave either blank to fit the data.", keywords: ["minimum", "maximum", "limits", "bounds", "zoom", "from to"] },
  Ticks: { what: "How far apart the tick marks are, how long they are, and which way they point.", keywords: ["interval", "spacing", "minor ticks", "tick length", "direction"] },
  Numbering: { what: "How the numbers on the axis are written — decimals, thousands separators, scientific notation, prefixes and suffixes.", keywords: ["decimals", "format", "scientific", "units", "percent", "comma"] },
  Fonts: { what: "The font of this axis's title and of its tick labels — family, size, bold, italic and colour.", keywords: ["font", "size", "tick labels", "axis title", "bold", "italic", "colour"] },
  // Note: this is not the offset-axis look (that is Frame ▸ the frame shape). The app's own note says it:
  // "The width / height of the plotting area. Or drag the right end of the X axis on the graph."
  "Axis length": { what: "The width (on X) or height (on Y) of the plotting area itself. Leave it on auto to fit the figure, or drag the end of the axis on the graph.", keywords: ["plot width", "plot height", "plot size", "longer", "shorter", "length"] },
  "Axis line": { what: "The axis's own colour and thickness, and whether it is drawn at all.", keywords: ["colour", "thickness", "hide axis", "spine"] },
  Spacing: { what: "The gap between the numbers and the axis line, and between the axis and its title.", keywords: ["gap", "padding", "label distance", "title distance"] },
  "Category groups": { what: "Brackets under a category axis that gather the groups into named blocks.", keywords: ["groups", "super labels", "brackets", "nested categories"] },
  "Category labels": { what: "The names along a category axis — their angle, wrapping, and which ones are shown.", keywords: ["rotate labels", "angle", "wrap", "tilt", "skip labels"] },
  "Breaks (cuts)": { what: "Cut a stretch out of the axis, so a wide empty band does not squash the data.", keywords: ["axis break", "gap", "cut", "discontinuity", "broken axis"] },
  "Custom ticks": { what: "Put a tick exactly where you want it, with the text you want on it.", keywords: ["manual ticks", "own labels", "named ticks"] },
  "Shaded bands": { what: "Stripes of colour behind the plot, at values on this axis.", keywords: ["zone", "band", "reference range", "normal range", "shading"] },
  "Series on this axis": { what: "Which datasets are measured against this axis — how a second Y axis gets its data.", keywords: ["second y", "dual axis", "right axis", "assign series"] },
};

/**
 * The toolbar's twelve buttons. Their tooltips live in `chrome.tsx` (they change with state —
 * "Save — you have unsaved changes"), so what the index needs is the stable name a reader would
 * use for the button, plus the sentence saying what it is for.
 *
 * Default-deny over `HOME_GROUP`, which is the toolbar's own runtime enumeration of every id.
 */
export const TOOLBAR_DOCS: Record<ToolbarItemId, { name: string; what: string; section: string }> = {
  "new-project": { name: "New project", what: "Start a new, empty project.", section: "saving" },
  open: { name: "Open", what: "Open a saved project, or a data file, from disk.", section: "saving" },
  save: { name: "Save", what: "Save the project. A dot on the icon means there are unsaved changes.", section: "saving" },
  export: { name: "Export", what: "Export the graph, figure or datasheet in front to a file.", section: "export" },
  undo: { name: "Undo", what: "Undo the last change you made.", section: "workspace" },
  redo: { name: "Redo", what: "Put back a change you have just undone.", section: "workspace" },
  import: { name: "Import", what: "Import a data file into a new datasheet.", section: "import" },
  "new-dataset": { name: "New datasheet", what: "Add an empty datasheet to the project.", section: "new-datasheet" },
  "duplicate-data": { name: "Duplicate datasheet", what: "Make a second copy of the datasheet in front.", section: "sort-freeze" },
  analyze: { name: "Analyze", what: "Open the analysis chooser for the datasheet in front.", section: "choosing" },
  design: { name: "Design", what: "The significance markers and objects you can draw on this graph.", section: "annotations" },
  magic: { name: "Apply this look", what: "Copy this graph's whole look onto other graphs you pick.", section: "presets" },
};

/**
 * The words a reader would type looking for a whole tab rather than one of its sections —
 * "font size" is a Text-tab question, and no section is called that.
 */
const TAB_KEYWORDS: Record<string, string[]> = {
  chart: ["chart type", "kind of graph", "switch chart"],
  frame: ["margins", "gridlines", "box", "plot size", "legend position"],
  axis: ["axis", "axes", "scale", "range", "ticks", "log", "breaks"],
  data: ["colour", "symbol", "marker", "line", "fill", "error bar", "per point"],
  text: ["font", "font size", "typeface", "bold", "italic", "title text", "label size", "tick label"],
  annotate: ["annotation", "arrow", "text box", "reference line", "bracket", "star"],
  style: ["preset", "theme", "template", "house style", "look"],
};

/**
 * The other routes to a command.
 *
 * Several commands can be reached from somewhere the registry knows nothing about — the
 * datasheet's right-click, a tickbox in the graph toolbar. Those routes belong on the same
 * entry, not on a second one: a hand-written entry repeating a derived one would list the
 * command twice in "Where is everything", under one menu path. One function, one entry, all
 * its routes.
 */
const EXTRA_WHERE: Record<string, GuideWhere[]> = {
  "exclude-values": [{ via: "context", on: "a selected value", item: "Exclude value" }],
  "include-values": [{ via: "context", on: "a selected value", item: "Include value" }],
  "sort-data": [{ via: "context", on: "a column header", item: "Sort ascending / Sort descending" }],
  "graph-ruler": [{ via: "toolbar", button: "Ruler (in the graph toolbar)" }],
  "copy-picture": [{ via: "context", on: "a graph", item: "Copy as picture" }],
  "copy-svg": [{ via: "context", on: "a graph", item: "Copy as SVG" }],
  "copy-cells": [{ via: "context", on: "a selected block", item: "Copy" }],
  "cut-cells": [{ via: "context", on: "a selected block", item: "Cut" }],
  "paste-cells": [{ via: "context", on: "a selected block", item: "Paste" }],
};

/**
 * The entries no registry holds.
 *
 * Everything above is derived from a list the program already keeps. These are not: they live in
 * event handlers, in a right-click menu, in a ribbon's JSX. They are also the ones a user is
 * least likely to find on their own — nothing in a menu tells you that a printable keystroke
 * starts editing a cell, or that you can drag an axis's end to shorten it.
 *
 * Each of these matches a handler in the code; `guide.test.ts` holds the keys to those handlers.
 * The manual must not claim a find/replace keystroke in the datasheet (find & replace is on the
 * Data menu) or a middle-button zoom — neither exists.
 */
const HAND_WRITTEN: GuideEntry[] = [
  // ── working in the datasheet ───────────────────────────────────────────────────
  {
    id: "sheet:select",
    name: "Select a block of cells",
    what: "Click a cell and drag, or hold Shift and use the arrow keys, to select a rectangle of cells.",
    where: [{ via: "sheet", gesture: "drag across the cells, or Shift+arrows from the one you are on" }],
    keywords: ["selection", "range", "block", "highlight cells", "shift"],
    section: "select-copy",
  },
  {
    id: "sheet:type-to-edit",
    name: "Start typing to replace a cell",
    what: "With a cell selected, any letter or digit begins editing and replaces what was there — the way a spreadsheet works. Enter or F2 opens it keeping the old value.",
    where: [{ via: "sheet", gesture: "select a cell and just type" }, { via: "keys", keys: "Enter / F2" }],
    keywords: ["edit cell", "overwrite", "type", "f2"],
    section: "spreadsheet",
  },
  {
    id: "sheet:fill-down",
    name: "Fill down",
    what: "Copy the top row of the selected block into every row below it.",
    // Ctrl+D really does two things — fill down in the sheet, duplicate an object on a figure —
    // so each says where it applies. An unqualified "Ctrl+D" on both rows would leave a reader
    // reading the key table unable to tell which one they were about to get.
    where: [{ via: "keys", keys: "Ctrl+D (in the datasheet)" }, { via: "sheet", gesture: "select a block, then Ctrl+D" }],
    keywords: ["repeat", "copy down", "autofill"],
    section: "select-copy",
  },
  {
    id: "sheet:transpose-block",
    name: "Transpose a block in place",
    what: "Flip the selected rectangle of cells so its rows become columns, without making a new datasheet.",
    where: [{ via: "keys", keys: "Ctrl+Shift+T" }],
    keywords: ["flip", "rotate", "swap rows columns"],
    section: "select-copy",
  },
  {
    id: "sheet:paste-transposed",
    name: "Paste transposed",
    what: "Paste the clipboard with its rows and columns swapped.",
    where: [{ via: "context", on: "a selected block", item: "Paste transposed" }],
    keywords: ["flip paste", "pivot", "rotate"],
    section: "select-copy",
  },
  {
    id: "sheet:insert-column",
    name: "Insert or delete a column",
    what: "Add a column either side of the one you clicked, or remove it.",
    where: [{ via: "context", on: "a column header", item: "Insert column left / Insert column right / Delete column" }],
    keywords: ["add column", "remove column", "new column"],
    section: "rows-cols",
  },
  {
    id: "sheet:insert-row",
    name: "Insert or delete a row",
    what: "Add a row above or below the one you clicked, or remove it.",
    where: [{ via: "context", on: "a row number", item: "Insert row above / Insert row below / Delete row" }],
    keywords: ["add row", "remove row", "new row"],
    section: "rows-cols",
  },
  {
    id: "sheet:column-type",
    name: "Column type and decimals",
    what: "Say whether a column holds numbers, text or dates, and how many decimal places its numbers show.",
    where: [{ via: "context", on: "a column header", item: "Type / Decimals" }],
    keywords: ["number format", "date column", "text column", "precision", "decimal places"],
    section: "spreadsheet",
  },
  {
    id: "sheet:column-formula",
    name: "Column formula",
    what: "Compute a column from the others with an expression, and it recalculates when the data changes.",
    where: [{ via: "context", on: "a column header", item: "Column formula" }],
    keywords: ["calculated column", "expression", "derive", "computed"],
    section: "spreadsheet",
  },
  {
    id: "sheet:x-column",
    name: "Use a column as X (or as row labels)",
    what: "Make the column you clicked the one every graph plots along X — or, on a variables sheet, the one that names each row.",
    where: [{ via: "context", on: "a column header", item: "Use as X axis / Use as row labels" }],
    keywords: ["x column", "row names", "labels column", "independent variable"],
    section: "rows-cols",
  },
  {
    id: "sheet:format-chip",
    name: "Table format",
    what: "The sheet's shape — XY, column, grouped, contingency, survival and the rest. It decides which analyses and which graphs the sheet can produce.",
    where: [{ via: "sheet", gesture: "the dropdown at the top-left of the datasheet, beside its name" }],
    keywords: ["kind", "shape", "layout", "change format", "chip"],
    section: "formats",
  },
  {
    id: "sheet:add-column",
    name: "Column (add one)",
    what: "Add a column to the end of the datasheet.",
    where: [{ via: "sheet", gesture: "the ＋ Column button above the sheet" }],
    keywords: ["new column", "add", "more data"],
    section: "rows-cols",
  },
  {
    id: "sheet:entry-mode",
    name: "Data entry mode",
    what: "Whether each Y dataset holds raw replicates (the mean and error are computed for you) or a mean with an error and n you have already worked out.",
    where: [{ via: "sheet", gesture: "the Entry dropdown above the sheet" }],
    keywords: ["replicates", "mean sd n", "summary data", "sem", "pre-computed"],
    section: "formats",
  },
  {
    id: "sheet:replicates",
    name: "Number of replicates",
    what: "How many side-by-side subcolumns each Y dataset has.",
    where: [{ via: "sheet", gesture: "the −/+ replicate buttons above the sheet" }],
    keywords: ["subcolumns", "repeats", "n", "triplicate"],
    section: "rows-cols",
  },
  {
    id: "sheet:x-error",
    name: "X error",
    what: "Add a shared X-error subcolumn, drawn as a horizontal ± cap on every point.",
    where: [{ via: "sheet", gesture: "the X-error button above the sheet" }],
    keywords: ["horizontal error", "x error bars", "uncertainty"],
    section: "rows-cols",
  },
  {
    id: "sheet:survival-dates",
    name: "Survival times from dates",
    what: "Enter a start and an end date instead of an elapsed time, and choose the unit the span is computed in.",
    where: [{ via: "sheet", gesture: "the Survival time entry dropdown above the sheet" }],
    keywords: ["kaplan", "dates", "follow-up", "elapsed", "days months years"],
    section: "rows-cols",
  },
  {
    id: "sheet:freeze",
    name: "Freeze the table",
    what: "Make the datasheet read-only, so its data cannot be changed by accident.",
    where: [{ via: "sheet", gesture: "the padlock button above the sheet" }],
    keywords: ["lock", "read only", "protect", "prevent editing"],
    section: "sort-freeze",
  },
  {
    id: "sheet:linked-file",
    name: "Linked file — refresh or unlink",
    what: "A datasheet imported from a file that is still being watched: re-read it now, or stop auto-updating and keep what is there.",
    where: [{ via: "sheet", gesture: "the linked-file chip above the sheet" }],
    keywords: ["reload", "re-import", "auto update", "watch file", "unlink"],
    section: "import",
  },
  {
    id: "sheet:cell-colour",
    name: "Colour and pattern a cell",
    what: "Give cells a background colour or a pattern, to mark them up in the sheet. Neither changes the numbers or reaches the graph.",
    where: [{ via: "context", on: "a selected block", item: "Fill colour / Pattern" }],
    keywords: ["highlight", "background", "shade cells", "mark up", "hatching"],
    section: "cellcolour",
  },

  // ── working on the figure ──────────────────────────────────────────────────────
  {
    id: "figure:select",
    name: "Select something on the graph",
    what: "Click any part of the figure — a point, a bar, an axis, the title, the legend, an annotation — and the Inspector switches to the controls for it. Escape deselects.",
    where: [{ via: "figure", gesture: "click the thing you want to change" }, { via: "keys", keys: "Esc" }],
    keywords: ["click", "pick", "target", "deselect", "direct manipulation"],
    section: "styling",
  },
  {
    id: "figure:select-axis",
    name: "Open the controls for one axis",
    what: "Click an axis on the graph — its line, its numbers or its title — and the Inspector switches to the Axis tab for that axis: scale, range, ticks, numbering, breaks and the rest.",
    where: [{ via: "figure", gesture: "click the axis, then use the Axis tab" }],
    keywords: ["axis", "x axis", "y axis", "second y", "select axis", "axis controls"],
    section: "axes",
  },
  {
    id: "figure:edit-text",
    name: "Edit text in place",
    what: "Double-click a title, an axis title, a tick label, a legend name or an annotation and type straight onto the figure.",
    where: [{ via: "figure", gesture: "double-click the words you want to change" }],
    keywords: ["rename", "retype", "inline edit", "title", "caption"],
    section: "text",
  },
  {
    id: "figure:drag",
    name: "Move something by dragging it",
    what: "Titles, legends, annotations, data labels and the fit readouts can all be dragged where you want them. The position is saved with the graph and is undoable.",
    where: [{ via: "figure", gesture: "drag the thing" }],
    keywords: ["move", "reposition", "drag", "place", "nudge"],
    section: "moving",
  },
  {
    id: "figure:nudge",
    name: "Nudge the selected object",
    what: "Move the selected annotation one pixel with an arrow key, or ten with Shift.",
    where: [{ via: "keys", keys: "Arrows / Shift+arrows" }],
    keywords: ["move", "fine", "precise", "arrow keys"],
    section: "annotations",
  },
  {
    id: "figure:resize",
    name: "Resize the figure by dragging",
    what: "The corner handles change the whole figure's size; the exact numbers are in Frame ▸ Graph size.",
    where: [{ via: "figure", gesture: "drag a corner handle" }],
    keywords: ["bigger", "smaller", "dimensions", "width", "height", "handles"],
    section: "moving",
  },
  {
    id: "figure:axis-length",
    name: "Resize the plot by dragging an axis end",
    what: "Select an axis and drag its end to set how wide (X) or tall (Y) the plotting area is. The same number is in Axis ▸ Axis length.",
    where: [{ via: "figure", gesture: "select an axis, then drag the right end of X or the top of Y" }],
    keywords: ["plot width", "plot height", "stretch", "plot size", "longer axis"],
    section: "axes",
  },
  {
    id: "figure:delete-annotation",
    name: "Delete or duplicate an object",
    what: "Delete removes the selected annotation; Ctrl+D makes a copy of it. Labels the graph draws for itself cannot be deleted — hide them with their own control instead.",
    where: [{ via: "keys", keys: "Delete" }, { via: "keys", keys: "Ctrl+D (on a figure)" }],
    keywords: ["remove", "copy", "duplicate", "annotation"],
    section: "annotations",
  },
  {
    id: "figure:zoom",
    name: "Zoom into the plot",
    what: "Zoom with the ± buttons or Ctrl+= / Ctrl+−, reset with Ctrl+0, and turn on Wheel zoom in the graph toolbar to use the scroll wheel. Ctrl+wheel magnifies the part under the pointer.",
    where: [
      { via: "figure", gesture: "the zoom controls at the bottom right, or the Wheel zoom tickbox in the graph toolbar" },
      { via: "keys", keys: "Ctrl+= / Ctrl+− / Ctrl+0" },
    ],
    keywords: ["magnify", "scroll", "wheel", "pan", "reset view", "fit"],
    section: "moving",
  },

  // ── the graph toolbar (the ribbon above a graph) ───────────────────────────────
  {
    id: "ribbon:reset-view",
    name: "Reset view",
    what: "Zoom back to 100% and pan back to the whole of the data. Double-clicking the plot does the same.",
    where: [{ via: "toolbar", button: "Reset view (in the graph toolbar)" }],
    keywords: ["zoom out", "fit", "unzoom", "whole data"],
    section: "ribbon",
  },
  {
    id: "ribbon:grid",
    name: "Grid · Minor",
    what: "Show gridlines behind the plot, and the finer minor lines between them.",
    where: [{ via: "toolbar", button: "Grid / Minor (in the graph toolbar)" }],
    keywords: ["gridlines", "guides", "background lines"],
    section: "ribbon",
  },
  {
    id: "ribbon:legend",
    name: "Legend (show or hide)",
    what: "Turn the key on or off. Where it goes is set in Frame ▸ Title & legend.",
    where: [{ via: "toolbar", button: "Legend (in the graph toolbar)" }],
    keywords: ["key", "hide legend", "show legend"],
    section: "legend",
  },
  {
    id: "ribbon:log",
    name: "X log · Y log",
    what: "Put either axis on a log₁₀ scale in one click. The full set of scales is in the Axis tab.",
    where: [{ via: "toolbar", button: "X log / Y log (in the graph toolbar)" }],
    keywords: ["logarithmic", "log10", "decades", "scale"],
    section: "ribbon",
  },
  {
    id: "ribbon:values",
    name: "Values",
    what: "Print each bar's value as a label on it.",
    where: [{ via: "toolbar", button: "Values (in the graph toolbar)" }],
    keywords: ["data labels", "numbers on bars", "annotate values"],
    section: "ribbon",
  },
  {
    id: "ribbon:points",
    name: "Points",
    what: "Show every replicate as a dot over its own bar. Click a dot to style the points like any other data points.",
    where: [{ via: "toolbar", button: "Points (in the graph toolbar)" }],
    keywords: ["replicates", "dots", "scatter over bars", "show data"],
    section: "ribbon",
  },
  {
    id: "ribbon:frame",
    name: "Frame shape",
    what: "The lines around the plot: an L, a full box, offset axes, or none.",
    where: [{ via: "toolbar", button: "Frame (in the graph toolbar)" }],
    keywords: ["box", "l-shape", "spines", "border", "offset"],
    section: "ribbon",
  },
  {
    id: "ribbon:insert",
    name: "Insert (text, shapes, images)",
    what: "Put a text box, caption, line, arrow, shape or an image (PNG / JPG / SVG) onto the graph.",
    where: [{ via: "toolbar", button: "Insert (in the graph toolbar)" }],
    keywords: ["annotate", "add text", "add image", "picture", "arrow", "shape"],
    section: "annotations",
  },
  {
    id: "ribbon:text",
    name: "Text style (font, size, bold, symbols)",
    what: "Pick a text element of the graph and set its font, size, weight and slant — and insert a Greek letter or maths symbol into whatever you are typing.",
    where: [{ via: "toolbar", button: "Text (in the graph toolbar)" }],
    keywords: ["font", "typeface", "bold", "italic", "greek", "mu", "alpha", "symbol", "subscript"],
    section: "text",
  },
  {
    id: "ribbon:datasheet",
    name: "Datasheet (go to the data)",
    what: "Open the datasheet this graph is drawn from — both of them, when the graph borrows series from a second sheet.",
    where: [{ via: "toolbar", button: "Datasheet (in the graph toolbar)" }],
    keywords: ["source", "go to data", "back to table", "where is the data"],
    section: "ribbon",
  },

  // ── the panel assembler (a multi-panel figure) ─────────────────────────────────
  {
    id: "figurebar:layout",
    name: "Layout",
    what: "Pick an arrangement for the panels from a set of thumbnails.",
    where: [{ via: "toolbar", button: "Layout ▾ (the figure toolbar's first row)" }],
    keywords: ["grid", "arrangement", "tiling", "template", "panels"],
    section: "figures",
  },
  {
    id: "figurebar:columns",
    name: "Columns · Gutter",
    what: "How many columns the panels tile into, and the gap between them.",
    where: [{ via: "toolbar", button: "Columns / Gutter (the figure toolbar's first row)" }],
    keywords: ["grid", "spacing", "gap", "tile", "rows"],
    section: "figures",
  },
  {
    id: "figurebar:align",
    name: "Line up, space out and centre panels",
    what: "Shift-click two or more panels, then line up their edges or centres, space them evenly, or make them the same width or height; or centre a panel on the figure.",
    where: [{ via: "toolbar", button: "Line up ▾ (in the figure toolbar)" }],
    keywords: ["line up", "even spacing", "same size", "tidy", "distribute", "centre"],
    section: "figures",
  },
  {
    id: "figurebar:arrange",
    name: "Arrange (group, order, duplicate)",
    what: "Group panels so they move together, bring one in front of or behind another, or duplicate a panel.",
    where: [{ via: "toolbar", button: "Front · Back · Group · ⧉ (in the figure toolbar)" }],
    keywords: ["group", "front", "back", "z order", "duplicate"],
    section: "figures",
  },
  {
    id: "figurebar:free-drag",
    name: "Free drag",
    what: "Stop tiling the panels into a grid and place each one by hand.",
    where: [{ via: "toolbar", button: "Free drag (in the figure toolbar)" }],
    keywords: ["manual", "place", "move panels", "custom layout"],
    section: "figures",
  },
  {
    id: "figurebar:shared-axes",
    name: "Shared axes",
    what: "Label only the figure's outer edges: inner panels drop their repeated tick numbers and axis titles, and the freed space goes back to the drawing.",
    where: [{ via: "figure", gesture: "click empty canvas; the Inspector shows the Figure view — Panel content ▸ Shared axes" }],
    keywords: ["outer", "repeated labels", "tick labels", "declutter", "edge"],
    section: "figures",
  },
  {
    id: "figurebar:one-legend",
    name: "One legend",
    what: "Replace the panels' matching legends with a single merged key below the figure. Offered only when the legends really do match.",
    where: [{ via: "figure", gesture: "click empty canvas; the Inspector shows the Figure view — Panel content ▸ One legend" }],
    keywords: ["merged legend", "shared key", "one key", "legend"],
    section: "figures",
  },
  {
    id: "figurebar:guides",
    name: "Grid, Ruler and canvas zoom",
    what: "Editing aids for a panel figure: an alignment grid behind the panels, a ruler in pixels, inches or centimetres, and a zoom for the canvas. None of them is ever exported.",
    where: [{ via: "toolbar", button: "Grid · Snap to grid · Ruler · zoom (the figure toolbar's first row)" }],
    keywords: ["grid", "ruler", "measure", "zoom", "guides", "inches", "cm"],
    section: "figures",
  },
  {
    id: "figurebar:labels",
    name: "Panel labels (A B C)",
    what: "The lettering scheme — A B C, a b c, 1 2 3 or none — its font, size, bold and colour, and Renumber (re-letter in reading order).",
    where: [{ via: "figure", gesture: "click empty canvas; the Inspector shows the Figure view — Panel letters" }],
    keywords: ["letters", "lettering", "abc", "panel letter", "numbering", "renumber"],
    section: "figures",
  },
  {
    id: "figurebar:panels",
    name: "Graph titles, Card titles, Keep proportions",
    what: "Show each panel's own title inside the plot; show the graph's name in a working header that is never exported; and draw each panel as a true miniature instead of re-laying it out at card size.",
    where: [{ via: "figure", gesture: "click empty canvas; the Inspector shows the Figure view — Panel content" }],
    keywords: ["title", "card title", "miniature", "proportions", "font scale", "shrink"],
    section: "figures",
  },
  {
    id: "figurebar:insert",
    name: "Insert onto the figure (text, arrow, line, box, ellipse)",
    what: "Put an object on the figure itself rather than in a panel — a heading spanning two panels, an arrow from A to B. It belongs to the figure, so the graphs it was built from never carry it. The same menu adds another graph or a picture as a panel.",
    where: [{ via: "toolbar", button: "Insert ▾ (in the figure toolbar)" }],
    keywords: ["annotate figure", "text box", "arrow", "divider", "frame", "between panels"],
    section: "figures",
  },
  {
    id: "figurebar:object",
    name: "Object (style the selected figure object)",
    what: "Colour, fill, line width, font size and position for the figure object you have selected.",
    where: [{ via: "figure", gesture: "click the object on the figure; its settings are at the top of the Inspector" }],
    keywords: ["colour", "fill", "line width", "font size", "figure object"],
    section: "figures",
  },
  {
    id: "figurebar:lock",
    name: "Lock a panel",
    what: "Pin the selected panels where they stand — no drag, resize, nudge or remove. The graph inside stays fully editable.",
    where: [{ via: "toolbar", button: "the padlock in the figure toolbar's object tools" }],
    keywords: ["lock", "pin", "freeze position", "protect", "unlock"],
    section: "figures",
  },
  {
    id: "figurebar:preset",
    name: "Style preset for every panel",
    what: "Restyle every graph in the figure with one built-in look — fonts, axes, grid, palette and each chart type's own defaults — in one undoable step.",
    where: [{ via: "toolbar", button: "Style ▾ ▸ Style preset (in the figure toolbar)" }],
    keywords: ["restyle all", "look", "theme", "uniform"],
    section: "figures",
  },
  {
    id: "figurebar:house",
    name: "House style (figure templates)",
    what: "Save this figure's arrangement — columns, gutter, lettering, alignment, shared axes, merged legend — as a named template, and stamp the next figure with it.",
    where: [{ via: "toolbar", button: "Style ▾ ▸ House style (in the figure toolbar)" }],
    keywords: ["template", "reuse layout", "same figure", "paper style"],
    section: "figures",
  },
  {
    id: "figurebar:match",
    name: "Match to",
    what: "Copy one panel's look onto all the others — everything, or just its size, fonts, axes or colours — with any panel as the model.",
    where: [{ via: "toolbar", button: "Style ▾ ▸ Match every panel to (in the figure toolbar)" }],
    keywords: ["copy style", "same size", "same fonts", "consistent", "reference panel"],
    section: "figures",
  },
  {
    id: "figurebar:linked",
    name: "Linked to sources / Independent copy",
    what: "Whether styling a panel also restyles the graph it came from (linked, the default), or the panels are private copies. Switching back to linked discards the copies' own edits, and asks first.",
    where: [{ via: "toolbar", button: "the chip in the figure's header" }],
    keywords: ["linked", "independent", "copy", "detach", "source graph"],
    section: "figures",
  },

  // ── dialogs that are a place in their own right ────────────────────────────────
  {
    id: "dialog:save-parts",
    name: "Save part of a project",
    what: "Ctrl+S asks what to keep before it asks where: everything, one project folder, one experiment, or a single graph — written as its own project file, carrying the data it needs.",
    // Note: no menu route here. `action:save` already carries "File ▸ Save… · Ctrl+S", and two
    // entries naming one control is exactly what `guideIndex.test` refuses. This entry is
    // about the tick list the command opens — a different thing in a different place.
    where: [{ via: "dialog", name: "Save project", control: "the tick list" }],
    keywords: ["save part", "save one graph", "split", "extract", "share a graph"],
    section: "saving",
  },
  {
    id: "dialog:recovery",
    name: "Recover unsaved work",
    what: "After an unexpected close, the next launch offers the autosaved copy — naming the project and how old it is. Recovering never overwrites a file on disk; you still choose where to save.",
    where: [{ via: "dialog", name: "Recover unsaved work", control: "Recover / Discard" }],
    keywords: ["crash", "autosave", "lost work", "restore", "recovery"],
    section: "saving",
  },
  // ── the Settings dialog, one entry per group ──────────────────────────────────
  // The Inspector's rule, applied here for the same reason: sixteen rows named
  // `autosaveMs` would swamp every other answer, and the chapter names them all in prose.
  // Each row is still reachable, because its own words are keywords on its group.
  {
    id: "dialog:settings-newgraph",
    name: "Settings ▸ New-graph defaults",
    what: "What a new graph and a new datasheet assume: the default chart type, the default error bars, how an ambiguous typed date is read, and the words every import should treat as blank.",
    where: [{ via: "dialog", name: "Settings", control: "New-graph defaults" }],
    keywords: ["default graph type", "default error bars", "date entry format", "date order", "day month year", "dmy", "mdy", "missing values", "na", "null", "blank"],
    section: "settings",
  },
  {
    id: "dialog:settings-analysis",
    name: "Settings ▸ Analysis defaults",
    what: "The confidence level analyses report, how many significant figures results tables show on screen, and the per-method options you saved with Make default.",
    where: [{ via: "dialog", name: "Settings", control: "Analysis defaults" }],
    keywords: ["confidence", "90", "95", "99", "round", "rounding", "significant figures", "decimals", "precision", "make default", "saved defaults", "clear"],
    section: "settings",
  },
  {
    id: "dialog:settings-app",
    name: "Settings ▸ Application",
    what: "The preferences that take effect at once: light or dark theme, whether graphs are fitted to the window at startup, and autosave with its interval.",
    where: [{ via: "dialog", name: "Settings", control: "Application" }],
    keywords: ["theme", "dark mode", "light mode", "autosave", "interval", "startup", "fit graphs to the window", "580"],
    section: "settings",
  },
  {
    id: "dialog:export-size",
    name: "Export size (DPI, journal width, pixels)",
    what: "How large the exported file is: a resolution preset or your own DPI, a print width in millimetres with common journal columns offered, or plain pixels with the aspect ratio locked or unlocked.",
    where: [{ via: "dialog", name: "Export", control: "DPI / Print width / Size in pixels" }],
    keywords: ["dpi", "resolution", "300", "600", "column width", "millimetres", "pixels", "aspect ratio", "how big"],
    section: "export",
  },
];


/** The menu path of an action, as a reader would read it aloud. */
function menuPath(a: { menu: string; submenu?: string | undefined; label: string }): string {
  return a.submenu ? `${a.menu} ▸ ${a.submenu} ▸ ${a.label}` : `${a.menu} ▸ ${a.label}`;
}

/** A label without its trailing ellipsis — "Import data…" is the control, "Import data" the name. */
const bare = (label: string): string => label.replace(/…$/, "").trim();

/** Split an action's space-separated `keywords` string into the index's array form. */
const splitKeywords = (s: string | undefined): string[] => (s ? s.split(/\s+/).filter(Boolean) : []);

function derived(): GuideEntry[] {
  const out: GuideEntry[] = [];

  // ── every command in the registry ────────────────────────────────────────────────
  // The generated `new-table-<kind>` rows are folded into the table-format entries below:
  // the format registry says what each format is, which is the thing a reader needs, and a
  // second entry per format would only repeat its label.
  const formatKinds = new Set(tableFormatList().map((f) => `new-table-${f.kind}`));
  for (const a of actionCatalogue()) {
    if (formatKinds.has(a.id)) continue;
    const doc = ACTION_DOCS[a.id];
    if (!doc) continue; // the test fails on this; the index must not invent a description
    out.push({
      id: `action:${a.id}`,
      name: bare(a.label),
      what: doc.what,
      where: [{ via: "menu", path: menuPath(a), shortcut: a.shortcut }, ...(EXTRA_WHERE[a.id] ?? [])],
      keywords: [...splitKeywords(a.keywords), ...(doc.keywords ?? [])],
      section: doc.section,
    });
  }

  // ── the toolbar ──────────────────────────────────────────────────────────────────
  for (const id of Object.keys(HOME_GROUP) as ToolbarItemId[]) {
    const doc = TOOLBAR_DOCS[id];
    out.push({
      id: `tool:${id}`,
      name: doc.name,
      what: doc.what,
      where: [{ via: "toolbar", button: doc.name }],
      section: doc.section,
    });
  }

  // ── the Inspector: its tabs, its sections, and the Axis tab's groups ──────────────
  for (const t of INSPECTOR_TABS) {
    out.push({
      id: inspectorTabEntryId(t.id),
      name: `Inspector ▸ ${t.label}`,
      what: t.hint,
      where: [{ via: "inspector", tab: t.label as InspectorTab, section: "(the tab itself)" }],
      keywords: TAB_KEYWORDS[t.id],
      section: "styling",
    });
  }
  for (const title of INSPECTOR_SECTIONS) {
    const doc = INSPECTOR_DOCS[title];
    if (!doc) continue; // the test fails on this
    // The tab comes from the app's own routing, never from a second list here.
    const tab = INSPECTOR_TABS.find((t) => t.id === tabForSection(title))!;
    out.push({
      id: inspectorEntryId(title),
      name: title,
      what: doc.what,
      where: [{ via: "inspector", tab: tab.label as InspectorTab, section: title }],
      keywords: doc.keywords,
      section: doc.section,
    });
  }
  for (const title of AXIS_GROUPS) {
    const doc = AXIS_DOCS[title];
    if (!doc) continue; // the test fails on this
    out.push({
      id: axisEntryId(title),
      name: title,
      what: doc.what,
      // Note: no figure gesture here. Every axis group is reached the same way — click
      // the axis, open the tab — so repeating it for each group would fill the "on the figure"
      // table with one sentence over and over. It is one entry (`figure:select-axis`) instead.
      where: [{ via: "inspector", tab: "Axis", section: title }],
      keywords: ["axis", ...(doc.keywords ?? [])],
      section: "axes",
    });
  }

  // ── the how-tos: one entry per control row, for each surface `HOW_TO` covers ─────────────────
  //
  // This is the main purpose of the index. The entries above stop at the group, which answers
  // "where does axis tuning live" and cannot answer "how do I put a break in my axis" — that is
  // one row inside one group. A how-to row in the index is what makes the search box land on the
  // action itself, and what the "?" button can deep-link to.
  //
  // The name is the label on the control, because that is the word a reader types; the group is
  // carried in `where` (weight 6) and in the keywords, which is what keeps eight rows called
  // "Colour" apart in a result list.
  for (const h of HOW_TO) {
    out.push({
      id: `howto:${h.id}`,
      name: h.name,
      what: h.only ? `${h.what} ${h.how} Only there when: ${h.only}` : `${h.what} ${h.how}`,
      where: [{ via: "inspector", tab: HOW_TO_PAGE[h.surface].tab as InspectorTab, section: h.group, row: h.name }],
      keywords: [h.group, ...(h.keywords ?? [])],
      section: HOW_TO_PAGE[h.surface].chapter,
      ...(h.shot ? { shot: { file: h.shot.file, mark: h.shot.mark } } : {}),
    });
  }

  // ── table formats ────────────────────────────────────────────────────────────────
  // A format is what unlocks a sheet's analyses and chart types, so it is a function in its
  // own right: the reader's question is "which one do I pick", and `description` answers it.
  for (const f of tableFormatList()) {
    out.push({
      id: `format:${f.kind}`,
      name: `${f.label} table`,
      what: f.description,
      where: [
        { via: "menu", path: `Insert ▸ New table ▸ ${f.label} table` },
        { via: "dialog", name: "New datasheet / graph", control: f.label },
        { via: "sheet", gesture: `click the format chip above the sheet and pick “${f.label}”` },
      ],
      keywords: [...f.analyses, ...f.graphs],
      section: "formats",
    });
  }

  // ── analysis methods ─────────────────────────────────────────────────────────────
  for (const g of METHOD_GROUPS) {
    for (const m of g.methods) {
      const info = METHOD_INFO[m];
      if (!info) continue; // the test fails on this
      out.push({
        id: `method:${m}`,
        name: methodLabel(m),
        what: info.whenToUse,
        where: [{ via: "dialog", name: "Analyze", control: `${g.label} ▸ ${methodLabel(m)}` }],
        keywords: [g.label],
        section: "analysis",
      });
    }
  }

  // ── chart types ──────────────────────────────────────────────────────────────────
  // From the gallery's own cards: their titles and "when to use this chart" notes are already
  // written for a reader, and the cards are what the user actually clicks.
  for (const card of galleryItems()) {
    out.push({
      id: `chart:${card.key}`,
      name: card.title,
      what: card.note,
      where: [
        { via: "dialog", name: "Chart gallery", control: card.title },
        { via: "dialog", name: "New datasheet / graph", control: card.title },
        { via: "inspector", tab: "Chart", section: "Chart type", row: card.title },
      ],
      // `plot.kind` is optional in the model and defaults to "xy" everywhere it is read
      // (`buildScene`), so the index reads it the same way rather than losing the search term.
      keywords: [card.family, card.plot.kind ?? "xy"],
      section: "graphs",
    });
  }

  // ── the transform catalogue, by group ────────────────────────────────────────────
  // One entry per group, not per function: the dialog presents them grouped, and 52 entries
  // named "Y = log₁₀(Y)" would swamp every other answer. Each group's members are keywords,
  // so searching "reciprocal" still lands here.
  const groups = new Map<string, string[]>();
  for (const t of TRANSFORMS) {
    const list = groups.get(t.group) ?? [];
    list.push(t.label);
    groups.set(t.group, list);
  }
  for (const [group, labels] of groups) {
    out.push({
      id: `transform:${group.toLowerCase().replace(/\s+/g, "-")}`,
      name: `${group} transforms`,
      what: `${labels.length} functions you can apply to the values: ${labels.join(", ")}.`,
      where: [{ via: "dialog", name: "Transform values", control: group }],
      keywords: labels,
      section: "datamenu",
    });
  }

  // ── export formats ───────────────────────────────────────────────────────────────
  for (const f of [...PLOT_EXPORT_FORMATS, ...TABLE_EXPORT_FORMATS]) {
    const forPlot = PLOT_EXPORT_FORMATS.includes(f);
    out.push({
      id: `export:${f}`,
      name: EXPORT_FORMAT_LABEL[f],
      what: forPlot
        ? `Export a graph or a figure as ${f.toUpperCase()}.`
        : `Export a datasheet or a results table as ${f.toUpperCase()}.`,
      where: [{ via: "dialog", name: "Export", control: EXPORT_FORMAT_LABEL[f] }],
      keywords: [f, `.${f}`, forPlot ? "picture" : "data"],
      section: "export",
    });
  }

  return [...out, ...HAND_WRITTEN];
}

let cache: GuideEntry[] | null = null;

/**
 * The whole index. Memoised because `galleryItems()` rebuilds every sample table from scratch
 * — cheap once, wasteful on every keystroke in the search box.
 */
export function guideIndex(): GuideEntry[] {
  if (!cache) cache = derived();
  return cache;
}
