/**
 * Where the build scripts find Python and Playwright's ffmpeg, on Windows and on macOS.
 *
 * Used by freeze-engine.mjs and guide-video-recorder.mjs, and tested in
 * `apps/desktop/src/main/build-platform.test.ts`.
 */
import { homedir } from "os";
import { join } from "path";

/**
 * The Python that holds the engine's packages: the `py -3` launcher on Windows, `python3`
 * elsewhere (macOS has no `py` launcher).
 * @param {string} [platform]  Node's platform name
 * @returns {{ command: string, args: string[] }}
 */
export function pythonCommand(platform = process.platform) {
  return platform === "win32" ? { command: "py", args: ["-3"] } : { command: "python3", args: [] };
}

/**
 * The command that freezes the statistics engine, run from `engines/py`.
 * @param {string} [platform]
 * @returns {{ command: string, args: string[] }}
 */
export function freezeCommand(platform = process.platform) {
  const { command, args } = pythonCommand(platform);
  return { command, args: [...args, "-m", "PyInstaller", "mady-engine.spec", "--noconfirm"] };
}

/**
 * The folder Playwright installs its browsers and its ffmpeg into, by Playwright's own rule:
 * PLAYWRIGHT_BROWSERS_PATH when set, otherwise the system's cache folder + `ms-playwright`.
 * @param {string} [platform]
 * @param {Record<string, string | undefined>} [env]
 * @param {string} [home]
 * @returns {string}
 */
export function playwrightDir(platform = process.platform, env = process.env, home = homedir()) {
  if (env.PLAYWRIGHT_BROWSERS_PATH != null) return env.PLAYWRIGHT_BROWSERS_PATH;
  if (platform === "win32") return join(env.LOCALAPPDATA ?? join(home, "AppData", "Local"), "ms-playwright");
  if (platform === "darwin") return join(home, "Library", "Caches", "ms-playwright");
  return join(env.XDG_CACHE_HOME ?? join(home, ".cache"), "ms-playwright");
}

/**
 * The file name of Playwright's ffmpeg inside its `ffmpeg-<build>` folder.
 * @param {string} [platform]
 * @returns {string}
 */
export function ffmpegFileName(platform = process.platform) {
  return platform === "win32" ? "ffmpeg-win64.exe" : platform === "darwin" ? "ffmpeg-mac" : "ffmpeg-linux";
}
