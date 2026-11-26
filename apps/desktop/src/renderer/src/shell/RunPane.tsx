/**
 * One tab for one run of several analyses (a curve fit of several series, one fit each): the statistics side by
 * side, one column per series, then each series' own results sheet below, foldable.
 */
import type React from "react";
import { useState } from "react";
import type { NodeId, Project } from "@mady/core";
import { fmtCell } from "./panes";
import { runComparison, runComparisonTsv, runTitle } from "./runResults";

export function RunPane({
  project,
  run,
  resultDigits,
  renderSeries,
  onRerun,
  onExport,
}: {
  project: Project;
  run: NodeId;
  /** Settings ▸ "Round results tables": significant figures for the on-screen table; unset/0 = full precision. */
  resultDigits?: number | undefined;
  /** One series' own results sheet, with every action it has on its own tab. */
  renderSeries: (analysisId: NodeId) => React.ReactNode;
  onRerun: (analysisId: NodeId) => void;
  onExport?: ((run: NodeId, format: "csv" | "xlsx") => void) | undefined;
}) {
  const [showAll, setShowAll] = useState(false);
  const [copied, setCopied] = useState(false);
  const [folded, setFolded] = useState<ReadonlySet<NodeId>>(new Set());
  const c = runComparison(project, run);
  if (!c) return <p className="note">The analyses of this run are no longer in the project.</p>;
  const title = runTitle(project, run);
  const rows = showAll ? c.rows : c.rows.filter((r) => r.primary);
  const hidden = c.rows.length - c.rows.filter((r) => r.primary).length;
  const cell = (t: (typeof c.rows)[number]["cells"][number]): string => {
    if (!t) return "—";
    const est = fmtCell("estimate", t.estimate, resultDigits);
    return typeof t.se === "number" ? `${est} ± ${fmtCell("se", t.se, resultDigits)}` : est;
  };
  const copy = (): void => {
    void navigator.clipboard.writeText(runComparisonTsv(title, c)).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };
  const toggle = (id: NodeId): void => {
    const next = new Set(folded);
    if (next.has(id)) next.delete(id); else next.add(id);
    setFolded(next);
  };
  return (
    <div className="runpane">
      <div className="runhead">
        <h2 className="runtitle">{title}</h2>
        <div className="antoolbar runactions" role="toolbar" aria-label="Run actions">
          <button type="button" className="antb antb-primary" title="Re-run every series on the current data" onClick={() => c.columns.forEach((col) => onRerun(col.analysisId))}>Re-run all</button>
          <button type="button" className="antb" title="Copy the side-by-side table" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
          {onExport && <button type="button" className="antb" title="Save the side-by-side table as CSV" onClick={() => onExport(run, "csv")}>CSV</button>}
          {onExport && <button type="button" className="antb" title="Save the side-by-side table as an Excel sheet" onClick={() => onExport(run, "xlsx")}>Excel</button>}
        </div>
      </div>
      <h3 className="runsub">Side by side</h3>
      <div className="runtablewrap">
        <table className="tidytable runtable" aria-label="Results side by side">
          <thead>
            <tr>
              <th />
              {c.columns.map((col) => (
                <th key={col.analysisId} scope="col">
                  <span className="runswatch" style={{ background: col.color }} aria-hidden />
                  {col.series}
                  {col.status !== "ok" && <span className="warn runstatus">{col.status === "error" ? " (failed)" : " (not run)"}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.term}>
                <th scope="row" className="tidyterm">{r.term}</th>
                {r.cells.map((t, i) => <td key={c.columns[i]!.analysisId} className="tidynum">{cell(t)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hidden > 0 && (
        <button type="button" className="tidymore" aria-expanded={showAll} onClick={() => setShowAll(!showAll)}>
          {showAll ? "Show key results only" : `Show ${hidden} more — assumption checks and secondary estimates`}
        </button>
      )}
      {c.columns.map((col) => {
        const open = !folded.has(col.analysisId);
        return (
          <section key={col.analysisId} className="runseries" aria-label={`Results for ${col.series}`}>
            <button type="button" className="runserieshead" aria-expanded={open} onClick={() => toggle(col.analysisId)}>
              <span className="runchev" aria-hidden>{open ? "▾" : "▸"}</span>
              <span className="runswatch" style={{ background: col.color }} aria-hidden />
              {col.series}
            </button>
            {open && <div className="runseriesbody">{renderSeries(col.analysisId)}</div>}
          </section>
        );
      })}
    </div>
  );
}
