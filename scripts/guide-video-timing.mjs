/**
 * The arithmetic behind the manual's videos, kept apart from the recorder so it can be tested
 * without a browser (`apps/desktop/src/renderer/src/shell/guide-videos.test.tsx`).
 *
 * Three jobs:
 *  • turning the frames Chromium actually sent into a steady 30 frames a second,
 *  • the beat a video with a tempo cuts on, and
 *  • fitting the narration: where each spoken line starts, and where the picture waits for one.
 */

/**
 * Which captured frame to show at each output frame.
 *
 * Chromium's screencast sends a frame only when the page repaints — none while nothing moves,
 * a burst while something animates. A video needs one frame every 1/fps s, so each output slot
 * shows the last frame that had arrived by then (what was on screen at that moment).
 *
 * Never the NEXT frame: that would show a click's result before the pointer got there.
 *
 * @param {number[]} stamps  capture times in seconds, ascending (the screencast's own clock)
 * @param {number} start     the recording's start, same clock
 * @param {number} end       the recording's end, same clock
 * @param {number} fps
 * @returns {number[]} one index into `stamps` per output frame
 */
export function frameSchedule(stamps, start, end, fps) {
  if (stamps.length === 0) throw new Error("frameSchedule: no frames were captured");
  if (!(end > start)) throw new Error(`frameSchedule: the recording has no length (${start} → ${end})`);
  const n = Math.max(1, Math.round((end - start) * fps));
  const out = new Array(n);
  let j = 0;
  for (let k = 0; k < n; k++) {
    const t = start + k / fps;
    while (j + 1 < stamps.length && stamps[j + 1] <= t) j++;
    // Before the first frame arrived there is nothing newer to show; the first frame stands in.
    out[k] = j;
  }
  return out;
}

/**
 * The time of beat `i` at `bpm` beats a minute, in milliseconds from the start.
 *
 * @param {number} bpm
 * @param {number} i
 */
export const beatMs = (bpm, i) => (i * 60000) / bpm;

/**
 * How long to wait so the next cut lands exactly on a beat.
 *
 * A video with a tempo is cut to a steady beat: every cut and caption lands on one. Work
 * between cuts takes as long as it takes (a graph can take 300 ms to draw), so after it the
 * director waits for the next beat rather than a fixed pause — which is what
 * keeps the cuts on time instead of drifting later with every slow step.
 *
 * @param {number} elapsedMs  time since the video started
 * @param {number} bpm
 * @param {number} every      cut on every `every`-th beat (2 = every other beat)
 * @returns {number} milliseconds until that beat (0 when exactly on one)
 */
export function msToNextBeat(elapsedMs, bpm, every = 1) {
  const step = beatMs(bpm, every);
  const next = Math.ceil(elapsedMs / step - 1e-9) * step;
  return Math.max(0, next - elapsedMs);
}

/**
 * How long a beat-cut video must still wait, `now` seconds into the recording, for a line spoken
 * from `at` for `len` seconds to end with a breath after it; 0 once it has (or with no line). A
 * video with a tempo waits this long before its next beat, so the program keeps moving while a line
 * is said instead of its picture being frozen afterwards.
 *
 * @param {number} now
 * @param {{ at: number, len: number } | null} line
 */
export function lineWaitMs(now, line, breath = 0.35) {
  if (!line) return 0;
  return Math.max(0, (line.at + line.len + breath - now) * 1000);
}

/**
 * Where each spoken line starts, and where the picture waits for a line that is longer than its
 * step.
 *
 * A step runs from its cue to the next cue (a caption or title card changing, including one
 * cleared); the last runs to the end of the video. A line must be finished, plus a short breath,
 * before its step ends. When it cannot be, the frame on screen just before the next cue is held
 * for the shortfall — just BEFORE, because the caption starts fading out at the cue and a hold
 * there would freeze it half-faded. Every later moment moves back by the same amount.
 *
 * @param {{ cut: number, at: number, dur?: number }[]} cues  in the silent video's seconds, in
 *   order: `cut` when the step's change was made, `at` when its line should start (the caption is
 *   fully in), `dur` the line's length — absent for a silent change
 * @param {number} end  the silent video's length, s
 * @param {{ breath?: number, lead?: number }} [o]  `breath` the pause after a line; `lead` how
 *   long before the next cue a hold is placed
 * @returns {{ holds: { at: number, extra: number }[], starts: (number | null)[], length: number }}
 *   `holds` in the silent video's seconds; `starts` each line's start in the FINISHED video
 *   (null for a silent cue); `length` the finished video's length
 */
export function planNarration(cues, end, { breath = 0.35, lead = 0.1 } = {}) {
  for (let i = 1; i < cues.length; i++) {
    if (cues[i].cut < cues[i - 1].cut) throw new Error(`planNarration: cue ${i} (${cues[i].cut} s) is out of order`);
  }
  const holds = [];
  cues.forEach((c, i) => {
    if (c.dur == null) return;
    const next = i + 1 < cues.length ? cues[i + 1].cut : end;
    const short = c.dur + breath - (next - c.at);
    if (short > 1e-9) holds.push({ at: Math.max(c.at, next - lead), extra: short });
  });
  const shiftAt = (t) => holds.reduce((s, h) => (h.at < t ? s + h.extra : s), 0);
  return {
    holds,
    starts: cues.map((c) => (c.dur == null ? null : c.at + shiftAt(c.at))),
    length: end + holds.reduce((s, h) => s + h.extra, 0),
  };
}

/**
 * A frame schedule (see `frameSchedule`) with the picture held still: at each hold, the frame on
 * screen at that moment is repeated for the hold's length.
 *
 * @param {number[]} pick  one captured-frame index per output frame
 * @param {{ at: number, extra: number }[]} holds  seconds into `pick`
 * @param {number} fps
 */
export function withHolds(pick, holds, fps) {
  const extra = new Map();
  for (const h of holds) {
    const k = Math.min(pick.length - 1, Math.max(0, Math.floor(h.at * fps + 1e-9)));
    extra.set(k, (extra.get(k) ?? 0) + Math.round(h.extra * fps));
  }
  const out = [];
  pick.forEach((f, k) => {
    out.push(f);
    for (let n = extra.get(k) ?? 0; n > 0; n--) out.push(f);
  });
  return out;
}
