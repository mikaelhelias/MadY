import { expect, test } from "@playwright/test";
import { collectErrors, MadyApp } from "./app";

/**
 * Panel assembly in a real browser.
 *
 * `LayoutPane.test.tsx` covers the assembler's geometry in jsdom, but jsdom cannot prove a
 * drag commits: it has no layout engine, so `getBoundingClientRect` is all zeros and
 * `getScreenCTM` is absent. Panel drag, panel resize and label drag are the three
 * highest-risk interactions in the figure builder, and only this layer can test them.
 *
 * Every assertion here reads the document (via the fiber) rather than the DOM, so a drag
 * that merely moves pixels without committing a mutation fails.
 */
test.describe("panel assembly — real drags commit to the document", () => {
  test.beforeEach(async ({ page }) => {
    await collectErrors(page);
  });

  test("the Arrange header keeps Caption and Export on screen at a narrow window (the row wraps, never clips)", async ({ page }) => {
    // Guards against the header row (name · Choose graphs · Add graph · Add image · Linked ·
    // Caption · Export) running past the right edge at the default Electron window, which leaves
    // the Export button off screen with no scrollbar to reach it.
    const app = new MadyApp(page);
    await app.open();
    await app.newFigure(["Dose-response", "Treatment bar chart"]);
    await page.setViewportSize({ width: 1024, height: 768 }); // narrower than the row can be on one line
    await app.settle();
    const exportBtn = page.locator('.paneact[title^="Export this figure"]');
    const caption = page.locator(".paneact", { hasText: /^Caption$/ });
    for (const [what, loc] of [["Export", exportBtn], ["Caption", caption]] as const) {
      const box = (await loc.boundingBox())!;
      expect(box, `${what} button has no box`).toBeTruthy();
      expect(box.x + box.width, `${what} button runs past the window's right edge`).toBeLessThanOrEqual(1024);
      expect(box.x, `${what} button is left of the window`).toBeGreaterThanOrEqual(0);
    }
    await exportBtn.click();
    await expect(page.locator(".modalov")).toHaveCount(1); // it can be pressed
    expect(await app.consoleErrors()).toEqual([]);
  });

  test("dragging a panel commits a panelPositions entry", async ({ page }) => {
    const app = new MadyApp(page);
    await app.open();
    await app.newFigure(["Dose-response", "Treatment bar chart"]);

    const before = await app.layout();
    expect(before?.panels).toHaveLength(2);

    const panel = page.locator(".laypanel").first();
    await panel.scrollIntoViewIfNeeded();
    const box = (await panel.boundingBox())!;
    // Grab an empty corner of the card, away from the graph's own drag targets.
    await app.dragBy({ x: box.x + 6, y: box.y + box.height - 6 }, 70, 40);

    const after = await app.layout();
    const pos = after?.panelPositions as Record<string, { x: number; y: number }> | undefined;
    expect(pos, "the drag must commit a panelPositions entry, not just move pixels").toBeTruthy();
    expect(Object.keys(pos!).length).toBeGreaterThan(0);
    expect(await app.consoleErrors()).toEqual([]);
  });

  test("the canvas ruler labels in px / inch / cm", async ({ page }) => {
    const app = new MadyApp(page);
    await app.open();
    await app.newFigure(["Dose-response", "Treatment bar chart"]);

    // The ruler is on by default; its top band is the first .layruler svg.
    await page.waitForSelector(".layruler");
    const maxLabel = async () =>
      page.evaluate(() => {
        const top = document.querySelectorAll(".layruler")[0];
        const ns = [...top!.querySelectorAll("text")].map((t) => parseFloat(t.textContent ?? ""));
        return ns.length ? Math.max(...ns) : 0;
      });
    const corner = () => page.locator(".layruler-corner").textContent();

    const px = await maxLabel();
    expect(px, "px ruler had no ticks").toBeGreaterThan(50);
    expect((await corner())?.trim()).toBe("px");

    await page.locator(".laychip-unit").selectOption("in");
    await app.settle();
    const inch = await maxLabel();
    expect((await corner())?.trim()).toBe("in");
    expect(inch, "inch labels not ~ px/96").toBeGreaterThan(px / 96 * 0.6);
    expect(inch).toBeLessThan(px / 96 * 1.6);

    await page.locator(".laychip-unit").selectOption("cm");
    await app.settle();
    const cm = await maxLabel();
    expect((await corner())?.trim()).toBe("cm");
    expect(cm).toBeGreaterThan(inch);
    expect(await app.consoleErrors()).toEqual([]);
  });

  test("a panel still follows the cursor 1:1 when the canvas is zoomed", async ({ page }) => {
    const app = new MadyApp(page);
    await app.open();
    await app.newFigure(["Dose-response", "Treatment bar chart"]);

    // Zoom the canvas to 50% through the ribbon slider.
    await page.evaluate(() => {
      const el = document.querySelector(".laychip-zoom input[type=range]") as HTMLInputElement;
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
      set.call(el, "0.5");
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await app.settle();

    const panel = page.locator(".laypanel").first();
    const before = (await panel.boundingBox())!;
    // Drag from an empty card corner into open space (down + right, away from panel B → no snap).
    const dx = 60, dy = 90;
    await app.dragBy({ x: before.x + 6, y: before.y + before.height - 6 }, dx, dy);
    const after = (await panel.boundingBox())!;

    // The panel must move by the cursor's screen delta — not dx*zoom. If the handlers forgot to
    // divide the screen delta by the zoom, a 50% canvas would move the panel only half as far on
    // screen as the cursor. Tolerance covers snap nudges + rounding.
    expect(Math.abs(after.x - before.x - dx), "panel x did not track the cursor under zoom").toBeLessThan(12);
    expect(Math.abs(after.y - before.y - dy), "panel y did not track the cursor under zoom").toBeLessThan(12);
    expect(await app.consoleErrors()).toEqual([]);
  });

  test("dragging a panel's resize handle commits a panelSizes entry", async ({ page }) => {
    const app = new MadyApp(page);
    await app.open();
    await app.newFigure(["Dose-response", "Treatment bar chart"]);

    const handle = page.locator(".laypanel-resize").first();
    await handle.scrollIntoViewIfNeeded();
    const box = (await handle.boundingBox())!;
    await app.dragBy({ x: box.x + box.width / 2, y: box.y + box.height / 2 }, 60, 45);

    const sizes = (await app.layout())?.panelSizes as Record<string, { w: number; h: number }> | undefined;
    expect(sizes, "resizing must re-lay-out the plot at a stored size").toBeTruthy();
    const first = Object.values(sizes!)[0]!;
    expect(first.w).toBeGreaterThan(0);
    expect(first.h).toBeGreaterThan(0);
    expect(await app.consoleErrors()).toEqual([]);
  });

  test("dragging a panel letter commits a labelPos entry", async ({ page }) => {
    const app = new MadyApp(page);
    await app.open();
    await app.newFigure(["Dose-response", "Treatment bar chart"]);

    const label = page.locator(".laypanel-letter").first();
    await label.scrollIntoViewIfNeeded();
    const box = (await label.boundingBox())!;
    await app.dragBy({ x: box.x + box.width / 2, y: box.y + box.height / 2 }, 55, 35);

    const labelPos = (await app.layout())?.labelPos as Record<string, { x: number; y: number }> | undefined;
    expect(labelPos, "the label drag must commit a labelPos entry").toBeTruthy();
    expect(Object.keys(labelPos!).length).toBeGreaterThan(0);
    expect(await app.consoleErrors()).toEqual([]);
  });

  test("double-clicking a panel letter and retyping it commits a letterText override", async ({ page }) => {
    const app = new MadyApp(page);
    await app.open();
    await app.newFigure(["Dose-response", "Treatment bar chart"]);

    const label = page.locator(".laypanel-letter").first();
    await label.scrollIntoViewIfNeeded();
    await expect(label).toHaveText("A");
    await label.dblclick();

    const input = page.locator(".laypanel-letter-in");
    await expect(input).toBeVisible();
    await input.fill("(a i)");
    await input.press("Enter");
    await app.settle();

    const letterText = (await app.layout())?.letterText as Record<string, string> | undefined;
    expect(letterText, "retyping a label must reach the document").toBeTruthy();
    expect(Object.values(letterText!)).toContain("(a i)");
    // …and the figure shows it (the export reads the letter text straight off this element)
    await expect(page.locator(".laypanel-letter").first()).toHaveText("(a i)");
    expect(await app.consoleErrors()).toEqual([]);
  });

  test("Escape while retyping a label commits nothing", async ({ page }) => {
    const app = new MadyApp(page);
    await app.open();
    await app.newFigure(["Dose-response", "Treatment bar chart"]);

    const label = page.locator(".laypanel-letter").first();
    await label.scrollIntoViewIfNeeded();
    await label.dblclick();
    const input = page.locator(".laypanel-letter-in");
    await input.fill("zzz");
    await input.press("Escape");
    await app.settle();

    expect((await app.layout())?.letterText).toBeUndefined();
    await expect(page.locator(".laypanel-letter").first()).toHaveText("A");
  });
});

/**
 * "Align all" with axis-less kinds must tile them, not pile them.
 *
 * Guards against a figure of dot plot + network + treemap + an axis graph collapsing every
 * panel onto the top-left corner on "Align all", with the network and treemap ballooned to
 * their raw align size. Those kinds ignore the align axis-length overrides, so the
 * align build renders them at the raw 900×700 and the grid placer cannot align them by a
 * data rect they do not have; footprint-aligned kinds (FOOTPRINT_ALIGN_KINDS) therefore tile
 * by their outer box. After Align all there must be no overlap. jsdom cannot lay this out
 * (no metrics), so it lives here.
 */
test.describe("panel assembly — Align all tiles axis-less kinds instead of stacking them", () => {
  test("dot plot + network + treemap + axis graph do not overlap after Align all", async ({ page }) => {
    await collectErrors(page);
    const app = new MadyApp(page);
    await app.open();
    await app.newFigure(["Heritability dot plot", "Signaling network", "GDP treemap", "Dose-response"]);

    const rects = async () =>
      page.evaluate(() =>
        [...document.querySelectorAll(".laypanel")].map((p) => {
          const r = p.getBoundingClientRect();
          return { x: r.x, y: r.y, w: r.width, h: r.height };
        }),
      );
    /** Count panel pairs whose card rects overlap by more than a hairline. */
    const overlaps = (ps: { x: number; y: number; w: number; h: number }[]) => {
      let n = 0;
      for (let a = 0; a < ps.length; a++)
        for (let b = a + 1; b < ps.length; b++) {
          const A = ps[a]!, B = ps[b]!;
          const ox = Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x);
          const oy = Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y);
          if (ox > 4 && oy > 4) n++;
        }
      return n;
    };

    expect(overlaps(await rects())).toBe(0); // clean grid before aligning
    await app.ribbonClick("Align all");
    await app.settle();

    const after = await rects();
    expect(after).toHaveLength(4);
    // The result must be a clean grid: no overlapping pair, no panel at the raw 900×700 align size.
    expect(overlaps(after), "Align all must tile the panels, not stack them").toBe(0);
    // Every panel must be a sensible size — not ballooned to the raw align size (~900), and
    // not collapsed to a tiny tile. Under "Keep proportions" (the default) aligned cards are
    // uniform scales of each full graph, so they are deliberately unequal (about 332–378px) —
    // the floor guards against collapse, not against the slight inequality the miniature
    // contract accepts.
    for (const r of after) {
      expect(r.w, "a footprint panel blew up to the raw align width").toBeLessThan(820);
      // Floor 180: the circle treemap fits tightly around its disc and has no redundant
      // legend, so a footprint card is legitimately ~212px wide — the guard is against
      // collapse to a sliver, and 180 still catches that.
      expect(r.w, "a panel collapsed to a tiny tile").toBeGreaterThan(180);
    }
    expect(await app.consoleErrors()).toEqual([]);
  });

  test("Align all gives an axis-less panel the same outer box as its axis sibling", async ({ page }) => {
    await collectErrors(page);
    const app = new MadyApp(page);
    await app.open();
    // Two panels = one row, so the pairing is unambiguous (newFigure adds panels in
    // picker order, so a 4-panel figure would pair the two axis graphs together).
    await app.newFigure(["Dose-response", "GDP treemap"]);
    // This test covers the re-layout machinery (content-box strategy), which runs only with
    // "Keep proportions" off — new figures seed it on, so untick it. The miniature contract
    // has its own tests below.
    await app.ribbonClick("Keep proportions");
    await app.ribbonClick("Align all");
    await app.settle();
    const rects = await page.evaluate(() =>
      [...document.querySelectorAll(".laypanel")].map((p) => {
        const r = p.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      }),
    );
    expect(rects).toHaveLength(2);
    // The treemap's card must equal its axis sibling's card — width, height, top and
    // bottom. Without the content-box strategy the drawing floats with its own margins
    // and the cards come out 25-50px apart.
    const [axis, tm] = rects as [{ x: number; y: number; w: number; h: number }, { x: number; y: number; w: number; h: number }];
    expect(Math.abs(axis.w - tm.w), `widths ${axis.w} vs ${tm.w}`).toBeLessThanOrEqual(1.5);
    expect(Math.abs(axis.h - tm.h), `heights ${axis.h} vs ${tm.h}`).toBeLessThanOrEqual(1.5);
    expect(Math.abs(axis.y - tm.y), `tops ${axis.y} vs ${tm.y}`).toBeLessThanOrEqual(1.5);
    expect(await app.consoleErrors()).toEqual([]);
  });
});

