/**
 * Opt-in skip: skipped in every ordinary run because it needs the downloaded Ollama release (`MADY_OLLAMA_ARCHIVE`, 1.4 GB, Windows). The default
 *    build has no language model (only `MADY_LLM=1` does), and a test run never downloads anything.
 *
 * The real thing, opt-in: unpack the real release with the real system tar, start the real
 * `ollama.exe` on a spare loopback port, see it answer, kill its tree.
 *
 * Skipped unless `MADY_OLLAMA_ARCHIVE` points at the downloaded release zip (1.4 GB, so it is
 * never fetched by a test). Run it once per pinned version — this is the check against the
 * real release that the pinned constants need before they are trusted:
 *
 *     MADY_OLLAMA_ARCHIVE=C:\path\ollama-windows-amd64.zip npx vitest run modelRuntime.real
 *
 * Port 11435, not 11434, so a user's own Ollama is neither used nor disturbed.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { OllamaRuntime, extractArchive, runtimeExePath, runtimeInstalled, runtimeModelsDir } from "./modelRuntime";

const ARCHIVE = process.env.MADY_OLLAMA_ARCHIVE;
const PORT = 11435;

describe.skipIf(!ARCHIVE || process.platform !== "win32")("the real Ollama release, unpacked and started (opt-in)", () => {
  let root = "";
  afterAll(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("system tar unpacks it to <root>/ollama/ollama.exe; `serve` answers on 127.0.0.1:11435; the tree is killed", async () => {
    root = await mkdtemp(join(tmpdir(), "mady-real-ollama-"));
    const un = await extractArchive(ARCHIVE!, join(root, "ollama"));
    expect(un).toEqual({ ok: true });
    expect(await runtimeInstalled(root)).toBe(true);

    const rt = new OllamaRuntime({ exe: runtimeExePath(root), modelsDir: runtimeModelsDir(root), url: `http://127.0.0.1:${PORT}` });
    expect(await rt.status()).toBe("down");
    const started = await rt.start();
    expect(started).toEqual({ ok: true, external: false });
    expect(await rt.status()).toBe("ours");

    // It is the version we pinned, answering on the port we chose.
    const res = await fetch(`http://127.0.0.1:${PORT}/api/version`);
    expect(res.ok).toBe(true);
    expect(((await res.json()) as { version: string }).version).toBe("0.33.3");

    await rt.stop();
    // Give Windows a moment to tear the tree down, then the port must be silent.
    await new Promise((r) => setTimeout(r, 1500));
    expect(await rt.status()).toBe("down");
  }, 120_000);
});
