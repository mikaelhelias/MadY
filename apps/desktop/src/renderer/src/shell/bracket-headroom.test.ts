// @vitest-environment node
// A graph makes room for its own significance brackets.
//
// The builder makes the space for those brackets itself, without spoiling the design, rather
// than warning the user to raise the axis maximum by hand.
//
// `significanceHeadroom()` reserves room in the box/violin/scatter/raincloud builder; for every
// other chart `buildPlotScene` measures the shortfall in pixels and widens the value axis until
// the stack fits, instead of pushing the stack into the data, clamping it at the frame and warning.
//
// This is a default-deny gate. A kind that needs a bigger figure must be listed in
// `LARGER_FIGURE` with a reason, so a new chart type cannot quietly join them.
import { describe, expect, it } from "vitest";
import { tableDatasets } from "@mady/core";
import type { Annotation, Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { galleryItems } from "./gallery";

const SIZE = { width: 620, height: 420 };

/** Kinds whose Inspector does not offer the Significance brackets section. */
const NO_SECTION = new Set([
  "heatmap", "network", "corrmatrix", "alluvial", "radar", "parallel", "pie", "treemap", "scatter3d", "ridgeline",
  // No groups to compare, so no section (see `BRACKET_KINDS`).
  "xy", "area", "blandaltman", "pcascore", "pcaload", "pcabiplot", "bubble", "volcano", "survival", "roc",
  // Funnel: same continuous-family rule — and its SE axis is inverted,
  // so "headroom above the data" would mean negative standard errors. Data-x brackets still
  // place programmatically (the family convention); the section just isn't offered.
  "funnel",
  // Swimmer: brackets refused entirely — subject timelines are not group comparisons
  // — asking it to fit a stack measures nothing.
  "swimmer",
  // Tracks: brackets refused entirely — its bands are whole tracks, not groups.
  "tracks",
]);

/**
 * These kinds need a bigger figure, and that is measured rather than asserted: every one
 * of them fits a two-bracket stack at 900×620 with no warning.
 *
 *   dendrogram — its data reaches the top of the panel, so the stack needs more than the third of
 *     the height `widenForBrackets` is allowed to take (that cap exists to stop the data being
 *     flattened to a stripe)
 *   paireddot — the plot's width: 12 long category labels ("Cannabis use disorder") leave 178px
 *     against lollipop's 424, and the axis is already widened 0→1.62 over the four passes
 *
 * So instead of skipping them, `LARGER_FIGURE` gets its own test at 900×620, where a failure is
 * a real defect rather than the known size limit. At the default 620×420 they warn, and that
 * warning names the true reason and a usable next step.
 *
 * Note: paireddot is exercised only because `withBrackets` uses the real endpoint convention;
 * with tick values every bracket on it would be dropped and the test would hit its own
 * `placed === 0` escape.
 *
 * ridgeline is not here — its Inspector section is hidden, so it
 * belongs in NO_SECTION and asking it to fit a bracket stack measures nothing. `pcaload`,
 * `survival` and `roc` are in NO_SECTION for the same reason: they are not offered the section
 * at all. Only kinds that carry brackets belong here.
 */
const LARGER_FIGURE = new Set(["dendrogram", "paireddot"]);
const BIG = { width: 900, height: 620 };

const SAYS_NO_ROOM = "could not be placed clear";

/**
 * n brackets spanning this kind's category axis — the axis the placer treats as such.
 *
 * The endpoint convention is not the tick value. A bracket's `from`/`to` are **1-based category
 * indices** on a categorical axis — the composer writes `{from:1,to:2}` — and a data value on a
 * continuous one. Band tick values happen to be 1-based on bar/box/violin, so the two coincide
 * there; they are 0-based on lollipop, paired-dot and dendrogram, where `from: 0` is rejected
 * outright ("not a category"), so feeding tick values would drop every bracket and the guard
 * would hit its own `placed === 0` escape and report nothing.
 */
function withBrackets(plot: Plot, table: Parameters<typeof buildPlotScene>[0], n: number, size = SIZE): Plot | null {
  const base = buildPlotScene(table, plot, size);
  const cat = base.valueAxis === "x" ? base.y : base.x;
  const ticks = cat.ticks.filter((t) => !t.minor);
  const categorical = ticks.length > 0 && ticks.every((t) => t.label !== "" && Number.isNaN(Number(t.label)));
  const v = categorical ? ticks.map((_t, i) => i + 1) : ticks.map((t) => t.value);
  if (v.length < n + 1) return null;
  const anns: Annotation[] = [];
  for (let i = 0; i < n; i += 1) {
    anns.push({ id: `sig-${i}`, kind: "bracket", from: v[0]!, to: v[i + 1]!, p: 0.01 / (i + 1), label: "*", role: "significance" });
  }
  return { ...plot, annotations: [...(plot.annotations ?? []), ...anns] } as Plot;
}

/**
 * Cards (not kinds) that are no bracket fixture, each with the reason. "Ranked dots vs a
 * reference" is 25 ranked names drawn as dots on a horizontal bar chart: a bracket
 * stack across a ranked list is not a comparison anyone draws, and at 360×250 there is genuinely
 * no room across 25 rows — the builder reports that accurately, which is the behaviour this test
 * keeps. The bar kind stays fully covered by its other five cards.
 */
const NO_BRACKET_CARD = new Set(["rankeddots"]);

describe("significance brackets get the room they need", () => {
  for (const item of galleryItems()) {
    const kind = item.plot.kind ?? "xy";
    if (NO_SECTION.has(kind) || NO_BRACKET_CARD.has(item.key)) continue;
    // The kinds that need the room of a bigger figure are checked at that size instead.
    const size = LARGER_FIGURE.has(kind) ? BIG : SIZE;
    const where = LARGER_FIGURE.has(kind) ? ` (at ${BIG.width}×${BIG.height} — see LARGER_FIGURE)` : "";
    it(`${kind}: a two-bracket stack fits without asking the user for room${where}`, () => {
      const p = withBrackets(item.plot as Plot, item.table, 2, size);
      if (!p) return; // fewer than three categories — nothing to compare
      const scene = buildPlotScene(item.table, p, size);
      const placed = scene.annotations.filter((a) => String(a.id).startsWith("sig-")).length;
      // Not an escape hatch. A kind that places no bracket is a defect in its own
      // right (it can hide a 1px bracket stub), so say so rather than passing quietly.
      expect(placed, `${kind}: asked for 2 brackets and the builder placed ${placed}`).toBeGreaterThan(0);
      expect(
        (scene.warnings ?? []).filter((w) => String(w).includes(SAYS_NO_ROOM)),
        `${kind}: the graph told the user to make room instead of making it`,
      ).toEqual([]);
    });
  }

  /**
   * And the default size still warns for those — the point being that the message is
   * accurate and actionable, not that the situation is fine. If a kind stops warning here it has
   * been fixed and belongs out of `LARGER_FIGURE` entirely.
   */
  for (const kind of LARGER_FIGURE) {
    it(`${kind}: at the default figure size it says so, and says why`, () => {
      const item = galleryItems().find((g) => (g.plot.kind ?? "xy") === kind);
      if (!item) throw new Error(`${kind} has no gallery fixture`);
      const p = withBrackets(item.plot as Plot, item.table, 2);
      if (!p) throw new Error(`${kind}: the fixture lost its categories`);
      const scene = buildPlotScene(item.table, p, SIZE);
      const said = (scene.warnings ?? []).filter((w) => String(w).includes(SAYS_NO_ROOM));
      expect(said.length, `${kind}: it no longer needs a bigger figure — take it out of LARGER_FIGURE`).toBeGreaterThan(0);
      // Nothing is pinned on these fixtures, so the sentence must not blame a pinned axis.
      expect(String(said[0]), `${kind}: blamed a pinned axis when nothing is pinned`).not.toContain("pinned");
      expect(String(said[0]), `${kind}: gave the user no way forward`).toContain("larger");
    });
  }

  /**
   * Every kind that draws data-point discs clears them the same way: every graph type
   * with data points has the same bracket clearance. An auto
   * bracket's rail must sit ≥ GAP_DATA (18px) beyond every disc's edge under its span — the
   * disc, not its centre: measured from centres, a house-sized dot (r 14) would eat 14 of the 18.
   *
   * Discs are collected from every source a kind draws them from: bare series marks and the
   * points overlays (bar swarms, column scatter, raincloud, estimation, beforeafter, scree,
   * forest), box/violin with "show all points" on (the card default is off, so this test
   * turns it on), and the two kinds whose dots live outside `scene.series` — lollipop heads
   * and paired-dot markers — which the placer must also see.
   *
   * MUST_FIND_DISCS lists the kinds that must yield discs: one that yields none fails the
   * test rather than passing an empty loop.
   */
  const MUST_FIND_DISCS = new Set([
    "bar", "scatter", "raincloud", "estimation", "scree", "beforeafter", "box", "violin",
    "forest", "lollipop", "paireddot",
  ]);
  const GAP_DATA = 18;
  const seenDiscKinds = new Set<string>();
  const discKinds: string[] = [];
  for (const item of galleryItems()) {
    const kind = item.plot.kind ?? "xy";
    if (NO_SECTION.has(kind)) continue;
    if (discKinds.includes(kind)) continue;
    discKinds.push(kind);
    const size = LARGER_FIGURE.has(kind) ? BIG : SIZE;
    it(`${kind}: an auto bracket rail clears every drawn disc's edge by ${GAP_DATA}px`, () => {
      // Box/violin only draw their points overlay when asked — ask, so the test sees it.
      // Lollipop/paired-dot: inflate the dots (the r=14 house treatment, and then some) —
      // at the card's default size their discs happen to sit clear of the fallback rail,
      // and a fixture that cannot exhibit the blindness cannot guard against it.
      const plot0 = {
        ...(item.plot as Plot),
        ...(kind === "box" || kind === "violin" ? { showBoxPoints: true } : {}),
        ...(kind === "lollipop" ? { lollipop: { ...(item.plot as Plot).lollipop, dotSize: 30 } } : {}),
        ...(kind === "paireddot" ? { paireddot: { ...(item.plot as Plot).paireddot, dotSize: 30 } } : {}),
      } as Plot;
      const p = withBrackets(plot0, item.table, 1, size);
      if (!p) return; // fewer than two categories — nothing to span
      const s = buildPlotScene(item.table, p, size);
      const br = s.annotations.find((a) => String(a.id).startsWith("sig-"));
      expect(br?.path, `${kind}: the bracket was not placed`).toBeTruthy();
      const onX = s.valueAxis === "x";
      const sign = onX ? 1 : -1;
      const val = (x: number, y: number): number => (onX ? x : y);
      const cat = (x: number, y: number): number => (onX ? y : x);
      const c1 = Math.min(cat(br!.x1 ?? 0, br!.y1 ?? 0), cat(br!.x2 ?? 0, br!.y2 ?? 0));
      const c2 = Math.max(cat(br!.x1 ?? 0, br!.y1 ?? 0), cat(br!.x2 ?? 0, br!.y2 ?? 0));
      const rail = val(br!.x1 ?? 0, br!.y1 ?? 0);
      // Every drawn disc, from every source this kind draws them from.
      const discs: { c: number; v: number; r: number }[] = [];
      for (const ser of s.series) {
        const r = ser.symbolSize ?? 4;
        for (const m of ser.marks) {
          if (!m.bar && !m.box && !m.violin && Number.isFinite(m.cx) && Number.isFinite(m.cy)) discs.push({ c: cat(m.cx, m.cy), v: val(m.cx, m.cy), r });
          for (const pt of m.points ?? []) discs.push({ c: cat(pt.cx, pt.cy), v: val(pt.cx, pt.cy), r });
        }
      }
      for (const row of s.lollipop?.rows ?? []) {
        for (const d of row.dots) discs.push({ c: cat(d.cx, d.cy), v: val(d.cx, d.cy), r: d.size ?? s.lollipop!.dotSize });
      }
      for (const row of s.paireddot?.rows ?? []) {
        for (const m of row.marks) discs.push({ c: cat(m.cx, m.cy), v: val(m.cx, m.cy), r: m.size ?? s.paireddot!.dotSize });
      }
      if (discs.length > 0) seenDiscKinds.add(kind);
      let worst: { clear: number } | null = null;
      for (const d of discs.filter((x) => x.c >= c1 - 1 && x.c <= c2 + 1)) {
        const edge = d.v + sign * d.r;
        const clear = sign > 0 ? rail - edge : edge - rail;
        if (!worst || clear < worst.clear) worst = { clear };
      }
      if (worst) {
        expect(worst.clear, `${kind}: the rail sits ${worst.clear.toFixed(1)}px from the nearest disc edge`).toBeGreaterThanOrEqual(GAP_DATA - 0.5);
      }
    });
  }
  it("the disc check found discs on every kind that must draw them", () => {
    const missing = [...MUST_FIND_DISCS].filter((k) => !seenDiscKinds.has(k));
    expect(missing, "these kinds yielded no discs — the check measures nothing there").toEqual([]);
  });

  /**
   * The rail tracks the dot size — the proof the placer actually sees the discs. A lucky
   * fixture can clear the floor above while the placer is blind (a rail parked at the stagger
   * fraction whatever the dots do); growing the dots past the rest of the ink must move an auto
   * rail further out.
   */
  for (const probe of [
    { kind: "scatter", size: SIZE, over: (p: Plot, t: Parameters<typeof buildPlotScene>[0], r: number): Plot => ({ ...p, seriesStyles: Object.fromEntries(tableDatasets(t as never).map((d) => [d.id, { ...(p.seriesStyles?.[d.id] ?? {}), symbolSize: r }])) } as Plot) },
    { kind: "lollipop", size: SIZE, over: (p: Plot, _t: unknown, r: number): Plot => ({ ...p, lollipop: { ...p.lollipop, dotSize: r } } as Plot) },
    { kind: "paireddot", size: BIG, over: (p: Plot, _t: unknown, r: number): Plot => ({ ...p, paireddot: { ...p.paireddot, dotSize: r } } as Plot) },
  ] as const) {
    it(`${probe.kind}: growing the dots moves the auto rail away from the data`, () => {
      const item = galleryItems().find((g) => (g.plot.kind ?? "xy") === probe.kind);
      if (!item) throw new Error(`${probe.kind} has no gallery fixture`);
      const railOf = (r: number): number => {
        const p = withBrackets(probe.over(item.plot as Plot, item.table, r), item.table, 1, probe.size);
        if (!p) throw new Error(`${probe.kind}: the fixture lost its categories`);
        const s = buildPlotScene(item.table, p, probe.size);
        const br = s.annotations.find((a) => String(a.id).startsWith("sig-"));
        if (!br) throw new Error(`${probe.kind}: no bracket placed`);
        const onX = s.valueAxis === "x";
        const sign = onX ? 1 : -1;
        return sign * (onX ? br.x1! : br.y1!); // larger = further from the data, both layouts
      };
      const moved = railOf(45) - railOf(3);
      expect(moved, `${probe.kind}: 3px → 45px dots moved the rail ${moved.toFixed(1)}px — the placer cannot see these discs`).toBeGreaterThan(10);
    });
  }

  /**
   * The lollipop case with large dots, pinned: 30px dots + one auto
   * bracket → the transposed rail sits at exactly dot-edge + GAP_DATA, at every figure size,
   * with no warnings. The rail is read from the bracket path itself, where it is exact, not
   * inferred from the leg tips with an assumed tick. If this fails, the transposed placer
   * is broken.
   */
  it("lollipop: 30px dots put the auto rail at exactly dot-edge + GAP_DATA, at any size", () => {
    const item = galleryItems().find((g) => (g.plot.kind ?? "xy") === "lollipop");
    if (!item) throw new Error("lollipop has no gallery fixture");
    for (const size of [SIZE, { width: 880, height: 580 }, { width: 1100, height: 700 }]) {
      const p = withBrackets({ ...(item.plot as Plot), lollipop: { ...(item.plot as Plot).lollipop, dotSize: 30 } } as Plot, item.table, 1, size);
      if (!p) throw new Error("the lollipop fixture lost its categories");
      const s = buildPlotScene(item.table, p, size);
      const br = s.annotations.find((a) => String(a.id).startsWith("sig-"));
      expect(br?.path, "no bracket placed").toBeTruthy();
      const pts = [...br!.path!.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)];
      const rail = Math.max(...pts.map((m) => Number(m[1])));
      const y1 = Math.min(...pts.map((m) => Number(m[2])));
      const y2 = Math.max(...pts.map((m) => Number(m[2])));
      let maxEdge = -Infinity;
      for (const row of s.lollipop?.rows ?? []) {
        for (const d of row.dots) {
          if (d.cy < y1 - 1 || d.cy > y2 + 1) continue;
          maxEdge = Math.max(maxEdge, d.cx + (d.size ?? s.lollipop!.dotSize));
        }
      }
      expect(maxEdge, `${size.width}px: no dots under the bracket span`).toBeGreaterThan(0);
      expect(rail - maxEdge, `${size.width}px: rail ${rail} vs dot edge ${maxEdge}`).toBeCloseTo(GAP_DATA, 1);
      expect(s.warnings).toEqual([]);
    }
  });

  /**
   * The room is earned, not padded. A figure with no brackets must keep the exact axis it had —
   * otherwise every chart in the program silently gains headroom it does not need.
   */
  it("a figure without brackets keeps its axis untouched", () => {
    for (const item of galleryItems()) {
      const before = buildPlotScene(item.table, item.plot, SIZE);
      const again = buildPlotScene(item.table, item.plot, SIZE);
      expect(again.y.domain, `${item.plot.kind ?? "xy"}: building twice moved the axis`).toEqual(before.y.domain);
    }
  });

  /**
   * A pinned maximum is the user's choice. Widening past it would silently override it, so the
   * figure keeps the pinned axis and the warning explains why it could not help.
   */
  it("a pinned axis maximum wins, and the warning says so", () => {
    const item = galleryItems().find((g) => (g.plot.kind ?? "xy") === "xy")!;
    const p = withBrackets(item.plot as Plot, item.table, 3);
    if (!p) throw new Error("the xy fixture lost its categories");
    const free = buildPlotScene(item.table, p, SIZE);
    const pinned = buildPlotScene(item.table, { ...p, yAxis: { ...(p.yAxis ?? {}), max: free.y.domain[1] * 0.6 } } as Plot, SIZE);
    expect(pinned.y.domain[1], "the pinned maximum was overridden").toBeCloseTo(free.y.domain[1] * 0.6, 6);
    const said = (pinned.warnings ?? []).filter((w) => String(w).includes(SAYS_NO_ROOM));
    expect(said.length, "a pinned axis with no room must still say so").toBeGreaterThan(0);
    expect(String(said[0]), "the warning must name the pinned axis as the reason").toContain("pinned");
  });
});
