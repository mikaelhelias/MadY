/**
 * What each of the manual's videos shows. How the program is worked is `guide-shots-driver.mjs`
 * (shared with the pictures); the pointer, rings and captions are `guide-video-director.mjs`;
 * the loop is `gen-guide-videos.mjs`.
 *
 * An entry:
 *   file     the .webm written into `apps/desktop/src/renderer/src/assets/guide/`
 *            (its heading, alt text and caption live in `guide.ts`, beside the `video` block that
 *            shows it — the same place a picture's do; `guide-videos.test.ts` holds the two lists
 *            to each other in both directions)
 *   engine   true = the real statistics engine answers (see gen-guide-videos.mjs)
 *   bpm      a tempo: cuts land on its beat
 *   music    music under the narration, on the tempo's beat (`video-music.mjs`)
 *   maxRate  caps the encoder's bit rate (default 1M)
 *   init     runs in the page before it loads — fills in a desktop-only bridge (a file dialog)
 *   setup    prepares the program — not filmed
 *   run      the filmed part
 *
 * The narration is the last argument of `d.caption(title, sub, n, say)` and the `say` option of
 * `d.card(...)`: one short spoken sentence per step. It is written for the ear — "Control Z", not
 * "Ctrl+Z"; no ▸ — and a line longer than its step makes the picture wait for it.
 *
 * Every press is a real click on the real control, at the spot the drawn pointer shows. A
 * target that is not on screen fails the run (director.click throws) — a video of the pointer
 * pressing empty space would teach the wrong thing.
 */

import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export const VIDEO_SIZE = { width: 1920, height: 1080 };

/** MadY's "Y" mark — the app icon at full resolution (1024 px), as a data URL: the page allows
 *  `data:` images, and the built bundle only carries a 256 px copy. */
const LOGO = `data:image/png;base64,${readFileSync(join(ROOT, "apps/desktop/build-resources/icon.png")).toString("base64")}`;

/** At its default width the Project panel cuts long names short. Widen it by its own divider,
 *  as a user would, so the tree reads. */
