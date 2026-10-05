import { expect, test } from "@playwright/test";
import { MadyApp } from "./app";

/**
 * A draggable thing must stay draggable — the second drag has to work as well as the first.
 *
 * Guards against draggable text being movable only once per figure (prevented by
 * `user-select: none` on `svg.gfx-figure`). Without it, the first drag commits; every drag after
 * it logs `pointerdown → pointercancel → lostpointercapture` with no `pointerup`, because the
 * first drag leaves the label's glyphs selected and pressing inside a selection makes Chromium
 * start a native drag-and-drop of the text and cancel the pointer. The commit happens on
 * `pointerup`, so nothing reaches the document — and the label is left visibly displaced by the
 * abandoned live offset, so it looks like it has moved. Nothing about the app's own state is
 * wrong, which is why jsdom tests cannot see it.
 *
 * Why this is not covered by `dead-affordance.spec.ts`: that spec drives each target until it
 * commits once and then moves on, so a drag that works once and never again is invisible to it
 * by construction. It has to be its own test, and it has to be in a real browser: jsdom has no
 * selection model, no pointer capture and no `pointercancel`, so there is nothing there to break.
 */

/** Drag an element by (dx, dy) from its own centre and report whether the document changed. */
async function dragBy(
  app: MadyApp,
  page: import("@playwright/test").Page,
  label: string,
  dx: number,
  dy: number,
): Promise<{ moved: boolean; found: boolean }> {
  const spot = await page.evaluate((want) => {
    const svg = document.querySelector("svg.gfx-figure");
    if (!svg) return null;
    for (const el of [...svg.querySelectorAll<SVGElement>("g.gfx-dragtext")]) {
      if ((el.textContent ?? "").trim() !== want) continue;
      const b = el.getBoundingClientRect();
      if (b.width < 2 || b.height < 2) continue;
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    }
    return null;
  }, label);
  if (!spot) return { moved: false, found: false };
  const before = JSON.stringify(await app.project());
  await page.mouse.move(spot.x, spot.y);
  await page.mouse.down();
  await page.mouse.move(spot.x + dx, spot.y + dy, { steps: 10 });
  await page.mouse.up();
  await app.settle();
  return { moved: JSON.stringify(await app.project()) !== before, found: true };
}

test("a graph title can be dragged again and again, not once", async ({ page }) => {
  const app = new MadyApp(page);
  await app.open();
  // Note: the heatmap on purpose: its title and its row/column labels are `DraggableTitle`
  // instances, which can exhibit the defect. (Dose-response draws its title through a different
  // path and has no `g.gfx-dragtext` at all, so it cannot exhibit this and would be a fixture
  // that proves nothing.)
  await app.openGraph("Gene expression heatmap");
  await app.settle();
  const id = await app.activePlotId();
  const offset = async (): Promise<string> =>
    JSON.stringify(((await app.plot(id)) as Record<string, unknown>)["titleOffset"] ?? null);

  const seen: string[] = [];
  for (let i = 1; i <= 3; i++) {
    const r = await dragBy(app, page, "Gene expression heatmap", 40, 26);
    expect(r.found, `the title vanished before drag ${i}`).toBe(true);
    expect(r.moved, `drag ${i} of the graph title changed nothing in the document`).toBe(true);
    seen.push(await offset());
  }
  // Each drag must add to the last, not overwrite it with the same value — a handler that
  // re-committed its starting offset would also "change" the document on drag 1 and then
  // silently plateau, which is the failure this guards against.
  expect(new Set(seen).size, `the title offset stopped advancing: ${seen.join(" → ")}`).toBe(3);
});

test("a heatmap row/column label can be dragged again and again", async ({ page }) => {
  const app = new MadyApp(page);
  await app.open();
  await app.openGraph("Gene expression heatmap");
  await app.settle();
  const id = await app.activePlotId();
  const offsets = async (): Promise<string> =>
    JSON.stringify(((await app.plot(id)) as Record<string, unknown> as { heatmap?: Record<string, unknown> })["heatmap"]?.["colLabelOffsets"] ?? null);

  const seen: string[] = [];
  for (let i = 1; i <= 3; i++) {
    const r = await dragBy(app, page, "Drug A", 30, 20);
    expect(r.found, `the label vanished before drag ${i}`).toBe(true);
    expect(r.moved, `drag ${i} of the heatmap column label changed nothing in the document`).toBe(true);
    seen.push(await offsets());
  }
  expect(new Set(seen).size, `the label offset stopped advancing: ${seen.join(" → ")}`).toBe(3);
});
