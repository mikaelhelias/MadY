import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { MadyApp, collectErrors } from "./app";

/**
 * Export rasterizer coverage — the byte-production pipeline jsdom cannot reach.
 * jsdom has no canvas, so svgToPngBase64 / svgToJpegBase64 /
 * svgToTiffBase64 (SVG → <canvas> → real pixel bytes) cannot be tested in the unit suite —
 * a change that produced a corrupt or wrong-sized image would go unnoticed there.
 *
 * This drives the Export dialog in a real browser. Without the Electron file writer
 * the app falls back to `browserDownload` (an <a download> click), which Playwright
 * intercepts — so the assertions read the exported bytes themselves, no test hook required.
 */

/** A PNG's pixel dimensions live in the IHDR chunk: big-endian uint32 at byte 16 (width) / 20 (height). */
function pngSize(buf: Buffer): { w: number; h: number } {
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

async function openExportDialog(app: MadyApp, page: import("@playwright/test").Page) {
  await page.locator('button[title*="Export this graph"]').click();
  const dialog = page.locator('.modal[role="dialog"][aria-label="Export"]');
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe("export rasterizers produce valid image bytes", () => {
  test("PNG: real signature, dimensions match the dialog, and actual drawn content", async ({ page }) => {
    await collectErrors(page);
    const app = new MadyApp(page);
    await app.open();

    const dialog = await openExportDialog(app, page);
    // The dialog's computed pixel size is the oracle: the rasterizer must honour it exactly.
    const nums = dialog.locator('.expsize input[type="number"]');
    const w = Number(await nums.nth(0).inputValue());
    const h = Number(await nums.nth(1).inputValue());
    expect(w, "dialog width").toBeGreaterThan(0);
    expect(h, "dialog height").toBeGreaterThan(0);

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      dialog.getByRole("button", { name: /Export PNG/i }).click(),
    ]);
    const buf = await readFile((await download.path())!);

    expect([...buf.subarray(0, 8)], "PNG signature").toEqual(PNG_SIGNATURE);
    expect(pngSize(buf), "PNG dimensions == the size the dialog promised").toEqual({ w, h });
    // A blank/empty canvas compresses to a few hundred bytes; a real drawn graph is far bigger.
    expect(buf.length, "PNG has real drawn content, not a blank canvas").toBeGreaterThan(2000);
    expect(await app.consoleErrors()).toEqual([]);
  });

  test("JPEG and TIFF: each emits its own format's magic bytes and non-trivial content", async ({ page }) => {
    await collectErrors(page);
    const app = new MadyApp(page);
    await app.open();

    // JPEG — SOI marker FF D8 FF
    {
      const dialog = await openExportDialog(app, page);
      await dialog.locator('select[aria-label="Format"]').selectOption("jpg");
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        dialog.getByRole("button", { name: /Export JPG/i }).click(),
      ]);
      const buf = await readFile((await download.path())!);
      expect([...buf.subarray(0, 3)], "JPEG SOI magic").toEqual([0xff, 0xd8, 0xff]);
      expect(buf.length).toBeGreaterThan(2000);
    }

    // TIFF — header is little-endian "II*\0" or big-endian "MM\0*"
    {
      const dialog = await openExportDialog(app, page);
      await dialog.locator('select[aria-label="Format"]').selectOption("tiff");
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        dialog.getByRole("button", { name: /Export TIFF/i }).click(),
      ]);
      const buf = await readFile((await download.path())!);
      const m = buf.subarray(0, 4);
      const littleEndian = m[0] === 0x49 && m[1] === 0x49 && m[2] === 0x2a && m[3] === 0x00;
      const bigEndian = m[0] === 0x4d && m[1] === 0x4d && m[2] === 0x00 && m[3] === 0x2a;
      expect(littleEndian || bigEndian, "TIFF magic (II*\\0 or MM\\0*)").toBe(true);
      expect(buf.length).toBeGreaterThan(2000);
    }

    expect(await app.consoleErrors()).toEqual([]);
  });
});
