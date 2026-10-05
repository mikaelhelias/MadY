/**
 * What the manual's snapshots show — one entry per picture.
 *
 * `gen-guide-shots.mjs` runs this list against the built bundle; `guide-shots-driver.mjs` holds
 * the helpers that know how to work the app. Adding a picture is adding an entry here.
 *
 * Each entry:
 *   file      the PNG under `apps/desktop/src/renderer/src/assets/guide/`. A `shot` block in
 *             `guide.ts` must name it — `guide-shots.test.ts` is default-deny both ways.
 *   viewport  [w, h] before the setup runs. Defaults to 1500 × 950.
 *   setup     async (app) => void — drive the app to the state worth photographing.
 *   capture   "page" · "figure" (the graph plus a 10 px margin, so the grips are not sliced
 *             in half) · (app) => Locator · { clip: async (app) => rect }.
 *   marks     the numbered call-outs: [{ target, label }]. `target` forms are documented on
 *             `resolveTarget`. A target that resolves to nothing fails the run.
 *
 * A mark's label is what the manual prints beside the number, so it must be the name the
 * reader sees on the control — not a description of it, and not a selector.
 */

/** Open the Style tab of the Inspector on the graph in front (it mounts only once something
 *  in the figure is targeted; the plot background is the graph-level target). */
async function openStyleTab(app) {
  await app.page.locator("svg.gfx-figure").click({ position: { x: 60, y: 20 } });
  await app.settle();
  await app.page.locator(".inspcats button", { hasText: /^Style$/ }).click();
  await app.settle();
  await app.openSections(/Style preset/);
}

/** The real engine's answers for the demo project's analyses — see `record-guide-engine.mjs`.
 *  A browser has no Python sidecar, so this is the only way a result can be photographed. */
import ENGINE from "./guide-shots-engine.json" with { type: "json" };

/**
 * Axis tab helpers — used by the seven how-to captures at the foot of this file.
 *
 * The Axis panel only exists once something in the figure is targeted, and its thirteen groups
 * are all `<details>`, so a capture is only useful when the right ones are open and the rest are
 * shut. `onlyAxisGroups` is the difference between a legible 600 × 700 panel and a 600 × 2200
 * sliver that renders 64px tall in the manual.
 */

/** Open the Inspector's Axis tab on `axis` ("x" by default) of the graph in front. */
/**
 * A user preset with two types, managed: saved from the bar chart (its bar settings ride
 * along), the heatmap's own settings added from the heatmap, then Manage… pressed. What the
 * management pictures photograph.
 */
async function seedManagedPreset(app) {
  await app.boot();
  await app.openGraph("Treatment bar chart");
  await openStyleTab(app);
  await app.viewport(1500, 2600);
  await app.openSections(/Style preset/);
  await app.typeInto("Preset name", "Our lab style");
  await app.page.locator("details.inspsec", { hasText: "Style preset" }).locator("button", { hasText: /^Save$/ }).first().click();
  await app.settle();
  await app.openGraph("Gene expression heatmap");
  await openStyleTab(app);
  await app.openSections(/Style preset/);
  // The simple view hides the "+ type" row: press Manage… first, then add the heatmap's settings.
  await app.page.locator('[aria-label="Manage presets"]').click();
  await app.settle();
  const add = app.page.locator('[aria-label^="Add "][aria-label$=" settings to Our lab style"]');
  await add.waitFor({ timeout: 10000 });
  if (!(await add.isEnabled())) throw new Error("seedManagedPreset: the heatmap offers nothing to add — pick a graph whose type has its own settings");
  await add.scrollIntoViewIfNeeded();
  await add.click();
  await app.page.locator(".pc-mine .pc-kind.active").waitFor({ timeout: 10000 });
  await app.settle();
  await app.page.locator(".pc-mine").scrollIntoViewIfNeeded();
}

async function openAxisTab(app, axis = "x") {
  // The tab rail mounts only once something in the figure is targeted. The plot background is
  // the graph-level target on most kinds — but not on all of them: on the 3-D scatter a click
  // near the corner hits nothing at all and the Inspector never appears, which surfaces only as a
  // selector timeout with no reason given. So the corner is tried first and the middle second.
  const fig = app.page.locator("svg.gfx-figure").first();
  await fig.click({ position: { x: 60, y: 20 } });
  await app.settle();
  if ((await app.page.locator(".inspcats button").count()) === 0) {
    const box = await fig.boundingBox();
    await app.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await app.settle();
  }
  await app.page.locator(".inspcats button", { hasText: /^Axis$/ }).click();
  await app.settle();
  // Note: dismiss the assistant's suggestion card at the foot of the panel. It is real and
  // useful, but it is clutter in a picture of the Axis tab — it also changes with the graph, so
  // leaving it in would make two captures of the same panel differ for a reason the reader
  // cannot see.
  const x = app.page.locator('[aria-label="Dismiss suggestion"]');
  while ((await x.count()) > 0) {
    await x.first().click();
    await app.settle();
  }
  // The X / Y switcher inside the panel, so this does not depend on where an axis happens to be
  // drawn (a flipped chart puts the value axis along the bottom).
  const want = axis.toUpperCase();
  const btn = app.page.locator(".insp .frow button.btn-mini", { hasText: new RegExp(`^${want}$`) }).first();
  if ((await btn.count()) > 0) {
    await btn.click();
    await app.settle();
  }
}

/**
 * Open exactly these groups of the Axis panel and shut every other one.
 *
 * Note: the slug is the group's `id` minus `inspsub-`, and a title ending in a bracket keeps a
 * trailing dash — "Breaks (cuts)" is `breaks-cuts-`, because the closing bracket is a
 * non-alphanumeric run like any other. Passing the wrong spelling silently opens nothing, so
 * the helper refuses a name that matches no group rather than photographing a shut panel.
 */
async function onlyAxisGroups(app, slugs) {
  const missing = await app.page.evaluate((want) => {
    const ids = [...document.querySelectorAll("details.inspsub2")].map((d) => (d.id || "").replace(/^inspsub-/, ""));
    for (const d of document.querySelectorAll("details.inspsub2")) {
      d.open = want.includes((d.id || "").replace(/^inspsub-/, ""));
    }
    return want.filter((w) => !ids.includes(w));
  }, slugs);
  if (missing.length > 0) throw new Error(`onlyAxisGroups: no such group(s) in this panel: ${missing.join(", ")}`);
  await app.settle();
}

/** Click a button by its exact text, anywhere on the page. */
async function clickButton(app, text) {
  await app.page.locator("button", { hasText: text }).first().click();
  await app.settle();
}

/** Tick the checkbox on the row labelled `label` inside `within`. */
async function tickRow(app, within, label) {
  const ok = await app.page.evaluate(([sel, name]) => {
    const scope = document.querySelector(sel);
    if (!scope) return false;
    const row = [...scope.querySelectorAll("label.frow")].find((l) => (l.querySelector("span")?.textContent ?? "").trim() === name);
    const box = row?.querySelector('input[type="checkbox"]');
    if (!box || box.checked) return !!box;
    box.click();
    return true;
  }, [within, label]);
  if (!ok) throw new Error(`tickRow: no "${label}" checkbox inside ${within}`);
  await app.settle();
}

/**
 * Set "Group by" to the column named `name`.
 *
 * Note: its option values are column ids, which are generated — so the option is found by the text
 * a reader sees and its value read back off the DOM. Selecting by a hard-coded id would work
 * until the sample project was rebuilt and then silently select nothing.
 */
async function selectGroupColumn(app, name) {
  const ok = await app.page.evaluate((wanted) => {
    const sel = [...document.querySelectorAll("select")].find(
      (s) => (s.closest("label")?.textContent ?? "").includes("Group by"),
    );
    const opt = sel && [...sel.options].find((o) => o.textContent.trim() === wanted);
    if (!opt) return false;
    const set = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
    set.call(sel, opt.value);
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }, name);
  if (!ok) throw new Error(`selectGroupColumn: no "${name}" option under Group by`);
  await app.settle();
}

/** Type a group name into one Category groups ▸ By hand box, through React's own input event. */
async function typeGroupBox(app, category, group) {
  const ok = await app.page.evaluate(([cat, name]) => {
    const box = document.querySelector(`input[aria-label="Group for ${cat}"]`);
    if (!box) return false;
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    set.call(box, name);
    box.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }, [category, group]);
  if (!ok) throw new Error(`typeGroupBox: no By-hand box for "${category}" — is Group by set to By hand?`);
  await app.settle();
}

/** Open a chart from the gallery as a real, editable graph — the door a user uses. */
async function openGalleryChart(app, title) {
  await app.boot();
  await app.menu("Graph", /^Chart gallery/);
  await app.page.waitForSelector(".gallerycard", { timeout: 15000 });
  await app.settle();
  const ok = await app.page.evaluate((wanted) => {
    const card = [...document.querySelectorAll("button.gallerycard")].find((c) =>
      (c.querySelector("h4, .gallerycard-h, .gallerytitle")?.textContent ?? c.textContent ?? "").trim().startsWith(wanted),
    );
    if (!card) return false;
    const k = Object.keys(card).find((x) => x.startsWith("__reactProps"));
    card[k].onClick?.({ stopPropagation() {}, preventDefault() {} });
    return true;
  }, title);
  if (!ok) throw new Error(`openGalleryChart: no gallery card called "${title}"`);
  await app.page.waitForSelector("svg.gfx-figure", { timeout: 15000 });
  await app.settle();
}

/**
 * Capture the Axis panel cropped to its content, not to the window.
 *
 * `.insp` fills the viewport, so an element capture of it is as tall as the window — and a
 * 305 x 1150 picture hits the manual's 430px height cap and renders at 37%, which is a panel
 * nobody can read with call-out badges piled on top of each other. The viewport still has to be
 * tall enough for every control to exist on screen (a mark outside the picture fails the run);
 * this just stops the empty half of the panel being photographed with it.
 */
function panelClip() {
  return {
    async clip(app) {
      const r = await app.page.evaluate(() => {
        const insp = document.querySelector(".insp");
        const box = insp.getBoundingClientRect();
        let bottom = box.top;
        for (const e of insp.querySelectorAll("*")) {
          const b = e.getBoundingClientRect();
          if (b.height > 0 && b.width > 0) bottom = Math.max(bottom, b.bottom);
        }
        // Clamped to the viewport, both ways. A clip that runs past the window edge is
        // trimmed by the screenshot but not by the call-out maths, and a mark then measures
        // against a picture 4px wider than the one that shipped. (The Data tab exhibits this:
        // `.insp` is 304px wide against a 300px gap.)
        return {
          x: box.x,
          y: box.y,
          width: Math.min(box.width, window.innerWidth - box.x),
          height: Math.min(box.height, bottom - box.top + 10, window.innerHeight - box.y),
        };
      });
      return r;
    },
  };
}

/**
 * Widen (or narrow) a side dock by dragging its divider — the same gesture the manual tells the
 * reader to use, rather than reaching into the layout store behind the app's back.
 */
async function dragDockDivider(app, which, dx) {
  const d = app.page.locator(".dockdivider").nth(which);
  const b = await d.boundingBox();
  if (!b) throw new Error(`dragDockDivider: no divider ${which}`);
  const y = b.y + b.height / 2;
  await app.page.mouse.move(b.x + b.width / 2, y);
  await app.page.mouse.down();
  await app.page.mouse.move(b.x + b.width / 2 + dx, y, { steps: 8 });
  await app.page.mouse.up();
  await app.settle();
}

/** Capture the Navigator cropped to the rows that are actually open — `.nav` is as tall as the
 *  window, and photographing 500px of empty tree under the content is the same mistake
 *  `panelClip` exists to fix for the Inspector. */
function navClip() {
  return {
    async clip(app) {
      return app.page.evaluate(() => {
        const nav = document.querySelector(".nav");
        const box = nav.getBoundingClientRect();
        let bottom = box.top;
        for (const r of nav.querySelectorAll(".navrow, .search, .navtop")) {
          const b = r.getBoundingClientRect();
          if (b.height > 0) bottom = Math.max(bottom, b.bottom);
        }
        return { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, bottom - box.top + 12) };
      });
    },
  };
}

/**
 * Open a top menu and leave it open — the driver's own `menu()` clicks an item and closes it,
 * which is the opposite of what a picture of a menu needs.
 */
async function openTopMenu(app, name) {
  await app.page.locator(".menubar .menu", { hasText: new RegExp(`^${name}$`) }).click();
  await app.page.waitForSelector(".dropdown", { timeout: 10000 });
  await app.settle();
}

/**
 * Capture an open menu: the menu-bar word plus the list under it, and nothing else.
 *
 * Not `capture: "page"`. A 1400-px window around a 260-px menu renders in the manual at a
 * size where the item names are unreadable, which is the whole content of the picture. And not
 * the `.dropdown` alone either — without the highlighted word above it, a reader cannot tell
 * which menu they are looking at.
 */
function menuClip(name) {
  return {
    async clip(app) {
      return app.page.evaluate((n) => {
        const btn = [...document.querySelectorAll(".menubar .menu")].find((b) => (b.textContent ?? "").trim() === n);
        const drop = document.querySelector(".dropdown");
        if (!btn || !drop) throw new Error(`menuClip: the ${n} menu is not open`);
        const b = btn.getBoundingClientRect();
        const d = drop.getBoundingClientRect();
        const x = Math.max(0, Math.min(b.left, d.left) - 10);
        const y = Math.max(0, b.top - 6);
        const right = Math.min(window.innerWidth, Math.max(b.right, d.right) + 10);
        const bottom = Math.min(window.innerHeight, d.bottom + 10);
        return { x, y, width: right - x, height: bottom - y };
      }, name);
    },
  };
}

/** Open only the Inspector sections whose summary matches, and shut the rest — so a panel
 *  capture is the intended group rather than a 2000px sliver of everything. */
async function onlySections(app, re) {
  // Click the headings; do not set `open` on the <details>. MadY remembers which sections were
  // left open, so React owns that attribute and re-renders it back — a DOM-level `d.open = true`
  // looks like it worked and is gone by the time the shutter fires, leaving every control inside
  // measured at 0 × 0 and every call-out reporting "points at nothing".
  const summaries = app.page.locator("details.inspsec > summary");
  for (let i = 0; i < (await summaries.count()); i++) {
    const s = summaries.nth(i);
    const want = re.test((await s.textContent()) ?? "");
    const isOpen = await s.evaluate((el) => el.parentElement.open);
    if (want !== isOpen) {
      await s.click();
      await app.settle();
    }
  }
}

/** Open the Inspector tab named `name` on the graph in front (the rail mounts only once
 *  something in the figure is targeted, so the plot background is clicked first). */
async function openInspectorTab(app, name) {
  const fig = app.page.locator("svg.gfx-figure").first();
  await fig.click({ position: { x: 60, y: 20 } });
  await app.settle();
  await app.page.locator(".inspcats button", { hasText: new RegExp(`^${name}$`) }).click();
  await app.settle();
  await dismissNudge(app);
}

/** The Chart tab, the one every graph has. */
const openChartTab = (app) => openInspectorTab(app, "Chart");

/** Dismiss the assistant's suggestion card — real and useful, but clutter in a picture of a panel
 *  (it also changes with the graph, so two shots of one panel would differ for a reason the
 *  reader cannot see). */
/**
 * Crop the Inspector to the rows from one label to another — for a section whose new rows are the
 * point of the picture and sit in the middle of a long panel. Both ends are matched by their exact
 * text (a row's `<span>`, or a group caption), and the crop is clamped to the viewport.
 */
