// @vitest-environment jsdom
/**
 * Point spread (the "Point spread" slider). `Plot.pointSpread` (0.25–3×, unset = 1) is the
 * swarm's spacing multiplier on bars, box / violin with points and estimation.
 *
 * One control, "Point spread" on the Data tab, serves all of these kinds (including the column scatter), with a
 * "whole graph" tick box beside it, ticked by default: ticked = the whole graph (`Plot.pointSpread`); unticked = only
 * the clicked series (`SeriesStyle.pointSpread`). A column scatter saved with a per-series Width (`boxWidth`) keeps its
 * look: that Width is read as its spread.
 *
 * Checked on the scene's dot positions and on the drawing: a higher spread moves the dots further apart sideways, a lower
 * one packs them, unset draws exactly what 1× draws (no saved graph moves), and over a bar every dot stays inside its bar
 * even at 3×. The control is offered only where the chart draws its points, and writes the field the builder reads.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { tableDatasets, type Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import { Inspector } from "./Inspector";
import { galleryItems } from "./gallery";

afterEach(cleanup);
const SIZE = { width: 580, height: 380 };
/** A gallery card by its plot name, or `kind:<kind>` for the first card of that kind (the raincloud card is named by its title). */
const card = (name: string) => galleryItems().find((g) => (name.startsWith("kind:") ? g.plot.kind === name.slice(5) : g.plot.name === name || g.plot.id === name))!;

/** Every chart that takes the slider, with what it needs to draw its points. */
const CASES: [string, string, Partial<Plot>][] = [
  ["bars", "p-bar", {}],
  ["horizontal bars", "p-bar", { barOrientation: "horizontal" }],
  ["box with points", "p-box", { showBoxPoints: true }],
  ["horizontal box with points", "p-box", { showBoxPoints: true, barOrientation: "horizontal" }],
  ["violin with points", "p-violin", { showBoxPoints: true }],
  ["estimation", "p-est", {}],
  ["column scatter", "p-scatter", {}],
  ["horizontal column scatter", "p-scatter", { barOrientation: "horizontal" }],
];

function sceneOf(name: string, extra: Partial<Plot>, pointSpread?: number) {
  const g = card(name);
  const plot = { ...g.plot, ...extra, ...(pointSpread === undefined ? {} : { pointSpread }) } as Plot;
  return buildPlotScene(g.table, plot, SIZE);
}

/** Total sideways extent of every swarm: for each group, the distance between its outermost dots across the band
 *  (X on an upright chart, Y on a horizontal one). */
function sideways(scene: ReturnType<typeof buildPlotScene>, horizontal: boolean): { total: number; swarms: number } {
  let total = 0;
  let swarms = 0;
  for (const s of scene.series)
    for (const m of s.marks) {
      if (!m.points || m.points.length < 3) continue;
      const cross = m.points.map((p) => (horizontal ? p.cy : p.cx));
      total += Math.max(...cross) - Math.min(...cross);
      swarms++;
    }
  return { total, swarms };
}

const pointsJson = (scene: ReturnType<typeof buildPlotScene>) => JSON.stringify(scene.series.map((s) => s.marks.map((m) => m.points)));

