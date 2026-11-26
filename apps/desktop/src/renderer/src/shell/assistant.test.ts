// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { Analysis, DataTable, Plot, Project } from "@mady/core";
import { inferGraphIntent, profileTable, suggestCurveModelsForTable, suggestNextSteps, suggestVariantsForTable, validateSuggestionSpec } from "./assistant";
import { galleryItems } from "./gallery";

const proj = (over: Partial<Project>): Project =>
  ({ tables: [], plots: [], analyses: [], ...over }) as unknown as Project;
const T = (id: string, name: string, status = "ok"): DataTable => ({ id, name, status }) as unknown as DataTable;
const P = (id: string, source: string, status = "ok"): Plot => ({ id, name: id, source, status }) as unknown as Plot;
const A = (id: string, source: string, status = "ok"): Analysis => ({ id, name: id, source, status }) as unknown as Analysis;

/**
 * A tidy sheet keeps its groups in rows. Without row-group support the suggester would see
 * one dataset and could only offer descriptive stats. It should propose the comparison
 * the categories clearly invite, and the proposed spec must validate.
 */
describe("suggestNextSteps — groups in rows", () => {
  const tidy = (levels: string[]): DataTable =>
    ({
      id: "t1",
      kind: "column",
      name: "Treatment means",
      columns: [
        { id: "g", name: "Group" },
        { id: "m", name: "Mean" },
        { id: "r2", name: "Rep 2", role: "y", group: "m" },
      ],
      rows: levels.map((lv, i) => ({ id: `r${i}`, cells: { g: lv, m: 10 + i * 5, r2: 12 + i * 5 } })),
    }) as unknown as DataTable;

  it("proposes ANOVA across the row categories when there are 3+", () => {
    const table = tidy(["Control", "Drug A", "Drug B", "Drug C"]);
    const p = proj({ tables: [table], plots: [P("p1", "t1")] });
    const s = suggestNextSteps(p, { activeTableId: "t1", activePlotId: "p1" });
    const anova = s.find((x) => x.method === "anova");
    expect(anova, "expected an ANOVA suggestion over the row categories").toBeTruthy();
    expect(anova!.columns).toHaveLength(4);
    expect(validateSuggestionSpec(table, anova!).ok).toBe(true);
  });

  it("proposes a two-group test when there are exactly 2 categories", () => {
    const table = tidy(["Control", "Treated"]);
    const p = proj({ tables: [table], plots: [P("p1", "t1")] });
    const s = suggestNextSteps(p, { activeTableId: "t1", activePlotId: "p1" });
    const tt = s.find((x) => x.method === "ttest");
    expect(tt, "expected a t-test suggestion over the two row categories").toBeTruthy();
    expect(validateSuggestionSpec(table, tt!).ok).toBe(true);
  });

  it("accepts a row-group spec as valid columns", () => {
    const table = tidy(["Control", "Drug A"]);
    const ok = validateSuggestionSpec(table, {
      id: "x",
      text: "",
      cta: "",
      actionId: "analyze",
      kind: "analysis",
      method: "ttest",
      variant: "welch",
      columns: ["rowgrp:g:Control", "rowgrp:g:Drug A"],
    });
    expect(ok.ok).toBe(true);
    // …but a category that does not exist is still rejected.
    expect(
      validateSuggestionSpec(table, {
        id: "x",
        text: "",
        cta: "",
        actionId: "analyze",
        kind: "analysis",
        method: "ttest",
        variant: "welch",
        columns: ["rowgrp:g:Control", "rowgrp:g:Ghost"],
      }).ok,
    ).toBe(false);
  });
});

describe("suggestNextSteps", () => {
  it("suggests starting when there is no data", () => {
    const s = suggestNextSteps(proj({}), {});
    expect(s.map((x) => x.id)).toEqual(["start"]);
    expect(s[0]!.actionId).toBe("new-graph-create");
  });

  it("nudges to graph + analyze a dataset that has neither", () => {
    const p = proj({ tables: [T("t1", "Dose data")] });
    const s = suggestNextSteps(p, { activeTableId: "t1" });
    expect(s.find((x) => x.id === "graph:t1")!.actionId).toBe("new-graph");
    expect(s.find((x) => x.id === "graph:t1")!.text).toContain("Dose data");
    expect(s.find((x) => x.id === "analyze:t1")!.actionId).toBe("analyze");
  });

  it("stops nudging once the dataset has a graph and an analysis", () => {
    const p = proj({ tables: [T("t1", "Dose")], plots: [P("p1", "t1")], analyses: [A("a1", "t1")] });
    const ids = suggestNextSteps(p, { activeTableId: "t1" }).map((x) => x.id);
    expect(ids).not.toContain("graph:t1");
    expect(ids).not.toContain("analyze:t1");
  });

  it("flags out-of-date results and points at the lineage view", () => {
    const p = proj({ tables: [T("t1", "Dose")], plots: [P("p1", "t1", "stale")], analyses: [A("a1", "t1", "stale")] });
    const stale = suggestNextSteps(p, { activeTableId: "t1" }).find((x) => x.id === "stale")!;
    expect(stale.text).toContain("2 results are out of date");
    expect(stale.actionId).toBe("view-lineage");
  });

  it("offers a consistent look when ≥2 graphs and one is active", () => {
    const p = proj({ tables: [T("t1", "Dose")], plots: [P("p1", "t1"), P("p2", "t1")], analyses: [A("a1", "t1")] });
    const look = suggestNextSteps(p, { activePlotId: "p1" }).find((x) => x.id === "look")!;
    expect(look.actionId).toBe("apply-look");
  });

  it("focuses the active graph's dataset and does not suggest steps for other datasets", () => {
    // t2 has no graph, but the active graph is of t1 → focus = t1 → no graph nudge for t1 or t2.
    const p = proj({ tables: [T("t1", "Dose"), T("t2", "Genes")], plots: [P("p1", "t1")], analyses: [A("a1", "t1")] });
    const ids = suggestNextSteps(p, { activePlotId: "p1" }).map((x) => x.id);
    expect(ids).not.toContain("graph:t1");
    expect(ids).not.toContain("graph:t2");
  });

  /** A sheet rich enough to generate suggestions when focused (groups in rows → ANOVA). */
  const treatmentMeans = (): DataTable =>
    ({
      id: "t1",
      kind: "column",
      name: "Treatment means",
      columns: [
        { id: "g", name: "Group" },
        { id: "m", name: "Mean" },
        { id: "r2", name: "Rep 2", role: "y", group: "m" },
      ],
      rows: ["Control", "Drug A", "Drug B", "Drug C"].map((lv, i) => ({ id: `r${i}`, cells: { g: lv, m: 10 + i * 5, r2: 12 + i * 5 } })),
    }) as unknown as DataTable;

  it("says nothing data-specific when no graph or datasheet is being viewed", () => {
    // Welcome / gallery tabs pass no focus. Guards against the engine falling back to
    // tables[0] — e.g. the demo project's XY sheet — and repeating that one sheet's
    // suggestions whatever the user is actually looking at.
    const table = treatmentMeans();
    // The fixture must be able to show the failure: with a focus it does produce suggestions.
    const withFocus = suggestNextSteps(proj({ tables: [table] }), { activeTableId: "t1" });
    expect(withFocus.some((x) => x.kind === "analysis"), "the fixture generates no suggestions even when focused — it cannot guard anything").toBe(true);
    const noFocus = suggestNextSteps(proj({ tables: [table] }), {});
    expect(noFocus.filter((x) => x.kind === "analysis"), "analysis suggested for data the user is not viewing").toEqual([]);
    expect(noFocus.find((x) => x.id.startsWith("graph:")), "nudged to graph data the user is not viewing").toBeUndefined();
    expect(noFocus.find((x) => x.id.startsWith("analyze:"))).toBeUndefined();
  });

  it("an open analysis result counts as viewing its source data", () => {
    // Analysis tabs suggest for their source data. The
    // analysis's `source` is the sheet under discussion, so its tab focuses that sheet.
    const table = treatmentMeans();
    const p = proj({ tables: [table], analyses: [A("a1", "t1")] });
    const s = suggestNextSteps(p, { activeAnalysisId: "a1" });
    expect(
      s.some((x) => x.kind === "analysis" && x.id.includes(":t1:")),
      "no suggestion targets the open analysis's source table",
    ).toBe(true);
    // A dangling analysis id focuses nothing (deleted analysis, stale tab).
    expect(suggestNextSteps(p, { activeAnalysisId: "missing" }).filter((x) => x.kind === "analysis")).toEqual([]);
  });
});

