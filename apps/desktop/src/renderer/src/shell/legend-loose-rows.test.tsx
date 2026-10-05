// @vitest-environment jsdom
/**
 * Loose legend rows — a legend block is always draggable and fully editable (font, font colour), and its rows can be
 * pulled apart and snapped back together:
 *  - Click a row once — it is picked (an outline). Dragging a picked row pulls it out of the block; dragging a row
 *    that is not picked moves the whole legend.
 *  - A loose row is drawn on its own where it was dropped (`Plot.legendLoose`, keyed by the row's built label — the key
 *    renaming uses) and keeps everything a row does: its key, its words, its click, its rename. The block closes the gap.
 *  - Dragged back within reach of the block, the block lights up and opens the row's own slot; let go, it returns
 *    there (the key is removed, so the order is the series order again).
 * Rows for lines listed in the legend keep their own rule (dragged out = the line leaves the legend).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import { galleryItems, galleryLookup } from "./gallery";
import { legendLooseSet } from "./legendLoose";
import type { GraphSelection } from "./AppShell";

afterEach(cleanup);

const SIZE = { width: 640, height: 480 };
const card = (name: string) => {
  const g = galleryItems().find((x) => x.plot.name === name || x.plot.id === name);
  if (!g) throw new Error(`no card ${name}`);
  return { table: g.table as DataTable, plot: g.plot as Plot, lk: galleryLookup(g) };
};
const BUMP = "p-bump"; // Team A–D
const TWO = "p-bar"; // Control / Treated
const sceneOf = (name: string, patch: Partial<Plot> = {}) => {
  const c = card(name);
  return buildPlotScene(c.table, { ...c.plot, ...patch } as Plot, { ...SIZE, tables: c.lk });
};
const draw = (name: string, patch: Partial<Plot> = {}) => {
  const onLegendLoose = vi.fn<(key: string, at: { x: number; y: number } | null) => void>();
  const onMoveLegend = vi.fn<(dx: number, dy: number) => void>();
  const onSelect = vi.fn<(s: GraphSelection) => void>();
  const r = render(
    <PlotFigure scene={sceneOf(name, patch)} onSelect={onSelect} onMoveLegend={onMoveLegend}
      legendDock={{ lines: new Set<string>(), set: vi.fn(), onLegendLoose }} />,
  );
  return { ...r, onLegendLoose, onMoveLegend, onSelect };
};
const rowOf = (c: HTMLElement, text: string) => c.querySelector(`.gfx-legend [data-mady-legend-row] text[data-legend-text="${text}"]`)!.closest("[data-mady-legend-row]")!;
const drag = (el: Element, dx: number, dy: number) => {
  fireEvent.pointerDown(el, { clientX: 0, clientY: 0, pointerId: 1 });
  fireEvent.pointerMove(window, { clientX: dx / 2, clientY: dy / 2, pointerId: 1 });
  fireEvent.pointerMove(window, { clientX: dx, clientY: dy, pointerId: 1 });
  fireEvent.pointerUp(window, { clientX: dx, clientY: dy, pointerId: 1 });
};
const pick = (el: Element) => fireEvent.click(el);

describe("loose rows — the builder", () => {
  it("untouched: nothing loose, every row in the block", () => {
    const s = sceneOf(BUMP);
    expect(s.legend.map((e) => e.label)).toEqual(["Team A", "Team B", "Team C", "Team D"]);
    expect(s.legendLayout.looseEntries).toBeUndefined();
  });

  it("a loose row leaves the block (which closes the gap) and carries its place and its own slot", () => {
    const s = sceneOf(BUMP, { legendLoose: { "Team C": { x: 100, y: 200 } } } as Partial<Plot>);
    expect(s.legend.map((e) => e.label)).toEqual(["Team A", "Team B", "Team D"]);
    expect(s.legendLayout.looseEntries).toHaveLength(1);
    expect(s.legendLayout.looseEntries![0]).toMatchObject({ x: 100, y: 200, index: 2, entry: { label: "Team C" } });
  });

  it("pulling one row out of a two-row legend keeps the other row's block", () => {
    const s = sceneOf(TWO, { legendLoose: { Treated: { x: 50, y: 60 } } } as Partial<Plot>);
    expect(s.legend.map((e) => e.label)).toEqual(["Control"]);
    expect(s.legendLayout.looseEntries?.map((l) => l.entry.label)).toEqual(["Treated"]);
  });

  it("a renamed row is still found by the label it was built with", () => {
    const s = sceneOf(BUMP, { legendLabels: { "Team C": "Charlie" }, legendLoose: { "Team C": { x: 1, y: 2 } } } as Partial<Plot>);
    expect(s.legendLayout.looseEntries![0]!.entry.label).toBe("Charlie");
  });

  // A legend key matches its mark — a loose row's too: its key is exactly the key it had in the block.
  // The ordination's dots draw no line, so its loose row must not draw one either (the choke-point key passes must
  // cover loose rows, not only the block).
  it.each([[BUMP, "Team C"], ["PCoA — treatment ordination", "Drug A"], [TWO, "Treated"]])("%s: loose %s keeps exactly its block key", (name, row) => {
    const inBlock = sceneOf(name).legend.find((e) => e.label === row)!;
    expect(inBlock, "no such row - this proves nothing").toBeDefined();
    const loose = sceneOf(name, { legendLoose: { [row]: { x: 10, y: 20 } } } as Partial<Plot>).legendLayout.looseEntries![0]!.entry;
    expect(loose).toEqual(inBlock);
  });

  it("a hidden legend hides its loose rows too", () => {
    const s = sceneOf(BUMP, { legend: { position: "none" }, legendLoose: { "Team C": { x: 1, y: 2 } } } as Partial<Plot>);
    expect(s.legendLayout.looseEntries ?? []).toEqual([]);
  });
});

describe("loose rows — the drawing and the gestures", () => {
  it("a loose row is drawn on its own at its place, with its key and words", () => {
    const { container } = draw(BUMP, { legendLoose: { "Team C": { x: 100, y: 200 } } } as Partial<Plot>);
    const loose = container.querySelector('[data-legend-loose="Team C"]');
    expect(loose, "no loose row drawn").not.toBeNull();
    expect(loose!.querySelector("text")!.textContent).toBe("Team C");
    expect(loose!.querySelector("line, circle, rect.gfx-legbar"), "no key").not.toBeNull();
    expect(Number(loose!.querySelector("text")!.getAttribute("x"))).toBeGreaterThan(100);
  });

  // A loose row sits over the data: drawn last in the figure's <svg>, above every layer (otherwise, on the ordination,
  // an overlay painted after the legend would catch every press on a loose row over the plot).
  it.each([BUMP, "PCoA — treatment ordination"])("%s: loose rows are the last thing drawn", (name) => {
    const s0 = sceneOf(name);
    const key = s0.legend[0]!.labelKey ?? s0.legend[0]!.label;
    const { container } = draw(name, { legendLoose: { [key]: { x: 100, y: 200 } } } as Partial<Plot>);
    const svg = container.querySelector("svg.gfx-figure")!;
    expect(svg.lastElementChild?.querySelector(`[data-legend-loose="${key}"]`), "a loose row drawn under later layers").not.toBeNull();
  });

  it("every row gone loose: the rows are still drawn, the empty block draws nothing but keeps a place to come home to", () => {
    const all = Object.fromEntries(["Team A", "Team B", "Team C", "Team D"].map((t, i) => [t, { x: 50, y: 40 + 30 * i }]));
    const { container, onLegendLoose } = draw(BUMP, { legendLoose: all } as Partial<Plot>);
    expect(container.querySelectorAll("[data-legend-loose]")).toHaveLength(4);
    const block = [...container.querySelectorAll(".gfx-legend")].find((g) => !g.hasAttribute("data-legend-loose"))!;
    expect(block.querySelectorAll("[data-mady-legend-row]"), "rows drawn in an empty block").toHaveLength(0);
    // …and a loose row dropped on its home spot goes back.
    const box = block.querySelector("[data-legend-box]")!;
    const bx = Number(box.getAttribute("x")), by = Number(box.getAttribute("y"));
    drag(container.querySelector('[data-legend-loose="Team A"] [data-mady-legend-row]')!, bx + 5 - 50, by + 5 - 40);
    expect(onLegendLoose).toHaveBeenLastCalledWith("Team A", null);
  });

  it("dragging a row that is not picked moves the whole legend", () => {
    const { container, onLegendLoose, onMoveLegend } = draw(BUMP);
    drag(rowOf(container, "Team C"), -200, 150);
    expect(onMoveLegend).toHaveBeenCalled();
    expect(onLegendLoose).not.toHaveBeenCalled();
  });

  it("click picks a row (outline); dragging it out makes it loose where it was dropped", () => {
    const { container, onLegendLoose, onMoveLegend } = draw(BUMP);
    const row = rowOf(container, "Team C");
    pick(row);
    expect(container.querySelector('[data-legend-picked="Team C"]'), "no outline on the picked row").not.toBeNull();
    const top = Number(row.querySelector("rect")!.getAttribute("y"));
    drag(rowOf(container, "Team C"), -200, 150);
    expect(onMoveLegend).not.toHaveBeenCalled();
    expect(onLegendLoose).toHaveBeenCalledTimes(1);
    const [key, at] = onLegendLoose.mock.calls[0]!;
    expect(key).toBe("Team C");
    expect(at, "it was put back instead of pulled out").not.toBeNull();
    expect(at!.y).toBeGreaterThan(top + 100);
  });

  it("a picked row let go inside the block stays in the block", () => {
    const { container, onLegendLoose } = draw(BUMP);
    pick(rowOf(container, "Team C"));
    drag(rowOf(container, "Team C"), 4, 5);
    expect(onLegendLoose).not.toHaveBeenCalled();
  });

  it("a loose row drags to a new place; dragged back onto the block it goes home", () => {
    const { container, onLegendLoose } = draw(BUMP, { legendLoose: { "Team C": { x: 100, y: 300 } } } as Partial<Plot>);
    const loose = () => container.querySelector('[data-legend-loose="Team C"] [data-mady-legend-row]')!;
    drag(loose(), 30, 20);
    expect(onLegendLoose).toHaveBeenLastCalledWith("Team C", { x: 130, y: 320 });
    const box = container.querySelector("[data-legend-box]")!;
    const bx = Number(box.getAttribute("x")), by = Number(box.getAttribute("y"));
    drag(loose(), bx + 10 - 100, by + 10 - 300);
    expect(onLegendLoose).toHaveBeenLastCalledWith("Team C", null);
  });

  it("held near the block, the block lights up and opens the row's own slot", () => {
    const { container } = draw(BUMP, { legendLoose: { "Team C": { x: 100, y: 300 } } } as Partial<Plot>);
    const box = container.querySelector("[data-legend-box]")!;
    const bx = Number(box.getAttribute("x")), by = Number(box.getAttribute("y"));
    const el = container.querySelector('[data-legend-loose="Team C"] [data-mady-legend-row]')!;
    fireEvent.pointerDown(el, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: bx + 10 - 100, clientY: by + 10 - 300, pointerId: 1 });
    expect(container.querySelector("[data-legend-slot]"), "no slot opened").not.toBeNull();
    expect(container.querySelector("[data-legend-dock]"), "the block did not light up").not.toBeNull();
    fireEvent.pointerUp(window, { clientX: bx + 10 - 100, clientY: by + 10 - 300, pointerId: 1 });
    expect(container.querySelector("[data-legend-slot]")).toBeNull();
  });

  // Edge to edge: a row held just below the block (20 px under it, not on it) is within reach — it need not sit on the
  // rows to come home (its key's centre would be ~33 px away).
  it("a loose row held just under the block, clear of it, opens the slot", () => {
    const { container } = draw(BUMP, { legendLoose: { "Team C": { x: 100, y: 300 } } } as Partial<Plot>);
    const box = container.querySelector("[data-legend-box]")!;
    const bx = Number(box.getAttribute("x")), by = Number(box.getAttribute("y")), bh = Number(box.getAttribute("height"));
    const el = container.querySelector('[data-legend-loose="Team C"] [data-mady-legend-row]')!;
    fireEvent.pointerDown(el, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: bx - 100, clientY: by + bh + 20 - 300, pointerId: 1 });
    expect(container.querySelector("[data-legend-slot]"), "no slot for a row held just under the block").not.toBeNull();
    fireEvent.pointerUp(window, { clientX: bx - 100, clientY: by + bh + 20 - 300, pointerId: 1 });
  });

  it("clicking a loose row still opens its series", () => {
    const { container, onSelect } = draw(BUMP, { legendLoose: { "Team C": { x: 100, y: 300 } } } as Partial<Plot>);
    fireEvent.click(container.querySelector('[data-legend-loose="Team C"] [data-mady-legend-row]')!);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ kind: "series" }));
  });

  it("read-only (no writer, e.g. an export): loose rows are drawn, nothing picks or tears off", () => {
    const onMoveLegend = vi.fn();
    const { container } = render(<PlotFigure scene={sceneOf(BUMP, { legendLoose: { "Team C": { x: 100, y: 300 } } } as Partial<Plot>)} onMoveLegend={onMoveLegend} />);
    expect(container.querySelector('[data-legend-loose="Team C"]')).not.toBeNull();
    fireEvent.click(rowOf(container, "Team A"));
    expect(container.querySelector("[data-legend-picked]")).toBeNull();
  });
});

describe("loose rows — what gets written", () => {
  it("adds, moves and puts back; the last one back clears the field", () => {
    expect(legendLooseSet({}, "A", { x: 1, y: 2 })).toEqual({ legendLoose: { A: { x: 1, y: 2 } } });
    expect(legendLooseSet({ legendLoose: { A: { x: 1, y: 2 }, B: { x: 3, y: 4 } } }, "A", { x: 5, y: 6 })).toEqual({ legendLoose: { A: { x: 5, y: 6 }, B: { x: 3, y: 4 } } });
    expect(legendLooseSet({ legendLoose: { A: { x: 1, y: 2 }, B: { x: 3, y: 4 } } }, "A", null)).toEqual({ legendLoose: { B: { x: 3, y: 4 } } });
    expect(legendLooseSet({ legendLoose: { A: { x: 1, y: 2 } } }, "A", null)).toEqual({ legendLoose: undefined });
  });

  it("positions are whole pixels", () => {
    expect(legendLooseSet({}, "A", { x: 1.6, y: 2.4 })).toEqual({ legendLoose: { A: { x: 2, y: 2 } } });
  });
});
