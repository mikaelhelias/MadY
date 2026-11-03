// @vitest-environment jsdom
// Every legend-like block draws its text in the legend font (or the tick font), so the panel that
// opens when the block is clicked must carry that font's controls. The panel the click opens is the
// only one the reader sees: a font control that sits in a section the click hides is, to the reader,
// a font that cannot be edited.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { DataTable, Plot, PlotKind } from "@mady/core";
import { Inspector } from "./Inspector";
import type { GraphSelection } from "./AppShell";

afterEach(cleanup);
afterEach(() => globalThis.localStorage?.clear());

const table: DataTable = {
  id: "t", kind: "xy", name: "Data",
  columns: [{ id: "x", name: "A" }, { id: "y", name: "B" }, { id: "z", name: "C" }, { id: "s", name: "Score" }],
  rows: [
    { id: "r1", cells: { x: 1, y: 2, z: 3, s: 0.1 } },
    { id: "r2", cells: { x: 2, y: 4, z: 1, s: 0.5 } },
    { id: "r3", cells: { x: 3, y: 1, z: 2, s: 0.9 } },
  ],
};

function setup(kind: PlotKind, extra: Partial<Plot>, selection: GraphSelection) {
  const plot: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind, ...extra };
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

/** The visible sections, each with the labels of its font groups (the `.inspsub` headings). */
function visibleSections(container: HTMLElement): { title: string; el: HTMLElement; groups: string[] }[] {
  return [...container.querySelectorAll<HTMLElement>(".inspsec")]
    .filter((s) => !s.hidden)
    .map((el) => ({ title: (el.querySelector(":scope > summary")?.textContent ?? "").trim(), el, groups: [...el.querySelectorAll(".inspsub")].map((g) => (g.textContent ?? "").trim()) }));
}

/** Set the Size field of the font group whose heading matches `group`, inside `section`. */
function setGroupSize(section: HTMLElement, group: RegExp, value: string): void {
  const sub = [...section.querySelectorAll(".inspsub")].find((g) => group.test(g.textContent ?? ""));
  if (!sub) throw new Error(`no font group matching ${group} in the section`);
  for (let n = sub.nextElementSibling; n && !n.classList.contains("inspsub"); n = n.nextElementSibling) {
    if (n.classList.contains("frow") && n.querySelector(":scope > span")?.textContent === "Size") {
      fireEvent.change(n.querySelector("input")!, { target: { value } });
      return;
    }
  }
  throw new Error("the font group has no Size row");
}

describe("Inspector — every colour bar has a size", () => {
  it("heatmap and parallel colour-bar panels offer the same Bar size, writing the same setting", () => {
    for (const [kind, extra] of [["heatmap", {}], ["parallel", { parallel: { colorColumn: "s", colorScale: "value" } as Plot["parallel"] }]] as const) {
      const d = setup(kind, extra, { kind: "colorbar" });
      const size = [...d.container.querySelectorAll(".frow")].find((r) => r.querySelector(":scope > span")?.textContent === "Bar size");
      expect(size, `${kind}: no Bar size row`).toBeTruthy();
      fireEvent.change(size!.querySelector("input")!, { target: { value: "1.4" } });
      expect(d.onSetPlotOptions).toHaveBeenLastCalledWith({ colorbarScale: 1.4 });
      cleanup();
    }
  });
});

