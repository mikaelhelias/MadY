// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { Project } from "@mady/core";
import { AnalysisPane } from "./panes";

afterEach(cleanup);

/**
 * The results table leads with the answer. Descriptive statistics returns 22 rows
 * from the engine; a reader looking for the mean should not have to pick it out from
 * between the Winsorized mean and the geometric SD factor. The rest stays one click
 * away — a stats table must never silently drop a number.
 */
const DESCRIBE_ROWS = [
  "n", "Mean", "Median", "Geometric mean", "Harmonic mean", "Quadratic mean (RMS)",
  "Trimmed mean (10%)", "Winsorized mean (10%)", "SD", "Variance", "SEM",
  "Geometric SD factor", "Coefficient of variation (%CV)", "Skewness", "Kurtosis (excess)",
  "Min", "25th percentile", "75th percentile", "Max", "Range", "Interquartile range", "Sum",
];

const project = (method: string, rowNames: string[]): Project =>
  ({
    tables: [],
    plots: [],
    analyses: [
      {
        id: "a1",
        name: "A",
        source: "t1",
        status: "ok",
        method,
        result: {
          method,
          title: "Result",
          summary: "s",
          glance: { mean: 5, sd: 2, n: 8 },
          terms: rowNames.map((term, i) => ({ term, estimate: i })),
        },
      },
    ],
  }) as unknown as Project;

const setup = (method: string, rows: string[]) => {
  const u = render(<AnalysisPane project={project(method, rows)} analysisId="a1" onRerun={vi.fn()} />);
  const bodyRows = () => [...u.container.querySelectorAll(".tidytable tbody tr")].map((tr) => tr.querySelector(".tidyterm")?.textContent);
  const more = () => u.container.querySelector(".tidymore") as HTMLButtonElement | null;
  return { ...u, bodyRows, more };
};

describe("AnalysisPane results table", () => {
  it("leads descriptives with the quotable rows and folds the other 15 away", () => {
    const d = setup("describe", DESCRIBE_ROWS);
    expect(d.bodyRows()).toEqual(["n", "Mean", "Median", "SD", "SEM", "Min", "Max"]);
    expect(d.more()!.textContent).toContain("15 more");
  });

  it("reveals every row on request, and can collapse again", () => {
    const d = setup("describe", DESCRIBE_ROWS);
    fireEvent.click(d.more()!);
    expect(d.bodyRows()).toHaveLength(22);
    expect(d.bodyRows()).toContain("Winsorized mean (10%)");
    fireEvent.click(d.more()!);
    expect(d.bodyRows()).toHaveLength(7);
  });

  it("drops the columns that only the hidden rows needed", () => {
    // "Skewness" is the only row carrying a `statistic` here, and it is secondary —
    // so the column goes with it, and comes back when the detail is shown.
    const rows = [{ term: "Mean", estimate: 5 }, { term: "Skewness", statistic: 0.4 }];
    const p = {
      tables: [], plots: [],
      analyses: [{ id: "a1", name: "A", source: "t1", status: "ok", method: "describe",
        result: { method: "describe", title: "T", summary: "s", glance: {}, terms: rows } }],
    } as unknown as Project;
    const u = render(<AnalysisPane project={p} analysisId="a1" onRerun={vi.fn()} />);
    const heads = () => [...u.container.querySelectorAll(".tidytable th")].map((th) => th.textContent);
    expect(heads()).not.toContain("Statistic");
    fireEvent.click(u.container.querySelector(".tidymore")!);
    expect(heads()).toContain("Statistic");
  });

  it("shows no disclosure when every row is a headline", () => {
    const d = setup("outliers", ["Outliers removed", "n (input → cleaned)", "Outlier 1"]);
    expect(d.bodyRows()).toHaveLength(3);
    expect(d.more()).toBeNull();
  });

  it("keeps an ANOVA's group and pairwise rows, folding only the assumption checks", () => {
    const d = setup("anova", [
      "a", "b", "c", "Between groups", "a vs b", "a vs c", "b vs c",
      "Residual normality (Shapiro-Wilk)", "Equal variances (Bartlett)",
    ]);
    expect(d.bodyRows()).toEqual(["a", "b", "c", "Between groups", "a vs b", "a vs c", "b vs c"]);
    expect(d.more()!.textContent).toContain("2 more");
  });
});

