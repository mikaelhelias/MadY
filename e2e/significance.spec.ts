import { expect, test } from "@playwright/test";
import { MadyApp, collectErrors } from "./app";

/**
 * Significance markers — the drags that only a real browser can prove.
 *
 * jsdom cannot commit any of this: the pixel→data step runs through `getScreenCTM()`, which
 * it does not implement, so a unit test can assert the affordance and never the result. Both
 * behaviours here would be visible defects to a user:
 *   • a bracket that only moves up and down (rail-locked to the pair it spans), and
 *   • a threshold key at the bottom that cannot be moved at all.
 *
 * The oracle is the document JSON — `bracketShift` on the annotation, `legendOffset` on the
 * plot's significance style — so this is indifferent to layout and immune to pixel flake.
 */
test.describe("significance markers — drag to move, magnet to recentre", () => {
  test("a bracket drags sideways, snaps home, and the threshold key moves too", async ({ page }) => {
    await collectErrors(page); // must be attached before the app boots
    const app = new MadyApp(page);
    await app.open();
    await app.openGraph("Treatment bar chart");
    const plotId = await app.activePlotId();

    // A marker between the first two bars, with the threshold key switched on. No
    // `bracketY`: the builder then parks it near the top of the plot, which keeps this
    // spec independent of whatever values the sample data happens to hold.
    await app.setPlotOptions({
      significance: { legend: true, display: "stars" },
      annotations: [{ id: "sig1", kind: "bracket", from: 1, to: 2, p: 0.0004, role: "significance" }],
    });

    /** The bracket's stroke path (the one drawn in ink, not the transparent hit target). */
    const barPoint = async (): Promise<{ x: number; y: number }> =>
      page.evaluate(() => {
        const svg = document.querySelector("svg.gfx-figure")!;
        // The bracket is the only multi-segment path that is not a data mark: it lives in a
        // group with cursor:move and has a transparent twin. Take the visible one.
        const paths = [...svg.querySelectorAll<SVGPathElement>("path")].filter(
          (p) => p.getAttribute("fill") === "none" && p.getAttribute("stroke") !== "transparent" && (p.closest("g") as HTMLElement | null)?.style.cursor === "move",
        );
        const p = paths[0];
        if (!p) return { x: 0, y: 0 };
        const b = p.getBoundingClientRect();
        // On the bar itself (its top edge), never the bbox centre — that is the hollow
        // between the two end-ticks and the press would land on the bare chart.
        return { x: b.x + b.width / 2, y: b.y + 1 };
      });

    const start = await barPoint();
    expect(start.x, "no significance bracket drawn — the fixture cannot exhibit the drag").toBeGreaterThan(0);

    // 1. Sideways. Guards against the bracket ignoring this axis completely.
    await app.dragBy(start, 70, 0);
    const moved = (await app.plot(plotId)) as { annotations?: { id: string; bracketShift?: number }[] };
    const shifted = (moved.annotations ?? []).find((a) => a.id === "sig1");
    expect(shifted?.bracketShift, "dragging a bracket sideways did nothing").toBeTruthy();
    expect(shifted!.bracketShift!).toBeGreaterThan(0.02);

    // 2. …and back. Released near the centre of the pair it spans, the magnet takes it —
    // `bracketShift` returns to exactly 0 rather than "nearly home".
    const off = await barPoint();
    await app.dragBy(off, -70, 0);
    const back = (await app.plot(plotId)) as { annotations?: { id: string; bracketShift?: number }[] };
    expect((back.annotations ?? []).find((a) => a.id === "sig1")?.bracketShift ?? 0).toBe(0);

    // 3. The threshold key at the figure bottom is draggable.
    //
    // Caution: bring the whole figure into view first. The canvas scrolls, and at the e2e
    // viewport the fold can sit a few pixels above this figure's foot —
    // the key's centre would then be on the Analysis-log drawer below the canvas, so the press
    // would never reach the key and the test would measure the fold, not the drag.
    await page.locator("svg.gfx-figure").first().scrollIntoViewIfNeeded();
    await app.settle();
    const cap = await page.evaluate(() => {
      const svg = document.querySelector("svg.gfx-figure")!;
      const t = [...svg.querySelectorAll<SVGTextElement>("text")].find((el) => /p</.test(el.textContent ?? "") && el.style.cursor === "move");
      if (!t) return null;
      const b = t.getBoundingClientRect();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    });
    expect(cap, "no draggable significance key rendered").not.toBeNull();
    await app.dragBy(cap!, 40, -12);
    const after = (await app.plot(plotId)) as { significance?: { legendOffset?: { dx: number; dy: number } } };
    expect(after.significance?.legendOffset, "dragging the threshold key did nothing").toBeTruthy();
    expect(Math.abs(after.significance!.legendOffset!.dx)).toBeGreaterThan(5);

    const errors = await app.consoleErrors();
    expect(errors, errors.join("\n")).toEqual([]);
  });

  /**
   * Free position & size: with a tickbox ticked, users can freely move and resize
   * brackets. Ticked, the selected bracket grows
   * round end handles; dragging one commits that end as a plot-rect fraction and the
   * drawn bracket widens. jsdom cannot prove any of this (getScreenCTM again).
   */
  test("free position & size: an end handle drags the bracket wider", async ({ page }) => {
    await collectErrors(page);
    const app = new MadyApp(page);
    await app.open();
    await app.openGraph("Treatment bar chart");
    const plotId = await app.activePlotId();
    await app.setPlotOptions({
      annotations: [{ id: "sig1", kind: "bracket", from: 1, to: 2, p: 0.0004, role: "significance", freeform: true }],
    });

    const railWidth = async (): Promise<number> =>
      page.evaluate(() => {
        const p = [...document.querySelectorAll<SVGPathElement>("svg.gfx-figure [data-ann] path")].find(
          (x) => x.getAttribute("stroke") !== "transparent",
        );
        return p ? p.getBoundingClientRect().width : 0;
      });

    // Select the bracket — the handles only exist on the selected bracket.
    const rail = await page.evaluate(() => {
      const p = [...document.querySelectorAll<SVGPathElement>("svg.gfx-figure [data-ann] path")].find(
        (x) => x.getAttribute("stroke") !== "transparent",
      )!;
      const b = p.getBoundingClientRect();
      return { x: b.x + b.width / 2, y: b.y + 1 };
    });
    await page.mouse.click(rail.x, rail.y);
    const handle = page.locator('svg.gfx-figure [data-bracket-end="sig1:2"]');
    await handle.waitFor({ timeout: 5000 });

    const w0 = await railWidth();
    const hb = (await handle.boundingBox())!;
    await app.dragBy({ x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 }, 70, 0);

    const w1 = await railWidth();
    expect(w1, `the bracket did not widen (${w0} → ${w1})`).toBeGreaterThan(w0 + 40);
    const doc = (await app.plot(plotId)) as { annotations?: { id: string; x2?: number }[] };
    const x2 = (doc.annotations ?? []).find((a) => a.id === "sig1")?.x2;
    expect(x2, "the handle drag committed no end fraction").toBeGreaterThan(0);
    expect(x2!).toBeLessThanOrEqual(1);

    const errors = await app.consoleErrors();
    expect(errors, errors.join("\n")).toEqual([]);
  });

  /**
   * The axis holds still while a bracket is dragged. Guards against a mid-drag commit folding
   * the new height into the value domain, which near the top of the graph makes the axis grow
   * in nice-number steps under the cursor and positioning difficult. The drag is visual-only —
   * one commit on release, one re-fit after the pointer is released.
   */
  test("the axis does not re-fit under a bracket drag — one re-fit on release", async ({ page }) => {
    await collectErrors(page);
    const app = new MadyApp(page);
    await app.open();
    await app.openGraph("Treatment bar chart");
    const plotId = await app.activePlotId();
    // Note: the sample chart pins its axis max, and a pinned axis never re-fits, so the fixture
    // could not exhibit the defect and the spec would pass against broken code. Un-pin it.
    await app.setPlotOptions({
      yAxis: {},
      annotations: [{ id: "sig1", kind: "bracket", from: 1, to: 2, p: 0.0004, role: "significance" }],
    });

    const axisMax = async (): Promise<number> =>
      page.evaluate(() => {
        const ticks = [...document.querySelectorAll("svg.gfx-figure text")]
          .map((t) => Number((t.textContent ?? "").trim()))
          .filter((n) => Number.isFinite(n));
        return Math.max(...ticks);
      });
    const rail = await page.evaluate(() => {
      const p = [...document.querySelectorAll<SVGPathElement>("svg.gfx-figure [data-ann] path")].find(
        (x) => x.getAttribute("stroke") !== "transparent",
      )!;
      const b = p.getBoundingClientRect();
      return { x: b.x + b.width / 2, y: b.y + 1 };
    });

    const before = await axisMax();
    // Drag up toward (and past) the plot's top edge in steps — held, not released. The
    // distance must cross a nice-number boundary of the value axis, or the fixture
    // cannot exhibit the re-fit at all.
    await page.mouse.move(rail.x, rail.y);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) {
      await page.mouse.move(rail.x, rail.y - i * 20);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))));
    }
    const during = await axisMax();
    expect(during, `the axis re-fit mid-drag (${before} → ${during}) — the graph resizes under the cursor`).toBe(before);

    // Release: the commit lands, the graph may re-fit once, and the height is stored.
    await page.mouse.up();
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))));
    const doc = (await app.plot(plotId)) as { annotations?: { id: string; bracketY?: number }[] };
    expect((doc.annotations ?? []).find((a) => a.id === "sig1")?.bracketY, "the release committed no height").toBeGreaterThan(0);

    const errors = await app.consoleErrors();
    expect(errors, errors.join("\n")).toEqual([]);
  });

  /**
   * Direction, not just commit. Guards against `dataYAt` mapping the plot's top pixel to
   * `domain[0]` — the axis minimum — which mirrors every vertical bracket/reference-line drag;
   * because the significance headroom folds the new height back into the domain, each frame
   * compounds the error until the bracket runs away (a short up-drag would send the bracket below
   * the data and inflate the axis maximum). The sideways test above cannot see this:
   * it holds dy = 0.
   */
  test("a bracket drags vertically in the direction of the pointer", async ({ page }) => {
    await collectErrors(page);
    const app = new MadyApp(page);
    await app.open();
    await app.openGraph("Treatment bar chart");
    const plotId = await app.activePlotId();
    await app.setPlotOptions({
      annotations: [{ id: "sig1", kind: "bracket", from: 1, to: 2, p: 0.0004, role: "significance" }],
    });

    const barPoint = async (): Promise<{ x: number; y: number }> =>
      page.evaluate(() => {
        const svg = document.querySelector("svg.gfx-figure")!;
        const paths = [...svg.querySelectorAll<SVGPathElement>("path")].filter(
          (p) => p.getAttribute("fill") === "none" && p.getAttribute("stroke") !== "transparent" && (p.closest("g") as HTMLElement | null)?.style.cursor === "move",
        );
        const p = paths[0];
        if (!p) return { x: 0, y: 0 };
        const b = p.getBoundingClientRect();
        return { x: b.x + b.width / 2, y: b.y + 1 };
      });
    const bracketYOf = async (): Promise<number> => {
      const doc = (await app.plot(plotId)) as { annotations?: { id: string; bracketY?: number }[] };
      return (doc.annotations ?? []).find((a) => a.id === "sig1")?.bracketY ?? NaN;
    };

    const start = await barPoint();
    expect(start.x, "no significance bracket drawn — the fixture cannot exhibit the drag").toBeGreaterThan(0);

    // A first tiny move converts the auto-height bracket to an explicit one; the axis
    // re-fits its headroom once there, so direction is measured from the settled state.
    await app.dragBy(start, 0, 4);
    const settled = await barPoint();
    const ySettled = await bracketYOf();
    expect(Number.isFinite(ySettled), "the drag committed no height").toBe(true);

    // Down 60px: the rail must follow the pointer down and the stored height must fall.
    await app.dragBy(settled, 0, 60);
    const afterDown = await barPoint();
    expect(afterDown.y, `dragged down 60px but the rail went ${settled.y} → ${afterDown.y}`).toBeGreaterThan(settled.y + 35);
    const yDown = await bracketYOf();
    expect(yDown, "down must mean a smaller value on the value axis").toBeLessThan(ySettled);

    // …and back up 40px: the rail rises and the stored height grows.
    await app.dragBy(afterDown, 0, -40);
    const afterUp = await barPoint();
    expect(afterUp.y, `dragged up 40px but the rail went ${afterDown.y} → ${afterUp.y}`).toBeLessThan(afterDown.y - 10);
    const yUp = await bracketYOf();
    expect(yUp, "up must mean a larger value on the value axis").toBeGreaterThan(yDown);

    // Grabbing the symbol is grabbing the bracket — the star lives in the same drag
    // group, and it is how a user most often aims at a marker. The drag is a delta from
    // the bracket's own rail: the rail must move by roughly the pointer's travel, never
    // jump to the star's position first (as a value-under-the-cursor rule would).
    const sym = await page.evaluate(() => {
      const t = document.querySelector<SVGTextElement>('svg.gfx-figure [data-ann-text="sig1"]');
      if (!t) return null;
      const b = t.getBoundingClientRect();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    });
    expect(sym, "the bracket draws no symbol to grab").not.toBeNull();
    const railBeforeSym = await barPoint();
    await app.dragBy(sym!, 0, -25);
    const railAfterSym = await barPoint();
    const rise = railBeforeSym.y - railAfterSym.y;
    expect(rise, "dragging the star must move the bracket up").toBeGreaterThan(12);
    expect(rise, "the rail teleported to the star instead of following the motion").toBeLessThan(34);
    const yBySymbol = await bracketYOf();
    expect(yBySymbol, "the star drag must commit a larger height").toBeGreaterThan(yUp);

    // The headroom feedback must not run away: the frozen drag mapping keeps a ~1 bar of
    // pointer travel worth ~1 bar of value. Without it a 60px drag more than doubles the axis
    // maximum and the whole chart shrinks under the cursor.
    const axisMax = await page.evaluate(() => {
      const ticks = [...document.querySelectorAll("svg.gfx-figure text")]
        .map((t) => Number((t.textContent ?? "").trim()))
        .filter((n) => Number.isFinite(n));
      return Math.max(...ticks);
    });
    expect(axisMax, "the value axis inflated under the drag — the headroom loop is compounding").toBeLessThan(100);

    const errors = await app.consoleErrors();
    expect(errors, errors.join("\n")).toEqual([]);
  });
});
