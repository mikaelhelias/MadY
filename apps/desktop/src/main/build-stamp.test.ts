import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The window's build stamp ends its commit with "+" when the build was made from uncommitted changes
 * (`git status --porcelain`, read when electron.vite.config.ts loads). While loading that config, electron-vite
 * writes a bundled copy of it beside it (`electron.vite.config.<time>.mjs`, seen during a build); unless git
 * ignores that copy, it is the one untracked file every build sees, and every build is stamped "+".
 */
const REPO = join(dirname(fileURLToPath(import.meta.url)), "../../../..");

describe("the build stamp", () => {
  it("git ignores electron-vite's temporary copy of the config", () => {
    const name = "apps/desktop/electron.vite.config.1792376949052.mjs";
    const r = spawnSync("git", ["check-ignore", "-q", name], { cwd: REPO });
    expect(r.error, "git could not be run").toBeUndefined();
    expect(r.status, `${name} is not ignored, so every build would be stamped "+"`).toBe(0);
  });
});
