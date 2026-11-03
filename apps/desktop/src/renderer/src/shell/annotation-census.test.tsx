// @vitest-environment jsdom
/**
 * Annotation census — "if the renderer offers the edit, the document must do it."
 *
 * Guards against this defect class: an element on the canvas advertises an edit (a
 * `cursor:move`, an editor that opens on double-click, a delete grip), the user performs it,
 * and the document layer silently drops it because the id it was handed matched nothing.
 * Such a defect passes a suite whose tests only assert what the code does; builder-synthesized
 * elements (PCA loading arrows, generated labels, the number-at-risk table) are the likeliest place.
 *
 * The approach relies on a scene enumerating its own annotations, so this needs no hand-written
 * list of what to check and cannot go stale: it walks every kind's scene, and for each
 * annotation asks the renderer what it offers, then drives exactly that through a real
 * MadyDocument. `setStrictMutations` (on under vitest) turns a dropped edit into a throw.
 *
 * Default-deny: a new kind, or a new builder-synthesized element, is enrolled automatically
 * the moment it appears in a scene. There is no allowlist to forget to update — the only way
 * to be exempt is an explicit `deliberateNoop` in the document layer, which states its reason.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { Plot } from "@mady/core";
import { MadyDocument, annotationRenamePatch, clearRefusals, refusedMutations } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import type { AnnotationScene, PlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import { FIX, type Fx } from "./plot-fixtures";

afterEach(cleanup);

/**
 * A document holding one plot of the fixture's kind, plus the scene built from that very
 * plot — so every id the scene reports resolves in the document.
 *
 * Building from the document (rather than from the fixture literal) matters for real
 * annotations: a builder-synthesized id like `pca-arrow-*` routes through
 * `updateSynthElement` and needs no stored object, but a real bracket must actually exist
 * or the mutation cannot find it.
 */
function caseFor(fx: Fx): { doc: MadyDocument; plotId: string; scene: PlotScene } {
  const doc = new MadyDocument();
  const t = doc.importTable("T", "xy", ["X", "Y"], [[1, 2]]);
  const plot = doc.addPlot("G", t.id);
  doc.setPlotKind(plot.id, fx.kind);
  const { annotations, ...restExtra } = fx.extra ?? {};
  if (Object.keys(restExtra).length > 0) doc.setPlotOptions(plot.id, restExtra);
  for (const a of annotations ?? []) {
    const { id: _drop, ...rest } = a;
    doc.addAnnotation(plot.id, rest);
  }
  return { doc, plotId: plot.id, scene: sceneOf(doc, plot.id, fx) };
}

/** Rebuild the fixture's scene from the document's current plot state. */
function sceneOf(doc: MadyDocument, plotId: string, fx: Fx): PlotScene {
  const live = doc.toJSON().plots.find((p) => p.id === plotId)!;
  return buildPlotScene(fx.table, { ...live, source: fx.table.id, title: "Kind Title" } as Plot, { width: 520, height: 360 });
}

/** What the renderer offers for this annotation, read off the rendered DOM. */
function affordances(scene: PlotScene, a: AnnotationScene): { drag: boolean; edit: boolean; del: boolean } {
  const { container } = render(
    <PlotFigure scene={scene} selected={{ kind: "annotation", id: a.id }} onSelect={() => {}} onMoveAnnotation={() => {}} onDeleteAnnotation={() => {}} onEditText={() => {}} />,
  );
  const shape = container.querySelector(`[data-ann-shape="${a.id}"]`);
  const text = [...container.querySelectorAll("text")].find((t) => t.getAttribute("data-ann-text") === a.id);
  const host = (shape ?? text?.parentElement) as Element | null;
  const cursorOf = (el: Element | null | undefined): string => (el as unknown as { style?: CSSStyleDeclaration } | null)?.style?.cursor ?? "";
  // a drag affordance = something in this annotation advertises "move"
  const drag = !!host && (cursorOf(host) === "move" || [...host.querySelectorAll("*")].some((el) => cursorOf(el) === "move") || cursorOf(text) === "move");
  // an edit affordance = double-clicking it opens an inline editor
  let edit = false;
  if (text) {
    fireEvent.doubleClick(text);
    edit = !!container.querySelector("textarea, input");
  }
  // a delete affordance = a delete grip is drawn while selected
  const del = !!host && [...host.querySelectorAll("title")].some((t) => /delete/i.test(t.textContent ?? ""));
  cleanup();
  return { drag, edit, del };
}

