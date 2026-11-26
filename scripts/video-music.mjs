/**
 * Music and sounds for videos, made from nothing but arithmetic: no samples, no recordings, no
 * software beyond Node — so there is no one else's music in them and nothing to license. Used by a
 * video with a tempo and `music` (`gen-guide-videos.mjs`).
 *
 * A PLAN says what plays: `{ beat, total, bars, events }` — the length of a beat in seconds, the
 * video's length, one entry a bar (`{ t, groove, chord }`) and the one-off sounds (`{ t, kind }`:
 * impact, riser (to `t1`), whoosh, fill, crash, click, key). Three parts are made from it, each a
 * 48 kHz stereo track, then mixed:
 *   music   drums, bass, chords and an arpeggio; each bar's `groove` says how busy: 0 no drums (a
 *           soft arpeggio, chords); 1 kick and bass; 2 hats and clap too; 3 the full arpeggio too;
 *           4 the busiest, with sixteenth hats and an open hat
 *   sounds  the one-off sounds
 *   voice   the spoken lines, each at its own start; the music dips under them (`duckGain`)
 *
 * The finished mix is limited to a ceiling (`limit`); its loudness is set afterwards with ffmpeg.
 */
import { writeFileSync } from "fs";

export const SR = 48000;

// ── what plays when ─────────────────────────────────────────────────────────────

/** The chords, one a bar, as MIDI notes (a low root for the bass, three for the chord). */
export const CHORDS = {
  Am: { root: 33, notes: [57, 60, 64] },
  F: { root: 29, notes: [57, 60, 65] },
  C: { root: 36, notes: [55, 60, 64] },
  G: { root: 31, notes: [55, 59, 62] },
};
/** The progression every scene plays unless it names its own (`chords`). */
export const PROGRESSION = ["Am", "F", "C", "G"];

export const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

// ── building blocks ─────────────────────────────────────────────────────────────

/** A stereo track `sec` long. */
export const track = (sec) => ({ L: new Float32Array(Math.ceil(sec * SR)), R: new Float32Array(Math.ceil(sec * SR)) });

/** Noise from a seed: the same seed gives the same noise, so the soundtrack is the same every run. */
function noise(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2147483648 - 1;
  };
}

/** A sawtooth with its step smoothed (polyBLEP), so high notes do not alias into a whine. */
function saw(ph, dt) {
  let v = 2 * ph - 1;
  if (ph < dt) {
    const x = ph / dt;
    v -= x + x - x * x - 1;
  } else if (ph > 1 - dt) {
    const x = (ph - 1) / dt;
    v -= x * x + x + x + 1;
  }
  return v;
}

/** A two-pole filter (the standard biquad), its frequency changeable while it runs. */
function biquad(type, f, q = 0.707) {
  let b0, b1, b2, a1, a2;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  const set = (freq, Q = q) => {
    const w = (2 * Math.PI * Math.min(freq, SR * 0.45)) / SR;
    const c = Math.cos(w), al = Math.sin(w) / (2 * Q);
    const a0 = 1 + al;
    if (type === "lp") [b0, b1, b2] = [(1 - c) / 2, 1 - c, (1 - c) / 2];
    else if (type === "hp") [b0, b1, b2] = [(1 + c) / 2, -(1 + c), (1 + c) / 2];
    else [b0, b1, b2] = [al, 0, -al]; // band pass
    [b0, b1, b2, a1, a2] = [b0 / a0, b1 / a0, b2 / a0, (-2 * c) / a0, (1 - al) / a0];
  };
  set(f);
  const run = (x) => {
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    return y;
  };
  run.set = set;
  return run;
}

/** Add `fn(τ)` (a mono sample at τ seconds into the sound) into a track from second `t`, for `len`
 *  seconds, at `gain`, panned −1 (left) … 1 (right) — or `fn` returns [left, right]. The last 3 ms
 *  fade out, so a sound cut at `len` while still ringing never ends in a click. */
