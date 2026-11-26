/**
 * Action registry — the single source of truth for app commands. The **menu
 * bar**, the **command palette** (Ctrl-K), and the **global keyboard shortcuts**
 * all render/dispatch from this one list, so every command exists everywhere a
 * user looks. Add a command
 * once here → it appears in all three surfaces.
 */
import { tableFormatList } from "@mady/core";
import type { AnnotationKind, TableKind } from "@mady/core";
import { TOURS, type TourId } from "./tour";

export type MenuName = "File" | "Edit" | "Insert" | "Data" | "Analyze" | "Graph" | "Design" | "View" | "Help";

/** Nested menu rows (see `AppAction.submenu`). */
const COMMON_ANALYSES_SUBMENU = "Common analyses"; // domain front doors into the Analyze dialog
const NEW_TABLE_SUBMENU = "New table"; // one entry per non-XY datasheet format
export const GUIDED_TOURS_SUBMENU = "Guided tours"; // one entry per tour in `TOURS`

export interface AppAction {
  id: string;
  label: string;
  menu: MenuName;
  /**
   * Nest this action under a shared parent row of this name inside its menu. Every
   * action with the same `submenu` collapses into one row that opens a nested panel;
   * the parent is not itself a command. Menus stay scannable without losing entries.
   * The command palette ignores this — it always lists actions flat.
   */
  submenu?: string;
  /**
   * Extra search terms for the command palette only (never displayed). Lets a menu
   * label stay short while "EC50", "Michaelis-Menten", "histogram" still find it.
   */
  keywords?: string;
  /** Display form, e.g. "Ctrl+O". */
  shortcut?: string;
  /** Matcher key, e.g. "ctrl+o" / "ctrl+shift+z" (see `eventCombo`). */
  combo?: string;
  run: () => void;
  /** Default true. A disabled action greys out in menus and is skipped by shortcuts. */
  enabled?: boolean;
  /** For a toggle command: show a check mark next to the label when the state is on. */
  checked?: boolean;
  /** Group index → menu separators between groups; also clusters the palette. */
  group?: number;
  /** Skip this action's shortcut while a text field is focused (e.g. undo/redo). */
  skipInInputs?: boolean;
}

