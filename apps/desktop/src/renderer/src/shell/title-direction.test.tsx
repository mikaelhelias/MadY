// @vitest-environment jsdom
/**
 * Axis tab ▸ Title direction, on every chart type:
 * a vertical axis's title written level, at 45° / 135° / 180°, or level above the axis.
 *
 * For every gallery chart that draws a Y title, and every direction, this reads the drawing — the title
 * element the renderer emitted — and works out its glyph box itself (0.6 em per character, 1.08 em above the
 * baseline, 0.27 em below, 1.2 em per extra line, turned by the element's own rotate()):
 *   1. the title is drawn at the angle asked for (or the chart said why not — never silently);
 *   2. its glyphs stay on the figure;
 *   3. they miss the plot area and the Y tick numbers.
 * Then the same for the right-hand axes (Y2, Y3), whose room comes from the builders' right margin.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { buildPlotScene, type PlotScene } from "@mady/graphics";
import { dataAxisOf, isTransposedPlot, tableDatasets, type AxisSpec, type Plot } from "@mady/core";
import { PlotFigure, titleGripAngle, titleGripPoint } from "./PlotFigure";
import { galleryItems } from "./gallery";
import { rotateAxisTitle } from "./AppShell";

afterEach(cleanup);

const SIZE = { width: 580, height: 380 };
const TITLE = "Response (units)";
type Box = { x1: number; y1: number; x2: number; y2: number };

const MODES: Array<{ name: string; patch: Partial<AxisSpec>; angle: number }> = [
  { name: "level", patch: { titleAngle: 0 }, angle: 0 },
  { name: "45°", patch: { titleAngle: 45 }, angle: 45 },
  { name: "135°", patch: { titleAngle: 135 }, angle: 135 },
  { name: "180°", patch: { titleAngle: 180 }, angle: 180 },
  { name: "level above the axis", patch: { titleAngle: 0, titleAbove: true }, angle: 0 },
];

const linesOf = (t: Element): string[] => {
  const spans = [...t.querySelectorAll(":scope > tspan")];
  return spans.length > 1 ? spans.map((s) => s.textContent ?? "") : [t.textContent ?? ""];
};

/** The rendered title element and its glyph box, from its own attributes. */
function titleBox(container: HTMLElement, text: string, size: number): { box: Box; svgAngle: number; lines: number; el: Element } | null {
  const el = [...container.querySelectorAll("svg.gfx-figure text")].find((t) => linesOf(t).join(" ") === text);
  if (!el) return null;
  return { ...elBox(el, size), el };
}

/** The font size a text element is drawn at (its own attribute or its nearest group's). */
function fontSizeOf(el: Element): number | null {
  for (let e: Element | null = el; e && e.tagName.toLowerCase() !== "svg"; e = e.parentElement) {
    const fs = e.getAttribute("font-size") ?? (e as HTMLElement).style?.fontSize;
    if (fs) return Number.parseFloat(fs);
  }
  return null;
}

/**
 * Every other piece of text on the figure, as a glyph box — the same model. Only text whose groups add at most
 * a translate is measured (a transformed group would need its matrix); editing chrome is skipped.
 */
function otherTextBoxes(container: HTMLElement, self: Element): Array<{ text: string; box: Box }> {
  const out: Array<{ text: string; box: Box }> = [];
  for (const el of container.querySelectorAll("svg.gfx-figure text")) {
    if (el === self || el.closest(".gfx-annhandle, .gfx-tooltip, .gfx-draghit, [data-title-grip]")) continue;
    const text = linesOf(el).join(" ").trim();
    const size = fontSizeOf(el);
    if (!text || !size || el.getAttribute("opacity") === "0") continue;
    let dx = 0;
    let dy = 0;
    let plain = true;
    for (let g = el.parentElement; g && g.tagName.toLowerCase() !== "svg"; g = g.parentElement) {
      const tf = g.getAttribute("transform");
      if (!tf) continue;
      const m = /^translate\(([-\d.]+)[ ,]+([-\d.]+)\)$/.exec(tf.trim());
      if (!m) { plain = false; break; }
      dx += Number(m[1]);
      dy += Number(m[2]);
    }
    if (!plain) continue;
    const b = elBox(el, size).box;
    out.push({ text, box: { x1: b.x1 + dx, x2: b.x2 + dx, y1: b.y1 + dy, y2: b.y2 + dy } });
  }
  return out;
}

