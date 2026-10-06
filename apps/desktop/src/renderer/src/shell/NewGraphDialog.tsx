import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactElement } from "react";
import type { BoxWhisker, ColumnType, DataTable, EntryMode, ErrorBarType, Plot, ProjectFolder, TableKind } from "@mady/core";
import { drawableErrorTypes, ENTRY_MODE_OPTIONS, replicateCount, TABLE_FORMAT_ORDER, TABLE_FORMATS, tableDatasets, tableEntryMode, tableFormat } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { defaultFormat, genreByKey, NEW_GRAPH_GENRES, SUGGESTION_ORDER, suggestedGenres } from "./newGraph";
import type { NewGraphDest, NewGraphSpec } from "./newGraph";
import { getAppDefaults } from "./profile";
import { DataIcon } from "./dataIcons";
import { GuideHelp } from "./guideLink";
import { FIGURE_DEFAULT_H, FIGURE_DEFAULT_W } from "./figureFit";
import { hasSample, sampleFor } from "./gallery";
import { PlotFigure } from "./PlotFigure";
import { measureText } from "./textMeasure";

/** Error-bar type choices (mirrors the model's `ErrorBarType`). */
const ERROR_OPTIONS: Array<{ id: ErrorBarType; label: string }> = [
  { id: "sd", label: "Mean ± SD" },
  { id: "sem", label: "Mean ± SEM" },
  { id: "ci95", label: "Mean ± 95% CI" },
  { id: "range", label: "Mean + range (min → max)" },
  { id: "geoSd", label: "Geometric (×/÷ SD)" },
  // The median option — each entry names its own centre (no invalid "median ± SD"). The
  // builder already draws errorBars:"iqr" median-centred (bar/marker at the median, Q1–Q3
  // whiskers); this just surfaces it at creation, matching the Inspector's Error-bars → Type.
  { id: "iqr", label: "Median + IQR (Q1–Q3)" },
];

/** Whisker/spread definition for box · violin · raincloud (mirrors `BoxWhisker`). The
 *  sd/sem/ci95 variants are mean-centered (box collapses to the mean, whiskers = mean ± error). */
const WHISKER_OPTIONS: Array<{ id: BoxWhisker; label: string }> = [
  { id: "tukey", label: "Tukey (1.5·IQR)" },
  { id: "minmax", label: "Min to max" },
  { id: "p10_90", label: "10–90 percentile" },
  { id: "p5_95", label: "5–95 percentile" },
  { id: "p2_5_97_5", label: "2.5–97.5 percentile" },
  { id: "p1_99", label: "1–99 percentile" },
  { id: "sd", label: "Mean ± SD" },
  { id: "sem", label: "Mean ± SEM" },
  { id: "ci95", label: "Mean ± 95% CI" },
];

// Data-entry formats for replicate-capable tables come from the shared
// `ENTRY_MODE_OPTIONS` (core) — the same list the datasheet "Entry" rail renders, so
// the two dropdowns can't offer different sets. The dialog uses the roomy `label`.

// ── Inline preview of the genre's sample graph, shown only when "Start with sample data"
// is ticked (so it is exactly what Create will make). With SAMPLE_PREVIEW false the
// dialog shows the schematic icon only. ──
const SAMPLE_PREVIEW = true;

/**
 * The size the sample graph is built at — its own set size, else the real default (580×380).
 * Fonts and margins are fixed pixels, so building small would squash the plot area (the same
 * reason GalleryPane builds at full size). Building at the real size and letting CSS
 * (`max-width:100%`) shrink the SVG uniformly makes the preview a faithful miniature: every
 * proportion is the final one.
 */
export function previewSceneSize(plot: Pick<Plot, "figureWidth" | "figureHeight">): { width: number; height: number } {
  return { width: plot.figureWidth ?? FIGURE_DEFAULT_W, height: plot.figureHeight ?? FIGURE_DEFAULT_H };
}

/** Clamp the preview's inspect-zoom — a visual magnifier (CSS scale), not a data
 *  zoom — to a usable range (0.25×–4×). */
export function clampPreviewZoom(z: number): number {
  return Math.min(4, Math.max(0.25, z));
}

/** A live render of the genre's sample graph, at its real proportions, that the
 *  user can inspect: scroll to zoom, ± / Fit controls, and it grows when the section is enlarged by
 *  dragging the divider above it. Memoised on the genre key → rebuilds only on a genre change. */
