import { expect, test } from "@playwright/test";
import { MadyApp } from "./app";

/**
 * A fixed axis range that leaves data out must not stretch the figure.
 *
 * The drawing grows to take in whatever is drawn past the figure's edge (a legend dragged out, a long
 * title). Marks the plot's clip cuts away are not drawn, but `getBBox` ignores the clip, so only what the
 * clip leaves visible may count: a graph whose axis stops short of its data must not grow to hold marks
 * nobody can see.
 *
 * Browser-only: jsdom has no clipping and no screen matrix, so only the unit tests for the pieces
 * (`visibleExtent.test.ts`) run there; whether the browser's own measurement agrees is asked here.
 */

/** The figure's own size and the size the drawing grew to, in figure pixels. */
async function sizes(page: import("@playwright/test").Page): Promise<{ figW: number; figH: number; vbW: number; vbH: number }> {
  return page.evaluate(() => {
    const svg = document.querySelector<SVGSVGElement>("svg.gfx-figure")!;
    const vb = svg.viewBox.baseVal;
    return { figW: Number(svg.getAttribute("data-figure-w")), figH: Number(svg.getAttribute("data-figure-h")), vbW: vb.width, vbH: vb.height };
  });
}

test("an X axis that stops short of the data leaves the figure at its own width", async ({ page }) => {
  const app = new MadyApp(page);
  await app.open();
  const before = await sizes(page);
  await app.setPlotOptions({ xAxis: { scale: "linear", min: 0, max: 0.05 } });
  const after = await sizes(page);
  expect(after.vbW, `the figure grew from ${before.vbW} to ${after.vbW} px wide for marks the clip hides`).toBeLessThan(after.figW + 40);
  expect(after.vbH).toBeLessThan(after.figH + 40);
});

test("a Y axis that stops short of the data leaves the figure at its own height", async ({ page }) => {
  const app = new MadyApp(page);
  await app.open();
  await app.setPlotOptions({ yAxis: { min: 0, max: 0.5 } });
  const after = await sizes(page);
  expect(after.vbH, `the figure grew to ${after.vbH} px tall for marks the clip hides`).toBeLessThan(after.figH + 40);
  expect(after.vbW).toBeLessThan(after.figW + 40);
});

test("a legend dragged out still widens the figure — only clipped-away marks are ignored", async ({ page }) => {
  const app = new MadyApp(page);
  await app.open();
  await app.setPlotOptions({ yAxis: { min: 0, max: 0.5 }, legend: { show: true }, legendOffset: { dx: 700, dy: 0 } });
  const after = await sizes(page);
  expect(after.vbW, "something drawn far past the right edge must still be inside the drawing").toBeGreaterThan(after.figW + 100);
  expect(after.vbH).toBeLessThan(after.figH + 40);
});
