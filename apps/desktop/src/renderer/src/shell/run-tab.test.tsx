// @vitest-environment jsdom
/**
 * Several series fitted at once show their results on one tab: the statistics side by side, one column per
 * series (any number), then each series' own results sheet. The tab is reached from the project tree and from a
 * link on each series' own sheet.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { MadyDocument } from "@mady/core";
import type { AnalysisResult, Project } from "@mady/core";
import { RunPane } from "./RunPane";
import { AnalysisPane } from "./panes";
import { Navigator } from "./Navigator";

afterEach(cleanup);
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

const fit = (ec50: number): AnalysisResult => ({
  method: "curvefit", title: "Dose-response (4PL, variable slope)",
  terms: [
    { term: "Bottom", estimate: 3, se: 1.2 },
    { term: "Hill slope", estimate: 1.1, se: 0.1 },
    { term: "EC50", estimate: ec50 },
    { term: "R²", estimate: 0.99 },
  ],
  glance: {}, summary: "",
});

function seed(series: number, grouped = true): { project: Project; run: string; ids: string[] } {
  const doc = new MadyDocument();
  const names = Array.from({ length: series }, (_, i) => `Compound ${String.fromCharCode(65 + i)}`);
  const table = doc.importTable("Doses", "xy", ["Concentration (µM)", ...names], [[1, ...names.map(() => 5)], [10, ...names.map(() => 50)]]);
  const x = table.columns[0]!.id;
  const ids = names.map((n, i) => {
    const a = doc.addAnalysis(`Dose-response 4PL — ${n} vs Concentration (µM)`, "curvefit", table.id, { columns: [x, table.columns[i + 1]!.id] });
    doc.setAnalysisResult(a.id, fit(3 * (i + 1)));
    return a.id;
  });
  const run = grouped ? doc.markAnalysisRun(ids) : ids[0]!;
  return { project: doc.toJSON(), run, ids };
}

const pane = (project: Project, run: string, extra: Partial<Parameters<typeof RunPane>[0]> = {}) => {
  const onRerun = vi.fn();
  const onExport = vi.fn();
  const utils = render(
    <RunPane project={project} run={run} onRerun={onRerun} onExport={onExport}
      renderSeries={(id) => <div data-testid={`sheet-${id}`}>{id}</div>} {...extra} />,
  );
  return { ...utils, onRerun, onExport };
};

describe("the run's tab", () => {
  it("one column per series and one section per series, for three and for five series", () => {
    for (const n of [3, 5]) {
      const { project, run, ids } = seed(n);
      const { container, getByRole } = pane(project, run);
      const heads = [...getByRole("table", { name: "Results side by side" }).querySelectorAll("th[scope=col]")].map((th) => th.textContent?.trim());
      expect(heads).toEqual(Array.from({ length: n }, (_, i) => `Compound ${String.fromCharCode(65 + i)}`));
      expect(ids.every((id) => container.querySelector(`[data-testid="sheet-${id}"]`))).toBe(true);
      expect(container.querySelectorAll("section.runseries")).toHaveLength(n);
      expect(getByRole("heading", { level: 2 }).textContent).toBe(`Dose-response 4PL — ${n} series vs Concentration (µM)`);
      cleanup();
    }
  });

  it("each cell shows the estimate, with ± its SE where it has one", () => {
    const { project, run } = seed(3);
    const { getByRole } = pane(project, run);
    const row = (term: string) => [...getByRole("table", { name: "Results side by side" }).querySelectorAll("tr")]
      .find((tr) => tr.querySelector("th")?.textContent === term)!;
    expect([...row("Hill slope").querySelectorAll("td")].map((td) => td.textContent)).toEqual(["1.1 ± 0.1", "1.1 ± 0.1", "1.1 ± 0.1"]);
    expect([...row("EC50").querySelectorAll("td")].map((td) => td.textContent)).toEqual(["3", "6", "9"]);
  });

  it("a series' section folds and unfolds", () => {
    const { project, run, ids } = seed(3);
    const { container, getByRole } = pane(project, run);
    fireEvent.click(getByRole("button", { name: "Compound B" }));
    expect(container.querySelector(`[data-testid="sheet-${ids[1]}"]`)).toBeNull();
    expect(container.querySelector(`[data-testid="sheet-${ids[0]}"]`)).not.toBeNull();
    fireEvent.click(getByRole("button", { name: "Compound B" }));
    expect(container.querySelector(`[data-testid="sheet-${ids[1]}"]`)).not.toBeNull();
  });

  it("Re-run all re-runs every series; CSV and Excel export the run", () => {
    const { project, run, ids } = seed(3);
    const { getByRole, onRerun, onExport } = pane(project, run);
    fireEvent.click(getByRole("button", { name: "Re-run all" }));
    expect(onRerun.mock.calls.map((c) => c[0])).toEqual(ids);
    fireEvent.click(getByRole("button", { name: "CSV" }));
    fireEvent.click(getByRole("button", { name: "Excel" }));
    expect(onExport.mock.calls).toEqual([[run, "csv"], [run, "xlsx"]]);
  });
});

describe("reaching the run's tab", () => {
  it("each series' own sheet says how many others were fitted with it, and its link opens the run", () => {
    const { project, run, ids } = seed(3);
    const onOpenRun = vi.fn();
    const { getByRole, getByText } = render(<AnalysisPane project={project} analysisId={ids[1]} onRerun={vi.fn()} onOpenRun={onOpenRun} />);
    expect(getByText(/Fitted together with 2 other series/)).toBeTruthy();
    fireEvent.click(getByRole("button", { name: "Show all together" }));
    expect(onOpenRun).toHaveBeenCalledWith(run);
  });

  it("no link on a sheet fitted alone, nor inside the run's own tab", () => {
    const alone = seed(2, false);
    const a = render(<AnalysisPane project={alone.project} analysisId={alone.ids[0]} onRerun={vi.fn()} onOpenRun={vi.fn()} />);
    expect(a.queryByRole("button", { name: "Show all together" })).toBeNull();
    cleanup();
    const { project, ids } = seed(2);
    const b = render(<AnalysisPane project={project} analysisId={ids[0]} onRerun={vi.fn()} />);
    expect(b.queryByRole("button", { name: "Show all together" })).toBeNull();
  });

  it("the project tree has one row for the run, above its analyses, and it opens the run's tab", () => {
    const { project, run } = seed(3);
    const onOpenRun = vi.fn();
    const { container } = render(
      <Navigator project={project} activeKey="" onOpenRun={onOpenRun}
        onOpenObject={vi.fn()} onOpenLayout={vi.fn()} onAddLayout={vi.fn()} onOpenDocs={vi.fn()}
        onAddProject={vi.fn()} onAddExperiment={vi.fn()} onAddDataset={vi.fn()} onAddGraph={vi.fn()}
        onRename={vi.fn()} onDeleteObject={vi.fn()} onDeleteExperiment={vi.fn()} onDeleteFolder={vi.fn()} />,
    );
    const labels = [...container.querySelectorAll(".navlabel")].map((e) => e.textContent?.trim());
    const runAt = labels.indexOf("Dose-response 4PL — 3 series vs Concentration (µM)");
    expect(runAt, `tree rows: ${labels.join(" | ")}`).toBeGreaterThan(-1);
    expect(labels.filter((l) => l?.includes("3 series"))).toHaveLength(1);
    expect(labels[runAt + 1]).toBe("Dose-response 4PL — Compound A vs Concentration (µM)");
    fireEvent.click(container.querySelectorAll(".navlabel")[runAt]!.closest("button")!);
    expect(onOpenRun).toHaveBeenCalledWith(run);
  });
});
