/**
 * The guided tours — the manual's walkthroughs run inside the program.
 *
 * A tour is a list of steps. For each one: where to shine the light (DOM anchors), what to say,
 * and how to know the reader has done it — read off the document, never off the click. Advancing
 * on the document means a step also completes when the reader takes another road to the same
 * place (Ctrl+Shift+V instead of the menu), and never completes when they pressed the button and
 * cancelled.
 *
 * Dim only, on purpose: the rest of the window darkens, the control lights
 * up, and everything stays clickable. A reader who wanders off is not trapped.
 *
 * This file is pure. No DOM, no React — `tour.test.ts` drives every step's done-check with a
 * hand-made state, so the checks are proven against the change they claim to detect and, just
 * as important, against the state that must not complete them. `TourOverlay.tsx` does the
 * drawing and the polling.
 *
 * Anchors. Two forms, tried in order; the first one present and laid out gets the ring:
 *   - a CSS selector: `[data-tour="cmd:export"]`, `.graphzoom svg.gfx-figure`;
 *   - `<css> :: <label>` — the first element matching <css> whose label is <label>, where the
 *     label is its first `<span>` child's text (an Inspector row) or else its own text (a tab, a
 *     group heading, a ribbon tickbox). This is how an Inspector control is named without giving
 *     each of its hundreds of rows an attribute: the words the reader sees are the address.
 *   An Inspector row lists three: the row, then its group heading (a closed group has no laid-out
 *   rows), then its tab (another tab has no laid-out groups). The light lands on the nearest
 *   thing that exists, and moves in as the reader opens each level.
 */
import type { AxisSpec, Plot } from "@mady/core";

/**
 * What the tours read off the running program, once per render. Every field here is something a
 * step's done-check needs, nothing else.
 */
export interface TourState {
  /** `project.tables.length` — a paste that reached the sheet adds one. */
  tables: number;
  /** `project.plots.length` — Create graph adds one. */
  plots: number;
  /** `project.analyses.length` — Run in the Analyze dialog adds one (even when the engine is off). */
  analyses: number;
  /** The import preview (paste / file) is on screen. */
  importOpen: boolean;
  /** The New-graph dialog is on screen. */
  newGraphOpen: boolean;
  /** The Export dialog is on screen. */
  exportOpen: boolean;
  /** The Analyze dialog is on screen. */
  analyzeOpen: boolean;
  /** What is selected on the figure ("series", "axis", "plot", …), or null. */
  selectionKind: string | null;
  /** The format of the sheet the program would analyse right now ("xy", "column", …), or null. */
  workingTableKind: string | null;
  /** Significance markers bound to an analysis, counted over every graph. */
  sigMarkers: number;
  /** A datasheet tab is in front (not a graph of one). */
  sheetInFront: boolean;
  /** The datasheet in front: its column count, its excluded-cell count, and its whole JSON; null when none. */
  sheet: { id: string; columns: number; excluded: number; fingerprint: string } | null;
  /** Cells are selected in the datasheet in front. */
  dataSelection: boolean;
  /** The graph in front, or null when the active tab is not a graph. */
  activePlot: { title: string; fingerprint: string; plot: Plot } | null;
  /** The panel-figure builder is in front. */
  figureOpen: boolean;
  /** The figure being built: its panel count and its whole JSON; null when the builder is not in front. */
  figure: { id: string; panels: number; fingerprint: string } | null;
}

/**
 * What a step works on. A step that edits a datasheet is meaningless while a graph is in front,
 * and vice versa: without this, clicking Next while not on the spreadsheet would show the next
 * card anyway, where it makes no sense. So a step names what it needs, and
 * on entry (after a Next, a step passed over by `skipIf`, or a completed step) the shell reaches it: the reader's own suitable
 * sheet or graph if the project has one, a generated sample otherwise (`reachTourNeed`).
 */
export type TourNeed = "sheet" | "graph" | "column-sheet" | "column-graph" | "figure";

/** Is the need already in front? */
export function needMet(need: TourNeed, s: TourState): boolean {
  switch (need) {
    case "sheet":
      return s.sheetInFront;
    case "graph":
      return s.activePlot !== null;
    case "column-sheet":
      return s.sheetInFront && s.workingTableKind === "column";
    case "column-graph":
      return s.activePlot !== null && s.workingTableKind === "column";
    case "figure":
      return s.figureOpen;
  }
}

/**
 * How the shell is asked to bring a need in front. `generate` = the reader pressed the card's
 * sample button: make a fresh sample, even if the project has suitable data. `preferId` = the
 * object the tour was working on a moment ago (the sheet whose values were excluded, the graph
 * whose axis was cut), so an automatic reach returns there rather than to the first thing found.
 */
export type TourReach = (need: TourNeed, opts?: { generate?: boolean | undefined; preferId?: string | undefined }) => void;

/**
 * The program does the step. The card's one button is Next: when the step's state is already there
 * it moves on; when it is not, the shell performs the step itself (adds the column, excludes the
 * values, creates the graph, sets the colour…) and the tour moves on once the document shows it.
 * Returns whether anything was changed (false = nothing to do here, move on at once). The
 * Next button verifies that the desired state has been reached, or reaches it. Nothing advances
 * without the state being reached; the card has no Skip button.
 */
