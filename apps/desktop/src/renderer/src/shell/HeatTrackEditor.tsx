/**
 * Annotation strips — the bands beside a heatmap that say what each row or column is.
 *
 * The two axes are edited differently because their data lives in different places, and one editor
 * for both would show wrong values on one of them:
 *  • a row strip picks a column of the sheet — the values are already there, one per row;
 *  • a column strip has nowhere in the sheet to read from (a table has no per-column field), so
 *    it carries its own value for each column, typed here.
 *
 * Colours are automatic — one hue per distinct value, or a ramp when the values are numbers —
 * and each value can be given its own colour, which is what a figure needs when "Treated" has to
 * be red in every panel of a paper.
 */
import type { ReactNode } from "react";
import type { Column, DataTable, GradRamp, HeatTrack } from "@mady/core";
import { ColorInput } from "./SchemaForm";

/** Distinct values a track will show, in first-seen order (what the colour list keys off). */
function distinctValues(track: HeatTrack, axis: "row" | "col", table: DataTable, cols: { id: string; name: string }[]): string[] {
  const raw = axis === "row"
    ? table.rows.map((r) => (track.column ? String(r.cells[track.column] ?? "") : ""))
    : cols.map((c) => track.values?.[c.id] ?? "");
  const out: string[] = [];
  for (const v of raw) if (v !== "" && !out.includes(v)) out.push(v);
  return out;
}

