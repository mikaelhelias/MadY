import { expect, test } from "@playwright/test";
import { MadyApp } from "./app";

/**
 * Renaming a label on the graph changes the item it names.
 *
 * The scene-level guard (`heatmap-label-identity.test.ts`) proves each label carries its source.
 * Only the real app proves the rename path uses it — five hops of wiring separate the two, and a
 * jsdom test passes the handler straight to the component, so it cannot see that gap. Guards
 * against renaming the second drawn row of a clustered heatmap changing a different gene.
 */
const GENE_HEATMAP = "Gene expression heatmap";

/** Rename the label showing `from` (double-click, type, Enter) and report the table after. */
async function rename(page: import("@playwright/test").Page, app: MadyApp, from: string, to: string) {
  const el = page.locator("svg.gfx-figure text").filter({ hasText: new RegExp(`^${from}$`) }).first();
  await el.dblclick({ force: true });
  const box = page.locator(".gfx-textedit");
  await expect(box, `no inline editor opened on "${from}"`).toBeVisible();
  await box.fill(to);
  // these labels open a multiline editor, so Enter inserts a newline — blur is what commits
  await box.blur();
  await app.settle();
}

test.describe("renaming a heatmap label (live)", () => {
  test("clustered: the rename lands on the row that was clicked, not the row at that index", async ({ page }) => {
    const app = new MadyApp(page);
    await app.open();
    await app.openGraph(GENE_HEATMAP);
    await page.locator("svg.gfx-figure").click({ position: { x: 5, y: 5 } });
    await app.settle();
    await app.setControl("Cluster", "rows");
    await app.settle();

    // the drawn order after clustering, and the table order before the edit
    const drawn = await page.evaluate(() => {
      const svg = document.querySelector("svg.gfx-figure")!;
      const cell = svg.querySelector("rect[data-heatcell]")!;
      const cx = Number(cell.getAttribute("x"));
      return [...svg.querySelectorAll("text")]
        .filter((t) => Number(t.getAttribute("x") ?? 0) < cx && /^Gene/.test(t.textContent ?? ""))
        .map((t) => t.textContent ?? "");
    });
    expect(drawn.length).toBeGreaterThan(3);

    const second = drawn[1]!;
    await rename(page, app, second, "ZZRENAMED");

    const names = await page.evaluate(() => {
      const svg = document.querySelector("svg.gfx-figure")!;
      const cell = svg.querySelector("rect[data-heatcell]")!;
      const cx = Number(cell.getAttribute("x"));
      return [...svg.querySelectorAll("text")]
        .filter((t) => Number(t.getAttribute("x") ?? 0) < cx)
        .map((t) => t.textContent ?? "");
    });
    // exactly the label we renamed is gone, and every other one survives
    expect(names, "the renamed label did not take").toContain("ZZRENAMED");
    for (const other of drawn.filter((d) => d !== second)) {
      expect(names, `${other} was renamed instead of ${second}`).toContain(other);
    }
  });

  test("with a row strip on, renaming a column renames that column", async ({ page }) => {
    const app = new MadyApp(page);
    await app.open();
    await app.openGraph(GENE_HEATMAP);
    await page.locator("svg.gfx-figure").click({ position: { x: 5, y: 5 } });
    await app.settle();
    await page.getByLabel("Add a row strip").click();
    await app.settle();
    const pick = page.getByLabel("row strip 1 column");
    const opts = await pick.locator("option").allTextContents();
    // opts[1] is the lead column (the row labels) — never a matrix column, so taking it out
    // shifts nothing and this case would prove nothing. opts[2] is the first real one.
    await pick.selectOption({ label: opts[2]! });
    await app.settle();

    const before = await page.evaluate(() => {
      const svg = document.querySelector("svg.gfx-figure")!;
      const cell = svg.querySelector("rect[data-heatcell]")!;
      const cy = Number(cell.getAttribute("y"));
      return [...svg.querySelectorAll("text")]
        .filter((t) => Number(t.getAttribute("y") ?? 0) < cy && Number(t.getAttribute("y") ?? 0) > cy - 40)
        .map((t) => t.textContent ?? "");
    });
    expect(before.length).toBeGreaterThan(2);
    const target = before[1]!;
    await rename(page, app, target, "ZZCOLUMN");

    const cols = ((await app.project()) as { tables: { columns: { name: string }[] }[] }).tables
      .flatMap((t) => t.columns.map((c) => c.name));
    expect(cols, "the rename did not take").toContain("ZZCOLUMN");
    for (const other of before.filter((b) => b !== target)) {
      expect(cols, `${other} was renamed instead of ${target}`).toContain(other);
    }
  });

  test("collapsed: renaming the group renames the group, and the suffix is never typed back", async ({ page }) => {
    const app = new MadyApp(page);
    await app.open();
    await app.openGraph(GENE_HEATMAP);
    await page.locator("svg.gfx-figure").click({ position: { x: 5, y: 5 } });
    await app.settle();
    await page.getByLabel("Add a column strip").click();
    await app.settle();
    await page.getByText("Value per column").click();
    const boxes = page.locator("input[aria-label^='column strip 1 value for']");
    const n = await boxes.count();
    for (let i = 0; i < n; i++) await boxes.nth(i).fill(i < 2 ? "Ctrl" : "Drug");
    await app.settle();
    await page.getByLabel("Collapse replicate columns").selectOption("mean");
    await app.settle();

    // the editor must open with the value, not "Ctrl (mean of 2)"
    const label = page.locator("svg.gfx-figure text").filter({ hasText: /^Ctrl \(mean of 2\)$/ }).first();
    await label.dblclick({ force: true });
    const box = page.locator(".gfx-textedit");
    expect(await box.inputValue(), "the editor opened with the decorated label").toBe("Ctrl");
    await box.fill("Control");
    await box.blur();
    await app.settle();

    // the group is renamed — the strip and the label both say so, and the count survives
    const texts = await page.evaluate(() =>
      [...document.querySelectorAll("svg.gfx-figure text")].map((t) => t.textContent ?? ""),
    );
    expect(texts).toContain("Control (mean of 2)");
    expect(texts, "the old value is still on the strip").not.toContain("Ctrl");
  });
});
