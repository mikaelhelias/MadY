// @vitest-environment jsdom
/**
 * The legend: clicking its label selects the series, and its symbols are sizeable.
 *
 * Guards against two defects: clicking the legend landing on a tab where the legend's size and
 * font cannot be edited, and a legend symbol size that cannot be edited or does not follow the
 * legend font size. Every graph with this kind of legend lets the legend font be edited and
 * carries a symbol-size slider, as the bubble graph's legend does.
 *
 *  1. The click. The <text> of a row draws on top of any sibling hit area painted before it,
 *     so the label needs its own handler. Without one, clicking a letter hits the text and the
 *     event bubbles past the row <g> to the figure background: the whole graph is selected,
 *     landing on whichever Inspector tab was last open — while clicking the gaps between
 *     letters would still work, so the failure would look intermittent.
 *
 *  2. The symbols. The marker, dot and line stub are sized from the legend font and the
 *     symbol-size slider, not fixed constants, so a 24px legend font does not draw 24px words
 *     beside a 4px marker.
 *
 * Note: case 1 is asserted by dispatching on the <text> element. That is what a browser does
 * when the pointer is over a glyph; a synthetic click on the row <g> would also pass with the
 * handler only on a sibling rect.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import { Inspector } from "./Inspector";
import { galleryItems } from "./gallery";
import type { GraphSelection } from "./AppShell";

afterEach(cleanup);
afterEach(() => globalThis.localStorage?.clear());

const SIZE = { width: 620, height: 420 };

/** Every gallery chart that actually draws a legend with rows. */
function legendKinds(): { kind: string; table: never; plot: Plot }[] {
  return (galleryItems() as unknown as { table: never; plot: Plot }[])
    .map((g) => ({ kind: g.plot.kind ?? "xy", table: g.table, plot: { ...g.plot, legend: { ...(g.plot.legend ?? {}), show: true } } as Plot }))
    .filter((g) => buildPlotScene(g.table, g.plot, SIZE).legend.length > 0);
}

/**
 * Kinds whose legend rows name a section rather than a clickable object.
 *
 * Resolving a row's target from the label string
 * (`scene.series.find(s => s.name === label)`) fails three different ways:
 *
 *  • pie · treemap · radar · parallel · lollipop · paireddot — `scene.series` is empty. They
 *    draw outside the series layer, so there is no name to match.
 *  • volcano — the rows are categories ("Up-regulated" …) over one series (`-log10 p`).
 *  • roc — a near miss: "Biomarker (AUC 0.860)" against a series named "Biomarker". Stripping
 *    the suffix is not a fix; it breaks on the next label carrying extra text.
 *
 * The builder states the target on the entry (`LegendEntry.select`). Where the row names a
 * group with no object of its own — a volcano zone, a treemap region, a parallel group — it
 * opens the section that owns that group's appearance: those colours are `volcano.upColor`
 * and similar options, not properties of a clickable object.
 */
const SECTION_ROWS: Record<string, string> = { volcano: "Chart type", treemap: "Treemap", parallel: "Parallel coordinates",
  // A band row names a magnitude range — a group with no object of its own; its colours
  // live in the Polar histogram section (the same rule as a volcano zone).
  rose: "Chart type",
  // A network row names a node group or a link sign — both live in the Network
  // graph section (groupColumn / the sign colours), not on any clickable object.
  network: "Network graph",
  // A banded ridgeline's row names a level of the band ramp — a magnitude range with no object
  // of its own; the ramp's colours live in the Chart type section (the same rule as rose).
  ridgeline: "Chart type",
  // A tracks legend row names a categorical track's label — a group with no clickable
  // object; its colours (and the track layout) live in the Chart type section.
  tracks: "Chart type",
  // A sunburst legend row names a top-level branch — a group whose hue flows to its rings
  // (no single clickable object); its colour is set from the Chart type section.
  sunburst: "Chart type",
  // An oncoprint legend row names an alteration type — a colour key with no single clickable
  // object; its controls live in the Chart type section.
  oncoprint: "Chart type" };

