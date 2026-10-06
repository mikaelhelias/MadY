/**
 * Onboarding / next-step assistant.
 *
 * A deterministic "what would help right now?" engine, not a chatbot. It reads
 * the project state plus the focused sheet and returns ordered suggestions tied
 * to existing app actions. Statistical recommendations live here too, so there
 * is one production source of truth for nudges, Analyze-dialog recommendations,
 * ranking, rationales, and caveats.
 */
import type { CellValue, DataTable, NodeId, Plot, PlotKind, Project } from "@mady/core";
import {
  tableDatasets,
  xColumn,
  isRowGroupId,
  parseRowGroupId,
  rowGroupColumn,
  rowGroupId,
  rowGroupLevels,
  rowGroupsUsable,
  rowGroupValues,
} from "@mady/core";

export type SuggestionKind = "general" | "analysis";
export type SuggestionConfidence = "high" | "medium" | "low";

export interface SuggestionChoice {
  id: string;
  label: string;
  description?: string | undefined;
  method?: string | undefined;
  variant?: string | undefined;
  focusKind?: string | undefined;
}

export interface SuggestionQuestion {
  prompt: string;
  choices: SuggestionChoice[];
}

export type CurveModelGoal = "potency" | "shape" | "compare" | "interpolate" | "explore";

export interface CurveModelRecommendation {
  variant: string;
  family: string;
  suitability: "recommended" | "alternative" | "caution" | "expert";
  confidence: SuggestionConfidence;
  score: number;
  reasons: string[];
  assumptions: string[];
  warnings: string[];
  goals: CurveModelGoal[];
}
export interface Suggestion {
  /** Stable id (also the dismiss key). */
  id: string;
  /** The one-line prompt shown to the user. */
  text: string;
  /** The call-to-action button label. */
  cta: string;
  /** An action id in the app's action registry (menus / palette / this nudge share it). */
  actionId: string;
  /** General workflow nudge or statistical recommendation. Undefined is treated as "general". */
  kind?: SuggestionKind | undefined;
  /** How strongly the data/graph structure supports this recommendation. */
  confidence?: SuggestionConfidence | undefined;
  /** Short evidence bullets shown in richer surfaces such as Analyze. */
  reasons?: string[] | undefined;
  /** Explicit cautions; uncertainty becomes a caveat, not a hidden assumption. */
  caveats?: string[] | undefined;
  /** Assumptions users should confirm before configuring/running. */
  assumptions?: string[] | undefined;
  /** Close, statistically reasonable alternatives to consider. */
  alternatives?: string[] | undefined;
  /** Tempting methods that are not sufficient or not supported by the detected structure. */
  notRecommendedBecause?: string[] | undefined;
  /** A high-impact question the UI can ask before choosing among valid paths. */
  question?: SuggestionQuestion | undefined;
  /** Analysis method id for analysis suggestions. */
  method?: string | undefined;
  /** Analysis variant/model id for analysis suggestions. */
  variant?: string | undefined;
  /** Source column/dataset ids in the order AnalyzeDialog expects. */
  columns?: NodeId[] | undefined;
  /** Optional guided AnalyzeDialog focus key. */
  focusKind?: string | undefined;
}

export interface AssistantContext {
  /** The graph currently open/selected (if any). */
  activePlotId?: NodeId | undefined;
  /** The datasheet currently open (if the active tab is a table). */
  activeTableId?: NodeId | undefined;
  /** The analysis result currently open — its source table counts as the viewed data. */
  activeAnalysisId?: NodeId | undefined;
  /** Optional curve-fit selections used by the in-dialog model picker. */
  curveXId?: NodeId | undefined;
  curveYId?: NodeId | undefined;
}

interface NumericSummary {
  id: NodeId;
  name: string;
  n: number;
  missing: number;
  unique: number;
  binary: boolean;
  integer: boolean;
  nonNegative: boolean;
  proportionLike: boolean;
  smallN: boolean;
  roughSkew: boolean;
  roughOutliers: boolean;
  looksOrdinal: boolean;
  min: number | null;
  max: number | null;
  mean: number | null;
  variance: number | null;
  sd: number | null;
}

interface TableProfile {
  tableId: NodeId;
  kind?: DataTable["kind"] | undefined;
  rows: number;
  columns: number;
  datasets: ReturnType<typeof tableDatasets>;
  xId?: NodeId | undefined;
  xN: number;
  xPositive: boolean;
  xMonotonic: boolean;
  xLogSpaced: boolean;
  summaries: NumericSummary[];
  datasetSummaries: NumericSummary[];
  usableDatasets: NumericSummary[];
  numericColumns: NumericSummary[];
  binaryColumns: NumericSummary[];
  countLike: boolean;
  proportionLike: boolean;
  countShape?: { rows: number; cols: number; total: number; minExpected: number; is2x2: boolean } | undefined;
  survivalLike: boolean;
  hasReplicates: boolean;
  repeatedMeasuresEligible: boolean;
  maxPairedComplete: number;
  minGroupN: number | null;
  varianceRatio: number | null;
  anySmallN: boolean;
  anySkew: boolean;
  anyOutliers: boolean;
  likelyBinaryOutcome?: NodeId | undefined;
  likelyContinuousOutcome?: NodeId | undefined;
  likelyCountOutcome?: NodeId | undefined;
}

type GraphIntent =
  | "group-comparison"
  | "paired-comparison"
  | "relationship"
  | "classification"
  | "dose-response"
  | "agreement"
  | "survival"
  | "counts"
  | "multivariable"
  | "distribution"
  | "pca"
  | "cluster"
  | "analysis-followup"
  /** A graph with its own purpose (volcano · forest · pyramid · radar · network) that no
   *  generic rule serves — set so the "any XY sheet → correlation" nudge stays away. */
  | "specialised";

interface RankedSuggestion extends Suggestion {
  kind: "analysis";
  confidence: SuggestionConfidence;
  reasons: string[];
  caveats: string[];
  score: number;
}

function numericCell(v: CellValue | undefined): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function columnValues(table: DataTable, columnId: NodeId): number[] {
  const out: number[] = [];
  for (const row of table.rows ?? []) {
    const v = numericCell(row.cells?.[columnId]);
    if (v !== null) out.push(v);
  }
  return out;
}

function datasetValues(table: DataTable, datasetId: NodeId): number[] {
  // This module keeps a local, null-tolerant copy of the core helper (it profiles
  // half-built tables). Row groups are virtual datasets with no columns of their own,
  // so hand those to the core resolver rather than looking for a column that is not
  // there — otherwise every row-group suggestion is rejected as "too few values".
  const rg = parseRowGroupId(datasetId);
  if (rg) return rowGroupValues(table, rg.labelColumnId, rg.level);
  const ds = tableDatasets(table).find((d) => d.id === datasetId);
  const cols = ds?.replicates?.length ? ds.replicates : [datasetId];
  const out: number[] = [];
  for (const row of table.rows ?? []) {
    for (const colId of cols) {
      const v = numericCell(row.cells?.[colId]);
      if (v !== null) out.push(v);
    }
  }
  return out;
}

function completeRows(table: DataTable, ids: NodeId[]): number {
  return (table.rows ?? []).filter((row) => ids.every((id) => numericCell(row.cells?.[id]) !== null)).length;
}

function pairedCompleteCount(table: DataTable, a: NodeId, b: NodeId): number {
  const dsA = tableDatasets(table).find((d) => d.id === a);
  const dsB = tableDatasets(table).find((d) => d.id === b);
  const colsA = dsA?.replicates?.length ? dsA.replicates : [a];
  const colsB = dsB?.replicates?.length ? dsB.replicates : [b];
  return (table.rows ?? []).filter((row) => colsA.some((id) => numericCell(row.cells?.[id]) !== null) && colsB.some((id) => numericCell(row.cells?.[id]) !== null)).length;
}

function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo);
}

function countShape(table: DataTable, summaries: NumericSummary[]): { rows: number; cols: number; total: number; minExpected: number; is2x2: boolean } | undefined {
  const numeric = summaries.filter((s) => s.n > 0 && s.integer && s.nonNegative);
  if (!numeric.length) return undefined;
  const tableRows = table.rows ?? [];
  const rowTotals = tableRows.map((row) => numeric.reduce((a, s) => a + (numericCell(row.cells?.[s.id]) ?? 0), 0));
  const colTotals = numeric.map((s) => columnValues(table, s.id).reduce((a, v) => a + v, 0));
  const total = colTotals.reduce((a, v) => a + v, 0);
  if (total <= 0) return undefined;
  let minExpected = Number.POSITIVE_INFINITY;
  for (const rt of rowTotals) for (const ct of colTotals) minExpected = Math.min(minExpected, (rt * ct) / total);
  return { rows: tableRows.length, cols: numeric.length, total, minExpected, is2x2: tableRows.length === 2 && numeric.length === 2 };
}
function summarize(id: NodeId, name: string, values: number[], missing = 0): NumericSummary {
  const n = values.length;
  const sorted = [...values].sort((a, b) => a - b);
  const uniqueValues = new Set(values.map((v) => String(v)));
  const mean = n > 0 ? values.reduce((a, v) => a + v, 0) / n : null;
  const variance = n >= 2 && mean !== null ? values.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1) : null;
  const sd = variance !== null ? Math.sqrt(variance) : null;
  const q1 = percentile(sorted, 0.25);
  const median = percentile(sorted, 0.5);
  const q3 = percentile(sorted, 0.75);
  const iqr = q1 !== null && q3 !== null ? q3 - q1 : null;
  const binary = uniqueValues.size > 0 && uniqueValues.size <= 2 && values.every((v) => v === 0 || v === 1);
  const integer = values.length > 0 && values.every((v) => Number.isInteger(v));
  const nonNegative = values.length > 0 && values.every((v) => v >= 0);
  const roughOutliers = iqr !== null && iqr > 0 && values.some((v) => v < q1! - 1.5 * iqr || v > q3! + 1.5 * iqr);
  const roughSkew = q1 !== null && median !== null && q3 !== null && iqr !== null && iqr > 0 ? Math.abs((q3 + q1 - 2 * median) / iqr) > 0.5 : false;
  return {
    id,
    name,
    n,
    missing,
    unique: uniqueValues.size,
    binary,
    integer,
    nonNegative,
    proportionLike: values.length > 0 && values.every((v) => v >= 0 && v <= 1),
    smallN: n > 0 && n < 5,
    roughSkew,
    roughOutliers,
    looksOrdinal: integer && uniqueValues.size > 2 && uniqueValues.size <= 7,
    min: n > 0 ? sorted[0]! : null,
    max: n > 0 ? sorted[sorted.length - 1]! : null,
    mean,
    variance,
    sd,
  };
}

