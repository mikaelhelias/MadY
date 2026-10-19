/**
 * Text width from Arial's own advance widths — for tests that judge whether drawn text collides.
 *
 * Not a flat per-character guess: a flat 0.58 em reads "Other" as 58 px at 20 px type where the browser draws
 * 51 px, and a 7 px error is enough to report a false collision (e.g. on the Pareto card). Checked against the
 * browser's getBBox on six gallery cards.
 */
const EM: Record<string, number> = { " ": 0.278, ".": 0.278, ",": 0.278, "-": 0.333, "−": 0.584, "%": 0.889, "(": 0.333, ")": 0.333, i: 0.222, l: 0.222, j: 0.222, t: 0.278, f: 0.278, r: 0.333, m: 0.833, w: 0.722, M: 0.833, W: 0.944 };
export const arialWidth = (text: string, px: number): number =>
  [...text].reduce((w, ch) => w + (EM[ch] ?? (/[0-9]/.test(ch) ? 0.556 : /[A-Z]/.test(ch) ? 0.69 : 0.53)), 0) * px;
