/**
 * @mady/core — the DOM-free heart: document model (scene graph), reactive
 * dependency DAG, command stack (undo/redo), theming.
 *
 * Hard rule: this package must not import the DOM or Electron. Text measurement
 * arrives via an injected `TextMeasurer` port, never `Canvas` directly —
 * the base tsconfig's `"lib": ["ES2022"]` (no DOM) enforces this at compile time.
 *
 * Contents: document model + reactive recompute + command stack + migration framework.
 */
export const MADY_CORE_VERSION = "0.0.0" as const;

export * from "./model";
export * from "./significancePlan";
export { REFERENCE_LINES, referenceLine, isReferenceLine, referenceLinesFor } from "./refLines";
export type { ReferenceLineInfo } from "./refLines";
export { MadyDocument } from "./document";
export type { AnalysisRun } from "./document";
export { remapPlotIds, stripPlotRefs } from "./remapPlotRefs";
export { setStrictMutations, strictMutations, mutationWarnings, clearMutationWarnings, refusedMutations, clearRefusals, unresolvedTarget } from "./strict";
export { CommandStack } from "./command";
export type { Command } from "./command";
export { IdFactory } from "./ids";
export { migrate, migrations } from "./migrations";
export type { Migration } from "./migrations";
export type { DateOrder } from "./cells";
export { extractProject, extractPicks, collectIds } from "./persist";
export type { SavePick } from "./persist";
export { createSampleDocument, DEMO_FOLDER } from "./sample";
export { STYLE_PRESETS, findPreset } from "./presets";
export type { StylePreset } from "./presets";
export { superscript, needsExponent, sciText, sciMarkup, rangeText } from "./sciFormat";
export { tableDatasets, xColumn, xErrorColumn, replicateCount, tableEntryMode, ENTRY_MODE_OPTIONS, drawableErrorTypes, naturalErrorType, KIND_COLUMNS, kindHasLeadColumn, nextColumnName, newDatasetColumns, swimmerColumns } from "./dataset";
export type { SwimmerColumns } from "./dataset";
export type { Dataset, EntryMode, EntryModeOption, KindColumns } from "./dataset";
export {
  buildAnalysisData,
  numericCell,
  columnValues,
  replicateColumns,
  datasetValues,
  datasetXY,
  xyExcludedRows,
  datasetPointSD,
  datasetName,
} from "./analysisData";
export {
  isRowGroupId,
  parseRowGroupId,
  rowGroupColumn,
  rowGroupId,
  rowGroupLevels,
  rowGroupsUsable,
  rowGroupValues,
} from "./rowGroups";
export {
  summarize,
  errorPoint,
  summaryErrorPoint,
  asymmetricErrorPoint,
  ciMultiplier,
  normalCiMultiplier,
  metaAnalysis,
  eggerTest,
  trimAndFill,
  studySE,
  studentTInv,
  regIncBeta,
  invRegIncBeta,
  logGamma,
  quantileSorted,
  boxStats,
  silvermanBandwidth,
  gaussianKde,
  medianCI,
} from "./stats";
export type { ReplicateSummary, ErrorPoint, BoxSummary, MetaStudy, MetaResult, EggerResult, TrimFillResult } from "./stats";
export {
  DELIMITERS,
  parseCellValue,
  detectDecimalComma,
  detectDelimiter,
  parseDelimited,
  parseWhitespace,
  rowWidths,
  parseA1Range,
  inferHeader,
  coerceGrid,
  transposeGrid,
  parseLinkedText,
  stripCommentLines,
  foldUnitRow,
  jsonToGrid,
} from "./import";
export type { Delimiter, CoerceOptions, CoercedTable } from "./import";
export { wideToLong, longToWide } from "./reshape";
export type {
  NamedTable,
  WideToLongOptions,
  LongToWideOptions,
} from "./reshape";
export { applyTransform, transformById, normInv, TRANSFORMS } from "./transform";
export type {
  TransformId,
  TransformFn,
  TransformSpec,
  TransformScope,
  ColumnContext,
} from "./transform";
export { KIND_HOUSE_DEFAULTS, EQUAL_ASPECT_KINDS, applyKindHouseDefaults } from "./presets";
export type { KindHouseDefault } from "./presets";
export {
  formatCellValue,
  parseCellInput,
  isCellExcluded,
  excludedCount,
  applyExclusions,
  effectiveValue,
  dateToDays,
  daysToISO,
  parseDate,
  formatElapsed,
  parseElapsed,
} from "./cells";
export { tableToNamedTable, recomputeDerived } from "./derive";
export { rowStatistics, pruneRows, removeBaseline, columnMath, transposeTable, extractColumns, mergeTables, mergeReportText, splitTextColumn, splitCounts, replaceInCell, SPLIT_MAX_PARTS, ROW_STATS } from "./dataprocess";
export type { MergeKeep, MergeReport, FindReplaceSpec } from "./dataprocess";
export type { RowStat } from "./dataprocess";
export { compileFormula, recomputeFormulas } from "./formula";
export type { FormulaEnv, CompiledFormula } from "./formula";
export { fitEquation, fitModelTemplate, FIT_MODEL_EQUATION, DISPLAY_ONLY_EQUATIONS } from "./fitEquation";
export { executeAgentCommand, executeAgentBatch, agentApiSchema } from "./agentApi";
export type { AgentCommand, AgentOp, AgentResult, AgentErrorCode, AgentOpMeta } from "./agentApi";
export { compileNL } from "./nlCompiler";
export type { NLCompiler, NLContext, NLResult, NLTable, NLColumn } from "./nlCompiler";
// The on-device-model half of the NL seam. Runtime-independent: `LocalModel` is one
// method, so any local runtime can implement it without changes elsewhere.
// No model is bundled or depended on here — see modelCompiler.ts.
export { makeModelCompiler, buildPrompt, extractCommands, refuseReason, allowedOps, forbiddenOps } from "./modelCompiler";
export type { LocalModel, ModelCompilerOptions } from "./modelCompiler";
// The sidecar implementation of LocalModel: a local model server, the same shape as the
// Python stats engine. Nothing is bundled; a model is fetched only when the user asks
// (`pullModel`, through the local server), and a non-loopback host is refused — the prompt carries the user's column
// names, so a remote host would be sending their data off the machine.
export { sidecarModel, resolveModelSidecar, probeModelSidecar, listServerModels, isLoopbackUrl, NonLoopbackModelHost, DEFAULT_MODEL_URL } from "./modelSidecar";
// Constrained decoding: a JSON Schema for the command array, derived from the closed op set.
// Destructive ops are absent from it by construction — see commandSchema.ts.
export { buildCommandSchema, schemaOps as commandSchemaOps } from "./commandSchema";
export type { JsonSchema, CommandSchemaOptions } from "./commandSchema";
export { pullModel, formatBytes } from "./modelSidecar";
// The Gemma 4 variants offered, their expected sizes, and the automatic pick — see modelCatalogue.ts.
export { GiB, MODEL_CATALOGUE, MEASURED_MODEL, modelByTag, pickModelForMemory } from "./modelCatalogue";
export type { ModelChoice, ModelPick } from "./modelCatalogue";
export type { PullProgress, PullResult } from "./modelSidecar";
export type { SidecarOptions } from "./modelSidecar";
export type { FitGlance } from "./fitEquation";
export { correlationMatrix } from "./correlation";
export type { CorrelationMethod } from "./correlation";
export { analysisToMethod, methodApplyParams, methodToFile, parseMethodFile } from "./method";
export { TABLE_FORMATS, TABLE_FORMAT_ORDER, tableFormat, tableFormatList, validateTable } from "./tableFormats";
export type { TableFormatInfo } from "./tableFormats";
export { histogram, histogramTable, histogramTableMulti, exactCumulativeTable, gaussianExpected } from "./histogram";
export { rankValues } from "./rank";
export type { HistogramOptions, HistogramBin } from "./histogram";
export { makeRng, drawFrom, simulate, simulateColumn, simulateXY, simXValues, GENERATORS } from "./simulate";
export type { SimulateSpec, SimColumnSpec, SimXYSpec, SimGroup, SimDist, Generator } from "./simulate";
export { normalProbabilityPlot, lognormalProbabilityPlot, qqTable, columnNumbers, gwasQQ, manhattanLayout, chromosomeOrder } from "./qqplot";
export type { QQPoint, QQResult, PlotPosition, GwasQQPoint, GwasQQResult, ChromosomeSpan, ManhattanLayout } from "./qqplot";
export { sunburstHierarchy, sunburstDepth } from "./sunburst";
export type { SunburstNode, SunburstItem } from "./sunburst";
export { chordLayout } from "./chord";
export type { ChordEdge, ChordArc, ChordRibbon, ChordLayout } from "./chord";
export { oncoprintMatrix } from "./oncoprint";
export type { AlterationEvent, OncoprintMatrix } from "./oncoprint";
export { residualDiagnostics } from "./residuals";
export { ordinationGraphPlan, ORDINATION_LABELS, CONSTRAINED_METHODS } from "./ordination";
export type { OrdinationGraph } from "./ordination";
export type { ResidualDiagnostics, DiagTable } from "./residuals";
export { hclust, clusterBreaks, clusterLabels, cutClusters, subtreeNodes, dendrogramCoords, pairwiseDistances, vectorDistance } from "./cluster";
export type { ClusterMetric, ClusterLinkage, DendroNode, HClustResult } from "./cluster";
export { arrangeBoxes } from "./arrange";
export type { AlignOp, Box } from "./arrange";
export { resolveOverlays } from "./overlays";
export type { ResolvedOverlays } from "./overlays";
export { translateGgplot, bindGgplot, extractChain, parseCall, parseArgs, splitTop, stripComments, matchColumn } from "./ggplotImport";
export type { GgplotTranslation, GgplotBinding, GgplotReportRow, GgplotAes, GgplotShape, Verdict as GgplotVerdict, RCall, RArg } from "./ggplotImport";
export { deriveSplitCopy, keepPositions, isPositionKey, sameJson, splitRefusal, SPLITTABLE_KINDS } from "./splitCopies";
export type { SplitPins } from "./splitCopies";
