/**
 * Real-browser inspection of drawn figures, used by `new-data-redraw.test.tsx`.
 *
 * jsdom has no fonts and no layout, so a text's size there is a guess; a clash or a cut label can only be seen where the
 * text is really set. This opens headless Chromium (the engine the app runs on), and:
 *   1. measures the app's own font (`textMeasure.ts`'s stack) glyph by glyph, so the scenes are laid out with the same
 *      widths the app's canvas measurer gives — not the 0.6 × size estimate the tests otherwise fall back to;
 *   2. loads drawn figures and reads every visible text's real box, and reports two texts that overlap and text that
 *      leaves the figure.
 * Test support only: nothing here is imported by the app.
 */
import { chromium } from "playwright";
import type { Browser, Page } from "playwright";

/** The app's text-measurement font stack (`textMeasure.ts`). */
export const APP_FONT_STACK = `ui-sans-serif, system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;

/** One problem found on one figure: two texts that clash, or a text cut by the figure's edge. */
export interface TextFinding {
  kind: "clash" | "cut";
  what: string;
}

export interface FigureInspector {
  /** Width of `text` at `px` in the app's font, from real glyph advances (unknown glyphs: the 0.6 estimate). */
  measure: (text: string, px: number) => number;
  /** Real-browser text findings for each SVG (`svg.gfx-figure` outerHTML), in order. */
  inspect: (svgs: string[], rootCss: string) => Promise<TextFinding[][]>;
  close: () => Promise<void>;
}

export async function openFigureInspector(extraChars: string): Promise<FigureInspector> {
  const browser: Browser = await chromium.launch();
  const page: Page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 1 });
  const chars = new Set<string>();
  for (let c = 32; c < 127; c++) chars.add(String.fromCharCode(c));
  for (const ch of extraChars) chars.add(ch);
  // Glyph advances per whole pixel size, measured at that size: a font with optical sizes (the macOS system
  // font) draws small text with wider glyphs than a large size scaled down would give.
  const MIN_PX = 4;
  const MAX_PX = 72;
  const adv: Record<string, number>[] = await page.evaluate(({ list, font, min, max }) => {
    const ctx = document.createElement("canvas").getContext("2d")!;
    const bySize: Record<string, number>[] = [];
    for (let px = min; px <= max; px++) {
      ctx.font = `${px}px ${font}`;
      const out: Record<string, number> = {};
      for (const ch of list) out[ch] = ctx.measureText(ch).width / px;
      bySize.push(out);
    }
    return bySize;
  }, { list: [...chars], font: APP_FONT_STACK, min: MIN_PX, max: MAX_PX });
  const measure = (text: string, px: number): number => {
    const table = adv[Math.min(MAX_PX, Math.max(MIN_PX, Math.round(px))) - MIN_PX]!;
    let w = 0;
    for (const ch of text) w += table[ch] ?? 0.6;
    return w * px;
  };
  const inspect = async (svgs: string[], rootCss: string): Promise<TextFinding[][]> => {
    const out: TextFinding[][] = [];
    // In batches, so one page never holds hundreds of figures at once.
    for (let i = 0; i < svgs.length; i += 20) {
      const batch = svgs.slice(i, i + 20);
      // The app's page font: a figure text with no font of its own inherits it (shell.css \`body\`). Without it the
      // browser's default serif would be measured, and a sans label the app draws inside would appear to leave the edge.
      await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${rootCss} body{margin:0;background:#fff;font-family:${APP_FONT_STACK}} .fig{display:block;margin:0 0 8px 0}</style></head><body>${batch.map((s) => `<div class="fig">${s}</div>`).join("")}</body></html>`);
      const res: TextFinding[][] = await page.evaluate(() => {
        const findings: { kind: "clash" | "cut"; what: string }[][] = [];
        for (const svg of Array.from(document.querySelectorAll("svg.gfx-figure")) as SVGSVGElement[]) {
          const f: { kind: "clash" | "cut"; what: string }[] = [];
          const vb = svg.viewBox.baseVal;
          const shown = (el: Element): boolean => {
            if (el.closest("defs, clipPath, pattern, .gfx-draghit, .gfx-annhandle")) return false;
            for (let e: Element | null = el; e && e !== svg; e = e.parentElement) {
              const cs = getComputedStyle(e);
              if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) return false;
            }
            const fill = getComputedStyle(el).fill;
            return !(fill === "none" || fill === "transparent" || fill === "rgba(0, 0, 0, 0)");
          };
          // Each visible text as its own rectangle — rotated with the text (a tilted label's page-aligned box covers far
          // more than its letters, so neighbouring tilted names would "overlap" there while the drawing shows them apart).
          // The box is the text's line box less an eighth of its height at top and bottom: a line box carries ascent
          // and descent air, and two labels on neighbouring lines can touch by that air without any glyph meeting.
          const toSvg = svg.getScreenCTM()!.inverse();
          const boxes = (Array.from(svg.querySelectorAll("text")) as SVGTextElement[])
            .filter((t) => (t.textContent ?? "").trim() !== "" && shown(t))
            .map((t) => {
              const bb = t.getBBox();
              const m = toSvg.multiply(t.getScreenCTM()!);
              const inset = bb.height / 8;
              const pts = [[bb.x, bb.y + inset], [bb.x + bb.width, bb.y + inset], [bb.x + bb.width, bb.y + bb.height - inset], [bb.x, bb.y + bb.height - inset]]
                .map(([x, y]) => new DOMPoint(x, y).matrixTransform(m))
                .map((p) => [p.x, p.y] as [number, number]);
              // The whole line box (no inset) for the edge check: a glyph may reach it.
              const full = [[bb.x, bb.y], [bb.x + bb.width, bb.y], [bb.x + bb.width, bb.y + bb.height], [bb.x, bb.y + bb.height]]
                .map(([x, y]) => new DOMPoint(x, y).matrixTransform(m));
              return { t: (t.textContent ?? "").trim(), pts, full, w: bb.width, h: bb.height, el: t };
            })
            .filter((b) => b.w > 0.5 && b.h > 0.5);
          // Separating axes: two convex quads overlap only if they overlap along every edge normal of both; the
          // overlap is the smallest of those, so "more than 1 px" means the letters really cross.
          const overlap = (P: [number, number][], Q: [number, number][]): number => {
            let least = Infinity;
            for (const poly of [P, Q]) {
              for (let i = 0; i < 4; i++) {
                const [x1, y1] = poly[i]!, [x2, y2] = poly[(i + 1) % 4]!;
                const len = Math.hypot(x2 - x1, y2 - y1) || 1;
                const nx = -(y2 - y1) / len, ny = (x2 - x1) / len;
                const proj = (R: [number, number][]) => R.map(([x, y]) => x * nx + y * ny);
                const a = proj(P), b = proj(Q);
                const o = Math.min(Math.max(...a), Math.max(...b)) - Math.max(Math.min(...a), Math.min(...b));
                if (o <= 0) return 0;
                least = Math.min(least, o);
              }
            }
            return least;
          };
          for (let a = 0; a < boxes.length; a++) {
            for (let b = a + 1; b < boxes.length; b++) {
              const A = boxes[a]!, B = boxes[b]!;
              if (A.el.contains(B.el) || B.el.contains(A.el)) continue;
              const o = overlap(A.pts, B.pts);
              if (o > 1) f.push({ kind: "clash", what: `"${A.t}" overlaps "${B.t}" (by ${o.toFixed(1)} px)` });
            }
          }
          for (const B of boxes) {
            const xs = B.full.map((p) => p.x), ys = B.full.map((p) => p.y);
            const out = Math.max(-Math.min(...xs), -Math.min(...ys), Math.max(...xs) - vb.width, Math.max(...ys) - vb.height);
            if (out > 1) f.push({ kind: "cut", what: `"${B.t}" runs ${out.toFixed(1)} px past the figure's edge` });
          }
          findings.push(f);
        }
        return findings;
      });
      out.push(...res);
    }
    return out;
  };
  return { measure, inspect, close: () => browser.close() };
}
