import { describe, expect, it } from "vitest";
import { planSignificanceBrackets, planSignificanceBracketsWithSkips } from "./significancePlan";

/**
 * The control (reference) mode of the marker planner.
 *
 * "Show every treatment against the control" is a filter over the comparisons a test
 * already produced — never a change of test. That distinction is the whole reason this
 * lives here and not in the engine: the p-values keep whatever correction the analysis
 * applied, and only the analysis can decide what they mean.
 */
describe("planSignificanceBrackets — comparing against a control", () => {
  // Four groups, all pairs, all significant, so nothing is filtered by the ladder and
  // any missing comparison below is the control rule and not a p-value cut-off.
  const terms = [
    { term: "Vehicle vs Drug A", p: 0.001 },
    { term: "Vehicle vs Drug B", p: 0.02 },
    { term: "Vehicle vs Drug C", p: 0.0004 },
    { term: "Drug A vs Drug B", p: 0.03 },
    { term: "Drug A vs Drug C", p: 0.01 },
    { term: "Drug B vs Drug C", p: 0.04 },
  ];
  const categoryIndex = new Map([["Vehicle", 1], ["Drug A", 2], ["Drug B", 3], ["Drug C", 4]]);
  const range = { min: 0, max: 10, span: 10 };
  const plan = (control?: string) =>
    planSignificanceBrackets({ terms, categoryIndex, range, ...(control ? { control } : {}) });

  it("keeps only the comparisons the control takes part in", () => {
    expect(plan().length, "all six pairs without a control").toBe(6);
    const vs = plan("Vehicle");
    expect(vs.length).toBe(3);
    expect(vs.every((b) => b.from === 1), "every marker starts at the control's position").toBe(true);
    expect(vs.map((b) => b.to).sort()).toEqual([2, 3, 4]);
    // Treatment-vs-treatment is gone, which is the point.
    expect(vs.some((b) => b.term === "Drug A vs Drug B")).toBe(false);
  });

  it("works when the control is named second in the engine's term", () => {
    // The engine orders terms its own way; a filter that only looked at the left-hand
    // name would silently drop half the comparisons and look like a stats problem.
    const t = [{ term: "Drug A vs Vehicle", p: 0.001 }, { term: "Drug A vs Drug B", p: 0.02 }];
    const out = planSignificanceBrackets({ terms: t, categoryIndex, range, control: "Vehicle" });
    expect(out.length).toBe(1);
    expect(out[0]!.term).toBe("Drug A vs Vehicle");
    // Provenance reads control-first whichever way the term was written…
    expect(out[0]!.groupA).toBe("Vehicle");
    expect(out[0]!.groupB).toBe("Drug A");
    // …while the geometry still runs low index → high index, because a bracket is drawn
    // left to right and `from`/`to` are positions, not names.
    expect(out[0]!.from).toBeLessThan(out[0]!.to);
  });

  it("a control that matches no group plans nothing, rather than silently ignoring it", () => {
    // Better an empty figure the user can see than every pair drawn as if the reference
    // had been honoured — a typo must not read as "all comparisons were requested".
    expect(planSignificanceBrackets({ terms, categoryIndex, range, control: "Placebo" })).toEqual([]);
  });

  it("an empty or blank control means all pairs (the default), not 'no comparisons'", () => {
    expect(planSignificanceBrackets({ terms, categoryIndex, range, control: "" }).length).toBe(6);
    expect(planSignificanceBrackets({ terms, categoryIndex, range, control: "   " }).length).toBe(6);
  });

  it("still stacks: narrower spans sit lower, so a control fan does not cross itself", () => {
    const vs = plan("Vehicle");
    const bySpan = [...vs].sort((a, b) => a.to - a.from - (b.to - b.from));
    // heights ascend with span, whatever order the engine listed the terms in
    expect(bySpan[0]!.bracketY).toBeLessThan(bySpan[bySpan.length - 1]!.bracketY);
  });
});

/**
 * The skip report: an empty plan has three distinct causes — nothing significant, names
 * that match nothing on this graph, the control filter — and the caller can only tell the
 * user the true one if the planner says which comparisons it dropped and why. Reporting
 * "nothing significant" about a p = 0.0004 comparison the graph cannot place is the
 * silent-no-op class of defect.
 */
