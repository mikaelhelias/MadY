import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { GALLERY_EXPERIMENT, hasOwnWork, isDemoOnlySnapshot } from "./demoSession";
import { roseDirectionMove, roseDirectionRename } from "./roseLabels";
import { oncoprintLabelMove, oncoprintRename } from "./oncoprintLabels";
import { barWidthFromDrag } from "./barWidth";
import { legendLooseSet } from "./legendLoose";
import { applyAnalysisFit } from "./analysisFits";
import { typedFitParamLines } from "./fitParams";
import type { ReactNode } from "react";
import { analysisToMethod, annotationRenamePatch, applyKindHouseDefaults, bracketGeometry, compileNL, createSampleDocument, dataAxisOf, DEMO_FOLDER, executeAgentBatch, extractPicks, MadyDocument, methodApplyParams, methodToFile, migrate, ordinationGraphPlan, parseLinkedText, parseMethodFile, residualDiagnostics, resolveOverlays, splitRefusal, tableDatasets, tableFormat, xColumn } from "@mady/core";
import type { AgentResult, AlignOp, Annotation, AnalysisParams, AnalysisResult, AxisSpec, BarLayout, BarShape, BoxWhisker, CellPattern, CellValue, ColumnType, DataTable, EntryMode, ErrorBarType, FigureLayout, FontElement, FontSpec, FrameStyle, GridStyle, LegendSpec, LogEntry, NLContext, NLResult, NodeId, OrdinationData, PcaGraphData, Plot, PlotKind, Project, SavePick, SeriesStyle, SignificanceStyle, StylePreset, SurvivalCurve, SurvivalAtRisk, SurvivalTimeUnit, SymbolShape, TableKind, TickDir, VarpartData, WorkspaceRef } from "@mady/core";
import { buildPlotScene, defaultTitleAngle, normalizeAngle, PALETTES, splitPins } from "@mady/graphics";
import { fitFigureSize, type FigureSize } from "./figureFit";
import { graphDisplayScale } from "./graphDisplay";
import { isFactoryLadder } from "./ThresholdLadder";
import { getAppDefaults, getProfileDefault, resolveDateOrder, setAppDefaults, setProfileDefault } from "./profile";
import { applyPresetWithKindDefaults, applyUserPresetWithKindDefaults, seedPlotStyle } from "./seedStyle";
import type { ProfileDefault } from "./profile";
import { deleteUserPreset, duplicateUserPreset, listUserPresets, removeUserPresetKind, renameUserPreset, reorderUserPresets, saveUserPreset, setUserPresetKind } from "./userPresets";
import { captureKindSection, captureSharedStyle } from "./presetKeys";
import type { UserPreset } from "./userPresets";
import { capturePlotStyle } from "./templates";
import { scatterSummaryPair } from "./columnScatterSummary";
import { applyCardLook, sameGalleryLook } from "./gallery";
import type { AutosaveSnapshot, ExportPayload, FileOpenResponse, ModelStatusResponse, RecentEntry } from "../../../preload";
import { buildSnapshot, projectName, resolveAutosave } from "./autosave";
import { RecoveryDialog } from "./RecoveryDialog";
import { AnalyzeDialog, VARIANTS } from "./AnalyzeDialog";
import type { AnalyzeSpec } from "./AnalyzeDialog";
import { NewGraphDialog } from "./NewGraphDialog";
import { SettingsDialog } from "./SettingsDialog";
import { ApplyLookDialog } from "./ApplyLookDialog";
import { BugReportDialog } from "./BugReportDialog";
import { BUG_REPORT_EVENT, noteDocVersion, recordEngineCall, type AttachedAnalysis, type BugPrefill } from "./bugReport";
import { suggestAnalysisSteps, suggestCurveModels, suggestNextSteps } from "./assistant";
import type { CurveModelRecommendation, Suggestion } from "./assistant";
import { createNewGraph, fileCreatedGraph, genreByKey } from "./newGraph";
import type { NewGraphSpec } from "./newGraph";
import { analysesBoundTo, buildLetterAnnotations, buildPcaScorePlot, defaultAnalysisName, planAnalysisMarkers, significantPairs } from "./analysis";
import type { PcaScores } from "./analysis";
import { LogDrawer, MenuBar, StatusBar, Toolbar } from "./chrome";
import { Navigator } from "./Navigator";
import { NlCommandBar, type NlRunOutcome } from "./NlCommandBar";
import { ModelBar } from "./ModelBar";
import { TourOverlay } from "./TourOverlay";
import { needMet, TOUR_SAMPLE_TSV, tourById, type TourId, type TourPerform, type TourReach, type TourState } from "./tour";
import { ModelButton, ModelSetupDialog, setupBridgeFromWindow } from "./ModelSetup";
import { describeCommand } from "./describeCommand";
import { ManualPopup } from "./ManualPopup";
import { DocumentArea } from "./DocumentArea";
import { COLOR_VISION_NAME, PanelBuilderView, useColorVisionPref, useGraphRulerPref } from "./panes";
import { ColorVisionDefs } from "./ColorVisionDefs";
import { unresolvedTarget } from "@mady/core";
import { cellsInBounds, parseClipboard, serializeCells } from "./DataGrid";
import { Inspector, type SmallGraphNotice } from "./Inspector";
import { SaveDialog } from "./SaveDialog";
import type { SaveFolderNode, SaveItem } from "./SaveDialog";
import { ImportDialog } from "./ImportDialog";
import type { ImportResult, ImportSource } from "./ImportDialog";
import { GgplotImportDialog } from "./GgplotImportDialog";
import type { GgplotImportResult, GgplotImportSource } from "./GgplotImportDialog";
import { applyGgplotImport, ggplotImportLogDetail } from "./ggplotApply";
import { ReshapeDialog } from "./ReshapeDialog";
import type { ReshapeResult } from "./ReshapeDialog";
import { RowStatsDialog } from "./RowStatsDialog";
import type { RowStatsResult } from "./RowStatsDialog";
import { PruneDialog } from "./PruneDialog";
import type { PruneResult } from "./PruneDialog";
import { ColMathDialog } from "./ColMathDialog";
import type { ColMathResult } from "./ColMathDialog";
import { TransposeDialog } from "./TransposeDialog";
import type { TransposeResult } from "./TransposeDialog";
import { SortDialog } from "./SortDialog";
import { ExtractDialog } from "./ExtractDialog";
import type { ExtractResult } from "./ExtractDialog";
import { MergeDialog } from "./MergeDialog";
import { BOX_SELECT_KINDS, cellsOfPoints, highlightNamesFor, rowsOfPoints } from "./boxSelect";
import type { PickedPoint } from "./boxSelect";
import type { LegendDock } from "./legendDock";
import { legendRowEdit } from "./legendRename";
import type { MergeResult } from "./MergeDialog";
import { SplitDialog } from "./SplitDialog";
import type { SplitResult } from "./SplitDialog";
import { FindReplaceDialog } from "./FindReplaceDialog";
import type { FindReplaceResult } from "./FindReplaceDialog";
import { TransformDialog } from "./TransformDialog";
import type { TransformResult } from "./TransformDialog";
import { FrequencyDialog } from "./FrequencyDialog";
import type { FrequencyResult } from "./FrequencyDialog";
import { QQDialog } from "./QQDialog";
import type { QQResultPayload } from "./QQDialog";
import { SimulateDialog } from "./SimulateDialog";
import type { SimulateResult } from "./SimulateDialog";
import { PowerDialog } from "./PowerDialog";
import { MonteCarloDialog } from "./MonteCarloDialog";
import { ExportDialog, activeGraphSvg, composeActiveFigureSvg } from "./ExportDialog";
import { copyAsPicture, copyAsSvg } from "./copyPicture";
import { ExportAllDialog, type ExportAllOptions } from "./ExportAllDialog";
import { ExportStage } from "./ExportStage";
import { runBatchExport, type BatchItem, type BatchResult, type MountedItem } from "./batchExport";
import { pickImageDataUrl, imageInsertBox } from "./imageInsert";
import { browserDownload, serializeGraphSvg, tableToPrintHtml, type SerializedSvg } from "./exporters";
import { AUTOSAVE_FAIL_THRESHOLD, exportErrorMessage, nextAutosaveFailures, readErrorMessage, saveErrorMessage } from "./ioFeedback";
import { ZoomDialog } from "./ZoomDialog";
import { CommandPalette } from "./CommandPalette";
import { analysisResultGrid, analysisToCsv, excelSheetName, fitEquationLabel, fitOverlayTarget, keyMetricLine } from "./analysisExport";
import { buildActions, matchShortcut } from "./actions";
import { buildPythonScript } from "./scriptExport";
import { buildReproBundle } from "./reproBundle";
import type { GraphView } from "./DocumentArea";
import type { GuideTarget } from "./GuidePane";
import { GUIDE_OPEN_EVENT } from "./guideLink";
import type { TextTarget } from "./PlotFigure";
import { canZoom, clampZoom, zoomStep } from "./zoom";
import { clearToolbarGroups, DEFAULT_TOOLBAR_GROUPS, loadToolbarGroups, reorderGroups, reorderWithinGroup, saveToolbarGroups } from "./toolbar";
import type { ToolbarGroupName, ToolbarItemId } from "./toolbar";
import { Dock, ResizeDivider } from "./Dock";
import { LayoutMenu } from "./LayoutMenu";
import type { DockId, DockLayout, LayoutPreset, SideDockId } from "./layout";
import { excludedCount, STYLE_PRESETS } from "@mady/core";
import {
  addPreset,
  applyPreset,
  BUILTIN_PRESETS,
  DEFAULT_LAYOUT,
  deletePreset,
  loadLayout,
  loadUserPresets,
  RAIL_WIDTH,
  reorderDocks,
  saveLayout,
} from "./layout";
import { useEffectEvent } from "react";
import { assertAnalysisResult } from "@mady/contracts";

export type Theme = "light" | "dark";

/** A pane group (left-nav section + tab cluster). */
export type Section = "data" | "results" | "graphs" | "docs" | "layouts";

/** The kind of object a tab shows. */
export type TabKind = "table" | "plot" | "analysis" | "docs" | "layout" | "gallery" | "lineage" | "guide" | "about" | "licence" | "welcome" | "tours";

/** An open document tab — a reference to a real object (or a singleton view). */
export interface OpenTab {
  /** Unique key, e.g. `table:tbl_1`, `docs:fld_1`, `results`. */
  key: string;
  kind: TabKind;
  /** Entity / folder id (absent for singletons like `results`). */
  id?: NodeId | undefined;
}

/** What's selected on the active graph (for the inspector). */
export type GraphSelection =
  | { kind: "plot" }
  /** "z" exists only on the 3-D scatter (`plot.zAxis`); no 2-D kind emits or renders it. */
  /** `focus`: what on the axis was clicked — its label text ("labels": category names → the Fonts
   *  section) or its numbers ("numbers": a value axis's tick numbers → the Numbering section). */
  | { kind: "axis"; axis: "x" | "y" | "y2" | "y3" | "z"; focus?: "labels" | "numbers" }
  | { kind: "series"; columnId: NodeId; part?: "points" | "line"; rowId?: NodeId }
  | { kind: "pie-slice"; datasetId: NodeId }
  /** One Venn set (its disc / label) — routes to that set's colour panel. */
  | { kind: "venn-set"; datasetId: NodeId }
  /** One UpSet set (its size bar / matrix row label) — same colour panel. */
  | { kind: "upset-set"; datasetId: NodeId }
  | { kind: "treemap-cell"; cellId: NodeId }
  | { kind: "network-node"; nodeId: string }
  /** One network link (edge key `source→target`) — style it alone or push to all links. */
  | { kind: "network-edge"; edgeId: string }
  /** One parallel-coordinates line (its source row id) — recolour that case alone. */
  | { kind: "parallel-line"; rowId: NodeId }
  /** One parallel-coordinates axis (its source column id) — its own tick settings. Reached by
   *  clicking the variable name: the axis line itself already owns drag-to-brush and
   *  click-to-clear-brush, and taking that click would break a documented gesture. */
  | { kind: "parallel-axis"; colId: NodeId }
  | { kind: "alluvial-node"; axis: number; category: string }
  | { kind: "heatmap-cell"; row: number; col: number }
  /** One heatmap split — the break after row/column `at`. Its own kind rather than
   *  `chart-section`, because the panel has to highlight that break's row: a break is an object
   *  the user placed, and clicking it must open the row that edits it, not just the section. */
  | { kind: "heatmap-split"; axis: "row" | "col"; at: number }
  /** One annotation strip (its position in `rowTracks` / `colTracks`) — same reason. */
  | { kind: "heatmap-track"; axis: "row" | "col"; index: number }
  | { kind: "corr-cell"; row: number; col: number }
  | { kind: "annotation"; id: NodeId }
  /**
   * One builder-made reference line (`refLines.ts` holds the registry): a Bland-Altman
   * limit, the forest no-effect line, the PCA origin cross, the ROC chance diagonal, the
   * paired-dot section rules…
   *
   * Its own kind rather than `annotation`, because it is not one: it has no entry in
   * `plot.annotations` (the builder recomputes it from the data every rebuild), so the
   * annotation panel looked it up, found nothing, and printed "This annotation was removed"
   * — a dead end on six chart kinds. Two of these ids are not even scene annotations (the
   * ROC diagonal is a series, the paired-dot dividers are chart geometry), and they are the
   * same object to the user, so one kind covers all of them.
   */
  | { kind: "refline"; id: string }
  /**
   * A chart section, opened by clicking something whose appearance is decided there rather
   * than on an object of its own: a volcano legend row ("Up-regulated" — the three zone
   * colours are `volcano.upColor`/`downColor`/`nsColor`), a treemap region, a
   * parallel-coordinates group. `title` is the section's own heading, e.g. "Volcano".
   *
   * This is the accurate target for a legend row that names a group. The alternatives are
   * both worse: selecting the whole graph (which selects nothing useful), inventing a
   * per-group object the builder does not have, or leaving the row inert so the user has to
   * find the section themselves.
   */
  | { kind: "chart-section"; title: string }
  /** Multi-object annotation selection (shift-click) — drives the Arrange toolbar. */
  | { kind: "annotations"; ids: NodeId[] }
  | { kind: "bubble-legend" }
  | { kind: "colorbar" }
  | null;

/** Undoable spreadsheet edits for the data grid, bound at the table level. */
export interface TableOps {
  editCell: (tableId: NodeId, rowIndex: number, colIndex: number, value: CellValue) => void;
  renameColumn: (tableId: NodeId, columnId: NodeId, name: string) => void;
  addColumn: (tableId: NodeId) => void;
  paste: (tableId: NodeId, rowStart: number, colStart: number, block: CellValue[][]) => void;
  clearCells: (tableId: NodeId, rowStart: number, colStart: number, rows: number, cols: number) => void;
  fillDown: (tableId: NodeId, rowStart: number, colStart: number, rows: number, cols: number) => void;
  transpose: (tableId: NodeId, rowStart: number, colStart: number, rows: number, cols: number) => void;
  /** Set the table-wide replicate count (subcolumns per Y dataset). */
  setReplicates: (tableId: NodeId, count: number) => void;
  /** Set the table's data-entry mode (replicates vs Mean+SD/SEM+N). */
  setEntryMode: (tableId: NodeId, mode: EntryMode) => void;
  /** Toggle the shared X-error subcolumn (XY tables). */
  setXError: (tableId: NodeId, on: boolean) => void;
  /** Survival tables: switch time entry between elapsed and start/end dates. */
  setSurvivalDates: (tableId: NodeId, on: boolean) => void;
  /** Survival date entry: unit the elapsed span is computed in. */
  setSurvivalTimeUnit: (tableId: NodeId, unit: SurvivalTimeUnit) => void;
  /** Set a column's cell type (number/text/date/elapsed/categorical). */
  setColumnType: (tableId: NodeId, columnId: NodeId, type: ColumnType | undefined) => void;
  /** Set a number column's fixed display decimals (undefined = auto-trim). */
  setColumnDecimals: (tableId: NodeId, columnId: NodeId, decimals: number | undefined) => void;
  /** Set (or clear) a column's calculated-variable formula. */
  setColumnFormula: (tableId: NodeId, columnId: NodeId, formula: string | undefined) => void;
  /** Freeze/unfreeze the table (read-only when frozen). */
  setFrozen: (tableId: NodeId, frozen: boolean) => void;
  /** Reinterpret the table as a different table format (kind). */
  setTableKind: (tableId: NodeId, kind: TableKind) => void;
  /** Exclude/include a set of cells (kept but omitted from analyses/graphs). */
  setExcluded: (tableId: NodeId, cells: ReadonlyArray<{ rowId: NodeId; colId: NodeId }>, excluded: boolean) => void;
  /** Set (or clear, color=null) the background colour of a set of cells (purely visual). */
  setCellFills: (tableId: NodeId, cells: ReadonlyArray<{ rowId: NodeId; colId: NodeId }>, color: string | null) => void;
  setCellPatterns: (tableId: NodeId, cells: ReadonlyArray<{ rowId: NodeId; colId: NodeId }>, pattern: CellPattern | null) => void;
  /** Insert a blank row at `index` (shifts later rows down). */
  insertRow: (tableId: NodeId, index: number) => void;
  /** Delete the row at `index`. */
  deleteRow: (tableId: NodeId, index: number) => void;
  /** Insert a blank column at `index` (shifts later columns right). */
  insertColumn: (tableId: NodeId, index: number) => void;
  /** Delete the column at `index`. */
  deleteColumn: (tableId: NodeId, index: number) => void;
  /** Delete several columns at once (a grouped dataset = lead + subcolumns). */
  deleteColumns: (tableId: NodeId, indices: number[]) => void;
  /** Move the row at `from` to index `to` (drag-reorder). */
  moveRow: (tableId: NodeId, from: number, to: number) => void;
  /** Move the column at `from` to index `to` (drag-reorder). */
  moveColumn: (tableId: NodeId, from: number, to: number) => void;
  /** "Use as X axis": re-tag + move to index 0 in one undoable command. */
  setXColumn: (tableId: NodeId, index: number) => void;
  /** Sort every row by one column's values (ascending / descending). */
  sortRowsByColumn: (tableId: NodeId, colId: NodeId, direction: "asc" | "desc") => void;
}

/** Handlers for the figure assembler (LayoutPane). */
export interface LayoutOps {
  /** Add a graph as a panel of a layout. */
  addPanel: (layoutId: NodeId, plotId: NodeId) => void;
  /** Remove a graph panel from a layout. */
  removePanel: (layoutId: NodeId, plotId: NodeId) => void;
  /** Duplicate a panel in place (linked figure → a real filed copy of the graph). */
  duplicatePanel: (layoutId: NodeId, plotId: NodeId) => void;
  /** Add a picture panel (kind "image") to a figure and file it as a panel. The natural
   *  pixel size (when the picker could read it) feeds crop/rotate's aspect math. */
  addImagePanel: (layoutId: NodeId, name: string, src: string, alt?: string | undefined, naturalW?: number | undefined, naturalH?: number | undefined) => void;
  /** Edit a layout's arrangement (columns / gutter / lettering). */
  setOptions: (layoutId: NodeId, patch: Partial<FigureLayout>) => void;
  /** Match one captured style across many panels (auto-scale / homogenise). */
  matchStyles: (plotIds: NodeId[], style: Partial<Plot>, keys: (keyof Plot)[]) => void;
  /** Link / unlink a figure from its source graphs (unlinked = independent clones). */
  setLinked: (layoutId: NodeId, linked: boolean) => void;
  /** Add a figure object (text/arrow/line/box/ellipse drawn on the canvas);
   *  returns it so the assembler can select it for immediate editing. */
  addAnnotation: (layoutId: NodeId, ann: Omit<Annotation, "id">) => Annotation | undefined;
  /** Drag-move/resize a figure object (canvas px; one undo per drag). */
  moveAnnotation: (layoutId: NodeId, id: NodeId, patch: Partial<Pick<Annotation, "x" | "y" | "x2" | "y2" | "w" | "h" | "rotation">>) => void;
  /** Restyle / relabel a figure object. */
  updateAnnotation: (layoutId: NodeId, id: NodeId, patch: Partial<Omit<Annotation, "id" | "kind">>) => void;
  /** Delete a figure object. */
  removeAnnotation: (layoutId: NodeId, id: NodeId) => void;
}

export const TAB_GROUP: Record<TabKind, Section> = {
  table: "data",
  analysis: "results",
  plot: "graphs",
  docs: "docs",
  layout: "layouts",
  gallery: "graphs",
  lineage: "graphs",
  guide: "docs",
  about: "docs",
  licence: "docs",
  welcome: "docs",
  tours: "docs",
};

const tabKey = (kind: TabKind, id?: NodeId): string => (id ? `${kind}:${id}` : kind);

/** Human title for a tab, resolved live from the document. */
export function tabTitle(project: Project, tab: OpenTab): string {
  switch (tab.kind) {
    case "table":
      return project.tables.find((t) => t.id === tab.id)?.name ?? "Data";
    case "plot":
      return project.plots.find((p) => p.id === tab.id)?.name ?? "Graph";
    case "docs":
      return `${project.workspace.folders.find((f) => f.id === tab.id)?.name ?? "Project"} — Docs`;
    case "analysis":
      return project.analyses.find((a) => a.id === tab.id)?.name ?? "Analysis";
    case "layout":
      return project.layouts?.find((l) => l.id === tab.id)?.name ?? "Figure";
    case "gallery":
      return "Chart gallery";
    case "tours":
      return "Guided tours";
    case "lineage":
      return "Lineage";
    case "guide":
      return "Docs";
    case "about":
      return "About";
    case "licence":
      return "Licence";
    case "welcome":
      return "Welcome";
  }
}

/** Name of one savable object, or undefined if the ref dangles. */
function objectName(project: Project, kind: SaveItem["kind"], id: NodeId): string | undefined {
  if (kind === "table") return project.tables.find((t) => t.id === id)?.name;
  if (kind === "plot") return project.plots.find((p) => p.id === id)?.name;
  if (kind === "analysis") return project.analyses.find((a) => a.id === id)?.name;
  return project.layouts?.find((l) => l.id === id)?.name;
}

/** The Save dialog's pickable tree: the workspace exactly as the Navigator files it —
 *  project folders → experiments → objects, plus anything left at the top level. Refs
 *  whose entity is gone are dropped (an unsavable row is worse than no row). */
export function saveTree(project: Project): { folders: SaveFolderNode[]; loose: SaveItem[] } {
  const items = (refs: readonly WorkspaceRef[]): SaveItem[] =>
    refs.flatMap((r) => {
      const name = objectName(project, r.kind, r.id);
      return name ? [{ kind: r.kind, id: r.id, name }] : [];
    });
  return {
    folders: project.workspace.folders.map((f) => ({
      id: f.id,
      name: f.name,
      members: items(f.members),
      experiments: f.experiments.map((e) => ({ id: e.id, name: e.name, members: items(e.members) })),
    })),
    loose: items(project.workspace.loose),
  };
}

/** Display name for a single pick — the suggested file name when saving one part. */
export function savePickName(project: Project, pick: SavePick): string | undefined {
  if (pick.level === "folder") return project.workspace.folders.find((f) => f.id === pick.id)?.name;
  if (pick.level === "experiment")
    return project.workspace.folders.flatMap((f) => f.experiments).find((e) => e.id === pick.id)?.name;
  return objectName(project, pick.kind, pick.id);
}

/** Seed a freshly-created plot from the user's profile default for this graph type
 *  (a per-type override, else the global default — a built-in or custom preset), then
 *  layer on the global common params. No-op when the type resolves to "None". */
function seedNewPlot(d: MadyDocument, plotId: NodeId, kind: PlotKind | undefined): void {
  /**
   * The style half lives in `seedStyle.ts` and is shared with the chart gallery's
   * cards — one function, so a card can never preview a different look than creating
   * that graph produces. Only the significance stamp below is creation-only.
   */
  seedPlotStyle(d, plotId, kind);
  // The significance ladder is stamped at creation, not read at render: a .mady file
  // then carries its own vocabulary, so a figure never changes because a setting moved
  // under it, and a panel needs no synchronisation. Only stamped when it differs from the
  // built-in ladder, so an untouched install keeps documents clean.
  const app = getAppDefaults();
  if (app.significanceThresholds !== undefined && !isFactoryLadder(app.significanceThresholds)) {
    d.setSignificance(plotId, { thresholds: app.significanceThresholds });
  }
  if (app.significanceNsSymbol) d.setSignificance(plotId, { nsSymbol: app.significanceNsSymbol });
}

/** Which live width-drag command a plot kind maps to:
 *  bar & histogram resize the plot-wide bar-fill fraction (`barWidth`); the distribution
 *  kinds (box/violin/raincloud/floatingbar) resize the per-series box/cloud (`boxWidth`).
 *  Any other kind renders no width handle, so it must not route (returns null). */
export function widthResizeTarget(kind: PlotKind | undefined): "bar" | "box" | null {
  // upset: the intersection bars are the bar builder's own, and `barWidth` reaches them.
  if (kind === "bar" || kind === "histogram" || kind === "upset") return "bar";
  if (kind === "box" || kind === "violin" || kind === "raincloud" || kind === "floatingbar") return "box";
  return null;
}

/** The ordination graphs "Plot PCA graphs" builds from a PCA analysis, in order:
 *  scores, loadings, biplot (scores + scaled loading vectors), scree. Without the biplot
 *  here, pcabiplot would be unreachable from a real analysis. */
export const PCA_GRAPH_SUITE: { suffix: string; kind: PlotKind }[] = [
  { suffix: "scores", kind: "pcascore" },
  { suffix: "loadings", kind: "pcaload" },
  { suffix: "biplot", kind: "pcabiplot" },
  { suffix: "scree", kind: "scree" },
];

/** Persisted set of dismissed assistant-suggestion ids (ids are structural + stable per
 *  table, e.g. "analysis:<tableId>:ttest:welch"), so a dismissal survives a reload. */
const DISMISSED_TIPS_KEY = "mady.assistant.dismissed";

/** The one experiment inside the demo project that holds every opened gallery card. */
/**
 * Axis tab ▸ Title direction, from the grip on the graph: store the angle on the axis spec that owns the title
 * (the category spec is the visual Y of a flipped chart — `dataAxisOf`). The axis's own default turn is stored as
 * "no choice", and "above the axis" is let go once the title is no longer level. One undo step.
 */
export function rotateAxisTitle(d: MadyDocument, plot: Plot, axis: "y" | "y2" | "y3", angle: number): void {
  const a = normalizeAngle(angle);
  const dataAxis = axis === "y" ? dataAxisOf(plot, "y") : axis;
  d.setPlotAxis(plot.id, dataAxis, {
    titleAngle: a === defaultTitleAngle(axis === "y" ? "left" : "right") ? undefined : a,
    ...(a !== 0 ? { titleAbove: undefined } : {}),
  });
}
/** Count waffle: the caption was dragged — store where it was dropped (undoable). */
export function moveWaffleCaption(d: MadyDocument, plot: Plot, dx: number, dy: number): void {
  d.setPlotOptions(plot.id, { waffleCaptionOffset: { dx, dy } });
}
/**
 * Count waffle: the caption was edited in place. Blank, or exactly the automatic words, stores
 * nothing — the in-place editor commits even when nothing was typed, and pinning the automatic
 * words would stop the caption following the unit name and the count.
 */
export function applyWaffleCaptionEdit(d: MadyDocument, plot: Plot, text: string): void {
  const table = d.toJSON().tables.find((t) => t.id === plot.source);
  const auto = table ? buildPlotScene(table, { ...plot, waffleCaption: undefined }, { width: 400, height: 300 }).pie?.caption?.text : undefined;
  const typed = text.trim();
  d.setPlotOptions(plot.id, { waffleCaption: typed === "" || typed === auto ? undefined : text });
}
export function loadDismissedTips(): Set<string> {
  try {
    const raw = globalThis.localStorage?.getItem(DISMISSED_TIPS_KEY);
    if (raw) {
      const ids: unknown = JSON.parse(raw);
      if (Array.isArray(ids)) return new Set(ids.filter((x): x is string => typeof x === "string"));
    }
  } catch { /* unavailable / corrupt storage → start empty */ }
  return new Set();
}
export function saveDismissedTips(set: Set<string>): void {
  try { globalThis.localStorage?.setItem(DISMISSED_TIPS_KEY, JSON.stringify([...set])); } catch { /* ignore */ }
}