describe("Point spread — the drawing", () => {
  for (const [label, name, extra] of CASES) {
    it(`${label}: 2× spreads the dots wider, 0.5× packs them, unset = 1×`, () => {
      const h = extra.barOrientation === "horizontal";
      const one = sceneOf(name, extra, 1);
      const base = sideways(one, h);
      expect(base.swarms, `${label}: the fixture draws no swarm — it proves nothing`).toBeGreaterThan(0);
      expect(base.total, `${label}: the dots already sit in one line — nothing to spread`).toBeGreaterThan(0);
      expect(sideways(sceneOf(name, extra, 2), h).total, `${label}: 2× did not spread the dots`).toBeGreaterThan(base.total + 1);
      expect(sideways(sceneOf(name, extra, 0.5), h).total, `${label}: 0.5× did not pack the dots`).toBeLessThan(base.total - 1);
      expect(pointsJson(sceneOf(name, extra)), `${label}: unset must draw exactly what 1× draws`).toBe(pointsJson(one));
    });
  }

  for (const [label, extra] of [["vertical", {}], ["horizontal", { barOrientation: "horizontal" }]] as const) {
    it(`${label} bars: at 3× every dot is still inside its own bar`, () => {
      const scene = sceneOf("p-bar", extra, 3);
      let n = 0;
      for (const s of scene.series)
        for (const m of s.marks) {
          if (!m.bar || !m.points?.length) continue;
          for (const p of m.points) {
            n++;
            if (label === "vertical") {
              expect(p.cx, "a dot left its bar").toBeGreaterThanOrEqual(m.bar.x - 1e-6);
              expect(p.cx, "a dot left its bar").toBeLessThanOrEqual(m.bar.x + m.bar.w + 1e-6);
            } else {
              expect(p.cy, "a dot left its bar").toBeGreaterThanOrEqual(m.bar.y - 1e-6);
              expect(p.cy, "a dot left its bar").toBeLessThanOrEqual(m.bar.y + m.bar.h + 1e-6);
            }
          }
        }
      expect(n).toBeGreaterThan(10);
    });
  }

  /** The violin outline's half-width at each value-axis pixel, read off the DRAWN path (straight lines between its steps). */
  function outlineHalf(path: string, cross: number, horizontal: boolean): (vpos: number) => number {
    const pts = [...path.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => (horizontal ? { v: +m[1]!, c: +m[2]! } : { v: +m[2]!, c: +m[1]! }));
    const edge = pts.filter((p) => p.c >= cross - 1e-9).sort((a, b) => a.v - b.v); // one side of the mirror
    return (at) => {
      // The path is written to 0.01 px: a dot at the group's lowest / highest value can sit a hair past its end.
      const lo = edge[0]!.v, hi = edge[edge.length - 1]!.v;
      const vpos = at < lo && at > lo - 0.02 ? lo : at > hi && at < hi + 0.02 ? hi : at;
      for (let k = 0; k + 1 < edge.length; k++) {
        const a = edge[k]!, b = edge[k + 1]!;
        if (vpos >= a.v && vpos <= b.v) return b.v === a.v ? Math.max(a.c, b.c) - cross : a.c - cross + ((b.c - a.c) * (vpos - a.v)) / (b.v - a.v);
      }
      return 0;
    };
  }

  for (const [label, extra] of [["upright", {}], ["horizontal", { barOrientation: "horizontal" }]] as const) {
    for (const spread of [1, 2, 3]) {
      it(`${label} violin at ${spread}×: every dot's edge stays inside the outline`, () => {
        const scene = sceneOf("p-violin", { showBoxPoints: true, ...extra }, spread);
        const h = label === "horizontal";
        // Each dot's drawn radius, keyed by its drawn centre.
        const { container } = render(<PlotFigure scene={scene} />);
        const radius = new Map([...container.querySelectorAll("svg.gfx-figure circle")]
          // Visible dots only: each dot also carries an invisible, larger click target at the same centre.
          .filter((c) => (c.getAttribute("fill") ?? "transparent") !== "transparent" && c.getAttribute("fill-opacity") !== "0" && !c.closest("[data-mady-legend-row]"))
          .map((c) => [`${(+c.getAttribute("cx")!).toFixed(1)},${(+c.getAttribute("cy")!).toFixed(1)}`, +c.getAttribute("r")!]));
        let n = 0;
        for (const s of scene.series)
          for (const m of s.marks) {
            if (!m.violin || !m.points?.length) continue;
            const half = outlineHalf(m.violin.path, m.violin.cx, h);
            for (const p of m.points) {
              const r = radius.get(`${p.cx.toFixed(1)},${p.cy.toFixed(1)}`);
              expect(r, "a scene dot the figure does not draw").toBeDefined();
              n++;
              const off = Math.abs((h ? p.cy : p.cx) - m.violin.cx);
              const room = half(h ? p.cx : p.cy);
              // Where the violin is narrower than the dot (its tips) nothing fits: the dot must sit on the centre line.
              if (room < r!) expect(off, `a dot at the violin's tip is off its centre line at ${spread}×`).toBeLessThanOrEqual(0.5);
              else expect(off + r!, `a dot pokes out of the violin at ${spread}×`).toBeLessThanOrEqual(room + 0.75);
            }
          }
        expect(n, "the fixture draws no violin points").toBeGreaterThan(10);
      });
    }
  }

  it("out-of-range values are held to 0.25–3×", () => {
    expect(pointsJson(sceneOf("p-bar", {}, 10))).toBe(pointsJson(sceneOf("p-bar", {}, 3)));
    expect(pointsJson(sceneOf("p-bar", {}, 0))).toBe(pointsJson(sceneOf("p-bar", {}, 0.25)));
    expect(pointsJson(sceneOf("p-bar", {}, Number.NaN))).toBe(pointsJson(sceneOf("p-bar", {}, 1)));
  });

  it("a column scatter saved with a per-series Width keeps its look (Width 0.8 = Point spread 1.6)", () => {
    const g = card("p-scatter");
    const ids = tableDatasets(g.table).map((d) => d.id);
    const withStyle = (st: Record<string, unknown>) => ({ ...g.plot, seriesStyles: Object.fromEntries(ids.map((id) => [id, { ...(g.plot.seriesStyles?.[id] ?? {}), ...st }])) }) as Plot;
    const old = pointsJson(buildPlotScene(g.table, withStyle({ boxWidth: 0.8 }), SIZE));
    expect(old, "the fixture's saved Width draws what the default draws - this proves nothing").not.toBe(pointsJson(sceneOf("p-scatter", {})));
    expect(pointsJson(buildPlotScene(g.table, withStyle({ pointSpread: 1.6 }), SIZE))).toBe(old);
  });

  // The "only this series" half: one series' own spread moves that series, leaves every other one exactly where it was,
  // and wins over the graph's.
  for (const [label, name, extra] of CASES) {
    it(`${label}: a series' own spread moves only that series, and beats the graph's`, () => {
      const g = card(name);
      const h = extra.barOrientation === "horizontal";
      const id = tableDatasets(g.table)[0]!.id;
      const own = (v: number, graph?: number) =>
        buildPlotScene(g.table, { ...g.plot, ...extra, ...(graph === undefined ? {} : { pointSpread: graph }), seriesStyles: { ...g.plot.seriesStyles, [id]: { ...(g.plot.seriesStyles?.[id] ?? {}), pointSpread: v } } } as Plot, SIZE);
      const base = sceneOf(name, extra);
      const mine = (sc: ReturnType<typeof buildPlotScene>) => sideways({ ...sc, series: sc.series.filter((s) => s.id === id) } as never, h).total;
      const others = (sc: ReturnType<typeof buildPlotScene>) => JSON.stringify(sc.series.filter((s) => s.id !== id).map((s) => s.marks.map((m) => m.points)));
      expect(mine(base), `${label}: the first series draws no swarm - this proves nothing`).toBeGreaterThan(0);
      expect(mine(own(1.7)), `${label}: its own 1.7× did not spread it`).toBeGreaterThan(mine(base) + 1);
      expect(others(own(1.7)), `${label}: another series moved`).toBe(others(base));
      expect(mine(own(1.7, 0.5)), `${label}: the graph's spread beat the series' own`).toBe(mine(own(1.7)));
    });
  }

  it("the rendered dots move, not just the scene", () => {
    const xs = (spread: number) => {
      const { container } = render(<PlotFigure scene={sceneOf("p-bar", {}, spread)} />);
      const out = [...container.querySelectorAll("svg.gfx-figure circle")].filter((c) => !c.closest("[data-mady-legend-row]")).map((c) => c.getAttribute("cx")).join(",");
      cleanup();
      return out;
    };
    const a = xs(1);
    expect(a.length).toBeGreaterThan(0);
    expect(xs(2.5)).not.toBe(a);
  });
});

