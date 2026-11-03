import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
export { EngineTransport as EngineClient, EngineError } from "@mady/engine-client";
export type { EngineOptions as EngineClientOptions } from "@mady/engine-client";

/**
 * Resolve how to launch the stats engine, mirroring the desktop app's `resolveEngine`
 * plus env overrides so this can point at a frozen engine or a custom interpreter:
 *   - `MADY_ENGINE_EXE`    → a frozen engine binary (run with no script arg)
 *   - `MADY_ENGINE_CMD`    → the interpreter (default: `py -3` on Windows, else `python3`)
 *   - `MADY_ENGINE_SCRIPT` → path to `engine.py` (default: found by walking up to the repo)
 */
export function resolveEngine(env: NodeJS.ProcessEnv = process.env): { command: string; args: string[] } {
  if (env.MADY_ENGINE_EXE) return { command: env.MADY_ENGINE_EXE, args: [] };
  const command = env.MADY_ENGINE_CMD ?? (process.platform === "win32" ? "py" : "python3");
  // The default Windows launcher gets `-3`: given a script and no version, it follows the script's
  // `#!` line and can pick another Python found on PATH, one without the packages.
  const pre = !env.MADY_ENGINE_CMD && process.platform === "win32" ? ["-3"] : [];
  const script = env.MADY_ENGINE_SCRIPT ?? findEngineScript();
  if (!script) {
    throw new Error(
      "could not locate engines/py/engine.py — set MADY_ENGINE_SCRIPT (or MADY_ENGINE_EXE for a frozen engine)",
    );
  }
  return { command, args: [...pre, script] };
}

/** Walk up from this module toward the repo root, looking for engines/py/engine.py. */
function findEngineScript(): string | null {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, "engines", "py", "engine.py");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
