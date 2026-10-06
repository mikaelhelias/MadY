// @vitest-environment jsdom
/**
 * The forest pooled summary — its own series, its own panel, its own shape.
 *
 * Required behaviour:
 *   - a tickbox shows or hides the summary series (Plot panel → "Pooled summary");
 *   - clicking the summary symbol opens a clearly labelled panel of its own (summary data
 *     series) with the options of a data point, distinct from a study's panel;
 *   - a tickbox, on by default, links the summary's style to the data points'; unticking it
 *     allows separate tuning;
 *   - the summary's shape can be changed.
 *
 * What this guards against:
 *  - the tickbox going missing (asserted below, so its presence is checked by a test);
 *  - a summary panel indistinguishable from a study's, and scope toggles routing a summary
 *    edit to the studies (they enumerate the table's datasets, and the summary is synthetic);
 *  - a renderer that draws a hard-coded 4-point polygon, so the shape cannot change.
 *
 * Every case here checks the drawing or the committed patch, never just the presence of a
 * control. A panel that writes a field no builder reads looks identical to one that works.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { DataTable, Plot, SeriesStyle } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import { Inspector } from "./Inspector";
import type { GraphSelection } from "./AppShell";

afterEach(cleanup);
afterEach(() => globalThis.localStorage?.clear());

const table: DataTable = {
  id: "t", kind: "column", name: "Studies",
  columns: [
    { id: "s", name: "Study", role: "x" },
    { id: "e", name: "Estimate", role: "y" },
    { id: "lo", name: "Lower", role: "y" },
    { id: "hi", name: "Upper", role: "y" },
  ],
  rows: [
    { id: "r1", cells: { s: "Alpha", e: 1.2, lo: 0.9, hi: 1.6 } },
    { id: "r2", cells: { s: "Beta", e: 0.8, lo: 0.6, hi: 1.1 } },
    { id: "r3", cells: { s: "Gamma", e: 1.5, lo: 1.1, hi: 2.0 } },
  ],
};
const base: Plot = { id: "p", name: "F", source: "t", status: "ok", styleOverrides: {}, kind: "forest" };
const withSummary = (over: Partial<Plot> = {}): Plot => ({ ...base, forest: { showSummary: true }, ...over });
const build = (p: Plot) => buildPlotScene(table, p, { width: 520, height: 360 });
const summaryOf = (style?: SeriesStyle, plotOver: Partial<Plot> = {}) =>
  build(withSummary({ ...plotOver, ...(style ? { seriesStyles: { "forest-summary": style } } : {}) })).forestSummary;

describe("the fixture can exhibit the behaviour", () => {
  it("draws a summary only when asked", () => {
    // If the summary were always drawn (or never), every case below would prove nothing.
    expect(build(base).forestSummary).toBeUndefined();
    expect(build(withSummary()).forestSummary).toBeDefined();
  });
});

describe("the shape — selectable, not only a diamond", () => {
  it("defaults to the diamond, and the default figure is unchanged", () => {
    expect(summaryOf()!.shape).toBe("diamond");
  });

  /** Every shape the model offers. Six of the seven span the CI as a body; `marker` spans
   *  it as a whisker. */
  const ALL_SHAPES = ["diamond", "bar", "roundbar", "lens", "bowtie", "ellipse", "marker"] as const;

  for (const shape of ALL_SHAPES) {
    it(`${shape}: the builder reports it and the CI is still the width`, () => {
      const f = summaryOf({ summaryShape: shape })!;
      expect(f.shape).toBe(shape);
      // Whichever form it takes, xLo/xHi stay the pooled interval — that is the invariant the
      // whole design rests on. A shape you can widen no longer reports a confidence interval.
      const plain = summaryOf()!;
      expect([f.xLo, f.xHi, f.cx]).toEqual([plain.xLo, plain.xHi, plain.cx]);
    });
  }

  const elFor = (shape: (typeof ALL_SHAPES)[number]) => {
    const { container } = render(<PlotFigure scene={build(withSummary({ seriesStyles: { "forest-summary": { summaryShape: shape } } }))} />);
    return container.querySelector(".gfx-forest-summary")!;
  };

  it("each shape draws differently — polygon, rect, path, glyph+whisker", () => {
    const tags: Record<string, string> = {};
    for (const s of ALL_SHAPES) { tags[s] = elFor(s).tagName.toLowerCase(); cleanup(); }
    expect(tags).toEqual({ diamond: "polygon", bar: "rect", roundbar: "rect", lens: "path", bowtie: "polygon", ellipse: "path", marker: "g" });
    // …and the shapes that share a tag are not the same drawing.
    const bar = elFor("bar").getAttribute("rx"); cleanup();
    const round = elFor("roundbar").getAttribute("rx"); cleanup();
    expect(bar).toBeNull();
    expect(Number(round)).toBeGreaterThan(0);
    const dia = elFor("diamond").getAttribute("points"); cleanup();
    const bow = elFor("bowtie").getAttribute("points"); cleanup();
    expect(bow).not.toBe(dia);
    // Lens = pointed ends (quadratics), ellipse = rounded ends (cubics): different paths.
    const lens = elFor("lens").getAttribute("d"); cleanup();
    const ell = elFor("ellipse").getAttribute("d"); cleanup();
    expect(ell, "the ellipse draws the same path as the lens — it is not a new shape").not.toBe(lens);
  });

  /**
   * The key invariant, and the reason a new shape is not just a new outline: the drawn
   * geometry has to reach both ends of the pooled interval. A summary that stops spanning
   * stops reporting the CI, which is its purpose, and that would be invisible to every
   * other assertion here, because the scene's xLo/xHi would still be right.
   */
  it("every body shape's drawn geometry spans the confidence interval, end to end", () => {
    const f = summaryOf()!;
    const x0 = Math.min(f.xLo, f.xHi);
    const x1 = Math.max(f.xLo, f.xHi);
    for (const shape of ALL_SHAPES) {
      if (shape === "marker") continue; // its span is the whisker, checked below
      const el = elFor(shape);
      const xs: number[] = [];
      if (el.tagName.toLowerCase() === "rect") {
        const x = Number(el.getAttribute("x"));
        xs.push(x, x + Number(el.getAttribute("width")));
      } else {
        const src = el.getAttribute("points") ?? el.getAttribute("d") ?? "";
        // Every x is the first number of a coordinate pair; pull them all and take the extremes.
        for (const m of src.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)) xs.push(Number(m[1]));
      }
      cleanup();
      expect(xs.length, `${shape}: could not read any geometry`).toBeGreaterThan(1);
      expect(Math.min(...xs), `${shape} does not reach the CI's lower end`).toBeCloseTo(x0, 6);
      expect(Math.max(...xs), `${shape} does not reach the CI's upper end`).toBeCloseTo(x1, 6);
    }
  });

  it("…and the marker form still draws the interval as a whisker", () => {
    const marker = elFor("marker");
    expect(marker.tagName.toLowerCase()).toBe("g");
    // The CI survives as a whisker — three lines (the bar plus two caps). A bare glyph would
    // be a pooled estimate claiming no precision at all.
    expect(marker.querySelectorAll("line").length).toBe(3);
    const bar = marker.querySelector("line")!;
    expect(Number(bar.getAttribute("x1"))).toBeCloseTo(summaryOf()!.xLo, 6);
    expect(Number(bar.getAttribute("x2"))).toBeCloseTo(summaryOf()!.xHi, 6);
  });

  it("the bowtie pinches at the estimate, not at the middle of the interval", () => {
    // `cx` is the pooled estimate and is generally not (xLo+xHi)/2. Pinching at the midpoint
    // would draw a summary whose waist claims an estimate the analysis did not produce.
    const f = summaryOf()!;
    const pts = elFor("bowtie").getAttribute("points")!.split(" ").map((p) => Number(p.split(",")[0]));
    const mid = (f.xLo + f.xHi) / 2;
    expect(pts).toContain(f.cx);
    if (Math.abs(f.cx - mid) > 0.5) expect(pts).not.toContain(mid);
  });

  it("the marker form honours the glyph, and the other two ignore it (they are their shape)", () => {
    expect(summaryOf({ summaryShape: "marker", symbol: "triangle" })!.symbol).toBe("triangle");
    const el = (style: SeriesStyle) => {
      const { container } = render(<PlotFigure scene={build(withSummary({ seriesStyles: { "forest-summary": style } }))} />);
      return container.querySelector(".gfx-forest-summary")!;
    };
    // A circle glyph really renders as a circle inside the marker group.
    expect(el({ summaryShape: "marker", symbol: "circle" }).querySelector("circle")).not.toBeNull();
    cleanup();
    // …and asking for a glyph on a diamond does not change the polygon.
    const a = el({ summaryShape: "diamond", symbol: "circle" }).getAttribute("points");
    cleanup();
    const b = el({ summaryShape: "diamond", symbol: "star" }).getAttribute("points");
    expect(a).toBe(b);
  });
});

