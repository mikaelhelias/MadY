// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { Project } from "@mady/core";
import { AnalysisPane } from "./panes";

afterEach(cleanup);

/**
 * The PCA component table marks which components the analysis kept. The engine
 * decides this — the selection rule the user picked (Kaiser / fixed-k / cumulative
 * variance / parallel analysis) produces `retained`, `retainedFlags` and `selection`
 * in `extra.pca` — and the table reads those fields, so a component listed without
 * its mark would hide an answer the engine computed.
 *
 * Marking must come from those flags and never from a rule invented here: a
 * renderer-side guess would disagree with the engine the moment the user changes the
 * selection rule.
 */
const pcaProject = (over: Record<string, unknown> = {}): Project =>
  ({
    tables: [],
    plots: [],
    analyses: [
      {
        id: "a1", name: "PCA", source: "t1", status: "ok", method: "pca",
        result: {
          method: "pca", title: "PCA", summary: "s", glance: {}, terms: [],
          extra: {
            pca: {
              varLabels: ["V1", "V2", "V3"],
              pcLabels: ["PC1", "PC2", "PC3"],
              loadings: [[0.9, 0.1, 0.2], [0.2, 0.8, 0.1], [0.1, 0.3, 0.9]],
              scores: [[1, 2, 3]],
              eigenvalues: [2.4, 0.9, 0.3],
              explained: [0.6, 0.25, 0.15],
              retained: 2,
              retainedFlags: [true, true, false],
              selection: "kaiser",
              ...over,
            },
          },
        },
      },
    ],
  }) as unknown as Project;

const pcRows = (c: HTMLElement) => [...c.querySelectorAll(".tidytable tbody tr")].slice(0, 3);

describe("PCA component table", () => {
  it("marks the components the analysis retained, and dims the rest", () => {
    const u = render(<AnalysisPane project={pcaProject()} analysisId="a1" onRerun={vi.fn()} />);
    const rows = pcRows(u.container);
    expect(rows.map((r) => r.className.includes("is-retained"))).toEqual([true, true, false]);
    expect(rows[0]!.textContent).toContain("PC1");
  });

  it("follows the engine's flags, not an eigenvalue rule of its own", () => {
    // Cumulative-variance selection keeps three components even though only the
    // first clears eigenvalue > 1 — a Kaiser rule hardcoded here would say one.
    const u = render(
      <AnalysisPane
        project={pcaProject({ retained: 3, retainedFlags: [true, true, true], selection: "variance" })}
        analysisId="a1"
        onRerun={vi.fn()}
      />,
    );
    expect(pcRows(u.container).map((r) => r.className.includes("is-retained"))).toEqual([true, true, true]);
  });

  it("names the rule that decided it", () => {
    const u = render(<AnalysisPane project={pcaProject()} analysisId="a1" onRerun={vi.fn()} />);
    expect(u.container.textContent).toMatch(/retained/i);
    expect(u.container.textContent).toMatch(/kaiser/i);
  });

  it("marks nothing when the engine sent no flags — never guesses", () => {
    const u = render(
      <AnalysisPane
        project={pcaProject({ retained: undefined, retainedFlags: undefined, selection: undefined })}
        analysisId="a1"
        onRerun={vi.fn()}
      />,
    );
    expect(pcRows(u.container).some((r) => r.className.includes("is-retained"))).toBe(false);
  });
});
