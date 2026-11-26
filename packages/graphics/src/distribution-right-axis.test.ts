// A second Y axis on box, violin and column scatter charts.
//
// Two quantities in different units side by side — here a weight (2–10 g) and a height
// (150–190 cm). With a single value axis a height box would squash the weight box flat at the
// bottom; `axis: "y2"` puts the height on its own right-hand axis.
//
// The right axis is the same one the bar chart draws: `planSecondAxis` sizes it before the plot
// rectangle exists, `placeSecondAxis` builds its scale and axis once it does.
//
// A horizontal chart draws its second axis along the top; raincloud and floating bar draw one on
// the right. Refused out loud, never silently: a third axis (Y3); a log Y2 over values at or
// below zero is drawn linear with a warning.
import { describe, expect, it } from "vitest";
import type { DataTable, Plot, SeriesStyle } from "@mady/core";
import type { PlotScene } from "./scene";
import { buildPlotScene, placeSecondAxis, planSecondAxis, releasePlannedHeights } from "./buildScene";

const SIZE = { width: 640, height: 460 };
const measure = (t: string, px: number): number => t.length * px * 0.6;

const tableOf = (heights: number[]): DataTable =>
  ({
    id: "t", kind: "column", name: "T",
    columns: [
      { id: "w", name: "Weight (g)", role: "y" },
      { id: "h", name: "Height (cm)", role: "y" },
    ],
    rows: [2, 4, 6, 8, 10].map((w, i) => ({ id: `r${i}`, cells: { w, h: heights[i]! } })),
  }) as unknown as DataTable;
const T = tableOf([150, 165, 172, 181, 190]);
const WEIGHT_ONLY = { ...T, columns: T.columns.filter((c) => c.id === "w") } as DataTable;

const plotOf = (kind: string, styles: Record<string, SeriesStyle> = {}, over: Partial<Plot> = {}): Plot =>
  ({ id: "p", name: "P", source: "t", kind, seriesStyles: styles, ...over }) as Plot;
const build = (p: Plot, t: DataTable = T): PlotScene => buildPlotScene(t, p, { ...SIZE, measure });

/** Every vertical pixel a series' glyph uses: box edges + whiskers, swarm dots, violin outline. */
function glyphYs(s: PlotScene, id: string): number[] {
  const se = s.series.find((x) => x.id === id);
  if (!se) throw new Error(`no series ${id}`);
  const ys: number[] = [];
  for (const m of se.marks) {
    if (m.box) ys.push(m.box.q1, m.box.q3, m.box.whiskerLow, m.box.whiskerHigh);
    for (const p of m.points ?? []) ys.push(p.cy);
    // Note: `violin` is an object with a `path` — reading it as a string would silently skip
    // every violin outline.
    const v = (m as { violin?: { path?: string } }).violin?.path;
    if (typeof v === "string") ys.push(...(v.match(/-?\d+(\.\d+)?/g) ?? []).map(Number).filter((_, i) => i % 2 === 1));
  }
  return ys;
}
const inside = (s: PlotScene, y: number): boolean => y >= s.plot.y - 1 && y <= s.plot.y + s.plot.height + 1;

