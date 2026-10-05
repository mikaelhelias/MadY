import { isAbsolute } from "node:path";

/**
 * The folder this run keeps its profile in — settings, recent files, the style library and the
 * crash-recovery copy — when `MADY_PROFILE_DIR` names one; otherwise null, and the system's own
 * place is used. A test run sets it so it never reads or changes the profile of the person using
 * the computer. Electron takes its profile folder from the system, not from APPDATA or
 * --user-data-dir, so this is the only way to move it.
 *
 * A relative path is refused rather than resolved against wherever the program happened to start.
 */
export function profileDirOverride(env: Record<string, string | undefined>): string | null {
  const dir = env.MADY_PROFILE_DIR?.trim();
  if (!dir) return null;
  if (!isAbsolute(dir)) throw new Error(`MADY_PROFILE_DIR must be an absolute folder, not "${dir}"`);
  return dir;
}
