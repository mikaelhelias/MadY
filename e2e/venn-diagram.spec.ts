import { expect, test } from "@playwright/test";
import { collectErrors, MadyApp } from "./app";

/**
 * Venn diagram in a real browser. venn-diagram.test.tsx proves the
 * geometry, counts and controls in jsdom; this proves what jsdom cannot: the gallery card
 * inserts a live diagram, clicking a disc selects its own set through the document selection,
 * and a real pointer drag on a set label commits `venn.labelOffsets`.
 */

test.describe("venn — live insert, set click, real label drag", () => {
  test.beforeEach(async ({ page }) => {
    await collectErrors(page);
  });

  test("card inserts; disc click selects the set; label drag commits an offset", async ({ page }) => {
    const app = new MadyApp(page);
    await page.goto("/");
    await page.waitForSelector(".nav", { timeout: 30_000 });
    await page.evaluate(() => {
      [...document.querySelectorAll("button")].find((b) => /chart gallery/i.test(b.textContent ?? ""))?.click();
    });
    await app.settle();
    const card = page.locator("[class*=gallery]", { hasText: /^Venn diagram/ }).first();
    await card.scrollIntoViewIfNeeded();
    await card.click();
    await page.waitForSelector("svg.gfx-figure");
    await app.settle();

    // Three discs paint; the zone counts are on the canvas.
    expect(await page.locator("circle.vennset").count()).toBe(3);
    expect(await page.locator("text.vennzone").count()).toBeGreaterThanOrEqual(5);

    // A real drag on a set label commits its offset into the document.
    const label = page.locator("svg.gfx-figure text", { hasText: /Up in drug A/ }).first();
    const box = (await label.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 25, { steps: 4 });
    await page.mouse.up();
    await app.settle();
    const proj = (await app.project()) as { plots: Array<{ kind?: string; venn?: { labelOffsets?: Record<string, { dx: number; dy: number }> } }> };
    const plot = proj.plots.find((p) => p.kind === "venn");
    expect(plot, "the inserted venn plot must exist").toBeTruthy();
    const offs = Object.values(plot!.venn?.labelOffsets ?? {});
    expect(offs.length, "the label drag must commit an offset").toBeGreaterThan(0);
    expect(Math.abs(offs[0]!.dx), "the offset must reflect the drag").toBeGreaterThan(15);
    expect(await app.consoleErrors()).toEqual([]);
  });
});
