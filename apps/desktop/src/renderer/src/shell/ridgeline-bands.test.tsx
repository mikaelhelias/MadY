// @vitest-environment jsdom
// Ridgeline iso-contour bands — options on the existing ridgeline kind:
//  · `ridgeline.source` "profile": each row = the dataset's value over the table's X column
//    (row height = |v|, negatives fold upward) instead of a KDE — for rows that are time
//    series (e.g. ASV z-scores over Day), not distributions.
//  · `ridgeline.bands` N: the row's height sliced into N equal levels, each filled one shade
//    deeper — the nested iso-contour / horizon look, ± ramps anchored on two hues, keyed by
//    a band legend. Bands replace the plain fill (and the spectrum, with a warning).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene, type PlotScene } from "@mady/graphics";
import { Inspector } from "./Inspector";
import { PlotFigure } from "./PlotFigure";

afterEach(cleanup);

const SIZE = { width: 700, height: 460 };

/** Day + two signed z-score rows — a time-series profile, ±4 extremes. */
const profileT: DataTable = {
  id: "t", kind: "xy", name: "T",
  columns: [
    { id: "x", name: "Day", role: "x" },
    { id: "a", name: "asv_1", role: "y" },
    { id: "b", name: "asv_2", role: "y" },
  ],
  rows: [
    { id: "r1", cells: { x: 0, a: 0, b: 0 } },
    { id: "r2", cells: { x: 10, a: 4, b: -1 } },
    { id: "r3", cells: { x: 20, a: 1, b: -4 } },
    { id: "r4", cells: { x: 30, a: 0, b: 0 } },
  ],
};
const ridge = (over: Partial<Plot> = {}): Plot => ({
  id: "p", name: "R", source: "t", status: "ok", styleOverrides: {}, kind: "ridgeline", ...over,
});

const rowOf = (s: PlotScene, id: string) => s.series.find((se) => se.id === id)!;

describe("ridgeline.source 'profile' — rows are values over the X column", () => {
  it("the x axis spans the X column, and each row's line peaks at |value| on a shared scale", () => {
    const s = buildPlotScene(profileT, ridge({ ridgeline: { source: "profile" } }), SIZE);
    // Without bands the sign has no channel, so folding is reported (asv_2 carries negatives).
    expect(s.warnings).toEqual(['"asv_2" has negative values — they fold upward; turn on Level bands to colour them by sign.']);
    // the value axis is the Day extent, not the z-score extent
    expect(s.x.domain[0]).toBeLessThanOrEqual(0);
    expect(s.x.domain[1]).toBeGreaterThanOrEqual(30);
    // both rows draw; row b's |−4| peak reaches as high above its baseline as row a's +4
    const a = rowOf(s, "a");
    const b = rowOf(s, "b");
    expect(a.linePath).toBeTruthy();
    expect(b.linePath).toBeTruthy();
    const peakRise = (p: string, base: number) => base - Math.min(...[...p.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[2])));
    const baseOf = (p: string) => Math.max(...[...p.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[2])));
    const riseA = peakRise(a.areaPath ?? a.linePath, baseOf(a.areaPath ?? a.linePath));
    const riseB = peakRise(b.areaPath ?? b.linePath, baseOf(b.areaPath ?? b.linePath));
    expect(riseA).toBeGreaterThan(10);
    expect(riseB).toBeCloseTo(riseA, 0); // |−4| folds up to the same height as +4
  });

  it("without a numeric X column it says so and falls back to densities", () => {
    const colT: DataTable = {
      id: "t2", kind: "column", name: "C",
      columns: [
        { id: "x", name: "", role: "x" },
        { id: "a", name: "G1", role: "y" },
      ],
      rows: [1, 2, 3, 4, 5].map((v, i) => ({ id: `r${i}`, cells: { x: "", a: v } })),
    };
    const s = buildPlotScene(colT, ridge({ source: "t2", ridgeline: { source: "profile" } }), SIZE);
    expect(s.warnings.some((w) => /x column/i.test(w))).toBe(true);
    expect(rowOf(s, "a").linePath, "the density fallback must still draw").toBeTruthy();
  });
});