export interface ActionHandlers {
  openFile: () => void;
  importData: () => void;
  /** File ▸ Import ggplot script… — a .R file's chain becomes a MadY graph on a chosen datasheet. */
  importGgplot: () => void;
  pasteData: () => void;
  save: () => void;
  exportActive: () => void;
  /** Whether the active tab is something Export… can export (a graph, a figure, a table).
   *  On Welcome / gallery / docs / lineage the command is disabled rather than enabled and
   *  silently doing nothing. A silent no-op is a defect. */
  canExport: boolean;
  /** File ▸ Export all graphs & figures… — every graph and figure of the project into one folder. */
  exportAll: () => void;
  /** Whether the project has anything Export all could write (at least one graph or figure). */
  canExportAll: boolean;
  /** Send whatever is in front — graph, figure, or datasheet — to the OS print dialog. */
  print: () => void;
  /** Whether the active tab is printable (a graph, figure, or datasheet). */
  canPrint: boolean;
  /** Graph ▸ Copy as picture / Copy as SVG — the graph or figure in front to the clipboard, as the
   *  PNG the Export dialog would start with, or as SVG markup (also Ctrl+Shift+C and the graph's
   *  right-click menu). */
  copyPicture: () => void;
  copySvg: () => void;
  /** Whether a graph or a figure is in front to copy. */
  canCopyPicture: boolean;
  exportScript: () => void;
  /** Export a self-describing reproducibility bundle (Markdown: provenance + script + manifest). */
  exportRepro: () => void;
  newProject: () => void;
  newDataset: () => void;
  /** Create a new data table of a chosen format (the format determines capability). */
  newTable: (kind: TableKind) => void;
  newLayout: () => void;
  reshapeData: () => void;
  /** Exclude / re-include the values selected in the datasheet (kept, but not used). */
  excludeValues: () => void;
  includeValues: () => void;
  /** Whether the datasheet has a selected block — gates both commands and their shortcuts. */
  hasDataSelection: boolean;
  rowStats: () => void;
  pruneData: () => void;
  colMath: () => void;
  transposeData: () => void;
  extractData: () => void;
  /** Open "Merge datasheets" on the active sheet (needs a second sheet to merge with). */
  mergeData: () => void;
  /** Whether the project has two sheets to merge (gates Data ▸ Merge datasheets). */
  canMergeData: boolean;
  /** Open "Split text column" on the active sheet. */
  splitText: () => void;
  /** Open "Find & replace" on the active sheet. */
  findReplace: () => void;
  /** Whether the active sheet's cells can be edited (not made from another sheet, not frozen) — gates Find & replace. */
  canFindReplace: boolean;
  transformData: () => void;
  frequencyData: () => void;
  qqData: () => void;
  simulateData: () => void;
  powerCalc: () => void;
  monteCarlo: () => void;
  duplicateData: () => void;
  /** Open the "Sort rows by a column" dialog on the active datasheet (also on the column
   *  right-click). */
  sortData: () => void;
  /** Whether there's an editable datasheet to sort (gates the Data ▸ Sort item). */
  canSortData: boolean;
  newGraph: () => void;
  cloneGraph: () => void;
  /** Graph ▸ Split into small graphs: one graph per series, placed on a new figure page. */
  splitGraph: () => void;
  /** Whether the active graph can be split (a splittable type with 2+ series, not itself a small graph). */
  canSplitGraph: boolean;
  /** Graph ▸ Detach small graph: the active small graph stops following its original. */
  detachSmallGraph: () => void;
  /** Whether the active graph is a small graph (gates Detach). */
  isSmallGraph: boolean;
  applyLook: () => void;
  /** Whether a graph is active (gates the graph-only reuse commands). */
  hasPlot: boolean;
  /** Open the "New graph" creator (pick a graph type → compatible datasheet). */
  newGraphDialog: () => void;
  openGallery: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Copy / cut / paste the active datasheet's selected block (Edit menu + palette). The grid
   *  handles the keys directly; these are the menu/palette route. Copy is gated by
   *  `hasDataSelection`; Cut/Paste additionally require `canEditDataSelection` (not frozen). */
  copyData: () => void;
  cutData: () => void;
  pasteCells: () => void;
  /** Whether the selected block can be edited — selected and the table isn't frozen. */
  canEditDataSelection: boolean;
  analyze: () => void;
  /** Open the Analyze dialog straight into a dose-response curve fit (EC50 / IC50). */
  doseResponse: () => void;
  /** Guided curve-fit / analysis front doors (generalise the dose-response door). */
  enzymeKinetics: () => void;
  binding: () => void;
  interpolateCurve: () => void;
  methodComparison: () => void;
  /** Open Analyze straight on Melting temperature (Tm / ΔTm of melt curves). */
  meltingTemperature: () => void;
  openCommandPalette: () => void;
  /** Step back / forward through the tabs visited this session (browser-style). */
  navigateBack: () => void;
  navigateForward: () => void;
  /** Whether there is anywhere to go — these gate the arrows and their shortcuts. */
  canNavigateBack: boolean;
  canNavigateForward: boolean;
  toggleTheme: () => void;
  /** Flip the app-wide "show a measuring ruler around the graph" preference. */
  toggleGraphRuler: () => void;
  /** View ▸ Colour-blind preview — see the graph or figure in front as a colour-blind reader
   *  would (a screen-only filter; exports never change). Off ↔ the last kind chosen. */
  toggleColorVision: () => void;
  colorVisionOn: boolean;
  canPreviewColor: boolean;
  /** Current state of that preference — drives the check mark next to the menu row. */
  graphRulerOn: boolean;
  zoomIn: () => void;
  zoomOut: () => void;
  /** Is there anywhere left to zoom? A menu row that cannot move the view greys out, exactly
   *  like Undo with nothing to undo — and the shortcut stops firing with it. */
  canZoomIn: boolean;
  canZoomOut: boolean;
  zoomReset: () => void;
  setZoomLevel: () => void;
  resetToolbar: () => void;
  openLayouts: () => void;
  resetLayout: () => void;
  /** Open the whole-project provenance / lineage map. */
  viewLineage: () => void;
  /** Open the Settings dialog (default styles per graph type + common defaults + app preferences). */
  openSettings: () => void;
  /** Open the bug reporter (assembles diagnostics → a local .zip). */
  reportBug: () => void;
  /** Open the program's own documentation (Help ▸ Documentation). */
  openGuide: () => void;
  /** Write the whole manual out as one self-contained HTML file (Help ▸ Save the manual…). */
  saveManual: () => void;
  /** Open the About card — version, author, licence, citation (Help ▸ About MadY). */
  openAbout: () => void;
  /** Open the Welcome page (Help ▸ Welcome page) — what the app opens on at launch. */
  openWelcome: () => void;
  /** Help ▸ Guided tours ▸ … — a walkthrough run inside the program, one lit control at a time (`tour.ts`). */
  startTour: (id: TourId) => void;
  // --- Design: the objects you draw on top of a chart --------------------------------
  /** True when the active graph can carry annotations at all (a network cannot). */
  canAnnotate: boolean;
  /** True when the active graph's groups sit on a category axis, so a bracket has ends. */
  canBracket: boolean;
  /** True when some analysis on this graph's data has pairwise comparisons to draw. */
  hasPairwiseAnalysis: boolean;
  /** Add one annotation of the given kind to the active graph. */
  addAnnotation: (kind: AnnotationKind) => void;
  /** Place significance brackets from an analysis (asks which, if there is a choice). */
  bracketsFromAnalysis: () => void;
  /** Place compact-letter-display labels from an analysis. */
  lettersFromAnalysis: () => void;
  /** Open the significance thresholds + label options. */
  openSignificanceOptions: () => void;
}

