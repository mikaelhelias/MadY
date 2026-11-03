/**
 * Regenerate the in-app manual's snapshots — `apps/desktop/src/renderer/src/assets/guide/*.png`
 * and the call-out coordinates beside them (`*.marks.json`).
 *
 * Run from the repo root:   node scripts/gen-guide-shots.mjs             (every picture)
 *                           node scripts/gen-guide-shots.mjs axis result  (only files whose
 *                                                                          name contains one
 *                                                                          of these)
 *
 * The filter is for iterating on one picture. A capture is a function of its own setup alone
 * (fresh context per shot, below), so re-taking one cannot change another — but re-taking all
 * of them rewrites every PNG, and a commit full of byte-different,
 * pixel-identical images hides the picture that actually changed.
 *
 * Every image the Docs tab shows comes from here, captured off the running app, so a UI change
 * never leaves the manual showing a picture of software that no longer exists — re-run this
 * script and the same clicks retake the same shots. `guide-shots.test.ts` holds the contract:
 * every `shot` block's file must exist, every file here must be referenced, and every mark must
 * be inside its picture and carry a label.
 *
 * What to capture lives in `guide-shots.spec.mjs`; how to work the app lives in
 * `guide-shots-driver.mjs`. This file is only the loop: set the viewport, run the setup, resolve
 * the marks, take the picture, write the JSON.
 *
 * The marks are measured, not drawn by hand. A call-out is a promise that the numbered box is
 * around a real control, so the coordinates come from `getBoundingClientRect()` at capture time
 * and a target that resolves to nothing (or to a zero-size box) fails the run. A hand-placed box
 * would go quietly wrong the first time a panel moved, which is exactly what this pipeline
 * exists to prevent.
 *
 * Self-contained: serves the built bundle itself (tools/preview-server.mjs on :8851), so the
 * only prerequisite is a build — `cd apps/desktop && npx electron-vite build` first, or the
 * shots will show the last build rather than the current code.
 *
 * Captures run in headless Chromium (Playwright).
 */
import { spawn } from "child_process";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { createRequire } from "module";
import { createServer } from "node:net";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { makeApp, resolveTarget } from "./guide-shots-driver.mjs";
import { SHOTS } from "./guide-shots.spec.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "apps/desktop/src/renderer/src/assets/guide");
// The port must be free before serving on it. If another process's preview server is already
// on 8851, the spawn dies silently (stdio ignored), the readiness fetch gets a 200 from the
// other server, and every capture photographs the wrong bundle while the run reports success.
// So: probe first, fail loudly, and let GUIDE_SHOTS_PORT move it.
const PORT = Number(process.env.GUIDE_SHOTS_PORT ?? 8851);
const BASE = `http://localhost:${PORT}/`;
await new Promise((resolve, reject) => {
  const probe = createServer();
  probe.once("error", (e) =>
    reject(
      new Error(
        `port ${PORT} is already in use (${e.code}) — a capture would photograph whatever is serving there, not this build. Stop it, or run with GUIDE_SHOTS_PORT=<free port>.`,
      ),
    ),
  );
  probe.listen(PORT, "127.0.0.1", () => probe.close(resolve));
});
const DEFAULT_VIEWPORT = [1500, 950];
const ONLY = process.argv.slice(2);
const wanted = (file) => ONLY.length === 0 || ONLY.some((f) => file.includes(f));

mkdirSync(OUT, { recursive: true });

/**
 * Does this PNG contain more than one colour?
 *
 * Read through Playwright's own Chromium, which already has a PNG decoder — the alternative is a
 * dependency, and this only has to answer one question. The image is drawn onto a canvas and the
 * pixels compared to the first; it returns on the first difference, so a real capture costs a
 * few milliseconds.
 */
async function hasInk(path) {
  const page = await browser.newPage();
  try {
    const data = readFileSync(path).toString("base64");
    return await page.evaluate(async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext("2d").drawImage(img, 0, 0);
      const px = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      for (let i = 4; i < px.length; i += 4) {
        if (px[i] !== px[0] || px[i + 1] !== px[1] || px[i + 2] !== px[2] || px[i + 3] !== px[3]) return true;
      }
      return false;
    }, data);
  } finally {
    await page.close();
  }
}

// ── serve the built bundle ourselves, so the run needs nothing else running ──
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
    const r = await fetch(BASE);
    if (r.ok) break;
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

/** The graph plus a 10 px margin: the resize/axis grips sit on the SVG edge, and an exact crop
 *  cuts them in half — which reads as a rendering glitch in a manual. */
async function figureClip(page) {
  const box = await page.locator("svg.gfx-figure").first().boundingBox();
  const pad = 10;
  return { x: box.x - pad, y: box.y - pad, width: box.width + 2 * pad, height: box.height + 2 * pad };
}

let failures = 0;

if (ONLY.length > 0) {
  const hits = SHOTS.filter((s) => wanted(s.file)).map((s) => s.file);
  if (hits.length === 0) {
    console.error(`no shot matches ${ONLY.join(" ")} — nothing to do`);
    process.exit(1);
  }
  console.log(`only: ${hits.join(", ")}`);
}

