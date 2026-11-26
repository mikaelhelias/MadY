import { useMemo, useState } from "react";
import { longToWide, wideToLong } from "@mady/core";
import type { CellValue, DataTable, TableKind } from "@mady/core";
import { tableToGrid } from "./exporters";
import { GuideHelp } from "./guideLink";

/** What the dialog returns on confirm — a ready-to-`deriveTable` payload. */
export interface ReshapeResult {
  name: string;
  columnNames: string[];
  rows: CellValue[][];
  /** The derivation spec — lets the commit create a *reactive* derived table. */
  spec: {
    mode: "wide-to-long" | "long-to-wide";
    idColumns: number[];
    valueColumns?: number[];
    keyName?: string;
    valueName?: string;
    dropEmpty?: boolean;
    keyColumn?: number;
    valueColumn?: number;
    /** long-to-wide: the format the pivoted result should adopt (default grouped). */
    resultKind?: TableKind;
  };
  /** Source table id the reshape was computed from. */
  sourceId: string;
}

/** Formats a long→wide pivot can land as — most tidy datasets pivot to a two-factor Grouped
 *  table (id rows × key-value groups); the others cover the one-factor / regression / multivariate
 *  cases. Kept short on purpose — the exotic formats (survival, contingency…) are not pivot targets. */
const RESHAPE_RESULT_FORMATS: ReadonlyArray<{ value: TableKind; label: string }> = [
  { value: "grouped", label: "Grouped (two factors)" },
  { value: "column", label: "Column (one factor)" },
  { value: "xy", label: "XY" },
  { value: "multivariable", label: "Multiple variables" },
];

type Mode = "wide-to-long" | "long-to-wide";
type Role = "id" | "value" | "key" | "ignore";

const PREVIEW_ROWS = 8;

/** Per-column role choices for each direction. */
const ROLE_OPTIONS: Record<Mode, ReadonlyArray<{ value: Role; label: string }>> = {
  "wide-to-long": [
    { value: "id", label: "Keep (id)" },
    { value: "value", label: "Unpivot (value)" },
    { value: "ignore", label: "Ignore" },
  ],
  "long-to-wide": [
    { value: "id", label: "Keep (id)" },
    { value: "key", label: "New headers (key)" },
    { value: "value", label: "Cell values (value)" },
    { value: "ignore", label: "Ignore" },
  ],
};

/** Sensible starting roles: col 0 is an id; melt unpivots the rest, pivot maps
 * cols 1/2 to key/value (mirrors melt's `id, variable, value` output order). */
function defaultRoles(mode: Mode, n: number): Role[] {
  if (mode === "wide-to-long") {
    return Array.from({ length: n }, (_, i) => (i === 0 ? "id" : "value"));
  }
  return Array.from({ length: n }, (_, i) =>
    i === 0 ? "id" : i === 1 ? "key" : i === 2 ? "value" : "ignore",
  );
}

/**
 * ReshapeDialog — wide ↔ long reshape. Assign each
 * column a role, preview the result live, and commit it as a new dataset. The
 * transform itself is the pure `@mady/core` melt/pivot; this is just the role
 * picker + preview.
 */
