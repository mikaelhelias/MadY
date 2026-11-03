import { expect, test } from "@playwright/test";
import { collectErrors, MadyApp } from "./app";

/**
 * The Assistant (toolbar chip + popover) talks about what the user is viewing.
 *
 * Guards against a fallback to tables[0] — the demo project's XY sheet — whenever the active
 * tab is not a graph or datasheet (Welcome, gallery, an analysis result), which would make the
 * popover push the same scatter/XY advice everywhere. Viewed graph → its suggestions; a tab with
 * no data → the calm empty state, never another sheet's advice.
 */

test("assistant suggestions follow the viewed graph and go quiet on no-data tabs", async ({ page }) => {
  await collectErrors(page);
  const app = new MadyApp(page);
  await app.open(); // lands on the demo's Dose-response XY graph

  const chip = page.locator("button.chip", { hasText: "Assistant" });
  const openAssistant = async (): Promise<string[]> => {
    await chip.click();
    await page.waitForSelector(".sugg-pop");
    const texts = await page.locator(".sugg-pop .an-rec-title").allTextContents();
    await page.keyboard.press("Escape");
    await page.waitForSelector(".sugg-pop", { state: "detached" });
    return texts;
  };

  // 1. Viewing the XY graph, the engine has plenty to say — the ruler works on a passing case.
  const onXY = await openAssistant();
  expect(onXY.length, "no suggestions while a graph with obvious next steps is open").toBeGreaterThan(0);

  // 2. A different graph → different suggestions (dynamic, not stuck on the XY sheet).
  await app.openGraph("Gene expression heatmap");
  const onHeatmap = await openAssistant();
  expect(onHeatmap.length, "no suggestions for the multivariable heatmap data").toBeGreaterThan(0);
  expect(onHeatmap.join(" | "), "the suggestions did not follow the viewed graph").not.toEqual(onXY.join(" | "));

  // 3. The gallery tab views no data → quiet, not the demo sheet's advice.
  //
  // Note: project-wide notices are not "advice about data": the demo project ships six analyses
  // that the real engine computes at boot, and this browser preview has no engine, so here they
  // stay stale and the assistant rightly says "6 results are out of date" on every tab. That
  // line is allowed; anything that names a sheet, a graph or a test is not. Counting every item
  // as unwanted advice would read the engine-less preview as a defect.
  await app.openGallery();
  await chip.click();
  await page.waitForSelector(".sugg-pop");
  const onGallery = await page.locator(".sugg-pop .sugg-item").allTextContents();
  const dataAdvice = onGallery.filter((t) => !/^\d+ results? (is|are) out of date\./.test(t.trim()));
  expect(dataAdvice, "suggestions offered for data the user is not viewing").toEqual([]);
  if (onGallery.length === 0) await expect(page.locator(".sugg-pop .sugg-empty")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.waitForSelector(".sugg-pop", { state: "detached" });

  // 4. An analysis result tab counts as viewing its source data.
  //
  // Run a real analysis through the app's own path: toolbar Analyze → the dialog's
  // onRun (driven off the fiber, like app.setPlotOptions). The browser preview has no
  // stats engine, so the analysis records "engine unavailable" — but the record exists,
  // its tab opens, and that is the context under test; suggestions read only `source`.
  await app.openGraph("Dose-response");
  const proj = (await app.project()) as unknown as {
    tables: { id: string; name: string; columns: { id: string }[] }[];
    plots: { name: string; source: string }[];
  };
  const src = proj.tables.find((t) => t.id === proj.plots.find((p) => p.name === "Dose-response")!.source)!;
  await page.locator('button[title^="Analyze"]').click(); // toolbar titles carry "· drag to rearrange"
  await page.waitForSelector("[role=dialog]");
  await app.analyzeRun({ method: "correlation", variant: "pearson", columns: [src.columns[0]!.id, src.columns[1]!.id] });
  // The dialog closes at once; the new analysis tab is now the active context.
  await page.waitForSelector("[role=dialog]", { state: "detached" });
  const onAnalysis = await openAssistant();
  expect(
    onAnalysis.some((t) => t.includes(src.name)),
    `no suggestion names the analysis's source data "${src.name}" — got: ${onAnalysis.join(" | ") || "(none)"}`,
  ).toBe(true);

  // 5. Analyze pressed on an analysis tab targets that analysis's source data.
  //
  // Note: the source must not be the first sheet: a fallback to tables[0] would give,
  // for a Dose-response analysis, the right answer for the wrong reason. Gene
  // expression is filed second, so only real source-following can name it.
  await app.openGraph("Gene expression heatmap");
  const gene = proj.tables.find((t) => t.id === proj.plots.find((p) => p.name === "Gene expression heatmap")!.source)!;
  expect(gene.id, "the premise broke: Gene expression became the first sheet").not.toBe(proj.tables[0]!.id);
  await page.locator('button[title^="Analyze"]').click();
  await page.waitForSelector("[role=dialog]");
  await app.analyzeRun({ method: "correlation", variant: "pearson", columns: [gene.columns[1]!.id, gene.columns[2]!.id] });
  await page.waitForSelector("[role=dialog]", { state: "detached" });
  await app.settle();
  // Now on the Gene-expression analysis tab: Analyze again and read the dialog's target.
  await page.locator('button[title^="Analyze"]').click();
  await page.waitForSelector("[role=dialog]");
  expect(
    await app.analyzeDialogTableName(),
    "Analyze opened from an analysis tab does not target the analysis's source data",
  ).toBe(gene.name);

  expect(await app.consoleErrors()).toEqual([]);
});