export type TourPerform = (step: TourStep, now: TourState) => boolean;

/** The card's button for a need the reader has not met: the program supplies the data. */
export const REACH_LABEL: Record<TourNeed, string> = {
  sheet: "Use a sample datasheet",
  graph: "Use a sample graph",
  "column-sheet": "Use sample groups",
  "column-graph": "Use a sample graph of groups",
  figure: "Make a figure from my graphs",
};

export interface TourStep {
  id: string;
  /** See the file comment. Empty = no anchor: the card stands alone in the middle of the window. */
  anchors: string[];
  title: string;
  text: string;
  /**
   * `action`: advances when `done` says so. `look`: nothing to detect — the card shows a Next
   * button. A look step is for "check this" and "you are done" moments, never for something
   * the document could tell us.
   */
  mode: "action" | "look";
  /**
   * The completion check. `start` is the state captured when the step was entered, so a check
   * can be relative ("one more table than when we began") rather than absolute ("at least one
   * table" — which is true before the reader has done anything on any project with data in it).
   * Must return false when `now === start`: the overlay evaluates it on entry.
   */
  done?: (now: TourState, start: TourState) => boolean;
  /**
   * Already true when the step is entered? Then it is skipped without being shown. For the
   * "open a graph" step at the head of a styling tour: a reader who is looking at a graph
   * should not be told to open one.
   */
  skipIf?: (start: TourState) => boolean;
  /** Offer the "Put sample numbers on the clipboard" button on this card. */
  offerSample?: boolean;
  /**
   * What the step works on. Unmet on entry → the shell reaches it at once (opens the reader's
   * own suitable object, else generates a sample) unless `choose` is set, in which case the card
   * offers it as a button and the reader may open their own data instead.
   */
  needs?: TourNeed;
  /** The reader picks: their own data (the step's instruction) or the button (generated sample). */
  choose?: boolean;
  /**
   * Next on this step simply moves on (a choice point whose following steps enforce their own
   * state): the copy card, where "I have copied my numbers" is a fact the program cannot see.
   */
  nextAdvances?: boolean;
}

export type TourId = "first-graph" | "datasheet" | "axes" | "looks" | "series" | "annotate" | "compare" | "dose-response" | "figure";

/**
 * How the list is grouped: by the order of work — enter and shape the data, make a graph,
 * improve the graph, analyse the data, then make a panel figure — with several tours per
 * stage. Within a stage, beginner tours come first.
 */
export const TOUR_THEMES = ["1 · Your data: enter and shape it", "2 · Make a graph", "3 · Improve the graph", "4 · Analyse your data", "5 · Make a panel figure"] as const;
export type TourTheme = (typeof TOUR_THEMES)[number];
export const TOUR_LEVELS = ["beginner", "intermediate", "advanced"] as const;
export type TourLevel = (typeof TOUR_LEVELS)[number];

export interface Tour {
  id: TourId;
  /** As the Welcome card and the manual name it. */
  title: string;
  /**
   * As the Help menu, the command palette and the manual's index name it: "Tour: axes". Short and
   * prefixed on purpose — a command named "Axes: range, ticks and a break" would out-score the
   * Breaks control itself in a search for "axis break", because the words of a control would be in
   * a command's name. The prefix says what it is; the words of the controls stay with the controls.
   */
  label: string;
  /** One line under the title. */
  summary: string;
  /** The list's sections — the manual's own groups, so the two never disagree about where a topic lives. */
  theme: TourTheme;
  /** Within a theme the list runs beginner → advanced; the badge on each row says which. */
  level: TourLevel;
  steps: TourStep[];
}

/** The tours of one theme, beginner first — what the tab and the manual chapter render. */
export const toursByTheme = (): { theme: TourTheme; tours: Tour[] }[] =>
  TOUR_THEMES.map((theme) => ({
    theme,
    tours: TOURS.filter((t) => t.theme === theme).sort((a, b) => TOUR_LEVELS.indexOf(a.level) - TOUR_LEVELS.indexOf(b.level)),
  })).filter((g) => g.tours.length > 0);

/**
 * Sample numbers for a reader with nothing to paste: a dose–response block, tab-separated with a
 * heading row, exactly what a copy from a spreadsheet produces. Three columns, so the sheet is
 * guessed as XY and every later step has a real graph to work on.
 */
export const TOUR_SAMPLE_TSV = [
  "Dose\tControl\tTreated",
  "0\t2.1\t2.0",
  "1\t3.4\t5.9",
  "2\t4.9\t9.8",
  "4\t6.2\t14.1",
  "8\t7.0\t17.6",
  "16\t7.4\t19.0",
].join("\n");

// ---- anchor helpers ---------------------------------------------------------------------------

const cmd = (id: string): string => `[data-tour="cmd:${id}"]`;
const menu = (name: string): string => `[data-tour="menu:${name}"]`;
const tab = (name: string): string => `.inspcat :: ${name}`;
const section = (title: string): string => `.insphd :: ${title}`;
const group = (title: string): string => `.inspsub2 > summary :: ${title}`;
const row = (label: string): string => `.frow :: ${label}`;
const FIGURE = ".graphzoom svg.gfx-figure";
const NAV = ".nav";

