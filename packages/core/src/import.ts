/**
 * Data import: turn external tabular files into the document
 * model. DOM-free + pure so it is fully unit-testable and shared by every import
 * path. Delimited text is parsed here; Excel arrives as an already-typed grid
 * (decoded by the main process) and flows through the same `coerceGrid` step.
 *
 * Two stages so the import modal can preview/re-parse cheaply:
 *   1. `parseDelimited` (RFC-4180) → a raw `string[][]` grid.
 *   2. `coerceGrid` → column names + type-inferred `CellValue` rows.
 */
import type { CellValue, ColumnType } from "./model";
import { dateToDays, DECIMAL_NUMBER, isValidCalendarDate, parseCellValue, parseDate, parseElapsed } from "./cells";

/** Delimiters we auto-detect / offer. Comma first (tie-break + default). */
export const DELIMITERS = [",", "\t", ";", "|"] as const;
export type Delimiter = (typeof DELIMITERS)[number];

// `parseCellValue` + the number grammar live in cells.ts (the lower layer, so the grid's
// typed-entry path can share them without an import cycle); re-exported here as part of
// `@mady/core`'s public API.
export { parseCellValue } from "./cells";

/** True when a raw token looks like a number (non-blank) — for header inference. Uses the
 *  same plain-decimal grammar as parseCellValue (so "0x1A" is not numeric) but, unlike cell
 *  typing, a zero-padded "007" still reads as numeric-looking here: it distinguishes a data
 *  row from a text header even though it's stored as a text id. */
function isNumeric(token: string): boolean {
  const t = token.trim();
  return t !== "" && DECIMAL_NUMBER.test(t) && Number.isFinite(Number(t));
}

/**
 * Heuristic: does this grid use a decimal comma (European "3,14")? True when cells with a
 * digit-comma-digit shape outnumber plain digit-dot-digit ones. Self-guarding: when comma
 * is the field delimiter, `parseDelimited` has already split "3,14" into "3"/"14", so no
 * comma-decimal cells survive and this returns false. Used for the import Auto option.
 */
export function detectDecimalComma(grid: ReadonlyArray<ReadonlyArray<CellValue>>): boolean {
  let commaNum = 0;
  let dotNum = 0;
  for (const row of grid) {
    for (const cell of row) {
      if (typeof cell !== "string") continue;
      const t = cell.trim();
      if (/^[+-]?\d+,\d+$/.test(t)) commaNum++;
      else if (/^[+-]?\d+\.\d+$/.test(t)) dotNum++;
    }
  }
  return commaNum > 0 && commaNum >= dotNum;
}

/** Strip a leading UTF-8 BOM if present (common in Excel-exported CSV). */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Count delimiters outside quotes on a single line (for delimiter detection). */
function countDelimiter(line: string, delimiter: string): number {
  let count = 0;
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        i++; // escaped quote
        continue;
      }
      inQuotes = !inQuotes;
    } else if (ch === delimiter && !inQuotes) {
      count++;
    }
  }
  return count;
}

/** Up to `cap` lines spread evenly across the file (always incl. the first + last),
 *  so delimiter detection sees the whole file — not just a head window that can miss a
 *  delimiter which only disambiguates further down. */
function sampleLines(lines: string[], cap: number): string[] {
  if (lines.length <= cap) return lines;
  const step = (lines.length - 1) / (cap - 1);
  const out: string[] = [];
  for (let i = 0; i < cap; i++) out.push(lines[Math.round(i * step)]!);
  return out;
}

/**
 * Guess the delimiter by scoring candidates over a sample of lines: prefer the one
 * that appears the most, consistently (same field count on every line). A
 * candidate that never appears is skipped; ties fall back to `DELIMITERS` order
 * (so plain CSV wins). The import modal lets the user override.
 */
