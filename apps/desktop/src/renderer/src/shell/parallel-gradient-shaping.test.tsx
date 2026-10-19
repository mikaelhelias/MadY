// @vitest-environment jsdom
/**
 * The parallel-coordinates value ramp is shapeable — midpoint, gamma, steps and colour space.
 *
 * These four fields need the `colorScale: "value"` prerequisite and a numeric colour column: the
 * gallery card colours by species, a text column, so without the prerequisite the builder is on
 * its categorical branch and there is no ramp for them to shape, so a check of the card alone
 * would find they change nothing. With the prerequisite, over a numeric colour column, every one of them
 * changes the drawing.
 *
 * This is the fast guard for that: it reads the rendered SVG, so it covers the lines and not
 * only the colour bar — a shaping bug that reached the bar alone would still be caught.
 *
 * Caution: `colorColumn: "pl"` below is right here and wrong in the running app. `galleryItems()`
 * hands out the card's own column ids; opening that card in the app copies its table into the
 * document and renumbers every column ("pl" becomes "col_39"), so the same literal would be a
 * dangling reference there. The e2e spec names the column by its name and resolves it live
 * (`COLUMN("Petal L")` in `style-field-efficacy.spec.ts`).
 */
import { describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { buildPlotScene } from "@mady/graphics";
import type { Plot } from "@mady/core";
import { PlotFigure } from "./PlotFigure";
import { galleryItems } from "./gallery";

/** The colours the drawing actually uses (line strokes and the colour bar's stops). */
function inkOf(block: Record<string, unknown>): string {
  const card = galleryItems().find((g) => g.title === "Parallel coordinates");
  if (!card) throw new Error("the Parallel coordinates gallery card is gone — this guard has nothing to measure");
  const plot = { ...(card.plot as Plot), parallel: block } as Plot;
  const scene = buildPlotScene(card.table, plot, { width: 580, height: 380 });
  const { container } = render(<PlotFigure scene={scene} />);
  const svg = container.querySelector("svg")!.outerHTML;
  cleanup();
  return [...svg.matchAll(/(?:fill|stroke|stop-color)="([^"]+)"/g)].map((m) => m[1]!).join(",");
}

const own = (): Record<string, unknown> =>
  ((galleryItems().find((g) => g.title === "Parallel coordinates")!.plot as unknown as { parallel?: Record<string, unknown> }).parallel ?? {});

/** Petal L — a numeric colour column of the card's own table, so the ramp paints the lines. */
const ramped = (): Record<string, unknown> => ({ ...own(), colorScale: "value", colorColumn: "pl" });

describe("parallel coordinates: the value ramp can be shaped", () => {
  it("the fixture really is on the ramp branch — switching to it changes the drawing", () => {
    expect(inkOf(ramped()), "the numeric colour ramp draws the same as the card's category colours — the fixture cannot show a shaping bug").not.toEqual(inkOf(own()));
  });

  // `colorMidpoint` is a data value: Petal L runs about 1.2-5.9, so 2 sits inside the range and
  // moves the ramp. (7 and 0.25 fall outside it and rightly do nothing, so trying generic
  // numbers alone cannot settle whether this field works.)
  for (const [field, value] of [["colorMidpoint", 2], ["colorGamma", 7], ["colorSteps", 7], ["colorSpace", "hsl"]] as const) {
    it(`${field} changes what is drawn`, () => {
      expect(inkOf({ ...ramped(), [field]: value }), `${field} = ${String(value)} left the drawing untouched`).not.toEqual(inkOf(ramped()));
    });
  }

  it("without the ramp there is nothing to shape, and the fields correctly do nothing", () => {
    // Not a defect: without a value ramp these fields have nothing to act on. This separates a
    // field that does nothing because of its prerequisite from one that is broken.
    for (const [field, value] of [["colorMidpoint", 2], ["colorGamma", 7], ["colorSteps", 7], ["colorSpace", "hsl"]] as const) {
      expect(inkOf({ ...own(), [field]: value }), `${field} changed a drawing that has no value ramp`).toEqual(inkOf(own()));
    }
  });
});
