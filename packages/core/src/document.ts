import { CommandStack } from "./command";
import { buildAnalysisData } from "./analysisData";
import { remapPlotIds } from "./remapPlotRefs";
import { daysToISO, formatElapsed, parseCellInput, remapCellFills, remapCellPatterns, remapExcluded } from "./cells";
import type { DateOrder } from "./cells";
import { deliberateNoop, unresolvedTarget } from "./strict";

/** Builder-owned reference lines whose label is a renamable readout (the line itself sits at
 *  a computed statistic, so it stays locked). Bland-Altman bias / limits of agreement. */
/**
 * Is this id one of the app's builder-made reference lines?
 *
 * Asked of the registry, not of a regex. A pattern covering only the three Bland-Altman ids
 * would leave every other registered line (the Manhattan thresholds, the volcano cut-offs, the
 * PCA origin lines, the ROC diagonal…) with its caption drag refused by `unresolvedTarget`,
 * which is a silent no-op to the user: the label shows a move cursor and never moves. A
 * hand-kept copy of a list that already exists can only drift.
 */
const isRefLineId = (id: string): boolean => isReferenceLine(id);
import { recomputeDerived, remapDerivationColumns, tableToNamedTable } from "./derive";
import { replaceInCell, type FindReplaceSpec } from "./dataprocess";
import { recomputeFormulas, remapFormulaColumns } from "./formula";
import { ciMultiplier, summarize } from "./stats";
import { drawableErrorTypes, kindHasLeadColumn, naturalErrorType, newDatasetColumns, nextColumnName, tableDatasets, xColumn, xErrorColumn } from "./dataset";
import { tableFormat } from "./tableFormats";
import type { EntryMode } from "./dataset";
import { IdFactory } from "./ids";
import { canJoinLegend, CURRENT_SCHEMA_VERSION, emptyWorkspace, isArrangeableAnnotation, rowOverrideKey } from "./model";
import { isReferenceLine } from "./refLines";
import { arrangeBoxes } from "./arrange";
import { deriveSplitCopy, sameJson, splitRefusal, type SplitPins } from "./splitCopies";
import type { AlignOp, Box } from "./arrange";
import { collectIds } from "./persist";
import type { StylePreset } from "./presets";
import type { SimulateSpec } from "./simulate";
import type {
  Analysis,
  CellPattern,
  Lineage,
  LineageEdge,
  LineageNode,
  AnalysisParams,
  AnalysisResult,
  Gradient,
  MethodSpec,
  LinkedSource,
  AxisScale,
  AxisSpec,
  BarLayout,
  BarShape,
  BoxWhisker,
  FrameStyle,
  TickDir,
  Annotation,
  FontElement,
  FontSpec,
  LegendSpec,
  LogEntry,
  PlotKind,
  LogKind,
  WorkspaceObjectKind,
  CellValue,
  Column,
  ColumnType,
  DataTable,
  Experiment,
  FigureLayout,
  GridStyle,
  NodeId,
  Plot,
  PlotFit,
  PyramidStyle,
  PcaStyle,
  RocCurve,
  PcaGraphData,
  SurvivalCurve,
  SurvivalAtRisk,
  SurvivalTimeUnit,
  Project,
  ProjectFolder,
  Row,
  SeriesStyle,
  SymbolShape,
  SignificanceStyle,
  StyleDelta,
  TableDerivation,
  TableKind,
  Workspace,
  WorkspaceRef,
  WorkspaceTarget,
} from "./model";

/**
 * MadyDocument — owns a Project and provides the behaviour over it: a reactive
 * dependency edge (DataTable → Plot) where data edits mark dependent plots
 * `stale`, command-backed mutations (undo/redo), and style overrides keyed by
 * stable row identity so they survive reorders and recompute.
 */
export interface AnalysisRun {
  readonly analysisId: NodeId;
  readonly method: string;
  readonly data: Record<string, unknown>;
}

export class MadyDocument {
  private readonly ids = new IdFactory();
  readonly commands = new CommandStack();
  private project: Project;
  private resultSequence = 0;
  private readonly analysisRuns = new Map<NodeId, { run: AnalysisRun; analysis: Analysis; fingerprint: string }>();

  constructor(project?: Project) {
    this.project = project ?? {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      tables: [],
      plots: [],
      analyses: [],
      log: [],
      workspace: emptyWorkspace(),
    };
    // Loaded doc: advance the id factory past existing ids so new nodes don't collide.
    if (project) this.ids.seed(collectIds(project));
    for (const a of this.project.analyses) this.resultSequence = Math.max(this.resultSequence, a.resultVersion ?? 0);
  }

  /** The live, serializable project (JSON.stringify-able). */
  toJSON(): Project {
    return this.project;
  }

  // --- tables -------------------------------------------------------------

  /**
   * `roles` (parallel to `columnNames`) tags the seeded columns. The column format uses it to
   * seed without a lead column — every group column tagged `"y"`, so there is no leading label column and
   * `xColumn()` picks no implicit X. An untagged seed keeps the legacy col-0-is-X meaning.
   */
  addTable(name: string, kind: TableKind, columnNames: string[], roles?: ReadonlyArray<Column["role"] | undefined>): DataTable {
    const columns: Column[] = columnNames.map((columnName, i) => ({
      id: this.ids.next("col"),
      name: columnName,
      ...(roles?.[i] ? { role: roles[i] } : {}),
    }));
    const table: DataTable = { id: this.ids.next("tbl"), kind, name, columns, rows: [] };
    const ref: WorkspaceRef = { kind: "table", id: table.id };
    this.commands.execute({
      label: `Add table "${name}"`,
      do: () => {
        this.project.tables.push(table);
        this.project.workspace.loose.push(ref);
      },
      undo: () => {
        this.project.tables = this.project.tables.filter((t) => t.id !== table.id);
        this.unfileRef(ref);
      },
    });
    return table;
  }

  /**
   * Create a fully-populated table from imported data in one
   * undoable command: columns + rows (with stable ids) land together, and undo
   * removes the whole table. Files the new table to `loose` like `addTable`; the
   * caller re-files it into a folder/experiment if desired.
   */
  importTable(
    name: string,
    kind: TableKind,
    columnNames: string[],
    rows: ReadonlyArray<ReadonlyArray<CellValue>>,
    columnTypes?: ReadonlyArray<ColumnType | undefined>,
  ): DataTable {
    const columns: Column[] = columnNames.map((columnName, i) => ({
      id: this.ids.next("col"),
      name: columnName,
      ...(columnTypes?.[i] ? { type: columnTypes[i] } : {}),
    }));
    const tableRows: Row[] = rows.map((values) => {
      const cells: Record<NodeId, CellValue> = {};
      columns.forEach((column, index) => {
        cells[column.id] = values[index] ?? null;
      });
      return { id: this.ids.next("row"), cells };
    });
    const table: DataTable = { id: this.ids.next("tbl"), kind, name, columns, rows: tableRows };
    const ref: WorkspaceRef = { kind: "table", id: table.id };
    this.commands.execute({
      label: `Import "${name}"`,
      do: () => {
        this.project.tables.push(table);
        this.project.workspace.loose.push(ref);
      },
      undo: () => {
        this.project.tables = this.project.tables.filter((t) => t.id !== table.id);
        this.unfileRef(ref);
      },
    });
    return table;
  }

  // --- linked / auto-updating import --------------------------------------

  /** Flag (or clear, with `undefined`) a linked table's last auto-read failure. Not undoable
   *  — it's transient UI state that tracks the file, not a document edit. */
  setLinkError(tableId: NodeId, error: string | undefined): void {
    const table = this.project.tables.find((t) => t.id === tableId);
    if (table) table.linkError = error;
  }

  /** Set (or clear, with `undefined`) a table's live link to its source file. Undoable. */
  setTableLink(tableId: NodeId, link: LinkedSource | undefined): void {
    const table = this.requireTable(tableId);
    const prev = table.linkedSource;
    this.commands.execute({
      label: link ? "Link table to file" : "Unlink table",
      do: () => {
        table.linkedSource = link;
      },
      undo: () => {
        table.linkedSource = prev;
      },
    });
  }

  /**
   * Replace a linked table's data from a re-read of its source file, preserving
   * column and row ids by position — so plots / analyses / derived tables that
   * reference those columns stay valid, and per-row state keyed by row id survives
   * (excluded cells `table.excluded`, per-point styles, value-label offsets). Names
   * update; file-backed columns/rows are added / dropped to match the new shape. A
   * user's calculated (formula) columns are kept in place and never receive file data,
   * so they're neither dropped nor overwritten. Marks dependents stale so the reactive
   * chain recomputes. Undoable.
   *
   * Returns what happened so the caller can react:
   *  - `"empty"`   — refused a zero-width read (a non-atomic writer caught mid-save):
   *                  applying it would wipe the table + reissue every column id, so the
   *                  data is left untouched and the next good read refreshes.
   *  - `"structural"` — the file's columns changed (added / removed / renamed / reordered)
   *                  vs. the last read. Applying would silently re-bind plots/analyses to
   *                  different data, so it is not applied unless `opts.force`;
   *                  the caller flags it for review (auto-refresh) or confirms (manual).
   *  - `"applied"` — the refresh was applied.
   */
  relinkTableData(
    tableId: NodeId,
    grid: { columnNames: string[]; rows: ReadonlyArray<ReadonlyArray<CellValue>> },
    opts?: { force?: boolean },
  ): "applied" | "empty" | "structural" {
    const table = this.requireTable(tableId);
    const fileNames = grid.columnNames;
    if (fileNames.length === 0 && table.columns.length > 0) return "empty";
    const prevCols = table.columns;
    const prevRows = table.rows;
    // Structural change: the file's columns no longer match the previous file-backed
    // columns (name+order). A pure value refresh (same names) applies silently; a changed
    // shape must not silently re-bind bound plots to different data — signal the caller.
    const prevFileNames = prevCols.filter((c) => !c.formula).map((c) => c.name);
    const structural = prevFileNames.length !== fileNames.length || prevFileNames.some((n, i) => n !== fileNames[i]);
    if (structural && !opts?.force) return "structural";
    // Rebuild the columns. A user's calculated (formula) column is theirs, not the file's:
    // keep it in place with its id + formula, and let the file's columns fill only the
    // file-backed (non-formula) slots, in order. This stops a formula column from being
    // silently dropped when the file is narrower, and stops a stale formula from landing on
    // — and overwriting — a file column's real values. Reaching
    // here means the shape matched (or the user forced it), so a positional fill is safe.
    const columns: Column[] = [];
    const fileSlot: Array<number | null> = []; // per new column: its file value index, or null (formula → computed)
    let fi = 0;
    for (const prev of prevCols) {
      if (prev.formula) {
        columns.push({ ...prev }); // preserve the calc column where the user put it
        fileSlot.push(null);
      } else if (fi < fileNames.length) {
        columns.push({ ...prev, name: fileNames[fi]! }); // file-backed slot ← next file column
        fileSlot.push(fi);
        fi++;
      }
      // else: a file-backed column with no file column left → the file got narrower; drop it.
    }
    for (; fi < fileNames.length; fi++) {
      columns.push({ id: this.ids.next("col"), name: fileNames[fi]! }); // extra file columns append
      fileSlot.push(fi);
    }
    const rows: Row[] = grid.rows.map((values, r) => {
      const cells: Record<NodeId, CellValue> = {};
      columns.forEach((c, i) => {
        const slot = fileSlot[i];
        cells[c.id] = slot == null ? null : (values[slot] ?? null); // formula cells recompute below
      });
      // Reuse the row id at this position so anything keyed by it survives the refresh
      // (a fresh id here would orphan every excluded cell, so a
      // deliberately-excluded outlier would silently re-enter the mean/SD/analysis). Trailing
      // new rows get a fresh id.
      return { id: prevRows[r] ? prevRows[r]!.id : this.ids.next("row"), cells };
    });
    this.commands.execute({
      label: "Refresh linked data",
      do: () => {
        table.columns = columns;
        table.rows = rows;
        recomputeFormulas(table);
        this.markDependentsStale(tableId);
      },
      undo: () => {
        table.columns = prevCols;
        table.rows = prevRows;
        this.markDependentsStale(tableId);
      },
    });
    return "applied";
  }

  /**
   * Create a *derived* table (a live Transform/Reshape/… result) bound to a
   * source by a `TableDerivation`: the initial grid is computed now from the
   * source's current values, and the stored `derivation` edge makes it recompute
   * whenever the source changes — see `markDependentsStale` + `recomputeStaleDerived`.
   * Undoable; filed loose like `importTable`. The same reactive recomputation that keeps
   * graphs and analyses current, applied to data manipulation.
   */
  deriveTable(name: string, derivation: TableDerivation): DataTable {
    const source = this.requireTable(derivation.source);
    const grid = recomputeDerived(derivation, tableToNamedTable(source));
    const columns: Column[] = grid.columnNames.map((columnName) => ({ id: this.ids.next("col"), name: columnName }));
    const rows: Row[] = grid.rows.map((values) => {
      const cells: Record<NodeId, CellValue> = {};
      columns.forEach((column, index) => {
        cells[column.id] = values[index] ?? null;
      });
      return { id: this.ids.next("row"), cells };
    });
    // A long→wide reshape can produce a real two-factor (grouped) or one-factor (column) table, so
    // it carries the format the user chose in the reshape dialog — otherwise tidy/long data pivots
    // to a bare `xy` sheet and never reaches two-way ANOVA etc. Every other derivation stays `xy`.
    const kind: TableKind =
      derivation.op === "reshape" && derivation.spec.mode === "long-to-wide" && derivation.spec.resultKind
        ? derivation.spec.resultKind
        : "xy";
    const table: DataTable = { id: this.ids.next("tbl"), kind, name, columns, rows, derivation, status: "ok" };
    const ref: WorkspaceRef = { kind: "table", id: table.id };
    this.commands.execute({
      label: `Derive "${name}"`,
      do: () => {
        this.project.tables.push(table);
        this.project.workspace.loose.push(ref);
      },
      undo: () => {
        this.project.tables = this.project.tables.filter((t) => t.id !== table.id);
        this.unfileRef(ref);
      },
    });
    return table;
  }

  /**
   * Create a simulated data table from a seeded spec. Unlike a derived
   * table it has no source — the `simulate` derivation carries the spec + seed so the
   * table is reproducible/regenerable and round-trips in the `.mady` file. (`source`
   * is a sentinel; a simulated table never reactively recomputes off a source edit.)
   */
  simulateTable(name: string, spec: SimulateSpec): DataTable {
    const derivation: TableDerivation = { source: "", op: "simulate", spec };
    const grid = recomputeDerived(derivation, { columnNames: [], rows: [] });
    const columns: Column[] = grid.columnNames.map((columnName) => ({ id: this.ids.next("col"), name: columnName }));
    const rows: Row[] = grid.rows.map((values) => {
      const cells: Record<NodeId, CellValue> = {};
      columns.forEach((column, index) => {
        cells[column.id] = values[index] ?? null;
      });
      return { id: this.ids.next("row"), cells };
    });
    const table: DataTable = { id: this.ids.next("tbl"), kind: spec.kind === "column" ? "column" : "xy", name, columns, rows, derivation, status: "ok" };
    const ref: WorkspaceRef = { kind: "table", id: table.id };
    this.commands.execute({
      label: `Simulate "${name}"`,
      do: () => {
        this.project.tables.push(table);
        this.project.workspace.loose.push(ref);
      },
      undo: () => {
        this.project.tables = this.project.tables.filter((t) => t.id !== table.id);
        this.unfileRef(ref);
      },
    });
    return table;
  }

  /** A derived table's recompute status (`"ok"` for a normal source table). */
  tableStatus(tableId: NodeId): "ok" | "stale" {
    return this.requireTable(tableId).status ?? "ok";
  }

  /**
   * Regenerate one derived table from its source's current values and clear its
   * stale flag. Not undoable — a derived value, like `setAnalysisResult` (undo of
   * the *source* edit re-marks it stale, then this recomputes again). Column ids
   * are preserved when the column count is unchanged so dependent plots keep their
   * series bindings; only cell values + the row set are refreshed. No-op on a
   * non-derived table or when the source has gone.
   */
  recomputeDerivedTable(tableId: NodeId): void {
    const table = this.requireTable(tableId);
    if (!table.derivation) return;
    const source = this.project.tables.find((t) => t.id === table.derivation!.source);
    if (!source) return;
    const grid = recomputeDerived(table.derivation, tableToNamedTable(source));
    let columns: Column[];
    if (grid.columnNames.length === table.columns.length) {
      columns = table.columns.map((c, i) => ({ ...c, name: grid.columnNames[i] ?? c.name }));
    } else {
      columns = grid.columnNames.map((columnName) => ({ id: this.ids.next("col"), name: columnName }));
    }
    const rows: Row[] = grid.rows.map((values) => {
      const cells: Record<NodeId, CellValue> = {};
      columns.forEach((column, index) => {
        cells[column.id] = values[index] ?? null;
      });
      return { id: this.ids.next("row"), cells };
    });
    table.columns = columns;
    table.rows = rows;
    table.status = "ok";
    // A derived table is itself a source — its own dependents may now be stale.
    this.markDependentsStale(tableId);
  }

  /**
   * Recompute every stale derived table, sources before dependents (so a
   * derived-of-derived chain settles in one call). Call after a data edit to keep
   * the live manipulation chain current. Bounded passes guard a malformed graph.
   */
  recomputeStaleDerived(): void {
    const limit = this.project.tables.length + 1;
    for (let pass = 0; pass < limit; pass++) {
      const next = this.project.tables.find(
        (t) =>
          t.derivation != null &&
          t.status === "stale" &&
          // Recompute upstream first: skip while this table's source is itself a stale derived table.
          !this.project.tables.some(
            (s) => s.id === t.derivation!.source && s.derivation != null && s.status === "stale",
          ),
      );
      if (!next) break;
      this.recomputeDerivedTable(next.id);
    }
  }

  addRow(tableId: NodeId, values: CellValue[]): Row {
    const table = this.requireTable(tableId);
    const cells: Record<NodeId, CellValue> = {};
    table.columns.forEach((column, index) => {
      cells[column.id] = values[index] ?? null;
    });
    const row: Row = { id: this.ids.next("row"), cells };
    this.commands.execute({
      label: "Add row",
      do: () => {
        table.rows.push(row);
        this.markDependentsStale(tableId);
      },
      undo: () => {
        table.rows = table.rows.filter((r) => r.id !== row.id);
        this.markDependentsStale(tableId);
      },
    });
    return row;
  }

  setCell(tableId: NodeId, rowId: NodeId, columnId: NodeId, value: CellValue): void {
    const table = this.requireTable(tableId);
    const row = table.rows.find((r) => r.id === rowId);
    if (!row) throw new Error(`row ${rowId} not found in table ${tableId}`);
    const previous = row.cells[columnId] ?? null;
    this.commands.execute({
      label: "Edit cell",
      do: () => {
        row.cells[columnId] = value;
        this.markDependentsStale(tableId);
      },
      undo: () => {
        row.cells[columnId] = previous;
        this.markDependentsStale(tableId);
      },
    });
  }

  reorderRows(tableId: NodeId, orderedRowIds: NodeId[]): void {
    const table = this.requireTable(tableId);
    const before = table.rows;
    const byId = new Map(before.map((r) => [r.id, r] as const));
    if (orderedRowIds.length !== before.length) {
      throw new Error("reorderRows must list every row exactly once");
    }
    const after = orderedRowIds.map((id) => {
      const r = byId.get(id);
      if (!r) throw new Error(`row ${id} not in table ${tableId}`);
      return r;
    });
    this.commands.execute({
      label: "Reorder rows",
      do: () => {
        table.rows = after;
        this.markDependentsStale(tableId);
      },
      undo: () => {
        table.rows = before;
        this.markDependentsStale(tableId);
      },
    });
  }

  // --- spreadsheet editing ----------------------------------------------

  /** Append a column. New columns become data series on graphs mapped here.
   *  On a table whose datasets have sub-columns (replicates, or a summary format's SD / N …)
   *  this appends a whole new group with the same shape — see `newDatasetColumns`. Returns the
   *  group's lead column. */
  addColumn(tableId: NodeId, name?: string): Column {
    const table = this.requireTable(tableId);
    const columns = newDatasetColumns(table, name ?? nextColumnName(table), () => this.ids.next("col"));
    const ids = new Set(columns.map((c) => c.id));
    this.commands.execute({
      label: "Add column",
      do: () => {
        table.columns.push(...columns);
        this.markDependentsStale(tableId);
      },
      undo: () => {
        table.columns = table.columns.filter((c) => !ids.has(c.id));
        this.markDependentsStale(tableId);
      },
    });
    return columns[0]!;
  }

  /** Insert a blank row at `index` (clamped 0..rows); shifts later rows down. Undoable; dependents stale. */
  insertRow(tableId: NodeId, index: number): void {
    this.mutateTable(tableId, "Insert row", (table) => {
      const i = Math.max(0, Math.min(table.rows.length, Math.floor(index)));
      table.rows.splice(i, 0, { id: this.ids.next("row"), cells: {} });
    });
  }

  /** Delete the row at `index` (no-op if out of range). Undoable; dependents stale. */
  deleteRow(tableId: NodeId, index: number): void {
    this.mutateTable(tableId, "Delete row", (table) => {
      const i = Math.floor(index);
      if (i < 0 || i >= table.rows.length) return;
      table.rows.splice(i, 1);
    });
  }

  /** Insert a blank column at `index` (clamped 0..cols); shifts later columns right. Undoable; dependents stale.
   *  On a table whose datasets have sub-columns this inserts a whole new group (same shape as the
   *  others), and the index snaps to a group boundary: "insert left" of any column of a group lands
   *  before that group, "insert right" after it — never between a group's replicates. */
  insertColumn(tableId: NodeId, index: number): void {
    const table = this.requireTable(tableId);
    let at = Math.max(0, Math.min(table.columns.length, Math.floor(index)));
    const columns = newDatasetColumns(table, nextColumnName(table), () => this.ids.next("col"));
    // A data group never lands left of the lead (X / label) column — "insert left" on the label
    // column puts the group right after it instead (otherwise the sheet would read Group 3 ·
    // Labels · Control…). Plain one-column inserts keep their freedom (a legacy sheet's column 0
    // is its X, and inserting before it deliberately makes a new X).
    const lead = xColumn(table);
    const leadIdx = lead ? table.columns.indexOf(lead) : -1;
    if (columns.length > 1 && leadIdx >= 0 && at <= leadIdx) at = leadIdx + 1;
    if (columns.length > 1 && at < table.columns.length) {
      // Snap into a boundary: the group the target column belongs to spans [first, last].
      const target = table.columns[at]!;
      const key = target.group ?? target.id;
      const members = table.columns.map((c, i) => ((c.group ?? c.id) === key ? i : -1)).filter((i) => i >= 0);
      const first = members[0]!;
      const last = members[members.length - 1]!;
      // Asked to insert at the group's first column → before it; anywhere else inside → after it.
      at = at === first ? first : last + 1;
    }
    const k = columns.length;
    // Everything at or after the insertion point shifts right by the number of columns added.
    this.mutateTableColumns(tableId, "Insert column", (i) => (i >= at ? i + k : i), (t) => {
      t.columns.splice(at, 0, ...columns);
    });
  }

  /** Move the row at `from` to index `to` (drag-reorder); clamped, no-op if equal. Undoable; dependents stale. */
  moveRow(tableId: NodeId, from: number, to: number): void {
    this.mutateTable(tableId, "Move row", (table) => {
      const n = table.rows.length;
      const f = Math.floor(from);
      const t = Math.max(0, Math.min(n - 1, Math.floor(to)));
      if (f < 0 || f >= n || f === t) return;
      const [row] = table.rows.splice(f, 1);
      if (row) table.rows.splice(t, 0, row);
    });
  }

  /** Move the column at `from` to index `to` (drag-reorder); clamped, no-op if equal. Undoable; dependents stale. */
  moveColumn(tableId: NodeId, from: number, to: number): void {
    const table = this.requireTable(tableId);
    const n = table.columns.length;
    const f = Math.floor(from);
    const t = Math.max(0, Math.min(n - 1, Math.floor(to)));
    if (f < 0 || f >= n || f === t) return;
    // The moved column lands on `t`; everything it stepped over shifts one place the other way.
    const mapIndex = (i: number): number =>
      i === f ? t : f < t ? (i > f && i <= t ? i - 1 : i) : (i >= t && i < f ? i + 1 : i);
    this.mutateTableColumns(tableId, "Move column", mapIndex, (tbl) => {
      const [col] = tbl.columns.splice(f, 1);
      if (col) tbl.columns.splice(t, 0, col);
    });
  }

  /**
   * Sort the table's rows by one column's values (the datasheet "Sort ascending / descending").
   * Type-aware: two numbers compare numerically, anything else by a natural (numeric-aware)
   * string compare; blanks always sink to the bottom in both directions. Stable for equal keys
   * (JS sort is stable), so a second sort refines the first. Undoable; dependents go stale.
   */
  /**
   * Find & replace in a sheet ("Data ▸ Find & replace…"), in one undoable command: Ctrl+Z puts every cell back.
   * `columnIds` limits it to those columns (undefined = the whole sheet). Returns how many cells changed; with none, no
   * command is recorded and 0 comes back, for the caller to say "no matches". Refused out loud on a sheet made from
   * another (its cells are recomputed from the source, so the edit would vanish) and on a frozen sheet.
   */
  replaceInTable(tableId: NodeId, spec: FindReplaceSpec & { columnIds?: NodeId[] | undefined }): number {
    const table = this.requireTable(tableId);
    if (table.derivation) throw new Error(`“${table.name}” is made from another sheet — find & replace in that sheet instead; a change here would be overwritten.`);
    if (table.frozen) throw new Error(`“${table.name}” is frozen — unfreeze it to edit its cells.`);
    const cols = spec.columnIds ? table.columns.filter((c) => spec.columnIds!.includes(c.id)) : table.columns;
    if (spec.columnIds && cols.length !== spec.columnIds.length) throw new Error(`Find & replace: a chosen column is not in “${table.name}”.`);
    const plan: { row: number; col: NodeId; value: CellValue }[] = [];
    table.rows.forEach((row, ri) => {
      for (const c of cols) {
        const r = replaceInCell(row.cells[c.id] ?? null, spec);
        if (r.changed) plan.push({ row: ri, col: c.id, value: r.value });
      }
    });
    if (plan.length === 0) return 0;
    this.mutateTable(tableId, `Replace “${spec.find}”`, (t) => {
      for (const p of plan) t.rows[p.row]!.cells[p.col] = p.value;
    });
    return plan.length;
  }

  sortRowsByColumn(tableId: NodeId, colId: NodeId, direction: "asc" | "desc"): void {
    this.mutateTable(tableId, "Sort rows", (table) => {
      const dir = direction === "desc" ? -1 : 1;
      const empty = (v: CellValue | undefined): boolean => v == null || v === "";
      table.rows.sort((ra, rb) => {
        const a = ra.cells[colId];
        const b = rb.cells[colId];
        if (empty(a) && empty(b)) return 0;
        if (empty(a)) return 1; // blanks last, regardless of direction
        if (empty(b)) return -1;
        const cmp =
          typeof a === "number" && typeof b === "number"
            ? a - b
            : String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
        return cmp * dir;
      });
    });
  }

  /**
   * Make the column at `index` the table's X (independent / row-label) column — the datasheet's
   * "Use as X axis". One undoable command that (1) clears the `x` role from the previous X,
   * which then reads as an ordinary Y dataset, (2) tags the chosen column `x` and detaches it
   * from any replicate group, and (3) moves it to index 0 so the grouped header (which draws
   * X at physical index 0) and `xColumn()` agree.
   *
   * A bare `moveColumn(index, 0)` is not enough: `xColumn()` returns the role-tagged column
   * first, so on every sheet whose columns carry roles (anything that went through Replicates /
   * Entry — every wizard and gallery sheet) the X would not change, the moved column would become
   * dataset #1, and the header's "X" cell would sit over another column's numbers.
   */
  setXColumn(tableId: NodeId, index: number): void {
    const table = this.requireTable(tableId);
    const n = table.columns.length;
    const f = Math.floor(index);
    if (f < 0 || f >= n) return;
    const target = table.columns[f]!;
    const prevX = xColumn(table);
    if (prevX === target && f === 0) return; // already the X, already first
    // The moved column lands on 0; everything before it shifts right by one.
    const mapIndex = (i: number): number => (i === f ? 0 : i < f ? i + 1 : i);
    this.mutateTableColumns(tableId, "Use as X axis", mapIndex, (tbl) => {
      const col = tbl.columns.find((c) => c.id === target.id)!;
      const old = prevX ? tbl.columns.find((c) => c.id === prevX.id) : undefined;
      if (old && old !== col && old.role === "x") old.role = undefined;
      // A replicate that leaves its group must not leave the group counting it.
      col.role = "x";
      col.group = undefined;
      const from = tbl.columns.indexOf(col);
      if (from > 0) {
        tbl.columns.splice(from, 1);
        tbl.columns.unshift(col);
      }
    });
  }

