import { expect, test, type Page } from "@playwright/test";
import { MadyApp } from "./app";

/**
 * Axis tab ▸ Title direction — the grip on the graph, under a real mouse (a magnetic
 * anchor at 90, 45, 135 and 180 degrees).
 *
 * jsdom has no screen matrix, so a grip drag can never commit there; the angle maths is unit-tested
 * (`titleGripAngle`), this proves the gesture: select the Y axis, drag the round grip at the end of its
 * title round the title, and the angle stored in the document is the magnet's — 0 near level, 45 near
 * the diagonal — while Shift lets a 62° stand. The badge must show the snap while dragging.
 */

/** Screen points: the grip, and a point at `deg` (anticlockwise) and `r` px from the title's centre. */
async function gripPoints(page: Page, deg: number, r = 90): Promise<{ grip: { x: number; y: number }; target: { x: number; y: number } } | null> {
  return page.evaluate(({ deg, r }) => {
    const g = document.querySelector("svg.gfx-figure [data-title-grip]");
    if (!g) return null;
    const line = g.querySelector("line")!;
    const circle = g.querySelector("circle")!;
    const m = (line as SVGGraphicsElement).getScreenCTM()!;
    const toScreen = (x: number, y: number) => {
      const p = new DOMPoint(x, y).matrixTransform(m);
      return { x: p.x, y: p.y };
    };
    const cx = Number(g.getAttribute("data-cx"));
    const cy = Number(g.getAttribute("data-cy"));
    const a = (deg * Math.PI) / 180;
    return {
      grip: toScreen(Number(circle.getAttribute("cx")), Number(circle.getAttribute("cy"))),
      target: toScreen(cx + Math.cos(a) * r, cy - Math.sin(a) * r),
    };
  }, { deg, r });
}

async function selectYAxis(page: Page, app: MadyApp): Promise<void> {
  // A click on the Y title selects the Y axis. The main figure draws that title as the one <text> placed by
  // `translate(x y)` (+ its turn); tick numbers and the X title are placed by x/y.
  const spot = await page.evaluate(() => {
    const t = [...document.querySelectorAll("svg.gfx-figure text")].find((e) => /^translate\([^)]*\)( rotate\([^)]*\))?$/.test(e.getAttribute("transform") ?? ""));
    if (!t) return null;
    // Aim at letters. A level title wraps onto lines ("Response" / "(%)"), and the centre of the whole
    // block is the gap between two lines — no glyph there, so the click falls through to the plot. At scale 1
    // that gap is under a pixel and a click there may still land; at a 1.6× window fit it is wide enough to
    // miss, which would fail this spec for a reason unrelated to the app.
    const b = (t.querySelector("tspan") ?? t).getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });
  expect(spot, "no Y title found").not.toBeNull();
  await page.mouse.click(spot!.x, spot!.y);
  await app.settle();
}

async function turn(page: Page, app: MadyApp, deg: number, shift = false): Promise<{ badge: string | null; snapped: string | null }> {
  const pts = await gripPoints(page, deg);
  expect(pts, "no rotation grip on the selected axis's title").not.toBeNull();
  // The press must land ON the grip — something drawn over it would take the gesture instead.
  const hit = await page.evaluate(({ x, y }) => {
    const e = document.elementFromPoint(x, y);
    return e ? `${e.tagName}${e.closest("[data-title-grip]") ? " (grip)" : ""} ${e.getAttribute("class") ?? ""}` : "nothing";
  }, pts!.grip);
  expect(hit, `at ${deg}°: the press at the grip lands on ${hit} (grip at ${JSON.stringify(pts!.grip)})`).toContain("(grip)");
  await page.mouse.move(pts!.grip.x, pts!.grip.y);
  await page.mouse.down();
  if (shift) await page.keyboard.down("Shift");
  await page.mouse.move(pts!.target.x, pts!.target.y, { steps: 12 });
  const badge = await page.evaluate(() => document.querySelector("[data-title-grip] [data-rot-badge]")?.textContent ?? null);
  const snapped = await page.evaluate(() => document.querySelector("[data-title-grip] [data-rot-badge]")?.getAttribute("data-rot-snapped") ?? null);
  await page.mouse.up();
  if (shift) await page.keyboard.up("Shift");
  await app.settle();
  return { badge, snapped };
}

test("the Y title's grip turns it, holding at the 45° magnets, and Shift frees it", async ({ page }) => {
  const app = new MadyApp(page);
  await app.open();
  const id = await app.activePlotId();
  const angle = async (): Promise<unknown> => ((await app.plot(id))?.["yAxis"] as Record<string, unknown> | undefined)?.["titleAngle"];

  await selectYAxis(page, app);
  expect(await app.selection()).toMatchObject({ kind: "axis", axis: "y" });
  expect(await angle()).toBeUndefined();

  // 3° off level → the magnet holds it at level.
  const a = await turn(page, app, 3);
  expect(a.badge).toBe("0°");
  expect(a.snapped).toBe("true");
  expect(await angle(), "the grip did not store level").toBe(0);
  // The drawing followed: the title is now level (no rotate on it).
  await selectYAxis(page, app);

  // 48° → 45°.
  const b = await turn(page, app, 48);
  expect(b.badge).toBe("45°");
  expect(await angle()).toBe(45);

  // 131° → 135°.
  await selectYAxis(page, app);
  await turn(page, app, 131);
  expect(await angle()).toBe(135);

  // 176° → 180°.
  await selectYAxis(page, app);
  await turn(page, app, 176);
  expect(await angle()).toBe(180);

  // Shift: 62° stays 62°, and the badge shows it is not snapped.
  await selectYAxis(page, app);
  const c = await turn(page, app, 62, true);
  expect(c.snapped).toBe("false");
  expect(await angle()).toBe(62);

  // Back to 87° → 90°, the default: stored as no choice.
  await selectYAxis(page, app);
  await turn(page, app, 87);
  expect(await angle()).toBeUndefined();

  expect(await app.consoleErrors()).toEqual([]);
});
