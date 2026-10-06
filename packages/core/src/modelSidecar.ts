/**
 * The sidecar implementation of `LocalModel`.
 *
 * MadY already works this way once: the Python statistics engine is a local process MadY talks
 * to. This is the same shape for a local model server (Ollama, `llama.cpp --server`, anything
 * that speaks one of the two request shapes below). It reuses that idea rather than pulling a
 * native runtime into the app's own process.
 *
 * Nothing is bundled here, and MadY's own process downloads nothing (`pullModel` below asks the
 * local server to do it). This connects to a server already running on this machine. Shipping a
 * runtime and weights inside the installer would be a gigabyte-scale packaging and licensing
 * decision, so this is opt-in: no `MADY_MODEL_NAME`, no model (`MADY_MODEL_URL` only says where
 * the server listens), and the app behaves exactly as it does without the feature.
 *
 * ## The offline guarantee, and the guard that keeps it
 *
 * MadY makes no network calls, which is why a scientist can put unpublished data in it. A model
 * client could break that guarantee, because "talk to a model server" and "send the user's data
 * to another computer" are the same code with a different host in it.
 *
 * So the host is checked, and a non-loopback host is refused — not warned about, refused. A
 * request to 127.0.0.1 is one process on this machine talking to another, exactly like the stats
 * engine. A request to anywhere else would send the user's data off the machine through the same
 * code path. There is no setting to turn that off; a user who wants a remote model can put a
 * proxy on their own machine and make that decision explicitly.
 *
 * The prompt carries the user's table and column names (it has to, to resolve "dose"), so this
 * is not a theoretical distinction.
 */
import type { LocalModel } from "./modelCompiler";

/** Where a local model server is expected, when the user has not said otherwise. */
export const DEFAULT_MODEL_URL = "http://127.0.0.1:11434";

/** Hostnames that mean "this machine". Anything else is refused — see the header. */
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]", "0:0:0:0:0:0:0:1"]);

export class NonLoopbackModelHost extends Error {
  constructor(host: string) {
    super(
      `refusing to send prompts to '${host}': MadY talks to a model on this machine only. ` +
        `Your data — table and column names — goes into the prompt, and a remote host would be ` +
        `sending it off the computer. Run the model locally, or put a proxy on 127.0.0.1 and ` +
        `own that choice explicitly.`,
    );
    this.name = "NonLoopbackModelHost";
  }
}

/** True when `url` points at this machine. Exported because it is the guard worth testing. */
export function isLoopbackUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  // `hostname` strips the brackets IPv6 URLs carry, so both spellings are covered.
  return LOOPBACK.has(parsed.hostname.toLowerCase());
}

export interface SidecarOptions {
  /** Base URL of the local model server. Must be loopback. */
  url?: string;
  /** Model name the server should load, e.g. a small instruct model. */
  model?: string;
  /** Give up rather than hang — the Ask bar must stay responsive. */
  timeoutMs?: number;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /**
   * A JSON Schema the server must constrain generation to (`buildCommandSchema()`).
   *
   * The difference between hoping a model spells `setGraphKind` correctly and it being unable
   * to spell it any other way. Omit it and the model is free-running.
   */
  format?: Record<string, unknown> | undefined;
}

/**
 * Read the sidecar settings from the environment, or null when none was configured.
 *
 * Mirrors `resolveEngine()`: an explicit env var wins, and absence means "not set up" rather
 * than a guessed default — the app must not quietly start talking to whatever happens to be
 * listening on a well-known port.
 */
export function resolveModelSidecar(
  env: Record<string, string | undefined>,
): { url: string; model: string } | null {
  const model = env.MADY_MODEL_NAME;
  if (model === undefined || model.trim() === "") return null;
  const url = env.MADY_MODEL_URL?.trim() || DEFAULT_MODEL_URL;
  if (!isLoopbackUrl(url)) throw new NonLoopbackModelHost(url);
  return { url: url.replace(/\/+$/, ""), model: model.trim() };
}

interface OllamaReply { response?: unknown; error?: unknown }

/**
 * A `LocalModel` backed by a local server speaking Ollama's `/api/generate`.
 *
 * Note: `stream: false` is deliberate. The compiler needs the whole completion before it can
 * validate it, and a half-parsed command list must never reach the executor.
 */
