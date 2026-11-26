// @vitest-environment jsdom
/**
 * What a clipped group shows: the figure grows to what is drawn, and a mark the plot's clip cuts away is
 * not drawn. jsdom has no layout, so each element carries the box a browser would report in `data-bb`
 * ("x,y,w,h" in its own coordinates) and a translate-only transform stands in for the screen matrix.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { drawnBounds } from "./exporters";
import { clipRectOf, outermostClipped, visibleBoxOfClipped } from "./visibleExtent";

const NS = "http://www.w3.org/2000/svg";
type Box = { x: number; y: number; w: number; h: number };

/** A translate-only matrix with the three methods the measurement uses. */
class Mat {
  constructor(public e = 0, public f = 0) {}
  get a(): number { return 1; }
  get b(): number { return 0; }
  get c(): number { return 0; }
  get d(): number { return 1; }
  inverse(): Mat { return new Mat(-this.e, -this.f); }
  multiply(o: Mat): Mat { return new Mat(this.e + o.e, this.f + o.f); }
}

const proto = (window as unknown as { SVGElement: { prototype: Record<string, unknown> } }).SVGElement.prototype;
const saved = { getBBox: proto.getBBox, getScreenCTM: proto.getScreenCTM };

const parseBb = (el: Element): Box | null => {
  const s = el.getAttribute("data-bb");
  if (!s) return null;
  const [x, y, w, h] = s.split(",").map(Number);
  return { x: x!, y: y!, w: w!, h: h! };
};
/** Is this element, or any ancestor up to the svg, hidden? */
const hidden = (el: Element): boolean => {
  for (let n: Element | null = el; n && n.tagName !== "svg"; n = n.parentElement) if ((n as SVGElement).style.display === "none") return true;
  return false;
};

beforeEach(() => {
  // The svg's own box is the union of what is showing; any other element reports its own box.
  proto.getBBox = function (this: SVGElement) {
    if (this.tagName === "svg") {
      const boxes = [...this.querySelectorAll("[data-bb]")].filter((e) => !hidden(e)).map((e) => parseBb(e)!);
      if (boxes.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
      const x0 = Math.min(...boxes.map((b) => b.x));
      const y0 = Math.min(...boxes.map((b) => b.y));
      const x1 = Math.max(...boxes.map((b) => b.x + b.w));
      const y1 = Math.max(...boxes.map((b) => b.y + b.h));
      return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
    }
    const b = parseBb(this) ?? { x: 0, y: 0, w: 0, h: 0 };
    return { x: b.x, y: b.y, width: b.w, height: b.h };
  };
  proto.getScreenCTM = function (this: SVGElement) {
    let e = 0;
    let f = 0;
    for (let n: Element | null = this; n && n.tagName !== "svg"; n = n.parentElement) {
      const m = /translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)\s*\)/.exec(n.getAttribute("transform") ?? "");
      if (m) { e += Number(m[1]); f += Number(m[2]); }
    }
    return new Mat(e, f);
  };
});
afterEach(() => {
  proto.getBBox = saved.getBBox;
  proto.getScreenCTM = saved.getScreenCTM;
  document.body.innerHTML = "";
});

function el(tag: string, attrs: Record<string, string>, parent?: Element): SVGElement {
  const e = document.createElementNS(NS, tag) as SVGElement;
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  parent?.append(e);
  return e;
}

/** A 400×300 figure with a plot clip of 300×240 at (40,20), a backdrop, and a clipped data layer. */
function figure(layer: Box, clip = { x: 40, y: 20, w: 300, h: 240 }): { svg: SVGSVGElement; layer: SVGElement } {
  const svg = el("svg", { viewBox: "0 0 400 300", width: "400", height: "300" }) as SVGSVGElement;
  const defs = el("defs", {}, svg);
  const cp = el("clipPath", { id: "plotclip" }, defs);
  el("rect", { x: String(clip.x), y: String(clip.y), width: String(clip.w), height: String(clip.h) }, cp);
  el("rect", { "data-bb": "10,10,380,280" }, svg); // the paper, inside the figure so the 1px bleed adds nothing
  const g = el("g", { "clip-path": "url(#plotclip)", "data-bb": `${layer.x},${layer.y},${layer.w},${layer.h}` }, svg);
  document.body.append(svg);
  return { svg, layer: g };
}
const BASE: Box = { x: 0, y: 0, w: 400, h: 300 };

