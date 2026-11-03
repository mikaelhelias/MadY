import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { collectErrors, MadyApp } from "./app";

/**
 * Rotated X-axis labels on every chart — with and without category groups named by hand.
 *
 * Guards against rotated X labels pushing up into the graph or not showing at all, and against
 * By-hand group names colliding with rotated labels. jsdom cannot see any of this (no text
 * metrics), and a scene-level test only proves `tickRotation` reached the scene — never where the
 * labels are drawn.
 *
 * Every gallery card whose X axis panel offers Label rotation, at each rotation the control offers,
 * reads back from the real browser:
 *  - into the plot — a label's drawn outline starts above the bottom edge of the plot area;
 *  - off the canvas — a label, the axis title or a group name runs past the figure's edge;
 *  - missing — a category name shown when horizontal is blank or absent when rotated;
 *  - overlaps — text the rotation made collide (compared with the same chart horizontal, so an
 *    overlap that already exists without rotation is not counted);
 * and again with By-hand groups on the X axis, where a group name must sit below the lowest label.
 */

// 0° runs only the axis-title checks: a title clash that is already there with flat labels is a clash too.
const ROTATIONS = ["0", "45", "90", "-45", "-90"];
// Kinds with a horizontal form: their X axis then carries the numbers, and the title sits under those.
const FLIPPABLE = new Set(["bar", "box", "violin", "scatter", "floatingbar"]);

type Label = { txt: string; top: number; bottom: number; left: number; right: number };
type Probe = {
  canvas: { w: number; h: number };
  plotBottom: number;
  /** Vertical shift between the scene's pixels and the root SVG's, where the labels are drawn. */
  shift: number;
  shown: string[];
  /** Names hidden for room although the nearest shown name is 1.6 lines away (see the probe). */
  hiddenWithRoom: string[];
  labels: Label[];
  title: Label | null;
  /** The chart has an X title to draw — so not finding it is a failure, never a skipped check. */
  titleExpected: boolean;
  /** The title as `figureGeometry` names it (trimmed, first 24 characters), to pick its overlaps out. */
  titleKey: string | null;
  names: Label[];
};

