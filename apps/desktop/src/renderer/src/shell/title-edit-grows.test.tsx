// @vitest-environment jsdom
/**
 * Editing a graph title in place: the edit box grows with what is typed.
 *
 * The box opens as wide as the old title. A new title typed longer than that must widen the box, centred like the
 * title, so the words being typed stay in view; a box kept at the old width wraps them inside it and shows only the
 * last few letters.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";

afterEach(cleanup);

const table: DataTable = {
  id: "t", kind: "xy", name: "T",
  columns: [{ id: "x", name: "X", role: "x" }, { id: "y", name: "Y", role: "y" }],
  rows: [1, 2, 3].map((v, i) => ({ id: `r${i}`, cells: { x: v, y: v * 2 } })),
};
const plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "xy", title: "Bubble" } as unknown as Plot;

describe("the title's edit box grows with the typed title", () => {
  it("a longer title widens the box, growing both ways around the centred title", () => {
    const scene = buildPlotScene(table, plot, { width: 640, height: 420 });
    const { container: c } = render(<PlotFigure scene={scene} onEditText={() => {}} />);
    const title = [...c.querySelectorAll("text")].find((t) => (t.textContent ?? "").trim() === "Bubble");
    expect(title, "no title on the figure").toBeTruthy();
    // jsdom lays nothing out: every box is 0 × 0 at the corner, so the editor would open at the left edge with no
    // room to grow left. Give the title its place in the middle of a 640 px figure, as a browser would.
    const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
    // The hidden element the editor measures typed lines in stays unlaid-out (0 wide), so the editor falls back to its
    // width estimate for them.
    const real = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (this: Element) {
      if (this === title) return rect(290, 20, 60, 22);
      return this.tagName === "SPAN" ? rect(0, 0, 0, 0) : rect(0, 0, 640, 420);
    };
    try {
      fireEvent.doubleClick(title!);
      const box = c.querySelector<HTMLTextAreaElement | HTMLInputElement>(".gfx-textedit");
      expect(box, "the title's editor did not open").toBeTruthy();
      const opened = { left: parseFloat(box!.style.left), width: parseFloat(box!.style.width) };
      expect(opened.width, "the box has no width").toBeGreaterThan(0);
      expect(opened.left, "the box did not open over the title").toBeGreaterThan(250);

      fireEvent.change(box!, { target: { value: "Pathway enrichment (NES) by treatment" } });
      const grown = c.querySelector<HTMLTextAreaElement | HTMLInputElement>(".gfx-textedit")!;
      const now = { left: parseFloat(grown.style.left), width: parseFloat(grown.style.width) };
      expect(now.width, "the box kept the old title's width").toBeGreaterThan(opened.width * 3);
      expect(now.left, "a centred title's box did not grow to the left as well").toBeLessThan(opened.left);
      expect(now.left + now.width, "the box ran past the figure's right edge").toBeLessThanOrEqual(640);
    } finally {
      Element.prototype.getBoundingClientRect = real;
    }
  });

  it("grown to the figure's right edge, the box keeps the ✕ inside its right end, clear of the text", () => {
    const scene = buildPlotScene(table, plot, { width: 640, height: 420 });
    const { container: c } = render(<PlotFigure scene={scene} onEditText={() => {}} />);
    const title = [...c.querySelectorAll("text")].find((t) => (t.textContent ?? "").trim() === "Bubble")!;
    const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
    const real = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (this: Element) {
      if (this === title) return rect(290, 20, 60, 22);
      return this.tagName === "SPAN" ? rect(0, 0, 0, 0) : rect(0, 0, 640, 420);
    };
    try {
      fireEvent.doubleClick(title);
      const erase0 = c.querySelector<HTMLButtonElement>("button.texterase");
      expect(erase0, "fixture: a graph title's editor offers the ✕").toBeTruthy();
      const box = c.querySelector<HTMLTextAreaElement>(".gfx-textedit")!;
      expect(box.style.paddingRight || "1px", "a box short of the edge keeps its plain padding").toBe("1px");
      fireEvent.change(box, { target: { value: "A title much longer than the figure is wide, so that it has to wrap onto three lines" } });
      const grown = c.querySelector<HTMLTextAreaElement>(".gfx-textedit")!;
      const left = parseFloat(grown.style.left), width = parseFloat(grown.style.width);
      expect(left + width, "fixture: the box did not reach the figure's right edge").toBeGreaterThanOrEqual(639.5);
      const pad = parseFloat(grown.style.paddingRight);
      expect(pad, "no room kept for the ✕ at the box's right end").toBeGreaterThanOrEqual(20);
      const erase = parseFloat(c.querySelector<HTMLButtonElement>("button.texterase")!.style.left);
      expect(erase, "the ✕ sits over the text, left of the room kept for it").toBeGreaterThanOrEqual(left + width - pad);
      expect(erase, "the ✕ is outside the figure").toBeLessThan(640);
    } finally {
      Element.prototype.getBoundingClientRect = real;
    }
  });

  it("a title wider than the figure wraps, and the box is as tall as the wrapped lines", () => {
    const scene = buildPlotScene(table, plot, { width: 640, height: 420 });
    const { container: c } = render(<PlotFigure scene={scene} onEditText={() => {}} />);
    const title = [...c.querySelectorAll("text")].find((t) => (t.textContent ?? "").trim() === "Bubble")!;
    // jsdom lays out no text, so the box's content height is given: three wrapped lines for a long title, one otherwise.
    const desc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight");
    Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", { configurable: true, get(this: HTMLTextAreaElement) { return this.value.length > 60 ? 96 : 32; } });
    try {
      fireEvent.doubleClick(title);
      const box = c.querySelector<HTMLTextAreaElement>("textarea.gfx-textedit");
      expect(box, "the title's editor is not the multi-line box").toBeTruthy();
      expect(box!.style.height).toBe("32px");
      fireEvent.change(box!, { target: { value: "A title much longer than the figure is wide, so that it has to wrap onto three lines" } });
      expect(c.querySelector<HTMLTextAreaElement>("textarea.gfx-textedit")!.style.height, "the box stayed one line tall").toBe("96px");
    } finally {
      delete (HTMLTextAreaElement.prototype as unknown as Record<string, unknown>).scrollHeight;
      if (desc) Object.defineProperty(HTMLElement.prototype, "scrollHeight", desc);
    }
  });
});
