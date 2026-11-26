// @vitest-environment node
/**
 * The live-attach endpoint.
 *
 * This is the only thing in MadY that lets something outside the program act on the user's open
 * project, so its tests are mostly about what it refuses. Each rule below fails its test when the
 * rule is removed — a security check that cannot fail is a comment, not a control.
 *
 * The Electron half (wiring `mainWindow.webContents.executeJavaScript` in) is not covered here:
 * these are unit tests that do not launch the app, and a mocked BrowserWindow would only
 * assert its own stub. `deps` is injected precisely so the decisions are
 * tested for real and the untested part is one line, in plain sight.
 */
import { describe, expect, it, vi } from "vitest";
import { commandScript, handleLiveRequest, liveAgentPort, LIVE_AGENT_HEADER } from "./liveAgent";

/** A deps double: records what was evaluated, answers with a canned result. */
function deps(result: unknown = { ok: true, value: { id: "g1" } }, hasWindow = true) {
  const evaluate = vi.fn(async (_js: string) => result);
  return { evaluate, hasWindow: () => hasWindow, seen: (): string[] => evaluate.mock.calls.map((c) => c[0]) };
}

const AGENT_REQ = { method: "POST", url: "/command", headers: { [LIVE_AGENT_HEADER]: "1" } };
const BODY = JSON.stringify({ command: { op: "listGraphs" } });

describe("liveAgentPort — off unless explicitly asked for", () => {
  it("is null when the variable is absent or blank", () => {
    expect(liveAgentPort({})).toBeNull();
    expect(liveAgentPort({ MADY_LIVE_AGENT_PORT: "" })).toBeNull();
    expect(liveAgentPort({ MADY_LIVE_AGENT_PORT: "   " })).toBeNull();
  });

  it("a malformed value turns the endpoint off, never falls back to a default port", () => {
    // The server exists only when it was asked for. Falling back to a default port on a
    // malformed value would quietly open a port the user did not validly request.
    for (const bad of ["yes", "true", "9222x", "-1", "0", "65536", "80.5"]) {
      expect(liveAgentPort({ MADY_LIVE_AGENT_PORT: bad }), bad).toBeNull();
    }
  });

  it("accepts a real port", () => {
    expect(liveAgentPort({ MADY_LIVE_AGENT_PORT: "8899" })).toBe(8899);
    expect(liveAgentPort({ MADY_LIVE_AGENT_PORT: " 1 " })).toBe(1);
    expect(liveAgentPort({ MADY_LIVE_AGENT_PORT: "65535" })).toBe(65535);
  });
});

describe("what the endpoint refuses", () => {
  it("refuses a request carrying an Origin — a web page must not drive the app", () => {
    // Cross-site request forgery against localhost: any site the user visits can POST to
    // 127.0.0.1 from their browser.
    // Loopback binding does nothing about that; this rule does.
    return handleLiveRequest(
      { ...AGENT_REQ, headers: { ...AGENT_REQ.headers, origin: "https://example.com" } },
      BODY,
      deps(),
    ).then((r) => {
      expect(r.status).toBe(403);
      expect(String(r.body.error)).toContain("Origin");
    });
  });

  it("refuses a request without the custom header — the other half of the CSRF defence", async () => {
    // A cross-origin page cannot set this header without a preflight, which this server never
    // answers. Drop the rule and a form POST from any website is accepted.
    const r = await handleLiveRequest({ method: "POST", url: "/command", headers: {} }, BODY, deps());
    expect(r.status).toBe(403);
  });

  it("refuses any method that is not POST /command or GET /status", async () => {
    const r = await handleLiveRequest({ ...AGENT_REQ, method: "DELETE" }, BODY, deps());
    expect(r.status).toBe(405);
  });

  it("refuses a POST to a path it does not advertise", async () => {
    // A handler that accepted any POST would obey a client aimed at the wrong path, and the two
    // halves could drift apart in silence.
    const d = deps();
    const r = await handleLiveRequest({ ...AGENT_REQ, url: "/run" }, BODY, d);
    expect(r.status).toBe(405);
    expect(d.seen()).toHaveLength(0); // and nothing was evaluated
  });

  it("still accepts /command with a query string", async () => {
    const r = await handleLiveRequest({ ...AGENT_REQ, url: "/command?v=1" }, BODY, deps());
    expect(r.status).toBe(200);
  });

  it("says so when no window is open, rather than evaluating into nothing", async () => {
    const d = deps(undefined, false);
    const r = await handleLiveRequest(AGENT_REQ, BODY, d);
    expect(r.status).toBe(503);
    expect(d.seen()).toHaveLength(0);
  });

  it("refuses a body that is not JSON, and one with no command", async () => {
    expect((await handleLiveRequest(AGENT_REQ, "not json", deps())).status).toBe(400);
    expect((await handleLiveRequest(AGENT_REQ, "{}", deps())).status).toBe(400);
    expect((await handleLiveRequest(AGENT_REQ, JSON.stringify({ command: "listGraphs" }), deps())).status).toBe(400);
  });
});

describe("what it does when it accepts", () => {
  it("evaluates the command in the renderer and returns the bridge's own result", async () => {
    const d = deps({ ok: true, value: [{ id: "g1" }] });
    const r = await handleLiveRequest(AGENT_REQ, BODY, d);

    expect(r.status).toBe(200);
    expect(r.body.result).toEqual({ ok: true, value: [{ id: "g1" }] });
    expect(d.seen()[0]).toContain("window.madyAgent");
  });

  it("answers GET /status without needing a window", async () => {
    const r = await handleLiveRequest(
      { method: "GET", url: "/status", headers: { [LIVE_AGENT_HEADER]: "1" } },
      "",
      deps(undefined, false),
    );
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, live: false });
  });

  it("reports an evaluation failure as a value, not a crash", async () => {
    const evaluate = vi.fn(async () => {
      throw new Error("renderer went away");
    });
    const r = await handleLiveRequest(AGENT_REQ, BODY, { evaluate, hasWindow: () => true });
    expect(r.status).toBe(500);
    expect(String(r.body.error)).toContain("renderer went away");
  });
});

describe("commandScript — a code-generation boundary", () => {
  it("a hostile string in a command cannot break out of the expression", () => {
    // The command arrives as untrusted JSON. Interpolating it into source directly would let
    // a crafted string close the call and append its own statements — which, in the renderer,
    // reaches the preload bridge and the user's files. Double-encoding keeps it a string that
    // the renderer parses, so there is nothing to escape from.
    const hostileCommand = { op: "listGraphs", evil: '"); window.mady.exportFile({}); //' };
    const js = commandScript(hostileCommand);

    // The payload appears only inside a quoted literal, never as bare source.
    expect(js).not.toContain('window.mady.exportFile({}); //"');
    expect(js).toContain("JSON.parse(");
    // And it round-trips to exactly the object we were given.
    const literal = js.slice(js.indexOf("JSON.parse(") + "JSON.parse(".length, js.lastIndexOf(")) :"));
    expect(JSON.parse(JSON.parse(literal) as string)).toEqual(hostileCommand);
  });

  it("says plainly when the window has no bridge (the standard edition)", () => {
    expect(commandScript({ op: "listGraphs" })).toContain("no agent bridge");
  });
});