export function AppShell() {
  const [theme, setTheme] = useState<Theme>(() => getAppDefaults().theme ?? "light");
  // Flip + persist the choice so it survives a relaunch (Settings owns the reset).
  const toggleTheme = (): void => {
    const next: Theme = theme === "light" ? "dark" : "light";
    setTheme(next);
    setAppDefaults({ theme: next });
  };
  // Held in a ref so Open can swap the whole document.
  const docRef = useRef<MadyDocument | null>(null);
  if (!docRef.current) docRef.current = createSampleDocument();
  const doc = docRef.current;

  // Last-edited drawing-shape style, so a new shape inherits it (Format-Object defaults).
  const shapeStyleRef = useRef<Partial<Pick<Annotation, "color" | "fill" | "width" | "dash" | "arrowHead">>>({});

  // The document mutates in place; bump a version to re-render on every edit.
  // `version` doubles as the autosave change-signal (see the autosave effect).
  const [version, setVersion] = useState(0);
  const versionRef = useRef(0); // mirror of `version` readable synchronously (state is async)
  const savedVersion = useRef(0); // the version last persisted to a .mady (or loaded)
  // The launch document starts as the demo project, which is there to look around in: while it
  // holds nothing of the user's own (`hasOwnWork`), closing does not ask to save it and no crash
  // copy is kept. This ends once a project is opened or recovered, or the document is saved.
  const demoSession = useRef(true);
  const demoTableIds = useRef<ReadonlySet<NodeId> | null>(null);
  if (!demoTableIds.current) demoTableIds.current = new Set(doc.toJSON().tables.map((t) => t.id));
  const onlyExploringDemo = (): boolean => demoSession.current && !hasOwnWork(docRef.current!.toJSON(), demoTableIds.current!);
  /** Unsaved work worth asking about: changed since the last save or open, and not just the demo looked around in. */
  const hasUnsavedWork = (v: number): boolean => v !== savedVersion.current && !onlyExploringDemo();
  // The agent API bridge (agent edition build only, see `__AGENT_API__`) reads the current active graph/table through this
  // ref, refreshed every render below — so it never captures a stale selection.
  const agentActiveRef = useRef<{ tableId?: string | undefined; graphId?: string | undefined }>({});
  const bump = (): void => setVersion((v) => { versionRef.current = v + 1; return v + 1; });
  /** Mark the document clean: the current version is now the saved one. Tells main so a
   *  clean quit clears the recovery snapshot (dirty → the version effect reports true). */
  // Redraws what shows the saved state (the toolbar's unsaved dot) when a save or an open lands:
  // neither changes the version, so otherwise only an unrelated redraw would clear it.
  const [, setSavedTick] = useState(0);
  const markSaved = (): void => {
    savedVersion.current = versionRef.current;
    demoSession.current = false;
    window.mady?.setDirty?.(false);
    setSavedTick((n) => n + 1);
  };
  const project: Project = doc.toJSON();
  /** Re-make every small graph (Graph ▸ Split into small graphs) from its original after a change.
   *  An edit made directly on a small graph that is not a position or size is undone by the
   *  document — and said out loud here, never dropped in silence. */
  function syncSmallGraphs(): void {
    const refused = doc.syncSplitCopies((src, table) => splitPins(table, src));
    if (refused.length) window.alert(refused[0]);
  }
  // A pending coalesced re-render (see `mutateLive`); cancelled by any immediate `mutate`.
  const dragRaf = useRef<number | null>(null);
  function mutate(fn: (d: MadyDocument) => void): void {
    if (dragRaf.current != null) { cancelAnimationFrame(dragRaf.current); dragRaf.current = null; }
    fn(doc);
    // Keep the live Transform/derived-table chain current after any data edit.
    doc.recomputeStaleDerived();
    syncSmallGraphs();
    // …then lower the stale flag on every plot that has already caught up. A table-backed
    // figure redraws from the live document, so it is current the moment the edit lands;
    // an analysis-backed one stays flagged until its stored fit is refreshed.
    doc.refreshPlotStatus();
    bump();
  }
  /**
   * Like `mutate`, for high-frequency drag gestures. The change is applied to the document
   * immediately (so no motion is lost, the drag handlers still read a current document, and undo
   * still coalesces), but the expensive rebuild+redraw (`buildPlotScene` over every point +
   * re-rendering the SVG) is coalesced to at most once per animation frame.
   *
   * A mouse/trackpad fires pointer-moves far faster than the screen refreshes (100–240/s vs ~60);
   * without this, dragging a title on a many-point graph would rebuild the whole scene on every
   * one of them and the drag would lag. This changes only how often the figure is redrawn, never
   * what is drawn — the same full-fidelity scene renders each frame, so the graph is
   * pixel-identical; drags simply skip the 3–4× redraws the display could not show.
   */
  function mutateLive(fn: (d: MadyDocument) => void): void {
    fn(doc);
    doc.recomputeStaleDerived();
    syncSmallGraphs();
    doc.refreshPlotStatus();
    if (dragRaf.current == null) {
      dragRaf.current = requestAnimationFrame(() => {
        dragRaf.current = null;
        bump();
      });
    }
  }

  // Report unsaved-changes state to main on every edit: it keeps the crash-recovery
  // snapshot on a dirty quit and backs the unsaved-changes close guard.
  const keepCleanAfterRender = useRef(false);
  useEffect(() => {
    // A derived value (an analysis result computed on boot / open) landed on a clean document:
    // adopt this version as the saved one, so the launch does not read as unsaved work.
    if (keepCleanAfterRender.current) {
      keepCleanAfterRender.current = false;
      savedVersion.current = versionRef.current;
      setSavedTick((n) => n + 1); // the render that just ran drew the old saved state (the unsaved dot)
    }
    window.mady?.setDirty?.(hasUnsavedWork(version));
    // `version` is the change signal; `hasUnsavedWork` reads only refs and the live document.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  // Agent edition build only: expose the typed agent API on window.madyAgent. The
  // `__AGENT_API__` guard is a compile-time constant, so in the standard edition this
  // whole block (and the agentBridge import it reaches) is dead code the bundler drops —
  // the standard artifact has no agent surface at all. The `typeof` guard keeps it safe
  // under vitest, where the define is absent.
  useEffect(() => {
    if (typeof __AGENT_API__ === "undefined" || !__AGENT_API__) return;
    let dispose = () => {};
    void import("./agentBridge").then(({ installAgentBridge }) => {
      dispose = installAgentBridge(
        window as unknown as Record<string, unknown>,
        mutate,
        typeof __MADY_EDITION__ === "string" ? __MADY_EDITION__ : "Agent",
        // Read the current active selection each call (the bridge installs once) so NL
        // like "the graph" / "make a scatter" resolves against what's open right now.
        () => agentActiveRef.current,
      );
    });
    return () => dispose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The demo project ships its analyses without results (no number is typed into the
  // fixture): compute them through the engine on boot, the same path an opened .mady with
  // result-less analyses takes. No engine (browser preview, tests) → nothing happens.
  useEffect(() => {
    void fillMissingAnalysisResults();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The app opens on the Welcome page, not the demo graph — the demo project is in the
  // Navigator, folded shut, and is not what launch shows by default.
  const initial = useMemo<OpenTab[]>(() => [{ key: tabKey("welcome"), kind: "welcome" }], []);

  const [openTabs, setOpenTabs] = useState<OpenTab[]>(initial);
  const [activeKey, setActiveKey] = useState<string>(initial[initial.length - 1]?.key ?? "");
  // Browser-style back/forward across tab activations (Welcome → Chart gallery → back to
  // Welcome). Full tabs are stored, not just keys, so going back to a since-closed tab can
  // reopen it instead of landing on nothing.
  const [tabHistoryBack, setTabHistoryBack] = useState<OpenTab[]>([]);
  const [tabHistoryForward, setTabHistoryForward] = useState<OpenTab[]>([]);
  const prevActiveTabRef = useRef<OpenTab | undefined>(undefined);
  /** Set right before a back/forward navigation drives `setActiveKey`, so the effect below
   *  routes the tab being left into the opposite stack instead of treating this like a fresh
   *  visit — which would push it onto "back" again and wipe the "forward" stack. */
  const historyDirRef = useRef<"back" | "forward" | null>(null);
  // The figure assembler opens in its own full-area view (not a document tab),
  // launched from the project tree. null = the normal tabbed document area.
  const [layoutView, setLayoutView] = useState<NodeId | null>(null);
  /** A figure the program just built (Split into small graphs) opens arranged, not on "Choose graphs". */
  const [arrangeOnOpen, setArrangeOnOpen] = useState<NodeId | null>(null);
  // Which panel (plot id) is selected for editing inside the arrange view — it
  // becomes the "active plot" so the Inspector + every edit handler target it.
  const [arrangePlot, setArrangePlot] = useState<NodeId | null>(null);
  // Where the figure page draws what is picked on it (a canvas object's settings, a panel's X / Y / W / H): a place
  // at the top of the Inspector. Null while the Inspector is collapsed → the figure keeps them in its toolbar.
  const [figureInspectorEl, setFigureInspectorEl] = useState<HTMLDivElement | null>(null);
  const [bugReportOpen, setBugReportOpen] = useState(false);
  const [bugPrefill, setBugPrefill] = useState<BugPrefill | null>(null);
  const [analyzeOpen, setAnalyzeOpen] = useState(false);
  // When set, the Analyze dialog opens straight into this method/model (e.g. the
  // Dose-response door → curvefit/4pl); null = the normal method-picker landing.
  const [analyzePreset, setAnalyzePreset] = useState<{ method: string; variant?: string; focusKind?: string } | null>(null);
  const [pendingAnalyzeSuggestion, setPendingAnalyzeSuggestion] = useState<Suggestion | null>(null);
  const [newGraphOpen, setNewGraphOpen] = useState(false);
  /** The guided tour running (`TourOverlay`, steps from `TOURS`), or null. */
  const [tourId, setTourId] = useState<TourId | null>(null);
  // "New graph of this data" names the sheet to graph: the dialog opens on that table (its
  // format, first suggestion pre-selected, Data = the sheet). null = the working table.
  const [newGraphTableId, setNewGraphTableId] = useState<NodeId | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [applyLookOpen, setApplyLookOpen] = useState(false);
  /** A short on-screen confirmation ("Copied as picture"); clears itself. Screen chrome, never exported. */
  const [flash, setFlash] = useState<string | null>(null);
  // Assistant next-step suggestions the user has dismissed — persisted across reloads.
  const [dismissedTips, setDismissedTips] = useState<Set<string>>(loadDismissedTips);
  useEffect(() => saveDismissedTips(dismissedTips), [dismissedTips]);
  const [selection, setSelection] = useState<GraphSelection>(null);
  // The datasheet's selected block, published up by DataGrid. Held here so the Data menu,
  // the command palette and the keyboard shortcut can all exclude the same cells the grid
  // has highlighted — the grid's own selection state is internal to it.
  const [dataSel, setDataSel] = useState<{ tableId: NodeId; r0: number; c0: number; r1: number; c1: number } | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [importSrc, setImportSrc] = useState<ImportSource | null>(null);
  /** A ggplot script waiting in its report dialog (File ▸ Import ggplot script…). */
  const [ggplotSrc, setGgplotSrc] = useState<GgplotImportSource | null>(null);
  const [reshapeTable, setReshapeTable] = useState<DataTable | null>(null);
  const [rowStatsTable, setRowStatsTable] = useState<DataTable | null>(null);
  const [pruneTable, setPruneTable] = useState<DataTable | null>(null);
  const [colMathTable, setColMathTable] = useState<DataTable | null>(null);
  const [transposeSel, setTransposeSel] = useState<DataTable | null>(null);
  const [extractSel, setExtractSel] = useState<DataTable | null>(null);
  const [mergeSel, setMergeSel] = useState<DataTable | null>(null);
  const [splitSel, setSplitSel] = useState<DataTable | null>(null);
  const [findSel, setFindSel] = useState<DataTable | null>(null);
  const [sortSel, setSortSel] = useState<DataTable | null>(null);
  const [transformTable, setTransformTable] = useState<DataTable | null>(null);
  const [frequencyTable, setFrequencyTable] = useState<DataTable | null>(null);
  const [qqTableSel, setQqTableSel] = useState<DataTable | null>(null);
  const [simulateOpen, setSimulateOpen] = useState(false);
  const [powerOpen, setPowerOpen] = useState(false);
  const [mcOpen, setMcOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [zoomDialogOpen, setZoomDialogOpen] = useState(false);
  const [exportTarget, setExportTarget] = useState<{ kind: "plot" | "table"; source?: "graph" | "figure"; name: string; plotId?: NodeId; table?: DataTable } | null>(null);
  // Export all: the dialog, and the one graph / figure the off-screen stage is drawing during a run.
  const [exportAllOpen, setExportAllOpen] = useState(false);
  const [stageItem, setStageItem] = useState<BatchItem | null>(null);
  const stageReady = useRef<((root: HTMLElement) => void) | null>(null);
  const [recents, setRecents] = useState<RecentEntry[]>([]);
  // User style profile: the default (built-in or custom) new graphs inherit,
  // plus the user's saved custom presets (machine-local).
  const [profileDefault, setProfileDefaultState] = useState<ProfileDefault>(() => getProfileDefault());
  const [customPresets, setCustomPresets] = useState<UserPreset[]>(() => listUserPresets());
  // Crash-recovery: a snapshot the previous session left behind, plus a
  // gate so the autosave loop doesn't run until the recovery decision is made.
  const [recovery, setRecovery] = useState<AutosaveSnapshot | null>(null);
  const [autosaveReady, setAutosaveReady] = useState(false);
  // Persistent indicator when autosave has failed repeatedly:
  // a running count of consecutive failures, plus the shown/hidden flag.
  const autosaveFails = useRef(0);
  const [autosaveFailing, setAutosaveFailing] = useState(false);
  // Per-tab view zoom + per-tab graph axis-view window (both transient).
  const [zoomByTab, setZoomByTab] = useState<Record<string, number>>({});
  const [graphViewByTab, setGraphViewByTab] = useState<Record<string, GraphView>>({});
  // Customizable toolbar layout — named groups (persisted in localStorage). Groups reorder
  // as a whole; icons reorder within their group; membership is fixed.
  const [toolbarGroups, setToolbarGroups] = useState(loadToolbarGroups);
  const reorderToolbarGroups = (name: ToolbarGroupName, toIndex: number): void =>
    setToolbarGroups((prev) => {
      const next = reorderGroups(prev, name, toIndex);
      saveToolbarGroups(next);
      return next;
    });
  const reorderToolbarWithin = (name: ToolbarGroupName, fromId: ToolbarItemId, toIndex: number): void =>
    setToolbarGroups((prev) => {
      const next = reorderWithinGroup(prev, name, fromId, toIndex);
      saveToolbarGroups(next);
      return next;
    });
  const resetToolbar = (): void => {
    clearToolbarGroups();
    setToolbarGroups(DEFAULT_TOOLBAR_GROUPS.map((g) => ({ name: g.name, ids: g.ids.slice() })));
  };
  // Movable-panel layout (resize / collapse / rearrange), persisted in localStorage.
  const [layout, setLayoutState] = useState<DockLayout>(loadLayout);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const updateLayout = (next: DockLayout): void => {
    setLayoutState(next);
    saveLayout(next);
  };
  const toggleDock = (id: SideDockId): void =>
    updateLayout({ ...layout, collapsed: { ...layout.collapsed, [id]: !layout.collapsed[id] } });
  /**
   * Force a side dock open. It is idempotent by design.
   *
   * Do not express this as `toggleDock` from an effect. React StrictMode (on in
   * `main.tsx`) double-invokes effects in development, so a toggle would run twice — open,
   * then shut — and the Inspector would never appear in `npm run dev` while working in a
   * production build. Reads through `layoutRef` so a second invocation sees the write the
   * first one made rather than a stale render's copy.
   */
  const openDock = (id: SideDockId): void => {
    const cur = layoutRef.current;
    if (!cur.collapsed[id]) return;
    updateLayout({ ...cur, collapsed: { ...cur.collapsed, [id]: false } });
  };
  /**
   * Which side docks the user has opened by hand on a tab that hides one.
   *
   * Two tabs suppress a dock they have no use for. The Docs tabs collapse both side panels —
   * reading a manual is the one activity in the program with nothing to inspect and nothing
   * to navigate, and two empty panels either side of a column of prose add only clutter.
   * The Welcome page collapses the Inspector only: it has no figure, no series and no
   * axes, so a formatting panel beside it is 300px of empty space — but the Navigator is how
   * the user leaves that page, so it stays. Both are a default, not a lock: the rail's expand
   * button still works, and what it opens is recorded here.
   *
   * Note: this is deliberately not a change to `layout`. Collapsing the real docks would
   * persist, so a visit to one of these tabs would silently rearrange the workspace set up
   * for other work, leaving panels shut that the user never closed. This is an override
   * applied at render time; `layout` is never touched, so leaving the tab restores exactly
   * what was there. Reset on leaving, so the next visit starts collapsed again.
   */
  const [tempDockOpen, setTempDockOpen] = useState<Record<SideDockId, boolean>>({
    navigator: false,
    inspector: false,
  });

  /**
   * How big to draw a figure that has no size of its own — measured once, at startup.
   *
   * Note: measuring only once is essential. A graph that re-fitted on every window resize
   * would reflow under the cursor while the window edge is dragged, and the same on every
   * dock collapse; the fit happens at startup only to avoid that. `fitDone` latches on the
   * first measurement and is never cleared, so nothing after startup can move it.
   *
   * Held separately from the enable flag so the flag can be read at use time: toggling the
   * preference off has to restore 580 × 380 immediately, without a relaunch.
   */
  const [figureFit, setFigureFit] = useState<FigureSize | null>(null);
  const fitDone = useRef(false);
  const fitFrame = useRef<number | null>(null);
  const measureFigureFit = (el: HTMLDivElement | null): void => {
    if (!el || fitDone.current) return;
    fitDone.current = true;
    // A frame later: on the very first paint the column has not been laid out yet, and
    // measuring then yields 0 and latches "no fit" for the session.
    fitFrame.current = requestAnimationFrame(() => {
      fitFrame.current = null;
      const r = el.getBoundingClientRect();
      setFigureFit(fitFigureSize(r.width, r.height));
    });
  };
  // A frame still pending when the app closes is cancelled: it holds the document column, and through it the whole app,
  // so an unmounted app would stay in memory (guarded by appshell-frames-released.test.tsx).
  useEffect(() => () => { if (fitFrame.current != null) cancelAnimationFrame(fitFrame.current); }, []);
  const [fitEnabled, setFitEnabled] = useState<boolean>(() => getAppDefaults().fitGraphsToWindow !== false);
  // Settings ▸ "Round results tables" — display-only precision for results tables (0 = off).
  // Read at render, like the startup fit, so turning it off restores full precision at once.
  const [resultDigits, setResultDigits] = useState<number>(() => getAppDefaults().resultDigits ?? 0);
  /** What an unsized figure is actually drawn at right now (null ⇒ the renderer default). */
  const effectiveFit: FigureSize | null = fitEnabled ? figureFit : null;
  const resizeDock = (id: SideDockId, px: number): void =>
    setLayoutState((l) => {
      // Update the ref synchronously too, so onCommit persists the latest width
      // even before React flushes this render.
      const next = { ...l, sizes: { ...l.sizes, [id]: px } };
      layoutRef.current = next;
      return next;
    });
  const rearrangeDocks = (fromId: DockId, beforeId: DockId): void =>
    updateLayout({ ...layout, order: reorderDocks(layout.order, fromId, beforeId) });
  const toggleLog = (): void => updateLayout({ ...layout, logCollapsed: !layout.logCollapsed });
  const [layoutMenuOpen, setLayoutMenuOpen] = useState(false);
  const [userPresets, setUserPresets] = useState<LayoutPreset[]>(loadUserPresets);
  const applyLayoutPreset = (p: LayoutPreset): void => updateLayout(applyPreset(p));
  const saveLayoutPreset = (name: string): void => setUserPresets((u) => addPreset(u, name, layoutRef.current));
  const deleteLayoutPreset = (name: string): void => setUserPresets((u) => deletePreset(u, name));
  const resetLayout = (): void => updateLayout(JSON.parse(JSON.stringify(DEFAULT_LAYOUT)) as DockLayout);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Load recent files once (Electron only).
  useEffect(() => {
    if (window.mady?.recentFiles) void window.mady.recentFiles().then(setRecents);
  }, []);
  const refreshRecents = (): void => {
    if (window.mady?.recentFiles) void window.mady.recentFiles().then(setRecents);
  };

  // --- linked / auto-updating import --------------------------------------
  // Ensure every linked table's source file is being watched (on load + when a new
  // linked import appears). `watchLinked` is idempotent in main, so re-calling is safe.
  const linkedPaths = project.tables
    .map((t) => t.linkedSource?.path)
    .filter((p): p is string => !!p)
    .join("\n");
  useEffect(() => {
    if (!window.mady?.watchLinked) return;
    for (const p of linkedPaths.split("\n").filter(Boolean)) void window.mady.watchLinked(p);
  }, [linkedPaths]);
  const mutateFromLinkedFile = useEffectEvent(mutate);
  // When a watched file changes on disk, re-read + re-parse it onto the same columns
  // (ids preserved → dependent plots/analyses stay valid) and log the auto-update.
  useEffect(() => {
    if (!window.mady?.onLinkedChanged) return;
    return window.mady.onLinkedChanged((path) => {
      const doc = docRef.current;
      if (!doc || !window.mady?.readLinked) return;
      const table = doc.toJSON().tables.find((t) => t.linkedSource?.path === path);
      const link = table?.linkedSource;
      if (!table || !link) return;
      void window.mady.readLinked(path).then((res) => {
        if (!res.ok) {
          // Surface a failed auto re-read as a non-modal badge + log rather than swallowing it,
          // so a broken auto-update ("keep linked" is a freshness promise) isn't silent.
          mutateFromLinkedFile((d) => {
            d.setLinkError(table.id, res.error ?? "Couldn't read the linked file — showing the last-loaded data.");
            d.appendLog("import", `Couldn't auto-update "${table.name}" — its linked file is unreadable`, { refKind: "table", refId: table.id });
          });
          return;
        }
        mutateFromLinkedFile((d) => {
          const result = d.relinkTableData(table.id, parseLinkedText(res.text, link));
          if (result === "applied") {
            d.setLinkError(table.id, undefined); // good read → clear any prior error badge
            d.appendLog("import", `Auto-updated "${table.name}" from its linked file`, { refKind: "table", refId: table.id });
          } else if (result === "structural") {
            // The file's columns changed — don't silently re-bind plots to different data.
            // Flag it (badge) + log a review note (no modal) so the user can Refresh to accept.
            d.setLinkError(table.id, "The linked file's columns changed — Refresh to review and apply.");
            d.appendLog("import", `Linked file for "${table.name}" changed its columns — open and Refresh to review`, { refKind: "table", refId: table.id });
          }
          // "empty" → a transient partial read; skip silently (self-heals on the next tick).
        });
      });
    });
  }, []);

  // --- crash-recovery ----------------------------------------------------
  // Ask main once whether the previous session left an autosave behind. If so,
  // hold the autosave loop until the user recovers or discards; otherwise start
  // autosaving right away. (Outside Electron there's nothing to do.)
  useEffect(() => {
    if (!window.mady?.autosaveRecovered) {
      setAutosaveReady(true);
      return;
    }
    void window.mady.autosaveRecovered().then((snap) => {
      // A copy holding only the demo project is nothing of the user's: it is removed, not offered.
      if (snap && isDemoOnlySnapshot(snap.json, demoTableIds.current!)) {
        void window.mady?.autosaveClear?.();
        snap = null;
      }
      if (snap) setRecovery(snap);
      else setAutosaveReady(true);
    });
  }, []);

  function recoverSnapshot(snap: AutosaveSnapshot): void {
    try {
      loadProjectDoc(migrate(JSON.parse(snap.json) as Record<string, unknown>));
    } catch (err) {
      // A corrupt snapshot must not silently close the dialog and then be overwritten by the
      // next autosave — that destroys the only copy of the crashed session.
      // Surface it and leave the dialog open + autosave held, so the snapshot survives
      // on disk for a manual rescue (or an explicit Discard).
      console.error("[recover] failed to load autosave snapshot:", err);
      window.alert("Couldn't recover that session — the autosave snapshot is unreadable. It's been left on disk so you can rescue it manually.");
      return;
    }
    setRecovery(null);
    setAutosaveReady(true);
  }
  function discardRecovery(): void {
    void window.mady?.autosaveClear?.();
    setRecovery(null);
    setAutosaveReady(true);
  }

  // --- a double-clicked .mady -------------------------------------------------
  // Opened exactly like File ▸ Open, and only once the crash-recovery question (above) is
  // answered — a file arriving while it is on screen waits for it. MadY started by the
  // double-click asks main for the file; one already open is sent it (`onLaunchOpen`).
  const pendingLaunch = useRef<string | null>(null);
  const openLaunched = useEffectEvent((path: string): void => {
    if (autosaveReady) void openPath(path);
    else pendingLaunch.current = path;
  });
  useEffect(() => window.mady?.onLaunchOpen?.((path) => openLaunched(path)), []);
  useEffect(() => {
    if (!autosaveReady) return;
    void (window.mady?.launchFile?.() ?? Promise.resolve(null)).then((started) => {
      const path = pendingLaunch.current ?? started; // the latest double-click wins
      pendingLaunch.current = null;
      if (path) openLaunched(path);
    });
  }, [autosaveReady]);

  // Debounced autosave: after edits settle, snapshot the in-memory project to
  // the userData slot (never the user's file). `version` is the change signal;
  // we skip the pristine sample (version 0) so a fresh launch writes nothing.
  useEffect(() => {
    const { enabled, ms } = resolveAutosave(getAppDefaults());
    if (!autosaveReady || version === 0 || !enabled || !window.mady?.autosaveWrite || onlyExploringDemo()) return;
    const handle = setTimeout(() => {
      // Bind the result: a repeatedly-failing autosave (slot disk full / read-only /
      // gone) would otherwise fail silently. Track consecutive failures and raise a
      // persistent banner past the threshold; any success clears it.
      const done = (ok: boolean): void => {
        autosaveFails.current = nextAutosaveFailures(autosaveFails.current, ok);
        setAutosaveFailing(autosaveFails.current >= AUTOSAVE_FAIL_THRESHOLD);
      };
      void window.mady?.autosaveWrite(buildSnapshot(projectName(project), project, Date.now()))
        .then((res) => done(!!res?.ok))
        .catch(() => done(false));
    }, ms);
    return () => clearTimeout(handle);
    // Re-armed on every edit; `project` + the autosave prefs are read fresh here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, autosaveReady]);

  // Clear the graph selection whenever the active tab changes.
  useEffect(() => setSelection(null), [activeKey]);
  // Switching tabs drops the per-tab dock override, so the next visit to the documentation
  // (or the Welcome page) starts collapsed again. Keyed on the tab rather than on "am I on
  // Docs", so it also clears when moving between two other tabs.
  useEffect(() => setTempDockOpen({ navigator: false, inspector: false }), [activeKey]);
  /**
   * "Apply to whole graph" — the bulk-apply scope, owned here rather than inside the Inspector.
   *
   * Held as `useState` inside `SelectionEditor`, it would be invisible to `resizeWidth` below
   * (and every other canvas gesture): dragging a box edge with the toggle ticked would resize
   * exactly one box. Owning it here is what lets a canvas gesture honour the scope at all.
   *
   * Still resets per graph (below), so a bulk scope never stays stuck on: it must never
   * follow the user onto a different figure and silently restyle it.
   */
  const [wholeGraph, setWholeGraph] = useState(false);
  // Bar width's own "whole graph" box (Data tab): ticked to start; the bar-edge drag below follows it.
  const [barWidthWhole, setBarWidthWhole] = useState(true);
  useEffect(() => setWholeGraph(false), [activeKey]);

  function openTab(kind: TabKind, id?: NodeId): void {
    const key = tabKey(kind, id);
    setOpenTabs((tabs) => (tabs.some((t) => t.key === key) ? tabs : [...tabs, { key, kind, id }]));
    setActiveKey(key);
    // A figure is drawn in its own view over the tabs, so a tab opened while one shows would open
    // out of sight — Help ▸ Documentation on a figure would appear to do nothing. Opening a tab
    // therefore leaves the figure view. Figures never open through here (they set `layoutView` directly).
    setArrangePlot(null);
    setLayoutView(null);
  }

  /**
   * Where the Documentation tab should land, or undefined for "just open it".
   *
   * A fresh object every call, on purpose: the pane's effect keys off the object identity, so
   * asking for the same chapter twice really does scroll and flash it twice — and a re-render
   * that changes nothing does not.
   */
  const [guideTarget, setGuideTarget] = useState<GuideTarget | undefined>(undefined);
  /** The manual in a popup, landed on an Ask-bar match \u2014 `null` when closed. */
  const [manualPopup, setManualPopup] = useState<GuideTarget | null>(null);

  /**
   * The language model: its status comes from main — settings, whether our
   * runtime is on disk, what answers on the loopback port, whether that makes it ready. The
   * model bar renders only when `ready`; the set-up button's label follows `phase`.
   *
   * Polled while not ready: main starts our runtime after the window, so the first probe often
   * lands before it answers. Re-read when the set-up dialog saves. In a browser preview there
   * is no bridge, so nothing is probed and the bar never appears.
   */
  // Off unless MadY was started with MADY_LLM=1 (the standard version has no language
  // model). False in the installed program, a plain `npm run dev` and a browser preview.
  // Nothing below renders, probes or opens when it is false.
  const llmEnabled = window.mady?.llmEnabled === true;
  const [modelStatus, setModelStatus] = useState<ModelStatusResponse | null>(null);
  const [modelSetupOpen, setModelSetupOpen] = useState(false);
  // One bridge object for the dialog's lifetime — a fresh one per render would look like a change.
  const modelSetupBridge = useMemo(() => setupBridgeFromWindow(), []);
  const refreshModelStatus = (): void => {
    const probe = window.mady?.modelStatus;
    if (!probe) return;
    void probe().then(setModelStatus).catch(() => setModelStatus(null));
  };
  const modelReady = modelStatus?.ready ?? false;
  useEffect(() => {
    if (!llmEnabled || !window.mady?.modelStatus) return;
    refreshModelStatus();
    if (modelReady) return;
    let tries = 0;
    const id = window.setInterval(() => {
      tries++;
      refreshModelStatus();
      if (tries >= 12) window.clearInterval(id);
    }, 5000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelReady]);

  /** Help \u25b8 Documentation (F1), and every deep link into it. */
  function openGuide(target?: GuideTarget): void {
    setGuideTarget(target);
    openTab("guide");
  }

  function closeTab(key: string): void {
    setOpenTabs((tabs) => {
      const next = tabs.filter((t) => t.key !== key);
      if (key === activeKey) setActiveKey(next[next.length - 1]?.key ?? "");
      return next;
    });
  }

  /**
   * Record every tab change into the back/forward stacks.
   *
   * Keyed on the tab actually left, captured in a ref — `openTabs` may already have changed
   * by the time this runs (a tab can be opened and activated in one go), so the previous
   * entry has to be remembered rather than looked up.
   *
   * A plain visit pushes onto "back" and clears "forward", exactly like a browser: navigating
   * somewhere new from a back-stepped position abandons the branch you stepped away from.
   */
  useEffect(() => {
    const left = prevActiveTabRef.current;
    const now = openTabs.find((t) => t.key === activeKey);
    prevActiveTabRef.current = now;
    if (!left || left.key === activeKey) return;
    const dir = historyDirRef.current;
    historyDirRef.current = null;
    if (dir === "back") setTabHistoryForward((f) => [...f, left]);
    else if (dir === "forward") setTabHistoryBack((b) => [...b, left]);
    else {
      setTabHistoryBack((b) => [...b, left]);
      setTabHistoryForward([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey]);

  /** Step back/forward through visited tabs. Reopens the target if it has since been closed. */
  function navigateHistory(dir: "back" | "forward"): void {
    const stack = dir === "back" ? tabHistoryBack : tabHistoryForward;
    const target = stack[stack.length - 1];
    if (!target) return;
    const setStack = dir === "back" ? setTabHistoryBack : setTabHistoryForward;
    setStack((s) => s.slice(0, -1));
    historyDirRef.current = dir;
    setOpenTabs((tabs) => (tabs.some((t) => t.key === target.key) ? tabs : [...tabs, target]));
    setActiveKey(target.key);
  }

  /** After a delete, drop open tabs whose object is gone and fix the active tab. */
  function pruneTabs(): void {
    const proj = doc.toJSON();
    const exists = (t: OpenTab): boolean => {
      if (t.kind === "table") return proj.tables.some((x) => x.id === t.id);
      if (t.kind === "plot") return proj.plots.some((x) => x.id === t.id);
      if (t.kind === "analysis") return proj.analyses.some((x) => x.id === t.id);
      if (t.kind === "docs") return proj.workspace.folders.some((f) => f.id === t.id);
      return true;
    };
    setOpenTabs((tabs) => {
      const next = tabs.filter(exists);
      setActiveKey((cur) => (next.some((t) => t.key === cur) ? cur : next[next.length - 1]?.key ?? ""));
      return next;
    });
  }

  /** Delete a graph / dataset / analysis (datasets cascade to their graphs+analyses). */
  const deleteObject = (kind: "table" | "plot" | "analysis" | "layout", id: NodeId): void => {
    if (kind === "table") {
      if (!window.confirm("Delete this dataset and every graph & analysis made from it? (Ctrl+Z to undo.)")) return;
      mutate((d) => d.removeTable(id));
    } else if (kind === "plot") {
      mutate((d) => d.removePlot(id));
    } else if (kind === "analysis") {
      mutate((d) => d.removeAnalysis(id));
    } else if (kind === "layout") {
      mutate((d) => d.removeLayout(id));
      if (layoutView === id) setLayoutView(null); // close its dedicated view
    } else {
      return;
    }
    setSelection(null);
    pruneTabs();
  };
  /**
   * A sentence naming the derived sheets a delete would cut loose. They are kept (they
   * may live in another project), but stop recomputing — so the prompt has to say so
   * rather than let the change happen silently behind a plain "are you sure?".
   */
  const cutLooseNote = (orphans: { name: string }[]): string => {
    if (orphans.length === 0) return "";
    const names = orphans.slice(0, 3).map((t) => `“${t.name}”`).join(", ");
    const more = orphans.length > 3 ? ` and ${orphans.length - 3} more` : "";
    return `\n\n${orphans.length === 1 ? "One dataset is" : `${orphans.length} datasets are`} calculated from the data being deleted: ${names}${more}. ${orphans.length === 1 ? "It" : "They"} will be kept with the current values, but will no longer update.`;
  };
  /** Delete an experiment and all its objects (cascade). */
  const deleteExperiment = (folderId: NodeId, experimentId: NodeId): void => {
    const note = cutLooseNote(docRef.current?.orphansOfDeletingExperiment(folderId, experimentId) ?? []);
    if (!window.confirm(`Delete this experiment and all its datasets & graphs?${note}\n\n(Ctrl+Z to undo.)`)) return;
    mutate((d) => d.deleteExperiment(folderId, experimentId));
    pruneTabs();
  };
  /** Delete a project folder and everything in it (cascade). */
  const deleteFolder = (folderId: NodeId): void => {
    const note = cutLooseNote(docRef.current?.orphansOfDeletingFolder(folderId) ?? []);
    if (!window.confirm(`Delete this project and everything filed under it?${note}\n\n(Ctrl+Z to undo.)`)) return;
    mutate((d) => d.deleteFolder(folderId));
    pruneTabs();
  };

  // --- document edits (all undoable via the command stack) -----------------

  function addProject(): void {
    mutate((d) => {
      const folder = d.addFolder(`Project ${d.workspace.folders.length + 1}`);
      d.addExperiment(folder.id, "Experiment 1");
    });
  }
  function addExperiment(folderId: NodeId): void {
    mutate((d) => {
      const n = (d.workspace.folders.find((f) => f.id === folderId)?.experiments.length ?? 0) + 1;
      d.addExperiment(folderId, `Experiment ${n}`);
    });
  }
  function addDataset(folderId?: NodeId, experimentId?: NodeId, kind: TableKind = "xy"): void {
    mutate((d) => {
      const n = d.toJSON().tables.length + 1;
      const fmt = tableFormat(kind);
      const table = d.addTable(`Data ${n}`, kind, [...fmt.seedColumns], fmt.seedRoles);
      /**
       * File it only when there is a folder to file it into. `addTable` already files the new
       * table loose, so an unconditional re-file-to-loose would be a second undoable command
       * doing nothing — and one press of Undo would pop only that no-op, leaving the table in
       * place. The menu path never passes a folder. A folder-scoped add (the Navigator's "+")
       * takes two undo steps: one for the add, one for the filing.
       */
      if (folderId) d.fileObject({ kind: "table", id: table.id }, targetOf(folderId, experimentId));
      openTab("table", table.id);
    });
  }
  /**
   * "New graph of this data" — every route (Graph menu · Assistant nudge · the "+" tab · the
   * Navigator's "+") opens the New-graph dialog on that sheet: its format picked, the first
   * suggestion pre-selected, Data = the sheet; Create puts the plot beside its source. Adding
   * an XY graph directly with `addPlot()` would produce an empty graph on any sheet that is not
   * laid out as XY data, so the graph wizard is shown with a suggested graph type instead.
   */
  function openNewGraphFor(tableId: NodeId): void {
    setNewGraphTableId(tableId);
    setNewGraphOpen(true);
  }
  function addGraph(sourceTableId: NodeId): void {
    openNewGraphFor(sourceTableId);
  }
  /** New dialog → build a fresh datasheet, and (unless table-only) its graph. */
  function confirmNewGraph(spec: NewGraphSpec): void {
    setNewGraphOpen(false);
    setNewGraphTableId(null);
    // An analysis-fed graph (PCA · ROC · Kaplan-Meier) on the open sheet: the graph is the
    // analysis result, so hand over to Analyze pre-set on that sheet — it lands the graph next
    // to the sheet when it runs. (The sheet is the working table already; Analyze targets it.)
    if (spec.analysis && spec.sourceTableId) {
      openTab("table", spec.sourceTableId);
      openAnalyzeFocus({ method: spec.analysis, focusKind: spec.analysis });
      return;
    }
    mutate((d) => {
      const { table, plot } = createNewGraph(d, spec);
      // Graphing the open datasheet: the plot is already filed beside its source; the data is
      // there, so land on the graph (there is nothing to type in first).
      if (spec.sourceTableId && plot) {
        d.recompute();
        seedNewPlot(d, plot.id, plot.kind);
        d.appendLog("graph", `Created ${genreByKey(spec.genre ?? "")?.label ?? "graph"} "${plot.name}"`, { detail: `from ${table.name}`, refKind: "plot", refId: plot.id });
        openTab("plot", plot.id);
        return;
      }
      // File the new datasheet (+ graph) under the chosen project/experiment in the side
      // tree. No destination (default) leaves them loose at the top level.
      fileCreatedGraph(d, { table, plot }, spec.dest);
      d.recompute();
      if (!plot) {
        // Table-only: open the datasheet (the table is already filed loose by addTable). For an
        // analysis-fed genre say what to do next — the graph comes from running that analysis.
        const g = spec.analysis ? genreByKey(spec.genre ?? "") : undefined;
        d.appendLog("import", g ? `Created a new ${tableFormat(table.kind).label} datasheet for a ${g.label} — fill it in, then run Analyze on it to make the graph` : `Created a new ${tableFormat(table.kind).label} datasheet`, { refKind: "table", refId: table.id });
        openTab("table", table.id);
        return;
      }
      seedNewPlot(d, plot.id, plot.kind); // the New dialog is where the user picks the TYPE → apply its per-type default
      d.appendLog("graph", `Created a new ${genreByKey(spec.genre ?? "")?.label ?? "graph"} (${table.kind} datasheet)`, {
        refKind: "plot",
        refId: plot.id,
      });
      // Note: both tabs open, but the datasheet is the one that ends up active. A brand-new
      // graph has nothing in it — landing on it would show an empty frame and no way forward,
      // when the next step is always entering the numbers. The graph is one tab away and
      // updates while typing.
      openTab("plot", plot.id);
      openTab("table", table.id);
    });
  }
  /** Chart-gallery card → a real dataset + graph, drawn in the gallery's style. */
  /**
   * Open a Chart-gallery card as a real, editable graph — filed into "Demo Project".
   *
   * A gallery card is synthetic data: it exists to show what a chart type looks like. Filing
   * it loose at the top level would put invented numbers next to the user's real datasets with
   * nothing to tell them apart, which is what the named sample folder prevents. Demo content
   * goes in the demo folder.
   *
   * Note: the folder is created only if it is missing. A deleted folder cannot be
   * distinguished from a first run, so it comes back on the next gallery open. That is the
   * accepted cost of this choice: the alternative is dropping synthetic data unfiled into
   * real work.
   *
   * Note: idempotent per card. Inserting a fresh dataset+graph on every open would leave a
   * second identical copy of both in the demo folder each time the same card is clicked —
   * two tabs with the same name and no way to tell them apart. A card stands for one example,
   * so re-opening it reveals the graph already made rather than cloning it. Matched on the
   * plot's name inside the demo folder: that is exactly what `insertGraph` stamps from
   * `title`, and confining the search to the demo folder keeps a user's own
   * identically-named graph out of it.
   */
  /**
   * Drag an axis title. X and Y keep their offset on their own AxisSpec; the 3-D scatter's Z
   * label keeps its offset on `scatter3d.zTitleOffset`, which is where the builder reads it.
   */
  function moveAxisTitle(d: MadyDocument, plot: Plot, axis: "x" | "y" | "z" | "y2" | "y3", dx: number, dy: number): void {
    if (axis === "z") {
      d.setPlotOptions(plot.id, { scatter3d: { ...(plot.scatter3d ?? {}), zTitleOffset: { dx, dy } } });
      return;
    }
    // Y2 / Y3 are already data axes wherever they are drawn, so no flip mapping applies.
    if (axis === "y2" || axis === "y3") {
      d.setAxisTitleOffset(plot.id, axis, dx, dy);
      return;
    }
    d.setAxisTitleOffset(plot.id, dataAxisOf(plot, axis) as "x" | "y", dx, dy);
  }
  /**
   * The bug reporter's opt-in "attach this analysis": the method + params + result and
   * only the source columns the analysis used — the small-consent alternative to
   * attaching the whole document for a wrong-result report. Dataset ids in `params.
   * columns` expand to their replicate columns; an id that resolves to nothing falls
   * back to the whole source table (still far less than the document).
   */
  function analysisAttachment(a: (typeof project.analyses)[number]): AttachedAnalysis {
    const table = project.tables.find((t) => t.id === a.source);
    const data: AttachedAnalysis["data"] = {};
    if (table) {
      const wanted = new Set<NodeId>();
      const datasets = tableDatasets(table);
      for (const id of ((a.params as { columns?: NodeId[] } | undefined)?.columns ?? []) as NodeId[]) {
        const ds = datasets.find((d) => d.id === id);
        if (ds) [ds.id, ...ds.replicates].forEach((c) => wanted.add(c));
        else wanted.add(id);
      }
      const cols = table.columns.filter((c) => wanted.size === 0 || wanted.has(c.id));
      for (const c of cols.length ? cols : table.columns) {
        data[c.name || c.id] = table.rows.map((r) => (r.cells[c.id] ?? null) as number | string | null);
      }
    }
    return {
      name: a.name,
      method: a.method,
      params: JSON.stringify(a.params ?? {}),
      result: JSON.stringify(a.result ?? null),
      data,
    };
  }

  function openGalleryItem(table: DataTable, plot: Plot, title: string, extraTables: DataTable[] = []): void {
    // Already opened this card? Show that graph, restyled first if it no longer looks like
    // the card does now. `sameGalleryLook` (gallery.ts) says why, and is tested there.
    const demo = project.workspace.folders.find((f) => f.name === DEMO_FOLDER);
    if (demo) {
      const inDemo = new Set<NodeId>([
        ...demo.members.filter((m) => m.kind === "plot").map((m) => m.id),
        ...demo.experiments.flatMap((e) => e.members.filter((m) => m.kind === "plot").map((m) => m.id)),
      ]);
      /**
       * Never create a second copy. If the look test were part of the lookup, a
       * card-made graph the user had restyled (e.g. applied a preset) would stop matching
       * and the next card click would silently duplicate its datasheet and graph. The
       * graph is found by name alone; a look mismatch means restyle it in place to the
       * card's current look — same data, same objects, every step undoable — and open it.
       */
      const already = project.plots.find(
        (p) => p.name === title && inDemo.has(p.id) && project.tables.some((t) => t.id === p.source),
      );
      if (already) {
        if (!sameGalleryLook(already, plot)) {
          mutate((d) => {
            const src = d.toJSON().tables.find((t) => t.id === already.source);
            if (src) applyCardLook(d, already.id, src, { table, plot });
          });
        }
        openTab("plot", already.id);
        return;
      }
    }
    mutate((d) => {
      const result = d.insertGraph(table, plot, title, extraTables);
      const folders = d.toJSON().workspace.folders;
      const existing = folders.find((f) => f.name === DEMO_FOLDER);
      const folder = existing ?? d.addFolder(DEMO_FOLDER);
      // One shared "Gallery" experiment, found by name. Not experiments[0]: the sample
      // folder's first experiment is "Experiment 1" — the demo measurements — and a gallery
      // copy filed between them is indistinguishable from them in the tree.
      const exp = folder.experiments.find((e) => e.name === GALLERY_EXPERIMENT) ?? d.addExperiment(folder.id, GALLERY_EXPERIMENT);
      const target = { level: "experiment", folderId: folder.id, experimentId: exp.id } as const;
      d.fileObject({ kind: "table", id: result.table.id }, target);
      d.fileObject({ kind: "plot", id: result.plot.id }, target);
      d.recompute();
      d.appendLog("graph", `Created graph "${title}" from the gallery`, {
        refKind: "plot",
        refId: result.plot.id,
      });
      openTab("plot", result.plot.id);
    });
  }
  function renameNode(kind: "folder" | "experiment", folderId: NodeId, name: string, experimentId?: NodeId): void {
    mutate((d) => {
      if (kind === "folder") d.renameFolder(folderId, name);
      else if (experimentId) d.renameExperiment(folderId, experimentId, name);
    });
  }
  function setDocumentation(folderId: NodeId, text: string): void {
    mutate((d) => d.setFolderDocumentation(folderId, text));
  }

  const tableOps: TableOps = {
    editCell: (tableId, r, c, v) => mutate((d) => d.editCellAt(tableId, r, c, v)),
    renameColumn: (tableId, colId, name) => mutate((d) => d.renameColumn(tableId, colId, name)),
    addColumn: (tableId) => mutate((d) => d.addColumn(tableId)),
    paste: (tableId, r, c, block) => mutate((d) => d.pasteBlock(tableId, r, c, block)),
    clearCells: (tableId, r, c, rows, cols) => mutate((d) => d.clearCells(tableId, r, c, rows, cols)),
    fillDown: (tableId, r, c, rows, cols) => mutate((d) => d.fillDown(tableId, r, c, rows, cols)),
    transpose: (tableId, r, c, rows, cols) => mutate((d) => d.transposeRange(tableId, r, c, rows, cols)),
    setReplicates: (tableId, count) => mutate((d) => d.setReplicateCount(tableId, count)),
    setEntryMode: (tableId, mode) => mutate((d) => d.setEntryMode(tableId, mode)),
    setXError: (tableId, on) => mutate((d) => d.setXError(tableId, on)),
    setSurvivalDates: (tableId, on) => mutate((d) => d.setSurvivalDates(tableId, on)),
    setSurvivalTimeUnit: (tableId, unit) => mutate((d) => d.setSurvivalTimeUnit(tableId, unit)),
    setColumnType: (tableId, colId, type) => mutate((d) => d.setColumnType(tableId, colId, type, resolveDateOrder())),
    setColumnDecimals: (tableId, colId, dec) => mutate((d) => d.setColumnDecimals(tableId, colId, dec)),
    setColumnFormula: (tableId, colId, f) => mutate((d) => d.setColumnFormula(tableId, colId, f)),
    setFrozen: (tableId, frozen) => mutate((d) => d.setTableFrozen(tableId, frozen)),
    setTableKind: (tableId, kind) => mutate((d) => d.setTableKind(tableId, kind)),
    setExcluded: (tableId, cells, excluded) => mutate((d) => d.setCellsExcluded(tableId, cells, excluded)),
    setCellFills: (tableId, cells, color) => mutate((d) => d.setCellsFill(tableId, cells, color)),
    setCellPatterns: (tableId, cells, pattern) => mutate((d) => d.setCellsPattern(tableId, cells, pattern)),
    insertRow: (tableId, index) => mutate((d) => d.insertRow(tableId, index)),
    deleteRow: (tableId, index) => mutate((d) => d.deleteRow(tableId, index)),
    insertColumn: (tableId, index) => mutate((d) => d.insertColumn(tableId, index)),
    deleteColumn: (tableId, index) => mutate((d) => d.deleteColumn(tableId, index)),
    deleteColumns: (tableId, indices) => mutate((d) => d.deleteColumns(tableId, indices)),
    moveRow: (tableId, from, to) => mutate((d) => d.moveRow(tableId, from, to)),
    moveColumn: (tableId, from, to) => mutate((d) => d.moveColumn(tableId, from, to)),
    setXColumn: (tableId, index) => mutate((d) => d.setXColumn(tableId, index)),
    sortRowsByColumn: (tableId, colId, direction) => mutate((d) => d.sortRowsByColumn(tableId, colId, direction)),
  };

  /** Create a figure layout filed under the given tree location (folder / experiment /
   *  standalone-loose), then open it in its dedicated full-area assembler view. */
  function createLayout(folderId?: NodeId, experimentId?: NodeId): void {
    let id = "";
    mutate((d) => {
      const n = (d.toJSON().layouts?.length ?? 0) + 1;
      id = d.addLayout(`Figure ${n}`).id;
      d.fileObject({ kind: "layout", id }, targetOf(folderId, experimentId));
      d.appendLog("graph", "Created figure layout", { refKind: "layout", refId: id });
    });
    setLayoutView(id);
  }
  /** Open an existing layout in the dedicated assembler view. */
  const openLayout = (id: NodeId): void => setLayoutView(id);
  const layoutOps: LayoutOps = {
    addPanel: (layoutId, plotId) => mutate((d) => d.addLayoutPanel(layoutId, plotId)),
    removePanel: (layoutId, plotId) => mutate((d) => d.removeLayoutPanel(layoutId, plotId)),
    duplicatePanel: (layoutId, plotId) => mutate((d) => d.duplicateLayoutPanel(layoutId, plotId)),
    setOptions: (layoutId, patch) => mutate((d) => d.setLayoutOptions(layoutId, patch)),
    matchStyles: (plotIds, style, keys) => mutate((d) => d.applyPlotTemplateMany(plotIds, style, keys)),
    setLinked: (layoutId, linked) => { setArrangePlot(null); mutate((d) => d.setLayoutLinked(layoutId, linked)); },
    /** Add a picture panel (micrograph / blot / schematic) to a figure.
     *
     *  It is a real plot of kind "image", so every panel affordance the assembler already
     *  has — drag, resize, A/B/C lettering, column spans, export — works on it unchanged.
     *  Its `source` table is a formality (`addPlot` requires one) and is never read: the
     *  image builder ignores the table entirely. The bytes are a data URI, so the picture
     *  travels inside the .mady file rather than as a path that can go stale. */
    addImagePanel: (layoutId, name, src, alt, naturalW, naturalH) =>
      mutate((d) => {
        const tableId = project.tables[0]?.id;
        if (!tableId) return; // a project always has a table; an image panel needs one to hang on
        const plot = d.addPlot(name, tableId);
        d.setPlotOptions(plot.id, {
          kind: "image",
          image: {
            src,
            ...(alt ? { alt } : {}),
            ...(naturalW ? { naturalWidth: naturalW } : {}),
            ...(naturalH ? { naturalHeight: naturalH } : {}),
          },
        });
        d.addLayoutPanel(layoutId, plot.id);
      }),
    addAnnotation: (layoutId, ann) => {
      let created: Annotation | undefined;
      mutate((d) => { created = d.addLayoutAnnotation(layoutId, ann); });
      return created;
    },
    moveAnnotation: (layoutId, id, patch) => mutateLive((d) => d.moveLayoutAnnotation(layoutId, id, patch)),
    updateAnnotation: (layoutId, id, patch) => mutate((d) => d.updateLayoutAnnotation(layoutId, id, patch)),
    removeAnnotation: (layoutId, id) => mutate((d) => d.removeLayoutAnnotation(layoutId, id)),
  };

  const canUndo = doc.commands.canUndo;
  const canRedo = doc.commands.canRedo;
  const undo = () => mutate((d) => d.commands.undo());
  const redo = () => mutate((d) => d.commands.redo());

  // --- persistence (.mady) ----------------------------------------------

  /** What the Save dialog can offer: the workspace tree, pickable at any level. Built fresh while
   *  the dialog is open — never memoised on `project`: `doc.toJSON()` hands back the same object
   *  after every mutation, so a memo would freeze the list at startup and leave new graphs out. */
  const savable = saveOpen ? saveTree(project) : { folders: [], loose: [] };

  /** Save: `null` picks = whole project; otherwise the ticked parts — a project folder, an
   *  experiment, or a single graph — extracted into a self-contained project file that carries
   *  the data it needs. Returns whether the project was actually written (false = no bridge,
   *  user cancel, or a write error). */
  async function saveProject(picks: SavePick[] | null): Promise<boolean> {
    setSaveOpen(false);
    if (!window.mady) return false; // not in Electron (e.g. browser preview)
    const toSave = picks ? extractPicks(project, picks) : project;
    const name = picks?.length === 1 ? (savePickName(project, picks[0]!) ?? "project") : "project";
    const res = await window.mady.saveProject(JSON.stringify(toSave, null, 2), name);
    const err = saveErrorMessage(res);
    if (err) {
      // A failed write must never read as success — the user needs to know their
      // work is not on disk. A cancel returns null here.
      window.alert(err);
      return false;
    }
    if (res.ok) {
      if (!picks) markSaved(); // a WHOLE-project save means the doc matches disk (a part doesn't)
      refreshRecents();
      return true;
    }
    return false; // user cancelled the native Save dialog
  }

  /** Replace the live document with a loaded Project and open its first objects. */
  function loadProjectDoc(loaded: Project): void {
    docRef.current = new MadyDocument(loaded);
    demoSession.current = false; // an opened or recovered project is the user's, demo folder or not
    const p = docRef.current.toJSON();
    const tabs: OpenTab[] = [];
    const t0 = p.tables[0];
    const pl0 = p.plots[0];
    if (t0) tabs.push({ key: tabKey("table", t0.id), kind: "table", id: t0.id });
    if (pl0) tabs.push({ key: tabKey("plot", pl0.id), kind: "plot", id: pl0.id });
    setOpenTabs(tabs);
    setActiveKey(tabs[tabs.length - 1]?.key ?? "");
    setSelection(null);
    bump();
    // NB: caller decides clean/dirty — an opened .mady is clean (markSaved), but a
    // recovered crash snapshot is unsaved work and must stay dirty until saved.
  }

  /**
   * Opening a project replaces the one that is open, and Undo cannot bring it back. With unsaved
   * changes, ask first — the same Save / Don't Save / Cancel as closing the window. Every way in
   * goes through here: File ▸ Open, a recent file, a dropped file, a double-clicked `.mady`.
   * Resolves true to go ahead (saved, or the user chose not to), false to keep what is open.
   */
  async function confirmReplaceProject(): Promise<boolean> {
    if (!hasUnsavedWork(versionRef.current)) return true;
    const choice = window.mady?.askUnsaved
      ? await window.mady.askUnsaved()
      : window.confirm("Your project has unsaved changes. Open the other project and lose them?")
        ? "discard"
        : "cancel"; // the browser preview: no native prompt, so no Save button
    if (choice === "save") return saveProject(null);
    return choice === "discard";
  }

  /** Route a unified-open result: a .mady project loads; a data file imports. */
  async function applyOpenResult(res: FileOpenResponse): Promise<void> {
    if (!res.ok) {
      // A real read error must not be indistinguishable from a Cancel.
      const err = readErrorMessage(res);
      if (err) window.alert(err);
      return;
    }
    if (res.kind === "project") {
      // Not a valid .mady — leave the current document untouched, but surface why (a silent
      // no-op reads as "Open is broken"). A newer-schema file gets its own message so the user
      // isn't told their (valid) file is corrupt.
      const refuse = (err: unknown): void => {
        console.error("[open] failed to load project:", err);
        const newer = err instanceof Error && err.name === "NewerSchemaError";
        window.alert(newer ? (err as Error).message : "Couldn't open that file — it doesn't look like a valid MadY project.");
      };
      let loaded: Project | null = null;
      try {
        loaded = migrate(JSON.parse(res.json) as Record<string, unknown>);
      } catch (err) {
        refuse(err); // read first: a file that cannot open never asks about the open one
      }
      if (loaded && (await confirmReplaceProject())) {
        try {
          loadProjectDoc(loaded);
          markSaved(); // an opened .mady matches its file → clean
          // …and stays clean: loadProjectDoc's version step lands at the next render, after this
          // mark, so the version effect adopts it as the saved one (as for a result filled on boot).
          keepCleanAfterRender.current = true;
          void fillMissingAnalysisResults(); // compute any analyses saved without a result
        } catch (err) {
          refuse(err);
        }
      }
      refreshRecents();
      return;
    }
    // kind === "import"
    if (res.source === "text") setImportSrc({ source: "text", name: res.name, text: res.text, path: res.path });
    else
      setImportSrc({
        source: "excel", // .pzfx sheets flow through the same multi-sheet path as Excel
        name: res.name,
        sheets: res.sheets,
        path: res.path,
        notice: res.source === "pzfx" ? res.notice : undefined,
      });
  }

  /** Unified Open (Ctrl+O) — accepts a project OR a data file. In the web build
   *  (no Electron bridge) fall back to a browser file picker so Open still works. */
  async function openFile(): Promise<void> {
    if (!window.mady) {
      openFileBrowser();
      return;
    }
    await applyOpenResult(await window.mady.openFile());
  }

  /** Browser fallback for Open: a hidden <input type=file>. A `.mady` loads as a
   *  project; csv/tsv/txt import as delimited text. (xlsx needs the native reader.) */
  function openFileBrowser(): void {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".mady,.csv,.tsv,.txt,.dat,.prn,application/json,text/plain";
    input.style.display = "none";
    input.onchange = () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) return;
      const ext = (file.name.split(".").pop() ?? "").toLowerCase();
      const name = file.name.replace(/\.[^.]+$/, "");
      const reader = new FileReader();
      reader.onload = () => {
        const text = String(reader.result ?? "");
        if (ext === "mady" || ext === "json") {
          void applyOpenResult({ ok: true, kind: "project", path: file.name, json: text });
        } else {
          void applyOpenResult({ ok: true, kind: "import", source: "text", name, text });
        }
      };
      reader.onerror = () => {
        // Browser-fallback Open (web/preview build only). Surfacing it beats "clicked a file
        // and nothing happened". Never runs in the shipped Electron app.
        console.error("[open] browser file read failed:", reader.error);
        window.alert("Couldn't read that file.");
      };
      reader.readAsText(file);
    };
    document.body.appendChild(input);
    input.click();
  }

  /** Open/import a specific path (recent files + drag-and-drop). */
  async function openPath(path: string): Promise<void> {
    if (!window.mady?.openPath) return;
    await applyOpenResult(await window.mady.openPath(path));
  }

  /** Drag-and-drop a file onto the window → open/import it. */
  function onDropFile(e: React.DragEvent): void {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file || !window.mady?.getPathForFile) return;
    const path = window.mady.getPathForFile(file);
    if (path) void openPath(path);
  }

  // --- data import ---------------------------------------------------------

  /** Explicit Import (Ctrl+I) — data files only → the preview/options modal. */
  async function openImport(): Promise<void> {
    if (!window.mady) return; // not in Electron (e.g. browser preview)
    const res = await window.mady.importData();
    if (!res.ok) {
      const err = readErrorMessage(res);
      if (err) window.alert(err);
      return;
    }
    if (res.source === "text") setImportSrc({ source: "text", name: res.name, text: res.text, path: res.path });
    else
      setImportSrc({
        source: "excel", // .pzfx sheets flow through the same multi-sheet path as Excel
        name: res.name,
        sheets: res.sheets,
        path: res.path,
        notice: res.source === "pzfx" ? res.notice : undefined,
      });
  }

  /** Paste import (Ctrl+Shift+V) — clipboard text (e.g. an Excel/Sheets
   * selection, which is tab-delimited) → the same preview/options modal, where
   * the auto-detected delimiter + transpose toggle handle the rest. */
  function pasteImport(): void {
    const text = window.mady?.readClipboardText?.() ?? "";
    if (text.trim() === "") {
      // Say so — a paste that silently does nothing looks like a broken Paste command
      // (the same rule as a failed write).
      window.alert("The clipboard has no text to paste. Copy cells from a spreadsheet first.");
      return;
    }
    setImportSrc({ source: "text", name: "Pasted data", text });
  }

  /** Commit the previewed import as a new dataset (undoable), filed loose + opened.
   *  When `result.link` is set, keep the table live-linked to its file (auto-update). */
  function confirmImport(results: ImportResult[]): void {
    setImportSrc(null);
    if (results.length === 0) return;
    const linkPaths: string[] = [];
    mutate((d) => {
      let lastId: NodeId | null = null;
      for (const result of results) {
        // Append onto an existing datasheet (merge-on-import) instead of creating a new one — the
        // flat coerced fields mirror the shaped grid, so the target's column ids/plots stay bound.
        if (result.appendTo) {
          const n = d.appendImportedRows(result.appendTo.tableId, result.columnNames, result.rows, result.appendTo.match, result.columnTypes);
          d.appendLog("import", `Appended ${n} row${n === 1 ? "" : "s"} to a datasheet`, {
            detail: `matched by ${result.appendTo.match}`,
            refKind: "table",
            refId: result.appendTo.tableId,
          });
          lastId = result.appendTo.tableId;
          continue;
        }
        // The interactive grid hands back a fully-shaped table → adopt it intact (types, column
        // order, decimals, exclusions). Otherwise build one from the flat coerced fields (paste,
        // a non-active Excel sheet, or any non-grid caller). Both file the table loose in the tree.
        const table = result.table
          ? d.adoptImportedTable(result.table, result.name)
          : d.importTable(result.name, "xy", result.columnNames, result.rows, result.columnTypes);
        if (result.link) {
          d.setTableLink(table.id, result.link);
          if (result.link.path) linkPaths.push(result.link.path);
        }
        d.appendLog("import", `Imported "${result.name}"${result.link ? " (linked — auto-updates)" : ""}`, {
          detail: `${table.rows.length} rows × ${table.columns.length} columns`,
          refKind: "table",
          refId: table.id,
        });
        lastId = table.id;
      }
      if (lastId) openTab("table", lastId); // land on the last-created sheet
    });
    for (const p of linkPaths) void window.mady?.watchLinked?.(p);
  }

  // --- ggplot script import ------------------------------------------------

  /** File ▸ Import ggplot script… — pick a .R file; its text goes to the report dialog. In the
   *  web build (no bridge) fall back to a browser file picker so the door still opens. */
  async function openImportGgplot(): Promise<void> {
    if (window.mady?.importScript) {
      const res = await window.mady.importScript();
      if (!res.ok) {
        const err = readErrorMessage(res);
        if (err) window.alert(err);
        return;
      }
      setGgplotSrc({ name: res.name, text: res.text, path: res.path });
      return;
    }
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".R,.r,.rmd,.qmd,.txt";
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return;
      void f.text().then((text) => setGgplotSrc({ name: f.name.replace(/\.[^.]+$/, ""), text }));
    };
    input.click();
  }

  /**
   * The report's "Create graph": adopt the wide datasheet the binder built, make the plot, and
   * style it in this order: the kind's house defaults, then the theme's preset, then the
   * script's own options and series styles on top — in any other order the preset's colour
   * pass would replace a `scale_fill_gradient2`.
   */
  function confirmGgplotImport(r: GgplotImportResult): void {
    setGgplotSrc(null);
    mutate((d) => {
      const { table, plot } = applyGgplotImport(d, r, seedNewPlot);
      d.appendLog("import", `Imported ggplot script → "${plot.name}" on a datasheet built from "${r.sourceTableName}"`, {
        detail: ggplotImportLogDetail(r),
        refKind: "plot",
        refId: plot.id,
      });
      openTab("table", table.id);
      openTab("plot", plot.id);
    });
  }

  /** Re-read a linked table's file now (manual "Refresh"). */
  function refreshLinked(tableId: NodeId): void {
    const link = project.tables.find((t) => t.id === tableId)?.linkedSource;
    if (!link?.path || !window.mady?.readLinked) return;
    void window.mady.readLinked(link.path).then((res) => {
      if (!res.ok) {
        window.alert(res.error ?? "Couldn't read the linked file.");
        return;
      }
      let result!: "applied" | "empty" | "structural"; // mutate runs the callback synchronously
      mutate((d) => { result = d.relinkTableData(tableId, parseLinkedText(res.text, link)); });
      if (result === "applied") {
        mutate((d) => d.setLinkError(tableId, undefined)); // good read → clear any prior error badge
      } else if (result === "empty") {
        window.alert("The linked file appears empty or unreadable right now — kept the current data.");
      } else if (result === "structural") {
        // The file's columns changed — don't silently re-bind; let the user accept it.
        if (window.confirm("The linked file's columns changed (added, removed, or renamed). Apply the new layout? Graphs and analyses using this table may need re-checking.")) {
          mutate((d) => { d.relinkTableData(tableId, parseLinkedText(res.text, link), { force: true }); d.setLinkError(tableId, undefined); });
        }
      }
    });
  }

  /** Drop a table's file link (stop auto-updating; keep the current data). */
  function unlinkTable(tableId: NodeId): void {
    const path = project.tables.find((t) => t.id === tableId)?.linkedSource?.path;
    mutate((d) => d.setTableLink(tableId, undefined));
    if (path) void window.mady?.unwatchLinked?.(path);
  }

  /** Reshape (wide↔long) — open the dialog on the active dataset. */
  function openReshape(): void {
    if (analyzeTable) setReshapeTable(analyzeTable);
  }

  /** Commit a reshape as a *reactive* derived dataset (undoable), filed loose + opened. */
  function confirmReshape(result: ReshapeResult): void {
    setReshapeTable(null);
    mutate((d) => {
      const table = d.deriveTable(result.name, { source: result.sourceId, op: "reshape", spec: result.spec });
      d.appendLog("import", `Reshaped → "${result.name}" (live)`, {
        detail: `${table.rows.length} rows × ${table.columns.length} columns`,
        refKind: "table",
        refId: table.id,
      });
      openTab("table", table.id);
    });
  }

  /** Row statistics (per-row mean/SD/SEM/…) — open the dialog on the active dataset. */
  function openRowStats(): void {
    if (analyzeTable) setRowStatsTable(analyzeTable);
  }

  /** Commit row statistics as a *reactive* derived dataset (undoable), filed + opened. */
  function confirmRowStats(result: RowStatsResult): void {
    setRowStatsTable(null);
    mutate((d) => {
      const table = d.deriveTable(result.name, { source: result.sourceId, op: "rowstats", spec: result.spec });
      d.appendLog("analyze", `Row statistics → "${result.name}" (live)`, {
        detail: `${table.rows.length} rows × ${table.columns.length} columns`,
        refKind: "table",
        refId: table.id,
      });
      openTab("table", table.id);
    });
  }

  /** Prune rows (keep a subset) — open the dialog on the active dataset. */
  function openPrune(): void {
    if (analyzeTable) setPruneTable(analyzeTable);
  }

  /** Commit a prune as a *reactive* derived dataset (undoable), filed + opened. */
  function confirmPrune(result: PruneResult): void {
    setPruneTable(null);
    mutate((d) => {
      const table = d.deriveTable(result.name, { source: result.sourceId, op: "prune", spec: result.spec });
      d.appendLog("analyze", `Pruned → "${result.name}" (live)`, {
        detail: `${table.rows.length} rows × ${table.columns.length} columns`,
        refKind: "table",
        refId: table.id,
      });
      openTab("table", table.id);
    });
  }

  /** Remove baseline / column math — open the dialog on the active dataset. */
  function openColMath(): void {
    if (analyzeTable) setColMathTable(analyzeTable);
  }

  /** Commit a baseline/column-math as a *reactive* derived dataset (undoable), filed + opened. */
  function confirmColMath(result: ColMathResult): void {
    setColMathTable(null);
    mutate((d) => {
      const table = d.deriveTable(result.name, { source: result.sourceId, op: "colmath", spec: result.spec });
      d.appendLog("analyze", `${result.spec.mode === "baseline" ? "Baseline removed" : "Column math"} → "${result.name}" (live)`, {
        detail: `${table.rows.length} rows × ${table.columns.length} columns`,
        refKind: "table",
        refId: table.id,
      });
      openTab("table", table.id);
    });
  }

  /** Transpose (rows ↔ columns) — open the dialog on the active dataset. */
  function openTranspose(): void {
    if (analyzeTable) setTransposeSel(analyzeTable);
  }

  /** Commit a transpose as a *reactive* derived dataset (undoable), filed + opened. */
  function confirmTranspose(result: TransposeResult): void {
    setTransposeSel(null);
    mutate((d) => {
      const table = d.deriveTable(result.name, { source: result.sourceId, op: "transpose", spec: result.spec });
      d.appendLog("analyze", `Transposed → "${result.name}" (live)`, {
        detail: `${table.rows.length} rows × ${table.columns.length} columns`,
        refKind: "table",
        refId: table.id,
      });
      openTab("table", table.id);
    });
  }

  /** Sort rows by a column — open the dialog on the active datasheet (menu route; the column
   *  right-click sorts directly). Sorting reorders rows in place, so it targets the working
   *  table (never the analyze-fallback demo sheet) and is refused on a frozen table. */
  function openSort(): void {
    if (workingTable && !workingTable.frozen) setSortSel(workingTable);
  }

  /** Commit the chosen sort — the same undoable `sortRowsByColumn` the right-click uses. */
  function confirmSort(colId: NodeId, direction: "asc" | "desc"): void {
    const t = sortSel;
    setSortSel(null);
    if (t) tableOps.sortRowsByColumn(t.id, colId, direction);
  }

  /** Extract & rearrange columns — open the dialog on the active dataset. */
  function openExtract(): void {
    if (analyzeTable) setExtractSel(analyzeTable);
  }

  /** Commit an extract/rearrange as a *reactive* derived dataset (undoable), filed + opened. */
  function confirmExtract(result: ExtractResult): void {
    setExtractSel(null);
    mutate((d) => {
      const table = d.deriveTable(result.name, { source: result.sourceId, op: "extract", spec: result.spec });
      d.appendLog("analyze", `Extracted → "${result.name}" (live)`, {
        detail: `${table.rows.length} rows × ${table.columns.length} columns`,
        refKind: "table",
        refId: table.id,
      });
      openTab("table", table.id);
    });
  }

  /** Merge datasheets — open the dialog with the active sheet as the first one. Needs a second sheet. */
  function openMerge(): void {
    if (analyzeTable && project.tables.length >= 2) setMergeSel(analyzeTable);
  }

  /** Commit a merge as a new, ordinary sheet (a one-time copy), filed + opened; the report goes to the log. */
  function confirmMerge(result: MergeResult): void {
    setMergeSel(null);
    mutate((d) => {
      const table = d.importTable(result.name, "xy", result.columnNames, result.rows, result.columnTypes);
      d.appendLog("analyze", `Merged → "${result.name}"`, {
        detail: `${table.rows.length} rows × ${table.columns.length} columns · ${result.report}`,
        refKind: "table",
        refId: table.id,
      });
      openTab("table", table.id);
    });
  }

  /** Split text column — open the dialog on the active dataset. */
  function openSplit(): void {
    if (analyzeTable) setSplitSel(analyzeTable);
  }

  /** Commit a split as a *live* derived dataset (undoable), filed + opened. */
  function confirmSplit(result: SplitResult): void {
    setSplitSel(null);
    mutate((d) => {
      const table = d.deriveTable(result.name, { source: result.sourceId, op: "split", spec: result.spec });
      d.appendLog("analyze", `Split text column → "${result.name}" (live)`, {
        detail: `${table.rows.length} rows × ${table.columns.length} columns`,
        refKind: "table",
        refId: table.id,
      });
      openTab("table", table.id);
    });
  }

  /** Find & replace — open the dialog on the working sheet (it edits cells in place; refused on a derived or frozen sheet). */
  function openFindReplace(): void {
    if (workingTable && !workingTable.frozen && !workingTable.derivation) setFindSel(workingTable);
  }

  /** Commit a find & replace: one undoable command; the count goes to the log. */
  function confirmFindReplace(result: FindReplaceResult): void {
    setFindSel(null);
    mutate((d) => {
      const n = d.replaceInTable(result.tableId, result.spec);
      d.appendLog("transform", `Replaced “${result.spec.find}” with “${result.spec.replace}”`, {
        detail: `${n} cell${n === 1 ? "" : "s"} changed`,
        refKind: "table",
        refId: result.tableId,
      });
    });
  }

  /** Transform (functions of Y/X) — open the dialog on the active dataset. */
  function openTransform(): void {
    if (analyzeTable) setTransformTable(analyzeTable);
  }

  /**
   * Commit a transform as a *reactive* derived dataset (undoable), filed loose +
   * opened. Unlike a one-shot import, the new table stores its derivation, so
   * editing the source live-updates it (see `MadyDocument.deriveTable`).
   */
  function confirmTransform(result: TransformResult): void {
    setTransformTable(null);
    mutate((d) => {
      const table = d.deriveTable(result.name, { source: result.sourceId, op: "transform", spec: result.spec });
      d.appendLog("import", `Transformed → "${result.name}" (live)`, {
        detail: `${table.rows.length} rows × ${table.columns.length} columns`,
        refKind: "table",
        refId: table.id,
      });
      openTab("table", table.id);
    });
  }

  /** Frequency distribution — open the histogram dialog on the active dataset. */
  function openFrequency(): void {
    if (analyzeTable) setFrequencyTable(analyzeTable);
  }

  /** Commit a frequency distribution as a *reactive* derived dataset (undoable), filed + opened. */
  function confirmFrequency(result: FrequencyResult): void {
    setFrequencyTable(null);
    mutate((d) => {
      const table = d.deriveTable(result.name, { source: result.sourceId, op: "frequency", spec: result.spec });
      d.appendLog("analyze", `Frequency distribution → "${result.name}" (live)`, {
        detail: `${table.rows.length} bins`,
        refKind: "table",
        refId: table.id,
      });
      openTab("table", table.id);
    });
  }

  /** QQ / normal-probability plot — open the dialog on the active dataset. */
  function openQQ(): void {
    if (analyzeTable) setQqTableSel(analyzeTable);
  }

  /** Commit a QQ plot: create the table and a styled XY graph (points + line). */
  function confirmQQ(result: QQResultPayload): void {
    setQqTableSel(null);
    mutate((d) => {
      const table = d.deriveTable(result.name, { source: result.sourceId, op: "qq", spec: result.spec });
      d.appendLog("analyze", `QQ plot → "${result.name}" (live)`, {
        detail: `${table.rows.length} points`,
        refKind: "table",
        refId: table.id,
      });
      // Auto-build the QQ graph: sample = markers (no line), reference = line (no markers).
      const plot = d.addPlot(`QQ — ${table.name}`, table.id);
      const ys = tableDatasets(table); // Y datasets in order: [ordered values, reference line]
      if (ys[0]) d.setSeriesStyle(plot.id, ys[0].id, { connect: "none", symbol: "circle", symbolSize: 5 });
      if (ys[1]) d.setSeriesStyle(plot.id, ys[1].id, { connect: "straight", symbol: "none", lineWidth: 1.5 });
      d.recompute();
      d.fileObject({ kind: "plot", id: plot.id }, d.locationOf({ kind: "table", id: table.id }));
      openTab("plot", plot.id);
    });
  }

  /** Simulate data — open the dialog (needs no source table; it generates). */
  function openSimulate(): void {
    setSimulateOpen(true);
  }

  /** Commit a seeded simulation as a new dataset (undoable), filed + opened. */
  function confirmSimulate(result: SimulateResult): void {
    setSimulateOpen(false);
    mutate((d) => {
      const table = d.simulateTable(result.name, result.spec);
      d.appendLog("analyze", `Simulate → "${result.name}" (seed ${result.spec.seed})`, {
        detail: `${table.rows.length} rows × ${table.columns.length} columns`,
        refKind: "table",
        refId: table.id,
      });
      openTab("table", table.id);
    });
  }

  // --- statistics ----------------------------------------------------------

  /** Run a method on a source table via the sidecar → tidy result or an error. */
  async function runEngine(
    analysisId: NodeId,
  ): Promise<{ result?: AnalysisResult; error?: string; discarded?: boolean }> {
    const owner = docRef.current;
    if (!owner) return { discarded: true };
    const run = owner.beginAnalysisRun(analysisId);
    const { method, data } = run;
    // Record the exact exchange for the bug reporter's opt-in engine-call attachment —
    // the byte-exact replay a wrong-result report needs. Ring-buffered + size-capped in
    // bugReport.ts; it leaves the machine only if the user ticks it there.
    const t0 = performance.now();
    let res;
    try {
      res = window.mady?.runAnalysis ? await window.mady.runAnalysis(method, data)
        : { ok: false as const, message: "Stats engine unavailable." };
      if (res.ok) assertAnalysisResult(res.results, method);
    } catch (e) {
      res = { ok: false as const, message: e instanceof Error ? e.message : String(e) };
    }
    recordEngineCall({
      method,
      ok: res.ok,
      ms: Math.round(performance.now() - t0),
      request: JSON.stringify({ method, data }),
      response: JSON.stringify(res.ok ? res.results : { error: res.message }),
    });
    const outcome = res.ok ? { result: res.results as unknown as AnalysisResult } : { error: res.message };
    if (docRef.current !== owner || !owner.completeAnalysisRun(run, outcome)) return { discarded: true };
    return outcome;
  }

  /** After opening a project, compute any analysis that has no result yet (e.g. a
   *  gallery/template saved before its analyses were run) so its pane shows real
   *  numbers instead of an empty "Re-run" state. Best-effort + sequential; needs
   *  the sidecar (Electron). Analyses that already carry a result are left as-is. */
  async function fillMissingAnalysisResults(): Promise<void> {
    const doc = docRef.current;
    if (!window.mady?.runAnalysis || !doc) return;
    const snap = doc.toJSON();
    const toRun = snap.analyses.filter((a) => !a.result);
    for (const a of toRun) {
      if (docRef.current !== doc) break;
      const table = snap.tables.find((t) => t.id === a.source);
      if (!table) continue;
      try {
        const res = await runEngine(a.id);
        if (res.discarded) continue;
        // A result is a derived value (like a recomputed derived table): attaching it to a
        // document that was clean must leave it clean. The demo project computes six of these
        // on every launch and must not quit through "unsaved changes" having changed nothing.
        const clean = versionRef.current === savedVersion.current;
        mutate(() => {}); // runEngine already attached the accepted result/error.
        // Not markSaved() here: bump() advances the version inside React's state updater, i.e.
        // at the next render, so the version read now is still the old one and the doc would
        // turn dirty on that render. The version effect below adopts the new version instead.
        if (clean) keepCleanAfterRender.current = true;
      } catch {
        /* leave this analysis without a result — the user can Re-run it manually */
      }
    }
  }

  /** Commit an AnalyzeDialog choice: create the analysis, open it, then compute. */
  async function confirmAnalyze(spec: AnalyzeSpec): Promise<void> {
    setAnalyzeOpen(false);
    setPendingAnalyzeSuggestion(null);
    const table = analyzeTable;
    if (!table) return;
    // AnalyzeSpec mirrors AnalysisParams field-for-field apart from `method`, so pass
    // the whole chosen configuration through — variant/variant2, weighting, the
    // fix/bounds constraints, throughPoint, global-fit shared+consts, selected-pairs,
    // the user-defined equation + initial values, and cluster options. (A hand-written
    // field list would drop any field it left out, and that dialog choice would be ignored.)
    const { method: _method, ...rest } = spec;
    const params: AnalysisParams = rest;
    const name = defaultAnalysisName(spec.method, params, table);
    let id: NodeId | undefined;
    mutate((d) => {
      id = d.addAnalysis(name, spec.method, table.id, params).id;
      // File the analysis with its source dataset (the "family" model) — not loose.
      d.fileObject({ kind: "analysis", id }, d.locationOf({ kind: "table", id: table.id }));
    });
    if (!id) return;
    openTab("analysis", id);
    await runAndOverlay(spec.method, params, table, name, id);
  }

  /**
   * Run an analysis in the engine, store its result, and apply the automatic
   * on-graph overlays (curve fit + CI/PI bands · global-fit curves · PCA score
   * plot) + log it. Shared by the Analyze dialog (`confirmAnalyze`) and by applying
   * a saved Method (`applyMethod`) so both paths behave identically.
   */
  async function runAndOverlay(method: string, params: AnalysisParams, table: DataTable, name: string, id: NodeId): Promise<void> {
    const { result, error, discarded } = await runEngine(id);
    if (discarded) return;
    const logKind = method === "curvefit" ? "fit" : "analyze";
    // The graph that receives a fitted curve: the active XY-family graph of this table,
    // else its first one. Only the continuous-XY builder draws `plot.fit` (writing it to a
    // bar/box plot would be a silent no-op). Nothing is created here — the
    // log says what to open instead.
    const activePlotIdAtRun = activePlot?.id;
    const overlayPlot = (d: MadyDocument): Plot | undefined => fitOverlayTarget(d.toJSON().plots, table.id, activePlotIdAtRun);
    const noteNoOverlayGraph = (d: MadyDocument): void => {
      d.appendLog("graph", `Open an XY graph of "${table.name}" to see the fitted curve — "${name}" has no XY graph to draw on.`, { refKind: "analysis", refId: id });
    };
    mutate((d) => {
      if (result) {
        d.appendLog(logKind, name, { detail: result.summary, refKind: "analysis", refId: id! });
        if (["curvefit", "regression", "globalfit", "meltingtemp"].includes(method)) {
          const plot = overlayPlot(d);
          if (plot) applyAnalysisFit(d, id, plot.id);
          else noteNoOverlayGraph(d);
        }
        // PCA: spawn a PC1-vs-PC2 score plot with a 95% covariance ellipse (one per
        // group when a grouping column was chosen). Reuses the per-series ellipse path.
        if (method === "pca") {
          const pcaX = (result.extra as { pca?: PcaScores } | undefined)?.pca;
          const built = pcaX ? buildPcaScorePlot(pcaX, table.name) : null;
          if (built) {
            const scoreTbl = d.importTable(built.tableName, "xy", built.columnNames, built.rows);
            const plot = d.addPlot(built.plotName, scoreTbl.id);
            d.setPlotOptions(plot.id, {
              analysisSource: id,
              ellipse: { show: true, mode: "data", level: 0.95 },
              xAxis: { title: built.xTitle },
              yAxis: { title: built.yTitle },
            });
            // Score plots are point clouds — no connecting lines.
            for (const ds of tableDatasets(scoreTbl)) {
              d.setSeriesStyle(plot.id, ds.id, { connect: "none", symbol: "circle", symbolSize: 5 });
            }
            const loc = d.locationOf({ kind: "table", id: table.id });
            d.fileObject({ kind: "table", id: scoreTbl.id }, loc);
            d.fileObject({ kind: "plot", id: plot.id }, loc);
            d.appendLog("graph", `Plotted PCA scores (${built.grouped ? "grouped" : "single"} 95% ellipse) from "${name}"`, {
              refKind: "plot",
              refId: plot.id,
            });
          }
        }
        // Curve transform (smooth / differentiate / integrate): spawn a new xy table +
        // graph with the transformed Y (its own units), filed next to the source.
        if (method === "curvetransform") {
          const tc = (result.extra as { curve?: { x: number[]; y: number[]; xTitle?: string; yTitle?: string } } | undefined)?.curve;
          const yLabel = tc?.yTitle ?? "Transformed Y";
          // Smoothing/derivatives keep the original X grid, but the Michaelis-Menten
          // linearizations transform both axes — so the X label comes from the engine.
          const xLabel = tc?.xTitle ?? "X";
          const rows = (tc?.x ?? [])
            .map((xv, i) => [xv, tc!.y[i] ?? NaN] as [number, number])
            .filter((r) => Number.isFinite(r[0]) && Number.isFinite(r[1]));
          if (rows.length >= 2) {
            const outTbl = d.importTable(`${result.title} — ${table.name}`, "xy", [xLabel, yLabel], rows);
            const plot = d.addPlot(`${result.title} — ${table.name}`, outTbl.id);
            d.setPlotOptions(plot.id, { analysisSource: id, xAxis: { title: xLabel }, yAxis: { title: yLabel } });
            const loc = d.locationOf({ kind: "table", id: table.id });
            d.fileObject({ kind: "table", id: outTbl.id }, loc);
            d.fileObject({ kind: "plot", id: plot.id }, loc);
            d.appendLog("graph", `Created ${yLabel} curve from "${name}"`, { refKind: "plot", refId: plot.id });
          }
        }
        // Cluster k-selection scan: spawn a silhouette-vs-k graph (peak = suggested k).
        if (method === "cluster") {
          const scan = (result.extra as { cluster?: { kScan?: { ks: number[]; silhouette: Array<number | null> } } } | undefined)?.cluster?.kScan;
          const rows = (scan?.ks ?? [])
            .map((kv, i) => [kv, scan!.silhouette[i] ?? NaN] as [number, number])
            .filter((r) => Number.isFinite(r[0]) && Number.isFinite(r[1]));
          if (rows.length >= 2) {
            const outTbl = d.importTable(`k-selection — ${table.name}`, "xy", ["k", "Mean silhouette"], rows);
            const plot = d.addPlot(`k-selection (silhouette) — ${table.name}`, outTbl.id);
            d.setPlotOptions(plot.id, { analysisSource: id, xAxis: { title: "k (clusters)" }, yAxis: { title: "Mean silhouette" } });
            const loc = d.locationOf({ kind: "table", id: table.id });
            d.fileObject({ kind: "table", id: outTbl.id }, loc);
            d.fileObject({ kind: "plot", id: plot.id }, loc);
            d.appendLog("graph", `Created k-selection (silhouette) graph from "${name}"`, { refKind: "plot", refId: plot.id });
          }
        }
        // Bland-Altman: spawn a difference-vs-mean plot (native blandaltman kind) from the pairs.
        if (method === "blandaltman") {
          const ba = (result.extra as { blandaltman?: { pairs: number[][]; percent: boolean } } | undefined)?.blandaltman;
          const rows = (ba?.pairs ?? []).filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
          if (rows.length >= 2) {
            const outTbl = d.importTable(`Bland-Altman — ${table.name}`, "xy", ["Method A", "Method B"], rows);
            const plot = d.addPlot(`Bland-Altman — ${table.name}`, outTbl.id);
            d.setPlotOptions(plot.id, { analysisSource: id, kind: "blandaltman", blandAltman: { percent: !!ba!.percent, agreementK: params.agreementK ?? 1.96 } });
            const loc = d.locationOf({ kind: "table", id: table.id });
            d.fileObject({ kind: "table", id: outTbl.id }, loc);
            d.fileObject({ kind: "plot", id: plot.id }, loc);
            d.appendLog("graph", `Created Bland-Altman plot from "${name}"`, { refKind: "plot", refId: plot.id });
          }
        }
      } else {
        d.setAnalysisError(id!, error ?? "Analysis failed.");
        d.appendLog(logKind, name, { detail: `failed: ${error ?? ""}`, refKind: "analysis", refId: id! });
      }
    });
  }

  // --- re-applicable analysis methods (Method files) ----------------

  /** Save an analysis as a reusable Method (prompts for a name; default = the analysis name). */
  function saveAnalysisAsMethod(analysisId: NodeId): void {
    const a = project.analyses.find((x) => x.id === analysisId);
    if (!a) return;
    const table = project.tables.find((t) => t.id === a.source);
    if (!table) return;
    const name = window.prompt("Save this analysis as a reusable Method.\nName:", a.name);
    if (name == null) return; // cancelled
    mutate((d) => {
      const m = analysisToMethod(d.nextMethodId(), name.trim() || a.name, { method: a.method, params: a.params }, table);
      d.addMethod(m);
      d.appendLog("analyze", `Saved analysis method "${m.name}".`, { refKind: "analysis", refId: a.id });
    });
  }

  /** Apply a saved Method to a table: remap its columns onto this table, create + run the analysis. */
  async function applyMethod(methodId: NodeId, tableId: NodeId): Promise<void> {
    const m = project.methods?.find((x) => x.id === methodId);
    const table = project.tables.find((t) => t.id === tableId);
    if (!m || !table) return;
    const remap = methodApplyParams(m, table);
    if (!remap.ok) {
      window.alert(`Can't apply method "${m.name}" here:\n\n${remap.error}`);
      return;
    }
    const name = defaultAnalysisName(m.method, remap.params, table);
    let id: NodeId | undefined;
    mutate((d) => {
      id = d.addAnalysis(name, m.method, table.id, remap.params).id;
      d.fileObject({ kind: "analysis", id }, d.locationOf({ kind: "table", id: table.id }));
    });
    if (!id) return;
    openTab("analysis", id);
    await runAndOverlay(m.method, remap.params, table, name, id);
  }

  /** Delete a saved Method. */
  function deleteMethodById(id: NodeId): void {
    mutate((d) => d.removeMethod(id));
  }

  /** Export a saved Method to a portable JSON file (re-importable elsewhere). */
  function exportMethod(id: NodeId): void {
    const m = project.methods?.find((x) => x.id === id);
    if (!m) return;
    void runExport({ format: "json", suggestedName: `${m.name}.json`, text: methodToFile(m) });
  }

  /** Import a Method from a JSON file (hidden file input → parse/validate → add). */
  function importMethod(): void {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.style.display = "none";
    input.onchange = (): void => {
      const file = input.files?.[0];
      input.remove();
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (): void => {
        const parsed = parseMethodFile(String(reader.result ?? ""));
        if (!parsed.ok) {
          window.alert(parsed.error);
          return;
        }
        mutate((d) => d.addMethod({ id: d.nextMethodId(), ...parsed.method }));
      };
      reader.readAsText(file);
    };
    document.body.appendChild(input);
    input.click();
  }

  /** Open the object a log step produced (if it still exists). */
  function openLogEntry(entry: LogEntry): void {
    const { refKind, refId } = entry;
    if (!refId) return;
    const exists =
      (refKind === "table" && project.tables.some((t) => t.id === refId)) ||
      (refKind === "plot" && project.plots.some((p) => p.id === refId)) ||
      (refKind === "analysis" && project.analyses.some((a) => a.id === refId));
    if (exists && (refKind === "table" || refKind === "plot" || refKind === "analysis")) {
      openTab(refKind, refId);
    }
  }

  /** Re-run an existing analysis against the current source data. */
  async function rerunAnalysis(id: NodeId): Promise<void> {
    const a = project.analyses.find((x) => x.id === id);
    if (!a) return;
    const bound = bracketsBound(id);
    const { result, discarded } = await runEngine(id);
    if (discarded) return;
    mutate((d) => {
      if (!result) return;
      for (const p of d.toJSON().plots) {
        if (p.fit?.analysisSource === id || p.fits?.some(f => f.analysisSource === id)) applyAnalysisFit(d, id, p.id);
      }
    });
    // Markers driven by this analysis are a readout of it: refresh them from the new
    // numbers. `syncBracketsAfterRerun` reads the just-stored result off the document
    // rather than `project`, which is still last render's snapshot in this tick.
    if (bound && result) syncBracketsAfterRerun(id);
  }

  /**
   * Rebuild the markers bound to an analysis from a result that has just landed.
   *
   * Reads the document snapshot rather than `project`: the new result was stored moments
   * ago and `project` is still last render's value in this tick — planning from it would
   * quietly re-place the old p-values, which looks exactly like a re-run that did nothing.
   */
  function syncBracketsAfterRerun(id: NodeId): void {
    const snap = docRef.current?.toJSON();
    if (!snap) return;
    const owners = snap.plots.filter((p) => (p.annotations ?? []).some((x) => x.sig?.analysisId === id));
    if (owners.length === 0) return;
    const planned = planAnalysisMarkers(snap, id);
    if (!("plotId" in planned)) return;
    mutate((d) => d.syncAnalysisAnnotations(planned.plotId, id, planned.annotations));
  }

  /** The graph an analysis's significance markers belong on, and the group names its
   *  comparisons are matched against. One resolver, so the "add", the "remove" and the
   *  re-run sync can never disagree about which figure is being managed. */
  function bracketTargetOf(id: NodeId): { plot: Plot; names: string[] } | undefined {
    const a = project.analyses.find((x) => x.id === id);
    const table = a ? project.tables.find((t) => t.id === a.source) : undefined;
    if (!a || !table) return undefined;
    const plots = project.plots.filter((p) => p.source === table.id);
    const target =
      plots.find((p) => p.analysisSource === id && bracketGeometry(p).endpoints.startsWith("category")) ??
      plots.find((p) => bracketGeometry(p).endpoints.startsWith("category")) ??
      undefined;
    if (!target) return undefined;
    const geom = bracketGeometry(target);
    // Categories come from the datasets on a box/violin, but from the rows on a bar.
    const rowLabels = table.rows.map((r, i) => {
      const xc = xColumn(table);
      const raw = xc ? r.cells[xc.id] : null;
      return raw == null || String(raw).trim() === "" ? String(i + 1) : String(raw);
    });
    return { plot: target, names: geom.endpoints === "category-row" ? rowLabels : tableDatasets(table).map((d) => d.name) };
  }

  /** Is this analysis currently driving markers on a graph? Derived from the markers'
   *  own provenance rather than a stored flag — delete them by hand and the tick-box
   *  follows, so the two can never drift apart. */
  function bracketsBound(id: NodeId): boolean {
    return project.plots.some((p) => (p.annotations ?? []).some((x) => x.sig?.analysisId === id));
  }

  /** Everything the analysis pane needs to show the binding as a tick-box + control
   *  picker. Undefined when this analysis has no graph that could carry markers, so the
   *  control is absent rather than present-and-dead. */
  function bracketBindingFor(id: NodeId): {
    on: boolean;
    control: string | undefined;
    groups: string[];
    toggle: (on: boolean) => void;
    setControl: (group: string | undefined) => void;
  } | undefined {
    const t = bracketTargetOf(id);
    if (!t) return undefined;
    return {
      on: bracketsBound(id),
      control: t.plot.significanceControl,
      groups: t.names,
      toggle: (on: boolean) => (on ? addBracketsFromAnalysis(id) : removeBracketsFromAnalysis(id)),
      setControl: (group: string | undefined) => setBracketControl(id, group),
    };
  }

  /** Untick: drop exactly the markers this analysis put on the graph. */
  function removeBracketsFromAnalysis(id: NodeId): void {
    const owners = project.plots.filter((p) => (p.annotations ?? []).some((x) => x.sig?.analysisId === id));
    if (owners.length === 0) return;
    mutate((d) => {
      for (const p of owners) d.syncAnalysisAnnotations(p.id, id, []);
      d.appendLog("graph", `Removed the significance markers driven by "${project.analyses.find((x) => x.id === id)?.name ?? "an analysis"}".`, { refKind: "analysis", refId: id });
    });
  }

  /** Choose the reference group these markers compare against ("" / undefined = all pairs),
   *  then rebuild them so the choice is visible immediately. */
  function setBracketControl(id: NodeId, group: string | undefined): void {
    const t = bracketTargetOf(id);
    if (!t) return;
    mutate((d) => d.setPlotOptions(t.plot.id, { significanceControl: group }));
    // The plot in `project` is a render-time snapshot, so pass the new value explicitly
    // rather than re-reading it in the same tick.
    addBracketsFromAnalysis(id, group);
  }

  /**
   * Put this analysis's pairwise comparisons on the graph as significance markers — and
   * keep them there: the set is rebuilt from the result each time, so a re-run refreshes
   * every p-value and drops any comparison that is no longer significant.
   */
  function addBracketsFromAnalysis(id: NodeId, controlOverride?: string | undefined): void {
    const a = project.analyses.find((x) => x.id === id);
    if (!a?.result) return;
    const planned = planAnalysisMarkers(project, id, controlOverride !== undefined ? { control: controlOverride } : undefined);
    if (!("plotId" in planned)) {
      mutate((d) => d.appendLog("graph", `Could not add significance markers: ${planned.reason}`, { refKind: "analysis", refId: id }));
      return;
    }
    mutate((d) => {
      // Replace, never append: the markers are a readout of this analysis, so pressing
      // "add" twice, switching the control, or re-running all converge on one set rather
      // than stacking duplicates. An empty list is a real outcome — a re-run whose last
      // significant comparison went away must clear the markers it drew, or the figure
      // keeps asserting a result the analysis no longer supports.
      d.syncAnalysisAnnotations(planned.plotId, id, planned.annotations);
      d.appendLog(
        "graph",
        planned.reason ?? `${planned.annotations.length} significance marker(s) from "${a.name}"${controlOverride ?? "" ? ` (vs ${controlOverride})` : ""}.`,
        { refKind: "plot", refId: planned.plotId },
      );
    });
  }

  /** Add Compact Letter Display labels (shared letter = not significantly different)
   *  above each group on a box/violin/scatter graph, from an analysis's pairwise rows. */
  function addLettersFromAnalysis(id: NodeId): void {
    const a = project.analyses.find((x) => x.id === id);
    if (!a?.result) return;
    const table = project.tables.find((t) => t.id === a.source);
    if (!table) return;
    const distKinds = ["box", "violin", "scatter"];
    const target = project.plots.find((p) => p.source === table.id && distKinds.includes(p.kind ?? ""));
    const groups = tableDatasets(table).map((d) => d.name);
    if (!target || groups.length < 2) {
      mutate((d) =>
        d.appendLog("graph", "Could not add letters: open a box, violin, or column-scatter graph of this data first.", {
          refKind: "analysis",
          refId: id,
        }),
      );
      return;
    }
    const plans = buildLetterAnnotations(groups, significantPairs(a.result.terms));
    if (plans.length === 0) return;
    mutate((d) => {
      d.addAnnotations(
        target.id,
        plans.map((p) => ({ kind: "text" as const, x: p.x, y: p.y, label: p.label, size: 14 })),
      );
      d.appendLog("graph", `Added compact-letter display to "${target.name}" from "${a.name}".`, {
        refKind: "plot",
        refId: target.id,
      });
    });
  }

  /** Plot a survival analysis's Kaplan-Meier curves as a new graph. */
  function plotSurvivalFromAnalysis(id: NodeId): void {
    const a = project.analyses.find((x) => x.id === id);
    const curves = a?.result?.extra?.["curves"] as SurvivalCurve[] | undefined;
    if (!a || !Array.isArray(curves) || curves.length === 0) return;
    const atRisk = a.result?.extra?.["atrisk"] as SurvivalAtRisk | undefined;
    // The stats header of a Kaplan-Meier panel: "HR = 4.37 (95% CI 2.29–8.32) ·
    // Log-rank P = 1.0e-6" from the analysis' glance (HR + log-rank p) + the Hazard-
    // ratio term's CI. Set as the graph subtitle so it sits under the title, editable.
    // The CI label names the analysis's actual confidence level.
    const survivalHeader = (): string | undefined => {
      const glance = a.result?.glance ?? {};
      const parts: string[] = [];
      const pct = a.params?.conf != null && a.params.conf > 0 && a.params.conf < 1 ? Math.round(a.params.conf * 1000) / 10 : 95;
      const hr = typeof glance["hazard_ratio"] === "number" ? (glance["hazard_ratio"] as number) : undefined;
      if (hr !== undefined) {
        const hrTerm = a.result?.terms?.find((t) => /hazard ratio/i.test(t.term));
        const lo = typeof hrTerm?.ciLow === "number" ? hrTerm.ciLow : undefined;
        const hi = typeof hrTerm?.ciHigh === "number" ? hrTerm.ciHigh : undefined;
        parts.push(lo !== undefined && hi !== undefined ? `HR = ${hr.toFixed(2)} (${pct}% CI ${lo.toFixed(2)}–${hi.toFixed(2)})` : `HR = ${hr.toFixed(2)}`);
      }
      const p = typeof glance["p"] === "number" ? (glance["p"] as number) : undefined;
      if (p !== undefined) {
        const pStr = p < 0.0001 ? p.toExponential(1) : p < 0.001 ? p.toFixed(5) : p.toFixed(4);
        parts.push(`Log-rank P = ${pStr}`);
      }
      return parts.length ? parts.join("  ·  ") : undefined;
    };
    const header = survivalHeader();
    mutate((d) => {
      const n = d.toJSON().plots.length + 1;
      const plot = d.addPlot(`Survival ${n}`, a.source);
      d.setSurvival(plot.id, curves, atRisk);
      d.setPlotOptions(plot.id, { analysisSource: id });
      if (header) d.setGraphTitle(plot.id, { subtitle: header });
      d.recompute();
      d.fileObject({ kind: "plot", id: plot.id }, d.locationOf({ kind: "table", id: a.source }));
      d.appendLog("graph", `Plotted survival curves from "${a.name}"`, { refKind: "plot", refId: plot.id });
      openTab("plot", plot.id);
    });
  }

  /** Plot a ROC analysis's curve (sensitivity vs 1−specificity) as a new graph. */
  function plotRocFromAnalysis(id: NodeId): void {
    const a = project.analyses.find((x) => x.id === id);
    const roc = (a?.result?.extra as { roc?: { points?: { fpr: number; tpr: number }[]; auc?: number; label?: string } } | undefined)?.roc;
    if (!a || !roc || !Array.isArray(roc.points) || roc.points.length === 0) return;
    // The AUC's confidence interval (Hanley-McNeil) is already computed by the engine — carry it
    // (and its level, from the analysis' own conf) onto the curve so the legend can show
    // "AUC 0.86 (95% CI 0.79–0.93)", the headline number every ROC tool reports. Absent → AUC alone.
    const g = a.result?.glance ?? {};
    const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
    const aucLow = num(g["ci_low"]);
    const aucHigh = num(g["ci_high"]);
    const aucConf = num(a.params?.conf);
    const ci = aucLow != null && aucHigh != null
      ? { aucLow, aucHigh, ...(aucConf != null ? { aucConf } : {}) }
      : {};
    mutate((d) => {
      const n = d.toJSON().plots.length + 1;
      const plot = d.addPlot(`ROC ${n}`, a.source);
      d.setRoc(plot.id, [{ label: roc.label ?? "ROC", points: roc.points!, auc: roc.auc ?? NaN, ...ci }]);
      d.setPlotOptions(plot.id, { analysisSource: id });
      d.recompute();
      d.fileObject({ kind: "plot", id: plot.id }, d.locationOf({ kind: "table", id: a.source }));
      d.appendLog("graph", `Plotted ROC curve from "${a.name}"`, { refKind: "plot", refId: plot.id });
      openTab("plot", plot.id);
    });
  }

  /** Build the PCA graph suite from a PCA analysis' `extra.pca`, in one undoable step:
   *  the four ordination graphs of `PCA_GRAPH_SUITE` (scores, loadings, biplot, scree). */
  function plotPcaFromAnalysis(id: NodeId): void {
    const a = project.analyses.find((x) => x.id === id);
    const pca = (a?.result?.extra as { pca?: PcaGraphData } | undefined)?.pca;
    if (!a || !pca || !Array.isArray(pca.scores) || !Array.isArray(pca.loadings)) return;
    mutate((d) => {
      const loc = d.locationOf({ kind: "table", id: a.source });
      const suite = PCA_GRAPH_SUITE.map((s) => ({ name: `PCA ${s.suffix} — ${a.name}`, kind: s.kind }));
      let firstId: NodeId | null = null;
      for (const s of suite) {
        const plot = d.addPlot(s.name, a.source);
        d.setPca(plot.id, pca, s.kind);
        d.fileObject({ kind: "plot", id: plot.id }, loc);
        firstId = firstId ?? plot.id;
      }
      d.recompute();
      if (firstId) {
        d.appendLog("graph", `Plotted PCA graphs (scores, loadings, biplot, scree) from "${a.name}"`, { refKind: "plot", refId: firstId });
        openTab("plot", firstId);
      }
    });
  }

  /**
   * Variance partitioning → the fractions as a bar chart, which is the readout.
   *
   * A bar rather than a Venn diagram, and the reason is arithmetic rather than taste: a shared
   * fraction can be negative (the blocks together explaining less than the sum of their separate
   * explanations), and there is no way to draw a negative area. A Venn diagram can only print
   * the negatives beside it; a bar shows them where they are.
   *
   * The table is synthetic and imported like the Shepard plot's — the same mechanism, so this
   * needs no new chart kind and no new datasheet format.
   */
  function plotVariancePartitionFromAnalysis(id: NodeId): void {
    const a = project.analyses.find((x) => x.id === id);
    const vp = (a?.result?.extra as { varpart?: VarpartData } | undefined)?.varpart;
    if (!a || !vp || !vp.fractions?.length) return;
    const rows: (string | number)[][] = [
      ...vp.fractions.map((f) => [f.label, f.adjR2]),
      ["[residual] unexplained", vp.residual],
    ];
    mutate((d) => {
      const loc = d.locationOf({ kind: "table", id: a.source });
      const tbl = d.importTable(`Fractions — ${a.name}`, "column", ["Fraction", "Adjusted R²"], rows);
      const plot = d.addPlot(`Variance fractions — ${a.name}`, tbl.id);
      d.setPlotOptions(plot.id, {
        analysisSource: a.id,
        kind: "bar",
        barOrientation: "horizontal",
        showValues: true,
        valueDecimals: 3,
        xAxis: { title: "" },
        yAxis: { title: "Share of the variation (adjusted R²)" },
      });
      d.fileObject({ kind: "table", id: tbl.id }, loc);
      d.fileObject({ kind: "plot", id: plot.id }, loc);
      d.recompute();
      d.appendLog("graph", `Plotted the variance fractions from "${a.name}"`, { refKind: "plot", refId: plot.id });
      openTab("plot", plot.id);
    });
  }

  /**
   * Ordination → graphs, for all six (PCoA · NMDS · CA · RDA · CCA · db-RDA). Which graphs is
   * decided by `ordinationGraphPlan` (core, tested there): an ordination has no loadings, so it
   * never gets the PCA suite's loadings plot or biplot — those draw an arrow per variable, and
   * there is no direction to draw. A constrained result earns the triplot instead of the plain
   * map. This function only files what the plan returns, so it needs no method list of its own.
   */
  function plotOrdinationFromAnalysis(id: NodeId): void {
    const a = project.analyses.find((x) => x.id === id);
    const ord = (a?.result?.extra as { ordination?: OrdinationData } | undefined)?.ordination;
    if (!a || !ord) return;
    const plan = ordinationGraphPlan(a.method, ord);
    if (plan.length === 0) return;
    // The PCA graph kinds read `PcaGraphData`. An empty `loadings` is the truthful value —
    // the score plot draws none, and the kinds that would have needed them are not built.
    const asPca: PcaGraphData = {
      varLabels: ord.varLabels ?? [],
      pcLabels: ord.pcLabels ?? [],
      loadings: [],
      scores: ord.scores,
      eigenvalues: ord.eigenvalues ?? [],
      explained: ord.explained ?? [],
      ...(ord.groups ? { groups: ord.groups } : {}),
      // The species points — the half of a correspondence analysis that PCA has no room for
      // (and, on a PCoA / NMDS map, the species placed by weighted averaging).
      ...(ord.speciesScores?.length ? { speciesScores: ord.speciesScores, speciesLabels: ord.varLabels ?? [] } : {}),
      // The constrained parts, for the triplot: the explanatory arrows, and both ways of
      // placing the cases so the graph's LC/WA switch has something to switch between.
      ...(ord.envScores?.length ? { envScores: ord.envScores, envLabels: ord.envLabels ?? [] } : {}),
      // An expanded factor level is drawn as a centroid, not an arrow — the engine names those
      // "Factor: level", which is the only place that distinction survives the payload.
      ...(ord.envLabels?.length ? { envIsFactor: ord.envLabels.map((l) => l.includes(": ")) } : {}),
      ...(ord.lcScores?.length ? { lcScores: ord.lcScores } : {}),
      ...(ord.waScores?.length ? { waScores: ord.waScores } : {}),
    };
    mutate((d) => {
      const loc = d.locationOf({ kind: "table", id: a.source });
      let firstId: NodeId | null = null;
      for (const g of plan) {
        if (g.role === "shepard" && g.table) {
          const tbl = d.importTable(`Shepard — ${a.name}`, "xy", g.table.columns, g.table.rows);
          const plot = d.addPlot(`${g.label} — ${a.name}`, tbl.id);
          const ys = tableDatasets(tbl);
          // points for the observed pairs, a line for the fitted monotone step
          if (ys[0]) d.setSeriesStyle(plot.id, ys[0].id, { connect: "none", symbol: "circle", symbolSize: 4 });
          if (ys[1]) d.setSeriesStyle(plot.id, ys[1].id, { connect: "straight", symbol: "none", lineWidth: 1.5 });
          d.setPlotOptions(plot.id, {
            analysisSource: a.id,
            ...(g.axisTitles ? { xAxis: { title: g.axisTitles.x }, yAxis: { title: g.axisTitles.y } } : {}),
          });
          d.fileObject({ kind: "table", id: tbl.id }, loc);
          d.fileObject({ kind: "plot", id: plot.id }, loc);
          firstId = firstId ?? plot.id;
          continue;
        }
        const plot = d.addPlot(`${g.label} — ${a.name}`, a.source);
        d.setPca(plot.id, asPca, g.kind);
        d.fileObject({ kind: "plot", id: plot.id }, loc);
        firstId = firstId ?? plot.id;
      }
      d.recompute();
      if (firstId) {
        d.appendLog("graph", `Plotted ${plan.map((g) => g.label).join(", ")} from "${a.name}"`, { refKind: "plot", refId: firstId });
        openTab("plot", firstId);
      }
    });
  }

  /** Build the forest + funnel pair from a meta-analysis result — both plots read the
   *  same meta sheet (table-fed, so they stay live), and their pooled diamond / pooled
   *  line use the same maths the analysis reports (proven equal in
   *  engine.metaanalysis.test.ts). A log-scale pooling gets the matching log effect axis. */
  function plotMetaFromAnalysis(id: NodeId): void {
    const a = project.analyses.find((x) => x.id === id);
    if (!a || a.method !== "metaanalysis") return;
    const log = a.params?.variant === "log";
    mutate((d) => {
      const loc = d.locationOf({ kind: "table", id: a.source });
      let firstId: NodeId | null = null;
      for (const s of [{ kind: "forest" as PlotKind, name: `Forest — ${a.name}` }, { kind: "funnel" as PlotKind, name: `Funnel — ${a.name}` }]) {
        const plot = d.addPlot(s.name, a.source);
        d.setPlotKind(plot.id, s.kind);
        d.setPlotOptions(plot.id, {
          analysisSource: a.id,
          ...(s.kind === "forest" ? { forest: { showSummary: true } } : {}),
          ...(log ? { xAxis: { scale: "log10" } } : {}),
        });
        d.fileObject({ kind: "plot", id: plot.id }, loc);
        firstId = firstId ?? plot.id;
      }
      d.recompute();
      if (firstId) {
        d.appendLog("graph", `Plotted forest + funnel from "${a.name}"`, { refKind: "plot", refId: firstId });
        openTab("plot", firstId);
      }
    });
  }

  /** Build the funnel with the Trim-and-fill overlay from a publication-bias result —
   *  the plot reads the same meta sheet, and the overlay's hollow dots + adjusted line
   *  use the same core maths the analysis reports (engine ≡ TS ≡ crosscheck, proven in
   *  engine.publicationbias.test.ts). A log-scale assessment gets the log effect axis. */
  function plotBiasFunnelFromAnalysis(id: NodeId): void {
    const a = project.analyses.find((x) => x.id === id);
    if (!a || a.method !== "publicationbias") return;
    const log = a.params?.variant === "log";
    mutate((d) => {
      const loc = d.locationOf({ kind: "table", id: a.source });
      const plot = d.addPlot(`Funnel (trim-and-fill) — ${a.name}`, a.source);
      d.setPlotKind(plot.id, "funnel");
      d.setPlotOptions(plot.id, {
        analysisSource: a.id,
        funnel: { trimFill: true },
        ...(log ? { xAxis: { scale: "log10" } } : {}),
      });
      d.fileObject({ kind: "plot", id: plot.id }, loc);
      d.recompute();
      d.appendLog("graph", `Plotted funnel with trim-and-fill from "${a.name}"`, { refKind: "plot", refId: plot.id });
      openTab("plot", plot.id);
    });
  }

  /** Build the residual-diagnostic graph suite from an analysis that ships residual
   *  arrays (regression / curve fit / one-way·two-way·RM ANOVA / ANCOVA / parametric
   *  t-tests). Adds up to four residual-diagnostic graphs in one undoable step:
   *    1. Residual vs predicted — random scatter ⇒ good fit; a funnel ⇒
   *       heteroscedasticity; a curve ⇒ wrong/nonlinear model. (+ a flat y = 0 line.)
   *    2. QQ plot of residuals — points hug the line when the residuals are normal.
   *    3. Histogram of residuals — the residual distribution's shape directly.
   *    4. Scale-location — √|standardised residual| vs predicted; a rising trend ⇒
   *       non-constant variance (only when there are ≥ 2 distinct fitted values).
   *  Data are static (residuals come from the sidecar, not a pure core engine), so
   *  they go in via `importTable`. */
  function plotResidualsFromAnalysis(id: NodeId): void {
    const a = project.analyses.find((x) => x.id === id);
    const res = (a?.result?.extra as { residuals?: { fitted: number[]; resid: number[] } } | undefined)?.residuals;
    if (!a || !res || !Array.isArray(res.resid) || !Array.isArray(res.fitted)) return;
    // Build all four diagnostic tables from the tested pure helper, then turn each
    // into a graph. Returns null (→ no-op) for < 3 finite paired points.
    const diag = residualDiagnostics(res.fitted, res.resid);
    if (!diag) return;
    const loc = (d: MadyDocument): ReturnType<MadyDocument["locationOf"]> =>
      d.locationOf({ kind: "table", id: a.source });
    mutate((d) => {
      const fileBoth = (tableId: NodeId, plotId: NodeId): void => {
        d.recompute();
        d.fileObject({ kind: "table", id: tableId }, loc(d));
        d.fileObject({ kind: "plot", id: plotId }, loc(d));
      };

      // 1) Residual vs predicted: residual = markers (no line), zero = line (no markers).
      const rvp = d.importTable(`Residuals — ${a.name}`, "xy", diag.residualVsPredicted.columns, diag.residualVsPredicted.rows);
      const rvpPlot = d.addPlot(`Residual vs predicted — ${a.name}`, rvp.id);
      const rvpYs = tableDatasets(rvp);
      if (rvpYs[0]) d.setSeriesStyle(rvpPlot.id, rvpYs[0].id, { connect: "none", symbol: "circle", symbolSize: 5 });
      if (rvpYs[1]) d.setSeriesStyle(rvpPlot.id, rvpYs[1].id, { connect: "straight", symbol: "none", lineWidth: 1 });
      fileBoth(rvp.id, rvpPlot.id);

      // 2) QQ plot of the residuals (reuses the normal-probability machinery).
      const qqTbl = d.importTable(`QQ of residuals — ${a.name}`, "xy", diag.qq.columns, diag.qq.rows);
      const qqPlot = d.addPlot(`QQ of residuals — ${a.name}`, qqTbl.id);
      const qqYs = tableDatasets(qqTbl);
      if (qqYs[0]) d.setSeriesStyle(qqPlot.id, qqYs[0].id, { connect: "none", symbol: "circle", symbolSize: 5 });
      if (qqYs[1]) d.setSeriesStyle(qqPlot.id, qqYs[1].id, { connect: "straight", symbol: "none", lineWidth: 1.5 });
      fileBoth(qqTbl.id, qqPlot.id);

      // 3) Histogram of the residuals (bar chart of bin-centre vs count).
      if (diag.histogram) {
        const histTbl = d.importTable(`Residual histogram — ${a.name}`, "xy", diag.histogram.columns, diag.histogram.rows);
        const histPlot = d.addPlot(`Residual histogram — ${a.name}`, histTbl.id);
        d.setPlotKind(histPlot.id, "bar");
        fileBoth(histTbl.id, histPlot.id);
      }

      // 4) Scale-location: √|standardised residual| vs predicted (omitted for the
      //    degenerate zero-spread / constant-ŷ case).
      if (diag.scaleLocation) {
        const slTbl = d.importTable(`Scale-location — ${a.name}`, "xy", diag.scaleLocation.columns, diag.scaleLocation.rows);
        const slPlot = d.addPlot(`Scale-location — ${a.name}`, slTbl.id);
        const slYs = tableDatasets(slTbl);
        if (slYs[0]) d.setSeriesStyle(slPlot.id, slYs[0].id, { connect: "none", symbol: "circle", symbolSize: 5 });
        fileBoth(slTbl.id, slPlot.id);
      }

      d.appendLog("graph", `Plotted residual diagnostics (vs-predicted, QQ, histogram, scale-location) from "${a.name}"`, {
        refKind: "plot",
        refId: rvpPlot.id,
      });
      openTab("plot", rvpPlot.id);
    });
  }

  /** Export an analysis's results table to CSV or Excel (a Save dialog opens). */
  function exportAnalysis(id: NodeId, format: "csv" | "xlsx"): void {
    const a = project.analyses.find((x) => x.id === id);
    if (!a?.result) return;
    const suggestedName = a.name.replace(/[^\w.-]+/g, "_") || "analysis";
    if (format === "csv") {
      void runExport({ format: "csv", suggestedName, text: analysisToCsv(a.result, a.params?.conf) });
    } else {
      const grid = analysisResultGrid(a.result, a.params?.conf);
      void runExport({
        format: "xlsx",
        suggestedName,
        sheet: { name: excelSheetName(a.result.title), columns: grid.columns, rows: grid.rows },
      });
    }
  }

  /** Drop the analysis's key result (p-value / effect size / R² …) as a movable,
   *  editable text label onto a graph of the same source data. */
  function annotateStatsFromAnalysis(id: NodeId): void {
    const a = project.analyses.find((x) => x.id === id);
    if (!a?.result) return;
    const line = keyMetricLine(a.result);
    if (!line) return;
    const target = project.plots.find((p) => p.source === a.source);
    if (!target) {
      mutate((d) =>
        d.appendLog("graph", "Open a graph of this data first, then add its key stats.", {
          refKind: "analysis",
          refId: id,
        }),
      );
      return;
    }
    mutate((d) => {
      d.addAnnotations(target.id, [{ kind: "text" as const, x: 0.5, y: 0.07, label: line, size: 14 }]);
      d.appendLog("graph", `Added key result “${line}” to "${target.name}".`, { refKind: "plot", refId: target.id });
      openTab("plot", target.id);
    });
  }

  const activeTab = openTabs.find((t) => t.key === activeKey);
  // Reading the documentation: both side docks collapse (see `tempDockOpen`). The arrange
  // view is a full-page builder of its own, so it is never the Docs tab.
  const readingDocs =
    layoutView == null &&
    (activeTab?.kind === "guide" || activeTab?.kind === "about" || activeTab?.kind === "licence");
  /**
   * Every page that is not a graph suppresses the Inspector — and only the Inspector.
   *
   * The rule: collapsed by default on the chart gallery, a datasheet, an
   * analysis sheet, the docs and the Welcome page; open by default on a graph. Opening a graph
   * legitimately writes `collapsed.inspector = false`, so without this every later datasheet,
   * gallery or analysis would keep the panel open beside a page with nothing to format.
   * The arrange view (`layoutView`) is a figure builder and is never suppressed — its panel
   * clicks open the Inspector as on any graph. The Navigator is not suppressed here: it is
   * how you leave these pages (only the Docs tabs hide it, above).
   */
  const nothingToInspect = layoutView == null && activeTab?.kind !== "plot";
  /** Does this tab hide this dock by default? Both are render-time only — never a write. */
  const dockSuppressed = (id: SideDockId): boolean => readingDocs || (nothingToInspect && id === "inspector");
  /** What a side dock should actually draw as, right now. */
  const dockCollapsed = (id: SideDockId): boolean =>
    dockSuppressed(id) ? !tempDockOpen[id] : layout.collapsed[id];
  /** Toggling a suppressed dock moves the override, never the saved layout. */
  const toggleDockNow = (id: SideDockId): void => {
    if (dockSuppressed(id)) setTempDockOpen((s) => ({ ...s, [id]: !s[id] }));
    else toggleDock(id);
  };
  /**
   * Opening a graph opens the Inspector.
   *
   * A graph is the one object in the program that is mostly formatting, so landing on one
   * with the formatting panel shut hides the entire point of the pane — the user opens a
   * figure from the tree and the controls for it are behind a 30px rail. This fires on the
   * tab, not on a click inside the figure: selecting a series is not the moment the panel
   * becomes useful, arriving at the graph is.
   *
   * Keyed on `activeKey`, so collapsing it while working on that graph still sticks — it
   * reopens the next time you come to a graph, not on the next re-render.
   */
  useEffect(() => {
    if (activeTab?.kind === "plot" && !readingDocs) openDock("inspector");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey]);
  // …and selecting anything on a figure, for the cases the tab effect cannot cover: a panel
  // picked inside the arrange view, where there is no plot tab to key on.
  // A selection made where the Inspector is suppressed opens the per-tab override, so a click
  // still brings the panel up there too.
  useEffect(() => {
    if (!selection || readingDocs) return;
    if (dockSuppressed("inspector")) setTempDockOpen((s) => ({ ...s, inspector: true }));
    else openDock("inspector");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection]);
  // A panel selected in the arrange view edits as the active plot (so the whole
  // Inspector + all edit handlers + direct-manipulation flow target it).
  const arrangeEditing = layoutView != null && arrangePlot != null;
  const activeSection: Section = arrangeEditing ? "graphs" : activeTab ? TAB_GROUP[activeTab.kind] : "graphs";
  const activePlot = arrangeEditing
    ? project.plots.find((p) => p.id === arrangePlot)
    : activeTab?.kind === "plot"
      ? project.plots.find((p) => p.id === activeTab.id)
      : undefined;
  const activeTable = activePlot ? project.tables.find((t) => t.id === activePlot.source) : undefined;

  /**
   * What the guided tour reads off the program (`tour.ts`), rebuilt each render while it runs.
   * The fingerprint is the whole plot as JSON: "the reader changed something on the graph" is
   * true for any edit and false for a selection or a zoom, which is exactly the distinction
   * the "change a colour" step needs. Not computed when the tour is off — a plot serialised on
   * every keystroke for a feature nobody opened would be a cost for nothing.
   */
  /**
   * Bring what a tour step needs in front (`TourStep.needs`): the reader's own suitable object
   * when the project has one — the graph's sheet, the sheet's graph, any Column sheet — else a
   * generated sample (a reader who wants to take the tutorial without data of their own
   * gets generated data). Every object made here is named "(tour
   * sample)" so it is recognisable and disposable.
   */
  const reachTourNeed: TourReach = (need, opts = {}): void => {
    const tables = project.tables;
    const plotOf = (tableId: NodeId): Plot | undefined => project.plots.find((p) => p.source === tableId);
    const makeSheet = (kind: "xy" | "column"): NodeId => {
      let id: NodeId = "";
      mutate((d) => {
        if (kind === "xy") {
          const rows = TOUR_SAMPLE_TSV.split("\n").map((r) => r.split("\t"));
          const t = d.addTable("Dose–response (tour sample)", "xy", rows[0]!);
          for (const r of rows.slice(1)) d.addRow(t.id, r.map(Number));
          id = t.id;
        } else {
          const t = d.addTable("Three groups (tour sample)", "column", ["Vehicle", "Low dose", "High dose"]);
          for (const r of [[8, 16, 26], [11, 19, 30], [9, 20, 27], [12, 17, 31], [10, 21, 25], [13, 18, 29], [9, 15, 28], [11, 22, 33]]) d.addRow(t.id, r);
          id = t.id;
        }
        d.recompute();
      });
      return id;
    };
    const makeGraph = (tableId: NodeId, kind: "xy" | "column"): NodeId => {
      let id: NodeId = "";
      mutate((d) => {
        const p = d.addPlot(kind === "xy" ? "Dose–response (tour sample)" : "Three groups (tour sample)", tableId);
        if (kind === "column") d.setPlotKind(p.id, "bar");
        d.recompute();
        id = p.id;
      });
      return id;
    };
    const openGraphOf = (tableId: NodeId, kind: "xy" | "column"): void => openTab("plot", plotOf(tableId)?.id ?? makeGraph(tableId, kind));
    const wantsColumn = need.startsWith("column");
    // Already there: a met need is never "reached" again (doing so would open the first graph in
    // the project — the demo's — on top of the graph the tour had just created).
    if (!opts.generate && needMet(need, tourState) && (!opts.preferId || (need.endsWith("sheet") ? tourState.sheet?.id : tourState.activePlot?.plot.id) === opts.preferId)) return;
    // A figure is not made of sample data: the sample button and the automatic reach both open the
    // figure asked for, else the project's first one, else a fresh empty one (the builder in front).
    if (need === "figure") {
      const wanted = opts.preferId ? project.layouts?.find((l) => l.id === opts.preferId) : undefined;
      const any = wanted ?? project.layouts?.[0];
      if (any) openLayout(any.id);
      else createLayout();
      return;
    }
    // The reader pressed the sample button: the sample sheet of that kind — the one already made
    // if there is one (two tours in a row must not leave two "(tour sample)" sheets), else fresh.
    if (opts.generate) {
      const existing = tables.find((x) => x.name.endsWith("(tour sample)") && x.kind === (wantsColumn ? "column" : "xy"));
      const t = existing?.id ?? makeSheet(wantsColumn ? "column" : "xy");
      if (need.endsWith("sheet")) openTab("table", t);
      else openGraphOf(t, wantsColumn ? "column" : "xy");
      return;
    }
    // Back to the object the tour was working on a moment ago, if it still exists and fits.
    if (opts.preferId) {
      if (need.endsWith("sheet")) {
        const t = tables.find((x) => x.id === opts.preferId);
        if (t && (!wantsColumn || t.kind === "column")) return openTab("table", t.id);
      } else {
        const p = project.plots.find((x) => x.id === opts.preferId);
        const src = p ? tables.find((x) => x.id === p.source) : undefined;
        if (p && (!wantsColumn || src?.kind === "column")) return openTab("plot", p.id);
      }
    }
    switch (need) {
      case "sheet": {
        const own = activeTable ?? activeTableTab ?? tables.find((t) => t.rows.length > 0);
        openTab("table", own?.id ?? makeSheet("xy"));
        return;
      }
      case "graph": {
        if (activeTableTab) return openGraphOf(activeTableTab.id, activeTableTab.kind === "column" ? "column" : "xy");
        const any = project.plots[0];
        if (any) return openTab("plot", any.id);
        return openGraphOf(makeSheet("xy"), "xy");
      }
      case "column-sheet": {
        const own = [activeTable, activeTableTab, ...tables].find((t) => t?.kind === "column" && t.rows.length > 0);
        openTab("table", own?.id ?? makeSheet("column"));
        return;
      }
      case "column-graph": {
        const own = [activeTable, activeTableTab, ...tables].find((t) => t?.kind === "column" && t.rows.length > 0);
        openGraphOf(own?.id ?? makeSheet("column"), "column");
        return;
      }
    }
  };
  /**
   * The tour's Next on a step the reader has not done: the program performs it (`TourPerform`). One
   * case per action step, each the same document operation the reader's gesture would make, so
   * the step's own done-check fires and the tour moves on. Returns false when there is nothing
   * to do (the tour then moves on at once).
   */
  const performTourStep: TourPerform = (step): boolean => {
    const sheet = activeTableTab;
    const firstSeries = (): NodeId | undefined => (activeTable ? tableDatasets(activeTable)[0]?.id : undefined);
    switch (step.id) {
      case "copy":
      case "paste":
      case "import":
        if (importSrc) setImportSrc(null);
        if (!sheet) reachTourNeed("sheet", { generate: true });
        return true;
      case "newgraph":
        reachTourNeed("graph", {});
        return true;
      case "create":
        // The dialog is up: closing it and making the graph of the sheet is what Create would do.
        // A graph already in front (the previous step made it) is left alone.
        if (newGraphOpen) {
          setNewGraphOpen(false);
          setNewGraphTableId(null);
        }
        if (activePlot) return newGraphOpen;
        reachTourNeed("graph", {});
        return true;
      case "select":
      case "select-series": {
        const id = firstSeries();
        if (!id) return false;
        setSelection({ kind: "series", columnId: id });
        return true;
      }
      case "select-plot":
        setSelection({ kind: "plot" });
        return true;
      case "select-axis":
        setSelection({ kind: "axis", axis: "y" });
        return true;
      case "colour": {
        const id = firstSeries();
        if (!id) return false;
        setSeriesStyle(id, { color: "#c0392b" });
        return true;
      }
      case "shape": {
        const id = firstSeries();
        if (!id) return false;
        setSeriesStyle(id, { symbol: "square" });
        return true;
      }
      case "connect": {
        const id = firstSeries();
        if (!id) return false;
        setSeriesStyle(id, { connect: "smooth" });
        return true;
      }
      case "thickness": {
        const id = firstSeries();
        if (!id) return false;
        setSeriesStyle(id, { lineWidth: 4 });
        return true;
      }
      case "title":
        if (!activePlot) return false;
        mutate((d) => d.setGraphTitle(activePlot.id, { title: `${activePlot.title ?? activePlot.name} — titled` }));
        return true;
      case "export":
        exportActive();
        return true;
      case "exportgo":
        setExportTarget(null);
        return true;
      case "add-column":
        if (!sheet) return false;
        mutate((d) => d.addColumn(sheet.id));
        return true;
      case "type-values": {
        if (!sheet) return false;
        const col = sheet.columns[sheet.columns.length - 1];
        if (!col) return false;
        mutate((d) => {
          const row = sheet.rows[0] ?? d.addRow(sheet.id, []);
          d.setCell(sheet.id, row.id, col.id, 5);
        });
        return true;
      }
      case "select-cells":
        if (!sheet) return false;
        setDataSel({ tableId: sheet.id, r0: 1, c0: 1, r1: 1, c1: 1 });
        return true;
      case "exclude": {
        if (!sheet) return false;
        const row = sheet.rows[1] ?? sheet.rows[0];
        const col = sheet.columns[1] ?? sheet.columns[0];
        if (!row || !col) return false;
        setDataSel({ tableId: sheet.id, r0: sheet.rows.indexOf(row), c0: sheet.columns.indexOf(col), r1: sheet.rows.indexOf(row), c1: sheet.columns.indexOf(col) });
        mutate((d) => d.setCellsExcluded(sheet.id, [{ rowId: row.id, colId: col.id }], true));
        return true;
      }
      case "include": {
        if (!sheet) return false;
        const cells = Object.entries(sheet.excluded ?? {}).flatMap(([rowId, cols]) => cols.map((colId) => ({ rowId, colId })));
        if (cells.length === 0) return false;
        mutate((d) => d.setCellsExcluded(sheet.id, cells, false));
        return true;
      }
      case "range":
        setAxis("y", { min: 1 });
        return true;
      case "ticks":
        setAxis("y", { majorStep: 10 });
        return true;
      case "minor":
        setAxis("y", { minorCount: 3 });
        return true;
      case "break":
        setAxis("y", { breaks: [{ from: 40, to: 60 }] });
        return true;
      case "grid":
        setGrid({ show: true });
        return true;
      case "frame":
        setFrame({ frame: "box" });
        return true;
      case "background":
        setPlotOptions({ background: "transparent" });
        return true;
      case "preset": {
        const p = STYLE_PRESETS[1] ?? STYLE_PRESETS[0];
        if (!p) return false;
        applyStylePreset(p);
        return true;
      }
      case "analyze":
        openAnalyze();
        return true;
      case "fit-run": {
        if (!analyzeTable) return false;
        const cols = analyzeTable.columns.slice(0, 2).map((c) => c.id);
        setAnalyzeOpen(false);
        void confirmAnalyze({ method: "regression", variant: "linear", columns: cols });
        return true;
      }
      case "compare-run": {
        if (!analyzeTable) return false;
        const cols = tableDatasets(analyzeTable).slice(0, 2).map((d) => d.id);
        setAnalyzeOpen(false);
        void confirmAnalyze({ method: "ttest", variant: "unpaired", columns: cols });
        return true;
      }
      case "markers": {
        const a = [...project.analyses].reverse().find((x) => (x.result?.terms ?? []).some((t) => t.term.includes(" vs ") && t.p != null));
        if (!a) return false;
        addBracketsFromAnalysis(a.id);
        return true;
      }
      case "sig-style":
        setSignificance({ shape: "rounded" });
        return true;
      case "add-text":
        if (!activePlot) return false;
        annotationOps.add({ kind: "text", label: "A note", x: 0.5, y: 0.12 });
        return true;
      case "add-arrow":
        if (!activePlot) return false;
        annotationOps.add({ kind: "arrow", x: 0.3, y: 0.55, x2: 0.6, y2: 0.35, arrowHead: "end" });
        return true;
      case "add-band":
        if (!activePlot) return false;
        annotationOps.add({ kind: "hband", y: 0.4, h: 0.2, fill: "#9b8cff", fillOpacity: 0.16 });
        return true;
      case "dose-door":
        openAnalyzeFocus({ method: "curvefit", variant: "4pl", focusKind: "dose-response" });
        return true;
      case "run-fit": {
        // An XY fit takes [X, Y] — one Y column alone is refused as "curve fit needs ≥ 3 points".
        if (!analyzeTable) return false;
        const cols = analyzeTable.columns.slice(0, 2).map((c) => c.id);
        setAnalyzeOpen(false);
        void confirmAnalyze({ method: "curvefit", variant: "4pl", columns: cols });
        return true;
      }
      case "new-figure":
        createLayout();
        return true;
      case "pick-graphs": {
        const l = layoutView ? project.layouts?.find((x) => x.id === layoutView) : undefined;
        if (!l) return false;
        const missing = project.plots.filter((p) => !l.panels.includes(p.id)).slice(0, Math.max(0, 2 - l.panels.length) || 1);
        if (missing.length === 0) return false;
        for (const p of missing) layoutOps.addPanel(l.id, p.id);
        return true;
      }
      case "arrange": {
        const l = layoutView ? project.layouts?.find((x) => x.id === layoutView) : undefined;
        if (!l) return false;
        // The Arrange tab is the builder's own state: press the button the card names, then set the columns.
        document.querySelector<HTMLButtonElement>('button.addbtn[title^="Open the arrangement tab"]')?.click();
        layoutOps.setOptions(l.id, { columns: l.columns === 2 ? 1 : 2 });
        return true;
      }
      case "export-figure":
        exportFigure();
        return true;
      case "exportgo-figure":
        setExportTarget(null);
        return true;
      default:
        return false;
    }
  };
  /** The tour's "Put sample numbers on the clipboard": the OS clipboard in the app, the page's in a browser. */
  const copyTourSample = (): void => {
    if (window.mady?.copyTextToClipboard) window.mady.copyTextToClipboard(TOUR_SAMPLE_TSV);
    else void navigator.clipboard?.writeText(TOUR_SAMPLE_TSV);
  };
  /** Any table of the project by id — the lookup `plot.overlays` (series borrowed from other
   *  datasheets) is resolved through, wherever a scene is built or a plot's series are listed. */
  const tableLookup = (id: NodeId): DataTable | undefined => project.tables.find((t) => t.id === id);
  /** The active plot's table with its overlays joined in — what the Inspector and every
   *  series-listing / click-routing site see, so a borrowed series is a first-class series there.
   *  read paths only: a datasheet mutation (rename a column, set a cell) keeps `activeTable`,
   *  because the joined table is a view, not a document node. */
  const joinedActive = activePlot && activeTable ? resolveOverlays(activeTable, activePlot, tableLookup) : undefined;
  const plotTable = joinedActive?.table ?? activeTable;
  const foreignSeries: Record<NodeId, string> | undefined =
    joinedActive && joinedActive.foreign.size > 0 ? Object.fromEntries([...joinedActive.foreign].map(([id, f]) => [id, f.name])) : undefined;
  const activeTableTab =
    activeTab?.kind === "table" ? project.tables.find((t) => t.id === activeTab.id) : undefined;
  // An open analysis result also counts as "viewing" its source data (the Assistant
  // suggests next steps for that sheet).
  const activeAnalysisTab =
    activeTab?.kind === "analysis" ? project.analyses.find((a) => a.id === activeTab.id) : undefined;
  // Keep the agent bridge's active-selection view current (agent edition only; the ref is
  // read lazily inside window.madyAgent, so updating it here each render is enough).
  agentActiveRef.current = { graphId: activePlot?.id, tableId: activePlot?.source ?? activeTableTab?.id };
  // The bug reporter's interaction trail stamps each gesture with the document version —
  // a drag after which the version did not move is the silent no-op. Refreshed every
  // render, same pattern as the agent ref above.
  noteDocVersion(version);

  // The NL command bar (side panel): compile a line of plain language against the live
  // tables + active selection, then execute it on the document. Deterministic + offline
  // (the same core compiler window.madyAgent.run uses).
  const runNL = (text: string): NlRunOutcome => {
    const ctx: NLContext = {
      tables: project.tables.map((t) => ({ id: t.id, name: t.name, columns: t.columns.map((c) => ({ id: c.id, name: c.name })) })),
      activeTableId: agentActiveRef.current.tableId,
      activeGraphId: agentActiveRef.current.graphId,
    };
    const compiled = compileNL(text, ctx) as NLResult;
    if (!compiled.ok) return { compiled };
    let results: AgentResult[] = [];
    mutate((d) => {
      results = executeAgentBatch(d, compiled.commands);
    });
    return { compiled, results };
  };
  // The model bar: the same context the Ask box builds, compiled in main (exact parser first,
  // the model second), then applied here through the same `mutate` as every click — one undo
  // entry — and described back in words. Nothing about the document is decided in main.
  const nlContext = (): NLContext => ({
    tables: project.tables.map((t) => ({ id: t.id, name: t.name, columns: t.columns.map((c) => ({ id: c.id, name: c.name })) })),
    activeTableId: agentActiveRef.current.tableId,
    activeGraphId: agentActiveRef.current.graphId,
  });
  const compileWithModel = (text: string) => {
    const bridge = window.mady?.compileWithModel;
    if (!bridge) return Promise.resolve({ ok: false, error: "the local model could not be asked: this copy of MadY has no connection to it" });
    return bridge(text, nlContext());
  };
  const applyModelCommands = (commands: Record<string, unknown>[]): AgentResult[] => {
    let results: AgentResult[] = [];
    mutate((d) => {
      results = executeAgentBatch(d, commands);
    });
    return results;
  };
  const describeForBar = (cmd: Record<string, unknown>): string =>
    describeCommand(cmd, {
      tables: project.tables.map((t) => ({ id: t.id, name: t.name })),
      graphs: project.plots.map((p) => ({ id: p.id, name: p.name })),
    });
  // The panel-builder page (opened from the tree) shows this figure; its Choose-
  // graphs + Arrange tabs are local to that page. Export/inspector read from it.
  const activeLayout = layoutView ? project.layouts?.find((l) => l.id === layoutView) : undefined;
  const dedicatedLayout = activeLayout;
  // "Show key stats" overlay for the active graph: the most recent analysis of its
  // source data that has a headline metric → an on/off toggle that adds/removes a
  // movable stats label on the graph.
  const statsAnalysis = activePlot
    ? [...project.analyses].reverse().find((a) => a.source === activePlot.source && a.result && keyMetricLine(a.result))
    : undefined;
  const statsOverlay = activePlot
    ? {
        available: Boolean(statsAnalysis),
        on: Boolean(activePlot.annotations?.some((a) => a.role === "stats")),
        onToggle: (on: boolean): void => {
          const plotId = activePlot.id;
          mutate((d) => {
            for (const a of activePlot.annotations ?? []) {
              if (a.role === "stats") d.removeAnnotation(plotId, a.id);
            }
            if (on && statsAnalysis?.result) {
              d.addAnnotations(plotId, [
                { kind: "text" as const, role: "stats" as const, x: 0.5, y: 0.07, label: keyMetricLine(statsAnalysis.result), size: 14 },
              ]);
            }
          });
        },
      }
    : undefined;
  // "Show fit equation" overlay: the most recent curve-fit / regression of this
  // graph's data → a movable, editable label of the best-fit equation (true formula
  // with fitted values where one exists, else the parameter-value summary). Mirrors
  // the key-stats overlay, keyed on a `role:"equation"` managed annotation.
  const fitAnalysis = activePlot
    ? [...project.analyses]
        .reverse()
        .find((a) => a.source === activePlot.source && a.result && fitEquationLabel(a.method, a.params.variant, a.result))
    : undefined;
  const equationOverlay = activePlot
    ? {
        available: Boolean(fitAnalysis),
        on: Boolean(activePlot.annotations?.some((a) => a.role === "equation")),
        onToggle: (on: boolean): void => {
          const plotId = activePlot.id;
          mutate((d) => {
            for (const a of activePlot.annotations ?? []) {
              if (a.role === "equation") d.removeAnnotation(plotId, a.id);
            }
            const label = fitAnalysis?.result ? fitEquationLabel(fitAnalysis.method, fitAnalysis.params.variant, fitAnalysis.result) : null;
            if (on && label) {
              d.addAnnotations(plotId, [{ kind: "text" as const, role: "equation" as const, x: 0.5, y: 0.14, label, size: 13 }]);
            }
          });
        },
      }
    : undefined;

  // The table the Analyze dialog (and the Data-menu tools) will act on: the active table,
  // else the active graph's source, else the open analysis result's source, else the
  // first table. The analysis step makes Analyze pressed on an analysis tab target the data
  // the result on screen came from, not the first sheet.
  const analyzeTable =
    activeTableTab ??
    activeTable ??
    (activeAnalysisTab ? project.tables.find((t) => t.id === activeAnalysisTab.source) : undefined) ??
    project.tables[0];
  /**
   * The datasheet the user is actually working in — deliberately without `analyzeTable`'s
   * fallback to `project.tables[0]`.
   *
   * That fallback is right for Analyze (a test needs some table to run on), but seeding the
   * new-datasheet creator from it would, on a fresh launch — nothing of the user's open,
   * only the demo project in the tree — pick up the demo sheet's format and badge it
   * "Your data" for someone who has not entered any. A default is fine; claiming it
   * came from their data is not.
   */
  const workingTable = activeTableTab ?? activeTable;
  /** What the guided tour reads off the program (`tour.ts`) — see the note above `copyTourSample`. */
  const tourState: TourState = {
    tables: project.tables.length,
    plots: project.plots.length,
    analyses: project.analyses.length,
    importOpen: importSrc !== null,
    newGraphOpen,
    exportOpen: exportTarget !== null,
    analyzeOpen,
    selectionKind: selection?.kind ?? null,
    workingTableKind: workingTable?.kind ?? null,
    sigMarkers: tourId ? project.plots.reduce((n, p) => n + (p.annotations ?? []).filter((a) => a.sig?.analysisId).length, 0) : 0,
    sheetInFront: activeTableTab !== undefined,
    sheet: tourId && activeTableTab ? { id: activeTableTab.id, columns: activeTableTab.columns.length, excluded: excludedCount(activeTableTab), fingerprint: JSON.stringify(activeTableTab) } : null,
    dataSelection: dataSel !== null,
    // The drawn title is `plot.title ?? plot.name` (buildScene) — compare what the reader sees.
    activePlot: tourId && activePlot ? { title: activePlot.title ?? activePlot.name, fingerprint: JSON.stringify(activePlot), plot: activePlot } : null,
    figureOpen: layoutView !== null,
    figure: (() => {
      const l = tourId && layoutView ? project.layouts?.find((x) => x.id === layoutView) : undefined;
      return l ? { id: l.id, panels: l.panels.length, fingerprint: JSON.stringify(l) } : null;
    })(),
  };
  // The sheet the New-graph dialog opens on: the one "New graph of this data" named, else the
  // working table (Graph ▸ New graph… / File ▸ New datasheet / graph…).
  const newGraphTable = (newGraphTableId ? project.tables.find((t) => t.id === newGraphTableId) : undefined) ?? workingTable;
  const openAnalyze = (): void => {
    setAnalyzePreset(null);
    setPendingAnalyzeSuggestion(null);
    if (analyzeTable) setAnalyzeOpen(true);
  };
  /** Guided front doors — open Analyze straight into a family/analysis (keyed into
   *  AnalyzeDialog's ANALYZE_FOCUS for the title + banner). Generalises the dose-response door. */
  const openAnalyzeFocus = (preset: { method: string; variant?: string; focusKind: string }): void => {
    setAnalyzePreset(preset);
    setPendingAnalyzeSuggestion(null);
    if (analyzeTable) setAnalyzeOpen(true);
  };

  // --- export (graph PNG/SVG, data CSV) -----------------------------------

  /** Open the export dialog for whatever is active (a graph, a figure, or a data table). */
  function exportActive(): void {
    if (activePlot) exportGraph();
    else if (activeLayout) exportFigure();
    else if (activeTableTab) exportData();
  }
  /** Export the active graph (above-the-graph action). */
  function exportGraph(): void {
    if (activePlot) setExportTarget({ kind: "plot", source: "graph", name: activePlot.name, plotId: activePlot.id });
  }
  /** Export the active multi-panel figure (above-the-panels action). */
  function exportFigure(): void {
    if (activeLayout) setExportTarget({ kind: "plot", source: "figure", name: activeLayout.name });
  }
  /** Export the active dataset (above-the-data action). */
  function exportData(): void {
    if (activeTableTab) setExportTarget({ kind: "table", name: activeTableTab.name, table: activeTableTab });
  }
  const canExport = Boolean(activePlot || activeTableTab || activeLayout);

  // --- copy to the clipboard (Graph ▸ Copy as picture / Copy as SVG, Ctrl+Shift+C, right-click) ---

  /** The drawing in front, serialized on a transparent page with no margin — the same source the
   *  Export dialog's own Copy buttons read; the target choice mirrors `exportActive`. */
  function copySourceActive(): SerializedSvg | null {
    if (activePlot) {
      const svg = activeGraphSvg(activePlot.id);
      return svg ? serializeGraphSvg(svg, { background: "transparent", margin: 0 }) : null;
    }
    if (activeLayout) return composeActiveFigureSvg({ background: "transparent", margin: 0 });
    return null;
  }
  function flashNote(text: string): void {
    setFlash(text);
    window.setTimeout(() => setFlash((f) => (f === text ? null : f)), 1800);
  }
  function sayCopyOutcome(outcome: "copied" | "no-source" | "no-bridge", what: string): void {
    if (outcome === "copied") flashNote(`Copied as ${what}`);
    else if (outcome === "no-bridge") window.alert("Copying to the clipboard needs the desktop app.");
    else window.alert("Nothing is in front to copy — open a graph or a figure first.");
  }
  /**
   * Export all: pick the folder, then draw every chosen graph / figure on the off-screen stage in turn and
   * write each file through main (`file:exportMany`, which only writes into the folder just picked). null = the folder
   * pick was cancelled. The stage is unmounted again whatever happens.
   */
  async function runExportAll(opts: ExportAllOptions, onProgress: (done: number, total: number) => void): Promise<BatchResult | null> {
    const api = window.mady;
    if (!api?.pickExportFolder || !api.exportMany) throw new Error("Export all needs the desktop app.");
    const dir = await api.pickExportFolder();
    if (!dir) return null;
    const items: BatchItem[] = [
      ...(opts.graphs ? project.plots.map((p) => ({ id: p.id, kind: "graph" as const, name: p.name, printWidthMm: p.printWidthMm, displayScale: graphDisplayScale(p, effectiveFit) })) : []),
      ...(opts.figures ? (project.layouts ?? []).map((l) => ({ id: l.id, kind: "figure" as const, name: l.name, printWidthMm: l.page?.wMm })) : []),
    ];
    // Draw one item on the stage and hand back a reader for it, once it is laid out.
    const mount = (item: BatchItem): Promise<MountedItem | null> =>
      new Promise((resolve) => {
        stageReady.current = (root) => {
          stageReady.current = null;
          resolve({
            serialize: (bg) => {
              if (item.kind === "figure") return composeActiveFigureSvg({ background: bg, root });
              const svg = activeGraphSvg(undefined, root);
              return svg ? serializeGraphSvg(svg, { background: bg }) : null;
            },
          });
        };
        setStageItem(item);
      });
    try {
      return await runBatchExport({
        items, format: opts.format, dpi: opts.dpi, background: opts.background, pattern: opts.pattern,
        mount,
        write: async (files) => (await api.exportMany({ dir, files, replace: opts.replace })).results,
        onProgress,
      });
    } finally {
      setStageItem(null);
      stageReady.current = null;
    }
  }

  async function copyPictureActive(): Promise<void> {
    const outcome = await copyAsPicture({
      source: copySourceActive(),
      displayScale: activePlot ? graphDisplayScale(activePlot, effectiveFit) : undefined,
      printWidthMm: activePlot?.printWidthMm,
      bridge: window.mady,
    });
    sayCopyOutcome(outcome, "picture");
  }
  function copySvgActive(): void {
    sayCopyOutcome(copyAsSvg({ source: copySourceActive(), bridge: window.mady }), "SVG");
  }
  const canCopyPicture = Boolean(activePlot || activeLayout);

  /**
   * Print whatever is in front — a graph, a figure, or a datasheet — via the OS print dialog,
   * matching what Export covers. A graph/figure serialises to a standalone SVG with the same
   * helpers Export uses (so print and export agree); a datasheet becomes an HTML table. Main
   * renders it in a hidden window and calls `webContents.print`. No bridge (browser preview) →
   * a silent no-op, which is why the menu item is gated on `canPrint`.
   */
  async function printActive(): Promise<void> {
    if (!window.mady?.printFigure) return;
    if (activePlot) {
      const svg = document.querySelector<SVGSVGElement>("svg.gfx-figure");
      if (!svg) return;
      const { svg: markup, width, height } = serializeGraphSvg(svg, { background: "white" });
      const res = await window.mady.printFigure({ svg: markup, width, height });
      if (res && !res.ok && res.error) window.alert(res.error);
    } else if (activeLayout) {
      const composed = composeActiveFigureSvg({ background: "white" });
      if (!composed) return;
      const res = await window.mady.printFigure({ svg: composed.svg, width: composed.width, height: composed.height });
      if (res && !res.ok && res.error) window.alert(res.error);
    } else if (activeTableTab) {
      const res = await window.mady.printFigure({ html: tableToPrintHtml(activeTableTab) });
      if (res && !res.ok && res.error) window.alert(res.error);
    }
  }
  const canPrint = Boolean(activePlot || activeLayout || activeTableTab);

  async function doExport(payload: ExportPayload): Promise<void> {
    if (window.mady?.exportFile) {
      const res = await window.mady.exportFile(payload);
      const err = exportErrorMessage(res);
      if (err) throw new Error(err); // dialog's handleExport catch renders it; dialog stays open
      if (!res.ok) return; // user cancelled the OS save dialog → keep the export dialog open
    } else if (!browserDownload(payload)) {
      // Web/preview build without the Electron writer: PDF/XLSX can't be produced
      // in the browser — let the dialog report it instead of silently doing nothing.
      throw new Error(`${payload.format.toUpperCase()} export needs the desktop app — try PNG, SVG or HTML here.`);
    }
    setExportTarget(null);
  }

  /** Fire a dialog-less export (script / bundle / method / analysis table) and surface any
   *  write failure — these paths have no ExportDialog to catch it. */
  async function runExport(payload: ExportPayload): Promise<void> {
    if (!window.mady?.exportFile) return;
    const err = exportErrorMessage(await window.mady.exportFile(payload));
    if (err) window.alert(err);
  }

  /** Export a reproducible Python script of every analysis in the project. */
  async function exportScript(): Promise<void> {
    await runExport({ format: "py", suggestedName: "mady_analysis", text: buildPythonScript(project) });
  }

  /** Export a self-describing reproducibility bundle (Markdown: overview + provenance
   *  DAG + each analysis's method/params/results + a runnable Python script + a JSON
   *  manifest) so the project's results can be regenerated from raw data. */
  async function exportReproBundle(): Promise<void> {
    const title = project.workspace.folders[0]?.name ?? "MadY project";
    const md = buildReproBundle(project, doc.projectLineage(), {
      title,
      generatedAt: new Date().toISOString(),
      appVersion: typeof __MADY_BUILD__ === "string" ? __MADY_BUILD__ : undefined,
    });
    await runExport({
      format: "md",
      suggestedName: `${title.replace(/[^\w.-]+/g, "_")}_reproducibility`,
      text: md,
    });
  }

  // --- zoom (per-tab view zoom + per-tab graph axis-view) ------------------
  // While a figure page is open the view zoom is that figure's: the status bar, Ctrl + / − / 0
  // and the figure toolbar's own zoom are one zoom. Keyed on the tab alone, the status bar would
  // zoom the tab hidden behind the figure page while the figure stayed the same.
  const zoomKey = dedicatedLayout ? `figure:${dedicatedLayout.id}` : activeKey;
  const activeZoom = zoomByTab[zoomKey] ?? 1;
  const activeGraphView: GraphView = graphViewByTab[activeKey] ?? {};
  const setZoom = (z: number): void => setZoomByTab((m) => ({ ...m, [zoomKey]: clampZoom(z) }));
  const zoomIn = (): void => setZoom(zoomStep(activeZoom, 1));
  const zoomOut = (): void => setZoom(zoomStep(activeZoom, -1));
  const zoomReset = (): void => setZoom(1);
  const onZoomWheel = (deltaY: number): void => setZoom(zoomStep(activeZoom, deltaY < 0 ? 1 : -1));
  const setGraphView = (view: GraphView): void =>
    setGraphViewByTab((m) => ({ ...m, [activeKey]: view }));

  const setAxis = (axis: "x" | "y" | "y2" | "y3" | "z", patch: Partial<AxisSpec>): void => {
    if (activePlot) mutate((d) => d.setPlotAxis(activePlot.id, axis, patch));
  };
  /** Set/clear an axis's length (plot-area width for X / height for Y), in px. */
  const setAxisLength = (axis: "x" | "y", length: number | null): void => {
    if (activePlot) mutate((d) => d.setAxisLength(activePlot.id, axis, length));
  };
  /** Set the per-axis title font (X, Y, Y2 or Y3 independently). */
  const setAxisTitleFont = (axis: "x" | "y" | "y2" | "y3", patch: Partial<FontSpec>): void => {
    if (activePlot) mutate((d) => d.setAxisTitleFont(activePlot.id, axis, patch));
  };
  const setSeriesStyle = (columnId: NodeId, delta: SeriesStyle): void => {
    if (activePlot) mutate((d) => d.setSeriesStyle(activePlot.id, columnId, delta));
  };
  /** Apply a style delta to every listed series in one undo — used only for the
   *  violin "apply to whole series" (on) so all violins restyle together. */
  const setSeriesStyleAll = (columnIds: NodeId[], delta: SeriesStyle, coalesceTag?: string): void => {
    if (activePlot) mutate((d) => d.setSeriesStyleAll(activePlot.id, columnIds, delta, coalesceTag));
  };
  /**
   * Box selection (Shift-drag on an XY / bubble / volcano chart): apply the action picked from the menu to
   * the points inside the box. Exclude = every replicate cell of those rows (the same excluded-cells path as
   * Data ▸ Exclude selected values, one undo); Highlight = add their names to each series' Find & highlight list;
   * Copy = a new sheet with those rows (a one-time copy).
   */
  const boxAction = (action: "exclude" | "highlight" | "copy", points: PickedPoint[]): void => {
    if (!activePlot || !activeTable || points.length === 0) return;
    const plot = activePlot;
    const table = activeTable;
    if (action === "exclude") {
      const cells = cellsOfPoints(table, points);
      mutate((d) => {
        d.setCellsExcluded(table.id, cells, true);
        d.appendLog("transform", `Excluded ${points.length} point${points.length === 1 ? "" : "s"} picked on "${plot.name}"`, {
          detail: `${cells.length} cell${cells.length === 1 ? "" : "s"} of "${table.name}"`, refKind: "table", refId: table.id,
        });
      });
    } else if (action === "highlight") {
      const plan = highlightNamesFor(table, plot, points);
      if (!plan) return;
      mutate((d) => {
        for (const [sid, names] of plan) {
          const had = plot.seriesStyles?.[sid]?.highlightNames ?? [];
          const merged = [...had, ...names.filter((n) => !had.some((h) => h.toLowerCase() === n.toLowerCase()))];
          d.setSeriesStyle(plot.id, sid, { highlightNames: merged });
        }
      });
    } else {
      const r = rowsOfPoints(table, points);
      mutate((d) => {
        const t = d.importTable(`${table.name} (selected points)`, "xy", r.columnNames, r.rows, r.columnTypes);
        d.appendLog("transform", `Copied ${r.rows.length} row${r.rows.length === 1 ? "" : "s"} picked on "${plot.name}"`, {
          detail: `to "${t.name}" (a copy — later edits to "${table.name}" do not reach it)`, refKind: "table", refId: t.id,
        });
        openTab("table", t.id);
      });
    }
  };
  /** Why "Highlight by name" cannot run on the active chart: its sheet has no column of names to read. */
  const boxHighlightBlocked =
    activePlot && activeTable && BOX_SELECT_KINDS.has(activePlot.kind ?? "xy") && highlightNamesFor(activeTable, activePlot, [{ columnId: "", rowId: "" }]) === null
      ? "This sheet has no column of names to highlight by"
      : undefined;
  const setPointStyle = (columnId: NodeId, rowId: NodeId, delta: SeriesStyle): void => {
    if (activePlot) mutate((d) => d.setPointStyle(activePlot.id, columnId, rowId, delta));
  };
  const clearPointStyles = (columnId: NodeId): void => {
    if (activePlot) mutate((d) => d.clearPointStyles(activePlot.id, columnId));
  };
  const setGrid = (delta: GridStyle): void => {
    if (activePlot) mutate((d) => d.setGridStyle(activePlot.id, delta));
  };
  const setFrame = (patch: { frame?: FrameStyle; tickDir?: TickDir; tickLen?: number }): void => {
    if (activePlot) mutate((d) => d.setPlotFrame(activePlot.id, patch));
  };
  const setKind = (kind: PlotKind): void => {
    if (!activePlot) return;
    mutate((d) => {
      d.setPlotKind(activePlot.id, kind === "xy" ? undefined : kind);
      // Converting a graph into a histogram adopts the histogram house look (11.5 px markers, the
      // 0.53 bar-gap floor) — exactly what a histogram made fresh gets — instead of keeping the
      // source graph's tiny XY marker size.
      if (kind === "histogram") applyKindHouseDefaults(d, activePlot.id, "histogram", tableDatasets);
    });
  };
  const setBarLayout = (layout: BarLayout): void => {
    if (activePlot) mutate((d) => d.setBarLayout(activePlot.id, layout));
  };
  const setBarShape = (shape: BarShape): void => {
    if (activePlot) mutate((d) => d.setBarShape(activePlot.id, shape === "square" ? undefined : shape));
  };
  const setBoxWhisker = (whisker: BoxWhisker): void => {
    if (activePlot) mutate((d) => d.setBoxWhisker(activePlot.id, whisker));
  };
  /** Patch presentation-only plot fields (pie / heatmap options), one undoable step. */
  const setPlotOptions = (patch: Partial<Plot>): void => {
    if (activePlot) mutate((d) => d.setPlotOptions(activePlot.id, patch));
  };
  /** List a drawn line / the fitted curves in the legend, or take them back out (legendDock.ts) — what a caption
   *  dropped on the legend, or a row dragged out of it, writes. Listing a line sends its caption home, so taking it
   *  out again puts the words back beside the line. */
  const setLegendLine: LegendDock = (target, on) => {
    if (!activePlot) return;
    if (target.kind === "annotation") {
      mutate((d) => d.updateAnnotation(activePlot.id, target.id, on ? { inLegend: true, labelOffset: undefined } : { inLegend: undefined }));
      return;
    }
    const live = Object.fromEntries(Object.entries({ ...(activePlot.fitStyle ?? {}), inLegend: on || undefined }).filter(([, v]) => v !== undefined));
    setPlotOptions({ fitStyle: Object.keys(live).length ? live : undefined });
  };
  // Parallel-coordinates direct manipulation (brush filters + axis reorder): merge the
  // patch into the active plot's parallel style.
  const editParallel = (patch: Partial<NonNullable<Plot["parallel"]>>): void => {
    if (activePlot) mutate((d) => d.setPlotOptions(activePlot.id, { parallel: { ...activePlot.parallel, ...patch } }));
  };
  const setGraphTitle = (patch: Parameters<MadyDocument["setGraphTitle"]>[1]): void => {
    if (activePlot) mutate((d) => d.setGraphTitle(activePlot.id, patch));
  };
  const setPlotFont = (element: FontElement, patch: Partial<FontSpec>): void => {
    if (activePlot) mutate((d) => d.setPlotFont(activePlot.id, element, patch));
  };
  /** Renderer default size per text role (mirrors @mady/graphics DEFAULTS) — the homogenise seed when unset. */
  const DEFAULT_FONT_SIZE: Record<FontElement, number> = {
    title: 18,
    subtitle: 13,
    axisTitle: 15,
    tick: 13,
    legend: 13,
    sliceLabel: 13,
    valueLabel: 13,
  };
  /** One-click typography homogenisation by type: set the active graph's size for
   *  this role across every graph (the figure group), each role independently. */
  const homogenizeFont = (element: FontElement): void => {
    if (!activePlot) return;
    const size = activePlot.fonts?.[element]?.size ?? DEFAULT_FONT_SIZE[element];
    const ids = project.plots.map((p) => p.id);
    mutate((d) => {
      d.setFontSizeForPlots(ids, element, size);
      d.appendLog("graph", `Homogenised ${element} size to ${size}px across ${ids.length} graph${ids.length === 1 ? "" : "s"}`);
    });
  };
  const setLegend = (patch: Partial<LegendSpec>): void => {
    if (activePlot) mutate((d) => d.setLegend(activePlot.id, patch));
  };
  const setSignificance = (patch: Partial<SignificanceStyle>): void => {
    if (!activePlot) return;
    mutate((d) => d.setSignificance(activePlot.id, patch));
    // Showing / hiding "ns" decides which comparisons the auto-placer plans, not just how they
    // are labelled (see `planAnalysisMarkers`). So markers driven by an analysis are rebuilt
    // here: ticking "show ns" must make the missing brackets appear now, not at the next re-run.
    if ("hideNs" in patch) for (const id of analysesBoundTo(project, activePlot.id)) addBracketsFromAnalysis(id);
  };
  const SHAPE_KINDS = new Set(["rect", "highlight", "ellipse", "arrow", "segment", "callout"]);
  const annotationOps = {
    add: (ann: Omit<Annotation, "id">): void => {
      if (!activePlot) return;
      // Format-Object defaults: new shapes inherit the last-edited shape style.
      const seeded =
        SHAPE_KINDS.has(ann.kind) && Object.keys(shapeStyleRef.current).length > 0
          ? { ...shapeStyleRef.current, ...ann }
          : ann;
      mutate((d) => d.addAnnotation(activePlot.id, seeded));
    },
    update: (id: NodeId, patch: Partial<Omit<Annotation, "id" | "kind">>): void => {
      if (!activePlot) return;
      // Remember shape style fields so the next new shape inherits them.
      for (const k of ["color", "fill", "width", "dash", "arrowHead"] as const) {
        if (k in patch) (shapeStyleRef.current as Record<string, unknown>)[k] = patch[k];
      }
      mutate((d) => d.updateAnnotation(activePlot.id, id, patch));
    },
    remove: (id: NodeId): void => {
      if (activePlot) mutate((d) => d.removeAnnotation(activePlot.id, id));
    },
    reorder: (id: NodeId, to: "front" | "back"): void => {
      if (activePlot) mutate((d) => d.reorderAnnotation(activePlot.id, id, to));
    },
    /** Align / distribute / equalise a multi-object selection (the Arrange toolbar). */
    align: (ids: NodeId[], op: AlignOp): void => {
      if (activePlot) mutate((d) => d.alignAnnotations(activePlot.id, ids, op));
    },
    group: (ids: NodeId[]): void => {
      if (activePlot) mutate((d) => d.groupAnnotations(activePlot.id, ids));
    },
    ungroup: (ids: NodeId[]): void => {
      if (activePlot) mutate((d) => d.ungroupAnnotations(activePlot.id, ids));
    },
    setLocked: (ids: NodeId[], locked: boolean): void => {
      if (activePlot) mutate((d) => d.setAnnotationLocked(activePlot.id, ids, locked));
    },
    /** Pick an image from disk and drop it onto the graph as an embedded (data-URI)
     *  image annotation, sized to preserve its natural aspect ratio. */
    addImage: (): void => {
      const plot = activePlot;
      if (!plot) return;
      void pickImageDataUrl().then((img) => {
        if (!img) return;
        const box = imageInsertBox(img.naturalWidth, img.naturalHeight);
        mutate((d) => d.addAnnotation(plot.id, { kind: "image", href: img.href, ...box }));
      });
    },
    /** Replace the bytes of an existing image annotation (keeps its box/rotation). */
    replaceImage: (id: NodeId): void => {
      const plot = activePlot;
      if (!plot) return;
      void pickImageDataUrl().then((img) => {
        if (!img) return;
        mutate((d) => d.updateAnnotation(plot.id, id, { href: img.href }));
      });
    },
  };
  /** Commit an in-place text edit from the canvas (one undoable step per element). */
  const editText = (target: TextTarget, value: string): void => {
    if (!activePlot) return;
    const id = activePlot.id;
    mutate((d) => {
      switch (target.kind) {
        case "title":
          d.setGraphTitle(id, { title: value });
          break;
        case "subtitle":
          d.setGraphTitle(id, { subtitle: value === "" ? undefined : value });
          break;
        case "axisTitle":
          // On a flipped (horizontal) categorical chart the value axis is drawn on
          // X and the category band on Y, so route the title to the spec the
          // renderer reads for that visual axis — the label follows its axis.
          d.setPlotAxis(id, dataAxisOf(activePlot, target.axis), { title: value === "" ? undefined : value });
          break;
        case "scatter3dZTitle":
          // The 3-D Z axis has no AxisSpec; its title lives on the scatter3d style.
          d.setPlotOptions(id, { scatter3d: { ...(activePlot.scatter3d ?? {}), zTitle: value.trim() === "" ? undefined : value } });
          break;
        case "annotation": {
          if (value.trim() === "") { d.removeAnnotation(id, target.id); break; }
          // A bracket carrying a p renders its label from that p, so a rename has to go to
          // `labelOverride` or it is stored and silently ignored. `annotationRenamePatch`
          // owns that choice and is shared with the annotation census, so the guard tests
          // the same routing the canvas uses.
          const ann = activePlot.annotations?.find((a) => a.id === target.id);
          d.updateAnnotation(id, target.id, annotationRenamePatch(ann ?? {}, value));
          break;
        }
        case "value":
          // Empty reverts the bar to its formatted numeric value (clears the override).
          d.setPointStyle(id, target.columnId, target.rowId, { valueText: value.trim() === "" ? undefined : value });
          break;
        case "bubbleLegendTitle":
          d.setPlotOptions(id, { bubble: { ...(activePlot.bubble ?? {}), sizeLegendTitle: value.trim() === "" ? undefined : value } });
          break;
        case "vennSetLabel": {
          // Rename the set's source column (the heatmap-label rule: the label is the header).
          if (activeTable && value.trim() !== "") d.renameColumn(activeTable.id, target.datasetId, value.trim());
          break;
        }
        case "upsetSetLabel": {
          // Same rename-the-column rule as the Venn's set label.
          if (activeTable && value.trim() !== "") d.renameColumn(activeTable.id, target.datasetId, value.trim());
          break;
        }
        case "oncoprintLabel": {
          // A gene / sample name is the data: the rename edits every cell that holds it (oncoprintLabels.ts), and a
          // dragged name keeps its place under the new name.
          if (!activeTable || !activePlot) break;
          const r = oncoprintRename(activeTable, activePlot.oncoprint, target.axis, target.name, value);
          for (const c of r.cells) d.setCell(activeTable.id, c.rowId, c.columnId, c.value);
          if (r.patch) d.setPlotOptions(activePlot.id, r.patch);
          break;
        }
        case "roseDirection": {
          // A compass letter renamed on the graph: stored under its default words (roseLabels.ts).
          if (activePlot) d.setPlotOptions(activePlot.id, roseDirectionRename(activePlot.rose, target.key, value));
          break;
        }
        case "ternaryAxisTitle": {
          // A ternary edge title is its composition column's header — same rename rule.
          if (activeTable && value.trim() !== "") d.renameColumn(activeTable.id, target.datasetId, value.trim());
          break;
        }
        case "directLabel": {
          // A direct label is the series' column header — it is the legend row's own text,
          // printed on the drawing. Same rename rule as every other label that names a column.
          if (activeTable && value.trim() !== "") d.renameColumn(activeTable.id, target.datasetId, value.trim());
          break;
        }
        case "legendRow": {
          // A legend row renamed on the graph: its column, its listed line, or its display name (legendRename.ts).
          const r = legendRowEdit(activePlot, activeTable, target, value);
          if (r.do === "renameColumn" && activeTable) d.renameColumn(activeTable.id, r.columnId, r.name);
          else if (r.do === "annotationLabel") d.updateAnnotation(id, r.id, { label: r.label });
          else if (r.do === "legendLabels") d.setPlotOptions(id, { legendLabels: r.legendLabels });
          break;
        }
        case "heatSplitLabel": {
          // Renaming a block name on the graph writes that break's own label.
          if (!activePlot) break;
          const hm = activePlot.heatmap ?? {};
          const key = target.axis === "row" ? "rowSplits" : "colSplits";
          d.setPlotOptions(activePlot.id, {
            heatmap: { ...hm, [key]: (hm[key] ?? []).map((sp) => (sp.at === target.at ? { ...sp, label: value.trim() || undefined } : sp)) },
          });
          break;
        }
        case "heatTrackRunLabel": {
          // The word is the value. Renaming it renames that group — for a column strip in the
          // plot's own values; for a row strip in the sheet column the strip reads.
          if (!activePlot) break;
          const hmr = activePlot.heatmap ?? {};
          const next = value.trim();
          if (!next || next === target.value) break;
          if (target.axis === "col") {
            const tracks = (hmr.colTracks ?? []).map((t, i) => {
              if (i !== target.index) return t;
              const vals = { ...(t.values ?? {}) };
              for (const k of Object.keys(vals)) if (vals[k] === target.value) vals[k] = next;
              return { ...t, values: vals, ...(t.labelOffsets?.[target.value] ? { labelOffsets: { ...t.labelOffsets, [next]: t.labelOffsets[target.value]! } } : {}) };
            });
            d.setPlotOptions(activePlot.id, { heatmap: { ...hmr, colTracks: tracks } });
          } else {
            const col = (hmr.rowTracks ?? [])[target.index]?.column;
            if (activeTable && col) {
              for (const row of activeTable.rows) {
                if (String(row.cells[col] ?? "") === target.value) d.setCell(activeTable.id, row.id, col, next);
              }
            }
          }
          break;
        }
        case "heatTrackName": {
          // …and renaming a strip name writes that strip's own name.
          if (!activePlot) break;
          const hm2 = activePlot.heatmap ?? {};
          const tkey = target.axis === "row" ? "rowTracks" : "colTracks";
          d.setPlotOptions(activePlot.id, {
            heatmap: { ...hm2, [tkey]: (hm2[tkey] ?? []).map((t, i) => (i === target.index ? { ...t, name: value.trim() || undefined } : t)) },
          });
          break;
        }
        case "heatmapColLabel": {
          /**
           * Rename what the label names, not whatever sits at that index.
           *
           * The drawn order is not the table order: clustering reorders it, an annotation strip
           * takes its column out of the matrix, and a collapse joins several into one. The scene
           * carries the source ids with each label for exactly this reason. Renaming by index
           * would, with a row strip on, rename the 1st column when the 2nd drawn one is edited.
           */
          if (!activeTable || value.trim() === "") break;
          if (target.groupValue !== undefined) {
            // A collapsed column names a group — rename the strip value its members share.
            if (!activePlot) break;
            const hmc = activePlot.heatmap ?? {};
            const ti = target.trackIndex ?? 0;
            const tracks = (hmc.colTracks ?? []).map((t, i) => {
              if (i !== ti) return t;
              const vals = { ...(t.values ?? {}) };
              for (const k of Object.keys(vals)) if (vals[k] === target.groupValue) vals[k] = value.trim();
              return { ...t, values: vals };
            });
            d.setPlotOptions(activePlot.id, { heatmap: { ...hmc, colTracks: tracks } });
            break;
          }
          const colId = target.ids?.[0] ?? tableDatasets(activeTable)[target.col]?.id;
          if (colId) d.renameColumn(activeTable.id, colId, value.trim());
          break;
        }
        case "heatmapRowLabel": {
          // Same rule for the rows (see above).
          if (!activeTable) break;
          const lead = xColumn(activeTable);
          if (target.groupValue !== undefined) {
            // A collapsed row names a group — rename the annotation value its members share, in
            // the very column the strip reads. Renaming the lead cell of one member would edit
            // one replicate and leave the group's own name untouched.
            const col = target.groupColumn;
            if (!col || !value.trim()) break;
            for (const id of target.ids ?? []) {
              const row = activeTable.rows.find((r) => r.id === id);
              if (row) d.setCell(activeTable.id, row.id, col, value.trim());
            }
            break;
          }
          const rowId = target.ids?.[0];
          const row = rowId ? activeTable.rows.find((r) => r.id === rowId) : activeTable.rows[target.row];
          if (lead && row) d.setCell(activeTable.id, row.id, lead.id, value);
          break;
        }
        case "corrColLabel":
        case "corrRowLabel": {
          // Correlation-matrix row + column labels are both the numeric variables (source
          // columns), so a rename either way renames that column.
          const idx = target.kind === "corrColLabel" ? target.col : target.row;
          const ds = activeTable ? tableDatasets(activeTable)[idx] : undefined;
          if (activeTable && ds && value.trim() !== "") d.renameColumn(activeTable.id, ds.id, value.trim());
          break;
        }
        case "fitParams": {
          // A parameter-block line typed on the graph. The typed text is kept through a re-fit
          // (the builder warns when the fitted value moves); typing the fitted text back, or
          // emptying a line, clears the override - an emptied line is also hidden.
          if (!activePlot?.fit?.params) break;
          const fp = activePlot.fitParams ?? {};
          d.setPlotOptions(activePlot.id, { fitParams: { ...fp, lines: typedFitParamLines(activePlot.fit, fp.lines, target.keys, value) } });
          break;
        }
        case "radarSpokeLabel": {
          // A radar spoke = one category (a table row); its label is the lead (x) column's cell.
          const lead = activeTable ? xColumn(activeTable) : undefined;
          if (activeTable && lead) d.setCell(activeTable.id, target.rowId, lead.id, value);
          break;
        }
        case "waffleCaption": {
          applyWaffleCaptionEdit(d, activePlot, value);
          break;
        }
        case "colorbarTitle": {
          // The colour bar belongs to whichever kind drew it — heatmap and parallel keep
          // their headings on their own style, so route by kind rather than assuming heatmap.
          const text = value.trim() === "" ? undefined : value;
          if (activePlot.kind === "parallel") d.setPlotOptions(id, { parallel: { ...(activePlot.parallel ?? {}), colorbarTitle: text } });
          else d.setPlotOptions(id, { heatmap: { ...(activePlot.heatmap ?? {}), colorbarTitle: text } });
          break;
        }
        case "treemapCellLabel": {
          // A treemap cell = one part: a partsofwhole row labelled by the lead column, or a
          // dataset column in the fallback layout. Rename whichever backs this cell.
          const row = activeTable?.rows.find((r) => r.id === target.rowId);
          const lead = activeTable ? xColumn(activeTable) : undefined;
          if (activeTable && row && lead) d.setCell(activeTable.id, row.id, lead.id, value);
          else if (activeTable && value.trim() !== "") {
            // A borrowed series' column lives in another sheet — rename it there, never a no-op.
            const owner = project.tables.find((t) => t.columns.some((c) => c.id === target.rowId)) ?? activeTable;
            const ds = tableDatasets(owner).find((dd) => dd.id === target.rowId);
            if (ds) d.renameColumn(owner.id, ds.id, value.trim());
          }
          break;
        }
        case "networkNodeLabel": {
          // A per-node display-label override (doesn't touch the underlying edge data).
          // Blank restores the node id.
          const nw = activePlot.network ?? {};
          const next = { ...(nw.nodeLabels ?? {}) };
          if (value.trim() === "" || value.trim() === target.nodeId) delete next[target.nodeId];
          else next[target.nodeId] = value;
          d.setPlotOptions(id, { network: { ...nw, nodeLabels: next } });
          break;
        }
      }
    });
  };
  /** Drag a single bar's value label to a new offset (scene px); 0 clears the nudge. One undo per drag. */
  const moveValueLabel = (columnId: NodeId, rowId: NodeId, dx: number, dy: number): void => {
    if (activePlot) mutateLive((d) => d.setPointStyle(activePlot.id, columnId, rowId, { valueDx: dx || undefined, valueDy: dy || undefined }));
  };
  /** Drag a series' direct label — a nudge from where the placement rule put the name, so the
   *  label goes on following its own series when the data changes. Zero clears it. */
  const moveDirectLabel = (seriesId: NodeId, dx: number, dy: number): void => {
    if (activePlot) mutateLive((d) => d.setSeriesStyle(activePlot.id, seriesId, { directLabelOffset: dx || dy ? { dx, dy } : undefined }));
  };
  /** Orbit / zoom the 3-D scatter camera (drag to rotate, scroll to zoom); one undo per gesture. */
  const camera3D = (patch: { azimuth?: number; elevation?: number; zoom?: number }, gesture: string): void => {
    if (activePlot) mutateLive((d) => d.setScatter3DView(activePlot.id, patch, gesture));
  };
  /** Drop a text-box annotation at a fractional plot position (double-click empty space) and return its id. */
  const createTextBox = (xFrac: number, yFrac: number): string | void => {
    if (!activePlot) return;
    let newId: string | undefined;
    mutate((d) => {
      const ann = d.addAnnotation(activePlot.id, { kind: "text", label: "Text", x: xFrac, y: yFrac });
      newId = ann.id;
    });
    return newId;
  };
  /** Live drag-resize: box/cloud width is per-series (box/violin/raincloud/floatingbar);
   *  bar & histogram resize the plot-wide bar-fill fraction. */
  const resizeWidth = (seriesId: NodeId, fraction: number): void => {
    if (!activePlot) return;
    const target = widthResizeTarget(activePlot.kind);
    // Never fall through in silence. Some kinds have no width field — `estimation`'s violin
    // half-width is a builder constant (`bandW * 0.32`) — so the handle is hidden on kinds
    // with no width command (see `widthResizable` below); if one ever reaches here, this
    // says so rather than eating the gesture.
    if (target === null) {
      unresolvedTarget("resizeWidth", `a width command for a "${activePlot.kind}" plot`, "That kind has no width field — the drag handle must not be drawn on it.");
      return;
    }
    if (target === "bar" && activePlot.kind === "bar") {
      // A bar chart's drag follows Bar width's "whole graph" box (and the tab's Apply to whole graph).
      const w = barWidthFromDrag(activePlot, seriesId, fraction, wholeGraph || barWidthWhole);
      mutateLive((d) => {
        if (w.plot) d.setPlotOptions(activePlot.id, w.plot);
        if (w.series) d.setSeriesStyle(activePlot.id, w.series.id, { barWidth: w.series.barWidth });
      });
    } else if (target === "bar") mutateLive((d) => d.resizeBarWidth(activePlot.id, fraction)); // histogram / UpSet: plot-wide
    else if (target === "box") {
      // Honour the bulk-apply scope. Box width is per-series, so without this the gesture can
      // only ever move the dragged box, and "Apply to whole graph" would do nothing.
      const ids = wholeGraph && activeTable ? tableDatasets(activeTable).map((d) => d.id) : null;
      if (ids && ids.length > 1) mutateLive((d) => d.resizeBoxWidthAll(activePlot.id, ids, fraction));
      else mutateLive((d) => d.resizeBoxWidth(activePlot.id, seriesId, fraction));
    }
  };
  /**
   * May this plot show a width-drag handle at all?
   *
   * The figure draws its edge handles on `onWidthResize &&`, so withholding the callback is
   * what hides them. A handle on a kind with no width field (e.g. estimation) would be
   * a cursor that promises a drag and a document that cannot record one.
   */
  const widthResizable = widthResizeTarget(activePlot?.kind) !== null;
  /** Drag-to-move an annotation on the canvas (coalesced to one undo per drag). */
  const moveAnnotation = (id: NodeId, patch: { value?: number; x?: number; y?: number; bracketY?: number; bracketShift?: number; x2?: number; y2?: number; w?: number; h?: number; rotation?: number; anchorX?: number; anchorY?: number }): void => {
    if (activePlot) mutateLive((d) => d.moveAnnotation(activePlot.id, id, patch));
  };
  /** Nudge a computed reference line's caption (Bland-Altman bias / limits of agreement).
   *  The line stays at its statistic; only the words move. */
  const moveRefLineLabel = (id: string, dx: number, dy: number): void => {
    if (activePlot) mutateLive((d) => d.moveRefLineLabel(activePlot.id, id, dx, dy));
  };
  /** Delete an annotation from the canvas (× handle / Delete key). */
  const deleteAnnotation = (id: NodeId): void => {
    if (activePlot) mutate((d) => d.removeAnnotation(activePlot.id, id));
  };
  /** Right-click menu: change an annotation's draw order. */
  const reorderAnnotation = (id: NodeId, to: "front" | "back"): void => {
    if (activePlot) mutate((d) => d.reorderAnnotation(activePlot.id, id, to));
  };
  /** Right-click menu: duplicate an annotation (offset copy, selected). */
  const duplicateAnnotation = (id: NodeId): void => {
    if (!activePlot) return;
    mutate((d) => {
      const copy = d.duplicateAnnotation(activePlot.id, id);
      if (copy) setSelection({ kind: "annotation", id: copy.id });
    });
  };
  /** Live drag-resize of the whole figure from an on-canvas handle (one undo per drag). */
  const resizeFigure = (patch: { figureWidth?: number; figureHeight?: number }): void => {
    if (activePlot) mutateLive((d) => d.resizeFigure(activePlot.id, patch));
  };
  /** Resize the graph in its pane: a uniform scale of the whole drawing, never a re-layout (one undo per drag). */
  const scaleFigure = (scale: number): void => {
    if (activePlot) mutateLive((d) => d.scaleFigure(activePlot.id, scale));
  };
  /** Apply a built-in graph-style preset to the active graph (one undoable restyle).
   *  Includes the chart type's house refinements, so picking "MadY default" here gives
   *  exactly the look a new graph of this kind gets — not the kind-agnostic half of it. */
  const applyStylePreset = (preset: StylePreset): void => {
    if (activePlot) mutate((d) => applyPresetWithKindDefaults(d, activePlot.id, activePlot.kind, preset));
  };
  /** Assembler ribbon "Style preset": restyle every panel of a figure with one preset —
   *  the same per-graph apply as above, run over each panel with its own kind defaults. */
  const applyPanelPreset = (plotIds: NodeId[], preset: StylePreset): void => {
    mutate((d) => {
      const plots = d.toJSON().plots;
      for (const id of plotIds) applyPresetWithKindDefaults(d, id, plots.find((p) => p.id === id)?.kind, preset);
    });
  };
  /** Assembler "Match" — the per-panel kind-specific patches (see kindFontMatchPatch). */
  const patchPanels = (patches: Array<{ id: NodeId; patch: Partial<Plot> }>): void => {
    mutate((d) => {
      for (const { id, patch } of patches) d.setPlotOptions(id, patch);
    });
  };
  /** Apply one of the user's saved custom presets to the active graph (style + colours). */
  const applyUserPresetToActive = (preset: UserPreset): void => {
    if (activePlot) mutate((d) => applyUserPresetWithKindDefaults(d, activePlot.id, activePlot.kind, preset));
  };
  /** Ordered series colours of the active graph (for colour-faithful preset capture). */
  const activeOrderedPalette = (): string[] => {
    if (!activePlot) return [];
    // The joined table, so a borrowed series' colour is captured in order with the rest.
    const table = plotTable;
    if (!table) return [];
    const fallback = activePlot.palette ? PALETTES[activePlot.palette] : undefined;
    return tableDatasets(table).map((ds, i) => activePlot.seriesStyles?.[ds.id]?.color ?? fallback?.[i % fallback.length] ?? "").filter(Boolean);
  };
  /**
   * The graph's ordered series marker shapes, sampled exactly as `activeOrderedPalette` samples
   * the colours — this is what "captured when a preset is defined" means for shape.
   *
   * Note: only shapes that were explicitly set are captured. If no series has a shape set, the
   * graph saves no shapes at all, and applying the preset later leaves the target's own shapes
   * alone.
   */
  const activeOrderedShapes = (): SymbolShape[] => {
    if (!activePlot || !plotTable) return [];
    const shapes = tableDatasets(plotTable).map((ds) => activePlot.seriesStyles?.[ds.id]?.symbol);
    return shapes.some((s) => s != null) ? shapes.map((s) => s ?? "circle") : [];
  };
  /**
   * Save the active graph's look as a named custom preset; returns its record (or null).
   * `includeKind` (the panel's tickbox) also saves the graph type's own settings as that type's
   * section; the shared look is captured with any sheet reference stripped either way.
   */
  const saveCurrentAsPreset = (name: string, includeKind = true): UserPreset | null => {
    if (!activePlot) return null;
    const kind = activePlot.kind ?? "xy";
    const section = includeKind ? captureKindSection(activePlot) : undefined;
    const rec = saveUserPreset(name, captureSharedStyle(activePlot), activeOrderedPalette(), activeOrderedShapes(), section ? { [kind]: section } : undefined);
    setCustomPresets(listUserPresets());
    return rec;
  };
  /** "+ type" on a saved preset's card: write the active graph's type-specific settings into it. */
  const addKindToActivePreset = (id: NodeId): void => {
    if (!activePlot) return;
    const section = captureKindSection(activePlot);
    if (!section) return; // the card's button is disabled in this state, and says why
    setUserPresetKind(id, activePlot.kind ?? "xy", section);
    setCustomPresets(listUserPresets());
  };
  /** Delete a saved custom preset; clears the profile default if it pointed at it. */
  const removeUserPreset = (id: NodeId): void => {
    deleteUserPreset(id);
    setCustomPresets(listUserPresets());
    if (profileDefault?.kind === "user" && profileDefault.id === id) setProfileDefaultPersist(null);
  };
  /** Preset management from the Inspector's cards — the same store functions Settings calls. */
  const renameUserPresetHandler = (id: NodeId, name: string): void => {
    renameUserPreset(id, name);
    setCustomPresets(listUserPresets());
  };
  /** Duplicate; returns the refusal to show (the list is full), or null when the copy landed. */
  const duplicateUserPresetHandler = (id: NodeId): string | null => {
    const r = duplicateUserPreset(id);
    setCustomPresets(listUserPresets());
    return r.ok ? null : `Not duplicated: ${r.reason}.`;
  };
  const removePresetKindHandler = (id: NodeId, kind: PlotKind): void => {
    removeUserPresetKind(id, kind);
    setCustomPresets(listUserPresets());
  };
  const reorderUserPresetsHandler = (ids: string[]): void => {
    reorderUserPresets(ids);
    setCustomPresets(listUserPresets());
  };
  /** Set/clear the user profile default (built-in or custom), persisted + in state. */
  const setProfileDefaultPersist = (d: ProfileDefault): void => {
    setProfileDefault(d);
    setProfileDefaultState(d);
  };
  /** Re-read the style library into state after an Import merged new presets in. */
  const refreshUserLibrary = (): void => {
    setCustomPresets(listUserPresets());
    setProfileDefaultState(getProfileDefault());
  };
  /** "+" in the Graphs tabs: a new default graph of the active data (filed with its source — the family). */
  const addDefaultGraph = (): void => {
    const sourceId = activePlot?.source ?? activeTableTab?.id ?? project.tables[0]?.id;
    if (!sourceId) return;
    openNewGraphFor(sourceId); // the wizard on that sheet — never a blind XY
  };

  /** Clone the active graph (same data, all style copied) and open the copy. */
  const cloneGraph = (): void => {
    if (!activePlot) return;
    mutate((d) => {
      const clone = d.clonePlot(activePlot.id);
      d.fileObject({ kind: "plot", id: clone.id }, d.locationOf({ kind: "plot", id: activePlot.id }));
      d.appendLog("graph", `Cloned graph "${activePlot.name}"`, { refKind: "plot", refId: clone.id });
      openTab("plot", clone.id);
    });
  };
  /** Graph ▸ Split into small graphs: one graph per series of the active graph, each on the
   *  original's axis range, laid out on a new figure page, which opens. One undo removes it all. */
  const splitGraph = (): void => {
    if (!activePlot || !activeTable) return;
    const src = activePlot;
    const table = activeTable;
    let layoutId = "";
    mutate((d) => {
      const { layout, plots } = d.splitIntoSmallGraphs(src.id, splitPins(table, src));
      layoutId = layout.id;
      d.appendLog("graph", `Split graph "${src.name}" into ${plots.length} small graphs`, { refKind: "layout", refId: layout.id });
    });
    setArrangeOnOpen(layoutId);
    setLayoutView(layoutId);
  };
  const canSplitGraph = !!activePlot && !!activeTable && splitRefusal(activePlot, tableDatasets(activeTable).length) === null;
  /** Graph ▸ Detach small graph: it keeps its look and becomes an ordinary graph. */
  const detachSmallGraph = (): void => {
    if (activePlot?.splitFrom) mutate((d) => d.detachSmallGraph(activePlot.id));
  };
  const smallGraphNotice: SmallGraphNotice | undefined = activePlot?.splitFrom
    ? (() => {
        const link = activePlot.splitFrom;
        const original = project.plots.find((p) => p.id === link.plot);
        const seriesName = activeTable?.columns.find((c) => c.id === link.series)?.name ?? link.series;
        return {
          originalName: original?.name ?? null,
          seriesName,
          onOpenOriginal: () => { if (original) openTab("plot", original.id); },
          onDetach: detachSmallGraph,
        };
      })()
    : undefined;
  /** Duplicate the active dataset (deep copy with fresh ids) and open it. */
  const duplicateData = (): void => {
    const sourceId = activeTableTab?.id ?? activePlot?.source ?? project.tables[0]?.id;
    if (!sourceId) return;
    mutate((d) => {
      const table = d.duplicateTable(sourceId);
      d.fileObject({ kind: "table", id: table.id }, d.locationOf({ kind: "table", id: sourceId }));
      d.appendLog("import", `Duplicated dataset "${table.name}"`, { refKind: "table", refId: table.id });
      openTab("table", table.id);
    });
  };
  /**
   * Exclude / include the values selected in the datasheet.
   *
   * Reads the block published by the grid and resolves it against the live table, so the
   * command cannot act on a stale row/column that has since been deleted. Same helper the
   * grid's own menu and the datasheet buttons use, so all three touch the same cells.
   */
  const excludeDataSelection = (excluded: boolean): void => {
    if (!dataSel) return;
    const table = project.tables.find((t) => t.id === dataSel.tableId);
    if (!table) return;
    const cells = cellsInBounds(table, dataSel);
    if (cells.length) mutate((d) => d.setCellsExcluded(table.id, cells, excluded));
  };

  // --- Edit ▸ Copy / Cut / Paste on the active datasheet -------------------
  // The datasheet grid already handles Ctrl+C/X/V via ClipboardEvent when focused; these route
  // the same operations from the Edit menu (and the command palette), acting on the block the
  // grid published as `dataSel`. They reuse the grid's serialize / parseClipboard so a menu
  // copy/paste is byte-identical to the keyboard path. NB: registered with a shortcut hint but
  // no `combo` — binding ctrl+c/v/x globally would double-fire against the grid's own handler
  // (a double paste/clear). Frozen tables refuse cut/paste, matching the grid.
  const dataSelTable = dataSel ? project.tables.find((t) => t.id === dataSel.tableId) : undefined;
  const canEditDataSel = Boolean(dataSel && dataSelTable && !dataSelTable.frozen);
  const copyDataSelection = (): void => {
    if (!dataSel || !dataSelTable) return;
    void navigator.clipboard?.writeText?.(serializeCells(dataSelTable, dataSel));
  };
  const cutDataSelection = (): void => {
    if (!dataSel || !dataSelTable || dataSelTable.frozen) return;
    void navigator.clipboard?.writeText?.(serializeCells(dataSelTable, dataSel));
    mutate((d) => d.clearCells(dataSel.tableId, dataSel.r0, dataSel.c0, dataSel.r1 - dataSel.r0 + 1, dataSel.c1 - dataSel.c0 + 1));
  };
  const pasteDataSelection = (): void => {
    if (!dataSel || !dataSelTable || dataSelTable.frozen) return;
    const read = navigator.clipboard?.readText?.();
    if (!read) return;
    const sel = dataSel;
    void read.then((text) => {
      if (!text) return;
      const block = parseClipboard(text, dataSelTable.columns, sel.c0, resolveDateOrder());
      mutate((d) => d.pasteBlock(sel.tableId, sel.r0, sel.c0, block));
    });
  };
  /** "Apply this look": open the multi-select dialog to copy the active graph's look onto a
   *  chosen set of other graphs, whether or not they share the active graph's data. */
  const openApplyLook = (): void => {
    if (activePlot) setApplyLookOpen(true);
  };

  // --- action registry (drives menus + command palette + shortcuts) --------
  // App-wide "show graph ruler" preference — the View-menu toggle flips it, the graph pane
  // reads it (a window event keeps the two in sync across the component trees).
  const graphRuler = useGraphRulerPref();
  const colorVision = useColorVisionPref();
  // The last kind chosen, so the View-menu toggle turns the preview back on as it was.
  const lastVisionRef = useRef<Exclude<typeof colorVision.value, "off">>("deuteranopia");
  if (colorVision.value !== "off") lastVisionRef.current = colorVision.value;
  const actions = buildActions({
    openFile: () => void openFile(),
    importData: () => void openImport(),
    importGgplot: () => void openImportGgplot(),
    pasteData: pasteImport,
    save: () => setSaveOpen(true),
    exportActive,
    canExport: Boolean(activePlot || activeLayout || activeTableTab),
    exportAll: () => setExportAllOpen(true),
    canExportAll: project.plots.length + (project.layouts?.length ?? 0) > 0,
    print: () => void printActive(),
    canPrint,
    copyPicture: () => void copyPictureActive(),
    copySvg: copySvgActive,
    canCopyPicture,
    exportScript: () => void exportScript(),
    exportRepro: () => void exportReproBundle(),
    newProject: addProject,
    newDataset: () => addDataset(),
    newTable: (kind) => addDataset(undefined, undefined, kind),
    newLayout: createLayout,
    reshapeData: openReshape,
    excludeValues: () => excludeDataSelection(true),
    includeValues: () => excludeDataSelection(false),
    hasDataSelection: dataSel != null,
    copyData: copyDataSelection,
    cutData: cutDataSelection,
    pasteCells: pasteDataSelection,
    canEditDataSelection: canEditDataSel,
    rowStats: openRowStats,
    pruneData: openPrune,
    colMath: openColMath,
    transposeData: openTranspose,
    extractData: openExtract,
    mergeData: openMerge,
    canMergeData: project.tables.length >= 2,
    splitText: openSplit,
    findReplace: openFindReplace,
    canFindReplace: Boolean(workingTable && !workingTable.frozen && !workingTable.derivation),
    transformData: openTransform,
    frequencyData: openFrequency,
    qqData: openQQ,
    simulateData: openSimulate,
    powerCalc: () => setPowerOpen(true),
    monteCarlo: () => setMcOpen(true),
    duplicateData,
    sortData: openSort,
    canSortData: Boolean(workingTable && !workingTable.frozen),
    newGraph: addDefaultGraph,
    cloneGraph,
    splitGraph,
    canSplitGraph,
    detachSmallGraph,
    isSmallGraph: !!activePlot?.splitFrom,
    applyLook: openApplyLook,
    hasPlot: Boolean(activePlot),
    newGraphDialog: () => setNewGraphOpen(true),
    openGallery: () => openTab("gallery"),
    viewLineage: () => openTab("lineage"),
    openGuide: () => openGuide(),
    /**
     * Write the whole manual out as one self-contained HTML file.
     *
     * It is read, not rebuilt here: `scripts/gen-manual-html.mjs` produces the file by booting
     * the built renderer and walking this same documentation, so the app shipping a second
     * serialiser would be two implementations of one thing, drifting apart. Packaged it is an
     * extraResource; run from source it is read from `docs/manual/`, where the generator writes it.
     *
     * A source checkout that has never run the generator has no file, and `readManual` returns null
     * rather than throwing — say how to make it instead of failing silently.
     */
    saveManual: () => {
      void (async () => {
        const html = (await window.mady?.readManual?.()) ?? null;
        if (html === null) {
          // `window.alert` is what this file already uses for a menu action that fails with no
          // dialog to render into (recovery, open, import). A silent no-op is a defect.
          window.alert(
            "The manual file is missing from this copy of MadY.\n\nTo build it from the source code, run: node scripts/gen-manual-html.mjs",
          );
          return;
        }
        await runExport({ format: "html", suggestedName: "MadY-Manual", text: html });
      })();
    },
    openAbout: () => openTab("about"),
    openWelcome: () => openTab("welcome"),
    startTour: (id) => setTourId(id),
    // --- Design ------------------------------------------------------------------
    // Enablement is derived, never hardcoded: a Design button that is always pressable
    // but does nothing is a dead control (see toolbar.no-dead-buttons.test.ts).
    canAnnotate: Boolean(activePlot) && activePlot?.kind !== "network",
    canBracket: Boolean(activePlot) && bracketGeometry(activePlot ?? {}).endpoints !== "none",
    hasPairwiseAnalysis: project.analyses.some(
      (a) => a.source === activePlot?.source && (a.result?.terms ?? []).some((t) => t.term.includes(" vs ") && t.p != null),
    ),
    addAnnotation: (kind) => annotationOps.add({ kind }),
    bracketsFromAnalysis: () => {
      const a = project.analyses.find(
        (x) => x.source === activePlot?.source && (x.result?.terms ?? []).some((t) => t.term.includes(" vs ") && t.p != null),
      );
      if (a) addBracketsFromAnalysis(a.id);
    },
    lettersFromAnalysis: () => {
      const a = project.analyses.find(
        (x) => x.source === activePlot?.source && (x.result?.terms ?? []).some((t) => t.term.includes(" vs ") && t.p != null),
      );
      if (a) addLettersFromAnalysis(a.id);
    },
    // Pin the Significance brackets section: the Inspector shows that section alone, open, on
    // the tab that owns it (the `chart-section` selection a legend row for a group also uses).
    // Clearing the selection instead would not work: with nothing selected the Inspector shows
    // only "click an axis or a series", hiding the very section this command names. The
    // compare-groups guided tour relies on this.
    openSignificanceOptions: () => setSelection({ kind: "chart-section", title: "Significance brackets" }),
    undo,
    redo,
    canUndo,
    canRedo,
    analyze: openAnalyze,
    doseResponse: () => openAnalyzeFocus({ method: "curvefit", variant: "4pl", focusKind: "dose-response" }),
    enzymeKinetics: () => openAnalyzeFocus({ method: "curvefit", variant: "mm", focusKind: "enzyme-kinetics" }),
    binding: () => openAnalyzeFocus({ method: "curvefit", variant: "onesite", focusKind: "binding" }),
    interpolateCurve: () => openAnalyzeFocus({ method: "interpolate", focusKind: "interpolate" }),
    methodComparison: () => openAnalyzeFocus({ method: "deming", focusKind: "method-comparison" }),
    meltingTemperature: () => openAnalyzeFocus({ method: "meltingtemp", focusKind: "melting-temperature" }),
    openCommandPalette: () => setPaletteOpen(true),
    navigateBack: () => navigateHistory("back"),
    navigateForward: () => navigateHistory("forward"),
    canNavigateBack: tabHistoryBack.length > 0,
    canNavigateForward: tabHistoryForward.length > 0,
    reportBug: () => { setBugPrefill(null); setBugReportOpen(true); },
    toggleTheme,
    toggleGraphRuler: () => graphRuler.set(!graphRuler.value),
    graphRulerOn: graphRuler.value,
    toggleColorVision: () => colorVision.set(colorVision.value === "off" ? lastVisionRef.current : "off"),
    colorVisionOn: colorVision.value !== "off",
    canPreviewColor: Boolean(activePlot || activeLayout),
    zoomIn,
    zoomOut,
    canZoomIn: canZoom(activeZoom, 1),
    canZoomOut: canZoom(activeZoom, -1),
    zoomReset,
    setZoomLevel: () => setZoomDialogOpen(true),
    resetToolbar,
    openLayouts: () => setLayoutMenuOpen(true),
    resetLayout,
    openSettings: () => setSettingsOpen(true),
  });
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  // Assistant: the current next-step suggestions; the top non-dismissed one
  // shows as a footer nudge, and its CTA runs the matching registry action.
  // Memoized so the engine only re-profiles when the document or the focused sheet changes —
  // not on every unrelated render (hover, selection, dialog toggles). "The document changed" is
  // `version`, not `project`: `doc.toJSON()` is the same object after every edit, so a memo keyed
  // on it alone would keep the tip from before the edit.
  const assistantTips = useMemo(
    () => suggestNextSteps(project, { activePlotId: activePlot?.id, activeTableId: activeTableTab?.id, activeAnalysisId: activeAnalysisTab?.id }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` is the document's change signal
    [project, version, activePlot?.id, activeTableTab?.id, activeAnalysisTab?.id],
  );
  // The Assistant popover is a reminder, so it drops methods already run on this sheet. The
  // Analyze dialog is a picker — it must keep recommending what fits the data even
  // after one has been run, or a dose-response fit would disappear from the
  // recommendations as soon as a single curve fit exists. Computed only while the
  // dialog is open. The dialog passes its resolved target (`analyzeTable`, which falls
  // back to the first sheet on purpose — Analyze always has a target); the engine
  // itself never invents one, so the assistant stays quiet on no-data tabs.
  const analysisTips = useMemo(
    () =>
      analyzeOpen
        ? suggestAnalysisSteps(project, { activePlotId: activePlot?.id, activeTableId: analyzeTable?.id }, { includeCompleted: true })
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` is the document's change signal (see assistantTips)
    [analyzeOpen, project, version, activePlot?.id, analyzeTable?.id],
  );
  // Curve-model recommendations are only consumed by the (open) Analyze dialog → skip the work otherwise.
  const curveModelRecommendations: CurveModelRecommendation[] = useMemo(
    () => (analyzeOpen ? suggestCurveModels(project, { activePlotId: activePlot?.id, activeTableId: analyzeTable?.id }, undefined, VARIANTS.curvefit) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` is the document's change signal (see assistantTips)
    [analyzeOpen, project, version, activePlot?.id, analyzeTable?.id],
  );
  const topTip = assistantTips.find((t) => !dismissedTips.has(t.id) && (t.kind !== "analysis" || t.confidence === "high")) ?? null;
  const runTip = (suggestion: Suggestion): void => {
    if (suggestion.kind === "analysis" && suggestion.method) {
      setAnalyzePreset({ method: suggestion.method, ...(suggestion.variant ? { variant: suggestion.variant } : {}), ...(suggestion.focusKind ? { focusKind: suggestion.focusKind } : {}) });
      setPendingAnalyzeSuggestion(suggestion);
      if (analyzeTable) setAnalyzeOpen(true);
      return;
    }
    actionsRef.current.find((a) => a.id === suggestion.actionId)?.run();
  };

  // Lineage view: open a sheet (layout → its dedicated view, others → a tab) and the
  // one-click "re-run everything stale" (re-run each stale analysis through the engine,
  // then refresh stale derived tables + clear stale plot flags via `mutate`+`recompute`).
  const openLineageObject = (kind: "table" | "analysis" | "plot" | "layout", id: NodeId): void => {
    setLayoutView(null);
    if (kind === "layout") openLayout(id);
    else openTab(kind, id);
  };
  const rerunStale = async (): Promise<void> => {
    for (const a of project.analyses.filter((x) => x.status === "stale")) await rerunAnalysis(a.id);
    mutate((d) => d.recompute());
  };

  const saveFromMenu = useEffectEvent(saveProject);
  // Native application-menu actions (File → Open, Save, …) run the same actions as
  // the in-app menu bar, resolved by id against the live action list.
  useEffect(() => {
    if (!window.mady?.onMenuAction) return;
    return window.mady.onMenuAction((id) => {
      if (id === "save-and-close") {
        // The unsaved-changes close prompt chose "Save": save the whole project, and only
        // let main close the window if the write actually succeeded (cancel/error keeps it open).
        void (async () => {
          if (await saveFromMenu(null)) window.mady?.confirmClose?.();
        })();
        return;
      }
      actionsRef.current.find((a) => a.id === id)?.run();
    });
  }, []);

  // Global keyboard shortcuts — one listener, resolved against the live actions.
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      const action = matchShortcut(actionsRef.current, e);
      if (action) {
        e.preventDefault();
        action.run();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // The mouse's thumb buttons (X1/X2 = button 3/4), same as a browser's back/forward.
  // `auxclick` is the event that carries non-primary buttons; the default action is
  // suppressed so Chromium cannot also try to navigate the renderer itself.
  useEffect(() => {
    const handler = (e: MouseEvent): void => {
      if (e.button !== 3 && e.button !== 4) return;
      e.preventDefault();
      const id = e.button === 3 ? "nav-back" : "nav-forward";
      const action = actionsRef.current.find((a) => a.id === id);
      if (action && action.enabled !== false) action.run();
    };
    window.addEventListener("auxclick", handler);
    return () => window.removeEventListener("auxclick", handler);
  }, []);

  // Open the bug reporter from anywhere (an error boundary's "Report this…"), carrying
  // an optional prefill. Decoupled via a window event so a class component can trigger it.
  useEffect(() => {
    const handler = (e: Event): void => {
      setBugPrefill(((e as CustomEvent).detail as BugPrefill) ?? null);
      setBugReportOpen(true);
    };
    window.addEventListener(BUG_REPORT_EVENT, handler);
    return () => window.removeEventListener(BUG_REPORT_EVENT, handler);
  }, []);

  // Open the manual at one entry from anywhere — the "?" beside an Inspector section, a rail
  // tab or a dialog title. Same window-event idiom and the same reason as the reporter above:
  // these buttons are several components deep, in files that otherwise know nothing about the
  // manual, and an `onOpenGuide` prop threaded through all of them would be worse than an event.
  useEffect(() => {
    const handler = (e: Event): void => {
      openGuide((e as CustomEvent).detail as GuideTarget);
    };
    window.addEventListener(GUIDE_OPEN_EVENT, handler);
    return () => window.removeEventListener(GUIDE_OPEN_EVENT, handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="app" onDragOver={(e) => e.preventDefault()} onDrop={onDropFile}>
      <MenuBar
        actions={actions}
        recents={recents}
        onOpenRecent={(path) => void openPath(path)}
        theme={theme}
        onToggleTheme={toggleTheme}
        onSettings={() => setSettingsOpen(true)}
        askBar={<NlCommandBar onRun={runNL} onOpenManual={setManualPopup} />}
      />
      <Toolbar
        onAnalyze={openAnalyze}
        onNewProject={addProject}
        onSave={() => setSaveOpen(true)}
        dirty={hasUnsavedWork(version)}
        onOpen={() => void openFile()}
        onImport={() => void openImport()}
        onExport={exportActive}
        canExport={canExport}
        onNewDataset={() => addDataset()}
        onDuplicateData={duplicateData}
        hasData={project.tables.length > 0}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={undo}
        onRedo={redo}
        canBack={tabHistoryBack.length > 0}
        canForward={tabHistoryForward.length > 0}
        onBack={() => navigateHistory("back")}
        onForward={() => navigateHistory("forward")}
        groups={toolbarGroups}
        onReorderGroups={reorderToolbarGroups}
        onReorderWithinGroup={reorderToolbarWithin}
        onMagic={openApplyLook}
        hasPlot={Boolean(activePlot)}
        suggestions={assistantTips.filter((t) => !dismissedTips.has(t.id))}
        onRunSuggestion={runTip}
        onDismissSuggestion={(id) => setDismissedTips((s) => new Set(s).add(id))}
        onAssistant={() => setDismissedTips(new Set())}
        modelButton={llmEnabled ? <ModelButton status={modelStatus} onClick={() => setModelSetupOpen(true)} /> : undefined}
        modelBar={
          llmEnabled ? <ModelBar
            ready={modelReady}
            compile={compileWithModel}
            apply={applyModelCommands}
            undo={undo}
            describe={describeForBar}
            onSetup={() => {
              refreshModelStatus();
              setModelSetupOpen(true);
            }}
          /> : undefined
        }
      />
      {llmEnabled && modelSetupOpen && (
        <ModelSetupDialog bridge={modelSetupBridge} onClose={() => setModelSetupOpen(false)} onChanged={refreshModelStatus} />
      )}
      {autosaveFailing && (
        <div
          role="status"
          className="autosave-warn"
          style={{
            background: "var(--danger, #b0203a)", color: "#fff", padding: "5px 12px",
            fontSize: 12, textAlign: "center", letterSpacing: 0.2,
          }}
        >
          ⚠️ Autosave is failing — your recent changes are not being backed up for crash recovery. Save now with Ctrl+S to a location you can write to.
        </div>
      )}
      <div className="main">
        {(() => {
          // Full editing bundle for the arrange-view panels: the selected panel is
          // the active plot, so every callback (bound to activePlot) targets it.
          const panelEditing = {
            selection,
            selectedPlot: arrangePlot,
            onSelectPanel: (id: NodeId) => { setArrangePlot(id); setSelection({ kind: "plot" }); },
            // Nothing selected, as when the figure opened: `{ kind: "plot" }` here would make the Inspector show the graph in the
            // tab behind the figure page (activePlot falls back to it) under the picked object.
            onClearPanel: () => { setArrangePlot(null); setSelection(null); },
            onSelect: setSelection,
            onWidthResize: widthResizable ? resizeWidth : undefined,
            onMoveAnnotation: moveAnnotation,
            onMoveRefLineLabel: moveRefLineLabel,
            onDeleteAnnotation: deleteAnnotation,
            onReorderAnnotation: reorderAnnotation,
            onDuplicateAnnotation: duplicateAnnotation,
            onFigureResize: resizeFigure,
            onEditText: editText,
            onCreateTextBox: createTextBox,
            onAxisResize: setAxisLength,
            onMoveTitle: (dx: number, dy: number) => { if (activePlot) mutateLive((d) => d.setTitleOffset(activePlot.id, dx, dy)); },
            onMoveSubtitle: (dx: number, dy: number) => { if (activePlot) mutateLive((d) => d.setPlotOptions(activePlot.id, { subtitleOffset: { dx, dy } })); },
            onMoveLegend: (dx: number, dy: number) => { if (activePlot) mutateLive((d) => d.setLegendOffset(activePlot.id, dx, dy)); },
            onMoveSignificanceCaption: (dx: number, dy: number) => { if (activePlot) mutateLive((d) => d.setPlotOptions(activePlot.id, { significance: { ...(activePlot.significance ?? {}), legendOffset: { dx, dy } } })); },
            onMoveWaffleCaption: (dx: number, dy: number) => { if (activePlot) mutateLive((d) => moveWaffleCaption(d, activePlot, dx, dy)); },
            onMoveColorbar: (dx: number, dy: number) => { if (activePlot) mutateLive((d) => d.setPlotOptions(activePlot.id, { colorbarOffset: { dx, dy } })); },
            onMoveFitLabel: (dx: number, dy: number, fitIndex?: number) => { if (!activePlot) return; const k = fitIndex != null ? String(fitIndex) : undefined; mutateLive((d) => d.setPlotOptions(activePlot.id, k ? { fitsOffsets: { ...(activePlot.fitsOffsets ?? {}), [k]: { ...(activePlot.fitsOffsets?.[k] ?? {}), label: { dx, dy } } } } : { fitLabelOffset: { dx, dy } })); },
            onMoveFitParams: (dx: number, dy: number, fitIndex?: number) => { if (!activePlot) return; const k = fitIndex != null ? String(fitIndex) : undefined; mutateLive((d) => d.setPlotOptions(activePlot.id, k ? { fitsOffsets: { ...(activePlot.fitsOffsets ?? {}), [k]: { ...(activePlot.fitsOffsets?.[k] ?? {}), params: { dx, dy } } } } : { fitParams: { ...(activePlot.fitParams ?? {}), offset: { dx, dy } } })); },
            onMoveFitParamLine: (key: string, dx: number, dy: number) => { if (!activePlot) return; const fp = activePlot.fitParams ?? {}; mutateLive((d) => d.setPlotOptions(activePlot.id, { fitParams: { ...fp, lines: { ...(fp.lines ?? {}), [key]: { ...(fp.lines?.[key] ?? {}), offset: { dx, dy } } } } })); },
            onMoveHeatSplitLabel: (axis: "row" | "col", at: number, dx: number, dy: number) => { if (activePlot) mutateLive((d) => { const hm = activePlot.heatmap ?? {}; const key = axis === "row" ? "rowSplits" : "colSplits"; d.setPlotOptions(activePlot.id, { heatmap: { ...hm, [key]: (hm[key] ?? []).map((sp) => (sp.at === at ? { ...sp, labelOffset: { dx, dy } } : sp)) } }); }); },
            onMoveHeatTrackRunLabel: (axis: "row" | "col", index: number, value: string, dx: number, dy: number) => { if (activePlot) mutateLive((d) => { const hm = activePlot.heatmap ?? {}; const key = axis === "row" ? "rowTracks" : "colTracks"; d.setPlotOptions(activePlot.id, { heatmap: { ...hm, [key]: (hm[key] ?? []).map((t, i) => (i === index ? { ...t, labelOffsets: { ...(t.labelOffsets ?? {}), [value]: { dx, dy } } } : t)) } }); }); },
            onMoveHeatTrackName: (axis: "row" | "col", index: number, dx: number, dy: number) => { if (activePlot) mutateLive((d) => { const hm = activePlot.heatmap ?? {}; const key = axis === "row" ? "rowTracks" : "colTracks"; d.setPlotOptions(activePlot.id, { heatmap: { ...hm, [key]: (hm[key] ?? []).map((t, i) => (i === index ? { ...t, nameOffset: { dx, dy } } : t)) } }); }); },
            onMoveHeatTrackKey: (axis: "row" | "col", index: number, dx: number, dy: number) => { if (activePlot) mutateLive((d) => { const hm = activePlot.heatmap ?? {}; const key = axis === "row" ? "rowTracks" : "colTracks"; d.setPlotOptions(activePlot.id, { heatmap: { ...hm, [key]: (hm[key] ?? []).map((t, i) => (i === index ? { ...t, keyOffset: { dx, dy } } : t)) } }); }); },
            onMoveHeatmapLabels: (which: "row" | "col", index: number, dx: number, dy: number) => { if (activePlot) mutateLive((d) => { const hm = activePlot.heatmap ?? {}; const key = which === "row" ? "rowLabelOffsets" : "colLabelOffsets"; d.setPlotOptions(activePlot.id, { heatmap: { ...hm, [key]: { ...(hm[key] ?? {}), [index]: { dx, dy } } } }); }); },
            onMoveVennSetLabel: (datasetId: string, dx: number, dy: number) => { if (activePlot) mutateLive((d) => { const v = activePlot.venn ?? {}; d.setPlotOptions(activePlot.id, { venn: { ...v, labelOffsets: { ...(v.labelOffsets ?? {}), [datasetId]: { dx, dy } } } }); }); },
            onMoveUpsetSetLabel: (datasetId: string, dx: number, dy: number) => { if (activePlot) mutateLive((d) => { const u = activePlot.upset ?? {}; d.setPlotOptions(activePlot.id, { upset: { ...u, labelOffsets: { ...(u.labelOffsets ?? {}), [datasetId]: { dx, dy } } } }); }); },
            onMoveTernaryAxisLabel: (datasetId: string, dx: number, dy: number) => { if (activePlot) mutateLive((d) => { const t = activePlot.ternary ?? {}; d.setPlotOptions(activePlot.id, { ternary: { ...t, axisLabelOff: { ...(t.axisLabelOff ?? {}), [datasetId]: { dx, dy } } } }); }); },
            onMoveRoseDirectionLabel: (key: string, dx: number, dy: number) => { if (activePlot) mutateLive((d) => d.setPlotOptions(activePlot.id, roseDirectionMove(activePlot.rose, key, dx, dy))); },
            onMoveOncoprintLabel: (axis: "gene" | "sample", name: string, dx: number, dy: number) => { if (activePlot) mutateLive((d) => d.setPlotOptions(activePlot.id, oncoprintLabelMove(activePlot.oncoprint, axis, name, dx, dy))); },
            onMoveCorrLabels: (which: "row" | "col", index: number, dx: number, dy: number) => { if (activePlot) mutateLive((d) => { const cm = activePlot.corrmatrix ?? {}; const key = which === "row" ? "rowLabelOffsets" : "colLabelOffsets"; d.setPlotOptions(activePlot.id, { corrmatrix: { ...cm, [key]: { ...(cm[key] ?? {}), [index]: { dx, dy } } } }); }); },
            onMoveCorrLegend: (dx: number, dy: number) => { if (activePlot) mutateLive((d) => d.setPlotOptions(activePlot.id, { corrmatrix: { ...(activePlot.corrmatrix ?? {}), legendOffset: { dx, dy } } })); },
            onMoveAxisTitle: (axis: "x" | "y" | "z" | "y2" | "y3", dx: number, dy: number) => { if (activePlot) mutateLive((d) => moveAxisTitle(d, activePlot, axis, dx, dy)); },
            onRotateAxisTitle: (axis: "y" | "y2" | "y3", angle: number) => { if (activePlot) mutate((d) => rotateAxisTitle(d, activePlot, axis, angle)); },
            onMoveValueLabel: moveValueLabel,
            onMoveDirectLabel: moveDirectLabel,
            onParallelEdit: editParallel,
            onCamera3D: camera3D,
          };
          const columnContent: Record<DockId, ReactNode> = {
            navigator: (
              // Caution: one child only. `.dockbody` is a row flex that gives every child flex:1,
              // so a second sibling here splits the column horizontally and squeezes the
              // project tree to a few pixels. Everything in this column stacks inside
              // `.navcol`, with the tree taking the space.
              <div className="navcol">
              <Navigator
                project={project}
                activeKey={activeKey}
                activeLayoutId={layoutView}
                // Opening any object from the tree leaves the dedicated arrange view, so the
                // tree navigates smoothly (no need to click "Back" first).
                onOpenObject={(kind, id) => { setArrangePlot(null); setLayoutView(null); openTab(kind, id); }}
                onOpenLayout={openLayout}
                onAddLayout={createLayout}
                onOpenDocs={(folderId) => { setArrangePlot(null); setLayoutView(null); openTab("docs", folderId); }}
                onAddProject={addProject}
                onAddExperiment={addExperiment}
                onAddDataset={addDataset}
                onAddGraph={addGraph}
                onRename={renameNode}
                onRenameObject={(_kind, id, name) => mutate((d) => d.renamePlot(id, name))}
                onDeleteObject={deleteObject}
                onDeleteExperiment={deleteExperiment}
                onDeleteFolder={deleteFolder}
                onSetColor={(kind, id, color) => mutate((d) => d.setSheetColor(kind, id, color))}
                onSetPinned={(kind, id, pinned) => mutate((d) => d.setSheetPinned(kind, id, pinned))}
              />
              </div>
            ),
            document: dedicatedLayout ? (
              <PanelBuilderView
                project={project}
                layoutId={dedicatedLayout.id}
                startArranged={arrangeOnOpen === dedicatedLayout.id}
                onAddPanel={layoutOps.addPanel.bind(null, dedicatedLayout.id)}
                onAddImagePanel={layoutOps.addImagePanel.bind(null, dedicatedLayout.id)}
                onRemovePanel={layoutOps.removePanel.bind(null, dedicatedLayout.id)}
                onDuplicatePanel={layoutOps.duplicatePanel.bind(null, dedicatedLayout.id)}
                onSetLayoutOptions={(patch) => layoutOps.setOptions(dedicatedLayout.id, patch)}
                onMatchStyles={layoutOps.matchStyles}
                onPatchPanels={patchPanels}
                onApplyPanelPreset={applyPanelPreset}
                onOpenPlot={(id) => { setLayoutView(null); openTab("plot", id); }}
                onExport={exportFigure}
                onClose={() => { setArrangePlot(null); setLayoutView(null); }}
                onSetLinked={(linked) => layoutOps.setLinked(dedicatedLayout.id, linked)}
                onAddFigureAnnotation={(ann) => layoutOps.addAnnotation(dedicatedLayout.id, ann)}
                onMoveFigureAnnotation={(id, patch) => layoutOps.moveAnnotation(dedicatedLayout.id, id, patch)}
                onUpdateFigureAnnotation={(id, patch) => layoutOps.updateAnnotation(dedicatedLayout.id, id, patch)}
                onRemoveFigureAnnotation={(id) => layoutOps.removeAnnotation(dedicatedLayout.id, id)}
                editing={panelEditing}
                inspectorSlot={figureInspectorEl}
                viewZoom={activeZoom}
                onViewZoom={setZoom}
                onZoomWheel={onZoomWheel}
                onArrangeShown={() => openDock("inspector")}
              />
            ) : (
              <DocumentArea
                project={project}
                openTabs={openTabs}
                activeKey={activeKey}
                onActivate={setActiveKey}
                onClose={closeTab}
                onRerunAnalysis={(id) => void rerunAnalysis(id)}
                onAddBrackets={addBracketsFromAnalysis}
                bracketBinding={bracketBindingFor}
                onAddLetters={addLettersFromAnalysis}
                onPlotSurvival={plotSurvivalFromAnalysis}
                onPlotRoc={plotRocFromAnalysis}
                onPlotPca={plotPcaFromAnalysis}
                onPlotOrdination={plotOrdinationFromAnalysis}
                onPlotPartition={plotVariancePartitionFromAnalysis}
                onPlotMeta={plotMetaFromAnalysis}
                onPlotBiasFunnel={plotBiasFunnelFromAnalysis}
                onPlotResiduals={plotResidualsFromAnalysis}
                onExportAnalysis={exportAnalysis}
                onAnnotateStats={annotateStatsFromAnalysis}
                onSaveMethod={saveAnalysisAsMethod}
                onApplyMethod={(methodId, tableId) => void applyMethod(methodId, tableId)}
                onDeleteMethod={deleteMethodById}
                onExportMethod={exportMethod}
                onImportMethod={importMethod}
                onRefreshLinked={refreshLinked}
                onUnlinkLinked={unlinkTable}
                onEditDocs={setDocumentation}
                tableOps={tableOps}
                layoutOps={layoutOps}
                onOpenPlot={(id) => openTab("plot", id)}
                onOpenTable={(id) => openTab("table", id)}
                onDataSelectionChange={setDataSel}
                onSetPlotOptions={setPlotOptions}
                onExportGraph={exportGraph}
                onCopyPicture={() => void copyPictureActive()}
                onCopySvg={copySvgActive}
                onSetAxis={setAxis}
                onLegendDock={setLegendLine}
                onLegendLoose={(key, at) => { if (activePlot) mutateLive((d) => d.setPlotOptions(activePlot.id, legendLooseSet(activePlot, key, at))); }}
                onExportData={exportData}
                onExportFigure={exportFigure}
                selection={selection}
                onSelect={setSelection}
                zoom={activeZoom}
                onZoomWheel={onZoomWheel}
                graphView={activeGraphView}
                onGraphViewChange={setGraphView}
                onWidthResize={widthResizable ? resizeWidth : undefined}
                onMoveAnnotation={moveAnnotation}
                onMoveRefLineLabel={moveRefLineLabel}
                onDeleteAnnotation={deleteAnnotation}
                onReorderAnnotation={reorderAnnotation}
                onDuplicateAnnotation={duplicateAnnotation}
                onBoxAction={boxAction}
                boxHighlightBlocked={boxHighlightBlocked}
                onFigureResize={resizeFigure}
                onFigureScale={scaleFigure}
                figureFit={effectiveFit}
                resultDigits={resultDigits}
                onOpenLicence={() => openTab("licence")}
                guideTarget={guideTarget}
                onEditText={editText}
                onCreateTextBox={createTextBox}
                onAxisResize={setAxisLength}
                onMoveTitle={(dx, dy) => { if (activePlot) mutateLive((d) => d.setTitleOffset(activePlot.id, dx, dy)); }}
                onMoveSubtitle={(dx, dy) => { if (activePlot) mutateLive((d) => d.setPlotOptions(activePlot.id, { subtitleOffset: { dx, dy } })); }}
                onMoveLegend={(dx, dy) => { if (activePlot) mutateLive((d) => d.setLegendOffset(activePlot.id, dx, dy)); }}
                onMoveSignificanceCaption={(dx, dy) => { if (activePlot) mutateLive((d) => d.setPlotOptions(activePlot.id, { significance: { ...(activePlot.significance ?? {}), legendOffset: { dx, dy } } })); }}
                onMoveWaffleCaption={(dx, dy) => { if (activePlot) mutateLive((d) => moveWaffleCaption(d, activePlot, dx, dy)); }}
                onMoveColorbar={(dx, dy) => { if (activePlot) mutateLive((d) => d.setPlotOptions(activePlot.id, { colorbarOffset: { dx, dy } })); }}
                onMoveFitLabel={(dx: number, dy: number, fitIndex?: number) => { if (!activePlot) return; const k = fitIndex != null ? String(fitIndex) : undefined; mutateLive((d) => d.setPlotOptions(activePlot.id, k ? { fitsOffsets: { ...(activePlot.fitsOffsets ?? {}), [k]: { ...(activePlot.fitsOffsets?.[k] ?? {}), label: { dx, dy } } } } : { fitLabelOffset: { dx, dy } })); }}
                onMoveFitParams={(dx: number, dy: number, fitIndex?: number) => { if (!activePlot) return; const k = fitIndex != null ? String(fitIndex) : undefined; mutateLive((d) => d.setPlotOptions(activePlot.id, k ? { fitsOffsets: { ...(activePlot.fitsOffsets ?? {}), [k]: { ...(activePlot.fitsOffsets?.[k] ?? {}), params: { dx, dy } } } } : { fitParams: { ...(activePlot.fitParams ?? {}), offset: { dx, dy } } })); }}
                onMoveFitParamLine={(key: string, dx: number, dy: number) => { if (!activePlot) return; const fp = activePlot.fitParams ?? {}; mutateLive((d) => d.setPlotOptions(activePlot.id, { fitParams: { ...fp, lines: { ...(fp.lines ?? {}), [key]: { ...(fp.lines?.[key] ?? {}), offset: { dx, dy } } } } })); }}
                onMoveHeatmapLabels={(which, index, dx, dy) => { if (activePlot) mutateLive((d) => { const hm = activePlot.heatmap ?? {}; const key = which === "row" ? "rowLabelOffsets" : "colLabelOffsets"; d.setPlotOptions(activePlot.id, { heatmap: { ...hm, [key]: { ...(hm[key] ?? {}), [index]: { dx, dy } } } }); }); }}
                onMoveHeatSplitLabel={(axis, at, dx, dy) => { if (activePlot) mutateLive((d) => { const hm = activePlot.heatmap ?? {}; const key = axis === "row" ? "rowSplits" : "colSplits"; d.setPlotOptions(activePlot.id, { heatmap: { ...hm, [key]: (hm[key] ?? []).map((sp) => (sp.at === at ? { ...sp, labelOffset: { dx, dy } } : sp)) } }); }); }}
                onMoveHeatTrackName={(axis, index, dx, dy) => { if (activePlot) mutateLive((d) => { const hm = activePlot.heatmap ?? {}; const key = axis === "row" ? "rowTracks" : "colTracks"; d.setPlotOptions(activePlot.id, { heatmap: { ...hm, [key]: (hm[key] ?? []).map((t, i) => (i === index ? { ...t, nameOffset: { dx, dy } } : t)) } }); }); }}
                onMoveHeatTrackKey={(axis, index, dx, dy) => { if (activePlot) mutateLive((d) => { const hm = activePlot.heatmap ?? {}; const key = axis === "row" ? "rowTracks" : "colTracks"; d.setPlotOptions(activePlot.id, { heatmap: { ...hm, [key]: (hm[key] ?? []).map((t, i) => (i === index ? { ...t, keyOffset: { dx, dy } } : t)) } }); }); }}
                onMoveHeatTrackRunLabel={(axis, index, value, dx, dy) => { if (activePlot) mutateLive((d) => { const hm = activePlot.heatmap ?? {}; const key = axis === "row" ? "rowTracks" : "colTracks"; d.setPlotOptions(activePlot.id, { heatmap: { ...hm, [key]: (hm[key] ?? []).map((t, i) => (i === index ? { ...t, labelOffsets: { ...(t.labelOffsets ?? {}), [value]: { dx, dy } } } : t)) } }); }); }}
                onMoveVennSetLabel={(datasetId, dx, dy) => { if (activePlot) mutateLive((d) => { const v = activePlot.venn ?? {}; d.setPlotOptions(activePlot.id, { venn: { ...v, labelOffsets: { ...(v.labelOffsets ?? {}), [datasetId]: { dx, dy } } } }); }); }}
                onMoveUpsetSetLabel={(datasetId, dx, dy) => { if (activePlot) mutateLive((d) => { const u = activePlot.upset ?? {}; d.setPlotOptions(activePlot.id, { upset: { ...u, labelOffsets: { ...(u.labelOffsets ?? {}), [datasetId]: { dx, dy } } } }); }); }}
                onMoveTernaryAxisLabel={(datasetId, dx, dy) => { if (activePlot) mutateLive((d) => { const t = activePlot.ternary ?? {}; d.setPlotOptions(activePlot.id, { ternary: { ...t, axisLabelOff: { ...(t.axisLabelOff ?? {}), [datasetId]: { dx, dy } } } }); }); }}
                onMoveRoseDirectionLabel={(key, dx, dy) => { if (activePlot) mutateLive((d) => d.setPlotOptions(activePlot.id, roseDirectionMove(activePlot.rose, key, dx, dy))); }}
                onMoveOncoprintLabel={(axis, name, dx, dy) => { if (activePlot) mutateLive((d) => d.setPlotOptions(activePlot.id, oncoprintLabelMove(activePlot.oncoprint, axis, name, dx, dy))); }}
                onMoveCorrLabels={(which, index, dx, dy) => { if (activePlot) mutateLive((d) => { const cm = activePlot.corrmatrix ?? {}; const key = which === "row" ? "rowLabelOffsets" : "colLabelOffsets"; d.setPlotOptions(activePlot.id, { corrmatrix: { ...cm, [key]: { ...(cm[key] ?? {}), [index]: { dx, dy } } } }); }); }}
                onMoveCorrLegend={(dx, dy) => { if (activePlot) mutateLive((d) => d.setPlotOptions(activePlot.id, { corrmatrix: { ...(activePlot.corrmatrix ?? {}), legendOffset: { dx, dy } } })); }}
                onMoveTreemapRegionLabel={(group, dx, dy) => { if (activePlot) mutateLive((d) => { const tm = activePlot.treemap ?? {}; d.setPlotOptions(activePlot.id, { treemap: { ...tm, groupLabelOffsets: { ...(tm.groupLabelOffsets ?? {}), [group]: { dx, dy } } } }); }); }}
                onMoveNetworkNode={(nodeId, x, y) => { if (activePlot) mutateLive((d) => { const nw = activePlot.network ?? {}; d.setPlotOptions(activePlot.id, { network: { ...nw, nodePositions: { ...(nw.nodePositions ?? {}), [nodeId]: { x, y } } } }); }); }}
                onMoveSectionLabel={(section, dx, dy) => { if (activePlot) mutateLive((d) => { const pd = activePlot.paireddot ?? {}; d.setPlotOptions(activePlot.id, { paireddot: { ...pd, sectionLabelOffsets: { ...(pd.sectionLabelOffsets ?? {}), [section]: { dx, dy } } } }); }); }}
                onMoveCategoryGroupName={(axis, group, dx, dy) => {
                  if (!activePlot) return;
                  // Groups live on the data axis spec (a flipped chart draws the category
                  // spec on the visual Y), so route through dataAxisOf. Only a banded x/y
                  // axis can carry groups, and dataAxisOf only ever returns "x"/"y", so
                  // a y2/y3 mis-route is not reachable.
                  const dataAxis = dataAxisOf(activePlot, axis);
                  const cg = (dataAxis === "x" ? activePlot.xAxis : activePlot.yAxis)?.categoryGroups ?? {};
                  mutate((d) => d.setPlotAxis(activePlot.id, dataAxis, { categoryGroups: { ...cg, nameOffsets: { ...(cg.nameOffsets ?? {}), [group]: { dx, dy } } } }));
                }}
                onMoveAxisTitle={(axis, dx, dy) => { if (activePlot) mutateLive((d) => moveAxisTitle(d, activePlot, axis, dx, dy)); }}
                onRotateAxisTitle={(axis, angle) => { if (activePlot) mutate((d) => rotateAxisTitle(d, activePlot, axis, angle)); }}
                onMoveValueLabel={moveValueLabel}
                onMoveDirectLabel={moveDirectLabel}
                onParallelEdit={editParallel}
                onCamera3D={camera3D}
                graphRibbon={{
                  onSetGrid: setGrid,
                  onSetLegend: setLegend,
                  onSetFrame: setFrame,
                  onSetAxisScale: (axis, scale) => setAxis(axis, { scale: scale === "auto" ? undefined : scale }),
                  onSetPlotFont: setPlotFont,
                  onAddAnnotation: annotationOps.add,
                  onInsertImage: annotationOps.addImage,
                  onAddPercentChange: () => { if (activePlot) mutate((d) => d.addPercentChangeLabel(activePlot.id)); },
                  onSetShowValues: (show) => setPlotOptions({ showValues: show }),
                  onSetShowBarPoints: (show) => setPlotOptions({ showBarPoints: show }),
                  onSetSummary: (value) => {
                    if (!activePlot) return;
                    const k = activePlot.kind ?? "xy";
                    // box/violin/raincloud carry the centre+spread on `boxWhisker`; column
                    // scatter on `columnScatter` (a coherent centre+error pair); the rest
                    // (bar/histogram/…) per-series as the error-bar type.
                    if (k === "box" || k === "violin" || k === "raincloud") {
                      mutate((d) => d.setBoxWhisker(activePlot.id, value as BoxWhisker));
                    } else if (k === "scatter") {
                      const { center, error } = scatterSummaryPair(value);
                      mutate((d) => d.setPlotOptions(activePlot.id, { columnScatter: { ...(activePlot.columnScatter ?? {}), center, error } }));
                    } else {
                      const tbl = project.tables.find((t) => t.id === activePlot.source);
                      if (tbl) mutate((d) => { for (const ds of tableDatasets(tbl)) d.setErrorBars(activePlot.id, ds.id, { errorBars: value as ErrorBarType }); });
                    }
                  },
                  zoom: activeZoom,
                  onZoomIn: zoomIn,
                  onZoomOut: zoomOut,
                  onZoomReset: zoomReset,
                }}
                onAddGraph={(tableId) => (tableId ? openNewGraphFor(tableId) : addDefaultGraph())}
                onOpenGalleryItem={openGalleryItem}
                lineage={doc.projectLineage()}
                onOpenLineageObject={openLineageObject}
                onRerunStale={() => void rerunStale()}
                onOpenGallery={() => openTab("gallery")}
                onOpenGuide={() => openGuide()}
                onStartNewGraph={() => setNewGraphOpen(true)}
                onNewProject={addProject}
                onStartTour={(id) => setTourId(id)}
                onOpenTours={() => openTab("tours")}
              />
            ),
            inspector: (
              <Inspector
                smallGraph={smallGraphNotice}
                figureSlot={dedicatedLayout ? setFigureInspectorEl : undefined}
                docVersion={version}
                figureFit={effectiveFit}
                activeSection={activeSection}
                selection={selection}
                onSelect={setSelection}
                wholeGraph={wholeGraph}
                onSetWholeGraph={setWholeGraph}
                barWidthWhole={barWidthWhole}
                onSetBarWidthWhole={setBarWidthWhole}
                plot={activePlot}
                table={plotTable}
                foreignSeries={foreignSeries}
                otherTables={activePlot ? project.tables.filter((t) => t.id !== activePlot.source) : undefined}
                onSetAxis={setAxis}
                onSetAxisLength={setAxisLength}
                onSetAxisTitleFont={setAxisTitleFont}
                onSetSeriesStyle={setSeriesStyle}
                onSetSeriesStyleAll={setSeriesStyleAll}
                onSetPointStyle={setPointStyle}
                onClearPointStyles={clearPointStyles}
                onSetGrid={setGrid}
                onSetFrame={setFrame}
                onSetKind={setKind}
                onSetBarLayout={setBarLayout}
                onSetBarShape={setBarShape}
                onSetBoxWhisker={setBoxWhisker}
                onSetPlotOptions={setPlotOptions}
                onSetGraphTitle={setGraphTitle}
                onSetPlotFont={setPlotFont}
                onHomogenizeFont={homogenizeFont}
                onSetLegend={setLegend}
                onSetSignificance={setSignificance}
                onApplyPreset={applyStylePreset}
                userPresets={customPresets}
                onApplyUserPreset={applyUserPresetToActive}
                onSaveUserPreset={saveCurrentAsPreset}
                onAddPresetKind={addKindToActivePreset}
                onDeleteUserPreset={removeUserPreset}
                onRenameUserPreset={renameUserPresetHandler}
                onDuplicateUserPreset={duplicateUserPresetHandler}
                onRemovePresetKind={removePresetKindHandler}
                onReorderUserPresets={reorderUserPresetsHandler}
                profileDefault={profileDefault}
                onSetProfileDefault={setProfileDefaultPersist}
                onUserLibraryImported={refreshUserLibrary}
                gradients={project.gradients ?? []}
                gradientOps={{
                  save: (g) => mutate((d) => { d.saveGradient(g); }),
                  remove: (id) => mutate((d) => { d.removeGradient(id); }),
                  nextId: () => doc.nextGradientId(),
                  // Delete is refused while a graph still paints with it, and has to say which.
                  usedBy: (id) => doc.plotsUsingGradient(id).map((p) => p.name),
                }}
                annotationOps={annotationOps}
                statsOverlay={statsOverlay}
                equationOverlay={equationOverlay}
                assistant={{ suggestion: topTip, onRun: runTip, onDismiss: (id) => setDismissedTips((s) => new Set(s).add(id)) }}
              />
            ),
          };
          const docIndex = layout.order.indexOf("document");
          const dropTo = (target: DockId) => ({
            onDragOver: (e: React.DragEvent) => {
              if (e.dataTransfer.types.includes("text/mady-dock")) e.preventDefault();
            },
            onDrop: (e: React.DragEvent) => {
              const from = e.dataTransfer.getData("text/mady-dock") as DockId;
              if (from) rearrangeDocks(from, target);
            },
          });
          return layout.order.map((id, i) => {
            const side: "left" | "right" = i < docIndex ? "left" : "right";
            const column =
              id === "document" ? (
                <div className="col coldoc" ref={measureFigureFit} style={{ flex: 1, minWidth: 0 }} {...dropTo(id)}>
                  {columnContent.document}
                </div>
              ) : (
                <div
                  className="col colside"
                  style={{ width: dockCollapsed(id) ? RAIL_WIDTH : layout.sizes[id], flex: "none" }}
                  {...dropTo(id)}
                >
                  <Dock
                    id={id}
                    side={side}
                    collapsed={dockCollapsed(id)}
                    onToggle={() => toggleDockNow(id)}
                    onDragStart={(e) => e.dataTransfer.setData("text/mady-dock", id)}
                  >
                    {columnContent[id]}
                  </Dock>
                </div>
              );
            if (i === 0) return <Fragment key={id}>{column}</Fragment>;
            // Divider between the previous column and this one.
            const prev = layout.order[i - 1]!;
            const control: SideDockId =
              prev !== "document" ? (prev as SideDockId) : (id as SideDockId);
            const sign: 1 | -1 = prev !== "document" ? 1 : -1;
            const divider = dockCollapsed(control) ? (
              <div className="dockdivider static" />
            ) : (
              <ResizeDivider
                width={layout.sizes[control]}
                sign={sign}
                onResize={(w) => resizeDock(control, w)}
                onCommit={() => saveLayout(layoutRef.current)}
                onDoubleClick={() => toggleDockNow(control)}
              />
            );
            return (
              <Fragment key={id}>
                {divider}
                {column}
              </Fragment>
            );
          });
        })()}
      </div>
      <LogDrawer
        collapsed={layout.logCollapsed}
        onToggle={toggleLog}
        log={project.log}
        onOpen={openLogEntry}
        onClear={() => mutate((d) => d.clearLog())}
      />
      <StatusBar
        project={project}
        engineReady
        zoom={activeZoom}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onZoomMenu={() => setZoomDialogOpen(true)}
        onLayoutMenu={() => setLayoutMenuOpen(true)}
      />
      {recovery && (
        <RecoveryDialog
          snapshot={recovery}
          ageMs={Date.now() - recovery.savedAt}
          onRecover={() => recoverSnapshot(recovery)}
          onDiscard={discardRecovery}
        />
      )}
      {saveOpen && (
        <SaveDialog
          folders={savable.folders}
          loose={savable.loose}
          demoFolderId={savable.folders.find((f) => f.name === DEMO_FOLDER)?.id}
          onConfirm={(picks) => void saveProject(picks)}
          onCancel={() => setSaveOpen(false)}
        />
      )}
      {importSrc && (
        <ImportDialog src={importSrc} tables={project.tables.map((t) => ({ id: t.id, name: t.name }))} onConfirm={confirmImport} onCancel={() => setImportSrc(null)} />
      )}
      {manualPopup && (
        <ManualPopup
          target={manualPopup}
          version={typeof __MADY_BUILD__ === "string" ? __MADY_BUILD__ : undefined}
          onClose={() => setManualPopup(null)}
          onOpenTab={(t) => {
            setManualPopup(null);
            openGuide(t);
          }}
        />
      )}
      {ggplotSrc && !importSrc && (
        <GgplotImportDialog
          src={ggplotSrc}
          tables={project.tables}
          onConfirm={confirmGgplotImport}
          onCancel={() => setGgplotSrc(null)}
          // The script's data is usually not in the project yet: open the data importer on top;
          // the report dialog comes back when that closes (the script is kept).
          onImportData={() => void openImport()}
        />
      )}
      {reshapeTable && (
        <ReshapeDialog
          table={reshapeTable}
          docVersion={version}
          onConfirm={confirmReshape}
          onCancel={() => setReshapeTable(null)}
        />
      )}
      {rowStatsTable && (
        <RowStatsDialog
          table={rowStatsTable}
          docVersion={version}
          onConfirm={confirmRowStats}
          onCancel={() => setRowStatsTable(null)}
        />
      )}
      {pruneTable && (
        <PruneDialog
          table={pruneTable}
          docVersion={version}
          onConfirm={confirmPrune}
          onCancel={() => setPruneTable(null)}
        />
      )}
      {colMathTable && (
        <ColMathDialog
          table={colMathTable}
          docVersion={version}
          onConfirm={confirmColMath}
          onCancel={() => setColMathTable(null)}
        />
      )}
      {transposeSel && (
        <TransposeDialog
          table={transposeSel}
          docVersion={version}
          onConfirm={confirmTranspose}
          onCancel={() => setTransposeSel(null)}
        />
      )}
      {sortSel && (
        <SortDialog
          table={sortSel}
          onConfirm={confirmSort}
          onCancel={() => setSortSel(null)}
        />
      )}
      {splitSel && (
        <SplitDialog table={splitSel} docVersion={version} onConfirm={confirmSplit} onCancel={() => setSplitSel(null)} />
      )}
      {findSel && (
        <FindReplaceDialog table={findSel} onConfirm={confirmFindReplace} onCancel={() => setFindSel(null)} />
      )}
      {mergeSel && (
        <MergeDialog
          tables={project.tables}
          firstId={mergeSel.id}
          docVersion={version}
          onConfirm={confirmMerge}
          onCancel={() => setMergeSel(null)}
        />
      )}
      {extractSel && (
        <ExtractDialog
          table={extractSel}
          docVersion={version}
          onConfirm={confirmExtract}
          onCancel={() => setExtractSel(null)}
        />
      )}
      {transformTable && (
        <TransformDialog
          table={transformTable}
          docVersion={version}
          onConfirm={confirmTransform}
          onCancel={() => setTransformTable(null)}
        />
      )}
      {frequencyTable && (
        <FrequencyDialog
          table={frequencyTable}
          docVersion={version}
          onConfirm={confirmFrequency}
          onCancel={() => setFrequencyTable(null)}
        />
      )}
      {qqTableSel && (
        <QQDialog table={qqTableSel} docVersion={version} onConfirm={confirmQQ} onCancel={() => setQqTableSel(null)} />
      )}
      {simulateOpen && (
        <SimulateDialog onConfirm={confirmSimulate} onCancel={() => setSimulateOpen(false)} />
      )}
      {powerOpen && <PowerDialog onCancel={() => setPowerOpen(false)} />}
      {mcOpen && <MonteCarloDialog onCancel={() => setMcOpen(false)} />}
      {analyzeOpen && analyzeTable && (
        <AnalyzeDialog
          table={analyzeTable}
          onRun={(spec) => void confirmAnalyze(spec)}
          onCancel={() => { setAnalyzeOpen(false); setPendingAnalyzeSuggestion(null); }}
          initialMethod={analyzePreset?.method}
          initialVariant={analyzePreset?.variant}
          focusKind={analyzePreset?.focusKind}
          initialSuggestion={pendingAnalyzeSuggestion ?? undefined}
          recommendations={analysisTips}
          curveModelRecommendations={curveModelRecommendations}
        />
      )}
      {newGraphOpen && (
        <NewGraphDialog
          currentTableKind={newGraphTable?.kind}
          currentTable={newGraphTable}
          // Only "New graph of this data" (which set newGraphTableId) means "graph this sheet";
          // the generic "New graph…" door falls back to the working table for its format hint but
          // must make a new datasheet by default.
          preferOpenSheet={Boolean(newGraphTableId)}
          projects={project.workspace.folders}
          onCreate={confirmNewGraph}
          onCancel={() => { setNewGraphOpen(false); setNewGraphTableId(null); }}
        />
      )}
      {settingsOpen && (
        <SettingsDialog
          onOpenModelSetup={llmEnabled ? () => setModelSetupOpen(true) : undefined}
          onClose={() => setSettingsOpen(false)}
          onChanged={() => {
            // Keep the Inspector's default-preset picker + saved-preset list in sync.
            setProfileDefaultState(getProfileDefault());
            setCustomPresets(listUserPresets());
            // Apply a theme change from Settings to the live app immediately.
            setTheme(getAppDefaults().theme ?? "light");
            // Turning the startup fit off must un-fit every figure at once, not next launch.
            setFitEnabled(getAppDefaults().fitGraphsToWindow !== false);
            // Results-table rounding is display-only; apply (or lift) it immediately.
            setResultDigits(getAppDefaults().resultDigits ?? 0);
          }}
        />
      )}
      {bugReportOpen && (
        <BugReportDialog
          onClose={() => setBugReportOpen(false)}
          prefill={bugPrefill ?? undefined}
          documentName={projectName(project)}
          getDocumentJson={() => JSON.stringify(doc.toJSON())}
          state={{
            activeTab: activeTab?.kind ?? "none",
            plotId: activePlot?.id,
            plotKind: activePlot ? (activePlot.kind ?? "xy") : undefined,
            plotName: activePlot?.name,
            tableId: activeTableTab?.id,
            selection: selection ? JSON.stringify(selection) : undefined,
            zoom: activeZoom,
            counts: { tables: project.tables.length, plots: project.plots.length, analyses: project.analyses.length },
          }}
          analysisName={activeAnalysisTab?.name}
          getAnalysis={activeAnalysisTab ? () => analysisAttachment(activeAnalysisTab) : undefined}
        />
      )}
      {applyLookOpen && activePlot && (
        <ApplyLookDialog
          source={activePlot}
          plots={project.plots}
          tableName={(id) => project.tables.find((t) => t.id === id)?.name ?? "—"}
          onApply={(ids, keys, aspectLabel) => {
            const src = activePlot;
            mutate((d) => {
              d.applyPlotTemplateMany(ids, capturePlotStyle(src, keys, true), keys);
              d.appendLog("graph", `Applied "${src.name}" ${aspectLabel.toLowerCase()} to ${ids.length} graph${ids.length === 1 ? "" : "s"}`);
            });
            setApplyLookOpen(false);
          }}
          onCancel={() => setApplyLookOpen(false)}
        />
      )}
      {exportAllOpen && (
        <ExportAllDialog
          graphs={project.plots.map((p) => ({ id: p.id, name: p.name }))}
          figures={(project.layouts ?? []).map((l) => ({ id: l.id, name: l.name }))}
          onRun={runExportAll}
          onClose={() => setExportAllOpen(false)}
        />
      )}
      {stageItem && <ExportStage project={project} item={stageItem} onReady={(root) => stageReady.current?.(root)} />}
      {exportTarget && (
        <ExportDialog
          kind={exportTarget.kind}
          source={exportTarget.source ?? "graph"}
          suggestedName={exportTarget.name}
          plotId={exportTarget.plotId}
          printWidthMm={(exportTarget.source ?? "graph") === "graph" ? project.plots.find((p) => p.id === (exportTarget.plotId ?? activePlot?.id))?.printWidthMm : activeLayout?.page?.wMm}
          displayScale={(() => {
            const pl = (exportTarget.source ?? "graph") === "graph" ? project.plots.find((p) => p.id === (exportTarget.plotId ?? activePlot?.id)) : undefined;
            return pl ? graphDisplayScale(pl, effectiveFit) : undefined;
          })()}
          table={exportTarget.table}
          onExport={doExport}
          onCancel={() => setExportTarget(null)}
        />
      )}
      {flash && <div className="flashnote" role="status">{flash}</div>}
      <ColorVisionDefs />
      {colorVision.value !== "off" && (activePlot || activeLayout) && (
        <div className="cvdbadge" role="status">
          Colour-vision preview: {COLOR_VISION_NAME[colorVision.value]} — screen only, exports are unchanged
          <button type="button" className="btn-mini" title="Turn the preview off" onClick={() => colorVision.set("off")}>Off</button>
        </div>
      )}
      {paletteOpen && <CommandPalette actions={actions} onClose={() => setPaletteOpen(false)} onOpenGuide={(target) => openGuide(target)} />}
      {layoutMenuOpen && (
        <LayoutMenu
          builtins={BUILTIN_PRESETS}
          user={userPresets}
          onApply={applyLayoutPreset}
          onSave={saveLayoutPreset}
          onDelete={deleteLayoutPreset}
          onClose={() => setLayoutMenuOpen(false)}
        />
      )}
      {zoomDialogOpen && (
        <ZoomDialog
          zoom={activeZoom}
          onApply={(z) => {
            setZoom(z);
            setZoomDialogOpen(false);
          }}
          onClose={() => setZoomDialogOpen(false)}
        />
      )}
      {tourId && tourById(tourId) && (
        <TourOverlay
          key={tourId} // a different tour starts at its first step
          steps={tourById(tourId)!.steps}
          state={tourState}
          onQuit={() => setTourId(null)}
          onFinish={() => setTourId(null)}
          onCopySample={copyTourSample}
          onReach={reachTourNeed}
          onPerform={performTourStep}
        />
      )}
    </div>
  );
}

export function targetOf(folderId?: NodeId, experimentId?: NodeId) {
  if (folderId && experimentId) return { level: "experiment", folderId, experimentId } as const;
  if (folderId) return { level: "folder", folderId } as const;
  return { level: "loose" } as const;
}
