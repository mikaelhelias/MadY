// The corner scale bar (a hidden axis + a bar of known length): it knows which axis it measures, and carries the
// drag offset stored on that axis, so the renderer can select, move and rename it.
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene";

const table: DataTable = {
  id: "t", kind: "xy", name: "T",
  columns: [{ id: "x", name: "X", role: "x" }, { id: "y", name: "Y", role: "y" }],
  rows: [1, 2, 3, 4, 5].map((i) => ({ id: `r${i}`, cells: { x: i, y: i * 2 } })),
};
const build = (extra: Partial<Plot>) =>
  buildPlotScene(table, { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "xy", ...extra }, { width: 640, height: 420 });

describe("scale bar", () => {
  it("each bar names the axis it measures", () => {
    const s = build({ xAxis: { hidden: true, scaleBar: { length: 1, label: "1 unit" } }, yAxis: { hidden: true, scaleBar: { length: 2 } } });
    expect(s.scaleBars!.map((b) => b.axis).sort()).toEqual(["x", "y"]);
    expect(s.scaleBars!.find((b) => b.axis === "x")!.vertical).toBe(false);
    expect(s.scaleBars!.find((b) => b.axis === "y")!.vertical).toBe(true);
  });

  it("carries the drag offset stored with its axis, and none otherwise", () => {
    const s = build({ xAxis: { hidden: true, scaleBar: { length: 1, offset: { dx: 30, dy: -12 } } }, yAxis: { hidden: true, scaleBar: { length: 2 } } });
    expect(s.scaleBars!.find((b) => b.axis === "x")!.offset).toEqual({ dx: 30, dy: -12 });
    expect(s.scaleBars!.find((b) => b.axis === "y")!.offset).toBeUndefined();
  });
});