describe.each(["box", "violin", "scatter"])("%s chart — a series on the right (Y2) axis", (kind) => {
  it("the fixture draws both series on one axis when nothing asks for Y2", () => {
    const s = build(plotOf(kind));
    expect(s.series.map((x) => x.id)).toEqual(["w", "h"]);
    expect(glyphYs(s, "w").length).toBeGreaterThan(0);
    expect(glyphYs(s, "h").length).toBeGreaterThan(0);
    expect(s.y2).toBeUndefined();
  });

  it("Height on Y2: the right axis fits Height, the left axis fits Weight alone, every glyph stays inside the plot", () => {
    const s = build(plotOf(kind, { h: { axis: "y2" } }));
    expect(s.y2, "no right axis was drawn").toBeDefined();
    expect(s.y2!.domain[0]).toBeLessThanOrEqual(150);
    expect(s.y2!.domain[1]).toBeGreaterThanOrEqual(190);
    // the left axis is exactly the axis of a chart with no Height series at all
    expect(s.y.domain).toEqual(build(plotOf(kind), WEIGHT_ONLY).y.domain);
    expect(s.y.domain[1]).toBeLessThan(100);
    for (const y of [...glyphYs(s, "w"), ...glyphYs(s, "h")]) expect(inside(s, y), `glyph at y=${y} outside the plot`).toBe(true);
    // and the Weight glyph spreads over the plot instead of being squashed into its bottom, as on one shared axis
    const spread = (ys: number[]) => Math.max(...ys) - Math.min(...ys);
    expect(spread(glyphYs(s, "w"))).toBeGreaterThan(spread(glyphYs(build(plotOf(kind)), "w")) * 3);
  });

  it("a log scale on Y2 is applied when every Y2 value is positive", () => {
    const s = build(plotOf(kind, { h: { axis: "y2" } }, { y2Axis: { scale: "log10" } }));
    expect(s.y2!.type).toBe("log10");
    expect(s.warnings.some((w) => /log/i.test(w))).toBe(false);
  });

  it("a log scale on Y2 over a zero value is drawn linear — and says so", () => {
    const s = build(plotOf(kind, { h: { axis: "y2" } }, { y2Axis: { scale: "log10" } }), tableOf([0, 165, 172, 181, 190]));
    expect(s.y2!.type).toBe("linear");
    expect(s.warnings.some((w) => /log/i.test(w) && /Y2|right/i.test(w))).toBe(true);
  });
});

describe("second Y axis — refused out loud where the drawing has none", () => {
  // Horizontal box / violin / column scatter draw the second axis along the top
  // (distribution-horizontal-top-axis.test.ts has the detail).
  it.each(["box", "violin", "scatter"])("horizontal %s: a top second axis, and no refusal", (kind) => {
    const s = build(plotOf(kind, { h: { axis: "y2" } }, { barOrientation: "horizontal" }));
    expect(s.y2?.side).toBe("top");
    expect(s.warnings.some((w) => /Height/.test(w) && /second value axis/i.test(w))).toBe(false);
  });

  // Raincloud and floating bar draw a right-hand second axis.
  // y2-lollipop-raincloud-floatingbar.test.tsx has the drawing checks.
  it.each(["raincloud", "floatingbar"])("%s: a right-hand second axis, and no refusal", (kind) => {
    const s = build(plotOf(kind, { h: { axis: "y2" } }));
    expect(s.y2).toBeDefined();
    expect(s.y2?.side).not.toBe("top");
    expect(s.warnings.some((w) => /Height/.test(w) && /second value axis/i.test(w))).toBe(false);
  });

  it("a third axis (Y3) on a box chart: none drawn, a warning naming the series", () => {
    const s = build(plotOf("box", { h: { axis: "y3" } }));
    expect(s.y3).toBeUndefined();
    expect(s.warnings.some((w) => /Height/.test(w) && /third/i.test(w))).toBe(true);
  });
});

