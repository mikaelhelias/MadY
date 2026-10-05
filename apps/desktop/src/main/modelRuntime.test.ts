/**
 * The Ollama runtime: fetched on request, verified, unpacked, started and stopped by MadY.
 *
 * The fakes stand in for the two things the code touches that a unit test must not:
 * the internet (a fetch that serves bytes we choose) and processes (a spawn that records what
 * it was asked to run and lets the test decide how the child behaves).
 */
import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  OLLAMA_ASSETS,
  OLLAMA_BLURB,
  OLLAMA_VERSION,
  OllamaRuntime,
  downloadVerified,
  extractArchive,
  installRuntime,
  runtimeAsset,
  runtimeExePath,
  runtimeInstalled,
  type RuntimeAsset,
} from "./modelRuntime";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "mady-runtime-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const sha256 = (b: Buffer): string => createHash("sha256").update(b).digest("hex");

/** A fake asset whose bytes and hash the test controls. */
function fakeAsset(body: Buffer, overrides: Partial<RuntimeAsset> = {}): RuntimeAsset {
  return {
    name: "ollama-test.zip",
    url: "https://example.invalid/ollama-test.zip",
    sha256: sha256(body),
    bytes: body.length,
    ...overrides,
  };
}

/**
 * A fetch that serves `body`, honouring `Range: bytes=N-` with a 206 when `ranges` is true.
 * Records every request so a test can assert on the headers sent.
 */
function fakeFetch(body: Buffer, opts: { ranges?: boolean; status?: number; chunk?: number } = {}) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const impl = vi.fn(async (url: string | URL, init?: RequestInit): Promise<Response> => {
    const headers = Object.fromEntries(
      Object.entries((init?.headers as Record<string, string>) ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
    );
    calls.push({ url: String(url), headers });
    if (opts.status && opts.status >= 400) return new Response("nope", { status: opts.status });
    let from = 0;
    let status = 200;
    const range = headers["range"];
    if (range && opts.ranges) {
      from = Number(/bytes=(\d+)-/.exec(range)?.[1] ?? 0);
      status = 206;
    }
    const slice = body.subarray(from);
    const size = opts.chunk ?? 7;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < slice.length; i += size) controller.enqueue(slice.subarray(i, i + size));
        controller.close();
      },
    });
    return new Response(stream, { status, headers: { "content-length": String(slice.length) } });
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

/** Wait until the fake spawn has been asked for something — the code awaits a mkdir first. */
async function untilCalled(fn: { mock: { calls: unknown[] } }): Promise<void> {
  for (let i = 0; i < 200 && fn.mock.calls.length === 0; i++) await new Promise((r) => setTimeout(r, 1));
}

/** A fake child process: the test emits its exit and stderr. */
class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  pid = 4242;
  kill = vi.fn(() => true);
}

describe("the pinned release", () => {
  it("names a version, and every asset carries a URL under that version, a 64-hex sha256 and a size", () => {
    expect(OLLAMA_VERSION).toMatch(/^v\d+\.\d+\.\d+$/);
    const keys = Object.keys(OLLAMA_ASSETS);
    expect(keys).toContain("win32-x64");
    for (const k of keys) {
      const a = OLLAMA_ASSETS[k]!;
      expect(a.url).toContain(`/releases/download/${OLLAMA_VERSION}/`);
      expect(a.url.startsWith("https://")).toBe(true);
      expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(a.bytes).toBeGreaterThan(1_000_000);
      expect(a.name.endsWith(".zip")).toBe(true);
      // A measured unpacked size is bigger than the archive (it is compressed) and not absurd.
      if (a.unpackedBytes !== undefined) {
        expect(a.unpackedBytes).toBeGreaterThan(a.bytes);
        expect(a.unpackedBytes).toBeLessThan(a.bytes * 3);
      }
    }
    // The build users actually get has been measured — the dialog must not say "about" there.
    expect(OLLAMA_ASSETS["win32-x64"]!.unpackedBytes).toBeGreaterThan(0);
  });

  it("picks the asset for this platform, and refuses one it has no pin for", () => {
    expect(runtimeAsset("win32", "x64")).toBe(OLLAMA_ASSETS["win32-x64"]);
    expect(runtimeAsset("win32", "arm64")).toBe(OLLAMA_ASSETS["win32-arm64"]);
    expect(runtimeAsset("linux", "x64")).toBeNull();
    expect(runtimeAsset("win32", "ia32")).toBeNull();
  });

  it("has a one-sentence blurb the dialog shows, and it says the thing stays on this machine", () => {
    expect(OLLAMA_BLURB.split(/[.!?]\s/).length).toBeLessThanOrEqual(2);
    expect(OLLAMA_BLURB.toLowerCase()).toContain("this computer");
    // "small" would mislead for a 1.4 GB download: the size is given as a number beside it, not an adjective.
    expect(OLLAMA_BLURB.toLowerCase()).not.toContain("small");
  });
});