function rowsClip(fromText, toText) {
  return {
    async clip(app) {
      const r = await app.page.evaluate(([a, b]) => {
        const insp = document.querySelector(".insp");
        const find = (t) => [...insp.querySelectorAll(".frow > span, .inspsub, .inspgroup-h, summary, button, button.inspsub")].find((e) => (e.textContent ?? "").trim().replace(/^▾\s*/, "") === t); // a group heading carries its ▾
        const from = find(a), to = find(b);
        if (!from || !to) return { missing: [a, b].filter((_, i) => ![from, to][i]) };
        const box = insp.getBoundingClientRect();
        const rowOf = (e) => (e.closest(".frow") ?? e).getBoundingClientRect();
        const top = Math.max(0, rowOf(from).top - 4);
        const bottom = Math.min(window.innerHeight, rowOf(to).bottom + 10);
        return { x: Math.max(0, box.x), y: top, width: Math.min(box.width, window.innerWidth - Math.max(0, box.x)), height: bottom - top };
      }, [fromText, toText]);
      if (r.missing) throw new Error(`rowsClip: no row called ${r.missing.map((m) => `"${m}"`).join(" or ")}`);
      return r;
    },
  };
}

async function dismissNudge(app) {
  const x = app.page.locator('[aria-label="Dismiss suggestion"]');
  while ((await x.count()) > 0) {
    await x.first().click();
    await app.settle();
  }
}

/** The bar, its chip and its popover in one clip, with a margin. */
async function modelBarClip(app) {
  return app.page.evaluate(() => {
    const els = [".modelbtn", ".modelbar", ".modelbar-pop"].map((s) => document.querySelector(s)).filter(Boolean);
    const rs = els.map((e) => e.getBoundingClientRect());
    const x0 = Math.min(...rs.map((r) => r.left)) - 12;
    const y0 = Math.min(...rs.map((r) => r.top)) - 12;
    const x1 = Math.max(...rs.map((r) => r.right)) + 12;
    const y1 = Math.max(...rs.map((r) => r.bottom)) + 12;
    return { x: Math.max(0, x0), y: Math.max(0, y0), width: Math.min(innerWidth, x1) - Math.max(0, x0), height: y1 - Math.max(0, y0) };
  });
}

