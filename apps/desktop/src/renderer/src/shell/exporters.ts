/**
 * Export helpers: turn the live document/graph into bytes the
 * main process writes to disk. Graphs → **SVG** (vector), **PNG** / **JPEG** / **TIFF**
 * (raster, any size; TIFF also in CMYK), **EPS** and self-contained **HTML**; the vector
 * **PDF** and the **PowerPoint** slide are made in main from the SVG serialised here.
 * Data/results → **CSV**, an **XLSX** grid, **JSON**. Mostly pure renderer utilities; the
 * OS save dialog + the file write live in main (`file:export`).
 */
import { formatCellValue } from "@mady/core";
import type { CellValue, DataTable, NamedTable } from "@mady/core";

/**
 * Render a DataTable as a standalone HTML `<table>` for printing — the datasheet counterpart to
 * `serializeGraphSvg`/`composeFigureSvg`. Cells use each column's display formatting
 * (`formatCellValue`, so dates/decimals read as on screen); the table name becomes a caption.
 * The print wrapper (main process) adds page + table CSS, so this is just the semantic markup.
 */
export function tableToPrintHtml(table: DataTable): string {
  const head = table.columns.map((c) => `<th>${escapeHtml(c.name)}</th>`).join("");
  const body = table.rows
    .map(
      (row) =>
        `<tr>${table.columns.map((col) => `<td>${escapeHtml(formatCellValue(row.cells[col.id] ?? null, col))}</td>`).join("")}</tr>`,
    )
    .join("");
  return `<h2 class="print-title">${escapeHtml(table.name)}</h2><table class="print-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

/** Quote a CSV field per RFC-4180 (only when it must be). */
function csvField(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Flatten a `DataTable` (cells keyed by column id) into a positional
 * `{ columnNames, rows }` grid — the shape `@mady/core`'s reshape + import
 * helpers speak. Missing cells become null.
 */
export function tableToGrid(table: DataTable): NamedTable {
  const columnNames = table.columns.map((c) => c.name);
  const rows: CellValue[][] = table.rows.map((row) =>
    table.columns.map((col) => row.cells[col.id] ?? null),
  );
  return { columnNames, rows };
}

/**
 * Serialize a DataTable to CSV: header = column names, one row per data row.
 *
 * Design decision: a leading =,+,-,@ is deliberately not neutralised
 * (the CSV-injection convention of prefixing a `'`). MadY is a single-user desktop app
 * with no privilege boundary, and mangling the value would corrupt round-trips back into
 * pandas / R — the actual audience for a CSV export. The cell is written verbatim; a
 * spreadsheet that chooses to evaluate a leading `=` on open is doing so under the user's
 * own account with their own data. The xlsx export writes the same cell as literal text
 * (see excel.ts buildWorkbook), so the two exports agree: both preserve the value, neither
 * injects a formula on MadY's side.
 */
export function tableToCsv(table: DataTable): string {
  const header = table.columns.map((c) => csvField(c.name)).join(",");
  const lines = table.rows.map((row) =>
    table.columns
      .map((col) => {
        const v = row.cells[col.id];
        return v == null ? "" : csvField(String(v));
      })
      .join(","),
  );
  return [header, ...lines].join("\r\n");
}

/** Which theme's palette an export should bake in. */
type ExportTheme = "light" | "dark";

/**
 * Is this export page colour dark? Resolved through the browser so any CSS colour
 * works ("white", "#0b1020", "rgb(…)"), not just hex. Uses the sRGB relative-luminance
 * cut at 0.5 — the same split the figure-backdrop legibility floor uses.
 */
function isDarkBackground(css: string): boolean {
  const probe = document.createElement("span");
  probe.style.display = "none";
  probe.style.color = css;
  document.body.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();
  const m = /rgba?\(([^)]+)\)/.exec(resolved);
  if (!m) return false;
  const [r = 0, g = 0, b = 0] = m[1]!.split(",").map((n) => parseFloat(n) / 255);
  const lin = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) < 0.5;
}

/**
 * The theme whose palette an export should use — chosen from the export page, not the
 * screen. `var(--ink)` means "ink that reads on screen"; baking the live theme's value
 * would export near-white text onto a white page whenever the app is in dark mode (and
 * near-black text onto a dark page swatch when it is not). Transparent has no known
 * destination, so it takes the light palette — the overwhelmingly common case for a
 * figure dropped into a manuscript or slide.
 */
export function exportThemeFor(background: ExportBackground): ExportTheme {
  const fill = exportBgColor(background);
  return fill && isDarkBackground(fill) ? "dark" : "light";
}

/**
 * Resolve `var(--name[, fallback])` to concrete colours for export.
 *
 * The palette is read under `theme` rather than whatever the app is currently showing:
 * the root's `data-theme` is switched, the needed properties are read, and it is restored
 * — all synchronously in one task, so the UI never paints an intermediate state.
 */
function resolveCssVars(raw: string, theme: ExportTheme = "light"): string {
  const names = new Set<string>();
  for (const m of raw.matchAll(/var\((--[\w-]+)/g)) names.add(m[1]!);
  const root = document.documentElement;
  const prev = root.dataset.theme;
  const map = new Map<string, string>();
  try {
    root.dataset.theme = theme;
    const cs = getComputedStyle(root);
    for (const n of names) map.set(n, cs.getPropertyValue(n).trim());
  } finally {
    if (prev === undefined) delete root.dataset.theme;
    else root.dataset.theme = prev;
  }
  return raw.replace(/var\((--[\w-]+)(?:,([^)]*))?\)/g, (_m, name: string, fallback?: string) => {
    const value = map.get(name) ?? "";
    return value || (fallback ? fallback.trim() : "#000");
  });
}

export interface SerializedSvg {
  svg: string;
  width: number;
  height: number;
}

/** Background for raster/PDF/SVG export: the literal "transparent" (no fill), or
 *  any CSS colour string — "white" / "#ffffff" / "#1a1a2e" / etc. */
export type ExportBackground = string;

/** A composed-figure panel letter (A/B/C) with its resolved typography, and its on-screen
 *  offset from the graph's top-left (ox/oy, in the graph's viewBox units) so the export
 *  reproduces exactly where the user dragged the label. */
export interface PanelLetter {
  text: string;
  family: string;
  size: number;
  weight: string;
  color: string;
  ox?: number;
  oy?: number;
}

/** The fill colour for an export background, or null when transparent. */
export function exportBgColor(bg: ExportBackground): string | null {
  if (bg === "transparent") return null;
  if (bg === "white") return "#ffffff";
  return bg;
}

