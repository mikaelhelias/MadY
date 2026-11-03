import { useMemo, useState } from "react";
import { replaceInCell } from "@mady/core";
import type { DataTable, FindReplaceSpec, NodeId } from "@mady/core";
import { GuideHelp } from "./guideLink";

/** What the dialog returns on confirm — the arguments of `MadyDocument.replaceInTable`, and the count it previewed. */
export interface FindReplaceResult {
  tableId: NodeId;
  spec: FindReplaceSpec & { columnIds?: NodeId[] | undefined };
  count: number;
}

/** How many cells a find & replace would change — the same `replaceInCell` the document applies. */
export function countReplacements(table: DataTable, spec: FindReplaceSpec & { columnIds?: NodeId[] | undefined }): number {
  const cols = spec.columnIds ? table.columns.filter((c) => spec.columnIds!.includes(c.id)) : table.columns;
  let n = 0;
  for (const row of table.rows) for (const c of cols) if (replaceInCell(row.cells[c.id] ?? null, spec).changed) n++;
  return n;
}

/**
 * FindReplaceDialog — "Data ▸ Find & replace…": replace text in the whole sheet or one column, in one
 * undoable step (Ctrl+Z puts every cell back). The text is found literally. The count of cells that will change is shown
 * before anything changes, and "No matches" is reported explicitly.
 */
export function FindReplaceDialog({
  table,
  onConfirm,
  onCancel,
}: {
  table: DataTable;
  onConfirm: (result: FindReplaceResult) => void;
  onCancel: () => void;
}) {
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [colId, setColId] = useState<string>("");
  const [matchCase, setMatchCase] = useState(false);
  const [wholeCell, setWholeCell] = useState(false);
  const spec = { find, replace, matchCase, wholeCell, ...(colId ? { columnIds: [colId] } : {}) };
  const count = useMemo(() => countReplacements(table, spec), [table, find, replace, colId, matchCase, wholeCell]); // eslint-disable-line react-hooks/exhaustive-deps
  const summary = find === "" ? "Type the text to find." : count === 0 ? "No matches." : `${count} cell${count === 1 ? "" : "s"} will change.`;

  return (
    <div className="modalov" onClick={onCancel}>
      <div className="modal" role="dialog" aria-label="Find and replace" onClick={(e) => e.stopPropagation()}>
        <div className="modalh-row">
          <h3 className="modalh">Find & replace — “{table.name}”</h3>
          <GuideHelp target={{ entry: "action:find-replace" }} what="Find & replace" />
        </div>
        <div className="importopts">
          <label>
            Find{" "}
            <input type="text" aria-label="Find" style={{ width: 200 }} value={find} autoFocus onChange={(e) => setFind(e.target.value)} />
          </label>
          <label>
            Replace with{" "}
            <input type="text" aria-label="Replace with" style={{ width: 200 }} value={replace} onChange={(e) => setReplace(e.target.value)} />
          </label>
        </div>
        <div className="importopts">
          <label>
            In{" "}
            <select aria-label="Where to look" value={colId} onChange={(e) => setColId(e.target.value)}>
              <option value="">the whole sheet</option>
              {table.columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="importchk">
            <input type="checkbox" aria-label="Match case" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} /> Match case
          </label>
          <label className="importchk">
            <input type="checkbox" aria-label="Whole cell only" checked={wholeCell} onChange={(e) => setWholeCell(e.target.checked)} /> Whole cell only
          </label>
        </div>
        <p className="note" aria-label="Find and replace summary">{summary}</p>
        <div className="modalbtns">
          <button className="btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn" disabled={count === 0} onClick={() => onConfirm({ tableId: table.id, spec, count })}>Replace</button>
        </div>
      </div>
    </div>
  );
}
