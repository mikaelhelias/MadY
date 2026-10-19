// @vitest-environment jsdom
/**
 * PCA score dots as depth — the dots show bubble size, like a 3-D plot.
 *
 * A score plot draws two components and discards the rest. Sizing each dot by a third
 * component puts one of them back: the dot furthest along it is smallest (far), the nearest
 * largest — which is what a 3-D scatter shows and a flat one cannot.
 *
 * On by default on the score plot and on the biplot; `sizeComponent: -1` turns it off.
 * Components are orthogonal, so the size says something the two positions do not. A biplot's
 * arrows are the variables projected onto the two plotted axes only, so the size legend is
 * what explains a big dot there.
 *
 * The main error this file guards against: sizing by |score|. It looks right on data that is
 * all one sign and is wrong the moment a score crosses zero — both ends of the depth axis then
 * draw the same size, which depth must never do. The gallery card's PC3 straddles zero, so the
 * fixture can tell the two apart.
 *
 * Everything here runs on the real gallery card, so it also proves the default reaches a card
 * a user can actually see.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import { Inspector } from "./Inspector";
import { galleryItems } from "./gallery";

afterEach(cleanup);
afterEach(() => globalThis.localStorage?.clear());

const SIZE = { width: 620, height: 420 };
const card = (kind: string) => galleryItems().find((g) => (g.plot.kind ?? "xy") === kind)!;
const build = (kind: string, extra: Partial<Plot> = {}) => {
  const g = card(kind);
  return buildPlotScene(g.table, { ...g.plot, ...extra } as Plot, SIZE);
};
/** Every score dot's radius, keyed by case id. */
const radii = (s: ReturnType<typeof build>): Map<string, number | undefined> =>
  new Map(s.series.filter((x) => x.id.startsWith("pca-")).flatMap((x) => x.marks).map((m) => [String(m.rowId), m.symbolSize]));

describe("the fixture can exhibit the behaviour", () => {
  it("the score-plot card has a third component whose scores straddle zero", () => {
    const pca = card("pcascore").plot.pca!;
    expect(pca.pcLabels.length).toBeGreaterThanOrEqual(3);
    const pc3 = pca.scores.map((s) => s[2]!);
    expect(Math.min(...pc3), "no negative PC3 score — |score| and the signed score would agree").toBeLessThan(0);
    expect(Math.max(...pc3)).toBeGreaterThan(0);
  });
});

