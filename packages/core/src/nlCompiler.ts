/**
 * NL → graph compiler. Turns a line of controlled natural language ("scatter of dose vs
 * response", "run a t-test on A and B", "log the x axis") into `AgentCommand`s that the
 * typed agent API then executes.
 *
 * This is a deterministic, fully offline parser — no model, no network, no key. It
 * understands a defined command language rather than arbitrary prose, and says so when it
 * cannot parse. Its output contract is `NLResult` (→ `AgentCommand[]`), the same one the
 * on-device model compiler (`modelCompiler.ts`) produces: both implement `NLCompiler` and feed
 * the same executor, and the model compiler runs this parser first.
 *
 * It covers the safe, constructive language (list · create graph · change kind · set axis ·
 * run analysis). Destructive verbs (delete) are deliberately not understood, because a typed
 * line gives no confirmation step; the agent API supports them directly, with `confirm: true`.
 */
import { LAST_CREATED_GRAPH } from "./agentApi";
import type { AgentCommand } from "./agentApi";
import type { AnalysisParams, AxisScale, PlotKind } from "./model";

export interface NLColumn { id: string; name: string }
export interface NLTable { id: string; name: string; columns: NLColumn[] }

/** What the parser needs to resolve references ("the graph", "dose", "the means table"). */
export interface NLContext {
  tables: NLTable[];
  /** Used when a graph is created without naming a table ("make a scatter"). */
  activeTableId?: string | undefined;
  /** Used for "the graph" / "this graph" / axis + kind edits with no named target. */
  activeGraphId?: string | undefined;
}

export type NLResult =
  | { ok: true; commands: AgentCommand[]; note?: string }
  | { ok: false; error: string; hint?: string };

/**
 * The compiler type. The deterministic parser is synchronous; the model compiler returns a
 * Promise — so the shared type is the union, and callers `await` it either way.
 */
export type NLCompiler = (text: string, ctx: NLContext) => NLResult | Promise<NLResult>;

// ── vocabulary ──────────────────────────────────────────────────────────────────
/** Chart phrasings → PlotKind. Longest phrases first so "bar chart" beats "bar". */
const KIND_WORDS: Array<[RegExp, PlotKind]> = [
  [/\bscatter(?:\s*plot)?\b/, "scatter"],
  [/\bbubble(?:\s*chart)?\b/, "bubble"],
  [/\bbar(?:\s*chart)?\b|\bcolumn\s*chart\b/, "bar"],
  [/\bline(?:\s*chart)?\b/, "xy"],
  [/\bbox(?:\s*plot)?\b/, "box"],
  [/\bviolin(?:\s*plot)?\b/, "violin"],
  [/\bhistogram\b|\bhist\b/, "histogram"],
  [/\bheat\s*map\b/, "heatmap"],
  [/\bpie(?:\s*chart)?\b/, "pie"],
  [/\barea(?:\s*chart)?\b/, "area"],
  [/\blollipop\b/, "lollipop"],
  [/\bforest(?:\s*plot)?\b/, "forest"],
  [/\bfunnel(?:\s*plot)?\b/, "funnel"],
  [/\bvenn(?:\s*diagram)?\b|\beuler\s*diagram\b/, "venn"],
  [/\bupset(?:\s*plot)?\b/, "upset"],
  [/\bswimmer(?:\s*plot)?\b/, "swimmer"],
  [/\bternary(?:\s*(?:plot|diagram))?\b/, "ternary"],
  [/\bwind\s*rose\b|\bpolar\s*histogram\b|\brose\s*(?:plot|chart|diagram)\b/, "rose"],
  [/\b(?:timeline|heat\s*map)\s*tracks\b|\btrack\s*(?:strip|chart)\b/, "tracks"],
];

