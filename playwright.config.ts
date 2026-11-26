import { defineConfig } from "@playwright/test";

/**
 * End-to-end harness — the layer jsdom cannot be.
 *
 * Why this exists: jsdom has no DOMMatrix, so `getScreenCTM()` is null and a coordinate drag
 * can never commit there. Every jsdom contract test is therefore forced to assert a proxy —
 * "the cursor says move", "a handler is attached" — instead of the fact that matters: the
 * document actually changed. A drag target can pass every one of those proxies while doing
 * nothing. Only a real browser settles it.
 *
 * Runs against the built renderer served as static files (the same `:8849` preview used for
 * manual checks) — no Electron, because the whole figure layer is plain React + SVG. The
 * Analyze sidecar is absent in a browser; nothing here needs it.
 *
 * Note: the preview serves a built bundle, so `webServer.command` builds first — otherwise this
 * suite silently tests a stale renderer.
 */
const PORT = 8850; // not 8849, so a preview already running there is left alone

/**
 * The measurement sweeps — their own project, so the everyday run stays short. The default
 * `npm run e2e` is the contract suite;
 * `npm run e2e:sweeps` runs these; `npm run e2e:all` runs both.
 *
 * Each entry notes its number of tests (as `--list` prints them), not its duration. The count is
 * not a measure of time: most of these files are one test that loops over every gallery card
 * inside itself, while `dead-affordance` is 76 separate tests. To know what one costs, run it and
 * time it.
 *
 * Run one by name: `npx playwright test --project=sweeps e2e/<file>.spec.ts`.
 * Caution: `--project sweeps <file>` — without the `=` — makes Playwright read the filename as a
 * second project. It prints "project not found" and exits 0, so the run looks like it passed.
 */
const SWEEPS = [
  "**/axis-field-efficacy.spec.ts", // every AxisSpec field × every kind — 1 test
  "**/style-field-efficacy.spec.ts", // every per-kind style field — 1 test
  "**/point-style-efficacy.spec.ts", // every per-point override — 1 test
  "**/series-style-efficacy.spec.ts", // every per-series style — 1 test
  "**/dead-affordance.spec.ts", // every drag cursor on every card — 76 tests
  "**/figure-geometry.spec.ts", // text-on-text over every card — 3 tests
  "**/ink-fills-box.spec.ts", // ink ratio of every card — 1 test
  "**/text-editable.spec.ts", // every text of every card opens its editor — 8 tests
  "**/preset-all-kinds-live.spec.ts", // one preset through every type — 1 test
  "**/category-groups-by-hand.spec.ts", // By-hand category groups on every applicable chart — 1 test
  "**/rotated-axis-labels.spec.ts", // every X label rotation on every card, with and without groups — 1 test
  "**/rotated-y-labels.spec.ts", // every Y label rotation on every card and flipped form — 1 test
  "**/hint-fits-everywhere.spec.ts", // every hint in every Inspector tab of every card, and every dialog — 9 tests
];

export default defineConfig({
  testDir: "./e2e",
  // A dead-affordance sweep drives many gestures per kind; give each spec room.
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    // No automatic failure screenshots; a retained trace (DOM snapshots, actions, console) is the post-mortem.
    trace: "retain-on-failure",
    screenshot: "off",
    video: "off",
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    { name: "chromium", testIgnore: SWEEPS, use: { channel: undefined, browserName: "chromium" } },
    { name: "sweeps", testMatch: SWEEPS, use: { channel: undefined, browserName: "chromium" } },
  ],
  webServer: {
    command: `npm run build:renderer && node tools/preview-server.mjs apps/desktop/out/renderer ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