export const SHOTS = [
  // ─────────────────────────── the window, marked ───────────────────────────
  {
    file: "the-window.png",
    async setup(app) {
      await app.boot();
      await app.openGraph("Dose-response");
      // The Inspector's tab rail exists only once something in the figure is targeted — a
      // whole-window picture with an empty right-hand panel teaches the wrong thing about
      // where the controls live. The plot background is the graph-level target.
      await app.page.locator("svg.gfx-figure").click({ position: { x: 60, y: 20 } });
      await app.settle();
      await app.page.locator("svg.gfx-figure").press("Escape"); // no selection handles in a manual shot
      await app.settle();
    },
    capture: "page",
    marks: [
      { target: ".menubar", label: "Menu bar" },
      { target: ".toolbar", label: "Toolbar" },
      { target: ".nav", label: "Navigator — every project, datasheet, graph and analysis" },
      { target: ".tabs", label: "Tabs — what you have open" },
      { target: "svg.gfx-figure", label: "The figure" },
      { target: ".inspcats", label: "Inspector tabs — Chart · Frame · Axis · Data · Text · Annotate · Style" },
      { target: ".zoomctl", label: "Zoom" },
    ],
  },

  // ─────────────────────────── the spreadsheet, marked ───────────────────────────
  {
    file: "data-table.png",
    async setup(app) {
      await app.boot();
      await app.openNode("Sample — dose vs response", "table.dg");
    },
    capture: "page",
    marks: [
      { target: '[aria-label="Table format"]', label: "Table format — what this sheet's shape is, and what it unlocks" },
      { target: ".railbtn", label: "Column — add one" },
      { target: ".dggrouphead", label: "A dataset (one Y group)" },
      { target: ".dgx", label: "The X column" },
      { target: ".dgrownum", label: "Row numbers — right-click for row commands" },
    ],
  },

  // ─────────────────────────── the export dialog, marked ───────────────────────────
  {
    file: "export-dialog.png",
    viewport: [1500, 1500],
    async setup(app) {
      await app.boot();
      await app.openGraph("Dose-response");
      await app.menu("File", /^Export…/);
      await app.page.waitForSelector('[role="dialog"], .modal', { timeout: 10000 });
      await app.settle();
    },
    capture: (app) => app.page.locator('[role="dialog"], .modal').first(),
    marks: [
      { target: '[aria-label="Format"]', label: "Format — PNG, SVG, PDF, TIFF, JPEG, EPS or HTML" },
      { target: ".expsize", label: "The size the file will be" },
      { target: ".exportbg", label: "Background — including transparent" },
    ],
  },

  // ─────────────────────────── the Analyze chooser, marked ───────────────────────────
  {
    file: "analyze-dialog.png",
    viewport: [1500, 1500],
    async setup(app) {
      await app.boot();
      await app.openNode("Sample — dose vs response", "table.dg");
      await app.menu("Analyze", /^Analyze…/);
      await app.page.waitForSelector('[role="dialog"], .modal', { timeout: 10000 });
      await app.settle();
    },
    capture: (app) => app.page.locator('[role="dialog"], .modal').first(),
    // Note: these are the landing page's controls, which is what the picture shows. The search
    // box and the grouped catalogue live behind "Browse all analyses" (`showCatalog`) and are
    // not on screen here — marking them would draw a box over nothing, which the capture
    // refuses to write.
    marks: [
      { target: ".an-recs", label: "Recommended for your data — what suits the sheet you opened this from" },
      { target: ".an-goals", label: "What do you want to do — the goal tiles" },
      { target: ".an-guided-actions", label: "Browse all analyses — the full catalogue, grouped and searchable" },
    ],
  },

  // ─────────────────────── the catalogue behind the landing page ───────────────────────
  {
    // The other half of the Analyze dialog. The landing page's own picture cannot show these —
    // the search box and the grouped list only exist once "Browse all analyses" is pressed
    // (`showCatalog`), which is why the capture refuses to mark them on that shot.
    file: "analyze-catalogue.png",
    viewport: [1500, 1500],
    async setup(app) {
      await app.boot();
      await app.openNode("Sample — dose vs response", "table.dg");
      await app.menu("Analyze", /^Analyze…/);
      await app.page.waitForSelector('[role="dialog"], .modal', { timeout: 10000 });
      await app.settle();
      await app.page.locator("button", { hasText: /^Browse all analyses$/ }).click();
      await app.page.waitForSelector(".an-catalog-search", { timeout: 10000 });
      await app.settle();
    },
    capture: (app) => app.page.locator('[role="dialog"], .modal').first(),
    marks: [
      { target: ".an-catalog-search", label: "Search every method by name" },
      { target: '[aria-label="Choose by data type"]', label: "Narrow the list to the methods that suit one shape of data" },
      { target: ".an-list", label: "Every method, in the same eight groups this manual uses" },
      { target: { text: "Back to guidance" }, label: "Back to guidance — the recommendations and the goal tiles" },
    ],
  },

  // ─────────────────────────── a result, marked ───────────────────────────
  {
    // The numbers here are the real engine's, recorded by `record-guide-engine.mjs` and
    // replayed through the preload bridge — a browser has no Python sidecar, and a manual
    // showing an empty "Re-run" pane would teach the wrong thing about what a result looks like.
    file: "analysis-result.png",
    // Tall enough for the Beta notice at the foot of the result and no taller: this is a
    // whole-page capture, and a viewport with 400 px of empty canvas under the content renders
    // as a picture that is mostly nothing.
    viewport: [1500, 900],
    async setup(app) {
      await app.bootWithEngine(ENGINE.answers);
      await app.openNode("ANOVA — Vehicle, Low dose, High dose", ".ankey");
      await app.settle();
    },
    capture: "page",
    marks: [
      { target: ".valbadge", label: "How this number was validated — hover for the basis, click to copy it" },
      { target: ".antoolbar", label: "Re-run · Save as Method · Copy · CSV · Excel · Methods text · Add to graph" },
      { target: ".anbind", label: "Put this analysis's significant comparisons on the graph, and keep them in step" },
      { target: ".ankey-cards", label: "Key result — the numbers a paper would quote" },
      { target: ".ankey-verdict", label: "What the numbers decide, in one line" },
    ],
  },

  // ─────────────────────────── the Inspector, marked ───────────────────────────
  {
    file: "inspector-series.png",
    async setup(app) {
      await app.boot();
      await app.openGraph("Dose-response");
      // `force`: series glyphs legitimately overlap (see e2e/app.ts).
      await app.page.locator('svg.gfx-figure .gfx-series [style*="cursor: pointer"]').first().click({ force: true });
      await app.settle();
      await app.viewport(1500, 1500);
      await app.page.evaluate(() => {
        [...document.querySelectorAll("details.inspsec")].slice(0, 2).forEach((d) => {
          d.open = true;
        });
      });
      await app.settle();
    },
    capture: (app) => app.page.locator(".insp"),
    marks: [
      { target: ".inspcats", label: "The seven tabs — everything about the graph is under one of them" },
      { target: ".inspfilter", label: "Filter the controls by name" },
    ],
  },

  // ─────────────────────────── the chart gallery, marked ───────────────────────────
  {
    file: "chart-gallery.png",
    viewport: [1500, 1400],
    async setup(app) {
      await app.boot();
      await app.menu("Graph", /^Chart gallery/);
      await app.page.waitForSelector(".gallerycard", { timeout: 15000 });
      await app.settle();
    },
    capture: "page",
    marks: [
      { target: ".gallerybar", label: "Palette, colour ramp, line width, marker size and font — each applied to every card" },
      { target: { nth: 0, of: ".gallerysection-h" }, label: "The families — charts grouped by what they are for" },
      { target: { nth: 0, of: ".gallerycard" }, label: "A card — click it to open that chart as a real, editable graph" },
    ],
  },

  // ─────────────────────────── getting data in ───────────────────────────
  {
    // The import preview is the real datasheet grid over a throwaway copy, so the picture has
    // to show both the options and the grid — that is the point being made about it.
    file: "import-dialog.png",
    viewport: [1500, 1150],
    async setup(app) {
      await app.boot();
      await app.importSample();
      // Note: set the options explicitly rather than leaving them on auto. The sample is a
      // semicolon file with a comma decimal, a comment line above the table and a units row under
      // the header — auto-detect reads it as comma-separated and the preview comes out split at
      // every decimal mark. A manual showing that suggests the importer is broken; showing the
      // four controls that fix it is the whole point of the picture.
      await app.selectValue("Delimiter", ";");
      await app.selectValue("Decimal separator", ",");
      await app.selectValue("Comment marker", "#");
      await app.page.locator('input[type="checkbox"]').nth(1).check(); // Second row is units
      await app.settle();
    },
    capture: (app) => app.page.locator(".modal-import"),
    marks: [
      { target: '[aria-label="Delimiter"]', label: "Delimiter — detected for you, or set it when the file is unusual" },
      { target: '[aria-label="Decimal separator"]', label: "Decimal mark — a point or a comma" },
      { target: '[aria-label="Comment marker"]', label: "Comment marker — drop the instrument's notes above and between the rows" },
      { target: { text: "Second row is units" }, label: "Fold a units row into the names — “Time” over “s” becomes “Time (s)”" },
      { target: '[aria-label="Destination"]', label: "Destination — a new datasheet, or appended to one you already have" },
      { target: ".importgrid", label: "The preview is the datasheet grid — rename, reorder, retype and exclude here, before anything is created" },
    ],
  },
  {
    // The creator, opened data-first: the shape of your data on the left, the graphs it supports
    // on the right, and what the sample would look like.
    file: "new-datasheet-dialog.png",
    viewport: [1500, 1250],
    async setup(app) {
      await app.boot();
      await app.menu("File", /^New datasheet \/ graph…/);
      await app.page.waitForSelector(".ng-seg", { timeout: 10000 });
      await app.settle();
      // Pick a graph type and turn on sample data: the preview only exists once there is a
      // scene to draw, and an empty right-hand half teaches the wrong thing about the dialog.
      await app.page.locator('[aria-label="Graph types"] button').first().click();
      await app.settle();
      await app.page.locator('[aria-label="Start with sample data"]').check();
      await app.settle();
    },
    capture: (app) => app.page.locator('[aria-label="New graph"]').first(),
    marks: [
      { target: ".ng-seg", label: "What to create — a datasheet, a graph, or both" },
      { target: '[aria-label="Data types"]', label: "Filter by the shape your data is in" },
      { target: '[aria-label="Search graph types"]', label: "Search the graph types by name" },
      { target: '[aria-label="Graph types"]', label: "Every graph the chosen shape can draw" },
      { target: ".ng-config", label: "The new sheet's settings — format, X type, sample data, entry mode, replicates, error bars, and where to file it" },
      { target: ".ng-preview", label: "What it would look like, drawn from sample data" },
    ],
  },

  // ─────────────────── the datasheet's right-click menus ───────────────────
  {
    file: "datasheet-cell-menu.png",
    async setup(app) {
      await app.boot();
      await app.openNode("Sample — dose vs response", "table.dg");
      await app.selectBlock(2, 1, 4, 2);
      await app.rightClick("table.dg td.dgcell", 14);
    },
    capture: (app) => app.page.locator(".dgmenu").first(),
    marks: [
      { target: { text: "Paste transposed", within: ".dgmenu" }, label: "Paste with the rows and columns swapped" },
      { target: { text: "Exclude value", within: ".dgmenu" }, label: "Exclude — the values stay in the sheet and stop feeding graphs and statistics" },
    ],
  },
  {
    file: "datasheet-column-menu.png",
    async setup(app) {
      await app.boot();
      await app.openNode("Sample — dose vs response", "table.dg");
      // Note: the Y column's own header, not `th.dghead` — the ones after the first are `sparehead`,
      // the empty columns at the right of the grid, and they carry no menu at all.
      await app.rightClick("table.dg th.dggrouphead", 0, { select: false });
    },
    capture: (app) => app.page.locator(".dgmenu").first(),
    marks: [
      { target: { text: "Sort ascending", within: ".dgmenu" }, label: "Sort every row by this column" },
      { target: { text: "Insert column left", within: ".dgmenu" }, label: "Add or remove a column here" },
      // Note: targeted by its aria-label. The visible affordance is the "ƒ(x)" box; the words
      // "Column formula" are not on screen anywhere, so matching on them finds nothing.
      { target: '[aria-label="Column formula"]', label: "ƒ(x) — compute this column from the others" },
    ],
  },
  {
    file: "datasheet-row-menu.png",
    async setup(app) {
      await app.boot();
      await app.openNode("Sample — dose vs response", "table.dg");
      await app.rightClick("table.dg td.dgrh", 2, { select: false });
    },
    capture: (app) => app.page.locator(".dgmenu").first(),
    marks: [{ target: { text: "Insert row above", within: ".dgmenu" }, label: "Add or remove a row here" }],
  },

  // ─────────────────── the Data menu, open ───────────────────
  {
    file: "data-menu.png",
    async setup(app) {
      await app.boot();
      await app.openNode("Sample — dose vs response", "table.dg");
      await app.page.locator(".menubar .menu", { hasText: /^Data$/ }).click();
      await app.page.waitForSelector(".dropdown", { timeout: 10000 });
      await app.settle();
    },
    capture: (app) => app.page.locator(".dropdown").first(),
    marks: [
      { target: { text: "Transform values…", within: ".dropdown" }, label: "Functions of the values — logs, powers, z-scores, ranks and the rest" },
      { target: { text: "Reshape data (wide ↔ long)…", within: ".dropdown" }, label: "Pivot between one column per group and one row per observation" },
    ],
  },

  // ─────────────────────────── the graph toolbar ───────────────────────────
  {
    // The strip above a graph, marked group by group. It is the surface people use most, so
    // each of its control groups gets its own call-out.
    file: "graph-ribbon.png",
    viewport: [1700, 950],
    async setup(app) {
      await app.boot();
      await app.openGraph("Treatment bar chart");
      await app.page.locator("svg.gfx-figure").click({ position: { x: 60, y: 20 } });
      await app.settle();
      await app.page.locator("svg.gfx-figure").press("Escape");
      await app.settle();
    },
    capture: (app) => app.page.locator(".graphribbon"),
    marks: [
      { target: '[aria-label="View"]', label: "View — gridlines, minor lines, wheel zoom, the ruler, and the legend on or off" },
      { target: '[aria-label="Summary"]', label: "Bar values and replicate points, on this chart's own terms" },
      { target: '[aria-label="Scale"]', label: "X log · Y log — a base-10 axis in one click" },
      { target: '[aria-label="Frame"]', label: "The lines around the plot: an L, a box, offset axes, or none" },
      { target: '[aria-label="Insert"]', label: "Text, shapes, arrows and images onto the graph" },
      { target: '[aria-label="Text"]', label: "Pick which text you mean, then its font, size, bold, italic and symbols" },
      { target: { text: "Datasheet", within: ".graphribbon" }, label: "Back to the data this graph is drawn from" },
    ],
  },

  // ─────────────────────────── the Axis tab ───────────────────────────

  // ─────────────────── further captures, without call-out marks ───────────────────
  {
    file: "style-preset-cards.png",
    async setup(app) {
      await app.boot();
      await app.openGraph("Dose-response");
      await openStyleTab(app);
      // The Style sections are taller than the Inspector's scrollport; an element shot of a
      // partly-scrolled-out element captures whatever chrome overlaps its box (the first preset
      // cards would be cut and the app header would show through). A tall viewport lets the
      // whole section exist on screen at once.
      await app.viewport(1500, 2600);
      await app.openSections(/Style preset/);
      // A custom preset in the list is half the story ("· yours", its ★ and ⨯) — save one
      // first, exactly as a user would.
      await app.typeInto("Preset name", "Our lab style");
      await app.page.locator("details.inspsec", { hasText: "Style preset" }).locator("button", { hasText: /^Save$/ }).first().click();
      await app.settle();
      await app.page.locator("details.inspsec", { hasText: "Style preset" }).first().scrollIntoViewIfNeeded();
    },
    capture: (app) => app.page.locator("details.inspsec", { hasText: "Style preset" }).first(),
  },
  // ─────────────────── managing your presets ───────────────────
  // One preset of your own saved from the bar chart, then a second type added from the heatmap —
  // so the card has a type to show, a type to add, and a chip with something to unfold.
  {
    file: "style-preset-manage.png",
    async setup(app) {
      await seedManagedPreset(app);
    },
    capture: (app) => app.page.locator(".pc-mine"),
    marks: [
      { target: '[aria-label="Manage presets"]', label: "Manage… shows these controls; Done puts the simple view back" },
      { target: '[aria-label="Move Our lab style"]', label: "Drag to order the list, or press ↑ / ↓" },
      { target: { nth: 0, of: ".pc-mine .pc-kind.active, .pc-mine .pc-add" }, label: "The open graph's type — ✓ saved in this preset, or + to add it" },
      { target: '[aria-label="Show the types in Our lab style"]', label: "How many other types it holds — click to list them" },
      { target: '[aria-label="More actions for Our lab style"]', label: "Rename, Duplicate, Types…, Export…, Delete" },
    ],
  },
  {
    file: "style-preset-types.png",
    async setup(app) {
      await seedManagedPreset(app);
      await app.page.locator('[aria-label="Show the types in Our lab style"]').click();
      await app.settle();
    },
    capture: (app) => app.page.locator(".pc-mine"),
    marks: [
      { target: '[aria-label="Types in Our lab style"]', label: "Every type this preset carries its own settings for" },
      { target: { nth: 0, of: '[aria-label^="Remove "]' }, label: "✕ drops that type's settings — the shared look and the other types stay" },
    ],
  },
  {
    file: "style-preset-menu.png",
    async setup(app) {
      await seedManagedPreset(app);
      await app.page.locator('[aria-label="More actions for Our lab style"]').click();
      await app.settle();
    },
    // The menu floats below the card's box (it is positioned, not laid out), so an element
    // capture of the cards would cut it off: clip the cards plus the menu's own height.
    capture: {
      async clip(app) {
        const box = await app.page.locator(".pc-mine").boundingBox();
        const menu = await app.page.locator('[role="menu"]').boundingBox();
        const bottom = Math.max(box.y + box.height, menu.y + menu.height) + 8;
        return { x: box.x - 4, y: box.y - 4, width: box.width + 8, height: bottom - box.y + 4 };
      },
    },
    marks: [
      { target: '[aria-label="Rename Our lab style"]', label: "Rename: the name becomes a box — Enter keeps it, Esc leaves it" },
      { target: '[aria-label="Duplicate Our lab style"]', label: "Duplicate: a copy right beside it, named “… copy”" },
      { target: '[aria-label="Export Our lab style"]', label: "Export…: this one preset as a file to hand to someone" },
      { target: '[aria-label="Delete Our lab style"]', label: "Delete the preset" },
    ],
  },
  {
    file: "settings-presets.png",
    async setup(app) {
      await app.boot();
      await app.openGraph("Treatment bar chart");
      await openStyleTab(app);
      await app.viewport(1500, 2600);
      await app.openSections(/Style preset/);
      await app.typeInto("Preset name", "Our lab style");
      await app.page.locator("details.inspsec", { hasText: "Style preset" }).locator("button", { hasText: /^Save$/ }).first().click();
      await app.settle();
      await app.viewport(1500, 1100);
      await app.menu("View", /^Settings/);
      await app.page.waitForSelector('[role="dialog"], .modal', { timeout: 10000 });
      await app.settle();
      await app.page.evaluate(() => {
        const scroll = document.querySelector(".set-scroll");
        const head = [...scroll.querySelectorAll(".an-group-h")].find((h) => /My saved presets/.test(h.textContent ?? ""));
        scroll.scrollTop += head.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 6;
      });
      await app.settle();
    },
    // From the My saved presets heading to the foot of Back up & transfer — the rest of the
    // dialog has its own pictures.
    capture: {
      async clip(app) {
        const body = await app.page.locator(".set-scroll").boundingBox();
        const head = await app.page.locator(".an-group-h", { hasText: "My saved presets" }).boundingBox();
        const last = await app.page.locator('[aria-label="Import a style library"]').boundingBox();
        return { x: body.x, y: head.y - 6, width: body.width, height: last.y + last.height + 12 - (head.y - 6) };
      },
    },
    marks: [
      { target: '[aria-label="Rename Our lab style"]', label: "Rename here, in the box" },
      { target: '[aria-label="Show the types in Our lab style"]', label: "The types it holds — click to list them, with a ✕ each" },
      { target: '[aria-label="More actions for Our lab style"]', label: "Duplicate, Types…, Export…, Delete" },
      { target: '[aria-label="Import a preset file"]', label: "Bring in a preset someone exported — it gets a fresh id, a clashing name gets “ (2)”" },
    ],
  },
  {
    // The save half on its own, page-friendly: saving a user preset has to be clearly visible in
    // the manual, not buried at the foot of a tall capture. Clip from the save box to the section's
    // end — the name field + Save, ★ Set this graph as the default, the "new graphs start from"
    // line, and Back up & transfer.
    file: "style-preset-save.png",
    viewport: [1500, 2600],
    async setup(app) {
      await app.boot();
      await app.openGraph("Dose-response");
      await openStyleTab(app);
      await app.viewport(1500, 2600);
      await app.openSections(/Style preset/);
      await app.typeInto("Preset name", "Our lab style");
      await app.page.locator("details.inspsec", { hasText: "Style preset" }).locator("button", { hasText: /^Save$/ }).first().click();
      await app.settle();
    },
    capture: {
      clip: (app) =>
        app.page.evaluate(() => {
          const sec = [...document.querySelectorAll("details.inspsec")].find((d) =>
            /Style preset/.test(d.querySelector("summary")?.textContent ?? ""),
          );
          const head = [...sec.querySelectorAll(".inspsub")].find((h) =>
            /Save this graph as a preset/i.test(h.textContent ?? ""),
          );
          const s = sec.getBoundingClientRect();
          const h = head.getBoundingClientRect();
          return { x: s.x, y: h.y - 6, width: s.width, height: s.bottom - h.y + 6 };
        }),
    },
  },
  {
    file: "apply-look-dialog.png",
    async setup(app) {
      await app.boot();
      await app.openGraph("Dose-response");
      await app.menu("Graph", /^Apply this look to other graphs/);
      await app.page.waitForSelector(".modal-applylook", { timeout: 10000 });
      await app.settle();
    },
    capture: (app) => app.page.locator(".modal-applylook"),
  },
  {
    file: "settings-defaults.png",
    async setup(app) {
      await app.boot();
      await app.menu("View", /^Settings/);
      await app.page.waitForSelector('[role="dialog"], .modal', { timeout: 10000 });
      await app.settle();
    },
    capture: (app) => app.page.locator('[role="dialog"], .modal').first(),
    marks: [
      { target: '[aria-label="Global default preset"]', label: "The look every new graph starts from" },
      { target: { text: "Favourite style per graph type" }, label: "A different default per chart type" },
      { target: '[aria-label="Colour palette"]', label: "Common defaults layered on the preset — blank means “use the preset's”" },
    ],
  },
  {
    // The other half of the same dialog — the rows that are not about how graphs look. Two of
    // them (Date entry format, Missing values) are documented only in this chapter, and the
    // style-defaults capture stops above them.
    file: "settings-application.png",
    async setup(app) {
      await app.boot();
      await app.menu("View", /^Settings/);
      await app.page.waitForSelector('[role="dialog"], .modal', { timeout: 10000 });
      await app.settle();
      // The dialog's body is its own scrollport, capped at min(68vh, 620px) — it does not
      // grow with the viewport, so a taller window does not bring the lower rows into the
      // picture (the lower rows' call-outs would fall outside it). Scroll the body instead, so
      // this is a photograph of what a reader can actually put on screen.
      await app.page.evaluate(() => {
        const scroll = document.querySelector(".set-scroll");
        const head = [...scroll.querySelectorAll(".an-group-h")].find((h) => /New-graph defaults/.test(h.textContent ?? ""));
        scroll.scrollTop += head.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 6;
      });
      await app.settle();
    },
    capture: (app) => app.page.locator(".set-scroll"),
    marks: [
      { target: '[aria-label="Date entry format"]', label: "How an ambiguous typed date is read — 05/06 is 5 June or 6 May" },
      { target: '[aria-label="Default missing-value tokens"]', label: "Words every import should read as blank" },
      { target: '[aria-label="Round results tables"]', label: "Round results tables on screen only — exports keep full precision" },
    ],
  },

  // ────────────────────────────── the panel assembler ──────────────────────────────
  {
    file: "figure-choose-graphs.png",
    async setup(app) {
      await app.boot();
      await app.expandTree();
      await app.menu("Insert", /^New layout/);
      await app.page.waitForSelector(".laycard", { timeout: 10000 });
      await app.settle();
      await app.page.evaluate(() => {
        [...document.querySelectorAll(".laycard")].slice(0, 4).forEach((c) => c.click());
      });
      await app.settle();
    },
    capture: "page",
    marks: [
      { target: { nth: 0, of: ".laycard" }, label: "Every graph in the project, as a live thumbnail — tick the ones you want" },
      { target: { text: "Auto-scale on include" }, label: "Match each new panel to the first one's size, fonts, axes and colours as it comes in" },
      { target: { text: "Add image" }, label: "Add a micrograph, blot or schematic as a panel" },
    ],
  },
  {
    file: "figure-arrange-ribbon.png",
    async setup(app) {
      await buildFourPanelFigure(app);
      await openInspectorDock(app);
    },
    capture: (app) => app.page.locator(".layribbon"),
    // The figure toolbar has two rows — the call-outs point at the controls, one per job. The figure's own
    // settings (letters, panel content, shared axes, one legend) are in the Inspector, pictured in tut-figure-ribbon.png.
    marks: [
      { target: { text: "Columns", within: ".layribbon" }, label: "Layout ▾ · Columns · Gutter · Page — the figure's shape, its grid and its page" },
      { target: '.layribbon [title^="Show an alignment grid"]', label: "Grid · Snap to grid · Ruler · zoom — editing aids, never exported" },
      { target: { text: "Align all", within: ".layribbon" }, label: "Align all — axes and letters in one click; Align ▾ for each on its own, and equal sizes" },
      { target: '.layribbon button.laymenu-btn[title^="Shift-click"]', label: "Line up ▾ — edges, even spacing, same size or centre, for the panels you shift-clicked" },
      { target: '.layribbon [aria-label="Object tools"]', label: "Front · Back · lock · Group · Duplicate — for the picked panels" },
      { target: { text: "Insert", within: ".layribbon" }, label: "Insert ▾ — another graph, a picture, or a text / arrow / line / box / ellipse on the figure" },
      { target: { text: "Style", within: ".layribbon" }, label: "Style ▾ — match every panel to one, a style preset, or your house style" },
    ],
  },
  {
    // All four lettered panels must be inside the window — a figure cut mid-panel reads as a bug.
    file: "figure-arranged.png",
    async setup(app) {
      await buildFourPanelFigure(app);
      await openInspectorDock(app);
      await app.viewport(1500, 1560);
    },
    capture: "page",
  },

  // ─────────────────────────── annotations and significance ───────────────────────────
  {
    // A real graph carrying Design objects — added from the menu like a user, then placed where
    // they say something about the data.
    file: "annotations-on-graph.png",
    async setup(app) {
      await app.boot();
      await app.openGraph("Dose-response");
      await app.menu("Design", /^Text box$/);
      await app.menu("Design", /^Arrow$/);
      await app.menu("Design", /^Horizontal reference line$/);
      await app.menu("Design", /^Vertical band$/);
      await app.page.evaluate(`(() => { ${FIBER}
        const ops = __ops(); const a = __anns(); const n = a.length;
        ops.update(a[n - 4].id, { x: 0.04, y: 0.1, label: "Plateau above 30 µM", size: 13 });
        ops.update(a[n - 3].id, { x: 0.62, y: 0.6, x2: 0.5, y2: 0.47 });
        ops.update(a[n - 2].id, { value: 50, label: "Half-maximal response" });
      })()`);
      await app.settle();
      await app.page.locator("svg.gfx-figure").press("Escape"); // no selection handles in a manual shot
      await app.settle();
    },
    capture: "figure",
  },
  {
    // A blank bracket has no endpoints yet — the scene drops it with a warning until they are
    // set (that is the app's real flow: add, then pick the two groups in the Inspector).
    file: "significance-brackets.png",
    async setup(app) {
      await app.boot();
      await app.openGraph("Treatment bar chart");
      await app.menu("Design", /^Add a blank significance bracket$/);
      await app.menu("Design", /^Add a blank significance bracket$/);
      await app.page.evaluate(`(() => { ${FIBER}
        const ops = __ops(); const a = __anns(); const n = a.length;
        ops.update(a[n - 2].id, { from: 1, to: 2, p: 0.006 });
        ops.update(a[n - 1].id, { from: 1, to: 4, p: 0.0003 });
      })()`);
      await app.settle();
      await app.page.locator("svg.gfx-figure").press("Escape");
      await app.settle();
    },
    capture: "figure",
  },
  {
    // The thresholds ladder, from the Settings host (the wider of its two homes). Its text
    // buttons must not use the fixed 22px swatch class, or the ladder is clipped in both hosts;
    // this capture shows the full ladder.
    file: "significance-thresholds.png",
    async setup(app) {
      await app.boot();
      await app.menu("View", /^Settings/);
      await app.page.waitForSelector(".sigladder", { timeout: 10000 });
      await app.settle();
      await app.page.locator(".sigladder").first().scrollIntoViewIfNeeded();
    },
    capture: (app) => app.page.locator(".sigladder").first(),
    marks: [
      { target: '[aria-label="Symbol family: Asterisks"]', label: "Six ready-made symbol vocabularies" },
      { target: { nth: 0, of: ".sigladder-row" }, label: "A cut-off and the symbol it prints — edit either, add or remove rows" },
      { target: '[aria-label="Not-significant label"]', label: "What “not significant” prints, and whether it prints at all" },
    ],
  },
  {
    // The dose-response door's configure page — the model catalogue, the equation, and the
    // plain-language parameter notes. The engine is not required to draw it.
    file: "curvefit-configure.png",
    async setup(app) {
      await app.boot();
      await app.openNode("Sample — dose vs response", "table.dg");
      await app.menu("Analyze", /^Dose-response…/);
      await app.page.waitForSelector('[role="dialog"], .modal', { timeout: 10000 });
      await app.settle();
    },
    capture: (app) => app.page.locator('[role="dialog"], .modal').first(),
    marks: [
      { target: '[aria-label="Equation family"]', label: "The family — find your equation by what you are measuring" },
      { target: ".an-eqpreview", label: "The exact equation that will be fitted" },
      { target: '[aria-label="Weighting"]', label: "Weighting — when the scatter grows with Y" },
      { target: { text: "Make default" }, label: "Make default — remember these settings for this analysis" },
    ],
  },
  // ══════════════════════════ The worked examples' own pictures ══════════════════════════
  // Each walkthrough's steps get the button they name, marked. The reference chapters' shots
  // cannot be reused: `guide-shots.test` refuses two blocks sharing a file, because a
  // walkthrough's picture has to show the state at that step, not the same dialog framed for a
  // different chapter.
  {
    // Worked example 1, step 2 — the import preview over pasted text, with the two settings that fix a
    // European export and the button that commits it.
    file: "tut-paste-preview.png",
    viewport: [1500, 1150],
    async setup(app) {
      await app.boot();
      await app.page.evaluate(() => {
        window.mady = window.mady ?? {};
        window.mady.readClipboardText = () =>
          "Dose;Control;Treated\n0;1,4;1,6\n15;12,8;24,1\n30;25,3;48,7\n45;38,9;66,2\n60;47,1;79,5";
      });
      await app.menu("File", /^Paste data as new datasheet…/);
      await app.page.waitForSelector(".modal-import", { timeout: 10000 });
      await app.selectValue("Delimiter", ";");
      await app.selectValue("Decimal separator", ",");
      await app.settle();
    },
    capture: (app) => app.page.locator(".modal-import"),
    marks: [
      { target: '[aria-label="Delimiter"]', label: "Delimiter — set it until the columns split where you expect" },
      { target: '[aria-label="Decimal separator"]', label: "Decimal mark — a comma here, or every number arrives as text" },
      { target: ".importgrid", label: "The preview is the datasheet: rename, reorder and exclude before anything is created" },
      { target: { text: "Import 5 rows" }, label: "The button counts your rows — press it to create the sheet" },
    ],
  },
  {
    // Worked example 1, step 4 — the New-graph dialog opened on a sheet, so the reader sees what "New graph of
    // this data" actually does: the suggestions ranked for that sheet, and the Create button.
    file: "tut-new-graph.png",
    viewport: [1500, 1250],
    async setup(app) {
      await app.boot();
      await app.openNode("Sample — dose vs response", "table.dg");
      await app.menu("Graph", /^New graph of this data/);
      await app.page.waitForSelector('[aria-label="New graph"]', { timeout: 10000 });
      await app.settle();
    },
    capture: (app) => app.page.locator('[aria-label="New graph"]').first(),
    marks: [
      { target: '[aria-label="Graph types"]', label: "Every graph this sheet can draw — the best fit is already picked" },
      { target: ".ng-config", label: "The sheet's own settings: format, X type, replicates and error bars" },
      { target: { text: "Create graph" }, label: "Create graph — the sheet and the graph are made together" },
    ],
  },
  {
    // Worked example 2, step 3 — the goal tile the walkthrough names, on a sheet with three groups.
    file: "tut-analyze-goal.png",
    viewport: [1500, 1250],
    async setup(app) {
      await app.boot();
      await app.openNode("Replicate readouts", "table.dg");
      await app.menu("Analyze", /^Analyze…/);
      await app.page.waitForSelector('[aria-label="Analyze"]', { timeout: 10000 });
      await app.settle();
    },
    capture: (app) => app.page.locator('[aria-label="Analyze"]').first(),
    marks: [
      { target: '[data-goal="compare"]', label: "Compare groups — the tile this walkthrough uses" },
      { target: ".an-goals", label: "The goal tiles, ordered for the sheet you opened this from" },
      { target: ".an-guided-actions", label: "Browse all analyses — the full catalogue, if you know the test's name" },
    ],
  },
  {
    // Worked example 2, steps 4-5 — the configure page in the state the walkthrough describes: the tile
    // lands on a t test, the post-hoc row only exists once Test is ANOVA, and Control group only
    // once the post-hoc is Dunnett.
    file: "tut-analyze-configure.png",
    viewport: [1500, 1250],
    async setup(app) {
      await app.boot();
      await app.openNode("Replicate readouts", "table.dg");
      await app.menu("Analyze", /^Analyze…/);
      await app.page.waitForSelector('[aria-label="Analyze"]', { timeout: 10000 });
      await app.page.locator(".an-goals .an-card", { hasText: "Compare groups" }).first().click();
      await app.settle();
      await app.selectValue("Test", "anova");
      await app.settle();
      await app.selectValue("Post-hoc test", "dunnett");
      await app.settle();
    },
    capture: (app) => app.page.locator('[aria-label="Analyze"]').first(),
    marks: [
      { target: '[aria-label="Test"]', label: "Test — the tile opens on a t test; change it to One-way ANOVA for three or more groups" },
      { target: '[aria-label="Post-hoc test"]', label: "Post-hoc test — this row appears only once Test is One-way ANOVA" },
      { target: '[aria-label="Control group"]', label: "Control group — and this one only once the post-hoc is Dunnett" },
      { target: { text: "Make default" }, label: "Make default — remember these settings for next time" },
    ],
  },
  {
    // Worked example 2, step 7 — the tickbox, which is the actual instruction. The Add to graph menu item is
    // hidden once the markers are bound, so the tickbox is what the step pictures.
    file: "tut-sig-tickbox.png",
    viewport: [1500, 900],
    async setup(app) {
      await app.bootWithEngine(ENGINE.answers);
      await app.openNode("ANOVA — Vehicle, Low dose, High dose", ".ankey");
      await app.settle();
    },
    capture: "page",
    marks: [
      { target: ".anbind", label: "Tick this — the brackets stay bound to the analysis, so a re-run refreshes every p" },
      { target: ".antb-menu", label: "Add to graph — the one-shot alternative, offered only until the tickbox is used" },
      { target: ".ankey-cards", label: "Key result — the numbers a paper quotes" },
    ],
  },
  {
    // Worked example 3, steps 3-5 — the dose-response configure page, marked for the things the steps name.
    file: "tut-dose-configure.png",
    viewport: [1500, 1450],
    async setup(app) {
      await app.boot();
      await app.openNode("Sample — dose vs response", "table.dg");
      await app.menu("Analyze", /^Dose-response…/);
      await app.page.waitForSelector('[aria-label="Analyze"]', { timeout: 10000 });
      await app.settle();
    },
    capture: (app) => app.page.locator('[aria-label="Analyze"]').first(),
    marks: [
      { target: '[aria-label="Equation family"]', label: "Family — Dose-response; the Type under it is 4PL for the usual case" },
      { target: ".an-eqpreview", label: "The exact equation that will be fitted — no guessing which parameterisation" },
      { target: '[aria-label="Weighting"]', label: "Weighting — when the scatter grows with Y" },
      { target: { text: "Make default" }, label: "Make default — keep these settings for the next fit" },
    ],
  },
  {
    // Worked example 4, steps 3-7 — the Heatmap section with clustering on, because Distance, Linkage and the
    // blocks-from-tree box do not exist until it is.
    file: "tut-heatmap-panel.png",
    viewport: [1500, 1500],
    async setup(app) {
      await app.boot();
      await app.openGraph("Gene expression heatmap");
      await app.page.locator("svg.gfx-figure").click({ position: { x: 60, y: 20 } });
      await app.settle();
      await app.openSections(/Heatmap/);
      await app.selectValue("Cluster", "both");
      await app.settle();
      await app.viewport(1500, 1500);
      await app.page.evaluate(() => {
        for (const d of document.querySelectorAll("details.inspsec")) {
          d.open = /Heatmap/.test(d.querySelector("summary")?.textContent ?? "");
        }
      });
      await app.settle();
    },
    capture: (app) => app.page.locator(".insp"),
    marks: [
      { target: '[title^="Hierarchically cluster"]', label: "Cluster — Rows, Columns or both; Distance and Linkage appear once it is on" },
      { target: { text: "Centre at", within: ".insp" }, label: "Centre at — pin the middle colour to a value, so white sits on zero" },
      { target: '[aria-label="Add a row strip"]', label: "Add a row strip — say what each row is, from a column of your sheet" },
    ],
  },
  {
    // Worked example 6, steps 2-4 — Choose graphs, with the two controls the steps name.
    file: "tut-figure-choose.png",
    async setup(app) {
      await app.boot();
      await app.expandTree();
      await app.menu("Insert", /^New layout/);
      await app.page.waitForSelector(".laycard", { timeout: 10000 });
      await app.settle();
      await app.page.evaluate(() => {
        [...document.querySelectorAll(".laycard")].slice(0, 4).forEach((c) => c.click());
      });
      await app.settle();
    },
    capture: "page",
    marks: [
      { target: { nth: 0, of: ".laycard" }, label: "Tick the panels you want — every graph in the project, as a live thumbnail" },
      { target: { text: "Auto-scale on include" }, label: "Leave this on and each new panel matches the first one as it arrives" },
      { target: { text: "Build / Arrange" }, label: "Build / Arrange → — on to the canvas, with A, B, C already assigned" },
    ],
  },
  {
    // Worked example 6, steps 5-8 — the four controls the steps name. Shared axes and
    // Renumber are in the Inspector's Figure view (nothing picked), so the picture is the whole page, not the toolbar.
    file: "tut-figure-ribbon.png",
    viewport: [1700, 950],
    async setup(app) {
      await buildFourPanelFigure(app);
      await openInspectorDock(app);
    },
    capture: "page",
    marks: [
      { target: { text: "Columns", within: ".layribbon" }, label: "Columns and Gutter — how the panels tile, and the gap between them" },
      { target: { text: "Align all", within: ".layribbon" }, label: "Align all — axes down each column, across each row, and the letters with them" },
      { target: '.figinsp [title^="Shared axes:"]', label: "Shared axes — strip the repeated tick numbers from the inner panels" },
      { target: { text: "Renumber", within: ".figinsp" }, label: "Renumber — re-letter in reading order after moving things about" },
    ],
  },
  // ══════════════════════ The Axis tab, one how-to page ══════════════════════
  //
  // Seven captures of one panel, because sixty numbered boxes on one picture is not a picture
  // anybody reads. Each opens only the groups it is about (`onlyAxisGroups`), so the panel is
  // short enough to be legible at the size the manual shows it — with all thirteen groups open
  // the panel is a 600 × 2200 sliver.
  //
  // Four of these need a state, not just a panel: "Break mark" does not exist until a cut
  // does, the lists under Breaks / Custom ticks / Shaded bands are empty until you add one, and
  // Tint strength appears only once Block tint is ticked. The setups add them the way a user
  // would. A capture whose call-out points at nothing fails the run, which is what stops a
  // how-to describing a control the picture cannot show.
  {
    file: "axis-scale-range.png",
    viewport: [1500, 1020],
    async setup(app) {
      await app.boot();
      await app.openGraph("Dose-response");
      // Note: the Y axis, not the X. Title direction and Above the axis are drawn only for an axis
      // that runs up the figure, so photographed on X this panel cannot contain them. Everything
      // else in this capture is on both axes, so using Y loses nothing.
      await openAxisTab(app, "y");
      await onlyAxisGroups(app, ["scale", "range"]);
      // "Above the axis" exists only while the title is level — the builder refuses it at any
      // other angle. Without this click its call-out points at nothing and the run fails, which is
      // the property that stops the manual describing a control the picture cannot show.
      await app.page.locator(".insp .frow button.btn-mini", { hasText: /^Level$/ }).first().click();
      await app.settle();
    },
    capture: panelClip(),
    marks: [
      { target: { nth: 0, of: ".inspbody .frow" }, label: "X / Y / Y2 / Y3 — which axis this panel is editing" },
      { target: { text: "Title", within: ".inspbody", closest: "label" }, label: "Title — the name written along the axis" },
      { target: { text: "Title direction", within: ".inspbody", closest: ".frow" }, label: "Title direction — Level, 45°, 90°, 135°, 180°, or any angle you type" },
      { target: { text: "Above the axis", within: ".inspbody", closest: "label" }, label: "Above the axis — the level title written over the top of the axis" },
      { target: { text: "Type", within: ".inspbody", closest: "label" }, label: "Type — linear, log, or probability" },
      { target: { text: "Reversed", within: ".inspbody", closest: "label" }, label: "Reversed — run the axis the other way" },
      { target: { text: "Equal aspect", within: ".inspbody", closest: "label" }, label: "Equal aspect (1:1)" },
      { target: { text: "Hide axis", within: ".inspbody", closest: "label" }, label: "Hide axis — the scale stays; the line, ticks and labels go" },
      { target: { text: "Scale bar", within: ".inspbody", closest: "label" }, label: "Scale bar — a corner bar instead of a numbered axis" },
      { target: { text: "Min / Max", within: ".inspbody", closest: "label" }, label: "Min / Max — the range shown" },
    ],
  },
  {
    file: "axis-ticks-numbering.png",
    viewport: [1500, 1090],
    async setup(app) {
      await app.boot();
      await app.openGraph("Dose-response");
      await openAxisTab(app);
      await onlyAxisGroups(app, ["ticks", "numbering"]);
    },
    capture: panelClip(),
    marks: [
      { target: { text: "Tick interval", within: ".inspbody", closest: "label" }, label: "Tick interval — the spacing between numbered ticks" },
      { target: { text: "Minor ticks", within: ".inspbody", closest: "label" }, label: "Minor ticks — how many unlabelled ones in between" },
      { target: { text: "Format", within: "#inspsub-numbering", closest: "label" }, label: "Format — decimal, scientific, powers of ten, percent" },
      { target: { text: "Decimals", within: ".inspbody", closest: "label" }, label: "Decimals — fixed decimal places" },
      { target: { text: "Label rotation", within: ".inspbody", closest: "label" }, label: "Label rotation — turn long labels" },
      { target: { text: "Prefix", within: ".inspbody", closest: "label" }, label: "Prefix — text before every number" },
      { target: { text: "Suffix", within: ".inspbody", closest: "label" }, label: "Suffix — text after every number" },
      { target: { text: "Thousands", within: ".inspbody", closest: "label" }, label: "Thousands — the digit-grouping separator" },
      { target: { text: "Decimal mark", within: ".inspbody", closest: "label" }, label: "Decimal mark — point or comma" },
    ],
  },
  {
    file: "axis-line-spacing.png",
    viewport: [1500, 1150],
    async setup(app) {
      await app.boot();
      await app.openGraph("Dose-response");
      await openAxisTab(app);
      await onlyAxisGroups(app, ["axis-line", "spacing", "axis-length"]);
    },
    capture: panelClip(),
    marks: [
      { target: { text: "Colour", within: "#inspsub-axis-line", closest: "label" }, label: "Colour — this axis's own line colour" },
      { target: { text: "Thickness", within: "#inspsub-axis-line", closest: "label" }, label: "Thickness — how heavy the line is" },
      { target: { text: "Link ticks to axis", within: ".inspbody", closest: "label" }, label: "Link ticks to axis" },
      { target: { text: "Tick thickness", within: ".inspbody", closest: "label" }, label: "Tick thickness — once unlinked" },
      { target: { text: "Show ticks", within: ".inspbody", closest: "label" }, label: "Show ticks — the marks, not the numbers" },
      { target: { text: "Tick length", within: ".inspbody", closest: "label" }, label: "Tick length" },
      { target: { text: "Labels", within: "#inspsub-spacing", closest: "label" }, label: "Labels to axis — the gap under the numbers" },
      { target: { text: "Title", within: "#inspsub-spacing", closest: "label" }, label: "Title to labels — the gap under the axis name" },
      { target: { text: "Length (px)", within: ".inspbody", closest: "label" }, label: "Length (px) — the size of the plotting area" },
    ],
  },
  {
    file: "axis-breaks-bands.png",
    viewport: [1500, 1320],
    async setup(app) {
      await app.boot();
      await app.openGraph("Dose-response");
      await openAxisTab(app, "y"); // "Series on this axis" is a value-axis group
      await onlyAxisGroups(app, ["breaks-cuts-", "custom-ticks", "shaded-bands", "series-on-this-axis"]);
      // One of each, added the way a reader would — the lists and "Break mark" do not exist
      // until something is in them, and a call-out pointing at nothing fails this run.
      await app.typeInto("Break start", "60");
      await app.typeInto("Break end", "80");
      await clickButton(app, /^Add cut$/);
      await app.typeInto("New tick value", "50");
      await app.typeInto("New tick label", "half");
      await clickButton(app, /^Add tick$/);
      await app.typeInto("Band start", "20");
      await app.typeInto("Band end", "40");
      await clickButton(app, /^Add band$/);
    },
    capture: panelClip(),
    marks: [
      { target: { sel: '[aria-label="Break start"]', closest: ".frow" }, label: "from / to / Add cut — compress a range out of the axis" },
      { target: { text: "Suggest cut", within: ".inspbody", closest: ".frow" }, label: "Suggest cut — when one wide gap dominates" },
      { target: { text: "Break mark", within: ".inspbody", closest: "label" }, label: "Break mark — slash, zigzag or a plain gap" },
      { target: { nth: 0, of: "#inspsub-breaks-cuts- label.frow" }, label: "A cut you have added — the cross removes it" },
      { target: { sel: '[aria-label="New tick value"]', closest: ".frow" }, label: "value / label / Add tick — a tick exactly where you want one" },
      { target: { nth: 0, of: "#inspsub-custom-ticks label.frow" }, label: "A tick you have added" },
      { target: { sel: '[aria-label="Band start"]', closest: ".frow" }, label: "from / to / colour / Add band — shade a zone" },
      { target: { nth: 0, of: "#inspsub-shaded-bands label.frow" }, label: "A band you have added" },
      { target: { section: "series-on-this-axis" }, label: "Series on this axis — how a second Y axis gets its data" },
    ],
  },
  {
    // The category branch of the panel, grouped by hand: the Box & whisker card's three
    // treatments, two of them typed into one group. By hand needs no grouping column, and three
    // rows keep the panel short enough to read — a chart with twelve categories, such as the
    // Heritability dot plot, would show twelve boxes.
    file: "axis-categories.png",
    viewport: [1500, 950],
    async setup(app) {
      await openGalleryChart(app, "Box & whisker");
      await openAxisTab(app, "x");
      await onlyAxisGroups(app, ["category-groups"]);
      await selectGroupColumn(app, "By hand");
      await typeGroupBox(app, "Control", "Controls");
      await typeGroupBox(app, "Low dose", "Controls");
      await typeGroupBox(app, "High dose", "Treated");
      await tickRow(app, "#inspsub-category-groups", "Block tint");
    },
    capture: panelClip(),
    marks: [
      { target: { text: "Group by", within: ".inspbody", closest: "label" }, label: "Group by — a column that names each row's group, or By hand" },
      { target: { sel: '[aria-label="Group for Control"]', closest: ".frow" }, label: "One box per category — type the group it belongs to" },
      { target: { text: "Colour labels", within: ".inspbody", closest: "label" }, label: "Colour labels" },
      { target: { text: "Separators", within: ".inspbody", closest: "label" }, label: "Separators — a rule between groups" },
      { target: { text: "Group names", within: ".inspbody", closest: "label" }, label: "Group names — written alongside the axis" },
      { target: { text: "Block tint", within: ".inspbody", closest: "label" }, label: "Block tint" },
      { target: { text: "Tint strength", within: ".inspbody", closest: "label" }, label: "Tint strength — only once Block tint is on" },
      { target: { nth: 0, of: "#inspsub-category-groups .colorin" }, label: "One swatch per group" },
    ],
  },
  {
    file: "axis-3d.png",
    viewport: [1500, 900],
    async setup(app) {
      await openGalleryChart(app, "3D scatter");
      await openAxisTab(app);
      await onlyAxisGroups(app, []);
    },
    capture: panelClip(),
    marks: [
      { target: { nth: 0, of: ".inspbody .frow" }, label: "X / Y / Z — which cube edge you are editing" },
      { target: { text: "Title", within: ".inspbody", closest: "label" }, label: "Title — the name at this edge's end" },
      { target: { text: "Min", within: ".inspbody", closest: "label" }, label: "Min" },
      { target: { text: "Max", within: ".inspbody", closest: "label" }, label: "Max" },
      { target: { text: "Scale", within: ".inspbody", closest: "label" }, label: "Scale — linear or log on this edge" },
      { target: { text: "Tick interval", within: ".inspbody", closest: "label" }, label: "Tick interval" },
      { target: { text: "Show ticks", within: ".inspbody", closest: "label" }, label: "Show ticks" },
      { target: { text: "Tick length", within: ".inspbody", closest: "label" }, label: "Tick length" },
      { target: { text: "Number format", within: ".inspbody", closest: "label" }, label: "Number format" },
      { target: { text: "Decimals", within: ".inspbody", closest: "label" }, label: "Decimals" },
    ],
  },
  {
    file: "axis-3d-line.png",
    viewport: [1500, 1150],
    async setup(app) {
      await openGalleryChart(app, "3D scatter");
      await openAxisTab(app);
      await onlyAxisGroups(app, ["spacing"]);
    },
    capture: panelClip(),
    marks: [
      { target: { text: "Colour", within: ".inspbody", closest: "label" }, label: "Colour — this edge's own colour" },
      { target: { text: "Thickness", within: ".inspbody", closest: "label" }, label: "Thickness" },
      { target: { text: "Hide axis", within: ".inspbody", closest: "label" }, label: "Hide axis" },
      { target: { text: "Reset", within: ".inspbody", closest: "label" }, label: "Reset — Clear puts this edge back to its defaults" },
      { target: { text: "Labels", within: "#inspsub-spacing", closest: "label" }, label: "Labels to axis" },
      { target: { text: "Title", within: "#inspsub-spacing", closest: "label" }, label: "Title to labels" },
      { target: { text: "Label side", within: ".inspbody", closest: "label" }, label: "Label side — flip the numbers to the other side" },
    ],
  },
  // ─── The same action written as numbered steps, a picture per step ───
  {
    file: "step-axisbreak-1.png",
    viewport: [1400, 900],
    async setup(app) {
      await app.boot();
      await app.openGraph("Dose-response");
      const fig = app.page.locator("svg.gfx-figure").first();
      const b = await fig.boundingBox();
      await app.page.mouse.click(b.x + 62, b.y + b.height / 2); // the Y axis line
      await app.settle();
    },
    capture: "figure",
  },
  // (There are no further break-walkthrough steps: the Breaks (cuts) control group under
  // "Every control on the Axis tab" already explains it.)
  // ─────────────────── "Start here" — its chapters, in the task shape ───────────────────
  //
  // These are the first four chapters, so they are the pictures most likely to be the first a
  // new user ever sees. Two rules apply throughout, as in the axis-break steps above: a picture
  // belongs under the step it illustrates (so most of these hang off a `steps` item rather than
  // off a `shot` block), and a capture of a whole 1500-px window teaches nothing about a control
  // 200 px wide — so a menu, a dock, a popover and the status bar are each clipped to themselves.
  {
    // Move 1 — the three ways numbers get in, all in the File menu.
    file: "start-data-doors.png",
    viewport: [1400, 950],
    async setup(app) {
      await app.boot();
      await openTopMenu(app, "File");
    },
    capture: menuClip("File"),
    marks: [
      { target: { text: "Import data…", within: ".dropdown", closest: ".dropitem" }, label: "Import data… — a CSV, text, Excel or OpenDocument file" },
      { target: { text: "Paste data as new datasheet…", within: ".dropdown", closest: ".dropitem" }, label: "Paste data as new datasheet… — a block of cells on the clipboard" },
      { target: { text: "New datasheet / graph…", within: ".dropdown", closest: ".dropitem" }, label: "New datasheet / graph… — a blank sheet to type into" },
    ],
  },
  {
    // Move 2 — the three routes to a graph. Opened with a datasheet in front, so
    // "New graph of this data" is live rather than greyed out.
    file: "start-graph-doors.png",
    viewport: [1400, 950],
    async setup(app) {
      await app.boot();
      await app.openNode("Sample — dose vs response", "table.dg");
      await openTopMenu(app, "Graph");
    },
    capture: menuClip("Graph"),
    marks: [
      { target: { text: "New graph…", within: ".dropdown", closest: ".dropitem" }, label: "New graph… — start from scratch; the datasheet is made with it" },
      { target: { text: "Chart gallery…", within: ".dropdown", closest: ".dropitem" }, label: "Chart gallery… — every type as a live example you can open and edit" },
      { target: { text: "New graph of this data", within: ".dropdown", closest: ".dropitem" }, label: "New graph of this data — the quick route from the sheet you have open" },
    ],
  },
  {
    // Move 2's result. No call-outs on purpose: the step's point is that a whole graph
    // arrives at once, and the next picture is the one about clicking parts of it.
    file: "start-first-graph.png",
    viewport: [1400, 900],
    async setup(app) {
      await app.boot();
      await app.openGraph("Dose-response");
      await app.page.locator("svg.gfx-figure").first().press("Escape").catch(() => {});
      await app.settle();
    },
    capture: "figure",
  },
  {
    // Move 3 — click a thing, and it is drawn selected. The `force` is the same one
    // `inspector-series.png` needs: series glyphs legitimately overlap.
    file: "start-selected-series.png",
    viewport: [1400, 900],
    async setup(app) {
      await app.boot();
      await app.openGraph("Dose-response");
      await app.page.locator('svg.gfx-figure .gfx-series [style*="cursor: pointer"]').first().click({ force: true });
      await app.settle();
    },
    capture: "figure",
  },
  {
    // …and the panel that opened because of it.
    file: "start-inspector-opened.png",
    viewport: [1400, 1200],
    async setup(app) {
      await app.boot();
      await app.openGraph("Dose-response");
      await app.page.locator('svg.gfx-figure .gfx-series [style*="cursor: pointer"]').first().click({ force: true });
      await app.settle();
      // The assistant's suggestion card changes with the graph; in a picture of the panel it is
      // clutter that would make two shots of the same panel differ for a reason nobody can see.
      const x = app.page.locator('[aria-label="Dismiss suggestion"]');
      while ((await x.count()) > 0) {
        await x.first().click();
        await app.settle();
      }
    },
    // Note: the top of the panel, not all of it. `panelClip()` gives 300 x 1020 here (eight groups),
    // and this step's point is only "the panel is now about the thing you clicked" — the whole
    // Data tab, control by control, belongs in its own surface chapter.
    capture: {
      async clip(app) {
        return app.page.evaluate(() => {
          const insp = document.querySelector(".insp");
          const box = insp.getBoundingClientRect();
          const g = insp.querySelectorAll(".inspgroup")[1];
          const bottom = g ? g.getBoundingClientRect().bottom : box.bottom;
          return {
            x: box.x,
            y: box.y,
            // Clamped to the viewport. `.insp` is 304px wide but its right edge sits past the
            // window, so Playwright trims the screenshot to 300 while unclamped call-outs would
            // still be measured against 304 — and the tab-rail box would then run 4px past the
            // picture it was measured for. `panelClip` clamps the same way.
            width: Math.min(box.width, window.innerWidth - box.x),
            height: Math.min(box.height, bottom - box.top + 10, window.innerHeight - box.y),
          };
        });
      },
    },
    marks: [
      { target: ".inspcats", label: "The seven tabs — Chart · Frame · Axis · Data · Text · Annotate · Style" },
      { target: ".inspfilter", label: "Filter — type a control's name and the panel narrows to it" },
      // Note: not `details.inspsec`. The Axis tab is built from <details> groups; the Data tab is
      // built from `.inspgroup` divs with an `.inspsub-toggle` heading, and a target aimed at
      // the wrong one resolves to nothing and fails the run.
      { target: { nth: 0, of: ".inspgroup" }, label: "One group of controls — “Plot as”. Click its heading to open or shut it" },
    ],
  },
  {
    // Move 4 — where an analysis starts.
    file: "start-analyze-menu.png",
    viewport: [1400, 950],
    async setup(app) {
      await app.boot();
      await app.openNode("Sample — dose vs response", "table.dg");
      await openTopMenu(app, "Analyze");
    },
    capture: menuClip("Analyze"),
    marks: [
      { target: { text: "Analyze…", within: ".dropdown", closest: ".dropitem" }, label: "Analyze… — the front door, when you are not sure what you need" },
      { target: { text: "Common analyses", within: ".dropdown", closest: ".dropitem" }, label: "Common analyses — the named front doors: dose-response, enzyme kinetics, binding, standard curve, method comparison" },
      { target: { text: "Sample size & power…", within: ".dropdown", closest: ".dropitem" }, label: "Sample size & power… — before you run the experiment, not after" },
    ],
  },
  {
    // …and where the answer lands. Deliberately not another picture of the result pane
    // (`analysis-result.png` is that): this one is about the result being a tab of its own,
    // filed with the datasheet that produced it.
    // The numbers are the real engine's, replayed through the preload bridge — a browser has
    // no Python sidecar, and a picture of an empty "Re-run" pane would teach the wrong thing.
    file: "start-result-tab.png",
    viewport: [1500, 950],
    async setup(app) {
      await app.bootWithEngine(ENGINE.answers);
      // The datasheet and its graph first, then the analysis — so the tab group really does
      // hold "the data, graph and result tabs gathered under that datasheet's name", which is
      // what the caption says. With the result alone the group is one tab and a 4px handle.
      await app.openNode("Replicate readouts", "table.dg");
      await app.openGraph("Dose-group violin");
      await app.openNode("ANOVA — Vehicle, Low dose, High dose", ".ankey");
      await app.settle();
    },
    // Not the whole 1500 x 950 window. Three call-out badges on a page capture render at
    // under half size, and this picture is about two small things — a tab and a tree row —
    // that are both in the top-left corner. So: clip to the corner that holds them.
    capture: {
      async clip(app) {
        return app.page.evaluate(() => {
          const nav = document.querySelector(".nav").getBoundingClientRect();
          // The tab rail runs to the right edge of the window; the tab group is the 300px of it
          // that has anything in it. Clipping to the rail would photograph 900px of empty strip.
          const group = document.querySelector(".tabgroup").getBoundingClientRect();
          // The clip must reach the tree row the second call-out is on. A fixed 520px cut
          // leaves only a 6px sliver of that row at the bottom edge, so box ➋ surrounds nothing.
          const row = [...document.querySelectorAll(".navrow")]
            .find((r) => (r.textContent ?? "").includes("ANOVA — Vehicle, Low dose, High dose"))
            ?.getBoundingClientRect();
          const bottom = Math.max(520, row ? row.bottom + 16 : 0);
          return { x: 0, y: 0, width: Math.min(window.innerWidth, group.right + 24), height: Math.min(nav.bottom, bottom) };
        });
      },
    },
    marks: [
      // ➊ is the result's tab itself, not the group label: while expanded, the label is only a
      // 4px colour handle — a box 10px wide beside the thing it is meant to point at.
      { target: { text: "ANOVA — Vehicle, Low dose, High dose", within: ".tabs", closest: "button.tab" }, label: "The result is a tab, grouped under the datasheet it came from" },
      { target: { text: "ANOVA — Vehicle, Low dose, High dose", within: ".nav", closest: ".navrow" }, label: "…and filed in the Navigator, indented under that same datasheet" },
    ],
  },
  {
    // The Navigator, hovered — the row buttons are `opacity: 0` until the pointer is on the row,
    // so a call-out on one would otherwise point at something invisible in the picture.
    file: "start-navigator.png",
    viewport: [1400, 1000],
    async setup(app) {
      // With the recorded engine answers. Booted without them every analysis in the demo
      // project wears a "stale" badge — six of them, dominating a picture that is about filing.
      // In the real program they are computed on mount, so the badges are an artefact of the
      // headless boot, not what a user sees.
      await app.bootWithEngine(ENGINE.answers);
      // Widened past the 216px default, which ellipsis-clips every name in the tree
      // ("Expe…", "Dose-r…"). A picture of a filing cabinet nobody can read teaches nothing,
      // and dragging this divider is the first thing the neighbouring chapter tells you to do.
      await dragDockDivider(app, 0, 130);
      // Open the project, then fold the first experiment shut again — so the picture shows both
      // states at once: one experiment closed (and hovered, so its four buttons are visible) and
      // the rest open, with each graph and analysis indented under the datasheet it came from.
      await app.page.locator(".navfolder .twist").first().click();
      await app.settle();
      await app.page.locator(".navfolder .navrow").nth(1).locator(".twist").click();
      await app.settle();
      await app.page.locator(".navfolder .navrow").nth(1).hover();
      await app.settle();
    },
    capture: navClip(),
    marks: [
      { target: ".nav .search", label: "Find — names anywhere in the tree, and @data / @graph / @analysis / @figure to narrow by kind" },
      { target: ".navtop", label: "Project tree — the ⊞ makes a new project folder" },
      { target: { nth: 1, of: ".navfolder .navrow .navacts" }, label: "An experiment's own buttons — add a dataset, add a graph of its data, add a panel figure, delete. They appear when you hover the row" },
      { target: { nth: 0, of: ".navrow.child" }, label: "A graph is indented under the datasheet it was drawn from" },
    ],
  },
  {
    // The tab rail, grouped by datasheet.
    file: "start-tab-rail.png",
    viewport: [1500, 950],
    async setup(app) {
      await app.boot();
      await app.openNode("Sample — dose vs response", "table.dg");
      await app.openGraph("Dose-response");
      // Fold the last group (the "Other" one, holding the Welcome page) so the picture shows
      // both states at once. Note: a group's label is only a name when it is folded; open, it is
      // a 4px coloured handle — so a call-out saying "the group label names the datasheet" would
      // point at a sliver, and the name a reader can see is the first tab's own title.
      await app.page.locator(".tabgrouplabel").last().click();
      await app.settle();
    },
    capture: (app) => app.page.locator(".tabs"),
    marks: [
      { target: { nth: 0, of: ".tabgroup" }, label: "One datasheet's group: the data, the graphs drawn from it and the analyses run on it, in that order" },
      { target: { nth: 0, of: ".tabgrouplabel.expanded" }, label: "Open, the group label is just this coloured handle — click it to fold the group away" },
      { target: { nth: 0, of: ".tabgrouplabel.collapsed" }, label: "Folded, it shows the group's name and how many tabs are inside it" },
    ],
  },
  {
    // Ctrl+S asks what to keep before the file dialog.
    file: "start-save-part.png",
    viewport: [1400, 1050],
    async setup(app) {
      await app.boot();
      await app.expandTree();
      await app.menu("File", /^Save…/);
      await app.page.waitForSelector(".savelist", { timeout: 10000 });
      await app.settle();
    },
    capture: (app) => app.page.locator('[aria-label="Save project"]'),
    marks: [
      { target: ".savelist", label: "Every project, experiment and object, each with its own tick box" },
      { target: { nth: 0, of: ".saverow" }, label: "A container's box is three-state: on, off, or “some of what is under me”" },
      { target: ".modalbtns .btn", label: "The button says what will be written — “Save everything…”, “Save this graph…”, or “Save N items…”" },
    ],
  },
  {
    // View ▸ Layouts… — three built-ins, plus whatever you save.
    file: "start-layouts-menu.png",
    viewport: [1400, 950],
    async setup(app) {
      await app.boot();
      await app.menu("View", /^Layouts…/);
      await app.page.waitForSelector(".layoutmenu", { timeout: 10000 });
      await app.settle();
    },
    capture: (app) => app.page.locator(".layoutmenu"),
    marks: [
      { target: { text: "Default", within: ".layoutmenu", closest: ".layoutitem" }, label: "Default — the arrangement the program starts in" },
      { target: { text: "Wide canvas", within: ".layoutmenu", closest: ".layoutitem" }, label: "Wide canvas — the docks narrowed, the figure given the room" },
      { target: ".layoutsave", label: "Save current as… — name this arrangement and it joins the list" },
    ],
  },
  {
    // The bottom edge of the window: what is in the document, how it is laid out, the zoom,
    // and whether the statistics engine is up.
    file: "start-status-bar.png",
    viewport: [1400, 900],
    async setup(app) {
      await app.boot();
      await app.openGraph("Dose-response");
      await app.page.waitForSelector(".status", { timeout: 10000 });
      await app.settle();
    },
    capture: (app) => app.page.locator(".status"),
    marks: [
      { target: { nth: 0, of: ".status > span" }, label: "How much is in the document — datasets and graphs" },
      { target: ".statuslink", label: "Layout — the same popover as View ▸ Layouts…" },
      { target: ".zoomctl", label: "Zoom — the − and + are disabled at each end of the range, and the middle opens Set zoom level…" },
      { target: ".statusright > span:last-child", label: "Whether the statistics engine is up, and that your work is saved" },
    ],
  },
  {
    // Ctrl+K. The half that matters is the bottom half: what the manual can answer.
    file: "start-command-palette.png",
    viewport: [1400, 950],
    async setup(app) {
      await app.boot();
      await app.openGraph("Dose-response");
      await app.page.keyboard.press("Control+k");
      await app.page.waitForSelector(".palette", { timeout: 10000 });
      // A query that returns both halves. "axis" returns no commands at all — every hit is a
      // manual row, and a call-out reading "a command, with its menu beside it" would then be
      // pointing at a manual row, because both halves are `.palette-item`.
      await app.typeInto("Search actions…", "export");
      await app.settle();
    },
    capture: (app) => app.page.locator(".palette"),
    marks: [
      { target: ".palette-input", label: "Type a few letters of what you want; Enter runs the top hit" },
      { target: { nth: 0, of: ".palette-item:not(.palette-guide)" }, label: "A command, with the menu it lives in beside it — so you learn where it is" },
      { target: ".palette-group", label: "In the manual — what this documentation can answer, for a question with no command behind it" },
    ],
  },

  // ───────────────────── "Your data" — its chapters, in the task shape ─────────────────────
  //
  // The seven other pictures in this part are surfaces (the import preview, the creator, the
  // sheet, its three right-click menus, the Data menu). These ten are the per-step ones the task
  // shape needs: the thing you press, and the state you are left in.
  {
    // The import preview's grid carries the datasheet's own column menu — the point of the step
    // is that you shape the table before it exists, so the picture has to be of the menu, in the
    // preview, not of the finished sheet.
    file: "data-import-grid.png",
    viewport: [1500, 1000],
    async setup(app) {
      await app.boot();
      await app.importSample();
      // Note: the third header, not the second. "Use as X axis" is hidden on the column that is
      // already the X (DataGrid guards it on `xColumn(table)`), and the preview's lead column is.
      await app.rightClick(".modal-import table.dg thead th", 3, { select: false });
    },
    // The menu, not the grid around it. The preview grid renders at its full height inside a
    // scroll container — 5443px for this file — so the menu opens at y≈5670 and a viewport clip
    // of the two together is 1000px of nothing. An element capture scrolls it into view.
    capture: (app) => app.page.locator(".dgmenu"),
    marks: [
      { target: { text: "Use as X axis", within: ".dgmenu", closest: ".dgmenu-i" }, label: "Use as X axis — make this column the one every graph plots along X" },
      { target: { text: "Type", within: ".dgmenu", closest: ".dgmenu-i" }, label: "Type — numbers, text or dates. Detected on import; this is the override" },
      { target: { sel: '[aria-label="Column formula"]', closest: ".dgmenu-i" }, label: "ƒ(x) — a column computed from the others, before the sheet even exists" },
    ],
  },
  {
    // The link marker on a sheet's rail. It only exists on a table with `linkedSource`, which
    // means importing through the keep-linked tickbox — there is no way to fake it from the demo
    // project, and a hand-made mock-up is exactly what this pipeline refuses.
    file: "data-linked-table.png",
    viewport: [1500, 950],
    async setup(app) {
      await app.boot();
      await app.importSample();
      // Note: it has no aria-label — it is a `label.importchk` whose text is the name, and it is
      // only rendered for a text file with a path going to a new datasheet.
      const ticked = await app.page.evaluate(() => {
        const row = [...document.querySelectorAll("label.importchk")].find((l) =>
          (l.textContent ?? "").includes("Keep linked to file"),
        );
        const box = row?.querySelector('input[type="checkbox"]');
        if (!box) return false;
        if (!box.checked) box.click();
        return true;
      });
      if (!ticked) throw new Error("no Keep-linked tickbox — is the import still a text file with a path?");
      await app.settle();
      // Note: the footer button ("Import 5 rows"), reached inside `.modalbtns`. A bare
      // `hasText: /^Import/` matches something the preview grid sits on top of, and
      // Playwright then times out after 30s with a `td.sparecol` intercepting the click.
      await app.page.locator(".modalbtns button", { hasText: /^Import/ }).first().click();
      await app.settle();
      await app.page.waitForSelector(".linkedbadge", { timeout: 10000 });
      await app.settle();
    },
    capture: {
      async clip(app) {
        return app.page.evaluate(() => {
          // The badge and nothing else. Taking the rail's full height would bring in the row of
          // buttons under it, and starting 24px to its left would slice the neighbouring button
          // in half - both of which read as "part of the thing being pointed at".
          const b = document.querySelector(".linkedbadge").getBoundingClientRect();
          const x = Math.max(0, b.left - 8);
          const y = Math.max(0, b.top - 8);
          return {
            x,
            y,
            width: Math.min(window.innerWidth - x, b.right + 10 - x),
            height: Math.min(window.innerHeight - y, b.bottom + 8 - y),
          };
        });
      },
    },
    marks: [
      { target: ".linkedbadge", label: "🔗 and the file's name — this table re-reads itself when that file changes on disk" },
      { target: { text: "Refresh", within: ".linkedbadge", closest: "button" }, label: "Refresh — re-read it now" },
      { target: { text: "Unlink", within: ".linkedbadge", closest: "button" }, label: "Unlink — stop auto-updating and keep the data you have" },
    ],
  },
  {
    // The creator's two decisions, close up: which end you are reading it from, and the filter.
    file: "data-creator-modes.png",
    viewport: [1500, 1250],
    async setup(app) {
      await app.boot();
      await app.menu("File", /^New datasheet \/ graph…/);
      await app.page.waitForSelector(".ng-seg", { timeout: 10000 });
      await app.settle();
    },
    capture: {
      async clip(app) {
        return app.page.evaluate(() => {
          const seg = document.querySelector(".ng-seg").getBoundingClientRect();
          const search = document.querySelector('[aria-label="Search graph types"]').getBoundingClientRect();
          const x = Math.max(0, seg.left - 14);
          const y = Math.max(0, seg.top - 14);
          return {
            x,
            y,
            width: Math.min(window.innerWidth - x, Math.max(seg.right, search.right) + 14 - x),
            height: Math.min(window.innerHeight - y, search.bottom + 14 - y),
          };
        });
      },
    },
    marks: [
      { target: ".ng-seg", label: "What to create — a datasheet with its graph, a graph with its datasheet, or a datasheet only" },
      { target: '[aria-label="Data types"]', label: "Narrow the graph list to what one shape of sheet can draw" },
      { target: '[aria-label="Search graph types"]', label: "…or find a graph by name, when you already know what it is called" },
    ],
  },
  {
    // The layout rule the chapter is about: groups across, replicates down.
    file: "data-groups-in-columns.png",
    viewport: [1500, 950],
    async setup(app) {
      await app.boot();
      // Note: "Replicate readouts", not "Treatment means". A Column sheet has no lead column — one
      // column per group, replicates down the rows (`tableFormats.ts`). The demo's "Treatment
      // means" sheet is a Column sheet with its groups down a text column instead, so a picture
      // of it would contradict the rule the step states.
      await app.openNode("Replicate readouts", "table.dg");
    },
    capture: {
      async clip(app) {
        return app.page.evaluate(() => {
          const g = document.querySelector("table.dg").getBoundingClientRect();
          const r = document.querySelector(".datarail").getBoundingClientRect();
          const x = Math.max(0, r.left - 8);
          const y = Math.max(0, r.top - 8);
          return {
            x,
            y,
            width: Math.min(window.innerWidth - x, Math.max(g.right, r.right) + 8 - x, 760),
            height: Math.min(window.innerHeight - y, g.bottom + 8 - y, 430),
          };
        });
      },
    },
    marks: [
      { target: '[aria-label="Table format"]', label: "The format chip — Column: one grouping variable, one group per column" },
      { target: { nth: 1, of: "table.dg thead th" }, label: "One group per column. A t test, an ANOVA and a column bar chart all compare columns" },
      { target: { nth: 0, of: "table.dg tbody tr" }, label: "One subject or replicate per row — the rows are what a bar chart averages" },
    ],
  },
  {
    // The format chip, open. The chapter's whole first section is "change this".
    file: "data-format-chip.png",
    viewport: [1500, 950],
    async setup(app) {
      await app.boot();
      await app.openNode("Sample — dose vs response", "table.dg");
      // The list is deliberately not photographed. The chip is a native <select>, so its popup
      // is drawn by the OS and never reaches a screenshot. Forcing it open with `size` does not
      // help: the pill's own border-radius and tint stay on, and the fifteen options are clipped
      // inside an ellipse with the first and last cut off - a picture of something no user will
      // ever see. The chapter lists the fifteen formats in full right underneath; this picture
      // only has to show where the chip is and that it opens.
    },
    capture: {
      async clip(app) {
        return app.page.evaluate(() => {
          const s = document.querySelector('[aria-label="Table format"]').getBoundingClientRect();
          const r = document.querySelector(".datarail").getBoundingClientRect();
          const x = Math.max(0, r.left - 8);
          const y = Math.max(0, Math.min(r.top, s.top) - 10);
          return {
            x,
            y,
            width: Math.min(window.innerWidth - x, s.right + 220 - x),
            height: Math.min(window.innerHeight - y, s.bottom + 12 - y),
          };
        });
      },
    },
    marks: [
      { target: '[aria-label="Table format"]', label: "The format chip — open it for all fifteen. The one in force decides which analyses and which charts you are offered" },
      { target: ".datarail-title", label: "The sheet's name, for telling two open datasheets apart" },
    ],
  },
  {
    // A computed column, mid-expression.
    file: "data-column-formula.png",
    viewport: [1500, 1000],
    async setup(app) {
      await app.boot();
      await app.openNode("Sample — dose vs response", "table.dg");
      await app.rightClick("table.dg thead th", 1, { select: false });
      await app.typeInto("Column formula", "A/B");
    },
    capture: (app) => app.page.locator(".dgmenu"),
    marks: [
      { target: { sel: '[aria-label="Column formula"]', closest: ".dgmenu-i" }, label: "ƒ(x) — letters are columns, counted from A. It recalculates whenever they change" },
      { target: { text: "Decimals", within: ".dgmenu", closest: ".dgmenu-i" }, label: "Decimals — how many places the numbers show. The stored value is untouched" },
    ],
  },
  {
    // Excluded values, marked in place.
    file: "data-excluded-cells.png",
    viewport: [1500, 950],
    async setup(app) {
      await app.boot();
      await app.openNode("Sample — dose vs response", "table.dg");
      await app.selectBlock(1, 2, 2, 2);
      await app.menu("Data", /^Exclude selected values/);
      // Note: the class is `dgexcl`, and the rendering is blue italic, not a strike-through
      // (`shell.css`: `.dgcell.dgexcl { color: var(--excluded); font-style: italic }`). Waiting
      // on the real class keeps the picture tied to what the program actually draws.
      await app.page.waitForSelector("td.dgexcl", { timeout: 10000 });
      await app.settle();
    },
    capture: {
      async clip(app) {
        return app.page.evaluate(() => {
          const g = document.querySelector("table.dg").getBoundingClientRect();
          const r = document.querySelector(".datarail").getBoundingClientRect();
          const x = Math.max(0, r.left - 8);
          const y = Math.max(0, r.top - 8);
          return {
            x,
            y,
            // Wide enough to reach the Exclude / Include buttons at the far end of the rail:
            // capped at 760 they fall outside the picture and the run refuses to write it.
            width: Math.min(window.innerWidth - x, Math.max(g.right, r.right) + 8 - x),
            height: Math.min(window.innerHeight - y, g.bottom + 8 - y, 470),
          };
        });
      },
    },
    marks: [
      { target: { nth: 0, of: "td.dgexcl" }, label: "An excluded value — blue and italic. The number stays on the sheet and stops counting" },
      { target: { text: "Exclude", within: ".datarail", closest: "button" }, label: "Exclude — available once cells are selected; takes them out of every graph and analysis" },
      { target: { text: "Include", within: ".datarail", closest: "button" }, label: "Include — puts them back into every graph and analysis" },
    ],
  },
  {
    // The Fill palette, open over a selection.
    file: "data-cell-fill-menu.png",
    viewport: [1500, 1000],
    async setup(app) {
      await app.boot();
      await app.openNode("Sample — dose vs response", "table.dg");
      await app.selectBlock(0, 1, 2, 2);
      // Note: not `hasText: /^Fill$/`. The button renders an icon before its word, so its
      // textContent never equals "Fill". Its aria-label is the stable handle.
      await app.page.locator('[aria-label="Fill colour"]').click();
      await app.page.waitForSelector(".cellfill-panel", { timeout: 10000 });
      await app.settle();
    },
    capture: {
      async clip(app) {
        return app.page.evaluate(() => {
          const p = document.querySelector(".cellfill-panel").getBoundingClientRect();
          const b = [...document.querySelectorAll(".railbtn")].find((x) => x.getAttribute("aria-label") === "Fill colour").getBoundingClientRect();
          const x = Math.max(0, Math.min(p.left, b.left) - 12);
          const y = Math.max(0, b.top - 10);
          return {
            x,
            y,
            width: Math.min(window.innerWidth - x, Math.max(p.right, b.right) + 12 - x),
            height: Math.min(window.innerHeight - y, p.bottom + 12 - y),
          };
        });
      },
    },
    marks: [
      { target: '[aria-label="Fill colour"]', label: "Fill — available once cells are selected; it colours the selected cells" },
      { target: ".cellfill-swatches", label: "Light backgrounds on purpose: the sheet's own dark text stays readable through them" },
    ],
  },
  {
    file: "data-sort-dialog.png",
    viewport: [1500, 950],
    async setup(app) {
      await app.boot();
      await app.openNode("Sample — dose vs response", "table.dg");
      await app.menu("Data", /^Sort rows by column…/);
      await app.page.waitForSelector('[aria-label="Sort by column"]', { timeout: 10000 });
      await app.settle();
    },
    capture: (app) => app.page.locator('[aria-label="Sort by column"]'),
    marks: [
      { target: '[aria-label="Sort column"]', label: "Which column to sort by" },
      { target: '[aria-label="Sort direction"]', label: "Ascending or descending. Blanks go last either way" },
    ],
  },
  {
    file: "data-transform-dialog.png",
    viewport: [1500, 1250],
    async setup(app) {
      await app.boot();
      await app.openNode("Sample — dose vs response", "table.dg");
      await app.menu("Data", /^Transform values…/);
      await app.page.waitForSelector('[aria-label="Transform data"]', { timeout: 10000 });
      await app.settle();
    },
    capture: (app) => app.page.locator('[aria-label="Transform data"]'),
    marks: [
      { target: '[aria-label="Function"]', label: "About fifty functions of Y (and of X), grouped by what they do rather than by name" },
      { target: { text: "Create dataset", closest: "button" }, label: "Create dataset — a new sheet. A transform never overwrites the one you have" },
    ],
  },

  // ─────────────── "Graphs and styling" — its chapters, in the task shape ───────────────
  //
  // The other pictures in this part show surfaces (the gallery, the toolbar, the series
  // panel, a graph wearing annotations, the preset/template/settings panels). These three are
  // the per-step ones: the control you press, and the state it leaves you in.
  //
  // Several other steps in these chapters need special handling, because a direct capture
  // would show something a reader never sees:
  //   • the toolbar's Insert list — it is a native <select> (aria-label "Insert annotation"), and
  //     an OS-drawn popup cannot be photographed, as with the datasheet's format chip. It has no
  //     picture.
  //   • the gradient editor — there is no "gradient" button on the heatmap's Chart tab; it is
  //     opened by choosing an option in a ramp picker (`graph-gradient-editor.png`, below).
  //   • the Reference lines list — a Bland-Altman's Chart tab has no `insp-reference-lines`
  //     section; the row is a `.frow` (`graph-refline-row.png`, below).
  //   • the figure's resize grips — three small marks (right edge, bottom edge, bottom-right
  //     corner), outside the `"figure"` crop; a 44px margin only brings in the toolbar and the
  //     Inspector around them, so their capture is clipped to the corner (below).
  //   • Frame ▸ Title & legend — the Position row measures 0 × 0 and cannot carry a call-out, so
  //     the chapter carries the position table (`graph-legend-panel.png`, below).
  //   • a one-element colour override, and the Data tab's fill section — each target must be a
  //     verified handle, because an unverified one either fails the run or, worse, resolves to
  //     the wrong row.
  // A step without a picture keeps its prose. A missing picture is a gap; a wrong one is
  // misleading, with a number beside it.
  {
    // Opened from a sheet, which is the whole point of the step: the dialog is about that sheet.
    // `new-datasheet-dialog.png` is the other half — the same dialog opened data-first, blank.
    file: "graph-newgraph-from-sheet.png",
    viewport: [1500, 1250],
    async setup(app) {
      await app.boot();
      await app.openNode("Sample — dose vs response", "table.dg");
      await app.menu("Graph", /^New graph of this data/);
      await app.page.waitForSelector(".ng-seg", { timeout: 10000 });
      await app.settle();
    },
    capture: (app) => app.page.locator('[aria-label="New graph"]').first(),
    marks: [
      { target: '[aria-label="Graph types"]', label: "Ranked by what really draws your sheet, with the best fit already selected" },
      // Note: not `.ng-preview` — that class only exists once sample data is on, and this dialog
      // is opened on a real sheet. The dialog's classes are ng-seg / ng-segbtn / ng-block /
      // ng-search / ng-analysis-note / ng-divider / ng-config / ng-picked.
      { target: ".ng-config", label: "The new graph's settings — with Data already pointing at the sheet you opened this from" },
    ],
  },
  {
    // A graph's type is a setting, and the control is the first row of the Chart tab.
    file: "graph-change-type.png",
    viewport: [1500, 1250],
    async setup(app) {
      await app.boot();
      await app.openGraph("Treatment bar chart");
      await openChartTab(app);
      // `#insp-chart-type` is a zero-size anchor, not the section's box (measured: 0 × 0), so
      // capturing or targeting it gives "not on screen" / "points at nothing". The panel clip plus
      // a text target is what the seven Axis captures already do, and it works.
      await onlySections(app, /Chart type/);
    },
    capture: panelClip(),
    marks: [
      { target: { text: "Type", within: ".inspbody", closest: "label" }, label: "The chart type — change it here; the data mapping is kept wherever the new type can use it" },
    ],
  },
  {
    // Editing a title in place: the edit box is the figure's own text, not a dialog.
    file: "graph-edit-in-place.png",
    viewport: [1400, 900],
    async setup(app) {
      await app.boot();
      await app.openGraph("Dose-response");
      await app.page.locator("svg.gfx-figure text").filter({ hasText: /Dose-response/ }).first().dblclick();
      await app.settle();
    },
    capture: "figure",
  },

  // ─────────────── "Statistics" — its chapters, in the task shape ───────────────
  //
  // This part's routes: the configure page through a goal tile, the power dialog, and the
  // Add-to-graph menu on a real result. The chapters quote numbers these captures show —
  // thirteen goal tiles, and an ANOVA offering exactly three things to add to a graph.
  //
  // The power dialog is captured further down (`stats-power-dialog.png`), not with a plain
  // boot. `Analyze ▸ Sample size & power…` live-calls the
  // engine's `power` method (`PowerDialog.tsx`), so with no Python sidecar its readout is a
  // dash — a dialog with a blank answer, which is the one thing that chapter is about, and a
  // state no user ever sees. (Changing the effect-size field does not trigger a local
  // computation.) Its capture uses a recorded `power` answer from
  // `scripts/record-guide-engine.mjs`, keyed by the request the dialog sends, and boots with
  // `bootWithEngine` — the same route `analysis-result.png` takes.
  {
    // The page every door in the Analyze dialog ends on. The chapter describes it at length; the
    // other two Analyze pictures show the landing page and the catalogue.
    file: "stats-configure-page.png",
    viewport: [1500, 1400],
    async setup(app) {
      await app.boot();
      await app.openNode("Sample — dose vs response", "table.dg");
      await app.menu("Analyze", /^Analyze…/);
      await app.page.waitForSelector('[aria-label="Analyze"]', { timeout: 10000 });
      await app.settle();
      // The first goal tile on an XY sheet is Dose-response, badged Recommended.
      await app.page.locator(".an-goals button").first().click();
      await app.settle();
    },
    // Note: the top of it. The whole page is 720 × 1311, mostly the column pickers and the
    // per-parameter constraints, and this step is about what comes before them: the test, its
    // variant, and the equation it will fit.
    capture: {
      async clip(app) {
        return app.page.evaluate(() => {
          const d = document.querySelector('[aria-label="Analyze"]').getBoundingClientRect();
          const eq = document.querySelector(".an-eqpreview");
          const bottom = eq ? eq.getBoundingClientRect().bottom + 14 : d.top + 320;
          const x = Math.max(0, d.left);
          const y = Math.max(0, d.top);
          return {
            x,
            y,
            width: Math.min(window.innerWidth - x, d.right - x),
            height: Math.min(window.innerHeight - y, bottom - y),
          };
        });
      },
    },
    marks: [
      { target: ".an-type-picker", label: "The variant — most methods have several, and each carries a note on when to use it and when not to" },
      { target: ".an-eqpreview", label: "The exact equation that will be fitted, before it is run" },
    ],
  },
  {
    // What a result can put on a graph — built from the result, so a different analysis offers a
    // different list. Needs the recorded engine answers; a browser has no Python sidecar.
    file: "stats-add-to-graph.png",
    viewport: [1500, 950],
    async setup(app) {
      await app.bootWithEngine(ENGINE.answers);
      await app.openNode("ANOVA — Vehicle, Low dose, High dose", ".ankey");
      await app.settle();
      await app.page.locator(".antb", { hasText: /Add to graph/ }).first().click();
      await app.page.waitForSelector(".antb-menupanel", { timeout: 10000 });
      await app.settle();
    },
    capture: {
      async clip(app) {
        return app.page.evaluate(() => {
          const m = document.querySelector(".antb-menupanel").getBoundingClientRect();
          const b = [...document.querySelectorAll(".antb")].find((x) => /Add to graph/.test(x.textContent ?? "")).getBoundingClientRect();
          const x = Math.max(0, Math.min(m.left, b.left) - 10);
          const y = Math.max(0, b.top - 10);
          return {
            x,
            y,
            width: Math.min(window.innerWidth - x, Math.max(m.right, b.right) + 10 - x),
            height: Math.min(window.innerHeight - y, m.bottom + 10 - y),
          };
        });
      },
    },
    marks: [
      { target: ".antb-menupanel", label: "Only what this result can draw — an ANOVA offers these three; a curve fit offers its curve" },
    ],
  },
  // ─────────────── "Finishing a figure" — its chapters, in the task shape ───────────────
  //
  // The four other pictures in this part are all of the assembler and the export dialog. This
  // one serves `reproducibility`.
  //
  // Note: `View ▸ Lineage` opens a tab (`openTab("lineage")`), not a dialog, so waiting on
  // `[role="dialog"]` would never succeed.
  {
    file: "finish-lineage.png",
    viewport: [1500, 1000],
    async setup(app) {
      await app.boot();
      await app.menu("View", /^Lineage/);
      await app.page.waitForSelector(".lineage", { timeout: 10000 });
      await app.settle();
    },
    capture: (app) => app.page.locator(".lineage"),
    marks: [
      { target: ".lineage-legend", label: "The key — what is current, and what has gone stale since the data changed under it" },
    ],
  },

  // ─────────────── "Reference" — its chapters, in the task shape ───────────────
  //
  // Most of this part is generated reference (the function index, the method registry, the key
  // table), so it needs few pictures. This one serves `help`, and the checklist is the point:
  // everything holding the user's data starts unticked, and a picture is the only way to show
  // that a privacy promise is kept by the dialog rather than by a sentence about it.

  // ─────────── further pictures for individual chapters ───────────
  //
  // The gradient editor and the assembler's layout picker are captured in the next group, whose
  // routes come from the code that draws them.
  {
    // The lines a chart draws for itself. Note: it is a `.frow` (282 × 33), not a section,
    // and its label is dynamic — "EC50 / IC50 marker" when the fit marker is a chart's only
    // reference line, "Reference lines" otherwise. A Bland-Altman has several, so it reads the
    // second way.
    file: "graph-refline-row.png",
    viewport: [1500, 1400],
    async setup(app) {
      await openGalleryChart(app, "Bland-Altman");
      await openChartTab(app);
      await app.page.evaluate(() => {
        document.querySelectorAll("details.inspsec > summary").forEach((s) => {
          if (!s.parentElement.open) s.click();
        });
      });
      await app.settle();
    },
    capture: {
      async clip(app) {
        return app.page.evaluate(() => {
          const el = [...document.querySelectorAll(".insp .frow")].find((e) => /Reference lines/.test(e.textContent ?? ""));
          const r = el.getBoundingClientRect();
          const x = Math.max(0, r.left - 10);
          const y = Math.max(0, r.top - 10);
          return {
            x,
            y,
            width: Math.min(window.innerWidth - x, r.right + 10 - x),
            height: Math.min(window.innerHeight - y, r.bottom + 10 - y),
          };
        });
      },
    },
    marks: [],
  },
  {
    // The Fill group on a bar series. Note: the fill-type control is called **Style**, not "Fill
    // type".
    file: "graph-fill-section.png",
    viewport: [1500, 1300],
    async setup(app) {
      await app.boot();
      await app.openGraph("Treatment bar chart");
      await app.page.locator('svg.gfx-figure .gfx-series [style*="cursor: pointer"]').first().click({ force: true });
      await app.settle();
      await dismissNudge(app);
    },
    capture: {
      async clip(app) {
        return app.page.evaluate(() => {
          const insp = document.querySelector(".insp");
          const groups = [...insp.querySelectorAll(".inspgroup")];
          const fill = groups.find((g) => /^▾?Fill/.test((g.textContent ?? "").trim()));
          const box = insp.getBoundingClientRect();
          const b = (fill ?? groups[1]).getBoundingClientRect();
          const x = Math.max(0, box.x);
          const y = Math.max(0, b.top - 8);
          return {
            x,
            y,
            width: Math.min(box.width, window.innerWidth - x),
            height: Math.min(b.bottom + 8 - y, window.innerHeight - y),
          };
        });
      },
    },
    marks: [
      { target: { text: "Style", within: ".inspbody", closest: "label" }, label: "Style — solid, two-tone, pattern, gradient, metallic, or graduated by value" },
    ],
  },
  {
    // "Colour, shape or label each point from a column" — the three groups on a ternary point, whose
    // gallery chart is itself coloured by texture class (so Colour by shows a real column, not None).
    file: "graph-colour-by-data.png",
    viewport: [1500, 1600],
    async setup(app) {
      await openGalleryChart(app, "Ternary plot");
      await app.page.locator('svg.gfx-figure [id^="mark-"] circle').first().click({ force: true });
      await app.settle();
      await dismissNudge(app);
    },
    capture: rowsClip("Colour by data", "Label points"),
    marks: [
      { target: { text: "Colour by", within: ".insp", closest: "label" }, label: "Colour by — the column; None removes it" },
      { target: { text: "Mapping", within: ".insp", closest: "label" }, label: "Mapping — Category (a colour per value) or Continuous (a ramp)" },
      { target: { text: "Shape by", within: ".insp", closest: "label" }, label: "Shape by — a marker shape per value" },
      { target: { text: "Label points", within: ".insp", closest: "label" }, label: "Label points — a column's text beside each point" },
    ],
  },
  {
    // "Style an UpSet plot's bars" — the Intersection bars rows, with one bar highlighted so the
    // three Highlight rows are on screen.
    file: "graph-upset-bars.png",
    viewport: [1500, 1600],
    async setup(app) {
      await openGalleryChart(app, "UpSet plot");
      // Click an intersection bar, as the step says — it opens the section holding the UpSet rows.
      await app.page.locator("svg.gfx-figure .gfx-series rect").first().click({ force: true });
      await app.settle();
      await dismissNudge(app);
      await app.selectValue("Highlight bar", "ix-1");
      await app.settle();
    },
    capture: rowsClip("Intersection bars", "Highlight outline"),
    marks: [
      { target: { text: "Bar shape", within: ".insp", closest: "label" }, label: "Bar shape and Bar width — the bar chart's own rows" },
      { target: { text: "Bar fill", within: ".insp", closest: "label" }, label: "Bar fill — Solid or Two-tone" },
      { target: { text: "Outline width", within: ".insp", closest: "label" }, label: "Outline colour and width — a contour round every bar" },
      { target: { text: "Highlight bar", within: ".insp", closest: "label" }, label: "Highlight bar — one intersection, by its sets" },
      { target: { text: "Highlight colour", within: ".insp", closest: "label" }, label: "That bar's own colour, opacity and outline" },
    ],
  },
  {
    // "Set the type" — a heatmap's two titles, typed and styled in its own section.
    file: "graph-heatmap-titles.png",
    viewport: [1500, 2400],
    async setup(app) {
      await app.boot();
      await app.openGraph("Gene expression heatmap");
      await app.page.locator("svg.gfx-figure").click({ position: { x: 60, y: 20 } });
      await app.settle();
      await dismissNudge(app);
      await app.openSections(/Heatmap/);
      for (const [label, text] of [["Column axis title", "Samples"], ["Row axis title", "Genes"]]) {
        const ok = await app.page.evaluate(([l, v]) => {
          const span = [...document.querySelectorAll(".insp .frow > span")].find((s) => s.textContent === l);
          const input = span?.parentElement?.querySelector("input");
          if (!input) return false;
          Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, v);
          input.dispatchEvent(new Event("input", { bubbles: true }));
          return true;
        }, [label, text]);
        if (!ok) throw new Error(`graph-heatmap-titles: no "${label}" box`);
        await app.settle();
      }
    },
    capture: rowsClip("Column axis title", "Row title ↔ labels"),
    marks: [
      { target: { text: "Column axis title", within: ".insp", closest: "label" }, label: "Column axis title — type it here" },
      { target: { text: "Column title font", within: ".insp" }, label: "Its font rows appear once it has words" },
      { target: { text: "Row title font", within: ".insp" }, label: "The row title's own font" },
      { target: { text: "Row title ↔ labels", within: ".insp", closest: "label" }, label: "Row title ↔ labels — the space beside the row names" },
    ],
  },
  {
    // The scope boxes — the two tickboxes that decide whether the next edit lands on one
    // element, one series, or every series. The chapter's "style one point on its own" step is
    // about exactly these.
    file: "graph-scope-boxes.png",
    viewport: [1500, 1300],
    async setup(app) {
      await app.boot();
      await app.openGraph("Treatment bar chart");
      await app.page.locator('svg.gfx-figure .gfx-series [style*="cursor: pointer"]').first().click({ force: true });
      await app.settle();
      await dismissNudge(app);
    },
    capture: {
      async clip(app) {
        return app.page.evaluate(() => {
          const insp = document.querySelector(".insp");
          const rows = [...insp.querySelectorAll("label, .frow")].filter((e) => /Apply to whole/.test(e.textContent ?? ""));
          if (rows.length === 0) throw new Error("no scope rows — the panel is not on a series");
          const top = Math.min(...rows.map((r) => r.getBoundingClientRect().top));
          const bottom = Math.max(...rows.map((r) => r.getBoundingClientRect().bottom));
          const box = insp.getBoundingClientRect();
          const x = Math.max(0, box.x);
          const y = Math.max(0, top - 10);
          return {
            x,
            y,
            width: Math.min(box.width, window.innerWidth - x),
            height: Math.min(bottom + 10 - y, window.innerHeight - y),
          };
        });
      },
    },
    marks: [],
  },

  // ───────── pictures whose routes come from the source ─────────
  //
  // Each route below is taken from the code that draws the control:
  //   • the gradient editor is not a button at all — it is the option `__edit_gradient__` at the
  //     tail of every ramp `<select>` (`EDIT_RAMP` / `rampOptions` in Inspector.tsx);
  //   • the Layout picker is `.laychip` → `.laypreset-pop` → `.laypreset-item`;
  //   • the figure's resize grips are `g.gfx-figresize`;
  //   • the power dialog computes in the engine, so `record-guide-engine.mjs` opens it during
  //     its recording pass and the answer is replayed here.
  {
    // The editor is opened by choosing an option, not by pressing a button: every ramp picker
    // ends with "Edit / new gradient…", whose value is `__edit_gradient__`, and the Inspector
    // intercepts it rather than storing it.
    file: "graph-gradient-editor.png",
    viewport: [1500, 1400],
    async setup(app) {
      await app.boot();
      await app.openGraph("Gene expression heatmap");
      await openChartTab(app);
      await app.page.evaluate(() => {
        document.querySelectorAll("details.inspsec > summary").forEach((s) => {
          if (!s.parentElement.open) s.click();
        });
      });
      await app.settle();
      const opened = await app.page.evaluate(() => {
        const sel = [...document.querySelectorAll(".insp select")].find((s) =>
          [...s.options].some((o) => o.value === "__edit_gradient__"),
        );
        if (!sel) return false;
        const set = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
        set.call(sel, "__edit_gradient__");
        sel.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      });
      if (!opened) throw new Error("no ramp picker offers __edit_gradient__ on this tab");
      await app.page.waitForSelector('[aria-label="Gradient editor"], .gradeditor, .modal-gradient', { timeout: 10000 });
      await app.settle();
    },
    capture: (app) => app.page.locator('[aria-label="Gradient editor"], .gradeditor, .modal-gradient').first(),
    marks: [],
  },
  {
    // The assembler's figure-shape picker. Note: `.laychip` is the button and `.laypreset-pop` the
    // popover; the `laypick*` classes belong to unrelated bars.
    file: "figure-layout-picker.png",
    viewport: [1500, 1100],
    async setup(app) {
      await buildFourPanelFigure(app);
      await app.page.locator(".laychip", { hasText: /Layout/ }).first().click();
      await app.page.waitForSelector(".laypreset-pop", { timeout: 10000 });
      await app.settle();
    },
    capture: {
      async clip(app) {
        return app.page.evaluate(() => {
          const pop = document.querySelector(".laypreset-pop").getBoundingClientRect();
          const chip = document.querySelector(".laychip").getBoundingClientRect();
          const x = Math.max(0, Math.min(pop.left, chip.left) - 10);
          const y = Math.max(0, chip.top - 10);
          return {
            x,
            y,
            width: Math.min(window.innerWidth - x, Math.max(pop.right, chip.right) + 10 - x),
            height: Math.min(window.innerHeight - y, pop.bottom + 10 - y),
          };
        });
      },
    },
    marks: [
      { target: ".laypreset-pop", label: "One thumbnail per figure shape — a grid, a wide panel on top, a tall panel at the left — for the number of graphs you have" },
    ],
  },
  {
    // The figure's own resize grips: a right-edge, a bottom-edge and a bottom-right corner grip,
    // drawn as `g.gfx-figresize`. Note: clipped to the corner — the whole figure plus 44px of
    // margin shows three specks with the toolbar and the Inspector around them.
    file: "graph-resize-grips.png",
    viewport: [1400, 900],
    async setup(app) {
      await app.boot();
      await app.openGraph("Dose-response");
      await app.page.locator("svg.gfx-figure").click({ position: { x: 60, y: 20 } });
      await app.settle();
      await app.page.waitForSelector("g.gfx-figresize", { timeout: 10000 });
    },
    capture: {
      async clip(app) {
        return app.page.evaluate(() => {
          const g = document.querySelector("g.gfx-figresize").getBoundingClientRect();
          const m = 90;
          const x = Math.max(0, g.right - m * 3);
          const y = Math.max(0, g.bottom - m * 2);
          return {
            x,
            y,
            width: Math.min(window.innerWidth - x, g.right + 24 - x),
            height: Math.min(window.innerHeight - y, g.bottom + 24 - y),
          };
        });
      },
    },
    marks: [],
  },
  {
    // With the recorded engine. The dialog live-calls `runAnalysis("power", …)` on mount, so
    // without a recorded answer its readout is a dash — a picture of a blank answer, which is the
    // one thing that chapter is about. Changing the effect-size field does not compute locally.
    file: "stats-power-dialog.png",
    viewport: [1500, 950],
    async setup(app) {
      await app.bootWithEngine(ENGINE.answers);
      await app.menu("Analyze", /^Sample size & power…/);
      await app.page.waitForSelector('[aria-label="Sample size and power"]', { timeout: 10000 });
      // Wait for the answer, not for the dialog. It debounces its engine call, so two
      // animation frames fire the shutter while the readout is still the placeholder dash —
      // which is exactly the picture this capture must avoid.
      await app.page.waitForTimeout(2000);
      await app.settle();
    },
    capture: (app) => app.page.locator('[aria-label="Sample size and power"]'),
    marks: [
      { target: '[aria-label="Design"]', label: "Which experiment you are planning" },
      { target: '[aria-label="Solve for"]', label: "Solve for n, or for the power you would have with the n you can afford" },
    ],
  },

  {
    // The bug reporter's checklist.
    //
    // Seven of the nine rows, and the caption says so. `analysis`, `screenshot` and `document`
    // are conditional. The `analysis` row needs an analysis tab in front, and with one in front
    // the Help menu does not open under automation (neither the menu bar, the command palette
    // nor Escape first opens the dialog), so that row, which the chapter tells the reader to
    // tick for a wrong number, is not in the picture.
    file: "help-bug-report.png",
    viewport: [1500, 1300],
    async setup(app) {
      await app.boot();
      await app.menu("Help", /^Report a bug…/);
      await app.page.waitForSelector('[aria-label="Report a bug"]', { timeout: 10000 });
      await app.settle();
    },
    capture: (app) => app.page.locator('[aria-label="Report a bug"]'),
    marks: [],
  },
  {
    // Frame ▸ Title & legend, where the legend's Position lives (Direct labels included).
    // Note: the whole panel, not the section. Clipping to the section's own box produces a blank
    // rectangle (the flat-colour guard rejects it), and the Position row inside it measures
    // 0 × 0, so it cannot carry a call-out either. The panel clip is what the seven Axis
    // captures use and it renders; the chapter carries the position list as a table.
    file: "graph-legend-panel.png",
    viewport: [1500, 1400],
    async setup(app) {
      await app.boot();
      await app.openGraph("Dose-response");
      await openInspectorTab(app, "Frame");
      await app.page.evaluate(() => {
        for (const s of document.querySelectorAll("details.inspsec > summary")) {
          const want = /Title & legend/.test(s.textContent ?? "");
          if (want !== s.parentElement.open) s.click();
        }
      });
      await app.settle();
    },
    capture: panelClip(),
    marks: [],
  },

];

