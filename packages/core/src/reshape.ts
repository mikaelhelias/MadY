/**
 * Wide ↔ long reshape (a data transform) — the
 * tidy-data melt/pivot pair, pure + DOM-free so the reshape dialog previews
 * cheaply and the result flows straight into `importTable`.
 *
 * Both operate on the same `{ columnNames, rows }` shape the import pipeline
 * produces (`CoercedTable`), and return the same shape, so a reshape is just
 * another way to make a new dataset.
 */
import type { CellValue } from "./model";

/** A column-named grid — the shared currency of import + reshape. */
export interface NamedTable {
  columnNames: string[];
  rows: CellValue[][];
}

export interface WideToLongOptions {
  /** Indices of columns kept verbatim on every emitted row (identifiers). */
  idColumns: readonly number[];
  /** Indices of the columns to unpivot into (key, value) pairs. */
  valueColumns: readonly number[];
  /** Name of the new column holding the former column *names*. Default "variable". */
  keyName?: string;
  /** Name of the new column holding the former *cell values*. Default "value". */
  valueName?: string;
  /** Skip emitting a (key, value) row when the value is null/blank. Default false. */
  dropEmpty?: boolean;
}

/** Blank when null or an all-whitespace string (so `dropEmpty` matches both). */
function isBlank(value: CellValue): boolean {
  return value == null || (typeof value === "string" && value.trim() === "");
}

/**
 * Wide → long (melt / gather): for each input row, emit one row per value column
 * — `[...idValues, columnName, cellValue]`. Turns `dose, drugA, drugB` into the
 * tidy `dose, variable, value` so repeated-measures / grouped layouts and most
 * stats expect. `idColumns` repeat on every emitted row; `valueColumns` are
 * consumed. With `dropEmpty`, blank cells produce no row (ragged wide data → a
 * clean long table).
 */
export function wideToLong(table: NamedTable, opts: WideToLongOptions): NamedTable {
  const keyName = opts.keyName ?? "variable";
  const valueName = opts.valueName ?? "value";
  const idNames = opts.idColumns.map((c) => table.columnNames[c] ?? `Column ${c + 1}`);
  const columnNames = [...idNames, keyName, valueName];

  const rows: CellValue[][] = [];
  for (const row of table.rows) {
    const idValues = opts.idColumns.map((c) => row[c] ?? null);
    for (const c of opts.valueColumns) {
      const value = row[c] ?? null;
      if (opts.dropEmpty && isBlank(value)) continue;
      rows.push([...idValues, table.columnNames[c] ?? `Column ${c + 1}`, value]);
    }
  }
  return { columnNames, rows };
}

export interface LongToWideOptions {
  /** Indices of the columns that identify a result row (the row key). */
  idColumns: readonly number[];
  /** Index of the column whose distinct values become new column headers. */
  keyColumn: number;
  /** Index of the column supplying the spread cell values. */
  valueColumn: number;
}

/** Stable key for an id-value tuple (cells can be number/string/null). */
function tupleKey(values: readonly CellValue[]): string {
  return JSON.stringify(values);
}

/**
 * Long → wide (pivot / spread): the inverse of {@link wideToLong}. Distinct
 * values of `keyColumn` (first-appearance order) become new columns; each result
 * row gathers the `valueColumn` cells for one id-tuple. Missing id×key
 * combinations are left null; a duplicate id×key keeps the **last** value (no
 * aggregation — documented, so the caller can pre-aggregate if needed). A null
 * key produces no column (can't name one).
 */
export function longToWide(table: NamedTable, opts: LongToWideOptions): NamedTable {
  const idNames = opts.idColumns.map((c) => table.columnNames[c] ?? `Column ${c + 1}`);

  // Distinct key headers in first-appearance order.
  const keyOrder: string[] = [];
  const keySeen = new Set<string>();
  // One bucket per id-tuple, in first-appearance order; bucket maps key → value.
  const order: string[] = [];
  const buckets = new Map<string, { idValues: CellValue[]; values: Map<string, CellValue> }>();

  for (const row of table.rows) {
    const rawKey = row[opts.keyColumn] ?? null;
    if (rawKey == null) continue; // can't make a column with no name
    const key = String(rawKey);
    if (!keySeen.has(key)) {
      keySeen.add(key);
      keyOrder.push(key);
    }
    const idValues = opts.idColumns.map((c) => row[c] ?? null);
    const tk = tupleKey(idValues);
    let bucket = buckets.get(tk);
    if (!bucket) {
      bucket = { idValues, values: new Map() };
      buckets.set(tk, bucket);
      order.push(tk);
    }
    bucket.values.set(key, row[opts.valueColumn] ?? null); // last write wins
  }

  const columnNames = [...idNames, ...keyOrder];
  const rows = order.map((tk) => {
    const bucket = buckets.get(tk)!;
    return [...bucket.idValues, ...keyOrder.map((k) => bucket.values.get(k) ?? null)];
  });
  return { columnNames, rows };
}
