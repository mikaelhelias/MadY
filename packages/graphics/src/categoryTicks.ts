import type { AxisScene, AxisTick } from "./scene.js";

/**
 * The category a tick stands for: its full name. That is the drawn label, unless a purely visual
 * decision changed it — de-overlap blanked it on a crowded axis, or a narrow figure shortened it
 * ("Cannabis use disord…") — in which case the full name rides in `suppressedLabel`. Grouping runs
 * off this, so neither decision can drop a category out of its group.
 */
export function tickCategoryName(t: AxisTick): string {
  return t.suppressedLabel || t.label;
}

/**
 * The named category ticks along a banded axis, in drawing order (left→right, top→bottom).
 *
 * One list for both readers: the builder matches `categoryGroups.map` against these names, and the
 * Inspector's By-hand group editor shows one box per name — so a box can never name a category the
 * drawing does not have.
 */
export function categoryTicks(ax: AxisScene): AxisTick[] {
  return ax.ticks.filter((t) => !t.minor && tickCategoryName(t) !== "").slice().sort((a, b) => a.pos - b.pos);
}
