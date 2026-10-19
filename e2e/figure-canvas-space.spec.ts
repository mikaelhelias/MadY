import { expect, test } from "@playwright/test";
import { MadyApp } from "./app";

/**
 * The figure page gives the figure its space: the panel assembly's toolbar must not crowd out the figure.
 * Each test runs in the real app at a common laptop size (1440 × 900, the config's viewport) and is written against
 * what the user sees — never against which toolbar row or panel a control sits in, so the toolbar can be regrouped
 * without rewriting these tests.
 *
 * Guards against: tools above the figure pushing the first panel into the lower half of the window; a new text
 * landing under the status bar; selecting an object pushing the canvas down; and a status-bar zoom that changes its
 * label while nothing changes size.
 */

const figure = async (page: import("@playwright/test").Page): Promise<MadyApp> => {
  const app = new MadyApp(page);
  await app.open();
  await app.newFigure(["Dose-response", "Treatment bar chart"]);
  await app.settle();
  return app;
};
const panelA = (page: import("@playwright/test").Page) => page.locator(".layoutview-body svg.gfx-figure").first();
const insertText = async (page: import("@playwright/test").Page): Promise<void> => {
  // By its tooltip: the button may move into an Insert menu, and the test must follow it there.
  const direct = page.locator('button[title^="Text box on the figure canvas"]');
  if (!(await direct.isVisible())) await page.getByRole("button", { name: /^Insert/ }).click();
  await direct.click();
};

test.describe("figure page — the figure gets the space (1440 × 900)", () => {
  test("the figure starts in the top half of the window", async ({ page }) => {
    await figure(page);
    const top = (await panelA(page).boundingBox())!.y;
    expect(top, `the first panel starts at y ${Math.round(top)} of 900 — the tools above it take the space`).toBeLessThan(450);
  });

  test("Insert ▸ Text: the new text is on screen, above the status bar", async ({ page }) => {
    const app = await figure(page);
    await insertText(page);
    await app.settle();
    const text = (await page.locator("svg.layannot text").first().boundingBox())!;
    const statusTop = (await page.locator("div.status").boundingBox())!.y;
    expect(text.y + text.height, `the text sits at y ${Math.round(text.y)}, under the status bar (y ${Math.round(statusTop)})`).toBeLessThanOrEqual(statusTop);
    expect(text.y).toBeGreaterThan(0);
  });

  test("selecting an object does not move the figure", async ({ page }) => {
    const app = await figure(page);
    const before = (await panelA(page).boundingBox())!.y;
    await insertText(page); // an insert selects the new object
    await app.settle();
    const after = (await panelA(page).boundingBox())!.y;
    expect(Math.round(after - before), "the figure moved when the object was selected").toBe(0);
  });

  test("double-clicking a text that is not selected opens it for editing", async ({ page }) => {
    const app = await figure(page);
    await insertText(page);
    await app.settle();
    await page.keyboard.press("Escape"); // deselect: the double-click must work on an unselected text
    await app.settle();
    const t = page.locator("svg.layannot text").first();
    await t.scrollIntoViewIfNeeded();
    const b = (await t.boundingBox())!;
    await page.mouse.dblclick(b.x + b.width / 2, b.y + b.height / 2);
    await expect(page.locator(".layannot-editor"), "the double-click did not open the text for editing").toBeVisible();
  });

  test("with the Inspector collapsed, a picked object's settings stay in the toolbar — never lost", async ({ page }) => {
    const app = await figure(page);
    await page.locator('button[title="Collapse Inspector"]').click();
    await app.settle();
    await insertText(page);
    await app.settle();
    await expect(page.locator(".laygroup-h", { hasText: "Object" }), "collapsed Inspector: the settings vanished").toBeVisible();
    await expect(page.locator('button[title^="Lock the object in place"]')).toBeVisible();
    await page.locator('button[title="Expand Inspector"]').click();
    await app.settle();
    await expect(page.locator(".figinsp .figsel-h")).toHaveText("Text box");
    await expect(page.locator(".laygroup-h", { hasText: "Object" }), "the toolbar kept its Object row with the Inspector open").toHaveCount(0);
  });

  test("the status-bar zoom resizes the figure", async ({ page }) => {
    const app = await figure(page);
    const before = (await panelA(page).boundingBox())!.width;
    await page.getByRole("button", { name: "Zoom in" }).click();
    await page.getByRole("button", { name: "Zoom in" }).click();
    await app.settle();
    const label = await page.locator("[data-zoom-label]").textContent();
    const after = (await panelA(page).boundingBox())!.width;
    expect(after, `the status bar says ${label}, and panel A is still ${Math.round(after)} px wide`).toBeGreaterThan(before * 1.1);
  });

  test("one zoom: the status bar, Ctrl + =, Ctrl+scroll and the toolbar slider show and set the same value", async ({ page }) => {
    const app = await figure(page);
    const width = async () => Math.round((await panelA(page).boundingBox())!.width);
    const status = async () => (await page.locator("[data-zoom-label]").textContent())?.trim();
    const slider = page.locator('input[aria-label="Canvas zoom"]');
    const w100 = await width();
    await page.keyboard.press("Control+Equal");
    await app.settle();
    expect(await status()).toBe("110%");
    expect(await slider.inputValue(), "the slider did not follow Ctrl + =").toBe("1.1");
    await page.keyboard.press("Control+0");
    await app.settle();
    const b = (await page.locator(".laypanel").first().boundingBox())!;
    await page.mouse.move(b.x + 40, b.y + 40);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -120);
    await page.keyboard.up("Control");
    await app.settle();
    expect(await status(), "Ctrl+scroll on the figure did not zoom it").toBe("110%");
    await slider.fill("0.5");
    await app.settle();
    expect(await status(), "the status bar did not follow the toolbar slider").toBe("50%");
    expect(Math.abs((await width()) - w100 / 2), "the figure is not at half size").toBeLessThan(3);
  });

  test("arriving at a figure opens the Inspector — even on a new profile that never opened a graph — and a collapse sticks", async ({ page }) => {
    // The figure's settings live in the Inspector, so arriving at Arrange opens it, the same rule a
    // graph follows. Guards against it staying collapsed on this route until something is clicked.
    const app = new MadyApp(page);
    await page.goto("/");
    await page.waitForSelector(".nav", { timeout: 30_000 });
    await app.newFigure(["Dose-response", "Treatment bar chart"]);
    await app.settle();
    await expect(page.locator('button[title="Collapse Inspector"]'), "arrived at the figure with the Inspector shut").toHaveCount(1);
    await expect(page.locator(".figinsp .figsel-h")).toHaveText("Figure");
    await page.locator('button[title="Collapse Inspector"]').click();
    await app.settle();
    await app.setGutter(24); // work on the page without picking anything
    await expect(page.locator('button[title="Expand Inspector"]'), "the Inspector re-opened by itself while working").toHaveCount(1);
  });
});
