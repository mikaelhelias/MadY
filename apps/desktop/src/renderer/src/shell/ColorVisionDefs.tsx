import { visionMatrixValues } from "@mady/graphics";
import type { ColorVision } from "@mady/graphics";

export const COLOR_VISION_KINDS: ColorVision[] = ["deuteranopia", "protanopia", "tritanopia", "grayscale"];
/** The CSS filter reference for a kind — applied to a WRAPPER div, never to the `<svg>` itself
 *  (the export clones the svg, so anything on it would ship). */
export const colorVisionFilter = (kind: ColorVision): string => `url(#mady-cvd-${kind})`;

/**
 * The four colour-vision filters (View ▸ Colour-blind preview), defined ONCE in a 0×0 hidden
 * svg mounted by AppShell. Inert until a wrapper references one. `linearRGB` interpolation is
 * what makes the filter agree with `simulateVision` (color.visionMatrix.test.ts).
 */
export function ColorVisionDefs() {
  return (
    <svg width={0} height={0} aria-hidden="true" style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}>
      <defs>
        {COLOR_VISION_KINDS.map((k) => (
          <filter key={k} id={`mady-cvd-${k}`} colorInterpolationFilters="linearRGB">
            <feColorMatrix type="matrix" values={visionMatrixValues(k)} />
          </filter>
        ))}
      </defs>
    </svg>
  );
}
