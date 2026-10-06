import { expect, test } from "@playwright/test";
import { MadyApp } from "./app";

/**
 * The column scatter's "Median + 95% CI of the median" choice, in the real app: picking it in
 * the Inspector must reach the document AND change the drawing. The builder test proves the
 * interval's numbers; only a browser proves the control is wired to them.
 */
test("column scatter: Median + 95% CI of the median reaches the document and the drawing", async ({ page }, info) => {
  const app = new MadyApp(page);
  await app.open();
  await app.openGallery();
  await app.openGalleryCard("Column scatter");
  await page.locator("svg.gfx-figure").click({ position: { x: 5, y: 5 } });
  await app.settle();

  // The median + IQR drawing first, so a change can only come from the new interval.
  expect(await app.setControl("Summary", "median-iqr")).toBe("set");
  await app.settle();
  const iqr = await page.locator("svg.gfx-figure").innerHTML();

  expect(await app.setControl("Summary", "median-ci")).toBe("set");
  await app.settle();
  const plot = await app.plot(await app.activePlotId());
  expect(plot?.["columnScatter"]).toEqual({ center: "median", error: "ciMedian" });
  const ci = await page.locator("svg.gfx-figure").innerHTML();
  expect(ci).not.toBe(iqr);

  await page.locator("svg.gfx-figure").screenshot({ path: info.outputPath("median-ci.png") });
});