/**
 * The graph-picker cards must be clickable anywhere, including over the chart preview.
 *
 * The preview is a real `PlotFigure`, whose data marks/axes call `stopPropagation` on click
 * (they are the editing surface on a real graph). In the picker that would swallow the card
 * button's click, so clicking a card's chart would do nothing and only the name row would
 * toggle it. `pointer-events: none`
 * on `.laycard-thumb` prevents this, mirroring GalleryPane's `.gallerycard-fig`.
 *
 * Caution: this has to be a real mouse click at the chart ink — `element.click()` fires the
 * button's onClick directly and never hit-tests, so it passes even without `pointer-events: none` (which is
 * why the harness's own `newFigure`, which clicks cards programmatically, cannot catch this).
 */
test.describe("panel assembly — the graph picker's whole card is clickable", () => {
  test("clicking a card's chart preview selects it, like clicking its name", async ({ page }) => {
    await collectErrors(page);
    const app = new MadyApp(page);
    await app.open();

    // Open the picker without building (newFigure builds past the selection step we test).
    await page.click('.menubar .menu:text-is("Insert")');
    await page.click('.dropdown .dropitem:has-text("New layout")');
    await page.waitForSelector(".laycard");
    await app.settle();

    // The XY "Dose-response" card, whose plotted line is ink that would swallow clicks.
    const card = page.locator('.laycard', { has: page.locator('.laycard-name', { hasText: "Dose-response" }) });
    await expect(card).toHaveAttribute("aria-pressed", "false");
    const mark = card.locator(".laycard-thumb svg path, .laycard-thumb svg line, .laycard-thumb svg rect, .laycard-thumb svg circle").first();
    await mark.scrollIntoViewIfNeeded();
    const box = (await mark.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await app.settle();

    // Without `pointer-events: none` the PlotFigure swallows this and the card stays unselected. With it, the
    // click falls through to the card button, so the chart is as clickable as the name row.
    await expect(card, "clicking the card's chart must select it, like clicking its name").toHaveAttribute("aria-pressed", "true");
    expect(await app.consoleErrors()).toEqual([]);
  });
});

/**
 * The axis-less (matrix heatmap) alignment rules are subtle and easy to disturb from a
 * distance — they work in scene space while the gutter works in card space. The jsdom guard
 * in LayoutPane.test.tsx asserts the same invariant, but only a real browser lays the scene
 * out for real (jsdom has no text metrics), so this is the layer that would actually catch a
 * change in the measured geometry.
 */
test.describe("panel assembly — axis-less heatmap geometry ignores the gutter", () => {
  test("the heatmap's scene is identical at gutter 0 and 16, while the cards move", async ({ page }) => {
    await collectErrors(page);
    const app = new MadyApp(page);
    await app.open();
    await app.newFigure(["Dose-response", "Gene expression heatmap"]);
    // Re-layout (off) machinery under test — see the note in the outer-box test above.
    await app.ribbonClick("Keep proportions");
    // One column, so the heatmap is stacked under the graph — the case the heatmap
    // alignment targets (shared left edge, row gutter between them).
    await app.setColumns(1);
    await app.ribbonClick("Align X");

    /** The heatmap panel's scene box + both cards' offsets. */
    const measure = async () =>
      page.evaluate(() => {
        const panels = [...document.querySelectorAll(".laypanel")] as HTMLElement[];
        const svgs = panels.map((p) => p.querySelector("svg.gfx-figure"));
        return {
          // panel order is [graph, heatmap]; the heatmap is the axis-less one
          heatViewBox: svgs[1]?.getAttribute("viewBox") ?? null,
          graphViewBox: svgs[0]?.getAttribute("viewBox") ?? null,
          lefts: panels.map((p) => Math.round(p.getBoundingClientRect().left)),
          tops: panels.map((p) => Math.round(p.getBoundingClientRect().top)),
        };
      });

    await app.setGutter(16);
    const at16 = await measure();
    await app.setGutter(0);
    const at0 = await measure();

    // the measurement is real, not three nulls
    expect(at16.heatViewBox).toMatch(/^0 0 \d+(\.\d+)? \d+(\.\d+)?$/);
    // Scene space: untouched by the gutter
    expect(at0.heatViewBox).toBe(at16.heatViewBox);
    // …and the axis-less expansion did its job — the heatmap's total width (colour-bar
    // included) matches the axis-bearing graph's, which is the whole point of that machinery
    expect(at16.heatViewBox).toBe(at16.graphViewBox);
    // Card space: the gutter really is being applied, so the equality above isn't vacuous
    expect(at16.tops[1]! - at0.tops[1]!).toBe(16);
    // Left edges near-flush at both gutters, tolerance 8px: with the 26px labelFont the
    // heatmap's row-label strip is ~7px wider than the graph's Y-axis band. The grid stays
    // on the shared column line (that is the alignment that matters, and the scene-width
    // match above stays exact), so the card edge carries exactly that label-strip excess.
    // Flush to 1px would only be possible with smaller fonts.
    expect(Math.abs(at16.lefts[0]! - at16.lefts[1]!)).toBeLessThanOrEqual(8);
    expect(Math.abs(at0.lefts[0]! - at0.lefts[1]!)).toBeLessThanOrEqual(8);
    expect(await app.consoleErrors()).toEqual([]);
  });

  // Shared-axis labelling, for the axes: label only the figure's outer edges. The gate is
  // that a panel defers only when it genuinely shares that axis — so both directions matter.
  test("inner panels drop a shared Y axis, and keep an unshared one", async ({ page }) => {
    await collectErrors(page);
    const app = new MadyApp(page);
    await app.open();

    // Make the violin share the bar chart's Y axis, on its own tab, before assembling —
    // the ordinary way a user would line two graphs up.
    await app.openGraph("Dose-group violin");
    await app.setPlotOptions({ yAxis: { min: 0, max: 40, title: "Mean" } });

    await app.newFigure(["Treatment bar chart", "Dose-group violin"]);
    await app.ribbonClick("Free drag"); // → grid mode
    await app.setColumns(2);

    const widths = async () =>
      page.evaluate(() =>
        ([...document.querySelectorAll(".laypanel svg.gfx-figure")] as SVGSVGElement[]).map((s) => ({
          w: Number((s.getAttribute("viewBox") ?? "").split(" ")[2]),
          text: s.textContent ?? "",
        })),
      );

    const before = await widths();
    expect(before[0]!.w).toBeGreaterThan(0);
    expect(before[1]!.text).toContain("Mean"); // both panels now say the same thing

    await app.ribbonClick("Shared axes");
    const after = await widths();

    // Panel B (second column) hands its Y axis to panel A: the title and the tick numbers go.
    expect(after[1]!.text).not.toContain("Mean");
    expect(after[1]!.text).not.toContain("40");
    // …while panel A (first column) keeps the axis that now labels the whole row.
    expect(after[0]!.text).toContain("Mean");
    expect(after[0]!.text).toContain("40");
    // B's own data is untouched — only its axis furniture went.
    expect(after[1]!.text).toContain("Vehicle");

    // In a plain grid the scene box is a fixed size, so the reclaimed margin makes the plot
    // bigger inside the same box rather than shrinking the box — hence the box is unchanged
    // here. The reclaim itself is asserted where it can be measured exactly: the plot rect
    // in buildScene.test.ts ("hidden axis reclaims its margin"), and the scene width under
    // Align X/Y in LayoutPane.test.tsx (where the data rect is pinned and the box shrinks).
    expect(after[1]!.w).toBe(before[1]!.w);
    expect(await app.consoleErrors()).toEqual([]);
  });

  test("panels whose axes genuinely differ keep their own labels", async ({ page }) => {
    await collectErrors(page);
    const app = new MadyApp(page);
    await app.open();
    // untouched sample graphs: different units and ranges side by side
    await app.newFigure(["Treatment bar chart", "Dose-group violin"]);
    await app.ribbonClick("Free drag");
    await app.setColumns(2);

    const widths = async () =>
      page.evaluate(() =>
        ([...document.querySelectorAll(".laypanel svg.gfx-figure")] as SVGSVGElement[]).map((s) =>
          Number((s.getAttribute("viewBox") ?? "").split(" ")[2]),
        ),
      );
    const before = await widths();
    await app.ribbonClick("Shared axes");
    // …the toggle really is on, so "nothing changed" means the gate declined rather than
    // the feature never running (this assertion is what stops the test passing vacuously)
    expect((await app.layout())?.sharedAxisLabels).toBe(true);
    const after = await widths();
    // hiding B's scale here would invite reading it off A's — so nothing is dropped
    expect(after).toEqual(before);
    expect(await app.consoleErrors()).toEqual([]);
  });

  // Column spanning deliberately makes one panel a different width. It must not become
  // the width the axis-less machinery matches heatmaps to, or every heatmap in the figure
  // would be dragged out to the wide panel's size.
  test("a sibling's column span does not disturb the heatmap's matched width", async ({ page }) => {
    await collectErrors(page);
    const app = new MadyApp(page);
    await app.open();
    await app.newFigure(["Dose-response", "Gene expression heatmap", "Treatment bar chart"]);
    // Re-layout (off) machinery under test — see the note in the outer-box test above.
    await app.ribbonClick("Keep proportions");
    await app.ribbonClick("Free drag"); // → grid mode, where spanning applies
    await app.setColumns(2);
    await app.ribbonClick("Align X");

    /** Every panel's scene width, so the heatmap can be compared to its real neighbours. */
    const sceneWidths = async () =>
      page.evaluate(() =>
        ([...document.querySelectorAll(".laypanel")] as HTMLElement[]).map((p) => {
          const vb = p.querySelector("svg.gfx-figure")?.getAttribute("viewBox") ?? "";
          return { scene: Number(vb.split(" ")[2] ?? NaN), card: Math.round(p.getBoundingClientRect().width) };
        }),
      );

    const before = await sceneWidths();
    expect(before[1]!.scene).toBeGreaterThan(0); // really measured
    // Matched to the widest axis-bearing panel, which is what the layout code targets
    // ("the widest axis-bearing panel's scene width"). Panel 0 alone is the wrong reference:
    // the bar chart is 390.5 to the dose-response's 387.9, so the heatmap correctly
    // matches 390.5.
    const widestGraph = Math.max(before[0]!.scene, before[2]!.scene);
    expect(before[1]!.scene).toBeCloseTo(widestGraph, 0);

    // widen panel A (the axis-bearing graph) to span both columns
    await page.locator(".laypanel-span").first().click();
    await app.settle();
    const after = await sceneWidths();

    expect(after[0]!.card).toBeGreaterThan(before[0]!.card * 1.5); // the span genuinely applied
    // The invariant: the heatmap is not dragged out to the spanning panel's width…
    expect(after[1]!.scene).toBeLessThan(after[0]!.scene * 0.6);
    // …it re-matches to the single-column panel it actually shares a column with. (Making a
    // panel span therefore changes which panels define the column width — correct, since the
    // wide one no longer occupies a single column, but worth knowing.)
    expect(after[1]!.scene).toBeCloseTo(after[2]!.scene, 0);
    expect(await app.consoleErrors()).toEqual([]);
  });
});

/**
 * "Keep proportions" miniatures: each panel is the full graph, built at
 * its own figure size and rendered as a uniform scale via PlotFigure's zoom — fonts, dots,
 * strokes and margins all shrink together. This is the default for new figures. The two
 * risks this layer guards: (1) the proportions claim itself, measured as on-screen ink
 * (jsdom cannot render text, so a dot-to-font ratio only means something here); (2) a panel
 * at k≠1 must still edit correctly — drags map through getScreenCTM, and a forgotten scale
 * division would commit k-times-too-small offsets.
 */
test.describe("panel assembly — Keep proportions miniatures", () => {
  /** On-screen ink ratio in one svg: first data circle's width over a tick label's height.
   *  Both scale with k under a uniform render, so the ratio is scale-invariant — it matches
   *  the standalone graph iff the panel kept the designed proportions. */
  const inkRatio = (page: import("@playwright/test").Page, rootSel: string) =>
    page.evaluate((sel: string) => {
      const svg = document.querySelector(sel);
      if (!svg) return null;
      const dot = [...svg.querySelectorAll("circle")].find((c) => c.getBoundingClientRect().width > 2);
      const tick = [...svg.querySelectorAll("text")].find((t) => /^\d+(\.\d+)?$/.test((t.textContent ?? "").trim()));
      if (!dot || !tick) return null;
      return dot.getBoundingClientRect().width / tick.getBoundingClientRect().height;
    }, rootSel);

  test("mix incl. paireddot + lollipop: Align all is dense and the lollipop keeps its designed proportions", async ({ page }) => {
    await collectErrors(page);
    const app = new MadyApp(page);
    await app.open();
    // A paireddot (its ~200px label block must not spread the figure) plus a lollipop
    // (its fonts must keep their proportions in the card format).
    await app.newFigure(["Heritability dot plot", "Quarterly lollipop", "Gene expression heatmap", "Dose-response"]);
    await app.ribbonClick("Align all");
    await app.settle();

    // Dense: the whole 2×2 grid spans well under 900px, canvas-local (the paireddot case).
    const span = await page.evaluate(() => {
      const rects = [...document.querySelectorAll(".laypanel")].map((p) => p.getBoundingClientRect());
      return Math.max(...rects.map((r) => r.right)) - Math.min(...rects.map((r) => r.left));
    });
    expect(span, "Align all must produce a dense figure, not a sprawl").toBeLessThan(900);

    // Miniature rendering really engaged: the lollipop panel's svg is drawn smaller than its
    // viewBox (k < 1). Fails under the re-layout code path, where svg width always == viewBox width.
    const project = await app.project();
    const lolli = (project.plots as { id: string; name: string }[]).find((p) => p.name === "Quarterly lollipop")!;
    const panelSel = `.laypanel[data-pid="${lolli.id}"] svg.gfx-figure`;
    const k = await page.evaluate((sel: string) => {
      const svg = document.querySelector(sel)!;
      return Number(svg.getAttribute("width")) / Number((svg.getAttribute("viewBox") ?? "0 0 1 1").split(" ")[2]);
    }, panelSel);
    expect(k).toBeLessThan(0.999);
    expect(k).toBeGreaterThan(0.3);

    // The proportions assertion: dot-to-tick-font ink ratio in the panel equals the
    // standalone graph's. Scaling fonts but not dots would skew this ratio.
    const panelRatio = await inkRatio(page, panelSel);
    expect(panelRatio, "no measurable dot/tick ink in the lollipop panel").not.toBeNull();
    await app.openGraph("Quarterly lollipop");
    const soloRatio = await inkRatio(page, "svg.gfx-figure");
    expect(soloRatio, "no measurable dot/tick ink on the standalone lollipop").not.toBeNull();
    expect(Math.abs(panelRatio! - soloRatio!) / soloRatio!, `panel ratio ${panelRatio} vs standalone ${soloRatio}`).toBeLessThan(0.1);
    expect(await app.consoleErrors()).toEqual([]);
  });

  test("panel letters never sit on a graph's ink at miniature scale", async ({ page }) => {
    // The HTML A/B/C letter keeps its screen size while a miniature's top margin scales away
    // beneath it, which can put "A" on the heatmap's first row label (GeneA) and "B" on the
    // violin's top tick (35). The default letter position lifts above the ink when the
    // scaled margin is too thin. This pair exhibits the case; the assertion is the general
    // invariant.
    await collectErrors(page);
    const app = new MadyApp(page);
    await app.open();
    await app.newFigure(["Gene expression heatmap", "Dose-group violin"]);
    await app.ribbonClick("Align all");
    await app.settle();

    const clashes = await page.evaluate(() => {
      const letters = [...document.querySelectorAll(".laypanel-letter")].map((el) => ({
        txt: (el.textContent ?? "").trim(),
        r: el.getBoundingClientRect(),
      }));
      const out: string[] = [];
      for (const svg of document.querySelectorAll(".laypanel svg.gfx-figure")) {
        for (const t of svg.querySelectorAll("text")) {
          const txt = (t.textContent ?? "").trim();
          if (!txt) continue;
          const b = t.getBoundingClientRect();
          if (b.width < 0.5 || b.height < 0.5) continue;
          for (const L of letters) {
            const ox = Math.min(L.r.right, b.right) - Math.max(L.r.x, b.x);
            const oy = Math.min(L.r.bottom, b.bottom) - Math.max(L.r.y, b.y);
            if (ox > 1.5 && oy > 1.5) out.push(`${L.txt} on "${txt}" (${ox.toFixed(1)}×${oy.toFixed(1)}px)`);
          }
        }
      }
      return out;
    });
    expect(clashes, "a panel letter covers graph text").toEqual([]);
    expect(await app.consoleErrors()).toEqual([]);
  });

  test("row span: the grip commits panelRowSpan and the grid tiles a tall-left layout live", async ({ page }) => {
    // A panel must be able to own two row slots in the aligned grid
    // (free-drag could only fake it). Columns 2, A spans 2 rows → B and C stack beside it.
    await collectErrors(page);
    const app = new MadyApp(page);
    await app.open();
    await app.newFigure(["Dose-response", "Treatment bar chart", "Dose-group violin"]);
    await app.setColumns(2);
    await app.ribbonClick("Align all");
    await app.settle();

    // click A's row-span grip (grips show on hover; drive the button directly)
    const clicked = await page.evaluate(() => {
      const a = document.querySelector(".laypanel");
      const grip = a?.querySelector(".laypanel-rowspan-float") as HTMLButtonElement | null;
      grip?.click();
      return !!grip;
    });
    expect(clicked, "the row-span grip must exist on a grid-mode panel").toBe(true);
    await app.settle();

    const spans = (await app.layout())?.panelRowSpan as Record<string, number> | undefined;
    expect(spans, "the grip must commit a panelRowSpan entry").toBeTruthy();
    expect(Object.values(spans!)).toContain(2);

    const boxes = await page.evaluate(() =>
      [...document.querySelectorAll(".laypanel")].map((p) => {
        const r = p.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
      }),
    );
    const [a, b, c] = boxes as [{ x: number; y: number; w: number; h: number }, { x: number; y: number; w: number; h: number }, { x: number; y: number; w: number; h: number }];
    expect(b.x, "B tiles beside the tall panel").toBeGreaterThan(a.x + a.w - 2);
    // C is in B's column (beside A, not under it) and stacked below B. Card lefts within a
    // column legitimately differ (the shift pass aligns plot lines, and different kinds
    // carry different margins), so "same column" is asserted against A's right edge.
    expect(c.x, "C tiles beside the tall panel too").toBeGreaterThan(a.x + a.w - 2);
    expect(c.y, "C stacks below B").toBeGreaterThan(b.y + b.h - 2);
    expect(a.h, "A spans both rows").toBeGreaterThan(b.h * 1.6);
    // no overlaps anywhere
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const A = boxes[i]!;
        const B = boxes[j]!;
        const ox = Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x);
        const oy = Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y);
        expect(ox > 4 && oy > 4, `panels ${i} and ${j} overlap`).toBe(false);
      }
    expect(await app.consoleErrors()).toEqual([]);
  });

  test("a miniature panel at k≠1 still edits correctly: an axis-title drag commits the screen delta ÷ k", async ({ page }) => {
    await collectErrors(page);
    const app = new MadyApp(page);
    await app.open();
    await app.newFigure(["Dose-response", "Treatment bar chart"]);
    await app.ribbonClick("Align all");
    await app.settle();

    const project = await app.project();
    const dose = (project.plots as { id: string; name: string }[]).find((p) => p.name === "Dose-response")!;
    const panelSel = `.laypanel[data-pid="${dose.id}"] svg.gfx-figure`;
    const k = await page.evaluate((sel: string) => {
      const svg = document.querySelector(sel)!;
      return Number(svg.getAttribute("width")) / Number((svg.getAttribute("viewBox") ?? "0 0 1 1").split(" ")[2]);
    }, panelSel);
    expect(k, "this guard needs a genuinely scaled panel").toBeLessThan(0.999);

    // The x-axis title is the bottommost text in the panel svg. Click it once to select the
    // panel (wires the drag callbacks), then drag it.
    //
    // Note: scroll the panel fully into view first. The assembler canvas scrolls, and at the
    // e2e viewport this panel's foot can sit just under the fold (the ribbon's height decides) —
    // the title's centre would then be on the drawer below the canvas, so the click would not
    // select the panel and the drag would have nothing to commit through.
    await page.locator(panelSel).scrollIntoViewIfNeeded();
    await app.settle();
    const titleBox = await page.evaluate((sel: string) => {
      const svg = document.querySelector(sel)!;
      const texts = [...svg.querySelectorAll("text")].filter((t) => (t.textContent ?? "").trim().length > 0);
      const bottom = texts.reduce((a, b) => (a.getBoundingClientRect().bottom >= b.getBoundingClientRect().bottom ? a : b));
      const r = bottom.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: (bottom.textContent ?? "").trim() };
    }, panelSel);
    await page.mouse.click(titleBox.x, titleBox.y);
    await app.settle();

    const dx = 40, dy = 12;
    await app.dragBy({ x: titleBox.x, y: titleBox.y }, dx, dy);
    const plot = (await app.plot(dose.id))!;
    const off = (plot.xAxis as { titleOffset?: { dx: number; dy: number } } | undefined)?.titleOffset;
    expect(off, `the drag on "${titleBox.text}" must commit an xAxis.titleOffset`).toBeTruthy();
    // Committed in viewBox px: the screen delta divided by k. A handler that forgot the
    // scale would commit dx·k (≈ k² too small on screen) and fail the tolerance.
    expect(Math.abs(off!.dx - dx / k), `dx ${off!.dx} vs expected ${dx / k}`).toBeLessThan(dx / k * 0.15 + 2);
    expect(Math.abs(off!.dy - dy / k), `dy ${off!.dy} vs expected ${dy / k}`).toBeLessThan(dy / k * 0.3 + 3);
    expect(await app.consoleErrors()).toEqual([]);
  });
});

