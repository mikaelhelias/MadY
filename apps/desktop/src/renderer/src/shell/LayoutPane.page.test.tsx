// @vitest-environment jsdom
// A page outline behind the assembler canvas. Pick a page
// (a journal column, A4, Letter or your own size) and its outline is drawn behind the panels,
// with a dashed inner margin; the canvas is at least the page. The page never moves a panel.
// In the plain flow grid there is no canvas to draw on, so the control is disabled there.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { FigureLayout } from "@mady/core";
import { LayoutPane } from "./panes";
import { captureFigureTemplate, FIGURE_TEMPLATE_KEYS } from "./figureTemplates";
import { proj } from "./layoutPaneFixture";

afterEach(cleanup);

const ed = { selectedPlot: null, selection: null, onSelectPanel: () => {}, onSelect: () => {} };
const mount = (over: Partial<FigureLayout> = {}) => {
  const onSet = vi.fn();
  const r = render(
    <LayoutPane
      project={proj({ panels: ["A", "B"], freeform: true, panelPositions: { A: { x: 100, y: 40 }, B: { x: 600, y: 40 } }, ...over })}
      layoutId="L" onRemovePanel={() => {}} onOpenPlot={() => {}} onSetLayoutOptions={onSet} editing={ed as never}
    />,
  );
  return { ...r, onSet };
};
const pageSelect = (c: HTMLElement): HTMLSelectElement =>
  [...c.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.textContent === "A4"))!;
const canvas = (c: HTMLElement): HTMLElement => c.querySelector(".laycanvas") as HTMLElement;

describe("the page outline", () => {
  it("is absent without a page", () => {
    const { container } = mount();
    expect(container.querySelector(".laypage")).toBeNull();
    expect(canvas(container).dataset.pageW).toBeUndefined();
  });
  it("is drawn with a page, and the canvas is at least the page; nothing is written on mount", () => {
    const { container, onSet } = mount({ page: { wMm: 210, hMm: 297, marginMm: 10 } });
    const page = container.querySelector(".laypage") as HTMLElement;
    expect(page).not.toBeNull();
    expect(page.style.width).toBe("794px");
    expect(page.style.height).toBe("1123px");
    expect(container.querySelector(".laypage-margin")).not.toBeNull();
    expect(parseFloat(canvas(container).style.width)).toBeGreaterThanOrEqual(794);
    expect(parseFloat(canvas(container).style.height)).toBeGreaterThanOrEqual(1123);
    expect(canvas(container).dataset.pageW).toBe("794");
    expect(canvas(container).dataset.pageH).toBe("1123");
    expect(onSet).not.toHaveBeenCalled();
  });
  it("no margin → no dashed inner outline", () => {
    const { container } = mount({ page: { wMm: 210, hMm: 297 } });
    expect(container.querySelector(".laypage-margin")).toBeNull();
  });
});

describe("the Page control", () => {
  it("picking A4 stores it; None clears it", () => {
    const { container, onSet } = mount();
    fireEvent.change(pageSelect(container), { target: { value: "A4" } });
    expect(onSet).toHaveBeenLastCalledWith({ page: { wMm: 210, hMm: 297 } });
    cleanup();
    const on = mount({ page: { wMm: 210, hMm: 297 } });
    expect(pageSelect(on.container).value).toBe("A4");
    fireEvent.change(pageSelect(on.container), { target: { value: "none" } });
    expect(on.onSet).toHaveBeenLastCalledWith({ page: undefined });
  });
  it("the swap button turns the page landscape, keeping the margin", () => {
    const { container, onSet } = mount({ page: { wMm: 210, hMm: 297, marginMm: 10 } });
    fireEvent.click(container.querySelector('button[title^="Swap the page"]')!);
    expect(onSet).toHaveBeenLastCalledWith({ page: { wMm: 297, hMm: 210, marginMm: 10 } });
  });
  it("a size that is no preset reads as Custom; its mm fields edit it", () => {
    const { container, onSet } = mount({ page: { wMm: 150, hMm: 200 } });
    expect(pageSelect(container).value).toBe("custom");
    const w = container.querySelector('input[title="Page width (mm)"]') as HTMLInputElement;
    fireEvent.change(w, { target: { value: "160" } });
    expect(onSet).toHaveBeenLastCalledWith({ page: { wMm: 160, hMm: 200 } });
    const m = container.querySelector('input[title="Page margin (mm): a dashed line inside the page"]') as HTMLInputElement;
    fireEvent.change(m, { target: { value: "12" } });
    expect(onSet).toHaveBeenLastCalledWith({ page: { wMm: 150, hMm: 200, marginMm: 12 } });
  });
  it("no mm fields and no swap button without a page", () => {
    const { container } = mount();
    expect(container.querySelector('input[title="Page width (mm)"]')).toBeNull();
    expect(container.querySelector('button[title^="Swap the page"]')).toBeNull();
  });
  it("is disabled in the plain flow grid, where there is no canvas to draw on", () => {
    const { container } = mount({ freeform: false });
    expect(container.querySelector(".laycanvas")).toBeNull(); // the fixture really is the flow grid
    expect(pageSelect(container).disabled).toBe(true);
  });
});

describe("the page is house style", () => {
  it("a figure template carries it", () => {
    const t = captureFigureTemplate({ id: "L", name: "F", panels: [], page: { wMm: 174, hMm: 235 } });
    expect(t.page).toEqual({ wMm: 174, hMm: 235 });
    expect(FIGURE_TEMPLATE_KEYS).toContain("page");
  });
});