// ---- done-check helpers -----------------------------------------------------------------------

/** A facet of the graph in front as a string, or null when no graph is in front. */
type Facet = (s: TourState) => string | null;
const plotFacet =
  (pick: (p: Plot) => unknown): Facet =>
  (s) =>
    s.activePlot ? JSON.stringify(pick(s.activePlot.plot) ?? null) : null;
/** The same facet, taken over the three value axes. */
const axisFacet = (pick: (a: AxisSpec | undefined) => unknown): Facet =>
  plotFacet((p) => [p.xAxis, p.yAxis, p.y2Axis].map(pick));
/**
 * The same facet, taken over every series' own style and every single point's. Clicking a point
 * selects that point, and the Inspector then writes to the point (`pointStyles`) unless "Apply
 * to whole series" is on — a reader who did exactly what the card said would otherwise never
 * complete the step.
 */
const styleFacet = (pick: (st: NonNullable<Plot["seriesStyles"]>[string]) => unknown): Facet =>
  // Unset values are dropped: a point's first edit creates its style record, and that new
  // record must not read as a change of every facet at once (a recoloured point is not a reshaped one).
  plotFacet((p) => [...Object.values(p.seriesStyles ?? {}), ...Object.values(p.pointStyles ?? {})].map(pick).filter((v) => v !== undefined));
/** True when the facet exists in both states and differs — never when a graph is missing. */
const changed =
  (facet: Facet) =>
  (now: TourState, start: TourState): boolean => {
    const a = facet(now);
    const b = facet(start);
    return a !== null && b !== null && a !== b;
  };
const opened = (flag: (s: TourState) => boolean) => (now: TourState, start: TourState): boolean => flag(now) && !flag(start);
const oneMore = (count: (s: TourState) => number) => (now: TourState, start: TourState): boolean => count(now) > count(start);
/** Annotations on the graph in front; -1 when no graph is in front (so a comparison never fires). */
const annotationCount = (s: TourState): number => (s.activePlot ? (s.activePlot.plot.annotations ?? []).length : -1);
const breakCount = (s: TourState): number =>
  s.activePlot ? [s.activePlot.plot.xAxis, s.activePlot.plot.yAxis, s.activePlot.plot.y2Axis].reduce((n, a) => n + (a?.breaks?.length ?? 0), 0) : -1;

// ---- shared steps -----------------------------------------------------------------------------

/** Head of every styling tour: get a graph in front, unless one already is. */
const OPEN_GRAPH: TourStep = {
  id: "open-graph",
  anchors: [NAV],
  mode: "action",
  needs: "graph",
  choose: true,
  title: "Open a graph",
  text:
    "Click one of your graphs in the Project tree on the left (unfold its folder if it is closed), or click a " +
    "graph's tab. No graph yet? The button below makes a sample one to practise on.",
  skipIf: (start) => start.activePlot !== null,
  done: (now, start) => now.activePlot !== null && (start.activePlot === null || now.activePlot.plot.id !== start.activePlot.plot.id),
};

/**
 * The Inspector shows its section tabs only while something on the graph is selected (with
 * nothing selected it says "click an axis or a series"). A tour heading for a tab must get a
 * selection first, unless the reader already has one.
 */
const SELECT_PLOT: TourStep = {
  id: "select-plot",
  anchors: [FIGURE],
  mode: "action",
  needs: "graph",
  title: "Click the graph",
  text: "Click any part of the graph — a point, a line, an axis. The Inspector's tabs appear once something on the graph is selected.",
  skipIf: (start) => start.selectionKind !== null,
  done: (now, start) => now.selectionKind !== null && start.selectionKind === null,
};

const OPEN_ANALYZE: TourStep = {
  id: "analyze",
  anchors: [cmd("analyze"), menu("Analyze")],
  mode: "action",
  title: "Open Analyze",
  text: "Analyze ▸ Analyze… opens on the datasheet you are working with, with the tests that suit its shape first.",
  done: opened((s) => s.analyzeOpen),
};

const FINISHED = (text: string): TourStep => ({ id: "finished", anchors: [], mode: "look", title: "That is the whole path", text });

// ---- the tours --------------------------------------------------------------------------------

