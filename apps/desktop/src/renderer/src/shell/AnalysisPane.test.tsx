// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { Analysis, Project } from "@mady/core";
import { AnalysisPane } from "./panes";

afterEach(cleanup);

function projectWith(analysis: Analysis): Project {
  return { schemaVersion: 4, tables: [], plots: [], analyses: [analysis], log: [], workspace: { folders: [], loose: [] } };
}

const okAnalysis: Analysis = {
  id: "an_1",
  name: "Welch t — A vs B",
  method: "ttest",
  source: "t",
  params: { columns: ["a", "b"], variant: "welch" },
  status: "ok",
  result: {
    method: "ttest",
    title: "Unpaired t test (Welch)",
    terms: [
      { term: "Difference (A − B)", estimate: -3, statistic: -1.9, df: 5.9, p: 0.1075, ciLow: -6.7, ciHigh: 0.7 },
    ],
    glance: { t: -1.9, p: 0.1075 },
    summary: "The difference is not statistically significant (p = 0.1075).",
    assumptions: ["Welch's t does not assume equal variances."],
    cite: "Two-tailed test at α = 0.05.",
  },
};

function setup(analysis: Analysis) {
  const onRerun = vi.fn();
  const u = render(<AnalysisPane project={projectWith(analysis)} analysisId={analysis.id} onRerun={onRerun} />);
  return { ...u, onRerun };
}

