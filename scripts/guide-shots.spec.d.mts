/**
 * Types for `guide-shots.spec.mjs`, so `guide-shots.test.ts` can hold the capture spec and the
 * manual to each other without the spec itself becoming TypeScript.
 *
 * The spec stays plain ESM on purpose: `gen-guide-shots.mjs` is run with bare `node`, with no
 * build step between editing a shot and retaking it.
 */
export interface GuideShotMarkSpec {
  /** A CSS selector, `{ tool }`, `{ section }`, `{ text, within? }` or `{ nth, of }` — see
   *  `resolveTarget` in `guide-shots-driver.mjs`. */
  target: unknown;
  /** What the manual prints beside the number. */
  label: string;
}

export interface GuideShotSpec {
  /** The PNG under `apps/desktop/src/renderer/src/assets/guide/`. */
  file: string;
  /** Viewport before the setup runs; defaults to 1500 × 950. */
  viewport?: [number, number];
  /** Drive the app to the state worth photographing. */
  setup: (app: unknown) => Promise<void>;
  /** "page" · "figure" · a locator factory · `{ clip }`. */
  capture: unknown;
  marks?: GuideShotMarkSpec[];
}

export const SHOTS: GuideShotSpec[];
