// @vitest-environment node
/**
 * An ordination is not a PCA with different numbers.
 *
 * Handing a PCoA / NMDS result to the PCA graph suite would be wrong. That suite builds a
 * loadings plot and a biplot, both of which draw an arrow per variable — and
 * neither method has loadings to draw them from. The arrows would be invented.
 *
 * What each result actually earns, and why:
 *   PCoA  has eigenvalues → the map + a scree plot
 *   NMDS  has none (it fits ranks, not variance) → the map + the Shepard plot, the diagnostic
 *         that says whether the map may be read at all
 */
import { describe, expect, it } from "vitest";
import type { OrdinationData } from "./model";
import { ordinationGraphPlan } from "./ordination";

const pcoa: OrdinationData = {
  varLabels: ["Sp1", "Sp2"],
  pcLabels: ["PCoA1", "PCoA2", "PCoA3"],
  scores: [[1, 0.2], [-0.5, 0.4], [0.1, -0.9]],
  eigenvalues: [2.1, 0.9, 0.3],
  explained: [0.64, 0.27, 0.09],
};
const nmds: OrdinationData = {
  varLabels: ["Sp1", "Sp2"],
  pcLabels: ["NMDS1", "NMDS2"],
  scores: [[1, 0.2], [-0.5, 0.4], [0.1, -0.9]],
  stress: 0.07,
  // deliberately NOT sorted by dissimilarity — the plan has to sort it
  shepard: { dissimilarity: [0.8, 0.2, 0.5], distance: [0.75, 0.3, 0.6], fitted: [0.7, 0.3, 0.6] },
};

describe("what each ordination earns", () => {
  it("PCoA: the map and a scree plot", () => {
    expect(ordinationGraphPlan("pcoa", pcoa).map((g) => g.role)).toEqual(["map", "scree"]);
    expect(ordinationGraphPlan("pcoa", pcoa)[0]!.label).toBe("PCoA map");
  });

  it("NMDS: the map and the Shepard plot — never a scree, it has no eigenvalues", () => {
    const roles = ordinationGraphPlan("nmds", nmds).map((g) => g.role);
    expect(roles).toEqual(["map", "shepard"]);
    expect(roles).not.toContain("scree");
  });

  it("never a loadings plot or a biplot, from either — there are no loadings to draw", () => {
    for (const kinds of [ordinationGraphPlan("pcoa", pcoa), ordinationGraphPlan("nmds", nmds)]) {
      expect(kinds.map((g) => g.kind)).not.toContain("pcaload");
      expect(kinds.map((g) => g.kind)).not.toContain("pcabiplot");
    }
  });

  it("a single eigenvalue earns no scree — one bar is not a spectrum", () => {
    const one = { ...pcoa, eigenvalues: [2.1], explained: [1] };
    expect(ordinationGraphPlan("pcoa", one).map((g) => g.role)).toEqual(["map"]);
  });

  it("no map, no graphs — and no other method gets one by accident", () => {
    expect(ordinationGraphPlan("pcoa", { ...pcoa, scores: [] })).toEqual([]);
    expect(ordinationGraphPlan("pcoa", undefined)).toEqual([]);
    expect(ordinationGraphPlan("pca", pcoa), "a PCA must go through its own suite").toEqual([]);
    expect(ordinationGraphPlan("cluster", nmds)).toEqual([]);
  });
});

describe("the Shepard table", () => {
  const shepard = () => ordinationGraphPlan("nmds", nmds).find((g) => g.role === "shepard")!;

  it("carries one row per pair, in the three columns the diagram compares", () => {
    const t = shepard().table!;
    expect(t.columns).toEqual(["Dissimilarity", "Map distance", "Fitted (monotone)"]);
    expect(t.rows).toHaveLength(3);
    expect(shepard().axisTitles).toEqual({ x: "Observed dissimilarity", y: "Distance on the map" });
  });

  it("is sorted by dissimilarity — the fitted step is drawn as a line, and an unsorted line is a scribble", () => {
    const xs = shepard().table!.rows.map((r) => r[0]!);
    expect(xs).toEqual([0.2, 0.5, 0.8]);
    // …and each row still carries its own pair, not a re-sorted mixture of three columns
    expect(shepard().table!.rows).toEqual([[0.2, 0.3, 0.3], [0.5, 0.6, 0.6], [0.8, 0.75, 0.7]]);
  });

  it("one point is not a diagram", () => {
    const thin = { ...nmds, shepard: { dissimilarity: [0.2], distance: [0.3], fitted: [0.3] } };
    expect(ordinationGraphPlan("nmds", thin).map((g) => g.role)).toEqual(["map"]);
  });
});

