import { describe, expect, it } from "vitest";
import { createSampleDocument } from "@mady/core";
import { buildPlotScene } from "./buildScene.js";

/**
 * A node name never sits on the value colour bar.
 *
 * The label placer treats every node, every link, the legend and the value colour bar in the left margin as
 * obstacles, and may put a name anywhere around its node. Guards against the bar being left out of the obstacles,
 * which would let a name sit across the bar and be partly hidden by it; the sample "Signaling network" has a node
 * ("PD-1") placed where that happens, standalone and in a panel. The bar's box here is the renderer's own geometry (PlotFigure's NetworkFigure): right edge 6 px left of the
 * plot, 8 px wide, its min/max labels right-aligned to it, above and below.
 */
const project = createSampleDocument().toJSON();
const net = project.plots.find((p) => p.name === "Signaling network")!;
const table = project.tables.find((t) => t.id === net.source)!;
const measure = (text: string, px: number): number => text.length * px * 0.56;

function barBox(s: ReturnType<typeof buildPlotScene>) {
  const lg = s.network!.valueLegend!;
  const lbl = s.network!.labelSize ?? s.fonts.tick.size;
  const x2 = s.plot.x - 6;
  const x1 = x2 - Math.max(8, measure(lg.minLabel, lbl), measure(lg.maxLabel, lbl));
  const h = Math.max(24, Math.min(120, s.plot.height - 2 * (lbl + 6)));
  return { x1, x2, y1: s.plot.y, y2: s.plot.y + lbl + 4 + h + lbl + 2 };
}

describe("network: node names stay off the value colour bar", () => {
  for (const [w, h] of [[640, 420], [580, 380], [380, 260], [900, 520]] as const) {
    it(`${w}×${h}`, () => {
      const s = buildPlotScene(table, net, { width: w, height: h, measure });
      expect(s.network?.valueLegend, "fixture: this network draws a value colour bar").toBeTruthy();
      const bar = barBox(s);
      const lbl = s.network!.labelSize ?? s.fonts.tick.size;
      const on: string[] = [];
      for (const n of s.network!.nodes) {
        if (!n.label) continue;
        const tw = measure(n.label, lbl);
        const x = n.cx + (n.labelDx ?? n.r + 3);
        const x1 = n.labelAnchor === "end" ? x - tw : x;
        const y = n.cy + (n.labelDy ?? 0);
        const box = { x1, x2: x1 + tw, y1: y - lbl * 0.7, y2: y + lbl * 0.3 };
        if (Math.min(box.x2, bar.x2) - Math.max(box.x1, bar.x1) > 0.5 && Math.min(box.y2, bar.y2) - Math.max(box.y1, bar.y1) > 0.5) on.push(n.label);
      }
      expect(on, "names drawn across the colour bar").toEqual([]);
    });
  }
});
