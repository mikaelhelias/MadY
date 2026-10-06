import { useMemo, useState } from "react";
import { applyTransform, transformById, TRANSFORMS } from "@mady/core";
import type { CellValue, DataTable, TransformId } from "@mady/core";
import { tableToGrid } from "./exporters";
import { GuideHelp } from "./guideLink";

/** What the dialog returns on confirm — a ready-to-`deriveTable` payload. */
export interface TransformResult {
  name: string;
  columnNames: string[];
  rows: CellValue[][];
  /** The derivation spec — lets the commit create a *reactive* derived table. */
  spec: { fn: string; columns: number[]; k?: number; append?: boolean; xColumn?: number; swapXY?: { xCol: number; yCol: number }; seed?: number };
  /** Source table id the transform was computed from. */
  sourceId: string;
}

const PREVIEW_ROWS = 8;

/** Transform ids grouped for the chooser, in the registry's display order. */
function groupedTransforms(): { group: string; items: { id: TransformId; label: string }[] }[] {
  const out: { group: string; items: { id: TransformId; label: string }[] }[] = [];
  for (const t of TRANSFORMS) {
    let g = out.find((o) => o.group === t.group);
    if (!g) {
      g = { group: t.group, items: [] };
      out.push(g);
    }
    g.items.push({ id: t.id, label: t.label });
  }
  return out;
}

/** Tidy number for the preview (trim long floats without misrepresenting integers). */
function fmt(v: CellValue): string {
  if (v == null) return "";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toPrecision(6).replace(/\.?0+$/, "");
  return String(v);
}

/**
 * TransformDialog — the "Transform" analysis: derive a new table
 * by applying a function (logs, powers, z-score, normalise, rank, logit/probit,
 * pX, …) to the chosen columns. The maths is the pure `@mady/core`
 * `applyTransform`; this is the function picker + column selection + live
 * preview, committed as a new dataset (exactly like a reshape).
 */
