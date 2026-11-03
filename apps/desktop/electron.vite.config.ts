import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

/** A human-readable build stamp (version · commit · build time), computed when
 *  this config loads — i.e. every `electron-vite dev`/`build`. Shown next to the
 *  "MadY" brand so a stale/mismatched running build is obvious at a glance. */
function buildStamp(): string {
  let sha = "nogit";
  try {
    sha = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    if (execSync("git status --porcelain", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim()) sha += "+";
  } catch {
    /* not a git checkout — leave "nogit" */
  }
  const version = JSON.parse(readFileSync(resolve("package.json"), "utf8")).version as string;
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, "0");
  const time = `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  return `v${version} · ${sha} · ${time}`;
}

/** Which edition to build. `MADY_EDITION=agent` (or `MADY_AGENT_API=1`) selects the
 *  agent edition; anything else is the standard edition. Read once at config load. */
const AGENT_EDITION = process.env.MADY_EDITION === "agent" || process.env.MADY_AGENT_API === "1";

/**
 * Minified, all three bundles. electron-vite leaves them readable by default, and a readable
 * bundle ships every source comment to every user. Minifying drops comments; licence notices
 * (`/*!`, `@license`) are kept. Guarded by `release-contents.test.ts`.
 */
const SHIP = { minify: "esbuild" as const, sourcemap: false };

export default defineConfig({
  main: {
    build: SHIP,
    plugins: [externalizeDepsPlugin({ exclude: ["@mady/engine-client", "@mady/contracts"] })],
    resolve: { alias: {
      "@mady/engine-client": resolve("../../packages/engine-client/src"),
      "@mady/contracts": resolve("../../packages/contracts/src"),
    } },
  },
  preload: {
    build: SHIP,
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    build: SHIP,
    resolve: {
      alias: {
        "@renderer": resolve("src/renderer/src"),
        "@mady/core": resolve("../../packages/core/src"),
        "@mady/contracts": resolve("../../packages/contracts/src"),
        "@mady/graphics": resolve("../../packages/graphics/src"),
      },
    },
    plugins: [react()],
    define: {
      __MADY_BUILD__: JSON.stringify(buildStamp()),
      // The year the program was built: the year its citation gives.
      __MADY_BUILD_YEAR__: JSON.stringify(new Date().getFullYear()),
      // Two editions from one source, chosen at build time. The AGENT edition exposes the
      // typed agent API (window.madyAgent); the standard edition tree-shakes it out
      // entirely (the gated code is unreachable when this is false → not emitted). Driven
      // by env so `dist` vs `dist:agent` produce different artifacts from identical source.
      __AGENT_API__: JSON.stringify(AGENT_EDITION),
      __MADY_EDITION__: JSON.stringify(AGENT_EDITION ? "Agent" : "Standard"),
    },
  },
});
