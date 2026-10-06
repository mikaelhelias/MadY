/**
 * The program's own documentation — the content behind the Documentation tab.
 *
 * Kept as structured data rather than a blob of markup for three reasons: the renderer
 * stays trivial, the filter can match on real fields, and a test can assert coverage
 * (see `guide.test.ts`, which fails if a top-level menu goes undocumented).
 *
 * Note: this describes the program to its user. It is not developer documentation, and it
 * is not the per-project "Methods & notes" tab, which holds the user's own
 * writing about their research. Keep it in the second person, and never document something
 * the app does not actually do — a manual that overstates is worse than a missing one.
 *
 * Sections are filed into groups (`GuideGroup`) and must appear in group order, with a
 * group's sections contiguous — the contents list is rendered from the groups while the
 * page is rendered from the array, so a section filed out of order would leave the two
 * disagreeing. `guide.test.ts` pins it. Adding a section therefore means deciding where a
 * reader would look for it, which is the whole job.
 */
// Type-only, and `howTo.ts` imports nothing at all — so naming a surface here cannot make a
// cycle with the file that holds the entries.
import type { HowToSurface } from "./howTo";

/** One numbered step, with the picture that shows it. */
export interface GuideStep {
  text: string;
  shot?: { file: string; alt: string; caption: string } | undefined;
}

/**
 * The kinds of place a function can live. Declared here, beside the manual's own types, so an
 * "index" block can name one without `guide.ts` depending on the index that renders it.
 */
export type GuideVia = "menu" | "toolbar" | "inspector" | "context" | "figure" | "sheet" | "dialog" | "keys";

export type GuideBlock =
  | { kind: "p"; text: string }
  | { kind: "ul"; items: string[] }
  /**
   * Numbered steps — do this, then this. A step may carry its own figure, which is placed
   * directly under it.
   *
   * The per-step figure is the point. A manual that puts one picture at the top of a section
   * and then lists eight steps under it makes the reader match words to pixels themselves; a
   * screenshot under the step it illustrates is what a good reference manual does, and it
   * is the difference between a description and an instruction.
   * A plain string is still a step, so step lists without figures need no change.
   */
  | { kind: "steps"; items: (string | GuideStep)[] }
  | { kind: "note"; text: string }
  /**
   * The guided tours, listed from `TOURS` with a Start button each. Carries no text of its own:
   * the titles and summaries live beside the steps they describe, so this list cannot say a tour
   * exists that the program does not have.
   */
  | { kind: "tours" }
  | { kind: "keys"; rows: { keys: string; what: string }[] }
  /** The recommended citation, built by the renderer from the version actually running.
   *  Carries no text of its own on purpose: the About tab shows the same line from the same
   *  `citation()` call, and a copy typed out here would be wrong the first time the version
   *  changed. */
  | { kind: "cite" }
  /** Every function reachable by this route, listed from `GUIDE_INDEX` — the reference chapter's
   *  "where is everything" tables. Carries no text of its own: hand-listing 200 controls in prose
   *  is exactly the list that goes stale, and the index is already default-deny over the
   *  registries. */
  | { kind: "index"; via: GuideVia }
  /** Every analysis method, grouped the way the Analyze dialog groups them, each with the
   *  sentence saying when to use it. Carries no text of its own for the same reason the index
   *  block does not: the list is `METHOD_GROUPS` + `METHOD_INFO`, which the dialog itself
   *  enumerates, and a hand-typed copy would be wrong the first time a method was added. The
   *  prose above it still groups the methods by the question they answer — that is the reading;
   *  this is the reference. */
  | { kind: "methods" }
  /** A snapshot of the running program — captured by `scripts/gen-guide-shots.mjs`, never a
   *  hand-made mock-up, so it can be regenerated identically after any UI change. `file` names
   *  a PNG in `../assets/guide/`; `guide-shots.test.ts` fails the build when the file is
   *  missing, an image ships unreferenced, or the alt text / caption are empty.
   *  The thumbnail always shows the whole capture, never cropped: a crop can hide exactly
   *  what a snapshot exists to show (the preset cards read as "missing").
   *  Clicking only enlarges, to 1:1 scale in the popup. */
  | { kind: "shot"; file: string; alt: string; caption: string }
  /** A screen recording of the running program — filmed by `scripts/gen-guide-videos.mjs` off the
   *  built bundle, never edited by hand, so it is re-made after a UI change by running that again.
   *  `file` names a .webm in `../assets/guide/`; `guide-videos.test.ts` fails the build when the
   *  file is missing, a video ships unreferenced, or the alt text / caption are empty. */
  | { kind: "video"; file: string; alt: string; caption: string }
  /**
   * One how-to per action, for a whole surface — the answer to "I want to X, how do I do that?".
   * Carries no text of its own on purpose: the entries live in `howTo.ts`, one per control of
   * that surface. A hand-typed list here would silently go out of date.
   */
  /** The one line at the top of a chapter: what you will have when you finish it. */
  | { kind: "goal"; text: string }
  /**
   * A heading inside a chapter — one job of that chapter, with its own steps and its own picture.
   *
   * It is not decoration. The contents list gains a second level from these, and the
   * standalone manual's search cuts its sections at them, so "put a break in my axis" can land on
   * that heading rather than on a chapter with forty other things in it.
   */
  | { kind: "h"; text: string }
  /** A reference table typed out here — for the handful whose rows exist in no registry. */
  | { kind: "table"; head: string[]; rows: string[][] }
  /**
   * The exhaustive reference for one surface — every control, with a picture per group and a
   * numbered call-out each. See `howTo.ts`.
   */
  | { kind: "howto"; surface: HowToSurface };

/**
 * The parts of the manual, in reading order. A reader arrives with one of these
 * questions, so the contents list asks them in that order rather than listing every
 * heading flat.
 */
export const GUIDE_GROUPS = [
  "Start here",
  // Second in the list. A worked example is what someone wants in their first hour, and a
  // contents list that opens with the reference groups tells them the program is a reference. Everything
  // below is arranged by surface — the Axis tab, the Analyze dialog — which answers "what is
  // this control" and cannot answer "I have numbers and I need a figure".
  "Worked examples",
  "Your data",
  "Graphs and styling",
  "Statistics",
  "Finishing a figure",
  "Reference",
] as const;

export type GuideGroup = (typeof GUIDE_GROUPS)[number];

export interface GuideSection {
  id: string;
  title: string;
  /** Which part of the manual this belongs to. Drives the grouped contents list. */
  group: GuideGroup;
  /** One line under the heading; also searched by the filter box. */
  summary: string;
  /**
   * Synonyms for the search, never displayed. A chapter is titled with the program's own word
   * ("Axes, scales and ticks"), and a reader arrives with theirs ("range", "log", "gridlines").
   * Without this the search can only match words the chapter happens to contain, which is why
   * a manual feels like it has nothing in it. Weighted below the title, above the body.
   */
  keywords?: string[];
  blocks: GuideBlock[];
}

/**
 * A step's text, whether it was written as a bare sentence or as a step with its figure.
 *
 * One derivation, exported, because six walkers read `steps.items` — the search's body text,
 * two coverage gates, the worked-example gate, the help gate and the pane. Letting each of them do its
 * own `typeof it === "string"` is six chances for one of them to quietly stop counting a step.
 */
export const stepText = (it: string | GuideStep): string => (typeof it === "string" ? it : it.text);

/** Every step's text in a `steps` block. */
export const stepTexts = (b: Extract<GuideBlock, { kind: "steps" }>): string[] => b.items.map(stepText);

/**
 * Every picture a `steps` block hangs off its steps — for the gates that hold the manual's
 * images to the capture pipeline in both directions.
 */
export const stepShots = (): { file: string; alt: string; caption: string }[] =>
  GUIDE.flatMap((s) =>
    s.blocks.flatMap((b) =>
      b.kind === "steps" ? b.items.flatMap((it) => (typeof it === "string" || !it.shot ? [] : [it.shot])) : [],
    ),
  );

