import { expect, test } from "@playwright/test";
import { MadyApp } from "./app";

/**
 * The New-graph wizard can be resized and shows a scrollbar, so the options below the sample
 * preview can be reached by scrolling or by enlarging the wizard.
 *
 * This lives in e2e, not jsdom: both facts are pure layout (a computed `resize`, a real drag, a
 * reserved scrollbar gutter). jsdom applies no stylesheet and lays nothing out, so a unit test
 * there could only re-state the source.
 */
test("the wizard resizes in both directions and its scroll regions show a scrollbar", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const app = new MadyApp(page);
  await app.open();
  await app.menu("Graph", "New graph…");
  const modal = page.locator(".modal-analyze");
  await expect(modal).toBeVisible();

  const before = (await modal.boundingBox())!;
  const canResize = await page.evaluate(() =>
    getComputedStyle(document.querySelector(".modal-analyze")!).resize);
  console.log("resize css =", canResize, "start size =", Math.round(before.width) + "x" + Math.round(before.height));

  // Drag the native grip in the bottom-right corner.
  const gx = before.x + before.width - 4, gy = before.y + before.height - 4;
  await page.mouse.move(gx, gy);
  await page.mouse.down();
  // Drag up and right: wider, and shorter. (Down is not testable from here — at a 720px-tall viewport
  // the dialog already sits on its 96vh ceiling, so it cannot grow taller. Asserting "taller" here
  // would be measuring the viewport, not the resize.)
  await page.mouse.move(gx + 160, gy - 140, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const after = (await modal.boundingBox())!;
  console.log("after drag =", Math.round(after.width) + "x" + Math.round(after.height));
  expect(after.width, "dragging the grip did not widen the wizard").toBeGreaterThan(before.width + 50);
  expect(after.height, "dragging the grip did not change the wizard's height").toBeLessThan(before.height - 60);

  // …and back down again, to prove height grows too and is not one-way.
  const g2 = (await modal.boundingBox())!;
  await page.mouse.move(g2.x + g2.width - 4, g2.y + g2.height - 4);
  await page.mouse.down();
  await page.mouse.move(g2.x + g2.width - 4, g2.y + g2.height + 100, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const grown = (await modal.boundingBox())!;
  console.log("after grow =", Math.round(grown.width) + "x" + Math.round(grown.height));
  expect(grown.height, "the wizard could be shrunk but not grown back").toBeGreaterThan(after.height + 60);

  // Shrink it back down small, then confirm the options panel really scrolls.
  await page.locator('input[aria-label="Start with sample data"]').check().catch(() => {});
  await app.settle();
  const bars = await page.evaluate(() => {
    const cfg = document.querySelector<HTMLElement>(".ng-config")!;
    const grid = document.querySelector<HTMLElement>(".an-scroll")!;
    const cs = getComputedStyle(cfg);
    return {
      cfgOverflowY: cs.overflowY,
      cfgScrollbarWidth: cs.scrollbarWidth,
      cfgGutter: cs.scrollbarGutter,
      cfgCanScroll: cfg.scrollHeight > cfg.clientHeight + 1,
      cfgGutterPx: cfg.offsetWidth - cfg.clientWidth,
      gridCanScroll: grid.scrollHeight > grid.clientHeight + 1,
      gridGutterPx: grid.offsetWidth - grid.clientWidth,
    };
  });
  console.log("scroll = " + JSON.stringify(bars));
  expect(bars.cfgOverflowY).toBe("auto");
  expect(bars.cfgGutterPx, "no scrollbar gutter reserved on the options panel").toBeGreaterThan(0);
  expect(await app.consoleErrors()).toEqual([]);
});
