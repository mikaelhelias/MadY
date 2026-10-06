import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MadySession } from "./session";

vi.mock("node:fs/promises", async (actual) => {
  const fs = await actual<typeof import("node:fs/promises")>();
  return { ...fs, writeFile: vi.fn(fs.writeFile) };
});
let dir: string;
afterEach(async () => { vi.mocked(writeFile).mockRestore(); if (dir) await rm(dir, { recursive: true, force: true }); });

it("a partial failed save preserves the existing project and cleans temporary files", async () => {
  dir = await mkdtemp(join(tmpdir(), "mady-save-review-"));
  const path = join(dir, "project.mady");
  const session = new MadySession();
  await session.saveProject(path);
  const before = await readFile(path, "utf8");
  const fs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  vi.mocked(writeFile).mockImplementationOnce(async (target) => {
    await fs.writeFile(target, "partial");
    throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
  });
  expect((await session.saveProject(path)).ok).toBe(false);
  expect(await readFile(path, "utf8")).toBe(before);
  expect(await readdir(dir)).toEqual(["project.mady"]);
});

it("overlapping saves finish with the last requested snapshot", async () => {
  dir = await mkdtemp(join(tmpdir(), "mady-save-review-"));
  const path = join(dir, "project.mady");
  const session = new MadySession();
  const saves = [];
  for (let i = 0; i < 12; i++) {
    session.document.addTable(String(i), "column", ["Y"]);
    saves.push(session.saveProject(path));
  }
  expect((await Promise.all(saves)).every(r => r.ok)).toBe(true);
  expect(JSON.parse(await readFile(path, "utf8")).tables).toHaveLength(12);
});
