// @vitest-environment jsdom
// Guards the network graph's Inspector surface:
//  • rail tabs that are inert for a network (Axis — no axes; Annotate — the network
//    scene draws no annotation layer) are greyed with a reason, not offered as live;
//  • the Data tab routes to the first node (a network's data elements are its nodes,
//    not table-column series);
//  • sections that would be silent no-ops (grid/frame, significance, annotations,
//    the Edit-axis row) are not rendered;
//  • the node click-panel is a full editor — fill / two-tone / outline / size — with
//    the same This-node / All-nodes scope contract as the link editor.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { DataTable, Plot, PlotKind } from "@mady/core";
import { Inspector } from "./Inspector";
import type { GraphSelection } from "./AppShell";

afterEach(cleanup);
afterEach(() => globalThis.localStorage?.clear());

/** An edge list: source, target, weight, node value — the network table shape. */
const table: DataTable = {
  id: "t", kind: "xy", name: "Signals",
  columns: [{ id: "s", name: "Source" }, { id: "t2", name: "Target" }, { id: "w", name: "Weight" }, { id: "v", name: "Value" }],
  rows: [
    { id: "r1", cells: { s: "A", t2: "B", w: 1, v: 0.9 } },
    { id: "r2", cells: { s: "B", t2: "C", w: 2, v: -0.5 } },
    { id: "r3", cells: { s: "C", t2: "A", w: 1, v: 0.2 } },
  ],
};

function setup(kind: PlotKind, network?: Plot["network"], selection: GraphSelection = { kind: "plot" }) {
  const plot: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind, ...(network ? { network } : {}) };
  const h = {
    onSelect: vi.fn(), onSetAxis: vi.fn(), onSetAxisLength: vi.fn(), onSetAxisTitleFont: vi.fn(),
    onSetSeriesStyle: vi.fn(), onSetSeriesStyleAll: vi.fn(), onSetPointStyle: vi.fn(), onClearPointStyles: vi.fn(),
    onSetGrid: vi.fn(), onSetFrame: vi.fn(), onSetKind: vi.fn(), onSetBarLayout: vi.fn(), onSetBarShape: vi.fn(), onSetBoxWhisker: vi.fn(),
    onSetPlotOptions: vi.fn(), onSetGraphTitle: vi.fn(), onSetPlotFont: vi.fn(), onHomogenizeFont: vi.fn(),
    onSetLegend: vi.fn(), onSetSignificance: vi.fn(), onApplyPreset: vi.fn(), 
    onApplyUserPreset: vi.fn(), onSaveUserPreset: vi.fn(), onDeleteUserPreset: vi.fn(), onSetProfileDefault: vi.fn(),
    annotationOps: { add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() },
  };
  return { ...render(<Inspector activeSection="graphs" selection={selection} plot={plot} table={table} userPresets={[]} profileDefault={null} {...h} />), ...h };
}

/** The rail tabs, by label → whether they carry the greyed "disabled" class. */
function railDisabled(container: HTMLElement): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const b of container.querySelectorAll<HTMLButtonElement>(".inspcat")) out[(b.textContent ?? "").trim()] = b.classList.contains("disabled");
  return out;
}

/** All section titles present in the DOM (regardless of the per-tab hide). */
function sectionTitles(container: HTMLElement): string[] {
  return [...container.querySelectorAll(".inspsec > summary")].map((s) => (s.textContent ?? "").trim());
}

describe("Inspector — greys inapplicable rail tabs for a network graph", () => {
  it("greys Axis + Annotate but leaves the rest active", () => {
    const { container } = setup("network");
    const d = railDisabled(container);
    expect(d["Axis"]).toBe(true);
    expect(d["Annotate"]).toBe(true);
    expect(d["Chart"]).toBe(false);
    expect(d["Frame"]).toBe(false);
    expect(d["Data"]).toBe(false);
    expect(d["Text"]).toBe(false);
    expect(d["Style"]).toBe(false);
  });

  it("a greyed tab is inert — clicking Axis does not select an axis", () => {
    const { container, onSelect } = setup("network");
    const axisBtn = [...container.querySelectorAll<HTMLButtonElement>(".inspcat")].find((b) => b.textContent?.trim() === "Axis")!;
    axisBtn.click();
    expect(onSelect).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "axis" }));
  });

  it("the Data tab routes to the first node, not a table-column series", () => {
    const { container, onSelect } = setup("network");
    const dataBtn = [...container.querySelectorAll<HTMLButtonElement>(".inspcat")].find((b) => b.textContent?.trim() === "Data")!;
    dataBtn.click();
    expect(onSelect).toHaveBeenCalledWith({ kind: "network-node", nodeId: "A" });
  });
});

