import { resolve } from "node:path";

/**
 * How the Electron tests start MadY. By default: the development app (Electron with apps/desktop as its app folder,
 * as in a dev run). With MADY_APP_EXE set to a packaged MadY program (a build's folder, such as
 * release/linux-unpacked/mady), that program instead, so the same tests check what ships, its frozen statistics
 * engine included.
 *
 * On Linux, Chromium's sandbox needs a helper program owned by root, which a build folder and a test machine do
 * not have, so it is switched off there; the tests open only MadY's own pages.
 */
export function launchOptions(
  repo: string,
  profileDir: string,
  env: Record<string, string | undefined> = process.env,
  platform: string = process.platform,
): { executablePath: string; args: string[]; env: Record<string, string> } {
  const sandbox = platform === "linux" ? ["--no-sandbox"] : [];
  // Only the variables that are set: the launcher takes strings.
  const runEnv: Record<string, string> = { ...Object.fromEntries(Object.entries(env).filter((e): e is [string, string] => e[1] !== undefined)), MADY_PROFILE_DIR: profileDir };
  const packaged = env.MADY_APP_EXE?.trim();
  if (packaged) return { executablePath: resolve(packaged), args: sandbox, env: runEnv };
  const electron = resolve(repo, "node_modules/electron/dist", platform === "win32" ? "electron.exe" : "electron");
  return { executablePath: electron, args: [...sandbox, resolve(repo, "apps/desktop")], env: runEnv };
}