export function TransformDialog({
  table,
  docVersion,
  onConfirm,
  onCancel,
}: {
  table: DataTable;
  /** The document's edit counter: a linked-file refresh rewrites `table` in place, so the preview keys on this too. */
  docVersion?: number | undefined;
  onConfirm: (result: TransformResult) => void;
  onCancel: () => void;
}) {
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `docVersion` is the edit signal (the rows change in place)
  const grid = useMemo(() => tableToGrid(table), [table, docVersion]);
  const groups = useMemo(groupedTransforms, []);
  // Default selection: every column except the X column (role "x" or column 0).
  const defaultCols = useMemo(
    () => table.columns.map((c, i) => ({ i, isX: c.role === "x" || (c.role == null && i === 0) })).filter((c) => !c.isX).map((c) => c.i),
    [table.columns],
  );

  // The X column index (role "x" or column 0) — supplies X for the X-combining functions
  // and is the default left side of an X↔Y interchange.
  const xColDefault = useMemo(() => {
    const i = table.columns.findIndex((c) => c.role === "x");
    return i >= 0 ? i : 0;
  }, [table.columns]);

  const [fnId, setFnId] = useState<TransformId>("log10");
  const [k, setK] = useState<number>(() => transformById("log10")?.defaultK ?? 1);
  const [append, setAppend] = useState(false);
  const [cols, setCols] = useState<Set<number>>(() => new Set(defaultCols));
  const [xCol, setXCol] = useState<number>(xColDefault);
  const [interchange, setInterchange] = useState(false);
  const [yCol, setYCol] = useState<number>(() => defaultCols[0] ?? 1);
  const [seed, setSeed] = useState(20240705);

  const fn = transformById(fnId);
  const needsK = fn?.needsK ?? false;
  const needsX = fn?.needsX ?? false;
  const isRandom = fn?.random ?? false;

  function changeFn(id: TransformId): void {
    setFnId(id);
    const def = transformById(id)?.defaultK;
    if (def != null) setK(def);
  }

  function toggleCol(i: number): void {
    setCols((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  }

  const { result, problem } = useMemo<{ result: TransformResult | null; problem?: string }>(() => {
    // Interchange X and Y — a pure column swap, independent of the function.
    if (interchange) {
      if (xCol === yCol) return { result: null, problem: "Pick two different columns to interchange." };
      const spec = { fn: fnId, columns: [], swapXY: { xCol, yCol } };
      const out = applyTransform(grid, spec);
      return { result: { name: `${table.name} (X↔Y)`, spec, sourceId: table.id, ...out } };
    }
    const columns = [...cols].sort((a, b) => a - b);
    if (columns.length === 0) return { result: null, problem: "Select at least one column to transform." };
    const spec = { fn: fnId, columns, k, append, ...(needsX ? { xColumn: xCol } : {}), ...(isRandom ? { seed } : {}) };
    const out = applyTransform(grid, spec);
    return { result: { name: `${table.name} (${fn?.label.replace(/^Y = /, "") ?? fnId})`, spec, sourceId: table.id, ...out } };
  }, [cols, grid, fnId, k, append, table.name, fn, table.id, interchange, xCol, yCol, needsX, isRandom, seed]);

  const rowCount = result?.rows.length ?? 0;
  const colCount = result?.columnNames.length ?? 0;
  const preview = result?.rows.slice(0, PREVIEW_ROWS) ?? [];

  return (
    <div className="modalov" onClick={onCancel}>
      <div className="modal modal-wide" role="dialog" aria-label="Transform data" onClick={(e) => e.stopPropagation()}>
        <div className="modalh-row">
          <h3 className="modalh">Transform “{table.name}”</h3>
          <GuideHelp target={{ entry: "action:transform" }} what="Transform values" />
        </div>

        <div className="importopts">
          <label className="importchk">
            <input type="checkbox" aria-label="Interchange X and Y" checked={interchange} onChange={(e) => setInterchange(e.target.checked)} />
            Interchange X and Y (swap two columns)
          </label>
          {interchange ? (
            <>
              <label>
                X column{" "}
                <select aria-label="X column" value={xCol} onChange={(e) => setXCol(Number(e.target.value))}>
                  {grid.columnNames.map((name, i) => (
                    <option key={i} value={i}>{name}</option>
                  ))}
                </select>
              </label>
              <label>
                ↔ Y column{" "}
                <select aria-label="Swap with column" value={yCol} onChange={(e) => setYCol(Number(e.target.value))}>
                  {grid.columnNames.map((name, i) => (
                    <option key={i} value={i}>{name}</option>
                  ))}
                </select>
              </label>
            </>
          ) : (
            <>
              <label>
                Function{" "}
                <select aria-label="Function" value={fnId} onChange={(e) => changeFn(e.target.value as TransformId)}>
                  {groups.map((g) => (
                    <optgroup key={g.group} label={g.group}>
                      {g.items.map((it) => (
                        <option key={it.id} value={it.id}>
                          {it.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
              {needsX && (
                <label>
                  X column{" "}
                  <select aria-label="X column" value={xCol} onChange={(e) => setXCol(Number(e.target.value))}>
                    {grid.columnNames.map((name, i) => (
                      <option key={i} value={i}>{name}</option>
                    ))}
                  </select>
                </label>
              )}
              {needsK && (
                <label>
                  {isRandom ? "Noise SD / half-width (K)" : "Constant K"}{" "}
                  <input
                    aria-label="Constant K"
                    type="number"
                    value={k}
                    onChange={(e) => setK(Number(e.target.value) || 0)}
                    style={{ width: 80 }}
                  />
                </label>
              )}
              {isRandom && (
                <label>
                  Seed{" "}
                  <input
                    aria-label="Seed"
                    type="number"
                    value={seed}
                    onChange={(e) => setSeed(Math.trunc(Number(e.target.value)) || 0)}
                    style={{ width: 110 }}
                  />
                  <button
                    type="button"
                    className="btn-mini"
                    aria-label="Randomise seed"
                    title="New random seed"
                    onClick={() => setSeed(Math.floor(Math.random() * 1_000_000_000))}
                    style={{ marginLeft: 4 }}
                  >
                    🎲
                  </button>
                </label>
              )}
              <label className="importchk">
                <input type="checkbox" checked={append} onChange={(e) => setAppend(e.target.checked)} />
                Add as new columns (keep originals)
              </label>
            </>
          )}
        </div>

        {!interchange && (
          <div className="reshaperoles">
            {grid.columnNames.map((name, i) => (
              <label key={i} className="reshaperole" style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <input type="checkbox" aria-label={`Transform ${name}`} checked={cols.has(i)} onChange={() => toggleCol(i)} />
                <span className="reshapecol">{name}</span>
              </label>
            ))}
          </div>
        )}

        {result && colCount > 0 ? (
          <div className="importpreview">
            <table>
              <thead>
                <tr>
                  {result.columnNames.map((nm, i) => (
                    <th key={i}>{nm}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.map((row, r) => (
                  <tr key={r}>
                    {row.map((cell, c) => (
                      <td key={c}>{fmt(cell)}</td>
                    ))}
                  </tr>
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
              } · out-of-domain values become blank`
            : ""}
        </p>

        <div className="modalbtns">
          <button className="btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn" disabled={!result} onClick={() => result && onConfirm(result)}>
            Create dataset
          </button>
        </div>
      </div>
    </div>
  );
}
