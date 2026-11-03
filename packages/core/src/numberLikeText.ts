import { isCellExcluded } from "./cells";
import type { DataTable, NodeId } from "./model";

/**
 * Text that a reader takes for a number but the program cannot use as one: a detection limit
 * ("<10", "≥ 5"), grouped digits it was not told to strip ("1,160,799", "1 000"), a decimal comma
 * in a point-decimal sheet ("1,5"), a trailing percent ("12 %"). Names such as "S1" or "GENE001",
 * ISO dates and ranges such as "12-15" do not match: they carry letters or an inner dash.
 */
const NUMBER_LIKE = /^(?:[<>≤≥~]=?\s*)?[+\-−]?\d[\d,.'\s]*(?:[eE][+\-−]?\d+)?\s*%?$/;

/** One number column holding number-like text cells. */
export interface NumberLikeText {
  columnId: NodeId;
  columnName: string;
  /** How many cells (not excluded) hold such text. */
  count: number;
  /** Up to three distinct values, as written. */
  examples: string[];
  /** How many distinct values there are in all. */
  distinct: number;
}

/**
 * The number columns of a table (all, or the given ones) that hold number-like text. Graphs and
 * analyses read a cell as a number only when `Number()` accepts it, so these cells are skipped
 * wherever the column is used; this is
 * what lets the program say so instead of dropping them silently. Columns typed text, category,
 * date or duration are left out: text there is expected. Excluded cells are left out too.
 */
export function numberLikeTextCells(table: DataTable, columnIds?: readonly NodeId[]): NumberLikeText[] {
  const wanted = columnIds ? new Set(columnIds) : null;
  const out: NumberLikeText[] = [];
  for (const col of table.columns) {
    if (wanted && !wanted.has(col.id)) continue;
    if (col.type && col.type !== "number") continue;
    let count = 0;
    const seen = new Set<string>();
    for (const row of table.rows) {
      const v = row.cells[col.id];
      if (typeof v !== "string") continue;
      const t = v.trim();
      // Text Number() reads ("1", "2.5") is used as a number by graphs and analyses alike.
      if (Number.isFinite(Number(t)) || !NUMBER_LIKE.test(t) || isCellExcluded(table, row.id, col.id)) continue;
      count++;
      seen.add(t);
    }
    if (count > 0) out.push({ columnId: col.id, columnName: col.name, count, examples: [...seen].slice(0, 3), distinct: seen.size });
  }
  return out;
}

/** The plain-language notice for one such column. */
export function numberLikeTextWarning(e: NumberLikeText): string {
  const shown = e.examples.map((x) => `"${x}"`).join(", ");
  const more = e.distinct > e.examples.length ? ", …" : "";
  return `"${e.columnName}" has ${e.count} cell${e.count === 1 ? "" : "s"} written as text (${shown}${more}), so graphs and analyses skip ${e.count === 1 ? "it" : "them"}. Enter ${e.count === 1 ? "it" : "them"} as a number, or exclude ${e.count === 1 ? "it" : "them"}.`;
}
