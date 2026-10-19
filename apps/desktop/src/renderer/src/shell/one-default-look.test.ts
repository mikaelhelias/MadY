/**
 * The default look is one look — gallery card ≡ new graph ≡ preset picker.
 *
 * The default graph settings must be the same for the gallery, a new graph, and the
 * "MadY default" preset. Guards against the gallery hardcoding the "MadY default" preset while
 * creation follows the user's profile — a profile can point at a different preset,
 * so every new graph would come out in that look while the gallery shows the default.
 *
 * The design is structural (`seedStyle.ts`): gallery cards and graph creation call the same
 * function. These tests hold the three surfaces together for every creatable genre:
 *   1. factory settings: created graph ≡ gallery card, per kind;
 *   2. a non-default profile (Scientific Journal): the match must hold whatever the settings say
 *      — the case a hardcoded gallery would break;
 *   3. the Inspector preset picker: applying "MadY default" ≡ what creation produces.
 *
 * Cards deliberately differ in content, never in style. Every tolerated difference is
 * named in `CONTENT_ONLY` with its reason — an unexplained difference fails.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findPreset, MadyDocument, tableDatasets } from "@mady/core";
import type { AxisSpec, Project, SeriesStyle } from "@mady/core";
import { galleryItems, sampleFor } from "./gallery";
// Loaded up here, not inside a test: loading the gallery pane takes seconds on a busy machine, and
// inside a test that time counts against the test's 5 s clock (enough to time out in a full run).
import { DEFAULT_STYLE, styledPlot } from "./GalleryPane";
import { createNewGraph, defaultFormat, NEW_GRAPH_GENRES } from "./newGraph";
import { setProfileDefault } from "./profile";
import { applyPresetWithKindDefaults, seedPlotStyle } from "./seedStyle";

// profile.ts reads localStorage; give the node environment a minimal one so the
// tests can set a profile. Cleared around every test — factory state = empty store.
const store = new Map<string, string>();
const fakeStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
} as Storage;
beforeEach(() => {
  store.clear();
  (globalThis as { localStorage?: Storage }).localStorage = fakeStorage;
});
afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

function freshDoc(): MadyDocument {
  const project: Project = { schemaVersion: 4, tables: [], plots: [], analyses: [], log: [], workspace: { folders: [], loose: [] } };
  return new MadyDocument(project);
}

/**
 * Card-vs-creation differences that are content, not style — each with its reason.
 * A key listed here is deleted from both sides before comparing.
 */
const CONTENT_ONLY: Record<string, string[]> = {
  // Error-bar display is the New-Graph dialog's own choice (and app default), not a style.
  "*": ["firstSeries.errorBars"],
  // The bubble card overlaps 100 synthetic points, so it demos translucency.
  bubble: ["firstSeries.symbolOpacity"],
  // Which layout suits a graph is a per-graph choice KIND_HOUSE_DEFAULTS deliberately
  // leaves free (see the network entry there). The group and size bindings name column ids
  // from the card's own table — meaningless on any other table (the parallel.colorColumn rule) —
  // and sign colouring demos the card's signed demo weights: on a fresh empty sheet it
  // would paint every (unsigned) link as "positive". "Start with sample data" carries all
  // three through insertGraph (ids remapped), so that door still yields the card verbatim.
  // …and the card gives its data-bearing edges presence (the house default recedes edges as
  // furniture; this card's edge colour is the message) — the bubble symbolOpacity rule.
  network: ["network.layout", "network.groupColumn", "network.sizeColumn", "network.edgeSignColors",
    "network.edgeOpacity", "network.edgeWidth"],
  // A column id from the card's own table — meaningless on any other table.
  parallel: ["parallel.colorColumn"],
  // The card is widened so its long demo row-labels draw in full (PAIRED_WIDE).
  paireddot: ["figureWidth", "figureHeight"],
  // The rich showcase cards (`showcase.ts`) each carry the figure size
  // their data needs (24 heatmap rows, 40 oncoprint samples, 20 swimmer lanes…); a created
  // graph starts at the renderer default, as every other kind does.
  // …the XY card draws its two compounds as points under their fitted curves (a line through
  // the raw points would fight the fit); a created XY starts as points + line, as always.
  // …and carries one dragged potency label (`fitsOffsets`), which only a graph with fits can have.
  xy: ["figureWidth", "figureHeight", "firstSeries.plotAs", "fitsOffsets"],
  raincloud: ["figureWidth", "figureHeight"],
  sunburst: ["figureWidth", "figureHeight"],
  alluvial: ["figureWidth", "figureHeight"],
  chord: ["figureWidth", "figureHeight"],
  oncoprint: ["figureWidth", "figureHeight"],
  ridgeline: ["figureWidth", "figureHeight"],
  // …and the volcano names its hits from a column of the card's own table (the
  // parallel.colorColumn rule: meaningless on any other table).
  volcano: ["figureWidth", "figureHeight", "firstSeries.pointLabels", "firstSeries.pointLabelColumn"],
  // The card demos the colour-by-Class grouped look; the binding names a column id from
  // the card's own table — meaningless on any other table (the parallel.colorColumn rule).
  ternary: ["firstSeries.colorFromColumn", "firstSeries.colorFromMode"],
};

