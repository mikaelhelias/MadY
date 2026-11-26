// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { browserDownload, composeFigureSvg, htmlWrap, serializeGraphSvg } from "./exporters";

function svgEl(w = 380, h = 260): SVGSVGElement {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", `0 0 ${w} ${h}`);
  s.setAttribute("class", "gfx-figure");
  return s;
}

describe("composeFigureSvg — free-drag placement", () => {
  it("places panels at the given positions (normalised to hug the top-left)", () => {
    const panels = [svgEl(), svgEl()];
    // B is to the right of and below A
    const out = composeFigureSvg(panels, { background: "white", margin: 12, places: [{ x: 100, y: 40 }, { x: 560, y: 220 } ] });
    expect(out).toBeTruthy();
    // two panels at very different positions → the composed canvas is wide and tall
    expect(out!.width).toBeGreaterThan(560); // spans across to the 2nd panel
    expect(out!.height).toBeGreaterThan(220 - 40 + 260); // spans the vertical offset + panel height
    // both panel svgs end up in the output, plus A/B letters
    expect(out!.svg).toContain(">A<");
    expect(out!.svg).toContain(">B<");
  });

  it("falls back to the auto-grid when no places are given", () => {
    const panels = [svgEl(), svgEl(), svgEl()];
    const grid = composeFigureSvg(panels, { background: "white" });
    const free = composeFigureSvg(panels, { background: "white", places: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 800, y: 0 }] });
    // a single horizontal row (free) is wider than the 2-column grid for 3 panels
    expect(free!.width).toBeGreaterThan(grid!.width);
  });
});

describe("composeFigureSvg — customizable panel letters", () => {
  it("renders custom letter text + typography from the layout", () => {
    const panels = [svgEl(), svgEl()];
    const out = composeFigureSvg(panels, {
      background: "white",
      letters: [
        { text: "a", family: "Georgia, serif", size: 24, weight: "400", color: "#ff0000" },
        { text: "b", family: "Georgia, serif", size: 24, weight: "400", color: "#ff0000" },
      ],
    });
    expect(out!.svg).toContain(">a<");
    expect(out!.svg).toContain(">b<");
    expect(out!.svg).toContain('font-size="24"');
    expect(out!.svg).toContain('font-weight="400"');
    expect(out!.svg).toContain('fill="#ff0000"');
  });

  it("draws no letter (and reserves no band) when a panel's letter is null", () => {
    const panels = [svgEl(), svgEl()];
    const none = composeFigureSvg(panels, { background: "white", letters: [null, null] });
    const withLetters = composeFigureSvg(panels, { background: "white" });
    // no <text> letters at all
    expect(none!.svg).not.toMatch(/>A</);
    // and the letter band is reclaimed → shorter than the default-lettered figure
    expect(none!.height).toBeLessThan(withLetters!.height);
  });

  it("reproduces the label's dragged offset (ox/oy) — the canvas grows when it sits outside the panel", () => {
    const L = (ox: number, oy: number) => ({ text: "A", family: "Arial", size: 22, weight: "700", color: "#000", ox, oy });
    const near = composeFigureSvg([svgEl()], { background: "white", letters: [L(5, 5)] })!;
    const farLeft = composeFigureSvg([svgEl()], { background: "white", letters: [L(-120, 5)] })!;
    const farDown = composeFigureSvg([svgEl()], { background: "white", letters: [L(5, 400)] })!;
    expect(farLeft.svg).toContain(">A<");
    expect(farLeft.width).toBeGreaterThan(near.width); // label dragged left of the panel widens the export
    expect(farDown.height).toBeGreaterThan(near.height); // dragged below the panel grows it taller
  });
});

