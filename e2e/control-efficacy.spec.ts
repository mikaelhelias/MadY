import { expect, test } from "@playwright/test";
import { MadyApp, collectErrors } from "./app";

/**
 * Control efficacy — does turning a control actually change the drawing?
 *
 * This complements other checks. `dead-style-fields` proves a field is mentioned,
 * `function-matrix` proves a mutation reaches the document, `scene-census` proves a scene field
 * is classified, `figure-geometry` proves text does not collide. A control can pass all of them
 * and still have no visible effect (e.g. network node parameters that change nothing on screen).
 *
 * Design rules, each avoiding a way a naive check misreports:
 *  1. Drive the real control through the UI, so the app's `mutate` runs. Poking the document
 *     directly never re-renders and reports every control as doing nothing.
 *  2. Assert the render, not the document.
 *  3. Every run carries a positive control. If a known-good control shows no delta, fail as a
 *     broken harness rather than reporting the app's controls as doing nothing.
 *  4. Each control declares the dimension it owns. "Something changed" is not enough — a colour
 *     control that only moves the layout is still broken.
 *  5. A control that legitimately has no effect in the current state must be absent, not present
 *     and doing nothing. `expect: "absent"` asserts exactly that.
 */

interface ControlCase {
  /** Visible row label in the Inspector. */
  label: string;
  /** Value to set (checkbox toggles regardless of the value). */
  value: string | number | boolean;
  /** Which fingerprint key this control claims to own. */
  dimension: string;
  /** Nth control with this label (labels like "Size" repeat across font blocks). */
  nth?: number;
  /** "changes" = the dimension must differ; "absent" = the control must not be offered. */
  expect?: "changes" | "absent";
}

/** The network graph. */
const NETWORK_CONTROLS: ControlCase[] = [
  // ── the positive control: known to work, so a no-delta here means the harness broke ──
  { label: "Edge width", value: 4, dimension: "edgeWidth" },

  { label: "Node size", value: 26, dimension: "nodeRadius" },
  { label: "Size by degree", value: true, dimension: "nodeRadius" },
  { label: "Edge colour", value: "#cc0000", dimension: "edgeStroke" },
  { label: "Edge opacity", value: 1, dimension: "edgeOpacity" },
  { label: "Curved edges", value: true, dimension: "edgeShape" },
  { label: "Value low → high", value: "#00cc00", dimension: "nodeFill" },
  { label: "Node colour", value: "#00cc00", dimension: "nodeFill" },
  { label: "Label size", value: 26, dimension: "labelSize" },
  { label: "Label min degree", value: 4, dimension: "labelCount" },
  { label: "Layout", value: "circular", dimension: "nodePos", nth: 1 },
  // Last on purpose: switching labels off hides the label rows above, so any case that
  // follows it would report "missing" and blame the app for the sweep's own ordering.
  { label: "Show labels", value: true, dimension: "labelCount" },
];

/** Parallel coordinates — plot-level controls (chart background selected). */
const PARALLEL_CONTROLS: ControlCase[] = [
  // positive control first: proven to move the drawing
  { label: "Line width", value: 4, dimension: "edgeWidth" },

  { label: "Line opacity", value: 1, dimension: "edgeOpacity" },
  // The gallery card colours by a column, and "Line colour" only applies without one — so it
  // must be absent here, not present and doing nothing (rule 5).
  { label: "Line colour", value: "#cc0000", dimension: "edgeStroke", expect: "absent" },
  { label: "Curved links", value: true, dimension: "edgeShape" },
  { label: "Axis colour", value: "#cc00cc", dimension: "axisStroke" },
  // Note: order matters. "Ticks per axis" only renders while the ladder is on, and the sweep
  // toggles a checkbox rather than setting it — so "Value ticks" must come last, or it turns
  // the ladder off and the count control is gone before its own case runs.
  { label: "Ticks per axis", value: 2, dimension: "labelCount" },
  // The control hides the axes' value ladder (a scale, not just two numbers), so it is named
  // for what it does.
  { label: "Value ticks", value: true, dimension: "labelCount" },
];