describe("where the runtime lives", () => {
  it("is <root>/ollama/ollama(.exe), and 'installed' means that file exists", async () => {
    expect(runtimeExePath(dir, "win32")).toBe(join(dir, "ollama", "ollama.exe"));
    expect(runtimeExePath(dir, "linux")).toBe(join(dir, "ollama", "ollama"));
    expect(await runtimeInstalled(dir, "win32")).toBe(false);
    await mkdir(join(dir, "ollama"), { recursive: true });
    await writeFile(join(dir, "ollama", "ollama.exe"), "x");
    expect(await runtimeInstalled(dir, "win32")).toBe(true);
  });
});

describe("downloadVerified — the archive is hashed as it arrives and refused on a mismatch", () => {
  const body = Buffer.from("the quick brown fox jumps over the lazy dog ".repeat(40));

  it("streams to a .part file, reports progress with the total, verifies, then renames", async () => {
    const asset = fakeAsset(body);
    const f = fakeFetch(body);
    const dest = join(dir, asset.name);
    const ticks: { received: number; total?: number | undefined }[] = [];
    const r = await downloadVerified(asset, dest, { fetchImpl: f.impl, onProgress: (p) => ticks.push(p) });
    expect(r).toEqual({ ok: true, bytes: body.length });
    expect(await readFile(dest)).toEqual(body);
    await expect(stat(dest + ".part")).rejects.toThrow();
    expect(ticks.length).toBeGreaterThan(1);
    expect(ticks[ticks.length - 1]).toEqual({ received: body.length, total: body.length });
    expect(f.calls[0]!.url).toBe(asset.url);
  });

  it("a wrong hash leaves NO file behind and says so", async () => {
    const asset = fakeAsset(body, { sha256: "0".repeat(64) });
    const f = fakeFetch(body);
    const dest = join(dir, asset.name);
    const r = await downloadVerified(asset, dest, { fetchImpl: f.impl });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("hash");
    expect(r.error).toMatch(/checksum|sha-?256/i);
    await expect(stat(dest)).rejects.toThrow();
    await expect(stat(dest + ".part")).rejects.toThrow();
  });

  it("a wrong byte count is also a refusal, even when the hash of what arrived matches", async () => {
    // The pin says 10 bytes more than the server sent. A truncated archive must not pass on
    // the strength of hashing exactly what arrived.
    const asset = fakeAsset(body, { bytes: body.length + 10 });
    const f = fakeFetch(body);
    const r = await downloadVerified(asset, join(dir, asset.name), { fetchImpl: f.impl });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("hash");
  });

  it("resumes an interrupted download from the .part with a Range header, and the whole file still verifies", async () => {
    const asset = fakeAsset(body);
    const dest = join(dir, asset.name);
    await writeFile(dest + ".part", body.subarray(0, 100));
    const f = fakeFetch(body, { ranges: true });
    const r = await downloadVerified(asset, dest, { fetchImpl: f.impl });
    expect(r).toEqual({ ok: true, bytes: body.length });
    expect(f.calls[0]!.headers["range"]).toBe("bytes=100-");
    expect(await readFile(dest)).toEqual(body);
  });

  it("when the server ignores the Range and sends 200, the .part is discarded and the file is still whole", async () => {
    const asset = fakeAsset(body);
    const dest = join(dir, asset.name);
    await writeFile(dest + ".part", Buffer.from("invalid partial bytes"));
    const f = fakeFetch(body, { ranges: false });
    const r = await downloadVerified(asset, dest, { fetchImpl: f.impl });
    expect(r).toEqual({ ok: true, bytes: body.length });
    expect(await readFile(dest)).toEqual(body);
  });

  it("an HTTP error is reported as such, with the status, and nothing is written", async () => {
    const asset = fakeAsset(body);
    const f = fakeFetch(body, { status: 503 });
    const r = await downloadVerified(asset, join(dir, asset.name), { fetchImpl: f.impl });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("http");
      expect(r.error).toContain("503");
    }
  });

  it("a network failure is reported as such, and the .part is kept so the next press resumes", async () => {
    const asset = fakeAsset(body);
    const dest = join(dir, asset.name);
    await writeFile(dest + ".part", body.subarray(0, 50));
    const failing = vi.fn(async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;
    const r = await downloadVerified(asset, dest, { fetchImpl: failing });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("network");
    expect((await stat(dest + ".part")).size).toBe(50);
  });

  it("refuses to fetch anything but https", async () => {
    const asset = fakeAsset(body, { url: "http://example.invalid/x.zip" });
    const f = fakeFetch(body);
    const r = await downloadVerified(asset, join(dir, asset.name), { fetchImpl: f.impl });
    expect(r.ok).toBe(false);
    expect(f.impl).not.toHaveBeenCalled();
  });
});

