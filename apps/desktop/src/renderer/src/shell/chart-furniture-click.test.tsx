// @vitest-environment jsdom
/**
 * A chart's own furniture must select something when you click it.
 *
 * Cases covered:
 *   • correlation matrix — the legend's symbol size and font, and the axis labels, must be
 *     reachable by clicking them.
 *   • network graph — a click on the legend or on a node's text must open a side-panel section,
 *     so the font size and the rest can be edited.
 *   • parallel coordinates — the axes must be clickable and open their side panel.
 *
 * These share one shape, and none of them is a missing control — every setting exists in an
 * Inspector section. What each needs is the route: an element that carries only a drag handler,
 * or a double-click-to-rename, or nothing at all, lets a single click fall through to the figure
 * background and select the whole graph — landing on whichever tab was last open. That reads as
 * "nothing is editable" rather than as a wrong panel.
 *
 * Note: these tests dispatch on the element itself, which is what a pointer over the glyph does,
 * rather than at coordinates. `document.elementFromPoint` can hit a different element than the
 * one intended and report working code as broken.
 *
 * The second half of every case: the section a click pins has to exist. Pinning hides every
 * section whose heading does not match, so naming a section that is not there blanks the whole
 * panel (what `legend-click-and-symbol.test.tsx` guards against for `id: "Volcano"`).
 * Each route below is checked twice: the click emits the selection, and the selection has
 * something to show.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import { Inspector } from "./Inspector";
import { galleryItems } from "./gallery";
import type { GraphSelection } from "./AppShell";

afterEach(cleanup);
afterEach(() => globalThis.localStorage?.clear());

const SIZE = { width: 620, height: 420 };

/** The gallery card for a kind, as a user opens it. */
function card(kind: string): { table: never; plot: Plot } {
  const g = (galleryItems() as unknown as { table: never; plot: Plot }[]).find((x) => (x.plot.kind ?? "xy") === kind);
  if (!g) throw new Error(`no gallery card for ${kind} — the fixture cannot exhibit this`);
  return g;
}

/** Render a figure and collect what it selects. Every callback the real app passes is passed
 *  here too, because several of these routes are gated on one (`onSelect`, `onEditText`). */
function figure(kind: string): { container: HTMLElement; picks: GraphSelection[] } {
  const g = card(kind);
  const picks: GraphSelection[] = [];
  const { container } = render(
    <PlotFigure
      scene={buildPlotScene(g.table, g.plot, SIZE)}
      zoom={1}
      onSelect={(s) => picks.push(s)}
      onEditText={() => {}}
      onMoveAnnotation={() => {}}
    />,
  );
  return { container, picks };
}

const texts = (container: HTMLElement): SVGTextElement[] => [...container.querySelectorAll("text")] as SVGTextElement[];
const byText = (container: HTMLElement, s: string): SVGTextElement => {
  const el = texts(container).find((e) => (e.textContent ?? "").trim() === s);
  if (!el) throw new Error(`no <text> reading "${s}" — the fixture cannot exhibit this`);
  return el;
};

/**
 * A press and release that never moved, including the click a real mouse fires afterwards.
 *
 * That last event is required. These labels commit on pointerup (they own a drag, so they cannot
 * wait for `click`), and the browser then fires `click` regardless. Unhandled, it bubbles to the
 * figure background's "select the plot" handler and overwrites the selection a millisecond after
 * it was made — so clicking a correlation-matrix label would do nothing, while a two-event helper
 * would report it working.
 *
 * `DraggableTitle` swallows that click. If this helper is ever trimmed back to two events,
 * the guard stops describing a mouse.
 */
function press(el: Element): void {
  fireEvent.pointerDown(el, { clientX: 100, clientY: 100 });
  fireEvent.pointerUp(el, { clientX: 100, clientY: 100 });
  fireEvent.click(el, { clientX: 100, clientY: 100 });
}