describe("guarding the guard", () => {
  it("a useful number of kinds draw a legend — otherwise everything below is vacuous", () => {
    expect(legendKinds().length).toBeGreaterThan(8);
  });

  it("every legend row carries an explicit target — name-matching is not load-bearing", () => {
    // Measured off the scene, and stated as "all", so a builder that gains a legend without
    // one is caught. A fixed list of kinds would go stale as soon as a new kind appeared.
    const missing: string[] = [];
    for (const g of legendKinds()) {
      const scene = buildPlotScene(g.table, g.plot, SIZE);
      for (const e of scene.legend) if (!e.select) missing.push(`${g.kind}/"${e.label}"`);
    }
    expect(missing, "legend rows with no declared target — they fall back to matching by label text").toEqual([]);
  });

  it("the label is not what resolves the target — shown on ROC", () => {
    // The row reads "Biomarker (AUC 0.860)"; the series is "Biomarker". Guards against the
    // target being resolved by string matching on the label.
    const g = legendKinds().find((x) => x.kind === "roc")!;
    const scene = buildPlotScene(g.table, g.plot, SIZE);
    const row = scene.legend[0]!;
    expect(row.label).not.toBe(scene.series.find((s) => s.id === "roc-0")!.name);
    expect(row.select).toEqual({ as: "series", id: "roc-0" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Clicking the label selects the series.
// ─────────────────────────────────────────────────────────────────────────────
/** The first legend row's `<g>`, whether or not it is a series row (`data-mady-legend` is the
 *  series-only export hook, so a slice / cell / section row does not carry it). */
function firstRow(container: HTMLElement): Element | null {
  return container.querySelector("g.gfx-legend [data-mady-legend-row]");
}

describe("clicking a legend row", () => {
  for (const g of legendKinds()) {
    /**
     * A clicked text opens a panel that can edit that text. The Data panel sizes the marker,
     * not the label, so the label opens "Title & legend" (the legend's type controls) rather
     * than selecting what the row points at (the series / slice / cell). The swatch and the
     * row still select the series — the case below covers that half.
     */
    it(`${g.kind}: clicking the label text opens the legend's type controls`, () => {
      const scene = buildPlotScene(g.table, g.plot, SIZE);
      const picks: GraphSelection[] = [];
      const { container } = render(<PlotFigure scene={scene} zoom={1} onSelect={(s) => picks.push(s)} />);
      const row = firstRow(container);
      expect(row, `${g.kind}: no legend row in the drawing`).not.toBeNull();
      const text = row!.querySelector("text");
      expect(text, `${g.kind}: the legend row has no label`).not.toBeNull();
      fireEvent.click(text!);
      expect(picks, `${g.kind}: clicking the legend label selected nothing`).toHaveLength(1);
      // Guards against the click falling through to the background, which selects the whole graph.
      expect(picks[0], `${g.kind}: the row selected the whole graph`).not.toEqual({ kind: "plot" });
      expect(picks[0]).toEqual({ kind: "chart-section", title: "Title & legend" });
    });

    it(`${g.kind}: clicking the row (swatch side) still selects what it points at`, () => {
      const scene = buildPlotScene(g.table, g.plot, SIZE);
      const picks: GraphSelection[] = [];
      const { container } = render(<PlotFigure scene={scene} zoom={1} onSelect={(s) => picks.push(s)} />);
      const row = firstRow(container);
      expect(row, `${g.kind}: no legend row in the drawing`).not.toBeNull();
      // The <g> owns the row click; the label's own handler stops propagation, so firing on
      // the row itself is the swatch/gap path a real mouse takes.
      fireEvent.click(row!);
      expect(picks, `${g.kind}: clicking the legend row selected nothing`).toHaveLength(1);
      expect(picks[0], `${g.kind}: the row selected the whole graph`).not.toEqual({ kind: "plot" });
      const want = SECTION_ROWS[g.kind];
      if (want) expect(picks[0]).toEqual({ kind: "chart-section", title: want });
      else expect((picks[0] as { kind: string }).kind).toMatch(/^(series|pie-slice|treemap-cell)$/);
    });
  }

  /**
   * A section row opens a section that exists.
   *
   * Guards against a row naming a section that does not exist, such as `id: "Volcano"`: there
   * is no Volcano section; the zone colours live inside **Chart type**. The pinning hides every
   * section whose heading does not contain the id, so such a click blanks the entire panel,
   * while every assertion about the selection still passes: `{kind:"chart-section",
   * title:"Volcano"}` is exactly what the builder asked for.
   *
   * So this checks the result that matters — after the click, is there anything on screen? —
   * the same check that applies to the reference-line panel.
   */
  for (const [kind, title] of Object.entries(SECTION_ROWS)) {
    it(`${kind}: the section its legend row names exists and is not empty`, () => {
      const g = legendKinds().find((x) => x.kind === kind);
      if (!g) throw new Error(`${kind} draws no legend — the fixture cannot exhibit this`);
      const { container } = render(
        <Inspector activeSection="graphs" selection={{ kind: "chart-section", title }} plot={g.plot} table={g.table}
          userPresets={[]} profileDefault={null} {...handlers(vi.fn())} />,
      );
      const secs = [...container.querySelectorAll<HTMLElement>("details.inspsec")];
      const named = secs.filter((s) => (s.querySelector(":scope > summary")?.textContent ?? "").includes(title));
      expect(named.length, `${kind}: no Inspector section is called "${title}" — the panel would open blank`).toBeGreaterThan(0);
      const controls = named.flatMap((s) => [...s.querySelectorAll("input, select, button.swbtn")]);
      expect(controls.length, `${kind}: "${title}" exists but has no controls`).toBeGreaterThan(0);
    });
  }

  it("the target comes from the scene, so it survives a label the renderer cannot parse", () => {
    // Rename the series out from under the legend row. Name-matching would lose the target;
    // a declared target does not depend on the words. Fired on the row — the swatch/gap
    // path — because the label's own click opens the legend's type instead of the series
    // (the case above covers that half).
    const g = legendKinds().find((x) => x.kind === "xy")!;
    const scene = buildPlotScene(g.table, g.plot, SIZE);
    scene.legend[0]!.label = "⟪ nothing matches this ⟫";
    const picks: GraphSelection[] = [];
    const { container } = render(<PlotFigure scene={scene} zoom={1} onSelect={(s) => picks.push(s)} />);
    fireEvent.click(firstRow(container)!);
    expect(picks).toHaveLength(1);
    expect((picks[0] as { kind: string }).kind).toBe("series");
  });

  it("the swatch selects the series too — the row's handler covers it", () => {
    const g = legendKinds().find((x) => !SECTION_ROWS[x.kind])!;
    const scene = buildPlotScene(g.table, g.plot, SIZE);
    const picks: GraphSelection[] = [];
    const { container } = render(<PlotFigure scene={scene} zoom={1} onSelect={(s) => picks.push(s)} />);
    const row = container.querySelector("[data-mady-legend]")!;
    fireEvent.click(row.querySelector("rect, line, circle, path, polygon")!);
    expect(picks).toHaveLength(1);
    expect((picks[0] as { kind: string }).kind).toBe("series");
  });

  it("a read-only render (export, thumbnail) offers no legend click at all", () => {
    // The control case: `sid` is gated on onSelect, so an export must not gain a cursor or a
    // handler. Without this, "the row is clickable" could be true of every render.
    const g = legendKinds().find((x) => !SECTION_ROWS[x.kind])!;
    const { container } = render(<PlotFigure scene={buildPlotScene(g.table, g.plot, SIZE)} zoom={1} />);
    const row = container.querySelector("[data-mady-legend]");
    expect((row as SVGGElement | null)?.style.cursor ?? "").toBe("");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 1b. Clicking the legend itself — not a row — opens the legend's own controls.
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Clicking the legend body (for example on radar) opens the side panel with the legend font
 * size and the symbol-size slider.
 *
 * Part 1 above covers the rows, for the label and the swatch. This part guards the legend's
 * own body: its box, border and the padding around the rows. Without a handler there, a click
 * bubbles to the figure background and selects the whole graph, landing on whichever tab was
 * last open — the same dead end as for rows, one element further out.
 *
 * The legend has no object of its own to select — its appearance is the "Title & legend"
 * section — so it opens that, as a group row does.
 */
const LEGEND_SECTION = "Title & legend";

/** The legend's own hit area: a transparent rect that is a direct child of the legend group
 *  (a row's rect is nested inside the row `<g>`, so `>` excludes it). */
const legendBody = (container: HTMLElement): Element | null =>
  container.querySelector("g.gfx-legend > rect");

describe("clicking the legend itself", () => {
  for (const g of legendKinds()) {
    it(`${g.kind}: the legend body opens its own font + symbol controls`, () => {
      const picks: GraphSelection[] = [];
      const { container } = render(
        <PlotFigure scene={buildPlotScene(g.table, g.plot, SIZE)} zoom={1} onSelect={(s) => picks.push(s)} />,
      );
      const body = legendBody(container);
      expect(body, `${g.kind}: the legend has no hit area of its own — a <g> is not clickable`).not.toBeNull();
      fireEvent.click(body!);
      // Guards against the click falling through to the figure background (the whole graph).
      expect(picks[0], `${g.kind}: clicking the legend selected the whole graph`).not.toEqual({ kind: "plot" });
      expect(picks, `${g.kind}: clicking the legend selected nothing`).toEqual([{ kind: "chart-section", title: LEGEND_SECTION }]);
    });
  }

  it("that selection lands on the Text tab, where the legend font and symbol-size controls live", () => {
    // The routing this depends on. Forcing the Chart tab for every pinned section suits a
    // volcano zone, treemap region or parallel group, but not this one: "Title & legend"
    // belongs to Text, so lighting Chart would hide the pinned section — a blank panel, the
    // same failure described in the note on section rows above.
    const g = legendKinds().find((x) => x.kind === "radar")!;
    const { container } = render(
      <Inspector activeSection="graphs" selection={{ kind: "chart-section", title: LEGEND_SECTION }} plot={g.plot} table={g.table}
        userPresets={[]} profileDefault={null} {...handlers(vi.fn())} />,
    );
    const lit = [...container.querySelectorAll<HTMLElement>(".inspcat")].filter((e) => e.getAttribute("aria-selected") === "true");
    expect(lit.map((e) => e.textContent), "the rail lit the wrong tab for the legend section").toEqual(["Text"]);
    // …and both controls (legend font, symbol size) are reachable there.
    expect(container.querySelector('input[aria-label="Legend symbol size"]'), "no legend symbol-size slider").not.toBeNull();
    const legendSec = [...container.querySelectorAll<HTMLElement>("details.inspsec")]
      .find((s) => (s.querySelector(":scope > summary")?.textContent ?? "").includes(LEGEND_SECTION))!;
    const sizeRows = [...legendSec.querySelectorAll<HTMLElement>(".frow")]
      .filter((r) => (r.querySelector("span")?.textContent ?? "") === "Size" && r.querySelector("input[type=number]"));
    expect(sizeRows.length, "no font Size input in the legend section").toBeGreaterThan(0);
  });

  it("…and a group row still lands on Chart — the tab follows the section, both ways", () => {
    // The control case for the routing above: routing by section keeps the group rows on the
    // Chart tab. "Chart type" is where a volcano's zone colours live.
    const g = legendKinds().find((x) => x.kind === "volcano")!;
    const { container } = render(
      <Inspector activeSection="graphs" selection={{ kind: "chart-section", title: SECTION_ROWS.volcano! }} plot={g.plot} table={g.table}
        userPresets={[]} profileDefault={null} {...handlers(vi.fn())} />,
    );
    const lit = [...container.querySelectorAll<HTMLElement>(".inspcat")].filter((e) => e.getAttribute("aria-selected") === "true");
    expect(lit.map((e) => e.textContent), "a volcano zone row stopped opening the Chart tab").toEqual(["Chart"]);
  });

  it("a read-only render (export, thumbnail) gets no legend hit area at all", () => {
    // The control case: without this, "the legend is clickable" could be true of every render,
    // and an export would carry a stray transparent rect over its legend.
    const g = legendKinds().find((x) => !SECTION_ROWS[x.kind])!;
    const { container } = render(<PlotFigure scene={buildPlotScene(g.table, g.plot, SIZE)} zoom={1} />);
    expect(legendBody(container), "a read-only legend grew a hit area").toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. The symbols follow the font, and the multiplier moves them.
// ─────────────────────────────────────────────────────────────────────────────
/** The drawn swatch of the first legend row: marker size / stub length / dot radius. */
function swatch(plot: Plot, table: never): { stub: number; dot: number; markerBox: number; column: number } {
  const scene = buildPlotScene(table, plot, SIZE);
  const { container } = render(<PlotFigure scene={scene} zoom={1} onSelect={vi.fn()} />);
  const row = container.querySelector("[data-mady-legend]")!;
  const line = row.querySelector("line");
  const circle = row.querySelector("circle");
  const marker = row.querySelector("path, polygon, rect:not([fill='transparent'])");
  const text = row.querySelector("text")!;
  const out = {
    stub: line ? Number(line.getAttribute("x2")) - Number(line.getAttribute("x1")) : 0,
    dot: circle ? Number(circle.getAttribute("r")) : 0,
    markerBox: marker ? (marker.getBoundingClientRect().width || 0) : 0,
    // The swatch column: where the label starts relative to the row's left edge.
    column: Number(text.getAttribute("x")) - (line ? Number(line.getAttribute("x1")) : 0),
  };
  cleanup();
  return out;
}

describe("the legend symbol size", () => {
  const g = legendKinds().find((x) => x.kind === "xy") ?? legendKinds()[0]!;
  /**
   * The XY card's series draw points only (the curve is a separate fit), and a key draws a line only
   * when its series does (no line in the legend when the graph draws none). The line-stub guards
   * below are about a points+line key, so their fixture draws the series as markers + a line (`plotAs` "auto" overrides the card's "points").
   */
  const withLine = (p: Plot): Plot => ({ ...p, seriesStyles: Object.fromEntries(Object.entries(p.seriesStyles ?? {}).map(([k, v]) => [k, { ...v, plotAs: "auto", connect: "straight" }])) }) as Plot;

  it("at the default point size + 13px font, the stub/column keep their base size and the dot == the point", () => {
    // Pins the stub + column derivation at the default point size and font 13, where they
    // were chosen. `symbolScale: 1` + `seriesStyles: {}` isolate it from the XY house
    // multiplier and its point size 8.
    // Note: the dot is the series' resolved point size (default 4), not a constant, so the key
    //   always matches the data point. The stub is 12 (= 3× the dot base) and the column 18
    //   (= 1.5× stub).
    const s = swatch({ ...g.plot, seriesStyles: {}, legend: { ...(g.plot.legend ?? {}), symbolScale: 1 }, fonts: { ...(g.plot.fonts ?? {}), legend: { size: 13 } } } as Plot, g.table);
    expect(s.stub).toBeCloseTo(12, 5);
    expect(s.dot).toBeCloseTo(4, 5);
    expect(s.column).toBeCloseTo(18, 5);
  });

  it("the line stub + column grow with the legend font; the point symbol follows the point size", () => {
    // Note: `seriesStyles: {}` (default point size): the line stub couples to the font, but also
    //   grows to show past a big dot (so a large point cannot cover the whole line). At a big
    //   point the dot term dominates and the stub stops tracking the font, so the font coupling
    //   is shown at the default point size, where the dot term does not take over.
    const small = swatch({ ...g.plot, seriesStyles: {}, fonts: { ...(g.plot.fonts ?? {}), legend: { size: 13 } } } as Plot, g.table);
    const big = swatch({ ...g.plot, seriesStyles: {}, fonts: { ...(g.plot.fonts ?? {}), legend: { size: 26 } } } as Plot, g.table);
    // The line stub is chrome beside the text → still couples to the font.
    expect(big.stub).toBeGreaterThan(small.stub * 1.9);
    // The swatch column still widens with the font so the label keeps its distance.
    expect(big.column, "the swatch column did not widen — the label would sit too close").toBeGreaterThan(small.column * 1.9);
    // Note: the point symbol (dot) is a 1:1 key to the data point — it follows the series
    //   point size and the slider, not the legend font, so a bigger font leaves it unchanged.
    expect(big.dot).toBeCloseTo(small.dot, 5);
  });

  it("responds to the multiplier on top of the font", () => {
    // Note: symbolScale is pinned explicitly on both sides so the assertion is about the
    // multiplier, not the kind's default (XY's default is 1).
    const one = swatch(withLine({ ...g.plot, legend: { ...(g.plot.legend ?? {}), show: true, symbolScale: 1 } } as Plot), g.table);
    const two = swatch(withLine({ ...g.plot, legend: { ...(g.plot.legend ?? {}), show: true, symbolScale: 2 } } as Plot), g.table);
    expect(two.stub).toBeCloseTo(one.stub * 2, 5);
    expect(two.dot).toBeCloseTo(one.dot * 2, 5);
    expect(two.column).toBeCloseTo(one.column * 2, 5);
  });

  it("follows the series point size — set the data point to 12 and the swatch dot is 12", () => {
    // The legend point follows the marker size (a size-6 marker gets a size-6 key).
    const table = {
      id: "t", kind: "xy", name: "t",
      columns: [{ id: "x", name: "X" }, { id: "y1", name: "A" }, { id: "y2", name: "B" }],
      rows: [{ id: "r1", cells: { x: 1, y1: 2, y2: 3 } }, { id: "r2", cells: { x: 2, y1: 4, y2: 5 } }],
    } as unknown as never;
    // symbolScale 1 + font 13 → symScale 1, so the swatch dot equals the series' point size.
    const plot = {
      id: "p", name: "P", source: "t", status: "ok", styleOverrides: {},
      legend: { show: true, symbolScale: 1 }, fonts: { legend: { size: 13 } },
      seriesStyles: { y1: { symbolSize: 12 } },
    } as Plot;
    const s = swatch(plot, table);
    expect(s.dot, "the first legend row's dot did not match its series' point size").toBeCloseTo(12, 5);
    expect(s.column, "the swatch column did not widen to hold the bigger point").toBeGreaterThan(18);
  });

  it("keeps the line visible past a big point — a large dot does not cover the whole stub", () => {
    // The XY card carries a big point (symbolSize 8). The line stub extends past the dot on
    // both sides, or a points+line legend shows only a dot and loses its line. `stub > 2*dot`
    // means the line sticks out at least one dot-radius on each side.
    const s = swatch(withLine({ ...g.plot, legend: { ...(g.plot.legend ?? {}), show: true, symbolScale: 1 } } as Plot), g.table);
    expect(s.dot, "fixture check — the XY point must be big enough to cover a short stub").toBeGreaterThan(6);
    expect(s.stub, "the line stub is not longer than the dot — the dot covers the line").toBeGreaterThan(2 * s.dot + 4);
  });

  it("the legend marker matches the series marker style — two-tone / outline, not a flat dot", () => {
    const scene = buildPlotScene(g.table, { ...g.plot, legend: { ...(g.plot.legend ?? {}), show: true } } as Plot, SIZE);
    const { container } = render(<PlotFigure scene={scene} zoom={1} onSelect={vi.fn()} />);
    const legMarker = container.querySelector("g.gfx-legend [data-mady-legend] circle");
    const seriesMarker = container.querySelector("g[id^='mark-'] circle");
    expect(legMarker, "legend has no marker circle").not.toBeNull();
    expect(seriesMarker, "series has no marker circle").not.toBeNull();
    // Fixture check: the XY card's marker is two-tone (fill ≠ outline), otherwise matching
    // both proves nothing.
    expect(seriesMarker!.getAttribute("fill"), "fixture check — the XY marker is not two-tone")
      .not.toBe(seriesMarker!.getAttribute("stroke"));
    // The key renders the same fill + outline as the data points.
    expect(legMarker!.getAttribute("fill")).toBe(seriesMarker!.getAttribute("fill"));
    expect(legMarker!.getAttribute("stroke")).toBe(seriesMarker!.getAttribute("stroke"));
    cleanup();
  });

  it("the legend marker updates live when the datapoint style changes", () => {
    // The legend reads the resolved series each build, and any style edit rebuilds the scene,
    // so the swatch tracks the marker. Checked here: two different datapoint styles → two different
    // legend markers (shape + fill + outline all follow).
    const table = {
      id: "t", kind: "xy", name: "t",
      columns: [{ id: "x", name: "X" }, { id: "y1", name: "A" }, { id: "y2", name: "B" }],
      rows: [{ id: "r1", cells: { x: 1, y1: 2, y2: 3 } }, { id: "r2", cells: { x: 2, y1: 4, y2: 5 } }],
    } as unknown as never;
    const base = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, legend: { show: true, symbolScale: 1 }, fonts: { legend: { size: 13 } } };
    const legendMarker = (seriesStyles: Record<string, unknown>): { tag: string | undefined; fill: string | null; stroke: string | null } => {
      const scene = buildPlotScene(table, { ...base, seriesStyles } as Plot, SIZE);
      const { container } = render(<PlotFigure scene={scene} zoom={1} onSelect={vi.fn()} />);
      const shape = container.querySelector("g.gfx-legend [data-mady-legend] circle, g.gfx-legend [data-mady-legend] rect:not([fill='transparent']), g.gfx-legend [data-mady-legend] polygon, g.gfx-legend [data-mady-legend] path");
      const out = { tag: shape?.tagName.toLowerCase(), fill: shape?.getAttribute("fill") ?? null, stroke: shape?.getAttribute("stroke") ?? null };
      cleanup();
      return out;
    };
    const solidRedCircle = legendMarker({ y1: { color: "#ff0000", symbol: "circle", symbolFill: "solid" } });
    const openBlueSquare = legendMarker({ y1: { color: "#0000ff", symbol: "square", symbolFill: "open", symbolFillColor: "#ccccff", symbolOutline: "#0000ff" } });
    expect(solidRedCircle.tag, "a solid circle marker draws a <circle>").toBe("circle");
    expect(solidRedCircle.fill).toBe("#ff0000");
    // Change the datapoint style → the legend marker changes with it: a square is not a circle,
    // and the open/two-tone fill + outline are picked up.
    expect(openBlueSquare.tag, "a square marker is not a <circle>").not.toBe("circle");
    expect(openBlueSquare).not.toEqual(solidRedCircle);
    expect(openBlueSquare.stroke, "the new outline reached the legend").toBe("#0000ff");
  });

  it("is clamped, so a pasted or scripted value cannot draw a legend the size of the plot", () => {
    const huge = swatch({ ...g.plot, legend: { ...(g.plot.legend ?? {}), show: true, symbolScale: 99 } } as Plot, g.table);
    const three = swatch({ ...g.plot, legend: { ...(g.plot.legend ?? {}), show: true, symbolScale: 3 } } as Plot, g.table);
    expect(huge.stub).toBeCloseTo(three.stub, 5);
  });

  it("the outside-right margin is reserved with the same number the swatch is drawn with", () => {
    // Caution: widening the symbol without the reservation makes the legend silently overflow
    // the margin the layout carved for it. Compare the plot width — a wider reservation takes
    // room from the plot.
    // Note: built wide on purpose. An outside-right legend that would take more than a third of
    // the width has its labels broken onto more lines, and a 3× swatch beside "Compound A"
    // crosses that line at 620 px — which widens the plot and measures the wrong thing.
    const ROOMY = { width: 1000, height: 420 };
    const narrow = buildPlotScene(g.table, { ...g.plot, legend: { position: "right", show: true } } as Plot, ROOMY);
    const wide = buildPlotScene(g.table, { ...g.plot, legend: { position: "right", show: true, symbolScale: 3 } } as Plot, ROOMY);
    expect(wide.legendLayout.swatchWidth).toBeGreaterThan(narrow.legendLayout.swatchWidth * 2.5);
    expect(wide.plot.width, "a bigger swatch took no extra room — the reservation is stale").toBeLessThan(narrow.plot.width);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. The control exists, on every kind that draws a legend.
// ─────────────────────────────────────────────────────────────────────────────
const handlers = (onSetLegend: (p: unknown) => void) => ({
  onSelect: vi.fn(),
  onSetAxis: vi.fn(), onSetAxisLength: vi.fn(), onSetAxisTitleFont: vi.fn(),
  onSetSeriesStyle: vi.fn(), onSetSeriesStyleAll: vi.fn(), onSetPointStyle: vi.fn(), onClearPointStyles: vi.fn(),
  onSetGrid: vi.fn(), onSetFrame: vi.fn(), onSetKind: vi.fn(), onSetBarLayout: vi.fn(), onSetBarShape: vi.fn(), onSetBoxWhisker: vi.fn(),
  onSetPlotOptions: vi.fn(), onSetGraphTitle: vi.fn(), onSetPlotFont: vi.fn(), onHomogenizeFont: vi.fn(),
  onSetLegend, onSetSignificance: vi.fn(), onApplyPreset: vi.fn(), 
  onApplyUserPreset: vi.fn(), onSaveUserPreset: vi.fn(), onDeleteUserPreset: vi.fn(), onSetProfileDefault: vi.fn(),
  annotationOps: { add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() },
});

describe("the Symbol size control", () => {
  for (const g of legendKinds()) {
    it(`${g.kind}: offers it, and it writes what the builder reads`, () => {
      const writes: unknown[] = [];
      const { container } = render(
        <Inspector activeSection="graphs" selection={{ kind: "plot" }} plot={g.plot} table={g.table}
          userPresets={[]} profileDefault={null} {...handlers((p) => writes.push(p))} />,
      );
      const slider = container.querySelector<HTMLInputElement>('input[aria-label="Legend symbol size"]');
      expect(slider, `${g.kind}: a legend with no symbol-size control`).not.toBeNull();
      fireEvent.change(slider!, { target: { value: "2.5" } });
      expect(writes).toEqual([{ symbolScale: 2.5 }]);
      cleanup();
      // …and it reaches the drawing on this kind, not only on one sample kind. Measured at the graph's own size:
      // drawn smaller than that, a radar fits its text to its box — a wider key then
      // shrinks the legend font too, and the swatch no longer isolates the slider.
      const own = { width: g.plot.figureWidth ?? SIZE.width, height: g.plot.figureHeight ?? SIZE.height };
      const before = buildPlotScene(g.table, { ...g.plot, legend: { ...(g.plot.legend ?? {}), symbolScale: 1 } } as Plot, own).legendLayout.swatchWidth;
      const after = buildPlotScene(g.table, { ...g.plot, legend: { ...(g.plot.legend ?? {}), symbolScale: 2.5 } } as Plot, own).legendLayout.swatchWidth;
      expect(after, `${g.kind}: the slider's value never reached the drawing`).toBeCloseTo(before * 2.5, 5);
    });
  }

  it("dragging back to 1× writes undefined, so an untouched graph carries no field", () => {
    const g = legendKinds().find((x) => !SECTION_ROWS[x.kind])!;
    const writes: unknown[] = [];
    // Note: starts from a plot that already has a scale — `fireEvent.change` fires nothing when
    // the value does not change, so driving 1 → 1 on a default plot would record no write and
    // fail for a reason unrelated to the app.
    const scaled = { ...g.plot, legend: { ...(g.plot.legend ?? {}), show: true, symbolScale: 2 } } as Plot;
    const { container } = render(
      <Inspector activeSection="graphs" selection={{ kind: "plot" }} plot={scaled} table={g.table}
        userPresets={[]} profileDefault={null} {...handlers((p) => writes.push(p))} />,
    );
    fireEvent.change(container.querySelector<HTMLInputElement>('input[aria-label="Legend symbol size"]')!, { target: { value: "1" } });
    expect(writes).toEqual([{ symbolScale: undefined }]);
  });
});
