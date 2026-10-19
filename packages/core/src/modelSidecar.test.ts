import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MODEL_URL,
  NonLoopbackModelHost,
  isLoopbackUrl,
  listServerModels,
  probeModelSidecar,
  resolveModelSidecar,
  sidecarModel,
  pullModel,
  formatBytes,
  type PullProgress,
} from "./modelSidecar";
import { makeModelCompiler } from "./modelCompiler";
import { buildCommandSchema } from "./commandSchema";
import type { NLContext } from "./nlCompiler";

/**
 * The most important test here is the loopback one.
 *
 * MadY makes no network calls, which is why unpublished data can live in it. A model client
 * could break that guarantee, because "ask a model" and "send the user's data to another
 * computer" are the same code with a different host in it — and the prompt carries the user's
 * table and column names.
 *
 * So the refusal is tested from every direction, including hosts that look like loopback and
 * are not (`127.0.0.1.evil.com`), and it is checked that there is no way to opt out of it.
 *
 * Everything else runs against a real local HTTP server standing in for Ollama, so the request
 * shape and the failure messages are exercised end to end. No model is needed, downloaded, or
 * bundled — by design.
 */
let server: Server | null = null;

async function fakeOllama(handler: (url: string, body: string) => { status: number; body: unknown }): Promise<string> {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += String(c)));
    req.on("end", () => {
      const out = handler(req.url ?? "", raw);
      res.writeHead(out.status, { "content-type": "application/json" });
      res.end(JSON.stringify(out.body));
    });
  });
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(server!.address() as { port: number }).port}`;
}

afterEach(async () => {
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  server = null;
});

describe("the offline promise", () => {
  it("recognises this machine, whatever it is spelled as", () => {
    for (const url of ["http://127.0.0.1:11434", "http://localhost:1234", "http://[::1]:80"]) {
      expect(isLoopbackUrl(url), url).toBe(true);
    }
  });

  it("refuses any host that is not this machine", () => {
    for (const url of [
      "http://api.example.com",
      "https://ollama.somewhere.net:11434",
      "http://192.168.1.50:11434",
      "http://10.0.0.1",
      // Hosts that look like loopback and are not — a prefix check would wave these through.
      "http://127.0.0.1.evil.com",
      "http://localhost.attacker.net",
      "http://notlocalhost",
    ]) {
      expect(isLoopbackUrl(url), url).toBe(false);
      expect(() => sidecarModel({ url, model: "m" }), url).toThrow(NonLoopbackModelHost);
    }
  });

  it("the refusal explains why, because the user has to understand the risk", () => {
    try {
      sidecarModel({ url: "https://api.example.com", model: "m" });
      expect.unreachable("a remote host was accepted");
    } catch (e) {
      expect(String(e)).toContain("this machine");
      expect(String(e)).toContain("column names");
    }
  });

  it("there is no env var that opts out — a remote URL fails resolution too", () => {
    expect(() => resolveModelSidecar({ MADY_MODEL_NAME: "m", MADY_MODEL_URL: "http://evil.example" }))
      .toThrow(NonLoopbackModelHost);
  });

  it("a malformed URL is not loopback (fails closed, not open)", () => {
    expect(isLoopbackUrl("not a url")).toBe(false);
    expect(isLoopbackUrl("")).toBe(false);
  });
});

describe("resolveModelSidecar — opt-in, like the stats engine", () => {
  it("is null when no model is named, so the app runs without a language model", () => {
    expect(resolveModelSidecar({})).toBeNull();
    expect(resolveModelSidecar({ MADY_MODEL_NAME: "  " })).toBeNull();
    // A URL alone must not switch it on: the app must never start talking to whatever
    // happens to be listening on a well-known port.
    expect(resolveModelSidecar({ MADY_MODEL_URL: DEFAULT_MODEL_URL })).toBeNull();
  });

  it("uses the standard local port when only a model is named", () => {
    expect(resolveModelSidecar({ MADY_MODEL_NAME: "qwen" })).toEqual({ url: DEFAULT_MODEL_URL, model: "qwen" });
  });
});

describe("talking to a real local server", () => {
  it("sends the prompt and returns the completion", async () => {
    let seen: Record<string, unknown> = {};
    const url = await fakeOllama((_u, body) => {
      seen = JSON.parse(body) as Record<string, unknown>;
      return { status: 200, body: { response: '[{"op":"listGraphs"}]' } };
    });

    const model = sidecarModel({ url, model: "qwen" });
    const out = await model.complete("hello");

    expect(out).toBe('[{"op":"listGraphs"}]');
    expect(seen.model).toBe("qwen");
    expect(seen.prompt).toBe("hello");
    // Note: the compiler must validate a whole reply; a streamed one could be half-parsed.
    expect(seen.stream).toBe(false);
    // And no reasoning trace: generating one makes a local model many times slower to answer,
    // and MadY discards the trace entirely, so it only adds latency — see modelSidecar.ts.
    expect(seen.think).toBe(false);
  });

  it("sends the schema as `format` when one is given — constrained decoding must reach the server", async () => {
    // Without this, a schema could be built, exported and documented while the request never
    // carried it: every guard in commandSchema.test.ts would still pass and the model would be
    // free-running. Removing the spread from the request body goes unnoticed without this test.
    let seen: Record<string, unknown> = {};
    const url = await fakeOllama((_u, body) => {
      seen = JSON.parse(body) as Record<string, unknown>;
      return { status: 200, body: { response: "[]" } };
    });
    const schema = buildCommandSchema({ kinds: ["bar"] });

    await sidecarModel({ url, model: "m", format: schema }).complete("hi");

    expect(seen.format, "the schema never reached the model server").toEqual(schema);
  });

  it("sends no `format` when no schema is given, so an unconstrained run stays unconstrained", async () => {
    // A caller that asks for free-form output must get free-form output: silently constraining
    // it would change what the model returns without anyone asking for that.
    let seen: Record<string, unknown> = {};
    const url = await fakeOllama((_u, body) => {
      seen = JSON.parse(body) as Record<string, unknown>;
      return { status: 200, body: { response: "[]" } };
    });

    await sidecarModel({ url, model: "m" }).complete("hi");

    expect(seen.format).toBeUndefined();
  });

  it("says to pull the model when the server has not got it", async () => {
    const url = await fakeOllama(() => ({ status: 404, body: { error: "model not found" } }));
    await expect(sidecarModel({ url, model: "missing" }).complete("hi")).rejects.toThrow(/pull it first/);
  });

  it("reports a server error rather than returning a meaningless result", async () => {
    const url = await fakeOllama(() => ({ status: 500, body: { error: "boom" } }));
    await expect(sidecarModel({ url, model: "m" }).complete("hi")).rejects.toThrow(/answered 500/);
  });

  it("times out rather than hanging the Ask bar", async () => {
    server = createServer(() => {
      /* deliberately never answers */
    });
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
    const url = `http://127.0.0.1:${(server!.address() as { port: number }).port}`;

    await expect(sidecarModel({ url, model: "m", timeoutMs: 150 }).complete("hi")).rejects.toThrow(/did not answer/);
  });
});

