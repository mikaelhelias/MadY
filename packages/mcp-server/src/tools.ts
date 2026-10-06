/**
 * Tool layer — transport-agnostic descriptors (name + zod input shape + handler),
 * kept independent of the MCP SDK so the logic is unit-testable without a live server.
 * `server.ts` mounts each descriptor onto an `McpServer`.
 *
 * The mutation/query tools are generated one-per-`AgentOp` from the closed command
 * union, so the tool surface can never drift from `agentApiSchema()` (a test asserts
 * exact parity). Every mutating handler dispatches to `executeAgentCommand` — the same
 * validated, undoable path the desktop bridge uses. No second mutation path.
 */
import { z, type ZodRawShape } from "zod";
import { type AgentOp, agentApiSchema, compileNL, type NLContext } from "@mady/core";
import { catalogKinds, describeOptions, optionFacts } from "./optionCatalog.js";
import { liveExecute, liveStatus } from "./liveClient.js";
import type { MadySession } from "./session.js";

export interface ToolDescriptor {
  name: string;
  title: string;
  description: string;
  inputShape: ZodRawShape;
  /** Returns a plain JSON-serializable value; `server.ts` wraps it as MCP content. */
  handler: (args: Record<string, unknown>) => unknown | Promise<unknown>;
}

/** op → its snake_case tool name (ops start lowercase, so no leading underscore). */
export function opToolName(op: AgentOp): string {
  return op.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

/** Where the app listens when launched with MADY_LIVE_AGENT_PORT. A caller may override it;
 *  the app side has no default — this is only the port the tools try first. */
const DEFAULT_LIVE_PORT = 8787;

const cell = z.union([z.number(), z.string(), z.null()]);
const jsonObject = z.record(z.unknown());

interface OpToolDef {
  title: string;
  description: string;
  shape: ZodRawShape;
}

/**
 * The per-op tool metadata. Keyed by every `AgentOp` — parity with the command union
 * is enforced by `tools.test.ts` (the drift guard), so adding an op without a tool
 * here fails CI.
 */
const OP_TOOLS: Record<AgentOp, OpToolDef> = {
  listTables: { title: "List tables", description: "List all data tables (id, name, kind, column/row counts).", shape: {} },
  listGraphs: { title: "List graphs", description: "List all graphs (id, name, kind, source table).", shape: {} },
  listAnalyses: { title: "List analyses", description: "List all analyses (id, name, method, status).", shape: {} },
  getGraph: { title: "Get graph", description: "Get the full plot spec of one graph by id.", shape: { id: z.string() } },
  getAnalysis: {
    title: "Get analysis",
    description: "Get one analysis by id, including its computed result if present.",
    shape: { id: z.string() },
  },
  getTable: {
    title: "Get table",
    description:
      "Read a table's columns and rows, with their ids. This is the only way to get a row id, and set_cell needs one. Paged: `limit` (default 200) and `offset`; the reply says `rowCount` and flags `truncated`.",
    shape: { id: z.string(), limit: z.number().optional(), offset: z.number().optional() },
  },
  setCell: {
    title: "Set cell",
    description:
      "Write one cell. `row` and `column` are ids from get_table — never positions. `value` is a number, a string, or null to clear it.",
    shape: { table: z.string(), row: z.string(), column: z.string(), value: cell },
  },
  addRow: {
    title: "Add row",
    description: "Append a row. `values` are cell values in column order; short arrays leave the remaining cells empty.",
    shape: { table: z.string(), values: z.array(cell) },
  },
  addColumn: {
    title: "Add column",
    description: "Append a column, optionally named. Returns its id.",
    shape: { table: z.string(), name: z.string().optional() },
  },
  renameColumn: {
    title: "Rename column",
    description: "Rename one column. The column keeps its id, so graphs and analyses that use it are unaffected.",
    shape: { table: z.string(), column: z.string(), name: z.string() },
  },
  setColumnType: {
    title: "Set column type",
    description: "Set a column's data type: number, text, date, elapsed, or categorical.",
    shape: { table: z.string(), column: z.string(), type: z.enum(["number", "text", "date", "elapsed", "categorical"]) },
  },
  sortRows: {
    title: "Sort rows",
    description: "Sort the table's rows by one column, 'asc' or 'desc'. Type-aware, blanks last, stable.",
    shape: { table: z.string(), column: z.string(), direction: z.enum(["asc", "desc"]) },
  },
  setCellsExcluded: {
    title: "Exclude / include cells",
    description:
      "Mark cells excluded (or put them back). An excluded value stays in the sheet and is ignored by every graph and every analysis. `cells` is an array of {row, column} ids.",
    shape: {
      table: z.string(),
      cells: z.array(z.object({ row: z.string(), column: z.string() })),
      excluded: z.boolean(),
    },
  },
  deleteRow: {
    title: "Delete row",
    description: "Delete one row by id. Destructive (it removes data): pass confirm=true.",
    shape: { table: z.string(), row: z.string(), confirm: z.boolean().default(false) },
  },
  deleteColumn: {
    title: "Delete column",
    description: "Delete one column by id. Destructive (it removes data): pass confirm=true.",
    shape: { table: z.string(), column: z.string(), confirm: z.boolean().default(false) },
  },
  createTable: {
    title: "Create table",
    description:
      "Create a data table. `columns` are column names; `rows` is an array of rows, each an array of cell values (number, string, or null) aligned to the columns.",
    shape: {
      name: z.string(),
      kind: z.string().optional(),
      columns: z.array(z.string()),
      rows: z.array(z.array(cell)),
    },
  },
  createGraph: {
    title: "Create graph",
    description: "Create a graph of an existing table. `table` is the table id; `kind` is an optional plot kind (e.g. scatter, bar, box).",
    shape: { name: z.string(), table: z.string(), kind: z.string().optional() },
  },
  setGraphKind: {
    title: "Set graph kind",
    description: "Change a graph's plot kind (e.g. xy, bar, box, violin, heatmap).",
    shape: { id: z.string(), kind: z.string() },
  },
  setGraphOptions: {
    title: "Set graph options",
    description: "Patch a graph's options (a partial plot object merged into the graph).",
    shape: { id: z.string(), patch: jsonObject },
  },
  setAxis: {
    title: "Set axis",
    description: "Patch one axis of a graph (x, y, y2, or y3) — e.g. title, log scale, reversed, range.",
    shape: { id: z.string(), axis: z.enum(["x", "y", "y2", "y3"]), patch: jsonObject },
  },
  setSeriesStyle: {
    title: "Set series style",
    description: "Set the style (colour, markers, line, …) of one series of a graph, identified by its series/column id.",
    shape: { id: z.string(), series: z.string(), style: jsonObject },
  },
  runAnalysis: {
    title: "Configure analysis",
    description:
      "Create (configure) an analysis on a table. Returns its id. `params.columns` lists the ids of the columns it reads (list_tables shows them), e.g. { columns: [xId, yId] } for a regression. This does NOT compute results — call compute_analysis with the returned id to run the stats engine.",
    shape: { name: z.string(), method: z.string(), table: z.string(), params: jsonObject },
  },
  addAnnotation: {
    title: "Add annotation",
    description:
      "Put an object on a graph: a text label, a reference line, a significance bracket, an arrow, a shaded band. `annotation` needs a `kind` (text · hline · vline · bracket · arrow · segment · rect · ellipse · callout · highlight · hband · vband). " +
      "⚠️ The body of a text or callout is `label`, not `text`; `x`/`y` are fractions of the plot rect (0..1), not data values; a reference line uses `value` (a data value on its axis). Confirm with describe_graph — some kinds refuse annotations and say so in `warnings`.",
    shape: { id: z.string(), annotation: jsonObject },
  },
  updateAnnotation: {
    title: "Update annotation",
    description: "Patch one annotation on a graph (its text, colour, position, …). `annotation` is the id returned by add_annotation. The kind cannot be changed.",
    shape: { id: z.string(), annotation: z.string(), patch: jsonObject },
  },
  removeAnnotation: {
    title: "Remove annotation",
    description: "Remove one annotation from a graph. Undoable, and it destroys no data, so no confirm is required.",
    shape: { id: z.string(), annotation: z.string() },
  },
  setSignificance: {
    title: "Set significance style",
    description: "Style the significance markers on a graph (stars vs p-values, thresholds, bracket look).",
    shape: { id: z.string(), patch: jsonObject },
  },
  setFit: {
    title: "Set fitted curve",
    description: "Set the graph's fitted curve, or pass fit=null to remove it.",
    shape: { id: z.string(), fit: jsonObject.nullable() },
  },
  setFits: {
    title: "Set per-dataset fits",
    description: "Set one fitted curve per dataset (a global fit), or pass fits=null to remove them.",
    shape: { id: z.string(), fits: z.array(jsonObject).nullable() },
  },
  applyStylePreset: {
    title: "Apply style preset",
    description:
      "Restyle a graph with one of the built-in presets, by name: MadY default · Scientific Journal · Bold infographic · Editorial · Grayscale (print) · Universal design. One call replaces dozens of option patches. An unknown name is refused and the reply lists the real ones.",
    shape: { id: z.string(), preset: z.string() },
  },
  setFont: {
    title: "Set font",
    description: "Set the font of one text element: title, subtitle, axisTitle, tick, legend, sliceLabel or valueLabel. `patch` takes size, family, bold, italic, color.",
    shape: {
      id: z.string(),
      element: z.enum(["title", "subtitle", "axisTitle", "tick", "legend", "sliceLabel", "valueLabel"]),
      patch: jsonObject,
    },
  },
  setLegend: { title: "Set legend", description: "Patch a graph's legend: show/hide, position, framing, font.", shape: { id: z.string(), patch: jsonObject } },
  setGrid: { title: "Set gridlines", description: "Patch a graph's gridlines: which axes, colour, dash, density.", shape: { id: z.string(), patch: jsonObject } },
  setFrame: {
    title: "Set frame and ticks",
    description: "Set the plot frame (box · lshape · offset · none), tick direction (out · in · both · none) and tick length.",
    shape: { id: z.string(), patch: jsonObject },
  },
  listFigures: { title: "List figures", description: "List the multi-panel figures in the project (id, name, panel count).", shape: {} },
  createFigure: { title: "Create figure", description: "Create an empty multi-panel figure (a page that graphs are arranged on). Returns its id.", shape: { name: z.string() } },
  addFigurePanel: { title: "Add figure panel", description: "Put a graph onto a figure as a panel. Panels are lettered A, B, C… in the order they are added.", shape: { figure: z.string(), graph: z.string() } },
  setFigureOptions: { title: "Set figure options", description: "Patch a figure's layout options (columns, spacing, panel labels, page size).", shape: { figure: z.string(), patch: jsonObject } },
  addFolder: { title: "Add project folder", description: "Add a top-level project folder. Returns its id.", shape: { name: z.string() } },
  addExperiment: { title: "Add experiment", description: "Add an experiment inside a project folder. Returns its id.", shape: { folder: z.string(), name: z.string() } },
  renameFolder: { title: "Rename folder", description: "Rename a project folder.", shape: { folder: z.string(), name: z.string() } },
  renameExperiment: { title: "Rename experiment", description: "Rename an experiment inside a folder.", shape: { folder: z.string(), experiment: z.string(), name: z.string() } },
  deleteGraph: {
    title: "Delete graph",
    description: "Delete a graph. Destructive: pass confirm=true to actually delete.",
    shape: { id: z.string(), confirm: z.boolean().default(false) },
  },
  deleteTable: {
    title: "Delete table",
    description: "Delete a table. Destructive: pass confirm=true to actually delete.",
    shape: { id: z.string(), confirm: z.boolean().default(false) },
  },
  deleteAnalysis: {
    title: "Delete analysis",
    description: "Delete an analysis. Destructive: pass confirm=true to actually delete.",
    shape: { id: z.string(), confirm: z.boolean().default(false) },
  },
};

/** Build an `NLContext` from the session's current document (for `run_nl`). */
function nlContext(session: MadySession): NLContext {
  const project = session.document.toJSON();
  return {
    tables: project.tables.map((t) => ({ id: t.id, name: t.name, columns: t.columns.map((c) => ({ id: c.id, name: c.name })) })),
  };
}

/** Every tool the server exposes, bound to a session. */
export function buildTools(session: MadySession): ToolDescriptor[] {
  const opTools: ToolDescriptor[] = (Object.keys(OP_TOOLS) as AgentOp[]).map((op) => {
    const def = OP_TOOLS[op];
    return {
      name: opToolName(op),
      title: def.title,
      description: def.description,
      inputShape: def.shape,
      // Field names in each shape match the AgentCommand fields exactly, so the
      // command is just {op, ...args} handed to the validated executor.
      handler: (args) => session.exec({ op, ...args }),
    };
  });

  const lifecycleTools: ToolDescriptor[] = [
    {
      name: "new_project",
      title: "New project",
      description: "Start a fresh, empty MadY project (discards the in-memory one).",
      inputShape: {},
      handler: () => session.newProject(),
    },
    {
      name: "open_project",
      title: "Open project",
      description: "Open a .mady project file from disk into this session.",
      inputShape: { path: z.string() },
      handler: (args) => session.openProject(String(args.path)),
    },
    {
      name: "save_project",
      title: "Save project",
      description: "Save the session's project to disk. `path` is optional if the project already has one.",
      inputShape: { path: z.string().optional() },
      handler: (args) => session.saveProject(args.path === undefined ? undefined : String(args.path)),
    },
    {
      name: "project_summary",
      title: "Project summary",
      description: "Summarize the current project: its tables, graphs, and analyses.",
      inputShape: {},
      handler: () => session.summary(),
    },
    {
      name: "live_status",
      title: "Live window status",
      description:
        "Is a running MadY window available to drive? Every other tool edits this session's own in-memory project; live_execute edits the window the user is looking at. " +
        "Requires the Agent edition started with MADY_LIVE_AGENT_PORT set — 'not attached' is the ordinary answer, and it says what to do.",
      inputShape: { port: z.number().optional() },
      handler: (args) => liveStatus({ port: Number(args.port ?? DEFAULT_LIVE_PORT) }),
    },
    {
      name: "live_execute",
      title: "Run a command in the live window",
      description:
        "Send one agent command to the running MadY window, so the edit appears in front of the user and is one undo away. Takes the same `command` object the other tools build — e.g. {\"op\":\"setAxis\",\"id\":\"…\",\"axis\":\"y\",\"patch\":{\"scale\":\"log\"}}; see the op tools for the vocabulary. " +
        "The window runs it through the same validated, undoable executor, so destructive ops still need confirm=true. Use live_status first if you are unsure a window is there.",
      inputShape: { command: jsonObject, port: z.number().optional() },
      handler: (args) => liveExecute({ port: Number(args.port ?? DEFAULT_LIVE_PORT) }, args.command),
    },
    {
      name: "import_csv",
      title: "Import a CSV",
      description:
        "Read a delimited text file (CSV/TSV/whitespace) from disk and file it as a table. Uses the SAME parser the app uses, so the delimiter, the header row, decimal commas, missing-value tokens and date/duration columns are handled the way the desktop import handles them. " +
        "`name` defaults to the file's own name. Override the guesses with `delimiter`, `header`, `skip_rows` or `transpose`. Returns the new table's id — pass it to create_graph or run_analysis.",
      inputShape: {
        path: z.string(),
        name: z.string().optional(),
        delimiter: z.string().optional(),
        header: z.boolean().optional(),
        skip_rows: z.number().optional(),
        transpose: z.boolean().optional(),
      },
      handler: (args) =>
        session.importCsv(String(args.path), {
          ...(args.name !== undefined ? { name: String(args.name) } : {}),
          ...(args.delimiter !== undefined ? { delimiter: String(args.delimiter) } : {}),
          ...(args.header !== undefined ? { header: Boolean(args.header) } : {}),
          ...(args.skip_rows !== undefined ? { skipRows: Number(args.skip_rows) } : {}),
          ...(args.transpose !== undefined ? { transpose: Boolean(args.transpose) } : {}),
        }),
    },
    {
      name: "describe_options",
      title: "Describe options",
      description:
        "What can I actually set on this chart kind? Lists the plot options shown to change the drawing on a given kind — measured by rendering the figure with and without each option, not by whether a control exists — each with a value known to work there, ready to send through set_graph_options / set_axis. " +
        "Pass `kind` (e.g. heatmap, bar, pie) or `graph_id` to use an existing graph's kind. Narrow a long reply with `group`, `search` (substring of the option path), or `limit`. Every reply lists the `groups` it found, so read one from there rather than guessing; group matching ignores case and punctuation, so the separator in a name like 'Kind style — HeatmapStyle' does not have to be typed exactly. " +
        "Pass `option` instead to ask about one option: which kinds it works on, or that it was measured as having no effect anywhere (a different answer from 'unknown', which means a typo). " +
        "⚠️ It knows whether an option reaches the drawing, not whether a value is sensible or how two options interact.",
      inputShape: {
        kind: z.string().optional(),
        graph_id: z.string().optional(),
        option: z.string().optional(),
        group: z.string().optional(),
        search: z.string().optional(),
        limit: z.number().optional(),
      },
      handler: (args) => {
        if (args.option !== undefined) return optionFacts().lookup(String(args.option));
        let kind = args.kind === undefined ? undefined : String(args.kind);
        if (kind === undefined && args.graph_id !== undefined) {
          const found = session.exec({ op: "getGraph", id: String(args.graph_id) });
          if (!found.ok) return found;
          kind = String((found.value as { kind?: unknown }).kind ?? "xy");
        }
        if (kind === undefined) {
          return {
            ok: false,
            code: "bad_request",
            error: "describe_options needs one of 'kind', 'graph_id' or 'option'",
            knownKinds: catalogKinds(),
          };
        }
        return describeOptions({
          kind,
          ...(args.group !== undefined ? { group: String(args.group) } : {}),
          ...(args.search !== undefined ? { search: String(args.search) } : {}),
          ...(args.limit !== undefined ? { limit: Number(args.limit) } : {}),
        });
      },
    },
    {
      name: "describe_graph",
      title: "Describe graph",
      description:
        "Read back what a graph actually draws: its resolved axes (type, domain, ticks), the series and how many marks each drew, every populated drawable layer with a count, the legend rows and what each selects, annotations by kind, and — most importantly — `warnings`, MadY's own account of anything it could not draw. Use this after changing a graph to confirm the change landed. " +
        "⚠️ Read `drawnTotal`, never `series.length`: several kinds (pie, treemap, radar, parallel, lollipop, paireddot) draw outside the series layer, and `drawsOutsideSeriesLayer` flags that case. Nothing is mutated. Text widths are estimated headlessly, so text-dependent geometry is close, not exact.",
      inputShape: { id: z.string(), width: z.number().optional(), height: z.number().optional() },
      handler: (args) =>
        session.describeGraph(String(args.id), {
          ...(args.width !== undefined ? { width: Number(args.width) } : {}),
          ...(args.height !== undefined ? { height: Number(args.height) } : {}),
        }),
    },
    {
      name: "run_nl",
      title: "Natural-language command",
      description:
        "Run a plain-language instruction (e.g. \"make a scatter of dose vs response, then log its x axis\"). Compiled deterministically into agent commands and executed. Destructive verbs are not supported here.",
      inputShape: { text: z.string() },
      handler: async (args) => {
        // `compileNL` returns its result synchronously; awaiting a plain value is harmless.
        const result = await compileNL(String(args.text), nlContext(session));
        if (!result.ok) return result;
        const results = session.execBatch(result.commands);
        return { ok: true, commands: result.commands, results, ...(result.note ? { note: result.note } : {}) };
      },
    },
    {
      name: "compute_analysis",
      title: "Compute analysis",
      description:
        "Run the stats engine for an analysis and return its numeric results. Pass `analysis_id` to compute (and store the result on) a configured analysis, OR pass method+table+params to compute an ad-hoc analysis without storing it. Requires a local Python stats engine (or a frozen engine via MADY_ENGINE_* env vars).",
      inputShape: {
        analysis_id: z.string().optional(),
        method: z.string().optional(),
        table: z.string().optional(),
        params: jsonObject.optional(),
      },
      handler: (args) =>
        session.compute({
          ...(args.analysis_id !== undefined ? { analysisId: String(args.analysis_id) } : {}),
          ...(args.method !== undefined ? { method: String(args.method) } : {}),
          ...(args.table !== undefined ? { table: String(args.table) } : {}),
          ...(args.params !== undefined ? { params: args.params as never } : {}),
        }),
    },
  ];

  return [...lifecycleTools, ...opTools];
}

/** The op set the generated tools cover — used by the drift guard test. */
export function coveredOps(): AgentOp[] {
  return Object.keys(OP_TOOLS) as AgentOp[];
}

/** Re-export so the drift guard can compare against the source of truth. */
export function schemaOps(): AgentOp[] {
  return agentApiSchema().map((m) => m.op);
}
