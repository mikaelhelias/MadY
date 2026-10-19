/**
 * Record the real statistics engine's answers for the demo project's analyses.
 *
 *   cd apps/desktop && npx electron-vite build      (or the recording is of stale code)
 *   node scripts/record-guide-engine.mjs             (needs `py -3` with numpy/scipy/statsmodels)
 *
 * Why: the manual's snapshots are taken in headless Chromium against the built web bundle,
 * which has no Python sidecar: an analysis photographed there shows an empty "Re-run" pane.
 * So the numbers in `analysis-result.png` come from here — the real engine, run over the exact
 * payloads the app itself builds, written to `scripts/guide-shots-engine.json` and replayed by
 * the capture through the app's own `window.mady.runAnalysis` bridge (the one thing a browser
 * genuinely lacks). Every number in the picture is the engine's own, and nothing
 * test-only is added to the app.
 *
 * Two passes, and the first one matters most:
 *   1. boot the built app with a recording stub in place of the engine bridge. The demo
 *      project's analyses ship without results, so `fillMissingAnalysisResults` sends every
 *      one of them on mount — and what is captured is the request the app built, not a
 *      re-derivation of it here that could drift from what it really sends.
 *   2. hand those requests to `engines/py/engine.py` over its own framed-JSON stdio.
 *
 * The fixture is keyed by the whole request, not by method. The demo ships two one-way
 * ANOVAs — Dunnett vs control on the treatment sheet, Tukey all-pairs on the dose sheet — and
 * a by-method key would show one sheet's numbers under the other's name.
 *
 * Re-run whenever `engine.py` or the demo project changes, or the picture shows statistics the
 * program no longer computes.
 */
import { spawn } from "child_process";
import { writeFileSync } from "fs";
import { createRequire } from "module";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "scripts/guide-shots-engine.json");
const PORT = 8852;
const BASE = `http://localhost:${PORT}/`;

// ── pass 1: what does the app actually ask the engine? ──
const server = spawn(process.execPath, ["tools/preview-server.mjs", "apps/desktop/out/renderer", String(PORT)], {
  cwd: ROOT,
  stdio: "ignore",
});
const killServer = () => {
  try {
    server.kill();
  } catch {
    /* already gone */
  }
};
process.on("exit", killServer);
for (let i = 0; ; i++) {
  try {
    if ((await fetch(BASE)).ok) break;
  } catch {
    /* not up yet */
  }
  if (i > 50) {
    console.error("preview server never came up — did the build run?");
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 100));
}

const browser = await chromium.launch();
const page = await browser.newPage();
await page.addInitScript(() => {
  window.__madyRequests = [];
  window.mady = window.mady ?? {};
  // Refuse every call — a result would be attached to the document and the next boot would
  // have nothing left to ask. We only want the questions.
  window.mady.runAnalysis = (method, data) => {
    window.__madyRequests.push({ method, data });
    return Promise.resolve({ ok: false, message: "recording" });
  };
});
await page.goto(BASE, { timeout: 20000 });
await page.waitForSelector(".nav", { timeout: 20000 });
await page.waitForFunction(() => (window.__madyRequests ?? []).length > 0, null, { timeout: 20000 });
// The fill loop is sequential; wait for it to stop growing rather than guessing a count.
let seen = -1;
for (let stable = 0; stable < 3; ) {
  const n = await page.evaluate(() => window.__madyRequests.length);
  stable = n === seen ? stable + 1 : 0;
  seen = n;
  await new Promise((r) => setTimeout(r, 300));
}

// …and the questions a dialog asks. The fill loop above only covers what the demo project
// computes on boot; `Analyze ▸ Sample size & power…` runs on mount, so opening it here is what
// puts a `power` request into the recorded set. Without it the dialog's readout is a dash in
// every capture — a picture of a blank answer, which is the one thing that chapter is about.
try {
  await page.locator(".menubar .menu", { hasText: /^Analyze$/ }).click();
  await page.locator(".dropdown .dropitem", { hasText: /^Sample size & power…/ }).first().click();
  await page.waitForSelector('[aria-label="Sample size and power"]', { timeout: 10000 });
  await page.waitForFunction(
    () => (window.__madyRequests ?? []).some((r) => r.method === "power"),
    null,
    { timeout: 10000 },
  );
  console.log("…and the power dialog asked its own question");
} catch (error) {
  console.error(`could not record the power dialog's request: ${String(error)}`);
}

const requests = await page.evaluate(() => window.__madyRequests);
await browser.close();
killServer();
if (requests.length === 0) throw new Error("the app asked the engine nothing — is the demo project still shipping analyses?");
console.log(`the app asks the engine ${requests.length} questions on boot`);

// ── pass 2: the real engine answers them ──
const py = spawn("py", ["-3", join(ROOT, "engines/py/engine.py")], { cwd: ROOT });
py.stderr.on("data", (b) => process.stderr.write(b));

/** The engine's framing: a 4-byte big-endian length, then that many bytes of JSON. */
let buf = Buffer.alloc(0);
const waiters = [];
py.stdout.on("data", (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  for (;;) {
    if (buf.length < 4) return;
    const n = buf.readUInt32BE(0);
    if (buf.length < 4 + n) return;
    const body = JSON.parse(buf.subarray(4, 4 + n).toString("utf-8"));
    buf = buf.subarray(4 + n);
    waiters.shift()?.(body);
  }
});
const read = () => new Promise((r) => waiters.push(r));
const send = (m) => {
  const body = Buffer.from(JSON.stringify(m), "utf-8");
  const head = Buffer.alloc(4);
  head.writeUInt32BE(body.length, 0);
  py.stdin.write(Buffer.concat([head, body]));
};

const hello = await read();
console.log(`engine: ${hello.engine} · contract ${hello.contractVersion}`);

const answers = [];
for (const [i, req] of requests.entries()) {
  send({ type: "request", id: String(i), method: req.method, data: req.data });
  const res = await read();
  if (!res.ok) {
    console.error(`✗ ${req.method}: ${res.code} — ${res.message}`);
    py.stdin.end();
    process.exit(1);
  }
  // The request is stored as its JSON string because that is the key the capture looks up: the
  // browser stub sees the payload the app just built and must find this exact one.
  answers.push({ method: req.method, request: JSON.stringify(req.data), results: res.results });
  console.log(`✓ ${req.method}`);
}
py.stdin.end();

writeFileSync(
  OUT,
  `${JSON.stringify(
    {
      _: "Recorded from the real Python engine by scripts/record-guide-engine.mjs — do not edit by hand.",
      engine: hello.engine,
      contractVersion: hello.contractVersion,
      libraries: hello.libraries,
      answers,
    },
    null,
    1,
  )}\n`,
);
console.log(`wrote ${OUT} (${answers.length} answers)`);