function monotonic(values: number[]): boolean {
  if (values.length < 3) return false;
  let inc = true;
  let dec = true;
  for (let i = 1; i < values.length; i++) {
    inc &&= values[i]! >= values[i - 1]!;
    dec &&= values[i]! <= values[i - 1]!;
  }
  return inc || dec;
}

/** Largest deviation of the successive differences from their mean, relative to that mean. */
function spacingUnevenness(values: number[]): number {
  const diffs = values.slice(1).map((v, i) => v - values[i]!);
  const mean = diffs.reduce((a, v) => a + v, 0) / diffs.length;
  if (!Number.isFinite(mean) || Math.abs(mean) < 1e-12) return Number.POSITIVE_INFINITY;
  return Math.max(...diffs.map((d) => Math.abs(d - mean))) / Math.abs(mean);
}

function roughlyLogSpaced(values: number[]): boolean {
  const xs = [...new Set(values.filter((v) => v > 0))].sort((a, b) => a - b);
  if (xs.length < 4) return false;
  // 10..17, years 2000..2007 and 20,25,…,40 all have similar successive
  // log-differences too. Dose-like X must span at least a decade and be more evenly
  // spaced in log than in linear terms — otherwise it is just an evenly spaced axis.
  if (xs[xs.length - 1]! / xs[0]! < 10) return false;
  const logUneven = spacingUnevenness(xs.map((v) => Math.log10(v)));
  return logUneven < 0.35 && logUneven < spacingUnevenness(xs);
}

export function profileTable(table: DataTable, selectedXId?: NodeId): TableProfile {
  const columns = table.columns ?? [];
  const rows = table.rows ?? [];
  const datasets = columns.length ? tableDatasets(table) : [];
  const x = columns.length ? columns.find((c) => c.id === selectedXId) ?? xColumn(table) : undefined;
  const summaries = columns.map((col) => {
    const values = columnValues(table, col.id);
    return summarize(col.id, col.name || col.id, values, Math.max(0, rows.length - values.length));
  });
  const datasetSummaries = datasets.map((ds) => {
    const values = datasetValues(table, ds.id);
    const possible = Math.max(1, rows.length) * Math.max(1, ds.replicates.length);
    return summarize(ds.id, ds.name || ds.id, values, Math.max(0, possible - values.length));
  });
  const usableDatasets = datasetSummaries.filter((s) => s.n >= 2);
  const variances = usableDatasets.map((s) => s.variance).filter((v): v is number => v != null && v > 0);
  const minVar = variances.length ? Math.min(...variances) : 0;
  const maxVar = variances.length ? Math.max(...variances) : 0;
  const xValues = x ? columnValues(table, x.id) : [];
  const numericColumns = summaries.filter((s) => s.n >= 2);
  const binaryColumns = summaries.filter((s) => s.binary);
  const pairCounts = usableDatasets.flatMap((a, i) => usableDatasets.slice(i + 1).map((b) => pairedCompleteCount(table, a.id, b.id)));
  const nonX = summaries.filter((s) => s.id !== x?.id && s.n >= 2);
  const cs = countShape(table, summaries);
  // `y` only as a whole word (`\by\b`), so names such as "Study hrs" or "family" are not taken as the outcome.
  const outcomeHint = /outcome|response|target|result|status|event|class|case|label|dependent|value|score|\by\b/i;
  const countOutcomeHint = /count|number|total|frequency|events?|cases?/i;
  const likelyOutcome = nonX.find((s) => outcomeHint.test(s.name));
  const likelyBinary = nonX.find((s) => s.binary && outcomeHint.test(s.name));
  const likelyCount = nonX.find((s) => s.integer && s.nonNegative && !s.binary && countOutcomeHint.test(s.name));
  return {
    tableId: table.id,
    kind: table.kind,
    rows: rows.length,
    columns: columns.length,
    datasets,
    xId: x?.id,
    xN: xValues.length,
    xPositive: xValues.length > 0 && xValues.every((v) => v > 0),
    xMonotonic: monotonic(xValues),
    xLogSpaced: roughlyLogSpaced(xValues),
    summaries,
    datasetSummaries,
    usableDatasets,
    numericColumns,
    binaryColumns,
    countLike: summaries.some((s) => s.n > 0) && summaries.every((s) => s.n === 0 || (s.integer && s.nonNegative)),
    proportionLike: summaries.some((s) => s.proportionLike),
    countShape: cs,
    // Only a survival sheet counts: "a full first column + any 0/1 column" would also
    // describe ROC data (score + label) and offer it a survival analysis.
    survivalLike: table.kind === "survival",
    hasReplicates: datasets.some((d) => d.replicates.length > 1),
    repeatedMeasuresEligible: usableDatasets.length >= 2 && pairCounts.some((n) => n >= 3),
    maxPairedComplete: pairCounts.length ? Math.max(...pairCounts) : 0,
    minGroupN: usableDatasets.length ? Math.min(...usableDatasets.map((s) => s.n)) : null,
    varianceRatio: minVar > 0 && maxVar > 0 ? maxVar / minVar : null,
    anySmallN: usableDatasets.some((s) => s.smallN),
    anySkew: usableDatasets.some((s) => s.roughSkew),
    anyOutliers: usableDatasets.some((s) => s.roughOutliers),
    likelyBinaryOutcome: likelyBinary?.id,
    likelyContinuousOutcome: likelyOutcome && !likelyOutcome.binary && !likelyOutcome.looksOrdinal ? likelyOutcome.id : undefined,
    likelyCountOutcome: likelyCount?.id,
  };
}

export function inferGraphIntent(plot: Plot | undefined, table: DataTable | undefined): GraphIntent | undefined {
  if (!plot) return undefined;
  if (plot.analysisSource) return "analysis-followup";
  // `plot.kind === undefined` is the default XY graph (see Plot.kind doc-comment) — the most
  // common case. Normalise to "xy" so the switch's relationship/multivariable branch fires
  // instead of falling through to `undefined` and silently disabling graph-aware ranking.
  const kind = (plot.kind ?? "xy") as PlotKind;
  switch (kind) {
    case "box":
    case "violin":
    case "raincloud":
    case "estimation":
      return "group-comparison";
    case "bar":
    case "floatingbar":
      return table?.kind === "contingency" || table?.kind === "partsofwhole" ? "counts" : "group-comparison";
    case "beforeafter":
    case "paireddot": // paired dots are row-matched, like before-after
      return "paired-comparison";
    case "scatter":
    case "xy":
    case "bubble":
      return table?.kind === "xy" ? "relationship" : "multivariable";
    case "blandaltman":
      return "agreement";
    case "histogram":
    case "ridgeline":
      return "distribution";
    case "survival":
      return "survival";
    case "roc":
      return "classification";
    case "pie":
    case "treemap":
    case "alluvial":
      return "counts";
    case "heatmap":
    case "corrmatrix":
    case "parallel":
    case "scatter3d":
      return "multivariable";
    case "pcascore":
    case "pcaload":
    case "pcabiplot":
    case "scree":
      return "pca";
    case "dendrogram":
      return "cluster";
    case "volcano":
    case "forest":
    case "pyramid":
    case "radar":
    case "network":
      return "specialised"; // not "no intent" — no generic correlation nudge
    default:
      return undefined;
  }
}

function confidence(score: number): SuggestionConfidence {
  if (score >= 82) return "high";
  if (score >= 60) return "medium";
  return "low";
}

function addSuggestion(out: RankedSuggestion[], score: number, spec: Omit<RankedSuggestion, "kind" | "confidence" | "score">): void {
  out.push({ ...spec, kind: "analysis", confidence: confidence(score), score });
}

/**
 * Does this block look like a count matrix with many zeros — a species table, in other words?
 *
 * It matters because that is the one shape where a PCA is the classic misuse: PCA is fixed to
 * Euclidean distance on the raw values, and a table of counts full of zeros makes two sites
 * that share no species look as similar as two that share half of them. Correspondence
 * analysis (chi-square) and an NMDS on Bray-Curtis exist for exactly this.
 *
 * The test is deliberately narrow: every value a non-negative whole number, and more than a
 * third of them zero. Measurements do not look like that.
 */
function countsWithManyZeros(table: DataTable, ids: NodeId[]): { looksLikeCounts: boolean; zeroFraction: number } {
  let total = 0;
  let zeros = 0;
  for (const id of ids) {
    for (const row of table.rows) {
      const v = numericCell(row.cells[id]);
      if (v === null) continue;
      if (v < 0 || !Number.isInteger(v)) return { looksLikeCounts: false, zeroFraction: 0 };
      total++;
      if (v === 0) zeros++;
    }
  }
  if (total < 12) return { looksLikeCounts: false, zeroFraction: 0 };
  const zeroFraction = zeros / total;
  return { looksLikeCounts: zeroFraction > 0.35, zeroFraction };
}

function firstIds(items: NumericSummary[], n: number): NodeId[] {
  return items.slice(0, n).map((s) => s.id);
}

function hasAnalysis(project: Project, tableId: NodeId, method: string): boolean {
  return (project.analyses ?? []).some((a) => a.source === tableId && a.method === method && a.status !== "error");
}

function methodVariantOk(method: string | undefined, variant: string | undefined): boolean {
  if (!method) return false;
  const variants: Record<string, string[]> = {
    ttest: ["welch", "unpaired", "paired", "mann-whitney", "wilcoxon"],
    anova: ["anova", "welch", "kruskal"],
    rmanova: ["rmanova", "friedman"],
    contingency: ["independent", "paired"],
    goodnessoffit: ["chisq", "binomial"],
    correlation: ["pearson", "spearman"],
    corrmatrix: ["pearson", "spearman"],
    regression: ["ols"],
    blandaltman: ["default"],
    deming: ["default"],
    passingbablok: ["default"],
    curvefit: ["4pl", "3pl", "5pl", "mm", "onesite"],
    roc: [],
survival: ["logrank"],
    cox: ["cox"],
    twoway: ["default"],
    multifactor: ["default"],
    mixedmodel: ["reml", "ml"],
    nested: ["default"],
    pca: ["standardize", "center"],
    // The ordinations take no variant — their choices (distance, transformation, scaling) are
    // settings, not variants, so an empty list means "the method, no variant".
    ca: [],
    pcoa: [],
    nmds: [],
    cluster: ["kmeans", "hierarchical"],
    normality: ["default"],
    describe: ["default"],
    logistic: ["default"],
    multipleregression: ["default"],
    poisson: ["default"],
  };
  return method in variants && (!variant || variants[method]!.includes(variant));
}