/** The first-graph walkthrough. Same seven steps as the manual, split where a dialog intervenes. */
export const TOUR_FIRST_GRAPH: TourStep[] = [
  {
    id: "copy",
    anchors: [],
    mode: "action",
    offerSample: true,
    nextAdvances: true,
    // This tour builds the dataset itself, so a reader with nothing to paste needs a way in that
    // is not the clipboard: "Use a sample datasheet" makes the sheet and the paste/import steps
    // skip themselves (otherwise there is no button for the dataset).
    needs: "sheet",
    choose: true,
    title: "Copy your numbers",
    text:
      "In Excel, Sheets or a text editor, select the block together with its column headings and copy it, then press " +
      "Next. Or press the clipboard button for sample numbers to paste. Nothing to paste at all? Use a sample " +
      "datasheet makes the sheet and the tour continues from it.",
    // Done when a datasheet is in front — the sample button, or the reader's own paste landing.
    done: (now, start) => now.sheetInFront && !start.sheetInFront,
  },
  {
    id: "paste",
    anchors: [cmd("paste-data"), menu("File")],
    mode: "action",
    // A sheet is already in front (the sample button, or the reader's own): nothing to paste.
    skipIf: (start) => start.sheetInFront,
    title: "Paste it as a new datasheet",
    text: "File ▸ Paste data as new datasheet… (or Ctrl+Shift+V). The import preview opens on what you pasted.",
    done: opened((s) => s.importOpen),
  },
  {
    id: "import",
    anchors: ['[data-tour="import-confirm"]'],
    mode: "action",
    // Reached with a sheet in front and no import preview open: there is nothing to import.
    skipIf: (start) => start.sheetInFront && !start.importOpen,
    title: "Check the split, then Import",
    text:
      "The preview is the datasheet grid. If the columns did not split where you expect, set Delimiter and " +
      "Decimal separator until they do. Then press the button that counts your rows.",
    done: oneMore((s) => s.tables),
  },
  {
    id: "format",
    anchors: [".fmt-badge-sel"],
    mode: "look",
    needs: "sheet",
    title: "The format chip",
    text:
      "This chip says the sheet's format — XY, Column, Grouped and so on. The format decides which graphs and " +
      "analyses are offered. If it guessed wrong, click it and pick the right one now rather than later.",
  },
  {
    id: "newgraph",
    // The rail button above the sheet is "New graph of this data" — the dialog opens ON that
    // sheet and Create lands on the graph. The menu's New graph… is the fallback when no sheet
    // is in front; it makes a fresh datasheet and lands there instead, so it is second.
    anchors: ['[data-tour="rail-newgraph"]', cmd("new-graph-create"), menu("Graph")],
    mode: "action",
    needs: "sheet",
    title: "Ask for a graph of this data",
    text:
      "Press New graph of “…” above the datasheet. The dialog opens on the sheet you are looking at, with " +
      "the best-fitting chart already picked and the rest offered beside it.",
    done: opened((s) => s.newGraphOpen),
  },
  {
    id: "create",
    anchors: ['[data-tour="newgraph-create"]'],
    mode: "action",
    title: "Pick a chart and create it",
    text: "Any of the offered charts will do for now. Press Create graph.",
    done: oneMore((s) => s.plots),
  },
  {
    id: "select",
    needs: "graph",
    // `.graphzoom` is the graph pane: a legend miniature elsewhere carries the same svg class.
    anchors: [FIGURE],
    mode: "action",
    title: "Click a part of the graph",
    text:
      "A point, a line, a bar, an axis, the legend — click one. The Inspector on the right becomes the controls " +
      "for exactly that thing.",
    done: (now, start) => now.selectionKind !== null && start.selectionKind === null,
  },
  {
    id: "colour",
    needs: "graph",
    anchors: [".insp"],
    mode: "action",
    title: "Change something",
    text: "In the Inspector's Data tab, change a colour, a symbol or a line. Ctrl+Z takes it back if you do not like it.",
    done: changed((s) => (s.activePlot ? s.activePlot.fingerprint : null)),
  },
  {
    id: "title",
    needs: "graph",
    anchors: ['[data-tour="plot-title"]', FIGURE],
    mode: "action",
    title: "Give it the real title",
    text:
      "Double-click the title and type. The same works on axis titles, the legend's names and every data label. " +
      "Ctrl+Enter, or a click anywhere else, keeps it; Esc throws it away.",
    done: changed((s) => (s.activePlot ? s.activePlot.title : null)),
  },
  {
    id: "export",
    needs: "graph",
    anchors: [cmd("export"), menu("File")],
    mode: "action",
    title: "Export it",
    text: "File ▸ Export… (or Ctrl+E) opens the export dialog for the graph in front.",
    done: opened((s) => s.exportOpen),
  },
  {
    id: "exportgo",
    needs: "graph",
    anchors: ['[data-tour="export-confirm"]'],
    mode: "action",
    title: "Choose the format and go",
    text:
      "PNG for a submission, PDF or SVG when the journal wants vector. Set Print width to the journal's column " +
      "width — the line above the button states the final pixel size — then press Export. HTML page gives an " +
      "interactive file instead: readers can hover a mark for its values, zoom, pan, and hide or show a series from the legend.",
    done: (now, start) => start.exportOpen && !now.exportOpen,
  },
  FINISHED(
    "Numbers in, a figure out. Everything else in MadY is a detail of one of these steps — the manual (F1) " +
      "has a chapter for each, and Help ▸ Guided tours has more tours like this one.",
  ),
];