const rows = (data: Array<Record<string, number | string | null>>) => data.map((cells, i) => ({ id: `r${i}`, cells }));

const columnTable = (ids: string[]): DataTable => ({
  id: "tc",
  name: "Groups",
  kind: "column",
  columns: [{ id: "label", name: "Label" }, ...ids.map((id) => ({ id, name: id.toUpperCase() }))],
  rows: rows([
    { label: "1", a: 1, b: 2, c: 5 },
    { label: "2", a: 2, b: 3, c: 6 },
    { label: "3", a: 3, b: 4, c: 7 },
  ]),
});

// Adequately-powered, symmetric, outlier-free groups (n=6) → no distribution red flags, so the
// parametric test stays the primary recommendation. Use this for the "clean data → Welch/ANOVA"
// guarantees (the shared columnTable above is only n=3, which legitimately trips the small-n gate).
const cleanColumnTable = (ids: string[]): DataTable => ({
  id: "tc",
  name: "Groups",
  kind: "column",
  columns: [{ id: "label", name: "Label" }, ...ids.map((id) => ({ id, name: id.toUpperCase() }))],
  rows: rows([
    { label: "1", a: 10, b: 12, c: 20 },
    { label: "2", a: 11, b: 13, c: 21 },
    { label: "3", a: 12, b: 14, c: 22 },
    { label: "4", a: 13, b: 15, c: 23 },
    { label: "5", a: 14, b: 16, c: 24 },
    { label: "6", a: 15, b: 17, c: 25 },
  ]),
});

// n=6 groups each carrying a clear high outlier → anyOutliers fires (shape red flag) without
// tripping small-n, so this isolates the skew/outlier → rank-based-test path.
const skewColumnTable = (ids: string[]): DataTable => ({
  id: "tc",
  name: "Groups",
  kind: "column",
  columns: [{ id: "label", name: "Label" }, ...ids.map((id) => ({ id, name: id.toUpperCase() }))],
  rows: rows([
    { label: "1", a: 2, b: 3, c: 6 },
    { label: "2", a: 3, b: 4, c: 7 },
    { label: "3", a: 3, b: 4, c: 7 },
    { label: "4", a: 4, b: 5, c: 8 },
    { label: "5", a: 4, b: 5, c: 8 },
    { label: "6", a: 40, b: 45, c: 60 },
  ]),
});

const xyTable = (x: number[]): DataTable => ({
  id: "tx",
  name: "Dose",
  kind: "xy",
  columns: [{ id: "x", name: "Dose" }, { id: "y", name: "Response" }],
  rows: rows(x.map((v, i) => ({ x: v, y: i + 1 }))),
});


const curveVariants = [
  { id: "4pl", group: "Dose-response" },
  { id: "3pl", group: "Dose-response" },
  { id: "5pl", group: "Dose-response" },
  { id: "ic50_4pl_log", group: "Dose-response" },
  { id: "dr_norm_4pl", group: "Dose-response" },
  { id: "biphasic_dr", group: "Dose-response" },
  { id: "bell_dr", group: "Dose-response" },
  { id: "hormesis_bc", group: "Dose-response" },
  { id: "linear", group: "Polynomial" },
  { id: "lowess", group: "Model-free" },
  { id: "spline", group: "Model-free" },
  { id: "custom", group: "User-defined" },
];

