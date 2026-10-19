import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { compileFormula, detectDelimiter, formatCellValue, isCellExcluded, KIND_COLUMNS, parseCellInput, parseCellValue, parseDelimited, transposeGrid, xColumn } from "@mady/core";
import type { CellPattern, CellValue, Column, ColumnType, DataTable, DateOrder, NodeId } from "@mady/core";
import { cellPatternBackground } from "./cellPatterns";
import { resolveDateOrder } from "./profile";

/** Column-menu field for a calculated-variable formula: live-validated, commits on
 *  Enter / blur. Column letters A/B/C… = column position. `columnCount` lets the validator
 *  flag a letter past the last column ("A+D" on a 3-column sheet) — evaluation would
 *  otherwise blank the column silently and read as a data problem. */
function FormulaField({ initial, columnCount, onCommit }: { initial: string; columnCount: number; onCommit: (formula: string | undefined) => void }) {
  const [draft, setDraft] = useState(initial);
  const trimmed = draft.trim();
  const compiled = trimmed ? compileFormula(trimmed, columnCount) : null;
  const err = compiled && !compiled.ok ? compiled.error : null;
  const commit = (): void => { if (!err) onCommit(trimmed || undefined); };
  return (
    <div className="dgmenu-i" style={{ display: "flex", flexDirection: "column", gap: 3, alignItems: "stretch" }} onMouseDown={(e) => e.stopPropagation()}>
      <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <span>ƒ(x)</span>
        <input
          aria-label="Column formula"
          value={draft}
          placeholder="e.g. A/B, LOG(A), IF(A>0,B,C)"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { commit(); e.stopPropagation(); } }}
          onBlur={commit}
          style={{ flex: 1, minWidth: 150, borderColor: err ? "var(--danger, #c0392b)" : undefined }}
        />
      </span>
      <span style={{ fontSize: 10.5, color: err ? "var(--danger, #c0392b)" : "var(--muted)" }}>
        {err ?? "A = column 1, B = column 2, … · MEAN/SUM/SD(A) · blank to clear"}
      </span>
    </div>
  );
}

/** A run of consecutive columns that form one Y dataset (for the grouped header). */
interface HeaderRun {
  datasetId: NodeId;
  /** Physical column index of the dataset's lead (group-label / rename target). */
  leadIndex: number;
  name: string;
  /** Each member column: physical index + its subcolumn label (rep number, or a
   *  summary-role tag: Mean/SD/SEM/N/%CV/Lower/Upper/± Err). */
  cols: { c: number; sub: string }[];
}

/**
 * Group the data columns (everything except the leading X/label column) into
 * datasets by their `group` id, preserving order — replicate subcolumns of one Y
 * dataset are contiguous, so each run renders as one spanning header with numbered
 * subcols. The leading column is format-aware (`xColumn`): XY/grouped/survival/…
 * have one; a multivariable table has none, so every column is its own dataset.
 */
export function dataColumnRuns(table: DataTable): HeaderRun[] {
  const leadId = xColumn(table)?.id;
  const runs: HeaderRun[] = [];
  let i = 0;
  while (i < table.columns.length) {
    const head = table.columns[i]!;
    if (head.id === leadId || head.role === "x") {
      i++;
      continue;
    }
    const dsId = head.group ?? head.id;
    const run: HeaderRun = { datasetId: dsId, leadIndex: -1, name: "", cols: [] };
    let rep = 0;
    let hasSummaryRole = false;
    let hasErrLow = false;
    let hasErrHigh = false;
    let hasQuartile = false; // q1/q3 → the lead is a median
    let hasGeo = false; // geosd → the lead is a geometric mean
    while (i < table.columns.length) {
      const c = table.columns[i]!;
      if (c.id === leadId || c.role === "x" || (c.group ?? c.id) !== dsId) break;
      if (c.id === dsId) run.leadIndex = i;
      const role = c.role ?? "y";
      if (role === "errlow") hasErrLow = true;
      if (role === "errhigh") hasErrHigh = true;
      if (role === "q1" || role === "q3") hasQuartile = true;
      if (role === "geosd") hasGeo = true;
      if (role === "sd" || role === "sem" || role === "n" || role === "cv" || role === "errlow" || role === "errhigh" || role === "min" || role === "max" || role === "q1" || role === "q3" || role === "geosd" || role === "ci") hasSummaryRole = true;
      const sub =
        role === "sd" ? "SD"
        : role === "sem" ? "SEM"
        : role === "n" ? "N"
        : role === "cv" ? "%CV"
        : role === "errlow" ? "Lower"
        : role === "errhigh" ? "Upper"
        : role === "min" ? "Min"
        : role === "max" ? "Max"
        : role === "q1" ? "Q1"
        : role === "q3" ? "Q3"
        : role === "geosd" ? "GSD"
        : role === "ci" ? "95% CI"
        : role === "xerr" ? "X err"
        : String(++rep);
      run.cols.push({ c: i, sub });
      i++;
    }
    if (run.leadIndex < 0) run.leadIndex = run.cols[0]!.c;
    run.name = table.columns[run.leadIndex]!.name;
    // Any summary entry mode: the lone Y column is the centre, so label it with the centre
    // its format implies (Median for IQR, Geo mean for geometric, else Mean) rather than a
    // replicate "1", to read like a summary table.
    if (hasSummaryRole) {
      const centre = hasQuartile ? "Median" : hasGeo ? "Geo mean" : "Mean";
      for (const col of run.cols) if (/^\d+$/.test(col.sub)) col.sub = centre;
    }
    // "Mean ± error" mode stores a single symmetric ± value in an errhigh column with no
    // errlow sibling — read it as "± Err", not a one-sided "Upper" (which means a limit).
    if (hasErrHigh && !hasErrLow) {
      for (const col of run.cols) if (col.sub === "Upper") col.sub = "± Err";
    }
    runs.push(run);
  }
  return runs;
}

