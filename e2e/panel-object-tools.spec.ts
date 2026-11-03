import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { collectErrors, MadyApp } from "./app";

/**
 * Panel object tools in a real browser: bring-to-front / send-to-back,
 * lock, centre-on-figure and duplicate.
 *
 * `LayoutPane.test.tsx` proves the handlers fire in jsdom; this layer proves the parts
 * jsdom cannot: that a drag on a locked panel commits nothing against real geometry,
 * that stacking really reorders the painted DOM (the exporter reads DOM order), and
 * that centre/duplicate write real coordinates through the document.
 */

/** Shift-click a panel's card corner (adds it to the Arrange selection without dragging). */
async function shiftSelect(page: Page, i: number): Promise<void> {
  const panel = page.locator(".laypanel").nth(i);
  await panel.scrollIntoViewIfNeeded();
  const box = (await panel.boundingBox())!;
  await page.mouse.move(box.x + 6, box.y + box.height - 6);
  await page.keyboard.down("Shift");
  await page.mouse.down();
  await page.mouse.up();
  await page.keyboard.up("Shift");
}

const pids = (page: Page): Promise<(string | null)[]> =>
  page.evaluate(() => [...document.querySelectorAll(".laypanel")].map((el) => el.getAttribute("data-pid")));

test.describe("panel object tools — front/back, lock, centre, duplicate commit to the document", () => {
  test.beforeEach(async ({ page }) => {
    await collectErrors(page);
  });

  test("bring-to-front commits panelZ and repaints the DOM order — panels (lettering) untouched", async ({ page }) => {
    const app = new MadyApp(page);
    await app.open();
    await app.newFigure(["Dose-response", "Treatment bar chart"]);
    const before = await pids(page);
    expect(before).toHaveLength(2);

    await shiftSelect(page, 0);
    await page.locator('button[title^="Bring the selected"]').click();
    await app.settle();

    const layout = await app.layout();
    const z = layout?.panelZ as Record<string, number> | undefined;
    expect(z, "Front must commit a panelZ entry").toBeTruthy();
    expect(z![before[0]!]).toBeGreaterThan(0);
    // panels order (= A/B/C lettering) must not change; only the painted order does
    expect(layout?.panels).toEqual(before);
    expect(await pids(page)).toEqual([before[1], before[0]]);
    expect(await app.consoleErrors()).toEqual([]);
  });

  test("a locked panel ignores a real drag (nothing commits) and its remove × is disabled", async ({ page }) => {
    const app = new MadyApp(page);
    await app.open();
    await app.newFigure(["Dose-response", "Treatment bar chart"]);
    const [pidA] = await pids(page);

    await shiftSelect(page, 0);
    await page.locator('button[title^="Lock the selected"]').click();
    await app.settle();
    expect(((await app.layout())?.panelLocked as Record<string, boolean>)[pidA!]).toBe(true);

    // a real drag on the locked panel must not move it — no panelPositions entry appears
    const panel = page.locator(".laypanel").first();
    const box = (await panel.boundingBox())!;
    await app.dragBy({ x: box.x + 6, y: box.y + box.height - 6 }, 70, 40);
    const pos = (await app.layout())?.panelPositions as Record<string, unknown> | undefined;
    expect(pos?.[pidA!], "a locked panel must not gain a position from a drag").toBeUndefined();

    // remove × disabled + padlock visible; clicking the padlock unlocks
    await expect(panel.locator(".laypanel-x")).toBeDisabled();
    await panel.locator(".laypanel-lock").click();
    await app.settle();
    expect((await app.layout())?.panelLocked).toBeUndefined();
    expect(await app.consoleErrors()).toEqual([]);
  });

  test("centre-on-figure pulls the selected panel toward the union centre (frozen commit)", async ({ page }) => {
    const app = new MadyApp(page);
    await app.open();
    await app.newFigure(["Dose-response", "Treatment bar chart"]);
    const [pidA, pidB] = await pids(page);
    const beforeBox = (await page.locator(".laypanel").first().boundingBox())!;

    await shiftSelect(page, 0);
    // The centring buttons are in the figure toolbar's Line up ▾ (open once a panel is picked).
    await page.locator("button.laymenu-btn", { hasText: /^Line up/ }).click();
    await page.locator('button[title^="Centre the selected panel(s) on the figure, left"]').click();
    await app.settle();

    const layout = await app.layout();
    const pos = layout?.panelPositions as Record<string, { x: number; y: number }>;
    expect(pos, "centre must commit frozen positions").toBeTruthy();
    expect(pos[pidA!]!.x, "the left panel moves right, toward the union centre").toBeGreaterThan(0);
    expect(pos[pidB!], "the unselected panel is frozen in place, not moved").toBeTruthy();
    // and the panel really moved on screen
    const afterBox = (await page.locator(`.laypanel[data-pid="${pidA}"]`).boundingBox())!;
    expect(afterBox.x).toBeGreaterThan(beforeBox.x + 10);
    expect(await app.consoleErrors()).toEqual([]);
  });

  test("two-level resize: the inner handle resizes the graph inside a pinned card; edges resize the card", async ({ page }) => {
    const app = new MadyApp(page);
    await app.open();
    await app.newFigure(["Dose-response", "Gene expression heatmap"]);
    await app.ribbonClick("Align all");
    await app.settle();
    // Canvas-relative rects: the arrange view scrolls between gestures, so viewport
    // coordinates would drift; canvas-local ones are stable.
    const cardRect = (i: number) =>
      page.evaluate((idx: number) => {
        const c = document.querySelector(".laycanvas, .laygrid")!.getBoundingClientRect();
        const r = document.querySelectorAll(".laypanel")[idx]!.getBoundingClientRect();
        return { x: r.x - c.x, y: r.y - c.y, w: r.width, h: r.height };
      }, i);
    const svgW = (i: number) =>
      page.evaluate((idx: number) => document.querySelectorAll(".laypanel")[idx]!.querySelector("svg.gfx-figure")!.getBoundingClientRect().width, i);
    const preA = await cardRect(0);
    const preB = await cardRect(1);
    const preSvg = await svgW(0);

    // Inner handle: shrink A's graph by 50×30 — the cards must not move or resize.
    // Note: scroll the handle to mid-view first: at the 1440×900 viewport it lands under the
    // app's fixed bottom status bar, and a mouse there presses the status bar instead.
    const gripEl = page.locator(".laypanel").first().locator(".laypanel-resize");
    await gripEl.scrollIntoViewIfNeeded();
    await page.mouse.wheel(0, 60); // nudge it clear of the status strip
    await app.settle();
    const grip = (await gripEl.boundingBox())!;
    await app.dragBy({ x: grip.x + 7, y: grip.y + 7 }, -50, -30);
    const layout = await app.layout();
    const pid = (layout!.panels as string[])[0]!;
    const pidB = (layout!.panels as string[])[1]!;
    expect((layout!.panelSizes as Record<string, { w: number }>)[pid]!.w).toBeLessThan(preSvg);
    // every card pinned at its aligned box, so a resize does not disturb the alignment
    const cards = layout!.cardSizes as Record<string, { w: number; h: number }>;
    expect(cards[pid], "the resized panel's card must be pinned").toBeTruthy();
    expect(cards[pidB], "the sibling's card must be pinned too").toBeTruthy();
    const postA = await cardRect(0);
    const postB = await cardRect(1);
    expect(Math.abs(postA.w - preA.w), "A's card width must not change").toBeLessThanOrEqual(2);
    expect(Math.abs(postA.h - preA.h), "A's card height must not change").toBeLessThanOrEqual(2);
    expect(Math.abs(postB.x - preB.x) + Math.abs(postB.y - preB.y), "B must not move").toBeLessThanOrEqual(2);
    expect(await svgW(0), "the graph itself must have shrunk").toBeLessThan(preSvg - 30);

    // Card edge: grow A's card by 60×40 — the graph keeps its size, the card grows.
    const svgBefore = await svgW(0);
    const cornerEl = page.locator(".laypanel").first().locator(".laypanel-cardedge-se");
    await cornerEl.scrollIntoViewIfNeeded();
    await app.settle();
    const corner = (await cornerEl.boundingBox())!;
    await app.dragBy({ x: corner.x + 8, y: corner.y + 8 }, 60, 40);
    const grown = await cardRect(0);
    expect(grown.w, "the card must grow").toBeGreaterThan(postA.w + 50);
    expect(Math.abs((await svgW(0)) - svgBefore), "the graph must keep its size").toBeLessThanOrEqual(2);
    expect(await app.consoleErrors()).toEqual([]);
  });

  test("Align all stays dense and aligned after a graph resize", async ({ page }) => {
    // Guards against inner resizes auto-pinning cardSizes that the aligner then honours:
    // re-aligning after any resize would produce a sparse, off-grid layout (panels re-flowed
    // with gaps, content off the shared line).
    // The contract under guard: Align re-derives the same dense figure, before or after resizes.
    const app = new MadyApp(page);
    await app.open();
    // Note: the paired dot plot is in this mix on purpose: its ~200px trait-label block sits
    // inside its plot.x, and letting footprint kinds define the alignment lines would let it
    // drag the whole column out (to ~991px wide).
    await app.newFigure(["Dose-response", "Gene expression heatmap", "GDP treemap", "Heritability dot plot"]);
    const rects = () =>
      page.evaluate(() =>
        [...document.querySelectorAll(".laypanel")].map((p) => {
          const c = document.querySelector(".laycanvas, .laygrid")!.getBoundingClientRect();
          const r = p.getBoundingClientRect();
          return { x: r.x - c.x, y: r.y - c.y, w: r.width, h: r.height };
        }),
      );
    await app.ribbonClick("Align all");
    await app.settle();
    const fresh = await rects();
    // Dense means dense: a 2-column figure of ~400px panels must stay under 900px wide.
    expect(Math.max(...fresh.map((r) => r.x + r.w)), "Align all must produce a dense figure").toBeLessThan(900);

    // resize one graph (freezes + pins), then re-align
    const gripEl = page.locator(".laypanel").first().locator(".laypanel-resize");
    await gripEl.scrollIntoViewIfNeeded();
    await page.mouse.wheel(0, 60);
    await app.settle();
    const grip = (await gripEl.boundingBox())!;
    await app.dragBy({ x: grip.x + 7, y: grip.y + 7 }, -40, -25);
    await app.ribbonClick("Align all");
    await app.settle();

    const again = await rects();
    expect(again).toHaveLength(fresh.length);
    for (let i = 0; i < fresh.length; i++) {
      const f = fresh[i]!, a = again[i]!;
      expect(Math.abs(a.x - f.x), `panel ${i} x drifted (${a.x} vs ${f.x})`).toBeLessThanOrEqual(2);
      expect(Math.abs(a.y - f.y), `panel ${i} y drifted`).toBeLessThanOrEqual(2);
      expect(Math.abs(a.w - f.w), `panel ${i} width drifted`).toBeLessThanOrEqual(2);
      expect(Math.abs(a.h - f.h), `panel ${i} height drifted`).toBeLessThanOrEqual(2);
    }
    expect(await app.consoleErrors()).toEqual([]);
  });

  test("duplicate adds a real, workspace-filed copy as a third panel", async ({ page }) => {
    const app = new MadyApp(page);
    await app.open();
    await app.newFigure(["Dose-response", "Treatment bar chart"]);
    const before = await pids(page);

    await shiftSelect(page, 0);
    await page.locator('button[title^="Duplicate the selected"]').click();
    await app.settle();

    const layout = await app.layout();
    expect(layout?.panels as string[]).toHaveLength(3);
    const newId = (layout?.panels as string[]).find((id) => !before.includes(id))!;
    const proj = (await app.project()) as { plots: { id: string; name: string }[]; workspace: { loose: { kind: string; id: string }[] } };
    const copy = proj.plots.find((p) => p.id === newId);
    expect(copy, "the duplicate is a real plot in the store").toBeTruthy();
    expect(copy!.name).toMatch(/copy/);
    // linked figure → the copy is a real graph, filed in the workspace
    expect(proj.workspace.loose.some((r) => r.kind === "plot" && r.id === newId)).toBe(true);
    // and it renders as its own panel card
    expect(await pids(page)).toHaveLength(3);
    expect(await app.consoleErrors()).toEqual([]);
  });
});
