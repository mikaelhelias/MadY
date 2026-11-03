// @vitest-environment jsdom
/**
 * Which chart types carry significance brackets — a design decision, pinned.
 *
 * The chart types listed below offer no Significance section, by design: none of them carries a
 * between-groups bracket. A bracket joins two groups standing side by side on a category
 * axis; these charts have a continuous X (survival, ROC, xy), no groups (volcano, manhattan, QQ), or
 * many ordered, overlapping groups whose claim is a trend (ridgeline). Where a between-groups test
 * does apply, its result belongs on the graph as a p-value label, not a bracket.
 *
 * Because of that decision these charts carry no bracket styling controls either. This test keeps
 * that consistent: offer brackets on one of them and it fails, pointing at the decision to revisit,
 * so brackets never appear on a chart type without the styling controls the others have.
 */
import { describe, expect, it } from "vitest";
import type { Plot } from "@mady/core";
import { BRACKET_KINDS } from "./Inspector";
import { galleryItems } from "./gallery";

/** The chart types that carry no bracket, each with the one-line reason. */
const NO_BRACKETS: Record<string, string> = {
  survival: "X is time; compare the arms with a log-rank p-value label",
  roc: "X is 1 − specificity; compare two markers with a DeLong p-value label",
  xy: "X is continuous; compare fitted curves with an extra-sum-of-squares F label",
  bubble: "X is continuous; compare fitted curves with a label, as on xy",
  area: "stacked layers over a continuous X — nothing side by side to compare",
  pcascore: "a 2-D cloud — groups are compared by PERMANOVA, shown as a label",
  pcabiplot: "a 2-D cloud — as PCA scores",
  pcaload: "the points are variables, not groups",
  triplot: "its permutation test is of the constraints overall, not between groups",
  ridgeline: "many ordered, overlapping groups — the claim is a trend",
  funnel: "studies, not groups — Egger's asymmetry test is a label",
  blandaltman: "two methods' agreement — the bias line and limits are the result",
  volcano: "every point already is a significance test",
  manhattan: "every point already is a p-value; the genome-wide line is the significance",
  qq: "observed vs expected p-value quantiles — no groups",
};

describe("significance brackets stay off the chart types they do not belong on", () => {
  const galleryKinds = new Set<string>((galleryItems() as unknown as { plot: Plot }[]).map((g) => g.plot.kind ?? "xy"));

  it("every listed name is a real chart type (the list cannot rot into typos)", () => {
    const unknown = Object.keys(NO_BRACKETS).filter((k) => !galleryKinds.has(k));
    expect(unknown).toEqual([]);
  });

  it("the gate reaches real bracket charts (it cannot pass by being empty)", () => {
    expect(BRACKET_KINDS.has("bar")).toBe(true);
    expect(BRACKET_KINDS.has("box")).toBe(true);
  });

  for (const [kind, why] of Object.entries(NO_BRACKETS)) {
    it(`${kind}: no brackets — ${why}`, () => {
      expect(
        BRACKET_KINDS.has(kind),
        `${kind} offers significance brackets. By design it should not ` +
          `- revisit that decision first, then update this list, ` +
          `and give the new brackets the styling controls the other chart types have.`,
      ).toBe(false);
    });
  }
});
