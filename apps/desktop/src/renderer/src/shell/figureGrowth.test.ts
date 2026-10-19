// @vitest-environment jsdom
/**
 * The drawing grows to what is on it — and the export measures it
 * the same way. jsdom has no layout, so `getBBox` is stubbed with the box a real browser would
 * report; the stub also records which interaction chrome was still showing at the moment of
 * measuring, because a click target's estimated width must never grow a figure.
 */
import { afterEach, describe, expect, it } from "vitest";
import { drawnBounds, serializeGraphSvg } from "./exporters";
import { growFigureToDrawing, holdHeightWhileResizing, unclipWhileDragging } from "./figureGrowth";

const NS = "http://www.w3.org/2000/svg";
let bbox = { x: 0, y: 0, width: 100, height: 100 };
let chromeShowingAtMeasure: string[] = [];
const proto = (window as unknown as { SVGElement: { prototype: Record<string, unknown> } }).SVGElement.prototype;
proto.getBBox = function (this: SVGSVGElement) {
  chromeShowingAtMeasure = [...this.querySelectorAll<SVGElement>(".gfx-draghit, .gfx-figresize")]
    .filter((el) => el.style.display !== "none")
    .map((el) => el.getAttribute("class") ?? "");
  return bbox;
};
afterEach(() => { document.body.innerHTML = ""; });

/** A 400×300 figure with a click target and a resize grip in it, like the real graph view. */
function figure(): SVGSVGElement {
  const svg = document.createElementNS(NS, "svg") as SVGSVGElement;
  svg.setAttribute("class", "gfx-figure");
  svg.setAttribute("viewBox", "0 0 400 300");
  svg.setAttribute("width", "400");
  svg.setAttribute("height", "300");
  const hit = document.createElementNS(NS, "rect");
  hit.setAttribute("class", "gfx-draghit");
  hit.style.display = "inline";
  const grip = document.createElementNS(NS, "g");
  grip.setAttribute("class", "gfx-figresize");
  svg.append(hit, grip);
  document.body.append(svg);
  return svg;
}

describe("drawnBounds", () => {
  it("is the figure box when everything drawn sits inside it", () => {
    bbox = { x: 10, y: 10, width: 300, height: 200 };
    expect(drawnBounds(figure(), { x: 0, y: 0, w: 400, h: 300 })).toEqual({ x: 0, y: 0, w: 400, h: 300 });
  });
  it("takes in what is drawn past any edge, with a 1px bleed", () => {
    bbox = { x: -60, y: 20, width: 560, height: 330 }; // left to -60, right to 500, bottom to 350
    expect(drawnBounds(figure(), { x: 0, y: 0, w: 400, h: 300 })).toEqual({ x: -61, y: 0, w: 562, h: 351 });
  });
  it("measures with click targets and grips hidden, and puts them back", () => {
    const svg = figure();
    drawnBounds(svg, { x: 0, y: 0, w: 400, h: 300 });
    expect(chromeShowingAtMeasure, "chrome counted as drawing").toEqual([]);
    expect(svg.querySelector<SVGElement>(".gfx-draghit")!.style.display).toBe("inline");
    expect(svg.querySelector<SVGElement>(".gfx-figresize")!.style.display).toBe("");
  });
});

describe("growFigureToDrawing", () => {
  it("an untouched figure whose drawing fills its box exactly does not grow by the bleed", () => {
    const svg = figure();
    bbox = { x: 0, y: 0, width: 400, height: 300 };
    growFigureToDrawing(svg, 400, 300, 1);
    expect(svg.getAttribute("viewBox")).toBe("0 0 400 300");
  });
  it("widens the visible area and the on-screen size, and records the figure's own size", () => {
    const svg = figure();
    bbox = { x: 0, y: 0, width: 520, height: 300 };
    growFigureToDrawing(svg, 400, 300, 2);
    expect(svg.getAttribute("viewBox")).toBe("0 0 521 300");
    expect(svg.getAttribute("width")).toBe(String(521 * 2));
    expect(svg.getAttribute("height")).toBe(String(300 * 2));
    expect([svg.getAttribute("data-figure-w"), svg.getAttribute("data-figure-h")]).toEqual(["400", "300"]);
  });
  it("shrinks back to the figure when the far item comes home", () => {
    const svg = figure();
    bbox = { x: 0, y: 0, width: 520, height: 300 };
    growFigureToDrawing(svg, 400, 300, 1);
    bbox = { x: 20, y: 20, width: 300, height: 200 };
    growFigureToDrawing(svg, 400, 300, 1);
    expect(svg.getAttribute("viewBox")).toBe("0 0 400 300");
  });
});

