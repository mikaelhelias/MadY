// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  coerceLibrary,
  readLibrary,
  readLibraryFile,
  readTextFiles,
  userLibraryPath,
  writeLibrary,
  type UserLibrary,
} from "./userLibrary";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "mady-userlib-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const lib = (over: Partial<UserLibrary> = {}): UserLibrary => ({
  v: 1,
  savedAt: 1_700_000_000_000,
  data: { "mady.userPresets.v1": "[{\"id\":\"up_1\"}]", "mady.profile.presetName": "\"Nature\"" },
  ...over,
});

describe("writeLibrary / readLibrary", () => {
  it("round-trips the bundle and leaves no temp file behind", async () => {
    await writeLibrary(dir, lib());
    expect(await readLibrary(dir)).toEqual(lib());
    await expect(readFile(`${userLibraryPath(dir)}.tmp-${process.pid}`, "utf8")).rejects.toBeTruthy();
  });

  it("overwrites the previous bundle (latest wins)", async () => {
    await writeLibrary(dir, lib({ savedAt: 1 }));
    await writeLibrary(dir, lib({ savedAt: 2 }));
    expect((await readLibrary(dir))?.savedAt).toBe(2);
  });

  it("returns null when the slot is absent", async () => {
    expect(await readLibrary(dir)).toBeNull();
  });
});

describe("coerceLibrary", () => {
  it("rejects malformed JSON / wrong version / missing data", async () => {
    await writeFile(userLibraryPath(dir), "{not json", "utf8");
    expect(await readLibrary(dir)).toBeNull();
    expect(coerceLibrary({ v: 2, savedAt: 1, data: {} })).toBeNull();
    expect(coerceLibrary({ v: 1, savedAt: 1 })).toBeNull();
    expect(coerceLibrary(null)).toBeNull();
  });

  it("keeps only string values and backfills savedAt", () => {
    const c = coerceLibrary({ v: 1, data: { good: "\"x\"", bad: 42, alsoBad: null } });
    expect(c).toEqual({ v: 1, savedAt: 0, data: { good: "\"x\"" } });
  });
});

describe("readLibrary — corrupt slot is quarantined, not silently overwritten", () => {
  const sidecars = async () => (await readdir(dir)).filter((n) => n.includes(".corrupt-"));

  it("moves an unreadable slot aside so a later write can't destroy it", async () => {
    const p = userLibraryPath(dir);
    await writeFile(p, "{ corrupt not json", "utf8");

    expect(await readLibrary(dir)).toBeNull();
    await expect(readFile(p, "utf8")).rejects.toBeTruthy(); // original moved aside
    const moved = await sidecars();
    expect(moved).toHaveLength(1);
    expect(await readFile(join(dir, moved[0]!), "utf8")).toBe("{ corrupt not json"); // bytes preserved

    // a fresh write now succeeds without having destroyed the quarantined copy
    await writeLibrary(dir, lib());
    expect(await readLibrary(dir)).toEqual(lib());
    expect(await sidecars()).toHaveLength(1);
  });

  it("does NOT quarantine a genuinely absent slot", async () => {
    expect(await readLibrary(dir)).toBeNull();
    expect(await sidecars()).toEqual([]);
  });
});

describe("readLibraryFile (Import from an arbitrary path)", () => {
  it("reads a well-formed exported file", async () => {
    const p = join(dir, "exported.json");
    await writeFile(p, JSON.stringify(lib(), null, 2), "utf8");
    expect(await readLibraryFile(p)).toEqual(lib());
  });
  it("returns null for a non-library file", async () => {
    const p = join(dir, "nope.json");
    await writeFile(p, JSON.stringify({ hello: "world" }), "utf8");
    expect(await readLibraryFile(p)).toBeNull();
  });
});

describe("readTextFiles (one-preset import: main reads bytes, the renderer judges them)", () => {
  it("returns each file's text by name, refuses an oversized one by name, and reports a missing one", async () => {
    const small = join(dir, "lab.mady-preset.json");
    const big = join(dir, "huge.json");
    await writeFile(small, '{"format":"mady-preset"}', "utf8");
    await writeFile(big, "x".repeat(3000), "utf8");
    const out = await readTextFiles([small, big, join(dir, "missing.json")], 2000);
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({ name: "lab.mady-preset.json", text: '{"format":"mady-preset"}' });
    expect(out[1]!.name).toBe("huge.json");
    expect("text" in out[1]!).toBe(false);
    expect((out[1] as { error: string }).error).toMatch(/larger than/);
    expect((out[2] as { error: string }).error).toMatch(/could not be read/);
  });
});
