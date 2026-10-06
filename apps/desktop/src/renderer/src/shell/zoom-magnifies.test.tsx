// @vitest-environment jsdom
/**
 * Zooming in must make the figure bigger — on every chart kind.
 *
 * Guards against the graph stopping growing before 400% zoom: the SVG's width attribute can
 * grow with the zoom while the drawn figure stays at the pane's width, so every press past
 * "it fills the pane" changes the number and leaves the picture alone.
 *
 * The clamp that would do this is `max-width: 100%` on the <svg> or its wrapper <div>. It is what makes a figure
 * fit its pane at 100%, and it would silently cap the magnifier above it. The pane around it is
 * `overflow: auto`, so nothing but such a clamp stands between a zoomed figure and a scrollable one.
 *
 * Note: asserting the width attribute would pass even with the clamp — the attribute is not
 * the problem. These check the style that decides whether the browser honours it.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { PlotFigure } from "./PlotFigure";
import { FIX, buildFor } from "./plot-fixtures";

afterEach(cleanup);

const figure = (kind: string, zoom: number) => {
  const fx = FIX.find((f) => f.kind === kind)!;
  const { container } = render(<PlotFigure scene={buildFor(fx)} zoom={zoom} />);
  const svg = container.querySelector("svg") as unknown as SVGSVGElement;
  return { svg, wrap: svg.parentElement as HTMLElement };
};

describe("every chart kind magnifies past the width of its pane", () => {
  it("covers every kind (a shrinking sweep reads exactly like a passing one)", () => {
    expect(FIX.length).toBeGreaterThan(30);
  });

  for (const fx of FIX) {
    it(`${fx.kind}: the clamp comes off when zoomed in`, () => {
      const at100 = figure(fx.kind, 1);
      // At 100% the figure still FITS its pane — that behaviour must not change.
      expect(at100.svg.style.maxWidth, "the fit-to-pane clamp was lost at 100%").toBe("100%");

      const at200 = figure(fx.kind, 2);
      // Both, or neither works: the wrapper is inline-block, so its own max-width clamps
      // the SVG inside it.
      expect(at200.svg.style.maxWidth, "the SVG is still clamped to the pane when zoomed").toBe("none");
      if (at200.wrap && at200.wrap.style.maxWidth !== "") {
        expect(at200.wrap.style.maxWidth, "the WRAPPER still clamps the zoomed figure").toBe("none");
      }
      // …and the drawing really is asked to be bigger.
      expect(Number(at200.svg.getAttribute("width"))).toBeGreaterThan(Number(at100.svg.getAttribute("width")));
    });
  }

  it("zooming OUT keeps the fit-to-pane clamp", () => {
    // Below 100% a figure should still never overflow its pane — the clamp is right there.
    const { svg } = figure("xy", 0.5);
    expect(svg.style.maxWidth).toBe("100%");
  });
});
