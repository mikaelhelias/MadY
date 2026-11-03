import { expect, test } from "@playwright/test";
import { MadyApp, collectErrors } from "./app";

/**
 * View ▸ Colour-blind preview in a real browser: the wrapper's computed `filter`
 * becomes the svg filter reference, the badge says so, and the on-screen svg itself carries no
 * filter (the export clones that svg alone). jsdom proves the serialized export in
 * colorVision.test.tsx; this proves the browser actually applies the preview.
 */
test.describe("colour-blind preview", () => {
  test("View menu turns it on, the wrapper is filtered, the drawing itself is not", async ({ page }) => {
    await collectErrors(page);
    const app = new MadyApp(page);
    await app.open();

    const wrapperFilter = () => page.evaluate(() => getComputedStyle(document.querySelector(".graphzoom")!).filter);
    expect(await wrapperFilter()).toBe("none");
    expect(await page.locator(".cvdbadge").count()).toBe(0);

    await app.menu("View", "Colour-blind preview");
    await app.settle();
    expect(await wrapperFilter()).toContain("mady-cvd-deuteranopia");
    await expect(page.locator(".cvdbadge")).toContainText("Deuteranopia");
    // The drawing the export clones carries nothing.
    expect(await page.evaluate(() => document.querySelector("svg.gfx-figure")!.outerHTML.includes("mady-cvd"))).toBe(false);
    expect(await page.evaluate(() => getComputedStyle(document.querySelector("svg.gfx-figure")!).filter)).toBe("none");

    // The ribbon select changes the kind; the badge follows.
    await page.locator('select[title^="Colour-vision preview"]').selectOption("grayscale");
    await app.settle();
    expect(await wrapperFilter()).toContain("mady-cvd-grayscale");
    await expect(page.locator(".cvdbadge")).toContainText("Greyscale");

    // Off again from the badge.
    await page.locator(".cvdbadge button").click();
    await app.settle();
    expect(await wrapperFilter()).toBe("none");
    expect(await app.consoleErrors()).toEqual([]);
  });
});
