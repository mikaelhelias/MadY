/**
 * The results of one run of several analyses (a curve fit of several series, one fit each), side by side:
 * one column per series, one row per statistic. Any number of series.
 */
import { tableDatasets } from "@mady/core";
import type { Analysis, NodeId, Project, TidyTerm } from "@mady/core";
import { seriesColor, xyFamilyDatasets } from "@mady/graphics";
import { csvField } from "./analysisExport";
import type { ResultGrid } from "./analysisExport";
import { splitTerms } from "./analysisEmphasis";

/** The analyses of a run, in the project's order. */
export function runAnalyses(project: Pick<Project, "analyses">, run: NodeId): Analysis[] {
  return project.analyses.filter((a) => a.run === run);
}

/** One series of the run. */
export interface RunColumn {
  analysisId: NodeId;
  /** The series fitted: its column's name on the sheet. */
  series: string;
  /** The colour its curve is drawn in on a graph, else its series colour. */
  color: string;
  status: Analysis["status"];
  error?: string | undefined;
}

/** One statistic across the run: its row in each series' results (undefined where that series has none). */
export interface RunRow {
  term: string;
  cells: (TidyTerm | undefined)[];
  /** False for an assumption check or secondary estimate, which the table folds away by default. */
  primary: boolean;
}

export interface RunComparison {
  columns: RunColumn[];
  rows: RunRow[];
  /** The run's method and source sheet, from its first analysis. */
  method: string;
  source: NodeId;
}

/** The side-by-side table of a run. Rows follow the order each statistic first appears in. */
export function runComparison(project: Pick<Project, "analyses" | "tables" | "plots">, run: NodeId): RunComparison | undefined {
  const members = runAnalyses(project, run);
  const first = members[0];
  if (!first) return undefined;
  const table = project.tables.find((t) => t.id === first.source);
  const datasets = table ? tableDatasets(table) : [];
  // Colour slots count the series a graph draws: a column of names takes none.
  const drawnSeries = table ? xyFamilyDatasets(table) : [];
  const columns: RunColumn[] = members.map((a) => {
    const y = a.params.columns?.[1];
    const index = datasets.findIndex((d) => d.id === y);
    const slot = drawnSeries.findIndex((d) => d.id === y);
    const name = index >= 0 ? datasets[index]!.name : table?.columns.find((c) => c.id === y)?.name ?? a.name;
    // The colour its curve wears on a graph drawing this analysis, so the column reads as that curve.
    const drawn = project.plots.flatMap((p) => [p.fit, ...(p.fits ?? [])]).find((f) => f?.analysisSource === a.id && f.color)?.color;
    return { analysisId: a.id, series: name, color: drawn ?? seriesColor(slot >= 0 ? slot : 0), status: a.status, ...(a.error ? { error: a.error } : {}) };
  });
  const order: string[] = [];
  const primary = new Set<string>();
  const byTerm = members.map((a) => {
    const terms = a.result?.terms ?? [];
    const split = splitTerms(a.method, terms);
    for (const t of split.primary) primary.add(t.term);
    for (const t of terms) if (!order.includes(t.term)) order.push(t.term);
    return new Map(terms.map((t) => [t.term, t] as const));
  });
  const rows = order.map((term) => ({ term, cells: byTerm.map((m) => m.get(term)), primary: primary.has(term) }));
  return { columns, rows, method: first.method, source: first.source };
}

/** The table for export: a row per statistic, and per series its estimate and its SE (numbers stay numbers). */
export function runComparisonGrid(c: RunComparison): ResultGrid {
  const withSe = c.columns.map((_, i) => c.rows.some((r) => typeof r.cells[i]?.se === "number"));
  const columns = ["Statistic", ...c.columns.flatMap((col, i) => (withSe[i] ? [col.series, `${col.series} SE`] : [col.series]))];
  const value = (v: TidyTerm["estimate"]): string | number | null => (v === undefined || v === null ? null : v);
  const rows = c.rows.map((r) => [r.term, ...r.cells.flatMap((t, i) => (withSe[i] ? [value(t?.estimate), t?.se ?? null] : [value(t?.estimate)]))]);
  return { columns, rows };
}

/** CSV of the side-by-side table, under a title line. */
export function runComparisonCsv(title: string, c: RunComparison): string {
  const grid = runComparisonGrid(c);
  return `${csvField(title)}\r\n\r\n${[grid.columns, ...grid.rows].map((row) => row.map(csvField).join(",")).join("\r\n")}`;
}

/** Tab-separated side-by-side table for the clipboard (pastes as a table into Excel, Sheets or Word). */
export function runComparisonTsv(title: string, c: RunComparison): string {
  const grid = runComparisonGrid(c);
  return `${title}\n\n${[grid.columns, ...grid.rows].map((row) => row.map((v) => (v == null ? "" : String(v))).join("\t")).join("\n")}`;
}

/** The run's title: its method's name and how many series it fitted, e.g. "Dose-response 4PL — 3 series vs Concentration (µM)". */
export function runTitle(project: Pick<Project, "analyses" | "tables">, run: NodeId): string {
  const members = runAnalyses(project, run);
  const first = members[0];
  if (!first) return "Analysis run";
  // The first analysis's name reads "<method> — <series> vs <X>": keep the method and the X, count the series.
  const m = /^(.*?) — .* vs (.*)$/.exec(first.name);
  return m ? `${m[1]} — ${members.length} series vs ${m[2]}` : `${first.name} and ${members.length - 1} more`;
}