test.describe("panel assembly — each panel letter stays at its own card on a spanning shape", () => {
  // Guards against lined-up letters on Tall left (A spans 3 rows) putting C's letter on top of
  // B's, far above C's own card — including with Align Y switched off, where A is drawn
  // far taller than the other cards. The letters take their rows/columns from the grid the cards are placed on.
  // Real browser: the unit fixture's small graphs never grow tall enough to show the
  // Align-Y-off case.
  const letters = (page: import("@playwright/test").Page) =>
    page.evaluate(() => [...document.querySelectorAll(".laypanel")].map((p) => {
      const card = p.getBoundingClientRect();
      const L = p.querySelector(".laypanel-letter")!.getBoundingClientRect();
      return { letter: p.querySelector(".laypanel-letter")?.textContent?.trim(), cardTop: card.top, cardLeft: card.left, top: L.top, left: L.left };
    }));
  const pickShape = async (page: import("@playwright/test").Page, name: string) => {
    await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => /Layout\s?▾/.test(x.textContent ?? "")); (b as HTMLButtonElement).click(); });
    await page.locator(".laypreset-item", { hasText: name }).first().click();
  };
  for (const state of ["Align all", "Align Y off"] as const) {
    test(`Tall left, ${state}: no letter leaves its card or lands on another`, async ({ page }) => {
      await page.setViewportSize({ width: 1600, height: 1000 });
      await collectErrors(page);
      const app = new MadyApp(page);
      await app.open();
      await app.newFigure(["Dose-response", "Quarterly lollipop", "Gene expression heatmap", "Heritability dot plot"]);
      await pickShape(page, "Tall left");
      await app.settle();
      const on = () => page.evaluate(() => [...document.querySelectorAll("button.laychip-go")].some((b) => b.classList.contains("on")));
      if (!(await on())) await app.ribbonClick("Align all");
      if (state === "Align Y off") await app.ribbonClick("Align Y");
      await app.settle();
      const ls = await letters(page);
      expect(ls).toHaveLength(4);
      for (const l of ls) {
        expect(Math.abs(l.top - l.cardTop), `${l.letter}: letter ${Math.round(l.top - l.cardTop)} px from its card's top`).toBeLessThanOrEqual(40);
        expect(Math.abs(l.left - l.cardLeft), `${l.letter}: letter ${Math.round(l.left - l.cardLeft)} px from its card's left`).toBeLessThanOrEqual(40);
      }
      for (let i = 0; i < ls.length; i++)
        for (let j = i + 1; j < ls.length; j++)
          expect(Math.hypot(ls[i]!.left - ls[j]!.left, ls[i]!.top - ls[j]!.top), `letters ${ls[i]!.letter} and ${ls[j]!.letter} on one spot`).toBeGreaterThan(20);
      expect(await app.consoleErrors()).toEqual([]);
    });
  }
});

