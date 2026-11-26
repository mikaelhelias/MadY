// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import type { Lineage } from "@mady/core";
import { LineagePanel } from "./LineagePanel";

afterEach(cleanup);

// data → derived data → analysis → graph → figure, with one stale + one error node.
const sample: Lineage = {
  nodes: [
    { kind: "table", id: "t1", name: "Raw data", status: "ok" },
    { kind: "table", id: "t2", name: "Normalized", status: "stale" },
    { kind: "analysis", id: "a1", name: "t-test", status: "ok" },
    { kind: "plot", id: "p1", name: "Dose curve", status: "error" },
    { kind: "layout", id: "l1", name: "Figure 1", status: "ok" },
  ],
  edges: [
    { from: "t1", to: "t2", relation: "derives" },
    { from: "t2", to: "a1", relation: "analyzes" },
    { from: "t2", to: "p1", relation: "plots" },
    { from: "a1", to: "p1", relation: "spawns" },
    { from: "p1", to: "l1", relation: "panel" },
  ],
};

const noop = (): void => {};

describe("LineagePanel", () => {
  it("renders every sheet as a node + every edge as a path", () => {
    const { container } = render(<LineagePanel lineage={sample} onOpen={noop} onRerunStale={noop} />);
    for (const name of ["Raw data", "Normalized", "t-test", "Dose curve", "Figure 1"]) {
      expect(within(container).getByText(name)).toBeTruthy();
    }
    expect(container.querySelectorAll(".lin-node")).toHaveLength(5);
    expect(container.querySelectorAll(".lin-edge")).toHaveLength(5);
  });

  it("colours nodes by status (stale / error border classes)", () => {
    const { container } = render(<LineagePanel lineage={sample} onOpen={noop} onRerunStale={noop} />);
    const stale = container.querySelector(".lin-node--stale") as HTMLElement;
    const error = container.querySelector(".lin-node--error") as HTMLElement;
    expect(stale.textContent).toContain("Normalized");
    expect(stale.textContent?.toLowerCase()).toContain("stale");
    expect(error.textContent).toContain("Dose curve");
  });

  it("opens the sheet on click, passing its kind + id", () => {
    const onOpen = vi.fn();
    const { getByTitle } = render(<LineagePanel lineage={sample} onOpen={onOpen} onRerunStale={noop} />);
    fireEvent.click(getByTitle("Open Raw data"));
    expect(onOpen).toHaveBeenCalledWith("table", "t1");
    fireEvent.click(getByTitle("Open Figure 1"));
    expect(onOpen).toHaveBeenCalledWith("layout", "l1");
  });

  it("shows a 'Re-run stale (N)' button counting stale nodes, wired to onRerunStale", () => {
    const onRerunStale = vi.fn();
    const { getByRole } = render(<LineagePanel lineage={sample} onOpen={noop} onRerunStale={onRerunStale} />);
    const btn = getByRole("button", { name: /Re-run stale \(1\)/ });
    fireEvent.click(btn);
    expect(onRerunStale).toHaveBeenCalledOnce();
  });

  it("hides the re-run button when nothing is stale", () => {
    const allOk: Lineage = { nodes: sample.nodes.map((n) => ({ ...n, status: "ok" })), edges: sample.edges };
    const { queryByRole } = render(<LineagePanel lineage={allOk} onOpen={noop} onRerunStale={noop} />);
    expect(queryByRole("button", { name: /Re-run stale/ })).toBeNull();
  });

  it("spotlights a node's family on hover (dims the rest)", () => {
    const { container, getByTitle } = render(<LineagePanel lineage={sample} onOpen={noop} onRerunStale={noop} />);
    fireEvent.mouseEnter(getByTitle("Open t-test")); // family = {t2, p1}
    // The unrelated "Raw data" node dims; the directly-connected "Normalized" does not.
    const raw = getByTitle("Open Raw data");
    const norm = getByTitle("Open Normalized");
    expect(raw.className).toContain("lin-node--dim");
    expect(norm.className).not.toContain("lin-node--dim");
    // Some edges light up (hot) while others dim.
    expect(container.querySelector(".lin-edge--hot")).toBeTruthy();
    expect(container.querySelector(".lin-edge--dim")).toBeTruthy();
  });

  it("renders an empty state when there is no lineage", () => {
    const { container, getByTestId } = render(
      <LineagePanel lineage={{ nodes: [], edges: [] }} onOpen={noop} onRerunStale={noop} />,
    );
    expect(getByTestId("lineage-empty")).toBeTruthy();
    expect(container.querySelector(".lin-node")).toBeNull();
  });
});
