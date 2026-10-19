/**
 * The vertical step from each line of the fit-parameter block to the next, in em.
 *
 * A line is one em-and-a-fifth from the one above. A subscript hangs below its line and a superscript rises above its
 * own, so at the plain step a line with a subscript over a line with a superscript ("EC₅₀" over "R²", "V_max" over "R²")
 * would run into it. A line that carries a subscript leaves a little more room below it, and a line that carries a
 * superscript a little more above it; a line with neither keeps the plain step.
 * The renderer draws the lines at these steps and the builder places the block by their sum, so the two agree.
 */
export const FIT_LINE_EM = 1.2;
/** The room added between a subscript and the line below it, and between a superscript and the line above it, in em. */
export const SCRIPT_CLEARANCE_EM = 0.15;

const hasSub = (line: string): boolean => line.includes("_{");
// "R²" is written with the superscript character, which rises like the markup does.
const hasSup = (line: string): boolean => line.includes("^{") || /[²³¹]/.test(line);

/** `steps[k]` is the distance from line k-1 to line k (`steps[0]` is 0). */
export function fitBlockSteps(lines: readonly string[]): number[] {
  return lines.map((line, k) => (k === 0 ? 0 : FIT_LINE_EM + (hasSub(lines[k - 1]!) ? SCRIPT_CLEARANCE_EM : 0) + (hasSup(line) ? SCRIPT_CLEARANCE_EM : 0)));
}

/** The distance from the first line to line `k`, in em. */
export function fitBlockOffsetEm(steps: readonly number[], k: number): number {
  let sum = 0;
  for (let i = 1; i <= k; i++) sum += steps[i] ?? FIT_LINE_EM;
  return sum;
}

/**
 * How far the first line of a block of `lines` sits above its last, in px, as the builder stacks it upward from a bottom
 * edge: the steps' sum plus 0.05 em per line on top of the 1.2 em it is drawn at.
 */
export function fitBlockHeight(lines: readonly string[], size: number): number {
  const steps = fitBlockSteps(lines);
  return (fitBlockOffsetEm(steps, Math.max(0, lines.length - 1)) + 0.05 * Math.max(0, lines.length - 1)) * size;
}