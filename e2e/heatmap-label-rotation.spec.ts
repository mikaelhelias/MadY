import { expect, test } from "@playwright/test";
import { MadyApp } from "./app";

/**
 * Rotated column labels must not land on the cells.
 *
 * A rotated column label is anchored at its end and rotated about that point, so its tail hangs
 * down-left from the pivot by `width × sin(angle)`. Guards against a flat lift (e.g. 5 px) in the
 * renderer: at 45° every label would drop straight into the first row of cells while the band
 * `marginTop` reserved for them sits empty above it.
 *
 * This has to be checked in a real browser. The defect class is a constant in the renderer, not a number
 * in the scene: the builder's reserve can be correct while the drawing is wrong, so a scene-level
 * assertion would pass. And jsdom has no text metrics, so only the real browser can say where
 * a rotated label's box actually is.
 *
 * The companion `heatmap-label-lift.test.tsx` pins the wiring (the renderer reads the builder's
 * number); this pins the outcome.
 */
const GENE_HEATMAP = "Gene expression heatmap";
const COLS = /^(Ctrl|Drug A|Drug B|Drug C|Combo)$/;

/**
 * How far a label's box hangs below the top of the cells, in units of the box's own height —
 * negative when it clears.
 *
 * Note: not a raw pixel comparison. A `<text>` box includes the font's descent, which reaches
 * ~2 px below the baseline even for a word with no descender ("Ctrl" measures 1 px past the grid
 * while sitting correctly above it). A quarter of the box height is that descent and nothing
 * more; a label that drops onto the cells overlaps them by about half its box, so the allowance
 * cannot hide it — with a flat lift in the renderer, every angle fails.
 */
const over = (l: { bottom: number; height: number }, cellTop: number): number =>
  (l.bottom - cellTop) / Math.max(1, l.height) - 0.25;

/** Every column label's box, and the top edge of the cell grid — in screen pixels. */
async function measure(page: import("@playwright/test").Page): Promise<{ cellTop: number; labels: { text: string; bottom: number; height: number }[] }> {
  return page.evaluate((src) => {
    const re = new RegExp(src);
    const svg = document.querySelector("svg.gfx-figure")!;
    const cells = [...svg.querySelectorAll("rect[data-heatcell]")];
    if (cells.length === 0) throw new Error("no heatmap cells — the fixture cannot exhibit this");
    const labels = [...svg.querySelectorAll("text")]
      .filter((t) => re.test((t.textContent ?? "").trim()))
      .map((t) => {
        const b = t.getBoundingClientRect();
        return { text: (t.textContent ?? "").trim(), bottom: b.bottom, height: b.height };
      });
    return { cellTop: Math.min(...cells.map((c) => c.getBoundingClientRect().top)), labels };
  }, COLS.source);
}

test.describe("heatmap column labels, rotated (live)", () => {
  test("at every angle the labels clear the cells rather than hanging into the first row", async ({ page }) => {
    const app = new MadyApp(page);
    await app.open();
    await app.openGraph(GENE_HEATMAP);
    await app.settle();

    // The fixture must be able to exhibit the defect: with a flat 5 px lift, a 45° label
    // whose width is w hangs w × sin45 ≈ 0.7w below the pivot. These names are 25-45 px wide,
    // so the drop is 18-32 px — many times a 5 px reserve.
    const flat = await measure(page);
    expect(flat.labels.length, "the demo heatmap does not have the five column names this test reads").toBe(5);
    for (const l of flat.labels) {
      expect(over(l, flat.cellTop), `horizontal label "${l.text}" is already on the cells`).toBeLessThanOrEqual(0);
    }

    for (const angle of [30, 45, 60, 90]) {
      await app.setPlotOptions({ heatmap: { labelRotation: angle } });
      await app.settle();
      const m = await measure(page);
      expect(m.labels.length, `at ${angle}° the labels stopped being drawn`).toBe(5);
      for (const l of m.labels) {
        expect(
          over(l, m.cellTop),
          `at ${angle}° the label "${l.text}" hangs ${Math.round(l.bottom - m.cellTop)} px into the cells`,
        ).toBeLessThanOrEqual(0);
      }
    }
  });

  test("the reserved band is used, not just reserved — the labels sit in it", async ({ page }) => {
    // The other half of the same defect: the margin can be big enough while the labels are
    // drawn below it. So it is not enough that they clear the cells — they must be inside the
    // band, not floating somewhere above the figure.
    const app = new MadyApp(page);
    await app.open();
    await app.openGraph(GENE_HEATMAP);
    await app.setPlotOptions({ heatmap: { labelRotation: 45 } });
    await app.settle();
    const m = await measure(page);
    const svgTop = await page.evaluate(() => document.querySelector("svg.gfx-figure")!.getBoundingClientRect().top);
    for (const l of m.labels) {
      expect(l.bottom, `"${l.text}" is drawn above the figure itself`).toBeGreaterThan(svgTop);
      expect(m.cellTop - l.bottom, `"${l.text}" is stranded far above the grid`).toBeLessThan(60);
    }
  });
});