function add(tr, t, len, gain, pan, fn) {
  const i0 = Math.max(0, Math.round(t * SR));
  const iEnd = Math.round((t + len) * SR);
  const i1 = Math.min(tr.L.length, iEnd);
  const tail = 0.003 * SR;
  const gl = gain * Math.sqrt((1 - pan) / 2) * Math.SQRT2;
  const gr = gain * Math.sqrt((1 + pan) / 2) * Math.SQRT2;
  for (let i = i0; i < i1; i++) {
    const f = Math.min(1, (iEnd - i) / tail);
    const v0 = fn((i - t * SR) / SR);
    const v = typeof v0 === "number" ? v0 * f : [v0[0] * f, v0[1] * f];
    if (typeof v === "number") {
      tr.L[i] += v * gl;
      tr.R[i] += v * gr;
    } else {
      tr.L[i] += v[0] * gain;
      tr.R[i] += v[1] * gain;
    }
  }
}

// ── the instruments: each returns a function of τ, seconds into the note ──

/** A kick drum: a sine falling from ~160 Hz to 42 Hz, with a short click on top. */
export function kick(seed = 1) {
  const n = noise(seed);
  let ph = 0;
  return (tau) => {
    const f = 42 + 120 * Math.exp(-tau * 28);
    ph += (2 * Math.PI * f) / SR;
    const body = Math.sin(ph) * Math.exp(-tau * 8.5) * Math.min(1, tau * 1500);
    return Math.tanh(1.6 * (body + n() * 0.35 * Math.exp(-tau * 350)));
  };
}
function clap(seed) {
  const n = noise(seed);
  const bp = biquad("bp", 1150, 0.9);
  return (tau) => {
    let e = 0.55 * Math.exp(-tau * 16);
    for (const k of [0, 0.011, 0.022]) if (tau >= k) e = Math.max(e, Math.exp(-(tau - k) * 260));
    return bp(n()) * e * 2.2;
  };
}
function hat(seed, open) {
  const n = noise(seed);
  const hp = biquad("hp", 7600, 0.8);
  return (tau) => hp(n()) * Math.exp(-tau * (open ? 9 : 75));
}
function crash(seed) {
  const n = noise(seed);
  const hp = biquad("hp", 4200, 0.7);
  const f = [587, 845, 1127, 1480, 1971, 2489];
  return (tau) => {
    let m = 0;
    for (const fr of f) m += Math.sign(Math.sin(2 * Math.PI * fr * tau));
    return hp(n() * 0.8 + m * 0.06) * Math.exp(-tau * 1.7);
  };
}
function snare(seed) {
  const n = noise(seed);
  const bp = biquad("bp", 1900, 0.8);
  return (tau) => (bp(n()) * 1.6 + Math.sin(2 * Math.PI * 190 * tau) * 0.5) * Math.exp(-tau * 24);
}
function bassNote(midi) {
  const f = midiHz(midi);
  const lp = biquad("lp", 400, 1.1);
  let ph = 0, sub = 0;
  return (tau) => {
    ph = (ph + f / SR) % 1;
    sub = (sub + f / 2 / SR) % 1;
    lp.set(180 + 1400 * Math.exp(-tau * 16), 1.1);
    const env = Math.min(1, tau * 300) * Math.max(0, 1 - tau / 0.24);
    return (lp(saw(ph, f / SR)) * 0.8 + Math.sin(2 * Math.PI * sub) * 0.6) * env;
  };
}
/** A chord held for `len` seconds: five slightly detuned sawtooths a note, spread left to right. */
function padChord(notes, len, cutoff) {
  const detune = [-14, -7, 0, 7, 12];
  const oscs = notes.flatMap((m, j) => detune.map((c, k) => ({ f: midiHz(m) * Math.pow(2, c / 1200), ph: ((j * 5 + k) * 0.137) % 1, pan: (k - 2) / 2.2 })));
  const lpL = biquad("lp", cutoff, 0.6), lpR = biquad("lp", cutoff, 0.6);
  return (tau) => {
    let l = 0, r = 0;
    for (const o of oscs) {
      o.ph = (o.ph + o.f / SR) % 1;
      const v = saw(o.ph, o.f / SR);
      l += v * (1 - o.pan) * 0.5;
      r += v * (1 + o.pan) * 0.5;
    }
    const env = Math.min(1, tau / 0.25) * Math.min(1, Math.max(0, (len - tau) / 0.5));
    const k = env / oscs.length;
    return [lpL(l) * k, lpR(r) * k];
  };
}
function pluck(midi, bright) {
  const f = midiHz(midi);
  const lp = biquad("lp", 3000, 0.9);
  let a = 0, b = 0.5;
  return (tau) => {
    a = (a + (f * 1.0035) / SR) % 1;
    b = (b + (f * 0.9965) / SR) % 1;
    lp.set(450 + bright * Math.exp(-tau * 20), 0.9);
    return lp(saw(a, f / SR) + saw(b, f / SR) + (b < 0.5 ? 0.3 : -0.3)) * Math.exp(-tau * 9) * Math.min(1, tau * 800);
  };
}

