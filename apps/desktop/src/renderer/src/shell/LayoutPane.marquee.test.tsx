// @vitest-environment jsdom
// Marquee selection, Ctrl+A and Ctrl+D on the assembler canvas — the usual way to select
// objects on a slide-style canvas. A press on empty canvas (the root itself) and a drag past the click slop
// rubber-bands the panels whose cards it touches; Shift adds; a click on nothing clears the
// selection. Ctrl+A selects every panel; Ctrl+D duplicates the selection through the same
// handler the ⧉ button uses. Presses that start on a panel or an object are theirs, not the
// canvas's, and the arrow nudge still ignores every modifier chord.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { FigureLayout } from "@mady/core";
import { LayoutPane, marqueeHits } from "./panes";
import { proj } from "./layoutPaneFixture";

afterEach(cleanup);

const ed = { selectedPlot: null, selection: null, onSelectPanel: () => {}, onSelect: () => {} };
const mount = (over: Partial<FigureLayout> = {}, extra: Record<string, unknown> = {}) => {
  const onSet = vi.fn();
  const onDuplicatePanel = vi.fn();
  const r = render(
    <LayoutPane
      project={proj({ panels: ["A", "B"], freeform: true, panelPositions: { A: { x: 100, y: 40 }, B: { x: 500, y: 40 } }, ...over })}
      layoutId="L" onRemovePanel={() => {}} onOpenPlot={() => {}} onSetLayoutOptions={onSet} onDuplicatePanel={onDuplicatePanel} editing={ed as never} {...extra}
    />,
  );
  return { ...r, onSet, onDuplicatePanel };
};
const selected = (c: HTMLElement): string[] => [...c.querySelectorAll(".laypanel-arrsel")].map((p) => p.getAttribute("data-pid") ?? "?");
const canvas = (c: HTMLElement): HTMLElement => c.querySelector(".laycanvas") as HTMLElement;
/** A rubber-band from (x0,y0) to (x1,y1) in client px (jsdom's canvas rect is 0,0 → canvas px). */
const band = (c: HTMLElement, x0: number, y0: number, x1: number, y1: number, shift = false): void => {
  fireEvent.pointerDown(canvas(c), { clientX: x0, clientY: y0, button: 0, shiftKey: shift });
  fireEvent.pointerMove(window, { clientX: x1, clientY: y1 });
  fireEvent.pointerUp(window, { clientX: x1, clientY: y1, shiftKey: shift });
};

describe("marqueeHits", () => {
  const boxes = [{ id: "A", left: 100, top: 40, w: 396, h: 308 }, { id: "B", left: 500, top: 40, w: 396, h: 308 }];
  it("returns the boxes the rectangle touches, in any corner order", () => {
    expect(marqueeHits({ x0: 50, y0: 20, x1: 250, y1: 150 }, boxes)).toEqual(["A"]);
    expect(marqueeHits({ x0: 250, y0: 150, x1: 50, y1: 20 }, boxes)).toEqual(["A"]);
    expect(marqueeHits({ x0: 520, y0: 20, x1: 900, y1: 100 }, boxes)).toEqual(["B"]);
    expect(marqueeHits({ x0: 50, y0: 20, x1: 900, y1: 100 }, boxes)).toEqual(["A", "B"]);
  });
  it("misses when there is no overlap", () => {
    expect(marqueeHits({ x0: 0, y0: 0, x1: 50, y1: 20 }, boxes)).toEqual([]);
    expect(marqueeHits({ x0: 100, y0: 400, x1: 900, y1: 500 }, boxes)).toEqual([]);
  });
});

describe("the marquee on the canvas", () => {
  it("rubber-bands the panels it touches, and draws itself while dragging", () => {
    const { container } = mount();
    fireEvent.pointerDown(canvas(container), { clientX: 50, clientY: 20, button: 0 });
    fireEvent.pointerMove(window, { clientX: 250, clientY: 150 });
    expect(container.querySelector(".laymarquee")).not.toBeNull();
    fireEvent.pointerUp(window, { clientX: 250, clientY: 150 });
    expect(container.querySelector(".laymarquee")).toBeNull();
    expect(selected(container)).toEqual(["A"]);
  });
  it("Shift adds to the selection", () => {
    const { container } = mount();
    band(container, 50, 20, 250, 150);
    band(container, 480, 20, 900, 100, true);
    expect(selected(container).sort()).toEqual(["A", "B"]);
  });
  it("a click on empty canvas clears the selection; a press on a panel does not", () => {
    const { container } = mount();
    band(container, 50, 20, 900, 100);
    expect(selected(container)).toHaveLength(2);
    fireEvent.pointerDown(canvas(container), { clientX: 60, clientY: 500, button: 0 });
    fireEvent.pointerUp(window, { clientX: 60, clientY: 500 });
    expect(selected(container)).toEqual([]);
    band(container, 50, 20, 900, 100);
    const panel = container.querySelector(".laypanel") as HTMLElement;
    fireEvent.pointerDown(panel, { clientX: 120, clientY: 60, button: 0 });
    fireEvent.pointerUp(window, { clientX: 120, clientY: 60 });
    expect(selected(container)).toHaveLength(2);
  });
});

describe("Ctrl+A and Ctrl+D", () => {
  it("Ctrl+A selects every panel", () => {
    const { container } = mount();
    fireEvent.keyDown(window, { key: "a", ctrlKey: true });
    expect(selected(container).sort()).toEqual(["A", "B"]);
  });
  it("Ctrl+D duplicates the selected panels through the same handler as the button", () => {
    const { container, onDuplicatePanel } = mount();
    band(container, 50, 20, 250, 150);
    fireEvent.keyDown(window, { key: "d", ctrlKey: true });
    expect(onDuplicatePanel).toHaveBeenCalledTimes(1);
    expect(onDuplicatePanel).toHaveBeenCalledWith("A");
  });
  it("Ctrl+D does nothing with no selection, when the event was already handled, or without a handler", () => {
    const { onDuplicatePanel } = mount();
    fireEvent.keyDown(window, { key: "d", ctrlKey: true });
    expect(onDuplicatePanel).not.toHaveBeenCalled();
    const second = mount({}, { onDuplicatePanel: undefined });
    band(second.container, 50, 20, 250, 150);
    expect(() => fireEvent.keyDown(window, { key: "d", ctrlKey: true })).not.toThrow();
  });
  it("Ctrl+ArrowRight still does not nudge", () => {
    const { container, onSet } = mount();
    band(container, 50, 20, 250, 150);
    fireEvent.keyDown(window, { key: "ArrowRight", ctrlKey: true });
    expect(onSet).not.toHaveBeenCalled();
  });
});