describe("Inspector — network shows only relevant sections", () => {
  it("hides grid/frame, significance, annotations and the Edit-axis row", () => {
    const { container } = setup("network");
    const titles = sectionTitles(container);
    expect(titles.some((t) => /Grid, frame/.test(t))).toBe(false);
    expect(titles.some((t) => /Significance/.test(t))).toBe(false);
    expect(titles.some((t) => /^Annotations$/.test(t))).toBe(false);
    expect([...container.querySelectorAll(".frow > span")].some((s) => s.textContent === "Edit axis")).toBe(false);
    // …but the real network controls + the still-relevant sections remain.
    expect(titles.some((t) => /Network graph/.test(t))).toBe(true);
    expect(titles.some((t) => /Graph size/.test(t))).toBe(true);
    expect(titles.some((t) => /Background/.test(t))).toBe(true);
  });

  it("keeps those sections for a normal series chart (xy)", () => {
    const { container } = setup("xy");
    const titles = sectionTitles(container);
    expect(titles.some((t) => /Grid, frame/.test(t))).toBe(true);
    expect(titles.some((t) => /^Annotations$/.test(t))).toBe(true);
    // Note: `Significance` is checked on a bar. An xy chart does not offer that section —
    // both its axes are continuous, so a bracket would span two data values and compare
    // nothing (on purpose; see `BRACKET_KINDS` in Inspector.tsx). The claim this test makes
    // — that the heatmap/network exclusions are specific, not global — uses a kind that
    // legitimately has the section.
    expect(sectionTitles(setup("bar").container).some((t) => /Significance/.test(t))).toBe(true);
  });

  it("offers the plot-level two-tone / outline / outline-width node controls", () => {
    const { container } = setup("network");
    const rows = [...container.querySelectorAll(".frow > span")].map((s) => s.textContent);
    expect(rows).toContain("Two-tone fill");
    expect(rows).toContain("Node outline");
    expect(rows).toContain("Outline width");
  });
});

