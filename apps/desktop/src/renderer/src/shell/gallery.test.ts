// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { Plot, TableKind } from "@mady/core";
import { findPreset, MadyDocument, validateTable } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { FIGURE_DEFAULT_H, FIGURE_DEFAULT_W } from "./figureFit";
import { graphLayoutSize, scaleForResize } from "./graphDisplay";
import { applyCardLook, galleryItems, hasSample, sameGalleryLook, sampleFor } from "./gallery";
import { NEW_GRAPH_GENRES } from "./newGraph";

describe("applyCardLook — a card click restyles the existing copy, never forks", () => {
  /**
   * Guards against a duplicate on reopen: open a card, restyle the graph with a preset, click
   * the card again. A reopen check that refuses a copy which does not look like the card would
   * fork a duplicate datasheet + graph. The click must duplicate nothing: it restyles the
   * current graph.
   */
  it("brings a preset-restyled copy back to the card look, in place, adding nothing", () => {
    const card = galleryItems().find((i) => i.key === "xy")!;
    const doc = new MadyDocument();
    const { table, plot } = doc.insertGraph(card.table, card.plot, card.title);

    // The Inspector's own restyle path. The copy has to stop matching the card, or this
    // fixture cannot exhibit the defect and the test guards nothing.
    doc.applyStylePreset(plot.id, findPreset("Scientific Journal")!);
    const restyled = doc.toJSON().plots.find((p) => p.id === plot.id)!;
    expect(sameGalleryLook(restyled, card.plot), "fixture check: the restyle must break the look match").toBe(false);

    const before = { tables: doc.toJSON().tables.length, plots: doc.toJSON().plots.length };
    const src = doc.toJSON().tables.find((t) => t.id === table.id)!;
    applyCardLook(doc, plot.id, src, card);

    const after = doc.toJSON();
    expect({ tables: after.tables.length, plots: after.plots.length }, "restyle must add no objects").toEqual(before);
    expect(sameGalleryLook(after.plots.find((p) => p.id === plot.id)!, card.plot), "the copy wears the card look again").toBe(true);
    // …and the copy's own series (remapped column ids) carry the card's series style.
    const dsId = after.tables.find((t) => t.id === table.id)!.columns.find((c) => c.role === "y" && !c.group)!.id;
    expect(after.plots.find((p) => p.id === plot.id)!.seriesStyles?.[dsId]?.color).toBe("#0072B2");
  });
});