describe("suggestCurveModelsForTable", () => {
  it("ranks 4PL first for a positive log-spaced monotonic dose curve", () => {
    // Six distinct doses: five are enough to recommend a 4PL (medium confidence);
    // six make the recommendation high-confidence.
    const recs = suggestCurveModelsForTable(xyTable([0.1, 1, 10, 100, 1000, 10000]), { yId: "y", availableVariants: curveVariants });
    expect(recs[0]).toMatchObject({ variant: "4pl", suitability: "recommended", confidence: "high" });
    expect(recs.find((r) => r.variant === "ic50_4pl_log")).toBeUndefined();
  });

  it("keeps complex models out of sparse dose data and exposes exploratory alternatives", () => {
    const recs = suggestCurveModelsForTable(xyTable([0.1, 1, 10, 100]), { yId: "y", availableVariants: curveVariants });
    expect(recs.find((r) => r.variant === "5pl")).toBeUndefined();
    expect(recs.find((r) => r.variant === "lowess")?.suitability).toBe("alternative");
  });

  it("offers non-monotonic families cautiously when the response changes direction", () => {
    const table = xyTable([0.1, 1, 10, 100, 1000, 10000]);
    table.rows = rows([{ x: 0.1, y: 1 }, { x: 1, y: 4 }, { x: 10, y: 2 }, { x: 100, y: 5 }, { x: 1000, y: 3 }, { x: 10000, y: 6 }]);
    const recs = suggestCurveModelsForTable(table, { yId: "y", availableVariants: curveVariants });
    expect(recs.find((r) => ["biphasic_dr", "bell_dr", "hormesis_bc"].includes(r.variant))?.suitability).toBe("caution");
    expect(recs.every((r) => r.suitability !== "recommended" || r.variant === "4pl")).toBe(true);
  });

  it("only promotes inhibition/normalized models after an explicit potency goal", () => {
    const recs = suggestCurveModelsForTable(xyTable([0.1, 1, 10, 100, 1000]), { yId: "y", goal: "potency", availableVariants: curveVariants });
    expect(recs.find((r) => r.variant === "ic50_4pl_log")?.suitability).toBe("alternative");
    expect(recs.find((r) => r.variant === "dr_norm_4pl")?.suitability).toBe("caution");
  });

  // The enzyme entry point filters the Recommended section to the "Enzyme kinetics" family, so
  // the recommender must emit enzyme models or that section is empty.
  describe("enzyme kinetics", () => {
    const enzymeVariants = [
      ...curveVariants,
      { id: "mm", group: "Enzyme kinetics" },
      { id: "kcat", group: "Enzyme kinetics" },
      { id: "allosteric", group: "Enzyme kinetics" },
      { id: "substrate_inhibition", group: "Enzyme kinetics" },
      { id: "enzyme_progress", group: "Enzyme kinetics" },
    ];
    /** Velocity vs substrate on a rectangular hyperbola: v = Vmax·S/(KM+S). */
    const mmTable = (vmax: number, km: number, s: number[]): DataTable => ({
      id: "tx", name: "Kinetics", kind: "xy",
      columns: [{ id: "x", name: "[S]" }, { id: "y", name: "v" }],
      rows: rows(s.map((v) => ({ x: v, y: (vmax * v) / (km + v) }))),
    });

    it("offers Michaelis-Menten for a saturating velocity-vs-substrate curve", () => {
      const recs = suggestCurveModelsForTable(mmTable(100, 5, [1, 2, 5, 10, 20, 35, 50, 75, 100]), { yId: "y", availableVariants: enzymeVariants });
      const mm = recs.find((r) => r.variant === "mm");
      expect(mm).toBeDefined();
      expect(mm!.family).toBe("Enzyme kinetics");
      // Shape cannot prove X is substrate, so it must never be stated as "recommended".
      expect(mm!.suitability).toBe("alternative");
      expect(recs.some((r) => r.variant === "kcat")).toBe(true);
    });

    it("never lets an enzyme model outrank the dose-response ranking on dose data", () => {
      const recs = suggestCurveModelsForTable(xyTable([0.1, 1, 10, 100, 1000]), { yId: "y", availableVariants: enzymeVariants });
      expect(recs[0]!.variant).toBe("4pl");
      expect(recs.every((r) => r.family !== "Enzyme kinetics" || r.suitability !== "recommended")).toBe(true);
    });

    it("offers substrate inhibition when the curve peaks and then declines", () => {
      const s = [1, 2, 5, 10, 20, 40, 80, 160];
      const table: DataTable = {
        id: "tx", name: "Kinetics", kind: "xy",
        columns: [{ id: "x", name: "[S]" }, { id: "y", name: "v" }],
        rows: rows(s.map((v) => ({ x: v, y: (200 * v) / (5 + v * (1 + v / 20)) }))),
      };
      const recs = suggestCurveModelsForTable(table, { yId: "y", availableVariants: enzymeVariants });
      expect(recs.find((r) => r.variant === "substrate_inhibition")?.suitability).toBe("alternative");
    });

    it("does not offer enzyme models for a plain rising line", () => {
      const table: DataTable = {
        id: "tx", name: "Linear", kind: "xy",
        columns: [{ id: "x", name: "x" }, { id: "y", name: "y" }],
        rows: rows([1, 2, 3, 4, 5, 6, 7, 8].map((v) => ({ x: v, y: 3 * v }))),
      };
      const recs = suggestCurveModelsForTable(table, { yId: "y", availableVariants: enzymeVariants });
      expect(recs.every((r) => r.family !== "Enzyme kinetics")).toBe(true);
    });
  });

  it("never returns a model outside the supplied curve-fit registry", () => {
    const allowed = new Set(curveVariants.map((v) => v.id));
    const recs = suggestCurveModelsForTable(xyTable([0.1, 1, 10, 100, 1000]), { yId: "y", availableVariants: curveVariants });
    expect(recs.every((r) => allowed.has(r.variant))).toBe(true);
  });
});