describe("ridgeline.bands — nested level bands (the iso-contour fill)", () => {
  // origin "zero" pins these geometry tests: the fixture rows are already z-score-like,
  // and the default (median) re-centres per row — the origin has its own describe below.
  const banded = ridge({ ridgeline: { source: "profile", bands: 4, origin: "zero" } });

  it("slices each row into per-level filled paths, ± sides on their own ramps", () => {
    const s = buildPlotScene(profileT, banded, SIZE);
    expect(s.warnings).toEqual([]);
    const a = rowOf(s, "a"); // reaches +4 → 4 positive bands
    const b = rowOf(s, "b"); // reaches −4 → 4 negative bands
    expect(a.levelBands?.length).toBe(4);
    expect(b.levelBands?.length).toBe(4);
    // deeper levels are deeper shades — all four distinct per side, and the two sides differ
    const hues = (se: typeof a) => (se.levelBands ?? []).map((lb) => lb.color);
    expect(new Set(hues(a)).size).toBe(4);
    expect(new Set(hues(b)).size).toBe(4);
    expect(hues(a)[0]).not.toBe(hues(b)[0]);
    // the banded fill replaces the plain lobe and the outer |v| curve — the overlaid
    // slices are the drawing on a one-band-tall horizon strip
    expect(a.areaPath ?? "").toBe("");
    expect(a.linePath ?? "").toBe("");
    // every band has drawable geometry
    for (const lb of [...a.levelBands!, ...b.levelBands!]) expect(lb.path.length).toBeGreaterThan(10);
  });

  it("is the horizon fold: slices collapse onto the baseline and overlay", () => {
    // Guards against slices stacked at their level lines with clamped-flat tops, which read
    // as stacked, disjointed pieces. In the true fold, every slice is re-based
    // to the row baseline, so at a peak that crosses all levels every slice reaches the
    // same full strip height — under the stacked geometry their rises would be k/N fractions.
    const s = buildPlotScene(profileT, banded, SIZE);
    const spans = (se: ReturnType<typeof rowOf>) =>
      (se.levelBands ?? []).map((lb) => {
        const ys = [...lb.path.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[2]));
        return { bottom: Math.max(...ys), rise: Math.max(...ys) - Math.min(...ys) };
      });
    for (const id of ["a", "b"] as const) {
      const sp = spans(rowOf(s, id));
      expect(sp.length).toBe(4);
      for (const b of sp) {
        // The discriminator vs the stacked-slab geometry: there, slice k's bottom sits at
        // its level line (k−1)/N up the strip — here every slice's bottom is the baseline.
        expect(b.bottom, `${id}: every slice sits on the baseline`).toBeCloseTo(sp[0]!.bottom, 1);
        expect(b.rise, `${id}: every slice reaches the full strip at the ±4 peak`).toBeCloseTo(sp[0]!.rise, 1);
      }
      expect(sp[0]!.rise).toBeGreaterThan(10);
    }
  });

  it("keys the bands in the legend — shown by default, rows opening the Chart type section", () => {
    const s = buildPlotScene(profileT, banded, SIZE);
    const bandRows = s.legend.filter((e) => e.select?.as === "section");
    expect(bandRows.length, "band rows missing from the legend").toBe(8); // +4..+1 and −1..−4
    for (const e of bandRows) expect(e.select!.id).toBe("Chart type");
    expect(bandRows.some((e) => /\+/.test(e.label))).toBe(true);
    expect(bandRows.some((e) => /−|-/.test(e.label))).toBe(true);
  });

  it("bands work on density rows too — positive ramp only", () => {
    const colT: DataTable = {
      id: "t3", kind: "column", name: "C",
      columns: [
        { id: "x", name: "", role: "x" },
        { id: "a", name: "G1", role: "y" },
      ],
      rows: [1, 2, 2, 3, 3, 3, 4, 4, 5].map((v, i) => ({ id: `r${i}`, cells: { x: "", a: v } })),
    };
    const s = buildPlotScene(colT, ridge({ source: "t3", ridgeline: { bands: 3 } }), SIZE);
    const a = rowOf(s, "a");
    expect(a.levelBands?.length).toBe(3);
  });

  it("bands beat the spectrum, with a warning", () => {
    const s = buildPlotScene(profileT, ridge({ ridgeline: { source: "profile", bands: 3, origin: "zero", spectrum: true } }), SIZE);
    expect(s.warnings.some((w) => /spectrum/i.test(w))).toBe(true);
    expect(rowOf(s, "a").levelBands?.length).toBe(3);
    expect(rowOf(s, "a").fillSpec?.type).not.toBe("axisGradient");
  });

  it("the row outline goes neutral under bands (a per-series line colour still wins)", () => {
    const s = buildPlotScene(profileT, banded, SIZE);
    expect(rowOf(s, "a").lineColor).toBe("#8b8792");
    const own = buildPlotScene(profileT, ridge({ ridgeline: { source: "profile", bands: 4, origin: "zero" }, seriesStyles: { a: { lineColor: "#ff0000" } } }), SIZE);
    expect(rowOf(own, "a").lineColor).toBe("#ff0000");
  });

  it("honours the ramp anchors", () => {
    const s = buildPlotScene(
      profileT,
      ridge({ ridgeline: { source: "profile", bands: 2, origin: "zero", bandPosColor: "#112233", bandNegColor: "#331122" } }),
      SIZE,
    );
    // the top level is the anchor itself
    const a = rowOf(s, "a");
    const b = rowOf(s, "b");
    expect(a.levelBands!.map((lb) => lb.color)).toContain("#112233");
    expect(b.levelBands!.map((lb) => lb.color)).toContain("#331122");
  });
});