// Only kinds whose builder actually synthesizes annotations are interesting; the rest have
// none and pass trivially. Enrolled from the scene, never from a hand-kept list.
const CASES: { fx: Fx; scene: PlotScene; anns: AnnotationScene[] }[] = FIX.map((fx) => {
  const scene = caseFor(fx).scene;
  return { fx, scene, anns: scene.annotations };
}).filter((c) => c.anns.length > 0);

describe("annotation census — every edit the renderer offers, the document performs", () => {
  it("covers the kinds that synthesize annotations (guards the census itself)", () => {
    // If this drops to zero the census has silently stopped testing anything.
    expect(CASES.length, "no kind synthesizes annotations — census is vacuous").toBeGreaterThan(0);
    expect(CASES.some((c) => c.anns.some((a) => a.id.startsWith("pca-arrow"))), "the PCA arrows are not enrolled").toBe(true);
  });

  for (const { fx, scene, anns } of CASES) {
    for (const a of anns) {
      const label = `${fx.kind} / ${a.id}`;
      it(`${label}: the document performs whatever the canvas offers`, () => {
        const { drag, edit, del } = affordances(scene, a);
        const { doc, plotId } = caseFor(fx);
        // A deliberate refusal is only defensible if the UI never offers the thing. Driving an
        // offered affordance must therefore not hit a deliberateNoop — that combination is a
        // dead affordance with a justification attached (e.g. a synthesized label's × that
        // looks clickable while removeAnnotation refuses it).
        clearRefusals();
        // Each assertion below throws (via setStrictMutations) if the document layer drops
        // the edit — the failure message names the element and the fix.
        if (drag) {
          expect(
            () => doc.moveAnnotation(plotId, a.id, { x: 0.5, y: 0.5 }),
            `${label} advertises cursor:move but the document drops the move`,
          ).not.toThrow();
        }
        if (edit) {
          // Route the rename exactly the way the canvas does — through the shared
          // `annotationRenamePatch`, so this asserts the real path rather than a
          // re-implementation of it that could agree with a bug.
          const model = doc.toJSON().plots.find((pp) => pp.id === plotId)?.annotations?.find((x) => x.id === a.id);
          expect(
            () => doc.updateAnnotation(plotId, a.id, annotationRenamePatch(model ?? {}, "Renamed")),
            `${label} opens a rename editor but the document drops the text`,
          ).not.toThrow();
          // …and the text must actually reach the drawing.
          // Accepting the mutation is not enough: a p-carrying bracket could store the typed
          // label and then ignore it, because the label is derived from `p` at build
          // time. Nothing would throw, no refusal would be recorded, and the rename would
          // vanish — a silent no-op, which is strictly worse than a refusal because there is
          // nothing to notice. Rebuild the scene and read the label back.
          const after = sceneOf(doc, plotId, fx).annotations.find((x) => x.id === a.id);
          if (after && after.label !== undefined) {
            expect(
              after.label,
              `${label} accepted a rename but the rebuilt scene still reads ${JSON.stringify(after.label)}. ` +
                "The edit is being dropped SILENTLY somewhere between the document and the builder.",
            ).toBe("Renamed");
          }
        }
        if (del) {
          expect(
            () => doc.removeAnnotation(plotId, a.id),
            `${label} shows a delete grip but the document drops the delete`,
          ).not.toThrow();
        }
        expect(
          refusedMutations().map((r) => `${r.op}: ${r.reason}`),
          `${label}: the canvas OFFERS an edit that the document deliberately refuses. ` +
            "Either stop offering it (AnnotationScene.deletable:false / .locked) or make the document do it — " +
            "a justified refusal the user can still trigger is just a dead affordance:",
        ).toEqual([]);
      });
    }
  }
});