describe("suggestVariantsForTable — per-method type recommendations", () => {
  const top = (recs: ReturnType<typeof suggestVariantsForTable>) => recs[0];

  it("ttest: clean data recommends Welch; skew/outliers recommend Mann-Whitney (parametric kept)", () => {
    const clean = suggestVariantsForTable("ttest", cleanColumnTable(["a", "b"]));
    expect(top(clean)?.variant).toBe("welch");
    expect(top(clean)?.suitability).toBe("recommended");
    const skew = suggestVariantsForTable("ttest", skewColumnTable(["a", "b"]));
    expect(top(skew)?.variant).toBe("mann-whitney");
    expect(top(skew)?.suitability).toBe("recommended");
    expect(skew.find((r) => r.variant === "welch")?.suitability).toBe("recommended");
  });

  it("anova: unequal variance recommends Welch; skew/outliers recommend Kruskal", () => {
    const uneq: DataTable = {
      id: "tc", name: "G", kind: "column",
      columns: [{ id: "label", name: "L" }, { id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }],
      rows: rows([
        { label: "1", a: 10, b: 10, c: 10 }, { label: "2", a: 11, b: 40, c: 11 }, { label: "3", a: 12, b: 70, c: 12 },
        { label: "4", a: 13, b: 100, c: 13 }, { label: "5", a: 14, b: 130, c: 14 }, { label: "6", a: 15, b: 160, c: 15 },
      ]),
    };
    expect(top(suggestVariantsForTable("anova", uneq))?.variant).toBe("welch");
    expect(top(suggestVariantsForTable("anova", skewColumnTable(["a", "b", "c"])))?.variant).toBe("kruskal");
  });

  it("correlation: skew/outliers recommend Spearman over Pearson", () => {
    expect(top(suggestVariantsForTable("correlation", skewColumnTable(["a", "b"]), { xId: "a", yId: "b" }))?.variant).toBe("spearman");
  });

  it("regression defaults to OLS; contingency defaults to the independence test", () => {
    expect(top(suggestVariantsForTable("regression", xyTable([1, 2, 3, 4, 5])))?.variant).toBe("ols");
    expect(top(suggestVariantsForTable("contingency", cleanColumnTable(["a", "b"])))?.variant).toBe("independent");
  });

  it("respects availableVariants (never recommends a type the method does not offer)", () => {
    const recs = suggestVariantsForTable("ttest", skewColumnTable(["a", "b"]), { availableVariants: [{ id: "welch" }, { id: "unpaired" }] });
    expect(recs.every((r) => r.variant === "welch" || r.variant === "unpaired")).toBe(true);
    expect(recs.some((r) => r.variant === "mann-whitney")).toBe(false);
  });

  it("every recommendation carries reasons + assumptions + warnings (picker needs them)", () => {
    for (const m of ["ttest", "anova", "correlation", "pca", "regression", "contingency", "mixedmodel", "auc", "outliers", "curvetransform"]) {
      const recs = suggestVariantsForTable(m, skewColumnTable(["a", "b", "c"]));
      expect(recs.length, `recs for ${m}`).toBeGreaterThan(0);
      for (const r of recs) {
        expect(r.reasons.length, `${m}:${r.variant} reasons`).toBeGreaterThan(0);
        expect(r.assumptions.length, `${m}:${r.variant} assumptions`).toBeGreaterThan(0);
        expect(r.warnings.length, `${m}:${r.variant} warnings`).toBeGreaterThan(0);
      }
    }
  });

  it("curvefit delegates to the curve-model recommender", () => {
    const recs = suggestVariantsForTable("curvefit", xyTable([0.1, 1, 10, 100, 1000]), { yId: "y" });
    expect(recs.some((r) => r.variant === "4pl")).toBe(true);
  });
});
describe("suggestNextSteps statistical recommendations", () => {
  it("suggests Welch t test for two clean independent column groups", () => {
    const s = suggestNextSteps(proj({ tables: [cleanColumnTable(["a", "b"])] }), { activeTableId: "tc" });
    const rec = s.find((x) => x.method === "ttest")!;
    expect(rec.variant).toBe("welch");
    expect(rec.columns).toEqual(["a", "b"]);
    expect(rec.confidence).toBe("high");
  });

  it("suggests ANOVA for three or more clean column groups", () => {
    const s = suggestNextSteps(proj({ tables: [cleanColumnTable(["a", "b", "c"])] }), { activeTableId: "tc" });
    const rec = s.find((x) => x.method === "anova")!;
    expect(rec.variant).toBe("anova");
    expect(rec.columns).toEqual(["a", "b", "c"]);
  });

  // Skew/outliers/small-n → a rank-based test becomes the primary (it outranks the parametric one),
  // which stays available as an alternative. These use the signals profileTable already computes.
  it("leads with Mann-Whitney when a two-group comparison has outliers/skew", () => {
    const s = suggestNextSteps(proj({ tables: [skewColumnTable(["a", "b"])] }), { activeTableId: "tc" });
    const rec = s.find((x) => x.method === "ttest")!; // highest-ranked ttest
    expect(rec.variant).toBe("mann-whitney");
    expect(rec.reasons?.join(" ")).toMatch(/rank-based|outliers|skew/i);
    expect(s.some((x) => x.method === "ttest" && x.variant === "welch")).toBe(true); // parametric kept as alternative
  });

  it("leads with Mann-Whitney for a very small (n<5) two-group comparison", () => {
    const s = suggestNextSteps(proj({ tables: [columnTable(["a", "b"])] }), { activeTableId: "tc" }); // n=3 → small-n gate
    expect(s.find((x) => x.method === "ttest")!.variant).toBe("mann-whitney");
  });

  it("leads with Kruskal-Wallis when a multi-group comparison has outliers/skew", () => {
    const s = suggestNextSteps(proj({ tables: [skewColumnTable(["a", "b", "c"])] }), { activeTableId: "tc" });
    const rec = s.find((x) => x.method === "anova")!;
    expect(rec.variant).toBe("kruskal");
    expect(s.some((x) => x.method === "anova" && (x.variant === "anova" || x.variant === "welch"))).toBe(true);
  });

  it("suggests a paired test only for an explicit before-after graph", () => {
    const table = cleanColumnTable(["a", "b"]);
    const plot = { id: "p", name: "Before after", source: "tc", kind: "beforeafter" } as Plot;
    const s = suggestNextSteps(proj({ tables: [table], plots: [plot] }), { activePlotId: "p" });
    const rec = s.find((x) => x.method === "ttest")!;
    expect(rec.variant).toBe("paired");
    expect(rec.caveats?.join(" ")).toMatch(/same subject/i);
  });

  it("leads with Wilcoxon for a paired before-after graph with outliers/skew", () => {
    const table = skewColumnTable(["a", "b"]);
    const plot = { id: "p", name: "Before after", source: "tc", kind: "beforeafter" } as Plot;
    const s = suggestNextSteps(proj({ tables: [table], plots: [plot] }), { activePlotId: "p" });
    expect(s.find((x) => x.method === "ttest")!.variant).toBe("wilcoxon");
  });

  it("does not infer pairing from an ordinary two-column table", () => {
    const s = suggestNextSteps(proj({ tables: [cleanColumnTable(["a", "b"])] }), { activeTableId: "tc" });
    expect(s.find((x) => x.method === "ttest")!.variant).toBe("welch");
  });

  it("suggests dose-response curve fit for positive roughly log-spaced X", () => {
    const s = suggestNextSteps(proj({ tables: [xyTable([0.1, 1, 10, 100, 1000])] }), { activeTableId: "tx" });
    const rec = s.find((x) => x.method === "curvefit")!;
    expect(rec.variant).toBe("4pl");
    expect(rec.focusKind).toBe("dose-response");
    expect(rec.columns).toEqual(["x", "y"]);
  });

  it("uses agreement analysis for a Bland-Altman graph, not correlation", () => {
    const table = xyTable([1, 2, 3, 4]);
    const plot = { id: "p", name: "Agreement", source: "tx", kind: "blandaltman" } as Plot;
    const s = suggestNextSteps(proj({ tables: [table], plots: [plot] }), { activePlotId: "p" });
    expect(s.find((x) => x.method === "blandaltman")).toBeTruthy();
    expect(s.find((x) => x.method === "correlation")).toBeFalsy();
  });

  it("treats a default (kind-undefined) XY graph as a relationship, not an intent-less table", () => {
    // Plot.kind === undefined is the default XY graph (see model.ts), so the graph-aware
    // ranking must infer "relationship" and surface the graph reason — not fall through to !intent.
    const table = xyTable([1, 2, 3, 4, 5]);
    const plot = { id: "p", name: "Scatter", source: "tx" } as Plot; // no kind → default XY
    const withGraph = suggestNextSteps(proj({ tables: [table], plots: [plot] }), { activePlotId: "p" });
    const gRec = withGraph.find((x) => x.method === "correlation")!;
    expect(gRec.reasons?.join(" ")).toContain("The active xy graph points to this workflow.");
    // Same data with no active graph → correlation still offered, but without the graph reason.
    const noGraph = suggestNextSteps(proj({ tables: [table] }), { activeTableId: "tx" });
    const tRec = noGraph.find((x) => x.method === "correlation")!;
    expect(tRec.reasons?.join(" ")).not.toContain("points to this workflow");
  });

  it("infers an intent for the default XY plot (kind === undefined)", () => {
    const table = xyTable([1, 2, 3, 4, 5]);
    // The default XY graph stores kind === undefined; it must still map to "relationship".
    expect(inferGraphIntent({ id: "p", name: "s", source: "tx" } as Plot, table)).toBe("relationship");
    // A multivariable (non-xy table) default plot maps to "multivariable", not undefined.
    expect(inferGraphIntent({ id: "p", name: "s", source: "tc" } as Plot, columnTable(["a", "b"]))).toBe("multivariable");
  });

  it("suggests contingency analysis for count tables", () => {
    const table: DataTable = {
      id: "count",
      name: "Counts",
      kind: "contingency",
      columns: [{ id: "row", name: "Row" }, { id: "yes", name: "Yes" }, { id: "no", name: "No" }],
      rows: rows([{ row: "A", yes: 10, no: 2 }, { row: "B", yes: 4, no: 8 }]),
    };
    const s = suggestNextSteps(proj({ tables: [table] }), { activeTableId: "count" });
    expect(s.find((x) => x.method === "contingency")?.variant).toBe("independent");
  });

  it("suggests survival analysis for time-to-event data", () => {
    const table: DataTable = {
      id: "surv",
      name: "Survival",
      kind: "survival",
      columns: [{ id: "time", name: "Time" }, { id: "a", name: "A" }, { id: "b", name: "B" }],
      rows: rows([{ time: 1, a: 1, b: 0 }, { time: 2, a: 0, b: 1 }, { time: 3, a: 1, b: 1 }]),
    };
    const s = suggestNextSteps(proj({ tables: [table] }), { activeTableId: "surv" });
    expect(s.find((x) => x.method === "survival")?.columns).toEqual(["time", "a", "b"]);
  });

  it("suggests multivariable exploration for numeric multivariable tables", () => {
    const table: DataTable = {
      id: "mv",
      name: "Variables",
      kind: "multivariable",
      columns: [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }],
      rows: rows([{ a: 1, b: 2, c: 3 }, { a: 2, b: 4, c: 8 }, { a: 3, b: 6, c: 9 }]),
    };
    const s = suggestNextSteps(proj({ tables: [table] }), { activeTableId: "mv" });
    expect(s.find((x) => x.method === "corrmatrix")).toBeTruthy();
    expect(s.find((x) => x.method === "pca")).toBeTruthy();
  });
  it("validates method, variant, columns, and complete-case eligibility", () => {
    const table = columnTable(["a", "b"]);
    expect(validateSuggestionSpec(table, { id: "bad", text: "", cta: "", actionId: "analyze", kind: "analysis", method: "ttest", variant: "bad", columns: ["a", "b"] }).ok).toBe(false);
    expect(validateSuggestionSpec(table, { id: "bad", text: "", cta: "", actionId: "analyze", kind: "analysis", method: "ttest", variant: "welch", columns: ["a", "missing"] }).ok).toBe(false);
    expect(validateSuggestionSpec(table, { id: "bad", text: "", cta: "", actionId: "analyze", kind: "analysis", method: "ttest", variant: "paired", columns: ["a", "b"] }).ok).toBe(true);
  });

  it("profiles missing data, row-aligned pairs, skew/outliers, and variance imbalance", () => {
    const table: DataTable = {
      id: "profile",
      name: "Profile",
      kind: "column",
      columns: [{ id: "label", name: "Label" }, { id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }],
      rows: rows([
        { label: "1", a: 1, b: 1, c: 1 },
        { label: "2", a: 2, b: 2, c: 10 },
        { label: "3", a: 3, b: null, c: 100 },
        { label: "4", a: 4, b: 4, c: 1000 },
      ]),
    };
    const p = profileTable(table);
    expect(p.usableDatasets.find((s) => s.id === "b")?.missing).toBe(1);
    expect(p.maxPairedComplete).toBeGreaterThanOrEqual(3);
    expect(p.varianceRatio).toBeGreaterThan(4);
    expect(p.anySmallN).toBe(true);
  });

  it("downgrades possible pairing when before-after rows are misaligned", () => {
    const table: DataTable = {
      id: "paired",
      name: "Misaligned",
      kind: "column",
      columns: [{ id: "label", name: "Label" }, { id: "a", name: "A" }, { id: "b", name: "B" }],
      rows: rows([{ label: "1", a: 1, b: null }, { label: "2", a: null, b: 2 }, { label: "3", a: 3, b: null }, { label: "4", a: null, b: 4 }]),
    };
    const plot = { id: "p", name: "Before after", source: "paired", kind: "beforeafter" } as Plot;
    const s = suggestNextSteps(proj({ tables: [table], plots: [plot] }), { activePlotId: "p" });
    expect(s.find((x) => x.method === "ttest")?.variant).not.toBe("paired");
  });

  it("warns when contingency expected counts are low", () => {
    const table: DataTable = {
      id: "lowcount",
      name: "Low counts",
      kind: "contingency",
      columns: [{ id: "row", name: "Row" }, { id: "yes", name: "Yes" }, { id: "no", name: "No" }],
      rows: rows([{ row: "A", yes: 1, no: 0 }, { row: "B", yes: 0, no: 4 }]),
    };
    const rec = suggestNextSteps(proj({ tables: [table] }), { activeTableId: "lowcount" }).find((x) => x.method === "contingency")!;
    expect(rec.caveats?.join(" ")).toMatch(/expected|Fisher/i);
  });

  it("suggests goodness-of-fit for parts-of-whole count tables", () => {
    const table: DataTable = {
      id: "whole",
      name: "Composition",
      kind: "partsofwhole",
      columns: [{ id: "cat", name: "Category" }, { id: "count", name: "Count" }],
      rows: rows([{ cat: "A", count: 10 }, { cat: "B", count: 20 }, { cat: "C", count: 30 }]),
    };
    expect(suggestNextSteps(proj({ tables: [table] }), { activeTableId: "whole" }).find((x) => x.method === "goodnessoffit")).toBeTruthy();
  });

  it("uses low-confidence descriptives for ambiguous numeric tables", () => {
    const table: DataTable = {
      id: "amb",
      name: "Ambiguous",
      kind: "column",
      columns: [{ id: "x", name: "Value" }],
      rows: rows([{ x: 1 }, { x: 2 }, { x: 3 }]),
    };
    const rec = suggestNextSteps(proj({ tables: [table] }), { activeTableId: "amb" }).find((x) => x.method === "describe");
    expect(rec?.confidence).toBe("low");
  });

  it("asks for the high-impact pairing choice when a before-after graph is ambiguous", () => {
    const table = cleanColumnTable(["a", "b"]);
    const plot = { id: "p", name: "Before after", source: "tc", kind: "beforeafter" } as Plot;
    const rec = suggestNextSteps(proj({ tables: [table], plots: [plot] }), { activePlotId: "p" }).find((x) => x.method === "ttest")!;
    expect(rec.question?.prompt).toMatch(/independent|matched/i);
    expect(rec.question?.choices.map((c) => c.variant)).toEqual(["welch", "paired"]);
  });

  it("suggests repeated-measures analysis only for grouped complete rows", () => {
    const table: DataTable = {
      id: "grouped",
      name: "Repeated conditions",
      kind: "grouped",
      columns: [{ id: "subject", name: "Subject" }, { id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }],
      rows: rows([{ subject: 1, a: 1, b: 2, c: 3 }, { subject: 2, a: 2, b: 3, c: 4 }, { subject: 3, a: 3, b: 4, c: 5 }, { subject: 4, a: 4, b: 5, c: 6 }]),
    };
    const rec = suggestNextSteps(proj({ tables: [table] }), { activeTableId: "grouped" }).find((x) => x.method === "rmanova");
    expect(rec?.variant).toBe("rmanova");
    expect(rec?.columns).toEqual(["a", "b", "c"]);
  });

  it("suggests Cox only when survival data has an explicit covariate", () => {
    const table: DataTable = {
      id: "surv-cov",
      name: "Survival with covariate",
      kind: "survival",
      columns: [{ id: "time", name: "Time" }, { id: "event", name: "Event" }, { id: "age", name: "Age" }],
      rows: rows([{ time: 1, event: 1, age: 20 }, { time: 2, event: 0, age: 30 }, { time: 3, event: 1, age: 40 }, { time: 4, event: 0, age: 50 }]),
    };
    const rec = suggestNextSteps(proj({ tables: [table] }), { activeTableId: "surv-cov" }).find((x) => x.method === "cox");
    expect(rec?.columns).toEqual(["time", "event", "age"]);
  });

  it("suggests logistic regression when a binary outcome is visible", () => {
    const table: DataTable = {
      id: "logit",
      name: "Binary outcome",
      kind: "multivariable",
      columns: [{ id: "outcome", name: "Outcome" }, { id: "x1", name: "X1" }, { id: "x2", name: "X2" }],
      rows: rows([{ outcome: 0, x1: 1, x2: 4 }, { outcome: 1, x1: 2, x2: 5 }, { outcome: 0, x1: 3, x2: 6 }, { outcome: 1, x1: 4, x2: 7 }]),
    };
    const rec = suggestNextSteps(proj({ tables: [table] }), { activeTableId: "logit" }).find((x) => x.method === "logistic");
    expect(rec?.columns).toEqual(["outcome", "x1", "x2"]);
    expect(rec?.assumptions?.join(" ")).toMatch(/binary outcome/i);
  });

  it("suggests goodness-of-fit for parts-of-whole counts but not for proportions", () => {
    // Guards against accepting 0.2/0.3/0.5 and proposing χ² on a total of 1. The
    // engine itself says "Counts, not proportions". Counts still get the suggestion.
    const table: DataTable = {
      id: "prop",
      name: "Composition proportions",
      kind: "partsofwhole",
      columns: [{ id: "category", name: "Category" }, { id: "share", name: "Share" }],
      rows: rows([{ category: "A", share: 0.2 }, { category: "B", share: 0.3 }, { category: "C", share: 0.5 }]),
    };
    expect(suggestNextSteps(proj({ tables: [table] }), { activeTableId: "prop" }).find((x) => x.method === "goodnessoffit")).toBeUndefined();
    const counts: DataTable = { ...table, rows: rows([{ category: "A", share: 20 }, { category: "B", share: 30 }, { category: "C", share: 50 }]) };
    expect(suggestNextSteps(proj({ tables: [counts] }), { activeTableId: "prop" }).find((x) => x.method === "goodnessoffit")?.variant).toBe("chisq");
  });
  it("uses ROC classification intent for an ROC graph instead of ordinary correlation", () => {
    const table: DataTable = {
      id: "roc",
      name: "Diagnostic marker",
      kind: "xy",
      columns: [{ id: "score", name: "Score" }, { id: "outcome", name: "Outcome" }],
      rows: rows([{ score: 0.1, outcome: 0 }, { score: 0.4, outcome: 0 }, { score: 0.7, outcome: 1 }, { score: 0.9, outcome: 1 }]),
    };
    const plot = { id: "roc-plot", name: "ROC", source: "roc", kind: "roc" } as Plot;
    const suggestions = suggestNextSteps(proj({ tables: [table], plots: [plot] }), { activePlotId: "roc-plot" });
    expect(suggestions.find((x) => x.method === "roc")?.columns).toEqual(["score", "outcome"]);
    expect(suggestions.find((x) => x.method === "correlation")).toBeFalsy();
  });

  it("does not infer Poisson from unnamed integer predictors", () => {
    const table: DataTable = {
      id: "integer-predictors",
      name: "Unlabeled variables",
      kind: "multivariable",
      columns: [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }],
      rows: rows([{ a: 1, b: 2, c: 3 }, { a: 2, b: 3, c: 4 }, { a: 3, b: 4, c: 5 }, { a: 4, b: 5, c: 6 }]),
    };
    expect(suggestNextSteps(proj({ tables: [table] }), { activeTableId: "integer-predictors" }).find((x) => x.method === "poisson")).toBeFalsy();
  });});

