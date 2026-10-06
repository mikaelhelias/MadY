// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildPlotScene } from "@mady/graphics";
import { tableDatasets } from "@mady/core";
import type { Plot } from "@mady/core";
import { galleryItems } from "./gallery";

/**
 * Unticking a series removes it from the drawing.
 *
 * `seriesStyles[id].hidden` is written by the Inspector's series visibility list. Guards against
 * the flag being honoured by the XY path alone, which leaves the series drawn on bar, box,
 * violin, scatter, raincloud, floating bar, estimation, forest, Bland-Altman, pyramid,
 * dendrogram, before-after and ridgeline. The builders filter the datasets at the source
 * (`visibleDatasets`), so the series, the legend and the axis domain are all derived without
 * the hidden one.
 *
 * Note: three groups of kinds are handled differently on purpose:
 *  - `xy` / `area` / `bubble` keep hidden series in the computation so they still feed the
 *    spread band and average line, and drop them at the drawing step (documented in the
 *    builder). They are covered here anyway because the drawing still loses the series.
 *  - `roc` / `survival` key their curves `roc-${i}` / `surv-${i}`, which is exactly what the
 *    Inspector's list writes for them — not a table dataset id.
 *  - `pcascore` / `pcaload` / `pcabiplot` / `triplot` / `scree` / `dendrogram` draw synthetic series and the
 *    Inspector suppresses the visibility list for them (`syntheticSeries`), because a
 *    datasets-keyed list would write keys the builder never reads.
 */
const SIZE = { width: 620, height: 420 };

/**
 * Kinds this guard does not cover, and why. Mirrors `Inspector.showSeriesList` plus the two
 * curve kinds — if that condition changes, this list has to change with it.
 *
 *  - pie · radar · heatmap · corrmatrix · alluvial · network · scatter3d
 *      `showSeriesList` excludes them: there is no visibility list, so nothing writes
 *      `hidden` and its absence from the drawing is correct rather than dead.
 *  - pcascore · pcaload · pcabiplot · triplot · scree · dendrogram
 *      `syntheticSeries` — their series are keyed independently of table datasets, so a
 *      datasets-keyed list would write keys the builder never reads. Suppressed on purpose.
 *  - roc · survival
 *      keyed `roc-${i}` / `surv-${i}`, which is what their list writes. Asserted separately
 *      at the end of this file rather than skipped.
 */
const NO_DATASET_LIST = new Set([
  "pie", "radar", "heatmap", "corrmatrix", "alluvial", "network", "scatter3d",
  "pcascore", "pcaload", "pcabiplot", "triplot", "scree", "dendrogram",
  "roc", "survival",
  // Read their datasets by position (control vs test, left vs right, method A vs B), so a
  // hidden one would renumber the rest and change which data is compared. The builders ignore
  // `hidden` on purpose and `showSeriesList` withholds the list from estimation + pyramid.
  // Bland-Altman keeps a one-entry list under its own synthetic id — asserted at the end.
  // Forest: estimate · lower · upper are positional too — hiding "Lower" would make the
  // whisker's low end the old Upper. The builder ignores `hidden` and the Inspector's list
  // draws no hide box for it (`SeriesVisibilityList noHide`).
  "estimation", "pyramid", "blandaltman", "forest",
  // Funnel: estimate · lower · upper are positional exactly like forest's — hiding
  // "Lower" would re-role the columns. Builder ignores `hidden`, Inspector's list draws
  // no hide box (`noHide`).
  "funnel",
  // Swimmer: dataset[0] is the structural bar Start (positional, like forest's) —
  // its row carries no hide box (the shared core `swimmerColumns` gates it). Event series
  // do hide, honoured by the builder — asserted in swimmer-plot.test.tsx, not here.
  "swimmer",
  // Ternary: the first three datasets are the composition by position (a triangle cannot
  // lose a corner) — hiding would re-role the columns, so the builder ignores `hidden`
  // and the Inspector draws no hide box (noHide).
  "ternary",
  // Rose: angle + magnitude are positional (hiding the angle column is not a drawing);
  // wedges are bins, not series.
  "rose",
  // Tracks: each column is a whole tile strip, not a styled point series — there is no
  // series list, and hiding one is not supported (the builder ignores `hidden`).
  "tracks",
  // QQ: one positional marker series built from the P-value column (the y=x line is chrome);
  // hiding it would empty the plot. The builder draws the single series and the Inspector's
  // list draws no hide box (`noHide`).
  "qq",
  // Manhattan: one positional marker series (−log10 p along the genome; points shaded per
  // chromosome, the ruler + threshold lines are chrome); hiding it would empty the plot, so
  // the builder draws the single series and the Inspector draws no hide box (`noHide`).
  "manhattan",
  // Sunburst: the "series" are the top-level branches, but the drawing is a hierarchy roll-up of
  // all rows — hiding a dataset column is not what selects a branch (branches come from the level
  // column's category values). No per-series hide list; recolour a branch from its Series row.
  "sunburst",
  // Chord: the nodes come from the endpoint columns' values, not from datasets — hiding a data
  // column is not what removes a node. No per-series hide list.
  "chord",
  // Oncoprint: the "series" are the alteration types (from the Alteration column's values), not
  // datasets — hiding a data column is not what removes a type. No per-series hide list.
  "oncoprint",
]);