describe("the score plot sizes its dots by depth", () => {
  it("every dot gets a radius, and they are not all the same", () => {
    const r = [...radii(build("pcascore")).values()];
    expect(r.length).toBeGreaterThan(2);
    expect(r.every((v) => typeof v === "number")).toBe(true);
    expect(new Set(r).size, "every dot drew the same size — depth is not being applied").toBeGreaterThan(1);
  });

  it("the radius follows the signed score: the most negative case is the smallest dot", () => {
    const pc3 = card("pcascore").plot.pca!.scores.map((s) => s[2]!);
    const lo = pc3.indexOf(Math.min(...pc3));
    const hi = pc3.indexOf(Math.max(...pc3));
    const r = radii(build("pcascore"));
    expect(r.get(`case-${lo}`)!, "sized by |score| — the far end drew big").toBeLessThan(r.get(`case-${hi}`)!);
    // …and a case near zero sits between them, which |score| could not produce either.
    const mid = pc3.indexOf([...pc3].sort((a, b) => Math.abs(a) - Math.abs(b))[0]!);
    expect(r.get(`case-${mid}`)!).toBeGreaterThan(r.get(`case-${lo}`)!);
    expect(r.get(`case-${mid}`)!).toBeLessThan(r.get(`case-${hi}`)!);
  });

  it("…and it reaches the drawing — the figure's dots have different radii, not just the scene", () => {
    const { container } = render(<PlotFigure scene={build("pcascore")} zoom={1} onSelect={vi.fn()} />);
    const rs = [...container.querySelectorAll("circle")].map((c) => Number(c.getAttribute("r")));
    expect(rs.length).toBeGreaterThan(2);
    expect(new Set(rs).size, "every circle in the figure has the same radius").toBeGreaterThan(1);
  });

  it("a biplot sizes by default too, and -1 turns it off", () => {
    // On a biplot the dots also scale with a third component as bubble size, and the user can
    // still choose not to use the third dimension.
    const r = radii(build("pcabiplot"));
    expect([...r.values()].every((v) => typeof v === "number"), "the biplot's dots stayed uniform").toBe(true);
    expect(build("pcabiplot").bubbleLegend, "no size legend to say what a big dot means").toBeDefined();
    const off = radii(build("pcabiplot", { pcaStyle: { ...card("pcabiplot").plot.pcaStyle, sizeComponent: -1 } }));
    expect([...off.values()].every((v) => v === undefined), "-1 did not restore uniform dots").toBe(true);
  });

  it("the size legend names the component and its variance share — bare \"PC3\" says nothing", () => {
    const s = build("pcascore");
    const pca = card("pcascore").plot.pca!;
    expect(s.bubbleLegend?.title).toBe(`PC3 (${(pca.explained[2]! * 100).toFixed(1)}%)`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Two legends, one right margin: guards against the legends clashing on the PCA plot.
//
// Both blocks are drawn from the plot's right edge — the group legend at
// `plotRight + gap + outsidePad`, the size legend at `plotRight + 16` — so with
// outsidePad 0 the group names can land straight on top of the size spheres and their
// value labels.
//
// Measured in the renderer's own width model (`len × fontSize × 0.6`, what Legend uses to
// size its box), so this compares like with like instead of inventing a second yardstick.
// ─────────────────────────────────────────────────────────────────────────────
const estW = (s: string, fs: number): number => s.length * fs * 0.6;

/** A bubble chart whose points are coloured by a column — the only bubble chart that draws a
 *  legend, and so the only one where the two right-hand blocks can meet. */
const BUBBLE_BY_REGION: { table: DataTable; plot: Plot } = (() => {
  const table: DataTable = {
    id: "bt", kind: "xy", name: "B",
    columns: [
      { id: "gdp", name: "GDP / capita", role: "x" },
      { id: "life", name: "Life expectancy", role: "y" },
      { id: "pop", name: "Population", role: "y" },
      // A category column carries role "x" here, the way the gallery's treemap "Region" does.
      { id: "region", name: "Region", role: "x" },
    ],
    rows: ([
      ["r1", 5, 60, 12, "Africa"], ["r2", 18, 72, 40, "Asia"], ["r3", 42, 81, 8, "Europe"],
      ["r4", 9, 65, 90, "Asia"], ["r5", 36, 79, 25, "Europe"], ["r6", 3, 58, 55, "Africa"],
    ] as [string, number, number, number, string][]).map(([id, gdp, life, pop, region]) => ({ id, cells: { gdp, life, pop, region } })),
  };
  const plot = {
    id: "bp", name: "B", source: "bt", status: "ok", styleOverrides: {}, kind: "bubble",
    legend: { show: true },
    seriesStyles: { life: { colorFromColumn: "region" } },
  } as unknown as Plot;
  return { table, plot };
})();

/** [left, right] px span of a legend block in the rendered figure. */
function span(container: HTMLElement, selector: string, fs: number, padLeft = 0): [number, number] {
  const texts = [...container.querySelectorAll(`${selector} text`)];
  expect(texts.length, `nothing rendered for ${selector}`).toBeGreaterThan(0);
  const xs = texts.map((t) => Number(t.getAttribute("x")));
  const rights = texts.map((t) => Number(t.getAttribute("x")) + estW(t.textContent ?? "", fs));
  return [Math.min(...xs) - padLeft, Math.max(...rights)];
}

describe("the two right-hand legends do not overlap", () => {
  it("the group legend sits clear of the depth-size legend, and both stay on the canvas", () => {
    const scene = build("pcascore");
    expect(scene.legend.length, "no group legend — this fixture cannot exhibit the clash").toBeGreaterThan(1);
    expect(scene.bubbleLegend, "no size legend — this fixture cannot exhibit the clash").toBeDefined();
    const { container } = render(<PlotFigure scene={scene} zoom={1} onSelect={vi.fn()} />);
    const fs = scene.fonts.legend.size;
    const size = span(container, ".gfx-size-legend", fs);
    // The group legend's swatch column sits to the left of its text — count it in.
    const group = span(container, ".gfx-legend", fs, scene.legendLayout.swatchWidth ?? 18);
    expect(group[0], `group legend starts at ${group[0]}, size legend runs to ${size[1]}`).toBeGreaterThan(size[1]);
    expect(size[0], "the size legend is not against the plot edge").toBeGreaterThan(scene.plot.x + scene.plot.width);
    expect(group[1], "the group legend was pushed off the right of the figure").toBeLessThanOrEqual(scene.width);
  });

  /** The bubble chart reaches the same clash only through a colour-mapped legend — its
   *  per-series row is refused (see below), and a value legend is the one it draws. */
  it("…and a colour-mapped bubble chart, the one bubble legend that is drawn", () => {
    const scene = buildPlotScene(BUBBLE_BY_REGION.table, BUBBLE_BY_REGION.plot, SIZE);
    expect(scene.legend.map((e) => e.label), "no value legend — this fixture cannot exhibit the clash").toEqual(["Africa", "Asia", "Europe"]);
    expect(scene.bubbleLegend).toBeDefined();
    const { container } = render(<PlotFigure scene={scene} zoom={1} onSelect={vi.fn()} />);
    const fs = scene.fonts.legend.size;
    const size = span(container, ".gfx-size-legend", fs);
    const group = span(container, ".gfx-legend", fs, scene.legendLayout.swatchWidth ?? 18);
    expect(group[0], `value legend starts at ${group[0]}, size legend runs to ${size[1]}`).toBeGreaterThan(size[1]);
    expect(group[1]).toBeLessThanOrEqual(scene.width);
  });

  /**
   * A Y2 axis is in that margin too, and its tick labels can run under the legend.
   */
  it("the legend clears a Y2 axis' tick labels", () => {
    const g = card("xy");
    const ys = g.table.columns.filter((c) => c.role === "y");
    expect(ys.length, "one Y column — this fixture cannot produce a Y2 axis").toBeGreaterThan(1);
    const plot = {
      ...g.plot,
      legend: { show: true },
      seriesStyles: { ...(g.plot.seriesStyles ?? {}), [ys[1]!.id]: { ...(g.plot.seriesStyles?.[ys[1]!.id] ?? {}), axis: "y2" } },
    } as Plot;
    const scene = buildPlotScene(g.table, plot, SIZE);
    expect(scene.y2, "no Y2 axis was built").toBeDefined();
    const { container } = render(<PlotFigure scene={scene} zoom={1} onSelect={vi.fn()} />);
    const fs = scene.fonts.legend.size;
    const group = span(container, ".gfx-legend", fs, scene.legendLayout.swatchWidth ?? 18);
    // Every text right of the plot that is not a legend row is a Y2 tick label / title.
    // Note: a rotated text (the Y2 title reads top to bottom) is about one line-height wide, not its
    // text length; measured as if it were flat, it would reach far past its real right edge. It is
    // measured as drawn, which also means the legend is checked against the title as well as the
    // tick labels.
    const inLegend = new Set([...container.querySelectorAll(".gfx-legend text, .gfx-size-legend text")]);
    const y2Right = Math.max(...[...container.querySelectorAll("text")]
      .filter((t) => !inLegend.has(t) && Number(t.getAttribute("x")) > scene.plot.x + scene.plot.width)
      .map((t) => {
        const x = Number(t.getAttribute("x"));
        const fsHere = Number(t.getAttribute("font-size")) || scene.fonts.tick.size;
        return /rotate\(-?90[\s)]/.test(t.getAttribute("transform") ?? "") ? x + fsHere / 2 : x + estW(t.textContent ?? "", scene.fonts.tick.size);
      }));
    expect(y2Right, "no Y2 tick labels drawn right of the plot").toBeGreaterThan(scene.plot.x + scene.plot.width);
    expect(group[0], `legend starts at ${group[0]}, Y2 tick labels run to ${y2Right}`).toBeGreaterThan(y2Right);
    expect(group[1], "the legend was pushed off the right of the figure").toBeLessThanOrEqual(scene.width);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The bubble chart's per-series legend, refused. Its only entry would read "Life expectancy",
// character-for-character the Y axis title beside it, so it adds nothing.
// ─────────────────────────────────────────────────────────────────────────────
describe("a bubble chart has no per-series legend", () => {
  it("…because the only row it could draw is the Y axis title", () => {
    const g = card("bubble");
    const scene = buildPlotScene(g.table, { ...g.plot, legend: { show: true } } as Plot, SIZE);
    expect(scene.series.map((s) => s.name)).toEqual([scene.y.title]); // the duplication itself
    expect(scene.legend).toEqual([]);
  });

  it("the refusal is stated, but only to someone who asked for the legend", () => {
    const g = card("bubble");
    const asked = buildPlotScene(g.table, { ...g.plot, legend: { show: true } } as Plot, SIZE);
    expect(asked.warnings.some((w) => w.includes("one series"))).toBe(true);
    // An untouched bubble chart does not ask for this legend, so no warning is shown.
    expect(buildPlotScene(g.table, g.plot as Plot, SIZE).warnings).toEqual([]);
  });

  it("a colour-mapped bubble keeps its legend — that one names the values, not the axis", () => {
    const scene = buildPlotScene(BUBBLE_BY_REGION.table, BUBBLE_BY_REGION.plot, SIZE);
    expect(scene.legend.map((e) => e.label)).toEqual(["Africa", "Asia", "Europe"]);
    expect(scene.warnings).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The control — a capability with no control cannot be reached by the user.
// ─────────────────────────────────────────────────────────────────────────────
const handlers = (onSetPlotOptions = vi.fn()) => ({
  onSelect: vi.fn(),
  onSetAxis: vi.fn(), onSetAxisLength: vi.fn(), onSetAxisTitleFont: vi.fn(),
  onSetSeriesStyle: vi.fn(), onSetSeriesStyleAll: vi.fn(), onSetPointStyle: vi.fn(), onClearPointStyles: vi.fn(),
  onSetGrid: vi.fn(), onSetFrame: vi.fn(), onSetKind: vi.fn(), onSetBarLayout: vi.fn(), onSetBarShape: vi.fn(), onSetBoxWhisker: vi.fn(),
  onSetPlotOptions, onSetGraphTitle: vi.fn(), onSetPlotFont: vi.fn(), onHomogenizeFont: vi.fn(),
  onSetLegend: vi.fn(), onSetSignificance: vi.fn(), onApplyPreset: vi.fn(), 
  onApplyUserPreset: vi.fn(), onSaveUserPreset: vi.fn(), onDeleteUserPreset: vi.fn(), onSetProfileDefault: vi.fn(),
  annotationOps: { add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() },
});

function inspector(kind: string, extra: Partial<Plot> = {}) {
  const g = card(kind);
  const opts: Partial<Plot>[] = [];
  const { container } = render(
    <Inspector activeSection="graphs" selection={{ kind: "plot" }} plot={{ ...g.plot, ...extra } as Plot} table={g.table}
      userPresets={[]} profileDefault={null} {...handlers(vi.fn((p: Partial<Plot>) => opts.push(p)))} />,
  );
  const row = [...container.querySelectorAll(".frow")].find((e) => (e.querySelector("span")?.textContent ?? "").includes("Dot size"));
  const sections = [...container.querySelectorAll(".inspsec > summary")].map((e) => e.textContent ?? "");
  return { container, opts, row: row as HTMLElement | undefined, sections };
}

describe("the control", () => {
  it("offers 'Dot size (depth)' on the score plot, showing the component the graph is drawing", () => {
    const { row } = inspector("pcascore");
    expect(row, "no depth-size control on the score plot").toBeDefined();
    expect(row!.querySelector<HTMLSelectElement>("select")!.value, "the control disagrees with the builder's default").toBe("2");
  });

  it("turning it Off writes -1, which the builder reads as uniform dots", () => {
    const { opts, row } = inspector("pcascore");
    fireEvent.change(row!.querySelector("select")!, { target: { value: "-1" } });
    expect(opts.at(-1)!.pcaStyle!.sizeComponent).toBe(-1);
    expect([...radii(build("pcascore", { pcaStyle: { sizeComponent: -1 } })).values()].every((v) => v === undefined)).toBe(true);
  });

  it("the biplot offers it too, showing the drawn component; the loadings plot has no dots, so no control", () => {
    // The biplot sizes its dots by default too; see the builder test above.
    expect(inspector("pcabiplot").row!.querySelector<HTMLSelectElement>("select")!.value).toBe("2");
    expect(inspector("pcaload").row, "the loadings plot offers a control over dots it does not draw").toBeUndefined();
  });

  it("the size legend's editor appears exactly when the legend does", () => {
    expect(inspector("pcascore").sections.some((t) => t.includes("Bubble size"))).toBe(true);
    expect(inspector("pcascore", { pcaStyle: { sizeComponent: -1 } }).sections.some((t) => t.includes("Bubble size"))).toBe(false);
    expect(inspector("pcabiplot").sections.some((t) => t.includes("Bubble size"))).toBe(true);
    expect(inspector("pcabiplot", { pcaStyle: { sizeComponent: -1 } }).sections.some((t) => t.includes("Bubble size"))).toBe(false);
  });

  /**
   * Two cases, because the score-plot card does not exercise the fallback on its own.
   *
   * A PCA score plot must not show the bubble chart's radius range (22) — 9 is the PCA
   * fallback passed at the control's call site. The `pcascore` house default carries an
   * explicit maxRadius 12, so the card arrives with a real value and the fallback is never
   * reached: asserting 9 alone would be a fixture that cannot exhibit the bug it guards. So the
   * default case checks that 12 lands, and a second case clears `bubble` to test that the
   * fallback underneath is PCA's 9 and not the bubble chart's 22.
   */
  const radiusVal = (container: HTMLElement, label: string): string =>
    [...container.querySelectorAll(".frow")].find((e) => (e.querySelector("span")?.textContent ?? "") === label)!
      .querySelector<HTMLInputElement>("input")!.value;

  it("the min/max radius inputs show the PCA house default", () => {
    const { container } = inspector("pcascore");
    expect(radiusVal(container, "Min radius")).toBe("2");
    expect(radiusVal(container, "Max radius")).toBe("12");
  });

  it("…and with no value set they fall back to PCA's own range, not the bubble chart's 22", () => {
    const { container } = inspector("pcascore", { bubble: undefined });
    expect(radiusVal(container, "Min radius")).toBe("2");
    expect(radiusVal(container, "Max radius")).toBe("9");
  });
});