export function sidecarModel(opts: SidecarOptions & { model: string }): LocalModel {
  const url = (opts.url ?? DEFAULT_MODEL_URL).replace(/\/+$/, "");
  if (!isLoopbackUrl(url)) throw new NonLoopbackModelHost(url);
  const doFetch = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 30_000;

  return {
    async complete(prompt: string): Promise<string> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await doFetch(`${url}/api/generate`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          // `think: false` is required. Gemma 4 and similar models emit a reasoning trace before
          // the answer by default, and MadY discards every token of it — it only wants the JSON.
          // With thinking on, a model such as gemma4:12b can take minutes to answer a command it
          // answers in a few seconds with thinking off. That is the difference between a
          // responsive Ask bar and a hang.
          // Harmless where it does not apply: a model with no thinking capability (gemma3, for
          // one) accepts and ignores it.
          body: JSON.stringify({
            model: opts.model,
            prompt,
            stream: false,
            think: false,
            // Constrained decoding when a schema was given: the server will not emit a
            // token that breaks it, so a malformed command becomes impossible rather than
            // merely refused downstream.
            ...(opts.format ? { format: opts.format } : {}),
          }),
          signal: controller.signal,
        });
        if (!res.ok) {
          // A missing model is the everyday failure, and the message has to say what to do.
          const detail = await res.text().catch(() => "");
          throw new Error(
            res.status === 404
              ? `the local model server has no model called '${opts.model}' — pull it first`
              : `the local model server answered ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
          );
        }
        const body = (await res.json()) as OllamaReply;
        if (typeof body.error === "string") throw new Error(body.error);
        if (typeof body.response !== "string") throw new Error("the local model server returned no completion");
        return body.response;
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") {
          throw new Error(`the local model did not answer within ${timeoutMs}ms`);
        }
        throw e;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/**
 * The model names a local server holds (`GET /api/tags`), or null when it does not answer, is
 * not 2xx, or sends something that is not the expected shape. A value, never a throw — "the
 * server is down" is an ordinary state the status has to render calmly. Loopback only, as
 * everything here.
 */
export async function listServerModels(url: string, fetchImpl: typeof fetch = fetch): Promise<string[] | null> {
  const base = url.replace(/\/+$/, "");
  if (!isLoopbackUrl(base)) return null;
  try {
    const res = await fetchImpl(`${base}/api/tags`, { method: "GET", signal: AbortSignal.timeout(2000) });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
    const models = (body as { models?: unknown }).models;
    if (!Array.isArray(models)) return null;
    return models
      .map((m) => (typeof m === "object" && m !== null ? (m as { name?: unknown }).name : undefined))
      .filter((n): n is string => typeof n === "string");
  } catch {
    return null;
  }
}

/**
 * Is a local model server reachable, and does it have the model?
 *
 * Returned as a value, never thrown: "no model configured" and "the server is not running" are
 * the ordinary states, and the app has to render them calmly rather than treat them as errors.
 */
export async function probeModelSidecar(
  env: Record<string, string | undefined>,
  fetchImpl: typeof fetch = fetch,
): Promise<{ configured: boolean; reachable: boolean; model?: string; url?: string; error?: string }> {
  let resolved: { url: string; model: string } | null;
  try {
    resolved = resolveModelSidecar(env);
  } catch (e) {
    return { configured: true, reachable: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (!resolved) return { configured: false, reachable: false };
  try {
    const res = await fetchImpl(`${resolved.url}/api/tags`, { method: "GET" });
    return { configured: true, reachable: res.ok, model: resolved.model, url: resolved.url };
  } catch (e) {
    return {
      configured: true,
      reachable: false,
      model: resolved.model,
      url: resolved.url,
      error: `no local model server is running at ${resolved.url} — start it, set one up with “Activate, install & configure LLM” on the ribbon, or unset MADY_MODEL_NAME to use only the built-in command reader`,
    };
  }
}

// ── getting a model onto the machine ──────────────────────────────────────────────

/**
 * Why this does not widen the single network exception (the README names exactly one: the
 * ribbon's set-up button fetching the runtime).
 *
 * A model is gigabytes, so it is not shipped in the installer — the user fetches one. Having
 * MadY download it directly would contradict the README and make MadY fetch binaries from the
 * internet.
 *
 * It does not have to. `/api/pull` is a request to `127.0.0.1`: the local model server does the
 * downloading, using software the user already installed for exactly this purpose. MadY asks a
 * program on this machine to fetch something and reports its progress. **MadY's own process
 * still contacts nothing** — the loopback refusal above applies here unchanged, and a remote URL
 * is refused in the same way.
 *
 * Deliberately not done here: if the model server is not installed at all, this code does not
 * download and run an installer for it. That is a different risk class — fetching a binary from
 * the internet and executing it. Installing the runtime belongs to the ribbon's set-up button
 * alone (the desktop app's `modelRuntime.ts`, pinned and hash-checked, on the user's press).
 * This case is reported as `serverMissing` so the app can send the user to that button.
 */
export interface PullProgress {
  /** The server's own word for what it is doing ("pulling manifest", "downloading", "verifying"). */
  status: string;
  /** Bytes fetched so far, and the total, once the server knows them. */
  completed?: number;
  total?: number;
}

export type PullResult =
  | { ok: true; model: string; bytes?: number }
  | { ok: false; serverMissing: true; url: string; error: string }
  | { ok: false; serverMissing?: false; error: string };

/**
 * Ask the local model server to fetch a model, reporting progress as it goes.
 *
 * `onProgress` is called with the server's own byte counts, so the app can show a real size
 * before much has been downloaded — the size warning is a fact from the server, not a number
 * hard-coded here that would go stale when a model is requantised.
 */
export async function pullModel(
  model: string,
  opts: { url?: string; fetchImpl?: typeof fetch; onProgress?: (p: PullProgress) => void; signal?: AbortSignal } = {},
): Promise<PullResult> {
  const url = (opts.url ?? DEFAULT_MODEL_URL).replace(/\/+$/, "");
  // The same refusal as everywhere else in this file: a pull is still a request, and a remote
  // one would be MadY reaching off the machine.
  if (!isLoopbackUrl(url)) return { ok: false, error: new NonLoopbackModelHost(url).message };
  const doFetch = opts.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await doFetch(`${url}/api/pull`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, stream: true }),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
  } catch {
    return {
      ok: false,
      serverMissing: true,
      url,
      error:
        `No local model server is running at ${url}. Press “Activate, install & configure LLM” on ` +
        `the ribbon to set one up on this machine — or start your own Ollama and press this again.`,
    };
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return { ok: false, error: `the model server refused the download (HTTP ${res.status})${detail ? `: ${detail.slice(0, 200)}` : ""}` };
  }
  if (!res.body) return { ok: false, error: "the model server sent no progress stream" };

  // Newline-delimited JSON, one object per progress tick.
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  let lastTotal: number | undefined;
  let failure: string | null = null;

  const handleLine = (line: string): void => {
    if (line.trim() === "") return;
    let tick: { status?: unknown; error?: unknown; total?: unknown; completed?: unknown };
    try {
      tick = JSON.parse(line) as typeof tick;
    } catch {
      return; // a partial or noisy line is not a failure; the stream continues
    }
    // Caution: the server reports failure inside a 200 stream (a bad model name, no disk space), so a
    // pull that only checked the HTTP status would report success for a download that never
    // happened.
    if (typeof tick.error === "string") {
      failure = tick.error;
      return;
    }
    if (typeof tick.total === "number") lastTotal = tick.total;
    opts.onProgress?.({
      status: typeof tick.status === "string" ? tick.status : "downloading",
      ...(typeof tick.completed === "number" ? { completed: tick.completed } : {}),
      ...(typeof tick.total === "number" ? { total: tick.total } : {}),
    });
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";
      for (const line of lines) handleLine(line);
    }
    handleLine(buffered);
  } catch (e) {
    return { ok: false, error: `the download stopped: ${e instanceof Error ? e.message : String(e)}` };
  }

  if (failure !== null) return { ok: false, error: failure };
  return { ok: true, model, ...(lastTotal !== undefined ? { bytes: lastTotal } : {}) };
}

/** Human-readable bytes, for the size warning the user sees before agreeing to a download. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "unknown size";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}
