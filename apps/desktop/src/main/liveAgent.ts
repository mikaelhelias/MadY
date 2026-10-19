/**
 * Live-attach — let an outside agent drive the open window, so edits appear in front of the
 * user instead of in a headless copy of their project.
 *
 * No second mutation path. This does not touch the document. It evaluates
 * `window.madyAgent.execute(...)` in the renderer, which is the Agent-edition bridge that
 * already routes every command through the app's own `mutate` — the same command stack, the
 * same re-render, the same undo entry as a click. Everything the headless MCP server can do is
 * validated and confirm-gated by the same `executeAgentCommand`; nothing new is trusted here.
 *
 * ## Why a narrow endpoint and not `--remote-debugging-port`
 *
 * The obvious way to drive an Electron window from outside is to open Chromium's debugging
 * port and speak CDP. It is less code, but it grants far too much authority: a debug port
 * lets any local process evaluate
 * arbitrary JavaScript in the app — read the user's whole project, reach `window.mady`
 * (the preload bridge, which writes files), disable anything. This endpoint accepts one shape
 * of message, an `AgentCommand`, and hands it to the validated executor. A caller can do
 * exactly what the agent API allows and nothing else.
 *
 * ## The three things that keep it shut
 *
 * 1. **Off unless asked for.** No `MADY_LIVE_AGENT_PORT` in the environment, no server. There
 *    is no default port and no UI switch: starting it is a deliberate act at launch.
 * 2. **Loopback only.** Bound to 127.0.0.1, so it is not reachable from the network.
 * 3. **Not drivable by a web page.** Loopback alone is not enough: any site the user visits can
 *    POST to `http://127.0.0.1:<port>` from their browser, and a simple JSON endpoint would
 *    happily act on it (the classic localhost CSRF). So a request must carry
 *    `X-MadY-Agent: 1` — a custom header a cross-origin page cannot set without a preflight,
 *    which this server refuses — and any request carrying an `Origin` header is rejected
 *    outright, because a legitimate agent is not a browser.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

/** Requests must carry this header. See the CSRF note above — it is load-bearing, not decoration. */
export const LIVE_AGENT_HEADER = "x-mady-agent";

/** Refuse a body larger than this (bytes). A command is small; anything huge is not one. */
export const MAX_BODY_BYTES = 1_000_000;

/**
 * The port to listen on, or null for "do not start".
 *
 * Anything that is not a usable TCP port — absent, blank, non-numeric, 0, out of range —
 * means off. A typo must never fall back to a default port, because the whole safety story
 * is that the server does not exist unless it was explicitly asked for.
 */
export function liveAgentPort(env: Record<string, string | undefined>): number | null {
  const raw = env.MADY_LIVE_AGENT_PORT;
  if (raw === undefined || raw.trim() === "") return null;
  if (!/^\d+$/.test(raw.trim())) return null;
  const port = Number(raw.trim());
  return port >= 1 && port <= 65535 ? port : null;
}

/** The JS evaluated in the renderer for one command. Exported so a test can read it. */
export function commandScript(command: unknown): string {
  // JSON.stringify twice: once for the value, once to embed it as a string literal that the
  // renderer parses. Embedding the object directly would let a crafted string close the
  // expression — this is a code-generation boundary, so it is treated as one.
  return `window.madyAgent ? window.madyAgent.execute(JSON.parse(${JSON.stringify(JSON.stringify(command))})) : { ok: false, code: "not_found", error: "this window has no agent bridge (the Agent edition installs it)" }`;
}

export interface LiveAgentReply {
  status: number;
  body: Record<string, unknown>;
}

/** What the handler needs from Electron, injected so the logic is testable without a window. */
export interface LiveAgentDeps {
  /** Evaluate JS in the renderer and resolve with its value (webContents.executeJavaScript). */
  evaluate(js: string): Promise<unknown>;
  /** Whether a window is actually open to drive. */
  hasWindow(): boolean;
}

/**
 * Decide the reply for one request. Pure apart from `deps` — every rule above is enforced
 * here, so the tests exercise the real decisions rather than a paraphrase of them.
 */
export async function handleLiveRequest(
  req: { method?: string | undefined; url?: string | undefined; headers: Record<string, unknown> },
  body: string,
  deps: LiveAgentDeps,
): Promise<LiveAgentReply> {
  // A browser sends Origin on any cross-site request. An agent is not a browser.
  if (req.headers["origin"] !== undefined) {
    return { status: 403, body: { ok: false, error: "requests carrying an Origin header are refused" } };
  }
  if (req.headers[LIVE_AGENT_HEADER] === undefined) {
    return { status: 403, body: { ok: false, error: `requests must carry the ${LIVE_AGENT_HEADER} header` } };
  }
  if ((req.method ?? "").toUpperCase() === "GET" && (req.url ?? "").startsWith("/status")) {
    return { status: 200, body: { ok: true, live: deps.hasWindow(), edition: "Agent" } };
  }
  // The path is checked, not just the method. Treating any POST as a command would be looser
  // than the documented contract: a client posting to the wrong path would be silently obeyed,
  // so the two halves could drift apart without anything noticing. An endpoint this small
  // should accept exactly what it advertises.
  const path = (req.url ?? "").split("?")[0];
  if ((req.method ?? "").toUpperCase() !== "POST" || path !== "/command") {
    return { status: 405, body: { ok: false, error: "use POST /command, or GET /status" } };
  }
  if (!deps.hasWindow()) {
    return { status: 503, body: { ok: false, error: "no MadY window is open" } };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body || "null");
  } catch {
    return { status: 400, body: { ok: false, error: "body must be JSON" } };
  }
  const command = (parsed as { command?: unknown } | null)?.command;
  if (command === undefined || command === null || typeof command !== "object") {
    return { status: 400, body: { ok: false, error: "body must be {\"command\": {\"op\": …}}" } };
  }

  try {
    const result = await deps.evaluate(commandScript(command));
    // The bridge returns the executor's own typed result — a failure is a value, so it comes
    // back as HTTP 200 with ok:false, exactly as the headless server reports it.
    return { status: 200, body: { ok: true, result: result as Record<string, unknown> } };
  } catch (e) {
    return { status: 500, body: { ok: false, error: e instanceof Error ? e.message : String(e) } };
  }
}

/** Read a request body, refusing anything oversized rather than buffering it. */
export function readBody(req: IncomingMessage, max = MAX_BODY_BYTES): Promise<string | null> {
  return new Promise((resolve) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > max) {
        resolve(null);
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => resolve(null));
  });
}

/**
 * Start the endpoint, or return null when it was not asked for.
 *
 * Note: bound to 127.0.0.1 explicitly. Omitting the host makes Node listen on every interface,
 * which would put the user's open project on their network.
 */
export function startLiveAgent(
  env: Record<string, string | undefined>,
  deps: LiveAgentDeps,
  onListening?: (port: number) => void,
): Server | null {
  const port = liveAgentPort(env);
  if (port === null) return null;

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      const body = await readBody(req);
      const reply =
        body === null
          ? { status: 413, body: { ok: false, error: "body too large" } }
          : await handleLiveRequest(req, body, deps);
      res.writeHead(reply.status, { "content-type": "application/json" });
      res.end(JSON.stringify(reply.body));
    })();
  });
  server.listen(port, "127.0.0.1", () => onListening?.(port));
  return server;
}
