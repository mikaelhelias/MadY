import { describe, expect, it } from "vitest";
import { MadyDocument } from "./document";
import { migrate } from "./migrations";
import { extractPicks, extractProject, collectIds } from "./persist";
import { resolveOverlays } from "./overlays";
import { createSampleDocument } from "./sample";

describe("persistence", () => {
  it("round-trips a project through JSON + migrate unchanged", () => {
    const project = createSampleDocument().toJSON();
    const reloaded = migrate(JSON.parse(JSON.stringify(project)) as Record<string, unknown>);
    expect(reloaded).toEqual(project);
  });

  it("seeds the id factory on load so new ids don't collide", () => {
    const project = createSampleDocument().toJSON();
    const existing = new Set(collectIds(project));
    const doc = new MadyDocument(project); // constructor seeds from the loaded project
    const table = doc.addTable("New", "xy", ["X", "Y"]); // mints a fresh tbl/col ids
    const fresh = collectIds(doc.toJSON()).filter((id) => !existing.has(id));
    expect(table.id.startsWith("tbl_")).toBe(true);
    // none of the newly minted ids reuse an existing one
    for (const id of fresh) expect(existing.has(id)).toBe(false);
  });

  it("extractProject keeps only the selected folders + their referenced entities", () => {
    const doc = new MadyDocument();
    const tA = doc.addTable("A", "xy", ["X", "Y"]);
    doc.addRow(tA.id, [1, 2]);
    const pA = doc.addPlot("Plot A", tA.id);
    const tB = doc.addTable("B", "xy", ["X", "Y"]);
    doc.addPlot("Plot B", tB.id);

    const fA = doc.addFolder("Folder A");
    const expA = doc.addExperiment(fA.id, "E");
    doc.fileObject({ kind: "table", id: tA.id }, { level: "experiment", folderId: fA.id, experimentId: expA.id });
    doc.fileObject({ kind: "plot", id: pA.id }, { level: "experiment", folderId: fA.id, experimentId: expA.id });
    const fB = doc.addFolder("Folder B");
    doc.fileObject({ kind: "table", id: tB.id }, { level: "folder", folderId: fB.id });

    const subset = extractProject(doc.toJSON(), [fA.id]);
    expect(subset.workspace.folders.map((f) => f.id)).toEqual([fA.id]);
    expect(subset.tables.map((t) => t.id)).toEqual([tA.id]); // B excluded
    expect(subset.plots.map((p) => p.id)).toEqual([pA.id]);
    // and the subset is itself a valid, loadable project (rows preserved)
    expect(subset.tables[0]!.rows).toHaveLength(1);
    const reloaded = new MadyDocument(subset);
    expect(reloaded.toJSON().tables).toHaveLength(1);
  });

  it("always includes a plot's source table in the subset", () => {
    const doc = new MadyDocument();
    const t = doc.addTable("T", "xy", ["X", "Y"]);
    const p = doc.addPlot("P", t.id);
    const f = doc.addFolder("F");
    // file only the plot under the folder (not the table)
    doc.fileObject({ kind: "plot", id: p.id }, { level: "folder", folderId: f.id });
    const subset = extractProject(doc.toJSON(), [f.id]);
    expect(subset.tables.map((x) => x.id)).toEqual([t.id]); // source table pulled in
  });

  it("includes a filed analysis (+ its source table) in the subset and id collection", () => {
    const doc = new MadyDocument();
    const t = doc.addTable("T", "xy", ["X", "Y"]);
    const an = doc.addAnalysis("desc", "describe", t.id, { columns: [t.columns[1]!.id] });
    expect(collectIds(doc.toJSON())).toContain(an.id);
    const f = doc.addFolder("F");
    doc.fileObject({ kind: "analysis", id: an.id }, { level: "folder", folderId: f.id });
    const subset = extractProject(doc.toJSON(), [f.id]);
    expect(subset.analyses.map((a) => a.id)).toEqual([an.id]);
    expect(subset.tables.map((x) => x.id)).toEqual([t.id]); // analysis's source table pulled in
  });

  it("keeps a filed figure layout, pulls in its panel plots, and preserves methods", () => {
    const doc = new MadyDocument();
    const t = doc.addTable("T", "xy", ["X", "Y"]);
    const p = doc.addPlot("P", t.id);
    const lay = doc.addLayout("Figure 1");
    doc.addLayoutPanel(lay.id, p.id);
    doc.addMethod({ id: "m1", name: "My t-test", method: "ttest", columns: [1], params: {} });
    const f = doc.addFolder("F");
    // File only the layout under the folder — its panel plot (and source table) must ride along.
    doc.fileObject({ kind: "layout", id: lay.id }, { level: "folder", folderId: f.id });

    const subset = extractProject(doc.toJSON(), [f.id]);
    expect(subset.layouts?.map((l) => l.id)).toEqual([lay.id]); // layout kept, not dropped
    expect(subset.plots.map((x) => x.id)).toContain(p.id); // panel plot pulled in
    expect(subset.tables.map((x) => x.id)).toContain(t.id); // its source table pulled in
    expect(subset.methods?.map((m) => m.id)).toEqual(["m1"]); // method library preserved
    // The subset is a valid, loadable project with no dangling layout reference.
    const reloaded = new MadyDocument(subset).toJSON();
    expect(reloaded.layouts?.[0]!.panels).toEqual([p.id]);
  });

  it("carries user-built gradients into a subset save — a plot references one by id", () => {
    // A graph saved on its own must open with its own colours. `plot.heatmap.colormap` is
    // "custom:g1", which resolves through the project's registry: drop the registry from the
    // subset and the saved file draws viridis and warns, which is the whole failure mode the
    // in-document registry exists to prevent.
    const doc = new MadyDocument();
    const t = doc.addTable("T", "xy", ["X", "Y"]);
    const p = doc.addPlot("P", t.id);
    const withGrad = {
      ...doc.toJSON(),
      gradients: [{ id: "g1", name: "Mine", mode: "stops" as const, stops: [{ pos: 0, color: "#ff0000" }, { pos: 1, color: "#0000ff" }] }],
    };
    const doc2 = new MadyDocument(withGrad);
    const f = doc2.addFolder("F");
    doc2.fileObject({ kind: "plot", id: p.id }, { level: "folder", folderId: f.id });

    const subset = extractProject(doc2.toJSON(), [f.id]);
    expect(subset.gradients?.map((gr) => gr.id)).toEqual(["g1"]);
    // …and it survives the file round trip.
    const reloaded = migrate(JSON.parse(JSON.stringify(subset)) as Record<string, unknown>);
    expect(reloaded.gradients?.[0]!.stops).toEqual([{ pos: 0, color: "#ff0000" }, { pos: 1, color: "#0000ff" }]);
  });

  it("every entity in a subset is reachable in its workspace tree", () => {
    // The Navigator draws the workspace tree and nothing else: a table that is in `tables`
    // but filed nowhere is invisible, so the saved graph's datasheet cannot be opened.
    const doc = new MadyDocument();
    const t = doc.addTable("T", "xy", ["X", "Y"]);
    const p = doc.addPlot("P", t.id);
    const f = doc.addFolder("F");
    doc.fileObject({ kind: "plot", id: p.id }, { level: "folder", folderId: f.id }); // table NOT filed here
    const subset = extractProject(doc.toJSON(), [f.id]);
    const inTree = new Set(
      [...subset.workspace.loose, ...subset.workspace.folders.flatMap((x) => [...x.members, ...x.experiments.flatMap((e) => e.members)])].map(
        (r) => `${r.kind}:${r.id}`,
      ),
    );
    expect(inTree.has(`plot:${p.id}`)).toBe(true);
    expect(inTree.has(`table:${t.id}`)).toBe(true); // the pulled-in source table, not orphaned
  });

  it("saves one graph: the plot, its source table with rows, and nothing else", () => {
    const doc = new MadyDocument();
    const tA = doc.addTable("A", "xy", ["X", "Y"]);
    doc.addRow(tA.id, [1, 2]);
    const pA = doc.addPlot("Plot A", tA.id);
    const tB = doc.addTable("B", "xy", ["X", "Y"]);
    const pB = doc.addPlot("Plot B", tB.id);
    const f = doc.addFolder("F");
    for (const ref of [
      { kind: "table", id: tA.id },
      { kind: "plot", id: pA.id },
      { kind: "table", id: tB.id },
      { kind: "plot", id: pB.id },
    ] as const) {
      doc.fileObject(ref, { level: "folder", folderId: f.id });
    }

    const one = extractPicks(doc.toJSON(), [{ level: "object", kind: "plot", id: pA.id }]);
    expect(one.plots.map((p) => p.id)).toEqual([pA.id]); // B's graph excluded
    expect(one.tables.map((t) => t.id)).toEqual([tA.id]); // B's table excluded
    expect(one.tables[0]!.rows).toHaveLength(1); // the data travels with the graph
    // it opens as an ordinary project
    const reloaded = new MadyDocument(one).toJSON();
    expect(reloaded.plots).toHaveLength(1);
    expect(reloaded.tables[0]!.rows).toHaveLength(1);
  });

  it("a single graph keeps the folder + experiment it was filed in (its context)", () => {
    const doc = new MadyDocument();
    const t = doc.addTable("T", "xy", ["X", "Y"]);
    const p = doc.addPlot("P", t.id);
    const f = doc.addFolder("Study");
    const e = doc.addExperiment(f.id, "Exp 1");
    const other = doc.addExperiment(f.id, "Exp 2");
    doc.fileObject({ kind: "table", id: t.id }, { level: "experiment", folderId: f.id, experimentId: e.id });
    doc.fileObject({ kind: "plot", id: p.id }, { level: "experiment", folderId: f.id, experimentId: e.id });

    const one = extractPicks(doc.toJSON(), [{ level: "object", kind: "plot", id: p.id }]);
    expect(one.workspace.folders.map((x) => x.name)).toEqual(["Study"]);
    expect(one.workspace.folders[0]!.experiments.map((x) => x.id)).toEqual([e.id]); // Exp 2 dropped
    expect(one.workspace.folders[0]!.experiments[0]!.members.map((m) => m.id).sort()).toEqual([p.id, t.id].sort());
    expect(other.id).not.toEqual(e.id);
  });

  it("saves one experiment: its members only, its sibling excluded", () => {
    const doc = new MadyDocument();
    const t1 = doc.addTable("T1", "xy", ["X", "Y"]);
    const p1 = doc.addPlot("P1", t1.id);
    const t2 = doc.addTable("T2", "xy", ["X", "Y"]);
    const p2 = doc.addPlot("P2", t2.id);
    const f = doc.addFolder("Study");
    const e1 = doc.addExperiment(f.id, "Exp 1");
    const e2 = doc.addExperiment(f.id, "Exp 2");
    doc.fileObject({ kind: "table", id: t1.id }, { level: "experiment", folderId: f.id, experimentId: e1.id });
    doc.fileObject({ kind: "plot", id: p1.id }, { level: "experiment", folderId: f.id, experimentId: e1.id });
    doc.fileObject({ kind: "table", id: t2.id }, { level: "experiment", folderId: f.id, experimentId: e2.id });
    doc.fileObject({ kind: "plot", id: p2.id }, { level: "experiment", folderId: f.id, experimentId: e2.id });

    const subset = extractPicks(doc.toJSON(), [{ level: "experiment", id: e1.id }]);
    expect(subset.plots.map((p) => p.id)).toEqual([p1.id]);
    expect(subset.tables.map((t) => t.id)).toEqual([t1.id]);
    expect(subset.workspace.folders[0]!.experiments.map((x) => x.id)).toEqual([e1.id]);
  });

  it("a graph made from an analysis pulls the analysis and the analysis's own table", () => {
    const doc = new MadyDocument();
    const src = doc.addTable("Source", "xy", ["X", "Y"]);
    const an = doc.addAnalysis("PCA", "pca", src.id, { columns: [src.columns[1]!.id] });
    const scores = doc.addTable("Scores", "xy", ["PC1", "PC2"]);
    const plot = doc.addPlot("Score plot", scores.id);
    const project = doc.toJSON();
    // The graph's own source is the scores table; the analysis (and its table) are one hop further.
    project.plots.find((p) => p.id === plot.id)!.analysisSource = an.id;

    const one = extractPicks(project, [{ level: "object", kind: "plot", id: plot.id }]);
    expect(one.analyses.map((a) => a.id)).toEqual([an.id]);
    expect(one.tables.map((t) => t.id).sort()).toEqual([scores.id, src.id].sort()); // fixed-point chase
  });

  /** Save → the file on disk → open again, exactly as the app loads a .mady. */
  const reopen = (p: ReturnType<typeof extractPicks>): MadyDocument =>
    new MadyDocument(migrate(JSON.parse(JSON.stringify(p)) as Record<string, unknown>));

  it("a graph that borrows a series from another datasheet carries that datasheet, and draws it when reopened", () => {
    // `plot.overlays` points at another sheet. Without it the saved graph draws one series short
    // and warns "that datasheet no longer exists".
    const doc = new MadyDocument();
    const own = doc.addTable("Own", "xy", ["X", "Y"]);
    doc.addRow(own.id, [1, 10]);
    doc.addRow(own.id, [2, 20]);
    const other = doc.addTable("Other", "xy", ["X", "Z"]);
    doc.addRow(other.id, [1, 5]);
    doc.addRow(other.id, [2, 6]);
    const plot = doc.addPlot("P", own.id);
    const project = doc.toJSON();
    project.plots.find((p) => p.id === plot.id)!.overlays = [{ id: "ov1", table: other.id, column: other.columns[1]!.id }];

    const one = extractPicks(project, [{ level: "object", kind: "plot", id: plot.id }]);
    expect(one.tables.map((t) => t.id).sort()).toEqual([own.id, other.id].sort());
    expect(one.workspace.loose).toContainEqual({ kind: "table", id: other.id }); // and it is visible

    const opened = reopen(one).toJSON();
    const p = opened.plots[0]!;
    const joined = resolveOverlays(opened.tables.find((t) => t.id === p.source)!, p, (id) => opened.tables.find((t) => t.id === id));
    expect(joined.warnings, "the reopened graph could not draw its borrowed series").toEqual([]);
    expect(joined.table.columns.map((c) => c.name)).toEqual(["X", "Y", "Z"]);
  });

  it("a transformed datasheet carries the sheet it is computed from, and still recomputes when reopened", () => {
    // Inside the app a derived sheet never outlives its source (deleting the source deletes it).
    // Saved alone it would keep stale numbers that can never recompute.
    const doc = new MadyDocument();
    const raw = doc.addTable("Raw", "xy", ["X", "Y"]);
    doc.addRow(raw.id, [1, 100]);
    const logged = doc.deriveTable("Log", { source: raw.id, op: "transform", spec: { fn: "log10", columns: [1] } });
    const twice = doc.deriveTable("Log again", { source: logged.id, op: "transform", spec: { fn: "log10", columns: [1] } });
    const plot = doc.addPlot("P", twice.id);

    const sheet = extractPicks(doc.toJSON(), [{ level: "object", kind: "table", id: twice.id }]);
    expect(sheet.tables.map((t) => t.id).sort()).toEqual([raw.id, logged.id, twice.id].sort());
    const graph = extractPicks(doc.toJSON(), [{ level: "object", kind: "plot", id: plot.id }]);
    expect(graph.tables.map((t) => t.id).sort()).toEqual([raw.id, logged.id, twice.id].sort());

    // Reopen, edit the original sheet, and the chain follows: log10(10000) = 4, log10(4) ≈ 0.602.
    const d2 = reopen(graph);
    const r = d2.toJSON().tables.find((t) => t.id === raw.id)!;
    d2.setCell(raw.id, r.rows[0]!.id, r.columns[1]!.id, 10000);
    d2.recomputeStaleDerived();
    const y = (id: string): number => {
      const t = d2.toJSON().tables.find((x) => x.id === id)!;
      return Number(t.rows[0]!.cells[t.columns[1]!.id]);
    };
    expect(y(logged.id)).toBeCloseTo(4, 6);
    expect(y(twice.id)).toBeCloseTo(Math.log10(4), 6);
  });

  it("a generated (simulated) datasheet has no source sheet and saves on its own", () => {
    const doc = new MadyDocument();
    const t = doc.addTable("T", "xy", ["X", "Y"]);
    const project = doc.toJSON();
    project.tables[0]!.derivation = { source: "", op: "simulate", spec: {} } as never;
    const one = extractPicks(project, [{ level: "object", kind: "table", id: t.id }]);
    expect(one.tables.map((x) => x.id)).toEqual([t.id]);
  });

  it("a graph's p-value brackets carry the test that produced them, and the link resolves when reopened", () => {
    // The bracket's text is stored on the graph, but re-syncing it needs the analysis.
    const doc = new MadyDocument();
    const t = doc.addTable("T", "column", ["A", "B"]);
    const an = doc.addAnalysis("t test", "ttest", t.id, { columns: [t.columns[0]!.id, t.columns[1]!.id] });
    const plot = doc.addPlot("P", t.id);
    doc.syncAnalysisAnnotations(plot.id, an.id, [{ kind: "bracket", label: "**", sig: { analysisId: an.id } } as never]);

    const one = extractPicks(doc.toJSON(), [{ level: "object", kind: "plot", id: plot.id }]);
    expect(one.analyses.map((a) => a.id)).toEqual([an.id]);

    const opened = reopen(one).toJSON();
    const bracket = opened.plots[0]!.annotations!.find((a) => a.sig)!;
    const test = opened.analyses.find((a) => a.id === bracket.sig!.analysisId);
    expect(test?.method, "the reopened bracket points at a test that is not in the file").toBe("ttest");
    expect(test?.source).toBe(opened.plots[0]!.source);
  });

  it("a dependency whose folder was not picked is filed at the top level, never orphaned", () => {
    const doc = new MadyDocument();
    const t = doc.addTable("T", "xy", ["X", "Y"]);
    const p = doc.addPlot("P", t.id);
    const fData = doc.addFolder("Data");
    const fGraphs = doc.addFolder("Graphs");
    doc.fileObject({ kind: "table", id: t.id }, { level: "folder", folderId: fData.id });
    doc.fileObject({ kind: "plot", id: p.id }, { level: "folder", folderId: fGraphs.id });

    const subset = extractPicks(doc.toJSON(), [{ level: "object", kind: "plot", id: p.id }]);
    expect(subset.workspace.folders.map((f) => f.name)).toEqual(["Graphs"]); // "Data" not resurrected
    expect(subset.workspace.loose).toEqual([{ kind: "table", id: t.id }]); // but the table is visible
  });

  it("a single-graph save survives the full JSON + migrate round-trip", () => {
    const doc = new MadyDocument();
    const t = doc.addTable("T", "xy", ["X", "Y"]);
    doc.addRow(t.id, [1, 2]);
    const p = doc.addPlot("P", t.id);
    doc.fileObject({ kind: "plot", id: p.id }, { level: "loose" });
    const one = extractPicks(doc.toJSON(), [{ level: "object", kind: "plot", id: p.id }]);
    const reloaded = migrate(JSON.parse(JSON.stringify(one)) as Record<string, unknown>);
    expect(reloaded).toEqual(one);
  });

  it("a folder subset survives the full JSON + migrate round-trip (disk-write analogue)", () => {
    const doc = new MadyDocument();
    const t = doc.addTable("T", "xy", ["X", "Y"]);
    doc.addRow(t.id, [1, 2]);
    const p = doc.addPlot("P", t.id);
    const lay = doc.addLayout("Fig");
    doc.addLayoutPanel(lay.id, p.id);
    doc.addMethod({ id: "m1", name: "M", method: "ttest", columns: [1], params: {} });
    const f = doc.addFolder("F");
    doc.fileObject({ kind: "layout", id: lay.id }, { level: "folder", folderId: f.id });

    const subset = extractProject(doc.toJSON(), [f.id]);
    // The real save path is JSON.stringify → disk → JSON.parse → migrate. Prove the subset
    // makes that trip byte-for-byte — a Date/Map/Set/Infinity/undefined lurking anywhere would
    // silently become null/absent on save. (The disk + IPC leg itself is Electron-only.)
    const reloaded = migrate(JSON.parse(JSON.stringify(subset)) as Record<string, unknown>);
    expect(reloaded).toEqual(subset);
    expect(reloaded.methods?.map((m) => m.id)).toEqual(["m1"]);
    expect(reloaded.layouts?.map((l) => l.id)).toEqual([lay.id]);
  });
});
