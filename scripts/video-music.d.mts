/** Types for `video-music.mjs` — see that file. */
export interface Track { L: Float32Array; R: Float32Array }
export interface SoundEvent { t: number; kind: string; big?: boolean; t1?: number }
export interface Plan { beat: number; bars: { t: number; groove: number; chord: string; scene?: number }[]; events: SoundEvent[]; total: number }
export const SR: number;
export const CHORDS: Record<string, { root: number; notes: number[] }>;
export const PROGRESSION: string[];
export function midiHz(m: number): number;
export function track(sec: number): Track;
export function kick(seed?: number): (tau: number) => number;
export function reverb(tr: Track, o?: { room?: number; damp?: number }): Track;
export function pingPong(tr: Track, time: number, fb: number): Track;
export function rms(tr: Track, from?: number, to?: number): number;
export function duckGain(voice: Float32Array, o?: { depth?: number; attack?: number; release?: number; floor?: number }): Float32Array;
export function limit(tr: Track, o?: { ceiling?: number; ahead?: number; release?: number }): Track;
export function wavBytes(tr: Track): Buffer;
export function writeWav(file: string, tr: Track): void;
export function readWavF32(buf: Buffer): Float32Array;
export function renderMusic(plan: Plan): Track & { parts: Record<"drums" | "bass" | "pad" | "arp" | "echo" | "room", Track> };
export function renderSounds(plan: Plan): Track;
export function renderVoice(lines: { start: number; samples: Float32Array }[], total: number): { track: Track; mono: Float32Array };
export function mixSoundtrack(
  plan: Plan,
  voiceLines: { start: number; samples: Float32Array }[],
  o?: { musicDb?: number; hitDb?: number; duckDepth?: number; fadeOut?: number },
): { mix: Track; music: Track; sounds: Track; voice: Track };
export function loudestWindow(tr: Track, from?: number, to?: number, win?: number): number;
export function voiceRms(mono: Float32Array, floor?: number): number;
export function overviewPlan(o: { total: number; bpm: number; intro: number; outro: number; groove?: number }): Plan;
