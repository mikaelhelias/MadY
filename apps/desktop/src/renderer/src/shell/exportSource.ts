/**
 * Where an export reads its drawing from. The Export dialog, File ▸ Print, Copy as picture and
 * Export all read the graph / figure the app has drawn — the laid-out DOM is the single source of truth for positions,
 * letters and the page. Every reader takes the root it reads: the whole document (the on-screen graph or figure, the
 * default) or the off-screen stage `Export all` draws each graph and figure on in turn.
 */
import { composeFigureSvg, type ExportBackground, type PanelLetter, type SerializedSvg } from "./exporters";

/** A document, or one element of it, to read an export from. */
export type ExportRoot = Pick<Document, "querySelector" | "querySelectorAll">;

/** Read the live, on-screen graph SVG (behind the modal). When a plot id is given,
 *  target that plot's panel (figure-builder panels carry `data-pid`) so exporting a
 *  selected panel doesn't grab the document's first `.gfx-figure` (panel A). Falls back
 *  to the sole on-screen graph for a standalone plot (which carries no data-pid). */
export function activeGraphSvg(plotId?: string, root: ExportRoot = document): SVGSVGElement | null {
  if (plotId) {
    const safe = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(plotId) : plotId.replace(/["\\]/g, "\\$&");
    const byId = root.querySelector<SVGSVGElement>(`[data-pid="${safe}"] svg.gfx-figure`);
    if (byId) return byId;
  }
  return root.querySelector<SVGSVGElement>(".gfx-figure");
}

/** Everything the composed figure draws, in DOM order: the panels, then the merged legend
 *  when the figure has one. All three readers below query this same set so their indices
 *  stay aligned — the composer pairs svgs[i] with places[i] and letters[i]. */
const FIGURE_PART = ".laypanel, .layfiglegend";

function figurePanelSvgs(root: ExportRoot): SVGSVGElement[] {
  return [...root.querySelectorAll<HTMLElement>(FIGURE_PART)]
    .map((el) => el.querySelector<SVGSVGElement>("svg.gfx-figure"))
    .filter((s): s is SVGSVGElement => s != null);
}

/** Each panel's A/B/C letter + its on-screen typography (family/size/weight/colour),
 *  read live so the exported figure matches the customised labels. null = no letter. */
function figurePanelLetters(root: ExportRoot): Array<PanelLetter | null> {
  return [...root.querySelectorAll<HTMLElement>(FIGURE_PART)].map((panel) => {
    const el = panel.querySelector<HTMLElement>(".laypanel-letter");
    const text = el?.textContent?.trim();
    if (!el || !text) return null;
    const cs = getComputedStyle(el);
    const base: PanelLetter = {
      text,
      family: cs.fontFamily || "system-ui, sans-serif",
      size: Math.round(parseFloat(cs.fontSize) || 15),
      weight: cs.fontWeight || "700",
      color: cs.color || "#1a1a1a",
    };
    // The label's glyph offset from the graph's top-left, in layout px (screen px with the
    // canvas view-zoom divided out) — the same units the composer lays panels out in, which
    // is each panel's rendered size, not its viewBox size. Dividing by the svg's own scale
    // here as well would double-count a miniature's k.
    const svg = panel.querySelector<SVGSVGElement>("svg.gfx-figure");
    if (svg) {
      const lr = el.getBoundingClientRect();
      const sr = svg.getBoundingClientRect();
      const zoom = canvasViewZoom(root);
      const padL = parseFloat(cs.paddingLeft) || 0;
      const padT = parseFloat(cs.paddingTop) || 0;
      base.ox = (lr.left + padL - sr.left) / zoom;
      base.oy = (lr.top + padT - sr.top) / zoom;
    }
    return base;
  });
}

/** The arrange canvas's view-zoom (its CSS transform scale): on-screen size over layout
 *  size. Screen measurements divided by this become layout px, so an export taken while
 *  the view is zoomed matches the one taken at 100%. 1 when there is no canvas. */
function canvasViewZoom(root: ExportRoot): number {
  const canvas = root.querySelector<HTMLElement>(".laygrid, .laycanvas");
  if (!canvas || !canvas.offsetWidth) return 1;
  const w = canvas.getBoundingClientRect().width;
  return w > 0 ? w / canvas.offsetWidth : 1;
}

/** When the assembler is in free-drag mode, each panel's canvas-local top-left (px),
 *  in panel order — so the exported figure matches the dragged arrangement. null in grid mode. */
function figurePanelPlaces(root: ExportRoot): Array<{ x: number; y: number }> | null {
  // Every figure exports at its on-screen positions — free-drag, auto-align and the plain
  // CSS grid. The laid-out DOM is the single source of truth, so column count, gutter and
  // column spans are all reproduced for free. Re-deriving a grid inside the composer would
  // duplicate that layout and can disagree with it: the composer defaults to 2 columns and
  // the dialog does not pass the figure's actual `columns`, so a 3-column figure would
  // export as 2. `.laygrid` matches both containers (the absolute one carries
  // `laygrid laycanvas`), so this is one path rather than two.
  const canvas = root.querySelector<HTMLElement>(".laygrid, .laycanvas");
  if (!canvas) return null;
  const cr = canvas.getBoundingClientRect();
  const zoom = canvasViewZoom(root);
  return [...root.querySelectorAll<HTMLElement>(FIGURE_PART)].map((el) => {
    // Measure the graph svg, not the card: a card enlarged by the two-level resize
    // centres its graph in extra whitespace, and the export must place the drawing
    // where it sits on screen (the card rect is equivalent only while every card's chrome
    // offset is the same). The svg is placed at the same spot the composer anchors
    // panels (its top-left), so nothing else changes.
    const svg = el.querySelector<SVGSVGElement>("svg.gfx-figure");
    const r = (svg ?? el).getBoundingClientRect();
    // Layout px (view-zoom divided out), matching the composer's panel sizes, so a zoomed
    // view does not stretch the exported spacing while the panels stay layout-sized.
    return { x: (r.left - cr.left) / zoom, y: (r.top - cr.top) / zoom };
  });
}

/** The gutter the figure shows on screen. A fallback only: `figurePanelPlaces` normally
 *  supplies exact positions, which already encode the spacing. This still matters when the
 *  places can't be derived (no laid-out container), so the composer's grid branch at least
 *  spaces panels the way the figure does rather than at a hard-coded 16. */
function figureGridGap(root: ExportRoot): number | null {
  const grid = root.querySelector<HTMLElement>(".laygrid");
  if (!grid) return null;
  const g = parseFloat(getComputedStyle(grid).rowGap || "");
  return Number.isFinite(g) ? g : null;
}

/**
 * Compose the active on-screen figure (panels + merged legend, at their laid-out positions)
 * into one standalone SVG. The single source of truth for figure serialization, shared by the
 * Export dialog (`buildSerialized`) and File ▸ Print — so a printed figure matches an exported
 * one exactly. Returns null when no figure is on screen. */
export function composeActiveFigureSvg(opts: { background: ExportBackground; margin?: number; root?: ExportRoot | undefined }): SerializedSvg | null {
  const root = opts.root ?? document;
  const svgs = figurePanelSvgs(root);
  if (svgs.length === 0) return null;
  const places = figurePanelPlaces(root);
  const gap = figureGridGap(root);
  // The figure-object overlay (text/arrows/shapes drawn on the canvas) exports too — read
  // it from the DOM like the panels, with its canvas-local origin in layout px.
  const overlayEl = root.querySelector<SVGSVGElement>("svg.layannot");
  const canvas = root.querySelector<HTMLElement>(".laygrid, .laycanvas");
  let overlay: { svg: SVGSVGElement; x: number; y: number } | null = null;
  if (overlayEl && canvas && places) {
    const zoom = canvasViewZoom(root);
    const cr = canvas.getBoundingClientRect();
    const or = overlayEl.getBoundingClientRect();
    overlay = { svg: overlayEl, x: (or.left - cr.left) / zoom, y: (or.top - cr.top) / zoom };
  }
  // The figure's page (canvas px), stamped on the canvas by the assembler when one is set.
  const pw = Number(canvas?.dataset.pageW), ph = Number(canvas?.dataset.pageH);
  const page = places && pw > 0 && ph > 0 ? { w: pw, h: ph } : null;
  return composeFigureSvg(svgs, {
    background: opts.background,
    margin: opts.margin ?? 0,
    letters: figurePanelLetters(root),
    ...(places ? { places } : {}),
    ...(gap != null ? { gap } : {}),
    ...(overlay ? { overlay } : {}),
    ...(page ? { page } : {}),
  });
}