describe("planSignificanceBracketsWithSkips — why comparisons were dropped", () => {
  const categoryIndex = new Map([["Day 1", 1], ["Day 2", 2], ["Day 3", 3]]);
  const range = { min: 0, max: 10, span: 10 };
  const cellTerms = [
    { term: "Day 1 · Control vs Day 1 · Treated", p: 0.0004 },
    { term: "Day 2 · Control vs Day 2 · Treated", p: 0.03 },
    { term: "Day 3 · Control vs Day 3 · Treated", p: 0.7 },
  ];

  it("cell terms without a cellIndex count as unmatched, split by significance", () => {
    // Highly significant cell comparisons whose names ("Day 1 · Control") resolve to
    // nothing — no category, no cellIndex — must not be reported as "nothing significant".
    const { plans, skips } = planSignificanceBracketsWithSkips({ terms: cellTerms, categoryIndex, range });
    expect(plans).toEqual([]);
    // p = 0.7 is dropped at the α gate before names are ever resolved.
    expect(skips.notSignificant).toBe(1);
    expect(skips.unmatchedName).toBe(2);
    expect(skips.unmatchedSignificant, "the two with p < α — what makes 'nothing significant' false").toBe(2);
    expect(skips.unmatchedExample).toBe("Day 1 · Control vs Day 1 · Treated");
    expect(skips.controlFiltered).toBe(0);
  });

  it("the same terms with a cellIndex place as within-group plans — nothing skipped as unmatched", () => {
    const cellIndex = new Map<string, { cat: number; series: number }>([
      ["Day 1 · Control", { cat: 1, series: 1 }], ["Day 1 · Treated", { cat: 1, series: 2 }],
      ["Day 2 · Control", { cat: 2, series: 1 }], ["Day 2 · Treated", { cat: 2, series: 2 }],
      ["Day 3 · Control", { cat: 3, series: 1 }], ["Day 3 · Treated", { cat: 3, series: 2 }],
    ]);
    const { plans, skips } = planSignificanceBracketsWithSkips({ terms: cellTerms, categoryIndex, cellIndex, range });
    expect(plans.length).toBe(2);
    expect(skips).toEqual({ unmatchedName: 0, unmatchedSignificant: 0, notSignificant: 1, controlFiltered: 0 });
  });

  it("matched-but-weak and control-filtered comparisons land in their own buckets", () => {
    const { plans, skips } = planSignificanceBracketsWithSkips({
      terms: [
        { term: "Day 1 vs Day 2", p: 0.9 }, // not significant
        { term: "Day 2 vs Day 3", p: 0.001 }, // matched, significant, but not vs the control
        { term: "Day 1 vs Day 3", p: 0.002 }, // survives
      ],
      categoryIndex, range, control: "Day 1",
    });
    expect(plans.length).toBe(1);
    expect(plans[0]!.term).toBe("Day 1 vs Day 3");
    expect(skips).toEqual({ unmatchedName: 0, unmatchedSignificant: 0, notSignificant: 1, controlFiltered: 1 });
  });

  it("a term with no usable p is invisible to the report — it was never a comparison to place", () => {
    const { plans, skips } = planSignificanceBracketsWithSkips({
      terms: [{ term: "Interaction", p: null }, { term: "Day 1 · A vs Day 1 · B", p: Number.NaN }],
      categoryIndex, range,
    });
    expect(plans).toEqual([]);
    expect(skips).toEqual({ unmatchedName: 0, unmatchedSignificant: 0, notSignificant: 0, controlFiltered: 0 });
  });

  it("the plain planner is the same planner — identical plans, no skips exposed", () => {
    const terms = [{ term: "Day 1 vs Day 2", p: 0.01 }];
    expect(planSignificanceBrackets({ terms, categoryIndex, range })).toEqual(
      planSignificanceBracketsWithSkips({ terms, categoryIndex, range }).plans,
    );
  });
});

/**
 * Within-group (cell) comparisons. A two-way cell-means run emits
 * "row · dataset" names ("Day 1 · Control vs Day 1 · Treated"); on a grouped bar those
 * are two bars inside one category. Such terms must be placed, not silently skipped —
 * skipping them would tell the user "no significant comparisons" about comparisons that
 * are highly significant.
 */
describe("planSignificanceBrackets — within-group (cell) comparisons", () => {
  const categoryIndex = new Map([["Day 1", 1], ["Day 2", 2], ["Day 3", 3]]);
  const cellIndex = new Map<string, { cat: number; series: number }>([
    ["Day 1 · Control", { cat: 1, series: 1 }], ["Day 1 · Treated", { cat: 1, series: 2 }],
    ["Day 2 · Control", { cat: 2, series: 1 }], ["Day 2 · Treated", { cat: 2, series: 2 }],
    ["Day 3 · Control", { cat: 3, series: 1 }], ["Day 3 · Treated", { cat: 3, series: 2 }],
  ]);
  const range = { min: 0, max: 55, span: 55 };
  const cellTerms = [
    { term: "Day 1 · Control vs Day 1 · Treated", p: 0.01 },
    { term: "Day 2 · Control vs Day 2 · Treated", p: 0.004 },
    { term: "Day 3 · Control vs Day 3 · Treated", p: 0.0002 },
    { term: "Day 1 · Control vs Day 3 · Treated", p: 0.03 }, // a cross-category cell pair
  ];

  it("a cell term becomes a within-group plan instead of being silently skipped", () => {
    const out = planSignificanceBrackets({ terms: cellTerms, categoryIndex, cellIndex, range });
    expect(out.length, "all four cell comparisons place").toBe(4);
    const w1 = out.find((b) => b.term === "Day 1 · Control vs Day 1 · Treated")!;
    expect([w1.from, w1.to]).toEqual([1, 1]);
    expect([w1.fromSeries, w1.toSeries]).toEqual([1, 2]);
  });

  it("the three within-group pairs share one height — disjoint brackets do not staircase", () => {
    const out = planSignificanceBrackets({ terms: cellTerms.slice(0, 3), categoryIndex, cellIndex, range });
    expect(new Set(out.map((b) => b.bracketY)).size, "one shared rung for three pairs that never touch").toBe(1);
  });

  it("the control can name the series: 'Control' keeps every pair against it, drops the rest", () => {
    const withTvT = [...cellTerms, { term: "Day 1 · Treated vs Day 2 · Treated", p: 0.02 }];
    const out = planSignificanceBrackets({ terms: withTvT, categoryIndex, cellIndex, range, control: "Control" });
    expect(out.length, "the Treated-vs-Treated pair is filtered out").toBe(4);
    expect(out.every((b) => b.groupA.includes("Control")), "provenance reads control-first").toBe(true);
  });

  it("whole-category terms still resolve first, cellIndex present or not", () => {
    const out = planSignificanceBrackets({ terms: [{ term: "Day 1 vs Day 2", p: 0.01 }], categoryIndex, cellIndex, range });
    expect(out.length).toBe(1);
    expect(out[0]!.fromSeries).toBeUndefined();
  });
});
