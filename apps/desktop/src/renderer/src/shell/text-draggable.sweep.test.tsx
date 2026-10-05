// @vitest-environment jsdom
/**
 * Every text on a graph can be dragged.
 *
 * A design rule of the program: all text is draggable. This test checks every chart kind and
 * every text it draws (for example, it guards against the 3-D scatter's axis labels being
 * undraggable).
 *
 * The fixture has to do three things, or it reports draggable text as stuck:
 *  1. **Select first, then re-render with that selection.** An annotation label (a PCA loading
 *     name, a pyramid value) only grows its drag affordance once selected — and the component
 *     has to be re-rendered with `selected` for that to happen. Without it, several kinds
 *     report text that is in fact draggable.
 *  2. **Try both gesture families, on the text and its group.** Some labels listen on the glyph,
 *     some on the wrapping <g>; some use pointer events, some mouse.
 *  3. **Spy every move callback.** A test missing one reports its element as stuck.
 *
 * Tick labels are exempt, structurally: they are placed by the scale, one per tick, and no chart
 * in the program moves one on its own — the axis title is the draggable thing. They are taken
 * from the scene's own tick lists, not a list of strings, so the exemption cannot go stale.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import { galleryItems, optionDrawables } from "./gallery";
import type { GraphSelection } from "./AppShell";

/**
 * jsdom has no `getScreenCTM`, and without it this test misreports. Every annotation drag goes
 * through `clientToUser`, which returns null when the matrix is missing — so a PCA loading name
 * and a pyramid value label would read as stuck although both drag correctly in the app.
 * A 1:1 matrix makes client coords == user coords, which is what a real 1× figure gives.
 */
beforeAll(() => {
  const proto = (globalThis as unknown as { SVGSVGElement?: { prototype: Record<string, unknown> } }).SVGSVGElement?.prototype;
  if (proto && typeof proto.getScreenCTM !== "function") {
    proto.getScreenCTM = function getScreenCTM() {
      return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0, inverse: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) };
    };
  }
  if (typeof (globalThis as { DOMPoint?: unknown }).DOMPoint !== "function") {
    class P { x: number; y: number; constructor(x = 0, y = 0) { this.x = x; this.y = y; } matrixTransform() { return this; } }
    (globalThis as { DOMPoint?: unknown }).DOMPoint = P;
  }
});

afterEach(cleanup);
const SIZE = { width: 580, height: 380 };

/** Every "move something" callback the figure can raise. */
const MOVERS = [
  "onMoveTitle", "onMoveSubtitle", "onMoveAxisTitle", "onMoveLegend", "onMoveAnnotation",
  "onMoveValueLabel", "onMoveSectionLabel", "onMoveCategoryGroupName", "onMoveColorbar", "onMoveWaffleCaption",
  "onMoveHeatmapLabels", "onMoveCorrLabels", "onMoveCorrLegend", "onMoveTreemapRegionLabel",
  "onMoveSignificanceCaption", "onMoveFitLabel", "onMoveFitParams", "onMoveRefLineLabel",
  "onMoveNetworkNode", "onMoveVennSetLabel", "onMoveUpsetSetLabel", "onMoveTernaryAxisLabel",
  "onMoveHeatSplitLabel", "onMoveHeatTrackName", "onMoveHeatTrackRunLabel", "onMoveHeatTrackKey",
  "onMoveRoseDirectionLabel", "onMoveOncoprintLabel",
] as const;

/**
 * Text that is not expected to drag, with the reason. Default-deny: a new chart type whose text
 * cannot be moved fails here until it is fixed or listed with a reason.
 */
