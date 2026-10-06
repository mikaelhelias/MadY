/**
 * File ▸ Export all graphs & figures…: which items (graphs / figures, with counts), one format,
 * the resolution for pictures, the background, a file-name pattern with a preview of the first names, and whether to
 * replace files already in the folder. Run asks for the folder, then shows progress and, at the end, every file that was
 * not written and why. Each file is what the Export dialog would write for that item.
 */
import { useEffect, useState } from "react";
import { EXPORT_FORMAT_LABEL, PLOT_EXPORT_FORMATS, type ExportBackground, type ExportFormat } from "./exporters";
import { formatSupportsTransparent } from "./exportPayload";
import { batchFileNames, type BatchResult } from "./batchExport";
import { exportManyErrorMessage } from "./ioFeedback";
import { GuideHelp } from "./guideLink";

export interface ExportAllOptions {
  graphs: boolean;
  figures: boolean;
  format: ExportFormat;
  dpi: number;
  background: ExportBackground;
  pattern: string;
  replace: boolean;
}

const DPI_PRESETS = [72, 150, 300, 600];
const RASTER: ReadonlySet<ExportFormat> = new Set<ExportFormat>(["png", "jpg", "tiff", "eps", "pptx"]);

export function ExportAllDialog({ graphs, figures, onRun, onClose }: {
  graphs: { id: string; name: string }[];
  figures: { id: string; name: string }[];
  /** Pick the folder and export; resolves with what was written and what failed, or null when the folder pick was cancelled. */
  onRun: (opts: ExportAllOptions, onProgress: (done: number, total: number) => void) => Promise<BatchResult | null>;
  onClose: () => void;
}) {
  const [withGraphs, setWithGraphs] = useState(graphs.length > 0);
  const [withFigures, setWithFigures] = useState(figures.length > 0);
  const [format, setFormat] = useState<ExportFormat>("png");
  const [dpi, setDpi] = useState(300);
  const [background, setBackground] = useState<ExportBackground>("white");
  const [pattern, setPattern] = useState("{name}");
  const [replace, setReplace] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BatchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);
  const transparentOk = formatSupportsTransparent(format);
  const items = [...(withGraphs ? graphs.map((g) => ({ name: g.name, kind: "graph" as const })) : []), ...(withFigures ? figures.map((f) => ({ name: f.name, kind: "figure" as const })) : [])];
  const preview = batchFileNames(items, pattern, format).slice(0, 3);
  const nothing = items.length === 0;

  const run = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await onRun(
        { graphs: withGraphs, figures: withFigures, format, dpi, background: transparentOk ? background : background === "transparent" ? "white" : background, pattern, replace },
        (done, total) => setProgress({ done, total }),
      );
      if (r) setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const failures = result ? exportManyErrorMessage(result) : null;

  return (
    <div className="modalov" onClick={busy ? undefined : onClose}>
      <div className="modal modal-export" role="dialog" aria-label="Export all graphs and figures" onClick={(e) => e.stopPropagation()}>
        <div className="modalh-row">
          <h3 className="modalh">Export all graphs &amp; figures</h3>
          <GuideHelp target={{ entry: "action:export-all" }} what="Export all" />
          <button type="button" className="manualpop-close modal-close" aria-label="Close" title="Close (Esc)" onClick={onClose} disabled={busy}>
            ×
          </button>
        </div>
        <div className="exprow">
          <label className="expchk"><input type="checkbox" checked={withGraphs} disabled={graphs.length === 0} onChange={(e) => setWithGraphs(e.target.checked)} /> Graphs ({graphs.length})</label>{" "}
          <label className="expchk"><input type="checkbox" checked={withFigures} disabled={figures.length === 0} onChange={(e) => setWithFigures(e.target.checked)} /> Figures ({figures.length})</label>
        </div>
        <label className="exprow">
          Format{" "}
          <select aria-label="Format" value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)}>
            {PLOT_EXPORT_FORMATS.map((f) => <option key={f} value={f}>{EXPORT_FORMAT_LABEL[f]}</option>)}
          </select>
        </label>
        {RASTER.has(format) && (
          <label className="exprow">
            Resolution{" "}
            <select aria-label="Resolution" value={dpi} onChange={(e) => setDpi(Number(e.target.value))}>
              {DPI_PRESETS.map((d) => <option key={d} value={d}>{d} DPI</option>)}
            </select>
          </label>
        )}
        <div className="exprow">
          Background{" "}
          <label className="expchk"><input type="radio" name="expall-bg" checked={background === "white" || (!transparentOk && background === "transparent")} onChange={() => setBackground("white")} /> White</label>{" "}
          <label className="expchk" title={transparentOk ? undefined : "This format cannot be transparent"}><input type="radio" name="expall-bg" checked={transparentOk && background === "transparent"} disabled={!transparentOk} onChange={() => setBackground("transparent")} /> Transparent</label>
        </div>
        <label className="exprow">
          File names{" "}
          <input type="text" aria-label="File name pattern" value={pattern} onChange={(e) => setPattern(e.target.value)} style={{ width: 160 }} />
        </label>
        <p className="note" style={{ margin: "2px 0 6px" }}>
          {"{name}"} the graph or figure name · {"{kind}"} graph / figure · {"{n}"} 1, 2, 3…
          {preview.length > 0 && <><br />e.g. <span data-name-preview="">{preview.join(", ")}{items.length > 3 ? ", …" : ""}</span></>}
        </p>
        <label className="expchk">
          <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} /> Replace files already in the folder
        </label>
        {progress && <p className="note" data-export-progress="">{busy ? "Exporting" : "Exported"} {progress.done} / {progress.total}</p>}
        {result && !failures && <p className="note" role="status">{result.written.length === 1 ? "The file was written." : `All ${result.written.length} files written.`}</p>}
        {failures && <pre className="note" role="alert" style={{ whiteSpace: "pre-wrap", maxHeight: 160, overflow: "auto" }}>{failures}</pre>}
        {error && <p className="note" role="alert">{error}</p>}
        <div className="modalbtns">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>Close</button>
          <button type="button" className="btn" onClick={() => void run()} disabled={busy || nothing} title={nothing ? "Tick graphs or figures to export" : "Choose a folder, then export"}>
            Export {items.length} file{items.length === 1 ? "" : "s"}…
          </button>
        </div>
      </div>
    </div>
  );
}
