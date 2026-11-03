// @vitest-environment jsdom
/**
 * Per-graph-type control matrix.
 *
 * A data-driven test that exercises the same editable controls + drag affordances across
 * every chart kind, so a control that is silently ignored by one kind's builder/renderer
 * fails loudly (e.g. a bespoke builder ignoring the matched tick font or the axis spacing gap).
 *
 * Each block iterates the shared fixtures in ./plot-fixtures; adding a PlotKind there
 * covers it here automatically (and in `annotation-census.test.tsx`).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { DataTable, Plot, PlotKind } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import { FAM, FIX, buildFor, valAxisOf, type Fx } from "./plot-fixtures";

afterEach(cleanup);

// ============================================================================
// Direct-manipulation contract — the affordances every figure must provide, on
// every kind. Adding a PlotKind to FIX above auto-enrols it. These guard against
// the class of bug where a bespoke figure silently drops an interaction (e.g.
// reserving subtitle space but never drawing the subtitle).
// ============================================================================
describe("direct-manipulation contract — every kind", () => {
  const findTexts = (c: HTMLElement) => [...c.querySelectorAll("text")];
  // 1) A subtitle set on the plot must render (headingPad reserves the space).
  for (const fx of FIX) {
    it(`${fx.kind}: renders its subtitle when one is set`, () => {
      const { container } = render(<PlotFigure scene={buildFor(fx, { subtitle: "SubtitleZZ" })} selected={null} onEditText={() => {}} />);
      const shown = findTexts(container).some((t) => (t.textContent ?? "").includes("SubtitleZZ"));
      expect(shown, `${fx.kind} does not draw its subtitle`).toBe(true);
    });
  }
  // 2) The title must be draggable (cursor:move) and open an inline editor on a single click
  //    and on double-click. Both → an editing
  //    overlay <textarea>/<input> appears.
  for (const fx of FIX) {
    it(`${fx.kind}: title is draggable + single-click editable`, () => {
      const first = render(<PlotFigure scene={buildFor(fx)} selected={null} onMoveTitle={() => {}} onEditText={() => {}} />);
      const title = findTexts(first.container).find((t) => (t.textContent ?? "").includes("Kind Title")) as SVGTextElement | undefined;
      expect(title, `${fx.kind} has no title element`).toBeTruthy();
      expect(title!.style.cursor, `${fx.kind} title is not draggable`).toBe("move");
      // Single click opens the inline editor.
      fireEvent.click(title!);
      expect(first.container.querySelector("textarea, input"), `${fx.kind} title does not open an editor on a single click`).toBeTruthy();
      first.unmount();
      // Double-click still edits too (a fresh render so the click above doesn't mask it).
      const second = render(<PlotFigure scene={buildFor(fx)} selected={null} onMoveTitle={() => {}} onEditText={() => {}} />);
      const title2 = findTexts(second.container).find((t) => (t.textContent ?? "").includes("Kind Title")) as SVGTextElement;
      fireEvent.doubleClick(title2);
      expect(second.container.querySelector("textarea, input"), `${fx.kind} title does not open an editor on double-click`).toBeTruthy();
    });
  }
  // 2b) The subtitle must be draggable independently of the title — not sharing the
  //     title's drag, and not plain <text> that merely follows titleOffset in a bespoke
  //     figure. Checked on every kind, because a gap repeated in every copy looks normal
  //     in any one of them.
  for (const fx of FIX) {
    it(`${fx.kind}: subtitle is draggable on its own`, () => {
      const onMoveSubtitle = vi.fn();
      const onMoveTitle = vi.fn();
      const { container } = render(
        <PlotFigure scene={buildFor(fx, { subtitle: "SubtitleZZ" })} selected={null} onMoveTitle={onMoveTitle} onMoveSubtitle={onMoveSubtitle} onEditText={() => {}} />,
      );
      const sub = findTexts(container).find((t) => (t.textContent ?? "").includes("SubtitleZZ")) as SVGTextElement | undefined;
      expect(sub, `${fx.kind} has no subtitle element`).toBeTruthy();
      expect(sub!.style.cursor, `${fx.kind} subtitle is not draggable`).toBe("move");
      dragEl(sub!);
      expect(onMoveSubtitle, `${fx.kind} subtitle drag does not move the SUBTITLE`).toHaveBeenCalled();
      expect(onMoveTitle, `${fx.kind} subtitle drag moved the TITLE instead of itself`).not.toHaveBeenCalled();
    });
  }
  // 3) A multi-series legend row must select its series (so you can reach + recolour a
  //    series from the legend). Any kind whose fixture yields ≥2 legend entries matching
  //    series names is enrolled automatically.
  for (const fx of FIX) {
    const scene = buildFor(fx);
    const rowMatchesSeries = scene.legend.some((e) => scene.series.some((s) => s.name === e.label));
    if (scene.legend.length < 1 || !rowMatchesSeries) continue;
    it(`${fx.kind}: legend rows select their series`, () => {
      const onSelect = vi.fn();
      const { container } = render(<PlotFigure scene={buildFor(fx)} selected={null} onSelect={onSelect} onMoveLegend={() => {}} />);
      // click every transparent hit-rect (the per-row legend hit-areas); the drag hit-area
      // has no onClick so it's a harmless no-op.
      [...container.querySelectorAll("svg.gfx-figure rect")].filter((r) => r.getAttribute("fill") === "transparent").forEach((r) => fireEvent.click(r));
      expect(onSelect, `${fx.kind} legend rows are not clickable`).toHaveBeenCalledWith(expect.objectContaining({ kind: "series" }));
    });
  }
});

describe("direct-manipulation contract — bespoke data elements are selectable", () => {
  const clickSelectableRects = (container: HTMLElement) =>
    [...container.querySelectorAll("svg.gfx-figure rect")].filter((r) => (r as SVGElement).style.cursor === "pointer").forEach((r) => fireEvent.click(r));
  it("alluvial: clicking a category node selects it (recolourable)", () => {
    const onSelect = vi.fn();
    const { container } = render(<PlotFigure scene={buildFor(FIX.find((f) => f.kind === "alluvial")!)} selected={null} onSelect={onSelect} />);
    clickSelectableRects(container);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ kind: "alluvial-node" }));
  });
  it("heatmap: clicking a cell selects that cell (not the whole plot)", () => {
    const onSelect = vi.fn();
    const { container } = render(<PlotFigure scene={buildFor(FIX.find((f) => f.kind === "heatmap")!)} selected={null} onSelect={onSelect} />);
    clickSelectableRects(container);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ kind: "heatmap-cell" }));
    expect(onSelect).not.toHaveBeenCalledWith({ kind: "plot" });
  });
  it("paireddot: section headings are draggable (they take pointer events)", () => {
    const sectioned: DataTable = {
      id: "tsec", kind: "column", name: "S",
      columns: [
        { id: "t", name: "Trait", role: "x" },
        { id: "d", name: "Domain", role: "y" },
        { id: "a", name: "Twin", role: "y" },
        { id: "b", name: "GWAS", role: "y" },
      ],
      rows: [
        { id: "s1", cells: { t: "Alpha", d: "Cognition", a: 0.4, b: 0.1 } },
        { id: "s2", cells: { t: "Beta", d: "Cognition", a: 0.8, b: 0.2 } },
        { id: "s3", cells: { t: "Gamma", d: "Psychiatric", a: 0.7, b: 0.2 } },
      ],
    };
    const plot: Plot = { id: "p", name: "P", source: "tsec", status: "ok", styleOverrides: {}, kind: "paireddot" };
    const scene = buildPlotScene(sectioned, plot, { width: 520, height: 360 });
    expect(scene.paireddot!.sections.length).toBeGreaterThan(0);
    const onMoveSectionLabel = vi.fn();
    const { container } = render(<PlotFigure scene={scene} selected={null} onMoveSectionLabel={onMoveSectionLabel} />);
    const heading = [...container.querySelectorAll("text")].find((t) => (t.textContent ?? "").includes("Cognition")) as SVGTextElement | undefined;
    expect(heading, "no section heading rendered").toBeTruthy();
    expect(heading!.style.cursor, "section heading is not draggable").toBe("move");
    dragEl(heading!);
    expect(onMoveSectionLabel).toHaveBeenCalledWith("Cognition", expect.any(Number), expect.any(Number));
  });
  it("category groups: the group name drags, selects its axis, and colours its categories' labels", () => {
    const scene = buildFor(FIX.find((f) => f.kind === "bar")!); // the bar fixture carries the group map
    expect(scene.categoryGroups?.length, "no category groups resolved").toBe(2);
    const onMoveCategoryGroupName = vi.fn();
    const onSelect = vi.fn();
    const { container } = render(
      <PlotFigure scene={scene} selected={null} onSelect={onSelect} onMoveCategoryGroupName={onMoveCategoryGroupName} />,
    );
    const name = [...container.querySelectorAll("text")].find((t) => (t.textContent ?? "").includes("First pair")) as SVGTextElement | undefined;
    expect(name, "no group name rendered").toBeTruthy();
    expect(name!.style.cursor, "group name is not draggable").toBe("move");
    dragEl(name!);
    expect(onMoveCategoryGroupName).toHaveBeenCalledWith("x", "First pair", expect.any(Number), expect.any(Number));
    // A click (not a drag) selects the axis that owns the grouping.
    fireEvent.pointerDown(name!);
    fireEvent.pointerUp(name!);
    expect(onSelect).toHaveBeenCalledWith({ kind: "axis", axis: "x" });
    // The fourth channel: the two categories in each group carry that group's colour,
    // and the two groups differ.
    const colorOf = (label: string): string | null => {
      const t = [...container.querySelectorAll("text")].find((e) => (e.textContent ?? "").trim() === label);
      return t?.getAttribute("fill") ?? null;
    };
    expect(colorOf("Alpha")).toBeTruthy();
    expect(colorOf("Alpha")).toBe(colorOf("Beta"));
    expect(colorOf("Gamma")).toBe(colorOf("Delta"));
    expect(colorOf("Alpha")).not.toBe(colorOf("Gamma"));
  });
  it("pcaload: a loading label sits in a draggable group + opens an editor on double-click", () => {
    // jsdom has no getScreenCTM, so the coordinate commit can't be driven here — assert the
    // affordance; the commit math is unit-tested (document.test.ts moveSynthLabel/updateSynthLabel).
    const { container } = render(<PlotFigure scene={buildFor(FIX.find((f) => f.kind === "pcaload")!)} selected={null} onMoveAnnotation={() => {}} onEditText={() => {}} />);
    const lbl = [...container.querySelectorAll("text")].find((t) => (t.getAttribute("data-ann-text") ?? "").startsWith("pca-vlabel-"));
    expect(lbl, "no loading label rendered").toBeTruthy();
    expect((lbl!.parentElement as unknown as SVGGElement).style.cursor, "loading label is not in a draggable group").toBe("move");
    fireEvent.doubleClick(lbl!);
    expect(container.querySelector("textarea, input"), "loading label does not open an editor").toBeTruthy();
  });
  it("survival: an at-risk row selects its KM curve + the table is draggable", () => {
    const scene = buildFor(FIX.find((f) => f.kind === "survival")!, {
      survival: [
        { label: "A", times: [0, 1, 2, 3, 4], surv: [1, 0.8, 0.6, 0.4, 0.2] },
        { label: "B", times: [0, 1, 2, 3, 4], surv: [1, 0.9, 0.7, 0.5, 0.3] },
      ],
      survivalAtRisk: { times: [0, 1, 2, 3, 4], rows: [{ label: "A", atRisk: [20, 15, 10, 6, 2] }, { label: "B", atRisk: [18, 14, 9, 5, 1] }] },
    });
    expect(scene.atRisk, "no at-risk table built").toBeTruthy();
    const onSelect = vi.fn();
    const onMoveColorbar = vi.fn();
    const { container } = render(<PlotFigure scene={scene} selected={null} onSelect={onSelect} onMoveColorbar={onMoveColorbar} />);
    // "18" is unique to row B's counts, so it identifies that row's group.
    const cell = [...container.querySelectorAll("text")].find((t) => t.textContent === "18");
    expect(cell, "no at-risk counts rendered").toBeTruthy();
    const row = cell!.parentElement as unknown as SVGGElement;
    expect(row.style.cursor, "at-risk row is not clickable").toBe("pointer");
    fireEvent.pointerDown(row);
    fireEvent.click(row);
    expect(onSelect).toHaveBeenCalledWith({ kind: "series", columnId: "surv-1" });
    const title = [...container.querySelectorAll("title")].find((t) => /number-at-risk/i.test(t.textContent ?? ""));
    expect(title, "at-risk table is not a draggable group").toBeTruthy();
    dragEl(title!.parentElement as unknown as Element);
    expect(onMoveColorbar).toHaveBeenCalled();
  });
  it("network: clicking a link selects that edge (style it alone or push to all links)", () => {
    const scene = buildFor(FIX.find((f) => f.kind === "network")!);
    expect(scene.network!.edges.length, "no edges built").toBeGreaterThan(0);
    const first = scene.network!.edges[0]!;
    expect(first.id, "edge carries no stable key").toBe(`${first.sourceId}→${first.targetId}`);
    const onSelect = vi.fn();
    const { container } = render(<PlotFigure scene={scene} selected={null} onSelect={onSelect} />);
    const g = [...container.querySelectorAll("[data-edge-id]")].find((el) => el.getAttribute("data-edge-id") === first.id);
    expect(g, "no edge group rendered").toBeTruthy();
    // the drawn link is ~1px, so the clickable target is a fat transparent hit-path
    const hit = [...g!.querySelectorAll("path")].find((p) => p.getAttribute("stroke") === "transparent");
    expect(hit, "link has no hit-path — it is unclickable").toBeTruthy();
    expect((hit as unknown as SVGElement).style.cursor).toBe("pointer");
    fireEvent.click(hit!);
    expect(onSelect).toHaveBeenCalledWith({ kind: "network-edge", edgeId: first.id });
  });
  it("network: per-link overrides beat the shared edge style, and only for that link", () => {
    const fx = FIX.find((f) => f.kind === "network")!;
    const base = buildFor(fx);
    const id = base.network!.edges[0]!.id;
    const scene = buildFor(fx, { network: { edgeColor: "#5b6470", edgeWidth: 1, edgeColors: { [id]: "#ff0055" }, edgeWidths: { [id]: 6 }, edgeOpacities: { [id]: 1 } } });
    const tuned = scene.network!.edges.find((e) => e.id === id)!;
    expect([tuned.color, tuned.width, tuned.opacity]).toEqual(["#ff0055", 6, 1]);
    for (const other of scene.network!.edges.filter((e) => e.id !== id)) {
      expect(other.color, "an untouched link changed colour").toBe("#5b6470");
      expect(other.width, "an untouched link changed width").not.toBe(6);
    }
  });
  for (const kind of ["pcaload", "pcabiplot"] as const) {
    it(`${kind}: a loading arrow selects its vector and offers NO dead move/delete affordance`, () => {
      const scene = buildFor(FIX.find((f) => f.kind === kind)!);
      expect(scene.annotations.some((a) => a.id === "pca-arrow-0"), "no loading arrows built").toBe(true);
      const onSelect = vi.fn();
      const onMoveAnnotation = vi.fn();
      const onDeleteAnnotation = vi.fn();
      const { container } = render(
        <PlotFigure scene={scene} selected={{ kind: "annotation", id: "pca-arrow-0" }} onSelect={onSelect} onMoveAnnotation={onMoveAnnotation} onDeleteAnnotation={onDeleteAnnotation} />,
      );
      const g = container.querySelector('[data-ann-shape="pca-arrow-0"]');
      expect(g, "no arrow group rendered").toBeTruthy();
      // selectable → the per-vector Inspector editor
      fireEvent.click(g!);
      expect(onSelect).toHaveBeenCalledWith({ kind: "annotation", id: "pca-arrow-0" });
      // an arrow's position IS the loading vector: it must not advertise a drag it can't do
      const hit = g!.querySelector("line") as unknown as SVGElement;
      expect(hit.style.cursor, "arrow still advertises a (dead) move cursor").not.toBe("move");
      dragEl(g!.querySelector("line")!);
      expect(onMoveAnnotation, "arrow drag fired a move the document layer refuses").not.toHaveBeenCalled();
      // ...and no p1/p2 resize handles or delete grip while selected
      expect(g!.querySelector("rect"), "selected arrow still shows resize handles").toBeFalsy();
      expect([...g!.querySelectorAll("title")].some((t) => /delete/i.test(t.textContent ?? "")), "selected arrow still shows a delete grip").toBe(false);
    });
  }
  it("parallel: the value colour-scale is draggable and selectable (its title is reachable)", () => {
    // The fixture is value-coloured, so it emits the colour bar directly.
    const scene = buildFor(FIX.find((f) => f.kind === "parallel")!);
    expect(scene.colorbar, "no colorbar built").toBeTruthy();
    const onMoveColorbar = vi.fn();
    const onSelect = vi.fn();
    const { container } = render(<PlotFigure scene={scene} selected={null} onSelect={onSelect} onMoveColorbar={onMoveColorbar} onEditText={() => {}} />);
    const title = [...container.querySelectorAll("title")].find((t) => /colour scale/i.test(t.textContent ?? ""));
    expect(title, "colour scale is not a draggable group").toBeTruthy();
    const group = title!.parentElement as unknown as Element;
    // Click before dragging: DraggableGroup deliberately swallows the click that ends a drag,
    // so a drag-then-click order would test the guard, not the selection.
    // The bar must be selectable as well as draggable, or its title is unreachable (the
    // heatmap's identical bar behaves the same way).
    fireEvent.click(group);
    expect(onSelect, "the colour scale is not clickable — its title stays unreachable").toHaveBeenCalledWith({ kind: "colorbar" });
    dragEl(group);
    expect(onMoveColorbar).toHaveBeenCalled();
    // ...and the title itself opens an inline editor on double-click.
    const heading = [...container.querySelectorAll("text")].find((t) => (t.textContent ?? "").includes("Cond1"));
    expect(heading, "the colour bar draws no title").toBeTruthy();
    fireEvent.doubleClick(heading!);
    expect(container.querySelector("textarea, input"), "the colour-bar title does not open an editor").toBeTruthy();
  });
  it("pcaload: a builder-owned label offers NO delete — but stays movable + renamable", () => {
    // A synth label is regenerated from the analysis every rebuild, so deleting it is
    // meaningless and removeAnnotation refuses it. Offering a × / honouring Delete would
    // therefore be misleading. Its existence comes from the data; its position and wording are editable.
    const onDeleteAnnotation = vi.fn();
    const scene = buildFor(FIX.find((f) => f.kind === "pcaload")!);
    const label = scene.annotations.find((a) => a.id.startsWith("pca-vlabel-"))!;
    expect(label.deletable, "a builder-owned label is not marked non-deletable").toBe(false);
    const { container } = render(
      <PlotFigure scene={scene} selected={{ kind: "annotation", id: label.id }} onSelect={() => {}} onMoveAnnotation={() => {}} onDeleteAnnotation={onDeleteAnnotation} onEditText={() => {}} />,
    );
    const el = [...container.querySelectorAll("text")].find((t) => t.getAttribute("data-ann-text") === label.id);
    expect(el, "no loading label rendered").toBeTruthy();
    // no × grip while selected...
    const grips = [...container.querySelectorAll("title")].filter((t) => /delete/i.test(t.textContent ?? ""));
    expect(grips.length, "a builder-owned label still shows a delete grip").toBe(0);
    // ...and Delete/Backspace is a no-op rather than a silent swallow
    fireEvent.keyDown(window, { key: "Delete" });
    expect(onDeleteAnnotation, "Delete key still fires on a builder-owned label").not.toHaveBeenCalled();
    // but it is still movable + renamable — only its existence is off-limits
    expect((el!.parentElement as unknown as SVGGElement).style.cursor).toBe("move");
    fireEvent.doubleClick(el!);
    expect(container.querySelector("textarea, input"), "a builder-owned label must still rename").toBeTruthy();
  });
  it("a normal annotation is still deletable (the rule targets builder-owned elements only)", () => {
    const onDeleteAnnotation = vi.fn();
    const fx = FIX.find((f) => f.kind === "xy")!;
    const scene = buildFor(fx, { annotations: [{ id: "t1", kind: "text", label: "Note", x: 0.4, y: 0.4 }] });
    const { container } = render(
      <PlotFigure scene={scene} selected={{ kind: "annotation", id: "t1" }} onSelect={() => {}} onMoveAnnotation={() => {}} onDeleteAnnotation={onDeleteAnnotation} onEditText={() => {}} />,
    );
    expect([...container.querySelectorAll("title")].some((t) => /delete/i.test(t.textContent ?? "")), "a user's own text box lost its delete grip").toBe(true);
    fireEvent.keyDown(window, { key: "Delete" });
    expect(onDeleteAnnotation).toHaveBeenCalledWith("t1");
  });
  it("pie: a slice label is editable, not just draggable", () => {
    const onEditText = vi.fn();
    const scene = buildFor(FIX.find((f) => f.kind === "pie")!, { pieLabels: "label" });
    const { container } = render(<PlotFigure scene={scene} selected={null} onMoveValueLabel={() => {}} onEditText={onEditText} onSelect={() => {}} />);
    const sliceId = scene.pie!.slices[0]!.id;
    const label = [...container.querySelectorAll("text")].find((t) => (t.textContent ?? "").includes(scene.pie!.slices[0]!.labelText ?? " "));
    expect(label, "no slice label rendered").toBeTruthy();
    fireEvent.doubleClick(label!);
    const editor = container.querySelector("textarea, input") as HTMLInputElement | null;
    expect(editor, "a slice label opens no editor on double-click").toBeTruthy();
    // it rides the per-point override the drag already uses → keyed "<slice>:<slice>"
    fireEvent.change(editor!, { target: { value: "Renamed" } });
    fireEvent.blur(editor!);
    expect(onEditText).toHaveBeenCalledWith({ kind: "value", columnId: sliceId, rowId: sliceId }, "Renamed");
  });
  it("lollipop: the Δ% label is editable, not just draggable", () => {
    // Δ needs a dumbbell (two dots) to have a from→to change to report.
    const scene = buildFor(FIX.find((f) => f.kind === "lollipop")!, { lollipop: { showDelta: true } });
    const row = scene.lollipop!.rows.find((r) => r.delta);
    expect(row, "no Δ label built").toBeTruthy();
    const onEditText = vi.fn();
    const { container } = render(<PlotFigure scene={scene} selected={null} onMoveValueLabel={() => {}} onEditText={onEditText} />);
    const label = [...container.querySelectorAll("text")].find((t) => (t.textContent ?? "") === row!.delta!.text);
    expect(label, "no Δ label rendered").toBeTruthy();
    fireEvent.doubleClick(label!);
    const editor = container.querySelector("textarea, input") as HTMLInputElement | null;
    expect(editor, "the Δ label opens no editor on double-click").toBeTruthy();
    fireEvent.change(editor!, { target: { value: "+12% YoY" } });
    fireEvent.blur(editor!);
    expect(onEditText).toHaveBeenCalledWith({ kind: "value", columnId: "__delta__", rowId: row!.rowId }, "+12% YoY");
  });
  it("parallel: clicking a data line selects that row (per-line recolour)", () => {
    const scene = buildFor(FIX.find((f) => f.kind === "parallel")!);
    expect(scene.parallel!.lines.length, "no data lines built").toBeGreaterThan(0);
    const rowId = scene.parallel!.lines[0]!.id;
    const onSelect = vi.fn();
    const { container } = render(<PlotFigure scene={scene} selected={null} onSelect={onSelect} />);
    const g = [...container.querySelectorAll("[data-line-id]")].find((el) => el.getAttribute("data-line-id") === rowId);
    expect(g, "no line group rendered").toBeTruthy();
    // a ~1px polyline needs a fat transparent hit-path, like the network links
    const hit = [...g!.querySelectorAll("path")].find((p) => p.getAttribute("stroke") === "transparent");
    expect(hit, "the line has no hit-path — it is unclickable").toBeTruthy();
    expect((hit as unknown as SVGElement).style.cursor).toBe("pointer");
    fireEvent.click(hit!);
    expect(onSelect).toHaveBeenCalledWith({ kind: "parallel-line", rowId });
  });
});
const carriers = (c: HTMLElement): Element[] =>
  [...c.querySelectorAll("text, g")].filter((e) => e.getAttribute("font-family") === FAM && (e.textContent ?? "").trim().length > 0);

// ===========================================================================
describe("matrix — every kind honours the title font", () => {
  for (const fx of FIX) {
    it(`${fx.kind}: title font-family reaches the rendered title`, () => {
      const { container } = render(<PlotFigure scene={buildFor(fx, { fonts: { title: { family: FAM } } })} selected={null} />);
      expect(carriers(container).length).toBeGreaterThanOrEqual(1);
    });
  }
});

describe("matrix — label fonts reach every kind's tick / slice labels", () => {
  for (const fx of FIX) {
    for (const role of fx.fontRoles) {
      it(`${fx.kind}: fonts.${role}.family reaches its labels`, () => {
        // Only the label role's family is set (title stays default), so any carrier proves the
        // label text picked it up — the exact check that catches "renderer ignores fonts.${role}".
        const { container } = render(<PlotFigure scene={buildFor(fx, { fonts: { [role]: { family: FAM } } })} selected={null} />);
        expect(carriers(container).length).toBeGreaterThanOrEqual(1);
      });
    }
  }
});

// The bubble size legend: maxRadius grows the largest plotted mark and sizeLegendScale
// scales the legend spheres. The legend's use of the 'legend' font is covered by the
// label-fonts loop (bubble lists "legend").
describe("matrix — bubble maxRadius + size-legend scale", () => {
  const bubbleFx = FIX.find((f) => f.kind === "bubble")!;
  it("maxRadius enlarges the biggest plotted bubble", () => {
    const small = buildFor(bubbleFx, { bubble: { maxRadius: 10 } });
    const big = buildFor(bubbleFx, { bubble: { maxRadius: 40 } });
    const maxSym = (s: ReturnType<typeof buildPlotScene>): number =>
      Math.max(...s.series.flatMap((se) => se.marks.map((m) => m.symbolSize ?? 0)));
    expect(maxSym(big)).toBeGreaterThan(maxSym(small));
  });
  it("sizeLegendScale scales the legend spheres", () => {
    const base = buildFor(bubbleFx, { bubble: { sizeLegendScale: 1 } });
    const scaled = buildFor(bubbleFx, { bubble: { sizeLegendScale: 3 } });
    const maxR = (s: ReturnType<typeof buildPlotScene>): number =>
      Math.max(...(s.bubbleLegend?.items.map((i) => i.radius) ?? [0]));
    expect(base.bubbleLegend).toBeTruthy();
    expect(maxR(scaled)).toBeGreaterThan(maxR(base));
  });
});

// The histogram's bins/binWidth/freq controls and the per-bar width-resize affordance,
// which the shared histogram fixture does not reach.
describe("matrix — histogram bins / binWidth / freq + width affordance", () => {
  const data: DataTable = {
    id: "th", kind: "xy", name: "H",
    columns: [{ id: "x", name: "X", role: "x" }, { id: "v", name: "V", role: "y" }],
    rows: Array.from({ length: 20 }, (_, i) => ({ id: `r${i}`, cells: { x: i, v: i } })),
  };
  const hist = (extra: Partial<Plot> = {}): ReturnType<typeof buildPlotScene> => {
    const plot: Plot = { id: "p", name: "P", source: "th", status: "ok", styleOverrides: {}, kind: "histogram", ...extra };
    return buildPlotScene(data, plot, { width: 520, height: 360 });
  };
  const barCount = (s: ReturnType<typeof buildPlotScene>): number =>
    s.series.flatMap((se) => se.marks.filter((m) => m.bar)).length;

  it("an explicit bin count sets the number of bars", () => {
    expect(barCount(hist({ histogram: { bins: 4 } }))).toBe(4);
    expect(barCount(hist({ histogram: { bins: 8 } }))).toBe(8);
  });
  it("binWidth changes the number of bars (wider bins → fewer bars)", () => {
    expect(barCount(hist({ histogram: { binWidth: 10 } }))).toBeLessThan(barCount(hist({ histogram: { binWidth: 2 } })));
  });
  it("freq='percent' relabels the value axis and rescales it off raw counts", () => {
    const cnt = hist({ histogram: { bins: 4, freq: "count" } });
    const pct = hist({ histogram: { bins: 4, freq: "percent" } });
    expect(cnt.axisLabels.y).toBe("Count");
    expect(pct.axisLabels.y).toMatch(/percent/i);
    expect(pct.y.domain[1]).not.toBe(cnt.y.domain[1]);
  });
  it("renders ew-resize width edge handles when onWidthResize is wired", () => {
    const { container } = render(<PlotFigure scene={hist({ histogram: { bins: 5 } })} onWidthResize={() => {}} selected={null} />);
    const handles = [...container.querySelectorAll("rect")].filter((r) => (r.getAttribute("style") ?? "").includes("ew-resize"));
    expect(handles.length).toBeGreaterThanOrEqual(1);
  });
});

// The parallel plot's direct-manipulation gestures (axis brush + label
// reorder). The gesture commit needs getScreenCTM (null in jsdom, no DOMMatrix
// / DOMPoint) — so, like the width-resize and annotation drags, this asserts the interactive
// affordance renders: a per-axis brush hit-target (ns-resize) + grab-cursor variable labels,
// only when onParallelEdit is wired.
describe("matrix — parallel direct-manipulation affordance", () => {
  const parallelFx = FIX.find((f) => f.kind === "parallel")!;
  const withStyle = (c: HTMLElement, tag: string, css: string): Element[] =>
    [...c.querySelectorAll(tag)].filter((e) => (e.getAttribute("style") ?? "").includes(css));

  it("interactive mode renders per-axis brush hit-targets + grab-cursor labels", () => {
    const { container } = render(<PlotFigure scene={buildFor(parallelFx)} selected={null} onParallelEdit={() => {}} />);
    expect(withStyle(container, "rect", "ns-resize").length).toBeGreaterThanOrEqual(1); // brush hit-targets
    expect(withStyle(container, "text", "grab").length).toBeGreaterThanOrEqual(1); // draggable variable labels
  });
  it("without onParallelEdit there are no interactive brush hit-targets (read-only)", () => {
    const { container } = render(<PlotFigure scene={buildFor(parallelFx)} selected={null} />);
    expect(withStyle(container, "rect", "ns-resize").length).toBe(0);
  });
});

describe("matrix — axis-bearing kinds honour the Spacing (tickLabelGap) options", () => {
  for (const fx of FIX.filter((f) => f.axisBearing)) {
    it(`${fx.kind}: yAxis label↔axis gap widens the left margin`, () => {
      const base = buildFor(fx);
      const wide = buildFor(fx, { yAxis: { tickLabelGap: 44 } });
      expect(wide.plot.x).toBeGreaterThan(base.plot.x + 20);
    });
    it(`${fx.kind}: xAxis label↔axis gap grows the bottom margin`, () => {
      const base = buildFor(fx);
      const wide = buildFor(fx, { xAxis: { tickLabelGap: 44 } });
      expect(wide.plot.height).toBeLessThan(base.plot.height - 20);
    });
  }
});

describe("matrix — every kind paints the figure background", () => {
  for (const fx of FIX) {
    it(`${fx.kind}: a background colour renders a backing rect`, () => {
      const { container } = render(<PlotFigure scene={buildFor(fx, { background: "#abcdef" })} selected={null} />);
      expect(container.querySelectorAll('rect[fill="#abcdef"]').length).toBeGreaterThanOrEqual(1);
    });
  }
});

describe("matrix — every kind's title is draggable", () => {
  for (const fx of FIX) {
    it(`${fx.kind}: pressing + dragging the title fires onMoveTitle`, () => {
      const onMoveTitle = vi.fn();
      const { container } = render(<PlotFigure scene={buildFor(fx, { title: "DragMe" })} selected={null} onMoveTitle={onMoveTitle} onEditText={() => {}} />);
      const t = [...container.querySelectorAll("text")].find((e) => /DragMe/.test(e.textContent ?? ""));
      expect(t, `${fx.kind} has no title text`).toBeTruthy();
      fireEvent.pointerDown(t!, { clientX: 100, clientY: 20, pointerId: 1 });
      fireEvent.pointerMove(t!, { clientX: 150, clientY: 46, pointerId: 1 });
      fireEvent.pointerUp(t!, { clientX: 150, clientY: 46, pointerId: 1 });
      expect(onMoveTitle).toHaveBeenCalled();
    });
  }
});

describe("matrix — whole-figure resize grips render where supported", () => {
  for (const fx of FIX.filter((f) => f.figResize)) {
    it(`${fx.kind}: exposes .gfx-figresize handles`, () => {
      const { container } = render(<PlotFigure scene={buildFor(fx)} selected={null} onFigureResize={() => {}} />);
      expect(container.querySelector(".gfx-figresize")).toBeTruthy();
    });
  }
});

// ---- axis line colour + further drag affordances ----
const dragEl = (el: Element): void => {
  fireEvent.pointerDown(el, { clientX: 120, clientY: 120, button: 0, pointerId: 1 });
  fireEvent.pointerMove(el, { clientX: 170, clientY: 150, pointerId: 1 });
  fireEvent.pointerUp(el, { clientX: 170, clientY: 150, pointerId: 1 });
};
const findText = (c: HTMLElement, re: RegExp): Element | undefined =>
  [...c.querySelectorAll("text")].find((e) => re.test(e.textContent ?? ""));

describe("matrix — axis-bearing kinds honour the axis line colour", () => {
  for (const fx of FIX.filter((f) => f.axisBearing)) {
    it(`${fx.kind}: xAxis/yAxis lineColor strokes the axis line`, () => {
      const { container } = render(<PlotFigure scene={buildFor(fx, { frame: "box", xAxis: { lineColor: "#ff00ee" }, yAxis: { lineColor: "#ff00ee" } })} selected={null} />);
      const has = [...container.querySelectorAll("line")].some((l) => (l.getAttribute("stroke") ?? "").toLowerCase() === "#ff00ee");
      expect(has).toBe(true);
    });
  }
});

describe("matrix — axis titles are draggable where the kind renders them", () => {
  // scatter3d is excluded from drag on purpose: its 3 axis labels are camera-projected (they
  // orbit with the view), so a fixed 2-D drag offset makes no sense — you reposition them by
  // orbiting the camera. They are double-click editable, though (asserted in the 3-D block below).
  for (const fx of FIX.filter((f) => f.axisBearing)) {
    it(`${fx.kind}: dragging an axis title fires onMoveAxisTitle`, () => {
      const onMoveAxisTitle = vi.fn();
      const { container } = render(<PlotFigure scene={buildFor(fx, { xAxis: { title: "XAXT" }, yAxis: { title: "YAXT" } })} selected={null} onMoveAxisTitle={onMoveAxisTitle} onEditText={() => {}} />);
      const t = findText(container, /XAXT|YAXT/);
      expect(t, `${fx.kind} renders no draggable axis title`).toBeTruthy();
      dragEl(t!);
      expect(onMoveAxisTitle).toHaveBeenCalled();
    });
  }
});

describe("matrix — per-point value / slice / spoke labels are draggable", () => {
  // The draggable data label is the DraggableTitle with cursor:move (onMove wired to
  // onMoveValueLabel). Targeting by cursor avoids matching a same-looking axis tick number.
  const cases: { kind: PlotKind; extra?: Partial<Plot> }[] = [
    { kind: "pie" }, // slice labels (fixture already sets pieLabels)
    { kind: "radar" }, // spoke labels
    { kind: "lollipop", extra: { lollipop: { showValues: true } } }, // per-dot value labels
    { kind: "bar", extra: { showValues: true } }, // per-bar value labels
    { kind: "treemap" }, // per-cell labels (showLabels defaults true)
  ];
  for (const c of cases) {
    it(`${c.kind}: dragging a data label fires onMoveValueLabel`, () => {
      const fx = FIX.find((f) => f.kind === c.kind)!;
      const onMoveValueLabel = vi.fn();
      const { container } = render(<PlotFigure scene={buildFor(fx, c.extra ?? {})} selected={null} onMoveValueLabel={onMoveValueLabel} onEditText={() => {}} />);
      const t = [...container.querySelectorAll("text")].find((e) => (e as unknown as HTMLElement).style.cursor === "move");
      expect(t, `${c.kind} renders no draggable data label`).toBeTruthy();
      dragEl(t!);
      expect(onMoveValueLabel).toHaveBeenCalled();
    });
  }
});

describe("matrix — heatmap colour-bar + row/column labels are draggable", () => {
  const fx = FIX.find((f) => f.kind === "heatmap")!;
  it("dragging a column label fires onMoveHeatmapLabels", () => {
    const onMoveHeatmapLabels = vi.fn();
    const { container } = render(<PlotFigure scene={buildFor(fx)} selected={null} onMoveHeatmapLabels={onMoveHeatmapLabels} onEditText={() => {}} />);
    const t = findText(container, /Cond1|Cond2|G1|G2/);
    expect(t).toBeTruthy();
    dragEl(t!);
    expect(onMoveHeatmapLabels).toHaveBeenCalled();
  });
});

describe("matrix — Voronoi treemap draws cells + selects the plot", () => {
  const fx = FIX.find((f) => f.kind === "treemap")!;
  it("renders one filled polygon per (non-degenerate) cell", () => {
    const scene = buildFor(fx);
    const { container } = render(<PlotFigure scene={scene} selected={null} onSelect={() => {}} />);
    const polys = container.querySelectorAll("svg.gfx-figure polygon");
    const drawn = scene.treemap!.cells.filter((c) => c.points.length >= 3).length;
    expect(drawn).toBeGreaterThanOrEqual(3);
    expect(polys.length).toBe(drawn);
  });
  it("clicking the figure background selects the whole plot", () => {
    const onSelect = vi.fn();
    const { container } = render(<PlotFigure scene={buildFor(fx)} selected={null} onSelect={onSelect} />);
    fireEvent.click(container.querySelector("svg.gfx-figure")!);
    expect(onSelect).toHaveBeenCalledWith({ kind: "plot" });
  });
  it("clicking a cell selects that treemap-cell (for per-cell recolour)", () => {
    const onSelect = vi.fn();
    const { container } = render(<PlotFigure scene={buildFor(fx)} selected={null} onSelect={onSelect} />);
    fireEvent.click(container.querySelector("svg.gfx-figure polygon")!);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ kind: "treemap-cell" }));
  });
  it("the selected cell draws a dashed accent overlay", () => {
    const scene = buildFor(fx);
    const cellId = scene.treemap!.cells[0]!.id;
    const { container } = render(<PlotFigure scene={scene} selected={{ kind: "treemap-cell", cellId }} onSelect={() => {}} />);
    const dashed = [...container.querySelectorAll("svg.gfx-figure polygon")].filter((p) => p.getAttribute("stroke-dasharray"));
    expect(dashed.length).toBe(1);
  });
  it("dragging a region heading fires onMoveTreemapRegionLabel with the group key", () => {
    const grouped: DataTable = {
      id: "tgm", kind: "partsofwhole", name: "G",
      columns: [{ id: "s", name: "State" }, { id: "v", name: "V" }, { id: "reg", name: "Region" }],
      rows: [
        { id: "r1", cells: { s: "CA", v: 40, reg: "West" } },
        { id: "r2", cells: { s: "WA", v: 10, reg: "West" } },
        { id: "r3", cells: { s: "NY", v: 30, reg: "East" } },
        { id: "r4", cells: { s: "MA", v: 8, reg: "East" } },
      ],
    };
    const gplot: Plot = { id: "p", name: "P", source: "tgm", status: "ok", styleOverrides: {}, kind: "treemap", treemap: { groupColumn: "reg", showGroupLabels: true } };
    const scene = buildPlotScene(grouped, gplot, { width: 500, height: 400 });
    const onMoveTreemapRegionLabel = vi.fn();
    const { container } = render(<PlotFigure scene={scene} selected={null} onMoveTreemapRegionLabel={onMoveTreemapRegionLabel} />);
    const label = findText(container, /^WEST$/);
    expect(label, "no WEST region heading rendered").toBeTruthy();
    dragEl(label!);
    expect(onMoveTreemapRegionLabel).toHaveBeenCalledWith("West", expect.any(Number), expect.any(Number));
  });
});

describe("matrix — parallel coordinates draws axes + one line per row", () => {
  const fx = FIX.find((f) => f.kind === "parallel")!;
  it("renders a vertical axis per variable and a path per data row", () => {
    const scene = buildFor(fx);
    const { container } = render(<PlotFigure scene={scene} selected={null} onSelect={() => {}} />);
    const svg = container.querySelector("svg.gfx-figure")!;
    expect(scene.parallel!.axes.length).toBeGreaterThanOrEqual(2);
    expect(svg.querySelectorAll("line").length).toBeGreaterThanOrEqual(scene.parallel!.axes.length);
    const paths = [...svg.querySelectorAll("path")].filter((p) => (p.getAttribute("d") || "").startsWith("M"));
    expect(scene.parallel!.lines.length).toBeGreaterThan(0);
    expect(paths.length).toBeGreaterThanOrEqual(scene.parallel!.lines.length);
  });
  it("clicking the figure selects the whole plot", () => {
    const onSelect = vi.fn();
    const { container } = render(<PlotFigure scene={buildFor(fx)} selected={null} onSelect={onSelect} />);
    fireEvent.click(container.querySelector("svg.gfx-figure")!);
    expect(onSelect).toHaveBeenCalledWith({ kind: "plot" });
  });
});

describe("matrix — correlation matrix draws pie glyphs + a scale legend", () => {
  const fx = FIX.find((f) => f.kind === "corrmatrix")!;
  it("draws a lower-triangular grid of glyph paths over the columns' pairwise r", () => {
    const scene = buildFor(fx);
    const cm = scene.corrmatrix!;
    // lower triangle + diagonal of an n×n matrix = n(n+1)/2 cells
    const n = Math.max(...cm.cells.map((c) => c.row)) + 1;
    expect(n).toBeGreaterThanOrEqual(2);
    expect(cm.cells.length).toBe((n * (n + 1)) / 2);
    const { container } = render(<PlotFigure scene={scene} selected={null} onSelect={() => {}} />);
    const svg = container.querySelector("svg.gfx-figure")!;
    const drawn = cm.cells.filter((c) => c.glyphPath !== "").length; // cells with a defined r
    expect(drawn).toBeGreaterThan(0);
    const paths = [...svg.querySelectorAll("path")].filter((p) => (p.getAttribute("d") || "").length > 0);
    expect(paths.length).toBeGreaterThanOrEqual(drawn);
  });
  it("every glyph mode (pie/circle/ellipse/square/number) produces drawable cells", () => {
    for (const glyph of ["pie", "circle", "ellipse", "square", "number"] as const) {
      const scene = buildFor(fx, { corrmatrix: { glyph } });
      const cm = scene.corrmatrix!;
      if (glyph === "number") {
        // number mode draws value labels, not glyph paths
        expect(cm.cells.some((c) => c.label !== "")).toBe(true);
      } else {
        expect(cm.cells.filter((c) => c.glyphPath !== "").length, glyph).toBeGreaterThan(0);
      }
    }
  });
  it("renders the pie-glyph correlation-scale legend", () => {
    const scene = buildFor(fx);
    expect(scene.corrmatrix!.scaleLegend?.items.length).toBeGreaterThan(0);
    const { container } = render(<PlotFigure scene={scene} selected={null} onSelect={() => {}} />);
    expect(container.textContent).toContain("Correlation"); // the legend title
  });
  it("clicking the figure selects the whole plot", () => {
    const onSelect = vi.fn();
    const { container } = render(<PlotFigure scene={buildFor(fx)} selected={null} onSelect={onSelect} />);
    fireEvent.click(container.querySelector("svg.gfx-figure")!);
    expect(onSelect).toHaveBeenCalledWith({ kind: "plot" });
  });

  // Row/col labels draggable + double-click editable, and the scale legend draggable.
  it("the builder emits per-label drag offsets + a legend offset from the corrmatrix style", () => {
    const s = buildFor(fx, { corrmatrix: { colLabelOffsets: { "1": { dx: 7, dy: -3 } }, rowLabelOffsets: { "0": { dx: 2, dy: 4 } }, legendOffset: { dx: 5, dy: 6 } } });
    const cm = s.corrmatrix!;
    expect(cm.colLabels[1]).toMatchObject({ dx: 7, dy: -3 });
    expect(cm.rowLabels[0]).toMatchObject({ dx: 2, dy: 4 });
    expect(cm.scaleLegend?.offset).toEqual({ dx: 5, dy: 6 });
  });
  it("dragging a variable label fires onMoveCorrLabels", () => {
    const onMoveCorrLabels = vi.fn();
    const { container } = render(<PlotFigure scene={buildFor(fx)} selected={null} onMoveCorrLabels={onMoveCorrLabels} onEditText={() => {}} />);
    const t = findText(container, /Cond1|Cond2|Cond3/);
    expect(t, "no draggable corrmatrix variable label").toBeTruthy();
    dragEl(t!);
    expect(onMoveCorrLabels).toHaveBeenCalled();
  });
  it("double-clicking a variable label opens the editor → onEditText(corr*Label)", () => {
    const onEditText = vi.fn();
    const { container } = render(<PlotFigure scene={buildFor(fx)} selected={null} onEditText={onEditText} onMoveCorrLabels={() => {}} />);
    const t = findText(container, /Cond1|Cond2|Cond3/);
    fireEvent.doubleClick(t!);
    const box = (container.querySelector("textarea, input[type=text]") ?? document.querySelector("textarea, input[type=text]")) as HTMLElement | null;
    expect(box, "no inline editor opened").toBeTruthy();
    fireEvent.change(box!, { target: { value: "Renamed" } });
    fireEvent.blur(box!);
    expect(onEditText).toHaveBeenCalledWith(expect.objectContaining({ kind: expect.stringMatching(/^corr(Col|Row)Label$/) }), "Renamed");
  });
  it("dragging the correlation-scale legend fires onMoveCorrLegend", () => {
    const onMoveCorrLegend = vi.fn();
    const { container } = render(<PlotFigure scene={buildFor(fx)} selected={null} onMoveCorrLegend={onMoveCorrLegend} />);
    const title = findText(container, /^Correlation$/);
    expect(title, "no legend title").toBeTruthy();
    dragEl(title!.parentElement as unknown as Element); // the DraggableGroup <g>
    expect(onMoveCorrLegend).toHaveBeenCalled();
  });
});

describe("matrix — network nodes are selectable + draggable", () => {
  const fx = FIX.find((f) => f.kind === "network")!;
  it("clicking a node selects that network-node (for per-node recolour)", () => {
    const onSelect = vi.fn();
    const { container } = render(<PlotFigure scene={buildFor(fx)} selected={null} onSelect={onSelect} onMoveNetworkNode={() => {}} />);
    const circle = container.querySelector("svg.gfx-figure circle")!;
    fireEvent.pointerDown(circle, { clientX: 100, clientY: 100, button: 0, pointerId: 1 });
    fireEvent.pointerUp(circle, { clientX: 100, clientY: 100, pointerId: 1 });
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ kind: "network-node" }));
  });
  it("dragging a node fires onMoveNetworkNode with fractional coords", () => {
    const onMoveNetworkNode = vi.fn();
    const { container } = render(<PlotFigure scene={buildFor(fx)} selected={null} onMoveNetworkNode={onMoveNetworkNode} />);
    const circle = container.querySelector("svg.gfx-figure circle")!;
    fireEvent.pointerDown(circle, { clientX: 100, clientY: 100, button: 0, pointerId: 1 });
    fireEvent.pointerMove(circle, { clientX: 155, clientY: 128, pointerId: 1 });
    fireEvent.pointerUp(circle, { clientX: 155, clientY: 128, pointerId: 1 });
    expect(onMoveNetworkNode).toHaveBeenCalledWith(expect.any(String), expect.any(Number), expect.any(Number));
  });
  it("a selected node draws a dashed accent ring", () => {
    const scene = buildFor(fx);
    const nodeId = scene.network!.nodes[0]!.id;
    const { container } = render(<PlotFigure scene={scene} selected={{ kind: "network-node", nodeId }} onSelect={() => {}} />);
    const dashed = [...container.querySelectorAll("svg.gfx-figure circle")].filter((c) => c.getAttribute("stroke-dasharray"));
    expect(dashed.length).toBe(1);
  });
});

describe("matrix — alluvial draws ribbons + category nodes", () => {
  const flowTable: DataTable = {
    id: "tf", kind: "multivariable", name: "Flows",
    columns: [
      { id: "a", name: "Channel" },
      { id: "b", name: "Segment" },
      { id: "c", name: "Outcome" },
    ],
    rows: [
      { id: "r1", cells: { a: "Online", b: "New", c: "Bought" } },
      { id: "r2", cells: { a: "Online", b: "New", c: "Left" } },
      { id: "r3", cells: { a: "Store", b: "Returning", c: "Bought" } },
      { id: "r4", cells: { a: "Store", b: "New", c: "Bought" } },
      { id: "r5", cells: { a: "Online", b: "Returning", c: "Left" } },
    ],
  };
  const plot: Plot = { id: "p", name: "P", source: "tf", status: "ok", styleOverrides: {}, kind: "alluvial", title: "Flow" };

  it("builds a node per (axis, category) + a ribbon per flow-junction", () => {
    const scene = buildPlotScene(flowTable, plot, { width: 520, height: 340 });
    const al = scene.alluvial!;
    expect(scene.kind).toBe("alluvial");
    // 3 axes; each node's per-axis heights sum to the plot height area (rows conserved).
    expect(al.axisLabels.map((a) => a.label)).toEqual(["Channel", "Segment", "Outcome"]);
    expect(al.nodes.length).toBeGreaterThanOrEqual(6); // ≥2 categories on each of 3 axes
    expect(al.ribbons.length).toBeGreaterThan(0);
    expect(scene.warnings).toEqual([]);
    const { container } = render(<PlotFigure scene={scene} selected={null} onSelect={() => {}} />);
    const svg = container.querySelector("svg.gfx-figure")!;
    const ribbonPaths = [...svg.querySelectorAll("path")].filter((p) => (p.getAttribute("d") || "").startsWith("M"));
    expect(ribbonPaths.length).toBeGreaterThanOrEqual(al.ribbons.length);
    expect(svg.querySelectorAll("rect").length).toBeGreaterThanOrEqual(al.nodes.length); // one rect per node
  });
  it("clicking the figure selects the whole plot", () => {
    const onSelect = vi.fn();
    const { container } = render(<PlotFigure scene={buildPlotScene(flowTable, plot, { width: 520, height: 340 })} selected={null} onSelect={onSelect} />);
    fireEvent.click(container.querySelector("svg.gfx-figure")!);
    expect(onSelect).toHaveBeenCalledWith({ kind: "plot" });
  });
});

describe("matrix — 3-D scatter camera orbits on drag", () => {
  const fx = FIX.find((f) => f.kind === "scatter3d")!;
  it("dragging the plot fires onCamera3D", () => {
    const onCamera3D = vi.fn();
    const { container } = render(<PlotFigure scene={buildFor(fx)} selected={null} onCamera3D={onCamera3D} />);
    const svg = container.querySelector("svg.gfx-figure")!;
    fireEvent.pointerDown(svg, { clientX: 200, clientY: 200, button: 0, pointerId: 1 });
    fireEvent.pointerMove(svg, { clientX: 250, clientY: 230, pointerId: 1 });
    fireEvent.pointerUp(svg, { clientX: 250, clientY: 230, pointerId: 1 });
    expect(onCamera3D).toHaveBeenCalled();
  });

  it("double-clicking an axis label (X/Y/Z) opens an inline editor that commits via onEditText", () => {
    const onEditText = vi.fn();
    const { container } = render(
      <PlotFigure scene={buildFor(fx, { xAxis: { title: "XL" }, yAxis: { title: "YL" }, scatter3d: { zTitle: "ZL" } })} selected={null} onEditText={onEditText} />,
    );
    const lbl = [...container.querySelectorAll("text")].find((t) => /^(XL|YL|ZL)$/.test(t.textContent ?? ""));
    expect(lbl, "no editable 3-D axis label rendered").toBeTruthy();
    fireEvent.doubleClick(lbl!);
    const ed = openEditor(container);
    expect(ed, "double-click did not open an inline editor").toBeTruthy();
    fireEvent.change(ed!, { target: { value: "Renamed" } });
    fireEvent.blur(ed!);
    expect(onEditText).toHaveBeenCalled();
  });
});

describe("matrix — axis-bearing kinds honour majorStep (tick interval)", () => {
  // The non-minor tick values on both axes; a builder that honours majorStep produces a
  // different set than the auto ticks. (A step of 0.5 stays ≥2 ticks on every fixture domain,
  // so it can't be rejected as "too coarse" — it purely proves the spec reaches buildScale.)
  const tickKey = (s: ReturnType<typeof buildPlotScene>): string =>
    [...s.x.ticks, ...s.y.ticks].filter((t) => !t.minor).map((t) => Math.round(t.value * 100) / 100).join(",");
  for (const fx of FIX.filter((f) => f.axisBearing)) {
    it(`${fx.kind}: setting majorStep changes the value-axis ticks`, () => {
      const base = tickKey(buildFor(fx));
      // 0.7 is deliberately non-"nice" — auto ticks never land on 0.7 multiples, so any change
      // here can only come from the builder passing majorStep through to buildScale.
      const stepped = tickKey(buildFor(fx, { xAxis: { majorStep: 0.7 }, yAxis: { majorStep: 0.7 } }));
      expect(stepped).not.toBe(base);
    });
  }
});

describe("matrix — axis-bearing kinds honour hideTicks", () => {
  for (const fx of FIX.filter((f) => f.axisBearing)) {
    it(`${fx.kind}: hideTicks removes tick marks from both axes in the scene`, () => {
      const s = buildFor(fx, { xAxis: { hideTicks: true }, yAxis: { hideTicks: true } });
      // the resolved scene carries the flag on each axis (the renderer suppresses the marks).
      expect(s.x.hideTicks === true || s.x.ticks.every((t) => t.minor)).toBeTruthy();
      expect(s.y.hideTicks === true || s.y.ticks.every((t) => t.minor)).toBeTruthy();
    });
  }
});

// ===========================================================================
// Manual range · reversed · log scale · gridlines.
// Each targets the kind's continuous value axis (Y for vertical charts, X for
// ridgeline) — the place where a bespoke builder can fail to thread the
// axis spec through buildScale.
// ===========================================================================

describe("matrix — axis-bearing kinds honour a manual value-axis range (min/max)", () => {
  for (const fx of FIX.filter((f) => f.axisBearing)) {
    const ax = valAxisOf(fx);
    it(`${fx.kind}: ${ax}Axis {min:-5,max:40} pins the reported domain`, () => {
      const s = buildFor(fx, ax === "x" ? { xAxis: { min: -5, max: 40 } } : { yAxis: { min: -5, max: 40 } });
      const lo = Math.min(...s[ax].domain);
      const hi = Math.max(...s[ax].domain);
      expect(lo).toBeCloseTo(-5, 3);
      expect(hi).toBeCloseTo(40, 3);
    });
  }
});

describe("matrix — axis-bearing kinds honour a reversed value axis", () => {
  for (const fx of FIX.filter((f) => f.axisBearing)) {
    const ax = valAxisOf(fx);
    it(`${fx.kind}: reversing the value axis flips the reported domain high→low`, () => {
      // Pin the range so base/reversed compare the same endpoints (auto-fit could differ).
      const spec = { min: -5, max: 40 };
      const base = buildFor(fx, ax === "x" ? { xAxis: spec } : { yAxis: spec })[ax].domain;
      const rev = buildFor(fx, ax === "x" ? { xAxis: { ...spec, reversed: true } } : { yAxis: { ...spec, reversed: true } })[ax].domain;
      expect(rev[0]).toBeCloseTo(base[1], 3);
      expect(rev[1]).toBeCloseTo(base[0], 3);
    });
  }
});

describe("matrix — a log value scale is honoured (or intentionally kept linear)", () => {
  for (const fx of FIX.filter((f) => f.axisBearing)) {
    const ax = valAxisOf(fx);
    const supports = fx.logValue !== false;
    it(`${fx.kind}: scale:"log10" → ${supports ? "log10" : "stays linear (by design)"}`, () => {
      // Fixtures' value columns are strictly positive, so log10 is valid where supported;
      // a builder that ignores `scale` leaves it "linear". Kinds with logValue:false anchor
      // at 0 / are pre-transformed / bounded, so they must force linear even when log is asked.
      const s = buildFor(fx, ax === "x" ? { xAxis: { scale: "log10" } } : { yAxis: { scale: "log10" } });
      expect(s[ax].type).toBe(supports ? "log10" : "linear");
    });
  }
});

describe("matrix — axis-bearing kinds draw background gridlines", () => {
  for (const fx of FIX.filter((f) => f.axisBearing)) {
    it(`${fx.kind}: grid.show renders .gfx-grid lines`, () => {
      const { container } = render(<PlotFigure scene={buildFor(fx, { grid: { show: true, color: "#22cc44" } })} selected={null} />);
      expect(container.querySelectorAll(".gfx-grid line").length).toBeGreaterThanOrEqual(1);
    });
  }
});

// ===========================================================================
// Per-series style overrides (SeriesStyle → SeriesScene). Keyed off each kind's
// actual first series id (dataset col id / surv-0 / a subject row id …), so the
// override is applied to whatever id that builder assigns — a builder that drops
// seriesStyles for its kind leaves the default and fails.
// Bespoke lollipop/pie/radar/heatmap/scatter3d carry glyphs in their own
// structures (no SeriesScene series) → covered by their dedicated drag tests.
// ===========================================================================
const SERIES_FIX = FIX.filter((f) => buildFor(f).series.length > 0);
const firstSeriesId = (fx: Fx): string => buildFor(fx).series[0]!.id;
const MARKER_KINDS = new Set<PlotKind>(["xy", "area", "scatter", "raincloud", "bubble", "volcano", "beforeafter", "forest"]);
const LINE_KINDS = new Set<PlotKind>(["xy", "area", "survival", "beforeafter", "ridgeline", "roc", "scree"]);

describe("matrix — per-series colour override reaches the SeriesScene", () => {
  for (const fx of SERIES_FIX) {
    it(`${fx.kind}: seriesStyles[id].color colours the series`, () => {
      const s = buildFor(fx, { seriesStyles: { [firstSeriesId(fx)]: { color: "#ff00ee" } } });
      expect(s.series[0]!.color.toLowerCase()).toBe("#ff00ee");
    });
  }
});

describe("matrix — per-series error-bar colour override reaches the SeriesScene", () => {
  // survival KM curves carry a confidence band, not per-point error bars; ROC curves are
  // step lines — errorColor is N/A for both, so they're excluded by design.
  for (const fx of SERIES_FIX.filter((f) => f.kind !== "survival" && f.kind !== "roc")) {
    it(`${fx.kind}: seriesStyles[id].errorColor colours the error bars`, () => {
      const s = buildFor(fx, { seriesStyles: { [firstSeriesId(fx)]: { errorColor: "#ff00ee" } } });
      expect(s.series[0]!.errorColor.toLowerCase()).toBe("#ff00ee");
    });
  }
});

describe("matrix — per-series marker shape + size reach marker kinds", () => {
  for (const fx of SERIES_FIX.filter((f) => MARKER_KINDS.has(f.kind))) {
    it(`${fx.kind}: seriesStyles[id].symbol/symbolSize reach the SeriesScene`, () => {
      const s = buildFor(fx, { seriesStyles: { [firstSeriesId(fx)]: { symbol: "square", symbolSize: 13 } } });
      expect(s.series[0]!.symbol).toBe("square");
      expect(s.series[0]!.symbolSize).toBe(13);
    });
  }
});

describe("matrix — column-scatter glyph honours Shape + open fill in the DOM (not just the scene)", () => {
  const scatterFx = SERIES_FIX.find((f) => f.kind === "scatter")!;
  it("a square symbol turns the swarm dots into rects, not circles", () => {
    const id = firstSeriesId(scatterFx);
    const circles = render(<PlotFigure scene={buildFor(scatterFx, { seriesStyles: { [id]: { symbol: "circle" } } })} selected={null} />);
    const nCircle = circles.container.querySelectorAll("circle").length;
    cleanup();
    const squares = render(<PlotFigure scene={buildFor(scatterFx, { seriesStyles: { [id]: { symbol: "square" } } })} selected={null} />);
    const nSquare = squares.container.querySelectorAll("circle").length;
    expect(nSquare).toBeLessThan(nCircle); // the swarm circles became rects
  });
  it("an open marker uses the chosen interior fill colour, not var(--bg)", () => {
    const id = firstSeriesId(scatterFx);
    const { container } = render(
      <PlotFigure scene={buildFor(scatterFx, { seriesStyles: { [id]: { symbolFill: "open", symbolFillColor: "#ffccdd" } } })} selected={null} />,
    );
    const tinted = [...container.querySelectorAll("circle, rect, polygon")].some(
      (e) => (e.getAttribute("fill") ?? "").toLowerCase() === "#ffccdd",
    );
    expect(tinted).toBe(true);
  });
});

describe("matrix — survival number-at-risk table visibility + colour", () => {
  const survivalFx = FIX.find((f) => f.kind === "survival")!;
  it("renders the at-risk table outside the plot clip and follows the curve colour", () => {
    const scene = buildFor(survivalFx, {
      survival: [
        { label: "A", times: [0, 1, 2, 3, 4], surv: [1, 0.8, 0.6, 0.4, 0.2] },
        { label: "B", times: [0, 1, 2, 3, 4], surv: [1, 0.9, 0.7, 0.5, 0.3] },
      ],
      survivalAtRisk: { times: [0, 1, 2, 3, 4], rows: [{ label: "A", atRisk: [20, 15, 10, 6, 2] }, { label: "B", atRisk: [18, 14, 9, 5, 1] }] },
      seriesStyles: { "surv-0": { color: "#ff0088" } },
    });
    const { container } = render(<PlotFigure scene={scene} selected={null} onMoveAnnotation={() => {}} />);
    const title = [...container.querySelectorAll("text")].find((t) => t.textContent === "Number at risk");
    expect(title).toBeTruthy();
    // the at-risk table sits below the plot rect, so it must not be inside the plot clip
    for (let n: Element | null = title!; n && n.tagName.toLowerCase() !== "svg"; n = n.parentElement) {
      expect(n.getAttribute("clip-path")).toBeFalsy();
    }
    // curve + at-risk row + legend colour all follow seriesStyles['surv-0']
    expect(scene.series[0]!.color).toBe("#ff0088");
    expect(scene.atRisk!.rows[0]!.color).toBe("#ff0088");
    expect(scene.legend[0]?.color).toBe("#ff0088");
  });
});

// ===========================================================================
// Controls and paths that no other per-kind
// test exercises (e.g. the survival at-risk table). Mostly buildScene-level scene
// assertions + a few rendered-DOM checks.
// ===========================================================================
describe("matrix — per-series fill/line/box overrides reach the scene", () => {
  it("beforeafter: linkLineColor:false + lineColor reaches series.lineColor", () => {
    const fx = FIX.find((f) => f.kind === "beforeafter")!;
    const s = buildFor(fx, { seriesStyles: { [firstSeriesId(fx)]: { linkLineColor: false, lineColor: "#0000ff" } } });
    expect(s.series[0]!.lineColor?.toLowerCase()).toBe("#0000ff");
  });

  it("box: whisker/median/border/fill colour + fillType overrides reach the box SeriesScene", () => {
    const fx = FIX.find((f) => f.kind === "box")!;
    const s = buildFor(fx, { seriesStyles: { [firstSeriesId(fx)]: { whiskerColor: "#ff00ee", medianColor: "#00ffaa", borderColor: "#123456", fillColor: "#abcdef", fillType: "pattern" } } });
    const ser = s.series[0]!;
    expect(ser.whiskerColor?.toLowerCase()).toBe("#ff00ee");
    expect(ser.medianColor?.toLowerCase()).toBe("#00ffaa");
    expect(ser.borderColor.toLowerCase()).toBe("#123456");
    expect(ser.fillColor.toLowerCase()).toBe("#abcdef");
    expect(ser.fillSpec.type).toBe("pattern");
  });

  it("ridgeline: fillColor + fillType override reach series.fillSpec", () => {
    const fx = FIX.find((f) => f.kind === "ridgeline")!;
    const s = buildFor(fx, { seriesStyles: { [firstSeriesId(fx)]: { fillColor: "#abcdef", fillType: "gradient" } } });
    expect(s.series[0]!.fillColor.toLowerCase()).toBe("#abcdef");
    expect(s.series[0]!.fillSpec.type).toBe("gradient");
  });

  it("area: a fillColor override produces a rendered filled area <path>", () => {
    const fx = FIX.find((f) => f.kind === "area")!;
    const s = buildFor(fx, { seriesStyles: { [firstSeriesId(fx)]: { fillColor: "#abcdef", fillOpacity: 0.5, fillType: "gradient" } } });
    expect(s.series[0]!.fillColor.toLowerCase()).toBe("#abcdef");
    expect(s.series[0]!.areaPath ?? "").not.toBe("");
    const { container } = render(<PlotFigure scene={s} selected={null} />);
    const filled = [...container.querySelectorAll("path")].some((p) => {
      const f = (p.getAttribute("fill") || "").toLowerCase();
      return f.length > 0 && f !== "none";
    });
    expect(filled).toBe(true);
  });
});

describe("matrix — marker DOM (shape + interior fill) for marker kinds", () => {
  // The scene-level symbol test does not prove ScatterGlyph renders the shape;
  // exercise the DOM for scatter + raincloud (both draw swarm glyphs).
  for (const kind of ["scatter", "raincloud"] as const) {
    it(`${kind}: a square symbol renders rect glyphs + an open marker uses the interior fill colour`, () => {
      const fx = FIX.find((f) => f.kind === kind)!;
      const id = firstSeriesId(fx);
      const circ = render(<PlotFigure scene={buildFor(fx, { seriesStyles: { [id]: { symbol: "circle" } } })} selected={null} />);
      const nCircle = circ.container.querySelectorAll("circle").length;
      cleanup();
      const sq = render(<PlotFigure scene={buildFor(fx, { seriesStyles: { [id]: { symbol: "square" } } })} selected={null} />);
      expect(sq.container.querySelectorAll("circle").length).toBeLessThan(nCircle); // swarm circles became rects
      cleanup();
      const open = render(<PlotFigure scene={buildFor(fx, { seriesStyles: { [id]: { symbolFill: "open", symbolFillColor: "#ffccdd" } } })} selected={null} />);
      const tinted = [...open.container.querySelectorAll("circle, rect, polygon")].some((e) => (e.getAttribute("fill") ?? "").toLowerCase() === "#ffccdd");
      expect(tinted).toBe(true);
    });
  }

  it("raincloud: violinShowBox:false removes the styled series' inner box; violinBoxWidth scales it", () => {
    const fx = FIX.find((f) => f.kind === "raincloud")!;
    const id = firstSeriesId(fx);
    // Scope to the styled series (the fixture has two value columns → two series; the second
    // keeps its default box, so count only the series we toggled).
    const firstBox = (s: ReturnType<typeof buildPlotScene>) => s.series[0]!.marks.find((m) => m.box)?.box;
    expect(firstBox(buildFor(fx, { seriesStyles: { [id]: { violinShowBox: true } } }))).toBeTruthy();
    expect(firstBox(buildFor(fx, { seriesStyles: { [id]: { violinShowBox: false } } }))).toBeUndefined();
    // violinBoxWidth scales the inner box width.
    const wide = firstBox(buildFor(fx, { seriesStyles: { [id]: { violinBoxWidth: 2 } } }))!.w;
    const narrow = firstBox(buildFor(fx, { seriesStyles: { [id]: { violinBoxWidth: 0.5 } } }))!.w;
    expect(wide).toBeGreaterThan(narrow);
  });
});

describe("matrix — corrmatrix colour / triangle / values controls", () => {
  const fx = FIX.find((f) => f.kind === "corrmatrix")!;
  it("positiveColor/negativeColor recolour the cells", () => {
    const base = buildFor(fx).corrmatrix!;
    const recol = buildFor(fx, { corrmatrix: { positiveColor: "#00ff00", negativeColor: "#ff0000" } }).corrmatrix!;
    expect(recol.cells.some((c, i) => c.color.toLowerCase() !== (base.cells[i]?.color ?? "").toLowerCase())).toBe(true);
  });
  it("triangle:'full' draws the whole n×n grid", () => {
    const full = buildFor(fx, { corrmatrix: { triangle: "full" } }).corrmatrix!;
    const n = Math.max(...full.cells.map((c) => c.row)) + 1;
    expect(full.cells.length).toBe(n * n);
  });
  it("showValues prints the r value in the cells", () => {
    const vals = buildFor(fx, { corrmatrix: { showValues: true } }).corrmatrix!;
    expect(vals.cells.some((c) => c.label !== "")).toBe(true);
  });
});

describe("matrix — bubble maxRadius + blandaltman role-less table + pcaload component", () => {
  it("bubble: a larger maxRadius grows the largest rendered mark; sizeLegendScale scales the legend spheres", () => {
    const fx = FIX.find((f) => f.kind === "bubble")!;
    const maxSym = (s: ReturnType<typeof buildPlotScene>) => Math.max(...s.series.flatMap((se) => se.marks.map((m) => m.symbolSize ?? 0)));
    expect(maxSym(buildFor(fx, { bubble: { maxRadius: 40 } }))).toBeGreaterThan(maxSym(buildFor(fx, { bubble: { maxRadius: 10 } })));
    // sizeLegendScale scales the size-legend reference spheres.
    const legMax = (s: ReturnType<typeof buildPlotScene>) => Math.max(...(s.bubbleLegend?.items ?? [{ radius: 0 }]).map((i) => i.radius));
    const big = buildFor(fx, { bubble: { sizeLegendScale: 2 } });
    const small = buildFor(fx, { bubble: { sizeLegendScale: 1 } });
    if (big.bubbleLegend) expect(legMax(big)).toBeGreaterThan(legMax(small));
  });

  it("blandaltman: a role-less xy table (as the analysis feeds it) still plots one point per row", () => {
    const t: DataTable = { id: "tba", kind: "xy", name: "BA", columns: [{ id: "m1", name: "M1" }, { id: "m2", name: "M2" }], rows: [
      { id: "r1", cells: { m1: 10, m2: 12 } }, { id: "r2", cells: { m1: 20, m2: 19 } }, { id: "r3", cells: { m1: 30, m2: 33 } },
    ] };
    const s = buildPlotScene(t, { id: "p", name: "P", source: "tba", status: "ok", styleOverrides: {}, kind: "blandaltman" }, { width: 520, height: 360 });
    expect(s.series.reduce((n, se) => n + se.marks.length, 0)).toBe(3);
  });

  it("pcaload: pcaStyle.xComponent picks which component drives the loading x-coordinate", () => {
    const fx = FIX.find((f) => f.kind === "pcaload")!;
    const a = buildFor(fx, { pcaStyle: { xComponent: 0, yComponent: 1 } });
    const b = buildFor(fx, { pcaStyle: { xComponent: 2, yComponent: 1 } });
    expect(a.series[0]!.marks[0]!.dx).not.toBeCloseTo(b.series[0]!.marks[0]!.dx, 6);
  });
});

describe("matrix — per-series line width + dash reach line kinds", () => {
  for (const fx of SERIES_FIX.filter((f) => LINE_KINDS.has(f.kind))) {
    it(`${fx.kind}: seriesStyles[id].lineWidth/lineDash reach the SeriesScene`, () => {
      const s = buildFor(fx, { seriesStyles: { [firstSeriesId(fx)]: { lineWidth: 7, lineDash: "dashed" } } });
      expect(s.series[0]!.lineWidth).toBe(7);
      expect(s.series[0]!.dash).not.toBeNull();
      expect(typeof s.series[0]!.dash).toBe("string");
    });
  }
});

// ===========================================================================
// Legend drag — the shared <Legend> block (cursor:move, fires onMove→onMoveLegend)
// renders for every kind whose scene has ≥1 legend entry. Multi-series fixtures
// (2 y-columns / 2 slices) give a legend. A kind that forgets to thread
// onMoveLegend (or renders no draggable legend) fails.
// ===========================================================================
const LEGEND_FIX = FIX.filter((f) => buildFor(f).legend.length > 0);
const findLegendG = (c: HTMLElement, labels: Set<string>): Element | undefined =>
  [...c.querySelectorAll("g")].find(
    (g) =>
      (g as unknown as HTMLElement).style.cursor === "move" &&
      [...g.querySelectorAll("text")].some((t) => labels.has((t.textContent ?? "").trim())),
  );

describe("matrix — the legend block is draggable where a legend renders", () => {
  for (const fx of LEGEND_FIX) {
    it(`${fx.kind}: dragging the legend fires onMoveLegend`, () => {
      const onMoveLegend = vi.fn();
      const scene = buildFor(fx);
      const labels = new Set(scene.legend.map((e) => e.label));
      const { container } = render(<PlotFigure scene={scene} selected={null} onMoveLegend={onMoveLegend} onEditText={() => {}} />);
      const g = findLegendG(container, labels);
      expect(g, `${fx.kind} renders no draggable legend group`).toBeTruthy();
      dragEl(g!);
      expect(onMoveLegend).toHaveBeenCalled();
    });
  }
});

// ===========================================================================
// Annotations — render + keyboard delete / duplicate / nudge, across every
// axis-bearing kind that builds annotations. A domain-independent text
// annotation (fractional x/y) works uniformly. Pointer drag needs getScreenCTM
// (null in jsdom) so movement is exercised via the keyboard nudge, which is pure
// scene math. (lollipop builds + renders annotations too — via the
// shared AnnotationsLayer + the parent's keyboard handler — so it's included.)
// ===========================================================================
const ANN_FIX = FIX.filter((f) => f.axisBearing);
const textAnn: Partial<Plot> = { annotations: [{ id: "ann1", kind: "text", x: 0.5, y: 0.5, label: "ANN" }] };
const annSelected = { kind: "annotation", id: "ann1" } as const;

describe("matrix — annotation-bearing kinds render a text annotation", () => {
  for (const fx of ANN_FIX) {
    it(`${fx.kind}: a text annotation renders (data-ann-text)`, () => {
      const { container } = render(<PlotFigure scene={buildFor(fx, textAnn)} selected={null} onMoveAnnotation={() => {}} onEditText={() => {}} />);
      expect(container.querySelector('[data-ann-text="ann1"]')).toBeTruthy();
    });
  }
});

// ===========================================================================
// Title edit — double-click the title → an inline editor opens → committing it
// (blur) fires onEditText({kind:"title"}, newValue). Complements the title-drag
// test; catches a kind whose title is draggable but not editable.
// ===========================================================================
const openEditor = (c: HTMLElement): HTMLTextAreaElement | HTMLInputElement | null =>
  (c.querySelector("textarea, input[type=text]") ?? document.querySelector("textarea, input[type=text]")) as
    | HTMLTextAreaElement
    | HTMLInputElement
    | null;

describe("matrix — every kind's title is editable (double-click → onEditText)", () => {
  for (const fx of FIX) {
    it(`${fx.kind}: double-click title → edit → commit fires onEditText`, () => {
      const onEditText = vi.fn();
      const { container } = render(<PlotFigure scene={buildFor(fx, { title: "DragMe" })} selected={null} onEditText={onEditText} onMoveTitle={() => {}} />);
      const t = [...container.querySelectorAll("text")].find((e) => /DragMe/.test(e.textContent ?? ""));
      expect(t, `${fx.kind} has no title text`).toBeTruthy();
      fireEvent.doubleClick(t!);
      const box = openEditor(container);
      expect(box, `${fx.kind}: no inline editor opened`).toBeTruthy();
      fireEvent.change(box!, { target: { value: "Edited!" } });
      fireEvent.blur(box!);
      expect(onEditText).toHaveBeenCalledWith(expect.objectContaining({ kind: "title" }), "Edited!");
    });
  }
});

describe("matrix — per-point value labels are editable (double-click → onEditText value)", () => {
  const cases: { kind: PlotKind; extra: Partial<Plot> }[] = [
    { kind: "bar", extra: { showValues: true } },
    { kind: "lollipop", extra: { lollipop: { showValues: true } } },
  ];
  for (const c of cases) {
    it(`${c.kind}: double-click a value label → commit fires onEditText({kind:"value"})`, () => {
      const fx = FIX.find((f) => f.kind === c.kind)!;
      const onEditText = vi.fn();
      const { container } = render(<PlotFigure scene={buildFor(fx, c.extra)} selected={null} onEditText={onEditText} onMoveValueLabel={() => {}} />);
      // The draggable value label is a cursor:move <text> whose content is the number
      // (distinct from the cursor:move title, which is the kind's title string).
      const vlabel = [...container.querySelectorAll("text")].find(
        (e) => (e as unknown as HTMLElement).style.cursor === "move" && /^[\d.]/.test((e.textContent ?? "").trim()),
      );
      expect(vlabel, `${c.kind} renders no editable value label`).toBeTruthy();
      fireEvent.doubleClick(vlabel!);
      const box = openEditor(container);
      expect(box, `${c.kind}: no value-label editor opened`).toBeTruthy();
      fireEvent.change(box!, { target: { value: "9.9" } });
      fireEvent.blur(box!);
      expect(onEditText).toHaveBeenCalledWith(expect.objectContaining({ kind: "value" }), "9.9");
    });
  }
});

describe("matrix — editable labels: alluvial subtitle / radar spoke / colour-bar title", () => {
  it("alluvial: double-click the subtitle → commit fires onEditText({kind:'subtitle'})", () => {
    const fx = FIX.find((f) => f.kind === "alluvial")!;
    const onEditText = vi.fn();
    const { container } = render(<PlotFigure scene={buildFor(fx, { subtitle: "SubA" })} selected={null} onEditText={onEditText} onMoveTitle={() => {}} />);
    const t = [...container.querySelectorAll("text")].find((e) => /SubA/.test(e.textContent ?? ""));
    expect(t, "no alluvial subtitle").toBeTruthy();
    fireEvent.doubleClick(t!);
    const box = openEditor(container);
    expect(box, "no editor opened").toBeTruthy();
    fireEvent.change(box!, { target: { value: "Sub2" } });
    fireEvent.blur(box!);
    expect(onEditText).toHaveBeenCalledWith(expect.objectContaining({ kind: "subtitle" }), "Sub2");
  });

  it("radar: double-click a spoke category label → commit fires onEditText({kind:'radarSpokeLabel'})", () => {
    const fx = FIX.find((f) => f.kind === "radar")!;
    const onEditText = vi.fn();
    const { container } = render(<PlotFigure scene={buildFor(fx)} selected={null} onEditText={onEditText} onMoveValueLabel={() => {}} />);
    const t = findText(container, /Alpha|Beta|Gamma|Delta/); // spoke = a category (row) label
    expect(t, "no radar spoke label").toBeTruthy();
    fireEvent.doubleClick(t!);
    const box = openEditor(container);
    expect(box, "no editor opened").toBeTruthy();
    fireEvent.change(box!, { target: { value: "NewCat" } });
    fireEvent.blur(box!);
    expect(onEditText).toHaveBeenCalledWith(expect.objectContaining({ kind: "radarSpokeLabel" }), "NewCat");
  });

  it("heatmap: double-click the colour-bar title → commit fires onEditText({kind:'colorbarTitle'})", () => {
    const fx = FIX.find((f) => f.kind === "heatmap")!;
    const onEditText = vi.fn();
    const { container } = render(<PlotFigure scene={buildFor(fx, { heatmap: { mode: "matrix", showValues: true, showColorbar: true, colorbarTitle: "Z-score" } })} selected={null} onEditText={onEditText} />);
    const t = [...container.querySelectorAll("text")].find((e) => /Z-score/.test(e.textContent ?? ""));
    expect(t, "no colour-bar title").toBeTruthy();
    fireEvent.doubleClick(t!);
    const box = openEditor(container);
    expect(box, "no editor opened").toBeTruthy();
    fireEvent.change(box!, { target: { value: "Expression" } });
    fireEvent.blur(box!);
    expect(onEditText).toHaveBeenCalledWith(expect.objectContaining({ kind: "colorbarTitle" }), "Expression");
  });

  it("treemap: double-click a cell label → commit fires onEditText({kind:'treemapCellLabel'})", () => {
    const fx = FIX.find((f) => f.kind === "treemap")!;
    // builder round-trip: a pointStyles offset reaches the cell as labelDx/labelDy.
    const cellId = buildFor(fx).treemap!.cells[0]!.id;
    const offset = buildFor(fx, { pointStyles: { [`${cellId}:${cellId}`]: { valueDx: 9, valueDy: -4 } } }).treemap!.cells.find((c) => c.id === cellId)!;
    expect(offset.labelDx).toBe(9);
    expect(offset.labelDy).toBe(-4);
    const onEditText = vi.fn();
    const { container } = render(<PlotFigure scene={buildFor(fx)} selected={null} onEditText={onEditText} onMoveValueLabel={() => {}} />);
    const t = [...container.querySelectorAll("text")].find((e) => (e as unknown as HTMLElement).style.cursor === "move");
    expect(t, "no draggable cell label").toBeTruthy();
    fireEvent.doubleClick(t!);
    const box = openEditor(container);
    expect(box, "no editor opened").toBeTruthy();
    fireEvent.change(box!, { target: { value: "Renamed" } });
    fireEvent.blur(box!);
    expect(onEditText).toHaveBeenCalledWith(expect.objectContaining({ kind: "treemapCellLabel" }), "Renamed");
  });

  it("xy: double-click a data-driven point label → commit fires onEditText({kind:'value'})", () => {
    const fx = FIX.find((f) => f.kind === "xy")!;
    const onEditText = vi.fn();
    const { container } = render(<PlotFigure scene={buildFor(fx, { seriesStyles: { y: { pointLabels: "y" } } })} selected={null} onEditText={onEditText} onMoveValueLabel={() => {}} />);
    // xy point labels are cursor:move <text> beside each marker (here the y value).
    const t = [...container.querySelectorAll("text")].find((e) => (e as unknown as HTMLElement).style.cursor === "move" && /^[\d.]/.test((e.textContent ?? "").trim()));
    expect(t, "no xy point label").toBeTruthy();
    fireEvent.doubleClick(t!);
    const box = openEditor(container);
    expect(box, "no editor opened").toBeTruthy();
    fireEvent.change(box!, { target: { value: "custom" } });
    fireEvent.blur(box!);
    expect(onEditText).toHaveBeenCalledWith(expect.objectContaining({ kind: "value" }), "custom");
  });
});

describe("matrix — parallel axis label honours its stored free-drag offset in interactive mode", () => {
  const fx = FIX.find((f) => f.kind === "parallel")!;
  it("the axis label <text> carries a translate() reflecting labelDx/labelDy when onParallelEdit is set", () => {
    const colId = buildFor(fx).parallel!.axes.find((a) => a.colId)!.colId!;
    const s = buildFor(fx, { pointStyles: { [`${colId}:${colId}`]: { valueDx: 12, valueDy: -5 } } });
    const label = s.parallel!.axes.find((a) => a.colId === colId)!.label;
    // interactive mode (onParallelEdit set) uses the reorder <text> path — it must still
    // honour the stored offset, not drop it.
    const { container } = render(<PlotFigure scene={s} selected={null} onParallelEdit={() => {}} />);
    const t = [...container.querySelectorAll("text")].find((e) => (e.textContent ?? "").trim() === label);
    expect(t, "no parallel axis label").toBeTruthy();
    expect(t!.getAttribute("transform")).toBe("translate(12 -5)");
  });
});

describe("matrix — drag/edit: scatter3d subtitle · lollipop Δ% colour · scatter/dendrogram by-design", () => {
  it("scatter3d: the subtitle follows the title's drag offset", () => {
    const fx = FIX.find((f) => f.kind === "scatter3d")!;
    const s = buildFor(fx, { subtitle: "Sub3D", titleOffset: { dx: 20, dy: 8 } });
    const { container } = render(<PlotFigure scene={s} selected={null} onMoveTitle={() => {}} onEditText={() => {}} />);
    const sub = [...container.querySelectorAll("text")].find((e) => (e.textContent ?? "").trim() === "Sub3D");
    expect(sub, "no subtitle").toBeTruthy();
    expect(Number(sub!.getAttribute("x"))).toBe(30); // base 10 + title dx 20 → tracks the title
  });

  it("lollipop: the Δ% label colour is resolvable (default green + a deltaColor override)", () => {
    const fx = FIX.find((f) => f.kind === "lollipop")!;
    const def = buildFor(fx, { lollipop: { showDelta: true } }).lollipop!;
    expect(def.rows.find((r) => r.delta)?.delta?.color).toBe("#1a9850");
    const over = buildFor(fx, { lollipop: { showDelta: true, deltaColor: "#ff0000" } }).lollipop!;
    expect(over.rows.find((r) => r.delta)?.delta?.color).toBe("#ff0000");
  });

  it("scatter: marks are a point swarm with no box/violin edges → width is the slider, not an edge drag (by design)", () => {
    const fx = FIX.find((f) => f.kind === "scatter")!;
    const m = buildFor(fx).series[0]!.marks[0]!;
    expect(m.points, "scatter marks should carry a point swarm").toBeTruthy();
    expect(m.box, "scatter marks have no box → the EdgeHandles resize (gated on box/violin) correctly doesn't apply").toBeUndefined();
    expect(m.violin).toBeUndefined();
  });

  it("dendrogram: leaf labels render as tree-ordered axis tick labels, not per-leaf draggable labels (by design)", () => {
    const fx = FIX.find((f) => f.kind === "dendrogram")!;
    const s = buildFor(fx);
    // The leaves are the category labels along an axis (order set by the clustering) — consistent
    // with every other axis-bearing kind, not the heatmap's data-cell labels.
    const ticks = [...s.x.ticks, ...s.y.ticks].filter((t) => t.label && !/^[\d.]/.test(t.label));
    expect(ticks.length, "dendrogram leaves should appear as category tick labels").toBeGreaterThan(0);
  });
});

describe("matrix — a selected annotation is deletable / duplicable / nudgeable by keyboard", () => {
  for (const fx of ANN_FIX) {
    it(`${fx.kind}: Delete / Ctrl+D / Arrow fire the annotation callbacks`, () => {
      const onDeleteAnnotation = vi.fn();
      const onDuplicateAnnotation = vi.fn();
      const onMoveAnnotation = vi.fn();
      render(
        <PlotFigure
          scene={buildFor(fx, textAnn)}
          selected={annSelected}
          onDeleteAnnotation={onDeleteAnnotation}
          onDuplicateAnnotation={onDuplicateAnnotation}
          onMoveAnnotation={onMoveAnnotation}
          onEditText={() => {}}
        />,
      );
      fireEvent.keyDown(window, { key: "ArrowRight" });
      expect(onMoveAnnotation, `${fx.kind}: ArrowRight did not nudge`).toHaveBeenCalledWith("ann1", expect.anything());
      fireEvent.keyDown(window, { key: "d", ctrlKey: true });
      expect(onDuplicateAnnotation, `${fx.kind}: Ctrl+D did not duplicate`).toHaveBeenCalledWith("ann1");
      fireEvent.keyDown(window, { key: "Delete" });
      expect(onDeleteAnnotation, `${fx.kind}: Delete did not delete`).toHaveBeenCalledWith("ann1");
    });
  }
});

// ===========================================================================
// Bespoke render assertions for forest, Bland-Altman and population pyramid: the elements the
// data-driven dimensions above don't specifically check (the summary diamond,
// the mirrored bars, the reference lines + point markers).
// ===========================================================================
describe("bespoke render — forest / Bland-Altman / population pyramid draw their bespoke elements", () => {
  const forestFx = FIX.find((f) => f.kind === "forest")!;
  const baFx = FIX.find((f) => f.kind === "blandaltman")!;
  const pyFx = FIX.find((f) => f.kind === "pyramid")!;

  it("forest: one marker per study + a summary diamond polygon when pooled", () => {
    // Note: `showSummary: false` explicitly. The shared fixture turns the summary on (the scene
    // census refuses an "interactive" claim no fixture can reach), so relying on the fixture's
    // default would silently stop testing the flag. This guards that the summary is drawn only
    // when asked for.
    const plain = render(<PlotFigure scene={buildFor(forestFx, { forest: { showSummary: false } })} selected={null} />);
    // 4 study markers (one <g id="mark-..."> each).
    expect(plain.container.querySelectorAll('[id^="mark-"]').length).toBe(4);
    expect(plain.container.querySelector("polygon")).toBeFalsy(); // no diamond when it is off
    cleanup();
    const pooled = render(<PlotFigure scene={buildFor(forestFx, { forest: { showSummary: true } })} selected={null} />);
    const poly = pooled.container.querySelector("polygon");
    expect(poly).toBeTruthy(); // the pooled summary diamond
    expect((poly!.getAttribute("points") ?? "").split(" ").length).toBe(4); // 4 vertices
  });

  it("blandaltman: a point per pair + bias & limits-of-agreement reference lines", () => {
    const { container } = render(<PlotFigure scene={buildFor(baFx)} selected={null} />);
    // catTable has 4 rows → 4 paired points.
    expect(container.querySelectorAll('[id^="mark-"]').length).toBe(4);
    // 3 horizontal reference lines (bias + 2 LoA) render in the annotation layer.
    const scene = buildFor(baFx);
    for (const id of ["ba-bias", "ba-loa-hi", "ba-loa-lo"]) {
      expect(scene.annotations.some((a) => a.id === id), id).toBe(true);
    }
  });

  it("pyramid: mirrored bar rects (two groups × categories) meeting at centre", () => {
    const { container } = render(<PlotFigure scene={buildFor(pyFx)} selected={null} />);
    const bars = container.querySelectorAll('rect[id^="mark-"]');
    // catTable: 4 categories × 2 groups = 8 bars.
    expect(bars.length).toBe(8);
  });
});

// ===========================================================================
// Bespoke render assertions for the PCA graph suite: the score markers +
// group legend, the loading arrows, and the scree connecting line.
// ===========================================================================
describe("bespoke render — PCA score / loadings / biplot / scree draw their bespoke elements", () => {
  const scoreFx = FIX.find((f) => f.kind === "pcascore")!;
  const loadFx = FIX.find((f) => f.kind === "pcaload")!;
  const biFx = FIX.find((f) => f.kind === "pcabiplot")!;
  const screeFx = FIX.find((f) => f.kind === "scree")!;

  it("pcascore: a marker per case (the pcaGraph fixture has 6 cases)", () => {
    const { container } = render(<PlotFigure scene={buildFor(scoreFx)} selected={null} />);
    expect(container.querySelectorAll('[id^="mark-"]').length).toBe(6);
  });

  it("pcaload: a marker per variable + a loading arrow per variable", () => {
    const scene = buildFor(loadFx);
    // 3 variables → 3 arrow annotations in the scene.
    expect(scene.annotations.filter((a) => a.kind === "arrow").length).toBe(3);
    const { container } = render(<PlotFigure scene={scene} selected={null} />);
    expect(container.querySelectorAll('[id^="mark-"]').length).toBe(3);
  });

  it("pcabiplot: score markers and loading arrows overlaid", () => {
    const scene = buildFor(biFx);
    expect(scene.annotations.filter((a) => a.kind === "arrow").length).toBe(3);
    const { container } = render(<PlotFigure scene={scene} selected={null} />);
    expect(container.querySelectorAll('[id^="mark-"]').length).toBe(6); // scores
  });

  it("scree: a connecting line path renders through the per-component points", () => {
    const scene = buildFor(screeFx);
    expect(scene.series[0]!.linePath.length).toBeGreaterThan(0);
    const { container } = render(<PlotFigure scene={scene} selected={null} />);
    // the scree line renders as an SVG path with a non-empty d.
    const paths = [...container.querySelectorAll("path")].filter((p) => (p.getAttribute("d") ?? "").length > 5);
    expect(paths.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// Clustering — the dendrogram tree line + the clustered heatmap's attached trees.
// ===========================================================================
describe("clustering render — dendrogram + clustered heatmap draw their trees", () => {
  const dendroFx = FIX.find((f) => f.kind === "dendrogram")!;

  it("dendrogram: the merge tree renders as an SVG path", () => {
    const scene = buildFor(dendroFx);
    expect(scene.series[0]!.linePath.length).toBeGreaterThan(0);
    const { container } = render(<PlotFigure scene={scene} selected={null} />);
    const paths = [...container.querySelectorAll("path")].filter((p) => (p.getAttribute("d") ?? "").length > 10);
    expect(paths.length).toBeGreaterThan(0);
  });

  it("clustered heatmap: the attached row + column dendrograms render", () => {
    const hmFx = FIX.find((f) => f.kind === "heatmap")!;
    const scene = buildFor(hmFx, { heatmap: { mode: "matrix", cluster: "both" } });
    expect(scene.heatmap!.dendrograms?.row?.length).toBeGreaterThan(0);
    expect(scene.heatmap!.dendrograms?.col?.length).toBeGreaterThan(0);
    const { container } = render(<PlotFigure scene={scene} selected={null} />);
    // two tree paths (row + col) + the cell rects.
    const paths = [...container.querySelectorAll("path")].filter((p) => (p.getAttribute("d") ?? "").length > 10);
    expect(paths.length).toBeGreaterThanOrEqual(2);
    expect(container.querySelectorAll("rect").length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// Axis engine: the renderer applies tick rotation, draws shaded bands,
// and shows custom ticks (the scene-level positioning is covered in buildScene).
// ===========================================================================
describe("axis engine render (rotation · shaded band · custom tick)", () => {
  const xyFx = FIX.find((f) => f.kind === "xy")!;

  // Guards against rotated labels running up into the plot: with `end` for every turn, text ending at its
  // tick at +45° runs up into the plot. The turn must reach the drawing, each sign hangs its text below the
  // axis (+ starts at the tick, − ends at it), and every turning point sits below the plot's bottom edge.
  it("tick-label rotation adds a rotate() transform to the X labels, turned so the text hangs below the axis", () => {
    for (const [rot, anchor] of [[45, "start"], [-45, "end"]] as const) {
      const scene = buildFor(xyFx, { xAxis: { tickRotation: rot } });
      expect(scene.x.tickRotation).toBe(rot);
      const { container } = render(<PlotFigure scene={scene} selected={null} />);
      const turn = new RegExp(`rotate\\(${rot} ([-\\d.]+) ([-\\d.]+)\\)`);
      const rotated = [...container.querySelectorAll("text")].filter((t) => turn.test(t.getAttribute("transform") ?? ""));
      expect(rotated.length, `${rot}°: no X label carries the turn`).toBeGreaterThan(0);
      for (const t of rotated) {
        expect(t.getAttribute("text-anchor"), `${rot}°: the text would run up into the plot`).toBe(anchor);
        const pivotY = Number(turn.exec(t.getAttribute("transform")!)![2]);
        expect(pivotY, `${rot}°: the label turns about a point inside the plot`).toBeGreaterThan(scene.plot.y + scene.plot.height);
      }
      cleanup();
    }
  });

  it("a shaded band renders as a translucent rect spanning the plot", () => {
    const scene = buildFor(xyFx, { yAxis: { min: 0, max: 10, bands: [{ from: 2, to: 6, color: "#ff0000" }] } });
    expect(scene.axisBands?.length).toBe(1);
    const { container } = render(<PlotFigure scene={scene} selected={null} />);
    const band = [...container.querySelectorAll("rect")].find((r) => (r.getAttribute("fill") ?? "").toLowerCase() === "#ff0000");
    expect(band).toBeTruthy();
    expect(Number(band!.getAttribute("width"))).toBeGreaterThan(0);
  });

  it("a custom tick at an exact value renders its override label", () => {
    const scene = buildFor(xyFx, { xAxis: { min: 0, max: 10, extraTicks: [{ value: 5, label: "target" }] } });
    const { container } = render(<PlotFigure scene={scene} selected={null} />);
    const lbl = [...container.querySelectorAll("text")].find((t) => (t.textContent ?? "").trim() === "target");
    expect(lbl).toBeTruthy();
  });
});
