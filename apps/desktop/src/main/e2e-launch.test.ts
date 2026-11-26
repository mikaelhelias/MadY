// @vitest-environment node
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { launchOptions } from "../../../../e2e-electron/launchApp";

/** e2e-electron/launchApp.ts: which program the Electron tests start, on each system. */
const REPO = resolve("/repo");
const PROFILE = resolve("/repo/build/profile");

describe("the program the Electron tests start", () => {
  it("Windows, by default: Electron's electron.exe with the app folder, the test profile, no sandbox switch", () => {
    const o = launchOptions(REPO, PROFILE, {}, "win32");
    expect(o.executablePath).toBe(resolve(REPO, "node_modules/electron/dist/electron.exe"));
    expect(o.args).toEqual([resolve(REPO, "apps/desktop")]);
    expect(o.env.MADY_PROFILE_DIR).toBe(PROFILE);
  });

  it("Linux, by default: Electron's electron, with the sandbox off", () => {
    const o = launchOptions(REPO, PROFILE, {}, "linux");
    expect(o.executablePath).toBe(resolve(REPO, "node_modules/electron/dist/electron"));
    expect(o.args).toEqual(["--no-sandbox", resolve(REPO, "apps/desktop")]);
  });

  it("MADY_APP_EXE: the packaged program itself, no app folder, the test profile still", () => {
    const exe = "/repo/apps/desktop/release/linux-unpacked/mady";
    const o = launchOptions(REPO, PROFILE, { MADY_APP_EXE: exe }, "linux");
    expect(o).toEqual({ executablePath: resolve(exe), args: ["--no-sandbox"], env: { MADY_APP_EXE: exe, MADY_PROFILE_DIR: PROFILE } });
    expect(launchOptions(REPO, PROFILE, { MADY_APP_EXE: "C:/b/MadY.exe" }, "win32").args).toEqual([]);
  });

  it("an empty MADY_APP_EXE is the development app", () => {
    expect(launchOptions(REPO, PROFILE, { MADY_APP_EXE: " " }, "win32").args).toEqual([resolve(REPO, "apps/desktop")]);
  });
});
