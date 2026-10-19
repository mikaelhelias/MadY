import { expect, test } from "@playwright/test";
import { MadyApp, collectErrors } from "./app";

/**
 * The graph ruler — a page-layout measuring ruler framed outside the
 * figure, toggled from View ▸ Show graph ruler. The one thing that matters most: it
 * must stay aligned to the figure through **pane-narrowing** and **view zoom**. Both are things
 * jsdom cannot exercise (no layout, no ResizeObserver), so a misaligned ruler passes there —
 * the guard lives here, in a real browser.
 *
 * The band's width attribute is the ruler's own measurement of the figure; the figure's rendered
 * `getBoundingClientRect().width` is the truth. If they diverge, the ticks do not sit under the
 * picture. The case it guards against: narrowing the pane clamps the figure to the pane while the
 * band stays at the full scene width, so the ticks run far past the picture.
 */

/** Rendered figure box + the ruler band's self-reported size, read straight off the DOM. */
async function measure(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const fr = document.querySelector(".figruler");
    if (!fr) return null;
    const svg = fr.querySelector("svg.gfx-figure");
    const top = fr.querySelector(".figruler-top");
    const left = fr.querySelector(".figruler-left");
    if (!svg || !top || !left) return null;
    const r = svg.getBoundingClientRect();
    return {
      figW: Math.round(r.width),
      figH: Math.round(r.height),
      bandW: Math.round(parseFloat(top.getAttribute("width") ?? "0")),
      bandH: Math.round(parseFloat(left.getAttribute("height") ?? "0")),
    };
  });
}

test.describe("graph ruler", () => {
  test("frames the figure and tracks pane-narrowing + zoom", async ({ page }) => {
    await collectErrors(page);
    const app = new MadyApp(page);
    await app.open(); // lands on the Dose-response graph

    // Off by default — no ruler around the figure.
    expect(await page.locator(".figruler").count()).toBe(0);

    // Turn it on through the real View menu (also proves the menu wiring + enablement).
    await app.menu("View", "Show graph ruler");
    await page.waitForSelector(".figruler", { timeout: 10_000 });
    await app.settle();

    // Full width: the band measures the figure it frames.
    const full = await measure(page);
    expect(full, "ruler did not render").not.toBeNull();
    expect(Math.abs(full!.bandW - full!.figW), "top band width ≠ figure width").toBeLessThan(3);
    expect(Math.abs(full!.bandH - full!.figH), "left band height ≠ figure height").toBeLessThan(3);

    // Narrow the window so the figure clamps to the pane (maxWidth:100%). The ruler must follow.
    await page.setViewportSize({ width: 760, height: 900 });
    await app.settle();
    await app.settle();
    const narrow = await measure(page);
    expect(narrow!.figW, "figure did not shrink when the pane narrowed").toBeLessThan(full!.figW - 30);
    expect(Math.abs(narrow!.bandW - narrow!.figW), "band did not follow the figure on narrowing").toBeLessThan(3);
    expect(Math.abs(narrow!.bandH - narrow!.figH), "band height did not follow on narrowing").toBeLessThan(3);

    // Back to full, then zoom in: the figure grows past its scene size and the band tracks it.
    await page.setViewportSize({ width: 1440, height: 900 });
    await app.settle();
    await app.menu("View", "Zoom in");
    await app.menu("View", "Zoom in");
    await app.settle();
    const zoomed = await measure(page);
    expect(zoomed!.figW, "figure did not grow on zoom-in").toBeGreaterThan(full!.figW + 10);
    expect(Math.abs(zoomed!.bandW - zoomed!.figW), "band did not follow the figure on zoom").toBeLessThan(3);
    expect(Math.abs(zoomed!.bandH - zoomed!.figH), "band height did not follow on zoom").toBeLessThan(3);

    // Toggling it back off removes the ruler entirely.
    await app.menu("View", "Show graph ruler");
    await app.settle();
    expect(await page.locator(".figruler").count()).toBe(0);

    expect(await app.consoleErrors()).toEqual([]);
  });

  test("labels in px / inch / cm (a scene px is a 96-dpi pixel)", async ({ page }) => {
    await collectErrors(page);
    const app = new MadyApp(page);
    await app.open();
    await app.menu("View", "Show graph ruler");
    await page.waitForSelector(".figruler");
    await app.settle();

    // The largest top-band tick number, in whatever unit is active.
    const maxLabel = async () =>
      page.evaluate(() => {
        const ns = [...document.querySelectorAll(".figruler-top text")].map((t) => parseFloat(t.textContent ?? ""));
        return ns.length ? Math.max(...ns) : 0;
      });
    const corner = () => page.locator(".figruler-corner").textContent();

    const px = await maxLabel();
    expect(px, "px ruler had no ticks").toBeGreaterThan(50);
    expect((await corner())?.trim()).toBe("px");

    // Inches: same figure, numbers ~ px / 96. Allow slack for nice-step rounding.
    await page.getByLabel("Ruler unit").selectOption("in");
    await app.settle();
    const inch = await maxLabel();
    expect((await corner())?.trim()).toBe("in");
    expect(inch, "inch labels not ~ px/96").toBeGreaterThan(px / 96 * 0.6);
    expect(inch).toBeLessThan(px / 96 * 1.6);

    // Centimetres: numbers ~ px / (96/2.54) = px / 37.8, and > inches for the same figure.
    await page.getByLabel("Ruler unit").selectOption("cm");
    await app.settle();
    const cm = await maxLabel();
    expect((await corner())?.trim()).toBe("cm");
    expect(cm, "cm labels not ~ px/37.8").toBeGreaterThan(px / 37.8 * 0.6);
    expect(cm).toBeLessThan(px / 37.8 * 1.6);
    expect(cm, "cm should read larger than inches for the same length").toBeGreaterThan(inch);

    expect(await app.consoleErrors()).toEqual([]);
  });
});