  /** Delete the column at `index` (and its cells from every row); no-op if out of range. Undoable; dependents stale. */
  deleteColumn(tableId: NodeId, index: number): void {
    const table = this.requireTable(tableId);
    const at = Math.floor(index);
    const removedCol = table.columns[at];
    if (!removedCol) return;
    /**
     * Deleting a group's lead promotes a new lead for the group.
     * The lead column is the dataset: its id names the series, its `name` is the series name,
     * and every sub-column points at it through `group`. Splicing it out alone would leave the
     * sub-columns pointing at a deleted id, so `tableDatasets` would fall back to the first
     * survivor as the "lead" — the series renamed to that survivor's name ("Control·2") and the
     * plot's `seriesStyles[oldLead]` orphaned (colour, error type… all silently lost).
     * Instead the first surviving sub-column is promoted: it takes the group's name and becomes
     * the id every sibling — and every plot map — points at. One undoable command.
     */
    const isLead = !removedCol.group && table.columns.some((c) => c.group === removedCol.id);
    const heir = isLead ? table.columns.find((c) => c.group === removedCol.id) : undefined;
    // The deleted index resolves to null (gone); everything after it shifts left by one.
    this.mutateTableColumns(
      tableId,
      "Delete column",
      (i) => (i === at ? null : i > at ? i - 1 : i),
      (t) => {
        const col = t.columns[at];
        if (!col) return;
        t.columns.splice(at, 1);
        for (const row of t.rows) delete row.cells[col.id];
        if (heir) {
          const h = t.columns.find((c) => c.id === heir.id);
          if (h) {
            h.name = col.name; // the group keeps its name — "Control", not "Control·2"
            h.group = undefined; // it is the lead now
            for (const c of t.columns) if (c.group === col.id) c.group = h.id; // siblings follow
          }
        }
      },
      heir
        ? (plots) => {
            // Carry the series' look to the new lead id — the graph must not change.
            for (const p of plots) {
              if (p.seriesStyles?.[removedCol.id]) {
                const { [removedCol.id]: style, ...rest } = p.seriesStyles;
                p.seriesStyles = { ...rest, [heir.id]: style! };
              }
              if (p.pointStyles) {
                const prefix = `${removedCol.id}:`;
                const next: NonNullable<Plot["pointStyles"]> = {};
                for (const [k, v] of Object.entries(p.pointStyles)) next[k.startsWith(prefix) ? `${heir.id}:${k.slice(prefix.length)}` : k] = v;
                p.pointStyles = next;
              }
            }
          }
        : undefined,
    );
  }

  /**
   * Delete several columns at once (e.g. a whole grouped dataset = its lead +
   * replicate/error subcolumns) as one undoable step. Removing a dataset's columns
   * cascades to its graph series via `markDependentsStale`.
   */
  deleteColumns(tableId: NodeId, indices: number[]): void {
    const table = this.requireTable(tableId);
    const gone = new Set(indices.map((n) => Math.floor(n)).filter((i) => !!table.columns[i]));
    if (gone.size === 0) return;
    // A deleted index resolves to null; a survivor shifts left by however many were removed
    // before it.
    const mapIndex = (i: number): number | null => {
      if (gone.has(i)) return null;
      let shift = 0;
      for (const g of gone) if (g < i) shift++;
      return i - shift;
    };
    this.mutateTableColumns(tableId, "Delete columns", mapIndex, (t) => {
      const ids = new Set([...gone].map((i) => t.columns[i]?.id).filter((id): id is NodeId => Boolean(id)));
      t.columns = t.columns.filter((c) => !ids.has(c.id));
      for (const row of t.rows) for (const id of ids) delete row.cells[id];
    });
  }

  /**
   * Rename a column. Column titles are the single source of truth for axis /
   * legend / results headers — those read the column name live, so the
   * graph's axis title updates automatically. Not a data change → not "stale".
   */
  renameColumn(tableId: NodeId, columnId: NodeId, name: string): void {
    const table = this.requireTable(tableId);
    const column = table.columns.find((c) => c.id === columnId);
    if (!column) throw new Error(`column ${columnId} not found in table ${tableId}`);
    const previous = column.name;
    this.commands.execute({
      label: "Rename column",
      do: () => {
        column.name = name;
      },
      undo: () => {
        column.name = previous;
      },
    });
  }

  /**
   * Set a column's cell type (Number/Date/Elapsed/Text) and reparse its existing cells
   * through the new type. A `date`/`elapsed` column stores a number (days-since-epoch /
   * seconds) that its display derives; without reparsing, "Format → Date" on a text column
   * of date strings (e.g. an Excel import, which arrives as ISO strings) would be a no-op —
   * the strings would stay strings the date type can't read. Reparsing
   * converts each cell via `parseCellInput`, using the value's canonical text as the source
   * (full precision, and the date/elapsed *display* for serials) so no decimals are lost.
   * Undoable — the prior cell values are restored exactly.
   */
  setColumnType(tableId: NodeId, columnId: NodeId, type: ColumnType | undefined, dateOrder?: DateOrder): void {
    const table = this.requireTable(tableId);
    const column = table.columns.find((c) => c.id === columnId);
    if (!column) throw new Error(`column ${columnId} not found in table ${tableId}`);
    const previous = column.type;
    if (previous === type) return; // no-op: type unchanged, cells untouched
    // Canonical source text for a stored value under the old type — never the decimals-
    // clamped display, so a number→text change keeps full precision.
    const sourceText = (v: CellValue): string => {
      if (typeof v !== "number") return String(v);
      if (previous === "date") return daysToISO(v);
      if (previous === "elapsed") return formatElapsed(v);
      return String(v);
    };
    const prior = new Map<NodeId, CellValue>();
    const next = new Map<NodeId, CellValue>();
    for (const row of table.rows) {
      const old = row.cells[columnId] ?? null;
      prior.set(row.id, old);
      next.set(row.id, old == null ? null : parseCellInput(sourceText(old), { type }, { dateOrder }));
    }
    this.commands.execute({
      label: "Set column type",
      do: () => {
        column.type = type;
        for (const row of table.rows) row.cells[columnId] = next.get(row.id) ?? null;
        this.markDependentsStale(tableId);
      },
      undo: () => {
        column.type = previous;
        for (const row of table.rows) row.cells[columnId] = prior.get(row.id) ?? null;
        this.markDependentsStale(tableId);
      },
    });
  }

  /** Set a number column's fixed display decimals (undefined = auto-trim). Presentation. */
  setColumnDecimals(tableId: NodeId, columnId: NodeId, decimals: number | undefined): void {
    const table = this.requireTable(tableId);
    const column = table.columns.find((c) => c.id === columnId);
    if (!column) throw new Error(`column ${columnId} not found in table ${tableId}`);
    const previous = column.decimals;
    this.commands.execute({
      label: "Set column decimals",
      do: () => {
        column.decimals = decimals;
      },
      undo: () => {
        column.decimals = previous;
      },
    });
  }

  /**
   * Append a calculated-variable column (formula column): a read-only column
   * whose cells derive from `formula` (references other columns by letter A/B/…). The
   * cells are materialised now and recomputed on every subsequent table edit (via
   * `markDependentsStale` → `recomputeFormulas`), so it stays live.
   */
  addFormulaColumn(tableId: NodeId, name: string, formula: string): Column {
    const table = this.requireTable(tableId);
    const column: Column = { id: this.ids.next("col"), name: name.trim() || nextColumnName(table), formula };
    this.commands.execute({
      label: "Add calculated column",
      do: () => {
        table.columns.push(column);
        this.markDependentsStale(tableId); // recomputes the new column's cells
      },
      undo: () => {
        table.columns = table.columns.filter((c) => c.id !== column.id);
        this.markDependentsStale(tableId);
      },
    });
    return column;
  }

  /** Set (or clear, with undefined) a column's calculated-variable formula. Clearing keeps
   *  the last computed values as ordinary editable data. Recomputes on change. */
  setColumnFormula(tableId: NodeId, columnId: NodeId, formula: string | undefined): void {
    const table = this.requireTable(tableId);
    const column = table.columns.find((c) => c.id === columnId);
    if (!column) throw new Error(`column ${columnId} not found in table ${tableId}`);
    const previous = column.formula;
    const next = formula && formula.trim() ? formula : undefined;
    this.commands.execute({
      label: next ? "Set column formula" : "Clear column formula",
      do: () => {
        column.formula = next;
        this.markDependentsStale(tableId);
      },
      undo: () => {
        column.formula = previous;
        this.markDependentsStale(tableId);
      },
    });
  }

  /** Freeze / unfreeze a data table (read-only when frozen). Presentation. */
  /**
   * Reinterpret a table as a different format (XY / Column / Grouped /
   * Contingency / Survival / Parts-of-whole / Multiple-variables / Nested). Data
   * is left untouched — only the format label changes, which re-gates the
   * available analyses/graphs and the `validateTable` checks. Dependents go stale
   * (column-role interpretation can differ by format). One undoable command.
   */
  setTableKind(tableId: NodeId, kind: TableKind): void {
    const table = this.requireTable(tableId);
    const previous = table.kind;
    if (previous === kind) return;
    // Reconcile the leading label/X column with the new format so the datasheet structure
    // actually changes (not just the badge). Non-destructive: a blank lead is dropped, a lead
    // that holds data is kept (retagged as a group), and a format that wants a lead but has
    // none gets a fresh blank one.
    const prevCols = table.columns;
    const prevRows = table.rows;
    const prevSurvivalDates = table.survivalDates;
    const { columns, rows } = this.reconcileLeadForKind(table, kind);
    this.commands.execute({
      label: "Change table format",
      do: () => {
        table.kind = kind;
        table.columns = columns;
        table.rows = rows;
        // Date-entry mode belongs to the survival format only.
        if (kind !== "survival") table.survivalDates = undefined;
        this.markDependentsStale(tableId);
      },
      undo: () => {
        table.kind = previous;
        table.columns = prevCols;
        table.rows = prevRows;
        table.survivalDates = prevSurvivalDates;
        this.markDependentsStale(tableId);
      },
    });
  }

  /** Columns/rows adjusted so the layout matches `kind`. Pure — returns new arrays; the
   *  command's do/undo swap them. */
  private reconcileLeadForKind(table: DataTable, kind: TableKind): { columns: Column[]; rows: Row[] } {
    const rows: Row[] = table.rows;
    // A fixed-shape format (association / alterations / meta / timeline / edgelist / sets) is a
    // positional input shape, not a flexible analysis table. Switching a
    // sheet to one must leave it configured with that shape, or it immediately warns "needs these
    // columns" and the user is stranded with the wrong headers. Reconciling only
    // the lead column would leave, say, a 2-column sheet switched to GWAS still showing "Control | Treated"
    // and the "needs Marker, Chromosome, Position and P-value" warning. So a sheet with no data
    // adopts the format's named seed outright (a plain new sheet becomes a proper GWAS / alterations
    // / meta / timeline sheet the moment its format is chosen); a sheet with data keeps every column
    // and appends only the missing tail so the shape is complete (non-destructive).
    const targetFmt = tableFormat(kind);
    if (targetFmt.fixedShape && targetFmt.seedColumns.length > 0) {
      const seedCol = (i: number): Column => ({
        id: this.ids.next("col"),
        name: targetFmt.seedColumns[i]!,
        ...(targetFmt.seedRoles?.[i] ? { role: targetFmt.seedRoles[i] } : {}),
      });
      const hasData = table.rows.some((r) =>
        table.columns.some((c) => {
          const v = r.cells[c.id];
          return v != null && String(v).trim() !== "";
        }),
      );
      if (!hasData) return { columns: targetFmt.seedColumns.map((_n, i) => seedCol(i)), rows };
      const columns: Column[] = table.columns.map((c) => ({ ...c }));
      for (let i = columns.length; i < targetFmt.seedColumns.length; i++) columns.push(seedCol(i));
      return { columns, rows };
    }
    if (kind === "column") {
      // A Column sheet is one column per group — no leading label/X column and no replicate
      // sub-columns (replicates go down the rows). Rebuild straight from the datasets so a switch
      // from grouped/xy collapses the sub-columns and drops the lead in one shot; a fresh sheet
      // becomes just its group columns. Cells for the dropped columns are left on the rows,
      // harmlessly ignored (and restored on undo).
      const byId = new Map(table.columns.map((c) => [c.id, c] as const));
      const columns: Column[] = tableDatasets(table)
        .map((ds) => byId.get(ds.id))
        .filter((c): c is Column => Boolean(c))
        .map((lead) => ({ ...lead, role: "y" as const, group: undefined }));
      // Degenerate table with no datasets → leave it as-is rather than blank it.
      return { columns: columns.length ? columns : table.columns.map((c) => ({ ...c })), rows };
    }
    let columns: Column[] = table.columns.map((c) => ({ ...c }));
    // Leaving the survival format: a `survStart`/`survEnd` date pair is not a Y dataset
    // (tableDatasets skips those roles), so retag them to plain `y` columns or they would
    // vanish from the new format. Their date type and cells are kept (non-destructive).
    if (kind !== "survival") {
      for (const c of columns) if (c.role === "survStart" || c.role === "survEnd") c.role = "y";
    }
    const x = xColumn(table);
    // Formats that don't use replicate sub-columns (contingency, survival, parts-of-whole,
    // multivariable — one value per cell) must not carry any: a switch from a replicate format
    // would otherwise leave Control·2/·3 behind and the sheet would show phantom "replicates".
    // Drop the sub-columns (each has a `group`), keeping every group's lead column + the X.
    if (!tableFormat(kind).replicates) columns = columns.filter((c) => !c.group);
    if (kind !== "multivariable" && kind !== "pca" && kindHasLeadColumn(kind)) {
      // The new format wants a leading label column — add a blank one if there is none.
      if (!x) columns = [{ id: this.ids.next("col"), name: "" }, ...columns];
    } else if (x) {
      // multivariable / pca are lead-less: drop an empty leading X (every column is a variable).
      const xId = x.id;
      const leadEmpty =
        (!x.name || x.name.trim() === "") &&
        table.rows.every((r) => { const v = r.cells[xId]; return v == null || String(v).trim() === ""; });
      if (leadEmpty) columns = columns.filter((c) => c.id !== xId);
    }
    return { columns, rows };
  }

  setTableFrozen(tableId: NodeId, frozen: boolean): void {
    const table = this.requireTable(tableId);
    const previous = table.frozen;
    this.commands.execute({
      label: frozen ? "Freeze table" : "Unfreeze table",
      do: () => {
        table.frozen = frozen;
      },
      undo: () => {
        table.frozen = previous;
      },
    });
  }

  /**
   * Exclude / re-include a set of cells — kept in the table but omitted from
   * analyses, plots and derived tables (the "exclude this value" action). Data-
   * affecting, so dependents go stale. One undoable command.
   */
  setCellsExcluded(tableId: NodeId, cells: ReadonlyArray<{ rowId: NodeId; colId: NodeId }>, excluded: boolean): void {
    if (cells.length === 0) return;
    const table = this.requireTable(tableId);
    const before: Record<NodeId, NodeId[]> | undefined = table.excluded
      ? (JSON.parse(JSON.stringify(table.excluded)) as Record<NodeId, NodeId[]>)
      : undefined;
    const apply = (): void => {
      const map: Record<NodeId, NodeId[]> = {};
      if (table.excluded) for (const k of Object.keys(table.excluded)) map[k] = [...table.excluded[k]!];
      for (const { rowId, colId } of cells) {
        const set = new Set(map[rowId] ?? []);
        if (excluded) set.add(colId);
        else set.delete(colId);
        if (set.size) map[rowId] = [...set];
        else delete map[rowId];
      }
      table.excluded = Object.keys(map).length ? map : undefined;
    };
    this.commands.execute({
      label: excluded ? "Exclude cells" : "Include cells",
      do: () => {
        apply();
        this.markDependentsStale(tableId);
      },
      undo: () => {
        table.excluded = before;
        this.markDependentsStale(tableId);
      },
    });
  }

  /**
   * Set (or clear, with `color: null`) the background colour of a set of cells — a purely visual
   * highlight for organising the sheet. Undoable. Unlike `setCellsExcluded`, this does not mark
   * dependents stale: the colour never reaches an analysis or a graph, so nothing recomputes.
   */
  setCellsFill(tableId: NodeId, cells: ReadonlyArray<{ rowId: NodeId; colId: NodeId }>, color: string | null): void {
    if (cells.length === 0) return;
    const table = this.requireTable(tableId);
    const before: Record<NodeId, Record<NodeId, string>> | undefined = table.cellFills
      ? (JSON.parse(JSON.stringify(table.cellFills)) as Record<NodeId, Record<NodeId, string>>)
      : undefined;
    const apply = (): void => {
      const map: Record<NodeId, Record<NodeId, string>> = {};
      if (table.cellFills) for (const k of Object.keys(table.cellFills)) map[k] = { ...table.cellFills[k]! };
      for (const { rowId, colId } of cells) {
        const row = map[rowId] ?? {};
        if (color) row[colId] = color;
        else delete row[colId];
        if (Object.keys(row).length) map[rowId] = row;
        else delete map[rowId];
      }
      table.cellFills = Object.keys(map).length ? map : undefined;
    };
    this.commands.execute({
      label: color ? "Colour cells" : "Clear cell colour",
      do: apply,
      undo: () => { table.cellFills = before; },
    });
  }

  /** Set (or clear, when `pattern` is null) the pattern overlay of a block of cells. Mirrors
   *  `setCellsFill`: undoable, id-keyed, and the map collapses to undefined when the last one goes. */
  setCellsPattern(tableId: NodeId, cells: ReadonlyArray<{ rowId: NodeId; colId: NodeId }>, pattern: CellPattern | null): void {
    if (cells.length === 0) return;
    const table = this.requireTable(tableId);
    const before: Record<NodeId, Record<NodeId, CellPattern>> | undefined = table.cellPatterns
      ? (JSON.parse(JSON.stringify(table.cellPatterns)) as Record<NodeId, Record<NodeId, CellPattern>>)
      : undefined;
    const apply = (): void => {
      const map: Record<NodeId, Record<NodeId, CellPattern>> = {};
      if (table.cellPatterns) for (const k of Object.keys(table.cellPatterns)) map[k] = { ...table.cellPatterns[k]! };
      for (const { rowId, colId } of cells) {
        const row = map[rowId] ?? {};
        if (pattern) row[colId] = pattern;
        else delete row[colId];
        if (Object.keys(row).length) map[rowId] = row;
        else delete map[rowId];
      }
      table.cellPatterns = Object.keys(map).length ? map : undefined;
    };
    this.commands.execute({
      label: pattern ? "Pattern cells" : "Clear cell pattern",
      do: apply,
      undo: () => { table.cellPatterns = before; },
    });
  }

  /**
   * Set a cell by row + column index, growing the grid as needed (the
   * spreadsheet has no hard edge — editing a spare cell materializes it; new
   * columns become series). One undoable command.
   */
  editCellAt(tableId: NodeId, rowIndex: number, colIndex: number, value: CellValue): void {
    this.mutateTable(tableId, "Edit cell", (table) => {
      this.growTable(table, rowIndex + 1, colIndex + 1);
      const column = table.columns[colIndex]!;
      table.rows[rowIndex]!.cells[column.id] = value;
    });
  }

  /**
   * Paste a 2-D block anchored at (rowStart, colStart), growing rows and columns
   * to fit — so a large table pastes in one undoable action.
   */
  pasteBlock(
    tableId: NodeId,
    rowStart: number,
    colStart: number,
    block: ReadonlyArray<ReadonlyArray<CellValue>>,
  ): void {
    if (block.length === 0) return;
    this.mutateTable(tableId, "Paste", (table) => {
      const width = block.reduce((max, row) => Math.max(max, row.length), 0);
      this.growTable(table, rowStart + block.length, colStart + width);
      block.forEach((rowValues, r) => {
        rowValues.forEach((value, c) => {
          const column = table.columns[colStart + c]!;
          table.rows[rowStart + r]!.cells[column.id] = value;
        });
      });
    });
  }

  /** Clear a rectangle of cells to null (e.g. Delete / Cut). Does not grow the table. */
  clearCells(tableId: NodeId, rowStart: number, colStart: number, rows: number, cols: number): void {
    this.mutateTable(tableId, "Clear cells", (table) => {
      for (let r = rowStart; r < rowStart + rows && r < table.rows.length; r++) {
        for (let c = colStart; c < colStart + cols && c < table.columns.length; c++) {
          table.rows[r]!.cells[table.columns[c]!.id] = null;
        }
      }
    });
  }

  /** Fill the top row of a block down over the rest of the block (Ctrl+D). */
  fillDown(tableId: NodeId, rowStart: number, colStart: number, rows: number, cols: number): void {
    if (rows < 2) return;
    this.mutateTable(tableId, "Fill down", (table) => {
      this.growTable(table, rowStart + rows, colStart + cols);
      for (let c = colStart; c < colStart + cols; c++) {
        const colId = table.columns[c]!.id;
        const top = table.rows[rowStart]!.cells[colId] ?? null;
        for (let r = rowStart + 1; r < rowStart + rows; r++) table.rows[r]!.cells[colId] = top;
      }
    });
  }

