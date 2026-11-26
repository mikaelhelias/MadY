/**
 * Graph suggestions × dataset types — the exhaustive check.
 *
 * Guards against a pre-selected graph that cannot draw its sheet (e.g. an edge list or a
 * genes × conditions matrix, both stored as `xy`, landing on an XY scatter that warns
 * "No finite data points").
 *
 * The oracle is the builder: a suggestion is acceptable when the kind draws the sheet without
 * a warning (the builders say out loud when they cannot place what they were given). Three
 * populations, all real data:
 *   1. every table of the sample project (what the user meets first);
 *   2. every gallery card's table — a representative data shape for each chart kind — where
 *      the card's own kind is the graph the gallery pairs with that data, so it must at least
 *      be offered and clean;
 *   3. every table format × its seed shape (blank sheets: the format-level default must not
 *      warn on the format's own seed columns once a couple of rows are in).
 */
import { describe, expect, it } from "vitest";
import { createSampleDocument, MadyDocument, TABLE_FORMAT_ORDER, tableFormat } from "@mady/core";
import type { DataTable, TableKind } from "@mady/core";
import { galleryItems } from "./gallery";
import { buildPlotScene } from "@mady/graphics";
import { dataAwareFirst, drawsCleanly, genreByKey, hasInk, NEW_GRAPH_GENRES, RANK_ROW_CAP, suggestedGenres } from "./newGraph";

const sample = createSampleDocument().toJSON();

/**
 * A Kaplan-Meier graph is drawn from an analysis result (`plot.survival`), not from the sheet
 * directly, so on a bare survival sheet the only genre the format has warns "No survival curves
 * to plot" until Analyze → Survival is run. That warning is the correct state, not a wrong
 * suggestion — the survival format has exactly one genre, so its first suggestion is excused
 * here because it hands over to Analyze.
 */
// (PCA score/loadings/biplot/scree and ROC are also wizard entries that hand over to Analyze —
// `genre.analysis`; the same exemption applies to all of them.)
const cleanOrExcused = (t: DataTable, first: { key: string; plotKind: string; analysis?: string }): boolean =>
  drawsCleanly(t, first as never) || !!first.analysis;

describe("1. the sample project — the pre-selected suggestion draws every sheet cleanly", () => {
  for (const t of sample.tables) {
    it(`${t.name} [${t.kind}] → ${suggestedGenres(t.kind, t)[0]?.key}`, () => {
      const [first] = suggestedGenres(t.kind, t);
      expect(first, "no compatible genre at all").toBeDefined();
      expect(cleanOrExcused(t, first!), `${t.name}: the pre-selected "${first!.key}" cannot draw it cleanly`).toBe(true);
    });
  }

  it("the two text-X xy sheets get the data-aware answer, not a scatter", () => {
    const gene = sample.tables.find((t) => t.name === "Gene expression")!;
    const net = sample.tables.find((t) => t.name === "Immune signaling")!;
    expect(dataAwareFirst(gene)).toEqual(["heatmap"]);
    expect(dataAwareFirst(net)).toEqual(["network"]);
    expect(suggestedGenres("xy", gene)[0]!.key).toBe("heatmap");
    expect(suggestedGenres("xy", net)[0]!.key).toBe("network");
    // …and a numeric-X xy sheet is untouched: XY first, no data-aware override.
    const dose = sample.tables.find((t) => t.name.startsWith("Sample"))!;
    expect(dataAwareFirst(dose)).toEqual([]);
    expect(suggestedGenres("xy", dose)[0]!.key).toBe("xy");
  });

  it("the PCA sheet leads with the PCA score plot (PCA-only format)", () => {
    // The Cell-profiling demo uses the dedicated PCA / ordination format: it offers only the
    // PCA graphs, score plot first. The score plot is analysis-fed, so it is
    // the pre-selected suggestion even though it draws nothing until Analyze ▸ PCA runs — the
    // wizard hands off to Analyze rather than an empty frame.
    const cells = sample.tables.find((t) => t.name.startsWith("Cell profiling"))!;
    expect(cells.kind).toBe("pca");
    const keys = suggestedGenres("pca", cells).map((g) => g.key);
    expect(keys).toEqual(["pcascore", "pcabiplot", "triplot", "pcaload", "scree"]);
  });
});

