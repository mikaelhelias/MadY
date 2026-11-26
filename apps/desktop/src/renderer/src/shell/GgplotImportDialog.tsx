/**
 * Import a ggplot script — the report, then the datasheet, then the graph.
 *
 * A script almost never carries its data; it points at a set and carries the design. So this
 * dialog shows, before anything is created: what MadY will draw, every call marked honoured /
 * approximated / refused with the reason (`translateGgplot`), and which columns the script's
 * aesthetics need. The user picks the datasheet that holds those columns (or imports it first);
 * `bindGgplot` reshapes it into the wide table MadY draws, and "Create graph" is enabled only
 * when every named column is matched. Nothing is guessed, nothing is silent.
 */
import { useMemo, useState } from "react";
import type { DataTable, GgplotBinding, GgplotReportRow, GgplotTranslation, Plot, SeriesStyle } from "@mady/core";
import { bindGgplot, translateGgplot } from "@mady/core";
import { GuideHelp } from "./guideLink";

export interface GgplotImportSource {
  name: string;
  text: string;
  path?: string | undefined;
}

export interface GgplotImportResult {
  /** The wide datasheet to adopt (local ids — the document re-ids it). */
  table: DataTable;
  /** Plot options from the script (no column ids inside). */
  plot: Partial<Plot>;
  kind: NonNullable<Plot["kind"]>;
  /** Per-series look, keyed by the built table's column name. */
  seriesStylesByName: Record<string, SeriesStyle>;
  /** The preset the theme mapped to; applied first, the script's own styles after. */
  preset: string | null;
  name: string;
  /** The full report, for the project log. */
  report: GgplotReportRow[];
  sourceTableName: string;
}

const KIND_LABEL: Record<string, string> = {
  xy: "XY graph", bar: "bar chart", box: "box & whisker", violin: "violin", scatter: "column scatter",
  histogram: "histogram", heatmap: "heatmap",
};

const VERDICT: Record<GgplotReportRow["verdict"], { label: string; bg: string; fg: string }> = {
  honoured: { label: "honoured", bg: "#e6f4ea", fg: "#1e6b34" },
  approximated: { label: "approximated", bg: "#fff4d6", fg: "#7a5200" },
  refused: { label: "refused", bg: "#fde8e8", fg: "#9b1c1c" },
};

/** Score a datasheet by how many of the script's columns it has — the default pick. */
function matchScore(t: GgplotTranslation, table: DataTable): number {
  return bindGgplot(t, table).ok ? 2 : Object.keys(bindGgplot(t, table).matched).length > 0 ? 1 : 0;
}

