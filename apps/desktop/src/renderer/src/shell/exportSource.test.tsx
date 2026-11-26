// @vitest-environment jsdom
// Where an export reads its drawing: the whole document by default, or one ROOT — the off-screen stage
// Export all draws each item on while the user's own figure stays on screen.
import { afterEach, describe, expect, it } from "vitest";
import { activeGraphSvg, composeActiveFigureSvg } from "./exportSource";

afterEach(() => { document.body.innerHTML = ""; });

const panelSvg = (w: number): SVGSVGElement => {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("class", "gfx-figure");
  s.setAttribute("viewBox", `0 0 ${w} 100`);
  return s;
};
const figure = (panels: number, w: number): HTMLElement => {
  const canvas = document.createElement("div");
  canvas.className = "laygrid laycanvas";
  for (let i = 0; i < panels; i++) {
    const p = document.createElement("div");
    p.className = "laypanel";
    p.appendChild(panelSvg(w));
    canvas.appendChild(p);
  }
  return canvas;
};
/** How many panel drawings a composed figure holds: the NESTED `<svg viewBox="0 0 W 100" x=…>` (a lone panel's figure
 *  has the same viewBox on its outer `<svg>`, which carries no `x`). */
const panelsIn = (svg: string, w: number): number => (svg.match(new RegExp(`viewBox="0 0 ${w} 100" x=`, "g")) ?? []).length;

describe("composeActiveFigureSvg", () => {
  it("reads the given root only; without one, the document's first figure", () => {
    document.body.appendChild(figure(3, 300)); // the user's figure on screen
    const stage = document.createElement("div");
    stage.appendChild(figure(1, 111)); // the stage's figure
    document.body.appendChild(stage);
    const fromStage = composeActiveFigureSvg({ background: "white", root: stage })!;
    expect(panelsIn(fromStage.svg, 111)).toBe(1);
    expect(panelsIn(fromStage.svg, 300)).toBe(0);
    const fromPage = composeActiveFigureSvg({ background: "white" })!;
    expect(panelsIn(fromPage.svg, 300)).toBe(3);
  });
});

describe("activeGraphSvg", () => {
  it("reads the given root only", () => {
    const onScreen = panelSvg(10);
    document.body.appendChild(onScreen);
    const stage = document.createElement("div");
    const staged = panelSvg(20);
    stage.appendChild(staged);
    document.body.appendChild(stage);
    expect(activeGraphSvg(undefined, stage)).toBe(staged);
    expect(activeGraphSvg()).toBe(onScreen);
  });
});
