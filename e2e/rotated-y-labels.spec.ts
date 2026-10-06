import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { collectErrors, MadyApp } from "./app";

/**
 * Rotated Y-axis labels on every chart — the Y counterpart of `rotated-axis-labels.spec.ts`: rotated
 * Y axis labels are checked on all graph types. The same measurement rules apply: the scene is the one
 * whose component draws the svg; a title is found with its markup removed, and not finding it fails.
 *
 * Every gallery card (plus the horizontal form of the kinds that have one, and the vertical lollipop), at each
 * rotation the Y panel offers, read back from the real browser:
 *  - Into the plot — a label's drawn outline reaches right of the Y axis;
 *  - Off the canvas — a label or the Y title runs past the figure's edge;
 *  - Missing — a label shown when horizontal is blank or absent when turned;
 *  - Not turned — the chart kept the turn but drew a label level (a figure that ignores the control);
 *  - Dropped silently — the chart drew the names level (the rule for names longer than their rows)
 *    without saying so in a warning;
 *  - Title — the Y title reaches over the labels, or overlaps any text (never compared with the flat chart);
 *  - Overlaps — text the rotation made collide.
 */

// 0° runs only the title checks.
const ROTATIONS = ["0", "45", "90", "-45", "-90"];
const FLIPPABLE = new Set(["bar", "box", "violin", "scatter", "floatingbar"]);

type Box = { txt: string; top: number; bottom: number; left: number; right: number };
type Probe = {
  canvas: { w: number; h: number };
  plotLeft: number;
  shown: string[];
  labels: Box[];
  /** Labels drawn level while the scene kept the turn. */
  notTurned: string[];
  /** The turn the scene kept (undefined = drawn level). */
  keptRotation: number | undefined;
  levelWarning: boolean;
  title: Box | null;
  titleExpected: boolean;
  titleKey: string | null;
};