describe("chart gallery", () => {
  const items = galleryItems();

  it("covers every chart kind exactly once (maintain this with new types)", () => {
    const kinds = items.map((it) => it.plot.kind ?? "xy");
    // Every kind appears once, except where one kind is carded more than once because each card
    // shows a combination of options the plain card does not, under its own name so the look is
    // one click away:
    //   - `bar`, eight cards: grouped bar, simple column bar, waterfall (barSort + threshold
    //     zones), relative abundance (100%-stacked + stratum ribbons, never labelled bar/column),
    //     "Bars + line (2nd axis)" (one series drawn as a line on Y2), Pareto (Sort bars + the
    //     cumulative % line), "Ranked dots vs a reference" (bars drawn as dots) and
    //     "Stacked bars + line (2nd axis)";
    //   - `xy`, four cards: plain XY, the bump chart (the `plotRanks` option), "Two sheets, one
    //     graph" (a model curve from a second datasheet the card ships, `extraTables`) and
    //     "Time course + bands, window, limit";
    //   - `heatmap`, three cards: the plain matrix, the clustered + split + annotated one and the
    //     bubble-grid heatmap;
    //   - `histogram`, two cards: plain and "Histogram + density";
    //   - `area`, two cards: plain and "Stream graph + event markers".
    // Any other duplicate is an accidental overlap and fails here. The added cards are guarded
    // card by card in gallery-added-cards.test.tsx.
    const dupes = kinds.filter((k, i) => kinds.indexOf(k) !== i).sort();
    expect(dupes).toEqual(["area", "bar", "bar", "bar", "bar", "bar", "bar", "bar", "heatmap", "heatmap", "histogram", "xy", "xy", "xy"]);
    expect(kinds).toEqual(
      expect.arrayContaining(["xy", "area", "bar", "box", "violin", "scatter", "beforeafter", "pie", "heatmap", "survival"]),
    );
  });

  /**
   * Guards against a card opening another card's data: if `pcascore`/`pcaload`/`pcabiplot`/
   * `scree` **and** `roc` pointed at the XY card's table (`xyT`), the "Datasheet" button on the
   * **PCoA / PCA — score plot** card would open an XY *dose-response* sheet ("Dose (µM) · Drug A ·
   * Drug B"). A gallery card's "Datasheet" button opens `plot.source` (`panes.tsx`), so a card
   * that borrows another card's table shows the wrong data. These three checks pin every card to
   * a datasheet of its own.
   */
  it("every card is drawn from the datasheet it ships (plot.source === table.id)", () => {
    for (const it of items) {
      expect(it.plot.source, `${it.key}: plot.source must be the card's own table`).toBe(it.table.id);
    }
  });

  it("analysis-fed cards carry a datasheet of the matching kind (PCA → pca, KM → survival)", () => {
    // Kinds that render from an embedded analysis blob (not the table) still need a datasheet of
    // the kind that analysis runs on — else "open datasheet" shows a meaningless format. The
    // PCA graphs have their own dedicated PCA / ordination format, so their gallery cards use
    // it rather than the generic multivariable sheet.
    const EXPECTED_KIND: Partial<Record<string, TableKind>> = {
      pcascore: "pca",
      pcaload: "pca",
      pcabiplot: "pca",
      scree: "pca",
      survival: "survival",
    };
    for (const it of items) {
      const want = EXPECTED_KIND[it.plot.kind ?? ""];
      if (want) expect(it.table.kind, `${it.key} datasheet kind`).toBe(want);
    }
  });

  it("no card borrows another card's datasheet (except intentional same-data families)", () => {
    // A table may be shared only within one of these families — all are views of one dataset.
    // Any other shared table means a card is opening data that belongs to a different card.
    const SHARE_FAMILIES: string[][] = [
      ["box", "violin", "scatter", "raincloud", "floatingbar", "estimation"], // one distribution dataset
      ["pcaload", "pcabiplot", "scree"], // one PCA: loadings / biplot / scree are three views of it
    ];
    const byTable = new Map<string, string[]>();
    for (const it of items) byTable.set(it.table.id, [...(byTable.get(it.table.id) ?? []), it.key]);
    for (const [tableId, keys] of byTable) {
      if (keys.length < 2) continue;
      const family = SHARE_FAMILIES.find((f) => keys.every((k) => f.includes(k)));
      expect(family, `table ${tableId} shared by [${keys.join(", ")}] — not one same-data family; a card is borrowing another's datasheet`).toBeDefined();
    }
  });

  /**
   * Note: the size here is the size a card is built at. A card is built at the figure size and
   * scaled down by the SVG viewBox, so the card is the real figure; measuring at the 360×250
   * thumbnail size would test a state no user can reach. The collapse test below covers small
   * figures instead, and covers them for every kind rather than only where a card happens to land.
   *
   * Note: a card's own `figureWidth` wins, mirroring `GalleryPane` and `panes.tsx`. The paired
   * dot declares 800 because twelve long row labels do not fit 580.
   */
  it("every item builds a non-empty scene of its declared kind", () => {
    for (const it of items) {
      const scene = buildPlotScene(it.table, it.plot, { width: it.plot.figureWidth ?? FIGURE_DEFAULT_W, height: it.plot.figureHeight ?? FIGURE_DEFAULT_H });
      expect(scene.kind, it.key).toBe(it.plot.kind ?? "xy");
      // each example must actually render *something* (series / slices / cells / curves).
      const hasContent =
        scene.series.length > 0 ||
        (scene.pie?.slices.length ?? 0) > 0 ||
        (scene.heatmap?.cells.length ?? 0) > 0 ||
        (scene.radar?.polygons.length ?? 0) > 0 ||
        (scene.scatter3d?.points.length ?? 0) > 0 ||
        (scene.lollipop?.rows.length ?? 0) > 0 ||
        (scene.paireddot?.rows.length ?? 0) > 0 ||
        (scene.treemap?.cells.length ?? 0) > 0 ||
        (scene.corrmatrix?.cells.length ?? 0) > 0 ||
        (scene.alluvial?.nodes.length ?? 0) > 0 ||
        (scene.network?.nodes.length ?? 0) > 0 ||
        (scene.parallel?.lines.length ?? 0) > 0 ||
        (scene.venn?.circles.length ?? 0) > 0 ||
        (scene.rose?.wedges.some((w) => w.count > 0) ?? false) ||
        (scene.tracks?.strips.some((s) => s.tiles.length > 0) ?? false) ||
        (scene.sunburst?.segments.length ?? 0) > 0 ||
        (scene.chord?.arcs.length ?? 0) > 0 ||
        (scene.oncoprint?.tiles.length ?? 0) > 0;
      expect(hasContent, `${it.key} renders content`).toBe(true);
      expect(scene.warnings, `${it.key} warnings`).toEqual([]);
    }
  });

  /**
   * An axis that is drawn must be named. Guards against gallery cards that draw a bare value
   * axis or a bare category axis (for example graphs with named groups — treatment, low dose,
   * ... — and no X-axis title).
   *
   * Nothing can derive these titles. A builder auto-names the value axis only when there is
   * exactly one series (it borrows that series' name); with two or more it stays blank because
   * the legend names them and a title would have to be invented. The category axis has it worse
   * — on box/violin/scatter the groups come from the Y column names, so that axis has no source
   * column to borrow from at all. Fixtures have to state both.
   *
   * Default-deny, and it keys off the drawn scene: a kind with no axis (pie, treemap, heatmap,
   * network …) draws no ticks and is skipped, so a new chart type is only ever asked to name an
   * axis it actually has.
   */
  it("every card that draws an axis gives it a title", () => {
    const bare: string[] = [];
    for (const it of items) {
      const s = buildPlotScene(it.table, it.plot, { width: it.plot.figureWidth ?? FIGURE_DEFAULT_W, height: it.plot.figureHeight ?? FIGURE_DEFAULT_H });
      const major = (t: { minor?: boolean }[]): number => t.filter((x) => !x.minor).length;
      if (major(s.y.ticks) > 0 && !s.y.title.trim()) bare.push(`${it.key}: Y axis has ${major(s.y.ticks)} ticks and no title`);
      if (major(s.x.ticks) > 0 && !s.x.title.trim()) bare.push(`${it.key}: X axis has ${major(s.x.ticks)} ticks and no title`);
    }
    expect(bare, "a gallery card is the preview of the shipped look — an unnamed axis previews an unnamed axis").toEqual([]);
  });

  /**
   * No kind may collapse on a narrow figure — the plot rect keeps a minimum share of the
   * width, whatever the labels say.
   *
   * Guards against a plot rect with no width: if a row-label band (e.g. "Educational attainment")
   * and a legend band (e.g. "Twin/family (h²)") were both sized by text with neither capped, a
   * paired-dot graph at 360 px would leave a 1-pixel-wide plot rect —
   * `Math.max(1, width - margins)` would swallow the result and draw a graph with no plot area,
   * silently. Any user who sizes a graph narrow would get that figure.
   *
   * The floor is a guard against collapse, not a quality target — a usable chart keeps exactly
   * the look it has, and only the degenerate case is flagged.
   */
  /**
   * The floor is 0.12. The tightest card at this width is ROC, whose legend takes a large
   * share — a chart that is tight, not collapsed, and legible at the size it is drawn at. Capping
   * the legend to raise that share would truncate it to "Biomarker (AU…", dropping the AUC,
   * which the builder tests reject.
   *
   * What this exists to catch is a plot rect that is gone (paired dot at one pixel, 0%). 0.12
   * catches that with a wide margin and does not flag charts that merely want a wider figure.
   */
  /**
   * A graph sized narrow is a scaled copy, not a re-layout (resizing keeps proportions;
   * graphDisplay.ts). The legend stays on the right and every resize scales the whole drawing,
   * so this measures what a user who sizes a graph 360 px wide sees: the graph laid out at its
   * own size, shown at the scale the resize asks for. Out of scope by design: a graph laid out
   * narrower than its text (an old file's saved small size, or a panel with Keep proportions
   * off) - there the plot is squeezed and nothing moves the legend (a fixed rule), and Keep
   * proportions is the answer.
   */
  it("no kind collapses on a narrow figure", () => {
    const COLLAPSE_FLOOR = 0.12;
    const NARROW = 360;
    const thin = items
      .map((it) => {
        const lay = graphLayoutSize(it.plot);
        const s = buildPlotScene(it.table, it.plot, { width: lay.width, height: lay.height });
        // Sizing it narrow is a scale of this drawing - never a re-layout at 360 px.
        const k = scaleForResize(1, { width: s.width, height: s.height }, { figureWidth: NARROW });
        expect(k, `${it.key}: sizing it ${NARROW} px wide did not scale it down`).toBeCloseTo(NARROW / s.width, 6);
        return { key: it.key, share: s.plot.width / s.width, px: Math.round(s.plot.width * k) };
      })
      .filter((r) => r.share < COLLAPSE_FLOOR);
    expect(
      thin.map((r) => `${r.key}: ${r.px}px (${(r.share * 100).toFixed(0)}% of ${NARROW})`),
      "these kinds hand their whole width to labels and leave no room to draw in",
    ).toEqual([]);
  });

  /**
   * A gallery card is a preview — "this is what this chart type looks like here". Guards
   * against a card that applies only the kind-agnostic house preset: the bar card would show
   * 82%-wide bars with 6.5px dots while the bar chart the user then creates comes
   * out at the bar defaults (0.38 width, 14px points). A preview that does not match the result
   * is misleading.
   */
  it("the bar card previews the bar house default, not just the shared preset", () => {
    const bar = items.find((i) => i.key === "bar")!.plot;
    expect(bar.barWidth, "bar width").toBe(0.38);
    const sizes = Object.values(bar.seriesStyles ?? {}).map((s) => s?.symbolSize);
    expect(sizes.length, "no series styles on the bar card").toBeGreaterThan(0);
    for (const s of sizes) expect(s, "data point size").toBe(14);
  });

  /**
   * Bar has no font sizes of its own. The preset sets 26 / 22 / 20 (title / axis title / tick)
   * for all graph types where it applies, and a per-kind override silently beats the preset — so
   * a bar-specific font override would make bar the one type that ignores the rule. This proves
   * the preset reaches bar, which would otherwise break silently.
   */
  it("…and bar takes its type sizes from the house preset like everything else", () => {
    const bar = items.find((i) => i.key === "bar")!.plot;
    expect(bar.fonts?.title?.size, "title size").toBe(26);
    expect(bar.fonts?.axisTitle?.size, "axis title size").toBe(22);
    expect(bar.xAxis?.tickFont?.size ?? bar.fonts?.tick?.size, "category tick font").toBe(20);
    expect(bar.yAxis?.tickFont?.size ?? bar.fonts?.tick?.size, "value tick font").toBe(20);
  });

  /**
   * The bar card showcases within-group significance brackets:
   * Control vs Treated inside each timepoint — cell endpoints (`fromSeries`/`toSeries`),
   * a live p, the planner's own stacked height, no frozen label. "It was accepted" is
   * never "it reached the drawing" — so this rebuilds the scene at the card's own size
   * and counts the brackets that actually placed.
   */
  it("the bar card carries within-group significance brackets that reach the drawing", () => {
    const bar = items.find((i) => i.key === "bar")!;
    const anns = (bar.plot.annotations ?? []).filter((a) => a.kind === "bracket" && a.role === "significance");
    expect(anns.length, "one bracket per timepoint").toBe(3);
    for (const a of anns) {
      expect(a.p, `bracket ${a.id} carries a live p`).toBeGreaterThan(0);
      expect(a.bracketY, `bracket ${a.id} carries the planner's stacked height`).toBeGreaterThan(0);
      // The comparison shown: the two bars inside one timepoint, Control first.
      expect(a.to, `bracket ${a.id} stays inside its timepoint`).toBe(a.from);
      expect(a.fromSeries, `bracket ${a.id} starts on the Control bar`).toBe(1);
      expect(a.toSeries, `bracket ${a.id} ends on the Treated bar`).toBe(2);
    }
    const scene = buildPlotScene(bar.table, bar.plot, { width: bar.plot.figureWidth ?? FIGURE_DEFAULT_W, height: bar.plot.figureHeight ?? FIGURE_DEFAULT_H });
    const placed = scene.annotations.filter((x) => x.kind === "bracket");
    expect(placed.length, "brackets that reached the drawing").toBe(anns.length);
    expect(scene.warnings, "a card previewing a warning is a card previewing a defect").toEqual([]);
  });

  it("…and only the bar card — the XY card gets XY's own 8px markers, never bar's 14", () => {
    // The positive control: layering the per-kind defaults over every card indiscriminately
    // would put 14px dots on the XY scatter, and the bar test above would still pass without
    // this one. 8 is XY's own house default marker size (the shared preset alone gives 6.5).
    const xy = items.find((i) => i.key === "xy")!.plot;
    const sizes = Object.values(xy.seriesStyles ?? {}).map((s) => s?.symbolSize);
    expect(sizes.length, "no series styles on the XY card").toBeGreaterThan(0);
    for (const s of sizes) expect(s, "the XY card inherited the bar marker size").toBe(8);
    expect(xy.barWidth, "the XY card inherited the bar width").toBeUndefined();
  });

  /**
   * One marker size must reach every kind that draws markers.
   *
   * Guards against builders that ignore the marker size: the PCA family, the scree plot,
   * before-after and radar key their points by synthetic ids (`pca-g0`, `pca-loadings`,
   * `scree`, a row id, a radar dataset) that a preset / house default / whole-graph apply never
   * writes to, so each can silently fall back to a private constant (4.5, 4, 3, 3, 2.5) while
   * every other card follows the size.
   *
   * This is default-deny: a kind is either proven to honour the size, or it is listed below
   * with a reason. A new chart type that draws markers and ignores the size lands in neither
   * and fails here. The exempt list is checked in both directions, so a kind that starts
   * honouring the size has to be taken off it rather than left listed.
   */
  const NO_MARKERS: Record<string, string> = {
    pyramid: "mirrored bars — no point markers",
    dendrogram: "a cluster tree — joins, not points",
    pie: "slices", treemap: "cells", heatmap: "cells", heatmapsplit: "cells", bubblegrid: "cells (discs sized by value, not markers)", corrmatrix: "glyphs",
    alluvial: "ribbons", network: "nodes sized by their own control", parallel: "lines",
    scatter3d: "its own projected-point size", ridgeline: "stacked densities — no markers",
    lollipop: "its own LollipopStyle.dotSize control", paireddot: "its own PairedDotStyle.dotSize control",
    survival: "step lines; censor ticks are not markers", roc: "step lines",
    venn: "filled discs, one per set — coloured, not marker-sized",
    upset: "intersection bars + membership dots — coloured, not marker-sized",
    rose: "wedges are bins ramped from the series colour — coloured, not marker-sized",
    tracks: "tile strips — coloured cells, no point markers",
    sunburst: "ring segments — coloured arcs, not point markers",
    chord: "node arcs + ribbons — coloured shapes, not point markers",
    oncoprint: "alteration tiles — coloured cells, not point markers",
  };

  it("a whole-plot marker size reaches every kind that draws markers", () => {
    const sizeOf = (item: (typeof items)[number], size: number): string => {
      const seriesStyles = { ...(item.plot.seriesStyles ?? {}) };
      // Set a whole-plot marker size the way the real apply does — as a symbolSize on the
      // series-bearing columns. x/y-shaped tables carry it on the y columns; a multivariable
      // datasheet (the PCA cards) has role-less variable columns, so inject on those instead —
      // `plotMarkerDefault` scans every series style regardless of key. Without this the PCA
      // cards would look "dead" only because the fixture couldn't reach a role-less table.
      const hasY = item.table.columns.some((c) => c.role === "y" && !c.group);
      for (const c of item.table.columns) {
        const target = hasY ? c.role === "y" && !c.group : c.role !== "x" && !c.group;
        if (target) seriesStyles[c.id] = { ...(seriesStyles[c.id] ?? {}), symbolSize: size };
      }
      const scene = buildPlotScene(item.table, { ...item.plot, seriesStyles }, { width: 360, height: 250 });
      // Radar's vertex dot is a scene-level number, not a per-series one.
      return `${scene.series.map((s) => s.symbolSize).join(",")}|${scene.radar?.dotSize ?? ""}`;
    };
    const dead: string[] = [];
    const staleExemption: string[] = [];
    for (const item of items) {
      const changed = sizeOf(item, 4) !== sizeOf(item, 14);
      if (item.key in NO_MARKERS) {
        if (changed) staleExemption.push(item.key);
      } else if (!changed) {
        dead.push(item.key);
      }
    }
    expect(dead, "these kinds draw markers but ignored the marker size").toEqual([]);
    expect(staleExemption, "these are listed as marker-less but did follow the size — take them off NO_MARKERS").toEqual([]);
  });

  it("the distribution example pools enough values for a box/violin", () => {
    const box = items.find((i) => i.key === "box")!;
    const scene = buildPlotScene(box.table, box.plot, { width: 360, height: 250 });
    expect(scene.series.length).toBe(3); // Control / Low / High groups
    expect(scene.series[0]!.marks[0]!.box).toBeDefined();
  });
});

