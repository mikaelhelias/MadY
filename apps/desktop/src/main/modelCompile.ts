/**
 * `model:compile` — a typed line becomes commands, in the main process, because the model server is a
 * loopback HTTP endpoint and the renderer's fetch to it would be cross-origin.
 *
 * One path, whatever is configured:
 *   1. the exact parser (`compileNL`) — fast, offline, cannot hallucinate — gets first refusal;
 *   2. only when it refuses, and only when a model is configured, the model is asked, through
 *      `makeModelCompiler` with: the command schema as a
 *      constraint (a wrong op cannot be spelt), `think: false` (a reasoning trace is minutes of
 *      tokens MadY throws away), the chart kinds in the prompt, 30 s timeout.
 *
 * Nothing is executed here. The result is a preview the renderer shows or runs through its own
 * `mutate` — the same contract the deterministic parser has, so the two are interchangeable and
 * there is still exactly one mutation path.
 *
 * The kinds are read from the MCP server's option catalogue, not copied by hand: a
 * copy of a type-only union is exactly the drift `commandSchema.ts` refuses to introduce.
 */
import {
  buildCommandSchema,
  compileNL,
  makeModelCompiler,
  sidecarModel,
  isLoopbackUrl,
  NonLoopbackModelHost,
  type NLContext,
  type NLResult,
} from "@mady/core";
import catalog from "../../../../packages/mcp-server/src/optionCatalog.json" with { type: "json" };

/** The chart kinds the model is told about — the option catalogue's list. */
export const COMPILE_KINDS: readonly string[] = (catalog as { kinds: string[] }).kinds;

const MAX_COMMANDS = 12;
const TIMEOUT_MS = 30_000;

export interface CompileSettings {
  /** The loopback server. */
  url: string;
  /** The model tag, or null for "exact parser only". */
  model: string | null;
  fetchImpl?: typeof fetch | undefined;
  timeoutMs?: number | undefined;
}

/**
 * Compile one line. Never throws: a down server, a refused batch or a bad url are all returned
 * as values the bar can show.
 */
export async function compileLine(text: string, ctx: NLContext, settings: CompileSettings): Promise<NLResult> {
  const url = settings.url.replace(/\/+$/, "");
  if (!isLoopbackUrl(url)) return { ok: false, error: new NonLoopbackModelHost(url).message };

  // No model: the exact parser is the whole story.
  if (settings.model === null) return compileNL(text, ctx) as NLResult;

  try {
    const compiler = makeModelCompiler({
      model: sidecarModel({
        url,
        model: settings.model,
        timeoutMs: settings.timeoutMs ?? TIMEOUT_MS,
        format: buildCommandSchema({ maxCommands: MAX_COMMANDS, kinds: COMPILE_KINDS }),
        ...(settings.fetchImpl ? { fetchImpl: settings.fetchImpl } : {}),
      }),
      maxCommands: MAX_COMMANDS,
      kinds: COMPILE_KINDS,
    });
    return await compiler(text, ctx);
  } catch (e) {
    return { ok: false, error: `the local model could not be asked: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/**
 * The short round trip every set-up ends with: one word in, one word out. A configuration is
 * saved only after the model has answered, so the app never shows a model as connected that
 * cannot reply.
 */
export async function testModel(settings: CompileSettings): Promise<{ ok: true; ms: number } | { ok: false; error: string }> {
  const url = settings.url.replace(/\/+$/, "");
  if (!isLoopbackUrl(url)) return { ok: false, error: new NonLoopbackModelHost(url).message };
  if (settings.model === null) return { ok: false, error: "no model is configured" };
  const started = Date.now();
  try {
    const model = sidecarModel({
      url,
      model: settings.model,
      timeoutMs: settings.timeoutMs ?? TIMEOUT_MS,
      ...(settings.fetchImpl ? { fetchImpl: settings.fetchImpl } : {}),
    });
    await model.complete("Reply with the single word OK.");
    return { ok: true, ms: Date.now() - started };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
