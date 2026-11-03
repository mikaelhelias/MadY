// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { Project } from "@mady/core";
import { AnalysisPane } from "./panes";

afterEach(cleanup);

/**
 * `extra.curves` is what a Kaplan-Meier result carries, but also what a global fit carries (its
 * fitted curves). "Survival curves" in the Add-to-graph menu has to follow the method, not the key.
 */
const project = (method: string): Project =>
  ({
    tables: [],
    plots: [],
    analyses: [
      {
        id: "a1", name: method, source: "t1", status: "ok", method,
        result: {
          method, title: method, summary: "s", glance: {},
          terms: [{ term: "x", estimate: 1 }],
          extra: { curves: [{ label: "A", points: [[0, 1], [1, 0.5]] }] },
        },
      },
    ],
  }) as unknown as Project;

const menuItems = (method: string): string[] => {
  const u = render(
    <AnalysisPane project={project(method)} analysisId="a1" onRerun={vi.fn()} onPlotSurvival={vi.fn()} onAnnotateStats={vi.fn()} />,
  );
  const button = [...u.container.querySelectorAll(".antoolbar button")].find((b) => b.textContent?.includes("Add to graph"));
  if (!button) return [];
  fireEvent.click(button);
  return [...u.container.querySelectorAll(".antb-menuitem")].map((b) => b.textContent ?? "");
};

describe("Add to graph ▸ Survival curves", () => {
  it("is offered on a survival analysis", () => {
    expect(menuItems("survival")).toContain("Survival curves");
  });

  it("is not offered on a global fit or a melting-temperature result, which also carry extra.curves", () => {
    expect(menuItems("globalfit")).not.toContain("Survival curves");
    cleanup();
    expect(menuItems("meltingtemp")).not.toContain("Survival curves");
  });
});
