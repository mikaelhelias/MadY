/** Types for `guide-video-director.mjs` — see that file. Only what the tests reach is typed. */
export interface Cue {
  cut: number;
  at: number;
  say: string | undefined;
}
export interface Director {
  cues: Cue[];
  startClock(now?: () => number): void;
  headline(title: string | null, sub?: string, say?: string): Promise<void>;
  beat(every?: number): Promise<void>;
  [key: string]: unknown;
}
export function makeDirector(
  page: unknown,
  opts?: { bpm?: number; glide?: number; lineLength?: (text: string) => Promise<number> },
): Director;