/** The datasheet: add a column, type into it, exclude values, see the effect, bring them back. */
export const TOUR_DATASHEET: TourStep[] = [
  {
    id: "open-sheet",
    anchors: [NAV],
    mode: "action",
    needs: "sheet",
    choose: true,
    title: "Open a datasheet",
    text:
      "Click one of your datasheets in the Project tree on the left (unfold its folder if it is closed), or click a " +
      "datasheet's tab. No data yet? The button below makes a sample sheet to practise on.",
    skipIf: (start) => start.sheetInFront,
    done: (now, start) => now.sheetInFront && (!start.sheetInFront || now.sheet?.id !== start.sheet?.id),
  },
  {
    id: "add-column",
    needs: "sheet",
    anchors: ['[data-tour="rail-addcolumn"]'],
    mode: "action",
    title: "Add a column",
    text: "Press ＋ Column above the grid. A new column appears at the right, ready for a heading and values.",
    done: (now, start) => now.sheet !== null && start.sheet !== null && now.sheet.columns > start.sheet.columns,
  },
  {
    id: "type-values",
    needs: "sheet",
    anchors: ["table.dg"],
    mode: "action",
    title: "Type into it",
    text:
      "Double-click a cell in the new column and type a number; Enter keeps it. Double-click the heading to rename " +
      "the column. Every graph of this sheet redraws as the numbers change.",
    done: changed((s) => (s.sheet ? s.sheet.fingerprint : null)),
  },
  {
    id: "select-cells",
    needs: "sheet",
    anchors: ["table.dg"],
    mode: "action",
    title: "Select some values",
    text: "Click a cell, or drag across several. The Exclude and Include buttons above the grid wake up once cells are selected.",
    // Typing into a cell leaves that cell selected, so this step is usually already satisfied.
    skipIf: (start) => start.dataSelection,
    done: (now, start) => now.dataSelection && !start.dataSelection,
  },
  {
    id: "exclude",
    needs: "sheet",
    anchors: [".railbtn :: Exclude", cmd("exclude-values"), menu("Data")],
    mode: "action",
    title: "Exclude them",
    text:
      "With the values to leave out selected, press Exclude (or Data ▸ Exclude selected values, Ctrl+\\). They stay in the sheet, shown struck through, " +
      "but every graph and analysis of this sheet leaves them out — nothing is deleted.",
    done: (now, start) => now.sheet !== null && start.sheet !== null && now.sheet.excluded > start.sheet.excluded,
  },
  {
    id: "see-effect",
    anchors: [],
    mode: "look",
    title: "What changed",
    text:
      "Open a graph of this sheet: the excluded points are gone from it, and a note under the graph says how many were " +
      "left out. An analysis re-run now ignores them too. The sheet keeps the numbers, so nothing is lost.",
  },
  {
    id: "include",
    needs: "sheet",
    anchors: [".railbtn :: Include", cmd("include-values"), menu("Data")],
    mode: "action",
    title: "Bring them back",
    text: "Select the excluded cells again and press Include (or Data ▸ Include selected values). They rejoin every graph and analysis at once.",
    done: (now, start) => now.sheet !== null && start.sheet !== null && now.sheet.excluded < start.sheet.excluded,
  },
  FINISHED(
    "A column added, values typed, values excluded and restored. The grid's right-click menu has copy, cut, paste and " +
      "sort; the format chip above it decides which graphs and analyses the sheet can feed.",
  ),
];

/** Axes: range, tick marks, minor ticks, and a break. */
export const TOUR_AXES: TourStep[] = [
  OPEN_GRAPH,
  {
    id: "select-axis",
    needs: "graph",
    anchors: [FIGURE],
    mode: "action",
    title: "Click the Y axis",
    text: "Click the axis LINE (not a number on it). The Inspector opens its Axis tab on that axis.",
    done: (now, start) => now.selectionKind === "axis" && start.selectionKind !== "axis",
  },
  {
    id: "range",
    needs: "graph",
    anchors: [row("Min / Max"), group("Range"), tab("Axis")],
    mode: "action",
    title: "Set the range",
    text:
      "Under Range, type a minimum or a maximum. Blank means automatic — the axis follows the data. " +
      "Clear the box to hand it back.",
    done: changed(axisFacet((a) => [a?.min, a?.max])),
  },
  {
    id: "ticks",
    needs: "graph",
    anchors: [row("Tick interval"), group("Ticks"), tab("Axis")],
    mode: "action",
    title: "Space the tick marks",
    text: "Under Ticks, set Tick interval — the exact distance between numbered ticks, in the axis's own units.",
    done: changed(axisFacet((a) => a?.majorStep)),
  },
  {
    id: "minor",
    needs: "graph",
    anchors: [row("Minor ticks"), group("Ticks"), tab("Axis")],
    mode: "action",
    title: "Add minor ticks",
    text: "Minor ticks are the unlabelled subdivisions between numbered ticks. Set how many go between each pair.",
    done: changed(axisFacet((a) => a?.minorCount)),
  },
  {
    id: "break",
    needs: "graph",
    anchors: [row("Add cut"), group("Breaks (cuts)"), tab("Axis")],
    mode: "action",
    title: "Cut the axis",
    text:
      "Open Breaks (cuts). Type the first and last value of the empty band you want to skip, then press Add cut. " +
      "The axis shows the cut with a mark; Break mark chooses which. Add several if you need them.",
    done: (now, start) => breakCount(now) >= 0 && breakCount(start) >= 0 && breakCount(now) > breakCount(start),
  },
  FINISHED(
    "Range, ticks, minor ticks and a cut — the Axis tab has the rest: log scales, number formats, prefixes and " +
      "suffixes, custom ticks and shaded bands. Ctrl+Z walks any of it back one change at a time.",
  ),
];