/**
 * DataGrid — an editable, spreadsheet-style view of a DataTable.
 *
 * Like a real spreadsheet it always presents a large empty grid — hundreds of
 * rows and dozens of columns beyond the data — so large blocks paste in one
 * action with room to spare. Rows are **virtualized** (only the visible
 * window renders) so a 10k-row paste stays fast. Supports rectangular
 * **selection** (click-drag / shift-click / shift-arrows), **copy/cut/paste**
 * (TSV, Excel-compatible), **fill-down** (Ctrl+D), **transpose** (Ctrl+Shift+T),
 * and clear (Delete). Column headers are the single source of truth for axis
 * titles. Click selects; double-click or Enter edits.
 */

const ROW_H = 27;
const RENDER_ROWS = 70;
const OVERSCAN = 10;
const MIN_ROWS = 200;
const SPARE_ROWS = 80;
const MIN_COLS = 26;
const SPARE_COLS = 10;

export interface DataGridProps {
  table: DataTable;
  /** View zoom (1 = 100%); scales the rendered grid + the virtualization math. */
  zoom?: number;
  onEditCell: (rowIndex: number, colIndex: number, value: CellValue) => void;
  onRenameColumn: (columnId: NodeId, name: string) => void;
  onPaste: (rowStart: number, colStart: number, block: CellValue[][]) => void;
  onClearCells: (rowStart: number, colStart: number, rows: number, cols: number) => void;
  onFillDown: (rowStart: number, colStart: number, rows: number, cols: number) => void;
  onTranspose: (rowStart: number, colStart: number, rows: number, cols: number) => void;
  onInsertRow?: (index: number) => void;
  onDeleteRow?: (index: number) => void;
  onInsertColumn?: (index: number) => void;
  onDeleteColumn?: (index: number) => void;
  /** Delete several columns at once (a grouped dataset = its lead + subcolumns). */
  onDeleteColumns?: (indices: number[]) => void;
  onMoveRow?: (from: number, to: number) => void;
  onMoveColumn?: (from: number, to: number) => void;
  /** Make this column the X axis — it becomes the leftmost (lead) column. */
  onSetXColumn?: (index: number) => void;
  /** Sort every row by this column's values (ascending / descending). */
  onSortColumn?: (index: number, direction: "asc" | "desc") => void;
  /** Set a column's cell type (Number/Text/Date/Elapsed/Categorical). */
  onSetColumnType?: (columnId: NodeId, type: ColumnType | undefined) => void;
  /** Set a number column's fixed display decimals (undefined = auto-trim). */
  onSetColumnDecimals?: (columnId: NodeId, decimals: number | undefined) => void;
  /** Set (or clear) a column's calculated-variable formula. */
  onSetColumnFormula?: (columnId: NodeId, formula: string | undefined) => void;
  /** Exclude/include a set of cells (kept but omitted from analyses/graphs). */
  onToggleExcluded?: (cells: ReadonlyArray<{ rowId: NodeId; colId: NodeId }>, excluded: boolean) => void;
  /**
   * Report the selected block so commands outside the grid (the Data menu, the command
   * palette, the datasheet's Exclude button) can act on it.
   *
   * Deliberately the bounds and not the resolved cell list: a drag-select fires this on
   * every mouse-enter, and rebuilding an array of `{rowId, colId}` for a big block on each
   * one would churn hard for a payload the caller can reconstruct from the table anyway.
   * `null` = nothing selected, which is what disables those commands.
   */
  onSelectionChange?: (bounds: { r0: number; c0: number; r1: number; c1: number } | null) => void;
}

/** Right-click structural menu over a row-/column-header, or a data cell. */
interface GridMenu {
  kind: "row" | "col" | "cell";
  index: number;
  /** For a "cell" menu: the right-clicked cell coordinates. */
  r?: number;
  c?: number;
  x: number;
  y: number;
}

interface Cell {
  r: number;
  c: number;
}
interface Sel {
  a: Cell;
  f: Cell;
}

/** Parse typed text into a cell value: blank → null, plain decimal → number, else string.
 *  Delegates to core's shared grammar so a pasted "007" / "0x1A" stays the text ID import
 *  keeps it as (a raw `Number()` would turn it into 7 / 26). */
export function parseCell(text: string): CellValue {
  return parseCellValue(text);
}

/** Parse a clipboard block into a 2-D grid, honouring the actual delimiter and RFC-4180
 *  quoting via the core parser. A genuine Excel/Sheets copy is tab-delimited and still
 *  detects as tab; pasted CSV (or ;/| text) splits into its columns rather than one column
 *  per row, and an Excel-quoted cell ("a, b") is kept whole instead of torn apart. When
 *  `columns` is given, each token is typed against its destination column (dates/elapsed/text keep
 *  their kind) so a pasted date stores as a value, not a string that vanishes from
 *  analyses. Without columns, falls back to the generic blank/number/string parse. */
export function parseClipboard(
  text: string,
  columns?: ReadonlyArray<Pick<Column, "type">>,
  startCol = 0,
  dateOrder?: DateOrder,
): CellValue[][] {
  const grid = parseDelimited(text, detectDelimiter(text));
  return grid.map((row) =>
    row.map((tok, j) => (columns ? parseCellInput(tok, columns[startCol + j], { dateOrder }) : parseCell(tok))),
  );
}