export function detectDelimiter(text: string): Delimiter {
  const lines = sampleLines(
    stripBom(text).split(/\r\n?|\n/).filter((l) => l.trim() !== ""),
    60,
  );
  if (lines.length === 0) return ",";
  let best: Delimiter = ",";
  let bestScore = -Infinity;
  for (const delimiter of DELIMITERS) {
    const counts = lines.map((l) => countDelimiter(l, delimiter));
    if (counts.every((c) => c === 0)) continue; // never appears
    const max = Math.max(...counts);
    const consistent = counts.every((c) => c === counts[0]);
    const score = max + (consistent ? 5 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = delimiter;
    }
  }
  return best;
}

/**
 * Parse delimited text into a grid of raw string cells (no type inference).
 * RFC-4180: fields may be wrapped in `"`; an embedded delimiter or newline is
 * allowed inside quotes; a literal quote is escaped as `""`. Normalizes CRLF and
 * lone CR, strips a UTF-8 BOM, pads ragged rows to the widest row, and drops a
 * single trailing blank line. When `delimiter` is omitted it is auto-detected.
 */
/** Quote-aware tokenizer — the shared core of `parseDelimited` and `rowWidths`. Returns rows
 *  of fields without padding (so callers can see each row's true field count). `src` must be
 *  BOM-stripped and `delim` resolved already. */
function tokenizeDelimited(src: string, delim: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  const pushField = (): void => {
    row.push(field);
    field = "";
  };
  const pushRow = (): void => {
    pushField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === "") {
      // A quote opens a quoted field only at the start of a field (RFC-4180 §2.5).
      // A quote mid-field — an inch mark (5" long), a foot/inch (6'2"), a stray " —
      // is a literal character, not the start of a quoted region. Treating it as an
      // opener would silently swallow the rest of the file into one field.
      inQuotes = true;
    } else if (ch === delim) {
      pushField();
    } else if (ch === "\n") {
      pushRow();
    } else if (ch === "\r") {
      pushRow();
      if (src[i + 1] === "\n") i++; // CRLF
    } else {
      field += ch;
    }
  }
  // Flush the final field/row unless the input ended exactly on a line break.
  if (field !== "" || row.length > 0) pushRow();
  return rows;
}

export function parseDelimited(text: string, delimiter?: Delimiter): string[][] {
  const src = stripBom(text);
  const delim = delimiter ?? detectDelimiter(src);
  const rows = tokenizeDelimited(src, delim);
  const width = rows.reduce((max, r) => Math.max(max, r.length), 0);
  for (const r of rows) while (r.length < width) r.push("");
  return rows;
}

/**
 * Field count of each parsed row, unpadded — for a ragged-file warning. `parseDelimited` pads
 * every row to the widest, so any row whose width here is below the max was silently padded
 * (a likely misaligned line). Same quote-aware tokenizer, so the counts match the real parse.
 */
export function rowWidths(text: string, delimiter?: Delimiter): number[] {
  const src = stripBom(text);
  const delim = delimiter ?? detectDelimiter(src);
  return tokenizeDelimited(src, delim).map((r) => r.length);
}

/** Flatten one parsed-JSON value to a primitive cell (mirrors the Excel decoder's rules): a
 *  nested object/array is JSON-stringified so it round-trips as visible text rather than
 *  "[object Object]". */
