import { useMemo, useState } from "react";
import { extractColumns } from "@mady/core";
import type { CellValue, DataTable } from "@mady/core";
import { tableToGrid } from "./exporters";
import { GuideHelp } from "./guideLink";

/** What the dialog returns on confirm — a ready-to-`deriveTable` payload. */
export interface ExtractResult {
  name: string;
  columnNames: string[];
  rows: CellValue[][];
  spec: { columns: number[] };
  sourceId: string;
}

const PREVIEW_ROWS = 8;

/**
 * ExtractDialog — "Extract and rearrange". Choose which columns to keep and
 * in what order (checkbox to include, ↑/↓ to reorder) into a new reactive table.
 * The maths is the pure `@mady/core` `extractColumns`.
 */
export function ExtractDialog({
  table,
  docVersion,
  onConfirm,
  onCancel,
}: {
  table: DataTable;
  /** The document's edit counter: a linked-file refresh rewrites `table` IN PLACE, so the preview keys on this too. */
  docVersion?: number | undefined;
  onConfirm: (result: ExtractResult) => void;
  onCancel: () => void;
}) {
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `docVersion` is the edit signal (the rows change in place)
  const grid = useMemo(() => tableToGrid(table), [table, docVersion]);
  const n = grid.columnNames.length;
  const [order, setOrder] = useState<number[]>(() => Array.from({ length: n }, (_, i) => i));
  const [included, setIncluded] = useState<Set<number>>(() => new Set(Array.from({ length: n }, (_, i) => i)));

  const toggle = (c: number): void =>
    setIncluded((prev) => { const nx = new Set(prev); if (nx.has(c)) nx.delete(c); else nx.add(c); return nx; });
  const move = (idx: number, dir: -1 | 1): void =>
    setOrder((prev) => {
      const j = idx + dir;
      if (j < 0 || j >= prev.length) return prev;
      const nx = [...prev];
      [nx[idx], nx[j]] = [nx[j]!, nx[idx]!];
      return nx;
    });

  const result = useMemo<ExtractResult>(() => {
    const columns = order.filter((c) => included.has(c));
    const spec = { columns };
    const out = extractColumns(grid, spec);
    return { name: `${table.name} (extract)`, spec, sourceId: table.id, ...out };
  }, [order, included, grid, table.name, table.id]);

  const chosen = result.spec.columns.length;
  const rowCount = result.rows.length;
  const preview = result.rows.slice(0, PREVIEW_ROWS);
  const fmt = (c: CellValue): string => (c == null ? "" : String(c));

  return (
    <div className="modalov" onClick={onCancel}>
      <div className="modal modal-wide" role="dialog" aria-label="Extract and rearrange" onClick={(e) => e.stopPropagation()}>
        <div className="modalh-row">
          <h3 className="modalh">Extract & rearrange — “{table.name}”</h3>
          <GuideHelp target={{ entry: "action:extract" }} what="Extract & rearrange" />
        </div>
        <p className="note">Tick the columns to keep and use ↑ / ↓ to set their order in the new table.</p>

        <div className="reshaperoles">
          {order.map((c, idx) => (
            <label key={c} className="reshaperole">
              <input type="checkbox" checked={included.has(c)} onChange={() => toggle(c)} aria-label={`Include ${grid.columnNames[c]}`} />
              <span className="reshapecol">{grid.columnNames[c]}</span>
              <span style={{ display: "flex", gap: 4 }}>
                <button type="button" className="btn-mini" disabled={idx === 0} onClick={() => move(idx, -1)} aria-label={`Move ${grid.columnNames[c]} up`}>↑</button>
                <button type="button" className="btn-mini" disabled={idx === order.length - 1} onClick={() => move(idx, 1)} aria-label={`Move ${grid.columnNames[c]} down`}>↓</button>
              </span>
            </label>
          ))}
        </div>

        {chosen > 0 ? (
          <div className="importpreview">
            <table>
              <thead>
                <tr>{result.columnNames.map((nm, i) => <th key={i}>{nm}</th>)}</tr>
              </thead>
              <tbody>
                {preview.map((row, r) => (
                  <tr key={r}>{row.map((cell, cc) => <td key={cc}>{fmt(cell)}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="note">Choose at least one column to keep.</p>
        )}

        <p className="note">
          {chosen > 0
            ? `${rowCount} row${rowCount === 1 ? "" : "s"} × ${chosen} column${chosen === 1 ? "" : "s"}${
                rowCount > PREVIEW_ROWS ? ` · showing first ${PREVIEW_ROWS}` : ""
              }`
            : ""}
        </p>

        <div className="modalbtns">
          <button className="btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn" disabled={chosen === 0} onClick={() => onConfirm(result)}>Create dataset</button>
        </div>
      </div>
    </div>
  );
}
