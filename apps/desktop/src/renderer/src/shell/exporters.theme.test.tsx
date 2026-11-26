// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { composeFigureSvg, exportThemeFor, serializeGraphSvg } from "./exporters";

/**
 * Export palette — an exported figure must be legible on the page it is exported onto,
 * not on the screen it was drawn on.
 *
 * `var(--ink)` means "ink that reads on screen". Resolved against the live root instead of
 * the export page, a user working in dark mode would export near-white titles/axis-titles/value
 * labels onto a white page (a partially invisible figure), and picking one of the dialog's dark
 * page swatches in light mode would export near-black text onto it at about 1:1 contrast. Both
 * directions are covered here.
 */
const LIGHT_INK = "#1d2127";
const DARK_INK = "#e6e8eb";

function installThemeCss(): HTMLStyleElement {
  const st = document.createElement("style");
  st.textContent = `:root{--ink:${LIGHT_INK};--bg:#ffffff;} [data-theme="dark"]{--ink:${DARK_INK};--bg:#14171c;}`;
  document.head.appendChild(st);
  return st;
}

/** A figure whose title uses the theme ink, exactly as every kind's text does. */
function figure(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 200 100");
  const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
  t.setAttribute("fill", "var(--ink)");
  t.textContent = "Title";
  svg.appendChild(t);
  document.body.appendChild(svg);
  return svg;
}

let style: HTMLStyleElement;
beforeEach(() => { style = installThemeCss(); });
afterEach(() => {
  style.remove();
  delete document.documentElement.dataset.theme;
  document.body.innerHTML = "";
});

describe("export palette follows the export page, not the screen theme", () => {
  it("picks the palette from the page colour, not the app theme", () => {
    expect(exportThemeFor("white")).toBe("light");
    expect(exportThemeFor("#ffffff")).toBe("light");
    expect(exportThemeFor("#0b1020")).toBe("dark"); // a dialog dark swatch
    expect(exportThemeFor("#1a1a2e")).toBe("dark");
    // Transparent has no known destination → light ink (documents/slides are usually light).
    expect(exportThemeFor("transparent")).toBe("light");
  });

  it("dark app + white page exports dark ink (near-white would be invisible)", () => {
    document.documentElement.dataset.theme = "dark";
    const { svg } = serializeGraphSvg(figure(), { background: "white" });
    expect(svg).toContain(LIGHT_INK);
    expect(svg).not.toContain(DARK_INK);
  });

  it("light app + dark page exports light ink (not near-black on near-black)", () => {
    document.documentElement.dataset.theme = "light";
    const { svg } = serializeGraphSvg(figure(), { background: "#0b1020" });
    expect(svg).toContain(DARK_INK);
    expect(svg).not.toContain(LIGHT_INK);
  });

  it("a composed panel figure uses the same rule", () => {
    document.documentElement.dataset.theme = "dark";
    const out = composeFigureSvg([figure(), figure()], { background: "white" })!;
    expect(out.svg).toContain(LIGHT_INK);
    expect(out.svg).not.toContain(DARK_INK);
  });

  it("never leaves the app's own theme changed", () => {
    document.documentElement.dataset.theme = "dark";
    serializeGraphSvg(figure(), { background: "white" });
    expect(document.documentElement.dataset.theme).toBe("dark");
    document.documentElement.dataset.theme = "light";
    serializeGraphSvg(figure(), { background: "#0b1020" });
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
