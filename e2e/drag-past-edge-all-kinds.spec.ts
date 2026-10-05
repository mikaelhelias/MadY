import { expect, test } from "@playwright/test";
import { MadyApp } from "./app";

/**
 * Every gallery kind: is what you are dragging still painted once it is past the figure's edge?
 *
 * The clip is lifted in one place (the graph view, `unclipWhileDragging`) and the on-data labels are
 * drawn beside the plot's clip in another (`gfx-textlayer`), so both should reach every chart
 * kind — but each kind renders its own `<svg>`. This checks every graph type by dragging on
 * each card and asking the page what it paints.
 *
 * Two measurement faults to avoid, both of which look exactly like app defects:
 *  1. Pressing (and sampling) the centre of the box. The heatmap's colour-bar scale labels are a
 *     tall, thin group holding one number at the top and one at the bottom; its centre is empty space, so
 *     a press there hits the background and a working control reads as "did not move". Everything
 *     here aims at the item's own ink.
 *  2. Holding the item outside the pane, which scrolls and clips in its own right. The item is held
 *     just past the figure, inside the pane.
 * A kind that still cannot be measured says so and is not counted as a pass.
 */
type Row = { title: string; verdict: string; detail: string };

/** Runs in the page: pick the item to drag, remember it, and report where to press. */
const probe = () => {
  const svg = document.querySelector("svg.gfx-figure");
  if (!svg) return null;
  const s = svg.getBoundingClientRect();
  const pane = svg.closest(".graphzoom")!.getBoundingClientRect();
  // Not just the two known classes. Some kinds (for example chord, dendrogram and forest) carry
  // neither, and calling them "not measured" would leave those kinds unanswered. What every
  // draggable shares is the move cursor its handler sets, so ask the page for that.
  const cands = [
    ...svg.querySelectorAll<SVGGElement>("g.gfx-legend, g.gfx-dragtext"),
    ...[...svg.querySelectorAll<SVGGElement>("g, text")].filter((el) => getComputedStyle(el).cursor === "move"),
  ];
  let best: { el: SVGGElement; b: DOMRect } | null = null;
  // Prefer the legend — the item most often dragged past the edge — but only if it fits in the room
  // beside the figure. ROC's legend reads "Biomarker (AUC 0.86…)" and can be wider than that room, and
  // insisting on it would leave that kind unmeasured; its axis title answers the same question and fits.
  const room = pane.right - s.right;
  const rank = (el: Element, b: DOMRect): number => (el.classList.contains("gfx-legend") && b.width + 40 <= room ? 2 : 1);
  for (const el of cands) {
    const b = el.getBoundingClientRect();
    if (b.width < 8 || b.height < 6) continue;
    if (!best || rank(el, b) > rank(best.el, best.b) || (rank(el, b) === rank(best.el, best.b) && b.width < best.b.width)) best = { el, b };
  }
  if (!best) return { found: false, figRight: s.right, paneRight: pane.right, w: 0, left: 0, x: 0, y: 0, what: "", label: "" };
  const ink: Element = best.el.tagName === "text" ? best.el : best.el.querySelector("text") ?? best.el;
  const w = window as unknown as { __t: SVGGElement; __ink: Element };
  w.__t = best.el;
  w.__ink = ink;
  const ib = ink.getBoundingClientRect();
  return {
    found: true,
    x: ib.x + ib.width / 2, y: ib.y + ib.height / 2,
    w: best.b.width, left: best.b.x,
    what: best.el.classList.contains("gfx-legend") ? "legend" : "text",
    label: (best.el.textContent ?? "").slice(0, 20),
    figRight: s.right, paneRight: pane.right,
  };
};

