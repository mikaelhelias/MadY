// @vitest-environment jsdom
/**
 * Axis numbers are easy to reformat (to scientific notation and the other formats).
 * The formats live in the Axis tab's Numbering group, which a click on the numbers has to
 * open (not Fonts). Checked here:
 *  1. clicking a value axis's numbers selects that axis with focus "numbers", and the Axis tab
 *     opens Numbering; clicking a category axis's names still goes to Fonts;
 *  2. right-clicking the numbers leads the graph's menu with the formats, ticks the current one,
 *     and writes the data axis (they swap on a horizontal chart) — and the drawing changes;
 *  3. one list feeds every format menu, so none can fall behind.
 */
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { createSampleDocument, MadyDocument, type DataTable, type NumberFormat, type Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import { Inspector } from "./Inspector";
import { GraphPane } from "./panes";
import { galleryItems, galleryLookup } from "./gallery";
import { NUMBER_FORMAT_CHOICES } from "./numberFormats";
import type { GraphSelection } from "./AppShell";

afterEach(cleanup);
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

const SIZE = { width: 640, height: 460 };
const card = (title: string) => {
  const g = galleryItems().find((x) => x.title === title);
  if (!g) throw new Error(`no gallery card "${title}"`);
  return { table: g.table as DataTable, plot: g.plot as Plot, lk: galleryLookup(g) };
};
const BAR = "Bar / column (+ error bars)";
const XY = "XY (points + fitted curve)";
const horizontal = (p: Plot): Plot => ({ ...p, barOrientation: "horizontal" }) as Plot;

/** The selection a click on the first drawn text matching `pick` emits. */
function clickSelection(c: ReturnType<typeof card>, plot: Plot, pick: (t: Element) => boolean): GraphSelection | undefined {
  const onSelect = vi.fn();
  const scene = buildPlotScene(c.table, plot, { ...SIZE, tables: c.lk });
  const { container } = render(<PlotFigure scene={scene} selected={null} onSelect={onSelect} />);
  const el = [...container.querySelectorAll("svg text")].find(pick);
  if (!el) throw new Error("no such text drawn");
  fireEvent.click(el);
  return onSelect.mock.calls.at(-1)?.[0] as GraphSelection | undefined;
}
const categoryName = (c: ReturnType<typeof card>) => {
  const names = new Set(c.table.rows.map((r) => String(r.cells[c.table.columns[0]!.id] ?? "")));
  return (t: Element) => names.has((t.textContent ?? "").trim());
};

describe("1. a click on the numbers opens Numbering; a click on names still opens Fonts", () => {
  it("vertical bar: Y numbers → numbers, X group names → labels", () => {
    const c = card(BAR);
    expect(clickSelection(c, c.plot, (t) => t.getAttribute("data-axis-numbers") === "y")).toEqual({ kind: "axis", axis: "y", focus: "numbers" });
    expect(clickSelection(c, c.plot, categoryName(c))).toEqual({ kind: "axis", axis: "x", focus: "labels" });
  });

  it("horizontal bar: the numbers run along the bottom (visual X) and are marked there", () => {
    const c = card(BAR);
    expect(clickSelection(c, horizontal(c.plot), (t) => t.getAttribute("data-axis-numbers") === "x")).toEqual({ kind: "axis", axis: "x", focus: "numbers" });
    expect(clickSelection(c, horizontal(c.plot), categoryName(c))).toEqual({ kind: "axis", axis: "y", focus: "labels" });
  });

  it("estimation: its X group names are names, not numbers (a linear axis lettered with names)", () => {
    const c = card("Estimation (Gardner-Altman)");
    expect(clickSelection(c, c.plot, (t) => t.textContent === "Difference")).toEqual({ kind: "axis", axis: "x", focus: "labels" });
    expect(clickSelection(c, c.plot, (t) => t.getAttribute("data-axis-numbers") === "y")).toEqual({ kind: "axis", axis: "y", focus: "numbers" });
  });

  it("scree: 'PC1 | PC2' on a linear axis are names, not numbers", () => {
    const c = card("Scree plot");
    expect(clickSelection(c, c.plot, (t) => t.textContent === "PC1")).toEqual({ kind: "axis", axis: "x", focus: "labels" });
  });

  it("every format, on a linear and a log axis, still reads as numbers — the menu survives any pick", () => {
    const bar = card(BAR);
    const xy = card(XY);
    for (const f of NUMBER_FORMAT_CHOICES.map((c) => c.value)) {
      const lin = { ...bar.plot, yAxis: { ...bar.plot.yAxis, format: f } } as Plot;
      const log = { ...xy.plot, yAxis: { ...xy.plot.yAxis, scale: "log10", format: f } } as Plot;
      for (const [c, plot, name] of [[bar, lin, "linear"], [xy, log, "log"]] as const) {
        const scene = buildPlotScene(c.table, plot, { ...SIZE, tables: c.lk });
        const { container, unmount } = render(<PlotFigure scene={scene} selected={null} onSelect={vi.fn()} />);
        const drawn = scene.y.ticks.filter((t) => !t.minor && t.label).map((t) => t.label);
        expect(container.querySelectorAll('[data-axis-numbers="y"]').length, `${f} on a ${name} axis (${drawn.join(" ")}) lost its numbers mark`).toBeGreaterThan(0);
        unmount();
      }
    }
  });

  it("XY chart: both axes print numbers", () => {
    const c = card(XY);
    expect(clickSelection(c, c.plot, (t) => t.getAttribute("data-axis-numbers") === "x")).toEqual({ kind: "axis", axis: "x", focus: "numbers" });
    expect(clickSelection(c, c.plot, (t) => t.getAttribute("data-axis-numbers") === "y")).toEqual({ kind: "axis", axis: "y", focus: "numbers" });
  });

  it("the Axis tab opens Numbering for focus 'numbers' only", () => {
    const c = card(BAR);
    const numberingOpen = (selection: GraphSelection): boolean => {
      const { container, unmount } = render(
        <Inspector {...({} as ComponentProps<typeof Inspector>)} activeSection="graphs" selection={selection as never} plot={c.plot} table={c.table}
          userPresets={[]} profileDefault={null} wholeGraph={false} onSetWholeGraph={() => {}} onSelect={vi.fn()} onSetAxis={vi.fn()} />,
      );
      const group = [...container.querySelectorAll("details")].find((d) => d.querySelector("summary")?.textContent?.startsWith("Numbering"));
      if (!group) throw new Error("the Axis tab has no Numbering group");
      const open = group.hasAttribute("open");
      unmount();
      return open;
    };
    expect(numberingOpen({ kind: "axis", axis: "y", focus: "numbers" })).toBe(true);
    expect(numberingOpen({ kind: "axis", axis: "y" })).toBe(false);
    expect(numberingOpen({ kind: "axis", axis: "y", focus: "labels" })).toBe(false);
  });
});

describe("2. the right-click menu on the numbers", () => {
  const pane = (plotPatch: Partial<Plot> = {}, extra: Record<string, unknown> = {}) => {
    const c = card(BAR);
    const doc = new MadyDocument({ ...createSampleDocument().toJSON(), tables: [c.table], plots: [{ ...c.plot, ...plotPatch } as Plot], analyses: [] });
    const p = doc.toJSON().plots[0]!;
    const onSetAxis = vi.fn((axis: "x" | "y" | "y2" | "y3", patch: object) => doc.setPlotAxis(p.id, axis, patch));
    const onSelect = vi.fn();
    const r = render(<GraphPane project={doc.toJSON()} plotId={p.id} onSetAxis={onSetAxis} onSelect={onSelect} onCopyPicture={vi.fn()} {...extra} />);
    const rerender = () => r.rerender(<GraphPane project={doc.toJSON()} plotId={p.id} onSetAxis={onSetAxis} onSelect={onSelect} onCopyPicture={vi.fn()} {...extra} />);
    return { ...r, c, doc, plotId: p.id, onSetAxis, onSelect, rerender };
  };
  const menu = (root: HTMLElement) => root.querySelector('[role="menu"][aria-label="Graph"]');
  const items = (root: HTMLElement) => [...menu(root)!.querySelectorAll("button")];
  const numbersOf = (root: HTMLElement, axis: string) => [...root.querySelectorAll(`[data-axis-numbers="${axis}"]`)].map((t) => t.textContent ?? "");

  it("leads with every format, ticks the current one, and keeps Copy below", () => {
    const { container } = pane();
    fireEvent.contextMenu(container.querySelector('[data-axis-numbers="y"]')!);
    const labels = items(container).map((b) => b.textContent);
    expect(labels).toEqual(["Auto", ...NUMBER_FORMAT_CHOICES.map((c) => c.label), "More numbering options…", "Copy as picture"]);
    expect(items(container).filter((b) => b.getAttribute("aria-checked") === "true").map((b) => b.textContent)).toEqual(["Auto"]);
  });

  it("picking E notation writes the Y axis and the drawn numbers change", () => {
    const r = pane();
    expect(numbersOf(r.container, "y").some((s) => s.includes("E")), "E-style before any pick").toBe(false);
    fireEvent.contextMenu(r.container.querySelector('[data-axis-numbers="y"]')!);
    fireEvent.click(items(r.container).find((b) => b.textContent === "E notation (1.5E3)")!);
    expect(r.onSetAxis).toHaveBeenCalledWith("y", { format: "enotation" });
    expect(menu(r.container)).toBeNull();
    r.rerender();
    const drawn = numbersOf(r.container, "y").filter((s) => s !== "0");
    expect(drawn.length).toBeGreaterThan(0);
    expect(drawn.every((s) => /^\d+(\.\d+)?E-?\d+$/.test(s)), drawn.join(" | ")).toBe(true);
    // …and the menu now ticks it.
    fireEvent.contextMenu(r.container.querySelector('[data-axis-numbers="y"]')!);
    expect(items(r.container).filter((b) => b.getAttribute("aria-checked") === "true").map((b) => b.textContent)).toEqual(["E notation (1.5E3)"]);
  });

  it("horizontal bar: the bottom numbers are the VALUE axis, so the pick writes yAxis", () => {
    const r = pane({ barOrientation: "horizontal" } as Partial<Plot>);
    fireEvent.contextMenu(r.container.querySelector('[data-axis-numbers="x"]')!);
    fireEvent.click(items(r.container).find((b) => b.textContent === "Short (1.5k, 2M)")!);
    expect(r.onSetAxis).toHaveBeenCalledWith("y", { format: "si" });
  });

  it("'Auto' clears the format", () => {
    const r = pane({ yAxis: { ...card(BAR).plot.yAxis, format: "scientific" } } as Partial<Plot>);
    fireEvent.contextMenu(r.container.querySelector('[data-axis-numbers="y"]')!);
    fireEvent.click(items(r.container).find((b) => b.textContent === "Auto")!);
    expect(r.onSetAxis).toHaveBeenCalledWith("y", { format: undefined });
  });

  it("'More numbering options…' opens the Axis tab at Numbering", () => {
    const r = pane();
    fireEvent.contextMenu(r.container.querySelector('[data-axis-numbers="y"]')!);
    fireEvent.click(items(r.container).find((b) => b.textContent === "More numbering options…")!);
    expect(r.onSelect).toHaveBeenCalledWith({ kind: "axis", axis: "y", focus: "numbers" });
  });

  it("a right-click on a category NAME, or on empty graph, offers no number formats", () => {
    const r = pane();
    const name = [...r.container.querySelectorAll("svg text")].find(categoryName(r.c))!;
    fireEvent.contextMenu(name);
    expect(items(r.container).map((b) => b.textContent)).toEqual(["Copy as picture"]);
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.contextMenu(r.container.querySelector(".graphzoom")!);
    expect(items(r.container).map((b) => b.textContent)).toEqual(["Copy as picture"]);
  });
});

describe("3. one list behind every format menu", () => {
  it("names every format but auto, each once", () => {
    const every: Array<Exclude<NumberFormat, "auto">> = ["decimal", "scientific", "enotation", "power10", "antilog", "si", "percent"];
    expect(NUMBER_FORMAT_CHOICES.map((c) => c.value).sort()).toEqual([...every].sort());
  });
});
