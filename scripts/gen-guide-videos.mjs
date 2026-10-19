/**
 * Record the manual's videos — `apps/desktop/src/renderer/src/assets/guide/*.webm`.
 *
 * Run from the repo root:   node scripts/gen-guide-videos.mjs            (every video)
 *                           node scripts/gen-guide-videos.mjs presets    (only files whose name
 *                                                                          contains one of these)
 *
 * Same pipeline as the manual's pictures (`gen-guide-shots.mjs`): the running program, served
 * from the built bundle, driven headless by the same helpers — so a video is re-made after any
 * UI change by running this again, never edited by hand. What each video shows is in
 * `guide-videos.spec.mjs`; the pointer, rings and captions are `guide-video-director.mjs`; the
 * capture and encode are `guide-video-recorder.mjs`.
 *
 * Prerequisite: a build (`cd apps/desktop && npx electron-vite build`), or the videos show stale
 * code. .webm at 1920 × 1080, 30 frames a second.
 *
 * A video whose captions carry a spoken line (`say`) is narrated: after filming, each line is
 * spoken (`guide-video-voice.mjs` — needs the narrator's speech model), the picture is held still
 * where a line is longer than its step (`planNarration`), and the sound is laid over it. A video
 * with a tempo (`bpm`) is cut to a beat instead: its lines are spoken while filming, and each beat
 * waits for the line before it to end, so the program keeps moving instead of being held still.
 *
 * So a video can be checked without playing it, a still every few seconds of each video is
 * written to `MADY_VIDEO_FRAMES` (default `build/video-frames`, ignored by git).
 */
import { execFileSync, spawn } from "child_process";
import { existsSync, mkdirSync, readFileSync, statSync } from "fs";
import { createRequire } from "module";
import { createServer } from "node:net";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { makeApp } from "./guide-shots-driver.mjs";
import { makeDirector } from "./guide-video-director.mjs";
import { bootWithRealEngine, startEngine } from "./guide-video-engine.mjs";
import { extractFrames, startRecording } from "./guide-video-recorder.mjs";
import { planNarration } from "./guide-video-timing.mjs";
import { audioFfmpeg, findNarrator, lineKey, measureLoudness, mixNarration, soundtrackMuxArgs, wavSeconds } from "./guide-video-voice.mjs";
import { SR, mixSoundtrack, overviewPlan, readWavF32, voiceRms, writeWav } from "./video-music.mjs";
import { VIDEOS, VIDEO_SIZE } from "./guide-videos.spec.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "apps/desktop/src/renderer/src/assets/guide");
const FRAMES = process.env.MADY_VIDEO_FRAMES ?? join(ROOT, "build", "video-frames");
const PORT = Number(process.env.GUIDE_VIDEOS_PORT ?? 8853);
const BASE = `http://localhost:${PORT}/`;
const ONLY = process.argv.slice(2);
const wanted = (file) => ONLY.length === 0 || ONLY.some((f) => file.includes(f));

// The port must be free — the same risk as for the pictures: with another server on it, every
// video would record that server's bundle while the run still reported success.
await new Promise((resolve, reject) => {
  const probe = createServer();
  probe.once("error", (e) => reject(new Error(`port ${PORT} is already in use (${e.code}); run with GUIDE_VIDEOS_PORT=<free port>.`)));
  probe.listen(PORT, "127.0.0.1", () => probe.close(resolve));
});

const selected = VIDEOS.filter((v) => wanted(v.file));
if (selected.length === 0) {
  console.error(`no video matches ${ONLY.join(" ")} — nothing to do`);
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });
mkdirSync(FRAMES, { recursive: true });

const server = spawn(process.execPath, ["tools/preview-server.mjs", "apps/desktop/out/renderer", String(PORT)], { cwd: ROOT, stdio: "ignore" });
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
let failures = 0;
/** The narrator and the audio ffmpeg, started on first use (see `guide-video-voice.mjs`). */
let narrator;
let soundFfmpeg;