describe("extractArchive — the system tar unpacks it, and its failure is reported in its own words", () => {
  it("runs tar -xf <archive> -C <dest> and resolves on exit 0", async () => {
    const child = new FakeChild();
    const spawnImpl = vi.fn(() => child);
    const p = extractArchive(join(dir, "a.zip"), join(dir, "out"), { spawnImpl: spawnImpl as never, tarPath: "tar" });
    await untilCalled(spawnImpl);
    expect(spawnImpl).toHaveBeenCalledWith("tar", ["-xf", join(dir, "a.zip"), "-C", join(dir, "out")], expect.anything());
    child.emit("exit", 0, null);
    expect(await p).toEqual({ ok: true });
    // The destination exists — tar -C needs it.
    expect((await stat(join(dir, "out"))).isDirectory()).toBe(true);
  });

  it("a non-zero exit carries tar's own stderr", async () => {
    const child = new FakeChild();
    const spawnImpl = vi.fn(() => child);
    const p = extractArchive(join(dir, "a.zip"), join(dir, "out"), { spawnImpl: spawnImpl as never, tarPath: "tar" });
    await untilCalled(spawnImpl);
    child.stderr.emit("data", Buffer.from("tar: Unrecognized archive format"));
    child.emit("exit", 1, null);
    const r = await p;
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("Unrecognized archive format");
  });

  it("a tar that cannot be started is an error, not a hang", async () => {
    const child = new FakeChild();
    const spawnImpl = vi.fn(() => child);
    const p = extractArchive(join(dir, "a.zip"), join(dir, "out"), { spawnImpl: spawnImpl as never, tarPath: "no-such-tar" });
    await untilCalled(spawnImpl);
    child.emit("error", new Error("spawn no-such-tar ENOENT"));
    const r = await p;
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("ENOENT");
  });
});

