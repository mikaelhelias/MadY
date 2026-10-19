/**
 * Figure templates — save a multi-panel figure's arrangement as a
 * named, reusable house style, and stamp the next figure with it in one click.
 *
 * A lab that always ships 2-column figures with lower-case lettering in 9pt Helvetica should
 * set that up once, not rebuild it per figure. Mirrors the graph-template module next door
 * (`templates.ts`): same durable store, same save/list/delete shape, its own key + schema.
 *
 * Pure + DOM-free apart from the store → unit-testable.
 */
import type { FigureLayout } from "@mady/core";
import { dGet, dSet } from "./durableStore";

/**
 * The portable part of a layout — everything that describes the arrangement rather than
 * this particular figure's contents.
 *
 * Deliberately excluded, and why:
 *  • `panels` / `panelSource` — which graphs are in it. That is the figure, not its style.
 *  • `panelPositions` / `panelSizes` / `cardSizes` / `labelPos` / `letterText` / `panelSpan` /
 *    `panelZ` / `panelLocked` — all keyed by plot id, so they are meaningless in another
 *    figure with different panels.
 *  • `id` / `name` / `color` / `pinned` — identity and filing.
 *  • `linked` — whether panels share their source graphs is a property of this figure's
 *    relationship to its graphs, and silently unlinking someone's figure would detach and
 *    clone every panel.
 *  • `showGrid` / `showRuler` / `showPanelNames` / `guides` / `snapToGrid` — editing aids, not figure style. They never
 *    appear in the export, and a template should not reach over and turn someone's ruler off.
 */
export const FIGURE_TEMPLATE_KEYS: (keyof FigureLayout)[] = [
  "columns",
  "gutter",
  "lettering",
  "letterFont",
  "letterSize",
  "letterBold",
  "letterColor",
  "showPanelTitles",
  "panelFontScale",
  "freeform",
  "alignX",
  "alignY",
  "labelAlignX",
  "labelAlignY",
  "uniformRowHeight",
  "uniformColumnWidth",
  "stretchLastPanel",
  "centreNoAxisPanels",
  "sharedAxisLabels",
  "mergedLegend",
  "autoScale",
  "page",
];

export interface FigureTemplate {
  name: string;
  /** The captured arrangement (a partial FigureLayout). */
  layout: Partial<FigureLayout>;
}

const MAX_TEMPLATES = 8;
const KEY = "mady.figureTemplates.v1";

/**
 * Capture a layout's arrangement.
 *
 * `includeUndefined` records "this option was at its default" explicitly, so applying the
 * template resets a figure that had the option on. Without it, a template saved from a
 * plain figure could only ever turn things on, never off. Graph templates handle the same case
 * when matching (see `capturePlotStyle`).
 */
export function captureFigureTemplate(layout: FigureLayout, includeUndefined = true): Partial<FigureLayout> {
  const out: Partial<FigureLayout> = {};
  for (const k of FIGURE_TEMPLATE_KEYS) {
    const v = layout[k];
    if (v !== undefined) (out as Record<string, unknown>)[k] = JSON.parse(JSON.stringify(v));
    else if (includeUndefined) (out as Record<string, unknown>)[k] = undefined;
  }
  return out;
}

/**
 * The patch to apply for a template: every portable key, present either with the saved value
 * or as an explicit `undefined`.
 *
 * This exists because `JSON.stringify` drops undefined properties, so the "this option was at
 * its default" markers `captureFigureTemplate` records do not survive the trip through the
 * store. Rebuilding the full key set here makes the round-trip lossless by construction
 * rather than relying on the serialiser — without it a template could only ever turn options
 * ON, and applying a plain house style to a figure with alignment or shared axes switched on
 * would silently leave them on.
 */
export function figureTemplatePatch(t: FigureTemplate): Partial<FigureLayout> {
  const patch: Partial<FigureLayout> = {};
  for (const k of FIGURE_TEMPLATE_KEYS) {
    (patch as Record<string, unknown>)[k] = (t.layout as Record<string, unknown>)[k];
  }
  return patch;
}

function readAll(): FigureTemplate[] {
  try {
    const raw = dGet(KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? (list as FigureTemplate[]).filter((t) => t && typeof t.name === "string") : [];
  } catch {
    return []; // a corrupt store must not break the assembler
  }
}

function writeAll(list: FigureTemplate[]): void {
  // Mirrored to the durable userData file (see durableStore) so saved figure templates
  // survive a localStorage wipe / the dev↔packaged origin split.
  dSet(KEY, JSON.stringify(list));
}

/** Every saved figure template, most-recent first. */
export function listFigureTemplates(): FigureTemplate[] {
  return readAll();
}

/** Save (or overwrite by name) a figure template; caps at 8, dropping the oldest. */
export function saveFigureTemplate(name: string, layout: Partial<FigureLayout>): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  const others = readAll().filter((t) => t.name !== trimmed);
  writeAll([{ name: trimmed, layout }, ...others].slice(0, MAX_TEMPLATES));
}

/** Remove a named figure template. */
export function deleteFigureTemplate(name: string): void {
  writeAll(readAll().filter((t) => t.name !== name));
}
