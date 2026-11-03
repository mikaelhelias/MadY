// A parallel-coordinates axis name is centred on its axis, so the last one hangs half its width past the axis. The
// end axes are inset from the plot edge to keep that on the canvas, but the room to the right of the plot is only
// free up to whatever stands there: an outside legend starts a gap past the plot edge, a colour bar a little further.
// A name that runs into either prints under it.
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene";

const measure = (t: string, px: number): number => t.length * px * 0.55;
const NAMES = ["Alcohol (%)", "Malic acid (g/L)", "Ash (g/L)", "Alkalinity", "Magnesium (mg/L)"];

function table(): DataTable {
  return {
    id: "pc", kind: "multivariable", name: "Wine",
    columns: [
      { id: "s", name: "Sample", role: "x" },
      ...NAMES.map((n, j) => ({ id: `c${j}`, name: n, role: "y" as const })),
      { id: "cv", name: "Cultivar", role: "y" as const },
    ],
    rows: Array.from({ length: 30 }, (_, i) => ({
      id: `r${i}`,
      cells: { s: `W${i}`, ...Object.fromEntries(NAMES.map((_n, j) => [`c${j}`, ((i * (j + 3) * 7) % 41) + j * 10])), cv: ["A", "B", "C"][i % 3]! },
    })),
  };
}
const plotOf = (parallel: NonNullable<Plot["parallel"]>, w = 760): Plot => ({ id: "p", name: "P", source: "pc", status: "ok", styleOverrides: {}, kind: "parallel", figureWidth: w, figureHeight: 460, parallel });
const build = (parallel: NonNullable<Plot["parallel"]>, w = 760) => buildPlotScene(table(), plotOf(parallel, w), { width: w, height: 460, measure });

/** How far past the plot's right edge the last axis name reaches (negative = inside the plot). */
function overhang(s: ReturnType<typeof build>): number {
  const last = s.parallel!.axes[s.parallel!.axes.length - 1]!;
  return last.x + measure(last.label, s.fonts.axisTitle.size) / 2 - (s.plot.x + s.plot.width);
}

describe("the last axis name stays clear of what is to the right of the plot", () => {
  it("with an outside legend: the name ends before the legend starts", () => {
    const s = build({ colorColumn: "cv" });
    expect(s.legend.length).toBeGreaterThan(0);
    expect(s.legendLayout.position).toBe("right");
    const legendLeft = s.plot.x + s.plot.width + (s.legendLayout.gap ?? 12) - 4;
    const last = s.parallel!.axes[s.parallel!.axes.length - 1]!;
    expect(last.x + measure(last.label, s.fonts.axisTitle.size) / 2).toBeLessThanOrEqual(legendLeft);
  });

  it("with a colour bar: the name ends before the bar starts", () => {
    const s = build({ colorColumn: "c1", colorScale: "value" });
    expect(s.colorbar).toBeDefined();
    const barLeft = s.colorbar!.bar.x;
    const last = s.parallel!.axes[s.parallel!.axes.length - 1]!;
    expect(last.x + measure(last.label, s.fonts.axisTitle.size) / 2).toBeLessThanOrEqual(barLeft);
  });

  it("the first axis name and its numbers stay on the canvas", () => {
    const s = build({ colorColumn: "cv" });
    const first = s.parallel!.axes[0]!;
    expect(first.x - measure(first.label, s.fonts.axisTitle.size) / 2).toBeGreaterThanOrEqual(0);
  });

  it("with no legend and no bar the name may use the whole margin", () => {
    const s = build({});
    expect(s.legend.length).toBe(0);
    expect(overhang(s)).toBeLessThanOrEqual(s.width - (s.plot.x + s.plot.width));
    // the end inset is the plain minimum: nothing to keep clear of
    const plotW = s.plot.width;
    expect(s.parallel!.axes[0]!.x).toBeGreaterThanOrEqual(s.plot.x);
    expect(s.plot.x + plotW - s.parallel!.axes[s.parallel!.axes.length - 1]!.x).toBeLessThanOrEqual(0.35 * plotW);
  });

  it("a short last name insets the last axis less than a long name does", () => {
    const withLong = build({ colorColumn: "cv" });
    const t = table();
    t.columns[5]!.name = "Mg";
    const short = buildPlotScene(t, plotOf({ colorColumn: "cv" }), { width: 760, height: 460, measure });
    const lastGap = (s: ReturnType<typeof build>): number => s.plot.x + s.plot.width - s.parallel!.axes[s.parallel!.axes.length - 1]!.x;
    expect(lastGap(short)).toBeLessThan(lastGap(withLong));
    expect(lastGap(short)).toBeLessThanOrEqual(40.5);
  });
});