  /** Transpose a rectangular block in place: rows×cols → cols×rows at the same anchor. */
  transposeRange(tableId: NodeId, rowStart: number, colStart: number, rows: number, cols: number): void {
    this.mutateTable(tableId, "Transpose", (table) => {
      const span = Math.max(rows, cols);
      this.growTable(table, rowStart + span, colStart + span);
      const block: CellValue[][] = [];
      for (let r = 0; r < rows; r++) {
        const rowVals: CellValue[] = [];
        for (let c = 0; c < cols; c++) {
          rowVals.push(table.rows[rowStart + r]!.cells[table.columns[colStart + c]!.id] ?? null);
        }
        block.push(rowVals);
      }
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) table.rows[rowStart + r]!.cells[table.columns[colStart + c]!.id] = null;
      }
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          table.rows[rowStart + c]!.cells[table.columns[colStart + r]!.id] = block[r]![c]!;
        }
      }
    });
  }

  // --- plots --------------------------------------------------------------

  addPlot(name: string, sourceTableId: NodeId): Plot {
    this.requireTable(sourceTableId);
    const plot: Plot = {
      id: this.ids.next("plt"),
      name,
      source: sourceTableId,
      status: "stale",
      styleOverrides: {},
    };
    const ref: WorkspaceRef = { kind: "plot", id: plot.id };
    this.commands.execute({
      label: `Add plot "${name}"`,
      do: () => {
        this.project.plots.push(plot);
        this.project.workspace.loose.push(ref);
      },
      undo: () => {
        this.project.plots = this.project.plots.filter((p) => p.id !== plot.id);
        this.unfileRef(ref);
      },
    });
    return plot;
  }

  // --- figure layouts (the multi-panel assembler) -------------------------

  /** Every figure layout (lazily-initialised store). */
  private get layouts(): FigureLayout[] {
    return (this.project.layouts ??= []);
  }

  /** Create an empty figure layout and file it loose in the workspace. Undoable.
   *  New figures scale panel fonts by default (a default applies at creation —
   *  figures saved before the option existed keep their absolute-px look). */
  addLayout(name: string): FigureLayout {
    const layout: FigureLayout = { id: this.ids.next("lay"), name, panels: [], panelFontScale: true };
    const ref: WorkspaceRef = { kind: "layout", id: layout.id };
    this.commands.execute({
      label: `Add layout "${name}"`,
      do: () => {
        this.layouts.push(layout);
        this.project.workspace.loose.push(ref);
      },
      undo: () => {
        this.project.layouts = this.layouts.filter((l) => l.id !== layout.id);
        this.unfileRef(ref);
      },
    });
    return layout;
  }

  /**
   * Graph ▸ Split into small graphs: one new graph per series of `plotId`, each showing only its
   * own series, placed in a new figure page laid out in a grid with the axes lined up. Each copy
   * stays linked to the original (`Plot.splitFrom`) and is re-made from it by
   * [[syncSplitCopies]]. `pins` = the original's drawn axis range, so every small graph uses the
   * same scale. Filed next to the original. One undoable command. Refused out loud when the
   * chart has no series to split (see `splitRefusal`).
   */
  splitIntoSmallGraphs(plotId: NodeId, pins?: SplitPins): { layout: FigureLayout; plots: Plot[] } {
    const src = this.requirePlot(plotId);
    const table = this.requireTable(src.source);
    const series = tableDatasets(table);
    const refusal = splitRefusal(src, series.length);
    if (refusal) throw new Error(refusal);
    const plots = series.map((d) => {
      const shell: Plot = { ...src, id: this.ids.next("plt"), name: `${src.name} · ${d.name}`, status: "ok", splitFrom: { plot: src.id, series: d.id } };
      return deriveSplitCopy(src, shell, series, pins);
    });
    const layout: FigureLayout = {
      id: this.ids.next("lay"),
      name: `${src.name} · small graphs`,
      panels: plots.map((p) => p.id),
      panelFontScale: true,
      columns: Math.ceil(Math.sqrt(plots.length)),
      alignX: true,
      alignY: true,
      // Each small graph's title names its series; without it the panels cannot be told apart.
      showPanelTitles: true,
    };
    const where = this.locationOf({ kind: "plot", id: src.id });
    const refs: WorkspaceRef[] = [...plots.map((p) => ({ kind: "plot" as const, id: p.id })), { kind: "layout", id: layout.id }];
    this.commands.execute({
      label: `Split "${src.name}" into small graphs`,
      do: () => {
        this.project.plots.push(...plots);
        this.layouts.push(layout);
        for (const r of refs) insertRef(this.project.workspace, r, where);
      },
      undo: () => {
        const made = new Set(plots.map((p) => p.id));
        this.project.plots = this.project.plots.filter((p) => !made.has(p.id));
        this.project.layouts = this.layouts.filter((l) => l.id !== layout.id);
        for (const r of refs) this.unfileRef(r);
      },
    });
    return { layout, plots };
  }

  /** Detach a small graph from its original: it keeps its present look and becomes an ordinary,
   *  fully editable graph that no longer follows the original. Undoable. */
  detachSmallGraph(plotId: NodeId): void {
    const plot = this.requirePlot(plotId);
    const link = plot.splitFrom;
    if (!link) throw new Error(`"${plot.name}" is not a small graph.`);
    this.commands.execute({
      label: `Detach "${plot.name}"`,
      do: () => { plot.splitFrom = undefined; },
      undo: () => { plot.splitFrom = link; },
    });
  }

  /** The source snapshot each small graph was last made from (not saved; see [[syncSplitCopies]]). */
  private readonly splitStamps = new Map<NodeId, string>();

  /**
   * Re-make every small graph from its original. Call after every change and every undo/redo
   * (the shell's `mutate`), like `recomputeStaleDerived`. Not undoable itself — the copies are
   * derived: undoing the original's edit and re-syncing puts them back.
   *
   * A change made directly on a small graph that is not a position or size would be erased
   * here without a word. So when the original has not changed since the last sync and the copy
   * still differs, the copy was edited directly: the edit is undone and a message comes back
   * for the shell to show. Returns those messages (empty = nothing refused).
   *
   * `pinsOf(original, its sheet)` gives the original's drawn axis range (the graphics layer computes it).
   */
  syncSplitCopies(pinsOf?: (source: Plot, table: DataTable) => SplitPins | undefined): string[] {
    const refused: string[] = [];
    const pinCache = new Map<NodeId, SplitPins | undefined>();
    for (const copy of this.project.plots) {
      const link = copy.splitFrom;
      if (!link) continue;
      const src = this.project.plots.find((p) => p.id === link.plot);
      const table = src && this.project.tables.find((t) => t.id === src.source);
      if (!src || !table) continue; // original gone: the copy stays as it is (undo brings it back)
      if (!pinCache.has(src.id)) pinCache.set(src.id, pinsOf?.(src, table));
      const pins = pinCache.get(src.id);
      const made = deriveSplitCopy(src, copy, tableDatasets(table), pins);
      const stamp = JSON.stringify([src, table, pins]);
      if (!sameJson(made, copy)) {
        if (this.splitStamps.get(copy.id) === stamp) {
          refused.push(`"${copy.name}" is a small graph made from "${src.name}". Only positions and sizes can be changed on it, so that change was undone. Edit "${src.name}" instead, or detach this graph (Graph ▸ Detach small graph) to edit it on its own.`);
        }
        replaceInPlace(copy, made);
      }
      this.splitStamps.set(copy.id, stamp);
    }
    return refused;
  }

  /** A detached deep clone of a plot — a new id + fresh annotation ids, not filed in
   *  the workspace tree (used for unlinked figure panels). */
  private detachClone(src: Plot): Plot {
    const clone: Plot = JSON.parse(JSON.stringify(src));
    clone.id = this.ids.next("plt");
    clone.status = "ok";
    if (clone.annotations) clone.annotations = clone.annotations.map((a) => ({ ...a, id: this.ids.next("ann") }));
    return clone;
  }

  /** Add a graph as a panel of a layout (appended; ignored if already present). When
   *  the figure is unlinked, an independent clone is added instead. Undoable. */
  addLayoutPanel(layoutId: NodeId, plotId: NodeId): void {
    const layout = this.requireLayout(layoutId);
    const src = this.requirePlot(plotId);
    if (layout.linked !== false) {
      if (layout.panels.includes(plotId)) return;
      this.commands.execute({
        label: "Add panel",
        do: () => { if (!layout.panels.includes(plotId)) layout.panels.push(plotId); },
        undo: () => { layout.panels = layout.panels.filter((id) => id !== plotId); },
      });
      return;
    }
    if (Object.values(layout.panelSource ?? {}).includes(plotId)) return; // already included
    const clone = this.detachClone(src);
    const prevSource = layout.panelSource ? { ...layout.panelSource } : undefined;
    this.commands.execute({
      label: "Add panel",
      do: () => {
        this.project.plots.push(clone);
        layout.panels.push(clone.id);
        layout.panelSource = { ...(layout.panelSource ?? {}), [clone.id]: plotId };
      },
      undo: () => {
        this.project.plots = this.project.plots.filter((p) => p.id !== clone.id);
        layout.panels = layout.panels.filter((id) => id !== clone.id);
        layout.panelSource = prevSource;
      },
    });
  }

  /** Remove a panel from a layout — accepts the panel id or (when unlinked) its source
   *  id; drops the clone plot too. Undoable. */
  removeLayoutPanel(layoutId: NodeId, plotId: NodeId): void {
    const layout = this.requireLayout(layoutId);
    let panelId = plotId;
    if (!layout.panels.includes(panelId) && layout.linked === false) {
      panelId = Object.keys(layout.panelSource ?? {}).find((c) => layout.panelSource![c] === plotId) ?? plotId;
    }
    const index = layout.panels.indexOf(panelId);
    if (index < 0) return;
    const isClone = layout.linked === false && !!layout.panelSource?.[panelId];
    const clonePlot = isClone ? this.project.plots.find((p) => p.id === panelId) : undefined;
    const prevSource = layout.panelSource ? { ...layout.panelSource } : undefined;
    const prevPos = layout.panelPositions?.[panelId];
    this.commands.execute({
      label: "Remove panel",
      do: () => {
        layout.panels = layout.panels.filter((id) => id !== panelId);
        if (isClone) {
          this.project.plots = this.project.plots.filter((p) => p.id !== panelId);
          if (layout.panelSource) { const s = { ...layout.panelSource }; delete s[panelId]; layout.panelSource = s; }
          if (layout.panelPositions) { const pp = { ...layout.panelPositions }; delete pp[panelId]; layout.panelPositions = pp; }
        }
      },
      undo: () => {
        layout.panels.splice(index, 0, panelId);
        if (isClone) {
          if (clonePlot) this.project.plots.push(clonePlot);
          layout.panelSource = prevSource;
          if (prevPos) layout.panelPositions = { ...(layout.panelPositions ?? {}), [panelId]: prevPos };
        }
      },
    });
  }

  /**
   * Duplicate a figure panel: the copy lands just below-right of the original
   * at the same size, later in `panels` so it paints on top. Linked figure → a real,
   * workspace-filed copy of the graph (same shape "Duplicate graph" makes); unlinked → another
   * figure-private clone chained to the original source, so re-linking still resolves it.
   * One undoable command. A panel with no stored position/size just appends (grid default).
   */
  duplicateLayoutPanel(layoutId: NodeId, panelId: NodeId): Plot {
    const layout = this.requireLayout(layoutId);
    if (!layout.panels.includes(panelId)) throw new Error(`panel ${panelId} not in layout ${layoutId}`);
    const src = this.requirePlot(panelId);
    const clone = this.detachClone(src);
    clone.name = `${src.name} copy`;
    const linked = layout.linked !== false;
    const ref: WorkspaceRef | null = linked ? { kind: "plot", id: clone.id } : null;
    const srcSource = layout.panelSource?.[panelId] ?? panelId;
    const at = layout.panelPositions?.[panelId];
    const size = layout.panelSizes?.[panelId];
    const card = layout.cardSizes?.[panelId];
    const span = layout.panelSpan?.[panelId];
    const prev = {
      source: layout.panelSource ? { ...layout.panelSource } : undefined,
      positions: layout.panelPositions ? { ...layout.panelPositions } : undefined,
      sizes: layout.panelSizes ? { ...layout.panelSizes } : undefined,
      cards: layout.cardSizes ? { ...layout.cardSizes } : undefined,
      span: layout.panelSpan ? { ...layout.panelSpan } : undefined,
    };
    this.commands.execute({
      label: `Duplicate panel "${src.name}"`,
      do: () => {
        this.project.plots.push(clone);
        if (ref) this.project.workspace.loose.push(ref);
        layout.panels.push(clone.id);
        if (!linked) layout.panelSource = { ...(layout.panelSource ?? {}), [clone.id]: srcSource };
        if (at) layout.panelPositions = { ...(layout.panelPositions ?? {}), [clone.id]: { x: at.x + 24, y: at.y + 24 } };
        if (size) layout.panelSizes = { ...(layout.panelSizes ?? {}), [clone.id]: { ...size } };
        if (card) layout.cardSizes = { ...(layout.cardSizes ?? {}), [clone.id]: { ...card } };
        if (span) layout.panelSpan = { ...(layout.panelSpan ?? {}), [clone.id]: span };
      },
      undo: () => {
        this.project.plots = this.project.plots.filter((p) => p.id !== clone.id);
        if (ref) this.unfileRef(ref);
        layout.panels = layout.panels.filter((id) => id !== clone.id);
        layout.panelSource = prev.source;
        layout.panelPositions = prev.positions;
        layout.panelSizes = prev.sizes;
        layout.cardSizes = prev.cards;
        layout.panelSpan = prev.span;
      },
    });
    return clone;
  }

  /** Link / unlink a figure from its source graphs. Unlinking clones every panel into
   *  an independent plot (edits stay in the figure); linking restores the originals
   *  and discards the clones. Panel positions are remapped across the id change. */
  setLayoutLinked(layoutId: NodeId, linked: boolean): void {
    const layout = this.requireLayout(layoutId);
    const was = layout.linked !== false;
    if (linked === was) return;
    const prev = { panels: [...layout.panels], source: layout.panelSource, positions: layout.panelPositions, linked: layout.linked };
    if (!linked) {
      const created: Plot[] = [];
      const source: Record<NodeId, NodeId> = {};
      const newPanels: NodeId[] = [];
      const positions: Record<NodeId, { x: number; y: number }> = {};
      for (const pid of layout.panels) {
        const src = this.project.plots.find((p) => p.id === pid);
        if (!src) { newPanels.push(pid); continue; }
        const clone = this.detachClone(src);
        created.push(clone);
        newPanels.push(clone.id);
        source[clone.id] = pid;
        if (layout.panelPositions?.[pid]) positions[clone.id] = layout.panelPositions[pid]!;
      }
      this.commands.execute({
        label: "Detach figure from its graphs",
        do: () => {
          for (const c of created) this.project.plots.push(c);
          layout.panels = newPanels;
          layout.linked = false;
          layout.panelSource = source;
          layout.panelPositions = Object.keys(positions).length ? positions : undefined;
        },
        undo: () => {
          this.project.plots = this.project.plots.filter((p) => !created.some((c) => c.id === p.id));
          layout.panels = prev.panels;
          layout.linked = prev.linked;
          layout.panelSource = prev.source;
          layout.panelPositions = prev.positions;
        },
      });
    } else {
      const source = layout.panelSource ?? {};
      const cloneIds = new Set(Object.keys(source));
      // De-duped: a duplicated clone shares its source with the panel it was copied from,
      // and a restored figure must hold each source graph once, not twice.
      const restored: NodeId[] = [];
      for (const pid of layout.panels) {
        const r = source[pid] ?? pid;
        if (!restored.includes(r)) restored.push(r);
      }
      const positions: Record<NodeId, { x: number; y: number }> = {};
      for (const pid of layout.panels) if (layout.panelPositions?.[pid]) positions[source[pid] ?? pid] = layout.panelPositions[pid]!;
      const removed = this.project.plots.filter((p) => cloneIds.has(p.id));
      this.commands.execute({
        label: "Link figure to its graphs",
        do: () => {
          this.project.plots = this.project.plots.filter((p) => !cloneIds.has(p.id));
          layout.panels = restored;
          layout.linked = true;
          layout.panelSource = undefined;
          layout.panelPositions = Object.keys(positions).length ? positions : undefined;
        },
        undo: () => {
          for (const c of removed) this.project.plots.push(c);
          layout.panels = prev.panels;
          layout.linked = prev.linked;
          layout.panelSource = prev.source;
          layout.panelPositions = prev.positions;
        },
      });
    }
  }

  /** Delete a layout (and unfile its workspace ref). Undoable. */
  removeLayout(layoutId: NodeId): void {
    const layout = this.requireLayout(layoutId);
    const ref: WorkspaceRef = { kind: "layout", id: layout.id };
    this.commands.execute({
      label: "Delete layout",
      do: () => {
        this.project.layouts = this.layouts.filter((l) => l.id !== layoutId);
        this.unfileRef(ref);
      },
      undo: () => {
        this.layouts.push(layout);
        this.project.workspace.loose.push(ref);
      },
    });
  }

  /** Edit a layout's arrangement (columns / gutter / lettering / name). Undoable. */
  setLayoutOptions(layoutId: NodeId, patch: Partial<FigureLayout>): void {
    const layout = this.requireLayout(layoutId);
    const keys = Object.keys(patch) as (keyof FigureLayout)[];
    const prev = {} as Partial<FigureLayout>;
    for (const k of keys) prev[k] = layout[k] as never;
    this.commands.execute({
      label: "Edit figure layout",
      do: () => Object.assign(layout, patch),
      undo: () => {
        for (const k of keys) layout[k] = prev[k] as never;
      },
    });
  }

  private requireLayout(layoutId: NodeId): FigureLayout {
    const layout = this.layouts.find((l) => l.id === layoutId);
    if (!layout) throw new Error(`layout ${layoutId} not found`);
    return layout;
  }

  // --- figure-level annotations (objects on the assembler canvas, in canvas px) ---------

  /** Add a free object (text / arrow / line / box / ellipse) to a figure's canvas. Undoable. */
  addLayoutAnnotation(layoutId: NodeId, annotation: Omit<Annotation, "id">): Annotation {
    const layout = this.requireLayout(layoutId);
    const ann: Annotation = { ...annotation, id: this.ids.next("fann") };
    this.commands.execute({
      label: "Add figure object",
      do: () => {
        layout.figureAnnotations = [...(layout.figureAnnotations ?? []), ann];
      },
      undo: () => {
        const next = (layout.figureAnnotations ?? []).filter((a) => a.id !== ann.id);
        layout.figureAnnotations = next.length > 0 ? next : undefined;
      },
    });
    return ann;
  }

  /** Edit a figure object's style/text. Unknown ids are a defect ([[unresolvedTarget]]). */
  updateLayoutAnnotation(layoutId: NodeId, id: NodeId, patch: Partial<Omit<Annotation, "id" | "kind">>): void {
    const layout = this.requireLayout(layoutId);
    const list = layout.figureAnnotations ?? [];
    const idx = list.findIndex((a) => a.id === id);
    if (idx < 0) {
      unresolvedTarget("updateLayoutAnnotation", `figure object "${id}" on layout ${layout.id}`);
      return;
    }
    const prev = list[idx]!;
    const merged: Record<string, unknown> = { ...prev };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete merged[k];
      else merged[k] = v;
    }
    const next = merged as unknown as Annotation;
    this.commands.execute({
      label: "Edit figure object",
      do: () => {
        layout.figureAnnotations = list.map((a) => (a.id === id ? next : a));
      },
      undo: () => {
        layout.figureAnnotations = list.map((a) => (a.id === id ? prev : a));
      },
    });
  }

  /** Drag-move/resize a figure object — coalesced to one undo per drag, like
   *  [[moveAnnotation]]. A locked object ignores the move. */
  moveLayoutAnnotation(
    layoutId: NodeId,
    id: NodeId,
    patch: Partial<Pick<Annotation, "x" | "y" | "x2" | "y2" | "w" | "h" | "rotation">>,
  ): void {
    const layout = this.requireLayout(layoutId);
    const before = layout.figureAnnotations ?? [];
    const prev = before.find((a) => a.id === id);
    if (!prev) {
      unresolvedTarget("moveLayoutAnnotation", `figure object "${id}" on layout ${layout.id}`);
      return;
    }
    if (prev.locked) return; // locked → not draggable
    const after = before.map((a) => (a.id === id ? { ...a, ...patch } : a));
    this.commands.execute({
      label: "Move figure object",
      coalesceKey: `figannmove:${layoutId}:${id}`,
      do: () => {
        layout.figureAnnotations = after;
      },
      undo: () => {
        layout.figureAnnotations = before;
      },
    });
  }

  /** Delete a figure object. Unknown ids are a defect ([[unresolvedTarget]]). */
  removeLayoutAnnotation(layoutId: NodeId, id: NodeId): void {
    const layout = this.requireLayout(layoutId);
    const prev = layout.figureAnnotations;
    if (!(prev ?? []).some((a) => a.id === id)) {
      unresolvedTarget("removeLayoutAnnotation", `figure object "${id}" on layout ${layout.id}`);
      return;
    }
    const next = (prev ?? []).filter((a) => a.id !== id);
    this.commands.execute({
      label: "Remove figure object",
      do: () => {
        layout.figureAnnotations = next.length > 0 ? next : undefined;
      },
      undo: () => {
        layout.figureAnnotations = prev;
      },
    });
  }

  /**
   * Insert a ready-made `{ table, plot }` pair (e.g. a Chart-gallery card) as a
   * new dataset + graph in one undoable step. All ids are remapped to fresh ones
   * so the same card can be inserted repeatedly without collision, while internal
   * references (column `group`, per-series style keys, the plot's `source`) are
   * rewritten to the new ids. Files both loose, like `addTable` / `addPlot`.
   */
  insertGraph(srcTable: DataTable, srcPlot: Plot, name?: string, extraTables: readonly DataTable[] = []): { table: DataTable; plot: Plot } {
    const idMap = new Map<NodeId, NodeId>();
    const fresh = (old: NodeId, prefix: string): NodeId => {
      const next = this.ids.next(prefix);
      idMap.set(old, next);
      return next;
    };
    const columns: Column[] = srcTable.columns.map((c) => ({ ...c, id: fresh(c.id, "col") }));
    // Second pass: rewrite group refs now that every column has a new id.
    for (const c of columns) if (c.group) c.group = idMap.get(c.group) ?? c.group;
    const rows: Row[] = srcTable.rows.map((r) => ({
      id: fresh(r.id, "row"), // rows join the map: per-point styles are keyed `column:row`
      cells: Object.fromEntries(
        Object.entries(r.cells).map(([colId, v]) => [idMap.get(colId) ?? colId, v]),
      ),
    }));
    // Every DataTable field is carried by default (the duplicateTable rule): a table rebuilt
    // from columns + rows alone would lose a card's or template's coloured / patterned /
    // excluded cells. Cell-addressed maps are re-keyed onto the fresh row and column ids —
    // carried verbatim they would look right and colour nothing.
    const carry = (src: DataTable, id: NodeId, tableName: string, cols: Column[], rws: Row[]): DataTable => {
      const { derivation: _d, status: _s, linkedSource: _l, linkError: _e, excluded, cellFills, cellPatterns, ...rest } = src;
      const ex = remapExcluded(excluded, idMap, idMap);
      const cf = remapCellFills(cellFills, idMap, idMap);
      const cp = remapCellPatterns(cellPatterns, idMap, idMap);
      return {
        ...rest,
        id,
        name: tableName,
        columns: cols,
        rows: rws,
        ...(ex ? { excluded: ex } : {}),
        ...(cf ? { cellFills: cf } : {}),
        ...(cp ? { cellPatterns: cp } : {}),
        // Deliberately not carried — the inserted sheet is an independent working copy (the same
        // exceptions duplicateTable makes): derivation/status would recompute over the copy's
        // own values; linkedSource/linkError would make two sheets fight over one file.
      };
    };
    const table: DataTable = carry(srcTable, this.ids.next("tbl"), name ?? srcTable.name, columns, rows);
    // Extra sheets the graph borrows series from (`plot.overlays` — a gallery
    // card that ships two datasheets). Copied with fresh ids through the same id map — and before
    // the plot is built, so its style keys and overlay references remap exactly like the plot's
    // own column keys.
    const extras: DataTable[] = extraTables.map((src) => {
      const cols: Column[] = src.columns.map((c) => ({ ...c, id: fresh(c.id, "col") }));
      for (const c of cols) if (c.group) c.group = idMap.get(c.group) ?? c.group;
      const rws: Row[] = src.rows.map((r) => ({
        id: fresh(r.id, "row"),
        cells: Object.fromEntries(Object.entries(r.cells).map(([colId, v]) => [idMap.get(colId) ?? colId, v])),
      }));
      return carry(src, fresh(src.id, "tbl"), src.name, cols, rws);
    });
    // Every column / row / table reference the plot holds, through the one id map — see
    // remapPlotRefs.ts for why it is one function and not a list kept here by hand.
    const plot: Plot = remapPlotIds(
      { ...srcPlot, id: this.ids.next("plt"), name: name ?? srcPlot.name, source: table.id, status: "ok", styleOverrides: { ...srcPlot.styleOverrides } },
      (id) => idMap.get(id) ?? id,
    );
    const tableRef: WorkspaceRef = { kind: "table", id: table.id };
    const plotRef: WorkspaceRef = { kind: "plot", id: plot.id };
    const extraRefs: WorkspaceRef[] = extras.map((t) => ({ kind: "table", id: t.id }));
    this.commands.execute({
      label: `Add graph "${plot.name}"`,
      do: () => {
        this.project.tables.push(table, ...extras);
        this.project.plots.push(plot);
        this.project.workspace.loose.push(tableRef, ...extraRefs, plotRef);
      },
      undo: () => {
        const dead = new Set<NodeId>([table.id, ...extras.map((t) => t.id)]);
        this.project.tables = this.project.tables.filter((t) => !dead.has(t.id));
        this.project.plots = this.project.plots.filter((p) => p.id !== plot.id);
        this.unfileRef(tableRef);
        for (const r of extraRefs) this.unfileRef(r);
        this.unfileRef(plotRef);
      },
    });
    return { table, plot };
  }

  /**
   * Clone a graph ("Duplicate graph"): a new Plot over the same source
   * table, deep-copying every presentation field so edits don't alias the
   * original. Annotation ids are re-minted (they're plot-scoped). One undoable
   * command; filed loose (the caller re-files it next to its source family).
   */
  clonePlot(plotId: NodeId, name?: string): Plot {
    const src = this.requirePlot(plotId);
    const clone: Plot = JSON.parse(JSON.stringify(src));
    clone.id = this.ids.next("plt");
    clone.name = name ?? `${src.name} copy`;
    clone.status = "ok";
    if (clone.annotations) clone.annotations = clone.annotations.map((a) => ({ ...a, id: this.ids.next("ann") }));
    const ref: WorkspaceRef = { kind: "plot", id: clone.id };
    this.commands.execute({
      label: `Clone graph "${src.name}"`,
      do: () => {
        this.project.plots.push(clone);
        this.project.workspace.loose.push(ref);
      },
      undo: () => {
        this.project.plots = this.project.plots.filter((p) => p.id !== clone.id);
        this.unfileRef(ref);
      },
    });
    return clone;
  }

  /**
   * Duplicate a dataset ("Duplicate sheet"): a deep copy of a DataTable with
   * fresh ids for columns + rows (group refs rewritten), so the copy is fully
   * independent. One undoable command; filed loose. Returns the new table.
   */
  duplicateTable(tableId: NodeId, name?: string): DataTable {
    const src = this.requireTable(tableId);
    const idMap = new Map<NodeId, NodeId>();
    const columns: Column[] = src.columns.map((c) => {
      const id = this.ids.next("col");
      idMap.set(c.id, id);
      return { ...c, id };
    });
    for (const c of columns) if (c.group) c.group = idMap.get(c.group) ?? c.group;
    const rowMap = new Map<NodeId, NodeId>();
    const rows: Row[] = src.rows.map((r) => {
      const id = this.ids.next("row");
      rowMap.set(r.id, id);
      return { id, cells: Object.fromEntries(Object.entries(r.cells).map(([k, v]) => [idMap.get(k) ?? k, v])) };
    });
    // Carry the whole sheet, then override what must be fresh or independent.
    // Listing the fields to keep is fragile: a copy built as `{id, kind, name, columns, rows}`
    // drops `excluded` — so every deliberately excluded outlier silently re-enters every
    // statistic computed on the copy — and drops `frozen`, turning a read-only sheet editable.
    // Spreading means a new DataTable field is carried by default; the omissions below are the only exceptions
    // and `duplicate-table-census.test.ts` fails if a field is neither carried nor listed.
    const table: DataTable = {
      ...src,
      id: this.ids.next("tbl"),
      name: name ?? `${src.name} copy`,
      columns,
      rows,
      // Addressed by row and column id, so it must be re-keyed onto the fresh ids —
      // carrying the map verbatim would look right and exclude nothing.
      excluded: remapExcluded(src.excluded, rowMap, idMap),
      cellFills: remapCellFills(src.cellFills, rowMap, idMap),
      cellPatterns: remapCellPatterns(src.cellPatterns, rowMap, idMap),
      // Deliberately not carried — a duplicate is an independent working copy:
      //  • derivation/status — a copy that recomputed from the source would overwrite
      //    itself, and duplicating a derived sheet is exactly how you snapshot its
      //    current values. The copy is a plain sheet holding those values.
      //  • linkedSource/linkError — two sheets auto-updating from one file would fight
      //    over it, and the second link is invisible in the UI.
      derivation: undefined,
      status: undefined,
      linkedSource: undefined,
      linkError: undefined,
    };
    const ref: WorkspaceRef = { kind: "table", id: table.id };
    this.commands.execute({
      label: `Duplicate "${src.name}"`,
      do: () => {
        this.project.tables.push(table);
        this.project.workspace.loose.push(ref);
      },
      undo: () => {
        this.project.tables = this.project.tables.filter((t) => t.id !== table.id);
        this.unfileRef(ref);
      },
    });
    return table;
  }

  /**
   * Adopt a table built outside this document (e.g. the interactive import preview's scratch
   * grid) — re-id it onto this document's counter, file it loose, undoable. Same "carry the
   * whole sheet, then override what must be fresh" discipline as `duplicateTable`, so a grid
   * edit the user made — types, decimals, formulas, deliberately excluded cells, column order
   * — survives the transplant instead of being silently dropped. Returns the adopted table.
   */
  adoptImportedTable(src: DataTable, name?: string): DataTable {
    const idMap = new Map<NodeId, NodeId>();
    const columns: Column[] = src.columns.map((c) => {
      const id = this.ids.next("col");
      idMap.set(c.id, id);
      return { ...c, id };
    });
    for (const c of columns) if (c.group) c.group = idMap.get(c.group) ?? c.group;
    const rowMap = new Map<NodeId, NodeId>();
    const rows: Row[] = src.rows.map((r) => {
      const id = this.ids.next("row");
      rowMap.set(r.id, id);
      return { id, cells: Object.fromEntries(Object.entries(r.cells).map(([k, v]) => [idMap.get(k) ?? k, v])) };
    });
    const table: DataTable = {
      ...src,
      id: this.ids.next("tbl"),
      ...(name ? { name } : {}),
      columns,
      rows,
      excluded: remapExcluded(src.excluded, rowMap, idMap),
      cellFills: remapCellFills(src.cellFills, rowMap, idMap),
      cellPatterns: remapCellPatterns(src.cellPatterns, rowMap, idMap),
      // A freshly imported sheet is independent + plain — never inherit a stale derivation,
      // status or a scratch link (the caller sets the real link on the returned table).
      derivation: undefined,
      status: undefined,
      linkedSource: undefined,
      linkError: undefined,
    };
    const ref: WorkspaceRef = { kind: "table", id: table.id };
    this.commands.execute({
      label: `Import "${table.name}"`,
      do: () => {
        this.project.tables.push(table);
        this.project.workspace.loose.push(ref);
      },
      undo: () => {
        this.project.tables = this.project.tables.filter((t) => t.id !== table.id);
        this.unfileRef(ref);
      },
    });
    return table;
  }

  /**
   * Append imported rows to the bottom of an existing datasheet (merge-on-import), undoable.
   * Incoming columns are matched to the target's columns either by name (case-insensitive,
   * trimmed — the default) or by position. An incoming column with no match is added to the
   * target (existing rows read blank for it, since cells are sparse); the target's own
   * unmatched columns read blank in the appended rows. The target's column ids/types are
   * preserved, so plots and analyses drawn from it stay bound. Returns the count of rows added.
   */
  appendImportedRows(
    targetTableId: NodeId,
    columnNames: readonly string[],
    rows: ReadonlyArray<ReadonlyArray<CellValue>>,
    match: "name" | "position" = "name",
    columnTypes?: ReadonlyArray<ColumnType | undefined>,
  ): number {
    this.mutateTable(targetTableId, "Append imported rows", (table) => {
      const norm = (s: string): string => s.trim().toLowerCase();
      // Map each incoming column index → the target column id it writes to (creating columns
      // for unmatched incoming names / positions as we go).
      const targetFor: NodeId[] = columnNames.map((name, i) => {
        const existing =
          match === "position"
            ? table.columns[i]
            : table.columns.find((c) => norm(c.name) === norm(name));
        if (existing) return existing.id;
        const col: Column = { id: this.ids.next("col"), name: name.trim() || nextColumnName(table), ...(columnTypes?.[i] ? { type: columnTypes[i] } : {}) };
        table.columns.push(col);
        return col.id;
      });
      for (const values of rows) {
        const cells: Record<NodeId, CellValue> = {};
        targetFor.forEach((colId, i) => {
          const v = values[i] ?? null;
          if (v != null) cells[colId] = v;
        });
        table.rows.push({ id: this.ids.next("row"), cells });
      }
    });
    return rows.length;
  }

  /**
   * Apply one graph's *look* — series styles, fonts, gridlines,
   * frame/ticks, axis formatting, legend — to every other graph drawn from the
   * same source table, as one undoable command. Series styles are remapped by
   * dataset order (so the look transfers even if column ids differ). Returns the
   * number of graphs restyled.
   */
  copyPlotStyleToSiblings(fromId: NodeId): number {
    const from = this.requirePlot(fromId);
    const fromDatasets = tableDatasets(this.requireTable(from.source));
    const targets = this.project.plots.filter((p) => p.id !== fromId && p.source === from.source);
    if (targets.length === 0) return 0;
    const clone = <T>(v: T | undefined): T | undefined => (v === undefined ? undefined : (JSON.parse(JSON.stringify(v)) as T));
    // Snapshot the look once (shared across targets).
    const look = {
      fonts: clone(from.fonts),
      grid: clone(from.grid),
      frame: from.frame,
      tickDir: from.tickDir,
      tickLen: from.tickLen,
      xAxis: clone(from.xAxis),
      yAxis: clone(from.yAxis),
      legend: clone(from.legend),
    };
    const prev = targets.map((t) => ({
      id: t.id,
      seriesStyles: t.seriesStyles,
      fonts: t.fonts,
      grid: t.grid,
      frame: t.frame,
      tickDir: t.tickDir,
      tickLen: t.tickLen,
      xAxis: t.xAxis,
      yAxis: t.yAxis,
      legend: t.legend,
    }));
    this.commands.execute({
      label: "Apply graph look to siblings",
      do: () => {
        for (const t of targets) {
          const toDatasets = tableDatasets(this.requireTable(t.source));
          const styles: Record<NodeId, SeriesStyle> = {};
          if (from.seriesStyles) {
            fromDatasets.forEach((ds, i) => {
              const s = from.seriesStyles?.[ds.id];
              const tgt = toDatasets[i];
              if (s && tgt) styles[tgt.id] = JSON.parse(JSON.stringify(s));
            });
          }
          t.seriesStyles = Object.keys(styles).length > 0 ? styles : undefined;
          t.fonts = clone(look.fonts);
          t.grid = clone(look.grid);
          t.frame = look.frame;
          t.tickDir = look.tickDir;
          t.tickLen = look.tickLen;
          t.xAxis = keepAxisTitle("xAxis", clone(look.xAxis), t) as never;
          t.yAxis = keepAxisTitle("yAxis", clone(look.yAxis), t) as never;
          t.legend = clone(look.legend);
        }
      },
      undo: () => {
        for (const p of prev) {
          const t = this.project.plots.find((x) => x.id === p.id);
          if (!t) continue;
          t.seriesStyles = p.seriesStyles;
          t.fonts = p.fonts;
          t.grid = p.grid;
          t.frame = p.frame;
          t.tickDir = p.tickDir;
          t.tickLen = p.tickLen;
          t.xAxis = p.xAxis;
          t.yAxis = p.yAxis;
          t.legend = p.legend;
        }
      },
    });
    return targets.length;
  }

  /**
   * Apply a saved style template to a plot — copy the presentation fields the
   * template carries (dimensions, fonts, axes, palette, legend, frame, layout,
   * per-series styles…) onto this plot as one undoable action. Only the keys the
   * template provides are touched; data/source/kind/annotations are untouched.
   * `keys` lets the caller restrict to a subset (e.g. cross-type homogenise skips
   * kind-specific fields + per-series styles).
   */
  applyPlotTemplate(plotId: NodeId, template: Partial<Plot>, keys?: (keyof Plot)[]): void {
    const plot = this.requirePlot(plotId);
    const applyKeys = (keys ?? (Object.keys(template) as (keyof Plot)[])).filter((k) => k in template);
    if (applyKeys.length === 0) return;
    const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));
    const prev = {} as Partial<Plot>;
    for (const k of applyKeys) prev[k] = plot[k] as never;
    this.commands.execute({
      label: "Apply graph template",
      do: () => {
        for (const k of applyKeys) plot[k] = keepAxisTitle(k, clone(template[k]), plot) as never;
      },
      undo: () => {
        for (const k of applyKeys) plot[k] = prev[k] as never;
      },
    });
  }

  /**
   * Apply a custom user preset (userPresets.ts): a kind-agnostic captured look
   * (`style`, the SHARED_KEYS subset) plus an ordered series-colour `palette`, in a
   * single undoable action. The style keys transfer like `applyPlotTemplate`; the
   * palette seeds each dataset's series colour (cycled) like `applyStylePreset`, so
   * a custom default reproduces typography + axes + colours on a new graph of any
   * kind. A `palette` shorter than the dataset count cycles; an empty one leaves
   * series colours untouched.
   *
   * The full palette is saved. `style.paletteColors` (captured by SHARED_KEYS) is the
   * whole colour scheme; `palette` is only the source's used series colours (as many as it
   * had series). We carry the full scheme into `paletteColors` and colour extra series from
   * it — otherwise a preset saved off a one-series graph would collapse its 8-colour palette
   * down to that single colour, and a new multi-series graph would come out monochrome. `palette` still
   * wins per-index so a manual per-series recolour on the source reproduces exactly.
   */
  applyUserPreset(plotId: NodeId, style: Partial<Plot>, palette: string[], keys?: (keyof Plot)[], shapes?: SymbolShape[]): void {
    const plot = this.requirePlot(plotId);
    const applyKeys = (keys ?? (Object.keys(style) as (keyof Plot)[])).filter((k) => k in style && k !== "seriesStyles");
    const datasets = palette.length ? tableDatasets(this.requireTable(plot.source)) : [];
    if (applyKeys.length === 0 && datasets.length === 0) return;
    const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));
    const prevFields = {} as Partial<Plot>;
    for (const k of applyKeys) prevFields[k] = plot[k] as never;
    const prevStyles = plot.seriesStyles;
    const prevPalette = { palette: plot.palette, paletteColors: plot.paletteColors };
    // The full colour scheme (all captured colours), falling back to the ordered series
    // palette when a preset captured none (legacy presets / no `paletteColors`).
    const schemeCaptured = style.paletteColors as string[] | undefined;
    const scheme = schemeCaptured && schemeCaptured.length ? schemeCaptured : palette;
    // Reproduce the source's ordered series colours first (honours manual overrides), then
    // extend from the full scheme so a target with more series still gets the whole palette.
    const colourAt = (i: number): string =>
      i < palette.length ? palette[i]! : scheme.length ? scheme[i % scheme.length]! : palette[i % palette.length]!;
    const nextStyles: Record<NodeId, SeriesStyle> = { ...(plot.seriesStyles ?? {}) };
    datasets.forEach((ds, i) => {
      nextStyles[ds.id] = {
        ...(nextStyles[ds.id] ?? {}),
        color: colourAt(i),
        /**
         * The marker shapes the preset captured, cycled like the colours — so a look that
         * separated its series by shape as well as hue reproduces both.
         *
         * Only when the preset carries them. A preset saved before shapes were captured has
         * none, and must leave the target's own shapes alone rather than resetting them.
         */
        ...(shapes && shapes.length ? { symbol: shapes[i % shapes.length] } : {}),
      };
    });
    this.commands.execute({
      label: "Apply preset",
      do: () => {
        for (const k of applyKeys) plot[k] = keepAxisTitle(k, clone(style[k]), plot) as never;
        if (datasets.length) plot.seriesStyles = nextStyles;
        // Same routing as applyStylePreset: the builder-coloured kinds follow too. Carry the
        // full scheme (not just the used-series palette) so every saved colour survives.
        if (palette.length) { plot.paletteColors = [...scheme]; plot.palette = undefined; }
      },
      undo: () => {
        for (const k of applyKeys) plot[k] = prevFields[k] as never;
        if (datasets.length) plot.seriesStyles = prevStyles;
        if (palette.length) { plot.palette = prevPalette.palette; plot.paletteColors = prevPalette.paletteColors; }
      },
    });
  }

  /**
   * Apply one captured style to many plots in a single undoable action — the panel
   * assembler's "match styles across panels" (auto-scale / homogenise). `keys`
   * restricts which presentation fields transfer (size-only, fonts-only, …).
   */
  applyPlotTemplateMany(plotIds: NodeId[], template: Partial<Plot>, keys: (keyof Plot)[]): void {
    const targets = plotIds.map((id) => this.project.plots.find((p) => p.id === id)).filter((p): p is Plot => Boolean(p));
    const applyKeys = keys.filter((k) => k in template);
    if (targets.length === 0 || applyKeys.length === 0) return;
    const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));
    const prev = targets.map((t) => {
      const snap = {} as Partial<Plot>;
      for (const k of applyKeys) snap[k] = t[k] as never;
      return { id: t.id, snap };
    });
    this.commands.execute({
      label: "Match panel styles",
      do: () => {
        for (const t of targets) for (const k of applyKeys) t[k] = keepAxisTitle(k, clone(template[k]), t) as never;
      },
      undo: () => {
        for (const t of targets) {
          const p = prev.find((x) => x.id === t.id);
          if (p) for (const k of applyKeys) t[k] = p.snap[k] as never;
        }
      },
    });
  }

  /** Clears the stale flag on every plot, unconditionally — for callers that have just built the
   *  plots from current data (e.g. a new graph). `refreshPlotStatus` is the per-plot check. */
  recompute(): void {
    for (const plot of this.project.plots) plot.status = "ok";
  }

  /**
   * Re-derive every plot's stale flag from whether it can actually draw current data.
   *
   * The badge means "this figure does not show your latest data", and it has to stop
   * meaning that the moment the figure does. Two cases, and only two:
   *
   *  - A plot drawn from a table redraws from the live document on every render (and, through
   *    `applyExclusions`, honours exclusions while doing it). It is accurate as soon as the
   *    edit lands, so it clears here.
   *  - A plot drawn from an analysis (survival, ROC, PCA, a curve fit) can only be as fresh
   *    as the result behind it, and that result is computed out-of-process. It stays stale
   *    until its stored fit is refreshed from a successful analysis result.
   *
   * Note: called after every mutation, so `markDependentsStale` still raises the flag on an
   * edit and this lowers it again for anything that has already caught up. Do not simplify
   * this into never marking plots stale: for the analysis-backed case the flag is true, and
   * removing it would hide a figure that really is out of date with its statistics.
   */
  refreshPlotStatus(): void {
    for (const plot of this.project.plots) {
      const bindings = [plot, ...(plot.fit ? [plot.fit] : []), ...(plot.fits ?? [])];
      const stale = plot.snapshotStale || bindings.some((binding) => {
        if (!binding.analysisSource) return false;
        const analysis = this.project.analyses.find((a) => a.id === binding.analysisSource);
        return !analysis || analysis.status !== "ok"
          || (binding.analysisResultVersion ?? 0) !== (analysis.resultVersion ?? 0);
      });
      plot.status = stale ? "stale" : "ok";
    }
  }

  // --- analyses -----------------------------------------------------------

  /**
   * Create a first-class analysis bound to a source table (undoable). The tidy
   * result is attached later via `setAnalysisResult` once the engine returns.
   * Files the analysis to `loose`, like `addTable`/`addPlot`.
   */
  addAnalysis(name: string, method: string, source: NodeId, params: AnalysisParams): Analysis {
    this.requireTable(source);
    const analysis: Analysis = { id: this.ids.next("an"), name, method, source, params, status: "stale" };
    const ref: WorkspaceRef = { kind: "analysis", id: analysis.id };
    this.commands.execute({
      label: `Add analysis "${name}"`,
      do: () => {
        this.project.analyses.push(analysis);
        this.project.workspace.loose.push(ref);
      },
      undo: () => {
        this.project.analyses = this.project.analyses.filter((a) => a.id !== analysis.id);
        this.unfileRef(ref);
      },
    });
    return analysis;
  }

  // --- re-applicable analysis methods (Method files) ----------------

  /** Save a re-applicable analysis Method (already built via `analysisToMethod`). Undoable. */
  addMethod(method: MethodSpec): MethodSpec {
    this.commands.execute({
      label: `Save method "${method.name}"`,
      do: () => {
        this.project.methods = [...(this.project.methods ?? []), method];
      },
      undo: () => {
        this.project.methods = (this.project.methods ?? []).filter((m) => m.id !== method.id);
      },
    });
    return method;
  }

  /** Delete a saved Method. Undoable. */
  removeMethod(id: NodeId): void {
    const prev = this.project.methods ?? [];
    if (!prev.some((m) => m.id === id)) return;
    const next = prev.filter((m) => m.id !== id);
    this.commands.execute({
      label: "Delete method",
      do: () => {
        this.project.methods = next.length > 0 ? next : undefined;
      },
      undo: () => {
        this.project.methods = prev;
      },
    });
  }

  /** Rename a saved Method. Undoable. */
  renameMethod(id: NodeId, name: string): void {
    const prev = this.project.methods ?? [];
    const target = prev.find((m) => m.id === id);
    if (!target || target.name === name) return;
    const next = prev.map((m) => (m.id === id ? { ...m, name } : m));
    this.commands.execute({
      label: "Rename method",
      do: () => {
        this.project.methods = next;
      },
      undo: () => {
        this.project.methods = prev;
      },
    });
  }

  /** Mint an id for a new Method (caller builds it via `analysisToMethod`). */
  nextMethodId(): NodeId {
    return this.ids.next("method");
  }

  // --- user-built colour gradients (`Project.gradients`, referenced as `custom:<id>`) ------
  // A project-wide library like `methods`, not filed in the workspace tree: a gradient is a
  // material a graph is made of, not an object the Navigator shows.

  /** Add a gradient, or replace the one with the same id. Undoable. */
  saveGradient(gradient: Gradient): Gradient {
    const prev = this.project.gradients ?? [];
    const exists = prev.some((g) => g.id === gradient.id);
    const next = exists ? prev.map((g) => (g.id === gradient.id ? gradient : g)) : [...prev, gradient];
    this.commands.execute({
      label: exists ? `Edit gradient "${gradient.name}"` : `New gradient "${gradient.name}"`,
      do: () => {
        this.project.gradients = next;
      },
      undo: () => {
        this.project.gradients = prev.length > 0 ? prev : undefined;
      },
    });
    return gradient;
  }

  /** Delete a gradient. Undoable. Throws (under test) when the id matches nothing — the
   *  editor's Delete button hands us an id it read from this very list, so a miss is a defect,
   *  not a no-op. */
  removeGradient(id: string): void {
    const prev = this.project.gradients ?? [];
    if (!prev.some((g) => g.id === id)) {
      unresolvedTarget("removeGradient", `gradient "${id}"`);
      return;
    }
    const next = prev.filter((g) => g.id !== id);
    this.commands.execute({
      label: "Delete gradient",
      do: () => {
        this.project.gradients = next.length > 0 ? next : undefined;
      },
      undo: () => {
        this.project.gradients = prev;
      },
    });
  }

  /** Which plots still paint with this gradient — the editor refuses to delete a gradient that
   *  is still in use, and needs to say which graphs. Matches every ramp field that can carry a
   *  `custom:<id>` reference. */
  plotsUsingGradient(id: string): Plot[] {
    const ref = `custom:${id}`;
    return this.project.plots.filter((p) =>
      p.heatmap?.colormap === ref
      || p.parallel?.colorRamp === ref
      || p.tracks?.colormap === ref
      || p.ridgeline?.spectrumMap === ref
      || Object.values(p.seriesStyles ?? {}).some((st) => st?.gradRamp === ref || st?.colorFromRamp === ref)
      || Object.values(p.pointStyles ?? {}).some((st) => st?.gradRamp === ref || st?.colorFromRamp === ref),
    );
  }

  /** Mint an id for a new gradient. */
  nextGradientId(): string {
    return this.ids.next("gradient");
  }

  /** Capture the exact input and supersede any older pending request for this analysis. */
  beginAnalysisRun(analysisId: NodeId): AnalysisRun {
    const analysis = this.requireAnalysis(analysisId);
    const table = this.requireTable(analysis.source);
    const data = buildAnalysisData(analysis.method, analysis.params, table);
    const run = { analysisId, method: analysis.method, data };
    const fingerprint = JSON.stringify([analysis.source, analysis.method, analysis.params, data]);
    this.analysisRuns.set(analysisId, { run, analysis, fingerprint });
    return run;
  }

  /** Accept only this document's latest request on unchanged inputs; consume it once. */
  completeAnalysisRun(run: AnalysisRun, outcome: { result?: AnalysisResult; error?: string }): boolean {
    const pending = this.analysisRuns.get(run.analysisId);
    if (!pending || pending.run !== run) return false;
    this.analysisRuns.delete(run.analysisId);
    const analysis = this.project.analyses.find((a) => a.id === run.analysisId);
    const table = analysis && this.project.tables.find((t) => t.id === analysis.source);
    if (!analysis || analysis !== pending.analysis || !table) return false;
    try {
      const data = buildAnalysisData(analysis.method, analysis.params, table);
      if (pending.fingerprint !== JSON.stringify([analysis.source, analysis.method, analysis.params, data])) return false;
    } catch { return false; }
    if (outcome.result) this.setAnalysisResult(run.analysisId, outcome.result);
    else this.setAnalysisError(run.analysisId, outcome.error ?? "Analysis failed.");
    return true;
  }

  /** Attach a computed tidy result (clears stale/error). Not undoable — a derived value. */
  setAnalysisResult(analysisId: NodeId, result: AnalysisResult): void {
    const analysis = this.requireAnalysis(analysisId);
    this.analysisRuns.delete(analysisId);
    analysis.result = result;
    analysis.resultVersion = ++this.resultSequence;
    analysis.status = "ok";
    analysis.error = undefined;
  }

  /** Record an engine error for an analysis (derived value, not undoable). */
  setAnalysisError(analysisId: NodeId, message: string): void {
    const analysis = this.requireAnalysis(analysisId);
    this.analysisRuns.delete(analysisId);
    analysis.status = "error";
    analysis.error = message;
  }

  analysisStatus(analysisId: NodeId): Analysis["status"] {
    return this.requireAnalysis(analysisId).status;
  }

  // --- reproducible analysis log (append-only journal) --------------------

  /**
   * Append a step to the analysis log. Append-only (an audit trail of what was
   * done), so it is not tied to undo/redo; the caller logs meaningful actions
   * (import / analyze / graph / fit). Returns the new entry.
   */
  appendLog(
    kind: LogKind,
    label: string,
    opts: {
      detail?: string | undefined;
      refKind?: WorkspaceObjectKind | undefined;
      refId?: NodeId | undefined;
    } = {},
  ): LogEntry {
    const entry: LogEntry = {
      id: this.ids.next("log"),
      kind,
      label,
      detail: opts.detail,
      refKind: opts.refKind,
      refId: opts.refId,
    };
    this.project.log.push(entry);
    return entry;
  }

  /** Clear the analysis log. */
  clearLog(): void {
    this.project.log = [];
  }

  /**
   * Set (or clear, with "auto") an axis scale override on a plot. Presentation
   * only — the renderer reads it live, so it is not a data change (not stale).
   */
  setPlotScale(plotId: NodeId, axis: "x" | "y", type: AxisScale | "auto"): void {
    const plot = this.requirePlot(plotId);
    const resolved = type === "auto" ? undefined : type;
    const prevX = plot.xScale;
    const prevY = plot.yScale;
    this.commands.execute({
      label: `Set ${axis}-axis scale`,
      do: () => {
        if (axis === "x") plot.xScale = resolved;
        else plot.yScale = resolved;
      },
      undo: () => {
        plot.xScale = prevX;
        plot.yScale = prevY;
      },
    });
  }

  /**
   * Merge a Format-Axes patch into a plot's x/y AxisSpec (scale, manual range,
   * reversed, number format, title). A key set to `undefined` clears it (back to
   * auto). Undoable; presentation only (not stale). The legacy x/yScale fields are
   * left untouched — buildScene reads xAxis.scale first, then xScale.
   */
  setPlotAxis(plotId: NodeId, axis: "x" | "y" | "y2" | "y3" | "z", patch: Partial<AxisSpec>): void {
    const plot = this.requirePlot(plotId);
    const prev =
      axis === "x" ? plot.xAxis : axis === "y2" ? plot.y2Axis : axis === "y3" ? plot.y3Axis : axis === "z" ? plot.zAxis : plot.yAxis;
    const merged: Record<string, unknown> = { ...(prev ?? {}) };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete merged[k];
      else merged[k] = v;
    }
    const next = Object.keys(merged).length > 0 ? (merged as AxisSpec) : undefined;
    const setSpec = (s: AxisSpec | undefined): void => {
      if (axis === "x") plot.xAxis = s;
      else if (axis === "y2") plot.y2Axis = s;
      else if (axis === "y3") plot.y3Axis = s;
      else if (axis === "z") plot.zAxis = s; // the 3-D scatter's Z (see Plot.zAxis)
      else plot.yAxis = s;
    };
    this.commands.execute({
      label: `Format ${axis}-axis`,
      do: () => setSpec(next),
      undo: () => setSpec(prev),
    });
  }

  /** Set the chart kind (xy/bar/box/violin/scatter). Presentation only (not stale). */
  setPlotKind(plotId: NodeId, kind: PlotKind | undefined): void {
    const plot = this.requirePlot(plotId);
    const prev = plot.kind;
    this.commands.execute({
      label: "Change chart type",
      do: () => {
        plot.kind = kind;
      },
      undo: () => {
        plot.kind = prev;
      },
    });
  }

  /** Format the frame + tick marks (frame style / tick direction / tick length). Presentation only. */
  setPlotFrame(plotId: NodeId, patch: { frame?: FrameStyle; tickDir?: TickDir; tickLen?: number }): void {
    const plot = this.requirePlot(plotId);
    const prev = { frame: plot.frame, tickDir: plot.tickDir, tickLen: plot.tickLen };
    this.commands.execute({
      label: "Format frame & ticks",
      do: () => {
        if ("frame" in patch) plot.frame = patch.frame;
        if ("tickDir" in patch) plot.tickDir = patch.tickDir;
        if ("tickLen" in patch) plot.tickLen = patch.tickLen;
      },
      undo: () => {
        plot.frame = prev.frame;
        plot.tickDir = prev.tickDir;
        plot.tickLen = prev.tickLen;
      },
    });
  }

  /** Edit the graph title heading (text / visibility / subtitle). Presentation only. */
  setGraphTitle(
    plotId: NodeId,
    patch: {
      title?: string | undefined;
      showTitle?: boolean;
      subtitle?: string | undefined;
      titleAlign?: Plot["titleAlign"];
      footer?: Plot["footer"];
    },
  ): void {
    const plot = this.requirePlot(plotId);
    const prev = {
      title: plot.title,
      showTitle: plot.showTitle,
      subtitle: plot.subtitle,
      titleAlign: plot.titleAlign,
      footer: plot.footer,
    };
    this.commands.execute({
      label: "Edit graph title",
      do: () => {
        if ("title" in patch) plot.title = patch.title;
        if ("showTitle" in patch) plot.showTitle = patch.showTitle;
        if ("subtitle" in patch) plot.subtitle = patch.subtitle;
        if ("titleAlign" in patch) plot.titleAlign = patch.titleAlign;
        if ("footer" in patch) plot.footer = patch.footer;
      },
      undo: () => {
        plot.title = prev.title;
        plot.showTitle = prev.showTitle;
        plot.subtitle = prev.subtitle;
        plot.titleAlign = prev.titleAlign;
        plot.footer = prev.footer;
      },
    });
  }

  /** Set the title/subtitle drag offset (px) from centred; (0,0) clears it. Presentation only (not stale). */
  setTitleOffset(plotId: NodeId, dx: number, dy: number): void {
    const plot = this.requirePlot(plotId);
    const prev = plot.titleOffset;
    const next = dx === 0 && dy === 0 ? undefined : { dx, dy };
    this.commands.execute({
      label: "Move title",
      do: () => { plot.titleOffset = next; },
      undo: () => { plot.titleOffset = prev; },
    });
  }

  /**
   * Rename a graph. One undoable step; trimmed. A graph with no title of its own draws its name
   * as the title.
   * Strict: an unknown graph or a blank name throws (a graph always has a name).
   */
  renamePlot(plotId: NodeId, name: string): void {
    const plot = this.requirePlot(plotId);
    const next = name.trim();
    if (!next) throw new Error(`renamePlot: a graph needs a name (plot ${plotId})`);
    const prev = plot.name;
    this.commands.execute({
      label: "Rename graph",
      do: () => { plot.name = next; },
      undo: () => { plot.name = prev; },
    });
  }

  /**
   * Set an axis title's drag offset (px); (0,0) clears it. Presentation only. `axis` is the data axis: Y2 and Y3 are
   * the second and third value axes wherever they are drawn - down the right of a vertical chart,
   * along the top of a horizontal one - so their offset needs no visual-to-data mapping.
   */
  setAxisTitleOffset(plotId: NodeId, axis: "x" | "y" | "y2" | "y3", dx: number, dy: number): void {
    const plot = this.requirePlot(plotId);
    const key = (`${axis}Axis`) as "xAxis" | "yAxis" | "y2Axis" | "y3Axis";
    const prevSpec = plot[key];
    const prevOffset = prevSpec?.titleOffset;
    const next = dx === 0 && dy === 0 ? undefined : { dx, dy };
    this.commands.execute({
      label: "Move axis title",
      do: () => { plot[key] = { ...(plot[key] ?? {}), titleOffset: next }; },
      undo: () => { plot[key] = prevSpec ? { ...prevSpec, titleOffset: prevOffset } : undefined; },
    });
  }

  /** Set the legend drag offset (px) from its anchored spot; (0,0) clears it. Presentation only. */
  setLegendOffset(plotId: NodeId, dx: number, dy: number): void {
    const plot = this.requirePlot(plotId);
    const prev = plot.legendOffset;
    const next = dx === 0 && dy === 0 ? undefined : { dx, dy };
    this.commands.execute({
      label: "Move legend",
      do: () => { plot.legendOffset = next; },
      undo: () => { plot.legendOffset = prev; },
    });
  }

  /**
   * Homogenise one text role's font size across several graphs (i.e.
   * "set one size for all axis titles / all ticks / all legends … across a
   * figure") in one undoable command. Merges `{ size }` into each plot's
   * `fonts[element]`, preserving that element's other font fields. Presentation only.
   */
  setFontSizeForPlots(plotIds: NodeId[], element: FontElement, size: number): void {
    const plots = plotIds.map((id) => this.requirePlot(id));
    if (plots.length === 0) return;
    const prev = plots.map((p) => ({ id: p.id, fonts: p.fonts }));
    const apply = (p: Plot): void => {
      const spec: FontSpec = { ...(p.fonts?.[element] ?? {}), size };
      p.fonts = { ...(p.fonts ?? {}), [element]: spec };
    };
    this.commands.execute({
      label: "Homogenise type size",
      do: () => {
        for (const p of plots) apply(p);
      },
      undo: () => {
        for (const snap of prev) {
          const p = this.project.plots.find((x) => x.id === snap.id);
          if (p) p.fonts = snap.fonts;
        }
      },
    });
  }

  /**
   * Set the per-axis title font (X, Y, Y2 or Y3 independently). Merges `patch` into that
   * axis's own `titleFont`, clearing a field set to `undefined`; an empty result
   * removes `titleFont` (back to inheriting: X/Y the shared `fonts.axisTitle`, Y2/Y3 the
   * main Y title font, then the shared one). Routed through the same AxisSpec store as
   * `setPlotAxis`, so it's one undoable, presentation-only command.
   * Y2/Y3 merge into their own font, not the main Y's, so a second edit to the Y2 title keeps its size.
   */
  setAxisTitleFont(plotId: NodeId, axis: "x" | "y" | "y2" | "y3", patch: Partial<FontSpec>): void {
    const plot = this.requirePlot(plotId);
    const prevAxis = axis === "x" ? plot.xAxis : axis === "y2" ? plot.y2Axis : axis === "y3" ? plot.y3Axis : plot.yAxis;
    const merged: Record<string, unknown> = { ...(prevAxis?.titleFont ?? {}) };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete merged[k];
      else merged[k] = v;
    }
    const nextFont = Object.keys(merged).length > 0 ? (merged as FontSpec) : undefined;
    this.setPlotAxis(plotId, axis, { titleFont: nextFont });
  }

  /** Set the typography of one figure text element (merged; blank fields clear). Presentation only. */
  setPlotFont(plotId: NodeId, element: FontElement, patch: Partial<FontSpec>): void {
    const plot = this.requirePlot(plotId);
    const prevAll = plot.fonts;
    const prevSpec = prevAll?.[element];
    const merged: Record<string, unknown> = { ...(prevSpec ?? {}) };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete merged[k];
      else merged[k] = v;
    }
    const nextSpec = Object.keys(merged).length > 0 ? (merged as FontSpec) : undefined;
    const nextAll = { ...(prevAll ?? {}), [element]: nextSpec };
    if (nextSpec === undefined) delete nextAll[element];
    const next = Object.keys(nextAll).length > 0 ? nextAll : undefined;
    this.commands.execute({
      label: "Format font",
      do: () => {
        plot.fonts = next;
      },
      undo: () => {
        plot.fonts = prevAll;
      },
    });
  }

  /** Edit the legend (show / position / orientation / border / background; merged). Presentation only. */
  setLegend(plotId: NodeId, patch: Partial<LegendSpec>): void {
    const plot = this.requirePlot(plotId);
    const prev = plot.legend;
    const merged: Record<string, unknown> = { ...(prev ?? {}) };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete merged[k];
      else merged[k] = v;
    }
    const next = Object.keys(merged).length > 0 ? (merged as LegendSpec) : undefined;
    this.commands.execute({
      label: "Format legend",
      do: () => {
        plot.legend = next;
      },
      undo: () => {
        plot.legend = prev;
      },
    });
  }

  /** Merge plot-wide significance-bracket formatting (display/decimals/colour/width). Presentation only. */
  setSignificance(plotId: NodeId, patch: Partial<SignificanceStyle>): void {
    const plot = this.requirePlot(plotId);
    const prev = plot.significance;
    const merged: Record<string, unknown> = { ...(prev ?? {}) };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete merged[k];
      else merged[k] = v;
    }
    const next = Object.keys(merged).length > 0 ? (merged as SignificanceStyle) : undefined;
    this.commands.execute({
      label: "Format significance",
      do: () => {
        plot.significance = next;
      },
      undo: () => {
        plot.significance = prev;
      },
    });
  }

  /** Add an annotation (reference line / text / bracket) to a graph. Presentation only. Returns it. */
  addAnnotation(plotId: NodeId, annotation: Omit<Annotation, "id">): Annotation {
    const plot = this.requirePlot(plotId);
    const ann: Annotation = { ...annotation, id: this.ids.next("ann") };
    this.commands.execute({
      label: "Add annotation",
      do: () => {
        plot.annotations = [...(plot.annotations ?? []), ann];
      },
      undo: () => {
        const next = (plot.annotations ?? []).filter((a) => a.id !== ann.id);
        plot.annotations = next.length > 0 ? next : undefined;
      },
    });
    return ann;
  }

  /** Duplicate an annotation: a copy with a fresh id, nudged slightly so it's
   *  visible, added on top (front). Undoable. */
  duplicateAnnotation(plotId: NodeId, id: NodeId): Annotation | undefined {
    const plot = this.requirePlot(plotId);
    const src = (plot.annotations ?? []).find((a) => a.id === id);
    if (!src) return undefined;
    const off = 0.03; // small fractional offset so the copy doesn't hide the original
    const copy: Annotation = {
      ...src,
      id: this.ids.next("ann"),
      ...(src.x != null ? { x: src.x + off } : {}),
      ...(src.y != null ? { y: src.y + off } : {}),
      ...(src.x2 != null ? { x2: src.x2 + off } : {}),
      ...(src.y2 != null ? { y2: src.y2 + off } : {}),
    };
    this.commands.execute({
      label: "Duplicate annotation",
      do: () => {
        plot.annotations = [...(plot.annotations ?? []), copy];
      },
      undo: () => {
        const next = (plot.annotations ?? []).filter((a) => a.id !== copy.id);
        plot.annotations = next.length > 0 ? next : undefined;
      },
    });
    return copy;
  }

  /** Add several annotations as one undoable step (e.g. auto significance brackets). Presentation only. */
  addAnnotations(plotId: NodeId, annotations: Omit<Annotation, "id">[]): Annotation[] {
    const plot = this.requirePlot(plotId);
    const anns: Annotation[] = annotations.map((a) => ({ ...a, id: this.ids.next("ann") }));
    if (anns.length === 0) return anns;
    const ids = new Set(anns.map((a) => a.id));
    this.commands.execute({
      label: anns.length === 1 ? "Add annotation" : "Add annotations",
      do: () => {
        plot.annotations = [...(plot.annotations ?? []), ...anns];
      },
      undo: () => {
        const next = (plot.annotations ?? []).filter((a) => !ids.has(a.id));
        plot.annotations = next.length > 0 ? next : undefined;
      },
    });
    return anns;
  }

  /**
   * Replace every significance marker this analysis owns with a fresh set — one undoable
   * step, so a re-run never leaves a half-updated figure behind.
   *
   * The markers are identified by their provenance (`sig.analysisId`), never by position or
   * count, so anything the user added by hand is untouched. Passing an empty list is how
   * "untick" removes exactly what the analysis put there and nothing else.
   *
   * Overwrites: a re-run rebuilds these markers, so a p-value that moved is shown as it now
   * is, and a comparison that stopped being significant stops being drawn. Edits to a
   * managed marker do not survive a re-run — that is the point of binding it to the test.
   */
  syncAnalysisAnnotations(plotId: NodeId, analysisId: NodeId, next: Omit<Annotation, "id">[]): Annotation[] {
    const plot = this.requirePlot(plotId);
    const before = plot.annotations ?? [];
    const kept = before.filter((a) => a.sig?.analysisId !== analysisId);
    const added: Annotation[] = next.map((a) => ({ ...a, id: this.ids.next("ann") }));
    if (kept.length === before.length && added.length === 0) return added; // nothing to do
    const after = [...kept, ...added];
    this.commands.execute({
      label: added.length === 0 ? "Remove significance markers" : "Update significance markers",
      do: () => {
        plot.annotations = after.length > 0 ? after : undefined;
      },
      undo: () => {
        plot.annotations = before.length > 0 ? [...before] : undefined;
      },
    });
    return added;
  }

  /**
   * Auto-compute the percent change of a dataset (first → last finite row mean)
   * and drop it as a clean, movable + editable text label (e.g. "+29%"). Green
   * for an increase, red for a decrease. Returns the annotation (undoable).
   */
  addPercentChangeLabel(plotId: NodeId, datasetId?: NodeId): Annotation | undefined {
    const plot = this.requirePlot(plotId);
    const table = this.requireTable(plot.source);
    const datasets = tableDatasets(table);
    const ds = (datasetId ? datasets.find((d) => d.id === datasetId) : undefined) ?? datasets[0];
    if (!ds) return undefined;
    const rowMean = (row: Row): number => {
      if (ds.sd !== undefined || ds.sem !== undefined) return Number(row.cells[ds.replicates[0]!]);
      const vs = ds.replicates.map((id) => Number(row.cells[id])).filter((v) => Number.isFinite(v));
      return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : NaN;
    };
    const means = table.rows.map(rowMean).filter((v) => Number.isFinite(v));
    if (means.length < 2) return undefined;
    const v0 = means[0]!;
    const v1 = means[means.length - 1]!;
    if (v0 === 0) return undefined;
    const pct = ((v1 - v0) / Math.abs(v0)) * 100;
    const rounded = Math.abs(pct) >= 10 ? Math.round(pct) : Math.round(pct * 10) / 10;
    const label = `${pct >= 0 ? "+" : ""}${rounded}%`;
    return this.addAnnotation(plotId, {
      kind: "text",
      label,
      x: 0.72,
      y: 0.18,
      bold: true,
      color: pct >= 0 ? "#1a8f5a" : "#c0392b",
    });
  }

  /** Edit an annotation's fields (merged; undefined clears a field). Presentation only. */
  updateAnnotation(plotId: NodeId, id: NodeId, patch: Partial<Omit<Annotation, "id" | "kind">>): void {
    const plot = this.requirePlot(plotId);
    const list = plot.annotations ?? [];
    const idx = list.findIndex((a) => a.id === id);
    // A builder-synthesized element (pyramid "pyr-val-*", PCA loading "pca-vlabel-*" /
    // "pca-arrow-*") has no backing annotation. Persist a rename/recolour as an override on
    // the owning plot's style (mirrors [[moveSynthLabel]] for the drag); unknown ids stay a
    // graceful no-op.
    if (idx < 0) {
      this.updateSynthElement(plot, id, patch);
      return;
    }
    const prev = list[idx]!;
    const merged: Record<string, unknown> = { ...prev };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete merged[k];
      else merged[k] = v;
    }
    const next = merged as unknown as Annotation;
    this.commands.execute({
      label: "Edit annotation",
      do: () => {
        plot.annotations = list.map((a) => (a.id === id ? next : a));
      },
      undo: () => {
        plot.annotations = list.map((a) => (a.id === id ? prev : a));
      },
    });
  }

  /** Move/resize an annotation (drag): update its position/geometry fields, coalesced to one undo per drag.
   *  A locked annotation ignores the move. When the dragged annotation belongs to a `group`, a pure
   *  translation (x/y/x2/y2 with no resize/rotate) drags every other unlocked group member by the same
   *  fractional delta, so grouped objects move as one. */
  moveAnnotation(
    plotId: NodeId,
    id: NodeId,
    patch: Partial<Pick<Annotation, "value" | "x" | "y" | "bracketY" | "bracketShift" | "x2" | "y2" | "w" | "h" | "rotation" | "from" | "to" | "anchorX" | "anchorY">>,
  ): void {
    const plot = this.requirePlot(plotId);
    const before = plot.annotations ?? [];
    const prev = before.find((a) => a.id === id);
    if (!prev) {
      // A builder-synthesized label (pyramid value "pyr-val-<ds>-<row>", PCA loading
      // "pca-vlabel-<i>") has no backing annotation, so a normal move would no-op. Persist
      // its drag as a fractional position override on the owning plot's style — the builder
      // then repositions it on rebuild. Keeps unknown ids a graceful no-op.
      this.moveSynthLabel(plot, id, patch);
      return;
    }
    if (prev.locked) return; // locked → not draggable
    // Translation delta (only for a pure move — resize/rotate stays local to the object).
    // A pure move translates the whole object (and its group). Anything that reshapes it
    // — a resize, a rotate, a reference-line value, a bracket height, a bracket
    // endpoint — stays local to this annotation, or dragging one end of a bracket would
    // shunt every grouped sibling sideways.
    const isTranslate =
      patch.w === undefined && patch.h === undefined && patch.rotation === undefined &&
      patch.value === undefined && patch.bracketY === undefined && patch.bracketShift === undefined &&
      patch.from === undefined && patch.to === undefined;
    const dx = patch.x !== undefined && prev.x !== undefined ? patch.x - prev.x : 0;
    const dy = patch.y !== undefined && prev.y !== undefined ? patch.y - prev.y : 0;
    const moveGroup = isTranslate && prev.group !== undefined && (dx !== 0 || dy !== 0);
    const after = before.map((a) => {
      // Dragging a bracket's height makes it a hand-set height: drop the planner's
      // provenance flag, so the scene's ladder-lift never overrules the user's position.
      if (a.id === id) return { ...a, ...patch, ...(patch.bracketY !== undefined ? { plannedY: undefined } : {}) };
      if (moveGroup && a.group === prev.group && !a.locked) {
        const s = { ...a };
        if (s.x !== undefined) s.x += dx;
        if (s.y !== undefined) s.y += dy;
        if (s.x2 !== undefined) s.x2 += dx;
        if (s.y2 !== undefined) s.y2 += dy;
        return s;
      }
      return a;
    });
    this.commands.execute({
      label: "Move annotation",
      coalesceKey: `annmove:${plotId}:${id}`,
      do: () => {
        plot.annotations = after;
      },
      undo: () => {
        plot.annotations = before;
      },
    });
  }

  /** Ids the builder synthesizes for elements that have no `plot.annotations` entry (pyramid
   *  value labels, PCA loading arrows + their variable labels). They are regenerated from the
   *  analysis on every rebuild, so edits to them persist as presentation overrides on the
   *  owning plot's style instead — see [[updateSynthElement]] / [[moveSynthLabel]]. */
  private static readonly SYNTH_ID_RE = /^(?:pyr-val-.+|pca-(?:arrow|vlabel)-\d+|ba-(?:bias|loa-hi|loa-lo))$/;

  /** Persist a drag of a builder-synthesized label (one with no backing annotation — pyramid
   *  value labels `pyr-val-<ds>-<row>`, PCA loading labels `pca-vlabel-<i>`) as a fractional
   *  plot-rect position override on the owning plot's style, so the builder repositions it on
   *  rebuild. Only pure x/y translations apply; a resize/rotate patch or an unrecognised id is
   *  a graceful no-op. Coalesced (one undo per drag) like [[moveAnnotation]]. */
  private moveSynthLabel(
    plot: Plot,
    id: NodeId,
    patch: Partial<Pick<Annotation, "x" | "y">>,
  ): void {
    if (patch.x === undefined || patch.y === undefined) {
      // Not a deliberate no-op: a reference line moves by `value`, and a shape by w/h/rotation,
      // so quietly ignoring "no x/y here" would swallow exactly those drags. The renderer is
      // supposed to refuse these via AnnotationScene.locked — if one still arrives, it's a bug.
      unresolvedTarget(
        "moveAnnotation",
        `synthesized element "${id}" on plot ${plot.id} (patch: ${Object.keys(patch).join(", ") || "empty"} — no x/y translation)`,
        "Either persist this geometry as an override on the owning plot's style, or mark the annotation locked so the renderer never offers the drag.",
      );
      return;
    }
    const pos = { x: patch.x, y: patch.y };
    const pyr = /^pyr-val-(.+)$/.exec(id);
    if (pyr) {
      const key = pyr[1]!;
      const prevStyle = plot.pyramid;
      const nextStyle: PyramidStyle = { ...(prevStyle ?? {}), valueLabelPos: { ...(prevStyle?.valueLabelPos ?? {}), [key]: pos } };
      this.commands.execute({
        label: "Move label",
        coalesceKey: `annmove:${plot.id}:${id}`,
        do: () => { plot.pyramid = nextStyle; },
        undo: () => { plot.pyramid = prevStyle; },
      });
      return;
    }
    // `s`-prefixed keys are the species points of an ordination (the same store, keys that
    // cannot collide with a loading's); plain digits are loading labels.
    const pca = /^pca-vlabel-([se]?\d+)$/.exec(id);
    if (pca) {
      const key = pca[1]!;
      const prevStyle = plot.pcaStyle;
      const nextStyle: PcaStyle = { ...(prevStyle ?? {}), labelPos: { ...(prevStyle?.labelPos ?? {}), [key]: pos } };
      this.commands.execute({
        label: "Move label",
        coalesceKey: `annmove:${plot.id}:${id}`,
        do: () => { plot.pcaStyle = nextStyle; },
        undo: () => { plot.pcaStyle = prevStyle; },
      });
      return;
    }
    // Fell through every known synth-id pattern: something on the canvas is draggable but
    // nothing here persists it, so the drag would be silently lost. Fail loudly.
    unresolvedTarget(
      "moveAnnotation",
      `synthesized element "${id}" on plot ${plot.id}`,
      "Add a branch here that writes a position override on the owning plot's style (see the pyramid/PCA cases), or stop the renderer offering the drag (AnnotationScene.locked).",
    );
  }

  /** Persist an edit of a builder-synthesized element (one with no backing annotation) as a
   *  presentation override on the owning plot's style, so the builder redraws it on rebuild:
   *    • Rename (`label`) — pyramid value `pyr-val-<ds>-<row>`, PCA loading `pca-vlabel-<i>`.
   *      Blank restores the data-derived default.
   *    • Recolour (`color`) — a PCA loading vector, selected by either its arrow
   *      (`pca-arrow-<i>`) or its label (`pca-vlabel-<i>`); both paint the pair together.
   *      undefined restores the shared loadings colour.
   *  An id or patch field that is not wired throws — otherwise an editor would take input
   *  and silently drop it (see [[unresolvedTarget]]). */
  private updateSynthElement(plot: Plot, id: NodeId, patch: Partial<Omit<Annotation, "id" | "kind">>): void {
    if ("color" in patch) {
      /**
       * The id decides which map. If both ids wrote `arrowColors`, the arrow and its variable
       * label could never differ, though the arrow and its name must be able to take
       * different colours. The label falls back to the arrow's colour in the builder, so a
       * chart nobody has touched still draws the pair as one unit.
       */
      // `e` / `s` keys: a triplot's explanatory arrows and an ordination's species arrows — the
      // builder reads `arrowColors` / `varLabelColors` under those keys too.
      const vec = /^pca-(arrow|vlabel)-([se]?\d+)$/.exec(id);
      if (vec) {
        const isLabel = vec[1] === "vlabel";
        const key = vec[2]!;
        const c = (patch as { color?: unknown }).color;
        const prevStyle = plot.pcaStyle;
        const next = { ...((isLabel ? prevStyle?.varLabelColors : prevStyle?.arrowColors) ?? {}) };
        if (typeof c === "string" && c !== "") next[key] = c;
        else delete next[key];
        const live = Object.keys(next).length ? next : undefined;
        const nextStyle: PcaStyle = { ...(prevStyle ?? {}), ...(isLabel ? { varLabelColors: live } : { arrowColors: live }) };
        this.commands.execute({
          label: isLabel ? "Loading label colour" : "Loading colour",
          do: () => { plot.pcaStyle = nextStyle; },
          undo: () => { plot.pcaStyle = prevStyle; },
        });
        return;
      }
    }
    const raw = (patch as { label?: unknown }).label;
    if (typeof raw !== "string") {
      // Not a rename and not a handled recolour → nobody wired this field for this element.
      unresolvedTarget(
        "updateAnnotation",
        `synthesized element "${id}" on plot ${plot.id} (patch: ${Object.keys(patch).join(", ") || "empty"})`,
        "Add a branch that persists this field as a presentation override on the owning plot's style, or stop the editor offering it.",
      );
      return;
    }
    const text = raw.trim();
    const put = (rec: Record<string, string> | undefined, key: string): Record<string, string> | undefined => {
      const next = { ...(rec ?? {}) };
      if (text === "") delete next[key];
      else next[key] = raw;
      return Object.keys(next).length ? next : undefined;
    };
    const pyr = /^pyr-val-(.+)$/.exec(id);
    if (pyr) {
      const key = pyr[1]!;
      const prevStyle = plot.pyramid;
      const nextStyle: PyramidStyle = { ...(prevStyle ?? {}), valueLabelText: put(prevStyle?.valueLabelText, key) };
      this.commands.execute({
        label: "Edit label",
        do: () => { plot.pyramid = nextStyle; },
        undo: () => { plot.pyramid = prevStyle; },
      });
      return;
    }
    // A builder-owned reference line's readout (Bland-Altman "Bias 0.42" / "±1.96 SD").
    // The line stays at its computed value — only the wording is the user's.
    if (isRefLineId(id)) {
      const prevLabels = plot.refLineLabels;
      const nextLabels = put(prevLabels, id);
      this.commands.execute({
        label: "Edit label",
        do: () => { plot.refLineLabels = nextLabels; },
        undo: () => { plot.refLineLabels = prevLabels; },
      });
      return;
    }
    // `s`-prefixed keys are the species points of an ordination (the same store, keys that
    // cannot collide with a loading's); plain digits are loading labels.
    const pca = /^pca-vlabel-([se]?\d+)$/.exec(id);
    if (pca) {
      const key = pca[1]!;
      const prevStyle = plot.pcaStyle;
      const nextStyle: PcaStyle = { ...(prevStyle ?? {}), varLabelText: put(prevStyle?.varLabelText, key) };
      this.commands.execute({
        label: "Edit label",
        do: () => { plot.pcaStyle = nextStyle; },
        undo: () => { plot.pcaStyle = prevStyle; },
      });
      return;
    }
    if (/^pca-arrow-e?\d+$/.test(id)) {
      // An arrow carries no text of its own — the variable name is a separate pca-vlabel-*
      // element, and the renderer opens no editor on the arrow. Nothing to persist.
      deliberateNoop("updateAnnotation", `${id}: a loading arrow has no text; its name is the sibling pca-vlabel-* element`);
      return;
    }
    // A rename aimed at a synth id nobody wired: the editor opened, took the user's text,
    // and would drop it. Fail loudly rather than lose the text silently.
    unresolvedTarget(
      "updateAnnotation",
      `rename of synthesized element "${id}" on plot ${plot.id}`,
      "Add a branch that persists the text as a presentation override (see valueLabelText / varLabelText), or stop the renderer opening an editor on it.",
    );
  }

  /**
   * Nudge a synthetic reference line's caption off the anchor the builder chose (px, absolute
   * — the drag reports where the label now sits, not a delta). Coalesced to one undo per drag.
   *
   * The line does not move. It sits at a computed statistic (Bland-Altman's bias = the mean
   * difference, the limits = bias ± k·SD), so dragging it would draw a bias the data does not
   * have. The caption is presentation and moves freely — e.g. a "+1.96 SD" readout that lands
   * on the data can be lifted off it.
   */
  moveRefLineLabel(plotId: NodeId, id: string, dx: number, dy: number): void {
    const plot = this.requirePlot(plotId);
    // A line the user drew (hline / vline / segment / arrow): its caption drags on its own as
    // well (so it can be carried onto the legend), stored on the annotation itself. Only the
    // words move; the line keeps its value / ends.
    const own = (plot.annotations ?? []).find((a) => a.id === id);
    if (own && canJoinLegend(own.kind)) {
      const before = plot.annotations ?? [];
      const labelOffset = dx === 0 && dy === 0 ? undefined : { dx, dy };
      const after = before.map((a) => (a.id === id ? { ...a, labelOffset } : a));
      this.commands.execute({
        label: "Move label",
        coalesceKey: `annlabel:${plot.id}:${id}`,
        do: () => { plot.annotations = after; },
        undo: () => { plot.annotations = before; },
      });
      return;
    }
    if (!isRefLineId(id)) {
      unresolvedTarget(
        "moveRefLineLabel",
        `reference line "${id}" on plot ${plot.id}`,
        "Register this line in `REFERENCE_LINES` (core/refLines.ts), or stop the renderer offering the label drag (drop AnnotationScene.labelOffset for it).",
      );
      return;
    }
    const prev = plot.refLineLabelOffsets;
    const next = { ...(prev ?? {}) };
    // Back at the anchor = no override, so the record does not grow an entry per line the
    // user merely wobbled and put back.
    if (dx === 0 && dy === 0) delete next[id];
    else next[id] = { dx, dy };
    const after = Object.keys(next).length ? next : undefined;
    this.commands.execute({
      label: "Move label",
      coalesceKey: `reflinelabel:${plot.id}:${id}`,
      do: () => { plot.refLineLabelOffsets = after; },
      undo: () => { plot.refLineLabelOffsets = prev; },
    });
  }

  /** Group a set of annotations so they move together (assigns a fresh shared `group` id to every
   *  unlocked member; needs ≥ 2). Members already in other groups are re-assigned to the new one. */
  groupAnnotations(plotId: NodeId, ids: NodeId[]): void {
    const plot = this.requirePlot(plotId);
    const before = plot.annotations ?? [];
    const wanted = new Set(ids);
    const targets = before.filter((a) => wanted.has(a.id) && !a.locked);
    if (targets.length < 2) return;
    const gid = this.ids.next("grp");
    const targetIds = new Set(targets.map((a) => a.id));
    const after = before.map((a) => (targetIds.has(a.id) ? { ...a, group: gid } : a));
    this.commands.execute({
      label: "Group objects",
      do: () => {
        plot.annotations = after;
      },
      undo: () => {
        plot.annotations = before;
      },
    });
  }

  /** Ungroup: dissolve the group(s) that the selected annotations belong to (clears `group` from every
   *  member of each affected group, so selecting one member ungroups the whole group). */
  ungroupAnnotations(plotId: NodeId, ids: NodeId[]): void {
    const plot = this.requirePlot(plotId);
    const before = plot.annotations ?? [];
    const wanted = new Set(ids);
    const groups = new Set(before.filter((a) => wanted.has(a.id) && a.group !== undefined).map((a) => a.group));
    if (groups.size === 0) return;
    const after = before.map((a) => (a.group !== undefined && groups.has(a.group) ? { ...a, group: undefined } : a));
    this.commands.execute({
      label: "Ungroup objects",
      do: () => {
        plot.annotations = after;
      },
      undo: () => {
        plot.annotations = before;
      },
    });
  }

  /** Lock / unlock annotations so they can't be moved or resized by dragging (style/text edits still work). */
  setAnnotationLocked(plotId: NodeId, ids: NodeId[], locked: boolean): void {
    const plot = this.requirePlot(plotId);
    const before = plot.annotations ?? [];
    const wanted = new Set(ids);
    if (!before.some((a) => wanted.has(a.id) && Boolean(a.locked) !== locked)) return; // no change
    const after = before.map((a) => (wanted.has(a.id) ? { ...a, locked: locked || undefined } : a));
    this.commands.execute({
      label: locked ? "Lock objects" : "Unlock objects",
      do: () => {
        plot.annotations = after;
      },
      undo: () => {
        plot.annotations = before;
      },
    });
  }

  /**
   * Align / distribute / equalise a set of annotations as one undoable step (the
   * "Arrange objects" toolbar). Operates on the freely-2-D-positionable kinds
   * (text · callout · rect · ellipse · arrow · segment) — axis-locked kinds
   * (reference lines, brackets, bands) are silently skipped. Geometry is fractional
   * plot-space, so the result is resolution-independent. Align / distribute / centre
   * translate each object's anchor point(s); equalise-size resizes rect/ellipse only
   * (the only kinds with an editable box). A <2-object selection is a no-op.
   */
  alignAnnotations(plotId: NodeId, ids: NodeId[], op: AlignOp): void {
    const plot = this.requirePlot(plotId);
    const list = plot.annotations ?? [];
    const wanted = new Set(ids);
    const sizeOp = op === "equalize-w" || op === "equalize-h";
    // The arrangeable subset in document order; equalise only makes sense for the
    // sized kinds (a text anchor / arrow endpoint has no editable width/height box).
    const sel = list.filter(
      (a) =>
        wanted.has(a.id) &&
        isArrangeableAnnotation(a.kind) &&
        (!sizeOp || a.kind === "rect" || a.kind === "ellipse" || a.kind === "image"),
    );
    if (sel.length < 2) return;

    // Fractional bounding box for each selected annotation.
    const boxOf = (a: Annotation): Box => {
      if (a.kind === "text" || a.kind === "callout") return { x: a.x ?? 0.5, y: a.y ?? 0.12, w: 0, h: 0 };
      if (a.kind === "rect" || a.kind === "ellipse" || a.kind === "image") return { x: a.x ?? 0.32, y: a.y ?? 0.3, w: a.w ?? 0.26, h: a.h ?? 0.2 };
      // arrow / segment: bounding box of the two endpoints.
      const x1 = a.x ?? 0.3, y1 = a.y ?? 0.5, x2 = a.x2 ?? 0.6, y2 = a.y2 ?? 0.5;
      return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
    };
    const before = sel.map(boxOf);
    const after = arrangeBoxes(before, op);

    // Turn each box delta into a kind-appropriate patch: align/distribute/centre
    // shift the anchor point(s) by (dx,dy); equalise changes w/h (dx=dy=0 there).
    const patchOf = (a: Annotation, i: number): Partial<Annotation> => {
      const o = before[i]!, n = after[i]!;
      const dx = n.x - o.x, dy = n.y - o.y, dw = n.w - o.w, dh = n.h - o.h;
      if (a.kind === "text") return { x: (a.x ?? 0.5) + dx, y: (a.y ?? 0.12) + dy };
      if (a.kind === "callout")
        return { x: (a.x ?? 0.2) + dx, y: (a.y ?? 0.2) + dy, x2: (a.x2 ?? 0.5) + dx, y2: (a.y2 ?? 0.5) + dy };
      if (a.kind === "rect" || a.kind === "ellipse" || a.kind === "image")
        return { x: (a.x ?? 0.32) + dx, y: (a.y ?? 0.3) + dy, w: (a.w ?? 0.26) + dw, h: (a.h ?? 0.2) + dh };
      // arrow / segment: translate both endpoints (equalise excluded above).
      return { x: (a.x ?? 0.3) + dx, y: (a.y ?? 0.5) + dy, x2: (a.x2 ?? 0.6) + dx, y2: (a.y2 ?? 0.5) + dy };
    };
    const patches = new Map<NodeId, Partial<Annotation>>();
    sel.forEach((a, i) => patches.set(a.id, patchOf(a, i)));

    const prev = list;
    const next = list.map((a) => (patches.has(a.id) ? { ...a, ...patches.get(a.id) } : a));
    this.commands.execute({
      label: "Arrange objects",
      do: () => {
        plot.annotations = next;
      },
      undo: () => {
        plot.annotations = prev;
      },
    });
  }

  /** Change an annotation's z-order (draw order = array order). "front" = last, "back" = first. */
  reorderAnnotation(plotId: NodeId, id: NodeId, to: "front" | "back"): void {
    const plot = this.requirePlot(plotId);
    const prev = plot.annotations ?? [];
    const target = prev.find((a) => a.id === id);
    if (!target) return;
    const rest = prev.filter((a) => a.id !== id);
    const next = to === "front" ? [...rest, target] : [target, ...rest];
    this.commands.execute({
      label: to === "front" ? "Bring to front" : "Send to back",
      do: () => {
        plot.annotations = next;
      },
      undo: () => {
        plot.annotations = prev;
      },
    });
  }

  /** Remove an annotation from a graph. Presentation only. */
  removeAnnotation(plotId: NodeId, id: NodeId): void {
    const plot = this.requirePlot(plotId);
    const prev = plot.annotations;
    if (!(prev ?? []).some((a) => a.id === id)) {
      // Nothing to remove. Without this guard the command below would still run, pushing an
      // empty undo step for a change that never happened.
      if (MadyDocument.SYNTH_ID_RE.test(id)) {
        deliberateNoop(
          "removeAnnotation",
          `${id}: builder-owned element (regenerated from the analysis on every rebuild), so there is nothing to delete — the renderer must not offer a delete grip on it (AnnotationScene.locked)`,
        );
      } else {
        unresolvedTarget("removeAnnotation", `annotation "${id}" on plot ${plot.id}`);
      }
      return;
    }
    const next = (prev ?? []).filter((a) => a.id !== id);
    this.commands.execute({
      label: "Remove annotation",
      do: () => {
        plot.annotations = next.length > 0 ? next : undefined;
      },
      undo: () => {
        plot.annotations = prev;
      },
    });
  }

  /** Set the bar-chart arrangement (grouped/stacked). Presentation only. */
  setBarLayout(plotId: NodeId, layout: BarLayout | undefined): void {
    const plot = this.requirePlot(plotId);
    const prev = plot.barLayout;
    this.commands.execute({
      label: "Set bar layout",
      do: () => {
        plot.barLayout = layout;
      },
      undo: () => {
        plot.barLayout = prev;
      },
    });
  }

  /** Set the bar corner shape (square/rounded/round-top). Presentation only. */
  setBarShape(plotId: NodeId, shape: BarShape | undefined): void {
    const plot = this.requirePlot(plotId);
    const prev = plot.barShape;
    this.commands.execute({
      label: "Set bar shape",
      do: () => {
        plot.barShape = shape;
      },
      undo: () => {
        plot.barShape = prev;
      },
    });
  }

  /**
   * Merge presentation-only plot fields (pie/heatmap options, etc.) in one
   * undoable step. Generic so a panel can patch several fields at once without a
   * bespoke setter each.
   */
  setPlotOptions(plotId: NodeId, patch: Partial<Plot>): void {
    const plot = this.requirePlot(plotId);
    if (patch.analysisSource && patch.analysisResultVersion === undefined && patch.analysisSource !== plot.analysisSource) {
      const analysis = this.project.analyses.find(a => a.id === patch.analysisSource);
      patch = { ...patch, analysisResultVersion: analysis?.resultVersion ?? 0, snapshotStale: false };
    }
    const keys = Object.keys(patch) as (keyof Plot)[];
    const prev = {} as Partial<Plot>;
    for (const k of keys) prev[k] = plot[k] as never;
    this.commands.execute({
      label: "Edit graph",
      do: () => Object.assign(plot, patch),
      undo: () => {
        for (const k of keys) plot[k] = prev[k] as never;
      },
    });
  }

  /**
   * Apply a graph-style preset (or the user profile) — fonts, axis thickness,
   * gridlines, frame/tick style, and the series palette — as one undoable action.
   * Fonts are replaced wholesale; the palette is merged into each dataset's series
   * style (preserving its other style fields); axis line widths merge into the
   * existing axis specs. Presentation only.
   */
  applyStylePreset(plotId: NodeId, preset: StylePreset): void {
    const plot = this.requirePlot(plotId);
    const table = this.requireTable(plot.source);
    const datasets = tableDatasets(table);
    const fam = preset.fontFamily;
    const font = (size: number, bold?: boolean): FontSpec => ({
      size,
      ...(fam ? { family: fam } : {}),
      ...(bold ? { bold: true } : {}),
    });
    const nextFonts: Partial<Record<FontElement, FontSpec>> = {
      title: font(preset.titleSize, preset.titleBold),
      subtitle: font(preset.subtitleSize),
      axisTitle: font(preset.axisTitleSize, preset.axisTitleBold),
      tick: { ...font(preset.tickSize), ...(preset.tickColor != null ? { color: preset.tickColor } : {}) },
      legend: font(preset.legendSize),
      // The slice / value label sizes, written only when the preset defines them (no built-in
      // does): every other key above is replaced wholesale, and these two follow that rule for a
      // preset that carries them while staying absent for one that does not.
      ...(preset.sliceLabelSize != null ? { sliceLabel: font(preset.sliceLabelSize) } : {}),
      ...(preset.valueLabelSize != null ? { valueLabel: font(preset.valueLabelSize) } : {}),
    };
    const axisExtra = preset.axisColor != null ? { lineColor: preset.axisColor } : {};
    /**
     * The captured-on-definition axis parameters are written only when the preset defines
     * them. Rule: a new preset parameter must not change the current defaults or any
     * existing preset.
     *
     * The marker fields below are written unconditionally on purpose — switching presets must not
     * leave the previous one's halo behind. Copying that pattern here would be wrong: no built-in sets these, so an unconditional write would push `undefined` over the
     * tick length and title spacing the user set by hand, on every preset apply, on every graph.
     * Writing them only when defined leaves every existing preset's output unchanged, which
     * `preset-invariance.test.ts` checks.
     */
    const axisCaptured: AxisSpec = {
      ...(preset.tickWidth != null ? { tickWidth: preset.tickWidth } : {}),
      ...(preset.titleGap != null ? { titleGap: preset.titleGap } : {}),
      ...(preset.tickLabelGap != null ? { tickLabelGap: preset.tickLabelGap } : {}),
    };
    const nextX: AxisSpec = { ...(plot.xAxis ?? {}), lineWidth: preset.axisThickness, ...axisExtra, ...axisCaptured };
    const nextY: AxisSpec = { ...(plot.yAxis ?? {}), lineWidth: preset.axisThickness, ...axisExtra, ...axisCaptured };
    const nextGrid: GridStyle = {
      ...(plot.grid ?? {}),
      show: preset.gridShow,
      ...(preset.gridWidth != null ? { width: preset.gridWidth } : {}),
      ...(preset.gridDash ? { dash: preset.gridDash } : {}),
      ...(preset.gridColor != null ? { color: preset.gridColor } : {}),
      ...(preset.gridDensity != null ? { density: preset.gridDensity } : {}),
    };
    // Merge the palette colour (+ optional line/marker weights + modern marker
    // halo / fill) into each dataset's series style, preserving everything else.
    const nextStyles: Record<NodeId, SeriesStyle> = { ...(plot.seriesStyles ?? {}) };
    datasets.forEach((ds, i) => {
      const color = preset.palette[i % preset.palette.length];
      // The marker/line fields are always written (preset value, or undefined to clear)
      // so applying a preset fully replaces the look — otherwise a field one preset sets
      // (e.g. a white marker outline) lingers when you switch to a preset that doesn't,
      // corrupting the new style. Applying a preset = restyle the whole graph.
      nextStyles[ds.id] = {
        ...(nextStyles[ds.id] ?? {}),
        color,
        lineWidth: preset.seriesLineWidth,
        symbolSize: preset.markerSize,
        symbolFill: preset.symbolFill,
        symbolOutline: preset.symbolOutline,
        borderWidth: preset.symbolBorderWidth,
        symbolFillColor: preset.symbolFillColor,
        fillOpacity: preset.fillOpacity,
        // The bar/box/area fill treatment, separate from the marker's `symbolFill` above.
        // Undefined for presets that do not specify one → the builder's `solid` default.
        fillType: preset.fillType,
        /**
         * The shape cycle is conditional, unlike every marker field above it. Those are
         * written unconditionally so switching presets cannot leave the previous one's halo
         * behind; most presets carry no `symbolShapes`, so writing it unconditionally would clear
         * the shape the user chose by hand, on every preset apply, on every graph.
         */
        ...(preset.symbolShapes && preset.symbolShapes.length
          ? { symbol: preset.symbolShapes[i % preset.symbolShapes.length] }
          : {}),
        // Marker opacity, conditional for the same reason: only Universal design carries one
        // (alpha = 0.7), and an unconditional write would reset a hand-set opacity
        // on every other preset apply.
        ...(preset.symbolOpacity != null ? { symbolOpacity: preset.symbolOpacity } : {}),
      };
    });
    // A PCA / ordination plot draws its groups as `pca-g0`… (first-appearance order, as the
    // builder lists them; `pca-scores` when ungrouped) — series the table's datasets never name,
    // so the loop above does not reach them and they would keep solid, opaque circles under a
    // preset whose columns are shape-cycled and see-through. They take the same cycle and marker
    // look here. Only when the preset carries a cycle or an opacity (among the built-ins, only
    // Universal design): every other built-in must keep drawing exactly what it drew.
    // And only on the kinds that draw the groups — the loadings and scree plots carry the same
    // `pca` data and would otherwise be handed styles for series they never draw.
    const drawsPcaGroups = plot.kind === "pcascore" || plot.kind === "pcabiplot" || plot.kind === "triplot";
    if (drawsPcaGroups && plot.pca && ((preset.symbolShapes && preset.symbolShapes.length) || preset.symbolOpacity != null)) {
      const groups = plot.pca.groups ? [...new Set(plot.pca.groups)] : [];
      const ids = groups.length ? groups.map((_, gi) => `pca-g${gi}`) : ["pca-scores"];
      // Round when the dots are depth-sized (sites and biplot are round because their legend
      // is a bubble key, only the colour differs): the size key beside the
      // plot is drawn as circles, so a triangle sized by PC3 cannot be read against it. The score
      // plot and biplot size by the first unplotted component when there is one (-1 switches it
      // off); the triplot never does, and keeps the cycle.
      const ncomp = plot.pca.pcLabels?.length ?? plot.pca.scores[0]?.length ?? 0;
      const depthSized = (plot.kind === "pcascore" || plot.kind === "pcabiplot") && ncomp >= 3 && (plot.pcaStyle?.sizeComponent ?? 0) >= 0;
      ids.forEach((id, gi) => {
        nextStyles[id] = {
          ...(nextStyles[id] ?? {}),
          ...(!depthSized && preset.symbolShapes && preset.symbolShapes.length ? { symbol: preset.symbolShapes[gi % preset.symbolShapes.length]! } : {}),
          ...(preset.symbolFill ? { symbolFill: preset.symbolFill } : {}),
          ...(preset.symbolOutline ? { symbolOutline: preset.symbolOutline } : {}),
          ...(preset.symbolBorderWidth != null ? { borderWidth: preset.symbolBorderWidth } : {}),
          ...(preset.symbolOpacity != null ? { symbolOpacity: preset.symbolOpacity } : {}),
        };
      });
    }

    const prev = {
      background: plot.background,
      legend: plot.legend,
      // `tickLen` is in this snapshot because the do-block writes it when a preset defines one,
      // so undo has to be able to put it back.
      tickLen: plot.tickLen,
      fonts: plot.fonts,
      xAxis: plot.xAxis,
      yAxis: plot.yAxis,
      grid: plot.grid,
      frame: plot.frame,
      tickDir: plot.tickDir,
      titleAlign: plot.titleAlign,
      seriesStyles: plot.seriesStyles,
      palette: plot.palette,
      paletteColors: plot.paletteColors,
    };
    this.commands.execute({
      label: `Apply style: ${preset.name}`,
      do: () => {
        plot.fonts = nextFonts;
        plot.xAxis = nextX;
        plot.yAxis = nextY;
        plot.grid = nextGrid;
        if (preset.frame) plot.frame = preset.frame;
        if (preset.tickDir) plot.tickDir = preset.tickDir;
        // Editorial uses a left-aligned title; other presets reset to centred.
        plot.titleAlign = preset.titleAlign ?? "center";
        plot.seriesStyles = nextStyles;
        // The palette must reach the builder-coloured kinds too (survival/ROC/PCA/
        // treemap/parallel/…, which draw from the scene `palette` option, not from
        // per-dataset seriesStyles). A named registry choice is superseded: applying
        // a preset restyles the whole graph.
        plot.paletteColors = [...preset.palette];
        plot.palette = undefined;
        // The paper colour. Always written (the value, or undefined to clear) for the same
        // reason the marker fields are: applying a preset restyles the whole graph, so a
        // colour one preset sets must not linger under a preset that sets none.
        plot.background = preset.background;
        // …and the tick length, only when the preset carries one (see the note above the axis
        // spread): an unconditional write would clear a hand-set tick length on every apply.
        if (preset.tickLen != null) plot.tickLen = preset.tickLen;
        // The legend's look, merged over the graph's own (and only when the preset carries one),
        // so a preset that says nothing about the legend leaves every field of it alone.
        if (preset.legend) plot.legend = { ...(plot.legend ?? {}), ...preset.legend };
      },
      undo: () => {
        plot.background = prev.background;
        plot.tickLen = prev.tickLen;
        plot.legend = prev.legend;
        plot.fonts = prev.fonts;
        plot.xAxis = prev.xAxis;
        plot.yAxis = prev.yAxis;
        plot.grid = prev.grid;
        plot.frame = prev.frame;
        plot.tickDir = prev.tickDir;
        plot.titleAlign = prev.titleAlign;
        plot.seriesStyles = prev.seriesStyles;
        plot.palette = prev.palette;
        plot.paletteColors = prev.paletteColors;
      },
    });
  }

  /**
   * Apply a partial style — only the fields present in `params` — layered on top of
   * whatever the plot already has (unlike `applyStylePreset`, which replaces the whole
   * look). Used for the user's global "common defaults" (title font/size, axis
   * thickness/colour, grid, palette) so a new graph inherits them without clobbering
   * its per-type preset. Deep-merges fonts/axes so untouched fields survive.
   */
  applyStyleParams(plotId: NodeId, params: Partial<StylePreset>): void {
    const plot = this.requirePlot(plotId);
    const prev = { fonts: plot.fonts, xAxis: plot.xAxis, yAxis: plot.yAxis, grid: plot.grid, seriesStyles: plot.seriesStyles };

    let nextFonts = plot.fonts;
    if (params.fontFamily !== undefined || params.titleSize !== undefined || params.titleBold !== undefined) {
      const fonts: Partial<Record<FontElement, FontSpec>> = { ...(plot.fonts ?? {}) };
      const setEl = (el: FontElement, patch: Partial<FontSpec>): void => { fonts[el] = { ...(fonts[el] ?? {}), ...patch }; };
      if (params.fontFamily !== undefined) {
        for (const el of ["title", "subtitle", "axisTitle", "tick", "legend"] as FontElement[]) setEl(el, { family: params.fontFamily });
      }
      if (params.titleSize !== undefined) setEl("title", { size: params.titleSize });
      if (params.titleBold !== undefined) setEl("title", { bold: params.titleBold });
      nextFonts = fonts;
    }

    let nextX = plot.xAxis;
    let nextY = plot.yAxis;
    if (params.axisThickness !== undefined || params.axisColor !== undefined) {
      const patch: AxisSpec = {
        ...(params.axisThickness !== undefined ? { lineWidth: params.axisThickness } : {}),
        ...(params.axisColor !== undefined ? { lineColor: params.axisColor } : {}),
      };
      nextX = { ...(plot.xAxis ?? {}), ...patch };
      nextY = { ...(plot.yAxis ?? {}), ...patch };
    }

    let nextGrid = plot.grid;
    if (params.gridShow !== undefined) nextGrid = { ...(plot.grid ?? {}), show: params.gridShow };

    let nextStyles = plot.seriesStyles;
    if (params.palette && params.palette.length) {
      const pal = params.palette;
      const datasets = tableDatasets(this.requireTable(plot.source));
      const styles: Record<NodeId, SeriesStyle> = { ...(plot.seriesStyles ?? {}) };
      datasets.forEach((ds, i) => { styles[ds.id] = { ...(styles[ds.id] ?? {}), color: pal[i % pal.length]! }; });
      nextStyles = styles;
    }

    if (nextFonts === plot.fonts && nextX === plot.xAxis && nextY === plot.yAxis && nextGrid === plot.grid && nextStyles === plot.seriesStyles) {
      return; // nothing to apply
    }
    const prevPalette = { palette: plot.palette, paletteColors: plot.paletteColors };
    const nextPaletteColors = params.palette && params.palette.length ? [...params.palette] : undefined;
    this.commands.execute({
      label: "Apply default style",
      do: () => {
        plot.fonts = nextFonts;
        plot.xAxis = nextX;
        plot.yAxis = nextY;
        plot.grid = nextGrid;
        plot.seriesStyles = nextStyles;
        // The global palette param reaches the builder-coloured kinds too.
        if (nextPaletteColors) { plot.paletteColors = nextPaletteColors; plot.palette = undefined; }
      },
      undo: () => {
        plot.fonts = prev.fonts;
        plot.xAxis = prev.xAxis;
        plot.yAxis = prev.yAxis;
        plot.grid = prev.grid;
        plot.seriesStyles = prev.seriesStyles;
        if (nextPaletteColors) { plot.palette = prevPalette.palette; plot.paletteColors = prevPalette.paletteColors; }
      },
    });
  }

  /** Set the box-plot whisker definition (tukey/minmax/percentile). Presentation only. */
  setBoxWhisker(plotId: NodeId, whisker: BoxWhisker | undefined): void {
    const plot = this.requirePlot(plotId);
    const prev = plot.boxWhisker;
    this.commands.execute({
      label: "Set whiskers",
      do: () => {
        plot.boxWhisker = whisker;
      },
      undo: () => {
        plot.boxWhisker = prev;
      },
    });
  }

  /**
   * Live mouse-resize of a box's width (fraction of its band). Coalesces the
   * whole drag into one undo entry; `commit:false` during the drag, `true` on
   * release (both apply — the flag just lets callers be explicit). Presentation.
   */
  resizeBoxWidth(plotId: NodeId, seriesId: NodeId, fraction: number): void {
    const plot = this.requirePlot(plotId);
    const w = Math.min(0.9, Math.max(0.1, fraction));
    const prev = plot.seriesStyles?.[seriesId];
    this.commands.execute({
      label: "Resize box",
      coalesceKey: `boxw:${plotId}:${seriesId}`,
      do: () => {
        plot.seriesStyles = { ...(plot.seriesStyles ?? {}), [seriesId]: { ...(prev ?? {}), boxWidth: w } };
      },
      undo: () => {
        const next = { ...(plot.seriesStyles ?? {}) };
        if (prev === undefined) delete next[seriesId];
        else next[seriesId] = prev;
        plot.seriesStyles = next;
      },
    });
  }

  /**
   * `resizeBoxWidth` for every series at once — the "Apply to whole graph" scope.
   *
   * Box width is stored per-series (`SeriesStyle.boxWidth`), so dragging one box edge could
   * only ever move that one box; with the whole-graph scope ticked the user is asking for all
   * of them. Shares this file's clamp and coalesces the whole drag into one undo entry, so
   * Ctrl+Z after a bulk resize restores every box together rather than one per step.
   */
  resizeBoxWidthAll(plotId: NodeId, seriesIds: NodeId[], fraction: number): void {
    const plot = this.requirePlot(plotId);
    const w = Math.min(0.9, Math.max(0.1, fraction));
    const prevById = new Map<NodeId, SeriesStyle | undefined>();
    for (const id of seriesIds) prevById.set(id, plot.seriesStyles?.[id]);
    this.commands.execute({
      label: "Resize boxes",
      coalesceKey: `boxwAll:${plotId}`,
      do: () => {
        const next = { ...(plot.seriesStyles ?? {}) };
        for (const id of seriesIds) next[id] = { ...(next[id] ?? {}), boxWidth: w };
        plot.seriesStyles = next;
      },
      undo: () => {
        const next = { ...(plot.seriesStyles ?? {}) };
        for (const id of seriesIds) {
          const p = prevById.get(id);
          if (p === undefined) delete next[id];
          else next[id] = p;
        }
        plot.seriesStyles = next;
      },
    });
  }

  /**
   * Live drag-resize of the whole figure (width/height px) from an on-canvas
   * handle. Coalesces the whole drag into one undo entry (like the width drags);
   * presentation only. Clamps to the inspector's slider ranges.
   */
  resizeFigure(plotId: NodeId, patch: { figureWidth?: number; figureHeight?: number }): void {
    const plot = this.requirePlot(plotId);
    const prevW = plot.figureWidth;
    const prevH = plot.figureHeight;
    const nextW = patch.figureWidth != null ? Math.round(Math.min(1200, Math.max(280, patch.figureWidth))) : prevW;
    const nextH = patch.figureHeight != null ? Math.round(Math.min(900, Math.max(180, patch.figureHeight))) : prevH;
    const prevXLen = plot.xAxisLength;
    const prevYLen = plot.yAxisLength;
    this.commands.execute({
      label: "Resize graph",
      coalesceKey: `figsize:${plotId}`,
      do: () => {
        plot.figureWidth = nextW;
        plot.figureHeight = nextH;
        // The figure-size gesture takes over from any explicit axis length.
        if (patch.figureWidth != null) plot.xAxisLength = undefined;
        if (patch.figureHeight != null) plot.yAxisLength = undefined;
      },
      undo: () => {
        plot.figureWidth = prevW;
        plot.figureHeight = prevH;
        plot.xAxisLength = prevXLen;
        plot.yAxisLength = prevYLen;
      },
    });
  }

  /**
   * Show the graph at `scale` × its laid-out size - a uniform scale of the whole drawing, never a re-layout
   * (resizing keeps proportions). The on-canvas corner and the Graph size box set it. One undo step
   * per drag (coalesced), clamped to 0.25-4 like the view zoom.
   */
  scaleFigure(plotId: NodeId, scale: number): void {
    const plot = this.requirePlot(plotId);
    const prev = plot.displayScale;
    const next = Number.isFinite(scale) ? Math.round(Math.min(4, Math.max(0.25, scale)) * 1000) / 1000 : prev;
    this.commands.execute({
      label: "Resize graph",
      coalesceKey: `figscale:${plotId}`,
      do: () => { plot.displayScale = next; },
      undo: () => { plot.displayScale = prev; },
    });
  }

  /**
   * Set an axis's length = the plotting-rectangle width (X) / height (Y) in px
   * (the "axis length"). `null` clears it (back to figure-derived). Coalesced
   * per axis so an on-canvas drag is one undo entry; presentation only.
   */
  setAxisLength(plotId: NodeId, axis: "x" | "y", length: number | null): void {
    const plot = this.requirePlot(plotId);
    const next = length == null ? undefined : Math.round(Math.min(2000, Math.max(40, length)));
    const prevX = plot.xAxisLength;
    const prevY = plot.yAxisLength;
    this.commands.execute({
      label: "Set axis length",
      coalesceKey: `axislen:${plotId}:${axis}`,
      do: () => {
        if (axis === "x") plot.xAxisLength = next;
        else plot.yAxisLength = next;
      },
      undo: () => {
        plot.xAxisLength = prevX;
        plot.yAxisLength = prevY;
      },
    });
  }

  /**
   * Orbit / zoom the 3-D scatter camera (drag to rotate, scroll to zoom). Merges
   * the patch into `plot.scatter3d`; `gesture` coalesces a whole drag/zoom into one
   * undo. Elevation is clamped so the view never flips; zoom is clamped to 0.3–4.
   */
  setScatter3DView(plotId: NodeId, patch: { azimuth?: number; elevation?: number; zoom?: number }, gesture?: string): void {
    const plot = this.requirePlot(plotId);
    const prev = plot.scatter3d;
    const clampEl = (v: number): number => Math.max(-1.45, Math.min(1.45, v)); // ~±83°
    const clampZoom = (v: number): number => Math.max(0.3, Math.min(4, v));
    const next = { ...(prev ?? {}) };
    if (patch.azimuth != null) next.azimuth = patch.azimuth;
    if (patch.elevation != null) next.elevation = clampEl(patch.elevation);
    if (patch.zoom != null) next.zoom = clampZoom(patch.zoom);
    this.commands.execute({
      label: "Rotate 3-D view",
      ...(gesture ? { coalesceKey: `cam3d:${plotId}:${gesture}` } : {}),
      do: () => { plot.scatter3d = next; },
      undo: () => { plot.scatter3d = prev; },
    });
  }

  /** Live mouse-resize of the bar group width (fraction of the band). Coalesced; presentation. */
  resizeBarWidth(plotId: NodeId, fraction: number): void {
    const plot = this.requirePlot(plotId);
    const w = Math.min(1, Math.max(0.1, fraction));
    const prev = plot.barWidth;
    this.commands.execute({
      label: "Resize bars",
      coalesceKey: `barw:${plotId}`,
      do: () => {
        plot.barWidth = w;
      },
      undo: () => {
        plot.barWidth = prev;
      },
    });
  }

  /** Merge a background-gridline style delta on a plot (presentation only). */
  setGridStyle(plotId: NodeId, delta: GridStyle): void {
    const plot = this.requirePlot(plotId);
    const prev = plot.grid;
    this.commands.execute({
      label: "Edit gridlines",
      do: () => {
        plot.grid = { ...(prev ?? {}), ...delta };
      },
      undo: () => {
        plot.grid = prev;
      },
    });
  }

  /** Set (or clear with null) an overlaid fitted curve on a plot (undoable). */
  setPlotFit(plotId: NodeId, fit: PlotFit | null): void {
    const plot = this.requirePlot(plotId);
    if (fit?.analysisSource && fit.analysisResultVersion === undefined)
      fit = { ...fit, analysisResultVersion: this.requireAnalysis(fit.analysisSource).resultVersion ?? 0 };
    const prev = plot.fit;
    const prevStale = plot.snapshotStale;
    this.commands.execute({
      label: fit ? "Add fitted curve" : "Remove fitted curve",
      do: () => {
        plot.fit = fit ?? undefined;
        plot.snapshotStale = !!prevStale && !!((!plot.analysisSource && (plot.roc || plot.survival || plot.pca))
          || plot.fits?.some(f => !f.analysisSource));
      },
      undo: () => {
        plot.fit = prev;
        plot.snapshotStale = prevStale;
      },
    });
  }

  /** Set (or clear with null) the per-dataset overlaid curves from a global fit (undoable). */
  setPlotFits(plotId: NodeId, fits: PlotFit[] | null): void {
    const plot = this.requirePlot(plotId);
    fits = fits?.map((fit) => fit.analysisSource && fit.analysisResultVersion === undefined
      ? { ...fit, analysisResultVersion: this.requireAnalysis(fit.analysisSource).resultVersion ?? 0 } : fit) ?? null;
    const prev = plot.fits;
    const prevStale = plot.snapshotStale;
    this.commands.execute({
      label: fits && fits.length ? "Add global-fit curves" : "Remove global-fit curves",
      do: () => {
        plot.fits = fits && fits.length ? fits : undefined;
        plot.snapshotStale = !!prevStale && !!((!plot.analysisSource && (plot.roc || plot.survival || plot.pca))
          || (plot.fit && !plot.fit.analysisSource));
      },
      undo: () => {
        plot.fits = prev;
        plot.snapshotStale = prevStale;
      },
    });
  }

  /** Turn a plot into a survival (Kaplan-Meier) chart of the given step curves. Presentation only. */
  setSurvival(plotId: NodeId, curves: SurvivalCurve[] | null, atRisk?: SurvivalAtRisk): void {
    const plot = this.requirePlot(plotId);
    const prev = { survival: plot.survival, kind: plot.kind, atRisk: plot.survivalAtRisk };
    this.commands.execute({
      label: "Plot survival curves",
      do: () => {
        if (curves) {
          plot.survival = curves;
          plot.survivalAtRisk = atRisk;
          plot.kind = "survival";
        } else {
          plot.survival = undefined;
          plot.survivalAtRisk = undefined;
          if (plot.kind === "survival") plot.kind = undefined;
        }
      },
      undo: () => {
        plot.survival = prev.survival;
        plot.survivalAtRisk = prev.atRisk;
        plot.kind = prev.kind;
      },
    });
  }

  /** Turn a plot into a ROC chart of the given curves (from a ROC analysis). Presentation only. */
  setRoc(plotId: NodeId, curves: RocCurve[] | null): void {
    const plot = this.requirePlot(plotId);
    const prev = { roc: plot.roc, kind: plot.kind };
    this.commands.execute({
      label: "Plot ROC curve",
      do: () => {
        if (curves) {
          plot.roc = curves;
          plot.kind = "roc";
        } else {
          plot.roc = undefined;
          if (plot.kind === "roc") plot.kind = undefined;
        }
      },
      undo: () => {
        plot.roc = prev.roc;
        plot.kind = prev.kind;
      },
    });
  }

  /** Turn a plot into a PCA graph (score/loadings/biplot/scree) from a PCA analysis'
   *  `extra.pca`. `kind` picks which of the four; null clears. Presentation only. */
  setPca(plotId: NodeId, data: PcaGraphData | null, kind: PlotKind = "pcascore"): void {
    const plot = this.requirePlot(plotId);
    const prev = { pca: plot.pca, kind: plot.kind };
    const PCA_KINDS: PlotKind[] = ["pcascore", "pcaload", "pcabiplot", "scree"];
    this.commands.execute({
      label: "Plot PCA graph",
      do: () => {
        if (data) {
          plot.pca = data;
          plot.kind = kind;
        } else {
          plot.pca = undefined;
          if (plot.kind && PCA_KINDS.includes(plot.kind)) plot.kind = undefined;
        }
      },
      undo: () => {
        plot.pca = prev.pca;
        plot.kind = prev.kind;
      },
    });
  }

  /**
   * Set the table-wide replicate count (the "number of subcolumns"): every Y
   * dataset is normalised to exactly `n` side-by-side replicate subcolumns —
   * extras are added (blank) and surplus removed — and the columns are re-laid
   * out contiguously [X · dataset₁ reps · dataset₂ reps · …] so the grid can
   * group them. One undoable command; dependent plots/analyses go stale.
   */
  setReplicateCount(tableId: NodeId, count: number): void {
    const n = Math.max(1, Math.min(MAX_REPLICATES, Math.floor(count)));
    this.mutateTable(tableId, "Set replicate count", (table) => {
      const x = xColumn(table);
      const datasets = tableDatasets(table);
      const byId = new Map(table.columns.map((c) => [c.id, c] as const));
      const next: Column[] = [];
      if (x) {
        x.role = "x";
        next.push(x);
      }
      // The shared X-error sub-column is not a Y dataset, so the dataset walk below never
      // re-adds it — carry it through, or the rebuild deletes it with its data.
      const xerr = xErrorColumn(table);
      if (xerr) next.push(xerr);
      for (const ds of datasets) {
        const reps = ds.replicates.map((id) => byId.get(id)).filter((c): c is Column => Boolean(c));
        const lead = reps[0];
        if (!lead) continue;
        lead.role = "y";
        lead.group = undefined;
        const kept = reps.slice(0, n);
        for (let i = 1; i < kept.length; i++) {
          kept[i]!.role = "y";
          kept[i]!.group = lead.id;
        }
        while (kept.length < n) {
          kept.push({ id: this.ids.next("col"), name: `${lead.name}·${kept.length + 1}`, role: "y", group: lead.id });
        }
        next.push(...kept);
        // Preserve any pre-computed summary columns after the replicates.
        for (const sumId of [ds.sd, ds.sem, ds.n, ds.cv, ds.errLow, ds.errHigh]) {
          const c = sumId ? byId.get(sumId) : undefined;
          if (c) next.push(c);
        }
      }
      table.columns = next;
    });
  }

  /**
   * Set the table's data-entry mode (the "Format Data Table" options). `replicates`
   * = raw side-by-side replicate subcolumns; the `mean-*` modes are the "enter error
   * values already computed" formats where every Y dataset becomes a single mean
   * column plus pre-computed error column(s) — the summary data-entry modes:
   * SD/SEM with or without N, %CV+N, a single ± error value, or separate lower/upper
   * limits (asymmetric). Switching to a summary mode normalises each dataset to
   * `[mean · error(s) · N?]` (reusing an existing error column when possible, else
   * minting, dropping extra replicates); switching to replicates strips the summary
   * columns back to the mean column. One undoable command; dependents go stale.
   */
  setEntryMode(tableId: NodeId, mode: EntryMode): void {
    // Per-mode column recipe: which error column(s) to lay out after the mean, and
    // whether an N column is kept. `replicates` (absent here) keeps the raw subcolumns.
    type Role = NonNullable<Column["role"]>;
    const recipes: Record<Exclude<EntryMode, "replicates">, { errors: Array<{ role: Role; label: string }>; includeN: boolean }> = {
      "mean-sd-n": { errors: [{ role: "sd", label: "SD" }], includeN: true },
      "mean-sem-n": { errors: [{ role: "sem", label: "SEM" }], includeN: true },
      "mean-sd": { errors: [{ role: "sd", label: "SD" }], includeN: false },
      "mean-sem": { errors: [{ role: "sem", label: "SEM" }], includeN: false },
      "mean-cv-n": { errors: [{ role: "cv", label: "%CV" }], includeN: true },
      "mean-err": { errors: [{ role: "errhigh", label: "Error" }], includeN: false },
      "mean-limits": { errors: [{ role: "errlow", label: "Lower" }, { role: "errhigh", label: "Upper" }], includeN: false },
      // Pre-computed centre+spread — the lead holds the centre (mean, or median for IQR,
      // or the geometric mean for Geo mean±SD; the datasheet tags the centre accordingly).
      "mean-range": { errors: [{ role: "min", label: "Min" }, { role: "max", label: "Max" }], includeN: false },
      "median-iqr": { errors: [{ role: "q1", label: "Q1" }, { role: "q3", label: "Q3" }], includeN: false },
      "geomean-sd": { errors: [{ role: "geosd", label: "GSD" }], includeN: false },
      "mean-ci": { errors: [{ role: "ci", label: "95% CI" }], includeN: false },
      // Box values: the lead is the median, plus the four box endpoints — box/violin
      // draw the box straight from these (no raw observations needed).
      "box-values": { errors: [{ role: "min", label: "Min" }, { role: "q1", label: "Q1" }, { role: "q3", label: "Q3" }, { role: "max", label: "Max" }], includeN: false },
    };
    const table = this.requireTable(tableId);
    const affectedPlots = this.project.plots.filter((p) => p.source === tableId);
    const cloneStyles = (p: Plot): Record<NodeId, SeriesStyle> | undefined =>
      p.seriesStyles ? (JSON.parse(JSON.stringify(p.seriesStyles)) as Record<NodeId, SeriesStyle>) : undefined;
    const beforeTable = snapshotTable(table);
    const beforeStyles = affectedPlots.map(cloneStyles);

    // Reformat the table's columns into the chosen entry shape (the recipe).
    const applyRecipe = (): void => {
      const x = xColumn(table);
      const datasets = tableDatasets(table);
      const byId = new Map(table.columns.map((c) => [c.id, c] as const));
      const next: Column[] = [];
      if (x) {
        x.role = "x";
        next.push(x);
      }
      // The shared X-error sub-column is not a Y dataset, so the dataset walk below never
      // re-adds it — carry it through, or the rebuild deletes it with its data.
      const xerr = xErrorColumn(table);
      if (xerr) next.push(xerr);
      const recipe = mode === "replicates" ? undefined : recipes[mode];
      for (const ds of datasets) {
        const lead = byId.get(ds.id);
        if (!lead) continue;
        lead.role = "y";
        lead.group = undefined;
        if (!recipe) {
          // Keep raw replicates; drop any pre-computed summary columns.
          const reps = ds.replicates.map((id) => byId.get(id)).filter((c): c is Column => Boolean(c));
          for (const c of reps) {
            c.role = "y";
            c.group = c === lead ? undefined : lead.id;
          }
          next.push(...reps);
          continue;
        }
        next.push(lead);
        // Reuse the dataset's existing error columns (any kind, stable order) before
        // minting — so switching between summary formats keeps column ids stable.
        const pool = [ds.sd, ds.sem, ds.cv, ds.errLow, ds.errHigh, ds.min, ds.max, ds.q1, ds.q3, ds.geoSd, ds.ci]
          .map((id) => (id ? byId.get(id) : undefined))
          .filter((c): c is Column => Boolean(c));
        let pi = 0;
        const errCols: Array<{ col: Column; role: Role }> = [];
        for (const spec of recipe.errors) {
          let col = pool[pi++];
          if (col) {
            col.role = spec.role;
            col.group = lead.id;
            col.name = `${lead.name} ${spec.label}`;
          } else {
            col = { id: this.ids.next("col"), name: `${lead.name} ${spec.label}`, role: spec.role, group: lead.id };
          }
          next.push(col);
          errCols.push({ col, role: spec.role });
        }
        let nCol: Column | undefined;
        if (recipe.includeN) {
          nCol = ds.n ? byId.get(ds.n) : undefined;
          if (nCol) {
            nCol.role = "n";
            nCol.group = lead.id;
          } else {
            nCol = { id: this.ids.next("col"), name: `${lead.name} N`, role: "n", group: lead.id };
          }
          next.push(nCol);
        }
        // Any leftover pooled columns (e.g. limits → sd drops the extra) are discarded.

        /**
         * Leaving replicates: compute the summary rather than discarding the data.
         *
         * This dataset holds raw replicates (≥ 2 sub-columns). The rebuild above keeps only the
         * lead column, so without this step replicates 2..k would vanish from the sheet with no
         * warning and the lead's raw first replicate would sit under a "Mean" header with SD / N
         * left blank: a wrong mean, empty error, data lost. A summary format was requested, so
         * the correct result is the summary of the entered data. Every statistic here is `summarize()` (the same ReplicateSummary spine
         * every graph's error bar already reads) — no new maths, and the mapping to each recipe
         * role is the one `errorPoint` uses to draw it. Undo restores the raw replicates.
         *
         * Only when the dataset really has ≥ 2 replicate sub-columns. A dataset already in a
         * summary format (1 sub-column) is being switched between summary shapes and its columns
         * are re-pooled above, untouched.
         */
        const repIds = ds.replicates.filter((id) => byId.has(id));
        if (repIds.length >= 2) {
          for (const row of table.rows) {
            const vals = repIds.map((id) => row.cells[id]).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
            const s = summarize(vals);
            const fin = (v: number): number | null => (Number.isFinite(v) ? v : null);
            // The lead becomes the centre the format implies: median for IQR / box values, the
            // geometric mean for Geo mean ± SD, else the arithmetic mean.
            const centre = mode === "median-iqr" || mode === "box-values" ? s.median : mode === "geomean-sd" ? s.geoMean : s.mean;
            row.cells[lead.id] = fin(centre);
            for (const { col, role } of errCols) {
              const v =
                role === "sd" ? s.sd
                : role === "sem" ? s.sem
                : role === "cv" ? (s.mean !== 0 ? (s.sd / Math.abs(s.mean)) * 100 : NaN)
                : role === "min" ? s.min
                : role === "max" ? s.max
                : role === "q1" ? s.q1
                : role === "q3" ? s.q3
                : role === "geosd" ? s.geoSdFactor
                : role === "ci" ? (s.n >= 2 ? ciMultiplier(0.95, s.n - 1) * s.sem : NaN) // 95% CI half-width
                : role === "errhigh" && recipe.errors.length === 1 ? s.sd // "Mean ± error": one symmetric ± value → SD
                : role === "errlow" ? s.mean - s.sd // "limits": mean ∓ SD as the lower/upper bounds
                : role === "errhigh" ? s.mean + s.sd
                : NaN;
              row.cells[col.id] = fin(v);
            }
            if (nCol) row.cells[nCol.id] = s.n > 0 ? s.n : null;
            // The dropped replicate columns' cells: delete them so they don't linger as orphans
            // in the row (undo restores the whole snapshot, columns and cells together).
            for (const id of repIds) if (id !== lead.id) delete row.cells[id];
          }
        }
      }
      table.columns = next;
    };
    applyRecipe();

    // Resync: an entry-mode switch can strand a plot's chosen error type (e.g. a graph
    // set to "95% CI" when the table drops to SD-without-N). Repair each dependent plot's
    // now-undrawable per-dataset type to the new format's natural one — in the same
    // undoable command. Replicate datasets are left alone (spread depends on the data,
    // not the format): drawableErrorTypes is empty for <2 replicates, so the guard skips
    // them and a whisker-less-until-you-add-rows series keeps its intended type.
    for (const ds of tableDatasets(table)) {
      const drawable = drawableErrorTypes(ds);
      if (drawable.length === 0) continue;
      for (const p of affectedPlots) {
        const st = p.seriesStyles?.[ds.id];
        const t = st?.errorBars;
        if (t && t !== "none" && !drawable.includes(t)) {
          p.seriesStyles = { ...p.seriesStyles, [ds.id]: { ...st, errorBars: naturalErrorType(ds) } };
        }
      }
    }

    const afterTable = snapshotTable(table);
    const afterStyles = affectedPlots.map(cloneStyles);
    const applyStyles = (snaps: Array<Record<NodeId, SeriesStyle> | undefined>): void => {
      affectedPlots.forEach((p, i) => {
        const snap = snaps[i];
        if (snap) p.seriesStyles = JSON.parse(JSON.stringify(snap)) as Record<NodeId, SeriesStyle>;
        else delete p.seriesStyles;
      });
    };
    this.commands.execute({
      label: "Set entry mode",
      do: () => {
        restoreTable(table, afterTable);
        applyStyles(afterStyles);
        this.markDependentsStale(tableId);
      },
      undo: () => {
        restoreTable(table, beforeTable);
        applyStyles(beforeStyles);
        this.markDependentsStale(tableId);
      },
    });
  }

  /**
   * Toggle the shared **X-error** subcolumn (the XY "Enter X error" option): when
   * `on`, mint a `role:"xerr"` column right after X (if absent); when off, remove
   * it. Symmetric ± X error rendered as a horizontal cap on every point. One
   * undoable command; dependents go stale.
   */
  setXError(tableId: NodeId, on: boolean): void {
    this.mutateTable(tableId, on ? "Add X error" : "Remove X error", (table) => {
      const existing = table.columns.find((c) => c.role === "xerr");
      if (on) {
        if (existing) return;
        const x = xColumn(table);
        const xIndex = x ? table.columns.indexOf(x) : -1;
        const col: Column = { id: this.ids.next("col"), name: "X error", role: "xerr" };
        table.columns.splice(xIndex + 1, 0, col);
      } else {
        if (!existing) return;
        table.columns = table.columns.filter((c) => c !== existing);
        for (const row of table.rows) delete row.cells[existing.id];
      }
    });
  }

  /**
   * Survival tables: switch time entry between **elapsed** (a single time column) and
   * **start/end dates** (a `date`-typed `survStart`/`survEnd` pair whose difference is
   * the elapsed time, computed at analysis time in `survivalDates.unit`).
   *
   * Turning date entry on stores the mode (default unit = days) and mints the two date
   * columns if the table has none. Turning it off clears the mode and removes the date
   * pair only when both columns are empty — a pair holding entered dates is kept intact
   * (non-destructive), and the analysis simply ignores it while in elapsed mode. One
   * undoable command; the survival analysis goes stale.
   */
  setSurvivalDates(tableId: NodeId, on: boolean, unit: SurvivalTimeUnit = "days"): void {
    this.mutateTable(tableId, on ? "Enter survival dates" : "Enter elapsed survival time", (table) => {
      if (on) {
        table.survivalDates = { unit };
        const hasPair = table.columns.some((c) => c.role === "survStart") && table.columns.some((c) => c.role === "survEnd");
        if (!hasPair) {
          const start: Column = { id: this.ids.next("col"), name: "Start date", role: "survStart", type: "date" };
          const end: Column = { id: this.ids.next("col"), name: "End date", role: "survEnd", type: "date" };
          // Time before event: dates lead, group/event columns follow.
          table.columns.unshift(start, end);
        }
        return;
      }
      table.survivalDates = undefined;
      const pair = table.columns.filter((c) => c.role === "survStart" || c.role === "survEnd");
      const empty = pair.every((c) => table.rows.every((r) => (r.cells[c.id] ?? "") === ""));
      if (empty) {
        const drop = new Set(pair);
        table.columns = table.columns.filter((c) => !drop.has(c));
        for (const row of table.rows) for (const c of pair) delete row.cells[c.id];
      }
    });
  }

  /** Change the unit an elapsed survival span is computed in (days/weeks/months/years).
   *  No-op unless the table is in date-entry mode. One undoable command; analysis stale. */
  setSurvivalTimeUnit(tableId: NodeId, unit: SurvivalTimeUnit): void {
    this.mutateTable(tableId, "Set survival time unit", (table) => {
      if (!table.survivalDates) return;
      table.survivalDates = { unit };
    });
  }

  /**
   * Set a column's role (and optionally its dataset group) — used to enter the
   * "error values computed elsewhere" mode (mark a column as `sd`/`sem`/`n`) or
   * to (un)group a column. One undoable command; presentation of derived means
   * changes, so dependents go stale.
   */
  setColumnRole(tableId: NodeId, columnId: NodeId, role: Column["role"], group?: NodeId): void {
    this.mutateTable(tableId, "Set column role", (table) => {
      const col = table.columns.find((c) => c.id === columnId);
      if (!col) throw new Error(`column ${columnId} not found in table ${tableId}`);
      col.role = role;
      col.group = group;
    });
  }

  /** Merge an error-bar style delta (type/caps/direction) for a dataset on a plot. */
  setErrorBars(plotId: NodeId, datasetId: NodeId, delta: SeriesStyle): void {
    const plot = this.requirePlot(plotId);
    const prev = plot.seriesStyles?.[datasetId];
    this.commands.execute({
      label: "Set error bars",
      do: () => {
        plot.seriesStyles = { ...(plot.seriesStyles ?? {}), [datasetId]: { ...(prev ?? {}), ...delta } };
      },
      undo: () => {
        const next = { ...(plot.seriesStyles ?? {}) };
        if (prev === undefined) delete next[datasetId];
        else next[datasetId] = prev;
        plot.seriesStyles = next;
      },
    });
  }

  /** Merge a per-series style delta (keyed by source column id) on a plot. */
  setSeriesStyle(plotId: NodeId, columnId: NodeId, delta: SeriesStyle): void {
    const plot = this.requirePlot(plotId);
    const prev = plot.seriesStyles?.[columnId];
    this.commands.execute({
      label: "Set series style",
      do: () => {
        plot.seriesStyles = { ...(plot.seriesStyles ?? {}), [columnId]: { ...(prev ?? {}), ...delta } };
      },
      undo: () => {
        const next = { ...(plot.seriesStyles ?? {}) };
        if (prev === undefined) delete next[columnId];
        else next[columnId] = prev;
        plot.seriesStyles = next;
      },
    });
  }

  /**
   * Apply a style delta to every listed series in one undoable step. Used when a
   * chart's marks are one-per-series (box/violin) and the "apply to whole series"
   * toggle is on, so a single edit restyles all of them. `coalesceTag` (e.g. the
   * edited key) merges a slider drag into one undo entry.
   */
  setSeriesStyleAll(plotId: NodeId, columnIds: NodeId[], delta: SeriesStyle, coalesceTag?: string): void {
    const plot = this.requirePlot(plotId);
    const prevById = new Map<NodeId, SeriesStyle | undefined>();
    for (const id of columnIds) prevById.set(id, plot.seriesStyles?.[id]);
    this.commands.execute({
      label: "Set style (all series)",
      ...(coalesceTag ? { coalesceKey: `seriesAll:${plotId}:${coalesceTag}` } : {}),
      do: () => {
        const next = { ...(plot.seriesStyles ?? {}) };
        for (const id of columnIds) next[id] = { ...(next[id] ?? {}), ...delta };
        plot.seriesStyles = next;
      },
      undo: () => {
        const next = { ...(plot.seriesStyles ?? {}) };
        for (const id of columnIds) {
          const p = prevById.get(id);
          if (p === undefined) delete next[id];
          else next[id] = p;
        }
        plot.seriesStyles = next;
      },
    });
  }

  /**
   * Set a per-point style override ("Format this point" — highlighting). Keyed by
   * `${columnId}:${rowId}`, layered on top of the series style for that one mark.
   * An empty resulting delta removes the override (back to the series style).
   */
  setPointStyle(plotId: NodeId, columnId: NodeId, rowId: NodeId, delta: SeriesStyle): void {
    const plot = this.requirePlot(plotId);
    const key = `${columnId}:${rowId}`;
    const prev = plot.pointStyles?.[key];
    const merged = { ...(prev ?? {}), ...delta };
    // Drop keys explicitly set to undefined (lets the caller clear a single field).
    for (const k of Object.keys(merged) as (keyof SeriesStyle)[]) if (merged[k] === undefined) delete merged[k];
    const next = Object.keys(merged).length > 0 ? merged : undefined;
    this.commands.execute({
      label: "Format this point",
      do: () => {
        const map = { ...(plot.pointStyles ?? {}) };
        if (next === undefined) delete map[key];
        else map[key] = next;
        plot.pointStyles = Object.keys(map).length > 0 ? map : undefined;
      },
      undo: () => {
        const map = { ...(plot.pointStyles ?? {}) };
        if (prev === undefined) delete map[key];
        else map[key] = prev;
        plot.pointStyles = Object.keys(map).length > 0 ? map : undefined;
      },
    });
  }

  /** Remove all per-point overrides for one series (reset its points to the series style). */
  clearPointStyles(plotId: NodeId, columnId: NodeId): void {
    const plot = this.requirePlot(plotId);
    const prev = plot.pointStyles;
    if (!prev) return;
    const next: Record<string, SeriesStyle> = {};
    for (const [k, v] of Object.entries(prev)) if (!k.startsWith(`${columnId}:`)) next[k] = v;
    const after = Object.keys(next).length > 0 ? next : undefined;
    this.commands.execute({
      label: "Clear point formats",
      do: () => { plot.pointStyles = after; },
      undo: () => { plot.pointStyles = prev; },
    });
  }

  plotStatus(plotId: NodeId): Plot["status"] {
    return this.requirePlot(plotId).status;
  }

  // --- overrides (keyed by stable row id; survive reorder + recompute) -----

  setRowOverride(plotId: NodeId, rowId: NodeId, delta: StyleDelta): void {
    this.requirePlot(plotId).styleOverrides[rowOverrideKey(rowId)] = delta;
  }

  getRowOverride(plotId: NodeId, rowId: NodeId): StyleDelta | undefined {
    return this.requirePlot(plotId).styleOverrides[rowOverrideKey(rowId)];
  }

  // --- workspace tree (folders → experiments → object refs) -----------

  /** The live organizational tree (folders/experiments/refs). */
  get workspace(): Workspace {
    return this.project.workspace;
  }

  /** Resolve a reference to its entity (or `undefined` if the store is absent). */
  resolveRef(ref: WorkspaceRef): DataTable | Plot | Analysis | undefined {
    if (ref.kind === "table") return this.project.tables.find((t) => t.id === ref.id);
    if (ref.kind === "plot") return this.project.plots.find((p) => p.id === ref.id);
    if (ref.kind === "analysis") return this.project.analyses.find((a) => a.id === ref.id);
    return undefined; // layout store lands later
  }

  /**
   * Where a ref is currently filed in the tree (so siblings — an analysis or
   * graph and its source dataset — can be kept together: the "family"
   * model). Returns `loose` if the ref isn't filed anywhere.
   */
  locationOf(ref: WorkspaceRef): WorkspaceTarget {
    const ws = this.project.workspace;
    for (const folder of ws.folders) {
      if (folder.members.some((m) => sameRef(m, ref))) return { level: "folder", folderId: folder.id };
      for (const experiment of folder.experiments) {
        if (experiment.members.some((m) => sameRef(m, ref))) {
          return { level: "experiment", folderId: folder.id, experimentId: experiment.id };
        }
      }
    }
    return { level: "loose" };
  }

  addFolder(name: string): ProjectFolder {
    const folder: ProjectFolder = {
      id: this.ids.next("fld"),
      name,
      members: [],
      experiments: [],
      documentation: "",
    };
    this.mutateWorkspace(`Add project "${name}"`, (ws) => {
      ws.folders.push(folder);
    });
    return this.findFolder(folder.id);
  }

  addExperiment(folderId: NodeId, name: string): Experiment {
    const experiment: Experiment = { id: this.ids.next("exp"), name, members: [] };
    this.mutateWorkspace(`Add experiment "${name}"`, (ws) => {
      const folder = ws.folders.find((f) => f.id === folderId);
      if (!folder) throw new Error(`folder ${folderId} not found`);
      folder.experiments.push(experiment);
    });
    return this.findExperiment(folderId, experiment.id);
  }

  renameFolder(folderId: NodeId, name: string): void {
    this.mutateWorkspace("Rename project", (ws) => {
      const folder = ws.folders.find((f) => f.id === folderId);
      if (!folder) throw new Error(`folder ${folderId} not found`);
      folder.name = name;
    });
  }

  renameExperiment(folderId: NodeId, experimentId: NodeId, name: string): void {
    this.mutateWorkspace("Rename experiment", (ws) => {
      const experiment = ws.folders
        .find((f) => f.id === folderId)
        ?.experiments.find((e) => e.id === experimentId);
      if (!experiment) throw new Error(`experiment ${experimentId} not found`);
      experiment.name = name;
    });
  }

  setFolderDocumentation(folderId: NodeId, text: string): void {
    this.mutateWorkspace("Edit project documentation", (ws) => {
      const folder = ws.folders.find((f) => f.id === folderId);
      if (!folder) throw new Error(`folder ${folderId} not found`);
      folder.documentation = text;
    });
  }

  /**
   * File (or move) an object reference to a target location. A ref lives in
   * exactly one place, so this removes it from wherever it currently is first.
   * Entities are never touched — only the organizational tree.
   */
  fileObject(ref: WorkspaceRef, target: WorkspaceTarget): void {
    this.mutateWorkspace("Move item", (ws) => {
      removeRef(ws, ref);
      insertRef(ws, ref, target);
    });
  }

  /**
   * Remove an organizational folder without deleting its objects: every member
   * (folder-level + every experiment's) is unfiled back to `loose`.
   */
  removeFolder(folderId: NodeId): void {
    this.mutateWorkspace("Remove project", (ws) => {
      const folder = ws.folders.find((f) => f.id === folderId);
      if (!folder) throw new Error(`folder ${folderId} not found`);
      const orphans = [...folder.members, ...folder.experiments.flatMap((e) => e.members)];
      ws.loose.push(...orphans);
      ws.folders = ws.folders.filter((f) => f.id !== folderId);
    });
  }

  /** Remove an experiment without deleting its objects (members → parent folder). */
  removeExperiment(folderId: NodeId, experimentId: NodeId): void {
    this.mutateWorkspace("Remove experiment", (ws) => {
      const folder = ws.folders.find((f) => f.id === folderId);
      const experiment = folder?.experiments.find((e) => e.id === experimentId);
      if (!folder || !experiment) throw new Error(`experiment ${experimentId} not found`);
      folder.members.push(...experiment.members);
      folder.experiments = folder.experiments.filter((e) => e.id !== experimentId);
    });
  }

  // --- deletion (entities + their workspace refs; cascades) ----------------

  /** Delete a graph (plot) entirely — the entity + its workspace ref. Undoable. */
  removePlot(plotId: NodeId): void {
    this.requirePlot(plotId);
    this.mutateProject("Delete graph", (p) => {
      p.plots = p.plots.filter((x) => x.id !== plotId);
      removeRef(p.workspace, { kind: "plot", id: plotId });
    });
  }

  /** Delete an analysis entirely. Undoable. */
  removeAnalysis(analysisId: NodeId): void {
    this.requireAnalysis(analysisId);
    this.mutateProject("Delete analysis", (p) => {
      p.analyses = p.analyses.filter((x) => x.id !== analysisId);
      removeRef(p.workspace, { kind: "analysis", id: analysisId });
    });
  }

  /**
   * Delete a dataset (table) and cascade — every graph + analysis drawn from it
   * goes too (they'd otherwise be orphaned), along with all their workspace refs.
   * One undoable command.
   */
  removeTable(tableId: NodeId): void {
    this.requireTable(tableId);
    this.mutateProject("Delete dataset", (p) => {
      // Cascade to derived descendants: a derived table whose source is deleted
      // can no longer recompute, so it — and its own derived children — go too.
      const deadTables = new Set<NodeId>([tableId]);
      for (let grew = true; grew; ) {
        grew = false;
        for (const t of p.tables) {
          if (t.derivation && deadTables.has(t.derivation.source) && !deadTables.has(t.id)) {
            deadTables.add(t.id);
            grew = true;
          }
        }
      }
      const deadPlots = new Set(p.plots.filter((x) => deadTables.has(x.source)).map((x) => x.id));
      const deadAnalyses = new Set(p.analyses.filter((x) => deadTables.has(x.source)).map((x) => x.id));
      p.tables = p.tables.filter((x) => !deadTables.has(x.id));
      p.plots = p.plots.filter((x) => !deadTables.has(x.source));
      // A plot that merely borrowed a series from a dead sheet survives (it is still a valid
      // graph of its own sheet) — only the overlay reference goes, so nothing dangles.
      for (const x of p.plots) {
        if (x.overlays?.some((o) => deadTables.has(o.table))) {
          const kept = x.overlays.filter((o) => !deadTables.has(o.table));
          if (kept.length) x.overlays = kept;
          else delete x.overlays;
        }
      }
      p.analyses = p.analyses.filter((x) => !deadTables.has(x.source));
      for (const id of deadTables) removeRef(p.workspace, { kind: "table", id });
      for (const id of deadPlots) removeRef(p.workspace, { kind: "plot", id });
      for (const id of deadAnalyses) removeRef(p.workspace, { kind: "analysis", id });
    });
  }

  /** Delete an experiment and its objects (cascade). One undoable command. */
  deleteExperiment(folderId: NodeId, experimentId: NodeId): void {
    const exp = this.findExperiment(folderId, experimentId);
    const members = [...exp.members];
    let cutLoose: DataTable[] = [];
    this.mutateProject("Delete experiment", (p) => {
      cutLoose = this.deleteMembers(p, members);
      const folder = p.workspace.folders.find((f) => f.id === folderId);
      if (folder) folder.experiments = folder.experiments.filter((e) => e.id !== experimentId);
    });
    this.logCutLoose(cutLoose);
  }

  /** Delete a project folder and everything filed under it (cascade). One undoable command. */
  deleteFolder(folderId: NodeId): void {
    const folder = this.findFolder(folderId);
    const members = [...folder.members, ...folder.experiments.flatMap((e) => e.members)];
    let cutLoose: DataTable[] = [];
    this.mutateProject("Delete project", (p) => {
      cutLoose = this.deleteMembers(p, members);
      p.workspace.folders = p.workspace.folders.filter((f) => f.id !== folderId);
    });
    this.logCutLoose(cutLoose);
  }

  /**
   * The derived tables that deleting this experiment would cut loose — kept, but no
   * longer recomputing. For the confirmation prompt: they live outside what the user
   * selected, so deleting must not silently change them without saying so.
   */
  orphansOfDeletingExperiment(folderId: NodeId, experimentId: NodeId): DataTable[] {
    return this.derivedDependentsOf([...this.findExperiment(folderId, experimentId).members]);
  }

  /** The derived tables that deleting this folder would cut loose. See above. */
  orphansOfDeletingFolder(folderId: NodeId): DataTable[] {
    const folder = this.findFolder(folderId);
    return this.derivedDependentsOf([...folder.members, ...folder.experiments.flatMap((e) => e.members)]);
  }

  /** Surviving derived tables whose source is among the tables these members would delete. */
  private derivedDependentsOf(members: WorkspaceRef[]): DataTable[] {
    const removedTables = new Set(members.filter((m) => m.kind === "table").map((m) => m.id));
    return this.project.tables.filter((t) => t.derivation && removedTables.has(t.derivation.source) && !removedTables.has(t.id));
  }

  /** Record a cut-loose table in the analysis log (append-only, so outside undo). */
  private logCutLoose(tables: DataTable[]): void {
    for (const t of tables) {
      this.appendLog("transform", `"${t.name}" is no longer linked to a source`, {
        detail: "Its source dataset was deleted. The data was kept exactly as it stands and the sheet is now a plain dataset.",
        refKind: "table",
        refId: t.id,
      });
    }
  }

  /**
   * Remove a set of member objects (tables cascade to their plots/analyses) from a
   * project value. Returns the derived tables that were cut loose.
   */
  private deleteMembers(p: Project, members: WorkspaceRef[]): DataTable[] {
    const tableIds = new Set(members.filter((m) => m.kind === "table").map((m) => m.id));
    const plotIds = new Set(members.filter((m) => m.kind === "plot").map((m) => m.id));
    const analysisIds = new Set(members.filter((m) => m.kind === "analysis").map((m) => m.id));
    // Tables cascade: also drop any plot/analysis sourced from a deleted table.
    p.plots.forEach((x) => tableIds.has(x.source) && plotIds.add(x.id));
    p.analyses.forEach((x) => tableIds.has(x.source) && analysisIds.add(x.id));
    p.tables = p.tables.filter((x) => !tableIds.has(x.id));
    p.plots = p.plots.filter((x) => !plotIds.has(x.id));
    p.analyses = p.analyses.filter((x) => !analysisIds.has(x.id));
    // A derived table whose source was just deleted is cut loose, not deleted: the user
    // selected this folder, and that sheet may well live in another one. Deleting it would
    // reach outside the selection; leaving the derivation would be misleading — recompute
    // no-ops once the source is gone (`recomputeDerivedTable`), so the sheet would sit frozen
    // while `status: "ok"` reported it as current. Clearing both makes it an
    // ordinary dataset holding exactly the values it last computed. Only direct dependents
    // need this: a derived-of-derived chain still has its own live source.
    const cutLoose = p.tables.filter((t) => t.derivation && tableIds.has(t.derivation.source));
    for (const t of cutLoose) {
      t.derivation = undefined;
      t.status = undefined;
    }
    for (const id of tableIds) removeRef(p.workspace, { kind: "table", id });
    for (const id of plotIds) removeRef(p.workspace, { kind: "plot", id });
    for (const id of analysisIds) removeRef(p.workspace, { kind: "analysis", id });
    return cutLoose;
  }

  /**
   * Run a whole-project mutation as one undoable command — deep-snapshot the
   * entity stores + workspace before/after and swap them (so cascade deletes
   * undo atomically). `this.project` itself is never reassigned.
   */
  private mutateProject(label: string, fn: (p: Project) => void): void {
    const before = snapshotStores(this.project);
    fn(this.project);
    const after = snapshotStores(this.project);
    this.commands.execute({
      label,
      do: () => restoreStores(this.project, after),
      undo: () => restoreStores(this.project, before),
    });
  }

  // --- internals ----------------------------------------------------------

  /**
   * Run a workspace-tree mutation as an undoable command. The tree is small pure
   * JSON, so we snapshot before/after and swap whole — simplest correct approach,
   * and `do()` stays re-runnable for redo (CommandStack calls it again).
   */
  private mutateWorkspace(label: string, mutate: (ws: Workspace) => void): void {
    const before = cloneWorkspace(this.project.workspace);
    const after = cloneWorkspace(this.project.workspace);
    mutate(after);
    this.commands.execute({
      label,
      do: () => {
        this.project.workspace = cloneWorkspace(after);
      },
      undo: () => {
        this.project.workspace = cloneWorkspace(before);
      },
    });
  }

  /** Remove a ref from anywhere in the tree (used by entity-removal undo). */
  private unfileRef(ref: WorkspaceRef): void {
    removeRef(this.project.workspace, ref);
  }

  private findFolder(folderId: NodeId): ProjectFolder {
    const folder = this.project.workspace.folders.find((f) => f.id === folderId);
    if (!folder) throw new Error(`folder ${folderId} not found`);
    return folder;
  }

  private findExperiment(folderId: NodeId, experimentId: NodeId): Experiment {
    const experiment = this.findFolder(folderId).experiments.find((e) => e.id === experimentId);
    if (!experiment) throw new Error(`experiment ${experimentId} not found`);
    return experiment;
  }

  /**
   * Run a table-structure edit (cells/rows/columns may all change) as one
   * undoable command. The table is small pure JSON, so we snapshot before/after
   * and swap whole — keeping `do()` re-runnable for redo. Ids are minted during
   * `mutate` (once, pre-execute), never re-minted on redo.
   */
  /**
   * A structural column change (insert / move / delete) on `tableId`.
   *
   * Caution: derived tables address their source columns by numeric index, so a structural edit
   * would silently re-point every derivation built on this table — inserting a column ahead of
   * the referenced one would turn a `log10` of Y into a `log10` of X, while the derived table
   * kept its name. `mapIndex` (old index → new index, or null when that column is being deleted)
   * is applied to every dependent derivation in the same undoable command as the edit itself, so
   * undo restores the specs too.
   */
  private mutateTableColumns(
    tableId: NodeId,
    label: string,
    mapIndex: (index: number) => number | null,
    mutate: (table: DataTable) => void,
    /** Optional: re-key the dependent plots' series maps in the same command — a table edit
     *  that renames a dataset's id (re-leading a group) must carry its styles with it. Runs
     *  after `mutate`; its effect is snapshotted into do/undo alongside the table. */
    mutatePlots?: (plots: Plot[]) => void,
  ): void {
    const table = this.requireTable(tableId);
    const depIds = this.project.tables.filter((t) => t.derivation?.source === tableId).map((t) => t.id);
    const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
    const plots = this.project.plots.filter((p) => p.source === tableId);
    const plotSnap = (): Array<{ seriesStyles: Plot["seriesStyles"]; pointStyles: Plot["pointStyles"] }> =>
      plots.map((p) => ({ seriesStyles: p.seriesStyles ? clone(p.seriesStyles) : undefined, pointStyles: p.pointStyles ? clone(p.pointStyles) : undefined }));
    const applyPlotSnap = (snaps: ReturnType<typeof plotSnap>): void => {
      plots.forEach((p, i) => {
        const s = snaps[i]!;
        if (s.seriesStyles) p.seriesStyles = clone(s.seriesStyles); else delete p.seriesStyles;
        if (s.pointStyles) p.pointStyles = clone(s.pointStyles); else delete p.pointStyles;
      });
    };
    const beforePlots = mutatePlots ? plotSnap() : null;
    const specsOf = (): Record<NodeId, TableDerivation | undefined> => {
      const out: Record<NodeId, TableDerivation | undefined> = {};
      for (const id of depIds) {
        const d = this.project.tables.find((t) => t.id === id)?.derivation;
        out[id] = d ? clone(d) : undefined;
      }
      return out;
    };
    const applySpecs = (specs: Record<NodeId, TableDerivation | undefined>): void => {
      for (const id of depIds) {
        const t = this.project.tables.find((x) => x.id === id);
        const d = specs[id];
        if (t && d) t.derivation = clone(d);
      }
    };

    const beforeTable = snapshotTable(table);
    const beforeSpecs = specsOf();
    mutate(table);
    // Rewrite this table's own calculated (formula) columns: their A/B/C letters are column
    // positions, so a structural edit that shifts columns must remap them or the formula silently
    // reads a different column (insert left of "A/B" → blanks; swap columns → inverts). Same
    // remap the dependent derived tables get just below. Skip a formula only when it can't be
    // safely remapped (a referenced column was deleted) — keep it as-is rather than write an
    // invalid formula.
    for (const col of table.columns) {
      if (!col.formula) continue;
      const remapped = remapFormulaColumns(col.formula, mapIndex);
      if (remapped != null) col.formula = remapped;
    }
    for (const id of depIds) {
      const t = this.project.tables.find((x) => x.id === id);
      if (t?.derivation) t.derivation = remapDerivationColumns(t.derivation, mapIndex);
    }
    if (mutatePlots) mutatePlots(plots);
    const afterTable = snapshotTable(table);
    const afterSpecs = specsOf();
    const afterPlots = mutatePlots ? plotSnap() : null;

    this.commands.execute({
      label,
      do: () => {
        restoreTable(table, afterTable);
        applySpecs(afterSpecs);
        if (afterPlots) applyPlotSnap(afterPlots);
        this.markDependentsStale(tableId);
      },
      undo: () => {
        restoreTable(table, beforeTable);
        applySpecs(beforeSpecs);
        if (beforePlots) applyPlotSnap(beforePlots);
        this.markDependentsStale(tableId);
      },
    });
  }

  private mutateTable(tableId: NodeId, label: string, mutate: (table: DataTable) => void): void {
    const table = this.requireTable(tableId);
    const before = snapshotTable(table);
    mutate(table);
    const after = snapshotTable(table);
    this.commands.execute({
      label,
      do: () => {
        restoreTable(table, after);
        this.markDependentsStale(tableId);
      },
      undo: () => {
        restoreTable(table, before);
        this.markDependentsStale(tableId);
      },
    });
  }

  /** Grow a table to at least `rowCount` rows and `colCount` columns (blank fill). */
  private growTable(table: DataTable, rowCount: number, colCount: number): void {
    // Typing into a spare column grows the sheet by whole groups of the table's shape — a
    // 3-replicate sheet gains a 3-replicate group, a Mean+SD+N sheet gains mean·SD·N — the same
    // rule as "+ Column" (never one bare n = 1 column beside groups of n = 3). A plain sheet
    // still gains one bare column per step.
    while (table.columns.length < colCount) {
      table.columns.push(...newDatasetColumns(table, nextColumnName(table), () => this.ids.next("col")));
    }
    while (table.rows.length < rowCount) {
      table.rows.push({ id: this.ids.next("row"), cells: {} });
    }
  }

  private markDependentsStale(tableId: NodeId): void {
    // The table's own calculated-variable columns recompute first (intra-table reactive
    // edge), so any dependent plot/analysis/derived-table below reads their fresh values.
    const changed = this.project.tables.find((t) => t.id === tableId);
    if (changed) recomputeFormulas(changed);
    for (const plot of this.project.plots) {
      // Its own sheet, or a sheet it borrows a series from (`plot.overlays`):
      // a graph that ignored an edit to data it draws would be misleading.
      if (plot.source === tableId || plot.overlays?.some((o) => o.table === tableId)) {
        plot.status = "stale";
        if ((!plot.analysisSource && (plot.roc || plot.survival || plot.pca))
          || (plot.fit && !plot.fit.analysisSource) || plot.fits?.some((f) => !f.analysisSource)) plot.snapshotStale = true;
      }
    }
    // An analysis over edited data is no longer current → stale (re-runnable).
    for (const analysis of this.project.analyses) {
      if (analysis.source === tableId) {
        this.analysisRuns.delete(analysis.id);
        if (analysis.status === "ok") analysis.status = "stale";
      }
    }
    // A *derived* table over edited data is no longer current → stale, and the
    // cascade continues to its dependents (derived-of-derived chains, plots,
    // analyses). The `=== "ok"` guard makes each table flip at most once, so a
    // diamond-shaped DAG terminates without re-entry.
    for (const t of this.project.tables) {
      if (t.derivation?.source === tableId && (t.status ?? "ok") === "ok") {
        t.status = "stale";
        this.markDependentsStale(t.id);
      }
    }
  }

  // ── Provenance / lineage queries (the "Family" / lineage view) ──────────────
  // The data→analysis→graph DAG is already fully represented by the source edges
  // (`Table.derivation.source`, `Analysis.source`, `Plot.source`/`analysisSource`,
  // `Layout.panels`). These are read-only traversals over it — no new state.

  /** Analyses that read this table directly. */
  analysesFor(tableId: NodeId): Analysis[] {
    return this.project.analyses.filter((a) => a.source === tableId);
  }

  /** Graphs sourced directly from this table. */
  plotsFor(tableId: NodeId): Plot[] {
    return this.project.plots.filter((p) => p.source === tableId);
  }

  /** Tables derived (transform / reshape / frequency / …) from this table. */
  derivedTablesFor(tableId: NodeId): DataTable[] {
    return this.project.tables.filter((t) => t.derivation?.source === tableId);
  }

  /** The table this one was derived from, if any. */
  upstreamTable(tableId: NodeId): DataTable | undefined {
    const src = this.project.tables.find((t) => t.id === tableId)?.derivation?.source;
    return src ? this.project.tables.find((t) => t.id === src) : undefined;
  }

  /** Graphs an analysis produced — precise via `plot.analysisSource`, with a source-table +
   *  result-kind heuristic fallback for plots created before `analysisSource` was recorded. */
  plotsForAnalysis(analysisId: NodeId): Plot[] {
    const a = this.project.analyses.find((x) => x.id === analysisId);
    if (!a) return [];
    const explicit = this.project.plots.filter((p) => p.analysisSource === analysisId
      || p.fit?.analysisSource === analysisId || p.fits?.some(f => f.analysisSource === analysisId));
    if (explicit.length) return explicit;
    const kindMatch = (p: Plot): boolean =>
      (a.method === "roc" && !!p.roc) ||
      (a.method === "pca" && !!p.pca) ||
      (a.method === "survival" && !!p.survival) ||
      ((a.method === "curvefit" || a.method === "regression") && (!!p.fit || (p.fits?.length ?? 0) > 0));
    return this.project.plots.filter((p) => p.source === a.source && p.analysisSource === undefined && kindMatch(p));
  }

  /** Every provenance edge in the project (source → dependent). */
  private lineageEdges(): LineageEdge[] {
    const edges: LineageEdge[] = [];
    for (const t of this.project.tables) {
      if (t.derivation?.source) edges.push({ from: t.derivation.source, to: t.id, relation: "derives" });
    }
    for (const a of this.project.analyses) edges.push({ from: a.source, to: a.id, relation: "analyzes" });
    for (const p of this.project.plots) {
      edges.push({ from: p.source, to: p.id, relation: "plots" });
      if (p.analysisSource) edges.push({ from: p.analysisSource, to: p.id, relation: "spawns" });
    }
    for (const l of this.project.layouts ?? []) {
      for (const plotId of l.panels) edges.push({ from: plotId, to: l.id, relation: "panel" });
    }
    return edges;
  }

  /** Resolve an id to a lineage node (table / analysis / plot / layout), or null if unknown. */
  private lineageNode(id: NodeId): LineageNode | null {
    const t = this.project.tables.find((x) => x.id === id);
    if (t) return { kind: "table", id, name: t.name, status: t.status ?? "ok" };
    const a = this.project.analyses.find((x) => x.id === id);
    if (a) return { kind: "analysis", id, name: a.name, status: a.status };
    const p = this.project.plots.find((x) => x.id === id);
    if (p) return { kind: "plot", id, name: p.name, status: p.status };
    const l = (this.project.layouts ?? []).find((x) => x.id === id);
    if (l) return { kind: "layout", id, name: l.name, status: "ok" };
    return null;
  }

  /** The connected provenance component around `ref` (its ancestors + descendants + the edges
   *  among them) — the data for the lineage / "Family" view. */
  lineageOf(ref: { id: NodeId }): Lineage {
    const edges = this.lineageEdges();
    const adj = new Map<NodeId, NodeId[]>();
    const link = (k: NodeId, v: NodeId): void => {
      const arr = adj.get(k);
      if (arr) arr.push(v);
      else adj.set(k, [v]);
    };
    for (const e of edges) {
      link(e.from, e.to);
      link(e.to, e.from);
    }
    const seen = new Set<NodeId>([ref.id]);
    const queue: NodeId[] = [ref.id];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const nb of adj.get(cur) ?? []) if (!seen.has(nb)) { seen.add(nb); queue.push(nb); }
    }
    const nodes = [...seen].map((id) => this.lineageNode(id)).filter((n): n is LineageNode => n !== null);
    const keep = new Set(nodes.map((n) => n.id));
    return { nodes, edges: edges.filter((e) => keep.has(e.from) && keep.has(e.to)) };
  }

  /** Stale nodes downstream of `ref`, in dependency order (source-before-dependent) — the set a
   *  one-click "re-run everything stale below here" would refresh. */
  staleDownstream(ref: { id: NodeId }): LineageNode[] {
    const out = new Map<NodeId, NodeId[]>();
    for (const e of this.lineageEdges()) {
      const arr = out.get(e.from);
      if (arr) arr.push(e.to);
      else out.set(e.from, [e.to]);
    }
    const order: NodeId[] = [];
    const seen = new Set<NodeId>([ref.id]);
    const queue: NodeId[] = [ref.id];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const nb of out.get(cur) ?? []) if (!seen.has(nb)) { seen.add(nb); queue.push(nb); order.push(nb); }
    }
    return order.map((id) => this.lineageNode(id)).filter((n): n is LineageNode => !!n && n.status === "stale");
  }

  /** The whole-project provenance DAG — every sheet as a node + every source edge. The data
   *  for the lineage view. */
  projectLineage(): Lineage {
    const ids: NodeId[] = [
      ...this.project.tables.map((t) => t.id),
      ...this.project.analyses.map((a) => a.id),
      ...this.project.plots.map((p) => p.id),
      ...(this.project.layouts ?? []).map((l) => l.id),
    ];
    const nodes = ids.map((id) => this.lineageNode(id)).filter((n): n is LineageNode => n !== null);
    return { nodes, edges: this.lineageEdges() };
  }

  // ── Sheet metadata: Navigator colour + pin (tables / plots / analyses / layouts) ──
  private sheetObject(kind: string, id: NodeId): { color?: string | undefined; pinned?: boolean | undefined } | undefined {
    if (kind === "table") return this.project.tables.find((t) => t.id === id);
    if (kind === "plot") return this.project.plots.find((p) => p.id === id);
    if (kind === "analysis") return this.project.analyses.find((a) => a.id === id);
    if (kind === "layout") return (this.project.layouts ?? []).find((l) => l.id === id);
    return undefined;
  }

  /** Set (or clear, with `undefined`) a sheet's Navigator highlight colour. */
  setSheetColor(kind: "table" | "plot" | "analysis" | "layout", id: NodeId, color: string | undefined): void {
    const obj = this.sheetObject(kind, id);
    if (!obj || obj.color === color) return;
    const prev = obj.color;
    this.commands.execute({
      label: "Colour sheet",
      do: () => { obj.color = color; },
      undo: () => { obj.color = prev; },
    });
  }

  /** Pin / unpin a sheet (pinned sheets sort to the top of their Navigator container). */
  setSheetPinned(kind: "table" | "plot" | "analysis" | "layout", id: NodeId, pinned: boolean): void {
    const obj = this.sheetObject(kind, id);
    if (!obj || Boolean(obj.pinned) === pinned) return;
    const prev = obj.pinned;
    this.commands.execute({
      label: pinned ? "Pin sheet" : "Unpin sheet",
      do: () => { obj.pinned = pinned || undefined; },
      undo: () => { obj.pinned = prev; },
    });
  }

  private requireTable(tableId: NodeId): DataTable {
    const table = this.project.tables.find((t) => t.id === tableId);
    if (!table) throw new Error(`table ${tableId} not found`);
    return table;
  }

  private requirePlot(plotId: NodeId): Plot {
    const plot = this.project.plots.find((p) => p.id === plotId);
    if (!plot) throw new Error(`plot ${plotId} not found`);
    return plot;
  }

  private requireAnalysis(analysisId: NodeId): Analysis {
    const analysis = this.project.analyses.find((a) => a.id === analysisId);
    if (!analysis) throw new Error(`analysis ${analysisId} not found`);
    return analysis;
  }
}

