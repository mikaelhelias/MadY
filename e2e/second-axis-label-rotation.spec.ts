import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { collectErrors, MadyApp } from "./app";

/**
 * Label rotation on the second and third value axes (Y2 / Y3 / X2).
 *
 * Their Axis tab offers "Label rotation" and stores the angle; guards against every label still being drawn level.
 * The gallery-wide tests cannot see it: one card has a second axis and none has a third.
 *
 * So this sets each angle through the real panel on the right-hand Y2 ("Bars + line"), the top X2 (the same card
 * flipped) and a Y3 (the XY card with its two series moved to Y2 and Y3), and reads the drawing back:
 *  - level — a label on that axis not drawn turned (or drawn turned at 0°);
 *  - into the plot — a label reaching across its axis (right: left of the plot's right edge; top: below its top);
 *  - onto Y3 — a Y2 label reaching the Y3 axis line;
 *  - off the figure — a label past the figure's edge;
 *  - title — the axis title touching one of its labels, or not found.
 */

const ROTATIONS = ["0", "45", "90", "-45", "-90"];

type Box = { txt: string; left: number; right: number; top: number; bottom: number };
type Read = {
  error?: string;
  side: string;
  kept: number;
  count: number;
  turned: number;
  levelAtZero: number;
  boxes: Box[];
  title: Box | null;
  titleText: string;
  plotRight: number;
  plotTop: number;
  y3AxisX: number | null;
  canvas: { w: number; h: number };
};