describe("planSecondAxis / placeSecondAxis — the one right-hand axis of a category chart", () => {
  const RECT = { x: 60, y: 40, width: 400, height: 300 };

  it("plan: fits the values, honours a manual range, and reserves room for a title only when there is one", () => {
    const plain = planSecondAxis({}, [150, 190], "linear", 6, measure, { tick: 12, title: 14 });
    expect(plain.domain[0]).toBeLessThanOrEqual(150);
    expect(plain.domain[1]).toBeGreaterThanOrEqual(190);
    expect(plain.labelWidth).toBeGreaterThan(0);
    const manual = planSecondAxis({ min: 0, max: 400 }, [150, 190], "linear", 6, measure, { tick: 12, title: 14 });
    expect(manual.domain).toEqual([0, 400]);
    const titled = planSecondAxis({ title: "Height (cm)" }, [150, 190], "linear", 6, measure, { tick: 12, title: 14 });
    expect(titled.title).toBe("Height (cm)");
    expect(titled.margin).toBeGreaterThan(plain.margin);
    expect(planSecondAxis({}, [150, 190], "linear", 6, measure, { tick: 12, title: 14 }, "Cumulative %").title).toBe("Cumulative %");
  });

  it("place: the domain runs from the plot bottom to its top, ticks sit on the plot, the title right of the labels", () => {
    const plan = planSecondAxis({ min: 0, max: 200 }, [150, 190], "linear", 6, measure, { tick: 12, title: 14 });
    const { px, axis } = placeSecondAxis(plan, RECT, 14);
    expect(px(0)).toBeCloseTo(RECT.y + RECT.height, 6);
    expect(px(200)).toBeCloseTo(RECT.y, 6);
    expect(axis.domain).toEqual([0, 200]);
    for (const t of axis.ticks) expect(t.pos >= RECT.y - 0.5 && t.pos <= RECT.y + RECT.height + 0.5).toBe(true);
    expect(axis.titleX!).toBeGreaterThan(RECT.x + RECT.width + plan.labelWidth);
  });

  it("place: a reversed axis puts its minimum at the top", () => {
    const plan = planSecondAxis({ min: 0, max: 200, reversed: true }, [150, 190], "linear", 6, measure, { tick: 12, title: 14 });
    const { px, axis } = placeSecondAxis(plan, RECT, 14);
    expect(px(0)).toBeCloseTo(RECT.y, 6);
    expect(px(200)).toBeCloseTo(RECT.y + RECT.height, 6);
    expect(axis.domain).toEqual([200, 0]);
  });
});

// ── the Y2 axis title must show ─────────────────────────────────────────────────────────────────
describe("the right (Y2) axis is titled with its series' name when none is typed (the XY rule)", () => {
  it.each(["box", "violin", "scatter"])("%s: one series on Y2 → its name; a typed title wins", (kind) => {
    expect(build(plotOf(kind, { h: { axis: "y2" } })).y2!.title).toBe("Height (cm)");
    expect(build(plotOf(kind, { h: { axis: "y2" } }, { y2Axis: { title: "Stature" } })).y2!.title).toBe("Stature");
  });

  it("two series on Y2 → no default title (one series' name would claim to speak for both)", () => {
    const three = {
      ...T,
      columns: [...T.columns, { id: "k", name: "Knee (cm)", role: "y" }],
      rows: T.rows.map((r, i) => ({ ...r, cells: { ...r.cells, k: 40 + i } })),
    } as unknown as DataTable;
    expect(build(plotOf("box", { h: { axis: "y2" }, k: { axis: "y2" } }), three).y2!.title).toBe("");
  });
});

// ── brackets on the right axis ──────────────────────────────────────────────────────────────────
// "Add to graph" (analysis.ts) plans every bracket's height from one range pooled over every
// group — here 2…190 — so its height is in Height's units (~201). Read against the left axis, and
// folded into the left axis's range, it would stretch Weight back out to 0–210: the squash the
// second axis exists to remove, plus a bracket floating wherever that number landed.
const PLANNED = { id: "b1", kind: "bracket" as const, from: 1, to: 2, bracketY: 190 + 188 * 0.06, plannedY: true, p: 0.001, role: "significance" as const };

