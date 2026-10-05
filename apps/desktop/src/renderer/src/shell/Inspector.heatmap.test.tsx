// @vitest-environment jsdom
// Guards that the Inspector shows only relevant sections for a matrix heatmap:
// the series palette ("Colour scheme"), gridlines/frame/tick axes, and significance
// brackets are inert for a heatmap (its colour ramp lives in the Heatmap section),
// so they must not appear as dead chrome. Point-mode heatmaps (density/hexbin) keep
// their real axes, so the grid section returns for them.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { DataTable, Plot, PlotKind } from "@mady/core";
import { Inspector } from "./Inspector";
import type { GraphSelection } from "./AppShell";

afterEach(cleanup);
afterEach(() => globalThis.localStorage?.clear());

const table: DataTable = {
  id: "t", kind: "xy", name: "Heat",
  columns: [{ id: "x", name: "Gene" }, { id: "a", name: "Sample A" }, { id: "b", name: "Sample B" }],
  rows: [{ id: "r1", cells: { x: "G1", a: 1, b: 2 } }, { id: "r2", cells: { x: "G2", a: 3, b: 4 } }],
};

function setup(kind: PlotKind, heatmap?: Plot["heatmap"], selection: GraphSelection = { kind: "plot" }) {
  const plot: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind, ...(heatmap ? { heatmap } : {}) };
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

/** All section titles present in the DOM (regardless of the per-tab hide). */
function sectionTitles(container: HTMLElement): string[] {
  return [...container.querySelectorAll(".inspsec > summary")].map((s) => (s.textContent ?? "").trim());
}

describe("Inspector — heatmap shows only relevant sections", () => {
  it("hides the series palette, gridlines/frame, and significance brackets for a matrix heatmap", () => {
    const { container } = setup("heatmap");
    const titles = sectionTitles(container);
    expect(titles.some((t) => /Colour scheme/.test(t))).toBe(false);
    expect(titles.some((t) => /Grid, frame/.test(t))).toBe(false);
    expect(titles.some((t) => /Significance/.test(t))).toBe(false);
    // …but the real heatmap controls + the still-relevant sections remain.
    expect(titles.some((t) => /^Heatmap$/.test(t))).toBe(true);
    expect(titles.some((t) => /Graph size/.test(t))).toBe(true);
    expect(titles.some((t) => /Background/.test(t))).toBe(true);
  });

  it("keeps those sections for a normal series chart (xy)", () => {
    const { container } = setup("xy");
    const titles = sectionTitles(container);
    expect(titles.some((t) => /Colour scheme/.test(t))).toBe(true);
    expect(titles.some((t) => /Grid, frame/.test(t))).toBe(true);
    // Note: `Significance` is checked on a bar here. An xy chart does not offer that section —
    // both its axes are continuous, so a bracket would span two data values and compare
    // nothing (a design decision; see `BRACKET_KINDS` in Inspector.tsx). The claim this test
    // makes — that the heatmap/network exclusions are specific, not global — is checked on a
    // kind that legitimately has the section.
    expect(sectionTitles(setup("bar").container).some((t) => /Significance/.test(t))).toBe(true);
  });

  it("keeps gridlines/frame for a point-mode heatmap (density/hexbin have real axes)", () => {
    const { container } = setup("heatmap", { mode: "density2d" });
    const titles = sectionTitles(container);
    expect(titles.some((t) => /Grid, frame/.test(t))).toBe(true); // point mode → real axes
    expect(titles.some((t) => /Colour scheme/.test(t))).toBe(false); // still no series palette
  });
});

describe("Inspector — heatmap in-cell value text colour", () => {
  const labels = (c: HTMLElement) => [...c.querySelectorAll(".frow > span")].map((s) => s.textContent);
  it("exposes a Value-text-colour control only when Show values is on, wired to valueColor", () => {
    // off by default → no control
    expect(labels(setup("heatmap", { mode: "matrix" }).container)).not.toContain("Value text colour");
    cleanup();
    // on → the ColourField + clear-to-auto ⨯ appear
    const on = setup("heatmap", { mode: "matrix", showValues: true });
    expect(labels(on.container)).toContain("Value text colour");
    const clear = [...on.container.querySelectorAll("button")].find((b) => b.textContent === "⨯" && b.getAttribute("title")?.includes("Auto"));
    expect(clear).toBeTruthy();
    clear!.click();
    expect(on.onSetPlotOptions).toHaveBeenCalledWith(expect.objectContaining({ heatmap: expect.objectContaining({ valueColor: undefined }) }));
  });
});

