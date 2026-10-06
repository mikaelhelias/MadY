// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { Project } from "@mady/core";
import { AnalysisPane } from "./panes";

afterEach(cleanup);

/**
 * The ROC cutoff table is a lookup list — every threshold belongs there, and unlike
 * the tidy table nothing should be folded away. The optimal cutoff (maximum Youden J)
 * is the one people quote, so it is emphasised; unmarked, it would be lost among
 * dozens of identical-looking rows.
 */
const rocProject = (cutoffs: Array<{ cutoff: number; youden: number }>): Project =>
  ({
    tables: [],
    plots: [],
    analyses: [
      {
        id: "a1", name: "ROC", source: "t1", status: "ok", method: "roc",
        result: {
          method: "roc", title: "ROC", summary: "s", glance: { auc: 0.9 }, terms: [],
          extra: {
            roc: {
              label: "Marker", auc: 0.9, points: [],
              cutoffs: cutoffs.map((c) => ({ ...c, sensitivity: 0.5, specificity: 0.5, fpr: 0.5 })),
            },
          },
        },
      },
    ],
  }) as unknown as Project;

const rows = (c: HTMLElement) => [...c.querySelectorAll(".antable tbody tr")];

describe("ROC cutoff table", () => {
  it("marks the maximum-Youden cutoff as the optimal one", () => {
    const u = render(
      <AnalysisPane project={rocProject([
        { cutoff: 1, youden: 0.2 },
        { cutoff: 2, youden: 0.7 },
        { cutoff: 3, youden: 0.5 },
      ])} analysisId="a1" onRerun={vi.fn()} />,
    );
    const marked = rows(u.container).filter((r) => r.className.includes("is-optimal"));
    expect(marked).toHaveLength(1);
    expect(marked[0]!.textContent).toContain("2");
    expect(marked[0]!.textContent?.toLowerCase()).toContain("optimal");
  });

  it("still lists every cutoff — this table is a lookup, nothing is folded", () => {
    const u = render(
      <AnalysisPane project={rocProject(
        Array.from({ length: 12 }, (_, i) => ({ cutoff: i, youden: i / 20 })),
      )} analysisId="a1" onRerun={vi.fn()} />,
    );
    expect(rows(u.container)).toHaveLength(12);
  });

  it("marks only one row when several share the best Youden J", () => {
    const u = render(
      <AnalysisPane project={rocProject([
        { cutoff: 1, youden: 0.6 },
        { cutoff: 2, youden: 0.6 },
      ])} analysisId="a1" onRerun={vi.fn()} />,
    );
    expect(rows(u.container).filter((r) => r.className.includes("is-optimal"))).toHaveLength(1);
  });
});
