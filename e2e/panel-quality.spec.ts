import { expect, test } from "@playwright/test";
import { collectErrors, MadyApp } from "./app";

/**
 * Panel quality — what every multi-panel figure must satisfy, checked after each layout is
 * applied:
 *   1. no clashes (cards, text-on-text, panel letters on graph text) — screen px;
 *   2. readable fonts — smallest rendered text ≥ 8px in every panel;
 *   3. space use — dense figures (fill logged; sprawl >2200px fails);
 *   4. alignment — guarded structurally by LayoutPane.test.tsx; here: clean tiling.
 *
 * Representative matrix, not exhaustive: an axis-heavy, an axis-less-heavy and an
 * all-axis-less mix, across the picker's shape families (grids, wide top, tall left).
 */
const CASES: { name: string; graphs: string[]; presets: string[] }[] = [
  {
    name: "axis-heavy 3",
    graphs: ["Dose-response", "Treatment bar chart", "Dose-group violin"],
    presets: ["2-column grid", "Tall left", "Wide top (2 under)"],
  },
  {
    name: "mixed 6 (half axis-less)",
    graphs: ["Dose-response", "Gene expression heatmap", "Treatment bar chart", "GDP treemap", "Dose-group violin", "Signaling network"],
    presets: ["3-column grid", "2-column grid"],
  },
  {
    name: "all-axis-less 4",
    graphs: ["Gene expression heatmap", "GDP treemap", "Signaling network", "Heritability dot plot"],
    presets: ["2-column grid", "Wide top (3 under)"],
  },
];

for (const cfg of CASES) {
  test(`panel quality — ${cfg.name}`, async ({ page }) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width: 2100, height: 1600 });
    await collectErrors(page);
    const app = new MadyApp(page);
    await app.open();
    await app.newFigure(cfg.graphs);
    await app.settle();

    for (const presetName of cfg.presets) {
      await page.evaluate(() => {
        const b = [...document.querySelectorAll("button")].find((x) => /Layout\s?▾/.test(x.textContent ?? ""));
        (b as HTMLButtonElement).click();
      });
      await app.settle();
      const hit = await page.evaluate((want: string) => {
        const el = [...document.querySelectorAll(".laypreset-item")].find((x) => (x.textContent ?? "").trim() === want);
        (el as HTMLButtonElement | undefined)?.click();
        return !!el;
      }, presetName);
      expect(hit, `preset "${presetName}" offered`).toBe(true);
      await app.settle();

      const m = await page.evaluate(() => {
        const panels = [...document.querySelectorAll(".laypanel")];
        const cards = panels.map((p) => p.getBoundingClientRect());
        // criterion 2: smallest rendered text per panel
        const minFonts = panels.map((panel) => {
          const svg = panel.querySelector("svg.gfx-figure")!;
          const k = Number(svg.getAttribute("width")) / Number((svg.getAttribute("viewBox") ?? "0 0 1 1").split(" ")[2]);
          let min = Infinity;
          let worst = "";
          for (const t of svg.querySelectorAll("text")) {
            if (!(t.textContent ?? "").trim()) continue;
            const r = t.getBoundingClientRect();
            if (r.width < 0.5 || r.height < 0.5) continue;
            const f = (parseFloat(getComputedStyle(t).fontSize) || 99) * k;
            if (f < min) { min = f; worst = (t.textContent ?? "").trim().slice(0, 12); }
          }
          // identity hint: the panel's letter + its worst text, so a failure names its panel
          const letter = panel.querySelector(".laypanel-letter")?.textContent?.trim() ?? "?";
          return { panel: letter, px: Math.round(min * 10) / 10, worst, k: Math.round(k * 100) / 100 };
        });
        // criterion 1: card overlaps + letters on graph text
        let cardOverlaps = 0;
        for (let a = 0; a < cards.length; a++)
          for (let b = a + 1; b < cards.length; b++) {
            const ox = Math.min(cards[a]!.right, cards[b]!.right) - Math.max(cards[a]!.x, cards[b]!.x);
            const oy = Math.min(cards[a]!.bottom, cards[b]!.bottom) - Math.max(cards[a]!.y, cards[b]!.y);
            if (ox > 4 && oy > 4) cardOverlaps++;
          }
        const letters = [...document.querySelectorAll(".laypanel-letter")].map((el) => el.getBoundingClientRect());
        let letterClashes = 0;
        for (const svg of document.querySelectorAll(".laypanel svg.gfx-figure"))
          for (const t of svg.querySelectorAll("text")) {
            if (!(t.textContent ?? "").trim()) continue;
            const b = t.getBoundingClientRect();
            if (b.width < 0.5) continue;
            for (const L of letters) {
              const ox = Math.min(L.right, b.right) - Math.max(L.x, b.x);
              const oy = Math.min(L.bottom, b.bottom) - Math.max(L.y, b.y);
              if (ox > 1.5 && oy > 1.5) letterClashes++;
            }
          }
        // criterion 3: fill + figure span
        const ux0 = Math.min(...cards.map((r) => r.x));
        const uy0 = Math.min(...cards.map((r) => r.y));
        const ux1 = Math.max(...cards.map((r) => r.right));
        const uy1 = Math.max(...cards.map((r) => r.bottom));
        const fill = cards.reduce((s, r) => s + r.width * r.height, 0) / ((ux1 - ux0) * (uy1 - uy0));
        return { minFonts, cardOverlaps, letterClashes, fill: Math.round(fill * 100) / 100, spanW: Math.round(ux1 - ux0) };
      });
      console.log(`panel quality ${cfg.name} / ${presetName}: ` + JSON.stringify(m));
      for (const f of m.minFonts) expect(f.px, `[${cfg.name} / ${presetName}] panel ${f.panel} smallest text "${f.worst}" (k=${f.k}) ≥ 8px — all: ${JSON.stringify(m.minFonts)}`).toBeGreaterThanOrEqual(8);
      expect(m.cardOverlaps, `[${cfg.name} / ${presetName}] no card overlaps`).toBe(0);
      expect(m.letterClashes, `[${cfg.name} / ${presetName}] no letters on graph text`).toBe(0);
      expect(m.spanW, `[${cfg.name} / ${presetName}] no sprawl`).toBeLessThan(2200);
    }
    expect(await app.consoleErrors()).toEqual([]);
  });
}
