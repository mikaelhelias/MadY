/**
 * The report's "Create graph" — one sequence, shared by the shell and its test.
 *
 * Order matters: the kind's house look, then the theme's preset, then the script's own options
 * and series styles on top. Applied the other way round, the preset's colour pass would replace a
 * `scale_fill_gradient2`.
 */
import { STYLE_PRESETS } from "@mady/core";
import type { DataTable, MadyDocument, NodeId, Plot, PlotKind } from "@mady/core";
import type { GgplotImportResult } from "./GgplotImportDialog";
import { applyPresetWithKindDefaults } from "./seedStyle";

export function applyGgplotImport(
  d: MadyDocument,
  r: GgplotImportResult,
  /** The creation-time seeding the shell applies to every new graph (house style + stamps). */
  seed: (d: MadyDocument, plotId: NodeId, kind: PlotKind | undefined) => void,
): { table: DataTable; plot: Plot } {
  const table = d.adoptImportedTable(r.table, r.table.name);
  const plot = d.addPlot(r.name, table.id);
  d.setPlotKind(plot.id, r.kind);
  seed(d, plot.id, r.kind);
  const preset = r.preset ? STYLE_PRESETS.find((p) => p.name === r.preset) : undefined;
  if (preset) applyPresetWithKindDefaults(d, plot.id, r.kind, preset);
  d.setPlotOptions(plot.id, r.plot);
  for (const [name, style] of Object.entries(r.seriesStylesByName)) {
    // Lead columns only: a replicate / SD subcolumn shares the lead's look.
    const col = table.columns.find((c) => c.name === name && !c.group);
    if (col) d.setSeriesStyle(plot.id, col.id, style);
  }
  d.recompute();
  return { table, plot: d.toJSON().plots.find((p) => p.id === plot.id) ?? plot };
}

/** One line for the project log: the tallies, then every non-honoured row. */
export function ggplotImportLogDetail(r: GgplotImportResult): string {
  const counts = { honoured: 0, approximated: 0, refused: 0 };
  for (const row of r.report) counts[row.verdict]++;
  const rest = r.report.filter((row) => row.verdict !== "honoured").map((row) => `${row.call}: ${row.note}`).join("; ");
  return `${counts.honoured} honoured · ${counts.approximated} approximated · ${counts.refused} refused${rest ? " — " + rest : ""}`;
}