export function GgplotImportDialog({
  src,
  tables,
  onConfirm,
  onCancel,
  onImportData,
}: {
  src: GgplotImportSource;
  tables: readonly DataTable[];
  onConfirm: (result: GgplotImportResult) => void;
  onCancel: () => void;
  /** Open the data importer first (the script's data is not in the project yet). */
  onImportData?: (() => void) | undefined;
}) {
  const translation = useMemo(() => translateGgplot(src.text), [src.text]);
  const best = useMemo(() => {
    let pick: DataTable | undefined;
    let score = -1;
    for (const t of tables) { const s = matchScore(translation, t); if (s > score) { score = s; pick = t; } }
    return pick?.id ?? null;
  }, [translation, tables]);
  const [tableId, setTableId] = useState<string | null>(best);
  const table = tables.find((t) => t.id === tableId) ?? null;
  const binding: GgplotBinding | null = useMemo(() => (table ? bindGgplot(translation, table) : null), [translation, table]);
  const [showScript, setShowScript] = useState(false);

  const counts = { honoured: 0, approximated: 0, refused: 0 };
  for (const r of translation.report) counts[r.verdict]++;
  const needed = [translation.aes.x, translation.aes.y, translation.aes.group, translation.aes.err, translation.aes.lower, translation.aes.upper, translation.aes.fill, translation.aes.sortBy].filter((c): c is string => !!c);
  const canCreate = translation.ok && !!binding?.ok && !!table;

  const create = (): void => {
    if (!canCreate || !binding?.table || !translation.kind || !table) return;
    onConfirm({
      table: binding.table,
      plot: translation.plot,
      kind: translation.kind,
      seriesStylesByName: binding.seriesStylesByName,
      preset: translation.preset,
      name: translation.name,
      report: [...translation.report, ...binding.notes],
      sourceTableName: table.name,
    });
  };

  const badge = (v: GgplotReportRow["verdict"]) => (
    <span style={{ background: VERDICT[v].bg, color: VERDICT[v].fg, borderRadius: 4, padding: "1px 6px", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" }}>
      {VERDICT[v].label}
    </span>
  );

  return (
    <div className="modalov" onClick={onCancel}>
      <div className="modal modal-wide" role="dialog" aria-label="Import a ggplot script" onClick={(e) => e.stopPropagation()} style={{ maxHeight: "90vh", display: "flex", flexDirection: "column" }}>
        <div className="modalh-row">
          <h3 className="modalh">Import ggplot script — {src.name}</h3>
          <GuideHelp target={{ entry: "action:import-ggplot" }} what="Import a ggplot script" />
        </div>
        <div style={{ overflow: "auto", flex: 1, minHeight: 0 }}>
          {/* What MadY will draw */}
          <p className="note" style={{ margin: "4px 0 8px" }}>
            {translation.ok && translation.kind
              ? <>MadY will draw a <b>{KIND_LABEL[translation.kind] ?? translation.kind}</b>{translation.preset ? <> in the <b>{translation.preset}</b> look (the script's theme)</> : null}. {counts.honoured} honoured · {counts.approximated} approximated · {counts.refused} refused.</>
              : <b>This script has no geom MadY can draw — see the report.</b>}
          </p>

          {/* The report */}
          <table className="ggreport" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }} aria-label="Import report">
            <thead>
              <tr style={{ textAlign: "left", color: "var(--muted)" }}><th style={{ padding: "2px 6px" }}>Script</th><th style={{ padding: "2px 6px" }}>Verdict</th><th style={{ padding: "2px 6px" }}>MadY</th></tr>
            </thead>
            <tbody>
              {translation.report.map((r, i) => (
                <tr key={i} style={{ borderTop: "1px solid var(--line)" }}>
                  <td style={{ padding: "3px 6px", fontFamily: "ui-monospace, Consolas, monospace", whiteSpace: "nowrap" }}>{r.call}</td>
                  <td style={{ padding: "3px 6px" }}>{badge(r.verdict)}</td>
                  <td style={{ padding: "3px 6px" }}>{r.note}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* The data */}
          <h4 style={{ margin: "12px 0 4px" }}>Data</h4>
          {translation.data.notes.length > 0 && (
            <ul className="note" style={{ margin: "0 0 6px 18px" }}>
              {translation.data.notes.map((n, i) => <li key={i}>{n}</li>)}
            </ul>
          )}
          <p className="note" style={{ margin: "0 0 6px" }}>
            The script names {translation.data.name ? <>the dataset <b>{translation.data.name}</b></> : "no dataset"}; it needs the column{needed.length === 1 ? "" : "s"} <b>{needed.join(", ")}</b>. Pick the datasheet that holds them:
          </p>
          <label className="frow">
            <span>Datasheet</span>
            <select className="selin" aria-label="Datasheet" value={tableId ?? ""} onChange={(e) => setTableId(e.target.value || null)}>
              <option value="">— choose —</option>
              {tables.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            {onImportData && (
              <button type="button" className="btn-ghost" onClick={onImportData} style={{ marginLeft: 8 }}>Import the data file first…</button>
            )}
          </label>
          {table && binding && (
            <div style={{ margin: "6px 0" }}>
              {needed.map((c) => {
                const hit = binding.matched[c];
                return (
                  <div key={c} style={{ fontSize: 12 }}>
                    {hit ? <span style={{ color: VERDICT.honoured.fg }}>✓</span> : <span style={{ color: VERDICT.refused.fg }}>✗</span>}{" "}
                    <span style={{ fontFamily: "ui-monospace, Consolas, monospace" }}>{c}</span>
                    {hit ? <> → <b>{hit}</b></> : <> — not in “{table.name}”</>}
                  </div>
                );
              })}
              {binding.ok && binding.notes.map((n, i) => (
                <div key={i} style={{ fontSize: 12, marginTop: 4 }}>{badge(n.verdict)} {n.note}</div>
              ))}
              {!binding.ok && binding.missing.length > 0 && (
                <p className="hint" style={{ margin: "4px 0" }}>Rename the datasheet's columns to match, or pick another datasheet. Nothing is guessed.</p>
              )}
            </div>
          )}

          <button type="button" className="btn-ghost" onClick={() => setShowScript((s) => !s)} style={{ marginTop: 8 }}>
            {showScript ? "Hide the script" : "Show the script"}
          </button>
          {showScript && (
            <pre style={{ fontSize: 11, maxHeight: 200, overflow: "auto", background: "var(--bg-2)", padding: 8, borderRadius: 4 }}>{src.text}</pre>
          )}
        </div>
        <div className="modalbtns">
          <button className="btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn" disabled={!canCreate} onClick={create} title={canCreate ? "Build the datasheet and the graph" : "Pick a datasheet that has every column the script names"}>
            Create graph
          </button>
        </div>
      </div>
    </div>
  );
}
