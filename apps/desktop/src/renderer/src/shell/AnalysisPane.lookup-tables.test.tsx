// @vitest-environment jsdom
// The number-at-risk table (survival) and the cutoff table (ROC) are drawn with the same styled table the other
// result tables use: bordered cells with numbers right-aligned under right-aligned headings. Their own class
// (`antable`) has no base style: alone, it centres headings over left-aligned numbers.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Project } from "@mady/core";
import { AnalysisPane } from "./panes";

afterEach(cleanup);

const project = (extra: Record<string, unknown>, method: string): Project =>
  ({
    tables: [], plots: [],
    analyses: [{ id: "a1", name: "A", source: "t1", status: "ok", method, result: { method, title: "T", summary: "s", glance: {}, terms: [], extra } }],
  }) as unknown as Project;

const atRisk = { times: [0, 6.92, 13.84, 20.76], rows: [{ label: "Control", atRisk: [40, 24, 12, 8] }, { label: "Drug 10 mg", atRisk: [40, 25, 18, 8] }] };
const roc = { label: "Marker", auc: 0.9, points: [], cutoffs: [1, 2, 3].map((c) => ({ cutoff: c, youden: c / 10, sensitivity: 0.5, specificity: 0.5, fpr: 0.5 })) };

describe("lookup tables in the results pane", () => {
  it("the number-at-risk table is a styled table, with its row names on the left", () => {
    const { container } = render(<AnalysisPane project={project({ atrisk: atRisk }, "survival")} analysisId="a1" onRerun={vi.fn()} />);
    const t = container.querySelector("table.antable");
    expect(t, "no number-at-risk table").not.toBeNull();
    expect(t!.classList.contains("tidytable"), "an unstyled table: headings and numbers do not line up").toBe(true);
    const names = [...t!.querySelectorAll("tbody tr td:first-child")];
    expect(names.map((c) => c.textContent)).toEqual(["Control", "Drug 10 mg"]);
    for (const c of names) expect(c.classList.contains("tidyterm"), `${c.textContent} is not left-aligned`).toBe(true);
    expect(t!.querySelector("thead th:first-child")!.classList.contains("tidyterm")).toBe(true);
  });

  it("the ROC cutoff table is a styled table too", () => {
    const { container } = render(<AnalysisPane project={project({ roc }, "roc")} analysisId="a1" onRerun={vi.fn()} />);
    const t = container.querySelector("table.antable");
    expect(t, "no cutoff table").not.toBeNull();
    expect(t!.classList.contains("tidytable")).toBe(true);
  });

  it("the stylesheet gives that class borders and right-aligned numbers", () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "shell.css"), "utf8");
    expect(css).toMatch(/\.tidytable th,\s*\.tidytable td\s*\{[^}]*border:[^}]*text-align:\s*right/);
    expect(css).toMatch(/\.tidytable \.tidyterm\s*\{[^}]*text-align:\s*left/);
  });
});
