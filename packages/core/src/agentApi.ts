/**
 * Typed agent API — a small, serializable command vocabulary that drives a
 * `MadyDocument` the same way the UI does, so a script (or a natural-language
 * layer) can build and query graphs headlessly.
 *
 * The whole design rests on one property: **every command dispatches to an existing
 * `MadyDocument` method, which is already command-stack-wrapped and validated.** The
 * agent path is therefore exactly as safe as the UI path — it cannot corrupt state in
 * ways a user couldn't already, it is undoable, and it reuses every guard the document
 * methods enforce (`requireTable`/`requirePlot`/… throw on a missing target). This module
 * adds only: a closed, discriminated command set; runtime validation (the in-app bridge
 * receives untyped JSON from the page, so TypeScript alone is not enough); and a
 * confirm-gate on destructive operations.
 *
 * This module is UI-independent and lives in `@mady/core`, so it is fully headless-
 * testable. It is exposed elsewhere: as `window.madyAgent` in the agent build
 * (`agentBridge.ts`, behind the compile-time `__AGENT_API__` flag) and through the MCP
 * server (`packages/mcp-server`). This file is just the engine.
 */
import type { MadyDocument } from "./document";
import { STYLE_PRESETS } from "./presets";
import type {
  AnalysisParams, AxisSpec, CellValue, ColumnType, NodeId, Plot, PlotKind, SeriesStyle, TableKind,
} from "./model";

/** The column types `setColumnType` accepts. Validated at runtime: the bridge takes untyped JSON. */
export const COLUMN_TYPES: ReadonlySet<string> = new Set(["number", "text", "date", "elapsed", "categorical"]);

/** The text elements `setFont` can target (model.ts `FontElement`). */
export const FONT_ELEMENTS: ReadonlySet<string> = new Set([
  "title", "subtitle", "axisTitle", "tick", "legend", "sliceLabel", "valueLabel",
]);

/** The result of running one command. Never throws to the caller — failures are values. */
export type AgentResult<T = unknown> =
  | { ok: true; value: T }
  | { ok: false; code: AgentErrorCode; error: string };

export type AgentErrorCode =
  | "unknown_op"
  | "bad_request"
  | "not_found"
  | "confirm_required"
  | "internal";

/** Which axis a `setAxis` command targets. */
type AxisName = "x" | "y" | "y2" | "y3";

/**
 * The closed command set. Discriminated by `op`. Read ops are always safe; mutation ops
 * are undoable; destructive ops additionally require `confirm: true` (chosen product
 * behaviour — the agent may do anything, but a delete/overwrite must be explicit).
 */
