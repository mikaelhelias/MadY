/**
 * Residual-diagnostic data — the four standard model-checking graphs built from an
 * analysis's fitted values ŷ + raw residuals (regression / curve-fit / ANOVA / t).
 * Pure (no document): each returned table is `{columns, rows}`; the caller turns it
 * into a graph. Kept here (not in the renderer) so the math is unit-tested.
 *
 *  1. residualVsPredicted — residual vs ŷ + a flat zero baseline (linearity /
 *     homoscedasticity: random scatter = good, funnel = unequal variance).
 *  2. qq — normal-probability plot of the residuals (normality).
 *  3. histogram — the residual distribution's shape (null when no bins).
 *  4. scaleLocation — √|standardised residual| vs ŷ (non-constant variance);
 *     null for the degenerate case (zero residual spread or a constant ŷ axis).
 */
import { histogram } from "./histogram";
import { normalProbabilityPlot, qqTable } from "./qqplot";

export interface DiagTable {
  columns: string[];
  rows: number[][];
}

export interface ResidualDiagnostics {
  /** Number of finite (ŷ, residual) points used. */
  n: number;
  residualVsPredicted: DiagTable;
  qq: DiagTable;
  histogram: DiagTable | null;
  scaleLocation: DiagTable | null;
}

/**
 * Build the four residual-diagnostic tables from `fitted` (ŷ) + `resid`. Pairs are
 * matched by index, non-finite pairs dropped, then sorted by ŷ so the zero baseline
 * draws as a flat line. Returns null when fewer than 3 finite paired points remain.
 */
export function residualDiagnostics(
  fitted: readonly number[],
  resid: readonly number[],
): ResidualDiagnostics | null {
  const pts = fitted
    .map((f, i) => [f, resid[i] as number] as [number, number])
    .filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))
    .sort((a, b) => a[0] - b[0]);
  if (pts.length < 3) return null;

  const residVals = pts.map((p) => p[1]);
  const mean = residVals.reduce((s, v) => s + v, 0) / residVals.length;
  const sd = Math.sqrt(
    residVals.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, residVals.length - 1),
  );
  // Distinct ŷ at 1e-9 resolution — a single fitted value makes the predicted axis
  // (and so the scale-location plot) degenerate.
  const distinctFitted = new Set(pts.map((p) => Math.round(p[0] * 1e9))).size;

  const qt = qqTable(normalProbabilityPlot(residVals, "blom"), "Residual");
  const bins = histogram(residVals, {});
  const round6 = (v: number): number => Math.round(v * 1e6) / 1e6;

  return {
    n: pts.length,
    residualVsPredicted: {
      columns: ["Predicted", "Residual", "Zero baseline"],
      rows: pts.map(([f, r]) => [f, r, 0]),
    },
    // qqTable rows are numeric (z, ordered value, reference) though typed CellValue[][].
    qq: { columns: qt.columnNames, rows: qt.rows as number[][] },
    histogram:
      bins.length > 0
        ? { columns: ["Residual", "Count"], rows: bins.map((b) => [round6(b.center), b.count]) }
        : null,
    scaleLocation:
      sd > 0 && distinctFitted >= 2
        ? {
            columns: ["Predicted", "√|standardised residual|"],
            rows: pts.map(([f, r]) => [f, Math.sqrt(Math.abs(r / sd))]),
          }
        : null,
  };
}
