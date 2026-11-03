// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { Project } from "@mady/core";
import { AnalysisPane } from "./panes";

afterEach(cleanup);

/**
 * The analysis toolbar has one filled primary action (Re-run), grouped secondaries,
 * and every put-it-on-a-graph action behind a single menu. The graph actions depend
 * on the method ("Add brackets", "Plot ROC curve", "Plot residuals"…); as separate
 * buttons they would appear and vanish per analysis and change the row's width as
 * the user clicks around.
 */
const project = (): Project =>
  ({
    tables: [],
    plots: [],
    analyses: [
      {
        id: "a1", name: "ANOVA", source: "t1", status: "ok", method: "anova",
        result: {
          method: "anova", title: "One-way ANOVA", summary: "s", glance: { p: 0.01 },
          // " vs " rows with a p-value → the brackets/letters actions light up.
          terms: [{ term: "a vs b", p: 0.01 }, { term: "a vs c", p: 0.2 }],
          extra: { residuals: { resid: [1, -1, 0.5] } },
        },
      },
    ],
  }) as unknown as Project;

const wired = {
  onRerun: vi.fn(), onSaveMethod: vi.fn(), onAddBrackets: vi.fn(), onAddLetters: vi.fn(),
  onPlotResiduals: vi.fn(), onAnnotateStats: vi.fn(), onExportAnalysis: vi.fn(),
};

const setup = () => {
  const u = render(<AnalysisPane project={project()} analysisId="a1" {...wired} />);
  const bar = () => u.container.querySelector(".antoolbar")!;
  const names = () => [...bar().querySelectorAll(":scope > button, :scope > .antb-menuwrap > button")].map((b) => b.textContent?.replace("▾", "").trim());
  return { ...u, bar, names };
};

describe("analysis toolbar", () => {
  it("gives Re-run the only primary emphasis", () => {
    const d = setup();
    const primary = d.bar().querySelectorAll(".antb-primary");
    expect(primary).toHaveLength(1);
    expect(primary[0]!.textContent).toBe("Re-run");
  });

  it("collapses every graph action into one menu rather than a row of buttons", () => {
    const d = setup();
    // The graph actions are not top-level buttons…
    for (const gone of ["Add brackets to graph", "Add letters (CLD)", "Plot residuals", "Key stats → graph"]) {
      expect(d.names()).not.toContain(gone);
    }
    expect(d.names()).toContain("Add to graph");
    // …they live behind the menu, which starts closed.
    expect(d.container.querySelector(".antb-menupanel")).toBeNull();
    fireEvent.click([...d.bar().querySelectorAll("button")].find((b) => b.textContent?.includes("Add to graph"))!);
    const items = [...d.container.querySelectorAll(".antb-menuitem")].map((b) => b.textContent);
    expect(items).toEqual(["Key stats as a label", "Significance brackets", "Letters (CLD)", "Residual diagnostics"]);
  });

  it("runs a menu action and closes the menu", () => {
    const d = setup();
    fireEvent.click([...d.bar().querySelectorAll("button")].find((b) => b.textContent?.includes("Add to graph"))!);
    fireEvent.click([...d.container.querySelectorAll(".antb-menuitem")].find((b) => b.textContent === "Significance brackets")!);
    expect(wired.onAddBrackets).toHaveBeenCalledWith("a1");
    expect(d.container.querySelector(".antb-menupanel")).toBeNull();
  });

  it("stays open while the pointer crosses the gap between button and panel", () => {
    // The panel sits 4px below the button, so on the way to an option the pointer
    // leaves the wrapper. Closing on mouseleave would make the menu vanish before any
    // option could be clicked.
    const d = setup();
    fireEvent.click([...d.bar().querySelectorAll("button")].find((b) => b.textContent?.includes("Add to graph"))!);
    fireEvent.mouseLeave(d.container.querySelector(".antb-menuwrap")!);
    expect(d.container.querySelector(".antb-menupanel")).not.toBeNull();
  });

  it("closes on a click anywhere outside, via the scrim, without running an action", () => {
    const d = setup();
    fireEvent.click([...d.bar().querySelectorAll("button")].find((b) => b.textContent?.includes("Add to graph"))!);
    const scrim = d.container.querySelector(".menu-scrim");
    expect(scrim).not.toBeNull();
    const callsBefore = wired.onAddBrackets.mock.calls.length + wired.onAddLetters.mock.calls.length
      + wired.onPlotResiduals.mock.calls.length + wired.onAnnotateStats.mock.calls.length;
    fireEvent.click(scrim!);
    expect(d.container.querySelector(".antb-menupanel")).toBeNull();
    expect(d.container.querySelector(".menu-scrim")).toBeNull();
    const callsAfter = wired.onAddBrackets.mock.calls.length + wired.onAddLetters.mock.calls.length
      + wired.onPlotResiduals.mock.calls.length + wired.onAnnotateStats.mock.calls.length;
    expect(callsAfter).toBe(callsBefore);
  });

  it("keeps the toolbar to a fixed set of top-level actions", () => {
    // The point of the menu: what is on the bar does not depend on the method.
    expect(setup().names()).toEqual([
      "Re-run", "Save as Method", "Copy", "CSV", "Excel", "Methods text", "Add to graph",
    ]);
  });

  it("hides the menu entirely when no graph action applies", () => {
    const u = render(<AnalysisPane project={project()} analysisId="a1" onRerun={vi.fn()} />);
    expect([...u.container.querySelectorAll("button")].some((b) => b.textContent?.includes("Add to graph"))).toBe(false);
  });
});