export type AgentCommand =
  // ── read / query (no mutation) ──
  | { op: "listTables" }
  | { op: "listGraphs" }
  | { op: "listAnalyses" }
  | { op: "getGraph"; id: NodeId }
  | { op: "getAnalysis"; id: NodeId }
  /**
   * The one way to reach row ids: `listTables` gives counts and `project_summary` gives
   * column ids, but nothing else exposes a row id — and `setCell` below needs one.
   * Paged, because a real datasheet is longer than a reply.
   */
  | { op: "getTable"; id: NodeId; limit?: number; offset?: number }
  // ── create / mutate (undoable) ──
  | { op: "createTable"; name: string; kind?: TableKind; columns: string[]; rows: CellValue[][] }
  | { op: "createGraph"; name: string; table: NodeId; kind?: PlotKind }
  | { op: "setGraphKind"; id: NodeId; kind: PlotKind }
  | { op: "setGraphOptions"; id: NodeId; patch: Partial<Plot> }
  | { op: "setAxis"; id: NodeId; axis: AxisName; patch: Partial<AxisSpec> }
  | { op: "setSeriesStyle"; id: NodeId; series: NodeId; style: SeriesStyle }
  | { op: "runAnalysis"; name: string; method: string; table: NodeId; params: AnalysisParams }
  // ── editing the data itself (undoable) ──
  | { op: "setCell"; table: NodeId; row: NodeId; column: NodeId; value: CellValue }
  | { op: "addRow"; table: NodeId; values: CellValue[] }
  | { op: "addColumn"; table: NodeId; name?: string }
  | { op: "renameColumn"; table: NodeId; column: NodeId; name: string }
  | { op: "setColumnType"; table: NodeId; column: NodeId; type: ColumnType }
  | { op: "sortRows"; table: NodeId; column: NodeId; direction: "asc" | "desc" }
  | { op: "setCellsExcluded"; table: NodeId; cells: { row: NodeId; column: NodeId }[]; excluded: boolean }
  // ── things ON the graph: labels, brackets, significance, fitted curves ──
  | { op: "addAnnotation"; id: NodeId; annotation: Record<string, unknown> }
  | { op: "updateAnnotation"; id: NodeId; annotation: NodeId; patch: Record<string, unknown> }
  | { op: "removeAnnotation"; id: NodeId; annotation: NodeId }
  | { op: "setSignificance"; id: NodeId; patch: Record<string, unknown> }
  | { op: "setFit"; id: NodeId; fit: Record<string, unknown> | null }
  | { op: "setFits"; id: NodeId; fits: Record<string, unknown>[] | null }
  // ── how the graph looks, as named operations rather than a raw option patch ──
  | { op: "applyStylePreset"; id: NodeId; preset: string }
  | { op: "setFont"; id: NodeId; element: string; patch: Record<string, unknown> }
  | { op: "setLegend"; id: NodeId; patch: Record<string, unknown> }
  | { op: "setGrid"; id: NodeId; patch: Record<string, unknown> }
  | { op: "setFrame"; id: NodeId; patch: Record<string, unknown> }
  // ── multi-panel figures ──
  | { op: "listFigures" }
  | { op: "createFigure"; name: string }
  | { op: "addFigurePanel"; figure: NodeId; graph: NodeId }
  | { op: "setFigureOptions"; figure: NodeId; patch: Record<string, unknown> }
  // ── project structure ──
  | { op: "addFolder"; name: string }
  | { op: "addExperiment"; folder: NodeId; name: string }
  | { op: "renameFolder"; folder: NodeId; name: string }
  | { op: "renameExperiment"; folder: NodeId; experiment: NodeId; name: string }
  // ── destructive (require confirm: true) ──
  | { op: "deleteGraph"; id: NodeId; confirm: boolean }
  | { op: "deleteTable"; id: NodeId; confirm: boolean }
  | { op: "deleteAnalysis"; id: NodeId; confirm: boolean }
  /**
   * Deleting a row or a column destroys the user's data, so both are confirm-gated like the
   * document-level deletes. Addressed by ID, not by the position the document methods take:
   * every other op names its target by id, and a positional argument silently hits the wrong
   * row the moment a sort has reordered the sheet.
   */
  | { op: "deleteRow"; table: NodeId; row: NodeId; confirm: boolean }
  | { op: "deleteColumn"; table: NodeId; column: NodeId; confirm: boolean };

export type AgentOp = AgentCommand["op"];

/** Ops that change the document (everything but the read/query ops). */
const MUTATING_OPS: ReadonlySet<AgentOp> = new Set<AgentOp>([
  "createTable", "createGraph", "setGraphKind", "setGraphOptions", "setAxis",
  "setSeriesStyle", "runAnalysis", "deleteGraph", "deleteTable", "deleteAnalysis",
  "setCell", "addRow", "addColumn", "renameColumn", "setColumnType", "sortRows",
  "setCellsExcluded", "deleteRow", "deleteColumn",
  "addAnnotation", "updateAnnotation", "removeAnnotation", "setSignificance", "setFit", "setFits",
  "applyStylePreset", "setFont", "setLegend", "setGrid", "setFrame",
  "createFigure", "addFigurePanel", "setFigureOptions",
  "addFolder", "addExperiment", "renameFolder", "renameExperiment",
]);
/** Ops that destroy data — a confirmed flag is required before they run. */
const DESTRUCTIVE_OPS: ReadonlySet<AgentOp> = new Set<AgentOp>([
  "deleteGraph", "deleteTable", "deleteAnalysis", "deleteRow", "deleteColumn",
]);

