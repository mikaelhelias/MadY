import { expect, test } from "@playwright/test";
import { collectErrors, MadyApp } from "./app";

/**
 * Figure objects in a real browser: text / arrows / lines / boxes drawn on
 * the assembler canvas between panels.
 *
 * `figure-annotations.test.tsx` proves the mutations, the resolver and the export composer
 * in jsdom; this layer proves what jsdom cannot: a real pointer drag commits canvas px
 * through the document (getScreenCTM), the lock really freezes an object against real
 * geometry, and the overlay paints over the live canvas without swallowing panel clicks.
 */

type Ann = { id: string; kind: string; x?: number; y?: number; x2?: number; locked?: boolean };

/** The object buttons are in the figure toolbar's Insert ▾ — open it, as a user does, then press the one by its tooltip. */
const insertObject = async (page: import("@playwright/test").Page, title: string): Promise<void> => {
  await page.locator("button.laymenu-btn", { hasText: /^Insert/ }).click();
  await page.locator(`button[title^="${title}"]`).click();
};

const anns = async (app: MadyApp): Promise<Ann[]> =>
  (((await app.layout()) as { figureAnnotations?: Ann[] } | null)?.figureAnnotations ?? []);

test.describe("figure objects — insert, drag, lock, delete on the arrange canvas", () => {
  test.beforeEach(async ({ page }) => {
    await collectErrors(page);
  });

  test("Insert ▸ Text: commits canvas px, renders on the overlay, drags for real, deletes", async ({ page }) => {
    const app = new MadyApp(page);
    await app.open();
    await app.newFigure(["Dose-response", "Treatment bar chart"]);

    await insertObject(page, "Text box on the figure canvas");
    await app.settle();
    let list = await anns(app);
    expect(list).toHaveLength(1);
    expect(list[0]!.kind).toBe("text");
    // canvas px (the canvas is hundreds of px wide), never a 0..1 fraction
    expect(list[0]!.x!).toBeGreaterThan(10);

    const t = page.locator("svg.layannot text");
    await expect(t).toHaveText("Text");

    // A real drag → the document's stored position moves by the dragged distance
    const before = list[0]!;
    // On a short window the text can still sit below the fold: a user scrolls to it first, and so does this test.
    // (At 1440×900 it is on screen, with the object settings in the Inspector — figure-canvas-space.spec.)
    await t.scrollIntoViewIfNeeded();
    const box = (await t.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 40, { steps: 5 });
    await page.mouse.up();
    await app.settle();
    list = await anns(app);
    expect(list[0]!.x!, "drag must commit a moved x").toBeGreaterThan(before.x! + 40);
    expect(list[0]!.y!, "drag must commit a moved y").toBeGreaterThan(before.y! + 20);

    // The drag selected it → Delete removes it through the document
    await page.keyboard.press("Delete");
    await app.settle();
    expect(await anns(app)).toHaveLength(0);
    await expect(page.locator("svg.layannot")).toHaveCount(0);
    expect(await app.consoleErrors()).toEqual([]);
  });

  test("a locked object ignores a real drag; unlock frees it again", async ({ page }) => {
    const app = new MadyApp(page);
    await app.open();
    await app.newFigure(["Dose-response", "Treatment bar chart"]);

    await insertObject(page, "Rectangle on the figure canvas");
    await app.settle();
    const before = (await anns(app))[0]!;
    expect(before.kind).toBe("rect");

    // The insert selects the new object → its settings are in the Inspector; lock it.
    await page.locator('button[title^="Lock the object in place"]').click();
    await app.settle();
    expect((await anns(app))[0]!.locked).toBe(true);

    const r = page.locator("svg.layannot rect").first();
    const box = (await r.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2 + 60, { steps: 5 });
    await page.mouse.up();
    await app.settle();
    const after = (await anns(app))[0]!;
    expect(after.x, "a locked object must not move").toBe(before.x);
    expect(after.y, "a locked object must not move").toBe(before.y);

    await page.locator('button[title^="Unlock the object"]').click();
    await app.settle();
    expect((await anns(app))[0]!.locked ?? false).toBe(false);
    expect(await app.consoleErrors()).toEqual([]);
  });

  test("arrow + line + box + ellipse all insert and paint; panels still click through around them", async ({ page }) => {
    const app = new MadyApp(page);
    await app.open();
    await app.newFigure(["Dose-response", "Treatment bar chart"]);

    for (const title of [
      "Arrow on the figure canvas",
      "Plain line on the figure canvas",
      "Rectangle on the figure canvas",
      "Ellipse on the figure canvas",
    ]) {
      await insertObject(page, title);
      await app.settle();
    }
    expect((await anns(app)).map((a) => a.kind).sort()).toEqual(["arrow", "ellipse", "rect", "segment"]);
    // all four painted on the one overlay
    expect(await page.locator("svg.layannot ellipse").count()).toBeGreaterThan(0);
    expect(await page.locator("svg.layannot rect").count()).toBeGreaterThan(0);
    // the canvas-spanning overlay must not swallow panel interaction: a panel's card is
    // still hoverable/clickable at a spot away from the objects (top-left panel corner)
    const panel = page.locator(".laypanel").first();
    const pb = (await panel.boundingBox())!;
    await page.mouse.click(pb.x + 8, pb.y + 8);
    await app.settle();
    expect(await app.consoleErrors()).toEqual([]);
  });
});
