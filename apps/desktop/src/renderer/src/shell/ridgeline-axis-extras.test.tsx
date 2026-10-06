// @vitest-environment jsdom
/**
 * The ridgeline honours the axis extras — read off the drawing, not the scene.
 *
 * "Add tick" and the shaded zone bands work on a ridgeline. A cut on the axis silences both
 * (guarded by `cut-axis-extras.test.ts`), so a check must start from an axis without one. The
 * ridgeline builder itself mentions neither field: they are resolved once for every chart kind at the choke
 * point (`resolveAxisExtras` in buildScene). A kind that ever stopped going through that choke
 * point — a new builder that returns its own scene early, say — would lose both controls
 * silently.
 *
 * So the check asks the drawing, with the horizon fold off and on, and it reads the rendered
 * SVG rather than the scene: a scene field that no drawer picks up is a failure that reading
 * only the scene in jsdom does not catch.
 */
import { describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { buildPlotScene } from "@mady/graphics";
import type { Plot } from "@mady/core";
import { PlotFigure } from "./PlotFigure";
import { galleryItems } from "./gallery";

const BAND = "#ff00ff";
const EXTRAS = {
  extraTicks: [{ value: 5, label: "MARK" }],
  bands: [{ from: 1, to: 2, color: BAND, opacity: 0.5 }],
};

/** The ridgeline gallery card, drawn with the extras on its value axis. */
function draw(foldBands: number): { svg: string; warnings: string[] } {
  const card = galleryItems().find((g) => g.title === "Ridgeline / horizon fold");
  if (!card) throw new Error("the Ridgeline gallery card is gone — this guard has nothing to measure");
  const base = card.plot as Plot;
  const ridgeline = { ...((base as unknown as { ridgeline?: Record<string, unknown> }).ridgeline ?? {}), bands: foldBands };
  const plot = { ...base, ridgeline, xAxis: { ...(base.xAxis ?? {}), ...EXTRAS } } as Plot;
  const scene = buildPlotScene(card.table, plot, { width: 640, height: 420 });
  const { container } = render(<PlotFigure scene={scene} />);
  const svg = container.querySelector("svg")!.outerHTML;
  cleanup();
  return { svg, warnings: scene.warnings };
}

describe("ridgeline: the axis extras reach the drawing", () => {
  for (const [what, fold] of [["horizon fold off", 0], ["horizon fold on", 4]] as const) {
    it(`a custom tick and a shaded band are both drawn — ${what}`, () => {
      const { svg, warnings } = draw(fold);
      expect(svg, `the custom tick's label is not in the drawing (${what})`).toContain(">MARK<");
      expect(svg.toLowerCase(), `the shaded band is not in the drawing (${what})`).toContain(BAND);
      expect(warnings, `the extras were refused out loud instead of drawn (${what}): ${JSON.stringify(warnings)}`).toEqual([]);
    });
  }

  it("the fixture can tell the difference: without the extras, neither is in the drawing", () => {
    const card = galleryItems().find((g) => g.title === "Ridgeline / horizon fold")!;
    const scene = buildPlotScene(card.table, card.plot as Plot, { width: 640, height: 420 });
    const { container } = render(<PlotFigure scene={scene} />);
    const svg = container.querySelector("svg")!.outerHTML;
    cleanup();
    expect(svg, "the card draws MARK on its own — the guard would pass whatever the extras did").not.toContain(">MARK<");
    expect(svg.toLowerCase(), "the card draws the band colour on its own — the guard proves nothing").not.toContain(BAND);
  });
});