describe("2. every gallery table — the card's own kind is offered and clean, and the first suggestion is clean", () => {
  const seen = new Set<string>();
  for (const g of galleryItems()) {
    const kind = g.plot.kind ?? "xy";
    const key = `${g.table.kind}:${kind}:${g.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const genresOfKind = NEW_GRAPH_GENRES.filter((x) => x.plotKind === kind);
    if (genresOfKind.length === 0) continue; // a kind the wizard does not offer at all (analysis-spawned kinds)
    it(`${g.title} [${g.table.kind} → ${kind}]`, () => {
      const ranked = suggestedGenres(g.table.kind, g.table);
      const [first] = ranked;
      expect(first, `${g.title}: no genre is compatible with a ${g.table.kind} table`).toBeDefined();
      // Either the pre-selection draws the card's data, or no offered genre does (then the format
      // order stands and the first one says so with its warning). Note: the second case is real:
      // the alluvial card is three text columns stamped `xy` — its own kind is not offered for
      // xy, and without the ink rule the pre-selection there would be Before-after: no warning,
      // and an empty frame.
      // (Network is never built for ranking — its clean flag is `dataAwareFirst`'s verdict.)
      // Analysis-fed genres are never "clean" for the rank (they draw nothing until Analyze
      // runs), so they cannot be what makes a sheet drawable here.
      const rankClean = (x: (typeof ranked)[number]): boolean => (x.analysis ? false : x.key === "network" ? dataAwareFirst(g.table).includes("network") : drawsCleanly(g.table, x));
      const anyClean = ranked.some(rankClean);
      if (anyClean) expect(rankClean(first!), `${g.title}: pre-selected "${first!.key}" warns on the card's own data`).toBe(true);
      else expect(ranked.map((x) => x.key), `${g.title}: nothing draws it, so the format order must stand`).toEqual(suggestedGenres(g.table.kind).map((x) => x.key));
      /**
       * The card's kind is the graph the gallery pairs with this data, so where the wizard offers it
       * for this format it must be in the list and clean. Note: many gallery cards feed a
       * categorical kind (bar, box, pie, radar…) from a table stamped `xy` — the gallery uses
       * `xy` as a catch-all — while the wizard, by design, offers those kinds for the column /
       * grouped / parts-of-whole formats a user would enter such data in. That is a format-model
       * decision (the Chart-type control still switches any graph's kind), not a wrong
       * suggestion, so those pairs are measured on the "draws cleanly" half only.
       */
      const offeredForFormat = genresOfKind.some((x) => x.formats.includes(g.table.kind));
      if (offeredForFormat) {
        const own = ranked.find((x) => x.plotKind === kind);
        expect(own, `${g.title}: the gallery's own kind "${kind}" is not offered for a ${g.table.kind} sheet`).toBeDefined();
        expect(cleanOrExcused(g.table, own!), `${g.title}: the gallery's own kind "${kind}" warns on the card's own data`).toBe(true);
      }
    });
  }
});

describe("3. every table format — the format-level default draws its own seed shape", () => {
  const KINDS = TABLE_FORMAT_ORDER as readonly TableKind[];
  for (const kind of KINDS) {
    it(`${kind}: seed columns + a few numeric rows → "${suggestedGenres(kind)[0]?.key}" draws without a warning`, () => {
      const doc = new MadyDocument();
      const fmt = tableFormat(kind);
      const t = doc.addTable("T", kind, [...fmt.seedColumns]);
      // Fill: first column a label (or number for xy/survival time), the rest small numbers.
      const table = doc.toJSON().tables[0]!;
      const isLead = (i: number): boolean => i === 0 && kind !== "multivariable";
      for (let r = 0; r < 4; r++) {
        doc.addRow(t.id, table.columns.map((_c, i) => (isLead(i) ? (kind === "xy" || kind === "survival" ? r + 1 : `Row ${r + 1}`) : (r + 1) * (i + 1))));
      }
      const filled = doc.toJSON().tables[0]!;
      const [first] = suggestedGenres(kind, filled);
      expect(first).toBeDefined();
      expect(cleanOrExcused(filled, first!), `${kind}: "${first!.key}" warns on the format's own seed shape`).toBe(true);
    });
  }
});

