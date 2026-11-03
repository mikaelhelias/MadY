/**
 * The on-device-model half of the NL seam: free-form prose → `AgentCommand[]`, for the requests
 * the deterministic parser cannot handle.
 *
 * ## What this is, and what it deliberately is not
 *
 * It is the runtime-independent half. `LocalModel` is a one-method interface — "here is a
 * prompt, give me text back" — so the runtime behind it (the desktop app's local Ollama server)
 * implements that one method and nothing else here changes.
 *
 * It does not bundle, download or depend on a model. MadY is offline by design; the desktop app
 * fetches the runtime and model only when the user asks it to, in a run with the language model
 * enabled. With no model supplied, the app uses the deterministic parser only, and reports
 * plainly when it could not parse a request.
 *
 * ## A model's output is untrusted input
 *
 * This is the whole reason this module exists rather than piping a completion into the executor.
 * A language model asked for JSON will sometimes produce a plausible command that the user never
 * asked for, and no prompt wording prevents that entirely. So:
 *
 *  - every emitted command is checked against the closed op set (`agentApiSchema()`); an unknown
 *    op is refused, never passed through in the hope the executor rejects it;
 *  - **destructive ops are refused outright**, and a model may never set `confirm: true`. The
 *    deterministic parser leaves delete verbs out, because a typed line gives no confirmation
 *    step; a model must not be the back door around that. "Tidy up my project" must never
 *    become `deleteTable`;
 *  - the batch is capped, so one confused completion cannot emit a hundred edits;
 *  - nothing is executed here. The result is a preview the caller shows or runs — the same
 *    contract the deterministic parser has, which is what makes the two interchangeable.
 *
 * The deterministic parser runs first and wins whenever it understands the line: it is faster,
 * it cannot hallucinate, and it keeps the model off the common path entirely.
 */
import { agentApiSchema } from "./agentApi";
import type { AgentCommand } from "./agentApi";
import { OP_HELP, PROMPT_EXAMPLES } from "./opHelp";
import { compileNL } from "./nlCompiler";
import type { NLCompiler, NLContext, NLResult } from "./nlCompiler";

/**
 * A local text-completion model. One method, on purpose: everything MadY needs from a model is
 * "prompt in, text out", and keeping the surface this small is what makes the runtime choice
 * reversible.
 */
export interface LocalModel {
  complete(prompt: string, opts?: { signal?: AbortSignal | undefined }): Promise<string>;
}

export interface ModelCompilerOptions {
  model: LocalModel;
  /** Refuse a completion that asks for more than this many commands. */
  maxCommands?: number;
  /** Injectable so a test can pin the prompt; defaults to the deterministic parser. */
  deterministic?: NLCompiler;
  /** Chart kinds to list for setGraphKind. Injected — PlotKind is a type-only union here. */
  kinds?: readonly string[];
}

/** Ops a model is never allowed to emit, whatever it was asked. Derived, not hand-listed. */
export function forbiddenOps(): Set<string> {
  return new Set(agentApiSchema().filter((m) => m.destructive).map((m) => m.op));
}

/** Every op a model may emit, with what each one requires — the vocabulary for the prompt. */
export function allowedOps(): { op: string; required: string[] }[] {
  return agentApiSchema()
    .filter((m) => !m.destructive)
    .map((m) => ({ op: m.op, required: m.required }));
}

/**
 * The instruction given to the model.
 *
 * A bare op list — `- setAxis (needs id, axis, patch)` — says nothing about what the op does or
 * what may go inside `patch`, and a model given only that fails in exactly those places: an
 * axis title fails because nothing says `title` belongs in the patch; a chart kind fails
 * because nothing lists the kinds.
 *
 * So the prompt carries a one-line description per op, the field names each free-form object
 * accepts (`opHelp.ts`), the chart kinds when the caller supplies them, and worked examples
 * (`PROMPT_EXAMPLES`) covering the requests a model most often gets wrong.
 *
 * Kept here, versioned with the command set it describes, so a test can assert it lists the real
 * ops rather than a stale copy of them.
 */
