/**
 * Reactive derived tables — live data manipulation. A *derived* `DataTable` carries a `TableDerivation` (source + op
 * + serialisable spec); when its source changes the document marks it `stale`
 * (`markDependentsStale`) and regenerates it from the source's current values,
 * exactly the way analyses/plots already recompute. Transform/Reshape/… results
 * stay live this way — and, because the document model is one reactive DAG,
 * derived-of-derived chains cascade.
 *
 * Pure + DOM-free: this module only turns a source grid + a derivation into a new
 * grid; the `MadyDocument` materialises rows/columns and owns the stale edges.
 */
import { effectiveValue } from "./cells";
import { histogram, histogramTable, histogramTableMulti, exactCumulativeTable } from "./histogram";
import { simulate } from "./simulate";
import type { DataTable, TableDerivation } from "./model";
import { longToWide, wideToLong, type NamedTable } from "./reshape";
import { columnNumbers, normalProbabilityPlot, lognormalProbabilityPlot, qqTable, type PlotPosition } from "./qqplot";
import { applyTransform, type TransformSpec } from "./transform";
import { rowStatistics, pruneRows, removeBaseline, columnMath, transposeTable, extractColumns, splitTextColumn } from "./dataprocess";

/** A `DataTable` → the column-named grid the transform/reshape engines consume. */
export function tableToNamedTable(table: DataTable): NamedTable {
  return {
    columnNames: table.columns.map((c) => c.name),
    // Read through effectiveValue so excluded cells drop out (→ null) of every
    // transform / derived table, exactly as they drop out of analyses.
    rows: table.rows.map((r) => table.columns.map((c) => effectiveValue(table, r, c))),
  };
}

/**
 * Recompute a derived table's grid from its source grid + derivation. Pure — the
 * caller materialises the result into a `DataTable`. Throws on an unknown `op`
 * (so a future-version file with a derivation we don't understand fails loudly
 * rather than silently producing wrong data).
 */
export function recomputeDerived(derivation: TableDerivation, source: NamedTable): NamedTable {
  switch (derivation.op) {
    case "transform":
      // `spec` is stored as plain JSON; `fn` widens to string. `applyTransform`
      // validates it and throws on an unknown function id.
      return applyTransform(source, derivation.spec as TransformSpec);
    case "reshape": {
      const s = derivation.spec;
      if (s.mode === "wide-to-long") {
        return wideToLong(source, {
          idColumns: s.idColumns,
          valueColumns: s.valueColumns ?? [],
          keyName: s.keyName ?? "variable",
          valueName: s.valueName ?? "value",
          dropEmpty: s.dropEmpty ?? false,
        });
      }
      return longToWide(source, {
        idColumns: s.idColumns,
        keyColumn: s.keyColumn ?? -1,
        valueColumn: s.valueColumn ?? -1,
      });
    }
    case "frequency": {
      const s = derivation.spec;
      // Multi-column (per-subcolumn) frequency: bin every chosen column on a shared
      // grid → one Count column each (binned modes only; count-per-column output).
      if (s.cols && s.cols.length >= 2 && s.mode !== "exact") {
        const bw0 = s.binWidth ?? 1;
        const optsM =
          s.mode === "width" ? { binWidth: bw0 > 0 ? bw0 : 1 } : s.mode === "count" ? { bins: Math.max(1, s.bins ?? 10) } : {};
        return histogramTableMulti(
          s.cols.map((c) => ({ label: source.columnNames[c] ?? `Col ${c + 1}`, values: columnNumbers(source.rows, c) })),
          optsM,
        );
      }
      const values = columnNumbers(source.rows, s.col);
      const label = source.columnNames[s.col] ?? "Value";
      const cumulativeFromTop = s.cumulativeFromTop ?? false;
      if (s.mode === "exact") {
        // Unbinned empirical CDF — no bin-width choice needed.
        return exactCumulativeTable(values, label, { fromTop: cumulativeFromTop });
      }
      const bw = s.binWidth ?? 1;
      const opts =
        s.mode === "width"
          ? { binWidth: bw > 0 ? bw : 1, cumulativeFromTop }
          : s.mode === "count"
            ? { bins: Math.max(1, s.bins ?? 10), cumulativeFromTop }
            : { cumulativeFromTop };
      return histogramTable(histogram(values, opts), label, s.fractions ?? false, s.gaussian ? values : undefined);
    }
    case "qq": {
      const s = derivation.spec;
      const values = columnNumbers(source.rows, s.col);
      const label = source.columnNames[s.col] ?? "Value";
      const res =
        s.variant === "lognormal"
          ? lognormalProbabilityPlot(values, s.position as PlotPosition)
          : normalProbabilityPlot(values, s.position as PlotPosition);
      return qqTable(res, label);
    }
    case "simulate":
      // A seeded simulation — no source is read; the grid is generated from the spec.
      return simulate(derivation.spec);
    case "rowstats":
      return rowStatistics(source, derivation.spec);
    case "prune":
      return pruneRows(source, derivation.spec);
    case "colmath": {
      const s = derivation.spec;
      return s.mode === "baseline" ? removeBaseline(source, s) : columnMath(source, s);
    }
    case "transpose":
      return transposeTable(source, derivation.spec);
    case "extract":
      return extractColumns(source, derivation.spec);
    case "split":
      return splitTextColumn(source, derivation.spec);
    default: {
      const op = (derivation as TableDerivation).op;
      throw new Error(`Unknown derivation op: ${op}`);
    }
  }
}