describe("probeModelSidecar — the ordinary states are values, not errors", () => {
  it("reports 'not configured' when no model is named", async () => {
    expect(await probeModelSidecar({})).toEqual({ configured: false, reachable: false });
  });

  it("reports a reachable server", async () => {
    const url = await fakeOllama(() => ({ status: 200, body: { models: [] } }));
    const r = await probeModelSidecar({ MADY_MODEL_NAME: "qwen", MADY_MODEL_URL: url });
    expect(r).toMatchObject({ configured: true, reachable: true, model: "qwen" });
  });

  it("says the server is not running, and what to do, without throwing", async () => {
    const r = await probeModelSidecar({ MADY_MODEL_NAME: "qwen", MADY_MODEL_URL: "http://127.0.0.1:1" });
    expect(r.configured).toBe(true);
    expect(r.reachable).toBe(false);
    expect(r.error).toContain("MADY_MODEL_NAME");
  });

  it("reports a refused remote host as a value too", async () => {
    const r = await probeModelSidecar({ MADY_MODEL_NAME: "m", MADY_MODEL_URL: "http://evil.example" });
    expect(r.reachable).toBe(false);
    expect(r.error).toContain("this machine");
  });
});

describe("end to end: a real server, through the compiler, into commands", () => {
  const CTX: NLContext = {
    tables: [{ id: "t1", name: "Doses", columns: [{ id: "c1", name: "Dose" }] }],
    activeGraphId: "g1",
  };

  it("a completion becomes validated commands", async () => {
    const url = await fakeOllama(() => ({
      status: 200,
      body: { response: 'Sure:\n```json\n[{"op":"setGraphKind","id":"g1","kind":"violin"}]\n```' },
    }));
    const compile = makeModelCompiler({ model: sidecarModel({ url, model: "m" }) });

    const r = await compile("make it a distribution-shaped thing", CTX);

    expect(r.ok).toBe(true);
    expect(r.ok && r.commands).toEqual([{ op: "setGraphKind", id: "g1", kind: "violin" }]);
  });

  it("and a completion that tries to delete is still refused, all the way through", async () => {
    const url = await fakeOllama(() => ({
      status: 200,
      body: { response: '[{"op":"deleteTable","id":"t1","confirm":true}]' },
    }));
    const compile = makeModelCompiler({ model: sidecarModel({ url, model: "m" }) });

    const r = await compile("clear out the old sheets", CTX);

    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain("destroys data");
  });
});