describe("AnalysisPane", () => {
  it("renders the tidy table, summary, assumptions, and cite", () => {
    const d = setup(okAnalysis);
    expect(d.container.querySelector(".tidytable")).toBeTruthy();
    expect(d.container.textContent).toContain("Difference (A − B)");
    expect(d.container.textContent).toContain("not statistically significant");
    expect(d.container.textContent).toContain("Welch's t does not assume equal variances.");
  });

  it("formats a tiny p-value as <0.0001", () => {
    const a: Analysis = { ...okAnalysis, result: { ...okAnalysis.result!, terms: [{ term: "x", p: 0.00000001 }] } };
    expect(setup(a).container.textContent).toContain("<0.0001");
  });

  it("shows a stale badge + note when the source changed", () => {
    const d = setup({ ...okAnalysis, status: "stale" });
    expect(d.container.querySelector(".badge-warn")).toBeTruthy();
    expect(d.container.textContent).toContain("source data changed");
  });

  it("shows the error message in an error state", () => {
    const d = setup({ ...okAnalysis, status: "error", error: "need two groups", result: undefined });
    expect(d.container.querySelector(".badge-err")).toBeTruthy();
    expect(d.container.textContent).toContain("need two groups");
  });

  it("Re-run fires the callback with the analysis id", () => {
    const d = setup(okAnalysis);
    // By name, not by class — the toolbar's styling hooks are free to change.
    fireEvent.click([...d.container.querySelectorAll("button")].find((b) => b.textContent === "Re-run")!);
    expect(d.onRerun).toHaveBeenCalledWith("an_1");
  });

  it("Save as Method fires onSaveMethod with the analysis id (only when wired)", () => {
    const onSaveMethod = vi.fn();
    const { container, rerender } = render(
      <AnalysisPane project={projectWith(okAnalysis)} analysisId={okAnalysis.id} onRerun={vi.fn()} onSaveMethod={onSaveMethod} />,
    );
    const btn = [...container.querySelectorAll("button")].find((b) => b.textContent === "Save as Method");
    expect(btn).toBeTruthy();
    fireEvent.click(btn!);
    expect(onSaveMethod).toHaveBeenCalledWith("an_1");
    // Not rendered without the callback.
    rerender(<AnalysisPane project={projectWith(okAnalysis)} analysisId={okAnalysis.id} onRerun={vi.fn()} />);
    expect([...container.querySelectorAll("button")].some((b) => b.textContent === "Save as Method")).toBe(false);
  });

  it("shows a Validated badge for a validated method; clicking copies a citeable statement", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const d = setup(okAnalysis); // method "ttest" → validated + cross-checked
    const badge = [...d.container.querySelectorAll("button")].find((b) => b.className.includes("valbadge"));
    expect(badge).toBeTruthy();
    expect(badge!.textContent).toContain("Validated");
    fireEvent.click(badge!);
    expect(writeText).toHaveBeenCalled();
    expect(String(writeText.mock.calls[0]![0])).toContain("Welch t"); // the analysis name is in the statement
  });

  it("shows no validation badge for a method with no validation record", () => {
    const d = setup({ ...okAnalysis, method: "mystery_method" });
    expect([...d.container.querySelectorAll("button")].some((b) => b.className.includes("valbadge"))).toBe(false);
  });

  it("drafts editable Methods & Results prose on demand (opt-in, never auto-inserted)", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const d = setup(okAnalysis);
    // The panel stays hidden until it is asked for.
    expect(d.container.querySelector(".prosepanel")).toBeNull();
    // One toggle button ("Methods text"), pressed-state styled, rather than a pair of
    // Draft…/Hide… labels.
    const draftBtn = [...d.container.querySelectorAll("button")].find((b) => b.textContent === "Methods text")!;
    expect(draftBtn).toBeTruthy();
    fireEvent.click(draftBtn);
    // The editable draft appears with a Methods paragraph + a Results sentence.
    const ta = d.container.querySelector(".prosepanel-text") as HTMLTextAreaElement;
    expect(ta).toBeTruthy();
    expect(ta.value).toContain("Methods");
    expect(ta.value).toContain("was used to compare the means of the two groups");
    expect(ta.value).toContain("Results");
    expect(ta.value).toContain("t(5.9) = -1.9");
    // Copy pushes the draft to the clipboard.
    fireEvent.click([...d.container.querySelectorAll(".prosepanel button")].find((b) => b.textContent === "Copy")!);
    expect(writeText).toHaveBeenCalledWith(ta.value);
    // Toggling again hides it.
    fireEvent.click([...d.container.querySelectorAll("button")].find((b) => b.textContent === "Methods text")!);
    expect(d.container.querySelector(".prosepanel")).toBeNull();
  });

  it("offers no Draft-methods button before the analysis has run", () => {
    const d = setup({ ...okAnalysis, status: "error", error: "no data", result: undefined });
    expect([...d.container.querySelectorAll("button")].some((b) => b.textContent === "Draft methods text")).toBe(false);
  });

  it("renders a correlation matrix as a tinted heat-grid", () => {
    const corr: Analysis = {
      ...okAnalysis,
      method: "corrmatrix",
      result: {
        method: "corrmatrix",
        title: "Correlation matrix (Pearson r)",
        terms: [{ term: "A vs B", estimate: 0.88, p: 0.02 }],
        glance: { variables: 2 },
        summary: "2 variables.",
        extra: { matrix: { labels: ["A", "B"], r: [[1, 0.88], [0.88, 1]], r2: [[1, 0.77], [0.77, 1]] } },
      },
    };
    const d = setup(corr);
    const grid = d.container.querySelector(".corrmatrix");
    expect(grid).toBeTruthy();
    // diagonal 1.00 + off-diagonal 0.88 cells are present
    expect(grid!.textContent).toContain("1.00");
    expect(grid!.textContent).toContain("0.88");
    // a positive correlation cell is tinted red (rgba), not transparent
    const tinted = [...grid!.querySelectorAll("td.tidynum")].find((td) =>
      /rgba\(200, 64, 52/.test((td as HTMLElement).style.background),
    );
    expect(tinted).toBeTruthy();
  });

  it("renders a model-comparison result with AICc, both models, and the F-test rows", () => {
    // The exact shape engine.comparefits emits (3PL vs 4PL on true-4PL data).
    const cmp: Analysis = {
      ...okAnalysis,
      method: "comparefits",
      name: "Compare models — 3PL vs 4PL",
      result: {
        method: "comparefits",
        title: "Compare models — Dose-response (3PL, fixed slope) vs Dose-response (4PL, variable slope)",
        terms: [
          { term: "Dose-response (3PL, fixed slope)", aicc: 55.78, sse: 461.8, df: 8, params: 3, r2: 0.9789, bic: 50.7, probability: 0 },
          { term: "Dose-response (4PL, variable slope)", aicc: 7.43, sse: 2.92, df: 7, params: 4, r2: 0.9999, bic: -2.58, probability: 1 },
          { term: "ΔAICc", estimate: 48.35 },
          { term: "Preferred (lower AICc)", estimate: "Dose-response (4PL, variable slope)", probability: 1 },
          { term: "Extra-SS F", estimate: 1098.3, df: "1, 7", p: 0 },
          { term: "F-test prefers (α=0.05)", estimate: "Dose-response (4PL, variable slope)" },
        ],
        glance: { n: 11, preferred: "4pl", delta_aicc: 48.35, prob_b: 1 },
        summary: "AICc prefers Dose-response (4PL, variable slope) (ΔAICc = 48.3; P = 100.0%). Extra-SS F(1,7) = 1098, P = 0.",
        assumptions: ["Both models fit to the same 11 points by nonlinear least squares."],
        cite: "Akaike's information criterion (AICc) and the extra-sum-of-squares F test.",
      },
    };
    const d = setup(cmp);
    const tbl = d.container.querySelector(".tidytable");
    expect(tbl).toBeTruthy();
    // The AICc column header + both candidate model rows render.
    expect(tbl!.textContent).toContain("AICc");
    expect(tbl!.textContent).toContain("Dose-response (3PL, fixed slope)");
    expect(tbl!.textContent).toContain("Dose-response (4PL, variable slope)");
    // The verdict rows render: ΔAICc, the extra-SS F test, and the preferred model.
    expect(tbl!.textContent).toContain("ΔAICc");
    expect(tbl!.textContent).toContain("Extra-SS F");
    expect(tbl!.textContent).toContain("Preferred (lower AICc)");
    // Headline summary surfaces the AICc verdict.
    expect(d.container.textContent).toContain("AICc prefers");
  });
});