/** Analysis phrasings → {method, optional variant}. Longest/most-specific first. */
const METHOD_WORDS: Array<[RegExp, { method: string; variant?: string }]> = [
  [/\bmann[-\s]?whitney\b/, { method: "ttest", variant: "mann-whitney" }],
  [/\bpaired\s+t[-\s]?test\b/, { method: "ttest", variant: "paired" }],
  [/\bwelch(?:'s)?\s+t[-\s]?test\b|\bwelch\b/, { method: "ttest", variant: "welch" }],
  [/\bt[-\s]?test\b|\bstudent(?:'s)?\s+t\b/, { method: "ttest" }],
  [/\bone[-\s]?way\s+anova\b|\banova\b/, { method: "anova" }],
  [/\bspearman\b/, { method: "correlation", variant: "spearman" }],
  [/\bpearson\b|\bcorrelat(?:e|ion)\b/, { method: "correlation" }],
  [/\bmichaelis[-\s]?menten\b|\benzyme\s+kinetics\b|\bmichaelis\b/, { method: "curvefit", variant: "mm" }],
  [/\bdose[-\s]?response\b|\b4pl\b|\bcurve\s*fit\b/, { method: "curvefit", variant: "4pl" }],
  [/\bequivalence\b|\btost\b/, { method: "equivalence" }],
  [/\bpermutation\b/, { method: "permutation" }],
  [/\bbayes(?:ian)?(?:\s+factor)?\b/, { method: "bayesfactor" }],
  [/\bnormality\b|\bshapiro\b/, { method: "normality" }],
  [/\bdescrib\w*\b|\bdescriptives?\b|\bsummar(?:y|ise|ize)\b/, { method: "describe" }],
];

const LOG_SCALES: Array<[RegExp, AxisScale]> = [
  [/\blog2\b/, "log2"],
  [/\b(?:natural\s+log|ln)\b/, "ln"],
  [/\blog(?:10)?\b|\blogarithmic\b/, "log10"],
];

// ── helpers ─────────────────────────────────────────────────────────────────────
const ok = (commands: AgentCommand[], note?: string): NLResult => (note ? { ok: true, commands, note } : { ok: true, commands });
const fail = (error: string, hint?: string): NLResult => (hint ? { ok: false, error, hint } : { ok: false, error });

/** All columns across all tables, each tagged with its table — for resolving names. */
function allColumns(ctx: NLContext): Array<{ tableId: string; column: NLColumn }> {
  return ctx.tables.flatMap((t) => t.columns.map((column) => ({ tableId: t.id, column })));
}

/** Find every column whose name appears as a whole word in `text` (longest names first,
 *  so "response rate" wins over "response"). Case-insensitive. */
function matchColumns(text: string, ctx: NLContext): Array<{ tableId: string; column: NLColumn }> {
  const hits: Array<{ tableId: string; column: NLColumn; at: number }> = [];
  const cols = [...allColumns(ctx)].sort((a, b) => b.column.name.length - a.column.name.length);
  const claimed: Array<[number, number]> = [];
  for (const c of cols) {
    const esc = c.column.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(?:^|[^a-z0-9])(${esc})(?=$|[^a-z0-9])`, "i");
    const m = re.exec(text);
    if (!m) continue;
    const start = m.index + m[0].length - m[1]!.length;
    const end = start + m[1]!.length;
    if (claimed.some(([s, e]) => start < e && end > s)) continue; // overlaps an earlier (longer) match
    claimed.push([start, end]);
    hits.push({ tableId: c.tableId, column: c.column, at: start });
  }
  return hits.sort((a, b) => a.at - b.at).map(({ tableId, column }) => ({ tableId, column }));
}

/** Resolve the table a command refers to: a named table, else the table holding the
 *  mentioned columns, else the active table. */
function resolveTable(text: string, ctx: NLContext, mentioned: Array<{ tableId: string }>): string | null {
  for (const t of [...ctx.tables].sort((a, b) => b.name.length - a.name.length)) {
    const esc = t.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(?:^|[^a-z0-9])${esc}(?=$|[^a-z0-9])`, "i").test(text)) return t.id;
  }
  const fromCols = new Set(mentioned.map((m) => m.tableId));
  if (fromCols.size === 1) return [...fromCols][0]!;
  return ctx.activeTableId ?? (ctx.tables.length === 1 ? ctx.tables[0]!.id : null);
}

const axisOf = (text: string): "x" | "y" | null => (/\bx[-\s]?axis\b|\bx\b/.test(text) ? "x" : /\by[-\s]?axis\b|\by\b/.test(text) ? "y" : null);

// ── the compiler ────────────────────────────────────────────────────────────────
/**
 * Parse one line into commands. Explicit sequence separators (";", " then ", " and then
 * ") split into multiple commands; a bare "and" stays inside one clause (so "dose and
 * response" is not split). If any clause fails, the whole call fails, naming the clause.
 */
export const compileNL = (rawText: string, ctx: NLContext): NLResult => {
  const clauses = splitClauses(rawText, ctx);
  if (clauses.length === 0) return fail("Nothing to do — the input was empty.");
  const commands: AgentCommand[] = [];
  const notes: string[] = [];
  let createdInBatch = false;
  for (const clause of clauses) {
    // Once a clause has created a graph, a later "the graph" edit must target that graph,
    // not the previously-active one — via the sentinel the executor resolves per batch.
    const clauseCtx: NLContext = createdInBatch ? { ...ctx, activeGraphId: LAST_CREATED_GRAPH } : ctx;
    const r = compileClause(clause, clauseCtx);
    if (!r.ok) return clauses.length > 1 ? fail(`In "${clause}": ${r.error}`, r.hint) : r;
    commands.push(...r.commands);
    if (r.commands.some((c) => c.op === "createGraph")) createdInBatch = true;
    if (r.note) notes.push(r.note);
  }
  return ok(commands, notes.length ? notes.join(" ") : undefined);
};

/**
 * Verbs that open an instruction. "and" followed by one of these starts a new clause — so
 * "log the y axis and call the graph X" is two clauses (and the second must parse or the whole
 * line fails), while "dose and response" / "Drug A and Drug B" stay whole.
 *
 * Without this split, the axis branch would match "log" in "…on a log scale and call the graph
 * Dose response", apply the scale, and say nothing about the rest: a line half-understood would
 * be reported as done. Refusing it hands the whole line to the model, which can express both
 * halves.
 */
const INSTRUCTION_VERBS =
  /^(?:make|create|draw|plot|graph|chart|add|build|show|list|run|do|perform|fit|calculate|compute|analy[sz]e|change|turn|convert|switch|redraw|log|reverse|flip|title|label|call|rename|set|put|use|colou?r|hide|remove|move)\b/i;

/** Hard separators first (";", "then"); then "and <verb>", unless that "verb" is a column or table name. */
function splitClauses(rawText: string, ctx: NLContext): string[] {
  const names = new Set([
    ...ctx.tables.map((t) => t.name.toLowerCase()),
    ...ctx.tables.flatMap((t) => t.columns.map((c) => c.name.toLowerCase())),
  ]);
  const hard = rawText.split(/;|\bthen\b|\band then\b/i);
  const out: string[] = [];
  for (const piece of hard) {
    let rest = piece;
    const re = /\band\s+(\S+)/gi;
    let m: RegExpExecArray | null;
    let cursor = 0;
    let buffer = "";
    while ((m = re.exec(piece)) !== null) {
      const next = m[1]!;
      const isVerb = INSTRUCTION_VERBS.test(next) && !names.has(next.toLowerCase().replace(/[^a-z0-9]+$/, ""));
      if (!isVerb) continue;
      buffer = piece.slice(cursor, m.index);
      out.push(buffer);
      cursor = m.index + m[0].length - next.length; // start of the verb
    }
    rest = piece.slice(cursor);
    out.push(rest);
  }
  return out.map((c) => c.trim()).filter(Boolean);
}

function compileClause(clause: string, ctx: NLContext): NLResult {
  const t = clause.toLowerCase();

  // ── list / show ──
  const listM = /\b(?:list|show|what)\b.*\b(graphs?|plots?|charts?|tables?|datasets?|analy(?:sis|ses))\b/.exec(t);
  if (listM) {
    const w = listM[1]!;
    if (/table|dataset/.test(w)) return ok([{ op: "listTables" }]);
    if (/analy/.test(w)) return ok([{ op: "listAnalyses" }]);
    return ok([{ op: "listGraphs" }]);
  }

  // ── run an analysis ──  (checked before "create" so "run a t-test" isn't read as a graph)
  const method = METHOD_WORDS.find(([re]) => re.test(t));
  if (method && /\b(run|do|perform|fit|calculate|compute|analy(?:se|ze))\b/.test(t)) {
    const [, spec] = method;
    const cols = matchColumns(clause, ctx);
    const tableId = resolveTable(clause, ctx, cols);
    if (!tableId) return fail("I couldn't tell which table to analyse.", "Name a table, or mention its columns.");
    const columns = cols.filter((c) => c.tableId === tableId).map((c) => c.column.id);
    const params: AnalysisParams = { columns, ...(spec.variant ? { variant: spec.variant } : {}) };
    const name = `${spec.method}${spec.variant ? ` (${spec.variant})` : ""}`;
    return ok([{ op: "runAnalysis", name, method: spec.method, table: tableId, params }],
      columns.length === 0 ? "No specific columns were named, so the analysis will use the table's defaults." : undefined);
  }

  // ── change the kind of an existing graph ──  ("make it a bar chart", "turn it into a
  // violin plot"). Checked before create, because these phrasings also contain create-ish
  // words ("plot" in "violin plot", "make" in "make it") — the explicit change verb wins.
  const kind = KIND_WORDS.find(([re]) => re.test(t));
  const isChange = /\b(make it|change|turn|convert|switch|redraw)\b/.test(t) || /\binto\b/.test(t);
  if (kind && isChange) {
    if (!ctx.activeGraphId) return fail("There's no active graph to change.", "Open or select a graph first.");
    return ok([{ op: "setGraphKind", id: ctx.activeGraphId, kind: kind[1] }]);
  }

  // ── create a new graph ──
  if (kind && /\b(make|create|draw|plot|graph|chart|new|add|build|show me)\b/.test(t)) {
    const [, plotKind] = kind;
    const cols = matchColumns(clause, ctx);
    const tableId = resolveTable(clause, ctx, cols);
    if (!tableId) return fail("I couldn't tell which table to plot.", "Name a table (\"of the treatment means\"), or mention its columns.");
    const tableName = ctx.tables.find((x) => x.id === tableId)?.name ?? "data";
    return ok([{ op: "createGraph", name: `${capitalize(plotKind)} — ${tableName}`, table: tableId, kind: plotKind }]);
  }

  // ── axis edits ──
  if (/\baxis\b|\baxes\b/.test(t) || /\blog\b|\blinear\b|\breverse/.test(t)) {
    if (!ctx.activeGraphId) return fail("There's no active graph whose axis I can change.", "Open or select a graph first.");
    const axis = axisOf(t) ?? "y";
    // log / linear scale
    const scale = LOG_SCALES.find(([re]) => re.test(t));
    if (scale) return ok([{ op: "setAxis", id: ctx.activeGraphId, axis, patch: { scale: scale[1] } }]);
    if (/\blinear\b/.test(t)) return ok([{ op: "setAxis", id: ctx.activeGraphId, axis, patch: { scale: "linear" } }]);
    if (/\breverse|\bflip\b/.test(t)) return ok([{ op: "setAxis", id: ctx.activeGraphId, axis, patch: { reversed: true } }]);
    // "x axis title (to) Foo" / "title the x axis Foo" / "label the x axis Foo"
    const titleM = /(?:title|label|call(?:ed)?)\s+(?:the\s+[xy][-\s]?axis\s+)?(?:to\s+|as\s+)?["']?([^"']+?)["']?$/i.exec(clause)
      ?? /[xy][-\s]?axis\s+(?:title|label)\s+(?:to\s+|as\s+)?["']?([^"']+?)["']?$/i.exec(clause);
    if (titleM) return ok([{ op: "setAxis", id: ctx.activeGraphId, axis, patch: { title: titleM[1]!.trim() } }]);
    return fail("I saw an axis instruction but couldn't tell what to change.", "Try \"log the x axis\", \"reverse the y axis\", or \"title the x axis Dose\".");
  }

  return fail(`I couldn't parse "${clause}".`, "Try: \"scatter of dose vs response\", \"run a t-test on A and B\", \"log the x axis\", or \"list graphs\".");
}

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
