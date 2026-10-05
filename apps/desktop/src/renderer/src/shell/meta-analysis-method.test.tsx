// @vitest-environment jsdom
// Meta-analysis as an Analyze method.
// The desktop half: the meta format's statistic is reachable — goal tile, dialog registries,
// payload, prose, the assistant's suggestion (pooling, never a group comparison such as an
// ANOVA), and the "Plot forest + funnel" entry on the result. The numbers are proven in
// engine.metaanalysis.test.ts (engine ≡ core TS ≡ the
// crosscheck.py statsmodels oracle — three independent implementations).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { Analysis, DataTable, Project } from "@mady/core";
import { buildAnalysisData, TABLE_FORMATS } from "@mady/core";
import { columnMode, defaultAnalysisName, METHOD_GROUPS, METHOD_INFO } from "./analysis";
import { COMMON_ANALYSES, DATA_TYPE_CARDS } from "./analyzeGoals";
import { buildCandidateSpecs, profileTable } from "./assistant";
import { AnalysisPane } from "./panes";

afterEach(cleanup);

/** A meta-format sheet: 4 studies, one with a blank CI (must be dropped from the payload). */
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

describe("meta-analysis — the Analyze doors", () => {
  it("the meta format unlocks it (a real method, not a NO_STATISTICS entry)", () => {
    // "Publication bias" (the Egger + trim-and-fill test) is the second entry — the pin
    // guards against anything else creeping onto a meta sheet.
    expect(TABLE_FORMATS.meta.analyses).toEqual(["Meta-analysis (pool studies)", "Publication bias (Egger + trim-and-fill)"]);
    const card = DATA_TYPE_CARDS.find((c) => c.kind === "meta");
    expect(card, "no meta data-type card").toBeTruthy();
    expect(card!.methods).toEqual(["metaanalysis", "publicationbias"]);
    expect(COMMON_ANALYSES.some((g) => g.method === "metaanalysis")).toBe(true);
  });

  it("dialog registries: many-column mode, its own method group, method info, a name", () => {
    expect(columnMode("metaanalysis")).toBe("many");
    expect(METHOD_GROUPS.some((g) => g.methods.includes("metaanalysis"))).toBe(true);
    expect(METHOD_INFO["metaanalysis"]).toBeTruthy();
    const name = defaultAnalysisName("metaanalysis", { columns: ["e", "lo", "hi"], variant: "log" }, metaTable());
    expect(name).toMatch(/meta-analysis/i);
  });
});

describe("meta-analysis — the engine payload", () => {
  it("studies come from the three positional columns with the Study labels; incomplete rows drop", () => {
    const d = buildAnalysisData("metaanalysis", { columns: ["e", "lo", "hi"], conf: 0.95 }, metaTable()) as {
      studies: { est: number; lo: number; hi: number; label: string }[];
      conf: number;
      log: boolean;
    };
    expect(d.studies.length).toBe(3); // Davis 2018 has no CI → dropped here, counted in the engine's note
    expect(d.studies[0]).toEqual({ est: 0.82, lo: 0.64, hi: 1.05, label: "Anderson 2011" });
    expect(d.conf).toBe(0.95);
    expect(d.log).toBe(false);
  });

  it("the log variant rides the payload (ratio measures pool in log space)", () => {
    const d = buildAnalysisData("metaanalysis", { columns: ["e", "lo", "hi"], variant: "log", conf: 0.9 }, metaTable()) as { log: boolean; conf: number };
    expect(d.log).toBe(true);
    expect(d.conf).toBe(0.9);
  });
});

describe("meta-analysis — the assistant's suggestion fits the data", () => {
  it("a meta sheet suggests pooling — and never a group comparison", () => {
    const table = metaTable();
    const project: Project = { schemaVersion: 4, tables: [table], plots: [], analyses: [], log: [], workspace: { folders: [], loose: [] } };
    const specs = buildCandidateSpecs(project, table, undefined, profileTable(table), undefined);
    expect(specs.some((s) => s.method === "metaanalysis"), "no meta-analysis suggestion on a meta sheet").toBe(true);
    expect(specs.some((s) => s.method === "ttest" || s.method === "anova"), "a meta sheet suggests a group comparison").toBe(false);
  });
});

describe("meta-analysis — the result's plot door", () => {
  it("a metaanalysis result offers 'Plot forest + funnel' and fires the door", () => {
    const analysis: Analysis = {
      id: "an_m", name: "Meta-analysis — Trials", method: "metaanalysis", source: "tm",
      params: { columns: ["e", "lo", "hi"], conf: 0.95 }, status: "ok",
      result: {
        method: "metaanalysis",
        title: "Meta-analysis (inverse variance)",
        terms: [
          { term: "Anderson 2011", estimate: 0.82, ciLow: 0.64, ciHigh: 1.05 },
          { term: "Pooled — fixed effect", estimate: 0.85, ciLow: 0.74, ciHigh: 0.98, p: 0.02 },
        ],
        glance: { k: 3 },
        summary: "Pooled effect 0.85.",
      },
    };
    const project: Project = { schemaVersion: 4, tables: [metaTable()], plots: [], analyses: [analysis], log: [], workspace: { folders: [], loose: [] } };
    const onPlotMeta = vi.fn();
    const { container } = render(<AnalysisPane project={project} analysisId={analysis.id} onRerun={vi.fn()} onPlotMeta={onPlotMeta} />);
    // The graph doors live in the "Add to graph ▾" menu — open it first.
    const menu = [...container.querySelectorAll("button")].find((b) => /add to graph/i.test(b.textContent ?? ""));
    expect(menu, "no 'Add to graph' menu on a meta-analysis result").toBeTruthy();
    fireEvent.click(menu!);
    const btn = [...container.querySelectorAll("button")].find((b) => /forest \+ funnel/i.test(b.textContent ?? ""));
    expect(btn, "no 'Plot forest + funnel' button on a meta-analysis result").toBeTruthy();
    fireEvent.click(btn!);
    expect(onPlotMeta).toHaveBeenCalledWith("an_m");
  });
});