// ── effects ──

/** A room: eight feedback combs and four all-passes a side (the classic "Freeverb" layout). */
export function reverb(tr, { room = 0.84, damp = 0.3 } = {}) {
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map((n) => Math.round((n * SR) / 44100));
  const alls = [556, 441, 341, 225].map((n) => Math.round((n * SR) / 44100));
  const side = (x, spread) => {
    const out = new Float32Array(x.length);
    const cs = combs.map((n) => ({ buf: new Float32Array(n + spread), i: 0, lp: 0 }));
    const as = alls.map((n) => ({ buf: new Float32Array(n + spread), i: 0 }));
    for (let i = 0; i < x.length; i++) {
      const inp = x[i] * 0.015;
      let s = 0;
      for (const c of cs) {
        const y = c.buf[c.i];
        c.lp = y * (1 - damp) + c.lp * damp;
        c.buf[c.i] = inp + c.lp * room;
        c.i = (c.i + 1) % c.buf.length;
        s += y;
      }
      for (const a of as) {
        const y = a.buf[a.i];
        a.buf[a.i] = s + y * 0.5;
        a.i = (a.i + 1) % a.buf.length;
        s = y - s;
      }
      out[i] = s;
    }
    return out;
  };
  return { L: side(tr.L, 0), R: side(tr.R, 23) };
}

/** An echo that bounces left, right, left — `time` seconds apart, each `fb` as loud as the one before. */
export function pingPong(tr, time, fb) {
  const d = Math.round(time * SR);
  const n = tr.L.length;
  const L = new Float32Array(n), R = new Float32Array(n);
  for (let i = d; i < n; i++) {
    L[i] = (tr.L[i - d] + tr.R[i - d]) * 0.5 + R[i - d] * fb;
    R[i] = L[i - d] * fb;
  }
  return { L, R };
}

/** How loud a track is, as the root mean square of both sides. */
export function rms(tr, from = 0, to = tr.L.length) {
  let s = 0;
  for (let i = from; i < to; i++) s += tr.L[i] * tr.L[i] + tr.R[i] * tr.R[i];
  return Math.sqrt(s / Math.max(1, 2 * (to - from)));
}

/**
 * How far the music dips under the voice, sample by sample: 1 where no one speaks, down to
 * `1 − depth` while a line is spoken — falling in `attack` seconds as a line begins and rising
 * back over `release` seconds after it ends, so the music never jumps.
 *
 * @param {Float32Array} voice  the voice, mono
 */
export function duckGain(voice, { depth = 0.6, attack = 0.04, release = 0.4, floor = 0.02 } = {}) {
  const out = new Float32Array(voice.length);
  const hold = Math.round(0.15 * SR);
  const ka = 1 - Math.exp(-1 / (attack * SR));
  const kr = 1 - Math.exp(-1 / (release * SR));
  let env = 0, since = hold;
  for (let i = 0; i < voice.length; i++) {
    since = Math.abs(voice[i]) > floor ? 0 : since + 1;
    const want = since < hold ? 1 : 0;
    env += (want - env) * (want > env ? ka : kr);
    out[i] = 1 - depth * env;
  }
  return out;
}

/**
 * Keep the mix under `ceiling`. For each sample, the gain its own peak needs; then the lowest of
 * those over the next `ahead` seconds, averaged over the `ahead` seconds before — so the gain eases
 * down across the look-ahead and is at or under what the peak needs when the peak arrives (a gain
 * that stepped down would itself be heard as a crackle). It recovers over `release` seconds.
 * Quiet stretches pass through untouched.
 */