/**
 * The registry as data — every command's id, label, menu, submenu, shortcut and keywords,
 * with `run` wired to nothing and every capability flag on.
 *
 * The manual's function index (`guideIndex.ts`) is built from this, so a command added here
 * appears in the index — and fails its default-deny documentation gate — without anyone
 * remembering to list it twice. Every flag is `true` on purpose: the index describes what the
 * program can do, not what is reachable at this instant, and a `false` here would silently
 * drop `Export…` or `Duplicate graph` from the manual.
 *
 * Never call `run()` on one of these. They are no-ops; a caller expecting the real command
 * would get silence.
 */
export function actionCatalogue(): AppAction[] {
  return buildActions(catalogueHandlers());
}
/** Every handler a no-op and every flag true: the catalogue's handlers, and the base a test
 *  builds a real registry from (`buildActions({ ...catalogueHandlers(), canX: false })`). */
export function catalogueHandlers(): ActionHandlers {
  const noop = (): void => {};
  return {
    openFile: noop, importData: noop, importGgplot: noop, pasteData: noop, save: noop,
    exportActive: noop, canExport: true, exportAll: noop, canExportAll: true, print: noop, canPrint: true, copyPicture: noop, copySvg: noop, canCopyPicture: true, exportScript: noop,
    exportRepro: noop, newProject: noop, newDataset: noop, newTable: noop, newLayout: noop,
    reshapeData: noop, excludeValues: noop, includeValues: noop, hasDataSelection: true,
    rowStats: noop, pruneData: noop, colMath: noop, transposeData: noop, extractData: noop, mergeData: noop, canMergeData: true, splitText: noop, findReplace: noop, canFindReplace: true,
    transformData: noop, frequencyData: noop, qqData: noop, simulateData: noop, powerCalc: noop,
    monteCarlo: noop, duplicateData: noop, sortData: noop, canSortData: true, newGraph: noop,
    cloneGraph: noop, splitGraph: noop, canSplitGraph: true, detachSmallGraph: noop, isSmallGraph: true, applyLook: noop, hasPlot: true, newGraphDialog: noop, openGallery: noop,
    undo: noop, redo: noop, canUndo: true, canRedo: true, copyData: noop, cutData: noop,
    pasteCells: noop, canEditDataSelection: true, analyze: noop, doseResponse: noop,
    enzymeKinetics: noop, binding: noop, interpolateCurve: noop, methodComparison: noop, meltingTemperature: noop,
    openCommandPalette: noop, navigateBack: noop, navigateForward: noop, canNavigateBack: true,
    canNavigateForward: true, toggleTheme: noop, toggleGraphRuler: noop, graphRulerOn: false,
    toggleColorVision: noop, colorVisionOn: false, canPreviewColor: true,
    zoomIn: noop, zoomOut: noop, zoomReset: noop, setZoomLevel: noop, canZoomIn: true,
    canZoomOut: true, resetToolbar: noop, openLayouts: noop, resetLayout: noop, viewLineage: noop,
    openSettings: noop, reportBug: noop, openGuide: noop, saveManual: noop, openAbout: noop, openWelcome: noop, startTour: noop,
    canAnnotate: true, canBracket: true, hasPairwiseAnalysis: true, addAnnotation: noop,
    bracketsFromAnalysis: noop, lettersFromAnalysis: noop, openSignificanceOptions: noop,
  };
}

