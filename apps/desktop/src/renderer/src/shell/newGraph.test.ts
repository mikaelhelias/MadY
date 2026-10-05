// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createSampleDocument, MadyDocument, replicateCount, TABLE_FORMAT_ORDER, TABLE_FORMATS, tableDatasets, tableEntryMode, tableFormat, xColumn } from "@mady/core";
import type { Project, TableKind } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { createNewGraph, defaultFormat, fileCreatedGraph, genreByKey, NEW_GRAPH_GENRES } from "./newGraph";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { METHOD_GROUPS } from "./analysis";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../../../..");
const METHOD_IDS = new Set(METHOD_GROUPS.flatMap((g) => g.methods));

function emptyDoc(): MadyDocument {
  const project: Project = {
    schemaVersion: 4,
    tables: [],
    plots: [],
    analyses: [],
    log: [],
    workspace: { folders: [], loose: [] },
  };
  return new MadyDocument(project);
}

/** Read the created plot back out of the document (source of truth). */
function plotOf(doc: MadyDocument, id: string) {
  return doc.toJSON().plots.find((p) => p.id === id)!;
}

describe("NEW_GRAPH_GENRES catalog", () => {
  it("every genre is well-formed and its formats are real, compatible table kinds", () => {
    const keys = new Set<string>();
    for (const g of NEW_GRAPH_GENRES) {
      expect(g.key).toBeTruthy();
      expect(keys.has(g.key)).toBe(false); // unique keys
      keys.add(g.key);
      expect(g.plotKind).toBeTruthy();
      expect(g.formats.length).toBeGreaterThan(0);
      // Each declared format must be a genuine TableKind (has format metadata).
      for (const f of g.formats) expect(tableFormat(f)).toBeTruthy();
      // The best (default) format is the first declared.
      expect(defaultFormat(g)).toBe(g.formats[0]);
    }
  });
  it("genreByKey resolves known genres and returns undefined otherwise", () => {
    expect(genreByKey("xy")?.plotKind).toBe("xy");
    expect(genreByKey("pie")?.formats).toContain("partsofwhole");
    expect(genreByKey("nope")).toBeUndefined();
  });
  it("bubble defaults to an XY table (its builder needs an x column, which a multivariable sheet lacks)", () => {
    expect(defaultFormat(genreByKey("bubble")!)).toBe("xy");
    const { table } = createNewGraph(emptyDoc(), { genre: "bubble", tableKind: "xy" });
    expect(table.kind).toBe("xy");
    expect(xColumn(table)).toBeTruthy(); // the bubble/XY builder returns empty without an x column
  });
  // Guards against TABLE_FORMATS.partsofwhole advertising a "Stacked-bar composition"
  // graph with no genre to render it (no NEW_GRAPH_GENRE lists partsofwhole for a bar).
  it("parts-of-whole advertises only reachable graphs — no orphan 'Stacked-bar composition'", () => {
    const powGraphs = tableFormat("partsofwhole").graphs;
    // Pie + Doughnut are both served by the `pie` genre (doughnut is a pie option).
    expect(powGraphs).toEqual(["Pie", "Doughnut"]);
    expect(NEW_GRAPH_GENRES.some((g) => g.formats.includes("partsofwhole"))).toBe(true);
    // No genre renders a parts-of-whole bar, so the stacked-bar composition must not be advertised.
    expect(powGraphs).not.toContain("Stacked-bar composition");
    expect(NEW_GRAPH_GENRES.some((g) => g.formats.includes("partsofwhole") && g.plotKind === "bar")).toBe(false);
  });

  // The contingency genre creates grouped bars of counts, so its note says counts only, not
  // "counts / proportions" (a 100% stacked layout is a separate bar option).
  it("the contingency genre note describes what it creates (counts, not proportions)", () => {
    const contingency = genreByKey("contingency")!;
    expect(contingency.plotKind).toBe("bar");
    expect(contingency.note.toLowerCase()).not.toMatch(/proportion|percent|%/);
  });

  it("keeps every graph type in one flat list (no separate category)", () => {
    const keys = NEW_GRAPH_GENRES.map((g) => g.key);
    // The specialty genres sit alongside all the others in a single list.
    expect(keys).toEqual(expect.arrayContaining(["radar", "scatter3d", "ridgeline", "lollipop", "raincloud", "pyramid"]));
    // No genre carries a category flag.
    expect(NEW_GRAPH_GENRES.every((g) => !("beyond" in g))).toBe(true);
  });
});

