/** Types for `guide-video-timing.mjs` — see that file. */
export function frameSchedule(stamps: number[], start: number, end: number, fps: number): number[];
export function beatMs(bpm: number, i: number): number;
export function msToNextBeat(elapsedMs: number, bpm: number, every?: number): number;
export interface NarrationCue {
  cut: number;
  at: number;
  dur?: number | undefined;
}
export interface NarrationPlan {
  holds: { at: number; extra: number }[];
  starts: (number | null)[];
  length: number;
}
export function planNarration(cues: NarrationCue[], end: number, o?: { breath?: number; lead?: number }): NarrationPlan;
export function withHolds(pick: number[], holds: { at: number; extra: number }[], fps: number): number[];
export function lineWaitMs(now: number, line: { at: number; len: number } | null, breath?: number): number;