test("rotated Y labels stay left of the plot, on the canvas, clear of each other and of the Y title", async ({ page }) => {
  test.setTimeout(40 * 60_000);
  await collectErrors(page);
  const app = new MadyApp(page);
  await app.open();
  const titles = await app.openGallery();

  const selectY = async (): Promise<void> => {
    await page.evaluate(`(() => {
      const r = document.getElementById('root'); const k = Object.keys(r).find((x) => x.startsWith('__reactContainer'));
      const a = r[k]; const root = a.stateNode && a.stateNode.current ? a.stateNode.current : a;
      const seen = new Set(); let fn = null;
      const go = (n, d) => { if (!n || d > 160 || fn || seen.has(n)) return; seen.add(n); const p = n.memoizedProps;
        if (p && typeof p === 'object' && typeof p.onSelect === 'function' && 'activeSection' in p) { fn = p.onSelect; return; }
        go(n.child, d + 1); go(n.sibling, d); };
      go(root, 0);
      if (!fn) throw new Error('no Inspector onSelect');
      fn({ kind: 'axis', axis: 'y' });
    })()`);
    await app.settle();
  };
  const rotationSelect = page.locator("label.frow", { has: page.locator(":scope > span", { hasText: /^Label rotation$/ }) }).locator("select");
  const setRotation = async (value: string): Promise<void> => {
    await rotationSelect.first().evaluate((el, v) => {
      const s = el as HTMLSelectElement;
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(s, v);
      s.dispatchEvent(new Event("change", { bubbles: true }));
    }, value);
    await app.settle();
  };

  const probe = async (): Promise<Probe> =>
    page.evaluate(() => {
      const svg = document.querySelector("svg.gfx-figure") as SVGSVGElement;
      const vb = svg.viewBox.baseVal;
      // The figure's size, not the visible area: the graph view grows its viewBox to take in anything
      // drawn past the edge (figureGrowth.ts) — measured against that, run-off text would read as inside.
      const fw = Number(svg.getAttribute("data-figure-w")) || vb.width;
      const fh = Number(svg.getAttribute("data-figure-h")) || vb.height;
      // Element → figure units. In Chromium, getCTM() includes the <svg>'s own viewBox scale and shift,
      // so it reads figure units only at scale 1 with an unshifted viewBox.
      const userCTM = (el: SVGGraphicsElement): DOMMatrix | null => {
        const root = (svg as SVGSVGElement).getScreenCTM();
        const own = el.getScreenCTM();
        return root && own ? root.inverse().multiply(own) : null;
      };
      const r = document.getElementById("root")!;
      const k = Object.keys(r).find((x) => x.startsWith("__reactContainer"))!;
      const a = (r as unknown as Record<string, { stateNode?: { current?: unknown } }>)[k]!;
      const root = (a.stateNode?.current ?? a) as { child?: unknown };
      type Sc = { width: number; height: number; warnings: string[]; fonts: { yTick: { size: number } }; plot: { x: number; y: number; width: number; height: number }; y: { title?: string; titlePos?: number; hidden?: boolean; tickRotation?: number; ticks: { label: string; minor?: boolean; pos: number }[] } };
      type Fiber = { child?: Fiber; sibling?: Fiber; stateNode?: unknown; memoizedProps?: { scene?: Sc } };
      const hostOf = (n: Fiber): Element | null => {
        for (let c = n.child; c; c = c.child) if (c.stateNode instanceof Element) return c.stateNode;
        return null;
      };
      const scenes: Sc[] = [];
      const seen = new Set<Fiber>();
      const go = (n: Fiber | undefined, d: number): void => {
        if (!n || d > 200 || seen.has(n)) return;
        seen.add(n);
        const s = n.memoizedProps?.scene;
        if (s && s.plot && s.y && Array.isArray(s.y.ticks)) {
          const h = hostOf(n);
          if (h && (h === svg || h === svg.parentElement || svg.contains(h))) scenes.push(s);
        }
        go(n.child, d + 1);
        go(n.sibling, d);
      };
      go(root as Fiber, 0);
      const scene = scenes.find((s) => Math.abs(s.width - fw) < 1 && Math.abs(s.height - fh) < 1);
      if (!scene) throw new Error(`no scene of ${fw}×${fh} draws svg.gfx-figure (${scenes.length} candidates)`);
      const shown = scene.y.ticks.filter((t) => !t.minor && t.label !== "").map((t) => t.label);
      const outline = (t: SVGTextElement): Box | null => {
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
      const turned = (t: SVGTextElement): boolean => (t.getAttribute("transform") ?? "").startsWith("rotate(");
      // The Y labels: the scene's names, anchored left of the plot (an X label anchors below it), turned or not.
      // Not "texts with their own rotate()": the lollipop and paired-dot Y titles are drawn that way too, and
      // matching on that would discard them and report "title not found".
      // …and at its tick: the text reads like a tick label and its anchor sits on that tick's height (a turned
      // label turns about a point at the tick; a flat one's baseline is a third of the font below it). Matching on
      // text alone would take UpSet's set-size counts ("5", "4") left of its plot for Y labels.
      const ticksOf = scene.y.ticks.filter((t) => !t.minor && t.label !== "");
      const anchorY = (t: SVGTextElement): number => {
        const m = /rotate\([-\d.]+ [-\d.]+ ([-\d.]+)\)/.exec(t.getAttribute("transform") ?? "");
        return m ? Number(m[1]) : Number(t.getAttribute("y")) - scene.fonts.yTick.size * 0.34;
      };
      const labelEls = texts.filter((t) => {
        const txt = (t.textContent ?? "").trim();
        if (t.getAttribute("x") === null || Number(t.getAttribute("x")) >= scene.plot.x) return false;
        return ticksOf.some((k) => k.label === txt && Math.abs(anchorY(t) - k.pos) <= Math.max(3, scene.fonts.yTick.size * 0.5));
      });
      const frame = (() => { const g = labelEls[0]?.parentElement as unknown as SVGGraphicsElement | null | undefined; return g ? userCTM(g) : null; })();
      const plotLeft = frame ? frame.a * scene.plot.x + frame.e : scene.plot.x;
      const labels = labelEls.map(outline).filter((l): l is Box => l !== null);
      const keptRotation = scene.y.tickRotation || undefined;
      const notTurned = keptRotation ? labelEls.filter((t) => !turned(t)).map((t) => (t.textContent ?? "").trim()) : [];
      const plain = (s: string): string => s.replace(/[_^{}\s]/g, "");
      const want = plain(scene.y.title ?? "");
      // A title is expected only where a Y axis is drawn at the left (the polar histogram draws its scale inside).
      const titleExpected = want !== "" && !scene.y.hidden && labelEls.length > 0;
      const aimX = scene.y.titlePos ?? 14;
      const titleEl = titleExpected
        ? texts
          .filter((t) => !labelEls.includes(t) && plain(t.textContent ?? "") === want)
          .map((t) => ({ t, o: outline(t) }))
          .filter((c): c is { t: SVGTextElement; o: Box } => c.o !== null)
          .sort((p, q) => Math.abs((p.o.left + p.o.right) / 2 - aimX) - Math.abs((q.o.left + q.o.right) / 2 - aimX))[0]
        : undefined;
      return {
        canvas: { w: fw, h: fh }, plotLeft, shown, labels, notTurned, keptRotation,
        levelWarning: scene.warnings.some((w) => /names are drawn level/.test(w)),
        title: titleEl ? titleEl.o : null, titleExpected, titleKey: titleEl ? (titleEl.t.textContent ?? "").trim().slice(0, 24) : null,
      };
    });

  const bad: string[] = [];
  const reached: string[] = [];
  const only = (process.env.ROTY_ONLY ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const off = (l: Box, c: Probe["canvas"]): boolean => l.left < -1.5 || l.top < -1.5 || l.right > c.w + 1.5 || l.bottom > c.h + 1.5;

  const sweepChart = async (name: string): Promise<void> => {
    await selectY();
    if ((await rotationSelect.count()) === 0) return;
    await setRotation("0");
    const flat = await probe();
    const flatGeo = await app.figureGeometry();
    const pairKey = (o: { a: string; b: string }): string => [o.a, o.b].sort().join(" × ");
    const had = new Set(flatGeo.overlaps.map(pairKey));
    const hadClip = new Set(flatGeo.clipped.map((c) => c.txt));
    for (const rot of ROTATIONS) {
      await setRotation(rot);
      const p = await probe();
      const geo = await app.figureGeometry();
      const where = `${name} · Y ${rot}°`;
      reached.push(where);
      const problems: string[] = [];
      const isTurned = rot !== "0";
      const into = p.labels.filter((l) => l.right > p.plotLeft + 1);
      if (into.length) problems.push(`into the plot: ${into.map((l) => `"${l.txt}" (right ${l.right.toFixed(0)} > plot left ${p.plotLeft.toFixed(0)})`).join(", ")}`);
      const offLabels = p.labels.filter((l) => off(l, p.canvas));
      if (offLabels.length) problems.push(`label off the canvas: ${offLabels.map((l) => `"${l.txt}"`).join(", ")}`);
      const missing = isTurned ? flat.shown.filter((s) => !p.shown.includes(s) || !p.labels.some((l) => l.txt === s)) : [];
      if (missing.length) problems.push(`missing: ${missing.map((s) => `"${s}"`).join(", ")}`);
      if (p.notTurned.length) problems.push(`not turned although the chart kept the turn: ${p.notTurned.map((s) => `"${s}"`).join(", ")}`);
      if (isTurned && p.labels.length && p.keptRotation === undefined && !p.levelWarning) problems.push("the labels were drawn level without a warning saying why");
      if (p.titleExpected && !p.title) problems.push("the Y title was not found in the drawing — its checks could not run");
      if (p.title && off(p.title, p.canvas)) problems.push(`Y title off the canvas: "${p.title.txt}"`);
      if (p.title && p.labels.length) {
        const leftmost = Math.min(...p.labels.map((l) => l.left));
        if (p.title.right > leftmost + 1) problems.push(`Y title "${p.title.txt}" reaches over the labels (title right ${p.title.right.toFixed(0)} > labels left ${leftmost.toFixed(0)})`);
      }
      const titleHits = p.titleKey ? geo.overlaps.filter((o) => o.a === p.titleKey || o.b === p.titleKey) : [];
      if (titleHits.length) problems.push(`Y title overlaps ${titleHits.map((o) => `"${o.a}"×"${o.b}" (${o.ox}×${o.oy}px)`).join(", ")}`);
      const newOverlaps = geo.overlaps.filter((o) => !had.has(pairKey(o)));
      if (newOverlaps.length) problems.push(`overlaps ${newOverlaps.map((o) => `"${o.a}"×"${o.b}"`).join(", ")}`);
      const newClipped = geo.clipped.filter((c) => !hadClip.has(c.txt));
      if (newClipped.length) problems.push(`clipped ${newClipped.map((c) => `"${c.txt}"`).join(", ")}`);
      if (problems.length) bad.push(`${where}: ${problems.join("; ")}`);
    }
    await setRotation("0");
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
    if (stored?.kind === "lollipop" && stored.barOrientation !== "vertical") {
      await app.openGallery();
      await app.openGalleryCard(title);
      await app.setPlotOptions({ barOrientation: "vertical" });
      await sweepChart(`${title} (vertical)`);
    }
  }
  expect(reached.length, "too few charts offered Y label rotation — the sweep looked at almost nothing").toBeGreaterThan(only.length === 0 ? 40 : 0);
  expect(bad, "Rotated Y labels broke the figure:\n  - " + bad.join("\n  - ") + "\n").toEqual([]);
  expect(await app.consoleErrors()).toEqual([]);
});