// A beat-cut video that had to make a line while filming is filmed once more (its lines are kept, so
// the second take has every one ready): making a line can take longer than saying it, and a beat
// waiting on it would stretch the step.
const retaken = new Set();
const queue = [...selected];
while (queue.length) {
  const spec = queue.shift();
  const { width, height } = VIDEO_SIZE;
  // A fresh context per video, for the reason the pictures have one: the program remembers
  // panels, presets and dock widths, and one video must not depend on the one before it.
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const app = makeApp(page, BASE);
  // Each line is spoken once, into a file named by its voice and words (kept between runs); a
  // video cut to a beat asks for its lines while it is filmed, so each beat can wait for the line
  // before it to end.
  const work = join(ROOT, "build", "narration", spec.file.replace(/\.webm$/, ""));
  const lineWav = (text) => {
    narrator ??= findNarrator();
    return join(work, `say-${lineKey(narrator.id, text)}.wav`);
  };
  const said = new Map();
  let filming = false;
  let madeWhileFilming = 0;
  const lineLength = (text) => {
    if (!said.has(text)) {
      const out = lineWav(text);
      mkdirSync(work, { recursive: true });
      if (filming && !existsSync(out)) madeWhileFilming++;
      said.set(text, existsSync(out) ? Promise.resolve(wavSeconds(readFileSync(out))) : narrator.say(text, out));
    }
    return said.get(text);
  };
  const dir = makeDirector(page, { bpm: spec.bpm, glide: spec.glide ?? 1, lineLength: spec.bpm ? lineLength : undefined });
  const file = join(OUT, spec.file);
  const started = Date.now();
  const eng = spec.engine ? startEngine() : null;
  try {
    // Loading and preparing is not filmed — a video that opens on a spinner wastes its first
    // seconds. `setup` leaves the program where the video starts.
    // `init` fills in a desktop-only bridge a video needs (a file dialog), before the page loads.
    if (spec.init) await page.addInitScript(spec.init);
    if (eng) await bootWithRealEngine(page, app, eng);
    else await app.boot();
    await spec.setup?.(app, dir);
    await dir.install();
    // The narrator is started before filming: loading its model takes seconds, and a beat-cut
    // video waiting for its first line would otherwise stand still that long.
    if (spec.bpm) {
      narrator ??= findNarrator();
      await narrator.ready;
    }
    const rec = await startRecording(page, { width, height });
    dir.startClock(rec.now);
    filming = true;
    await spec.run(app, dir);
    filming = false;
    const filmed = rec.now();
    if (errors.length) throw new Error(`the page reported errors while filming: ${errors.slice(0, 3).join(" | ")}`);
    const spoken = dir.cues.filter((c) => c.say);
    let note = "";
    let n;
    if (spoken.length === 0) {
      n = await rec.stop(file, { maxRate: spec.maxRate ?? "1M", endAt: filmed });
    } else {
      // The lines' lengths decide where the picture waits for them (a beat-cut video has waited
      // already, while filming, so there it rarely has to).
      soundFfmpeg ??= audioFfmpeg();
      const cues = [];
      for (const c of dir.cues) cues.push({ cut: c.cut, at: c.at, dur: c.say ? await lineLength(c.say) : undefined });
      const plan = planNarration(cues, filmed);
      const silent = join(work, "silent.webm");
      n = await rec.stop(silent, { maxRate: spec.maxRate ?? "1M", holds: plan.holds, endAt: filmed });
      const lines = cues.flatMap((c, k) => (c.dur == null ? [] : [{ wav: lineWav(dir.cues[k].say), start: plan.starts[k] }]));
      if (spec.music) {
        // Music under the voice: quiet under the opening card, the groove from its first cut, a
        // resolving close from the last headline — all read off the video's own cues.
        const music = overviewPlan({ total: plan.length, bpm: spec.bpm, intro: dir.cues[1]?.cut ?? 0, outro: plan.length - dir.cues[dir.cues.length - 1].cut });
        const voice = lines.map((l) => {
          const f32 = l.wav.replace(/\.wav$/, ".48k.wav");
          execFileSync(soundFfmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-i", l.wav, "-af", `aresample=${SR}`, "-ac", "1", "-c:a", "pcm_f32le", f32]);
          const samples = readWavF32(readFileSync(f32));
          const g = 0.1 / (voiceRms(samples) || 1);
          for (let i = 0; i < samples.length; i++) samples[i] *= g;
          return { start: l.start, samples };
        });
        const mixWav = join(work, "soundtrack.wav");
        writeWav(mixWav, mixSoundtrack(music, voice).mix);
        execFileSync(soundFfmpeg, soundtrackMuxArgs(silent, mixWav, file, measureLoudness(soundFfmpeg, mixWav)));
      } else await mixNarration(soundFfmpeg, silent, lines, file);
      const held = plan.holds.reduce((s, h) => s + h.extra, 0);
      note = `, ${lines.length} spoken lines${spec.music ? " over music" : ""}, picture held ${held.toFixed(1)} s in ${plan.holds.length} places`;
    }
    const secs = n / 30;
    const mb = statSync(file).size / 1e6;
    const times = Array.from({ length: Math.max(1, Math.floor(secs / 4)) }, (_, i) => Math.min(secs - 0.1, 1 + i * 4));
    await extractFrames(file, times, join(FRAMES, `${spec.file.replace(/\.webm$/, "")}-%d.png`));
    console.log(`✓ ${spec.file}  ${secs.toFixed(1)} s, ${mb.toFixed(1)} MB${note}  (made in ${((Date.now() - started) / 1000).toFixed(0)} s)`);
    if (spec.bpm && madeWhileFilming > 0 && !retaken.has(spec.file)) {
      retaken.add(spec.file);
      console.log(`  ${madeWhileFilming} line(s) were made while filming; filming ${spec.file} again with every line ready`);
      queue.unshift(spec);
    }
  } catch (err) {
    console.error(`✗ ${spec.file}: ${err.stack ?? err.message}`);
    failures++;
  }
  eng?.stop();
  await context.close();
}

await browser.close();
killServer();
narrator?.stop();
if (failures > 0) {
  console.error(`\n${failures} video(s) failed — the manual's videos are not up to date.`);
  process.exit(1);
}
console.log(`done — videos in apps/desktop/src/renderer/src/assets/guide/, stills in ${FRAMES}`);
process.exit(0);
