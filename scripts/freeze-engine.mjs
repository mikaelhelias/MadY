/**
 * Freeze the statistics engine with PyInstaller (→ engines/py/dist/mady-engine/).
 *
 * Run as `npm run freeze-engine` from apps/desktop. Uses `py -3` on Windows and `python3` on
 * macOS (build-platform.mjs). PyInstaller's exit status is passed on unchanged, so a failed
 * freeze fails the command that ran it.
 */
import { spawnSync } from "child_process";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { freezeCommand } from "./build-platform.mjs";

const ENGINE = join(dirname(fileURLToPath(import.meta.url)), "..", "engines", "py");
const { command, args } = freezeCommand();
const run = spawnSync(command, args, { cwd: ENGINE, stdio: "inherit" });
if (run.error) {
  console.error(`freeze-engine: could not start ${command}: ${run.error.message}`);
  process.exit(1);
}
process.exit(run.status ?? 1);