function valuesForSelection(table: DataTable, id: NodeId): number[] {
  // A row group resolves through datasetValues too (it is a virtual dataset).
  if (isRowGroupId(id) || tableDatasets(table).some((d) => d.id === id)) return datasetValues(table, id);
  return columnValues(table, id);
}

export function validateSuggestionSpec(table: DataTable, suggestion: Suggestion): { ok: boolean; reason?: string } {
  if (suggestion.kind !== "analysis" || !suggestion.method) return { ok: false, reason: "not an analysis suggestion" };
  if (!methodVariantOk(suggestion.method, suggestion.variant)) return { ok: false, reason: "unsupported method or variant" };
  const ids = new Set((table.columns ?? []).map((c) => c.id));
  const datasetIds = new Set(tableDatasets(table).map((d) => d.id));
  const cols = suggestion.columns ?? [];
  // A row-group id is valid when its label column exists and the category is present —
  // a stale spec naming a category that has since been renamed must still be rejected.
  const knownRowGroup = (id: NodeId): boolean => {
    const rg = parseRowGroupId(id);
    return Boolean(rg && ids.has(rg.labelColumnId) && rowGroupLevels(table, rg.labelColumnId).includes(rg.level));
  };
  if (cols.some((id) => !ids.has(id) && !datasetIds.has(id) && !knownRowGroup(id))) {
    return { ok: false, reason: "unknown column" };
  }
  switch (suggestion.method) {
    case "ttest":
      if (cols.length < 2) return { ok: false, reason: "t test needs two groups" };
      if (cols.slice(0, 2).some((id) => valuesForSelection(table, id).length < 2)) return { ok: false, reason: "too few complete values" };
      if (suggestion.variant === "paired" && pairedCompleteCount(table, cols[0]!, cols[1]!) < 3) return { ok: false, reason: "too few row-aligned pairs" };
      return { ok: true };
    case "anova":
    case "rmanova":
      if (cols.length < 3) return { ok: false, reason: "needs at least three groups" };
      if (cols.some((id) => valuesForSelection(table, id).length < 2)) return { ok: false, reason: "too few values per group" };
      if (suggestion.method === "rmanova" && completeRows(table, cols.filter((id) => ids.has(id))) < 3) return { ok: false, reason: "too few complete repeated rows" };
      return { ok: true };
    case "correlation":
    case "regression":
    case "blandaltman":
    case "deming":
    case "passingbablok":
    case "curvefit":
    case "roc":
      if (cols.length < 2 || completeRows(table, cols.slice(0, 2).filter((id) => ids.has(id))) < 3) return { ok: false, reason: "needs paired X/Y values" };
      return { ok: true };
    case "contingency":
    case "goodnessoffit":
      {
        const p = profileTable(table);
        if (!p.countLike && !(suggestion.method === "goodnessoffit" && table.kind === "partsofwhole" && p.proportionLike)) return { ok: false, reason: "not count or proportion data" };
        return { ok: true };
      }
    case "survival":
      if (!profileTable(table).survivalLike) return { ok: false, reason: "not survival-shaped data" };
      return { ok: true };
    case "cox":
      if (!profileTable(table).survivalLike || cols.length < 3) return { ok: false, reason: "Cox needs survival data and covariates" };
      return { ok: true };
    case "logistic":
      {
        const p = profileTable(table);
        if (!p.likelyBinaryOutcome || cols[0] !== p.likelyBinaryOutcome || cols.length < 2 || completeRows(table, cols.filter((id) => ids.has(id))) < 3) return { ok: false, reason: "logistic regression needs a binary outcome and predictors" };
        return { ok: true };
      }
    case "multipleregression":
      if (cols.length < 2 || completeRows(table, cols.filter((id) => ids.has(id))) < 3) return { ok: false, reason: "regression needs an outcome and predictor" };
      return { ok: true };
    case "poisson":
      {
        const p = profileTable(table);
        if (!p.likelyCountOutcome || cols[0] !== p.likelyCountOutcome || cols.length < 2 || completeRows(table, cols.filter((id) => ids.has(id))) < 3) return { ok: false, reason: "Poisson regression needs a count outcome and predictor" };
        return { ok: true };
      }
    case "nested":
      if (cols.length < 2 || cols.some((id) => valuesForSelection(table, id).length < 2)) return { ok: false, reason: "nested analysis needs two usable groups" };
      return { ok: true };
    case "mixedmodel":
    case "multifactor":
      if (cols.length < 3 || completeRows(table, cols.filter((id) => ids.has(id))) < 3) return { ok: false, reason: "needs a complete multivariable design" };
      return { ok: true };
    case "corrmatrix":
    case "pca":
    case "ca":
    case "pcoa":
    case "nmds":
    case "cluster":
      if (cols.length < 3 || completeRows(table, cols.filter((id) => ids.has(id))) < 3) return { ok: false, reason: "needs enough complete multivariable rows" };
      return { ok: true };
    case "normality":
    case "describe":
      return cols.length > 0 ? { ok: true } : { ok: false, reason: "needs a numeric column" };
    default:
      return { ok: false, reason: "unsupported method" };
  }
}