const handlers = (onSetPlotOptions: (p: Partial<Plot>) => void) => ({
  onSelect: vi.fn(),
  onSetAxis: vi.fn(), onSetAxisLength: vi.fn(), onSetAxisTitleFont: vi.fn(),
  onSetSeriesStyle: vi.fn(), onSetSeriesStyleAll: vi.fn(), onSetPointStyle: vi.fn(), onClearPointStyles: vi.fn(),
  onSetGrid: vi.fn(), onSetFrame: vi.fn(), onSetKind: vi.fn(), onSetBarLayout: vi.fn(), onSetBarShape: vi.fn(), onSetBoxWhisker: vi.fn(),
  onSetPlotOptions, onSetGraphTitle: vi.fn(), onSetPlotFont: vi.fn(), onHomogenizeFont: vi.fn(),
  onSetLegend: vi.fn(), onSetSignificance: vi.fn(), onApplyPreset: vi.fn(),
  onApplyUserPreset: vi.fn(), onSaveUserPreset: vi.fn(), onDeleteUserPreset: vi.fn(), onSetProfileDefault: vi.fn(),
  annotationOps: { add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() },
});
const slider = (c: HTMLElement) => c.querySelector<HTMLInputElement>('input[aria-label="Point spread"]');
const wholeBox = (c: HTMLElement) => c.querySelector<HTMLInputElement>('input[aria-label="Point spread: whole graph"]');
type Writes = { plot: Partial<Plot>[]; series: [string, Record<string, unknown>][] };
const inspect = (plot: Plot, table: unknown, selection: unknown, w: Writes = { plot: [], series: [] }, wholeGraph = false) => {
  const h = handlers((p) => w.plot.push(p));
  h.onSetSeriesStyle = vi.fn((id: string, d: Record<string, unknown>) => w.series.push([id, d]));
  return render(<Inspector activeSection="graphs" selection={selection as never} plot={plot} table={table as never} userPresets={[]} profileDefault={null} wholeGraph={wholeGraph} onSetWholeGraph={() => {}} {...h} />).container;
};
const onSeries = (name: string) => {
  const g = card(name);
  return { g, id: tableDatasets(g.table)[0]!.id };
};