/** The four-panel figure two captures both need. */
async function buildFourPanelFigure(app) {
  await app.boot();
  await app.expandTree();
  await app.menu("Insert", /^New layout/);
  await app.page.waitForSelector(".laycard", { timeout: 10000 });
  await app.settle();
  await app.page.evaluate(() => {
    [...document.querySelectorAll(".laycard")].slice(0, 4).forEach((c) => c.click());
  });
  await app.settle();
  await app.page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /Build \/ Arrange/.test(x.textContent ?? ""));
    if (!b) throw new Error("no Build / Arrange button");
    b.click();
  });
  await app.page.waitForSelector(".laypanel", { timeout: 10000 });
  await app.settle();
  // A tidy 2-column tiling reads better than the free-drag default in a still image.
  await app.selectValue("Columns", "2");
}

/**
 * Open the Inspector dock. It ships collapsed (a fresh profile, which is what these captures use), and with it collapsed
 * the figure page keeps its own settings in a third toolbar row. The figure pictures show
 * the page as designed — the toolbar's two rows and the figure's settings in the Inspector — so they open it, as the
 * reader must to reach those settings.
 */
async function openInspectorDock(app) {
  const expand = app.page.locator('button[title="Expand Inspector"]');
  if (await expand.count()) {
    await expand.first().click();
    await app.settle();
  }
}

