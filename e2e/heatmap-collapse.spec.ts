import { expect, test } from "@playwright/test";
import { MadyApp } from "./app";

/**
 * Replicate collapse, in the running app.
 *
 * The point of the feature is that the same data can be shown two ways — every replicate, or one
 * averaged column per treatment — and the figure has to say which it is showing. jsdom can prove
 * the panel writes the field; only the real app proves the matrix actually loses its columns and
 * that the label on the survivor says it is an average.
 */
const GENE_HEATMAP = "Gene expression heatmap";

const colLabels = async (page: import("@playwright/test").Page): Promise<string[]> =>
  page.evaluate(() => {
    const svg = document.querySelector("svg.gfx-figure")!;
    const plot = svg.querySelector("rect[data-heatcell]")!;
    const top = Number(plot.getAttribute("y"));
    return [...svg.querySelectorAll("text")]
      .filter((t) => Number(t.getAttribute("y") ?? 0) < top && Number(t.getAttribute("y") ?? 0) > top - 60)
      .map((t) => t.textContent ?? "");
  });

test.describe("replicate collapse (live)", () => {
  test("the same data, both ways — and the survivor's label says it is an average", async ({ page }) => {
    const app = new MadyApp(page);
    await app.open();
    await app.openGraph(GENE_HEATMAP);
    await page.locator("svg.gfx-figure").click({ position: { x: 5, y: 5 } });
    await app.settle();

    const cells = () => page.locator("svg.gfx-figure rect[data-heatcell]").count();
    const before = await cells();

    // nothing to group by yet, so the control is not offered at all
    expect(await page.getByLabel("Collapse replicate columns").count()).toBe(0);

    // give the columns an arm, two of each
    await page.getByLabel("Add a column strip").click();
    await app.settle();
    await page.getByLabel("column strip 1 name").fill("Arm");
    await page.getByText("Value per column").click();
    const boxes = page.locator("input[aria-label^='column strip 1 value for']");
    const n = await boxes.count();
    for (let i = 0; i < n; i++) await boxes.nth(i).fill(i < 2 ? "Control" : "Treated");
    await app.settle();
    expect(await cells(), "the strip alone must not change the matrix").toBe(before);

    // now collapse
    await expect(page.getByLabel("Collapse replicate columns")).toBeVisible();
    await page.getByLabel("Collapse replicate columns").selectOption("mean");
    await app.settle();

    const rows = await page.locator("svg.gfx-figure rect[data-heatcell$='-0']").count();
    expect(await cells(), "two arms means two columns").toBe(rows * 2);
    const labels = await colLabels(page);
    expect(labels.join(" ")).toMatch(/Control \(mean of 2\)/);
    expect(labels.join(" ")).toMatch(/Treated \(mean of \d\)/);

    // …and switching it off brings every replicate back
    await page.getByLabel("Collapse replicate columns").selectOption("off");
    await app.settle();
    expect(await cells()).toBe(before);
  });

  test("median and mean are different pictures", async ({ page }) => {
    const app = new MadyApp(page);
    await app.open();
    await app.openGraph(GENE_HEATMAP);
    await page.locator("svg.gfx-figure").click({ position: { x: 5, y: 5 } });
    await app.settle();
    await page.getByLabel("Add a column strip").click();
    await app.settle();
    await page.getByText("Value per column").click();
    const boxes = page.locator("input[aria-label^='column strip 1 value for']");
    const n = await boxes.count();
    for (let i = 0; i < n; i++) await boxes.nth(i).fill("All");
    await app.settle();

    const fills = async (): Promise<string[]> =>
      page.evaluate(() =>
        [...document.querySelectorAll("svg.gfx-figure rect[data-heatcell]")].map((r) => r.getAttribute("fill") ?? ""),
      );
    await page.getByLabel("Collapse replicate columns").selectOption("mean");
    await app.settle();
    const mean = await fills();
    await page.getByLabel("Collapse replicate columns").selectOption("median");
    await app.settle();
    const median = await fills();
    expect(mean.length).toBe(median.length);
    expect(median, "mean and median of the same rows should not agree on every row").not.toEqual(mean);
  });
});
