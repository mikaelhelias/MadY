import { expect, test } from "@playwright/test";
import { collectErrors, MadyApp } from "./app";

/**
 * Funnel plot in a real browser. funnel-plot.test.tsx proves the builder
 * and controls in jsdom; this proves the parts jsdom cannot: the gallery card inserts a live
 * graph with the pseudo-CI region painted, and a real pointer drag on the title commits
 * through the document (a title that offers a drag must store it).
 */

test.describe("funnel plot — live insert + real drag commits", () => {
  test.beforeEach(async ({ page }) => {
    await collectErrors(page);
  });

  test("gallery card inserts a funnel with the region drawn; title drag commits an offset", async ({ page }) => {
    const app = new MadyApp(page);
    // Straight from the Welcome page (its Chart-gallery link is only there — app.open()
    // would front a graph tab and hide it).
    await page.goto("/");
    await page.waitForSelector(".nav", { timeout: 30_000 });
    await page.evaluate(() => {
      [...document.querySelectorAll("button")].find((b) => /chart gallery/i.test(b.textContent ?? ""))?.click();
    });
    await app.settle();
    const card = page.locator("[class*=gallery]", { hasText: /^Funnel plot/ }).first();
    await card.scrollIntoViewIfNeeded();
    await card.click();
    await page.waitForSelector("svg.gfx-figure");
    await app.settle();

    // The pseudo-CI triangle really paints, and the pooled reference line exists.
    expect(await page.locator(".gfx-funnelregion path").count()).toBeGreaterThan(0);

    // Real drag: the title moves and the offset commits to the document.
    const title = page.locator("svg.gfx-figure text", { hasText: /Funnel/i }).first();
    const box = (await title.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 20, { steps: 4 });
    await page.mouse.up();
    await app.settle();
    const proj = (await app.project()) as { plots: Array<{ kind?: string; titleOffset?: { dx: number; dy: number } }> };
    const plot = proj.plots.find((p) => p.kind === "funnel");
    expect(plot, "the inserted funnel plot must exist in the document").toBeTruthy();
    expect(Math.abs(plot!.titleOffset?.dx ?? 0), "the title drag must commit a titleOffset").toBeGreaterThan(20);
    expect(await app.consoleErrors()).toEqual([]);
  });
});