describe("sampleFor / hasSample — New-graph 'start with sample data'", () => {
  it("returns the gallery example whose key matches a genre", () => {
    expect(sampleFor("xy")?.plot.kind ?? "xy").toBe("xy");
    expect(sampleFor("violin")?.plot.kind).toBe("violin");
  });
  it("the simple 'Bar / column' genre samples simple column data; the grouped genre samples grouped data", () => {
    // The simple column graph must start from simple column data, and the grouped
    // column graph from grouped data. The gallery's own "bar" card is the grouped (two-factor)
    // showcase; the wizard's "bar" genre defaults to a simple column sheet, so it samples the
    // simple-column example, while the "groupedbar" genre samples the grouped showcase.
    const bar = sampleFor("bar");
    expect(bar, "the Bar / column genre lost its sample").toBeTruthy();
    expect(bar!.plot.kind).toBe("bar");
    expect(bar!.table.kind, "the simple column genre got grouped sample data").toBe("column");
    expect(bar!.title).toMatch(/simple column/i);
    expect(hasSample("bar")).toBe(true);
    // The grouped genre gets the grouped showcase (two grouping factors).
    const grouped = sampleFor("groupedbar");
    expect(grouped, "the grouped column genre has no sample").toBeTruthy();
    expect(grouped!.plot.kind).toBe("bar");
    expect(grouped!.table.kind, "the grouped genre did not get grouped sample data").toBe("grouped");
    expect(hasSample("groupedbar")).toBe(true);
  });
  it("the 'Bar / column' genre's sample follows the chosen format — grouped format gives grouped data", () => {
    // Guards against picking the grouped datasheet format + the default "Bar / column"
    // graph + example giving a simple one-bar-per-group sample. The "bar" genre draws both a simple
    // column bar and a two-factor grouped bar, so its example must match the format the user chose.
    expect(sampleFor("bar", "grouped")!.table.kind, "grouped format still sampled simple data").toBe("grouped");
    expect(sampleFor("bar", "column")!.table.kind, "column format sampled grouped data").toBe("column");
    expect(sampleFor("bar", undefined)!.table.kind, "no format should default to the simple column example").toBe("column");
  });
  it("every New-graph genre ships a sample except stacked/contingency", () => {
    const missing = NEW_GRAPH_GENRES.filter((g) => !hasSample(g.key)).map((g) => g.key).sort();
    expect(missing).toEqual(["contingency", "stackedbar"]);
  });
});

