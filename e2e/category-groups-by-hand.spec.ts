import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { collectErrors, MadyApp, type FigureGeometry } from "./app";

/**
 * Category groups ▸ By hand on every chart that offers it: does the grouped figure still look right?
 *
 * The jsdom sweep (`Inspector.categoryaxis.test.tsx`) proves the boxes reach the drawing on every
 * chart. It cannot see text: jsdom has no text metrics. This drives the real boxes in a browser on
 * every gallery card (and the flipped form of each kind that has one), on every axis whose panel
 * offers Group by, in two groupings, and reports text that the grouping made overlap or run off
 * the canvas — compared with the same chart before grouping, so existing overlaps are not re-reported.
 *
 * It covers every applicable graph type.
 */

const FLIPPABLE = new Set(["bar", "box", "violin", "scatter", "floatingbar"]);

type Finding = { chart: string; axis: string; grouping: string; newOverlaps: FigureGeometry["overlaps"]; newClipped: FigureGeometry["clipped"]; groupsDrawn: string[] };

test("By hand groups on every applicable chart draw without new overlapping or clipped text", async ({ page }) => {
  test.setTimeout(30 * 60_000);
  await collectErrors(page);
  const app = new MadyApp(page);
  await app.open();
  const titles = await app.openGallery();

  const findings: Finding[] = [];
  const reached: string[] = [];

  const selectAxis = async (axis: "x" | "y"): Promise<void> => {
    await page.evaluate(`(() => {
      const r = document.getElementById('root'); const k = Object.keys(r).find((x) => x.startsWith('__reactContainer'));
      const a = r[k]; const root = a.stateNode && a.stateNode.current ? a.stateNode.current : a;
      const seen = new Set(); let fn = null;
      const go = (n, d) => { if (!n || d > 160 || fn || seen.has(n)) return; seen.add(n); const p = n.memoizedProps;
        if (p && typeof p === 'object' && typeof p.onSelect === 'function' && 'activeSection' in p) { fn = p.onSelect; return; }
        go(n.child, d + 1); go(n.sibling, d); };
      go(root, 0);
      if (!fn) throw new Error('no Inspector onSelect');
      fn({ kind: 'axis', axis: ${JSON.stringify(axis)} });
    })()`);
    await app.settle();
  };
  const groupBy = page.locator("label.frow", { has: page.locator(":scope > span", { hasText: /^Group by$/ }) }).locator("select");
  const setSelect = async (value: string): Promise<void> => {
    await groupBy.first().evaluate((el, v) => {
      const s = el as HTMLSelectElement;
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(s, v);
      s.dispatchEvent(new Event("change", { bubbles: true }));
    }, value);
    await app.settle();
  };
  const boxNames = async (): Promise<string[]> =>
    page.locator('input[aria-label^="Group for "]').evaluateAll((els) => els.map((e) => (e.getAttribute("aria-label") ?? "").replace(/^Group for /, "")));
  const typeBox = async (i: number, value: string): Promise<void> => {
    await page.locator('input[aria-label^="Group for "]').nth(i).evaluate((el, v) => {
      const inp = el as HTMLInputElement;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(inp, v);
      inp.dispatchEvent(new Event("input", { bubbles: true }));
    }, value);
    await app.settle();
  };
  const pairKey = (o: { a: string; b: string }): string => [o.a, o.b].sort().join(" × ");

  // BYHAND_ONLY="Bar,Pareto" re-runs just the cards whose title contains one of those words.
  const only = (process.env.BYHAND_ONLY ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  for (const title of titles.filter((t) => only.length === 0 || only.some((o) => t.toLowerCase().includes(o)))) {
    await app.openGallery();
    await app.openGalleryCard(title);
    const plotId = await app.activePlotId();
    const kind = String(((await app.plot(plotId)) as { kind?: string } | undefined)?.kind ?? "xy");
    const orientation = ((await app.plot(plotId)) as { barOrientation?: string } | undefined)?.barOrientation;
    const forms: { name: string; orientation?: "horizontal" | "vertical" }[] = [{ name: title }];
    if (FLIPPABLE.has(kind) && orientation !== "horizontal") forms.push({ name: `${title} (flipped)`, orientation: "horizontal" });
    // A lollipop is horizontal by default; its vertical form carries the category names along X.
    if (kind === "lollipop" && orientation !== "vertical") forms.push({ name: `${title} (flipped)`, orientation: "vertical" });

    for (const form of forms) {
      if (form.orientation) {
        await app.openGallery();
        await app.openGalleryCard(title);
        await app.setPlotOptions({ barOrientation: form.orientation });
      }
      for (const axis of ["x", "y"] as const) {
        await selectAxis(axis);
        if ((await groupBy.count()) === 0) continue;
        reached.push(`${form.name} · ${axis}`);
        await setSelect("");
        const before = await app.figureGeometry();
        await setSelect("by hand");
        const cats = await boxNames();
        const half = Math.ceil(cats.length / 2);
        const groupings: { name: string; groupOf: (i: number) => string }[] = [
          { name: "all in one group", groupOf: () => "All treatments" },
          { name: "two halves", groupOf: (i) => (i < half ? "First group" : "Second group") },
        ];
        for (const g of groupings) {
          for (let i = 0; i < cats.length; i++) await typeBox(i, g.groupOf(i));
          const after = await app.figureGeometry();
          const had = new Set(before.overlaps.map(pairKey));
          const hadClip = new Set(before.clipped.map((c) => c.txt));
          const names = [...new Set(cats.map((_, i) => g.groupOf(i)))];
          const drawn = await page.locator("svg.gfx-figure text").evaluateAll((els, ns) =>
            (ns as string[]).filter((n) => els.some((e) => (e.textContent ?? "").trim() === n)), names);
          const f: Finding = {
            chart: form.name, axis, grouping: g.name,
            newOverlaps: after.overlaps.filter((o) => !had.has(pairKey(o))),
            newClipped: after.clipped.filter((c) => !hadClip.has(c.txt)),
            groupsDrawn: drawn,
          };
          findings.push(f);
        }
        await setSelect("");
      }
    }
  }
  const bad = findings
    .filter((f) => f.newOverlaps.length || f.newClipped.length || f.groupsDrawn.length === 0)
    .map((f) => `${f.chart} · ${f.axis} · ${f.grouping}: ` +
      (f.groupsDrawn.length === 0 ? "no group name drawn; " : "") +
      (f.newOverlaps.length ? `overlaps ${f.newOverlaps.map((o) => `"${o.a}"×"${o.b}"`).join(", ")}; ` : "") +
      (f.newClipped.length ? `clipped ${f.newClipped.map((c) => `"${c.txt}"`).join(", ")}` : ""));
  // A full run reaches every chart with a category axis (well over ten); a BYHAND_ONLY run reaches
  // only the cards it names, so there the floor is just "something".
  expect(reached.length, "too few charts offered Group by — the sweep looked at almost nothing").toBeGreaterThan(only.length === 0 ? 10 : 0);
  expect(bad, "By hand grouping broke the figure:\n  - " + bad.join("\n  - ") + "\n").toEqual([]);
  expect(await app.consoleErrors()).toEqual([]);
});