test("rotated X labels stay below the plot, on the canvas, and clear of group names and the title", async ({ page }) => {
  test.setTimeout(40 * 60_000);
  await collectErrors(page);
  const app = new MadyApp(page);
  await app.open();
  const titles = await app.openGallery();

  const selectX = async (): Promise<void> => {
    await page.evaluate(`(() => {
      const r = document.getElementById('root'); const k = Object.keys(r).find((x) => x.startsWith('__reactContainer'));
      const a = r[k]; const root = a.stateNode && a.stateNode.current ? a.stateNode.current : a;
      const seen = new Set(); let fn = null;
      const go = (n, d) => { if (!n || d > 160 || fn || seen.has(n)) return; seen.add(n); const p = n.memoizedProps;
        if (p && typeof p === 'object' && typeof p.onSelect === 'function' && 'activeSection' in p) { fn = p.onSelect; return; }
        go(n.child, d + 1); go(n.sibling, d); };
      go(root, 0);
      if (!fn) throw new Error('no Inspector onSelect');
      fn({ kind: 'axis', axis: 'x' });
    })()`);
    await app.settle();
  };
  const selectIn = (label: string) =>
    page.locator("label.frow", { has: page.locator(":scope > span", { hasText: new RegExp(`^${label}$`) }) }).locator("select");
  const setSelect = async (label: string, value: string): Promise<void> => {
    await selectIn(label).first().evaluate((el, v) => {
      const s = el as HTMLSelectElement;
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(s, v);
      s.dispatchEvent(new Event("change", { bubbles: true }));
    }, value);
    await app.settle();
  };
  const groupBoxes = page.locator('input[aria-label^="Group for "]');
  const typeBox = async (i: number, value: string): Promise<void> => {
    await groupBoxes.nth(i).evaluate((el, v) => {
      const inp = el as HTMLInputElement;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(inp, v);
      inp.dispatchEvent(new Event("input", { bubbles: true }));
    }, value);
    await app.settle();
  };

  /** The drawn outline of the X tick labels, the X title and the group names, from the live figure. */
  const probe = async (groupNames: string[]): Promise<Probe> =>
    page.evaluate((names) => {
      const svg = document.querySelector("svg.gfx-figure") as SVGSVGElement;
      const vb = svg.viewBox.baseVal;
      // The figure's size, not the visible area: the graph view grows its viewBox to take in anything
      // drawn past the edge (figureGrowth.ts) — measured against that, run-off text would read as inside.
      const fw = Number(svg.getAttribute("data-figure-w")) || vb.width;
      const fh = Number(svg.getAttribute("data-figure-h")) || vb.height;
      // Element → figure units. getCTM() includes the <svg>'s own viewBox scale and shift (measured in
      // Chromium), so it reads figure units only at scale 1 with an unshifted viewBox.
      const userCTM = (el: SVGGraphicsElement): DOMMatrix | null => {
        const root = (svg as SVGSVGElement).getScreenCTM();
        const own = el.getScreenCTM();
        return root && own ? root.inverse().multiply(own) : null;
      };
      // The scene the figure was drawn from — its plot rect and the tick labels it meant to show.
      const r = document.getElementById("root")!;
      const k = Object.keys(r).find((x) => x.startsWith("__reactContainer"))!;
      const a = (r as unknown as Record<string, { stateNode?: { current?: unknown } }>)[k]!;
      const root = (a.stateNode?.current ?? a) as { child?: unknown };
      type Fiber = { child?: Fiber; sibling?: Fiber; stateNode?: unknown; memoizedProps?: { scene?: { width: number; height: number; plot: { y: number; height: number }; fonts: { xTick: { size: number } }; x: { title?: string; titlePos?: number; hidden?: boolean; ticks: { label: string; minor?: boolean; pos: number; suppressedLabel?: string }[] } } } };
      // Only a scene whose component draws this svg. Taking any `scene` prop of the right size can pick up
      // another component's layout on some cards (plot bottom 541 where the picture's axis sits at 514),
      // which would report correctly placed labels as reaching into the plot.
      const hostOf = (n: Fiber): Element | null => {
        for (let c = n.child; c; c = c.child) if (c.stateNode instanceof Element) return c.stateNode;
        return null;
      };
      const scenes: NonNullable<NonNullable<Fiber["memoizedProps"]>["scene"]>[] = [];
      const seen = new Set<Fiber>();
      const go = (n: Fiber | undefined, d: number): void => {
        if (!n || d > 200 || seen.has(n)) return;
        seen.add(n);
        const s = n.memoizedProps?.scene;
        if (s && s.plot && s.x && Array.isArray(s.x.ticks)) {
          const h = hostOf(n);
          if (h && (h === svg || h === svg.parentElement || svg.contains(h))) scenes.push(s);
        }
        go(n.child, d + 1);
        go(n.sibling, d);
      };
      go(root as Fiber, 0);
      const scene = scenes.find((s) => Math.abs(s.width - fw) < 1 && Math.abs(s.height - fh) < 1);
      if (!scene) throw new Error(`no scene of ${fw}×${fh} draws svg.gfx-figure (${scenes.length} candidates)`);
      const shown = scene.x.ticks.filter((t) => !t.minor && t.label !== "").map((t) => t.label);
      // A name hidden for room while every shown name is at least 1.6 lines away along the axis — room a
      // label turned 90° does not need (it needs one line). Comparing with the horizontal chart cannot see
      // this: the name is hidden there too.
      const kept = scene.x.ticks.filter((t) => !t.minor && t.label !== "");
      const hiddenWithRoom = scene.x.ticks
        .filter((t) => !t.minor && t.label === "" && t.suppressedLabel)
        .filter((t) => kept.every((k) => Math.abs(k.pos - t.pos) >= scene.fonts.xTick.size * 1.6))
        .map((t) => t.suppressedLabel!);
      const outline = (t: SVGTextElement): Label | null => {
        const b = t.getBBox();
        const m = userCTM(t);
        if (!m || b.width === 0) return null;
        const pts = [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]]
          .map(([x, y]) => ({ x: m.a * x! + m.c * y! + m.e, y: m.b * x! + m.d * y! + m.f }));
        const xs = pts.map((p) => p.x);
        const ys = pts.map((p) => p.y);
        return { txt: (t.textContent ?? "").trim(), top: Math.min(...ys), bottom: Math.max(...ys), left: Math.min(...xs), right: Math.max(...xs) };
      };
      const texts = Array.from(svg.querySelectorAll("text")).filter((t) => !t.closest(".gfx-tooltip"));
      // The X tick labels are the texts turned by their own rotate(). Matching by text alone would also take
      // the survival chart's number-at-risk counts ("0", "40", "12") for tick labels.
      const turned = (t: SVGTextElement): boolean => (t.getAttribute("transform") ?? "").startsWith("rotate(");
      /**
       * And it must be drawn at the tick it names. Text + "is rotated" does not identify a tick
       * label: the Gardner-Altman card has an X tick genuinely labelled "Difference" and the
       * difference panel's axis title, same word, permanently turned 90°. Matching by text would
       * take the title for the tick label at every rotation — including 0°, where a real tick label
       * carries no rotate() at all — and, sitting beside the plot rather than under it, report it
       * as a label "into the plot" (tick label at y=379 under a plot ending at 353; the title at
       * y=202, x=598.6 with the plot ending at x=549).
       * A turned label is drawn about a pivot at its tick (`xTickLabelPlacement`), so requiring the
       * pivot to sit on a tick of that name ties the element to what it claims to be — and would
       * also catch a tick label drawn in the wrong place, which matching by text never could.
       */
      const tickX = new Map<string, number[]>();
      for (const t of scene.x.ticks) {
        if (t.minor || t.label === "") continue;
        const at = tickX.get(t.label) ?? [];
        at.push(t.pos);
        tickX.set(t.label, at);
      }
      const atItsTick = (t: SVGTextElement): boolean => {
        const m = /^rotate\(\s*[-\d.]+\s+([-\d.]+)/.exec(t.getAttribute("transform") ?? "");
        const pivot = m ? Number(m[1]) : Number(t.getAttribute("x") ?? "NaN");
        if (!Number.isFinite(pivot)) return false;
        const tol = Math.max(scene.fonts.xTick.size, 6);
        return (tickX.get((t.textContent ?? "").trim()) ?? []).some((p) => Math.abs(p - pivot) <= tol);
      };
      const labelEls = texts.filter((t) => turned(t) && shown.includes((t.textContent ?? "").trim()) && atItsTick(t));
      // The plot's edge in the same space as the outlines (root SVG). Scene pixels compared with root ones
      // would report every bar chart's labels 17px "into the plot" while the picture shows them below it.
      const frame = (() => { const g = labelEls[0]?.parentElement as unknown as SVGGraphicsElement | null | undefined; return g ? userCTM(g) : null; })();
      const sceneBottom = scene.plot.y + scene.plot.height;
      const plotBottom = frame ? frame.d * sceneBottom + frame.f : sceneBottom;
      const shift = frame ? frame.f : 0;
      const labels = labelEls.map(outline).filter((l): l is Label => l !== null);
      // The X title by its text without markup: "log_{2} fold change" is drawn as "log2 fold change", so an
      // exact match would find no title on those charts and silently skip every title check there. Of
      // several texts that read the same, the one nearest the title's placed baseline.
      const plain = (s: string): string => s.replace(/[_^{}\s]/g, "");
      const want = plain(scene.x.title ?? "");
      const titleExpected = want !== "" && !scene.x.hidden;
      const aimY = scene.x.titlePos ?? fh - 7;
      const titleEl = titleExpected
        ? texts
          .filter((t) => !turned(t) && plain(t.textContent ?? "") === want)
          .sort((p, q) => Math.abs(Number(p.getAttribute("y")) - aimY) - Math.abs(Number(q.getAttribute("y")) - aimY))[0]
        : undefined;
      const title = titleEl ? outline(titleEl) : null;
      const titleKey = titleEl ? (titleEl.textContent ?? "").trim().slice(0, 24) : null;
      const drawnNames = texts.filter((t) => names.includes((t.textContent ?? "").trim())).map(outline).filter((l): l is Label => l !== null);
      return { canvas: { w: fw, h: fh }, plotBottom, shift, shown, hiddenWithRoom, labels, title, titleExpected, titleKey, names: drawnNames };
    }, groupNames);

  const bad: string[] = [];
  const reached: string[] = [];
  const only = (process.env.ROT_ONLY ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const off = (l: Label, c: Probe["canvas"]): boolean => l.left < -1.5 || l.top < -1.5 || l.right > c.w + 1.5 || l.bottom > c.h + 1.5;

  /** Every rotation, with and without By-hand groups, on the chart that is open now. */
  const sweepChart = async (name: string): Promise<void> => {
    await selectX();
    if ((await selectIn("Label rotation").count()) === 0) return;
    const hasGroups = (await selectIn("Group by").count()) > 0;

    await setSelect("Label rotation", "0");
    const flat = await probe([]);
    const flatGeo = await app.figureGeometry();
    const pairKey = (o: { a: string; b: string }): string => [o.a, o.b].sort().join(" × ");
    const had = new Set(flatGeo.overlaps.map(pairKey));
    const hadClip = new Set(flatGeo.clipped.map((c) => c.txt));

    const passes: { grouping: string; names: string[] }[] = [{ grouping: "no groups", names: [] }];
    if (hasGroups) passes.push({ grouping: "two groups by hand", names: ["First group", "Second group"] });

    for (const pass of passes) {
      if (pass.names.length) {
        await setSelect("Group by", "by hand");
        const n = await groupBoxes.count();
        for (let i = 0; i < n; i++) await typeBox(i, i < Math.ceil(n / 2) ? pass.names[0]! : pass.names[1]!);
      }
      for (const rot of ROTATIONS) {
        await setSelect("Label rotation", rot);
        const p = await probe(pass.names);
        const geo = await app.figureGeometry();
        const where = `${name} · ${rot}° · ${pass.grouping}`;
        reached.push(where);
        const problems: string[] = [];
        // The checks on turned labels (0° has none of them to find).
        const isTurned = rot !== "0";
        const into = p.labels.filter((l) => l.top < p.plotBottom - 1);
        if (into.length) problems.push(`into the plot: ${into.map((l) => `"${l.txt}" (top ${l.top.toFixed(0)} < plot bottom ${p.plotBottom.toFixed(0)})`).join(", ")}`);
        const clippedLabels = p.labels.filter((l) => off(l, p.canvas));
        if (clippedLabels.length) problems.push(`label off the canvas: ${clippedLabels.map((l) => `"${l.txt}"`).join(", ")}`);
        if (p.title && off(p.title, p.canvas)) problems.push(`title off the canvas: "${p.title.txt}"`);
        const offNames = p.names.filter((l) => off(l, p.canvas));
        if (offNames.length) problems.push(`group name off the canvas: ${offNames.map((l) => `"${l.txt}"`).join(", ")}`);
        const missing = isTurned ? flat.shown.filter((s) => !p.shown.includes(s) || !p.labels.some((l) => l.txt === s)) : [];
        if (missing.length) problems.push(`missing: ${missing.map((s) => `"${s}"`).join(", ")}`);
        if (Math.abs(Number(rot)) === 90 && p.hiddenWithRoom.length) problems.push(`hidden although a turned label has room: ${p.hiddenWithRoom.map((s) => `"${s}"`).join(", ")}`);
        // The axis title — never compared with the flat chart: a clash that was already there is still a clash.
        if (p.titleExpected && !p.title) problems.push("the X title was not found in the drawing — its checks could not run");
        if (p.title && p.names.length) {
          const namesBottom = Math.max(...p.names.map((l) => l.bottom));
          if (p.title.top < namesBottom - 1) problems.push(`title "${p.title.txt}" sits on the group names`);
        }
        const titleHits = p.titleKey ? geo.overlaps.filter((o) => o.a === p.titleKey || o.b === p.titleKey) : [];
        if (titleHits.length) problems.push(`title overlaps ${titleHits.map((o) => `"${o.a}"×"${o.b}" (${o.ox}×${o.oy}px)`).join(", ")}`);
        const lowest = p.labels.length ? Math.max(...p.labels.map((l) => l.bottom)) : p.plotBottom;
        const highName = p.names.filter((l) => l.top < lowest - 1);
        if (highName.length) problems.push(`group name above the lowest label: ${highName.map((l) => `"${l.txt}"`).join(", ")}`);
        if (pass.names.length && p.names.length === 0) problems.push("no group name drawn");
        if (p.title && p.title.top < lowest - 1) problems.push(`title "${p.title.txt}" above the lowest label`);
        const newOverlaps = geo.overlaps.filter((o) => !had.has(pairKey(o)));
        if (newOverlaps.length) problems.push(`overlaps ${newOverlaps.map((o) => `"${o.a}"×"${o.b}"`).join(", ")}`);
        const newClipped = geo.clipped.filter((c) => !hadClip.has(c.txt));
        if (newClipped.length) problems.push(`clipped ${newClipped.map((c) => `"${c.txt}"`).join(", ")}`);
        if (problems.length) bad.push(`${where}: ${problems.join("; ")}`);
      }
      await setSelect("Label rotation", "0");
      if (pass.names.length) await setSelect("Group by", "");
    }
  };

  for (const title of titles.filter((t) => only.length === 0 || only.some((o) => t.toLowerCase().includes(o)))) {
    await app.openGallery();
    await app.openGalleryCard(title);
    const stored = (await app.plot(await app.activePlotId())) as { kind?: string; barOrientation?: string } | undefined;
    await sweepChart(title);
    if (stored?.kind && FLIPPABLE.has(stored.kind) && stored.barOrientation !== "horizontal") {
      await app.openGallery();
      await app.openGalleryCard(title);
      await app.setPlotOptions({ barOrientation: "horizontal" });
      await sweepChart(`${title} (horizontal)`);
    }
    // A lollipop is horizontal by default; its vertical form carries the category names along X.
    if (stored?.kind === "lollipop" && stored.barOrientation !== "vertical") {
      await app.openGallery();
      await app.openGalleryCard(title);
      await app.setPlotOptions({ barOrientation: "vertical" });
      await sweepChart(`${title} (vertical)`);
    }
  }
  expect(reached.length, "too few charts offered Label rotation — the sweep looked at almost nothing").toBeGreaterThan(only.length === 0 ? 40 : 0);
  expect(bad, "Rotated X labels broke the figure:\n  - " + bad.join("\n  - ") + "\n").toEqual([]);
  expect(await app.consoleErrors()).toEqual([]);
});
