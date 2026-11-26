import { describe, expect, it } from "vitest";
import { buildPlotScene } from "./buildScene";
import type { DataTable, Plot } from "@mady/core";

/**
 * "Bar + individual data points" — the figure many journals expect for small n,
 * because a bar alone hides the distribution. The points sit alongside the error bars
 * (they add to them, not replace them), and are real markers so they tune like any other data
 * points rather than being a hardcoded dot.
 */
const reps: DataTable = {
  id: "t", kind: "column", name: "T",
  columns: [
    { id: "c0", name: "Group" },
    { id: "a1", name: "Control", role: "y" }, { id: "a2", name: "a2", role: "y", group: "a1" }, { id: "a3", name: "a3", role: "y", group: "a1" },
    { id: "b1", name: "Treated", role: "y" }, { id: "b2", name: "b2", role: "y", group: "b1" }, { id: "b3", name: "b3", role: "y", group: "b1" },
  ],
  rows: [
    { id: "r0", cells: { c0: "one", a1: 10, a2: 12, a3: 11, b1: 20, b2: 24, b3: 22 } },
    { id: "r1", cells: { c0: "two", a1: 14, a2: 13, a3: 15, b1: 30, b2: 28, b3: 32 } },
  ],
};

const build = (patch: Record<string, unknown>) =>
  buildPlotScene(reps, { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "bar", ...patch } as unknown as Plot,
    { width: 520, height: 360 });