export interface SerializeOpts {
  /** Pixel scale relative to the viewBox (DPI/96). Default 1. */
  scale?: number;
  /** White page vs transparent. Default "white". */
  background?: ExportBackground;
  /** Uniform padding around the figure, in scene (viewBox) px. Default 0. */
  margin?: number;
}

/** Interactive/selection chrome that must never reach a standalone export: resize
 *  handles + drag/snap guides, and the grips of a selected annotation (its delete cross
 *  and its resize / endpoint handles). In-app these are CSS-hidden until hover, but their
 *  CSS rule doesn't travel with a detached SVG, so they'd render as stray accent marks.
 *
 *  The annotation grips matter more than they look: an object is selected the instant it
 *  is created, so "export right after adding a significance marker" — the ordinary flow —
 *  would otherwise bake its delete cross straight into the figure. */
const EXPORT_CHROME_SELECTOR = ".gfx-figresize, .gfx-snapguides, .gfx-anndelete, .gfx-annhandle, .gfx-draghit";

/** Remove export-only chrome from a cloned SVG before serializing. Shared by both the
 *  single-graph (serializeGraphSvg) and figure (composeFigureSvg) export paths. */
function stripExportChrome(clone: Element): void {
  clone.querySelectorAll(EXPORT_CHROME_SELECTOR).forEach((el) => el.remove());
}