/**
 * Pulling a model.
 *
 * The property being protected: MadY asks the local server to fetch, so MadY's own process still
 * contacts nothing. The loopback refusal applies to a pull exactly as it applies to a prompt —
 * tested below — which keeps the README's statement of a single named network exception true.
 */
async function streamingOllama(lines: string[], status = 200): Promise<string> {
  server = createServer((req, res) => {
    res.writeHead(status, { "content-type": "application/x-ndjson" });
    for (const l of lines) res.write(l + "\n");
    res.end();
  });
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(server!.address() as { port: number }).port}`;
}

describe("pullModel", () => {
  it("refuses to pull from a host that is not this machine", async () => {
    const r = await pullModel("gemma", { url: "https://models.example.com" });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain("this machine");
  });

  it("reports the real size from the server, for the warning shown to the user", async () => {
    const url = await streamingOllama([
      JSON.stringify({ status: "pulling manifest" }),
      JSON.stringify({ status: "downloading", completed: 0, total: 5_368_709_120 }),
      JSON.stringify({ status: "downloading", completed: 2_684_354_560, total: 5_368_709_120 }),
      JSON.stringify({ status: "success" }),
    ]);
    const seen: PullProgress[] = [];

    const r = await pullModel("gemma-4-e4b", { url, onProgress: (p) => seen.push(p) });

    expect(r.ok).toBe(true);
    expect(r.ok && r.bytes).toBe(5_368_709_120);
    // The size is known from the second tick — before the bytes are actually down, which is what
    // makes an accurate "this is 5.0 GB, continue?" prompt possible.
    expect(seen[1]!.total).toBe(5_368_709_120);
    expect(formatBytes(seen[1]!.total!)).toBe("5.0 GB");
  });

  it("a failure reported inside a 200 stream is a failure, not a success", async () => {
    // Ollama reports a bad model name or a full disk in the stream body while the HTTP status
    // stays 200. Checking only the status would tell the user a download succeeded that never
    // started.
    const url = await streamingOllama([
      JSON.stringify({ status: "pulling manifest" }),
      JSON.stringify({ error: "model 'nope' not found" }),
    ]);

    const r = await pullModel("nope", { url });

    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain("not found");
  });

  it("says the server is missing — and names the ribbon button that sets one up", async () => {
    // `pullModel` itself never fetches a program: it asks a server that already runs. The one
    // place MadY does fetch the runtime is the set-up button (apps/desktop/src/main/modelRuntime.ts),
    // pinned + hashed, on the user's press — so the message points there.
    const r = await pullModel("gemma", { url: "http://127.0.0.1:1" });

    expect(r.ok).toBe(false);
    expect(r.ok === false && r.serverMissing).toBe(true);
    expect(r.ok === false && r.error).toContain("Activate, install & configure LLM");
  });

  it("survives a progress line split across two chunks", async () => {
    // NDJSON arrives in whatever pieces the socket gives; a naive per-chunk parse loses ticks.
    const whole = JSON.stringify({ status: "downloading", completed: 10, total: 100 });
    server = createServer((req, res) => {
      res.writeHead(200, { "content-type": "application/x-ndjson" });
      res.write(whole.slice(0, 12));
      // Caution: the delay is required. Two writes back to back are coalesced into one TCP
      // chunk, so the reader sees a whole line and the fixture proves nothing — without the
      // delay this test passes with buffering removed. Waiting forces a real chunk boundary mid-line.
      setTimeout(() => {
        res.write(whole.slice(12) + "\n" + JSON.stringify({ status: "success" }) + "\n");
        res.end();
      }, 50);
    });
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
    const url = `http://127.0.0.1:${(server!.address() as { port: number }).port}`;
    const seen: PullProgress[] = [];

    const r = await pullModel("m", { url, onProgress: (p) => seen.push(p) });

    expect(r.ok).toBe(true);
    expect(seen.some((p) => p.completed === 10 && p.total === 100)).toBe(true);
  });

  it("reports a refusal from the server rather than hanging", async () => {
    const url = await streamingOllama([], 500);
    const r = await pullModel("m", { url });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain("HTTP 500");
  });
});

