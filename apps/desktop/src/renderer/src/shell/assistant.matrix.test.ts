// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createSampleDocument } from "@mady/core";
import type { Project } from "@mady/core";
import { suggestAnalysisSteps } from "./assistant";
import type { Suggestion } from "./assistant";

/**
 * The whole suggestion surface, pinned.
 *
 * Suggestions are the app's front door to statistics, and a rule aimed at one kind of
 * sheet can change the suggestion for another: grouping by a row category, for example,
 * could make a treemap with one value per state propose a one-way ANOVA across regions
 * instead of descriptives. A per-case unit test does not see that; the whole matrix does. Every table and every
 * graph in the built-in sample project is listed here, so any change to the suggester
 * that moves any row fails and has to be justified rather than discovered by
 * the user.
 *
 * Change an entry only together with the reason the new suggestion is the right one; a changed
 * result on its own is not a reason.
 */
const EXPECTED: Record<string, string> = {
  // XY dose-response → the curve fit is the headline, association second.
  "TABLE Sample — dose vs response [xy]": "curvefit, correlation",
  "PLOT Dose-response [xy]": "curvefit, correlation",
  // Wide numeric matrix → multivariable exploration, whether the sheet or its
  // heatmap is selected.
  "TABLE Gene expression [xy]": "corrmatrix, pca",
  "PLOT Gene expression heatmap [heatmap]": "corrmatrix, pca",
  // Tidy sheet: four treatments held in rows → one-way ANOVA across the categories.
  "TABLE Treatment means [column]": "anova(RG)",
  "PLOT Treatment bar chart [bar]": "anova(RG)",
  // Groups as columns → the ordinary column-based ANOVA.
  "TABLE Replicate readouts [column]": "anova",
  "PLOT Dose-group violin [violin]": "anova",
  // One value per quarter: nothing to test, so descriptives only.
  "TABLE Quarterly scores [column]": "describe",
  "PLOT Quarterly lollipop [lollipop]": "describe",
  // Declared multivariable → the multivariable pair. Guards the outcome hint: it matches
  // `y` as a whole word only (a `y\b` match would treat "Granularity" as an outcome), so no
  // regression is proposed — none of Size/Granularity/Marker A/Marker B is one.
  "TABLE Cell profiling (PCA demo) [pca]": "pca, corrmatrix",
  // Parts-of-whole states shares of a total. Not a group comparison — this row guards
  // against row groups ignoring the sheet kind (which would read "anova(RG)").
  "TABLE US economy [partsofwhole]": "describe",
  "PLOT GDP treemap [treemap]": "describe",
  // A network edge list (Source/Target/Weight) has no standard test to recommend.
  // Deliberately empty: the top-level assistant still offers a generic "Analyze…",
  // and inventing a test here is the same mistake the treemap row guards against.
  "TABLE Immune signaling [xy]": "NONE",
  "PLOT Signaling network [network]": "NONE",
  // Two matched columns → a paired comparison. The paired-dot graph is
  // row-matched, so it reads as paired (like before-after) — the paired t test plus
  // its rank-based twin (Wilcoxon), the same pair a before-after graph gets, not an
  // independent Welch test. The variant is pinned below.
  "TABLE Heritability [column]": "ttest, ttest",
  "PLOT Heritability dot plot [paireddot]": "ttest, ttest",
};

const fmt = (s: Suggestion): string => `${s.method}${s.id.includes("rowgroup") ? "(RG)" : ""}`;

