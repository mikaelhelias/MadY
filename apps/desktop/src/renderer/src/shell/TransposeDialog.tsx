import { useMemo, useState } from "react";
import { transposeTable } from "@mady/core";
import type { CellValue, DataTable } from "@mady/core";
import { tableToGrid } from "./exporters";
import { GuideHelp } from "./guideLink";

/** What the dialog returns on confirm — a ready-to-`deriveTable` payload. */
export interface TransposeResult {
  name: string;
  columnNames: string[];
  rows: CellValue[][];
  spec: { labelCol?: number };
  sourceId: string;
}

const PREVIEW_ROWS = 10;

/**
 * TransposeDialog — "Transpose X and Y" as a live analysis. Rows↔columns
 * swap; pick which column's values become the new headers (or generic "Row N").
 * The maths is the pure `@mady/core` `transposeTable`; commits reactive.
 */
export function TransposeDialog({
  table,
  docVersion,
  onConfirm,
  onCancel,
}: {
  table: DataTable;
  /** The document's edit counter: a linked-file refresh rewrites `table` in place, so the preview keys on this too. */
  docVersion?: number | undefined;
  onConfirm: (result: TransposeResult) => void;
  onCancel: () => void;
}) {
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `docVersion` is the edit signal (the rows change in place)
  const grid = useMemo(() => tableToGrid(table), [table, docVersion]);
  const [labelCol, setLabelCol] = useState(0);

  const result = useMemo<TransposeResult>(() => {
    const spec = { labelCol };
    const out = transposeTable(grid, spec);
    return { name: `${table.name} (transposed)`, spec, sourceId: table.id, ...out };
  }, [labelCol, grid, table.name, table.id]);

  const rowCount = result.rows.length;
  const colCount = result.columnNames.length;
  const preview = result.rows.slice(0, PREVIEW_ROWS);
  const fmt = (c: CellValue): string => (c == null ? "" : String(c));

  return (
    <div className="modalov" onClick={onCancel}>
      <div className="modal modal-wide" role="dialog" aria-label="Transpose" onClick={(e) => e.stopPropagation()}>
        <div className="modalh-row">
          <h3 className="modalh">Transpose — “{table.name}”</h3>
          <GuideHelp target={{ entry: "action:transpose" }} what="Transpose" />
        </div>
        <p className="note">Swap rows and columns. Choose which column supplies the new headers (its values become column titles); every other column becomes a row.</p>

        <div className="importopts">
          <label>
            New headers from{" "}
            <select aria-label="Header column" value={labelCol} onChange={(e) => setLabelCol(Number(e.target.value))}>
              <option value={-1}>(none — generic Row N)</option>
              {grid.columnNames.map((nm, i) => <option key={i} value={i}>{nm}</option>)}
            </select>
          </label>
        </div>

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

        <p className="note">
          {`${rowCount} row${rowCount === 1 ? "" : "s"} × ${colCount} column${colCount === 1 ? "" : "s"}${
            rowCount > PREVIEW_ROWS ? ` · showing first ${PREVIEW_ROWS}` : ""
          }`}
        </p>

        <div className="modalbtns">
          <button className="btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn" onClick={() => onConfirm(result)}>Create dataset</button>
        </div>
      </div>
    </div>
  );
}