describe("Inspector — the colour bar of a graph coloured by a column", () => {
  const colourBy = { y: { colorFromColumn: "s", colorFromMode: "continuous" as const } };

  it("a click on the bar opens its own panel: heading, size and the font it is drawn in", () => {
    const d = setup("xy", { seriesStyles: colourBy }, { kind: "colorbar" });
    const open = visibleSections(d.container);
    expect(open.map((s) => s.title)).toEqual(["Colour bar (legend)"]);
    const labels = [...open[0]!.el.querySelectorAll(".frow > span:first-child")].map((s) => s.textContent);
    for (const l of ["Show heading", "Title", "Bar size"]) expect(labels, `no "${l}" row`).toContain(l);
    expect(open[0]!.groups.some((g) => /colour bar font/i.test(g))).toBe(true);
    setGroupSize(open[0]!.el, /colour bar font/i, "17");
    expect(d.onSetPlotFont).toHaveBeenCalledWith("legend", { size: 17 });
  });

  it("the heading, its visibility and the size write the plot's own fields", () => {
    const d = setup("xy", { seriesStyles: colourBy }, { kind: "colorbar" });
    const row = (label: string) => [...d.container.querySelectorAll(".frow")].find((r) => r.querySelector(":scope > span")?.textContent === label)!;
    fireEvent.change(row("Title").querySelector("input")!, { target: { value: "Dose (mg)" } });
    expect(d.onSetPlotOptions).toHaveBeenLastCalledWith({ colorbarTitle: "Dose (mg)" });
    fireEvent.click(row("Show heading").querySelector("input")!);
    expect(d.onSetPlotOptions).toHaveBeenLastCalledWith({ colorbarShowTitle: false });
    fireEvent.change(row("Bar size").querySelector("input")!, { target: { value: "1.6" } });
    expect(d.onSetPlotOptions).toHaveBeenLastCalledWith({ colorbarScale: 1.6 });
  });

  it("is offered only while a series is coloured by a continuous column (the bar is drawn then and not otherwise)", () => {
    const plain = setup("xy", {}, { kind: "plot" });
    expect([...plain.container.querySelectorAll(".inspsec > summary")].some((s) => /Colour bar/.test(s.textContent ?? ""))).toBe(false);
    cleanup();
    const byCategory = setup("xy", { seriesStyles: { y: { colorFromColumn: "x", colorFromMode: "category" } } }, { kind: "plot" });
    expect([...byCategory.container.querySelectorAll(".inspsec > summary")].some((s) => /Colour bar/.test(s.textContent ?? ""))).toBe(false);
  });
});

describe("Inspector — editable headings of the correlation key and the number-at-risk table", () => {
  const row = (c: HTMLElement, label: string) => [...c.querySelectorAll(".frow")].find((r) => r.querySelector(":scope > span")?.textContent === label)!;

  it("correlation key: the heading and its visibility are the plot's own settings", () => {
    const d = setup("corrmatrix", {}, { kind: "chart-section", title: "Correlation matrix" });
    const open = visibleSections(d.container)[0]!.el;
    fireEvent.change(row(open, "Heading").querySelector("input")!, { target: { value: "Pearson r" } });
    expect(d.onSetPlotOptions).toHaveBeenLastCalledWith({ corrmatrix: { legendTitle: "Pearson r" } });
    fireEvent.click(row(open, "Show heading").querySelector("input")!);
    expect(d.onSetPlotOptions).toHaveBeenLastCalledWith({ corrmatrix: { legendShowTitle: false } });
  });

  it("number-at-risk table: the heading and its visibility are the plot's own settings", () => {
    const survival: Partial<Plot> = { survivalAtRisk: { times: [0, 10], rows: [{ label: "A", atRisk: [10, 5] }] } };
    const d = setup("survival", survival, { kind: "chart-section", title: "Survival (Kaplan-Meier)" });
    const open = visibleSections(d.container)[0]!.el;
    fireEvent.change(row(open, "Heading").querySelector("input")!, { target: { value: "Patients at risk" } });
    expect(d.onSetPlotOptions).toHaveBeenLastCalledWith({ survivalAtRiskTitle: "Patients at risk" });
    fireEvent.click(row(open, "Show heading").querySelector("input")!);
    expect(d.onSetPlotOptions).toHaveBeenLastCalledWith({ survivalShowAtRiskTitle: false });
  });
});

