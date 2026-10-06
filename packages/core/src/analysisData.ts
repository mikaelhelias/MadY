/**
 * Engine-payload mapping — the pure bridge from a `DataTable` + chosen datasets to
 * the numeric `data` payload the stats engine expects for a given method. It lives in
 * core, not in the renderer, so both the app and the headless agent/MCP
 * surface build the identical payload from the same code — no second, drift-prone
 * copy of the column→array mapping. DOM-free by construction (see the package rule in
 * `index.ts`): it reads only the document model.
 */
import type { AnalysisParams, DataTable, NodeId } from "./model";
import { SURVIVAL_UNIT_DAYS } from "./model";
import { tableDatasets, xColumn } from "./dataset";
import { applyExclusions } from "./cells";
import { numericCell } from "./numeric";
import { parseRowGroupId, rowGroupValues } from "./rowGroups";
import { CONSTRAINED_METHODS } from "./ordination";

// Defined in `numeric.ts` (so `rowGroups` can share it without an import cycle) and
// re-exported here for the callers that import it from this module.
export { numericCell };

/** Finite numeric values of a single column (skips null/blank/non-numeric). */
export function columnValues(table: DataTable, columnId: NodeId): number[] {
  const out: number[] = [];
  for (const row of table.rows) {
    const v = numericCell(row.cells[columnId]);
    if (v !== null) out.push(v);
  }
  return out;
}

/** The replicate column ids of a dataset (its lead + subcolumns), or the id itself. */
export function replicateColumns(table: DataTable, datasetId: NodeId): NodeId[] {
  const ds = tableDatasets(table).find((d) => d.id === datasetId);
  return ds ? ds.replicates : [datasetId];
}

/**
 * All finite replicate values of a dataset, pooled as independent observations
 * (row-major, so a paired test against another dataset stays aligned when the
 * structures match). For a single-column dataset this equals `columnValues`.
 */
export function datasetValues(table: DataTable, datasetId: NodeId): number[] {
  // A row group ("rowgrp:<labelColumn>:<level>") is a virtual dataset: the rows of one
  // category. Resolving it here means every method that reads its groups through
  // `datasetValues` — t test, ANOVA, TOST, permutation, describe… — supports
  // group-by-row-category with no further plumbing.
  const rg = parseRowGroupId(datasetId);
  if (rg) return rowGroupValues(table, rg.labelColumnId, rg.level);
  const cols = replicateColumns(table, datasetId);
  const out: number[] = [];
  for (const row of table.rows) {
    for (const colId of cols) {
      const v = numericCell(row.cells[colId]);
      if (v !== null) out.push(v);
    }
  }
  return out;
}

/**
 * Expanded (x, y) pairs for an XY method: each row's X paired with every finite
 * replicate Y of the dataset (so curve fits / regression use all replicates, not
 * the mean). For a single-column dataset this is one (x, y) per complete row.
 */
export function datasetXY(
  table: DataTable,
  xColumnId: NodeId,
  datasetId: NodeId,
): { x: number[]; y: number[] } {
  const cols = replicateColumns(table, datasetId);
  const x: number[] = [];
  const y: number[] = [];
  for (const row of table.rows) {
    const xv = numericCell(row.cells[xColumnId]);
    if (xv === null) continue;
    for (const colId of cols) {
      const yv = numericCell(row.cells[colId]);
      if (yv !== null) {
        x.push(xv);
        y.push(yv);
      }
    }
  }
  return { x, y };
}

/**
 * How many rows an XY analysis had to exclude — rows where exactly one side was
 * present (a finite X with no usable Y, or a Y with no X), so the pair could not be
 * formed. A fully-blank row is not counted (it is empty, not excluded data); a row
 * with X and at least one finite replicate Y is used, not excluded. Uses the same
 * primitives as `datasetXY`, so the count matches what the fit actually dropped. This
 * is what a Methods paragraph reports as complete-case handling — the renderer drops
 * these before the engine ever sees them, so the count lives here, not in the engine.
 */
export function xyExcludedRows(table: DataTable, xColumnId: NodeId, datasetId: NodeId): number {
  if (!table.columns?.length || !table.rows?.length) return 0;
  const cols = replicateColumns(table, datasetId);
  let excluded = 0;
  for (const row of table.rows) {
    const xPresent = numericCell(row.cells[xColumnId]) !== null;
    const yPresent = cols.some((colId) => numericCell(row.cells[colId]) !== null);
    if (xPresent !== yPresent) excluded += 1;
  }
  return excluded;
}

/**
 * Per-point SD aligned to `datasetXY`'s (x, y) points, for 1/SD² curve-fit weighting.
 * Uses the entered SD column (summary mean+SD data) when present, else the replicate
 * scatter of each row (needs ≥2 finite replicates). Every point of a row carries that
 * row's SD (so replicate points share it). Returns null when any emitted point lacks a
 * finite positive SD — 1/SD² can't be applied, so the payload omits it and the engine
 * reports a clear error instead of silently mis-weighting.
 */
