/**
 * The in-app agent bridge — the agent-edition-only surface that exposes the typed agent
 * API on `window.madyAgent`, so a script or the console can drive the live document.
 *
 * Kept as a tiny pure installer, separate from AppShell, for two reasons: it is unit-
 * testable without mounting the whole app, and the compile-time `__AGENT_API__` gate in
 * AppShell is the only thing that references it — so in the standard edition the gate is
 * `false`, this import is unreachable, and the bundler drops the module (and with it the
 * entire agent surface) from the artifact.
 *
 * Every mutation is routed through the app's own `apply` (its `mutate`), so an agent edit
 * goes through the exact same command-stack + re-render path as a UI edit. The agent
 * cannot reach anything the UI's mutate() can't.
 */
import { agentApiSchema, compileNL, executeAgentBatch, executeAgentCommand } from "@mady/core";
import type { AgentOpMeta, AgentResult, MadyDocument, NLContext, NLResult } from "@mady/core";

/** The current active-selection ids, read fresh on every call (the app updates them as
 *  the user switches tabs), so "the graph" / "make a scatter" resolve correctly. */
export type ActiveContext = () => { tableId?: string | undefined; graphId?: string | undefined };

/** The object installed at `window.madyAgent`. */
export interface AgentBridge {
  /** Run one command against the live document; returns a typed result (never throws). */
  execute(command: unknown): AgentResult;
  /** Run a sequence, stopping at the first failure. */
  batch(commands: readonly unknown[]): AgentResult[];
  /** Parse a line of natural language into commands without executing (a dry run). */
  compile(text: string): NLResult;
  /** Parse a line of natural language and execute it — returns what it parsed to and,
   *  if that succeeded, the execution results. */
  run(text: string): { compiled: NLResult; results?: AgentResult[] };
  /** The machine-readable command vocabulary (ops, which mutate, which are destructive). */
  schema(): AgentOpMeta[];
  /** Which edition is running — always "Agent" here (present only in the agent build). */
  readonly edition: string;
}

/**
 * Install the bridge onto `target` (normally `window`). `apply` must be the app's
 * `mutate` so a mutation recomputes derived tables and re-renders; the command runs
 * inside it and its result is captured synchronously. Returns a disposer that removes
 * the bridge (used on unmount).
 */
export function installAgentBridge(
  target: Record<string, unknown>,
  apply: (fn: (doc: MadyDocument) => void) => void,
  edition: string,
  getActive: ActiveContext = () => ({}),
): () => void {
  const withDoc = <T>(fn: (doc: MadyDocument) => T): T => {
    let out!: T;
    apply((doc) => {
      out = fn(doc);
    });
    return out;
  };
  // Build the NL context from the live tables + the current active selection. The
  // deterministic compiler is offline and pure — no model, no network.
  const buildCtx = (doc: MadyDocument): NLContext => {
    const active = getActive();
    return {
      tables: doc.toJSON().tables.map((t) => ({ id: t.id, name: t.name, columns: t.columns.map((c) => ({ id: c.id, name: c.name })) })),
      activeTableId: active.tableId,
      activeGraphId: active.graphId,
    };
  };
  const bridge: AgentBridge = {
    execute: (command) => withDoc((doc) => executeAgentCommand(doc, command)),
    batch: (commands) => withDoc((doc) => executeAgentBatch(doc, commands)),
    compile: (text) => withDoc((doc) => compileNL(text, buildCtx(doc)) as NLResult),
    run: (text) =>
      withDoc((doc) => {
        const compiled = compileNL(text, buildCtx(doc)) as NLResult;
        if (!compiled.ok) return { compiled };
        return { compiled, results: executeAgentBatch(doc, compiled.commands) };
      }),
    schema: () => agentApiSchema(),
    edition,
  };
  target.madyAgent = bridge;
  return () => {
    if (target.madyAgent === bridge) delete target.madyAgent;
  };
}