function SamplePreview({ genreKey, format }: { genreKey: string; format: TableKind }): ReactElement | null {
  const scene = useMemo(() => {
    const item = sampleFor(genreKey, format);
    return item ? buildPlotScene(item.table, item.plot, { measure: measureText, ...previewSceneSize(item.plot) }) : null;
  }, [genreKey, format]);
  const [zoom, setZoom] = useState(1);
  useEffect(() => setZoom(1), [genreKey, format]); // a new genre/format starts fitted
  // Wheel-to-zoom is a non-passive native listener (React's onWheel can be passive, so preventDefault
  // there is a no-op and the modal scrolls instead) — the same pattern PlotFigure uses for its wheel.
  const viewRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = viewRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      setZoom((z) => clampPreviewZoom(z * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);
  if (!scene) return null;
  return (
    <div className="ng-preview" aria-label="Sample graph preview">
      <div className="ng-preview-bar">
        <span className="ng-preview-hint">Scroll to zoom · drag the line above for more room</span>
        <span className="ng-preview-sp" />
        <button type="button" className="ng-zbtn" title="Zoom out" aria-label="Zoom out" onClick={() => setZoom((z) => clampPreviewZoom(z / 1.2))}>−</button>
        <span className="ng-zpct" aria-live="off">{Math.round(zoom * 100)}%</span>
        <button type="button" className="ng-zbtn" title="Zoom in" aria-label="Zoom in" onClick={() => setZoom((z) => clampPreviewZoom(z * 1.2))}>+</button>
        <button type="button" className="ng-zbtn ng-zfit" title="Fit the whole graph" aria-label="Fit zoom" onClick={() => setZoom(1)}>Fit</button>
      </div>
      <div className="ng-preview-view" ref={viewRef}>
        <div className="ng-preview-scale" style={{ transform: `scale(${zoom})` }}>
          <PlotFigure scene={scene} />
        </div>
      </div>
    </div>
  );
}

/**
 * A small inline schematic icon per graph genre — the visual anchor of the picker
 * (matches the `DataIcon` house style: 36×32 viewBox, `currentColor` strokes).
 */
export function GraphIcon({ genre }: { genre: string }): ReactElement {
  const p = { fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const dot = (cx: number, cy: number, r = 1.7): ReactElement => <circle cx={cx} cy={cy} r={r} fill="currentColor" stroke="none" />;
  const bar = (x: number, y: number, w = 5): ReactElement => <rect x={x} y={y} width={w} height={27 - y} rx={1} {...p} />;
  const acc = { fill: "var(--accent)", stroke: "none", opacity: 0.85 } as const;
  let body: ReactElement;
  switch (genre) {
    case "xy":
      body = <><line x1={4} y1={25} x2={32} y2={6} {...p} />{dot(8, 21)}{dot(15, 16)}{dot(22, 11)}{dot(29, 7)}</>;
      break;
    case "area":
      body = <><path d="M4 26 L4 18 L12 10 L20 15 L28 6 L32 9 L32 26 Z" fill="currentColor" opacity={0.28} stroke="none" /><polyline points="4,18 12,10 20,15 28,6 32,9" {...p} /></>;
      break;
    case "bar":
      body = <>{bar(6, 12)}{bar(15, 7)}{bar(24, 15)}</>;
      break;
    case "scatter": {
      const cols: Array<[number, number]> = [[9, 13], [18, 9], [27, 16]];
      body = <>{cols.map(([x, y], i) => <line key={i} x1={x - 5} y1={y} x2={x + 5} y2={y} {...p} />)}{dot(9, 9)}{dot(9, 17)}{dot(18, 6)}{dot(18, 13)}{dot(27, 13)}{dot(27, 20)}</>;
      break;
    }
    case "box":
      body = <><line x1={18} y1={4} x2={18} y2={9} {...p} /><rect x={9} y={9} width={18} height={13} rx={1} {...p} /><line x1={9} y1={16} x2={27} y2={16} {...p} /><line x1={18} y1={22} x2={18} y2={27} {...p} /></>;
      break;
    case "violin":
      body = <path d="M18 4 C9 8 9 14 14 18 C9 22 11 28 18 28 C25 28 27 22 22 18 C27 14 27 8 18 4 Z" {...p} />;
      break;
    case "beforeafter":
      body = <><line x1={11} y1={8} x2={25} y2={20} {...p} /><line x1={11} y1={20} x2={25} y2={12} {...p} />{dot(11, 8)}{dot(11, 20)}{dot(25, 20)}{dot(25, 12)}</>;
      break;
    case "floatingbar":
      body = <><rect x={6} y={8} width={5} height={11} rx={1} {...p} /><rect x={15} y={12} width={5} height={12} rx={1} {...p} /><rect x={24} y={5} width={5} height={10} rx={1} {...p} /></>;
      break;
    case "estimation":
      body = <>{dot(9, 9)}{dot(9, 14)}{dot(9, 19)}{dot(20, 8)}{dot(20, 13)}{dot(20, 18)}<line x1={29} y1={11} x2={29} y2={21} {...p} /><rect x={27.5} y={14} width={3} height={4} {...acc} /></>;
      break;
    case "groupedbar":
      body = <><rect x={6} y={12} width={4} height={15} rx={0.8} {...p} /><rect x={10.5} y={7} width={4} height={20} rx={0.8} {...acc} /><rect x={21} y={15} width={4} height={12} rx={0.8} {...p} /><rect x={25.5} y={10} width={4} height={17} rx={0.8} {...acc} /></>;
      break;
    case "stackedbar":
      body = <>{[[8, 5], [20, 8]].map(([x, top], i) => <g key={i}><rect x={x as number} y={top as number} width={8} height={7} {...acc} /><rect x={x as number} y={(top as number) + 7} width={8} height={6} fill="currentColor" opacity={0.5} stroke="none" /><rect x={x as number} y={(top as number) + 13} width={8} height={27 - ((top as number) + 13)} {...p} /></g>)}</>;
      break;
    case "contingency":
      body = <><rect x={6} y={6} width={24} height={20} rx={1.5} {...p} /><line x1={18} y1={6} x2={18} y2={26} {...p} /><line x1={6} y1={16} x2={30} y2={16} {...p} /><rect x={9} y={9} width={6} height={4} {...acc} /><rect x={21} y={19} width={6} height={4} {...acc} /></>;
      break;
    case "survival":
      body = <polyline points="4,6 12,6 12,12 20,12 20,19 27,19 27,25 33,25" {...p} />;
      break;
    case "pie":
      body = <><circle cx={18} cy={16} r={11} {...p} /><path d="M18 16 L18 5 A11 11 0 0 1 28 13 Z" {...acc} /><line x1={18} y1={16} x2={18} y2={5} {...p} /><line x1={18} y1={16} x2={28} y2={13} {...p} /></>;
      break;
    case "heatmap": {
      const cells = [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => ({ r, c })));
      body = <>{cells.map(({ r, c }, i) => <rect key={i} x={7 + c * 7.5} y={5 + r * 7.5} width={7} height={7} fill="var(--accent)" stroke="none" opacity={0.25 + ((r + c) % 3) * 0.28} />)}</>;
      break;
    }
    case "bubble":
      body = <>{dot(10, 20, 4)}{dot(20, 12, 6)}{dot(28, 22, 3)}{dot(15, 8, 2.4)}</>;
      break;
    case "histogram":
      body = <>{([[6, 18], [11, 10], [16, 6], [21, 11], [26, 20]] as Array<[number, number]>).map(([x, y], i) => <rect key={i} x={x} y={y} width={4.6} height={27 - y} {...p} />)}</>;
      break;
    case "radar":
      body = <><polygon points="18,4 30,12 26,26 10,26 6,12" {...p} /><polygon points="18,10 25,14 23,22 13,22 11,14" {...acc} /></>;
      break;
    case "scatter3d":
      body = <><path d="M6 22 L18 27 L30 22 M18 27 L18 12" {...p} opacity={0.55} />{dot(13, 15)}{dot(22, 18)}{dot(18, 9)}{dot(25, 12)}</>;
      break;
    case "ridgeline":
      body = <>{[6, 13, 20].map((y, i) => <path key={i} d={`M4 ${y + 6} C10 ${y} 14 ${y} 18 ${y + 4} C22 ${y + 8} 26 ${y} 32 ${y + 6}`} {...p} />)}</>;
      break;
    case "lollipop":
      body = <>{([[8, 20], [16, 10], [24, 15], [30, 7]] as Array<[number, number]>).map(([x, y], i) => <g key={i}><line x1={x} y1={26} x2={x} y2={y} {...p} />{dot(x, y, 2.4)}</g>)}</>;
      break;
    case "raincloud":
      body = <><path d="M6 12 C10 6 26 6 30 12 C26 15 10 15 6 12 Z" {...acc} /><line x1={9} y1={19} x2={27} y2={19} {...p} />{dot(11, 24)}{dot(16, 25)}{dot(20, 23)}{dot(25, 25)}</>;
      break;
    case "pyramid":
      body = <>{[7, 13, 19].map((y, i) => <g key={i}><rect x={18 - 4 - i * 3} y={y} width={4 + i * 3} height={4} {...p} /><rect x={18} y={y} width={5 + i * 2.5} height={4} {...acc} /></g>)}</>;
      break;
    case "volcano": // two arms of points + threshold guides
      body = <><line x1={18} y1={4} x2={18} y2={28} strokeDasharray="2 2" {...p} /><line x1={4} y1={20} x2={32} y2={20} strokeDasharray="2 2" {...p} />{dot(8, 9)}{dot(11, 13)}{dot(25, 11)}{dot(28, 7)}{dot(15, 24)}{dot(19, 25)}{dot(22, 23)}</>;
      break;
    case "forest": // rows of estimate + whisker, a null line
      body = <><line x1={18} y1={4} x2={18} y2={28} strokeDasharray="2 2" {...p} />{[8, 15, 22].map((y, i) => <g key={i}><line x1={8 + i * 2} y1={y} x2={24 + i} y2={y} {...p} /><rect x={13 + i * 2} y={y - 2} width={4} height={4} {...acc} /></g>)}</>;
      break;
    case "blandaltman": // difference scatter between two limit lines
      body = <><line x1={4} y1={9} x2={32} y2={9} strokeDasharray="2 2" {...p} /><line x1={4} y1={16} x2={32} y2={16} {...p} /><line x1={4} y1={23} x2={32} y2={23} strokeDasharray="2 2" {...p} />{dot(9, 14)}{dot(15, 18)}{dot(21, 13)}{dot(27, 19)}</>;
      break;
    case "dendrogram": // a small tree
      body = <><polyline points="6,28 6,18 14,18 14,28" {...p} /><polyline points="22,28 22,20 30,20 30,28" {...p} /><polyline points="10,18 10,8 26,8 26,20" {...p} /></>;
      break;
    case "pcascore": // two clouds with ellipses
      body = <><ellipse cx={12} cy={12} rx={7} ry={4.5} transform="rotate(-20 12 12)" {...p} /><ellipse cx={24} cy={21} rx={7} ry={4.5} transform="rotate(-20 24 21)" {...p} />{dot(10, 11)}{dot(14, 13)}{dot(22, 20)}{dot(26, 22)}</>;
      break;
    case "pcaload": // loading vectors from the origin
      body = <><line x1={18} y1={16} x2={30} y2={7} {...p} /><line x1={18} y1={16} x2={28} y2={24} {...p} /><line x1={18} y1={16} x2={7} y2={11} {...p} />{dot(18, 16, 1.4)}</>;
      break;
    case "pcabiplot": // cloud + vectors
      body = <>{dot(9, 12)}{dot(13, 9)}{dot(25, 22)}{dot(28, 19)}<line x1={18} y1={16} x2={30} y2={8} {...p} /><line x1={18} y1={16} x2={8} y2={22} {...p} /></>;
      break;
    case "triplot": // the biplot's cloud + vectors, plus the variable points that make it a triplot
      body = <>{dot(9, 12)}{dot(13, 9)}{dot(25, 22)}{dot(28, 19)}<line x1={18} y1={16} x2={30} y2={7} {...p} /><line x1={18} y1={16} x2={7} y2={23} {...p} /><rect x={20} y={7} width={3} height={3} {...acc} /><rect x={11} y={23} width={3} height={3} {...acc} /></>;
      break;
    case "scree": // falling bars with a line
      body = <>{bar(6, 8, 4)}{bar(12, 14, 4)}{bar(18, 19, 4)}{bar(24, 22, 4)}<polyline points="8,8 14,14 20,19 26,22" {...p} /></>;
      break;
    case "roc": // the curve above the chance diagonal
      body = <><line x1={4} y1={28} x2={32} y2={4} strokeDasharray="2 2" {...p} /><path d="M4 28 C6 12 14 6 32 4" {...p} /></>;
      break;
    case "treemap": // nested area cells
      body = <><rect x={4} y={5} width={28} height={22} rx={1.5} {...p} /><line x1={18} y1={5} x2={18} y2={27} {...p} /><line x1={18} y1={15} x2={32} y2={15} {...p} /><line x1={25} y1={15} x2={25} y2={27} {...p} /><rect x={5.5} y={6.5} width={11} height={19} {...acc} /></>;
      break;
    case "sunburst": // concentric rings cut into sectors
      body = <><circle cx={18} cy={16} r={11} {...p} /><circle cx={18} cy={16} r={5} {...p} /><line x1={18} y1={5} x2={18} y2={11} {...p} /><line x1={23} y1={16} x2={29} y2={16} {...p} /><line x1={14.5} y1={19.5} x2={10.2} y2={23.8} {...p} /><path d="M18 7.2 A8.8 8.8 0 0 1 26.8 16" fill="none" stroke="var(--accent)" strokeWidth={3.2} opacity={0.85} /></>;
      break;
    case "corrmatrix": // a grid of pie glyphs, size ∝ |r|
      body = <>{([[8, 7, 1.6], [18, 7, 3.2], [28, 7, 2.2], [8, 16, 3.2], [18, 16, 1.4], [28, 16, 2.8], [8, 25, 2.2], [18, 25, 2.8], [28, 25, 1.6]] as Array<[number, number, number]>).map(([x, y, r], i) => <circle key={i} cx={x} cy={y} r={r} fill={i % 2 ? "currentColor" : "var(--accent)"} stroke="none" opacity={0.85} />)}</>;
      break;
    case "alluvial": // two stacks joined by ribbons
      body = <><rect x={5} y={5} width={5} height={10} {...acc} /><rect x={5} y={17} width={5} height={10} fill="currentColor" opacity={0.5} stroke="none" /><rect x={26} y={5} width={5} height={7} fill="currentColor" opacity={0.5} stroke="none" /><rect x={26} y={14} width={5} height={13} {...acc} /><path d="M10 5 C18 5 18 14 26 14 L26 27 C18 27 18 15 10 15 Z" fill="var(--accent)" stroke="none" opacity={0.3} /><path d="M10 17 C18 17 18 5 26 5 L26 12 C18 12 18 27 10 27 Z" fill="currentColor" stroke="none" opacity={0.2} /></>;
      break;
    case "network": // nodes + links
      body = <><line x1={9} y1={9} x2={18} y2={17} {...p} /><line x1={18} y1={17} x2={28} y2={8} {...p} /><line x1={18} y1={17} x2={11} y2={26} {...p} /><line x1={18} y1={17} x2={29} y2={24} {...p} />{dot(9, 9, 2.4)}{dot(28, 8, 2.4)}{dot(11, 26, 2.4)}{dot(29, 24, 2.4)}<circle cx={18} cy={17} r={3.2} {...acc} /></>;
      break;
    case "chord": // a ring with ribbons across it
      body = <><circle cx={18} cy={16} r={11.5} {...p} /><path d="M9.5 9 Q18 16 27.5 11" {...p} /><path d="M10 22 Q18 16 26 23" {...p} /><path d="M18 4.5 Q18 16 12 26.5" {...p} /><path d="M6.5 16 A11.5 11.5 0 0 1 12 6" fill="none" stroke="var(--accent)" strokeWidth={3.4} opacity={0.85} /></>;
      break;
    case "oncoprint": // genes × samples cells, some altered
      body = <>{[0, 1, 2].flatMap((r) => [0, 1, 2, 3, 4].map((c) => { const hit = (r === 0 && c < 3) || (r === 1 && c >= 3) || (r === 2 && c === 1); return <rect key={`${r}-${c}`} x={5 + c * 5.4} y={6 + r * 7} width={4.6} height={6} rx={0.6} fill={hit ? "var(--accent)" : "currentColor"} stroke="none" opacity={hit ? 0.9 : 0.18} />; }))}</>;
      break;
    case "parallel": // three vertical axes, lines crossing them
      body = <>{[6, 18, 30].map((x, i) => <line key={i} x1={x} y1={4} x2={x} y2={28} {...p} opacity={0.5} />)}<polyline points="6,8 18,20 30,12" {...p} /><polyline points="6,22 18,9 30,24" {...p} stroke="var(--accent)" opacity={0.85} /></>;
      break;
    case "paireddot": // rows of two dots joined
      body = <>{[8, 16, 24].map((y, i) => { const a = 7 + i * 3; const b = 22 + i * 3; return <g key={i}><line x1={a} y1={y} x2={b} y2={y} {...p} opacity={0.55} />{dot(a, y, 2.2)}<circle cx={b} cy={y} r={2.2} {...acc} /></g>; })}</>;
      break;
    case "funnel": // a pseudo-CI funnel, studies inside
      body = <><line x1={18} y1={4} x2={18} y2={28} strokeDasharray="2 2" {...p} /><line x1={18} y1={4} x2={5} y2={28} {...p} /><line x1={18} y1={4} x2={31} y2={28} {...p} />{dot(17, 9)}{dot(14, 15)}{dot(22, 14)}{dot(10, 23)}{dot(25, 21)}{dot(20, 25)}</>;
      break;
    case "venn": // two overlapping sets, the lens filled
      body = <><circle cx={14} cy={16} r={9.5} {...p} /><circle cx={22} cy={16} r={9.5} {...p} /><path d="M18 7.4 A9.5 9.5 0 0 1 18 24.6 A9.5 9.5 0 0 1 18 7.4 Z" {...acc} /></>;
      break;
    case "upset": // intersection bars over a membership dot matrix
      body = <>{([[8, 6], [15, 10], [22, 13], [29, 9]] as Array<[number, number]>).map(([x, y], i) => <rect key={i} x={x - 2} y={y} width={4} height={17 - y} rx={0.6} {...p} />)}{[20, 25].map((y, r) => [8, 15, 22, 29].map((x, c) => { const on = (r === 0 && c !== 2) || (r === 1 && c >= 1); return <circle key={`${r}-${c}`} cx={x} cy={y} r={1.7} fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth={0.8} opacity={on ? 1 : 0.35} />; }))}<line x1={15} y1={20} x2={15} y2={25} {...p} /><line x1={29} y1={20} x2={29} y2={25} {...p} /></>;
      break;
    case "swimmer": // one bar per subject, one still on therapy
      body = <>{([[6, 4, 14], [11, 4, 22], [16, 4, 10], [21, 4, 18]] as Array<[number, number, number]>).map(([y, x0, w], i) => <rect key={i} x={x0} y={y} width={w} height={3.6} rx={0.8} fill="currentColor" opacity={0.4} stroke="none" />)}<rect x={4} y={26} width={26} height={3.6} rx={0.8} {...acc} /><polyline points="30,25 33.5,27.8 30,30.6" {...p} /></>;
      break;
    case "ternary": // compositions in a triangle
      body = <><polygon points="18,4 32,27 4,27" {...p} />{dot(18, 14)}{dot(13, 21)}{dot(22, 20)}<circle cx={17} cy={23} r={1.7} {...acc} /></>;
      break;
    case "rose": // wedges from the centre
      body = <><circle cx={18} cy={17} r={11} {...p} opacity={0.45} /><path d="M18 17 L18 6 A11 11 0 0 1 27.5 11.5 Z" {...acc} /><path d="M18 17 L27.5 22.5 A11 11 0 0 1 20.9 27.6 Z" fill="currentColor" stroke="none" opacity={0.45} /><path d="M18 17 L8.5 11.5 A11 11 0 0 1 14.2 6.7 Z" fill="currentColor" stroke="none" opacity={0.3} /></>;
      break;
    case "tracks": // stacked tile strips over one time axis
      body = <>{[5, 13, 21].map((y, r) => [4, 11, 18, 25].map((x, c) => <rect key={`${r}-${c}`} x={x} y={y} width={6.6} height={6} rx={0.6} fill={r === 1 ? "var(--accent)" : "currentColor"} stroke="none" opacity={0.2 + ((r * 2 + c) % 4) * 0.2} />))}<line x1={4} y1={29} x2={32} y2={29} {...p} /></>;
      break;
    case "qq": // observed vs expected, lifting off the y = x line
      body = <><line x1={4} y1={28} x2={30} y2={6} strokeDasharray="2 2" {...p} />{dot(8, 24.6)}{dot(12, 21.2)}{dot(16, 17.8)}{dot(20, 14.4)}{dot(24, 9.5)}{dot(27, 4.5)}</>;
      break;
    case "manhattan": // the genome end to end in alternating tones, one peak above the line
      body = <><line x1={4} y1={9} x2={32} y2={9} strokeDasharray="2 2" {...p} />{[5, 7, 9, 11].map((x, i) => <circle key={`a${i}`} cx={x} cy={24 - ((i * 5) % 4)} r={1.3} fill="currentColor" stroke="none" />)}{[13, 15, 17, 19].map((x, i) => <circle key={`b${i}`} cx={x} cy={23 - ((i * 3) % 4)} r={1.3} fill="var(--accent)" stroke="none" opacity={0.85} />)}{[21, 23, 25, 27, 29, 31].map((x, i) => <circle key={`c${i}`} cx={x} cy={25 - ((i * 7) % 4)} r={1.3} fill={i < 3 ? "currentColor" : "var(--accent)"} stroke="none" opacity={0.85} />)}<circle cx={16} cy={12} r={1.3} fill="var(--accent)" stroke="none" /><circle cx={17} cy={6} r={1.6} fill="var(--accent)" stroke="none" /></>;
      break;
    case "waterfall": // bars sorted largest-first around a zero line
      body = <><line x1={4} y1={15} x2={32} y2={15} {...p} opacity={0.6} />{([[5, 5, 10], [10, 8, 7], [15, 12, 3]] as Array<[number, number, number]>).map(([x, y, h], i) => <rect key={`u${i}`} x={x} y={y} width={4} height={h} rx={0.6} fill="currentColor" opacity={0.55} stroke="none" />)}{([[20, 4], [25, 8], [30, 11]] as Array<[number, number]>).map(([x, h], i) => <rect key={`d${i}`} x={x} y={15} width={4} height={h} rx={0.6} {...acc} />)}</>;
      break;
    case "pareto": // descending bars + the cumulative-% line
      body = <>{bar(5, 8, 4.5)}{bar(11, 13, 4.5)}{bar(17, 18, 4.5)}{bar(23, 22, 4.5)}{bar(29, 24, 4.5)}<polyline points="7,20 13,13 19,9 25,6.5 31,5" {...p} stroke="var(--accent)" opacity={0.9} />{dot(31, 5, 1.8)}</>;
      break;
    case "abundance": // 100%-stacked bars with ribbons between the strata
      body = <>{[6, 24].map((x, i) => { const cuts = i === 0 ? [5, 13, 20] : [5, 10, 19]; return <g key={i}><rect x={x} y={cuts[0]} width={6} height={cuts[1]! - cuts[0]!} {...acc} /><rect x={x} y={cuts[1]} width={6} height={cuts[2]! - cuts[1]!} fill="currentColor" opacity={0.5} stroke="none" /><rect x={x} y={cuts[2]} width={6} height={27 - cuts[2]!} {...p} /></g>; })}<path d="M12 5 L24 5 L24 10 L12 13 Z" fill="var(--accent)" stroke="none" opacity={0.25} /><path d="M12 13 L24 10 L24 19 L12 20 Z" fill="currentColor" stroke="none" opacity={0.15} /></>;
      break;
    default:
      // A genre without an icon of its own gets a dashed frame rather than the bar icon, which
      // would tell the user it is a bar chart. `wizard-icons.test` fails for any genre that
      // reaches this fallback, so every listed genre draws its own icon above.
      body = <><rect x={5} y={5} width={26} height={22} rx={2} strokeDasharray="3 2" {...p} opacity={0.5} /><line x1={12} y1={16} x2={24} y2={16} {...p} opacity={0.5} /></>;
  }
  return <svg viewBox="0 0 36 32" width={40} height={34} aria-hidden="true">{body}</svg>;
}

/**
 * Divider-drag math (pure, so it can be unit-tested — jsdom has no layout). The dialog's two
 * sections — the graph-icon grid on top, the options below — share the modal's height. Dragging
 * the divider down (dy > 0) grows the top (shows more graph icons) by shrinking the options;
 * dragging it up grows the options. The result is clamped so the grid above and the Create buttons below always
 * keep room, regardless of how far the pointer travels.
 */
export function nextConfigHeight(startH: number, dy: number, modalH: number): number {
  const maxH = Math.max(120, modalH - 220); // leave ≥220px for the grid + the button row
  const minH = 72; // never crush the options to nothing
  return Math.min(maxH, Math.max(minH, startH - dy));
}

/**
 * NewGraphDialog — the "New Graph" popup. Three modes: data-first (the default: pick the
 * datasheet format → suggested graph types), graph-first (pick a graph genre → the dialog
 * filters to the compatible datasheet formats, best pre-selected) and datasheet only. It
 * also offers an error-bar type and replicate/entry shape for formats that support them.
 * Confirm builds a blank table of the chosen format + a ready-to-style graph (see
 * `createNewGraph`). Every graph type lives in one list. If a table is already selected,
 * its format is badged "your data".
 */
export function NewGraphDialog({
  currentTableKind,
  currentTable,
  preferOpenSheet = true,
  projects = [],
  onCreate,
  onCancel,
}: {
  currentTableKind?: TableKind | undefined;
  /** The datasheet the user is working in (open tab, or the active graph's source), if any.
   *  When the chosen graph accepts its format, the dialog offers — and defaults to — graphing
   *  that sheet instead of creating a blank one. */
  currentTable?: DataTable | undefined;
  /**
   * Does opening the dialog mean "graph this sheet"? True for the "New graph of this data" door
   * (the sheet is the point) → the open sheet is pre-selected as the data source. False for the
   * generic "New graph…" door (Graph ▸ New graph…, File ▸ New datasheet / graph…), which makes a
   * datasheet from scratch: the open sheet is still offered but a new blank one is pre-selected,
   * so a second "New graph…" never silently re-graphs the sheet you just made.
   */
  preferOpenSheet?: boolean | undefined;
  /** Existing projects (workspace folders) offered as a filing destination. */
  projects?: ProjectFolder[] | undefined;
  onCreate: (spec: NewGraphSpec) => void;
  onCancel: () => void;
}): ReactElement {
  // What to create: graph-first (pick a graph → compatible datasheet), data-first
  // (pick your datasheet → suggested graphs), or a bare datasheet.
  // The dialog opens in data-first mode (pick the datasheet shape → suggested graphs);
  // graph-first is a secondary toggle.
  const [output, setOutput] = useState<"graph" | "table" | "data-graph">("data-graph");
  // The user's preferred default type (Settings), clamped to a genre that still exists.
  const [genreKey, setGenreKey] = useState(() => {
    const g = getAppDefaults().defaultGenre;
    return g && NEW_GRAPH_GENRES.some((x) => x.key === g) ? g : "xy";
  });
  // Has the user clicked a graph card in this dialog? Until then, data-first mode pre-selects
  // the first suggestion for the sheet — the remembered Settings default (usually XY) must not
  // win over it, or a text-X matrix opens with "XY" lit while "Heatmap" sits first in the grid.
  const [genrePicked, setGenrePicked] = useState(false);
  // Data-type filter (graph mode: narrows the genre grid; table/data-first mode: is the
  // chosen format). Seeded so the default data-first flow opens with a datasheet picked.
  const [dataTypeFilter, setDataTypeFilter] = useState<TableKind | null>(currentTableKind ?? "xy");
  // Format override within a genre's compatible set (else the genre's best / the filter).
  const [formatOverride, setFormatOverride] = useState<TableKind | "">("");
  // null = "not chosen — follow the default", exactly as errorBars / whisker below. The default is
  // a blank sheet's shape (replicates x3) normally, but with sample data it is the example's own
  // shape, so the controls show what the sample really is instead of a value it does not have.
  const [entryMode, setEntryMode] = useState<EntryMode | null>(null);
  const [replicates, setReplicates] = useState<number | null>(null);
  // null = "follow the genre's default" (app-wide error type for most; "none" for a lollipop,
  // where whiskers are opt-in), so switching genres shows the right default without a reset.
  const [errorBars, setErrorBars] = useState<ErrorBarType | null>(null);
  // null = "follow the genre's natural default" (Tukey for box/violin/raincloud, min→max for a
  // floating bar's span), so switching genres without touching the control shows the right default.
  const [whisker, setWhisker] = useState<BoxWhisker | null>(null);
  const [sampleData, setSampleData] = useState(false);
  const [xColumnType, setXColumnType] = useState<ColumnType>("number");
  const [search, setSearch] = useState("");
  // Where to file the new datasheet + graph in the side tree. "" = top level (loose, the
  // default); a folder id = that project; "__new__" = create one.
  const [projectSel, setProjectSel] = useState<string>("");
  const [newProjectName, setNewProjectName] = useState("");
  // Experiment within the chosen/created project. "" = none; an id = that experiment;
  // "__new__" = create one under the project.
  const [experimentSel, setExperimentSel] = useState<string>("");
  const [newExperimentName, setNewExperimentName] = useState("");
  // Explicit height (px) of the options section when the user has dragged the divider; null =
  // the CSS default (a share of the modal that leaves the graph-icon grid roomy). Drag the
  // divider between the two sections to re-split the space.
  const [configH, setConfigH] = useState<number | null>(null);
  const dragDivider = (e: ReactPointerEvent<HTMLDivElement>): void => {
    e.preventDefault();
    const modal = e.currentTarget.closest(".modal-analyze") as HTMLElement | null;
    const config = e.currentTarget.nextElementSibling as HTMLElement | null; // .ng-config
    if (!config) return;
    const startY = e.clientY;
    const startH = config.getBoundingClientRect().height;
    const modalH = modal?.getBoundingClientRect().height ?? 600;
    const onMove = (ev: PointerEvent): void => setConfigH(nextConfigHeight(startH, ev.clientY - startY, modalH));
    const onUp = (): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const tableFirst = output === "table";
  // Data-first: choose the datasheet format, then compatible graph types are suggested.
  const dataFirst = output === "data-graph";
  // Enter data-first mode with a datasheet format already picked (their data, or XY).
  const startDataFirst = (): void => {
    setOutput("data-graph");
    setFormatOverride("");
    if (!dataTypeFilter) setDataTypeFilter(currentTableKind ?? "xy");
  };
  const q = search.trim().toLowerCase();
  const matches = (g: (typeof NEW_GRAPH_GENRES)[number]): boolean =>
    !q || g.label.toLowerCase().includes(q) || g.note.toLowerCase().includes(q);
  // Genres compatible with the active data-type filter (+ search) — the visible grid.
  // With a format picked the grid is in suggestion order (the first card is the pre-selected
  // suggestion, so the order is a claim — see SUGGESTION_ORDER); unfiltered = catalogue order.
  // The open sheet, when its format is the one picked, ranks the grid by what it actually
  // draws (each candidate is built once — memoised, the table object is stable per render).
  const ranked = useMemo(
    () => (dataTypeFilter ? suggestedGenres(dataTypeFilter, currentTable && currentTable.kind === dataTypeFilter ? currentTable : undefined) : NEW_GRAPH_GENRES),
    [dataTypeFilter, currentTable],
  );
  const filtered = ranked.filter(matches);
  // Effective genre: the user's click if still visible; otherwise, in data-first mode with a
  // sheet to rank by (or a format that has its own suggestion order), the first suggestion — the
  // ranked grid's claim; everywhere else the remembered Settings default when it is visible.
  // (Taking filtered[0] in every data-first case would silently override Settings →
  // "Default graph type" whenever nothing is open.)
  const rankedByData = !!currentTable && currentTable.kind === dataTypeFilter;
  const suggestionLed = dataFirst && (rankedByData || (dataTypeFilter !== null && SUGGESTION_ORDER[dataTypeFilter] !== undefined));
  const effGenreKey =
    genrePicked && filtered.some((g) => g.key === genreKey) ? genreKey
    : suggestionLed ? filtered[0]?.key ?? genreKey
    : filtered.some((g) => g.key === genreKey) ? genreKey : filtered[0]?.key ?? genreKey;
  const genre = genreByKey(effGenreKey) ?? NEW_GRAPH_GENRES[0]!;
  // Effective datasheet format: table mode = the picked filter; graph mode = explicit
  // override → the filter (if compatible with the genre) → the open sheet's format (if the
  // genre accepts it — so "Graph + datasheet" from a sheet keeps offering that sheet rather
  // than defaulting to the genre's first format and building a blank one) → the genre's best.
  const effFormat: TableKind = tableFirst
    ? dataTypeFilter ?? currentTableKind ?? "xy"
    : formatOverride && genre.formats.includes(formatOverride)
      ? formatOverride
      : dataTypeFilter && genre.formats.includes(dataTypeFilter)
        ? dataTypeFilter
        : currentTable && genre.formats.includes(currentTable.kind)
          ? currentTable.kind
          : defaultFormat(genre);
  const fmt = tableFormat(effFormat);
  const showReplicates = fmt.replicates;
  /**
   * Graph the open datasheet, or a new one? Offered whenever the dialog was opened from a
   * datasheet and the chosen graph accepts its format — and it is the default then, because
   * that is what "New graph" from an open sheet means to a user (a heatmap picked from the
   * "Cell profiling" sheet must graph that sheet, not produce a new, empty datasheet under the
   * heading "suggested graphs for this datasheet"). Not offered for "Datasheet only".
   *
   * The only test is "can this graph draw the open sheet's format" — not which format card is
   * lit. Also requiring `effFormat === currentTable.kind` would, from the multivariable
   * "Cell profiling" sheet, let clicking the XY card and then Parallel coordinates (which accepts
   * xy and multivariable) silently drop the open-sheet choice and build a blank XY sheet +
   * an empty graph.
   */
  const canUseOpen = !tableFirst && !!currentTable && genre.formats.includes(currentTable.kind);
  // Pre-select the open sheet only when opening the dialog meant "graph this sheet"; the generic
  // "New graph…" door starts on a fresh blank sheet (a second create must not
  // re-graph the sheet the first one just made).
  const [openChoice, setOpenChoice] = useState<"open" | "new">(preferOpenSheet ? "open" : "new");
  const useOpen = canUseOpen && openChoice === "open";
  // "Start with sample data": graph mode + the genre ships a ready-made example. Declared here,
  // above the error/whisker gates, because those ask what the sample can draw.
  const sampleAvailable = !tableFirst && !useOpen && hasSample(genre.key, effFormat);
  const useSample = sampleData && sampleAvailable;
  // The error-bar picker: graph mode + a genre that draws error bars, unless a summary
  // entry mode already fixes the type. (Table-only has no plot → no error bars.) For the
  // open sheet the question is its entry format, not the dialog's: a Median+IQR or Mean+SD
  // sheet already fixes the type, and the picker would offer choices it cannot draw.
  /**
   * The sample is real data with a fixed shape, exactly like the open sheet — so the same question
   * applies: can an error bar be drawn from its values? Ask the data, per dataset, not the entry
   * mode: `tableEntryMode` returns "replicates" as its fallback for any sheet without summary
   * columns, so a sample with one Y value per row and no replicates at all still reports
   * "replicates" while being unable to draw a single error bar. Gating on that would put a
   * picker on the XY sample that silently does nothing.
   */
  const sampleCanDrawError = useMemo(() => {
    if (!useSample) return false;
    const t = sampleFor(genre.key, effFormat)?.table;
    return !!t && tableDatasets(t).some((d) => drawableErrorTypes(d).some((e) => e !== "none"));
  }, [useSample, genre.key, effFormat]);
  /**
   * The shape the sample actually has. With sample data on, "Data entry" and "Replicates" start
   * here rather than at a blank sheet's defaults — so what they show is the truth, and Create
   * restructures the example only when the user genuinely changes one.
   */
  const sampleShape = useMemo(() => {
    const t = useSample ? sampleFor(genre.key, effFormat)?.table : undefined;
    return t ? { entryMode: tableEntryMode(t), replicates: replicateCount(t) } : undefined;
  }, [useSample, genre.key, effFormat]);
  const effEntryMode: EntryMode = entryMode ?? sampleShape?.entryMode ?? "replicates";
  const effReplicates: number = replicates ?? sampleShape?.replicates ?? 3;
  const showError = !tableFirst && Boolean(genre.errorCapable) &&
    (useOpen
      ? tableEntryMode(currentTable!) === "replicates"
      : useSample
        ? sampleCanDrawError
        : !showReplicates || effEntryMode === "replicates");
  // Lollipop error bars are opt-in (unusual on this kind, can crowd the dots): the picker gains a
  // "None" choice and defaults to it there, so a new lollipop is whisker-less unless the user asks.
  // Everywhere else the default is the app-wide error type. (errorBars === null = follow this default.)
  const isLollipopErr = genre.plotKind === "lollipop";
  const errorDefault: ErrorBarType = isLollipopErr ? "none" : (getAppDefaults().errorBars ?? "sd");
  const effErrorBars: ErrorBarType = errorBars ?? errorDefault;
  const errorChoices: Array<{ id: ErrorBarType; label: string }> = isLollipopErr
    ? [{ id: "none", label: "None (no error bars)" }, ...ERROR_OPTIONS]
    : ERROR_OPTIONS;
  // Whisker/spread definition for the distribution graphs — box/violin/raincloud choose it here
  // (incl. mean ± SD/SEM/CI), the same way bar/scatter choose their error-bar type. A floating
  // bar reuses the same choice to set what the bar spans (min→max default / percentiles / mean±err).
  const isFloatingSpan = genre.plotKind === "floatingbar";
  const showWhisker = !tableFirst && (genre.plotKind === "box" || genre.plotKind === "violin" || genre.plotKind === "raincloud" || isFloatingSpan);
  // The effective definition: the user's pick, else the genre default (min→max for a floating bar,
  // Tukey otherwise). A floating bar has no "Tukey" option, so fall back to min→max if it lingers.
  const whiskerDefault: BoxWhisker = isFloatingSpan ? "minmax" : "tukey";
  let effWhisker: BoxWhisker = whisker ?? whiskerDefault;
  if (isFloatingSpan && effWhisker === "tukey") effWhisker = "minmax";
  // A floating bar drops "Tukey" (it draws no whiskers to fence — the bar is the span).
  const whiskerChoices = isFloatingSpan ? WHISKER_OPTIONS.filter((o) => o.id !== "tukey") : WHISKER_OPTIONS;
  // X-axis type picker — only an XY datasheet has a continuous numeric X to reformat.
  const showXType = effFormat === "xy" && !useSample && !useOpen;
  const selectGenre = (key: string): void => {
    setGenreKey(key);
    setGenrePicked(true);
    setFormatOverride("");
  };

  // ── Destination (side-tree filing) ──
  const creatingProject = projectSel === "__new__";
  const selProject = projects.find((p) => p.id === projectSel);
  // A project is in play (existing or being created) → the Experiment row is offered.
  const haveProject = creatingProject || Boolean(selProject);
  const creatingExperiment = experimentSel === "__new__";
  // Choosing a different project can't keep a stale experiment from the old one.
  const chooseProject = (v: string): void => {
    setProjectSel(v);
    setExperimentSel("");
    setNewExperimentName("");
  };
  /** Resolve the picker state to a `NewGraphDest`, or undefined for top level. */
  const destFromPicker = (): NewGraphDest | undefined => {
    const dest: NewGraphDest = {};
    if (creatingProject) {
      if (newProjectName.trim()) dest.newFolderName = newProjectName.trim();
    } else if (selProject) {
      dest.folderId = selProject.id;
    }
    const willFile = Boolean(dest.folderId || dest.newFolderName);
    if (willFile) {
      if (creatingExperiment) {
        if (newExperimentName.trim()) dest.newExperimentName = newExperimentName.trim();
      } else if (experimentSel && dest.folderId) {
        dest.experimentId = experimentSel;
      }
    }
    return willFile ? dest : undefined;
  };

  // True only while a press that started on the overlay is in flight — see the overlay below.
  const pressStartedOnOverlay = useRef(false);
  const create = (): void => {
    const spec: NewGraphSpec = { tableKind: effFormat };
    if (tableFirst) spec.output = "table";
    else spec.genre = genre.key;
    if (!tableFirst && genre.analysis) spec.analysis = genre.analysis;
    if (useOpen && currentTable) {
      // The open sheet is the data: only the graph-side choices travel.
      spec.sourceTableId = currentTable.id;
      if (genre.errorCapable) spec.errorBars = effErrorBars;
      if (showWhisker) spec.boxWhisker = effWhisker;
      onCreate(spec);
      return;
    }
    const dest = destFromPicker();
    if (dest) spec.dest = dest;
    if (useSample) {
      // Sample data brings its own populated table, but every choice in this panel still applies
      // to it. The shape fields restructure the example's columns — keeping its
      // values — and createNewGraph skips the restructure when the pick already matches the sample.
      spec.sampleData = true;
      if (showReplicates) {
        spec.entryMode = effEntryMode;
        if (effEntryMode === "replicates") spec.replicates = effFormat === "column" ? 1 : effReplicates;
      }
      if (showError) spec.errorBars = effErrorBars;
      if (showWhisker) spec.boxWhisker = effWhisker;
    } else {
      if (showReplicates) {
        spec.entryMode = effEntryMode;
        // A simple Column datasheet has no replicate subcolumns — replicates are entered as
        // rows. Fix the count at 1 so the wizard never seeds confusing Control·1/·2/·3 columns.
        if (effEntryMode === "replicates") spec.replicates = effFormat === "column" ? 1 : effReplicates;
      }
      if (!tableFirst && genre.errorCapable) spec.errorBars = effErrorBars;
      if (showWhisker) spec.boxWhisker = effWhisker;
      if (showXType && xColumnType !== "number") spec.xColumnType = xColumnType;
    }
    onCreate(spec);
  };

  // A graph-genre card.
  const card = (g: (typeof NEW_GRAPH_GENRES)[number]): ReactElement => (
    <button
      key={g.key}
      type="button"
      data-genre={g.key}
      className={`an-card${g.key === effGenreKey ? " is-active" : ""}`}
      aria-pressed={g.key === effGenreKey}
      aria-label={g.label}
      title={g.note}
      onClick={() => selectGenre(g.key)}
    >
      <span className="an-card-ico"><GraphIcon genre={g.key} /></span>
      <span className="an-card-h">{g.label}</span>
      <span className="an-card-sub">{g.note}</span>
    </button>
  );

  // A data-type card: picks the format (table mode) or filters the genre grid (graph mode).
  const kindCard = (k: TableKind): ReactElement => {
    /*
     * The lit card is always the datasheet this dialog will actually create (`effFormat`), in
     * every mode.
     *
     * Falling back to `dataTypeFilter === k` in graph-first mode would leave nothing lit until
     * the user clicked a filter themselves — in the one mode whose entire point is "pick the
     * graph, the program suggests the datasheet for it". A single-format genre (survival, pie)
     * has no format dropdown either, so the suggestion would have no representation on screen.
     *
     * This does not cost the filter its highlight: picking a filter re-ranks the grid to genres
     * that accept it, so `effFormat` resolves to that same filter — the lit card still follows it.
     */
    const active = effFormat === k;
    return (
      <button
        key={k}
        type="button"
        data-kind={k}
        className={`an-card${active ? " is-active" : ""}${currentTableKind === k ? " is-current" : ""}`}
        aria-pressed={active}
        aria-label={TABLE_FORMATS[k].label}
        title={TABLE_FORMATS[k].description}
        onClick={() => setDataTypeFilter(tableFirst || dataFirst ? k : dataTypeFilter === k ? null : k)}
      >
        <span className="an-card-ico"><DataIcon kind={k} /></span>
        <span className="an-card-h">{TABLE_FORMATS[k].label}</span>
        {currentTableKind === k && <span className="an-card-badge">Your data</span>}
      </button>
    );
  };

  return (
    // Note: dismiss only when the click began on the overlay. Resizing the wizard smaller ends the
    // drag outside it, so the browser dispatches the click on this overlay (the nearest common
    // ancestor of the down/up targets), which would otherwise shut the dialog mid-resize.
    <div
      className="modalov"
      onPointerDown={(e) => { pressStartedOnOverlay.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (e.target === e.currentTarget && pressStartedOnOverlay.current) onCancel(); }}
    >
      <div className="modal modal-analyze" role="dialog" aria-label="New graph" onClick={(e) => e.stopPropagation()}>
        <div className="modalh-row">
          <h3 className="modalh">{tableFirst ? "New datasheet" : useOpen ? `New graph of “${currentTable!.name}”` : dataFirst ? "New datasheet + graph" : "New graph"}</h3>
          <GuideHelp target={{ entry: "action:new-dataset-dialog" }} what="New datasheet / graph" />
        </div>

        <div className="an-scroll">
          {/* What to create — a graph (+ its datasheet) or just a datasheet. */}
          <div className="ng-seg" role="group" aria-label="What to create">
            <button type="button" aria-pressed={dataFirst} className={`ng-segbtn${dataFirst ? " is-active" : ""}`} onClick={startDataFirst}>Datasheet → graph</button>
            <button type="button" aria-pressed={output === "graph"} className={`ng-segbtn${output === "graph" ? " is-active" : ""}`} onClick={() => { setOutput("graph"); setDataTypeFilter(null); }}>Graph + datasheet</button>
            <button type="button" aria-pressed={tableFirst} className={`ng-segbtn${tableFirst ? " is-active" : ""}`} onClick={() => setOutput("table")}>Datasheet only</button>
          </div>

          {(() => {
            // Data type — pick the format (datasheet mode) or filter the graph grid (graph mode).
            const dataBlock = (
              <div key="data" className="ng-block">
                <div className="an-group-h">{tableFirst ? "Datasheet format" : dataFirst ? "Datasheet format — pick the shape of your data" : dataTypeFilter ? "Data structure — filtering (click to clear)" : "Data structure — or filter the graphs by it"}</div>
                <div className="an-cards" role="group" aria-label="Data types">{TABLE_FORMAT_ORDER.map(kindCard)}</div>
              </div>
            );
            const graphBlock = !tableFirst ? (
              <div key="graph" className="ng-block">
                <input
                  className="ng-search"
                  type="search"
                  aria-label="Search graph types"
                  placeholder="Search graph types…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                {filtered.length > 0 ? (
                  <>
                    <div className="an-group-h">{dataFirst ? (useOpen ? `Suggested graphs for “${currentTable!.name}”` : "Suggested graphs for this datasheet format") : "Graph type — pick your graph (the first choice)"}</div>
                    <div className="an-cards" role="group" aria-label="Graph types">{filtered.map(card)}</div>
                    {/* Every chart kind is on this list (a default-deny guard in
                        newGraph.test compares it with the PlotKind union). The analysis-made
                        kinds (PCA ×4 · ROC · Kaplan-Meier) carry `analysis`, and the note under
                        the picked card explains the hand-over to Analyze — so this line only has
                        to say the list is complete, not where the missing ones went. */}
                    <p className="note ng-analysis-note" style={{ fontSize: 11, marginTop: 6 }}>
                      Every chart type is here. Graphs made from an analysis — <strong>PCA / PCoA</strong>, <strong>ROC</strong>,{" "}
                      <strong>Kaplan-Meier</strong> — hand over to <strong>Analyze</strong> on Create; the graph appears next to the datasheet
                      once it runs.
                    </p>
                  </>
                ) : (
                  <p className="note">No graph type matches your search / filter.</p>
                )}
              </div>
            ) : null;
            // Graph-first mode ("Graph + datasheet"): the graph icons are the primary choice
            // → lead with them, put the data-structure filter below. Data-first / table modes
            // lead with the datasheet shape.
            return output === "graph" ? <>{graphBlock}{dataBlock}</> : <>{dataBlock}{graphBlock}</>;
          })()}
        </div>

        {/* Drag this line to re-split the space between the graph-icon grid (above) and the
            options (below) — down for more icons, up for more options. */}
        <div
          className="ng-divider"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Drag to resize the graph list and the options below it"
          title="Drag to resize"
          onPointerDown={dragDivider}
        >
          <span className="ng-divider-grip" aria-hidden="true" />
        </div>

        {/* Configure the selection. */}
        <div className="ng-config" {...(configH != null ? { style: { height: configH, flexBasis: configH, maxHeight: "none" } } : {})}>
          {tableFirst ? (
            <p className="ng-picked">
              <b>{TABLE_FORMATS[effFormat].label}</b> — {TABLE_FORMATS[effFormat].description}
            </p>
          ) : (
            <p className="ng-picked">
              <b>{genre.label}</b> — {genre.note}
            </p>
          )}

          {/* The data: the open sheet (default), or a fresh blank one. Shown only when the open
              sheet's format fits the chosen graph — otherwise there is nothing to choose. */}
          {/* An analysis-fed graph: the graph is the analysis result, so Create hands over to
              Analyze pre-set on the sheet (or, with no sheet open, makes the blank sheet to fill). */}
          {!tableFirst && genre.analysis && (
            <p className="note" style={{ fontSize: 11, marginTop: 0 }}>
              <strong>{genre.label}</strong> is drawn from an analysis result.{" "}
              {useOpen
                ? <>Create opens <strong>Analyze</strong> pre-set on “{currentTable!.name}”; run it and the graph is made next to the sheet.</>
                : <>Create makes the blank datasheet; fill it in, then run <strong>Analyze</strong> on it and the graph is made next to the sheet.</>}
            </p>
          )}
          {/* The chosen graph cannot draw the open sheet's format: say so, before the user finds
              out from an empty graph beside a new empty sheet. */}
          {!tableFirst && currentTable && !canUseOpen && (
            <p className="note" style={{ fontSize: 11, marginTop: 0 }}>
              <strong>{genre.label}</strong> cannot draw a {TABLE_FORMATS[currentTable.kind].label} datasheet like “{currentTable.name}”, so this
              creates a <strong>new blank {TABLE_FORMATS[effFormat].label} datasheet</strong> for it. To graph the open sheet, pick a graph
              from its suggested list.
            </p>
          )}
          {canUseOpen && (
            <label className="anrow" title={`Draw the graph from the datasheet you have open (“${currentTable!.name}”), or start a blank ${TABLE_FORMATS[effFormat].label} datasheet to fill in.`}>
              <span>Data</span>
              <select aria-label="Data source" value={openChoice} onChange={(e) => setOpenChoice(e.target.value as "open" | "new")}>
                <option value="open">The open datasheet — “{currentTable!.name}”</option>
                <option value="new">A new blank {TABLE_FORMATS[effFormat].label} datasheet</option>
              </select>
            </label>
          )}

          {!tableFirst && !dataFirst && !useOpen && genre.formats.length > 1 && (
            <label className="anrow" title="The datasheet layout that feeds this graph. Only formats compatible with the chosen graph type are offered.">
              <span>Datasheet format</span>
              <select aria-label="Datasheet format" value={effFormat} onChange={(e) => setFormatOverride(e.target.value as TableKind)}>
                {genre.formats.map((k, i) => (
                  <option key={k} value={k}>
                    {TABLE_FORMATS[k].label}
                    {i === 0 ? " (recommended)" : ""}
                    {currentTableKind === k ? " — your data" : ""}
                  </option>
                ))}
              </select>
            </label>
          )}

          {showXType && (
            <label className="anrow" title="How the X column is entered and its axis is labelled: plain numbers, calendar dates (YYYY-MM-DD), or elapsed time (h:mm:ss).">
              <span>X axis</span>
              <select aria-label="X axis type" value={xColumnType} onChange={(e) => setXColumnType(e.target.value as ColumnType)}>
                <option value="number">Numbers</option>
                <option value="date">Dates (YYYY-MM-DD)</option>
                <option value="elapsed">Elapsed time (h:mm:ss)</option>
              </select>
            </label>
          )}

          {sampleAvailable && (
            <label className="anrow" title="Create the graph pre-filled with a realistic example dataset (you can edit or replace it), instead of a blank datasheet.">
              <span>Sample data</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <input type="checkbox" aria-label="Start with sample data" checked={useSample} onChange={(e) => setSampleData(e.target.checked)} />
                <span style={{ fontSize: 11, color: "var(--muted)" }}>Start with a worked example</span>
              </span>
            </label>
          )}

          {!useOpen && showReplicates && (
            <label className="anrow" title="How each Y dataset's values are entered: raw replicate subcolumns (mean ± error computed across them), or a pre-computed Mean + SD/SEM + N.">
              <span>Data entry</span>
              <select aria-label="Data entry" value={effEntryMode} onChange={(e) => setEntryMode(e.target.value as EntryMode)}>
                {ENTRY_MODE_OPTIONS.map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
            </label>
          )}

          {/* Column format has no replicate subcolumns (replicates are rows) → no count control. */}
          {!useOpen && showReplicates && effEntryMode === "replicates" && effFormat !== "column" && (
            <label className="anrow" title="Number of side-by-side replicate subcolumns per Y dataset.">
              <span>Replicates</span>
              <input
                type="number"
                min={1}
                max={256}
                aria-label="Replicates"
                style={{ width: 72 }}
                value={effReplicates}
                onChange={(e) => setReplicates(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
              />
            </label>
          )}

          {showError && (
            <label className="anrow" title="What the error bars on the graph represent. Computed from the entered replicates (or the Mean + error columns).">
              <span>Error bars</span>
              <select aria-label="Error bars" value={effErrorBars} onChange={(e) => setErrorBars(e.target.value as ErrorBarType)}>
                {errorChoices.map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
            </label>
          )}

          {showWhisker && (
            <label className="anrow" title={isFloatingSpan
              ? "What each floating bar spans. Min→max (default) or a percentile range describe the spread; the Mean ± SD/SEM/CI options centre the bar on the mean and size it by that error. Changeable later in the Inspector."
              : "What the whiskers span. Percentile/Tukey options describe the distribution; the Mean ± SD/SEM/CI options collapse the box to the mean and draw the whiskers as that error. Changeable later in the Inspector."}>
              <span>{isFloatingSpan ? "Bar spans" : "Whiskers"}</span>
              <select aria-label={isFloatingSpan ? "Bar spans" : "Whiskers"} value={effWhisker} onChange={(e) => setWhisker(e.target.value as BoxWhisker)}>
                {whiskerChoices.map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
            </label>
          )}

          {/* Add to — file the new datasheet + graph under a project (and optionally an
              experiment) in the side tree, so they're organised instead of loose. The default
              "Top level" leaves them unfiled. */}
          {useOpen ? (
            <p className="note" style={{ fontSize: 11 }}>
              The graph is filed next to “{currentTable!.name}” in the project tree.
            </p>
          ) : (
          <>
          <label className="anrow" title="File the new datasheet and graph under a project in the side tree (and optionally an experiment), so they're organised instead of loose at the top level.">
            <span>Add to</span>
            <select aria-label="Add to project" value={projectSel} onChange={(e) => chooseProject(e.target.value)}>
              <option value="">Top level</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
              <option value="__new__">New project…</option>
            </select>
          </label>

          {creatingProject && (
            <label className="anrow" title="Name for the new project.">
              <span>New project</span>
              <input
                type="text"
                aria-label="New project name"
                placeholder="Project name"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
              />
            </label>
          )}

          {haveProject && (
            <label className="anrow" title="Optionally file under an experiment within the project.">
              <span>Experiment</span>
              <select aria-label="Add to experiment" value={experimentSel} onChange={(e) => setExperimentSel(e.target.value)}>
                <option value="">(none)</option>
                {(selProject?.experiments ?? []).map((ex) => (
                  <option key={ex.id} value={ex.id}>{ex.name}</option>
                ))}
                <option value="__new__">New experiment…</option>
              </select>
            </label>
          )}

          {haveProject && creatingExperiment && (
            <label className="anrow" title="Name for the new experiment.">
              <span>New experiment</span>
              <input
                type="text"
                aria-label="New experiment name"
                placeholder="Experiment name"
                value={newExperimentName}
                onChange={(e) => setNewExperimentName(e.target.value)}
              />
            </label>
          )}
          </>
          )}

          {/* The live sample graph, shown when the box above is ticked. Last in the panel: it is the tallest thing here and it grows (flex 1 1 auto), so anything
              placed after it gets pushed under the fold. */}
          {SAMPLE_PREVIEW && useSample && <SamplePreview genreKey={genre.key} format={effFormat} />}
        </div>

        <div className="modalbtns">
          <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>
          {/* An analysis-fed genre (Kaplan-Meier · PCA · ROC) with no open sheet makes a datasheet
              only — the graph comes from running the analysis (`createNewGraph` returns no plot for
              `spec.analysis`) — so the button says exactly that rather than "Create datasheet +
              graph". */}
          <button type="button" className="btn" data-tour="newgraph-create" onClick={create}>{tableFirst ? "Create datasheet" : genre.analysis && useOpen ? "Open Analyze…" : genre.analysis ? "Create datasheet (graph via Analyze)" : useOpen ? "Create graph" : dataFirst ? "Create datasheet + graph" : "Create graph"}</button>
        </div>
      </div>
    </div>
  );
}
