import { defineConfig } from "@playwright/test";

/**
 * The ELECTRON leg — the pieces the browser harness structurally cannot reach: the real
 * preload bridge, real IPC, the real main-process file handlers, real disk I/O. Launches the
 * built app (`apps/desktop/out`), so run the electron-vite build first (`npm run e2e:electron`
 * does). No web server: the app IS the server.
 *
 *   npm run e2e:electron
 */
export default defineConfig({
  testDir: "./e2e-electron",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    trace: "retain-on-failure",
    screenshot: "off",
    video: "off",
  },
});
