// @vitest-environment node
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ffmpegFileName, freezeCommand, playwrightDir, pythonCommand } from "../../../../scripts/build-platform.mjs";

/** scripts/build-platform.mjs: where the build scripts find Python and Playwright's ffmpeg. */
describe("Python for the build scripts", () => {
  it("is the py -3 launcher on Windows and python3 on macOS", () => {
    expect(pythonCommand("win32")).toEqual({ command: "py", args: ["-3"] });
    expect(pythonCommand("darwin")).toEqual({ command: "python3", args: [] });
  });

  it("freezes the engine with PyInstaller from that Python", () => {
    expect(freezeCommand("win32")).toEqual({ command: "py", args: ["-3", "-m", "PyInstaller", "mady-engine.spec", "--noconfirm"] });
    expect(freezeCommand("darwin")).toEqual({ command: "python3", args: ["-m", "PyInstaller", "mady-engine.spec", "--noconfirm"] });
  });
});

describe("Playwright's ffmpeg", () => {
  const home = join("/home", "u");

  it("Windows: %LOCALAPPDATA%\\ms-playwright", () => {
    expect(playwrightDir("win32", { LOCALAPPDATA: "C:\\L" }, home)).toBe(join("C:\\L", "ms-playwright"));
  });

  it("macOS: ~/Library/Caches/ms-playwright; Linux: ~/.cache/ms-playwright", () => {
    expect(playwrightDir("darwin", {}, home)).toBe(join(home, "Library", "Caches", "ms-playwright"));
    expect(playwrightDir("linux", {}, home)).toBe(join(home, ".cache", "ms-playwright"));
  });

  it("PLAYWRIGHT_BROWSERS_PATH wins on every system", () => {
    for (const p of ["win32", "darwin", "linux"]) expect(playwrightDir(p, { PLAYWRIGHT_BROWSERS_PATH: "/pw", LOCALAPPDATA: "C:\\L" }, home)).toBe("/pw");
  });

  it("the program is ffmpeg-win64.exe, ffmpeg-mac or ffmpeg-linux", () => {
    expect([ffmpegFileName("win32"), ffmpegFileName("darwin"), ffmpegFileName("linux")]).toEqual(["ffmpeg-win64.exe", "ffmpeg-mac", "ffmpeg-linux"]);
  });
});