export function buildPrompt(text: string, ctx: NLContext, opts: { kinds?: readonly string[] } = {}): string {
  const tables = ctx.tables
    .map((t) => `  - table ${t.id} "${t.name}" columns: ${t.columns.map((c) => `${c.id} "${c.name}"`).join(", ")}`)
    .join("\n");
  /** Which required field is the free-form object whose keys `help.keys` describes. */
  const objectField = (required: string[]): string =>
    required.includes("patch") ? "patch"
      : required.includes("annotation") ? "annotation"
      : required.includes("style") ? "style"
      : "params";
  const ops = allowedOps()
    .map((o) => {
      const help = OP_HELP[o.op as keyof typeof OP_HELP];
      const does = help ? `: ${help.does}` : "";
      const needs = o.required.length ? ` — needs ${o.required.join(", ")}` : "";
      const keys = help?.keys ? `\n      ${objectField(o.required)} may contain: ${help.keys}` : "";
      return `  - ${o.op}${does}${needs}${keys}`;
    })
    .join("\n");
  const examples = PROMPT_EXAMPLES.map((e) => `  Request: ${e.ask}\n  Reply: ${e.answer}`).join("\n");
  return [
    "You translate a scientist's request into commands for a graphing program.",
    "Reply with ONLY a JSON array of command objects. No prose, no explanation, no code fence.",
    "",
    "COMMANDS:",
    ops,
    opts.kinds && opts.kinds.length > 0 ? `\nChart kinds for setGraphKind: ${opts.kinds.join(", ")}` : "",
    "",
    "THE PROJECT:",
    tables || "  (no data tables yet)",
    ctx.activeTableId ? `  active table: ${ctx.activeTableId}` : "",
    ctx.activeGraphId ? `  active graph: ${ctx.activeGraphId}` : "",
    "",
    "EXAMPLES:",
    examples,
    "",
    "RULES:",
    "- Use ONLY the commands listed. Never invent a command or a field name.",
    "- A graph's own title is setGraphOptions patch.title. An axis label is setAxis patch.title.",
    "- Answer EVERY part of the request: two instructions need two commands.",
    "- Never delete anything. There is no delete command available to you.",
    "- If the request cannot be expressed with these commands, reply with an empty array [].",
    "",
    `Request: ${text}`,
  ]
    .filter((l) => l !== "")
    .join("\n");
}

/**
 * Pull the JSON array out of a completion.
 *
 * Note: models add prose and code fences however firmly they are asked not to, so this takes the
 * first balanced `[...]` rather than demanding a clean reply. That is leniency about shape only
 * — what is inside is validated just as strictly either way.
 */
export function extractCommands(reply: string): unknown[] | null {
  const start = reply.indexOf("[");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < reply.length; i++) {
    const ch = reply[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) {
        try {
          const parsed: unknown = JSON.parse(reply.slice(start, i + 1));
          return Array.isArray(parsed) ? parsed : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** Check one emitted command. Returns the reason it is refused, or null when it is allowed. */
export function refuseReason(command: unknown, forbidden: Set<string>, known: Set<string>): string | null {
  if (typeof command !== "object" || command === null || Array.isArray(command)) {
    return "a command must be a JSON object";
  }
  const op = (command as { op?: unknown }).op;
  if (typeof op !== "string") return "a command needs a string 'op'";
  if (forbidden.has(op)) {
    // The central safety check: a model must not be the route by which "tidy up my project"
    // deletes a datasheet. Destructive ops stay a deliberate, typed act by the user or an
    // explicit agent command — never a completion.
    return `'${op}' destroys data and cannot come from a model — do it deliberately instead`;
  }
  if (!known.has(op)) return `'${op}' is not a command this program has`;
  if ((command as { confirm?: unknown }).confirm !== undefined) {
    return `a model may not set 'confirm' (on '${op}')`;
  }
  return null;
}

/**
 * Build an `NLCompiler` that tries the deterministic parser first and falls back to the model.
 *
 * The returned compiler has exactly the same contract as the deterministic one, so every caller
 * — the Ask bar, `window.madyAgent.run`, the MCP server's `run_nl` — works unchanged, and
 * swapping the model in or out is a one-line decision at the call site.
 */
export function makeModelCompiler(opts: ModelCompilerOptions): NLCompiler {
  const max = opts.maxCommands ?? 12;
  const deterministic = opts.deterministic ?? compileNL;

  return async (text: string, ctx: NLContext): Promise<NLResult> => {
    // 1. The parser that cannot hallucinate gets first refusal.
    const exact = await deterministic(text, ctx);
    if (exact.ok) return exact;

    // 2. Only then the model.
    let reply: string;
    try {
      reply = await opts.model.complete(buildPrompt(text, ctx, opts.kinds ? { kinds: opts.kinds } : {}));
    } catch (e) {
      return {
        ok: false,
        error: `the local model could not answer: ${e instanceof Error ? e.message : String(e)}`,
        hint: (exact.ok === false && exact.hint) || "try a shorter, simpler wording",
      };
    }

    const raw = extractCommands(reply);
    // Note: with exactOptionalPropertyTypes, an optional field must be omitted, not set to undefined.
    const withHint = (error: string): NLResult =>
      exact.ok === false && exact.hint !== undefined ? { ok: false, error, hint: exact.hint } : { ok: false, error };
    if (raw === null) return withHint("the local model did not return a command list");
    if (raw.length === 0) return withHint("neither the built-in command reader nor the local model could turn that into commands");
    if (raw.length > max) {
      return { ok: false, error: `the local model asked for ${raw.length} commands at once (the limit is ${max})` };
    }

    const forbidden = forbiddenOps();
    const known = new Set(agentApiSchema().map((m) => m.op));
    for (const command of raw) {
      const reason = refuseReason(command, forbidden, known);
      // One bad command refuses the whole batch. Running the acceptable prefix would leave
      // the project half-changed in a way that was neither requested nor previewed.
      if (reason !== null) return { ok: false, error: `refused: ${reason}` };
    }

    return {
      ok: true,
      commands: raw as AgentCommand[],
      note: "Written by the on-device model, not the built-in command reader — check the result; Undo is one press.",
    };
  };
}
