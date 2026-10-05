import { expect, test } from "@playwright/test";
import { collectErrors, MadyApp } from "./app";
import { clippedHints } from "./hintFits";

/**
 * Every hint, everywhere, fits its box — the sweep form of `placeholder-fits.spec.ts`.
 *
 * That test covers the Axis tab on one graph. A hint cut off by its box can sit on any tab of
 * any chart type, or in any dialog, and nothing else measures it. So:
 *
 *  1. every gallery card × every Inspector tab, all groups open — at graph level, and again
 *     with a series selected (the per-series tabs are different controls);
 *  2. every menu item that opens a dialog ("…"), with a graph open and with a datasheet open.
 *
 * Findings are de-duplicated by hint + label: one box shared by every chart type is one defect.
 */

/** Menu items that leave the page (file pickers, print) — nothing to measure, and print blocks. */
const SKIP_ITEMS = /^(Open|Save|Print|Import ggplot|Export analysis script|Export reproducibility|Save the manual)/;

async function openAllGroups(app: MadyApp): Promise<void> {
  await app.page.evaluate(() => {
    for (const d of document.querySelectorAll<HTMLDetailsElement>(".insp details")) d.open = true;
  });
  await app.settle();
}

async function sweepTabs(app: MadyApp, where: string, found: Map<string, string>): Promise<number> {
  let n = 0;
  // Only enabled tabs. A greyed tab (Axis on a pie) cannot be clicked, and Playwright would wait out
  // the whole test timeout on each one.
  const tabs = await app.page.locator(".inspcats button:not(.disabled):not([disabled])").allTextContents();
  for (const t of tabs) {
    if (!t.trim()) continue;
    await app.page.locator(".inspcats button:not(.disabled):not([disabled])", { hasText: new RegExp(`^${t.trim()}$`) }).first().click({ timeout: 5_000 });
    await app.settle();
    // Every axis the switcher offers (X / Y / Y2 / Y3 / Z …) is a different set of boxes.
    const axes = await app.page.locator(".insp .frow button.btn-mini").allTextContents();
    const axisButtons = t.trim() === "Axis" ? axes.filter((a) => /^(X|Y|Y2|Y3|X2|Z)$/.test(a.trim())) : [""];
    for (const a of axisButtons) {
      if (a) {
        await app.page.locator(".insp .frow button.btn-mini", { hasText: new RegExp(`^${a.trim()}$`) }).first().click();
        await app.settle();
      }
      await openAllGroups(app);
      const r = await clippedHints(app.page, ".insp");
      n += r.n;
      for (const b of r.bad) if (!found.has(b)) found.set(b, `${where} · ${t.trim()}${a ? ` ${a.trim()}` : ""}`);
    }
  }
  return n;
}

/**
 * Sharded. One test over every card would run past its timeout — which throws away every
 * finding, since they are only reported at the end. Eight shards, each taking every eighth card,
 * keep each run short and report per shard.
 */
const SHARDS = 8;
for (let shard = 0; shard < SHARDS; shard++) test(`every hint in every Inspector tab fits its box — cards ${shard + 1}/${SHARDS}`, async ({ page }) => {
  test.setTimeout(20 * 60_000);
  await collectErrors(page);
  const app = new MadyApp(page);
  await app.open();
  const all = await app.openGallery();
  expect(all.length, "no gallery cards").toBeGreaterThan(40);
  const titles = all.filter((_, i) => i % SHARDS === shard);

  const found = new Map<string, string>();
  let measured = 0;
  for (const title of titles) {
    await app.openGallery();
    await app.openGalleryCard(title);
    const fig = page.locator("svg.gfx-figure").first();
    await fig.click({ position: { x: 60, y: 20 } });
    await app.settle();
    if ((await page.locator(".inspcats button").count()) === 0) {
      const box = (await fig.boundingBox())!;
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await app.settle();
    }
    measured += await sweepTabs(app, title, found);
    if ((await page.locator('svg.gfx-figure .gfx-series [style*="cursor: pointer"]').count()) > 0) {
      await app.clickFirstSeriesMark();
      measured += await sweepTabs(app, `${title} (series)`, found);
    }
  }

  expect(measured, "measured no hints — the probe found no boxes").toBeGreaterThan(20);
  expect([...found].map(([b, w]) => `${w}: ${b}`), "hint text cut off by its box").toEqual([]);
});

