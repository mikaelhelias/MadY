/**
 * Record a headless Chromium page to a silent .webm, with no software MadY does not already have.
 *
 * The frames come from Chromium's own screencast (the Chrome DevTools Protocol), as JPEGs; the
 * encoder is the ffmpeg build Playwright installs for its own video recording
 * (`ms-playwright/ffmpeg-*` in the system's cache folder). That build does exactly one thing —
 * JPEG frames in, VP8 .webm out, no sound — which is all these videos need.
 *
 * Why not Playwright's `recordVideo`: it encodes at a fixed 1 Mbit/s, and at 1920 × 1080 the
 * program's 11-px labels smear. Doing the same two steps ourselves lets the text stay sharp.
 */
import { spawn } from "child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "fs";
import { join } from "path";
import { ffmpegFileName, playwrightDir } from "./build-platform.mjs";
import { frameSchedule, withHolds } from "./guide-video-timing.mjs";

/** Playwright's ffmpeg, or a clear error naming what to install. */
export function playwrightFfmpeg() {
  const base = playwrightDir();
  const dirs = existsSync(base) ? readdirSync(base).filter((d) => d.startsWith("ffmpeg-")).sort() : [];
  for (const d of dirs.reverse()) {
    const exe = join(base, d, ffmpegFileName());
    if (existsSync(exe)) return exe;
  }
  throw new Error(`no Playwright ffmpeg under ${base} — run: npx playwright install ffmpeg`);
}

/**
 * Start capturing `page`. Returns `stop()`, which ends the capture and writes `outFile`.
 *
 * @param {import("@playwright/test").Page} page
 * @param {{ width: number, height: number, fps?: number, scale?: number }} size
 *   `scale`: the page's device pixel ratio, so the frames come back at full sharpness
 *   (`width × scale` pixels wide) instead of being shrunk to the CSS size
 */
export async function startRecording(page, { width, height, fps = 30, scale = 1 }) {
  const cdp = await page.context().newCDPSession(page);
  /** @type {{ data: Buffer, t: number }[]} */
  const frames = [];
  let start = Date.now() / 1000;
  // Only the last frame inside each 1/fps slot can ever be shown (see `frameSchedule`), so an
  // earlier one in the same slot is dropped as the next arrives. Without this a pointer gliding
  // at 60 repaints a second would keep every repaint, and a long video would hold around a
  // gigabyte of JPEGs in memory.
  const slot = (t) => Math.floor((t - start) * fps);
  cdp.on("Page.screencastFrame", (f) => {
    const frame = { data: Buffer.from(f.data, "base64"), t: f.metadata.timestamp };
    if (frames.length > 0 && slot(frames[frames.length - 1].t) === slot(frame.t)) frames.pop();
    frames.push(frame);
    cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
  });
  start = Date.now() / 1000;
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: Math.round(width * scale), maxHeight: Math.round(height * scale), everyNthFrame: 1 });

  // Nudge a repaint so the first frame is the page as it stands, not whatever arrives first.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));

  return {
    frames,
    /** Stop, then encode to `outFile`. Resolves with the number of frames written. `maxRate` caps the
     *  bit rate (default 1M) — a video that scrolls the whole gallery needs more.
     *  `holds` keep the picture still where a narrated line needs longer than its step
     *  (see `planNarration`), in seconds of the recording. `endAt` ends the video at that many
     *  seconds of the recording instead of now — the narration is spoken between filming and
     *  encoding, and those seconds are not part of the video. */
    async stop(outFile, { maxRate = "1M", holds = [], endAt = undefined } = {}) {
      const end = endAt == null ? Date.now() / 1000 : start + endAt;
      await cdp.send("Page.stopScreencast").catch(() => {});
      await cdp.detach().catch(() => {});
      if (frames.length === 0) throw new Error("the screencast sent no frames — nothing was drawn");
      // The screencast's timestamps and Date.now() are both wall-clock seconds. Before the first
      // frame arrives, `frameSchedule` shows the first frame.
      const pick = withHolds(
        frameSchedule(
          frames.map((f) => f.t),
          start,
          end,
          fps,
        ),
        holds,
        fps,
      );
      await encode(pick.map((i) => frames[i].data), outFile, { width, height, fps, maxRate });
      return pick.length;
    },
    /** Stop, and write the steady 30-a-second frames as numbered JPEGs (`00001.jpg` …) into `dir`,
     *  unencoded — for a video that is edited (cut or zoomed) from the frames afterwards.
     *  Resolves with the number of frames written. */
    async stopToFrames(dir) {
      const end = Date.now() / 1000;
      await cdp.send("Page.stopScreencast").catch(() => {});
      await cdp.detach().catch(() => {});
      if (frames.length === 0) throw new Error("the screencast sent no frames — nothing was drawn");
      const pick = frameSchedule(
        frames.map((f) => f.t),
        start,
        end,
        fps,
      );
      mkdirSync(dir, { recursive: true });
      pick.forEach((i, k) => writeFileSync(join(dir, `${String(k + 1).padStart(5, "0")}.jpg`), frames[i].data));
      return pick.length;
    },
    /** Seconds since the capture started — the clock a mark's time is written in. */
    now: () => Date.now() / 1000 - start,
  };
}

