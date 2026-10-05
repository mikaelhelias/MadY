/** Types for `guide-video-voice.mjs` — see that file. */
export interface Piper {
  exe: string;
  voice: string;
}
export function findPiper(): Piper;
export function audioFfmpeg(): string;
export function wavSeconds(buf: Buffer): number;
export function piperArgs(piper: Piper, outWav: string, o?: { pace?: number }): string[];
export function speak(piper: Piper, text: string, outWav: string, o?: { pace?: number }): Promise<number>;
export function narrationMixArgs(video: string, lines: { wav: string; start: number }[], out: string): string[];
export function mixNarration(ffmpeg: string, video: string, lines: { wav: string; start: number }[], out: string): Promise<null>;
export function kokoroLang(voice: string): string;
export function narratorChoice(value?: string): { kind: "piper" } | { kind: "kokoro"; voice: string; lang: string };
export function lineKey(narratorId: string, text: string): string;
export interface Narrator {
  id: string;
  ready: Promise<unknown>;
  say(text: string, outWav: string): Promise<number>;
  stop(): void;
}
export function findNarrator(): Narrator;
export interface Loudness { input_i: string; input_tp: string; input_lra: string; input_thresh: string; target_offset: string }
export function soundtrackMuxArgs(video: string, wav: string, out: string, m: Loudness, lufs?: number): string[];
export function parseLoudness(stderr: string): Loudness;
export function measureLoudness(ffmpeg: string, file: string, lufs?: number): Loudness;
export const PRONOUNCE: [string, string][];
export function pronounced(line: string, table?: [string, string][]): ({ text: string } | { ipa: string })[];
