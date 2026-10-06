import { expect, test } from "@playwright/test";
import { collectErrors, MadyApp } from "./app";
import { clippedHints } from "./hintFits";

/**
 * A hint inside an empty box must fit the box.
 *
 * Guards against a hint cut off by its box. The number spinner takes ~15 px of a number box, so
 * a word that fits a text box of the same width does not fit a number box. jsdom has no layout,
 * so only a real browser can measure it.
 *
 * This covers the Axis tab, X and Y, with every group open. The check over every tab of every
 * chart type and every dialog is `hint-fits-everywhere.spec.ts`.
 */
test("every hint in the Axis tab fits its box", async ({ page }) => {
  await collectErrors(page);
  const app = new MadyApp(page);
  await app.open();
  await app.openGraph("Dose-response");

  const fig = page.locator("svg.gfx-figure").first();
  await fig.click({ position: { x: 60, y: 20 } });
  await app.settle();
  await page.locator(".inspcats button", { hasText: /^Axis$/ }).click();
  await app.settle();

  const clipped: string[] = [];
  let measured = 0;
  for (const axis of ["X", "Y"]) {
    await page.locator(".insp .frow button.btn-mini", { hasText: new RegExp(`^${axis}$`) }).first().click();
    await app.settle();
    await page.evaluate(() => {
      for (const d of document.querySelectorAll<HTMLDetailsElement>(".insp details")) d.open = true;
    });
    await app.settle();
    const r = await clippedHints(page, ".insp");
    measured += r.n;
    for (const b of r.bad) clipped.push(`${axis} axis · ${b}`);
  }

  expect(measured, "measured no hints at all — the probe found no boxes").toBeGreaterThan(5);
  expect(clipped, "hint text cut off by its box").toEqual([]);
});
