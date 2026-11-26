import { useMemo, useState } from "react";
import { removeBaseline, columnMath } from "@mady/core";
import type { CellValue, DataTable } from "@mady/core";
import { tableToGrid } from "./exporters";
import { GuideHelp } from "./guideLink";

type Spec =
  | { mode: "baseline"; dataColumns: number[]; keepColumns?: number[]; baselineFrom: "column" | "firstRow" | "meanRows" | "constant"; baselineCol?: number; from?: number; to?: number; value?: number; operation?: "subtract" | "divide" }
  | { mode: "columnmath"; keepColumns?: number[]; a: number; b: number; operator: "add" | "subtract" | "multiply" | "divide"; resultName?: string };

/** What the dialog returns on confirm — a ready-to-`deriveTable` payload. */
export interface ColMathResult {
  name: string;
  columnNames: string[];
  rows: CellValue[][];
  spec: Spec;
  sourceId: string;
}

type Role = "data" | "keep" | "ignore";
const PREVIEW_ROWS = 8;

/**
 * ColMathDialog — "Remove baseline & column math". Two modes:
 * - Baseline: subtract (or divide by) a baseline (a column / row-0 / a row-range
 *   mean / a constant) from each data column;
 * - Column math: a binary operation between two columns → a new result column.
 * The maths is the pure `@mady/core` `removeBaseline` / `columnMath`.
 */