/** A text element's glyph box from its own attributes (x/y, anchor, baseline, translate + rotate). */
function elBox(el: Element, size: number): { box: Box; svgAngle: number; lines: number } {
  const spans = [...el.querySelectorAll(":scope > tspan")];
  const lines = spans.length > 1 ? spans.map((s) => s.textContent ?? "") : [el.textContent ?? ""];
  const tf = el.getAttribute("transform") ?? "";
  const mid = /middle|central/.test(el.getAttribute("dominant-baseline") ?? "");
  // Two shapes: `translate(x y) rotate(a)` (main figure) or x/y attributes + `translate(dx dy) rotate(a x y)`.
  let ax: number;
  let ay: number;
  const tr = /translate\(([-\d.]+)[ ,]+([-\d.]+)\)/.exec(tf);
  const rot = /rotate\(([-\d.]+)/.exec(tf);
  if (el.hasAttribute("x")) {
    ax = Number(el.getAttribute("x")) + (tr ? Number(tr[1]) : 0);
    ay = Number(el.getAttribute("y")) + (tr ? Number(tr[2]) : 0) + (mid ? 0.35 * size : 0);
  } else {
    ax = Number(tr?.[1] ?? 0);
    ay = Number(tr?.[2] ?? 0);
  }
  const svgAngle = rot ? Number(rot[1]) : 0;
  const len = Math.max(...lines.map((l) => l.length * size * 0.6));
  const anchor = el.getAttribute("text-anchor") ?? "start";
  const lx1 = anchor === "middle" ? -len / 2 : anchor === "end" ? -len : 0;
  const corners: Array<[number, number]> = [
    [lx1, -1.08 * size],
    [lx1 + len, -1.08 * size],
    [lx1, 0.27 * size + (lines.length - 1) * 1.2 * size],
    [lx1 + len, 0.27 * size + (lines.length - 1) * 1.2 * size],
  ];
  const r = (svgAngle * Math.PI) / 180;
  const pts = corners.map(([x, y]) => [ax + x * Math.cos(r) - y * Math.sin(r), ay + x * Math.sin(r) + y * Math.cos(r)] as const);
  return {
    box: { x1: Math.min(...pts.map((p) => p[0])), x2: Math.max(...pts.map((p) => p[0])), y1: Math.min(...pts.map((p) => p[1])), y2: Math.max(...pts.map((p) => p[1])) },
    svgAngle,
    lines: lines.length,
  };
}

const overlap = (a: Box, b: Box, slack = 0.5): boolean => a.x1 < b.x2 - slack && b.x1 < a.x2 - slack && a.y1 < b.y2 - slack && b.y1 < a.y2 - slack;
const fmt = (b: Box): string => `[${b.x1.toFixed(1)}, ${b.y1.toFixed(1)} → ${b.x2.toFixed(1)}, ${b.y2.toFixed(1)}]`;

/** Boxes of the flat left tick numbers (the renderer's own 0.6 em width model). */
function leftTickBoxes(scene: PlotScene): Box[] {
  if (scene.y.tickRotation) return [];
  const size = scene.fonts.yTick.size;
  const gap = scene.axisGaps?.yTick ?? 8;
  return scene.y.ticks
    .filter((t) => !t.minor && t.label !== "")
    .map((t) => ({ x1: scene.plot.x - gap - t.label.length * size * 0.6, x2: scene.plot.x - gap, y1: t.pos - size * 0.6, y2: t.pos + size * 0.4 }));
}

/** Same angle, SVG's clockwise rotate() vs our anticlockwise degrees. */
const sameTurn = (svgAngle: number, angle: number): boolean => (((svgAngle + angle) % 360) + 360) % 360 === 0;

const seen = new Set<string>();
const cards = galleryItems().filter((g) => {
  const k = (g.plot.kind ?? "xy") + (isTransposedPlot(g.plot) ? " (flipped)" : "");
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
}).map((g) => ({ ...g, label: (g.plot.kind ?? "xy") + (isTransposedPlot(g.plot) ? " (flipped)" : "") }));

function withTitle(plot: Plot, patch: Partial<AxisSpec>): Plot {
  const key = `${dataAxisOf(plot, "y")}Axis` as "xAxis" | "yAxis";
  return { ...plot, [key]: { ...(plot[key] ?? {}), title: TITLE, ...patch } } as Plot;
}

/**
 * What a chart cannot do at the gallery size (580 × 380), each with a warning. The tracks chart gives most of
 * its width to track names and caps its side margins at 80 % of the figure, so a title beside the axis finds
 * no room: a level one goes above the axis instead, any other angle stays turned.
 */
const REFUSED: Record<string, Record<string, "above" | "turned">> = {
  tracks: { level: "above", "45°": "turned", "135°": "turned", "180°": "turned" },
};

const drawn = cards.filter((g) => buildPlotScene(g.table, withTitle(g.plot, {}), SIZE).y.title === TITLE);

describe("Title direction — the left Y title, on every chart type", () => {
  it("the loop reaches the chart types that draw a Y title (it cannot pass by checking nothing)", () => {
    expect(drawn.length).toBeGreaterThanOrEqual(35);
  });

  it("an untouched chart keeps its turned title exactly (no placement is added)", () => {
    for (const g of drawn) {
      const scene = buildPlotScene(g.table, withTitle(g.plot, {}), SIZE);
      expect(scene.y.titleTurn, g.label).toBeUndefined();
      const again = buildPlotScene(g.table, withTitle(g.plot, { titleAngle: 90 }), SIZE);
      expect(JSON.stringify(again), `${g.label}: 90° is the default and must build the same drawing`).toBe(JSON.stringify(scene));
    }
  });

  for (const g of drawn) {
    for (const m of MODES) {
      it(`${g.label} — ${m.name}: drawn at that angle, on the figure, clear of the plot and the numbers`, () => {
        const scene = buildPlotScene(g.table, withTitle(g.plot, m.patch), SIZE);
        const said = scene.warnings.filter((w) => /Y-axis title/.test(w));
        const refusal = REFUSED[g.label]?.[m.name];
        if (refusal === "turned") {
          // Known, and warned about: this chart caps its margins, so the room cannot be made at this size.
          expect(scene.y.titleTurn, `${g.label}: expected the title drawn turned`).toBeUndefined();
          expect(said.some((w) => /could not make room/.test(w)), `${g.label}: a refusal must be said`).toBe(true);
          return;
        }
        const movedAbove = refusal === "above";
        expect(said, `${g.label}: unexpected message`).toEqual(movedAbove ? [expect.stringMatching(/written above the axis/)] : []);
        expect(scene.y.titleTurn?.angle, `${g.label}: no placement for the turned title`).toBe(m.angle);
        const { container } = render(<PlotFigure scene={scene} />);
        const size = scene.y.titleFont ?? scene.fonts.yAxisTitle.size;
        const t = titleBox(container, TITLE, size);
        expect(t, `${g.label}: the title is not in the drawing`).not.toBeNull();
        expect(sameTurn(t!.svgAngle, m.angle), `${g.label}: drawn at rotate(${t!.svgAngle}), asked ${m.angle}°`).toBe(true);
        const b = t!.box;
        expect(b.x1, `${g.label}: title ${fmt(b)} leaves the figure on the left`).toBeGreaterThanOrEqual(-1);
        expect(b.x2, `${g.label}: title ${fmt(b)} leaves the figure on the right (${scene.width})`).toBeLessThanOrEqual(scene.width + 1);
        expect(b.y1, `${g.label}: title ${fmt(b)} leaves the top`).toBeGreaterThanOrEqual(-1);
        expect(b.y2, `${g.label}: title ${fmt(b)} leaves the bottom (${scene.height})`).toBeLessThanOrEqual(scene.height + 1);
        const p = scene.plot;
        const plotBox = { x1: p.x, y1: p.y, x2: p.x + p.width, y2: p.y + p.height };
        expect(overlap(b, plotBox), `${g.label}: title ${fmt(b)} lies on the plot ${fmt(plotBox)}`).toBe(false);
        for (const tb of leftTickBoxes(scene)) {
          expect(overlap(b, tb), `${g.label}: title ${fmt(b)} lies on a tick number ${fmt(tb)}`).toBe(false);
        }
        if (m.patch.titleAbove || movedAbove) expect(b.y2, `${g.label}: an above title must sit above the plot`).toBeLessThanOrEqual(p.y);
        // …and on no other words of the figure: the chart title, category or column names, a legend, a top axis.
        for (const o of otherTextBoxes(container, t!.el)) {
          expect(overlap(b, o.box, 1), `${g.label}: title ${fmt(b)} lies on "${o.text}" ${fmt(o.box)}`).toBe(false);
        }
      });
    }
  }
});

describe("Title direction — refusals come with a warning", () => {
  const xy = drawn.find((g) => g.label === "xy")!;
  it("above the axis at an angle other than level: stays beside, with a warning", () => {
    const scene = buildPlotScene(xy.table, withTitle(xy.plot, { titleAngle: 45, titleAbove: true }), SIZE);
    expect(scene.y.titleTurn?.angle).toBe(45);
    expect(scene.warnings.some((w) => /above its axis only when it is level/.test(w))).toBe(true);
  });
  it("a title too long to write beside the axis: drawn turned, with a warning", () => {
    const long = { title: "Normalised_fluorescence_intensity_per_cell_after_72_h_treatment", titleAngle: 0 };
    const scene = buildPlotScene(xy.table, { ...xy.plot, yAxis: { ...(xy.plot.yAxis ?? {}), ...long } }, SIZE);
    expect(scene.y.titleTurn).toBeUndefined();
    expect(scene.warnings.some((w) => /too long to write at 0°/.test(w))).toBe(true);
  });
  it("a direction saved on an axis drawn across the figure is reported", () => {
    const scene = buildPlotScene(xy.table, { ...xy.plot, xAxis: { ...(xy.plot.xAxis ?? {}), titleAngle: 0 } }, SIZE);
    expect(scene.warnings.some((w) => /X-axis title runs along its axis/.test(w))).toBe(true);
  });
});

describe("Title direction — the right-hand axes (Y2, Y3)", () => {
  /** A chart with series moved onto Y2 (and Y3 where the kind has one). */
  const rightCards = (["xy", "bar", "box", "lollipop"] as const).flatMap((kind) => {
    const g = cards.find((c) => c.label === kind);
    if (!g) return [];
    const ds = tableDatasets(g.table);
    if (ds.length < 2) return [];
    // The gallery lollipop is horizontal (its second axis runs along the top); its vertical form has a right one.
    const base = kind === "lollipop" ? ({ ...g.plot, barOrientation: "vertical" } as Plot) : g.plot;
    const styles = { ...(base.seriesStyles ?? {}) };
    styles[ds[1]!.id] = { ...(styles[ds[1]!.id] ?? {}), axis: "y2" };
    if (kind === "xy" && ds[2]) styles[ds[2].id] = { ...(styles[ds[2].id] ?? {}), axis: "y3" };
    return [{ ...g, plot: { ...base, seriesStyles: styles } as Plot }];
  });

  it("the fixtures draw a right axis at all", () => {
    expect(rightCards.length).toBeGreaterThanOrEqual(3);
    for (const g of rightCards) expect(buildPlotScene(g.table, g.plot, SIZE).y2, g.label).toBeDefined();
  });

  for (const g of rightCards) {
    for (const m of [{ name: "level", angle: 0 }, { name: "45°", angle: 45 }, { name: "90°", angle: 90 }]) {
      it(`${g.label} — Y2 ${m.name}: beside its numbers, clear of what stacks to its right, on the figure`, () => {
        const plot = { ...g.plot, y2Axis: { ...(g.plot.y2Axis ?? {}), title: "Second axis (units)", titleAngle: m.angle }, y3Axis: { ...(g.plot.y3Axis ?? {}), title: "Third (units)", titleAngle: m.angle } } as Plot;
        const scene = buildPlotScene(g.table, plot, SIZE);
        expect(scene.warnings.filter((w) => /Y[23]-axis title/.test(w))).toEqual([]);
        expect(scene.y2!.titleTurn?.angle).toBe(m.angle);
        const { container } = render(<PlotFigure scene={scene} />);
        const size = (scene.fonts.y2AxisTitle ?? scene.fonts.yAxisTitle).size;
        const t = titleBox(container, "Second axis (units)", size)!;
        expect(t, "Y2 title not drawn").not.toBeNull();
        expect(sameTurn(t.svgAngle, m.angle)).toBe(true);
        const p = scene.plot;
        const tickSize = scene.fonts.y2Tick.size;
        const gap = scene.axisGaps?.yTick ?? 8;
        const y2Labels = scene.y2!.ticks.filter((k) => !k.minor && k.label !== "");
        const widest = Math.max(0, ...y2Labels.map((k) => k.label.length * tickSize * 0.6));
        const labelsEnd = p.x + p.width + (scene.axisStyle.tickLen ?? 5) + gap + widest;
        expect(t.box.x1, `Y2 title ${fmt(t.box)} runs into its numbers (end ${labelsEnd.toFixed(1)})`).toBeGreaterThanOrEqual(labelsEnd - 6);
        expect(t.box.x2, `Y2 title ${fmt(t.box)} leaves the figure (${scene.width})`).toBeLessThanOrEqual(scene.width + 1);
        if (scene.y3) {
          const y3Start = scene.y3.axisX!;
          expect(t.box.x2, `Y2 title ${fmt(t.box)} runs into the Y3 axis at ${y3Start}`).toBeLessThanOrEqual(y3Start + 0.5);
          const t3 = titleBox(container, "Third (units)", (scene.fonts.y3AxisTitle ?? scene.fonts.yAxisTitle).size)!;
          expect(t3.box.x2, `Y3 title ${fmt(t3.box)} leaves the figure`).toBeLessThanOrEqual(scene.width + 1);
        }
        const L = scene.legendLayout;
        if (L.position === "right" && scene.legend.length > 0) {
          const legendLeft = p.x + p.width + L.gap + (L.outsidePad ?? 0);
          expect(t.box.x2, `Y2 title ${fmt(t.box)} runs into the legend at ${legendLeft}`).toBeLessThanOrEqual(legendLeft + 0.5);
        }
      });
    }
  }
});

describe("Title direction — the grip on the graph", () => {
  it("snaps to 0, 45, 90, 135 and 180 within 5°, and Shift releases it", () => {
    const at = (deg: number, free = false): number => {
      const r = (deg * Math.PI) / 180;
      return titleGripAngle(100, 100, 100 + 50 * Math.cos(r), 100 - 50 * Math.sin(r), free);
    };
    expect(at(3)).toBe(0);
    expect(at(48)).toBe(45);
    expect(at(87)).toBe(90);
    expect(at(131)).toBe(135);
    expect(at(176)).toBe(180);
    expect(at(62)).toBe(62);
    expect(at(48, true)).toBe(48);
  });

  it("shows only while that axis is selected", () => {
    const g = drawn.find((c) => c.label === "xy")!;
    const scene = buildPlotScene(g.table, withTitle(g.plot, {}), SIZE);
    const noSel = render(<PlotFigure scene={scene} onRotateAxisTitle={() => {}} />);
    expect(noSel.container.querySelector("[data-title-grip]")).toBeNull();
    cleanup();
    const sel = render(<PlotFigure scene={scene} selected={{ kind: "axis", axis: "y" }} onRotateAxisTitle={() => {}} />);
    expect(sel.container.querySelector("[data-title-grip]")).not.toBeNull();
    cleanup();
    const x = render(<PlotFigure scene={scene} selected={{ kind: "axis", axis: "x" }} onRotateAxisTitle={() => {}} />);
    expect(x.container.querySelector("[data-title-grip]")).toBeNull();
  });

  it("each bespoke figure (heatmap, lollipop, paired dot) shows it too", () => {
    for (const kind of ["heatmap", "lollipop", "paireddot"]) {
      const g = drawn.find((c) => c.label === kind);
      expect(g, kind).toBeDefined();
      const scene = buildPlotScene(g!.table, withTitle(g!.plot, {}), SIZE);
      const r = render(<PlotFigure scene={scene} selected={{ kind: "axis", axis: "y" }} onRotateAxisTitle={() => {}} />);
      expect(r.container.querySelector("[data-title-grip]"), kind).not.toBeNull();
      cleanup();
    }
  });
});

describe("Title direction — what the grip stores", () => {
  const stored = (plot: Plot, axis: "y" | "y2" | "y3", angle: number): Plot => {
    let out: Plot | undefined;
    const d = {
      setPlotAxis: (_id: string, which: "x" | "y" | "y2" | "y3", patch: Partial<AxisSpec>) => {
        const key = `${which}Axis` as "xAxis" | "yAxis" | "y2Axis" | "y3Axis";
        const merged: Record<string, unknown> = { ...(plot[key] ?? {}) };
        for (const [k, v] of Object.entries(patch)) if (v === undefined) delete merged[k]; else merged[k] = v;
        out = { ...plot, [key]: merged } as Plot;
      },
    };
    rotateAxisTitle(d as never, plot, axis, angle);
    return out!;
  };
  const base = { id: "p1", kind: "xy", yAxis: { titleAngle: 0, titleAbove: true } } as unknown as Plot;
  it("the default turn is stored as no choice, and 'above' is let go once not level", () => {
    expect(stored(base, "y", 90).yAxis).toEqual({});
    expect(stored(base, "y", 45).yAxis).toEqual({ titleAngle: 45 });
    expect(stored(base, "y", 360).yAxis).toEqual({ titleAngle: 0, titleAbove: true });
    expect(stored({ id: "p1", kind: "xy" } as unknown as Plot, "y2", 270).y2Axis).toEqual({});
  });
  it("a flipped chart's visual Y title belongs to the category (x) spec", () => {
    const flipped = { id: "p1", kind: "bar", barOrientation: "horizontal" } as unknown as Plot;
    expect(stored(flipped, "y", 0).xAxis).toEqual({ titleAngle: 0 });
  });
});

describe("Title direction — a level title above the axis clears what else sits over the plot", () => {
  const check = (label: string, plot: Plot, table: Parameters<typeof buildPlotScene>[0]) => {
    const scene = buildPlotScene(table, plot, SIZE);
    expect(scene.warnings.filter((w) => /Y-axis title/.test(w)), label).toEqual([]);
    expect(scene.y.titleTurn?.anchor, `${label}: not placed above`).toBe("start");
    const { container } = render(<PlotFigure scene={scene} />);
    const t = titleBox(container, TITLE, scene.y.titleFont ?? scene.fonts.yAxisTitle.size)!;
    expect(t, label).not.toBeNull();
    expect(t.box.y2, `${label}: above the plot`).toBeLessThanOrEqual(scene.plot.y);
    const others = otherTextBoxes(container, t.el);
    expect(others.length, `${label}: the check found no other text to compare with`).toBeGreaterThan(3);
    for (const o of others) expect(overlap(t.box, o.box, 1), `${label}: title ${fmt(t.box)} lies on "${o.text}" ${fmt(o.box)}`).toBe(false);
  };

  it("a horizontal bar chart with its second axis along the top", () => {
    const bar = cards.find((c) => c.label === "bar (flipped)")!;
    const ds = tableDatasets(bar.table);
    const plot = withTitle({ ...bar.plot, seriesStyles: { ...(bar.plot.seriesStyles ?? {}), [ds[0]!.id]: { axis: "y2" } }, y2Axis: { title: "Second axis (units)" } } as Plot, { titleAngle: 0, titleAbove: true });
    expect(buildPlotScene(bar.table, plot, SIZE).y2?.side).toBe("top");
    check("bar (flipped) + X2", plot, bar.table);
  });

  it("an outside-top legend", () => {
    const xy = cards.find((c) => c.label === "xy")!;
    const plot = withTitle({ ...xy.plot, legend: { ...(xy.plot.legend ?? {}), position: "top" } } as Plot, { titleAngle: 0, titleAbove: true });
    expect(buildPlotScene(xy.table, plot, SIZE).legendLayout.position).toBe("top");
    check("xy + top legend", plot, xy.table);
  });
});

describe("Title direction — the grip stays where it can be grabbed", () => {
  it("is shortened to stay inside the figure, along the angle", () => {
    const b = { width: 580, height: 380 };
    // A left title near the edge turned to 180°: the full reach would put the grip at x = -50.
    const p = titleGripPoint(40, 200, 180, 90, b);
    expect(p.x).toBeGreaterThanOrEqual(7 - 1e-9);
    expect(p.y).toBeCloseTo(200);
    const q = titleGripPoint(40, 200, 135, 90, b);
    expect(q.x).toBeGreaterThanOrEqual(7 - 1e-9);
    expect((200 - q.y) / (40 - q.x)).toBeCloseTo(1); // still on the 135° line
    // Room enough: the full reach.
    expect(titleGripPoint(300, 200, 0, 90, b)).toEqual({ x: 390, y: 200 });
    // Never shorter than 10 px.
    expect(titleGripPoint(3, 200, 180, 90, b).x).toBeCloseTo(-7);
  });

  // One test per chart type: all of them in one test would draw about 190 figures, too many for one test's 5 s limit.
  for (const g of drawn) {
    it(`${g.label}: the grip is drawn inside the figure, at every direction`, () => {
      for (const m of MODES) {
        const scene = buildPlotScene(g.table, withTitle(g.plot, m.patch), SIZE);
        const r = render(<PlotFigure scene={scene} selected={{ kind: "axis", axis: "y" }} onRotateAxisTitle={() => {}} />);
        const c = r.container.querySelector("[data-title-grip] circle");
        expect(c, `${g.label} ${m.name}: no grip`).not.toBeNull();
        const x = Number(c!.getAttribute("cx"));
        const y = Number(c!.getAttribute("cy"));
        expect(x >= 5 && x <= scene.width - 5 && y >= 5 && y <= scene.height - 5, `${g.label} ${m.name}: grip at (${x.toFixed(1)}, ${y.toFixed(1)}) is off the ${scene.width}×${scene.height} figure`).toBe(true);
        cleanup();
      }
    });
  }
});
