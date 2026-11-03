/**
 * `npm run dev:llm` — the dev app with the language model.
 *
 * Plain `npm run dev` runs the version without it: no button and no bar. This starts the same `electron-vite dev` with `MADY_LLM=1`, the
 * one switch that turns the feature on (`llmEnabled` in apps/desktop/src/main/modelConfig.ts).
 *
 * A script rather than an inline `MADY_LLM=1 electron-vite dev`: npm scripts have no portable
 * way to set an environment variable on Windows without a dependency, and this repo does not
 * carry cross-env.
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const desktop = join(dirname(fileURLToPath(import.meta.url)), "..", "apps", "desktop");
const child = spawn(process.platform === "win32" ? "npx.cmd" : "npx", ["electron-vite", "dev"], {
  cwd: desktop,
  stdio: "inherit",
  env: { ...process.env, MADY_LLM: "1" },
  shell: process.platform === "win32",
});
child.on("exit", (code) => process.exit(code ?? 0));
