/**
 * View-zoom helpers — a per-pane "document zoom" (scale how big the content
 * appears), shared by the data grid and the graph. Bounded + stepped so the
 * keyboard, Ctrl+wheel, and the status-bar control all behave identically.
 */
export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 4;
export const ZOOM_DEFAULT = 1;

/** Clamp a zoom factor to the supported range. */
export function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return ZOOM_DEFAULT;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
}

/** Step a zoom factor by `dir` (+1 in / −1 out) in ~10% multiplicative steps. */
export function zoomStep(z: number, dir: number): number {
  // Round to a clean 5% grid so repeated steps don't drift to long decimals.
  const next = z * (dir > 0 ? 1.1 : 1 / 1.1);
  return clampZoom(Math.round(next * 20) / 20);
}

/**
 * Is there anywhere left to go in this direction?
 *
 * A zoom button that stays pressable at the ceiling looks broken rather than finished: holding
 * `+` leaves the readout at 400% while the button keeps lighting up. A button that cannot do
 * anything says so by being disabled — the same rule the toolbar buttons follow.
 *
 * Note: asks `zoomStep` rather than comparing to `ZOOM_MAX` directly. The step rounds to a 5% grid,
 * so the reachable ceiling is not necessarily the constant — comparing to the constant would
 * leave the button enabled at a value it can never move off.
 */
export function canZoom(z: number, dir: number): boolean {
  return zoomStep(z, dir) !== clampZoom(z);
}

/**
 * Display label, e.g. 1 → "100%", and "400% max" once there is nowhere further to go.
 *
 * The percentage alone cannot distinguish "still going" from "this is as far as it gets", which
 * makes holding `+` feel broken.
 */
export function zoomLabel(z: number): string {
  const pct = `${Math.round(z * 100)}%`;
  if (!canZoom(z, 1)) return `${pct} max`;
  if (!canZoom(z, -1)) return `${pct} min`;
  return pct;
}
