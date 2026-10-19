import type { Plot, RoseStyle } from "@mady/core";

/**
 * A polar histogram's compass letters, renamed or dragged on the graph. Both are keyed by
 * the letter's own default words ("N", "NE" … or "0°", "45°" …), so a rename
 * stays on its direction and never jumps to another label when the convention is switched.
 */

/** The patch for a rename: the new words under the key; blank, or the default words themselves, clears it. */
export function roseDirectionRename(rose: RoseStyle | undefined, key: string, value: string): Partial<Plot> {
  const words = value.trim();
  const next = { ...(rose?.directionText ?? {}) };
  if (words === "" || words === key) delete next[key];
  else next[key] = words;
  return { rose: { ...(rose ?? {}), directionText: Object.keys(next).length ? next : undefined } };
}

/** The patch for a drag: this letter's offset from where the chart places it, the others kept. */
export function roseDirectionMove(rose: RoseStyle | undefined, key: string, dx: number, dy: number): Partial<Plot> {
  return { rose: { ...(rose ?? {}), directionOffsets: { ...(rose?.directionOffsets ?? {}), [key]: { dx, dy } } } };
}
