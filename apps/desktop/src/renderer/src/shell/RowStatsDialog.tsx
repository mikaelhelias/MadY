import { useMemo, useState } from "react";
import { rowStatistics, ROW_STATS } from "@mady/core";
import type { CellValue, DataTable, RowStat } from "@mady/core";
import { tableToGrid } from "./exporters";
import { GuideHelp } from "./guideLink";

/** What the dialog returns on confirm — a ready-to-`deriveTable` payload. */
export interface RowStatsResult {
  name: string;
  columnNames: string[];
  rows: CellValue[][];
  spec: { dataColumns: number[]; keepColumns: number[]; stats: string[] };
  sourceId: string;
}

type Role = "data" | "keep" | "ignore";
const PREVIEW_ROWS = 8;
const DEFAULT_STATS: RowStat[] = ["mean", "sd", "sem", "n"];

/**
 * RowStatsDialog — "Row means / totals". For each ROW, summarize the chosen
 * data columns (e.g. replicate subcolumns) into per-row Mean/SD/SEM/N/… ; keep
 * columns (the X column / row labels) are carried through. The maths is the pure
 * `@mady/core` `rowStatistics`; this is the column-role + statistic picker +
 * live preview. Commits as a reactive derived table.
 */
export function RowStatsDialog({
  table,
  docVersion,
  onConfirm,
  onCancel,
}: {
  table: DataTable;
  /** The document's edit counter: a linked-file refresh rewrites `table` in place, so the preview keys on this too. */
  docVersion?: number | undefined;
  onConfirm: (result: RowStatsResult) => void;
  onCancel: () => void;
}) {
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `docVersion` is the edit signal (the rows change in place)
  const grid = useMemo(() => tableToGrid(table), [table, docVersion]);
  const n = grid.columnNames.length;
  // Default: first column keeps (X / labels); the rest are the data to summarize.
  const [roles, setRoles] = useState<Role[]>(() => Array.from({ length: n }, (_, i) => (i === 0 ? "keep" : "data")));
  const [stats, setStats] = useState<RowStat[]>(DEFAULT_STATS);

  const toggleStat = (id: RowStat): void =>
    setStats((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  const setRole = (i: number, r: Role): void =>
    setRoles((prev) => { const nx = [...prev]; nx[i] = r; return nx; });

  const { result, problem } = useMemo<{ result: RowStatsResult | null; problem?: string }>(() => {
    const dataColumns = roles.flatMap((r, i) => (r === "data" ? [i] : []));
    const keepColumns = roles.flatMap((r, i) => (r === "keep" ? [i] : []));
    if (dataColumns.length === 0) return { result: null, problem: "Choose at least one data column to summarize." };
    if (stats.length === 0) return { result: null, problem: "Choose at least one statistic." };
    // Emit in registry order (stable), not click order.
    const ordered = ROW_STATS.filter((s) => stats.includes(s.id)).map((s) => s.id);
    const spec = { dataColumns, keepColumns, stats: ordered };
    const out = rowStatistics(grid, spec);
    return { result: { name: `${table.name} (row stats)`, spec, sourceId: table.id, ...out } };
  }, [roles, stats, grid, table.name, table.id]);

  const rowCount = result?.rows.length ?? 0;
  const colCount = result?.columnNames.length ?? 0;
  const preview = result?.rows.slice(0, PREVIEW_ROWS) ?? [];
  const fmt = (cell: CellValue): string =>
    cell == null ? "" : typeof cell === "number" ? String(Number(cell.toFixed(4))) : String(cell);

  return (
    <div className="modalov" onClick={onCancel}>
      <div className="modal modal-wide" role="dialog" aria-label="Row statistics" onClick={(e) => e.stopPropagation()}>
        <div className="modalh-row">
          <h3 className="modalh">Row statistics — “{table.name}”</h3>
          <GuideHelp target={{ entry: "action:rowstats" }} what="Row statistics" />
        </div>
        <p className="note">
          For each row, summarize the chosen data columns (e.g. replicate subcolumns). Keep columns (like X) are carried
          through unchanged.
        </p>

        <div className="reshaperoles">
          {grid.columnNames.map((name, i) => (
            <label key={i} className="reshaperole">
              <span className="reshapecol">{name}</span>
              <select aria-label={`Role for ${name}`} value={roles[i]} onChange={(e) => setRole(i, e.target.value as Role)}>
                <option value="data">Summarize (data)</option>
                <option value="keep">Keep (id / X)</option>
                <option value="ignore">Ignore</option>
              </select>
            </label>
          ))}
        </div>

        <div className="importopts" role="group" aria-label="Statistics">
          {ROW_STATS.map((s) => (
            <label key={s.id} className="importchk">
              <input type="checkbox" checked={stats.includes(s.id)} onChange={() => toggleStat(s.id)} aria-label={s.label} />
              {s.label}
            </label>
          ))}
        </div>

        {result && colCount > 0 ? (
          <div className="importpreview">
            <table>
              <thead>
                <tr>{result.columnNames.map((nm, i) => <th key={i}>{nm}</th>)}</tr>
              </thead>
              <tbody>
                {preview.map((row, r) => (
                  <tr key={r}>{row.map((cell, c) => <td key={c}>{fmt(cell)}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="note">{problem ?? "Nothing to preview."}</p>
        )}

        <p className="note">
          {result
            ? `${rowCount} row${rowCount === 1 ? "" : "s"} × ${colCount} column${colCount === 1 ? "" : "s"}${
                rowCount > PREVIEW_ROWS ? ` · showing first ${PREVIEW_ROWS}` : ""
              }`
            : ""}
        </p>

        <div className="modalbtns">
          <button className="btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn" disabled={!result} onClick={() => result && onConfirm(result)}>
            Create dataset
          </button>
        </div>
      </div>
    </div>
  );
}