/**
 * Clicking a card must give the card, not a graph made from it before the card changed.
 *
 * Guards against reopening by name alone: a Y axis title added to the XY card shows on the
 * card, but a click that reopens an earlier graph of the same name gives a graph with no title.
 * A graph keeps the look it was created with, so the gallery goes stale the moment a default
 * changes, which is exactly when it is being used to check that default.
 */
describe("a stale graph is not what the card shows", () => {
  const xy = (): Plot => galleryItems().find((i) => i.key === "xy")!.plot;

  it("the fixture can exhibit it — the XY card names its Y axis", () => {
    expect(xy().yAxis?.title, "no Y title on the card, so nothing could go stale").toBeTruthy();
  });

  it("an identical graph still counts as the card (no duplicate on a second click)", () => {
    expect(sameGalleryLook(xy(), xy())).toBe(true);
    // Column ids differ after insertGraph, and per-series styles are keyed by them — comparing
    // those would make every click fork a new graph.
    const remapped: Plot = { ...xy(), id: "plt-9", name: "copy", source: "tbl-9", seriesStyles: { "col-99": { color: "#123456" } } };
    expect(sameGalleryLook(remapped, xy()), "fresh column ids were treated as a style change").toBe(true);
  });

  it("a graph without the card's Y axis title does not count as the card", () => {
    const stale: Plot = { ...xy(), yAxis: { ...xy().yAxis, title: undefined } };
    expect(sameGalleryLook(stale, xy()), "the untitled graph passed as the card, so the click would reopen it").toBe(false);
  });

  it("…and neither does a graph the user has edited — their edits stay theirs", () => {
    const edited: Plot = { ...xy(), yAxis: { ...xy().yAxis, title: "My own label" } };
    expect(sameGalleryLook(edited, xy())).toBe(false);
  });

  /**
   * Annotations are part of the look. The bar card carries significance brackets; if
   * `sameGalleryLook` compared `SHARED_KEYS` only, a bar graph made from an earlier, bracket-less
   * card would still count as the card, and the click would reopen a bracket-less
   * graph while the card shows brackets. The XY card's title is compared for the same reason.
   * (Safe to compare: `insertGraph` copies annotations verbatim — ids included — so a fresh
   * copy still matches and a second click cannot fork a duplicate.)
   */
  it("a bar graph without the card's brackets does not count as the card", () => {
    const bar = (): Plot => galleryItems().find((i) => i.key === "bar")!.plot;
    expect(bar().annotations?.length, "no brackets on the card, so nothing could go stale").toBeTruthy();
    const stale: Plot = { ...bar(), annotations: undefined };
    expect(sameGalleryLook(stale, bar()), "the bracket-less graph passed as the card, so the click would reopen it").toBe(false);
  });
});

