import { useEffect, useMemo, useState } from "react";
import { getAppDefaults } from "./profile";
import { mmToPx, MM_PER_IN, PRINT_WIDTHS } from "./printSizes";
import { defaultExportSize } from "./exportSize";
import type { DataTable } from "@mady/core";
import type { ExportPayload } from "../../../preload";
import { excelSheetName } from "./analysisExport";
import { ColorInput } from "./SchemaForm";
import {
  serializeGraphSvg,
  svgToPngBase64,
  tableToCsv,
  tableToGrid,
  tableToJson,
  EXPORT_FORMAT_LABEL,
  PLOT_EXPORT_FORMATS,
  TABLE_EXPORT_FORMATS,
  type ExportBackground,
  type ExportFormat,
  type SerializedSvg,
} from "./exporters";
import { GuideHelp } from "./guideLink";
import { activeGraphSvg, composeActiveFigureSvg } from "./exportSource";
import { formatSupportsTransparent, payloadForFormat } from "./exportPayload";

// The format list, its labels and the two offered sets live in `exporters.ts` — the manual's
// function index enumerates them too, and one registry is the only way the two can agree.
type Format = ExportFormat;
const LABEL = EXPORT_FORMAT_LABEL;
const PLOT_FORMATS = PLOT_EXPORT_FORMATS;
const TABLE_FORMATS = TABLE_EXPORT_FORMATS;
const DPI_PRESETS = [72, 150, 300, 600];

// The journal widths and the mm → px rule live in printSizes.ts, shared with the Graph size
// section's print-size buttons.

/** Curated export-page background swatches (light papers + dark/poster colours).
 *  Plus white/transparent buttons and a custom colour picker in the dialog. */
const EXPORT_BG_SWATCHES: string[] = [
  "#f7f7f5", "#fbf7ec", "#f4f1ea", "#f0f2f5", "#e9eef3", "#eaf3ea",
  "#fdeef0", "#eef0fb", "#fff8e1", "#f0f9ff", "#f5f0ff", "#fef6f0",
  "#1a1a2e", "#0b1020", "#222222", "#0f2230", "#103027", "#2b1a3d",
];

// The on-screen readers live in exportSource.ts (they also read the off-screen Export-all stage).
export { activeGraphSvg, composeActiveFigureSvg } from "./exportSource";

/**
 * ExportDialog — publication-grade export. Graphs →
 * PNG/SVG/PDF/TIFF/JPG with an explicit DPI, an (optionally non-proportional)
 * pixel size, a transparent-vs-white background, and a margin; data tables →
 * CSV/XLSX/JSON. Plus copy-to-clipboard (image / SVG), for pasting into
 * other documents. Reads the on-screen `.gfx-figure`.
 */
