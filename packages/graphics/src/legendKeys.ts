import type { LegendEntry, PlotScene } from "./scene.js";
import { swarmDotRadius } from "./markGeometry.js";

/**
 * A legend key looks like the mark it names — its line, its dot, the dot's fill, edge and size. No line
 * in the legend when the graph draws none, and a two-tone legend dot where the graph's dots are two-tone.
 *
 * Run once at the choke point, after every builder: it reads what the chart draws and writes it onto the rows.
 *   • Line — a series row draws its line only when the series draws one (`linePath` / `overlayLine`).
 *   • Dot  — radar, lollipop and paired dot draw their dots themselves and have no `scene.series` for the legend
 *            renderer to copy, so without this their rows would get the flat series colour (solid keys beside
 *            two-tone dots, or a key larger than its dot). The row carries the dot exactly as the chart draws it (`dot`).
 * Rows that already key a bar (`swatch: "bar"`), a data-driven marker (`symbol`) or a line-only trace
 * (`marker: false`) are left alone.
 */
export function matchKeysToMarks(scene: PlotScene): void {
  // Fitted curves listed as rows of their own (`fitStyle.inLegend`): the curve is keyed there, so a points-only series
  // does not borrow the curve's line for its key — it would name the same line twice.
  const fitsListed = scene.legend.some((e) => e.select?.as === "fit");
  for (const e of scene.legend) {
    // User option: a bar series whose bars carry their data points keys as the point (`LegendSpec.barKey`), drawn
    // exactly as the dots over its bars are (the renderer's ScatterGlyph): shape, swarm size, colour, fill, edge.
    if (scene.legendLayout.barKey === "point" && e.swatch === "bar" && e.select?.as === "series") {
      const id = e.select.id;
      const s = scene.series.find((x) => x.id === id);
      if (s && s.marks.some((m) => m.bar && m.points && m.points.length > 0)) {
        delete e.swatch;
        e.line = false;
        e.dot = {
          shape: s.symbol,
          size: swarmDotRadius(s.symbolSize),
          color: s.pointColor ?? s.color,
          fill: s.symbolFill,
          fillColor: s.pointColor ? undefined : s.symbolFillColor,
          outline: s.pointColor ?? s.symbolOutline ?? s.color,
          opacity: s.symbolOpacity,
          borderWidth: s.symbolBorderWidth ?? s.borderWidth ?? 1.2,
        };
        continue;
      }
    }
    if (e.swatch === "bar" || e.symbol || e.dataDriven || e.marker === false) continue;
    if (e.select?.as === "series") {
      const id = e.select.id;
      const s = scene.series.find((x) => x.id === id);
      if (s) {
        if (!s.linePath && !s.overlayLine && (fitsListed || !fitCurveIn(scene, s.color))) e.line = false;
        continue;
      }
      const dot = drawnDot(scene, id);
      if (dot === null) e.marker = false;
      else if (dot) e.dot = dot;
      // A dumbbell's only line is the neutral connector joining a row's two dots — it belongs to no series, so a
      // series' key is its dot alone (a line in the series' colour would show something the chart never draws).
      if (scene.lollipop) e.line = false;
      // A paired dot draws a series' own line only as its stems (the "to zero" display); a dumbbell's connector is neutral.
      if (scene.paireddot && !scene.paireddot.rows.some((r) => r.marks.some((m) => m.id === id && m.stem))) e.line = false;
      continue;
    }
    // A row that names a colour, not a series (a volcano's up / down / not-significant zones): the key is the dot
    // the chart draws in that colour — otherwise two-tone zone dots would sit beside solid keys with a line.
    const zoned = markInColour(scene, e.color);
    if (zoned) {
      e.dot = zoned.dot;
      if (!zoned.line) e.line = false;
    }
  }
}

/**
 * Whether a fitted curve is drawn in `color`. A fit carries no series id — the analysis draws each series' curve in that
 * series' colour, which is how a reader pairs them too — so a points-only series with its fitted curve keys as dot + line
 * (a line drawn on the chart belongs in the legend).
 */
function fitCurveIn(scene: PlotScene, color: string): boolean {
  // The single fitted curve is drawn in its own colour (the palette's second, to stand apart from the points) and
  // belongs to the chart's data as a whole, so every series keeps its line while it is drawn — a curve on the chart
  // must never take the line out of the legend of an XY chart.
  if (scene.fit?.showCurve && scene.fit.path) return true;
  return (scene.fits ?? []).some((f) => f.showCurve && !!f.path && f.color.toLowerCase() === color.toLowerCase());
}

/** The first drawn mark whose own fill is `color`, as the renderer's `Marker` draws it, and whether its series draws a line. */
function markInColour(scene: PlotScene, color: string): { dot: NonNullable<LegendEntry["dot"]>; line: boolean } | undefined {
  for (const s of scene.series) {
    const m = s.marks.find((x) => x.fill === color);
    if (!m) continue;
    return {
      dot: {
        shape: m.symbol ?? s.symbol,
        size: m.symbolSize ?? s.symbolSize,
        color: m.fill ?? s.color,
        fill: m.symbolFill ?? s.symbolFill,
        fillColor: m.symbolFillColor ?? s.symbolFillColor,
        outline: m.symbolOutline ?? s.symbolOutline ?? m.fill ?? s.color,
        opacity: m.symbolOpacity ?? m.fillOpacity ?? s.symbolOpacity,
        borderWidth: s.symbolBorderWidth ?? s.borderWidth ?? 1.2,
      },
      line: !!s.linePath || !!s.overlayLine,
    };
  }
  return undefined;
}

/** The dot a self-drawn chart draws for series `id`, as the renderer draws it; null = it draws none. */
function drawnDot(scene: PlotScene, id: string): LegendEntry["dot"] | null | undefined {
  const radar = scene.radar;
  if (radar) {
    const poly = radar.polygons.find((p) => p.id === id);
    if (!poly) return undefined;
    if (radar.showDots === false) return null;
    const fill = poly.vertexFill ?? poly.color;
    // The renderer: fill = vertexFill ?? colour, stroke = vertexOutline ?? none, 1.5 px only with an outline.
    return { shape: "circle", size: radar.dotSize ?? 2.5, color: fill, fill: "solid", outline: poly.vertexOutline ?? fill, borderWidth: poly.vertexOutline ? 1.5 : 0 };
  }
  const lp = scene.lollipop;
  if (lp) {
    const d = lp.rows.flatMap((r) => r.dots).find((x) => x.id === id);
    return d ? { shape: d.symbol ?? "circle", size: d.size ?? lp.dotSize, color: d.color, fill: d.symbolFill ?? "solid", fillColor: d.symbolFillColor, outline: d.symbolOutline ?? "var(--bg)", opacity: d.symbolOpacity ?? 1, borderWidth: d.borderWidth ?? 1.5 } : undefined;
  }
  const pd = scene.paireddot;
  if (pd) {
    const d = pd.rows.flatMap((r) => r.marks).find((x) => x.id === id && Number.isFinite(x.value));
    return d ? { shape: d.symbol ?? "circle", size: d.size ?? pd.dotSize, color: d.color, fill: d.symbolFill ?? "solid", fillColor: d.symbolFillColor, outline: d.symbolOutline ?? "var(--bg)", opacity: d.symbolOpacity ?? 1, borderWidth: d.borderWidth ?? 1.5 } : undefined;
  }
  return undefined;
}
