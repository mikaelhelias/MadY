import { useMemo, useState } from "react";
import { pruneRows } from "@mady/core";
import type { CellValue, DataTable } from "@mady/core";
import { tableToGrid } from "./exporters";
import { GuideHelp } from "./guideLink";

/** What the dialog returns on confirm — a ready-to-`deriveTable` payload. */
export interface PruneResult {
  name: string;
  columnNames: string[];
  rows: CellValue[][];
  spec: { mode: "everyNth" | "firstN" | "lastN" | "range" | "dropBlank"; n?: number; offset?: number; col?: number; min?: number; max?: number };
  sourceId: string;
}

type Mode = PruneResult["spec"]["mode"];
const PREVIEW_ROWS = 8;

/**
 * PruneDialog — "Prune rows". Keep a subset of the source rows into a new
 * reactive table: every Nth (thin), first/last N, within an X range, or dropping
 * blank rows. The maths is the pure `@mady/core` `pruneRows`.
 */
export function PruneDialog({
  table,
  docVersion,
  onConfirm,
  onCancel,
}: {
  table: DataTable;
  /** The document's edit counter: a linked-file refresh rewrites `table` in place, so the preview keys on this too. */
  docVersion?: number | undefined;
  onConfirm: (result: PruneResult) => void;
  onCancel: () => void;
}) {
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `docVersion` is the edit signal (the rows change in place)
  const grid = useMemo(() => tableToGrid(table), [table, docVersion]);
  const [mode, setMode] = useState<Mode>("everyNth");
  const [n, setN] = useState(2);
  const [offset, setOffset] = useState(0);
  const [col, setCol] = useState(0); // range: the test column; dropBlank: -1 = any (fully blank)
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");

  const result = useMemo<PruneResult>(() => {
    const spec: PruneResult["spec"] = { mode };
    if (mode === "everyNth") {
      spec.n = Math.max(1, Math.floor(n || 1));
      spec.offset = Math.max(0, Math.floor(offset || 0));
    } else if (mode === "firstN" || mode === "lastN") {
      spec.n = Math.max(0, Math.floor(n || 0));
    } else if (mode === "range") {
      spec.col = Math.max(0, col);
      if (min.trim() !== "" && Number.isFinite(Number(min))) spec.min = Number(min);
      if (max.trim() !== "" && Number.isFinite(Number(max))) spec.max = Number(max);
    } else if (mode === "dropBlank") {
      if (col >= 0) spec.col = col;
    }
    const out = pruneRows(grid, spec);
    return { name: `${table.name} (pruned)`, spec, sourceId: table.id, ...out };
  }, [mode, n, offset, col, min, max, grid, table.name, table.id]);

  const rowCount = result.rows.length;
  const colCount = grid.columnNames.length;
  const preview = result.rows.slice(0, PREVIEW_ROWS);
  const fmt = (c: CellValue): string => (c == null ? "" : String(c));

  return (
    <div className="modalov" onClick={onCancel}>
      <div className="modal modal-wide" role="dialog" aria-label="Prune rows" onClick={(e) => e.stopPropagation()}>
        <div className="modalh-row">
          <h3 className="modalh">Prune rows — “{table.name}”</h3>
          <GuideHelp target={{ entry: "action:prune" }} what="Prune rows" />
        </div>

        <div className="importopts">
          <label>
            Keep{" "}
            <select aria-label="Prune mode" value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
              <option value="everyNth">Every Nth row (thin)</option>
              <option value="firstN">First N rows</option>
              <option value="lastN">Last N rows</option>
              <option value="range">Rows within a range</option>
              <option value="dropBlank">Drop blank rows</option>
            </select>
          </label>
          {mode === "everyNth" && (
            <>
              <label>N{" "}<input aria-label="N" type="number" min={1} value={n} onChange={(e) => setN(Number(e.target.value))} /></label>
              <label>Offset{" "}<input aria-label="Offset" type="number" min={0} value={offset} onChange={(e) => setOffset(Number(e.target.value))} /></label>
            </>
          )}
          {(mode === "firstN" || mode === "lastN") && (
            <label>N{" "}<input aria-label="N" type="number" min={0} value={n} onChange={(e) => setN(Number(e.target.value))} /></label>
          )}
          {mode === "range" && (
            <>
              <label>
                Column{" "}
                <select aria-label="Column" value={col} onChange={(e) => setCol(Number(e.target.value))}>
                  {grid.columnNames.map((nm, i) => <option key={i} value={i}>{nm}</option>)}
                </select>
              </label>
              <label>Min{" "}<input aria-label="Min" value={min} onChange={(e) => setMin(e.target.value)} placeholder="−∞" /></label>
              <label>Max{" "}<input aria-label="Max" value={max} onChange={(e) => setMax(e.target.value)} placeholder="+∞" /></label>
            </>
          )}
          {mode === "dropBlank" && (
            <label>
              Blank in{" "}
              <select aria-label="Blank in column" value={col} onChange={(e) => setCol(Number(e.target.value))}>
                <option value={-1}>Any (fully-blank rows)</option>
                {grid.columnNames.map((nm, i) => <option key={i} value={i}>{nm}</option>)}
              </select>
            </label>
          )}
        </div>

        <div className="importpreview">
          <table>
            <thead>
              <tr>{grid.columnNames.map((nm, i) => <th key={i}>{nm}</th>)}</tr>
            </thead>
            <tbody>
              {preview.map((row, r) => (
                <tr key={r}>{row.map((cell, c) => <td key={c}>{fmt(cell)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="note">
          {`${rowCount} of ${grid.rows.length} row${grid.rows.length === 1 ? "" : "s"} kept × ${colCount} column${
            colCount === 1 ? "" : "s"
          }${rowCount > PREVIEW_ROWS ? ` · showing first ${PREVIEW_ROWS}` : ""}`}
        </p>

        <div className="modalbtns">
          <button className="btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn" disabled={rowCount === 0} onClick={() => onConfirm(result)}>
            Create dataset
          </button>
        </div>
      </div>
    </div>
  );
}
