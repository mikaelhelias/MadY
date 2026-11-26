import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { MadyDocument, executeAgentCommand } from "@mady/core";
// The real app-side handler, imported across the package boundary on purpose. Testing the
// client against a hand-rolled mock would prove only that the mock matches the client; the thing
// that actually breaks is the two halves disagreeing about a header name, a path or a body
// shape, and only running one against the other can catch that.
import { handleLiveRequest, readBody } from "../../../apps/desktop/src/main/liveAgent";
import { liveExecute, liveStatus } from "./liveClient";

/**
 * Live-attach, both halves, over a real socket.
 *
 * Everything here is real except Electron: a real HTTP server running the app's own request
 * handler, a real TCP connection, the real client, and a real `MadyDocument` standing in for the
 * renderer's. Only `executeJavaScript` is replaced — by a function that does what the renderer's
 * bridge does, run the command through `executeAgentCommand`.
 *
 * Note: what this does not prove: that Electron's `webContents.executeJavaScript` returns what is
 * expected, and that `window.madyAgent` is installed in a packaged Agent build. Those need the app
 * launched, which no test here does. They are one line and one compile-time flag, both named in
 * the code, rather than something hidden behind a passing test.
 */
let server: Server | null = null;
let port = 0;

/** Start the app's handler on a real loopback socket, driving `doc` the way the bridge does. */
async function startWindow(doc: MadyDocument, opts: { hasWindow?: boolean } = {}): Promise<void> {
  const deps = {
    hasWindow: () => opts.hasWindow ?? true,
    // Stand in for the renderer: pull the command back out of the generated script and run it
    // through the SAME executor the bridge uses.
    evaluate: async (js: string) => {
      const start = js.indexOf("JSON.parse(") + "JSON.parse(".length;
      const literal = js.slice(start, js.lastIndexOf(")) :"));
      const command = JSON.parse(JSON.parse(literal) as string) as unknown;
      return executeAgentCommand(doc, command);
    },
  };
  server = createServer((req, res) => {
    void (async () => {
      const body = await readBody(req);
      const reply = body === null
        ? { status: 413, body: { ok: false, error: "body too large" } }
        : await handleLiveRequest(req, body, deps);
      res.writeHead(reply.status, { "content-type": "application/json" });
      res.end(JSON.stringify(reply.body));
    })();
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  port = (server!.address() as { port: number }).port;
}

afterEach(async () => {
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  server = null;
});

describe("driving a live window", () => {
  it("a command sent by the client lands in the WINDOW's document, not a copy", async () => {
    const doc = new MadyDocument();
    await startWindow(doc);

    const made = await liveExecute({ port }, {
      op: "createTable", name: "Live", columns: ["x", "y"], rows: [[1, 2], [3, 4]],
    });

    expect(made.ok).toBe(true);
    expect(made.attached).toBe(true);
    // The proof: the window's own document changed.
    expect(doc.toJSON().tables).toHaveLength(1);
    expect(doc.toJSON().tables[0]!.name).toBe("Live");
  });

  it("reports the executor's own result, failures included", async () => {
    const doc = new MadyDocument();
    await startWindow(doc);

    const reply = await liveExecute({ port }, { op: "getGraph", id: "nope" });
    expect(reply.ok).toBe(true); // the round trip worked …
    expect(reply.result).toMatchObject({ ok: false, code: "not_found" }); // … the command did not
  });

  it("the confirm-gate still applies through the live path", async () => {
    // Live-attach must not be a way round a safety rule. The gate lives in the executor, so it
    // holds here for free — this test is what would notice if the path ever stopped using it.
    const doc = new MadyDocument();
    await startWindow(doc);
    await liveExecute({ port }, { op: "createTable", name: "T", columns: ["x"], rows: [[1]] });
    const id = doc.toJSON().tables[0]!.id;

    const refused = await liveExecute({ port }, { op: "deleteTable", id, confirm: false });
    expect(refused.result).toMatchObject({ ok: false, code: "confirm_required" });
    expect(doc.toJSON().tables).toHaveLength(1); // still there
  });

  it("reports status, and says the window is empty when nothing is open", async () => {
    await startWindow(new MadyDocument(), { hasWindow: false });
    const status = await liveStatus({ port });
    expect(status).toMatchObject({ ok: true, attached: true, live: false });
  });

  it("says 'not attached' — with what to do — when nothing is listening, and never throws", async () => {
    // The ORDINARY case: the user is running the standard edition, or launched without the
    // opt-in variable. An agent must be told that plainly instead of getting a stack trace.
    const reply = await liveExecute({ port: 1, timeoutMs: 1000 }, { op: "listGraphs" });

    expect(reply.ok).toBe(false);
    expect(reply.attached).toBe(false);
    expect(reply.code).toBe("not_attached");
    expect(reply.error).toContain("MADY_LIVE_AGENT_PORT");
  });

  it("the client sends the header the app demands — the halves must not drift apart", async () => {
    // If either side renamed the header, every request would 403 and the only symptom would be
    // "the agent cannot drive the window". A real server + a real client is what pins it.
    const doc = new MadyDocument();
    await startWindow(doc);
    const seen: (string | undefined)[] = [];
    const original = server!.listeners("request")[0] as (...a: unknown[]) => void;
    server!.removeAllListeners("request");
    server!.on("request", (req, res) => {
      seen.push((req.headers as Record<string, string>)["x-mady-agent"]);
      original(req, res);
    });

    await liveStatus({ port });
    expect(seen[0]).toBe("1");
  });
});