export function HeatTrackEditor(props: {
  axis: "row" | "col";
  table: DataTable;
  /** The matrix's columns (datasets) — what a column strip needs a value for. */
  columns: { id: string; name: string }[];
  /** Sheet columns a row strip can read. */
  sheetColumns: Column[];
  tracks: readonly HeatTrack[];
  /** The strip the user clicked on the graph — its block is marked and scrolled to. */
  selectedIndex?: number | undefined;
  /** The ramps a numeric strip can shade through (the program's own list). */
  ramps: ReadonlyArray<readonly [string, string]>;
  onChange: (next: HeatTrack[]) => void;
}): ReactNode {
  const { axis, table, columns, sheetColumns, tracks } = props;
  const noun = axis === "row" ? "row" : "column";
  const list = [...tracks];
  const set = (i: number, patch: Partial<HeatTrack>): void =>
    props.onChange(list.map((t, k) => (k === i ? { ...t, ...patch } : t)));

  return (
    <>
      <div className="frow splitadd">
        <span>{axis === "row" ? "Row strips" : "Column strips"}</span>
        <button
          type="button" className="btn-mini" aria-label={`Add a ${noun} strip`}
          title={axis === "row"
            ? "Add a strip beside the rows, coloured by a column of the sheet"
            : "Add a strip above the columns, with a value you give each column"}
          onClick={() => props.onChange([...list, axis === "row" ? { column: sheetColumns[0]?.id } : { values: {} }])}
        >
          + Add
        </button>
      </div>
      {list.length === 0 && (
        <p className="hint">
          {axis === "row"
            ? "No strips. Add one to show what each row is — treatment, cluster, responder."
            : "No strips. Add one to group the columns — timepoint, batch, condition."}
        </p>
      )}
      {list.map((t, i) => {
        const values = distinctValues(t, axis, table, columns);
        const isSel = props.selectedIndex === i;
        const numeric = values.length > 0 && values.every((v) => Number.isFinite(Number(v)));
        const readsAsRamp = (t.scale ?? "auto") === "value" || ((t.scale ?? "auto") === "auto" && numeric);
        return (
          <div
            className={"trackblock" + (isSel ? " on" : "")}
            key={`${axis}-${i}`}
            data-track-row={`${axis}-${i}`}
            ref={isSel ? (el) => el?.scrollIntoView?.({ block: "nearest" }) : undefined}
          >
            <div className="splitrow">
              <input
                type="text" className="numin splitlab" aria-label={`${noun} strip ${i + 1} name`}
                placeholder="name" value={t.name ?? ""}
                onChange={(e) => set(i, { name: e.target.value || undefined })}
              />
              {axis === "row" ? (
                <select
                  className="selin" aria-label={`${noun} strip ${i + 1} column`}
                  value={t.column ?? ""}
                  onChange={(e) => set(i, { column: e.target.value || undefined })}
                >
                  <option value="">Pick a column…</option>
                  {sheetColumns.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              ) : (
                <span className="hint" style={{ margin: 0 }}>values below</span>
              )}
              <label className="splitcell" title="Strip thickness in pixels.">
                <span>size</span>
                <input
                  type="number" className="numin splitnum" min={2} max={60} step={1}
                  aria-label={`${noun} strip ${i + 1} size`}
                  placeholder="16" value={t.size ?? ""}
                  onChange={(e) => set(i, { size: e.target.value === "" ? undefined : Number(e.target.value) })}
                />
              </label>
              <button
                type="button" className="swbtn" aria-label={`Remove ${noun} strip ${i + 1}`}
                title="Remove this strip" onClick={() => props.onChange(list.filter((_t, k) => k !== i))}
              >
                −
              </button>
            </div>
            <div className="splitrow">
              <label className="splitcell" title="How the values are read: numbers shade through a ramp, anything else takes one colour per value. Force it either way when the automatic reading is wrong.">
                <span>read as</span>
                <select
                  className="selin" aria-label={`${noun} strip ${i + 1} reading`}
                  value={t.scale ?? "auto"}
                  onChange={(e) => set(i, { scale: e.target.value as HeatTrack["scale"] })}
                >
                  <option value="auto">Automatic</option>
                  <option value="category">Colour per value</option>
                  <option value="value">Ramp (numbers)</option>
                </select>
              </label>
              {readsAsRamp && (
                <label className="splitcell" title="Which ramp a numeric strip shades through.">
                  <span>ramp</span>
                  <select
                    className="selin" aria-label={`${noun} strip ${i + 1} ramp`}
                    value={t.ramp ?? "blues"}
                    onChange={(e) => set(i, { ramp: e.target.value as GradRamp })}
                  >
                    {props.ramps.map(([v, l]) => (
                      <option key={v} value={v}>{l}</option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            {axis === "col" && (
              <details className="grad-paste">
                <summary>Value per column</summary>
                {columns.map((c) => (
                  <label className="frow" key={c.id}>
                    <span>{c.name}</span>
                    <input
                      type="text" className="numin splitlab"
                      aria-label={`${noun} strip ${i + 1} value for ${c.name}`}
                      value={t.values?.[c.id] ?? ""}
                      onChange={(e) => {
                        const next = { ...(t.values ?? {}) };
                        if (e.target.value) next[c.id] = e.target.value;
                        else delete next[c.id];
                        set(i, { values: next });
                      }}
                    />
                  </label>
                ))}
              </details>
            )}
            {values.length > 0 && (
              <details className="grad-paste">
                <summary>Colours ({values.length})</summary>
                {values.map((v) => (
                  <label className="frow" key={v}>
                    <span>{v}</span>
                    <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <ColorInput
                        className="colorin" aria-label={`${noun} strip ${i + 1} colour for ${v}`}
                        value={t.colors?.[v] ?? "#888888"}
                        onChange={(c) => set(i, { colors: { ...(t.colors ?? {}), [v]: c } })}
                      />
                      <button
                        type="button" className="swbtn"
                        aria-label={`Automatic colour for ${v} on ${noun} strip ${i + 1}`}
                        title="Back to the automatic colour"
                        onClick={() => {
                          const next = { ...(t.colors ?? {}) };
                          delete next[v];
                          set(i, { colors: Object.keys(next).length ? next : undefined });
                        }}
                      >
                        ⨯
                      </button>
                    </span>
                  </label>
                ))}
              </details>
            )}
          </div>
        );
      })}
    </>
  );
}
