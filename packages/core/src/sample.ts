import { MadyDocument } from "./document";
import type { AnalysisParams, CellValue, NodeId, PlotKind, TableKind, WorkspaceTarget } from "./model";
import { tableDatasets } from "./dataset";
import { rowGroupId } from "./rowGroups";
import { applyKindHouseDefaults, findPreset } from "./presets";

/**
 * The project folder that holds every piece of synthetic content: the sample document the
 * app opens with, and anything opened from the Chart gallery.
 *
 * Note: exported and matched by name, which is why it lives here rather than being typed out at
 * each site. The gallery looks this folder up to file into it; a second copy of the string
 * would eventually disagree by a character and silently produce two folders, one of them
 * empty. Renaming it here renames it for new documents; a document already saved stores the
 * name, so an old file keeps its old folder — which is correct, since it is the user's document
 * by then.
 *
 * Caution: do not reuse this name in `migrations.ts`. The folder that migration creates wraps a
 * real document predating the workspace tree; labelling the user's own work a demo would be wrong.
 */
export const DEMO_FOLDER = "Demo Project";

/**
 * The built-in demo project: a dose–response dataset with its graph and curve fit, then
 * further experiments, each a dataset with a graph and its analysis, all filed under the demo
 * project folder.
 */
export function createSampleDocument(): MadyDocument {
  const doc = new MadyDocument();
  const table = doc.addTable("Sample — dose vs response", "xy", ["Dose (uM)", "Response (%)", "Rep 2", "Rep 3"]);
  // Group the two extra Y columns as replicate subcolumns of "Response (%)" so the
  // graph draws mean ± SD error bars (3 replicates per dose).
  doc.setColumnRole(table.id, table.columns[2]!.id, "y", table.columns[1]!.id);
  doc.setColumnRole(table.id, table.columns[3]!.id, "y", table.columns[1]!.id);
  const data: ReadonlyArray<readonly [number, number, number, number]> = [
    [0.1, 4, 6, 2],
    [0.3, 9, 12, 6],
    [1, 21, 25, 17],
    [3, 48, 54, 42],
    [10, 72, 78, 66],
    [30, 88, 92, 84],
    [100, 95, 98, 92],
  ];
  for (const [dose, r1, r2, r3] of data) doc.addRow(table.id, [dose, r1, r2, r3]);
  const plot = doc.addPlot("Dose-response", table.id);
  // Every sample graph opens in the house style (the MadY default preset).
  const plotIds: NodeId[] = [plot.id];
  doc.recompute();

  // File the dataset + graph under a project → experiment in the workspace tree.
  const folder = doc.addFolder(DEMO_FOLDER);
  const experiment = doc.addExperiment(folder.id, "Experiment 1");
  const target = { level: "experiment", folderId: folder.id, experimentId: experiment.id } as const;
  doc.fileObject({ kind: "table", id: table.id }, target);
  doc.fileObject({ kind: "plot", id: plot.id }, target);

  /**
   * The demo project also ships the analysis a scientist would run on each sheet,
   * filed beside its datasheet. Every one is added without a result: the app
   * computes it through the real engine on boot (`fillMissingAnalysisResults`), so no number
   * in the project is typed in — the fixture carries only the method, the columns and the
   * choices. `sample-analyses.test` pins the payload each one sends; `engine.sample.test`
   * (desktop main) runs them through the Python engine.
   */
  const fileAnalysis = (name: string, method: string, tableId: NodeId, params: AnalysisParams, tgt: WorkspaceTarget): void => {
    const a = doc.addAnalysis(name, method, tableId, params);
    doc.fileObject({ kind: "analysis", id: a.id }, tgt);
  };
  // Dose–response: a four-parameter logistic fit on log(dose) over all 21 replicate points →
  // Bottom, Top, Hill slope and the EC50 (the doses span 0.1–100 µM, the midpoint is ~3 µM).
  fileAnalysis(
    "Dose-response 4PL — Response (%) vs Dose (uM)",
    "curvefit",
    table.id,
    { columns: [table.columns[0]!.id, table.columns[1]!.id], variant: "4pl", conf: 0.95 },
    target,
  );

  // A second dataset + graph in Experiment 1: a gene-expression heatmap (rows =
  // genes, columns = conditions) so the matrix heatmap's editable text is easy to
  // try — double-click a Gene/condition label to rename it, add row/column axis
  // titles, rotate/restyle the labels, and drag the colour-bar.
  const hm = doc.addTable("Gene expression", "xy", ["Gene", "Ctrl", "Drug A", "Drug B", "Drug C", "Combo"]);
  const hmRows: ReadonlyArray<readonly [string, number, number, number, number, number]> = [
    ["GeneA", 1.0, 2.2, 3.5, 4.8, 6.0],
    ["GeneB", 6.0, 4.8, 3.5, 2.2, 1.0],
    ["GeneC", 2.0, 2.1, 5.9, 2.0, 2.2],
    ["GeneD", 1.5, 3.0, 1.4, 5.5, 3.2],
    ["GeneE", 4.0, 4.2, 3.8, 4.1, 3.9],
    ["GeneF", 0.5, 1.0, 2.0, 3.5, 6.0],
    ["GeneG", 5.5, 3.2, 6.1, 1.1, 2.8],
    ["GeneH", 3.0, 5.9, 1.2, 4.4, 2.0],
  ];
  for (const row of hmRows) doc.addRow(hm.id, [...row]);
  const hmPlot = doc.addPlot("Gene expression heatmap", hm.id);
  doc.setPlotKind(hmPlot.id, "heatmap");
  plotIds.push(hmPlot.id);
  doc.fileObject({ kind: "table", id: hm.id }, target);
  doc.fileObject({ kind: "plot", id: hmPlot.id }, target);
  // Expression matrix → hierarchical clustering of the genes (rows) over the five conditions
  // (Ward linkage on z-scored profiles, cut into 3 clusters: rising, falling, flat/mixed), with
  // the k = 2…5 scan so the elbow + silhouette are on show. The companion of every heatmap.
  fileAnalysis(
    "Hierarchical clustering (k = 3) — 5 variables",
    "cluster",
    hm.id,
    { columns: hm.columns.slice(1).map((c) => c.id), variant: "hierarchical", k: 3, linkage: "ward", standardize: true, scanK: true, kMax: 5 },
    target,
  );

  // More experiments in the demo project, each with a dataset + a graph of a
  // distinct chart kind (gives the panel-figure selector real material to group).
  const addExperimentGraph = (
    expName: string,
    tableName: string,
    tableKind: TableKind,
    columns: string[],
    rows: CellValue[][],
    graphName: string,
    graphKind: PlotKind,
  ) => {
    const t = doc.addTable(tableName, tableKind, columns);
    for (const row of rows) doc.addRow(t.id, row);
    const p = doc.addPlot(graphName, t.id);
    doc.setPlotKind(p.id, graphKind);
    plotIds.push(p.id);
    const exp = doc.addExperiment(folder.id, expName);
    const tgt = { level: "experiment", folderId: folder.id, experimentId: exp.id } as const;
    doc.fileObject({ kind: "table", id: t.id }, tgt);
    doc.fileObject({ kind: "plot", id: p.id }, tgt);
    return { table: t, plot: p, target: tgt };
  };

  const treatmentsExp = addExperimentGraph(
    "Experiment 2",
    "Treatment means",
    "column",
    ["Group", "Mean", "Rep 2", "Rep 3"],
    [["Control", 12, 15, 9], ["Drug A", 28, 32, 24], ["Drug B", 19, 22, 16], ["Drug C", 35, 39, 31]],
    "Treatment bar chart",
    "bar",
  );
  const treatments = treatmentsExp.table;
  // Group the two extra Mean columns as replicate subcolumns → mean ± SD error bars.
  // A bar chart takes its categories from rows (datasets become series), so the
  // treatments belong in rows here — the right shape for the figure.
  doc.setColumnRole(treatments.id, treatments.columns[2]!.id, "y", treatments.columns[1]!.id);
  doc.setColumnRole(treatments.id, treatments.columns[3]!.id, "y", treatments.columns[1]!.id);
  // The analysis reads the same rows as row groups: each treatment's three replicates, read
  // from its row, is one group, so the sheet needs no transposing. One-way ANOVA across the four, then Dunnett's test of every drug
  // against Control — the comparison this experiment was designed to make.
  const groupCol = treatments.columns[0]!.id;
  fileAnalysis(
    "ANOVA — Control, Drug A, Drug B, Drug C",
    "anova",
    treatments.id,
    { columns: ["Control", "Drug A", "Drug B", "Drug C"].map((g) => rowGroupId(groupCol, g)), variant: "anova", posthoc: "dunnett", scheme: "vs-control", control: 0, conf: 0.95 },
    treatmentsExp.target,
  );
  const violinExp = addExperimentGraph(
    "Experiment 3",
    "Replicate readouts",
    "column",
    ["Vehicle", "Low dose", "High dose"],
    [
      [8, 16, 26], [11, 19, 30], [9, 20, 27], [12, 17, 31],
      [10, 21, 25], [13, 18, 29], [9, 15, 28], [11, 22, 33],
    ],
    "Dose-group violin",
    "violin",
  );
  const violin = violinExp.table;
  // Lead-less distribution shape: each column IS a group and its readings
  // run straight down the rows — no leading index column, which a distribution never uses.
  // Tagging every column "y" is what makes `xColumn()` return none, so the first group is not
  // eaten as row labels.
  for (const c of violin.columns) doc.setColumnRole(violin.id, c.id, "y");
  // Three dose groups of eight readings → one-way ANOVA, Tukey's test over all three pairs.
  fileAnalysis(
    "ANOVA — Vehicle, Low dose, High dose",
    "anova",
    violin.id,
    { columns: violin.columns.map((c) => c.id), variant: "anova", posthoc: "tukey", scheme: "all-pairs", conf: 0.95 },
    violinExp.target,
  );
  addExperimentGraph(
    "Experiment 4",
    "Quarterly scores",
    "column",
    ["Metric", "Score"],
    [["Q1", 22], ["Q2", 30], ["Q3", 18], ["Q4", 41], ["Q5", 27]],
    "Quarterly lollipop",
    "lollipop",
  );

  // Experiment 5 — a grouped Multiple-variables dataset for the PCA score-plot demo.
  // Three cell types are separated across four measurements; run PCA with the four
  // numbers as variables and "Cell type" as the grouping column to get a PC1-vs-PC2
  // score plot with a 95% confidence ellipse per group.
  const mv = doc.addTable("Cell profiling (PCA demo)", "pca", [
    "Cell type",
    "Size",
    "Granularity",
    "Marker A",
    "Marker B",
  ]);
  const mvRows: CellValue[][] = [
    ["Neuron", 9.1, 8.0, 2.1, 3.0],
    ["Neuron", 9.4, 7.6, 1.8, 3.4],
    ["Neuron", 8.7, 8.3, 2.4, 2.7],
    ["Neuron", 9.0, 7.9, 2.0, 3.2],
    ["Neuron", 9.3, 8.2, 1.7, 2.9],
    ["Neuron", 8.9, 7.7, 2.2, 3.1],
    ["Glia", 3.2, 2.1, 9.0, 6.1],
    ["Glia", 2.8, 1.7, 9.3, 5.8],
    ["Glia", 3.4, 2.4, 8.7, 6.4],
    ["Glia", 3.0, 2.0, 9.1, 6.0],
    ["Glia", 2.7, 1.8, 8.9, 5.7],
    ["Glia", 3.3, 2.3, 9.2, 6.3],
    ["Stem", 5.6, 4.5, 5.1, 10.0],
    ["Stem", 5.2, 4.1, 4.8, 9.7],
    ["Stem", 5.9, 4.8, 5.4, 10.3],
    ["Stem", 5.5, 4.4, 5.0, 9.9],
    ["Stem", 5.3, 4.2, 4.7, 10.1],
    ["Stem", 5.8, 4.7, 5.3, 9.6],
  ];
  for (const row of mvRows) doc.addRow(mv.id, row);
  const mvExp = doc.addExperiment(folder.id, "Experiment 5");
  const mvTarget = { level: "experiment", folderId: folder.id, experimentId: mvExp.id } as const;
  doc.fileObject({ kind: "table", id: mv.id }, mvTarget);
  // The PCA the sheet was made for: the four measurements as variables (z-scored), each case
  // labelled by its cell type so the score plot draws per-group series + confidence ellipses.
  fileAnalysis(
    "PCA — 4 variables",
    "pca",
    mv.id,
    { columns: mv.columns.slice(1).map((c) => c.id), groupBy: mv.columns[0]!.id, variant: "standardize" },
    mvTarget,
  );

  // Experiment 6 — a Voronoi treemap (parts of a whole): US GDP by state, cells
  // grouped into regional colour families with perimeter region labels + per-cell icons.
  const gdp = addExperimentGraph(
    "Experiment 6",
    "US economy",
    "partsofwhole",
    ["State", "GDP ($T)", "Region", "Icon"],
    [
      ["California", 4.3, "West", "🌲"], ["Washington", 0.9, "West", "🌲"], ["Arizona", 0.6, "West", "🌵"],
      ["Texas", 2.9, "South", "☀️"], ["Florida", 1.8, "South", "🌴"], ["Georgia", 0.93, "South", "🍑"],
      ["New York", 2.5, "Northeast", "🍁"], ["Pennsylvania", 1.1, "Northeast", "🔔"], ["Massachusetts", 0.82, "Northeast", "🎓"],
      ["Illinois", 1.2, "Midwest", "🌾"], ["Ohio", 0.97, "Midwest", "🏭"], ["Michigan", 0.73, "Midwest", "🚗"],
    ],
    "GDP treemap",
    "treemap",
  );
  // Region + Icon are grouping/label columns, not value columns — mark them role "x"
  // so the single-whole (GDP) treemap doesn't count them as extra value datasets.
  doc.setColumnRole(gdp.table.id, gdp.table.columns[2]!.id, "x");
  doc.setColumnRole(gdp.table.id, gdp.table.columns[3]!.id, "x");
  doc.setPlotOptions(gdp.plot.id, {
    treemap: { groupColumn: gdp.table.columns[2]!.id, iconColumn: gdp.table.columns[3]!.id, showValues: true, showGroupLabels: true },
  });

  // Experiment 7 — a node-link network graph from an edge list (source · target ·
  // weight · per-node value): a force-directed immune-signaling cascade.
  addExperimentGraph(
    "Experiment 7",
    "Immune signaling",
    "xy",
    ["Source", "Target", "Weight", "Value"],
    [
      ["IFNγ", "STAT1", 3, 1.8], ["IFNγ", "IRF1", 2, 1.8], ["STAT1", "CXCL9", 3, 1.2],
      ["STAT1", "CXCL10", 2, 1.2], ["IRF1", "CXCL10", 1, 0.6], ["IRF1", "PD-L1", 2, 0.6],
      ["CXCL9", "CXCR3", 2, -0.4], ["CXCL10", "CXCR3", 2, 0.3], ["CXCR3", "T-cell", 3, -1.1],
      ["PD-L1", "PD-1", 2, 0.9], ["PD-1", "T-cell", 2, -0.7], ["T-cell", "Tumor", 3, -1.5],
      ["TGFβ", "SMAD3", 2, -1.2], ["SMAD3", "Tumor", 2, -0.9], ["TGFβ", "T-cell", 1, -1.2],
    ],
    "Signaling network",
    "network",
  );

  // Experiment 8 — a paired (grouped Cleveland) dot plot: two heritability estimates
  // per trait on a shared row, grouped into labelled domain sections (leading text column).
  const heritability = addExperimentGraph(
    "Experiment 8",
    "Heritability",
    "column",
    ["Trait", "Domain", "Twin (h²)", "GWAS (h²SNP)"],
    [
      ["Educational attainment", "Cognition & SES", 0.43, 0.11],
      ["Adult IQ", "Cognition & SES", 0.8, 0.19],
      ["Subjective wellbeing", "Psychology", 0.36, 0.04],
      ["Neuroticism", "Psychology", 0.37, 0.09],
      ["Alcohol dependence", "Substance use", 0.49, 0.18],
      ["Cigarettes per day", "Substance use", 0.66, 0.11],
      ["ADHD", "Psychiatric", 0.74, 0.22],
      ["Schizophrenia", "Psychiatric", 0.81, 0.2],
    ],
    "Heritability dot plot",
    "paireddot",
  );
  // Twin-study vs SNP-based heritability of the same eight traits: a paired comparison, and
  // with n = 8 bounded proportions the appropriate test is Wilcoxon's signed-rank, not a paired t.
  // (The "missing heritability" gap: the SNP estimate is lower on every trait.)
  fileAnalysis(
    "Wilcoxon — Twin (h²) vs GWAS (h²SNP)",
    "ttest",
    heritability.table.id,
    { columns: [heritability.table.columns[2]!.id, heritability.table.columns[3]!.id], variant: "wilcoxon", conf: 0.95, tail: "two-sided" },
    heritability.target,
  );

  // Apply the house style (MadY default) to every sample graph so the app opens
  // on it — and new graphs of any type match (they seed from the same profile).
  const housePreset = findPreset("MadY default");
  if (housePreset) for (const id of plotIds) doc.applyStylePreset(id, housePreset);
  /**
   * …then the chart type's own house default, exactly as `seedNewPlot` layers it over the
   * preset for a graph the user creates.
   *
   * A preset is kind-agnostic; `KIND_HOUSE_DEFAULTS` is where a type's tuned look lives (the
   * bar entry: 0.38 bar width, 14px data points, an 18px legend). Without this the demo graphs
   * would be the one place in the program that does not show the type's real default — a
   * user's first bar chart would look nothing like the bar chart the app opens on. It does
   * nothing for a kind with no entry, so it follows the table as entries are added, with no
   * per-kind code here.
   */
  const snap = doc.toJSON();
  for (const id of plotIds) {
    const p = snap.plots.find((pl) => pl.id === id);
    applyKindHouseDefaults(doc, id, p?.kind, tableDatasets);
  }
  doc.recompute();

  // The sample IS the initial state — building it should not be user-undoable.
  doc.commands.clear();
  return doc;
}
