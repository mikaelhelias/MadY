/**
 * Ollama, fetched and run on request — the model runtime behind "Set up a model".
 *
 * Setting up the on-device model is one press, with
 * nothing to install by hand. That means MadY itself fetches the runtime, which is the only
 * place in this program that contacts the internet — and only when the user presses a button
 * that says so on its face. Nothing here runs at install time, at boot, or in the background.
 *
 * ## Safeguards for a downloaded-and-executed program
 *
 * - **Pinned.** `OLLAMA_VERSION` and each archive's SHA-256 are constants here, taken from the
 *   release's own `sha256sum.txt` and checked against the real download
 *   (`ollama-windows-amd64.zip` → `52cb36…2fcd7`). MadY never asks "what is the latest"; it
 *   fetches exactly the release it was tested with. Upgrading Ollama is a MadY release.
 * - **Verified before it runs.** The archive is hashed as it arrives (no second pass over
 *   1.4 GB) and refused on a mismatch — deleted, not unpacked, not spawned. A wrong byte count
 *   is refused too: a truncated archive hashes correctly for exactly the bytes that came.
 * - **Portable, not installed.** The zip release, unpacked under a folder the user chose (or
 *   MadY's own data folder). No system installer, no admin prompt, no Start-menu entry, no
 *   service, no auto-updater. Deleting the folder deletes it.
 * - **Loopback only**, like everything else that talks to a model: `OLLAMA_HOST` is pinned to
 *   127.0.0.1, and a non-loopback URL is refused in the constructor.
 * - **Spawned like the stats engine**: absolute path, stopped when MadY quits. The model
 *   store (`OLLAMA_MODELS`) lives under the same folder, so weights do not land in a hidden
 *   per-user directory the size dialog never mentioned.
 * - **An Ollama the user already runs is used, never duplicated.** The probe comes first.
 *
 * ## The archive (v0.33.3, win32-x64)
 *
 * 1,469,175,900 bytes. 87 entries: `ollama.exe` at the root and everything else under
 * `lib/ollama/` (CUDA 12 + 13 runners, per-CPU ggml builds, licences). There is no smaller
 * CPU-only x64 build — the GPU libraries ride along for everyone. Windows' own `tar.exe`
 * (bsdtar, present since Windows 10 1803) unpacks it, ZIP64 included, so no unzip library.
 *
 * Nothing in this file imports Electron: every path is passed in, every process and network
 * call is injectable, so the whole flow is tested against fakes in `modelRuntime.test.ts`.
 */
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { access, mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { DEFAULT_MODEL_URL, isLoopbackUrl, NonLoopbackModelHost } from "@mady/core";

// ---------------------------------------------------------------------------------------------
// The pinned release
// ---------------------------------------------------------------------------------------------

/** The Ollama release MadY fetches. Bump it, re-pin every hash from `sha256sum.txt`, re-test. */
export const OLLAMA_VERSION = "v0.33.3";

export interface RuntimeAsset {
  /** File name in the release. */
  name: string;
  /** Where it is fetched from — the only non-loopback URL this program ever contacts. */
  url: string;
  /** SHA-256 of the archive, lower-case hex, from the release's `sha256sum.txt`. */
  sha256: string;
  /** Exact size in bytes — shown to the user before anything is fetched. */
  bytes: number;
  /**
   * What it becomes on disk, measured by unpacking the real archive. The dialog states the
   * peak (archive + unpacked, before the archive is deleted) as the free space needed.
   * Absent when a build has not been measured — the dialog then says "about" and uses `bytes`.
   */
  unpackedBytes?: number;
}

const RELEASE = `https://github.com/ollama/ollama/releases/download/${OLLAMA_VERSION}`;

/** Keyed `${platform}-${arch}` (Node's names). Only what has been pinned is offered. */
export const OLLAMA_ASSETS: Record<string, RuntimeAsset> = {
  "win32-x64": {
    name: "ollama-windows-amd64.zip",
    url: `${RELEASE}/ollama-windows-amd64.zip`,
    sha256: "52cb36a62e7e501f61514f60212dec7117b6c098811357585e02fffe32d2fcd7",
    bytes: 1_469_175_900,
    unpackedBytes: 1_953_507_607, // measured with `du -sb` after unpacking the real archive
  },
  "win32-arm64": {
    name: "ollama-windows-arm64.zip",
    url: `${RELEASE}/ollama-windows-arm64.zip`,
    sha256: "98b9ddaab6baece0418c6d1231526eb1e4e66944985e0a8eeb7d6171bcd7b6d8",
    bytes: 210_648_637,
  },
};

/**
 * The one sentence the set-up dialog shows beside the size. Plain words, no brand copy, and
 * no adjective about the size — the number stands beside it.
 */
export const OLLAMA_BLURB =
  "The program that runs the language model on this computer. It answers only MadY, on this machine, and sends nothing out.";

/** The pinned asset for a platform, or null when there is none — never a guess. */
export function runtimeAsset(platform: string = process.platform, arch: string = process.arch): RuntimeAsset | null {
  return OLLAMA_ASSETS[`${platform}-${arch}`] ?? null;
}

// ---------------------------------------------------------------------------------------------
// Where it lives
// ---------------------------------------------------------------------------------------------

/** `<root>/ollama/ollama(.exe)` — the archive's own layout, unpacked into one folder. */
export function runtimeExePath(root: string, platform: string = process.platform): string {
  return join(root, "ollama", platform === "win32" ? "ollama.exe" : "ollama");
}

/** `<root>/models` — handed to Ollama as `OLLAMA_MODELS`. */
export function runtimeModelsDir(root: string): string {
  return join(root, "models");
}

export async function runtimeInstalled(root: string, platform: string = process.platform): Promise<boolean> {
  try {
    await access(runtimeExePath(root, platform));
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------
// Download + verify
// ---------------------------------------------------------------------------------------------

export interface DownloadProgress {
  received: number;
  total?: number | undefined;
}

export type DownloadResult =
  | { ok: true; bytes: number }
  | { ok: false; code: "network" | "http" | "hash" | "aborted" | "refused"; error: string };

/** Hash an existing partial file (streaming), so a resumed download verifies as a whole. */
async function hashFile(path: string): Promise<{ hash: ReturnType<typeof createHash>; bytes: number }> {
  const hash = createHash("sha256");
  let bytes = 0;
  await new Promise<void>((resolve, reject) => {
    createReadStream(path)
      .on("data", (chunk: Buffer | string) => {
        const b = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
        hash.update(b);
        bytes += b.length;
      })
      .on("end", resolve)
      .on("error", reject);
  });
  return { hash, bytes };
}

/**
 * Fetch `asset.url` to `dest`, streaming through a `.part` file, hashing as bytes arrive, and
 * keeping the file only when both the hash and the byte count match the pin.
 *
 * Resumable: an existing `.part` is hashed and the request carries `Range: bytes=N-`. A server
 * that answers 206 continues it; one that answers 200 is taken at its word and the part is
 * restarted. A network failure keeps the part so the next press resumes rather than restarts —
 * that is the difference between one bad Wi-Fi moment and 1.4 GB again.
 */
export async function downloadVerified(
  asset: RuntimeAsset,
  dest: string,
  opts: {
    fetchImpl?: typeof fetch | undefined;
    onProgress?: ((p: DownloadProgress) => void) | undefined;
    signal?: AbortSignal | undefined;
  } = {},
): Promise<DownloadResult> {
  if (!asset.url.startsWith("https://")) {
    return { ok: false, code: "refused", error: `refusing to fetch '${asset.url}': only https downloads are allowed` };
  }
  const doFetch = opts.fetchImpl ?? fetch;
  const part = `${dest}.part`;
  await mkdir(dirname(dest), { recursive: true });

  // Resume: what is already on disk, hashed.
  let hash = createHash("sha256");
  let received = 0;
  try {
    const existing = await stat(part);
    if (existing.size > 0 && existing.size < asset.bytes) {
      const h = await hashFile(part);
      hash = h.hash;
      received = h.bytes;
    } else if (existing.size >= asset.bytes) {
      // As large as or larger than the pin: invalid. Start clean.
      await rm(part, { force: true });
    }
  } catch {
    /* no part file — a fresh download */
  }

  let res: Response;
  try {
    res = await doFetch(asset.url, {
      headers: received > 0 ? { range: `bytes=${received}-` } : {},
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
  } catch (e) {
    if (opts.signal?.aborted) return { ok: false, code: "aborted", error: "the download was cancelled" };
    return { ok: false, code: "network", error: `could not reach ${new URL(asset.url).host}: ${e instanceof Error ? e.message : String(e)}` };
  }

  let append = false;
  if (res.status === 206 && received > 0) {
    append = true;
  } else if (res.ok) {
    // 200: the server sent the whole file (or ignored the Range). Restart the hash and the part.
    hash = createHash("sha256");
    received = 0;
    await rm(part, { force: true });
  } else {
    return { ok: false, code: "http", error: `the download server answered HTTP ${res.status} for ${asset.name}` };
  }
  if (!res.body) return { ok: false, code: "network", error: "the download server sent no body" };

  const lengthHeader = res.headers.get("content-length");
  const total = lengthHeader ? received + Number(lengthHeader) : asset.bytes;
  const out = createWriteStream(part, { flags: append ? "a" : "w" });
  try {
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      const b = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
      hash.update(b);
      received += b.length;
      if (!out.write(b)) await new Promise<void>((r) => out.once("drain", r));
      opts.onProgress?.({ received, total });
    }
  } catch (e) {
    out.close();
    if (opts.signal?.aborted) return { ok: false, code: "aborted", error: "the download was cancelled" };
    return { ok: false, code: "network", error: `the download broke off after ${received} bytes: ${e instanceof Error ? e.message : String(e)}` };
  }
  await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())));

  const digest = hash.digest("hex");
  if (digest !== asset.sha256 || received !== asset.bytes) {
    await rm(part, { force: true });
    return {
      ok: false,
      code: "hash",
      error:
        `the downloaded ${asset.name} does not match its published checksum (SHA-256 ${digest.slice(0, 12)}… / ` +
        `${received} bytes; expected ${asset.sha256.slice(0, 12)}… / ${asset.bytes} bytes). It was deleted, not used.`,
    };
  }
  await rename(part, dest);
  return { ok: true, bytes: received };
}

// ---------------------------------------------------------------------------------------------
// Unpack
// ---------------------------------------------------------------------------------------------

type SpawnImpl = (command: string, args: string[], options: SpawnOptions) => ChildProcess;

/** Windows' own tar (bsdtar) lives in System32; elsewhere `tar` is on PATH. */
export function systemTarPath(platform: string = process.platform, env: NodeJS.ProcessEnv = process.env): string {
  return platform === "win32" ? join(env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
}

/** Collect a child's stderr and resolve with its exit code; a spawn error resolves too. */
function runChild(spawnImpl: SpawnImpl, command: string, args: string[]): Promise<{ code: number | null; stderr: string; error?: string }> {
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawnImpl(command, args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    } catch (e) {
      resolve({ code: null, stderr: "", error: e instanceof Error ? e.message : String(e) });
      return;
    }
    let stderr = "";
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    child.once("error", (e) => resolve({ code: null, stderr, error: e.message }));
    child.once("exit", (code) => resolve({ code, stderr }));
  });
}