describe("Point spread — the control, on the Data tab", () => {
  for (const [label, name, extra] of CASES) {
    it(`${label}: beside the slider a "whole graph" tick box, ticked; moving it sets the whole graph in one write`, () => {
      const { g, id } = onSeries(name);
      // Another series carries its own spread: "whole graph" must reach it too.
      const other = tableDatasets(g.table)[1]!.id;
      const plot = { ...g.plot, ...extra, seriesStyles: { ...g.plot.seriesStyles, [other]: { ...(g.plot.seriesStyles?.[other] ?? {}), pointSpread: 2.5 } } } as Plot;
      const w: Writes = { plot: [], series: [] };
      const c = inspect(plot, g.table, { kind: "series", columnId: id }, w);
      const s = slider(c);
      expect(s, `${label}: no Point spread slider on the Data tab`).not.toBeNull();
      expect(Number(s!.value)).toBe(1);
      expect(wholeBox(c), `${label}: no whole-graph tick box beside the slider`).not.toBeNull();
      expect(wholeBox(c)!.checked, `${label}: the tick box must start ticked`).toBe(true);
      fireEvent.change(s!, { target: { value: "2" } });
      expect(w.series).toEqual([]);
      expect(w.plot).toHaveLength(1);
      const after = { ...plot, ...w.plot[0] } as Plot;
      expect(after.pointSpread).toBe(2);
      for (const d of tableDatasets(g.table)) expect(after.seriesStyles?.[d.id]?.pointSpread, `${label}: ${d.id} kept its own spread`).toBeUndefined();
    });

    it(`${label}: unticked, moving it sets only the clicked series`, () => {
      const { g, id } = onSeries(name);
      const w: Writes = { plot: [], series: [] };
      const c = inspect({ ...g.plot, ...extra } as Plot, g.table, { kind: "series", columnId: id }, w);
      fireEvent.click(wholeBox(c)!);
      expect(wholeBox(c)!.checked).toBe(false);
      fireEvent.change(slider(c)!, { target: { value: "1.5" } });
      expect(w.plot).toEqual([]);
      expect(w.series).toEqual([[id, { pointSpread: 1.5 }]]);
    });

    it(`${label}: not on the Chart tab`, () => {
      const g = card(name);
      expect(slider(inspect({ ...g.plot, ...extra } as Plot, g.table, { kind: "plot" }))).toBeNull();
    });
  }

  it("the slider shows the clicked series' own spread, else the graph's", () => {
    const { g, id } = onSeries("p-bar");
    expect(Number(slider(inspect({ ...g.plot, pointSpread: 0.75 } as Plot, g.table, { kind: "series", columnId: id }))!.value)).toBe(0.75);
    cleanup();
    const own = { ...g.plot, pointSpread: 0.75, seriesStyles: { ...g.plot.seriesStyles, [id]: { ...(g.plot.seriesStyles?.[id] ?? {}), pointSpread: 2.2 } } } as Plot;
    expect(Number(slider(inspect(own, g.table, { kind: "series", columnId: id }))!.value)).toBe(2.2);
  });

  it("a column scatter with a saved boxWidth shows it as its spread, and has no Width row", () => {
    const { g, id } = onSeries("p-scatter");
    const plot = { ...g.plot, seriesStyles: { ...g.plot.seriesStyles, [id]: { ...(g.plot.seriesStyles?.[id] ?? {}), boxWidth: 0.8 } } } as Plot;
    const w: Writes = { plot: [], series: [] };
    const c = inspect(plot, g.table, { kind: "series", columnId: id }, w);
    expect(Number(slider(c)!.value)).toBe(1.6);
    const labels = [...c.querySelectorAll("label.frow > span:first-child")].map((x) => x.textContent);
    expect(labels, "the column scatter shows a Width row beside Point spread").not.toContain("Width");
    // Whole graph also clears a saved Width, which would otherwise override the graph's spread.
    fireEvent.change(slider(c)!, { target: { value: "1" } });
    expect(({ ...plot, ...w.plot[0] } as Plot).seriesStyles?.[id]?.boxWidth).toBeUndefined();
  });

  it("with the main Apply to whole graph ticked, the tick box is ticked and locked", () => {
    const { g, id } = onSeries("p-bar");
    const w: Writes = { plot: [], series: [] };
    const c = inspect(g.plot, g.table, { kind: "series", columnId: id }, w, true);
    expect(wholeBox(c)!.checked).toBe(true);
    expect(wholeBox(c)!.disabled).toBe(true);
    fireEvent.change(slider(c)!, { target: { value: "2" } });
    expect(w.plot[0]?.pointSpread).toBe(2);
  });

  for (const [label, name, extra] of [
    ["bars with Points off", "p-bar", { showBarPoints: false }],
    ["box with points off", "p-box", { showBoxPoints: false }],
    ["violin with points off", "p-violin", { showBoxPoints: false }],
    // Its rain already fills the strip beside its box: a spread could only pack it, never widen it. Its Width slider
    // widens the whole raincloud (e.g. 124 px across at Width 0.5, 198 px at 0.8).
    ["raincloud (its Width slider scales the whole raincloud)", "kind:raincloud", {}],
  ] as [string, string, Partial<Plot>][]) {
    it(`${label}: not offered — it would move nothing`, () => {
      const g = card(name);
      expect(pointsJson(sceneOf(name, extra, 2.5))).toBe(pointsJson(sceneOf(name, extra, 1)));
      const id = tableDatasets(g.table)[0]!.id;
      expect(slider(inspect({ ...g.plot, ...extra } as Plot, g.table, { kind: "series", columnId: id })), label).toBeNull();
    });
  }
});
