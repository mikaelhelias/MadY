import { expect, test } from "@playwright/test";
import { MadyApp } from "./app";

/**
 * The key for a numeric strip, in the running app.
 *
 * A strip of words says what it means; a strip of numbers shades through a ramp, and without a
 * key the reader sees that one row is darker and never learns what that means. jsdom proves the
 * drawable exists and carries its handlers; the real app is needed to prove the key survives
 * the five hops from the figure to the document, that the
 * checkbox reaches it, and that dragging it writes an offset that comes back on the next build.
 */
const GENE_HEATMAP = "Gene expression heatmap";

/** Open the demo heatmap with the Chart panel showing. */
async function openHeatmap(page: import("@playwright/test").Page): Promise<MadyApp> {
  const app = new MadyApp(page);
  await app.open();
  await app.openGraph(GENE_HEATMAP);
  await page.locator("svg.gfx-figure").click({ position: { x: 5, y: 5 } });
  await app.settle();
  return app;
}

/** Add a row strip reading a numeric column of the demo sheet (the matrix columns are numbers). */
async function addNumericRowStrip(page: import("@playwright/test").Page, app: MadyApp): Promise<string> {
  await page.getByLabel("Add a row strip").click();
  await app.settle();
  const pick = page.getByLabel("row strip 1 column");
  const opts = await pick.locator("option").allTextContents();
  // opts[1] is the lead column (the row names — text). opts[2] is the first numeric one.
  const col = opts[2]!;
  await pick.selectOption({ label: col });
  await app.settle();
  return col;
}

test.describe("a numeric strip's key (live)", () => {
  test("it is drawn, it names the column it decodes, and it says the range", async ({ page }) => {
    const app = await openHeatmap(page);
    const col = await addNumericRowStrip(page, app);

    const key = page.locator("[data-heattrackkey='row-0']");
    await expect(key, "the numeric strip drew no key — nothing decodes its ramp").toBeVisible();
    const texts = await key.locator("text").allTextContents();
    // the caption falls back to the source column: a strip is added with no name of its own
    expect(texts, `the key does not say it decodes "${col}"`).toContain(col);
    // …and two end numbers that are really numbers
    const nums = texts.filter((t) => t !== col).map(Number).filter((n) => Number.isFinite(n));
    expect(nums.length, "the key has no value range on it").toBe(2);
    expect(Math.max(...nums)).toBeGreaterThan(Math.min(...nums));
    // it paints real colour, not an empty frame
    const fills = await key.locator("rect[fill]").evaluateAll((els) =>
      els.map((e) => e.getAttribute("fill") ?? "").filter((f) => f && f !== "none"),
    );
    expect(new Set(fills).size, "the key bar is one flat colour").toBeGreaterThan(1);
  });

  test("a strip of words gets no key — it draws the words instead", async ({ page }) => {
    const app = await openHeatmap(page);
    await page.getByLabel("Add a column strip").click();
    await app.settle();
    await page.getByText("Value per column").click();
    const boxes = page.locator("input[aria-label^='column strip 1 value for']");
    const n = await boxes.count();
    for (let i = 0; i < n; i++) await boxes.nth(i).fill(i < 2 ? "Ctrl" : "Drug");
    await app.settle();
    await expect(page.locator("[data-heattrackkey='col-0']")).toHaveCount(0);
    const words = await page.locator("g.gfx-heattrack[data-heattrack^='col'] text").allTextContents();
    expect(words.join(" ")).toMatch(/Ctrl/);
  });

  test("the checkbox turns keys off and back on", async ({ page }) => {
    const app = await openHeatmap(page);
    await addNumericRowStrip(page, app);
    await expect(page.locator("[data-heattrackkey='row-0']")).toBeVisible();
    await page.getByLabel("Key for numeric strips").uncheck();
    await app.settle();
    await expect(page.locator("[data-heattrackkey='row-0']")).toHaveCount(0);
    await page.getByLabel("Key for numeric strips").check();
    await app.settle();
    await expect(page.locator("[data-heattrackkey='row-0']")).toBeVisible();
  });

  test("clicking the key opens the strip's own editor, and dragging it is remembered", async ({ page }) => {
    const app = await openHeatmap(page);
    await addNumericRowStrip(page, app);
    const key = page.locator("[data-heattrackkey='row-0']");

    // click → the strip's row in the panel is the marked one
    await key.locator("rect").first().click({ force: true });
    await app.settle();
    const marked = await page.locator("[data-track-row='row-0']").getAttribute("class");
    expect(marked, "the key's click did not open the strip's editor").toContain("on");

    // drag → the offset is stored on the strip and the drawing moved with it.
    // Note: grab the bar, not the group's bounding box: that box spans the caption and the end
    // numbers too, and its centre falls in the empty gap between them.
    const box = (await key.boundingBox())!;
    const barBox = (await key.locator("rect").first().boundingBox())!;
    const x0 = barBox.x + barBox.width / 2;
    const y0 = barBox.y + barBox.height / 2;
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.mouse.move(x0 - 30, y0 + 24, { steps: 8 });
    await page.mouse.up();
    await app.settle();

    const project = (await app.project()) as { plots: { heatmap?: { rowTracks?: { keyOffset?: { dx: number; dy: number } }[] } }[] };
    const off = project.plots.map((p) => p.heatmap?.rowTracks?.[0]?.keyOffset).find(Boolean);
    expect(off, "the drag was not written down").toBeTruthy();
    expect(off!.dx).toBeLessThan(0);
    expect(off!.dy).toBeGreaterThan(0);
    const moved = (await key.boundingBox())!;
    expect(Math.round(moved.x)).toBeLessThan(Math.round(box.x));
  });
});