export function limit(tr, { ceiling = 0.89, ahead = 0.004, release = 0.12 } = {}) {
  const n = tr.L.length;
  const la = Math.max(1, Math.round(ahead * SR));
  const need = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = Math.max(Math.abs(tr.L[i]), Math.abs(tr.R[i]));
    need[i] = p > ceiling ? ceiling / p : 1;
  }
  // the lowest need in [i, i + la] (a sliding minimum)
  const low = new Float32Array(n);
  const q = [];
  for (let i = n - 1; i >= 0; i--) {
    while (q.length && need[q[q.length - 1]] >= need[i]) q.pop();
    q.push(i);
    while (q[0] > i + la) q.shift();
    low[i] = need[q[0]];
  }
  // averaged over [i − la, i] (before the start, the gain is 1)
  const kr = 1 - Math.exp(-1 / (release * SR));
  let sum = la + 1, g = 1;
  for (let i = 0; i < n; i++) {
    sum += low[i] - (i > la ? low[i - la - 1] : 1);
    const want = Math.min(1, sum / (la + 1));
    g = want < g ? want : g + (want - g) * kr;
    tr.L[i] *= g;
    tr.R[i] *= g;
  }
  return tr;
}

/** A 32-bit float stereo .wav. */
export function wavBytes(tr) {
  const n = tr.L.length;
  const b = Buffer.alloc(44 + n * 8);
  b.write("RIFF", 0, "ascii");
  b.writeUInt32LE(36 + n * 8, 4);
  b.write("WAVE", 8, "ascii");
  b.write("fmt ", 12, "ascii");
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(3, 20); // IEEE float
  b.writeUInt16LE(2, 22);
  b.writeUInt32LE(SR, 24);
  b.writeUInt32LE(SR * 8, 28);
  b.writeUInt16LE(8, 32);
  b.writeUInt16LE(32, 34);
  b.write("data", 36, "ascii");
  b.writeUInt32LE(n * 8, 40);
  for (let i = 0; i < n; i++) {
    b.writeFloatLE(tr.L[i], 44 + i * 8);
    b.writeFloatLE(tr.R[i], 48 + i * 8);
  }
  return b;
}
export const writeWav = (file, tr) => writeFileSync(file, wavBytes(tr));

/** The mono samples of a 32-bit float .wav (as ffmpeg writes with `-c:a pcm_f32le`), first channel. */
export function readWavF32(buf) {
  let p = 12, ch = 1, fmt = 0;
  while (p + 8 <= buf.length) {
    const id = buf.toString("ascii", p, p + 4);
    const size = buf.readUInt32LE(p + 4);
    if (id === "fmt ") {
      fmt = buf.readUInt16LE(p + 8);
      ch = buf.readUInt16LE(p + 10);
      const rate = buf.readUInt32LE(p + 12);
      if (rate !== SR) throw new Error(`readWavF32: ${rate} Hz, expected ${SR}`);
    }
    if (id === "data") {
      if (fmt !== 3) throw new Error("readWavF32: not 32-bit float samples");
      const n = Math.floor(Math.min(size, buf.length - p - 8) / (4 * ch));
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) out[i] = buf.readFloatLE(p + 8 + i * 4 * ch);
      return out;
    }
    p += 8 + size + (size % 2);
  }
  throw new Error("readWavF32: no data block");
}

// ── the tracks ──────────────────────────────────────────────────────────────────