describe("the link to the studies", () => {
  it("is on by default: the summary takes the study look", () => {
    const p = withSummary({ seriesStyles: { e: { color: "#D55E00" } } });
    expect(build(p).forestSummary!.color).toBe("#D55E00");
    // Note: colour alone proves little. The summary falls back to the study colour without the
    // link, so that assertion passes even with the link removed. Fill mode does not fall
    // back — a hollow study marker can only make the summary hollow through the link.
    const hollow = build(withSummary({ seriesStyles: { e: { color: "#D55E00", symbolFill: "clear" } } })).forestSummary!;
    expect(hollow.color, "a CLEAR study marker did not carry through to the summary").toBe("none");
  });

  it("unticked, the summary keeps its own colour while the studies change", () => {
    const p = withSummary({ seriesStyles: { e: { color: "#0072B2" }, "forest-summary": { linkSummaryToStudies: false, color: "#D55E00" } } });
    const f = build(p)!.forestSummary!;
    expect(f.color).toBe("#D55E00");
    expect(build(p).series[0]!.color, "the studies moved with the summary — they are not independent").toBe("#0072B2");
  });

  it("a summary already styled by hand does not silently revert", () => {
    // The reason the default is computed rather than a flat `true`: a default applies at
    // creation, and a saved figure whose summary was styled before this field existed must
    // not change. `linkSummaryToStudies` is undefined on every such plot.
    const p = withSummary({ seriesStyles: { e: { color: "#0072B2" }, "forest-summary": { color: "#CC79A7" } } });
    expect(build(p).forestSummary!.color).toBe("#CC79A7");
  });

  it("the link carries colours, not the form: shape and hidden stay the summary's own", () => {
    // Linked (no appearance overrides) but shaped and hidden on its own terms.
    expect(summaryOf({ summaryShape: "bar" })!.shape).toBe("bar");
    expect(summaryOf({ hidden: true })).toBeUndefined();
  });

  it("linked, size and outline follow the studies too", () => {
    const p = withSummary({ seriesStyles: { e: { symbolSize: 12, symbolOutline: "#000000", symbolBorderWidth: 3 } } });
    const f = build(p).forestSummary!;
    const plain = build(withSummary()).forestSummary!;
    expect(f.halfH, "a bigger study marker did not grow the summary").toBeGreaterThan(plain.halfH);
    expect(f.outline).toBe("#000000");
    expect(f.outlineWidth).toBe(3);
  });
});

