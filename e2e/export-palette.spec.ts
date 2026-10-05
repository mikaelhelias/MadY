import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { MadyApp, collectErrors } from "./app";

/**
 * Export palette — an exported figure must be legible on the page it is exported onto.
 *
 * `var(--ink)` means "ink that reads on screen". Resolved against the live document root, a
 * user working in dark mode would export near-white titles, axis titles and value labels onto
 * a white page: a partially invisible figure (ticks survive, because the house preset pins
 * them to #0a0a0a), which reads as a rendering glitch rather than a defect.
 *
 * This drives the real export path in a real browser and asserts on the exported bytes.
 * The unit suite covers the decision logic and both directions (exporters.theme.test.tsx);
 * this proves it end-to-end through the dialog, the serializer and the download.
 */

/** Finish an already-open Export dialog as SVG and return the downloaded text. */
async function downloadSvg(page: import("@playwright/test").Page): Promise<string> {
  const dialog = page.locator('.modal[role="dialog"][aria-label="Export"]');
  await expect(dialog).toBeVisible();
  await dialog.locator('select[aria-label="Format"]').selectOption("svg");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    dialog.getByRole("button", { name: /Export SVG/i }).click(),
  ]);
  return readFile((await download.path())!, "utf8");
}

test.describe("export palette", () => {
  test("exporting from dark mode bakes ink that reads on the white page", async ({ page }) => {
    await collectErrors(page);
    const app = new MadyApp(page);
    await app.open();

    await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
    await app.settle();

    await page.keyboard.press("Control+e");
    const svgText = await downloadSvg(page);

    // The dark palette's ink (#e6e8eb) must never be baked onto a white page.
    expect(svgText.toLowerCase()).not.toContain("#e6e8eb");
    // ...and the app's own theme must be left exactly as the user had it.
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");
    expect(await app.consoleErrors()).toEqual([]);
  });
});
