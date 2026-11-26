import { expect, test } from "@playwright/test";
import { MadyApp } from "./app";

/**
 * Split heatmaps, in the running app.
 *
 * The control system is a list of breaks that each fall back to a shared setting, and the whole
 * value of it is that a user can build it up by clicking: add a break, move it, give one of them
 * its own look. jsdom can prove the handlers fire; only the real app proves the matrix actually
 * comes apart where the user said, and that the shared row moves every break that has not
 * departed from it.
 */
const GENE_HEATMAP = "Gene expression heatmap";

/** Top edge of each row, read off the drawn cells of column 0. */
async function rowTops(page: import("@playwright/test").Page): Promise<number[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll("svg.gfx-figure rect[data-heatcell]")]
      .filter((r) => (r.getAttribute("data-heatcell") ?? "").endsWith("-0"))
      .map((r) => Number(r.getAttribute("y"))),
  );
}
const gaps = (tops: number[]): number[] => tops.slice(1).map((t, i) => Math.round((t - tops[i]!) * 10) / 10);

test.describe("split heatmap (live)", () => {
  test("add breaks, place them, and the matrix comes apart exactly there", async ({ page }) => {
    const app = new MadyApp(page);
    await app.open();
    await app.openGraph(GENE_HEATMAP);
    await page.locator("svg.gfx-figure").click({ position: { x: 5, y: 5 } });
    await app.settle();

    const flat = gaps(await rowTops(page));
    expect(new Set(flat).size, "an unsplit heatmap must have one row pitch").toBe(1);

    // add two breaks and move the second one
    await page.getByLabel("Add a row split").click();
    await app.settle();
    await page.getByLabel("Add a row split").click();
    await app.settle();
    await page.getByLabel("row split 1 position").fill("2");
    await app.settle();
    await page.getByLabel("row split 2 position").fill("5");
    await app.settle();

    const split = gaps(await rowTops(page));
    const pitch = Math.min(...split);
    // exactly two of the gaps are bigger than the row pitch, and they are the two we placed
    const wide = split.map((g, i) => ({ g, i })).filter((x) => x.g > pitch + 1);
    expect(wide.map((x) => x.i), "the breaks are not between the rows the user named").toEqual([1, 4]);
  });

  test("the shared setting moves every break — until one of them departs from it", async ({ page }) => {
    const app = new MadyApp(page);
    await app.open();
    await app.openGraph(GENE_HEATMAP);
    await page.locator("svg.gfx-figure").click({ position: { x: 5, y: 5 } });
    await app.settle();
    await page.getByLabel("Add a row split").click();
    await app.settle();
    await page.getByLabel("Add a row split").click();
    await app.settle();
    await page.getByLabel("row split 1 position").fill("2");
    await page.getByLabel("row split 2 position").fill("4");
    await app.settle();

    const wideGaps = async (): Promise<number[]> => {
      const g = gaps(await rowTops(page));
      const pitch = Math.min(...g);
      return g.filter((x) => x > pitch + 1).map((x) => Math.round((x - pitch) * 10) / 10);
    };

    // one shared row moves both breaks
    await page.getByLabel("Space for all splits").fill("30");
    await app.settle();
    const both = await wideGaps();
    expect(both).toHaveLength(2);
    expect(Math.abs(both[0]! - both[1]!), "the two breaks should still be equal").toBeLessThan(1.5);
    expect(both[0]!).toBeGreaterThan(25);

    // now one break departs — and the other stays where the shared setting put it
    await page.getByLabel("row split 2 space").fill("6");
    await app.settle();
    const parted = await wideGaps();
    expect(parted[0]!, "the untouched break must keep the shared width").toBeGreaterThan(25);
    expect(parted[1]!, "the overridden break must take its own width").toBeLessThan(12);

    // …and putting it back under the shared setting restores it
    await page.getByLabel("Put row split 2 back under the shared setting").click();
    await app.settle();
    const back = await wideGaps();
    expect(Math.abs(back[0]! - back[1]!)).toBeLessThan(1.5);
  });

  test("a break drawn as a rule takes no space, and really draws a line", async ({ page }) => {
    const app = new MadyApp(page);
    await app.open();
    await app.openGraph(GENE_HEATMAP);
    await page.locator("svg.gfx-figure").click({ position: { x: 5, y: 5 } });
    await app.settle();
    const before = gaps(await rowTops(page));

    await page.getByLabel("Add a row split").click();
    await app.settle();
    await page.getByLabel("row split 1 position").fill("3");
    await page.getByLabel("Break style for all splits").selectOption("line");
    await app.settle();

    expect(gaps(await rowTops(page)), "a rule must not move the cells").toEqual(before);
    const rule = page.locator("line.gfx-heatsplit");
    await expect(rule).toHaveCount(1);
    await expect(rule).toHaveAttribute("data-heatsplit", "row-2");

    // its thickness follows the shared setting…
    await page.getByLabel("Rule thickness for all splits").fill("5");
    await app.settle();
    expect(Number(await rule.getAttribute("stroke-width"))).toBe(5);
    // …and this break can depart from that on its own
    await page.getByLabel("row split 1 rule thickness").fill("1");
    await app.settle();
    expect(Number(await page.locator("line.gfx-heatsplit").getAttribute("stroke-width"))).toBe(1);
  });
  test("blocks from the tree — offered only once there is a tree, and it cuts where the tree does", async ({ page }) => {
    const app = new MadyApp(page);
    await app.open();
    await app.openGraph(GENE_HEATMAP);
    await page.locator("svg.gfx-figure").click({ position: { x: 5, y: 5 } });
    await app.settle();

    // no clustering, no tree to cut — the control must not be there at all
    expect(await page.getByLabel("Row blocks from the tree").count()).toBe(0);
    await app.setControl("Cluster", "rows");
    await app.settle();
    await expect(page.getByLabel("Row blocks from the tree")).toBeVisible();

    const flat = gaps(await rowTops(page));
    expect(new Set(flat).size, "clustering alone must not split anything").toBe(1);

    await page.getByLabel("Row blocks from the tree").fill("3");
    await page.getByLabel("Space for all splits").fill("22");
    await app.settle();
    const cut = gaps(await rowTops(page));
    const pitch = Math.min(...cut);
    expect(cut.filter((g) => g > pitch + 1), "3 blocks means 2 breaks").toHaveLength(2);

    // the hand-placed list is withheld while the tree is in charge (it would not be drawn)
    expect(await page.getByLabel("Add a row split").count()).toBe(0);

    // …and clearing it hands the breaks straight back
    await page.getByLabel("Row blocks from the tree").fill("");
    await app.settle();
    expect(new Set(gaps(await rowTops(page))).size).toBe(1);
    await expect(page.getByLabel("Add a row split")).toBeVisible();
  });
  test("clicking a break opens its own row in the Inspector, and the block name drags", async ({ page }) => {
    const app = new MadyApp(page);
    await app.open();
    await app.openGraph(GENE_HEATMAP);
    await page.locator("svg.gfx-figure").click({ position: { x: 5, y: 5 } });
    await app.settle();
    await page.getByLabel("Add a row split").click();
    await app.settle();
    await page.getByLabel("row split 1 position").fill("3");
    await page.getByLabel("row split 1 block label").fill("Baseline");
    await page.getByLabel("Break style for all splits").selectOption("both");
    await app.settle();

    // click somewhere else first, so landing on the break's row is a real change
    await page.locator("svg.gfx-figure").click({ position: { x: 5, y: 5 } });
    await app.settle();
    expect(await page.locator(".splitrow.on").count()).toBe(0);

    // click the break itself
    await page.locator('[data-heatsplit-hit="row-2"]').click({ force: true });
    await app.settle();
    const row = page.locator('[data-split-row="row-2"]');
    // Note: read the attribute, not toHaveClass: it matches the whole class string, and this row is
    // "splitrow on".
    expect(await row.getAttribute("class"), "clicking the break did not open its own row").toContain("on");
    await expect(page.getByLabel("row split 1 rule dash"), "the row that opened cannot edit the break").toBeVisible();

    // and the block name drags
    const label = page.locator("svg.gfx-figure text", { hasText: /^Baseline$/ }).first();
    const box = (await label.boundingBox())!;
    // the repo's own drag gesture (app.dragBy) — a straight down/move/up misses the threshold
    await app.dragBy({ x: box.x + box.width / 2, y: box.y + box.height / 2 }, 30, 12);
    const plot = (await app.plot(await app.activePlotId())) as { heatmap?: { rowSplits?: { labelOffset?: { dx: number } }[] } };
    const off = plot.heatmap?.rowSplits?.[0]?.labelOffset;
    expect(off, "the block name did not move").toBeTruthy();
    expect(Math.abs(off!.dx)).toBeGreaterThan(10);
  });
});
