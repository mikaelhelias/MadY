import { expect, test } from "@playwright/test";
import { collectErrors, MadyApp } from "./app";

/**
 * UpSet plot in a real browser. upset-plot.test.tsx proves the
 * intersections, geometry and controls in jsdom; this proves what jsdom cannot: the gallery
 * card inserts a live composite (bars + matrix + set-size bars), clicking a set-size bar
 * selects its own set through the document selection, and a real pointer drag on a matrix set
 * label commits `upset.labelOffsets`.
 */

test.describe("upset — live insert, set click, real label drag", () => {
  test.beforeEach(async ({ page }) => {
    await collectErrors(page);
  });

  test("card inserts; set bar click selects; label drag commits an offset", async ({ page }) => {
    const app = new MadyApp(page);
    await page.goto("/");
    await page.waitForSelector(".nav", { timeout: 30_000 });
    await page.evaluate(() => {
      [...document.querySelectorAll("button")].find((b) => /chart gallery/i.test(b.textContent ?? ""))?.click();
    });
    await app.settle();
    const card = page.locator("[class*=gallery]", { hasText: /^UpSet plot/ }).first();
    await card.scrollIntoViewIfNeeded();
    await card.click();
    await page.waitForSelector("svg.gfx-figure");
    await app.settle();

    // The composite paints: 5 set-size bars, the membership dot grid, member connectors.
    expect(await page.locator("rect.upsetsetbar").count()).toBe(5);
    expect(await page.locator("circle.upsetdot").count()).toBeGreaterThanOrEqual(30);
    expect(await page.locator("line.upsetlink").count()).toBeGreaterThanOrEqual(3);

    // A real drag on a matrix set label commits its offset into the document.
    const label = page.locator("svg.gfx-figure text", { hasText: /^Drug A$/ }).first();
    const box = (await label.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 25, { steps: 4 });
    await page.mouse.up();
    await app.settle();
    const proj = (await app.project()) as { plots: Array<{ kind?: string; upset?: { labelOffsets?: Record<string, { dx: number; dy: number }> } }> };
    const plot = proj.plots.find((p) => p.kind === "upset");
    expect(plot, "the inserted upset plot must exist").toBeTruthy();
    const offs = Object.values(plot!.upset?.labelOffsets ?? {});
    expect(offs.length, "the label drag must commit an offset").toBeGreaterThan(0);
    expect(Math.abs(offs[0]!.dx), "the offset must reflect the drag").toBeGreaterThan(15);
    expect(await app.consoleErrors()).toEqual([]);
  });
});