// --- table free helpers ----------------------------------------------------

/** Upper bound for the table-wide replicate count. */
const MAX_REPLICATES = 52;

/** Default name for the column at `index`: column 0 is the X axis, rest are Y series. */
interface TableSnapshot {
  columns: Column[];
  rows: Row[];
}

/**
 * An axis title is data, and never travels with a style.
 *
 * Every style-copy path that replaces an axis spec wholesale would hand the target the
 * source's axis title — and when the source has none, wipe the target's (in panel assembly,
 * matching styles would leave some graphs without axis titles). This applies equally to
 * panel matching, siblings-copy, saved templates and user presets.
 *
 * Everything else in the spec is presentation and should copy — scale, ticks, format,
 * line width, gridlines, the title's font. The title itself names what that graph
 * measures; a graph of minutes must not be relabelled with a graph of micromolar's title.
 */
const AXIS_SPEC_KEYS = new Set(["xAxis", "yAxis", "y2Axis", "y3Axis"]);
function keepAxisTitle(key: keyof Plot, incoming: unknown, target: Plot): unknown {
  if (!AXIS_SPEC_KEYS.has(key as string) || incoming == null || typeof incoming !== "object") return incoming;
  const own = (target[key] as { title?: string } | undefined)?.title;
  const next = { ...(incoming as Record<string, unknown>) };
  if (own === undefined) delete next.title;
  else next.title = own;
  return next;
}