// ── tiny runtime validators (the bridge hands us untyped JSON) ──────────────────
const ok = <T>(value: T): AgentResult<T> => ({ ok: true, value });
const err = (code: AgentErrorCode, error: string): AgentResult<never> => ({ ok: false, code, error });
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
function reqStr(o: Record<string, unknown>, k: string): string | null {
  const v = o[k];
  return isStr(v) && v.length > 0 ? v : null;
}

/**
 * Run one command against `doc`. Pure dispatch: validate → call a `MadyDocument`
 * method → shape the result. Any exception a document method throws (e.g. a missing
 * target) is caught and returned as a typed failure rather than propagated.
 */
export function executeAgentCommand(doc: MadyDocument, command: unknown): AgentResult {
  if (!isObj(command) || !isStr(command.op)) return err("bad_request", "a command must be an object with a string 'op'");
  const op = command.op as AgentOp;
  const project = doc.toJSON(); // the live, serializable project (not a copy)

  // Destructive ops are gated before any lookup, so an unconfirmed delete never even
  // resolves its target — it fails fast with a clear, actionable message.
  if (DESTRUCTIVE_OPS.has(op) && command.confirm !== true) {
    return err("confirm_required", `${op} is destructive; resend the command with confirm: true`);
  }

  try {
    switch (op) {
      case "listTables":
        return ok(project.tables.map((t) => ({ id: t.id, name: t.name, kind: t.kind, columns: t.columns.length, rows: t.rows.length })));
      case "listGraphs":
        return ok(project.plots.map((p) => ({ id: p.id, name: p.name, kind: p.kind ?? "xy", source: p.source })));
      case "listAnalyses":
        return ok(project.analyses.map((a) => ({ id: a.id, name: a.name, method: a.method, source: a.source, status: a.status })));

      case "getTable": {
        const id = reqStr(command, "id");
        if (!id) return err("bad_request", "getTable needs a string 'id'");
        const t = project.tables.find((x) => x.id === id);
        if (!t) return err("not_found", `no table with id '${id}'`);
        const offset = typeof command.offset === "number" && command.offset > 0 ? Math.floor(command.offset) : 0;
        const limit = typeof command.limit === "number" && command.limit >= 0 ? Math.floor(command.limit) : 200;
        const rows = t.rows.slice(offset, offset + limit);
        return ok({
          id: t.id,
          name: t.name,
          kind: t.kind,
          columns: t.columns.map((c) => ({ id: c.id, name: c.name, type: c.type })),
          // Row ids are the point of this op — `setCell` cannot address a cell without one.
          rows: rows.map((r) => ({ id: r.id, cells: r.cells })),
          rowCount: t.rows.length,
          offset,
          ...(offset + rows.length < t.rows.length ? { truncated: true } : {}),
        });
      }
      case "getGraph": {
        const id = reqStr(command, "id");
        if (!id) return err("bad_request", "getGraph needs a string 'id'");
        const p = project.plots.find((x) => x.id === id);
        return p ? ok(p) : err("not_found", `no graph with id '${id}'`);
      }
      case "getAnalysis": {
        const id = reqStr(command, "id");
        if (!id) return err("bad_request", "getAnalysis needs a string 'id'");
        const a = project.analyses.find((x) => x.id === id);
        if (!a) return err("not_found", `no analysis with id '${id}'`);
        return ok({ id: a.id, name: a.name, method: a.method, status: a.status, error: a.error, result: a.result });
      }

      case "createTable": {
        const name = reqStr(command, "name");
        if (!name) return err("bad_request", "createTable needs a string 'name'");
        if (!Array.isArray(command.columns) || !command.columns.every(isStr)) return err("bad_request", "createTable needs 'columns' as a string array");
        if (!Array.isArray(command.rows) || !command.rows.every((r) => Array.isArray(r))) return err("bad_request", "createTable needs 'rows' as an array of arrays");
        const kind = (isStr(command.kind) ? command.kind : "xy") as TableKind;
        const table = doc.importTable(name, kind, command.columns as string[], command.rows as CellValue[][]);
        return ok({ id: table.id });
      }
      case "createGraph": {
        const name = reqStr(command, "name");
        const table = reqStr(command, "table");
        if (!name || !table) return err("bad_request", "createGraph needs string 'name' and 'table'");
        const plot = doc.addPlot(name, table); // throws if the table is missing → caught below
        if (isStr(command.kind)) doc.setPlotKind(plot.id, command.kind as PlotKind);
        return ok({ id: plot.id });
      }
      case "setGraphKind": {
        const id = reqStr(command, "id");
        if (!id || !isStr(command.kind)) return err("bad_request", "setGraphKind needs string 'id' and 'kind'");
        doc.setPlotKind(id, command.kind as PlotKind);
        return ok({ id });
      }
      case "setGraphOptions": {
        const id = reqStr(command, "id");
        if (!id || !isObj(command.patch)) return err("bad_request", "setGraphOptions needs string 'id' and object 'patch'");
        doc.setPlotOptions(id, command.patch as Partial<Plot>);
        return ok({ id });
      }
      case "setAxis": {
        const id = reqStr(command, "id");
        const axis = command.axis;
        if (!id || (axis !== "x" && axis !== "y" && axis !== "y2" && axis !== "y3")) return err("bad_request", "setAxis needs string 'id' and 'axis' of x|y|y2|y3");
        if (!isObj(command.patch)) return err("bad_request", "setAxis needs an object 'patch'");
        doc.setPlotAxis(id, axis, command.patch as Partial<AxisSpec>);
        return ok({ id });
      }
      case "setSeriesStyle": {
        const id = reqStr(command, "id");
        const series = reqStr(command, "series");
        if (!id || !series || !isObj(command.style)) return err("bad_request", "setSeriesStyle needs string 'id', 'series', and object 'style'");
        doc.setSeriesStyle(id, series, command.style as SeriesStyle);
        return ok({ id });
      }
      case "runAnalysis": {
        const name = reqStr(command, "name");
        const method = reqStr(command, "method");
        const table = reqStr(command, "table");
        if (!name || !method || !table) return err("bad_request", "runAnalysis needs string 'name', 'method', and 'table'");
        if (!isObj(command.params)) return err("bad_request", "runAnalysis needs an object 'params'");
        const a = doc.addAnalysis(name, method, table, command.params as unknown as AnalysisParams);
        return ok({ id: a.id });
      }

      // ── the data itself ────────────────────────────────────────────────────────
      case "setCell": {
        const t = reqStr(command, "table");
        const row = reqStr(command, "row");
        const column = reqStr(command, "column");
        if (!t || !row || !column) return err("bad_request", "setCell needs string 'table', 'row' and 'column'");
        if (!("value" in command)) return err("bad_request", "setCell needs a 'value' (a number, a string, or null to clear)");
        const v = command.value;
        if (v !== null && typeof v !== "number" && typeof v !== "string") {
          return err("bad_request", "setCell 'value' must be a number, a string, or null");
        }
        doc.setCell(t, row, column, v as CellValue);
        return ok({ table: t, row, column });
      }
      case "addRow": {
        const t = reqStr(command, "table");
        if (!t || !Array.isArray(command.values)) return err("bad_request", "addRow needs string 'table' and array 'values'");
        const row = doc.addRow(t, command.values as CellValue[]);
        return ok({ table: t, id: row.id });
      }
      case "addColumn": {
        const t = reqStr(command, "table");
        if (!t) return err("bad_request", "addColumn needs a string 'table'");
        const col = isStr(command.name) ? doc.addColumn(t, command.name) : doc.addColumn(t);
        return ok({ table: t, id: col.id, name: col.name });
      }
      case "renameColumn": {
        const t = reqStr(command, "table");
        const column = reqStr(command, "column");
        const name = reqStr(command, "name");
        if (!t || !column || !name) return err("bad_request", "renameColumn needs string 'table', 'column' and 'name'");
        doc.renameColumn(t, column, name);
        return ok({ table: t, column, name });
      }
      case "setColumnType": {
        const t = reqStr(command, "table");
        const column = reqStr(command, "column");
        const type = reqStr(command, "type");
        if (!t || !column || !type) return err("bad_request", "setColumnType needs string 'table', 'column' and 'type'");
        if (!COLUMN_TYPES.has(type)) {
          return err("bad_request", `setColumnType 'type' must be one of ${[...COLUMN_TYPES].join(", ")}`);
        }
        doc.setColumnType(t, column, type as ColumnType);
        return ok({ table: t, column, type });
      }
      case "sortRows": {
        const t = reqStr(command, "table");
        const column = reqStr(command, "column");
        const direction = command.direction;
        if (!t || !column) return err("bad_request", "sortRows needs string 'table' and 'column'");
        if (direction !== "asc" && direction !== "desc") return err("bad_request", "sortRows 'direction' must be 'asc' or 'desc'");
        doc.sortRowsByColumn(t, column, direction);
        return ok({ table: t, column, direction });
      }
      case "setCellsExcluded": {
        const t = reqStr(command, "table");
        if (!t || !Array.isArray(command.cells)) return err("bad_request", "setCellsExcluded needs string 'table' and array 'cells'");
        if (typeof command.excluded !== "boolean") return err("bad_request", "setCellsExcluded needs boolean 'excluded'");
        const cells: { rowId: NodeId; colId: NodeId }[] = [];
        for (const c of command.cells) {
          if (!isObj(c) || !isStr(c.row) || !isStr(c.column)) {
            return err("bad_request", "each entry of 'cells' needs string 'row' and 'column'");
          }
          cells.push({ rowId: c.row, colId: c.column });
        }
        doc.setCellsExcluded(t, cells, command.excluded);
        return ok({ table: t, cells: cells.length, excluded: command.excluded });
      }

      // ── things ON the graph ───────────────────────────────────────────────────
      case "addAnnotation": {
        const id = reqStr(command, "id");
        if (!id || !isObj(command.annotation)) return err("bad_request", "addAnnotation needs string 'id' and object 'annotation'");
        if (!isStr(command.annotation.kind)) return err("bad_request", "the annotation needs a string 'kind' (text, hline, vline, bracket, arrow, …)");
        // Note: the body of a text/callout is `label`, and x/y are fractions of the plot rect
        // (0..1) — not data values. Getting that wrong places the object off-plot silently.
        const a = doc.addAnnotation(id, command.annotation as never);
        return ok({ id, annotation: a.id });
      }
      case "updateAnnotation": {
        const id = reqStr(command, "id");
        const annotation = reqStr(command, "annotation");
        if (!id || !annotation || !isObj(command.patch)) return err("bad_request", "updateAnnotation needs string 'id', 'annotation' and object 'patch'");
        doc.updateAnnotation(id, annotation, command.patch as never);
        return ok({ id, annotation });
      }
      case "removeAnnotation": {
        const id = reqStr(command, "id");
        const annotation = reqStr(command, "annotation");
        if (!id || !annotation) return err("bad_request", "removeAnnotation needs string 'id' and 'annotation'");
        doc.removeAnnotation(id, annotation);
        return ok({ id, annotation, removed: true });
      }
      case "setSignificance": {
        const id = reqStr(command, "id");
        if (!id || !isObj(command.patch)) return err("bad_request", "setSignificance needs string 'id' and object 'patch'");
        doc.setSignificance(id, command.patch as never);
        return ok({ id });
      }
      case "setFit": {
        const id = reqStr(command, "id");
        if (!id) return err("bad_request", "setFit needs a string 'id'");
        const fit = command.fit;
        if (fit !== null && !isObj(fit)) return err("bad_request", "setFit needs an object 'fit', or null to remove the fitted curve");
        doc.setPlotFit(id, fit as never);
        return ok({ id, fit: fit === null ? null : "set" });
      }
      case "setFits": {
        const id = reqStr(command, "id");
        if (!id) return err("bad_request", "setFits needs a string 'id'");
        const fits = command.fits;
        if (fits !== null && !(Array.isArray(fits) && fits.every(isObj))) {
          return err("bad_request", "setFits needs an array of fit objects, or null to remove them");
        }
        doc.setPlotFits(id, fits as never);
        return ok({ id, fits: fits === null ? null : (fits as unknown[]).length });
      }

      // ── how the graph looks ───────────────────────────────────────────────────
      case "applyStylePreset": {
        const id = reqStr(command, "id");
        const name = reqStr(command, "preset");
        if (!id || !name) return err("bad_request", "applyStylePreset needs string 'id' and 'preset'");
        // By name, not by object. A whole StylePreset is ~20 coupled numbers; asking an agent
        // to compose one invites a half-filled preset that looks applied and is not. The
        // registry is the same one the Inspector's picker offers.
        const preset = STYLE_PRESETS.find((p) => p.name === name);
        if (!preset) {
          return err("bad_request", `unknown preset '${name}'; the presets are: ${STYLE_PRESETS.map((p) => p.name).join(", ")}`);
        }
        doc.applyStylePreset(id, preset);
        return ok({ id, preset: preset.name });
      }
      case "setFont": {
        const id = reqStr(command, "id");
        const element = reqStr(command, "element");
        if (!id || !element || !isObj(command.patch)) return err("bad_request", "setFont needs string 'id', 'element' and object 'patch'");
        if (!FONT_ELEMENTS.has(element)) {
          return err("bad_request", `setFont 'element' must be one of ${[...FONT_ELEMENTS].join(", ")}`);
        }
        doc.setPlotFont(id, element as never, command.patch as never);
        return ok({ id, element });
      }
      case "setLegend": {
        const id = reqStr(command, "id");
        if (!id || !isObj(command.patch)) return err("bad_request", "setLegend needs string 'id' and object 'patch'");
        doc.setLegend(id, command.patch as never);
        return ok({ id });
      }
      case "setGrid": {
        const id = reqStr(command, "id");
        if (!id || !isObj(command.patch)) return err("bad_request", "setGrid needs string 'id' and object 'patch'");
        doc.setGridStyle(id, command.patch as never);
        return ok({ id });
      }
      case "setFrame": {
        const id = reqStr(command, "id");
        if (!id || !isObj(command.patch)) return err("bad_request", "setFrame needs string 'id' and object 'patch'");
        doc.setPlotFrame(id, command.patch as never);
        return ok({ id });
      }

      // ── multi-panel figures ───────────────────────────────────────────────────
      case "listFigures":
        return ok((project.layouts ?? []).map((l) => ({ id: l.id, name: l.name, panels: l.panels?.length ?? 0 })));
      case "createFigure": {
        const name = reqStr(command, "name");
        if (!name) return err("bad_request", "createFigure needs a string 'name'");
        const layout = doc.addLayout(name);
        return ok({ id: layout.id, name: layout.name });
      }
      case "addFigurePanel": {
        const figure = reqStr(command, "figure");
        const graph = reqStr(command, "graph");
        if (!figure || !graph) return err("bad_request", "addFigurePanel needs string 'figure' and 'graph'");
        doc.addLayoutPanel(figure, graph);
        return ok({ figure, graph });
      }
      case "setFigureOptions": {
        const figure = reqStr(command, "figure");
        if (!figure || !isObj(command.patch)) return err("bad_request", "setFigureOptions needs string 'figure' and object 'patch'");
        doc.setLayoutOptions(figure, command.patch as never);
        return ok({ figure });
      }

      // ── project structure ─────────────────────────────────────────────────────
      case "addFolder": {
        const name = reqStr(command, "name");
        if (!name) return err("bad_request", "addFolder needs a string 'name'");
        const f = doc.addFolder(name);
        return ok({ id: f.id, name: f.name });
      }
      case "addExperiment": {
        const folder = reqStr(command, "folder");
        const name = reqStr(command, "name");
        if (!folder || !name) return err("bad_request", "addExperiment needs string 'folder' and 'name'");
        const e = doc.addExperiment(folder, name);
        return ok({ id: e.id, name: e.name, folder });
      }
      case "renameFolder": {
        const folder = reqStr(command, "folder");
        const name = reqStr(command, "name");
        if (!folder || !name) return err("bad_request", "renameFolder needs string 'folder' and 'name'");
        doc.renameFolder(folder, name);
        return ok({ folder, name });
      }
      case "renameExperiment": {
        const folder = reqStr(command, "folder");
        const experiment = reqStr(command, "experiment");
        const name = reqStr(command, "name");
        if (!folder || !experiment || !name) return err("bad_request", "renameExperiment needs string 'folder', 'experiment' and 'name'");
        doc.renameExperiment(folder, experiment, name);
        return ok({ folder, experiment, name });
      }

      case "deleteGraph": {
        const id = reqStr(command, "id");
        if (!id) return err("bad_request", "deleteGraph needs a string 'id'");
        doc.removePlot(id);
        return ok({ id, deleted: true });
      }
      case "deleteTable": {
        const id = reqStr(command, "id");
        if (!id) return err("bad_request", "deleteTable needs a string 'id'");
        doc.removeTable(id);
        return ok({ id, deleted: true });
      }
      case "deleteAnalysis": {
        const id = reqStr(command, "id");
        if (!id) return err("bad_request", "deleteAnalysis needs a string 'id'");
        doc.removeAnalysis(id);
        return ok({ id, deleted: true });
      }
      /**
       * Resolve the id to a position here rather than making the caller count rows. The
       * document methods delete by index, and an index handed in from outside goes stale the
       * moment anything reorders the sheet — a sort, or another agent command in the same batch.
       * This is a lookup, not a second mutation path: the delete itself is still the document's.
       */
      case "deleteRow": {
        const t = reqStr(command, "table");
        const row = reqStr(command, "row");
        if (!t || !row) return err("bad_request", "deleteRow needs string 'table' and 'row'");
        const table = project.tables.find((x) => x.id === t);
        if (!table) return err("not_found", `no table with id '${t}'`);
        const index = table.rows.findIndex((r) => r.id === row);
        if (index < 0) return err("not_found", `table '${t}' has no row with id '${row}'`);
        doc.deleteRow(t, index);
        return ok({ table: t, row, deleted: true });
      }
      case "deleteColumn": {
        const t = reqStr(command, "table");
        const column = reqStr(command, "column");
        if (!t || !column) return err("bad_request", "deleteColumn needs string 'table' and 'column'");
        const table = project.tables.find((x) => x.id === t);
        if (!table) return err("not_found", `no table with id '${t}'`);
        const index = table.columns.findIndex((c) => c.id === column);
        if (index < 0) return err("not_found", `table '${t}' has no column with id '${column}'`);
        doc.deleteColumn(t, index);
        return ok({ table: t, column, deleted: true });
      }

      default:
        return err("unknown_op", `unknown op '${String(op)}'`);
    }
  } catch (e) {
    // A document method threw — most often a missing target (requirePlot/requireTable/…).
    return err("not_found", e instanceof Error ? e.message : String(e));
  }
}

