import { expect, test } from "@playwright/test";
import { MadyApp } from "./app";

/**
 * Resizing a graph scales the whole drawing (resizing keeps proportions). Guards against a corner drag re-laying
 * the graph out at the new size with full-size text, where a small Bars + line graph gives its width to the legend
 * and the plot nearly vanishes. The drag sets the graph's scale: the drawing keeps its own
 * layout (its coordinate box does not change) and is shown smaller — text, bars, legend together. jsdom cannot drag
 * (no screen transform), so only a browser proves the corner is wired to the scale.
 */
test("dragging the corner scales the Bars + line graph instead of re-laying it out", async ({ page }, info) => {
  const app = new MadyApp(page);
  await app.open();
  await app.openGallery();
  await app.openGalleryCard("Bars + line (2nd axis)");
  await app.settle();
  const svg = page.locator("svg.gfx-figure").first();
  const before = { vb: await svg.getAttribute("viewBox"), box: await svg.boundingBox() };
  expect(before.box, "the graph is not on screen").toBeTruthy();
  await svg.screenshot({ path: info.outputPath("before.png") });

  // The corner grip (shown on hover) — drag it left, to about 60% of the width.
  const b = before.box!;
  await svg.hover();
  const grip = svg.locator(".gfx-figresize rect").last();
  const g = (await grip.boundingBox())!;
  expect(g, "no corner grip").toBeTruthy();
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.x + g.width / 2 - b.width * 0.4, g.y + g.height / 2 - b.height * 0.2, { steps: 12 });
  await page.mouse.up();
  await app.settle();

  const after = { vb: await svg.getAttribute("viewBox"), box: await svg.boundingBox() };
  await svg.screenshot({ path: info.outputPath("after.png") });
  const plot = await app.plot(await app.activePlotId());
  expect(plot?.["displayScale"], "the drag did not set the graph's scale").toBeLessThan(1);
  expect(plot?.["figureWidth"], "the drag re-laid the graph out").toBeUndefined();
  expect(after.vb, "the drawing's own layout changed").toBe(before.vb);
  // Shown smaller — where the corner was dropped, about 60% of the width it had — and the same shape.
  expect(after.box!.width / b.width).toBeGreaterThan(0.52);
  expect(after.box!.width / b.width).toBeLessThan(0.68);
  expect(after.box!.width / after.box!.height).toBeCloseTo(b.width / b.height, 1);
});

/**
 * A corner drag follows one direction for the whole drag. Guards against switching between following the
 * pointer's x and its y at each step (dragged steadily inward, the right edge would then move back and forth),
 * which makes the size flicker and the drop depend on which the last event followed. And with the pane scrolled,
 * the graph must not jump mid-drag as the shrinking page gives the scroll back.
 */
test("a corner dragged steadily inward never grows back, and the graph does not move under the pointer", async ({ page }) => {
  const app = new MadyApp(page);
  await app.open();
  await app.openGallery();
  await app.openGalleryCard("Bars + line (2nd axis)");
  await app.settle();
  const svg = page.locator("svg.gfx-figure").first();
  const b = (await svg.boundingBox())!;
  await svg.hover();
  const g = (await svg.locator(".gfx-figresize rect").last().boundingBox())!;
  const sx = g.x + g.width / 2;
  const sy = g.y + g.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  const widths: number[] = [];
  const tops: number[] = [];
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(sx - (b.width * 0.4 * i) / 12, sy - (b.height * 0.2 * i) / 12);
    const s = (await svg.boundingBox())!;
    widths.push(Math.round(s.width));
    tops.push(Math.round(s.y));
  }
  await page.mouse.up();
  for (let i = 1; i < widths.length; i++) expect(widths[i]!, `step ${i + 1} grew back: ${widths.join(" → ")}`).toBeLessThanOrEqual(widths[i - 1]!);
  expect(new Set(tops).size, `the graph moved under the pointer: tops ${tops.join(" → ")}`).toBe(1);
});
