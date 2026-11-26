/**
 * The driver behind `scripts/gen-guide-shots.mjs` — everything that knows how to work the app,
 * kept apart from `guide-shots.spec.mjs`, which says what to capture.
 *
 * The split keeps a spec entry short: this file, this setup, capture this, mark these. Adding a
 * picture does not require reading one long imperative run to find where the app has got to.
 *
 * Note: headless only. Headless Chromium composites off-screen and screenshots reliably; a
 * capture that depends on a visible browser window does not.
 */

/**
 * Build the helper object handed to every spec entry's `setup`.
 *
 * @param {import("@playwright/test").Page} page
 * @param {string} base  the served bundle's URL
 */
export function makeApp(page, base) {
  const settle = () =>
    page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))));

  /** Load (or reload) the app fresh — the tree folded, nothing selected. */
  async function boot() {
    await page.goto(base, { timeout: 20000 });
    await page.waitForSelector(".nav", { timeout: 20000 });
    await settle();
  }

  /**
   * Boot with the recorded engine answers standing in for the Python sidecar.
   *
   * No test-only hook in the app — the same rule as `importSample`. What is stubbed is
   * `window.mady.runAnalysis`, the preload bridge, which is the one thing a browser genuinely
   * does not have; everything after it (the fill-on-boot loop, the result pane, the key-result
   * cards) is the production path. The answers themselves were computed by the real engine
   * (`scripts/record-guide-engine.mjs`), so the numbers in the picture are MadY's own.
   *
   * The stub is installed with `addInitScript`, before the page loads: the demo project's
   * analyses are computed on mount, so a stub added after `boot()` would arrive too late and
   * the picture would be of an empty pane.
   *
   * Keyed by the whole request. An unrecorded question is answered with an error, never with
   * another analysis's numbers — a wrong result in a manual is worse than a missing one, and
   * the call-outs then fail the run rather than photographing it.
   */
  async function bootWithEngine(answers) {
    await page.addInitScript((rows) => {
      const byRequest = new Map(rows.map((a) => [`${a.method}\u0000${a.request}`, a.results]));
      window.mady = window.mady ?? {};
      window.mady.runAnalysis = (method, data) => {
        const hit = byRequest.get(`${method}\u0000${JSON.stringify(data)}`);
        return Promise.resolve(
          hit
            ? { ok: true, results: hit }
            : { ok: false, message: `no recorded engine answer for "${method}" — re-run scripts/record-guide-engine.mjs` },
        );
      };
    }, answers);
    await boot();
  }

  /** Expand every collapsed Navigator row (same loop as e2e/app.ts expandTree). */
  async function expandTree() {
    for (let pass = 0; pass < 6; pass++) {
      const opened = await page.evaluate(() => {
        const collapsed = [...document.querySelectorAll("button.twist")].filter((t) =>
          t.querySelector("svg.lucide-chevron-right"),
        );
        collapsed.forEach((t) => t.click());
        return collapsed.length;
      });
      if (opened === 0) return;
      await settle();
    }
  }

  /** Open any tree node by its exact Navigator label, via the button's React onClick (see
   *  e2e/app.ts), then wait for `waitSel` to prove the right view mounted. */
  async function openNode(label, waitSel) {
    await expandTree();
    const ok = await page.evaluate((wanted) => {
      const t = [...document.querySelectorAll("button.navlabelbtn")].find(
        (b) => (b.textContent ?? "").trim() === wanted,
      );
      if (!t) return false;
      const k = Object.keys(t).find((x) => x.startsWith("__reactProps"));
      t[k].onClick?.({ stopPropagation() {}, preventDefault() {} });
      return true;
    }, label);
    if (!ok) throw new Error(`openNode: no navigator entry "${label}"`);
    await page.waitForSelector(waitSel, { timeout: 15000 });
    await settle();
  }

  /** Open a graph by its exact Navigator label. */
  const openGraph = (label) => openNode(label, "svg.gfx-figure");

  /** Open a top menu and click one of its items (labels can be regexes). Items nested under a
   *  submenu row (e.g. Analyze → Common analyses → Dose-response…) are found by opening each
   *  submenu parent until the label appears — same approach as e2e/app.ts. */
  async function menu(name, item) {
    await page.locator(".menubar .menu", { hasText: new RegExp(`^${name}$`) }).click();
    const target = page.locator(".dropdown .dropitem", { hasText: item });
    if ((await target.count()) === 0) {
      const parents = page.locator(".dropdown .dropsub");
      const n = await parents.count();
      for (let i = 0; i < n; i++) {
        await parents.nth(i).click();
        if ((await target.count()) > 0) break;
      }
    }
    await target.first().click();
    await settle();
  }

  /** Set a text input through React's native value setter, so onChange really fires. */
  async function typeInto(ariaLabel, value) {
    const ok = await page.evaluate(([label, v]) => {
      const el = [...document.querySelectorAll("input")].find(
        (i) => i.getAttribute("aria-label") === label || i.getAttribute("placeholder") === label,
      );
      if (!el) return false;
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      set.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }, [ariaLabel, value]);
    if (!ok) throw new Error(`typeInto: no input labelled "${ariaLabel}"`);
    await settle();
  }

  /** Set a `<select>` through React's native value setter. */
  async function selectValue(match, value) {
    const ok = await page.evaluate(([m, v]) => {
      const el = [...document.querySelectorAll("select")].find(
        (s) => s.getAttribute("aria-label") === m || (s.closest("label")?.textContent ?? "").includes(m),
      );
      if (!el) return false;
      const set = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
      set.call(el, v);
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }, [match, value]);
    if (!ok) throw new Error(`selectValue: no select matching "${match}"`);
    await settle();
  }

  /** Open the Inspector's sections whose summary matches, so a capture shows content. */
  async function openSections(pattern) {
    await page.evaluate((re) => {
      const rx = new RegExp(re);
      for (const d of document.querySelectorAll("details.inspsec")) {
        if (rx.test(d.querySelector("summary")?.textContent ?? "")) d.open = true;
      }
    }, pattern.source ?? String(pattern));
    await settle();
  }

  /**
   * Open the import preview on a small bundled CSV, through the real command.
   *
   * No test-only hook in the app. `File ▸ Import data…` calls `window.mady.importData()` —
   * the preload bridge — and what is stubbed here is that bridge, which is exactly the OS file
   * dialog headless Chromium does not have. Everything after it is the production path.
   *
   * Note: `path` matters: the "Keep linked to file (auto-update)" tickbox only exists for a file
   * import, so a picture taken through the paste door would silently omit a control the manual
   * describes. A semicolon delimiter, a comma decimal, a comment line and a units row, so the
   * options in the picture are visibly doing something.
   */
  async function importSample() {
    await page.evaluate(() => {
      // The served bundle has no Electron preload, so there is no bridge at all here. Creating
      // the one method the command calls is exactly what the preload would have provided.
      window.mady = window.mady ?? {};
      const text = [
        "# instrument export — run 2026-09-06",
        "Time;Control;Treated",
        "s;%;%",
        "0;1,4;1,6",
        "15;12,8;24,1",
        "30;25,3;48,7",
        "45;38,9;66,2",
        "60;47,1;79,5",
      ].join("\n");
      window.mady.importData = () =>
        Promise.resolve({ ok: true, source: "text", name: "kinetics.csv", text, path: "C:/runs/kinetics.csv" });
    });
    await menu("File", /^Import data…/);
    await page.waitForSelector(".modal-import", { timeout: 10000 });
    await settle();
  }

  /** Select a rectangle of datasheet cells, from (r0,c0) to (r1,c1) — 0-based over the grid. */
  async function selectBlock(r0, c0, r1, c1) {
    const cell = (r, c) => `table.dg tbody tr:nth-child(${r + 1}) td.dgcell:nth-of-type(${c + 1})`;
    await page.locator(cell(r0, c0)).first().hover();
    await page.mouse.down();
    await page.locator(cell(r1, c1)).first().hover();
    await page.mouse.up();
    await settle();
  }

  /**
   * Right-click the nth match of a selector, and wait for the datasheet's menu to appear.
   *
   * Uses a real right-click (`click({ button: "right" })`); see the note inside for why a
   * synthetic `contextmenu` event is not used.
   */
  async function rightClick(selector, nth = 0, { select = true } = {}) {
    const el = page.locator(selector).nth(nth);
    // A left click first, so the cell menu acts on a real selection. Caution: not on a header —
    // a click there opens the rename editor, which then owns the keyboard and swallows the
    // context menu, so the wait for the menu times out.
    if (select) {
      await el.click();
      await settle();
    }
    // A real right-click, not `dispatchEvent("contextmenu", { clientX, clientY })`.
    //
    // The menu is placed at `e.clientX / e.clientY` (`DataGrid.tsx`, `position: fixed`), and a
    // synthetic event does not carry them, so the menu would land far below a 1000px viewport —
    // off screen, making its element screenshot a blank white rectangle with numbered call-outs
    // over nothing, while the marks still resolve (a fixed element off screen has a real box) and
    // the run still reports success. `gen-guide-shots.mjs` refuses a single-colour capture for
    // this reason.
    await el.click({ button: "right" });
    await page.waitForSelector(".dgmenu", { timeout: 10000 });
    await settle();
  }

  const viewport = async (width, height) => {
    await page.setViewportSize({ width, height });
    await settle();
  };

  return {
    page, settle, boot, bootWithEngine, expandTree, openNode, openGraph, menu, typeInto, selectValue,
    openSections, viewport, importSample, selectBlock, rightClick,
  };
}

