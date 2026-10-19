/**
 * The spoken narration of the manual's videos.
 *
 * A line is read by an offline speech model, chosen with MADY_VOICE (below; Kokoro by default).
 * Neither model ships with MadY; they are tools for making the videos, like Playwright. Piper, an
 * offline text-to-speech program (MIT licence), with the voice en_GB-cori-high (recorded from
 * public-domain LibriVox readings), is the other choice. Download both into `build/piper/`
 * (ignored by git), or point at them:
 *   MADY_PIPER        piper.exe          default build/piper/piper/piper(.exe)
 *                     (github.com/rhasspy/piper, release 2023.11.14-2)
 *   MADY_PIPER_VOICE  the voice's .onnx  default build/piper/en_GB-cori-high.onnx, with its
 *                     .onnx.json beside it (huggingface.co/rhasspy/piper-voices, en/en_GB/cori/high)
 *
 * The narrator is chosen with MADY_VOICE:
 *   kokoro:<voice>    (the default, kokoro:af_heart) Kokoro, an offline speech model (Apache 2.0),
 *                     run by `kokoro-say.py` from MADY_KOKORO (default build/kokoro/): the model
 *                     kokoro-v1.0.onnx and voices-v1.0.bin (github.com/thewh1teagle/kokoro-onnx,
 *                     release model-files-v1.0), and `pip install --target build/kokoro/py kokoro-onnx`
 *   piper             Piper, as above
 *
 * Playwright's ffmpeg has no sound, so the sound is added by another ffmpeg that can encode Opus:
 *   MADY_AUDIO_FFMPEG  default: the one inside the Python package imageio-ffmpeg, if installed
 */
import { execFileSync, spawn, spawnSync } from "child_process";
import { createHash } from "crypto";
import { existsSync, readFileSync } from "fs";
import { constants, setPriority } from "os";
import { basename, dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXE = process.platform === "win32" ? ".exe" : "";

/** Below-normal priority, so making the videos leaves the computer responsive for other work. */
function lowPriority(pid) {
  try {
    if (pid) setPriority(pid, constants.priority.PRIORITY_BELOW_NORMAL);
  } catch {
    /* the process already ended, or the system refused; it still runs */
  }
}

/** Piper and its voice, or an error saying what to download and where. */
export function findPiper() {
  const exe = process.env.MADY_PIPER ?? join(ROOT, "build", "piper", "piper", `piper${EXE}`);
  const voice = process.env.MADY_PIPER_VOICE ?? join(ROOT, "build", "piper", "en_GB-cori-high.onnx");
  const missing = [exe, voice, `${voice}.json`].filter((p) => !existsSync(p));
  if (missing.length) {
    throw new Error(
      `the narration needs Piper and its voice — missing: ${missing.join(", ")}. ` +
        "See the top of scripts/guide-video-voice.mjs for where to get them, or set MADY_PIPER / MADY_PIPER_VOICE.",
    );
  }
  return { exe, voice };
}

/** An ffmpeg that can encode Opus sound, or an error saying how to get one. */
export function audioFfmpeg() {
  let exe = process.env.MADY_AUDIO_FFMPEG;
  if (!exe) {
    for (const [cmd, args] of [["py", ["-3"]], ["python3", []], ["python", []]]) {
      try {
        exe = execFileSync(cmd, [...args, "-c", "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
        if (exe) break;
      } catch {
        /* not this Python, or no imageio-ffmpeg in it */
      }
    }
  }
  if (!exe || !existsSync(exe)) throw new Error("the narration needs an ffmpeg with Opus sound: set MADY_AUDIO_FFMPEG, or `py -3 -m pip install imageio-ffmpeg`");
  const enc = execFileSync(exe, ["-hide_banner", "-encoders"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  if (!/\blibopus\b/.test(enc)) throw new Error(`${exe} cannot encode Opus sound (no libopus)`);
  return exe;
}

/**
 * A .wav's length in seconds, from its header.
 *
 * @param {Buffer} buf
 */
export function wavSeconds(buf) {
  if (buf.length < 12 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("wavSeconds: not a .wav file");
  }
  let byteRate = 0;
  for (let p = 12; p + 8 <= buf.length; ) {
    const id = buf.toString("ascii", p, p + 4);
    const size = buf.readUInt32LE(p + 4);
    if (id === "fmt ") byteRate = buf.readUInt32LE(p + 16);
    if (id === "data") {
      if (!byteRate) throw new Error("wavSeconds: the .wav has no format block before its data");
      return Math.min(size, buf.length - p - 8) / byteRate;
    }
    p += 8 + size + (size % 2);
  }
  throw new Error("wavSeconds: the .wav has no data block");
}

/**
 * Piper's arguments for one line. `pace` above 1 speaks faster (Piper's length scale is its
 * inverse); 1 is the voice's own pace.
 */
export function piperArgs(piper, outWav, { pace = 1 } = {}) {
  if (!(pace > 0)) throw new Error(`piperArgs: pace must be above 0, not ${pace}`);
  return ["--model", piper.voice, "--output_file", outWav, ...(pace === 1 ? [] : ["--length_scale", String(+(1 / pace).toFixed(4))])];
}

/**
 * Speak `text` into `outWav` with Piper. Resolves with the line's length in seconds.
 */
export function speak(piper, text, outWav, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(piper.exe, piperArgs(piper, outWav, opts), { stdio: ["pipe", "ignore", "pipe"], windowsHide: true });
    lowPriority(p.pid);
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) => {
      if (code !== 0) return reject(new Error(`piper exited ${code} on "${text}": ${err.trim().slice(-400)}`));
      try {
        resolve(wavSeconds(readFileSync(outWav)));
      } catch (e) {
        reject(e);
      }
    });
    p.stdin.end(text, "utf8");
  });
}

/**
 * The ffmpeg arguments that lay the spoken lines over a finished silent video: each line enters
 * at its own start, and the picture is copied as it is (it was encoded once already).
 *
 * @param {string} video  the silent .webm
 * @param {{ wav: string, start: number }[]} lines  `start` in seconds of the video
 * @param {string} out
 */
export function narrationMixArgs(video, lines, out) {
  const inputs = lines.flatMap((l) => ["-i", l.wav]);
  const delayed = lines.map((l, k) => {
    const ms = Math.round(l.start * 1000);
    return `[${k + 1}:a]adelay=${ms}|${ms}[a${k}]`;
  });
  const mix = `${lines.map((_, k) => `[a${k}]`).join("")}amix=inputs=${lines.length}:normalize=0[a]`;
  return [
    "-hide_banner", "-loglevel", "error", "-y",
    "-i", video, ...inputs,
    "-filter_complex", [...delayed, mix].join(";"),
    "-map", "0:v", "-map", "[a]",
    "-c:v", "copy", "-c:a", "libopus", "-b:a", "64k",
    out,
  ];
}

/** Lay `lines` over `video` into `out` (see `narrationMixArgs`). */
export function mixNarration(ffmpeg, video, lines, out) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpeg, narrationMixArgs(video, lines, out), { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    lowPriority(p.pid);
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve(null) : reject(new Error(`ffmpeg (sound) exited ${code}: ${err.trim().slice(-400)}`))));
  });
}