describe("composeFigureSvg — miniature panels export at their rendered size (Keep proportions)", () => {
  // A "Keep proportions" panel's svg declares width = viewBox width · k (PlotFigure's zoom
  // does the scaling). The composer places panels by their on-screen rects, so it must also
  // draw each panel at its rendered size — composing at full viewBox size while placing at
  // scaled positions makes the exported panels overlap.
  const mini = (w = 580, h = 380, k = 0.5): SVGSVGElement => {
    const s = svgEl(w, h);
    s.setAttribute("width", String(w * k));
    s.setAttribute("height", String(h * k));
    return s;
  };

  it("draws a scaled panel at its rendered size, not its viewBox size", () => {
    const out = composeFigureSvg([mini()], { background: "white", margin: 0, letters: [null] })!;
    expect(out.width).toBeCloseTo(290, 0); // 580 · 0.5
    expect(out.height).toBeCloseTo(190, 0); // 380 · 0.5
    // the nested svg keeps the full viewBox at the rendered size — a uniform scale
    expect(out.svg).toContain('viewBox="0 0 580 380" width="290" height="190"');
  });

  it("two miniatures at their screen places do not overlap in the export", () => {
    // side by side on screen: 290px-wide miniatures, 16px gutter
    const out = composeFigureSvg([mini(), mini()], { background: "white", margin: 0, places: [{ x: 0, y: 0 }, { x: 306, y: 0 }], letters: [null, null] })!;
    // an unscaled composition would put 580px of drawing at x=0, overlapping the panel at x=306
    expect(out.width).toBeCloseTo(306 + 290, 0);
  });

  it("a panel with no width attribute still composes 1:1 (standalone svgs are unscaled)", () => {
    const out = composeFigureSvg([svgEl(200, 100)], { background: "white", margin: 0, letters: [null] })!;
    expect(out.width).toBe(200);
  });
});

describe("htmlWrap — self-contained HTML figure export (panels)", () => {
  it("embeds the SVG inline in a full HTML document with the title escaped", () => {
    const html = htmlWrap("<svg><rect/></svg>", 'Fig "1" <x>', "white");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<svg><rect/></svg>"); // the figure vector, inline
    expect(html).toContain("background:white;");
    expect(html).toContain("Fig &quot;1&quot; &lt;x&gt;"); // title escaped, no raw < or "
    expect(html).toContain("svg { max-width: 100%; height: auto; }"); // responsive
  });

  it("omits a background rule when transparent", () => {
    const html = htmlWrap("<svg/>", "t", "transparent");
    expect(html).not.toContain("background:");
  });
});

describe("serializeGraphSvg — strips interactive chrome", () => {
  it("removes resize grips and snap guides from a single-graph export", () => {
    const svg = svgEl(400, 300);
    const grip = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    grip.setAttribute("class", "gfx-figresize");
    svg.appendChild(grip);
    const guide = document.createElementNS("http://www.w3.org/2000/svg", "g");
    guide.setAttribute("class", "gfx-snapguides");
    svg.appendChild(guide);
    const out = serializeGraphSvg(svg, { background: "white" });
    expect(out.svg).not.toContain("gfx-figresize");
    expect(out.svg).not.toContain("gfx-snapguides");
  });

  it("removes the label hit boxes (DraggableTitle click targets) from an export", () => {
    const svg = svgEl(400, 300);
    const hit = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    hit.setAttribute("class", "gfx-draghit");
    svg.appendChild(hit);
    const out = serializeGraphSvg(svg, { background: "white" });
    expect(out.svg).not.toContain("gfx-draghit");
  });

  it("removes a selected annotation's delete cross and handles", () => {
    // An object is selected the instant it is created, so "add a significance marker,
    // then export" is the ordinary flow — not a corner case. Without this, that flow would
    // serialize the delete cross and the resize grips straight into the figure.
    const svg = svgEl(400, 300);
    for (const cls of ["gfx-anndelete", "gfx-annhandle"]) {
      const el = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      el.setAttribute("class", cls);
      svg.appendChild(el);
    }
    const out = serializeGraphSvg(svg, { background: "white" });
    expect(out.svg).not.toContain("gfx-anndelete");
    expect(out.svg).not.toContain("gfx-annhandle");
  });
});

