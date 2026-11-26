// Pixel → axis value: read from the axis's own ticks, because an axis is not always drawn edge to
// edge of the plot (a log axis sits inset).
import { describe, expect, it } from "vitest";
import { valueAtPx } from "./axisValue";

const plot = { x: 85, y: 52, width: 354.7, height: 301 };

describe("valueAtPx", () => {
  it("an inset log axis: the value at a tick's pixel is that tick, and halfway between decades is their geometric mean", () => {
    // The XY gallery card's axis: 0.01 drawn at 99 px, 1000 at 425.7 px, on a plot that starts at 85.
    const axis = { domain: [0.01, 1000], type: "log10", ticks: [0.01, 0.1, 1, 10, 100, 1000].map((v, i) => ({ value: v, pos: 99 + i * 65.338 })) };
    expect(valueAtPx(axis, plot, 99 + 2 * 65.338, "x")).toBeCloseTo(1, 9);
    expect(valueAtPx(axis, plot, 99 + 2.5 * 65.338, "x")).toBeCloseTo(Math.sqrt(10), 6);
    // Past the last tick it carries on along the same line (a point dragged into the axis's inset).
    expect(valueAtPx(axis, plot, 99 + 5.5 * 65.338, "x")).toBeCloseTo(Math.sqrt(10) * 1000, 3);
  });
  it("a Y axis: pixels descend as values rise", () => {
    const axis = { domain: [0, 100], type: "linear", ticks: [0, 50, 100].map((v) => ({ value: v, pos: 353 - (v / 100) * 301 })) };
    expect(valueAtPx(axis, plot, 353 - 0.3 * 301, "y")).toBeCloseTo(30, 9);
  });
  it("unsorted ticks and minor ticks with empty labels are fine", () => {
    const axis = { domain: [0, 10], type: "linear", ticks: [{ value: 10, pos: 300 }, { value: 0, pos: 100 }, { value: 5, pos: 200 }] };
    expect(valueAtPx(axis, plot, 250, "x")).toBeCloseTo(7.5, 9);
  });
  it("fewer than two ticks: the domain over the plot rectangle", () => {
    const axis = { domain: [0, 10], type: "linear", ticks: [] };
    expect(valueAtPx(axis, plot, plot.x + plot.width / 2, "x")).toBeCloseTo(5, 9);
    expect(valueAtPx(axis, plot, plot.y, "y")).toBeCloseTo(10, 9);
  });
});