/** Looks: grid, frame, background, and a style preset. */
export const TOUR_LOOKS: TourStep[] = [
  OPEN_GRAPH,
  {
    id: "grid",
    needs: "graph",
    anchors: [".grbtog :: Grid"],
    mode: "action",
    title: "Grid lines",
    text: "Tick Grid in the bar above the graph. Minor adds the finer lines between them.",
    done: changed(plotFacet((p) => p.grid)),
  },
  {
    id: "frame",
    needs: "graph",
    anchors: [".grbsel :: Frame"],
    mode: "action",
    title: "The frame",
    text: "Frame chooses how the plot area is edged: an L of two axes, a full box, or axes offset from the data.",
    done: changed(plotFacet((p) => p.frame)),
  },
  SELECT_PLOT,
  {
    id: "background",
    needs: "graph",
    anchors: [row("Paper"), section("Background"), tab("Frame")],
    mode: "action",
    title: "The background",
    text:
      "In the Inspector's Frame tab, open Background. Paper is the colour behind the whole graph — transparent, " +
      "the default, a swatch, or a custom colour.",
    done: changed(plotFacet((p) => p.background)),
  },
  {
    id: "preset",
    needs: "graph",
    anchors: [section("Style preset"), tab("Style")],
    mode: "action",
    title: "A whole look in one press",
    text:
      "The Style tab holds presets — fonts, axes, frame and colours together. Pick one; the graph takes it at once. " +
      "You can save your own from the same tab.",
    done: changed((s) => (s.activePlot ? s.activePlot.fingerprint : null)),
  },
  FINISHED(
    "Grid, frame, background and a preset. The Text tab sets every font; the Frame tab also holds the graph's size " +
      "in millimetres and its margins.",
  ),
];

/** Series: colour, symbol, how the points are joined, line thickness, and a fitted curve. */
export const TOUR_SERIES: TourStep[] = [
  OPEN_GRAPH,
  {
    id: "select-series",
    needs: "graph",
    anchors: [FIGURE],
    mode: "action",
    title: "Click a series",
    text: "Click a point or a line of one series. The Inspector opens its Data tab on that series alone.",
    done: (now, start) => now.selectionKind === "series" && start.selectionKind !== "series",
  },
  {
    id: "colour",
    needs: "graph",
    anchors: [row("Colour"), tab("Data")],
    mode: "action",
    title: "Its colour",
    text: "Colour sets this series' points; the line follows it while Match line colour is ticked.",
    done: changed(styleFacet((st) => st.color)),
  },
  {
    id: "shape",
    needs: "graph",
    anchors: [row("Shape"), tab("Data")],
    mode: "action",
    title: "Its symbol",
    text: "Shape picks the marker — circle, square, triangle, diamond and more. Size and Fill sit beside it.",
    done: changed(styleFacet((st) => st.symbol)),
  },
  {
    id: "connect",
    needs: "graph",
    anchors: [row("Connect"), tab("Data")],
    mode: "action",
    title: "How the points are joined",
    text: "Connect draws the line between points: none, straight, a step, or a smooth curve through them.",
    done: changed(styleFacet((st) => st.connect)),
  },
  {
    id: "thickness",
    needs: "graph",
    anchors: [row("Thickness"), tab("Data")],
    mode: "action",
    title: "Line thickness",
    text: "Thickness is the line's width in pixels; Pattern beside it dashes or dots it.",
    done: changed(styleFacet((st) => st.lineWidth)),
  },
  OPEN_ANALYZE,
  {
    id: "fit-run",
    anchors: ['[data-goal="curvefit"]', ".modal-analyze .btn"],
    mode: "action",
    title: "Fit a curve",
    text:
      "Click Curve fitting, choose the equation, and press Run. The fitted curve is drawn on the graph and its " +
      "parameters appear in the result tab.",
    done: oneMore((s) => s.analyses),
  },
  FINISHED(
    "Colour, symbol, connection, thickness and a fit. Every series can differ; Apply to whole graph at the foot of " +
      "the Data tab pushes one change to all of them.",
  ),
];

