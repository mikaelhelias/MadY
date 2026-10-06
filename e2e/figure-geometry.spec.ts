import { expect, test } from "@playwright/test";
import { collectErrors, MadyApp, type FigureGeometry } from "./app";

/**
 * Figure geometry — does the chart actually look right?
 *
 * The other guard layers all answer "does this thing exist and respond?":
 * `strict.ts` (a mutation must not silently no-op), `scene-census` (every scene field must be
 * classified), `dead-affordance` (a drag must commit), `dead-style-fields` (a style field must
 * be read + reachable). None of them looks at where anything is drawn, so a figure whose
 * labels sit on top of each other passes every one of them.
 *
 * `gallery.test.ts` renders every kind but only asserts kind / non-empty / no-warnings, and it
 * runs in jsdom — which has no text metrics, so `getBBox()` returns zeros there and every figure
 * measures perfect. This layer therefore has to live in a real browser.
 *
 * Fixture = the Chart gallery: one curated example per chart family, house-styled, opened at
 * full size through the real "open as editable graph" path — i.e. exactly what the user sees
 * when they click a card, not a 360×250 preview card.
 */

/**
 * Charts allowed to draw overlapping or clipped text, each with an exact budget. The list is
 * empty: every gallery chart draws cleanly. An entry is a problem to fix, not an exemption. The
 * budgets are exact, so a chart that improves without reaching zero fails here until its number
 * is lowered, and any new collision anywhere fails at once.
 */
const GEOMETRY_ALLOWANCES: Record<string, { overlaps: number; clipped: number; note: string }> = {
  // Empty. How the charts that are prone to collisions avoid them:
  // - Treemap: a per-cell fit test cannot see a glyph touching a neighbour across a shared edge,
  //   or a cell's text meeting a region heading (which is not a cell at all). A final pass
  //   de-conflicts every glyph in the figure, dropping by priority — headings, then cells by
  //   area, then label → value → icon within a cell.
  // - PCA loadings and biplot: near-parallel loading vectors put their labels in the same place;
  //   the labels nudge apart vertically (`nudgeApartVertically`) rather than one being hidden —
  //   each names a variable, and the eye follows the arrow to its label.
  // - Bland-Altman: a rotated Y title runs its length down the figure; a long one slides to stay
  //   on canvas and shrinks only if it cannot fit at any position (`fitTitle`).
  // - Correlation matrix: a rotated column label is anchored at its end, so it hangs down-left by
  //   width × sin(angle). Its pivot uses the reserve the builder sets aside in marginTop
  //   (`colLabelLift`), so the tail does not fall into the first row.
  // - Radar / spider: ring value labels all stack at the same x up the vertical axis, so they
  //   thin (every k-th, never the outer ring) — numeric scale values are still readable off
  //   their neighbours, unlike a category name.
  // - Network graph: the right margin reserves the widest node label.
  // - Paired dot plot: row labels shrink to fit their band via `fitStackedLabels`, and the
  //   rotated section headings trim against a fixed 8px gap rather than a proportional 92%
  //   (which leaves ~1.7px of real overlap).
};