describe("bar charts can overlay their individual points", () => {
  /**
   * Note: the default is on. A bar alone hides the distribution, which is the whole reason
   * journals ask for the points, so showing them is the accurate starting point; hiding them
   * is the deliberate act and needs the explicit `false`.
   */
  it("draws one point per replicate by default, and none only when explicitly switched off", () => {
    const byDefault = build({}).series.flatMap((s) => s.marks);
    expect(byDefault.length).toBe(4); // 2 groups x 2 categories
    for (const m of byDefault) expect(m.points?.length, `mark ${m.label} has no swarm by default`).toBe(3);

    const off = build({ showBarPoints: false });
    expect(off.series.flatMap((s) => s.marks).every((m) => !m.points)).toBe(true);

    const on = build({ showBarPoints: true });
    for (const m of on.series.flatMap((s) => s.marks)) expect(m.points?.length).toBe(3);
  });

  /**
   * A default must not warn repeatedly. The "nothing to show" and "not on stacked bars" warnings exist
   * for the rule that a control that changes nothing has to say why — but that only applies to a
   * control the user actually touched. With the overlay on by default, firing them
   * unprompted would put a warning under every summary-entered and every stacked bar chart
   * in the project, about a box nobody ticked.
   */
  it("stays silent about the overlay unless it was asked for explicitly", () => {
    const summaryTable: DataTable = {
      id: "t", kind: "column", name: "T",
      columns: [
        { id: "c0", name: "G" },
        { id: "m", name: "Mean", role: "y" },
        { id: "s", name: "SD", role: "sd", group: "m" },
      ],
      rows: [
        { id: "r0", cells: { c0: "one", m: 10, s: 2 } },
        { id: "r1", cells: { c0: "two", m: 20, s: 3 } },
      ],
    };
    const summaryDefault = buildPlotScene(
      summaryTable,
      { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "bar" } as unknown as Plot,
      { width: 520, height: 360 },
    );
    expect(
      summaryDefault.warnings.some((w) => /individual points/i.test(w)),
      "a default-on overlay warned about summary data the user never asked to plot",
    ).toBe(false);

    expect(
      build({ barLayout: "stacked" }).warnings.some((w) => /stacked/i.test(w)),
      "a default-on overlay warned about stacked bars unprompted",
    ).toBe(false);
  });

  /**
   * Resizing the data points must not resize the error bars.
   *
   * `seriesExtras` defaults the cap width to `symbolSize * 0.9`, which is right where the
   * marker is the series (a scatter). On a bar the marker is the individual-points swarm —
   * an overlay with nothing to do with the bar's error bars — so following that default would
   * silently scale the caps with the dots (size 4 → cap 3.6; size 16 → cap 14.4).
   */
  it("does not tie the error-bar caps to the marker size", () => {
    const capOf = (patch: Record<string, unknown>) =>
      build(patch).series[0]!.errorCapWidth;
    const small = capOf({ seriesStyles: { a1: { symbolSize: 4 } } });
    const big = capOf({ seriesStyles: { a1: { symbolSize: 16 } } });
    expect(small, "no cap width resolved — the guard would prove nothing").toBeGreaterThan(0);
    expect(big, "a 4x change in point size moved the error-bar caps with it").toBe(small);
  });

  /**
   * The bar's contour width and the swarm points' outline width are different numbers.
   *
   * Guards against the renderer passing `series.borderWidth` to both the bar rect and the
   * marker, which would make thickening a bar's outline thicken every dot drawn on it. It is
   * the same kind of fault the error-bar cap test above guards against: one field standing in
   * for two unrelated marks.
   */
  it("does not tie the points' outline width to the bar's contour width", () => {
    const thin = build({ seriesStyles: { a1: { borderWidth: 1 } } }).series[0]!;
    const thick = build({ seriesStyles: { a1: { borderWidth: 6 } } }).series[0]!;
    expect(thin.borderWidth, "the bar contour did not take the value set").toBe(1);
    expect(thick.borderWidth).toBe(6);
    // Note: must be a real number on both, or this comparison is `undefined === undefined`
    // and passes no matter what the renderer then falls back to.
    expect(typeof thin.symbolBorderWidth, "no independent point-outline width resolved").toBe("number");
    expect(typeof thick.symbolBorderWidth).toBe("number");
    expect(
      thick.symbolBorderWidth,
      "a 6x change in the bar's contour moved the points' outline with it",
    ).toBe(thin.symbolBorderWidth);
  });

  it("lets the points' outline width be set on its own", () => {
    // De-coupling must not mean un-editable: the points' own control reaches it, and it does
    // not drag the bar's contour along with it.
    const s = build({ seriesStyles: { a1: { borderWidth: 2, symbolBorderWidth: 5 } } }).series[0]!;
    expect(s.symbolBorderWidth).toBe(5);
    expect(s.borderWidth, "setting the point outline moved the bar contour").toBe(2);
  });

  it("still honours an explicitly chosen cap width", () => {
    // De-coupling must not mean ignoring the user: the Cap width control still wins.
    const s = build({ seriesStyles: { a1: { symbolSize: 4, errorCapWidth: 21 } } });
    expect(s.series[0]!.errorCapWidth).toBe(21);
  });

  it("keeps the error bars — the points are alongside them, not instead of them", () => {
    const on = build({ showBarPoints: true });
    const marks = on.series.flatMap((s) => s.marks);
    expect(marks.every((m) => m.errLowCy !== undefined && m.errHighCy !== undefined)).toBe(true);
    expect(marks.every((m) => m.bar !== undefined)).toBe(true); // and the bar itself
  });

  it("spreads each swarm across its own bar, so a grouped chart stays readable", () => {
    const on = build({ showBarPoints: true });
    for (const s of on.series)
      for (const m of s.marks) {
        const bar = m.bar!;
        for (const p of m.points ?? []) {
          expect(p.cx).toBeGreaterThanOrEqual(bar.x - 1);
          expect(p.cx).toBeLessThanOrEqual(bar.x + bar.w + 1);
        }
      }
  });

  it("places the points at the real values, not at the bar top", () => {
    const on = build({ showBarPoints: true });
    const m = on.series[0]!.marks[0]!;      // Control / category one: 10, 12, 11 (mean 11)
    const ys = (m.points ?? []).map((p) => p.cy).sort((a, b) => a - b);
    expect(new Set(ys).size).toBe(3);       // three distinct heights, not a stack at the mean
    expect(Math.min(...ys)).toBeLessThan(m.cy);   // the 12 sits above the bar top (smaller y)
    expect(Math.max(...ys)).toBeGreaterThan(m.cy); // the 10 sits below it
  });

  it("horizontal bars spread the swarm down the bar's thickness instead", () => {
    const on = build({ showBarPoints: true, barOrientation: "horizontal" });
    const m = on.series[0]!.marks[0]!;
    expect(m.points?.length).toBe(3);
    for (const p of m.points ?? []) {
      expect(p.cy).toBeGreaterThanOrEqual(m.bar!.y - 1);
      expect(p.cy).toBeLessThanOrEqual(m.bar!.y + m.bar!.h + 1);
    }
  });

  it("says so instead of drawing nothing when there is nothing to draw", () => {
    // Stacked: a segment's points would not line up with the segment.
    expect(build({ showBarPoints: true, barLayout: "stacked" }).warnings.some((w) => /stacked/i.test(w))).toBe(true);
    // Summary data has no individual observations at all. A dataset counts as summary
    // when it carries a pre-computed error column (SD/SEM/CV/limits) — one value per
    // group is not summary data, it is a single real observation, and drawing it is right.
    const summary: DataTable = {
      id: "t", kind: "column", name: "T",
      columns: [
        { id: "c0", name: "G" },
        { id: "m", name: "Mean", role: "y" },
        { id: "s", name: "SD", role: "sd", group: "m" },
      ],
      rows: [
        { id: "r0", cells: { c0: "one", m: 10, s: 2 } },
        { id: "r1", cells: { c0: "two", m: 20, s: 3 } },
      ],
    };
    const s = buildPlotScene(summary, { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "bar", showBarPoints: true } as unknown as Plot, { width: 520, height: 360 });
    expect(s.warnings.some((w) => /no individual points/i.test(w))).toBe(true);
  });

  it("the swarm carries the series' marker styling, so it tunes like any other points", () => {
    const on = build({
      showBarPoints: true,
      seriesStyles: { a1: { symbol: "square", symbolSize: 9 } },
    });
    const s = on.series.find((x) => x.id === "a1")!;
    expect(s.symbol).toBe("square");
    expect(s.symbolSize).toBe(9);
  });
});

