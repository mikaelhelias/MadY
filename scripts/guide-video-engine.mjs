/**
 * The real statistics engine, for a manual video that runs an analysis (`gen-guide-videos.mjs`).
 *
 * The pictures replay answers recorded earlier, which only covers the questions asked when they
 * were recorded; a video that runs a new analysis on screen would get an error. So a video with
 * `engine: true` gets `engines/py/engine.py` itself, spoken to over the same framed JSON the
 * desktop app uses, and the browser's missing preload bridge (`window.mady.runAnalysis`) is the
 * one thing filled in — exactly as `bootWithEngine` does for the pictures.
 */
import { spawn } from "child_process";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export function startEngine() {
  const py = spawn("py", ["-3", join(ROOT, "engines/py/engine.py")], { cwd: ROOT });
  py.stderr.on("data", (b) => process.stderr.write(b));
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
  const hello = read();
  let id = 0;
  let queue = Promise.resolve();
  /** One question at a time — the engine answers in order and the framing has no ids to match. */
  const call = (method, data) => {
    const run = queue.then(async () => {
      await hello;
      const body = Buffer.from(JSON.stringify({ type: "request", id: String(id++), method, data }), "utf-8");
      const head = Buffer.alloc(4);
      head.writeUInt32BE(body.length, 0);
      const answer = read();
      py.stdin.write(Buffer.concat([head, body]));
      const res = await answer;
      return res.ok ? { ok: true, results: res.results } : { ok: false, message: res.message ?? res.code ?? "engine error" };
    });
    queue = run.catch(() => {});
    return run;
  };
  return { call, stop: () => py.stdin.end() };
}

export async function bootWithRealEngine(page, app, eng) {
  await page.exposeFunction("__madyEngine", (method, data) => eng.call(method, data));
  await page.addInitScript(() => {
    window.mady = window.mady ?? {};
    window.mady.runAnalysis = (method, data) => window.__madyEngine(method, data);
  });
  await app.boot();
}
