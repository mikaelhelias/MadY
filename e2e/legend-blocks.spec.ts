import { expect, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { MadyDocument } from "../packages/core/src/index";
import { galleryItems } from "../apps/desktop/src/renderer/src/shell/gallery";
import { MadyApp } from "./app";

/**
 * Every legend-like block with a heading, in the real browser: can its title be edited on the graph,
 * can the block be dragged, can its font be edited from the panel its click opens, and is there a size
 * control. Measured on the drawing with the real mouse, because a jsdom test cannot see pointer
 * capture swallowing a double-click on a legend title, or a font control that sits in a panel the
 * click hides.
 *
 * Each block's `expected` row is the register of what the block can do. Anything that differs fails — a block that
 * lost a capability, and equally a block that gained one (update the row, so the register stays the
 * truth). A `false` is a capability the block does not have; where the reason is not obvious, `GAPS`
 * gives it, and a failure message quotes it.
 */
type Caps = { title: boolean; drag: boolean; font: boolean; size: string | null };

interface Block {
  id: string;
  card: string;
  /** Turn the block on, for blocks no gallery card draws by default. Runs on the open graph. */
  setup?: (app: MadyApp) => Promise<void>;
  /** How to find the group that drags: a CSS selector, or a regular expression over its tooltip. */
  css?: string;
  tip?: RegExp;
  /** The title text: the rotated text (a colour bar's title) or the first text of the group. */
  rotatedTitle?: boolean;
  /** Where the drag presses. The legend's rows are the exception: a click on a row picks it, and a picked row tears
   *  off the block when dragged, so the whole legend is dragged by its heading. */
  dragFrom?: "title" | "body";
  /** Find the block by its drawn words instead (a caption that is one text element: the element is the block and its title). */
  textRe?: RegExp;
  /** The font group the panel must carry, when its heading is not named for a legend / key / bar / caption. */
  fontGroup?: RegExp;
  /** A row of the panel that sets the font size when the font group has no size row of its own. */
  fontSizeRow?: string;
  /** The block has no size control of its own beyond its font size, and the panel has an unrelated "size" row (the brackets' symbol). */
  sizeIsFont?: boolean;
  expected: Caps;
}

const BUBBLE: Caps = { title: true, drag: true, font: true, size: "Legend size" };

const BLOCKS: Block[] = [
  { id: "bubble size legend", card: "Bubble", css: "g.gfx-size-legend", expected: BUBBLE },
  { id: "bubble size legend (colour by category)", card: "Bubbles by category", css: "g.gfx-size-legend", expected: BUBBLE },
  { id: "bubble size legend (ordination sites)", card: "Ordination — sites", css: "g.gfx-size-legend", expected: BUBBLE },
  { id: "bubble size legend (ordination biplot)", card: "Ordination — biplot", css: "g.gfx-size-legend", expected: BUBBLE },
  { id: "heatmap colour bar", card: "Heatmap — clustered, split, annotated", tip: /colour scale/i, rotatedTitle: true, expected: { title: true, drag: true, font: true, size: "Bar size" } },
  { id: "correlation key", card: "Correlation matrix", tip: /correlation scale/i, expected: { title: true, drag: true, font: true, size: "Key symbol size" } },
  { id: "number at risk", card: "Survival (Kaplan-Meier)", tip: /number-at-risk/i, expected: { title: true, drag: true, font: true, size: null } },
  {
    id: "parallel colour bar", card: "Parallel coordinates", css: "g:has(> rect[fill^='url'])", rotatedTitle: true,
    setup: async (app) => {
      const proj = (await app.project()) as { tables: { id: string; columns: { id: string; name: string }[]; rows: { cells: Record<string, unknown> }[] }[]; plots: { id: string; parallel?: object }[] };
      const plotId = await app.activePlotId();
      const plot = proj.plots.find((p) => p.id === plotId)!;
      const t = proj.tables[proj.tables.length - 1]!;
      const num = [...t.columns].reverse().find((c) => t.rows.every((r) => typeof r.cells[c.id] === "number"))!;
      await app.setPlotOptions({ parallel: { ...(plot.parallel ?? {}), colorColumn: num.id, colorScale: "value", colorbarTitle: "Score" } });
    },
    expected: { title: true, drag: true, font: true, size: "Bar size" },
  },
  {
    id: "colour bar of a graph coloured by a column", card: "XY (points + fitted curve)", css: "g.gfx-colorbar", rotatedTitle: true,
    setup: async (app) => {
      const proj = (await app.project()) as { tables: { id: string; columns: { id: string; role?: string }[] }[]; plots: { id: string; seriesStyles?: Record<string, object> }[] };
      const plotId = await app.activePlotId();
      const plot = proj.plots.find((p) => p.id === plotId)!;
      const ys = proj.tables[proj.tables.length - 1]!.columns.filter((c) => c.role === "y");
      await app.setPlotOptions({ seriesStyles: { ...(plot.seriesStyles ?? {}), [ys[0]!.id]: { ...(plot.seriesStyles?.[ys[0]!.id] ?? {}), colorFromColumn: ys[1]!.id, colorFromMode: "continuous" } } });
    },
    expected: { title: true, drag: true, font: true, size: "Bar size" },
  },
  {
    id: "network node-value key", card: "Network graph", tip: /value legend/i, fontGroup: /node label font/i, fontSizeRow: "Label size",
    setup: async (app) => {
      const proj = (await app.project()) as { plots: { network?: Record<string, unknown> }[] };
      const { groupColumn: _g, ...rest } = (proj.plots[proj.plots.length - 1]!.network ?? {}) as Record<string, unknown>;
      await app.setPlotOptions({ network: { ...rest, valueLegendTitle: "Abundance" } });
    },
    expected: { title: true, drag: true, font: true, size: "Key size" },
  },
  {
    id: "significance key", card: "Bar / column (+ error bars)", textRe: /p\s*[<=]/, fontSizeRow: "Size", sizeIsFont: true,
    setup: async (app) => {
      await app.setPlotOptions({ significance: { legend: true }, annotations: [
        { id: "sb1", kind: "bracket", from: 1, to: 2, p: 0.003 }, { id: "sb2", kind: "bracket", from: 1, to: 3, p: 0.04 } ] });
    },
    expected: { title: false, drag: true, font: true, size: null },
  },
  { id: "timeline strip key", card: "Timeline tracks", tip: /keys' size and font/i, expected: { title: false, drag: true, font: true, size: "Key size" } },
  {
    id: "scale bar", card: "XY (points + fitted curve)", tip: /scale bar/i, fontGroup: /tick/i,
    setup: async (app) => { await app.setPlotOptions({ xAxis: { hidden: true, scaleBar: { length: 0.5, label: "0.5 µM" } }, yAxis: { hidden: true } }); },
    expected: { title: true, drag: true, font: true, size: "Scale bar" },
  },
  {
    id: "series legend heading", card: "XY (points + fitted curve)", css: "g.gfx-legend", dragFrom: "title",
    setup: async (app) => { await app.setPlotOptions({ legend: { title: "Compound" } }); },
    expected: { title: true, drag: true, font: true, size: "Symbol size" },
  },
  {
    id: "zone key heading", card: "XY (points + fitted curve)", css: "g.gfx-zonekey",
    setup: async (app) => {
      const ax = (await app.sceneAxis("y"))!;
      const span = ax.domain[1] - ax.domain[0];
      await app.setPlotOptions({
        zoneLegend: "topright",
        zoneLegendTitle: "Zones",
        annotations: [
          { id: "zk1", kind: "hband", bandLo: ax.domain[0] + span * 0.1, bandHi: ax.domain[0] + span * 0.3, label: "Low", color: "#56b4e9" },
          { id: "zk2", kind: "hband", bandLo: ax.domain[0] + span * 0.6, bandHi: ax.domain[0] + span * 0.85, label: "High", color: "#e69f00" },
        ],
      });
    },
    expected: { title: true, drag: true, font: true, size: "Key symbol size" },
  },
  {
    id: "zone key row", card: "XY (points + fitted curve)", css: "g.gfx-zonekey",
    setup: async (app) => {
      const ax = (await app.sceneAxis("y"))!;
      const span = ax.domain[1] - ax.domain[0];
      await app.setPlotOptions({
        zoneLegend: "topright",
        annotations: [
          { id: "zk1", kind: "hband", bandLo: ax.domain[0] + span * 0.1, bandHi: ax.domain[0] + span * 0.3, label: "Low", color: "#56b4e9" },
          { id: "zk2", kind: "hband", bandLo: ax.domain[0] + span * 0.6, bandHi: ax.domain[0] + span * 0.85, label: "High", color: "#e69f00" },
        ],
      });
    },
    expected: { title: true, drag: true, font: true, size: "Key symbol size" },
  },
];

/** Why a block has no control for a capability marked `false` / null above; the failure message quotes it. */
export const GAPS: Record<string, string> = {
  "number at risk": "no size slider of its own: the table is sized by its font (the rows and columns follow it), and a second control would double that",
};

test.describe("legend blocks: title, drag, font, size — in the real browser", () => {
  for (const b of BLOCKS) {
    test(b.id + (b.card ? ` — ${b.card}` : ""), async ({ page }) => {
      const app = new MadyApp(page);
      await app.open();
      await app.openGallery();
      await app.openGalleryCard(b.card);
      if (b.setup) await b.setup(app);

      // The graph redraws on a click (the panel opens, a font changes), which replaces the nodes, so the
      // block is found again, and marked, before every step that needs it.
      const tag = () => page.evaluate(({ css, tip, rotated, textRe }) => {
        const svg = document.querySelector("svg.gfx-figure")!;
        const re = tip ? new RegExp(tip.source, tip.flags) : null;
        document.querySelectorAll("[data-probe-g],[data-probe-t]").forEach((e) => { e.removeAttribute("data-probe-g"); e.removeAttribute("data-probe-t"); });
        if (textRe) {
          const tr = new RegExp(textRe.source, textRe.flags);
          const el = [...svg.querySelectorAll("text")].filter((x) => tr.test((x.textContent ?? "").trim())).pop();
          if (!el) return null;
          el.setAttribute("data-probe-g", "1"); el.setAttribute("data-probe-t", "1");
          return { title: el.textContent ?? "" };
        }
        const g = css ? svg.querySelector(css) : [...svg.querySelectorAll("g")].find((x) => re!.test(x.querySelector(":scope > title")?.textContent ?? ""));
        if (!g) return null;
        g.setAttribute("data-probe-g", "1");
        const texts = [...g.querySelectorAll("text")];
        const t = rotated ? texts.find((x) => /rotate/.test(x.getAttribute("transform") ?? "")) ?? texts[0] : texts[0];
        t?.setAttribute("data-probe-t", "1");
        return { title: t?.textContent ?? "" };
      }, { css: b.css, tip: b.tip ? { source: b.tip.source, flags: b.tip.flags } : undefined, rotated: !!b.rotatedTitle, textRe: b.textRe ? { source: b.textRe.source, flags: b.textRe.flags } : undefined });
      expect(await tag(), `${b.id}: the block is not drawn on the card, so nothing about it can be checked`).not.toBeNull();

      const box = async (sel: string) => { await tag(); return (await page.$(sel))?.boundingBox(); };
      const fontPx = async () => { await tag(); return page.evaluate(() => { const e = document.querySelector("[data-probe-t]"); return e ? Number.parseFloat(getComputedStyle(e).fontSize) : 0; }); };

      // 1. title: a real double-click on it opens the inline editor
      let title = false;
      const tb = await box("[data-probe-t]");
      if (tb) {
        await page.mouse.dblclick(tb.x + tb.width / 2, tb.y + tb.height / 2);
        await page.waitForTimeout(300);
        title = await page.evaluate(() => document.activeElement?.className?.toString().includes("textedit") ?? false);
        await page.keyboard.press("Escape");
        await page.waitForTimeout(150);
      }

      // 2. font + size control: click the title, then the body; in whichever panel opens, the font group
      // named for the legend / key / bar must change the title's drawn size.
      const point = async (w: "title" | "body") => { await tag(); return page.evaluate((w2) => {
        const g = document.querySelector("[data-probe-g]")!;
        const el = w2 === "title" ? g.querySelector("[data-probe-t]") ?? g.querySelector("text") ?? g : g.querySelector("rect[fill^='url']") ?? g.querySelector("path") ?? g.querySelector("circle") ?? g.querySelector("rect") ?? g.querySelector("line") ?? g;
        if (!el) return null;
        const q = el.getBoundingClientRect();
        return { x: q.x + q.width / 2, y: q.y + q.height / 2 };
      }, w); };
      let font = false;
      let size: string | null = null;
      for (const where of ["title", "body"] as const) {
        const p = await point(where);
        if (!p) continue;
        await page.mouse.click(p.x, p.y);
        await page.waitForTimeout(400);
        const panel = await page.evaluate(() => {
          const visible = [...document.querySelectorAll(".inspsec")].filter((s) => !(s as HTMLElement).hidden);
          // The Axis tab has no collapsible sections: its whole panel is the place to read.
          const secs = visible.length ? visible : [...document.querySelectorAll(".insp")];
          const rows = secs.flatMap((s) => [...s.querySelectorAll(".frow > span:first-child")].map((e) => (e.textContent ?? "").trim()));
          const found = rows.filter((r) => /^(legend size|key symbol size|key size|symbol size|bar size|bar length|bar width|scale bar)$/i.test(r));
          // the block's own size control first; the generic legend "Symbol size" is the series legend's
          return { size: found.find((r) => /^(legend size|key symbol size|key size|bar |scale bar)/i.test(r)) ?? found[0] ?? null };
        });
        if (!b.sizeIsFont && panel.size && (!size || /^(legend size|key symbol size|key size|bar |scale bar)/i.test(panel.size))) size = panel.size;
        if (!font) {
          const before = await fontPx();
          // a size that differs from what is drawn now, so a control that does nothing cannot pass
          const target = String(Math.round(before) + 3);
          const group = await page.evaluate(({ to, wantSrc, wantFlags, sizeRow }) => {
            const want = wantSrc ? new RegExp(wantSrc, wantFlags) : /legend|key|colour bar|caption|at risk|number/i;
            const shown = [...document.querySelectorAll(".inspsec")].filter((x) => !(x as HTMLElement).hidden);
            for (const s of shown.length ? shown : [...document.querySelectorAll(".insp")]) {
              for (const sub of s.querySelectorAll(".inspsub")) {
                if (!want.test(sub.textContent ?? "")) continue;
                for (let n = sub.nextElementSibling; n && !n.classList.contains("inspsub"); n = n.nextElementSibling) {
                  if (n.classList.contains("frow") && (n.querySelector(":scope > span")?.textContent === "Size" || (sizeRow !== undefined && n.querySelector(":scope > span")?.textContent === sizeRow))) {
                    const inp = n.querySelector("input") as HTMLInputElement;
                    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
                    set.call(inp, to); inp.dispatchEvent(new Event("input", { bubbles: true })); inp.dispatchEvent(new Event("change", { bubbles: true }));
                    return true;
                  }
                }
              }
            }
            // The font group has no size row of its own (the size is set by a row beside it): use that row.
            if (sizeRow !== undefined) {
              for (const s of [...document.querySelectorAll(".inspsec")].filter((x) => !(x as HTMLElement).hidden)) {
                const r = [...s.querySelectorAll(".frow")].find((x) => x.querySelector(":scope > span")?.textContent === sizeRow);
                const inp = r?.querySelector("input") as HTMLInputElement | undefined;
                if (inp) { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!; set.call(inp, to); inp.dispatchEvent(new Event("input", { bubbles: true })); inp.dispatchEvent(new Event("change", { bubbles: true })); return true; }
              }
            }
            return false;
          }, { to: target, wantSrc: b.fontGroup?.source, wantFlags: b.fontGroup?.flags, sizeRow: b.fontSizeRow });
          if (group) { await page.waitForTimeout(400); font = (await fontPx()) !== before; }
        }
      }

      // 3. drag: press on the block's bar / symbol and pull it; the group must move
      let drag = false;
      const dp = await point(b.dragFrom ?? "body");
      const g1 = await box("[data-probe-g]");
      if (dp && g1) {
        await page.mouse.move(dp.x, dp.y);
        await page.mouse.down();
        await page.mouse.move(dp.x - 60, dp.y + 50, { steps: 8 });
        await page.mouse.up();
        await page.waitForTimeout(400);
        const g2 = await box("[data-probe-g]");
        drag = !!g2 && (Math.abs(g2.x - g1.x) > 30 || Math.abs(g2.y - g1.y) > 30);
      }

      const got: Caps = { title, drag, font, size };
      expect(got, `${b.id} on "${b.card}": capabilities differ from the register${GAPS[b.id] ? ` (known gap: ${GAPS[b.id]})` : ""}`).toEqual(b.expected);
    });
  }
});

/**
 * The one legend of a multi-panel figure is not on a graph: it is an element of the arrange view, so it is checked on a
 * figure of two graphs that plot the same series.
 */
test("shared figure legend — in the real browser", async ({ page }) => {
  const card = galleryItems().find((i) => i.key === "xy")!;
  const doc = new MadyDocument();
  doc.insertGraph(card.table, card.plot, "FigA");
  doc.insertGraph(card.table, card.plot, "FigB");
  mkdirSync("build/e2e-legend", { recursive: true });
  const file = "build/e2e-legend/figure.mady";
  writeFileSync(file, JSON.stringify(doc.toJSON()));

  page.on("dialog", (d) => d.accept().catch(() => {}));
  const app = new MadyApp(page);
  await page.goto("/");
  await page.waitForSelector(".nav");
  await app.settle();
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.keyboard.press("Control+o")]);
  await chooser.setFiles(file);
  await page.waitForTimeout(2000);
  await app.expandTree();
  await app.newFigure(["FigA", "FigB"]);
  await page.locator(".laychip", { hasText: /One\s*legend/i }).first().click();
  await page.waitForSelector(".layfiglegend svg");

  const legendBox = async () => (await page.$(".layfiglegend svg"))!.boundingBox();
  const textSize = () => page.evaluate(() => Number.parseFloat(getComputedStyle(document.querySelector(".layfiglegend svg text:last-of-type")!).fontSize));
  const row = (label: string) => page.locator(".figsel .laylbl", { hasText: new RegExp(`^\\s*${label}`) }).last();

  // The figure's panel has the heading, size and font rows once the one legend is on.
  for (const l of ["Heading", "Key size", "Font", "Size"]) expect(await row(l).count(), `no "${l}" row for the shared legend`).toBeGreaterThan(0);

  // size: the keys' swatches grow with the key size
  const w0 = (await legendBox())!.width;
  await row("Key size").locator("input").evaluate((el) => { const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!; s.call(el, "2"); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); });
  await page.waitForTimeout(300);
  const size = (await legendBox())!.width > w0 ? "Key size" : null;

  // font: the legend's words follow the panel's Size row
  const before = await textSize();
  await row("Size").last().locator("input").fill(String(Math.round(before) + 5));
  await page.waitForTimeout(300);
  const font = (await textSize()) !== before;

  // heading: typed in the panel, then renamed on the figure with a double-click
  await row("Heading").locator("input").fill("Compound");
  await page.waitForTimeout(300);
  const head = (await page.$(".layfiglegend svg text"))!;
  const hb = (await head.boundingBox())!;
  await page.mouse.dblclick(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.waitForTimeout(300);
  const title = (await page.locator(".layfiglegend-edit").count()) === 1;
  if (title) await page.keyboard.press("Escape");

  // drag: pull it by its keys
  const b1 = (await legendBox())!;
  await page.mouse.move(b1.x + b1.width / 2, b1.y + b1.height - 6);
  await page.mouse.down();
  await page.mouse.move(b1.x + b1.width / 2 - 70, b1.y + b1.height - 6 + 40, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const b2 = (await legendBox())!;
  const drag = Math.abs(b2.x - b1.x) > 30 || Math.abs(b2.y - b1.y) > 30;

  expect({ title, drag, font, size } satisfies Caps).toEqual({ title: true, drag: true, font: true, size: "Key size" });
});