export const GUIDE: GuideSection[] = [
  // ───────────────────────────────── Start here ─────────────────────────────────
  {
    id: "overview",
    title: "What MadY is",
    group: "Start here",
    summary: "A scientific graphing and statistics program that runs entirely on your machine.",
    keywords: [
      "what is mady", "pronounce", "pronunciation", "offline", "local", "privacy", "no cloud",
      "welcome page", "first time", "where do i start", "new user", "splash",
    ],
    blocks: [
      {
        kind: "goal",
        text:
          "to know what this program is for, and what it does and does not do with your numbers.",
      },
      {
        kind: "note",
        text:
          "Beta version. MadY is unfinished software under active development. Assess every " +
          "analysis critically — results may contain inaccuracies. Check anything you intend to " +
          "publish, submit or act on against an established statistics package before you rely " +
          "on it, and treat a figure drawn here as a draft until you have done so.",
      },
      {
        kind: "p",
        text:
          "MadY turns tables of measurements into publication-quality figures, and runs the statistics " +
          "that go with them. It is built around one idea: your data, your graph and your analysis are " +
          "three views of the same living document. Edit a value in a table and the graphs drawn from it " +
          "redraw at once; an analysis built on it, and any graph that shows that analysis's result, is " +
          "marked out of date until you re-run it.",
      },

      { kind: "h", text: "How to say the name" },
      {
        kind: "p",
        text:
          "MadY is pronounced /ˈmædi/ — “MAD-ee”, like the name Maddie. MAD is also the median " +
          "absolute deviation, the robust spread statistic, which is the reading the name is meant " +
          "to carry.",
      },

      {
        kind: "note",
        text:
          "This manual is arranged in the order you are likely to need it: getting data in, laying it " +
          "out, drawing it, analysing it, and finishing the figure. The search box at the top matches " +
          "everything, so if you already know the word you are after, start there.",
      },
    ],
  },

  {
    id: "getting-started",
    title: "Getting started: your first graph",
    group: "Start here",
    summary: "From your own numbers to a styled, analysed graph — in four moves.",
    keywords: [
      "first graph", "quick start", "how do i start", "paste data", "import", "new graph",
      "make a graph", "style a graph", "run a test", "worked example", "beginner", "five minutes",
    ],
    blocks: [
      {
        kind: "goal",
        text:
          "your own numbers on the screen, drawn as a graph you have styled, with a statistic " +
          "underneath it — in four moves, none of which needs a file on disk first.",
      },

      { kind: "h", text: "Move 1 — get your numbers in" },
      {
        kind: "p",
        text:
          "Three doors for your numbers, all equal, all in the File menu (the table below adds a fourth, for an R " +
          "script's design). Nothing has to be a file first: a block of " +
          "cells on the clipboard is as good a starting point as a CSV.",
      },
      {
        kind: "steps",
        items: [
          {
            text:
              "Open the File menu. The three ways in sit at the top of it: Import data…, Paste data " +
              "as new datasheet…, and New datasheet / graph… for typing your own.",
            shot: {
              file: "start-data-doors.png",
              alt:
                "The File menu open, with numbered boxes around Import data…, Paste data as new " +
                "datasheet… and New datasheet / graph… near the top of the list.",
              caption:
                "The three ways numbers get into MadY, all in one menu. Every one of them ends at the same place: a datasheet you can edit.",
            },
          },
          {
            text:
              "Copied cells out of a spreadsheet? File ▸ Paste data as new datasheet… (Ctrl+Shift+V). " +
              "A preview opens showing how MadY read the block — which row is the names, whether the " +
              "first column is your X — and you fix it there before anything is created.",
          },
          {
            text:
              "Have a file? File ▸ Import data… (Ctrl+I), or just drop the file on the window. CSV, " +
              "text, Excel and OpenDocument all land in the same preview, where the delimiter, the " +
              "decimal mark, a units row and a comment prefix are all yours to set.",
          },
          {
            text:
              "Typing it yourself? File ▸ New datasheet / graph… asks for the shape of your data and " +
              "the graph it should support, then makes the blank sheet ready to type into. Press " +
              "Create and the sheet opens.",
          },
        ],
      },
      {
        kind: "table",
        head: ["You have", "Use", "What you get"],
        rows: [
          ["Cells on the clipboard", "File ▸ Paste data as new datasheet… (Ctrl+Shift+V)", "A preview of how the block was read, then a new datasheet."],
          ["A CSV, text, Excel or OpenDocument file", "File ▸ Import data… (Ctrl+I), or drop it on the window", "The same preview, plus the delimiter, decimal and units-row options — and the option to keep the sheet linked to the file."],
          ["Numbers still in your notebook", "File ▸ New datasheet / graph…", "A blank sheet in the shape you picked, with its graph made alongside it."],
          ["An R script", "File ▸ Import ggplot script (.R)…", "The script's design translated into a MadY graph on your datasheet."],
        ],
      },

      { kind: "h", text: "Move 2 — draw the graph" },
      {
        kind: "steps",
        items: [
          {
            text:
              "With the datasheet open, use the Graph menu. Graph ▸ New graph of this data is the " +
              "quick route — it opens the creator on that sheet with the best-fitting chart already " +
              "picked. Graph ▸ New graph… starts from scratch, and Graph ▸ Chart gallery… shows every " +
              "type as a live example you can open and edit.",
            shot: {
              file: "start-graph-doors.png",
              alt:
                "The Graph menu open, with numbered boxes around New graph…, Chart gallery… and New " +
                "graph of this data.",
              caption:
                "Three routes to a graph: from scratch, from the gallery of live examples, or straight from the sheet you have open.",
            },
          },
          {
            text:
              "In the creator, pick a chart type on the right. The panel underneath holds the new " +
              "sheet's settings — its format, the X type, sample data, entry mode, replicates, error " +
              "bars and where to file it — and the preview beside it draws what you would get.",
          },
          {
            text:
              "Press Create graph. The graph opens in its own tab, next to the datasheet it was " +
              "drawn from, and the two stay in step: edit a value and the graph redraws.",
            shot: {
              file: "start-first-graph.png",
              alt:
                "A finished dose-response graph on the canvas: two curves with error bars, a legend, " +
                "an axis title on each axis and the graph title above.",
              caption:
                "What Move 2 leaves you with. Everything you can see here — every point, line, number, title and legend entry — is clickable, and that is what Move 3 is about.",
            },
          },
        ],
      },

      { kind: "h", text: "Move 3 — make it look right" },
      {
        kind: "p",
        text:
          "There is one rule for styling in MadY and it covers almost everything: click the thing " +
          "you want to change, and the Inspector on the right becomes about that thing. You never " +
          "hunt through a settings tree for the part of the graph you are looking at.",
      },
      {
        kind: "steps",
        items: [
          {
            text:
              "Click a point, a bar, a line, an axis, a title or a legend entry on the figure. It is " +
              "drawn highlighted, with handles, so you can see exactly what you have.",
            shot: {
              file: "start-selected-series.png",
              alt:
                "A dose-response graph with one series selected: its points are drawn with selection " +
                "handles around them while the other series is left plain.",
              caption:
                "One series selected. The highlight is the answer to “what will my next change affect?”.",
            },
          },
          {
            text:
              "Look at the Inspector on the right. Its tab rail has switched to the tab that owns " +
              "what you clicked, and the panel under it holds that thing's settings. Nothing has to " +
              "be applied — type a number or pick a colour and the figure changes as you do it.",
            shot: {
              file: "start-inspector-opened.png",
              alt:
                "The top of the Inspector panel with the Data tab lit, the filter box under the tab " +
                "rail, and the first two groups of settings for the selected series — Plot as, and " +
                "Data points with its shape, size and colour controls.",
              caption:
                "The panel that opened. The seven tabs are the whole graph: Chart · Frame · Axis · Data · Text · Annotate · Style.",
            },
          },
          {
            text:
              "Cannot find a control? Type its name into the filter box at the top of the Inspector " +
              "and the panel narrows to the rows that match. If you would rather change the whole " +
              "look at once, the Style tab holds the presets — pick one and every part of the figure " +
              "moves together.",
          },
        ],
      },

      { kind: "h", text: "Move 4 — ask a question of the data" },
      {
        kind: "steps",
        items: [
          {
            text:
              "Open the Analyze menu. Analyze… is the front door: it opens on a page that recommends " +
              "what suits the sheet you came from, and groups the rest by the question you are asking " +
              "rather than by statistical name.",
            shot: {
              file: "start-analyze-menu.png",
              alt:
                "The Analyze menu open, with numbered boxes around Analyze… at the top and the " +
                "Common analyses submenu row beneath it.",
              caption:
                "Analyze… when you are not sure what you need; the named items below it when you are.",
            },
          },
          {
            text:
              "Pick the method, check the columns it will use, and press the confirm button on the " +
              "dialog. If you already know the job by name, Analyze ▸ Common analyses holds the front " +
              "doors — Dose-response…, Enzyme kinetics…, Receptor binding…, Interpolate a standard " +
              "curve… and Method comparison… — and each goes straight to its configured dialog.",
          },
          {
            text:
              "The answer arrives as its own Results tab, filed beside the datasheet it came from. " +
              "It carries the numbers a paper would quote, one line saying what they decide, and the " +
              "test's assumptions stated alongside — not buried in a footnote.",
            shot: {
              file: "start-result-tab.png",
              alt:
                "The top-left corner of the window after an ANOVA has run: the Navigator showing the " +
                "analysis indented under the datasheet it came from, and the tab rail above it with " +
                "the data, graph and result tabs gathered under that datasheet's name.",
              caption:
                "A result is a tab of its own, filed with the data that produced it — so a month later the numbers and their source are still together.",
            },
          },
          {
            text:
              "To put the answer on the figure, use “Add to graph” on the result's toolbar. The " +
              "significance brackets it draws stay in step with the analysis: re-run it and they follow.",
          },
        ],
      },
    ],
  },

  {
    id: "workspace",
    title: "Projects, experiments and tabs",
    group: "Start here",
    summary: "Filing your work in the Navigator, finding it again, and saving just part of it.",
    keywords: [
      "project", "experiment", "folder", "file my work", "navigator", "tree", "rename",
      "colour tag", "find", "search names", "tabs", "tab rail", "save part", "save one graph",
      "methods and notes", "delete", "demo project", "sample data", "illustrative",
    ],
    blocks: [
      {
        kind: "goal",
        text:
          "your work filed so that in a month you can still find the graph, the numbers behind it " +
          "and the analysis that produced them — and save any one of those three on its own.",
      },
      {
        kind: "p",
        text:
          "The Navigator on the left is your filing cabinet: projects contain experiments, and " +
          "experiments contain the datasheets, graphs and analyses that belong together. Filing is " +
          "optional — anything you never file stays available at the top level — but it is what makes " +
          "the Find box useful later.",
      },
      {
        kind: "note",
        text:
          "The Demo Project that MadY opens with is there to show what the program can do. Its data " +
          "are illustrative only and should not be cited or used as a source.",
      },

      { kind: "h", text: "File your work into projects and experiments" },
      {
        kind: "p",
        text:
          "Filing happens when a thing is created, not afterwards. There is no dragging in the " +
          "tree: you make a datasheet, a graph or a figure inside the experiment you want it in, " +
          "using the small buttons on that experiment's own row.",
      },
      {
        kind: "steps",
        items: [
          {
            text:
              "Make the folder first: File ▸ New project, or the “Start a new project” tile on the " +
              "Welcome page. It appears in the Navigator as an empty project.",
            shot: {
              file: "start-navigator.png",
              alt:
                "The Navigator dock: a Find box at the top, then a project folder opened to show an " +
                "experiment containing a datasheet with its graph and analysis indented under it, " +
                "and the small add / pin / colour / delete buttons on the rows.",
              caption:
                "The Navigator. A graph and an analysis are indented under the datasheet they were made from, so what belongs to what is visible without opening anything.",
            },
          },
          {
            text:
              "Hover the project's row and press “Add experiment”. Then, on the experiment's own row, " +
              "the buttons make things directly inside it: Add dataset, Add graph of this experiment's " +
              "data, and New panel figure.",
          },
          {
            text:
              "The New datasheet / graph creator files too. Its settings panel has an “Add to” row " +
              "— a project (or “New project…”) and then an Experiment — so a sheet made from the " +
              "File menu lands in the right place instead of loose at the top level.",
          },
          {
            text:
              "Double-click the name of a project, an experiment or a graph to rename it: type, then " +
              "Enter or click away; Escape leaves it as it was. A graph with no title of its own draws " +
              "its name as the title, so this renames the title on the figure too. On every row, " +
              "the two small buttons do the rest: the pin sorts it to the top of its " +
              "container, and the swatch gives it a highlight colour — the fastest way to mark what " +
              "is finished and what is not.",
          },
          {
            text:
              "Each project also carries its own Methods & notes tab, for your own writing — decisions, " +
              "protocol details, how you want the work cited. That is your text, separate from this " +
              "documentation and from the analysis log.",
          },
        ],
      },

      { kind: "h", text: "Find something you have lost" },
      {
        kind: "steps",
        items: [
          {
            text:
              "Type into the Find box at the top of the Navigator. It matches names anywhere in the " +
              "tree, so a partial word is enough, and containers open themselves around a hit.",
          },
          {
            text:
              "Narrow it by kind with an “@” prefix, then a word: “@graph dose”. The kinds are " +
              "@data (or @table), @graph (or @plot), @analysis (or @result) and @figure (or @layout).",
          },
          {
            text:
              "If you know the object was open recently, Alt+← and Alt+→ step back and forward " +
              "through the tabs you have visited, like a browser. The mouse thumb buttons do the same.",
          },
          {
            text:
              "A row marked “stale” is one whose numbers have moved on since it was computed — an " +
              "analysis whose datasheet was edited under it. Open it and re-run to clear the badge.",
          },
        ],
      },

      { kind: "h", text: "What the tab rail across the top is showing you" },
      {
        kind: "p",
        text:
          "The tab rail shows what you have open — and it groups the tabs by the datasheet they came " +
          "from, not by kind. A datasheet, the graphs drawn from it and the analyses run on it sit " +
          "in one coloured group, in that order, so the tabs from two different experiments never " +
          "interleave. Anything with no datasheet behind it — the Welcome page, this manual, a " +
          "project's notes — is gathered under “Other”.",
      },
      {
        kind: "p",
        text:
          "Each group has a label at its left-hand end, and it changes with the group's state: while " +
          "the group is open the label is just a narrow coloured handle, and folded it shows the " +
          "group's name and how many tabs are inside. Either way, clicking it folds or unfolds the " +
          "group.",
      },
      {
        kind: "shot",
        file: "start-tab-rail.png",
        alt:
          "The tab rail: a teal group holding the “Sample — dose vs response” datasheet tab and the " +
          "“Dose-response” graph tab, then a folded grey group labelled “Other” with a count of 1.",
        caption:
          "Grouped by datasheet, not by kind — so everything belonging to one experiment stays together, whatever order you opened it in. The grey group here is folded shut.",
      },
      {
        kind: "p",
        text:
          "Multi-panel figures are the exception: they do not live in the tab rail at all. They open " +
          "in their own full-page builder from the Navigator, because assembling a figure is a " +
          "different activity from editing one graph.",
      },

      { kind: "h", text: "Save the whole workspace, or just one graph" },
      {
        kind: "steps",
        items: [
          {
            text:
              "Press Ctrl+S (File ▸ Save…). Before the file dialog, MadY asks what to keep — the " +
              "whole workspace, one project folder, one experiment, or a single graph.",
            shot: {
              file: "start-save-part.png",
              alt:
                "The save-what dialog: a tick box for everything at the top, then the project tree " +
                "with a tick box on each folder, experiment, datasheet, graph and result.",
              caption:
                "Saving does not have to mean the whole workspace. Tick the part you want and it is written as an ordinary project file of its own.",
            },
          },
          {
            text:
              "Tick what you want. A part travels with the data it needs — tick a graph and its " +
              "datasheet goes with it — so the file you write opens as a complete project rather than " +
              "as a graph with nothing behind it.",
          },
          {
            text:
              "Read the button before you press it: it says “Save everything…”, “Save this graph…” " +
              "or “Save 4 items…” depending on what is ticked. The built-in sample project starts " +
              "unticked and folded shut, because almost nobody means to save the demo with their own work.",
          },
          {
            text:
              "Autosave is running the whole time regardless, and a crash is recovered from it " +
              "rather than from the last time you pressed Ctrl+S. Ctrl+S is for writing a file you " +
              "will hand to someone.",
          },
        ],
      },

      { kind: "h", text: "If it goes wrong" },
      {
        kind: "ul",
        items: [
          "Double-clicking a datasheet or an analysis does not rename it: projects, experiments and graphs can be renamed, those two cannot. They keep the name they were given when they were made — from the file you imported, or from the datasheet they were drawn from.",
          "You renamed a graph and its title did not change: the graph has a title of its own. Double-click the title on the figure to change that.",
          "You deleted an experiment and its contents went with it: that is what deleting a container does — an experiment takes its members, a project takes everything in it. Ctrl+Z brings it all back; deletion is undoable like anything else.",
          "The Find box shows nothing: an “@” prefix is filtering by kind. Clear it, or check the kind you typed (“@graph”, “@data”, “@analysis”, “@figure”).",
          "A graph you saved on its own opens with no numbers: it cannot — a saved part carries its datasheet. If a graph really is empty, its datasheet was emptied, not missing.",
          "A tab you want is not in the rail: its group is collapsed. Click the coloured group label to open it again.",
          "The figure you are looking for is not in the tab rail at all: multi-panel figures open from the Navigator into their own full-page builder.",
        ],
      },
    ],
  },

  {
    id: "interface",
    title: "The window: panels, docks and layouts",
    group: "Start here",
    summary: "Everything around the figure can be moved, resized, hidden or saved under a name.",
    keywords: [
      "dock", "panel", "resize", "collapse", "layout", "workspace layout", "toolbar", "reorder",
      "theme", "dark mode", "light mode", "zoom", "status bar", "command palette", "ctrl+k",
      "analysis log", "reset layout",
    ],
    blocks: [
      {
        kind: "goal",
        text:
          "a window arranged for the job in front of you — a wide canvas for drawing, a wide table " +
          "for typing — and saved under a name so you can get it back with one click.",
      },

      { kind: "h", text: "The parts of the window" },
      {
        kind: "shot",
        file: "the-window.png",
        alt:
          "The MadY window: the project tree on the left, an open dose-response graph with its " +
          "toolbar in the centre, the Inspector dock on the right, and the analysis log and status " +
          "bar along the bottom edge.",
        caption:
          "The working window: the project tree on the left, the open graph and its toolbar in the " +
          "middle, the Inspector on the right, and the analysis log and status bar along the bottom.",
      },
      {
        kind: "p",
        text:
          "The side panels are docks, and a dock is not fixed where it starts. A wide figure with a " +
          "narrow Inspector is a different working posture from a narrow figure with a wide table, " +
          "and MadY does not make you choose once.",
      },

      { kind: "h", text: "Move, resize and collapse the panels" },
      {
        kind: "steps",
        items: [
          {
            text:
              // Note: "name strip", not "title strip". `guideSearch.test.ts` checks this word:
              // with "move" already all over the chapter, one stray "title" is enough to take
              // the query "move the title" away from "Moving, resizing and zooming", which is
              // where someone asking about a graph title must land.
              "Drag a dock's header — the grip and name strip at its top — to move it to the other " +
              "side of the window.",
          },
          {
            text:
              "Drag the divider between a dock and the canvas to resize it. Double-click that same " +
              "divider to collapse the dock entirely; the chevron on the dock's own header does the " +
              "same thing.",
          },
          {
            text:
              "A collapsed dock leaves a thin labelled rail at the edge. Press the arrow on it to " +
              "bring the dock back — nothing inside it was closed or lost.",
          },
          {
            text:
              "The toolbar is drag-to-reorder: put the buttons you use where your hand expects them. " +
              "View ▸ Reset toolbar layout undoes that, and View ▸ Reset layout puts every panel back.",
          },
        ],
      },

      { kind: "h", text: "Save an arrangement and switch between them" },
      {
        kind: "steps",
        items: [
          {
            text:
              "Arrange the window the way you want it, then open View ▸ Layouts… (or the Layout " +
              "button in the status bar).",
            shot: {
              file: "start-layouts-menu.png",
              alt:
                "The Layouts popover: the built-in layouts Default, Wide canvas and Analysis listed " +
                "as buttons, and a “Save current as…” box with a Save button at the foot.",
              caption:
                "Three layouts are built in; anything you save joins them, with an ✕ beside it to remove it again.",
            },
          },
          {
            text:
              "Type a name into “Save current as…” and press Save. It joins the list, and clicking it " +
              "later restores that arrangement.",
          },
          {
            text:
              "The three built-in layouts — Default, Wide canvas and Analysis — are always there, so " +
              "there is always a way back without deleting anything of your own.",
          },
        ],
      },

      { kind: "h", text: "Zoom, theme, and the bottom edge of the window" },
      {
        kind: "steps",
        items: [
          {
            text:
              "Zoom with Ctrl+= and Ctrl+-, Ctrl+scroll, or the zoom control in the status bar. " +
              "Ctrl+0 goes back to 100%, and View ▸ Set zoom level… takes an exact number.",
            shot: {
              file: "start-status-bar.png",
              alt:
                "The status bar along the bottom of the window: the dataset and graph count on the " +
                "left, and on the right the Layout button, the zoom control, and the engine and saved state.",
              caption:
                "The status bar answers four questions at a glance: how much is in the document, how the window is laid out, what the zoom is, and whether the statistics engine is up.",
            },
          },
          {
            text:
              "View ▸ Toggle light/dark switches the theme. Exporting from a dark theme onto a light " +
              "page re-colours for the page rather than baking pale ink onto white.",
          },
          {
            text:
              "The Analysis log along the bottom edge expands to show what the program has been " +
              "doing, newest first, and each entry opens the thing it is about — useful when " +
              "something took longer than you expected.",
          },
        ],
      },

      { kind: "h", text: "Ctrl+K — usually faster than the menus" },
      {
        kind: "steps",
        items: [
          {
            text:
              "Press Ctrl+K anywhere. Type a few letters of what you want; the list narrows as you " +
              "type and Enter runs the top hit.",
            shot: {
              file: "start-command-palette.png",
              alt:
                "The command palette open over the window: a search box with typed text, a list of " +
                "matching commands with their menu names beside them, and an “In the manual” group " +
                "of chapter hits below them.",
              caption:
                "Commands first, and under them what the manual can answer — so a question with no command behind it still lands somewhere.",
            },
          },
          {
            text:
              "It searches every command in the program, including ones whose menu you have not " +
              "learned yet, and shows each one's menu beside it so you learn where it lives.",
          },
          {
            text:
              "Below the commands it lists what this manual can answer. A question with no command " +
              "behind it — “transparent background”, “dpi”, “log scale” — still lands somewhere.",
          },
        ],
      },

      { kind: "h", text: "If it goes wrong" },
      {
        kind: "ul",
        items: [
          "A panel has vanished: it is collapsed, not closed. Look for the thin labelled rail at that edge of the window and press its arrow, or use View ▸ Reset layout.",
          "The Inspector is folded to a thin rail on the Welcome page, a datasheet, an analysis or the Chart gallery: that is deliberate. Those pages have no graph to set, so it opens by itself when you open a graph; press the rail's arrow to open it anyway.",
          "Everything is enormous or tiny: the view zoom is not 100%. Ctrl+0 resets it, or read the current value in the status bar's zoom control.",
          "The toolbar buttons are in the wrong order after a drag: View ▸ Reset toolbar layout.",
          "A saved layout is gone: user layouts are removed with the ✕ beside them in View ▸ Layouts…, which is the only thing that deletes one. The three built-in layouts cannot be deleted.",
        ],
      },
    ],
  },

  // ────────────────────────────── Worked examples ───────────────────────────────
  /**
   * Walkthroughs of the jobs people actually open the program to do.
   *
   * The rest of the manual is arranged by surface — the Axis tab, the Analyze dialog, the
   * assembler's ribbon — and answers "what is this control". That is the right shape for looking
   * something up and the wrong shape for the first hour, when the question is "I have numbers and
   * I need a figure by Friday".
   *
   * Every menu path, dialog and button named in a step is checked against the program.
   * `guide-walkthroughs.test.ts` walks each `steps` block, pulls out every "Menu ▸ Item" it names,
   * and fails if the command registry does not have it. A walkthrough that tells someone to press
   * something that is not there is worse than none at all, because the reader will assume the
   * mistake is theirs.
   */
  {
    id: "guided-tours",
    title: "Guided tours",
    group: "Start here",
    summary: "Walkthroughs that run inside the program: the window dims, the next control lights up, and each step completes when you have done it.",
    // Tour words only. Naming the capabilities the tours visit ("axis break", "t test") would make
    // this chapter out-rank the chapters that own those controls in the manual's search.
    keywords: ["tour", "guided tour", "tutorial", "walkthrough", "learn", "beginner", "show me", "interactive", "step by step", "lesson"],
    blocks: [
      {
        kind: "goal",
        text:
          "to learn a part of MadY by doing it, with the program pointing at each control in turn — instead of " +
          "reading about it here and then hunting for it there.",
      },
      {
        kind: "p",
        text:
          "A guided tour runs in the window you are working in. The rest of the program darkens, a ring lights " +
          "the control to press, and a small card says what to do and why. The step completes when the document " +
          "shows it was done — a table appeared, an axis got a cut, a colour changed — not when something was " +
          "clicked, so taking another road to the same place counts. Nothing is locked: every other control still " +
          "works, Next moves on (doing the step for you if you have not), and ✕ leaves the tour where it is. Ctrl+Z undoes any change a tour led " +
          "you to make, one at a time.",
      },
      { kind: "tours" },
      {
        kind: "p",
        text:
          "Start one from Help ▸ Guided tours, from the Guided tours card on the Welcome page, or from the buttons " +
          "above. The styling tours work on whatever graph is in front — open one first, or let the tour's first " +
          "step take you to the demo project's Dose-response. Compare groups wants a Column datasheet (one column " +
          "per group); the demo's Replicate readouts is one.",
      },
      {
        kind: "note",
        text:
          "A tour is the same path as the worked example it is drawn from, so if you would rather read than be " +
          "shown, the next chapters have each one as numbered steps with a picture per step.",
      },
    ],
  },
  {
    id: "videos",
    title: "Videos",
    group: "Start here",
    summary: "Five short screen recordings of the program at work — a presentation of MadY, then a graph, an analysis, style presets and a figure.",
    keywords: ["video", "videos", "screencast", "screen recording", "watch", "demo", "demonstration", "tour", "overview", "show me"],
    blocks: [
      {
        kind: "goal",
        text: "to see the main jobs done once, start to finish, before doing them yourself.",
      },
      {
        kind: "p",
        text:
          "Each video is the program itself, filmed while it was used: the pointer, the orange ring round the control " +
          "about to be pressed, and the caption bar are drawn on top, and everything under them is MadY exactly as it " +
          "ships. All five videos are narrated. Press ▶ to play; the player's own controls pause, skip and go full screen.",
      },
      { kind: "h", text: "MadY in a minute and a half" },
      {
        kind: "video",
        file: "video-mady-presentation.webm",
        alt:
          "A narrated presentation cut to music: the MadY title, \"Over 50 graph types\", \"49 analyses\" and \"Every part " +
          "editable\", then five scenes, each with a title: the chart gallery restyled by one setting and a card opened as " +
          "a real graph; a dose-response graph's points, axes and title clicked and changed; style presets restyling a " +
          "graph in one click; an analysis set up from a question, its assumptions checked and its result shown; and four " +
          "graphs assembled into an aligned, lettered figure. It ends on \"Local. Offline. Yours.\" and the closing card.",
        caption:
          "The whole program in a minute and a half: the gallery, editing any part, style presets, an analysis and an " +
          "aligned figure.",
      },
      { kind: "h", text: "Make a graph and adjust it" },
      {
        kind: "video",
        file: "video-graph-basics.webm",
        alt:
          "A screen recording: a datasheet is opened from the project tree, Graph ▸ New graph of this data makes an XY " +
          "graph, the data points are clicked and recoloured, their shape changed to squares, the title double-clicked and " +
          "retyped, gridlines and a box frame switched on, one change undone with Ctrl+Z, and the Export button shown.",
        caption:
          "From a datasheet to a finished graph: make it, click any part to change it, double-click any text to retype it, " +
          "and undo anything with Ctrl+Z.",
      },
      { kind: "h", text: "Analyse your data" },
      {
        kind: "video",
        file: "video-analysis.webm",
        alt:
          "A screen recording: the Replicate readouts datasheet is opened, Analyze ▸ Analyze… offers analyses for it, the " +
          "Compare groups goal is chosen, the test changed to one-way ANOVA with all three groups ticked, Run shows the key " +
          "result, every comparison and a one-line verdict, the significance markers are ticked on, and the violin plot of " +
          "the same data now carries the brackets.",
        caption:
          "Say what you want to know, check the test it sets up, run it, and tick one box to put the result on the graph — " +
          "where it stays tied to the analysis.",
      },
      { kind: "h", text: "Style presets: try, save, share" },
      {
        kind: "video",
        file: "video-presets.webm",
        alt:
          "A screen recording: on the treatment bar chart the Style tab's preset cards are clicked one after another — " +
          "Scientific Journal, Bold infographic, Editorial, Grayscale, Universal design — each restyling the whole graph; " +
          "the Editorial look is saved as a preset named Our lab style, starred as the default, applied to the dose-response " +
          "graph with one click, then Manage… shows the controls to reorder, rename and export it, and a colleague's " +
          "preset file is imported.",
        caption:
          "A preset is a whole look — fonts, axes, grid, palette — in one click. Save your own, star it as the default for " +
          "new graphs, and export it as a file to share with your lab.",
      },
      { kind: "h", text: "Assemble a multi-panel figure" },
      {
        kind: "video",
        file: "video-figure.webm",
        alt:
          "A screen recording: Insert ▸ New layout lists the project's graphs, four are ticked — the dose-response curve, " +
          "the treatment bar chart, the dose-group violin and the quarterly lollipop — Build / Arrange lays them out as " +
          "panels A to D, Align all lines their axes up, the Columns setting re-lays them in one row and back into two, the " +
          "panel letters switch to lower case and back, the canvas is zoomed in and out, and the Linked to sources badge " +
          "and the Export button are shown.",
        caption:
          "Pick the graphs, press Build / Arrange, then Align all: the axes line up across panels and every graph fills its " +
          "card. The panels stay linked to their graphs, so an edit to a graph reaches the figure.",
      },
    ],
  },
  {
    id: "tut-first-graph",
    title: "From your numbers to a finished figure",
    group: "Worked examples",
    summary: "Numbers in one window, a publication-sized image out — the whole path, once.",
    keywords: [
      "worked example", "walkthrough", "how do i", "first graph", "beginner", "start", "step by step",
      "make a chart", "paste data", "export image", "getting started", "excel", "from scratch",
    ],
    blocks: [
      {
        kind: "goal",
        text:
          "a publication-sized image of your own numbers — pasted in, drawn, titled and exported — with nothing to learn beyond these seven steps.",
      },
      {
        kind: "p",
        text:
          "This is the shortest complete path through MadY: numbers into a datasheet, a graph off " +
          "that datasheet, a few edits, and a file you can put in a manuscript. Everything else in " +
          "the manual is a detail of one of these seven steps.",
      },
      {
        kind: "steps",
        items: [
          "Copy your numbers. In Excel, Sheets, a text editor — select the block including the column headings, and copy.",
          "In MadY, File ▸ Paste data as new datasheet… (Ctrl+Shift+V). The import preview opens on what you pasted. It is the real datasheet grid, so check the columns split where you expect; if they have not, set Delimiter and Decimal separator until they do. Press Import (the button counts your rows — “Import 24 rows”).",
          "The new datasheet opens. The chip above it says its format — XY, Column, Grouped and so on. The format is what decides which graphs and which analyses are offered, so if it guessed wrong, click the chip and pick the right one now rather than later.",
          "Graph ▸ New graph of this data. The dialog opens on the sheet you are looking at, with the chart that best fits it already selected and the rest offered beside it. Pick one, and press Create graph.",
          "The graph opens. Click any part of it — a bar, a point, an axis, the title, the legend — and the Inspector on the right becomes the controls for exactly that thing. Change a colour; press Ctrl+Z if you do not like it.",
          "Double-click the title and type the real one. The same works on axis titles, the legend's names and every data label.",
          "File ▸ Export… (Ctrl+E). Choose the format (PNG for a submission, PDF or SVG if the journal wants vector), set Print width to your journal's column width, and press Export PNG…. The line above the button always states the final pixel size and how large it will print.",
        ],
      },
      {
        kind: "shot",
        file: "tut-paste-preview.png",
        alt:
          "Step 2: the import preview over pasted text, with the Delimiter set to semicolon, the " +
          "Decimal separator to comma, the datasheet grid showing Dose, Control and Treated split " +
          "correctly, and an Import 5 rows button.",
        caption:
          "Step 2 — the preview is the datasheet itself. Set Delimiter and Decimal separator until the " +
          "columns split where you expect, then press the button that counts your rows.",
      },
      {
        kind: "shot",
        file: "tut-new-graph.png",
        alt:
          "Step 4: the New graph dialog opened on the sample sheet, with the graph-type cards, the " +
          "sheet's own settings panel below them, and a Create graph button.",
        caption:
          "Step 4 — opened on the sheet you are looking at: every graph it can draw, the best fit " +
          "already picked, and the sheet's own settings underneath.",
      },
      {
        kind: "note",
        text:
          "Nothing above has to be a file first: you can also drop a CSV or Excel file on the " +
          "window, or make a blank sheet and type into it. See Getting data in for every door.",
      },
      {
        kind: "note",
        text:
          "Prefer to be shown? Help ▸ Guided tours runs these same steps inside the program: the " +
          "window dims, the next control to press lights up, and each step completes when you " +
          "have done it. Nothing is locked — every other control still works while it runs. " +
          "The Guided tours chapter lists the others.",
      },
      {
        kind: "ul",
        items: [
          "The graph looks wrong for your data? The format chip is almost always why. Table formats explains the fifteen shapes and what each one unlocks.",
          "Want the same look next time? Style one graph the way you like it, then save it as a preset — Presets and defaults.",
          "Need statistics on it? Carry straight on to Compare groups and put the stars on the chart.",
        ],
      },

      { kind: "h", text: "If it goes wrong" },
      {
        kind: "ul",
        items: [
          "The paste preview split your numbers into one column: the Delimiter is wrong. It is a setting in the preview — fix it there, before the sheet exists.",
          "Your numbers arrived as text: the Decimal separator is wrong (a comma decimal read as a point, or the reverse). Also in the preview.",
          "The chart you want is greyed out in the New-graph dialog: the sheet's format cannot draw it. Click the format chip above the grid and pick the right shape — Table formats explains the fifteen.",
          "You clicked the figure and the Inspector stayed empty: you hit the page rather than the plot. Click a bar, a point, or inside the axes.",
          "Double-clicking the title did nothing: that text is computed, not typed — a tick number, a fitted parameter. Change what produces it, not the string.",
          "The exported image is blurry: it went out at screen resolution. Set a DPI, or a print width in millimetres, and read the pixel count the dialog states above the button.",
        ],
      },
    ],
  },
  {
    id: "tut-compare-groups",
    title: "Compare groups and put the stars on the chart",
    group: "Worked examples",
    summary: "A t test or an ANOVA, and the significance brackets that come from it — not drawn by hand.",
    keywords: [
      "worked example", "how do i", "significance", "stars", "asterisk", "p value", "t test", "anova",
      "compare", "brackets", "post hoc", "error bars", "step by step",
    ],
    blocks: [
      {
        kind: "goal",
        text:
          "a bar or box chart of your groups with real p-values marked on it — bound to the analysis, so a re-run keeps every star right instead of leaving you to redraw them.",
      },
      {
        kind: "p",
        text:
          "The commonest job at a bench: three or four treatment groups, a bar or box chart of " +
          "them, and the p-values marked on it. The brackets here are not decoration you position " +
          "by hand — each one knows which two groups it joins and which comparison it came from, so " +
          "changing the data changes the stars.",
      },
      {
        kind: "steps",
        items: [
          "Get the groups into a Column datasheet: one column per group, the replicates running down the rows. (Insert ▸ New table ▸ Column table for a blank one, or set the format chip on a sheet you already have.)",
          "Graph ▸ New graph of this data, and pick a chart that shows groups — a bar chart, a box plot, a violin or a column scatter. Press Create graph.",
          "Back on the datasheet, Analyze ▸ Analyze… and click the “Compare groups” goal tile. (The landing page also recommends tests for the sheet, when it has something to recommend.)",
          "The tile opens on a t test — right for two groups. For three or more, change Test to One-way ANOVA at the top of the configure page. The variant list explains itself: unpaired, paired, Welch's for unequal spread, or a nonparametric alternative, each with a note on when to use it.",
          "Tick the columns you are comparing. Once Test is One-way ANOVA a Post-hoc test row appears: Tukey compares every pair. Choose Dunnett instead and a Control group picker appears under it, comparing each group against the one you name. Press Run.",
          "Read the result. The Key result cards give the numbers a paper quotes, the line under them says what they decide, and the table below lists every comparison with its p.",
          "Put them on the graph: tick “Significance markers on the graph”, just under the result's toolbar. Only the comparisons that clear your threshold are drawn, stacked so nested ones read cleanly — and they stay bound to this analysis, so a re-run refreshes every p and drops whatever stopped being significant. Unticking removes exactly the ones it drew.",
          "Tune what counts as significant with Design ▸ Significance thresholds & labels… — the cut-offs, the symbols they print, and whether “ns” is shown at all.",
        ],
      },
      {
        kind: "shot",
        file: "tut-analyze-goal.png",
        alt:
          "Step 3: the Analyze dialog's landing page on a three-group sheet, with the Compare " +
          "groups goal tile among the thirteen tiles and a Browse all analyses button below them.",
        caption:
          "Step 3 — the goal tiles, ordered for the sheet you opened this from. Compare groups is " +
          "the one this walkthrough uses.",
      },
      {
        kind: "shot",
        file: "tut-analyze-configure.png",
        alt:
          "Steps 4 and 5: the configure page with Test set to One-way ANOVA, a Post-hoc test row " +
          "set to Dunnett, a Control group picker below it, and a Make default tickbox at the foot.",
        caption:
          "Steps 4-5 — the tile opens on a t test; change Test to One-way ANOVA and the Post-hoc " +
          "row appears. Choose Dunnett and the Control group picker appears under it.",
      },
      {
        kind: "shot",
        file: "tut-sig-tickbox.png",
        alt:
          "Step 7: an ANOVA result with the Significance markers on the graph tickbox under its " +
          "toolbar, an Add to graph menu button, and the Key result cards below.",
        caption:
          "Step 7 — the tickbox, not the menu. It keeps the brackets bound to this analysis, so a " +
          "re-run refreshes every p; Add to graph is the one-shot alternative.",
      },
      {
        kind: "note",
        text:
          "Add to graph ▸ Significance brackets does the same thing once, and it is only offered " +
          "while the tickbox has not been used — a menu item that adds a second copy of markers you " +
          "already have reads as a duplicate, so it goes away once they are bound.",
      },
      {
        kind: "ul",
        items: [
          "Too many pairs for brackets? Add to graph ▸ Letters (CLD) instead — groups sharing a letter are not significantly different.",
          "A bracket in the wrong place is draggable, and its label is editable; clear the text and the live p comes back. Significance markers has the shapes, legs and symbol vocabularies.",
          "No brackets offered? The analysis has to have pairwise comparisons in it, and the graph has to be one that can carry them — a pie or a network has nothing to anchor to, and the program says so rather than drawing nothing.",
        ],
      },

      { kind: "h", text: "If it goes wrong" },
      {
        kind: "ul",
        items: [
          "The Post-hoc test row never appeared: it belongs to One-way ANOVA. On a t test there is nothing to correct for — change Test at the top of the configure page.",
          "There is no Control group picker: it appears under Post-hoc only once you choose Dunnett. Tukey compares every pair, so it has no control to name.",
          "Fewer brackets appeared than comparisons: only the ones that clear your threshold are drawn. Change the ladder in Design ▸ Significance thresholds & labels…, or unhide the non-significant markers.",
          "“Significance markers on the graph” is not there: the analysis has no pairwise comparisons in it, or the chart cannot carry brackets — a pie or a network has nothing to anchor to.",
          "You edited the data and the stars are stale: they are a readout of the analysis. Re-run it and they refresh.",
          "Your groups came out as one bar: they are in one column with their names beside them. A Column sheet is one column per group — Data ▸ Reshape data (wide ↔ long)… fixes it.",
        ],
      },
    ],
  },
  {
    id: "tut-dose-response",
    title: "Fit a dose-response curve and read the EC50",
    group: "Worked examples",
    summary: "Concentrations and responses in, a fitted curve with its EC50 printed on the graph out.",
    keywords: [
      "worked example", "how do i", "ec50", "ic50", "dose response", "curve fit", "4pl", "sigmoid",
      "potency", "nonlinear regression", "step by step",
    ],
    blocks: [
      {
        kind: "goal",
        text:
          "a fitted dose-response curve with its EC50 marked on the graph rather than buried in a table, and the parameters typeset the way a journal prints them.",
      },
      {
        kind: "p",
        text:
          "The four-parameter logistic is the workhorse of pharmacology, and MadY treats it as one " +
          "analysis with a large catalogue of equations behind it. You do not have to log your " +
          "doses first — the model comes in log-dose and concentration forms.",
      },
      {
        kind: "steps",
        items: [
          "Put the data in an XY datasheet: the dose or concentration in the X column, the response in a Y dataset. Replicates go in that dataset's sub-columns, so the fit uses every point rather than a mean you computed yourself.",
          "Analyze ▸ Common analyses ▸ Dose-response…. (Analyze ▸ Analyze… and the “Dose-response” goal tile land in the same place.)",
          "Pick the model. Family is Dose-response; Type is 4PL — variable slope for the usual case. Use an Inhibition model for a curve that falls, and a Normalized one if your Y already runs 0–100%. The exact equation being fitted is printed under the picker, so there is no guessing which parameterisation you got.",
          "Optional: constrain a parameter. Tick Fix beside Bottom or Top — a value box appears — and type the plateau when you know it. A fit with two points on a shoulder is better anchored than free.",
          "Set Weighting if the scatter grows with Y (least squares assumes it does not), and Confidence for the intervals. Tick Make default if you fit this model often — the settings come back next time. Press Run.",
          "Read the result: the fitted parameters with their confidence limits, the EC50 (and its log), R² and the assumption checks. A fit that breached one of your flag thresholds is banded “Fit flagged as questionable” with the reason.",
          "Add to graph ▸ the fitted curve. The curve is drawn through the points, the EC50 is marked on the graph rather than left in a table, and the parameter block can be typeset inside the axes the way journals print it.",
        ],
      },
      {
        kind: "shot",
        file: "tut-dose-configure.png",
        alt:
          "Steps 3 to 5: the dose-response configure page with Family on Dose-response, the exact " +
          "4PL equation printed under the model picker, per-parameter Fix boxes, a Weighting " +
          "dropdown and a Make default tickbox.",
        caption:
          "Steps 3-5 — the family, the exact equation that will be fitted, the constraints, and " +
          "the weighting. Ticking Fix beside a parameter is what makes its value box appear.",
      },
      {
        kind: "ul",
        items: [
          "Comparing two compounds? Fit them together with Global curve fit and share logEC50 — that is the test of whether their potencies differ, and a single curve cannot do it.",
          "Reading unknowns off a standard curve is its own door: Analyze ▸ Common analyses ▸ Interpolate a standard curve….",
          "Is the extra parameter earning its place? Compare models weighs them by AICc. Curve fitting lists the whole equation catalogue.",
        ],
      },

      { kind: "h", text: "If it goes wrong" },
      {
        kind: "ul",
        items: [
          "The fit did not converge: the starting values could not reach a solution. Fix a parameter you already know (a Top of 100 for a normalised response), or try a 3PL before a 5PL.",
          "The EC50 is absurd but the curve looks fine: an unconstrained fit can put Bottom or Top anywhere. Tick Fix beside the plateau your experiment already decides.",
          "The curve falls and the numbers read as an EC50: use an Inhibition model. Family is the same; Type is what changes.",
          "Your Y already runs 0–100 %: use a Normalized model rather than letting the fit find plateaus it does not need to.",
          "The result is banded “Fit flagged as questionable”: it breached one of your flag thresholds, and the reasons are printed with the band, above the numbers.",
          "A good R² is not proof the equation was right — it only says the curve passes near the points. Compare models (AICc) asks the sharper question.",
        ],
      },
    ],
  },
  {
    id: "tut-heatmap",
    title: "A clustered heatmap of a matrix",
    group: "Worked examples",
    summary: "Genes × conditions, clustered, with a strip that says what each row is.",
    keywords: [
      "worked example", "how do i", "heatmap", "matrix", "cluster", "dendrogram", "genes", "expression",
      "annotation strip", "colour scale", "step by step",
    ],
    blocks: [
      {
        kind: "goal",
        text:
          "a clustered heatmap of your matrix, coloured on a scale whose middle means what you say it means, with a strip beside the rows saying what each one is.",
      },
      {
        kind: "p",
        text:
          "A matrix heatmap wants the plainest sheet in the program: the row names down the first " +
          "column, one numeric column per condition, one value per cell. Everything else — the " +
          "clustering, the strips, the splits — is turned on afterwards.",
      },
      {
        kind: "steps",
        items: [
          "Lay the matrix out: the first column holds the row names (genes, samples, sites), and every other column is one condition, holding numbers.",
          "Graph ▸ New graph of this data. A matrix sheet leads with the heatmap; press Create graph.",
          "Click the plot to select the graph, then open the Inspector's Chart tab and its Heatmap section.",
          "Choose the colour ramp, and pin what the middle colour means with Centre at — a blue-white-red map should put white on zero, not halfway up the range.",
          "Cluster it: set Cluster to Rows, Columns or both. Distance and Linkage appear underneath once it is on — there is nothing to configure until then — and the dendrograms are drawn in the margins the clustering earns.",
          "Say what the rows are: add a row strip and point it at a column of your sheet (treatment, timepoint, responder). That column drops out of the matrix so it is not drawn twice, and text values take one colour each while numbers shade through a ramp.",
          "Split it into blocks if the groups are known in advance — a break after a named row or column, drawn as a space, a rule, or a rule inside a space — or, once the rows are clustered, cut the tree into blocks with Row blocks from tree."
        ],
      },
      {
        kind: "shot",
        file: "tut-heatmap-panel.png",
        alt:
          "Steps 3 to 7: the Inspector's Heatmap section with Cluster set to both, the Distance and " +
          "Linkage rows it revealed, a Centre at box, and an Add a row strip button.",
        caption:
          "Steps 3-7 — Cluster is the switch the rest hangs off: Distance and Linkage only exist " +
          "once it is on, and so does cutting the tree into blocks.",
      },
      {
        kind: "ul",
        items: [
          "Row or column names too long or too many? Their font is in the same section, and the column labels rotate.",
          "Averaging replicates that share a strip value is one control: Collapse, set to mean or median. It appears once a strip exists, because the strip is what says which rows belong together. The collapsed row says so in its own name — Control (mean of 3).",
          "The cells can be drawn as area-scaled bubbles instead of tiles; that and the colour bar are in Colours, fills and symbols.",
        ],
      },

      { kind: "h", text: "If it goes wrong" },
      {
        kind: "ul",
        items: [
          "Distance and Linkage are nowhere: they only exist once Cluster is on. There is nothing to configure until then.",
          "The map is nearly all one colour: the data is skewed. Set Colour steps and choose equal counts (quantile) — equal intervals crowd almost everything into one class.",
          "White is not on zero: pin it with Centre at. ⚠️ A centre value outside the data cannot centre anything, so the graph says so and leaves the ramp alone.",
          "A column you wanted as a strip is still drawn as cells: point the strip at it — a strip's column drops out of the matrix so it is not drawn twice.",
          "Collapse is missing: it appears once a strip exists, because the strip is what says which rows belong together.",
          "“Row blocks from tree” is greyed out: that axis is not clustered, so there is no tree to cut. Place the breaks by hand instead.",
        ],
      },
    ],
  },
  {
    id: "tut-survival",
    title: "A Kaplan-Meier survival curve",
    group: "Worked examples",
    summary: "Times and censoring in, a stepped curve with the log-rank p out.",
    keywords: [
      "worked example", "how do i", "survival", "kaplan meier", "km", "log rank", "censored",
      "hazard ratio", "time to event", "step by step",
    ],
    blocks: [
      {
        kind: "goal",
        text:
          "a stepped Kaplan-Meier curve per group with its censoring ticks and the log-rank p — and, if you want it, the numbers-at-risk table under the time axis.",
      },
      {
        kind: "p",
        text:
          "Survival data has a shape of its own, and getting the sheet right is most of the job: " +
          "one row per subject, an elapsed time, and a 1 or 0 saying whether the event happened or " +
          "the subject was censored.",
      },
      {
        kind: "steps",
        items: [
          "Insert ▸ New table ▸ Survival table. Each group gets a pair of columns: the time, and a status column holding 1 for the event and 0 for censored.",
          "Type or paste the subjects in. If you have dates rather than elapsed times, the sheet takes a start and an end date per subject and does the subtraction — the control is above the sheet.",
          "Analyze ▸ Analyze… and choose Survival (Kaplan-Meier) — it is the “Survival” goal tile, and on a survival sheet it is what the landing page recommends.",
          "Choose the groups to compare and press Run. The result gives the median survival per group, the log-rank test across them, and the hazard ratio with its confidence interval.",
          "Add to graph ▸ Survival curves. The stepped curve is drawn per group with its censoring ticks.",
          "Optional: turn on the at-risk table under the axis, and the confidence bands, in the Inspector's Survival (Kaplan-Meier) section.",
        ],
      },
      {
        kind: "ul",
        items: [
          "Adjusting for covariates is a different method on the same sheet: Cox regression (proportional hazards). The statistics on offer lists it with everything else.",
          "Comparing more than two groups pairwise? The configure page offers pairwise curve comparisons with a multiplicity correction. Reading a result explains what comes back.",
          "A survival curve that climbs instead of falling is the ascending form (cumulative incidence) — a switch in the Inspector, not a different analysis.",
        ],
      },

      { kind: "h", text: "If it goes wrong" },
      {
        kind: "ul",
        items: [
          "The analysis will not run: the sheet is not a Survival one. It needs a pair of columns per group — the elapsed time, and a status column holding 1 for the event and 0 for censored.",
          "You have dates, not elapsed times: the sheet takes a start and an end date per subject and does the subtraction. The control is above the grid.",
          "Every subject reads as an event: the status column is all 1s. Censored subjects are 0 — without them the curve and the median are wrong.",
          "The curve climbs instead of falling: that is the ascending form (cumulative incidence, 1 − S) — a switch in the Inspector, not a different analysis.",
          "You need to adjust for covariates: that is Cox regression (proportional hazards), a different method on the same sheet.",
          "There is no at-risk table: turn it on in the Inspector's Survival (Kaplan-Meier) section. It comes from the analysis, so it counts what is really still at risk.",
        ],
      },
    ],
  },
  {
    id: "tut-figure",
    title: "Build a multi-panel figure for a paper",
    group: "Worked examples",
    summary: "Four graphs into one lettered, aligned figure at the journal's column width.",
    keywords: [
      "worked example", "how do i", "figure", "panel", "multi-panel", "abc", "letters", "assemble",
      "journal", "layout", "montage", "step by step",
    ],
    blocks: [
      {
        kind: "goal",
        text:
          "four graphs as one lettered figure — panels aligned by their axes, the repeated tick numbers stripped from the inner ones, exported at your journal's column width.",
      },
      {
        kind: "p",
        text:
          "A figure is assembled from graphs you have already made. It opens as its own full page " +
          "rather than a tab, because arranging panels is a different activity from editing one " +
          "graph — ← Back returns you to the workspace.",
      },
      {
        kind: "steps",
        items: [
          "Make the individual graphs first, and get each one looking right on its own. A panel is the real graph itself — styling it in the figure restyles the graph it came from.",
          "Insert ▸ New layout. The Choose graphs page lists every graph in the project as a live thumbnail, grouped by experiment.",
          "Tick the panels you want. Leave Auto-scale on include ticked and each new panel is matched to the first one's size, fonts, axes and colours as it arrives, so the figure starts consistent instead of being made consistent later.",
          "Press Build / Arrange →. The panels land on the canvas with A, B, C… already assigned.",
          "Tile them: turn Free drag off, set Columns to the number you want and Gutter to the gap. Or press Layout ▾ and pick a shape from the thumbnails — a grid, a wide panel on top, a tall panel at the left.",
          "Line them up: Align all does the lot in one click — the axes down each column and across each row, and the A/B/C labels with them. Shared axes (in the Inspector when nothing is picked — click empty canvas) then strips the repeated tick numbers and axis titles from the inner panels and gives the space back to the drawing.",
          "Tidy the lettering: Renumber, beside the letters in the Inspector, re-letters in reading order after you have moved things about. Double-click a letter to retype it — “(a)”, “S1”, anything.",
          "Export from the header, or File ▸ Export…: set Print width to the journal's column width and the DPI it asks for. The grid, the ruler and the card headers are never part of the file.",
        ],
      },
      {
        kind: "shot",
        file: "tut-figure-choose.png",
        alt:
          "Steps 2 to 4: the Choose graphs page with live thumbnails of the project's graphs, four " +
          "of them ticked, an Auto-scale on include checkbox and a Build / Arrange button.",
        caption:
          "Steps 2-4 — tick the panels you want. Auto-scale on include matches each one to the " +
          "first as it arrives, so the figure starts consistent instead of being made consistent.",
      },
      {
        kind: "shot",
        file: "tut-figure-ribbon.png",
        alt:
          "Steps 5 to 8: the figure page with Columns and Gutter and Align all marked in the toolbar, " +
          "and Shared axes and Renumber marked in the Inspector's Figure view on the right.",
        caption:
          "Steps 5-8 — Columns and Gutter tile the panels, Align all lines up the axes and the " +
          "letters, Shared axes strips the repeated ticks, Renumber re-letters in reading order.",
      },
      {
        kind: "note",
        text:
          "Linked to sources is the switch that matters here. Linked (the default) means styling a " +
          "panel also restyles the graph it came from, and a later change to that graph shows up in " +
          "the figure. Independent copy makes every panel private — and switching back to linked " +
          "discards those edits, which is why the chip asks first.",
      },
      {
        kind: "ul",
        items: [
          "One legend merges the panels' matching keys into a single one below the figure. It is only offered when the legends really do match.",
          "A micrograph or a blot goes in as a panel too: Add image… on the Choose graphs page. It is embedded in the project file, so it travels with it.",
          "Doing this again for the next figure? Style ▾ ▸ House style saves the arrangement — columns, gutter, lettering, alignment — and stamps the next figure with it. Multi-panel figures covers every control on the ribbon, and Export and sharing the formats and widths.",
        ],
      },

      { kind: "h", text: "If it goes wrong" },
      {
        kind: "ul",
        items: [
          "Align all did nothing: Free drag is still on. Turn it off first — the alignment works on the tiled arrangement.",
          "Shared axes left a panel's labels alone: that panel does not genuinely share the axis (different title, scale or ticks), so its labels stay. That is deliberate.",
          "One legend is greyed out: the panels' legends do not match, so there is no single legend to merge them into. The tooltip says why.",
          "You moved one panel and the tiling switched off: moving a panel by hand freezes every panel where it stands and switches to free drag, in one undo step, so adjusting one never makes the others jump.",
          "Styling a panel changed the original graph: the figure is linked to its sources, which is the default. Switch the header chip to Independent copy for figure-only tweaks — ⚠️ switching back discards them.",
          "The letters are out of order after rearranging: press Renumber. It re-letters left to right, top to bottom.",
          "The grid or ruler appeared in the export: it cannot — neither is ever part of it, nor are the card headers.",
        ],
      },
    ],
  },
  {
    id: "tut-import",
    title: "Import a file that is not clean",
    group: "Worked examples",
    summary: "Semicolons, comma decimals, an instrument's preamble and a units row — all handled before anything is created.",
    keywords: [
      "worked example", "how do i", "import", "csv", "excel", "delimiter", "decimal comma", "units row",
      "comment", "messy", "instrument", "step by step",
    ],
    blocks: [
      {
        kind: "goal",
        text:
          "a messy instrument export read correctly — delimiter, decimal mark, preamble and units row all settled before the datasheet exists, so there is nothing to clean up afterwards.",
      },
      {
        kind: "p",
        text:
          "Instrument exports are rarely a tidy CSV. The import preview is the datasheet grid over " +
          "a throwaway copy, so everything below happens before anything is added to your project — " +
          "if it looks wrong, change a setting and look again.",
      },
      {
        kind: "steps",
        items: [
          "File ▸ Import data… (Ctrl+I), or drop the file on the window. CSV, TSV, text, Excel (.xlsx/.xls/.xlsb), OpenDocument, JSON and .pzfx all come through the same preview.",
          "Look at the grid, not the settings. If the columns have not split, set Delimiter — comma, semicolon, tab, space, or one you type.",
          "If every number came in as text, or split at the decimal point, set Decimal separator to a comma. European exports are the usual cause.",
          "If the file starts with instrument notes, set Comment marker (# or whatever it uses) and those lines are dropped wherever they appear — not just at the top. Skip rows drops a fixed number instead.",
          "If the second row holds units rather than data, tick “Second row is units” and it is folded into the column names — “Time” over “s” becomes “Time (s)”.",
          "Words that mean “missing” — NA, N/A, null — go in Missing values, and those cells come in blank instead of as text. Set it once for every import in Settings ▸ New-graph defaults.",
          "Rename, reorder, retype or exclude columns in the preview grid itself. Then set Destination — a new datasheet, or appended to one you already have — and press Import.",
        ],
      },
      {
        kind: "note",
        text:
          "Tick “Keep linked to file (auto-update)” and the datasheet stays live: change the file on " +
          "disk and the sheet follows, and every graph and analysis built on it updates with it.",
      },
      {
        kind: "ul",
        items: [
          "An Excel workbook with several sheets shows them all — tick the ones you want and each becomes its own datasheet.",
          "The wrong shape rather than the wrong parse? Import it anyway, then Data ▸ Reshape data (wide ↔ long)….",
          "Getting data in lists every route in, including pasting and .pzfx.",
        ],
      },

      { kind: "h", text: "If it goes wrong" },
      {
        kind: "ul",
        items: [
          "Every row landed in one column: the delimiter is wrong. The line under the options says what it is reading, in words.",
          "The numbers are left-aligned as text: the decimal mark is wrong, or a thousands separator is still in them. Both are options in the preview.",
          "The instrument's preamble became rows of the table: set Skip rows for a block at the top, or a Comment marker if the notes are scattered between the data rows.",
          "The units row became a row of text: tick “Second row is units” and it folds into the names — “Time” over “s” becomes “Time (s)”.",
          "The first row of data became the column names, or the reverse: the “First row is a header” tickbox is the wrong way round for this file.",
          "A workbook brought in the wrong sheet, or too many: untick them in the sheets list, or use Cell range to pull one block out of a big sheet.",
          "You will get this file again next week: tick “Keep linked to file (auto-update)” and the sheet re-reads itself whenever the file changes — replaying these same options every time.",
        ],
      },
    ],
  },
  {
    id: "tut-journal-style",
    title: "Restyle a graph to a journal's requirements",
    group: "Worked examples",
    summary: "One graph made to fit a house style, then that style applied to every other graph.",
    keywords: [
      "worked example", "how do i", "journal", "house style", "restyle", "font", "column width", "dpi",
      "preset", "consistent", "submission", "step by step",
    ],
    blocks: [
      {
        kind: "goal",
        text:
          "one graph made to a journal's house style, and every other graph in the project matched to it in a single undoable step.",
      },
      {
        kind: "p",
        text:
          "Journals ask for a font, a column width and a resolution. The way to do this once rather " +
          "than per figure is to get one graph right, save it as a preset, and apply it.",
      },
      {
        kind: "steps",
        items: [
          "Open a representative graph and start from a built-in look: the Inspector's Style tab ▸ Style preset. Scientific Journal is the restrained one; the cards show what each does.",
          "Set the type. The Text tab holds every text element of the graph — pick the one you mean (title, axis titles, tick numbers, legend) and set its font, size and weight. Journals usually specify a family and a minimum size.",
          "Set the marks. The Data tab is where symbols, line widths, fills and error bars live. Click one series to change it alone; tick “Apply to whole graph” to change them all in one undoable step.",
          "Set the frame. The Frame tab holds the plot's box, its gridlines and its background — most journals want no grid and no fill.",
          "Save it: Style tab ▸ Style preset ▸ type a name ▸ Save. Tick ★ to make it what new graphs start from.",
          "Apply it to what you already have: Graph ▸ Apply this look to other graphs, then tick the graphs to restyle. Each one is a separate undo step.",
          "Export at the journal's numbers: File ▸ Export… (Ctrl+E), Print width set to their column width in millimetres, Resolution to the DPI they ask for, and the format they accept. The line above the button states the final pixel size and the printed size.",
        ],
      },
      {
        kind: "ul",
        items: [
          "CMYK is a tickbox on TIFF — a direct conversion with no ICC profile, so treat it as a submission convenience rather than a colour-managed proof.",
          "A transparent background is one of the Background swatches in the export dialog, not a graph setting.",
          "Presets and defaults covers the whole preset system, including moving your library to another machine.",
        ],
      },

      { kind: "h", text: "If it goes wrong" },
      {
        kind: "ul",
        items: [
          "A preset wiped markers you had hand-tuned: it clears per-series settings it does not itself specify, so switching presets never leaves residue from the last one. One undo brings them back.",
          "Apply this look did not make them match: it copies only what you picked in the What-to-copy row. Choose Everything.",
          "The targets still differ where you left the source alone: that is the point — Apply this look resets as well as sets, clearing the targets' overrides wherever the source is at its default.",
          "You changed Settings and your existing graphs did not move: nothing in Settings ever rewrites a graph you have already made. Restyle those with a preset, or with Apply this look.",
          "The figure has to be printed in black and white: use the Grayscale (print) preset, which cycles the marker shapes as well as the grey levels — grey alone will not separate the series.",
          "You want this look on every future graph: press the ★ on the preset card, or ★ Set this graph as the default, and the line under the list says what new graphs will start from.",
        ],
      },
    ],
  },

  // ───────────────────────────────── Your data ──────────────────────────────────
  {
    id: "import",
    title: "Getting data in",
    group: "Your data",
    summary: "Paste it, import it, type it — or keep a table linked to a file that keeps changing.",
    keywords: [
      "import", "open a file", "csv", "tsv", "excel", "xlsx", "ods", "json", "pzfx", "paste",
      "delimiter", "separator", "decimal", "thousands", "header row", "units row", "skip rows",
      "comment", "missing values", "linked file", "auto-update", "drag and drop", "ggplot",
    ],
    blocks: [
      {
        kind: "goal",
        text:
          "your numbers in a datasheet, read correctly — the right delimiter, the right decimal mark, " +
          "the names on the columns and the units folded in — all settled before the sheet exists.",
      },

      { kind: "h", text: "Which door to use" },
      {
        kind: "p",
        text:
          "Data does not have to arrive as a file. There are four doors and they all end at the same " +
          "kind of table.",
      },
      {
        kind: "table",
        head: ["You have", "Use", "What happens"],
        rows: [
          [
            "A block of cells copied from Excel or Sheets",
            "File ▸ Paste data as new datasheet… (Ctrl+Shift+V)",
            "The clipboard goes through the same preview a file does — the tab-separated block is recognised on its own — and becomes a table named “Pasted data”. The fastest route out of a spreadsheet.",
          ],
          [
            "A file on disk",
            "File ▸ Import data… (Ctrl+I), or drop the file on the window",
            "The same preview, plus the delimiter, decimal, units-row and keep-linked options.",
          ],
          [
            "Numbers still in your notebook",
            "File ▸ New datasheet / graph…, Insert ▸ New datasheet (XY), or Insert ▸ New table ▸ …",
            "A blank sheet you type into. Paste a block from Excel and the sheet grows to fit.",
          ],
          [
            "An R script that draws the figure you want",
            "File ▸ Import ggplot script (.R)…",
            "The script's design becomes a MadY graph on a datasheet you choose. Nothing is computed — MadY has no R in it.",
          ],
        ],
      },
      {
        kind: "ul",
        items: [
          "Import reads comma- and tab-separated files and other delimited or whitespace-aligned text (.csv, .tsv, .txt, .dat, .prn); JSON and newline-delimited JSON (.json, .ndjson, .jsonl — an array of records, or one record per line, becomes rows with one column per key); Excel workbooks (.xlsx) and the older or alternative spreadsheet files .xls, .xlsb and .ods; and the data tables of a .pzfx file (an XML project file — its tables come in, one datasheet each; its graphs, layouts and analyses do not, and the binary .pzf form is refused with a message).",
          "UTF-16 text, such as Excel's “Unicode text” export, is decoded correctly. A .mady project file opened this way opens as a project rather than as data.",
        ],
      },

      { kind: "h", text: "Read a file correctly" },
      {
        kind: "p",
        text:
          "Paste and Import open the same preview, and the preview is the real datasheet grid over a " +
          "throwaway copy — so you shape the table before it exists. Nothing is created until you press " +
          "Import, and Cancel costs you nothing.",
      },
      {
        kind: "steps",
        items: [
          {
            text:
              "File ▸ Import data… (Ctrl+I), or drop the file on the window. The preview opens on what " +
              "MadY made of it, with the delimiter and decimal mark already guessed.",
            shot: {
              file: "import-dialog.png",
              alt:
                "The import preview for a file called kinetics.csv: a row of options — Format set to " +
                "Semicolon, Decimal to Comma, Comment to # hash, Skip rows, Missing values, tickboxes for " +
                "a header row, a units row, transpose and keep-linked, and a Destination dropdown — above " +
                "a datasheet grid showing Time (s), Control (%) and Treated (%) with five rows of numbers.",
              caption:
                "The same file read correctly: semicolon-separated with a comma decimal, the # comment " +
                "line dropped, and the units row folded into the names — so “Time” over “s” becomes " +
                "“Time (s)”. The line under the options says what it is reading, in words.",
            },
          },
          {
            text:
              "Check the grid, not the options. If the columns split where you expect and the numbers " +
              "are right-aligned as numbers, the settings are right. If they have not, fix Format and " +
              "Decimal until they do.",
          },
          {
            text:
              "Deal with anything above the table: Skip rows ignores a number of lines at the top, and " +
              "Comment ignores every line beginning with a marker such as #. Tick “Second row is units” " +
              "when the file carries one.",
          },
          {
            text:
              "Shape the table in the grid itself — it is the real thing, not a picture of one. Drag a column " +
              "header to reorder it, double-click it to rename, right-click it to set what it holds or " +
              "delete it, and right-click ▸ Use as X axis to make it the X. Types, order, decimals and " +
              "exclusions all carry over.",
            shot: {
              file: "data-import-grid.png",
              alt:
                "The import preview's grid with a column header right-clicked: a menu offering Sort " +
                "ascending and descending, Insert column left and right, Delete column, Use as X axis, " +
                "a Type dropdown, a Decimals box and an f(x) formula field.",
              caption:
                "The preview grid has the datasheet's own column menu in it. Whatever you fix here is what gets imported — there is no “clean it up afterwards” step.",
            },
          },
          {
            text:
              "Set Destination: a new datasheet, or append the rows to the bottom of one you already " +
              "have — matching columns by name (any order) or by position. Then press Import; the " +
              "button counts your rows, so it reads “Import 24 rows”.",
          },
        ],
      },

      { kind: "h", text: "Every option in the preview" },
      {
        kind: "table",
        head: ["Option", "What it does"],
        rows: [
          ["Format (delimiter)", "Detected automatically; set it yourself when the file is unusual."],
          ["Decimal separator", "Point or comma, for data written on either convention. Auto detects a European comma decimal when the delimiter is not itself a comma."],
          ["Thousands separator", "Strips a grouping mark from numbers written 1,000,000 or 1 000. It must differ from the delimiter."],
          ["Skip rows", "Ignore a number of lines at the top — metadata, notes or blanks above the table."],
          ["Comment marker", "Ignore every line starting with a marker such as #, the notes instruments and exporters put above or between data rows."],
          ["First row is a header", "On by default when the first row looks like names rather than numbers."],
          ["Second row is units", "Folds a units row into the names — “Time” over “s” becomes “Time (s)” — and drops it from the data."],
          ["Missing values", "Words to read as blank, such as NA, N/A or null. An empty cell is always blank."],
          ["Transpose (swap rows / columns)", "Swap rows and columns while reading, for data that arrives the wrong way round."],
          ["Sheets to import", "A workbook (or a .pzfx file) lists its sheets with the data-looking ones ticked; every ticked sheet becomes its own datasheet in one go."],
          ["Cell range", "Restricts a sheet to a block such as A1:D50 (B2:D reaches the last row) when the table sits inside a larger sheet."],
          ["Destination", "A new datasheet, or append to an existing one, matching columns by name or by position — for a run of instrument exports that share a layout."],
          ["Keep linked to file (auto-update)", "Text files only. The table re-reads itself whenever the file changes on disk."],
        ],
      },
      {
        kind: "ul",
        items: [
          "Column types are detected for you: a column of dates (2024-03-01, 3/1/2024 or 1/3/2024 — the day-first reading is chosen when any day is above 12) comes in as a date column, and h:mm:ss comes in as elapsed time, so a graph draws a real time axis rather than the raw text. Detection is strict — every cell in the column has to match — and the right-click type menu overrides it.",
          "A wide file gets a wide preview with its own horizontal scroll, so a hundred-column sheet is still readable before you commit.",
        ],
      },

      { kind: "h", text: "Keep a table linked to a file that keeps changing" },
      {
        kind: "steps",
        items: [
          {
            text:
              "In the preview, tick “Keep linked to file (auto-update)” before you press Import. It is " +
              "offered for text, delimited and JSON files; spreadsheet workbooks and .pzfx tables come " +
              "in as a snapshot.",
          },
          {
            text:
              "The sheet's rail then carries a 🔗 marker with the file's name and two buttons: Refresh " +
              "re-reads it now, Unlink stops the auto-update and keeps the data you have.",
            shot: {
              file: "data-linked-table.png",
              alt:
                "The datasheet rail with a link marker: a chain icon followed by the file name " +
                "kinetics.csv, then a Refresh button and an Unlink button.",
              caption:
                "A linked table says so on its own rail. The import options you set are replayed on every re-read, so a comma-decimal file does not silently become a file of text on the third refresh.",
            },
          },
          {
            text:
              "If a re-read fails — the file moved, was locked or became unreadable — the marker turns " +
              "to ⚠️ and says why, rather than leaving stale numbers looking current.",
          },
        ],
      },

      { kind: "h", text: "Import a ggplot script" },
      {
        kind: "p",
        text:
          "File ▸ Import ggplot script (.R)… reads the ggplot(data, aes(…)) + geom_*() + scale_*() + " +
          "coord_*() + labs() + theme() chain of an R script and turns it into a MadY graph — the geoms " +
          "become the graph type, the aesthetics become the series, the scales become axes and colours, " +
          "the theme becomes the nearest preset. MadY has no R in it, so nothing is computed: a script " +
          "almost never carries its data, it points at a set, so you pick the datasheet that holds the " +
          "columns the script names (or import it first) and MadY reshapes it into the wide table it draws.",
      },
      {
        kind: "ul",
        items: [
          "Before anything is created you see the report: every call in the chain marked honoured, approximated (with what changed — a theme mapped to a preset, a legend moved from the bottom to the top) or refused (with why — a facet, a smooth with a formula, a count computed in R). Nothing is guessed and nothing is silent; the same report goes into the project log.",
          "Read: geom_point · line · col · bar(stat = identity) · boxplot · violin · jitter · histogram · tile / raster · errorbar / pointrange / linerange · hline / vline · annotate(\"text\"); aes(x, y, colour / fill / shape / group, ymin = y − col, ymax = y + col); scale_*_manual, scale_x/y_log10, scale_*_continuous(limits, breaks), scale_fill_gradient2 / viridis; coord_flip / fixed / cartesian; labs / ggtitle / xlab / ylab; theme_bw / classic / minimal (and hrbrthemes' theme_ipsum); theme(legend.position, axis.text angle and size, panel.grid, plot.title).",
          "Refused, out loud: facets (make one graph per level and arrange them in a figure), anything computed in R (geom_bar counts, after_stat, cut_width, a smooth's formula), extension packages' layers, a layer with its own data =.",
          "Fits are not imported as pictures: geom_smooth(method = lm) is reported as approximated with the instruction to run Analyze ▸ Linear regression on the new graph, so the line and band come from MadY's own numbers.",
        ],
      },

      { kind: "h", text: "If it goes wrong" },
      {
        kind: "ul",
        items: [
          "Every row landed in one column: the delimiter is wrong. Set Format to the character the file really uses — the line under the options says what it is reading.",
          "Your numbers are left-aligned text: the decimal mark is wrong (a comma decimal read as a point, or the other way round), or a thousands separator is still in them. Both are options in the preview.",
          "The first row of data became the column names, or the names became data: the “First row is a header” tickbox is the wrong way round for this file.",
          "The names came out as “Time” and the units row became a row of text: tick “Second row is units”.",
          "The instrument's notes are at the top of the table as rows: set Skip rows, or a Comment marker if the notes are scattered between the data rows.",
          "A workbook imported the wrong sheet, or too many: untick the ones you do not want in the sheets list, or use Cell range to pull one block out of a big sheet.",
          "A .pzf file is refused: that is the binary form. MadY reads the XML .pzfx, and only its data tables — the graphs, layouts and analyses do not come with them.",
          "A linked table stopped updating: look for ⚠️ on its rail — it says what went wrong. Press Refresh to try again, or Unlink to keep what you have.",
          "The ggplot report says “refused”: read the reason. Facets, anything computed inside R, extension packages' layers and a layer with its own data = are the four MadY cannot take, and each says which.",
        ],
      },
    ],
  },

  {
    id: "new-datasheet",
    title: "Making a new datasheet",
    group: "Your data",
    summary: "The creator: pick the shape of your data, or pick the graph and let it choose the shape.",
    keywords: [
      "new", "create", "blank", "empty table", "start", "wizard", "creator", "sample data",
      "add datasheet", "add table", "begin",
    ],
    blocks: [
      {
        kind: "goal",
        text:
          "a blank sheet in the shape your data is really in, filed where you want it, with its graph " +
          "made alongside it if you want one.",
      },

      { kind: "h", text: "Open the creator" },
      {
        kind: "p",
        text:
          "File ▸ New datasheet / graph… opens it. Graph ▸ New graph… and the Welcome page's tile open " +
          "the same dialog — one creator with three doors, because someone starting a piece of work " +
          "looks in File and someone who wants a picture looks in Graph, and neither should have to " +
          "know they are the same thing.",
      },
      {
        kind: "steps",
        items: [
          {
            text:
              "Choose what to create with the three buttons at the top. They are the two ends of the " +
              "same job plus the plain case: Datasheet → graph, Graph + datasheet, or Datasheet only.",
            shot: {
              file: "data-creator-modes.png",
              alt:
                "The top of the New-graph creator: three segmented buttons reading Datasheet → graph, " +
                "Graph + datasheet and Datasheet only, with a row of data-type filter chips and a " +
                "search box beneath them.",
              caption:
                "Read the dialog from either end. The filters under the buttons narrow the graph list to what one shape of sheet can draw; the search box finds a graph by name when you already know it.",
            },
          },
          {
            text:
              "Pick the format (if you know the shape your data is in) or the graph (if you know the " +
              "picture you want). Each choice narrows the other, so the pair on offer is always one " +
              "that actually works.",
          },
          {
            text:
              "Set the sheet up in the panel underneath, and watch the preview beside it. It draws the " +
              "real chart from sample data at its real size — scroll to zoom, use ± and Fit, and drag " +
              "the divider above it for more room.",
            shot: {
              file: "new-datasheet-dialog.png",
              alt:
                "The New graph creator: three buttons for what to create, a row of data-type filters, a " +
                "search box and a grid of graph-type cards on the left, and on the right the settings for " +
                "the new datasheet with a live preview of the chosen chart drawn from sample data.",
              caption:
                "The creator, read data-first. The cards are the graphs the chosen shape of sheet can " +
                "draw; the panel below sets the sheet up; the preview is the real chart, drawn from sample " +
                "data at its real size.",
            },
          },
          {
            text:
              "File it before you press Create: the “Add to” row takes a project (or “New project…”), " +
              "and an Experiment within it. Left at Top level, the sheet stays loose — which is fine, " +
              "and easy to regret in a month.",
          },
        ],
      },

      { kind: "h", text: "The settings, and what each one decides" },
      {
        kind: "table",
        head: ["Setting", "What it decides"],
        rows: [
          ["Start with sample data", "Fills the new sheet with a small, sensible example of the right shape — the fastest way to see what a chart type wants before you have your own numbers. Turn it off for an empty sheet."],
          ["Data entry", "Whether each Y dataset holds raw replicates (MadY computes the mean and its error) or a mean with an error and n you have already worked out."],
          ["Replicates", "How many side-by-side sub-columns each dataset gets. It applies in Replicates entry mode; summary mode uses Mean + SD/SEM + N columns instead."],
          ["Error bars", "What the bars show — SD, SEM, a confidence interval, the range."],
          ["X axis type", "Numbers, dates or text categories: what the X column holds and how it is drawn."],
          ["Add to project · Add to experiment", "Where the new sheet is filed. Either can create a new one by name."],
        ],
      },
      {
        kind: "note",
        text:
          "Insert ▸ New datasheet (XY) and Insert ▸ New table ▸ … skip the dialog and make a blank " +
          "sheet of one format straight away. Use them when you already know exactly what you want.",
      },

      { kind: "h", text: "If it goes wrong" },
      {
        kind: "ul",
        items: [
          "The graph you want is greyed out or missing from the list: the chosen data shape cannot draw it. Change the format, or clear the data-type filter and pick the graph first — the dialog will then choose a shape that feeds it.",
          "Replicates does nothing: the sheet is in summary entry mode, where each dataset is a Mean + SD/SEM + N instead. Switch Data entry to replicates.",
          "The preview is empty: the chart type needs data the sample cannot supply for that shape. Turn Start with sample data on, or pick a different chart.",
          "The sheet was made at the top level instead of in your project: the “Add to” row was left at Top level. Filing happens when the sheet is created — there is no dragging in the tree afterwards, so make the next one from the experiment's own ⊞ buttons.",
        ],
      },
    ],
  },

  {
    id: "data",
    title: "Laying your data out",
    group: "Your data",
    summary: "The single thing most worth getting right before you do anything else.",
    keywords: [
      "layout", "arrange", "shape", "groups in columns", "replicates", "rows", "wrong shape",
      "reshape", "wide", "long", "which analysis", "why is it greyed out",
    ],
    blocks: [
      {
        kind: "goal",
        text:
          "a table whose shape unlocks the analysis and the chart you actually need — decided in a " +
          "minute now rather than discovered when a menu item is greyed out.",
      },
      {
        kind: "p",
        text:
          "How you arrange a table decides which analyses and which charts become available, so it is " +
          "worth a moment up front.",
      },

      { kind: "h", text: "The three rules" },
      {
        kind: "steps",
        items: [
          {
            text:
              "Put each group you want to compare in its own column. A t test, an ANOVA and their " +
              "post-hoc tests all compare columns — so “Control”, “Drug A” and “Drug B” are three " +
              "columns, not three words repeated down one.",
            shot: {
              file: "data-groups-in-columns.png",
              alt:
                "A Column-format datasheet with three columns named Control, Drug A and Drug B, each " +
                "holding a stack of numbers, one per subject, with the format chip reading Column above " +
                "the grid.",
              caption:
                "Groups across, replicates down. This one shape is what a t test, an ANOVA and a column bar chart all read — and it is the arrangement people most often have to fix afterwards.",
            },
          },
          {
            text:
              "Put each replicate or subject in its own row. A bar chart summarises down a column, so " +
              "the rows are what it averages.",
          },
          {
            text:
              "Use sub-columns for replicates of the same group, so a mean and its error bar come " +
              "straight from the sheet rather than from a calculation you did elsewhere.",
          },
        ],
      },
      {
        kind: "ul",
        items: [
          "You can exclude an individual value without deleting it. Excluded values stay visible, are ignored by graphs and statistics, and survive being copied to a new sheet.",
        ],
      },

      { kind: "h", text: "If it is the right data in the wrong shape" },
      {
        kind: "p",
        text:
          "Do not retype it. The Data menu reshapes tables, and it is quicker and safer than doing it " +
          "by hand.",
      },
      {
        kind: "table",
        head: ["What went wrong", "The fix"],
        rows: [
          ["Each group ended up in a row instead of a column", "Data ▸ Reshape data (wide ↔ long)…, or Data ▸ Transpose rows and columns… if the whole sheet is simply the wrong way round."],
          ["One long column with a second column naming the group", "Data ▸ Reshape data (wide ↔ long)… — that is the long form; pivot it wide."],
          ["The columns you need are buried among forty others", "Data ▸ Extract & rearrange columns… pulls a subset into a new sheet, in the order you want."],
          ["The file arrived transposed", "Tick Transpose in the import preview, so it never lands wrong."],
          ["The sheet is right but the format is wrong", "Change it on the format chip above the grid — see Table formats."],
        ],
      },
      {
        kind: "note",
        text:
          "Analyze answers a question about your data and leaves the data alone. Data changes the table. " +
          "If you are looking for a command and cannot find it, that distinction is usually why.",
      },

      { kind: "h", text: "If it goes wrong" },
      {
        kind: "ul",
        items: [
          "The analysis you want is greyed out: it is the format, not the numbers. A t test wants a Column sheet, a two-way ANOVA a Grouped one, PCA a Multiple-variables one. The format chip above the grid says which you have.",
          "Your bar chart has one bar with everything in it: the groups are in one column with their names beside them. Reshape it wide, so each group is its own column.",
          "The error bars are missing: the sheet has one value per group, so there is nothing to compute an error from. Add replicate sub-columns, or switch Data entry to the summary mode and type the error you already have.",
          "A reshape produced an empty sheet: the column it needed is gone. A derived sheet follows its source columns and says so rather than quietly re-pointing at a different one.",
        ],
      },
    ],
  },

  {
    id: "formats",
    title: "Table formats",
    group: "Your data",
    summary: "Fifteen shapes of datasheet — the format is what unlocks the analyses.",
    keywords: [
      "format", "table type", "kind", "xy", "column", "grouped", "contingency", "survival",
      "parts of whole", "multiple variables", "nested", "change the format", "format chip",
      "which format", "unlocks",
    ],
    blocks: [
      {
        kind: "goal",
        text:
          "the right format on your sheet — because the format, not the numbers, is what decides which " +
          "analyses and which chart types you are offered.",
      },
      {
        kind: "p",
        text:
          "Every table has a format, chosen when you create it. It tells MadY what the columns mean, " +
          "which is how it knows a two-way ANOVA suits one table and a Kaplan-Meier curve suits another.",
      },

      { kind: "h", text: "See or change a table's format" },
      {
        kind: "steps",
        items: [
          {
            text:
              "Look at the chip beside the sheet's name on the rail above the grid: it names the " +
              "current format. Hovering it shows what the format means and the analyses it unlocks.",
            shot: {
              file: "data-format-chip.png",
              alt:
                "The left end of the datasheet rail: the sheet's name “Sample — dose vs response”, " +
                "and beside it a rounded purple chip reading XY with a dropdown arrow — the table's " +
                "format.",
              caption:
                "The format chip is a dropdown, not a label: it opens on all fifteen formats, listed in full below. Changing it re-reads the columns you already have — nothing is retyped, and it is undoable like everything else.",
            },
          },
          {
            text:
              "Picked wrong? Open the chip and choose the right one. For a format with a fixed shape " +
              "(survival, meta-analysis, the timeline, GWAS, alterations) MadY seeds the columns that " +
              "format needs — adopting a blank sheet, or appending to one that already has data.",
          },
          {
            text:
              "If the columns are right but the layout is wrong, change the layout instead: the Data " +
              "menu can usually reshape rather than make you start again.",
          },
        ],
      },

      { kind: "h", text: "The fifteen formats" },
      {
        kind: "ul",
        items: [
          "XY — a shared X column with one or more Y datasets, each able to hold replicate sub-columns. For regression, correlation, curve fits, area under curve and interpolation.",
          "Column — one grouping variable, each column a group of stacked values. For t tests, one-way ANOVA, descriptives, normality and ROC.",
          "Grouped — two grouping variables (rows × dataset columns) with replicate sub-columns. For two- and three-way ANOVA, and grouped bars, boxes and violins.",
          "A grouped bar can carry a third factor: in the Inspector give each dataset an outer group name, and the bars cluster into those groups within every category — a gap between clusters and the group name under each — making a three-way grouped bar (vertical bars).",
          "Contingency — an r×c table of integer counts, one per cell. For chi-square, Fisher's exact, odds ratios and relative risk.",
          "Survival — one row per subject: an elapsed-time column plus a 1 (event) / 0 (censored) column per group. For Kaplan-Meier, log-rank and hazard ratios.",
          "Parts of whole — each column is one whole and each row a slice of it. For fraction of total, goodness-of-fit, and pie or doughnut charts.",
          "Multiple variables — one row per case, one column per variable, no sub-columns. This is the format that unlocks multiple and logistic regression, the correlation matrix, PCA and clustering.",
          "PCA / ordination — the same shape as Multiple variables (one row per case, one column per variable, the text column names the groups), but a dedicated PCA-only format: New graph on it goes straight to the PCA score plot, with the biplot, loadings and scree also offered.",
          "Nested — sub-columns nested inside columns, for nested t tests and hierarchical ANOVA.",
          "Set membership — one row per item and one column per set; any non-empty, non-zero cell makes the item a member. This is the door to the Venn / Euler diagram and the UpSet plot (no statistics apply to a membership sheet — it is a drawing format).",
          "Subject timeline — one row per subject: Start and End (or the survival date pair), optional Response start / Response end and Ongoing columns, and every other numeric column as an event series. This is the swimmer plot's sheet (a drawing format — no statistics apply).",
          "Network (edge list) — one row per link: source and target in the first two columns, then an optional weight (a signed weight, e.g. a correlation, colours links red/blue by sign) and per-node columns such as a group, a value or a size, read from the row where a node first appears as a source. This is the network graph's sheet, and the same edge list draws a chord / circos diagram — each entity becomes an arc around a ring sized by its total incident weight, and every weighted link a ribbon across the interior coloured by its source; a square adjacency matrix (matching row labels and numeric column names) feeds the same drawing (a drawing format — rows are links, not cases, so no statistics apply).",
          "GWAS association results — one row per marker/SNP: a label, its Chromosome, Position (bp) and association P-value. This is the Manhattan plot's and the QQ plot's sheet (a drawing format — the rows are pre-computed per-SNP results, not cases, so t tests / ANOVA / regression over them mislead; the only legitimate statistic is the QQ's genomic inflation factor λ). The Manhattan plot draws −log10 p for every marker along the genome, chromosomes laid end to end and shaded in alternating tones, with the genome-wide (5×10⁻⁸) and suggestive significance lines — a genome-scale scatter, so the dense sub-threshold cloud is thinned to the pixel grid while the peaks are kept whole. The QQ plot draws observed against expected −log10 p-values with a y = x null line, so real associations pull away from the diagonal at the top and λ (1.0 = well-calibrated, >1 = inflation) reads off the legend.",
          "Meta-analysis — one row per study: a point estimate with its entered Lower and Upper confidence limits. This is the forest and funnel plots' sheet, and it unlocks the Meta-analysis method in Analyze: fixed-effect and DerSimonian–Laird random-effects pooling side by side with heterogeneity (Cochran's Q, τ², I²) and per-study weights; ratio measures pool in log space, and the result offers one-click forest + funnel plots that use the same maths. The same sheet unlocks the Publication bias method — Egger's regression test for funnel asymmetry plus Duval–Tweedie trim-and-fill, which imputes the missing mirror studies and reports the adjusted pooled effect; the funnel plot's Trim-and-fill tickbox draws the same imputed studies as hollow dots with an adjusted centre line.",
          "Genomic alterations — one row per alteration event: a Sample, a Gene and the Alteration type (missense, truncating, amplification, deep deletion, fusion…). This is the oncoprint's sheet (a drawing format — the rows are events, not cases, so t tests / ANOVA / regression over them mislead). The oncoprint draws a genes × samples grid: genes down the rows ordered by how often they are altered (with each gene's altered-sample percentage beside it), samples across the columns sorted into the mutual-exclusivity staircase, and every cell coloured by its alteration type from a legend key — a cell with several alterations stacks them. Turn the sample labels on for a small cohort; leave them off for hundreds.",
        ],
      },
      {
        kind: "note",
        text:
          "The New-graph dialog's picker shows each format with the analyses and graphs it enables, so you can " +
          "choose by what you intend to do rather than by what the shape is called.",
      },

      { kind: "h", text: "If it goes wrong" },
      {
        kind: "ul",
        items: [
          // Note: deliberately does not repeat the word "Freeze". This chapter's title already
          // carries "Table", and with the control's name in its body as well the query "freeze
          // the table" would land here instead of on the chapter that is about freezing
          // (`guideSearch.test.ts`). The cross-reference does the same job for the reader.
          "The format chip is greyed out: the sheet is locked read-only — see Sorting, freezing and printing.",
          "You switched format and the sheet now warns that it needs particular columns: that is a fixed-shape format (survival, meta-analysis, subject timeline, GWAS, alterations). MadY seeds the columns it needs — fill them in, or switch back.",
          "No statistics are offered at all: you are on a drawing format. Set membership, Subject timeline, Network, GWAS and Genomic alterations hold links, events or pre-computed results rather than cases, so a t test over them would mislead. The one exception is the QQ plot's λ.",
          "The format you want is not on the chip: there are fifteen and no more. If none of them describes your data, the nearest is usually Multiple variables — one row per case, one column per variable.",
        ],
      },
    ],
  },

  {
    id: "spreadsheet",
    title: "Editing cells",
    group: "Your data",
    summary: "Typing, correcting and clearing values — the sheet works the way a spreadsheet does.",
    // Note: "spreadsheet" and "datasheet" are here on purpose. The datasheet material is split
    // across six chapters with specific titles, none of which contains the word a reader
    // actually types.
    keywords: [
      "type", "enter", "edit", "change a value", "correct", "clear", "delete a value", "cell",
      "spreadsheet", "datasheet", "grid", "table", "data entry", "formula", "decimals",
    ],
    blocks: [
      {
        kind: "goal",
        text:
          "values typed, corrected and cleared without surprises — and a column that computes itself " +
          "from the others when you would rather not type it at all.",
      },

      { kind: "h", text: "The sheet and the rail above it" },
      {
        kind: "shot",
        file: "data-table.png",
        alt:
          "A table open in the spreadsheet: an XY-format table named Sample — dose vs response with " +
          "a Dose column and three Response replicate sub-columns, the format chip and the rail of " +
          "controls above the grid, and Exclude, Include, Methods and Export buttons.",
        caption:
          "The spreadsheet, with the rail above the grid: the table's format chip, add a column, set " +
          "the number of replicates, a shared X-error sub-column, and Freeze — here an XY table with " +
          "three replicate sub-columns under one Y variable.",
      },

      { kind: "h", text: "Type and correct a value" },
      {
        kind: "steps",
        items: [
          {
            text:
              "With a cell selected, just start typing. The first keystroke opens the editor and " +
              "replaces what was there, the way every spreadsheet behaves.",
          },
          {
            text:
              "To change one digit instead of retyping the number, press Enter or F2 first: that opens " +
              "the cell for editing and keeps its current value.",
          },
          {
            text:
              "Escape leaves an editor without keeping the change. The arrow keys move the selection, " +
              "and Delete or Backspace clears every cell in it — clearing empties the cell, it does not " +
              "remove the row or the column.",
          },
        ],
      },
      {
        kind: "table",
        head: ["Key", "What it does"],
        rows: [
          ["Any character", "Opens the editor and replaces what was in the cell."],
          ["Enter · F2", "Opens the editor keeping the current value, to correct part of it."],
          ["Escape", "Leaves the editor without keeping the change."],
          ["Delete · Backspace", "Clears every cell in the selection."],
          ["Arrow keys", "Move the selection. Shift+arrow extends it."],
        ],
      },

      { kind: "h", text: "Name the columns" },
      {
        kind: "steps",
        items: [
          {
            text:
              "Double-click a column header and type. Column names are used everywhere downstream — " +
              "legend entries, axis titles, analysis output, the drafted Methods paragraph — so naming " +
              "them properly early saves relabelling later.",
          },
          {
            text:
              "Filling an empty column adds a series to every graph built on the sheet, so a sheet " +
              "grows into its figure rather than needing to be rebuilt.",
          },
        ],
      },

      { kind: "h", text: "Say what a column holds, and how it shows" },
      {
        kind: "steps",
        items: [
          {
            text:
              "Right-click a column header. Type sets what the column holds — numbers, text or dates — " +
              "and is detected on import; this is where you override it.",
          },
          {
            text:
              "Decimals sets how many decimal places its numbers show. It changes the display, not the " +
              "stored value, so nothing is rounded away.",
          },
        ],
      },

      { kind: "h", text: "A column that computes itself" },
      {
        kind: "steps",
        items: [
          {
            text:
              "Right-click the column header and type an expression into the ƒ(x) box — A/B, LOG(A), " +
              "IF(A>0,B,C). Letters are columns, counted from A on the left.",
            shot: {
              file: "data-column-formula.png",
              alt:
                "The column right-click menu with the f(x) field at its foot, holding the expression " +
                "A/B, and the placeholder text showing the examples A/B, LOG(A) and IF(A>0,B,C).",
              caption:
                "A computed column. It recalculates whenever the columns it reads change — and a letter past the last column is flagged as you type rather than blanking the column silently.",
            },
          },
          {
            text:
              "Press Enter. The column fills, and it recalculates whenever the columns it reads change. " +
              "Clear the box to make it an ordinary column of numbers again.",
          },
        ],
      },
      {
        kind: "note",
        text:
          "Every edit is undoable, and so is every one of the operations in the chapters that follow. " +
          "Nothing in the datasheet is a one-way door.",
      },

      { kind: "h", text: "If it goes wrong" },
      {
        kind: "ul",
        items: [
          "Typing replaced the whole value when you only wanted to fix a digit: press Enter or F2 first, then type.",
          "Nothing can be typed at all: the sheet is frozen. Untick Freeze on the rail.",
          "Your number is showing as text, or a date is showing as a number: right-click the column header and set Type.",
          "A number lost its decimals: Decimals only changes what is shown. The stored value is intact — raise the number and it comes back.",
          "The ƒ(x) box outlines in red: the expression names a column that does not exist (an “A+D” on a three-column sheet), and it is refused rather than blanking the column silently.",
        ],
      },
    ],
  },

  {
    id: "select-copy",
    title: "Selecting, copying and pasting",
    group: "Your data",
    summary: "Moving blocks of numbers in, out, and around the sheet.",
    keywords: [
      "select", "selection", "range", "block", "copy", "cut", "paste", "clipboard", "excel",
      "transposed", "fill down", "duplicate values", "spreadsheet", "datasheet",
    ],
    blocks: [
      {
        kind: "goal",
        text:
          "a block of numbers moved between MadY and your spreadsheet, or around inside the sheet — " +
          "including the one-step fix for a block that arrived the wrong way round.",
      },

      { kind: "h", text: "Select a block" },
      {
        kind: "steps",
        items: [
          {
            text:
              "Drag across the cells to select a rectangle. Or put the cursor at one corner and hold " +
              "Shift while you use the arrow keys, which extends the selection from where you are.",
          },
          {
            text:
              "The selection is what every command in this chapter acts on — and what Exclude, Fill " +
              "and Pattern act on too. Several of those buttons stay disabled until there is one.",
          },
        ],
      },

      { kind: "h", text: "Copy, cut and paste" },
      {
        kind: "steps",
        items: [
          {
            text:
              "Ctrl+C, Ctrl+X and Ctrl+V copy, cut and paste the selected block. They talk to the " +
              "system clipboard, so a block copied here pastes into Excel or Sheets, and a block copied " +
              "there pastes in here.",
            shot: {
              file: "datasheet-cell-menu.png",
              alt:
                "The right-click menu over a selected block of datasheet cells, listing Copy, Cut, Paste, " +
                "Paste transposed, Exclude value and Include value.",
              caption:
                "Right-clicking a selection: the clipboard commands, the transposed paste, and the two " +
                "that exclude values from every graph and analysis without deleting them.",
            },
          },
          {
            text:
              "The same three are on the Edit menu and on the right-click, so you never have to " +
              "remember which. Paste a block bigger than the sheet and the sheet grows to fit it.",
          },
          {
            text:
              "Data arrived the wrong way round? Right-click ▸ Paste transposed drops the copied block " +
              "in with its rows and columns swapped. That is the one-step fix — there is no need to " +
              "retype anything.",
          },
        ],
      },

      { kind: "h", text: "Two shortcuts worth learning" },
      {
        kind: "table",
        head: ["Keys", "What it does"],
        rows: [
          ["Ctrl+D", "Fills the selected block down from its top row — the quick way to repeat a treatment name or a dose down a column."],
          ["Ctrl+Shift+T", "Transposes the selected block in place, without making a new sheet."],
          ["Ctrl+Shift+V", "File ▸ Paste data as new datasheet… — turns the clipboard into a whole new table, through the same preview a file import uses."],
        ],
      },

      { kind: "h", text: "If it goes wrong" },
      {
        kind: "ul",
        items: [
          "Ctrl+D or Ctrl+Shift+T does nothing: either there is no selection, or the sheet is frozen (untick Freeze on the rail).",
          "A pasted block landed in the wrong place: it starts at the top-left cell of the selection, not where the mouse is. Select the target cell first.",
          "The block pasted as one column of text: it was copied as something other than tab-separated cells. Paste it as a new datasheet instead (Ctrl+Shift+V), where you can set the delimiter.",
          "You wanted a new sheet, not cells: Ctrl+V pastes into the sheet you are in. Ctrl+Shift+V makes a new one.",
        ],
      },
    ],
  },

  {
    id: "exclude",
    title: "Excluding values",
    group: "Your data",
    summary: "Taking a value out of the analysis without taking it out of the record.",
    keywords: [
      "exclude", "omit", "ignore", "outlier", "drop", "strike out", "remove from analysis",
      "bad run", "suspect", "include", "restore", "spreadsheet", "datasheet",
    ],
    blocks: [
      {
        kind: "goal",
        text:
          "a value you distrust out of every graph and every analysis, immediately — and still visible " +
          "in the sheet, marked out in blue italics, so the record of what you measured survives.",
      },
      {
        kind: "p",
        text:
          "A value you distrust — a pipetting error, a run that failed, a reading off the top of the " +
          "instrument's range — should not be deleted. Deleting it destroys the record of what you " +
          "measured, and leaves nothing to explain in the paper. Excluding it keeps the number and " +
          "stops it counting.",
      },

      { kind: "h", text: "Exclude a value" },
      {
        kind: "steps",
        items: [
          {
            text:
              "Select the value, or a block of them.",
          },
          {
            text:
              "Data ▸ Exclude selected values (Ctrl+\\), or right-click ▸ Exclude value. The cell is " +
              "redrawn in blue italics where it sits — it does not move, empty or disappear.",
            shot: {
              file: "data-excluded-cells.png",
              alt:
                "A datasheet column with two of its values drawn in blue italics among the ordinary " +
                "black upright ones, and the exclusion note under the grid saying how many values are set aside.",
              caption:
                "An excluded value stays on screen, in the blue italics MadY uses for exclusions everywhere — so anyone reading the sheet can see both that it was measured and that it was set aside.",
            },
          },
          {
            text:
              "That is the whole operation. Every graph and every analysis built on the sheet ignores " +
              "it from that moment; there is no re-run to remember.",
          },
        ],
      },

      { kind: "h", text: "Put it back" },
      {
        kind: "steps",
        items: [
          {
            text:
              "Select the blue italic cells and use Data ▸ Include selected values (Ctrl+Shift+\\), " +
              "or right-click ▸ Include value.",
          },
          {
            text:
              "Ctrl+Z undoes an exclusion like any other edit, so a mis-click costs nothing.",
          },
        ],
      },
      {
        kind: "ul",
        items: [
          "Exclusions are keyed to the individual cell. They survive duplicating the sheet, copying it, and sorting the rows.",
          "The drafted Methods paragraph reports them as complete-case exclusions, so what you excluded is written down rather than silently missing.",
        ],
      },
      {
        kind: "note",
        text:
          "Excluding is a judgement about the data, and it belongs in the record. If you find yourself " +
          "excluding several values to reach a result, that is worth saying in the paper rather than " +
          "in the spreadsheet.",
      },

      { kind: "h", text: "If it goes wrong" },
      {
        kind: "ul",
        items: [
          "The Exclude command is greyed out: nothing is selected. Select the cells first — the buttons on the rail are disabled off a real selection rather than doing nothing when pressed.",
          "The graph did not change: the value you excluded is not one the graph draws (an unused column, or a row outside the range being plotted).",
          "Excluding a whole group's values left the analysis unable to run: a group with nothing left in it is not a group. Exclude the values, or drop the column — but say which in the paper.",
          "You meant to delete, not exclude: Delete or Backspace clears the cell instead. Excluding is the one that keeps the number.",
        ],
      },
    ],
  },

  {
    id: "rows-cols",
    title: "Rows and columns",
    group: "Your data",
    summary: "Adding, removing and re-pointing the structure of the sheet.",
    keywords: [
      "insert", "add column", "add row", "delete column", "delete row", "remove", "rename",
      "x column", "row labels", "replicates", "subcolumns", "entry mode", "x error",
      "spreadsheet", "datasheet", "survival dates",
    ],
    blocks: [
      {
        kind: "goal",
        text:
          "the sheet's structure changed — a column added, removed or made the X — with every graph and " +
          "analysis built on it following the change instead of quietly reading the wrong column.",
      },

      { kind: "h", text: "Add and remove columns" },
      {
        kind: "steps",
        items: [
          {
            text:
              "Right-click a column header to insert a column to its left or right, or to delete it. " +
              "The ＋ Column button on the rail adds one at the end.",
            shot: {
              file: "datasheet-column-menu.png",
              alt:
                "The right-click menu on a column header, listing Sort ascending and descending, Insert " +
                "column left and right, Delete column, Use as X axis, a Type dropdown, a Decimals box and " +
                "an f(x) column-formula field.",
              caption:
                "A column's own menu: sort the whole sheet by it, add or remove columns around it, make it " +
                "the X, set what it holds and how it is shown, or compute it from the other columns.",
            },
          },
          {
            text:
              "Right-click ▸ Use as X axis makes that column the one every graph plots along X. On a " +
              "Multiple-variables or PCA sheet the same item reads Use as row labels, because that is " +
              "what the column does there.",
          },
        ],
      },

      { kind: "h", text: "Add and remove rows" },
      {
        kind: "steps",
        items: [
          {
            text:
              "Right-click a row number, at the left edge of the grid, to insert a row above or below " +
              "it, or to delete it.",
            shot: {
              file: "datasheet-row-menu.png",
              alt:
                "The right-click menu on a datasheet row number, listing Insert row above, Insert row " +
                "below and Delete row.",
              caption:
                "A row's menu is shorter, because a row is only ever a case or a replicate — there is " +
                "nothing to type it as.",
            },
          },
          {
            text:
              "You rarely need to add rows deliberately: typing or pasting past the bottom of the sheet " +
              "grows it.",
          },
        ],
      },

      { kind: "h", text: "Sub-columns, error columns and dates" },
      {
        kind: "steps",
        items: [
          {
            text:
              "Replicates on the rail sets how many side-by-side sub-columns each Y dataset has, and " +
              "Entry says whether the sheet holds raw replicates or a mean with an error and n you " +
              "worked out yourself. Replicates applies in the replicates mode; the summary mode uses " +
              "Mean + SD/SEM + N columns instead.",
          },
          {
            text:
              "X error adds a shared X-error sub-column, drawn as a horizontal ± cap on every point.",
          },
          {
            text:
              "On a survival sheet the rail can take a start and an end date instead of an elapsed " +
              "time, and lets you say what unit the span is measured in.",
          },
        ],
      },
      {
        kind: "note",
        text:
          "Graphs and analyses follow a column that moves. Insert, delete or reorder columns and " +
          "everything built on the sheet re-points itself; if the column something needed is gone, it " +
          "says so rather than quietly using a different one.",
      },

      { kind: "h", text: "If it goes wrong" },
      {
        kind: "ul",
        items: [
          "There is no Replicates control on the rail: this format does not have replicate sub-columns. XY, Column, Grouped and Nested do; the drawing formats do not.",
          "“Use as X axis” is not on the menu: on a Multiple-variables or PCA sheet it reads “Use as row labels” instead — same item, different job.",
          "You deleted a column and a graph went empty: it says so rather than drawing something else. Ctrl+Z brings the column back and the graph with it.",
          "The rail's controls are all greyed out: the sheet is frozen. Untick Freeze.",
        ],
      },
    ],
  },

  {
    id: "cellcolour",
    title: "Colouring cells",
    group: "Your data",
    summary: "Marking the sheet up for yourself — colours and patterns that change no data.",
    keywords: [
      "fill", "colour", "color", "highlight", "background", "shade", "pattern", "hatching",
      "mark up", "flag", "pipette", "eyedropper", "spreadsheet", "datasheet",
    ],
    blocks: [
      {
        kind: "goal",
        text:
          "cells marked up so you can see at a glance which is which — a treatment group, a suspect " +
          "run, two batches — without changing a single value.",
      },

      { kind: "h", text: "Colour some cells" },
      {
        kind: "steps",
        items: [
          {
            text:
              "Select the cells. Fill and Pattern on the rail stay disabled until you do.",
          },
          {
            text:
              "Press Fill and pick one of the light background colours, or Custom for one of your own. " +
              "No fill clears them again.",
            shot: {
              file: "data-cell-fill-menu.png",
              alt:
                "The Fill button on the datasheet rail with its palette open: a grid of fourteen light " +
                "background swatches above a No-fill entry and a Custom colour picker.",
              caption:
                "The fills are deliberately light, so the sheet's own dark text stays readable through them. Custom is there for precision; the presets are the obvious path.",
            },
          },
          {
            text:
              "Press Pattern for a hatch, dot or grid tile instead — or as well. No pattern clears it.",
          },
        ],
      },
      {
        kind: "ul",
        items: [
          "The pattern tiles are the same ones the graphs use for series fills, so a sheet marked up in hatching and a figure printed in black and white speak the same language.",
          "The colour picker has a screen pipette where the operating system provides one: pick a colour from anywhere on screen, including from a figure you are matching.",
          "Recently used colours are offered again, so marking up twenty cells in three colours does not mean opening the picker twenty times.",
        ],
      },
      {
        kind: "note",
        text:
          "Because a fill means nothing to MadY, it means whatever you decide — but only to you. If " +
          "the distinction matters to the analysis, it belongs in a column, where a graph and a test " +
          "can both read it.",
      },

      { kind: "h", text: "If it goes wrong" },
      {
        kind: "ul",
        items: [
          "Fill and Pattern are greyed out: nothing is selected, or the sheet is frozen.",
          "The colour reached no graph: it never will. A fill is a mark on the sheet — to colour a series, use the Inspector's Data tab on the graph itself.",
          "There is no pipette in the colour picker: the operating system does not offer one. Everything else in the picker still works.",
          "The text is hard to read on your custom colour: the presets are light on purpose. A dark custom fill keeps the sheet's dark text.",
        ],
      },
    ],
  },

  {
    id: "sort-freeze",
    title: "Sorting, freezing and printing",
    group: "Your data",
    summary: "Reordering the rows, locking the sheet, and putting it on paper.",
    keywords: [
      "sort", "order", "ascending", "descending", "rank rows", "freeze", "lock", "read only",
      "protect", "print", "paper", "duplicate", "spreadsheet", "datasheet", "export csv",
    ],
    blocks: [
      {
        kind: "goal",
        text:
          "the rows in the order you want, the sheet locked against accidental edits while you work on " +
          "the figures, and a copy on paper or in a file someone else can open.",
      },

      { kind: "h", text: "Sort the rows" },
      {
        kind: "steps",
        items: [
          {
            text:
              "Data ▸ Sort rows by column… asks which column and which direction. Right-click a column " +
              "header ▸ Sort ascending / Sort descending does the same in one click.",
            shot: {
              file: "data-sort-dialog.png",
              alt:
                "The Sort dialog for a datasheet: the sheet's name in the heading, a dropdown choosing " +
                "the column to sort by, and a second dropdown choosing ascending or descending.",
              caption:
                "Sorting moves the whole row, so nothing is scrambled — a value never parts company with the case it belongs to. Blanks go last.",
            },
          },
          {
            text:
              "Sorting is undoable like everything else. But it moves the rows themselves: if the row " +
              "order carries meaning — a time course typed in sequence — sort a duplicate rather than " +
              "the sheet your figures are drawn from.",
          },
        ],
      },

      { kind: "h", text: "Lock the sheet, or copy it" },
      {
        kind: "steps",
        items: [
          {
            text:
              "Tick Freeze on the rail to make the table read-only. A frozen table cannot be edited by " +
              "accident while you work on the figures built from it — the format chip, the cells and " +
              "every rail control go quiet until you untick it.",
          },
          {
            text:
              "Data ▸ Duplicate datasheet makes a full, independent copy — exclusions, colours and all " +
              "— for when you want to try something without risking the original.",
          },
        ],
      },

      { kind: "h", text: "Print it or write it out" },
      {
        kind: "steps",
        items: [
          {
            text:
              "File ▸ Print… (Ctrl+P) prints whatever is in front, a datasheet included, through the " +
              "system print dialog.",
          },
          {
            text:
              "File ▸ Export… (Ctrl+E) writes the sheet out as CSV (comma-separated), an Excel .xlsx " +
              "workbook (one sheet, bold header row) or JSON (columns plus one object per row).",
          },
        ],
      },

      { kind: "h", text: "If it goes wrong" },
      {
        kind: "ul",
        items: [
          "Sort rows by column… is greyed out: no datasheet is in front, or the one that is has Freeze ticked.",
          "The sort scrambled a pairing: it cannot. Sorting moves whole rows. If two things that belong together are in different rows, they were never paired in the sheet.",
          "You cannot type anything: Freeze is ticked. It is on the rail above the grid.",
          "Export wrote the graph, not the sheet: Export acts on whatever is in front. Open the datasheet's own tab first.",
        ],
      },
    ],
  },

  {
    id: "datamenu",
    title: "Transforming, reshaping and deriving",
    group: "Your data",
    summary: "The Data menu changes the table itself — and keeps derived sheets live.",
    keywords: [
      "transform", "log", "z-score", "normalise", "baseline", "row statistics", "frequency",
      "histogram table", "prune", "extract", "transpose", "reshape", "wide", "long", "pivot",
      "derived", "duplicate", "column math",
    ],
    blocks: [
      {
        kind: "goal",
        text:
          "a table transformed, reshaped or summarised into a new sheet that stays live — so changing " +
          "the source updates it, and what was done to the numbers is written on them.",
      },
      {
        kind: "p",
        text:
          "Everything under Data changes the shape or the values of a table. Most of these produce a new, " +
          "derived sheet rather than overwriting what you have; a derived sheet stays live, so changing the " +
          "source updates it.",
      },

      { kind: "h", text: "Transform the values" },
      {
        kind: "steps",
        items: [
          {
            text:
              "Open the sheet, then Data ▸ Transform values…. Pick the function from the Function list " +
              "— they are grouped by what they do, not by name.",
            shot: {
              file: "data-transform-dialog.png",
              alt:
                "The Transform dialog for a datasheet: an Interchange X and Y tickbox, a Function " +
                "dropdown listing the transform groups, a constant K field and a seed field, above a " +
                "preview of the transformed table.",
              caption:
                "About fifty functions of Y (and of X). The one you pick is written out as the equation it applies, and the new column is renamed to say so.",
            },
          },
          {
            text:
              "Some functions take a constant K (add, multiply, log to any base, Y to any power); the " +
              "random ones take a seed, so a simulation you show someone else reproduces exactly.",
          },
          {
            text:
              "Press Create dataset. A new sheet appears, its columns named for the equation — " +
              "“Y = log₁₀(Y)” rather than “Response 2” — so a figure drawn from transformed data " +
              "carries what was done to it in its own axis titles.",
          },
        ],
      },
      {
        kind: "table",
        head: ["Group", "What is in it"],
        rows: [
          ["Arithmetic", "Add, subtract, multiply or divide by a constant K, absolute value, negate, and the reciprocal."],
          ["Logs", "log₁₀, natural log, log₂ and log to any base, with the antilogs that undo each of them."],
          ["Powers", "Squares and cubes, square and cube roots, and Y to any power."],
          ["Proportions", "Fraction of the column total, percentage of the total, and normalising to a 0–1 range."],
          ["Standardise", "z-scores, centring on the mean or the median, and ranks."],
          ["Trigonometry", "Sine, cosine, tangent and their inverses, in degrees or radians, plus the hyperbolic pairs."],
          ["Combine X", "Arithmetic between each Y and its own row's X value, for ratios and differences against the independent variable."],
          ["Random", "Seeded random noise, so a simulation you show someone else reproduces exactly."],
        ],
      },

      { kind: "h", text: "Everything else on the Data menu" },
      {
        kind: "shot",
        file: "data-menu.png",
        alt:
          "The Data menu open, listing Exclude and Include selected values, Transform values, Remove " +
          "baseline and column math, Row statistics, Frequency distribution, Normal probability plot, " +
          "Prune rows, Extract and rearrange columns, Transpose, Reshape, Sort rows and Duplicate.",
        caption:
          "Everything that changes a table is on one menu. Analyze, next door, answers a question " +
          "about the data and leaves it alone — if a command is not where you expected, that " +
          "distinction is usually why.",
      },
      {
        kind: "table",
        head: ["Command", "What it makes"],
        rows: [
          ["Remove baseline & column math…", "Subtract or divide by a baseline column or a constant, or combine two columns with +, −, × or ÷. You say per column whether it is data to correct, an identifier to keep, or something to ignore."],
          ["Row statistics…", "Each row collapsed to its mean, SD, SEM and so on, choosing which columns are summarised and which are carried through."],
          ["Frequency distribution…", "Values binned into a histogram table: automatic bins (√n), a bin count, a bin width, or an exact unbinned cumulative."],
          ["Normal probability (QQ) plot…", "A QQ table against a normal or log-normal reference, with a choice of plotting position (Blom, Hazen or Weibull)."],
          ["Prune rows…", "A range of rows kept, or a dense series thinned down to something a figure can show."],
          ["Extract & rearrange columns…", "A subset of the columns pulled into a new sheet, in the order you want it."],
          ["Transpose rows and columns…", "The sheet with its axes swapped."],
          ["Reshape data (wide ↔ long)…", "A pivot between one-column-per-group and one-row-per-observation. This is the fix when an analysis says your groups are in the wrong direction."],
          ["Sort rows by column…", "The same rows in a different order — see Sorting, freezing and printing."],
          ["Duplicate datasheet", "A full independent copy, exclusions and all."],
        ],
      },
      {
        kind: "note",
        text:
          "A derived sheet remembers which columns it came from, and follows them if you insert, move or " +
          "delete a column upstream. If the column it needed is gone, it produces an empty result and says " +
          "so — it never quietly re-points at a different column.",
      },

      { kind: "h", text: "If it goes wrong" },
      {
        kind: "ul",
        items: [
          "A log transform emptied half the column: log is undefined at and below zero, so those cells come back blank rather than as a wrong number. Add a constant first, or use a different transform.",
          "A derived sheet went empty: a column it read was deleted upstream. It says so instead of re-pointing at a neighbour — restore the column, or rebuild the derived sheet.",
          "You transformed the wrong sheet: the dialog names the table in its heading (“Transform ‘…’”). It acts on the sheet that is in front.",
          "The transform overwrote nothing — you wanted it in place: it never overwrites. A transform makes a new sheet, and the original is untouched.",
          "An analysis still says your groups are the wrong way round after a transpose: transpose swaps the whole sheet's axes. What you probably want is Reshape data (wide ↔ long)…, which pivots the groups.",
        ],
      },
    ],
  },

  // ─────────────────────────────── Graphs and styling ───────────────────────────
  {
    id: "new-graph",
    title: "Making a new graph",
    group: "Graphs and styling",
    keywords: [
      "new graph", "create", "draw", "chart this", "graph this data", "add graph", "gallery card",
      "duplicate graph", "clone",
    ],
    summary: "One dialog makes the datasheet and the graph together — and, from an open sheet, graphs that sheet.",
    blocks: [
      {
        kind: "goal",
        text:
          "a graph of your sheet, of a type that can actually draw it, filed where you want it — " +
          "without a new graph ever opening on nothing.",
      },
      {
        kind: "p",
        text:
          "Graph ▸ New graph… (also New datasheet / graph on the Welcome page, and File ▸ New datasheet / " +
          "graph…) is the one place a graph starts. It offers every chart type MadY can draw, and every " +
          "datasheet format, and it makes the two together.",
      },

      { kind: "h", text: "Graph the sheet you already have" },
      {
        kind: "steps",
        items: [
          {
            text:
              "Open the datasheet, then Graph ▸ New graph of this data. The + on the tab rail, the + in " +
              "the Navigator and the suggestion nudge in the toolbar all open the same dialog on the same sheet.",
            shot: {
              file: "graph-newgraph-from-sheet.png",
              alt:
                "The New-graph dialog opened from an open datasheet: the graph-type cards on the left " +
                "with the best fit already selected, and on the right a Data row naming that datasheet " +
                "rather than a new blank one.",
              caption:
                "Opened from a sheet, the dialog is about that sheet: the suggestions are ranked by what really draws it, the first is pre-selected, and Data already points at it.",
            },
          },
          {
            text:
              "The suggestions are ranked by what actually draws your data — a genes × conditions matrix " +
              "leads with a heatmap; a text-X sheet with a network or a heatmap, not an XY. Pick a " +
              "different card if you want one.",
          },
          {
            text:
              "Leave Data set to the open sheet, or switch it to “a new blank datasheet” for a fresh " +
              "one. If a card you click cannot draw the open sheet's format, the dialog says so before " +
              "anything is created.",
          },
          {
            text:
              "Press Create graph. The graph opens beside its datasheet, and the two stay in step.",
          },
        ],
      },

      { kind: "h", text: "Start from the graph instead" },
      {
        kind: "steps",
        items: [
          {
            text:
              "Graph ▸ New graph… with no sheet in mind. The three buttons across the top choose which " +
              "end you are reading it from: Datasheet → graph (pick the shape of your data and see the " +
              "graphs that fit — the default), Graph + datasheet (pick the graph and it offers only the " +
              "formats that graph can draw), or Datasheet only.",
          },
          {
            text:
              "Search graph types… filters the cards by name or description, for when you already know " +
              "what it is called.",
          },
          {
            text:
              "Tick Start with sample data and the graph opens pre-filled with a realistic invented " +
              "dataset to replace with your own — the same made-up data as the gallery card.",
          },
          {
            text:
              "Set Add to — a project and, if you like, an experiment, either an existing one or a new " +
              "one named on the spot. Left alone, the sheet and graph land loose at the top level.",
          },
        ],
      },

      { kind: "h", text: "The settings that shape the sheet under the graph" },
      {
        kind: "table",
        head: ["Setting", "What it decides"],
        rows: [
          ["Entry format", "Whether each dataset is entered as replicate sub-columns or as a pre-computed summary (Mean + SD, Median + IQR and so on)."],
          ["Replicates", "How many sub-columns each dataset gets."],
          ["Error bars", "What the bars show. Box, violin and raincloud choose their whisker rule here; floating bars choose what the bar spans; a lollipop's whiskers are opt-in."],
          ["X column", "Plain numbers, calendar dates, or elapsed time — so the axis is right from the first point."],
          ["Start with sample data", "The graph opens on invented data of the right shape, to replace with your own."],
          ["Add to", "The project and experiment the pair are filed under."],
        ],
      },
      {
        kind: "p",
        text:
          "Graphs that come from an analysis — the four ordination graphs, ROC, Kaplan-Meier — are on " +
          "the list too. Create hands you to Analyze, already set on the open sheet; run it and the " +
          "graph appears next to the sheet. With no sheet open, only the datasheet is made and the log " +
          "says which analysis to run.",
      },
      {
        kind: "note",
        text:
          "The datasheet format is what unlocks the analyses, so the dialog says so: a graph " +
          "is only ever offered on a format it can draw, and the format cards say which graphs and " +
          "analyses each one enables. Table formats has the fifteen shapes.",
      },

      { kind: "h", text: "If it goes wrong" },
      {
        kind: "ul",
        items: [
          "“New graph of this data” is greyed out: no datasheet is in front. Open one, or use Graph ▸ New graph…, which makes the sheet with the graph.",
          "The card you want is greyed out: it cannot draw the open sheet's format. Either change the sheet's format (see Table formats) or switch Data to a new blank datasheet, which lets the dialog make the shape that graph needs.",
          "Create sent you to the Analyze dialog: that graph is drawn from an analysis (ROC, Kaplan-Meier, the ordination graphs). Run the analysis and the graph appears.",
          "The new graph is empty: the sheet it was made on has no numbers in it yet. Type or paste them and the graph fills in — nothing has to be re-created.",
          "The sheet and graph landed at the top level instead of in your project: the Add to row was left alone. Filing happens at creation.",
        ],
      },
    ],
  },

  {
    id: "graphs",
    title: "Chart types",
    group: "Graphs and styling",
    keywords: [
      "chart", "graph", "plot", "kind", "type", "gallery", "which chart", "what chart",
      "bar", "scatter", "box", "violin", "heatmap", "survival", "pie", "histogram",
      "change chart type", "convert graph",
    ],
    summary: "Every chart type, in eight families, plus image panels for figures that mix pictures with plots.",
    blocks: [
      {
        kind: "goal",
        text:
          "the right chart for what you are showing — found by looking at live examples rather than by " +
          "guessing from a list, and changed later without rebuilding anything.",
      },

      { kind: "h", text: "Browse them as working examples" },
      {
        kind: "steps",
        items: [
          {
            text:
              "Graph ▸ Chart gallery… opens one live example per chart type, filed into eight families.",
            shot: {
              file: "chart-gallery.png",
              alt:
                "The Chart gallery tab: palette, colour ramp, line width, marker size and font controls above the grid, " +
                "then the first family heading, XY & continuous, with its seven live example cards — XY " +
                "points and fitted curve, two sheets on one graph, a time course, the bump chart, area, a " +
                "stream graph, bubble — each with a " +
                "one-line description of when to use it.",
              caption:
                "The Chart gallery: one live example per chart type, filed into eight families. The controls " +
                "above restyle every card at once, and clicking a card opens it as a real, editable graph on " +
                "your own tab.",
            },
          },
          {
            text:
              "Click a card and it becomes an ordinary editable graph on its own tab, with its own " +
              "datasheet — so the gallery doubles as a starting point rather than being just a picture.",
          },
          {
            text:
              "The eight families are XY & continuous · Bars & columns · Distributions & paired " +
              "comparisons · Parts of a whole, hierarchy & sets · Matrix, multivariable & networks · " +
              "Clinical, time-to-event & meta-analysis · Genomics · Ordination (PCA / PCoA). Within a " +
              "family the plain form of a chart leads, and the cards showing one of its options (the " +
              "bump chart, the Pareto bars, the histogram with a density curve) follow it.",
          },
        ],
      },
      {
        kind: "note",
        text:
          "Every number in the gallery is fictitious. The example datasets — doses, survival times, " +
          "gene names, group means, and the p-values behind the significance stars — are invented to " +
          "show each chart's form. Opening a card (or ticking “start with sample data” in the New-graph " +
          "dialog) hands you that same made-up data to replace with your own; nothing in a gallery card " +
          "is a real measurement or a citable result.",
      },

      { kind: "h", text: "Change a graph's type without rebuilding it" },
      {
        kind: "steps",
        items: [
          {
            text:
              "Click the graph, then open the Inspector's Chart tab. The chart-type selector at the top " +
              "lists the types this datasheet's format can draw.",
            shot: {
              file: "graph-change-type.png",
              alt:
                "The Inspector's Chart tab on a bar chart, with the chart-type control at the top of the " +
                "panel and the Chart type group of options open beneath it.",
              caption:
                "A graph's type is a setting, not a decision you are stuck with. The data mapping is kept wherever the new type can use it.",
            },
          },
          {
            text:
              "Pick another type. The data mapping is kept wherever the new type can use it — you are " +
              "not remaking the graph.",
          },
          {
            text:
              "Trying something risky? Graph ▸ Duplicate graph first makes an independent copy with all " +
              "its styling, so the version you like survives.",
          },
          {
            text:
              "Too many series on one graph? Graph ▸ Split into small graphs (one per series) makes one small graph " +
              "per series, each on the same axis range as the original, and lays them out on a new figure page. " +
              "Each small graph follows the original: change a colour, an axis, a font or the data there and every " +
              "small graph updates. On a small graph itself you can move things and change sizes — labels, legend, " +
              "title, graph size — and nothing else; other changes are refused with a message saying so. " +
              "Graph ▸ Detach small graph makes one an ordinary graph you can edit freely. Works on line, scatter, " +
              "area, bar, box, violin, column scatter, raincloud, histogram, radar and lollipop charts with two or " +
              "more series.",
          },
        ],
      },

      { kind: "h", text: "The chart types, by what they show" },
      {
        kind: "ul",
        items: [
          "Distributions and comparisons: bar, box and whisker, violin, raincloud, column scatter, floating bars, before–after, paired dot plot, estimation (Gardner–Altman), forest plot, funnel plot (the forest's publication-bias companion, from the same estimate/lower/upper columns). Bars can be sorted by value (Sort bars — largest-first gives the waterfall / tumour-response look, and the Waterfall (response) choice in New graph and the gallery adds the −30/+20% zones). Stacked bars have a Stacked 100% layout — every category normalised to shares of a whole, the relative-abundance bar — and a Connect stacks tickbox that joins each series' segment to its segment in the next bar with a translucent ribbon (opacity tunable), the linked stacked-bar figure microbiome papers use. A Cumulative % line tickbox (vertical bars) draws the running total of the bars as a share of the whole on a right-hand 0–100 % axis — with Sort bars set to Largest first that is the Pareto chart, which the gallery and New graph also offer ready-made.",
          "Relationships: XY, area, bubble, correlation matrix, parallel coordinates, network, alluvial. A stacked area can also be drawn as a stream (the Stacking selector's Stream (centred) mode): the same bands centred on the time axis so only their thickness carries the value — the streamgraph look; smooth the flow with the curve's Connect setting (click the curve ▸ Connect ▸ Smooth) and mark events with dashed vertical annotation lines.",
          "Distributions of one variable: histogram, ridgeline, population pyramid and the polar histogram. A ridgeline's rows can also show values over the table's X column instead of densities (Chart type ▸ Rows show ▸ Values over X — time-series rows on one shared axis), and either kind of row can wear nested Level bands: the height sliced into equal levels, each a shade deeper, positive and negative sides on their own hues with a band key in the legend — the iso-contour / horizon figure of microbiome z-score panels. And for angles, the polar histogram / wind rose: the first value column (degrees, wrapping — −5° reads as 355°) binned into equal sectors, each count a wedge from the centre; an optional second value column stacks each wedge into magnitude bands with a band-range key — the classic wind rose. The rose section sets the sectors, bands, wedge colour and the convention (compass: 0° = North, clockwise, N/NE/E labels — or mathematical: 0° = East, counterclockwise). One caveat: ordinary statistics mishandle angles (the mean of 350° and 10° is 0°, not 180°), and MadY has no circular statistics, so summarise angles with a dedicated circular-statistics package.",
          "Sets: Venn / Euler diagram from a membership sheet (row = item, one column per set) — up to three circles with every overlap's count; the venn section's Area-proportional option makes circle areas match the counts (exact for two sets, best-fit for three, subsets nesting like an Euler diagram). Past three sets, the UpSet plot draws the same sheet as intersection-size bars on a count axis with the membership dot matrix beneath and set-size bars at the left — sorted largest first, capped with an on-graph note, sortable by degree, and open to manual significance brackets across its columns, whose legs can reach down to the bars. The bars' shape, width, fill, outline and a single highlighted bar are set in the UpSet plot section — see Colours, fills and symbols.",
          "Domain-specific: survival (Kaplan–Meier) — drawn as the descending survival curve or, with one toggle, the ascending cumulative incidence (1 − S) — ROC, volcano, Bland–Altman, dendrogram, lollipop, radar, heatmap, 3-D scatter, and the swimmer plot: one bar per subject from Start to End (or the survival date pair, as elapsed time), a response interval inside the bar, an Ongoing arrow, and every further numeric column drawn as an event-glyph series; the swimmer section sorts subjects by duration, and clicking a bar and setting Colour bars by to a Stage column paints the bars per stage.",
          "Multivariate ordination — four graphs that every ordination shares, which is why they are named for the job and not for one method: Ordination — sites draws each case as a point on two axes (a PCA's components, a PCoA's principal coordinates, an NMDS map or a correspondence analysis, and in a CA the variables are drawn among the cases); Ordination — variables and Ordination — biplot draw the variable vectors, which only a PCA has (a distance-based ordination has no loadings, so those two are not offered for it); the Ordination — triplot draws a constrained ordination in one picture (the cases, the response variables as points, and the explanatory ones as arrows — a category’s level as a centroid, because a category has a place and not a direction of increase), with a switch between LC case scores, placed from the explanatory variables, and WA scores, placed from what was observed — click any arrow, a variable vector, an explanatory variable or a species drawn as an arrow, to recolour it and to set every arrow's thickness, dashes and head; and the scree plot shows the variance — or, for a CA, the inertia — carried by each axis. And the ternary plot: each row's first three value columns as one 3-part composition (normalised per row, so percentages, fractions or raw amounts all work) drawn as a point inside an equilateral triangle — soil textures, phase diagrams, mixture designs. The edge tick labels read percent or fractions (the ternary section's Percent labels tickbox), the triangular grid follows the standard Grid section, double-clicking an edge title renames its column, and clicking a point and setting Colour by to a category column gives the classic grouped look — set it back to None to remove it. One statistical caveat: compositions are closed (the three parts sum to 100%), so correlations between parts carry closure bias.",
          "Multi-omics timelines: the timeline tracks graph draws several stacked single-row tile strips over one shared time axis — the first column is time, and every other column is a track. A numeric column becomes a continuous track, ramped on its own scale with its own colour bar beside it; a text column becomes a categorical track, one hue per label keyed in the legend; a missing cell leaves a gap (or a fill colour you choose). The Chart type section sets the strip heights, gaps and labels. Because it shares the time axis and consumes the axis length like the heatmap, dropping it and another time-axis chart into a figure lines the two up column-for-column, so the tracks sit directly above a companion plot at the same times.",
          "Parts of a whole, hierarchy and flow: the pie (or donut) and the treemap show shares of one whole. A treemap packs its cells as organic Voronoi shapes or as squarified rectangles (Treemap section ▸ Layout); a Voronoi packing is one of many possible, and Arrangement — type a number, or press Another — tries a different one with the same areas. The sunburst plot draws a Multiple-variables or Parts-of-whole sheet whose leading text columns are nested levels (kingdom → phylum → class, or study → site → sample) as concentric rings — the centre is the whole, every ring out is one level deeper, a value column (or the row count) sizes each leaf, and each segment's angle is its share of the whole, nested inside its parent's. Segments are coloured by their top-level branch and shaded lighter toward the leaves, with an optional centre hole and a percentage on each arc, and labels thin themselves out where segments are too small to carry one; the Chart type section picks the level columns, the value column and the look. The chord / circos diagram draws a Network (edge list) sheet, or a square matrix, as arcs around a ring joined by ribbons: each entity's arc is proportional to its total weight, each ribbon to the pair's, so a migration table, a co-occurrence matrix or a gene-interaction list reads as one circle.",
          "Genomics: the volcano plot (fold change against −log10 p, with the up / down / not-significant zones keyed in the legend), the GWAS QQ plot (observed against expected −log10 p with the y = x line and the genomic inflation factor λ printed on the graph), the Manhattan plot (every marker along the genome, chromosomes laid end to end in alternating tones, with the genome-wide and suggestive significance lines; a dense cloud is thinned to one point per pixel and the graph says how many it drew) and the oncoprint (a genes × samples grid from a Genomic-alterations sheet — genes ordered by how often they are altered, samples sorted into the mutual-exclusivity staircase, cells coloured by alteration type). The QQ and Manhattan plots share the GWAS association results sheet.",
          "Histogram curves: a histogram can wear a Normal curve (a Gaussian from the data's own mean and SD, scaled to the frequency axis) and a Density curve (a kernel density estimate, the same estimate a violin uses, with a Smoothness control), separately or together — both in the Chart type section, each with its own Curve colour. They are refused, with a note, on a cumulative histogram or on unequal custom bins, where a fitted curve would mislead.",
          "Composite graphs: a bar chart's series can each be drawn as bars, points, a line or an area (Render as, per series), an XY series likewise, so bars and a line share one plot; the gallery's Bars + line (2nd axis) card is the ready-made starting point, with the line on a right-hand value axis. Add series from another datasheet (the Inspector's Data tab ▸ Series) borrows a column from any other sheet in the project onto an XY, area or bar graph — joined by X value on XY, by category name on bars — and styles it like any series (Render as, right axis, colour). The Series row says which sheet it came from, categories the graph does not have are skipped and named in a warning, and the borrowed series redraws whenever that sheet changes; a button beside it stops drawing it, leaving the other sheet and its statistics untouched.",
          "Image panels: a micrograph, blot or schematic can sit alongside real charts in a multi-panel figure.",
          "A pie can be drawn as a donut instead — the hole is a fraction of the radius, so it goes from a thin ring to a nearly-solid pie without changing anything else.",
          "A pie can also be shown as a waffle — a 10 × 10 grid of squares, each about one percent of the whole, coloured by category. It reads a proportion off a count of cells rather than an angle; the data and colours are the same as the pie, and its legend keys are squares, like the cells.",
          "A waffle can be turned into an icon array: tick Cells as shapes (Chart tab, Pie chart section) and each cell is drawn as its category's shape instead of a square, with the same shape in the legend, so the groups can be told apart without colour. Click any cell to choose that category's shape.",
          "A waffle can also count instead of showing percentages: set Each cell is to One observation (Chart tab, Pie chart section) and each cell is one observation from your counts. Above 100 in total, one cell stands for several. A caption under the grid says what one cell is, for example 1 icon = 3 patients; type the word for one observation in Unit name. Drag the caption to move it, double-click it to type your own words, and set its font in the same section.",
          "A waffle with many small groups can keep only the largest: set Groups shown (Chart tab, Pie chart section) and the rest are combined into one grey group, drawn last. Type its label in Name for the rest (Other by default), and click any of its cells to give it its own colour or shape. A single leftover group is never combined, because that would only hide its name.",
          "A survival chart can carry the numbers-at-risk table under the time axis, one row per curve, the way clinical papers report it. It comes from the analysis, so it counts what is actually still at risk at each tick rather than being typed in. Click its heading or a row name to size the table: Survival ▸ Number-at-risk font; click a row's counts to select its curve.",
          "XY and PCA scatters can carry confidence ellipses — one per group, at a confidence level you choose, drawn from the covariance of the points they enclose. The ellipse is computed, so it moves when the data do and cannot be dragged.",
        ],
      },

      { kind: "h", text: "Two things journals ask for, on almost any chart" },
      {
        kind: "ul",
        items: [
          "Every replicate over the bar — the “bar with data points” figure most journals now expect for small n. Turn on Points ▸ Show all points in the Inspector; the error bars stay, and the dots are ordinary markers you can restyle under Data points (shape, size, fill, opacity, colour). Box and violin plots have the same option. Point spread, on the Data tab when you click the dots, sets how far apart they sit sideways (they never leave their bar or box); its whole graph tick box, ticked to start with, sets every series at once — untick it to set only the series you clicked.",
          "The number on the bar. Show values (in the graph toolbar) prints each bar's number, and Chart ▸ Value position puts it above the bar, inside at the bar's top, or inside at its foot just off the axis (a bar too short for the text keeps its number above). Every value label can be dragged; while you drag it snaps to the line the other labels sit on, with a dashed guide showing the alignment, so a row of numbers ends up level.",
        ],
      },

      { kind: "h", text: "If it goes wrong" },
      {
        kind: "ul",
        items: [
          "The chart-type selector does not list the type you want: this datasheet's format cannot draw it. Table formats says which shape feeds which chart.",
          "You changed type and lost some styling: the new type has no such thing to style (a bar has no marker shape). The mapping is kept wherever the new type can use it; the rest is not silently carried.",
          "A gallery card's numbers look plausible: they are not real. Every value in every card is invented to show the chart's form — never cite one.",
          "Show all points is missing: that chart draws every value already (a column scatter, an XY), so there is nothing to reveal.",
          "The value labels overlap: drag one and it snaps to the line the others sit on. If they are still crowded, the bars are too narrow — widen the figure or shorten the numbers with Axis ▸ Numbering ▸ Decimals.",
        ],
      },
    ],
  },

  {
    id: "ribbon",
    title: "The graph toolbar",
    group: "Graphs and styling",
    summary: "The row above a graph — the changes you make most often, one click away.",
    keywords: [
      "toolbar", "ribbon", "strip", "quick", "grid", "minor", "wheel zoom", "ruler", "legend",
      "x log", "y log", "values", "points", "frame", "l-shape", "insert", "caption", "export",
      "datasheet", "summary", "mean sd",
    ],
    blocks: [
      {
        kind: "goal",
        text:
          "the edits you make fifty times a day — a log axis, gridlines, the legend, the frame — done " +
          "without opening the Inspector for any of them.",
      },
      {
        kind: "p",
        text:
          "The strip above an open graph is grouped left to right: what you can see, what the marks " +
          "summarise, the scale, the frame, what you insert, and how text is set.",
      },
      {
        kind: "shot",
        file: "graph-ribbon.png",
        alt:
          "The graph toolbar above a bar chart: the graph's name, then tickboxes for Grid, Minor, " +
          "Wheel zoom, Ruler and Legend, a Summary dropdown reading Mean ± SD, X log and Y log, " +
          "Values and Points, a Frame dropdown reading L-shape, an Insert menu, a text row with the " +
          "element picker, font, size, bold, italic, superscript, subscript and a symbol button, and " +
          "at the right the zoom controls, Caption, Datasheet and Export.",
        caption:
          "Everything on this strip is also somewhere in the Inspector — it is here because it is " +
          "what people reach for constantly. Which controls appear depends on the chart: a bar chart " +
          "offers Values and Points, an XY chart does not.",
      },

      { kind: "h", text: "What each control does" },
      {
        kind: "table",
        head: ["Control", "What it does"],
        rows: [
          ["Reset view", "Appears once you have zoomed or panned: back to 100% and to the whole of the data. Double-clicking the plot does the same."],
          ["Grid · Minor", "Gridlines behind the plot, and the finer lines between them."],
          ["Wheel zoom", "Off by default. On, the scroll wheel zooms the plot; off, the wheel scrolls the page, which is what you want while reading. (Ctrl+wheel magnifies the part under the pointer either way. The middle mouse button does nothing.)"],
          ["Ruler", "A measuring ruler around the figure, in pixels, inches or centimetres. It tracks resize and zoom, and is remembered per graph."],
          ["Legend", "The key on or off. Where it goes is in the Inspector, under Frame ▸ Title & legend."],
          ["Summary", "On a chart that summarises replicates: what the mark and its error bar show — mean ± SD, ± SEM, ± 95% CI, median with the interquartile range, and the rest. On a column scatter, Median + 95% CI of the median draws the exact interval the Describe analysis reports; a group with fewer than 6 values gets none, and the warning line says so."],
          ["X log · Y log", "Switch either axis to a base-10 log scale. The other scales are in the Axis tab."],
          ["Values · Points", "Print each bar's value at its tip; show every replicate as a dot over its own bar (click a dot to style the points like any other data points)."],
          ["Frame", "The lines around the plot: an L, a full box, offset axes, or none at all."],
          ["Insert", "A text box, line, arrow or shape, and images (PNG, JPG or SVG) placed on the graph."],
          ["Text", "Choose which text you mean (title, axis title, tick labels, legend, bar values…), then its font, size, bold, italic, subscript and superscript. Ω inserts a Greek or maths character into whatever you are editing."],
          ["Zoom", "Zoom out, 100% and zoom in, for the figure itself."],
          ["Caption", "Draft a figure caption and accessibility alt-text from what the figure actually shows."],
          ["Datasheet", "Open the data this graph is drawn from. When the graph borrows series from a second sheet, it offers both."],
          ["Export", "The same export dialog as Ctrl+E, scoped to this graph."],
        ],
      },

      { kind: "h", text: "Put something on the graph" },
      {
        kind: "steps",
        items: [
          {
            text:
              "Open the Insert list on the toolbar and choose from it: a text box, a line, an arrow, " +
              "a shape, or an image from disk.",
          },
          {
            text:
              "Pick one and it is placed on the graph, selected, ready to drag. Annotations and " +
              "reference lines covers what each object does.",
          },
        ],
      },

      { kind: "h", text: "Set text without hunting for it" },
      {
        kind: "steps",
        items: [
          {
            text:
              "In the toolbar's text row, choose which text you mean from the element picker — title, " +
              "axis title, tick labels, legend, bar values.",
          },
          {
            text:
              "Set its font, size, bold and italic there. Subscript wraps the selection as _{…} and " +
              "superscript as ^{…}, so “H_{2}O” and “10^{-6}” typeset properly.",
          },
        ],
      },

      { kind: "h", text: "If it goes wrong" },
      {
        kind: "ul",
        items: [
          "A control you expected is not on the strip: it does not apply to this kind of chart. The toolbar shows what the chart in front can actually do — a bar chart offers Values and Points, an XY chart does not.",
          "The scroll wheel zooms when you wanted to scroll the page (or the reverse): that is the Wheel zoom tickbox. It is off by default.",
          "Summary is missing: this chart does not summarise replicates — it draws every value.",
          "X log or Y log did nothing: the axis has data at or below zero, so it is drawn linear and the graph says so above the figure. Axes, scales and ticks has the fix.",
          "Export wrote the wrong thing: Export on this strip is scoped to this graph. Ctrl+E from elsewhere exports whatever is in front.",
        ],
      },
    ],
  },

  {
    id: "styling",
    title: "Selecting things on the figure",
    group: "Graphs and styling",
    summary: "Click what you want to change, and the Inspector becomes the controls for it.",
    keywords: [
      "select", "click", "pick", "target", "deselect", "escape", "inspector", "panel",
      "direct manipulation", "whole series", "one point", "scope", "apply to all", "filter options",
    ],
    blocks: [
      {
        kind: "goal",
        text:
          "the controls for the exact thing you clicked — one point, one bar, one axis or the whole " +
          "graph — with no doubt about which of those your next change will hit.",
      },
      {
        kind: "p",
        text:
          "The Inspector always shows settings for whatever is currently selected. Click a single bar and " +
          "you get that bar; click the axis and you get the axis. Selection never changes how something " +
          "looks — it draws a separate highlight — so you can always see the colour you are editing.",
      },

      { kind: "h", text: "Select something, and read the scope" },
      {
        kind: "steps",
        items: [
          {
            text:
              "Click any part of the figure — a point, a bar, an axis, the title, the legend, an " +
              "annotation. The Inspector switches to the controls for it; Escape deselects.",
            shot: {
              file: "inspector-series.png",
              alt:
                "The Inspector after clicking a data series: the Data tab for the Response series, with " +
                "Apply to whole graph and Apply to whole series checkboxes at the top, then Data points " +
                "(shape, size, fill, opacity, colour), value axis, colour by data, point labels, line and " +
                "error-bar controls.",
              caption:
                "Click one series and the whole Inspector targets it: the scope checkboxes first, then " +
                "that series' points, line and error bars. Click the picture to read the full panel.",
            },
          },
          {
            text:
              "Read the two checkboxes at the top of the panel before you change anything. They are the " +
              "scope — whether your next edit lands on one element, one series, or the whole graph.",
          },
          {
            text:
              "Cannot find a control? The Inspector has its own filter box. If you know the setting is " +
              "called “opacity” but not which panel it lives in, type it.",
          },
        ],
      },
      {
        kind: "table",
        head: ["Scope", "What an edit changes"],
        rows: [
          ["Apply to whole graph ticked", "Every series at once, in a single undo step."],
          ["Apply to whole series ticked (the default)", "The series you clicked."],
          ["Both unticked", "The single element you clicked — one point, one bar, one slice."],
        ],
      },

      { kind: "h", text: "Style one point on its own" },
      {
        kind: "steps",
        items: [
          {
            text:
              "Untick “Apply to whole series”, then click the single point (or bar, or slice) you mean.",
            shot: {
              file: "graph-scope-boxes.png",
              alt:
                "The two scope tickboxes at the top of the Inspector's Data tab: Apply to whole graph, unticked, and Apply to whole series, ticked.",
              caption:
                "The two boxes that decide where your next edit lands. Both unticked is the one-element case; the top one restyles every series at once.",
            },
          },
          {
            text:
              "Set its colour, shape, size, fill, opacity or outline. It applies to that element alone — " +
              "the way you highlight the one replicate that misbehaved. On a bar chart the whole fill " +
              "vocabulary follows, so a single bar can be patterned or shaded while the rest stays plain.",
          },
          {
            text:
              "Tick “Apply to whole series” again when you are done. The element keeps its override " +
              "until you clear it.",
          },
        ],
      },
      {
        kind: "ul",
        items: [
          "The seven tabs are the whole vocabulary: Chart (what kind of graph and its own options) · Frame (everything around the plot) · Axis (the selected axis) · Data (how the marks look) · Text (fonts and labels) · Annotate (what is drawn on top) · Style (presets).",
          "Some kinds let you style one element or all of them — a network node, an alluvial band, a pie slice. Where that choice exists, the panel says which scope you are editing.",
        ],
      },

      { kind: "h", text: "If it goes wrong" },
      {
        kind: "ul",
        items: [
          "You changed a colour and the whole series changed: “Apply to whole series” was ticked. Untick it for one element.",
          "You clicked a point and got the graph instead: you hit the plot background. Click the mark itself — points legitimately overlap, so try a less crowded one.",
          "The Inspector stayed empty: nothing on the figure is selected. Click inside the plot.",
          "You set something and nothing changed: a control that cannot apply to the current chart says so rather than doing nothing quietly. Look for a message near the top of the panel.",
          "An override will not clear: it lives on that element, not on the series. Select it again with the scope unticked and reset the field.",
        ],
      },
    ],
  },

  {
    id: "moving",
    title: "Moving, resizing and zooming",
    group: "Graphs and styling",
    summary: "Dragging things where you want them, and changing how large the figure is.",
    keywords: [
      "drag", "move", "reposition", "resize", "bigger", "smaller", "handles", "grips", "nudge",
      "zoom", "pan", "scroll", "wheel", "magnify", "fit", "graph size", "width", "height",
    ],
    blocks: [
      {
        kind: "goal",
        text:
          "everything on the figure where you want it, and the figure itself at the size you need — " +
          "with the difference between how large it is drawn on screen and how large it really is kept straight.",
      },

      { kind: "h", text: "Move something" },
      {
        kind: "steps",
        items: [
          {
            text:
              "Drag it. Almost everything on a figure can be dragged: titles, axis titles, the legend, " +
              "data labels, annotations, the fitted-curve readouts. Where you put a thing is saved with " +
              "the graph, survives resizing and export, and is undoable.",
          },
          {
            text:
              "For finer control, select an annotation and use the arrow keys — one pixel a press, or " +
              "ten with Shift.",
          },
        ],
      },

      { kind: "h", text: "Resize the figure, or just the plot" },
      {
        kind: "steps",
        items: [
          {
            text:
              "Select the graph, then drag one of the small grips it draws at its right edge, bottom " +
              "edge and bottom-right corner. The whole drawing scales evenly — text, markers and lines " +
              "with it — so the graph keeps its shape and the type does not distort.",
            shot: {
              file: "graph-resize-grips.png",
              alt:
                "The bottom-right corner of a selected graph, showing the three small resize grips it draws: one on the right edge, one on the bottom edge, and one at the corner itself.",
              caption:
                "Three grips, not four corners: the right edge, the bottom edge or the corner each makes the whole graph larger or smaller, keeping its shape.",
            },
          },
          {
            text:
              "To change only the plotting area, select an axis and drag its end — the right end of X, " +
              "the top of Y. The same number is in Axis ▸ Axis length.",
          },
          {
            text:
              "When a figure has to match another exactly, type it: Frame ▸ Graph size carries the width " +
              "and height in pixels.",
          },
          {
            text:
              "To say how wide the graph will print, press a Print size button in Frame ▸ Graph size: " +
              "1 column (85 mm), 1.5 column (114 mm) or 2 columns (174 mm); Page ↕ and Page ↔ fit the whole " +
              "graph on a full page (174 × 235 mm). The graph itself does not change — text, points, lines and " +
              "margins print scaled together — and the Export dialog starts at that width. The note under the " +
              "buttons says what the axis numbers will print at; if the smallest text falls below 6 pt, make " +
              "the graph narrower or its text larger. Off clears it.",
          },
        ],
      },

      { kind: "h", text: "Zoom and pan" },
      {
        kind: "table",
        head: ["To do this", "Do this"],
        rows: [
          ["Zoom the figure", "The − / 100% / + controls at the bottom right, or Ctrl+= and Ctrl+−. Ctrl+0 puts it back to 100%."],
          ["Zoom the plot with the wheel", "Tick Wheel zoom in the graph toolbar first — it is off by default so the wheel scrolls the page while you read."],
          ["Magnify just the part under the pointer", "Ctrl+wheel, whether Wheel zoom is on or off."],
          ["Pan an axis", "Drag along it. The range control follows what you did."],
          ["Undo all of it", "Reset view in the graph toolbar, which appears once you have zoomed or panned. Double-clicking the plot does the same."],
        ],
      },
      {
        kind: "note",
        text:
          "Zooming changes how large the figure is drawn on screen, not its real size. The exported file uses " +
          "the graph's own size and the export dialog's resolution, whatever the screen zoom happens " +
          "to be.",
      },

      { kind: "h", text: "If it goes wrong" },
      {
        kind: "ul",
        items: [
          "The wheel scrolls the page instead of zooming: Wheel zoom is off, which is the default. Tick it in the graph toolbar, or use Ctrl+wheel.",
          "A dragged label snapped back: the drag was read as a click. Press, move, then release — a movement under a few pixels is treated as a selection.",
          "The graph looks stretched: it is not — resizing scales the whole drawing evenly, so its shape never changes. If the lettering looks the wrong size, the view may be zoomed (Ctrl+0 resets it), or the graph's box may have been made smaller (drag a grip to enlarge it).",
          "Two figures will not match: drag is approximate, so type the numbers. Frame ▸ Graph size on both, or Axis ▸ Axis length for the plotting area alone.",
          "The exported file came out the wrong size: screen zoom has nothing to do with it. The export dialog's own size and resolution decide.",
        ],
      },
    ],
  },

  {
    id: "legend",
    title: "The legend",
    group: "Graphs and styling",
    summary: "The key: what it says, where it goes, when to label the lines instead, and when to do without one.",
    keywords: [
      "legend", "key", "caption", "series names", "position", "outside", "inside", "hide legend",
      "colour bar", "colour key", "size key", "symbol size", "columns", "swatch",
      "direct labels", "label the lines", "no legend",
    ],
    blocks: [
      {
        kind: "goal",
        text:
          "a key the reader does not have to work at — in the right place, saying the right names, or " +
          "replaced by labels on the lines themselves.",
      },
      {
        kind: "p",
        text:
          "The legend is drawn from the series names in the datasheet, so renaming a column renames its " +
          "key entry — there is no second list to keep in step. Its controls are in the Inspector under " +
          "Frame ▸ Title & legend, and the on/off tickbox is also in the graph toolbar.",
      },

      { kind: "h", text: "Put the legend where you want it" },
      {
        kind: "steps",
        items: [
          {
            text:
              "Click the legend (or open Frame ▸ Title & legend) and set Position.",
          },
          {
            text:
              "Pick Outside right, Outside top (a row above the plot), or one of the four Inside " +
              "corners — or Direct labels, which drops the key and names each line where it runs.",
            shot: {
              file: "graph-legend-panel.png",
              alt:
                "The Inspector's Frame tab with Title & legend open: the title rows, then the legend's Show and Position controls, its Layout, border, background, padding, gap, symbol size, font and colour.",
              caption:
                "Everything about the key is in one section, and Position is the control that also offers Direct labels — the choice between a key and naming the lines is one setting, not two features.",
            },
          },
          {
            text:
              "Or drag it. The position control is the quick way; the drag is the exact one.",
          },
        ],
      },
      {
        kind: "table",
        head: ["Position", "What you get"],
        rows: [
          ["Outside right", "Outside the plot on the right. Takes its space from the figure rather than covering the data."],
          ["Outside top (a row above the plot)", "A row between the title and the plot, centred on it, wrapping into more rows when the names are wider than the plot."],
          ["Inside top-right · top-left · bottom-right · bottom-left", "Inside the plot, in that corner. Costs no space, but can cover data."],
          ["Direct labels (no legend)", "No key at all: each series is named beside its own line, so the reader never carries a colour back from a box. Offered on the line-and-curve charts — XY, area, survival, ROC, QQ, Bland-Altman, before–after, and the ordination score, biplot, triplot and scree graphs."],
          ["Hidden", "No key. Right for a single-series graph, or when the caption already names the groups."],
        ],
      },
      {
        kind: "ul",
        items: [
          "An outside legend takes its space from the figure rather than covering the data. If a top row would take more than a third of the figure's height, MadY moves the legend inside (bottom right) instead of squeezing the plot to nothing — and nothing is dropped or cut.",
          "Columns: lay the entries out in more than one column when there are many short names.",
          "The key's symbol follows the marks it stands for — the same shape, the same fill, and the same size, so a graph with big markers gets a legend with big markers.",
          "Its text has its own font, size and colour, like every other text role on the figure.",
        ],
      },

      { kind: "h", text: "The two keys that are not the legend" },
      {
        kind: "p",
        text:
          "A heatmap or any value-coloured chart gets a colour bar — the continuous scale, with its own " +
          "position, size, ticks and heading (Inspector ▸ Colour bar). A bubble chart gets a size key " +
          "saying what an area means, drawn in the same shape as the marks (Inspector ▸ Bubble size " +
          "legend). Neither is controlled by the legend's own settings.",
      },
      {
        kind: "note",
        text:
          "A legend that repeats the axis is worth deleting. If the X axis already says Control, Drug A, " +
          "Drug B, a key saying the same three things twice is furniture.",
      },

      { kind: "h", text: "If it goes wrong" },
      {
        kind: "ul",
        items: [
          "The legend says the wrong names: it reads the datasheet's column names. Rename the column and the key follows — there is no second list.",
          "“Direct labels (no legend)” is not in the Position list: that chart has no lines to label. It is offered on XY, area, survival, ROC, QQ, Bland-Altman, before–after, and the ordination score, biplot, triplot and scree graphs.",
          "You asked for the legend on top and it appeared inside the plot instead: a top row would have taken more than a third of the figure's height, so MadY moved it rather than squeezing the plot to nothing. Widen the figure, or use two columns.",
          "The colour scale will not move with the legend controls: it is a colour bar, not the legend. Its own position and size are under Inspector ▸ Colour bar.",
          "The legend symbols are the wrong size: they follow the marks. Change the marker size and the key follows.",
        ],
      },
    ],
  },

  {
    id: "axes",
    title: "Axes, scales and ticks",
    group: "Graphs and styling",
    summary: "Every control on the Axis tab, one at a time: what it does, and exactly what to do.",
    keywords: [
      "axis", "axes", "scale", "log", "range", "minimum", "maximum", "limits", "ticks",
      "gridlines", "numbering", "decimals", "breaks", "cuts", "reverse", "second y", "dual axis",
      "category labels", "rotate labels", "axis length", "shaded bands", "custom ticks",
      "axis break", "resize the graph", "how do i",
    ],
    blocks: [
      {
        kind: "goal",
        text:
          "an axis that shows exactly the range, the scale, the numbers and the tick marks your figure " +
          "needs — and a break through it where a wide empty gap would otherwise squash your data into " +
          "a corner.",
      },
      {
        kind: "p",
        text:
          "Every axis on every graph is edited the same way: click it, and the Inspector on the right " +
          "opens the Axis tab for that axis. Nothing has to be applied — the figure changes as you type.",
      },

      { kind: "h", text: "Open the axis you want to change" },
      {
        kind: "steps",
        items: [
          {
            text:
              "Click the axis on the graph — its line, one of its numbers, or its title. It is drawn " +
              "highlighted to show what you have, and the Inspector opens the Axis tab for it.",
            shot: {
              file: "step-axisbreak-1.png",
              alt: "A dose-response graph with the Y axis selected: the axis line is drawn highlighted along its whole length, and the Inspector on the right has opened its Axis tab.",
              caption: "Clicking an axis is what opens its panel. The highlighted line tells you which one you have.",
            },
          },
          {
            text:
              "If the axis is hard to hit — a short one, or one hidden behind the data — use the X / Y " +
              "buttons at the top of the panel instead. Y2 appears on the chart types that carry a " +
              "second value axis: XY, area, bubble, histogram and volcano, and vertical bar, box, " +
              "violin, column scatter, lollipop, raincloud and floating-bar charts. Their horizontal " +
              "versions have it along the top, and the button there reads X2. Y3 appears only on XY, " +
              "area, bubble and volcano.",
          },
          {
            text:
              "The panel's groups open and shut by clicking their headings, and MadY remembers which you " +
              "left open. The “?” beside a heading opens this manual at that group.",
          },
        ],
      },

      // Axis breaks are explained once, under "Every control on the Axis tab" (the Breaks (cuts)
      // group); a second walkthrough here would only repeat it.

      { kind: "h", text: "The five settings people change most" },
      {
        kind: "table",
        head: ["You want", "Where it is", "What to do"],
        rows: [
          ["The axis to start at zero (or anywhere else)", "Axis ▸ Range ▸ Min / Max", "Type the number. Clear the box to go back to fitting the data."],
          ["A log axis", "Axis ▸ Scale ▸ Type", "Pick Log₁₀, Log₂, Ln or Probability. Log needs positive values — with data at or below zero the graph says so and draws linear."],
          ["A tick every 25 (not every 20)", "Axis ▸ Ticks ▸ Tick interval", "Type 25. Clear it for the automatic “nice” interval."],
          ["Two decimal places on every number", "Axis ▸ Numbering ▸ Decimals", "Type 2. Clear it and trailing zeros are trimmed instead."],
          ["Two graphs the same size", "Axis ▸ Axis length ▸ Length (px)", "Type the same number of pixels on both, or drag the end of the axis on the figure."],
        ],
      },

      { kind: "h", text: "An axis that carries names instead of numbers" },
      {
        kind: "p",
        text:
          "On a bar, box, violin, scatter or before-after chart the X axis carries your category names, " +
          "and on a forest, lollipop, paired-dot, ridgeline, pyramid, swimmer or tracks chart the Y axis " +
          "does. That axis gets a different panel: no Scale, no Range and no Numbering — those live on " +
          "the value axis at right angles to it — and two groups of its own.",
      },
      {
        kind: "ul",
        items: [
          "Category labels — the angle the names are drawn at (45° or 90° when they are long), and Hide axis.",
          "Category groups — gather the categories into named blocks. Under Group by, pick a column of your data that names each row's group, or pick By hand and type each category's group in its own box (the same name in two boxes puts them in one block). The block names, a rule between blocks, coloured labels and an optional tint each have their own tickbox.",
        ],
      },

      { kind: "h", text: "Every control on the Axis tab" },
      {
        kind: "p",
        text:
          "Every control, group by group, each with a picture showing where it is. The number beside a " +
          "control is the numbered box in the picture above it.",
      },
      { kind: "howto", surface: "Inspector > Axis" },

      { kind: "h", text: "If it goes wrong" },
      {
        kind: "ul",
        items: [
          "“Log needs positive values” above the figure: the axis has data at or below zero, so it is drawn linear. Set a Min above zero, or transform the column (Data ▸ Transform).",
          "The log setting does nothing at all: a few chart types draw a bespoke value axis and cannot take one — lollipop, paired dot, population pyramid and the estimation plots among them. The graph says so above the figure rather than failing silently. A volcano plot refuses for a different reason: both its axes already hold logged values.",
          "There is no Scale or Range group: you are on the axis that carries the names. Click the other axis — the one with numbers on it.",
          "The Y2 buttons are missing: that chart type has no second value axis. XY, area, bubble and volcano do, and so do histogram, vertical bar, box, violin, column scatter, lollipop, raincloud and floating-bar charts (those have Y2 only, no Y3). Their horizontal versions have it along the top — the X2 button.",
          "Y2 is there but nothing is drawn on it: tick a series under Series on this axis. The axis appears once at least one is on it.",
          "Break mark is not in the panel: it appears once there is at least one cut. Add a cut first.",
          "A heatmap has no Axis tab: its axes are its row and column names. The two titles, their fonts and the gap beside the row title are in the Chart tab's Heatmap section.",
          "On a 3-D scatter some numbers are missing, or sit further out than the others: a number is never drawn on a data point. The edge's numbers step outward together until they clear the points, and one that still cannot clear is left out.",
          "Tick thickness is greyed out: untick “Link ticks to axis”. Tick length is greyed out when “Show ticks” is off.",
          "Points have vanished: a Min or Max you typed is clipping them. The graph says how many are outside the range — clear the box to fit the data again.",
        ],
      },
      {
        kind: "p",
        text:
          "Axes can also be worked directly on the figure: drag along an axis to pan it and the Range " +
          "boxes follow what you did; drag the end of an axis to set its length. Every axis title — " +
          "Y2 and Y3 included — drags where you want it and retypes in place with a double-click. " +
          "The gridlines behind " +
          "the plot, the frame around it and the plot margins belong to the graph rather than to one " +
          "axis, and live under Frame.",
      },
    ],
  },

  {
    id: "colours",
    title: "Colours, fills and symbols",
    group: "Graphs and styling",
    summary: "What a mark is filled with, outlined in, and shaped like.",
    keywords: [
      "colour", "color", "palette", "colourblind", "fill", "pattern", "hatching", "gradient",
      "ramp", "viridis", "symbol", "marker", "shape", "circle", "square", "triangle", "opacity",
      "transparent", "line width", "dash", "error bar", "sd", "sem", "confidence interval",
      "shaded band", "pipette", "eyedropper", "recolour", "colour by value",
    ],
    blocks: [
      {
        kind: "goal",
        text:
          "marks that read the way you want them to — the right colour, fill, shape and error bar — " +
          "including in greyscale and for a colour-blind reader.",
      },
      {
        kind: "p",
        text:
          "New graphs use a colourblind-safe palette by default. It is a starting point, not a cage — " +
          "every colour is editable, and Settings can change the default palette for new graphs.",
      },

      { kind: "h", text: "Recolour a series" },
      {
        kind: "steps",
        items: [
          {
            text:
              "Click the series on the graph. The Inspector's Data tab opens on it — check the scope " +
              "boxes at the top before you change anything (see Selecting things on the figure).",
          },
          {
            text:
              // The control's label is "Style", inside the "Fill" group; the step's picture
              // shows it.
              "Set Style first — the first row of the Fill group. It decides what the rest of the " +
              "section offers: solid, two-tone " +
              "(a lighter fill under a darker outline of the same hue), pattern, gradient, metallic, " +
              "themed special effects, or graduated, where the colour follows the value.",
            shot: {
              file: "graph-fill-section.png",
              alt:
                "The Fill group of a bar series in the Inspector's Data tab: a Style row reading Two-tone (light fill + dark edge), then Fill with its colour swatch and pipette, Opacity, a row of palette swatches, Fill lightness, Edge darkness and Contour width.",
              caption:
                "Style is the first row and it decides the rest: a solid fill wants one colour, a graduated one wants a ramp.",
            },

          },
          {
            text:
              "Then set the colour. Recently used colours are collected as you go, so a colour you " +
              "mixed for one series is one click away for the next, and the picker has a screen pipette " +
              "where the operating system provides one.",
          },
        ],
      },
      {
        kind: "table",
        head: ["Style", "What it draws"],
        rows: [
          ["Solid", "One colour."],
          ["Two-tone", "A lighter fill under a darker outline of the same hue — the default for markers."],
          ["Pattern", "Hatching in either direction and crossed, horizontal and vertical rules, grids, dots in two sizes, rings, checks, squares, zigzags, chevrons, waves, scales and triangles."],
          ["Gradient · metallic · special effects", "A sweep across the mark rather than a flat colour."],
          ["Graduated", "The colour follows the value, along a colour ramp — seventeen built in, including viridis, magma, plasma, inferno, cividis, turbo, spectral, coolwarm, greyscale and single-hue blues, reds and greens. Any ramp can be reversed so low values read dark."],
        ],
      },

      { kind: "h", text: "Build a colour ramp of your own" },
      {
        kind: "steps",
        items: [
          {
            text:
              "Open any ramp picker and choose “Edit / new gradient…” — it is the last entry in " +
              "every ramp dropdown in the program, so the editor opens from wherever you already are.",
            shot: {
              file: "graph-gradient-editor.png",
              alt:
                "The gradient editor: the ramp drawn as a wide bar with its colour stops beneath, the stop's position and colour fields, the hue-sweep generator, and the accessibility previews simulating deuteranopia, protanopia and greyscale.",
              caption:
                "Two ways to build one, and they interconvert: place stops by hand, or generate a hue sweep. The previews show what a colour-blind reader and a black-and-white printer will see.",
            },
          },
          {
            text:
              "Either place colour stops by hand — click the bar to add one, drag it to move it, type " +
              "its position or paste a list of hex codes — or generate a hue sweep by setting where the " +
              "hue starts and ends, which way round the wheel, how many laps, and the saturation and " +
              "lightness it travels at. Convert to stops freezes a generated sweep so you can fix a " +
              "single colour by hand.",
          },
          {
            text:
              "Read the previews before you keep it: the editor shows the ramp as drawn and simulated " +
              "for deuteranopia, protanopia and greyscale, with a note when two classes would be hard " +
              "to tell apart or when the ramp gets lighter and then darker again. It is advice, never " +
              "a refusal.",
          },
          {
            text:
              "Save to my library keeps a gradient across every project; the project keeps its own copy " +
              "too, so a file you send someone opens with the right colours. Opening a built-in ramp " +
              "gives you an editable copy — viridis and the rainbow themselves never change.",
          },
        ],
      },

      { kind: "h", text: "Tune any ramp in the program" },
      {
        kind: "p",
        text:
          "Every ramp — graduated fills, colour-by-a-column, the heatmap, parallel coordinates, timeline " +
          "tracks and the ridgeline spectrum — carries the same four rows under its ramp picker. Leave " +
          "a row blank and nothing changes.",
      },
      {
        kind: "table",
        head: ["Row", "What it does"],
        rows: [
          ["Centre at", "Pins the middle colour to a data value you type, so a blue-white-red map puts white exactly on zero instead of halfway up the range. A centre value outside the data cannot centre anything, so the graph says so and leaves the ramp alone rather than quietly ignoring what you typed."],
          ["Detail bias", "Bends the ramp toward the low end (above 1) or the high end (below 1) without moving the end colours — it pulls detail out of data bunched at one end."],
          ["Colour steps", "Draws the ramp as that many discrete classes instead of a smooth sweep, and the colour bar follows. The class edges follow a rule you choose in the editor: equal intervals, equal counts (quantile — the right choice for skewed data, where equal intervals crowd nearly everything into one class), or cut values you type. The bar draws the classes at their real widths, as solid blocks rather than a fade."],
          ["Blend", "How colours mix between the ramp's stops. Straight (the default) mixes the stop colours directly, Vivid keeps a rainbow saturated instead of passing through grey, and Perceptual makes equal steps look equally different."],
        ],
      },
      {
        kind: "ul",
        items: [
          "A gradient can also carry a below-the-scale and an above-the-scale colour. They show only where you have pinned Scale min or Scale max, and they turn a clipped scale into something readable: values off the end get their own colour instead of piling up in the ramp's last one.",
        ],
      },

      { kind: "h", text: "Symbols, lines and error bars" },
      {
        kind: "ul",
        items: [
          "Symbols: circle, square, triangle up or down, diamond, pentagon, hexagon, octagon, star, plus, cross, ring, squircle, oval, waffle, or none — each solid, open (filled with the page colour) or clear (see-through).",
          "Lines: width, dash pattern, and how points are connected — straight, stepped, or smoothed.",
          "Error bars: SD, SEM, 95% CI, range, geometric SD, median with the interquartile range, or your own asymmetric values; drawn up, down, or both ways. Each choice carries its own centre — “Median + IQR” traces the median, the rest trace the mean — so the point and the interval around it always belong together.",
          "On XY and area charts the same interval can be drawn as a shaded band following the curve instead of as error bars, or as both together — with its own fill colour and opacity, and an optional outline in any thickness, colour and dash pattern. It is only ever a different way of drawing the interval you already chose, so the numbers do not change. A band needs data that has an error in it — replicates, or a mean with an SD/SEM column — and at least two points carrying one.",
          "A backdrop is available if you want one: a soft gradient with optional wave bands behind the plot, in three palettes, with a legibility scrim so the data still reads. It is off by default and stays off unless you ask for it — a figure for a paper usually wants nothing behind it.",
        ],
      },
      {
        kind: "note",
        text:
          "When you change a colour, the panel says what the change will apply to — just the element you " +
          "clicked, or every element of that kind in the graph. Check that scope before you decide the " +
          "control did the wrong thing.",
      },

      { kind: "h", text: "Colour, shape or label each point from a column" },
      {
        kind: "p",
        text:
          "A column of your datasheet can set each point's colour, its shape and a label beside it — " +
          "a scatter coloured by treatment, a ternary diagram coloured by soil class. It is offered on " +
          "the charts that draw one mark per row: XY, area, bubble, funnel, ternary and swimmer. A " +
          "volcano plot takes the labels only, because its colours already mean up, down and not " +
          "significant.",
      },
      {
        kind: "steps",
        items: [
          "Click a point on the graph. The Data tab opens on its series.",
          {
            text:
              "Under Colour by data, pick the column in Colour by. Mapping decides how its values become colours: Category gives each distinct value its own palette colour and a legend entry, Continuous runs the values along a colour ramp with a colour bar, and Auto picks Category for a text column and Continuous for a numeric one. A continuous mapping gets Ramp, Reverse ramp and the four ramp rows described above.",
            shot: {
              file: "graph-colour-by-data.png",
              alt: "The Colour by data, Symbol by data and Point labels groups for a ternary chart's points: Colour by set to the Class column with Mapping on Category (palette), Shape by on None, and Label points on None.",
              caption: "The ternary gallery chart is coloured by its Class column. Set Colour by to None and the points go back to the series colour.",
            },
          },
          "Under Symbol by data, pick a column in Shape by: each distinct value gets its own marker shape.",
          "Under Point labels, pick what Label points writes beside each point — the X value, the Y value, or a column you choose — then set its size and colour.",
          "To remove any of these, set its column back to None.",
        ],
      },
      {
        kind: "table",
        head: ["Chart", "What differs"],
        rows: [
          ["Swimmer", "Click a bar — it opens the Start series, which colours the bars: its only row is Colour bars by, and it takes categories (a Stage column, say) — a numeric column has no reading on a bar, and the graph says so. The End, Response and Ongoing columns draw no marks of their own and offer none of these rows. The event columns offer all of them, and their labels offer Time rather than X value and Y value, because both would be the event's time."],
          ["Ternary", "Label points offers a column, not X value or Y value: a point's position is a place inside the triangle, not a number in your table."],
        ],
      },
      {
        kind: "note",
        text:
          "Formatting one point by hand still wins over the column: a point you recoloured keeps its own " +
          "colour, and a point you only resized keeps the colour the column gave it.",
      },

      { kind: "h", text: "Style an UpSet plot's bars" },
      {
        kind: "steps",
        items: [
          "Click an intersection bar. The UpSet plot section opens; Bar colour and Dot colour are at the top.",
          {
            text:
              "Under Intersection bars: Bar shape (square, rounded, round top) and Bar width are the bar chart's own rows. Bar fill is Solid or Two-tone, Bar opacity fades them, and Outline colour and Outline width draw a contour — under Two-tone the outline is a darker shade of the bar colour, so its colour row is not shown.",
            shot: {
              file: "graph-upset-bars.png",
              alt: "The Intersection bars rows of the UpSet plot section: Bar shape, Bar width, Bar fill, Bar opacity, Outline colour and Outline width, then Highlight bar set to its second bar with that bar's Highlight colour, opacity and outline below.",
              caption: "Every bar's look first, then one bar picked out. The three Highlight rows appear once a bar is chosen.",
            },
          },
          "To pick out one intersection, choose it in Highlight bar — the list names each bar by its sets (“2. Drug A ∩ Drug B”). Highlight colour, opacity and outline then style that bar alone. Choose None to remove it.",
          "With Counts above bars ticked, Count position puts each count above its bar, inside at its top or inside at its foot, and Count shift moves them all up or down by a number of pixels.",
        ],
      },
      {
        kind: "note",
        text:
          "A highlight belongs to a bar's place — the first bar, the second — the same way a count you dragged " +
          "does. Change Sort by, or the data, and it stays on whichever bar is now in that place.",
      },

      { kind: "h", text: "Where the shaded band's numbers come from" },
      {
        kind: "p",
        text:
          "There is no second calculation anywhere: the band is the same " +
          "interval the error bars draw. At each X, the replicate values in that row are summarised — count, " +
          "mean, SD, SEM, 95% CI (Student t, not 1.96), min and max, median and quartiles. The Type you pick " +
          "then selects the centre and the reach: Mean ± SD, ± SEM, ± the t-based 95% CI, mean with the full " +
          "range, the geometric mean with a ×/÷ geometric SD factor, or the median with Q1–Q3. The curve joins " +
          "the centres; the band's upper edge joins the high values across the chart and its lower edge joins " +
          "the low values back, closed into one shape and drawn with the same interpolation as the curve, so " +
          "the two can never drift apart.",
      },
      {
        kind: "p",
        text:
          "A worked example, from the sample project. At a dose of 0.1 the three replicates are 4, 6 and 2. " +
          "The mean is 4 and the sample SD is 2, so “Mean ± SD” puts the curve at 4 and the band from 2 to 6. " +
          "Switch the Type to SEM and the same band narrows to 4 ± 1.15; switch it to Median + IQR and the " +
          "curve moves to the median with the quartiles around it. Choosing bars, band or both changes none " +
          "of those numbers — only how they are drawn.",
      },
      {
        kind: "note",
        text:
          "Entering summarised data works too: if the sheet holds a mean with an SD, SEM or N column, or " +
          "explicit upper and lower limits, the band is built from those columns directly rather than from " +
          "replicates. What it cannot do is invent an error — a single value per point has no spread to shade, " +
          "so the band is not offered.",
      },

      { kind: "h", text: "If it goes wrong" },
      {
        kind: "ul",
        items: [
          "The colour changed on every series: “Apply to whole graph” or “Apply to whole series” was ticked. The scope boxes are at the top of the panel.",
          "The shaded band is not offered: the data has no error in it. A band needs replicates, or a mean with an SD/SEM column, and at least two points carrying one.",
          "You typed a Centre at value and the ramp did not move: the value is outside the data, so there is nothing to centre on. The graph says so rather than ignoring you quietly.",
          "The heatmap is nearly all one colour: the data is skewed. Set Colour steps and choose equal counts (quantile) — equal intervals crowd almost everything into one class.",
          "A built-in ramp changed under you: it cannot. Opening one in the editor gives you an editable copy, and the built-in stays as it was.",
          "There is no pipette in the colour picker: the operating system does not offer one. Everything else in the picker still works.",
          "A figure printed in black and white is unreadable: use the Grayscale (print) preset, which cycles marker shapes as well as grey levels — see Presets and defaults.",
          "Colour by data is not in the panel: that chart draws no one-mark-per-row points (a bar, a box, a heatmap). On a swimmer, you clicked a column that draws no marks — click the Start series for the bars, or an event glyph.",
          "An UpSet highlight moved to another bar: it belongs to the bar's place, and the sort or the data changed which combination is there. Pick the bar again in Highlight bar.",
        ],
      },
    ],
  },

  {
    id: "text",
    title: "Text, fonts and labels",
    group: "Graphs and styling",
    summary: "Every string on a figure is editable, movable and separately styleable.",
    keywords: [
      "font", "typeface", "size", "bold", "italic", "subscript", "superscript", "greek", "symbol",
      "title", "subtitle", "axis title", "tick labels", "value labels", "rename", "edit text",
      "double-click", "in place", "scientific notation", "en dash",
    ],
    blocks: [
      {
        kind: "goal",
        text:
          "every word on the figure saying what you want, set the way a journal sets it — subscripts, " +
          "superscripts, Greek and proper scientific notation included.",
      },

      { kind: "h", text: "Change what a label says" },
      {
        kind: "steps",
        items: [
          {
            text:
              "Double-click the text on the figure. It becomes editable in place — the title, an axis " +
              "title, a legend name, a tick label, a data label, an annotation.",
            shot: {
              file: "graph-edit-in-place.png",
              alt:
                "A graph's title being edited in place: the title text sits in an active edit box on the " +
                "figure itself, with the rest of the graph drawn normally around it.",
              caption:
                "No dialog and no properties field — you edit the words where they are drawn. Double-clicking empty space inside a plot adds a new text box there.",
            },
          },
          {
            text:
              "Type, then press Enter or click away. Escape leaves it as it was.",
          },
          {
            text:
              "For a series name, edit the column name in the datasheet instead — the legend, the axis " +
              "and the analysis output all read from it, so renaming it once fixes them together.",
          },
        ],
      },

      { kind: "h", text: "Set the type" },
      {
        kind: "ul",
        items: [
          "Fonts are set per role: title, subtitle, axis titles, tick labels, legend, value labels, cell and node labels. Set them individually, or set the figure's font once and let the rest follow.",
          "Rich text within a label: bold, italic, subscript (_{…}) and superscript (^{…}), plus a Greek and maths symbol inserter. The graph toolbar's text row has all of it, and it applies to whichever text role you pick there.",
          "Numbers in labels are typeset for print — scientific notation as 1.2 × 10⁻⁶ rather than 1.2e-6, and intervals with a proper en dash.",
          "Fitted parameters can be printed inside the axes the way journals set them (K_{M} = 29 ± 3), with their own size and alignment. Turn it on under Fit parameters once a curve fit exists.",
          "The legend has its own text, font, colour and position, and heatmaps get a colour bar with its own heading.",
          "A heatmap can have a thin gap between its cells: Gap between cells in the Chart tab's Heatmap section. The gap is the page colour unless you pick one under Gap colour. It helps colours be read accurately — without it, each cell is judged against its neighbours, so the same colour looks darker among light cells and lighter among dark ones.",
          "A heatmap has no Axis tab, so its two titles are typed and styled in the Chart tab's Heatmap section: Column axis title and Row axis title, each followed — once it has a title — by its own font rows (font, size, bold, italic, colour), and Row title ↔ labels for the space between the row title and the row names.",
          "Value labels on a bar chart or histogram (Value position, Value shift) and the counts on an UpSet plot (Count position, Count shift) can be moved all together: the position puts them above the bar or inside it, and the shift moves every one up or down by the pixels you type. Drag a single label to move just that one.",
          "Every one of these can be dragged where you want it, and it stays there through resizing and export.",
        ],
      },
      {
        kind: "shot",
        file: "graph-heatmap-titles.png",
        alt: "The title rows of a heatmap's Heatmap section: Column axis title reading Samples with its Column title font rows (font, size, bold, italic, colour and swatches), Row axis title reading Genes with its Row title font rows, and Row title ↔ labels set to 6.",
        caption: "A heatmap's titles are typed and styled in its own section. Each title's font rows appear once it has words in it.",
      },
      {
        kind: "table",
        head: ["You want", "Type this"],
        rows: [
          ["H₂O", "H_{2}O"],
          ["10⁻⁶", "10^{-6}"],
          ["A Greek letter or maths sign", "Press Ω in the graph toolbar's text row and pick it."],
        ],
      },
      {
        kind: "note",
        text:
          "The braces are required. A bare underscore or caret is drawn literally — “H_2O” stays “H_2O” " +
          "— because a sheet full of file names and gene symbols would otherwise typeset itself into " +
          "nonsense.",
      },

      { kind: "h", text: "If it goes wrong" },
      {
        kind: "ul",
        items: [
          "Double-clicking did nothing: that text is computed, not typed — a tick number, a fitted parameter. Change what it says by changing the number format or the fit, not the string.",
          "Your subscript came out literally: the braces are required — _{2}, not _2.",
          "You renamed a legend entry and the axis still says the old name: rename the column in the datasheet instead, and both follow.",
          "A font change hit the wrong text: the graph toolbar's text row applies to the role chosen in its picker. Check which role is selected.",
          "The text will not stay where you dragged it: it will — drags survive resizing and export. If it snapped back, the drag was read as a click.",
          "The heatmap's title font rows are not there: they appear once the title has words in it. Type the title first.",
        ],
      },
    ],
  },

  {
    id: "annotations",
    title: "Annotations and reference lines",
    group: "Graphs and styling",
    summary: "The Design menu — everything drawn on top of a chart.",
    keywords: [
      "annotation", "annotate", "text box", "arrow", "callout", "line", "rectangle", "box",
      "ellipse", "circle", "highlight", "reference line", "threshold", "band", "zone",
      "normal range", "image", "logo", "draw on", "label the graph", "lock", "group",
    ],
    blocks: [
      {
        kind: "goal",
        text:
          "the figure marked up the way a reader needs it — a threshold line, a shaded zone, an arrow " +
          "at the thing you are pointing out — with the lines that come from your data kept accurate.",
      },
      {
        kind: "p",
        text:
          "Design holds the objects that sit over a chart rather than being computed from the data. Add " +
          "them from the menu, from the graph toolbar's insert list, or by double-clicking the plot for a " +
          "text box.",
      },

      { kind: "h", text: "Put an object on the graph" },
      {
        kind: "steps",
        items: [
          {
            text:
              "Pick the object from Design, or from Insert on the graph toolbar. For a text box, just " +
              "double-click empty space inside the plot.",
            shot: {
              file: "annotations-on-graph.png",
              alt:
                "A dose-response graph carrying four annotations: a text box reading Plateau above " +
                "30 µM, an arrow pointing at the mid-curve point, a dashed horizontal reference line " +
                "captioned Half-maximal response, and a grey vertical band over the steep part of the " +
                "curve.",
              caption:
                "Four Design objects on one graph: a text box, an arrow, a dashed reference line with " +
                "its caption, and a vertical band. The line and band are anchored to data values; the " +
                "text and arrow sit where you put them.",
            },
          },
          {
            text:
              "Drag it where you want it, or nudge it with the arrow keys — one pixel a press, ten with " +
              "Shift.",
          },
          {
            text:
              "For a Highlight, select a region of data first: the highlight snaps to it, so it marks " +
              "the points you meant rather than the pixels you dragged over.",
          },
        ],
      },
      {
        kind: "table",
        head: ["Object", "What it is for"],
        rows: [
          ["Text box · callout", "A note on the figure. A callout is a text box with a pointer to the thing it is about."],
          // Note: "line segment", not just "line": the annotation kind is `segment`, and every
          // annotation kind is named somewhere in the manual.
          ["Arrow · line segment · rectangle · ellipse", "Pointing at something, or ringing it."],
          ["Highlight", "A tinted box with a bold outline, snapped to a region of data you selected."],
          ["Reference line (horizontal or vertical)", "A threshold, a control value, a limit of detection. Anchored to a data value, so it moves with the axis rather than with the page. Click its caption for its Label size."],
          ["Band (horizontal or vertical)", "A shaded range rather than a single line. It can float over a fraction of the plot, or be pinned to an axis-value range (a From/To in real units) so it tracks the scale and clips to the axis — the way you mark a normal range. Give each band a caption and switch on the zone key to show them as a labelled key in a corner of the graph. Click a caption for its Label size."],
          ["Image", "A logo, a diagram, a chemical structure. The bytes are stored inside the document, so the file stays self-contained."],
          ["Significance brackets", "Their own section, under Statistics."],
        ],
      },
      {
        kind: "p",
        text:
          "Free-floating objects — text, boxes, ellipses, arrows, images — can be selected together and " +
          "aligned, distributed evenly, brought to front or sent to back, and grouped and locked so a " +
          "stray drag cannot disturb a finished arrangement. Reference lines, bands and brackets are " +
          "anchored to data values instead, so they are excluded from that arrangement toolbar by design.",
      },

      { kind: "h", text: "The lines a chart draws for itself" },
      {
        kind: "p",
        text:
          "Some charts come with guide lines you did not add: the bias line and the limits of agreement " +
          "on a Bland-Altman, the no-effect line on a forest plot, the centre of a population pyramid, " +
          "the origin cross on a PCA, the control-mean line on an estimation plot, the fold-change and " +
          "significance thresholds on a volcano, the chance diagonal on a ROC curve, and the rules " +
          "between the sections of a paired dot plot. An XY graph can also opt into the line of " +
          "identity (y = x) — the diagonal a perfect agreement would follow, for method comparison. " +
          "An XY graph can also become a bump chart (a rank chart): tick “Rank (bump) chart” in the " +
          "Chart type panel and each series is plotted by its rank among the series at every X — the " +
          "largest value is rank 1 — on a reversed integer Rank axis, so a rankings-over-stages table " +
          "reads as crossing lines.",
      },
      {
        kind: "steps",
        items: [
          {
            text:
              "Click one on the graph — or its row in Chart ▸ Reference lines — and it opens with its " +
              "own colour, thickness and dashes, plus a switch to hide just that line.",
            shot: {
              file: "graph-refline-row.png",
              alt:
                "The Reference lines row in the Inspector's Chart tab, carrying the shared colour, thickness and dash controls for every line the chart draws for itself.",
              caption:
                "⚠️ Its label changes with the chart: a graph whose only computed line is the fit marker calls this row EC50 / IC50 marker instead.",
            },
          },
          {
            text:
              "Match the others copies one line's look to the rest of the chart, and Reset this line " +
              "drops back to the built-in appearance.",
          },
        ],
      },
      {
        kind: "note",
        text:
          "These lines cannot be dragged or deleted, and that is deliberate: each one sits at a value " +
          "computed from your data — a mean difference, a null value, an origin. Moving one would draw " +
          "a number the data does not contain, and a deletion could not stick, because the chart works " +
          "the line out again every time it redraws. Hide it instead. Their captions are free text and " +
          "do move: drag a label, or double-click it to rename.",
      },

      { kind: "h", text: "What a fit draws" },
      {
        kind: "p",
        text:
          "A curve fit, a regression or a global fit puts its results on the graph: the fitted curve, " +
          "the shaded confidence and prediction bands, and — for a dose-response fit — the EC50 / IC50 " +
          "marker, a dashed drop-line to each axis at the dose the fit found. Click the fitted curve or " +
          "a band and the Annotate tab opens the Fitted curve section: the curve's colour, thickness, " +
          "dashes and opacity, each band's colour and opacity, and a Show switch for each so you can " +
          "hide the prediction band and keep the confidence band, or hide the curve and keep its bands. " +
          "The EC50 / IC50 marker is one of the reference lines above — click either leg, or its row " +
          "under Chart ▸ EC50 / IC50 marker — for its own colour, thickness, dashes and hide switch, and the label's own font and size (click the “EC50 = …” label). " +
          "The look survives a re-fit; the shapes themselves are the fit and cannot be moved.",
      },

      { kind: "h", text: "If it goes wrong" },
      {
        kind: "ul",
        items: [
          "The Design commands are greyed out: a few chart types have no coordinate space to anchor an annotation to — a network, for instance. They are greyed rather than accepting an object that could never be drawn.",
          "A reference line will not move: it is computed from your data, and moving it would draw a number the data does not contain. Hide it instead — its caption does move.",
          "You deleted a built-in line and it came back: it would. The chart works it out again every redraw. Use the hide switch.",
          "A band drifted when you changed the axis range: it was a floating band, set as a fraction of the plot. Pin it to an axis-value range (From/To in real units) and it tracks the scale instead.",
          "A highlight covers the wrong points: it was dragged rather than snapped. Select the region of data first, then add the highlight.",
          "An object will not budge: it is locked, or in a locked group. Unlock it from the arrangement toolbar.",
        ],
      },
    ],
  },

  {
    id: "presets",
    title: "Presets and defaults",
    group: "Graphs and styling",
    keywords: [
      "preset", "theme", "house style", "default look", "journal", "restyle", "share a preset",
      "apply to other graphs", "same look", "grayscale", "universal design", "export preset",
      "import preset", "bar width", "own settings",
    ],
    summary: "Set a look once and reuse it — for one graph, for every graph of a type, or for every graph you make from now on.",
    blocks: [
      {
        kind: "goal",
        text:
          "one look, applied everywhere you want it and nowhere you do not — to this graph, to graphs " +
          "you choose, or to every graph you make from now on.",
      },
      {
        kind: "p",
        text:
          "Three tools share this job, at three ranges. A style preset restyles one graph in a click — " +
          "and can carry a graph type's own settings, so a bar preset knows its bar width. Apply " +
          "this look pushes the open graph's look onto graphs you tick. And the defaults in " +
          "View ▸ Settings decide what every new graph starts from.",
      },
      {
        kind: "table",
        head: ["You want", "Use", "Reaches"],
        rows: [
          ["This graph to look like a journal figure", "Inspector ▸ Style ▸ Style preset", "The open graph, in one undoable step."],
          ["Several graphs to match this one", "Graph ▸ Apply this look to other graphs", "Every graph you tick, in one undoable step."],
          ["Every graph you make from now on to start this way", "View ▸ Settings — styles & preferences…", "New graphs only. Nothing here ever changes an existing graph."],
        ],
      },

      { kind: "h", text: "Restyle one graph with a preset" },
      {
        kind: "steps",
        items: [
          {
            text:
              "Open the Inspector's Style tab. Each preset is a card — its name, its colour palette, a " +
              "line on what it is for.",
            shot: {
              file: "style-preset-cards.png",
              alt:
                "The Inspector's Style preset section: six preset cards, each with its name, a row of " +
                "palette swatches and a one-line description, a star beside each card; a saved preset of " +
                "your own with a Manage… button above it; a Save this graph as a " +
                "preset box with an Include this graph type's own settings tick; and Import preset…, " +
                "Export library… and Import library… buttons under Back up & transfer.",
              caption:
                "The whole Style preset section: the six built-in cards, a saved preset of your own in " +
                "the same list (“· yours”, simple until Manage… is pressed), the Save this graph " +
                "as a preset box and its tick, the ★ that decides what new graphs start from, and Back up " +
                "& transfer at the foot.",
            },
          },
          {
            text:
              "Click a card. The whole graph restyles in one undoable step: the font family and sizes " +
              "for the title, axis titles, tick numbers and legend; axis thickness and colour; " +
              "gridlines; the series palette; line and marker weights.",
          },
          {
            text:
              "Your own cards start simple — name, colours, ★ — so the list reads like the built-in " +
              "one. Renaming, copying, ordering and the types a preset holds are one press away: " +
              "Manage… above your cards. See Manage your presets below.",
          },
        ],
      },
      {
        kind: "table",
        head: ["Built-in preset", "What it is for"],
        rows: [
          ["MadY default", "The house look: Helvetica, bold black axes, two-tone markers with a clearer fill and a darker outline."],
          ["Scientific Journal", "Thin soft axes, no gridlines, haloed markers, a restrained journal palette."],
          ["Bold infographic", "Large bold type, thick axes, a vivid palette, a light grid."],
          ["Editorial", "A data-journalism look: big bold left-aligned title, no frame, no grid."],
          ["Grayscale (print)", "A greyscale palette and soft axes, for anything printed in black and white. Series differ only by grey level, so the marker shapes cycle too (circle, triangle, square, diamond, …) and a fitted curve wears its points' grey."],
          ["Universal design", "A viridis palette, a marker shape per series, slightly transparent points, bold axis titles, no gridlines — parameters taken from the ggplotplus package. Colour, shape and position each carry the series, so the figure still reads for colour-blind readers and in print."],
        ],
      },
      {
        kind: "ul",
        items: [
          "A preset changes styling only, and all of it: it also clears per-series marker and line settings it does not itself specify, so switching presets never leaves residue from the last one. Hand-tuned markers are lost with the rest — one undo brings them back.",
          "A preset never touches your content: data, titles you typed, axis ranges and scales, number formats, legend position, annotations, curve fits and the figure's size all stay exactly as they were.",
        ],
      },

      { kind: "h", text: "Save your own look, and make it the default" },
      {
        kind: "steps",
        items: [
          {
            text:
              "Style the graph the way you want it, then type a name into “Save this graph as a preset” " +
              "and press Save. It joins the same list marked “yours”, and applies to any graph of any " +
              "type. Saving under an existing name replaces that preset's shared look and keeps the " +
              "graph-type sections it already had.",
            shot: {
              file: "style-preset-save.png",
              alt:
                "The foot of the Style preset section, close up: the Save this graph as a preset box " +
                "with a name field and Save button, a ticked Include this graph type's own settings box, " +
                "the ★ Set this graph as the default button, a line reading “New graphs start from MadY " +
                "default”, and the Back up & transfer buttons Import preset…, Export library… and Import library….",
              caption:
                "Saving your own preset, close up: name the current graph's look and Save, or ★ Set this " +
                "graph as the default to do both in one step — the line beneath always says what new " +
                "graphs will start from. The tick above the star saves the graph type's own settings too.",
            },
          },
          {
            text:
              "“Include this graph type's own settings” is ticked to start with. Ticked, the preset also " +
              "saves what only this graph type has — a bar chart's bar width and layout, a pie's labels " +
              "and donut, a heatmap's colour map — as that type's section of the preset. Applied to " +
              "another graph of the same type, the section lands too; on any other type it is simply " +
              "ignored and only the shared look applies. Untick it to save the shared look alone.",
          },
          {
            text:
              "A preset grows one graph type at a time. On a graph of another type, press the “+ type” " +
              "button beside one of your presets (it names the open graph's type, “+ Pie” say) to add " +
              "that type's settings to the preset without touching its shared look. Each of your cards " +
              "lists the types it carries settings for. The button is greyed, and says so, when the " +
              "graph has no type-specific setting to add.",
          },
          {
            text:
              "What a section holds is exactly the type's own settings, never a reference to your data: " +
              "a heatmap's row-strip columns, say, are left out, because the preset will be applied to " +
              "graphs drawn from other datasheets.",
          },
          {
            text:
              "Press the ★ on any card to make that preset the default for new graphs; the line under " +
              "the list always says what new graphs currently start from. ★ Set this graph as the " +
              "default does the save and the star in one step.",
          },
          {
            text:
              "Click a filled ★ to go back to None. Deleting the preset that is your default quietly " +
              "resets the default to None.",
          },
        ],
      },

      { kind: "h", text: "Manage your presets" },
      {
        kind: "p",
        text:
          "Everything here is on your own cards in the Inspector's Style tab, behind Manage…, and " +
          "again on the Settings page under My saved presets. Both work on the same list, so a " +
          "change made in one place is there in the other.",
      },
      {
        kind: "steps",
        items: [
          {
            text:
              "Press Manage… above your cards. Each card gains one row: a ⠿ handle, the open graph's " +
              "type — “Bar / column ✓” when the preset already holds that type's settings, “+ Heatmap” " +
              "to add the open graph's — a chip counting the other types it holds, and a ⋯ menu. " +
              "Done puts the simple view back.",
            shot: {
              file: "style-preset-manage.png",
              alt:
                "The My presets part of the Style preset section with Manage… pressed (the button now " +
                "reads Done): the card Our lab style with its palette swatches, and under it one row " +
                "holding a ⠿ handle, a “Heatmap ✓” pill, a chip reading “1 more type”, and a ⋯ button.",
              caption:
                "Managing a preset: the row under the card. Left to right — the handle that orders the " +
                "list, the open graph's type (saved ✓, or + to add it), the chip that says how many " +
                "other types the preset holds, and the ⋯ menu with the rest.",
            },
          },
          {
            text:
              "Click the chip (or Types… in the menu) to list every type the preset carries its own " +
              "settings for. Each row has a ✕: press it to drop that type's settings while the shared " +
              "look and the other types stay. Click the chip again to fold the list.",
            shot: {
              file: "style-preset-types.png",
              alt:
                "The same card with its chip pressed: a small list under the row naming Bar / column " +
                "and Heatmap, each with a ✕ at the right.",
              caption:
                "The types a preset holds, unfolded. A ✕ drops one type's settings — the preset " +
                "keeps its shared look and its other types, and no graph changes until you apply it.",
            },
          },
          {
            text:
              "The ⋯ menu: Rename turns the name into a box (Enter keeps it, Esc leaves it); " +
              "Duplicate makes a copy right beside the original, named “… copy”, to branch from; " +
              "Types… unfolds the list above; Export… writes this one preset to a file; Delete " +
              "removes it (a preset that was your default resets the default to None).",
            shot: {
              file: "style-preset-menu.png",
              alt:
                "The ⋯ menu open under the card: Rename, Duplicate, Types…, Export… and Delete, the " +
                "last in red.",
              caption:
                "The ⋯ menu holds the actions you take now and then. Rename and Duplicate act on the " +
                "card at once; Export… asks where to write the file; Delete is one undoable removal " +
                "of the preset from your list.",
            },
          },
          {
            text:
              "Order the list with the ⠿ handle: drag a card onto another and it lands where that " +
              "card sat, or press ↑ / ↓ on the handle. Your order is kept from then on; a preset you " +
              "save afterwards joins the end. The list holds sixty presets — past that, Save, " +
              "Duplicate and Import refuse and say so; delete one first.",
          },
          {
            text:
              "The Settings page shows the same list with the same chip and ⋯ menu, renames in its " +
              "own box, and adds the per-type defaults and the Back up & transfer buttons. Nothing " +
              "that needs an open graph — Apply, “+ type” — is offered there.",
            shot: {
              file: "settings-presets.png",
              alt:
                "The Settings dialog scrolled to My saved presets: one row per preset with a ⠿ handle, " +
                "a name box, a types chip, a ★ and a ⋯ button; under it the Back up & transfer buttons " +
                "Import a preset file, Export the style library and Import a style library.",
              caption:
                "Your presets on the Settings page: rename in the box, the same chip and ⋯ menu as the " +
                "Inspector, and under them the buttons that move presets between machines and people.",
            },
          },
        ],
      },

      { kind: "h", text: "Push one graph's look onto several others" },
      {
        kind: "steps",
        items: [
          {
            text:
              "Open the graph whose look you want, then Graph ▸ Apply this look to other graphs (also " +
              "the wand button on the toolbar).",
            shot: {
              file: "apply-look-dialog.png",
              alt:
                "The Apply look dialog: a What to copy row with Everything, Colours, Fonts, Axes & frame " +
                "and Size buttons, then a list of the project's other graphs with a checkbox each, and " +
                "Select all, None, Cancel and Apply buttons.",
              caption:
                "Apply this look: pick what to copy, tick the target graphs (graphs on the same data are " +
                "pre-ticked), and every chosen graph takes the open graph's look in one undoable step.",
            },
          },
          {
            text:
              "Pick what to copy — Everything, Colours, Fonts, Axes & frame, or Size — then tick the " +
              "target graphs. Graphs drawn from the same table are pre-ticked.",
          },
          {
            text:
              "Press Apply. It is one undoable step, and it resets as well as sets: where the source " +
              "graph is at its default, the targets' overrides are cleared — that is what makes the " +
              "result actually match.",
          },
        ],
      },

      { kind: "h", text: "What every new graph starts from" },
      {
        kind: "p",
        text:
          "View ▸ Settings — styles & preferences… decides what a new graph starts from. Nothing here " +
          "ever changes an existing graph — restyle those with a preset or Apply this look. It holds:",
      },
      {
        kind: "ul",
        items: [
          "The global default look — None, a built-in preset, or one of yours — and a favourite style per graph type, where a bar chart and a survival curve want different things; a type without its own choice uses the global default.",
          "Common defaults layered on top of the chosen preset: title font and size, axis thickness and colour, gridlines, colour palette. Leave a field blank to defer to the preset.",
          "The default graph type, default error bars, default confidence level, and the significance-star ladder new graphs start with.",
          "Round results tables: off by default, so a results table shows every digit that was computed; set it to 3–6 significant figures and the on-screen tables round to that. It is a display choice only — exports, Copy, the key-result cards and the numbers themselves keep their full precision, and p-values keep their own three-figure convention.",
          "Per-analysis defaults: tick Make default in an Analyze dialog and that method remembers its options; the list here shows what is remembered, with a Clear per method. Only the method's settings are stored — never your column choices or data.",
          "Application preferences that do apply immediately: the light or dark theme, autosave and its interval, and “Fit graphs to the window at startup”, which scales a graph that has no size of its own up to the space available — measured once when the app opens, so nothing reflows while you resize the window. A graph you have sized yourself is never touched, and switching it off puts everything back to the standard size at once.",
          "Hover values in interactive HTML export: on by default. Turn it off to export interactive pages that zoom and pan but show no values on hover; the Export dialog's Show values on hover box changes it for a single export.",
        ],
      },
      {
        kind: "shot",
        file: "settings-defaults.png",
        alt:
          "The Settings dialog: a warning that style defaults apply to new graphs only, a Global " +
          "default preset dropdown, a Favourite style per graph type table with one dropdown per " +
          "chart type, and Common defaults fields for title font and size, axis thickness and " +
          "colour, gridlines and colour palette.",
        caption:
          "Settings: the global default look, a favourite style per graph type, and the common " +
          "defaults layered on top. Everything here shapes new graphs; existing ones never change " +
          "under you.",
      },
      {
        kind: "p",
        text:
          "Everything you save here is yours to keep. Presets, figure house styles and the defaults " +
          "themselves are written to a file in your user folder as well as the app's own storage, so " +
          "clearing site data or updating the app cannot lose them. Back up & transfer, at the foot of " +
          "the Style preset section and again in Settings, does two different jobs. Export… on one of " +
          "your preset cards writes that preset as a small file to hand to a colleague, and Import " +
          "preset… takes such files in: each arrives with a fresh identity, a name you already use " +
          "becomes “Lab (2)”, and anything in the file this MadY does not know is left out and named — " +
          "nothing of yours is ever overwritten. Export library… and Import library… under Back up & transfer move " +
          "the whole library instead: a backup, or the way to another computer — importing merges " +
          "your saved presets in and never deletes anything, and your chosen default stays your own.",
      },
      {
        kind: "note",
        text:
          "Multi-panel figures have their own saved arrangements — house styles — covered under " +
          "Multi-panel figures.",
      },

      { kind: "h", text: "If it goes wrong" },
      {
        kind: "ul",
        items: [
          "A preset wiped markers you had hand-tuned: it clears per-series settings it does not itself specify, so switching presets never leaves residue from the last one. One undo brings them back.",
          "You changed a default in Settings and your graphs did not move: nothing in Settings ever changes an existing graph. Restyle those with a preset, or with Apply this look.",
          "Apply this look did not make them match: it copies only what you picked in the What-to-copy row. Choose Everything.",
          "Your presets vanished after an update: they should not — they are written to your user folder as well as the app's storage. Back up & transfer at the foot of the Style preset section exports them as one portable file.",
          "A preset you were sent arrived as “Lab (2)”: one of yours already had that name. Nothing was overwritten — rename or delete either one in Settings.",
          "Import preset… said it left settings out: the file named settings this MadY does not know — a newer version's, or a data reference — and they were dropped rather than applied. Everything it did know is in.",
          "A preset changed the bar width on one chart and not another: only a graph of the same type as the section takes it. Add that type with “+ type” on the preset's card.",
          "Templates saved by an earlier version of MadY appear as presets: they are converted at start-up, with that type's settings and under the same names. If the preset list is full, the Style tab says how many are still waiting.",
        ],
      },
    ],
  },

  // ───────────────────────────────── Statistics ─────────────────────────────────
  {
    id: "choosing",
    title: "Choosing an analysis",
    group: "Statistics",
    summary: "The Analyze dialog offers four ways in, depending on how much you already know.",
    keywords: ["which test", "what test should i use", "statistics", "analyse", "analyze", "catalogue", "catalog", "search analyses", "recommended", "goal", "configure", "control group"],
    blocks: [
      {
        kind: "goal",
        text:
          "the right test chosen for the data you actually have — by name if you know it, by the " +
          "question you are asking if you do not — with its assumptions read before you run it.",
      },
      {
        kind: "p",
        text:
          "Analyze ▸ Analyze… opens on a landing page that reads your table before it offers you anything. " +
          "Which way in you use depends on whether you know the name of the test.",
      },

      { kind: "h", text: "Four doors, and when to use each" },
      {
        kind: "shot",
        file: "analyze-dialog.png",
        alt:
          "The Analyze dialog's landing page for an XY table: two recommendation cards marked “high” " +
          "(a curve fit and a correlation), a grid of goal tiles ordered for XY data with " +
          "Dose-response and Correlation marked Recommended, and a Browse all analyses button at " +
          "the bottom.",
        caption:
          "The Analyze landing page reads your table first: recommendations at the top, goal tiles " +
          "ordered for your data's format, and the complete catalogue behind Browse all analyses.",
      },
      {
        kind: "table",
        head: ["Door", "Use it when"],
        rows: [
          ["Recommendations", "You want to know what suits this table — its format, its number of groups, and what you have already done to it."],
          ["Goal tiles", "You know the question but not the test's name. The thirteen tiles are grouped by research question — “compare groups”, “correlation”, “fit a curve” — not by statistical name."],
          ["Browse all analyses", "You know the name. The full catalogue, searchable and grouped."],
          ["Analyze ▸ Common analyses", "You know the job: dose-response, enzyme kinetics, receptor binding, interpolating a standard curve, method comparison. Each opens this dialog already scoped."],
        ],
      },
      {
        kind: "p",
        text:
          "The thirteen goal tiles are ordered for the sheet you opened the dialog from, and the format " +
          "is named above them (“ordered for your XY data”). Tiles MadY recommends for this sheet are badged " +
          "Recommended; tiles that are unusual for this format are dimmed but never hidden, because " +
          "“unusual for this shape of data” is not the same as wrong. Picking a tile takes you straight " +
          "to the configure page with the method and the columns already chosen.",
      },
      {
        kind: "p",
        text:
          "Browse all analyses opens the catalogue, and it is the answer when you know the name of the " +
          "test. It carries a search box, a grid of data-type cards that narrows the list to the methods " +
          "suited to one shape of data — your sheet's own type is badged “Your data” — and then every " +
          "method grouped the way this manual groups them: describing one group, comparing groups, " +
          "repeated measures, categorical and survival, XY, multiple variables, ordination, " +
          "meta-analysis. Methods that do not suit the sheet you opened this from are dimmed rather " +
          "than removed, every row has a Details button that explains the test before you commit to " +
          "it, and Back to guidance returns to the landing page.",
      },
      {
        kind: "shot",
        file: "analyze-catalogue.png",
        alt:
          "The Analyze dialog with Browse all analyses open: a Search analyses box, nine data-type " +
          "cards (Column, Grouped, XY badged “Your data”, Contingency, Parts of whole, Survival, " +
          "Multiple variables, Nested, Meta-analysis), and the full method list grouped under " +
          "headings such as Column data — describe one group, each row carrying a Details button, " +
          "with Back to guidance at the top right.",
        caption:
          "The catalogue behind Browse all analyses: search by name, narrow by the shape of your " +
          "data, or read the whole list group by group.",
      },

      { kind: "h", text: "Configure it, then run it" },
      {
        kind: "p",
        text:
          "Whichever door you came through, you finish on the same configure page — and nothing is " +
          "computed until you press Run.",
      },
      {
        kind: "steps",
        items: [
          {
            text:
              "Read the top of the page: the test, its variant, and an “About this test” panel saying " +
              "what it assumes and when not to use it. For a curve fit the exact equation is printed " +
              "there too, so you can see what will be fitted before it is.",
            shot: {
              file: "stats-configure-page.png",
              alt:
                "The top of the Analyze dialog's configure page for a dose-response fit: a back link " +
                "reading All tests, the test's name, the variant picker showing 4PL — variable slope, " +
                "and the equation preview beneath it.",
              caption:
                "Every door ends here. The variant picker and the equation come before the columns, because what the test assumes matters more than which column you point it at.",
            },
          },
          {
            text:
              "Pick the variant. Most methods have several and the dialog explains the difference in " +
              "words: a t test offers one-sample, unpaired Student, unpaired Welch, paired, " +
              "ratio-paired for lognormal data, and the nonparametric alternatives (Mann-Whitney, " +
              "Wilcoxon signed-rank, one-sample Wilcoxon, two-sample Kolmogorov-Smirnov). Each carries " +
              "a note on when to use it and when not to.",
          },
          {
            text:
              "Set the columns or datasets it needs. The pickers change with the method — one column, " +
              "an X and a Y, or every group in the sheet — so a method never silently uses a column " +
              "you did not mean.",
          },
          {
            text:
              "Set the options that belong to that method: the confidence level, the post-hoc test and " +
              "its multiplicity correction, the weighting and constraints of a fit.",
          },
          {
            text:
              "Press Run. Cancel costs you nothing; nothing has been computed yet.",
          },
        ],
      },
      {
        kind: "ul",
        items: [
          "Control group. Where a comparison can be run against one reference instead of every pair, the configure page offers a Control group picker: an ANOVA compares each group to it with Dunnett or Games-Howell, and an unpaired or Welch t test with three or more groups offers “Compare every group to X”, which runs the ANOVA and the vs-control post-hoc in one step rather than asking you to change method.",
          "Make default remembers this method's settings for next time — the tickbox at the foot of the configure page. Saved defaults are listed in Settings ▸ Analysis defaults, each with a Clear button.",
          "Saved Methods let you keep an analysis as a reusable recipe and apply it to another table later. Methods can be exported to a file and imported, so a lab can share a standard procedure.",
          "The suggestion nudge in the toolbar offers next steps for the data you have open. It is a suggestion; nothing runs until you say so.",
        ],
      },

      { kind: "h", text: "If it goes wrong" },
      {
        kind: "ul",
        items: [
          "The test you want is dimmed: it does not suit the sheet you opened this from. It is dimmed rather than removed, so you can still pick it — but check the format first (see Table formats), because the shape of the sheet is usually the real problem.",
          "The goal tiles look wrong for your data: they are ordered for the sheet you opened the dialog from. Open the right datasheet first, then Analyze.",
          "There is no Control group picker: that method compares every pair, or has only two groups. An unpaired or Welch t test with three or more groups offers “Compare every group to X” instead.",
          "You cannot find the test by name: use Browse all analyses and its search box. The goal tiles are grouped by question, so a test's own name may not appear on any of them.",
          "You pressed Run and nothing happened: look for the message on the configure page. A method whose columns are not yet chosen says so rather than running on a guess.",
        ],
      },
    ],
  },

  {
    id: "analysis",
    title: "The statistics on offer",
    group: "Statistics",
    summary: "Every method the Analyze dialog offers, with its assumptions stated.",
    keywords: ["methods", "tests", "which analyses", "list of tests", "catalogue", "statistics"],
    blocks: [
      {
        kind: "goal",
        text:
          "a complete view of what MadY can compute — so you can tell whether the test you need is " +
          "here before you plan an experiment around it.",
      },
      {
        kind: "p",
        text:
          "Analyses live in Results tabs, tied to the table they came from. Change the data and the " +
          "analysis is marked “source changed” until you press Re-run. The result leads with the answer in plain language, then the numbers.",
      },

      { kind: "h", text: "By the question you are asking" },
      {
        kind: "ul",
        items: [
          "Describing one group: descriptive statistics (centre, spread, shape, CI of the mean), normality and lognormality testing, and outlier detection by iterative Grubbs, single Grubbs or ROUT.",
          "Correcting a stack of P values: the P-value corrector takes a column of P values from a family of tests and adjusts them for multiple comparisons — Bonferroni, Holm, Holm-Šídák and Šídák (family-wise error rate) or Benjamini-Hochberg and Benjamini-Yekutieli (false-discovery rate) — marking which stay significant.",
          "Comparing groups: t tests in all their variants, one-way ANOVA with Tukey, Welch's and Brown-Forsythe ANOVA for unequal SDs, Kruskal-Wallis, and a choice of post-hoc test and multiplicity correction.",
          "Designs with more than one factor: two- and three-way ANOVA, multifactor (N-way) ANOVA for two to four crossed factors with every interaction and Type II sums of squares for unbalanced cells, repeated measures with Greenhouse-Geisser — one factor, or groups followed over time (the mixed ANOVA: one factor between subjects, one within), Friedman with Dunn's, mixed-effects models (REML or ML), and nested designs.",
          "Relationships: Pearson and Spearman correlation, linear regression (including forced through the origin or a point), multiple regression, logistic and Poisson regression, Deming and Passing-Bablok regression, Bland-Altman agreement, and ANCOVA.",
          "Categorical and survival: contingency tables (chi-square, Fisher's exact, risk and odds ratios, trend, and McNemar for paired), goodness-of-fit, Kaplan-Meier with log-rank, and Cox proportional hazards.",
          "Multivariate: correlation matrix, principal components (standardised or centred only), and clustering.",
          "Constrained ordination — redundancy analysis (RDA) — answers a different question from all of the above: not what the response data's own main axes are, but how much of the response a set of explanatory variables accounts for. Tick the response columns and the explanatory ones from the same sheet; the axes are then linear combinations of the explanatory variables, and the result reports the share of variance they explain (quote the adjusted R², not the raw one — R² rises with every variable added), a permutation test of the whole model, and a permutation test of each variable entered last. It also returns both ways of placing the cases: LC scores, from the explanatory variables, and WA scores, from what was actually observed.",
          "The two other constrained ordinations answer the same question in a different geometry, and which one is right is decided by the data, not by taste. CCA (canonical correspondence analysis) is the constrained form of correspondence analysis: it works in the chi-square geometry, so it wants counts and unimodal responses, and each case carries its row mass — a case with more counts weighs more. db-RDA (distance-based RDA) constrains any dissimilarity: it maps the distance you chose to coordinates first and then runs RDA on those, which is how a Bray-Curtis or Jaccard community gets tested against explanatory variables at all. On Euclidean distances db-RDA reproduces RDA exactly. Both report the same things RDA does — the share explained with the adjusted R², a permutation test of the model and of each term entered last, and both LC and WA case placements.",
          "Correspondence analysis maps a table of counts: it decomposes the chi-square distances between the rows, and because the rows and the columns come out of the same decomposition it draws both in one picture — a site sits near the species it is relatively rich in. Pick which family the distances belong to with the scaling, and watch for the arch: a strong single gradient makes the second axis a curve of the first rather than a second gradient.",
          "Ordination — mapping cases by how different they are: PCoA (principal coordinates) maps any distance you choose, not only the Euclidean one PCA is fixed to, so Bray-Curtis or Jaccard data can be drawn faithfully; NMDS uses only the rank order of those distances, which is what a species matrix full of zeros usually deserves, and reports Kruskal's stress plus a Shepard plot so you can see whether the map can be read at all. Both offer the Hellinger, chi-square and Wisconsin transformations, and both colour the map by a grouping column.",
          "Variance partitioning answers the question two overlapping sets of explanatory variables always raise: climate and soil each look important, so which of them is actually carrying the signal? Put the columns into two or three named blocks and it runs redundancy analysis on every combination, splitting the variation into what is unique to each block, what they share, and what nothing explains. Every fraction is an adjusted R² — a raw one would simply reward the widest block. The unique fractions are tested by permutation; a shared fraction is a difference between two models rather than the fit of one, so it gets no p-value, and it can come out negative, which is a real result and is reported as one.",
          "PERMANOVA tests the groups you see on an ordination map: do groups of cases really sit in different places, judged on the distance you choose — Euclidean on standardised variables, the geometry of a standardised PCA, or Bray-Curtis, Jaccard and the rest? It is an analysis of variance run on the distances, so no normal distribution is assumed, and its p comes from shuffling the group labels. Pick the group column, the distance and the number of permutations. PERMDISP is reported beside it, because PERMANOVA also reacts to groups that only differ in spread: if both are significant, the difference may be in how scattered the groups are rather than where they sit. Tick Show key stats and the p goes on the map.",
          "Beyond the standard set: Bayes factors, equivalence testing (TOST), permutation tests where you choose what gets rearranged, bootstrap methods, ROC and AUC.",
        ],
      },
      {
        kind: "p",
        text:
          "Post-hoc comparisons can be run every-pair or against a single control group — the “compare to " +
          "control” control on the result switches between them without re-running the analysis from scratch.",
      },
      {
        kind: "p",
        text:
          "Where a test's assumptions can be checked, they are checked and reported. Where a calculation " +
          "cannot validly be done — a group with no variance, a perfectly separated logistic fit — MadY " +
          "refuses and names the remedy rather than returning a confident-looking number.",
      },

      { kind: "h", text: "The complete list of methods" },
      {
        kind: "p",
        text:
          "Here is every method, in the groups the Analyze dialog puts them in, each with the " +
          "sentence it shows you when to use it. It is built from the same list of methods the dialog uses, " +
          "so it cannot fall behind what the dialog offers.",
      },
      { kind: "methods" },
      {
        kind: "note",
        text:
          "Beta version: assess every analysis critically. These results may contain inaccuracies — " +
          "check anything you intend to publish against an established statistics package.",
      },
    ],
  },

  {
    id: "results",
    title: "Reading a result",
    group: "Statistics",
    summary: "What a Results tab gives you, and what you can do with it.",
    keywords: ["result", "output", "p value", "key result", "re-run", "rerun", "stale", "methods text", "copy results", "validated"],
    blocks: [
      {
        kind: "goal",
        text:
          "the number a paper would quote, read off the top of the result — and then out of MadY into " +
          "your manuscript, your spreadsheet or onto the figure.",
      },

      { kind: "h", text: "What a result puts in front of you, and in what order" },
      {
        kind: "p",
        text:
          "A result leads with its key result: one to four cards, each a number a paper would quote " +
          "with its name above it and its small print (a confidence interval at the level you chose, " +
          "the degrees of freedom) beneath — a t test shows p, Cohen's d, the difference with its CI " +
          "and t; a survival analysis the log-rank p and the hazard ratio; a Bayes factor BF10 and " +
          "BF01; a meta-analysis the pooled random-effects estimate with its CI, its p and I². A p " +
          "under 0.05 is drawn in the accent colour, a p over it in grey, and a one-line verdict under " +
          "the cards says what the numbers decide — statistically significant or not, equivalent " +
          "within the bounds, which model the AICc prefers, whether two methods agree. Then the " +
          "results table, with the headline test row shaded and every p under 0.05 emphasised, then " +
          "the plain-language summary sentence, then the detail folded underneath. The order is " +
          "deliberate: the number you report to a reader comes first, not the one the software found " +
          "easiest to compute.",
      },
      {
        kind: "shot",
        file: "analysis-result.png",
        alt:
          "An unpaired t test's Results tab: the analysis name with a ✓ Validated badge, the " +
          "Re-run, Save as Method, Copy, CSV, Excel, Methods text and Add to graph buttons, a " +
          "Significance markers on the graph tickbox, then the Key result cards with a verdict " +
          "line under them and the results table below.",
        caption:
          "A result reads top-down: what it is and how it was validated, what you can do with " +
          "it, then the numbers a paper would quote — and only then the full table.",
      },

      { kind: "h", text: "What you can do with it" },
      {
        kind: "table",
        head: ["Button", "What it does"],
        rows: [
          ["Re-run", "Recomputes against the table as it stands now."],
          ["Save as Method", "Keeps the test and its settings as a reusable recipe you can apply to another table."],
          ["Copy", "Puts the results table on the clipboard with its title and summary — pastes cleanly into a spreadsheet or a document."],
          ["CSV · Excel", "Writes the same table to a file."],
          ["Methods text", "Drafts the Methods paragraph and a Results sentence: the test, the corrections, the sample size, the effect size, the exclusions. A draft to edit, never inserted into your writing for you."],
          ["Add to graph", "A short menu of the plots this result can produce — nothing it cannot draw is offered."],
        ],
      },

      { kind: "h", text: "Put the result on a graph" },
      {
        kind: "steps",
        items: [
          {
            text:
              "Press Add to graph on the result's toolbar. The menu lists only what this particular " +
              "result can actually draw — an ANOVA offers its key stats as a label, the letters (CLD) " +
              "and a residual-diagnostics plot; a curve fit offers the fitted curve; a survival " +
              "analysis its curve.",
            shot: {
              file: "stats-add-to-graph.png",
              alt:
                "The Add to graph menu open on an ANOVA result, listing Key stats as a label, " +
                "Letters (CLD) and Residual diagnostics.",
              caption:
                "The menu is built from what this result can draw. A different analysis offers a different list — a fitted curve, a ROC, an ordination map, a forest or funnel plot.",
            },
          },
          {
            text:
              "For pairwise comparisons, use the “Significance markers on the graph” tickbox instead. " +
              "It is a tickbox, not a one-off: ticked, the brackets on the graph are a readout of this " +
              "analysis, so a re-run refreshes every p-value and drops whatever stopped being " +
              "significant; unticking removes exactly the ones it drew. Anything you added by hand is " +
              "untouched either way. Compare beside it switches between every pair and every group " +
              "against one control.",
          },
        ],
      },
      {
        kind: "ul",
        items: [
          "Assumption checks are listed with the result, including any that could not be checked.",
          "An analysis whose data has changed underneath it wears a source changed badge and a line saying so, rather than being shown as current. One that failed wears an error badge and says what went wrong.",
          "A curve fit that breached one of the flag thresholds you set is banded “Fit flagged as questionable” with the reasons, above the numbers — not hidden in the detail.",
          "The ✓ Validated badge beside the name says how this method's number is produced: “Computed with” names the established library that computes it, and “Computed in MadY, validated against” marks the ones MadY implements itself and checks against the published procedure. Hover for the basis and the references; click to copy a citeable validation statement.",
        ],
      },
      {
        kind: "note",
        text:
          "Beta version: assess every analysis critically. These results may contain inaccuracies — " +
          "check anything you intend to publish against an established statistics package. The same " +
          "caution is printed under every result in the program, for the same reason.",
      },
      {
        kind: "note",
        text:
          "The drafted Methods and Results prose is a machine-written draft, not finished text. Read it " +
          "before you use it.",
      },

      { kind: "h", text: "If it goes wrong" },
      {
        kind: "ul",
        items: [
          "The result wears a “source changed” badge: the datasheet was edited under it, so the numbers on screen are not from the data as it stands. Press Re-run.",
          "Add to graph offers nothing you want: only the plots that result can actually draw are listed. A pairwise comparison's brackets come from the “Significance markers on the graph” tickbox instead.",
          "The result says it could not be computed: read the message. MadY refuses where a calculation cannot validly be done — a group with no variance, a perfectly separated logistic fit — and names the remedy rather than returning a confident-looking number.",
          "A fit is banded “flagged as questionable”: it breached one of your flag thresholds. The reasons are printed with the band, above the numbers.",
          "The Methods paragraph reads awkwardly: it is a machine-written draft. Edit it — it is never inserted into your writing for you.",
        ],
      },
    ],
  },

  {
    id: "curvefit",
    title: "Curve fitting",
    group: "Statistics",
    summary: "Around a hundred and ten built-in equations, with the parameters explained in plain language.",
    keywords: [
      "curve fit", "fit a curve", "nonlinear regression", "equation", "model", "ec50", "ic50",
      "dose response", "michaelis", "km", "vmax", "kd", "bmax", "exponential", "decay",
      "gaussian", "peak", "polynomial", "lowess", "spline", "global fit", "constraint",
      "interpolate", "standard curve", "area under curve", "auc", "compare models", "aicc",
    ],
    blocks: [
      {
        kind: "goal",
        text:
          "a curve through your points from an equation you chose on purpose — with its parameters " +
          "named in plain language, its constraints yours to set, and the number you will quote " +
          "marked on the graph.",
      },
      {
        kind: "p",
        text:
          "Curve fitting is one method with a very large catalogue of equations, grouped by family so you " +
          "can find yours by what you are measuring rather than by its algebra.",
      },

      { kind: "h", text: "Fit a curve" },
      {
        kind: "steps",
        items: [
          {
            text:
              "Open the datasheet, then Analyze ▸ Common analyses ▸ Dose-response… (or Analyze ▸ " +
              "Analyze… and the Curve fitting tile, for any other family).",
          },
          {
            text:
              "Pick the family, then the model within it. The exact equation appears under the picker, " +
              "so you can see what will be fitted before it is — and every parameter has a " +
              "plain-language description.",
            shot: {
              file: "curvefit-configure.png",
              alt:
                "The dose-response fit's configure page: family and model dropdowns set to " +
                "Dose-response and 4PL variable slope, the equation Y = Bottom + (Top − Bottom) / (1 + " +
                "(EC50/X)^HillSlope), X and Y column pickers, optional per-parameter constraints with " +
                "Fix and min and max fields, a Weighting dropdown on No weighting, an Identify and " +
                "remove outliers (ROUT) tickbox, a confidence dropdown, and Make default, Cancel and " +
                "Run buttons.",
              caption:
                "Configuring a dose-response fit: the model, the exact equation it will fit, the data " +
                "mapping, and optional constraints per parameter — fix it, bound it, or leave it free. " +
                "Make default remembers these options for next time.",
            },
          },
          {
            text:
              "Constrain anything you already know. Constraints are optional and marked as such — fix a " +
              "parameter to a known value, bound it, share it across datasets, or leave it free.",
          },
          {
            text:
              "Press Run. The curve, its confidence and prediction bands, and — for a dose-response " +
              "fit — the EC50 / IC50 marker are drawn on the graph, not left in a table.",
          },
        ],
      },

      { kind: "h", text: "The families of equations" },
      {
        kind: "ul",
        items: [
          "Dose–response — three-, four- and five-parameter logistics, in log-dose and concentration forms, normalised and not, for stimulation and for inhibition (EC50 and IC50, relative and absolute), plus biphasic, bell-shaped, probit, Weibull, Richards and Brain-Cousens hormesis.",
          "Enzyme kinetics — Michaelis-Menten, with kcat where you supply the enzyme concentration, allosteric sigmoidal, substrate inhibition, the integrated progress curve, and Morrison tight-binding Ki.",
          "Binding — one- and two-site specific binding, with and without nonspecific, Hill slope, homologous and heterologous competition, ligand depletion, total binding, and association-then-dissociation.",
          "Exponential and growth — one-, two- and three-phase decay and association, decay with linear drift, stretched exponential, Gompertz, logistic, Richards, Weibull, von Bertalanffy, Chapman-Richards and Morgan-Mercer-Flodin.",
          "Peaks — Gaussian with and without baseline, sums of two and three Gaussians, Lorentzian, pseudo-Voigt and Voigt, exponentially-modified Gaussian, Pearson VII and log-normal.",
          "Polynomials to the sixth order, each also in a centred form that fits about the mean X to reduce collinearity; plus periodic, power-law, logarithmic, reciprocal, rational, square-root and segmental (hockey-stick) forms.",
          "Model-free: linear, LOWESS, and a cubic smoothing spline, for when you want the trend without claiming a mechanism.",
          "Your own equation: type any Y = f(X, parameters…) and fit it.",
        ],
      },

      { kind: "h", text: "What else a fit can do" },
      {
        kind: "ul",
        items: [
          "Global fitting shares parameters across datasets while letting a constant differ per curve. Some models exist only here, because a single curve cannot separate their parameters: the enzyme inhibition mechanisms (competitive, noncompetitive, uncompetitive, mixed), association kinetics at several ligand concentrations, Motulsky-Mahan competitive binding kinetics, Gaddum/Schild, the operational model, and total-and-nonspecific binding.",
          "Compare models asks whether an extra parameter earned its place, by AICc.",
          "Melting temperature (Tm) reads thermal melt curves — protein unfolding and DNA/RNA melting — with temperature in X and one column per sample. Each replicate gets its own Tm, from a two-state sigmoid fit (with optional sloped baselines) and from the steepest point of the smoothed curve; each sample reports mean ± SD, and ΔTm against a control you pick comes with a confidence interval. Set a temperature window to leave out a signal drop after the melt. Its own door: Analyze ▸ Common analyses ▸ Melting temperature….",
          "Interpolate a standard curve reads unknowns off a fitted curve — the ELISA case.",
          "Area under the curve, with the baseline at zero, at the minimum, at the mean, or at a value you choose.",
          "Curve transforms produce a derived view: Savitzky-Golay smoothing, first and second derivatives, and the cumulative integral. The three Michaelis-Menten linearisations (Lineweaver-Burk, Eadie-Hofstee, Hanes-Woolf) are offered here too, labelled as diagnostic views — the numbers to report come from the nonlinear fit.",
        ],
      },
      {
        kind: "note",
        text:
          "Dose–response fits mark EC50 or IC50 on the graph rather than leaving it in a table, and the " +
          "fitted parameters can be typeset inside the axes the way journals print them.",
      },
      {
        kind: "note",
        text:
          "Beta version: assess every fit critically. A fitted parameter may contain inaccuracies even " +
          "where the curve looks right — a good R² does not prove the equation was the right one. " +
          "Check anything you intend to publish against an established statistics package.",
      },

      { kind: "h", text: "If it goes wrong" },
      {
        kind: "ul",
        items: [
          "The fit did not converge: the starting values could not reach a solution. Constrain a parameter you know (a Top of 100 for a normalised response), or pick a simpler model — a 3PL before a 5PL.",
          "The curve looks right but a parameter is absurd: an unconstrained fit can put a Bottom below anything you measured. Fix or bound the parameters your experiment already decides.",
          "The result is banded “Fit flagged as questionable”: it breached one of your flag thresholds, and the reasons are printed with the band.",
          "A model you want is not in the list: some exist only as global fits, because one curve cannot separate their parameters — the enzyme inhibition mechanisms, Gaddum/Schild, the operational model and the rest.",
          "You want the linearised numbers (Lineweaver-Burk and similar plots): they are under curve transforms and labelled as diagnostic views. The numbers to report come from the nonlinear fit.",
          "A good R² is not proof: it says the curve passes near the points, not that the equation was the right one. Compare models (AICc) asks the sharper question.",
        ],
      },
    ],
  },

  {
    id: "planning",
    title: "Power, simulation and Monte-Carlo",
    group: "Statistics",
    summary: "Work out how many you need — before, or instead of, collecting them.",
    keywords: [
      "power", "sample size", "how many", "n per group", "effect size", "simulate", "simulation",
      "synthetic data", "seeded", "monte carlo", "resampling", "bootstrap", "plan an experiment",
    ],
    blocks: [
      {
        kind: "goal",
        text:
          "the number of subjects your experiment actually needs — worked out before you run it, with " +
          "no data loaded at all.",
      },

      { kind: "h", text: "Work out the sample size" },
      {
        kind: "steps",
        items: [
          {
            text:
              "Analyze ▸ Sample size & power…. It works with nothing open — this is a calculation about " +
              "an experiment you have not run yet.",
            shot: {
              file: "stats-power-dialog.png",
              alt:
                "The Sample size and power dialog with an answer in it: Design set to Unpaired t (two groups), Solve for Required sample size, an effect size of 0.5, alpha 0.05 and power 0.8, a readout reading 64 n per group / 128 total, and a tradeoff table listing the n needed at powers from 0.70 to 0.99.",
              caption:
                "Solve for either end: give it an effect size and it returns n per group; give it n and it returns the power you actually have. The table under the answer prices the other target powers for the same effect.",
            },
          },
          {
            text:
              "Choose the Design, then what to Solve for. Give it an effect size and it gives you n per " +
              "group; give it n and it gives you the power you actually have.",
          },
        ],
      },

      { kind: "h", text: "Make data up, on purpose" },
      {
        kind: "ul",
        items: [
          "Analyze ▸ Simulate data… generates a synthetic dataset from a distribution you specify. It is seeded, so the same settings give the same numbers — which is what makes a simulated example reproducible for someone else.",
          "Analyze ▸ Monte-Carlo simulation… repeats an analysis over many resampled datasets, for the questions that are easier to answer by resampling than by algebra.",
        ],
      },
      {
        kind: "note",
        text:
          "Simulated data is an ordinary table. It is worth naming it as simulated, because nothing " +
          "downstream — a graph, an analysis, an exported figure — will remind you that it was.",
      },

      { kind: "h", text: "If it goes wrong" },
      {
        kind: "ul",
        items: [
          "The answer looks impossible (n in the thousands): the effect size you entered is small. That is the calculation working — it is telling you what the experiment would really cost.",
          "You do not know the effect size: that is the hard part, and no calculator supplies it. Use a pilot study, a published estimate, or the smallest difference that would matter to you.",
          "A simulated dataset gave a different answer the second time: the seed changed. Set it explicitly and the same settings give the same numbers.",
          "You cannot tell later which sheet was simulated: nothing downstream will remind you. Name it as simulated when you make it.",
        ],
      },
    ],
  },

  {
    id: "significance",
    title: "Significance markers",
    group: "Statistics",
    summary: "Brackets and stars, placed from the analysis you already ran.",
    keywords: [
      "significance", "bracket", "star", "asterisk", "p value", "stars on the chart", "ns",
      "threshold", "cut-off", "alpha", "letters", "cld", "compact letter display",
      "significance bar", "comparison bar",
    ],
    blocks: [
      {
        kind: "goal",
        text:
          "the stars on your chart carrying real p-values from a comparison you ran — placed, stacked " +
          "and labelled for you, and staying right when the analysis is re-run.",
      },
      {
        kind: "p",
        text:
          "Drawing significance bars by hand is one of the most tedious parts of preparing a " +
          "figure. MadY places them from a comparison you have already run: the brackets know " +
          "which two groups they join and which p-value they came from.",
      },

      { kind: "h", text: "Put the brackets on" },
      {
        kind: "steps",
        items: [
          "Run a comparison with a post-hoc test (Analyze ▸ a t test, ANOVA and so on).",
          "Open the graph you want them on — a bar chart, box, violin, column scatter, lollipop and more all work, in either orientation.",
          {
            text:
              "Design ▸ Significance brackets from an analysis…. Only the comparisons that clear your " +
              "threshold are drawn, stacked so nested ones read cleanly, and the value axis makes room " +
              "for them by itself.",
            shot: {
              file: "significance-brackets.png",
              alt:
                "A bar chart of four treatment groups with two significance brackets: two stars over " +
                "the Control to Drug A comparison, and three stars on a wider bracket spanning Control " +
                "to Drug C, stacked above the first.",
              caption:
                "Two brackets carrying real p-values, labelled through the ladder (p=0.006 → ★★, " +
                "p=0.0003 → ★★★) and stacked so the nested one reads cleanly — the value axis makes " +
                "room for them by itself.",
            },
          },
          "Too many pairs for brackets? Design ▸ Significance letters (CLD) from an analysis… instead: groups sharing a letter are not significantly different.",
        ],
      },
      {
        kind: "note",
        text:
          "Design ▸ Add a blank significance bracket puts one on by hand, for a comparison you are " +
          "quoting from elsewhere. It carries no p-value of its own, because none was computed.",
      },

      { kind: "h", text: "Decide what counts as significant" },
      {
        kind: "p",
        text:
          "You decide, not the program. Design ▸ Significance thresholds & labels… " +
          "gives you a ladder of cut-offs and the symbol each one prints: the built-in ladder is " +
          "the usual */**/***/****, but you can change the numbers, use your own symbols, add or " +
          "remove levels, rename “ns”, or hide non-significant markers entirely. Set it per graph, " +
          "or set the default for new graphs in Settings.",
      },
      {
        kind: "shot",
        file: "significance-thresholds.png",
        alt:
          "The significance thresholds ladder: six symbol-family chips (asterisks, solid stars, " +
          "hashes, daggers, letters, cut-offs), four rows pairing a p cut-off with its symbol and " +
          "a remove button, the ns label with a hide checkbox, Add threshold and Reset buttons, " +
          "and a live preview line mapping example p-values to their marks.",
        caption:
          "The thresholds ladder: a cut-off per row and the symbol it prints, one-click symbol " +
          "vocabularies, the ns label with its hide switch, and a live preview through the exact " +
          "formatting the figure uses — so the preview always matches the figure.",
      },
      {
        kind: "table",
        head: ["Setting", "What you get"],
        rows: [
          ["Symbol family", "Six ready-made vocabularies: asterisks, solid stars, hashes, daggers, letters, or the cut-offs spelled out (p<0.05), which tracks the numbers if you edit them."],
          ["Bracket shape", "Four: square bracket, rounded, curly brace, or a plain line."],
          ["Legs (bar charts)", "Equal length keeps the flat bracket over both bars; Reach the bars runs each leg down to just above its own bar — its top, error bar or points — so a bracket between a tall and a short bar has a long leg on the short side instead of hovering high over it."],
          ["Only this bracket", "By default the bracket panel's Thickness, Shape, Legs, Symbol size and Colour change every bracket on the graph, so a figure stays uniform. Tick this and they restyle just the one you clicked, which then keeps its own look until you clear it (“Follow the graph”)."],
        ],
      },
      {
        kind: "ul",
        items: [
          "Every marker is draggable and editable — move its height, retype its label, restyle it. Annotate ▸ Significance holds the same graph-wide settings as the bracket panel.",
          "Retyping a label does not throw the p-value away: clear the text and the live p comes back.",
          "The threshold key at the bottom of the figure is built from the ladder you are actually using, and lists only the levels your data reached.",
        ],
      },
      {
        kind: "note",
        text:
          "Markers are placed from a real comparison, never invented. If a chart cannot carry one — " +
          "a pie or a network has no axes to anchor to — the app says so rather than quietly " +
          "drawing nothing.",
      },

      { kind: "h", text: "If it goes wrong" },
      {
        kind: "ul",
        items: [
          "“Significance brackets from an analysis…” is greyed out: there is no pairwise comparison to draw from, or the chart cannot carry brackets. Run a test with a post-hoc first, and open a chart with a category axis.",
          "Fewer brackets appeared than you expected: only the comparisons that clear your threshold are drawn. Change the ladder, or unhide the non-significant markers.",
          "You restyled one bracket and they all changed: that is the default, so a figure's brackets stay uniform. Tick “Only this bracket” first.",
          "A re-run wiped a label you typed: it should not — retyping a label keeps the p-value underneath, and clearing the text brings the live p back. What a re-run does drop is a comparison that stopped being significant.",
          "The brackets are stale after editing the data: they are a readout of the analysis. Re-run it and they refresh; untick “Significance markers on the graph” to remove exactly the ones it drew.",
        ],
      },
    ],
  },

  // ─────────────────────────────── Finishing a figure ───────────────────────────
  {
    id: "figures",
    title: "Multi-panel figures",
    group: "Finishing a figure",
    summary: "Assemble finished graphs and images into a lettered, journal-ready figure.",
    keywords: ["figure", "panel", "panels", "montage", "composite", "layout", "arrange", "assemble", "letters", "abc", "multi-panel"],
    blocks: [
      {
        kind: "goal",
        text:
          "one lettered figure — panels aligned by their axes, not just their edges, the repeated tick " +
          "numbers stripped from the inner ones, and every graph in it still editable.",
      },
      {
        kind: "p",
        text:
          "Start one from Insert ▸ New layout, or from the + buttons in the tree — a figure can belong to " +
          "an experiment, to a project, or stand alone. It opens as its own full page rather than a tab, " +
          "because assembling a figure is a different activity from editing one graph; ← Back returns you " +
          "to the workspace. The assembler has two pages: Choose graphs, then Arrange.",
      },

      { kind: "h", text: "Choose the panels" },
      {
        kind: "steps",
        items: [
          {
            text:
              "Tick the graphs you want. Every graph in the project is listed as a live thumbnail, " +
              "grouped by project and experiment with the figure's own group first — a figure filed in " +
              "one experiment can still take a panel from any other.",
            shot: {
              file: "figure-choose-graphs.png",
              alt:
                "The Choose graphs page: live thumbnail cards of the project's graphs grouped under " +
                "Experiment 1 to 4, four of them ticked, with a count reading 4 of 8 graphs selected, an " +
                "Auto-scale on include checkbox, an Add image button and a Build / Arrange button.",
              caption:
                "Choose graphs lists every graph in the project as a live thumbnail, grouped by " +
                "experiment — tick panels from any of them, from anywhere in the project.",
            },
          },
          {
            text:
              "Leave Auto-scale on include ticked. It matches each newly ticked panel to the first " +
              "panel's size, fonts, axes and colours as it comes in, so the figure starts consistent " +
              "instead of being made consistent later.",
          },
          {
            text:
              "Add image… puts a micrograph, a blot or a schematic in as a panel. It is embedded in the " +
              "project file, so it travels with it, and it drags, resizes, letters and exports like any " +
              "other panel. Select it to choose how the picture fits its frame (contain, cover or " +
              "stretch) and to write its alt text.",
          },
          {
            text:
              "Press Build / Arrange →. The graph list is never final: ← Choose graphs reopens the full " +
              "picker, and + Add graph… adds one straight from the Arrange page.",
          },
        ],
      },

      { kind: "h", text: "Arrange them" },
      {
        kind: "p",
        text:
          "Free drag is on by default: drag any panel and guides snap its edges and centres to " +
          "its neighbours — and its axes too, shown as a dashed guide, so plots line up by their data " +
          "rectangles, not just their cards. For a tiled figure, turn Free drag off and set Columns (Auto " +
          "detects them from the positions, or pick 1–6) and the Gutter between panels; hover a panel and " +
          "click its 1× chip to make it span more than one column, or its 1⇕ chip to make it span " +
          "more than one row — the other panels tile around it, which is how the tall-left and " +
          "wide-top figures are made. Layout ▾ opens a picker of figure shapes drawn as thumbnails " +
          "(a grid, a wide panel on top, a tall panel at the left, one row, one column) for the " +
          "number of graphs you have — choose one the way you choose a table format and the " +
          "graphs fill it; the thumbnail and the grid are laid out by the same rule, so a picked shape is " +
          "always the shape you get.",
      },
      {
        kind: "shot",
        file: "figure-arrange-ribbon.png",
        alt:
          "The figure toolbar in two rows. The first: Layout ▾, Columns, Gutter, Page, then Grid, " +
          "Snap to grid, Ruler with its unit, and the canvas zoom. The second: Align all, Align ▾, " +
          "Free drag, Line up ▾ (greyed until panels are picked), Front, Back, a padlock, Group, " +
          "duplicate, then Insert ▾ and Style ▾.",
        caption:
          "The figure toolbar: the first row always shows the layout and the editing aids; the second holds " +
          "what you do on the canvas, with the rarer tools behind Align ▾, Line up ▾, Insert ▾ and Style ▾. " +
          "The figure's own settings — letters, panel content, Shared axes, One legend — are in the " +
          "Inspector when nothing is picked.",
      },
      {
        kind: "shot",
        file: "figure-layout-picker.png",
        alt:
          "The Layout picker open in the assembler: a row of thumbnails, each drawing one figure shape — a two-by-two grid, a wide panel over two, a tall panel beside two — for the four panels in the figure.",
        caption:
          "Layout ▾ offers a shape the way the New-graph dialog offers a table format: pick a thumbnail and the graphs fill its slots in A/B/C order, in one undoable step.",
      },
      {
        kind: "table",
        head: ["You want", "Use"],
        rows: [
          ["X-axes to line up down a column", "Align ▾ ▸ Align X — every panel in the column gets one shared horizontal extent."],
          ["Y-axes to line up across a row", "Align ▾ ▸ Align Y."],
          ["Panels the same size rather than the same axes", "Align ▾ ▸ Equal rows and Equal cols stretch to the row's tallest and the column's widest, and supersede the axis alignment on that dimension."],
          ["No hole beside a lone panel in the last row", "Align ▾ ▸ Stretch last."],
          ["A pie, treemap or network centred in its column instead of widened to it", "Align ▾ ▸ Centre no-axis — the spare width is shared evenly either side; graphs with axes are unaffected."],
          ["All of it at once", "Align all — click it again to release."],
          ["The inner panels to stop repeating their tick numbers", "Shared axes, in the Inspector's Figure view (click empty canvas). Turn Free drag off first; it works on the tiled arrangement."],
          ["One key instead of four identical ones", "One legend, beside Shared axes. It is only offered when the legends actually match; when they differ the tooltip says why it is off."],
        ],
      },
      {
        kind: "ul",
        items: [
          "Shared axes labels only the figure's outer edges: inner panels drop their repeated tick numbers and axis titles, and the freed space goes back to the drawing. A label is only stripped where the panel genuinely shares that axis — same title, scale and ticks — so a panel in different units keeps its own.",
          "Shift-click two or more panels to arrange just them, then open Line up ▾: align their edges or centres, distribute the spacing evenly, or make them the same width or height. Arrow keys nudge the selection 1 px, Shift+arrow 10 px.",
          "Moving or resizing any panel by hand while an automatic arrangement is on freezes every panel where it stands and switches to free drag, as a single undo step — so adjusting one panel never makes the others jump.",
          "The toolbar's first row always shows the layout — Layout ▾, Columns, Gutter, Page — and the editing aids: an alignment grid behind the panels (Snap to grid lands a dragged panel on it), and a ruler along the edges in pixels, inches or centimetres. Neither ever appears in the export. The magnifier beside them zooms the canvas you are working on; it is a view control, so it changes neither the figure nor what is exported, and the percentage button snaps it back to 100%.",
          "Front and Back restack overlapping panels — they apply in free drag, because panels tiled into a grid never overlap. Line up ▾ ▸ On the figure (Ctr ↔, Ctr ↕) centres the selected panels on the figure. ⧉ duplicates them. The padlock locks a panel where it stands: no drag, resize, nudge or remove, while the graph inside it stays fully editable.",
          "Group makes the selected panels move as one — drags and arrow keys carry all of them — until you Ungroup. It is movement only: grouping never resizes anything, and the alignment buttons still re-derive the grid from where the panels are.",
        ],
      },

      { kind: "h", text: "Letter it" },
      {
        kind: "shot",
        file: "figure-arranged.png",
        alt:
          "The assembler with four panels tiled in two columns — a dose-response curve lettered A, " +
          "a heatmap lettered B, a bar chart C and a violin plot D — with the pixel ruler along the " +
          "top and left, the alignment grid behind the panels, and the Linked to sources chip in " +
          "the header.",
        caption:
          "Four panels tiled into two columns with automatic A–D lettering, the ruler and grid on, " +
          "and the figure still Linked to sources — styling a panel here restyles the graph it " +
          "came from.",
      },
      {
        kind: "ul",
        items: [
          "With nothing picked on the figure, the Inspector shows the figure's own settings: Panel letters and Panel content (with the Inspector collapsed they are the toolbar's Labels and Panels groups; click empty canvas to get back to them). Panel letters sets the lettering: A B C, a b c, 1 2 3 or None, with its own font, size, bold and colour. Renumber re-letters in reading order — left to right, top to bottom — after you have moved things around; Align ↕ and Align ↔ line the labels up along each row and column.",
          "Every label is draggable, snapping to the other labels. Double-click one to retype it — “(a)”, “S1”, anything; leave it empty to hide just that label.",
          "A panel is the real graph: click it and the whole Inspector targets that graph, every tab and control. Drag its corner to resize: with Keep proportions on (the default for a new figure) the whole graph scales evenly to the new size; with it off, the graph re-lays itself out at that size. The × removes a panel from the figure without touching the source graph.",
          "Panel content carries the switches for what each panel shows, with Shared axes and One legend. Graph titles shows each panel's own title inside the plot — off by default, because a figure reads by its letters. Card titles puts the graph's name in a working header above each panel; it is an editing aid, never exported, and double-clicking the name opens that graph in its own tab.",
          "Keep proportions draws each panel as a true miniature of the whole graph: fonts, markers, line widths and margins shrink together, so a small panel keeps the proportions the graph was designed with. With it off, the graph re-lays itself out at card size — the cards match exactly, but the type and the marks read too large.",
          "Insert ▾ adds another graph or a picture as a panel, or puts an object on the figure rather than in a panel: a text box, arrow, line, box or ellipse, for a heading that spans two panels or an arrow from A to B. Select one and the Inspector shows its settings — colour, fill, line width, font size — and its position; with the Inspector collapsed, the same settings appear in the toolbar as the Object group. These belong to the figure, so they never appear on the graphs it is built from.",
          "Style ▾ holds the three ways to make the panels look alike. Its Style preset restyles every graph in the figure at once with one of the built-in looks — fonts, axes, grid, palette and each chart type's own defaults — in a single undoable step.",
          "Its Match every panel to copies one panel's look onto all the others — Everything, or just Size, Fonts, Axes or Colours — and you choose which panel is the model, not necessarily A.",
        ],
      },

      { kind: "h", text: "⚠️ Linked to sources, or an independent copy" },
      {
        kind: "p",
        text:
          "The chip in the header is the most consequential switch here. Linked (the default): styling a " +
          "panel also restyles the graph it came from, and a later change to that graph shows up in the " +
          "figure. Independent copy: every panel becomes a private copy, and figure-only tweaks leave the " +
          "originals alone. ⚠️ Switching back to linked discards the copies' own edits — the chip asks " +
          "first, and undo brings everything back if you change your mind.",
      },
      {
        kind: "ul",
        items: [
          "Style ▾ ▸ House style saves the figure's arrangement — columns, gutter, lettering and its font, alignment, shared axes, the merged legend — as a named template, and stamps the next figure with it in one click, so a paper's figures match without being rebuilt. Which graphs are in the figure, and where each one sits, are deliberately not part of it. Up to eight, kept on this machine alongside your presets, not inside the project file.",
          "Caption drafts a caption and an alt-text description of the whole figure, panel by panel, folding in a linked analysis's headline result where there is one. It is a draft in a text box — edit it, copy it; nothing is ever inserted anywhere by itself.",
          "Export, in the header or via File ▸ Export…, exports exactly the figure you see — free-drag positions, column spans, dragged labels, the merged legend — through the standard export dialog with its formats, resolutions and journal widths. The grid, ruler and card headers are never part of it.",
        ],
      },

      { kind: "h", text: "If it goes wrong" },
      {
        kind: "ul",
        items: [
          "One legend is greyed out: the panels' legends do not match, so there is no single legend to merge them into. The tooltip says why.",
          "Shared axes did nothing: Free drag is still on. It works on the tiled arrangement — turn Free drag off first. A panel in different units keeps its own labels by design.",
          "You moved one panel and the automatic arrangement switched off: that is deliberate. Moving a panel by hand freezes every panel where it stands and switches to free drag, in one undo step, so adjusting one never makes the others jump.",
          "Restyling a panel changed the original graph: the figure is linked to its sources — the default. Switch the header chip to Independent copy for figure-only tweaks.",
          "Switching back to Linked lost your figure-only edits: it discards the copies' own edits, and the chip asks before it does. Ctrl+Z brings them back.",
          "The letters are out of order after rearranging: press Renumber. It re-letters in reading order, left to right and top to bottom.",
          "The grid or ruler appeared in your export: it cannot — neither is ever part of it, nor are the card titles.",
          "A panel will not move: it is locked (the padlock) or in a group. The graph inside a locked panel stays fully editable.",
        ],
      },
    ],
  },

  {
    id: "export",
    title: "Export and sharing",
    group: "Finishing a figure",
    summary: "Vector and raster output, sized for the journal you are submitting to.",
    keywords: ["export", "png", "svg", "pdf", "tiff", "jpeg", "eps", "dpi", "resolution", "transparent background", "journal width", "print", "clipboard", "save as image"],
    blocks: [
      {
        kind: "goal",
        text:
          "a file at the size and resolution your journal asked for — with the final pixel count and " +
          "the printed width stated before you press the button.",
      },

      { kind: "h", text: "Export a graph or a figure" },
      {
        kind: "steps",
        items: [
          {
            text:
              "Open what you want to export, then File ▸ Export… (Ctrl+E), or Export in the graph " +
              "toolbar or the figure's header. Export acts on whatever is in front.",
            shot: {
              file: "export-dialog.png",
              alt:
                "The Export graph dialog: a format dropdown on PNG image (raster), a 300 DPI resolution " +
                "dropdown, print width set to size in pixels with width and height fields, a line stating " +
                "the final pixel size and printed millimetres, a margin field, background swatches " +
                "including transparent, and Copy image, Copy SVG, Cancel and Export PNG buttons.",
              caption:
                "The Export dialog: pick a format, then size by resolution, journal print width or plain " +
                "pixels — the line under the fields always states the final pixel size and how large it " +
                "will print.",
            },
          },
          {
            text:
              "Pick the format: PNG, SVG, PDF, TIFF, JPEG, EPS, HTML or PowerPoint.",
          },
          {
            text:
              "Size it. For a raster format, choose a resolution preset or type your own DPI; or set a " +
              "print width in millimetres, with the common journal column widths offered, and the pixel " +
              "count follows; or give plain pixel dimensions with the aspect ratio locked or unlocked. " +
              "The line under the fields always states the final pixel size and the physical size it " +
              "will print at.",
          },
          {
            text:
              "Set the margin around the figure and the background — white, transparent, a preset " +
              "colour, or one you pick — then press Export.",
          },
        ],
      },
      {
        kind: "table",
        head: ["Format", "What it is for"],
        rows: [
          ["SVG · PDF · EPS", "Vector. Scales without loss — what most journals want for line art."],
          ["PNG", "Raster, with transparency. The general-purpose choice for a submission or a slide."],
          ["TIFF", "Raster for print. Can be written as CMYK — a direct conversion with no ICC profile, so treat it as a submission convenience rather than a colour-managed proof."],
          ["JPEG", "Raster with a quality slider. Lossy; not for line art."],
          ["HTML", "A plain page, or — with Interactive ticked — one that shows each mark's values on hover, zooms and pans, with a clickable legend that shows and hides series. Self-contained: one file, nothing fetched."],
          ["PowerPoint", "One slide holding the graph or figure as a picture. PowerPoint 2016 or later shows the vector drawing (right-click ▸ Convert to Shape makes it editable); older readers show a PNG at the size you set."],
        ],
      },
      {
        kind: "ul",
        items: [
          "Copy the graph or figure straight to the clipboard — Graph ▸ Copy as picture (Ctrl+Shift+C) or Copy as SVG, the right-click menu on a graph, or the buttons in the Export dialog — for pasting into a manuscript or a slide. The picture is the one the Export dialog would start with.",
          "Tables export to CSV, Excel and JSON; a results table exports to CSV or Excel.",
          "File ▸ Export analysis script (Python) writes a script that reproduces the numbers outside MadY, and File ▸ Export reproducibility bundle writes provenance, script and manifest together.",
          "Export honours what you see, including dragged labels and freely positioned panels, and it will not crop your figure.",
          "Exporting to a light page from a dark theme re-colours for the page rather than baking pale ink onto white.",
          "File ▸ Print… (Ctrl+P) sends whatever is in front — a graph, a figure or a datasheet — to the system print dialog, for a quick paper copy without exporting first.",
        ],
      },
      { kind: "h", text: "Share a graph readers can explore" },
      {
        kind: "steps",
        items: [
          { text: "Open the graph, then File ▸ Export… (Ctrl+E)." },
          { text: "Set Format to HTML page. Keep Interactive ticked — it is on by default." },
          {
            text:
              "Press Export and send the file. Whoever opens it in a browser can hover a mark for its values — a " +
              "point, a bar, a slice, a cell, a curve — scroll to zoom, drag to pan, and click a legend entry to " +
              "hide or show that series. Untick Show values on hover to leave the values out (its default is in Settings). Where marks overlap, the one on top answers. A heatmap drawn as a " +
              "density cloud or hexagons shows no values on hover. It is one file with nothing fetched: no " +
              "internet and no install needed.",
          },
        ],
      },
      {
        kind: "note",
        text:
          "Column widths vary between journals — check your target's guide for authors before choosing a " +
          "print width. MadY offers the common ones; it does not know which one you need.",
      },

      { kind: "h", text: "If it goes wrong" },
      {
        kind: "ul",
        items: [
          "It exported the wrong thing: Export acts on whatever is in front. Open the graph, figure or datasheet first.",
          "The image is blurry in the manuscript: it was exported at screen resolution. Set a DPI, or a print width in millimetres, and read the pixel count the dialog states.",
          "The background came out white when you wanted none: transparency is offered on PNG, SVG, PDF and HTML — not on JPEG, TIFF, EPS or PowerPoint.",
          "The exported size is not what the screen showed: screen zoom has nothing to do with it. The dialog's own size and resolution decide.",
          "Colours look wrong in a printed proof: TIFF's CMYK is a direct conversion with no ICC profile. It is a submission convenience, not a colour-managed proof.",
          "The interactive HTML will not load its data: it cannot fail that way — it is one self-contained file and fetches nothing.",
        ],
      },
    ],
  },

  {
    id: "saving",
    title: "Saving and opening projects",
    group: "Finishing a figure",
    summary: "One file holds the lot — and you can save just a part of it.",
    keywords: [
      "save", "save as", "open", "file", "mady", "project file", "autosave", "recover",
      "crash", "unsaved", "backup", "recent files", "where is my work",
    ],
    blocks: [
      {
        kind: "goal",
        text:
          "your work in a file you can move, send or archive — and a crash net under it that is not " +
          "the same thing as having saved.",
      },
      {
        kind: "p",
        text:
          "A project is one file: a .mady document holding every datasheet, graph, analysis, " +
          "figure and note, with the data inside it. There is no library and no database — move " +
          "the file and the work moves with it, and nothing about it needs a network.",
      },

      { kind: "h", text: "Save, open, start again" },
      {
        kind: "table",
        head: ["To do this", "Do this"],
        rows: [
          ["Save your work", "File ▸ Save… (Ctrl+S). It asks what to keep before it asks where — see Projects, experiments and tabs."],
          ["Save one part on its own", "Untick down to one project folder, one experiment, or a single graph. It is written as an ordinary project file carrying the data it needs, and your own document is untouched."],
          ["Open a project or a data file", "File ▸ Open… (Ctrl+O), or drop the file on the window. The foot of the File menu lists the last eight things you opened."],
          ["Start empty", "File ▸ New project (Ctrl+N). Nothing is carried over."],
          ["Tell whether you have unsaved changes", "A dot on the Save button in the toolbar."],
        ],
      },

      { kind: "h", text: "Autosave is a crash net, not a save" },
      {
        kind: "p",
        text:
          "It is on by default and writes a recovery snapshot " +
          "a moment after you stop editing (the interval is in Settings, and it can be switched " +
          "off). It never touches your file. If MadY closes unexpectedly, the next launch offers " +
          "“Recover unsaved work?”, naming the project and how old the copy is: Recover brings it " +
          "back — you still choose where to save it — and Discard throws it away. If the snapshot " +
          "cannot be written repeatedly, a banner says so rather than letting you believe you are " +
          "covered.",
      },
      {
        kind: "note",
        text:
          "Your style library — presets, figure templates and the default new graphs start from — " +
          "lives on this machine, not inside the project file, so a project you send to someone " +
          "else does not carry it. Move it with Back up & transfer in the Style tab (see Presets " +
          "and defaults).",
      },
      {
        kind: "note",
        text:
          "Deleting an experiment deletes what is inside it, and deleting a project deletes " +
          "everything in it. Both are undoable with Ctrl+Z like any other change.",
      },

      { kind: "h", text: "If it goes wrong" },
      {
        kind: "ul",
        items: [
          "You cannot find your work: there is no library and no database to search. It is the .mady file you saved — the foot of the File menu lists the last eight you opened.",
          "You sent someone a project and it looks different: your style library lives on this machine, not in the file. Move it with Back up & transfer in the Style tab.",
          "MadY closed unexpectedly: the next launch offers “Recover unsaved work?”, naming the project and how old the copy is. Recover brings it back — you still choose where to save it.",
          "A banner says the snapshot cannot be written: autosave is failing, so you are not covered. Save the file yourself now, and check the disk or the folder's permissions.",
          "You saved a part and now your own document is that part: it cannot be. Saving a part never becomes the file you are working in.",
          "A dot is on the Save button and you thought autosave had it: autosave is a crash net, not a save. It never touches your file.",
        ],
      },
    ],
  },

  {
    id: "reproducibility",
    title: "Reproducibility",
    group: "Finishing a figure",
    summary: "Every figure can explain where it came from.",
    keywords: [
      "reproducible", "reproducibility", "provenance", "lineage", "audit", "log", "history",
      // Note: not "methods paragraph" and "alt text" together. Two keyword hits on the query
      // "methods text" (methods←paragraph, text←alt text) would beat the chapter that owns the
      // button of that name (`guideSearch.test.ts`). The body still says "Methods paragraph", so
      // the phrase still reaches this chapter without outranking "Reading a result".
      "what came from what", "stale", "re-run stale", "caption",
      "accessibility description", "analysis script", "python script", "bundle",
    ],
    blocks: [
      {
        kind: "goal",
        text:
          "a figure that can say where it came from — what it was built on, what has gone stale under " +
          "it, and how the numbers were produced — without your having kept a lab book of it.",
      },

      { kind: "h", text: "See what was built from what" },
      {
        kind: "steps",
        items: [
          {
            text:
              "View ▸ Lineage (provenance map)… opens the map as its own tab: the datasheets down one " +
              "side, and everything derived from them — graphs, analyses, figures — joined to their " +
              "sources.",
            shot: {
              file: "finish-lineage.png",
              alt:
                "The Lineage tab: ten datasheets listed down the left, joined by curved links to the " +
                "analyses and graphs built from them on the right, six analyses outlined in amber and " +
                "marked stale, with an OK / Stale / Error key and a Re-run stale (6) button in the header.",
              caption:
                "Datasheets on the left, everything derived from them on the right. The amber outlines are analyses whose data has moved on since they were computed — Re-run stale recomputes all of them at once.",
            },
          },
          {
            text:
              "Anything gone stale after an edit upstream is flagged. Re-run stale re-computes every one " +
              "of them in a single step.",
          },
          {
            text:
              "Click a node to open that object. The running log along the bottom edge of the workspace " +
              "records the meaningful actions in a project, so an analysis can be retraced.",
          },
        ],
      },

      { kind: "h", text: "Let it draft the writing" },
      {
        kind: "ul",
        items: [
          "MadY drafts the Methods paragraph for the analyses you ran — the test, the corrections, the software versions — as a starting point to edit, never inserted into your work automatically. It is a machine-written draft, so read it before you use it.",
          "It can also draft a figure caption and accessibility alt-text from what the figure actually shows.",
          "Analyses can be exported as a script that reproduces the numbers outside MadY (File ▸ Export analysis script (Python)…), or as a reproducibility bundle that carries the provenance with it (File ▸ Export reproducibility bundle…).",
        ],
      },
      {
        kind: "note",
        text:
          "These are offered, never forced. MadY does not nag, score your work, or watch how " +
          "you analyse.",
      },

      { kind: "h", text: "If it goes wrong" },
      {
        kind: "ul",
        items: [
          "Everything is flagged stale: something upstream changed under all of it. Re-run stale recomputes them in one step.",
          "An analysis stays stale after a re-run: it failed, or its inputs changed while it was running. Open it and run it again with the current data.",
          "A graph still says Out of date after a re-run: it contains an earlier result. Fitted curves refresh on re-run; recreate snapshot graphs such as ROC, survival and PCA from the updated analysis to refresh their drawing.",
          "The drafted Methods paragraph reads awkwardly: it is a machine-written draft. Read and edit it; it is never inserted into your writing for you.",
          "The exported script gives different numbers: check the versions it names against what you have installed. If they match, report it with Help ▸ Report a bug… — catching such a difference is what the script is for.",
          "You wanted MadY to enforce a workflow: it will not. The reproducibility tools are offered, never forced.",
        ],
      },
    ],
  },

  // ───────────────────────────────── Reference ──────────────────────────────────
  {
    id: "stats-engine",
    title: "How the statistics are computed",
    group: "Reference",
    summary: "Which established packages MadY calls, for what, and how to cite them.",
    keywords: [
      "engine", "python", "scipy", "numpy", "statsmodels", "pandas", "which package",
      "how is it computed", "cite the method", "cite the package", "algorithm", "validated",
      "own implementation", "kaplan-meier", "log-rank", "k-means", "bootstrap", "versions",
    ],
    blocks: [
      {
        kind: "goal",
        text:
          "to know exactly which package computed your number, so you can check the method and cite " +
          "the thing that actually did the work.",
      },
      {
        kind: "p",
        text:
          "MadY does not invent its own statistics. Almost every test, fit and interval is computed by " +
          "long-established, peer-reviewed open-source packages, called from a separate Python process " +
          "that runs alongside the app. This section says exactly which package computes what.",
      },
      {
        kind: "p",
        text:
          "The statistics run in that separate process, offline. Nothing is sent anywhere; a failed calculation " +
          "returns an error rather than taking the program down with it.",
      },
      {
        kind: "note",
        text:
          "Versions shipped with this build: NumPy 2.4.2, SciPy 1.17.1, statsmodels 0.14.6, pandas 2.3.3, patsy 1.0.2. The About " +
          "card gives the MadY version itself. When you report a method, cite the package that computed " +
          "it — MadY is the interface, not the algorithm.",
      },

      { kind: "h", text: "Which package computes what" },
      {
        kind: "table",
        head: ["Package", "What it computes"],
        rows: [
          [
            "SciPy (scipy.stats)",
            "Most of the hypothesis tests: one-sample, unpaired and paired t tests; Mann-Whitney U, Wilcoxon signed-rank, Kruskal-Wallis and Friedman; one-way ANOVA; Tukey HSD and Dunnett post-hoc comparisons; Shapiro-Wilk, D'Agostino-Pearson, Anderson-Darling and Kolmogorov-Smirnov normality tests; Levene and Bartlett tests of equal variance; Pearson and Spearman correlation and linear regression; and the categorical tests — chi-square, Fisher's exact and the binomial test.",
          ],
          [
            "SciPy (the rest)",
            "scipy.optimize.curve_fit performs every nonlinear curve fit (all built-in equations and your own); scipy.cluster.hierarchy with scipy.spatial.distance builds the hierarchical clustering behind the dendrogram; scipy.integrate and scipy.special supply the quadrature and special functions some distributions need.",
          ],
          [
            "statsmodels",
            "The regression and design-based models: multiple linear regression (OLS) with variance-inflation factors for multicollinearity, logistic regression, Poisson regression, two-way and factorial ANOVA, the mixed / random-effects model behind the variance components and the intraclass correlation, the Welch / Brown-Forsythe heteroscedastic one-way ANOVA, the Lilliefors normality test, and the power and sample-size calculations.",
          ],
          [
            "NumPy",
            "The array and linear-algebra substrate everything else is built on, and the principal-component analysis directly by singular-value decomposition.",
          ],
          [
            "pandas",
            "No statistic at all. It is the table structure MadY hands to statsmodels' formula interface for the models specified as a formula — factorial ANOVA and the mixed / random-effects model. It is listed here because it ships with the program and appears in its dependency list, not because it decides any number.",
          ],
          [
            "patsy",
            "No statistic either. It reads the model formulas that statsmodels' formula interface takes, turning a formula into the design matrix the model is fitted to.",
          ],
        ],
      },
      {
        kind: "note",
        text:
          "A few methods are implemented in MadY itself rather than taken from a package: the Kaplan-Meier " +
          "estimator and the log-rank and Gehan-Breslow tests, k-means clustering, and the permutation and " +
          "bootstrap resampling routines. These are the ones to check most carefully. Each is verified " +
          "against an independent implementation in MadY's own test suite — survival against " +
          "statsmodels' own survival functions — but they are MadY's own code, not a published " +
          "package's.",
      },

      { kind: "h", text: "How to cite them" },
      {
        kind: "p",
        text:
          "Please cite the package, not MadY, for the method itself:",
      },
      {
        kind: "ul",
        items: [
          "NumPy — Harris, C. R. et al. (2020). Array programming with NumPy. Nature 585, 357–362. doi:10.1038/s41586-020-2649-2",
          "SciPy — Virtanen, P. et al. (2020). SciPy 1.0: fundamental algorithms for scientific computing in Python. Nature Methods 17, 261–272. doi:10.1038/s41592-019-0686-2",
          "statsmodels — Seabold, S. & Perktold, J. (2010). statsmodels: Econometric and statistical modeling with Python. Proceedings of the 9th Python in Science Conference, 92–96. doi:10.25080/Majora-92bf1922-011",
          "pandas — McKinney, W. (2010). Data structures for statistical computing in Python. Proceedings of the 9th Python in Science Conference, 56–61. doi:10.25080/Majora-92bf1922-00a",
        ],
      },
      {
        kind: "note",
        text:
          "Every analysis also writes a Methods paragraph naming the test, its assumptions and the exact " +
          "numbers, which you can copy into a manuscript. That paragraph describes what was run; the " +
          "references above are what ran it.",
      },

      { kind: "h", text: "If it goes wrong" },
      {
        kind: "ul",
        items: [
          "A result says the engine is offline: the separate Python process has not started. The status bar says “engine ready” when it has.",
          "You need to know how a number was produced: the ✓ Validated badge beside a result's name says it — “Computed with” names the library, “Computed in MadY, validated against” marks the ones we implement ourselves. Click it to copy a citeable validation statement.",
          "A reviewer asks which software computed the test: cite the package from the list above, and give the version from this page. MadY is the interface, not the algorithm.",
        ],
      },
    ],
  },

  {
    id: "ask",
    title: "The Ask bar",
    group: "Reference",
    summary: "Type what you want in plain language — offline, with no model involved. It understands a limited set of phrasings.",
    keywords: [
      "ask", "natural language", "plain english", "type a command", "chat", "ai", "assistant",
      "no model", "offline", "voice", "tell it what to do", "search the manual", "in the manual",
      "popup", "help me find",
      "language model", "llm", "ollama", "gemma", "in development",
    ],
    blocks: [
      {
        kind: "goal",
        text:
          "a graph, an analysis or an axis change made by typing a short English sentence — with no " +
          "language model and no network call anywhere in it.",
      },
      {
        kind: "note",
        text:
          "The Ask bar understands only a small set of phrasings, so most ways " +
          "of saying a thing will not be recognised. Stay close to the examples below, and use the " +
          "menus for anything else — nothing here is available only through Ask.",
      },
      {
        kind: "p",
        text:
          "The Ask box sits at the far right of the menu bar. It turns a line of ordinary English into " +
          "real commands, and it answers questions from this manual. It is deterministic and entirely " +
          "local: there is no language model and no network call. It reads the words, and if it does " +
          "not recognise them as a command it shows what the manual has instead of guessing.",
      },

      { kind: "h", text: "Ask the manual" },
      {
        kind: "p",
        text:
          "As soon as you have typed two letters, the controls and chapters of this manual that match " +
          "are listed in a panel under the box, headed “In the manual” — the same matches Ctrl+K " +
          "shows, ranked the same way.",
      },
      {
        kind: "steps",
        items: [
          "Type what you are looking for — “axis break”, “transparent background”, “dpi”. Matches appear under the box as you type; the Search button (or Enter) is only needed to run a command.",
          "Click a match. The manual opens in a popup over your work, scrolled to that control or chapter and flashed so you can see where you landed. Escape, the ⨯ or a click outside closes it.",
          "Want to keep reading? “Open in Documentation tab” in the popup's head moves you to the full Documentation tab at the same place.",
        ],
      },
      {
        kind: "note",
        text:
          "Search and Enter run the line as a command when it is one; when it is not, and the manual " +
          "has an answer, you get the answer rather than an error. Nothing about the matching needs a " +
          "model: it is the manual's own text search.",
      },

      { kind: "h", text: "What it understands" },
      {
        kind: "table",
        head: ["To do this", "Type something like"],
        rows: [
          ["Make a graph", "“scatter of dose vs response”, “make a bar chart”"],
          ["Change the graph you are looking at", "“make it a box plot”, “turn it into a violin”"],
          ["Run an analysis", "“run a t-test on A and B”"],
          ["Edit an axis", "“log the x axis”, “reverse the y axis”, “title the x axis Time (h)”"],
          ["Find your way around", "“list graphs”, “list tables”, “list analyses”"],
        ],
      },
      {
        kind: "note",
        text:
          "Anything the Ask bar does is an ordinary edit — undoable with Ctrl+Z, and identical to what " +
          "the same command would have done from the menus. It has no privileged path into your document.",
      },

      { kind: "h", text: "If it goes wrong" },
      {
        kind: "ul",
        items: [
          "It says it does not understand: that is the correct answer, not a failure to try harder — it never guesses. Rephrase towards one of the examples, or use the menu.",
          "You expected it to be cleverer: there is no language model behind it. It is a deterministic parser, which is why it works offline and cannot invent an action.",
          "It did something you did not want: Ctrl+Z. Everything it does is an ordinary undoable edit.",
        ],
      },

      { kind: "h", text: "A language model for the Ask bar (in development)" },
      {
        kind: "note",
        text:
          "In development: this does not work well yet, and it is not part of the installed program. " +
          "It exists only in a run of MadY started from the source code with MADY_LLM=1.",
      },
      {
        kind: "p",
        text:
          "In such a run the ribbon has an Activate, install & configure LLM button. It downloads Ollama " +
          "and a Gemma 4 model to your computer, once, after showing what it will download and how big it " +
          "is. The model then runs on your computer only, and a second typing box appears on the ribbon, " +
          "under the Ask box: a sentence typed there goes to the Ask bar's own reader first and to the " +
          "model only when the reader does not recognise it. What it did is listed under the box, with " +
          "Undo beside it. That download is the one network request MadY can make: the installed program " +
          "makes no network request at all.",
      },
    ],
  },

  {
    id: "where",
    title: "Where is everything",
    group: "Reference",
    summary: "Every function in the program, listed by the route you would reach it through.",
    keywords: [
      "index", "list of functions", "where is", "find a control", "cannot find", "reference",
      "what can it do", "features", "commands", "controls",
    ],
    blocks: [
      {
        kind: "goal",
        text:
          "to find the one control you are after when you know what it does but not where it lives.",
      },
      {
        kind: "p",
        text:
          "The rest of this manual is arranged by subject: you read the chapter on axes to learn what " +
          "MadY can do to an axis. This chapter is the other way round. It lists every function the " +
          "program has, grouped by where you press it — the menu, the toolbar, a tab of the Inspector, " +
          "a right-click, a gesture on the figure or the datasheet, a dialog, or a key.",
      },

      { kind: "h", text: "Three ways to use it" },
      {
        kind: "steps",
        items: [
          {
            text:
              "Search, rather than read. The box at the top of this tab searches this list first, and " +
              "each result carries the route to the control and a link to the chapter that explains it.",
          },
          {
            text:
              "Come the other way, from the control to the page: every section of the Inspector, every " +
              "group of the Axis tab and every dialog carries a small “?” beside its heading. Press it " +
              "and this manual opens in the chapter that explains that control, at the control itself, " +
              "rather than at the top. Ctrl+K's manual hits and the Ask bar's matches land the same way.",
          },
          {
            text:
              "Or press Ctrl+K, which searches the manual as well as the commands — what it can answer " +
              "is listed under “In the manual”, below the actions it can run.",
          },
        ],
      },
      {
        kind: "note",
        text:
          "This list is built from the program itself — its commands, the toolbar, the table " +
          "formats, the analysis catalogue, the chart gallery and the Inspector's own sections — so it " +
          "cannot fall behind the software.",
      },
      // Each block carries its own heading (the renderer knows the name of each route), so the
      // list here is just the reading order: the places you look first, first.
      { kind: "index", via: "menu" },
      { kind: "index", via: "toolbar" },
      { kind: "index", via: "inspector" },
      { kind: "index", via: "dialog" },
      { kind: "index", via: "context" },
      { kind: "index", via: "figure" },
      { kind: "index", via: "sheet" },
      { kind: "index", via: "keys" },
    ],
  },

  {
    id: "shortcuts",
    title: "Menus and keyboard shortcuts",
    group: "Reference",
    summary: "The nine menus, and the keys worth learning.",
    keywords: [
      "shortcut", "keyboard", "keys", "hotkey", "menu", "menus", "ctrl", "what does ctrl",
      "key combination", "accelerator", "faster",
    ],
    blocks: [
      {
        kind: "goal",
        text:
          "to know which menu a thing lives under, and which keys are worth committing to memory.",
      },

      { kind: "h", text: "The nine menus" },
      {
        kind: "table",
        head: ["Menu", "What is in it"],
        rows: [
          ["File", "Open, save, import, export, and start a new project. The foot of the menu lists the files you opened most recently."],
          ["Edit", "Undo, redo, and the usual editing commands."],
          ["Insert", "A new XY datasheet, a New table submenu with one entry for each other table format, and a new layout (the multi-panel figure assembler)."],
          ["Data", "Change the table: transform, normalise, transpose, subset, derive."],
          ["Analyze", "Ask a question of the data; the table is left untouched."],
          ["Graph", "Create graphs, open the gallery, and copy a look between graphs."],
          ["Design", "Everything drawn on top of a chart: significance brackets and stars, text, arrows, boxes, highlights, callouts and reference lines."],
          ["View", "The command palette, lineage, settings, zoom, theme, and the workspace layout."],
          ["Help", "The Welcome page, this documentation, reporting a bug, and About MadY."],
        ],
      },
      {
        kind: "note",
        text:
          "Data changes the table; Analyze leaves it alone and answers a question about it. If a " +
          "command is not where you expected, that distinction is usually why.",
      },

      { kind: "h", text: "The keys" },
      {
        kind: "keys",
        rows: [
          { keys: "Ctrl+K", what: "Command palette — the fastest way to reach anything" },
          { keys: "Ctrl+Z / Ctrl+Y", what: "Undo / redo (Ctrl+Shift+Z also redoes)" },
          { keys: "Ctrl+S", what: "Save" },
          { keys: "Ctrl+O", what: "Open" },
          { keys: "Ctrl+I", what: "Import data" },
          { keys: "Ctrl+Shift+V", what: "Paste data as a new dataset" },
          { keys: "Ctrl+E", what: "Export whatever is in front" },
          { keys: "Ctrl+P", what: "Print what's in front — a graph, a figure, or a datasheet" },
          { keys: "Ctrl+Shift+C", what: "Copy the graph or figure in front to the clipboard as a picture (also Graph ▸ Copy as picture, and the right-click menu on a graph)" },
          { keys: "Ctrl+N", what: "New project" },
          { keys: "Ctrl+= / Ctrl+-", what: "Zoom in / out" },
          { keys: "Ctrl+0", what: "Reset zoom to 100%" },
          { keys: "Alt+← / Alt+→", what: "Back / forward through the tabs you have visited" },
          { keys: "Ctrl+\\ / Ctrl+Shift+\\", what: "Exclude / re-include the selected values in the spreadsheet" },
          { keys: "Ctrl+C / Ctrl+X / Ctrl+V", what: "Copy / cut / paste the selected spreadsheet cells (also on the Edit menu and the right-click)" },
          { keys: "Enter / F2", what: "Edit the selected cell in the spreadsheet" },
          { keys: "Delete / Backspace", what: "Clear the selected cells" },
          { keys: "F1", what: "Open this documentation. The “?” beside an Inspector section or a dialog title opens it at that control" },
          { keys: "Arrows / Shift+arrows", what: "Move the spreadsheet selection, or extend it" },
          { keys: "any letter or digit", what: "Start editing the selected cell, replacing what was in it" },
          { keys: "Ctrl+D", what: "In the spreadsheet: fill the selected block down from its top row. On a figure: duplicate the selected object. In the panel assembler: duplicate the selected panels" },
          { keys: "Ctrl+A (in the panel assembler)", what: "Select every panel. Drag on empty canvas to rubber-band a selection (Shift adds); click empty canvas to clear it" },
          { keys: "Ctrl+Shift+T", what: "Transpose the selected block of cells in place" },
          { keys: "Esc", what: "Deselect whatever is selected on a figure, and close a menu or a popup" },
          { keys: "Arrows / Shift+arrows (on a figure)", what: "Nudge the selected object by one pixel, or by ten" },
          { keys: "Ctrl+wheel", what: "Magnify the part of the figure under the pointer" },
        ],
      },
      {
        kind: "note",
        text:
          "Undo and redo deliberately do nothing while you are typing in a text field, so Ctrl+Z undoes " +
          "your typing rather than the last thing you did to the document.",
      },

      { kind: "h", text: "If it goes wrong" },
      {
        kind: "ul",
        items: [
          "A shortcut does nothing: you are in a text field, where Ctrl+Z undoes your typing instead. Click away first.",
          "You cannot find a command in any menu: press Ctrl+K and type what it does. The palette searches every command, including ones with no shortcut of their own.",
          "The command you want has no key: most do not. The palette is the keyboard route to all of them.",
        ],
      },
    ],
  },

  {
    id: "agent-mcp",
    title: "Drive MadY from an AI agent (MCP)",
    group: "Reference",
    summary: "Let a coding agent you already use — Claude Code, Codex, Cursor, VS Code, any MCP client — make and style graphs in MadY, offline.",
    keywords: [
      "mcp", "agent", "ai", "llm", "claude", "codex", "cursor", "vs code", "automation", "script",
      "headless", "api", "drive", "remote control", "assistant",
    ],
    blocks: [
      {
        kind: "goal",
        text:
          "an agent you already work with — in your editor or terminal — builds tables, graphs, " +
          "styles and figures in MadY for you, through the same checked, undoable commands the " +
          "program itself uses, with nothing leaving your machine.",
      },
      {
        kind: "p",
        text:
          "MCP is the plain protocol coding agents use to talk to tools. MadY ships an MCP server: " +
          "a small program the agent starts on your computer and talks to over its own input and " +
          "output — no key, no account, no network. It is part of the MadY source checkout " +
          "(packages/mcp-server), not of the installed program, so it needs Node.js and the " +
          "checkout once. Two ways to use it: headless, where the server keeps its own project " +
          "in memory and saves .mady files you then open; and live, where the agent drives the " +
          "window you are looking at.",
      },

      { kind: "h", text: "Connect a client" },
      {
        kind: "steps",
        items: [
          {
            text:
              "Build the server once: in the checkout, run npm run bundle inside packages/mcp-server " +
              "(or npm run build). It writes packages/mcp-server/dist/mady-mcp.mjs, one self-contained " +
              "file. Run it again after updating the checkout, or the agent talks to stale tools.",
          },
          {
            text:
              "The connection is one line, the same for every client: node followed by the path to " +
              "mady-mcp.mjs. Add MADY_ENGINE_EXE in its environment, pointing at the packaged statistics " +
              "engine (engines/py/dist/mady-engine/mady-engine.exe, or the engine folder inside an " +
              "installed MadY under resources), so analyses run too.",
          },
          {
            text:
              "Put that line where your client keeps its MCP servers. Three registrations already sit " +
              "in the checkout — .mcp.json for Claude Code, .cursor/mcp.json for Cursor, .vscode/mcp.json " +
              "for VS Code — so opening the checkout in one of those offers a server called mady with " +
              "no setup. Other clients take a copy of the same block.",
          },
          {
            text:
              "Ask the agent for something: “make a bar chart of Treatment against Response from " +
              "data.csv, journal style, and save it as trial.mady”. It calls the tools below; you " +
              "open the saved file in MadY like any other.",
          },
        ],
      },
      {
        kind: "table",
        head: ["Client", "Where the line goes"],
        rows: [
          ["Claude Code", ".mcp.json at the checkout root (ships with it), or claude mcp add mady -- node …/mady-mcp.mjs"],
          ["Cursor", ".cursor/mcp.json at the checkout root (ships with it), or ~/.cursor/mcp.json"],
          ["VS Code, agent mode", ".vscode/mcp.json at the checkout root (ships with it)"],
          ["Claude Desktop", "claude_desktop_config.json, under mcpServers, with absolute paths"],
          ["Codex CLI", "~/.codex/config.toml, an [mcp_servers.mady] block with command and args"],
          ["Windsurf, Continue, others", "their MCP settings — choose the stdio transport and paste the command"],
        ],
      },

      { kind: "h", text: "What the agent can do" },
      {
        kind: "ul",
        items: [
          "Author: a new project, tables, graphs of any kind, graph options, axes, series styles.",
          "Edit the data itself: read a table (the only way to get row ids), set cells, add rows and columns, rename and retype columns, sort, exclude cells, delete rows or columns — every row and column addressed by id, never by position, so a sort between reading and deleting cannot hit the wrong one.",
          "Put things on a graph: labels, reference lines, significance brackets, arrows, bands; significance from a test; fitted curves.",
          "Restyle: apply a built-in style preset by name in one call, set fonts, legend, grid and frame.",
          "Assemble a figure: list, create, add panels, set the figure's options.",
          "Organise: folders and experiments. Load a CSV with the same parser the program uses, so delimiters, decimal commas and missing-value tokens read the same.",
          "Read back: a project summary, the tables, graphs and analyses, one graph in full, one analysis in full.",
          "Ask what is settable: describe_options lists, per chart kind, the options that demonstrably change the drawing — measured by drawing with and without each, not by whether a control exists.",
        ],
      },
      {
        kind: "note",
        text:
          "Every command runs through the same validated, undoable path a click takes — there is no " +
          "second way to change a project. Deleting a row or column needs confirm set, and nothing " +
          "is touched before that check. There is no export from the headless server: exporting " +
          "runs through the window, so save the project and export from MadY.",
      },

      { kind: "h", text: "Drive the window you are looking at" },
      {
        kind: "steps",
        items: [
          {
            text:
              "This needs the Agent edition of MadY (built with npm run dist:agent, or run from the checkout " +
              "with MADY_EDITION=agent set before npm run dev). The standard edition has no bridge, and a command sent to it is " +
              "refused with a message saying so.",
          },
          {
            text:
              "Start it with a port in its environment — set MADY_LIVE_AGENT_PORT=8787 — then " +
              "the usual command. Without the variable no socket is opened at all; a malformed value " +
              "is off, there is no fallback port.",
          },
          {
            text:
              "In the agent, live_status says whether a window is listening; live_execute sends it " +
              "any command from the list above. The window runs it through its own executor, so the " +
              "graph redraws as if you had clicked, and the change is one Undo away.",
          },
        ],
      },
      {
        kind: "note",
        text:
          "Three rules keep that door shut: it opens only when asked for by the variable; it listens " +
          "on 127.0.0.1 only, never the network; and a web page cannot drive it — requests must carry " +
          "a header a page cannot set, and any request carrying a browser Origin is refused outright.",
      },

      { kind: "h", text: "If it goes wrong" },
      {
        kind: "ul",
        items: [
          "The client says the server did not start, or “cannot find module”: the bundle is not built. Run npm run bundle in packages/mcp-server and point the registration at dist/mady-mcp.mjs, not at dist/bin.js.",
          "A tool is missing or behaves like an older version: the bundle is stale — rebuild it after updating the checkout.",
          "live_execute answers “no MadY window is open”: the window was not started with MADY_LIVE_AGENT_PORT, or it is the standard edition.",
          "An analysis says the engine is not available: set MADY_ENGINE_EXE to the packaged engine's path (mady-engine.exe) in the server's environment.",
          "A delete did nothing: it needs confirm set to true, and nothing is looked up or deleted without it.",
        ],
      },
    ],
  },
  {
    id: "settings",
    title: "Settings",
    group: "Reference",
    summary: "Every switch in View ▸ Settings, in the order the dialog puts them.",
    keywords: [
      "settings", "preferences", "options", "defaults", "configure", "theme", "dark mode",
      "autosave", "date format", "missing values", "rounding", "startup",
    ],
    blocks: [
      {
        kind: "goal",
        text:
          "the program set up the way you work — and a clear line between what shapes new graphs and " +
          "what takes effect this second.",
      },
      {
        kind: "p",
        text:
          "View ▸ Settings holds nine groups. The first five — the default look, the favourite " +
          "style per graph type, the common defaults, your saved presets and their backup — are " +
          "about how new graphs look and are explained in Presets and defaults, because that is " +
          "where you meet them; this chapter is the row-by-row list. The Application group takes " +
          "effect immediately. Nothing here ever " +
          "rewrites a graph you have already made — to restyle those, use the graph's Inspector " +
          "or Graph ▸ Apply this look to other graphs.",
      },

      { kind: "h", text: "The groups about how new graphs look" },
      {
        kind: "ul",
        items: [
          "Default look for new graphs — Global default: the preset (built-in or one of yours) every new graph starts from, or None.",
          "Favourite style per graph type — one dropdown per chart type, for when a bar chart and a survival curve want different looks. A type with no choice of its own falls back to the global default.",
          "Common defaults — Title font, Title size, Axis thickness, Axis colour, Gridlines and Colour palette, layered on top of the chosen preset. Leave a field blank to defer to the preset. Reset clears the lot.",
          "My saved presets — the same list the Style tab shows: each preset with a rename box, the graph types it carries its own settings for, ★ to make it the default, Export… to hand it to someone, and a delete cross. Save, Apply and “+ type” need an open graph, so they live in the Style tab only.",
          "Back up & transfer — Import preset… for files someone exported (each gets a fresh identity; a name you already have gets “(2)”), and Export library… / Import library… for the whole library, exactly as in the Style tab.",
        ],
      },

      { kind: "h", text: "New-graph and analysis defaults" },
      {
        kind: "ul",
        items: [
          "New-graph defaults ▸ Default graph type — which chart the New-graph dialog opens on.",
          "New-graph defaults ▸ Default error bars — SD, SEM, 95% CI or none, for new graphs that draw them.",
          "New-graph defaults ▸ Date entry format — how an ambiguous typed date is read: Auto (from your system), International day/month/year, or US month/day/year. 05/06 is 5 June under one and 6 May under the other, so if your dates come out transposed, this is the switch.",
          "New-graph defaults ▸ Missing values (import) — words the importer should treat as blank, comma-separated (NA, N/A, null). Empty is the default and keeps every value as imported; only a truly empty cell is blank. The Import dialog has the same field per file; this is what it starts from.",
          "Analysis defaults ▸ Default confidence — 90%, 95% or 99%, for analyses that report an interval.",
          "Analysis defaults ▸ Round results tables — off by default, so a table shows every digit that was computed; set 3 to 6 significant figures to round what is on screen. Display only: exports, Copy, the key-result cards and the numbers themselves keep full precision, and p-values keep their own three-figure convention.",
          "Analysis defaults ▸ the saved per-analysis defaults — tick Make default in an Analyze dialog and the method remembers its options; they are listed here, each with a Clear. Only the settings are stored, never your columns or your data.",
          "Significance — the threshold ladder new graphs start from: the p cut-offs, the symbol each prints, and what “not significant” is called. A graph you have already made keeps its own.",
        ],
      },
      {
        kind: "shot",
        file: "settings-application.png",
        alt:
          "The Settings dialog scrolled to its New-graph defaults group: Default graph type on " +
          "XY points and line, Default error bars on Standard deviation, Date entry format on " +
          "Auto (from your system) and an empty Missing values (import) box; then Analysis " +
          "defaults with Default confidence 95%, Round results tables Off (full precision) and a " +
          "note that no per-analysis defaults are saved; then the Significance threshold ladder. " +
          "The Application group is further down the same scrolling list.",
        caption:
          "The part of Settings that is not about how graphs look: what new datasheets and " +
          "analyses assume, and the significance ladder new graphs start from. Missing values " +
          "shows grey placeholder text, not a setting — empty is the default, and only a truly " +
          "blank cell is treated as missing until you fill this in.",
      },

      { kind: "h", text: "The group that takes effect immediately" },
      {
        kind: "ul",
        items: [
          "Application ▸ Theme — light or dark. Exporting from a dark theme onto a light page re-colours for the page rather than baking pale ink onto white.",
          "Application ▸ Fit graphs to the window at startup — scale a graph that has no size of its own up to the space available, measured once when the app opens, so nothing reflows while you resize the window. A graph you have sized yourself is never touched; switching it off puts everything back to 580 × 380 at once.",
          "Application ▸ Hover values in interactive HTML export — whether an exported interactive page shows each mark's values when a reader hovers it. On by default; the Export dialog's Show values on hover box changes it for one export.",
          "Application ▸ Autosave — the crash-recovery snapshot, on or off. See Saving and opening projects for what it does and does not protect.",
          "Application ▸ Autosave every (seconds) — how long after your last edit the snapshot is written. The default is 1.5 seconds, long enough that a burst of typing or dragging becomes one write.",
        ],
      },
      {
        kind: "note",
        text:
          "These settings live on this machine, not in your project file. They are written to your " +
          "user folder as well as the app's own storage, so updating the app cannot lose them — " +
          "and Back up & transfer in the Style tab moves them to another machine.",
      },

      { kind: "h", text: "If it goes wrong" },
      {
        kind: "ul",
        items: [
          "You changed a default and your graphs did not move: nothing in Settings ever rewrites an existing graph. Restyle those with a preset, or Graph ▸ Apply this look to other graphs.",
          "Your dates came out transposed — 5 June read as 6 May: that is Date entry format. Set it to International or US rather than Auto.",
          "A results table shows more digits than you want: Round results tables. It is display only; exports and the key-result cards keep full precision.",
          "Your settings vanished after an update: they should not — they are written to your user folder as well as the app's storage. Back up & transfer in the Style tab moves them between machines.",
        ],
      },
    ],
  },

  {
    id: "access",
    title: "Accessibility",
    group: "Reference",
    summary: "Reaching the program, and making figures other people can read.",
    keywords: [
      "accessibility", "accessible", "colourblind", "colorblind", "color blind", "contrast",
      "screen reader", "alt text", "keyboard only", "photocopy", "black and white",
      "universal design", "deuteranopia", "protanopia", "readable",
    ],
    blocks: [
      {
        kind: "goal",
        text:
          "a figure that still works for a colour-blind reader and on a black-and-white photocopier — " +
          "and a program you can drive without a mouse.",
      },

      { kind: "h", text: "Making the figure readable" },
      {
        kind: "ul",
        items: [
          "New graphs use a colourblind-safe palette by default, so a figure is readable without relying on red-versus-green.",
          "Colour is rarely the only channel available: symbol shape, fill pattern and line dash all distinguish series, and using two of them together survives both colourblindness and photocopying.",
          "The Universal design and Grayscale (print) presets do this for you in one click — the first carries a shape per series, the second cycles the marker shapes because grey levels alone will not separate them. See Presets and defaults.",
          "The gradient editor simulates deuteranopia, protanopia and greyscale beside the ramp as drawn, and warns when two classes would be hard to tell apart. It is advice, never a refusal.",
          "MadY drafts alt-text describing what a figure actually shows, for the accessibility statement journals increasingly ask for.",
        ],
      },

      { kind: "h", text: "Reaching the program itself" },
      {
        kind: "ul",
        items: [
          "Zoom scales the whole interface, not just the figure, with Ctrl+= / Ctrl+- / Ctrl+0, Ctrl+scroll, or the status-bar control.",
          "The light and dark themes are both full themes; exporting from either produces output coloured for the page rather than for the screen.",
          "Every command is reachable from the keyboard through the command palette (Ctrl+K), including ones with no shortcut of their own.",
        ],
      },
      {
        kind: "note",
        text:
          "Two channels beat one. A reviewer printing your figure in black and white, and a reader with " +
          "deuteranopia, are the same problem — and shape-plus-colour solves both at once.",
      },
    ],
  },

  {
    id: "refuse",
    title: "When something refuses to happen",
    group: "Reference",
    summary: "The common cases where a control declines, and why.",
    keywords: [
      "greyed out", "grayed out", "disabled", "does nothing", "not working", "cannot",
      "why is it off", "refused", "no effect", "nothing happens", "stuck", "won't",
    ],
    blocks: [
      {
        kind: "goal",
        text:
          "to tell the difference between a control that is refusing on purpose — and saying why — and " +
          "one that is actually broken.",
      },
      {
        kind: "p",
        text:
          "MadY treats a setting that silently does nothing as a defect. When something you asked for cannot be done, it is " +
          "supposed to say so — above the figure, in the panel, or in the result. If you set something " +
          "and nothing seems to change, look for that message first.",
      },

      { kind: "h", text: "The usual reasons" },
      {
        kind: "table",
        head: ["What you see", "What it means"],
        rows: [
          ["A greyed menu command", "Its precondition is missing. Significance brackets need a chart with a category axis and an analysis with pairwise comparisons, so both have to exist first."],
          ["A log scale does nothing", "Refused on lollipop, paired-dot, population-pyramid and estimation plots, which draw a bespoke value axis; and on a volcano plot, whose axes already hold logged values. It is also refused when the data reaches zero or below — the graph says so above the figure."],
          ["The sheet will not take an edit", "The table is frozen. Untick Freeze on the rail above it."],
          ["A result marked stale", "It is showing numbers from before the last edit to its data. Re-run it, or re-run every stale analysis at once from the lineage map."],
          ["A linked table with a ⚠️ marker", "Its last re-read failed — the file was moved, locked or made unreadable. The message names the reason."],
          ["A statistic refused outright", "It cannot validly be computed, and the remedy is named: a group with no variance, a perfectly separated logistic fit, too few values for the test."],
          ["A colour change hit the wrong things", "A scope question. Check whether the panel is set to style one element, one series, or all of them."],
          ["A control missing from the graph toolbar", "It does not apply to this kind of chart, so it is left out rather than shown doing nothing."],
        ],
      },
      {
        kind: "note",
        text:
          "If something fails quietly, with no message anywhere, that is a bug worth reporting rather " +
          "than a limit worth working around. Help ▸ Report a bug… is the next section.",
      },
    ],
  },

  {
    id: "help",
    title: "Getting help and reporting problems",
    group: "Reference",
    summary: "How to send a useful bug report without sending your data.",
    keywords: [
      "bug", "report a bug", "crash", "problem", "broken", "feedback", "support", "diagnostics",
      "log", "send report", "privacy", "what is included",
    ],
    blocks: [
      {
        kind: "goal",
        text:
          "a bug report we can actually reproduce — carrying nothing of your data that you did not " +
          "deliberately tick.",
      },
      {
        kind: "p",
        text:
          "Help ▸ Report a bug… gathers what is needed to reproduce a problem: the app and statistics-engine " +
          "versions, what was on screen, your recent clicks and drags, the application log, and any errors the " +
          "app caught. A drag that changed nothing is recorded as exactly that — so a control that does not " +
          "respond is documented even though it raised no error.",
      },

      { kind: "h", text: "Send one" },
      {
        kind: "steps",
        items: [
          {
            text:
              "Help ▸ Report a bug…. Pick a Category, write a one-line Summary, then say under What " +
              "happened what you did, what you expected, and what happened instead.",
            shot: {
              file: "help-bug-report.png",
              alt:
                "The Report a bug dialog: a paragraph explaining that nothing is uploaded, a Category " +
                "dropdown, a Summary line, a What-happened box, then the What-to-include checklist with " +
                "each row naming what it carries — the last two, Statistics engine calls and My whole " +
                "document, unticked — a Review-exactly-what-will-be-saved link, and the Cancel, Copy " +
                "report, Save report (.zip) and Email report buttons.",
              caption:
                "Everything holding your data starts unticked, and every line says what it carries, so ticking one is a decision rather than a default. Two more rows appear when there is something to offer: the analysis in front, and a window screenshot.",
            },
          },
          {
            text:
              "Tick what to include. Every piece is listed with what it carries; anything holding your " +
              "data — engine calls, an analysis, a screenshot, the document — starts unticked.",
          },
          {
            text:
              "Open “Review exactly what will be saved” if you want to read the report before it " +
              "leaves — it shows what is in and what you withheld.",
          },
          {
            text:
              "Choose Email report to open your own mail app addressed to us with the details filled in " +
              "— just press send. For a screenshot, your document or the full log, Save report writes a " +
              ".zip to attach, and Copy report puts the text on the clipboard.",
          },
        ],
      },
      {
        kind: "note",
        text:
          "For a wrong statistical result, tick “Statistics engine calls” or “Analysis + the columns it used” — " +
          "they carry the exact computation so it can be replayed, which is why they stay off until you say so. " +
          "Usernames are stripped from any file paths. Nothing is ever uploaded — sending the report is your " +
          "action, not the program's.",
      },

      { kind: "h", text: "If it goes wrong" },
      {
        kind: "ul",
        items: [
          "Nothing was sent: nothing ever is. The program has no network access — Email report opens your mail app, and Save report writes a file you attach yourself.",
          "You are worried about sending data: read the checklist. Every line says what it carries, and everything holding your data starts unticked.",
          "The problem is a wrong number: tick “Statistics engine calls” or “Analysis + the columns it used”, which carry the exact computation so it can be replayed.",
          "The bug is that nothing happened: that is recorded. A drag that changed nothing is logged as exactly that, so an unresponsive control is documented even though it raised no error.",
        ],
      },
    ],
  },

  {
    id: "licence",
    title: "Licence, your figures, and how to cite",
    group: "Reference",
    summary: "MadY is free software. What you make with it is yours.",
    keywords: [
      "licence", "license", "gpl", "copyright", "free software", "open source", "cite mady",
      "citation", "can i publish", "commercial", "credits", "acknowledgements", "attribution",
      "third party", "parameters", "ggplotplus", "biomehorizon",
    ],
    blocks: [
      {
        kind: "goal",
        text:
          "to know exactly what you may do with the program, what you may do with the figures it draws " +
          "(anything), and which sources to cite for the two sets of parameters MadY took from " +
          "published work.",
      },
      {
        kind: "p",
        text:
          "MadY is free software under the GNU General Public License, version 3 or later. You may run it "
          + "for any purpose, study how it works, share it with colleagues, and change it — provided that "
          + "anything you pass on carries the same freedoms.",
      },
      {
        kind: "note",
        text:
          "Your figures, files and results are yours. A program's output is not a derivative work of the "
          + "program, so nothing in the licence attaches to your data, your figures or your paper. Publish, "
          + "sell or license them exactly as you would if you had drawn them by hand — no permission, no "
          + "attribution, no conditions.",
      },
      {
        kind: "ul",
        items: [
          "Nothing you make is watermarked.",
          "The card at the top of this tab — and Help ▸ About MadY — shows the version you are running, the copyright, and a link to the full licence text.",
          "A citation is appreciated when MadY helped with published work, but it is a request and not a condition of the licence.",
        ],
      },
      { kind: "cite" },

      { kind: "h", text: "Where two sets of parameters come from" },
      {
        kind: "p",
        text:
          "Two parts of MadY use parameters taken from published work. Both sources are MIT-licensed. " +
          "If you publish a figure that uses either, cite the source as well.",
      },
      {
        kind: "table",
        head: ["What uses them", "Where the parameters come from"],
        rows: [
          [
            "The Universal design style preset — its palette, marker shapes, point opacity, axis-title weight and gridline settings",
            "ggplotplus, an R package by Dr Alex Bajcz. MIT-licensed. Repository: github.com/MAISRC/ggplotplus",
          ],
          [
            "The ridgeline's horizon fold — its graphing parameters and methods (Level bands, the per-row Fold origin, the sign-coloured bands)",
            "BiomeHorizon, an R package from Ran Blekhman's laboratory (github.com/blekhmanlab/biomehorizon). No code is reused.",
          ],
        ],
      },
      {
        kind: "note",
        text:
          "The statistics are a separate question, and a bigger one: the packages that compute every " +
          "test, fit and interval are credited with full references in How the statistics are computed. " +
          "Cite those for the method itself.",
      },
      {
        kind: "p",
        text: "This documentation was built with the help of Claude Opus models (Anthropic).",
      },
    ],
  },

  {
    id: "glossary",
    title: "The words MadY uses",
    group: "Reference",
    summary: "Terms that mean something specific here.",
    keywords: [
      "glossary", "terms", "vocabulary", "what does it mean", "definition", "jargon",
      "dataset", "sub-column", "derived", "stale", "panel", "preset", "template",
    ],
    blocks: [
      {
        kind: "goal",
        text:
          "to read the rest of this manual without guessing at a word that means something particular " +
          "here.",
      },
      {
        kind: "table",
        head: ["Word", "What it means in MadY"],
        rows: [
          ["Project · experiment", "The two levels of the tree on the left. A project holds experiments; an experiment holds the tables, graphs and analyses that belong together. Both are optional filing, not containers you must use."],
          ["Dataset", "One Y series in a table, which may be a single column or a group of replicate sub-columns."],
          ["Sub-column", "A replicate of the same group, sitting inside one dataset. Means and error bars come from these."],
          ["Table format", "The shape of a datasheet (XY, Column, Grouped and twelve more). It determines which analyses and chart types are offered."],
          ["Derived sheet", "A table computed from another one, which stays live: change the source and it follows."],
          ["Excluded", "A value marked as not-to-be-used. It stays visible and is ignored by graphs and statistics. Not the same as deleted."],
          ["Preset · house style", "A saved look for a graph · a saved arrangement for a multi-panel figure (also called a figure template). Graph templates saved by an earlier version of MadY are converted into presets."],
          ["Panel", "One graph or image inside a multi-panel figure. Panels can be linked to their source graph or unlinked."],
          ["Annotation", "Anything drawn on top of a chart rather than computed from the data: text, arrows, boxes, reference lines, significance brackets."],
          ["Stale", "An analysis, or a graph that shows an analysis result, whose source data has changed since it was last computed. Re-run it to bring it up to date. A derived sheet recomputes itself after every edit, so it does not stay stale."],
          ["Threshold ladder", "The list of p-value cut-offs and the symbol each one prints, used by every significance marker on a graph."],
        ],
      },
    ],
  },
];
