// @vitest-environment jsdom
// An analysis reads only numbers, so text a reader takes for a number ("<10", "1,160,799") in the
// columns it reads is left out of the result. The results page names those cells, so a smaller n
// or a missing group has its reason next to the numbers.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { Project } from "@mady/core";
import { AnalysisPane } from "./panes";

afterEach(cleanup);

const project = (columns: string[]): Project =>
  ({
    tables: [{
      id: "t1", kind: "xy", name: "T",
      columns: [{ id: "h", name: "Hour", role: "x" }, { id: "u", name: "Untreated" }, { id: "a", name: "Antibiotic" }],
      rows: [
        { id: "r0", cells: { h: 0, u: 1, a: 2 } },
        { id: "r1", cells: { h: 6, u: 5, a: "<10" } },
        { id: "r2", cells: { h: 8, u: 9, a: "<10" } },
      ],
    }],
    plots: [],
    analyses: [{ id: "a1", name: "A", source: "t1", status: "ok", method: "auc", params: { columns }, result: { method: "auc", title: "Area", summary: "s", glance: {}, terms: [] } }],
  }) as unknown as Project;

const notices = (p: Project) =>
  [...render(<AnalysisPane project={p} analysisId="a1" onRerun={vi.fn()} />).container.querySelectorAll('[aria-label="Skipped text cells"] li')].map((li) => li.textContent);

describe("the results page names the text cells the analysis skipped", () => {
  it("a column the analysis reads", () => {
    expect(notices(project(["h", "a"]))).toEqual(['"Antibiotic" has 2 cells written as text ("<10"), so graphs and analyses skip them. Enter them as a number, or exclude them.']);
  });
  it("nothing for columns it does not read", () => {
    expect(notices(project(["h", "u"]))).toEqual([]);
  });
});