export function datasetPointSD(table: DataTable, xColumnId: NodeId, datasetId: NodeId): number[] | null {
  const ds = tableDatasets(table).find((d) => d.id === datasetId);
  const cols = ds ? ds.replicates : [datasetId];
  const sdCol = ds?.sd;
  const out: number[] = [];
  for (const row of table.rows) {
    if (numericCell(row.cells[xColumnId]) === null) continue;
    let rowSD: number | null = null;
    if (sdCol) {
      rowSD = numericCell(row.cells[sdCol]);
    } else if (cols.length >= 2) {
      const vals = cols.map((c) => numericCell(row.cells[c])).filter((v): v is number => v !== null);
      if (vals.length >= 2) {
        const m = vals.reduce((a, v) => a + v, 0) / vals.length;
        rowSD = Math.sqrt(vals.reduce((a, v) => a + (v - m) ** 2, 0) / (vals.length - 1));
      }
    }
    for (const c of cols) {
      if (numericCell(row.cells[c]) !== null) out.push(rowSD ?? NaN);
    }
  }
  return out.length > 0 && out.every((s) => Number.isFinite(s) && s > 0) ? out : null;
}

/** Display name of a dataset (its lead column), with a column-name fallback. */
export function datasetName(table: DataTable, id?: NodeId): string {
  if (!id) return "?";
  const rg = parseRowGroupId(id);
  if (rg) return rg.level; // a row group is named by its category
  const ds = tableDatasets(table).find((d) => d.id === id);
  return ds?.name ?? table.columns.find((c) => c.id === id)?.name ?? "?";
}

/**
 * The unit written in a column header: the text inside its last pair of brackets —
 * "Temperature (°C)" → "°C", "T [K]" → "K". No brackets → "". Used to label a Tm.
 */
export function unitFromHeader(name: string): string {
  const m = /[([]\s*([^()[\]]+?)\s*[)\]]\s*$/.exec(name);
  return m ? m[1]! : "";
}

