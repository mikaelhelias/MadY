import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Resolve the @mady/* workspace packages to their source, not the compiled dist/.
// Without this, app tests import the last-built dist — so an edit to e.g. buildScene.ts is
// silently tested against stale code, which can hide real defects until the next dist rebuild.
const src = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@mady/graphics": src("./packages/graphics/src/index.ts"),
      "@mady/core": src("./packages/core/src/index.ts"),
      "@mady/contracts": src("./packages/contracts/src/index.ts"),
      "@mady/engine-client": src("./packages/engine-client/src/index.ts"),
    },
  },
  test: {
    include: ["packages/**/src/**/*.test.{ts,tsx}", "apps/**/src/**/*.test.{ts,tsx}"],
    // 30 s, not the 5 s default. On a busy machine in a full run, loading a panel alone can take
    // more than 5 s, failing tests on the clock with no assertion wrong. A real hang still
    // fails; a test that sets its own limit is unaffected. The engine tests start Python with the
    // same 30 s (`startTimeoutMs`).
    testTimeout: 30_000,
  },
});
