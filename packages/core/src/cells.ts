/**
 * Cell types, display formatting, and excluded values — the data-entry layer of
 * the table-format system (the "Format → Number / Date / Elapsed / Text" cell
 * types + the "exclude this value" feature). Storage stays a plain `CellValue`; a column's
 * `type` only changes how text is *parsed in* and how a value is *formatted out*:
 *   - `date`     → a number of days since 1970-01-01 (UTC), shown as YYYY-MM-DD
 *   - `elapsed`  → a number of seconds, shown as h:mm:ss
 *   - `text` / `categorical` → a string (never coerced to a number)
 *   - `number` (default) → a number, optionally fixed to `decimals` places
 *
 * Excluded cells are kept in the table but read as `null` through `effectiveValue`
 * so they vanish from analyses, plots and derived tables while staying visible
 * (styled) in the grid. Pure + DOM-free.
 */
import type { CellPattern, CellValue, Column, DataTable, NodeId, Row } from "./model";

const MS_PER_DAY = 86_400_000;

/** Days since 1970-01-01 (UTC) for a Y/M/D, matching the `date` storage convention. */
export function dateToDays(year: number, month: number, day: number): number {
  return Math.floor(Date.UTC(year, month - 1, day) / MS_PER_DAY);
}

/** A `date` storage number (days since epoch) → an ISO YYYY-MM-DD string. */
export function daysToISO(days: number): string {
  return new Date(days * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Whether (year, month, day) is a real calendar date. `Date.UTC` silently rolls an invalid field
 *  over (month 13 → next January, Feb 30 → Mar 1), so the only reliable check is to build the date
 *  and confirm none of the three fields moved. A plain `1..31` range test lets Feb 30 through. */
export function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

/** How a purely-numeric slash/dash date is read: month-day-year (US) or day-month-year (rest of
 *  the world). It is the only thing that can disambiguate "05/06/2020", so it is a user setting. */
export type DateOrder = "mdy" | "dmy";

/** Month names (full + abbreviations) → 1…12, for the unambiguous textual date forms. */
const MONTHS: Readonly<Record<string, number>> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

/**
 * Parse a date string → days since epoch, or null (a typo stays visible text).
 *
 * Deterministic, with no `Date.parse`: V8's `Date.parse` reads slash/dash dates as US
 * **month/day** — so a European "05/06/2020" would silently become 6 May, not 5 June — and turns
 * bare numbers into dates ("42" → 2042). This reads only well-defined forms and refuses the rest:
 *   • ISO `YYYY-MM-DD` / `YYYY/MM/DD` (year-first) — always, rejecting impossible dates;
 *   • numeric `d/m/y` or `d-m-y` with a 2- or 4-digit year last, interpreted by `order`
 *     (mdy vs dmy — the setting; this is the ambiguity Date.parse guesses at);
 *   • textual month, unambiguous either way — "5 Jun 2020", "Jun 5, 2020", "5 June 2020".
 * Anything else (incl. a bare number) → null, so it stays as text rather than a wrong date.
 */
export function parseDate(text: string, order: DateOrder = "mdy"): number | null {
  const t = text.trim();
  // ISO is always year-first and therefore unambiguous; accept an optional time/zone suffix
  // (a full ISO timestamp arrives this way from an Excel import) and read only the date part.
  const iso = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T].*)?$/.exec(t);
  if (iso) {
    const [y, mo, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
    return isValidCalendarDate(y, mo, day) ? dateToDays(y, mo, day) : null;
  }
  const num = /^(\d{1,2})[-/](\d{1,2})[-/](\d{2}|\d{4})$/.exec(t);
  if (num) {
    const a = Number(num[1]);
    const b = Number(num[2]);
    let y = Number(num[3]);
    if (y < 100) y += 2000; // "20" → 2020 (two-digit years land this century)
    const mo = order === "dmy" ? b : a;
    const day = order === "dmy" ? a : b;
    return isValidCalendarDate(y, mo, day) ? dateToDays(y, mo, day) : null;
  }
  const mk = (mo: number | undefined, day: number, y: number): number | null =>
    mo !== undefined && isValidCalendarDate(y, mo, day) ? dateToDays(y, mo, day) : null;
  const dMon = /^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$/.exec(t); // 5 Jun 2020
  if (dMon) return mk(MONTHS[dMon[2]!.toLowerCase()], Number(dMon[1]), Number(dMon[3]));
  const monD = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(t); // Jun 5, 2020
  if (monD) return mk(MONTHS[monD[1]!.toLowerCase()], Number(monD[2]), Number(monD[3]));
  return null;
}

/** A plain decimal number (optionally signed, with exponent) — deliberately not JS's
 *  hex/binary/octal/Infinity grammar, so a token like "0x1A", "0b101" or "0o17" stays a
 *  text ID instead of silently becoming 26/5/15. */
export const DECIMAL_NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
/** A zero-padded integer ("007", "-012") is an identifier, not the number 7 — a lab's
 *  padded sample IDs must survive as text. "0", "0.5", "0e3"
 *  are real numbers and don't match. */
export const ZERO_PADDED_INT = /^[+-]?0\d/;

/**
 * Parse a single text token into a typed cell: blank → null, plain decimal number → number,
 * otherwise the trimmed string. The single source of truth for "looks like a number" — used by
 * import, the grid's typed entry and paste, so the three cannot disagree (e.g. import keeping
 * "007" as text while typing it into the grid produces 7).
 */
export function parseCellValue(text: string, opts?: { decimal?: "." | "," }): CellValue {
  const t = text.trim();
  if (t === "") return null;
  // Opt-in European decimal comma → point before the numeric test (default is point).
  const norm = opts?.decimal === "," ? t.replace(",", ".") : t;
  if (!DECIMAL_NUMBER.test(norm) || ZERO_PADDED_INT.test(norm)) return t; // not a plain number, or a padded ID
  const n = Number(norm);
  return Number.isFinite(n) ? n : t; // overflow (e.g. 1e400 → Infinity) stays text
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** Elapsed seconds → `h:mm:ss` (negative values keep a leading sign). */
export function formatElapsed(seconds: number): string {
  const sign = seconds < 0 ? "-" : "";
  const s = Math.abs(Math.round(seconds));
  return `${sign}${Math.floor(s / 3600)}:${pad2(Math.floor((s % 3600) / 60))}:${pad2(s % 60)}`;
}

/** Parse `h:mm:ss` / `m:ss` / `ss` (or a plain number) → seconds, or null. */
export function parseElapsed(text: string): number | null {
  const t = text.trim();
  if (t === "") return null;
  const neg = t.startsWith("-");
  const parts = (neg ? t.slice(1) : t).split(":");
  if (parts.length > 3) return null;
  let total = 0;
  for (const p of parts) {
    const n = Number(p);
    if (!Number.isFinite(n)) return null;
    total = total * 60 + n;
  }
  return neg ? -total : total;
}

/** Trim a number for display without misrepresenting integers (the grid's default). */
function trimNumber(value: number): string {
  return String(value);
}

type ColumnFormat = Pick<Column, "type" | "decimals">;

/** Format a stored cell value for display, honouring the column's type + decimals. */
export function formatCellValue(value: CellValue, column?: ColumnFormat): string {
  if (value == null) return "";
  const type = column?.type ?? "number";
  if (type === "date") return typeof value === "number" ? daysToISO(value) : String(value);
  if (type === "elapsed") return typeof value === "number" ? formatElapsed(value) : String(value);
  if (type === "text" || type === "categorical") return String(value);
  // number
  if (typeof value === "number") {
    if (column?.decimals != null && Number.isFinite(value)) return value.toFixed(column.decimals);
    return trimNumber(value);
  }
  return String(value);
}

/** Parse typed text into a stored cell value for a column of the given type. */
export function parseCellInput(text: string, column?: Pick<Column, "type">, opts?: { dateOrder?: DateOrder | undefined }): CellValue {
  const t = text.trim();
  if (t === "") return null;
  switch (column?.type) {
    case "date":
      return parseDate(t, opts?.dateOrder) ?? t;
    case "elapsed":
      return parseElapsed(t) ?? t;
    case "text":
    case "categorical":
      return t; // never coerce a label to a number
    default:
      // Number / untyped: the shared plain-decimal grammar. Raw `Number(t)` would turn a typed or
      // pasted "007" into 7 and "0x1A" into 26 — the exact tokens import keeps as text.
      return parseCellValue(t);
  }
}

/** Whether a cell is excluded (kept in the table but omitted from analyses/graphs). */
export function isCellExcluded(table: Pick<DataTable, "excluded">, rowId: NodeId, colId: NodeId): boolean {
  return table.excluded?.[rowId]?.includes(colId) ?? false;
}

/**
 * How many values in this table are currently excluded.
 *
 * Counted against the live rows and columns, not against the `excluded` map's own size:
 * the map is keyed by id, and a row or column deleted since can leave an entry behind
 * that no longer addresses a real cell. Counting those would report exclusions a reader
 * cannot find in the sheet.
 */
export function excludedCount(table: DataTable): number {
  if (!table.excluded) return 0;
  const cols = new Set(table.columns.map((c) => c.id));
  let n = 0;
  for (const row of table.rows)
    for (const colId of table.excluded[row.id] ?? []) if (cols.has(colId)) n += 1;
  return n;
}

/**
 * The table as a graph or an analysis must see it: every excluded cell read as `null`.
 *
 * Note: applied once at the entry to a consumer rather than at each cell read. The scene
 * builder alone reads `row.cells[...]` in many places across ~30 per-kind builders, none of
 * which go through `effectiveValue`. Masking the table up front covers all of them at once
 * and cannot be forgotten by a new builder.
 *
 * Returns the same object when nothing is excluded, so the common case allocates nothing.
 */
export function applyExclusions(table: DataTable): DataTable {
  if (!table.excluded || Object.keys(table.excluded).length === 0) return table;
  return {
    ...table,
    rows: table.rows.map((row) => {
      const cols = table.excluded?.[row.id];
      if (!cols?.length) return row;
      const cells = { ...row.cells };
      // Explicit null, not `delete`: a blank and an excluded value must read the same to
      // every consumer, and several read `cells[id] ?? null` while others read the key.
      for (const colId of cols) cells[colId] = null;
      return { ...row, cells };
    }),
  };
}

/** A cell's value as analyses/plots/derived tables should see it: `null` if excluded. */
export function effectiveValue(table: DataTable, row: Row, col: Column): CellValue {
  if (isCellExcluded(table, row.id, col.id)) return null;
  return row.cells[col.id] ?? null;
}

/**
 * Re-key an `excluded` map onto fresh row / column ids.
 *
 * `excluded` is addressed by both ids (row → the columns excluded in it), so anything
 * that mints new ids for a copy of a table — `duplicateTable` — must remap it. Copying
 * the map verbatim is worse than dropping it: it looks carried while excluding nothing,
 * because none of its keys match a cell that exists. An id missing from either map is
 * dropped rather than passed through: a stale key can only mis-address a real cell.
 */
export function remapExcluded(
  excluded: DataTable["excluded"],
  rowIds: ReadonlyMap<NodeId, NodeId>,
  colIds: ReadonlyMap<NodeId, NodeId>,
): DataTable["excluded"] {
  if (!excluded) return undefined;
  const out: Record<NodeId, NodeId[]> = {};
  for (const [rowId, cols] of Object.entries(excluded)) {
    const row = rowIds.get(rowId);
    if (!row) continue;
    const mapped = cols.map((c) => colIds.get(c)).filter((c): c is NodeId => !!c);
    if (mapped.length) out[row] = mapped;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Remap a `cellFills` map onto new row/column ids (Duplicate / relink), dropping any cell whose
 *  row or column is gone. Same shape + rules as `remapExcluded`, one level deeper (colId → colour). */
export function remapCellFills(
  cellFills: DataTable["cellFills"],
  rowIds: ReadonlyMap<NodeId, NodeId>,
  colIds: ReadonlyMap<NodeId, NodeId>,
): DataTable["cellFills"] {
  if (!cellFills) return undefined;
  const out: Record<NodeId, Record<NodeId, string>> = {};
  for (const [rowId, cols] of Object.entries(cellFills)) {
    const row = rowIds.get(rowId);
    if (!row) continue;
    const mapped: Record<NodeId, string> = {};
    for (const [colId, color] of Object.entries(cols)) {
      const col = colIds.get(colId);
      if (col) mapped[col] = color;
    }
    if (Object.keys(mapped).length) out[row] = mapped;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Remap a `cellPatterns` map onto new row/column ids (Duplicate / relink), dropping any cell
 *  whose row or column is gone. Same shape + rules as `remapCellFills`, one value deeper (the
 *  value is a `CellPattern` object, not a colour string). */
export function remapCellPatterns(
  cellPatterns: DataTable["cellPatterns"],
  rowIds: ReadonlyMap<NodeId, NodeId>,
  colIds: ReadonlyMap<NodeId, NodeId>,
): DataTable["cellPatterns"] {
  if (!cellPatterns) return undefined;
  const out: Record<NodeId, Record<NodeId, CellPattern>> = {};
  for (const [rowId, cols] of Object.entries(cellPatterns)) {
    const row = rowIds.get(rowId);
    if (!row) continue;
    const mapped: Record<NodeId, CellPattern> = {};
    for (const [colId, pattern] of Object.entries(cols)) {
      const col = colIds.get(colId);
      if (col) mapped[col] = pattern;
    }
    if (Object.keys(mapped).length) out[row] = mapped;
  }
  return Object.keys(out).length ? out : undefined;
}