describe("clicking a band surface opens its controls", () => {
  it("a .gfx-levelband click selects the Chart type section — where every band control lives", () => {
    // Not the series line panel: its fill controls do nothing on a banded row. As with rose
    // wedges and volcano zones, a click on a plot-wide fill opens the section that owns it.
    const s = buildPlotScene(profileT, ridge({ ridgeline: { source: "profile", bands: 4, origin: "zero" } }), SIZE);
    const picks: unknown[] = [];
    const { container } = render(<PlotFigure scene={s} zoom={1} onSelect={(sel) => picks.push(sel)} />);
    const band = container.querySelector("path.gfx-levelband");
    expect(band, "no band surface rendered").toBeTruthy();
    fireEvent.click(band!);
    expect(picks).toHaveLength(1);
    expect(picks[0]).toEqual({ kind: "chart-section", title: "Chart type" });
  });
});

describe("ridgeline.origin — the banded fold's per-row origin", () => {
  // Raw abundances: always positive, one bump above a flat baseline of 10.
  const rawT: DataTable = {
    id: "t5", kind: "xy", name: "T",
    columns: [
      { id: "x", name: "Day", role: "x" },
      { id: "c", name: "asv_raw", role: "y" },
    ],
    rows: [10, 10, 14, 11, 10, 10].map((v, i) => ({ id: `r${i}`, cells: { x: i * 10, c: v } })),
  };
  const negOf = (p: Plot) => {
    const s = buildPlotScene(rawT, p, SIZE);
    const neg = s.legend.filter((e) => e.select?.as === "section" && e.label.startsWith("−"));
    const bands = rowOf(s, "c").levelBands ?? [];
    return { negRows: neg.length, bands: bands.length, firstPath: bands[0]?.path ?? "", warnings: s.warnings };
  };

  it("defaults to the row median: raw abundances get ± bands without pre-computed z-scores", () => {
    const m = negOf(ridge({ source: "t5", ridgeline: { source: "profile", bands: 4 } }));
    expect(m.warnings).toEqual([]);
    // median 10 → the flat baseline sits at the origin and the bump is +4 above it; the dips
    // never go below, so a + ramp draws and the legend carries no phantom negative side…
    expect(m.bands).toBeGreaterThanOrEqual(4);
    // …while zero-origin on the same data reads everything as +10..+14 — the flat baseline
    // saturates the low slices full-height. Same slice count, genuinely different geometry.
    const z = negOf(ridge({ source: "t5", ridgeline: { source: "profile", bands: 4, origin: "zero" } }));
    expect(z.negRows).toBe(0);
    expect(z.firstPath).not.toBe(m.firstPath);
  });

  it("mean differs from median on skewed rows, and both differ from zero", () => {
    // mean of [10,10,14,11,10,10] = 10.83… → the baseline (10) falls below the origin →
    // negative bands exist; median (10) keeps the baseline exactly at the origin.
    const mean = negOf(ridge({ source: "t5", ridgeline: { source: "profile", bands: 4, origin: "mean" } }));
    const med = negOf(ridge({ source: "t5", ridgeline: { source: "profile", bands: 4 } }));
    expect(mean.negRows).toBeGreaterThan(0);
    expect(med.negRows).toBe(0);
  });
});

