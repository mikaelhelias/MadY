import { expect, test } from "@playwright/test";
import { MadyApp, collectErrors } from "./app";

/**
 * Grouped toolbar. The toolbar is organised into named groups (File · Edit ·
 * Data · Analyze · Graph) with a caption over each icon row; groups reorder as a whole, icons
 * reorder within a group, membership is fixed. The pure reorder helpers are unit-tested; what a
 * real browser adds here is (1) the captions actually render in order in the live layout, (2)
 * undo/redo sit in the Edit group, (3) a real HTML5 drag reorders a group and the new
 * order survives a reload (localStorage `mady.toolbar.v2`), and (4) the surfaced datasheet
 * actions run without a console error.
 */
test.describe("toolbar groups", () => {
  test("captions render in order, undo/redo live in Edit", async ({ page }) => {
    await collectErrors(page);
    const app = new MadyApp(page);
    await app.open();

    await expect(page.locator(".toolbar .gl")).toHaveText(["File", "Edit", "Data", "Analyze", "Graph"]);

    const editGroup = page.locator(".toolbar .grp", { has: page.locator(".gl", { hasText: /^Edit$/ }) });
    await expect(editGroup.locator('button[title^="Undo"]')).toHaveCount(1);
    await expect(editGroup.locator('button[title^="Redo"]')).toHaveCount(1);
    expect(await app.consoleErrors()).toEqual([]);
  });

  test("dragging a group caption reorders the groups and persists across reload", async ({ page }) => {
    await collectErrors(page);
    const app = new MadyApp(page);
    await app.open();

    const fileCap = page.locator(".toolbar .gl", { hasText: /^File$/ });
    const graphGroup = page.locator(".toolbar .grp", { has: page.locator(".gl", { hasText: /^Graph$/ }) });
    await fileCap.dragTo(graphGroup);
    await app.settle();

    const afterDrag = await page.locator(".toolbar .gl").allTextContents();
    expect(afterDrag[0]).not.toBe("File"); // File moved off the front
    expect(new Set(afterDrag)).toEqual(new Set(["File", "Edit", "Data", "Analyze", "Graph"])); // no loss or duplicate

    await page.reload();
    await page.waitForSelector(".toolbar .gl");
    await expect(page.locator(".toolbar .gl")).toHaveText(afterDrag);
  });

  test("New datasheet toolbar button runs and marks the project dirty", async ({ page }) => {
    await collectErrors(page);
    const app = new MadyApp(page);
    await app.open();

    await page.locator('.toolbar button[title^="New datasheet"]').click();
    await app.settle();

    await expect(page.locator(".toolbar .savedot")).toHaveCount(1); // dirty dot lit
    await expect(page.locator('.toolbar button[title^="Duplicate the current datasheet"]')).toBeEnabled();
    expect(await app.consoleErrors()).toEqual([]);
  });
});