for (const spec of SHOTS) {
  if (!wanted(spec.file)) continue;
  const [vw, vh] = spec.viewport ?? DEFAULT_VIEWPORT;
  // A fresh context per shot — not one page walked through all of them.
  //
  // The app remembers things: which Inspector sections were left open, the dock widths, the
  // saved presets and templates. Sharing one page would make every picture depend on the ones
  // before it, and moving an entry in the spec would silently change unrelated captures
  // (e.g. a different ribbon width, or taller preset cards).
  // A new context has empty storage, so a shot is a function of its own setup and nothing else.
  const context = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const app = makeApp(page, BASE);
  try {
    await spec.setup(app);
  } catch (err) {
    console.error(`✗ ${spec.file}: setup failed — ${err.message}`);
    failures++;
    await context.close();
    continue;
  }

  // The capture's origin and size in viewport CSS pixels. Marks are recorded relative to it, so
  // the overlay can be drawn over the image without knowing anything about the app.
  let origin = { x: 0, y: 0 };
  let size = { w: vw, h: vh };
  let shoot;

  if (spec.capture === "page") {
    shoot = () => page.screenshot({ path: join(OUT, spec.file), timeout: 10000 });
  } else if (spec.capture === "figure") {
    const clip = await figureClip(page);
    origin = { x: clip.x, y: clip.y };
    size = { w: clip.width, h: clip.height };
    shoot = () => page.screenshot({ path: join(OUT, spec.file), clip, timeout: 10000 });
  } else if (typeof spec.capture === "function") {
    const locator = spec.capture(app);
    const box = await locator.boundingBox();
    if (!box) {
      console.error(`✗ ${spec.file}: the element to capture is not on screen`);
      failures++;
      await context.close();
      continue;
    }
    origin = { x: box.x, y: box.y };
    size = { w: box.width, h: box.height };
    shoot = () => locator.screenshot({ path: join(OUT, spec.file), timeout: 10000 });
  } else if (spec.capture && spec.capture.clip) {
    const clip = await spec.capture.clip(app);
    origin = { x: clip.x, y: clip.y };
    size = { w: clip.width, h: clip.height };
    shoot = () => page.screenshot({ path: join(OUT, spec.file), clip, timeout: 10000 });
  } else {
    console.error(`✗ ${spec.file}: no capture given`);
    failures++;
    await context.close();
    continue;
  }

  // ── the call-outs, measured before the shutter ──
  const marks = [];
  let unresolved = false;
  for (const [i, m] of (spec.marks ?? []).entries()) {
    const rect = await resolveTarget(page, m.target);
    if (!rect) {
      console.error(`✗ ${spec.file}: call-out ${i + 1} (“${m.label}”) points at nothing — ${JSON.stringify(m.target)}`);
      unresolved = true;
      continue;
    }
    // Clamp to the picture. A control can genuinely extend past the edge of the capture — the
    // Inspector's tab rail is 4 px wider than the window it sits in — and a box drawn outside
    // the image is simply not there, while the legend still names it. So the box is trimmed to
    // what the reader can actually see…
    const x0 = Math.max(0, rect.x - origin.x);
    const y0 = Math.max(0, rect.y - origin.y);
    const x1 = Math.min(size.w, rect.x - origin.x + rect.w);
    const y1 = Math.min(size.h, rect.y - origin.y + rect.h);
    // …and if none of it is visible, that is an unresolved call-out, not a thin box.
    if (x1 - x0 <= 1 || y1 - y0 <= 1) {
      console.error(`✗ ${spec.file}: call-out ${i + 1} (“${m.label}”) is outside the picture`);
      unresolved = true;
      continue;
    }
    const round = (v) => Math.round(v * 10) / 10;
    marks.push({ n: i + 1, x: round(x0), y: round(y0), w: round(x1 - x0), h: round(y1 - y0), label: m.label });
  }
  if (unresolved) {
    failures++;
    await context.close();
    continue; // never write a picture whose legend would claim a box that is not there
  }

  await shoot();

  // A picture of nothing is a failed capture.
  //
  // A capture can come out as a blank white rectangle with numbered call-outs over it while
  // everything upstream passes: the setup runs, the menu exists, and every mark resolves to a
  // real box — e.g. a `position: fixed` menu placed far below a 1000px viewport, which has a
  // valid bounding box and no pixels in the picture. Only the output can show it, so that is what this checks.
  //
  // Deliberately the weakest possible test — is there more than one colour in it? — because a
  // legitimate capture can be almost anything, and a check that guesses at "enough contrast"
  // would start refusing real pictures and get itself turned off.
  if (!(await hasInk(join(OUT, spec.file)))) {
    console.error(`✗ ${spec.file}: the capture is a single flat colour — nothing was on screen`);
    failures++;
    await context.close();
    continue;
  }

  const json = join(OUT, `${spec.file}.marks.json`);
  if (marks.length > 0) {
    // Note: the overlay's viewBox must be the size of the image that exists, not of the bounding
    // box measured before the shutter. An element's box is fractional (769.4 px tall) and
    // the capture rounds it up, so the two can disagree by a pixel — enough for the ×2 identity
    // in `guide-shots.test.ts` to fail, and enough for every box to sit a hair off in a tall
    // capture. Captures are at 2× device pixels, so the CSS-pixel size is half the PNG's.
    const png = readFileSync(join(OUT, spec.file));
    const w = png.readUInt32BE(16) / 2;
    const h = png.readUInt32BE(20) / 2;
    writeFileSync(json, `${JSON.stringify({ w, h, marks }, null, 1)}\n`);
    console.log(`✓ ${spec.file}  (${marks.length} call-outs)`);
  } else {
    console.log(`✓ ${spec.file}`);
  }
  await context.close();
}

await browser.close();
killServer();

if (failures > 0) {
  console.error(`\n${failures} shot(s) failed — the manual's pictures are not up to date.`);
  process.exit(1);
}
console.log("done — images in apps/desktop/src/renderer/src/assets/guide/");