/**
 * The key result above the table: stat cards (label over a large number) + a verdict, and
 * the headline row + significant p cells emphasised inside the table.
 */
describe("AnalysisPane — the key result", () => {
  const withResult = (result: Record<string, unknown>, conf = 0.95): Project =>
    ({
      tables: [],
      plots: [],
      analyses: [{ id: "a1", name: "A", source: "t1", status: "ok", method: String(result["method"]), params: { columns: [], conf }, result }],
    }) as unknown as Project;
  const mount = (result: Record<string, unknown>, conf?: number) =>
    render(<AnalysisPane project={withResult(result, conf)} analysisId="a1" onRerun={vi.fn()} />).container;

  const ANOVA = {
    method: "anova1",
    title: "One-way ANOVA",
    summary: "s",
    glance: { F: 216.8, df_between: 2, df_within: 9, p: 2.4e-8, eta_sq: 0.98 },
    terms: [
      { term: "Drug A", estimate: 21.5, df: 3 },
      { term: "Between groups", statistic: 216.8, df: 2, p: 2.4e-8 },
      { term: "Drug A vs Drug B", estimate: -9, p: 0.00001, ciLow: -11.5, ciHigh: -6.5 },
      { term: "Drug B vs Drug C", estimate: -1, p: 0.4, ciLow: -3, ciHigh: 1 },
    ],
  };

  it("renders a card per headline number — label, large value, small print — and the verdict", () => {
    const c = mount(ANOVA);
    const cards = [...c.querySelectorAll(".ankey-card")];
    expect(cards.map((x) => x.querySelector(".ankey-k")?.textContent)).toEqual(["p", "F", "η²"]);
    expect(cards[0]!.querySelector(".ankey-v")?.textContent).toBe("< 0.0001");
    expect(cards[0]!.className).toContain("is-sig");
    expect(cards[1]!.querySelector(".ankey-d")?.textContent).toBe("df 2, 9");
    expect(c.querySelector(".ankey-verdict")?.textContent).toBe("Statistically significant at α = 0.05");
    expect(c.querySelector(".ankey-verdict")?.className).toContain("is-sig");
  });

  it("a non-significant p is muted, and the verdict says so", () => {
    const c = mount({ ...ANOVA, glance: { ...ANOVA.glance, p: 0.3 } });
    expect(c.querySelector(".ankey-card")?.className).toContain("is-ns");
    expect(c.querySelector(".ankey-verdict")?.textContent).toBe("Not statistically significant at α = 0.05");
  });

  it("the headline test row is marked and every p under the threshold is emphasised — the 0.4 is not", () => {
    const c = mount(ANOVA);
    const lead = c.querySelector("tr.tidyrow-lead");
    expect(lead?.querySelector(".tidyterm")?.textContent).toBe("Between groups");
    const sig = [...c.querySelectorAll("td.tidyp-sig")].map((td) => td.closest("tr")?.querySelector(".tidyterm")?.textContent);
    expect(sig).toEqual(["Between groups", "Drug A vs Drug B"]);
  });

  it("a CI under a card names the analysis's own confidence level", () => {
    const c = mount(
      {
        method: "ttest",
        title: "t",
        summary: "s",
        glance: { p: 0.2, t: -1.3, df: 9, cohens_d: -0.8 },
        terms: [{ term: "Difference (A − B)", estimate: -8.2, statistic: -1.3, df: 9, p: 0.2, ciLow: -21.9, ciHigh: 5.6 }],
      },
      0.9,
    );
    const diff = [...c.querySelectorAll(".ankey-card")].find((x) => x.querySelector(".ankey-k")?.textContent === "Difference");
    expect(diff?.querySelector(".ankey-d")?.textContent).toBe("90% CI -21.9 to 5.6");
  });

  it("a method that decides something other than a p states that decision", () => {
    const c = mount({
      method: "bayesfactor",
      title: "BF",
      summary: "s",
      glance: { bf10: 1564.08, bf01: 0.00064, cohens_d: 3.8 },
      terms: [{ term: "Interpretation", estimate: "extreme evidence for H1 (an effect)" }],
    });
    expect([...c.querySelectorAll(".ankey-k")].map((k) => k.textContent)).toEqual(["BF10", "BF01", "Cohen's d"]);
    expect(c.querySelector(".ankey-verdict")?.textContent).toBe("Extreme evidence for H1 (an effect)");
  });

  it("shows no key result when the engine gave nothing to headline", () => {
    const c = mount({ method: "describe", title: "D", summary: "s", glance: {}, terms: [{ term: "n", estimate: 8 }] });
    expect(c.querySelector(".ankey")).toBeNull();
  });
});

