/**
 * One editing session = one in-memory `MadyDocument`. Every mutation runs through
 * the same `executeAgentCommand` path the desktop agent bridge uses (undoable,
 * validated, guarded) — there is deliberately no second mutation path. `compute_analysis`
 * builds its engine payload with the same `buildAnalysisData` the app uses, so the
 * numbers are identical.
 */
import { readFile } from "node:fs/promises";
import { assertAnalysisResult } from "@mady/contracts";
import { atomicWrite } from "../../node-io/atomicWrite.mjs";
import { basename } from "node:path";
import {
  type AnalysisParams,
  type AnalysisResult,
  type Project,
  buildAnalysisData,
  executeAgentBatch,
  executeAgentCommand,
  MadyDocument,
  migrate,
  parseLinkedText,
  tableDatasets,
} from "@mady/core";
import { buildPlotScene, describeScene, splitPins } from "@mady/graphics";
import { checkAnalysisParams, checkCommandContent, seriesIdProblem } from "./inputCheck.js";
import { EngineClient, type EngineClientOptions, resolveEngine } from "./engineClient.js";

export interface ComputeRequest {
  /** Compute (and store the result on) an already-configured analysis by id … */
  analysisId?: string;
  /** … or compute an ad-hoc analysis without storing it (all three required). */
  method?: string;
  table?: string;
  params?: AnalysisParams;
}

export interface ComputeResult {
  ok: boolean;
  analysisId?: string;
  method?: string;
  results?: Record<string, unknown>;
  stored?: boolean;
  code?: string;
  error?: string;
}

/** Injectable so tests can supply a fake engine instead of spawning Python. */
export interface SessionOptions {
  engine?: { request(method: string, data?: Record<string, unknown>): Promise<Record<string, unknown>> };
  engineOptions?: EngineClientOptions;
}

export class MadySession {
  private doc = new MadyDocument();
  private engine: SessionOptions["engine"] | null;
  private ownedEngine: EngineClient | null = null;
  private readonly engineOptions: EngineClientOptions | undefined;
  path: string | undefined;

  constructor(opts: SessionOptions = {}) {
    this.engine = opts.engine ?? null;
    this.engineOptions = opts.engineOptions;
  }