/**
 * Reaching the document the way `e2e/app.ts` does: walk the fiber for the app's own handlers,
 * so a change made here goes through the real mutation path (undoable, scene rebuilt).
 */
const FIBER = `
  const __root = () => document.getElementById('root');
  const __fiber = () => { const r = __root(); const k = r && Object.keys(r).find((x) => x.startsWith('__reactContainer')); if (!k) return null; const a = r[k]; return a && a.stateNode && a.stateNode.current ? a.stateNode.current : a; };
  const __walk = (pred) => { const seen = new Set(); let hit = null; const go = (n, d) => { if (!n || d > 120 || hit || seen.has(n)) return; seen.add(n); const p = n.memoizedProps; if (p && typeof p === 'object') { const v = pred(p); if (v !== undefined && v !== null) { hit = v; return; } } go(n.child, d + 1); go(n.sibling, d); }; go(__fiber(), 0); return hit; };
  const __ops = () => __walk((p) => (p.annotationOps && typeof p.annotationOps.update === 'function' ? p.annotationOps : null));
  const __anns = () => { const proj = __walk((p) => (p.project && Array.isArray(p.project.plots) ? p.project : null)); const id = __walk((p) => (typeof p.plotId === 'string' ? p.plotId : null)); return proj.plots.find((x) => x.id === id).annotations ?? []; };
`;
