/**
 * Music and sounds for videos (`scripts/video-music.mjs`). Nobody can check a soundtrack by reading
 * it, and a mistake does not crash anything: a riser that ends before the drop, music drowning the
 * voice, a mix that clips. Each rule is pinned by numbers here.
 */
import { describe, expect, it } from "vitest";
import { wavSeconds } from "../../../../../../scripts/guide-video-voice.mjs";
import {
  PROGRESSION,
  SR,
  duckGain,
  kick,
  limit,
  loudestWindow,
  mixSoundtrack,
  overviewPlan,
  pingPong,
  readWavF32,
  renderMusic,
  rms,
  track,
  voiceRms,
  wavBytes,
} from "../../../../../../scripts/video-music.mjs";

describe("overviewPlan: the music under a beat-cut overview video", () => {
  // 120 BPM: a bar is 2 s. A 38 s video, a 2 s title, a 6 s close.
  const plan = overviewPlan({ total: 38, bpm: 120, intro: 2, outro: 6 });

  it("quiet under the title, the full groove from the first cut, quiet again for the close", () => {
    expect(plan.beat).toBe(0.5);
    expect(plan.bars).toHaveLength(19);
    expect(plan.bars[0]!.groove).toBe(0);
    expect(plan.bars.slice(1, 16).every((b) => b.groove === 3)).toBe(true);
    expect(plan.bars.slice(16).every((b) => b.groove === 0)).toBe(true);
  });

  it("a riser ends on the first cut, a hit lands on it and another on the close", () => {
    expect(plan.events.filter((e) => e.kind === "riser").map((e) => [e.t, e.t1])).toEqual([[0, 2]]);
    expect(plan.events.filter((e) => e.kind === "impact").map((e) => e.t)).toEqual([2, 32]);
  });

  it("the close resolves: its chords end on C, the rest follow the progression", () => {
    expect(plan.bars.slice(16).map((b) => b.chord)).toEqual(["F", "G", "C"]);
    expect(plan.bars.slice(0, 16).map((b) => b.chord)).toEqual(plan.bars.slice(0, 16).map((_, i) => PROGRESSION[i % 4]));
  });

  it("the drums fall on the beat the plan gives: at 100 BPM, every 0.6 s", () => {
    const slow = overviewPlan({ total: 4.8, bpm: 100, intro: 0, outro: 0, groove: 1 });
    const m = renderMusic(slow);
    const onset = (t: number) => rms(m.parts.drums, Math.round(t * SR), Math.round((t + 0.02) * SR));
    expect(onset(0.6)).toBeGreaterThan(0.3); // a kick on the beat at 0.6 s …
    expect(onset(0.5)).toBeLessThan(0.01); // … and none at 0.5 s, where a 120 BPM beat would put one
  });

  it("refuses a plan with no beat, rather than placing every drum at time zero", () => {
    expect(() => renderMusic({ total: 2, bars: [], events: [] } as never)).toThrow(/beat/);
  });
});

