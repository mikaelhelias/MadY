// @vitest-environment jsdom
/**
 * Bar value labels — position choice + magnetic alignment. A label can sit above the bar, inside
 * its end, or inside its base (still inside the bar, clear of the X axis); a label dragged near
 * another label's line snaps to it and shows a dashed guide line while dragging.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure, valueLabelPlace } from "./PlotFigure";
import { catTable } from "./plot-fixtures";

afterEach(cleanup);

const barPlot = (over: Partial<Plot> = {}): Plot => ({ id: "p", name: "P", source: catTable.id, kind: "bar", showValues: true, ...over }) as Plot;
const build = (over: Partial<Plot> = {}) => buildPlotScene(catTable, barPlot(over), { width: 620, height: 420 });
const sceneOf = (placement?: "above" | "insideEnd" | "insideBase", horizontal = false) =>
  ({ barHorizontal: horizontal, valueLabels: { dy: 0, placement }, fonts: { valueLabel: { size: 12 } } });
const tallBar = { x: 100, y: 100, w: 40, h: 200 }; // foot at y = 300 (the axis)

describe("valueLabelPlace — the resting position per placement", () => {
  it("above = the default position: 4 px over the bar's top", () => {
    expect(valueLabelPlace(sceneOf(undefined), tallBar, 5, "5")).toEqual({ anchor: "middle", baseX: 120, baseY: 96, placement: "above" });
    expect(valueLabelPlace(sceneOf("above"), tallBar, 5, "5").baseY).toBe(96);
  });
  it("insideEnd tucks the label under the bar's top; insideBase sits it just above the foot, off the axis", () => {
    const end = valueLabelPlace(sceneOf("insideEnd"), tallBar, 5, "5");
    expect(end.baseY).toBe(100 + 12 + 2);
    const base = valueLabelPlace(sceneOf("insideBase"), tallBar, 5, "5");
    expect(base.baseY).toBe(300 - 4); // baseline 4 px above the foot → the glyphs sit inside the bar, clear of the axis
    expect(base.baseY).toBeLessThan(300);
  });
  it("a bar too short to hold the text falls back to Above (the number is never hidden)", () => {
    const stub = { x: 100, y: 290, w: 40, h: 10 };
    expect(valueLabelPlace(sceneOf("insideBase"), stub, 1, "1").placement).toBe("above");
    expect(valueLabelPlace(sceneOf("insideBase"), stub, 1, "1").baseY).toBe(286);
  });
  it("horizontal bars: insideBase starts at the bar's left edge, insideEnd ends at its right edge", () => {
    const hbar = { x: 100, y: 50, w: 200, h: 30 };
    expect(valueLabelPlace(sceneOf("insideBase", true), hbar, 5, "5")).toMatchObject({ anchor: "start", baseX: 104 });
    expect(valueLabelPlace(sceneOf("insideEnd", true), hbar, 5, "5")).toMatchObject({ anchor: "end", baseX: 296 });
    expect(valueLabelPlace(sceneOf("above", true), hbar, 5, "5")).toMatchObject({ anchor: "start", baseX: 304 });
  });
});

// Note: a visible value label is drawn in the figure's text layer, a sibling of the plot's clip,
// so that dragging it off the plot cannot cut it (`on-data-text-unclipped.test.tsx`).
// These cases are about where the label sits and how it snaps, never about which group holds it, so
// they look in both places — narrowing them to one group would hide the labels, not a bug.
describe("the drawing honours plot.valuePlacement", () => {
  const labelYs = (placement?: Plot["valuePlacement"]) => {
    const scene = build(placement ? { valuePlacement: placement } : {});
    const { container } = render(<PlotFigure scene={scene} zoom={1} />);
    const bars = [...container.querySelectorAll<SVGRectElement>("svg .gfx-series rect")].filter((r) => Number(r.getAttribute("height")) > 5);
    const texts = [...container.querySelectorAll<SVGTextElement>("svg .gfx-series text, svg .gfx-textlayer text")];
    return { bars, texts };
  };
  it("insideBase puts every label between its bar's top and its foot; above puts it over the top", () => {
    const above = labelYs();
    const inside = labelYs("insideBase");
    expect(above.texts.length, "fixture draws no value labels").toBeGreaterThan(0);
    expect(inside.texts.length).toBe(above.texts.length);
    // The fixture's bars are tall enough (>= 20 px) for the label to move inside.
    for (let i = 0; i < inside.texts.length; i++) {
      const yIn = Number(inside.texts[i]!.getAttribute("y"));
      const yAb = Number(above.texts[i]!.getAttribute("y"));
      expect(yIn, `label ${i} did not move down into the bar`).toBeGreaterThan(yAb);
    }
  });
});

describe("magnetic alignment while dragging", () => {
  // The drag state is applied on the next animation frame (useRafState) — wait one out.
  const frame = () => act(() => new Promise<void>((r) => setTimeout(r, 40)));
  it("dragging a label to within 6 px of another label's line snaps to it and draws a dashed guide; the drop persists the snapped value", async () => {
    const scene = build();
    const onMove = vi.fn();
    const { container } = render(<PlotFigure scene={scene} zoom={1} onMoveValueLabel={onMove} />);
    const texts = [...container.querySelectorAll<SVGTextElement>("svg .gfx-series text, svg .gfx-textlayer text")];
    expect(texts.length).toBeGreaterThanOrEqual(2);
    const a = texts[0]!;
    const b = texts[1]!;
    const yA = Number(a.getAttribute("y"));
    const yB = Number(b.getAttribute("y"));
    expect(yA).not.toBe(yB); // the fixture's bars differ in height, so their labels sit at different y
    // Drag A vertically to 4 px short of B's line (jsdom: renderScale() falls back to 1).
    // Client px → scene px goes through renderScale(); in jsdom the SVG has no layout, so measure
    // the scale from a probe move instead of assuming 1.
    fireEvent.pointerDown(a, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(a, { clientX: 100, clientY: 200, pointerId: 1 });
    await frame();
    const probeDy = Number(a.getAttribute("y")) - yA; // 100 client px → this many scene px
    const scale = 100 / probeDy;
    fireEvent.pointerMove(a, { clientX: 100, clientY: 100 + ((yB - yA) - 4) * scale, pointerId: 1 });
    await frame();
    // The guide is drawn through B's line and A now sits on it.
    const guide = container.querySelector<SVGLineElement>("line.gfx-vl-guide");
    expect(guide, "no magnetic guide line while snapped").not.toBeNull();
    expect(Number(guide!.getAttribute("y1"))).toBeCloseTo(yB, 5);
    expect(Number(a.getAttribute("y"))).toBeCloseTo(yB, 5);
    fireEvent.pointerUp(a, { clientX: 100, clientY: 100 + ((yB - yA) - 4) * scale, pointerId: 1 });
    await frame();
    // Persisted delta = the snapped delta (yB − yA), not the raw pointer delta (yB − yA − 4).
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove.mock.calls[0]![3]).toBe(Math.round(yB - yA));
    expect(container.querySelector("line.gfx-vl-guide"), "the guide must vanish after the drop").toBeNull();
  });
  it("far from any other label there is no snap and no guide", async () => {
    const scene = build();
    const onMove = vi.fn();
    const { container } = render(<PlotFigure scene={scene} zoom={1} onMoveValueLabel={onMove} />);
    const a = container.querySelector<SVGTextElement>("svg .gfx-series text, svg .gfx-textlayer text")!;
    fireEvent.pointerDown(a, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(a, { clientX: 100, clientY: 400, pointerId: 1 });
    await frame();
    expect(container.querySelector("line.gfx-vl-guide")).toBeNull();
    fireEvent.pointerUp(a, { clientX: 100, clientY: 400, pointerId: 1 });
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove.mock.calls[0]![3]).toBeGreaterThan(0); // moved down, unsnapped
  });
});