describe("OllamaRuntime — start uses an existing server, else spawns ours; stop kills only ours", () => {
  const reachable = vi.fn(async () => new Response(JSON.stringify({ version: "0.33.3" }), { status: 200 }));
  const unreachable = vi.fn(async () => {
    throw new Error("ECONNREFUSED");
  });

  it("an Ollama already answering on the loopback port is used, and nothing is spawned", async () => {
    const spawnImpl = vi.fn();
    const rt = new OllamaRuntime({ exe: "C:/x/ollama.exe", modelsDir: join(dir, "models"), fetchImpl: reachable as never, spawnImpl: spawnImpl as never });
    const r = await rt.start();
    expect(r).toEqual({ ok: true, external: true });
    expect(spawnImpl).not.toHaveBeenCalled();
    expect(await rt.status()).toBe("external");
  });

  it("spawns `ollama serve` bound to 127.0.0.1 with the model store under our folder, and waits until it answers", async () => {
    let up = false;
    const fetchImpl = vi.fn(async () => {
      if (!up) throw new Error("ECONNREFUSED");
      return new Response("{}", { status: 200 });
    });
    const child = new FakeChild();
    const spawnImpl = vi.fn(() => {
      up = true;
      return child;
    });
    const rt = new OllamaRuntime({
      exe: "C:/x/ollama.exe",
      modelsDir: join(dir, "models"),
      fetchImpl: fetchImpl as never,
      spawnImpl: spawnImpl as never,
      pollMs: 1,
    });
    const r = await rt.start();
    expect(r).toEqual({ ok: true, external: false });
    expect(spawnImpl).toHaveBeenCalledOnce();
    const [cmd, args, opts] = spawnImpl.mock.calls[0] as unknown as [string, string[], { env: Record<string, string> }];
    expect(cmd).toBe("C:/x/ollama.exe");
    expect(args).toEqual(["serve"]);
    expect(opts.env.OLLAMA_HOST).toBe("127.0.0.1:11434");
    expect(opts.env.OLLAMA_MODELS).toBe(join(dir, "models"));
    expect(await rt.status()).toBe("ours");
  });

  it("a child that exits before answering is an error that carries its stderr", async () => {
    const child = new FakeChild();
    const spawnImpl = vi.fn(() => {
      setTimeout(() => {
        child.stderr.emit("data", Buffer.from("Error: listen tcp 127.0.0.1:11434: bind: permission denied"));
        child.emit("exit", 1, null);
      }, 2);
      return child;
    });
    const rt = new OllamaRuntime({ exe: "x", modelsDir: dir, fetchImpl: unreachable as never, spawnImpl: spawnImpl as never, pollMs: 1, startTimeoutMs: 200 });
    const r = await rt.start();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("permission denied");
  });

  it("a child that never answers is a timeout, not a hang, and is killed", async () => {
    const child = new FakeChild();
    const rt = new OllamaRuntime({ exe: "x", modelsDir: dir, fetchImpl: unreachable as never, spawnImpl: (() => child) as never, pollMs: 1, startTimeoutMs: 20, platform: "linux" });
    const r = await rt.start();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/did not answer|timed out/i);
    expect(child.kill).toHaveBeenCalled();
  });

  it("stop() kills the child it spawned — the whole tree on Windows — and never an external server", async () => {
    // Ours, on Windows: taskkill on the pid, tree + force, so the runner subprocesses go too.
    let up = false;
    const fetchImpl = vi.fn(async () => {
      if (!up) throw new Error("ECONNREFUSED");
      return new Response("{}", { status: 200 });
    });
    const child = new FakeChild();
    const spawnImpl = vi.fn((cmd: string) => {
      if (cmd === "taskkill") {
        const k = new FakeChild();
        setTimeout(() => k.emit("exit", 0, null), 1);
        return k;
      }
      up = true;
      return child;
    });
    const rt = new OllamaRuntime({ exe: "x", modelsDir: dir, fetchImpl: fetchImpl as never, spawnImpl: spawnImpl as never, pollMs: 1, platform: "win32" });
    await rt.start();
    await rt.stop();
    const kill = spawnImpl.mock.calls.find((c) => c[0] === "taskkill") as unknown as [string, string[]] | undefined;
    expect(kill?.[1]).toEqual(["/pid", "4242", "/t", "/f"]);

    // External: nothing to kill.
    const spawn2 = vi.fn();
    const ext = new OllamaRuntime({ exe: "x", modelsDir: dir, fetchImpl: reachable as never, spawnImpl: spawn2 as never });
    await ext.start();
    await ext.stop();
    expect(spawn2).not.toHaveBeenCalled();
  });

  it("refuses a non-loopback URL outright", () => {
    expect(() => new OllamaRuntime({ exe: "x", modelsDir: dir, url: "http://models.example.com:11434" })).toThrow(/loopback|this machine/i);
  });
});

