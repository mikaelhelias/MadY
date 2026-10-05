import { useMemo, useState } from "react";
import { normalProbabilityPlot, lognormalProbabilityPlot, qqTable, columnNumbers } from "@mady/core";
import type { CellValue, DataTable, PlotPosition } from "@mady/core";
import { tableToGrid } from "./exporters";
import { GuideHelp } from "./guideLink";

/** What the dialog returns on confirm — a ready-to-`deriveTable` payload. */
export interface QQResultPayload {
  name: string;
  columnNames: string[];
  rows: CellValue[][];
  /** The derivation spec — lets the commit create a *reactive* derived table. */
  spec: { col: number; position: PlotPosition; variant?: "normal" | "lognormal" };
  /** Source table id the QQ plot was computed from. */
  sourceId: string;
}

const PREVIEW_ROWS = 10;

/** Tidy number for the preview. */
function fmt(v: CellValue): string {
  if (v == null) return "";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e4) / 1e4);
  return String(v);
}

/**
 * QQDialog — the "QQ plot" / normal-probability plot: pair each
 * ordered value of a chosen column with its theoretical normal quantile, plus a
 * reference line, committed as a new dataset you then plot as XY (points hug the
 * straight line when the data are Gaussian). The maths is the pure `@mady/core`
 * `normalProbabilityPlot`; this is the column + plotting-position picker + preview.
 */
export function QQDialog({
  table,
  docVersion,
  onConfirm,
  onCancel,
}: {
  table: DataTable;
  /** The document's edit counter: a linked-file refresh rewrites `table` in place, so the preview keys on this too. */
  docVersion?: number | undefined;
  onConfirm: (result: QQResultPayload) => void;
  onCancel: () => void;
}) {
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `docVersion` is the edit signal (the rows change in place)
  const grid = useMemo(() => tableToGrid(table), [table, docVersion]);
  const numericCols = useMemo(
    () => grid.columnNames.map((_, i) => i).filter((i) => columnNumbers(grid.rows, i).length > 0),
    [grid],
  );
  const [col, setCol] = useState<number>(() => numericCols[numericCols.length - 1] ?? 0);
  const [position, setPosition] = useState<PlotPosition>("blom");
  const [variant, setVariant] = useState<"normal" | "lognormal">("normal");

  const values = useMemo(() => columnNumbers(grid.rows, col), [grid, col]);

  const { result, problem } = useMemo<{ result: QQResultPayload | null; problem?: string }>(() => {
    const usable = variant === "lognormal" ? values.filter((v) => v > 0).length : values.length;
    if (usable < 3)
      return {
        result: null,
        problem:
          variant === "lognormal"
            ? "Log-normal QQ needs at least 3 positive values."
            : "Pick a numeric column with at least 3 values.",
      };
    const qq = variant === "lognormal" ? lognormalProbabilityPlot(values, position) : normalProbabilityPlot(values, position);
    const label = grid.columnNames[col] ?? "Value";
    const out = qqTable(qq, label);
    const name = `${table.name} — ${variant === "lognormal" ? "log-normal " : ""}QQ of ${label}`;
    return { result: { name, spec: { col, position, variant }, sourceId: table.id, ...out } };
  }, [values, position, variant, grid.columnNames, col, table.name, table.id]);

  const rowCount = result?.rows.length ?? 0;
  const preview = result?.rows.slice(0, PREVIEW_ROWS) ?? [];

  return (
    <div className="modalov" onClick={onCancel}>
      <div className="modal modal-wide" role="dialog" aria-label="QQ plot" onClick={(e) => e.stopPropagation()}>
        <div className="modalh-row">
          <h3 className="modalh">Normal probability (QQ) plot — “{table.name}”</h3>
          <GuideHelp target={{ entry: "action:qqplot" }} what="Normal probability (QQ) plot" />
        </div>

        <div className="importopts">
          <label>
            Column{" "}
            <select aria-label="Column" value={col} onChange={(e) => setCol(Number(e.target.value))}>
              {grid.columnNames.map((nm, i) => (
                <option key={i} value={i}>
                  {nm}
                </option>
              ))}
            </select>
          </label>
          <label>
            Distribution{" "}
            <select aria-label="Distribution" value={variant} onChange={(e) => setVariant(e.target.value as "normal" | "lognormal")}>
              <option value="normal">Normal</option>
              <option value="lognormal">Log-normal</option>
            </select>
          </label>
          <label>
            Plotting position{" "}
            <select aria-label="Plotting position" value={position} onChange={(e) => setPosition(e.target.value as PlotPosition)}>
              <option value="blom">Blom (i − 0.375)/(n + 0.25)</option>
              <option value="hazen">Hazen (i − 0.5)/n</option>
              <option value="weibull">Weibull i/(n + 1)</option>
            </select>
          </label>
        </div>

        {result ? (
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
            ? `${values.length} values → ${rowCount} points · plot as XY: column 1 = X, "ordered" as points, "Reference line" as a line. Points hug the line when the data are ${variant === "lognormal" ? "log-normal (chart the value axis on a log scale)" : "normal"}.`
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
