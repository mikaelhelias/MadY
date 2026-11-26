// @vitest-environment node
/**
 * Species points are not loadings.
 *
 * A correspondence analysis puts the cases and the variables on the same axes — a site sits
 * near the species it is relatively rich in, and that joint picture is the method. PCA has no
 * such thing: its variables are directions (arrows from the origin), not places.
 *
 * So the score plot draws species as marks in their own family, and three things must hold or
 * the picture is misleading: they are drawn, the axes hold them, and no arrow is invented for them.
 */
import { describe, expect, it } from "vitest";
import type { DataTable, PcaGraphData, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene";

const SIZE = { width: 620, height: 440 };
const table: DataTable = { id: "t", kind: "pca", name: "T", columns: [{ id: "a", name: "A" }], rows: [] };
const pca: PcaGraphData = {
  varLabels: ["Sp1", "Sp2", "Sp3"],
  pcLabels: ["CA1", "CA2"],
  loadings: [],
  scores: [[0.4, 0.1], [-0.3, 0.2], [-0.1, -0.4]],
  eigenvalues: [0.42, 0.11],
  explained: [0.79, 0.21],
  speciesScores: [[2.6, 0.05], [-0.2, 0.7], [-0.9, -2.4]],
  speciesLabels: ["Sp1", "Sp2", "Sp3"],
};
const build = (over: Partial<Plot> = {}, data: PcaGraphData = pca) =>
  buildPlotScene(table, { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "pcascore", pca: data, ...over }, SIZE);

describe("species points on the map", () => {
  it("are drawn as their own family, one mark each", () => {
    const s = build();
    const fam = s.series.find((x) => x.id === "pca-species");
    expect(fam, "the species were not drawn — half a correspondence analysis is missing").toBeTruthy();
    expect(fam!.marks).toHaveLength(3);
    expect(fam!.name).toBe("Species");
  });

  it("the axes hold them — a species outside the scale is drawn off the plot", () => {
    // Sp1 sits at 2.6 on CA1 while no case goes past 0.4: if the domain came from the cases
    // alone the species would be painted into the margin.
    const s = build();
    const [lo, hi] = s.x.domain;
    expect(Math.min(lo, hi)).toBeLessThanOrEqual(-0.9);
    expect(Math.max(lo, hi)).toBeGreaterThanOrEqual(2.6);
    const marks = s.series.find((x) => x.id === "pca-species")!.marks;
    for (const m of marks) {
      expect(m.cx).toBeGreaterThanOrEqual(s.plot.x - 1);
      expect(m.cx).toBeLessThanOrEqual(s.plot.x + s.plot.width + 1);
    }
  });

  it("no arrow is invented for them — an arrow claims a direction they do not have", () => {
    const arrows = build().annotations.filter((a) => a.kind === "arrow" && a.id.startsWith("pca-arrow"));
    expect(arrows).toEqual([]);
  });

  it("each carries its name, and a rename or a drag reaches the drawing", () => {
    const labels = build().annotations.filter((a) => a.id.startsWith("pca-vlabel-s")).map((a) => a.label);
    expect(labels).toEqual(["Sp1", "Sp2", "Sp3"]);
    // The rename + drag stores are the loading labels' own, under keys no loading can produce.
    const renamed = build({ pcaStyle: { varLabelText: { s1: "Bracken" }, labelPos: { s0: { x: 0.1, y: 0.2 } } } });
    const byId = new Map(renamed.annotations.filter((a) => a.id.startsWith("pca-vlabel-")).map((a) => [a.id, a]));
    expect(byId.get("pca-vlabel-s1")!.label).toBe("Bracken");
    expect(byId.get("pca-vlabel-s0")!.labelX).toBeCloseTo(renamed.plot.x + 0.1 * renamed.plot.width, 6);
  });

  it("the switch turns them off, and a PCA (no species in the data) never draws them", () => {
    expect(build({ pcaStyle: { showSpecies: false } }).series.find((x) => x.id === "pca-species")).toBeUndefined();
    const noSpecies: PcaGraphData = { ...pca, loadings: [[0.9, 0.1], [0.2, 0.8], [0.1, 0.3]] };
    delete (noSpecies as { speciesScores?: unknown }).speciesScores;
    expect(build({}, noSpecies).series.find((x) => x.id === "pca-species")).toBeUndefined();
  });

  it("a loadings plot draws none — there are no cases there for a species to sit among", () => {
    const s = buildPlotScene(table, { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "pcaload", pca }, SIZE);
    expect(s.series.find((x) => x.id === "pca-species")).toBeUndefined();
  });
});
