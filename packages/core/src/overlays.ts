/**
 * Series from another datasheet on one plot.
 *
 * `Plot.overlays` holds references (table id + lead column id). At the build choke point this
 * joins each referenced dataset into the plot's own table, so every builder, control and
 * click route downstream sees an ordinary series. Pure: never mutates either table.
 *
 * The join rule:
 *  • continuous X (xy / area): rows merge by exact numeric X; a foreign X the plot has no row
 *    for becomes its own row (carrying the foreign row id), with the local cells blank.
 *  • categorical X (bar): rows join by category label, in the local order; a foreign label the
 *    plot does not have is skipped and named in a warning — appending it would reorder every
 *    bar the user has styled.
 *  • kinds whose X is synthetic or absent (histogram bins, pie, network …) refuse: no shared axis.
 *
 * A dangling reference (table or column gone) warns and is skipped — never a throw at draw time,
 * never a silent drop. The foreign sheet's own exclusions are honoured before the join.
 */
import { applyExclusions } from "./cells";
import { tableDatasets, xColumn } from "./dataset";
import type { CellValue, Column, DataTable, NodeId, Plot, Row } from "./model";

/** Kinds that join foreign rows by numeric X. */
const CONTINUOUS_X = new Set<string>(["xy", "area"]);
/** Kinds that join foreign rows by category label. */
const CATEGORICAL_X = new Set<string>(["bar"]);

export interface ResolvedOverlays {
  /** The plot's table with every resolvable overlay joined in (the same object when there are none). */
  table: DataTable;
  /** Out-loud reasons for anything that could not be joined. */
  warnings: string[];
  /** Foreign lead-column id → where it came from (for the Series-row chip, tooltip, legend). */
  foreign: Map<NodeId, { table: NodeId; name: string }>;
}

const numeric = (v: CellValue | undefined): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
const label = (v: CellValue | undefined): string | null => (v == null || String(v).trim() === "" ? null : String(v));

/**
 * Join the plot's overlays into its table. `lookup` resolves a table id (the project's tables);
 * a builder without a project (gallery cards, fixtures, sweeps) passes none and gets the table back
 * untouched.
 */
export function resolveOverlays(
  table: DataTable,
  plot: Plot,
  lookup: ((id: NodeId) => DataTable | undefined) | undefined,
): ResolvedOverlays {
  const overlays = plot.overlays ?? [];
  const foreign = new Map<NodeId, { table: NodeId; name: string }>();
  if (overlays.length === 0 || !lookup) return { table, warnings: [], foreign };

  const kind = plot.kind ?? "xy";
  const continuous = CONTINUOUS_X.has(kind);
  const categorical = CATEGORICAL_X.has(kind);
  const warnings: string[] = [];
  if (!continuous && !categorical) {
    warnings.push(`A ${kind} chart cannot take a series from another datasheet — it has no shared X axis to join on. The ${overlays.length === 1 ? "overlay is" : `${overlays.length} overlays are`} not drawn.`);
    return { table, warnings, foreign };
  }
  const localX = xColumn(table);
  if (!localX) {
    warnings.push("This datasheet has no X column, so there is nothing to join a series from another datasheet on. The overlays are not drawn.");
    return { table, warnings, foreign };
  }

  const columns: Column[] = [...table.columns];
  const rows: Row[] = table.rows.map((r) => ({ ...r, cells: { ...r.cells } }));
  // Local row index by join key (numeric X or category label), first occurrence wins.
  const byKey = new Map<string, number>();
  rows.forEach((r, i) => {
    const raw = r.cells[localX.id];
    const key = continuous ? numeric(raw) : label(raw);
    if (key != null && !byKey.has(String(key))) byKey.set(String(key), i);
  });

  for (const ov of overlays) {
    const src = lookup(ov.table);
    if (!src) {
      warnings.push(`A series from another datasheet was not drawn: that datasheet no longer exists (it was deleted or is missing from this file). Remove the overlay, or add it again from an existing sheet.`);
      continue;
    }
    const ds = tableDatasets(src).find((d) => d.id === ov.column);
    if (!ds) {
      warnings.push(`A series from “${src.name}” was not drawn: its column no longer exists in that datasheet. Remove the overlay, or pick another column.`);
      continue;
    }
    const srcX = xColumn(src);
    if (!srcX) {
      warnings.push(`“${ds.name}” from “${src.name}” was not drawn: that datasheet has no X column, so there is nothing to join it on.`);
      continue;
    }
    if (columns.some((c) => c.id === ds.id)) continue; // the same column twice — one is enough
    const masked = applyExclusions(src);
    // The dataset's own columns (lead + replicates + summary columns), copied with explicit roles
    // so an omitted role can never be read as "x" at a different index.
    const dsCols = new Set<NodeId>(
      [ds.id, ...ds.replicates, ds.sd, ds.sem, ds.n, ds.cv, ds.errLow, ds.errHigh, ds.min, ds.max, ds.geoSd, ds.ci].filter(
        (v): v is NodeId => typeof v === "string",
      ),
    );
    const take = src.columns.filter((c) => dsCols.has(c.id));
    for (const c of take) columns.push({ ...c, role: c.role ?? "y" });
    const unmatched: string[] = [];
    for (const r of masked.rows) {
      const raw = r.cells[srcX.id];
      const key = continuous ? numeric(raw) : label(raw);
      if (key == null) continue;
      const at = byKey.get(String(key));
      const cells: Record<NodeId, CellValue> = {};
      for (const c of take) cells[c.id] = r.cells[c.id] ?? null;
      if (at != null) {
        Object.assign(rows[at]!.cells, cells);
      } else if (continuous) {
        rows.push({ id: r.id, cells: { [localX.id]: key, ...cells } });
        byKey.set(String(key), rows.length - 1);
      } else {
        unmatched.push(String(key));
      }
    }
    if (unmatched.length) {
      warnings.push(`“${ds.name}” from “${src.name}”: ${unmatched.length} categor${unmatched.length === 1 ? "y is" : "ies are"} not on this axis and ${unmatched.length === 1 ? "was" : "were"} skipped — ${unmatched.join(", ")}. Rename the categories to match, or add them to this datasheet.`);
    }
    foreign.set(ds.id, { table: src.id, name: src.name });
  }
  if (foreign.size === 0) return { table, warnings, foreign };
  // Row order is the user's (appended foreign rows last); the XY builder orders marks by X itself.
  return { table: { ...table, columns, rows }, warnings, foreign };
}