test("every hint in every dialog fits its box", async ({ page }) => {
  test.setTimeout(30 * 60_000);
  await collectErrors(page);
  const app = new MadyApp(page);

  /**
   * A fresh app per dialog. A dialog that Escape does not close would sit over the menu bar, so every
   * later menu click would wait out its timeout. Reloading costs ~2 s a dialog and no dialog can block
   * another.
   */
  const toContext = async (context: "graph" | "datasheet"): Promise<void> => {
    await app.open();
    if (context === "graph") await app.openGraph("Dose-response");
    else {
      await app.expandTree();
      await page.locator(".dock-left").getByRole("button", { name: /^Sample — dose vs response$/ }).first().click({ timeout: 10_000 });
    }
    await app.settle();
  };

  const found = new Map<string, string>();
  let measured = 0;
  const opened: string[] = [];
  const failedToOpen: string[] = [];
  for (const context of ["graph", "datasheet"] as const) {
    await toContext(context);
    // List every "…" item once per context, sub-menus unfolded.
    const listing: { menu: string; item: string }[] = [];
    for (const menu of await page.locator(".menubar .menu").allTextContents()) {
      await page.locator(".menubar .menu", { hasText: new RegExp(`^${menu}$`) }).click({ timeout: 5_000 });
      const subs = page.locator(".dropdown .dropsub");
      for (let i = 0; i < (await subs.count()); i++) await subs.nth(i).hover({ timeout: 2_000 }).catch(() => {});
      const items = (await page.locator(".dropdown .dropitem:not([disabled]):not([aria-disabled='true'])").allTextContents())
        .map((s) => s.replace(/Ctrl\+.*$/, "").trim())
        .filter((s) => /(…|\.\.\.)$/.test(s) && !SKIP_ITEMS.test(s));
      for (const item of items) listing.push({ menu, item: item.replace(/(…|\.\.\.)$/, "") });
      await page.keyboard.press("Escape");
    }

    for (const { menu, item } of listing) {
      await toContext(context);
      try {
        await page.locator(".menubar .menu", { hasText: new RegExp(`^${menu}$`) }).click({ timeout: 5_000 });
        const target = page.locator(".dropdown .dropitem", { hasText: new RegExp(`^${item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) });
        if ((await target.count()) === 0) {
          const parents = page.locator(".dropdown .dropsub");
          for (let i = 0; i < (await parents.count()); i++) {
            await parents.nth(i).click({ timeout: 2_000 }).catch(() => {});
            if ((await target.count()) > 0) break;
          }
        }
        await target.first().click({ timeout: 5_000 });
        await app.settle();
      } catch {
        failedToOpen.push(`${context}: ${menu} ▸ ${item}`);
        continue;
      }
      opened.push(`${context}: ${menu} ▸ ${item}`);
      const r = await clippedHints(page, "body");
      measured += r.n;
      for (const b of r.bad) if (!found.has(b)) found.set(b, `${context} · ${menu} ▸ ${item}`);
    }
  }

  console.log(`dialogs opened: ${opened.length}; could not open: ${failedToOpen.join(" | ") || "none"}`);
  expect(opened.length, "opened no dialogs").toBeGreaterThan(10);
  expect(measured, "measured no hints — the probe found no boxes").toBeGreaterThan(20);
  expect([...found].map(([b, w]) => `${w}: ${b}`), "hint text cut off by its box").toEqual([]);
});