describe("gallery datasheets carry the correct table kind (no false format warnings)", () => {
  /**
   * Every card is opened as a real editable graph and its datasheet when a user clicks it,
   * so a fixture's `kind` becomes the user's table kind, drives the datasheet's format badge,
   * and is what `validateTable` judges. `mkTable` defaults to "xy"; a categorical-X chart (bar,
   * forest, radar, heatmap, network, …) left at that default is a table claiming to be XY. The
   * warning check below runs every card's table through the same judge the datasheet uses
   * and refuses any warning — for every card, not one.
   *
   * A fixture is a demo the user is shown; a demo that trips the app's own format check
   * suggests MadY mislabels their data.
   */
  /**
   * The same class, measured directly. The warning check cannot catch it: validateTable does not
   * warn about a text X column (it runs while typing, so it cannot tell a curve from a labelled
   * matrix), so a card shipped as "xy" with names in its X column passes that check.
   *
   * The judge is the data, not a message: a table whose X column holds text is not an XY table,
   * whatever it declares. Its format badge would read "XY", and the format is what decides which
   * analyses and chart types the user is offered when they open the card.
   */
  it("a table with a non-numeric X column never claims to be XY", () => {
    const offenders = galleryItems()
      .filter((i) => i.table.kind === "xy")
      .filter((i) => {
        const x = i.table.columns[0];
        if (!x || i.table.rows.length === 0) return false;
        return i.table.rows.every((r) => typeof r.cells[x.id] === "string" && String(r.cells[x.id]).trim() !== "");
      })
      .map((i) => `${i.key}: X is "${i.table.columns[0]!.name}" (text) but the table says kind "xy"`);
    expect(offenders, "these cards would show a false XY format badge on a sheet of names").toEqual([]);
  });

  it("no gallery table produces a validateTable warning", () => {
    const offenders = galleryItems()
      .map((i) => ({ id: i.table.id, key: i.key, kind: i.table.kind, warns: validateTable(i.table) }))
      .filter((o) => o.warns.length > 0);
    expect(offenders, `gallery tables with format warnings:\n${JSON.stringify(offenders, null, 2)}`).toEqual([]);
  });
});

describe("every gallery card's graph has a real title", () => {
  // The card draws the graph's own title above it; a graph named after its internal id
  // ("p-bump") shows that id to the user.
  it("no card's graph is titled with its id", () => {
    const untitled = galleryItems().filter((i) => !i.plot.name || i.plot.name === i.plot.id || /^[pg]-[a-z0-9-]+$/.test(i.plot.name)).map((i) => `${i.key}: "${i.plot.name}"`);
    expect(untitled, "cards whose graph title is an internal id:\n  " + untitled.join("\n  ")).toEqual([]);
  });
});

describe("gallery card titles are distinct", () => {
  // The preset baseline (`preset-invariance.fixtures.json`) is keyed by the graph's title, so two
  // cards with one title would share one entry and one of them would go unchecked.
  it("no two cards' graphs share a title", () => {
    const names = galleryItems().map((i) => i.plot.name);
    const dup = names.filter((n, i) => names.indexOf(n) !== i);
    expect(dup).toEqual([]);
  });
});