/** The music, from the plan's bars. */
export function renderMusic(plan) {
  const BEAT = beatOf(plan);
  const BAR = 4 * BEAT;
  const len = plan.total + 3;
  const drums = track(len), bass = track(len), pad = track(len), arp = track(len);
  const kickTimes = [];
  let seed = 7;
  const lastBar = plan.bars.length - 1;
  plan.bars.forEach((bar, b) => {
    const { t, groove: g } = bar;
    const ch = CHORDS[bar.chord];
    const finalBar = b === lastBar;
    // chords: every bar; the filter opens as the music gets busier
    add(pad, t, finalBar ? 3 : BAR + 0.5, 2.1, 0, padChord([...ch.notes, ch.notes[0] - 12], finalBar ? 3 : BAR + 0.5, g === 0 ? 900 + 250 * (b % 4) : 1500 + 250 * g));
    for (let q = 0; q < 4; q++) {
      const tb = t + q * BEAT;
      if (g >= 1) {
        add(drums, tb, 0.5, 0.62, 0, kick(seed++));
        kickTimes.push(tb);
        add(bass, tb + BEAT / 2, 0.25, 0.63, 0, bassNote(ch.root + 12));
      }
      if (g >= 2) {
        add(drums, tb + BEAT / 2, 0.08, 0.2, 0.25, hat(seed++, false));
        if (q % 2 === 1) add(drums, tb, 0.35, 0.3, -0.05, clap(seed++));
      }
      if (g >= 4) {
        add(drums, tb + BEAT / 4, 0.05, 0.08, -0.3, hat(seed++, false));
        add(drums, tb + (3 * BEAT) / 4, 0.05, 0.08, 0.3, hat(seed++, false));
        if (q === 3) add(drums, tb + BEAT / 2, 0.45, 0.12, 0.2, hat(seed++, true));
      }
    }
    // the arpeggio: sixteenths through the chord over two octaves (eighths, darker, with no drums)
    const tones = [...ch.notes, ...ch.notes.map((m) => m + 12)];
    const order = [0, 1, 2, 3, 4, 5, 4, 3];
    const step = g >= 3 ? BEAT / 4 : BEAT / 2;
    if (g >= 3 || g === 0) {
      for (let k = 0; k * step < BAR - 1e-9; k++) {
        const m = tones[order[k % order.length]] + 12;
        add(arp, t + k * step, 0.6, g >= 3 ? 0.29 : 0.34, k % 2 ? 0.35 : -0.35, pluck(m, g >= 3 ? 5200 : 1400));
      }
    }
  });
  // the kick pushes the chords and the bass down for a moment: the music breathes with the beat
  let ki = 0;
  for (let i = 0; i < pad.L.length; i++) {
    const t = i / SR;
    while (ki + 1 < kickTimes.length && kickTimes[ki + 1] <= t) ki++;
    const since = kickTimes.length && kickTimes[ki] <= t ? t - kickTimes[ki] : 9;
    const g = 1 - 0.6 * Math.exp(-since * 9);
    pad.L[i] *= g; pad.R[i] *= g;
    bass.L[i] *= 0.4 + 0.6 * (1 - Math.exp(-since * 30));
    bass.R[i] = bass.L[i];
  }
  const echo = pingPong(arp, (3 * BEAT) / 4, 0.38);
  const wet = track(len);
  for (let i = 0; i < wet.L.length; i++) {
    wet.L[i] = pad.L[i] * 0.4 + arp.L[i] * 0.35 + echo.L[i] * 0.3 + drums.L[i] * 0.08;
    wet.R[i] = pad.R[i] * 0.4 + arp.R[i] * 0.35 + echo.R[i] * 0.3 + drums.R[i] * 0.08;
  }
  const room = reverb(wet);
  const out = track(len);
  for (let i = 0; i < out.L.length; i++) {
    out.L[i] = drums.L[i] + bass.L[i] + pad.L[i] + arp.L[i] + echo.L[i] * 0.45 + room.L[i] * 0.9;
    out.R[i] = drums.R[i] + bass.R[i] + pad.R[i] + arp.R[i] + echo.R[i] * 0.45 + room.R[i] * 0.9;
  }
  out.parts = { drums, bass, pad, arp, echo, room };
  return out;
}

