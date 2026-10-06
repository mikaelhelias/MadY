import { tableDatasets } from "@mady/core";
import { isAnalysisCurve } from "@mady/contracts";
import type { AnalysisResult, MadyDocument, PlotFit } from "@mady/core";
import { PALETTES, seriesColor } from "@mady/graphics";
import { engineBand, fitDoseMarker, meltMarker } from "./analysisExport";
import { fitParamRows } from "./fitParams";

interface Curve { x: (number | null)[]; y: (number | null)[]; ciLow?: (number | null)[]; ciHigh?: (number | null)[]; piLow?: (number | null)[]; piHigh?: (number | null)[]; label?: string; tm?: number }

/** Used on both first fit and rerun; drawing style stays on the existing plot. */
export function applyAnalysisFit(doc: MadyDocument, analysisId: string, plotId: string): boolean {
  const project = doc.toJSON();
  const analysis = project.analyses.find(a => a.id === analysisId);
  const plot = project.plots.find(p => p.id === plotId);
  const table = analysis && project.tables.find(t => t.id === analysis.source);
  const result = analysis?.result;
  if (!analysis || analysis.status !== "ok" || !result || !plot || !table) return false;
  // Melting temperature, like a global fit, draws ONE curve per sample (each with its Tm crosshair).
  const perSample = analysis.method === "globalfit" || analysis.method === "meltingtemp";
  const melt = analysis.method === "meltingtemp";
  const curves = perSample ? result.extra?.curves as Curve[] | undefined
    : [(analysis.method === "regression" ? result.extra?.curve : (result as AnalysisResult & { curve?: Curve }).curve) as Curve | undefined];
  if (!Array.isArray(curves) || !curves.length || !curves.every(isAnalysisCurve)) return false;
  const datasets = tableDatasets(table);
  const palette = plot.palette ? PALETTES[plot.palette] : undefined;
  const fits: PlotFit[] = [];
  for (const [i, curve] of curves.entries()) {
    if (!curve || !Array.isArray(curve.x) || !Array.isArray(curve.y)) return false;
    const points = curve.x.map((x, j) => [x, curve.y[j]!] as [number | null, number | null])
      .filter((p): p is [number, number] => p.every(v => typeof v === "number" && Number.isFinite(v)));
    if (points.length < 2) return false;
    const confidenceBand = engineBand(curve.x, curve.ciLow, curve.ciHigh);
    const predictionBand = engineBand(curve.x, curve.piLow, curve.piHigh);
    const unit = typeof result.extra?.["unit"] === "string" ? result.extra["unit"] : "";
    const marker = analysis.method === "curvefit" ? fitDoseMarker(result)
      : melt ? meltMarker({ x: points.map((p) => p[0]), y: points.map((p) => p[1]) }, (curve as Curve).tm, unit) : null;
    // A melting-temperature analysis of ONE sample gets the line-by-line results block (Tm by fit, by
    // derivative…), its term names without the "— sample" suffix; several samples show a Tm crosshair
    // each and no block (a per-sample block has no line controls).
    const rows = analysis.method === "globalfit" || (melt && curves.length > 1) ? []
      : fitParamRows(melt ? (result.terms ?? []).map((t) => ({ ...t, term: String(t.term).replace(/ — [^—]+$/, "") })) : result.terms ?? []);
    const params = rows.map((r) => r.text);
    const index = datasets.findIndex(ds => ds.name === curve.label);
    const dsIndex = index >= 0 ? index : i;
    const dsId = datasets[dsIndex]?.id;
    const color = (dsId ? plot.seriesStyles?.[dsId]?.color : undefined)
      ?? (palette ? palette[dsIndex % palette.length] : undefined) ?? seriesColor(dsIndex);
    fits.push({ label: curve.label ?? result.title, points, analysisSource: analysisId,
      ...(perSample ? { color } : {}),
      ...(confidenceBand ? { confidenceBand } : {}), ...(predictionBand ? { predictionBand } : {}),
      ...(marker ? { marker } : {}), ...(params.length ? { params, paramKeys: rows.map((r) => r.key) } : {}) });
  }
  if (analysis.method === "globalfit" || (melt && fits.length > 1)) doc.setPlotFits(plotId, fits);
  else doc.setPlotFit(plotId, fits[0]!);
  return true;
}
