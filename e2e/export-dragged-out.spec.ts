import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { collectErrors, MadyApp } from "./app";

/**
 * Text dragged outside the graph must be in the exported file.
 *
 * The screen and the export are two different measurements of the same drawing; the drawing
 * grows to hold text moved away from the graph, and this checks that the export does too. A
 * figure that looks right on screen and exports with the legend sliced off, or missing, is the
 * same defect one step later, and it is the file that gets sent to a journal.
 *
 * Asserted on the actual exported bytes, through the real Export dialog (the browser download
 * fallback, same path as `export-raster.spec.ts`): SVG, because it is text and can be read back —
 * the item's own coordinates against the exported viewBox, and its ancestry checked for the plot's
 * clip. A PNG would only prove the canvas got bigger.
 */

/** A PNG's pixel size lives in the IHDR chunk: big-endian uint32 at byte 16 (width) / 20 (height). */
function pngSize(buf: Buffer): { w: number; h: number } {
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

/** Export the open graph in `format` through the real dialog, and return the file's bytes. */
async function exportGraph(page: import("@playwright/test").Page, format: "svg" | "png"): Promise<Buffer> {
  await page.locator('button[title*="Export this graph"]').click();
  const dialog = page.locator('.modal[role="dialog"][aria-label="Export"]');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Format").selectOption(format);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    dialog.getByRole("button", { name: new RegExp(`Export ${format}`, "i") }).click(),
  ]);
  return readFile((await download.path())!);
}

/** Drag the element the page put in `window.__t` to `(dx, dy)` from its own ink, and drop it. */
async function dragOut(page: import("@playwright/test").Page, dx: number, dy: number): Promise<void> {
  const from = await page.evaluate(() => {
    const el = (window as unknown as { __t: SVGGraphicsElement }).__t;
    const b = el.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 12 });
  await page.mouse.up();
}

/**
 * Measure a text in an exported SVG the way a reader's viewer will: render the file and ask where
 * the glyphs land, in the export's own coordinates.
 *
 * Not a regex over the markup. Reading `x` off the `<text>` element gives NaN for the legend,
 * whose position comes from a parent transform — so a correct export would be reported as a
 * failure. Rendering also settles the clip question by asking the DOM.
 */
async function measureExport(
  page: import("@playwright/test").Page,
  svg: string,
  needle: string,
): Promise<{ box: { x: number; w: number }; found: boolean; left: number; right: number; inside: boolean; clipped: boolean }> {
  return page.evaluate(
    ({ svg, needle }) => {
      const host = document.createElement("div");
      host.style.cssText = "position:fixed;left:-10000px;top:0";
      host.innerHTML = svg;
      document.body.append(host);
      try {
        const root = host.querySelector("svg")!;
        const vb = root.viewBox.baseVal;
        const el = [...root.querySelectorAll("text")].find((t) => (t.textContent ?? "").trim() === needle);
        if (!el) return { box: { x: vb.x, w: vb.width }, found: false, left: NaN, right: NaN, inside: false, clipped: false };
        // The text's own box, mapped into the root SVG's user units through every transform above it.
        const b = el.getBBox();
        const m = el.getCTM()!;
        const pt = (x: number): number => x * m.a + b.y * m.c + m.e;
        const left = Math.min(pt(b.x), pt(b.x + b.width));
        const right = Math.max(pt(b.x), pt(b.x + b.width));
        let clipped = false;
        for (let p: Element | null = el.parentElement; p && p !== root; p = p.parentElement) {
          if (p.getAttribute("clip-path")) clipped = true;
        }
        return {
          box: { x: vb.x, w: vb.width },
          found: true,
          left, right,
          inside: left >= vb.x && right <= vb.x + vb.width,
          clipped,
        };
      } finally {
        host.remove();
      }
    },
    { svg, needle },
  );
}

test("a legend dragged off the graph is in the exported SVG, inside its box", async ({ page }) => {
  await collectErrors(page);
  const app = new MadyApp(page);
  await app.open();
  await app.setPlotOptions({ legend: { show: true } });
  await app.settle();

  const beforePng = pngSize(await exportGraph(page, "png"));
  const beforeSvg = (await exportGraph(page, "svg")).toString("utf8");
  const before = await measureExport(page, beforeSvg, "Response (%)");
  expect(before.found, "the legend is not in the export to begin with").toBe(true);

  await page.evaluate(() => {
    const leg = document.querySelector("g.gfx-legend");
    if (!leg) throw new Error("no legend drawn");
    (window as unknown as { __t: Element }).__t = leg;
  });
  await dragOut(page, 260, 120);
  await app.settle();

  const after = await measureExport(page, (await exportGraph(page, "svg")).toString("utf8"), "Response (%)");
  expect(after.box.w, "the exported drawing did not widen for the legend outside it").toBeGreaterThan(before.box.w);
  expect(after.found, "the legend is missing from the exported file").toBe(true);
  // Present is not enough: a key whose glyphs end past the exported box is CUT — a perfectly
  // ordinary-looking file with the legend sliced off its edge.
  expect(after.inside, `the exported legend runs outside the exported box (${Math.round(after.left)}…${Math.round(after.right)} in ${Math.round(after.box.x)}…${Math.round(after.box.x + after.box.w)})`).toBe(true);

  // …and the raster path, which is what gets pasted into a manuscript. It rasterises the same
  // serialised SVG, so a canvas sized from the figure box alone would hand back a picture with the
  // legend missing — and nothing about the file would look wrong.
  const png = pngSize(await exportGraph(page, "png"));
  expect(png.w, "the exported PNG is no wider than it was before the legend was moved out").toBeGreaterThan(beforePng.w);
  expect(await app.consoleErrors()).toEqual([]);
});

test("a point's label dragged off the plot is in the exported SVG, and not clipped by the plot", async ({ page }) => {
  await collectErrors(page);
  const app = new MadyApp(page);
  await app.open();
  await app.openGallery();
  await app.openGalleryCard("Volcano");
  await app.settle();

  const found = await page.evaluate(() => {
    const el = [...document.querySelectorAll("text")].find((t) => (t.textContent ?? "").trim() === "IL6");
    if (!el) return false;
    (window as unknown as { __t: Element }).__t = el;
    return true;
  });
  expect(found, "the volcano card draws no IL6 label to drag").toBe(true);

  await dragOut(page, 300, 160);
  await app.settle();

  const out = await measureExport(page, (await exportGraph(page, "svg")).toString("utf8"), "IL6");
  expect(out.found, "the dragged gene label is missing from the exported file").toBe(true);
  // The plot's clip is in the exported markup too: a label still inside it would be cut in the
  // file exactly as it was on screen, which is what this whole file checks.
  expect(out.clipped, "the dragged gene label is still inside the plot's clip in the export").toBe(false);
  expect(out.inside, "the dragged gene label runs outside the exported box").toBe(true);
  expect(await app.consoleErrors()).toEqual([]);
});