/** The style surface of an axis (content — title text, range, cuts — excluded). */
function axisStyle(a: AxisSpec | undefined) {
  if (!a) return undefined;
  return { lineWidth: a.lineWidth, lineColor: a.lineColor, tickFont: a.tickFont, titleFont: a.titleFont };
}

type Surface = Record<string, unknown>;
function styleSurface(plot: Record<string, unknown>, firstSeries: SeriesStyle | undefined): Surface {
  return {
    fonts: plot.fonts,
    frame: plot.frame,
    tickDir: plot.tickDir,
    titleAlign: plot.titleAlign,
    grid: plot.grid,
    legend: plot.legend,
    barWidth: plot.barWidth,
    xAxis: axisStyle(plot.xAxis as AxisSpec | undefined),
    yAxis: axisStyle(plot.yAxis as AxisSpec | undefined),
    network: plot.network,
    parallel: plot.parallel,
    lollipop: plot.lollipop,
    heatmap: plot.heatmap,
    pcaStyle: plot.pcaStyle,
    bubble: plot.bubble,
    figureWidth: plot.figureWidth,
    figureHeight: plot.figureHeight,
    firstSeries: firstSeries ? { ...firstSeries } : undefined,
  };
}

/** Delete `a.b`-style paths tolerated as content for this genre. */
function stripContent(surface: Surface, genreKey: string): Surface {
  const out = JSON.parse(JSON.stringify(surface)) as Surface;
  for (const path of [...(CONTENT_ONLY["*"] ?? []), ...(CONTENT_ONLY[genreKey] ?? [])]) {
    const [head, tail] = path.split(".");
    if (!tail) delete out[head!];
    else if (out[head!] && typeof out[head!] === "object") delete (out[head!] as Record<string, unknown>)[tail];
  }
  return out;
}

/** Create a graph of this genre the way the app does, style it, return its surface. */
function createdSurface(genreKey: string): Surface {
  const genre = NEW_GRAPH_GENRES.find((g) => g.key === genreKey)!;
  const doc = freshDoc();
  const { table, plot } = createNewGraph(doc, { genre: genre.key, tableKind: defaultFormat(genre) });
  seedPlotStyle(doc, plot!.id, plot!.kind);
  const json = doc.toJSON();
  const p = json.plots.find((x) => x.id === plot!.id)! as unknown as Record<string, unknown>;
  const t = json.tables.find((x) => x.id === table.id)!;
  const ds = tableDatasets(t)[0];
  return styleSurface(p, ds ? (p.seriesStyles as Record<string, SeriesStyle> | undefined)?.[ds.id] : undefined);
}

function cardSurface(genreKey: string): Surface | undefined {
  const card = sampleFor(genreKey);
  if (!card) return undefined;
  const ds = tableDatasets(card.table)[0];
  return styleSurface(card.plot as unknown as Record<string, unknown>, ds ? card.plot.seriesStyles?.[ds.id] : undefined);
}