/** The rail tabs, by label → whether they carry the greyed "disabled" class. */
function railDisabled(container: HTMLElement): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const b of container.querySelectorAll<HTMLButtonElement>(".inspcat")) out[(b.textContent ?? "").trim()] = b.classList.contains("disabled");
  return out;
}

describe("Inspector — greys inapplicable rail tabs for a matrix heatmap", () => {
  it("greys Axis + Data (inert for a matrix heatmap) but leaves the rest active", () => {
    const { container } = setup("heatmap");
    const d = railDisabled(container);
    expect(d["Axis"]).toBe(true);
    expect(d["Data"]).toBe(true);
    expect(d["Chart"]).toBe(false);
    expect(d["Frame"]).toBe(false);
    expect(d["Text"]).toBe(false);
    expect(d["Annotate"]).toBe(false);
    expect(d["Style"]).toBe(false);
  });

  it("a greyed tab is inert — clicking Axis does not select an axis", () => {
    const plot: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "heatmap" };
    const onSelect = vi.fn();
    const h = {
      onSelect, onSetAxis: vi.fn(), onSetAxisLength: vi.fn(), onSetAxisTitleFont: vi.fn(),
      onSetSeriesStyle: vi.fn(), onSetSeriesStyleAll: vi.fn(), onSetPointStyle: vi.fn(), onClearPointStyles: vi.fn(),
      onSetGrid: vi.fn(), onSetFrame: vi.fn(), onSetKind: vi.fn(), onSetBarLayout: vi.fn(), onSetBarShape: vi.fn(), onSetBoxWhisker: vi.fn(),
      onSetPlotOptions: vi.fn(), onSetGraphTitle: vi.fn(), onSetPlotFont: vi.fn(), onHomogenizeFont: vi.fn(),
      onSetLegend: vi.fn(), onSetSignificance: vi.fn(), onApplyPreset: vi.fn(), 
      onApplyUserPreset: vi.fn(), onSaveUserPreset: vi.fn(), onDeleteUserPreset: vi.fn(), onSetProfileDefault: vi.fn(),
      annotationOps: { add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() },
    };
    const { container } = render(<Inspector activeSection="graphs" selection={{ kind: "plot" }} plot={plot} table={table} userPresets={[]} profileDefault={null} {...h} />);
    const axisBtn = [...container.querySelectorAll<HTMLButtonElement>(".inspcat")].find((b) => b.textContent?.trim() === "Axis")!;
    axisBtn.click();
    expect(onSelect).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "axis" }));
  });

  it("does not grey any tab for other chart kinds (xy)", () => {
    const { container } = setup("xy");
    const d = railDisabled(container);
    expect(Object.values(d).every((v) => v === false)).toBe(true);
  });

  it("does not grey the tabs for a point-mode heatmap (real axes + point data)", () => {
    const { container } = setup("heatmap", { mode: "hexbin" });
    const d = railDisabled(container);
    expect(d["Axis"]).toBe(false);
    expect(d["Data"]).toBe(false);
  });
});

describe("Inspector — clicking the heatmap colour bar opens its editor", () => {
  it("a heatmap-colorbar selection pins the Chart tab and surfaces only the dedicated Colour bar section", () => {
    const { container } = setup("heatmap", undefined, { kind: "colorbar" });
    const activeTab = [...container.querySelectorAll(".inspcat")].find((b) => b.classList.contains("on"))?.textContent?.trim();
    expect(activeTab).toBe("Chart");
    const visible = [...container.querySelectorAll<HTMLElement>(".inspsec")].filter((s) => !s.hidden).map((s) => (s.querySelector(":scope > summary")?.textContent ?? "").trim());
    expect(visible).toEqual(["Colour bar (legend)"]);
    // the values field (auto by default) is reachable there
    const span = [...container.querySelectorAll(".frow > span")].find((s) => s.textContent === "Values");
    expect(span).toBeTruthy();
  });
});