/** The one-off sounds: hits, risers, whooshes, fills, crashes, clicks, key ticks. */
export function renderSounds(plan) {
  const BEAT = beatOf(plan);
  const len = plan.total + 3;
  const dry = track(len), send = track(len);
  let seed = 101;
  for (const e of plan.events) {
    const n = noise(seed++);
    if (e.kind === "impact") {
      const big = e.big;
      let ph = 0;
      const lp = biquad("lp", 1600, 0.7);
      const boom = (tau) => {
        ph += (2 * Math.PI * (28 + (big ? 50 : 70) * Math.exp(-tau * 3.5))) / SR;
        return Math.tanh(1.4 * Math.sin(ph) * Math.exp(-tau * (big ? 2.2 : 5)) * Math.min(1, tau * 600)) + lp(n()) * Math.exp(-tau * (big ? 5 : 12)) * 0.6;
      };
      add(dry, e.t, big ? 2.5 : 1.2, big ? 0.9 : 0.55, 0, boom);
      add(send, e.t, big ? 2.5 : 1.2, big ? 0.5 : 0.25, 0, boom);
      if (big) add(dry, e.t, 2.5, 0.22, 0, crash(seed++));
    } else if (e.kind === "riser") {
      const d = e.t1 - e.t;
      const bpL = biquad("bp", 300, 2.5), bpR = biquad("bp", 300, 2.5);
      const n2 = noise(seed++);
      let ph = 0;
      add(dry, e.t, d, 0.5, 0, (tau) => {
        const k = tau / d;
        const f = 250 * Math.pow(36, k);
        bpL.set(f, 2.5); bpR.set(f * 1.03, 2.5);
        ph += (2 * Math.PI * (160 + 900 * k * k)) / SR;
        const a = k * k * Math.min(1, (d - tau) / 0.004);
        const tone = Math.sin(ph) * 0.12 * a;
        return [bpL(n()) * a * 1.4 + tone, bpR(n2()) * a * 1.4 + tone];
      });
    } else if (e.kind === "whoosh") {
      const d = 0.8, lead = 0.5;
      const bp = biquad("bp", 500, 1.2);
      add(dry, e.t - lead, d, 0.55, 0, (tau) => {
        const k = tau / d;
        bp.set(450 + 3200 * Math.sin(Math.PI * Math.min(1, k * 1.15)), 1.2);
        const v = bp(n()) * Math.pow(Math.sin(Math.PI * k), 2) * 1.8;
        const pan = 0.85 - 1.7 * k; // right to left, as the next scene slides in
        return [v * Math.sqrt((1 - pan) / 2), v * Math.sqrt((1 + pan) / 2)];
      });
    } else if (e.kind === "fill") {
      for (let k = 0; k < 4; k++) add(dry, e.t + (k * BEAT) / 4, 0.2, 0.14 + 0.1 * k, (k % 2 ? 0.2 : -0.2), snare(seed++));
    } else if (e.kind === "crash") {
      add(dry, e.t, 2.4, 0.16, 0.15, crash(seed++));
      add(send, e.t, 2.4, 0.1, 0.15, crash(seed++));
    } else if (e.kind === "click") {
      const hp = biquad("hp", 3000, 0.7);
      add(dry, e.t, 0.04, 0.3, 0.1, (tau) => Math.sin(2 * Math.PI * 1750 * tau) * Math.exp(-tau * 260) * 0.7 + hp(n()) * Math.exp(-tau * 900) * 0.6);
    } else if (e.kind === "key") {
      const f = 2300 + ((seed * 7919) % 900);
      add(dry, e.t, 0.02, 0.08, 0.05, (tau) => Math.sin(2 * Math.PI * f * tau) * Math.exp(-tau * 420) + n() * Math.exp(-tau * 1500) * 0.4);
    }
  }
  const room = reverb(send, { room: 0.88, damp: 0.25 });
  for (let i = 0; i < dry.L.length; i++) {
    dry.L[i] += room.L[i] * 1.2;
    dry.R[i] += room.R[i] * 1.2;
  }
  return dry;
}

/** The voice track: each line (mono samples at 48 kHz) at its start, centred, with a little room. */
export function renderVoice(lines, total) {
  const v = track(total + 3);
  for (const l of lines) {
    const i0 = Math.round(l.start * SR);
    for (let i = 0; i < l.samples.length && i0 + i < v.L.length; i++) {
      v.L[i0 + i] += l.samples[i];
      v.R[i0 + i] += l.samples[i];
    }
  }
  const room = reverb(v, { room: 0.7, damp: 0.5 });
  const mono = new Float32Array(v.L.length);
  for (let i = 0; i < v.L.length; i++) {
    mono[i] = v.L[i];
    v.L[i] += room.L[i] * 0.12;
    v.R[i] += room.R[i] * 0.12;
  }
  return { track: v, mono };
}

/**
 * The whole soundtrack, levels relative to the voice's own loudness while it speaks: the music at
 * `musicDb` (its average), the sounds with their loudest hit at `hitDb`; the music dipped under the
 * voice, all of it faded out over the last seconds, and limited. Returns the mix and its three
 * parts (for a remix).
 */
