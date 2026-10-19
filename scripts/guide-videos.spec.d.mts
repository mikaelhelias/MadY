/**
 * Types for `guide-videos.spec.mjs`, so `guide-videos.test.ts` can hold the video list and the
 * manual to each other without the spec itself becoming TypeScript (it is run with bare `node`).
 */
export interface GuideVideoSpec {
  /** The .webm under `apps/desktop/src/renderer/src/assets/guide/`. */
  file: string;
  /** The real statistics engine answers analyses in this video. */
  engine?: boolean;
  /** A tempo: cuts land on its beat. */
  bpm?: number;
  /** The encoder's bit-rate cap, e.g. "3M". */
  maxRate?: string;
  init?: () => void;
  setup?: (app: unknown, director: unknown) => Promise<void>;
  run: (app: unknown, director: unknown) => Promise<void>;
}

export const VIDEO_SIZE: { width: number; height: number };
export const VIDEOS: GuideVideoSpec[];