/**
 * A command's `id` field set to this sentinel resolves, inside a batch, to the id of the
 * graph created earlier in the same batch. It lets "make a scatter then log its x axis"
 * work: the second command can't name an id that doesn't exist until the first runs.
 */
export const LAST_CREATED_GRAPH = "$lastGraph";

/**
 * Run a sequence of commands, stopping at the first failure (so a batch that builds on
 * itself — create a table, then a graph of it — fails cleanly rather than half-applying
 * later steps against a missing earlier one). Returns every result up to and including
 * the failure. Resolves the `LAST_CREATED_GRAPH` sentinel to the most recent graph this
 * batch created.
 */
export function executeAgentBatch(doc: MadyDocument, commands: readonly unknown[]): AgentResult[] {
  const out: AgentResult[] = [];
  let lastGraph: string | undefined;
  for (const c of commands) {
    let cmd = c;
    if (isObj(c) && c.id === LAST_CREATED_GRAPH) {
      if (!lastGraph) {
        out.push(err("bad_request", "referenced the just-created graph, but none was created earlier in this batch"));
        break;
      }
      cmd = { ...c, id: lastGraph };
    }
    const r = executeAgentCommand(doc, cmd);
    out.push(r);
    if (!r.ok) break;
    if (isObj(c) && c.op === "createGraph") lastGraph = (r.value as { id?: string }).id ?? lastGraph;
  }
  return out;
}

