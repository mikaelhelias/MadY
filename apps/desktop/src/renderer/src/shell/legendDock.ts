import { createContext } from "react";

/**
 * Lines in the legend: a line the user drew — a dashed reference line, say — or the fitted curves can be listed as a
 * legend row. Two ways in: the
 * "Show in legend" box on the line's panel, or dragging the line's caption onto the legend block, which catches it
 * once it comes within `LEGEND_DOCK_REACH`. Dragging a listed row out of the block takes it back out.
 */

/** What a legend row that keys a line points at. */
export type LegendLineTarget = { kind: "annotation"; id: string } | { kind: "fit" };

/** Put a line into the legend (`on`) or take it back out. */
export type LegendDock = (target: LegendLineTarget, on: boolean) => void;

/** How close (figure px) a dragged caption must come to the legend block for the block to catch it. */
export const LEGEND_DOCK_REACH = 24;

/** How far (figure px) a listed row must be dragged out of the block before it lets go. */
export const LEGEND_UNDOCK_REACH = 12;

export interface Box { x: number; y: number; w: number; h: number }

/**
 * The legend block's box in figure units, read off the DRAWING: its hit area (`data-legend-box`) moved by the
 * block's own drag offset (the `translate` on `.gfx-legend`). Null when no legend block is drawn.
 */
export function legendDropBox(svg: Element | null | undefined): Box | null {
  const r = svg?.querySelector("[data-legend-box]");
  if (!r) return null;
  const t = r.closest(".gfx-legend")?.getAttribute("transform") ?? "";
  const m = /translate\(\s*([-\d.eE]+)[\s,]+([-\d.eE]+)\s*\)/.exec(t);
  const n = (k: string): number => Number(r.getAttribute(k) ?? 0);
  return { x: n("x") + (m ? Number(m[1]) : 0), y: n("y") + (m ? Number(m[2]) : 0), w: n("width"), h: n("height") };
}

/** Is the point (figure units) within `reach` of the box? */
export function nearBox(box: Box | null, x: number, y: number, reach: number): boolean {
  return !!box && x >= box.x - reach && x <= box.x + box.w + reach && y >= box.y - reach && y <= box.y + box.h + reach;
}

/**
 * The middle of a caption (figure units): its anchor point, moved to the middle of the words by its text anchor, then
 * by the drag. The words' width is the renderer's usual `length × size × 0.55` estimate.
 */
export function captionCentre(
  a: { labelX?: number | undefined; labelY?: number | undefined; labelAnchor?: "start" | "middle" | "end" | undefined; label?: string | undefined },
  fontSize: number,
  dx: number,
  dy: number,
): { x: number; y: number } {
  const w = (a.label?.length ?? 0) * fontSize * 0.55;
  const shift = a.labelAnchor === "end" ? -w / 2 : a.labelAnchor === "middle" ? 0 : w / 2;
  return { x: (a.labelX ?? 0) + shift + dx, y: (a.labelY ?? 0) - fontSize * 0.35 + dy };
}

/**
 * A listed line's dash as drawn in its KEY. The key is a short stub (~16 px) and a line's dash can repeat every 15 px
 * (9 on, 6 off), which in the stub reads as ONE dash and a dot — a dash-dot key for a dashed line. So the pattern is
 * shrunk, in proportion, until at least two and a half repeats fit; it is never stretched, so a fine pattern (dotted)
 * is drawn exactly as on the plot. An odd-length dasharray repeats twice per period, as SVG draws it.
 */
export function keyDash(dash: string, stubLength: number): string {
  const parts = dash.split(/[\s,]+/).map(Number).filter((n) => Number.isFinite(n) && n >= 0);
  const period = parts.reduce((a, b) => a + b, 0) * (parts.length % 2 ? 2 : 1);
  if (!period || stubLength <= 0) return dash;
  const k = Math.min(1, stubLength / (2.5 * period));
  return k === 1 ? dash : parts.map((n) => Number((n * k).toFixed(2))).join(" ");
}

/**
 * Handed down from `PlotFigure` to every legend and caption, whichever figure family draws them. `lines` = the ids of
 * the lines the user drew (only those can be docked — a line the builder owns has no annotation to write to); `set`
 * absent = a read-only drawing (export, thumbnail). `near` = a caption is being held within reach of the block, which
 * lights the block up.
 */
export const LegendDockContext = createContext<{
  lines?: ReadonlySet<string> | undefined;
  set?: LegendDock | undefined;
  near: boolean;
  setNear: (near: boolean) => void;
  /** Loose rows: pull a row out of the block to `at` (its top-left, figure px), move it, or put it back (`null`).
   *  Absent = read-only: nothing picks or tears off. */
  onLegendLoose?: ((key: string, at: { x: number; y: number } | null) => void) | undefined;
  /** The full-order index of a loose row held within reach of the block — the slot the block opens for it. */
  looseSlot?: number | null | undefined;
  setLooseSlot?: ((index: number | null) => void) | undefined;
}>({ near: false, setNear: () => {} });