/** Build the flat command list from the app's handlers. */
export function buildActions(h: ActionHandlers): AppAction[] {
  return [
    // File
    { id: "open", label: "Open…", menu: "File", shortcut: "Ctrl+O", combo: "ctrl+o", run: h.openFile, group: 0 },
    { id: "import", label: "Import data…", menu: "File", shortcut: "Ctrl+I", combo: "ctrl+i", run: h.importData, group: 0 },
    // A ggplot script carries a figure's design, not its data: the chain is translated into a
    // MadY graph (with a report of what was honoured / approximated / refused) on the datasheet
    // the user picks. Beside "Import data…" because it is the other thing people arrive with.
    { id: "import-ggplot", label: "Import ggplot script (.R)…", menu: "File", run: h.importGgplot, keywords: "ggplot ggplot2 R script rscript import translate geom aes theme", group: 0 },
    { id: "paste-data", label: "Paste data as new datasheet…", menu: "File", shortcut: "Ctrl+Shift+V", combo: "ctrl+shift+v", run: h.pasteData, group: 0 },
    { id: "save", label: "Save…", menu: "File", shortcut: "Ctrl+S", combo: "ctrl+s", run: h.save, group: 1 },
    { id: "export", label: "Export…", menu: "File", shortcut: "Ctrl+E", combo: "ctrl+e", run: h.exportActive, enabled: h.canExport, group: 1 },
    { id: "export-all", label: "Export all graphs & figures…", menu: "File", run: h.exportAll, enabled: h.canExportAll, keywords: "batch export every graph figure folder png svg pdf all at once", group: 1 },
    { id: "print", label: "Print…", menu: "File", shortcut: "Ctrl+P", combo: "ctrl+p", run: h.print, enabled: h.canPrint, keywords: "print paper printer", group: 1 },
    { id: "export-script", label: "Export analysis script (Python)…", menu: "File", run: h.exportScript, group: 1 },
    { id: "export-repro", label: "Export reproducibility bundle…", menu: "File", run: h.exportRepro, group: 1 },
    { id: "new-project", label: "New project", menu: "File", shortcut: "Ctrl+N", combo: "ctrl+n", run: h.newProject, group: 2 },
    // Same creator card menu as Graph → "New graph…" — the dialog opens data-first
    // (pick the datasheet shape → suggested graphs), so it is the dataset creator.
    // Note: deliberately the same command as Graph ▸ "New graph…" — one dialog, two entry points.
    // The label names both outcomes because the dialog produces either: it opens data-first
    // (pick the datasheet shape → the graphs it supports), and can finish at a bare table.
    // Someone starting a piece of work looks in File; someone who wants a picture looks in
    // Graph; neither should have to know they are the same thing.
    { id: "new-dataset-dialog", label: "New datasheet / graph…", menu: "File", run: h.newGraphDialog, keywords: "new create datasheet table graph chart creator dataset", group: 2 },
    // Edit
    { id: "undo", label: "Undo", menu: "Edit", shortcut: "Ctrl+Z", combo: "ctrl+z", run: h.undo, enabled: h.canUndo, skipInInputs: true, group: 0 },
    { id: "redo", label: "Redo", menu: "Edit", shortcut: "Ctrl+Y", combo: "ctrl+y", run: h.redo, enabled: h.canRedo, skipInInputs: true, group: 0 },
    // Datasheet clipboard, mirroring the grid's right-click. The grid owns the actual Ctrl+C/X/V
    // (ClipboardEvent) — so these carry the shortcut hint but no `combo`, or the global handler
    // would fire a second copy/clear/paste on every keystroke. Copy needs only a selection; Cut
    // and Paste also need an editable (non-frozen) table.
    { id: "copy-cells", label: "Copy", menu: "Edit", shortcut: "Ctrl+C", run: h.copyData, enabled: h.hasDataSelection, keywords: "clipboard copy cells", group: 1 },
    { id: "cut-cells", label: "Cut", menu: "Edit", shortcut: "Ctrl+X", run: h.cutData, enabled: h.canEditDataSelection, keywords: "clipboard cut cells", group: 1 },
    { id: "paste-cells", label: "Paste", menu: "Edit", shortcut: "Ctrl+V", run: h.pasteCells, enabled: h.canEditDataSelection, keywords: "clipboard paste cells", group: 1 },
    // Insert
    { id: "new-dataset", label: "New datasheet (XY)", menu: "Insert", run: h.newDataset, keywords: "table datasheet dataset", group: 0 },
    // One table per remaining format — data-driven from the table-format registry so
    // the menu can never drift from the supported set. These nest under a single
    // "New table" row: the guided path (icons, descriptions, "your data" badge) is
    // File → "New datasheet / graph…", so one top-level row per format would add height and
    // nothing else.
    ...tableFormatList()
      .filter((f) => f.kind !== "xy")
      .map((f) => ({
        id: `new-table-${f.kind}`,
        label: `${f.label} table`,
        menu: "Insert" as const,
        submenu: NEW_TABLE_SUBMENU,
        run: () => h.newTable(f.kind),
        keywords: "new create datasheet",
        group: 0,
      })),
    { id: "new-layout", label: "New layout", menu: "Insert", run: h.newLayout, group: 1 },
    // Data — everything that reshapes a table, in one place, rather than split between
    // Analyze (transpose/extract/prune/…) and Insert (reshape/duplicate). Analyze answers
    // a question about the data; Data changes the shape of the table.
    // Excluding a value is a data act — the number stays in the sheet, it just stops
    // feeding graphs and statistics. Registered here (rather than living only in the
    // grid's right-click menu) so it appears in the menu bar, the command palette and on
    // a shortcut, like every other command.
    { id: "exclude-values", label: "Exclude selected values", menu: "Data", shortcut: "Ctrl+\\", combo: "ctrl+\\", run: h.excludeValues, enabled: h.hasDataSelection, keywords: "omit ignore outlier exclude remove from analysis", group: 0 },
    { id: "include-values", label: "Include selected values", menu: "Data", shortcut: "Ctrl+Shift+\\", combo: "ctrl+shift+\\", run: h.includeValues, enabled: h.hasDataSelection, keywords: "restore put back un-exclude include", group: 0 },
    { id: "transform", label: "Transform values…", menu: "Data", run: h.transformData, keywords: "functions of Y X log reciprocal", group: 0 },
    { id: "colmath", label: "Remove baseline & column math…", menu: "Data", run: h.colMath, keywords: "subtract divide normalize", group: 0 },
    { id: "rowstats", label: "Row statistics…", menu: "Data", run: h.rowStats, keywords: "mean SD SEM per row", group: 0 },
    { id: "frequency", label: "Frequency distribution…", menu: "Data", run: h.frequencyData, keywords: "histogram bins cumulative", group: 0 },
    { id: "qqplot", label: "Normal probability (QQ) plot…", menu: "Data", run: h.qqData, keywords: "quantile normality", group: 0 },
    { id: "prune", label: "Prune rows…", menu: "Data", run: h.pruneData, keywords: "thin first last range subset", group: 1 },
    { id: "extract", label: "Extract & rearrange columns…", menu: "Data", run: h.extractData, group: 1 },
    { id: "transpose", label: "Transpose rows and columns…", menu: "Data", run: h.transposeData, group: 1 },
    { id: "reshape", label: "Reshape data (wide ↔ long)…", menu: "Data", run: h.reshapeData, keywords: "pivot melt stack", group: 1 },
    { id: "split-text", label: "Split text column…", menu: "Data", run: h.splitText, keywords: "separate delimiter underscore text to columns", group: 1 },
    { id: "find-replace", label: "Find & replace…", menu: "Data", run: h.findReplace, enabled: h.canFindReplace, keywords: "search substitute rename recode", group: 1 },
    { id: "merge-data", label: "Merge datasheets…", menu: "Data", run: h.mergeData, enabled: h.canMergeData, keywords: "join combine match key lookup vlookup sample id", group: 1 },
    { id: "sort-data", label: "Sort rows by column…", menu: "Data", run: h.sortData, enabled: h.canSortData, keywords: "sort order ascending descending arrange rows", group: 1 },
    { id: "duplicate-data", label: "Duplicate datasheet", menu: "Data", run: h.duplicateData, keywords: "copy duplicate dataset", group: 1 },
    // Analyze — statistics only. The six domain entries nest under one "Common
    // analyses" row: each one just opens the Analyze dialog pre-scoped, and that
    // dialog's own landing screen is a better picker than six menu rows. Labels stay
    // short; the jargon someone would actually type lives in `keywords` so the
    // command palette still finds them.
    { id: "analyze", label: "Analyze…", menu: "Analyze", run: h.analyze, keywords: "column statistics t test ANOVA regression correlation survival ROC descriptive normality outliers", group: 0 },
    { id: "doseresponse", label: "Dose-response…", menu: "Analyze", submenu: COMMON_ANALYSES_SUBMENU, run: h.doseResponse, keywords: "EC50 IC50 sigmoid four-parameter logistic", group: 0 },
    { id: "enzyme-kinetics", label: "Enzyme kinetics…", menu: "Analyze", submenu: COMMON_ANALYSES_SUBMENU, run: h.enzymeKinetics, keywords: "Michaelis-Menten KM Vmax kcat inhibition Lineweaver-Burk", group: 0 },
    { id: "binding", label: "Receptor binding…", menu: "Analyze", submenu: COMMON_ANALYSES_SUBMENU, run: h.binding, keywords: "saturation competition Kd Bmax ligand", group: 0 },
    { id: "interpolate-curve", label: "Interpolate a standard curve…", menu: "Analyze", submenu: COMMON_ANALYSES_SUBMENU, run: h.interpolateCurve, keywords: "read unknowns ELISA standard curve", group: 0 },
    { id: "melting-temperature", label: "Melting temperature…", menu: "Analyze", submenu: COMMON_ANALYSES_SUBMENU, run: h.meltingTemperature, keywords: "Tm ΔTm thermal shift DSF protein unfolding stability DNA RNA melt curve", group: 0 },
    { id: "method-comparison", label: "Method comparison…", menu: "Analyze", submenu: COMMON_ANALYSES_SUBMENU, run: h.methodComparison, keywords: "Deming Passing-Bablok Bland-Altman agreement bias", group: 0 },
    { id: "power", label: "Sample size & power…", menu: "Analyze", run: h.powerCalc, keywords: "n per group effect size", group: 1 },
    { id: "simulate", label: "Simulate data…", menu: "Analyze", run: h.simulateData, keywords: "seeded random synthetic", group: 1 },
    { id: "montecarlo", label: "Monte-Carlo simulation…", menu: "Analyze", run: h.monteCarlo, keywords: "resampling bootstrap", group: 1 },
    // View
    // Navigation through visited tabs, deliberately in View rather than Edit: undo/redo
    // move through edits, these only change what you are looking at.
    { id: "nav-back", label: "Back", menu: "View", shortcut: "Alt+←", combo: "alt+arrowleft", run: h.navigateBack, enabled: h.canNavigateBack, keywords: "previous tab history navigate back", group: 0 },
    { id: "nav-forward", label: "Forward", menu: "View", shortcut: "Alt+→", combo: "alt+arrowright", run: h.navigateForward, enabled: h.canNavigateForward, keywords: "next tab history navigate forward", group: 0 },
    { id: "command-palette", label: "Command palette…", menu: "View", shortcut: "Ctrl+K", combo: "ctrl+k", run: h.openCommandPalette, group: 0 },
    { id: "view-lineage", label: "Lineage (provenance map)…", menu: "View", run: h.viewLineage, group: 0 },
    { id: "settings", label: "Settings — styles & preferences…", menu: "View", run: h.openSettings, group: 0 },
    { id: "zoom-in", label: "Zoom in", menu: "View", shortcut: "Ctrl++", combo: "ctrl+=", run: h.zoomIn, enabled: h.canZoomIn, group: 1 },
    { id: "zoom-out", label: "Zoom out", menu: "View", shortcut: "Ctrl+-", combo: "ctrl+-", run: h.zoomOut, enabled: h.canZoomOut, group: 1 },
    { id: "zoom-reset", label: "Reset zoom", menu: "View", shortcut: "Ctrl+0", combo: "ctrl+0", run: h.zoomReset, group: 1 },
    { id: "set-zoom", label: "Set zoom level…", menu: "View", run: h.setZoomLevel, group: 1 },
    { id: "toggle-theme", label: "Toggle light/dark", menu: "View", run: h.toggleTheme, group: 2 },
    { id: "graph-ruler", label: "Show graph ruler", menu: "View", run: h.toggleGraphRuler, checked: h.graphRulerOn, enabled: h.hasPlot, keywords: "ruler measure guides margins", group: 2 },
    { id: "color-vision", label: "Colour-blind preview", menu: "View", run: h.toggleColorVision, checked: h.colorVisionOn, enabled: h.canPreviewColor, keywords: "colour blind colorblind deuteranopia protanopia tritanopia greyscale grayscale accessibility simulate preview", group: 2 },
    { id: "layouts", label: "Layouts…", menu: "View", run: h.openLayouts, group: 3 },
    { id: "reset-layout", label: "Reset layout", menu: "View", run: h.resetLayout, group: 3 },
    { id: "reset-toolbar", label: "Reset toolbar layout", menu: "View", run: h.resetToolbar, group: 3 },
    { id: "new-graph-create", label: "New graph…", menu: "Graph", run: h.newGraphDialog, group: 0 },
    { id: "gallery", label: "Chart gallery…", menu: "Graph", run: h.openGallery, group: 0 },
    { id: "new-graph", label: "New graph of this data", menu: "Graph", run: h.newGraph, group: 1 },
    { id: "clone-graph", label: "Duplicate graph", menu: "Graph", run: h.cloneGraph, enabled: h.hasPlot, group: 1 },
    { id: "split-graph", label: "Split into small graphs (one per series)", menu: "Graph", run: h.splitGraph, enabled: h.canSplitGraph, keywords: "small multiples facet panels trellis one per series grid compare", group: 1 },
    { id: "detach-small-graph", label: "Detach small graph", menu: "Graph", run: h.detachSmallGraph, enabled: h.isSmallGraph, keywords: "small multiples unlink independent", group: 1 },
    { id: "apply-look", label: "Apply this look to other graphs", menu: "Graph", run: h.applyLook, enabled: h.hasPlot, group: 1 },
    // The clipboard route out: the graph or figure in front, as the picture the Export dialog
    // would start with (Ctrl+Shift+C — Ctrl+C stays the spreadsheet's), or as SVG markup.
    { id: "copy-picture", label: "Copy as picture", menu: "Graph", run: h.copyPicture, enabled: h.canCopyPicture, shortcut: "Ctrl+Shift+C", combo: "ctrl+shift+c", keywords: "clipboard png image paste powerpoint word slide copy graph", group: 2 },
    { id: "copy-svg", label: "Copy as SVG", menu: "Graph", run: h.copySvg, enabled: h.canCopyPicture, keywords: "clipboard vector svg markup copy graph", group: 2 },
    // Design — everything you draw on top of a chart. One registry; the menu bar, the
    // flat command palette and the toolbar popover are all surfaces over this list.
    { id: "design-sig-brackets", label: "Significance brackets from an analysis…", menu: "Design", run: h.bracketsFromAnalysis, enabled: h.canBracket && h.hasPairwiseAnalysis, keywords: "star asterisk p-value comparison significant bracket", group: 0 },
    { id: "design-sig-letters", label: "Significance letters (CLD) from an analysis…", menu: "Design", run: h.lettersFromAnalysis, enabled: h.canBracket && h.hasPairwiseAnalysis, keywords: "compact letter display significance groups", group: 0 },
    { id: "design-sig-bracket", label: "Add a blank significance bracket", menu: "Design", run: () => h.addAnnotation("bracket"), enabled: h.canBracket, keywords: "star asterisk significance bracket manual", group: 0 },
    { id: "design-sig-options", label: "Significance thresholds & labels…", menu: "Design", run: h.openSignificanceOptions, enabled: h.canBracket, keywords: "alpha cutoff threshold symbol stars ns significance", group: 0 },
    { id: "design-text", label: "Text box", menu: "Design", run: () => h.addAnnotation("text"), enabled: h.canAnnotate, keywords: "label annotate caption", group: 1 },
    { id: "design-arrow", label: "Arrow", menu: "Design", run: () => h.addAnnotation("arrow"), enabled: h.canAnnotate, keywords: "pointer annotate", group: 1 },
    { id: "design-segment", label: "Line", menu: "Design", run: () => h.addAnnotation("segment"), enabled: h.canAnnotate, keywords: "rule stroke annotate", group: 1 },
    { id: "design-rect", label: "Box", menu: "Design", run: () => h.addAnnotation("rect"), enabled: h.canAnnotate, keywords: "rectangle frame annotate", group: 1 },
    { id: "design-highlight", label: "Highlight", menu: "Design", run: () => h.addAnnotation("highlight"), enabled: h.canAnnotate, keywords: "shade region annotate", group: 1 },
    { id: "design-ellipse", label: "Ellipse", menu: "Design", run: () => h.addAnnotation("ellipse"), enabled: h.canAnnotate, keywords: "circle oval annotate", group: 1 },
    { id: "design-callout", label: "Callout", menu: "Design", run: () => h.addAnnotation("callout"), enabled: h.canAnnotate, keywords: "speech pointer annotate", group: 1 },
    { id: "design-hline", label: "Horizontal reference line", menu: "Design", run: () => h.addAnnotation("hline"), enabled: h.canAnnotate, keywords: "threshold baseline annotate", group: 1 },
    { id: "design-vline", label: "Vertical reference line", menu: "Design", run: () => h.addAnnotation("vline"), enabled: h.canAnnotate, keywords: "threshold marker annotate", group: 1 },
    { id: "design-vband", label: "Vertical band", menu: "Design", run: () => h.addAnnotation("vband"), enabled: h.canAnnotate, keywords: "shade region annotate", group: 1 },
    { id: "design-hband", label: "Horizontal band", menu: "Design", run: () => h.addAnnotation("hband"), enabled: h.canAnnotate, keywords: "shade region annotate", group: 1 },
    // Help
    // Help splits three ways: how does this work · something is wrong · what is this.
    // Kept apart so someone after the version number does not have to open the whole
    // manual to find it.
    // Note: About stays last — that is where every desktop app puts it, and a menu that files
    // it anywhere else costs the user a read of the whole list.
    { id: "welcome", label: "Welcome page", menu: "Help", run: h.openWelcome, keywords: "home start landing welcome getting started gallery documentation new project", group: 0 },
    // F1 is where every desktop program puts its manual, and it is the one shortcut a user
    // tries before looking for a menu. `guide.test.ts` requires it in the key table too.
    { id: "guide", label: "Documentation", menu: "Help", shortcut: "F1", combo: "f1", run: h.openGuide, keywords: "help manual guide docs documentation how to getting started shortcuts reference index where is", group: 0 },
    // The walkthroughs, run in the program: the window dims, the next control lights up, and the
    // step completes when the document shows it was done (`tour.ts`). One row per tour, nested
    // under one parent so the Help menu stays six lines long.
    ...TOURS.map((t) => ({
      id: `tour-${t.id}`,
      label: t.label,
      menu: "Help" as const,
      submenu: GUIDED_TOURS_SUBMENU,
      run: () => h.startTour(t.id),
      keywords: `tour tutorial walkthrough guided learn beginner show me step by step ${t.summary}`,
      group: 0,
    })),
    { id: "save-manual", label: "Save the manual…", menu: "Help", run: h.saveManual, keywords: "manual documentation html offline save export print read pdf", group: 0 },
    { id: "report-bug", label: "Report a bug…", menu: "Help", run: h.reportBug, keywords: "feedback issue crash problem diagnostics report send", group: 0 },
    { id: "about", label: "About MadY", menu: "Help", run: h.openAbout, keywords: "about version licence license copyright credits author cite citation updates build", group: 0 },
  ];
}

const MOD_KEYS = new Set(["control", "shift", "alt", "meta"]);

/** Canonical combo string for a keyboard event (Ctrl and Cmd both → "ctrl"). */
export function eventCombo(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push("ctrl");
  if (e.shiftKey) parts.push("shift");
  if (e.altKey) parts.push("alt");
  const key = e.key.toLowerCase();
  if (!MOD_KEYS.has(key)) parts.push(key);
  return parts.join("+");
}

/** True when focus is in a text-editing surface (so we don't hijack undo/copy). */
export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable === true;
}

/** Resolve a keyboard event to an action (honouring enabled + skipInInputs). */
export function matchShortcut(actions: AppAction[], e: KeyboardEvent): AppAction | undefined {
  const combo = eventCombo(e);
  // Ctrl+Shift+Z is a common "redo" alias.
  const alias = combo === "ctrl+shift+z" ? "ctrl+y" : combo;
  const action = actions.find((a) => a.combo === combo || a.combo === alias);
  if (!action || action.enabled === false) return undefined;
  if (action.skipInInputs && isEditableTarget(e.target)) return undefined;
  return action;
}