/**
 * Full independence matrix for a bar and the individual-points swarm drawn over it.
 *
 * A bar and its dots are two unrelated marks that happen to share one `SeriesStyle`, so one
 * field can end up standing in for both — error-bar caps following the marker size, the
 * points' outline following the bar's contour, or the bar's fill outranking the point's own
 * colour so "Data points ▸ Colour" silently does nothing.
 *
 * This pins every pair at once so any new coupling fails here.
 */
describe("bar + points: every property is independent", () => {
  const S = (style: Record<string, unknown>) => build({ seriesStyles: { a1: style } }).series[0]!;
  /** A resolved marker colour pair, so two-tone derivation is visible. */
  const dots = (s: ReturnType<typeof S>) => `${s.symbolFillColor ?? "-"}/${s.symbolOutline ?? "-"}`;

  /**
   * Note: these fixtures say `linkPointsToBar: false` explicitly. "Match the bar" is on by
   * default, so an unset style is the linked state and the bar's fill is
   * *supposed* to win there. The independence this guards is the unlinked one — the point
   * of the tickbox — so the fixture has to be the unlinked state to exhibit the defect.
   */
  it("the point's own colour wins over the bar's fill — and is a real two-tone pair", () => {
    const barOnly = S({ fillColor: "#D55E00", symbolFill: "twotone", linkPointsToBar: false });
    const pointWins = S({ fillColor: "#D55E00", color: "#0072B2", symbolFill: "twotone", linkPointsToBar: false });
    expect(barOnly.symbolFillColor, "no derived interior from the bar fill").toBeTruthy();
    expect(
      dots(pointWins),
      "the bar's fill outranked the point's own colour — 'Data points > Colour' did nothing",
    ).not.toBe(dots(barOnly));
    // …and it is derived (light interior + dark edge), not the raw hue straight through.
    expect(pointWins.symbolOutline).not.toBe("#0072B2");
    expect(pointWins.symbolFillColor).not.toBe("#0072B2");
  });

  it("recolouring only the bar still re-tints the dots (no orange bar with grey dots)", () => {
    const before = S({ symbolFill: "twotone" });
    const after = S({ fillColor: "#D55E00", symbolFill: "twotone" });
    expect(dots(after), "the dots ignored the bar's new fill colour").not.toBe(dots(before));
  });

  it("point size moves nothing else", () => {
    const a = S({ symbolSize: 4 }), b = S({ symbolSize: 16 });
    expect(b.symbolSize).not.toBe(a.symbolSize);
    expect(b.errorCapWidth, "point size moved the error-bar caps").toBe(a.errorCapWidth);
    expect(b.borderWidth, "point size moved the bar contour").toBe(a.borderWidth);
    expect(b.symbolBorderWidth, "point size moved the point outline").toBe(a.symbolBorderWidth);
  });

  it("point outline width moves nothing else", () => {
    const a = S({ symbolBorderWidth: 1 }), b = S({ symbolBorderWidth: 7 });
    expect(typeof a.symbolBorderWidth).toBe("number");
    expect(b.symbolBorderWidth).not.toBe(a.symbolBorderWidth);
    expect(b.borderWidth, "the point outline moved the bar contour").toBe(a.borderWidth);
    expect(b.errorCapWidth, "the point outline moved the error-bar caps").toBe(a.errorCapWidth);
  });

  it("bar contour width moves nothing else", () => {
    const a = S({ borderWidth: 1 }), b = S({ borderWidth: 6 });
    expect(b.borderWidth).not.toBe(a.borderWidth);
    expect(b.symbolBorderWidth, "the bar contour moved the points' outline").toBe(a.symbolBorderWidth);
    expect(b.errorCapWidth, "the bar contour moved the error-bar caps").toBe(a.errorCapWidth);
    expect(b.symbolSize, "the bar contour moved the point size").toBe(a.symbolSize);
  });

  it("error-bar cap width moves nothing else", () => {
    const a = S({ errorCapWidth: 4 }), b = S({ errorCapWidth: 20 });
    expect(b.errorCapWidth).toBe(20);
    expect(b.symbolSize, "the cap width moved the point size").toBe(a.symbolSize);
    expect(b.symbolBorderWidth, "the cap width moved the point outline").toBe(a.symbolBorderWidth);
    expect(b.borderWidth, "the cap width moved the bar contour").toBe(a.borderWidth);
  });

  it("point shape and fill mode move nothing else", () => {
    const a = S({ symbol: "circle" }), b = S({ symbol: "square" });
    expect(b.symbol).toBe("square");
    expect(b.borderWidth, "the point shape moved the bar contour").toBe(a.borderWidth);
    expect(b.errorCapWidth, "the point shape moved the error-bar caps").toBe(a.errorCapWidth);
    // Two-tone resolves to an open marker for the renderer, and must not touch bar geometry.
    const tt = S({ symbolFill: "twotone" });
    expect(tt.symbolFill).toBe("open");
    expect(tt.borderWidth, "the fill mode moved the bar contour").toBe(a.borderWidth);
  });
});

