import { expect, test } from "@playwright/test";
import { MadyApp } from "./app";

/**
 * An object dragged past the figure's edge must stay visible while it is dragged.
 *
 * The drawing grows to take in anything moved outside the figure. Measuring that only after the
 * drop is not enough: between pressing and letting go nothing re-renders the graph view, so the
 * viewBox would not grow and the `<svg>` would hide everything outside it — a legend dragged
 * beyond the graph would be cut off, its text invisible for the whole drag, reappearing (with the
 * drawing widened) only on release.
 *
 * Why it must be a browser test, and why it asks the page rather than the document. Nothing in
 * the document is wrong during the drag — the offset is live React state and the DOM node is there
 * at the right coordinates. The only thing that can be wrong is that it is not painted, which jsdom
 * (no layout, no clipping) cannot see. So the question put here is the one a user asks: press the
 * legend, hold it outside the figure, and ask the page what is drawn at that spot.
 */

/** What the page paints at (x, y): the top element, and whether it is inside the legend. */
async function paintedAt(page: import("@playwright/test").Page, x: number, y: number): Promise<{ tag: string | null; inLegend: boolean }> {
  return page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    return { tag: el?.tagName ?? null, inLegend: Boolean(el?.closest("g.gfx-legend")) };
  }, { x, y });
}

test("a legend dragged past the figure's right edge stays visible while you drag it", async ({ page }) => {
  const app = new MadyApp(page);
  await app.open();
  // Dose-response draws one series, so it has no legend to show; switching it on is what a user
  // does with the toolbar's Legend box. A fixture with no legend could not exhibit this at all.
  // …and a narrow figure, so the legend can be held entirely past the right edge with room to
  // spare inside the pane. At the default width the pane has ~110px to the right of the figure and
  // the legend is wider than that, so it could never be fully outside to be measured.
  await app.setPlotOptions({ legend: { show: true }, figureWidth: 520 });
  await app.settle();

  const start = await page.evaluate(() => {
    const leg = document.querySelector("g.gfx-legend");
    const svg = document.querySelector("svg.gfx-figure");
    if (!leg || !svg) return null;
    const b = leg.getBoundingClientRect();
    const s = svg.getBoundingClientRect();
    const pane = svg.closest(".graphzoom")!.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, figRight: s.right, paneRight: pane.right };
  });
  expect(start, "no legend on the graph to drag").not.toBeNull();

  // Past the figure's right edge — but still inside the pane, which scrolls and so clips too. Held
  // outside the pane the legend is legitimately out of view, and the test would be measuring the
  // scroll container instead of the figure's clip.
  // The cursor holds the legend's centre, so clearing the edge takes half a legend plus a margin.
  const target = { x: start!.figRight + start!.w / 2 + 20, y: start!.y + 40 };
  expect(target.x + start!.w / 2, "the pane is too narrow to hold the legend outside the figure").toBeLessThan(start!.paneRight);
  await page.mouse.move(start!.x, start!.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 12 });
  await app.settle();

  const held = await page.evaluate(() => {
    const leg = document.querySelector("g.gfx-legend");
    const svg = document.querySelector("svg.gfx-figure");
    const b = leg!.getBoundingClientRect();
    const s = svg!.getBoundingClientRect();
    const pane = svg!.closest(".graphzoom")!.getBoundingClientRect();
    return { legLeft: b.x, legMid: { x: b.x + b.width / 2, y: b.y + b.height / 2 }, figRight: s.right, paneRight: pane.right };
  });
  expect(held.legLeft, "the legend never left the figure, so this drag proves nothing").toBeGreaterThan(held.figRight);
  expect(held.legMid.x, "the legend was held outside the PANE, where the scroll container clips it").toBeLessThan(held.paneRight);

  const mid = await paintedAt(page, held.legMid.x, held.legMid.y);
  expect(mid.inLegend, `nothing of the legend is drawn at its own centre mid-drag (got <${mid.tag}>)`).toBe(true);

  // And it is still there after the drop, with the drawing grown to include it.
  await page.mouse.up();
  await app.settle();
  const after = await page.evaluate(() => {
    const svg = document.querySelector("svg.gfx-figure") as SVGSVGElement;
    const leg = document.querySelector("g.gfx-legend")!.getBoundingClientRect();
    return {
      grew: svg.viewBox.baseVal.width > Number(svg.getAttribute("data-figure-w")),
      legMid: { x: leg.x + leg.width / 2, y: leg.y + leg.height / 2 },
    };
  });
  expect(after.grew, "the drawing did not grow to include the dropped legend").toBe(true);
  const dropped = await paintedAt(page, after.legMid.x, after.legMid.y);
  expect(dropped.inLegend, `the dropped legend is not drawn (got <${dropped.tag}>)`).toBe(true);
});