function snapshotTable(table: DataTable): TableSnapshot {
  return {
    columns: table.columns.map((c) => ({ ...c })),
    rows: table.rows.map((r) => ({ id: r.id, cells: { ...r.cells } })),
  };
}

/**
 * Replace every own property of `target` with a deep clone of `source`, keeping `target`'s
 * object identity. See `reviveList` for why identity matters.
 */
function replaceInPlace<T extends object>(target: T, source: T): T {
  const fresh = JSON.parse(JSON.stringify(source)) as Record<string, unknown>;
  for (const k of Object.keys(target)) delete (target as Record<string, unknown>)[k];
  Object.assign(target, fresh);
  return target;
}

/**
 * Rebuild a list from a snapshot, reusing the live object for every id that still exists.
 *
 * Note: this is what makes undo correct across interleaved commands. Commands close over live
 * objects — `setCell` captures the `row` it edits — so if a later snapshot/restore command
 * (`insertRow`, `removeTable`, `deleteExperiment`, …) rebuilt the arrays out of fresh clones,
 * every earlier command's closure would point at a detached object. Its `undo()` would then
 * mutate that detached object and the visible document would silently not change: a plain
 * `setCell` → `insertRow` → Ctrl+Z → Ctrl+Z would restore the wrong value. Reusing the live object
 * keeps those closures attached; only genuinely new ids get a fresh clone.
 */
