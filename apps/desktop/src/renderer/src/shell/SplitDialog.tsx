import { useMemo, useState } from "react";
import { splitCounts, splitTextColumn } from "@mady/core";
import type { CellValue, DataTable } from "@mady/core";
import { tableToGrid } from "./exporters";
import { GuideHelp } from "./guideLink";
import { likelyKeyColumn } from "./MergeDialog";

/** What the dialog returns on confirm — a ready-to-`deriveTable` payload (a LIVE sheet: it follows its source). */
export interface SplitResult {
  name: string;
  spec: { col: number; sep: string };
  sourceId: string;
}

const PREVIEW_ROWS = 10;

/** The words under the preview: how many rows split, how many had no separator, how many parts — or why nothing split. */
export function splitSummary(c: { split: number; unsplit: number; parts: number }, sep: string): string {
  if (sep === "") return "Type the separator to split at.";
  const shown = sep === " " ? "a space" : `“${sep}”`;
  if (c.split === 0) return `No cell in this column contains ${shown} — nothing to split.`;
  const rows = (n: number) => `${n} row${n === 1 ? "" : "s"}`;
  return `${rows(c.split)} split into up to ${c.parts} parts` + (c.unsplit > 0 ? ` · ${rows(c.unsplit)} without ${shown} kept whole in part 1.` : ".");
}

/**
 * SplitDialog — "Data ▸ Split text column…": split one column's text at a separator, e.g.
 * "Liver_Day7" at "_" → "Liver" | "Day7". The result is a new LIVE sheet (it follows the source, like Transpose);
 * the maths is the pure `@mady/core` `splitTextColumn`.
 */
export function SplitDialog({
  table,
  docVersion,
  onConfirm,
  onCancel,
}: {
  table: DataTable;
  docVersion?: number | undefined;
  onConfirm: (result: SplitResult) => void;
  onCancel: () => void;
}) {
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `docVersion` is the edit signal (the rows change in place)
  const grid = useMemo(() => tableToGrid(table), [table, docVersion]);
  const [col, setCol] = useState(() => likelyKeyColumn(table));
  const [sep, setSep] = useState("_");
  const spec = { col, sep };
  const out = useMemo(() => splitTextColumn(grid, { col, sep }), [grid, col, sep]);
  const counts = useMemo(() => splitCounts(grid, { col, sep }), [grid, col, sep]);
  const fmt = (c: CellValue): string => (c == null ? "" : String(c));

  return (
    <div className="modalov" onClick={onCancel}>
      <div className="modal modal-wide" role="dialog" aria-label="Split text column" onClick={(e) => e.stopPropagation()}>
        <div className="modalh-row">
          <h3 className="modalh">Split text column — “{table.name}”</h3>
          <GuideHelp target={{ entry: "action:split-text" }} what="Split text column" />
        </div>
        <p className="note">Split each cell of one column where a separator appears — “Liver_Day7” at “_” gives “Liver” and “Day7”. Parts that are numbers become numbers. The new sheet follows this one.</p>

        <div className="importopts">
          <label>
            Column{" "}
            <select aria-label="Column to split" value={col} onChange={(e) => setCol(Number(e.target.value))}>
              {grid.columnNames.map((nm, i) => <option key={i} value={i}>{nm}</option>)}
            </select>
          </label>
          <label>
            Split at{" "}
            <input type="text" aria-label="Separator" style={{ width: 60 }} value={sep} onChange={(e) => setSep(e.target.value)} />
          </label>
        </div>

        <div className="importpreview">
          <table>
            <thead>
              <tr>{out.columnNames.map((nm, i) => <th key={i}>{nm}</th>)}</tr>
            </thead>
            <tbody>
              {out.rows.slice(0, PREVIEW_ROWS).map((row, r) => (
                <tr key={r}>{row.map((cell, c) => <td key={c}>{fmt(cell)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="note" aria-label="Split summary">{splitSummary(counts, sep)}</p>

        <div className="modalbtns">
          <button className="btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn" disabled={counts.split === 0} onClick={() => onConfirm({ name: `${table.name} (split)`, spec, sourceId: table.id })}>Create sheet</button>
        </div>
      </div>
    </div>
  );
}
