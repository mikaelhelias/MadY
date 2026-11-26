/**
 * The client half of live-attach: talk to a running MadY window instead of this session's own
 * in-memory project.
 *
 * The headless session is a copy — an agent edits it, saves a `.mady`, and the user opens the
 * file to see what happened. Attached, the same commands land in the window the user is looking
 * at: the graph redraws in front of them, and it is one undo away.
 *
 * Same commands, same executor. This does not give an agent any new powers. The endpoint in
 * the app hands each command to `window.madyAgent`, which is the same `executeAgentCommand` this
 * package already uses — validated, undoable, confirm-gated. What changes is which document the
 * command lands in, and nothing else.
 *
 * Note: the app opens that endpoint only when launched with `MADY_LIVE_AGENT_PORT` set, and only in
 * the Agent edition (the standard build has no `window.madyAgent` at all). So "not attached" is
 * the ordinary state, and every path here has to say so plainly rather than hang.
 */

/** The header the app requires; see the CSRF note in apps/desktop/src/main/liveAgent.ts. */
const AGENT_HEADER = "X-MadY-Agent";

/** Give up rather than hang: a window that is busy or gone must not stall the agent. */
const DEFAULT_TIMEOUT_MS = 10_000;

export interface LiveTarget {
  port: number;
  timeoutMs?: number;
}

export interface LiveReply {
  ok: boolean;
  /** The agent executor's own result, when the command reached the window. */
  result?: unknown;
  code?: string;
  error?: string;
  /** True when a window answered at all — useful to distinguish "not running" from "refused". */
  attached?: boolean;
}

function endpoint(port: number, path: string): string {
  // 127.0.0.1, never "localhost": on some Windows setups localhost resolves to ::1 first and the
  // app is listening on IPv4 only, which surfaces as a confusing ECONNREFUSED.
  return `http://127.0.0.1:${port}${path}`;
}

async function send(target: LiveTarget, path: string, init: RequestInit): Promise<LiveReply> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), target.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(endpoint(target.port, path), {
      ...init,
      headers: { ...(init.headers as Record<string, string>), [AGENT_HEADER]: "1" },
      signal: controller.signal,
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return {
        ok: false,
        attached: true,
        code: `http_${res.status}`,
        error: typeof body.error === "string" ? body.error : `the window refused the request (HTTP ${res.status})`,
      };
    }
    return { ok: true, attached: true, ...body };
  } catch (e) {
    // Note: a connection failure is the normal case (no window, or one started without the opt-in
    // variable). It is reported as a value with a message that says what to do, never thrown.
    const why = e instanceof Error && e.name === "AbortError" ? "it did not answer in time" : "nothing is listening";
    return {
      ok: false,
      attached: false,
      code: "not_attached",
      error:
        `No live MadY window on port ${target.port} — ${why}. Start the Agent edition with ` +
        `MADY_LIVE_AGENT_PORT=${target.port} set, or work headlessly (the other tools edit this ` +
        `session's own project instead).`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Is a live window there, and is it showing anything? */
export function liveStatus(target: LiveTarget): Promise<LiveReply> {
  return send(target, "/status", { method: "GET" });
}

/** Run one agent command against the live window. */
export function liveExecute(target: LiveTarget, command: unknown): Promise<LiveReply> {
  return send(target, "/command", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ command }),
  });
}