describe("createNewGraph — builds the seed table + plot via the real document methods", () => {
  it("sourceTableId: graphs the existing sheet — no new table, the plot filed beside its source, the data drawn", () => {
    // The sample "Cell profiling (PCA demo)" multivariable sheet + Heatmap.
    const doc = new MadyDocument(createSampleDocument().toJSON());
    const before = doc.toJSON();
    const src = before.tables.find((t) => t.name.startsWith("Cell profiling"))!;
    const { table, plot } = createNewGraph(doc, { genre: "heatmap", tableKind: "multivariable", sourceTableId: src.id });
    const after = doc.toJSON();
    expect(after.tables.length, "must not create a datasheet").toBe(before.tables.length);
    expect(table.id).toBe(src.id);
    expect(plotOf(doc, plot!.id).kind).toBe("heatmap");
    expect(plotOf(doc, plot!.id).source).toBe(src.id);
    // Filed where the sheet is (the demo experiment), not loose at the top level.
    expect(doc.locationOf({ kind: "plot", id: plot!.id })).toEqual(doc.locationOf({ kind: "table", id: src.id }));
    // …and it draws: 18 rows of cells, not an empty frame.
    const scene = buildPlotScene(src, plotOf(doc, plot!.id), { width: 600, height: 400 });
    expect(scene.heatmap?.cells.length).toBeGreaterThan(0);
  });

  it("sourceTableId on a summary sheet writes only an error type the sheet can draw", () => {
    const doc = new MadyDocument(createSampleDocument().toJSON());
    const src0 = doc.toJSON().tables.find((t) => t.name === "Replicate readouts")!;
    doc.setEntryMode(src0.id, "median-iqr");
    const src = doc.toJSON().tables.find((t) => t.id === src0.id)!;
    const { plot } = createNewGraph(doc, { genre: "bar", tableKind: "column", sourceTableId: src.id, errorBars: "sd" });
    const p = plotOf(doc, plot!.id);
    for (const ds of tableDatasets(src)) {
      const t = p.seriesStyles?.[ds.id]?.errorBars;
      expect(t === undefined || t === "iqr", `${ds.name}: stamped "${t}" on a Median+IQR sheet`).toBe(true);
    }
    // …and the drawing carries no "can't be computed" warning.
    const scene = buildPlotScene(src, p, { width: 600, height: 400 });
    expect(scene.warnings.filter((w) => /can.t be computed|No error bars/i.test(w))).toEqual([]);
  });

  /**
   * Default-deny: every chart kind the program can draw is in the wizard, as is every
   * dataset type. The genre list is hand-written, so this compares it with the PlotKind union:
   * a new PlotKind fails here until it has a genre (or a written exemption).
   */
  it("every PlotKind has a wizard genre (default-deny), and every table format is offered", () => {
    const model = readFileSync(join(ROOT, "packages/core/src/model.ts"), "utf8");
    // The union spans many lines with doc comments (some containing ";"), so read it line by
    // line: from the header until the first line that is neither a `| "kind"` member nor a comment.
    const start = model.indexOf("export type PlotKind =");
    expect(start, "PlotKind union not found — update this walker, do not delete the test").toBeGreaterThan(0);
    const kinds: string[] = [];
    for (const line of model.slice(start).split(/\r?\n/).slice(1)) {
      const mm = /^\s*\|\s*"([a-z0-9]+)"/.exec(line);
      if (mm) { kinds.push(mm[1]!); continue; }
      if (/^\s*(\/\*\*|\*|\/\/)/.test(line) || line.trim() === "") continue;
      break;
    }
    expect(kinds.length).toBeGreaterThan(30);
    const EXEMPT: Record<string, string> = { image: "a picture panel, not a chart — added from a file, not from a datasheet" };
    const offered = new Set(NEW_GRAPH_GENRES.map((g) => g.plotKind));
    const missing = kinds.filter((k) => !offered.has(k as never) && !EXEMPT[k]);
    expect(missing, `chart kinds with no wizard entry: ${missing.join(", ")}`).toEqual([]);
    for (const k of Object.keys(EXEMPT)) expect(kinds).toContain(k); // no stale exemption
    // …and every datasheet format has at least one graph.
    for (const f of TABLE_FORMAT_ORDER) expect(NEW_GRAPH_GENRES.some((g) => g.formats.includes(f)), `format "${f}" has no graph in the wizard`).toBe(true);
  });

  it("analysis-fed genres name a real analysis method, and create() with a sheet hands over instead of drawing an empty frame", () => {
    const fed = NEW_GRAPH_GENRES.filter((g) => g.analysis);
    // triplot is fed by a redundancy analysis, which is what supplies the explanatory
    // arrows — the wizard hands over to Analyze rather than drawing an empty frame.
    expect(fed.map((g) => g.plotKind).sort()).toEqual(["pcabiplot", "pcaload", "pcascore", "roc", "scree", "survival", "triplot"]);
    for (const g of fed) expect(METHOD_IDS.has(g.analysis!), `${g.key}: analysis "${g.analysis}" is not a method`).toBe(true);
    // Without a sheet: only the datasheet is made (no empty PCA/ROC/KM plot).
    const doc = emptyDoc();
    const { table, plot } = createNewGraph(doc, { genre: "pcascore", tableKind: "multivariable", analysis: "pca" });
    expect(table.kind).toBe("multivariable");
    expect(plot).toBeUndefined();
    expect(doc.toJSON().plots).toHaveLength(0);
  });

  it("XY with replicates: seeds an XY table, expands replicate subcolumns, sets the plot kind + error bars", () => {
    const doc = emptyDoc();
    const { table, plot } = createNewGraph(doc, { genre: "xy", tableKind: "xy", replicates: 3, errorBars: "sem" });
    expect(table.kind).toBe("xy");
    expect(plotOf(doc, plot!.id).kind).toBe("xy");
    // Y1 expanded to 3 replicate subcolumns.
    const ds = tableDatasets(table);
    expect(ds).toHaveLength(1);
    expect(ds[0]!.replicates).toHaveLength(3);
    // Error-bar display type applied to the dataset series.
    expect(plotOf(doc, plot!.id).seriesStyles?.[ds[0]!.id]?.errorBars).toBe("sem");
    // No rows — a blank datasheet ready for entry.
    expect(table.rows).toHaveLength(0);
  });

  it("Column bar: a non-replicate format skips subcolumn expansion but still sets error bars on every dataset", () => {
    const doc = emptyDoc();
    const { table, plot } = createNewGraph(doc, { genre: "bar", tableKind: "column", errorBars: "sd" });
    expect(table.kind).toBe("column");
    expect(plotOf(doc, plot!.id).kind).toBe("bar");
    const ds = tableDatasets(table);
    expect(ds.length).toBeGreaterThanOrEqual(2); // Control + Treated
    for (const d of ds) expect(plotOf(doc, plot!.id).seriesStyles?.[d.id]?.errorBars).toBe("sd");
  });

  it("Grouped/stacked bars apply the bar-layout plot patch", () => {
    const doc = emptyDoc();
    const g = createNewGraph(doc, { genre: "groupedbar", tableKind: "grouped" });
    expect(plotOf(doc, g.plot!.id).kind).toBe("bar");
    expect(plotOf(doc, g.plot!.id).barLayout).toBe("grouped");
    const s = createNewGraph(doc, { genre: "stackedbar", tableKind: "grouped" });
    expect(plotOf(doc, s.plot!.id).barLayout).toBe("stacked");
  });

  it("a summary entry mode adds the error columns and implies the matching error-bar type", () => {
    const doc = emptyDoc();
    const { table, plot } = createNewGraph(doc, { genre: "bar", tableKind: "grouped", entryMode: "mean-sem-n" });
    // The grouped (replicate-capable) format materialised SEM + N columns.
    expect(table.columns.some((c) => c.role === "sem")).toBe(true);
    const ds = tableDatasets(table);
    expect(plotOf(doc, plot!.id).seriesStyles?.[ds[0]!.id]?.errorBars).toBe("sem");
  });

  it("a non-error genre (pie) sets no error-bar style", () => {
    const doc = emptyDoc();
    const { table, plot } = createNewGraph(doc, { genre: "pie", tableKind: "partsofwhole" });
    expect(table.kind).toBe("partsofwhole");
    expect(plotOf(doc, plot!.id).kind).toBe("pie");
    expect(plotOf(doc, plot!.id).seriesStyles ?? {}).toEqual({});
  });

  // Area is errorCapable: the builder draws mean±error (bars or a band) on an area chart with
  // replicates, so the New-Graph dialog offers the type and createNewGraph must stamp it.
  it("Area honours the chosen error-bar type on its dataset", () => {
    const doc = emptyDoc();
    const { table, plot } = createNewGraph(doc, { genre: "area", tableKind: "xy", replicates: 3, errorBars: "ci95" });
    expect(plotOf(doc, plot!.id).kind).toBe("area");
    const ds = tableDatasets(table);
    expect(plotOf(doc, plot!.id).seriesStyles?.[ds[0]!.id]?.errorBars).toBe("ci95");
  });

  // Bubble is errorCapable: the builder draws mean±error T-bars on the position series, and the
  // Inspector exposes the type — so the dialog must offer it and stamp it too.
  it("Bubble honours the chosen error-bar type on its position series", () => {
    const doc = emptyDoc();
    const { table, plot } = createNewGraph(doc, { genre: "bubble", tableKind: "xy", replicates: 3, errorBars: "sem" });
    expect(plotOf(doc, plot!.id).kind).toBe("bubble");
    const ds = tableDatasets(table);
    expect(plotOf(doc, plot!.id).seriesStyles?.[ds[0]!.id]?.errorBars).toBe("sem");
  });

  // Floating bars reuse boxWhisker to set what the bar spans (min→max / percentiles / mean±err),
  // so the dialog's "Bar spans" choice must be stamped onto the plot.
  it("Floating bar stamps the chosen span definition (boxWhisker)", () => {
    const doc = emptyDoc();
    const { plot } = createNewGraph(doc, { genre: "floatingbar", tableKind: "column", boxWhisker: "p10_90" });
    expect(plotOf(doc, plot!.id).kind).toBe("floatingbar");
    expect(plotOf(doc, plot!.id).boxWhisker).toBe("p10_90");
  });

  // Lollipop error bars are opt-in: "none" (the default) stamps nothing; an explicit type stamps it.
  it("Lollipop error bars: 'none' stamps nothing, an explicit type stamps every dataset", () => {
    const offDoc = emptyDoc();
    const offRes = createNewGraph(offDoc, { genre: "lollipop", tableKind: "column", errorBars: "none" });
    for (const d of tableDatasets(offRes.table)) {
      expect(plotOf(offDoc, offRes.plot!.id).seriesStyles?.[d.id]?.errorBars).toBeUndefined();
    }
    const onDoc = emptyDoc();
    const onRes = createNewGraph(onDoc, { genre: "lollipop", tableKind: "column", errorBars: "sem" });
    expect(plotOf(onDoc, onRes.plot!.id).kind).toBe("lollipop");
    for (const d of tableDatasets(onRes.table)) {
      expect(plotOf(onDoc, onRes.plot!.id).seriesStyles?.[d.id]?.errorBars).toBe("sem");
    }
  });

  it("output 'table' creates a bare datasheet with no plot (the same as New datasheet)", () => {
    const doc = emptyDoc();
    // Genre-less table-only: just the chosen format's seed columns, no graph.
    const { table, plot } = createNewGraph(doc, { output: "table", tableKind: "column" });
    expect(plot).toBeUndefined();
    expect(doc.toJSON().plots).toHaveLength(0);
    expect(table.kind).toBe("column");
    expect(table.columns.map((c) => c.name)).toEqual(tableFormat("column").seedColumns);
    // A genre may still be supplied (e.g. from the graph grid) but is ignored for output.
    const withGenre = createNewGraph(doc, { output: "table", genre: "bar", tableKind: "grouped", replicates: 3 });
    expect(withGenre.plot).toBeUndefined();
    expect(tableDatasets(withGenre.table)[0]!.replicates).toHaveLength(3); // entry shape still applies
  });

  it("a pre-computed summary entry mode materialises its columns (mean-limits → errlow/errhigh)", () => {
    const doc = emptyDoc();
    const { table } = createNewGraph(doc, { output: "table", tableKind: "xy", entryMode: "mean-limits" });
    expect(table.columns.some((c) => c.role === "errlow")).toBe(true);
    expect(table.columns.some((c) => c.role === "errhigh")).toBe(true);
    expect(tableEntryMode(table)).toBe("mean-limits");
  });

  it("start with sample data inserts a populated example (rows > 0 + a plot); missing sample falls back to blank", () => {
    const withSample = createNewGraph(emptyDoc(), { genre: "xy", tableKind: "xy", sampleData: true });
    expect(withSample.plot).toBeTruthy();
    expect(withSample.table.rows.length).toBeGreaterThan(0); // real example data, not a blank sheet
    // No sampleData → the blank-datasheet path.
    expect(createNewGraph(emptyDoc(), { genre: "xy", tableKind: "xy" }).table.rows).toHaveLength(0);
    // A genre without a sample (contingency) falls back to blank even when sampleData is set.
    // (groupedbar has a sample — the grouped bar showcase — so it is populated.)
    expect(createNewGraph(emptyDoc(), { genre: "contingency", tableKind: "contingency", sampleData: true }).table.rows).toHaveLength(0);
    expect(createNewGraph(emptyDoc(), { genre: "groupedbar", tableKind: "grouped", sampleData: true }).table.rows.length).toBeGreaterThan(0);
  });

  /**
   * applyErrorBarsToData on the sample path. The wizard keeps the error-bar / whisker pickers
   * reachable when "Start with sample data" is ticked, so the choice has to reach the inserted
   * plot. Guards against the sample being inserted untouched and the pick silently discarded.
   * Note: insertGraph remaps every id, so this only passes if the write targets the inserted
   * table's dataset ids, not the source fixture's.
   */
  it("a sample-data graph honours the chosen error-bar type on the inserted plot", () => {
    const doc = emptyDoc();
    const { table, plot } = createNewGraph(doc, { genre: "groupedbar", tableKind: "grouped", sampleData: true, errorBars: "sem" });
    expect(plot).toBeTruthy();
    const ids = new Set(tableDatasets(table).map((d) => d.id));
    // Re-read from the document: the object createNewGraph returns is the snapshot taken before
    // these writes, so asserting on it would report a false "never applied".
    const written = Object.entries(plotOf(doc, plot!.id).seriesStyles ?? {}).filter(([, v]) => (v as { errorBars?: string }).errorBars === "sem");
    expect(written.length, "the chosen error-bar type never reached the inserted sample plot").toBeGreaterThan(0);
    for (const [id] of written) {
      expect(ids.has(id), `errorBars written to ${id}, which is not a dataset of the inserted table`).toBe(true);
    }
  });

  it("a sample-data graph with no error pick keeps the example's own styling", () => {
    const d1 = emptyDoc(); const plain = createNewGraph(d1, { genre: "groupedbar", tableKind: "grouped", sampleData: true });
    const d2 = emptyDoc(); const picked = createNewGraph(d2, { genre: "groupedbar", tableKind: "grouped", sampleData: true, errorBars: "sem" });
    const semOf = (doc: MadyDocument, id: string): number =>
      Object.values(plotOf(doc, id).seriesStyles ?? {}).filter((v) => (v as { errorBars?: string }).errorBars === "sem").length;
    expect(semOf(d1, plain.plot!.id), "an unasked-for error type was forced onto the sample").toBe(0);
    expect(semOf(d2, picked.plot!.id)).toBeGreaterThan(0);
  });

  it("a sample-data box graph honours the chosen whisker definition", () => {
    const doc = emptyDoc();
    const { plot } = createNewGraph(doc, { genre: "box", tableKind: "column", sampleData: true, boxWhisker: "minmax" });
    expect(plotOf(doc, plot!.id).boxWhisker, "the whisker pick never reached the inserted sample plot").toBe("minmax");
  });

  /**
   * Replicates / Data entry apply to a sample too (both pickers are shown for sample data).
   * The example's columns are restructured to the chosen shape while keeping its values, so
   * the user starts from real data in the shape they work in.
   */
  it("a sample-data graph is restructured to the chosen replicate count, keeping its values", () => {
    const doc = emptyDoc();
    const before = createNewGraph(emptyDoc(), { genre: "xy", tableKind: "xy", sampleData: true }).table;
    const { table } = createNewGraph(doc, { genre: "xy", tableKind: "xy", sampleData: true, entryMode: "replicates", replicates: 4 });
    expect(replicateCount(table), "the replicate pick did not reshape the sample").toBe(4);
    expect(table.columns.length, "no sub-columns were added").toBeGreaterThan(before.columns.length);
    expect(table.rows.length, "the worked example lost its rows").toBe(before.rows.length);
    const filled = (t: typeof table): number =>
      t.rows.filter((r) => Object.values(r.cells ?? {}).some((v) => v !== "" && v != null)).length;
    expect(filled(table), "the sample's data did not survive the reshape").toBe(filled(before));
  });

  it("a sample-data graph takes the chosen summary entry mode, keeping its values", () => {
    const doc = emptyDoc();
    const before = createNewGraph(emptyDoc(), { genre: "xy", tableKind: "xy", sampleData: true }).table;
    const { table } = createNewGraph(doc, { genre: "xy", tableKind: "xy", sampleData: true, entryMode: "mean-sd" });
    expect(tableEntryMode(table), "the entry-mode pick did not reshape the sample").toBe("mean-sd");
    expect(table.rows.length).toBe(before.rows.length);
  });

  /**
   * The other half, and the reason the wizard seeds these controls from the sample's own shape:
   * a pick that already matches does not restructure anything. Without that, merely ticking the
   * sample box would bolt empty sub-columns onto every worked example (the dialog's blank-sheet
   * default is 3 replicates; the XY sample has 1).
   */
  it("a pick that already matches the sample records no restructure command", () => {
    // Note: measured as undo depth, not column count. setReplicateCount(n) with the count the table
    // already has is idempotent — the columns come out identical either way, so a column-count
    // assertion here cannot fail and proves nothing. The one thing the skip actually changes is
    // whether a "Set replicate count" command is pushed onto the undo stack.
    const depth = (doc: MadyDocument): number => {
      let n = 0;
      while (doc.commands.canUndo) { doc.commands.undo(); n++; }
      return n;
    };
    const d1 = emptyDoc();
    const plain = createNewGraph(d1, { genre: "xy", tableKind: "xy", sampleData: true }).table;
    const d2 = emptyDoc();
    createNewGraph(d2, { genre: "xy", tableKind: "xy", sampleData: true, entryMode: "replicates", replicates: replicateCount(plain) });
    expect(depth(d2), "a matching pick still pushed a restructure onto the undo stack").toBe(depth(d1));
  });

  it("the survival sample-data graph inserts a survival datasheet, not an XY one", () => {
    const { table, plot } = createNewGraph(emptyDoc(), { genre: "survival", tableKind: "survival", sampleData: true });
    expect(table.kind).toBe("survival");
    expect(table.rows.length).toBeGreaterThan(0);
    expect(plot?.kind).toBe("survival");
  });

  it("applies a date/elapsed X-axis type to the seed X column (XY formats only)", () => {
    const { table } = createNewGraph(emptyDoc(), { genre: "xy", tableKind: "xy", xColumnType: "date" });
    expect(xColumn(table)?.type).toBe("date");
    // A non-XY format ignores it (its X is category labels, not a continuous axis).
    const bar = createNewGraph(emptyDoc(), { output: "table", tableKind: "column", xColumnType: "date" });
    expect(xColumn(bar.table)?.type).toBeUndefined();
  });

  it("every genre builds a renderable scene on its fresh (empty) datasheet — no crash", () => {
    for (const g of NEW_GRAPH_GENRES) {
      const doc = emptyDoc();
      const { table, plot } = createNewGraph(doc, { genre: g.key, tableKind: defaultFormat(g) });
      const proj = doc.toJSON();
      const t = proj.tables.find((x) => x.id === table.id)!;
      const p = proj.plots.find((x) => x.id === plot!.id)!;
      // An empty datasheet must still yield a valid scene (empty frame), never throw —
      // this covers the kinds drawn from a stored analysis result (survival, the ordination
      // kinds, scree, ROC), which have no result yet.
      expect(() => buildPlotScene(t, p, { width: 480, height: 320 }), `genre ${g.key}`).not.toThrow();
    }
  });

  it.each([undefined, {}, { folderId: undefined }, { newFolderName: "   " }])(
    "no real destination (%o) leaves the new datasheet + graph loose (unchanged default)",
    (dest) => {
      const doc = emptyDoc();
      const { table, plot } = createNewGraph(doc, { genre: "xy", tableKind: "xy" });
      fileCreatedGraph(doc, { table, plot }, dest);
      expect(doc.locationOf({ kind: "table", id: table.id })).toEqual({ level: "loose" });
      expect(doc.locationOf({ kind: "plot", id: plot!.id })).toEqual({ level: "loose" });
      // A blank/whitespace new-project name must not create an empty project.
      expect(doc.toJSON().workspace.folders).toHaveLength(0);
    },
  );

  it("files both the datasheet and its graph under an existing project (folder level)", () => {
    const doc = emptyDoc();
    const folder = doc.addFolder("Project A");
    const { table, plot } = createNewGraph(doc, { genre: "bar", tableKind: "column" });
    fileCreatedGraph(doc, { table, plot }, { folderId: folder.id });
    const at = { level: "folder", folderId: folder.id };
    expect(doc.locationOf({ kind: "table", id: table.id })).toEqual(at);
    expect(doc.locationOf({ kind: "plot", id: plot!.id })).toEqual(at); // family kept together
  });

  it("files under an existing experiment when one is chosen", () => {
    const doc = emptyDoc();
    const folder = doc.addFolder("Project A");
    const exp = doc.addExperiment(folder.id, "Exp 1");
    const { table, plot } = createNewGraph(doc, { genre: "xy", tableKind: "xy" });
    fileCreatedGraph(doc, { table, plot }, { folderId: folder.id, experimentId: exp.id });
    const at = { level: "experiment", folderId: folder.id, experimentId: exp.id };
    expect(doc.locationOf({ kind: "table", id: table.id })).toEqual(at);
    expect(doc.locationOf({ kind: "plot", id: plot!.id })).toEqual(at);
  });

  it("'New project…' creates the project and files the new objects under it", () => {
    const doc = emptyDoc();
    const { table, plot } = createNewGraph(doc, { genre: "xy", tableKind: "xy" });
    fileCreatedGraph(doc, { table, plot }, { newFolderName: "Fresh Project" });
    const folders = doc.toJSON().workspace.folders;
    expect(folders.map((f) => f.name)).toEqual(["Fresh Project"]);
    const loc = doc.locationOf({ kind: "table", id: table.id });
    expect(loc).toEqual({ level: "folder", folderId: folders[0]!.id });
  });

  it("'New project…' + 'New experiment…' creates both and files under the new experiment", () => {
    const doc = emptyDoc();
    const { table, plot } = createNewGraph(doc, { genre: "xy", tableKind: "xy" });
    fileCreatedGraph(doc, { table, plot }, { newFolderName: "P", newExperimentName: "E" });
    const folder = doc.toJSON().workspace.folders[0]!;
    expect(folder.name).toBe("P");
    expect(folder.experiments.map((e) => e.name)).toEqual(["E"]);
    expect(doc.locationOf({ kind: "table", id: table.id })).toEqual({
      level: "experiment",
      folderId: folder.id,
      experimentId: folder.experiments[0]!.id,
    });
  });

  it("a new experiment under an existing project files there without a duplicate project", () => {
    const doc = emptyDoc();
    const folder = doc.addFolder("Keep me");
    const { table, plot } = createNewGraph(doc, { output: "table", tableKind: "column" });
    fileCreatedGraph(doc, { table, plot }, { folderId: folder.id, newExperimentName: "New exp" });
    expect(doc.toJSON().workspace.folders).toHaveLength(1); // no extra project created
    const exp = doc.toJSON().workspace.folders.find((f) => f.id === folder.id)!.experiments[0]!;
    expect(exp.name).toBe("New exp");
    expect(doc.locationOf({ kind: "table", id: table.id })).toEqual({
      level: "experiment",
      folderId: folder.id,
      experimentId: exp.id,
    });
  });

  it("every genre's sample-data path builds a renderable scene — no crash", () => {
    // The empty-datasheet loop above does not exercise the populated sample path; drive it too so a
    // sample that fails to render (or a genre whose sampleFor returns a broken {table,plot}) fails
    // loudly. The sample's format is guarded by the next test.
    for (const g of NEW_GRAPH_GENRES) {
      const doc = emptyDoc();
      const { table, plot } = createNewGraph(doc, { genre: g.key, tableKind: defaultFormat(g), sampleData: true });
      const proj = doc.toJSON();
      const t = proj.tables.find((x) => x.id === table.id)!;
      const p = proj.plots.find((x) => x.id === plot!.id)!;
      expect(() => buildPlotScene(t, p, { width: 480, height: 320 }), `genre ${g.key} sample`).not.toThrow();
    }
  });

  it("every genre's sample datasheet is in a format that genre declares (for all genres)", () => {
    // Guards against a sample in a format its genre does not declare, such as an XY sheet under a
    // survival graph. The ridgeline gallery card is the XY horizon-fold showcase, so the ridgeline
    // sample for the Column format is seeded separately as a Column joyplot.
    const wrong = NEW_GRAPH_GENRES.flatMap((g) => {
      const { table } = createNewGraph(emptyDoc(), { genre: g.key, tableKind: defaultFormat(g), sampleData: true });
      return g.formats.includes(table.kind) ? [] : [`${g.key}: sample is ${table.kind}, declares ${g.formats.join(" / ")}`];
    });
    expect(wrong).toEqual([]);
    const ridge = createNewGraph(emptyDoc(), { genre: "ridgeline", tableKind: "column", sampleData: true });
    expect(ridge.table.kind).toBe("column");
    expect(ridge.plot?.kind).toBe("ridgeline");
    expect(ridge.table.rows.length, "the ridgeline sample lost its data").toBeGreaterThan(10);
    // …and it draws as a joyplot: one ridge per group named on the axis, nothing refused.
    const scene = buildPlotScene(ridge.table, ridge.plot!, { width: 600, height: 420 });
    expect(scene.warnings).toEqual([]);
    expect(scene.y.ticks.filter((t) => !t.minor).map((t) => t.label).sort()).toEqual(["Banking", "Coal mining", "Hospitals", "Museums", "Sales", "Software", "Universities"]);
  });
});