describe("the ranking rules themselves", () => {
  it("a genre that warns on the sheet is ranked behind one that does not, but never dropped", () => {
    const dose = sample.tables.find((t) => t.name.startsWith("Sample"))!;
    const ranked = suggestedGenres("xy", dose);
    // Network is never built for ranking (its force layout is the whole cost); its
    // clean flag is `dataAwareFirst`'s verdict, and the dose sheet is not an edge list.
    expect(dataAwareFirst(dose)).toEqual([]);
    const cleanFlags = ranked.map((g) => (g.key === "network" ? false : drawsCleanly(dose, g)));
    // Once a warned genre appears, no clean one follows it.
    const firstWarned = cleanFlags.indexOf(false);
    if (firstWarned >= 0) expect(cleanFlags.slice(firstWarned).every((c) => !c)).toBe(true);
    // Everything compatible is still there — ranking is not filtering.
    expect(ranked.length).toBe(NEW_GRAPH_GENRES.filter((g) => g.formats.includes("xy")).length);
    // Concretely: bubble warns (needs a size column) on the dose sheet, so it trails xy.
    expect(ranked.findIndex((g) => g.key === "bubble")).toBeGreaterThan(ranked.findIndex((g) => g.key === "xy"));
  });

  it("without a table, the order is the format order (no data to rank by)", () => {
    expect(suggestedGenres("xy").map((g) => g.key)[0]).toBe("xy");
    expect(suggestedGenres("multivariable").map((g) => g.key).slice(0, 2)).toEqual(["parallel", "corrmatrix"]);
  });

  it("heatmap is offered for xy sheets, never the format-level default, first for a text-X matrix", () => {
    expect(genreByKey("heatmap")!.formats).toContain("xy");
    const keys = suggestedGenres("xy").map((g) => g.key);
    expect(keys[0]).toBe("xy");
    expect(keys).toContain("heatmap");
    const matrix: DataTable = {
      id: "m", kind: "xy", name: "M",
      columns: [{ id: "g", name: "Gene" }, { id: "a", name: "A" }, { id: "b", name: "B" }],
      rows: [{ id: "1", cells: { g: "G1", a: 1, b: 2 } }, { id: "2", cells: { g: "G2", a: 3, b: 4 } }],
    };
    expect(suggestedGenres("xy", matrix)[0]!.key).toBe("heatmap");
  });
});

/**
 * The rank must require ink, not just "no warning"; a heatmap is a matrix, so repeated X labels
 * (long format) must not promote it; ranking must not build every genre on the whole sheet.
 */