/** Every genre that has a gallery card (groupedbar / stackedbar / contingency have none). */
// Analysis-fed genres (PCA · ROC · Kaplan-Meier) create NO plot from the wizard — Create hands
// over to Analyze, and the analysis front door makes the graph — so there is no "created
// surface" to compare here.
const GENRES_WITH_CARDS = NEW_GRAPH_GENRES.filter((g) => sampleFor(g.key) !== undefined && !g.analysis);

describe("one default look: gallery card ≡ created graph, per genre", () => {
  it("covers the catalog (the loop below cannot pass by iterating nothing)", () => {
    expect(GENRES_WITH_CARDS.length).toBeGreaterThan(25);
  });

  it.each(GENRES_WITH_CARDS.map((g) => [g.key] as const))("factory settings: %s", (key) => {
    expect(stripContent(createdSurface(key), key)).toEqual(stripContent(cardSurface(key)!, key));
  });

  it.each(GENRES_WITH_CARDS.map((g) => [g.key] as const))("the gallery is pinned to the MadY default style, whatever the profile says: %s", (key) => {
    /**
     * The gallery shows the default: the cards show the program's default style
     * ("MadY default" + kind defaults), full stop. A profile-following gallery would draw every
     * card black-and-white when the profile points at an all-black user preset. A profile change
     * must move new graphs (the factory-settings cases above) and never the cards.
     */
    const before = stripContent(cardSurface(key)!, key);
    setProfileDefault({ kind: "builtin", name: "Scientific Journal" });
    expect(stripContent(cardSurface(key)!, key)).toEqual(before);
  });
});

describe("the gallery card at rest is a pass-through — cards draw the true default", () => {
  /**
   * Guards against the card's drawn data misreporting the default: `styledPlot` must not force
   * a palette or a line width onto the card series while no gallery control has moved, because
   * a real new graph draws the house palette and line width. A check has to look at the data
   * (the traces and bars), not only the frame. Untouched controls change nothing (like the
   * markerSize slider); a moved control still overrides.
   */
  it("DEFAULT_STYLE changes no series style on any card", () => {
    for (const item of galleryItems()) {
      expect(styledPlot(item, DEFAULT_STYLE), `card "${item.key}" was restyled by an untouched test bed`).toEqual(item.plot);
    }
  });

  it("a moved control still overrides every card (the test bed stays a test bed)", () => {
    const xy = galleryItems().find((i) => i.key === "xy")!;
    const restyled = styledPlot(xy, { ...DEFAULT_STYLE, lineWidth: 4 });
    const leadY = xy.table.columns.filter((c) => c.role === "y" && !c.group).map((c) => c.id);
    expect(leadY.length).toBeGreaterThan(0);
    for (const id of leadY) expect(restyled.seriesStyles?.[id]?.lineWidth).toBe(4);
  });
});

describe("the preset picker produces the default it is named after", () => {
  it.each(GENRES_WITH_CARDS.map((g) => [g.key] as const))("MadY default via the picker ≡ creation: %s", (key) => {
    const genre = NEW_GRAPH_GENRES.find((g) => g.key === key)!;
    const doc = freshDoc();
    const { table, plot } = createNewGraph(doc, { genre: key, tableKind: defaultFormat(genre) });
    applyPresetWithKindDefaults(doc, plot!.id, plot!.kind, findPreset("MadY default")!);
    const json = doc.toJSON();
    const p = json.plots.find((x) => x.id === plot!.id)! as unknown as Record<string, unknown>;
    const t = json.tables.find((x) => x.id === table.id)!;
    const ds = tableDatasets(t)[0];
    const viaPicker = styleSurface(p, ds ? (p.seriesStyles as Record<string, SeriesStyle> | undefined)?.[ds.id] : undefined);
    expect(stripContent(viaPicker, key)).toEqual(stripContent(createdSurface(key), key));
  });
});