function jsonCell(v: unknown): CellValue {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

/** Parse JSON, returning `undefined` (never throwing) when the text is not valid JSON. */
function tryJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Parse JSON or NDJSON data into a grid of already-typed cells (like the Excel path — cells are
 * not re-inferred). Three shapes are recognised:
 *   • an array of objects → the union of keys (first-seen order) becomes the header row, each
 *     object a data row (a missing key is a blank cell);
 *   • an array of arrays → used as rows directly (no synthetic header — the caller's header
 *     inference decides whether row 0 is names);
 *   • an array of scalars, or a single object/scalar → a one-column "value" table (an object
 *     is wrapped as one record).
 * NDJSON (one JSON value per line) is detected when the whole text isn't valid JSON but every
 * non-blank line is. Returns `[]` when the text is not JSON at all.
 */
export function jsonToGrid(text: string): CellValue[][] {
  const trimmed = stripBom(text).trim();
  if (!trimmed) return [];
  let records: unknown[];
  const whole = tryJson(trimmed);
  if (whole !== undefined) {
    records = Array.isArray(whole) ? whole : [whole];
  } else {
    const lines = trimmed.split(/\r\n?|\n/).map((l) => l.trim()).filter((l) => l !== "");
    records = [];
    for (const l of lines) {
      const v = tryJson(l);
      if (v === undefined) return []; // not JSON (nor NDJSON)
      records.push(v);
    }
  }
  if (records.length === 0) return [];
  // Array of arrays → rows as-is.
  if (records.every((r) => Array.isArray(r))) {
    return (records as unknown[][]).map((row) => row.map(jsonCell));
  }
  // Object records → union of keys as the header.
  const keys: string[] = [];
  const seen = new Set<string>();
  const isPlainObject = (r: unknown): r is Record<string, unknown> =>
    r != null && typeof r === "object" && !Array.isArray(r);
  for (const r of records) if (isPlainObject(r)) for (const k of Object.keys(r)) if (!seen.has(k)) { seen.add(k); keys.push(k); }
  if (keys.length === 0) {
    // Array of scalars → a single "value" column.
    return [["value"], ...records.map((r) => [jsonCell(r)])];
  }
  const rows = records.map((r) => {
    const obj = isPlainObject(r) ? r : {};
    return keys.map((k) => jsonCell(obj[k]));
  });
  return [keys as CellValue[], ...rows];
}

/** A1 column letters → 0-based index ("A"→0, "Z"→25, "AA"→26). */
function colLettersToIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * Parse an A1-style spreadsheet range ("A1:D50", "B2:D" = to last column, "A1" = one cell) into
 * inclusive 0-based bounds, clamped to a `rows`×`cols` grid. An open end (missing column/row)
 * extends to the grid edge. Returns null for unparseable input or a range whose start is past
 * the grid — the caller then imports the whole sheet.
 */
export function parseA1Range(
  spec: string,
  rows: number,
  cols: number,
): { r0: number; c0: number; r1: number; c1: number } | null {
  const s = spec.trim().toUpperCase();
  if (!s) return null;
  const m = s.match(/^([A-Z]+)(\d+)?(?::([A-Z]*)(\d*))?$/);
  if (!m) return null;
  const c0 = colLettersToIndex(m[1]!);
  const r0 = m[2] ? parseInt(m[2], 10) - 1 : 0;
  const colon = s.includes(":");
  const c1 = colon ? (m[3] ? colLettersToIndex(m[3]) : cols - 1) : c0;
  const r1 = colon ? (m[4] ? parseInt(m[4], 10) - 1 : rows - 1) : r0;
  const R0 = Math.min(r0, r1);
  const R1 = Math.max(r0, r1);
  const C0 = Math.min(c0, c1);
  const C1 = Math.max(c0, c1);
  if (R0 < 0 || C0 < 0 || R0 >= rows || C0 >= cols) return null; // starts past the data
  return { r0: R0, c0: C0, r1: Math.min(R1, rows - 1), c1: Math.min(C1, cols - 1) };
}

/**
 * Parse whitespace-delimited text — the layout instruments and many scientific tools emit,
 * where columns are aligned with runs of spaces/tabs rather than a single separator char.
 * Each non-empty line is trimmed and split on `\s+` (so any run of spaces/tabs is one break);
 * ragged rows are padded to the widest. Unquoted by design — this format does not quote, and
 * a value with an internal space would be a genuine ambiguity the char parser handles instead.
 */
export function parseWhitespace(text: string): string[][] {
  const lines = stripBom(text)
    .split(/\r\n?|\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "");
  const rows = lines.map((l) => l.split(/\s+/));
  const width = rows.reduce((max, r) => Math.max(max, r.length), 0);
  for (const r of rows) while (r.length < width) r.push("");
  return rows;
}

/**
 * Drop whole physical lines that start (after optional leading whitespace) with a comment
 * marker — the `#`-prefixed notes many scientific exporters and instrument logs put above or
 * between data rows (matches numpy/R `comment.char`). Line-based on the raw text (before the
 * delimiter parse) so a comment line carrying delimiters is removed whole rather than parsed
 * into stray columns. `marker` may be multi-char ("//"); empty/undefined = strip nothing.
 * Note: deliberately matched at line start only: a `#` mid-field is data, and a comment line
 * embedded inside a quoted multi-line field is a rare collision that is not detected (same as
 * numpy/R).
 */
export function stripCommentLines(text: string, marker?: string): string {
  if (!marker) return text;
  return stripBom(text)
    .split(/\r\n?|\n/)
    .filter((line) => !line.trimStart().startsWith(marker))
    .join("\n");
}

/**
 * Heuristic: treat row 0 as a header when it is entirely non-numeric text and at
 * least one later row carries a number (so the body reads as data). An all-text
 * or all-numeric grid → no header. The modal lets the user override.
 */
export function inferHeader(grid: ReadonlyArray<ReadonlyArray<string>>, opts?: { decimal?: "." | "," }): boolean {
  if (grid.length < 2) return false;
  const first = grid[0]!;
  if (first.length === 0) return false;
  // Under a decimal comma, "1,5" is a number (so the header check must see it as one).
  const numeric = (c: string): boolean => isNumeric(opts?.decimal === "," ? c.replace(",", ".") : c);
  // Note: blank cells in the header row are normal, not disqualifying. A matrix copied out of a
  // spreadsheet has an empty top-left corner — the row-label column has no title — and
  // requiring every cell to be non-empty would turn "Gene / Ctrl / Drug A" into data because
  // of that one blank corner, leaving the columns named A, B, C. It is the commonest shape
  // there is, and the header would be silently lost every time.
  const filled = first.filter((c) => c.trim() !== "");
  const firstAllText = filled.length > 0 && filled.every((c) => !numeric(c));
  if (!firstAllText) return false;
  return grid.slice(1).some((r) => r.some((c) => numeric(c)));
}

/**
 * Fold a units row into the header (scientific tables where row 0 is the variable name and row 1
 * the unit — "Time" / "s", "Conc" / "µM"). Returns a grid whose row 0 is `Name (unit)` for each
 * column with a non-empty unit (bare name otherwise) and whose second row is removed, so the
 * downstream `coerceGrid(header:true)` sees the combined names and the unit row is not data.
 * A no-op unless `unitRows >= 1` and there are at least two rows. Only the first extra row is
 * folded (a single units row); pass 0 to disable.
 */
export function foldUnitRow(grid: ReadonlyArray<ReadonlyArray<CellValue>>, unitRows: number): CellValue[][] {
  if (unitRows < 1 || grid.length < 2) return grid.map((r) => [...r]);
  const names = grid[0]!;
  const units = grid[1]!;
  const width = Math.max(names.length, units.length);
  const combined: CellValue[] = Array.from({ length: width }, (_, c) => {
    const name = names[c] == null ? "" : String(names[c]).trim();
    const unit = units[c] == null ? "" : String(units[c]).trim();
    return unit ? (name ? `${name} (${unit})` : unit) : name;
  });
  return [combined, ...grid.slice(2).map((r) => [...r])];
}

/**
 * Transpose a grid (rows ↔ columns) so the import dialog can fix data pasted or
 * saved the wrong way round — variables in rows instead of columns
 * ("paste(+transpose)"). Ragged rows are padded to the widest row with
 * `fill` so the result is rectangular: `width × height` becomes `height × width`
 * where width is the widest source row. Pure + grid-typed, so it serves both
 * string grids (delimited text → `fill: ""`) and typed grids (Excel → `fill:
 * null`); the datasheet's transposed paste uses it too.
 */
export function transposeGrid<T>(grid: ReadonlyArray<ReadonlyArray<T>>, fill: T): T[][] {
  const width = grid.reduce((max, r) => Math.max(max, r.length), 0);
  return Array.from({ length: width }, (_, c) =>
    grid.map((r) => (c < r.length ? r[c]! : fill)),
  );
}

export interface CoerceOptions {
  /** Treat the first grid row as column names. */
  header: boolean;
  /**
   * Infer cell types from strings (delimited text). `false` = cells are already
   * typed (Excel) and only blank-strings collapse to null. Default `true`.
   */
  infer?: boolean | undefined;
  /** Decimal mark for numeric cells: "." (default) or "," (European). */
  decimal?: "." | "," | undefined;
  /**
   * Recognise columns whose every value is a full-ISO date (as Excel emits) and return
   * them as `date` columns with day-serial storage. Used by the Excel import path so a
   * date column arrives usable as a time axis instead of unparsed ISO strings.
   */
  detectDates?: boolean | undefined;
  /**
   * Body tokens to treat as missing (→ null) before typing — e.g. ["NA","N/A","null"].
   * Matched case-insensitively against the trimmed cell. Applies to data cells only, never
   * the header. Empty/undefined = only blank strings collapse.
   */
  naTokens?: readonly string[] | undefined;
  /**
   * A thousands/grouping separator to strip from numeric cells before parsing — "," (US
   * 1,000,000), " " (1 000 000), or "." (European 1.234,56, paired with a comma decimal).
   * Only applied when stripping it yields a valid number, so a genuine text value keeps its
   * separators. Must differ from the column delimiter (the delimiter splits first).
   */
  thousands?: string | undefined;
}

export interface CoercedTable {
  columnNames: string[];
  rows: CellValue[][];
  /** Per-column type detected during coercion (auto-detected dates and durations).
   *  Sparse/omitted when nothing was detected. */
  columnTypes?: (ColumnType | undefined)[] | undefined;
}

/** The exact shape `Date.toISOString()` produces — what the Excel decoder emits for a date
 *  cell. Kept strict (`T…Z`) so it's recognised alongside the human date formats below. */
const EXCEL_ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
/** ISO calendar date a human types: `YYYY-MM-DD` or `YYYY/M/D`. */
const ISO_DATE = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/;
/** Slash/dash date with a 4-digit year: `M/D/YYYY` (US) or `D/M/YYYY` (Euro). The
 *  4-digit-year anchor is what keeps a ratio like "1/2" from looking like a date. */
const SLASH_DATE = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/;
/** A duration/elapsed value: `h:mm:ss` or `m:ss` (at least one colon, so a plain number
 *  — already coerced to a number, not a string — never reaches here). */
const CLOCK_TIME = /^-?\d{1,3}:[0-5]?\d(?::[0-5]?\d)?$/;

/** Days-since-epoch for one date string in a column whose slash order (`dayFirst`) is known,
 *  or null when the text is not a valid date. Ranges are checked so "12-34-5678" is rejected. */
function dateStringToDays(text: string, dayFirst: boolean): number | null {
  // A real calendar date, not just `1..31`, so "2020-02-30" is rejected instead of rolling over to Mar 1.
  const validDays = (y: number, mo: number, day: number): number | null =>
    isValidCalendarDate(y, mo, day) ? dateToDays(y, mo, day) : null;
  const iso = ISO_DATE.exec(text);
  if (iso) return validDays(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const s = SLASH_DATE.exec(text);
  if (s) {
    const [mo, day] = dayFirst ? [Number(s[2]), Number(s[1])] : [Number(s[1]), Number(s[2])];
    return validDays(Number(s[3]), mo, day);
  }
  if (EXCEL_ISO_DATE.test(text)) return parseDate(text);
  return null;
}

/**
 * Detect a **date** column and return its cells as day-serials, or null if any non-null cell
 * is not a date in one of the supported formats. Slash/dash order (M/D vs D/M) is inferred
 * from any cell whose first field is > 12 (⇒ day-first); an all-ambiguous column defaults to
 * US month-first, matching `Date.parse`. Requiring *every* cell to be date-shaped is what
 * keeps a text column with one stray value from being retyped.
 */
function detectDateColumn(cells: readonly CellValue[]): { type: ColumnType; values: CellValue[] } | null {
  let any = false;
  for (const v of cells) {
    if (v == null) continue;
    if (typeof v !== "string" || (!ISO_DATE.test(v) && !SLASH_DATE.test(v) && !EXCEL_ISO_DATE.test(v))) return null;
    any = true;
  }
  if (!any) return null;
  let dayFirst = false;
  for (const v of cells) {
    if (typeof v !== "string") continue;
    const s = SLASH_DATE.exec(v);
    if (s && Number(s[1]) > 12) { dayFirst = true; break; }
  }
  const values: CellValue[] = [];
  for (const v of cells) {
    if (v == null) { values.push(null); continue; }
    const days = dateStringToDays(v as string, dayFirst);
    if (days == null) return null; // shaped like a date but out of range ⇒ not a date column
    values.push(days);
  }
  return { type: "date", values };
}

/** Detect an **elapsed/duration** column (`h:mm:ss` / `m:ss`) and return seconds, or null. */
function detectElapsedColumn(cells: readonly CellValue[]): { type: ColumnType; values: CellValue[] } | null {
  let any = false;
  for (const v of cells) {
    if (v == null) continue;
    if (typeof v !== "string" || !CLOCK_TIME.test(v)) return null;
    any = true;
  }
  if (!any) return null;
  const values: CellValue[] = [];
  for (const v of cells) {
    if (v == null) { values.push(null); continue; }
    const secs = parseElapsed(v as string);
    if (secs == null) return null;
    values.push(secs);
  }
  return { type: "elapsed", values };
}

/** Coerce one cell, optionally inferring number-vs-string from a raw string. */
function coerceCell(
  value: CellValue | undefined,
  infer: boolean,
  decimal?: "." | ",",
  naSet?: ReadonlySet<string>,
  thousands?: string,
): CellValue {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (naSet && naSet.size && naSet.has(value.trim().toLowerCase())) return null; // configured missing marker
  if (infer && thousands) {
    // Strip the grouping separator, but only keep that if the result is actually a number —
    // otherwise a text value like "a, b" would lose its punctuation.
    const stripped = value.split(thousands).join("");
    const n = parseCellValue(stripped, decimal ? { decimal } : undefined);
    if (typeof n === "number") return n;
  }
  return infer ? parseCellValue(value, decimal ? { decimal } : undefined) : value.trim() === "" ? null : value;
}

/** Default name for a column with no header text. */
function defaultColumnName(index: number): string {
  return `Column ${index + 1}`;
}

/** Make column names unique + non-empty: "x","x" → "x","x (2)". The generated
 *  candidate is checked against every name already emitted, so a suffix that
 *  happens to collide with a later literal (["x","x","x (2)"]) keeps bumping
 *  instead of producing a second "x (2)". */
function dedupeNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  const used = new Set<string>();
  return names.map((name) => {
    let count = (seen.get(name) ?? 0) + 1;
    let candidate = count === 1 ? name : `${name} (${count})`;
    while (used.has(candidate)) candidate = `${name} (${++count})`;
    seen.set(name, count);
    used.add(candidate);
    return candidate;
  });
}

/**
 * Turn a raw grid (string cells from delimited text, or already-typed cells from
 * Excel) into column names + typed rows. With `header`, row 0 supplies names
 * (blank → "Column N", duplicates de-duplicated); otherwise all names default.
 * Width is the widest row across header + body.
 */
export function coerceGrid(
  grid: ReadonlyArray<ReadonlyArray<CellValue>>,
  opts: CoerceOptions,
): CoercedTable {
  const infer = opts.infer ?? true;
  const width = grid.reduce((max, r) => Math.max(max, r.length), 0);
  const headerRow = opts.header ? grid[0] : undefined;
  const bodyRows = opts.header ? grid.slice(1) : grid;

  const columnNames = dedupeNames(
    Array.from({ length: width }, (_, c) => {
      const raw = headerRow?.[c];
      const name = raw == null ? "" : String(raw).trim();
      return name === "" ? defaultColumnName(c) : name;
    }),
  );
  const naSet = opts.naTokens && opts.naTokens.length
    ? new Set(opts.naTokens.map((t) => t.trim().toLowerCase()).filter((t) => t !== ""))
    : undefined;
  const rows = bodyRows.map((r) =>
    Array.from({ length: width }, (_, c) => coerceCell(r[c], infer, opts.decimal, naSet, opts.thousands)),
  );
  if (!opts.detectDates) return { columnNames, rows };

  // A column whose every non-null cell is a recognised date/duration string → a real typed
  // column (day-serials / seconds) so it's immediately usable as a time axis, instead of
  // unparsed strings the date type can't read. Dates: ISO, Excel timestamps, and slash/dash
  // M/D/YYYY or D/M/YYYY; durations: h:mm:ss. Detection is default-deny — every non-null cell
  // must match, so a text column with one stray value is left alone.
  const columnTypes: (ColumnType | undefined)[] = new Array(width).fill(undefined);
  for (let c = 0; c < width; c++) {
    const cells = rows.map((r) => r[c] ?? null);
    const detected = detectDateColumn(cells) ?? detectElapsedColumn(cells);
    if (detected) {
      columnTypes[c] = detected.type;
      rows.forEach((r, i) => { r[c] = detected.values[i]!; });
    }
  }
  return columnTypes.some((t) => t != null) ? { columnNames, rows, columnTypes } : { columnNames, rows };
}

/**
 * Re-parse the text of a linked source file into a table grid, replaying the import
 * options captured in a `LinkedSource` (delimiter + transpose + header). Pure — the
 * same composition the ImportDialog uses (`parseDelimited` → skip preamble rows →
 * optional transpose → header → `coerceGrid`), so a linked re-read reproduces the
 * original import shape. The header is re-inferred when it wasn't pinned. An
 * unrecognised delimiter falls back to auto-detection.
 */
export function parseLinkedText(
  text: string,
  opts: { delimiter?: string | undefined; transpose?: boolean | undefined; skipRows?: number | undefined; header?: boolean | undefined; decimal?: "." | "," | undefined; naTokens?: readonly string[] | undefined; thousands?: string | undefined; comment?: string | undefined; unitRows?: number | undefined },
): CoercedTable {
  // Drop comment lines first (they may carry delimiters that would otherwise parse into columns),
  // mirroring the ImportDialog order so a linked re-read reproduces the original shape.
  const cleaned = stripCommentLines(text, opts.comment);
  const delimiter = (DELIMITERS as readonly string[]).includes(opts.delimiter ?? "")
    ? (opts.delimiter as Delimiter)
    : undefined;
  let raw: CellValue[][] =
    opts.delimiter === "whitespace" ? parseWhitespace(cleaned) : parseDelimited(cleaned, delimiter);
  // A stored delimiter that no longer matches the file (a collaborator re-exports CSV as
  // TSV) collapses the whole table into one text column. If auto-detection recovers more
  // columns, prefer it rather than silently deleting every column.
  if (delimiter && raw.length > 0 && (raw[0]?.length ?? 0) <= 1) {
    const auto = parseDelimited(cleaned, undefined);
    if ((auto[0]?.length ?? 0) > 1) raw = auto;
  }
  // Drop preamble rows (metadata/notes above the table) before transpose — same order the
  // ImportDialog applies, so a linked re-read reproduces the original shape.
  if (opts.skipRows && opts.skipRows > 0) raw = raw.slice(opts.skipRows);
  let grid: CellValue[][] = opts.transpose ? transposeGrid<CellValue>(raw, "") : raw;
  // Fold a stored units row into the header (forces header on — units imply a header).
  const unitRows = opts.unitRows && opts.unitRows > 0 ? opts.unitRows : 0;
  if (unitRows) grid = foldUnitRow(grid, unitRows);
  // Replay the stored decimal mark, or re-detect it (a linked file may switch conventions).
  const decimal = opts.decimal ?? (detectDecimalComma(grid) ? "," : undefined);
  // Header inference must know the decimal mark, else "1,5" doesn't read as a number.
  const header = unitRows ? true : opts.header ?? inferHeader(grid.map((r) => r.map((c) => (c == null ? "" : String(c)))), decimal ? { decimal } : undefined);
  // detectDates so a linked file's date/duration columns re-read with the same types the
  // first import gave them — else a refresh would drop day-serials back to raw strings.
  return coerceGrid(grid, { header, infer: true, decimal, detectDates: true, naTokens: opts.naTokens, thousands: opts.thousands });
}
