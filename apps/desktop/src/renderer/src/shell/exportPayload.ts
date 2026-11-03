/**
 * The bytes of one graph / figure export in a chosen format — the Export dialog and Export all
 * build every file through this one body, so a batch file is exactly what the dialog would have written.
 *
 * `serialize(bg)` produces the standalone SVG (at the margin the caller chose) with that background baked in; the
 * raster formats serialise transparent and composite onto `background` at the explicit pixel size.
 */
import type { ExportPayload } from "../../../preload";
import {
  htmlWrap,
  interactiveHtmlWrap,
  svgToCmykTiffBase64,
  svgToEpsText,
  svgToJpegBase64,
  svgToPngBase64,
  svgToTiffBase64,
  type ExportBackground,
  type ExportFormat,
  type SerializedSvg,
} from "./exporters";

export interface PlotPayloadOptions {
  format: ExportFormat;
  suggestedName: string;
  serialize: (bg: ExportBackground) => SerializedSvg | null;
  background: ExportBackground;
  /** Raster pixel size. */
  width: number;
  height: number;
  /** JPEG quality 0–1. */
  quality?: number | undefined;
  /** TIFF: CMYK instead of RGB. */
  cmyk?: boolean | undefined;
  /** TIFF resolution tag. */
  dpi?: number | undefined;
  /** HTML: the interactive page (hover, zoom, series toggle) — or a plain vector page. */
  interactive?: boolean | undefined;
  hoverValues?: boolean | undefined;
  /** What the HTML page is titled when there is no name. */
  noun?: string | undefined;
}

/** Can this format carry transparency? PNG, SVG, PDF and HTML can; JPEG and TIFF composite onto an opaque page. */
export function formatSupportsTransparent(format: ExportFormat): boolean {
  return format === "png" || format === "svg" || format === "pdf" || format === "html";
}

export async function payloadForFormat(o: PlotPayloadOptions): Promise<ExportPayload | null> {
  const { format, suggestedName, background } = o;
  if (format === "svg") {
    const s = o.serialize(background);
    return s ? { format: "svg", suggestedName, text: s.svg } : null;
  }
  if (format === "html") {
    // Self-contained HTML: the vector SVG embedded inline, crisp at any zoom, no external files. The interactive
    // variant also inlines a dependency-free runtime for hover tooltips, zoom/pan and legend-driven series toggling.
    const s = o.serialize(background);
    const name = suggestedName ?? o.noun ?? "graph";
    return s
      ? { format: "html", suggestedName, text: (o.interactive ?? true) ? interactiveHtmlWrap(s.svg, name, background, { hoverValues: o.hoverValues ?? true }) : htmlWrap(s.svg, name, background) }
      : null;
  }
  if (format === "pdf") {
    const s = o.serialize(background);
    return s ? { format: "pdf", suggestedName, svg: s.svg, width: s.width, height: s.height } : null;
  }
  if (format === "pptx") {
    // One slide: the vector drawing for PowerPoint 2016+ and, as every reader's fallback, the same drawing as
    // a PNG at the chosen pixel size. The slide fits the picture by its shape (main/pptx.ts).
    const vec = o.serialize(background);
    const ras = o.serialize("transparent");
    if (!vec || !ras) return null;
    const pngBase64 = await svgToPngBase64(ras.svg, o.width, o.height, background);
    return { format: "pptx", suggestedName, pptx: { slides: [{ name: suggestedName || o.noun || "graph", svg: vec.svg, pngBase64, width: vec.width, height: vec.height }] } };
  }
  // Raster: serialise transparent (alpha-preserving), then rasterise at the explicit size. Opaque formats (jpg / tiff)
  // cannot be transparent → white, but any chosen colour is kept.
  const s = o.serialize("transparent");
  if (!s) return null;
  const bg = formatSupportsTransparent(format) ? background : background === "transparent" ? "white" : background;
  const { width, height } = o;
  if (format === "png") return { format: "png", suggestedName, base64: await svgToPngBase64(s.svg, width, height, bg) };
  if (format === "jpg") return { format: "jpg", suggestedName, base64: await svgToJpegBase64(s.svg, width, height, o.quality ?? 0.92, bg) };
  if (format === "eps") return { format: "eps", suggestedName, text: await svgToEpsText(s.svg, width, height, s.width * 72 / 96, s.height * 72 / 96, bg) };
  if (format === "tiff") return { format: "tiff", suggestedName, base64: await (o.cmyk ? svgToCmykTiffBase64 : svgToTiffBase64)(s.svg, width, height, bg, o.dpi ?? 96) };
  return null;
}