/**
 * Serialize a rectangular block of a table to TSV using each column's round-trippable text
 * (full precision + typed date/elapsed), the exact form the in-grid copy uses — so a copy issued
 * from the Edit menu (no ClipboardEvent, only the selection bounds) is byte-identical to Ctrl+C.
 * Bounds are inclusive and clamped to the table. Shared by the grid and the app's Edit menu.
 */
export function serializeCells(table: DataTable, b: { r0: number; c0: number; r1: number; c1: number }): string {
  const nRows = table.rows.length;
  const nCols = table.columns.length;
  const lines: string[] = [];
  // Iterate the full selection bounds, emitting "" for a cell past the data — a selection can
  // extend into the grid's spare rows/columns, and copying must preserve that block's shape
  // (this mirrors the grid's `editText`).
  for (let r = b.r0; r <= b.r1; r++) {
    const row: string[] = [];
    for (let c = b.c0; c <= b.c1; c++) {
      if (r >= nRows || c >= nCols) { row.push(""); continue; }
      const col = table.columns[c]!;
      row.push(formatCellValue(table.rows[r]!.cells[col.id] ?? null, col.type ? { type: col.type } : undefined));
    }
    lines.push(row.join("\t"));
  }
  return lines.join("\n");
}

type Move = "down" | "up" | "left" | "right" | "none";

function bounds(sel: Sel) {
  return {
    r0: Math.min(sel.a.r, sel.f.r),
    r1: Math.max(sel.a.r, sel.f.r),
    c0: Math.min(sel.a.c, sel.f.c),
    c1: Math.max(sel.a.c, sel.f.c),
  };
}

/**
 * The real data cells inside a selected block, as `{rowId, colId}` pairs.
 *
 * Shared by the grid's own right-click menu, the datasheet's Exclude button and the Data
 * menu command, so all three act on exactly the same set. Clamped to the table's real
 * extent: the grid always draws spare rows/columns past the end of the data, and those
 * have no ids to exclude — a selection dragged over them must simply ignore them.
 */
export function cellsInBounds(
  table: DataTable,
  b: { r0: number; c0: number; r1: number; c1: number },
): { rowId: NodeId; colId: NodeId }[] {
  const cells: { rowId: NodeId; colId: NodeId }[] = [];
  for (let r = b.r0; r <= Math.min(b.r1, table.rows.length - 1); r++)
    for (let c = b.c0; c <= Math.min(b.c1, table.columns.length - 1); c++)
      cells.push({ rowId: table.rows[r]!.id, colId: table.columns[c]!.id });
  return cells;
}