describe("hiding a series removes it from the drawing", () => {
  const items = galleryItems().filter((i) => {
    const kind = i.plot.kind ?? "xy";
    return !NO_DATASET_LIST.has(kind) && tableDatasets(i.table).length >= 2;
  });

  it("covers a real spread of kinds (guards the guard)", () => {
    expect(items.length, "no gallery kind qualifies — the filter is broken").toBeGreaterThan(8);
  });

  for (const item of items) {
    const kind = item.plot.kind ?? "xy";
    it(`${kind}: unticking the first series changes the drawing`, () => {
      const id = tableDatasets(item.table)[0]!.id;
      const shown = buildPlotScene(item.table, item.plot, SIZE);
      const hidden = buildPlotScene(
        item.table,
        { ...item.plot, seriesStyles: { ...(item.plot.seriesStyles ?? {}), [id]: { ...(item.plot.seriesStyles?.[id] ?? {}), hidden: true } } } as Plot,
        SIZE,
      );
      expect(
        JSON.stringify(hidden),
        `${kind}: the series visibility checkbox writes seriesStyles.hidden and the drawing ignored it`,
      ).not.toEqual(JSON.stringify(shown));
    });
  }

  it("bland-altman honours it under the synthetic id its own list writes", () => {
    const item = galleryItems().find((g) => g.plot.kind === "blandaltman")!;
    const ds = tableDatasets(item.table);
    const key = (ds.length >= 2 ? ds[1]!.id : ds[0]!.id);
    const on = buildPlotScene(item.table, { ...item.plot, legend: { show: true } } as Plot, SIZE);
    const off = buildPlotScene(item.table, { ...item.plot, legend: { show: true }, seriesStyles: { [key]: { hidden: true } } } as Plot, SIZE);
    expect(off.legend.length, "hiding the Difference series must clear its legend entry").toBeLessThan(on.legend.length);
  });

  it("roc / survival honour it under the ids the Inspector actually writes", () => {
    for (const [kind, key] of [["roc", "roc-0"], ["survival", "surv-0"]] as const) {
      const item = galleryItems().find((g) => (g.plot.kind ?? "xy") === kind)!;
      const a = buildPlotScene(item.table, item.plot, SIZE).series.length;
      const b = buildPlotScene(item.table, { ...item.plot, seriesStyles: { ...(item.plot.seriesStyles ?? {}), [key]: { hidden: true } } } as Plot, SIZE).series.length;
      expect(b, `${kind}: hiding ${key} left the curve drawn`).toBeLessThan(a);
    }
  });
});
