import { describe, expect, it } from "vitest";
import { cornerResize, graphDisplayScale, graphLayoutSize, scaleForResize } from "./graphDisplay";

describe("graphLayoutSize", () => {
  it("is the graph's own size, or 580 × 380", () => {
    expect(graphLayoutSize({})).toEqual({ width: 580, height: 380 });
    expect(graphLayoutSize({ figureWidth: 700, figureHeight: 460 })).toEqual({ width: 700, height: 460 });
  });
});

describe("graphDisplayScale", () => {
  it("the user's own scale wins, clamped to 0.25–4", () => {
    expect(graphDisplayScale({ displayScale: 0.6 }, { width: 870, height: 570 })).toBe(0.6);
    expect(graphDisplayScale({ displayScale: 9 })).toBe(4);
    expect(graphDisplayScale({ displayScale: 0.01 })).toBe(0.25);
  });
  it("an unsized graph takes the window fit as a scale of the default layout", () => {
    expect(graphDisplayScale({}, { width: 870, height: 570 })).toBeCloseTo(1.5, 6);
  });
  it("a graph with a size of its own is not fitted", () => {
    expect(graphDisplayScale({ figureWidth: 700 }, { width: 870, height: 570 })).toBe(1);
    expect(graphDisplayScale({})).toBe(1);
  });
});

describe("scaleForResize", () => {
  const drawing = { width: 580, height: 380 };
  it("dragging the right edge to half the width halves the scale", () => {
    expect(scaleForResize(1, drawing, { figureWidth: 290 })).toBeCloseTo(0.5, 6);
    expect(scaleForResize(2, drawing, { figureWidth: 290 })).toBeCloseTo(1, 6);
  });
  it("dragging the bottom edge scales by the height", () => {
    expect(scaleForResize(1, drawing, { figureHeight: 570 })).toBeCloseTo(1.5, 6);
  });
  it("a corner follows the edge that moved further, keeping the shape", () => {
    expect(scaleForResize(1, drawing, { figureWidth: 638, figureHeight: 570 })).toBeCloseTo(1.5, 6);
    expect(scaleForResize(1, drawing, { figureWidth: 290, figureHeight: 361 })).toBeCloseTo(0.5, 6);
  });
  it("stays within 0.25–4", () => {
    expect(scaleForResize(1, drawing, { figureWidth: 10 })).toBe(0.25);
    expect(scaleForResize(3, drawing, { figureWidth: 1160 })).toBe(4);
  });
});

describe("cornerResize — one direction for the whole corner drag", () => {
  const drawing = { width: 580, height: 380 };
  it("holds still until the pointer has moved a little, then follows the direction that moved further", () => {
    const drag = { start: 1, axis: null as "w" | "h" | null };
    expect(cornerResize(drag, 1, drawing, { figureWidth: 578, figureHeight: 379 })).toBe(1);
    expect(drag.axis).toBeNull();
    expect(cornerResize(drag, 1, drawing, { figureWidth: 522, figureHeight: 370 })).toBeCloseTo(0.9, 6);
    expect(drag.axis).toBe("w");
  });
  it("keeps following that direction when the other one later moved further — no flip, no flicker", () => {
    const drag = { start: 1, axis: "w" as "w" | "h" | null };
    // At scale 0.6 the pointer sits well below the corner (rh = 1.3): scaleForResize alone follows y and grows the graph.
    expect(scaleForResize(0.6, drawing, { figureWidth: 551, figureHeight: 494 })).toBeCloseTo(0.78, 6);
    expect(cornerResize(drag, 0.6, drawing, { figureWidth: 551, figureHeight: 494 })).toBeCloseTo(0.57, 6);
  });
  it("a drag that starts downward follows the height", () => {
    const drag = { start: 1, axis: null as "w" | "h" | null };
    expect(cornerResize(drag, 1, drawing, { figureWidth: 590, figureHeight: 456 })).toBeCloseTo(1.2, 6);
    expect(drag.axis).toBe("h");
  });
  it("an edge grip is not a corner: it scales by that edge alone", () => {
    const drag = { start: 1, axis: null as "w" | "h" | null };
    expect(cornerResize(drag, 1, drawing, { figureWidth: 290 })).toBeCloseTo(0.5, 6);
  });
  it("stays within 0.25–4", () => {
    expect(cornerResize({ start: 1, axis: "w" }, 1, drawing, { figureWidth: 10, figureHeight: 10 })).toBe(0.25);
  });
});