const PARALLEL_POSITIVE = "Line width";

const POSITIVE_CONTROL = "Edge width";

/** Drive every case and report what the app did, separating harness failure from app failure. */
async function sweep(
  app: MadyApp,
  cases: ControlCase[],
  positiveLabel: string,
): Promise<{ dead: string[]; missing: string[]; unexpectedlyPresent: string[]; positiveMoved: boolean }> {
  const dead: string[] = [];
  const missing: string[] = [];
  const unexpectedlyPresent: string[] = [];
  let positiveMoved = false;

  for (const c of cases) {
    const before = await app.renderFingerprint();
    const outcome = await app.setControl(c.label, c.value, c.nth ?? 0);

    if ((c.expect ?? "changes") === "absent") {
      if (outcome !== "missing") unexpectedlyPresent.push(c.label);
      continue;
    }
    if (outcome === "missing") {
      missing.push(c.label);
      continue;
    }

    await app.settle();
    const after = await app.renderFingerprint();
    const moved = before[c.dimension] !== after[c.dimension];
    if (c.label === positiveLabel) positiveMoved = moved;
    if (!moved) dead.push(`${c.label} → ${c.dimension} unchanged (${String(before[c.dimension]).slice(0, 48)})`);
  }
  return { dead, missing, unexpectedlyPresent, positiveMoved };
}

function assertSweep(
  r: { dead: string[]; missing: string[]; unexpectedlyPresent: string[]; positiveMoved: boolean },
  positiveLabel: string,
): void {
  // Rule 3 — a broken harness must not masquerade as a broken app.
  expect(
    r.positiveMoved,
    `Test harness broken: the positive control "${positiveLabel}" changed nothing, so every other ` +
      "result in this run is meaningless. Fix the harness before believing the failures.",
  ).toBe(true);
  expect(r.missing, `Controls the Inspector did not offer at all:\n  - ${r.missing.join("\n  - ")}\n`).toEqual([]);
  expect(
    r.unexpectedlyPresent,
    `Controls that have no effect in this state but are still offered (hide or disable them):\n  - ${r.unexpectedlyPresent.join("\n  - ")}\n`,
  ).toEqual([]);
  expect(
    r.dead,
    "Controls that do nothing — present, settable, and they change nothing on screen:\n  - " + r.dead.join("\n  - ") + "\n",
  ).toEqual([]);
}

/**
 * Open a graph and select the plot itself, so the Inspector shows the kind's panel.
 * `source: "gallery"` for kinds the launch sample document does not contain (parallel).
 */
async function openAndSelectPlot(
  app: MadyApp,
  page: import("@playwright/test").Page,
  graph: string,
  source: "nav" | "gallery" = "nav",
): Promise<void> {
  await app.open();
  if (source === "gallery") {
    await app.openGallery();
    await app.openGalleryCard(graph);
  } else {
    await app.openGraph(graph);
  }
  await page.locator("svg.gfx-figure").click({ position: { x: 5, y: 5 } });
  await app.settle();
}

