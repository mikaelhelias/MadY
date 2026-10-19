// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { DataTable } from "@mady/core";
import { buildAnalysisData, createSampleDocument } from "@mady/core";
import { AnalyzeDialog, ttestVsControlSpec, VARIANTS } from "./AnalyzeDialog";
import { METHOD_GROUPS, variantGuidance } from "./analysis";
import { getAnalysisDefault, setAnalysisDefault } from "./profile";

afterEach(cleanup);

// X column + two Y datasets (so two-group / ANOVA / correlation have real choices).
const table: DataTable = {
  id: "t",
  kind: "xy",
  name: "Sample",
  columns: [
    { id: "x", name: "Dose" },
    { id: "a", name: "Drug A" },
    { id: "b", name: "Drug B" },
  ],
  rows: [],
};

function setup(showCatalog = true) {
  const onRun = vi.fn();
  const onCancel = vi.fn();
  const u = render(<AnalyzeDialog table={table} onRun={onRun} onCancel={onCancel} />);
  if (showCatalog) fireEvent.click([...u.container.querySelectorAll("button")].find((b) => b.textContent === "Browse all analyses") as HTMLButtonElement);
  const runBtn = () => u.container.querySelector(".btn") as HTMLButtonElement;
  const sel = (label: string) => u.container.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement;
  // The dialog opens on the landing chooser; click an analysis to reach the configure view.
  const open = (method: string) =>
    fireEvent.click(u.container.querySelector(`[data-method="${method}"]`) as HTMLButtonElement);
  const openTypePicker = () => fireEvent.click(u.container.querySelector('button[aria-label="Type"]') as HTMLButtonElement);
  const chooseCurveModel = (id: string) => {
    openTypePicker();
    fireEvent.click(u.container.querySelector(`.an-model-row[data-variant="${id}"] .an-model-main`) as HTMLButtonElement);
  };
  const curveModelIds = () => [...u.container.querySelectorAll(".an-model-row")].map((row) => row.getAttribute("data-variant"));
  return { ...u, onRun, onCancel, runBtn, sel, open, openTypePicker, chooseCurveModel, curveModelIds };
}

// Every selectable type should have a variant-specific description (not just method-level text).
// Scoped to the non-curve methods; the curve-fit families and the derived methods take their
// description from the curve-fit fallback.
describe("variant guidance coverage", () => {
  it("every selectable variant of every method has a structured description (via the curvefit fallback for derived methods)", () => {
    for (const method of Object.keys(VARIANTS)) {
      for (const v of VARIANTS[method] ?? []) {
        const g = variantGuidance(method, v.id);
        expect(g, `${method}:${v.id} guidance`).toBeDefined();
        expect(g!.explain.length, `${method}:${v.id} explain`).toBeGreaterThan(20);
        expect(g!.whenToUse.length, `${method}:${v.id} whenToUse`).toBeGreaterThan(20);
        expect(g!.assumptions.length, `${method}:${v.id} assumptions`).toBeGreaterThan(0);
        expect(g!.warnings.length, `${method}:${v.id} warnings`).toBeGreaterThan(0);
      }
    }
  });
});