describe.each(["box", "violin", "scatter"])("%s chart — a planned significance bracket with a series on Y2", (kind) => {
  it("does not stretch the left axis, and sits above both groups' drawn tops, inside the plot", () => {
    const s = build(plotOf(kind, { h: { axis: "y2" } }, { annotations: [PLANNED] }));
    expect(s.y.domain[1], "the planned height stretched the left axis").toBeLessThan(100);
    const b = s.annotations.find((a) => a.id === "b1");
    expect(b?.path, "the bracket was not drawn").toBeTruthy();
    const topInk = Math.min(...glyphYs(s, "w"), ...glyphYs(s, "h"));
    expect(b!.y1!, "the bracket rail sits on or inside the data").toBeLessThan(topInk);
    expect(b!.y1!).toBeGreaterThanOrEqual(s.plot.y - 0.5);
  });

  it("with nothing on Y2, the planned height is kept exactly as planned", () => {
    const b = build(plotOf(kind, {}, { annotations: [PLANNED] })).annotations.find((a) => a.id === "b1")!;
    expect(b.plannedY).toBe(true);
    expect(b.autoY).toBeUndefined();
  });

  it("a bracket the user placed (a dragged or typed height) keeps its height with a series on Y2", () => {
    const hand = { ...PLANNED, id: "b2", plannedY: undefined, bracketY: 8 };
    const b = build(plotOf(kind, { h: { axis: "y2" } }, { annotations: [hand] })).annotations.find((a) => a.id === "b2")!;
    expect(b.path).toBeTruthy();
    expect(b.autoY).toBeUndefined();
  });
});

// Brackets need room at the top, so the scene widens both value axes by pinning their maximum.
// The left axis rounds its automatic range before applying that pin; the right axis must do the
// same, or it takes the raw lowest value as its bottom and the lowest whisker cap lands exactly on
// the axis line and disappears under it.
// Note: the fixture's lowest height is 151, not a tidy number, so a rounded bottom (150) can be
// told from a raw one (151); the comparison is against the same chart without brackets — the
// pinned top must not move the bottom at all.
// Note: the top must be a tidy number with no room above it (190, not 191): with 191 the axis
// would already round up to 200, the brackets would fit, nothing would be pinned — and the
// "fixture must widen the right axis" guard below would report that.
const HEIGHTS_FROM_151 = tableOf([151, 165, 172, 181, 190]);

describe.each(["box", "violin", "scatter"])("%s chart — the right axis keeps its rounded bottom when brackets widen it", (kind) => {
  it("with brackets pinning the top, the right axis bottom is the rounded value it has without them", () => {
    const pinned = build(plotOf(kind, { h: { axis: "y2" } }, { annotations: [PLANNED] }), HEIGHTS_FROM_151);
    const free = build(plotOf(kind, { h: { axis: "y2" } }), HEIGHTS_FROM_151);
    expect(pinned.y2!.domain[1], "the fixture must make the brackets widen the right axis").toBeGreaterThan(free.y2!.domain[1]);
    expect(pinned.y2!.domain[0], "pinning the top changed the bottom").toBe(free.y2!.domain[0]);
    expect(pinned.y2!.domain[0]).toBeLessThan(151);
    const bottom = pinned.plot.y + pinned.plot.height;
    expect(Math.max(...glyphYs(pinned, "h")), "a Y2 glyph sits on the bottom axis line").toBeLessThan(bottom - 1);
  });
});

describe("releasePlannedHeights — a planned height is dropped, a hand-set one never", () => {
  const annotations = [
    { id: "a", kind: "bracket", from: 1, to: 2, bracketY: 201, plannedY: true, p: 0.01, role: "significance" },
    { id: "b", kind: "bracket", from: 1, to: 2, bracketY: 8 },
    { id: "c", kind: "hline", value: 5 },
  ] as unknown as NonNullable<Plot["annotations"]>;

  it("removes bracketY + plannedY from planned brackets only, and leaves the input untouched", () => {
    const p = plotOf("box", {}, { annotations });
    const out = releasePlannedHeights(p);
    const byId = Object.fromEntries((out.annotations ?? []).map((a) => [a.id, a]));
    expect(byId.a!.bracketY).toBeUndefined();
    expect(byId.a!.plannedY).toBeUndefined();
    expect(byId.a!.p).toBe(0.01);
    expect(byId.a!.role).toBe("significance");
    expect(byId.b!.bracketY).toBe(8);
    expect(byId.c).toEqual(annotations[2]);
    expect(p.annotations![0]!.bracketY).toBe(201);
  });

  it("returns the very same plot when nothing is planned", () => {
    const p = plotOf("box", {}, { annotations: [annotations[1]!, annotations[2]!] });
    expect(releasePlannedHeights(p)).toBe(p);
  });
});