/**
 * "(recommended)" is `formats[0]`, and the seed the wizard makes for that format
 * draws at once — a wizard that builds a sheet its own graph warns on is a dead end.
 */
describe("the recommended format's seed draws", () => {
  /** Build the genre on its recommended format, fill a few numeric rows, and return the scene. */
  const seededScene = (key: string) => {
    const doc = emptyDoc();
    const g = genreByKey(key)!;
    const { table, plot } = createNewGraph(doc, { genre: key, tableKind: defaultFormat(g) });
    const cols = doc.toJSON().tables[0]!.columns;
    for (let r = 0; r < 4; r++) doc.addRow(table.id, cols.map((_c, i) => (i === 0 && table.kind !== "xy" ? `Row ${r + 1}` : (r + 1) * (i + 1))));
    const proj = doc.toJSON();
    return { table: proj.tables.find((t) => t.id === table.id)!, scene: buildPlotScene(proj.tables.find((t) => t.id === table.id)!, proj.plots.find((p) => p.id === plot!.id)!, { width: 600, height: 400 }) };
  };

  it("before-after recommends column (Control · Treated draws at once); xy stays offered", () => {
    const g = genreByKey("beforeafter")!;
    expect(g.formats).toEqual(["column", "xy"]);
    expect(seededScene("beforeafter").scene.warnings ?? []).toEqual([]);
  });

  it("bubble's xy seed carries a Size dataset, so the recommended sheet does not warn 'needs a 2nd Y column'", () => {
    const { table, scene } = seededScene("bubble");
    expect(table.columns.map((c) => c.name)).toEqual(["X", "Y1", "Size"]);
    expect(scene.warnings ?? []).toEqual([]);
    // The override is scoped to the genre: a plain XY still gets the format's own seed.
    const { table: xy } = createNewGraph(emptyDoc(), { genre: "xy", tableKind: "xy" });
    expect(xy.columns.map((c) => c.name)).toEqual(tableFormat("xy").seedColumns);
  });
});