export async function widenTree(app, to = 320) {
  const { page } = app;
  const d = await page.locator(".dockdivider").first().boundingBox();
  if (!d) throw new Error("widenTree: no dock divider");
  const y = d.y + d.height / 2;
  await page.mouse.move(d.x + d.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(to, y, { steps: 8 });
  await page.mouse.up();
  await app.settle();
}

/** A Navigator row by its exact label (the graph's row when a table shares the name). The button's
 *  text starts with its icon's space, hence the `\s*`. */
const navRow = (page, label) =>
  page.locator("button.navlabelbtn").filter({ hasText: new RegExp(`^\\s*${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`) }).last();

/** An open menu's item. */
const menuItem = (page, text) => page.locator(".dropdown .dropitem", { hasText: text }).first();

/** An Inspector <select> recognised by one of its options. */
const inspSelect = (page, optionValue) => page.locator(".insp select", { has: page.locator(`option[value="${optionValue}"]`) }).first();

export const VIDEOS = [
  {
    file: "video-graph-basics.webm",
    engine: true,
    async setup(app) {
      await widenTree(app);
      await app.expandTree();
    },
    async run(app, d) {
      const { page } = app;
      await d.card("Make a graph and adjust it", "From a datasheet to a finished figure", "MadY · video 1", { logo: LOGO, say: "Making a graph, and adjusting it." });
      await d.wait(2600);
      await d.card(null);

      await d.caption("Open your data", "Every datasheet lives in the project tree on the left", 1, "Open your data from the project tree on the left.");
      await d.click(navRow(page, "Sample — dose vs response"));
      await page.waitForSelector("table.dg");
      await d.wait(1400);

      await d.caption("Graph ▸ New graph of this data", "", 2, "Choose Graph, then New graph of this data.");
      await d.click(page.locator(".menubar .menu", { hasText: /^Graph$/ }));
      await d.click(menuItem(page, /^New graph of this data/));
      await page.waitForSelector('[aria-label="New graph"]');
      await d.caption("Pick a graph", "The best fit for this data is already picked — every other kind is one click away", 3, "The best graph for this data is already pre-selected. Any other kind is one click away.");
      await d.show(page.locator('[aria-label="Graph types"]').first(), 1800);
      await d.show(page.locator('[aria-label="New graph"] select').last(), 1200);
      await d.click(page.locator("button", { hasText: /^Create graph$/ }));
      await page.waitForSelector("svg.gfx-figure");
      await d.wait(1200);

      await d.caption("Click any part of the graph to change it", "Here, the data points: their settings open on the right", 4, "Click any part of the graph to change it. Here, the data points.");
      await d.click(page.locator('svg.gfx-figure .gfx-series [style*="cursor: pointer"]').nth(2));
      await d.moveTo(1500, 900);
      await d.wait(700);
      await d.caption("A new colour, a new shape", "", 5, "Pick a new colour, and a new shape.");
      await d.click(page.locator('.insp button[aria-label="Palette #D62728"]'));
      await d.wait(600);
      const shape = inspSelect(page, "square");
      await d.click(shape, { act: () => shape.selectOption("square").then(() => {}) });
      await d.wait(1300);

      await d.caption("Double-click any text to retype it", "Ctrl+Enter finishes — for titles, axis names and legends alike", 6, "Double-click any text to retype it. Control Enter finishes.");
      await d.click(page.locator("svg.gfx-figure text", { hasText: /^XY: points & line$/ }).first(), { double: true });
      await page.keyboard.press("Control+a");
      await d.type("Compound A lowers the response", 45);
      // A title can hold several lines, so Enter is a new line and Ctrl+Enter finishes.
      await d.press("Ctrl + Enter", "Control+Enter");
      await d.wait(1100);

      await d.caption("Gridlines and a frame, from the toolbar", "", 7, "Gridlines and a frame come from the toolbar.");
      await d.click(page.locator("label", { hasText: /^\s*Grid\s*$/ }).first());
      await d.wait(700);
      const frame = page.locator("select", { has: page.locator('option[value="box"]') }).first();
      await d.click(frame, { act: () => frame.selectOption("box").then(() => {}) });
      await d.wait(1300);

      await d.caption("Undo anything", "Ctrl+Z steps back one change at a time — Ctrl+Y puts it back", 8, "Control Z undoes a change. Control Y puts it back.");
      await d.press("Ctrl + Z", "Control+z");
      await d.wait(700);
      await d.press("Ctrl + Y", "Control+y");
      await d.wait(900);

      await d.caption("Export for a paper or a slide", "PDF, SVG, PNG or TIFF, at the size the journal asks for", 9, "Export as PDF, SVG, PNG or TIFF, at the size the journal asks for.");
      await d.show(page.locator("button", { hasText: /^\s*Export\s*$/ }).first(), 1800);
      await d.caption("");
      await d.card("That is a graph", "Next: analysing your data", "MadY", { logo: LOGO, say: "That's a graph. Next: analysing your data." });
      await d.wait(2400);
    },
  },

  // ───────────────────────────── 2 · analyse your data ─────────────────────────────
  {
    file: "video-analysis.webm",
    engine: true,
    async setup(app) {
      await widenTree(app);
      await app.expandTree();
    },
    async run(app, d) {
      const { page } = app;
      const dialog = page.locator('[aria-label="Analyze"]').first();
      await d.card("Analyse your data", "Pick a question, check the test, put the answer on the graph", "MadY · video 2", { logo: LOGO, say: "Analysing your data." });
      await d.wait(2600);
      await d.card(null);

      await d.caption("Open the data", "Three groups — Vehicle, Low dose, High dose — eight readouts each", 1, "Open the data: three groups, eight readouts each.");
      await d.click(navRow(page, "Replicate readouts"));
      await page.waitForSelector("table.dg");
      await d.wait(1300);

      await d.caption("Analyze ▸ Analyze…", "", 2, "Open the Analyze menu.");
      await d.click(page.locator(".menubar .menu", { hasText: /^Analyze$/ }));
      await d.click(menuItem(page, /^Analyze…/));
      await dialog.waitFor();
      await d.caption("Say what you want to know", "Analyses that suit this sheet come first, then goals in plain words", 3, "Analyses corresponding best to your data come first.");
      await d.show(page.locator(".an-recs").first(), 1600);
      await d.click(page.locator(".an-goals .an-card", { hasText: "Compare groups" }).first());
      await d.wait(700);

      await d.caption("The test is set up for you — change anything", "Three groups, so one-way ANOVA", 4, "The test is set up for you.");
      const test = dialog.locator('select[aria-label="Test"]');
      await d.click(test, { act: () => test.selectOption("anova").then(() => {}) });
      await d.wait(600);
      const high = dialog.locator("label", { hasText: "High dose" }).locator("input");
      if (!(await high.isChecked())) await d.click(high);
      await d.wait(500);
      await d.caption("Every test says when to use it, and what it assumes", "", 5, "Every test says when to use it, and what it assumes.");
      await d.show(dialog.locator(".an-sec", { hasText: "About this analysis" }).locator("xpath=following-sibling::*[1]").first(), 2400, { point: false });
      await d.click(dialog.locator("button", { hasText: /^Run$/ }));
      await page.waitForSelector(".ankey", { timeout: 20000 });
      await d.wait(900);

      await d.caption("The answer", "The key numbers, every comparison, and one sentence you can quote", 6, "The answer: the key numbers, every comparison, and one sentence you can quote.");
      await d.show(page.locator(".ankey-cards").first(), 1600);
      await d.show(page.locator(".ankey-verdict").first(), 2000);
      await d.show(page.locator(".valbadge").first(), 1500);

      await d.caption("Put it on the graph", "The brackets stay tied to the analysis: change a number and every p updates", 7, "Put it on the graph. The brackets stay tied to the analysis, so change a number and every p value updates.");
      await d.click(page.locator(".anbind input").first());
      await d.wait(700);
      await d.click(navRow(page, "Dose-group violin"));
      await page.waitForSelector("svg.gfx-figure");
      await d.moveTo(1500, 950);
      await d.wait(2600);

      await d.caption("Methods text, CSV and Excel for your paper", "One click each, from the analysis tab", 8, "Methods text, CSV and Excel for your paper, one click each.");
      await d.click(page.locator(".tab, [role=tab]", { hasText: /^ANOVA/ }).last());
      await d.show(page.locator(".antoolbar").first(), 2000);
      await d.caption("");
      await d.card("That is an analysis", "Next: style presets", "MadY", { logo: LOGO, say: "That's an analysis. Next: style presets." });
      await d.wait(2400);
    },
  },

  // ───────────────────────────── 3 · style presets ─────────────────────────────
  {
    file: "video-presets.webm",
    engine: true,
    // The preset file dialogs belong to the desktop app. Export keeps what it was given; Import
    // hands back that same file, renamed, as if a colleague had sent it.
    init: () => {
      window.mady = window.mady ?? {};
      window.mady.exportFile = async (payload) => {
        window.__exported = payload;
        return { ok: true, path: `C:/Users/you/Documents/${payload.suggestedName}.json` };
      };
      window.mady.presetImport = async () => ({
        ok: true,
        files: [{ name: "shared-lab-style.mady-preset.json", text: (window.__exported?.text ?? "").replaceAll("Our lab style", "Shared lab style") }],
      });
    },
    async setup(app) {
      await widenTree(app);
      await app.expandTree();
      await app.openGraph("Treatment bar chart");
    },
    async run(app, d) {
      const { page } = app;
      const section = page.locator("details.inspsec", { hasText: "Style preset" }).first();
      const presetCard = (name) => section.locator(".presetcard", { hasText: name }).first();
      const toStyleTab = async () => {
        await d.click(page.locator("svg.gfx-figure").first(), { at: { x: 0.03, y: 0.03 } });
        await d.click(page.locator(".inspcats button", { hasText: /^Style$/ }));
        await app.openSections(/Style preset/);
      };
      await d.card("Style presets", "A whole look in one click — then make it yours and share it", "MadY · video 3", { logo: LOGO, say: "Style presets." });
      await d.wait(2600);
      await d.card(null);

      await d.caption("Graph ▸ Inspector ▸ Style", "The presets are the first thing on the Style tab", 1, "The presets are the first thing on the Style tab of the Inspector.");
      await toStyleTab();
      await d.wait(600);

      // The looks change one after another under the Style-tab caption, without words of their own.
      for (const name of ["Scientific Journal", "Bold infographic", "Editorial", "Grayscale (print)", "Universal design"]) {
        await d.click(presetCard(name));
        await d.wait(1500);
      }
      await d.click(presetCard("Editorial"));
      await d.wait(800);

      await d.caption("Save the look as your own", "Name it and press Save — every setting on this graph is kept", 2, "Save the look as your own. Every setting on this graph is kept.");
      const nameBox = section.locator('input[aria-label="Preset name"]');
      await d.click(nameBox);
      await d.type("Our lab style", 55);
      await d.click(section.locator("button", { hasText: /^Save$/ }).first());
      await d.wait(900);
      await section.locator(".presetcard", { hasText: "Our lab style" }).first().scrollIntoViewIfNeeded();
      await d.caption("★ makes it the default", "Every new graph starts with this look", 3, "The star makes it the default for every new graph.");
      await d.click(section.locator(".presetcard", { hasText: "Our lab style" }).first().locator("xpath=following-sibling::*[contains(@class,'pc-star')][1]"));
      await d.wait(1100);

      await d.caption("Use it on any graph", "Open another graph, one click", 4, "Use it on any graph, with one click.");
      await d.click(navRow(page, "Dose-response"));
      await page.waitForSelector("svg.gfx-figure");
      await toStyleTab();
      await d.click(presetCard("Our lab style"));
      await d.wait(1600);

      await d.caption("Manage your presets", "Reorder, rename, duplicate, or export one as a file to hand on", 5, "Manage your presets: reorder, rename, duplicate, or export one to share.");
      await d.click(page.locator('[aria-label="Manage presets"]'));
      await d.wait(700);
      await d.click(page.locator('[aria-label="More actions for Our lab style"]'));
      await d.wait(500);
      await d.click(page.locator('[aria-label="Export Our lab style"]'));
      await d.wait(900);

      await d.caption("Import one from a colleague", "Their preset arrives next to yours", 6, "Import one from a colleague, or just share yours.");
      await d.click(section.locator("button", { hasText: /^Import preset…$/ }).first());
      await d.wait(900);
      await section.locator(".presetcard", { hasText: "Shared lab style" }).first().scrollIntoViewIfNeeded().catch(() => {});
      await d.show(section.locator(".presetcard", { hasText: "Shared lab style" }).first(), 1800);
      await d.caption("");
      await d.card("That is a house style", "Next: a multi-panel figure", "MadY", { logo: LOGO, say: "That's a house style. Next: a multi-panel figure." });
      await d.wait(2400);
    },
  },

  // ───────────────────────────── 4 · a multi-panel figure ─────────────────────────────
  {
    file: "video-figure.webm",
    engine: true,
    async setup(app) {
      await widenTree(app);
      await app.expandTree();
    },
    async run(app, d) {
      const { page } = app;
      const pick = (name) => page.locator(".laycard", { has: page.locator(".laycard-name", { hasText: new RegExp(`^${name}$`) }) }).first();
      const pickSelect = async (optionValue, value) => {
        const s = page.locator("select", { has: page.locator(`option[value="${optionValue}"]`) }).first();
        await d.click(s, { act: () => s.selectOption(value).then(() => {}) });
      };
      await d.card("Assemble a figure", "Several graphs, one aligned multi-panel figure", "MadY · video 4", { logo: LOGO, say: "Assembling a figure." });
      await d.wait(2600);
      await d.card(null);

      await d.caption("Insert ▸ New layout", "", 1, "Choose Insert, then New layout.");
      await d.click(page.locator(".menubar .menu", { hasText: /^Insert$/ }));
      await d.click(menuItem(page, /^New layout/));
      await page.waitForSelector(".laycard");
      await d.caption("Tick the graphs to put in the figure", "Any graphs in the project, in the order you tick them", 2, "Tick the graphs to put in the figure, in the order you want them.");
      for (const n of ["Dose-response", "Treatment bar chart", "Dose-group violin", "Quarterly lollipop"]) {
        await d.click(pick(n));
        await d.wait(250);
      }
      await d.click(page.locator("button", { hasText: /Build \/ Arrange/ }).first());
      await page.waitForSelector(".laypanel");
      await d.wait(1400);

      await d.caption("Align all", "Axes line up across the panels, and every graph fills its card", 3, "Align all lines up the axes across the panels.");
      await d.click(page.locator(".layribbon button", { hasText: /^Align all$/ }).first());
      await d.moveTo(1400, 960);
      await d.wait(1800);

      await d.caption("Re-lay it in one step", "One row of four for a slide, two by two for a page", 4, "Re-lay it in one step: one row for a slide, two by two for a page.");
      await pickSelect("auto", "4");
      await d.wait(1700);
      await pickSelect("auto", "2");
      await d.wait(1500);

      await d.caption("Panel letters, your way", "A B C, a b c, 1 2 3 — their font, size and colour on the right", 5, "Panel letters, your way: capitals, small letters, or numbers.");
      await pickSelect("upper", "lower");
      await d.wait(1300);
      await pickSelect("upper", "upper");
      await d.wait(900);

      await d.caption("Zoom in to check the detail", "", 6, "Zoom in to check the detail.");
      const zoom = page.locator('input[aria-label="Canvas zoom"]');
      const setZoom = (v) =>
        zoom.evaluate((el, v) => {
          const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
          set.call(el, String(v));
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }, v);
      await d.click(zoom, { act: async () => {
        for (const v of [1.1, 1.2, 1.3, 1.4, 1.5]) {
          await setZoom(v);
          await d.wait(90);
        }
      } });
      // Rest the pointer on the empty ribbon, not on a panel — a panel under the pointer shows
      // its own hover buttons, which would read as part of the figure.
      await d.moveTo(1450, 270);
      await d.wait(1600);
      await d.click(zoom, { act: () => setZoom(1) });
      await d.wait(900);

      await d.caption("Linked to the graphs it came from", "Edit a graph and its panel follows", 7, "The figure stays linked to its graphs. Edit a graph, and its panel follows.");
      await d.show(page.locator("text=Linked to sources").first(), 1800);
      await d.caption("Export the whole figure", "One PDF, SVG, PNG or TIFF at the journal's page width", 8, "Export the whole figure at the journal's page width.");
      await d.show(page.locator("button", { hasText: /^\s*Export\s*$/ }).first(), 1800);
      await d.caption("");
      await d.card("That is a figure", "Made in MadY — local, offline, yours", "MadY", { logo: LOGO, say: "That's a figure. Local, offline, and yours." });
      await d.wait(2400);
    },
  },
];