describe("formatBytes — the number the user is warned with", () => {
  it("reads the way a person expects", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(5_368_709_120)).toBe("5.0 GB");
    expect(formatBytes(2_400_000_000)).toBe("2.2 GB");
    expect(formatBytes(15_000_000_000)).toBe("14 GB");
  });

  it("does not invent a number it does not have", () => {
    expect(formatBytes(Number.NaN)).toBe("unknown size");
    expect(formatBytes(-1)).toBe("unknown size");
  });
});

describe("listServerModels — the names a local server holds, or null when it does not answer", () => {
  it("reads /api/tags and returns the model names", async () => {
    const fetchImpl = (async (url: string) => {
      expect(String(url)).toBe("http://127.0.0.1:11434/api/tags");
      return new Response(JSON.stringify({ models: [{ name: "gemma4:12b" }, { name: "gemma3:12b" }] }), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await listServerModels("http://127.0.0.1:11434", fetchImpl)).toEqual(["gemma4:12b", "gemma3:12b"]);
  });

  it("null when the server is down, on a non-2xx, or on a body that is not the expected shape", async () => {
    const down = (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch;
    expect(await listServerModels("http://127.0.0.1:11434", down)).toBeNull();
    const bad = (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
    expect(await listServerModels("http://127.0.0.1:11434", bad)).toBeNull();
    const wrongShape = (async () => new Response("[]", { status: 200 })) as unknown as typeof fetch;
    expect(await listServerModels("http://127.0.0.1:11434", wrongShape)).toBeNull();
  });

  it("refuses a non-loopback url without calling fetch", async () => {
    const spy = vi.fn();
    expect(await listServerModels("http://models.example.com", spy as unknown as typeof fetch)).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });
});