export function ColMathDialog({
  table,
  docVersion,
  onConfirm,
  onCancel,
}: {
  table: DataTable;
  /** The document's edit counter: a linked-file refresh rewrites `table` IN PLACE, so the preview keys on this too. */
  docVersion?: number | undefined;
  onConfirm: (result: ColMathResult) => void;
  onCancel: () => void;
}) {
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `docVersion` is the edit signal (the rows change in place)
  const grid = useMemo(() => tableToGrid(table), [table, docVersion]);
  const n = grid.columnNames.length;
  const [mode, setMode] = useState<"baseline" | "columnmath">("baseline");
  // Baseline mode
  const [roles, setRoles] = useState<Role[]>(() => Array.from({ length: n }, (_, i) => (i === 0 ? "keep" : "data")));
  const [baselineFrom, setBaselineFrom] = useState<"column" | "firstRow" | "meanRows" | "constant">("firstRow");
  const [baselineCol, setBaselineCol] = useState(n > 1 ? n - 1 : 0);
  const [from, setFrom] = useState(0);
  const [to, setTo] = useState(0);
  const [value, setValue] = useState("0");
  const [operation, setOperation] = useState<"subtract" | "divide">("subtract");
  // Column-math mode
  const [a, setA] = useState(n > 1 ? 1 : 0);
  const [b, setB] = useState(n > 2 ? 2 : 0);
  const [operator, setOperator] = useState<"add" | "subtract" | "multiply" | "divide">("subtract");
  const [resultName, setResultName] = useState("");
  const [keepFirst, setKeepFirst] = useState(true);

  const setRole = (i: number, r: Role): void => setRoles((prev) => { const nx = [...prev]; nx[i] = r; return nx; });

  const { result, problem } = useMemo<{ result: ColMathResult | null; problem?: string }>(() => {
    if (mode === "baseline") {
      const dataColumns = roles.flatMap((r, i) => (r === "data" ? [i] : []));
      const keepColumns = roles.flatMap((r, i) => (r === "keep" ? [i] : []));
      if (dataColumns.length === 0) return { result: null, problem: "Choose at least one data column to baseline-correct." };
      const spec: Extract<Spec, { mode: "baseline" }> = {
        mode: "baseline", dataColumns, keepColumns, baselineFrom, operation,
        ...(baselineFrom === "column" ? { baselineCol } : {}),
        ...(baselineFrom === "meanRows" ? { from: Math.max(0, Math.floor(from)), to: Math.max(0, Math.floor(to)) } : {}),
        ...(baselineFrom === "constant" ? { value: Number.isFinite(Number(value)) ? Number(value) : 0 } : {}),
      };
      const out = removeBaseline(grid, spec);
      return { result: { name: `${table.name} (baseline)`, spec, sourceId: table.id, ...out } };
    }
    const spec: Extract<Spec, { mode: "columnmath" }> = {
      mode: "columnmath", keepColumns: keepFirst && n > 0 ? [0] : [], a, b, operator,
      ...(resultName.trim() ? { resultName: resultName.trim() } : {}),
    };
    const out = columnMath(grid, spec);
    return { result: { name: `${table.name} (col math)`, spec, sourceId: table.id, ...out } };
  }, [mode, roles, baselineFrom, baselineCol, from, to, value, operation, a, b, operator, resultName, keepFirst, grid, n, table.name, table.id]);

  const rowCount = result?.rows.length ?? 0;
  const preview = result?.rows.slice(0, PREVIEW_ROWS) ?? [];
  const fmt = (c: CellValue): string => (c == null ? "" : typeof c === "number" ? String(Number(c.toFixed(6))) : String(c));
  const cols = grid.columnNames;

  return (
    <div className="modalov" onClick={onCancel}>
      <div className="modal modal-wide" role="dialog" aria-label="Remove baseline and column math" onClick={(e) => e.stopPropagation()}>
        <div className="modalh-row">
          <h3 className="modalh">Remove baseline & column math — “{table.name}”</h3>
          <GuideHelp target={{ entry: "action:colmath" }} what="Remove baseline & column math" />
        </div>

        <div className="importopts">
          <label>
            Operation{" "}
            <select aria-label="Operation" value={mode} onChange={(e) => setMode(e.target.value as "baseline" | "columnmath")}>
              <option value="baseline">Remove baseline</option>
              <option value="columnmath">Column math (A op B)</option>
            </select>
          </label>
          {mode === "baseline" && (
            <>
              <label>
                Baseline is{" "}
                <select aria-label="Baseline source" value={baselineFrom} onChange={(e) => setBaselineFrom(e.target.value as typeof baselineFrom)}>
                  <option value="firstRow">First-row value</option>
                  <option value="meanRows">Mean of a row range</option>
                  <option value="column">A baseline column</option>
                  <option value="constant">A constant</option>
                </select>
              </label>
              {baselineFrom === "column" && (
                <label>
                  Column{" "}
                  <select aria-label="Baseline column" value={baselineCol} onChange={(e) => setBaselineCol(Number(e.target.value))}>
                    {cols.map((nm, i) => <option key={i} value={i}>{nm}</option>)}
                  </select>
                </label>
              )}
              {baselineFrom === "meanRows" && (
                <>
                  <label>From row{" "}<input aria-label="From row" type="number" min={0} value={from} onChange={(e) => setFrom(Number(e.target.value))} /></label>
                  <label>To row{" "}<input aria-label="To row" type="number" min={0} value={to} onChange={(e) => setTo(Number(e.target.value))} /></label>
                </>
              )}
              {baselineFrom === "constant" && (
                <label>Value{" "}<input aria-label="Constant" value={value} onChange={(e) => setValue(e.target.value)} /></label>
              )}
              <label>
                As{" "}
                <select aria-label="Baseline operation" value={operation} onChange={(e) => setOperation(e.target.value as "subtract" | "divide")}>
                  <option value="subtract">Subtract</option>
                  <option value="divide">Divide (ratio)</option>
                </select>
              </label>
            </>
          )}
          {mode === "columnmath" && (
            <>
              <label>A{" "}<select aria-label="Column A" value={a} onChange={(e) => setA(Number(e.target.value))}>{cols.map((nm, i) => <option key={i} value={i}>{nm}</option>)}</select></label>
              <label>
                Op{" "}
                <select aria-label="Operator" value={operator} onChange={(e) => setOperator(e.target.value as typeof operator)}>
                  <option value="add">+</option>
                  <option value="subtract">−</option>
                  <option value="multiply">×</option>
                  <option value="divide">÷</option>
                </select>
              </label>
              <label>B{" "}<select aria-label="Column B" value={b} onChange={(e) => setB(Number(e.target.value))}>{cols.map((nm, i) => <option key={i} value={i}>{nm}</option>)}</select></label>
              <label>Result name{" "}<input aria-label="Result name" value={resultName} onChange={(e) => setResultName(e.target.value)} placeholder="auto" /></label>
              <label className="importchk"><input type="checkbox" checked={keepFirst} onChange={(e) => setKeepFirst(e.target.checked)} /> Keep first column</label>
            </>
          )}
        </div>

        {mode === "baseline" && (
          <div className="reshaperoles">
            {cols.map((name, i) => (
              <label key={i} className="reshaperole">
                <span className="reshapecol">{name}</span>
                <select aria-label={`Role for ${name}`} value={roles[i]} onChange={(e) => setRole(i, e.target.value as Role)}>
                  <option value="data">Baseline-correct</option>
                  <option value="keep">Keep (id / X)</option>
                  <option value="ignore">Ignore</option>
                </select>
              </label>
            ))}
          </div>
        )}

        {result ? (
          <div className="importpreview">
            <table>
              <thead><tr>{result.columnNames.map((nm, i) => <th key={i}>{nm}</th>)}</tr></thead>
              <tbody>{preview.map((row, r) => <tr key={r}>{row.map((cell, c) => <td key={c}>{fmt(cell)}</td>)}</tr>)}</tbody>
            </table>
          </div>
        ) : (
          <p className="note">{problem ?? "Nothing to preview."}</p>
        )}

        <p className="note">{result ? `${rowCount} row${rowCount === 1 ? "" : "s"} × ${result.columnNames.length} column${result.columnNames.length === 1 ? "" : "s"}${rowCount > PREVIEW_ROWS ? ` · showing first ${PREVIEW_ROWS}` : ""}` : ""}</p>

        <div className="modalbtns">
          <button className="btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn" disabled={!result} onClick={() => result && onConfirm(result)}>Create dataset</button>
        </div>
      </div>
    </div>
  );
}
