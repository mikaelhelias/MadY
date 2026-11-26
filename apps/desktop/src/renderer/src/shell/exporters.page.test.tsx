// @vitest-environment jsdom
// The page in a figure export. With a page set on the figure,
// the export is the page (plus the dialog's margin): a panel sits where it sits on the page,
// not hugged into the top-left. Content that runs past the page grows the export rather than
// being cut. Without a page, export sizing is unaffected by this.
import { describe, expect, it } from "vitest";
import { composeFigureSvg } from "./exporters";

function svgEl(w = 380, h = 260): SVGSVGElement {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", `0 0 ${w} ${h}`);
  s.setAttribute("class", "gfx-figure");
  return s;
}
/** x / y of each nested panel `<svg>` in the composed figure. Read by pattern, not an XML parser:
 *  jsdom's serializer writes the nested svg's `xmlns` twice (Chromium writes it once). */
const panelXY = (svg: string): Array<{ x: number; y: number }> =>
  [...svg.slice(1).matchAll(/<svg\b[^>]*?\bx="([-\d.]+)" y="([-\d.]+)"/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
const letter = (ox: number, oy: number) => ({ text: "A", family: "Arial", size: 15, weight: "700", color: "#000", ox, oy });

describe("composeFigureSvg with a page", () => {
  it("the export is the page plus the margin, the panel at its place on the page", () => {
    const out = composeFigureSvg([svgEl()], { background: "white", margin: 12, places: [{ x: 100, y: 40 }], page: { w: 660, h: 890 } })!;
    expect(out.width).toBe(660 + 24);
    expect(out.height).toBe(890 + 24);
    expect(panelXY(out.svg)[0]!.x).toBe(12 + 100);
  });
  it("without a page the figure hugs its content", () => {
    const out = composeFigureSvg([svgEl()], { background: "white", margin: 12, places: [{ x: 100, y: 40 }] })!;
    expect(out.width).toBe(380 + 24);
    expect(panelXY(out.svg)[0]!.x).toBe(12);
  });
  it("a panel past the page's edge grows the export instead of being cut", () => {
    const out = composeFigureSvg([svgEl()], { background: "white", margin: 12, places: [{ x: 500, y: 40 }], page: { w: 660, h: 890 } })!;
    expect(out.width).toBe(500 + 380 + 24);
    expect(out.height).toBe(890 + 24);
    expect(panelXY(out.svg)[0]!.x).toBe(12 + 500);
  });
  it("keeps the page place with dragged A/B/C labels too", () => {
    const out = composeFigureSvg([svgEl(), svgEl()], {
      background: "white", margin: 12, places: [{ x: 100, y: 40 }, { x: 100, y: 400 }], page: { w: 660, h: 890 },
      letters: [letter(-10, -8), letter(-10, -8)],
    })!;
    expect(out.width).toBe(684);
    expect(panelXY(out.svg).map((p) => p.x)).toEqual([112, 112]);
    expect(panelXY(out.svg)[1]!.y - panelXY(out.svg)[0]!.y).toBe(360);
  });
  it("the white backing covers the whole page", () => {
    const out = composeFigureSvg([svgEl()], { background: "white", margin: 12, places: [{ x: 100, y: 40 }], page: { w: 660, h: 890 } })!;
    expect(out.svg).toMatch(/<rect x="0" y="0" width="684" height="914"/);
  });
});