export function mixSoundtrack(plan, voiceLines, { musicDb = -7, hitDb = 1, duckDepth = 0.72, fadeOut = 1.6 } = {}) {
  const n = Math.round(plan.total * SR);
  const music = renderMusic(plan);
  const sounds = renderSounds(plan);
  const { track: voice, mono } = renderVoice(voiceLines, plan.total);
  const spoken = voiceRms(mono);
  // measured over the video only: the tracks run on past it (the last notes ring out), and that
  // silence would make a part read quieter than it plays
  const loudest = (tr) => rms(tr, 0, n) || 1;
  const gm = (spoken * Math.pow(10, musicDb / 20)) / loudest(music);
  // the sounds are mostly silence between hits: set by their loudest moment, not their average
  const gs = (spoken * Math.pow(10, hitDb / 20)) / (loudestWindow(sounds, 0, n) || 1);
  const duck = duckGain(mono, { depth: duckDepth });
  const mix = track(plan.total);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const fade = Math.min(1, Math.max(0, (plan.total - t) / fadeOut));
    const d = duck[i];
    mix.L[i] = (music.L[i] * gm * d + sounds.L[i] * gs * (0.55 + 0.45 * d) + voice.L[i]) * fade;
    mix.R[i] = (music.R[i] * gm * d + sounds.R[i] * gs * (0.55 + 0.45 * d) + voice.R[i]) * fade;
  }
  const scale = (tr, g) => ({ L: tr.L.subarray(0, n).map((x) => x * g), R: tr.R.subarray(0, n).map((x) => x * g) });
  return { mix: limit(mix), music: scale(music, gm), sounds: scale(sounds, gs), voice: scale(voice, 1) };
}

/** The loudness of a track's loudest `win` seconds, between samples `from` and `to`. */
export function loudestWindow(tr, from = 0, to = tr.L.length, win = 0.05) {
  const w = Math.max(1, Math.round(win * SR));
  let best = 0;
  for (let i = from; i + w <= to; i += w) best = Math.max(best, rms(tr, i, i + w));
  return best;
}

/** The voice's loudness while it speaks (silence between lines left out). */
export function voiceRms(mono, floor = 0.01) {
  let s = 0, k = 0;
  for (let i = 0; i < mono.length; i++) {
    if (Math.abs(mono[i]) > floor) {
      s += mono[i] * mono[i];
      k++;
    }
  }
  return k ? Math.sqrt(s / k) : 0;
}

/** A plan's beat, in seconds: it must say, since every drum and note is placed on it. */
function beatOf(plan) {
  if (!(plan.beat > 0)) throw new Error("a music plan needs its beat, in seconds (plan.beat)");
  return plan.beat;
}

/**
 * The plan for a video cut to a steady beat that opens on a title and closes on the program's
 * loading screen: quiet chords under the opening `intro` seconds, a riser into the first cut and a
 * hit on it, the full groove to the closing `outro` seconds, then a hit and a resolving chord that
 * rings out. Everything lands on the beat because the video's cuts do.
 *
 * @param {{ total: number, bpm: number, intro: number, outro: number, groove?: number }} o
 */
export function overviewPlan({ total, bpm, intro, outro, groove = 3 }) {
  const beat = 60 / bpm;
  const bar = 4 * beat;
  const n = Math.ceil(total / bar - 1e-9);
  const drop = Math.round(intro / bar) * bar;
  const end = Math.max(drop + bar, Math.round((total - outro) / bar) * bar);
  const ending = ["F", "G", "C", "C"];
  const bars = [];
  for (let b = 0; b < n; b++) {
    const t = b * bar;
    const closing = t >= end - 1e-9;
    const k = Math.round((t - end) / bar);
    bars.push({ t, groove: t >= drop - 1e-9 && !closing ? groove : 0, chord: closing ? ending[Math.min(k, ending.length - 1)] : PROGRESSION[b % PROGRESSION.length] });
  }
  const events = [];
  if (drop > 0) events.push({ t: Math.max(0, drop - bar), t1: drop, kind: "riser" });
  events.push({ t: drop, kind: "impact", big: true });
  if (end < total) events.push({ t: end, kind: "impact", big: true });
  return { beat, total, bars, events };
}