test("Y2 / Y3 / top X2 labels turn, stay off the plot, on the figure and clear of their axis title", async ({ page }) => {
  test.setTimeout(10 * 60_000);
  await collectErrors(page);
  const app = new MadyApp(page);
  await app.open();

  const selectAxis = async (axis: string): Promise<void> => {
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
  const rotationSelect = page.locator("label.frow", { has: page.locator(":scope > span", { hasText: /^Label rotation$/ }) }).locator("select");
  const setRotation = async (value: string): Promise<void> => {
    await rotationSelect.first().evaluate((el, v) => {
      const s = el as HTMLSelectElement;
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(s, v);
      s.dispatchEvent(new Event("change", { bubbles: true }));
    }, value);
    await app.settle();
  };

  const read = (axisKey: "y2" | "y3"): Promise<Read> =>
    page.evaluate((key) => {
      const svg = document.querySelector("svg.gfx-figure") as SVGSVGElement;
      const vb = svg.viewBox.baseVal;
      // The figure's size, not the visible area: the graph view grows its viewBox to take in anything
      // drawn past the edge (figureGrowth.ts) — measured against that, run-off text would read as inside.
      const fw = Number(svg.getAttribute("data-figure-w")) || vb.width;
      const fh = Number(svg.getAttribute("data-figure-h")) || vb.height;
      const r = document.getElementById("root")!;
      const k = Object.keys(r).find((x) => x.startsWith("__reactContainer"))!;
      const a = (r as unknown as Record<string, { stateNode?: { current?: unknown } }>)[k]!;
      type Ax = { side?: string; axisX?: number; title?: string; tickRotation?: number; ticks: { label: string; minor?: boolean; pos: number }[] };
      type Sc = { width: number; height: number; plot: { x: number; y: number; width: number; height: number }; y: Ax; y2?: Ax; y3?: Ax };
      type Fiber = { child?: Fiber; sibling?: Fiber; memoizedProps?: { scene?: Sc } };
      const scenes: Sc[] = [];
      const seen = new Set<Fiber>();
      const go = (n: Fiber | undefined, d: number): void => {
        if (!n || d > 200 || seen.has(n)) return;
        seen.add(n);
        const s = n.memoizedProps?.scene;
        if (s && s.plot && s.y && Array.isArray(s.y.ticks)) scenes.push(s);
        go(n.child, d + 1);
        go(n.sibling, d);
      };
      go((a.stateNode?.current ?? a) as Fiber, 0);
      const empty = { side: "", kept: 0, count: 0, turned: 0, levelAtZero: 0, boxes: [], title: null, titleText: "", plotRight: 0, plotTop: 0, y3AxisX: null, canvas: { w: fw, h: fh } };
      const scene = scenes.find((s) => Math.abs(s.width - fw) < 1 && Math.abs(s.height - fh) < 1);
      if (!scene) return { ...empty, error: "no scene draws the figure" };
      const ax = scene[key];
      if (!ax) return { ...empty, error: `no ${key} axis in the scene` };
      const sr = svg.getBoundingClientRect();
      const kx = vb.width / sr.width;
      const ky = vb.height / sr.height;
      // Screen → figure units: a grown viewBox starts at (vb.x, vb.y), not at the figure's corner.
      const ox = vb.x, oy = vb.y;
      const box = (t: Element): Box => {
        const b = t.getBoundingClientRect();
        return { txt: (t.textContent ?? "").trim(), left: ox + (b.left - sr.left) * kx, right: ox + (b.right - sr.left) * kx, top: oy + (b.top - sr.top) * ky, bottom: oy + (b.bottom - sr.top) * ky };
      };
      const names = new Set(ax.ticks.filter((t) => !t.minor && t.label !== "").map((t) => t.label));
      const right = scene.plot.x + scene.plot.width;
      const texts = [...svg.querySelectorAll("text")].filter((t) => !t.closest(".gfx-tooltip"));
      const onAxis = texts.filter((t) => {
        if (!names.has((t.textContent ?? "").trim())) return false;
        const x = Number(t.getAttribute("x"));
        const y = Number(t.getAttribute("y"));
        if (ax.side === "top") return y < scene.plot.y;
        if (key === "y3") return x > (ax.axisX ?? right);
        return x > right && (scene.y3?.axisX === undefined || x < scene.y3.axisX);
      });
      const isTurned = (t: Element): boolean => /^rotate\(/.test(t.getAttribute("transform") ?? "");
      const titleText = (ax.title ?? "").trim();
      const titleEl = titleText
        ? texts.find((t) => !onAxis.includes(t) && (t.textContent ?? "").trim() === titleText
          // A turned title is written `rotate(90)` after a translate, or `rotate(90 x y)` about its own
          // anchor when the title is draggable, as the Y2/Y3 titles are. A pattern of `rotate\(90\)` alone
          // misses that form and reports every title "not found", which also silences the title-overlap check.
          && (ax.side === "top" ? Number(t.getAttribute("y")) < scene.plot.y : /rotate\(90[\s)]/.test(t.getAttribute("transform") ?? "")))
        : undefined;
      return {
        side: ax.side ?? "right",
        kept: ax.tickRotation ?? 0,
        count: onAxis.length,
        turned: onAxis.filter(isTurned).length,
        levelAtZero: 0,
        boxes: onAxis.map(box),
        title: titleEl ? box(titleEl) : null,
        titleText,
        plotRight: right,
        plotTop: scene.plot.y,
        y3AxisX: key === "y2" ? (scene.y3?.axisX ?? null) : null,
        canvas: { w: fw, h: fh },
      };
    }, axisKey);

  const bad: string[] = [];
  const touch = (p: Box, q: Box): boolean => p.left < q.right - 1 && q.left < p.right - 1 && p.top < q.bottom - 1 && q.top < p.bottom - 1;

  const sweep = async (chart: string, axis: "y2" | "y3"): Promise<void> => {
    await selectAxis(axis);
    if ((await rotationSelect.count()) === 0) { bad.push(`${chart} · ${axis}: no "Label rotation" control`); return; }
    for (const rot of ROTATIONS) {
      await setRotation(rot);
      const r = await read(axis);
      const where = `${chart} · ${axis} ${rot}°`;
      const problems: string[] = [];
      if (r.error) problems.push(r.error);
      else {
        if (r.count === 0) problems.push("no labels found on the axis — the checks could not run");
        if (r.kept !== Number(rot)) problems.push(`the chart kept ${r.kept}°`);
        if (rot !== "0" && r.turned !== r.count) problems.push(`level: ${r.count - r.turned} of ${r.count} labels drawn level`);
        if (rot === "0" && r.turned > 0) problems.push(`level: ${r.turned} labels turned at 0°`);
        const into = r.boxes.filter((b) => (r.side === "top" ? b.bottom > r.plotTop + 0.5 : b.left < r.plotRight - 0.5));
        if (into.length) problems.push(`into the plot: ${into.map((b) => `"${b.txt}"`).join(", ")}`);
        if (r.y3AxisX !== null) {
          const onto = r.boxes.filter((b) => b.right > r.y3AxisX! + 0.5);
          if (onto.length) problems.push(`onto Y3: ${onto.map((b) => `"${b.txt}"`).join(", ")}`);
        }
        const off = r.boxes.filter((b) => b.left < -1.5 || b.top < -1.5 || b.right > r.canvas.w + 1.5 || b.bottom > r.canvas.h + 1.5);
        if (off.length) problems.push(`off the figure: ${off.map((b) => `"${b.txt}"`).join(", ")}`);
        if (r.titleText && !r.title) problems.push(`title: "${r.titleText}" not found in the drawing`);
        if (r.title) {
          const hit = r.boxes.filter((b) => touch(b, r.title!));
          if (hit.length) problems.push(`title: "${r.titleText}" touches ${hit.map((b) => `"${b.txt}"`).join(", ")}`);
        }
      }
      if (problems.length) bad.push(`${where}: ${problems.join("; ")}`);
    }
    await setRotation("0");
  };

  await app.openGallery();
  await app.openGalleryCard("Bars + line (2nd axis)");
  await sweep("Bars + line (right Y2)", "y2");

  await app.openGallery();
  await app.openGalleryCard("Bars + line (2nd axis)");
  await app.setPlotOptions({ barOrientation: "horizontal" });
  await sweep("Bars + line, horizontal (top X2)", "y2");

  await app.openGallery();
  await app.openGalleryCard("XY (points + fitted curve)");
  const id = await app.activePlotId();
  const proj = (await app.project()) as { tables: { id: string; columns: { id: string; role?: string }[] }[]; plots: { id: string; source: string }[] };
  const table = proj.tables.find((t) => t.id === proj.plots.find((p) => p.id === id)!.source)!;
  const values = table.columns.filter((c) => c.role !== "x").map((c) => c.id);
  expect(values.length, "the XY card has fewer than two value columns — it cannot put a series on Y3").toBeGreaterThanOrEqual(2);
  await app.setPlotOptions({ seriesStyles: { [values[0]!]: { axis: "y2" }, [values[1]!]: { axis: "y3" } } });
  await sweep("XY (right Y2, Y3 outside it)", "y2");
  await sweep("XY (right Y2, Y3 outside it)", "y3");
  expect(bad, "Label rotation on the second / third value axes:\n  - " + bad.join("\n  - ") + "\n").toEqual([]);
  expect(await app.consoleErrors()).toEqual([]);
});
