// @vitest-environment jsdom
// A text in the annotation layer can be double-clicked to edit, in a real browser.
//
// Guards against the layer (heatmap-style charts and every text object on the figure canvas) capturing the pointer
// on press. In a browser a captured press sends the following click / double-click to the capturing group, never to
// the `<text>` under it, so the text's double-click editor would never open — and the canvas has no other way to type
// a text's words. jsdom has no pointer capture, so the double-click test passes there regardless; what this file
// guards is the cause: no capture on press, and the drag still follows the pointer through window events (the same
// approach the legend and the brackets use).
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { Annotation, DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import { galleryItems } from "./gallery";

const capture = vi.fn();
// `clientToUser` goes through getScreenCTM, which jsdom lacks: without an identity stub every drag handler bows out
// at its null check and the drag test would pass or fail for the wrong reason (PlotFigure.zoom.test.tsx).
beforeAll(() => {
  const identity = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0, inverse() { return identity; } };
  (SVGElement.prototype as unknown as { getScreenCTM: () => unknown }).getScreenCTM = () => identity;
  (globalThis as unknown as { DOMPoint: unknown }).DOMPoint = class {
    constructor(public x: number, public y: number) {}
    matrixTransform(): { x: number; y: number } { return { x: this.x, y: this.y }; }
  };
});
beforeEach(() => {
  capture.mockReset();
  (Element.prototype as unknown as { setPointerCapture: unknown }).setPointerCapture = capture;
});
afterEach(cleanup);

const scene = () => {
  const g = galleryItems().find((x) => x.plot.kind === "heatmap")!;
  const a = { id: "t1", kind: "text", label: "Cluster A", x: 0.5, y: 0.2 } as Annotation;
  return buildPlotScene(g.table as DataTable, { ...(g.plot as Plot), annotations: [a] } as Plot, { width: 620, height: 420 });
};
const mount = () => {
  const onMove = vi.fn();
  const r = render(<PlotFigure scene={scene()} onMoveAnnotation={onMove} onEditText={() => {}} />);
  const text = r.container.querySelector('[data-ann-text="t1"]') as SVGTextElement;
  return { ...r, onMove, text };
};

describe("a text in the annotation layer (heatmap card)", () => {
  it("is drawn by the annotation layer (the fixture reaches the pointer-press code)", () => {
    const { text } = mount();
    // The layer's per-annotation group carries the move cursor and the press handler.
    expect(text.closest('g[style*="cursor"]')).not.toBeNull();
  });
  it("a press does not capture the pointer", () => {
    const { text } = mount();
    fireEvent.pointerDown(text, { clientX: 100, clientY: 50, pointerId: 1 });
    expect(capture).not.toHaveBeenCalled();
  });
  it("the drag follows the pointer through window events, and stops on release", () => {
    const { text, onMove } = mount();
    fireEvent.pointerDown(text, { clientX: 100, clientY: 50, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 140, clientY: 70, pointerId: 1 });
    expect(onMove).toHaveBeenCalledTimes(1);
    fireEvent.pointerUp(window, { clientX: 140, clientY: 70, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 200, clientY: 90, pointerId: 1 });
    expect(onMove).toHaveBeenCalledTimes(1);
  });
  it("a drag from its words selects no page text and starts no native text drag", () => {
    const { text } = mount();
    const g = text.closest('g[style*="cursor"]') as SVGGElement;
    expect(g.style.userSelect).toBe("none");
    expect(fireEvent.dragStart(text)).toBe(false); // false = the default (a native drag) was prevented
  });
  it("double-click opens the editor on its words", () => {
    const { text, container } = mount();
    fireEvent.doubleClick(text);
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("Cluster A");
  });
});