describe("the instruments and effects", () => {
  it("a kick hits at once and has died away by half a second", () => {
    const k = kick(3);
    const s = Array.from({ length: Math.round(0.6 * SR) }, (_, i) => k(i / SR));
    const peakAt = s.reduce((best, v, i) => (Math.abs(v) > Math.abs(s[best]!) ? i : best), 0);
    expect(peakAt / SR).toBeLessThan(0.02);
    expect(Math.max(...s.slice(Math.round(0.45 * SR)).map(Math.abs))).toBeLessThan(0.05);
  });

  it("the echo bounces left, right, left, each bounce quieter", () => {
    const tr = track(1);
    tr.L[0] = 1;
    tr.R[0] = 1;
    const d = Math.round(0.1 * SR);
    const e = pingPong(tr, 0.1, 0.5);
    expect(e.L[d]).toBeCloseTo(1, 6);
    expect(e.R[d]).toBe(0);
    expect(e.R[2 * d]).toBeCloseTo(0.5, 6);
    expect(e.L[3 * d]).toBeCloseTo(0.25, 6);
  });

  it("the music dips under the voice smoothly and comes back after it", () => {
    const voice = new Float32Array(3 * SR);
    for (let i = SR / 2; i < SR * 1.5; i++) voice[i] = 0.3 * Math.sin(i * 0.05);
    const g = duckGain(voice, { depth: 0.6, attack: 0.04, release: 0.4 });
    expect(g[Math.round(0.4 * SR)]).toBe(1); // before the line
    expect(g[Math.round(1.2 * SR)]).toBeCloseTo(0.4, 2); // during it
    expect(g[3 * SR - 1]).toBeGreaterThan(0.95); // well after it
    let jump = 0;
    for (let i = 1; i < g.length; i++) jump = Math.max(jump, Math.abs(g[i]! - g[i - 1]!));
    expect(jump).toBeLessThan(0.001);
  });

  it("loudestWindow finds the loudest stretch, however short the rest of the track is quiet", () => {
    const tr = track(2);
    for (let i = SR; i < SR + 0.05 * SR; i++) tr.L[i] = tr.R[i] = i % 2 ? 0.8 : -0.8;
    expect(loudestWindow(tr)).toBeCloseTo(0.8, 6);
    expect(rms(tr)).toBeLessThan(0.15); // the average would have called it quiet
  });

  it("the voice's loudness counts only while it speaks", () => {
    const v = new Float32Array(1000);
    for (let i = 0; i < 100; i++) v[i] = i % 2 ? 0.5 : -0.5;
    expect(voiceRms(v)).toBeCloseTo(0.5, 6);
  });

  it("the limiter keeps every sample under the ceiling and leaves a quiet stretch untouched", () => {
    const tr = track(1);
    for (let i = 0; i < tr.L.length; i++) {
      const loud = i > SR / 2 && i < SR / 2 + 200;
      tr.L[i] = (loud ? 2 : 0.3) * Math.sin(i * 0.01);
      tr.R[i] = tr.L[i]!;
    }
    const quiet = tr.L.slice(0, SR / 4);
    limit(tr, { ceiling: 0.89 });
    let peak = 0;
    for (let i = 0; i < tr.L.length; i++) peak = Math.max(peak, Math.abs(tr.L[i]!), Math.abs(tr.R[i]!));
    expect(peak).toBeLessThanOrEqual(0.89 + 1e-6);
    expect(Array.from(tr.L.slice(0, SR / 4))).toEqual(Array.from(quiet));
  });

  it("the limiter eases its gain down ahead of a peak rather than stepping it", () => {
    const n = SR / 2;
    const tr = { L: new Float32Array(n).fill(0.5), R: new Float32Array(n).fill(0.5) };
    for (let i = SR / 4; i < SR / 4 + 50; i++) tr.L[i] = tr.R[i] = 2; // a sudden peak four times the ceiling
    const before = Float32Array.from(tr.L);
    limit(tr, { ceiling: 0.89, ahead: 0.004 });
    let step = 0;
    for (let i = 1; i < n; i++) step = Math.max(step, Math.abs(tr.L[i]! / before[i]! - tr.L[i - 1]! / before[i - 1]!));
    expect(step).toBeLessThan(0.01); // a step would be 0.55 in one sample
  });

  it("a written .wav reads back: its length, and its samples", () => {
    const tr = track(0.5);
    tr.L[100] = 0.25;
    tr.R[100] = -0.5;
    const b = wavBytes(tr);
    expect(wavSeconds(b)).toBeCloseTo(0.5, 6);
    const back = readWavF32(b);
    expect(back[100]).toBe(0.25);
  });
});

describe("mixSoundtrack", () => {
  const plan = { beat: 0.5, total: 4, bars: [{ t: 0, groove: 2, chord: "Am" }, { t: 2, groove: 2, chord: "F" }], events: [{ t: 0, kind: "impact", big: false }] };
  const samples = new Float32Array(SR);
  for (let i = 0; i < SR; i++) samples[i] = 0.2 * Math.sin((2 * Math.PI * 220 * i) / SR);
  const out = mixSoundtrack(plan, [{ start: 1, samples }], { musicDb: -11, hitDb: 1, fadeOut: 1 });

  it("sets the music a fixed distance under the voice, whatever level the parts were made at", () => {
    const spoken = voiceRms(samples);
    expect(20 * Math.log10(rms(out.music) / spoken)).toBeCloseTo(-11, 1);
  });

  it("sets the sounds by their loudest hit, not their average (they are mostly silence)", () => {
    const spoken = voiceRms(samples);
    expect(20 * Math.log10(loudestWindow(out.sounds) / spoken)).toBeCloseTo(1, 1);
  });

  it("stays under the ceiling and fades to silence at the end", () => {
    let peak = 0;
    for (let i = 0; i < out.mix.L.length; i++) peak = Math.max(peak, Math.abs(out.mix.L[i]!), Math.abs(out.mix.R[i]!));
    expect(peak).toBeLessThanOrEqual(0.89 + 1e-6);
    expect(out.mix.L.length).toBe(4 * SR);
    expect(Math.abs(out.mix.L[out.mix.L.length - 1]!)).toBeLessThan(1e-3);
  });
});
