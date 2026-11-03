/**
 * "Create opens Analyze; run it and the graph is made next to the sheet" — every genre the New
 * graph dialog draws from an analysis must say how that graph is made from the analysis result.
 */
import { describe, expect, it } from "vitest";
import { analysisGenreGraph, NEW_GRAPH_GENRES } from "./newGraph";

describe("analysis-fed graph genres", () => {
  const fed = NEW_GRAPH_GENRES.filter((g) => g.analysis);

  it("there are analysis-fed genres at all (so the check below is not vacuous)", () => {
    expect(fed.map((g) => g.key).sort()).toEqual(["pcabiplot", "pcaload", "pcascore", "roc", "scree", "survival", "triplot"]);
  });

  it("each one is drawn from its analysis once it has run", () => {
    for (const g of fed) expect(analysisGenreGraph(g.key), `${g.key} would be promised and never drawn`).not.toBeNull();
  });

  it("a genre that is not analysis-fed is not claimed", () => {
    for (const g of NEW_GRAPH_GENRES.filter((x) => !x.analysis)) expect(analysisGenreGraph(g.key), g.key).toBeNull();
  });

  it("maps each to the right kind of graph", () => {
    expect(analysisGenreGraph("survival")).toBe("survival");
    expect(analysisGenreGraph("roc")).toBe("roc");
    expect(analysisGenreGraph("triplot")).toBe("ordination");
    for (const k of ["pcascore", "pcaload", "pcabiplot", "scree"]) expect(analysisGenreGraph(k)).toBe("pca");
  });
});