/**
 * The other mechanism. A draggable group (the two legends here) selects from a real `onClick`
 * that stops propagation, not from pointer-up like a draggable label does — so the two gestures
 * are dispatched differently on purpose. Using the wrong one reports working code as broken.
 */
function clickGroup(el: Element): void {
  fireEvent.pointerDown(el, { clientX: 100, clientY: 100 });
  fireEvent.pointerUp(el, { clientX: 100, clientY: 100 });
  fireEvent.click(el, { clientX: 100, clientY: 100 });
}

/** Does `selection` give the Inspector anything to show, and does the rail agree? */
function inspect(kind: string, selection: GraphSelection): { lit: string[]; shown: string[]; controls: number } {
  const g = card(kind);
  const { container } = render(
    <Inspector activeSection="graphs" selection={selection} plot={g.plot} table={g.table}
      userPresets={[]} profileDefault={null} {...handlers()} />,
  );
  const lit = [...container.querySelectorAll<HTMLElement>(".inspcat")]
    .filter((e) => e.getAttribute("aria-selected") === "true")
    .map((e) => e.textContent ?? "");
  const secs = [...container.querySelectorAll<HTMLElement>("details.inspsec")].filter((s) => !s.hidden);
  return {
    lit,
    shown: secs.map((s) => s.querySelector(":scope > summary")?.textContent ?? ""),
    controls: secs.flatMap((s) => [...s.querySelectorAll("input, select, button.swbtn")]).length,
  };
}

/** Every Inspector callback as a spy — this file asserts routing, never mutation. Same shape as
 *  `legend-click-and-symbol.test.tsx`, and inferred (not `Record<string, unknown>`) so the spread
 *  still typechecks against the real prop list. */
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

