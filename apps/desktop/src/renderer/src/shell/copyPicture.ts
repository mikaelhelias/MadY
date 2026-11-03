import type { SerializedSvg } from "./exporters";
import { svgToPngBase64 } from "./exporters";
import { defaultExportSize } from "./exportSize";

/**
 * Graph ▸ Copy as picture / Copy as SVG — the drawing in front to the clipboard, from the
 * menu, the graph's right-click menu or Ctrl+Shift+C, as well as from inside the Export dialog.
 *
 * The picture is the same picture the Export dialog would start with: the serialized drawing at
 * `defaultExportSize` (300 dpi; the graph's own print width when it has one; its on-screen
 * scale otherwise), rasterized onto a white page — what pastes cleanly into a slide or a
 * document. The SVG copy is the serialized markup itself.
 *
 * Every outcome is said out loud by the caller: "no-source" (nothing in front), "no-bridge"
 * (the preview bundle has no clipboard), "copied".
 */
export type CopyOutcome = "copied" | "no-source" | "no-bridge";

export interface CopyBridge {
  copyImageToClipboard?: ((base64Png: string) => void) | undefined;
  copyTextToClipboard?: ((text: string) => void) | undefined;
}

export async function copyAsPicture(opts: {
  source: SerializedSvg | null;
  displayScale?: number | undefined;
  printWidthMm?: number | undefined;
  bridge: CopyBridge | undefined;
  /** The rasterizer (tests hand in a stub; the app uses the exporter's). */
  raster?: typeof svgToPngBase64 | undefined;
}): Promise<CopyOutcome> {
  if (!opts.source) return "no-source";
  const put = opts.bridge?.copyImageToClipboard;
  if (!put) return "no-bridge";
  const { width, height } = defaultExportSize({
    w: opts.source.width,
    h: opts.source.height,
    displayScale: opts.displayScale,
    printWidthMm: opts.printWidthMm,
    dpi: 300,
  });
  const base64 = await (opts.raster ?? svgToPngBase64)(opts.source.svg, width, height, "white");
  put(base64);
  return "copied";
}

export function copyAsSvg(opts: { source: SerializedSvg | null; bridge: CopyBridge | undefined }): CopyOutcome {
  if (!opts.source) return "no-source";
  const put = opts.bridge?.copyTextToClipboard;
  if (!put) return "no-bridge";
  put(opts.source.svg);
  return "copied";
}