/** The app's text font, as the page gives it (`body` in shell.css). */
const SCREEN_FONT_STACK = `ui-sans-serif, system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;

/**
 * Name, on an exported SVG's root, the font its text is drawn in on screen.
 *
 * Text without a font of its own inherits the page's font in the app; a file has no page around
 * it, so that text would fall back to the viewer's default serif. Text and groups that set their
 * own font keep it, since an inner font overrides the root's.
 */
function keepScreenFont(clone: Element): void {
  if (!clone.getAttribute("font-family")) clone.setAttribute("font-family", SCREEN_FONT_STACK);
}

/**
 * Serialize a live `<svg>` to a standalone, export-clean string: clone it, set
 * concrete `width`/`height` (from the viewBox, optionally scaled), add the SVG
 * namespace, inline the theme's CSS variables, and (optionally) a uniform margin
 * + an opaque white backing rect so it renders correctly outside the app.
 */
/**
 * The real drawn bounds of a figure: its declared viewBox unioned with `getBBox()`.
 *
 * The viewBox is [0,0,w,h], but legends, axis titles, value labels and Δ% labels are
 * routinely drawn outside it — so the viewBox alone crops them. Shared by the single-graph
 * and composed-figure paths; sizing from the viewBox alone and nesting each panel in a
 * clipping `<svg>` would silently drop exactly that content.
 */
function contentBounds(svg: SVGSVGElement): { x: number; y: number; w: number; h: number } {
  // A figure the graph view has grown to its drawing (`growFigureToDrawing`) records its own
  // size; measuring from that — not from the grown viewBox — lets the export shrink back too.
  const bw = Number(svg.getAttribute("data-figure-w"));
  const bh = Number(svg.getAttribute("data-figure-h"));
  if (bw > 0 && bh > 0) return drawnBounds(svg, { x: 0, y: 0, w: bw, h: bh });
  const vb = svg.viewBox.baseVal;
  return drawnBounds(svg, { x: vb.x || 0, y: vb.y || 0, w: vb.width || svg.clientWidth, h: vb.height || svg.clientHeight });
}

/**
 * The figure's box unioned with everything drawn in it — the one measurement both the export and
 * the on-screen growth use, so what the graph view shows is what the file contains.
 *
 * Interaction chrome (resize grips, invisible click targets, snap guides, selection handles) is
 * hidden while measuring: it is never exported, and a click target's estimated width reaching
 * past the edge would otherwise grow a figure that draws nothing there.
 */
export function drawnBounds(
  svg: SVGSVGElement,
  base: { x: number; y: number; w: number; h: number },
): { x: number; y: number; w: number; h: number } {
  let minX = base.x;
  let minY = base.y;
  let maxX = base.x + base.w;
  let maxY = base.y + base.h;
  const chrome = [...svg.querySelectorAll<SVGElement>(EXPORT_CHROME_SELECTOR)];
  const saved = chrome.map((el) => el.style.display);
  chrome.forEach((el) => { el.style.display = "none"; });
  try {
    const bb = svg.getBBox();
    if (bb && bb.width > 0 && bb.height > 0) {
      // A 1px safety bleed so anti-aliased strokes/text aren't shaved.
      minX = Math.min(minX, Math.floor(bb.x - 1));
      minY = Math.min(minY, Math.floor(bb.y - 1));
      maxX = Math.max(maxX, Math.ceil(bb.x + bb.width + 1));
      maxY = Math.max(maxY, Math.ceil(bb.y + bb.height + 1));
    }
  } catch {
    // getBBox throws if the element isn't rendered — fall back to the base box.
  } finally {
    chrome.forEach((el, i) => { el.style.display = saved[i]!; });
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function serializeGraphSvg(svg: SVGSVGElement, opts: SerializeOpts = {}): SerializedSvg {
  const { scale = 1, background = "white", margin = 0 } = opts;
  const b = contentBounds(svg);
  const m = Math.max(0, margin);
  const contentW = b.w;
  const contentH = b.h;
  const ox = b.x - m;
  const oy = b.y - m;
  const fullW = contentW + 2 * m;
  const fullH = contentH + 2 * m;
  const width = Math.round(fullW * scale);
  const height = Math.round(fullH * scale);
  const clone = svg.cloneNode(true) as SVGSVGElement;
  stripExportChrome(clone); // single-graph exports must be as chrome-free as figure exports
  keepScreenFont(clone);
  clone.setAttribute("viewBox", `${ox} ${oy} ${fullW} ${fullH}`);
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const bgFill = exportBgColor(background);
  if (bgFill) {
    const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    bg.setAttribute("x", String(ox));
    bg.setAttribute("y", String(oy));
    bg.setAttribute("width", String(fullW));
    bg.setAttribute("height", String(fullH));
    bg.setAttribute("fill", bgFill);
    clone.insertBefore(bg, clone.firstChild);
  }
  const raw = resolveCssVars(new XMLSerializer().serializeToString(clone), exportThemeFor(background));
  return { svg: raw, width, height };
}

/**
 * Compose several live panel `<svg>`s into one standalone figure SVG — the
 * multi-panel figure assembler's export. Panels pack into a `cols`-wide grid
 * (column widths / row heights sized to the largest panel in each), each nested
 * as a positioned `<svg>` with an auto A/B/C letter above it. CSS vars inlined +
 * an optional white backing rect, so it renders correctly outside the app.
 */
export function composeFigureSvg(
  panels: SVGSVGElement[],
  opts: {
    background?: ExportBackground;
    margin?: number;
    gap?: number;
    cols?: number;
    /** Free-drag positions (canvas-local top-left px per panel); when given, panels are
     *  placed at these instead of the auto-grid (so an exported figure matches the layout). */
    places?: Array<{ x: number; y: number }>;
    /** Per-panel A/B/C letter text + typography (read from the live layout). null = no
     *  letter for that panel. When omitted entirely, falls back to default A/B/C @ 15px. */
    letters?: Array<PanelLetter | null>;
    /** The figure-annotation overlay (`.layannot` — text/arrows/shapes drawn on the canvas):
     *  a canvas-spanning svg whose content sits at canvas px, plus its
     *  canvas-local origin. Painted on top of the panels, through the same normalisation, and
     *  its ink grows the page so an arrow past the last panel is never clipped away. Only
     *  meaningful with `places` (the canvas coordinate space); ignored in the auto-grid. */
    overlay?: { svg: SVGSVGElement; x: number; y: number };
    /** The figure's page (canvas px, top-left at the canvas origin). With `places`, the export is
     *  the page plus `margin`: panels keep their place on the page instead of hugging the top-left.
     *  Content past the page's edge grows the export rather than being cut. */
    page?: { w: number; h: number };
  } = {},
): SerializedSvg | null {
  if (panels.length === 0) return null;
  const { background = "white", margin = 12, gap = 16 } = opts;
  // The letter band above each panel: tall enough for the largest custom label, or 0
  // when no panel carries a letter (lettering "none"). Default (no letters opt) = 22.
  const customLetters = opts.letters && opts.letters.length === panels.length ? opts.letters : null;
  // Offset mode: every label carries its on-screen offset from its graph (ox/oy) → draw it
  // exactly there (no reserved band). Otherwise a band is reserved above each panel for its letter.
  const useOffsets = !!customLetters && customLetters.some((l) => l != null && l.ox != null && l.oy != null);
  const maxLetterSize = customLetters ? Math.max(0, ...customLetters.map((l) => l?.size ?? 0)) : 15;
  const letterH = useOffsets ? 0 : customLetters ? (maxLetterSize > 0 ? Math.round(maxLetterSize * 1.4) + 4 : 0) : 22;
  // Each panel's real drawn bounds, not just its viewBox — a legend or value label drawn
  // outside the box must be laid out for, and painted, exactly as the single-graph export does.
  const bounds = panels.map((s) => {
    const b = contentBounds(s);
    return { x: b.x, y: b.y, w: b.w || 380, h: b.h || 260 };
  });
  // Per-panel render scale: a "Keep proportions" miniature declares width = viewBox·k
  // (PlotFigure's zoom). Panels are placed by their on-screen rects, so each must also be
  // drawn at its rendered size — composing at full viewBox size overlaps the export. A
  // panel with no width attribute (standalone graph, test fixtures) renders 1:1.
  const renderK = panels.map((s) => {
    const vbW = s.viewBox.baseVal.width;
    const aw = Number(s.getAttribute("width"));
    return vbW > 0 && Number.isFinite(aw) && aw > 0 ? aw / vbW : 1;
  });
  const sz = bounds.map((b, i) => ({ w: b.w * renderK[i]!, h: b.h * renderK[i]! }));
  // Per-panel top-left of the letter (the svg sits letterH below). Either free-drag
  // positions (normalised so the figure hugs the top-left) or the computed grid.
  let coords: Array<{ x: number; y: number }>;
  let totalW: number;
  let totalH: number;
  const free = opts.places && opts.places.length === panels.length ? opts.places : null;
  // The overlay's ink box in canvas coordinates (getBBox; viewBox when unrendered). It joins
  // the normalisation like a panel would, so objects outside the panels' box grow the page.
  const ov = free && opts.overlay ? opts.overlay : null;
  const ovInk = ov
    ? (() => {
        let b: { x: number; y: number; width: number; height: number } | null = null;
        try {
          const bb = typeof ov.svg.getBBox === "function" ? ov.svg.getBBox() : null;
          if (bb && bb.width > 0 && bb.height > 0) b = bb;
        } catch { /* unrendered → viewBox fallback below */ }
        const vb = ov.svg.viewBox.baseVal;
        const r = b ?? { x: 0, y: 0, width: vb.width, height: vb.height };
        // The same 1px anti-aliasing bleed contentBounds applies.
        return { x: ov.x + r.x - 1, y: ov.y + r.y - 1, w: r.width + 2, h: r.height + 2 };
      })()
    : null;
  let ovPos: { x: number; y: number } | null = null;
  // Where the canvas origin lands in the output (free placement only) — the page anchors to it.
  let origin = { x: 0, y: 0 };
  if (free) {
    const minX = Math.min(...free.map((p) => p.x), ...(ovInk ? [ovInk.x] : []));
    const minY = Math.min(...free.map((p) => p.y), ...(ovInk ? [ovInk.y] : []));
    origin = { x: margin - minX, y: margin - minY };
    coords = free.map((p) => ({ x: margin + p.x - minX, y: margin + p.y - minY }));
    if (ov) ovPos = { x: margin + ov.x - minX, y: margin + ov.y - minY };
    totalW = margin * 2 + Math.max(
      ...coords.map((c, i) => c.x - margin + sz[i]!.w),
      ...(ovInk ? [ovInk.x - minX + ovInk.w] : []),
    );
    totalH = margin * 2 + Math.max(
      ...coords.map((c, i) => c.y - margin + letterH + sz[i]!.h),
      ...(ovInk ? [ovInk.y - minY + letterH + ovInk.h] : []),
    );
  } else {
    const cols = opts.cols ?? (panels.length <= 1 ? 1 : 2);
    const rows = Math.ceil(panels.length / cols);
    const colW = new Array<number>(cols).fill(0);
    const rowH = new Array<number>(rows).fill(0);
    sz.forEach((s, i) => {
      const c = i % cols;
      const r = Math.floor(i / cols);
      colW[c] = Math.max(colW[c]!, s.w);
      rowH[r] = Math.max(rowH[r]!, s.h);
    });
    const colX: number[] = [];
    let acc = margin;
    for (let c = 0; c < cols; c++) { colX[c] = acc; acc += colW[c]! + gap; }
    const rowY: number[] = [];
    acc = margin;
    for (let r = 0; r < rows; r++) { rowY[r] = acc; acc += letterH + rowH[r]! + gap; }
    coords = panels.map((_, i) => ({ x: colX[i % cols]!, y: rowY[Math.floor(i / cols)]! }));
    totalW = margin * 2 + colW.reduce((a, b) => a + b, 0) + (cols - 1) * gap;
    totalH = margin * 2 + rowH.reduce((a, b) => a + b, 0) + rows * letterH + (rows - 1) * gap;
  }
  const letter = (i: number): string => String.fromCharCode(65 + i);
  // Offset mode: labels sit at ox/oy from their graph and may fall outside the panel — grow
  // the composed canvas (and shift everything) so each label is fully included, just like
  // the on-screen canvas does.
  if (useOffsets) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const acc = (ax: number, ay: number, aw: number, ah: number): void => {
      minX = Math.min(minX, ax); minY = Math.min(minY, ay); maxX = Math.max(maxX, ax + aw); maxY = Math.max(maxY, ay + ah);
    };
    panels.forEach((_, i) => acc(coords[i]!.x, coords[i]!.y, sz[i]!.w, sz[i]!.h));
    panels.forEach((_, i) => {
      const L = customLetters![i];
      if (L && L.text && L.ox != null && L.oy != null) acc(coords[i]!.x + L.ox, coords[i]!.y + L.oy, L.size * 1.3, L.size * 1.2);
    });
    if (ov && ovPos && ovInk) acc(ovPos.x + (ovInk.x - ov.x), ovPos.y + (ovInk.y - ov.y), ovInk.w, ovInk.h);
    const shiftX = margin - minX, shiftY = margin - minY;
    coords = coords.map((c) => ({ x: c.x + shiftX, y: c.y + shiftY }));
    if (ovPos) ovPos = { x: ovPos.x + shiftX, y: ovPos.y + shiftY };
    origin = { x: origin.x + shiftX, y: origin.y + shiftY };
    totalW = (maxX - minX) + margin * 2;
    totalH = (maxY - minY) + margin * 2;
  }
  // The page: widen the content box (in canvas px) to at least the page, then re-anchor so the
  // canvas origin — the page's top-left — sits at the margin. Content inside the page keeps its
  // exact place on it; content outside grows the export (never cut).
  if (free && opts.page) {
    const cMinX = margin - origin.x, cMaxX = totalW - margin - origin.x;
    const cMinY = margin - origin.y, cMaxY = totalH - margin - origin.y;
    const L = Math.min(0, cMinX), T = Math.min(0, cMinY);
    const dx = margin - L - origin.x, dy = margin - T - origin.y;
    coords = coords.map((c) => ({ x: c.x + dx, y: c.y + dy }));
    if (ovPos) ovPos = { x: ovPos.x + dx, y: ovPos.y + dy };
    totalW = Math.max(opts.page.w, cMaxX) - L + margin * 2;
    totalH = Math.max(opts.page.h, cMaxY) - T + margin * 2;
  }
  const parts: string[] = [];
  const composeBg = exportBgColor(background);
  if (composeBg) parts.push(`<rect x="0" y="0" width="${totalW}" height="${totalH}" fill="${composeBg}"/>`);
  panels.forEach((s, i) => {
    const { x, y } = coords[i]!;
    const clone = s.cloneNode(true) as SVGSVGElement;
    clone.removeAttribute("class");
    stripExportChrome(clone);
    clone.setAttribute("x", String(x));
    clone.setAttribute("y", String(y + letterH));
    clone.setAttribute("width", String(sz[i]!.w));
    clone.setAttribute("height", String(sz[i]!.h));
    // Widen the panel's own viewBox to its real content bounds, so anything drawn outside
    // the declared box lands inside this nested viewport instead of being clipped away by it.
    const b = bounds[i]!;
    clone.setAttribute("viewBox", `${b.x} ${b.y} ${b.w} ${b.h}`);
    clone.setAttribute("overflow", "visible");
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    keepScreenFont(clone);
    // The A/B/C label: per-panel typography from the live layout, else the default.
    const L = customLetters ? customLetters[i] : { text: letter(i), family: "system-ui, sans-serif", size: 15, weight: "700", color: "#1a1a1a", ox: undefined, oy: undefined };
    if (L && L.text) {
      const fam = escapeHtml(L.family);
      // Offset mode: glyph at (svg top-left + ox/oy), baseline ≈ +0.8·size. Otherwise in the band above the panel.
      const lx = useOffsets && L.ox != null ? x + L.ox : x;
      const ly = useOffsets && L.oy != null ? y + L.oy + L.size * 0.8 : y + L.size;
      parts.push(`<text x="${lx}" y="${ly}" font-family="${fam}" font-size="${L.size}" font-weight="${L.weight}" fill="${L.color}">${escapeHtml(L.text)}</text>`);
    }
    parts.push(new XMLSerializer().serializeToString(clone));
  });
  // The figure-annotation overlay paints last (objects sit on top of the panels, as on
  // screen), at the same normalised offset the panels got — its internal coordinates are
  // canvas px, so placing its origin keeps every object aligned with the panels around it.
  if (ov && ovPos) {
    const oc = ov.svg.cloneNode(true) as SVGSVGElement;
    oc.removeAttribute("class");
    stripExportChrome(oc);
    const vb = ov.svg.viewBox.baseVal;
    oc.setAttribute("x", String(ovPos.x));
    oc.setAttribute("y", String(ovPos.y + letterH));
    oc.setAttribute("width", String(vb.width || 1));
    oc.setAttribute("height", String(vb.height || 1));
    oc.setAttribute("overflow", "visible");
    oc.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    parts.push(new XMLSerializer().serializeToString(oc));
  }
  const svg = resolveCssVars(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}">${parts.join("")}</svg>`,
    exportThemeFor(background),
  );
  return { svg, width: totalW, height: totalH };
}