describe("installRuntime — the steps in order, each failure naming its step", () => {
  const body = Buffer.from("PK-fake-archive-".repeat(100));

  it("download → verify → unpack → start, deleting the archive after a good unpack", async () => {
    const asset = fakeAsset(body);
    const f = fakeFetch(body);
    const steps: string[] = [];
    // tar: a fake that "unpacks" by writing the exe where the runtime expects it.
    const tarChild = new FakeChild();
    const serveChild = new FakeChild();
    let served = false;
    const spawnImpl = vi.fn((cmd: string) => {
      if (cmd.endsWith("tar")) {
        void mkdir(join(dir, "ollama"), { recursive: true })
          .then(() => writeFile(join(dir, "ollama", "ollama.exe"), "exe"))
          .then(() => tarChild.emit("exit", 0, null));
        return tarChild;
      }
      served = true;
      return serveChild;
    });
    const probe = vi.fn(async () => {
      if (!served) throw new Error("ECONNREFUSED");
      return new Response("{}", { status: 200 });
    });
    const r = await installRuntime({
      root: dir,
      asset,
      platform: "win32",
      fetchImpl: f.impl,
      probeImpl: probe as never,
      spawnImpl: spawnImpl as never,
      tarPath: "tar",
      pollMs: 1,
      onProgress: (p) => {
        if (steps[steps.length - 1] !== p.step) steps.push(p.step);
      },
    });
    expect(r.ok).toBe(true);
    expect(steps).toEqual(["download", "verify", "unpack", "start"]);
    // The 1.4 GB archive is not kept beside the 1.4 GB it unpacked to.
    await expect(stat(join(dir, "downloads", asset.name))).rejects.toThrow();
    expect(await runtimeInstalled(dir, "win32")).toBe(true);
  });

  it("a bad checksum stops at 'verify' and nothing is unpacked or started", async () => {
    const asset = fakeAsset(body, { sha256: "f".repeat(64) });
    const f = fakeFetch(body);
    const spawnImpl = vi.fn();
    const r = await installRuntime({ root: dir, asset, platform: "win32", fetchImpl: f.impl, spawnImpl: spawnImpl as never, probeImpl: (async () => { throw new Error("x"); }) as never });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.step).toBe("verify");
    expect(spawnImpl).not.toHaveBeenCalled();
  });

  it("an archive that unpacks without the executable stops at 'unpack' and says what was expected", async () => {
    const asset = fakeAsset(body);
    const f = fakeFetch(body);
    const tarChild = new FakeChild();
    const spawnImpl = vi.fn(() => {
      setTimeout(() => tarChild.emit("exit", 0, null), 1);
      return tarChild;
    });
    const r = await installRuntime({ root: dir, asset, platform: "win32", fetchImpl: f.impl, spawnImpl: spawnImpl as never, tarPath: "tar", probeImpl: (async () => { throw new Error("x"); }) as never });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.step).toBe("unpack");
      expect(r.error).toContain("ollama.exe");
    }
  });

  it("with no pinned asset for this platform it refuses before touching the network", async () => {
    const f = fakeFetch(body);
    const r = await installRuntime({ root: dir, platform: "linux", arch: "x64", fetchImpl: f.impl, spawnImpl: vi.fn() as never });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.step).toBe("download");
    expect(f.impl).not.toHaveBeenCalled();
  });
});
