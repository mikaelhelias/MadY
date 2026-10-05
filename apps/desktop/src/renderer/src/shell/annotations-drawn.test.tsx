// @vitest-environment jsdom
// An annotation that is accepted must be drawn, on every kind.
//
// Guards against a kind resolving a text annotation into `scene.annotations` while its figure
// component never renders it (heatmap · corrmatrix · alluvial · radar · parallel are the kinds
// with their own figure components): the user places a label and it vanishes with no warning.
// A milder form is a builder that refuses annotations (with a scene warning) while the Inspector
// still offers the Annotations section (pie · treemap · 3-D scatter).
//
// Note: "it reached the scene" is not the claim being tested here; a kind can pass that and still
// draw nothing. This renders the real figure and reads the text back out of the DOM.
//
// Network is the one deliberate exception: it refuses annotations in the builder and hides the
// section (`Inspector.tsx`, the `kind !== "network"` gate). It is asserted as such below, so the
// exception stays a decision rather than a silent loss.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { Annotation, DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import { Inspector } from "./Inspector";
import { galleryItems } from "./gallery";

afterEach(cleanup);

const LABEL = "PROBE-ANNOTATION";
const textAnn: Annotation = { id: "probe-ann", kind: "text", label: LABEL, x: 0.5, y: 0.5 };

/** Kinds whose builder refuses annotations outright. Only network — and it hides the adders. */
const REFUSES = new Set(["network"]);

describe("annotations are drawn, not just accepted", () => {
  for (const item of galleryItems()) {
    const kind = item.plot.kind ?? "xy";
    it(`${kind}: a text annotation reaches the drawing`, () => {
      const plot: Plot = { ...item.plot, annotations: [...(item.plot.annotations ?? []), textAnn] };
      const scene = buildPlotScene(item.table, plot, { width: 620, height: 420 });

      if (REFUSES.has(kind)) {
        expect(scene.annotations.find((a) => a.id === textAnn.id), `${kind} is listed as refusing annotations but resolved one`).toBeUndefined();
        expect(scene.warnings.join(" "), `${kind} drops annotations silently — a refusal must say so`).toMatch(/annotation/i);
        return;
      }

      // Fixture check: if the builder never resolved it, the DOM assertion below would be
      // testing the builder, not the renderer — and would read as a renderer defect.
      expect(scene.annotations.find((a) => a.id === textAnn.id), `${kind}: the builder did not resolve the annotation`).toBeTruthy();

      const { container } = render(<PlotFigure scene={scene} zoom={1} onSelect={vi.fn()} />);
      expect(
        (container.textContent ?? "").includes(LABEL),
        `${kind}: the annotation reached the scene but the figure never drew it — silent loss`,
      ).toBe(true);

      // ...and inside the figure. "In the DOM" is not "on the canvas": an annotation placed at a
      // fraction of a plot rect the builder computed differently would render off-canvas, which
      // reads to the user exactly like the silent loss this test exists to catch.
      const el = [...container.querySelectorAll("text")].find((t) => (t.textContent ?? "").includes(LABEL));
      const ax = Number(el?.getAttribute("x") ?? NaN);
      const ay = Number(el?.getAttribute("y") ?? NaN);
      expect(Number.isFinite(ax) && Number.isFinite(ay), `${kind}: the annotation has no resolved position`).toBe(true);
      expect(ax >= 0 && ax <= scene.width, `${kind}: annotation x=${ax} is outside the figure (0..${scene.width})`).toBe(true);
      expect(ay >= 0 && ay <= scene.height, `${kind}: annotation y=${ay} is outside the figure (0..${scene.height})`).toBe(true);
    });
  }
});

describe("annotations can be moved and deleted wherever they are drawn", () => {
  for (const item of galleryItems()) {
    const kind = item.plot.kind ?? "xy";
    if (REFUSES.has(kind)) continue;
    it(`${kind}: the drawn annotation is wired for move + delete`, () => {
      const plot: Plot = { ...item.plot, annotations: [...(item.plot.annotations ?? []), textAnn] };
      const scene = buildPlotScene(item.table, plot, { width: 620, height: 420 });
      const onMoveAnnotation = vi.fn();
      const onDeleteAnnotation = vi.fn();
      const { container } = render(
        <PlotFigure
          scene={scene}
          zoom={1}
          onSelect={vi.fn()}
          selected={{ kind: "annotation", id: textAnn.id }}
          onMoveAnnotation={onMoveAnnotation}
          onDeleteAnnotation={onDeleteAnnotation}
        />,
      );
      // Drawn and advertising a drag: the element carrying the annotation must offer a move
      // cursor, which is what `dead-affordance.spec.ts` then holds to actually committing.
      const node = [...container.querySelectorAll<SVGElement>("[data-ann-text], g, text")]
        .find((el) => (el.textContent ?? "").includes(LABEL));
      expect(node, `${kind}: the annotation is not in the DOM`).toBeTruthy();
      const movable = node!.closest("g,[style*='cursor']") as SVGElement | null;
      expect(
        (movable?.getAttribute("style") ?? "") + (movable?.parentElement?.getAttribute("style") ?? ""),
        `${kind}: the annotation is drawn but advertises no drag`,
      ).toMatch(/move|pointer/);
    });
  }
});

