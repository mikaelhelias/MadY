// @vitest-environment jsdom
// Guides from the rulers + snap to grid on the assembler canvas.
// Drag from the left ruler → a vertical guide; from the top ruler → a horizontal guide. A guide
// can be dragged again; dropped back on its ruler, or double-clicked, it is removed. A dragged
// panel snaps to a guide like it snaps to another panel's edge. "Snap to grid" (shown only with
// the grid on) rounds a dragged panel's corner to the 32 px grid on any axis that did not already
// snap to an edge or guide. Both are editing aids: never in a figure template.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { FigureLayout } from "@mady/core";
import { applyGridSnap, GRID_STEP, LayoutPane, snapPanels } from "./panes";
import { captureFigureTemplate, FIGURE_TEMPLATE_KEYS } from "./figureTemplates";
import { proj } from "./layoutPaneFixture";

afterEach(cleanup);

const ed = { selectedPlot: null, selection: null, onSelectPanel: () => {}, onSelect: () => {} };
const mount = (over: Partial<FigureLayout> = {}, withSetter = true) => {
  const onSet = vi.fn();
  const r = render(
    <LayoutPane
      project={proj({ panels: ["A", "B"], freeform: true, panelPositions: { A: { x: 100, y: 40 }, B: { x: 600, y: 40 } }, ...over })}
      layoutId="L" onRemovePanel={() => {}} onOpenPlot={() => {}} {...(withSetter ? { onSetLayoutOptions: onSet } : {})} editing={ed as never}
    />,
  );
  return { ...r, onSet };
};
/** The ruler bands: [0] = top (horizontal guides), [1] = left (vertical guides). */
const rulers = (c: HTMLElement): SVGSVGElement[] => [...c.querySelectorAll<SVGSVGElement>("svg.layruler")];
const guides = (c: HTMLElement, axis: "v" | "h"): HTMLElement[] => [...c.querySelectorAll<HTMLElement>(`.layguide-${axis}`)];
/** jsdom lays every element at 0,0, so a client coordinate IS a canvas coordinate. */
const dragTo = (from: Element, x0: number, y0: number, x1: number, y1: number): void => {
  fireEvent.pointerDown(from, { clientX: x0, clientY: y0, button: 0 });
  fireEvent.pointerMove(window, { clientX: x1, clientY: y1 });
  fireEvent.pointerUp(window, { clientX: x1, clientY: y1 });
};

describe("snapPanels with guides", () => {
  it("a guide is a snap target like a panel edge", () => {
    const out = snapPanels(200, 500, 100, 100, [], 2000, 2000, 6, undefined, { v: [203] });
    expect(out.x).toBe(203);
    expect(out.vx).toBe(203);
    const h = snapPanels(900, 300, 100, 100, [], 2000, 2000, 6, undefined, { h: [405] });
    expect(h.y).toBe(305); // the panel's bottom edge (300 + 100) meets the guide at 405
    expect(h.hy).toBe(405);
  });
  it("without guides the result is unchanged", () => {
    const out = snapPanels(200, 500, 100, 100, [], 2000, 2000, 6);
    expect(out.x).toBe(200);
    expect(out.vx).toBeUndefined();
  });
});

describe("applyGridSnap", () => {
  it("rounds an axis with no snap hit to the grid", () => {
    expect(GRID_STEP).toBe(32);
    expect(applyGridSnap({ x: 37, y: 50 }, GRID_STEP)).toEqual({ x: 32, y: 64 });
  });
  it("leaves an axis that already snapped to an edge or a guide", () => {
    expect(applyGridSnap({ x: 37, y: 50, vx: 37 }, GRID_STEP)).toEqual({ x: 37, y: 64 });
    expect(applyGridSnap({ x: 37, y: 50, hy: 150 }, GRID_STEP)).toEqual({ x: 32, y: 50 });
  });
});

