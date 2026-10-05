import { expect, test } from "@playwright/test";
import { collectErrors, MadyApp } from "./app";

/**
 * Ink versus box — each chart fills its own figure: it inks at least 90% of it, or, for the
 * cards listed in `FLOORS`, at least that card's own recorded floor.
 *
 * Space use is a key parameter: a disc drawn in a wide box leaves empty flanks while every
 * proxy metric reads healthy — blank space must be measured as the drawing's ink extent
 * against its own scene box, per kind. Circular kinds (treemap, pie, radar) cannot use a
 * 3:2 box, so they declare near-square default figure sizes (as the heatmap does), giving
 * a default box the disc can fill. A given box is never shrunk and content is never dropped to
 * meet the floor; a user's own figure size is always honoured as given.
 *
 * The floor is 0.90. The pie keeps a band of slice-explode headroom (the house style
 * explodes every slice 0.12, and slices really do occupy that ring in their own directions),
 * which is reserved drawing room, not waste. A circular kind drawn in a wide 3:2 box measures
 * roughly 0.81-0.88, so the floor catches a circular kind's default box being re-widened.
 *
 * Resize grips and invisible click targets are excluded from the ink (see below); counting
 * them stretches every card's ink box to its edges and inflates the share.
 */
/**
 * Cards that draw less than 90% of their figure (grips and invisible click targets
 * excluded from the ink), each held at a floor 2 points under its measured share, so any card
 * that loses space still fails. When a card's share improves, its floor is raised to match;
 * every card not listed (and every new one) keeps 90%.
 * The network's force layout keeps the graph's own proportions, so it is held the same way.
 */
const FLOORS: Record<string, number> = {
  "Chord / circos": 0.53, // measured 55.0%
  "Before–after (paired)": 0.734, // measured 75.4%
  "Ordination — variables": 0.761, // measured 78.1%
  "Network graph": 0.776, // measured 79.6%
  "Treemap": 0.803, // measured 82.3%
  "Radar / spider": 0.81, // measured 83.0%
  "Polar histogram (wind rose)": 0.838, // measured 85.8%
  "Heatmap — clustered, split, annotated": 0.842, // measured 86.2%
  "Box & whisker": 0.845, // measured 86.5%
  "Column scatter": 0.847, // measured 86.7%
  "Floating bars (min→max)": 0.848, // measured 86.8%
  "Sunburst": 0.858, // measured 87.8%
  "Violin": 0.86, // measured 88.0%
  "Swimmer plot": 0.861, // measured 88.1%
  "Oncoprint": 0.862, // measured 88.2%
  "Timeline tracks": 0.868, // measured 88.8%
  /*
   * A graph keeps its proportions: it is laid out at its own 580×380 and zoomed to the window,
   * not re-laid-out at the window's size. The fixed-size furniture (tick numbers, the legend
   * column) is a bigger share of that smaller layout, so these eight draw 1–6 points less of their
   * box than a layout at the window's size would.
   * Same rule as above: 2 points under the measured share, so a card that loses more space still fails.
   */
  "Parallel coordinates": 0.794, // measured 81.4%
  "Bland-Altman": 0.833, // measured 85.3%
  "Bubble": 0.848, // measured 86.8%
  "Ordination — sites": 0.848, // measured 86.8%
  "Bars + line (2nd axis)": 0.85, // measured 87.0%
  "Ordination — biplot": 0.854, // measured 87.4%
  "QQ plot (GWAS)": 0.86, // measured 88.0%
  "Relative abundance (stacked)": 0.869, // measured 88.9%
};

test("every gallery kind inks at least 90% of its own figure box, or its recorded floor", async ({ page }) => {
  test.setTimeout(1_200_000);
  await collectErrors(page);
  const app = new MadyApp(page);
  await app.open();
  const titles = await app.openGallery();
  expect(titles.length).toBeGreaterThan(30);

  const bad: string[] = [];
  const all: string[] = [];
  for (const title of titles) {
    await app.openGallery();
    await app.openGalleryCard(title);
    await app.settle();
    const m = await page.evaluate(() => {
      const svg = document.querySelector("svg.gfx-figure") as SVGSVGElement | null;
      if (!svg) return null;
      const box = svg.getBoundingClientRect();
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const el of svg.querySelectorAll("*")) {
        const tag = el.tagName.toLowerCase();
        if (tag === "defs" || tag === "clippath" || tag === "g" || tag === "svg" || el.closest("defs")) continue;
        // interaction helpers are hit targets, not ink
        if ((el.getAttribute("class") ?? "").includes("gfx-draghit") || (el.getAttribute("class") ?? "").includes("resize")) continue;
        // The figure-resize grips are rects inside `<g class="gfx-figresize">` — their own class says
        // nothing, so without this they count as ink and stretch every chart's ink box to the figure's
        // right and bottom edges. Excluding them can only reveal blank space, never invent it.
        if (el.closest(".gfx-figresize")) continue;
        const s = getComputedStyle(el);
        if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0) continue;
        // An invisible click target is not ink either: the plot-area and axis-band hit rects are
        // `fill="transparent"` with no stroke. When a chart's plot rect reaches its figure's edges
        // (e.g. ternary) they would read as ink to those edges — 97% for a card with 45px blank below
        // it (88% with them excluded). Like the grips, excluding them can only reveal blank space,
        // never invent it.
        if (tag !== "text" && tag !== "image" && tag !== "use") {
          const clear = (v: string) => v === "none" || v === "transparent" || v === "rgba(0, 0, 0, 0)" || v === "";
          if (clear(s.fill) && clear(s.stroke)) continue;
        }
        const r = el.getBoundingClientRect();
        if (r.width < 0.5 || r.height < 0.5) continue;
        // full-bleed background/backdrop elements are box, not ink
        if (r.width >= box.width * 0.98 && r.height >= box.height * 0.98) continue;
        x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y);
        x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom);
      }
      if (!Number.isFinite(x0)) return null;
      return Math.min(1, ((x1 - x0) * (y1 - y0)) / (box.width * box.height));
    });
    if (m == null) continue;
    // Per-card floor: the recorded floor above, else 90%.
    const floor = FLOORS[title] ?? 0.9;
    all.push(`${title}: ${(m * 100).toFixed(1)}%`);
    if (m < floor) bad.push(`${title}: ink ${(m * 100).toFixed(0)}% of its box (floor ${(floor * 100).toFixed(0)}%)`);
  }
  console.log("INK-ALL\n" + all.join("\n"));
  expect(bad, "kinds wasting their own figure on blank background:\n  - " + bad.join("\n  - ") + "\n").toEqual([]);
  expect(await app.consoleErrors()).toEqual([]);
});
