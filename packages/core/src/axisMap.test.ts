import { describe, expect, it } from "vitest";
import { dataAxisOf, isTransposedPlot } from "./model";
import type { Plot } from "./model";

const plot = (extra: Partial<Plot>): Plot => ({
  id: "p",
  name: "P",
  source: "t",
  status: "ok",
  styleOverrides: {},
  ...extra,
});

describe("isTransposedPlot", () => {
  it("is true only for a horizontal categorical chart", () => {
    expect(isTransposedPlot(plot({ kind: "bar", barOrientation: "horizontal" }))).toBe(true);
    expect(isTransposedPlot(plot({ kind: "box", barOrientation: "horizontal" }))).toBe(true);
    expect(isTransposedPlot(plot({ kind: "violin", barOrientation: "horizontal" }))).toBe(true);
    expect(isTransposedPlot(plot({ kind: "scatter", barOrientation: "horizontal" }))).toBe(true);
  });
  it("is false for vertical, for non-categorical kinds, and by default", () => {
    expect(isTransposedPlot(plot({ kind: "bar", barOrientation: "vertical" }))).toBe(false);
    expect(isTransposedPlot(plot({ kind: "bar" }))).toBe(false); // default vertical
    expect(isTransposedPlot(plot({ kind: "xy", barOrientation: "horizontal" }))).toBe(false);
    expect(isTransposedPlot(plot({ kind: "lollipop", barOrientation: "horizontal" }))).toBe(false);
  });
});

describe("dataAxisOf", () => {
  it("swaps x<->y for a flipped categorical chart so titles follow their axis", () => {
    const hbar = plot({ kind: "bar", barOrientation: "horizontal" });
    expect(dataAxisOf(hbar, "x")).toBe("y"); // bottom (value) axis ← value spec (yAxis)
    expect(dataAxisOf(hbar, "y")).toBe("x"); // left (category) axis ← category spec (xAxis)
    expect(dataAxisOf(hbar, "y2")).toBe("y2"); // Y2 never transposes
  });
  it("is the identity for any non-transposed plot", () => {
    const vbar = plot({ kind: "bar", barOrientation: "vertical" });
    expect(dataAxisOf(vbar, "x")).toBe("x");
    expect(dataAxisOf(vbar, "y")).toBe("y");
    const xy = plot({ kind: "xy" });
    expect(dataAxisOf(xy, "x")).toBe("x");
    expect(dataAxisOf(xy, "y")).toBe("y");
  });
});