describe("guides dragged from the rulers", () => {
  it("the LEFT ruler makes a vertical guide where it is dropped", () => {
    const { container, onSet } = mount();
    dragTo(rulers(container)[1]!, 5, 100, 300, 120);
    expect(onSet).toHaveBeenLastCalledWith({ guides: { v: [300] } });
  });
  it("the TOP ruler makes a horizontal guide", () => {
    const { container, onSet } = mount();
    dragTo(rulers(container)[0]!, 100, 5, 120, 250);
    expect(onSet).toHaveBeenLastCalledWith({ guides: { h: [250] } });
  });
  it("a guide shows on the canvas while it is dragged", () => {
    const { container } = mount();
    fireEvent.pointerDown(rulers(container)[1]!, { clientX: 5, clientY: 100, button: 0 });
    fireEvent.pointerMove(window, { clientX: 300, clientY: 100 });
    expect(guides(container, "v")).toHaveLength(1);
    fireEvent.pointerUp(window, { clientX: 300, clientY: 100 });
  });
  it("a new guide dropped back on the ruler adds nothing", () => {
    const { container, onSet } = mount();
    dragTo(rulers(container)[1]!, 5, 100, -10, 100);
    expect(onSet).not.toHaveBeenCalled();
  });
  it("an existing guide drawn on the canvas can be moved", () => {
    const { container, onSet } = mount({ guides: { v: [300, 500] } });
    expect(guides(container, "v")).toHaveLength(2);
    dragTo(guides(container, "v")[0]!, 300, 100, 340, 100);
    expect(onSet).toHaveBeenLastCalledWith({ guides: { v: [340, 500] } });
  });
  it("an existing guide dropped on the ruler is removed; the last one clears the field", () => {
    const { container, onSet } = mount({ guides: { v: [300], h: [200] } });
    dragTo(guides(container, "v")[0]!, 300, 100, -10, 100);
    expect(onSet).toHaveBeenLastCalledWith({ guides: { h: [200] } });
    cleanup();
    const second = mount({ guides: { v: [300] } });
    dragTo(guides(second.container, "v")[0]!, 300, 100, -10, 100);
    expect(second.onSet).toHaveBeenLastCalledWith({ guides: undefined });
  });
  it("double-clicking a guide removes it", () => {
    const { container, onSet } = mount({ guides: { h: [200, 260] } });
    fireEvent.doubleClick(guides(container, "h")[1]!);
    expect(onSet).toHaveBeenLastCalledWith({ guides: { h: [200] } });
  });
  it("with no way to save the figure the rulers stay inert and the guides only show", () => {
    const { container } = mount({ guides: { v: [300] } }, false);
    expect(rulers(container)[1]!.classList.contains("layruler-live")).toBe(false);
    expect(guides(container, "v")).toHaveLength(1);
    expect(rulers(mount().container)[1]!.classList.contains("layruler-live")).toBe(true);
  });
});

describe("the Snap to grid chip", () => {
  const chip = (c: HTMLElement): HTMLInputElement | undefined =>
    [...c.querySelectorAll<HTMLLabelElement>("label.laychip")].find((l) => l.textContent?.trim() === "Snap to grid")?.querySelector("input") ?? undefined;
  it("is shown only while the grid is on", () => {
    expect(chip(mount().container)).toBeDefined();
    cleanup();
    expect(chip(mount({ showGrid: false }).container)).toBeUndefined();
  });
  it("stores snapToGrid, and clears it when unticked", () => {
    const { container, onSet } = mount();
    fireEvent.click(chip(container)!);
    expect(onSet).toHaveBeenLastCalledWith({ snapToGrid: true });
    cleanup();
    const on = mount({ snapToGrid: true });
    fireEvent.click(chip(on.container)!);
    expect(on.onSet).toHaveBeenLastCalledWith({ snapToGrid: undefined });
  });
});

describe("a dragged panel with guides and the grid", () => {
  const dragPanel = (c: HTMLElement, dx: number, dy: number): void => {
    const panel = c.querySelector('.laypanel[data-pid="A"]') as HTMLElement;
    fireEvent.pointerDown(panel, { clientX: 0, clientY: 0, button: 0 });
    fireEvent.pointerMove(window, { clientX: dx, clientY: dy });
    fireEvent.pointerUp(window, { clientX: dx, clientY: dy });
  };
  const posA = (onSet: ReturnType<typeof vi.fn>): { x: number; y: number } =>
    (onSet.mock.calls.at(-1)![0] as { panelPositions: Record<string, { x: number; y: number }> }).panelPositions.A!;
  it("snaps its left edge to a guide", () => {
    const { container, onSet } = mount({ guides: { v: [253] } });
    dragPanel(container, 150, 0); // 100 → 250, the guide at 253 is within reach
    expect(posA(onSet).x).toBe(253);
  });
  it("with Snap to grid on, lands on a multiple of 32; off, lands where it was dropped", () => {
    const on = mount({ snapToGrid: true });
    dragPanel(on.container, 137, 1000);
    const p = posA(on.onSet);
    expect(p.x % 32).toBe(0);
    expect(p.y % 32).toBe(0);
    cleanup();
    const off = mount();
    dragPanel(off.container, 137, 1000);
    expect(posA(off.onSet)).toEqual({ x: 237, y: 1040 });
  });
  it("Snap to grid does nothing while the grid is hidden", () => {
    const { container, onSet } = mount({ snapToGrid: true, showGrid: false });
    dragPanel(container, 137, 1000);
    expect(posA(onSet)).toEqual({ x: 237, y: 1040 });
  });
});

describe("guides and Snap to grid are editing aids", () => {
  it("never go into a figure template", () => {
    const t = captureFigureTemplate({ id: "L", name: "F", panels: [], guides: { v: [10] }, snapToGrid: true });
    expect(t).not.toHaveProperty("guides");
    expect(t).not.toHaveProperty("snapToGrid");
    expect(FIGURE_TEMPLATE_KEYS).not.toContain("guides");
    expect(FIGURE_TEMPLATE_KEYS).not.toContain("snapToGrid");
  });
});