test.describe("panel assembly — pie round, no holes beside it, forest names push nothing", () => {
  // On the gallery figure (forest · pie · box · histogram · volcano, 3 columns, Align all): the pie is drawn round,
  // not as an oval; the histogram stays on its column edge (the forest plot's study names do not set the column's
  // axis line); the pie card fills its column and sits on the column edge, leaving no large empty space beside it.
  const addFromGallery = async (app: MadyApp, page: import("@playwright/test").Page, wants: RegExp[]) => {
    const titles = await app.openGallery();
    for (const want of wants) {
      const t = titles.find((x) => want.test(x.trim()));
      expect(t, `gallery card ${want}`).toBeTruthy();
      await app.openGalleryCard(t!.trim());
      await app.menu("Graph", "Chart gallery").catch(() => {});
    }
    await app.openGraph("Dose-response");
    void page;
  };
  const cards = (page: import("@playwright/test").Page) =>
    page.evaluate(() => Object.fromEntries([...document.querySelectorAll(".laypanel")].map((p) => {
      const c = p.getBoundingClientRect();
      // the pie's wedges: every path drawn larger than a legend key
      const big = [...p.querySelectorAll("svg.gfx-figure path")].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 25 && r.height > 25);
      const u = big.length ? { w: Math.max(...big.map((r) => r.right)) - Math.min(...big.map((r) => r.left)), h: Math.max(...big.map((r) => r.bottom)) - Math.min(...big.map((r) => r.top)) } : null;
      return [p.querySelector(".laypanel-letter")?.textContent?.trim() ?? "?", { left: c.left, right: c.right, width: c.width, wedges: u }];
    })));
  const alignAllOn = async (app: MadyApp, page: import("@playwright/test").Page) => {
    const on = () => page.evaluate(() => [...document.querySelectorAll("button.laychip-go")].some((b) => b.classList.contains("on")));
    if (!(await on())) await app.ribbonClick("Align all");
    await app.settle();
  };

  test("gallery figure, 3 columns, Align all: the pie is round and fills its column; no card is pushed off its column edge", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1600, height: 1000 });
    await collectErrors(page);
    const app = new MadyApp(page);
    await app.open();
    await addFromGallery(app, page, [/^Forest/i, /^Pie/i, /^Box/i, /^Histogram/i, /^Volcano/i]);
    await app.newFigure(["Forest plot", "Pie", "Box & whisker", "Histogram", "Volcano"]);
    await app.setColumns(3);
    await alignAllOn(app, page);
    const c = await cards(page);
    // A Forest · B Pie · C Box (row 1), D Histogram · E Volcano (row 2)
    expect(c.B!.wedges, "no pie wedges found").not.toBeNull();
    const ratio = c.B!.wedges!.w / c.B!.wedges!.h;
    expect(Math.abs(ratio - 1), `pie drawn ${Math.round(c.B!.wedges!.w)}×${Math.round(c.B!.wedges!.h)} — must be round`).toBeLessThan(0.05);
    expect(Math.abs(c.D!.left - c.A!.left), `histogram ${Math.round(c.D!.left - c.A!.left)} px off its column edge`).toBeLessThanOrEqual(2);
    expect(Math.abs(c.B!.left - c.E!.left), `pie ${Math.round(c.B!.left - c.E!.left)} px off its column edge`).toBeLessThanOrEqual(2);
    expect(Math.abs(c.B!.width - c.E!.width), `pie card ${Math.round(c.B!.width)} px in a ${Math.round(c.E!.width)} px column`).toBeLessThanOrEqual(2);
    expect(await app.consoleErrors()).toEqual([]);
  });
});