  /** The live document (tests + tools read it). */
  get document(): MadyDocument {
    return this.doc;
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────

  newProject(): { ok: true } {
    this.doc = new MadyDocument();
    this.path = undefined;
    return { ok: true };
  }

  async openProject(path: string): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
    try {
      const text = await readFile(path, "utf8");
      const project = migrate(JSON.parse(text) as Record<string, unknown>);
      this.doc = new MadyDocument(project);
      // Record what each small graph was made from now, so a later change made directly on one is refused in words
      // rather than overwritten by the first sync without a record to compare against.
      this.doc.syncSplitCopies((src, table) => splitPins(table, src));
      this.path = path;
      return { ok: true, path };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async saveProject(path?: string): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
    const target = path ?? this.path;
    if (!target) return { ok: false, error: "no path given and this session has no open project path" };
    try {
      await atomicWrite(target, JSON.stringify(this.doc.toJSON()), { allowCopyFallback: false });
      this.path = target;
      return { ok: true, path: target };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * Build one graph's scene and report what actually reached the drawing.
   *
   * Every other tool here is write-only from the agent's point of view: it can set an option but
   * cannot learn whether the option landed, what the axes became, or that the builder refused
   * something. `describeScene` answers that. It is read-only
   * and calls the same `buildPlotScene` the app's panes call, so a description can never
   * disagree with the picture a user would see.
   *
   * The project's tables and gradients are passed through exactly as the live pane passes them,
   * so a graph borrowing series from another datasheet (`plot.overlays`) and a custom colour
   * ramp both resolve here instead of silently falling back.
   */
  describeGraph(id: string, size?: { width?: number; height?: number }): Record<string, unknown> {
    const project: Project = this.doc.toJSON();
    const plot = project.plots.find((p) => p.id === id);
    if (!plot) return { ok: false, code: "not_found", error: `no graph with id '${id}'` };
    const table = project.tables.find((t) => t.id === plot.source);
    if (!table) {
      return { ok: false, code: "not_found", error: `graph '${id}' points at table '${plot.source}', which is not in this project` };
    }
    const description = describeScene(table, plot, {
      width: size?.width ?? 640,
      height: size?.height ?? 440,
      tables: (tid) => project.tables.find((t) => t.id === tid),
      gradients: (gid) => project.gradients?.find((g) => g.id === gid),
    });
    return { ok: true, id, name: plot.name, table: { id: table.id, name: table.name }, ...description };
  }

  /**
   * Read a delimited text file from disk and file it as a table.
   *
   * Reuses `parseLinkedText` — the same parser the app uses when it re-reads a linked file,
   * so a CSV imported here gets the delimiter detection, header inference, decimal-comma
   * handling, NA tokens and date/duration typing the desktop import gives it. Writing a second
   * parser here would drift from the app within a release.
   *
   * No second mutation path: the parsed grid is filed through `createTable`, the ordinary
   * validated agent command, not by touching the document directly.
   */
  async importCsv(
    path: string,
    opts: { name?: string; delimiter?: string; header?: boolean; skipRows?: number; transpose?: boolean } = {},
  ): Promise<Record<string, unknown>> {
    let text: string;
    try {
      text = await readFile(path, "utf8");
    } catch (e) {
      return { ok: false, code: "not_found", error: e instanceof Error ? e.message : String(e) };
    }
    const parsed = parseLinkedText(text, {
      ...(opts.delimiter !== undefined ? { delimiter: opts.delimiter } : {}),
      ...(opts.header !== undefined ? { header: opts.header } : {}),
      ...(opts.skipRows !== undefined ? { skipRows: opts.skipRows } : {}),
      ...(opts.transpose !== undefined ? { transpose: opts.transpose } : {}),
    });
    if (parsed.columnNames.length === 0) {
      return { ok: false, code: "bad_request", error: `nothing tabular was found in '${path}'` };
    }
    // Fall back to the file's own name so an agent that omits `name` still gets a labelled sheet.
    const name = opts.name ?? basename(path).replace(/\.[^.]+$/, "") ?? "Imported";
    const result = this.exec({ op: "createTable", name, columns: parsed.columnNames, rows: parsed.rows, ...(parsed.columnTypes ? { columnTypes: parsed.columnTypes.map((t) => t ?? null) } : {}) });
    if (!result.ok) return result as unknown as Record<string, unknown>;
    return {
      ok: true,
      id: (result.value as { id: string }).id,
      name,
      columns: parsed.columnNames,
      rows: parsed.rows.length,
    };
  }

  summary(): Record<string, unknown> {
    const p: Project = this.doc.toJSON();
    return {
      path: this.path ?? null,
      // Column {id,name} is included so an agent can target columns in run_analysis /
      // compute_analysis params (which key off column ids) without a second round-trip.
      tables: p.tables.map((t) => ({
        id: t.id,
        name: t.name,
        kind: t.kind,
        rows: t.rows.length,
        columns: t.columns.map((c) => ({ id: c.id, name: c.name })),
      })),
      graphs: p.plots.map((g) => ({ id: g.id, name: g.name, kind: g.kind ?? "xy" })),
      analyses: p.analyses.map((a) => ({ id: a.id, name: a.name, method: a.method, status: a.status, hasResult: a.result != null })),
    };
  }

  // ── mutation / query (the validated agent path) ─────────────────────────────

  /**
   * What is wrong with one command's content, in words. Options, values and colours are checked against the catalogue and
   * the enumerations (`checkCommandContent`); a series style also needs a series the graph has. Empty when it is fine.
   */
  private problemsWith(command: unknown, withProject: boolean): string[] {
    const problems = checkCommandContent(command, (graph, annotation) =>
      this.doc.toJSON().plots.find((p) => p.id === graph)?.annotations?.find((a) => a.id === annotation)?.kind);
    if (withProject && typeof command === "object" && command !== null && (command as { op?: unknown }).op === "setSeriesStyle") {
      const c = command as { id?: unknown; series?: unknown };
      const project: Project = this.doc.toJSON();
      const plot = project.plots.find((p) => p.id === c.id);
      const table = plot && project.tables.find((t) => t.id === plot.source);
      if (plot && table && typeof c.series === "string") {
        const known = [...new Set([...tableDatasets(table).map((d) => d.id), ...buildPlotScene(table, plot, {}).series.map((s) => s.id)])];
        const bad = seriesIdProblem(c.series, known);
        if (bad) problems.push(bad);
      }
    }
    return problems;
  }

  exec(command: unknown): ReturnType<typeof executeAgentCommand> {
    const problems = this.problemsWith(command, true);
    if (problems.length > 0) return { ok: false, code: "bad_request", error: `${problems.join(" ")} Nothing was changed.` };
    const result = executeAgentCommand(this.doc, command);
    const refused = this.afterEdit();
    if (result.ok && refused.length > 0) return { ok: false, code: "bad_request", error: refused.join(" ") };
    return result;
  }

  /**
   * What the app does after every edit, in the same order: recompute the tables derived from an edited one, re-make
   * the small graphs from their originals, then re-derive each graph's "Out of date" flag (a graph drawn from its table
   * is current once the edit lands; one drawn from an analysis result stays out of date until that result is
   * refreshed). Returns the refusals of the small-graph sync: a change made directly on a small graph, which is undone.
   */
  private afterEdit(): string[] {
    this.doc.recomputeStaleDerived();
    const refused = this.doc.syncSplitCopies((src, table) => splitPins(table, src));
    this.doc.refreshPlotStatus();
    return refused;
  }

  /** Every command is checked before the first runs: a batch with one bad value changes nothing. */
  execBatch(commands: readonly unknown[]): ReturnType<typeof executeAgentBatch> {
    for (const [i, c] of commands.entries()) {
      const problems = this.problemsWith(c, false);
      if (problems.length > 0) return [{ ok: false, code: "bad_request", error: `Command ${i + 1} of ${commands.length}: ${problems.join(" ")} Nothing was run.` }];
    }
    const results = executeAgentBatch(this.doc, commands);
    const refused = this.afterEdit();
    return refused.length > 0 ? [...results, { ok: false, code: "bad_request", error: refused.join(" ") }] : results;
  }

  // ── engine-backed compute ───────────────────────────────────────────────────

  private ensureEngine(): NonNullable<SessionOptions["engine"]> {
    if (this.engine) return this.engine;
    this.ownedEngine = new EngineClient(this.engineOptions ?? resolveEngine());
    this.engine = this.ownedEngine;
    return this.engine;
  }

  /**
   * Compute an analysis in the stats engine and (for a stored analysis) attach the
   * result to the document. Resolves either a configured analysis by id, or an
   * ad-hoc method+table+params. Failures are returned as typed values, not thrown.
   */
  async compute(req: ComputeRequest): Promise<ComputeResult> {
    const doc = this.doc;
    const project = doc.toJSON();
    let method: string;
    let params: AnalysisParams;
    let tableId: string;

    if (req.analysisId) {
      const a = project.analyses.find((x) => x.id === req.analysisId);
      if (!a) return { ok: false, code: "not_found", error: `no analysis with id '${req.analysisId}'` };
      method = a.method;
      params = a.params;
      tableId = a.source;
    } else if (req.method && req.table && req.params) {
      const problems = checkAnalysisParams(req.params as unknown as Record<string, unknown>);
      if (problems.length > 0) return { ok: false, code: "bad_request", error: `${problems.join(" ")} Nothing was computed.` };
      method = req.method;
      params = req.params;
      tableId = req.table;
    } else {
      return {
        ok: false,
        code: "bad_request",
        error: "compute needs either 'analysisId', or all of 'method', 'table', and 'params'",
      };
    }

    const table = project.tables.find((t) => t.id === tableId);
    if (!table) return { ok: false, code: "not_found", error: `no table with id '${tableId}'` };
    // Every method reads its data from `params.columns`; a call without it would reach the payload
    // builder and fail there with a bare type error, so it is refused here in words that say what to send.
    if (!Array.isArray((params as { columns?: unknown } | undefined)?.columns)) {
      return {
        ok: false,
        code: "bad_request",
        error: "params.columns must list the ids of the columns to analyse (list_tables shows each table's column ids)",
        ...(req.analysisId ? { analysisId: req.analysisId } : {}),
      };
    }

    const run = req.analysisId ? doc.beginAnalysisRun(req.analysisId) : undefined;
    const data = run?.data ?? buildAnalysisData(method, params, table);
    let results: Record<string, unknown>;
    try {
      results = await this.ensureEngine().request(method, data);
      assertAnalysisResult(results, method);
    } catch (e) {
      const code = (e as { code?: string }).code ?? "engine_internal";
      const error = e instanceof Error ? e.message : String(e);
      if (run && this.doc === doc && doc.completeAnalysisRun(run, { error })) doc.refreshPlotStatus();
      return { ok: false, code, error, ...(req.analysisId ? { analysisId: req.analysisId } : {}) };
    }

    let stored = false;
    if (run) {
      if (this.doc !== doc || !doc.completeAnalysisRun(run, { result: results as unknown as AnalysisResult })) {
        return { ok: false, code: "stale_result", error: "The analysis or its data changed while computing. Run it again.", analysisId: run.analysisId };
      }
      doc.refreshPlotStatus();
      stored = true;
    }
    return {
      ok: true,
      method,
      results,
      stored,
      ...(req.analysisId ? { analysisId: req.analysisId } : {}),
    };
  }

  async close(): Promise<void> {
    if (this.ownedEngine) await this.ownedEngine.stop();
  }
}