function reviveList<T extends { id: NodeId }>(
  live: readonly T[],
  snap: readonly T[],
  revive: (target: T, source: T) => T,
): T[] {
  const byId = new Map(live.map((e) => [e.id, e]));
  return snap.map((s) => {
    const cur = byId.get(s.id);
    return cur ? revive(cur, s) : (JSON.parse(JSON.stringify(s)) as T);
  });
}

/** A row, keeping its identity — `setCell` holds a reference to exactly this object. */
function reviveRow(target: Row, source: Row): Row {
  target.cells = { ...source.cells };
  return target;
}

function restoreTable(table: DataTable, snap: TableSnapshot): void {
  table.columns = reviveList(table.columns, snap.columns, replaceInPlace);
  table.rows = reviveList(table.rows, snap.rows, reviveRow);
}

/** A table, keeping its own identity and its rows'/columns' (commands capture all three). */
function reviveTable(target: DataTable, source: DataTable): DataTable {
  const liveRows = target.rows ?? [];
  const liveCols = target.columns ?? [];
  replaceInPlace(target, source);
  target.columns = reviveList(liveCols, source.columns ?? [], replaceInPlace);
  target.rows = reviveList(liveRows, source.rows ?? [], reviveRow);
  return target;
}

// --- workspace free helpers (operate on a Workspace value) -----------------

