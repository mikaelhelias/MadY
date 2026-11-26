// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { composeFigureSvg, serializeGraphSvg } from "./exporters";

/**
 * Composed-figure export must not crop.
 *
 * The single-graph export deliberately unions `getBBox()` with the viewBox, *because*
 * legends, axis titles, value labels and Δ% labels are routinely drawn outside the declared
 * box. `composeFigureSvg` must do the same: sizing each panel from `viewBox.baseVal` alone and
 * nesting it as a plain `<svg>`, which clips to its own viewport, would leave the overflowing
 * content in the exported markup but never paint it — so the same graph would export a
 * different shape alone vs. inside a panel figure.
 *
 * Note: jsdom has no `getBBox` (it throws), so it is stubbed here to a known box. That is what
 * makes this deterministic: the real browser's bbox depends on fonts and data, and the
 * shipped sample graphs happen not to overflow at the default panel size — so an e2e test
 * over sample data would pass vacuously and prove nothing.
 */
const NS = "http://www.w3.org/2000/svg";

/** A panel whose real content extends `overhang` px past the right edge of its viewBox. */
function panel(w = 200, h = 100, overhang = 60): SVGSVGElement {
  const svg = document.createElementNS(NS, "svg") as SVGSVGElement;
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  const t = document.createElementNS(NS, "text");
  t.setAttribute("x", String(w + 10));
  t.textContent = "Legend label";
  svg.appendChild(t);
  document.body.appendChild(svg);
  // Content spilling right (a legend) and slightly above the box (a title ascender).
  (svg as unknown as { getBBox: () => DOMRect }).getBBox = () =>
    ({ x: 0, y: -8, width: w + overhang, height: h + 8 }) as DOMRect;
  return svg;
}

afterEach(() => { document.body.innerHTML = ""; });

/** The nested panel `<svg>` viewBoxes inside a composed figure. */
function panelViewBoxes(svgText: string): { x: number; y: number; w: number; h: number }[] {
  const tags = svgText.match(/<svg\b[^>]*>/g) ?? [];
  return tags.slice(1).flatMap((tag) => {
    const m = /viewBox="([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)"/.exec(tag);
    return m ? [{ x: +m[1]!, y: +m[2]!, w: +m[3]!, h: +m[4]! }] : [];
  });
}

describe("composed figure export keeps content drawn outside the viewBox", () => {
  it("widens each panel's viewBox to its real content bounds", () => {
    const out = composeFigureSvg([panel(), panel()], { background: "white" })!;
    const boxes = panelViewBoxes(out.svg);
    expect(boxes).toHaveLength(2);
    for (const b of boxes) {
      // Not the bare "0 0 200 100", which would clip the 60px legend overhang and the -8 ascender.
      expect(b.x, "left edge must include content above/left of the box").toBeLessThanOrEqual(0);
      expect(b.y).toBeLessThanOrEqual(-8);
      expect(b.w, "width must cover the 60px overhang").toBeGreaterThanOrEqual(260);
      expect(b.h).toBeGreaterThanOrEqual(108);
    }
  });

  it("sizes the composed canvas from the real bounds, not the declared viewBox", () => {
    const declaredOnly = composeFigureSvg([panel(200, 100, 0)], { background: "white", margin: 0 })!;
    const withOverhang = composeFigureSvg([panel(200, 100, 60)], { background: "white", margin: 0 })!;
    expect(withOverhang.width).toBeGreaterThan(declaredOnly.width);
  });

  it("marks nested panels overflow-visible", () => {
    const out = composeFigureSvg([panel()], { background: "white" })!;
    expect(out.svg).toContain('overflow="visible"');
  });

  it("a panel that does not overflow keeps its plain viewBox (no needless growth)", () => {
    const tight = document.createElementNS(NS, "svg") as SVGSVGElement;
    tight.setAttribute("viewBox", "0 0 200 100");
    document.body.appendChild(tight);
    (tight as unknown as { getBBox: () => DOMRect }).getBBox = () =>
      ({ x: 5, y: 5, width: 100, height: 50 }) as DOMRect;
    const out = composeFigureSvg([tight], { background: "white" })!;
    expect(panelViewBoxes(out.svg)[0]).toEqual({ x: 0, y: 0, w: 200, h: 100 });
  });

  it("the single-graph path unions the same way", () => {
    const out = serializeGraphSvg(panel(200, 100, 60), { background: "white" });
    expect(out.width).toBeGreaterThanOrEqual(260);
  });
});