export function rankCandidates(
  project: Project,
  table: DataTable,
  candidates: RankedSuggestion[],
  opts: { includeCompleted?: boolean } = {},
): Suggestion[] {
  const seen = new Set<string>();
  return candidates
    .filter((s) => validateSuggestionSpec(table, s).ok)
    // Already-run methods are hidden from the assistant (no repeated prompts about
    // finished work) but kept for the Analyze dialog, which is a picker: it must still
    // show what fits the data. Hiding them there would make a dose-response fit vanish
    // from the recommendations the moment one curve fit had been run on that sheet.
    .filter((s) => opts.includeCompleted || !hasAnalysis(project, table.id, s.method ?? ""))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .filter((s) => {
      const key = `${s.method}:${s.variant ?? ""}:${(s.columns ?? []).join(",")}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(({ score: _score, ...s }) => s);
}
export function buildCandidateSpecs(project: Project, table: DataTable, activePlot: Plot | undefined, profile: TableProfile, intent: GraphIntent | undefined, opts: { includeCompleted?: boolean } = {}): RankedSuggestion[] {
  const out: RankedSuggestion[] = [];
  const name = table.name || "this data";
  const groupIds = firstIds(profile.usableDatasets, Math.min(profile.usableDatasets.length, 6));
  const twoGroups = firstIds(profile.usableDatasets, 2);
  const graphReason = activePlot ? [`The active ${activePlot.kind ?? "xy"} graph points to this workflow.`] : [];
  // `includeCompleted` (the Analyze dialog) keeps proposing a method the sheet has
  // already been through — the dialog is a picker, not a reminder.
  const already = (method: string): boolean => !opts.includeCompleted && hasAnalysis(project, table.id, method);
  // Distribution red flags → prefer a rank-based (nonparametric) test as the primary. These
  // signals are computed by profileTable: outliers/skew mean the data are not normal-shaped, and a small n makes the normal-theory assumption
  // impossible to verify — in all three cases a rank test is the more defensible default.
  const nonparametric = profile.anySkew || profile.anyOutliers || profile.anySmallN;
  const npWhy = profile.anyOutliers
    ? "outliers were detected in at least one group"
    : profile.anySkew
      ? "at least one group's values look skewed"
      : "the groups are small, so a normal distribution cannot be assumed";

  if ((profile.kind === "column" || intent === "group-comparison") && profile.usableDatasets.length === 2 && !already("ttest")) {
    addSuggestion(out, intent === "group-comparison" ? 92 : 84, {
      id: `analysis:${table.id}:ttest:welch`,
      text: `${activePlot ? "This graph" : `"${name}"`} looks ready for a two-group comparison.`,
      cta: "Configure Welch test",
      actionId: "analyze",
      method: "ttest",
      variant: "welch",
      columns: twoGroups,
      reasons: [...graphReason, "Two usable numeric groups were detected.", "Welch's t test is the safer default because it does not assume equal SDs."],
      caveats: ["Use a paired test only if rows are true matched pairs.", "Use Mann-Whitney if the values are ordinal or a rank-based question is intended."],
      assumptions: ["Groups are independent unless you know the rows are paired."],
      alternatives: ["Mann-Whitney for ordinal, small, or strongly skewed data.", "Student t test only when equal variances are defensible.", "Paired t test only for matched before/after rows."],
    });
    if (nonparametric) {
      addSuggestion(out, (intent === "group-comparison" ? 92 : 84) + 4, {
        id: `analysis:${table.id}:ttest:mann-whitney`,
        text: `${activePlot ? "This graph" : `"${name}"`} is better compared with a rank-based test.`,
        cta: "Configure Mann-Whitney",
        actionId: "analyze",
        method: "ttest",
        variant: "mann-whitney",
        columns: twoGroups,
        reasons: [...graphReason, `A rank-based (nonparametric) test is more robust here because ${npWhy}.`, "Mann-Whitney compares the two groups without assuming normal, equal-variance data."],
        caveats: ["Rank-based tests have limited power at very small n.", "Welch's t test is a reasonable alternative if the data are approximately normal."],
        assumptions: ["The two groups are independent."],
        alternatives: ["Welch's t test when normality is defensible."],
      });
    }
  }

  // Groups in rows. A tidy sheet (category column + one value dataset) exposes a
  // single dataset, so none of the column-based rules above fire and the user would be
  // left with descriptives only. Offer the comparison its categories plainly invite.
  if (rowGroupsUsable(table)) {
    const labelId = rowGroupColumn(table);
    const levels = labelId ? rowGroupLevels(table, labelId) : [];
    const ids = labelId ? levels.map((lv) => rowGroupId(labelId, lv)) : [];
    const labelName = table.columns?.find((c) => c.id === labelId)?.name ?? "the first column";
    const enough = ids.filter((id) => datasetValues(table, id).length >= 2).length;
    if (levels.length === 2 && enough === 2 && !already("ttest")) {
      addSuggestion(out, 86, {
        id: `analysis:${table.id}:rowgroup:ttest`,
        text: `${activePlot ? "This graph" : `"${name}"`} compares two groups held in the ${labelName} column.`,
        cta: "Configure Welch test",
        actionId: "analyze",
        method: "ttest",
        variant: nonparametric ? "mann-whitney" : "welch",
        columns: ids,
        reasons: [...graphReason, `${labelName} holds two categories (${levels.join(" vs ")}), one per row.`, "Each category's replicate values become that group's observations."],
        caveats: ["Check that the rows really are independent measurements, not repeated ones."],
        assumptions: ["The two categories are independent groups."],
        alternatives: ["Mann-Whitney for ordinal, small, or strongly skewed data."],
      });
    } else if (levels.length >= 3 && enough >= 3 && !already("anova")) {
      addSuggestion(out, 86, {
        id: `analysis:${table.id}:rowgroup:anova`,
        text: `${activePlot ? "This graph" : `"${name}"`} compares ${levels.length} groups held in the ${labelName} column.`,
        cta: "Configure one-way ANOVA",
        actionId: "analyze",
        method: "anova",
        variant: nonparametric ? "kruskal" : "anova",
        columns: ids,
        reasons: [...graphReason, `${labelName} holds ${levels.length} categories, one per row.`, "Each category's replicate values become that group's observations."],
        caveats: ["A post-hoc test is needed to say which groups differ.", "Pick Dunnett to compare every treatment against one control."],
        assumptions: ["The categories are independent groups."],
        alternatives: ["Kruskal-Wallis when the values are skewed or the groups are small."],
      });
    }
  }

  if (intent === "paired-comparison" && profile.usableDatasets.length >= 2 && !already("ttest")) {
    const pairedOk = profile.maxPairedComplete >= 3;
    const pairedGraph = activePlot?.kind === "paireddot" ? "paired-dot" : "before-after";
    addSuggestion(out, pairedOk ? 93 : 52, {
      id: `analysis:${table.id}:ttest:${pairedOk ? "paired" : "possible-paired"}`,
      text: pairedOk ? `This ${pairedGraph} graph supports a paired comparison.` : "This may be paired, but the rows do not prove enough complete pairs.",
      cta: pairedOk ? "Configure paired test" : "Review two-group options",
      actionId: "analyze",
      method: "ttest",
      variant: pairedOk ? "paired" : "welch",
      columns: twoGroups,
      reasons: [`The active graph is a ${pairedGraph} plot.`, pairedOk ? "There are enough row-aligned complete pairs." : "MadY cannot confirm enough complete row-aligned pairs."],
      caveats: ["Only use paired tests if each row connects measurements from the same subject, sample, or unit."],
      assumptions: [pairedOk ? "Rows are complete, row-aligned matched pairs." : "If rows are not matched units, use an independent-group test."],
      question: {
        prompt: "Are these two groups independent, or are rows matched before/after measurements?",
        choices: [
          { id: "independent", label: "Independent groups", description: "Use Welch's independent-group comparison.", method: "ttest", variant: "welch" },
          { id: "paired", label: "Paired or matched rows", description: "Use a paired comparison only when each row belongs to the same unit in both conditions.", method: "ttest", variant: "paired" },
        ],
      },
      alternatives: ["Wilcoxon signed-rank for ordinal or strongly non-normal paired differences.", "Welch t test if the groups are independent."],
    });
    if (nonparametric && pairedOk) {
      addSuggestion(out, 93 + 4, {
        id: `analysis:${table.id}:ttest:wilcoxon`,
        text: "This paired data is better compared with a rank-based test.",
        cta: "Configure Wilcoxon",
        actionId: "analyze",
        method: "ttest",
        variant: "wilcoxon",
        columns: twoGroups,
        reasons: [`A rank-based paired test is more robust here because ${npWhy}.`, "Wilcoxon signed-rank compares the paired differences without assuming they are normal."],
        caveats: ["Only use a paired test if each row is the same subject/unit in both conditions.", "Rank-based tests have limited power at very small n."],
        assumptions: ["Rows are complete, row-aligned matched pairs."],
        alternatives: ["Paired t test when the differences are approximately normal."],
      });
    }
  }

  if ((profile.kind === "column" || intent === "group-comparison") && profile.usableDatasets.length >= 3 && !already("anova")) {
    const unequal = profile.varianceRatio != null && profile.varianceRatio >= 4;
    addSuggestion(out, intent === "group-comparison" ? 90 : 82, {
      id: `analysis:${table.id}:anova:${unequal ? "welch" : "anova"}`,
      text: `${activePlot ? "This graph" : `"${name}"`} looks like a multi-group comparison.`,
      cta: unequal ? "Configure Welch ANOVA" : "Configure ANOVA",
      actionId: "analyze",
      method: "anova",
      variant: unequal ? "welch" : "anova",
      columns: groupIds,
      reasons: [...graphReason, `${profile.usableDatasets.length} usable numeric groups were detected.`],
      caveats: unequal
        ? ["Variance imbalance is visible in the data profile, so Welch ANOVA is suggested.", "Use Kruskal-Wallis for a rank-based/nonparametric question."]
        : ["Check residual shape and variance before treating ANOVA as final.", "Use Welch ANOVA if group SDs are very different."],
      assumptions: ["Groups are independent unless the table explicitly encodes repeated measures."],
      alternatives: ["Welch ANOVA for unequal variance.", "Kruskal-Wallis for ordinal or strongly non-normal data.", "Repeated-measures ANOVA/Friedman only for matched rows."],
    });
    if (nonparametric) {
      addSuggestion(out, (intent === "group-comparison" ? 90 : 82) + 4, {
        id: `analysis:${table.id}:anova:kruskal`,
        text: `${activePlot ? "This graph" : `"${name}"`} is better compared with a rank-based test.`,
        cta: "Configure Kruskal-Wallis",
        actionId: "analyze",
        method: "anova",
        variant: "kruskal",
        columns: groupIds,
        reasons: [...graphReason, `A rank-based (nonparametric) test is more robust here because ${npWhy}.`, "Kruskal-Wallis compares several groups without assuming normal, equal-variance data."],
        caveats: ["A significant Kruskal-Wallis needs a rank-based post-hoc (e.g. Dunn) to locate the differences."],
        assumptions: ["Groups are independent unless the table encodes repeated measures."],
        alternatives: ["Welch ANOVA for unequal variance with roughly normal groups.", "One-way ANOVA when normality and equal variance are defensible."],
      });
    }
  }

  if ((profile.kind === "grouped" || profile.kind === "nested") && profile.usableDatasets.length >= 2) {
    if (profile.kind === "grouped" && profile.repeatedMeasuresEligible && groupIds.length >= 3 && !already("rmanova")) {
      addSuggestion(out, 88, {
        id: `analysis:${table.id}:rmanova`,
        text: "This grouped table has enough row-aligned conditions for a repeated-measures workflow.",
        cta: "Configure repeated-measures analysis",
        actionId: "analyze",
        method: "rmanova",
        variant: "rmanova",
        columns: groupIds,
        reasons: ["Multiple conditions share complete row-aligned observations.", "Repeated-measures analysis accounts for within-row dependence."],
        caveats: ["Rows must represent the same subject, sample, or experimental unit across conditions."],
        assumptions: ["The repeated-measures structure is real, not just adjacent columns."],
        alternatives: ["Friedman for a rank-based repeated-measures question.", "Mixed-effects modeling when the design has additional nesting or imbalance."],
      });
    }
    // No mixed-effects suggestion for a grouped sheet: the app's mixed model
    // reads a long-format sheet, so a wide grouped table's numeric values would become the
    // random-intercept levels — a meaningless structure.
    if (profile.kind === "nested" && groupIds.length >= 2 && !already("nested")) {
      addSuggestion(out, 82, {
        id: `analysis:${table.id}:nested`,
        text: "The table appears to contain subgroups nested within larger groups.",
        cta: "Configure nested analysis",
        actionId: "analyze",
        method: "nested",
        columns: groupIds,
        reasons: ["Nested table structure and multiple usable groups were detected."],
        caveats: ["Use nested analysis only when subgroup measurements are not independent of their parent group."],
        assumptions: ["Replicate subcolumns identify genuine nested units."],
        alternatives: ["Mixed-effects modeling when the nesting is unbalanced or has multiple random factors."],
      });
    }
  }
  if (profile.kind === "xy" && profile.xId && profile.usableDatasets.length >= 1) {
    const y = profile.usableDatasets[0]!;
    if (intent === "classification" && y.binary && !already("roc")) {
      addSuggestion(out, 92, {
        id: `analysis:${table.id}:roc`,
        text: "This graph looks like a binary classification workflow.",
        cta: "Configure ROC analysis",
        actionId: "analyze",
        method: "roc",
        columns: [profile.xId, y.id],
        reasons: [...graphReason, "A numeric predictor and a binary outcome were detected."],
        caveats: ["ROC/AUC evaluates discrimination, not calibration or causality."],
        assumptions: ["The Y column is a true 0/1 outcome and the X column is a diagnostic score or marker."],
        alternatives: ["Logistic regression when covariate adjustment or odds ratios are needed."],
      });
    }    if ((intent === "agreement" || activePlot?.kind === "blandaltman") && !already("blandaltman")) {
      addSuggestion(out, 94, {
        id: `analysis:${table.id}:blandaltman`,
        text: "This graph is about method agreement, not ordinary correlation.",
        cta: "Configure agreement analysis",
        actionId: "analyze",
        method: "blandaltman",
        columns: [profile.xId, y.id],
        reasons: ["Bland-Altman plots assess agreement between two measurement methods."],
        caveats: ["Correlation can be high even when two methods disagree systematically."],
        assumptions: ["Both columns measure the same quantity on comparable units."],
        alternatives: ["Deming regression when both methods have measurement error.", "Passing-Bablok for robust method comparison."],
        notRecommendedBecause: ["Pearson/Spearman correlation is not sufficient evidence of agreement."],
      });
    } else if ((intent === "relationship" || !intent) && !already("correlation")) {
      addSuggestion(out, intent === "relationship" ? 86 : 70, {
        id: `analysis:${table.id}:correlation`,
        text: `${activePlot ? "This scatter/XY graph" : `"${name}"`} can be checked for association.`,
        cta: "Configure correlation",
        actionId: "analyze",
        method: "correlation",
        variant: "pearson",
        columns: [profile.xId, y.id],
        reasons: [...graphReason, "A numeric X column and numeric Y dataset were detected."],
        caveats: ["Use Spearman for monotonic but non-linear or ordinal relationships.", "Correlation is not a method-agreement or causality test."],
        assumptions: ["Use correlation when both variables are measured; use regression when X is controlled or predictive."],
        alternatives: ["Linear regression for prediction/calibration.", "Spearman correlation for monotonic non-linear relationships."],
      });
    }
    if ((profile.xPositive && profile.xMonotonic && profile.xLogSpaced) || intent === "dose-response") {
      if (!already("curvefit")) {
        addSuggestion(out, 88, {
          id: `analysis:${table.id}:curvefit:4pl`,
          text: "The X values look dose-like, so a dose-response fit may be useful.",
          cta: "Configure dose-response",
          actionId: "analyze",
          method: "curvefit",
          variant: "4pl",
          columns: [profile.xId, y.id],
          focusKind: "dose-response",
          reasons: ["X values are positive, ordered, and roughly log-spaced.", "Dose-response fits estimate EC50/IC50-style parameters."],
          caveats: ["Do not choose the final biological model by R-squared alone.", "Constrain plateaus only when those values are known or scientifically justified."],
          assumptions: ["X is dose/concentration and Y is a response."],
          alternatives: ["Linear regression if the relationship is approximately linear.", "Correlation if both variables are measured rather than one predicting the other."],
        });
      }
    }
  }

  // Counts only: χ² on proportions is χ² on a total of 1 — the engine
  // itself says "Counts, not proportions". A contingency test needs an r×c table with
  // r ≥ 2 and c ≥ 2; a single row or column of counts is goodness-of-fit.
  if ((profile.kind === "contingency" || profile.kind === "partsofwhole" || intent === "counts") && profile.countLike) {
    const rxc = profile.countShape !== undefined && profile.countShape.rows >= 2 && profile.countShape.cols >= 2;
    const gof = profile.kind === "partsofwhole" || !rxc;
    if (!already(gof ? "goodnessoffit" : "contingency")) {
      addSuggestion(out, 90, {
        id: `analysis:${table.id}:contingency`,
        text: gof ? `"${name}" looks like counts of one set of categories.` : `"${name}" looks like count data for a contingency analysis.`,
        cta: "Configure count test",
        actionId: "analyze",
        method: gof ? "goodnessoffit" : "contingency",
        variant: gof ? "chisq" : "independent",
        columns: groupIds.length ? groupIds : firstIds(profile.summaries.filter((s) => s.n > 0), 6),
        reasons: ["Values are non-negative integer counts.", gof ? "One row (or one column) of counts compares observed against expected proportions." : "The table format is intended for count tests."],
        caveats: gof
          ? ["Confirm the expected proportions before using a goodness-of-fit test."]
          : ["Small expected counts should use Fisher's exact path where applicable."],
      });
    }
  }

  // A meta-analysis sheet gets exactly one nudge — pooling — and never the group
  // comparisons: its Lower/Upper are each study's own confidence limits, not groups, so
  // an ANOVA suggestion there would be wrong.
  if (table.kind === "meta" && !already("metaanalysis")) {
    const metaCols = tableDatasets(table).slice(0, 3).map((d) => d.id);
    const usableStudies = metaCols.length === 3
      ? table.rows.filter((r) => metaCols.every((id) => numericCell(r.cells[id]) !== null)).length
      : 0;
    if (usableStudies >= 2) {
      addSuggestion(out, 92, {
        id: `analysis:${table.id}:metaanalysis`,
        text: `"${name}" looks ready to pool — ${usableStudies} studies with confidence limits.`,
        cta: "Configure meta-analysis",
        actionId: "analyze",
        method: "metaanalysis",
        columns: metaCols,
        reasons: ["One estimate per study with its Lower/Upper confidence limits was detected."],
        caveats: ["Pick the log-scale option for ratio measures (OR / RR / HR).", "Report the random-effects result when heterogeneity (I²) is material."],
      });
    }
  }
  // Once the pooling exists, the follow-up question is whether the funnel leans —
  // offer the publication-bias tests (Egger + trim-and-fill) exactly once.
  if (table.kind === "meta" && already("metaanalysis") && !already("publicationbias")) {
    const metaCols = tableDatasets(table).slice(0, 3).map((d) => d.id);
    const usableStudies = metaCols.length === 3
      ? table.rows.filter((r) => metaCols.every((id) => numericCell(r.cells[id]) !== null)).length
      : 0;
    if (usableStudies >= 3) {
      addSuggestion(out, 78, {
        id: `analysis:${table.id}:publicationbias`,
        text: `"${name}" is pooled — check whether publication bias could explain the result.`,
        cta: "Configure publication-bias tests",
        actionId: "analyze",
        method: "publicationbias",
        columns: metaCols,
        reasons: ["Egger's test asks whether the funnel leans; trim-and-fill re-pools with the missing studies imputed."],
        caveats: ["Both tests are weak below ~10 studies.", "Match the linear/log choice to the pooling."],
      });
    }
  }

  if ((profile.kind === "survival" || intent === "survival" || profile.survivalLike) && !already("survival")) {
    const cols = profile.xId ? [profile.xId, ...firstIds(profile.datasetSummaries.filter((s) => s.id !== profile.xId), 5)] : groupIds;
    addSuggestion(out, intent === "survival" || profile.kind === "survival" ? 92 : 68, {
      id: `analysis:${table.id}:survival`,
      text: `"${name}" looks like time-to-event data.`,
      cta: "Configure survival analysis",
      actionId: "analyze",
      method: "survival",
      columns: cols,
      reasons: ["A time column plus event/censor-style columns were detected."],
      caveats: ["Use Cox regression only when covariates are explicit and scientifically chosen."],
    });
  }

  // Cox needs a long-format sheet: time + one event column + ≥1 covariate that is not
  // itself an event column. The standard survival sheet (one 0/1 column per group) must not
  // qualify with the other group's event column as its "covariate" → 1 complete row →
  // engine error.
  const eventColumns = profile.binaryColumns.filter((s) => s.id !== profile.xId);
  const survivalEventId = eventColumns.length === 1 ? eventColumns[0]!.id : undefined;
  const survivalPredictors = groupIds.filter((id) => id !== profile.xId && id !== survivalEventId && !eventColumns.some((s) => s.id === id));
  if ((profile.kind === "survival" || intent === "survival") && profile.xId && survivalEventId && survivalPredictors.length > 0 && !already("cox")) {
    addSuggestion(out, intent === "survival" ? 84 : 64, {
      id: `analysis:${table.id}:cox`,
      text: "The survival data may support a covariate-adjusted Cox model.",
      cta: "Configure Cox regression",
      actionId: "analyze",
      method: "cox",
      variant: "cox",
      columns: [profile.xId, survivalEventId, ...survivalPredictors.slice(0, 4)],
      reasons: ["A time column, binary event/censoring indicator, and additional predictor were detected."],
      caveats: ["Cox regression requires explicit covariates and a defensible proportional-hazards assumption."],
      assumptions: ["The binary column records event versus censoring, and the remaining columns are pre-specified covariates."],
      alternatives: ["Kaplan-Meier/log-rank for an unadjusted survival comparison."],
    });
  }
  if ((profile.kind === "multivariable" || profile.kind === "pca" || intent === "multivariable" || intent === "pca" || intent === "cluster") && profile.usableDatasets.length >= 2) {
    const binaryOutcome = profile.likelyBinaryOutcome;
    const continuousOutcome = profile.likelyContinuousOutcome;
    const countOutcome = profile.likelyCountOutcome;
    const predictorsFor = (outcome: NodeId | undefined): NodeId[] => groupIds.filter((id) => id !== outcome).slice(0, 5);
    if (binaryOutcome && predictorsFor(binaryOutcome).length >= 1 && !already("logistic")) {
      addSuggestion(out, 78, {
        id: `analysis:${table.id}:logistic`,
        text: "A binary outcome and numeric predictors may support logistic regression.",
        cta: "Configure logistic regression",
        actionId: "analyze",
        method: "logistic",
        variant: "default",
        columns: [binaryOutcome, ...predictorsFor(binaryOutcome)],
        reasons: ["A 0/1 outcome and additional usable variables were detected."],
        caveats: ["The outcome should be explicitly chosen, and separation or sparse classes can make estimates unstable."],
        assumptions: ["The first selected column is the binary outcome; the remaining columns are predictors."],
        alternatives: ["Contingency analysis for a single categorical predictor.", "Descriptive class summaries before fitting a model."],
      });
    }
    if (continuousOutcome && predictorsFor(continuousOutcome).length >= 1 && !already("multipleregression")) {
      addSuggestion(out, 76, {
        id: `analysis:${table.id}:multipleregression`,
        text: "A continuous outcome and several numeric variables may support multiple regression.",
        cta: "Configure multiple regression",
        actionId: "analyze",
        method: "multipleregression",
        variant: "default",
        columns: [continuousOutcome, ...predictorsFor(continuousOutcome)],
        reasons: ["A likely continuous outcome and additional numeric variables were detected."],
        caveats: ["Outcome role, linearity, collinearity, and sample size should be confirmed before interpreting coefficients."],
        assumptions: ["The first selected column is the outcome; the remaining columns are predictors."],
        alternatives: ["Correlation matrix or PCA for exploratory analysis without a pre-specified outcome."],
      });
    }
    if (countOutcome && predictorsFor(countOutcome).length >= 1 && !already("poisson")) {
      addSuggestion(out, 70, {
        id: `analysis:${table.id}:poisson`,
        text: "A non-negative integer outcome may support a count regression workflow.",
        cta: "Configure Poisson regression",
        actionId: "analyze",
        method: "poisson",
        variant: "default",
        columns: [countOutcome, ...predictorsFor(countOutcome)],
        reasons: ["A non-negative integer outcome was detected."],
        caveats: ["Check exposure, zero inflation, and overdispersion; Poisson is not automatically appropriate for every count column."],
        assumptions: ["The first selected column is a count outcome and the remaining columns are predictors."],
        alternatives: ["Descriptive count summaries or a negative-binomial workflow when overdispersion is substantial."],
      });
    }    if (!already("corrmatrix")) {
      addSuggestion(out, intent === "multivariable" ? 86 : 74, {
        id: `analysis:${table.id}:corrmatrix`,
        text: `"${name}" has multiple numeric variables worth exploring together.`,
        cta: "Configure correlation matrix",
        actionId: "analyze",
        method: "corrmatrix",
        variant: "pearson",
        columns: groupIds,
        reasons: ["Multiple numeric variables were detected."],
        caveats: ["Pairwise correlations are exploratory and need multiplicity-aware interpretation."],
      });
    }
    if ((intent === "pca" || profile.usableDatasets.length >= 3) && !already("pca")) {
      addSuggestion(out, intent === "pca" ? 90 : 76, {
        id: `analysis:${table.id}:pca`,
        text: `"${name}" can be summarized with PCA.`,
        cta: "Configure PCA",
        actionId: "analyze",
        method: "pca",
        variant: "standardize",
        columns: groupIds,
        reasons: ["There are at least three numeric variables/cases to summarize."],
        caveats: ["Standardize variables when their units or scales differ."],
      });
    }
    // Counts with many zeros → say so, and name the methods that fit. A PCA is offered
    // above on any three numeric columns; on a species matrix it is the wrong tool, and the
    // user has no way to know that from the dialog. Ranked higher than the PCA suggestion so
    // it reads first on exactly the data it is about.
    if (groupIds.length >= 3 && !already("ca") && !already("nmds")) {
      const counts = countsWithManyZeros(table, groupIds);
      if (counts.looksLikeCounts) {
        const pct = Math.round(counts.zeroFraction * 100);
        addSuggestion(out, 92, {
          id: `analysis:${table.id}:ca`,
          text: `"${name}" looks like counts — ${pct}% of the values are zero. Correspondence analysis suits that better than PCA.`,
          cta: "Configure correspondence analysis",
          actionId: "analyze",
          method: "ca",
          columns: groupIds,
          reasons: [
            "Every value is a non-negative whole number and most cells are empty — the shape of a species or category count table.",
            "Correspondence analysis works on chi-square distances and draws the cases and the variables together; PCA is fixed to Euclidean distance on the raw counts, where two cases that share nothing can look as close as two that share half.",
          ],
          caveats: [
            "A strong single gradient produces the arch effect: the second axis is then a curve of the first.",
            "NMDS on a Bray-Curtis distance is the other standard answer for this data, and copes better when the gradient is long.",
          ],
        });
      }
    }
    if (intent === "cluster" && !already("cluster")) {
      addSuggestion(out, 88, {
        id: `analysis:${table.id}:cluster`,
        text: "This clustering view can be backed by a cluster analysis.",
        cta: "Configure clustering",
        actionId: "analyze",
        method: "cluster",
        variant: "hierarchical",
        columns: groupIds,
        reasons: ["The active graph is a dendrogram/cluster-oriented view."],
        caveats: ["Cluster count and distance metric should match the scientific question."],
      });
    }
  }

  if (intent === "distribution" && profile.usableDatasets.length >= 1 && !already("normality")) {
    addSuggestion(out, 66, {
      id: `analysis:${table.id}:normality`,
      text: "This distribution view can be paired with a normality check.",
      cta: "Configure normality tests",
      actionId: "analyze",
      method: "normality",
      columns: [profile.usableDatasets[0]!.id],
      reasons: ["The active graph shows a distribution."],
      caveats: ["Normality tests have low power at small n and overreact at very large n; read them with the graph."],
    });
  }

  // A specialised graph (volcano / forest / network …) is not "no clear design" — the
  // descriptives fallback would be inventing a test; the generic "Analyze…" nudge remains.
  if (!out.length && intent !== "specialised" && profile.numericColumns.length > 0) {
    addSuggestion(out, 38, {
      id: `analysis:${table.id}:not-sure`,
      text: "Not sure yet: start with descriptives and graph checks before choosing a test.",
      cta: "Review descriptives",
      actionId: "analyze",
      method: "describe",
      columns: [profile.numericColumns[0]!.id],
      reasons: ["The table has numeric data but no clear analysis design."],
      caveats: ["A valid test depends on study design, grouping, pairing, and the intended outcome."],
      assumptions: ["Use this as a safe starting point, not a final model choice."],
      alternatives: ["Create a graph that matches the scientific question first."],
    });
  }
  return out;
}

function rowDatasetValue(table: DataTable, datasetId: NodeId, row: { cells?: Record<string, CellValue> }): number | null {
  const ds = tableDatasets(table).find((d) => d.id === datasetId);
  const ids = ds?.replicates?.length ? ds.replicates : [datasetId];
  const values = ids.map((id) => numericCell(row.cells?.[id])).filter((v): v is number => v !== null);
  return values.length ? values.reduce((a, v) => a + v, 0) / values.length : null;
}

function curveConfidence(score: number): SuggestionConfidence {
  return score >= 90 ? "high" : score >= 65 ? "medium" : "low";
}

export interface CurveModelOptions {
  activePlot?: Plot | undefined;
  xId?: NodeId | undefined;
  yId?: NodeId | undefined;
  goal?: CurveModelGoal | undefined;
  availableVariants?: ReadonlyArray<{ id: string; group?: string | undefined }> | undefined;
}

/** Ranked, pre-fit model guidance for the curve-fit type picker. */
export function suggestCurveModelsForTable(table: DataTable, options: CurveModelOptions = {}): CurveModelRecommendation[] {
  const profile = profileTable(table, options.xId);
  const available = options.availableVariants ?? [];
  const availableIds = new Set(available.map((v) => v.id));
  const has = (variant: string): boolean => available.length === 0 || availableIds.has(variant);
  const familyOf = (variant: string): string => available.find((v) => v.id === variant)?.group ?? "Other";
  const xId = profile.xId;
  const y = profile.usableDatasets.find((s) => s.id === options.yId) ?? profile.usableDatasets.find((s) => s.id !== xId);
  if (!xId || !y) return [];

  const rawPairs = (table.rows ?? [])
    .map((row) => ({ x: numericCell(row.cells?.[xId]), y: rowDatasetValue(table, y.id, row) }))
    .filter((p): p is { x: number; y: number } => p.x !== null && p.y !== null)
    .sort((a, b) => a.x - b.x);
  // Shape tests read one mean Y per distinct X: replicate rows at the same
  // dose would otherwise read as a direction change at every dose, and every clean
  // sigmoid would come out "biphasic".
  const byX = new Map<number, number[]>();
  for (const p of rawPairs) byX.set(p.x, [...(byX.get(p.x) ?? []), p.y]);
  const pairs = [...byX.entries()].map(([x, ys]) => ({ x, y: ys.reduce((a, v) => a + v, 0) / ys.length })).sort((a, b) => a.x - b.x);
  const distinctX = pairs.length;
  const yValues = pairs.map((p) => p.y);
  const yMax = yValues.length ? Math.max(...yValues) : 0;
  const yMin = yValues.length ? Math.min(...yValues) : 0;
  const yRange = yValues.length ? yMax - yMin : 0;
  // A response that does not move: nothing for a sigmoid to fit.
  const flatY = yRange <= 1e-9 * Math.max(1, Math.abs(yMax), Math.abs(yMin));
  // Direction reversals, each measured by how far Y travels back. A reversal counts
  // only when it is ≥ 15 % of the Y range — smaller ones are noise — or when there are
  // two or more of them.
  // Split Y into runs of one direction; a reversal is a run against the overall trend
  // (the direction Y travels more in), measured by how far it travels back.
  const runs: Array<{ sign: number; travel: number }> = [];
  let upTravel = 0;
  let downTravel = 0;
  for (let i = 1; i < yValues.length; i++) {
    const d = yValues[i]! - yValues[i - 1]!;
    if (d === 0) continue;
    if (d > 0) upTravel += d; else downTravel -= d;
    const last = runs[runs.length - 1];
    if (last && last.sign === Math.sign(d)) last.travel += Math.abs(d);
    else runs.push({ sign: Math.sign(d), travel: Math.abs(d) });
  }
  const trend = upTravel >= downTravel ? 1 : -1;
  const reversalSizes = runs.filter((r) => r.sign !== trend).map((r) => r.travel);
  const wobbly = reversalSizes.length >= 2 || reversalSizes.some((r) => r >= 0.15 * yRange);
  const changes = wobbly ? runs.length - 1 : 0;
  const yMonotonic = yValues.length >= 3 && !wobbly;
  const doseLike = profile.xPositive && profile.xMonotonic && profile.xLogSpaced && distinctX >= 4;
  const enoughForSimple = rawPairs.length >= 4 && distinctX >= 4;
  const enoughForComplex = rawPairs.length >= 6 && distinctX >= 6;
  const asymmetric = y.roughSkew && enoughForComplex;
  const nonMonotonic = changes > 0 && distinctX >= 5;
  // A 4PL has four parameters: it needs at least five distinct doses to be recommended
  // and six before the recommendation is called high-confidence.
  const enoughFor4pl = distinctX >= 5;
  // Dose-like X supports a dose-response workflow, but does not by itself tell us
  // whether the user means stimulation, inhibition, or normalized potency. Keep
  // those specialized models out of the default ranking until the goal is explicit.
  const goal = options.goal ?? "explore";
  const out: CurveModelRecommendation[] = [];
  const add = (
    variant: string,
    score: number,
    suitability: CurveModelRecommendation["suitability"],
    reasons: string[],
    assumptions: string[],
    warnings: string[],
    goals: CurveModelGoal[],
  ): void => {
    if (!has(variant)) return;
    out.push({ variant, family: familyOf(variant), suitability, confidence: curveConfidence(score), score, reasons, assumptions, warnings, goals });
  };

  if (doseLike && yMonotonic && enoughForSimple && enoughFor4pl && !flatY) {
    add("4pl", distinctX >= 6 ? 100 : 85, "recommended", ["X is positive, ordered, and roughly log-spaced.", distinctX >= 6 ? "The response has enough distinct doses for a standard monotonic fit." : "Five distinct doses is the minimum for a four-parameter fit — six or more would make it more certain."], ["X represents dose or concentration.", "The response is expected to be broadly monotonic."], ["A clear lower and upper plateau are not proven before fitting."], ["potency", "shape"]);
  } else if (enoughForSimple) {
    const why = flatY
      ? "The response has almost no observed range — there is no curve to fit."
      : doseLike && yMonotonic && !enoughFor4pl
        ? "Only four distinct doses: a four-parameter fit needs at least five."
        : "A continuous X/Y curve can be fit, but the data do not clearly establish a standard dose-response shape.";
    add("4pl", 58, "caution", [why], ["Confirm that X is dose or concentration before interpreting EC50/IC50."], ["Do not treat a 4PL as biologically justified solely because it can fit the points."], ["potency", "shape"]);
  }

  if (doseLike && yMonotonic && enoughForComplex) {
    add("5pl", asymmetric ? 91 : 73, asymmetric ? "alternative" : "caution", [asymmetric ? "The response distribution suggests possible asymmetry." : "There are enough dose levels to consider an extra asymmetry parameter."], ["The extra parameter is identifiable with the available dose levels."], ["5PL can overfit sparse curves; compare uncertainty and residuals, not R² alone."], ["potency", "shape"]);
    add("3pl", 60, "caution", ["A constrained three-parameter sigmoid is available for a simpler model."], ["One plateau is fixed or scientifically known."], ["Without a justified fixed plateau, 3PL can bias potency estimates."], ["potency", "shape"]);
  }

  if (nonMonotonic) {
    add("biphasic_dr", 82, "caution", ["The response changes direction across the ordered dose range."], ["The non-monotonic pattern is scientifically expected and has enough dose levels."], ["Biphasic models are sensitive to sparse points and starting values."], ["shape", "explore"]);
    add("bell_dr", 78, "caution", ["The response may have a bell-shaped rather than monotonic pattern."], ["A bell-shaped biological response is plausible."], ["Do not select a bell model from a single apparent turning point."], ["shape", "explore"]);
    add("hormesis_bc", 72, "caution", ["A hormesis-style non-monotonic response is a possible exploratory model."], ["The low-dose stimulation/high-dose inhibition interpretation is scientifically justified."], ["This is a specialized model and should be compared with simpler alternatives."], ["shape", "explore"]);
  }

  // ── Enzyme kinetics ────────────────────────────────────────────────────────
  // A rectangular hyperbola and a 4PL are both saturating curves — shape alone cannot
  // tell them apart, only the meaning of X can (substrate concentration vs dose). So
  // enzyme models are offered as alternatives and never outrank the dose-response
  // ranking; the reasons say plainly what has to be true for them to apply.
  const nP = pairs.length;
  const third = Math.max(1, Math.floor(nP / 3));
  const slope = (i: number, j: number): number => {
    const dx = pairs[j]!.x - pairs[i]!.x;
    return dx === 0 ? 0 : (pairs[j]!.y - pairs[i]!.y) / dx;
  };
  const rising = nP >= 2 && yValues[nP - 1]! > yValues[0]!;
  const earlySlope = nP >= 2 ? slope(0, third) : 0;
  const lateSlope = nP >= 2 ? slope(nP - 1 - third, nP - 1) : 0;
  // Saturating = the curve flattens: the closing slope is a small fraction of the opening one.
  const saturating = enoughForSimple && rising && yMonotonic && profile.xPositive && earlySlope > 0 && lateSlope < 0.4 * earlySlope;
  // A single interior maximum (rises then falls) — the substrate-inhibition signature.
  const peakIdx = yValues.indexOf(Math.max(...yValues));
  const peaked = enoughForSimple && profile.xPositive && changes === 1 && peakIdx > 0 && peakIdx < nP - 1;

  if (saturating) {
    add("mm", 70, "alternative", ["The response rises and then flattens — a saturating (rectangular hyperbola) shape."], ["X is substrate concentration and Y is an initial velocity.", "A single catalytic site with no cooperativity."], ["A 4PL fits a saturating curve just as well — choose Michaelis-Menten because X is substrate, not because it fits."], ["shape", "explore"]);
    add("kcat", 64, "alternative", ["The saturating shape also supports the kcat parameterization of Michaelis-Menten."], ["The active-enzyme concentration Et is known and can be constrained."], ["Leave Et free and it is confounded with kcat — only the product Et·kcat is identifiable."], ["shape", "explore"]);
    // Sigmoidal-in-linear-X: a slow start (the opening slope is well below the middle
    // slope) is the cooperativity signature that plain Michaelis-Menten cannot show.
    if (nP >= 6 && earlySlope < 0.6 * slope(third, Math.min(nP - 1, 2 * third))) {
      add("allosteric", 66, "alternative", ["The curve starts shallow before rising — consistent with positive cooperativity."], ["Sigmoidal velocity-vs-substrate behaviour is scientifically expected."], ["A shallow start can also come from too few low-substrate points."], ["shape", "explore"]);
    }
    // Product-vs-time has the same saturating shape as velocity-vs-substrate; only the
    // meaning of the axes separates them, so this stays expert-level and never ranks high.
    add("enzyme_progress", 30, "expert", ["A saturating trace is also the shape of a product-versus-time progress curve."], ["Y is accumulated product and X is time, with substrate depleting over the run."], ["Do not use this for initial-velocity-versus-substrate data — that is Michaelis-Menten."], ["explore"]);
  }
  if (peaked) {
    add("substrate_inhibition", 74, "alternative", ["The response peaks and then declines — the substrate-inhibition signature."], ["High substrate concentrations are inhibitory for this enzyme.", "The data span both the peak and the decline."], ["A single high outlier can imitate a peak; confirm the decline is real before fitting."], ["shape", "explore"]);
  }

  if (goal === "potency") {
    add("ic50_4pl_log", 68, "alternative", ["The selected goal is potency estimation and a log-inhibitor model is available."], ["X is inhibitor concentration and Y represents inhibition."], ["Do not use an IC50-specific model unless the biological meaning of X/Y is confirmed."], ["potency"]);
    add("dr_norm_4pl", 62, "caution", ["A normalized four-parameter response model is available for potency workflows."], ["The response has been normalized using a defensible baseline and maximum."], ["Normalization choices affect the estimated potency."], ["potency"]);
  }

  if (enoughForSimple && (!doseLike || goal === "explore" || goal === "shape")) {
    add("linear", 55, "alternative", ["A simple trend provides a useful shape check."], ["The relationship is approximately linear over the observed range."], ["Linear trend is not an EC50/IC50 model."], ["shape", "explore"]);
    add("lowess", 52, "alternative", ["A flexible smoother can reveal the observed shape without imposing a biological equation."], ["Use it for exploration or diagnostics."], ["LOWESS does not provide a mechanistic potency parameter."], ["shape", "explore"]);
    add("spline", 50, "alternative", ["A smoothing spline can diagnose departures from a simple parametric curve."], ["The smoothing level is treated as exploratory."], ["Spline behavior at boundaries can be unstable."], ["shape", "explore"]);
  }

  add("custom", 5, "expert", ["A user-defined equation is available for an explicitly specified model."], ["You can state and defend the equation and starting values."], ["Custom fits are not automatically validated as biologically appropriate."], ["explore"]);
  return out.sort((a, b) => b.score - a.score || a.variant.localeCompare(b.variant));
}

/**
 * Ranked, data-aware guidance for the in-analysis type (variant) picker of any method — the
 * generalization of suggestCurveModelsForTable beyond curve fitting. Returns the same shape so the
 * picker renders one row per recommendation with a suitability badge. Curve-family methods delegate
 * to the curve recommender; the rest use method-specific rules over the table profile (reusing the
 * distribution signals). `goals` is empty for non-curve variants (goal chips stay curve-fit only).
 */
export function suggestVariantsForTable(method: string, table: DataTable, options: CurveModelOptions = {}): CurveModelRecommendation[] {
  if (method === "curvefit" || method === "globalfit" || method === "comparefits" || method === "interpolate") {
    return suggestCurveModelsForTable(table, options);
  }
  const profile = profileTable(table, options.xId);
  const available = options.availableVariants ?? [];
  const availableIds = new Set(available.map((v) => v.id));
  const has = (variant: string): boolean => available.length === 0 || availableIds.has(variant);
  const familyOf = (variant: string): string => available.find((v) => v.id === variant)?.group ?? "";
  const out: CurveModelRecommendation[] = [];
  const add = (
    variant: string,
    score: number,
    suitability: CurveModelRecommendation["suitability"],
    reasons: string[],
    assumptions: string[],
    warnings: string[],
  ): void => {
    if (!has(variant)) return;
    out.push({ variant, family: familyOf(variant), suitability, confidence: curveConfidence(score), score, reasons, assumptions, warnings, goals: [] });
  };

  const nonparam = profile.anySkew || profile.anyOutliers || profile.anySmallN;
  const npWhy = profile.anyOutliers
    ? "outliers were detected in at least one group"
    : profile.anySkew
      ? "at least one group's values look skewed"
      : "the groups are small, so a normal distribution cannot be assumed";
  const unequalVar = profile.varianceRatio != null && profile.varianceRatio >= 4;
  const looksOrdinal = profile.summaries.some((s) => s.looksOrdinal);

  switch (method) {
    case "ttest":
      add("welch", 80, "recommended", ["Welch's t test is the safe default for two independent groups — it does not assume equal SDs."], ["The two groups are independent.", "Values are roughly normal (t tests are fairly robust at moderate n)."], ["Use a paired test only if rows are matched pairs."]);
      if (nonparam) add("mann-whitney", 90, "recommended", [`A rank-based test is more robust here because ${npWhy}.`, "Mann-Whitney compares the groups without assuming normal, equal-variance data."], ["The two groups are independent."], ["Limited power at very small n."]);
      else add("mann-whitney", 55, "alternative", ["A rank-based test for ordinal data or non-normal distributions."], ["The two groups are independent."], ["Less powerful than a t test when the data really are normal."]);
      add("unpaired", 50, "alternative", ["Student's t test — assumes the two groups have equal SDs."], ["Equal population variances."], ["Welch is safer when SDs differ; prefer it unless equal variance is known."]);
      add("paired", 48, "alternative", ["A paired test compares matched measurements (before/after on the same unit)."], ["Each row is the same subject/unit in both conditions."], ["Only valid for genuinely matched rows."]);
      add("wilcoxon", 44, "alternative", ["Rank-based paired test for non-normal paired differences."], ["Rows are matched pairs."], ["Only for paired data."]);
      add("ks", 30, "expert", ["Kolmogorov-Smirnov compares the whole shape of two distributions, not just the means."], ["Two independent samples."], ["Sensitive to any distributional difference, not only location."]);
      add("one-sample", 22, "expert", ["Compare one group's mean to a known reference value."], ["A meaningful reference value exists."], ["Not for comparing two groups."]);
      add("wilcoxon-1samp", 20, "expert", ["Rank-based one-sample test against a reference value."], ["A reference value exists."], ["Not for two-group comparisons."]);
      add("ratio-paired", 18, "expert", ["Paired test for data whose differences are multiplicative (log-normal)."], ["Paired, positive, log-normal data."], ["Only when a ratio (fold-change) is the meaningful comparison."]);
      break;
    case "anova":
      add("anova", 80, "recommended", ["One-way ANOVA + Tukey is the standard comparison of three or more group means."], ["Groups are independent; residuals roughly normal with similar SDs."], ["Check residuals and variance before treating it as final."]);
      if (unequalVar) {
        add("welch", 90, "recommended", ["Group SDs differ markedly, so Welch's ANOVA (which does not pool variance) is safer."], ["Groups are independent; residuals roughly normal."], ["Pair with a Games-Howell post-hoc, not Tukey."]);
        add("brown-forsythe", 70, "alternative", ["Another unequal-variance ANOVA; generally try Welch first."], ["Groups are independent."], ["Welch is usually preferred."]);
      } else {
        add("welch", 52, "alternative", ["Welch's ANOVA for unequal group SDs."], ["Groups are independent."], ["Prefer standard ANOVA when variances are similar."]);
        add("brown-forsythe", 40, "alternative", ["Unequal-variance ANOVA alternative."], ["Groups are independent."], ["Prefer Welch."]);
      }
      if (nonparam) add("kruskal", 88, "recommended", [`A rank-based test is more robust here because ${npWhy}.`, "Kruskal-Wallis compares several groups without assuming normal data."], ["Groups are independent."], ["A significant result needs a rank-based post-hoc (e.g. Dunn)."]);
      else add("kruskal", 50, "alternative", ["Rank-based multi-group test for ordinal or non-normal data."], ["Groups are independent."], ["Less powerful than ANOVA when the data are normal."]);
      break;
    case "rmanova":
      add("rmanova", 80, "recommended", ["Repeated-measures ANOVA compares matched conditions measured on the same subjects."], ["Rows are the same subject across every condition."], ["Sphericity is corrected (Greenhouse-Geisser)."]);
      if (nonparam) add("friedman", 84, "recommended", [`A rank-based repeated-measures test is more robust here because ${npWhy}.`], ["Rows are matched across conditions."], ["Follow a significant result with Dunn's post-hoc."]);
      else add("friedman", 50, "alternative", ["Rank-based repeated-measures test for ordinal/non-normal data."], ["Rows are matched across conditions."], ["Less powerful than RM-ANOVA when the data are normal."]);
      break;
    case "correlation":
    case "corrmatrix":
      add("pearson", 78, "recommended", ["Pearson measures the strength of a linear association."], ["The relationship is roughly linear; both variables are continuous."], ["Sensitive to outliers and to non-linear relationships."]);
      if (nonparam || looksOrdinal) add("spearman", 86, "recommended", ["Spearman (rank) correlation is more robust here — it captures monotonic (not just linear) association and resists outliers.", looksOrdinal ? "Ordinal-looking values were detected." : `The data are affected because ${npWhy}.`], ["The relationship is monotonic."], ["Reports rank association, not a linear slope."]);
      else add("spearman", 55, "alternative", ["Rank correlation for monotonic but non-linear, ordinal, or outlier-prone data."], ["The relationship is monotonic."], ["Reports rank association, not a linear slope."]);
      break;
    case "pca": {
      const sds = profile.numericColumns.map((s) => s.sd).filter((v): v is number => v != null && v > 0);
      const scaleRatio = sds.length >= 2 ? Math.max(...sds) / Math.min(...sds) : 1;
      const differ = scaleRatio >= 3;
      add("standardize", differ ? 90 : 82, "recommended", differ ? ["The columns are on very different scales, so standardizing (correlation matrix) stops the largest-scale variable dominating the components."] : ["Standardizing (correlation matrix) is the usual default so every variable contributes comparably."], ["Variables are on an intentional scale."], ["Standardizing discards information about absolute variance differences."]);
      add("center", differ ? 45 : 84, differ ? "alternative" : "recommended", differ ? ["Covariance-matrix PCA lets high-variance variables dominate — only use it when the scales are comparable."] : ["The columns are on comparable scales, so a covariance-matrix PCA (centred only) keeps their real variance differences."], ["Variables share comparable units/scale."], ["A single high-variance column can dominate the components."]);
      break;
    }
    case "regression":
      add("ols", 82, "recommended", ["Ordinary least-squares fits the best straight line (slope + intercept)."], ["The relationship is roughly linear; residuals have constant spread."], ["Check residuals for curvature or influential outliers."]);
      add("origin", 30, "expert", ["Force the line through (0, 0) — only when Y must be 0 at X = 0 by design."], ["A zero intercept is justified by the science."], ["Forcing the origin biases the slope if the true intercept is not zero."]);
      add("point", 25, "expert", ["Force the line through a fixed point (x₀, y₀)."], ["The fixed point is known and justified."], ["Constrains the fit; use only with a real anchor."]);
      break;
    case "contingency":
      add("independent", 82, "recommended", ["The independence test (chi-square / Fisher / risk / odds ratio) is the standard analysis of an r×c count table."], ["Rows and columns are independent categories; observations are independent."], ["Small expected counts fall back to Fisher's exact automatically."]);
      add("paired", 30, "expert", ["McNemar's test — only for a paired 2×2 (the same subjects measured twice)."], ["The two columns are matched measurements on the same subjects."], ["Not for independent groups."]);
      break;
    case "mixedmodel":
      add("reml", 82, "recommended", ["REML gives unbiased variance-component estimates — the default for a mixed-effects model."], ["The random-effect grouping is scientifically meaningful."], ["Do not compare models with different fixed effects by REML likelihood."]);
      add("ml", 50, "alternative", ["Maximum likelihood — use only to compare models with different fixed effects by likelihood."], ["You are comparing nested fixed-effect models."], ["ML variance estimates are biased downward; report REML for the final model."]);
      break;
    case "auc":
      add("zero", 78, "recommended", ["Baseline at Y = 0 — the usual reference for area under the curve."], ["Zero is the meaningful baseline for the response."], ["A non-zero baseline changes the computed area."]);
      add("min", 55, "alternative", ["Baseline at the minimum Y — subtracts a constant floor."], ["The minimum is a meaningful baseline."], ["Sensitive to a single low point."]);
      add("mean", 50, "alternative", ["Baseline at the mean Y."], ["The mean is a meaningful reference."], ["Uncommon; interpret with care."]);
      break;
    case "outliers":
      add("rout", 82, "recommended", ["ROUT (FDR-based) is the safe default — it handles several outliers at once with a controlled false-discovery rate."], ["Outlier removal is scientifically justified."], ["Removing points changes the result; report how many were removed."]);
      add("iterative", 78, "recommended", ["Iterative Grubbs removes the most-extreme point and repeats."], ["Data are roughly normal apart from outliers."], ["Can over-remove; ROUT is often preferable for multiple outliers."]);
      add("single", 55, "alternative", ["Remove only the single most-extreme point."], ["At most one outlier is expected."], ["Misses multiple outliers (masking)."]);
      break;
    case "curvetransform":
      add("smooth", 70, "recommended", ["Savitzky-Golay smoothing is the gentle default — it reduces noise while preserving peak shape."], ["The signal is noisier than the feature of interest."], ["Over-smoothing distorts sharp features."]);
      add("differentiate", 55, "alternative", ["First derivative (dY/dX) — highlights slopes and inflection points."], ["You want rates of change."], ["Differentiation amplifies noise; smooth first."]);
      add("differentiate2", 45, "alternative", ["Second derivative — highlights curvature."], ["You want curvature."], ["Very noise-sensitive; smooth first."]);
      add("integrate", 50, "alternative", ["Cumulative integral (∫Y·dX) — running area."], ["You want an accumulated quantity."], ["Any baseline offset accumulates."]);
      break;
    default:
      return [];
  }
  return out.sort((a, b) => b.score - a.score || a.variant.localeCompare(b.variant));
}

/**
 * The sheet the user is looking at: the open datasheet, else the open graph's data, else
 * the open analysis result's source data. Caution: there is no fallback beyond that — with
 * one, every no-data tab (Welcome, gallery) would push the demo project's first sheet, and
 * the assistant would stay stuck on that sheet's graph. A caller that must always have a target (the
 * Analyze dialog is a picker) passes its table explicitly.
 */
function viewedTable(project: Project, ctx: AssistantContext): DataTable | undefined {
  const tables = project.tables ?? [];
  const plot = ctx.activePlotId ? (project.plots ?? []).find((p) => p.id === ctx.activePlotId) : undefined;
  const analysis = ctx.activeAnalysisId ? (project.analyses ?? []).find((a) => a.id === ctx.activeAnalysisId) : undefined;
  return (
    tables.find((t) => t.id === ctx.activeTableId) ??
    (plot ? tables.find((t) => t.id === plot.source) : undefined) ??
    (analysis ? tables.find((t) => t.id === analysis.source) : undefined)
  );
}

export function suggestCurveModels(
  project: Project,
  ctx: AssistantContext,
  goal?: CurveModelGoal,
  availableVariants?: ReadonlyArray<{ id: string; group?: string | undefined }>,
): CurveModelRecommendation[] {
  const activePlot = ctx.activePlotId ? (project.plots ?? []).find((p) => p.id === ctx.activePlotId) : undefined;
  const table = viewedTable(project, ctx);
  return table ? suggestCurveModelsForTable(table, { activePlot, xId: ctx.curveXId, yId: ctx.curveYId, goal, availableVariants }) : [];
}
export function suggestAnalysisSteps(
  project: Project,
  ctx: AssistantContext,
  opts: { includeCompleted?: boolean } = {},
): Suggestion[] {

  const plots = project.plots ?? [];
  const activePlot = ctx.activePlotId ? plots.find((p) => p.id === ctx.activePlotId) : undefined;
  // These suggestions describe the sheet the user is viewing — see viewedTable for why
  // there is deliberately no fallback beyond it.
  const table = viewedTable(project, ctx);
  if (!table) return [];

  const profile = profileTable(table);
  // Selecting the datasheet must give the same advice as selecting its graph: a graph
  // of this data still says what the data is for. Without this, a sheet such as "Gene
  // expression" would get a correlation matrix + PCA with its heatmap selected and nothing
  // with the datasheet selected. Only the intent is borrowed — the wording still says "this
  // graph" only when a graph really is active.
  const contextPlot = activePlot ?? plots.find((p) => p.source === table.id);
  const intent = inferGraphIntent(contextPlot, table);
  const candidates = buildCandidateSpecs(project, table, activePlot, profile, intent, opts);
  return rankCandidates(project, table, candidates, opts).slice(0, 5);
}

/**
 * Ordered next-step suggestions for the current document + focus. Highest-value
 * first; the UI shows the top non-dismissed one.
 */
export function suggestNextSteps(project: Project, ctx: AssistantContext): Suggestion[] {
  const { tables = [], plots = [], analyses = [] } = project;
  const out: Suggestion[] = [];

  if (tables.length === 0) {
    out.push({ id: "start", text: "No data yet — import a file or start a new datasheet.", cta: "New…", actionId: "new-graph-create", kind: "general" });
    return out;
  }

  // A nudge about a sheet the user is not viewing is a distraction, not help — see viewedTable.
  // No focus → only project-wide tips.
  const focus = viewedTable(project, ctx);

  if (focus && !plots.some((p) => p.source === focus.id)) {
    out.push({ id: `graph:${focus.id}`, text: `"${focus.name}" has no graph yet.`, cta: "New graph of this data", actionId: "new-graph", kind: "general" });
  }

  const analysisSuggestions = suggestAnalysisSteps(project, ctx);
  out.push(...analysisSuggestions);

  if (focus && analysisSuggestions.length === 0 && !analyses.some((a) => a.source === focus.id)) {
    out.push({ id: `analyze:${focus.id}`, text: `Run a statistical test on "${focus.name}".`, cta: "Analyze…", actionId: "analyze", kind: "general" });
  }

  const stale = plots.filter((p) => p.status === "stale").length + analyses.filter((a) => a.status === "stale").length;
  if (stale > 0) {
    out.push({ id: "stale", text: `${stale} result${stale === 1 ? " is" : "s are"} out of date.`, cta: "Open lineage", actionId: "view-lineage", kind: "general" });
  }

  if (ctx.activePlotId && plots.length >= 2) {
    out.push({ id: "look", text: "Give your graphs one consistent look.", cta: "Apply this look…", actionId: "apply-look", kind: "general" });
  }

  return out;
}