test("a dragged item stays visible past the figure's edge on every gallery kind", async ({ page }) => {
  test.setTimeout(900_000);
  const app = new MadyApp(page);
  await app.open();
  const titles = await app.openGallery();
  expect(titles.length).toBeGreaterThan(30);

  const rows: Row[] = [];
  for (const title of titles) {
    await app.openGallery();
    await app.openGalleryCard(title);
    // A narrow figure, so the pane has room to the right for the item to be held fully outside.
    await app.setPlotOptions({ legend: { show: true }, figureWidth: 420 });
    await app.settle();

    let info = await page.evaluate(probe);
    if (!info) { rows.push({ title, verdict: "NO FIGURE", detail: "" }); continue; }
    if (!info.found) { rows.push({ title, verdict: "NOT MEASURED", detail: "no legend and no draggable text" }); continue; }
    // A wide legend (ROC's "Biomarker (AUC 0.86…)") can be wider than the room beside a 420px
    // figure. Shrink the figure and ask again rather than leaving that kind unmeasured.
    if (info.paneRight - info.figRight < info.w + 40) {
      await app.setPlotOptions({ figureWidth: 300 });
      await app.settle();
      const retry = await page.evaluate(probe);
      if (retry?.found) info = retry;
    }
    const room = info.paneRight - info.figRight;
    if (room < info.w + 40) { rows.push({ title, verdict: "NOT MEASURED", detail: `pane room ${Math.round(room)}px < item ${Math.round(info.w)}px` }); continue; }

    await page.mouse.move(info.x, info.y);
    await page.mouse.down();
    // Move by what it takes to put the item's left edge just past the figure — the press landed on
    // the item's ink, which is not the centre of its box.
    await page.mouse.move(info.x + (info.figRight + 20 - info.left), info.y + 30, { steps: 10 });
    await app.settle();
    const mid = await page.evaluate((startLeft: number) => {
      const w = window as unknown as { __t: SVGGElement; __ink: Element };
      const svg = document.querySelector("svg.gfx-figure")!;
      const b = w.__t.getBoundingClientRect();
      const s = svg.getBoundingClientRect();
      const ib = w.__ink.getBoundingClientRect();
      // Ask at the item's ink, for the same reason the press was aimed there: the centre of a tall
      // thin group is empty space, and "nothing is painted in the gap" is not "the item is cut".
      const hit = document.elementFromPoint(ib.x + ib.width / 2, ib.y + ib.height / 2);
      return {
        outside: b.x > s.right,
        moved: Math.abs(b.x - startLeft) > 4,
        painted: Boolean(hit && w.__t.contains(hit)),
        tag: hit?.tagName ?? null,
      };
    }, info.left);
    await page.mouse.up();
    await app.settle();
    const grew = await page.evaluate(() => {
      const svg = document.querySelector("svg.gfx-figure") as SVGSVGElement;
      return svg.viewBox.baseVal.width > Number(svg.getAttribute("data-figure-w") ?? svg.viewBox.baseVal.width);
    });
    // An item that did not move cannot answer the clipping question, so it gets its own status
    // instead of being counted either way. A clipped item still moves: it follows the pointer but
    // paints nothing past the edge, which is the failure this test exists to catch.
    const ok = mid.outside && mid.painted;
    rows.push({
      title,
      verdict: !mid.outside && !mid.moved ? "DID NOT MOVE" : ok ? "OK" : "FAIL",
      detail: `${info.what} "${info.label}" moved=${mid.moved} outside=${mid.outside} painted=${mid.painted} hit=<${mid.tag}> grewOnDrop=${grew}`,
    });
  }

  console.log("DRAG-PAST-EDGE\n" + rows.map((r) => `${r.title} | ${r.verdict} | ${r.detail}`).join("\n"));
  const failed = rows.filter((r) => r.verdict === "FAIL" || r.verdict === "NO FIGURE");
  expect(failed.map((r) => `${r.title}: ${r.detail}`), "kinds where a dragged item is still clipped mid-drag").toEqual([]);
  // The test must actually measure most kinds — if a change makes every card unmeasurable, this
  // would otherwise pass green with nothing behind it.
  expect(rows.filter((r) => r.verdict === "OK").length, "too few kinds actually measured").toBeGreaterThan(rows.length / 2);
});