describe("Inspector — the network key and the timeline strip keys", () => {
  const row = (c: HTMLElement, label: string) => [...c.querySelectorAll(".frow")].find((r) => r.querySelector(":scope > span")?.textContent === label)!;

  it("network graph: a click on the node-value key opens a panel with its heading, its size and its numbers' font", () => {
    const d = setup("network", {}, { kind: "chart-section", title: "Network graph" });
    const open = visibleSections(d.container);
    expect(open.map((s) => s.title)).toEqual(["Network graph"]);
    expect(open[0]!.groups.some((g) => /node label font/i.test(g)), `font groups: ${open[0]!.groups.join(" | ")}`).toBe(true);
    fireEvent.change(row(open[0]!.el, "Key heading").querySelector("input")!, { target: { value: "Abundance" } });
    expect(d.onSetPlotOptions).toHaveBeenLastCalledWith({ network: { valueLegendTitle: "Abundance" } });
    fireEvent.change(row(open[0]!.el, "Key size").querySelector("input")!, { target: { value: "1.5" } });
    expect(d.onSetPlotOptions).toHaveBeenLastCalledWith({ network: { valueLegendScale: 1.5 } });
  });

  it("network graph: the key's rows are not offered while a group column colours the nodes (no key is drawn then)", () => {
    const d = setup("network", { network: { groupColumn: "y" } }, { kind: "chart-section", title: "Network graph" });
    expect([...d.container.querySelectorAll(".frow > span")].some((s) => s.textContent === "Key heading")).toBe(false);
  });

  it("timeline tracks: the keys' size and font are in the section a click on a key opens", () => {
    const d = setup("tracks", {}, { kind: "chart-section", title: "Chart type" });
    const open = visibleSections(d.container);
    expect(open.map((s) => s.title)).toEqual(["Chart type"]);
    expect(open[0]!.groups.some((g) => /key font/i.test(g)), `font groups: ${open[0]!.groups.join(" | ")}`).toBe(true);
    fireEvent.change(row(open[0]!.el, "Key size").querySelector("input")!, { target: { value: "1.6" } });
    expect(d.onSetPlotOptions).toHaveBeenLastCalledWith({ tracks: { keyScale: 1.6 } });
  });
});

describe("Inspector — the zone key", () => {
  const withKey: Partial<Plot> = { zoneLegend: "topright" };
  const row = (c: HTMLElement, label: string) => [...c.querySelectorAll(".frow")].find((r) => r.querySelector(":scope > span")?.textContent === label)!;

  it("a click on the key opens its own panel: heading, symbol size and the font it is drawn in", () => {
    const d = setup("xy", withKey, { kind: "chart-section", title: "Zone key" });
    const open = visibleSections(d.container);
    expect(open.map((s) => s.title)).toEqual(["Zone key"]);
    expect(open[0]!.groups.some((g) => /key font/i.test(g))).toBe(true);
    setGroupSize(open[0]!.el, /key font/i, "16");
    expect(d.onSetPlotFont).toHaveBeenCalledWith("legend", { size: 16 });
    // inside the section the click opened (another section has a "Heading" of its own: the legend's)
    fireEvent.change(row(open[0]!.el, "Heading").querySelector("input")!, { target: { value: "Risk zones" } });
    expect(d.onSetPlotOptions).toHaveBeenLastCalledWith({ zoneLegendTitle: "Risk zones" });
    fireEvent.change(row(open[0]!.el, "Key symbol size").querySelector("input")!, { target: { value: "1.8" } });
    expect(d.onSetPlotOptions).toHaveBeenLastCalledWith({ zoneLegendScale: 1.8 });
  });

  it("is offered only while the key is on", () => {
    const off = setup("xy", {}, { kind: "plot" });
    expect([...off.container.querySelectorAll(".inspsec > summary")].some((s) => /Zone key/.test(s.textContent ?? ""))).toBe(false);
  });
});

describe("Inspector — the panel a legend block opens carries the font it is drawn in", () => {
  it("parallel coordinates colour bar: a click on the bar opens a panel with the title font and the min/max font", () => {
    const d = setup("parallel", { parallel: { colorColumn: "s", colorScale: "value" } as Plot["parallel"] }, { kind: "colorbar" });
    const open = visibleSections(d.container);
    expect(open.map((s) => s.title)).toEqual(["Colour bar (legend)"]);
    expect(open[0]!.groups.some((g) => /legend/i.test(g)), `font groups: ${open[0]!.groups.join(" | ")}`).toBe(true);
    expect(open[0]!.groups.some((g) => /tick|min/i.test(g)), `font groups: ${open[0]!.groups.join(" | ")}`).toBe(true);
    setGroupSize(open[0]!.el, /legend/i, "19");
    expect(d.onSetPlotFont).toHaveBeenCalledWith("legend", { size: 19 });
  });

  it("correlation matrix key: the panel the key's symbols open carries the legend font the key's text is drawn in", () => {
    const d = setup("corrmatrix", {}, { kind: "chart-section", title: "Correlation matrix" });
    const open = visibleSections(d.container);
    expect(open.map((s) => s.title)).toEqual(["Correlation matrix"]);
    expect(open[0]!.groups.some((g) => /key font/i.test(g)), `font groups: ${open[0]!.groups.join(" | ")}`).toBe(true);
    setGroupSize(open[0]!.el, /key font/i, "18");
    expect(d.onSetPlotFont).toHaveBeenCalledWith("legend", { size: 18 });
  });
});