/**
 * Guards against suggestion rules recommending a test the data cannot support. Each block
 * names the case it covers.
 */
describe("suggestion accuracy", () => {
  const xs = (x: number[]): boolean => profileTable(xyTable(x)).xLogSpaced;

  it("evenly spaced X is not dose-like; log-spaced X spanning ≥10× is", () => {
    // Successive log-diffs of 10..17 are all small and similar, so a naive test reads
    // them as "log-spaced" and offers a 4PL to a plain year/index axis.
    expect(xs([10, 11, 12, 13, 14, 15, 16, 17]), "10..17").toBe(false);
    expect(xs([2000, 2001, 2002, 2003, 2004, 2005, 2006, 2007]), "years").toBe(false);
    expect(xs([20, 25, 30, 35, 40]), "20..40 step 5").toBe(false);
    expect(xs([0.1, 0.3, 1, 3, 10, 30, 100]), "half-decades").toBe(true);
    expect(xs([1, 10, 100, 1000]), "decades").toBe(true);
    // Too few points, a negative or zero value, or plain linear steps: not log-spaced.
    expect(xs([1, 10, 100]), "3 points").toBe(false);
    expect(xs([-1, 1, 10, 100]), "negative").toBe(false);
    expect(xs([0, 1, 10, 100]), "zero").toBe(false);
    expect(xs([1, 2, 3, 4, 5, 6, 7, 8]), "linear 1..8").toBe(false);
    expect(xs([1, 2, 3, 4, 5, 6, 7]), "days").toBe(false);
    expect(xs(Array.from({ length: 24 }, (_, i) => i + 1)), "hours").toBe(false);
  });

  it("the standard survival sheet (one event column per group) gets no Cox suggestion", () => {
    // Its only "covariate" would be the other group's event column → 1 complete row → engine error.
    const surv = galleryItems().find((g) => g.key === "survival")!;
    const p = proj({ tables: [surv.table], plots: [surv.plot] });
    expect(suggestNextSteps(p, { activePlotId: surv.plot.id }).map((s) => s.method)).not.toContain("cox");
    expect(suggestNextSteps(p, { activeTableId: surv.table.id }).map((s) => s.method)).not.toContain("cox");
    // A time + event + real covariate sheet still does (see "suggests Cox only when…" above).
  });

  it("no mixed-effects suggestion for a grouped sheet (the model is long-format only)", () => {
    const table: DataTable = {
      id: "grp",
      name: "Grouped replicates",
      kind: "grouped",
      columns: [
        { id: "row", name: "Drug" },
        { id: "a", name: "A" }, { id: "a2", name: "A r2", role: "y", group: "a" },
        { id: "b", name: "B" }, { id: "b2", name: "B r2", role: "y", group: "b" },
        { id: "c", name: "C" }, { id: "c2", name: "C r2", role: "y", group: "c" },
      ],
      rows: rows([
        { row: "1", a: 1, a2: 2, b: 2, b2: 3, c: 3, c2: 4 },
        { row: "2", a: 2, a2: 3, b: 3, b2: 4, c: 4, c2: 5 },
        { row: "3", a: 3, a2: 4, b: 4, b2: 5, c: 5, c2: 6 },
        { row: "4", a: 4, a2: 5, b: 5, b2: 6, c: 6, c2: 7 },
      ]),
    };
    // The fixture must be able to reach the rule: replicates + ≥3 groups.
    expect(profileTable(table).hasReplicates).toBe(true);
    const s = suggestNextSteps(proj({ tables: [table] }), { activeTableId: "grp" });
    expect(s.map((x) => x.method)).not.toContain("mixedmodel");
  });

  it("a 1-row (or 1-column) count table is goodness-of-fit, not contingency", () => {
    const pie = galleryItems().find((g) => g.key === "pie")!;
    const s = suggestNextSteps(proj({ tables: [pie.table], plots: [pie.plot] }), { activePlotId: pie.plot.id });
    expect(s.map((x) => x.method)).not.toContain("contingency");
    expect(s.find((x) => x.method === "goodnessoffit")?.variant).toBe("chisq");
    const oneCol: DataTable = {
      id: "onecol", name: "One column", kind: "contingency",
      columns: [{ id: "row", name: "Row" }, { id: "n", name: "N" }],
      rows: rows([{ row: "A", n: 10 }, { row: "B", n: 20 }, { row: "C", n: 30 }]),
    };
    const s2 = suggestNextSteps(proj({ tables: [oneCol] }), { activeTableId: "onecol" });
    expect(s2.map((x) => x.method)).not.toContain("contingency");
    expect(s2.map((x) => x.method)).toContain("goodnessoffit");
  });

  it("a paired-dot graph is a paired comparison, with the independent-or-matched question", () => {
    const table = cleanColumnTable(["a", "b"]);
    const plot = { id: "p", name: "Paired dots", source: "tc", kind: "paireddot" } as Plot;
    expect(inferGraphIntent(plot, table)).toBe("paired-comparison");
    const rec = suggestNextSteps(proj({ tables: [table], plots: [plot] }), { activePlotId: "p" }).find((x) => x.method === "ttest")!;
    expect(rec.variant).toBe("paired");
    expect(rec.question?.choices.map((c) => c.variant)).toEqual(["welch", "paired"]);
  });

  describe("curve models", () => {
    const sig = (x: number): number => (100 * x) / (10 + x); // clean 4PL, EC50 = 10
    it("replicate rows do not break monotonicity — clean sigmoid → 4PL first, not biphasic", () => {
      const doses = [0.1, 1, 10, 100, 1000];
      const table = xyTable(doses);
      table.rows = rows(doses.flatMap((x) => [{ x, y: sig(x) + 1 }, { x, y: sig(x) - 1 }]));
      const recs = suggestCurveModelsForTable(table, { yId: "y", availableVariants: curveVariants });
      expect(recs[0]!.variant).toBe("4pl");
      expect(recs[0]!.suitability).toBe("recommended");
      expect(recs.find((r) => r.variant === "biphasic_dr")).toBeUndefined();
    });
    it("a small wobble (< 15 % of the range) is noise, a real reversal is biphasic", () => {
      const doses = [0.1, 1, 10, 100, 1000, 10000];
      const noisy = xyTable(doses);
      noisy.rows = rows([{ x: 0.1, y: 1 }, { x: 1, y: 9 }, { x: 10, y: 48 }, { x: 100, y: 46 }, { x: 1000, y: 91 }, { x: 10000, y: 99 }]);
      const nr = suggestCurveModelsForTable(noisy, { yId: "y", availableVariants: curveVariants });
      expect(nr[0]!.variant).toBe("4pl");
      expect(nr.find((r) => r.variant === "biphasic_dr")).toBeUndefined();
      const bi = xyTable(doses);
      bi.rows = rows([{ x: 0.1, y: 10 }, { x: 1, y: 30 }, { x: 10, y: 60 }, { x: 100, y: 40 }, { x: 1000, y: 20 }, { x: 10000, y: 5 }]);
      const br = suggestCurveModelsForTable(bi, { yId: "y", availableVariants: curveVariants });
      expect(br[0]!.variant).toBe("biphasic_dr");
    });
    it("4PL needs 5 distinct doses (6 for high confidence); a flat response is not recommended", () => {
      const four = suggestCurveModelsForTable(xyTable([0.1, 1, 10, 100]), { yId: "y", availableVariants: curveVariants });
      expect(four.find((r) => r.variant === "4pl")?.suitability).not.toBe("recommended");
      const five = suggestCurveModelsForTable(xyTable([0.1, 1, 10, 100, 1000]), { yId: "y", availableVariants: curveVariants });
      expect(five[0]).toMatchObject({ variant: "4pl", suitability: "recommended", confidence: "medium" });
      const six = suggestCurveModelsForTable(xyTable([0.1, 1, 10, 100, 1000, 10000]), { yId: "y", availableVariants: curveVariants });
      expect(six[0]).toMatchObject({ variant: "4pl", suitability: "recommended", confidence: "high" });
      const flat = xyTable([0.1, 1, 10, 100, 1000, 10000]);
      flat.rows = rows([0.1, 1, 10, 100, 1000, 10000].map((x) => ({ x, y: 5 })));
      const fr = suggestCurveModelsForTable(flat, { yId: "y", availableVariants: curveVariants });
      expect(fr.find((r) => r.variant === "4pl")?.suitability).not.toBe("recommended");
    });
  });

  it("survival is only survival-shaped when the sheet IS a survival sheet (ROC data is not)", () => {
    const roc = galleryItems().find((g) => g.key === "roc")!;
    expect(profileTable(roc.table).survivalLike).toBe(false);
    const s = suggestNextSteps(proj({ tables: [roc.table] }), { activeTableId: roc.table.id });
    expect(s.map((x) => x.method)).not.toContain("survival");
  });

  it("goodness-of-fit is not suggested for proportions (χ² wants counts, not a total of 1)", () => {
    const table: DataTable = {
      id: "prop", name: "Shares", kind: "partsofwhole",
      columns: [{ id: "category", name: "Category" }, { id: "share", name: "Share" }],
      rows: rows([{ category: "A", share: 0.2 }, { category: "B", share: 0.3 }, { category: "C", share: 0.5 }]),
    };
    const s = suggestNextSteps(proj({ tables: [table] }), { activeTableId: "prop" });
    expect(s.map((x) => x.method)).not.toContain("goodnessoffit");
  });

  it("the outcome hint matches the word 'y', not every word ending in y", () => {
    const mv = (names: string[]): DataTable => ({
      id: "mv", name: "Study", kind: "multivariable",
      columns: names.map((n, i) => ({ id: `c${i}`, name: n })),
      rows: rows([{ c0: 1.5, c1: 7.2, c2: 61.5 }, { c0: 2.5, c1: 6.1, c2: 70.2 }, { c0: 3.5, c1: 8.3, c2: 80.1 }, { c0: 4.5, c1: 5.9, c2: 88.4 }]),
    });
    expect(profileTable(mv(["Study hrs", "Sleep", "Test score"])).likelyContinuousOutcome).toBe("c2");
    expect(profileTable(mv(["Study hrs", "Sleep", "outcome"])).likelyContinuousOutcome).toBe("c2");
    expect(profileTable(mv(["Study hrs", "Sleep", "y"])).likelyContinuousOutcome).toBe("c2");
    expect(profileTable(mv(["family", "Sleep", "Weight"])).likelyContinuousOutcome).toBeUndefined();
  });

  it("a volcano (and forest/pyramid/radar/network) graph gets no generic correlation nudge", () => {
    const volcano = galleryItems().find((g) => g.key === "volcano")!;
    const s = suggestNextSteps(proj({ tables: [volcano.table], plots: [volcano.plot] }), { activePlotId: volcano.plot.id });
    expect(s.map((x) => x.method)).not.toContain("correlation");
    for (const kind of ["volcano", "forest", "pyramid", "radar", "network"]) {
      expect(inferGraphIntent({ id: "p", name: "s", source: "tx", kind } as Plot, xyTable([1, 2, 3, 4, 5])), kind).toBeDefined();
    }
  });
});
