/**
 * Add to graph ▸ Letters (CLD) decides, as data, either where the letters go or why they cannot:
 * the shell shows that reason on screen (not only in the activity log) when there is nothing to place.
 */
import { describe, expect, it } from "vitest";
import { MadyDocument } from "@mady/core";
import { planAnalysisLetters } from "./analysis";

function projectWith(kinds: string[]) {
  const doc = new MadyDocument();
  const t = doc.addTable("Groups", "xy", ["X", "Ctl", "Low", "High"]);
  const cols = t.columns.slice(1).map((c) => c.id);
  for (const k of kinds) doc.addPlot(`plot ${k}`, t.id);
  const project = doc.toJSON();
  project.plots.forEach((p, i) => { (p as { kind?: string }).kind = kinds[i]!; });
  project.analyses = [
    {
      id: "a1", name: "ANOVA", source: t.id, method: "anova", status: "ok", params: { columns: cols },
      result: {
        method: "anova", title: "ANOVA", summary: "s", glance: {},
        terms: [{ term: "Ctl vs Low", p: 0.2 }, { term: "Ctl vs High", p: 0.001 }, { term: "Low vs High", p: 0.01 }],
      },
    } as never,
  ];
  return project;
}

describe("planAnalysisLetters", () => {
  it("says why when no graph of this data can carry letters", () => {
    const r = planAnalysisLetters(projectWith([]), "a1");
    expect("reason" in r && r.reason).toMatch(/open a box, violin, or column-scatter graph/);
  });

  it("a bar graph cannot carry letters either, and says so", () => {
    const r = planAnalysisLetters(projectWith(["bar"]), "a1");
    expect("reason" in r && r.reason).toMatch(/box, violin, or column-scatter/);
  });

  it("on a box graph it returns one letter label per group, from the significant pairs", () => {
    const r = planAnalysisLetters(projectWith(["box"]), "a1");
    expect("plotId" in r).toBe(true);
    if ("plotId" in r) {
      expect(r.letters).toHaveLength(3);
      // Ctl and Low are not different; High differs from both → High shares no letter with them.
      const [ctl, low, high] = r.letters.map((l) => l.label);
      expect(ctl).toBe(low);
      expect(high).not.toBe(ctl);
    }
  });
});