test.describe("figure geometry — no chart may draw text on top of text, or off the canvas", () => {
  test.beforeEach(async ({ page }) => {
    await collectErrors(page);
  });

  test("every gallery chart, at full size, has legible non-overlapping text", async ({ page }) => {
    test.slow(); // every gallery chart, each opened as a real graph tab
    const app = new MadyApp(page);
    await app.open();
    const titles = await app.openGallery();
    expect(titles.length, "the gallery must expose a card per chart family").toBeGreaterThanOrEqual(30);

    const report: Record<string, FigureGeometry> = {};
    for (const title of titles) {
      await app.openGallery();
      await app.openGalleryCard(title);
      report[title] = await app.figureGeometry();
    }

    // Emit the full measurement so a failing run shows every chart's numbers, not just a red X.
    const rows = Object.entries(report)
      .map(([k, g]) => ({ kind: k, texts: g.texts, overlaps: g.overlaps.length, clipped: g.clipped.length }))
      .sort((a, b) => b.overlaps + b.clipped - (a.overlaps + a.clipped));
    console.log("\n=== Figure geometry ===\n" + JSON.stringify(rows, null, 1));
    for (const [kind, g] of Object.entries(report)) {
      if (g.overlaps.length || g.clipped.length) {
        console.log(`\n--- ${kind} (canvas ${g.canvas.w}×${g.canvas.h}, ${g.texts} texts) ---`);
        if (g.overlaps.length) console.log("  overlaps:", JSON.stringify(g.overlaps.slice(0, 12)));
        if (g.clipped.length) console.log("  clipped :", JSON.stringify(g.clipped.slice(0, 12)));
      }
    }

    const offenders = Object.entries(report)
      .filter(([kind, g]) => {
        const budget = GEOMETRY_ALLOWANCES[kind];
        if (!budget) return g.overlaps.length > 0 || g.clipped.length > 0;
        return g.overlaps.length > budget.overlaps || g.clipped.length > budget.clipped;
      })
      .map(([kind, g]) => `${kind}: ${g.overlaps.length} overlapping text pairs, ${g.clipped.length} clipped`);

    // A chart that improves must lower its budget, or a stale entry would go on hiding any
    // later collision on that chart.
    const overBudget = Object.entries(GEOMETRY_ALLOWANCES)
      .filter(([kind, b]) => {
        const g = report[kind];
        return g && (g.overlaps.length < b.overlaps || g.clipped.length < b.clipped);
      })
      .map(([kind, b]) => `${kind}: budget ${b.overlaps}/${b.clipped}, now ${report[kind]!.overlaps.length}/${report[kind]!.clipped.length} — lower it`);
    expect(overBudget, "GEOMETRY_ALLOWANCES entries are larger than needed:\n  - " + overBudget.join("\n  - ") + "\n").toEqual([]);

    expect(
      offenders,
      "These charts draw text on top of text, or off the canvas, at full size:\n  - " + offenders.join("\n  - ") + "\n",
    ).toEqual([]);
    expect(await app.consoleErrors()).toEqual([]);
  });

  /**
   * The other half of "does it look right": not the shipped defaults, but the figure after a
   * user edits it. Enlarging the axis fonts for a poster or a slide is the commonest such edit
   * and the one most likely to break a layout, because every margin in the app is derived from
   * font size. It also guards against Y-title clearance going negative at larger title sizes
   * (around `yAxisTitle.size ≈ 18`), which would jam the title into the tick labels on every
   * main-figure kind.
   */
  test("charts survive a font enlargement — margins must follow the text", async ({ page }) => {
    test.slow();
    const app = new MadyApp(page);
    await app.open();
    const titles = await app.openGallery();

    /**
     * Kinds whose text legitimately does not follow the tick / axis-title roles. Each was
     * confirmed against the code, not assumed — a kind that simply ignored the font would be a
     * defect, so the distinction has to be stated.
     */
    const FONT_ROLE_NA: Record<string, string> = {
      "Pie": "slice labels use the `sliceLabel` role, not `tick`/`axisTitle`",
      "Heatmap": "row/column labels are deliberately capped at 12 so adjacent column labels do not collide (the heatmap builder in buildScene.ts); the Heatmap panel's own `labelFont` control overrides that",
      "Correlation matrix": "as Heatmap — its labels carry the same documented cap",
      "Treemap": "cells only carry the text that fits them, so a bigger font correctly yields fewer labels; total text area goes down, not up",
      "Paired dot plot": "row labels are capped to the row band (PairedDotScene.labelFont) so stacked labels cannot collide — enlarging the tick font therefore grows them only until they fill their band, and total text area can fall",
      // The other heatmap-family gallery cards: their row/column labels come from
      // `heatmap.labelFont` (a house default, not the tick role) and are fitted to the cell
      // height (`fitStackedLabels`), so an enlarged tick / axis-title font cannot reach them by
      // design.
      "Heatmap — clustered, split, annotated": "as Heatmap — labelFont, fitted to the cell height",
      "Bubble-grid heatmap": "as Heatmap — labelFont, fitted to the cell height",
      "Dendrogram": "the clustered-heatmap card: as Heatmap — labelFont, fitted to the cell height",
      "Venn diagram": "set labels and counts use the `legend` role (buildScene venn builder: fonts.legend), not `tick`/`axisTitle`",
    };

    /**
     * Charts allowed to break under a font enlargement, each with a budget. The list is empty;
     * an entry is a problem to fix, not an exemption.
     *
     * The common failure is a tick label meeting its own axis title ("0.2"×"Survival",
     * "15–29"×"Age band") when the title's gap does not grow with the font. A rendered text box
     * is ~1.35× its font size, so a margin that reserves only `fontSize` px per line leaves each
     * axis-title band short by ~35%. `textBand`, plus anchoring the title to its own tick labels
     * via `AxisScene.titlePos`, handles that for every axis chart.
     *
     * Collisions on other text — node labels, spoke labels, variable names, loading labels — are
     * not solved by margin; they need per-kind label de-confliction.
     */
    const FONT_STRESS_BAD: Record<string, { overlaps: number; clipped: number }> = {
      // Empty — every gallery chart survives a font enlargement. An entry here would mean that
      // chart's margins do not follow its text.
      // How the kinds prone to this avoid it:
      //  · PCA score/biplot: the X axis's leftmost and the Y axis's lowest label can meet at the
      //    plot corner, each drawn by code unaware of the other. The Y one (the axis minimum, the
      //    least informative tick) yields.
      //  · PCA loadings: the outermost X label is centred on its tick, so half of it can hang
      //    into a margin sized for a smaller font. A label that cannot fit the canvas is dropped
      //    rather than drawn clipped.
      //  · PCA scree: a long rotated Y title ("% variance explained") must not overrun the canvas.
      //  · Network graph: node labels de-conflict by degree (hubs keep theirs), flipping side
      //    where free and dropping only as a last resort — selective labelling, the usual
      //    convention for a network.
      //  · Radar / spider: ring value labels thin.
      //  · Paired dot plot: row labels shrink to fit their band (`fitStackedLabels`), so enlarging
      //    the tick font cannot stack them into each other.
      // Note: a crowded vertical category axis has no de-overlap pass (the horizontal one has
      // `deOverlapX`), so adjacent row labels can collide; the larger, correct title band makes
      // that more likely.
    };

    const broke: string[] = [];
    const notStored: string[] = [];
    const notDrawn: string[] = [];
    for (const title of titles) {
      await app.openGallery();
      await app.openGalleryCard(title);
      const plotId = await app.activePlotId();
      const before = await app.figureGeometry();
      // Caution: the sizes must be bigger than the house style, which ships ticks at 20 and axis
      // titles at 26. Setting exactly those numbers changes nothing and passes vacuously (the
      // rendered sizes stay [12,20,25,26]). `buildPlotScene` is called in the render body (not
      // memoised), so setting the font through the handler redraws exactly as a user's edit does.
      await app.setPlotFont("tick", { size: 30 });
      await app.setPlotFont("axisTitle", { size: 40 });
      // Network node labels are sized by `network.labelSize`, not the tick font (the tick font
      // is sized for axis charts and swamps a node-link diagram). Stress the knob that actually
      // drives them, or this chart silently measures an unchanged scene and the staleness guard
      // below fires — which is exactly what it is for.
      if (title === "Network graph") await app.setPlotOptions({ network: { labelSize: 30 } });
      await app.settle();

      // Prove the enlargement landed, in two separate places, because they fail for different
      // reasons and conflating them hides both: the document must hold the new size (else the
      // mutation never happened), and the figure must have grown (else the scene is a stale
      // memo and every geometry assertion below is measuring the old picture).
      const stored = (await app.plot(plotId)) as { fonts?: { tick?: { size?: number } } } | undefined;
      if (stored?.fonts?.tick?.size !== 30) notStored.push(`${title}: document holds tick size ${String(stored?.fonts?.tick?.size)}`);
      const after = await app.figureGeometry();
      // Stale = the drawing still carries the old font sizes. Total text area is not a usable test: a fresh
      // drawing can drop a crowded label at the larger size (e.g. a network placing names clear of its colour bar),
      // so its text area can fall although it was plainly redrawn.
      if (!FONT_ROLE_NA[title] && JSON.stringify(after.fontSizes) === JSON.stringify(before.fontSizes)) {
        notDrawn.push(
          `${title}: area ${before.textArea} → ${after.textArea}; rendered sizes ` +
            `${JSON.stringify(before.fontSizes)} → ${JSON.stringify(after.fontSizes)}`,
        );
      }
      // Judge the delta, not the absolute: a chart already carrying budgeted debt should not be
      // reported again here, but it must not get worse when the text grows.
      const dOverlap = after.overlaps.length - before.overlaps.length;
      const dClipped = after.clipped.length - before.clipped.length;
      const budget = FONT_STRESS_BAD[title] ?? { overlaps: 0, clipped: 0 };
      if (dOverlap > budget.overlaps || dClipped > budget.clipped) {
        broke.push(
          `${title}: +${dOverlap} overlaps, +${dClipped} clipped at tick 30 / title 40` +
            (after.clipped.length ? ` — e.g. "${after.clipped[0]!.txt}"` : ` — e.g. "${after.overlaps[0]?.a}"×"${after.overlaps[0]?.b}"`),
        );
      }
    }

    expect(
      notStored,
      "Setting the font did not reach the document — a broken mutation, not a layout problem:\n  - " +
        notStored.join("\n  - ") + "\n",
    ).toEqual([]);
    expect(
      notDrawn,
      "The document holds the larger font but the figure did not grow, so every measurement below " +
        "is of a stale scene:\n  - " + notDrawn.join("\n  - ") + "\n",
    ).toEqual([]);
    expect(
      broke,
      "These charts lay out fine at the default font but break when the text is enlarged — their " +
        "margins are not derived from the font size:\n  - " + broke.join("\n  - ") + "\n",
    ).toEqual([]);
    expect(await app.consoleErrors()).toEqual([]);
  });

  /**
   * Axis title clearance - never too close, never too far, at any font size.
   *
   * A title pinned to the canvas edge while its tick labels are placed from the plot rect gives
   * two independent formulas, so the gap between them is whatever falls out: enlarge the text
   * and the title walks onto the numbers and the rotated Y title runs off the canvas.
   * The title anchors to its own tick labels
   * (`AxisScene.titlePos`), so the gap is `titleGap` by construction.
   *
   * Both bounds are asserted. A minimum-only test would pass a title parked against the canvas
   * edge far from its axis, which is the "too far" half of the problem.
   */
  test("axis titles keep their clearance from the tick labels at every font size", async ({ page }) => {
    test.slow();
    const app = new MadyApp(page);
    await app.open();
    await app.openGraph("Dose-response");

    const rows: { font: string; x: number | null; y: number | null; xMargin: number | null; yMargin: number | null }[] = [];
    for (const [tick, title] of [[10, 13], [13, 15], [16, 20], [20, 26], [24, 30]] as const) {
      await app.setPlotOptions({ fonts: { tick: { size: tick }, axisTitle: { size: title } } });
      rows.push({ font: `${tick}/${title}`, ...(await app.axisTitleClearance()) });
    }
    console.log("\n=== Axis title clearance (px) ===\n" + JSON.stringify(rows, null, 1));

    const bad: string[] = [];
    for (const r of rows) {
      // Too close: any non-positive gap is the title touching its own tick numbers.
      if (r.x != null && r.x < 1) bad.push(`x-title at ${r.font}: ${r.x}px gap - on the numbers`);
      if (r.y != null && r.y < 1) bad.push(`y-title at ${r.font}: ${r.y}px gap - on the numbers`);
      // Off-canvas: the title is clipped.
      if (r.xMargin != null && r.xMargin < 0) bad.push(`x-title at ${r.font}: ${r.xMargin}px past the bottom edge`);
      if (r.yMargin != null && r.yMargin < 0) bad.push(`y-title at ${r.font}: ${r.yMargin}px past the left edge`);
      // Too far: a title drifting out into whitespace instead of hugging its axis.
      if (r.x != null && r.x > 40) bad.push(`x-title at ${r.font}: ${r.x}px gap - detached from its axis`);
      if (r.y != null && r.y > 40) bad.push(`y-title at ${r.font}: ${r.y}px gap - detached from its axis`);
    }
    expect(bad, "Axis title clearance is out of band:\n  - " + bad.join("\n  - ") + "\n").toEqual([]);

    // ...and it must not track the font. Guards against a gap that shrinks as the text grows,
    // which would only show up on posters and slides.
    const ys = rows.map((r) => r.y).filter((v): v is number => v != null);
    expect(Math.max(...ys) - Math.min(...ys), `y-title clearance swings by ${(Math.max(...ys) - Math.min(...ys)).toFixed(1)}px across a 2.4x font range`).toBeLessThan(12);
    expect(await app.consoleErrors()).toEqual([]);
  });
});