// ---------------------------------------------------------------------------------------
const handlers = (spy: {
  onSetPlotOptions?: (p: Partial<Plot>) => void;
  onSetSeriesStyle?: (id: string, d: SeriesStyle) => void;
  onSetSeriesStyleAll?: (ids: string[], d: SeriesStyle) => void;
}) => ({
  onSelect: vi.fn(),
  onSetAxis: vi.fn(), onSetAxisLength: vi.fn(), onSetAxisTitleFont: vi.fn(),
  onSetSeriesStyle: spy.onSetSeriesStyle ?? vi.fn(), onSetSeriesStyleAll: spy.onSetSeriesStyleAll ?? vi.fn(),
  onSetPointStyle: vi.fn(), onClearPointStyles: vi.fn(),
  onSetGrid: vi.fn(), onSetFrame: vi.fn(), onSetKind: vi.fn(), onSetBarLayout: vi.fn(), onSetBarShape: vi.fn(), onSetBoxWhisker: vi.fn(),
  onSetPlotOptions: spy.onSetPlotOptions ?? vi.fn(), onSetGraphTitle: vi.fn(), onSetPlotFont: vi.fn(), onHomogenizeFont: vi.fn(),
  onSetLegend: vi.fn(), onSetSignificance: vi.fn(), onApplyPreset: vi.fn(), 
  onApplyUserPreset: vi.fn(), onSaveUserPreset: vi.fn(), onDeleteUserPreset: vi.fn(), onSetProfileDefault: vi.fn(),
  annotationOps: { add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() },
});