export function ReshapeDialog({
  table,
  docVersion,
  onConfirm,
  onCancel,
}: {
  table: DataTable;
  /** The document's edit counter: a linked-file refresh rewrites `table` in place, so the preview keys on this too. */
  docVersion?: number | undefined;
  onConfirm: (result: ReshapeResult) => void;
  onCancel: () => void;
}) {
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `docVersion` is the edit signal (the rows change in place)
  const grid = useMemo(() => tableToGrid(table), [table, docVersion]);
  const n = grid.columnNames.length;
  const [mode, setMode] = useState<Mode>("wide-to-long");
  const [roles, setRoles] = useState<Role[]>(() => defaultRoles("wide-to-long", n));
  const [keyName, setKeyName] = useState("variable");
  const [valueName, setValueName] = useState("value");
  const [dropEmpty, setDropEmpty] = useState(false);
  // The format the pivoted (long→wide) result adopts, so tidy data reaches the right analyses.
  const [resultKind, setResultKind] = useState<TableKind>("grouped");

  function changeMode(m: Mode): void {
    setMode(m);
    setRoles(defaultRoles(m, n));
  }

  // key/value are singletons in long-to-wide: assigning one clears any other.
  function setRole(index: number, role: Role): void {
    setRoles((prev) => {
      const next = [...prev];
      if (mode === "long-to-wide" && (role === "key" || role === "value")) {
        for (let i = 0; i < next.length; i++) if (next[i] === role) next[i] = "ignore";
      }
      next[index] = role;
      return next;
    });
  }

  const { result, problem } = useMemo<{ result: ReshapeResult | null; problem?: string }>(() => {
    const idColumns = roles.flatMap((r, i) => (r === "id" ? [i] : []));
    if (mode === "wide-to-long") {
      const valueColumns = roles.flatMap((r, i) => (r === "value" ? [i] : []));
      if (valueColumns.length === 0) return { result: null, problem: "Choose at least one value column to unpivot." };
      const spec = {
        mode: "wide-to-long" as const,
        idColumns,
        valueColumns,
        keyName: keyName.trim() || "variable",
        valueName: valueName.trim() || "value",
        dropEmpty,
      };
      const out = wideToLong(grid, spec);
      return { result: { name: `${table.name} (long)`, spec, sourceId: table.id, ...out } };
    }
    const keyColumn = roles.indexOf("key");
    const valueColumn = roles.indexOf("value");
    if (keyColumn < 0 || valueColumn < 0) return { result: null, problem: "Choose one key column and one value column." };
    const spec = { mode: "long-to-wide" as const, idColumns, keyColumn, valueColumn, resultKind };
    const out = longToWide(grid, spec);
    return { result: { name: `${table.name} (wide)`, spec, sourceId: table.id, ...out } };
  }, [mode, roles, grid, keyName, valueName, dropEmpty, resultKind, table.name, table.id]);

  const rowCount = result?.rows.length ?? 0;
  const colCount = result?.columnNames.length ?? 0;
  const preview = result?.rows.slice(0, PREVIEW_ROWS) ?? [];

  return (
    <div className="modalov" onClick={onCancel}>
      <div
        className="modal modal-wide"
        role="dialog"
        aria-label="Reshape data"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modalh-row">
          <h3 className="modalh">Reshape “{table.name}”</h3>
          <GuideHelp target={{ entry: "action:reshape" }} what="Reshape data" />
        </div>

        <div className="importopts">
          <label>
            Direction{" "}
            <select
              aria-label="Direction"
              value={mode}
              onChange={(e) => changeMode(e.target.value as Mode)}
            >
              <option value="wide-to-long">Wide → long (unpivot / melt)</option>
              <option value="long-to-wide">Long → wide (pivot / spread)</option>
            </select>
          </label>
          {mode === "wide-to-long" ? (
            <>
              <label>
                Key column name{" "}
                <input
                  aria-label="Key column name"
                  value={keyName}
                  onChange={(e) => setKeyName(e.target.value)}
                />
              </label>
              <label>
                Value column name{" "}
                <input
                  aria-label="Value column name"
                  value={valueName}
                  onChange={(e) => setValueName(e.target.value)}
                />
              </label>
              <label className="importchk">
                <input
                  type="checkbox"
                  checked={dropEmpty}
                  onChange={(e) => setDropEmpty(e.target.checked)}
                />
                Drop blank values
              </label>
            </>
          ) : (
            <label>
              Result format{" "}
              <select
                aria-label="Result format"
                value={resultKind}
                onChange={(e) => setResultKind(e.target.value as TableKind)}
              >
                {RESHAPE_RESULT_FORMATS.map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            </label>
          )}
        </div>

        <div className="reshaperoles">
          {grid.columnNames.map((name, i) => (
            <label key={i} className="reshaperole">
              <span className="reshapecol">{name}</span>
              <select
                aria-label={`Role for ${name}`}
                value={roles[i]}
                onChange={(e) => setRole(i, e.target.value as Role)}
              >
                {ROLE_OPTIONS[mode].map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>

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
                      <td key={c}>{cell == null ? "" : String(cell)}</td>
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