/** Deep clone of the (pure-JSON) workspace tree. */
function cloneWorkspace(ws: Workspace): Workspace {
  return JSON.parse(JSON.stringify(ws)) as Workspace;
}

/** Snapshot of the deletable entity stores + workspace (for atomic cascade deletes). */
interface StoreSnapshot {
  tables: DataTable[];
  plots: Plot[];
  analyses: Analysis[];
  workspace: Workspace;
}

function snapshotStores(p: Project): StoreSnapshot {
  return JSON.parse(JSON.stringify({ tables: p.tables, plots: p.plots, analyses: p.analyses, workspace: p.workspace }));
}

function restoreStores(p: Project, snap: StoreSnapshot): void {
  // Identity-preserving (see `reviveList`): a cascade delete/undo must not detach the closures
  // of commands that ran before it, or their undo silently stops working.
  p.tables = reviveList(p.tables, snap.tables, reviveTable);
  p.plots = reviveList(p.plots, snap.plots, replaceInPlace);
  p.analyses = reviveList(p.analyses, snap.analyses, replaceInPlace);
  p.workspace = JSON.parse(JSON.stringify(snap.workspace));
}

function sameRef(a: WorkspaceRef, b: WorkspaceRef): boolean {
  return a.kind === b.kind && a.id === b.id;
}

/** Strip a ref from every location in the tree (a ref lives in exactly one place). */
function removeRef(ws: Workspace, ref: WorkspaceRef): void {
  const without = (members: WorkspaceRef[]) => members.filter((r) => !sameRef(r, ref));
  ws.loose = without(ws.loose);
  for (const folder of ws.folders) {
    folder.members = without(folder.members);
    for (const experiment of folder.experiments) {
      experiment.members = without(experiment.members);
    }
  }
}

/** Insert a ref at a target location (caller removes it elsewhere first). */
function insertRef(ws: Workspace, ref: WorkspaceRef, target: WorkspaceTarget): void {
  if (target.level === "loose") {
    ws.loose.push(ref);
    return;
  }
  const folder = ws.folders.find((f) => f.id === target.folderId);
  if (!folder) throw new Error(`folder ${target.folderId} not found`);
  if (target.level === "folder") {
    folder.members.push(ref);
    return;
  }
  const experiment = folder.experiments.find((e) => e.id === target.experimentId);
  if (!experiment) throw new Error(`experiment ${target.experimentId} not found`);
  experiment.members.push(ref);
}