test.describe("panel assembly — Align all on mixed figures: every letter at its own card", () => {
  // With Align all's automatic spans, the Heritability dot plot and the wider survival plot can both span
  // column 1, leaving the column with no axis line. The narrower card takes its column's width rather than being
  // centred in it, which would leave its letter behind at the column edge.
  test("heritability · survival · triplot · oncoprint · time course · waterfall", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 2400, height: 1900 });
    await collectErrors(page);
    const app = new MadyApp(page);
    await app.open();
    const titles = (await app.openGallery()).map((t) => t.trim());
    // added in gallery order — it decides the panel order, and so the grid
    for (const w of ["Time course + bands, window, limit", "Waterfall (response)", "Survival (Kaplan-Meier)", "Oncoprint", "Ordination — triplot (constrained)"]) {
      await app.openGalleryCard(titles.find((t) => t === w)!);
      await app.menu("Graph", "Chart gallery").catch(() => {});
    }
    await app.openGraph("Dose-response");
    await app.newFigure(["Heritability dot plot", "Survival (Kaplan-Meier)", "Ordination — triplot (constrained)", "Oncoprint", "Time course + bands, window, limit", "Waterfall (response)"]);
    const on = () => page.evaluate(() => [...document.querySelectorAll("button.laychip-go")].some((b) => b.classList.contains("on")));
    if (!(await on())) await app.ribbonClick("Align all");
    await app.settle();
    const away = await page.evaluate(() => [...document.querySelectorAll(".laypanel")].flatMap((p) => {
      const c = p.getBoundingClientRect();
      const l = p.querySelector(".laypanel-letter")!.getBoundingClientRect();
      const t = p.querySelector(".laypanel-letter")!.textContent?.trim();
      return Math.abs(l.left - c.left) > 40 || Math.abs(l.top - c.top) > 40 ? [`${t}: ${Math.round(l.left - c.left)}, ${Math.round(l.top - c.top)} px from its card`] : [];
    }));
    expect(away).toEqual([]);
    expect(await app.consoleErrors()).toEqual([]);
  });
});