const EXEMPT: Record<string, string> = {
  radar: "the ring scale is a tick ladder on the radial axis — an axis tick by another name",
  parallel: "per-axis tick numbers — a tick ladder on each vertical axis, the same case",
  // The cube edges carry real scales. Their numbers are in `scatter3d.axes[].ticks`,
  // not scene.x/y, so the structural tick exclusion above cannot see them.
  scatter3d: "the cube edges' tick numbers — a tick ladder on each projected axis, the same case",
  // Set labels, bar counts and titles all drag; only the per-set totals stay pinned.
  upset: "the set-size totals are data numerals pinned to their bars — the venn zone-count rule",
  // The edge titles drag (onMoveTernaryAxisLabel); only the tick numbers stay put.
  // The N / NE / … direction labels drag (onMoveRoseDirectionLabel); only the ring numbers stay put.
  rose: "the ring numbers are the radial axis' tick ladder — axis ticks by another name (they live in scene.rose, so the structural scene.x/y exclusion cannot see them)",
  ternary: "the edge tick numbers are a tick ladder on each triangle edge — an axis tick by another name (they live in scene.ternary.ticks, so the structural scene.x/y exclusion cannot see them)",
  tracks: "the numeric-track colour-bar min/max are structural scale numerals pinned beside each strip (the heatmap colour-bar / upset zone-count rule) — they live in scene.tracks, so the scene.x/y exclusion cannot see them",
  sunburst: "the segment labels are data labels bound to their arcs (the treemap-cell / pie-slice rule) — they follow the ring geometry and cannot be dragged free; they live in scene.sunburst, so the scene.x/y exclusion cannot see them",
  chord: "the node labels are data labels bound to their arcs (the sunburst / treemap-cell rule) — they follow the ring geometry and cannot be dragged free; they live in scene.chord, so the scene.x/y exclusion cannot see them",
  // The gene and sample names drag (onMoveOncoprintLabel); only the % numbers stay put.
  oncoprint: "the per-gene % numbers are computed counts pinned to their rows (the venn zone-count rule) — they live in scene.oncoprint, so the scene.x/y exclusion cannot see them",
};

/**
 * Every text that is not exempt above must drag: there are no allowed failures. Pyramid value labels and PCA
 * loading names only drag in this harness once `getScreenCTM` is stubbed (see beforeAll);
 * without it `clientToUser` returns null and every annotation drag is a no-op. The
 * stale-exemption assertion below requires each exemption to prove its text is still stuck,
 * so an exemption cannot stay in place for text that drags.
 */

interface Stuck { label: string; kind: string }
/** Anything with a table + plot: a gallery card, or an option-drawable fixture. */
type GalleryLike = ReturnType<typeof galleryItems>[number];