describe("the Inspector controls", () => {
  const harness = () => {
    const onSetPlotOptions = vi.fn();
    const h = {
      onSelect: vi.fn(), onSetAxis: vi.fn(), onSetAxisLength: vi.fn(), onSetAxisTitleFont: vi.fn(),
      onSetSeriesStyle: vi.fn(), onSetSeriesStyleAll: vi.fn(), onSetPointStyle: vi.fn(), onClearPointStyles: vi.fn(),
      onSetGrid: vi.fn(), onSetFrame: vi.fn(), onSetKind: vi.fn(), onSetBarLayout: vi.fn(), onSetBarShape: vi.fn(), onSetBoxWhisker: vi.fn(),
      onSetPlotOptions, onSetGraphTitle: vi.fn(), onSetPlotFont: vi.fn(), onHomogenizeFont: vi.fn(),
      onSetLegend: vi.fn(), onSetSignificance: vi.fn(), onApplyPreset: vi.fn(), 
      onApplyUserPreset: vi.fn(), onSaveUserPreset: vi.fn(), onDeleteUserPreset: vi.fn(), onSetProfileDefault: vi.fn(),
      annotationOps: { add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() },
    };
    return { h, onSetPlotOptions };
  };
  const row = (c: HTMLElement, label: string) =>
    [...c.querySelectorAll("label")].find((l) => (l.querySelector("span:first-child")?.textContent ?? "").trim() === label);

  it("Rows show + Level bands + ramp colours write the ridgeline style", () => {
    const { h, onSetPlotOptions } = harness();
    const { container } = render(
      <Inspector activeSection="graphs" selection={{ kind: "plot" }}
        plot={ridge({ ridgeline: { source: "profile", bands: 4 } })} table={profileT}
        userPresets={[]} profileDefault={null} wholeGraph={false} onSetWholeGraph={() => {}} {...h} />,
    );
    const src = row(container, "Rows show");
    expect(src, "no Rows show control").toBeTruthy();
    fireEvent.change(src!.querySelector("select")!, { target: { value: "density" } });
    expect((onSetPlotOptions.mock.calls.at(-1)![0] as Plot).ridgeline?.source).toBeUndefined();
    const bands = row(container, "Level bands");
    expect(bands, "no Level bands control").toBeTruthy();
    fireEvent.change(bands!.querySelector("input")!, { target: { value: "6" } });
    expect((onSetPlotOptions.mock.calls.at(-1)![0] as Plot).ridgeline?.bands).toBe(6);
    expect(row(container, "Band colours"), "no ramp anchors while bands are on").toBeTruthy();
    const origin = row(container, "Fold origin");
    expect(origin, "no Fold origin control on a banded profile").toBeTruthy();
    fireEvent.change(origin!.querySelector("select")!, { target: { value: "zero" } });
    expect((onSetPlotOptions.mock.calls.at(-1)![0] as Plot).ridgeline?.origin).toBe("zero");
    fireEvent.change(origin!.querySelector("select")!, { target: { value: "median" } });
    expect((onSetPlotOptions.mock.calls.at(-1)![0] as Plot).ridgeline?.origin).toBeUndefined();
  });
});