describe("browserDownload — web/preview export fallback", () => {
  it("returns false for formats that need the desktop app (no text/base64)", () => {
    expect(browserDownload({ format: "pdf", suggestedName: "fig" })).toBe(false);
  });

  it("triggers a download for text formats and names the file by format", () => {
    const origCreate = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    URL.createObjectURL = () => "blob:mock";
    URL.revokeObjectURL = () => {};
    let downloadName = "";
    const realCreate = document.createElement.bind(document);
    const spy = vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = realCreate(tag);
      if (tag === "a") (el as HTMLAnchorElement).click = function () { downloadName = (this as HTMLAnchorElement).download; };
      return el;
    });
    try {
      expect(browserDownload({ format: "html", suggestedName: "My Figure", text: "<html></html>" })).toBe(true);
      expect(downloadName).toBe("My_Figure.html");
    } finally {
      spy.mockRestore();
      URL.createObjectURL = origCreate;
      URL.revokeObjectURL = origRevoke;
    }
  });
});

/**
 * An image panel is an ordinary panel whose SVG happens to contain an <image>
 * with the picture as a data URI. The composer clones panel SVGs wholesale, so the picture's
 * bytes are expected to come along; these tests check that they do, because a figure that
 * exports without its picture loses content without any error.
 */
describe("composeFigureSvg — image panels survive the export", () => {
  const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0k";
  function imagePanel(): SVGSVGElement {
    const s = svgEl();
    const img = document.createElementNS("http://www.w3.org/2000/svg", "image");
    img.setAttribute("href", PNG);
    img.setAttribute("x", "0");
    img.setAttribute("y", "0");
    img.setAttribute("width", "380");
    img.setAttribute("height", "260");
    img.setAttribute("preserveAspectRatio", "xMidYMid meet");
    s.appendChild(img);
    return s;
  }

  it("carries the picture's bytes into the composed figure", () => {
    const out = composeFigureSvg([imagePanel(), svgEl()], { background: "white", margin: 12 });
    expect(out).not.toBeNull();
    expect(out!.svg).toContain("<image");
    expect(out!.svg).toContain(PNG); // the actual bytes, not a reference to a file
  });

  it("keeps the fit mode, so an exported micrograph is not cropped or stretched", () => {
    const out = composeFigureSvg([imagePanel()], { background: "white" });
    expect(out!.svg).toContain('preserveAspectRatio="xMidYMid meet"');
  });

  it("letters an image panel like any other panel", () => {
    const out = composeFigureSvg([svgEl(), imagePanel()], {
      background: "white",
      letters: [
        { text: "A", family: "sans-serif", size: 15, weight: "700", color: "#000" },
        { text: "B", family: "sans-serif", size: 15, weight: "700", color: "#000" },
      ],
    });
    expect(out!.svg).toContain(">A<");
    expect(out!.svg).toContain(">B<");
  });
});

describe("export keeps the font the graph is drawn in", () => {
  // On screen, text with no font of its own inherits the app's font from the page; a file has no
  // page around it, so without a font on its root the text falls back to the viewer's serif.
  function withText(fam?: string): SVGSVGElement {
    const s = svgEl();
    const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
    t.textContent = "Dose (µM)";
    if (fam) t.setAttribute("font-family", fam);
    s.appendChild(t);
    document.body.appendChild(s);
    return s;
  }
  /** The root element's `font-family`, read off the serialised text (the file's own markup). */
  const rootFont = (svg: string): string | null => /^<svg\b[^>]*?\sfont-family="([^"]*)"/.exec(svg)?.[1] ?? null;

  it("a single graph's file names a sans-serif font on its root", () => {
    expect(rootFont(serializeGraphSvg(withText()).svg)).toMatch(/sans-serif/);
  });
  it("a font set on the graph itself is kept", () => {
    const s = withText();
    s.setAttribute("font-family", "Courier New, monospace");
    expect(rootFont(serializeGraphSvg(s).svg)).toBe("Courier New, monospace");
  });
  it("each panel of a figure names its font", () => {
    const out = composeFigureSvg([withText(), withText()], { background: "white" })!;
    const panels = [...out.svg.matchAll(/<svg\b[^>]*>/g)].slice(1).map((m) => / font-family="([^"]*)"/.exec(m[0])?.[1] ?? null);
    expect(panels).toHaveLength(2);
    for (const fam of panels) expect(fam).toMatch(/sans-serif/);
  });
  it("text with its own font keeps it", () => {
    const out = serializeGraphSvg(withText("Georgia, serif")).svg;
    expect(out).toContain('font-family="Georgia, serif"');
  });
});
