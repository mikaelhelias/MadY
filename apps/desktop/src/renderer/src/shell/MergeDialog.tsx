import { useMemo, useState } from "react";
import { mergeReportText, mergeTables } from "@mady/core";
import type { CellValue, ColumnType, DataTable, MergeKeep, NodeId } from "@mady/core";
import { tableToGrid } from "./exporters";
import { GuideHelp } from "./guideLink";

/** What the dialog returns on confirm — a ready-to-`importTable` payload (a one-time copy, not a live sheet). */
export interface MergeResult {
  name: string;
  columnNames: string[];
  rows: CellValue[][];
  columnTypes: (ColumnType | undefined)[];
  /** The merge report in plain words, for the project log. */
  report: string;
}

const PREVIEW_ROWS = 10;

/** The column a merge most likely matches on: the first column of text (sample IDs, gene names), else the first column. */
export function likelyKeyColumn(table: DataTable): number {
  const i = table.columns.findIndex((c) => {
    if (c.type === "text" || c.type === "categorical") return true;
    const cells = table.rows.map((r) => r.cells[c.id]).filter((v) => v !== null && v !== undefined && String(v).trim() !== "");
    return cells.length > 0 && cells.every((v) => typeof v !== "number" && !Number.isFinite(Number(v)));
  });
  return Math.max(0, i);
}

/** The second sheet's match column: the one named like the first sheet's key, else its own likely key column. */
function matchingKeyColumn(second: DataTable, firstKeyName: string | undefined): number {
  const same = firstKeyName === undefined ? -1 : second.columns.findIndex((c) => c.name.trim().toLowerCase() === firstKeyName.trim().toLowerCase());
  return same >= 0 ? same : likelyKeyColumn(second);
}

/**
 * MergeDialog — "Data ▸ Merge datasheets…". Pick two sheets and the column to match them on, and
 * whether to keep only the matched rows or every row of the first sheet. The result is a NEW, ordinary sheet made from the
 * two as they are now (a one-time copy — editing the sources later does not update it). What was
 * matched, left out, duplicated or blank is counted under the preview. The maths is the pure `@mady/core` `mergeTables`.
 */
export function MergeDialog({
  tables,
  firstId,
  docVersion,
  onConfirm,
  onCancel,
}: {
  tables: DataTable[];
  /** The sheet the dialog opens on as the first sheet (the active one). */
  firstId: NodeId;
  docVersion?: number | undefined;
  onConfirm: (result: MergeResult) => void;
  onCancel: () => void;
}) {
  const [aId, setAId] = useState<NodeId>(firstId);
  const a = tables.find((t) => t.id === aId) ?? tables[0]!;
  const [bId, setBId] = useState<NodeId>(() => tables.find((t) => t.id !== firstId)?.id ?? firstId);
  const b = tables.find((t) => t.id === bId && t.id !== a.id) ?? tables.find((t) => t.id !== a.id) ?? a;
  const [keyA, setKeyA] = useState<number>(() => likelyKeyColumn(a));
  const [keyB, setKeyB] = useState<number>(() => matchingKeyColumn(b, a.columns[likelyKeyColumn(a)]?.name));
  const [keep, setKeep] = useState<MergeKeep>("matched");
  const [name, setName] = useState<string | null>(null);

  const pickA = (id: NodeId): void => {
    const t = tables.find((x) => x.id === id);
    if (!t) return;
    setAId(id);
    const k = likelyKeyColumn(t);
    setKeyA(k);
    const other = id === b.id ? tables.find((x) => x.id !== id) : b;
    if (other) {
      setBId(other.id);
      setKeyB(matchingKeyColumn(other, t.columns[k]?.name));
    }
  };
  const pickB = (id: NodeId): void => {
    const t = tables.find((x) => x.id === id);
    if (!t) return;
    setBId(id);
    setKeyB(matchingKeyColumn(t, a.columns[keyA]?.name));
  };

  const result = useMemo<MergeResult>(() => {
    const merged = mergeTables(tableToGrid(a), tableToGrid(b), { keyFirst: keyA, keySecond: keyB, keep, secondName: b.name });
    const bCols = b.columns.filter((_, i) => i !== keyB);
    return {
      name: name ?? `${a.name} + ${b.name}`,
      columnNames: merged.table.columnNames,
      rows: merged.table.rows,
      columnTypes: [...a.columns.map((c) => c.type), ...bCols.map((c) => c.type)],
      report: mergeReportText(merged.report, keep),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `docVersion` is the edit signal (the rows change in place)
  }, [a, b, keyA, keyB, keep, name, docVersion]);

  const fmt = (c: CellValue): string => (c == null ? "" : String(c));
  const same = a.id === b.id;

  return (
    <div className="modalov" onClick={onCancel}>
      <div className="modal modal-wide" role="dialog" aria-label="Merge datasheets" onClick={(e) => e.stopPropagation()}>
        <div className="modalh-row">
          <h3 className="modalh">Merge datasheets</h3>
          <GuideHelp target={{ entry: "action:merge-data" }} what="Merge datasheets" />
        </div>
        <p className="note">
          Join two sheets row by row on a column they share, such as a sample ID. The result is a new sheet made from the two as
          they are now — later edits to them do not change it.
        </p>

        <div className="importopts">
          <label>
            First sheet{" "}
            <select aria-label="First sheet" value={a.id} onChange={(e) => pickA(e.target.value)}>
              {tables.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>{" "}
          <label>
            match on{" "}
            <select aria-label="First sheet's match column" value={keyA} onChange={(e) => setKeyA(Number(e.target.value))}>
              {a.columns.map((c, i) => <option key={c.id} value={i}>{c.name}</option>)}
            </select>
          </label>
        </div>
        <div className="importopts">
          <label>
            Second sheet{" "}
            <select aria-label="Second sheet" value={b.id} onChange={(e) => pickB(e.target.value)}>
              {tables.filter((t) => t.id !== a.id).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>{" "}
          <label>
            match on{" "}
            <select aria-label="Second sheet's match column" value={keyB} onChange={(e) => setKeyB(Number(e.target.value))}>
              {b.columns.map((c, i) => <option key={c.id} value={i}>{c.name}</option>)}
            </select>
          </label>
        </div>
        <div className="importopts">
          <label className="importchk">
            <input type="radio" name="merge-keep" aria-label="Keep only rows found in both sheets" checked={keep === "matched"} onChange={() => setKeep("matched")} />{" "}
            Keep only rows found in both sheets
          </label>{" "}
          <label className="importchk">
            <input type="radio" name="merge-keep" aria-label="Keep every row of the first sheet" checked={keep === "allFirst"} onChange={() => setKeep("allFirst")} />{" "}
            Keep every row of the first sheet
          </label>
        </div>
        <div className="importopts">
          <label>
            New sheet name{" "}
            <input type="text" aria-label="New sheet name" style={{ width: 280 }} value={result.name} onChange={(e) => setName(e.target.value)} />
          </label>
        </div>

        <div className="importpreview">
          <table>
            <thead>
              <tr>{result.columnNames.map((nm, i) => <th key={i}>{nm}</th>)}</tr>
            </thead>
            <tbody>
              {result.rows.slice(0, PREVIEW_ROWS).map((row, r) => (
                <tr key={r}>{row.map((cell, c) => <td key={c}>{fmt(cell)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="note" aria-label="Merge report">{same ? "Pick two different sheets." : result.report}</p>

        <div className="modalbtns">
          <button className="btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn" disabled={same || result.rows.length === 0} onClick={() => onConfirm(result)}>Create sheet</button>
        </div>
      </div>
    </div>
  );
}