describe("the ranking rules — ink, long-format data, and speed", () => {
  const textRows = (ids: string[], n = 3) => Array.from({ length: n }, (_, i) => ({ id: `r${i}`, cells: Object.fromEntries(ids.map((c) => [c, `${c}${i}`])) }));
  const scene = (t: DataTable, key: string) => buildPlotScene(t, { id: "p", name: "p", source: t.id, kind: genreByKey(key)!.plotKind } as never, { width: 600, height: 400 });

  it("hasInk: a warning-free scene with nothing placed is not ink (before-after / heatmap on an all-text xy sheet)", () => {
    const allText: DataTable = { id: "a", kind: "xy", name: "A", columns: [{ id: "x", name: "X" }, { id: "y", name: "Y1" }, { id: "z", name: "Y2" }], rows: textRows(["x", "y", "z"]) };
    for (const key of ["beforeafter", "heatmap"]) {
      const sc = scene(allText, key);
      // The build choke point warns when a sheet with data yields no ink ("Nothing to draw"),
      // so this fixture is not silent — and the ink rule must hold on its own, independent of
      // that warning (a builder that both warns and draws nothing is still not ink).
      expect(sc.warnings ?? [], `${key}: an empty frame drew in silence`).toEqual([expect.stringMatching(/Nothing to draw/)]);
      expect(hasInk(sc), `${key}: an empty frame counted as ink`).toBe(false);
      expect(drawsCleanly(allText, genreByKey(key)!), `${key} ranked as "draws cleanly" with nothing on the page`).toBe(false);
    }
    // …and a real drawing is ink.
    const dose = sample.tables.find((t) => t.name.startsWith("Sample"))!;
    expect(hasInk(scene(dose, "xy"))).toBe(true);
    expect(hasInk(scene(sample.tables.find((t) => t.name === "Gene expression")!, "heatmap"))).toBe(true);
    expect(hasInk(scene(sample.tables.find((t) => t.name.startsWith("Cell profiling"))!, "corrmatrix"))).toBe(true);
  });

  it("an all-text 3-column xy sheet does not pre-select before-after (nothing draws it → format order, xy first)", () => {
    const allText: DataTable = { id: "a", kind: "xy", name: "A", columns: [{ id: "x", name: "X" }, { id: "y", name: "Y1" }, { id: "z", name: "Y2" }], rows: textRows(["x", "y", "z"]) };
    const ranked = suggestedGenres("xy", allText);
    expect(ranked[0]!.key).not.toBe("beforeafter");
    // Either the first suggestion really draws it, or no genre does and the format order stands.
    if (drawsCleanly(allText, ranked[0]!)) expect(hasInk(scene(allText, ranked[0]!.key))).toBe(true);
    else expect(ranked.map((g) => g.key)).toEqual(suggestedGenres("xy").map((g) => g.key));
  });

  it("an all-text multivariable sheet does not pre-select a correlation matrix or a heatmap (null cells are not ink)", () => {
    const mv: DataTable = { id: "m", kind: "multivariable", name: "M", columns: [{ id: "x", name: "V1" }, { id: "y", name: "V2" }, { id: "z", name: "V3" }], rows: textRows(["x", "y", "z"]) };
    const first = suggestedGenres("multivariable", mv)[0]!.key;
    expect(["corrmatrix", "heatmap"]).not.toContain(first);
    expect(drawsCleanly(mv, genreByKey("corrmatrix")!)).toBe(false);
    expect(drawsCleanly(mv, genreByKey("heatmap")!)).toBe(false);
  });

  it("a 0-row sheet keeps the format order (nothing has ink, nothing is promoted)", () => {
    const zero: DataTable = { id: "z", kind: "xy", name: "Z", columns: [{ id: "x", name: "X" }, { id: "y", name: "Y1" }], rows: [] };
    expect(suggestedGenres("xy", zero).map((g) => g.key)).toEqual(suggestedGenres("xy").map((g) => g.key));
    for (const g of suggestedGenres("xy", zero)) expect(drawsCleanly(zero, g), `${g.key} counted as clean on 0 rows`).toBe(false);
  });

  it("dataAwareFirst promotes heatmap only for unique text X labels — repeated labels are long-format data", () => {
    const rows = (locs: string[]) => locs.map((loc, i) => ({ id: `r${i}`, cells: { loc, cases: i * 10, deaths: i } }));
    const cols = [{ id: "loc", name: "location" }, { id: "cases", name: "cases" }, { id: "deaths", name: "deaths" }];
    const long: DataTable = { id: "l", kind: "xy", name: "covid", columns: cols, rows: rows(["France", "France", "France", "Spain", "Spain", "Spain"]) };
    expect(dataAwareFirst(long)).toEqual([]);
    expect(suggestedGenres("xy", long)[0]!.key).not.toBe("heatmap");
    const matrix: DataTable = { ...long, id: "m", rows: rows(["France", "Spain", "Italy"]) };
    expect(dataAwareFirst(matrix)).toEqual(["heatmap"]);
    expect(suggestedGenres("xy", matrix)[0]!.key).toBe("heatmap");
  });

  it("ranks a 5,000-row xy sheet in well under 1.5 s and still puts XY first", () => {
    const rows = Array.from({ length: 5000 }, (_, i) => ({ id: `r${i}`, cells: { x: i, y: Math.sin(i / 50) * 10 + (i % 7) } }));
    const big: DataTable = { id: "b", kind: "xy", name: "Big", columns: [{ id: "x", name: "X" }, { id: "y", name: "Y1" }], rows };
    const t0 = performance.now();
    const ranked = suggestedGenres("xy", big);
    const ms = performance.now() - t0;
    expect(ms, `ranking took ${ms.toFixed(0)} ms`).toBeLessThan(1500);
    expect(ranked[0]!.key).toBe("xy");
    // The clean-rank is a look at the head, not a render of everything: network's force layout
    // is never built for ranking, and the head is capped.
    expect(RANK_ROW_CAP).toBe(200);
    // Bubble still trails (it needs a size column) — the capped head keeps the ranking correct.
    expect(ranked.findIndex((g) => g.key === "bubble")).toBeGreaterThan(ranked.findIndex((g) => g.key === "xy"));
  });
});
