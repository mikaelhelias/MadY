import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Switching between menu-bar menus — the gesture an outside-click scrim can swallow.
 *
 * With any menu open (e.g. Analyze, two titles left of Help), a `.menu-scrim` —
 * `position: fixed; inset: 0; z-index: 40` — covers the whole viewport. The menu bar sits
 * above it (z-index 42, shell.css); if the scrim covered the menu bar too, the titles of every
 * other menu would be under it:
 *   - hover-sliding Analyze → Help would do nothing (the `onMouseEnter` never fires), and
 *   - clicking Help would only dismiss Analyze; a second click would be needed to open Help.
 *
 * Note: this cannot be tested in jsdom. There is no layout there, so nothing stacks and nothing
 * intercepts a click — the scrim and the title occupy the same "position" and the handler
 * fires either way. Only a real browser hit-tests. The first assertion below deliberately
 * uses a plain `.click()` (not `force`) so Playwright's actionability check reports the
 * interception itself; the rest read the `.menu.open` class back.
 */

/** The `<span class="menu">` for one top-level menu. */
const title = (page: Page, name: string) =>
  page.locator(".menubar span.menu", { hasText: new RegExp(`^${name}$`) }).first();

/** The menu whose dropdown is showing, or null. */
const openMenu = (page: Page): Promise<string | null> =>
  page.evaluate(() => {
    const el = document.querySelector(".menubar .menu.open");
    return el ? (el.textContent ?? "").trim() : null;
  });

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector(".nav", { timeout: 30_000 });
});

test("clicking Help while Analyze is open opens Help in one click", async ({ page }) => {
  await title(page, "Analyze").click();
  expect(await openMenu(page)).toBe("Analyze");

  // No `force` — if the scrim is over the menu bar this throws "intercepts pointer events".
  await title(page, "Help").click();

  expect(await openMenu(page)).toBe("Help");
  await expect(page.locator(".dropdown", { hasText: "About MadY" })).toBeVisible();
});

test("hover-sliding from Analyze to Help switches the open menu", async ({ page }) => {
  await title(page, "Analyze").click();
  expect(await openMenu(page)).toBe("Analyze");

  await title(page, "Help").hover();

  expect(await openMenu(page)).toBe("Help");
});

test("the scrim still closes the menu on a click outside the menu bar", async ({ page }) => {
  await title(page, "Help").click();
  expect(await openMenu(page)).toBe("Help");

  await page.locator(".menu-scrim").click({ position: { x: 700, y: 600 } });

  expect(await openMenu(page)).toBeNull();
});

test("clicking the open menu's own title closes it", async ({ page }) => {
  await title(page, "Help").click();
  expect(await openMenu(page)).toBe("Help");

  await title(page, "Help").click();

  expect(await openMenu(page)).toBeNull();
});