export function DataGrid(props: DataGridProps) {
  const { table, zoom = 1, onEditCell, onRenameColumn, onPaste, onClearCells, onFillDown, onTranspose,
    onInsertRow, onDeleteRow, onInsertColumn, onDeleteColumn, onDeleteColumns, onMoveRow, onMoveColumn, onSetXColumn, onSortColumn,
    onSetColumnType, onSetColumnDecimals, onSetColumnFormula, onToggleExcluded, onSelectionChange } = props;
  const ro = table.frozen ?? false;
  const structural = Boolean(onInsertRow || onDeleteRow || onInsertColumn || onDeleteColumn);
  /** A small hover-revealed × in a column/dataset header that deletes it (undoable).
   *  Stops mousedown so it never starts a header rename/drag. */
  const delCross = (onClick: () => void, label: string) =>
    ro ? null : (
      <button
        type="button"
        className="dgcolx"
        title={label}
        draggable={false}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
      >
        ×
      </button>
    );
  const nCols = table.columns.length;
  const nRows = table.rows.length;
  const totalRows = Math.max(MIN_ROWS, nRows + SPARE_ROWS);
  const totalCols = Math.max(MIN_COLS, nCols + SPARE_COLS);
  // Grouped header when any Y dataset has >1 subcolumn.
  const runs = dataColumnRuns(table);
  const grouped = runs.some((r) => r.cols.length > 1);
  // The leading independent/label column, format-aware (undefined for multivariable).
  const xCol = xColumn(table);
  const kindCols = KIND_COLUMNS[table.kind];
  // Physical index of the leading X/label column (-1 = none, e.g. multivariable).
  const xColIndex = xCol ? table.columns.findIndex((c) => c.id === xCol.id) : -1;
  /** Small uppercase role tag for a column header, by the table format. */
  const roleTag = (colId: NodeId | undefined): string | null => {
    if (colId && colId === xCol?.id) return kindCols.lead ?? null;
    return kindCols.data;
  };
  const renameHeader = (index: number, name: string): void => {
    const col = table.columns[index];
    if (col && name.trim() && name.trim() !== col.name) onRenameColumn(col.id, name.trim());
    setEditingHeader(null);
  };

  const wrapRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [sel, setSel] = useState<Sel | null>(null);
  const [editCell, setEditCell] = useState<Cell | null>(null);
  // When editing was opened by typing a character (spreadsheet-style type-to-replace), the
  // editor seeds with that character instead of the cell's existing value. `null` = opened by
  // double-click / Enter / F2, which edit the value already in the cell.
  const [editSeed, setEditSeed] = useState<string | null>(null);
  const [editingHeader, setEditingHeader] = useState<number | null>(null);
  const [menu, setMenu] = useState<GridMenu | null>(null);
  const dragging = useRef(false);
  // Header drag-reorder: which row/col index is being dragged, and the hovered drop target.
  const reorder = useRef<{ kind: "row" | "col"; from: number } | null>(null);
  const [dropTarget, setDropTarget] = useState<{ kind: "row" | "col"; index: number } | null>(null);

  const startColDrag = (e: React.DragEvent, index: number): void => {
    if (!onMoveColumn || index >= nCols) return;
    reorder.current = { kind: "col", from: index };
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", `col:${index}`);
  };
  const startRowDrag = (e: React.DragEvent, index: number): void => {
    if (!onMoveRow || index >= nRows) return;
    reorder.current = { kind: "row", from: index };
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", `row:${index}`);
  };
  const overTarget = (e: React.DragEvent, kind: "row" | "col", index: number): void => {
    if (reorder.current?.kind !== kind) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dropTarget?.kind !== kind || dropTarget.index !== index) setDropTarget({ kind, index });
  };
  const dropOn = (kind: "row" | "col", index: number): void => {
    const r = reorder.current;
    reorder.current = null;
    setDropTarget(null);
    if (!r || r.kind !== kind || r.from === index) return;
    if (kind === "col") onMoveColumn?.(r.from, index);
    else onMoveRow?.(r.from, index);
  };
  const endDrag = (): void => {
    reorder.current = null;
    setDropTarget(null);
  };

  useEffect(() => {
    const up = () => (dragging.current = false);
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, []);

  // Dismiss the structural menu on any outside click / Escape / scroll.
  useEffect(() => {
    if (!menu) return;
    const close = (): void => setMenu(null);
    window.addEventListener("mousedown", close);
    window.addEventListener("scroll", close, true);
    const key = (e: KeyboardEvent): void => { if (e.key === "Escape") setMenu(null); };
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", key);
    };
  }, [menu]);

  const openColMenu = (e: React.MouseEvent, colIndex: number): void => {
    if (!structural) return;
    e.preventDefault();
    setMenu({ kind: "col", index: colIndex, x: e.clientX, y: e.clientY });
  };
  const openRowMenu = (e: React.MouseEvent, rowIndex: number): void => {
    if (!structural) return;
    e.preventDefault();
    setMenu({ kind: "row", index: rowIndex, x: e.clientX, y: e.clientY });
  };

  // The table is CSS-zoomed, so on-screen row height is ROW_H*zoom and the
  // wrapper's scrollTop is in those zoomed px. Render enough rows to fill the
  // viewport at this zoom; padding rows stay in the table's own (unzoomed) px.
  const rowH = ROW_H * zoom;
  const renderRows = Math.ceil(RENDER_ROWS / Math.min(1, zoom)) + OVERSCAN;
  const start = Math.max(0, Math.min(totalRows - renderRows, Math.floor(scrollTop / rowH) - OVERSCAN));
  const end = Math.min(totalRows, start + renderRows);
  const topPad = start * ROW_H;
  const botPad = (totalRows - end) * ROW_H;

  const cellText = (r: number, c: number): string => {
    if (r >= nRows || c >= nCols) return "";
    const col = table.columns[c]!;
    return formatCellValue(table.rows[r]!.cells[col.id] ?? null, col);
  };
  /** The editable form: full precision (no fixed decimals) + date/elapsed in their typed form. */
  const editText = (r: number, c: number): string => {
    if (r >= nRows || c >= nCols) return "";
    const col = table.columns[c]!;
    return formatCellValue(table.rows[r]!.cells[col.id] ?? null, col.type ? { type: col.type } : undefined);
  };
  const isExcl = (r: number, c: number): boolean =>
    r < nRows && c < nCols && isCellExcluded(table, table.rows[r]!.id, table.columns[c]!.id);
  /** The background colour set on this cell (purely visual), or undefined. */
  const fillOf = (r: number, c: number): string | undefined =>
    r < nRows && c < nCols ? table.cellFills?.[table.rows[r]!.id]?.[table.columns[c]!.id] : undefined;
  /** The pattern overlay set on this cell (purely visual), or undefined. */
  const patternOf = (r: number, c: number): CellPattern | undefined =>
    r < nRows && c < nCols ? table.cellPatterns?.[table.rows[r]!.id]?.[table.columns[c]!.id] : undefined;

  const inSel = (r: number, c: number): boolean => {
    if (!sel) return false;
    const b = bounds(sel);
    return r >= b.r0 && r <= b.r1 && c >= b.c0 && c <= b.c1;
  };

  // Publish the selected block upward (see `onSelectionChange`). Reported as a plain
  // bounds object, and only when the block actually moves — not on every render.
  const selB = sel ? bounds(sel) : null;
  const selKey = selB ? `${selB.r0}:${selB.c0}:${selB.r1}:${selB.c1}` : "";
  useEffect(() => {
    onSelectionChange?.(selB);
    // Unmounting (switching tabs) must clear it, or a stale block keeps the command live.
    return () => onSelectionChange?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selKey]);

  function clamp(v: number, hi: number) {
    return Math.max(0, Math.min(hi, v));
  }

  function commit(text: string, move: Move): void {
    if (!editCell) return;
    const { r, c } = editCell;
    const grow = r >= nRows || c >= nCols;
    const value = parseCellInput(text, table.columns[c], { dateOrder: resolveDateOrder() });
    // A calculated (formula) column is read-only — its cells derive from the formula.
    const calc = !!table.columns[c]?.formula;
    if (!calc && text !== editText(r, c) && !(value === null && grow)) onEditCell(r, c, value);
    setEditCell(null);
    setEditSeed(null);
    if (move !== "none") {
      const nf = moveCell({ r, c }, move, totalRows, totalCols);
      setSel({ a: nf, f: nf });
    }
    wrapRef.current?.focus();
  }

  // --- clipboard + range commands -----------------------------------------

  // Round-trippable form (full precision + typed date/elapsed), not the display-rounded text —
  // else an in-app paste re-parses a value already rounded to the column's display decimals and
  // silently loses precision. Single-sourced with the Edit-menu copy.
  const serialize = (sel: Sel): string => serializeCells(table, bounds(sel));

  /**
   * True while a cell or a column title is being edited.
   *
   * Note: the clipboard handlers sit on the grid wrapper, so they fire for anything focused
   * inside it — including the header-rename input. `editingHeader` is separate state from the
   * open cell editor, so both must be checked; otherwise using the clipboard while naming a
   * column is taken as a grid operation: with a cell selection active a paste would
   * `preventDefault()` and drop the text into the cells instead of the title, and a copy would
   * take the selection rather than the name.
   */
  const editingText = editCell != null || editingHeader != null;

  function handleCopy(e: React.ClipboardEvent): void {
    if (editingText || !sel) return;
    e.clipboardData.setData("text/plain", serialize(sel));
    e.preventDefault();
  }

  function handleCut(e: React.ClipboardEvent): void {
    if (editingText || !sel) return;
    e.clipboardData.setData("text/plain", serialize(sel));
    e.preventDefault();
    const b = bounds(sel);
    onClearCells(b.r0, b.c0, b.r1 - b.r0 + 1, b.c1 - b.c0 + 1);
  }

  function handlePaste(e: React.ClipboardEvent): void {
    const text = e.clipboardData.getData("text");
    if (editingHeader != null) return; // renaming a column — the input owns the clipboard
    if (editCell && !/[\t\n\r]/.test(text)) return; // single value → into the open input
    let r: number;
    let c: number;
    if (editCell) {
      ({ r, c } = editCell);
    } else if (sel) {
      const b = bounds(sel);
      r = b.r0;
      c = b.c0;
    } else {
      return;
    }
    if (ro) return; // frozen tables are read-only
    e.preventDefault();
    onPaste(r, c, parseClipboard(text, table.columns, c, resolveDateOrder()));
    setEditCell(null);
  }

  // --- right-click clipboard actions ---------------------------------------
  // The keyboard path uses ClipboardEvent; a menu click has no such event, so these use the
  // async Clipboard API (present in Electron/Chromium; optional-chained so a runtime without
  // it is a no-op rather than a crash). They reuse the same serialize / parseClipboard the
  // keyboard handlers use, so a menu copy/paste behaves identically to Ctrl+C / Ctrl+V.
  function menuCopy(): void {
    if (sel) void navigator.clipboard?.writeText?.(serialize(sel));
  }
  function menuCut(): void {
    if (!sel || ro) return;
    void navigator.clipboard?.writeText?.(serialize(sel));
    const b = bounds(sel);
    onClearCells(b.r0, b.c0, b.r1 - b.r0 + 1, b.c1 - b.c0 + 1);
  }
  /** Paste at the selection's top-left. `transposed` = Paste Special: rows↔columns swapped. */
  function menuPaste(transposed: boolean): void {
    if (ro || !sel) return;
    const read = navigator.clipboard?.readText?.();
    if (!read) return;
    void read.then((text) => {
      if (!text) return;
      const b = bounds(sel);
      // For a straight paste, type each token against its destination column (as the keyboard
      // path does). For a transposed paste the columns no longer line up, so parse generically
      // and let the transposed values land as-is.
      const block = transposed
        ? transposeGrid<CellValue>(parseClipboard(text), "")
        : parseClipboard(text, table.columns, b.c0, resolveDateOrder());
      onPaste(b.r0, b.c0, block);
    });
  }

  function handleKeyDown(e: React.KeyboardEvent): void {
    // An open cell editor or a header-rename input owns the keyboard. The rename input sits
    // inside `.dgwrap`, so its keystrokes bubble to this handler; without the `editingHeader`
    // guard, grid gestures would fire mid-rename — Backspace would clear the selected cell's
    // data while deleting a character in the title, arrows would move the selection, and a
    // letter would open a stray cell editor (type-to-edit) and swallow the keystroke.
    if (editCell || editingHeader != null) return;
    const k = e.key;
    const ctrl = e.ctrlKey || e.metaKey;
    const arrows: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    if (arrows[k] && sel) {
      const [dr, dc] = arrows[k];
      const nf = { r: clamp(sel.f.r + dr, totalRows - 1), c: clamp(sel.f.c + dc, totalCols - 1) };
      setSel(e.shiftKey ? { a: sel.a, f: nf } : { a: nf, f: nf });
      e.preventDefault();
    } else if ((k === "Enter" || k === "F2") && sel && !ro) {
      setEditCell(sel.f);
      e.preventDefault();
    } else if ((k === "Delete" || k === "Backspace") && sel && !ro) {
      const b = bounds(sel);
      onClearCells(b.r0, b.c0, b.r1 - b.r0 + 1, b.c1 - b.c0 + 1);
      e.preventDefault();
    } else if (ctrl && e.shiftKey && k.toLowerCase() === "t" && sel && !ro) {
      const b = bounds(sel);
      onTranspose(b.r0, b.c0, b.r1 - b.r0 + 1, b.c1 - b.c0 + 1);
      e.preventDefault();
    } else if (ctrl && k.toLowerCase() === "d" && sel && !ro) {
      const b = bounds(sel);
      onFillDown(b.r0, b.c0, b.r1 - b.r0 + 1, b.c1 - b.c0 + 1);
      e.preventDefault();
    } else if (!ctrl && !e.altKey && sel && !ro && k.length === 1) {
      // Type-to-edit (spreadsheet behaviour): a printable keystroke on a selected cell begins
      // editing, seeded with that character so it replaces the cell's contents, as in any
      // spreadsheet. Without this, selecting a cell and typing would do
      // nothing (double-click / Enter would be the only ways in). `k.length === 1`
      // admits letters/digits/punctuation/space and excludes every named key (Enter, ArrowUp,
      // Tab, …); Ctrl/Alt combos are already handled or reserved above.
      setEditSeed(k);
      setEditCell(sel.f);
      e.preventDefault();
    }
  }

  function onCellDown(r: number, c: number, e: React.MouseEvent): void {
    // Only the left button starts a selection/drag. A right-click must not collapse the block:
    // `openCellMenu` keeps a multi-cell selection when right-clicking inside it (its `if
    // (!inSel) setSel` guard), but that guard is dead if this mousedown already reset `sel` to
    // the single clicked cell — "Exclude values" would then exclude only one cell of the block.
    // A right-click must also not arm `dragging`, which would extend the selection on the next hover.
    if (e.button !== 0) return;
    setEditingHeader(null);
    if (e.shiftKey && sel) setSel({ a: sel.a, f: { r, c } });
    else setSel({ a: { r, c }, f: { r, c } });
    dragging.current = true;
    wrapRef.current?.focus();
  }

  /** Right-click a data cell → exclude/include menu (operates on the selection). */
  function openCellMenu(e: React.MouseEvent, r: number, c: number): void {
    if (!onToggleExcluded) return; // not an editable datasheet context
    // Note: open on any grid cell — including empty cells in an active column and the spare area —
    // so Paste is reachable there (the main use of a spreadsheet's blank cells). Copy/Exclude
    // act on whatever real data the selection covers; on a purely empty cell they no-op.
    e.preventDefault();
    if (!inSel(r, c)) setSel({ a: { r, c }, f: { r, c } });
    setMenu({ kind: "cell", index: 0, r, c, x: e.clientX, y: e.clientY });
  }

  /** Exclude / include every real data cell in the current selection. */
  function toggleExclSelection(excluded: boolean): void {
    if (!onToggleExcluded || !sel) return;
    const cells = cellsInBounds(table, bounds(sel));
    if (cells.length) onToggleExcluded(cells, excluded);
  }


  return (
    <div
      className="dgwrap"
      ref={wrapRef}
      tabIndex={0}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      onKeyDown={handleKeyDown}
      onCopy={handleCopy}
      onCut={handleCut}
      onPaste={handlePaste}
    >
      <table className="dg" style={{ zoom }}>
        <thead>
          {grouped ? (
            <>
              {/* group band: X (spanning) + one spanning header per dataset */}
              <tr className="dggrp">
                <th className="dgcorner" rowSpan={2} />
                <th
                  className="dghead dgx"
                  rowSpan={2}
                  onDoubleClick={xCol ? () => setEditingHeader(0) : undefined}
                  onContextMenu={xCol ? (e) => openColMenu(e, 0) : undefined}
                >
                  {xCol && editingHeader === 0 ? (
                    <TextInput
                      initial={xCol.name}
                      onCommit={(name) => renameHeader(0, name)}
                      onCancel={() => setEditingHeader(null)}
                    />
                  ) : xCol ? (
                    <span className="dgheadinner">
                      {kindCols.lead && <span className="dgrole">{kindCols.lead}</span>}
                      <span className="dgname" title="Double-click to rename">{xCol.name}</span>
                    </span>
                  ) : null}
                </th>
                {runs.map((run) => (
                  <th
                    key={`grp-${run.datasetId}`}
                    className="dggrouphead"
                    colSpan={run.cols.length}
                    onDoubleClick={() => setEditingHeader(run.leadIndex)}
                    onContextMenu={(e) => openColMenu(e, run.leadIndex)}
                  >
                    {editingHeader === run.leadIndex ? (
                      <TextInput
                        initial={run.name}
                        onCommit={(name) => renameHeader(run.leadIndex, name)}
                        onCancel={() => setEditingHeader(null)}
                      />
                    ) : (
                      <span className="dgheadinner">
                        {kindCols.data && <span className="dgrole">{kindCols.data}</span>}
                        <span className="dgname" title="Dataset — double-click to rename">{run.name}</span>
                        {(onDeleteColumns || onDeleteColumn) && editingHeader !== run.leadIndex &&
                          delCross(() => {
                            const idx = run.cols.map((cc) => cc.c);
                            if (idx.length > 1 && onDeleteColumns) onDeleteColumns(idx);
                            else onDeleteColumn?.(run.leadIndex);
                          }, `Delete dataset “${run.name}” (and its graph series)`)}
                      </span>
                    )}
                  </th>
                ))}
                {Array.from({ length: totalCols - nCols }, (_, k) => (
                  <th key={`sp-${k}`} className="dghead sparehead" rowSpan={2} />
                ))}
              </tr>
              {/* subcolumn band: replicate numbers (and SD/SEM/N for summary cols) */}
              <tr className="dgsub">
                {runs.flatMap((run) =>
                  run.cols.map((cc) => (
                    <th key={`sub-${cc.c}`} className="dgsubhead" onContextMenu={(e) => openColMenu(e, cc.c)}>
                      {cc.sub}
                    </th>
                  )),
                )}
              </tr>
            </>
          ) : (
            <tr>
              <th className="dgcorner" />
              {Array.from({ length: totalCols }, (_, c) => {
                const col = c < nCols ? table.columns[c]! : null;
                const isLead = Boolean(col && col.id === xCol?.id);
                const tag = col ? roleTag(col.id) : null;
                return (
                  <th
                    key={c}
                    className={
                      "dghead" +
                      (col ? "" : " sparehead") +
                      (isLead ? " dgx" : "") +
                      (dropTarget?.kind === "col" && dropTarget.index === c ? " dgdrop" : "")
                    }
                    draggable={Boolean(col && onMoveColumn && editingHeader !== c)}
                    onDragStart={(e) => startColDrag(e, c)}
                    onDragOver={(e) => overTarget(e, "col", c)}
                    onDrop={() => dropOn("col", c)}
                    onDragEnd={endDrag}
                    title={col ? "Double-click to rename · drag to reorder · right-click for insert/delete" : undefined}
                    onDoubleClick={col ? () => setEditingHeader(c) : undefined}
                    onContextMenu={col ? (e) => openColMenu(e, c) : undefined}
                  >
                    {col && editingHeader === c ? (
                      <TextInput
                        initial={col.name}
                        onCommit={(name) => renameHeader(c, name)}
                        onCancel={() => setEditingHeader(null)}
                      />
                    ) : col ? (
                      <span className="dgheadinner">
                        {tag && <span className="dgrole">{tag}</span>}
                        <span className="dgname" title="Double-click to rename">{col.name}</span>
                        {onDeleteColumn && editingHeader !== c && delCross(() => onDeleteColumn(c), `Delete column “${col.name}”`)}
                      </span>
                    ) : null}
                  </th>
                );
              })}
            </tr>
          )}
        </thead>
        <tbody>
          {topPad > 0 && (
            <tr className="dgpadrow" style={{ height: topPad }} aria-hidden>
              <td colSpan={totalCols + 1} />
            </tr>
          )}
          {Array.from({ length: end - start }, (_, i) => {
            const r = start + i;
            return (
              <tr key={r}>
                <td
                  className={"dgrh" + (dropTarget?.kind === "row" && dropTarget.index === r ? " dgdrop" : "")}
                  draggable={Boolean(onMoveRow && r < nRows)}
                  onDragStart={(e) => startRowDrag(e, r)}
                  onDragOver={(e) => overTarget(e, "row", r)}
                  onDrop={() => dropOn("row", r)}
                  onDragEnd={endDrag}
                  title={r < nRows ? "Drag to reorder · hover for ✕ · right-click for insert/delete" : undefined}
                  onContextMenu={(e) => openRowMenu(e, r)}
                >
                  <span className="dgrownum">{r + 1}</span>
                  {!ro && onDeleteRow && r < nRows && (
                    <button
                      type="button"
                      className="dgrowx"
                      title={`Delete row ${r + 1}`}
                      draggable={false}
                      tabIndex={-1}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => { e.stopPropagation(); onDeleteRow(r); }}
                    >
                      ✕
                    </button>
                  )}
                </td>
                {Array.from({ length: totalCols }, (_, c) => {
                  const editing = editCell?.r === r && editCell?.c === c;
                  const focused = sel?.f.r === r && sel?.f.c === c;
                  const selected = inSel(r, c);
                  const fill = fillOf(r, c);
                  const pattern = patternOf(r, c);
                  // Fill colour + pattern overlay, both hidden while the cell is in the selected
                  // block (the selection tint must read) — they return on deselect. `backgroundColor`
                  // (not the `background` shorthand) so the pattern's backgroundImage survives.
                  const showDeco = !(selected && !focused);
                  const decoStyle: CSSProperties | undefined =
                    showDeco && (fill || pattern)
                      ? { ...(fill ? { backgroundColor: fill } : {}), ...(pattern ? cellPatternBackground(pattern) : {}) }
                      : undefined;
                  return (
                    <td
                      key={c}
                      className={
                        "dgcell" +
                        (focused ? " on" : "") +
                        (selected && !focused ? " insel" : "") +
                        (c === xColIndex ? " dgxcol" : "") +
                        (c >= nCols ? " sparecol" : "") +
                        (isExcl(r, c) ? " dgexcl" : "")
                      }
                      // Show the cell colour except while it's in the selected block, where the
                      // selection tint (.insel background) needs to read instead — the fill returns
                      // the moment the block is deselected. The focused cell uses an outline, so its
                      // fill stays visible.
                      style={decoStyle}
                      title={isExcl(r, c) ? "Excluded — kept in the table but omitted from analyses and graphs" : undefined}
                      onMouseDown={(e) => onCellDown(r, c, e)}
                      onMouseEnter={() => {
                        if (dragging.current) setSel((s) => (s ? { a: s.a, f: { r, c } } : s));
                      }}
                      onDoubleClick={() => { if (!ro) setEditCell({ r, c }); }}
                      onContextMenu={(e) => openCellMenu(e, r, c)}
                    >
                      {editing ? (
                        <TextInput
                          initial={editSeed ?? editText(r, c)}
                          onCommit={commit}
                          onCancel={() => {
                            setEditCell(null);
                            setEditSeed(null);
                            wrapRef.current?.focus();
                          }}
                        />
                      ) : (
                        cellText(r, c)
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
          {botPad > 0 && (
            <tr className="dgpadrow" style={{ height: botPad }} aria-hidden>
              <td colSpan={totalCols + 1} />
            </tr>
          )}
        </tbody>
      </table>
      {menu && (
        <div
          className="dgmenu"
          style={{ position: "fixed", left: menu.x, top: menu.y, zIndex: 50 }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {menu.kind === "cell" ? (
            <>
              <button className="dgmenu-i" onClick={() => { menuCopy(); setMenu(null); }}>
                Copy
              </button>
              <button className="dgmenu-i" disabled={ro} onClick={() => { menuCut(); setMenu(null); }}>
                Cut
              </button>
              <button className="dgmenu-i" disabled={ro} onClick={() => { menuPaste(false); setMenu(null); }}>
                Paste
              </button>
              <button className="dgmenu-i" disabled={ro} title="Paste with rows and columns swapped" onClick={() => { menuPaste(true); setMenu(null); }}>
                Paste transposed
              </button>
              <div className="dgmenu-sep" />
              <button className="dgmenu-i" onClick={() => { toggleExclSelection(true); setMenu(null); }}>
                Exclude value{sel && (bounds(sel).r1 > bounds(sel).r0 || bounds(sel).c1 > bounds(sel).c0) ? "s" : ""}
              </button>
              <button className="dgmenu-i" onClick={() => { toggleExclSelection(false); setMenu(null); }}>
                Include value{sel && (bounds(sel).r1 > bounds(sel).r0 || bounds(sel).c1 > bounds(sel).c0) ? "s" : ""}
              </button>
            </>
          ) : menu.kind === "col" ? (
            <>
              {onSortColumn && menu.index < nCols && !ro && (
                <>
                  <button className="dgmenu-i" onClick={() => { onSortColumn(menu.index, "asc"); setMenu(null); }}>
                    Sort ascending
                  </button>
                  <button className="dgmenu-i" onClick={() => { onSortColumn(menu.index, "desc"); setMenu(null); }}>
                    Sort descending
                  </button>
                  <div className="dgmenu-sep" />
                </>
              )}
              <button className="dgmenu-i" onClick={() => { onInsertColumn?.(menu.index); setMenu(null); }}>
                Insert column left
              </button>
              <button className="dgmenu-i" onClick={() => { onInsertColumn?.(menu.index + 1); setMenu(null); }}>
                Insert column right
              </button>
              <button className="dgmenu-i dgmenu-del" disabled={menu.index >= nCols} onClick={() => { onDeleteColumn?.(menu.index); setMenu(null); }}>
                Delete column
              </button>
              {/* Make this the X axis — moves it to the leftmost (lead) position, which IS the X
                  for every format that has one. Hidden for the current X. On a MULTIVARIABLE
                  sheet (no shared X) the same action tags the column as the ROW LABELS — the
                  case-name column a heatmap / clustering labels its rows with — so it reads
                  that way (with no such action a text column was drawn as grey cells). */}
              {onSetXColumn && menu.index < nCols && (xColumn(table) || table.kind === "multivariable" || table.kind === "pca") && table.columns[menu.index]?.id !== xColumn(table)?.id && (
                <button className="dgmenu-i" onClick={() => { onSetXColumn(menu.index); setMenu(null); }}>
                  {table.kind === "multivariable" || table.kind === "pca" ? "Use as row labels" : "Use as X axis"}
                </button>
              )}
              {onSetColumnType && menu.index < nCols && (
                <label className="dgmenu-i" style={{ display: "flex", gap: 6, alignItems: "center" }} onMouseDown={(e) => e.stopPropagation()}>
                  Type
                  <select
                    value={table.columns[menu.index]?.type ?? "number"}
                    onChange={(e) => onSetColumnType(table.columns[menu.index]!.id, e.target.value === "number" ? undefined : (e.target.value as ColumnType))}
                  >
                    <option value="number">Number</option>
                    <option value="text">Text</option>
                    <option value="date">Date</option>
                    <option value="elapsed">Elapsed</option>
                    <option value="categorical">Categorical</option>
                  </select>
                </label>
              )}
              {onSetColumnDecimals && menu.index < nCols && (
                <label className="dgmenu-i" style={{ display: "flex", gap: 6, alignItems: "center" }} onMouseDown={(e) => e.stopPropagation()}>
                  Decimals
                  <input
                    type="number"
                    min={0}
                    max={10}
                    placeholder="auto"
                    value={table.columns[menu.index]?.decimals ?? ""}
                    onChange={(e) => onSetColumnDecimals(table.columns[menu.index]!.id, e.target.value === "" ? undefined : Math.max(0, Math.min(10, Number(e.target.value))))}
                    style={{ width: 56 }}
                  />
                </label>
              )}
              {onSetColumnFormula && menu.index < nCols && (
                <FormulaField
                  key={table.columns[menu.index]!.id}
                  initial={table.columns[menu.index]?.formula ?? ""}
                  columnCount={nCols}
                  onCommit={(f) => onSetColumnFormula(table.columns[menu.index]!.id, f)}
                />
              )}
            </>
          ) : (
            <>
              <button className="dgmenu-i" onClick={() => { onInsertRow?.(menu.index); setMenu(null); }}>
                Insert row above
              </button>
              <button className="dgmenu-i" onClick={() => { onInsertRow?.(menu.index + 1); setMenu(null); }}>
                Insert row below
              </button>
              <button className="dgmenu-i dgmenu-del" disabled={menu.index >= nRows} onClick={() => { onDeleteRow?.(menu.index); setMenu(null); }}>
                Delete row
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function moveCell(f: Cell, move: Move, totalRows: number, totalCols: number): Cell {
  const clamp = (v: number, hi: number) => Math.max(0, Math.min(hi, v));
  if (move === "down") return { r: clamp(f.r + 1, totalRows - 1), c: f.c };
  if (move === "up") return { r: clamp(f.r - 1, totalRows - 1), c: f.c };
  if (move === "right") return { r: f.r, c: clamp(f.c + 1, totalCols - 1) };
  if (move === "left") return { r: f.r, c: clamp(f.c - 1, totalCols - 1) };
  return f;
}

/** A single-line input that commits once (Enter/Tab/blur) and cancels on Escape. */
function TextInput({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (text: string, move: Move) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const done = useRef(false);
  const commit = (move: Move) => {
    if (done.current) return;
    done.current = true;
    onCommit(draft, move);
  };
  return (
    <input
      className="dgin"
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => commit("none")}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit("down");
        } else if (e.key === "Tab") {
          e.preventDefault();
          commit(e.shiftKey ? "left" : "right");
        } else if (e.key === "Escape") {
          e.preventDefault();
          done.current = true;
          onCancel();
        }
      }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    />
  );
}