/**
 * CA is the third ordination, and the one whose species are first-class: sites and species
 * come out of the same decomposition, so the joint plot is the method, not a decoration.
 */
describe("correspondence analysis", () => {
  const ca: OrdinationData = {
    varLabels: ["Sp1", "Sp2", "Sp3"],
    pcLabels: ["CA1", "CA2"],
    scores: [[0.9, 0.1], [-0.4, 0.5], [-0.5, -0.6]],
    speciesScores: [[1.1, 0.0], [-0.2, 0.7], [-0.9, -0.7]],
    eigenvalues: [0.42, 0.11],
    explained: [0.79, 0.21],
  };

  it("earns the map and a scree plot — it has eigenvalues, unlike NMDS", () => {
    expect(ordinationGraphPlan("ca", ca).map((g) => g.role)).toEqual(["map", "scree"]);
    expect(ordinationGraphPlan("ca", ca)[0]!.label).toBe("CA map");
  });

  it("still never a biplot — its species are points, and a biplot would draw them as arrows", () => {
    expect(ordinationGraphPlan("ca", ca).map((g) => g.kind)).toEqual(["pcascore", "scree"]);
  });

  it("no Shepard plot — there is no stress to diagram", () => {
    expect(ordinationGraphPlan("ca", { ...ca, shepard: { dissimilarity: [1, 2], distance: [1, 2], fitted: [1, 2] } })
      .map((g) => g.role)).toEqual(["map", "scree"]);
  });
});

/**
 * The constrained half — RDA, CCA and db-RDA. The graph plan's only distinction between them
 * and the unconstrained methods is that a constrained result earns the triplot: its explanatory
 * arrows are the half that makes it constrained, and a plain score plot would silently drop
 * them. All three go through one list (`CONSTRAINED_METHODS`), which is what these hold —
 * a chain of `method === "rda"` tests spread over several files would have to be updated in
 * every place when a method is added.
 */
describe("constrained ordinations earn the triplot", () => {
  const constrained = (labels: string[]): OrdinationData => ({
    varLabels: ["Sp1", "Sp2"],
    pcLabels: labels,
    scores: [[1, 0.2], [-0.5, 0.4], [0.1, -0.9]],
    eigenvalues: [2.1, 0.9],
    explained: [0.7, 0.3],
    envScores: [[0.9, 0.1]],
    envLabels: ["Temp"],
  });

  it.each([
    ["rda", "RDA", ["RDA1", "RDA2"]],
    ["cca", "CCA", ["CCA1", "CCA2"]],
    ["dbrda", "db-RDA", ["dbRDA1", "dbRDA2"]],
  ])("%s: the triplot, named %s, plus a scree", (method, label, axes) => {
    const plan = ordinationGraphPlan(method, constrained(axes as string[]));
    expect(plan.map((g) => g.kind)).toEqual(["triplot", "scree"]);
    expect(plan[0]!.label).toBe(`${label} triplot`);
    expect(plan[1]!.label).toBe(`${label} scree`);
  });

  it("a constrained result with NO explanatory arrows is a score plot, not a triplot", () => {
    // Reachable: the engine returns `envScores: []` for nothing it could place. Drawing a
    // triplot then would promise arrows the result does not have.
    const bare = { ...constrained(["CCA1", "CCA2"]), envScores: [] };
    expect(ordinationGraphPlan("cca", bare).map((g) => g.kind)).toEqual(["pcascore", "scree"]);
  });

  it("still never a loadings plot or a biplot — a constrained ordination has no loadings either", () => {
    for (const m of ["cca", "dbrda"]) {
      const kinds = ordinationGraphPlan(m, constrained(["A1", "A2"])).map((g) => g.kind);
      expect(kinds).not.toContain("pcaload");
      expect(kinds).not.toContain("pcabiplot");
    }
  });

  it("db-RDA earns no Shepard plot — it is not an NMDS, and it has real eigenvalues", () => {
    const withShepard = {
      ...constrained(["dbRDA1", "dbRDA2"]),
      shepard: { dissimilarity: [1, 2], distance: [1, 2], fitted: [1, 2] },
    };
    expect(ordinationGraphPlan("dbrda", withShepard).map((g) => g.role)).toEqual(["map", "scree"]);
  });

  it("an unknown method still earns nothing — the list is a gate, not a default", () => {
    expect(ordinationGraphPlan("permanova", constrained(["A1", "A2"]))).toEqual([]);
    expect(ordinationGraphPlan("", constrained(["A1", "A2"]))).toEqual([]);
  });
});
