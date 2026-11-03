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

  // The X bar's label sits under the bar, clear of it and of the plot's bottom edge (where a shown X axis draws its
  // line), at the label's own font: a fixed baseline drop put a 20 px label through the bar and the axis line.
  // Text box as the app measures it: 1.08 em above the baseline, 0.27 em below; the bar is drawn 2.5 px thick.
  for (const [what, extra] of [
    ["the axis shown, default tick font", {}],
    ["the axis shown, 30 px tick font", { fonts: { tick: { size: 30 } } }],
    ["the axis hidden", { hidden: true }],
  ] as const) {
    it(`X label clears its bar and the plot's bottom edge: ${what}`, () => {
      const hidden = "hidden" in extra;
      const s = build({ xAxis: { ...(hidden ? { hidden: true } : {}), scaleBar: { length: 1, label: "1 unit" } }, ...("fonts" in extra ? { fonts: extra.fonts } : {}) } as Partial<Plot>);
      const b = s.scaleBars!.find((x) => x.axis === "x")!;
      const size = s.fonts.xTick.size;
      const top = b.labelY - 1.08 * size;
      const bottom = b.labelY + 0.27 * size;
      expect(top, "label top vs bar").toBeGreaterThanOrEqual(b.y1 + 1.25 + 2);
      expect(bottom, "label bottom vs plot bottom").toBeLessThanOrEqual(s.plot.y + s.plot.height);
    });
  }

  it("carries the drag offset stored with its axis, and none otherwise", () => {
    const s = build({ xAxis: { hidden: true, scaleBar: { length: 1, offset: { dx: 30, dy: -12 } } }, yAxis: { hidden: true, scaleBar: { length: 2 } } });
    expect(s.scaleBars!.find((b) => b.axis === "x")!.offset).toEqual({ dx: 30, dy: -12 });
    expect(s.scaleBars!.find((b) => b.axis === "y")!.offset).toBeUndefined();
  });
});