/** MIME type for an export format (browser-download fallback). */
function mimeOf(format: string): string {
  switch (format) {
    case "png": return "image/png";
    case "jpg": return "image/jpeg";
    case "tiff": return "image/tiff";
    case "svg": return "image/svg+xml";
    case "html": return "text/html";
    case "json": return "application/json";
    case "csv": return "text/csv";
    default: return "text/plain";
  }
}

/**
 * Save an export payload via a browser download (used when the Electron file
 * writer isn't available — the web build / live preview). Handles text and
 * base64 formats; PDF/XLSX need the desktop app (returns false so the caller can
 * surface that). Returns true when a download was triggered.
 */
export function browserDownload(payload: { format: string; suggestedName?: string; text?: string; base64?: string }): boolean {
  let blob: Blob | null = null;
  if (payload.base64 != null) {
    const bin = atob(payload.base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    blob = new Blob([bytes], { type: mimeOf(payload.format) });
  } else if (payload.text != null) {
    blob = new Blob([payload.text], { type: mimeOf(payload.format) });
  }
  if (!blob) return false; // pdf (svg→pdf) / xlsx are rendered in the main process only
  const name = `${(payload.suggestedName ?? "export").replace(/[^\w.-]+/g, "_") || "export"}.${payload.format}`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

/** Escape text for safe inclusion in an HTML attribute / element. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Wrap a standalone SVG string in a minimal self-contained HTML document — opens in
 *  any browser, stays crisp at any zoom (vector), needs no external files. */
export function htmlWrap(svg: string, title: string, background: ExportBackground = "transparent"): string {
  const bg = background && background !== "transparent" ? `background:${background};` : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  html, body { margin: 0; padding: 16px; box-sizing: border-box; ${bg} }
  body { display: flex; align-items: center; justify-content: center; min-height: 100vh; }
  svg { max-width: 100%; height: auto; }
</style>
</head>
<body>
${svg}
</body>
</html>
`;
}

/** `<title>` text that is an in-app editing hint, meaningless (and misleading) in an
 *  exported file — the interactive export strips these so they never become tooltips. */
const DRAG_HINT_TITLE = /<title>[^<]*\b(?:[Dd]rag (?:to|its edges)|double-click)\b[^<]*<\/title>/g;

/**
 * The interactive runtime — plain ES5-ish JS with no dependencies, inlined into the
 * exported page. It upgrades the static SVG into a viewable interactive figure:
 *   • tooltips   — each mark's `<title>` becomes a styled floating tooltip (the native
 *                  one is suppressed by moving the text to a data attribute).
 *   • zoom / pan — wheel zooms about the cursor, drag pans, double-click resets — all by
 *                  rewriting the root `<svg>` viewBox, so it works for every chart kind.
 *   • toggle     — clicking a legend row hides/shows that series (marks + legend share a
 *                  `data-mady-series` key). No-ops gracefully where a kind isn't tagged.
 * Kept as a string constant so it can be unit-tested and inlined verbatim.
 */
const INTERACTIVE_RUNTIME = `(function(){
  var svg = document.querySelector('svg.mady-fig'); if(!svg) return;
  var vb = svg.getAttribute('viewBox'); if(!vb) return;
  var home = vb.split(/\\s+/).map(Number);           // [minX,minY,w,h] — the reset target
  var view = home.slice();
  function apply(){ svg.setAttribute('viewBox', view.join(' ')); }

  // --- tooltips: hoist every <title> to data-mady-tip and remove it (kills the native tip) ---
  var tip = document.createElement('div'); tip.className='mady-tip'; tip.style.display='none';
  document.body.appendChild(tip);
  var titles = svg.querySelectorAll('title');
  for(var i=0;i<titles.length;i++){
    var t=titles[i], p=t.parentNode, txt=t.textContent||'';
    if(p) p.setAttribute('data-mady-tip', txt);
    if(p) p.removeChild(t);
  }
  svg.addEventListener('mousemove', function(e){
    var el=e.target, tt=null;
    while(el && el!==svg){ if(el.getAttribute && el.getAttribute('data-mady-tip')){ tt=el.getAttribute('data-mady-tip'); break; } el=el.parentNode; }
    if(tt){ tip.textContent=tt; tip.style.display='block';
      tip.style.left=(e.clientX+12)+'px'; tip.style.top=(e.clientY+12)+'px'; }
    else tip.style.display='none';
  });
  svg.addEventListener('mouseleave', function(){ tip.style.display='none'; });

  // --- zoom about the cursor / pan / reset (viewBox math, kind-agnostic) ---
  function clientToView(e){
    var r=svg.getBoundingClientRect();
    // If the figure has no laid-out size yet, anchor to the view centre rather than
    // dividing by zero (which would poison the viewBox with NaN).
    if(!r.width || !r.height) return [ view[0]+view[2]/2, view[1]+view[3]/2 ];
    return [ view[0] + (e.clientX-r.left)/r.width*view[2],
             view[1] + (e.clientY-r.top)/r.height*view[3] ];
  }
  svg.addEventListener('wheel', function(e){
    e.preventDefault();
    var p=clientToView(e), k=e.deltaY<0?0.85:1/0.85;
    var nw=view[2]*k, nh=view[3]*k;
    // clamp: never zoom past 40x in or below the home frame
    if(nw < home[2]/40 || nw > home[2]*4) return;
    view[0]=p[0]-(p[0]-view[0])*k; view[1]=p[1]-(p[1]-view[1])*k; view[2]=nw; view[3]=nh; apply();
  }, {passive:false});
  var pan=null;
  svg.addEventListener('mousedown', function(e){ if(e.target.closest && e.target.closest('[data-mady-series]')) return; pan={x:e.clientX,y:e.clientY,v:view.slice()}; });
  window.addEventListener('mousemove', function(e){
    if(!pan) return; var r=svg.getBoundingClientRect();
    if(!r.width||!r.height) return;
    view[0]=pan.v[0]-(e.clientX-pan.x)/r.width*view[2];
    view[1]=pan.v[1]-(e.clientY-pan.y)/r.height*view[3]; apply();
  });
  window.addEventListener('mouseup', function(){ pan=null; });
  svg.addEventListener('dblclick', function(){ view=home.slice(); apply(); });

  // --- legend-click series toggle ---
  var hidden={};
  function setSeries(id,on){
    var nodes=svg.querySelectorAll('[data-mady-series="'+id+'"]');
    for(var i=0;i<nodes.length;i++){
      var n=nodes[i], isLegend=n.getAttribute('data-mady-legend')!=null;
      if(isLegend) n.style.opacity=on?'1':'0.35';
      else n.style.display=on?'':'none';
    }
  }
  var rows=svg.querySelectorAll('[data-mady-legend]');
  for(var j=0;j<rows.length;j++){
    (function(row){
      row.style.cursor='pointer';
      row.addEventListener('click', function(e){
        var id=row.getAttribute('data-mady-series'); if(!id) return;
        e.stopPropagation(); hidden[id]=!hidden[id]; setSeries(id,!hidden[id]);
      });
    })(rows[j]);
  }
})();`;

/**
 * Interactive HTML export: the figure as a self-contained page a reader can hover,
 * zoom, pan, and toggle — no server, no build, no external files (it is opened
 * straight off disk, so there is no CSP to satisfy). The static `htmlWrap` embeds an
 * inert vector snapshot; this adds `INTERACTIVE_RUNTIME` and a class + hint bar, and
 * strips the in-app "drag to…" `<title>` hints so they don't leak in as tooltips.
 */
export function interactiveHtmlWrap(
  svg: string,
  title: string,
  background: ExportBackground = "transparent",
  opts: { hoverValues?: boolean | undefined } = {},
): string {
  const bg = background && background !== "transparent" ? `background:${background};` : "";
  // Hover values off: remove every hover text the figure carries — the marks' data-mady-tip and any
  // <title> (which the page would otherwise turn into a tooltip, and a browser shows natively) —
  // and mark the root so the choice is visible in the file. Zoom, pan and the legend stay.
  const hover = opts.hoverValues !== false;
  const source = hover ? svg : svg.replace(/\sdata-mady-tip="[^"]*"/g, "").replace(/<title>[^<]*<\/title>/g, "");
  // Tag the root <svg> so the runtime can find it (the live figure already carries
  // class="gfx-figure", so append rather than add a second class attribute), and drop
  // the editing-hint titles. String.replace hits only the first <svg> — the root — so
  // nested panel svgs in a figure export are left alone.
  const tagged = source.replace(DRAG_HINT_TITLE, "").replace(/<svg\b[^>]*>/, (tag) => {
    const classed = /\sclass\s*=\s*"/.test(tag)
      ? tag.replace(/(\sclass\s*=\s*")([^"]*)"/, '$1$2 mady-fig"')
      : tag.replace(/<svg\b/, '<svg class="mady-fig"');
    return hover ? classed : classed.replace(/<svg\b/, '<svg data-mady-hover="off"');
  });
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  html, body { margin: 0; padding: 16px; box-sizing: border-box; ${bg} }
  body { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
  svg.mady-fig { max-width: 100%; height: auto; touch-action: none; }
  .mady-tip { position: fixed; z-index: 10; pointer-events: none; background: rgba(20,22,28,0.94); color: #fff;
    font: 12px/1.4 system-ui, sans-serif; padding: 5px 8px; border-radius: 5px; max-width: 320px;
    white-space: pre-line; box-shadow: 0 2px 10px rgba(0,0,0,0.3); }
  .mady-hint { margin-top: 10px; font: 11px system-ui, sans-serif; color: #888; user-select: none; }
</style>
</head>
<body>
${tagged}
<div class="mady-hint">scroll to zoom · drag to pan · double-click to reset · click a legend entry to toggle its series</div>
<script>${INTERACTIVE_RUNTIME}</script>
</body>
</html>
`;
}

/** Decode a serialized SVG string into a loaded `<img>` at the given pixel size. */
async function loadSvgImage(svgString: string, width: number, height: number): Promise<HTMLImageElement> {
  // A `data:` URI (not `blob:`) so the app's CSP `img-src 'self' data:` allows it.
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgString)}`;
  const img = new Image();
  img.width = width;
  img.height = height;
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("SVG rasterization failed"));
    img.src = url;
  });
  return img;
}

/** Draw a serialized SVG to an off-screen canvas (optionally white-filled first). */
async function rasterize(
  svgString: string,
  width: number,
  height: number,
  background: ExportBackground,
): Promise<HTMLCanvasElement> {
  const img = await loadSvgImage(svgString, width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2D context unavailable");
  const fill = exportBgColor(background);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.drawImage(img, 0, 0, width, height);
  return canvas;
}

/**
 * Rasterize a serialized SVG to a PNG (base64, no data-URI prefix) at an explicit
 * pixel size. A transparent background keeps the alpha channel.
 */
export async function svgToPngBase64(
  svgString: string,
  width: number,
  height: number,
  background: ExportBackground = "white",
): Promise<string> {
  const canvas = await rasterize(svgString, width, height, background);
  return canvas.toDataURL("image/png").split(",")[1] ?? "";
}

/** Rasterize a serialized SVG to a JPEG (base64) at a quality 0–1. JPEG has no alpha,
 *  so a transparent request falls back to white; any chosen background colour is honoured. */
export async function svgToJpegBase64(
  svgString: string,
  width: number,
  height: number,
  quality = 0.92,
  background: ExportBackground = "white",
): Promise<string> {
  const bg = background === "transparent" ? "white" : background;
  const canvas = await rasterize(svgString, width, height, bg);
  return canvas.toDataURL("image/jpeg", quality).split(",")[1] ?? "";
}

/** Rasterize a serialized SVG to a baseline (uncompressed) TIFF (base64) at the given size. */
export async function svgToTiffBase64(
  svgString: string,
  width: number,
  height: number,
  background: ExportBackground = "white",
  dpi = 300,
): Promise<string> {
  const canvas = await rasterize(svgString, width, height, background);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2D context unavailable");
  const { data } = ctx.getImageData(0, 0, width, height);
  return bytesToBase64(encodeTiffRgb(width, height, data, dpi));
}

/** Rasterize a serialized SVG to a CMYK TIFF (base64) for print/journal submission. */
export async function svgToCmykTiffBase64(
  svgString: string,
  width: number,
  height: number,
  background: ExportBackground = "white",
  dpi = 300,
): Promise<string> {
  const canvas = await rasterize(svgString, width, height, background);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2D context unavailable");
  const { data } = ctx.getImageData(0, 0, width, height);
  return bytesToBase64(encodeTiffCmyk(width, height, data, dpi));
}

/**
 * Rasterize a serialized SVG to a high-resolution raster EPS (PostScript text).
 * `boxWpts`/`boxHpts` = the figure's logical size in points (scene px × 72/96); the
 * embedded raster is `width×height` px inside that box (so higher px = higher DPI).
 */
export async function svgToEpsText(
  svgString: string,
  width: number,
  height: number,
  boxWpts: number,
  boxHpts: number,
  background: ExportBackground = "white",
): Promise<string> {
  const canvas = await rasterize(svgString, width, height, background);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2D context unavailable");
  const { data } = ctx.getImageData(0, 0, width, height);
  return encodeEpsRaster(width, height, data, boxWpts, boxHpts);
}

/**
 * Encode an RGBA pixel buffer as a baseline, uncompressed little-endian RGB TIFF.
 * Layout: 8-byte header → strip data (w·h·3 bytes RGB) → IFD → external values.
 * Pure (no DOM) so it is unit-testable; alpha is composited onto white.
 */
export function encodeTiffRgb(width: number, height: number, rgba: Uint8ClampedArray | Uint8Array, dpi = 300): Uint8Array {
  const res = Math.max(1, Math.round(dpi));
  const stripLen = width * height * 3;
  const headerLen = 8;
  const tags = [256, 257, 258, 259, 262, 273, 277, 278, 279, 282, 283, 296]; // + X/YResolution (282/283)
  // TIFF 6.0 requires each IFD to begin on a word (even-byte) boundary. An odd×odd RGB
  // image has an odd strip length, so pad a filler byte before the IFD.
  // StripByteCounts stays at the true length.
  const stripPad = stripLen % 2;
  const ifdOffset = headerLen + stripLen + stripPad;
  const ifdLen = 2 + tags.length * 12 + 4;
  const externalOffset = ifdOffset + ifdLen;
  const bitsPerSampleOffset = externalOffset; // 3 SHORTs = 6 bytes
  const xResOffset = bitsPerSampleOffset + 6; // RATIONAL = 8 bytes (num, den)
  const yResOffset = xResOffset + 8; // RATIONAL = 8 bytes
  const total = yResOffset + 8;
  const buf = new ArrayBuffer(total);
  const view = new DataView(buf);
  const u8 = new Uint8Array(buf);

  // Header (little-endian).
  view.setUint8(0, 0x49);
  view.setUint8(1, 0x49); // "II"
  view.setUint16(2, 42, true);
  view.setUint32(4, ifdOffset, true);

  // Strip data: RGB, white-composited over any alpha.
  let o = headerLen;
  for (let i = 0; i < width * height; i++) {
    const a = rgba[i * 4 + 3] ?? 255;
    const af = a / 255;
    for (let c = 0; c < 3; c++) {
      const v = rgba[i * 4 + c] ?? 0;
      u8[o++] = Math.round(v * af + 255 * (1 - af));
    }
  }

  // IFD.
  let p = ifdOffset;
  view.setUint16(p, tags.length, true);
  p += 2;
  const SHORT = 3;
  const LONG = 4;
  const RATIONAL = 5;
  const entry = (tag: number, type: number, count: number, value: number): void => {
    view.setUint16(p, tag, true);
    view.setUint16(p + 2, type, true);
    view.setUint32(p + 4, count, true);
    if (type === SHORT && count === 1) view.setUint16(p + 8, value, true);
    else view.setUint32(p + 8, value, true); // LONG inline, or the external offset for RATIONAL
    p += 12;
  };
  entry(256, LONG, 1, width); // ImageWidth
  entry(257, LONG, 1, height); // ImageLength
  entry(258, SHORT, 3, bitsPerSampleOffset); // BitsPerSample → external [8,8,8]
  entry(259, SHORT, 1, 1); // Compression = none
  entry(262, SHORT, 1, 2); // Photometric = RGB
  entry(273, LONG, 1, headerLen); // StripOffsets
  entry(277, SHORT, 1, 3); // SamplesPerPixel
  entry(278, LONG, 1, height); // RowsPerStrip
  entry(279, LONG, 1, stripLen); // StripByteCounts
  entry(282, RATIONAL, 1, xResOffset); // XResolution → external RATIONAL
  entry(283, RATIONAL, 1, yResOffset); // YResolution → external RATIONAL
  entry(296, SHORT, 1, 2); // ResolutionUnit = inch
  view.setUint32(p, 0, true); // next IFD = none

  // External BitsPerSample values.
  view.setUint16(bitsPerSampleOffset, 8, true);
  view.setUint16(bitsPerSampleOffset + 2, 8, true);
  view.setUint16(bitsPerSampleOffset + 4, 8, true);
  // External X/YResolution RATIONALs: dpi/1 pixels per inch (ResolutionUnit=inch).
  view.setUint32(xResOffset, res, true);
  view.setUint32(xResOffset + 4, 1, true);
  view.setUint32(yResOffset, res, true);
  view.setUint32(yResOffset + 4, 1, true);
  return u8;
}

/**
 * Naive RGB→CMYK (no ICC colour management): K = 1 − max(r,g,b); C,M,Y =
 * (1−channel−K)/(1−K). In/out 0–255, ink amounts (0 = no ink). Good enough for a
 * print-submission CMYK TIFF without a colour-managed workflow.
 */
export function rgbToCmyk(r: number, g: number, b: number): [number, number, number, number] {
  const rf = r / 255, gf = g / 255, bf = b / 255;
  const k = 1 - Math.max(rf, gf, bf);
  if (k >= 1) return [0, 0, 0, 255]; // pure black → K only
  const c = (1 - rf - k) / (1 - k);
  const m = (1 - gf - k) / (1 - k);
  const y = (1 - bf - k) / (1 - k);
  return [Math.round(c * 255), Math.round(m * 255), Math.round(y * 255), Math.round(k * 255)];
}

/**
 * Encode an RGBA pixel buffer as a baseline, uncompressed CMYK TIFF (Photometric =
 * Separated, InkSet = CMYK) for print/journal submission. Alpha is composited onto
 * white first, then each pixel is converted to CMYK ink amounts. Same IFD structure
 * as `encodeTiffRgb` but 4 samples + the InkSet tag. Pure (no DOM) → unit-testable.
 */
export function encodeTiffCmyk(width: number, height: number, rgba: Uint8ClampedArray | Uint8Array, dpi = 300): Uint8Array {
  const res = Math.max(1, Math.round(dpi));
  const stripLen = width * height * 4;
  const headerLen = 8;
  const tags = [256, 257, 258, 259, 262, 273, 277, 278, 279, 282, 283, 296, 332]; // + X/YResolution + InkSet
  const ifdOffset = headerLen + stripLen;
  const ifdLen = 2 + tags.length * 12 + 4;
  const externalOffset = ifdOffset + ifdLen;
  const bitsPerSampleOffset = externalOffset; // 4 SHORTs = 8 bytes
  const xResOffset = bitsPerSampleOffset + 8; // RATIONAL = 8 bytes
  const yResOffset = xResOffset + 8; // RATIONAL = 8 bytes
  const total = yResOffset + 8;
  const buf = new ArrayBuffer(total);
  const view = new DataView(buf);
  const u8 = new Uint8Array(buf);

  // Header (little-endian).
  view.setUint8(0, 0x49);
  view.setUint8(1, 0x49); // "II"
  view.setUint16(2, 42, true);
  view.setUint32(4, ifdOffset, true);

  // Strip data: CMYK ink, white-composited over any alpha.
  let o = headerLen;
  for (let i = 0; i < width * height; i++) {
    const a = rgba[i * 4 + 3] ?? 255;
    const af = a / 255;
    const r = Math.round((rgba[i * 4] ?? 0) * af + 255 * (1 - af));
    const g = Math.round((rgba[i * 4 + 1] ?? 0) * af + 255 * (1 - af));
    const b = Math.round((rgba[i * 4 + 2] ?? 0) * af + 255 * (1 - af));
    const [c, m, y, k] = rgbToCmyk(r, g, b);
    u8[o++] = c; u8[o++] = m; u8[o++] = y; u8[o++] = k;
  }

  // IFD (tags ascending).
  let p = ifdOffset;
  view.setUint16(p, tags.length, true);
  p += 2;
  const SHORT = 3;
  const LONG = 4;
  const RATIONAL = 5;
  const entry = (tag: number, type: number, count: number, value: number): void => {
    view.setUint16(p, tag, true);
    view.setUint16(p + 2, type, true);
    view.setUint32(p + 4, count, true);
    if (type === SHORT && count === 1) view.setUint16(p + 8, value, true);
    else view.setUint32(p + 8, value, true); // LONG inline, or the external offset for RATIONAL
    p += 12;
  };
  entry(256, LONG, 1, width); // ImageWidth
  entry(257, LONG, 1, height); // ImageLength
  entry(258, SHORT, 4, bitsPerSampleOffset); // BitsPerSample → external [8,8,8,8]
  entry(259, SHORT, 1, 1); // Compression = none
  entry(262, SHORT, 1, 5); // Photometric = Separated (CMYK)
  entry(273, LONG, 1, headerLen); // StripOffsets
  entry(277, SHORT, 1, 4); // SamplesPerPixel
  entry(278, LONG, 1, height); // RowsPerStrip
  entry(279, LONG, 1, stripLen); // StripByteCounts
  entry(282, RATIONAL, 1, xResOffset); // XResolution → external RATIONAL
  entry(283, RATIONAL, 1, yResOffset); // YResolution → external RATIONAL
  entry(296, SHORT, 1, 2); // ResolutionUnit = inch
  entry(332, SHORT, 1, 1); // InkSet = CMYK
  view.setUint32(p, 0, true); // next IFD = none

  // External BitsPerSample values [8,8,8,8].
  view.setUint16(bitsPerSampleOffset, 8, true);
  view.setUint16(bitsPerSampleOffset + 2, 8, true);
  view.setUint16(bitsPerSampleOffset + 4, 8, true);
  view.setUint16(bitsPerSampleOffset + 6, 8, true);
  // External X/YResolution RATIONALs.
  view.setUint32(xResOffset, res, true);
  view.setUint32(xResOffset + 4, 1, true);
  view.setUint32(yResOffset, res, true);
  view.setUint32(yResOffset + 4, 1, true);
  return u8;
}

/**
 * Build an EPS (Encapsulated PostScript, Level 2) that embeds the figure as a
 * high-resolution RGB image — a full-fidelity raster EPS for journal submission
 * systems that require the .eps/PostScript format. (For scalable vector, the SVG
 * and PDF exports render every element natively; a from-scratch vector EPS would
 * mis-render our gradient/pattern/opacity fills.) `boxWpts`/`boxHpts` are the
 * figure's logical size in points (1/72"); the `imgW×imgH` pixel buffer may be a
 * higher DPI inside that box. Alpha is composited onto white. Pure → testable.
 */
export function encodeEpsRaster(
  imgW: number,
  imgH: number,
  rgba: Uint8ClampedArray | Uint8Array,
  boxWpts: number,
  boxHpts: number,
): string {
  const HEX = "0123456789abcdef";
  const out: string[] = [];
  let line = "";
  for (let i = 0; i < imgW * imgH; i++) {
    const af = (rgba[i * 4 + 3] ?? 255) / 255;
    for (let c = 0; c < 3; c++) {
      const v = Math.round((rgba[i * 4 + c] ?? 0) * af + 255 * (1 - af));
      line += HEX[(v >> 4) & 0xf]! + HEX[v & 0xf]!;
      if (line.length >= 78) { out.push(line); line = ""; }
    }
  }
  if (line) out.push(line);
  const bw = Math.round(boxWpts * 100) / 100;
  const bh = Math.round(boxHpts * 100) / 100;
  return [
    "%!PS-Adobe-3.0 EPSF-3.0",
    "%%Creator: MadY",
    `%%BoundingBox: 0 0 ${Math.ceil(bw)} ${Math.ceil(bh)}`,
    `%%HiResBoundingBox: 0 0 ${bw} ${bh}`,
    "%%LanguageLevel: 2",
    "%%Pages: 1",
    "%%EndComments",
    "%%Page: 1 1",
    "gsave",
    `${bw} ${bh} scale`,
    `/madybuf ${imgW * 3} string def`,
    `${imgW} ${imgH} 8`,
    `[${imgW} 0 0 -${imgH} 0 ${imgH}]`,
    "{ currentfile madybuf readhexstring pop }",
    "false 3 colorimage",
    ...out,
    "grestore",
    "showpage",
    "%%EOF",
    "",
  ].join("\n");
}

/** Base64-encode a byte buffer (chunked to avoid call-stack limits). */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Serialize a DataTable to a JSON string: `{ name, columns, rows: [{col: value}] }`. */
export function tableToJson(table: DataTable): string {
  const columns = table.columns.map((c) => c.name);
  const rows = table.rows.map((row) => {
    const obj: Record<string, CellValue> = {};
    for (const col of table.columns) obj[col.name] = row.cells[col.id] ?? null;
    return obj;
  });
  return JSON.stringify({ name: table.name, columns, rows }, null, 2);
}

/**
 * The export format registry — one list, read by the Export dialog and by the manual's
 * function index.
 *
 * It lives here rather than in `ExportDialog.tsx` for one reason: the index has to enumerate
 * every format a user can pick, and a second hand-written list in the manual would go stale the
 * first time a format was added. `guideIndex.test.ts` is default-deny over these keys.
 */
export type ExportFormat = "png" | "svg" | "pdf" | "tiff" | "jpg" | "html" | "eps" | "pptx" | "csv" | "xlsx" | "json";

/** The dropdown label for each format. */
export const EXPORT_FORMAT_LABEL: Record<ExportFormat, string> = {
  png: "PNG image (raster)",
  svg: "SVG (vector)",
  pdf: "PDF (vector)",
  tiff: "TIFF image (raster)",
  jpg: "JPEG image (raster)",
  html: "HTML page — interactive (hover values, zoom, pan), self-contained",
  eps: "EPS (PostScript, high-res)",
  pptx: "PowerPoint slide (.pptx)",
  csv: "CSV (data)",
  xlsx: "Excel .xlsx (data)",
  json: "JSON (data)",
};

/** Offered when a graph or a figure is in front. */
export const PLOT_EXPORT_FORMATS: ExportFormat[] = ["png", "svg", "pdf", "tiff", "jpg", "html", "eps", "pptx"];
/** Offered when a datasheet or a results table is in front. */
export const TABLE_EXPORT_FORMATS: ExportFormat[] = ["csv", "xlsx", "json"];
