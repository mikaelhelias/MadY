// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  autosavePath,
  clearSnapshot,
  clearSnapshotSync,
  readSnapshot,
  writeSnapshot,
  type AutosaveSnapshot,
} from "./autosave";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "mady-autosave-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const snap = (over: Partial<AutosaveSnapshot> = {}): AutosaveSnapshot => ({
  v: 1,
  savedAt: 1_700_000_000_000,
  name: "Project 1",
  json: JSON.stringify({ schemaVersion: 4, tables: [] }),
  ...over,
});

describe("writeSnapshot / readSnapshot", () => {
  it("round-trips the snapshot and leaves no temp file behind", async () => {
    await writeSnapshot(dir, snap());
    expect(await readSnapshot(dir)).toEqual(snap());
    // atomic write must not leave the temp file around
    await expect(readFile(`${autosavePath(dir)}.tmp-${process.pid}`, "utf8")).rejects.toBeTruthy();
  });

  it("overwrites the previous snapshot (latest wins)", async () => {
    await writeSnapshot(dir, snap({ savedAt: 1 }));
    await writeSnapshot(dir, snap({ savedAt: 2 }));
    expect((await readSnapshot(dir))?.savedAt).toBe(2);
  });

  it("returns null when there is nothing to recover", async () => {
    expect(await readSnapshot(dir)).toBeNull();
  });

  it("returns null for malformed JSON, wrong envelope version, or missing fields", async () => {
    await writeFile(autosavePath(dir), "{not json", "utf8");
    expect(await readSnapshot(dir)).toBeNull();
    await writeFile(autosavePath(dir), JSON.stringify({ v: 2, savedAt: 1, json: "{}" }), "utf8");
    expect(await readSnapshot(dir)).toBeNull();
    await writeFile(autosavePath(dir), JSON.stringify({ v: 1, savedAt: 1 }), "utf8");
    expect(await readSnapshot(dir)).toBeNull();
  });

  it("backfills a default name when the slot lacks one", async () => {
    await writeFile(autosavePath(dir), JSON.stringify({ v: 1, savedAt: 7, json: "{}" }), "utf8");
    expect(await readSnapshot(dir)).toEqual({ v: 1, savedAt: 7, name: "Recovered project", json: "{}" });
  });
});

describe("clearSnapshot", () => {
  it("removes the slot (async + sync) and is a no-op when already gone", async () => {
    await writeSnapshot(dir, snap());
    await clearSnapshot(dir);
    expect(await readSnapshot(dir)).toBeNull();
    await expect(clearSnapshot(dir)).resolves.toBeUndefined(); // missing → fine

    await writeSnapshot(dir, snap());
    clearSnapshotSync(dir);
    expect(await readSnapshot(dir)).toBeNull();
    expect(() => clearSnapshotSync(dir)).not.toThrow(); // missing → fine
  });
});
