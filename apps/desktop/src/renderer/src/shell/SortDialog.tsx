import { useState } from "react";
import type { DataTable, NodeId } from "@mady/core";
import { GuideHelp } from "./guideLink";

/**
 * SortDialog — the menu route to the datasheet's "Sort by column" (also on the column
 * right-click). Picks a column + direction; the sort itself is the document's
 * `sortRowsByColumn` (type-aware, blanks-last, stable, undoable) — the SAME operation the
 * right-click uses, so the two agree. In-place on the active table, so nothing is returned but
 * the choice.
 */
export function SortDialog({
  table,
  onConfirm,
  onCancel,
}: {
  table: DataTable;
  onConfirm: (colId: NodeId, direction: "asc" | "desc") => void;
  onCancel: () => void;
}) {
  const [colId, setColId] = useState<NodeId>(table.columns[0]?.id ?? "");
  const [direction, setDirection] = useState<"asc" | "desc">("asc");
  const hasColumns = table.columns.length > 0;

  return (
    <div className="modalov" onClick={onCancel}>
      <div className="modal" role="dialog" aria-label="Sort by column" onClick={(e) => e.stopPropagation()}>
        <div className="modalh-row">
          <h3 className="modalh">Sort — “{table.name}”</h3>
          <GuideHelp target={{ entry: "action:sort-data" }} what="Sort rows" />
        </div>
        <p className="note">
          Reorder the rows by a column's values. Sorting is type-aware (numbers, text, dates),
          keeps blanks last, is stable, and is undoable.
        </p>

        <div className="importopts">
          <label>
            Sort by{" "}
            <select aria-label="Sort column" value={colId} onChange={(e) => setColId(e.target.value)}>
              {table.columns.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          <label>
            Direction{" "}
            <select aria-label="Sort direction" value={direction} onChange={(e) => setDirection(e.target.value as "asc" | "desc")}>
              <option value="asc">Ascending (A→Z, 0→9)</option>
              <option value="desc">Descending (Z→A, 9→0)</option>
            </select>
          </label>
        </div>

        <div className="modalbtns">
          <button className="btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn" disabled={!hasColumns} onClick={() => onConfirm(colId, direction)}>Sort rows</button>
        </div>
      </div>
    </div>
  );
}
