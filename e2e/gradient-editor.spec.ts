import { expect, test } from "@playwright/test";
import { MadyApp } from "./app";

/**
 * The gradient editor, in a real browser.
 *
 * jsdom cannot settle this feature. Its elements have a zero-size box, so
 * `getBoundingClientRect()` returns 0 and the editor's whole direct-manipulation half — click
 * the bar at a position, drag a stop along it — reads as "nothing happened" no matter whether
 * the code works. The unit test can only prove a stop was added, never that dragging moves one;
 * a jsdom proxy can pass while the interaction is completely dead.
 *
 * So this drives the shipping bundle: open a heatmap, build a gradient from its ramp picker,
 * drag a stop with real mouse events, press Done, and read the colours back off the drawn
 * cells. Plus the parts only the real app has: the document mutation, undo, and the fact that
 * a graph redraws when its gradient changes.
 */

const GENE_HEATMAP = "Gene expression heatmap";
const EDIT_RAMP = "__edit_gradient__";

/** The heatmap's drawn cell colours, straight off the SVG. */
async function cellFills(page: import("@playwright/test").Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll("svg.gfx-figure rect[data-heatcell]")].map((r) => r.getAttribute("fill") ?? ""),
  );
}

/** Every `<select>` in the Inspector that currently shows `value`. */
const picker = (page: import("@playwright/test").Page, value: string) =>
  page.locator(`select`).filter({ has: page.locator(`option[value="${value}"]`) }).first();

/**
 * Open the demo heatmap and select the plot — the Chart panel (with the ramp picker) only
 * exists once something is selected; a freshly opened graph shows "click an axis or a series".
 */
async function openHeatmap(app: MadyApp, page: import("@playwright/test").Page): Promise<void> {
  await app.open();
  await app.openGraph(GENE_HEATMAP);
  await page.locator("svg.gfx-figure").click({ position: { x: 5, y: 5 } });
  await app.settle();
}

test.describe("gradient editor (live)", () => {
  test("build a gradient from the heatmap's ramp picker, drag a stop, and see the cells change", async ({ page }) => {
    const app = new MadyApp(page);
    await openHeatmap(app, page);

    const before = await cellFills(page);
    expect(before.length, "the heatmap drew no cells").toBeGreaterThan(5);

    // --- open the editor from the ramp picker the user is already looking at -------------
    const ramp = page.locator("select").filter({ has: page.locator(`option[value="${EDIT_RAMP}"]`) }).first();
    await expect(ramp, "no ramp picker offers the gradient editor").toBeVisible();
    await ramp.selectOption(EDIT_RAMP);
    const dialog = page.getByLabel("Gradient editor");
    await expect(dialog).toBeVisible();

    // It opened on a copy of the built-in that was showing.
    await expect(page.getByLabel("Gradient name")).toHaveValue(/\(custom\)$/);

    // --- drag a stop — the thing jsdom cannot test at all ------------------------------
    const bar = page.getByLabel("Gradient bar");
    const box = (await bar.boundingBox())!;
    expect(box.width, "the gradient bar has no width in the real browser").toBeGreaterThan(200);

    const handle = page.locator('rect[aria-label="Stop 2"]');
    const hBefore = Number(await handle.getAttribute("x"));
    await handle.hover();
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.85, box.y + box.height, { steps: 8 });
    await page.mouse.up();
    // The handle really moved, and moved right — the position is derived from the pointer, so
    // a broken posFromEvent would leave it at 0 (which is what jsdom always reports).
    const hAfter = Number(await page.locator('rect[aria-label="Stop 2"]').getAttribute("x"));
    expect(hAfter, `the stop did not move (before ${hBefore}, after ${hAfter})`).toBeGreaterThan(hBefore + 40);

    // --- recolour the selected stop, then commit -----------------------------------------
    await page.getByLabel("Stop colour").evaluate((el) => {
      const input = el as HTMLInputElement;
      input.value = "#ff0000";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.getByRole("button", { name: "Done" }).click();
    await expect(dialog).toBeHidden();
    await app.settle();

    // --- the document holds the gradient, and the graph points at it ---------------------
    const proj = (await app.project()) as { gradients?: { id: string }[] };
    expect(proj.gradients?.length, "the gradient was not saved into the project").toBe(1);
    const plot = (await app.plot(await app.activePlotId())) as { heatmap?: { colormap?: string } };
    expect(plot.heatmap?.colormap).toBe(`custom:${proj.gradients![0]!.id}`);

    // --- and the drawing changed ---------------------------------------------------------
    const after = await cellFills(page);
    expect(after.length).toBe(before.length);
    expect(after, "the heatmap redrew identically — the gradient never reached the builder").not.toEqual(before);
  });

  test("the shaping knobs change the drawn cells, and a stepped map draws n colours", async ({ page }) => {
    const app = new MadyApp(page);
    await openHeatmap(app, page);
    const smooth = new Set(await cellFills(page));
    expect(smooth.size).toBeGreaterThan(5);

    // Type into the real control, not the document.
    const steps = page.getByLabel("Number of discrete colour steps");
    await expect(steps).toBeVisible();
    await steps.fill("4");
    await app.settle();
    const stepped = new Set(await cellFills(page));
    expect(stepped.size, "colour steps did not quantise the live heatmap").toBe(4);

    // The key must say what the marks say. An SVG linearGradient blends between its stops
    // whatever it is given, so a bar sampled at the class colours would still fade across every
    // class edge — banded but blurred, while the cells are hard classes. Read the real element: the
    // stops have to come in flat pairs at duplicated offsets (a staircase).
    const bar = await page.evaluate(() =>
      [...document.querySelectorAll("svg.gfx-figure linearGradient stop")].map((s) => ({
        offset: s.getAttribute("offset") ?? "",
        color: s.getAttribute("stop-color") ?? "",
      })),
    );
    expect(bar.length, "the heatmap drew no colour bar").toBe(8);
    expect(new Set(bar.map((s) => s.color)).size).toBe(4);
    for (let k = 0; k < 8; k += 2) {
      expect(bar[k]!.color, `class ${k / 2} is not flat`).toBe(bar[k + 1]!.color);
    }
    // duplicated offsets at the edges = a hard edge, not a fade
    expect(bar[1]!.offset).toBe(bar[2]!.offset);
  });

  test("undo takes the gradient back out", async ({ page }) => {
    const app = new MadyApp(page);
    await openHeatmap(app, page);
    const ramp = page.locator("select").filter({ has: page.locator(`option[value="${EDIT_RAMP}"]`) }).first();
    await ramp.selectOption(EDIT_RAMP);
    await page.getByRole("button", { name: "Done" }).click();
    await app.settle();
    expect(((await app.project()) as { gradients?: unknown[] }).gradients?.length).toBe(1);

    await page.keyboard.press("Control+z"); // undoes pointing the plot at it
    await page.keyboard.press("Control+z"); // undoes saving the gradient
    await app.settle();
    const proj = (await app.project()) as { gradients?: unknown[]; plots: { heatmap?: { colormap?: string } }[] };
    expect(proj.gradients ?? []).toHaveLength(0);
    expect(JSON.stringify(proj.plots)).not.toContain("custom:");
  });
});
