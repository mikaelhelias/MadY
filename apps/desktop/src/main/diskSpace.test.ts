/**
 * Free space for the set-up dialog's "42 GB free" — measured on the drive the chosen folder
 * lives on, even before that folder exists.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { freeSpaceBytes } from "./diskSpace";

describe("freeSpaceBytes", () => {
  it("reports a positive number for an existing folder", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mady-space-"));
    try {
      const free = await freeSpaceBytes(dir);
      expect(free).not.toBeNull();
      expect(free!).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("walks up to the nearest existing ancestor for a folder that does not exist yet", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mady-space-"));
    try {
      const deep = join(dir, "not", "yet", "made");
      const free = await freeSpaceBytes(deep);
      const parent = await freeSpaceBytes(dir);
      expect(free).not.toBeNull();
      // Same drive → the same figure, give or take what the OS wrote in between.
      expect(Math.abs(free! - parent!)).toBeLessThan(200 * 1024 * 1024);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("null, not a throw, for a drive that does not exist; without drives, the root's figure", async () => {
    if (process.platform === "win32") {
      expect(await freeSpaceBytes("Q:\\no\\such\\drive")).toBeNull();
    } else {
      // No drive letters: every absolute path is under /, so a missing folder is measured there.
      const root = await freeSpaceBytes("/");
      const missing = await freeSpaceBytes("/no/such/mount/point/that/exists");
      expect(root).not.toBeNull();
      expect(Math.abs(missing! - root!)).toBeLessThan(200 * 1024 * 1024);
    }
  });
});