/** Compare groups: a Column sheet, a t test or ANOVA, and the stars on the graph. */
export const TOUR_COMPARE: TourStep[] = [
  {
    id: "open-column",
    anchors: [NAV],
    mode: "action",
    needs: "column-sheet",
    choose: true,
    title: "Open a Column datasheet",
    text:
      "Group comparisons read one column per group. Open such a sheet from the Project tree (in the demo project, " +
      "Replicate readouts under Experiment 3), or press the button below for a sample sheet of three groups.",
    skipIf: (start) => start.workingTableKind === "column",
    done: (now, start) => now.workingTableKind === "column" && start.workingTableKind !== "column",
  },
  OPEN_ANALYZE,
  {
    id: "compare-run",
    anchors: ['[data-goal="compare"]', ".modal-analyze .btn"],
    mode: "action",
    title: "Compare groups, then Run",
    text:
      "Click Compare groups. Two groups get a t test; for three or more, set Test to One-way ANOVA and a Post-hoc " +
      "row appears. Tick the columns to compare and press Run.",
    done: oneMore((s) => s.analyses),
  },
  {
    id: "markers",
    anchors: [".anbind-toggle", ".anbind"],
    mode: "action",
    title: "Put the stars on the graph",
    text:
      "Under the result's toolbar, tick Significance markers on the graph. Only comparisons that clear your " +
      "threshold are drawn, and they stay bound to this analysis. (No tickbox? The analysis has no pairwise " +
      "comparisons, or the statistics engine is not running — Next moves on.)",
    done: oneMore((s) => s.sigMarkers),
  },
  {
    id: "sig-style",
    needs: "column-graph",
    // The Design command pins the Significance brackets section open (it keeps the selection,
    // so the section stays visible), so the light goes menu → row directly.
    anchors: [row("Bracket shape"), section("Significance brackets"), tab("Annotate"), cmd("design-sig-options"), menu("Design")],
    mode: "action",
    title: "How the brackets look",
    text:
      "Back on the graph (click its tab), Design ▸ Significance thresholds & labels… opens the Significance brackets " +
      "section in the Inspector. Change Bracket shape, the legs, the symbol size — or the p-value cut-offs and the " +
      "symbols they print.",
    done: changed(plotFacet((p) => p.significance)),
  },
  FINISHED(
    "A test, its p-values on the graph, and the brackets styled. Re-run the analysis after editing the data and " +
      "every star refreshes; Add to graph ▸ Letters (CLD) is the alternative when there are too many pairs.",
  ),
];

/** Annotate: a text box, an arrow and a shaded band on the graph in front. */
export const TOUR_ANNOTATE: TourStep[] = [
  OPEN_GRAPH,
  {
    id: "add-text",
    needs: "graph",
    anchors: [".grbsel :: Insert"],
    mode: "action",
    title: "Add a text box",
    text:
      "In the bar above the graph, open Insert and choose Text. A box lands on the plot; double-click it to type, " +
      "drag it anywhere. Every annotation is a real object: it moves with the graph and exports with it.",
    done: (now, start) => annotationCount(now) > annotationCount(start) && annotationCount(start) >= 0,
  },
  {
    id: "add-arrow",
    needs: "graph",
    anchors: [".grbsel :: Insert"],
    mode: "action",
    title: "Add an arrow",
    text: "Insert ▸ Arrow. Drag either end to point it; the Inspector's Annotate tab holds its colour, width and head.",
    done: (now, start) => annotationCount(now) > annotationCount(start) && annotationCount(start) >= 0,
  },
  {
    id: "add-band",
    needs: "graph",
    anchors: [".grbsel :: Insert"],
    mode: "action",
    title: "Shade a range",
    text:
      "Insert ▸ H-band (or V-band) shades a range of the axis behind the plot — a therapeutic window, a baseline " +
      "period. Drag its edges; it is pinned to axis values, so it follows a change of range.",
    done: (now, start) => annotationCount(now) > annotationCount(start) && annotationCount(start) >= 0,
  },
  FINISHED(
    "A text box, an arrow and a band — Insert also has lines, boxes, highlights, ellipses, callouts and pictures. " +
      "Click any annotation to edit it in the Annotate tab; Delete removes it.",
  ),
];

/** Dose–response: the guided front door, one press to fit, and where to read the EC50. */
export const TOUR_DOSE: TourStep[] = [
  OPEN_GRAPH,
  {
    id: "dose-door",
    needs: "graph",
    anchors: [cmd("doseresponse"), ".dropsub :: Common analyses", menu("Analyze")],
    mode: "action",
    title: "The dose–response door",
    text:
      "Analyze ▸ Common analyses ▸ Dose-response… opens Analyze already set to a four-parameter logistic fit on this " +
      "sheet, with a banner explaining the model. (The general door, Analyze…, offers every method.)",
    done: opened((s) => s.analyzeOpen),
  },
  {
    id: "run-fit",
    anchors: [".modal-analyze .btn"],
    mode: "action",
    title: "Fit it",
    text:
      "Check the Y column(s) to fit, keep the defaults, and press Run. The fit is computed by the statistics engine " +
      "and lands in a result tab; the fitted curve is drawn on the graph.",
    done: oneMore((s) => s.analyses),
  },
  {
    id: "read-fit",
    anchors: [],
    mode: "look",
    title: "Read the result",
    text:
      "The result tab's Key result cards give R², the EC50 and the Hill slope with its confidence interval; the " +
      "table below lists every parameter — Bottom, Top, logEC50, Hill slope — with SE and 95% CI, and a one-line " +
      "summary you can paste. (No engine running? The record still exists and says so.)",
  },
  FINISHED(
    "One door, one press, an EC50 you can quote. Enzyme kinetics and Receptor binding under Common analyses work " +
      "the same way; Analyze… ▸ Curve fitting offers the whole equation library.",
  ),
];

