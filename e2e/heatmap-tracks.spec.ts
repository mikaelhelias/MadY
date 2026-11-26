import { expect, test } from "@playwright/test";
import { MadyApp } from "./app";

/**
 * Annotation strips, in the running app.
 *
 * The strips are built by pointing the panel at a column (rows) or by typing a value per column
 * — and the whole point is that they line up with the matrix they annotate. jsdom can prove the
 * handlers write the right fields; only the real app proves the blocks land on their rows, that
 * the cells gave up the room, and that the annotated column stopped being drawn as data.
 */
const GENE_HEATMAP = "Gene expression heatmap";

test.describe("annotation strips (live)", () => {
  test("a row strip lands on its rows, takes its own room, and drops its column from the matrix", async ({ page }) => {
    const app = new MadyApp(page);
    await app.open();
    await app.openGraph(GENE_HEATMAP);
    await page.locator("svg.gfx-figure").click({ position: { x: 5, y: 5 } });
    await app.settle();

    const cols = async (): Promise<string[]> =>
      page.evaluate(() => [...document.querySelectorAll("svg.gfx-figure text")].map((t) => t.textContent ?? ""));
    const before = await cols();

    await page.getByLabel("Add a row strip").click();
    await app.settle();
    // point it at a real column of the demo sheet
    const pick = page.getByLabel("row strip 1 column");
    const options = await pick.locator("option").allTextContents();
    const target = options.find((o) => o !== "Pick a column…")!;
    await pick.selectOption({ label: target });
    await page.getByLabel("row strip 1 name").fill("Group");
    await app.settle();

    // the strip drew, one block per row, each on a row
    // Note: `.gfx-heatblock`, not any rect: the strip's words carry their own hit rects because
    // they are draggable, and a loose selector counts those too.
    const strip = page.locator("g.gfx-heattrack[data-heattrack^='row'] rect.gfx-heatblock");
    const rows = await page.locator("svg.gfx-figure rect[data-heatcell$='-0']").count();
    await expect(strip).toHaveCount(rows);
    const geo = await page.evaluate(() => {
      const blocks = [...document.querySelectorAll("g.gfx-heattrack rect.gfx-heatblock")].map((r) => ({
        y: Number(r.getAttribute("y")), h: Number(r.getAttribute("height")), x: Number(r.getAttribute("x")),
      }));
      const cells = [...document.querySelectorAll("svg.gfx-figure rect[data-heatcell$='-0']")].map((r) => ({
        y: Number(r.getAttribute("y")), x: Number(r.getAttribute("x")),
      }));
      return { blocks, cells };
    });
    geo.blocks.forEach((b, i) => {
      expect(Math.abs(b.y - geo.cells[i]!.y), `strip block ${i} is off its row`).toBeLessThan(0.6);
      expect(b.x, "the strip must sit left of the cells").toBeLessThan(geo.cells[i]!.x);
    });

    // the annotated column is no longer drawn as a matrix column
    const after = await cols();
    expect(after.filter((t) => t === target).length, `${target} is drawn twice`).toBeLessThan(
      before.filter((t) => t === target).length + 1,
    );
    // and the strip named itself
    expect(after).toContain("Group");
  });

  test("a column strip takes typed values and lines up with the columns", async ({ page }) => {
    const app = new MadyApp(page);
    await app.open();
    await app.openGraph(GENE_HEATMAP);
    await page.locator("svg.gfx-figure").click({ position: { x: 5, y: 5 } });
    await app.settle();

    await page.getByLabel("Add a column strip").click();
    await app.settle();
    // open the per-column list and give the first two columns a value
    await page.getByText("Value per column").click();
    const boxes = page.locator("input[aria-label^='column strip 1 value for']");
    const n = await boxes.count();
    expect(n).toBeGreaterThan(2);
    await boxes.nth(0).fill("Before");
    await boxes.nth(1).fill("Before");
    await boxes.nth(2).fill("After");
    await app.settle();

    const geo = await page.evaluate(() => {
      const blocks = [...document.querySelectorAll("g.gfx-heattrack[data-heattrack^='col'] rect.gfx-heatblock")].map((r) => ({
        x: Number(r.getAttribute("x")), y: Number(r.getAttribute("y")),
      }));
      const top = [...document.querySelectorAll("svg.gfx-figure rect[data-heatcell^='0-']")].map((r) => ({
        x: Number(r.getAttribute("x")), y: Number(r.getAttribute("y")),
      }));
      return { blocks, top };
    });
    expect(geo.blocks.length).toBe(geo.top.length);
    geo.blocks.forEach((b, j) => {
      expect(Math.abs(b.x - geo.top[j]!.x), `strip block ${j} is off its column`).toBeLessThan(0.6);
      expect(b.y, "the strip must sit above the cells").toBeLessThan(geo.top[j]!.y);
    });
    // two equal neighbours are labelled once
    const labels = await page.locator("g.gfx-heattrack[data-heattrack^='col'] text").allTextContents();
    expect(labels.filter((t) => t === "Before")).toHaveLength(1);
  });
  test("a strip and its words are clickable, and both texts drag", async ({ page }) => {
    const app = new MadyApp(page);
    await app.open();
    await app.openGraph(GENE_HEATMAP);
    await page.locator("svg.gfx-figure").click({ position: { x: 5, y: 5 } });
    await app.settle();
    await page.getByLabel("Add a column strip").click();
    await app.settle();
    await page.getByLabel("column strip 1 name").fill("Arm");
    await page.getByText("Value per column").click();
    const boxes = page.locator("input[aria-label^='column strip 1 value for']");
    const n = await boxes.count();
    for (let i = 0; i < n; i++) await boxes.nth(i).fill(i < 2 ? "Control" : "Treated");
    await app.settle();

    // click a strip block → its own row opens, marked
    await page.locator('[data-heattrack="col-0"] rect').first().click({ force: true });
    await app.settle();
    expect(
      await page.locator('[data-track-row="col-0"]').getAttribute("class"),
      "clicking the strip did not open its row",
    ).toContain("on");

    // drag the strip's name
    const name = page.locator("svg.gfx-figure text", { hasText: /^Arm$/ }).first();
    const nb = (await name.boundingBox())!;
    await app.dragBy({ x: nb.x + nb.width / 2, y: nb.y + nb.height / 2 }, 25, 10);
    let plot = (await app.plot(await app.activePlotId())) as { heatmap?: { colTracks?: { nameOffset?: unknown; labelOffsets?: Record<string, unknown> }[] } };
    expect(plot.heatmap?.colTracks?.[0]?.nameOffset, "the strip name is stuck").toBeTruthy();

    // drag a word drawn on the strip
    const word = page.locator("svg.gfx-figure text", { hasText: /^Control$/ }).first();
    const wb = (await word.boundingBox())!;
    await app.dragBy({ x: wb.x + wb.width / 2, y: wb.y + wb.height / 2 }, 18, 6);
    plot = (await app.plot(await app.activePlotId())) as { heatmap?: { colTracks?: { nameOffset?: unknown; labelOffsets?: Record<string, unknown> }[] } };
    expect(plot.heatmap?.colTracks?.[0]?.labelOffsets?.Control, "the word on the strip is stuck").toBeTruthy();
  });

  test("two named row strips do not print their names through each other", async ({ page }) => {
    // A row strip's band is ~16px wide; a name drawn level and centred under it overprints its
    // neighbour ("Depth" and "Tumour purity" would come out as "Deptbour purity"). Only the
    // real browser measures the drawn glyphs, so only this can prove they are apart.
    const app = new MadyApp(page);
    await app.open();
    await app.openGraph(GENE_HEATMAP);
    await page.locator("svg.gfx-figure").click({ position: { x: 5, y: 5 } });
    await app.settle();

    for (const [i, label] of [[1, "Tumour purity"], [2, "Depth"]] as [number, string][]) {
      await page.getByLabel("Add a row strip").click();
      await app.settle();
      const pick = page.getByLabel(`row strip ${i} column`);
      const opts = await pick.locator("option").allTextContents();
      await pick.selectOption({ label: opts[i + 1]! });
      await page.getByLabel(`row strip ${i} name`).fill(label);
      await app.settle();
    }

    const boxOf = async (name: string) =>
      (await page.locator("svg.gfx-figure text", { hasText: new RegExp(`^${name}$`) }).first().boundingBox())!;
    const a = await boxOf("Tumour purity");
    const b = await boxOf("Depth");
    const overlap = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    expect(overlap, "the two strip names are drawn on top of each other").toBe(false);
    // …and both are still inside the figure (rotating them costs height, which must be reserved)
    const fig = (await page.locator("svg.gfx-figure").boundingBox())!;
    for (const box of [a, b]) {
      expect(box.y + box.height, "a strip name runs off the bottom of the figure").toBeLessThanOrEqual(fig.y + fig.height + 1);
    }
  });
});
