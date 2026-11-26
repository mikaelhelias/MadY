// @vitest-environment jsdom
// The value-label font is offered on exactly the kinds that can draw value labels.
//
// The "Value label font" control is gated on value labels being on. Forcing `showValues: true`
// on a kind where no control in the program can switch labels on shows the control while the
// builder draws no labels, so `fonts.valueLabel.*` then changes nothing on the drawing. A user
// cannot reach that state, so it is not a defect.
//
// This file checks the two conditions that make the gating correct:
//
//  1. Undriven, the control is absent wherever labels are off, so no control does nothing.
//  2. On every kind where labels are reachable, switching them on makes the font change the
//     drawing, so no control does nothing there either.
//
// The reachable set is derived from where the program actually offers a switch:
//    plot-wide `showValues` — the graph ribbon, bar + histogram only (`panes.tsx`, and
//      `onSetShowValues` is its sole writer: no preset or template sets it)
//    per-series `pointLabels` — the Inspector's series panel on xy · area · bubble · volcano
//    `lollipop.showValues` / `pyramid.showValues` — their own kind blocks
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import type { Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import { Inspector } from "./Inspector";
import { galleryItems } from "./gallery";
import { VALUE_LABEL_SWITCHES } from "./optionEffects";

afterEach(cleanup);

const SIZE = { width: 620, height: 420 };

/** Kinds where some control in the program can put value labels on the page. */
const LABELS_REACHABLE = new Set(["bar", "histogram", "xy", "area", "bubble", "volcano", "lollipop", "pyramid", "funnel",
  // ternary: per-series Point labels (the marker-family control) draw on the composition dots
  "ternary",
  // upset: "Counts above bars" writes the standard showValues — the bar machinery draws them
  "upset",
  // swimmer: "Duration labels" writes the standard showValues; drawn in the value-label font
  "swimmer",
  // paireddot: its Chart section carries a "Value labels" checkbox writing `paireddot.showValues`.
  // `labelsOn` reads the per-kind switches from `VALUE_LABEL_SWITCHES`; a hand-written list that
  // omitted this kind would draw no paired-dot labels, and the else-branch would then certify the
  // kind as unable to show any, hiding a missing font block on a kind that does draw labels.
  "paireddot"]);

const handlers = () => ({
  onSelect: vi.fn(),
  onSetAxis: vi.fn(), onSetAxisLength: vi.fn(), onSetAxisTitleFont: vi.fn(),
  onSetSeriesStyle: vi.fn(), onSetSeriesStyleAll: vi.fn(), onSetPointStyle: vi.fn(), onClearPointStyles: vi.fn(),
  onSetGrid: vi.fn(), onSetFrame: vi.fn(), onSetKind: vi.fn(), onSetBarLayout: vi.fn(), onSetBarShape: vi.fn(), onSetBoxWhisker: vi.fn(),
  onSetPlotOptions: vi.fn(), onSetGraphTitle: vi.fn(), onSetPlotFont: vi.fn(), onHomogenizeFont: vi.fn(),
  onSetLegend: vi.fn(), onSetSignificance: vi.fn(), onApplyPreset: vi.fn(), 
  onApplyUserPreset: vi.fn(), onSaveUserPreset: vi.fn(), onDeleteUserPreset: vi.fn(), onSetProfileDefault: vi.fn(),
  annotationOps: { add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() },
});

/** Control labels, never the whole `textContent`: hidden <option> text would make these guards unable to fail. */
function labels(plot: Plot, table: never): string[] {
  const { container } = render(
    <Inspector activeSection="graphs" selection={{ kind: "plot" }} plot={plot} table={table}
      userPresets={[]} profileDefault={null} {...handlers()} />,
  );
  const out = [...container.querySelectorAll("label > span:first-child, .inspsub, .insphd")]
    .map((e) => (e.textContent ?? "").trim()).filter(Boolean);
  cleanup();
  return out;
}

/** Does the value-label font change what is drawn for this plot as it stands? This is the only
 *  reliable test of "are there value labels on this page". */
function fontMovesDrawing(plot: Plot, table: never): boolean {
  const draw = (p: Plot): string =>
    renderToStaticMarkup(createElement(PlotFigure, { scene: buildPlotScene(table, p, SIZE) }));
  const bigger: Plot = { ...plot, fonts: { ...plot.fonts, valueLabel: { ...plot.fonts?.valueLabel, size: 27 } } };
  return draw(plot) !== draw(bigger);
}

/**
 * Every route on: the plot-wide flag, the per-series one (they live on different objects — a
 * spread variable that "sets" pointLabels on the plot compiles and is silently ignored), and each
 * kind with its own switch. Note: the kind-specific switches are required here. The lollipop's
 * labels default to off, so the shared flags alone leave it with nothing drawn and the font
 * correctly moves nothing, which would read as a defect.
 */
/**
 * Switch value labels on by every route the model declares.
 *
 * Several kinds carry their own `showValues`; a helper that skipped one would draw no labels on
 * it, and the else-branch below would then certify it as "no control in the program can switch
 * value labels on here", which is false for the paired dot. `VALUE_LABEL_SWITCHES` is checked
 * against `model.ts` (`value-label-switches.test.ts`), so the list stays complete.
 */
const labelsOn = (plot: Plot, table: { columns: { id: string; role?: string }[] }): Plot => {
  const styles = { ...(plot.seriesStyles ?? {}) };
  for (const c of table.columns) if (c.role === "y") styles[c.id] = { ...(styles[c.id] ?? {}), pointLabels: "y" };
  const own: Record<string, unknown> = {};
  for (const k of VALUE_LABEL_SWITCHES) {
    own[k] = { ...((plot as unknown as Record<string, object | undefined>)[k] ?? {}), showValues: true };
  }
  return { ...plot, showValues: true, seriesStyles: styles, ...own } as Plot;
};

describe("the value-label font control matches what the drawing can do", () => {
  for (const item of galleryItems() as unknown as { table: never; plot: Plot }[]) {
    const kind = item.plot.kind ?? "xy";

    it(`${kind}: undriven, the font control matches whether labels are on the page`, () => {
      // Note: this asks the drawing, not the flags. Mirroring `showValues || pointLabels` here
      // would agree with the Inspector by construction and prove nothing, and it would miss the
      // lollipop, whose value labels come from `lollipop.showValues` (default on), which the
      // shared gate does not read.
      const drawn = fontMovesDrawing(item.plot, item.table);
      expect(
        labels(item.plot, item.table).includes("Value label font"),
        drawn
          ? `${kind}: value labels are drawn on the default figure and nothing can restyle them`
          : `${kind}: a font control for value labels that are not on the page`,
      ).toBe(drawn);
    });

    if (LABELS_REACHABLE.has(kind)) {
      it(`${kind}: labels are reachable, so the font must change the drawing`, () => {
        const base = labelsOn(item.plot, item.table);
        const draw = (p: Plot): string =>
          renderToStaticMarkup(createElement(PlotFigure, { scene: buildPlotScene(item.table, p, SIZE) }));
        const bigger: Plot = { ...base, fonts: { ...base.fonts, valueLabel: { ...base.fonts?.valueLabel, size: 27 } } };
        expect(draw(base) !== draw(bigger), `${kind}: value labels are switchable here but their font does nothing`).toBe(true);
        expect(labels(base, item.table), `${kind}: labels are on and there is no control for their font`).toContain("Value label font");
      });
    } else {
      it(`${kind}: no control in the program can switch value labels on here`, () => {
        // This is why "control present, drawing unchanged" on these kinds (with labels forced on)
        // is not a defect: a user cannot reach it. If a kind gains a value-label switch, it belongs in
        // LABELS_REACHABLE, and the test above then requires the font to work.
        const base = labelsOn(item.plot, item.table);
        const draw = (p: Plot): string =>
          renderToStaticMarkup(createElement(PlotFigure, { scene: buildPlotScene(item.table, p, SIZE) }));
        const bigger: Plot = { ...base, fonts: { ...base.fonts, valueLabel: { ...base.fonts?.valueLabel, size: 27 } } };
        expect(
          draw(base) === draw(bigger),
          `${kind}: value labels do draw here — if a user can switch them on, this kind belongs in LABELS_REACHABLE`,
        ).toBe(true);
      });
    }
  }
});

/**
 * One route at a time, because switching on all of them hides the defect.
 *
 * `labelsOn` turns on the plot-wide flag, every per-series `pointLabels` and each kind's own
 * switch. The font block's gate accepts any of those, so a kind whose own switch the gate does not
 * know about still shows the block, revealed by the `pointLabels` route the fixture also set. The
 * test above can therefore pass on the paired dot while a user who ticks only its "Value labels"
 * box gets labels on the page and no font control: the dead end that gate exists to prevent.
 *
 * Each kind's own switch is therefore driven alone.
 */
describe("each kind's own value-label switch reveals the font control by itself", () => {
  for (const k of VALUE_LABEL_SWITCHES) {
    const item = (galleryItems() as unknown as { table: never; plot: Plot }[]).find((g) => (g.plot.kind ?? "xy") === k);
    if (!item) continue;
    it(`${k}: ticking its own Value labels box alone`, () => {
      const own = { ...item.plot, [k]: { ...((item.plot as unknown as Record<string, object | undefined>)[k] ?? {}), showValues: true } } as Plot;
      const draw = (p: Plot): string =>
        renderToStaticMarkup(createElement(PlotFigure, { scene: buildPlotScene(item.table, p, SIZE) }));
      const bigger: Plot = { ...own, fonts: { ...own.fonts, valueLabel: { ...own.fonts?.valueLabel, size: 27 } } };
      // Only kinds whose labels are lettered with the shared value-label font make a claim here;
      // heatmap, corrmatrix, sunburst and treemap letter theirs with their own fonts.
      if (draw(own) === draw(bigger)) return;
      expect(
        labels(own, item.table),
        `${k}: its own switch draws labels in the shared font and offers no control for it`,
      ).toContain("Value label font");
    });
  }
});

/**
 * The Bold box reaches the drawing, and the two bold kinds stay bold by default.
 *
 * Guards against a hard-coded `fontWeight={700}` placed after the resolved font on the lollipop's
 * and paired dot's value labels, which makes `fonts.valueLabel.bold = false` change nothing: a
 * live control that moves no pixel. The weight comes from the resolved font, whose default is 700
 * on exactly these two kinds and 600 everywhere else, so a graph that never touched Bold keeps
 * its 700 labels while the Bold box still changes them.
 *
 * Both directions are checked, because each one alone can pass for the wrong reason:
 *   • unticking Bold must lighten them (otherwise the control does nothing);
 *   • left alone they must still draw at 700 (removing the hard-coded weight without the 700
 *     default would pass the first check and make every saved graph lighter).
 */
describe("value labels: the Bold box reaches the lollipop + paired dot, which still default to 700", () => {
  /** Weights of the text elements that are the value labels, in both render paths (draggable and
   *  plain): matched by their text from the scene, and by the one attribute no axis tick carries. */
  const weights = (plot: Plot, table: never, draggable: boolean): number[] => {
    const scene = buildPlotScene(table, plot, SIZE);
    const wanted = new Set<string>();
    for (const r of scene.lollipop?.rows ?? []) for (const d of r.dots) if (d.label) wanted.add(d.label);
    for (const r of scene.paireddot?.rows ?? []) for (const m of r.marks) if (m.label) wanted.add(m.label);
    const { container } = render(
      <PlotFigure scene={scene} {...(draggable ? { onMoveValueLabel: () => {} } : {})} />,
    );
    const out: number[] = [];
    for (const t of container.querySelectorAll("text")) {
      if (!wanted.has((t.textContent ?? "").trim())) continue;
      const mine = draggable
        ? (t as unknown as HTMLElement).style.cursor === "move"
        : t.getAttribute("pointer-events") === "none";
      if (mine) out.push(Number(t.getAttribute("font-weight")));
    }
    cleanup();
    return out;
  };

  for (const kind of ["lollipop", "paireddot"]) {
    const item = (galleryItems() as unknown as { table: never; plot: Plot }[]).find((g) => (g.plot.kind ?? "xy") === kind)!;
    const on = (bold?: boolean): Plot => {
      const base = labelsOn(item.plot, item.table);
      return bold == null ? base : { ...base, fonts: { ...base.fonts, valueLabel: { ...base.fonts?.valueLabel, bold } } };
    };

    for (const draggable of [true, false]) {
      const path = draggable ? "draggable" : "plain";
      it(`${kind} (${path}): untouched, the value labels are bold (700)`, () => {
        const w = weights(on(), item.table, draggable);
        expect(w.length, `${kind}: no value labels found to measure — the fixture cannot exhibit the defect`).toBeGreaterThan(0);
        expect(new Set(w), `${kind}: the default value-label weight changed — every saved graph just got lighter`).toEqual(new Set([700]));
      });

      it(`${kind} (${path}): unticking Bold lightens them`, () => {
        const w = weights(on(false), item.table, draggable);
        expect(w.length).toBeGreaterThan(0);
        expect(new Set(w), `${kind}: fonts.valueLabel.bold = false does not reach the drawing`).toEqual(new Set([400]));
      });

      it(`${kind} (${path}): ticking Bold keeps them at 700`, () => {
        expect(new Set(weights(on(true), item.table, draggable))).toEqual(new Set([700]));
      });
    }
  }
});

/**
 * The Δ% label is a value label, so it takes the value-label font.
 *
 * Guards against lettering the lollipop's green "+55%" from `fonts.legend` with a hard-coded
 * weight of 700. The legend font is the control for the legend; a reader restyling the numbers
 * beside the dots has no reason to look there, and the Bold box could not reach it either. The
 * label follows `fonts.valueLabel`, like the dot labels beside it, in the drawing and in the margin
 * the builder reserves for it.
 *
 * The default look is pinned too: legend and tick default to the same 13 px, and the lollipop's
 * value-label weight defaults to 700.
 */
describe("the lollipop's Δ% follows the value-label font, not the legend font", () => {
  const table = {
    id: "t", kind: "column", name: "T",
    columns: [{ id: "x", name: "Assay", role: "x" }, { id: "a", name: "Before", role: "y" }, { id: "b", name: "After", role: "y" }],
    rows: [["Cortex", 20, 31], ["Striatum", 28, 39]].map(([c, a, b], i) => ({ id: `r${i}`, cells: { x: c as string, a: a as number, b: b as number } })),
  } as unknown as never;
  const plot = (fonts?: Plot["fonts"]): Plot =>
    ({ id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "lollipop", ...(fonts ? { fonts } : {}) }) as Plot;

  /** The Δ labels' own size + weight, found by the text the builder says they carry. */
  const deltas = (p: Plot): { size: string | null; weight: string | null }[] => {
    const scene = buildPlotScene(table, p, SIZE);
    const texts = new Set((scene.lollipop?.rows ?? []).map((r) => r.delta?.text).filter(Boolean) as string[]);
    expect(texts.size, "the fixture draws no Δ% — it cannot exhibit the defect").toBeGreaterThan(0);
    const { container } = render(<PlotFigure scene={scene} />);
    const out = [...container.querySelectorAll("text")]
      .filter((t) => texts.has((t.textContent ?? "").trim()))
      .map((t) => ({ size: t.getAttribute("font-size"), weight: t.getAttribute("font-weight") }));
    cleanup();
    return out;
  };

  it("untouched, it is 13 px and bold", () => {
    const d = deltas(plot());
    expect(d.length).toBeGreaterThan(0);
    expect(new Set(d.map((x) => `${x.size}/${x.weight}`)), "the default Δ% look moved").toEqual(new Set(["13/700"]));
  });

  it("the value-label font size reaches it", () => {
    expect(new Set(deltas(plot({ valueLabel: { size: 27 } })).map((x) => x.size))).toEqual(new Set(["27"]));
  });

  it("the value-label Bold box reaches it", () => {
    expect(new Set(deltas(plot({ valueLabel: { bold: false } })).map((x) => x.weight))).toEqual(new Set(["400"]));
  });

  it("the legend font does not reach it", () => {
    const d = deltas(plot({ legend: { size: 27, bold: false } }));
    expect(new Set(d.map((x) => `${x.size}/${x.weight}`)), "the Δ% still letters from the legend font").toEqual(new Set(["13/700"]));
  });

  it("the room reserved for it on the right follows the value-label font, so a big Δ% is not clipped", () => {
    const width = (p: Plot): number => {
      const s = buildPlotScene(table, p, SIZE);
      return s.lollipop!.rows[0]!.delta!.x;
    };
    // A bigger value-label font must push the Δ anchor to the left (more right margin reserved for it).
    expect(width(plot({ valueLabel: { size: 30 } })), "the Δ reserve ignores the font that letters it").toBeLessThan(width(plot()));
  });
});

/**
 * Lettering the Δ% in the value-label font (the block above) gives that font a second way onto
 * the page, and the Δ is on by default while the lollipop's value labels
 * are not. A lollipop with labels off and Δ on therefore letters text in the value-label font, and
 * the panel must not hide its control: that would be the dead end the gate above exists to
 * prevent. A check over the gallery cannot see this case (its lollipop card sets `showDelta: false`),
 * so this checks it directly.
 */
describe("the Δ% alone reveals the value-label font control", () => {
  const item = (galleryItems() as unknown as { table: never; plot: Plot }[]).find((g) => g.plot.kind === "lollipop")!;

  it("labels off, Δ on: the font letters the Δ, so the control is shown", () => {
    const p = { ...item.plot, lollipop: { ...item.plot.lollipop, showValues: false, showDelta: true } } as Plot;
    expect(fontMovesDrawing(p, item.table), "the fixture draws no Δ — it cannot exhibit the dead end").toBe(true);
    expect(labels(p, item.table), "the Δ% is lettered in the value-label font and nothing can restyle it").toContain("Value label font");
  });

  it("labels off, Δ off: nothing on the page uses it, so the control is hidden", () => {
    const p = { ...item.plot, lollipop: { ...item.plot.lollipop, showValues: false, showDelta: false } } as Plot;
    expect(fontMovesDrawing(p, item.table)).toBe(false);
    expect(labels(p, item.table)).not.toContain("Value label font");
  });
});