describe("clipRectOf", () => {
  it("reads the rectangle a clip-path names", () => {
    const { layer } = figure({ x: 0, y: 0, w: 10, h: 10 });
    expect(clipRectOf(layer)).toEqual({ x: 40, y: 20, w: 300, h: 240 });
  });
  it("is null for an element with no clip", () => {
    const { svg } = figure({ x: 0, y: 0, w: 10, h: 10 });
    expect(clipRectOf(svg.querySelector("rect[data-bb]")!)).toBeNull();
  });
  it("is null when the clip is not a single plain rectangle (it cannot be intersected, so the content stays counted)", () => {
    const { svg, layer } = figure({ x: 0, y: 0, w: 10, h: 10 });
    el("circle", { cx: "5", cy: "5", r: "5" }, svg.querySelector("clipPath")!);
    expect(clipRectOf(layer)).toBeNull();
  });
  it("is null when the clip is in object-bounding-box units", () => {
    const { svg, layer } = figure({ x: 0, y: 0, w: 10, h: 10 });
    svg.querySelector("clipPath")!.setAttribute("clipPathUnits", "objectBoundingBox");
    expect(clipRectOf(layer)).toBeNull();
  });
});

describe("outermostClipped", () => {
  it("lists a clipped group once, not the clipped groups nested inside it", () => {
    const { svg, layer } = figure({ x: 0, y: 0, w: 10, h: 10 });
    el("g", { "clip-path": "url(#plotclip)", "data-bb": "0,0,5,5" }, layer);
    expect(outermostClipped(svg)).toEqual([layer]);
  });
});

describe("visibleBoxOfClipped", () => {
  it("is the part of the group the clip lets through", () => {
    const { svg, layer } = figure({ x: -50, y: -8000, w: 600, h: 9000 });
    expect(visibleBoxOfClipped(svg, layer)).toEqual({ x: 40, y: 20, w: 300, h: 240 });
  });
  it("is null when nothing of the group is inside the clip", () => {
    const { svg, layer } = figure({ x: 0, y: -900, w: 400, h: 100 });
    expect(visibleBoxOfClipped(svg, layer)).toBeNull();
  });
  it("follows a translated parent: the clip and the group share the group's own coordinates", () => {
    const { svg, layer } = figure({ x: 0, y: 0, w: 100, h: 100 });
    layer.setAttribute("transform", "translate(30,10)");
    expect(visibleBoxOfClipped(svg, layer)).toEqual({ x: 70, y: 30, w: 60, h: 80 });
  });
});

describe("drawnBounds with a clipped data layer", () => {
  it("does not grow for marks the plot's clip cuts away (a fixed axis range with data far outside it)", () => {
    const { svg } = figure({ x: 60, y: -21371, w: 330, h: 21700 });
    expect(drawnBounds(svg, BASE)).toEqual(BASE);
  });
  it("does not grow sideways either", () => {
    const { svg } = figure({ x: -1800, y: 30, w: 4200, h: 200 });
    expect(drawnBounds(svg, BASE)).toEqual(BASE);
  });
  it("still grows to the clip's own edge when the clip itself reaches past the figure", () => {
    const { svg } = figure({ x: 0, y: 0, w: 900, h: 300 }, { x: 40, y: 20, w: 460, h: 240 });
    expect(drawnBounds(svg, BASE)).toEqual({ x: 0, y: 0, w: 501, h: 300 });
  });
  it("still counts what is outside the clip and drawn: a legend past the figure's edge", () => {
    const { svg } = figure({ x: 60, y: 30, w: 200, h: 100 });
    el("g", { "data-bb": "380,40,120,60" }, svg);
    expect(drawnBounds(svg, BASE)).toEqual({ x: 0, y: 0, w: 501, h: 300 });
  });
  it("still counts a clipped group whose clip it cannot read", () => {
    const { svg } = figure({ x: 60, y: -500, w: 330, h: 600 });
    el("circle", { cx: "5", cy: "5", r: "5" }, svg.querySelector("clipPath")!);
    expect(drawnBounds(svg, BASE).y).toBe(-501);
  });
  it("leaves the clipped group showing afterwards", () => {
    const { svg, layer } = figure({ x: 60, y: -500, w: 330, h: 600 });
    drawnBounds(svg, BASE);
    expect(layer.style.display).toBe("");
  });
});
