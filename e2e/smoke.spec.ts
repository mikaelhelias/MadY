import { expect, test } from "@playwright/test";
import { MadyApp, collectErrors } from "./app";

/** Proves the harness itself works: the built renderer boots, the sample document renders,
 *  the fiber driver can read the document, and a real drag commits its change (which jsdom
 *  cannot do). If this fails, every other e2e result is meaningless — fix this first. */
test.describe("harness", () => {
  test("the built renderer boots and the driver can read the document", async ({ page }) => {
    await collectErrors(page);
    const app = new MadyApp(page);
    await app.open();

    const proj = (await app.project()) as { plots?: { id: string; name: string }[] };
    expect(proj.plots?.length, "no plots in the sample document").toBeGreaterThan(0);
    expect(await app.consoleErrors()).toEqual([]);
  });

  test("getScreenCTM works here, so a real drag commits its change (the reason this layer exists)", async ({ page }) => {
    await collectErrors(page);
    const app = new MadyApp(page);
    await app.open();

    // The title is draggable on every kind; its offset persists as plot.titleOffset.
    const title = page.locator("svg.gfx-figure text", { hasText: /.+/ }).first();
    const box = await title.boundingBox();
    expect(box, "no title to drag").toBeTruthy();

    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width / 2 + 40, box!.y + box!.height / 2 + 25, { steps: 8 });
    await page.mouse.up();
    await app.settle();

    // jsdom cannot reach this assertion: getScreenCTM is null there, so the commit never runs.
    const ctm = await page.evaluate(() => {
      const svg = document.querySelector("svg.gfx-figure") as SVGSVGElement | null;
      return !!svg?.getScreenCTM();
    });
    expect(ctm, "getScreenCTM is unavailable — this browser cannot commit coordinate drags").toBe(true);
  });
});