describe("Inspector — network node editor (This node / All nodes)", () => {
  const nodeSel: GraphSelection = { kind: "network-node", nodeId: "A" };

  it("writes per-node overrides in the default This-node scope", () => {
    const { container, onSetPlotOptions } = setup("network", undefined, nodeSel);
    // Fill
    fireEvent.change(container.querySelector('input[aria-label="Node fill colour"]')!, { target: { value: "#ff0000" } });
    expect(onSetPlotOptions).toHaveBeenLastCalledWith(expect.objectContaining({ network: expect.objectContaining({ nodeColors: { A: "#ff0000" } }) }));
    // Two-tone (darker-outline toggle, not a second colour). Two-tone is on by default,
    // so a click turns it off; what this asserts is the scope (a per-node
    // `nodeTwoTones` entry, not the shared key).
    fireEvent.click(container.querySelector('input[aria-label="Two-tone node (darker outline)"]')!);
    expect(onSetPlotOptions).toHaveBeenLastCalledWith(expect.objectContaining({ network: expect.objectContaining({ nodeTwoTones: { A: false } }) }));
    // Outline colour + width
    fireEvent.change(container.querySelector('input[aria-label="Node outline colour"]')!, { target: { value: "#0000ff" } });
    expect(onSetPlotOptions).toHaveBeenLastCalledWith(expect.objectContaining({ network: expect.objectContaining({ nodeStrokes: { A: "#0000ff" } }) }));
    fireEvent.change(container.querySelector('input[aria-label="Node outline width"]')!, { target: { value: "3" } });
    expect(onSetPlotOptions).toHaveBeenLastCalledWith(expect.objectContaining({ network: expect.objectContaining({ nodeStrokeWidths: { A: 3 } }) }));
    // Size (drawn radius)
    fireEvent.change(container.querySelector('input[aria-label="Node size"]')!, { target: { value: "12" } });
    expect(onSetPlotOptions).toHaveBeenLastCalledWith(expect.objectContaining({ network: expect.objectContaining({ nodeSizes: { A: 12 } }) }));
  });

  it("writes the shared style in All-nodes scope", () => {
    const { container, onSetPlotOptions } = setup("network", undefined, nodeSel);
    fireEvent.click([...container.querySelectorAll<HTMLButtonElement>(".layseg-btn")].find((b) => b.textContent?.trim() === "All nodes")!);
    fireEvent.change(container.querySelector('input[aria-label="Node fill colour"]')!, { target: { value: "#ff0000" } });
    expect(onSetPlotOptions).toHaveBeenLastCalledWith(expect.objectContaining({ network: expect.objectContaining({ nodeColor: "#ff0000" }) }));
    // Again: the assertion is the scope (the shared `nodeTwoTone`, not a per-node entry).
    // The value is `false` because two-tone defaults on, so the click switches it off.
    fireEvent.click(container.querySelector('input[aria-label="Two-tone node (darker outline)"]')!);
    expect(onSetPlotOptions).toHaveBeenLastCalledWith(expect.objectContaining({ network: expect.objectContaining({ nodeTwoTone: false }) }));
    fireEvent.change(container.querySelector('input[aria-label="Node outline colour"]')!, { target: { value: "#0000ff" } });
    expect(onSetPlotOptions).toHaveBeenLastCalledWith(expect.objectContaining({ network: expect.objectContaining({ nodeStroke: "#0000ff" }) }));
    fireEvent.change(container.querySelector('input[aria-label="Node outline width"]')!, { target: { value: "2.5" } });
    expect(onSetPlotOptions).toHaveBeenLastCalledWith(expect.objectContaining({ network: expect.objectContaining({ nodeStrokeWidth: 2.5 }) }));
  });

  /**
   * The two-tone checkboxes must agree with the drawing and be able to turn two-tone off.
   *
   * The builder draws every node two-tone by default (#c0392b fill / #7d251c outline), to
   * match the marker look. If the two controls default to `?? false`, both boxes read
   * unchecked over a two-tone drawing; and if "off" is stored as `undefined`, it means
   * "inherit", which the builder resolves back to on, so off cannot be stored at all.
   */
  it("shows two-tone as on by default, matching what the builder draws", () => {
    const { container } = setup("network", undefined, nodeSel);
    expect((container.querySelector('input[aria-label="Two-tone node (darker outline)"]') as HTMLInputElement).checked).toBe(true);
  });

  it("turning two-tone off stores an explicit false (undefined would read as inherit, which is on)", () => {
    const { container, onSetPlotOptions } = setup("network", undefined, nodeSel);
    fireEvent.click(container.querySelector('input[aria-label="Two-tone node (darker outline)"]')!);
    expect(onSetPlotOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({ network: expect.objectContaining({ nodeTwoTones: { A: false } }) }),
    );
  });

  it("the graph-wide box does the same (on by default, off stores false)", () => {
    const { container, onSetPlotOptions } = setup("network");
    const box = container.querySelector('input[aria-label="Two-tone nodes (darker outline)"]') as HTMLInputElement;
    expect(box.checked).toBe(true);
    fireEvent.click(box);
    expect(onSetPlotOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({ network: expect.objectContaining({ nodeTwoTone: false }) }),
    );
  });

  it("Reset clears every override of this node in one patch, leaving no stale map entry behind", () => {
    const { container, onSetPlotOptions } = setup(
      "network",
      { nodeColors: { A: "#112233", B: "#445566" }, nodeStrokeWidths: { A: 4 }, nodeSizes: { A: 9 } },
      nodeSel,
    );
    const reset = [...container.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Reset")!;
    fireEvent.click(reset);
    expect(onSetPlotOptions).toHaveBeenCalledTimes(1);
    const patch = (onSetPlotOptions.mock.calls[0]![0] as { network: Record<string, unknown> }).network;
    // A's entries are gone; B's survive; the emptied maps collapse to undefined.
    expect(patch.nodeColors).toEqual({ B: "#445566" });
    expect(patch.nodeStrokeWidths).toBeUndefined();
    expect(patch.nodeSizes).toBeUndefined();
    expect(patch.nodeTwoTones).toBeUndefined();
    expect(patch.nodeStrokes).toBeUndefined();
  });
});
