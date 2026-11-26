/**
 * Group-by-row-category — comparing groups that live in rows.
 *
 * A tidy/long sheet states its groups as categories in a label column with a single
 * value dataset beside it:
 *
 *     Group   | Mean | Rep 2 | Rep 3
 *     Control |  12  |  15   |   9
 *     Drug A  |  28  |  32   |  24
 *
 * That is the right shape for a bar chart — bars take their categories from rows —
 * but the group-comparison tests read groups from columns (`tableDatasets`), so such
 * a sheet exposes exactly one dataset and every two-group picker dead-ends on it.
 *
 * A row group is addressed by a virtual dataset id (`rowgrp:<labelColumn>:<level>`).
 * `datasetValues` / `datasetName` resolve those ids, so the whole
 * spec → `buildAnalysisData` → engine path keeps working with no extra plumbing:
 * a row group is just another thing an id can point at.
 */
import type { DataTable, NodeId } from "./model";
import { tableDatasets, xColumn } from "./dataset";
import { numericCell } from "./numeric";

const PREFIX = "rowgrp:";

/**
 * Sheet kinds whose row categories are independent measured groups, so comparing
 * them is a sensible thing to propose. Everything else is excluded deliberately:
 * `partsofwhole` states shares of a total (a one-way ANOVA across the regions of a
 * GDP-by-state treemap would be meaningless and would displace the descriptive
 * summary it should show), and `contingency` / `survival` / `multivariable` / `nested`
 * each carry their own dedicated analysis — chi-square, Kaplan-Meier, and so on.
 * `xy` stays in so a tidy CSV that lands as XY with a text label column still works;
 * the categorical-label guard below is what keeps a continuous X out.
 */
const GROUPABLE_KINDS = new Set(["column", "grouped", "xy"]);

/** The virtual dataset id for "rows whose `labelColumnId` cell equals `level`". */
export function rowGroupId(labelColumnId: NodeId, level: string): NodeId {
  return `${PREFIX}${labelColumnId}:${level}`;
}

/** Whether an id addresses a row group rather than a real column. */
export function isRowGroupId(id: NodeId | undefined): boolean {
  return typeof id === "string" && id.startsWith(PREFIX);
}

/**
 * Split a row-group id back into its label column + level. Only the first colon after
 * the prefix is a separator, so a level may itself contain colons ("Drug A: 10mg").
 */
export function parseRowGroupId(id: NodeId | undefined): { labelColumnId: NodeId; level: string } | null {
  if (!isRowGroupId(id)) return null;
  const rest = (id as string).slice(PREFIX.length);
  const cut = rest.indexOf(":");
  if (cut < 0) return null;
  return { labelColumnId: rest.slice(0, cut), level: rest.slice(cut + 1) };
}

/** Distinct non-blank categories of a label column, in first-seen row order. */
export function rowGroupLevels(table: DataTable, labelColumnId: NodeId): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of table.rows ?? []) {
    const raw = row.cells[labelColumnId];
    if (raw == null) continue;
    const level = String(raw).trim();
    if (level === "" || seen.has(level)) continue;
    seen.add(level);
    out.push(level);
  }
  return out;
}

/**
 * The columns a row group draws its numbers from: every dataset column (lead +
 * replicate subcolumns), minus the label column itself. For the canonical one-dataset
 * sheet this is exactly that dataset's replicates.
 */
function valueColumns(table: DataTable, labelColumnId: NodeId): NodeId[] {
  return tableDatasets(table)
    .flatMap((d) => d.replicates)
    .filter((id) => id !== labelColumnId);
}

/** Every finite value of one category, pooled across its rows and replicate columns. */
export function rowGroupValues(table: DataTable, labelColumnId: NodeId, level: string): number[] {
  const cols = valueColumns(table, labelColumnId);
  const out: number[] = [];
  for (const row of table.rows ?? []) {
    const raw = row.cells[labelColumnId];
    if (raw == null || String(raw).trim() !== level) continue;
    for (const colId of cols) {
      const v = numericCell(row.cells[colId]);
      if (v !== null) out.push(v);
    }
  }
  return out;
}

/** The label column a sheet would group by (its leading X/label column). */
export function rowGroupColumn(table: DataTable): NodeId | undefined {
  if (!table.columns?.length) return undefined;
  return xColumn(table)?.id ?? table.columns[0]?.id;
}

/**
 * Whether offering row-category groups makes sense for this sheet. Three guards, each
 * paid for by a way this could go wrong:
 *  - only when the sheet does not already compare by column (≥2 datasets means the
 *    ordinary column groups are the right answer and row groups would be ambiguous —
 *    which dataset's numbers would a row group even take?);
 *  - only when the label column is categorical, never numeric: a numeric X is a
 *    continuous axis, and grouping an ordinary dose-response sheet would invent one
 *    group per dose;
 *  - only with ≥2 categories, since one group compares with nothing.
 */
export function rowGroupsUsable(table: DataTable): boolean {
  // Tolerates partially-built tables (no columns/rows yet) — callers include the
  // suggestion engine, which runs against whatever is in the document right now.
  if (table.kind && !GROUPABLE_KINDS.has(table.kind)) return false;
  const labelId = rowGroupColumn(table);
  if (!labelId || !table.rows?.length) return false;
  if (tableDatasets(table).length >= 2) return false;
  const levels = rowGroupLevels(table, labelId);
  if (levels.length < 2) return false;
  // Categorical = no non-blank cell in the column parses as a number.
  return table.rows.every((row) => {
    const raw = row.cells[labelId];
    if (raw == null || String(raw).trim() === "") return true;
    return numericCell(raw) === null;
  });
}