/**
 * Resolve one call-out target to a viewport rectangle.
 *
 * The forms are the ones the app actually provides a handle on:
 *   • a CSS selector string           — `".menubar"`, `"svg.gfx-figure"`
 *   • `{ tool: "save" }`              — a toolbar button, by the id it carries (`data-tool`)
 *   • `{ section: "title-legend" }`   — an Inspector section, by its slug (`inspectorSectionId`)
 *   • `{ text, within?, closest? }`    — the element whose own text is `text`, optionally inside
 *                                       `within`. The `label.frow > span` convention of
 *                                       `e2e/app.ts`, and what reaches `.dropitem`, `summary`,
 *                                       `.dgmenu-i`, `.grbbtn`, `.laychip`.
 *                                       Note: it matches the smallest element carrying the text —
 *                                       which for a group caption is the caption, not the group.
 *                                       `closest` walks up from there to the container you mean
 *                                       (`{ text: "Layout", closest: ".laygroup" }`), so a
 *                                       call-out can point at a strip of controls by its label.
 *   • `{ sel, closest? }`            — a CSS selector, optionally walked up to a container
 *                                       (`{ sel: '[aria-label="Break start"]', closest: ".frow" }`
 *                                       boxes the whole from/to/Add-cut row, not one input).
 *   • `{ nth, of }`                   — the nth match of a selector (the third gallery card).
 *
 * Returns null when nothing matches or the match has no area. The caller fails the run on
 * that: a picture with a numbered box over nothing is worse than no picture, because the legend
 * still claims the box means something.
 */
