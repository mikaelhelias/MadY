import { isAnalysisCurve } from "@mady/contracts";
import { fitXOrigin, xColumn } from "@mady/core";
import type { AnalysisResult, MadyDocument, Plot, PlotFit, Project } from "@mady/core";
import { PALETTES, seriesColor, xyFamilyDatasets } from "@mady/graphics";
import { engineBand, fitDoseMarker, meltMarker } from "./analysisExport";
import { fitParamRows } from "./fitParams";

interface Curve { x: (number | null)[]; y: (number | null)[]; ciLow?: (number | null)[]; ciHigh?: (number | null)[]; piLow?: (number | null)[]; piHigh?: (number | null)[]; label?: string; tm?: number }

/** The graphs drawing this analysis's fitted curves with a ΔTm on a marker: what the analysis
 *  sheet's "ΔTm on the graph" tick-box reads and writes. Empty without a control. */
export function deltaTmPlots(project: Project, analysisId: string): Plot[] {
  return project.plots.filter((p) => [p.fit, ...(p.fits ?? [])].some((f) => f?.analysisSource === analysisId && f.marker?.delta));
}

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
  // The series as the graph draws and colours them: a column of names (a note, a sample label) is not one, so it takes
  // no colour slot — counting it would shift every fit onto the next series' colour.
  const datasets = xyFamilyDatasets(table);
  const palette = plot.palette ? PALETTES[plot.palette] : undefined;
  // A curve fit or global fit on a date X was fitted on days since the first date: its curve goes back onto the dates.
  // On a time-typed X, the fitted times print as times.
  const xColId: string | undefined = analysis.method === "curvefit" ? analysis.params.columns?.[0] : analysis.method === "globalfit" ? xColumn(table)?.id : undefined;
  const origin = xColId ? fitXOrigin(table, xColId) : 0;
  const xType = xColId ? table.columns.find((c) => c.id === xColId)?.type : undefined;
  const xTime = xType === "date" || xType === "elapsed" ? { type: xType, origin } : undefined;
  const fits: PlotFit[] = [];
  for (const [i, raw] of curves.entries()) {
    if (!raw || !Array.isArray(raw.x) || !Array.isArray(raw.y)) return false;
    const curve: Curve = origin ? { ...raw, x: raw.x.map((v) => (typeof v === "number" ? v + origin : v)) } : raw;
    const points = curve.x.map((x, j) => [x, curve.y[j]!] as [number | null, number | null])
      .filter((p): p is [number, number] => p.every(v => typeof v === "number" && Number.isFinite(v)));
    if (points.length < 2) return false;
    const confidenceBand = engineBand(curve.x, curve.ciLow, curve.ciHigh);
    const predictionBand = engineBand(curve.x, curve.piLow, curve.piHigh);
    const unit = typeof result.extra?.["unit"] === "string" ? result.extra["unit"] : "";
    // The sample's shift from the control, when the analysis had one (none for the control itself).
    const dtm = melt ? (result.extra?.["samples"] as { label?: string; dtm?: number }[] | undefined)?.find((s) => s.label === curve.label)?.dtm : undefined;
    const dose = analysis.method === "curvefit" ? fitDoseMarker(result) : null;
    const marker = dose ? { ...dose, x: dose.x + origin }
      : melt ? meltMarker({ x: points.map((p) => p[0]), y: points.map((p) => p[1]) }, (curve as Curve).tm, unit, dtm) : null;
    // A melting-temperature analysis of ONE sample gets the line-by-line results block (Tm by fit, by
    // derivative…), its term names without the "— sample" suffix; several samples show a Tm crosshair
    // each and no block (a per-sample block has no line controls).
    const rows = analysis.method === "globalfit" || (melt && curves.length > 1) ? []
      : fitParamRows(melt ? (result.terms ?? []).map((t) => ({ ...t, term: String(t.term).replace(/ — [^—]+$/, "") })) : result.terms ?? [], { xTime });
    const params = rows.map((r) => r.text);
    // A per-sample curve names its series; a single-curve fit fitted its Y column (`columns[1]`).
    const fittedId: string | undefined = perSample ? undefined : analysis.params.columns?.[1];
    const index: number = perSample ? datasets.findIndex(ds => ds.name === curve.label) : datasets.findIndex(ds => ds.id === fittedId);
    const dsIndex = index >= 0 ? index : i;
    const dsId = datasets[dsIndex]?.id;
    const color = (dsId ? plot.seriesStyles?.[dsId]?.color : undefined)
      ?? (palette ? palette[dsIndex % palette.length] : undefined) ?? seriesColor(dsIndex);
    // On a graph of two or more series a fit is drawn in the colour of the series it fitted, so each
    // curve reads as its data's; a graph of one series keeps the fit's own contrasting colour.
    const ownColor = perSample || (index >= 0 && datasets.length >= 2);
    fits.push({ label: curve.label ?? result.title, points, analysisSource: analysisId,
      // The series it fitted: the graph draws the curve on that series' Y axis.
      ...(index >= 0 && dsId ? { series: dsId } : {}),
      ...(ownColor ? { color } : {}),
      ...(confidenceBand ? { confidenceBand } : {}), ...(predictionBand ? { predictionBand } : {}),
      ...(marker ? { marker } : {}), ...(params.length ? { params, paramKeys: rows.map((r) => r.key) } : {}) });
  }
  // This analysis's curves join the graph; another analysis's curves already on it stay.
  doc.setAnalysisFits(plotId, analysisId, fits);
  return true;
}