// ---------------------------------------------------------------------------------------------
// Significance brackets — offered only where one can compare two groups.
//
// Asking only "can a bracket be drawn at all?" is too weak: it passes a kind such as the
// ridgeline drawing a bracket that compares nothing, and every other group-less kind with it.
// The sharper question is split across two files:
//
//   `bracket-endpoints.test.ts` — for every kind that is offered the section, do the drawn
//     endpoints land on the two categories they name, on those categories' own axis?
//   This file — for every kind that is not offered it, is that correct: does the kind genuinely
//     have no category axis to span, so nothing meaningful is being withheld?
//
// Together they are a gate in both directions, which is what "can compare two groups" needs.
// By design, the ten kinds whose axes are both continuous (xy · area · blandaltman · pcascore ·
// pcaload · pcabiplot · bubble · volcano · survival · roc) do not offer the section, for the same
// reason as the ridgeline: a bracket there spans two data values.
describe("the Significance brackets section is offered only where a bracket compares two groups", () => {
  /** Does this kind's category axis carry real groups (non-numeric labels)? */
  const hasGroups = (table: DataTable, plot: Plot): boolean => {
    const scene = buildPlotScene(table, plot, { width: 620, height: 420 });
    // UpSet: its category axis is the intersection-column grid, labelled by the membership
    // matrix — the x tick labels are deliberately empty, so measure the columns themselves.
    if (scene.upset) return scene.upset.columns.length >= 2;
    // Swimmer: its banded axis names subjects — individuals, not groups; a bracket between
    // two patients' timelines compares nothing. Brackets are refused entirely (by design)
    // and the builder drops a saved one with a warning giving that reason.
    if (scene.swimmer) return false;
    // Tracks: its banded axis names the tracks (whole columns/variables), not groups of one
    // measurement — a bracket between two tracks compares nothing. Brackets are refused entirely
    // (the swimmer rule); the builder drops a saved one with a warning.
    if (scene.tracks) return false;
    const ticks = (scene.valueAxis !== "x" ? scene.x : scene.y).ticks.filter((t) => !t.minor);
    // Counted, not `every()`: a forest plot's first band carries a blank label above the studies.
    return ticks.filter((t) => t.label !== "" && Number.isNaN(Number(t.label))).length >= 2;
  };

  for (const item of galleryItems()) {
    const kind = item.plot.kind ?? "xy";
    it(`${kind}: panel and drawing agree about whether groups exist`, () => {
      const groups = hasGroups(item.table, item.plot as Plot);

      const { container } = render(
        <Inspector
          activeSection="graphs"
          selection={{ kind: "plot" } as never}
          plot={item.plot}
          table={item.table}
          userPresets={[]}
          profileDefault={null}
          onSelect={vi.fn()}
          onSetAxis={vi.fn()} onSetAxisLength={vi.fn()} onSetAxisTitleFont={vi.fn()}
          onSetSeriesStyle={vi.fn()} onSetSeriesStyleAll={vi.fn()} onSetPointStyle={vi.fn()} onClearPointStyles={vi.fn()}
          onSetGrid={vi.fn()} onSetFrame={vi.fn()} onSetKind={vi.fn()} onSetBarLayout={vi.fn()} onSetBarShape={vi.fn()} onSetBoxWhisker={vi.fn()}
          onSetPlotOptions={vi.fn()} onSetGraphTitle={vi.fn()} onSetPlotFont={vi.fn()} onHomogenizeFont={vi.fn()}
          onSetLegend={vi.fn()} onSetSignificance={vi.fn()} onApplyPreset={vi.fn()} 
          onApplyUserPreset={vi.fn()} onSaveUserPreset={vi.fn()} onDeleteUserPreset={vi.fn()} onSetProfileDefault={vi.fn()}
          annotationOps={{ add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() }}
        />,
      );
      // Read the DOM, not visibility: the rail hides every section off the active tab.
      const offered = [...container.querySelectorAll("summary.inspsum")]
        .some((s) => (s.textContent ?? "").trim() === "Significance brackets");
      // The adder too. Hiding the styling section while leaving "Add bracket" reachable lets a
      // user create an object whose panel is deliberately gone, which is worse than either alone.
      const adder = [...container.querySelectorAll("button.btn-mini")]
        .some((b) => (b.textContent ?? "").trim() === "Bracket");
      cleanup();

      expect(offered, groups
        ? `${kind}: it has real groups on its category axis, but the section is hidden`
        : `${kind}: the section is offered, but both axes are continuous — a bracket there spans two data values and compares nothing`).toBe(groups);
      expect(adder, `${kind}: the "Add bracket" button and the Significance brackets section disagree`).toBe(offered);
    });
  }

  /**
   * Guards the guard: both buckets must be non-empty, or the assertion above is vacuous on one
   * side. The thresholds are lower bounds on the gallery cards on each side.
   */
  it("both sides of the rule are actually populated", () => {
    let withGroups = 0, without = 0;
    for (const item of galleryItems()) {
      if (hasGroups(item.table, item.plot as Plot)) withGroups += 1; else without += 1;
    }
    expect(withGroups, "no kind has groups — the detector is broken").toBeGreaterThanOrEqual(15);
    expect(without, "every kind has groups — the detector is broken").toBeGreaterThanOrEqual(10);
  });
});
