import { expect, test } from "@playwright/test";
import { MadyApp, collectErrors } from "./app";

/**
 * The side panels must not be squeezed by a card added beside them.
 *
 * Guards against a card being added as a sibling of the project tree inside `.dockbody`.
 * That element is a row flex whose children each get `flex: 1`, so a second child splits the
 * column horizontally and can leave the project tree only a few pixels wide — present in the
 * DOM, responding to clicks, and unusable.
 *
 * Why a browser test: jsdom has no layout, so a unit test renders both components and
 * passes. Only a real browser can measure that a panel has been crushed, as with the
 * figure-geometry detector.
 *
 * The rule asserted here is deliberately about space, not markup: any dock panel that is
 * visible must be wide enough to use. That stays true however the layout is refactored.
 */

/** A dock panel narrower than this is not usable, whatever the DOM says. */
const MIN_USABLE_PANEL_WIDTH = 120;

test.describe("side-panel layout — a visible panel must be usable, not crushed", () => {
  test("the project tree keeps the full width of the left dock", async ({ page }) => {
    await collectErrors(page);
    const app = new MadyApp(page);
    await app.open();

    const dock = page.locator(".dock-left").first();
    const tree = dock.locator(".nav").first();
    await expect(tree).toBeVisible();

    const dockBox = await dock.boundingBox();
    const treeBox = await tree.boundingBox();
    expect(dockBox, "no left dock").toBeTruthy();
    expect(treeBox, "no project tree").toBeTruthy();

    expect(treeBox!.width, "the project tree is too narrow to use").toBeGreaterThanOrEqual(MIN_USABLE_PANEL_WIDTH);
    // It must own essentially the whole dock width — not share it with a sibling card.
    expect(treeBox!.width, "something is splitting the left dock horizontally").toBeGreaterThan(dockBox!.width * 0.9);
  });

  test("tree rows are wide enough to read, not collapsed to a sliver", async ({ page }) => {
    await collectErrors(page);
    const app = new MadyApp(page);
    await app.open();

    const row = page.locator(".dock-left .navrow").first();
    await expect(row).toBeVisible();
    const box = await row.boundingBox();
    // A crushed tree measures 8px here.
    expect(box!.width, "project tree rows are crushed").toBeGreaterThan(80);
  });

  test("the Ask box is on the menu bar, at its extreme right — not in the left dock at all", async ({ page }) => {
    // The Ask box lives on the menu bar. It must never appear as a sibling of the tree (the
    // crush above), and it must be the last thing on the bar.
    await collectErrors(page);
    const app = new MadyApp(page);
    await app.open();

    expect(await page.locator(".dock-left .askbar, .dock-left .nlbar").count(), "an Ask box is in the left dock").toBe(0);
    const ask = page.locator(".menubar .askbar").first();
    await expect(ask).toBeVisible();
    const askBox = (await ask.boundingBox())!;
    const bar = (await page.locator(".menubar").first().boundingBox())!;
    // Nothing on the bar sits to the right of it.
    for (const el of await page.locator(".menubar > *").all()) {
      const b = await el.boundingBox();
      if (!b || b.width === 0) continue;
      expect(b.x + b.width, "something on the menu bar sits to the right of the Ask box").toBeLessThanOrEqual(askBox.x + askBox.width + 1);
    }
    expect(bar.x + bar.width - (askBox.x + askBox.width), "the Ask box is not at the bar's right edge").toBeLessThan(24);
  });

  test("clicking a tree item still opens that graph", async ({ page }) => {
    await collectErrors(page);
    const app = new MadyApp(page);
    await app.open();

    // A squeezed panel can still be clickable, so prove the tree works as well as fits.
    const btn = page.locator(".dock-left button.navlabelbtn").filter({ hasText: "Treatment bar chart" }).first();
    await expect(btn).toBeVisible();
    await btn.click();

    await expect(page.locator("svg.gfx-figure text", { hasText: "Treatment bar chart" }).first()).toBeVisible();
    expect(await app.consoleErrors()).toEqual([]);
  });
});
