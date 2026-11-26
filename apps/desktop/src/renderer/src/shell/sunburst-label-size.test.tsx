// @vitest-environment jsdom
/**
 * A sunburst's labels are drawn at the Label size they were fitted at.
 *
 * The builder decides which segment labels fit — and drops the ones that would collide — measuring them at
 * `sunburst.labelSize` (the Inspector's "Label size"), else one pixel under the tick font. Guards against the renderer
 * drawing them at the tick font regardless, which would make the Label size control change which labels are kept but
 * not their size. Without a Label size the labels are fitted one pixel under the tick font and drawn at the
 * tick font.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { buildPlotScene } from "@mady/graphics";
import { galleryItems } from "./gallery";
import { measureText } from "./textMeasure";
import { PlotFigure } from "./PlotFigure";

afterEach(() => cleanup());
const g = galleryItems().find((x) => x.title === "Sunburst")!;

function drawnLabelSizes(labelSize?: number): { sizes: number[]; tick: number; fitted: number | undefined } {
  const plot = { ...g.plot, sunburst: { ...(g.plot.sunburst ?? {}), ...(labelSize !== undefined ? { labelSize } : {}) } };
  const scene = buildPlotScene(g.table, plot, { measure: measureText, width: 580, height: 380 });
  const { container } = render(<PlotFigure scene={scene} selected={null} zoom={1} />);
  const labels = [...container.querySelectorAll(".gfx-sunburst text[transform]")];
  // the size the builder fitted the labels at — carried on the scene so the two can never disagree
  const fitted = (scene.sunburst as { labelSize?: number } | undefined)?.labelSize;
  return { sizes: labels.map((t) => parseFloat(t.getAttribute("font-size") ?? "")), tick: scene.fonts.tick.size, fitted };
}

describe("sunburst segment labels: drawn at the Label size they were fitted at", () => {
  it("Label size 12 draws the labels at 12 px", () => {
    const { sizes, tick } = drawnLabelSizes(12);
    expect(sizes.length, "fixture: some segment labels are drawn").toBeGreaterThan(0);
    expect(tick, "fixture: the tick font differs from 12, so labels drawn at the tick font would show").not.toBe(12);
    expect([...new Set(sizes)]).toEqual([12]);
  });
  it("no Label size: drawn at the tick size, the scene carries no size of its own", () => {
    const { sizes, tick, fitted } = drawnLabelSizes();
    expect(sizes.length).toBeGreaterThan(0);
    expect(fitted, "no Label size of its own: the scene carries none (drawn at the tick size)").toBeUndefined();
    expect([...new Set(sizes)]).toEqual([tick]);
  });
});
