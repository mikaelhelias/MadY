/**
 * What a clipped group actually shows.
 *
 * `getBBox` measures geometry and ignores `clip-path`, so a data layer clipped to the plot area reports
 * every mark it holds — including marks the clip cuts away because the axis range leaves them out. The
 * figure grows to "what is drawn", and a clipped-away mark is not drawn. These helpers give the part of a
 * clipped group the clip lets through, in the svg's own coordinates, so the measurement counts that part
 * and nothing else.
 *
 * Only a single plain rectangle in user-space units can be intersected. Any other clip (a path, several
 * shapes, object-bounding-box units) is left alone: its group is counted in full.
 */
export type Box = { x: number; y: number; w: number; h: number };

/** The rectangle `el`'s `clip-path` names, in `el`'s own coordinates; null when it has none or cannot be read as one. */
export function clipRectOf(el: Element): Box | null {
  const ref = /^url\(\s*["']?#([^"')\s]+)["']?\s*\)$/.exec((el.getAttribute("clip-path") ?? "").trim());
  if (!ref) return null;
  const clip = el.ownerDocument.getElementById(ref[1]!);
  if (!clip || clip.tagName.toLowerCase() !== "clippath") return null;
  if ((clip.getAttribute("clipPathUnits") ?? "userSpaceOnUse") !== "userSpaceOnUse") return null;
  if (clip.hasAttribute("transform") || clip.hasAttribute("clip-path")) return null;
  const kids = [...clip.children];
  if (kids.length !== 1 || kids[0]!.tagName.toLowerCase() !== "rect") return null;
  const r = kids[0]!;
  if (r.hasAttribute("transform") || r.hasAttribute("rx") || r.hasAttribute("ry")) return null;
  const n = (a: string): number => Number(r.getAttribute(a) ?? 0);
  const box = { x: n("x"), y: n("y"), w: n("width"), h: n("height") };
  return Object.values(box).every(Number.isFinite) && box.w >= 0 && box.h >= 0 ? box : null;
}

/** The clipped groups with a readable clip that are not inside another clipped group. */
export function outermostClipped(svg: SVGSVGElement): Element[] {
  const all = [...svg.querySelectorAll("[clip-path]")].filter((e) => clipRectOf(e) !== null);
  return all.filter((e) => !all.some((o) => o !== e && o.contains(e)));
}

/** The part of clipped group `el` that its clip lets through, in `svg`'s coordinates; null when none of it shows. */
export function visibleBoxOfClipped(svg: SVGSVGElement, el: Element): Box | null {
  const clip = clipRectOf(el);
  if (!clip) return null;
  const g = el as unknown as SVGGraphicsElement;
  let bb: DOMRect;
  try {
    bb = g.getBBox();
  } catch {
    return null;
  }
  if (!(bb.width > 0 && bb.height > 0)) return null;
  // The group's own coordinates → the svg's. Relative to the svg, so the page's zoom and scroll cancel.
  const from = g.getScreenCTM();
  const root = svg.getScreenCTM();
  if (!from || !root) return null;
  const m = root.inverse().multiply(from);
  const x0 = Math.max(bb.x, clip.x);
  const y0 = Math.max(bb.y, clip.y);
  const x1 = Math.min(bb.x + bb.width, clip.x + clip.w);
  const y1 = Math.min(bb.y + bb.height, clip.y + clip.h);
  if (!(x1 > x0 && y1 > y0)) return null;
  const pts = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => ({ x: m.a * x! + m.c * y! + m.e, y: m.b * x! + m.d * y! + m.f }));
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}