describe("AnalyzeDialog — designate a control on the t-test path (each group vs control in one run)", () => {
  // A control field lives on the t test itself, so the comparison is offered where a user comparing
  // groups starts, not only under ANOVA. "Each group vs one control, corrected" is a one-way post-hoc:
  // Dunnett for Student (equal variance), Games-Howell for Welch (unequal). Both are cross-checked.
  const threeGroups: DataTable = {
    id: "t3", kind: "column", name: "Groups",
    columns: [{ id: "lab", name: "L" }, { id: "a", name: "Control" }, { id: "b", name: "Drug 1" }, { id: "c", name: "Drug 2" }],
    rows: [
      { id: "r0", cells: { lab: "1", a: 10, b: 12, c: 15 } },
      { id: "r1", cells: { lab: "2", a: 11, b: 13, c: 16 } },
      { id: "r2", cells: { lab: "3", a: 9, b: 14, c: 17 } },
    ],
  };
  const openTtest = (onRun: () => void, variant = "unpaired") => {
    const u = render(<AnalyzeDialog table={threeGroups} onRun={onRun} onCancel={vi.fn()} />);
    fireEvent.click([...u.container.querySelectorAll("button")].find((b) => b.textContent === "Browse all analyses") as HTMLButtonElement);
    fireEvent.click(u.container.querySelector('[data-method="ttest"]') as HTMLButtonElement);
    fireEvent.change(u.container.querySelector('select[aria-label="Type"]') as HTMLSelectElement, { target: { value: variant } });
    return u;
  };
  const compareBtn = (c: HTMLElement) => [...c.querySelectorAll("button")].find((b) => /Compare every group to/.test(b.textContent ?? "")) as HTMLButtonElement;

  it("ttestVsControlSpec maps the t-test variant to the matching multiple-vs-control test", () => {
    expect(ttestVsControlSpec({ variant: "unpaired", columns: ["a", "b", "c"], controlIndex: 0, conf: 0.95 }))
      .toEqual({ method: "anova", variant: "anova", columns: ["a", "b", "c"], conf: 0.95, posthoc: "dunnett", scheme: "vs-control", control: 0 });
    expect(ttestVsControlSpec({ variant: "welch", columns: ["a", "b", "c"], controlIndex: 2, conf: 0.9 }).posthoc).toBe("games-howell");
    // No valid control index → the first group, never a negative index into `columns`.
    expect(ttestVsControlSpec({ variant: "welch", columns: ["a"], controlIndex: -1, conf: 0.95 }).control).toBe(0);
  });

  it("offers a Control group field on the (Student) t-test and runs each group vs it in one shot", () => {
    const onRun = vi.fn();
    const u = openTtest(onRun, "unpaired");
    const ctrl = u.container.querySelector('select[aria-label="Control group (t test)"]') as HTMLSelectElement | null;
    expect(ctrl, "no control field on a 3-group t-test").toBeTruthy();
    expect([...ctrl!.options].map((o) => o.textContent)).toEqual(["Control", "Drug 1", "Drug 2"]);
    fireEvent.change(ctrl!, { target: { value: "b" } }); // designate "Drug 1" (index 1) as the control
    fireEvent.click(compareBtn(u.container));
    expect(onRun).toHaveBeenCalledTimes(1);
    expect(onRun.mock.calls[0]![0]).toEqual({ method: "anova", variant: "anova", columns: ["a", "b", "c"], conf: 0.95, posthoc: "dunnett", scheme: "vs-control", control: 1 });
  });

  it("a Welch t maps the same field to Games-Howell vs control", () => {
    const onRun = vi.fn();
    const u = openTtest(onRun, "welch");
    fireEvent.click(compareBtn(u.container));
    expect(onRun.mock.calls[0]![0].posthoc).toBe("games-howell");
    expect(onRun.mock.calls[0]![0].scheme).toBe("vs-control");
  });

  it("a 2-group t-test shows NO control field — there is nothing to compare against a control", () => {
    const two: DataTable = { ...threeGroups, columns: threeGroups.columns.slice(0, 3) }; // lab, a, b
    const u = render(<AnalyzeDialog table={two} onRun={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click([...u.container.querySelectorAll("button")].find((b) => b.textContent === "Browse all analyses") as HTMLButtonElement);
    fireEvent.click(u.container.querySelector('[data-method="ttest"]') as HTMLButtonElement);
    expect(u.container.querySelector('select[aria-label="Control group (t test)"]')).toBeNull();
  });
});

describe("AnalyzeDialog", () => {
  it("keeps the guided landing separate from the expert catalog", () => {
    const d = setup(false);
    expect(d.container.querySelector('[aria-label="Choose what you want to do"]')).toBeTruthy();
    expect(d.container.querySelector('button')).toBeTruthy();
    expect(d.container.querySelector('[aria-label="Choose by data type"]')).toBeNull();
    fireEvent.click([...d.container.querySelectorAll("button")].find((b) => b.textContent === "Browse all analyses") as HTMLButtonElement);
    expect(d.container.querySelector('[aria-label="Choose by data type"]')).toBeTruthy();
  });

  it("the expert catalog exposes every registered analysis method", () => {
    const d = setup();
    const expected = new Set(METHOD_GROUPS.flatMap((g) => g.methods)).size;
    expect(d.container.querySelectorAll("[data-method]").length).toBe(expected);
  });

  it("the landing shows a data-type card per format, badging the current table's kind", () => {
    const d = setup();
    // 9 data-type cards render (one per card-bearing TableKind, meta included); the XY
    // table's card is badged "Your data".
    // (Scoped to the data-type grid — the by-purpose "Common analyses" grid also uses .an-card.)
    expect(d.container.querySelectorAll('[aria-label="Choose by data type"] .an-card').length).toBe(9);
    const current = d.container.querySelector(".an-card.is-current");
    expect(current).toBeTruthy();
    expect(current!.textContent).toContain("XY");
    expect(current!.querySelector(".an-card-badge")!.textContent).toContain("Your data");
  });

  it("does not show recommendations when none are supplied", () => {
    const d = setup();
    expect(d.container.querySelector('[aria-label="Recommended for your data"]')).toBeNull();
  });

  it("recommends a type for a non-curve method in the picker (t-test → Mann-Whitney on skewed data)", () => {
    // a=[2,3,3,4,4,40] carries a clear outlier → a rank-based test is recommended over Welch
    const skew: DataTable = {
      id: "t", kind: "column", name: "S",
      columns: [{ id: "lab", name: "L" }, { id: "a", name: "A" }, { id: "b", name: "B" }],
      rows: [
        { id: "r0", cells: { lab: "1", a: 2, b: 3 } }, { id: "r1", cells: { lab: "2", a: 3, b: 4 } },
        { id: "r2", cells: { lab: "3", a: 3, b: 4 } }, { id: "r3", cells: { lab: "4", a: 4, b: 5 } },
        { id: "r4", cells: { lab: "5", a: 4, b: 5 } }, { id: "r5", cells: { lab: "6", a: 40, b: 45 } },
      ],
    };
    const u = render(<AnalyzeDialog table={skew} onRun={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click([...u.container.querySelectorAll("button")].find((b) => b.textContent === "Browse all analyses") as HTMLButtonElement);
    fireEvent.click(u.container.querySelector('[data-method="ttest"]') as HTMLButtonElement);
    fireEvent.click(u.container.querySelector('button[aria-label="Choose analysis variant"]') as HTMLButtonElement);
    const rec = u.container.querySelector('[aria-label="Recommended for this data"]');
    expect(rec).toBeTruthy();
    const firstRow = rec!.querySelector(".an-model-row");
    expect(firstRow?.getAttribute("data-variant")).toBe("mann-whitney");
    expect(firstRow!.querySelector(".an-model-badge")?.textContent).toBe("recommended");
    expect(firstRow!.querySelector(".an-model-conf")).toBeTruthy(); // confidence chip on the recommended row
  });

  it("shows recommendations and opens one preconfigured", () => {
    const onRun = vi.fn();
    const rec = {
      id: "analysis:t:ttest:welch",
      kind: "analysis" as const,
      text: "This looks ready for a two-group comparison.",
      cta: "Configure Welch test",
      actionId: "analyze",
      method: "ttest",
      variant: "welch",
      columns: ["a", "b"],
      confidence: "high" as const,
      reasons: ["Two usable numeric groups were detected."],
      caveats: ["Check pairing before using paired tests."],
      assumptions: ["Groups are independent."],
      alternatives: ["Mann-Whitney for ordinal data."],
    };
    const u = render(<AnalyzeDialog table={table} onRun={onRun} onCancel={vi.fn()} recommendations={[rec]} />);
    expect(u.container.querySelector('[aria-label="Recommended for your data"]')).toBeTruthy();
    fireEvent.click(u.container.querySelector(".an-rec-head") as HTMLButtonElement);
    expect(u.container.textContent).toContain("Why this");
    expect(u.container.textContent).toContain("Check before running");
    expect(u.container.textContent).toContain("Other reasonable choices");
    fireEvent.click([...u.container.querySelectorAll("button")].find((b) => b.textContent === "Configure") as HTMLButtonElement);
    expect((u.container.querySelector('select[aria-label="Test"]') as HTMLSelectElement).value).toBe("ttest");
    expect((u.container.querySelector('select[aria-label="Type"]') as HTMLSelectElement).value).toBe("welch");
    fireEvent.click(u.container.querySelector(".btn") as HTMLButtonElement);
    expect(onRun).toHaveBeenCalledWith({ method: "ttest", variant: "welch", columns: ["a", "b"], conf: 0.95 });
  });
  it("asks for pairing before opening an ambiguous comparison recommendation", () => {
    const rec = {
      id: "analysis:t:ttest:possible-paired",
      kind: "analysis" as const,
      text: "This may be paired, but confirm the design.",
      cta: "Review two-group options",
      actionId: "analyze",
      method: "ttest",
      variant: "welch",
      columns: ["a", "b"],
      confidence: "low" as const,
      reasons: ["The graph suggests before-after structure."],
      question: {
        prompt: "Are these rows matched?",
        choices: [
          { id: "independent", label: "Independent groups", method: "ttest", variant: "welch" },
          { id: "paired", label: "Paired rows", method: "ttest", variant: "paired" },
        ],
      },
    };
    const u = render(<AnalyzeDialog table={table} onRun={vi.fn()} onCancel={vi.fn()} recommendations={[rec]} />);
    fireEvent.click(u.container.querySelector(".an-rec-head") as HTMLButtonElement);
    expect(u.container.textContent).toContain("Are these rows matched?");
    fireEvent.click([...u.container.querySelectorAll("button")].find((b) => b.textContent === "Paired rows") as HTMLButtonElement);
    expect((u.container.querySelector('select[aria-label="Type"]') as HTMLSelectElement).value).toBe("paired");
  });
  it("shows the by-purpose 'Common analyses' tiles; a domain tile opens a scoped config", () => {
    const d = setup(false);
    const goals = d.container.querySelectorAll(".an-goals .an-goal");
    // 10 core tiles + Contingency and Proportions + Meta-analysis, so every
    // datasheet kind has at least one tile that fits it (see analyzeGoals.test.ts),
    // + Melting temperature (its own analysis).
    expect(goals.length).toBe(14);
    const dr = [...goals].find((g) => /Dose-response/.test(g.textContent ?? ""));
    expect(dr).toBeTruthy();
    fireEvent.click(dr!);
    // Jumps to the configure view: curve fit, scoped to the Dose-response family, with the guided banner.
    const testSel = d.container.querySelector('select[aria-label="Test"]') as HTMLSelectElement;
    expect(testSel.value).toBe("curvefit");
    const famSel = d.container.querySelector('select[aria-label="Equation family"]') as HTMLSelectElement;
    expect(famSel.value).toBe("Dose-response");
    expect(d.container.textContent).toContain("EC50 / IC50 curve fit"); // the focus banner title
  });

  it("clicking a data-type card filters the analysis list to that data type", () => {
    const d = setup();
    // Unfiltered: t test (column) and correlation (xy) both listed.
    expect(d.container.querySelector('[data-method="ttest"]')).toBeTruthy();
    expect(d.container.querySelector('[data-method="correlation"]')).toBeTruthy();
    // Click the XY card → only XY analyses remain.
    const xyCard = [...d.container.querySelectorAll(".an-card")].find(
      (c) => c.querySelector(".an-card-h")?.textContent === "XY",
    )!;
    fireEvent.click(xyCard as HTMLButtonElement);
    expect(d.container.querySelector('[data-method="correlation"]')).toBeTruthy();
    expect(d.container.querySelector('[data-method="ttest"]')).toBeNull();
  });

  it("the landing Details button reveals the analysis explanation in place", () => {
    const d = setup();
    expect(d.container.querySelector(".aninfo")).toBeNull(); // collapsed by default
    const row = d.container.querySelector('[data-method="ttest"]')!.closest(".an-item")!;
    fireEvent.click(row.querySelector(".an-detailsbtn") as HTMLButtonElement);
    expect(row.querySelector(".aninfo")).toBeTruthy();
  });

  it("defaults to descriptives on the first dataset → run payload", () => {
    const d = setup();
    d.open("describe");
    fireEvent.click(d.runBtn());
    expect(d.onRun).toHaveBeenCalledWith({ method: "describe", columns: ["a"], conf: 0.95 }); // first dataset
  });

  it("two-group t-test runs on two datasets (X is not a group)", () => {
    const d = setup();
    d.open("ttest");
    expect(d.sel("Type")).toBeTruthy();
    fireEvent.click(d.runBtn());
    expect(d.onRun).toHaveBeenCalledWith({ method: "ttest", variant: "unpaired", columns: ["a", "b"], conf: 0.95 });
  });

  it("one-tailed t-test adds tail to the run payload (two-sided omits it)", () => {
    const d = setup();
    d.open("ttest");
    fireEvent.change(d.sel("Test direction"), { target: { value: "greater" } });
    fireEvent.click(d.runBtn());
    expect(d.onRun).toHaveBeenCalledWith({ method: "ttest", variant: "unpaired", columns: ["a", "b"], conf: 0.95, tail: "greater" });
  });

  it("shows a per-variant guidance note (Welch / Mann-Whitney)", () => {
    const d = setup();
    d.open("ttest");
    fireEvent.change(d.sel("Type"), { target: { value: "welch" } });
    expect(d.container.textContent).toMatch(/does not assume equal variances/i);
    fireEvent.change(d.sel("Type"), { target: { value: "mann-whitney" } });
    expect(d.container.textContent).toMatch(/stochastic dominance/i);
  });

  it("one-sample Wilcoxon shows the μ input (gated like one-sample t)", () => {
    const d = setup();
    d.open("ttest");
    fireEvent.change(d.sel("Type"), { target: { value: "wilcoxon-1samp" } });
    const mu = d.container.querySelector('input[type="number"]') as HTMLInputElement;
    fireEvent.change(mu, { target: { value: "5" } });
    fireEvent.click(d.runBtn());
    expect(d.onRun).toHaveBeenCalledWith({ method: "ttest", variant: "wilcoxon-1samp", columns: ["a"], mu: 5, conf: 0.95 });
  });

  it("one-sample t adds μ and runs with a single dataset", () => {
    const d = setup();
    d.open("ttest");
    fireEvent.change(d.sel("Type"), { target: { value: "one-sample" } });
    const mu = d.container.querySelector('input[type="number"]') as HTMLInputElement;
    fireEvent.change(mu, { target: { value: "5" } });
    fireEvent.click(d.runBtn());
    expect(d.onRun).toHaveBeenCalledWith({ method: "ttest", variant: "one-sample", columns: ["a"], mu: 5, conf: 0.95 });
  });

  it("disables Run when both t-test groups are the same dataset", () => {
    const d = setup();
    d.open("ttest");
    // group A defaults to "a", group B to "b"; set B = "a" to collide
    fireEvent.change(d.sel("Group B"), { target: { value: "a" } });
    expect(d.runBtn().disabled).toBe(true);
  });

  it("ANOVA shows a checkbox per dataset (2 preselected) and runs table-ordered", () => {
    const d = setup();
    d.open("anova");
    const boxes = d.container.querySelectorAll('.angroups input[type="checkbox"]');
    expect(boxes).toHaveLength(2); // two datasets (X excluded)
    fireEvent.click(d.runBtn());
    expect(d.onRun).toHaveBeenCalledWith({
      method: "anova",
      variant: "anova",
      columns: ["a", "b"],
      posthoc: "tukey",
      scheme: "all-pairs",
      control: 0,
      conf: 0.95,
    });
  });

  it("ANOVA → Dunnett forces vs-control scheme + carries the control index", () => {
    const d = setup();
    d.open("anova");
    fireEvent.change(d.sel("Post-hoc test"), { target: { value: "dunnett" } });
    // Control chooser appears; default control is the first group ("a" → index 0).
    fireEvent.change(d.sel("Control group"), { target: { value: "b" } });
    fireEvent.click(d.runBtn());
    expect(d.onRun).toHaveBeenCalledWith({
      method: "anova",
      variant: "anova",
      columns: ["a", "b"],
      posthoc: "dunnett",
      scheme: "vs-control",
      control: 1, // "b" is index 1 within the table-ordered columns
      conf: 0.95,
    });
  });

  it("contingency shows an Independent/Paired variant picker and carries it in the payload", () => {
    const d = setup();
    d.open("contingency");
    expect(d.sel("Type")).toBeTruthy(); // the variant picker renders
    fireEvent.click(d.runBtn());
    expect(d.onRun).toHaveBeenCalledWith({ method: "contingency", variant: "independent", columns: ["a", "b"], conf: 0.95, ciMethod: "score" });
    d.onRun.mockClear();
    fireEvent.change(d.sel("Type"), { target: { value: "paired" } });
    fireEvent.click(d.runBtn());
    expect(d.onRun).toHaveBeenCalledWith({ method: "contingency", variant: "paired", columns: ["a", "b"], conf: 0.95, ciMethod: "score" });
  });

  it("correlation/curve fit take an X column + a Y dataset", () => {
    const d = setup();
    d.open("correlation");
    fireEvent.click(d.runBtn());
    expect(d.onRun).toHaveBeenCalledWith({ method: "correlation", variant: "pearson", columns: ["x", "a"], conf: 0.95 });
  });

  it("compare models shows Model A + Model B pickers and carries both in the payload", () => {
    const d = setup();
    d.open("comparefits");
    // Two distinct equation pickers appear (model A defaults to the first option, 4PL; model B to 3PL).
    expect(d.sel("Model A")).toBeTruthy();
    expect(d.sel("Model B")).toBeTruthy();
    fireEvent.change(d.sel("Model A"), { target: { value: "3pl" } });
    fireEvent.change(d.sel("Model B"), { target: { value: "4pl" } });
    fireEvent.click(d.runBtn());
    expect(d.onRun).toHaveBeenCalledWith({
      method: "comparefits",
      variant: "3pl",
      variant2: "4pl",
      columns: ["x", "a"], // X column + Y dataset
      conf: 0.95,
    });
  });

  it("compare models disables Run when both models are the same", () => {
    const d = setup();
    d.open("comparefits");
    fireEvent.change(d.sel("Model A"), { target: { value: "4pl" } });
    fireEvent.change(d.sel("Model B"), { target: { value: "4pl" } });
    expect(d.runBtn().disabled).toBe(true);
  });

  it("user-defined equation fit carries the equation + initial values in the payload", () => {
    const d = setup();
    d.open("curvefit");
    d.chooseCurveModel("custom");
    const eq = d.container.querySelector('input[aria-label="Equation"]') as HTMLInputElement;
    expect(eq).toBeTruthy();
    fireEvent.change(eq, { target: { value: "A*X + B" } });
    // The two detected parameters each get an initial-value input.
    const initA = d.container.querySelector('input[aria-label="Initial value for A"]') as HTMLInputElement;
    expect(initA).toBeTruthy();
    expect(d.container.querySelector('input[aria-label="Initial value for B"]')).toBeTruthy();
    fireEvent.change(initA, { target: { value: "2" } }); // leave B blank → omitted
    fireEvent.click(d.runBtn());
    expect(d.onRun).toHaveBeenCalledWith({
      method: "curvefit",
      variant: "custom",
      columns: ["x", "a"], // X column + Y dataset
      conf: 0.95,
      equation: "A*X + B",
      initialValues: { A: 2 },
    });
  });

  it("Dose-response front door: opens straight into curvefit/4PL, dose-response framing, plain curvefit payload", () => {
    const onRun = vi.fn();
    const u = render(
      <AnalyzeDialog table={table} onRun={onRun} onCancel={vi.fn()} initialMethod="curvefit" initialVariant="4pl" focusKind="dose-response" />,
    );
    // Lands directly on the configure form (bypasses the method-picker landing).
    expect(u.container.querySelector('[data-method="curvefit"]')).toBeNull();
    const testSel = u.container.querySelector('select[aria-label="Test"]') as HTMLSelectElement;
    expect(testSel.value).toBe("curvefit");
    const typeButton = u.container.querySelector('button[aria-label="Type"]') as HTMLButtonElement;
    expect(typeButton).toBeTruthy();
    expect(typeButton.textContent).toContain("4PL");
    // Dose-response framing (title + helper) so it reads as a first-class DR workflow.
    expect(u.container.textContent).toMatch(/Dose-response/);
    expect(u.container.textContent).toMatch(/EC50 \/ IC50/);
    // The engine still receives a plain curve fit.
    fireEvent.click(u.container.querySelector(".btn") as HTMLButtonElement);
    expect(onRun).toHaveBeenCalledWith({ method: "curvefit", variant: "4pl", columns: ["x", "a"], conf: 0.95 });
  });

  it("replaces curve-fit type with a guided picker while preserving expert access", () => {
    const onRun = vi.fn();
    const u = render(
      <AnalyzeDialog
        table={table}
        onRun={onRun}
        onCancel={vi.fn()}
        initialMethod="curvefit"
        initialVariant="4pl"
        curveModelRecommendations={[{
          variant: "4pl",
          family: "Dose-response",
          suitability: "recommended",
          confidence: "high",
          score: 100,
          reasons: ["X is positive, ordered, and roughly log-spaced."],
          assumptions: ["The response is broadly monotonic."],
          warnings: ["Plateaus should be checked before interpreting potency."],
          goals: ["shape"],
        }]}
      />,
    );
    expect(u.container.querySelector('select[aria-label="Type"]')).toBeNull();
    const typeButton = u.container.querySelector('button[aria-label="Type"]') as HTMLButtonElement;
    expect(typeButton.textContent).toContain("4PL");
    fireEvent.click(typeButton);
    expect(u.container.querySelector('[role="dialog"][aria-label="Choose equation model"]')).toBeTruthy();
    expect(u.container.textContent).toContain("Recommended for this data");
    fireEvent.click(u.container.querySelector('button[aria-label="Details for 4PL — variable slope"]') as HTMLButtonElement);
    expect(u.container.textContent).toContain("Plateaus should be checked");
    fireEvent.click(u.container.querySelector('.an-model-row[data-variant="5pl"] .an-model-main') as HTMLButtonElement);
    expect((u.container.querySelector('button[aria-label="Type"]') as HTMLButtonElement).textContent).toContain("5PL");
    expect(onRun).not.toHaveBeenCalled();
    fireEvent.click(u.container.querySelector('button[aria-label="Type"]') as HTMLButtonElement);
    fireEvent.click(u.container.querySelector('.an-type-link') as HTMLButtonElement);
    expect(u.container.querySelectorAll('.an-type-all .an-model-row')).toHaveLength(VARIANTS.curvefit!.length);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(u.container.querySelector('[role="dialog"][aria-label="Choose equation model"]')).toBeNull();
  });
  it("'Recommended for this data' lists only recommended/alternative models, and says so when none is recommended", () => {
    // A model the recommender flags as "caution" or "expert" must not sit under a
    // heading calling it recommended.
    const rec = (variant: string, suitability: "recommended" | "alternative" | "caution" | "expert", score: number) => ({
      variant, family: "Dose-response", suitability, confidence: "medium" as const, score,
      reasons: ["r"], assumptions: ["a"], warnings: ["w"], goals: ["shape" as const],
    });
    const u = render(
      <AnalyzeDialog table={table} onRun={vi.fn()} onCancel={vi.fn()} initialMethod="curvefit" initialVariant="4pl"
        curveModelRecommendations={[rec("biphasic_dr", "caution", 82), rec("5pl", "alternative", 73), rec("4pl", "caution", 58), rec("custom", "expert", 5)]} />,
    );
    fireEvent.click(u.container.querySelector('button[aria-label="Type"]') as HTMLButtonElement);
    const section = u.container.querySelector('[aria-label="Recommended for this data"]')!;
    expect(section).toBeTruthy();
    expect(section.querySelector(".an-type-section-head")!.textContent).toBe("Models for this data — none is recommended");
    expect([...section.querySelectorAll(".an-model-row")].map((r) => r.getAttribute("data-variant"))).toEqual(["5pl"]);
  });

  it("synchronizes equation preview and guidance when the model changes", () => {
    const d = setup();
    d.open("curvefit");
    d.openTypePicker();
    fireEvent.click(d.container.querySelector('.an-model-row[data-variant="dr_norm_4pl"] .an-model-main') as HTMLButtonElement);
    expect(d.container.querySelector('button[aria-label="Type"]')!.textContent).toContain("Normalized response");
    expect(d.container.querySelector('.an-eqpreview .aninfo-eq')!.textContent).toContain("100");
    const info = d.container.querySelector('.aninfo[aria-label="About this test"]') as HTMLElement;
    expect(info.textContent).toContain("already normalized");
    expect(info.textContent).toContain("Not for");
    expect(info.querySelector('.aninfo-eq')!.textContent).toContain("HillSlope");
    expect(d.onRun).not.toHaveBeenCalled();

    d.openTypePicker();
    fireEvent.click(d.container.querySelector('.an-model-row[data-variant="4pl"] .an-model-main') as HTMLButtonElement);
    expect(d.container.querySelector('.an-eqpreview .aninfo-eq')!.textContent).toContain("Bottom");
    expect(d.container.querySelector('.aninfo[aria-label="About this test"]')!.textContent).toContain("standard four-parameter logistic");
    expect(d.container.querySelector('.aninfo[aria-label="About this test"]')!.textContent).not.toContain("already normalized");
  });

  it("does not carry a previous equation into a model without a template", () => {
    const d = setup();
    d.open("curvefit");
    d.openTypePicker();
    fireEvent.click(d.container.querySelector('.an-model-row[data-variant="pseudo_voigt"] .an-model-main') as HTMLButtonElement);
    const info = d.container.querySelector('.aninfo[aria-label="About this test"]') as HTMLElement;
    expect(info.querySelector('.aninfo-eq')!.textContent).toContain("Equation preview unavailable");
    expect(info.textContent).not.toContain("standard four-parameter logistic");
  });

  it("keeps the selected variant in the existing run payload", () => {
    const d = setup();
    d.open("curvefit");
    d.chooseCurveModel("dr_norm_4pl");
    expect(d.onRun).not.toHaveBeenCalled();
    fireEvent.click(d.runBtn());
    expect(d.onRun).toHaveBeenCalledWith({ method: "curvefit", variant: "dr_norm_4pl", columns: ["x", "a"], conf: 0.95 });
  });
  it("without an initial method the dialog opens on the landing chooser", () => {
    const u = render(<AnalyzeDialog table={table} onRun={vi.fn()} onCancel={vi.fn()} />);
    expect(u.container.querySelector('[aria-label="Choose what you want to do"]')).toBeTruthy();
    expect(u.container.querySelector('select[aria-label="Test"]')).toBeNull(); // configure form not shown
    fireEvent.click([...u.container.querySelectorAll("button")].find((b) => b.textContent === "Browse all analyses") as HTMLButtonElement);
    expect(u.container.querySelectorAll('[aria-label="Choose by data type"] .an-card').length).toBe(9); // expert catalog remains available
  });

  it("dose-response extras: EC levels at any response + Cheng-Prusoff Ki flow into the spec (inhibition model)", () => {
    const onRun = vi.fn();
    const u = render(<AnalyzeDialog table={table} onRun={onRun} onCancel={vi.fn()} initialMethod="curvefit" initialVariant="ic50_4pl_log" focusKind="dose-response" />);
    const ecField = u.container.querySelector('input[aria-label="Report EC at percents"]') as HTMLInputElement;
    expect(ecField).toBeTruthy();
    fireEvent.change(ecField, { target: { value: "10, 90, 50, 200" } }); // 50 (already IC50) + out-of-range 200 are dropped
    fireEvent.change(u.container.querySelector('input[aria-label="Ligand concentration"]') as HTMLInputElement, { target: { value: "5" } });
    fireEvent.change(u.container.querySelector('input[aria-label="Ligand Kd"]') as HTMLInputElement, { target: { value: "10" } });
    fireEvent.click(u.container.querySelector(".btn") as HTMLButtonElement);
    expect(onRun).toHaveBeenCalledWith(
      expect.objectContaining({ method: "curvefit", variant: "ic50_4pl_log", ecLevels: [10, 90], chengProsuff: { conc: 5, kd: 10 } }),
    );
  });

  it("Ki inputs appear only for inhibition models; EC-levels omitted from the spec when blank", () => {
    const onRun = vi.fn();
    const u = render(<AnalyzeDialog table={table} onRun={onRun} onCancel={vi.fn()} initialMethod="curvefit" initialVariant="4pl" focusKind="dose-response" />);
    // stimulation 4PL: the EC-levels field shows, but there is no Cheng-Prusoff Ki input
    expect(u.container.querySelector('input[aria-label="Report EC at percents"]')).toBeTruthy();
    expect(u.container.querySelector('input[aria-label="Ligand concentration"]')).toBeNull();
    fireEvent.click(u.container.querySelector(".btn") as HTMLButtonElement);
    const spec = onRun.mock.calls[0]![0];
    expect(spec).not.toHaveProperty("ecLevels"); // nothing typed → omitted
    expect(spec).not.toHaveProperty("chengProsuff");
  });

  it("front door: enzyme-kinetics opens curvefit scoped to its family, titled, running a plain curvefit/mm spec", () => {
    const onRun = vi.fn();
    const u = render(<AnalyzeDialog table={table} onRun={onRun} onCancel={vi.fn()} initialMethod="curvefit" initialVariant="mm" focusKind="enzyme-kinetics" />);
    expect((u.container.querySelector('select[aria-label="Test"]') as HTMLSelectElement).value).toBe("curvefit");
    // family preset to Enzyme kinetics → Type list filtered to it (contains Michaelis-Menten, not the DR 4PL)
    expect((u.container.querySelector('select[aria-label="Equation family"]') as HTMLSelectElement).value).toBe("Enzyme kinetics");
    fireEvent.click(u.container.querySelector('button[aria-label="Type"]') as HTMLButtonElement);
    const typeOpts = u.container.querySelectorAll('.an-type-all .an-model-row');
    expect([...typeOpts].some((row) => row.getAttribute("data-variant") === "mm")).toBe(true);
    expect([...typeOpts].some((row) => row.getAttribute("data-variant") === "4pl")).toBe(false);
    expect(u.container.textContent).toMatch(/Enzyme kinetics/);
    fireEvent.click(u.container.querySelector(".btn") as HTMLButtonElement);
    expect(onRun).toHaveBeenCalledWith(expect.objectContaining({ method: "curvefit", variant: "mm" }));
  });

  // The enzyme door's banner names the mechanism-inhibition models. They are global-fit only,
  // so the door must also give a route to every model it names — these two lock the route open.
  it("front door: enzyme-kinetics offers every enzyme model, including the global-fit-only mechanisms", () => {
    const u = render(<AnalyzeDialog table={table} onRun={vi.fn()} onCancel={vi.fn()} initialMethod="curvefit" initialVariant="mm" focusKind="enzyme-kinetics" />);
    fireEvent.click(u.container.querySelector('button[aria-label="Type"]') as HTMLButtonElement);
    const shown = [...u.container.querySelectorAll('.an-type-all .an-model-row')].map((r) => r.getAttribute("data-variant"));
    // the six single-curve enzyme models…
    for (const id of ["mm", "kcat", "allosteric", "substrate_inhibition", "enzyme_progress", "morrison_ki"]) {
      expect(shown, `single-curve enzyme model "${id}" missing from the enzyme door`).toContain(id);
    }
    // …and the four mechanism models the banner promises, badged as global fits.
    for (const id of ["competitive_inhibition", "noncompetitive_inhibition", "uncompetitive_inhibition", "mixed_inhibition"]) {
      expect(shown, `inhibition model "${id}" missing from the enzyme door`).toContain(id);
      const row = u.container.querySelector(`.an-model-row[data-variant="${id}"]`)!;
      expect(row.textContent).toMatch(/global fit/i);
    }
    expect(shown).not.toContain("4pl"); // still scoped to the enzyme family
  });

  it("front door: picking an inhibition model switches the method to global fit and carries it", () => {
    const onRun = vi.fn();
    const u = render(<AnalyzeDialog table={table} onRun={onRun} onCancel={vi.fn()} initialMethod="curvefit" initialVariant="mm" focusKind="enzyme-kinetics" />);
    fireEvent.click(u.container.querySelector('button[aria-label="Type"]') as HTMLButtonElement);
    fireEvent.click(u.container.querySelector('.an-model-row[data-variant="competitive_inhibition"] .an-model-main') as HTMLButtonElement);
    // the method must actually change — otherwise curvefit would fit a single curve in which
    // KM and Ki are confounded, which is precisely why the model is global-fit only.
    expect((u.container.querySelector('select[aria-label="Test"]') as HTMLSelectElement).value).toBe("globalfit");
    fireEvent.click(u.container.querySelector(".btn") as HTMLButtonElement);
    expect(onRun).toHaveBeenCalledWith(expect.objectContaining({ method: "globalfit", variant: "competitive_inhibition" }));
  });

  // "One curve for all datasets, or separate curves?" — the extra-sum-of-squares F test rides
  // on the global fit, so its switch lives under the Shared parameters it depends on.
  it("global fit: 'one curve for all' reaches the spec and the engine payload, and is off when nothing is left per curve", () => {
    const onRun = vi.fn();
    const u = render(<AnalyzeDialog table={table} onRun={onRun} onCancel={vi.fn()} initialMethod="globalfit" initialVariant="4pl" />);
    const box = () => u.container.querySelector('input[aria-label="Test whether one curve fits all datasets"]') as HTMLInputElement;
    const shareBox = (name: string) =>
      [...u.container.querySelectorAll("label.angroup")].find((l) => l.textContent === name)!.querySelector("input") as HTMLInputElement;
    expect(box()).toBeTruthy();
    fireEvent.click(shareBox("Bottom"));
    fireEvent.click(shareBox("Top"));
    fireEvent.click(box());
    fireEvent.click(u.container.querySelector(".btn") as HTMLButtonElement);
    const spec = onRun.mock.calls.at(-1)![0];
    expect(spec).toMatchObject({ method: "globalfit", shared: ["Bottom", "Top"], compareOneCurve: true });
    expect(buildAnalysisData("globalfit", { ...spec, columns: ["a", "b"] }, table)).toMatchObject({ compareOneCurve: true, shared: ["Bottom", "Top"] });

    // every parameter shared = already one curve: the switch greys out and nothing is sent
    fireEvent.click(shareBox("logEC50"));
    fireEvent.click(shareBox("Hill slope"));
    expect(box().disabled).toBe(true);
    fireEvent.click(u.container.querySelector(".btn") as HTMLButtonElement);
    expect(onRun.mock.calls.at(-1)![0].compareOneCurve).toBeUndefined();
  });

  // The resampling/equivalence methods: prove they are reachable and that their
  // required inputs actually render, rather than existing only in the engine.
  it("equivalence (TOST) exposes its bound, and Run is blocked until a real bound is given", () => {
    const onRun = vi.fn();
    const u = render(<AnalyzeDialog table={table} onRun={onRun} onCancel={vi.fn()} initialMethod="equivalence" initialVariant="unpaired" />);
    expect((u.container.querySelector('select[aria-label="Test"]') as HTMLSelectElement).value).toBe("equivalence");
    const boundInput = u.container.querySelector('input[aria-label="Equivalence bound"]') as HTMLInputElement;
    expect(boundInput).toBeTruthy();
    expect(u.container.querySelector('select[aria-label="Bound units"]')).toBeTruthy();

    // Bound is 0 = unset. Running now would guarantee "not equivalent", so it must be blocked.
    const runBtn = u.container.querySelector(".btn") as HTMLButtonElement;
    expect(runBtn.disabled).toBe(true);

    fireEvent.change(boundInput, { target: { value: "0.5" } });
    expect((u.container.querySelector(".btn") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(u.container.querySelector(".btn") as HTMLButtonElement);
    expect(onRun).toHaveBeenCalledWith(expect.objectContaining({ method: "equivalence", bound: 0.5, boundMode: "absolute" }));
  });

  it("permutation exposes the resample count and seed, and carries them into the spec", () => {
    const onRun = vi.fn();
    const u = render(<AnalyzeDialog table={table} onRun={onRun} onCancel={vi.fn()} initialMethod="permutation" initialVariant="unpaired" />);
    expect((u.container.querySelector('select[aria-label="Test"]') as HTMLSelectElement).value).toBe("permutation");
    // The seed is user-visible on purpose: a Monte Carlo p-value is only citable if the
    // reader can reproduce it.
    const seedInput = u.container.querySelector('input[aria-label="Random seed"]') as HTMLInputElement;
    const nInput = u.container.querySelector('input[aria-label="Resamples"]') as HTMLInputElement;
    expect(seedInput).toBeTruthy();
    expect(nInput).toBeTruthy();
    // A permutation test can be one-sided, so the direction control must be offered.
    expect(u.container.querySelector('select[aria-label="Test direction"]')).toBeTruthy();

    fireEvent.change(nInput, { target: { value: "5000" } });
    fireEvent.change(seedInput, { target: { value: "42" } });
    fireEvent.click(u.container.querySelector(".btn") as HTMLButtonElement);
    expect(onRun).toHaveBeenCalledWith(expect.objectContaining({ method: "permutation", nResamples: 5000, seed: 42 }));
  });

  it("bayes factor exposes the prior scale and carries it into the spec", () => {
    const onRun = vi.fn();
    const u = render(<AnalyzeDialog table={table} onRun={onRun} onCancel={vi.fn()} initialMethod="bayesfactor" initialVariant="unpaired" />);
    expect((u.container.querySelector('select[aria-label="Test"]') as HTMLSelectElement).value).toBe("bayesfactor");
    // The prior must be user-visible: a Bayes factor is a comparison against a specific
    // alternative, so a result reported without its prior is not interpretable.
    const prior = u.container.querySelector('select[aria-label="Prior scale"]') as HTMLSelectElement;
    expect(prior).toBeTruthy();
    expect(prior.value).toBe("medium");
    fireEvent.change(prior, { target: { value: "ultrawide" } });
    fireEvent.click(u.container.querySelector(".btn") as HTMLButtonElement);
    expect(onRun).toHaveBeenCalledWith(expect.objectContaining({ method: "bayesfactor", rscale: "ultrawide" }));
  });

  it("Family picker filters the model list; 'All families' restores the full set", () => {
    const u = render(<AnalyzeDialog table={table} onRun={vi.fn()} onCancel={vi.fn()} initialMethod="curvefit" initialVariant="4pl" focusKind="dose-response" />);
    const fam = u.container.querySelector('select[aria-label="Equation family"]') as HTMLSelectElement;
    expect(fam.value).toBe("Dose-response");
    fireEvent.click(u.container.querySelector('button[aria-label="Type"]') as HTMLButtonElement);
    const typeVals = () => [...u.container.querySelectorAll('.an-type-all .an-model-row')].map((row) => row.getAttribute("data-variant"));
    expect(typeVals()).not.toContain("mm"); // enzyme model hidden while scoped to Dose-response
    fireEvent.change(fam, { target: { value: "" } }); // All families
    expect(typeVals()).toContain("mm"); // now visible
    expect(typeVals()).toContain("4pl");
  });

  it("disables Run for a user-defined fit until an equation is entered", () => {
    const d = setup();
    d.open("curvefit");
    d.chooseCurveModel("custom");
    expect(d.runBtn().disabled).toBe(true);
    fireEvent.change(d.container.querySelector('input[aria-label="Equation"]')!, { target: { value: "Vmax*X/(KM+X)" } });
    expect(d.runBtn().disabled).toBe(false);
  });

  it("a fixed parameter on a user-defined equation flows into the payload", () => {
    const d = setup();
    d.open("curvefit");
    d.chooseCurveModel("custom");
    fireEvent.change(d.container.querySelector('input[aria-label="Equation"]')!, { target: { value: "Top*X/(K+X)" } });
    // The Constraints panel is keyed by the detected parameter names — fix K = 5.
    fireEvent.click(d.container.querySelector('input[aria-label="Fix K"]')!);
    fireEvent.change(d.container.querySelector('input[aria-label="K value"]')!, { target: { value: "5" } });
    fireEvent.click(d.runBtn());
    expect(d.onRun).toHaveBeenCalledWith(
      expect.objectContaining({ method: "curvefit", variant: "custom", equation: "Top*X/(K+X)", fixed: { K: 5 } }),
    );
  });

  it("curve fit config is grouped into Model/Data/Parameters/Options with an equation preview + required marks", () => {
    const d = setup();
    d.open("curvefit"); // clamps to the first model, 4PL (a templated model)
    // Pre-fit symbolic equation preview shows at the top.
    const eq = d.container.querySelector(".an-eqpreview .aninfo-eq");
    expect(eq).toBeTruthy();
    expect(eq!.textContent).toContain("EC50"); // the 4PL template, parameter names (pre-fit)
    // The config is divided into the four labelled sections, in order.
    const secs = [...d.container.querySelectorAll(".an-scroll .an-sec")].map((s) => s.textContent);
    expect(secs).toEqual(["Model", "Data", "Parameters", "Options", "About this analysis"]);
    // Model (Type) + the two data pickers are the required fields.
    expect(d.container.querySelectorAll(".an-req").length).toBe(3);
    // The data pickers appear once in the config, not duplicated.
    expect(d.container.querySelectorAll('select[aria-label="X (dose)"]').length).toBe(1);
    expect(d.container.querySelectorAll('select[aria-label="Y (response)"]').length).toBe(1);
    // The model parameters (constraints) render under Parameters.
    expect(d.container.querySelector('input[aria-label="Fix Bottom"]')).toBeTruthy();
    // The method-level generic equation in the About box is omitted for fits (the
    // accurate per-model preview replaces it).
    expect(d.container.querySelector(".aninfo .aninfo-eq")!.textContent).toContain("EC50");
    // Layout is cosmetic — the run payload is a plain curve fit.
    fireEvent.click(d.runBtn());
    expect(d.onRun).toHaveBeenCalledWith({ method: "curvefit", variant: "4pl", columns: ["x", "a"], conf: 0.95 });
  });

  it("non-fit methods use the shared guidance panel without fit-only controls", () => {
    const d = setup();
    d.open("ttest");
    expect(d.container.querySelectorAll(".an-sec").length).toBe(1);
    expect(d.container.querySelector(".an-eqpreview")).toBeNull();
    expect(d.container.querySelectorAll(".an-req").length).toBe(0);
    // Non-fit methods keep their method-level equation in the About box.
    expect(d.container.querySelector(".aninfo .aninfo-eq")).toBeTruthy();
  });

  it("uses the shared variant picker and live guidance for non-curve analyses", () => {
    const d = setup();
    d.open("ttest");
    const trigger = d.container.querySelector('button[aria-label="Choose analysis variant"]') as HTMLButtonElement;
    expect(trigger).toBeTruthy();
    fireEvent.click(trigger);
    expect(d.container.querySelector('[role="dialog"][aria-label="Choose analysis variant"]')).toBeTruthy();
    expect(d.container.querySelectorAll(".an-type-all .an-model-row").length).toBeGreaterThan(1);
    fireEvent.click(d.container.querySelector('.an-model-row[data-variant="welch"] .an-model-main') as HTMLButtonElement);
    expect((d.container.querySelector('select[aria-label="Type"]') as HTMLSelectElement).value).toBe("welch");
    expect(trigger.textContent).toContain("Welch");
    expect(d.container.querySelector(".aninfo")!.textContent).toContain("without pooling the variances");
    expect(d.onRun).not.toHaveBeenCalled();
  });
  it("cancels", () => {
    const d = setup();
    fireEvent.click(d.container.querySelector(".btn-ghost") as HTMLButtonElement);
    expect(d.onCancel).toHaveBeenCalled();
  });

  it("groups the test chooser into labelled sections", () => {
    const d = setup();
    d.open("describe"); // the grouped Test dropdown lives in the configure view
    const groups = d.sel("Test").querySelectorAll("optgroup");
    expect(groups.length).toBeGreaterThanOrEqual(4);
    const labels = [...groups].map((g) => g.label);
    expect(labels.some((l) => /compare groups/i.test(l))).toBe(true);
    expect(labels.some((l) => /XY/i.test(l))).toBe(true);
  });

  it("shows an equation outline + plain explanation for the selected test", () => {
    const d = setup();
    d.open("describe");
    const info = () => d.container.querySelector(".aninfo") as HTMLElement;
    // default = describe
    expect(info()).toBeTruthy();
    expect(info().querySelector(".aninfo-eq")!.textContent).toContain("s =");
    expect(info().querySelector(".aninfo-ex")!.textContent!.length).toBeGreaterThan(40);
    // switch to ANOVA → the panel updates to the F-ratio
    fireEvent.change(d.sel("Test"), { target: { value: "anova" } });
    expect(info().querySelector(".aninfo-eq")!.textContent).toContain("MS_between");
  });
});

/**
 * A two-group test on a table with only one dataset is a dead end: both Group
 * pickers can only offer that dataset, so Run stays disabled. Telling the user to
 * "pick two different datasets" is impossible advice — the message has to name the
 * real cause (the groups are rows, not columns) and the way out.
 */
/**
 * Group-by-row-category: a tidy sheet (label column of categories + one value column)
 * keeps its groups in rows. The group pickers must offer those categories, so the
 * comparison is possible without reshaping the data.
 */
/**
 * The landing tiles must visibly differ between data types: a fixed list would greet
 * someone holding a table of groups with a Dose-response / Enzyme-kinetics / Binding row,
 * with nothing marking what applies.
 */
describe("AnalyzeDialog — goal tiles follow the data", () => {
  const sheet = (kind: string, columns: Array<{ id: string; name: string }>): DataTable =>
    ({ id: "t", kind, name: "S", columns, rows: [] }) as unknown as DataTable;

  const goals = (t: DataTable, recommendations: unknown[] = []) => {
    const u = render(<AnalyzeDialog table={t} onRun={vi.fn()} onCancel={vi.fn()} recommendations={recommendations as never} />);
    return [...u.container.querySelectorAll<HTMLElement>(".an-goal")].map((el) => ({
      key: el.getAttribute("data-goal"),
      applies: el.getAttribute("data-applies") === "yes",
      recommended: el.className.includes("is-recommended"),
    }));
  };

  it("orders an XY sheet's tiles differently from a column sheet's", () => {
    const xy = goals(sheet("xy", [{ id: "x", name: "Dose" }, { id: "y", name: "Resp" }])).map((g) => g.key);
    const col = goals(sheet("column", [{ id: "a", name: "Control" }, { id: "b", name: "Treated" }])).map((g) => g.key);
    expect(xy).not.toEqual(col);
    // …and each leads with what suits it.
    expect(xy[0]).toBe("dose-response");
    expect(col[0]).toBe("compare");
  });

  it("dims the tiles that do not suit the datasheet, without removing them", () => {
    const col = goals(sheet("column", [{ id: "a", name: "Control" }]));
    expect(col.find((g) => g.key === "compare")!.applies).toBe(true);
    expect(col.find((g) => g.key === "dose-response")!.applies).toBe(false);
    // Still present and clickable — the catalogue stays complete.
    expect(col).toHaveLength(14); // every tile, Melting temperature included
  });

  it("badges the tile the suggester actually recommended", () => {
    const rec = [{ id: "r", text: "", cta: "", actionId: "analyze", kind: "analysis", method: "curvefit", focusKind: "dose-response" }];
    const g = goals(sheet("xy", [{ id: "x", name: "Dose" }, { id: "y", name: "Resp" }]), rec);
    expect(g[0]!.key).toBe("dose-response");
    expect(g[0]!.recommended).toBe(true);
    expect(g.filter((x) => x.recommended)).toHaveLength(1);
  });
});

/**
 * The catalogue under the tiles ("Browse all analyses") carries the same signal as the
 * tiles — recommended marked, off-kind dimmed — without hiding anything, rather than
 * listing every method identically whether or not it suits the sheet.
 */
describe("AnalyzeDialog — catalogue follows the data", () => {
  const sheet = (kind: string): DataTable =>
    ({ id: "t", kind, name: "S", columns: [{ id: "a", name: "Control" }, { id: "b", name: "Treated" }], rows: [] }) as unknown as DataTable;

  const catalogue = (t: DataTable, recommendations: unknown[] = []) => {
    const u = render(<AnalyzeDialog table={t} onRun={vi.fn()} onCancel={vi.fn()} recommendations={recommendations as never} />);
    fireEvent.click([...u.container.querySelectorAll("button")].find((b) => b.textContent === "Browse all analyses")!);
    return [...u.container.querySelectorAll<HTMLElement>(".an-pick")].map((el) => ({
      method: el.getAttribute("data-method"),
      fits: el.getAttribute("data-fits") === "yes",
      recommended: el.className.includes("is-recommended"),
    }));
  };

  it("marks which methods suit the datasheet, and still lists every one", () => {
    const col = catalogue(sheet("column"));
    expect(col.length).toBeGreaterThan(30); // nothing hidden
    expect(col.find((m) => m.method === "ttest")!.fits).toBe(true);
    expect(col.find((m) => m.method === "anova")!.fits).toBe(true);
    expect(col.find((m) => m.method === "curvefit")!.fits).toBe(false);
  });

  it("flips that judgement for an XY sheet", () => {
    const xy = catalogue(sheet("xy"));
    expect(xy.find((m) => m.method === "curvefit")!.fits).toBe(true);
    expect(xy.find((m) => m.method === "ttest")!.fits).toBe(false);
  });

  it("badges what the suggester proposed and floats it up its group", () => {
    const rec = [{ id: "r", text: "", cta: "", actionId: "analyze", kind: "analysis", method: "anova" }];
    const col = catalogue(sheet("column"), rec);
    const anova = col.find((m) => m.method === "anova")!;
    expect(anova.recommended).toBe(true);
    // First entry of its own group ("Column data — compare groups").
    const group = col.filter((m) => ["ttest", "equivalence", "permutation", "bayesfactor", "anova"].includes(m.method ?? ""));
    expect(group[0]!.method).toBe("anova");
  });
});

describe("AnalyzeDialog — groups from row categories", () => {
  const tidy: DataTable = {
    id: "t2",
    kind: "column",
    name: "Treatment means",
    columns: [
      { id: "g", name: "Group" },
      { id: "m", name: "Mean" },
      { id: "r2", name: "Rep 2", role: "y", group: "m" },
    ],
    rows: [
      { id: "1", cells: { g: "Control", m: 12, r2: 15 } },
      { id: "2", cells: { g: "Drug A", m: 28, r2: 32 } },
      { id: "3", cells: { g: "Drug B", m: 19, r2: 22 } },
    ],
  };

  const openWith = (t: DataTable, method: string) => {
    const onRun = vi.fn();
    const u = render(<AnalyzeDialog table={t} onRun={onRun} onCancel={vi.fn()} />);
    fireEvent.click([...u.container.querySelectorAll("button")].find((b) => b.textContent === "Browse all analyses")!);
    fireEvent.click(u.container.querySelector(`[data-method="${method}"]`)!);
    const sel = (label: string) => u.container.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement;
    const opts = (label: string) => [...sel(label).options].map((o) => o.textContent);
    return { ...u, onRun, sel, opts };
  };

  it("offers the row categories as Group A / Group B, and Run is enabled", () => {
    const d = openWith(tidy, "ttest");
    expect(d.opts("Group A")).toEqual(["Control", "Drug A", "Drug B"]);
    expect(d.sel("Group A").value).not.toBe(d.sel("Group B").value);
    expect((d.container.querySelector(".btn") as HTMLButtonElement).disabled).toBe(false);
  });

  it("runs with the picked categories, and the payload carries each category's values", () => {
    const d = openWith(tidy, "ttest");
    fireEvent.click(d.container.querySelector(".btn")!);
    expect(d.onRun).toHaveBeenCalledOnce();
    const spec = d.onRun.mock.calls[0]![0] as { columns: string[] };
    expect(spec.columns).toHaveLength(2);
    const data = buildAnalysisData("ttest", { columns: spec.columns }, tidy) as { a: number[]; b: number[] };
    expect(data.a).toEqual([12, 15]);
    expect(data.b).toEqual([28, 32]);
  });

  it("offers every category to ANOVA and to the control chooser", () => {
    const d = openWith(tidy, "anova");
    const boxes = [...d.container.querySelectorAll(".angroups label")].map((l) => l.textContent?.trim());
    expect(boxes).toEqual(["Control", "Drug A", "Drug B"]);
  });

  // How a user actually arrives: click the recommendation, not the catalog. The
  // suggestion carries virtual row-group ids, which the apply path must match against
  // the row-group list — matched against the column datasets they select nothing,
  // leaving every checkbox empty and Run disabled.
  it("applying a row-group ANOVA recommendation ticks its groups and enables Run", () => {
    const rec = {
      id: "r1",
      text: "This graph compares 3 groups held in the Group column.",
      cta: "Configure one-way ANOVA",
      actionId: "analyze",
      kind: "analysis" as const,
      method: "anova",
      variant: "anova",
      columns: ["rowgrp:g:Control", "rowgrp:g:Drug A", "rowgrp:g:Drug B"],
    };
    const u = render(<AnalyzeDialog table={tidy} onRun={vi.fn()} onCancel={vi.fn()} recommendations={[rec]} />);
    fireEvent.click(u.container.querySelector(".an-rec-head")!);
    fireEvent.click([...u.container.querySelectorAll(".an-rec .btn-mini")].find((b) => /Configure/.test(b.textContent ?? ""))!);
    const boxes = [...u.container.querySelectorAll<HTMLInputElement>(".angroups input[type=checkbox]")];
    expect(boxes).toHaveLength(3);
    expect(boxes.every((b) => b.checked)).toBe(true);
    expect((u.container.querySelector(".btn") as HTMLButtonElement).disabled).toBe(false);
  });

  it("can be switched back to comparing columns", () => {
    const d = openWith(tidy, "ttest");
    fireEvent.change(d.sel("Groups from"), { target: { value: "columns" } });
    expect(d.opts("Group A")).toEqual(["Mean"]);
  });

  it("is not offered when the label column is numeric — that is a continuous X", () => {
    const xy: DataTable = {
      id: "t3",
      kind: "xy",
      name: "Dose",
      columns: [
        { id: "x", name: "Dose" },
        { id: "y", name: "Response" },
      ],
      rows: [
        { id: "1", cells: { x: 1, y: 10 } },
        { id: "2", cells: { x: 2, y: 20 } },
      ],
    };
    const d = openWith(xy, "ttest");
    expect(d.container.querySelector('select[aria-label="Groups from"]')).toBeNull();
    expect(d.opts("Group A")).toEqual(["Response"]);
  });
});

describe("AnalyzeDialog — one-dataset dead end", () => {
  const oneDataset: DataTable = {
    id: "t1",
    kind: "column",
    name: "Treatment means",
    columns: [
      { id: "g", name: "Group" },
      { id: "m", name: "Mean" },
    ],
    rows: [],
  };

  const openTtest = () => {
    const u = render(<AnalyzeDialog table={oneDataset} onRun={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click([...u.container.querySelectorAll("button")].find((b) => b.textContent === "Browse all analyses")!);
    fireEvent.click(u.container.querySelector('[data-method="ttest"]')!);
    return u;
  };

  it("explains why two groups cannot be picked instead of asking the impossible", () => {
    const u = openTtest();
    const notes = [...u.container.querySelectorAll(".note")].map((n) => n.textContent).join(" ");
    expect(notes).not.toContain("Pick two different datasets.");
    // Names the cause…
    expect(notes).toMatch(/only one data column|one dataset/i);
    // …and the concrete way out.
    expect(notes).toMatch(/transpose/i);
  });

  it("still disables Run: the explanation does not unblock a real dead end", () => {
    const u = openTtest();
    expect((u.container.querySelector(".btn") as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps the ordinary 'pick two different' wording when the table has two datasets", () => {
    const u = setup();
    u.open("ttest");
    fireEvent.change(u.sel("Group B"), { target: { value: "a" } }); // same as Group A
    const notes = [...u.container.querySelectorAll(".note")].map((n) => n.textContent).join(" ");
    expect(notes).toContain("Pick two different datasets.");
  });
});

describe("AnalyzeDialog — per-method defaults", () => {
  beforeEach(() => localStorage.clear());
  const makeDefaultBox = (u: ReturnType<typeof setup>) =>
    u.container.querySelector('input[aria-label="Make these settings the default for this analysis"]') as HTMLInputElement;

  it("'Make default' persists the method's options only (never columns/method)", () => {
    const d = setup();
    d.open("ttest");
    fireEvent.change(d.sel("Type"), { target: { value: "welch" } });
    fireEvent.click(makeDefaultBox(d));
    fireEvent.click(d.runBtn());
    // The run payload is the ordinary one…
    expect(d.onRun).toHaveBeenCalledWith({ method: "ttest", variant: "welch", columns: ["a", "b"], conf: 0.95 });
    // …and only the whitelisted options are remembered — no columns, no method.
    expect(getAnalysisDefault("ttest")).toEqual({ variant: "welch", conf: 0.95 });
  });

  it("re-opens a method pre-configured from its saved default (box checked, options hydrated)", () => {
    setAnalysisDefault("ttest", { variant: "welch", tail: "greater" });
    const d = setup();
    d.open("ttest");
    expect(d.sel("Type").value).toBe("welch"); // hydrated variant
    expect(d.sel("Test direction").value).toBe("greater"); // hydrated tail
    expect(makeDefaultBox(d).checked).toBe(true); // reflects the existing default
    fireEvent.click(d.runBtn());
    expect(d.onRun).toHaveBeenCalledWith({ method: "ttest", variant: "welch", columns: ["a", "b"], conf: 0.95, tail: "greater" });
  });

  it("unchecking 'Make default' on run clears the saved default", () => {
    setAnalysisDefault("ttest", { variant: "welch" });
    const d = setup();
    d.open("ttest");
    expect(makeDefaultBox(d).checked).toBe(true);
    fireEvent.click(makeDefaultBox(d)); // uncheck
    fireEvent.click(d.runBtn());
    expect(getAnalysisDefault("ttest")).toBeUndefined();
  });

  it("a saved default for one method doesn't leak into another", () => {
    setAnalysisDefault("ttest", { variant: "welch" });
    const d = setup();
    d.open("correlation"); // different method
    expect(makeDefaultBox(d).checked).toBe(false);
  });
});

describe("AnalyzeDialog — two-way ANOVA post-hoc", () => {
  it("selecting a comparison family adds compare + posthoc to the run payload (none by default)", () => {
    const d = setup();
    d.open("twoway");
    // Default = None → no post-hoc in the payload.
    fireEvent.click(d.runBtn());
    expect(d.onRun.mock.calls[0]![0].method).toBe("twoway");
    expect(d.onRun.mock.calls[0]![0].compare).toBeUndefined();
    expect(d.onRun.mock.calls[0]![0].posthoc).toBeUndefined();
    // Pick a family → the post-hoc test select appears; choose Šídák.
    fireEvent.change(d.sel("Two-way comparisons"), { target: { value: "rowmeans" } });
    fireEvent.change(d.sel("Two-way post-hoc test"), { target: { value: "sidak" } });
    fireEvent.click(d.runBtn());
    const spec = d.onRun.mock.calls[1]![0];
    expect(spec.compare).toBe("rowmeans");
    expect(spec.posthoc).toBe("sidak");
  });
});

/**
 * PCA / correlation-matrix / clustering take every numeric column by default and never a text
 * one. Opened from the wizard's PCA entry, the dialog ticks all four measures (not the text
 * column "Cell type") and groups by "Cell type".
 */
describe("variable-set methods seed all numeric variables, and PCA seeds its text grouping column", () => {
  const cells = createSampleDocument().toJSON().tables.find((t) => t.name.startsWith("Cell profiling"))!;
  const ticked = (c: HTMLElement) => [...c.querySelectorAll<HTMLLabelElement>(".angroups label.angroup")].filter((l) => (l.querySelector("input") as HTMLInputElement).checked).map((l) => l.textContent?.trim());
  it("opened straight into PCA (the wizard's hand-off)", () => {
    const { container } = render(<AnalyzeDialog table={cells} onRun={vi.fn()} onCancel={vi.fn()} initialMethod="pca" />);
    expect(ticked(container)).toEqual(["Size", "Granularity", "Marker A", "Marker B"]);
    const gb = container.querySelector<HTMLSelectElement>('select[aria-label="Group by"]')!;
    expect(gb.options[gb.selectedIndex]!.textContent).toBe("Cell type");
  });
  it("picking PCA / Correlation matrix from the landing page re-seeds the same way", () => {
    for (const m of ["pca", "corrmatrix"]) {
      const { container } = render(<AnalyzeDialog table={cells} onRun={vi.fn()} onCancel={vi.fn()} />);
      fireEvent.click([...container.querySelectorAll("button")].find((b) => b.textContent === "Browse all analyses") as HTMLButtonElement);
      fireEvent.click(container.querySelector(`[data-method="${m}"]`) as HTMLButtonElement);
      expect(ticked(container), m).toEqual(["Size", "Granularity", "Marker A", "Marker B"]);
      cleanup();
    }
  });
  it("a two-group test seeds the first two", () => {
    const { container } = render(<AnalyzeDialog table={cells} onRun={vi.fn()} onCancel={vi.fn()} initialMethod="anova" />);
    expect(ticked(container).length).toBe(2);
  });
});