/** A panel figure: make one, pick the graphs, arrange them, export. */
export const TOUR_FIGURE: TourStep[] = [
  {
    id: "new-figure",
    anchors: [cmd("new-layout"), menu("Insert")],
    mode: "action",
    needs: "figure",
    choose: true,
    title: "Start a figure",
    text:
      "Insert ▸ New layout makes a panel figure and opens it: a page where you lay several graphs out as one " +
      "publication figure with lettered panels. Or press the button below to make one now.",
    skipIf: (start) => start.figureOpen,
    done: opened((s) => s.figureOpen),
  },
  {
    id: "pick-graphs",
    needs: "figure",
    anchors: [".laycards", ".layselect"],
    mode: "action",
    title: "Choose two graphs",
    text: "Click two graph cards to include them. Any graph in the project can be a panel; a graph can sit in several figures.",
    done: (now, start) => now.figure !== null && start.figure !== null && now.figure.panels >= 2 && now.figure.panels > start.figure.panels,
  },
  {
    id: "arrange",
    needs: "figure",
    anchors: [".laypreset-wrap .laychip", ".addbtn :: Build / Arrange →"],
    mode: "action",
    title: "Arrange them",
    text:
      "Press Build / Arrange → to lay the panels out, then pick a shape from Layout ▾ or set Columns. Panels can " +
      "also be dragged, resized and made to span columns or rows; Align Y-axes keeps a row's axes level.",
    done: (now, start) => now.figure !== null && start.figure !== null && now.figure.fingerprint !== start.figure.fingerprint,
  },
  {
    id: "export-figure",
    needs: "figure",
    anchors: ['.paneact[title^="Export this figure"]'],
    mode: "action",
    title: "Export the figure",
    text: "Export this figure writes all panels as one image — PNG for a submission, PDF or SVG for vector — at the width you set.",
    done: opened((s) => s.exportOpen),
  },
  {
    id: "exportgo-figure",
    anchors: ['[data-tour="export-confirm"]'],
    mode: "action",
    title: "Choose the format and go",
    text: "Pick the format and set the width; the Final line states the pixel size. Press Export.",
    done: (now, start) => start.exportOpen && !now.exportOpen,
  },
  FINISHED(
    "A figure from your graphs, arranged and exported. The Arrange bar also sets the panel letters (A B C, a b c, 1 2 3), " +
      "aligns axes across rows and columns, drafts a caption, and adds a picture panel or a text box; Match to gives " +
      "every panel the first one's size, fonts or colours.",
  ),
];

export const TOURS: readonly Tour[] = [
  {
    id: "first-graph",
    title: "From your numbers to a finished figure",
    label: "Tour: first graph",
    summary: "Paste numbers, make a graph, change a colour and a title, export — the whole path once.",
    theme: "2 · Make a graph",
    level: "beginner",
    steps: TOUR_FIRST_GRAPH,
  },
  {
    id: "datasheet",
    title: "The datasheet: add a column, exclude values, bring them back",
    label: "Tour: datasheet",
    summary: "Add a column and type into it; exclude values so graphs and analyses skip them, then restore them.",
    theme: "1 · Your data: enter and shape it",
    level: "beginner",
    steps: TOUR_DATASHEET,
  },
  {
    id: "axes",
    title: "Axes: range, ticks and a break",
    label: "Tour: axes",
    summary: "Set the range, space the tick marks, add minor ticks, and cut an axis.",
    theme: "3 · Improve the graph",
    level: "intermediate",
    steps: TOUR_AXES,
  },
  {
    id: "looks",
    title: "Looks: grid, frame, background and a preset",
    label: "Tour: looks",
    summary: "Grid lines, the frame style, the paper colour, and a whole look in one press.",
    theme: "3 · Improve the graph",
    level: "beginner",
    steps: TOUR_LOOKS,
  },
  {
    id: "series",
    title: "Series: colour, symbol, line and a fitted curve",
    label: "Tour: series",
    summary: "Style one series — colour, marker, how points join, thickness — then fit a curve to it.",
    theme: "3 · Improve the graph",
    level: "intermediate",
    steps: TOUR_SERIES,
  },
  {
    id: "annotate",
    title: "Annotate: a text box, an arrow and a shaded band",
    label: "Tour: annotate",
    summary: "Put a note, an arrow and a shaded range on the graph — real objects that move and export with it.",
    theme: "3 · Improve the graph",
    level: "beginner",
    steps: TOUR_ANNOTATE,
  },
  {
    id: "compare",
    title: "Compare groups and put the stars on the graph",
    label: "Tour: compare groups",
    summary: "A t test or ANOVA on a Column sheet, significance markers bound to it, and the brackets styled.",
    theme: "4 · Analyse your data",
    level: "advanced",
    steps: TOUR_COMPARE,
  },
  {
    id: "dose-response",
    title: "Dose–response: fit the curve and read the EC50",
    label: "Tour: dose-response",
    summary: "The guided front door, one press to fit a four-parameter logistic, and where the EC50 is reported.",
    theme: "4 · Analyse your data",
    level: "intermediate",
    steps: TOUR_DOSE,
  },
  {
    id: "figure",
    title: "A panel figure: pick graphs, arrange, export",
    label: "Tour: panel figure",
    summary: "Make a figure from two of your graphs, arrange the panels, and export them as one image.",
    theme: "5 · Make a panel figure",
    level: "intermediate",
    steps: TOUR_FIGURE,
  },
];

export const tourById = (id: string): Tour | undefined => TOURS.find((t) => t.id === id);

/** True when the step's own check says the reader has done it. A look step never completes by itself. */
export function stepDone(step: TourStep, now: TourState, start: TourState): boolean {
  return step.mode === "action" && step.done !== undefined && step.done(now, start);
}