describe("unclipWhileDragging", () => {
  /** The graph view's host div with the figure inside it, and a legend that stops the bubble. */
  function hosted(): { host: HTMLDivElement; svg: SVGSVGElement; legend: SVGGElement } {
    const host = document.createElement("div");
    const svg = figure();
    host.append(svg);
    document.body.append(host);
    const legend = document.createElementNS(NS, "g") as SVGGElement;
    // Every drag handler in PlotFigure stops the pointerdown so the press can't also pan the plot.
    legend.addEventListener("pointerdown", (e) => e.stopPropagation());
    svg.append(legend);
    return { host, svg, legend };
  }
  const press = (el: Element): void => { el.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })); };

  it("lets the figure draw past its edge while a legend is being dragged", () => {
    const { host, svg, legend } = hosted();
    const stop = unclipWhileDragging(host);
    press(legend);
    expect(svg.style.overflow, "the drag is clipped to the figure, so the legend vanishes mid-drag").toBe("visible");
    stop();
  });
  it("clips again once the pointer is released — outside the figure, where drags end", () => {
    const { host, svg, legend } = hosted();
    const stop = unclipWhileDragging(host);
    press(legend);
    window.dispatchEvent(new MouseEvent("pointerup"));
    expect(svg.style.overflow).toBe("");
    stop();
  });
  it("clips again when the drag is cancelled, not only when it ends cleanly", () => {
    const { host, svg, legend } = hosted();
    const stop = unclipWhileDragging(host);
    press(legend);
    window.dispatchEvent(new MouseEvent("pointercancel"));
    expect(svg.style.overflow).toBe("");
    stop();
  });
  it("stops listening when the graph view goes away", () => {
    const { host, svg, legend } = hosted();
    unclipWhileDragging(host)();
    press(legend);
    expect(svg.style.overflow).toBe("");
  });
});

describe("the export measures a grown figure from the figure's own size", () => {
  it("a figure grown earlier, whose far item has come home, exports at its own size", () => {
    const svg = figure();
    bbox = { x: 0, y: 0, width: 520, height: 300 };
    growFigureToDrawing(svg, 400, 300, 1);
    bbox = { x: 20, y: 20, width: 300, height: 200 }; // moved back before the view re-measured
    const out = serializeGraphSvg(svg, { background: "transparent" });
    expect([out.width, out.height]).toEqual([400, 300]);
  });
  it("and includes what sticks out", () => {
    const svg = figure();
    bbox = { x: -30, y: 0, width: 430, height: 300 };
    growFigureToDrawing(svg, 400, 300, 1);
    const out = serializeGraphSvg(svg, { background: "transparent" });
    expect(out.width).toBe(432); // -31 … 401: the export keeps its 1px bleed on both sides
  });
});

describe("holdHeightWhileResizing — the graph does not move under a corner drag", () => {
  // With the pane scrolled, a shrinking graph can make the page shorter than the pane; the scroll then snaps to 0
  // and the graph jumps down under the held corner. Holding the host's height for the drag keeps the page as tall
  // as it was, so there is nothing to give back.
  const setup = () => {
    const host = document.createElement("div");
    Object.defineProperty(host, "offsetHeight", { configurable: true, get: () => 760 });
    const svg = document.createElementNS(NS, "svg");
    const grips = document.createElementNS(NS, "g");
    grips.setAttribute("class", "gfx-figresize");
    const corner = document.createElementNS(NS, "rect");
    const other = document.createElementNS(NS, "rect");
    grips.appendChild(corner);
    svg.append(grips, other);
    host.appendChild(svg);
    document.body.appendChild(host);
    let ended = 0;
    const off = holdHeightWhileResizing(host, () => { ended += 1; });
    return { host, corner, other, off, ended: () => ended };
  };
  afterEach(() => { document.body.innerHTML = ""; });

  it("a press on a resize grip holds the height it had; the release lets go and ends the drag", () => {
    const { host, corner, off, ended } = setup();
    corner.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(host.style.minHeight).toBe("760px");
    window.dispatchEvent(new Event("pointerup"));
    expect(host.style.minHeight).toBe("");
    expect(ended()).toBe(1);
    off();
  });
  it("a press anywhere else holds nothing and ends nothing", () => {
    const { host, other, off, ended } = setup();
    other.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(host.style.minHeight).toBe("");
    window.dispatchEvent(new Event("pointerup"));
    expect(ended()).toBe(0);
    off();
  });
});