/**
 * The two-tone sliders, and the link.
 *
 * "Fill lightness" / "Edge darkness" appear twice — once under the bar's Fill, once under
 * Data points. If both wrote `twoToneTint`/`twoToneShade`, dragging either would move the
 * bar and its dots; the point of separate controls is that they tune separately.
 * `linkPointsToBar` is what puts them back together.
 *
 * Note: the link is on by default — a dot over its own bar should
 * read as part of that bar. So `both` carries an explicit `linkPointsToBar: false`: these
 * are the unlinked guards, and without the explicit unlink they would be testing the linked
 * state under an unlinked name. The default is pinned separately at the end of this block.
 */
describe("bar + points: two-tone tuning is separate once unlinked, and linked by default", () => {
  const S = (style: Record<string, unknown>) => build({ seriesStyles: { a1: style } }).series[0]!;
  const both = { fillType: "twotone", symbolFill: "twotone", fillColor: "#2266cc", linkPointsToBar: false } as const;

  it("the bar's tint/shade do not move the points", () => {
    const a = S({ ...both, twoToneTint: 0.2, twoToneShade: 0.2 });
    const b = S({ ...both, twoToneTint: 0.9, twoToneShade: 0.85 });
    expect(b.fillColor, "the bar's own two-tone fill did not change").not.toBe(a.fillColor);
    expect(a.symbolFillColor, "no derived point interior — the guard would prove nothing").toBeTruthy();
    expect(b.symbolFillColor, "the bar's Fill-lightness slider moved the points").toBe(a.symbolFillColor);
    expect(b.symbolOutline, "the bar's Edge-darkness slider moved the points").toBe(a.symbolOutline);
  });

  it("the points' tint/shade do not move the bar", () => {
    const a = S({ ...both, symbolTwoToneTint: 0.2, symbolTwoToneShade: 0.2 });
    const b = S({ ...both, symbolTwoToneTint: 0.9, symbolTwoToneShade: 0.85 });
    expect(b.symbolFillColor, "the points' Fill-lightness slider did nothing").not.toBe(a.symbolFillColor);
    expect(b.symbolOutline, "the points' Edge-darkness slider did nothing").not.toBe(a.symbolOutline);
    expect(b.fillColor, "the points' sliders moved the bar's fill").toBe(a.fillColor);
    expect(b.borderColor, "the points' sliders moved the bar's contour").toBe(a.borderColor);
  });

  it("unlinked points ignore the bar's tint entirely (no silent fall-through)", () => {
    // Falling back to the bar's value when the point's is unset would re-link them: the
    // sliders would look separate and behave as one.
    const barOnly = S({ ...both, twoToneTint: 0.9, twoToneShade: 0.85 });
    const neutral = S({ ...both });
    expect(barOnly.symbolFillColor, "the points inherited the bar's tint").toBe(neutral.symbolFillColor);
  });

  it("'Match the bar' makes the points follow the bar's colour and two-tone again", () => {
    const unlinked = S({ ...both, color: "#D55E00", twoToneTint: 0.9 });
    const linked = S({ ...both, color: "#D55E00", twoToneTint: 0.9, linkPointsToBar: true });
    // Unlinked, the points keep their own colour; linked, they take the bar's fill.
    expect(unlinked.symbolFillColor).not.toBe(linked.symbolFillColor);
    // Linked, the bar's tint does drive them — that is what the tickbox is for.
    const linkedDim = S({ ...both, color: "#D55E00", twoToneTint: 0.2, linkPointsToBar: true });
    expect(linkedDim.symbolFillColor, "'Match the bar' did not hand the tint back to the bar").not.toBe(linked.symbolFillColor);
  });

  /**
   * The default. An untouched bar chart draws its dots in the bar's own look, and that
   * behaviour can only be exhibited by a fixture that says nothing about the link. Unticking has to still work, or the default would be a
   * trap rather than a default.
   */
  it("matches the bar by default, and unticking hands the points back", () => {
    const unset = { fillType: "twotone", symbolFill: "twotone", fillColor: "#2266cc", color: "#D55E00", twoToneTint: 0.9 };
    const byDefault = S(unset);
    const ticked = S({ ...unset, linkPointsToBar: true });
    const unticked = S({ ...unset, linkPointsToBar: false });
    expect(byDefault.symbolFillColor, "no derived point interior — the guard would prove nothing").toBeTruthy();
    expect(unticked.symbolFillColor, "no derived point interior when unlinked").toBeTruthy();
    // Unset must be indistinguishable from ticked…
    expect(byDefault.symbolFillColor, "an untouched bar drew its dots unlinked").toBe(ticked.symbolFillColor);
    expect(byDefault.symbolOutline).toBe(ticked.symbolOutline);
    // …and distinguishable from unticked, or "by default" would mean nothing.
    expect(unticked.symbolFillColor, "unticking 'Match the bar' changed nothing").not.toBe(byDefault.symbolFillColor);
  });
});