/**
 * Settings ▸ "Round results tables" — opt-in: nothing is rounded unless it is turned on. Off,
 * the table shows the engine's full precision; on, the on-screen numbers round to N
 * significant figures while p keeps its own convention and integers stay whole.
 */
describe("AnalysisPane — results-table rounding is opt-in", () => {
  const result = {
    method: "ttest",
    title: "t",
    summary: "s",
    glance: { p: 0.211512, t: -1.345074, df: 9, cohens_d: -0.814483 },
    terms: [{ term: "Difference (A − B)", estimate: -8.166667, statistic: -1.345074, df: 9, p: 0.211512, ciLow: -21.901441, ciHigh: 5.568108 }],
  };
  const project = { tables: [], plots: [], analyses: [{ id: "a1", name: "A", source: "t1", status: "ok", method: "ttest", params: { columns: [] }, result }] } as unknown as Project;
  const cells = (digits?: number) => {
    const c = render(<AnalysisPane project={project} analysisId="a1" onRerun={vi.fn()} resultDigits={digits} />).container;
    return [...c.querySelectorAll(".tidytable tbody tr")][0]!.querySelectorAll("td");
  };

  it("off (unset or 0): every digit the engine computed", () => {
    for (const d of [undefined, 0]) {
      const tds = cells(d);
      expect(tds[1]!.textContent).toBe("-8.166667");
      expect(tds[2]!.textContent).toBe("-1.345074");
      cleanup();
    }
  });

  it("on: rounds estimates, statistics and CIs to the chosen figures — p and df untouched", () => {
    const tds = cells(3);
    expect([...tds].map((td) => td.textContent)).toEqual(["Difference (A − B)", "-8.17", "-1.35", "9", "0.212", "-21.9", "5.57"]);
  });
});

/**
 * The beta-version caution under every analysis.
 *
 * This is the program telling the user not to trust it yet, so it is worth more than a
 * comment: the failure mode is that a refactor tucks it inside the `result ?` branch, and
 * it silently stops appearing on exactly the analyses — errored, stale, not yet computed —
 * where a user is most likely to squint at a number and believe it anyway.
 */
describe("AnalysisPane — the beta-version caution", () => {
  const analysis = (extra: Record<string, unknown>): Project =>
    ({
      tables: [],
      plots: [],
      analyses: [{ id: "a1", name: "A", source: "t1", method: "ttest", ...extra }],
    }) as unknown as Project;

  const caution = (p: Project): string | null => {
    const u = render(<AnalysisPane project={p} analysisId="a1" onRerun={vi.fn()} />);
    return u.container.querySelector(".anbeta")?.textContent ?? null;
  };

  it("names the state of the software and tells the user what to do about it", () => {
    const text = caution(
      analysis({
        status: "ok",
        result: { method: "ttest", title: "T", summary: "s", glance: {}, terms: [{ term: "t", estimate: 1 }] },
      }),
    );
    expect(text, "no beta-version caution under a completed analysis").toBeTruthy();
    expect(text!, "it must say which state the software is in").toMatch(/beta version/i);
    expect(text!, "it must say the numbers may be wrong, not merely that the app is young").toMatch(
      /inaccurac/i,
    );
    expect(text!, "a warning needs a remedy — it must say to check elsewhere").toMatch(
      /check .*against an established/i,
    );
  });

  it("appears on an analysis that has not computed — the case a `result ?` branch would drop", () => {
    expect(caution(analysis({ status: "ok" })), "no caution when there is no result yet").toBeTruthy();
  });

  it("appears on a failed analysis, where a re-run is most likely to be believed", () => {
    expect(caution(analysis({ status: "error", error: "boom" })), "no caution on an error").toBeTruthy();
  });

  it("appears on a stale analysis, whose numbers are already out of date", () => {
    expect(
      caution(
        analysis({
          status: "stale",
          result: { method: "ttest", title: "T", summary: "s", glance: {}, terms: [{ term: "t", estimate: 1 }] },
        }),
      ),
      "no caution on a stale analysis",
    ).toBeTruthy();
  });
});