describe("AnalysisPane — significance markers are bound to the analysis", () => {
  /** A result with real pairwise rows, which is what the binding keys off. */
  const pairwise: Analysis = {
    id: "an_p",
    name: "One-way ANOVA",
    method: "anova",
    source: "t",
    params: { columns: ["a", "b", "c"] },
    status: "ok",
    result: {
      method: "anova",
      title: "One-way ANOVA",
      terms: [
        { term: "Vehicle vs Drug A", p: 0.002 },
        { term: "Vehicle vs Drug B", p: 0.03 },
        { term: "Drug A vs Drug B", p: 0.4 },
      ],
      glance: { p: 0.002 },
      summary: "At least one group differs.",
      assumptions: [],
      cite: "",
    },
  };
  const binding = (over: Partial<Parameters<typeof AnalysisPane>[0]["bracketBinding"] & object> = {}) => ({
    on: false,
    control: undefined,
    groups: ["Vehicle", "Drug A", "Drug B"],
    toggle: vi.fn(),
    setControl: vi.fn(),
    ...over,
  });
  const pane = (b: ReturnType<typeof binding>) =>
    render(<AnalysisPane project={projectWith(pairwise)} analysisId={pairwise.id} onRerun={vi.fn()} onAddBrackets={vi.fn()} bracketBinding={b} />);

  it("shows a tick-box whose state IS whether markers are on the graph", () => {
    const off = pane(binding());
    const box = off.container.querySelector<HTMLInputElement>('.anbind input[type="checkbox"]')!;
    expect(box, "no significance tick-box rendered").toBeTruthy();
    expect(box.checked).toBe(false);
    cleanup();
    const on = pane(binding({ on: true }));
    expect(on.container.querySelector<HTMLInputElement>('.anbind input[type="checkbox"]')!.checked).toBe(true);
  });

  it("ticking asks for the markers; unticking asks for them to go", () => {
    const b = binding();
    const { container } = pane(b);
    const box = container.querySelector<HTMLInputElement>('.anbind input[type="checkbox"]')!;
    fireEvent.click(box);
    expect(b.toggle).toHaveBeenCalledWith(true);
    cleanup();
    const b2 = binding({ on: true });
    const u2 = pane(b2);
    fireEvent.click(u2.container.querySelector<HTMLInputElement>('.anbind input[type="checkbox"]')!);
    expect(b2.toggle).toHaveBeenCalledWith(false);
  });

  it("offers every group as a reference, and 'all pairs' as the default", () => {
    const { container } = pane(binding());
    const sel = container.querySelector<HTMLSelectElement>(".anbind select")!;
    expect([...sel.options].map((o) => o.textContent)).toEqual(["all pairs", "vs Vehicle", "vs Drug A", "vs Drug B"]);
    expect(sel.value).toBe(""); // all pairs
  });

  it("choosing a reference reports the name; choosing 'all pairs' reports undefined", () => {
    const b = binding();
    const { container } = pane(b);
    const sel = container.querySelector<HTMLSelectElement>(".anbind select")!;
    fireEvent.change(sel, { target: { value: "Vehicle" } });
    expect(b.setControl).toHaveBeenCalledWith("Vehicle");
    cleanup();
    const b2 = binding({ control: "Vehicle" });
    const u2 = pane(b2);
    fireEvent.change(u2.container.querySelector<HTMLSelectElement>(".anbind select")!, { target: { value: "" } });
    expect(b2.setControl).toHaveBeenCalledWith(undefined);
  });

  it("says what a control comparison is — a filter, not a different test", () => {
    // The caveat: the p-values keep whatever correction the test applied. Without
    // it, picking a control looks like it re-ran the statistics.
    const { container } = pane(binding({ control: "Vehicle" }));
    expect(container.querySelector(".anbind-note")?.textContent).toMatch(/filter/i);
    cleanup();
    expect(pane(binding()).container.querySelector(".anbind-note")).toBeNull();
  });

  it("no binding offered (no graph can carry markers) → no dead control", () => {
    const { container } = render(
      <AnalysisPane project={projectWith(pairwise)} analysisId={pairwise.id} onRerun={vi.fn()} onAddBrackets={vi.fn()} />,
    );
    expect(container.querySelector(".anbind")).toBeNull();
  });
});