/**
 * Per-axis tick fonts.
 *
 * `fonts.tick` is one plot-wide size; alone it would stop a bar chart carrying its treatment
 * names larger than its value numbers — the commonest thing a bar figure wants. `AxisSpec.tickFont`
 * overrides it per axis, merged field-by-field like the per-axis title fonts.
 *
 * Note: size is not only drawn, it is measured: margins, label-width probes, rotation
 * thresholds and the corner-overlap check all read it. A per-axis size that only reached the
 * renderer would draw big labels into space reserved for small ones — labels through the
 * axis title. These assert the layout moved too, not just the font attribute.
 */
describe("per-axis tick fonts", () => {
  const at = (patch: Record<string, unknown>) => build(patch);

  it("sizes the category axis independently of the value axis", () => {
    const s = at({ xAxis: { tickFont: { size: 28 } }, yAxis: { tickFont: { size: 9 } } });
    expect(s.fonts.xTick.size, "the category axis ignored its own tickFont").toBe(28);
    expect(s.fonts.yTick.size, "the value axis was dragged along").toBe(9);
    expect(s.fonts.tick.size, "the shared fallback was mutated").toBe(13);
  });

  it("inherits the shared tick font when an axis sets none", () => {
    const s = at({ fonts: { tick: { size: 19 } } });
    expect(s.fonts.xTick.size).toBe(19);
    expect(s.fonts.yTick.size).toBe(19);
  });

  it("merges field-by-field, so a size override keeps the shared family", () => {
    const s = at({ fonts: { tick: { family: "Georgia", size: 12 } }, xAxis: { tickFont: { size: 30 } } });
    expect(s.fonts.xTick.size).toBe(30);
    expect(s.fonts.xTick.family, "the size override wiped the shared family").toBe("Georgia");
    expect(s.fonts.yTick.size).toBe(12);
  });

  it("reserves room for a larger category label — the layout, not just the paint", () => {
    // The bottom margin is computed from the X tick size. If only the renderer knew about
    // the bigger font, the labels would be drawn into space sized for the small one.
    const small = at({ xAxis: { tickFont: { size: 10 } } });
    const large = at({ xAxis: { tickFont: { size: 30 } } });
    const bottomBand = (sc: typeof small) => sc.height - (sc.plot.y + sc.plot.height);
    expect(
      bottomBand(large),
      "a 3x category label reserved no extra room — it will overlap the axis title",
    ).toBeGreaterThan(bottomBand(small));
  });

  it("reserves room for larger value-axis numbers without touching the bottom", () => {
    const small = at({ yAxis: { tickFont: { size: 10 } } });
    const large = at({ yAxis: { tickFont: { size: 30 } } });
    expect(large.plot.x, "wider value labels reserved no extra left margin").toBeGreaterThan(small.plot.x);
    const bottomBand = (sc: typeof small) => sc.height - (sc.plot.y + sc.plot.height);
    expect(bottomBand(large), "the value axis grew the bottom margin").toBe(bottomBand(small));
  });

  /**
   * Note: this assertion is differential on purpose. The obvious form — "the title sits below
   * the label baseline" — passes even when the anchor uses the wrong font: at 30px it still
   * clears the baseline by 8.7px, which only looks fine while the label's own descender
   * takes almost all of it. A guard that survives the defect guards nothing.
   *
   * What actually distinguishes right from wrong is the direction: an anchor keyed to this
   * axis's tick font gives a bigger label more clearance (24.9 -> 26.0), while one keyed to
   * the shared font gives it less (26.0 -> 8.7), because it believes the labels are 13px
   * when they are 30px. Clearance must never shrink as the labels grow.
   */
  it("gives a larger category label at least as much clearance under the axis title", () => {
    const clearance = (size: number): number => {
      const s = at({ xAxis: { tickFont: { size }, title: "Treatment" } });
      expect(s.x.titlePos, "no X title position resolved — the guard would prove nothing").toBeDefined();
      const labelBaseline = s.plot.y + s.plot.height + s.fonts.xTick.size + (s.axisGaps?.xTick ?? 6);
      return s.x.titlePos! - labelBaseline;
    };
    const small = clearance(10);
    const large = clearance(30);
    expect(small, "no measurable clearance at the small size").toBeGreaterThan(0);
    expect(
      large,
      "a bigger category label got less room under the axis title — the title anchor is " +
        "using the shared tick font, not this axis's",
    ).toBeGreaterThanOrEqual(small);
  });
});