const panel = (selection: GraphSelection, plot: Plot, spy: Parameters<typeof handlers>[0] = {}) => {
  const { container } = render(
    <Inspector activeSection="graphs" selection={selection} plot={plot} table={table} userPresets={[]} profileDefault={null} {...handlers(spy)} />,
  );
  return container;
};
const SUMMARY_SEL: GraphSelection = { kind: "series", columnId: "forest-summary", part: "points" };

/** The input/select on the `.frow` whose own label is exactly `label`. */
const control = (c: HTMLElement, label: string): HTMLInputElement | HTMLSelectElement | undefined => {
  for (const row of c.querySelectorAll<HTMLElement>(".frow")) {
    const span = row.querySelector(":scope > span");
    if ((span?.textContent ?? "").trim() !== label) continue;
    const el = row.querySelector<HTMLInputElement | HTMLSelectElement>("input, select");
    if (el) return el;
  }
  return undefined;
};

describe("the Plot panel's summary tickbox", () => {
  it("is there, and turning it off removes the summary from the drawing", () => {
    const patches: Partial<Plot>[] = [];
    const c = panel({ kind: "plot" }, withSummary(), { onSetPlotOptions: (p) => patches.push(p) });
    const box = control(c, "Pooled summary") as HTMLInputElement;
    expect(box, "the Pooled summary tickbox is missing from the Plot panel").toBeDefined();
    expect(box.checked).toBe(true);
    fireEvent.click(box);
    expect(build({ ...base, ...patches[0] }).forestSummary).toBeUndefined();
  });
});