describe("analysis suggestions — the whole matrix", () => {
  // The demo project ships an analysis on six of its sheets, and the assistant hides work
  // already done — so the matrix is measured on the sample sheets as if un-analysed:
  // that is what a user's own fresh sheet of each shape is offered. The shipped state gets its
  // own case below.
  const shipped = createSampleDocument().toJSON() as unknown as Project;
  const project = { ...shipped, analyses: [] } as Project;

  it("suggests the same thing for a datasheet as for its graph, for every sample sheet", () => {
    const actual: Record<string, string> = {};
    for (const t of project.tables ?? []) {
      actual[`TABLE ${t.name} [${t.kind}]`] =
        suggestAnalysisSteps(project, { activeTableId: t.id }).map(fmt).join(", ") || "NONE";
      for (const p of (project.plots ?? []).filter((x) => x.source === t.id)) {
        actual[`PLOT ${p.name} [${p.kind ?? "xy"}]`] =
          suggestAnalysisSteps(project, { activePlotId: p.id }).map(fmt).join(", ") || "NONE";
      }
    }
    expect(actual).toEqual(EXPECTED);
  });

  it("the Heritability paired-dot graph proposes a paired test, not an independent one", () => {
    const dot = project.plots!.find((p) => p.kind === "paireddot")!;
    const rec = suggestAnalysisSteps(project, { activePlotId: dot.id }).find((s) => s.method === "ttest")!;
    expect(rec.variant).toBe("paired");
    // The datasheet borrows its graph's intent, so it says the same.
    expect(suggestAnalysisSteps(project, { activeTableId: dot.source }).find((s) => s.method === "ttest")!.variant).toBe("paired");
  });

  it("with the demo's own analyses in place the assistant moves on — never re-proposing the shipped method — and datasheet ≡ graph still holds", () => {
    expect(shipped.analyses.length).toBeGreaterThanOrEqual(6);
    for (const a of shipped.analyses) {
      const t = shipped.tables.find((x) => x.id === a.source)!;
      const forTable = suggestAnalysisSteps(shipped, { activeTableId: t.id }).map(fmt).join(", ") || "NONE";
      expect(forTable, `${t.name}: still proposes ${a.method}`).not.toContain(a.method);
      for (const p of (shipped.plots ?? []).filter((x) => x.source === t.id)) {
        const forPlot = suggestAnalysisSteps(shipped, { activePlotId: p.id }).map(fmt).join(", ") || "NONE";
        expect(forPlot, `${p.name} disagrees with its datasheet`).toBe(forTable);
      }
    }
  });

  it("never proposes a group comparison for parts-of-whole data", () => {
    const gdp = project.tables!.find((t) => t.kind === "partsofwhole")!;
    const methods = suggestAnalysisSteps(project, { activeTableId: gdp.id }).map((s) => s.method);
    for (const m of ["anova", "ttest", "rmanova", "equivalence"]) expect(methods).not.toContain(m);
  });
});

/**
 * The Analyze dialog is a picker and the assistant popover is a reminder. Only the reminder
 * hides work already done — hiding it in the dialog would make a dose-response fit vanish
 * from "Recommended for your data" as soon as one curve fit exists on the sheet.
 */
describe("analysis suggestions — already-run methods", () => {
  const project = createSampleDocument().toJSON() as unknown as Project;
  const dose = project.tables!.find((t) => t.name === "Sample — dose vs response")!;
  const plot = project.plots!.find((p) => p.source === dose.id)!;
  const withAnalysis = (status: string): Project =>
    ({ ...project, analyses: [{ id: "a1", name: "fit", source: dose.id, method: "curvefit", status }] }) as unknown as Project;

  it("the dialog keeps recommending a dose-response fit after one has been run", () => {
    const methods = suggestAnalysisSteps(withAnalysis("ok"), { activePlotId: plot.id }, { includeCompleted: true }).map((s) => s.method);
    expect(methods).toContain("curvefit");
  });

  it("the assistant stops suggesting it once it succeeded", () => {
    const methods = suggestAnalysisSteps(withAnalysis("ok"), { activePlotId: plot.id }).map((s) => s.method);
    expect(methods).not.toContain("curvefit");
  });

  it("a failed analysis does not count as done, in either surface", () => {
    expect(suggestAnalysisSteps(withAnalysis("error"), { activePlotId: plot.id }).map((s) => s.method)).toContain("curvefit");
  });
});
