import { expect, test } from "@playwright/test";
import { MadyApp } from "./app";

/**
 * Box selection in the real app (the gesture is Shift-drag). jsdom has no screen geometry, so
 * the gesture's own test gives it a fake one; here the real bundle does the whole thing: Shift-drag a box over the
 * Dose-response graph's points, pick Exclude from the menu, and the picked cells are excluded in the document (the
 * same cells Data ▸ Exclude selected values would mark). And the other direction: the drag did not pan the chart.
 */
test("Shift-drag a box over points, Exclude: those cells are excluded and the chart did not pan", async ({ page }) => {
  const app = new MadyApp(page);
  await app.open();
  await app.settle();

  // The drawn markers of the first series, in page pixels.
  const pts = await page.evaluate(() =>
    [...document.querySelectorAll("svg.gfx-figure circle")]
      .filter((c) => (c.getAttribute("fill") ?? "transparent") !== "transparent" && !c.closest("[data-mady-legend-row]"))
      .map((c) => { const b = c.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }),
  );
  expect(pts.length, "the graph draws no markers to select").toBeGreaterThan(4);
  // A box around the first three markers (left to right).
  const three = [...pts].sort((a, b) => a.x - b.x).slice(0, 3);
  const box = {
    x0: Math.min(...three.map((p) => p.x)) - 6, y0: Math.min(...three.map((p) => p.y)) - 6,
    x1: Math.max(...three.map((p) => p.x)) + 6, y1: Math.max(...three.map((p) => p.y)) + 6,
  };
  const before = await app.project();
  const plotBefore = JSON.stringify((before as { plots: { xAxis?: unknown; yAxis?: unknown }[] }).plots.map((p) => [p.xAxis, p.yAxis]));

  await page.mouse.move(box.x0, box.y0);
  await page.keyboard.down("Shift");
  await page.mouse.down();
  await page.mouse.move(box.x1, box.y1, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.up("Shift");

  const menu = page.getByRole("menu", { name: "Selected points" });
  await expect(menu).toBeVisible();
  const picked = await page.locator("svg.gfx-figure .gfx-boxpick").count();
  expect(picked, "the box picked nothing").toBeGreaterThan(0);
  await expect(menu).toContainText(`${picked} point`);
  await menu.getByRole("button", { name: "Exclude from analyses" }).click();
  await app.settle();

  type Doc = { tables: { excluded?: Record<string, string[]> }[]; plots: { xAxis?: unknown; yAxis?: unknown }[] };
  const rowsExcluded = (d: Doc) => d.tables.map((t) => Object.keys(t.excluded ?? {}).length).reduce((a, b) => a + b, 0);
  const after = (await app.project()) as Doc;
  expect(rowsExcluded(after) - rowsExcluded(before as Doc), "the picked points' rows were not excluded").toBe(picked);
  expect(JSON.stringify(after.plots.map((p) => [p.xAxis, p.yAxis])), "the Shift-drag panned the chart").toBe(plotBefore);
});