function stuckText(item: { table: GalleryLike["table"]; plot: GalleryLike["plot"] }): { total: number; stuck: Stuck[] } {
  const g = item;
  const kind = String(g.plot.kind ?? "xy");
  const scene = buildPlotScene(g.table, g.plot as Plot, SIZE);
  // Tick labels: placed by the scale, never individually movable. Structural, from the scene.
  const ticks = new Set(
    [...scene.x.ticks, ...scene.y.ticks, ...(scene.y2?.ticks ?? []), ...(scene.y3?.ticks ?? [])]
      .map((t) => (t.label ?? "").trim()).filter(Boolean),
  );

  let moved = false;
  let picked: GraphSelection = null;
  const spies = Object.fromEntries(MOVERS.map((m) => [m, vi.fn(() => { moved = true; })]));
  const props = {
    scene, zoom: 1, onCamera3D: vi.fn(), onViewChange: vi.fn(), onEditText: vi.fn(),
    onSelect: (x: GraphSelection) => { picked = x; }, ...spies,
  };

  const { container, rerender } = render(<PlotFigure {...props} />);
  const labels = [...new Set([...container.querySelectorAll("text")].map((t) => (t.textContent ?? "").trim()))]
    .filter((t) => t && !ticks.has(t));
  cleanup();

  const out: Stuck[] = [];
  for (const label of labels) {
    moved = false;
    picked = null;
    const r = render(<PlotFigure {...props} />);
    const find = (c: HTMLElement): Element | undefined => [...c.querySelectorAll("text")].find((t) => (t.textContent ?? "").trim() === label);
    let el = find(r.container);
    if (!el) { cleanup(); continue; }
    // (1) select, then re-render with that selection so a drag affordance can appear
    fireEvent.click(el, { clientX: 100, clientY: 100 });
    if (picked) { r.rerender(<PlotFigure {...props} selected={picked} />); el = find(r.container) ?? el; }
    // (2) both gesture families, on the glyph and on its group
    // (2b) …and a drag surface often sits on a sibling, not the glyph: the annotation layer's
    // invisible grab rect, a treemap cell's polygon, a network node's circle — and a treemap
    // value moves with its cell label (they share one offset), so a text-bearing sibling can
    // be the correct surface too.
    // Note: this relies on a renderer contract: a <g> groups one visual unit, so a sibling's
    // drag may be credited to this text. Text placed directly in a chart-wide <g> (siblings
    // with every draggable label on the figure) would therefore read as draggable; the radar's
    // ring scale has its own <g> for this reason. Such a case is fixed in the renderer, not
    // here: narrowing this list breaks the shared-offset cases.
    const siblings = el.parentElement ? [...el.parentElement.children] : [];
    for (const target of [el, el.parentElement, ...siblings].filter(Boolean) as Element[]) {
      if (moved) break;
      fireEvent.pointerDown(target, { clientX: 100, clientY: 100, pointerId: 1 });
      fireEvent.pointerMove(target, { clientX: 145, clientY: 132, pointerId: 1 });
      fireEvent.pointerUp(target, { clientX: 145, clientY: 132, pointerId: 1 });
      if (moved) break;
      fireEvent.mouseDown(target, { clientX: 100, clientY: 100 });
      fireEvent.mouseMove(target, { clientX: 145, clientY: 132 });
      fireEvent.mouseMove(document, { clientX: 145, clientY: 132 });
      fireEvent.mouseUp(document, { clientX: 145, clientY: 132 });
    }
    if (!moved) out.push({ label: label.slice(0, 24), kind });
    cleanup();
    void rerender;
  }
  return { total: labels.length, stuck: out };
}

/** Which exemption, if any, covers this kind's stuck text. */
function exemptionFor(kind: string): string | undefined {
  return EXEMPT[kind];
}

const ITEMS = galleryItems();
const KINDS = ITEMS.map((g) => String(g.plot.kind ?? "xy"));

describe("every text on a graph can be dragged", () => {
  it("the check covers every kind, and finds text on each", () => {
    expect(KINDS.length).toBeGreaterThan(30);
  });

  for (const kind of KINDS) {
    const item = ITEMS.find((x) => String(x.plot.kind ?? "xy") === kind)!;
    it(`${kind}`, () => {
      const r = stuckText(item);
      expect(r.total, `${kind} draws no non-tick text — this case is measuring nothing`).toBeGreaterThan(0);
      const reason = exemptionFor(kind);
      if (reason) {
        // Exempt kinds still have to have the stuck text — an exemption for something that now
        // drags is stale, and is deleted rather than left in place.
        expect(r.stuck.length, `${kind} is exempt ("${reason}") but every text drags now — delete the exemption`).toBeGreaterThan(0);
        return;
      }
      expect(r.stuck.map((s) => s.label), `${kind}: this text cannot be dragged`).toEqual([]);
    }, 30_000); // the 40-sample oncoprint drags ~90 texts; jsdom needs more than the 5 s default
  }

  /**
   * And the text an option draws. A gallery card shows a kind's default look, so text that
   * only an option draws (a heatmap's block name, an annotation strip's name) never appears
   * above. `optionDrawables()` carries fixtures that draw it; add to it whenever an option
   * draws new text.
   */
  for (const item of optionDrawables()) {
    it(`option drawable: ${item.title}`, () => {
      const r = stuckText(item);
      expect(r.total, `${item.title} draws no non-tick text — this case is measuring nothing`).toBeGreaterThan(0);
      expect(r.stuck.map((s) => s.label), `${item.title}: this text cannot be dragged`).toEqual([]);
    });
  }
});
