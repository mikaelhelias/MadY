import { mmToPx } from "./printSizes";

/**
 * The pixel size an export STARTS at — the one rule the Export dialog, Graph ▸ Copy as picture
 * and a batch export share, so a picture copied from the menu is the same picture the dialog
 * would offer (exportSize.test.tsx proves the dialog's fields and this function agree).
 *
 * `w`/`h` = the serialized drawing's box, px at 96 dpi. `displayScale` = the scale the graph is
 * SHOWN at (a graph resized to half exports at half — the whole drawing scaled, never
 * re-laid-out). `printWidthMm` = the graph's own print size when it has one: the millimetres
 * are held and the pixel count follows the DPI.
 */
export function defaultExportSize(opts: {
  w: number;
  h: number;
  displayScale?: number | undefined;
  printWidthMm?: number | null | undefined;
  dpi?: number | undefined;
}): { width: number; height: number } {
  const dpi = opts.dpi ?? 300;
  const k = opts.displayScale ?? 1;
  const paddedW = opts.w * k;
  const paddedH = opts.h * k;
  if (opts.printWidthMm != null) {
    const width = mmToPx(opts.printWidthMm, dpi);
    return { width, height: Math.round(width / (paddedW / paddedH)) };
  }
  return { width: Math.round((paddedW * dpi) / 96), height: Math.round((paddedH * dpi) / 96) };
}