/** One entry in the self-describing schema. */
export interface AgentOpMeta {
  op: AgentOp;
  mutates: boolean;
  destructive: boolean;
  /** Required fields beyond `op` (and `confirm` for destructive ops). */
  required: string[];
}

/**
 * The machine-readable vocabulary — what a caller (or an NL layer) can invoke, which ops
 * mutate, and which need confirmation. Kept in lock-step with the union by a test that
 * asserts every `op` is described here and vice-versa.
 */
export function agentApiSchema(): AgentOpMeta[] {
  const REQUIRED: Record<AgentOp, string[]> = {
    listTables: [], listGraphs: [], listAnalyses: [],
    getGraph: ["id"], getAnalysis: ["id"], getTable: ["id"],
    setCell: ["table", "row", "column", "value"],
    addRow: ["table", "values"],
    addColumn: ["table"],
    renameColumn: ["table", "column", "name"],
    setColumnType: ["table", "column", "type"],
    sortRows: ["table", "column", "direction"],
    setCellsExcluded: ["table", "cells", "excluded"],
    deleteRow: ["table", "row"], deleteColumn: ["table", "column"],
    addAnnotation: ["id", "annotation"],
    updateAnnotation: ["id", "annotation", "patch"],
    removeAnnotation: ["id", "annotation"],
    setSignificance: ["id", "patch"],
    setFit: ["id", "fit"], setFits: ["id", "fits"],
    applyStylePreset: ["id", "preset"],
    setFont: ["id", "element", "patch"],
    setLegend: ["id", "patch"], setGrid: ["id", "patch"], setFrame: ["id", "patch"],
    listFigures: [], createFigure: ["name"],
    addFigurePanel: ["figure", "graph"], setFigureOptions: ["figure", "patch"],
    addFolder: ["name"], addExperiment: ["folder", "name"],
    renameFolder: ["folder", "name"], renameExperiment: ["folder", "experiment", "name"],
    createTable: ["name", "columns", "rows"],
    createGraph: ["name", "table"],
    setGraphKind: ["id", "kind"],
    setGraphOptions: ["id", "patch"],
    setAxis: ["id", "axis", "patch"],
    setSeriesStyle: ["id", "series", "style"],
    runAnalysis: ["name", "method", "table", "params"],
    deleteGraph: ["id"], deleteTable: ["id"], deleteAnalysis: ["id"],
  };
  return (Object.keys(REQUIRED) as AgentOp[]).map((op) => ({
    op,
    mutates: MUTATING_OPS.has(op),
    destructive: DESTRUCTIVE_OPS.has(op),
    required: DESTRUCTIVE_OPS.has(op) ? [...REQUIRED[op], "confirm"] : REQUIRED[op],
  }));
}