test.describe("control efficacy — every control changes what it claims to change", () => {
  test("every network control changes the dimension it claims to own", async ({ page }) => {
    await collectErrors(page);
    const app = new MadyApp(page);
    await openAndSelectPlot(app, page, "Signaling network");
    assertSweep(await sweep(app, NETWORK_CONTROLS, POSITIVE_CONTROL), POSITIVE_CONTROL);
    expect(await app.consoleErrors()).toEqual([]);
  });

  test("every parallel-coordinates control changes the dimension it claims to own", async ({ page }) => {
    await collectErrors(page);
    const app = new MadyApp(page);
    await openAndSelectPlot(app, page, "Parallel coordinates", "gallery");
    assertSweep(await sweep(app, PARALLEL_CONTROLS, PARALLEL_POSITIVE), PARALLEL_POSITIVE);
    expect(await app.consoleErrors()).toEqual([]);
  });

  /**
   * Parallel traces must be individually tunable (e.g. thickness). Selecting one trace must let
   * you tune that trace — and it must change only that trace, not the whole bundle.
   */
  /**
   * Per-axis tick settings, end to end: click a variable name → that axis is selected → its
   * panel appears → a control on it changes the drawing.
   *
   * Note: only this layer can prove the first link. The reorder drag calls `setPointerCapture`
   * on the SVG, so the browser retargets the click there; if the label's own `onClick` does not
   * fire, the selection lands on `{kind:"plot"}` and the panel never opens. jsdom does not model
   * pointer capture, so a unit test cannot catch that.
   */
  /**
   * Brushing a flipped axis selects what was dragged over.
   *
   * The brush turns a pixel drag into a data range and back. Flipping an axis inverts that
   * mapping, and if the builder and the renderer ever disagree about which end is "low", the
   * brush selects the inverse of the band the user dragged — on that one axis, with no error
   * raised anywhere. The scene carries `yAtMin`/`yAtMax` so the two sides cannot disagree;
   * this asserts the property that would break if they did.
   *
   * Deliberately stated as geometry rather than as row ids: whatever lies inside the dragged
   * band survives and everything else dims, which is true in either orientation and needs no
   * knowledge of the data.
   */
  test("a brush on a flipped axis keeps exactly the rows under the dragged band", async ({ page }) => {
    await collectErrors(page);
    const app = new MadyApp(page);
    await openAndSelectPlot(app, page, "Parallel coordinates", "gallery");

    await page.locator("svg.gfx-figure text", { hasText: /^Sepal L$/ }).first().click({ force: true });
    await app.settle();
    expect(await app.setControl("Flip axis", true), 'no "Flip axis" control on the selected axis').toBe("set");
    await app.settle();

    // Drag the upper part of that axis, in scene coordinates.
    const band: [number, number] = [80, 240];
    const geo = await page.evaluate(([y0, y1]) => {
      const svg = document.querySelector("svg.gfx-figure")!;
      const r = svg.getBoundingClientRect();
      const vb = svg.getAttribute("viewBox")!.split(" ").map(Number);
      const sx = r.width / vb[2]!, sy = r.height / vb[3]!;
      const t = [...svg.querySelectorAll("text")].find((e) => e.textContent === "Sepal L")!;
      const x = Number(t.getAttribute("x"));
      // A grown viewBox (figureGrowth.ts) starts at (vb[0], vb[1]), not at the figure's corner.
      return { px: r.left + (x - vb[0]!) * sx, y0: r.top + (y0 - vb[1]!) * sy, y1: r.top + (y1 - vb[1]!) * sy };
    }, band);
    await page.mouse.move(geo.px, geo.y0);
    await page.mouse.down();
    await page.mouse.move(geo.px, geo.y1, { steps: 8 });
    await page.mouse.up();
    await app.settle();

    // For every line: is its first point (this axis) inside the dragged band, and is it dimmed?
    const rows = await page.evaluate(([y0, y1]) => {
      const dim = (g: Element): boolean => Number(g.querySelector("path")?.getAttribute("stroke-opacity") ?? 1) < 0.1;
      return [...document.querySelectorAll("svg.gfx-figure g[data-line-id]")].map((g) => {
        const d = g.querySelector("path")!.getAttribute("d")!;
        const y = Number(/^M[-\d.]+,([-\d.]+)/.exec(d)![1]);
        return { inside: y >= y0 && y <= y1, dimmed: dim(g) };
      });
    }, band);

    expect(rows.length, "no lines were measured").toBeGreaterThan(20);
    expect(rows.some((r) => r.inside), "the drag covered no lines — the probe proves nothing").toBe(true);
    expect(rows.some((r) => !r.inside), "the drag covered every line — the probe proves nothing").toBe(true);
    const wrong = rows.filter((r) => r.inside === r.dimmed);
    expect(wrong, `${wrong.length} line(s) contradict the brush — the flipped mapping is inverted somewhere`).toEqual([]);
    expect(await app.consoleErrors()).toEqual([]);
  });

  /**
   * Minor ticks must be visible, not merely present in the DOM.
   *
   * At half a major's length and 60% opacity they would be 3.5px ghosts against a field of
   * crossing data lines: switching them on would change nothing a user could see, which is
   * indistinguishable from a control that does nothing. Counting elements would call that a pass, so this
   * measures what is drawn.
   */
  test("minor ticks are drawn at a length a reader can actually see", async ({ page }) => {
    await collectErrors(page);
    const app = new MadyApp(page);
    await openAndSelectPlot(app, page, "Parallel coordinates", "gallery");
    await page.locator("svg.gfx-figure text", { hasText: /^Sepal L$/ }).first().click({ force: true });
    await app.settle();
    expect(await app.setControl("Minor ticks", 4), 'no "Minor ticks" control on the selected axis').toBe("set");
    await app.settle();

    const marks = await page.evaluate(() => {
      const svg = document.querySelector("svg.gfx-figure")!;
      return [...svg.querySelectorAll("line")]
        /**
         * Exclude the legend explicitly. The `len < 12` rule below is a heuristic for
         * "a tick, not an axis rule or a data line". The legend's swatch stub scales with
         * the legend font, so at a 12px font it is 11.08px — under the threshold and the
         * longest line in the sample. `major` would then read 11.08 instead of the real 7,
         * and correct 5.25px minor ticks would read as 0.47 of it and "too short to see".
         *
         * Naming the legend avoids relying on a length coincidence. A genuinely stunted
         * minor tick still fails — 3px against a 7px major is 0.43.
         */
        .filter((l) => !l.closest("g.gfx-legend"))
        .map((l) => ({
          len: Math.abs(Number(l.getAttribute("x2")) - Number(l.getAttribute("x1"))),
          faded: Number(l.getAttribute("stroke-opacity") ?? 1) < 1,
        }))
        .filter((m) => m.len > 0 && m.len < 12); // tick marks, not axis rules or data
    });
    const major = Math.max(...marks.map((m) => m.len));
    const minors = marks.filter((m) => m.len < major - 0.01);
    expect(minors.length, "no minor ticks were drawn at all").toBeGreaterThan(4);
    for (const m of minors) {
      expect(m.len / major, "a minor tick is too short to see").toBeGreaterThanOrEqual(0.6);
      expect(m.faded, "a minor tick is faded on top of being short").toBe(false);
    }
    expect(await app.consoleErrors()).toEqual([]);
  });

  test("clicking a variable name selects that axis, and its own tick interval reaches the figure", async ({ page }) => {
    await collectErrors(page);
    const app = new MadyApp(page);
    await openAndSelectPlot(app, page, "Parallel coordinates", "gallery");
    const numbers = () => page.evaluate(() => document.querySelectorAll("svg.gfx-figure text").length);

    await page.locator("svg.gfx-figure text", { hasText: /^Sepal L$/ }).first().click({ force: true });
    await app.settle();
    expect(await app.selection(), "clicking a variable name did not select its axis").toEqual(
      expect.objectContaining({ kind: "parallel-axis" }),
    );
    expect(
      await page.evaluate(() => document.querySelector(".insphd")?.textContent ?? ""),
      "the selected axis's panel does not name it",
    ).toContain("Sepal L");

    const before = await numbers();
    expect(await app.setControl("Tick interval", 0.25), 'no "Tick interval" control for the selected axis').toBe("set");
    await app.settle();
    expect(await numbers(), "a per-axis tick interval changed nothing in the figure").toBeGreaterThan(before);
    expect(await app.consoleErrors()).toEqual([]);
  });

  test("a single parallel trace can be re-tuned, and only that trace changes", async ({ page }) => {
    await collectErrors(page);
    const app = new MadyApp(page);
    await openAndSelectPlot(app, page, "Parallel coordinates", "gallery");

    // Select the trace through its React onClick — the same pattern app.ts uses for navigator
    // buttons. Pixel clicking is unreliable here: the visible stroke is pointer-events:none and
    // a thin diagonal path's bbox centre is off the line, so a click falls through to the
    // background and selects the plot instead.
    const clicked = await page.evaluate(() => {
      const hit = document.querySelector("svg.gfx-figure g[data-line-id] path:last-of-type");
      if (!hit) return false;
      const k = Object.keys(hit).find((x) => x.startsWith("__reactProps"));
      const props = k ? (hit as unknown as Record<string, { onClick?: (e: unknown) => void }>)[k] : undefined;
      if (!props?.onClick) return false;
      props.onClick({ stopPropagation() {}, preventDefault() {} });
      return true;
    });
    expect(clicked, "no clickable hit-path on a parallel trace").toBe(true);
    await app.settle();

    // Baseline after selection: selecting draws a halo path behind the trace, so a baseline
    // taken before the click would show a path-count change that has nothing to do with width.
    const before = await app.renderFingerprint();

    // Assert the outcome rather than the selection state: if the trace was not selected, the
    // "Line width" control is the graph-wide one and every trace changes together. Exactly one
    // width among many is the proof that per-trace tuning is real.
    const setW = await app.setControl("Line width", 6);
    expect(setW, 'no "Line width" control while a trace is selected — per-trace tuning is missing').toBe("set");
    await app.settle();
    const afterW = await app.renderFingerprint();

    expect(afterW.perPathWidth, "setting a trace's width changed nothing").not.toBe(before.perPathWidth);
    expect(
      afterW.perPathWidth!.split("|").length,
      "the number of traces changed — this is not a per-trace edit",
    ).toBe(before.perPathWidth!.split("|").length);
    expect(
      new Set(afterW.perPathWidth!.split("|")).size,
      "Every trace changed width, so the graph-wide control was used — the trace was not selected, " +
        "or per-trace width is not wired",
    ).toBeGreaterThan(1);

    const setO = await app.setControl("Line opacity", 0.15);
    expect(setO, 'no "Line opacity" control while a trace is selected').toBe("set");
    // Note: a selected trace is drawn at full opacity so the highlight reads — so its opacity
    // override is invisible until you click away. Deselect before measuring, which is also
    // what a user does. Measuring while selected reports a working control as dead.
    // Escape does not clear a parallel-line selection; select the plot instead, which is what
    // clicking the chart background does.
    await page.evaluate(() => {
      const svg = document.querySelector("svg.gfx-figure");
      const k = svg && Object.keys(svg).find((x) => x.startsWith("__reactProps"));
      const props = k ? (svg as unknown as Record<string, { onClick?: (e: unknown) => void }>)[k] : undefined;
      props?.onClick?.({ stopPropagation() {}, preventDefault() {} });
    });
    await app.settle();
    const afterO = await app.renderFingerprint();
    expect(
      new Set(afterO.perPathOpacity!.split("|")).size,
      "no trace carries its own opacity — per-trace opacity is not wired",
    ).toBeGreaterThan(1);
    expect(afterO.perPathOpacity!.split("|")).toContain("0.15");

    expect(await app.consoleErrors()).toEqual([]);
  });

  test("the harness itself can detect a dead control (a negative control)", async ({ page }) => {
    await collectErrors(page);
    const app = new MadyApp(page);
    await openAndSelectPlot(app, page, "Signaling network");

    // Setting a control to the value it already holds must produce no delta. If this "passes"
    // as changed, the fingerprint is picking up unrelated churn and every result is noise.
    //
    // Note: read the current value; never hardcode it. A hardcoded value goes stale when the
    // kind's house default changes (the network's edge opacity default is 0.25), turning the
    // "no-op" into a real edit, so the negative control would blame a correct fingerprint.
    const before = await app.renderFingerprint();
    const held = Number(before.edgeOpacity);
    expect(Number.isFinite(held), `no single edge opacity to re-apply (got "${before.edgeOpacity}")`).toBe(true);
    await app.setControl("Edge opacity", held);
    await app.settle();
    const after = await app.renderFingerprint();
    expect(
      after.edgeOpacity,
      "the fingerprint reports a change when nothing changed — it is measuring churn, not the control",
    ).toBe(before.edgeOpacity);
  });
});