/** Build the engine `data` payload for a method + params from the live table. */
export function buildAnalysisData(
  method: string,
  params: AnalysisParams,
  rawTable: DataTable,
): Record<string, unknown> {
  // Note: excluded values are masked to null before any extractor runs. `columnValues` and
  // `datasetValues` read `row.cells[...]` directly, so without this an excluded outlier would
  // still reach the mean, the SD and the p-value — a value the user has explicitly excluded.
  // Masking here covers every method at once.
  const table = applyExclusions(rawTable);
  const cols = params.columns;
  const [c0, c1] = cols;
  const conf = params.conf;
  const vals = (id?: NodeId): number[] => (id ? datasetValues(table, id) : []);
  if (method === "describe" || method === "normality") return { values: vals(c0), conf };
  // Goodness-of-fit — one column of observed counts (one per row); labels from the
  // leading label column. Expected defaults to uniform in the engine.
  if (method === "goodnessoffit") {
    const xc = xColumn(table)?.id;
    const observed: number[] = [];
    const labels: string[] = [];
    table.rows.forEach((row, i) => {
      const v = numericCell(row.cells[c0!]);
      if (v !== null) {
        observed.push(v);
        const lab = xc ? row.cells[xc] : null;
        labels.push(lab != null && String(lab).trim() !== "" ? String(lab) : `Category ${i + 1}`);
      }
    });
    return { observed, labels };
  }
  // Nested ANOVA / nested t — each selected dataset is a group; its replicate
  // subcolumns are the (random) subgroups, each subcolumn's row-values the replicates.
  if (method === "nested") {
    return {
      variant: params.variant ?? "anova",
      groups: cols.map((ds) => ({
        label: datasetName(table, ds),
        subgroups: replicateColumns(table, ds).map((colId) => columnValues(table, colId)),
      })),
    };
  }
  // Meta-analysis / publication bias — one study per row from the meta sheet's three
  // positional columns (Estimate · Lower · Upper), labels from the Study lead. Rows
  // without a complete CI are dropped here; the engine counts + reports the unusable
  // ones (it sees the full picture: log-scale positivity is its call). `conf` is the
  // level the limits were entered at; results report at the same level. `variant`
  // "log" works in log space (ratio measures). Both methods get this one payload, so
  // they agree on which studies exist.
  if (method === "metaanalysis" || method === "publicationbias") {
    const xc = xColumn(table)?.id;
    const [ce, cl, ch] = cols;
    const studies: { est: number; lo: number; hi: number; label: string }[] = [];
    table.rows.forEach((row, i) => {
      const est = ce ? numericCell(row.cells[ce]) : null;
      const lo = cl ? numericCell(row.cells[cl]) : null;
      const hi = ch ? numericCell(row.cells[ch]) : null;
      if (est === null || lo === null || hi === null) return;
      const lab = xc ? row.cells[xc] : null;
      studies.push({ est, lo, hi, label: lab != null && String(lab).trim() !== "" ? String(lab) : `Study ${i + 1}` });
    });
    return { studies, conf: conf ?? 0.95, log: params.variant === "log" };
  }
  // P-value corrector — one column of P values → multiplicity-adjusted P values. The
  // correction method rides on `variant`; the significance level α is read from the
  // shared Confidence selector (95% → α = 0.05), the same conf→α mapping `outliers` uses.
  if (method === "pcorrect") {
    return { pvalues: vals(c0), method: params.variant ?? "holm", alpha: params.conf != null ? 1 - params.conf : 0.05 };
  }
  if (method === "outliers") {
    const variant = params.variant ?? "iterative";
    // conf maps to α (Grubbs) or Q (ROUT FDR); ROUT defaults to Q = 1%.
    const level = params.conf != null ? 1 - params.conf : variant === "rout" ? 0.01 : 0.05;
    return variant === "rout" ? { values: vals(c0), variant, Q: level } : { values: vals(c0), variant, alpha: level };
  }
  if (method === "anova") {
    return {
      variant: params.variant ?? "anova",
      groups: cols.map((c) => datasetValues(table, c)),
      labels: cols.map((c) => datasetName(table, c)),
      posthoc: params.posthoc ?? "tukey",
      scheme: params.scheme ?? "all-pairs",
      control: params.control ?? 0,
      ...(params.pairs ? { pairs: params.pairs } : {}),
      conf,
    };
  }
  // XY methods — c0 is the X column, c1 the Y dataset; expand over replicates.
  if (method === "correlation") {
    const { x, y } = datasetXY(table, c0!, c1!);
    return { variant: params.variant ?? "pearson", a: x, b: y, tail: params.tail ?? "two-sided", conf };
  }
  // Correlation matrix — each selected dataset is a variable; values are row-aligned
  // (lead column per row, null for blanks) so the engine does pairwise-complete.
  if (method === "corrmatrix") {
    return {
      variant: params.variant ?? "pearson",
      columns: cols.map((c) => table.rows.map((row) => numericCell(row.cells[c]))),
      labels: cols.map((c) => datasetName(table, c)),
    };
  }
  // PCA — every selected dataset is a variable (row-aligned); `variant` carries the
  // scaling choice ("standardize" = correlation matrix, "center" = covariance). An
  // optional `groupBy` column labels each case (excluded from the variables) so the
  // score plot can split into per-group series + confidence ellipses.
  // PERMANOVA: the ticked columns are the variables, the group column says which group each case is in (and is left
  // out of the variables, as PCA's is). Distance, permutations and seed as the ordinations send them.
  if (method === "permanova") {
    const groupBy = params.groupBy;
    const varCols = groupBy ? cols.filter((c) => c !== groupBy) : cols;
    return {
      columns: varCols.map((c) => table.rows.map((row) => numericCell(row.cells[c]))),
      labels: varCols.map((c) => datasetName(table, c)),
      ...(groupBy ? { groups: table.rows.map((row) => row.cells[groupBy] ?? null) } : {}),
      metric: params.metric ?? "euclidean",
      permutations: params.permutations ?? 999,
      seed: params.seed ?? 20240704,
    };
  }
  if (method === "pca") {
    const groupBy = params.groupBy;
    const varCols = groupBy ? cols.filter((c) => c !== groupBy) : cols;
    const sel = params.componentSelection;
    return {
      columns: varCols.map((c) => table.rows.map((row) => numericCell(row.cells[c]))),
      labels: varCols.map((c) => datasetName(table, c)),
      standardize: (params.variant ?? "standardize") === "standardize",
      ...(groupBy ? { groups: table.rows.map((row) => row.cells[groupBy] ?? null) } : {}),
      // Component-selection rule (default kaiser@1.0 in the engine → omit when unset).
      ...(sel ? { componentSelection: sel } : {}),
      ...(sel === "kaiser" && params.kaiserThreshold != null ? { kaiserThreshold: params.kaiserThreshold } : {}),
      ...(sel === "fixedk" && params.fixedK != null ? { fixedK: params.fixedK } : {}),
      ...(sel === "variance" && params.varianceThreshold != null ? { varianceThreshold: params.varianceThreshold } : {}),
      ...(sel === "parallel" && params.parallelPercentile != null ? { parallelPercentile: params.parallelPercentile } : {}),
    };
  }
  // Ordination (PCoA / NMDS) — every selected column is a variable, exactly as for PCA,
  // and the lead (text) column labels the cases so a site can be named on the map. What
  // separates these from PCA is the pair the user chooses here: the transformation applied
  // to the matrix and the distance taken on it. Those two decide what the map means.
  // A constrained ordination (RDA / CCA / db-RDA) reads two blocks from the same sheet: the
  // ticked response columns, and the explanatory ones. All three take the same payload — they
  // differ in the geometry the engine decomposes, never in what the sheet has to supply. Both
  // blocks come from this one table: `Plot.overlays` can join a second sheet only at plot time,
  // and the analysis needs both blocks when it runs.
  /**
   * Variance partitioning reads the same sheet as a constrained ordination, but the explanatory
   * side arrives in two or three blocks instead of one — that is the whole method, and it is why
   * this cannot go through the branch below. The response is what is left after every block is
   * taken out, so a column can never be both a response and an explanatory variable.
   */
  if (method === "varpart") {
    const blocks = [params.explanatory ?? [], params.explanatory2 ?? [], params.explanatory3 ?? []];
    const used = new Set(blocks.flat());
    const respCols = cols.filter((c) => !used.has(c));
    const lead = xColumn(table);
    // Note: raw cells for every block, not numericCell: a categorical column is legitimate in a
    // block (the engine expands it to indicator columns), and coercing it here would blank it.
    const raw = (ids: NodeId[]): unknown[][] => ids.map((c) => table.rows.map((row) => row.cells[c] ?? null));
    const names = (ids: NodeId[]): string[] => ids.map((c) => datasetName(table, c));
    return {
      columns: respCols.map((c) => table.rows.map((row) => numericCell(row.cells[c]))),
      labels: respCols.map((c) => datasetName(table, c)),
      explanatory: raw(blocks[0]!),
      explanatoryLabels: names(blocks[0]!),
      explanatory2: raw(blocks[1]!),
      explanatoryLabels2: names(blocks[1]!),
      ...(blocks[2]!.length ? { explanatory3: raw(blocks[2]!), explanatoryLabels3: names(blocks[2]!) } : {}),
      blockLabels: params.blockLabels ?? [],
      transform: params.transform ?? "none",
      permutations: params.permutations ?? 999,
      seed: params.seed ?? 20240704,
      ...(lead ? { caseLabels: table.rows.map((row) => row.cells[lead.id] ?? null) } : {}),
      ...(params.groupBy ? { groups: table.rows.map((row) => row.cells[params.groupBy!] ?? null) } : {}),
    };
  }
  if (CONSTRAINED_METHODS.has(method)) {
    const explanatory = params.explanatory ?? [];
    const respCols = cols.filter((c) => !explanatory.includes(c));
    const lead = xColumn(table);
    return {
      columns: respCols.map((c) => table.rows.map((row) => numericCell(row.cells[c]))),
      labels: respCols.map((c) => datasetName(table, c)),
      // Note: raw cells, not numericCell: a categorical explanatory column is legitimate and the
      // engine expands it to indicator columns. Coercing it to numbers here would silently
      // turn every level into a blank.
      explanatory: explanatory.map((c) => table.rows.map((row) => row.cells[c] ?? null)),
      explanatoryLabels: explanatory.map((c) => datasetName(table, c)),
      transform: params.transform ?? "none",
      // db-RDA is the one that takes a distance; RDA and CCA carry their geometry in the
      // method itself and ignore it.
      ...(method === "dbrda" ? { metric: params.metric ?? "braycurtis" } : {}),
      scaling: params.scaling ?? "symmetric",
      permutations: params.permutations ?? 999,
      seed: params.seed ?? 20240704,
      ...(lead ? { caseLabels: table.rows.map((row) => row.cells[lead.id] ?? null) } : {}),
      ...(params.groupBy ? { groups: table.rows.map((row) => row.cells[params.groupBy!] ?? null) } : {}),
    };
  }
  if (method === "ca" || method === "pcoa" || method === "nmds") {
    const groupBy = params.groupBy;
    const varCols = groupBy ? cols.filter((c) => c !== groupBy) : cols;
    // The site names. An ordination sheet (`pca` / `multivariable`) is lead-less, so there is
    // no x column to read: the names live in whatever text column the user did not pick as a
    // variable. Fall back to the lead column on the sheet formats that have one.
    const used = new Set([...varCols, ...(groupBy ? [groupBy] : [])]);
    const mostlyText = (id: NodeId): boolean => {
      let filled = 0;
      let numeric = 0;
      for (const row of table.rows) {
        const v = row.cells[id];
        if (v === undefined || v === null || v === "") continue;
        filled++;
        if (numericCell(v) !== null) numeric++;
      }
      return filled > 0 && numeric < filled / 2;
    };
    const lead = xColumn(table) ?? table.columns.find((c) => !used.has(c.id) && mostlyText(c.id));
    return {
      columns: varCols.map((c) => table.rows.map((row) => numericCell(row.cells[c]))),
      labels: varCols.map((c) => datasetName(table, c)),
      // CA carries no distance or transformation: the chi-square metric is the method.
      // Sending them would advertise a choice that changes nothing.
      ...(method === "ca" ? {} : { metric: params.metric ?? "braycurtis", transform: params.transform ?? "none" }),
      ...(lead ? { caseLabels: table.rows.map((row) => row.cells[lead.id] ?? null) } : {}),
      ...(groupBy ? { groups: table.rows.map((row) => row.cells[groupBy] ?? null) } : {}),
      ...(method === "ca" ? { scaling: params.scaling ?? "symmetric" } : {}),
      ...(method === "pcoa" ? { correction: params.correction ?? "none" } : {}),
      ...(method === "nmds"
        ? { dimensions: params.dimensions ?? 2, tries: params.tries ?? 20, seed: params.seed ?? 20240704 }
        : {}),
    };
  }
  // Cluster analysis — every selected column is a variable (row-aligned observations);
  // k-means or hierarchical, cut into k groups. The engine z-scores by default.
  if (method === "cluster") {
    return {
      columns: cols.map((c) => table.rows.map((row) => numericCell(row.cells[c]))),
      labels: cols.map((c) => datasetName(table, c)),
      variant: params.variant ?? "kmeans",
      k: params.k ?? 3,
      standardize: params.standardize ?? true,
      seed: params.seed ?? 20240704,
      metric: params.metric ?? "euclidean",
      linkage: params.linkage ?? "ward",
      // Optional k-selection scan (elbow + silhouette over k=2…kMax).
      ...(params.scanK ? { scanK: true, kMax: params.kMax ?? 10 } : {}),
    };
  }
  // N-way factorial ANOVA — the first selected column is the numeric value (outcome);
  // the rest are the categorical factors (their raw cell values are the levels). Rows
  // are aligned; the engine listwise-drops any row missing the value or a factor level.
  if (method === "multifactor") {
    const [valueCol, ...facs] = cols;
    return {
      value: table.rows.map((row) => numericCell(row.cells[valueCol!])),
      factors: facs.map((c) => table.rows.map((row) => row.cells[c] ?? null)),
      factorLabels: facs.map((c) => datasetName(table, c)),
    };
  }
  // Mixed-effects model — the first column is the numeric value, the second is the random
  // group (a random intercept per level), the rest are optional fixed factors (categorical).
  // `variant` "ml" switches REML→ML (for likelihood-ratio model comparison). Row-aligned.
  if (method === "mixedmodel") {
    const [valueCol, groupCol, ...facs] = cols;
    return {
      value: table.rows.map((row) => numericCell(row.cells[valueCol!])),
      group: table.rows.map((row) => row.cells[groupCol!] ?? null),
      fixed: facs.map((c) => table.rows.map((row) => row.cells[c] ?? null)),
      fixedLabels: facs.map((c) => datasetName(table, c)),
      groupLabel: datasetName(table, groupCol),
      reml: (params.variant ?? "reml") !== "ml",
      conf,
    };
  }
  // Multiple linear + logistic regression — the first selected column is the
  // outcome Y, the rest are predictors. Values row-aligned (null for blanks); the
  // engine does complete-case listwise deletion.
  if (method === "multipleregression" || method === "logistic" || method === "poisson") {
    const [outcome, ...preds] = cols;
    return {
      y: table.rows.map((row) => numericCell(row.cells[outcome!])),
      predictors: preds.map((c) => table.rows.map((row) => numericCell(row.cells[c]))),
      labels: preds.map((c) => datasetName(table, c)),
      outcomeLabel: datasetName(table, outcome),
      conf,
    };
  }
  // Cox proportional-hazards — the first selected column is the survival time, the
  // second is the event indicator (1 = event, 0 = censored), the rest are predictors.
  // Row-aligned (null for blanks); the engine does complete-case listwise deletion.
  if (method === "cox") {
    const [timeCol, eventCol, ...preds] = cols;
    return {
      time: table.rows.map((row) => numericCell(row.cells[timeCol!])),
      event: table.rows.map((row) => numericCell(row.cells[eventCol!])),
      predictors: preds.map((c) => table.rows.map((row) => numericCell(row.cells[c]))),
      names: preds.map((c) => datasetName(table, c)),
      conf,
    };
  }
  if (method === "regression") {
    const { x, y } = datasetXY(table, c0!, c1!);
    return {
      x, y,
      variant: params.variant ?? "ols",
      conf,
      ...(params.weighting && params.weighting !== "none" ? { weighting: params.weighting } : {}),
      ...(params.throughPoint ? { throughPoint: params.throughPoint } : {}),
    };
  }
  // Deming: method-comparison XY (both axes have error); λ = error-variance ratio (default 1).
  if (method === "deming") {
    const { x, y } = datasetXY(table, c0!, c1!);
    return { x, y, conf, ...(params.lambda != null ? { lambda: params.lambda } : {}) };
  }
  // Bland-Altman: paired measurements A (x) and B (y); bias + limits of agreement.
  if (method === "blandaltman") {
    const { x, y } = datasetXY(table, c0!, c1!);
    return { x, y, conf, percent: params.percent ?? false, agreementK: params.agreementK ?? 1.96 };
  }
  // Passing-Bablok: non-parametric method-comparison regression (both axes have error).
  if (method === "passingbablok") {
    const { x, y } = datasetXY(table, c0!, c1!);
    return { x, y, conf };
  }
  if (method === "curvefit") {
    const { x, y } = datasetXY(table, c0!, c1!);
    // 1/SD² weighting needs the per-point SD threaded to the engine (aligned to x/y).
    const sd = params.weighting === "1/SD2" ? datasetPointSD(table, c0!, c1!) : null;
    return {
      model: params.variant ?? "4pl", x, y, conf, weighting: params.weighting ?? "none",
      ...(sd ? { sd } : {}),
      ...(params.rout ? { rout: true } : {}),
      ...(params.flag?.enabled ? { flag: params.flag } : {}),
      ...(params.variant === "custom" && params.equation ? { equation: params.equation } : {}),
      ...(params.variant === "custom" && params.initialValues ? { initialValues: params.initialValues } : {}),
      ...(params.fixed ? { fixed: params.fixed } : {}),
      ...(params.paramBounds ? { paramBounds: params.paramBounds } : {}),
      ...(params.ecLevels && params.ecLevels.length ? { ecLevels: params.ecLevels } : {}),
      ...(params.chengProsuff ? { chengProsuff: params.chengProsuff } : {}),
    };
  }
  // Interpolate a standard curve: complete (X,Y) rows are the standards; a row with
  // only Y (X blank) is an unknown to read X from, and only X (Y blank) reads Y — the
  // same "leave the cell blank" convention for unknowns.
  if (method === "interpolate") {
    const { x, y } = datasetXY(table, c0!, c1!);
    const leadY = replicateColumns(table, c1!)[0] ?? c1!;
    const unknownsY: number[] = [];
    const unknownsX: number[] = [];
    for (const row of table.rows) {
      const xv = numericCell(row.cells[c0!]);
      const yv = numericCell(row.cells[leadY]);
      if (xv === null && yv !== null) unknownsY.push(yv);
      else if (xv !== null && yv === null) unknownsX.push(xv);
    }
    return { model: params.variant ?? "linear", x, y, weighting: params.weighting ?? "none", unknownsY, unknownsX, conf };
  }
  // Compare models — fit two equations to the same X column + Y dataset and rank
  // them by AICc (+ extra-sum-of-squares F when nested).
  if (method === "comparefits") {
    const { x, y } = datasetXY(table, c0!, c1!);
    return {
      x, y, conf,
      modelA: params.variant ?? "3pl",
      modelB: params.variant2 ?? "4pl",
      weighting: params.weighting ?? "none",
    };
  }
  // Global (shared-parameter) fit — one equation across several Y datasets that
  // share the table's X column; `shared` names the parameters held common.
  if (method === "globalfit") {
    const xcol = xColumn(table)?.id;
    const constMap = params.consts ?? {};
    const hasConsts = Object.keys(constMap).length > 0;
    return {
      model: params.variant ?? "4pl",
      conf,
      datasets: cols.map((ds) => {
        const { x, y } = xcol ? datasetXY(table, xcol, ds) : { x: [], y: [] };
        const d: { label: string; x: number[]; y: number[]; consts?: number[] } = { label: datasetName(table, ds), x, y };
        if (hasConsts) d.consts = [constMap[ds] ?? 0];
        return d;
      }),
      shared: params.shared ?? [],
      ...(params.compareOneCurve ? { compareOneCurve: true } : {}),
      weighting: params.weighting ?? "none",
      ...(params.fixed ? { fixed: params.fixed } : {}),
      ...(params.paramBounds ? { paramBounds: params.paramBounds } : {}),
    };
  }
  // Melting temperature — every selected dataset is a sample; each of its replicate columns is
  // fitted on its own, so the columns travel separately, row-aligned with one X list
  // (a blank cell is null; the engine pairs each column with X itself). `control` is the index of
  // the control sample among the selected datasets; the unit comes from X's own header.
  if (method === "meltingtemp") {
    const xc = xColumn(table);
    const xs = table.rows.map((r) => (xc ? numericCell(r.cells[xc.id]) : null));
    const ctrl = typeof params.control === "number" ? cols[params.control] : undefined;
    return {
      conf,
      datasets: cols.map((ds) => ({
        label: datasetName(table, ds),
        x: xs,
        replicates: replicateColumns(table, ds).map((c) => ({
          label: table.columns.find((col) => col.id === c)?.name ?? "",
          y: table.rows.map((r) => numericCell(r.cells[c])),
        })),
      })),
      ...(params.sloped ? { sloped: true } : {}),
      ...(params.rangeFrom !== undefined ? { from: params.rangeFrom } : {}),
      ...(params.rangeTo !== undefined ? { to: params.rangeTo } : {}),
      ...(params.smoothWindow ? { smoothWindow: params.smoothWindow } : {}),
      ...(ctrl ? { control: datasetName(table, ctrl) } : {}),
      unit: unitFromHeader(xc?.name ?? ""),
    };
  }
  // ROC — c0 is the predictor (score) column, c1 the binary-outcome dataset, paired per row.
  if (method === "roc") {
    if (params.marker2) {
      // DeLong compare: two markers on the same subjects + shared labels, taken
      // complete-case across all three columns so the arrays stay row-aligned.
      const labelCol = replicateColumns(table, c1!)[0] ?? c1!;
      const triples = table.rows
        .map((row) => [numericCell(row.cells[c0!]), numericCell(row.cells[params.marker2!]), numericCell(row.cells[labelCol])] as const)
        .filter((t): t is [number, number, number] => t[0] !== null && t[1] !== null && t[2] !== null);
      return { scores: triples.map((t) => t[0]), scores2: triples.map((t) => t[1]), labels: triples.map((t) => t[2]), conf };
    }
    const { x, y } = datasetXY(table, c0!, c1!);
    return { scores: x, labels: y, conf };
  }
  // AUC — c0 is the X column, c1 the Y dataset; baseline carried in `variant`.
  if (method === "curvetransform") {
    const { x, y } = datasetXY(table, c0!, c1!);
    return {
      x, y, variant: params.variant ?? "smooth",
      ...(params.smoothWindow ? { smoothWindow: params.smoothWindow } : {}),
    };
  }
  if (method === "auc") {
    const { x, y } = datasetXY(table, c0!, c1!);
    // A "custom" baseline sends the numeric value; zero/min/mean send the mode string.
    const baseline = params.variant === "custom" ? (params.baselineValue ?? 0) : (params.variant ?? "zero");
    return { x, y, baseline, ...(params.minPeakFraction != null ? { minPeakFraction: params.minPeakFraction } : {}) };
  }
  // ANCOVA — compare regression lines: X = the table's first column; each selected
  // dataset is a group/line, its (x, y) pairs expanded over replicates.
  if (method === "ancova") {
    const xcol = table.columns[0]?.id;
    return {
      groups: cols.map((ds) => {
        const { x, y } = xcol ? datasetXY(table, xcol, ds) : { x: [], y: [] };
        return { label: datasetName(table, ds), x, y };
      }),
    };
  }
  // repeated-measures ANOVA — each row is a subject, each selected column a
  // condition/timepoint (within-subjects). Complete cases only (balanced).
  if (method === "rmanova") {
    const rowsOut: number[][] = [];
    for (const row of table.rows) {
      const vals = cols.map((c) => numericCell(row.cells[c]));
      if (vals.length > 0 && vals.every((v) => v !== null)) rowsOut.push(vals as number[]);
    }
    return { data: rowsOut, labels: cols.map((c) => datasetName(table, c)) };
  }
  // survival — survival table: X column = elapsed time; each selected column
  // is a group, its cells = 1 (event) / 0 (censored). A subject is a row where the
  // group cell is non-blank.
  if (method === "survival") {
    // date-pair entry (`table.survivalDates`): elapsed time = end − start (both `date`
    // columns storing days-since-epoch), divided into the chosen unit. Rows where either
    // date is blank, or end < start, are dropped (a negative span is a data-entry error).
    const dates = table.survivalDates;
    if (dates) {
      const startCol = table.columns.find((c) => c.role === "survStart")?.id;
      const endCol = table.columns.find((c) => c.role === "survEnd")?.id;
      const perUnit = SURVIVAL_UNIT_DAYS[dates.unit];
      return {
        groups: cols.map((ds) => {
          const time: number[] = [];
          const event: number[] = [];
          for (const row of table.rows) {
            const ev = numericCell(row.cells[ds]);
            const s = startCol ? numericCell(row.cells[startCol]) : null;
            const e = endCol ? numericCell(row.cells[endCol]) : null;
            if (ev !== null && s !== null && e !== null && e >= s) {
              time.push((e - s) / perUnit);
              event.push(ev === 1 ? 1 : 0);
            }
          }
          return { label: datasetName(table, ds), time, event };
        }),
        conf,
        ...(params.pairwise ? { pairwise: true, pairwiseMethod: params.pairwiseMethod ?? "holm-sidak" } : {}),
      };
    }
    // elapsed entry: the time column is the first column not among the selected event/censor
    // columns that carries numeric data — skipping any `date`-typed or survStart/survEnd column
    // so a stranded date pair (mode toggled back off) is never mistaken for elapsed time. It is
    // not simply columns[0]: a reordered table can put a group column first, and survival seeds
    // carry no role to tell them apart.
    const selected = new Set(cols);
    const isDateCol = (c: (typeof table.columns)[number]): boolean =>
      c.type === "date" || c.role === "survStart" || c.role === "survEnd";
    const xcol =
      table.columns.find((c) => !selected.has(c.id) && !isDateCol(c) && table.rows.some((r) => numericCell(r.cells[c.id]) !== null))?.id
      ?? table.columns.find((c) => !selected.has(c.id) && !isDateCol(c))?.id
      ?? table.columns[0]?.id;
    return {
      groups: cols.map((ds) => {
        const time: number[] = [];
        const event: number[] = [];
        for (const row of table.rows) {
          const ev = numericCell(row.cells[ds]);
          const t = xcol ? numericCell(row.cells[xcol]) : null;
          if (ev !== null && t !== null) {
            time.push(t);
            // Kaplan-Meier's event indicator is binary: 1 = event, anything else (0 or an
            // out-of-range code) = censored — normalise so a stray code isn't mis-scored.
            event.push(ev === 1 ? 1 : 0);
          }
        }
        return { label: datasetName(table, ds), time, event };
      }),
      conf,
      // Pairwise multiple comparisons of the curves (≥3 groups): log-rank per pair + correction.
      ...(params.pairwise ? { pairwise: true, pairwiseMethod: params.pairwiseMethod ?? "holm-sidak" } : {}),
    };
  }
  // Mixed (split-plot) ANOVA — the selected datasets are the groups (between subjects), the rows are the time
  // points (within subjects), and each replicate subcolumn of a dataset is one subject measured down the rows. A
  // blank cell is sent as null; the engine leaves that subject out (complete cases) and says how many.
  if (method === "mixedanova") {
    const xcol = table.columns[0]?.id;
    // A row blank in every chosen dataset is not a time point (a spare row at the foot of the sheet): without this,
    // every subject would miss it and be left out.
    const rows = table.rows.filter((row) => cols.some((ds) => replicateColumns(table, ds).some((c) => numericCell(row.cells[c]) !== null)));
    return {
      groups: cols.map((ds) => ({
        label: datasetName(table, ds),
        subjects: replicateColumns(table, ds).map((c) => rows.map((row) => numericCell(row.cells[c]))),
      })),
      timeLabels: rows.map((row, i) => String((xcol ? row.cells[xcol] : null) ?? `Time ${i + 1}`)),
      ...(params.compare ? { compare: params.compare } : {}),
    };
  }
  // two-way ANOVA — factor A = rows (X-column levels), factor B = the selected
  // datasets; each cell = that dataset's replicate values at the row (balanced).
  if (method === "twoway") {
    const xcol = table.columns[0]?.id;
    const rows = table.rows
      .map((row) => ({
        label: xcol ? row.cells[xcol] ?? "" : "",
        cells: cols.map((ds) =>
          replicateColumns(table, ds)
            .map((c) => numericCell(row.cells[c]))
            .filter((v): v is number => v !== null),
        ),
      }))
      .filter((r) => r.cells.some((cell) => cell.length > 0));
    return {
      cells: rows.map((r) => r.cells),
      rowLabels: rows.map((r) => String(r.label)),
      colLabels: cols.map((c) => datasetName(table, c)),
      // Post-hoc multiple comparisons (opt-in): `compare` picks the family, `posthoc`
      // the test. Absent ⇒ the engine returns only the ANOVA table (back-compatible).
      ...(params.compare ? { compare: params.compare } : {}),
      ...(params.posthoc ? { posthoc: params.posthoc } : {}),
      ...(params.scheme ? { scheme: params.scheme } : {}),
      ...(params.control != null ? { control: params.control } : {}),
      ...(params.pairs ? { pairs: params.pairs } : {}),
      conf,
    };
  }
  // contingency — each selected column is a category column of counts; rows are the
  // other category. Cells default to 0; all-zero rows are dropped (blank grid rows).
  if (method === "contingency") {
    const matrix = table.rows
      .map((row) => cols.map((c) => numericCell(row.cells[c]) ?? 0))
      .filter((r) => r.some((v) => v !== 0));
    // variant "independent" (default) → χ²/Fisher/risk toolkit; "paired" → McNemar.
    // ciMethod "score" (Koopman RR + Newcombe risk-diff, default) or "log" (Katz + Wald).
    return { table: matrix, variant: params.variant ?? "independent", conf,
      ...(params.ciMethod ? { ciMethod: params.ciMethod } : {}) };
  }
  // equivalence (TOST) — same group shapes as the t test, plus the bound. Handled
  // before the t-test block since it shares c0/c1 but carries its own parameters.
  if (method === "equivalence") {
    const variant = params.variant ?? "unpaired";
    const bounds = {
      ...(params.bound != null ? { bound: params.bound } : {}),
      ...(params.boundMode ? { boundMode: params.boundMode } : {}),
      ...(params.boundLow != null ? { boundLow: params.boundLow } : {}),
      ...(params.boundHigh != null ? { boundHigh: params.boundHigh } : {}),
      ...(params.alpha != null ? { alpha: params.alpha } : {}),
      ...(params.pooled ? { pooled: true } : {}),
    };
    if (variant === "one-sample") return { variant, a: vals(c0), mu: params.mu ?? 0, ...bounds };
    // Paired needs row-aligned complete pairs for the same reason the paired t does:
    // pooling each column independently would silently misalign the pairing.
    if (variant === "paired") {
      const repsA = replicateColumns(table, c0!);
      const repsB = replicateColumns(table, c1!);
      const a: number[] = [];
      const b: number[] = [];
      for (const row of table.rows) {
        for (let k = 0; k < Math.min(repsA.length, repsB.length); k++) {
          const av = numericCell(row.cells?.[repsA[k]!]);
          const bv = numericCell(row.cells?.[repsB[k]!]);
          if (av !== null && bv !== null) { a.push(av); b.push(bv); }
        }
      }
      return { variant, a, b, ...bounds };
    }
    return { variant, a: vals(c0), b: vals(c1), ...bounds };
  }
  // bayesfactor — the same group shapes as the t test, plus the prior scale.
  if (method === "bayesfactor") {
    const variant = params.variant ?? "unpaired";
    const opts = params.rscale != null ? { rscale: params.rscale } : {};
    if (variant === "one-sample") return { variant, a: vals(c0), mu: params.mu ?? 0, ...opts };
    if (variant === "paired") {
      // Paired needs row-aligned pairs, exactly as the paired t test does.
      const repsA = replicateColumns(table, c0!);
      const repsB = replicateColumns(table, c1!);
      const a: number[] = [];
      const b: number[] = [];
      for (const row of table.rows) {
        for (let k = 0; k < Math.min(repsA.length, repsB.length); k++) {
          const av = numericCell(row.cells?.[repsA[k]!]);
          const bv = numericCell(row.cells?.[repsB[k]!]);
          if (av !== null && bv !== null) { a.push(av); b.push(bv); }
        }
      }
      return { variant, a, b, ...opts };
    }
    return { variant, a: vals(c0), b: vals(c1), ...opts };
  }
  // permutation — the same group shapes as the t test, plus the resampling controls.
  if (method === "permutation") {
    const variant = params.variant ?? "unpaired";
    const opts = {
      tail: params.tail ?? "two-sided",
      ...(params.nResamples != null ? { nResamples: params.nResamples } : {}),
      ...(params.seed != null ? { seed: params.seed } : {}),
      ...(params.statistic ? { statistic: params.statistic } : {}),
    };
    if (variant === "one-sample") return { variant, a: vals(c0), mu: params.mu ?? 0, ...opts };
    // Paired and correlation both consume row-aligned pairs: paired flips the sign of
    // each difference, correlation re-pairs Y against X. Pooling the columns
    // independently would break the row correspondence both of them depend on.
    if (variant === "paired" || variant === "correlation") {
      const repsA = replicateColumns(table, c0!);
      const repsB = replicateColumns(table, c1!);
      const a: number[] = [];
      const b: number[] = [];
      for (const row of table.rows) {
        for (let k = 0; k < Math.min(repsA.length, repsB.length); k++) {
          const av = numericCell(row.cells?.[repsA[k]!]);
          const bv = numericCell(row.cells?.[repsB[k]!]);
          if (av !== null && bv !== null) { a.push(av); b.push(bv); }
        }
      }
      return { variant, a, b, ...opts };
    }
    return { variant, a: vals(c0), b: vals(c1), ...opts };
  }
  // ttest — c0/c1 are datasets (groups)
  const tail = params.tail ?? "two-sided";
  if (params.variant === "one-sample" || params.variant === "wilcoxon-1samp")
    return { variant: params.variant, a: vals(c0), mu: params.mu ?? 0, conf, tail };
  // Paired variants (paired t / Wilcoxon signed-rank / ratio-paired t) need row-aligned
  // complete pairs: pooling each column independently (datasetValues) drops interior blanks
  // per column, so blanks in different rows would silently misalign the pairing. Pair the
  // k-th replicate of each dataset row-by-row and keep only pairs finite on both sides.
  // "ratio-paired" is the name the dialog sends and the engine reads; without it in this condition
  // a ratio-paired run would pool each column and pair mismatched rows.
  if (params.variant === "paired" || params.variant === "wilcoxon" || params.variant === "ratio-paired") {
    const repsA = replicateColumns(table, c0!);
    const repsB = replicateColumns(table, c1!);
    const a: number[] = [];
    const b: number[] = [];
    for (const row of table.rows) {
      for (let k = 0; k < Math.min(repsA.length, repsB.length); k++) {
        const va = numericCell(row.cells[repsA[k]!]);
        const vb = numericCell(row.cells[repsB[k]!]);
        if (va !== null && vb !== null) { a.push(va); b.push(vb); }
      }
    }
    return { variant: params.variant, a, b, conf, tail };
  }
  return { variant: params.variant ?? "unpaired", a: vals(c0), b: vals(c1), conf, tail };
}
