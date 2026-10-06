// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readdir, readFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { atomicWrite } from "./atomicWrite";

// Wrap `rename` so individual tests can force a one-off failure (EXDEV on a
// redirected drive can't be reproduced for real in a temp dir); every other
// call delegates to the real implementation.
vi.mock("node:fs/promises", async (importActual) => {
  const actual = await importActual<typeof import("node:fs/promises")>();
  return { ...actual, rename: vi.fn(actual.rename) };
});

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "mady-atomic-"));
});
afterEach(async () => {
  vi.mocked(rename).mockClear();
  await rm(dir, { recursive: true, force: true });
});

const leftoverTemps = async () => (await readdir(dir)).filter((n) => n.includes(".tmp-"));

describe("atomicWrite", () => {
  it("writes the file and leaves no temp behind (fast path)", async () => {
    const target = join(dir, "out.json");
    await atomicWrite(target, "hello");
    expect(await readFile(target, "utf8")).toBe("hello");
    expect(await leftoverTemps()).toEqual([]);
  });

  it("overwrites an existing file", async () => {
    const target = join(dir, "out.json");
    await atomicWrite(target, "first");
    await atomicWrite(target, "second");
    expect(await readFile(target, "utf8")).toBe("second");
  });

  it("falls back to copy+replace when rename throws EXDEV (redirected drive)", async () => {
    const target = join(dir, "out.json");
    const exdev = Object.assign(new Error("cross-device link not permitted"), { code: "EXDEV" });
    vi.mocked(rename).mockRejectedValueOnce(exdev);

    await atomicWrite(target, "redirected");

    expect(await readFile(target, "utf8")).toBe("redirected");
    expect(await leftoverTemps()).toEqual([]); // temp cleaned up
  });

  it("removes the orphan temp and rethrows immediately on a non-transient rename failure", async () => {
    const target = join(dir, "out.json");
    const enospc = Object.assign(new Error("no space left on device"), { code: "ENOSPC" });
    vi.mocked(rename).mockRejectedValueOnce(enospc);

    await expect(atomicWrite(target, "boom")).rejects.toThrow(/no space left/);
    expect(await leftoverTemps()).toEqual([]);
    expect(vi.mocked(rename)).toHaveBeenCalledTimes(1); // not retried — it will never succeed
  });

  // On Windows, rename onto an existing path fails with a transient EPERM/EACCES/EBUSY when
  // anything (another writer, antivirus, the Search indexer) holds the destination for a
  // moment. POSIX rename never does this, so the failure cannot be seen off Windows. Since
  // atomicWrite backs project save + autosave + the style library, a write that did not retry
  // would make a save fail intermittently for a reason the user can do nothing about.
  it.each(["EPERM", "EACCES", "EBUSY"])("retries a transient %s and completes the write", async (code) => {
    const target = join(dir, "out.json");
    const transient = Object.assign(new Error(`transient ${code}`), { code });
    vi.mocked(rename).mockRejectedValueOnce(transient); // first attempt refused, then the real rename

    await atomicWrite(target, "survived");

    expect(await readFile(target, "utf8")).toBe("survived");
    expect(await leftoverTemps()).toEqual([]);
    expect(vi.mocked(rename).mock.calls.length).toBeGreaterThan(1); // it really did retry
  });

  it("gives up on a persistent transient-code failure rather than hanging the save", async () => {
    const target = join(dir, "out.json");
    const eperm = Object.assign(new Error("operation not permitted"), { code: "EPERM" });
    vi.mocked(rename).mockRejectedValue(eperm); // never recovers

    await expect(atomicWrite(target, "boom")).rejects.toThrow(/not permitted/);
    expect(await leftoverTemps()).toEqual([]); // no orphan temp left behind
    // bounded: the initial attempt + a fixed retry budget, not an unbounded loop
    expect(vi.mocked(rename).mock.calls.length).toBeLessThanOrEqual(8);
    vi.mocked(rename).mockReset();
  });

  it("two overlapping writes to one path don't share a temp", async () => {
    const target = join(dir, "out.json");
    // Concurrent writers sharing one `${path}.tmp-${pid}` would let one rename move the
    // other's half-written temp. Both must complete and leave one clean file.
    await Promise.all([atomicWrite(target, "AAAA"), atomicWrite(target, "BBBB")]);
    expect(["AAAA", "BBBB"]).toContain(await readFile(target, "utf8"));
    expect(await leftoverTemps()).toEqual([]);
  });

  // Writes to one path are serialized: two concurrent renames onto the same destination is
  // exactly the EPERM case above, and MadY can cause it itself when autosave fires while a
  // manual Save runs.
  it("serializes overlapping writes to one path — last queued wins, deterministically", async () => {
    const target = join(dir, "out.json");
    await Promise.all([
      atomicWrite(target, "first"),
      atomicWrite(target, "second"),
      atomicWrite(target, "third"),
    ]);
    expect(await readFile(target, "utf8")).toBe("third"); // ordered, not a coin toss
    expect(await leftoverTemps()).toEqual([]);
  });

  it("survives many overlapping writes without a spurious failure", async () => {
    const target = join(dir, "out.json");
    // 40 concurrent writes to one path: the load that exposes an intermittent EPERM.
    await Promise.all(Array.from({ length: 40 }, (_, i) => atomicWrite(target, `v${i}`)));
    expect(await readFile(target, "utf8")).toBe("v39");
    expect(await leftoverTemps()).toEqual([]);
  });

  it("a failed write does not poison the next write to the same path", async () => {
    const target = join(dir, "out.json");
    const enospc = Object.assign(new Error("no space left on device"), { code: "ENOSPC" });
    vi.mocked(rename).mockRejectedValueOnce(enospc);

    await expect(atomicWrite(target, "partial")).rejects.toThrow(/no space left/);
    await atomicWrite(target, "recovered"); // the per-path queue must not stay rejected
    expect(await readFile(target, "utf8")).toBe("recovered");
    expect(await leftoverTemps()).toEqual([]);
  });
});