/**
 * JPEG frames → VP8 .webm.
 *
 * Quality-targeted (constant quality 28, capped at `maxRate`, 1 Mbit/s unless told otherwise — a bit
 * compressed for the manual, which keeps table text sharp at 1080p, where 720p blurs it): a program
 * window is mostly still, so the still stretches cost almost nothing and the moments something moves get the bits.
 * `pad` centres a frame that came back smaller than the video (it never should) instead of
 * failing the encode.
 */
function encode(jpegs, outFile, { width, height, fps, maxRate }) {
  return new Promise((resolve, reject) => {
    const ff = spawn(
      playwrightFfmpeg(),
      [
        "-hide_banner", "-loglevel", "error", "-y",
        "-f", "image2pipe", "-c:v", "mjpeg", "-framerate", String(fps), "-i", "pipe:0",
        "-vf", `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
        "-c:v", "libvpx", "-crf", "28", "-b:v", maxRate, "-qmin", "4", "-qmax", "50",
        "-deadline", "good", "-cpu-used", "2", "-auto-alt-ref", "0",
        "-r", String(fps), outFile,
      ],
      { stdio: ["pipe", "ignore", "pipe"] },
    );
    let err = "";
    ff.stderr.on("data", (d) => (err += d));
    ff.on("error", reject);
    // ffmpeg quitting early closes its input; the reason is on stderr, reported by `close` below.
    ff.stdin.on("error", () => {});
    ff.on("close", (code) => (code === 0 ? resolve(null) : reject(new Error(`ffmpeg exited ${code}: ${err.trim()}`))));
    (async () => {
      for (const j of jpegs) {
        if (!ff.stdin.write(j)) await new Promise((r) => ff.stdin.once("drain", r));
      }
      ff.stdin.end();
    })().catch(reject);
  });
}

/**
 * Pull single frames out of a finished video as PNGs, so the result can be checked by eye as
 * still pictures. `times` in seconds.
 */
export function extractFrames(videoFile, times, outPattern) {
  return Promise.all(
    times.map(
      (t, i) =>
        new Promise((resolve, reject) => {
          const out = outPattern.replace("%d", String(i + 1).padStart(2, "0"));
          const ff = spawn(playwrightFfmpeg(), ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(t), "-i", videoFile, "-frames:v", "1", "-c:v", "png", out], {
            stdio: ["ignore", "ignore", "pipe"],
          });
          let err = "";
          ff.stderr.on("data", (d) => (err += d));
          ff.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`frame ${t}s: ${err.trim()}`))));
        }),
    ),
  );
}