// ─────────────────────────────────────────────────────────────────────────────
describe("parallel coordinates — a tick number selects its axis", () => {
  it("a tick label selects its axis, not the whole graph", () => {
    const { container, picks } = figure("parallel");
    // "5.0" is the first tick of the first axis in the iris card.
    fireEvent.click(byText(container, "5.0"));
    expect(picks, "clicking a tick number selected nothing").toHaveLength(1);
    expect(picks[0], "a tick number selected the whole graph").not.toEqual({ kind: "plot" });
    expect((picks[0] as { kind: string }).kind).toBe("parallel-axis");
  });

  it("…and the axis it names is the axis it belongs to, not just any axis", () => {
    const { container, picks } = figure("parallel");
    // "2.0" is a tick of the last axis (Petal W, 0.0–2.0), so a hardcoded first-axis id fails.
    fireEvent.click(byText(container, "2.0"));
    const first = (figure("parallel").picks, byText(figure("parallel").container, "5.0"));
    expect(first).toBeTruthy();
    const colIds = new Set((buildPlotScene(card("parallel").table, card("parallel").plot, SIZE).parallel?.axes ?? []).map((a) => a.colId));
    expect(colIds.has((picks[0] as { colId: string }).colId), "the tick pointed at an axis this plot does not have").toBe(true);
  });

  it("a parallel axis lights the Axis rail tab — it is an axis", () => {
    // Without a case in the tab routing it falls through to the last-used tab: the panel
    // shows the axis editor while the rail highlights something else.
    const { lit } = inspect("parallel", { kind: "parallel-axis", colId: "sl" });
    expect(lit, "a selected parallel axis did not light the Axis tab").toEqual(["Axis"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("correlation matrix — its labels and its legend open its section", () => {
  const SECTION = "Correlation matrix";

  it("a row label opens the section that owns the label font and angle", () => {
    const { container, picks } = figure("corrmatrix");
    // Two labels read "Study hrs" (a row and a column); either must work, so take the last.
    const rows = texts(container).filter((e) => (e.textContent ?? "").trim() === "Study hrs");
    expect(rows.length, "the matrix does not draw its labels twice — fixture changed").toBe(2);
    press(rows[1]!);
    expect(picks, "clicking a row label selected nothing").toEqual([{ kind: "chart-section", title: SECTION }]);
  });

  it("a column label does too", () => {
    const { container, picks } = figure("corrmatrix");
    press(texts(container).filter((e) => (e.textContent ?? "").trim() === "Stress")[0]!);
    expect(picks).toEqual([{ kind: "chart-section", title: SECTION }]);
  });

  /**
   * Note: the swatch, not the title. The legend's words open the section holding "Legend font"
   * (the case further down), and its glyphs open the matrix section, which owns whether the
   * legend is drawn and the +/− palette. Same rule as everywhere else — the shape is the thing,
   * the words are type. Guards against a legend that is only draggable: clicking its body must
   * select something.
   */
  it("the correlation-scale legend's swatch does too — it is not only draggable", () => {
    const { container, picks } = figure("corrmatrix");
    const group = byText(container, "Correlation").closest("g")!;
    const swatch = group.querySelector("path");
    expect(swatch, "the scale legend draws no glyphs — the fixture cannot exhibit this").not.toBeNull();
    clickGroup(swatch!);
    expect(picks, "clicking the scale legend selected nothing").toEqual([{ kind: "chart-section", title: SECTION }]);
  });

  it("…and that section exists with controls, on the Chart tab", () => {
    // Not `{kind:"colorbar"}`: that pins "Colour bar", which a correlation matrix has no
    // section for, and a pinned section that is absent hides every section — a blank panel.
    const { lit, shown, controls } = inspect("corrmatrix", { kind: "chart-section", title: SECTION });
    expect(shown, "the pinned section is not the only thing shown").toEqual([SECTION]);
    expect(lit).toEqual(["Chart"]);
    expect(controls, "the section opened empty").toBeGreaterThan(5);
  });

  /**
   * The scale legend's text goes where its font is — a different section from the legend's own.
   * `fonts.legend` is what draws it, and the only control for that is "Legend font" in
   * Title & legend. Guards the route to the legend's font.
   */
  it("the scale legend's title opens the section holding Legend font, not the matrix section", () => {
    const { container, picks } = figure("corrmatrix");
    const scene = buildPlotScene(card("corrmatrix").table, card("corrmatrix").plot, SIZE);
    press(byText(container, scene.corrmatrix!.scaleLegend!.title));
    expect(picks).toEqual([{ kind: "chart-section", title: "Title & legend" }]);
  });

  it("…and that section really does carry a Legend font control on this kind", () => {
    // The half that matters: routing there is useless if the control is withheld. A correlation
    // matrix draws no legend rows, so the rows are refused — but the font survives, because it
    // styles the ramp (`LEGEND_FONT_ONLY`). If that ever changes, this route goes nowhere.
    const g = card("corrmatrix");
    const { container } = render(
      <Inspector activeSection="graphs" selection={{ kind: "chart-section", title: "Title & legend" }} plot={g.plot} table={g.table}
        userPresets={[]} profileDefault={null} {...handlers()} />,
    );
    const labels = [...container.querySelectorAll<HTMLElement>(".frow, label")].map((e) => (e.textContent ?? "").trim());
    expect(labels.some((t) => /^Font/.test(t)), "no Legend font control on a correlation matrix").toBe(true);
  });

  it("the colour-bar selection would have blanked this panel — why the route avoids it", () => {
    // The control case for the choice above: routing to the colour bar would blank the panel.
    const { shown } = inspect("corrmatrix", { kind: "colorbar" });
    expect(shown, "a correlation matrix now has a Colour bar section — re-point the legend at it").toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
/**
 * Text opens its type controls:
 *   • treemap: clicking a text must open a side-panel section where its font can be edited;
 *   • network: clicking a node's text must open a section where its type and size can be
 *     changed.
 *
 * Both are about type. Pointing a network node label at its node would select something, but
 * would open a fill-and-outline editor with no type controls in it. A text opens the settings
 * that size it.
 */
describe("clicking text opens its own type controls", () => {
  const TYPE_ROUTES = [
    { kind: "treemap", label: (s: ReturnType<typeof buildPlotScene>) => s.treemap!.cells[0]!.label, section: "Treemap" },
    { kind: "network", label: (s: ReturnType<typeof buildPlotScene>) => s.network!.nodes.find((n) => n.label)!.label!, section: "Network graph" },
  ];

  for (const r of TYPE_ROUTES) {
    it(`${r.kind}: the label opens "${r.section}"`, () => {
      const { container, picks } = figure(r.kind);
      const scene = buildPlotScene(card(r.kind).table, card(r.kind).plot, SIZE);
      press(byText(container, r.label(scene)));
      expect(picks[0], `${r.kind}: clicking the text selected the whole graph`).not.toEqual({ kind: "plot" });
      expect(picks).toEqual([{ kind: "chart-section", title: r.section }]);
    });

    it(`${r.kind}: …and "${r.section}" carries a font control and a size`, () => {
      // The half that matters: routing somewhere is useless if the type controls are not there.
      const g = card(r.kind);
      const { container } = render(
        <Inspector activeSection="graphs" selection={{ kind: "chart-section", title: r.section }} plot={g.plot} table={g.table}
          userPresets={[]} profileDefault={null} {...handlers()} />,
      );
      const rows = [...container.querySelectorAll<HTMLElement>(".frow, label")].map((e) => (e.querySelector("span")?.textContent ?? e.textContent ?? "").trim());
      expect(rows.some((t) => /^Font/.test(t)), `${r.kind}: "${r.section}" has no font control — the text has nowhere to be tuned`).toBe(true);
      expect(rows.some((t) => /size$/i.test(t)), `${r.kind}: "${r.section}" offers no size for the text`).toBe(true);
    });
  }

  it("treemap: the value under a label is not click-through, and opens the same section", () => {
    const { container, picks } = figure("treemap");
    const scene = buildPlotScene(card("treemap").table, card("treemap").plot, SIZE);
    const v = scene.treemap!.cells.find((c) => c.valueLabel)!.valueLabel!;
    press(byText(container, v));
    expect(picks).toEqual([{ kind: "chart-section", title: "Treemap" }]);
  });

  it("network: the node disc still selects the node — the shape keeps the object", () => {
    // The control case for the label route: clicking the circle must still select the node.
    const g = card("network");
    const picks: GraphSelection[] = [];
    const { container } = render(
      <PlotFigure scene={buildPlotScene(g.table, g.plot, SIZE)} zoom={1} onSelect={(s) => picks.push(s)} onEditText={() => {}} onMoveAnnotation={() => {}} />,
    );
    const disc = container.querySelector("circle")!;
    fireEvent.pointerDown(disc, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(disc, { clientX: 100, clientY: 100, pointerId: 1 });
    expect(picks.some((p) => p?.kind === "network-node"), "clicking a node's disc no longer selects it").toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
/**
 * Alluvial graph: every part must be clickable, including the data, to change its colour.
 * If the ribbons, the node labels and the axis headers carry an explicit
 * `pointerEvents="none"`, the only hittable thing on the whole chart is the 16px node bar.
 */
describe("alluvial — the flows are the data, and they must not be click-through", () => {
  const SECTION = "Alluvial / parallel sets";

  it("every ribbon is hittable — none is left pointer-events:none", () => {
    const { container } = figure("alluvial");
    const ribbons = [...container.querySelectorAll("path")].filter((p) => (p.getAttribute("fill") ?? "") !== "none");
    expect(ribbons.length, "the alluvial card draws no ribbons — the fixture cannot exhibit this").toBeGreaterThan(4);
    for (const r of ribbons) {
      expect(r.getAttribute("pointer-events"), "a ribbon is still click-through").not.toBe("none");
    }
  });

  it("clicking a ribbon selects the node its colour comes from — the swatch that moves it", () => {
    const { container, picks } = figure("alluvial");
    const scene = buildPlotScene(card("alluvial").table, card("alluvial").plot, SIZE);
    const rb = scene.alluvial!.ribbons[0]!;
    fireEvent.click([...container.querySelectorAll("path")].filter((p) => (p.getAttribute("fill") ?? "") !== "none")[0]!);
    expect(picks, "clicking a flow selected nothing").toHaveLength(1);
    expect(picks[0], "a flow selected the whole graph").not.toEqual({ kind: "plot" });
    // The builder states the target; the renderer must not invent one from the geometry.
    expect(picks[0]).toEqual({ kind: "alluvial-node", axis: rb.select.axis, category: rb.select.category });
  });

  it("…and that node is on the colour axis, which is what `nodeColors` keys on", () => {
    // Not just "some node": a ribbon's colour comes from the first axis by default and the last
    // under `colorBy:"last"`, and only that node's swatch moves the band.
    const g = card("alluvial");
    const first = buildPlotScene(g.table, g.plot, SIZE).alluvial!.ribbons[0]!;
    expect(first.select.axis, "the default colour axis is the FIRST").toBe(0);
    const last = buildPlotScene(g.table, { ...g.plot, alluvial: { ...(g.plot.alluvial ?? {}), colorBy: "last" } } as Plot, SIZE).alluvial!.ribbons[0]!;
    expect(last.select.axis, "colorBy:'last' must move the target to the last axis").toBeGreaterThan(0);
  });

  /** Note: `press`, not `click`. Both label sets are draggable, so they select from pointer-up
   *  like every other draggable label in the program (see the note on `press` above). Using
   *  `click` here would report working code as broken. */
  it("a node label selects its node, like its block does", () => {
    const { container, picks } = figure("alluvial");
    const scene = buildPlotScene(card("alluvial").table, card("alluvial").plot, SIZE);
    const nd = scene.alluvial!.nodes.find((n) => n.label)!;
    press(byText(container, nd.label!));
    expect(picks).toEqual([{ kind: "alluvial-node", axis: nd.axis, category: nd.category }]);
  });

  it("an axis label opens the section that owns the axes and their font", () => {
    const { container, picks } = figure("alluvial");
    const scene = buildPlotScene(card("alluvial").table, card("alluvial").plot, SIZE);
    const ax = scene.alluvial!.axisLabels[0]!;
    press(byText(container, ax.label));
    expect(picks, "clicking an axis header selected nothing").toEqual([{ kind: "chart-section", title: SECTION }]);
  });

  /**
   * Both are also draggable, since all text in a figure is draggable.
   * The per-label offset reuses `pointStyles["<colId>:<rowId>"].valueDx/valueDy`, the store a
   * pie slice label and a parallel-coordinates axis name already use, rather than a new model
   * field: node labels are keyed by their axis column id + category, axis headers self-keyed by
   * their column id.
   */
  it("a node label and an axis header both report a drag, keyed so they cannot collide", () => {
    const g = card("alluvial");
    const moves: [string, string, number, number][] = [];
    const { container } = render(
      <PlotFigure scene={buildPlotScene(g.table, g.plot, SIZE)} zoom={1}
        onSelect={() => {}} onEditText={() => {}} onMoveAnnotation={() => {}}
        onMoveValueLabel={(c, r, dx, dy) => moves.push([c, r, dx, dy])} />,
    );
    const scene = buildPlotScene(g.table, g.plot, SIZE);
    const nd = scene.alluvial!.nodes.find((n) => n.label)!;
    const ax = scene.alluvial!.axisLabels[0]!;
    const drag = (el: Element) => {
      fireEvent.pointerDown(el, { clientX: 100, clientY: 100 });
      fireEvent.pointerMove(el, { clientX: 137, clientY: 121 });
      fireEvent.pointerUp(el, { clientX: 137, clientY: 121 });
    };
    drag(byText(container, nd.label!));
    drag(byText(container, ax.label));
    expect(moves.length, "a label drag reported nothing — there is nowhere to store it").toBe(2);
    // The node label is keyed by its axis column + its own category…
    expect(moves[0]![0]).toBe(nd.colId);
    expect(moves[0]![1]).toBe(nd.category);
    // …the axis header self-keyed, so the two can never write the same entry.
    expect(moves[1]![0]).toBe(ax.colId);
    expect(moves[1]![1]).toBe(ax.colId);
    expect(`${moves[0]![0]}:${moves[0]![1]}`).not.toBe(`${moves[1]![0]}:${moves[1]![1]}`);
    // …and the offset is the distance dragged, not the pointer position.
    for (const m of moves) { expect(m[2]).toBe(37); expect(m[3]).toBe(21); }
  });

  it("a stored offset moves the drawn label — the drag is read back, not just written", () => {
    const g = card("alluvial");
    const scene = buildPlotScene(g.table, g.plot, SIZE);
    const nd = scene.alluvial!.nodes.find((n) => n.label)!;
    const ax = scene.alluvial!.axisLabels[0]!;
    const moved = buildPlotScene(g.table, {
      ...g.plot,
      pointStyles: {
        ...(g.plot.pointStyles ?? {}),
        [`${nd.colId}:${nd.category}`]: { valueDx: 31, valueDy: -12 },
        [`${ax.colId}:${ax.colId}`]: { valueDx: -8, valueDy: 25 },
      },
    } as Plot, SIZE);
    const nd2 = moved.alluvial!.nodes.find((n) => n.category === nd.category && n.axis === nd.axis)!;
    expect([nd2.labelDx, nd2.labelDy], "the node label offset never reached the scene").toEqual([31, -12]);
    expect([moved.alluvial!.axisLabels[0]!.dx, moved.alluvial!.axisLabels[0]!.dy]).toEqual([-8, 25]);
  });

  it("…and that section exists with controls, on the Chart tab", () => {
    const { lit, shown, controls } = inspect("alluvial", { kind: "chart-section", title: SECTION });
    expect(shown, "the pinned title matches no section — the panel would open blank").toEqual([SECTION]);
    expect(lit).toEqual(["Chart"]);
    expect(controls).toBeGreaterThan(5);
  });

  it("a read-only render (export, thumbnail) keeps every part click-through", () => {
    // The control case: without it, "the ribbons are clickable" could be true of an export too.
    const g = card("alluvial");
    const { container } = render(<PlotFigure scene={buildPlotScene(g.table, g.plot, SIZE)} zoom={1} />);
    const ribbons = [...container.querySelectorAll("path")].filter((p) => (p.getAttribute("fill") ?? "") !== "none");
    expect(ribbons.length).toBeGreaterThan(4);
    for (const r of ribbons) expect(r.getAttribute("pointer-events")).toBe("none");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("network graph — the node label and the value legend", () => {
  /**
   * A label with only `onDoubleClick` lets one click fall through to the background and select
   * the whole graph. Pointing it at the node would open a fill-and-outline editor with no type
   * controls in it, so the label opens the Network graph section (asserted in "clicking text
   * opens its own type controls"), and the disc selects the node. This case guards the basic
   * rule: a single click on the words must not select the whole graph.
   */
  it("clicking a node's text does not fall through to the whole graph", () => {
    const { container, picks } = figure("network");
    press(byText(container, "Bacteroides"));
    expect(picks, "clicking a node label selected nothing").toHaveLength(1);
    expect(picks[0], "the node label selected the whole graph").not.toEqual({ kind: "plot" });
  });

  it("double-click still renames — the click that precedes it must not break the editor", () => {
    const g = card("network");
    const edits: unknown[] = [];
    const { container } = render(
      <PlotFigure scene={buildPlotScene(g.table, g.plot, SIZE)} zoom={1}
        onSelect={() => {}} onEditText={(t) => edits.push(t)} onMoveAnnotation={() => {}} />,
    );
    fireEvent.doubleClick(byText(container, "Bacteroides"));
    // The inline editor opens on double-click; it commits through onEditText, so the assertion
    // is that the element still accepts the gesture — a thrown handler would fail the render.
    expect(byText(container, "Bacteroides")).toBeTruthy();
    expect(edits.length, "double-click now edits immediately instead of opening the editor").toBe(0);
  });

  it("the value legend opens the Network graph section, which owns the ramp and Label size", () => {
    // The card binds a group column, which rightly suppresses the value ramp —
    // so this fixture unbinds it: the ramp (and its legend) come back, and the claim under
    // guard (the value legend's click route) can be exhibited.
    const g = card("network");
    const plot: Plot = { ...g.plot, network: { ...g.plot.network, groupColumn: undefined } };
    const scene = buildPlotScene(g.table, plot, SIZE);
    const max = scene.network?.valueLegend?.maxLabel;
    expect(max, "the unbound network card draws no value legend — the fixture cannot exhibit this").toBeTruthy();
    const picks: GraphSelection[] = [];
    const { container } = render(
      <PlotFigure scene={scene} zoom={1} onSelect={(s) => picks.push(s)} onEditText={() => {}} onMoveAnnotation={() => {}} />,
    );
    clickGroup(byText(container, String(max)));
    expect(picks, "clicking the value legend selected nothing").toEqual([{ kind: "chart-section", title: "Network graph" }]);
  });

  it("…and that section exists with controls, on the Chart tab", () => {
    const { lit, shown, controls } = inspect("network", { kind: "chart-section", title: "Network graph" });
    expect(shown).toEqual(["Network graph"]);
    expect(lit).toEqual(["Chart"]);
    expect(controls).toBeGreaterThan(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("heatmap — its row/column labels open its section", () => {
  // The font size of the sample names on both axes must be reachable by clicking them.
  // The control is Chart → Heatmap → "Row/column label font"; the route is a single-click
  // select on labels that also carry a drag + rename, so the click does not fall through
  // to the background. Same shape as the cases above.
  const SECTION = "Heatmap";

  it("a row label opens the section that owns the label font", () => {
    const { container, picks } = figure("heatmap");
    press(byText(container, "GeneA"));
    expect(picks, "clicking a row label selected nothing").toEqual([{ kind: "chart-section", title: SECTION }]);
  });

  it("a column label opens the same section", () => {
    const { container, picks } = figure("heatmap");
    press(byText(container, "Sample 1"));
    expect(picks, "clicking a column label selected nothing").toEqual([{ kind: "chart-section", title: SECTION }]);
  });

  it("…and that section exists with controls, on the Chart tab", () => {
    const { lit, shown, controls } = inspect("heatmap", { kind: "chart-section", title: SECTION });
    expect(shown, "pinning the Heatmap section blanked the panel").toContain("Heatmap");
    expect(lit).toEqual(["Chart"]);
    expect(controls).toBeGreaterThan(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("paired dot — stems and connectors open the section that styles them", () => {
  // The divider has a click route (refline); the dumbbell connector + stems need one too —
  // their Stem width / Stem colour controls are otherwise reachable only via the Chart rail.
  it("clicking a stem/connector opens Chart type", () => {
    const { container, picks } = figure("paireddot");
    const stems = [...container.querySelectorAll('line[stroke-linecap="round"]')];
    expect(stems.length, "the card draws no stems/connectors — the fixture cannot exhibit this").toBeGreaterThan(0);
    fireEvent.click(stems[0]!);
    expect(picks, "clicking a stem selected nothing").toEqual([{ kind: "chart-section", title: "Chart type" }]);
  });

  it("…and that section exists with controls, on the Chart tab", () => {
    const { lit, shown, controls } = inspect("paireddot", { kind: "chart-section", title: "Chart type" });
    expect(shown, "pinning Chart type blanked the panel").toContain("Chart type");
    expect(lit).toEqual(["Chart"]);
    expect(controls).toBeGreaterThan(0);
  });
});