export function ExportDialog({
  kind,
  source = "graph",
  suggestedName,
  plotId,
  printWidthMm,
  displayScale,
  table,
  onExport,
  onCancel,
}: {
  kind: "plot" | "table";
  /** For `plot` exports: a single graph, or the multi-panel figure (composed). */
  source?: "graph" | "figure";
  suggestedName: string;
  /** The plot being exported — targets its specific panel so a selected panel isn't
   *  mis-resolved to the document's first `.gfx-figure`. Undefined for figure/table. */
  plotId?: string | undefined;
  /** The graph's own print size (Frame ▸ Graph size ▸ Print size), mm: the print width starts there. */
  printWidthMm?: number | undefined;
  /** The graph's on-screen scale (graphDisplay.ts): the default pixel size is the size it is shown at, so a graph
   *  resized to half exports at half — the whole drawing scaled, never re-laid-out. Undefined = 1. */
  displayScale?: number | undefined;
  table?: DataTable | undefined;
  onExport: (payload: ExportPayload) => Promise<void>;
  onCancel: () => void;
}) {
  const isFigure = kind === "plot" && source === "figure";
  const noun = kind === "table" ? "data" : isFigure ? "figure" : "graph";
  const formats = kind === "plot" ? PLOT_FORMATS : TABLE_FORMATS;
  const [format, setFormat] = useState<Format>(formats[0]!);
  // Escape closes the dialog, like its close button.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const [margin, setMargin] = useState(0);

  /** Build the export-ready SVG (composed figure, or single graph) at the current margin.
   *  The single source of truth for both the raster/DPI size and the exported bytes, so the
   *  pixel canvas can never be sized from a different layout box than the one actually exported.
   *  composeFigureSvg/serializeGraphSvg already fold the margin into their returned width/height. */
  function buildSerialized(bg: ExportBackground): SerializedSvg | null {
    if (isFigure) return composeActiveFigureSvg({ background: bg, margin });
    const svg = activeGraphSvg(plotId);
    return svg ? serializeGraphSvg(svg, { background: bg, margin }) : null;
  }

  // The exact pixel size of the SVG the export will emit (background never affects geometry).
  const sized = useMemo(() => {
    const s = buildSerialized("white");
    return { w: Math.round(s?.width || 680), h: Math.round(s?.height || 420) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [margin]);
  const shownK = displayScale ?? 1;
  const paddedW = sized.w * shownK;
  const paddedH = sized.h * shownK;
  const paddedAspect = paddedW / paddedH;

  const [dpiSel, setDpiSel] = useState<string>("300");
  // The starting size is one rule shared with Graph ▸ Copy as picture (exportSize.ts).
  const initialSize = defaultExportSize({ w: sized.w, h: sized.h, displayScale, printWidthMm, dpi: 300 });
  const [width, setWidth] = useState(initialSize.width);
  const [height, setHeight] = useState(initialSize.height);
  const [unlock, setUnlock] = useState(false);
  /** Target physical width in mm, when the user is sizing for print. null = size in pixels
   *  (the default). Set → the mm are held and the pixel count follows the DPI. */
  const [printMm, setPrintMm] = useState<number | null>(printWidthMm ?? null);
  const [quality, setQuality] = useState(0.92);
  const [background, setBackground] = useState<ExportBackground>("white");
  const [cmyk, setCmyk] = useState(false);
  // HTML export: interactive (hover tooltips + zoom/pan + legend series-toggle) vs a
  // plain static vector snapshot. Defaults on — it is the point of an HTML export.
  const [interactive, setInteractive] = useState(true);
  // …and whether that page shows each mark's values on hover: starts from Settings, this export only.
  const [hoverValues, setHoverValues] = useState(() => getAppDefaults().exportHoverValues !== false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"image" | "svg" | null>(null);

  // PowerPoint carries a PNG of the chosen size too (its fallback picture), so it takes the pixel-size controls.
  const isRaster = format === "png" || format === "jpg" || format === "tiff" || format === "eps" || format === "pptx";
  // TIFF is excluded: the TIFF encoders always composite onto an opaque background, so a
  // "Transparent" swatch would silently produce white.
  // PNG carries real alpha; SVG/PDF/HTML render over the page.
  const supportsTransparent = formatSupportsTransparent(format);

  // When a DPI preset (or the margin) changes, re-derive the proportional size. With a
  // print width set, the physical size is what's being held constant — more DPI then means
  // more pixels across the same millimetres, which is the whole point of asking for mm.
  useEffect(() => {
    if (dpiSel === "custom") return;
    const dpi = Number(dpiSel);
    const s = defaultExportSize({ w: sized.w, h: sized.h, displayScale, printWidthMm: printMm, dpi });
    setWidth(s.width);
    setHeight(s.height);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dpiSel, margin, printMm]);

  const onWidth = (w: number): void => {
    const ww = Math.max(16, w || 0);
    setPrintMm(null); // typing raw pixels takes manual control back from the print size
    setWidth(ww);
    if (!unlock) setHeight(Math.round(ww / paddedAspect));
  };
  /** Size the export to a physical print width (mm) at the chosen DPI. */
  const onPrintWidth = (mm: number | null): void => {
    setPrintMm(mm);
    if (mm == null) return;
    const dpi = dpiSel === "custom" ? effectiveDpi : Number(dpiSel);
    const w = mmToPx(mm, dpi);
    setWidth(w);
    setHeight(Math.round(w / paddedAspect));
  };
  const onHeight = (h: number): void => setHeight(Math.max(16, h || 0));
  const effectiveDpi = Math.round((width / paddedW) * 96);
  /** DPI implied by the chosen print width — the accurate number once the user has pinned the
   *  physical size (effectiveDpi answers a different question: pixels vs the CSS size). */
  const printDpi = printMm != null ? Math.round(width / (printMm / MM_PER_IN)) : effectiveDpi;

  /** Serialize the on-screen graph (or composed figure) with the chosen background/margin. */
  function serialize(bg: ExportBackground): SerializedSvg | null {
    const s = buildSerialized(bg);
    if (!s) setError(isFigure ? "No panels in this figure to export — add graphs to the layout first." : "No graph is open to export.");
    return s;
  }

  async function buildPayload(): Promise<ExportPayload | null> {
    if (kind === "table") {
      if (!table) return null;
      if (format === "csv") return { format: "csv", suggestedName, text: tableToCsv(table) };
      if (format === "json") return { format: "json", suggestedName, text: tableToJson(table) };
      if (format === "xlsx") {
        const g = tableToGrid(table);
        return { format: "xlsx", suggestedName, sheet: { name: excelSheetName(table.name), columns: g.columnNames, rows: g.rows } };
      }
      return null;
    }
    // One body for the bytes, shared with Export all (exportPayload.ts).
    return payloadForFormat({
      format, suggestedName, serialize, background, width, height, quality, cmyk, dpi: effectiveDpi, interactive, hoverValues, noun,
    });
  }

  async function handleExport(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const payload = await buildPayload();
      if (payload) await onExport(payload);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function copyImage(): Promise<void> {
    setError(null);
    try {
      const s = serialize("transparent");
      if (!s) return;
      const base64 = await svgToPngBase64(s.svg, width, height, background);
      window.mady?.copyImageToClipboard?.(base64);
      setCopied("image");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  function copySvg(): void {
    setError(null);
    const s = serialize(background);
    if (!s) return;
    window.mady?.copyTextToClipboard?.(s.svg);
    setCopied("svg");
  }

  return (
    <div className="modalov" onClick={onCancel}>
      {/* `modal-export`: 420 px, not the shared 340, and buttons that keep their words on one line so none
          wraps to "Copy / image" (shell.css). */}
      <div className="modal modal-export" role="dialog" aria-label="Export" onClick={(e) => e.stopPropagation()}>
        <div className="modalh-row">
          <h3 className="modalh">Export {noun}</h3>
          <GuideHelp target={{ entry: "action:export" }} what="Export" />
          {/* The close button — the manual popup's own button, reused. */}
          <button type="button" className="manualpop-close modal-close" aria-label="Close" title="Close (Esc)" onClick={onCancel}>
            ×
          </button>
        </div>

        <label className="exprow">
          Format{" "}
          <select aria-label="Format" value={format} onChange={(e) => { setFormat(e.target.value as Format); setCopied(null); }}>
            {formats.map((f) => (
              <option key={f} value={f}>
                {LABEL[f]}
              </option>
            ))}
          </select>
        </label>

        {(isRaster || format === "pdf" || format === "svg" || format === "html") && (
          <div className="expsize">
            {isRaster && (
              <label>
                Resolution{" "}
                <select aria-label="DPI" value={dpiSel} onChange={(e) => setDpiSel(e.target.value)}>
                  {DPI_PRESETS.map((d) => (
                    <option key={d} value={String(d)}>
                      {d} DPI
                    </option>
                  ))}
                  <option value="custom">Custom…</option>
                </select>
              </label>
            )}
            {isRaster && (
              <label title="Size the figure to a physical width for print — the pixel count then follows the DPI. Column widths vary by journal; check your target's guide for authors.">
                Print width{" "}
                <select
                  aria-label="Print width"
                  value={printMm == null ? "px" : String(printMm)}
                  onChange={(e) => onPrintWidth(e.target.value === "px" ? null : Number(e.target.value))}
                >
                  <option value="px">Size in pixels</option>
                  {printWidthMm !== undefined && !PRINT_WIDTHS.some((p) => p.mm === printWidthMm) && (
                    <option value={String(printWidthMm)}>This {source === "figure" ? "figure's page width" : "graph's print size"} — {printWidthMm} mm</option>
                  )}
                  {PRINT_WIDTHS.map((p) => (
                    <option key={p.mm} value={String(p.mm)}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {isRaster && printMm != null && (
              <label title="Exact physical width in millimetres">
                mm{" "}
                <input
                  type="number"
                  aria-label="Print width in millimetres"
                  min={10}
                  max={500}
                  step={1}
                  value={printMm}
                  onChange={(e) => onPrintWidth(Math.max(10, Number(e.target.value) || 0))}
                />
              </label>
            )}
            {isRaster && (
              <>
                <label>
                  Width{" "}
                  <input
                    type="number"
                    min={16}
                    value={width}
                    readOnly={dpiSel !== "custom" && !unlock}
                    onChange={(e) => onWidth(Number(e.target.value))}
                  />
                  px
                </label>
                <label>
                  Height{" "}
                  <input
                    type="number"
                    min={16}
                    value={height}
                    readOnly={!unlock}
                    title={unlock ? undefined : "Locked to the graph's aspect ratio"}
                    onChange={(e) => onHeight(Number(e.target.value))}
                  />
                  px
                </label>
                <label className="expchk">
                  <input type="checkbox" checked={unlock} onChange={(e) => setUnlock(e.target.checked)} /> Unlock aspect
                </label>
                <span className="note">
                  Final: {width} × {height} px
                  {printMm != null
                    ? // The user set the physical width, so the print size is fixed and the
                      // DPI follows from it — not from the graph's on-screen CSS size.
                      ` · ${printMm.toFixed(1)} × ${(printMm / (width / height)).toFixed(1)} mm in print (${printDpi} DPI)`
                    : `${!unlock ? ` (≈ ${effectiveDpi} DPI)` : ""}${
                        effectiveDpi > 0
                          ? ` · ${((width / effectiveDpi) * MM_PER_IN).toFixed(1)} × ${((height / effectiveDpi) * MM_PER_IN).toFixed(1)} mm in print`
                          : ""
                      }`}
                </span>
              </>
            )}
            <label>
              Margin{" "}
              <input type="number" min={0} max={200} value={margin} onChange={(e) => setMargin(Math.max(0, Number(e.target.value) || 0))} />
              px
            </label>
            <div className="exportbg">
              <span>Background</span>
              <div className="exportbg-swatches" role="group" aria-label="Background">
                <button
                  type="button"
                  className={`exbg ${background === "white" ? "on" : ""}`}
                  title="White"
                  style={{ background: "#ffffff" }}
                  onClick={() => setBackground("white")}
                />
                {supportsTransparent && (
                  <button
                    type="button"
                    className={`exbg exbg-tp ${background === "transparent" ? "on" : ""}`}
                    title="Transparent"
                    onClick={() => setBackground("transparent")}
                  />
                )}
                {EXPORT_BG_SWATCHES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`exbg ${background === c ? "on" : ""}`}
                    title={c}
                    style={{ background: c }}
                    onClick={() => setBackground(c)}
                  />
                ))}
                <ColorInput
                  aria-label="Custom background colour"
                  className="exbg-custom"
                  value={/^#[0-9a-f]{6}$/i.test(background) ? background : "#ffffff"}
                  onChange={(c) => setBackground(c)}
                />
              </div>
            </div>
            {format === "jpg" && (
              <label>
                Quality{" "}
                <input type="range" min={0.3} max={1} step={0.01} value={quality} onChange={(e) => setQuality(Number(e.target.value))} />
                {Math.round(quality * 100)}%
              </label>
            )}
            {format === "tiff" && (
              <label className="expchk">
                <input type="checkbox" checked={cmyk} onChange={(e) => setCmyk(e.target.checked)} /> CMYK colour (print)
              </label>
            )}
            {format === "html" && (
              <label className="expchk">
                <input type="checkbox" checked={interactive} onChange={(e) => setInteractive(e.target.checked)} /> Interactive (zoom, pan, show/hide series)
              </label>
            )}
            {format === "html" && interactive && (
              <label className="expchk" title="Hovering a point, bar, slice or cell shows its values. The default is set in Settings.">
                <input type="checkbox" checked={hoverValues} onChange={(e) => setHoverValues(e.target.checked)} /> Show values on hover
              </label>
            )}
          </div>
        )}

        {format === "svg" && <p className="note">Scalable vector — ideal for journals; no resolution loss.</p>}
        {format === "pptx" && <p className="note">One slide holding the {noun} as a picture. PowerPoint 2016 or later shows the vector (right-click ▸ Convert to Shape makes it editable); older readers show the PNG at the size above.</p>}
        {format === "pdf" && <p className="note">Single-page vector PDF (text stays selectable) at the graph's size.</p>}
        {format === "eps" && <p className="note">EPS (PostScript) for journals that require it — embeds a high-resolution raster of the figure. For scalable vector, use SVG or PDF.</p>}
        {format === "tiff" && cmyk && <p className="note">CMYK colour separation (naive conversion, no ICC profile) — for print submission.</p>}
        {format === "html" && (
          <p className="note">{interactive
            ? (hoverValues ? "Self-contained interactive page: hover a mark for its values, scroll to zoom, drag to pan, click a legend entry to hide or show its series." : "Self-contained interactive page: scroll to zoom, drag to pan, click a legend entry to hide or show its series. No values on hover.") + " No internet or install needed."
            : "Self-contained static page: the vector figure, crisp at any zoom. No internet or install needed."}</p>
        )}
        {format === "csv" && <p className="note">Comma-separated values — the active data table.</p>}
        {format === "xlsx" && <p className="note">Native Excel workbook (one sheet, bold header row).</p>}
        {format === "json" && <p className="note">Structured JSON — columns + one object per row.</p>}
        {copied && <p className="note" style={{ color: "var(--accent)" }}>Copied {copied === "image" ? "image" : "SVG"} to the clipboard.</p>}
        {error && <p className="note" style={{ color: "var(--danger)" }}>{error}</p>}

        <div className="modalbtns">
          {kind === "plot" && (
            <>
              <button className="btn-ghost" title="Copy the graph as a PNG to the clipboard" onClick={() => void copyImage()}>
                Copy image
              </button>
              <button className="btn-ghost" title="Copy the graph as SVG markup to the clipboard" onClick={copySvg}>
                Copy SVG
              </button>
            </>
          )}
          <button className="btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn" data-tour="export-confirm" disabled={busy} onClick={() => void handleExport()}>
            {busy ? "Exporting…" : `Export ${format.toUpperCase()}…`}
          </button>
        </div>
      </div>
    </div>
  );
}