/**
 * Map every source-column index a derivation carries through `map`.
 *
 * Note: derivation specs address their source columns by numeric index, so without a remap any
 * structural change to the source silently re-points them: inserting a column ahead of the
 * referenced one turns a `log10` of Y into a `log10` of X, and the derived table keeps its name
 * while showing a different computation — with every graph and analysis downstream of it wrong.
 * Callers remap through here as part of the same undoable command as the structural edit.
 *
 * Every op's index fields are enumerated below on purpose: the switch is exhaustive over `op`,
 * so a new op cannot be added without deciding what happens to its indices.
 *
 * `map` returns the new index, or null when that column is gone. List entries are then dropped,
 * optional scalars are omitted (falling back to the op's own default), and required scalars
 * become -1 — an out-of-range index, which `recomputeDerived` renders as an empty result rather
 * than silently computing some other column. Failing visibly beats failing plausibly.
 */
export function remapDerivationColumns(
  d: TableDerivation,
  map: (index: number) => number | null,
): TableDerivation {
  const req = (i: number): number => map(i) ?? -1;
  const list = (xs: number[]): number[] => xs.map((i) => map(i)).filter((i): i is number => i != null);
  /** `{ key: mapped }`, or `{}` when the column was deleted. Every optional index field is
   *  destructured out of the spec before this is spread back in — spreading `...spec` first
   *  would keep the stale key, so an omission would never actually omit. */
  const optNum = (key: string, i: number | undefined): Record<string, number> => {
    if (i == null) return {};
    const m = map(i);
    return m == null ? {} : { [key]: m };
  };
  const optList = (key: string, xs: number[] | undefined): Record<string, number[]> =>
    xs == null ? {} : { [key]: list(xs) };

  switch (d.op) {
    case "transform": {
      const { columns, xColumn, swapXY, ...rest } = d.spec;
      return {
        ...d,
        spec: {
          ...rest,
          columns: list(columns),
          ...optNum("xColumn", xColumn),
          ...(swapXY ? { swapXY: { xCol: req(swapXY.xCol), yCol: req(swapXY.yCol) } } : {}),
        },
      };
    }
    case "reshape": {
      const { idColumns, valueColumns, keyColumn, valueColumn, ...rest } = d.spec;
      return {
        ...d,
        spec: {
          ...rest,
          idColumns: list(idColumns),
          ...optList("valueColumns", valueColumns),
          ...optNum("keyColumn", keyColumn),
          ...optNum("valueColumn", valueColumn),
        },
      };
    }
    case "frequency": {
      const { col, cols, ...rest } = d.spec;
      return { ...d, spec: { ...rest, col: req(col), ...optList("cols", cols) } };
    }
    case "qq":
      return { ...d, spec: { ...d.spec, col: req(d.spec.col) } };
    case "rowstats": {
      const { dataColumns, keepColumns, ...rest } = d.spec;
      return { ...d, spec: { ...rest, dataColumns: list(dataColumns), ...optList("keepColumns", keepColumns) } };
    }
    case "prune": {
      const { col, ...rest } = d.spec;
      return { ...d, spec: { ...rest, ...optNum("col", col) } };
    }
    case "colmath": {
      if (d.spec.mode === "baseline") {
        const { dataColumns, keepColumns, baselineCol, ...rest } = d.spec;
        return {
          ...d,
          spec: {
            ...rest,
            dataColumns: list(dataColumns),
            ...optList("keepColumns", keepColumns),
            ...optNum("baselineCol", baselineCol),
          },
        };
      }
      const { a, b, keepColumns, ...rest } = d.spec;
      return { ...d, spec: { ...rest, a: req(a), b: req(b), ...optList("keepColumns", keepColumns) } };
    }
    case "transpose": {
      const { labelCol, ...rest } = d.spec;
      return { ...d, spec: { ...rest, ...optNum("labelCol", labelCol) } };
    }
    case "extract":
      return { ...d, spec: { ...d.spec, columns: list(d.spec.columns) } };
    case "split":
      return { ...d, spec: { ...d.spec, col: req(d.spec.col) } };
    // A simulation has no real source (its `source` is a sentinel) — no indices to remap.
    case "simulate":
      return d;
    default: {
      const never: never = d;
      return never;
    }
  }
}