/** Kokoro's language for one of its English voices: the name's first letter says which (a American,
 *  b British), its second the voice's sex. */
export function kokoroLang(voice) {
  const lang = { a: "en-us", b: "en-gb" }[voice[0]];
  if (!lang || !/^[ab][fm]_[a-z]+$/.test(voice)) throw new Error(`"${voice}" is not an English Kokoro voice (af_…, am_…, bf_…, bm_…)`);
  return lang;
}

/** The narrator MADY_VOICE asks for: "piper", or "kokoro:<voice>" (the default is kokoro:af_heart). */
export function narratorChoice(value = process.env.MADY_VOICE) {
  const v = value ?? "kokoro:af_heart";
  if (v === "piper") return { kind: "piper" };
  const m = /^kokoro:(\w+)$/.exec(v);
  if (!m) throw new Error(`MADY_VOICE="${v}": use "piper" or "kokoro:<voice>", e.g. kokoro:af_heart`);
  return { kind: "kokoro", voice: m[1], lang: kokoroLang(m[1]) };
}

/** The name of a spoken line's file: the same words in the same voice give the same name, so a line
 *  is spoken once and reused; a new voice never picks up another voice's recording. */
export function lineKey(narratorId, text) {
  return createHash("sha1").update(`${narratorId}\n${text}`).digest("hex").slice(0, 12);
}

/**
 * The narrator MADY_VOICE names: `{ id, ready, say(text, outWav) → seconds, stop() }`. Kokoro runs
 * as one helper process that loads the model once (`ready` resolves when it has), at below-normal
 * priority.
 */
