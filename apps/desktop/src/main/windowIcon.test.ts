/**
 * The window icon must resolve to a file that exists in both ways the app runs.
 *
 * The dev case uses a main-process directory with no `out/renderer` beside it — a fresh
 * clone or worktree — because that is where a path built from the main directory fails:
 * `join(mainDir, "../renderer/icon.png")` points at nothing there, Electron says nothing,
 * and the taskbar shows the stock Electron icon instead of the purple "Y".
 */
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { windowIconPath } from "./windowIcon";

const APP_PATH = resolve(__dirname, "../.."); // apps/desktop — what app.getAppPath() returns in dev

describe("windowIconPath", () => {
  it("dev: resolves to a file on disk even when out/renderer has never been built", () => {
    const mainDir = join(mkdtempSync(join(tmpdir(), "mady-icon-")), "out", "main");
    const p = windowIconPath({ isPackaged: false, mainDir, appPath: APP_PATH });
    expect(existsSync(p), `dev icon path does not exist: ${p}`).toBe(true);
    expect(p.replace(/\\/g, "/")).toMatch(/src\/renderer\/public\/icon\.png$/);
  });

  it("packaged: resolves inside out/renderer, the only place the asar carries it", () => {
    const p = windowIconPath({ isPackaged: true, mainDir: "C:/app/resources/app.asar/out/main", appPath: "C:/app/resources/app.asar" });
    expect(p.replace(/\\/g, "/")).toMatch(/out\/renderer\/icon\.png$/);
  });
});
