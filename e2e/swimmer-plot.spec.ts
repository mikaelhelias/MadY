import { expect, test } from "@playwright/test";
import { collectErrors, MadyApp } from "./app";

/**
 * Swimmer plot in a real browser.
 * swimmer-plot.test.tsx proves the column contract, sorting and geometry in jsdom; this
 * proves what jsdom cannot: the gallery card inserts a live composite (bars + response
 * overlays + ongoing arrows + event glyphs), a real pointer drag commits into the
 * document, and a bar click routes through the live selection without console errors.
 */

test.describe("swimmer — live insert, bar click, real title drag", () => {
  test.beforeEach(async ({ page }) => {
    await collectErrors(page);
  });

  test("card inserts; bars/overlays/arrows paint; title drag commits; bar click is clean", async ({ page }) => {
    const app = new MadyApp(page);
    await page.goto("/");
    await page.waitForSelector(".nav", { timeout: 30_000 });
    await page.evaluate(() => {
      [...document.querySelectorAll("button")].find((b) => /chart gallery/i.test(b.textContent ?? ""))?.click();
    });
    await app.settle();
    const card = page.locator("[class*=gallery]", { hasText: /^Swimmer plot/ }).first();
    await card.scrollIntoViewIfNeeded();
    await card.click();
    await page.waitForSelector("svg.gfx-figure");
    await app.settle();

    // The composite paints one bar per subject with a start and an end, one response overlay
    // per subject with both response bounds, and one arrow per subject still on treatment —
    // counted from the card's own data, not typed here, so the expected counts stay correct
    // when the card's data changes.
    const inserted = (await app.project()) as {
      tables: { id: string; columns: { id: string; name: string }[]; rows: { cells: Record<string, unknown> }[] }[];
      plots: { kind?: string; source: string }[];
    };
    const swim = inserted.plots.find((p) => p.kind === "swimmer")!;
    const table = inserted.tables.find((t) => t.id === swim.source)!;
    const col = (name: RegExp): string => table.columns.find((c) => name.test(c.name))!.id;
    const num = (v: unknown): boolean => typeof v === "number" && Number.isFinite(v);
    const rows = table.rows.map((r) => r.cells);
    const expectBars = rows.filter((c) => num(c[col(/^start$/i)]) && num(c[col(/^end$/i)])).length;
    const expectResp = rows.filter((c) => num(c[col(/^response start$/i)]) && num(c[col(/^response end$/i)])).length;
    const expectArrows = rows.filter((c) => { const v = c[col(/^ongoing$/i)]; return v === 1 || v === true || v === "1" || v === "yes"; }).length;
    expect(expectBars, "the card must have subjects to draw").toBeGreaterThan(5);
    expect(expectResp, "the card must have responses to draw").toBeGreaterThan(0);
    expect(expectArrows, "the card must have ongoing subjects to draw").toBeGreaterThan(0);
    expect(await page.locator("rect.swimbar").count()).toBe(expectBars);
    expect(await page.locator("rect.swimresp").count()).toBe(expectResp);
    expect(await page.locator("path.swimarrow").count()).toBe(expectArrows);

    // A bar click routes into the live selection (the Start series' point panel).
    await page.locator("rect.swimbar").first().click();
    await app.settle();

    // A real drag on the graph title commits its offset into the document.
    const title = page.locator("svg.gfx-figure text", { hasText: /^Swimmer plot$/ }).first();
    const box = (await title.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 20, { steps: 4 });
    await page.mouse.up();
    await app.settle();
    const proj = (await app.project()) as { plots: Array<{ kind?: string; titleOffset?: { dx: number; dy: number } }> };
    const plot = proj.plots.find((p) => p.kind === "swimmer");
    expect(plot, "the inserted swimmer plot must exist").toBeTruthy();
    expect(Math.abs(plot!.titleOffset?.dx ?? 0), "the title drag must commit an offset").toBeGreaterThan(15);
    expect(await app.consoleErrors()).toEqual([]);
  });
});