export function findNarrator() {
  const c = narratorChoice();
  if (c.kind === "piper") {
    const p = findPiper();
    return { id: `piper:${basename(p.voice)}`, ready: Promise.resolve(), say: (text, out) => speak(p, text, out), stop() {} };
  }
  const home = process.env.MADY_KOKORO ?? join(ROOT, "build", "kokoro");
  const missing = ["kokoro-v1.0.onnx", "voices-v1.0.bin", "py"].map((f) => join(home, f)).filter((f) => !existsSync(f));
  if (missing.length) throw new Error(`the narration needs Kokoro — missing: ${missing.join(", ")}. See the top of scripts/guide-video-voice.mjs.`);
  let python = "python3";
  try {
    python = execFileSync("py", ["-3", "-c", "import sys; print(sys.executable)"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    /* no Windows launcher: python3 on the path */
  }
  const proc = spawn(python, [join(ROOT, "scripts", "kokoro-say.py"), home], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  lowPriority(proc.pid);
  let err = "";
  proc.stderr.on("data", (d) => (err = (err + d).slice(-2000)));
  const waiting = [];
  let ready;
  const started = new Promise((res, rej) => {
    ready = res;
    proc.on("exit", (code) => rej(new Error(`kokoro-say.py exited ${code}: ${err.trim().slice(-600)}`)));
  });
  started.catch(() => {});
  let buf = "";
  proc.stdout.on("data", (d) => {
    buf += d;
    for (let i; (i = buf.indexOf("\n")) >= 0; ) {
      const msg = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      if (msg.ready) ready();
      else {
        const w = waiting.shift();
        if (msg.error) w.reject(new Error(`Kokoro could not speak "${w.text}": ${msg.error}`));
        else w.resolve(msg.seconds);
      }
    }
  });
  proc.on("exit", () => {
    for (const w of waiting.splice(0)) w.reject(new Error(`kokoro-say.py stopped before speaking "${w.text}": ${err.trim().slice(-600)}`));
  });
  return {
    // The pronunciations are part of the voice: a change to them makes every line again.
    id: `kokoro:${c.voice}:${createHash("sha1").update(JSON.stringify(PRONOUNCE)).digest("hex").slice(0, 6)}`,
    ready: started,
    async say(text, out) {
      await started;
      return new Promise((resolve, reject) => {
        waiting.push({ text, resolve, reject });
        proc.stdin.write(JSON.stringify({ text, parts: pronounced(text), out, voice: c.voice, lang: c.lang }) + "\n");
      });
    },
    stop() {
      proc.stdin.end();
      proc.kill();
    },
  };
}

/**
 * The ffmpeg arguments that lay a finished soundtrack under a silent video: the picture copied as
 * it is, the sound set to `lufs` in one linear gain from its measured loudness (`m`, as ffmpeg's
 * loudness filter prints it), its true peak under −1.5 dB, encoded as Opus.
 */
export function soundtrackMuxArgs(video, wav, out, m, lufs = -16) {
  const norm =
    `loudnorm=I=${lufs}:TP=-1.5:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}` +
    `:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true,aresample=48000`;
  return ["-hide_banner", "-loglevel", "error", "-y", "-i", video, "-i", wav, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-af", norm, "-c:a", "libopus", "-b:a", "128k", out];
}

/** The loudness block in what ffmpeg's loudness filter prints (it is surrounded by other lines). */
export function parseLoudness(stderr) {
  const block = stderr.match(/\{\s*"input_i"[\s\S]*?\}/);
  if (!block) throw new Error(`ffmpeg printed no loudness: ${stderr.slice(-400)}`);
  return JSON.parse(block[0]);
}

/** A sound file's loudness as ffmpeg's loudness filter measures it, aiming at `lufs`. */
export function measureLoudness(ffmpeg, file, lufs = -16) {
  const r = spawnSync(ffmpeg, ["-hide_banner", "-i", file, "-af", `loudnorm=I=${lufs}:TP=-1.5:LRA=11:print_format=json`, "-f", "null", "-"], { encoding: "utf8", windowsHide: true });
  return parseLoudness(r.stderr);
}

/**
 * Words the speech engine reads as another word spelt the same way, with the sounds they should
 * have (IPA, as the engine writes them; the dictionary's General American form). Kokoro spells a line
 * out in these sounds before speaking it, and it reads "analyses" (the plural of analysis) as the
 * verb "analyses", "use it" with the noun's "s", a spoken instruction "export" with the noun's
 * stress, and "editable" with its t softened to a d. Each entry is a whole word or phrase, matched
 * without regard to capitals.
 */
export const PRONOUNCE = [
  ["analyses", "ənˈæləsiːz"],
  ["editable", "ˈɛdɪtəbəl"],
  ["use it", "jˈuːz ɪt"],
  ["export", "ɛkspˈɔːɹt"],
];

/**
 * A line split into what is spoken as written (`{ text }`) and the words of `PRONOUNCE` (`{ ipa }`),
 * in order; a line with none of them is one `{ text }`.
 */
export function pronounced(line, table = PRONOUNCE) {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\b(${table.map(([w]) => esc(w)).join("|")})\\b`, "gi");
  const parts = [];
  let last = 0;
  for (let m; (m = re.exec(line)); ) {
    if (m.index > last) parts.push({ text: line.slice(last, m.index) });
    parts.push({ ipa: table.find(([w]) => w.toLowerCase() === m[0].toLowerCase())[1] });
    last = m.index + m[0].length;
  }
  if (last < line.length) parts.push({ text: line.slice(last) });
  return parts;
}
