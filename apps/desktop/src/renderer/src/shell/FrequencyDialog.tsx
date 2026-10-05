import { useMemo, useState } from "react";
import { histogram, histogramTable, histogramTableMulti, exactCumulativeTable } from "@mady/core";
import type { CellValue, DataTable } from "@mady/core";
import { tableToGrid } from "./exporters";
import { GuideHelp } from "./guideLink";

/** What the dialog returns on confirm — a ready-to-`deriveTable` payload. */
export interface FrequencyResult {
  name: string;
  columnNames: string[];
  rows: CellValue[][];
  /** The derivation spec — lets the commit create a *reactive* derived table. */
  spec: {
    col: number;
    cols?: number[];
    mode: "auto" | "count" | "width" | "exact";
    bins?: number;
    binWidth?: number;
    cumulativeFromTop?: boolean;
    fractions?: boolean;
    gaussian?: boolean;
  };
  /** Source table id the histogram was computed from. */
  sourceId: string;
}

const PREVIEW_ROWS = 10;

/** Finite numeric cells of one grid column. */
function columnNumbers(rows: CellValue[][], col: number): number[] {
  const out: number[] = [];
  for (const row of rows) {
    const v = row[col];
    const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

/** Tidy number for the preview. */
function fmt(v: CellValue): string {
  if (v == null) return "";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e4) / 1e4);
  return String(v);
}

/**
 * FrequencyDialog — the "Frequency distribution": bin a chosen
 * column into a histogram table (count / relative % / cumulative), committed as a
 * new dataset you then plot as bars or a cumulative line. The binning is the pure
 * `@mady/core` `histogram`; this is the column + bin-control picker + preview.
 */