describe("the summary's own panel", () => {
  it("says whose it is — a study panel does not", () => {
    const c = panel(SUMMARY_SEL, withSummary());
    expect(c.querySelector("[data-summary-head]")?.textContent).toContain("Summary series");
    cleanup();
    const study = panel({ kind: "series", columnId: "e", part: "points" }, withSummary());
    expect(study.querySelector("[data-summary-head]")).toBeNull();
  });

  it("offers the shape, and it reaches the drawing", () => {
    const styles: [string, SeriesStyle][] = [];
    const c = panel(SUMMARY_SEL, withSummary(), { onSetSeriesStyle: (id, d) => styles.push([id, d]) });
    const sel = control(c, "Summary shape") as HTMLSelectElement;
    expect(sel).toBeDefined();
    fireEvent.change(sel, { target: { value: "marker" } });
    expect(styles[0]![0]).toBe("forest-summary");
    expect(build(withSummary({ seriesStyles: { "forest-summary": styles[0]![1] } })).forestSummary!.shape).toBe("marker");
  });

  /**
   * Note: both link states are checked. Rendering only the unlinked panel cannot show a glyph
   * picker hidden while linked, which would leave "Marker + whisker" half-reachable: the form
   * could be picked but the glyph could not be chosen without also unlinking. The link carries
   * colours, not form.
   */
  for (const [name, link] of [["linked", true], ["on its own", false]] as const) {
    it(`the Shape (glyph) row appears only for the marker form — ${name}`, () => {
      const at = (summaryShape: "diamond" | "marker") =>
        control(panel(SUMMARY_SEL, withSummary({ seriesStyles: { "forest-summary": { linkSummaryToStudies: link, summaryShape } } })), "Shape");
      // A glyph picker beside a diamond would be a control that changes nothing.
      expect(at("diamond")).toBeUndefined();
      cleanup();
      expect(at("marker"), "the glyph picker is unreachable in the marker form").toBeDefined();
    });
  }

  it("the glyph reaches the drawing while the link is on", () => {
    const p = withSummary({ seriesStyles: { "forest-summary": { linkSummaryToStudies: true, summaryShape: "marker", symbol: "triangle" } } });
    expect(build(p).forestSummary!.symbol).toBe("triangle");
  });

  it("while linked the appearance rows are hidden, and unticking brings them back", () => {
    const linked = panel(SUMMARY_SEL, withSummary());
    expect(control(linked, "Match the studies"), "the link tickbox is missing").toBeDefined();
    expect((control(linked, "Match the studies") as HTMLInputElement).checked).toBe(true);
    expect(control(linked, "Colour"), "a control that cannot change anything was left on the panel").toBeUndefined();
    cleanup();
    const free = panel(SUMMARY_SEL, withSummary({ seriesStyles: { "forest-summary": { linkSummaryToStudies: false } } }));
    expect(control(free, "Colour")).toBeDefined();
    expect(control(free, "Size")).toBeDefined();
    expect(control(free, "Fill")).toBeDefined();
    expect(control(free, "Outline width")).toBeDefined();
  });

  it("the two-tone edge row hides while linked too — it lives outside the schema form", () => {
    /**
     * Note: the fixture is what makes this test work. That block only renders for a two-tone
     * fill, so a summary style without one cannot show a leaked row and the assertion would pass
     * on broken code. The state below is the one the live app reaches: untick (which seeds
     * `symbolFill` from the house preset's two-tone studies), then re-tick.
     */
    const twoTone: SeriesStyle = { symbolFill: "twotone", linkSummaryToStudies: true };
    const linked = panel(SUMMARY_SEL, withSummary({ seriesStyles: { "forest-summary": twoTone } }));
    expect(control(linked, "Custom edge colour"), "a linked summary offered a row writing a style the builder is not reading").toBeUndefined();
    cleanup();
    // …and it comes back once the summary is on its own, so this is a gate and not a deletion.
    const free = panel(SUMMARY_SEL, withSummary({ seriesStyles: { "forest-summary": { ...twoTone, linkSummaryToStudies: false } } }));
    expect(control(free, "Custom edge colour")).toBeDefined();
  });

  it("unticking seeds the summary with the look it had, so nothing jumps", () => {
    const styles: [string, SeriesStyle][] = [];
    const plot = withSummary({ seriesStyles: { e: { color: "#0072B2", symbolSize: 9 } } });
    const c = panel(SUMMARY_SEL, plot, { onSetSeriesStyle: (id, d) => styles.push([id, d]) });
    fireEvent.click(control(c, "Match the studies") as HTMLInputElement);
    const patch = styles[0]![1];
    expect(patch.linkSummaryToStudies).toBe(false);
    // Apply it and the drawing is unchanged — the switch releases the summary, it does not
    // restyle it. Without the seed it would keep tracking the studies through the fallbacks.
    const after = build(withSummary({ seriesStyles: { e: { color: "#0072B2", symbolSize: 9 }, "forest-summary": patch } })).forestSummary!;
    const before = build(plot).forestSummary!;
    expect([after.color, after.outline, after.halfH]).toEqual([before.color, before.outline, before.halfH]);
  });

  it("a summary edit never reaches the studies", () => {
    // The routing half: both scope toggles enumerate the table's datasets, and the summary is
    // not one of them, so "apply to whole graph" here would restyle the studies instead of
    // the thing that was clicked.
    const all: string[][] = [];
    const one: [string, SeriesStyle][] = [];
    const c = panel(SUMMARY_SEL, withSummary({ seriesStyles: { "forest-summary": { linkSummaryToStudies: false } } }), {
      onSetSeriesStyleAll: (ids) => all.push(ids),
      onSetSeriesStyle: (id, d) => one.push([id, d]),
    });
    expect(c.querySelector(".ppoint-graph"), "the whole-graph scope toggle must not be offered here").toBeNull();
    expect(c.querySelector(".ppoint-series")).toBeNull();
    fireEvent.change(control(c, "Size") as HTMLInputElement, { target: { value: "11" } });
    expect(all, "a summary edit fanned out to the study series").toEqual([]);
    expect(one.map(([id]) => id)).toEqual(["forest-summary"]);
  });

  it("offers no Error bars group — the summary's interval is its shape", () => {
    expect(control(panel(SUMMARY_SEL, withSummary({ seriesStyles: { "forest-summary": { linkSummaryToStudies: false } } })), "Error bars")).toBeUndefined();
  });
});

describe("clicking the summary on the canvas selects it", () => {
  it("opens the summary, not a study", () => {
    const onSelect = vi.fn();
    const { container } = render(<PlotFigure scene={build(withSummary())} onSelect={onSelect} />);
    fireEvent.click(container.querySelector(".gfx-forest-summary")!);
    expect(onSelect).toHaveBeenCalledWith({ kind: "series", columnId: "forest-summary", part: "points" });
  });

  it("every shape is clickable, not just the diamond", () => {
    for (const shape of ["bar", "marker"] as const) {
      const onSelect = vi.fn();
      const { container } = render(<PlotFigure scene={build(withSummary({ seriesStyles: { "forest-summary": { summaryShape: shape } } }))} onSelect={onSelect} />);
      fireEvent.click(container.querySelector(".gfx-forest-summary")!);
      expect(onSelect, `the ${shape} summary is not selectable`).toHaveBeenCalledTimes(1);
      cleanup();
    }
  });
});
