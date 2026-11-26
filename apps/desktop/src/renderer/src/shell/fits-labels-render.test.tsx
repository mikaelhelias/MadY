// @vitest-environment jsdom
/**
 * The renderer draws a per-series fit's potency label and parameter block (not only the
 * crosshair), and a drag on either lands on that fit's offsets, by index.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { buildPlotScene } from "@mady/graphics";
import type { DataTable, Plot, PlotFit } from "@mady/core";
import { findPreset, MadyDocument } from "@mady/core";
import { PlotFigure } from "./PlotFigure";

afterEach(cleanup);

const table: DataTable = {
  id: "t", kind: "xy", name: "T",
  columns: [{ id: "x", name: "Dose", role: "x" }, { id: "a", name: "A", role: "y" }, { id: "b", name: "B", role: "y" }],
  rows: [[0.1, 5, 6], [1, 20, 12], [10, 80, 40], [100, 95, 85]].map((r, i) => ({ id: `r${i}`, cells: { x: r[0]!, a: r[1]!, b: r[2]! } })),
};
const fit = (label: string, ec50: number): PlotFit => ({
  label, points: [[0.1, 5], [1, 20], [10, 80], [100, 95]],
  params: [`EC_{50} = ${ec50}`, "Hill = 1.1"], marker: { x: ec50, y: 50, label: `EC50 = ${ec50} µM` },
});
// Fit parameters > Show all: with several fits a graph otherwise prints only each fit's key result, and these
// tests are about drawing whole blocks.
const plot: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "xy", fits: [fit("A", 2), fit("B", 30)], xAxis: { scale: "log10" }, fitParams: { show: true } };
const scene = buildPlotScene(table, plot, { width: 720, height: 500 });
const texts = (c: HTMLElement) => [...c.querySelectorAll("text")].map((t) => (t.textContent ?? "").trim());

describe("per-series fit labels and parameter blocks are drawn", () => {
  it("both potency labels and both parameter blocks reach the figure", () => {
    const { container } = render(<PlotFigure scene={scene} />);
    const all = texts(container).join("\n");
    expect(all).toContain("EC50 = 2 µM");
    expect(all).toContain("EC50 = 30 µM");
    expect(all).toContain("Hill = 1.1");
    expect(all.split("Hill = 1.1").length - 1, "one block per fit").toBe(2);
  });
  it("dragging the second fit's label reports fit index 1; its block likewise", () => {
    const onMoveFitLabel = vi.fn();
    const onMoveFitParams = vi.fn();
    const { container } = render(<PlotFigure scene={scene} onMoveFitLabel={onMoveFitLabel} onMoveFitParams={onMoveFitParams} />);
    const drag = (el: Element) => {
      fireEvent.pointerDown(el, { clientX: 100, clientY: 100, pointerId: 1 });
      fireEvent.pointerMove(el, { clientX: 120, clientY: 90, pointerId: 1 });
      fireEvent.pointerUp(el, { clientX: 120, clientY: 90, pointerId: 1 });
    };
    const label = [...container.querySelectorAll("text")].find((t) => (t.textContent ?? "").trim() === "EC50 = 30 µM")!;
    drag(label);
    expect(onMoveFitLabel).toHaveBeenLastCalledWith(20, -10, "1");
    const blocks = [...container.querySelectorAll("text")].filter((t) => (t.textContent ?? "").includes("Hill = 1.1"));
    drag(blocks[1]!);
    expect(onMoveFitParams).toHaveBeenLastCalledWith(20, -10, "1");
  });
});

describe("parameter blocks say which curve they belong to", () => {
  // Two analyses on one graph: the first is the single fit (`Plot.fit`), the second a `Plot.fits` entry.
  const two: Plot = { ...plot, fit: { ...fit("A", 2), color: "#0072B2" }, fits: [{ ...fit("B", 30), color: "#E69F00" }] };
  const blockFills = (c: HTMLElement) => [...c.querySelectorAll("text")]
    .filter((t) => (t.textContent ?? "").includes("Hill = 1.1"))
    .map((t) => t.getAttribute("fill"));
  const doc = (p: Plot) => {
    const d = new MadyDocument({ schemaVersion: 4, tables: [table], plots: [p], analyses: [], log: [], workspace: { folders: [], loose: [] } });
    d.applyStylePreset("p", findPreset("MadY default")!);
    return buildPlotScene(table, d.toJSON().plots[0]!, { width: 720, height: 500 });
  };

  it("with two fits on the graph, the single fit's block wears its curve's colour like the other one", () => {
    const s = doc(two);
    expect(s.fit?.params && s.fits?.[0]?.params, "the fixture draws both blocks").toBeTruthy();
    const { container } = render(<PlotFigure scene={s} />);
    expect(blockFills(container).sort()).toEqual([s.fit!.color, s.fits![0]!.color].sort());
  });

  it("a graph with one fit keeps its block in the text colour", () => {
    const s = doc({ ...plot, fit: { ...fit("A", 2), color: "#0072B2" }, fits: [] });
    const { container } = render(<PlotFigure scene={s} />);
    const fills = blockFills(container);
    expect(fills.length, "the block is drawn").toBe(1);
    expect(fills[0]).not.toBe(s.fit!.color);
  });
});

describe("a potency label is drawn in its own curve's colour", () => {
  // With two or more fits the labels are placed clear of the curves, so a label can sit nearer
  // another curve than its own; its colour is what says which curve it belongs to. A preset that
  // colours the tick labels (MadY default: black) must not take that away.
  const styled = (patch: Partial<Plot> = {}) => {
    const doc = new MadyDocument({ schemaVersion: 4, tables: [table], plots: [{ ...plot, ...patch }], analyses: [], log: [], workspace: { folders: [], loose: [] } });
    doc.applyStylePreset("p", findPreset("MadY default")!);
    const p = doc.toJSON().plots[0]!;
    return buildPlotScene(table, p, { width: 720, height: 500 });
  };
  const labelFill = (c: HTMLElement, text: string) => [...c.querySelectorAll("text")].find((t) => (t.textContent ?? "").trim() === text)?.getAttribute("fill");

  it("under a preset that colours the tick labels, each label takes its fit's colour", () => {
    const s = styled();
    expect(s.fonts.tick.color, "the fixture's preset colours the tick labels — else it cannot show the defect").not.toBeNull();
    const { container } = render(<PlotFigure scene={s} />);
    expect(labelFill(container, "EC50 = 2 µM")).toBe(s.fits![0]!.marker!.color);
    expect(labelFill(container, "EC50 = 30 µM")).toBe(s.fits![1]!.marker!.color);
    expect(s.fits![0]!.marker!.color).not.toBe(s.fits![1]!.marker!.color);
  });
  it("a colour set on the label itself still wins", () => {
    const s = styled({ refLineLabelFonts: { "fit-marker": { color: "#123456" } } });
    const { container } = render(<PlotFigure scene={s} />);
    expect(labelFill(container, "EC50 = 2 µM")).toBe("#123456");
  });
});
