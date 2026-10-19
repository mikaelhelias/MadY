// @vitest-environment jsdom
// Publication bias as an Analyze method (Egger + trim-and-fill).
// The desktop side: the
// meta format's second statistic is reachable — goal-tile cover, dialog
// registries, the shared payload, prose, the rule-based next-step assistant's follow-up nudge, and the
// "Funnel + imputed studies" door on the result. The numbers are proven in
// engine.publicationbias.test.ts (engine ≡ core TS ≡ crosscheck.py's statsmodels OLS
// + stdlib trim-and-fill — three independent implementations).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { Analysis, DataTable, Project } from "@mady/core";
import { buildAnalysisData } from "@mady/core";
import { columnMode, defaultAnalysisName, METHOD_GROUPS, METHOD_INFO, ANALYSIS_GUIDANCE, VARIANT_GUIDANCE } from "./analysis";
import { COMMON_ANALYSES, DATA_TYPE_CARDS } from "./analyzeGoals";
import { buildCandidateSpecs, profileTable } from "./assistant";
import { AnalysisPane } from "./panes";

afterEach(cleanup);

/** A meta-format sheet: 4 studies, one with a blank CI (dropped from the payload). */
function metaTable(): DataTable {
  return {
    id: "tm", kind: "meta", name: "Trials",
    columns: [
      { id: "s", name: "Study", role: "x" },
      { id: "e", name: "Estimate", role: "y" },
      { id: "lo", name: "Lower", role: "y" },
      { id: "hi", name: "Upper", role: "y" },
    ],
    rows: [
      { id: "r1", cells: { s: "Anderson 2011", e: 0.82, lo: 0.64, hi: 1.05 } },
      { id: "r2", cells: { s: "Brown 2014", e: 1.14, lo: 0.9, hi: 1.44 } },
      { id: "r3", cells: { s: "Chen 2016", e: 0.67, lo: 0.49, hi: 0.92 } },
      { id: "r4", cells: { s: "Davis 2018", e: 0.95, lo: "", hi: "" } },
    ],
  };
}

describe("publication bias — the Analyze doors", () => {
  it("lives on the meta card and under the Meta-analysis goal tile's covers", () => {
    const card = DATA_TYPE_CARDS.find((c) => c.kind === "meta")!;
    expect(card.methods).toContain("publicationbias");
    const tile = COMMON_ANALYSES.find((g) => g.method === "metaanalysis")!;
    expect(tile.covers, "the meta goal tile must cover publicationbias (the compare-groups precedent)").toContain("publicationbias");
  });

  it("dialog registries: many-column mode, the Meta-analysis group, info, guidance, a name", () => {
    expect(columnMode("publicationbias")).toBe("many");
    expect(METHOD_GROUPS.some((g) => g.methods.includes("publicationbias"))).toBe(true);
    expect(METHOD_INFO["publicationbias"]).toBeTruthy();
    expect(ANALYSIS_GUIDANCE["publicationbias"]).toBeTruthy();
    expect(VARIANT_GUIDANCE["publicationbias:linear"]).toBeTruthy();
    expect(VARIANT_GUIDANCE["publicationbias:log"]).toBeTruthy();
    const name = defaultAnalysisName("publicationbias", { columns: ["e", "lo", "hi"], variant: "log" }, metaTable());
    expect(name).toMatch(/publication bias/i);
    expect(name).toMatch(/log/i);
  });

  it("the engine payload is the shared meta payload (same studies filter as the pooling)", () => {
    const bias = buildAnalysisData("publicationbias", { columns: ["e", "lo", "hi"], conf: 0.95 }, metaTable());
    const pool = buildAnalysisData("metaanalysis", { columns: ["e", "lo", "hi"], conf: 0.95 }, metaTable());
    expect(bias).toEqual(pool); // one payload — the two methods must agree on which studies exist
    const d = bias as { studies: { label: string }[]; log: boolean };
    expect(d.studies.length).toBe(3);
    expect(buildAnalysisData("publicationbias", { columns: ["e", "lo", "hi"], variant: "log", conf: 0.9 }, metaTable())).toMatchObject({ log: true, conf: 0.9 });
  });
});

describe("publication bias — the next-step assistant's follow-up nudge", () => {
  const project = (analyses: Analysis[]): Project =>
    ({ schemaVersion: 4, tables: [metaTable()], plots: [], analyses, log: [], workspace: { folders: [], loose: [] } });
  const pooled: Analysis = {
    id: "an_m", name: "Meta-analysis — Trials", method: "metaanalysis", source: "tm",
    params: { columns: ["e", "lo", "hi"], conf: 0.95 }, status: "ok",
  };

  it("appears only after a pooling exists, and only once", () => {
    const table = metaTable();
    const before = buildCandidateSpecs(project([]), table, undefined, profileTable(table), undefined);
    expect(before.some((s) => s.method === "publicationbias"), "nudged before any pooling exists").toBe(false);
    const after = buildCandidateSpecs(project([pooled]), table, undefined, profileTable(table), undefined);
    expect(after.some((s) => s.method === "publicationbias"), "no follow-up nudge after pooling").toBe(true);
    const both: Analysis = { ...pooled, id: "an_b", method: "publicationbias" };
    const done = buildCandidateSpecs(project([pooled, both]), table, undefined, profileTable(table), undefined);
    expect(done.some((s) => s.method === "publicationbias"), "nudged again after it was run").toBe(false);
  });
});

describe("publication bias — the result's plot door", () => {
  it("offers 'Funnel + imputed studies' and fires the door", () => {
    const analysis: Analysis = {
      id: "an_b", name: "Publication bias — Trials", method: "publicationbias", source: "tm",
      params: { columns: ["e", "lo", "hi"], conf: 0.95 }, status: "ok",
      result: {
        method: "publicationbias",
        title: "Publication bias (Egger + trim-and-fill)",
        terms: [
          { term: "Egger intercept (bias)", estimate: 1.2, se: 0.4, p: 0.02 },
          { term: "Adjusted pooled — fixed effect", estimate: 0.91, ciLow: 0.8, ciHigh: 1.03 },
        ],
        glance: { k: 3, "Egger p": 0.02 },
        summary: "Egger intercept 1.2 (p = 0.02).",
      },
    };
    const project: Project = { schemaVersion: 4, tables: [metaTable()], plots: [], analyses: [analysis], log: [], workspace: { folders: [], loose: [] } };
    const onPlotBiasFunnel = vi.fn();
    const { container } = render(<AnalysisPane project={project} analysisId={analysis.id} onRerun={vi.fn()} onPlotBiasFunnel={onPlotBiasFunnel} />);
    const menu = [...container.querySelectorAll("button")].find((b) => /add to graph/i.test(b.textContent ?? ""));
    expect(menu, "no 'Add to graph' menu on a publication-bias result").toBeTruthy();
    fireEvent.click(menu!);
    const btn = [...container.querySelectorAll("button")].find((b) => /imputed studies/i.test(b.textContent ?? ""));
    expect(btn, "no 'Funnel + imputed studies' button on a publication-bias result").toBeTruthy();
    fireEvent.click(btn!);
    expect(onPlotBiasFunnel).toHaveBeenCalledWith("an_b");
  });
});