export function FrequencyDialog({
  table,
  docVersion,
  onConfirm,
  onCancel,
}: {
  table: DataTable;
  /** The document's edit counter: a linked-file refresh rewrites `table` in place, so the preview keys on this too. */
  docVersion?: number | undefined;
  onConfirm: (result: FrequencyResult) => void;
  onCancel: () => void;
}) {
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `docVersion` is the edit signal (the rows change in place)
  const grid = useMemo(() => tableToGrid(table), [table, docVersion]);
  // Default to the first column that looks numeric (skip an obvious X/label col 0 if others exist).
  const numericCols = useMemo(
    () => grid.columnNames.map((_, i) => i).filter((i) => columnNumbers(grid.rows, i).length > 0),
    [grid],
  );
  const [col, setCol] = useState<number>(() => numericCols[numericCols.length - 1] ?? 0);
  const [mode, setMode] = useState<"auto" | "count" | "width" | "exact">("auto");
  const [bins, setBins] = useState(10);
  const [binWidth, setBinWidth] = useState(1);
  const [cumTop, setCumTop] = useState(false);
  const [fractions, setFractions] = useState(false);
  const [gaussian, setGaussian] = useState(false);
  // Additional columns to bin on the same grid (per-subcolumn frequency). Binned modes only.
  const [extraCols, setExtraCols] = useState<Set<number>>(() => new Set());
  const multi = mode !== "exact" && extraCols.size > 0;
  const cols = useMemo(() => [...new Set([col, ...extraCols])].sort((a, b) => a - b), [col, extraCols]);

  const values = useMemo(() => columnNumbers(grid.rows, col), [grid, col]);

  const { result, problem } = useMemo<{ result: FrequencyResult | null; problem?: string }>(() => {
    const binOpts =
      mode === "width"
        ? { binWidth: binWidth > 0 ? binWidth : 1, cumulativeFromTop: cumTop }
        : mode === "count"
          ? { bins: Math.max(1, bins), cumulativeFromTop: cumTop }
          : { cumulativeFromTop: cumTop };
    const specBase = { col, mode, bins: Math.max(1, bins), binWidth: binWidth > 0 ? binWidth : 1, cumulativeFromTop: cumTop, fractions, gaussian };
    // Per-subcolumn: several columns binned on one shared grid → a Count column each.
    if (multi) {
      const chosen = cols.map((c) => ({ label: grid.columnNames[c] ?? `Col ${c + 1}`, values: columnNumbers(grid.rows, c) }));
      if (chosen.every((c) => c.values.length === 0)) return { result: null, problem: "The chosen columns have no numeric values to bin." };
      const out = histogramTableMulti(chosen, binOpts);
      return { result: { name: `${table.name} — frequency (${cols.length} columns)`, spec: { ...specBase, cols }, sourceId: table.id, ...out } };
    }
    if (values.length === 0) return { result: null, problem: "That column has no numeric values to bin." };
    const label = grid.columnNames[col] ?? "Value";
    const out =
      mode === "exact"
        ? exactCumulativeTable(values, label, { fromTop: cumTop })
        : histogramTable(histogram(values, binOpts), label, fractions, gaussian ? values : undefined);
    return { result: { name: `${table.name} — frequency of ${label}`, spec: specBase, sourceId: table.id, ...out } };
  }, [values, mode, bins, binWidth, cumTop, fractions, gaussian, grid, col, cols, multi, table.name, table.id]);

  const rowCount = result?.rows.length ?? 0;
  const preview = result?.rows.slice(0, PREVIEW_ROWS) ?? [];

  return (
    <div className="modalov" onClick={onCancel}>
      <div className="modal modal-wide" role="dialog" aria-label="Frequency distribution" onClick={(e) => e.stopPropagation()}>
        <div className="modalh-row">
          <h3 className="modalh">Frequency distribution — “{table.name}”</h3>
          <GuideHelp target={{ entry: "action:frequency" }} what="Frequency distribution" />
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
          {mode !== "exact" && numericCols.filter((i) => i !== col).length > 0 && (
            <label title="Also bin these columns on the same grid — one Count column each (per-subcolumn frequency, ready to overlay as bars).">
              + columns{" "}
              <span style={{ display: "inline-flex", gap: 8, flexWrap: "wrap" }}>
                {numericCols
                  .filter((i) => i !== col)
                  .map((i) => (
                    <label key={i} style={{ fontWeight: 400, fontSize: 11, display: "inline-flex", gap: 3, alignItems: "center" }}>
                      <input
                        type="checkbox"
                        aria-label={`Also bin ${grid.columnNames[i]}`}
                        checked={extraCols.has(i)}
                        onChange={() =>
                          setExtraCols((prev) => {
                            const next = new Set(prev);
                            next.has(i) ? next.delete(i) : next.add(i);
                            return next;
                          })
                        }
                      />
                      {grid.columnNames[i]}
                    </label>
                  ))}
              </span>
            </label>
          )}
          <label>
            Bins{" "}
            <select aria-label="Bin mode" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
              <option value="auto">Automatic (√n)</option>
              <option value="count">Number of bins…</option>
              <option value="width">Bin width…</option>
              <option value="exact">Exact (unbinned) cumulative</option>
            </select>
          </label>
          {mode === "count" && (
            <label>
              Count{" "}
              <input
                aria-label="Number of bins"
                type="number"
                min={1}
                value={bins}
                onChange={(e) => setBins(Math.max(1, Number(e.target.value) || 1))}
                style={{ width: 70 }}
              />
            </label>
          )}
          {mode === "width" && (
            <label>
              Width{" "}
              <input
                aria-label="Bin width"
                type="number"
                min={0}
                step="any"
                value={binWidth}
                onChange={(e) => setBinWidth(Number(e.target.value) || 0)}
                style={{ width: 70 }}
              />
            </label>
          )}
          <label className="importchk">
            <input type="checkbox" checked={cumTop} onChange={(e) => setCumTop(e.target.checked)} />
            Cumulate from the top
          </label>
          {mode !== "exact" && (
            <label className="importchk">
              <input type="checkbox" checked={fractions} onChange={(e) => setFractions(e.target.checked)} />
              Show fractions
            </label>
          )}
          {mode !== "exact" && (
            <label className="importchk" title="Append the expected frequencies under a Gaussian with the data's mean & SD — overlay it as a line on the bars.">
              <input type="checkbox" checked={gaussian} onChange={(e) => setGaussian(e.target.checked)} />
              Gaussian overlay
            </label>
          )}
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
            ? multi
              ? `${cols.length} columns → ${rowCount} shared bin${rowCount === 1 ? "" : "s"}${
                  rowCount > PREVIEW_ROWS ? ` · showing first ${PREVIEW_ROWS}` : ""
                } · one Count column each — plot as grouped / overlaid bars (Gaussian / fractions apply to single-column only)`
              : `${values.length} values → ${rowCount} bin${rowCount === 1 ? "" : "s"}${
                  rowCount > PREVIEW_ROWS ? ` · showing first ${PREVIEW_ROWS}` : ""
                } · plot Count (or Relative %) as bars, or Cumulative % as a line${
                  gaussian ? " · overlay Expected count/% as a line for the fitted Gaussian" : ""
                }`
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