export async function resolveTarget(page, target) {
  return page.evaluate((t) => {
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 ? { x: r.x, y: r.y, w: r.width, h: r.height } : null;
    };
    if (typeof t === "string") return box(document.querySelector(t));
    // `{ sel, closest }` - a CSS selector, then walk up to the container you mean. Three of the
    // Axis tab's rows have no findable text at all (a "from" box, a "to" box and an Add button
    // inside a bare `<div className="frow">`), so the only handle on them is an input's
    // aria-label - and boxing one 70-px input while the legend says "from / to / Add cut" would
    // be a call-out pointing at a third of what it names.
    if (t.sel) {
      const hit = document.querySelector(t.sel);
      return box(t.closest && hit ? hit.closest(t.closest) : hit);
    }
    if (t.tool) return box(document.querySelector(`[data-tool="${t.tool}"]`));
    if (t.section) {
      // Both levels answer to one target form: an Inspector section (`insp-…`) or one of the
      // lighter groups inside a panel (`inspsub-…`). The Axis tab is built entirely from groups.
      // Note: a title ending in a bracket slugs with a trailing dash — "Breaks (cuts)" is
      // `breaks-cuts-`, because the closing bracket is a non-alphanumeric run like any other.
      // The slug is also the key the collapsed/expanded state is stored under, so changing it
      // would reset every user's panels; the capture accepts either spelling.
      // Keep the braces: without them only the `for` belongs to the `if`, and the `return null`
      // below would run for every target, dropping call-outs from unrelated shots.
      for (const id of [`insp-${t.section}`, `inspsub-${t.section}`, `insp-${t.section}-`, `inspsub-${t.section}-`]) {
        const hit = box(document.getElementById(id));
        if (hit) return hit;
      }
      return null;
    }
    if (t.nth != null && t.of) return box(document.querySelectorAll(t.of)[t.nth]);
    if (t.text) {
      const scope = t.within ? document.querySelector(t.within) : document;
      if (!scope) return null;
      const wanted = t.text.toLowerCase();
      // The smallest element carrying the text — otherwise the match is <body>, and the box
      // covers the whole window while looking like it worked.
      const hits = [...scope.querySelectorAll("*")].filter((el) => {
        const own = (el.textContent ?? "").trim().toLowerCase();
        return own.includes(wanted) && ![...el.children].some((c) => (c.textContent ?? "").toLowerCase().includes(wanted));
      });
      // The first hit with area, not simply the first. The Inspector puts a zero-size anchor
      // (`#insp-chart-type`, 0 × 0 — it exists for the "?" deep links and the section targets)
      // ahead of the control it names, so taking `hits[0]` blindly would make a valid target
      // report "points at nothing" while the control sits two nodes later. An invisible earlier
      // match must not mask a visible one; a target that matches nothing visible still fails,
      // which is the property this whole resolver exists for.
      //
      // Note: it tests exactly what will be returned — the element after `closest` has been
      // walked, not the text node's own box. Testing the hit and falling back to it when
      // `closest` finds nothing would choose the section's `<summary>` ("Chart type" contains
      // "type"), whose `closest("label")` is null — so the resolver would return nothing while
      // the real Type row sits one hit later.
      const resolved = (el) => (t.closest ? el.closest(t.closest) : el);
      const withArea = (el) => {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      //
      // `closest` is still the difference between boxing a 40-px caption and boxing the eleven
      // controls under it; without it, call-outs aimed at a strip of controls would sit on
      // their labels.
      return box(hits.map(resolved).find(withArea) ?? resolved(hits[0] ?? null));
    }
    return null;
  }, target);
}
