import { expect, test } from "@playwright/test";
import { collectErrors, MadyApp } from "./app";

/**
 * Scope — "Apply to whole graph" must apply to the whole graph.
 *
 * Guards against a box plot's width drag ignoring the toggle: tick it, drag a box edge, and
 * only the dragged box changes. A guard that checks only that the drag *fires* and *commits*
 * cannot see this — it must check which set of targets the drag hit.
 *
 * `Inspector.scope.test.tsx` covers the scope only through a colour swatch, and only through
 * `applyStyle`. The canvas drag never reaches `applyStyle`: the toggles are `useState` inside
 * `Inspector`, while the drag is owned by `AppShell.resizeWidth`, which cannot see them. So the
 * defect is structurally invisible to that suite, and to jsdom generally (no layout engine ⇒ no
 * real drag). It can only be caught here.
 *
 * The oracle is always the document: which series actually changed.
 *
 * "Which series have a width" is not that, and does not work as a proxy: the box house default
 * sets `boxWidth: 0.22` on every series, so all three boxes carry a width before anything is
 * dragged. Counting them cannot tell "the drag hit one box" from "the drag hit all three" — the
 * toggle-off case would fail with 3, and, worse, the toggle-on case could not fail at all: "every
 * series has a width" is satisfied by the default alone even if the drag did nothing.
 *
 * So both halves compare the width values either side of the drag. That is immune to whatever the
 * defaults happen to set.
 */

/** Each series' current boxWidth (undefined = none), from the live document. */
async function widthsOf(app: MadyApp, plotId: string): Promise<Record<string, number | undefined>> {
  const plot = (await app.plot(plotId)) as { seriesStyles?: Record<string, { boxWidth?: number }> } | undefined;
  return Object.fromEntries(Object.entries(plot?.seriesStyles ?? {}).map(([id, s]) => [id, s?.boxWidth]));
}

/** Ids whose width differs from `before` — the series the gesture actually moved. */
function widthsChanged(before: Record<string, number | undefined>, after: Record<string, number | undefined>): string[] {
  return Object.keys(after).filter((id) => before[id] !== after[id]).sort();
}

/**
 * What "the whole graph" means, taken from the app rather than re-derived here.
 *
 * Note: not "every non-x column": `tableDatasets` groups replicate columns, so the box gallery's 9
 * columns are 3 series. Counting columns would demand 9 and call a correct 3 a failure.
 * Instead, perform a whole-graph colour edit — the path that is already proven to fan out — and
 * read back which series it touched. The width drag must then match that exact set.
 */
async function allSeriesIds(app: MadyApp, plotId: string): Promise<string[]> {
  await app.clickFirstSwatch();
  const plot = (await app.plot(plotId)) as { seriesStyles?: Record<string, unknown> } | undefined;
  const ids = Object.keys(plot?.seriesStyles ?? {}).sort();
  if (ids.length < 2) throw new Error(`whole-graph colour edit touched ${ids.length} series — bad fixture`);
  return ids;
}

test.describe("apply-to-whole-graph scope — the toggle must change the whole graph", () => {
  test.beforeEach(async ({ page }) => {
    await collectErrors(page);
  });

  test("box width: dragging one box edge with the toggle on resizes every box", async ({ page }) => {
    const app = new MadyApp(page);
    await app.open();
    await app.openGallery();
    await app.openGalleryCard("Box & whisker");

    const plotId = await app.activePlotId();

    // Select a box so the Inspector shows the scope toggles, then turn "whole graph" on.
    await app.clickFirstSeriesMark();
    await app.setScope("Apply to whole graph", true);
    expect(await app.scopeState("Apply to whole graph"), "the toggle must actually be on").toBe(true);
    const all = await allSeriesIds(app, plotId);
    const before = await widthsOf(app, plotId);

    // Drag a box's width handle — the gesture under test.
    const handle = page.locator('svg.gfx-figure rect[style*="ew-resize"]').first();
    await handle.scrollIntoViewIfNeeded();
    const box = (await handle.boundingBox())!;
    await app.dragBy({ x: box.x + box.width / 2, y: box.y + box.height / 2 }, 26, 0);

    const changed = widthsChanged(before, await widthsOf(app, plotId));
    expect(changed.length, "the drag must commit a width change at all").toBeGreaterThan(0);
    expect(
      changed,
      `"Apply to whole graph" was ON, so every series must get the new width — got ${changed.length} of ${all.length}`,
    ).toEqual(all);
    expect(await app.consoleErrors()).toEqual([]);
  });

  test("box width: with the toggle off, the same drag resizes only the dragged box", async ({ page }) => {
    const app = new MadyApp(page);
    await app.open();
    await app.openGallery();
    await app.openGalleryCard("Box & whisker");

    const plotId = await app.activePlotId();
    await app.clickFirstSeriesMark();
    expect(await app.scopeState("Apply to whole graph"), "whole-graph defaults OFF").toBe(false);
    const before = await widthsOf(app, plotId);

    const handle = page.locator('svg.gfx-figure rect[style*="ew-resize"]').first();
    const box = (await handle.boundingBox())!;
    await app.dragBy({ x: box.x + box.width / 2, y: box.y + box.height / 2 }, 26, 0);

    const changed = widthsChanged(before, await widthsOf(app, plotId));
    expect(changed.length, `one box, not the whole graph — moved ${JSON.stringify(changed)}`).toBe(1);
    expect(await app.consoleErrors()).toEqual([]);
  });

  test("the whole-graph toggle survives changing selection within a graph", async ({ page }) => {
    const app = new MadyApp(page);
    await app.open();
    await app.openGallery();
    await app.openGalleryCard("Box & whisker");

    await app.clickFirstSeriesMark();
    await app.setScope("Apply to whole graph", true);
    expect(await app.scopeState("Apply to whole graph")).toBe(true);

    // Move the selection elsewhere and back — a normal thing to do mid-edit.
    await page.locator("svg.gfx-figure").click({ position: { x: 8, y: 8 } });
    await app.settle();
    const away = await app.selection();
    expect(away, "the selection must actually move, or this test proves nothing").not.toEqual(
      expect.objectContaining({ kind: "series" }),
    );
    await app.clickFirstSeriesMark();

    expect(
      await app.scopeState("Apply to whole graph"),
      "re-selecting a series must not silently turn the bulk-apply toggle back off",
    ).toBe(true);
    expect(await app.consoleErrors()).toEqual([]);
  });

  test("the whole-graph toggle resets when you switch to a different graph", async ({ page }) => {
    const app = new MadyApp(page);
    await app.open();
    await app.openGallery();
    await app.openGalleryCard("Box & whisker");
    await app.clickFirstSeriesMark();
    await app.setScope("Apply to whole graph", true);

    await app.openGallery();
    await app.openGalleryCard("Violin");
    await app.clickFirstSeriesMark();

    expect(
      await app.scopeState("Apply to whole graph"),
      "a bulk-apply scope must not follow you onto a different graph",
    ).toBe(false);
    expect(await app.consoleErrors()).toEqual([]);
  });
});