/** `tar -xf <archive> -C <dest>` with the system tar. Its own words on failure. */
export async function extractArchive(
  archive: string,
  dest: string,
  opts: { spawnImpl?: SpawnImpl | undefined; tarPath?: string | undefined } = {},
): Promise<{ ok: true } | { ok: false; error: string }> {
  await mkdir(dest, { recursive: true });
  const r = await runChild(opts.spawnImpl ?? nodeSpawn, opts.tarPath ?? systemTarPath(), ["-xf", archive, "-C", dest]);
  if (r.error) return { ok: false, error: `could not run tar to unpack the archive: ${r.error}` };
  if (r.code !== 0) return { ok: false, error: `tar failed (exit ${r.code})${r.stderr ? `: ${r.stderr.trim()}` : ""}` };
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------------------------

export type RuntimeStatus = "external" | "ours" | "down";

export interface OllamaRuntimeOptions {
  /** Absolute path to the executable. */
  exe: string;
  /** `OLLAMA_MODELS` — where the weights go. */
  modelsDir: string;
  /** The server URL. Must be loopback. */
  url?: string | undefined;
  fetchImpl?: typeof fetch | undefined;
  spawnImpl?: SpawnImpl | undefined;
  onLog?: ((line: string) => void) | undefined;
  /** How often to ask "are you up yet" while starting. */
  pollMs?: number | undefined;
  /** Give up on a start after this long. */
  startTimeoutMs?: number | undefined;
  platform?: string | undefined;
}

/**
 * One Ollama process, or the user's own — `start()` decides which by asking first.
 */
export class OllamaRuntime {
  private readonly url: string;
  private readonly host: string;
  private child: ChildProcess | null = null;
  private external = false;

  constructor(private readonly opts: OllamaRuntimeOptions) {
    const url = (opts.url ?? DEFAULT_MODEL_URL).replace(/\/+$/, "");
    if (!isLoopbackUrl(url)) throw new NonLoopbackModelHost(url);
    this.url = url;
    const u = new URL(url);
    this.host = `${u.hostname}:${u.port || "11434"}`;
  }

  /** True when something answers at the URL — ours or not. */
  private async reachable(): Promise<boolean> {
    const doFetch = this.opts.fetchImpl ?? fetch;
    try {
      const res = await doFetch(`${this.url}/api/version`, { signal: AbortSignal.timeout(1500) });
      return res.ok;
    } catch {
      return false;
    }
  }

  async status(): Promise<RuntimeStatus> {
    if (!(await this.reachable())) return "down";
    return this.child && !this.external ? "ours" : "external";
  }

  /**
   * Use a server that already answers; otherwise spawn ours and wait until it answers.
   * The result says which happened, because the set-up dialog words the location row on it.
   */
  async start(): Promise<{ ok: true; external: boolean } | { ok: false; error: string }> {
    if (await this.reachable()) {
      this.external = this.child === null;
      return { ok: true, external: this.external };
    }
    const spawnImpl = this.opts.spawnImpl ?? nodeSpawn;
    let child: ChildProcess;
    try {
      child = spawnImpl(this.opts.exe, ["serve"], {
        env: { ...process.env, OLLAMA_HOST: this.host, OLLAMA_MODELS: this.opts.modelsDir },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (e) {
      return { ok: false, error: `could not start ${this.opts.exe}: ${e instanceof Error ? e.message : String(e)}` };
    }
    let stderr = "";
    let exited: { code: number | null } | null = null;
    let spawnError: string | null = null;
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
      this.opts.onLog?.(d.toString().trim());
    });
    child.stdout?.on("data", (d: Buffer) => this.opts.onLog?.(d.toString().trim()));
    child.once("error", (e) => {
      spawnError = e.message;
    });
    child.once("exit", (code) => {
      exited = { code };
      if (this.child === child) this.child = null;
    });
    this.child = child;
    this.external = false;

    const poll = this.opts.pollMs ?? 250;
    const deadline = Date.now() + (this.opts.startTimeoutMs ?? 20_000);
    while (Date.now() < deadline) {
      if (spawnError) {
        this.child = null;
        return { ok: false, error: `could not start ${this.opts.exe}: ${spawnError}` };
      }
      if (exited) {
        this.child = null;
        const why = stderr.trim().split("\n").filter(Boolean).slice(-3).join(" · ");
        return { ok: false, error: `the model runtime exited (code ${(exited as { code: number | null }).code}) before it was ready${why ? `: ${why}` : ""}` };
      }
      if (await this.reachable()) return { ok: true, external: false };
      await new Promise((r) => setTimeout(r, poll));
    }
    await this.stop();
    return { ok: false, error: `the model runtime did not answer on ${this.host} within ${Math.round((this.opts.startTimeoutMs ?? 20_000) / 1000)} s` };
  }

  /** Kill what we spawned — the whole tree on Windows, since `ollama serve` forks runners. */
  async stop(): Promise<void> {
    const child = this.child;
    this.child = null;
    if (!child || this.external) return;
    const platform = this.opts.platform ?? process.platform;
    if (platform === "win32" && child.pid !== undefined) {
      await runChild(this.opts.spawnImpl ?? nodeSpawn, "taskkill", ["/pid", String(child.pid), "/t", "/f"]);
    } else {
      child.kill("SIGTERM");
    }
  }
}

// ---------------------------------------------------------------------------------------------
// The whole flow
// ---------------------------------------------------------------------------------------------

export type InstallStep = "download" | "verify" | "unpack" | "start";

export interface InstallProgress {
  step: InstallStep;
  received?: number | undefined;
  total?: number | undefined;
}

export type InstallResult =
  | { ok: true; exe: string; external: boolean }
  | { ok: false; step: InstallStep; error: string };

export interface InstallOptions {
  /** The folder the user chose (or MadY's own data folder). Everything lands under it. */
  root: string;
  asset?: RuntimeAsset | undefined;
  platform?: string | undefined;
  arch?: string | undefined;
  fetchImpl?: typeof fetch | undefined;
  /** Separate from `fetchImpl` so a test can serve the archive and fake the server probe. */
  probeImpl?: typeof fetch | undefined;
  spawnImpl?: SpawnImpl | undefined;
  tarPath?: string | undefined;
  pollMs?: number | undefined;
  startTimeoutMs?: number | undefined;
  signal?: AbortSignal | undefined;
  onProgress?: ((p: InstallProgress) => void) | undefined;
  onLog?: ((line: string) => void) | undefined;
}

/**
 * download → verify → unpack → start. Each failure names its step so the dialog can retry
 * from that step. The archive is deleted after a good unpack — 1.4 GB is not kept beside the
 * 1.4 GB it became.
 *
 * Returns the runtime so the caller (main) can stop it on quit.
 */
export async function installRuntime(opts: InstallOptions): Promise<InstallResult & { runtime?: OllamaRuntime }> {
  const platform = opts.platform ?? process.platform;
  const asset = opts.asset ?? runtimeAsset(platform, opts.arch ?? process.arch);
  if (!asset) {
    return { ok: false, step: "download", error: `no pinned Ollama release for ${platform}-${opts.arch ?? process.arch}` };
  }
  const exe = runtimeExePath(opts.root, platform);
  const runtime = new OllamaRuntime({
    exe,
    modelsDir: runtimeModelsDir(opts.root),
    fetchImpl: opts.probeImpl ?? opts.fetchImpl,
    spawnImpl: opts.spawnImpl,
    onLog: opts.onLog,
    pollMs: opts.pollMs,
    startTimeoutMs: opts.startTimeoutMs,
    platform,
  });

  if (!(await runtimeInstalled(opts.root, platform))) {
    const archive = join(opts.root, "downloads", asset.name);
    opts.onProgress?.({ step: "download", received: 0, total: asset.bytes });
    const dl = await downloadVerified(asset, archive, {
      fetchImpl: opts.fetchImpl,
      signal: opts.signal,
      onProgress: (p) => opts.onProgress?.({ step: "download", received: p.received, total: p.total }),
    });
    if (!dl.ok) return { ok: false, step: dl.code === "hash" ? "verify" : "download", error: dl.error };
    opts.onProgress?.({ step: "verify" });

    opts.onProgress?.({ step: "unpack" });
    const un = await extractArchive(archive, join(opts.root, "ollama"), { spawnImpl: opts.spawnImpl, tarPath: opts.tarPath });
    if (!un.ok) return { ok: false, step: "unpack", error: un.error };
    if (!(await runtimeInstalled(opts.root, platform))) {
      return { ok: false, step: "unpack", error: `the archive unpacked, but ${exe} is not in it — the release layout changed` };
    }
    await rm(archive, { force: true });
  }

  opts.onProgress?.({ step: "start" });
  await mkdir(runtimeModelsDir(opts.root), { recursive: true });
  const st = await runtime.start();
  if (!st.ok) return { ok: false, step: "start", error: st.error };
  return { ok: true, exe, external: st.external, runtime };
}