/**
 * `TABLE_FORMATS[kind].graphs` (the tooltip on the Analyze data-type cards) and the
 * wizard's genres are two lists saying what a format draws. Every advertised graph must be a
 * genre the wizard actually offers for that format. (The analysis-fed kinds — PCA, ROC,
 * Kaplan-Meier — are wizard genres too, handing over to Analyze, so there is no exception for
 * them.) A listed graph with no genre fails this test; the fix belongs in the list, not the test.
 */
describe("TABLE_FORMATS[kind].graphs ↔ NEW_GRAPH_GENRES agree", () => {
  /** Label fragments (lower-case) → the genre keys that draw them. Doughnut is a pie option. */
  const LABEL_TO_GENRES: Array<[RegExp, string[]]> = [
    [/^scatter$/, ["xy"]], [/^line$/, ["xy"]], [/^area$/, ["area"]], [/before-after/, ["beforeafter"]],
    [/column bar/, ["bar"]], [/box-and-whisker/, ["box"]], [/^violin$/, ["violin"]], [/column scatter/, ["scatter"]],
    [/grouped\/stacked bars/, ["groupedbar", "stackedbar"]], [/grouped box\/violin/, ["box", "violin"]], [/heat ?map/, ["heatmap"]],
    [/grouped bars of counts/, ["contingency"]], [/kaplan-meier/, ["survival"]], [/^pie$/, ["pie"]], [/^doughnut$/, ["pie"]],
    [/parallel coordinates/, ["parallel"]], [/correlation matrix/, ["corrmatrix"]], [/3d scatter/, ["scatter3d"]],
    [/^alluvial$/, ["alluvial"]], [/^network( graph)?$/, ["network"]],
    [/nested column scatter \/ box \/ violin/, ["scatter", "box", "violin"]],
    [/pca score\/loadings\/biplot/, ["pcascore", "pcaload", "pcabiplot"]],
    [/ordination triplot/, ["triplot"]],
    [/scree/, ["scree"]],
    [/venn/, ["venn"]],
    [/upset/, ["upset"]],
    [/swimmer/, ["swimmer"]],
    [/forest/, ["forest"]], [/funnel/, ["funnel"]],
    [/ternary/, ["ternary"]],
    [/polar histogram/, ["rose"]],
    [/timeline tracks/, ["tracks"]],
    [/manhattan( plot)?/, ["manhattan"]],
    [/qq( plot)?/, ["qq"]],
    [/sunburst/, ["sunburst"]],
    [/chord( diagram)?/, ["chord"]],
    [/oncoprint/, ["oncoprint"]],
  ];

  for (const kind of TABLE_FORMAT_ORDER as readonly TableKind[]) {
    it(`${kind}: every advertised graph is a genre offered for it — ${TABLE_FORMATS[kind].graphs.join(" · ")}`, () => {
      for (const label of TABLE_FORMATS[kind].graphs) {
        const l = label.toLowerCase();
        const hit = LABEL_TO_GENRES.find(([re]) => re.test(l));
        expect(hit, `${kind}: "${label}" is not a graph this test can map to a genre`).toBeDefined();
        for (const key of hit![1]) {
          const g = genreByKey(key);
          expect(g, `no genre "${key}"`).toBeDefined();
          expect(g!.formats, `${kind}: "${label}" → genre "${key}" is not offered for a ${kind} sheet`).toContain(kind);
        }
      }
    });
  }

  it("multivariable leads with what the wizard suggests first, not Bubble (an XY graph, which needs an x column)", () => {
    expect(TABLE_FORMATS.multivariable.graphs[0]).toBe("Parallel coordinates");
    expect(TABLE_FORMATS.multivariable.graphs).not.toContain("Bubble");
    expect(genreByKey("bubble")!.formats).not.toContain("multivariable");
  });
  it("contingency advertises counts only (no proportion bar mode exists)", () => {
    expect(TABLE_FORMATS.contingency.graphs.join(" ").toLowerCase()).not.toMatch(/proportion/);
  });
  it("nested does not advertise a bar (no bar genre for nested)", () => {
    expect(NEW_GRAPH_GENRES.some((g) => g.plotKind === "bar" && g.formats.includes("nested"))).toBe(false);
    expect(TABLE_FORMATS.nested.graphs.join(" ").toLowerCase()).not.toMatch(/\bbar\b/);
  });
});
