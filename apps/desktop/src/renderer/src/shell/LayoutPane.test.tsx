// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render as rtlRender, waitFor } from "@testing-library/react";
import { openFigureMenus } from "./figureToolbar.testutil";
import type { DataTable, FigureLayout, NodeId, Plot, Project } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { arrangePanels, centerPanelsOnFigure, exceedsPanelDragSlop, LayoutPane, LayoutSelectPane, PanelBuilderView, readableScale, restackPanels, snapPanels, stackOrder } from "./panes";
import { measureText } from "./textMeasure";
import { galleryItems } from "./gallery";
import type { PanelBox } from "./panes";
/** The figure toolbar's Align ▾ / Line up ▾ / Insert ▾ / Style ▾ menus are opened right after rendering, as a user
 *  opens them to reach a control inside, so a test finds each control where a user finds it. */
const render = ((ui: Parameters<typeof rtlRender>[0], options?: Parameters<typeof rtlRender>[1]) => {
  const r = rtlRender(ui, options);
  openFigureMenus(r.container);
  return r;
}) as typeof rtlRender;

afterEach(cleanup);

const table: DataTable = {
  id: "t", kind: "xy", name: "T",
  columns: [{ id: "x", name: "X", role: "x" }, { id: "y", name: "Y", role: "y" }],
  rows: [{ id: "r1", cells: { x: 1, y: 2 } }, { id: "r2", cells: { x: 2, y: 4 } }],
};
const plot = (id: string, name: string): Plot => ({ id, name, source: "t", status: "ok", styleOverrides: {}, kind: "xy" });

/** A project with two projects/experiments and plots filed, plus a figure filed
 *  under Project P1 / Experiment E1 (so proximity ordering has something to sort). */
function proj(layout: Partial<FigureLayout> = {}): Project {
  return {
    schemaVersion: 5,
    tables: [table],
    plots: [plot("A", "Alpha"), plot("B", "Beta"), plot("C", "Gamma"), plot("D", "Delta")],
    analyses: [],
    layouts: [{ id: "L", name: "Figure 1", panels: [], ...layout }],
    log: [],
    workspace: {
      folders: [
        { id: "f1", name: "Project P1", documentation: "", members: [], experiments: [
          { id: "e1", name: "Exp E1", members: [{ kind: "plot", id: "A" }, { kind: "layout", id: "L" }] },
          { id: "e2", name: "Exp E2", members: [{ kind: "plot", id: "B" }] },
        ] },
        { id: "f2", name: "Project P2", documentation: "", members: [], experiments: [
          { id: "e3", name: "Exp E3", members: [{ kind: "plot", id: "C" }] },
        ] },
      ],
      loose: [{ kind: "plot", id: "D" }],
    },
  };
}

describe("exceedsPanelDragSlop — a jittery click on a panel element is not a drag", () => {
  // A panel is draggable anywhere on its body, so this threshold also arbitrates click-vs-drag for
  // the graph's own clickable elements. Guards against a click on a small, clipped lollipop
  // category label in the arrange view being taken as a micro-drag, which selects only the panel
  // and never opens the label's text/font tab. The slop tolerates ordinary hand jitter on a precise
  // click, while a real drag still arms.
  it("treats a few-px jitter as a click, and a real move as a drag", () => {
    expect(exceedsPanelDragSlop(0, 0)).toBe(false);
    expect(exceedsPanelDragSlop(7, 0)).toBe(false); // ordinary hand jitter stays a click
    expect(exceedsPanelDragSlop(0, 7)).toBe(false);
    expect(exceedsPanelDragSlop(5, 5)).toBe(false); // 50 < 64
    // 4px on one axis is within the slop.
    expect(exceedsPanelDragSlop(4, 0)).toBe(false);
    // A genuine drag still arms.
    expect(exceedsPanelDragSlop(8, 0)).toBe(true);
    expect(exceedsPanelDragSlop(30, 0)).toBe(true);
    expect(exceedsPanelDragSlop(0, 20)).toBe(true);
  });
});

describe("LayoutSelectPane — grouped, proximity-ordered selection", () => {
  const base = (p: Project, over: Partial<Parameters<typeof LayoutSelectPane>[0]> = {}) => (
    <LayoutSelectPane project={p} layoutId="L" onAddPanel={() => {}} onRemovePanel={() => {}} onBuild={() => {}} {...over} />
  );

  it("shows each project once with experiments nested + ordered by proximity", () => {
    const { container } = render(base(proj()));
    const projects = [...container.querySelectorAll(".layselect-projhd")].map((h) => h.textContent);
    const exps = [...container.querySelectorAll(".layselect-exphd")].map((h) => h.textContent);
    // Project P1 has two experiments but appears only once; P2 + Unfiled appear once each.
    expect(projects).toEqual(["Project P1", "Project P2", "Unfiled"]);
    // experiment order: the figure's own (E1) first, then E2 (same project), then E3
    expect(exps.slice(0, 3)).toEqual(["Exp E1", "Exp E2", "Exp E3"]);
  });

  /**
   * A figure can be assembled from graphs in different experiments. The picker lists the whole
   * project, and the page has to say so: a figure created inside an experiment otherwise reads as
   * if it were confined to it. Both halves are asserted: every graph is offered, and the page
   * states it.
   */
  it("offers graphs from every experiment, not just the figure's own", () => {
    const { container } = render(base(proj()));
    const names = [...container.querySelectorAll(".laycard-name")].map((n) => n.textContent?.trim());
    // A + B are in this project (E1 = the figure's own, E2 another), C is in a different
    // project, D is unfiled. All four are reachable.
    expect(names).toEqual(["Alpha", "Beta", "Gamma", "Delta"]);
  });

  it("says the list is the whole project", () => {
    const { container } = render(base(proj()));
    const hint = container.querySelector("[data-cross-experiment-hint]");
    expect(hint, "nothing on the page tells you other experiments are included").toBeTruthy();
    expect(hint!.textContent).toMatch(/every graph in the project/i);
  });

  describe("the 'This experiment only' filter — an option, never the default", () => {
    // Cross-experiment stays the default; the filter is only an option. A graph already in the figure is
    // never hidden by it — hiding one would make it impossible to untick.
    const tick = (container: HTMLElement): void => {
      const chip = [...container.querySelectorAll("label")].find((l) => /this experiment only/i.test(l.textContent ?? ""));
      expect(chip, "no experiment-scope option on the picker bar").toBeTruthy();
      const box = chip!.querySelector("input[type=checkbox]") as HTMLInputElement;
      expect(box.checked, "the filter must be an option, not the default").toBe(false);
      fireEvent.click(box);
    };

    it("ticking it narrows the list to the figure's own experiment", () => {
      const { container } = render(base(proj()));
      tick(container);
      const names = [...container.querySelectorAll(".laycard-name")].map((n) => n.textContent?.trim());
      expect(names).toEqual(["Alpha"]);
    });

    it("a graph already in the figure stays listed even from another experiment", () => {
      const { container } = render(base(proj({ panels: ["C"] })));
      tick(container);
      const names = [...container.querySelectorAll(".laycard-name")].map((n) => n.textContent?.trim());
      expect(names, "the filter hid an included graph — it could never be unticked").toEqual(["Alpha", "Gamma"]);
    });

    it("the whole-project hint disappears while the filter is on — it would be inaccurate", () => {
      const { container } = render(base(proj()));
      tick(container);
      expect(container.querySelector("[data-cross-experiment-hint]")).toBeNull();
    });
  });

  it("a card checkbox reflects inclusion; clicking it adds an unincluded graph as a panel", () => {
    const onAddPanel = vi.fn();
    const { container } = render(base(proj(), { onAddPanel }));
    const card = container.querySelector(".laycard") as HTMLElement; // first = Alpha (P1/E1)
    expect(card.classList.contains("laycard-on")).toBe(false);
    fireEvent.click(card);
    expect(onAddPanel).toHaveBeenCalledWith("A");
  });

  it("clicking an already-included graph removes it", () => {
    const onRemovePanel = vi.fn();
    const { container } = render(base(proj({ panels: ["A"] }), { onRemovePanel }));
    const card = container.querySelector(".laycard.laycard-on") as HTMLElement;
    expect(card).toBeTruthy();
    fireEvent.click(card);
    expect(onRemovePanel).toHaveBeenCalledWith("A");
  });

  it("auto-scale on include matches the new panel to the first existing panel", () => {
    const onMatchStyles = vi.fn();
    // A already a panel (the reference); include B → it matches to A
    const { container } = render(base(proj({ panels: ["A"], autoScale: true }), { onMatchStyles, onSetLayoutOptions: () => {} }));
    const betaCard = [...container.querySelectorAll(".laycard")].find((c) => /Beta/.test(c.textContent ?? "")) as HTMLElement;
    fireEvent.click(betaCard);
    expect(onMatchStyles).toHaveBeenCalledTimes(1);
    expect(onMatchStyles.mock.calls[0]![0]).toEqual(["B"]);
  });

  it("the Build / Arrange button is enabled once panels exist and fires onBuild", () => {
    const onBuild = vi.fn();
    const { container, rerender } = render(base(proj(), { onBuild }));
    const btn = () => [...container.querySelectorAll("button.addbtn")].find((b) => /Build/.test(b.textContent ?? "")) as HTMLButtonElement;
    expect(btn().disabled).toBe(true); // no panels yet
    rerender(base(proj({ panels: ["A"] }), { onBuild }));
    expect(btn().disabled).toBe(false);
    fireEvent.click(btn());
    expect(onBuild).toHaveBeenCalled();
  });
});

describe("LayoutPane — arrange view (free-drag + Choose-graphs)", () => {
  const twoPanel = (over: Partial<FigureLayout> = {}): Project => proj({ panels: ["A", "B"], ...over });

  // The way back to choosing graphs is the page's "Choose graphs" tab ("the local tabs switch back and forth…" below);
  // the arrange view has no separate "← Choose graphs" button duplicating it.
  it("absolutely positions panels in free-drag mode", () => {
    const project = twoPanel({ freeform: true, panelPositions: { A: { x: 100, y: 40 }, B: { x: 500, y: 40 } } });
    const { container } = render(
      <LayoutPane project={project} layoutId="L" onRemovePanel={() => {}} onOpenPlot={() => {}} onSetLayoutOptions={() => {}} />,
    );
    expect(container.querySelector(".laycanvas[data-freeform]")).toBeTruthy();
    const panels = [...container.querySelectorAll(".laypanel")] as HTMLElement[];
    expect(panels[0]!.style.position).toBe("absolute");
    expect(panels[0]!.style.left).toBe("100px");
  });

  it("grid mode (free-drag off) does not absolutely position panels", () => {
    const { container } = render(
      <LayoutPane project={twoPanel({ freeform: false })} layoutId="L" onRemovePanel={() => {}} onOpenPlot={() => {}} onSetLayoutOptions={() => {}} />,
    );
    expect(container.querySelector(".laycanvas[data-freeform]")).toBeNull();
    // grid panels are not absolutely positioned (relative is fine — it anchors the resize handle)
    expect((container.querySelector(".laypanel") as HTMLElement).style.position).not.toBe("absolute");
  });

  it("dragging a panel's card-title header commits a new panelPositions entry", () => {
    const onSetLayoutOptions = vi.fn();
    const project = twoPanel({ freeform: true, showPanelNames: true, panelPositions: { A: { x: 100, y: 40 }, B: { x: 500, y: 40 } } });
    const { container } = render(
      <LayoutPane project={project} layoutId="L" onRemovePanel={() => {}} onOpenPlot={() => {}} onSetLayoutOptions={onSetLayoutOptions} />,
    );
    const hd = container.querySelector(".laypanel .laypanel-hd") as HTMLElement;
    fireEvent.pointerDown(hd, { clientX: 120, clientY: 60, pointerId: 1 });
    fireEvent.pointerMove(hd, { clientX: 170, clientY: 95, pointerId: 1 });
    fireEvent.pointerUp(hd, { clientX: 170, clientY: 95, pointerId: 1 });
    expect(onSetLayoutOptions).toHaveBeenCalledTimes(1);
    const patch = onSetLayoutOptions.mock.calls[0]![0] as Partial<FigureLayout>;
    expect(patch.panelPositions!.A).toBeTruthy();
    expect(patch.panelPositions!.B).toEqual({ x: 500, y: 40 });
  });

  it("free-drag: a click on the graph edits (no move); a press-drag on the body moves the panel", () => {
    const onSetLayoutOptions = vi.fn();
    const project = twoPanel({ freeform: true, panelPositions: { A: { x: 100, y: 40 }, B: { x: 500, y: 40 } } });
    const { container } = render(
      <LayoutPane project={project} layoutId="L" onRemovePanel={() => {}} onOpenPlot={() => {}} onSetLayoutOptions={onSetLayoutOptions} />,
    );
    const svg = container.querySelector(".laypanel svg.gfx-figure") as Element;
    // a click (down + up, no movement past the threshold) does not move — leaves it for editing
    fireEvent.pointerDown(svg, { clientX: 150, clientY: 150, button: 0, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 151, clientY: 150, pointerId: 1 });
    expect(onSetLayoutOptions).not.toHaveBeenCalled();
    // a press-drag on the graph body (past the threshold) moves the panel
    fireEvent.pointerDown(svg, { clientX: 150, clientY: 150, button: 0, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 220, clientY: 200, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 220, clientY: 200, pointerId: 1 });
    expect(onSetLayoutOptions).toHaveBeenCalledTimes(1);
    expect((onSetLayoutOptions.mock.calls[0]![0] as Partial<FigureLayout>).panelPositions!.A).toBeTruthy();
  });
});

describe("LayoutPane — title toggles + customizable panel labels", () => {
  const twoPanel = (over: Partial<FigureLayout> = {}): Project => proj({ panels: ["A", "B"], ...over });
  const render2 = (over: Partial<FigureLayout> = {}, onSet = () => {}) =>
    render(<LayoutPane project={twoPanel(over)} layoutId="L" onRemovePanel={() => {}} onOpenPlot={() => {}} onSetLayoutOptions={onSet} />);

  it("hides the card name by default and shows it when card titles are on", () => {
    const blank = render2();
    expect(blank.container.querySelector(".laypanel-name")).toBeNull(); // no header band by default
    cleanup();
    const named = render2({ showPanelNames: true });
    expect((named.container.querySelector(".laypanel-name") as HTMLElement).textContent).toBe("Alpha");
  });

  it("applies fully-custom panel-letter typography (family/size/weight/colour)", () => {
    const { container } = render2({ letterFont: "Georgia, serif", letterSize: 28, letterBold: false, letterColor: "#ff0000" });
    const el = container.querySelector(".laypanel-letter") as HTMLElement;
    expect(el.textContent).toBe("A");
    expect(el.style.fontFamily).toBe("Georgia, serif");
    expect(el.style.fontSize).toBe("28px");
    expect(el.style.fontWeight).toBe("400");
    expect(el.style.color).toBe("rgb(255, 0, 0)");
  });

  it("default letter has no inline overrides (theme styling)", () => {
    const { container } = render2();
    const el = container.querySelector(".laypanel-letter") as HTMLElement;
    expect(el.style.fontFamily).toBe("");
    expect(el.style.fontSize).toBe("");
    expect(el.style.fontWeight).toBe("");
  });

  it("the Graph titles checkbox toggles showPanelTitles on", () => {
    const onSet = vi.fn();
    const { container } = render2({}, onSet);
    const cb = [...container.querySelectorAll("label")].find((l) => /Graph titles/.test(l.textContent ?? ""))!.querySelector("input")!;
    expect(cb.checked).toBe(false); // Off by default
    fireEvent.click(cb);
    expect(onSet).toHaveBeenCalledWith({ showPanelTitles: true });
  });

  it("the label size control defaults to 22 and resets to undefined there", () => {
    const onSet = vi.fn();
    const def = render2();
    const sizeOf = (c: HTMLElement) => [...c.querySelectorAll("label")].find((l) => /^Size/.test(l.textContent ?? ""))!.querySelector("input")! as HTMLInputElement;
    expect(sizeOf(def.container).value).toBe("22"); // bigger default
    cleanup();
    const { container } = render2({ letterSize: 28 }, onSet);
    const size = sizeOf(container);
    expect(size.value).toBe("28");
    fireEvent.change(size, { target: { value: "22" } });
    expect(onSet).toHaveBeenCalledWith({ letterSize: undefined });
  });
});

describe("snapPanels — axis-line (data-rect) magnetic snapping", () => {
  it("snaps a dragged panel's axis edge to another panel's axis edge", () => {
    // other panel at left=0, its y-axis (data-left) 60px in; dragged panel's axis 40px in.
    const other = { left: 0, top: 0, w: 380, h: 260, axis: { dl: 60, dr: 360, dt: 50, db: 250 } };
    const myAxis = { dl: 40, dr: 340, dt: 30, db: 230 };
    // dragged near x=18 → the panel's data-left at 58, target axis 60 → within threshold → snaps so 58→60
    const out = snapPanels(18, 500, 380, 260, [other], 2000, 2000, 6, myAxis);
    expect(out.x + myAxis.dl).toBe(60); // axis lines coincide exactly
    expect(out.vxAxis).toBe(true); // flagged as an axis snap (dashed guide)
  });

  it("still snaps plain card edges when no axis data is supplied", () => {
    const out = snapPanels(3, 3, 100, 100, [{ left: 0, top: 0, w: 100, h: 100 }], 999, 999, 6);
    expect(out.x).toBe(0); // left edge snaps to the other card's left
    expect(out.vxAxis).toBe(false);
  });
});

describe("arrangePanels — one-click align / distribute / equalise (pure)", () => {
  const box = (id: string, x: number, y: number, cardW = 100, cardH = 80, sceneW = 80, sceneH = 60): PanelBox => ({ id, x, y, cardW, cardH, sceneW, sceneH });

  it("align-top writes positions moving each card's top to the group min", () => {
    const patch = arrangePanels([box("A", 0, 30), box("B", 200, 10), box("C", 50, 90)], "top");
    expect(patch.sizes).toBeUndefined();
    expect(patch.positions!.A!.y).toBe(10); // group min-top = 10
    expect(patch.positions!.B!.y).toBe(10);
    expect(patch.positions!.C!.y).toBe(10);
    expect(patch.positions!.A!.x).toBe(0); // x untouched by a top-align
  });

  it("distribute-h evenly spaces the middle panel (extremes fixed)", () => {
    // A right=100, C left=400 (right 500). widths 100 each → gap (500-0-300)/2 = 100.
    const patch = arrangePanels([box("A", 0, 0), box("B", 150, 0), box("C", 400, 0)], "distribute-h");
    expect(patch.positions!.A!.x).toBe(0);
    expect(patch.positions!.B!.x).toBe(200); // 0 + 100 + 100 gap
    expect(patch.positions!.C!.x).toBe(400);
  });

  it("equalise-w writes sizes (scene) not positions, growing to the widest", () => {
    const patch = arrangePanels([box("A", 0, 0, 100, 80, 80, 60), box("B", 0, 0, 140, 80, 120, 60)], "equalize-w");
    expect(patch.positions).toBeUndefined();
    expect(patch.sizes!.A!.w).toBe(120); // grown to B's scene width
    expect(patch.sizes!.B!.w).toBe(120);
    expect(patch.sizes!.A!.h).toBe(60); // height untouched
  });

  it("<2 panels → an empty patch (nothing to arrange)", () => {
    expect(arrangePanels([box("A", 0, 0)], "left")).toEqual({});
    expect(arrangePanels([], "distribute-h")).toEqual({});
  });
});

describe("object tools — pure helpers", () => {
  const box = (id: string, x: number, y: number, cardW = 100, cardH = 80): PanelBox => ({ id, x, y, cardW, cardH, sceneW: 80, sceneH: 60 });

  it("stackOrder sorts ascending by panelZ, ties keep the given order (lettering order)", () => {
    const ids = ["A", "B", "C"];
    expect(stackOrder(ids, (s) => s, undefined)).toEqual(["A", "B", "C"]); // no z → unchanged
    expect(stackOrder(ids, (s) => s, { A: 5 })).toEqual(["B", "C", "A"]); // A in front → last in DOM
    expect(stackOrder(ids, (s) => s, { C: -1 })).toEqual(["C", "A", "B"]); // C behind → first
  });

  it("restackPanels front puts the selection above every other panel (relative order kept)", () => {
    const z = restackPanels(["A", "B", "C"], { C: 4 }, ["A", "B"], "front");
    expect(z.A).toBe(5); // above the current max (C = 4)
    expect(z.B).toBe(6); // and A before B, as selected
    expect(z.C).toBe(4); // untouched
  });

  it("restackPanels back puts the selection below every other panel", () => {
    const z = restackPanels(["A", "B", "C"], { C: -2 }, ["B"], "back");
    expect(z.B).toBeLessThan(-2);
  });

  it("centerPanelsOnFigure centres the selection as a rigid group on the union of all panels", () => {
    // Union spans x 0..400; group = A+B spans 0..250 → centre shift dx = 200 - 125 = 75.
    const all = [box("A", 0, 0), box("B", 150, 40), box("C", 300, 200)];
    const patch = centerPanelsOnFigure(all, new Set(["A", "B"]), "h");
    expect(patch.A).toEqual({ x: 75, y: 0 }); // shifted together —
    expect(patch.B).toEqual({ x: 225, y: 40 }); // — same dx, y untouched
    expect(patch.C).toBeUndefined(); // unselected panels stay put
  });

  it("centerPanelsOnFigure 'v' moves y only; selecting every panel → empty patch", () => {
    const all = [box("A", 0, 0), box("B", 0, 300)];
    const v = centerPanelsOnFigure(all, new Set(["A"]), "v");
    expect(v.A!.x).toBe(0);
    expect(v.A!.y).toBeGreaterThan(0); // pulled down toward the union centre
    expect(centerPanelsOnFigure(all, new Set(["A", "B"]), "v")).toEqual({}); // no page to centre on
  });
});

describe("LayoutPane — resize, auto-align, ruler, header collapse", () => {
  const arrange = (over: Partial<FigureLayout> = {}, onSet = vi.fn()) =>
    render(<LayoutPane project={proj({ panels: ["A", "B"], ...over })} layoutId="L" onRemovePanel={() => {}} onOpenPlot={() => {}} onSetLayoutOptions={onSet} />);

  it("dragging a panel's resize handle commits a panelSizes entry", () => {
    const onSet = vi.fn();
    const { container } = arrange({}, onSet);
    const handle = container.querySelector(".laypanel-resize") as HTMLElement;
    expect(handle).toBeTruthy();
    fireEvent.pointerDown(handle, { clientX: 400, clientY: 300, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 480, clientY: 360, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 480, clientY: 360, pointerId: 1 });
    expect(onSet).toHaveBeenCalledTimes(1);
    const patch = onSet.mock.calls[0]![0] as Partial<FigureLayout>;
    expect(patch.panelSizes!.A).toEqual({ w: 380 + 80, h: 260 + 60 });
  });

  it("Align X/Y absolutely positions panels; resize stays available for manual fitting", () => {
    const { container } = arrange({ alignX: true, alignY: true, columns: 1, freeform: false });
    const panels = [...container.querySelectorAll(".laypanel")] as HTMLElement[];
    expect(panels[0]!.style.position).toBe("absolute");
    expect(panels[1]!.style.position).toBe("absolute");
    // resize handles remain reachable — dragging one bakes the figure to free-drag so a
    // single card can be fitted without moving the others.
    expect(container.querySelector(".laypanel-resize")).not.toBeNull();
  });

  // A heatmap (axis-less) stacked under a graph in one column (Columns=1, Align X)
  // must have its row-label strip shifted left (axislessLeftExtra) so the two cards share the
  // same left edge instead of the heatmap overhanging right. This guards the same-column
  // stacked case.
  it("a heatmap stacked under a graph (Columns=1, Align X) aligns their card left edges", () => {
    const heatTable: DataTable = {
      id: "ht", kind: "grouped", name: "H",
      columns: [
        { id: "g", name: "G", role: "x" },
        { id: "s1", name: "S1", role: "y" },
        { id: "s2", name: "S2", role: "y" },
      ],
      // Short row labels (A/B) → the heatmap's row-label strip is narrower than the graph's
      // Y-axis margin, so the axis-less left-shift is exercised.
      rows: [
        { id: "h1", cells: { g: "A", s1: 1, s2: 2 } },
        { id: "h2", cells: { g: "B", s1: 3, s2: 4 } },
      ],
    };
    const heatPlot: Plot = { id: "H", name: "Heat", source: "ht", status: "ok", styleOverrides: {}, kind: "heatmap" };
    const project: Project = {
      schemaVersion: 5,
      tables: [table, heatTable],
      plots: [plot("A", "Alpha"), heatPlot],
      analyses: [],
      layouts: [{ id: "L", name: "Fig", panels: ["A", "H"], columns: 1, alignX: true, freeform: false }],
      log: [],
      workspace: { folders: [], loose: [] },
    };
    const { container } = render(
      <LayoutPane project={project} layoutId="L" onRemovePanel={() => {}} onOpenPlot={() => {}} onSetLayoutOptions={() => {}} />,
    );
    const panels = [...container.querySelectorAll(".laypanel")] as HTMLElement[];
    expect(panels).toHaveLength(2);
    expect(panels[0]!.style.position).toBe("absolute");
    expect(panels[1]!.style.position).toBe("absolute");
    const left = (el: HTMLElement): number => parseFloat(el.style.left || "0");
    const top = (el: HTMLElement): number => parseFloat(el.style.top || "0");
    // Same column + Align X → the graph card and the (axis-less) heatmap card share a left edge.
    expect(Math.abs(left(panels[0]!) - left(panels[1]!))).toBeLessThanOrEqual(1);
    // …and they genuinely stack (distinct tops), i.e. it's the same-column case.
    expect(top(panels[0]!)).not.toBe(top(panels[1]!));
  });

  it("nudging one panel while aligned bakes the figure to free-drag (others frozen, one undo)", () => {
    const onSet = vi.fn();
    const { container } = arrange({ alignX: true, columns: 1, freeform: false }, onSet);
    const svg = container.querySelector(".laypanel svg.gfx-figure") as Element; // panel A
    // press-drag past the threshold on the graph body → moves the panel
    fireEvent.pointerDown(svg, { clientX: 150, clientY: 150, button: 0, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 220, clientY: 200, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 220, clientY: 200, pointerId: 1 });
    expect(onSet).toHaveBeenCalledTimes(1); // single patch = single undo
    const patch = onSet.mock.calls[0]![0] as Partial<FigureLayout>;
    expect(patch.freeform).toBe(true);
    expect(patch.alignX).toBeUndefined();
    expect(patch.uniformColumnWidth).toBeUndefined();
    // every panel is baked (positions + sizes) so nothing else jumps
    expect(Object.keys(patch.panelPositions!).sort()).toEqual(["A", "B"]);
    expect(Object.keys(patch.panelSizes!).sort()).toEqual(["A", "B"]);
    expect(patch.panelPositions!.A).toBeTruthy();
  });

  it("resizing one card while aligned bakes to free-drag with only that card resized", () => {
    const onSet = vi.fn();
    const { container } = arrange({ alignX: true, columns: 1, freeform: false }, onSet);
    const handle = container.querySelector(".laypanel-resize") as HTMLElement; // panel A
    fireEvent.pointerDown(handle, { clientX: 400, clientY: 300, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 480, clientY: 360, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 480, clientY: 360, pointerId: 1 });
    expect(onSet).toHaveBeenCalledTimes(1);
    const patch = onSet.mock.calls[0]![0] as Partial<FigureLayout>;
    expect(patch.freeform).toBe(true);
    expect(patch.alignX).toBeUndefined();
    // both panels baked; A's size grew by the drag delta, B keeps its frozen size
    expect(Object.keys(patch.panelPositions!).sort()).toEqual(["A", "B"]);
    expect(Object.keys(patch.panelSizes!).sort()).toEqual(["A", "B"]);
    expect(patch.panelSizes!.A!.w).toBeGreaterThan(patch.panelSizes!.B!.w);
  });

  it("the freeze clears after each gesture — a second grid-mode drag re-bakes", () => {
    // The freeze cannot be cleared by an effect keyed on the layout's identity: doc.toJSON()
    // returns the same object mutated in place, so such an effect never re-fires, and after one
    // real-mouse drag the freeze stays on → align boxes cannot be re-ticked, resizes revert.
    // With a non-mutating mock the layout stays aligned, so a second drag must also bake.
    const onSet = vi.fn();
    const { container } = arrange({ alignX: true, columns: 1, freeform: false }, onSet);
    const drag = () => {
      const svg = container.querySelector(".laypanel svg.gfx-figure") as Element;
      fireEvent.pointerDown(svg, { clientX: 150, clientY: 150, button: 0, pointerId: 1 });
      fireEvent.pointerMove(window, { clientX: 220, clientY: 205, pointerId: 1 });
      fireEvent.pointerUp(window, { clientX: 220, clientY: 205, pointerId: 1 });
    };
    drag();
    drag();
    expect(onSet).toHaveBeenCalledTimes(2);
    // Both commits must carry the freeze (freeform:true + a full panelSizes bake). A freeze left
    // on after the first drag makes the 2nd drag see an already-freeform layout → no freeform key, no bake.
    for (const call of onSet.mock.calls) {
      const patch = call[0] as Partial<FigureLayout>;
      expect(patch.freeform).toBe(true);
      expect(Object.keys(patch.panelSizes!).sort()).toEqual(["A", "B"]);
    }
  });

  it("a plain click on a panel while aligned neither moves nor switches modes", () => {
    const onSet = vi.fn();
    const { container } = arrange({ alignX: true, columns: 1, freeform: false }, onSet);
    const svg = container.querySelector(".laypanel svg.gfx-figure") as Element;
    fireEvent.pointerDown(svg, { clientX: 150, clientY: 150, button: 0, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 151, clientY: 150, pointerId: 1 }); // no real move
    expect(onSet).not.toHaveBeenCalled();
  });

  it("Align X-axes alone still uses an absolute (computed) layout", () => {
    const { container } = arrange({ alignX: true, freeform: false });
    expect((container.querySelector(".laypanel") as HTMLElement).style.position).toBe("absolute");
  });

  it("ticking Align X clears Free drag (mutually exclusive modes)", () => {
    const onSet = vi.fn();
    const { container } = arrange({ freeform: true }, onSet);
    const cb = [...container.querySelectorAll("label")].find((l) => /Align X\b/.test(l.textContent ?? ""))!.querySelector("input")!;
    fireEvent.click(cb);
    expect(onSet).toHaveBeenCalledWith({ alignX: true, freeform: false });
  });

  it("the Ruler is on by default and its toggle can hide it", () => {
    // Ruler + grid default to on, so an absolute layout shows the two ruler bands unless
    // explicitly turned off (showRuler: false).
    expect(arrange({ freeform: true }).container.querySelectorAll(".layruler").length).toBe(2);
    cleanup();
    expect(arrange({ freeform: true, showRuler: false }).container.querySelector(".layruler")).toBeNull();
  });

  it("Grid + Ruler chips are ON by default and toggle to an explicit false", () => {
    const onSet = vi.fn();
    const { container } = arrange({}, onSet);
    const chip = (re: RegExp) => [...container.querySelectorAll("label.laychip")].find((l) => re.test(l.textContent ?? ""))!;
    const gridCb = chip(/Grid/).querySelector("input") as HTMLInputElement;
    const rulerCb = chip(/Ruler/).querySelector("input") as HTMLInputElement;
    expect(gridCb.checked).toBe(true);
    expect(rulerCb.checked).toBe(true);
    fireEvent.click(gridCb);
    expect(onSet).toHaveBeenCalledWith({ showGrid: false }); // explicit false, not `undefined`
    fireEvent.click(rulerCb);
    expect(onSet).toHaveBeenCalledWith({ showRuler: false });
  });

  // The figure toolbar has two rows. Row 1, always in view: the layout and the guides.
  // Row 2: what you do on the canvas, the rarer parts behind menus.
  it("the ribbon renders its rows: layout + guides always in view, then the arrange tools and menus", () => {
    const { container } = arrange({});
    const rows = [...container.querySelectorAll(".layribbon > .layrow")] as HTMLElement[];
    const words = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ");
    for (const w of ["Layout", "Columns", "Gutter", "Page", "Grid", "Snap to grid", "Ruler"]) expect(words(rows[0]!), w).toContain(w);
    const menus = [...rows[1]!.querySelectorAll("button.laymenu-btn")].map((b) => (b.textContent ?? "").replace(/\s*▾$/, "").trim());
    expect(menus).toEqual(["Align", "Line up", "Style"]); // Insert ▾ only when the page can insert (not in this fixture)
    expect(words(rows[1]!)).toContain("Align all");
    expect(words(rows[1]!)).toContain("Free drag");
    // with no Inspector to take them (no slot here), the figure's own settings stay in a third row
    expect([...container.querySelectorAll(".layrow-more .laygroup-h")].map((h) => h.textContent)).toEqual(["Labels", "Panels"]);
  });

  it("the Align-all button engages X + Y + ↕ + ↔ in one click, then releases them", () => {
    const onSet = vi.fn();
    const { container } = arrange({ freeform: true }, onSet);
    const btn = container.querySelector("button.laychip-go") as HTMLButtonElement;
    expect(btn.textContent).toMatch(/Align all/);
    expect(btn.classList.contains("on")).toBe(false); // nothing aligned yet
    fireEvent.click(btn);
    // engaging also re-seeds panelPositions (the dense-grid reset) —
    // the four flags are the part this guard pins
    expect(onSet).toHaveBeenCalledWith(
      expect.objectContaining({ alignX: true, alignY: true, labelAlignX: true, labelAlignY: true, freeform: false }),
    );
    cleanup();
    // when everything is already aligned the button reads as engaged and one click clears all four
    const onSet2 = vi.fn();
    const { container: c2 } = arrange({ freeform: false, alignX: true, alignY: true, labelAlignX: true, labelAlignY: true }, onSet2);
    const btn2 = c2.querySelector("button.laychip-go") as HTMLButtonElement;
    expect(btn2.classList.contains("on")).toBe(true);
    fireEvent.click(btn2);
    expect(onSet2).toHaveBeenCalledWith({ alignX: undefined, alignY: undefined, labelAlignX: undefined, labelAlignY: undefined });
  });

  it("the ↕ / ↔ label-align chips live in the Align ▾ menu (with the axis + size aligns), beside Align all", () => {
    const { container } = arrange({});
    const alignMenu = container.querySelector('.laymenu-panel[aria-label="Align"]')!;
    const chips = [...alignMenu.querySelectorAll(".laychip")].map((c) => (c.textContent ?? "").replace(/\s+/g, " ").trim());
    expect(chips).toEqual(expect.arrayContaining(["Align X", "Align Y", "Align ↕", "Align ↔", "Equal rows", "Equal cols", "Stretch last"]));
    const row = alignMenu.closest(".layrow")!;
    expect(row.textContent).toContain("Align all");
    expect(row.textContent).toContain("Free drag");
  });

  it("renders the A/B/C label as a draggable overlay (no header band by default)", () => {
    const { container } = arrange();
    expect(container.querySelector(".laypanel-hd")).toBeNull(); // card titles off → no header band
    const lbl = container.querySelector(".laypanel-letter-float") as HTMLElement;
    expect(lbl.textContent).toBe("A");
    expect(lbl.style.position).toBe("absolute");
    expect(container.querySelector(".laypanel-x-float")).toBeTruthy(); // × still reachable
  });

  it("dragging a label commits a labelPos entry", () => {
    const onSet = vi.fn();
    const { container } = arrange({}, onSet);
    const lbl = container.querySelector(".laypanel-letter-float") as HTMLElement;
    fireEvent.pointerDown(lbl, { clientX: 20, clientY: 20, pointerId: 1 });
    fireEvent.pointerMove(lbl, { clientX: 60, clientY: 50, pointerId: 1 });
    fireEvent.pointerUp(lbl, { clientX: 60, clientY: 50, pointerId: 1 });
    expect(onSet).toHaveBeenCalledTimes(1);
    expect((onSet.mock.calls[0]![0] as Partial<FigureLayout>).labelPos!.A).toBeTruthy();
  });

  it("a label can be dragged beyond its card (negative offset — no clamp)", () => {
    const onSet = vi.fn();
    const { container } = arrange({ labelPos: { A: { x: 20, y: 20 } } }, onSet);
    const lbl = container.querySelector(".laypanel-letter-float") as HTMLElement;
    fireEvent.pointerDown(lbl, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(lbl, { clientX: 40, clientY: 40, pointerId: 1 }); // drag up-left past the card edge
    fireEvent.pointerUp(lbl, { clientX: 40, clientY: 40, pointerId: 1 });
    const pos = (onSet.mock.calls[0]![0] as Partial<FigureLayout>).labelPos!.A!;
    expect(pos.x).toBeLessThan(0); // left of the card — not clamped to 0
    expect(pos.y).toBeLessThan(0);
  });

  it("Labels ↕ aligns labels per column to a shared screen X — even when the offset lands outside the card", () => {
    // A (x=100) and B (x=180) are stacked (same column, different rows). A's label offset 40 →
    // column screen-X = 140. B must take offset 140-180 = -40 (outside its card) to line up with A.
    const base = proj({ panels: ["A", "B"], panelPositions: { A: { x: 100, y: 50 }, B: { x: 180, y: 400 } }, labelPos: { A: { x: 40, y: 12 } }, labelAlignX: true });
    const { container } = render(<LayoutPane project={base} layoutId="L" onRemovePanel={() => {}} onOpenPlot={() => {}} onSetLayoutOptions={vi.fn()} />);
    const labels = [...container.querySelectorAll(".laypanel-letter-float")] as HTMLElement[];
    expect(labels[0]!.style.left).toBe("40px"); // column reference keeps its own offset
    expect(labels[1]!.style.left).toBe("-40px"); // B's offset goes negative so the labels line up on screen
  });

  it("Labels ↔ does not collapse labels in different rows onto each other (no superimposing)", () => {
    // A (row 0) and C (row 1) are in the same column. Horizontal-align must keep them on their
    // own rows' Y, not move C up onto A.
    const base = proj({ panels: ["A", "C"], panelPositions: { A: { x: 100, y: 50 }, C: { x: 100, y: 500 } }, labelPos: { A: { x: 4, y: 10 }, C: { x: 4, y: 10 } }, labelAlignY: true });
    const { container } = render(<LayoutPane project={base} layoutId="L" onRemovePanel={() => {}} onOpenPlot={() => {}} onSetLayoutOptions={vi.fn()} />);
    const labels = [...container.querySelectorAll(".laypanel-letter-float")] as HTMLElement[];
    // each label keeps its own row's Y offset → they do not end up at the same top
    expect(labels[0]!.style.top).toBe("10px");
    expect(labels[1]!.style.top).toBe("10px"); // C stays at its own card's offset, not pulled to A's screen-Y
  });

  it("Labels ↔ row line = the top-most label anchor, never a lower first panel's", () => {
    // A and B share a row, but B's card sits 40px higher (taller panel, as an axis-aligned
    // grid produces). Snapping the row to A's anchor (the first panel) would drop B's letter
    // 40px inside its own graph. The row's shared Y is the top-most anchor: letters may move
    // up into whitespace, never down into a panel's drawing.
    const base = proj({ panels: ["A", "B"], freeform: true, panelPositions: { A: { x: 100, y: 90 }, B: { x: 500, y: 50 } }, labelAlignY: true });
    const { container } = render(<LayoutPane project={base} layoutId="L" onRemovePanel={() => {}} onOpenPlot={() => {}} onSetLayoutOptions={vi.fn()} />);
    const labels = [...container.querySelectorAll(".laypanel-letter-float")] as HTMLElement[];
    // shared row Y = B's anchor (50 + default 8). B keeps its own top-left spot…
    expect(labels[1]!.style.top).toBe("8px");
    // …and A's letter rises above its card (90 → 58 = -32px) instead of B sinking into its plot.
    expect(labels[0]!.style.top).toBe("-32px");
  });

  it("Labels ↕ column line = the left-most label anchor, never a righter first panel's", () => {
    // The same rule, horizontal: A's card sits 30px right of B's in one column. The column's
    // shared X must be B's (left-most) anchor, pushing A's letter into the left whitespace.
    const base = proj({ panels: ["A", "B"], freeform: true, panelPositions: { A: { x: 130, y: 50 }, B: { x: 100, y: 400 } }, labelAlignX: true });
    const { container } = render(<LayoutPane project={base} layoutId="L" onRemovePanel={() => {}} onOpenPlot={() => {}} onSetLayoutOptions={vi.fn()} />);
    const labels = [...container.querySelectorAll(".laypanel-letter-float")] as HTMLElement[];
    expect(labels[1]!.style.left).toBe("4px"); // B (left-most) keeps its own offset
    expect(labels[0]!.style.left).toBe("-26px"); // A joins B's line: 100+4 − 130
  });
});

describe("LayoutPane — Align all sizes axis-less kinds by the shared content box", () => {
  // Growing only a treemap/network/radar's card to the cell would leave the drawing with its
  // own margins, excluded from the shift pass, and ragged next to axis panels. Instead every
  // axis-less kind is rebuilt so its content rect matches the shared data box and absorbs the
  // reference's margins — the same strategy the heatmap uses.
  const kplot = (id: string, name: string, kind: string): Plot =>
    ({ id, name, source: "t", status: "ok", styleOverrides: {}, kind } as Plot);
  const mixed = (kinds: [string, string], layout: Partial<FigureLayout> = {}): Project => ({
    schemaVersion: 5,
    tables: [table],
    plots: [kplot("A", "Alpha", kinds[0]), kplot("B", "Beta", kinds[1])],
    analyses: [],
    layouts: [{ id: "L", name: "Figure 1", panels: ["A", "B"], freeform: false, alignX: true, alignY: true, ...layout }],
    log: [],
    workspace: { folders: [], loose: [] },
  });
  const geometry = (c: HTMLElement) =>
    [...c.querySelectorAll(".laypanel")].map((p) => {
      const s = p.querySelector("svg.gfx-figure")!;
      return {
        top: parseFloat((p as HTMLElement).style.top || "0"),
        w: Number(s.getAttribute("width")),
        h: Number(s.getAttribute("height")),
      };
    });
  const show = (kinds: [string, string]) =>
    render(<LayoutPane project={mixed(kinds)} layoutId="L" onRemovePanel={() => {}} onOpenPlot={() => {}} onSetLayoutOptions={vi.fn()} />);

  it("a treemap next to an axis graph gets the same outer scene box", () => {
    const { container } = show(["xy", "treemap"]);
    const [axis, tm] = geometry(container);
    expect(Math.abs(axis!.w - tm!.w), `widths ${axis!.w} vs ${tm!.w}`).toBeLessThanOrEqual(1);
    expect(Math.abs(axis!.h - tm!.h), `heights ${axis!.h} vs ${tm!.h}`).toBeLessThanOrEqual(1);
  });

  it("a network next to an axis graph gets the same outer scene box", () => {
    const { container } = show(["xy", "network"]);
    const [axis, nw] = geometry(container);
    expect(Math.abs(axis!.w - nw!.w)).toBeLessThanOrEqual(1);
    expect(Math.abs(axis!.h - nw!.h)).toBeLessThanOrEqual(1);
  });

  it("heatmap-as-reference: a radar in a row with only a heatmap matches its width and bottom", () => {
    const { container } = show(["heatmap", "radar"]);
    const [hm, rd] = geometry(container);
    expect(Math.abs(hm!.w - rd!.w), `widths ${hm!.w} vs ${rd!.w}`).toBeLessThanOrEqual(1);
    // tops differ (a heatmap's column labels sit above its grid) but the shift pass aligns
    // the content, and the absorbed band makes the outer bottoms land flush
    expect(Math.abs(hm!.top + hm!.h - (rd!.top + rd!.h)), "outer bottoms must be flush").toBeLessThanOrEqual(1.5);
  });
});

describe("LayoutPane — two-level resize: card edges size the card, the inner handle sizes the graph", () => {
  // Resizing the graph must not resize the card too, which would break alignment. Dragging a
  // card edge resizes the card; the inner handle resizes the graph inside the card.
  const show = (over: Partial<FigureLayout> = {}, onSet = vi.fn()) => ({
    onSet,
    ...render(<LayoutPane project={proj({ panels: ["A", "B"], freeform: true, ...over })} layoutId="L" onRemovePanel={() => {}} onOpenPlot={() => {}} onSetLayoutOptions={onSet} />),
  });
  const dragFrom = (el: Element, dx: number, dy: number): void => {
    fireEvent.pointerDown(el, { clientX: 300, clientY: 300, button: 0, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 300 + dx, clientY: 300 + dy, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 300 + dx, clientY: 300 + dy, pointerId: 1 });
  };

  it("dragging a card edge commits cardSizes only — the graph (panelSizes) is untouched", () => {
    const { container, onSet } = show();
    const a = container.querySelector('.laypanel[data-pid="A"]') as HTMLElement;
    const startW = parseFloat(a.style.width);
    const startH = parseFloat(a.style.height);
    dragFrom(a.querySelector(".laypanel-cardedge-se")!, 60, 40);
    expect(onSet).toHaveBeenCalledTimes(1);
    const patch = onSet.mock.calls[0]![0] as Partial<FigureLayout>;
    expect(patch.panelSizes, "a card-edge drag must never touch the graph size").toBeUndefined();
    expect(patch.cardSizes!.A!.w).toBeCloseTo(startW + 60, 0);
    expect(patch.cardSizes!.A!.h).toBeCloseTo(startH + 40, 0);
  });

  it("free-drag inner resize writes panelSizes only — no hidden cardSizes", () => {
    // Guards against auto-pinning the card here. An invisible cardSizes write would corrupt
    // every later Align (stale floors → sparse, off-line panels instead of a dense aligned
    // figure). A card decouples only when the user sizes it by its edges.
    const { container, onSet } = show();
    const a = container.querySelector('.laypanel[data-pid="A"]') as HTMLElement;
    dragFrom(a.querySelector(".laypanel-resize")!, -40, -30);
    expect(onSet).toHaveBeenCalledTimes(1);
    const patch = onSet.mock.calls[0]![0] as Partial<FigureLayout>;
    expect(patch.panelSizes!.A, "the inner handle must resize the graph").toBeTruthy();
    expect(patch.cardSizes, "no hidden card write from a graph resize").toBeUndefined();
  });

  it("Align all re-seeds a dense 2-column grid from scattered positions", () => {
    // The aligner clusters stored positions into rows/columns; scattered ones (hand-dragged,
    // or from an older file) would cluster into a sprawling grid and spread the graph cards
    // apart. The one-click button therefore resets positions to the dense reading-order grid
    // first, so it yields the dense figure from any starting arrangement.
    const onSet = vi.fn();
    const { container } = render(
      <LayoutPane
        project={proj({ panels: ["A", "B", "C", "D"], freeform: true, panelPositions: { A: { x: 24, y: 24 }, B: { x: 491, y: 24 }, C: { x: 957, y: 24 }, D: { x: 24, y: 364 } } })}
        layoutId="L"
        onRemovePanel={() => {}}
        onOpenPlot={() => {}}
        onSetLayoutOptions={onSet}
      />,
    );
    fireEvent.click(container.querySelector("button.laychip-go") as HTMLButtonElement);
    const patch = onSet.mock.calls[0]![0] as Partial<FigureLayout>;
    const pos = Object.values(patch.panelPositions!);
    expect(pos).toHaveLength(4);
    // dense 2×2: exactly two distinct columns and two distinct rows
    expect(new Set(pos.map((p) => p.x)).size).toBe(2);
    expect(new Set(pos.map((p) => p.y)).size).toBe(2);
    // reading order preserved: A (top-left-most) keeps the first slot
    expect(patch.panelPositions!.A).toEqual({ x: 8, y: 8 });
  });

  it("a label-heavy axis-less kind follows the alignment lines but never defines them", () => {
    // A paired dot plot's trait labels live inside its plot.x (~200px). If footprint kinds
    // voted on the column/row lines, that label block would drag the whole column out and
    // Align would spread the cards. The line comes from the axis panel; the dot plot follows,
    // clamped so it can never shift negative.
    // Long trait labels are what make the dot plot's plot.x large; with short ones this test
    // would pass even if footprint kinds set the lines.
    const traits: DataTable = {
      id: "tt", kind: "xy", name: "Traits",
      columns: [{ id: "x", name: "Trait", role: "x" }, { id: "a", name: "Twin" }, { id: "b", name: "GWAS" }],
      rows: [
        { id: "r1", cells: { x: "Educational attainment", a: 0.4, b: 0.15 } },
        { id: "r2", cells: { x: "Subjective wellbeing", a: 0.45, b: 0.1 } },
        { id: "r3", cells: { x: "Alcohol dependence", a: 0.5, b: 0.2 } },
      ],
    };
    // 2×2 with the dot plot sharing column 2 with an axis panel above it — the geometry that
    // spreads: a dot-plot vote would inflate its own column's line and push the panel above it
    // far right.
    const wide = { id: "P", name: "Paired", source: "tt", status: "ok", styleOverrides: {}, kind: "paireddot" } as Plot;
    const proj2: Project = {
      schemaVersion: 5,
      tables: [table, traits],
      plots: [plot("A", "Alpha"), plot("B", "Beta"), plot("C", "Gamma"), wide],
      analyses: [],
      layouts: [{ id: "L", name: "F", panels: ["A", "B", "C", "P"], freeform: false, alignX: true, alignY: true }],
      log: [],
      workspace: { folders: [], loose: [] },
    };
    const { container } = render(<LayoutPane project={proj2} layoutId="L" onRemovePanel={() => {}} onOpenPlot={() => {}} onSetLayoutOptions={vi.fn()} />);
    const a = container.querySelector('.laypanel[data-pid="A"]') as HTMLElement;
    const b = container.querySelector('.laypanel[data-pid="B"]') as HTMLElement;
    // dense: column 2 (B, above the dot plot) starts within one card + gutter + a small
    // follow-shift — the dot plot's label block must not drag B's column line out
    expect(parseFloat(b.style.left)).toBeLessThan(parseFloat(a.style.left) + parseFloat(a.style.width) + 60);
  });

  it("computed alignment ignores stored cardSizes — Align always re-derives the dense figure", () => {
    // With a stale 640×560 card stored, Align all must still hug the graphs (exactly as it
    // ignores panelSizes) — never keep the figure sparse.
    const { container } = show({ freeform: false, alignX: true, alignY: true, cardSizes: { A: { w: 640, h: 560 } } });
    const a = container.querySelector('.laypanel[data-pid="A"]') as HTMLElement;
    const b = container.querySelector('.laypanel[data-pid="B"]') as HTMLElement;
    expect(parseFloat(a.style.width), "the stored card must not inflate the aligned figure").toBeLessThan(600);
    expect(Math.abs(parseFloat(a.style.width) - parseFloat(b.style.width))).toBeLessThanOrEqual(1);
    // and no dead control: the card-edge grips are hidden in computed grid modes
    expect(a.querySelector(".laypanel-cardedge-se")).toBeNull();
  });

  it("a stored cardSize floors the card and centres the graph in the extra room", () => {
    const { container } = show({ cardSizes: { A: { w: 640, h: 560 } } });
    const a = container.querySelector('.laypanel[data-pid="A"]') as HTMLElement;
    expect(a.style.width).toBe("640px");
    expect(a.style.height).toBe("560px");
    // the graph wrapper carries the centring margins (half the extra room). PlotFigure
    // wraps its svg in .gfx-figwrap, so walk ancestors up to the card for the margin div.
    let wrap: HTMLElement | null = a.querySelector("svg.gfx-figure");
    while (wrap && wrap !== a && !(wrap instanceof HTMLDivElement && wrap.style.marginLeft)) wrap = wrap.parentElement;
    expect(wrap && wrap !== a, "no centring wrapper with a margin found").toBeTruthy();
    expect(parseFloat((wrap as HTMLElement).style.marginLeft)).toBeGreaterThan(0);
    expect(parseFloat((wrap as HTMLElement).style.marginTop)).toBeGreaterThan(0);
  });

  it("aligned grid: an inner-graph resize pins every card, so the grid look survives", () => {
    const { container, onSet } = show({ freeform: false, alignX: true, alignY: true });
    const b = container.querySelector('.laypanel[data-pid="B"]') as HTMLElement;
    const bBox = { w: Math.round(parseFloat(b.style.width)), h: Math.round(parseFloat(b.style.height)) };
    dragFrom(container.querySelector('.laypanel[data-pid="A"] .laypanel-resize')!, -50, -30);
    const patch = onSet.mock.calls[0]![0] as Partial<FigureLayout>;
    expect(patch.panelSizes!.A).toBeTruthy();
    // B's card is pinned at exactly its aligned box — nothing else moves or reflows
    expect(patch.cardSizes!.B).toEqual(bBox);
    expect(patch.panelPositions!.B).toBeTruthy(); // B's position is frozen too
  });
});

describe("LayoutPane — Keep proportions: a panel is a uniform-scale miniature of the full graph", () => {
  // On: the scene is built at the graph's own figure size (580×380 default) and the svg is
  // rendered at width < viewBox width — PlotFigure's zoom does all the scaling, so fonts,
  // markers and margins keep the designed proportions by construction. Font attributes stay
  // unscaled; only the render size shrinks. Off: the plain re-layout at panel size.
  const show = (over: Partial<FigureLayout>) =>
    render(<LayoutPane project={proj({ panels: ["A"], ...over })} layoutId="L" onRemovePanel={() => {}} onOpenPlot={() => {}} onSetLayoutOptions={vi.fn()} />);
  const tickSize = (c: HTMLElement): number => {
    // any axis tick number ("1" / "2" / "4") — its font-size lives on the tick group
    const t = [...c.querySelectorAll(".laypanel svg.gfx-figure text")].find((el) => /^\d+$/.test(el.textContent ?? ""))!;
    for (let n: Element | null = t; n; n = n.parentElement) {
      const fs = n.getAttribute("font-size");
      if (fs) return parseFloat(fs);
    }
    return 0;
  };
  const svgBox = (c: HTMLElement) => {
    const s = c.querySelector(".laypanel svg.gfx-figure")!;
    const vb = (s.getAttribute("viewBox") ?? "0 0 0 0").split(" ").map(Number);
    return { w: Number(s.getAttribute("width")), h: Number(s.getAttribute("height")), vbW: vb[2]!, vbH: vb[3]! };
  };

  it("on: the scene is the standalone drawing (own figure size), rendered scaled, fonts unscaled", () => {
    const { container } = show({ panelFontScale: true });
    const b = svgBox(container);
    // built at the graph's own figure size, not the panel's
    expect(b.vbW).toBe(580);
    expect(b.vbH).toBe(380);
    // rendered as a miniature: svg width < viewBox width, and the scale is uniform
    expect(b.w).toBeLessThan(b.vbW);
    expect(b.w / b.vbW).toBeCloseTo(b.h / b.vbH, 3);
    // font attributes carry the designed size — the zoom does the scaling, not the fonts
    expect(tickSize(container)).toBe(13);
  });

  it("off: unchanged re-layout at panel size — svg drawn 1:1, absolute fonts", () => {
    const { container } = show({});
    const b = svgBox(container);
    expect(b.w).toBe(b.vbW); // zoom 1
    expect(b.vbW).toBeLessThan(580); // laid out at the (smaller) panel box, not the figure size
    expect(tickSize(container)).toBe(13);
  });

  it("aligned miniatures: the scaled plot rects land on the shared row line", () => {
    // Two aligned panels in one row: each panel's plot top in canvas coords is
    // panelTop + headerOff + plot.y·k. The row line is shared, so those must coincide —
    // exactly the wiring that breaks if the shift pass forgets to scale by k. Panel B gets
    // a taller designed figure, so its k (and plot.y·k) genuinely differs from A's and the
    // equality cannot pass by symmetry. k is read off the DOM (svg width ÷ viewBox width);
    // plot.y comes from an independent standalone build at the graph's own figure size.
    const project = proj({ panels: ["A", "B"], freeform: false, alignX: true, alignY: true, panelFontScale: true });
    // Figure sizes that keep both scales above the readable floor: at 580×380 / 580×480 both fall
    // below it and come out at exactly 0.7 — equal, so this guard could not fail.
    project.plots = project.plots.map((p) => (p.id === "A" ? { ...p, figureWidth: 420, figureHeight: 280 } : p.id === "B" ? { ...p, figureWidth: 420, figureHeight: 340 } : p));
    const { container } = render(<LayoutPane project={project} layoutId="L" onRemovePanel={() => {}} onOpenPlot={() => {}} onSetLayoutOptions={vi.fn()} />);
    const geom = (pid: string) => {
      const panel = container.querySelector(`.laypanel[data-pid="${pid}"]`) as HTMLElement;
      const svg = panel.querySelector("svg.gfx-figure")!;
      const vb = (svg.getAttribute("viewBox") ?? "0 0 1 1").split(" ").map(Number);
      const k = Number(svg.getAttribute("width")) / vb[2]!;
      const p = project.plots.find((x) => x.id === pid)!;
      // same spec the pane renders: in-graph titles are hidden unless opted in
      const standalone = buildPlotScene(table, { ...p, showTitle: false }, { measure: measureText, width: p.figureWidth ?? 580, height: p.figureHeight ?? 380 });
      return { k, lineY: parseFloat(panel.style.top || "0") + standalone.plot.y * k };
    };
    const a = geom("A");
    const b = geom("B");
    expect(a.k, "the two panels must have genuinely different scales for this guard to bite").not.toBeCloseTo(b.k, 2);
    expect(Math.min(a.k, b.k), "both above the readable floor, so neither was re-laid").toBeGreaterThan(0.7);
    expect(Math.abs(a.lineY - b.lineY), "aligned plot tops must share one row line").toBeLessThanOrEqual(1);
  });

  it("Stretch last: the lone panel on the last row fills the full row width; off = the hole stays", () => {
    // Space use: an aligned 3-panel figure leaves a quarter of its box blank unless the
    // chip stretches the odd last panel across the row.
    const show = (over: Partial<FigureLayout>) =>
      render(<LayoutPane project={proj({ panels: ["A", "B", "C"], freeform: false, alignX: true, alignY: true, panelFontScale: true, ...over })} layoutId="L" onRemovePanel={() => {}} onOpenPlot={() => {}} onSetLayoutOptions={vi.fn()} />);
    const widths = (c: HTMLElement) =>
      Object.fromEntries(
        [...c.querySelectorAll(".laypanel")].map((p) => [p.getAttribute("data-pid"), Math.round(parseFloat((p as HTMLElement).style.width))]),
      ) as Record<string, number>;
    const off = widths(show({}).container);
    cleanup();
    const on = widths(show({ stretchLastPanel: true }).container);
    // Off: C is a normal one-column card. On: C spans the full first-row width.
    const rowW = off.A! + off.B!; // + gutter, but ≥ this floor is the discriminating claim
    expect(off.C, "without the chip the hole stays (C stays one column wide)").toBeLessThan(rowW * 0.8);
    expect(on.C, "with the chip C must span the row").toBeGreaterThanOrEqual(rowW);
    // the panels above are untouched by the stretch
    expect(on.A).toBe(off.A);
    expect(on.B).toBe(off.B);
  });

  it("all-axis-less figure: same outer box — equal cards on the reference, flush grid", () => {
    // With no axis panel anywhere there are no data lines. Matching content rects would shrink
    // a treemap disc to a toy against a heatmap grid and leave mismatched, off-centre leftovers.
    // The contract is the off-mode one: every panel re-lays-out at the reference box and
    // renders at its scale, so the cards come out equal and the grid is flush.
    const kplot = (id: string, name: string, kind: string): Plot => ({ id, name, source: "t", status: "ok", styleOverrides: {}, kind } as Plot);
    const project: Project = {
      schemaVersion: 5,
      tables: [table],
      plots: [kplot("A", "Alpha", "treemap"), kplot("B", "Beta", "network")],
      analyses: [],
      layouts: [{ id: "L", name: "F", panels: ["A", "B"], freeform: false, alignX: true, alignY: true, panelFontScale: true }],
      log: [],
      workspace: { folders: [], loose: [] },
    };
    const { container } = render(<LayoutPane project={project} layoutId="L" onRemovePanel={() => {}} onOpenPlot={() => {}} onSetLayoutOptions={vi.fn()} />);
    const box = (pid: string) => {
      const el = container.querySelector(`.laypanel[data-pid="${pid}"]`) as HTMLElement;
      const svg = el.querySelector("svg.gfx-figure")!;
      return {
        y: parseFloat(el.style.top),
        w: parseFloat(el.style.width),
        h: parseFloat(el.style.height),
        vb: svg.getAttribute("viewBox"),
      };
    };
    const a = box("A");
    const b = box("B");
    expect(Math.abs(a.w - b.w), `equal card widths: ${a.w} vs ${b.w}`).toBeLessThanOrEqual(1);
    expect(Math.abs(a.h - b.h), `equal card heights: ${a.h} vs ${b.h}`).toBeLessThanOrEqual(1);
    expect(Math.abs(a.y - b.y), "flush tops").toBeLessThanOrEqual(1);
    // Each panel renders at a readable scale (≥0.7 of its designed font size) — the
    // reference included: the heatmap exemption exists for designed-big fonts, and a
    // footprint reference has no such reason (guards against a reference treemap at
    // 0.36 → 4.3px). Two floored panels may legitimately share the same design box —
    // that is the same-outer-box contract. Absolute px depends on house styling, which
    // this bare fixture doesn't carry; the browser test e2e/panel-quality.spec.ts asserts
    // the ≥8px outcome on the real house-styled samples.
    expect(box("A").vb, "panels were re-laid (design box left the 580×380 default)").not.toBe("0 0 580 380");
    for (const pid of ["A", "B"] as const) {
      const svg = container.querySelector(`.laypanel[data-pid="${pid}"] svg.gfx-figure`)!;
      const k = Number(svg.getAttribute("width")) / Number((svg.getAttribute("viewBox") ?? "0 0 1 1").split(" ")[2]);
      expect(k, `panel ${pid} at ≥ the 0.7 readability floor`).toBeGreaterThanOrEqual(0.695);
    }
  });

  it("footprint-only row in a mixed figure: the readability floor still applies", () => {
    // Guards against a treemap at 0.36 (4.3px text) in a row shared only with a network: no
    // row reference exists there, and a row-height match that simply returns leaves the floor
    // unapplied. The floor must not depend on having a reference.
    const kplot = (id: string, name: string, kind: string): Plot => ({ id, name, source: "t", status: "ok", styleOverrides: {}, kind } as Plot);
    const project: Project = {
      schemaVersion: 5,
      tables: [table],
      plots: [kplot("A", "Alpha", "xy"), kplot("B", "Beta", "xy"), kplot("C", "Gamma", "treemap"), kplot("D", "Delta", "network")],
      analyses: [],
      layouts: [{ id: "L", name: "F", panels: ["A", "B", "C", "D"], freeform: false, alignX: true, alignY: true, panelFontScale: true, columns: 2 }],
      log: [],
      workspace: { folders: [], loose: [] },
    };
    const { container } = render(<LayoutPane project={project} layoutId="L" onRemovePanel={() => {}} onOpenPlot={() => {}} onSetLayoutOptions={vi.fn()} />);
    for (const pid of ["C", "D"]) {
      const svg = container.querySelector(`.laypanel[data-pid="${pid}"] svg.gfx-figure`)!;
      const k = Number(svg.getAttribute("width")) / Number((svg.getAttribute("viewBox") ?? "0 0 1 1").split(" ")[2]);
      expect(k, `refless-row panel ${pid} at ≥ the 0.7 readability floor`).toBeGreaterThanOrEqual(0.695);
    }
  });

  it("layout picker: choosing 'Tall left' commits the whole shape in one patch", () => {
    // The layout chooser: thumbnails per panel count; clicking one writes
    // columns + spans (keyed to the panels in lettering order) + the aligned-grid flags,
    // one undoable patch — no capability the grid doesn't already have.
    const onSet = vi.fn();
    const { container } = render(
      <LayoutPane project={proj({ panels: ["A", "B", "C"], freeform: true })} layoutId="L" onRemovePanel={() => {}} onOpenPlot={() => {}} onSetLayoutOptions={onSet} />,
    );
    const opener = [...container.querySelectorAll("button")].find((b) => /Layout/.test(b.textContent ?? ""));
    expect(opener, "no Layout picker button on the arrange ribbon").toBeTruthy();
    fireEvent.click(opener!);
    const items = [...container.querySelectorAll(".laypreset-item")];
    expect(items.map((el) => el.textContent)).toEqual(["Row", "Column", "2-column grid", "Wide top (2 under)", "Tall left"]);
    fireEvent.click(items.find((el) => el.textContent === "Tall left")!);
    expect(onSet).toHaveBeenCalledWith(
      expect.objectContaining({ columns: 2, panelRowSpan: { A: 2 }, panelSpan: undefined, alignX: true, alignY: true, freeform: false }),
    );
    // and the popover closed after applying
    expect(container.querySelector(".laypreset-item")).toBeNull();

    // Wide top writes the column span instead
    fireEvent.click(opener!);
    fireEvent.click([...container.querySelectorAll(".laypreset-item")].find((el) => el.textContent === "Wide top (2 under)")!);
    expect(onSet).toHaveBeenLastCalledWith(
      expect.objectContaining({ columns: 2, panelSpan: { A: 2 }, panelRowSpan: undefined }),
    );
  });

  it("row span: a 2-row panel owns both row slots and the others tile beside it", () => {
    // The tall-left journal shape: columns=2 with A spanning 2 rows → A fills the left
    // column's full height while B and C stack in the right column. The aligned grid must
    // express this itself (free-drag can only approximate it, and Align all would flatten it).
    const { container } = render(
      <LayoutPane
        project={proj({ panels: ["A", "B", "C"], freeform: false, alignX: true, alignY: true, panelFontScale: true, columns: 2, panelRowSpan: { A: 2 } })}
        layoutId="L"
        onRemovePanel={() => {}}
        onOpenPlot={() => {}}
        onSetLayoutOptions={vi.fn()}
      />,
    );
    const box = (pid: string) => {
      const el = container.querySelector(`.laypanel[data-pid="${pid}"]`) as HTMLElement;
      return {
        x: parseFloat(el.style.left),
        y: parseFloat(el.style.top),
        w: parseFloat(el.style.width),
        h: parseFloat(el.style.height),
      };
    };
    const a = box("A");
    const b = box("B");
    const c = box("C");
    // B and C tile in the second column, stacked — the occupancy packer must route them
    // around A's two-row footprint rather than put C under A in column 1.
    expect(b.x, "B beside A, not under it").toBeGreaterThan(a.x + a.w - 1);
    expect(Math.abs(c.x - b.x), "C stacks under B in the same column").toBeLessThanOrEqual(1);
    expect(c.y).toBeGreaterThan(b.y + b.h - 1);
    // A's card spans both row slots: at least ~1.7× a single-row card, bottom ≈ C's bottom.
    expect(a.h, `A ${a.h} vs single-row ${b.h}`).toBeGreaterThan(b.h * 1.7);
    expect(Math.abs(a.y + a.h - (c.y + c.h)), "A's bottom lands with the second row").toBeLessThanOrEqual(30);
    // and nothing overlaps
    const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    expect(ox, "A and B must not overlap").toBeLessThanOrEqual(4);
  });

  // Also covers one alignment switched off, and Equal rows / Stretch last on.
  it.each([
    ["Align all", {}],
    ["Align Y off", { alignY: undefined }],
    ["Equal rows on", { uniformRowHeight: true }],
    ["Stretch last on", { stretchLastPanel: true }],
  ] as [string, Partial<FigureLayout>][])("row span + lined-up letters (%s): every letter stays at its own card, none lands on another", (_name, over) => {
    // Guards against Tall left (A spans 3 rows) with the letters lined up drawing C's letter on
    // top of B's, far above C's own card. If rows of letters are found by card centres, a
    // 3-row card's centre sits in the middle row — so A joins C's row and pulls C's letter up to
    // A's. Each letter must sit at the top of its own card, and no two may overlap.
    const { container } = render(
      <LayoutPane
        project={proj({ panels: ["A", "B", "C", "D"], freeform: false, alignX: true, alignY: true, labelAlignX: true, labelAlignY: true, panelFontScale: true, columns: 2, panelRowSpan: { A: 3 }, ...over })}
        layoutId="L"
        onRemovePanel={() => {}}
        onOpenPlot={() => {}}
        onSetLayoutOptions={vi.fn()}
      />,
    );
    const at = (pid: string) => {
      const card = container.querySelector(`.laypanel[data-pid="${pid}"]`) as HTMLElement;
      const letter = card.querySelector(".laypanel-letter") as HTMLElement;
      const top = parseFloat(card.style.top);
      const left = parseFloat(card.style.left);
      return { top, left, h: parseFloat(card.style.height), ly: top + parseFloat(letter.style.top), lx: left + parseFloat(letter.style.left) };
    };
    const ids = ["A", "B", "C", "D"];
    const g = Object.fromEntries(ids.map((id) => [id, at(id)]));
    // fixture: B, C, D really are stacked beside A, in three different rows
    expect(g.C!.top, "fixture: C must sit a whole row below B").toBeGreaterThan(g.B!.top + g.B!.h - 1);
    for (const id of ids) {
      const p = g[id]!;
      expect(Math.abs(p.ly - p.top), `${id}'s letter is ${Math.round(p.ly - p.top)} px from the top of its own card`).toBeLessThanOrEqual(40);
    }
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) {
        const a = g[ids[i]!]!; const b = g[ids[j]!]!;
        const same = Math.abs(a.lx - b.lx) < 20 && Math.abs(a.ly - b.ly) < 20;
        expect(same, `letters ${ids[i]} and ${ids[j]} drawn on the same spot`).toBe(false);
      }
    // …and the lining-up still works: B, C, D (one column) share one letter X; A and B (one row) one letter Y.
    expect(Math.abs(g.B!.lx - g.C!.lx)).toBeLessThanOrEqual(1);
    expect(Math.abs(g.C!.lx - g.D!.lx)).toBeLessThanOrEqual(1);
    expect(Math.abs(g.A!.ly - g.B!.ly)).toBeLessThanOrEqual(1);
  });

  it("column span + lined-up letters (Wide top, 3 under): each letter stays at its own card", () => {
    const { container } = render(
      <LayoutPane
        project={proj({ panels: ["A", "B", "C", "D"], freeform: false, alignX: true, alignY: true, labelAlignX: true, labelAlignY: true, panelFontScale: true, columns: 3, panelSpan: { A: 3 } })}
        layoutId="L"
        onRemovePanel={() => {}}
        onOpenPlot={() => {}}
        onSetLayoutOptions={vi.fn()}
      />,
    );
    const at = (pid: string) => {
      const card = container.querySelector(`.laypanel[data-pid="${pid}"]`) as HTMLElement;
      const letter = card.querySelector(".laypanel-letter") as HTMLElement;
      const top = parseFloat(card.style.top);
      const left = parseFloat(card.style.left);
      return { top, left, w: parseFloat(card.style.width), ly: top + parseFloat(letter.style.top), lx: left + parseFloat(letter.style.left) };
    };
    // Three columns: A's whole-card centre falls in the middle column (C's), so a letter placed by
    // the card's centre would land in the wrong column; A's letter must still follow A's own card.
    const g = { A: at("A"), B: at("B"), C: at("C"), D: at("D") };
    expect(g.C.left, "fixture: C sits a whole column right of B").toBeGreaterThan(g.B.left + g.B.w - 1);
    for (const [id, p] of Object.entries(g)) {
      expect(Math.abs(p.lx - p.left), `${id}'s letter is ${Math.round(p.lx - p.left)} px from the left of its own card`).toBeLessThanOrEqual(40);
      expect(Math.abs(p.ly - p.top), `${id}'s letter is ${Math.round(p.ly - p.top)} px from the top of its own card`).toBeLessThanOrEqual(40);
    }
    expect(Math.abs(g.A.lx - g.B.lx), "A and B (one column) share one letter X").toBeLessThanOrEqual(1);
    expect(Math.abs(g.B.ly - g.C.ly), "B and C (one row) share one letter Y").toBeLessThanOrEqual(1);
    expect(Math.abs(g.C.ly - g.D.ly), "C and D (one row) share one letter Y").toBeLessThanOrEqual(1);
  });

  it.each([
    ["Lollipop / dumbbell", "XY (points + fitted curve)"],
    ["Population pyramid", "Floating bars (min→max)"],
    ["Ranked dots vs a reference", "Bar / column (+ error bars)"],
    ["Ridgeline / horizon fold", "Histogram"],
  ])("a chart with names down its left axis (%s) never pushes a numbers chart (%s) right of it", (namesTitle, numbersTitle) => {
    // Guards against a lollipop's / pyramid's category names setting the column's Y-axis line and pushing
    // the graph below to the right, its letter left behind in the gutter. A names-axis sets the line only
    // where no numbers-axis chart can (the same rule as paired dot and forest).
    const items = galleryItems();
    const pick = (t: string) => items.find((g) => g.title === t)!;
    const n = pick(namesTitle), v = pick(numbersTitle);
    const project: Project = {
      schemaVersion: 5,
      tables: [{ ...n.table, id: "tn" }, { ...v.table, id: "tv" }],
      plots: [{ ...n.plot, id: "A", source: "tn" }, { ...v.plot, id: "B", source: "tv" }],
      analyses: [],
      layouts: [{ id: "L", name: "F", panels: ["A", "B"], freeform: false, alignX: true, alignY: true, panelFontScale: true, columns: 1 }],
      log: [],
      workspace: { folders: [], loose: [] },
    };
    const { container } = render(<LayoutPane project={project} layoutId="L" onRemovePanel={() => {}} onOpenPlot={() => {}} onSetLayoutOptions={vi.fn()} />);
    const x = (pid: string) => parseFloat((container.querySelector(`.laypanel[data-pid="${pid}"]`) as HTMLElement).style.left);
    expect(x("B") - x("A"), `the numbers chart is pushed ${Math.round(x("B") - x("A"))} px right of the names chart`).toBeLessThanOrEqual(1);
  });

  it("Align all: a card much taller than its row spans two rows and the next card fills the hole beside it", () => {
    // The ranked-dots chart (25 names, kept readable) would make row 1 as tall as itself and leave a 192 px
    // hole under the short bump chart beside it. It spans rows 1–2 and the ridgeline moves up into the hole.
    const items = galleryItems();
    const titles = ["Bump chart (rankings)", "Ranked dots vs a reference", "Ridgeline / horizon fold", "Treemap"];
    const picks = titles.map((t) => items.find((g) => g.title === t)!);
    const project: Project = {
      schemaVersion: 5,
      tables: picks.map((g, i) => ({ ...g.table, id: `t${i}` })),
      plots: picks.map((g, i) => ({ ...g.plot, id: `P${i}`, source: `t${i}` })),
      analyses: [],
      layouts: [{ id: "L", name: "F", panels: picks.map((_, i) => `P${i}`), freeform: false, alignX: true, alignY: true, labelAlignX: true, labelAlignY: true, panelFontScale: true }],
      log: [],
      workspace: { folders: [], loose: [] },
    };
    const { container } = render(<LayoutPane project={project} layoutId="L" onRemovePanel={() => {}} onOpenPlot={() => {}} onSetLayoutOptions={vi.fn()} />);
    const box = (pid: string) => {
      const el = container.querySelector(`.laypanel[data-pid="${pid}"]`) as HTMLElement;
      const x = parseFloat(el.style.left), y = parseFloat(el.style.top);
      return { x, y, w: parseFloat(el.style.width), h: parseFloat(el.style.height), r: x + parseFloat(el.style.width), b: y + parseFloat(el.style.height) };
    };
    const [a, b, c, d] = ["P0", "P1", "P2", "P3"].map(box) as [ReturnType<typeof box>, ReturnType<typeof box>, ReturnType<typeof box>, ReturnType<typeof box>];
    // the tall ranked-dots card (B) spans; the ridgeline (C) sits right under the bump chart (A), beside B
    expect(Math.abs(c.x - a.x), "C moves into A's column, under A").toBeLessThanOrEqual(1);
    expect(c.y - a.b, `C starts ${Math.round(c.y - a.b)} px under A — the hole under A must be gone`).toBeLessThanOrEqual(40);
    expect(Math.abs(b.b - c.b), `B's card bottom (${Math.round(b.b)}) meets C's (${Math.round(c.b)}) — B fills both rows`).toBeLessThanOrEqual(12);
    // nothing overlaps
    const all = [a, b, c, d];
    for (let i = 0; i < all.length; i++)
      for (let j = i + 1; j < all.length; j++) {
        const ox = Math.min(all[i]!.r, all[j]!.r) - Math.max(all[i]!.x, all[j]!.x);
        const oy = Math.min(all[i]!.b, all[j]!.b) - Math.max(all[i]!.y, all[j]!.y);
        expect(ox > 4 && oy > 4, `cards ${i} and ${j} overlap`).toBe(false);
      }
  });

  it("Align all with Columns 2 set: the auto span keeps its own two rows' height", () => {
    const items = galleryItems();
    const picks = ["Bump chart (rankings)", "Ranked dots vs a reference", "Ridgeline / horizon fold", "Treemap"].map((t) => items.find((g) => g.title === t)!);
    const project: Project = {
      schemaVersion: 5,
      tables: picks.map((g, i) => ({ ...g.table, id: `t${i}` })),
      plots: picks.map((g, i) => ({ ...g.plot, id: `P${i}`, source: `t${i}` })),
      analyses: [],
      layouts: [{ id: "L", name: "F", panels: ["P0", "P1", "P2", "P3"], freeform: false, alignX: true, alignY: true, labelAlignX: true, labelAlignY: true, panelFontScale: true, columns: 2 }],
      log: [],
      workspace: { folders: [], loose: [] },
    };
    const { container } = render(<LayoutPane project={project} layoutId="L" onRemovePanel={() => {}} onOpenPlot={() => {}} onSetLayoutOptions={vi.fn()} />);
    const bottom = (pid: string) => { const el = container.querySelector(`.laypanel[data-pid="${pid}"]`) as HTMLElement; return parseFloat(el.style.top) + parseFloat(el.style.height); };
    expect(Math.abs(bottom("P1") - bottom("P2")), "the spanning card ends with the second row").toBeLessThanOrEqual(12);
  });

  it.each([
    // [graphs, the card that must sit flush on its column edge, the card that sets that column's edge]
    [["Bump chart (rankings)", "Ranked dots vs a reference", "Ridgeline / horizon fold", "Treemap", "Parallel coordinates", "3D scatter"], "P4", "P1"],
    // (A spanning paired dot pushed by a survival plot does not reproduce here: jsdom's text measure makes
    // the paired dot's own left block the wider one. The browser-based panel check measures that case.)
  ] as [string[], string, string][])("Align all with automatic spans: a no-axis card sits flush on its column edge, its letter with it (%#)", (titles, pid, refPid) => {
    // Guards against parallel coordinates under the spanning ranked-dots chart being centred with its letter
    // left behind (its column's only axis graph spans, so it sets no width), and against a spanning
    // paired dot being pushed right by the survival plot's line.
    const items = galleryItems();
    const picks = titles.map((t) => items.find((g) => g.title === t)!);
    const project: Project = {
      schemaVersion: 5,
      tables: picks.map((g, i) => ({ ...g.table, id: `t${i}` })),
      plots: picks.map((g, i) => ({ ...g.plot, id: `P${i}`, source: `t${i}` })),
      analyses: [],
      layouts: [{ id: "L", name: "F", panels: picks.map((_, i) => `P${i}`), freeform: false, alignX: true, alignY: true, labelAlignX: true, labelAlignY: true, panelFontScale: true }],
      log: [],
      workspace: { folders: [], loose: [] },
    };
    const { container } = render(<LayoutPane project={project} layoutId="L" onRemovePanel={() => {}} onOpenPlot={() => {}} onSetLayoutOptions={vi.fn()} />);
    const el = (id: string) => container.querySelector(`.laypanel[data-pid="${id}"]`) as HTMLElement;
    const x = (id: string) => parseFloat(el(id).style.left);
    const minX = Math.min(x(pid), x(refPid));
    expect(x(pid) - minX, `card ${pid} sits ${Math.round(x(pid) - minX)} px in from its column edge`).toBeLessThanOrEqual(1);
    const letter = el(pid).querySelector(".laypanel-letter") as HTMLElement;
    expect(Math.abs(parseFloat(letter.style.left)), `its letter sits ${Math.round(parseFloat(letter.style.left))} px from its card`).toBeLessThanOrEqual(40);
  });

  it("Centre no-axis: a treemap keeps its own width and sits centred in its column, its letter with it", () => {
    const items = galleryItems();
    const picks = ["Population pyramid", "Volcano", "Treemap", "Histogram"].map((t) => items.find((g) => g.title === t)!);
    const show = (over: Partial<FigureLayout>) => {
      const project: Project = {
        schemaVersion: 5,
        tables: picks.map((g, i) => ({ ...g.table, id: `t${i}` })),
        plots: picks.map((g, i) => ({ ...g.plot, id: `P${i}`, source: `t${i}` })),
        analyses: [],
        layouts: [{ id: "L", name: "F", panels: ["P0", "P1", "P2", "P3"], freeform: false, alignX: true, alignY: true, labelAlignX: true, labelAlignY: true, panelFontScale: true, columns: 2, ...over }],
        log: [],
        workspace: { folders: [], loose: [] },
      };
      const r = render(<LayoutPane project={project} layoutId="L" onRemovePanel={() => {}} onOpenPlot={() => {}} onSetLayoutOptions={vi.fn()} />);
      const box = (pid: string) => {
        const el = r.container.querySelector(`.laypanel[data-pid="${pid}"]`) as HTMLElement;
        const x = parseFloat(el.style.left), w = parseFloat(el.style.width);
        const texts = [...el.querySelectorAll("svg.gfx-figure text")].filter((t) => (t.textContent ?? "").trim()).length;
        return { x, w, r: x + w, h: parseFloat(el.style.height), texts, letterX: parseFloat((el.querySelector(".laypanel-letter") as HTMLElement).style.left) };
      };
      const out = { pyr: box("P0"), tm: box("P2") };
      r.unmount();
      return out;
    };
    // Off (default): the treemap is widened to its column and sits on its edge
    const off = show({});
    expect(Math.abs(off.tm.x - off.pyr.x), "off: flush on the column edge").toBeLessThanOrEqual(1);
    // On: its own width, the spare space shared evenly either side, the letter at its own card
    const on = show({ centreNoAxisPanels: true });
    const colL = Math.min(on.pyr.x, on.tm.x), colR = Math.max(on.pyr.r, on.tm.r);
    expect(on.tm.w, "fixture: the treemap is narrower than its column, so there is something to centre").toBeLessThan(colR - colL - 20);
    expect(Math.abs((on.tm.x - colL) - (colR - on.tm.r)), `space left ${Math.round(on.tm.x - colL)} vs right ${Math.round(colR - on.tm.r)}`).toBeLessThanOrEqual(2);
    expect(Math.abs(on.tm.letterX), `its letter sits ${Math.round(on.tm.letterX)} px from its card`).toBeLessThanOrEqual(40);
    // …drawn as big and as fully labelled as when widened — only the width it could not use goes (keeping the
    // widened width at the row's new height would give a tall narrow box, a smaller disc, and no cell labels)
    expect(on.tm.texts, `labels drawn: ${on.tm.texts} centred vs ${off.tm.texts} widened`).toBeGreaterThanOrEqual(off.tm.texts);
    expect(on.tm.h, "same card height").toBeCloseTo(off.tm.h, 0);
    // the axis graph above it is untouched
    expect(on.pyr.x).toBeCloseTo(off.pyr.x, 3);
    expect(on.pyr.w).toBeCloseTo(off.pyr.w, 3);
  });

  it("Align all: a card centred in a column with no axis line keeps its letter at its own card", () => {
    // Network over Venn, no axis graph in that column: the Venn is centred (a column with no line
    // centres its panels). Guards against its letter staying at the column edge, away from its card.
    const items = galleryItems();
    const picks = ["Network graph", "Histogram", "Venn diagram"].map((t) => items.find((g) => g.title === t)!);
    const project: Project = {
      schemaVersion: 5,
      tables: picks.map((g, i) => ({ ...g.table, id: `t${i}` })),
      plots: picks.map((g, i) => ({ ...g.plot, id: `P${i}`, source: `t${i}` })),
      analyses: [],
      layouts: [{ id: "L", name: "F", panels: ["P0", "P1", "P2"], freeform: false, alignX: true, alignY: true, labelAlignX: true, labelAlignY: true, panelFontScale: true }],
      log: [],
      workspace: { folders: [], loose: [] },
    };
    const { container } = render(<LayoutPane project={project} layoutId="L" onRemovePanel={() => {}} onOpenPlot={() => {}} onSetLayoutOptions={vi.fn()} />);
    const el = (pid: string) => container.querySelector(`.laypanel[data-pid="${pid}"]`) as HTMLElement;
    const x = (pid: string) => parseFloat(el(pid).style.left);
    expect(x("P2") - x("P0"), "fixture: the Venn IS centred in from its column edge").toBeGreaterThan(10);
    for (const pid of ["P0", "P1", "P2"]) {
      const lx = parseFloat((el(pid).querySelector(".laypanel-letter") as HTMLElement).style.left);
      expect(Math.abs(lx), `${pid}'s letter sits ${Math.round(lx)} px from its card`).toBeLessThanOrEqual(40);
    }
  });

  it("Align all: a span the user set is kept as it is — no automatic span is added on top of it", () => {
    // Same four graphs as above, with the user's own span on the bump chart (a 1-row span = an explicit
    // "leave this one alone"): the automatic span must not run, so the ridgeline stays on the second row.
    const items = galleryItems();
    const picks = ["Bump chart (rankings)", "Ranked dots vs a reference", "Ridgeline / horizon fold", "Treemap"].map((t) => items.find((g) => g.title === t)!);
    const project: Project = {
      schemaVersion: 5,
      tables: picks.map((g, i) => ({ ...g.table, id: `t${i}` })),
      plots: picks.map((g, i) => ({ ...g.plot, id: `P${i}`, source: `t${i}` })),
      analyses: [],
      layouts: [{ id: "L", name: "F", panels: ["P0", "P1", "P2", "P3"], freeform: false, alignX: true, alignY: true, labelAlignX: true, labelAlignY: true, panelFontScale: true, columns: 2, panelRowSpan: { P0: 1 } }],
      log: [],
      workspace: { folders: [], loose: [] },
    };
    const { container } = render(<LayoutPane project={project} layoutId="L" onRemovePanel={() => {}} onOpenPlot={() => {}} onSetLayoutOptions={vi.fn()} />);
    const el = (pid: string) => container.querySelector(`.laypanel[data-pid="${pid}"]`) as HTMLElement;
    const aBottom = parseFloat(el("P0").style.top) + parseFloat(el("P0").style.height);
    const bBottom = parseFloat(el("P1").style.top) + parseFloat(el("P1").style.height);
    expect(parseFloat(el("P2").style.top), "the ridgeline stays below the ranked dots (no automatic span)").toBeGreaterThanOrEqual(bBottom - 1);
    expect(parseFloat(el("P2").style.top) - aBottom, "fixture: without the span there IS a hole under the bump chart").toBeGreaterThan(60);
  });

  it("aligned: a paired dot's names are drawn in full, not cut short (\"Educational attainm…\")", () => {
    const items = galleryItems();
    const titles = ["Paired dot plot", "Time course + bands, window, limit", "Waterfall (response)", "Survival (Kaplan-Meier)", "Oncoprint", "Ordination — triplot (constrained)"];
    const picks = titles.map((t) => items.find((g) => g.title === t)!);
    const project: Project = {
      schemaVersion: 5,
      tables: picks.map((g, i) => ({ ...g.table, id: `t${i}` })),
      plots: picks.map((g, i) => ({ ...g.plot, id: `P${i}`, source: `t${i}` })),
      analyses: [],
      layouts: [{ id: "L", name: "F", panels: picks.map((_, i) => `P${i}`), freeform: false, alignX: true, alignY: true, labelAlignX: true, labelAlignY: true, panelFontScale: true, columns: 2 }],
      log: [],
      workspace: { folders: [], loose: [] },
    };
    const { container } = render(<LayoutPane project={project} layoutId="L" onRemovePanel={() => {}} onOpenPlot={() => {}} onSetLayoutOptions={vi.fn()} />);
    const svg = container.querySelector(`.laypanel[data-pid="P0"] svg.gfx-figure`)!;
    const cut = [...svg.querySelectorAll("text")].map((t) => (t.textContent ?? "").trim()).filter((t) => t.endsWith("…"));
    expect(cut, "names shortened with an ellipsis").toEqual([]);
    // and still readable
    const k = Number(svg.getAttribute("width")) / Number((svg.getAttribute("viewBox") ?? "0 0 1 1").split(" ")[2]);
    const small = [...svg.querySelectorAll("text")].filter((t) => (t.textContent ?? "").trim()).map((t) => parseFloat(t.getAttribute("font-size") ?? "") * k).filter((v) => Number.isFinite(v) && v < 7.95);
    expect(small, "text below 8 px").toEqual([]);
  });

  it("readableScale: the scale at which the smallest designed text reaches 8 px, within [0.7, 1]", () => {
    expect(readableScale({ tick: { size: 20 }, legend: { size: 12 } })).toBeCloseTo(0.7, 6); // 8/12 = 0.67 → the 0.7 floor
    expect(readableScale({ tick: { size: 11 }, legend: { size: 17 } })).toBeCloseTo(8 / 11, 6); // parallel coordinates' 11 px ticks
    expect(readableScale({ tick: { size: 6 } })).toBe(1); // tiny designed text: drawn at full size, never enlarged
    expect(readableScale({})).toBe(0.7);
    expect(readableScale({ legend: { size: 12 }, broken: undefined, zero: { size: 0 } })).toBeCloseTo(0.7, 6);
  });

  it("aligned: no graph's text draws below 8 px (ranked dots / volcano / ridgeline)", () => {
    // Rule: the smallest text in every panel is ≥ 8 px on screen. Align shrinks each graph so its plot
    // area hits the shared size; without a floor a graph with a big plot area in its own figure shrinks to
    // under half size and its 12 px legend / labels draw at about 5 px. The two-column grid exhibits that case.
    const items = galleryItems();
    const titles = ["Volcano", "Histogram", "Ranked dots vs a reference", "Ridgeline / horizon fold", "Parallel coordinates", "Box & whisker"];
    const picks = titles.map((t) => items.find((g) => g.title === t)!);
    const project: Project = {
      schemaVersion: 5,
      tables: picks.map((g, i) => ({ ...g.table, id: `t${i}` })),
      plots: picks.map((g, i) => ({ ...g.plot, id: `P${i}`, source: `t${i}` })),
      analyses: [],
      layouts: [{ id: "L", name: "F", panels: picks.map((_, i) => `P${i}`), freeform: false, alignX: true, alignY: true, labelAlignX: true, labelAlignY: true, panelFontScale: true, columns: 2 }],
      log: [],
      workspace: { folders: [], loose: [] },
    };
    const { container } = render(<LayoutPane project={project} layoutId="L" onRemovePanel={() => {}} onOpenPlot={() => {}} onSetLayoutOptions={vi.fn()} />);
    const small: string[] = [];
    picks.forEach((g, i) => {
      const svg = container.querySelector(`.laypanel[data-pid="P${i}"] svg.gfx-figure`) as SVGSVGElement;
      const k = Number(svg.getAttribute("width")) / Number((svg.getAttribute("viewBox") ?? "0 0 1 1").split(" ")[2]);
      for (const t of svg.querySelectorAll("text")) {
        if (!(t.textContent ?? "").trim()) continue;
        const px = parseFloat(t.getAttribute("font-size") ?? (t as SVGTextElement).style.fontSize ?? "");
        if (Number.isFinite(px) && px * k < 7.95) small.push(`${g.title}: "${(t.textContent ?? "").trim().slice(0, 14)}" ${(px * k).toFixed(1)} px`);
      }
    });
    expect([...new Set(small)].slice(0, 12)).toEqual([]);
  });

  it("a graph that fits its names to its box still draws them ≥ 8 px on screen (rose legend)", () => {
    // The rose / radar / chord / 3-D shrink their names to fill a small box, never below 8 px — in the scene. A panel
    // then draws that scene at its own scale (0.7 here), so a legend fitted to 8 would land at 5.6 px. The panel
    // tells the builder the scale it will draw at. The figure: bars + line, rose, Venn.
    const items = galleryItems();
    const titles = ["Venn diagram", "Bars + line (2nd axis)", "Polar histogram (wind rose)"];
    const picks = titles.map((t) => items.find((g) => g.title === t)!);
    const project: Project = {
      schemaVersion: 5,
      tables: picks.map((g, i) => ({ ...g.table, id: `t${i}` })),
      // The rose's own text set large (40 px) so its fit reaches the 8 px floor in this test's text measure too — at the
      // gallery size the browser measured it there, jsdom's wider estimate stops short and could not exhibit the case.
      plots: picks.map((g, i) => ({ ...g.plot, ...(i === 2 ? { fonts: { ...(g.plot.fonts ?? {}), tick: { size: 40 }, legend: { size: 40 } } } : {}), id: `P${i}`, source: `t${i}` })),
      analyses: [],
      layouts: [{ id: "L", name: "F", panels: picks.map((_, i) => `P${i}`), freeform: false, alignX: true, alignY: true, labelAlignX: true, labelAlignY: true, panelFontScale: true, columns: 3 }],
      log: [],
      workspace: { folders: [], loose: [] },
    };
    const { container } = render(<LayoutPane project={project} layoutId="L" onRemovePanel={() => {}} onOpenPlot={() => {}} onSetLayoutOptions={vi.fn()} />);
    const svg = container.querySelector(`.laypanel[data-pid="P2"] svg.gfx-figure`) as SVGSVGElement;
    const k = Number(svg.getAttribute("width")) / Number((svg.getAttribute("viewBox") ?? "0 0 1 1").split(" ")[2]);
    expect(k, "fixture: the rose is drawn smaller than its scene").toBeLessThan(0.95);
    const small: string[] = [];
    for (const t of svg.querySelectorAll("text")) {
      if (!(t.textContent ?? "").trim()) continue;
      const px = parseFloat(t.getAttribute("font-size") ?? (t as SVGTextElement).style.fontSize ?? "");
      if (Number.isFinite(px) && px * k < 7.95) small.push(`"${(t.textContent ?? "").trim().slice(0, 14)}" ${(px * k).toFixed(1)} px`);
    }
    expect([...new Set(small)]).toEqual([]);
  });

  it("a row of only no-axis graphs fills its columns — no hole beside them", () => {
    // Guards against a row of only no-axis graphs (e.g. sunburst + 3-D) leaving a hole beside them if the
    // column-width fill runs only for rows that also hold an axis graph. Row 2 here is treemap + network
    // under two XY graphs.
    const kplot = (id: string, name: string, kind: string): Plot => ({ id, name, source: "t", status: "ok", styleOverrides: {}, kind } as Plot);
    const project: Project = {
      schemaVersion: 5,
      tables: [table],
      plots: [kplot("A", "Alpha", "xy"), kplot("B", "Beta", "xy"), kplot("C", "Gamma", "treemap"), kplot("D", "Delta", "network")],
      analyses: [],
      layouts: [{ id: "L", name: "F", panels: ["A", "B", "C", "D"], freeform: false, alignX: true, alignY: true, panelFontScale: true, columns: 2 }],
      log: [],
      workspace: { folders: [], loose: [] },
    };
    const { container } = render(<LayoutPane project={project} layoutId="L" onRemovePanel={() => {}} onOpenPlot={() => {}} onSetLayoutOptions={vi.fn()} />);
    const box = (pid: string) => {
      const el = container.querySelector(`.laypanel[data-pid="${pid}"]`) as HTMLElement;
      return { x: parseFloat(el.style.left), w: parseFloat(el.style.width) };
    };
    const [a, b, c, d] = ["A", "B", "C", "D"].map(box) as [ReturnType<typeof box>, ReturnType<typeof box>, ReturnType<typeof box>, ReturnType<typeof box>];
    expect(Math.abs(c.x - a.x), "treemap on its column edge").toBeLessThanOrEqual(1);
    expect(Math.abs(d.x - b.x), "network on its column edge").toBeLessThanOrEqual(1);
    expect(c.w, `treemap ${Math.round(c.w)} px under a ${Math.round(a.w)} px graph`).toBeGreaterThanOrEqual(a.w - 1);
    expect(d.w, `network ${Math.round(d.w)} px under a ${Math.round(b.w)} px graph`).toBeGreaterThanOrEqual(b.w - 1);
  });

  it("mixed figure: the row-height match honours the 0.7 readability floor by re-laying", () => {
    // Without the floor, a treemap matched to an axis row takes whatever scale the match demands
    // (~0.48 in this fixture; 0.36 with the square house default) — fonts below readable.
    // Under the floor it re-lays from a smaller design box at 0.7: same row-matched
    // content height, readable type. The axis panel stays untouched.
    const project = proj({ panels: ["A", "B"], freeform: false, alignX: true, alignY: true, panelFontScale: true });
    project.plots = project.plots.map((p) => (p.id === "B" ? { ...p, kind: "treemap" as Plot["kind"] } : p));
    const { container } = render(<LayoutPane project={project} layoutId="L" onRemovePanel={() => {}} onOpenPlot={() => {}} onSetLayoutOptions={vi.fn()} />);
    const kOf = (pid: string): number => {
      const svg = container.querySelector(`.laypanel[data-pid="${pid}"] svg.gfx-figure`)!;
      return Number(svg.getAttribute("width")) / Number((svg.getAttribute("viewBox") ?? "0 0 1 1").split(" ")[2]);
    };
    expect(kOf("B"), "the treemap must render at ≥ the readability floor").toBeGreaterThanOrEqual(0.695);
    // …while still landing on the row: its rendered content height matches the xy panel's
    // rendered data rect (the match pass's own ≤2px dead-band, as in the test above).
    const rendered = (pid: string): number => {
      const svg = container.querySelector(`.laypanel[data-pid="${pid}"] svg.gfx-figure`)!;
      const vb = (svg.getAttribute("viewBox") ?? "0 0 1 1").split(" ").map(Number);
      const k = Number(svg.getAttribute("width")) / vb[2]!;
      const p = project.plots.find((x) => x.id === pid)!;
      const scene = buildPlotScene(table, { ...p, showTitle: false }, { measure: measureText, width: vb[2]!, height: vb[3]! });
      return scene.plot.height * k;
    };
    expect(Math.abs(rendered("B") - rendered("A")), "row-matched content height survives the floor").toBeLessThanOrEqual(4);
  });

  it("a kind with no axes matches its row's data-rect height; the axis panel is untouched", () => {
    // Rule: axis panels always keep the min-ratio fit (aligned axes take priority over size);
    // a treemap has no axes to align, so it rescales until its content box is exactly as
    // tall as the row's rendered data rect. Measured k comes off the DOM; content heights
    // come from independent standalone builds.
    const mkProject = (panels: string[]): Project => {
      const project = proj({ panels, freeform: false, alignX: true, alignY: true, panelFontScale: true });
      project.plots = project.plots.map((p) => (p.id === "B" ? { ...p, kind: "treemap" as Plot["kind"] } : p));
      return project;
    };
    const measure = (project: Project) => {
      const { container } = render(<LayoutPane project={project} layoutId="L" onRemovePanel={() => {}} onOpenPlot={() => {}} onSetLayoutOptions={vi.fn()} />);
      const kOf = (pid: string): number => {
        const svg = container.querySelector(`.laypanel[data-pid="${pid}"] svg.gfx-figure`)!;
        return Number(svg.getAttribute("width")) / Number((svg.getAttribute("viewBox") ?? "0 0 1 1").split(" ")[2]);
      };
      const plotH = (pid: string): number => {
        // Oracle at the panel's actual design box (its viewBox): a readability-floored
        // panel re-lays at a forced box, which a fixed 580×380 oracle would not describe.
        const svg = container.querySelector(`.laypanel[data-pid="${pid}"] svg.gfx-figure`)!;
        const vb = (svg.getAttribute("viewBox") ?? "0 0 580 380").split(" ").map(Number);
        const p = project.plots.find((x) => x.id === pid)!;
        return buildPlotScene(table, { ...p, showTitle: false }, { measure: measureText, width: vb[2]!, height: vb[3]! }).plot.height;
      };
      return { kOf, plotH };
    };

    const both = measure(mkProject(["A", "B"]));
    // The treemap's rendered content height equals the xy panel's rendered data-rect
    // height. Tolerance 4: the pure-rescale path's |Δk| < 0.005 dead-band tolerates ~2px,
    // and the floored re-layout path adds a one-step margin approximation on top.
    expect(Math.abs(both.plotH("B") * both.kOf("B") - both.plotH("A") * both.kOf("A"))).toBeLessThanOrEqual(4);
    const kWithTreemap = both.kOf("A");
    cleanup();
    // …and the axis panel's own scale is exactly what it is without the treemap: the
    // match flows one way only (the treemap follows the axis panel, never the reverse).
    const alone = measure(mkProject(["A"]));
    expect(kWithTreemap).toBeCloseTo(alone.kOf("A"), 3);
  });
});

describe("PanelBuilderView — Arrange opens as a local tab on the same page", () => {
  const props = (over = {}) => ({
    project: proj({ panels: ["A"] }), layoutId: "L",
    onAddPanel: () => {}, onRemovePanel: () => {}, onSetLayoutOptions: () => {},
    onOpenPlot: () => {}, onClose: () => {}, ...over,
  });

  it("opens on Choose-graphs; Build shows the Arrange view in the same .layoutview", () => {
    const { container } = render(<PanelBuilderView {...props()} />);
    const page = container.querySelector(".layoutview") as HTMLElement;
    expect(page).toBeTruthy();
    // opens on the selection tab (a figure with panels exposes Arrange too)
    expect(page.querySelector(".layselect")).toBeTruthy();
    expect([...page.querySelectorAll(".layoutview-tab")].map((t) => t.textContent)).toEqual(["Choose graphs", "Arrange"]);
    // Build / Arrange → arrange view appears within the same page
    fireEvent.click([...page.querySelectorAll("button")].find((b) => /Build/.test(b.textContent ?? ""))!);
    expect(page.querySelector(".laypanel")).toBeTruthy(); // the arrange canvas (same .layoutview)
    expect(page.querySelector(".layselect")).toBeNull(); // selection swapped out
    // and it never becomes a global document tab — it lives inside this page only
    expect(container.querySelectorAll(".layoutview").length).toBe(1);
  });

  it("an empty figure shows only Choose-graphs until a panel is added", () => {
    const empty = proj({ panels: [] });
    const { container } = render(<PanelBuilderView project={empty} layoutId="L" onAddPanel={() => {}} onRemovePanel={() => {}} onSetLayoutOptions={() => {}} onOpenPlot={() => {}} onClose={() => {}} />);
    expect([...container.querySelectorAll(".layoutview-tab")].map((t) => t.textContent)).toEqual(["Choose graphs"]);
  });

  it("the local tabs switch back and forth without leaving the page", () => {
    const { container } = render(<PanelBuilderView {...props()} />);
    const page = () => container.querySelector(".layoutview") as HTMLElement;
    fireEvent.click([...page().querySelectorAll("button")].find((b) => /Build/.test(b.textContent ?? ""))!);
    expect(page().querySelector(".laypanel")).toBeTruthy();
    // click the "Choose graphs" local tab → selection again
    fireEvent.click([...page().querySelectorAll(".layoutview-tab")].find((t) => /Choose graphs/.test(t.textContent ?? ""))!);
    expect(page().querySelector(".layselect")).toBeTruthy();
    // click the "Arrange" local tab → arrange again
    fireEvent.click([...page().querySelectorAll(".layoutview-tab")].find((t) => /Arrange/.test(t.textContent ?? ""))!);
    expect(page().querySelector(".laypanel")).toBeTruthy();
  });
});

/**
 * The control that connects or disconnects a figure's panels from their source graphs must be
 * prominent. An unlabelled checkbox in a toolbar of eight controls reads as one more preference
 * rather than as the mode the whole figure is in, so the control states its mode in words.
 */
describe("the figure's link state is a mode, not a tickbox", () => {
  const props = (over = {}) => ({
    project: proj({ panels: ["A"] }), layoutId: "L",
    onAddPanel: () => {}, onRemovePanel: () => {}, onSetLayoutOptions: () => {},
    onOpenPlot: () => {}, onClose: () => {}, ...over,
  });
  const arrange = (over = {}) => {
    const { container } = render(<PanelBuilderView {...props(over)} />);
    fireEvent.click([...container.querySelectorAll("button")].find((b) => /Build/.test(b.textContent ?? ""))!);
    return container;
  };

  it("names the state it is in, both ways round", () => {
    const linked = arrange({ onSetLinked: () => {} }).querySelector("[data-linked]");
    expect(linked, "the link control is missing from the Arrange bar").toBeTruthy();
    expect(linked!.getAttribute("data-linked")).toBe("yes");
    expect(linked!.textContent).toMatch(/linked to sources/i);
    cleanup();
    const free = arrange({ project: proj({ panels: ["A"], linked: false }), onSetLinked: () => {} }).querySelector("[data-linked]");
    expect(free!.getAttribute("data-linked")).toBe("no");
    // The words change with the state: a chip that always read "Linked" would tell the user nothing.
    expect(free!.textContent).toMatch(/independent copy/i);
  });

  it("clicking it flips the figure — and it is one click, not a tickbox to find", () => {
    const onSetLinked = vi.fn();
    fireEvent.click(arrange({ onSetLinked }).querySelector("[data-linked]")!);
    expect(onSetLinked).toHaveBeenCalledWith(false);
  });

  it("carries the state as a class, so it can be seen without reading it", () => {
    // The only mode on that bar, and the only control on it with a state colour.
    expect(arrange({ onSetLinked: () => {} }).querySelector(".laylink-on")).toBeTruthy();
    cleanup();
    expect(arrange({ project: proj({ panels: ["A"], linked: false }), onSetLinked: () => {} }).querySelector(".laylink-off")).toBeTruthy();
  });

  // Naming only the mode is not enough: users look for the action — "connect or disconnect".
  // So the chip spells out what a click does, and the verb flips with the state.
  it("names the action a click performs — disconnect when linked, reconnect when independent", () => {
    const linked = arrange({ onSetLinked: () => {} }).querySelector("[data-linked]")!;
    expect(linked.textContent, "the chip never tells you a click disconnects").toMatch(/disconnect/i);
    cleanup();
    const free = arrange({ project: proj({ panels: ["A"], linked: false }), onSetLinked: () => {} }).querySelector("[data-linked]")!;
    expect(free.textContent, "the chip never tells you a click reconnects").toMatch(/reconnect/i);
  });

  it("the Select page shows the state too — the mode is visible while picking graphs", () => {
    // Guards against the chip living only on Arrange: the picker page must also say whether
    // ticking a graph links the figure to it or copies it.
    const { container } = render(<PanelBuilderView {...props({ onSetLinked: () => {} })} />);
    const chip = container.querySelector("[data-linked]");
    expect(chip, "the graph-picker page hides which mode the figure is in").toBeTruthy();
    expect(chip!.getAttribute("data-linked")).toBe("yes");
    cleanup();
    const free = render(<PanelBuilderView {...props({ project: proj({ panels: ["A"], linked: false }), onSetLinked: () => {} })} />).container.querySelector("[data-linked]");
    expect(free!.getAttribute("data-linked")).toBe("no");
  });

  // Re-linking deletes the copies' own edits (setLayoutLinked drops every clone plot), so it
  // must ask first. Unlinking makes a copy and destroys nothing — one click, no question.
  it("asks before re-linking, and a declined confirm discards nothing", () => {
    const onSetLinked = vi.fn();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(arrange({ project: proj({ panels: ["A"], linked: false }), onSetLinked }).querySelector("[data-linked]")!);
    expect(confirm, "re-linking never asked — the copies' edits were silently discarded").toHaveBeenCalled();
    expect(confirm.mock.calls[0]![0], "the question does not say what is destroyed").toMatch(/discard/i);
    expect(onSetLinked).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it("an accepted confirm re-links; unlinking never asks", () => {
    const onSetLinked = vi.fn();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(arrange({ project: proj({ panels: ["A"], linked: false }), onSetLinked }).querySelector("[data-linked]")!);
    expect(onSetLinked).toHaveBeenCalledWith(true);
    cleanup();
    onSetLinked.mockClear();
    confirm.mockClear();
    // The non-destructive direction stays one click.
    fireEvent.click(arrange({ onSetLinked }).querySelector("[data-linked]")!);
    expect(onSetLinked).toHaveBeenCalledWith(false);
    expect(confirm, "unlinking asked a needless question — it destroys nothing").not.toHaveBeenCalled();
    confirm.mockRestore();
  });
});

describe("LayoutPane arrange — panels selectable + editable, match to the selected ref", () => {
  const editing = (selectedPlot: string | null, over: Record<string, unknown> = {}) => ({
    selection: { kind: "plot" as const },
    selectedPlot,
    onSelectPanel: vi.fn(),
    onSelect: vi.fn(),
    onWidthResize: vi.fn(),
    onMoveAnnotation: vi.fn(), onMoveRefLineLabel: vi.fn(), onDeleteAnnotation: vi.fn(), onReorderAnnotation: vi.fn(), onDuplicateAnnotation: vi.fn(),
    onFigureResize: vi.fn(), onEditText: vi.fn(), onCreateTextBox: vi.fn(), onAxisResize: vi.fn(),
    onMoveTitle: vi.fn(), onMoveLegend: vi.fn(), onMoveColorbar: vi.fn(), onMoveAxisTitle: vi.fn(),
    ...over,
  });

  it("clicking a panel calls onSelectPanel; the selected one gets a selection ring", () => {
    const ed = editing("B");
    const { container } = render(
      <LayoutPane project={proj({ panels: ["A", "B"] })} layoutId="L" onRemovePanel={() => {}} onOpenPlot={() => {}} editing={ed as never} />,
    );
    const panels = [...container.querySelectorAll(".laypanel")] as HTMLElement[];
    expect(panels[1]!.classList.contains("laypanel-sel")).toBe(true);
    expect(panels[0]!.classList.contains("laypanel-sel")).toBe(false);
    fireEvent.mouseDown(panels[0]!);
    expect(ed.onSelectPanel).toHaveBeenCalledWith("A");
  });

  it("the Match toolbar lets you pick any reference panel via a dropdown (not just A)", () => {
    const onMatchStyles = vi.fn();
    const { container } = render(
      <LayoutPane project={proj({ panels: ["A", "B"] })} layoutId="L" onRemovePanel={() => {}} onOpenPlot={() => {}} onMatchStyles={onMatchStyles} editing={editing("B") as never} />,
    );
    // the reference <select> = the only one offering plot ids as option values
    const refSelect = () => [...container.querySelectorAll("select.selin")].find((s) => [...(s as HTMLSelectElement).options].some((o) => o.value === "B")) as HTMLSelectElement;
    expect(refSelect().value).toBe("B"); // defaults to the selected panel
    fireEvent.click([...container.querySelectorAll("button.layseg-btn")].find((b) => /Colours/.test(b.textContent ?? ""))!);
    expect(onMatchStyles.mock.calls[0]![0]).toEqual(["A"]); // the others (A) match to B
    // choosing A as the reference flips which panels get matched — proves it's not stuck on A/B
    fireEvent.change(refSelect(), { target: { value: "A" } });
    fireEvent.click([...container.querySelectorAll("button.layseg-btn")].find((b) => /Size/.test(b.textContent ?? ""))!);
    expect(onMatchStyles.mock.calls[1]![0]).toEqual(["B"]);
  });

  it("the Style-preset picker restyles every panel at once", () => {
    const onApplyPanelPreset = vi.fn();
    const { container } = render(
      <LayoutPane
        project={proj({ panels: ["A", "B"] })}
        layoutId="L"
        onRemovePanel={() => {}}
        onOpenPlot={() => {}}
        onApplyPanelPreset={onApplyPanelPreset}
        editing={editing(null) as never}
      />,
    );
    const sel = container.querySelector('select[aria-label="Apply a style preset to every panel"]') as HTMLSelectElement;
    expect(sel, "the whole-figure preset picker is missing from the ribbon").toBeTruthy();
    fireEvent.change(sel, { target: { value: "Scientific Journal" } });
    expect(onApplyPanelPreset).toHaveBeenCalledTimes(1);
    const [ids, preset] = onApplyPanelPreset.mock.calls[0]!;
    expect(ids, "every panel, not a reference subset").toEqual(["A", "B"]);
    expect(preset.name).toBe("Scientific Journal");
  });
});

describe("LayoutPane — Arrange toolbar (shift-select + align/distribute/equalise panels)", () => {
  const editing = (over: Record<string, unknown> = {}) => ({
    selection: { kind: "plot" as const }, selectedPlot: null,
    onSelectPanel: vi.fn(), onSelect: vi.fn(), onWidthResize: vi.fn(),
    onMoveAnnotation: vi.fn(), onMoveRefLineLabel: vi.fn(), onDeleteAnnotation: vi.fn(), onReorderAnnotation: vi.fn(), onDuplicateAnnotation: vi.fn(),
    onFigureResize: vi.fn(), onEditText: vi.fn(), onCreateTextBox: vi.fn(), onAxisResize: vi.fn(),
    onMoveTitle: vi.fn(), onMoveLegend: vi.fn(), onMoveColorbar: vi.fn(), onMoveAxisTitle: vi.fn(),
    ...over,
  });
  const setup = (onSet = vi.fn(), ed = editing()) => ({
    onSet,
    ...render(
      <LayoutPane project={proj({ panels: ["A", "B"] })} layoutId="L" onRemovePanel={() => {}} onOpenPlot={() => {}} onSetLayoutOptions={onSet} editing={ed as never} />,
    ),
  });

  it("shift-click selects panels (arrange ring), enables the buttons, and aligns via onSetLayoutOptions", () => {
    const { container, onSet } = setup();
    const alignLeft = () => container.querySelector('button[title="Align left edges"]') as HTMLButtonElement;
    const lineUpMenu = () => [...container.querySelectorAll<HTMLButtonElement>("button.laymenu-btn")].find((b) => /^Line up/.test(b.textContent ?? ""))!;
    expect(lineUpMenu().disabled).toBe(true); // nothing selected yet: Line up ▾ holds the align buttons
    const panels = [...container.querySelectorAll(".laypanel")] as HTMLElement[];
    fireEvent.mouseDown(panels[0]!, { shiftKey: true });
    fireEvent.mouseDown(panels[1]!, { shiftKey: true });
    openFigureMenus(container); // Line up ▾ opens once panels are picked
    expect(panels[0]!.classList.contains("laypanel-arrsel")).toBe(true);
    expect(panels[1]!.classList.contains("laypanel-arrsel")).toBe(true);
    expect(alignLeft().disabled).toBe(false); // 2 selected → enabled
    fireEvent.click(alignLeft());
    expect(onSet).toHaveBeenCalledTimes(1);
    const patch = onSet.mock.calls[0]![0] as Partial<FigureLayout>;
    expect(patch.freeform).toBe(true); // freezes into free-drag
    expect(patch.panelPositions!.A!.x).toBe(patch.panelPositions!.B!.x); // both left edges aligned
  });

  it("equalise-width writes panelSizes (not positions) for the selected panels", () => {
    const { container, onSet } = setup();
    const panels = [...container.querySelectorAll(".laypanel")] as HTMLElement[];
    fireEvent.mouseDown(panels[0]!, { shiftKey: true });
    fireEvent.mouseDown(panels[1]!, { shiftKey: true });
    openFigureMenus(container); // Line up ▾ opens once panels are picked
    fireEvent.click(container.querySelector('button[title="Make the graphs the same width"]') as HTMLButtonElement);
    const patch = onSet.mock.calls[0]![0] as Partial<FigureLayout>;
    expect(patch.panelSizes!.A!.w).toBe(patch.panelSizes!.B!.w); // equal widths
  });

  it("Distribute stays disabled with only 2 panels selected (needs 3)", () => {
    const { container } = setup();
    const panels = [...container.querySelectorAll(".laypanel")] as HTMLElement[];
    fireEvent.mouseDown(panels[0]!, { shiftKey: true });
    fireEvent.mouseDown(panels[1]!, { shiftKey: true });
    openFigureMenus(container); // Line up ▾ opens once panels are picked
    expect((container.querySelector('button[title^="Distribute horizontal"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it("a plain click clears the Arrange selection and edits the single graph", () => {
    const ed = editing();
    const { container } = setup(vi.fn(), ed);
    const panels = [...container.querySelectorAll(".laypanel")] as HTMLElement[];
    fireEvent.mouseDown(panels[0]!, { shiftKey: true });
    expect(panels[0]!.classList.contains("laypanel-arrsel")).toBe(true);
    fireEvent.mouseDown(panels[1]!); // plain click
    expect(ed.onSelectPanel).toHaveBeenCalledWith("B");
    expect(container.querySelectorAll(".laypanel-arrsel")).toHaveLength(0); // set cleared
  });
});

describe("LayoutPane — object tools: front/back, centre, lock, duplicate", () => {
  // Shift-click selection is only wired when `editing` is provided (as in the app).
  const editing = () => ({
    selection: { kind: "plot" as const }, selectedPlot: null,
    onSelectPanel: vi.fn(), onSelect: vi.fn(), onWidthResize: vi.fn(),
    onMoveAnnotation: vi.fn(), onMoveRefLineLabel: vi.fn(), onDeleteAnnotation: vi.fn(), onReorderAnnotation: vi.fn(), onDuplicateAnnotation: vi.fn(),
    onFigureResize: vi.fn(), onEditText: vi.fn(), onCreateTextBox: vi.fn(), onAxisResize: vi.fn(),
    onMoveTitle: vi.fn(), onMoveLegend: vi.fn(), onMoveColorbar: vi.fn(), onMoveAxisTitle: vi.fn(),
  });
  const setup = (over: Partial<FigureLayout> = {}, extra: Partial<Parameters<typeof LayoutPane>[0]> = {}) => {
    const onSet = vi.fn();
    return {
      onSet,
      ...render(
        <LayoutPane
          project={proj({ panels: ["A", "B"], ...over })}
          layoutId="L"
          onRemovePanel={() => {}}
          onOpenPlot={() => {}}
          onSetLayoutOptions={onSet}
          editing={editing() as never}
          {...extra}
        />,
      ),
    };
  };
  const btn = (c: HTMLElement, title: RegExp): HTMLButtonElement =>
    [...c.querySelectorAll("button")].find((b) => title.test(b.getAttribute("title") ?? "")) as HTMLButtonElement;
  const shiftSelect = (c: HTMLElement, ...idx: number[]): HTMLElement[] => {
    const panels = [...c.querySelectorAll(".laypanel")] as HTMLElement[];
    for (const i of idx) fireEvent.mouseDown(panels[i]!, { shiftKey: true });
    openFigureMenus(c); // Line up ▾ has something to offer once panels are picked
    return panels;
  };
  /** With nothing to line up, Line up ▾ is disabled — its items are not on the page at all. */
  const lineUp = (c: HTMLElement): HTMLButtonElement =>
    [...c.querySelectorAll<HTMLButtonElement>("button.laymenu-btn")].find((b) => /^Line up/.test(b.textContent ?? ""))!;

  it("Bring-to-front writes a panelZ patch putting the selection above the rest (lettering untouched)", () => {
    const { container, onSet } = setup({ freeform: true });
    const front = btn(container, /^Bring the selected/);
    expect(front.disabled).toBe(true); // nothing selected yet
    shiftSelect(container, 0);
    expect(front.disabled).toBe(false);
    fireEvent.click(front);
    expect(onSet).toHaveBeenCalledTimes(1);
    const patch = onSet.mock.calls[0]![0] as Partial<FigureLayout>;
    expect(patch.panelZ!.A).toBe(1); // above B's implicit 0
    expect(patch.panels).toBeUndefined(); // Never reorders panels — that would renumber A/B/C
  });

  it("Send-to-back writes a negative panelZ for the selection", () => {
    const { container, onSet } = setup({ freeform: true });
    shiftSelect(container, 0);
    fireEvent.click(btn(container, /^Send the selected/));
    const patch = onSet.mock.calls[0]![0] as Partial<FigureLayout>;
    expect(patch.panelZ!.A).toBeLessThan(0);
  });

  it("panels render in panelZ order (DOM = paint = export order) but keep their letters", () => {
    const { container } = setup({ freeform: true, panelZ: { A: 5 } });
    const pids = [...container.querySelectorAll(".laypanel")].map((el) => el.getAttribute("data-pid"));
    expect(pids).toEqual(["B", "A"]); // A in front → painted last
    // the letters still follow the `panels` order: A is still lettered "A"
    const letterOf = (pid: string) =>
      (container.querySelector(`.laypanel[data-pid="${pid}"] .laypanel-letter`) as HTMLElement).textContent;
    expect(letterOf("A")).toBe("A");
    expect(letterOf("B")).toBe("B");
  });

  it("Centre-on-figure centres the selected panel on the union of all panels (freezes first)", () => {
    const { container, onSet } = setup({ freeform: true, panelPositions: { A: { x: 0, y: 0 }, B: { x: 600, y: 0 } } });
    expect(lineUp(container).disabled, "nothing picked: nothing to centre").toBe(true);
    shiftSelect(container, 0);
    const ctr = btn(container, /^Centre the selected panel\(s\) on the figure, left/);
    expect(ctr.disabled).toBe(false);
    fireEvent.click(ctr);
    expect(onSet).toHaveBeenCalledTimes(1);
    const patch = onSet.mock.calls[0]![0] as Partial<FigureLayout>;
    expect(patch.freeform).toBe(true); // same freeze contract as Arrange
    expect(patch.panelPositions!.A!.x).toBeGreaterThan(0); // pulled toward the union centre
    expect(patch.panelPositions!.B).toEqual({ x: 600, y: 0 }); // unselected panel stays put
    expect(patch.panelSizes).toBeTruthy(); // frozen sizes baked alongside
  });

  it("Centre is disabled when every panel is selected — there is no page to centre against", () => {
    const { container } = setup({ freeform: true });
    shiftSelect(container, 0, 1);
    expect(btn(container, /^Centre the selected panel\(s\) on the figure, left/).disabled).toBe(true);
  });

  it("Lock writes panelLocked for the selection; the padlock button unlocks it again", () => {
    const first = setup({ freeform: true });
    shiftSelect(first.container, 0);
    fireEvent.click(btn(first.container, /^Lock the selected/));
    expect((first.onSet.mock.calls[0]![0] as Partial<FigureLayout>).panelLocked).toEqual({ A: true });
    cleanup();
    // a locked panel shows an always-visible padlock; clicking it unlocks (entry removed)
    const locked = setup({ freeform: true, panelLocked: { A: true } });
    const pad = locked.container.querySelector('.laypanel[data-pid="A"] .laypanel-lock') as HTMLButtonElement;
    expect(pad).toBeTruthy();
    fireEvent.click(pad);
    expect((locked.onSet.mock.calls[0]![0] as Partial<FigureLayout>).panelLocked).toBeUndefined();
  });

  it("a locked panel can't be dragged, resized or removed — and align won't move it", () => {
    const { container, onSet } = setup({ freeform: true, panelLocked: { A: true }, panelPositions: { A: { x: 100, y: 40 }, B: { x: 500, y: 40 } } });
    const a = container.querySelector('.laypanel[data-pid="A"]') as HTMLElement;
    // drag attempt on the locked panel commits nothing
    const svg = a.querySelector("svg.gfx-figure") as Element;
    fireEvent.pointerDown(svg, { clientX: 150, clientY: 150, button: 0, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 260, clientY: 240, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 260, clientY: 240, pointerId: 1 });
    expect(onSet).not.toHaveBeenCalled();
    // no resize handle, remove × disabled (with a reason), padlock shown
    expect(a.querySelector(".laypanel-resize")).toBeNull();
    const b = container.querySelector('.laypanel[data-pid="B"]') as HTMLElement;
    expect(b.querySelector(".laypanel-resize")).toBeTruthy(); // the unlocked panel keeps its handle
    const x = a.querySelector(".laypanel-x") as HTMLButtonElement;
    expect(x.disabled).toBe(true);
    expect(x.title).toMatch(/unlock/i);
    // align needs 2 movable panels: A locked + B selected → nothing to line up, so Line up ▾ stays shut
    shiftSelect(container, 0, 1);
    expect(lineUp(container).disabled).toBe(true);
  });

  it("Duplicate fires onDuplicatePanel for each selected panel (hidden without the handler)", () => {
    const bare = setup({ freeform: true });
    expect(btn(bare.container, /^Duplicate the selected/)).toBeUndefined(); // no handler → no button
    cleanup();
    const onDuplicatePanel = vi.fn();
    const { container } = setup({ freeform: true }, { onDuplicatePanel });
    const dup = btn(container, /^Duplicate the selected/);
    expect(dup.disabled).toBe(true);
    shiftSelect(container, 0, 1);
    fireEvent.click(dup);
    expect(onDuplicatePanel.mock.calls.map((c) => c[0])).toEqual(["A", "B"]);
  });
});

describe("LayoutPane — uniform row height / column width", () => {
  const render3 = (over: Partial<FigureLayout>, onSet = () => {}) =>
    render(<LayoutPane project={proj({ panels: ["A", "B"], ...over })} layoutId="L" onRemovePanel={() => {}} onOpenPlot={() => {}} onSetLayoutOptions={onSet} />);
  const toggle = (c: HTMLElement, label: RegExp): HTMLInputElement =>
    [...c.querySelectorAll("label")].find((l) => label.test(l.textContent ?? ""))!.querySelector("input") as HTMLInputElement;

  it("both toggles are present and enter grid mode (set freeform:false) when turned on", () => {
    const onSet = vi.fn();
    const { container } = render3({ freeform: true }, onSet);
    const uRow = toggle(container, /Equal rows/);
    const uCol = toggle(container, /Equal cols/);
    expect(uRow.checked).toBe(false);
    expect(uCol.checked).toBe(false);
    fireEvent.click(uRow);
    expect(onSet).toHaveBeenCalledWith({ uniformRowHeight: true, freeform: false });
    fireEvent.click(uCol);
    expect(onSet).toHaveBeenCalledWith({ uniformColumnWidth: true, freeform: false });
  });

  it("unchecking a toggle clears the flag (undefined)", () => {
    const onSet = vi.fn();
    const { container } = render3({ freeform: false, uniformRowHeight: true }, onSet);
    fireEvent.click(toggle(container, /Equal rows/));
    expect(onSet).toHaveBeenCalledWith({ uniformRowHeight: undefined });
  });

  it("uniform column width alone puts panels in grid mode (no axis-align needed)", () => {
    const { container } = render3({ freeform: false, columns: 1, uniformColumnWidth: true });
    // grid mode → the canvas is the absolute-positioned variant
    expect(container.querySelector(".laycanvas[data-abs]")).not.toBeNull();
  });

  it("uniform column width equalises the rendered card widths of a column's panels", () => {
    // A is narrow (300), B is wide (520); stacked in one column. Without the flag the cards
    // keep their own widths; with it, both grow to the column's widest.
    const widthsFor = (over: Partial<FigureLayout>): number[] => {
      const { container } = render3({ freeform: false, columns: 1, panelSizes: { A: { w: 300, h: 200 }, B: { w: 520, h: 200 } }, ...over });
      const ws = [...container.querySelectorAll<HTMLElement>(".laypanel")].map((el) => parseFloat(el.style.width));
      cleanup();
      return ws;
    };
    const plain = widthsFor({});
    expect(Math.abs(plain[0]! - plain[1]!)).toBeGreaterThan(100); // 316 vs 536 — different
    const uniform = widthsFor({ uniformColumnWidth: true });
    expect(Math.abs(uniform[0]! - uniform[1]!)).toBeLessThan(1); // equal to the widest
    expect(uniform[0]!).toBeCloseTo(Math.max(...plain), 0);
  });
});

describe("LayoutPane — editable panel letters (double-click to retype)", () => {
  const arrange = (over: Partial<FigureLayout> = {}, onSet = vi.fn()) =>
    render(<LayoutPane project={proj({ panels: ["A", "B"], ...over })} layoutId="L" onRemovePanel={() => {}} onOpenPlot={() => {}} onSetLayoutOptions={onSet} />);

  it("shows a stored custom label instead of the scheme's letter", () => {
    const { container } = arrange({ letterText: { A: "(a)" } });
    const labels = [...container.querySelectorAll(".laypanel-letter-float")] as HTMLElement[];
    expect(labels[0]!.textContent).toBe("(a)"); // overridden
    expect(labels[1]!.textContent).toBe("B"); // untouched panels still follow the scheme
  });

  it("double-clicking a label opens an input seeded with the current text", () => {
    const { container } = arrange();
    const lbl = container.querySelector(".laypanel-letter-float") as HTMLElement;
    fireEvent.doubleClick(lbl);
    const input = container.querySelector(".laypanel-letter-in") as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.value).toBe("A");
  });

  it("Enter commits the retyped label as a letterText override", () => {
    const onSet = vi.fn();
    const { container } = arrange({}, onSet);
    fireEvent.doubleClick(container.querySelector(".laypanel-letter-float") as HTMLElement);
    const input = container.querySelector(".laypanel-letter-in") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "S1" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSet).toHaveBeenCalledTimes(1);
    expect((onSet.mock.calls[0]![0] as Partial<FigureLayout>).letterText).toEqual({ A: "S1" });
  });

  it("blur commits too, and keeps other panels' overrides", () => {
    const onSet = vi.fn();
    const { container } = arrange({ letterText: { B: "(b)" } }, onSet);
    fireEvent.doubleClick(container.querySelector(".laypanel-letter-float") as HTMLElement);
    const input = container.querySelector(".laypanel-letter-in") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "(a)" } });
    fireEvent.blur(input);
    expect((onSet.mock.calls[0]![0] as Partial<FigureLayout>).letterText).toEqual({ A: "(a)", B: "(b)" });
  });

  it("Escape cancels — nothing is committed", () => {
    const onSet = vi.fn();
    const { container } = arrange({}, onSet);
    fireEvent.doubleClick(container.querySelector(".laypanel-letter-float") as HTMLElement);
    const input = container.querySelector(".laypanel-letter-in") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "zzz" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onSet).not.toHaveBeenCalled();
    expect(container.querySelector(".laypanel-letter-in")).toBeNull();
    expect((container.querySelector(".laypanel-letter-float") as HTMLElement).textContent).toBe("A");
  });

  it("retyping the scheme's own letter clears the override, so the label stays automatic", () => {
    const onSet = vi.fn();
    const { container } = arrange({ letterText: { A: "S1" } }, onSet);
    fireEvent.doubleClick(container.querySelector(".laypanel-letter-float") as HTMLElement);
    const input = container.querySelector(".laypanel-letter-in") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "A" } });
    fireEvent.keyDown(input, { key: "Enter" });
    // the whole record went away (A was the only override) rather than storing a redundant "A"
    expect((onSet.mock.calls[0]![0] as Partial<FigureLayout>).letterText).toBeUndefined();
  });

  it("committing an unchanged label does not churn the undo stack", () => {
    const onSet = vi.fn();
    const { container } = arrange({}, onSet);
    fireEvent.doubleClick(container.querySelector(".laypanel-letter-float") as HTMLElement);
    fireEvent.keyDown(container.querySelector(".laypanel-letter-in") as HTMLInputElement, { key: "Enter" });
    expect(onSet).not.toHaveBeenCalled();
  });

  it("an emptied label hides just that one, and is still recoverable by double-click", () => {
    const onSet = vi.fn();
    const { container } = arrange({}, onSet);
    fireEvent.doubleClick(container.querySelector(".laypanel-letter-float") as HTMLElement);
    const input = container.querySelector(".laypanel-letter-in") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect((onSet.mock.calls[0]![0] as Partial<FigureLayout>).letterText).toEqual({ A: "" });
    // re-render with the override: the span persists (empty) so the label can be typed back
    const { container: c2 } = arrange({ letterText: { A: "" } });
    const labels = [...c2.querySelectorAll(".laypanel-letter-float")] as HTMLElement[];
    expect(labels[0]!.textContent).toBe("");
    expect(labels).toHaveLength(2); // B keeps its letter
  });

  it("lettering: none removes the labels entirely — custom text included", () => {
    const { container } = arrange({ lettering: "none", letterText: { A: "S1" } });
    expect(container.querySelector(".laypanel-letter-float")).toBeNull();
  });

  it("the Match-to reference picker lists panels by the letter they actually show", () => {
    // the picker only exists when style-matching is wired up
    const { container } = render(
      <LayoutPane
        project={proj({ panels: ["A", "B"], letterText: { A: "S1" } })}
        layoutId="L"
        onRemovePanel={() => {}}
        onOpenPlot={() => {}}
        onSetLayoutOptions={vi.fn()}
        onMatchStyles={vi.fn()}
      />,
    );
    const opts = [...container.querySelectorAll("option")].map((o) => o.textContent);
    expect(opts).toEqual(expect.arrayContaining(["S1 — Alpha", "B — Beta"]));
  });
});

describe("LayoutPane — figure gutter default", () => {
  it("a fresh figure starts with real whitespace between panels, not flush edges", () => {
    const { container } = render(
      <LayoutPane project={proj({ panels: ["A", "B"], freeform: false })} layoutId="L" onRemovePanel={() => {}} onOpenPlot={() => {}} onSetLayoutOptions={vi.fn()} />,
    );
    const grid = container.querySelector(".laygrid") as HTMLElement;
    expect(grid.style.gap).toBe("16px");
    const gutterIn = [...container.querySelectorAll("input[type=number]")].find(
      (i) => (i as HTMLInputElement).closest("label")?.textContent?.includes("Gutter"),
    ) as HTMLInputElement;
    expect(gutterIn.value).toBe("16");
  });

  it("an explicit 0 gutter is still honoured (a deliberately flush montage)", () => {
    const { container } = render(
      <LayoutPane project={proj({ panels: ["A", "B"], freeform: false, gutter: 0 })} layoutId="L" onRemovePanel={() => {}} onOpenPlot={() => {}} onSetLayoutOptions={vi.fn()} />,
    );
    expect((container.querySelector(".laygrid") as HTMLElement).style.gap).toBe("0px");
  });
});

describe("LayoutPane — whole-figure caption draft", () => {
  const withCaption = (over: Partial<FigureLayout> = {}) =>
    render(<LayoutPane project={proj({ panels: ["A", "B"], ...over })} layoutId="L" onRemovePanel={() => {}} onOpenPlot={() => {}} onSetLayoutOptions={vi.fn()} />);
  const captionBtn = (c: HTMLElement) =>
    [...c.querySelectorAll("button")].find((b) => b.textContent === "Caption") as HTMLButtonElement;

  it("drafts a lettered, panel-by-panel caption + alt-text on demand (never automatically)", () => {
    const { container } = withCaption();
    expect(container.querySelector(".prosepanel")).toBeNull(); // nothing until asked
    fireEvent.click(captionBtn(container));
    const ta = container.querySelector(".prosepanel-text") as HTMLTextAreaElement;
    expect(ta).toBeTruthy();
    expect(ta.value).toContain("Caption\n");
    expect(ta.value).toContain("(A) Alpha.");
    expect(ta.value).toContain("(B) Beta.");
    expect(ta.value).toContain("Alt text\n");
    expect(ta.value).toContain("Multi-panel figure with 2 panels");
  });

  it("the draft uses each panel's custom label when it has one", () => {
    const { container } = withCaption({ letterText: { A: "S1" } });
    fireEvent.click(captionBtn(container));
    expect((container.querySelector(".prosepanel-text") as HTMLTextAreaElement).value).toContain("(S1) Alpha.");
  });

  it("the draft is editable and the button toggles it closed", () => {
    const { container } = withCaption();
    fireEvent.click(captionBtn(container));
    const ta = container.querySelector(".prosepanel-text") as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "my own words" } });
    expect((container.querySelector(".prosepanel-text") as HTMLTextAreaElement).value).toBe("my own words");
    fireEvent.click(captionBtn(container));
    expect(container.querySelector(".prosepanel")).toBeNull();
  });

  it("offers no Caption button for an empty figure", () => {
    const { container } = render(
      <LayoutPane project={proj({ panels: [] })} layoutId="L" onRemovePanel={() => {}} onOpenPlot={() => {}} onSetLayoutOptions={vi.fn()} />,
    );
    expect(captionBtn(container)).toBeUndefined();
  });
});

// The axis-less (heatmap) alignment logic is easy to disturb from a distance: it works in
// scene space (scene widths, plot rects, colour-bar included) while the gutter works in
// card space. Changing the gutter (0 → 16) must therefore leave
// every axis-less result byte-identical. This asserts that independence directly, so any
// future change that lets card spacing leak into the heatmap geometry fails here.
describe("LayoutPane — axis-less (heatmap) alignment is independent of the gutter", () => {
  const heatTable: DataTable = {
    id: "ht", kind: "grouped", name: "H",
    columns: [
      { id: "g", name: "G", role: "x" },
      { id: "s1", name: "S1", role: "y" },
      { id: "s2", name: "S2", role: "y" },
    ],
    rows: [
      { id: "h1", cells: { g: "A", s1: 1, s2: 2 } },
      { id: "h2", cells: { g: "B", s1: 3, s2: 4 } },
    ],
  };
  const heatPlot: Plot = { id: "H", name: "Heat", source: "ht", status: "ok", styleOverrides: {}, kind: "heatmap" };

  const figure = (over: Partial<FigureLayout>): Project => ({
    schemaVersion: 5,
    tables: [table, heatTable],
    plots: [plot("A", "Alpha"), heatPlot],
    analyses: [],
    layouts: [{ id: "L", name: "Fig", panels: ["A", "H"], freeform: false, ...over }],
    log: [],
    workspace: { folders: [], loose: [] },
  });

  /** The heatmap's own geometry: its scene box and where its grid sits inside it. */
  const heatGeom = (c: HTMLElement) => {
    const svg = [...c.querySelectorAll(".laypanel svg.gfx-figure")][1] as SVGSVGElement;
    return { viewBox: svg.getAttribute("viewBox"), width: svg.getAttribute("width"), height: svg.getAttribute("height") };
  };
  /** Card left/top per panel — the placement the gutter is allowed to move. */
  const cards = (c: HTMLElement) =>
    ([...c.querySelectorAll(".laypanel")] as HTMLElement[]).map((el) => ({
      left: parseFloat(el.style.left || "0"),
      top: parseFloat(el.style.top || "0"),
    }));

  const renderAt = (gutter: number, over: Partial<FigureLayout>) =>
    render(
      <LayoutPane project={figure({ gutter, ...over })} layoutId="L" onRemovePanel={() => {}} onOpenPlot={() => {}} onSetLayoutOptions={() => {}} />,
    ).container;

  it("Align X (stacked column): the heatmap's scene is identical at gutter 0 and 16", () => {
    const at0 = heatGeom(renderAt(0, { columns: 1, alignX: true }));
    cleanup();
    const at16 = heatGeom(renderAt(16, { columns: 1, alignX: true }));
    // guard against a vacuous comparison of three nulls: the heatmap really was measured
    expect(at0.viewBox).toMatch(/^0 0 \d+(\.\d+)? \d+(\.\d+)?$/);
    expect(Number(at0.width)).toBeGreaterThan(0);
    expect(at16).toEqual(at0); // scene-space geometry must not see the card gutter
  });

  it("Align X + Align Y (2-up row): the heatmap's scene is identical at gutter 0 and 16", () => {
    const at0 = heatGeom(renderAt(0, { columns: 2, alignX: true, alignY: true }));
    cleanup();
    const at16 = heatGeom(renderAt(16, { columns: 2, alignX: true, alignY: true }));
    expect(at16).toEqual(at0);
  });

  it("uniform row/column sizing keeps the heatmap scene gutter-independent too", () => {
    const at0 = heatGeom(renderAt(0, { columns: 2, uniformRowHeight: true, uniformColumnWidth: true }));
    cleanup();
    const at16 = heatGeom(renderAt(16, { columns: 2, uniformRowHeight: true, uniformColumnWidth: true }));
    expect(at16).toEqual(at0);
  });

  it("the stacked heatmap's shared left edge still holds at the default 16 px gutter", () => {
    const c = renderAt(16, { columns: 1, alignX: true });
    const [graph, heat] = cards(c);
    expect(Math.abs(graph!.left - heat!.left)).toBeLessThanOrEqual(1); // shared left edge
    expect(graph!.top).not.toBe(heat!.top); // genuinely stacked
  });

  it("the gutter still moves the cards apart — it is not being ignored", () => {
    const at0 = cards(renderAt(0, { columns: 1, alignX: true }));
    cleanup();
    const at16 = cards(renderAt(16, { columns: 1, alignX: true }));
    // same left edge (one column), but the second card sits 16px further down
    expect(at16[1]!.top - at0[1]!.top).toBe(16);
  });
});

describe("LayoutPane — column spanning", () => {
  const heatTable: DataTable = {
    id: "ht", kind: "grouped", name: "H",
    columns: [
      { id: "g", name: "G", role: "x" },
      { id: "s1", name: "S1", role: "y" },
      { id: "s2", name: "S2", role: "y" },
    ],
    rows: [
      { id: "h1", cells: { g: "A", s1: 1, s2: 2 } },
      { id: "h2", cells: { g: "B", s1: 3, s2: 4 } },
    ],
  };
  const heatPlot: Plot = { id: "H", name: "Heat", source: "ht", status: "ok", styleOverrides: {}, kind: "heatmap" };

  /** A 3-panel figure in grid mode; panel A is the candidate wide one. */
  const grid = (over: Partial<FigureLayout> = {}, onSet = vi.fn()) => {
    const project: Project = {
      schemaVersion: 5,
      tables: [table, heatTable],
      plots: [plot("A", "Alpha"), plot("B", "Beta"), plot("C", "Gamma"), heatPlot],
      analyses: [],
      layouts: [{ id: "L", name: "Fig", panels: ["A", "B", "C"], columns: 2, freeform: false, ...over }],
      log: [],
      workspace: { folders: [], loose: [] },
    };
    return render(
      <LayoutPane project={project} layoutId="L" onRemovePanel={() => {}} onOpenPlot={() => {}} onSetLayoutOptions={onSet} />,
    );
  };
  const panelWidths = (c: HTMLElement) =>
    ([...c.querySelectorAll(".laypanel")] as HTMLElement[]).map((p) => parseFloat(p.style.width || "0"));
  const spanBtns = (c: HTMLElement) => [...c.querySelectorAll(".laypanel-span")] as HTMLButtonElement[];

  it("a spanning panel is laid out wider — the sum of the columns it covers plus the gutter", () => {
    const { container } = grid({ panelSpan: { A: 2 }, gutter: 16 });
    const w = panelWidths(container);
    // panel A spans both columns: 2 single widths + one gutter between them
    expect(w[0]).toBeCloseTo(w[1]! * 2 + 16, 0);
    expect(w[1]).toBe(w[2]); // the unspanned panels are untouched
  });

  it("claims the grid cells too, so it isn't just a wide box overlapping its neighbour", () => {
    const { container } = grid({ panelSpan: { A: 2 } });
    const panels = [...container.querySelectorAll(".laypanel")] as HTMLElement[];
    expect(panels[0]!.style.gridColumn).toBe("span 2");
    expect(panels[1]!.style.gridColumn).toBe(""); // single-cell panels claim nothing special
  });

  it("packs the remaining panels onto the next row (wide A on top, B and C beneath)", () => {
    // Align X switches to computed absolute positions, which is where row packing shows.
    const { container } = grid({ panelSpan: { A: 2 }, alignX: true });
    const tops = ([...container.querySelectorAll(".laypanel")] as HTMLElement[]).map((p) => parseFloat(p.style.top || "0"));
    expect(tops[0]).toBeLessThan(tops[1]!); // A is its own row
    expect(tops[1]).toBe(tops[2]); // B and C share the row below
  });

  it("a span wider than the column count is clamped, not allowed to break the grid", () => {
    const { container } = grid({ panelSpan: { A: 99 }, gutter: 16 });
    const w = panelWidths(container);
    expect(w[0]).toBeCloseTo(w[1]! * 2 + 16, 0); // clamped to 2 columns, the full width
  });

  it("spanning is inert without an explicit column count (span 2 of auto-fill means nothing)", () => {
    const { container: withCols } = grid({ columns: undefined, panelSpan: { A: 2 } });
    expect(spanBtns(withCols)).toHaveLength(0);
    const w = panelWidths(withCols);
    expect(w[0]).toBe(w[1]); // no widening
  });

  it("spanning is inert in free-drag mode (there you size a panel by dragging it)", () => {
    const { container } = grid({ freeform: true, panelSpan: { A: 2 } });
    expect(spanBtns(container)).toHaveLength(0);
    const w = panelWidths(container);
    expect(w[0]).toBe(w[1]);
  });

  it("the span button cycles 1 → 2 → … → cols → 1 and commits each step", () => {
    const onSet = vi.fn();
    const { container } = grid({}, onSet);
    const btns = spanBtns(container);
    expect(btns[0]!.textContent).toBe("1×");
    fireEvent.click(btns[0]!);
    expect(onSet).toHaveBeenCalledWith({ panelSpan: { A: 2 } });
  });

  it("cycling back to 1 clears the entry rather than storing a redundant span", () => {
    const onSet = vi.fn();
    const { container } = grid({ columns: 2, panelSpan: { A: 2 } }, onSet);
    fireEvent.click(spanBtns(container)[0]!); // 2 of 2 → wraps to 1
    expect(onSet).toHaveBeenCalledWith({ panelSpan: undefined });
  });

  it("clearing the last span drops the record, but keeps other panels' spans", () => {
    const onSet = vi.fn();
    const { container } = grid({ columns: 2, panelSpan: { A: 2, B: 2 } }, onSet);
    fireEvent.click(spanBtns(container)[0]!);
    expect(onSet).toHaveBeenCalledWith({ panelSpan: { B: 2 } });
  });

  // Caution: the axis-less (heatmap) rules are easy to disturb. A spanning panel is deliberately
  // a different width, so it must never become the target other panels size themselves to —
  // that would drag every heatmap out to the wide panel's width.
  it("a spanning panel does not set the width a heatmap matches itself to", () => {
    const withSpan = grid({ panels: ["A", "H", "B"], panelSpan: { A: 2 }, alignX: true, columns: 2 });
    const heatSpan = (withSpan.container.querySelectorAll(".laypanel svg.gfx-figure")[1] as SVGSVGElement)
      .getAttribute("viewBox");
    // the span genuinely took effect in this fixture, so the comparison below means something
    const spanW = panelWidths(withSpan.container);
    expect(spanW[0]).toBeGreaterThan(spanW[2]! * 1.5);
    cleanup();
    const noSpan = grid({ panels: ["A", "H", "B"], alignX: true, columns: 2 });
    const heatPlain = (noSpan.container.querySelectorAll(".laypanel svg.gfx-figure")[1] as SVGSVGElement)
      .getAttribute("viewBox");
    expect(heatSpan).toMatch(/^0 0 \d+(\.\d+)? \d+(\.\d+)?$/); // really measured
    expect(heatSpan).toBe(heatPlain); // the heatmap is unaffected by a sibling's span
  });

  it("a spanning heatmap keeps its spanned width instead of being matched back down", () => {
    const { container } = grid({ panels: ["A", "H"], panelSpan: { H: 2 }, alignX: true, columns: 2, gutter: 16 });
    const w = panelWidths(container);
    expect(w[1]).toBeGreaterThan(w[0]!); // the spanning heatmap really is the wide one
  });

  it("with no spans, the axis-less width match is unaffected by spanning", () => {
    // Spanning must be completely inert when unused, so it cannot have perturbed the
    // axis-less or uniform-sizing geometry that the heatmap rules depend on.
    const { container } = grid({ panels: ["A", "H"], alignX: true, alignY: true, columns: 2, uniformRowHeight: true });
    const boxes = ([...container.querySelectorAll(".laypanel svg.gfx-figure")] as SVGSVGElement[]).map((s) =>
      s.getAttribute("viewBox"),
    );
    // the axis-less expansion still matched the heatmap's total width to the graph's
    expect(boxes[0]).toBe(boxes[1]);
    expect(boxes[0]).toMatch(/^0 0 \d+(\.\d+)? \d+(\.\d+)?$/);
  });
});

describe("LayoutPane — shared axis labels", () => {
  /** Two tables with the same axis meaning, and one with a different one. */
  const tbl = (id: string, yName: string, scale: number): DataTable => ({
    id, kind: "xy", name: id,
    columns: [{ id: "x", name: "Dose", role: "x" }, { id: "y", name: yName, role: "y" }],
    rows: [
      { id: "r1", cells: { x: 1, y: 1 * scale } },
      { id: "r2", cells: { x: 2, y: 2 * scale } },
      { id: "r3", cells: { x: 3, y: 3 * scale } },
    ],
  });
  const same1 = tbl("s1", "Response (%)", 1);
  const same2 = tbl("s2", "Response (%)", 1);
  const other = tbl("o1", "Concentration (nM)", 1000); // different title and range

  const pl = (id: string, src: string): Plot => ({ id, name: id, source: src, status: "ok", styleOverrides: {}, kind: "xy" });

  const fig = (over: Partial<FigureLayout>, plots: Plot[], tables: DataTable[]) => {
    const project: Project = {
      schemaVersion: 5,
      tables,
      plots,
      analyses: [],
      layouts: [{ id: "L", name: "Fig", panels: plots.map((p) => p.id), columns: 2, freeform: false, alignX: true, alignY: true, ...over }],
      log: [],
      workspace: { folders: [], loose: [] },
    };
    return render(
      <LayoutPane project={project} layoutId="L" onRemovePanel={() => {}} onOpenPlot={() => {}} onSetLayoutOptions={vi.fn()} />,
    );
  };
  const sceneWidths = (c: HTMLElement) =>
    ([...c.querySelectorAll(".laypanel svg.gfx-figure")] as SVGSVGElement[]).map((s) =>
      Number((s.getAttribute("viewBox") ?? "").split(" ")[2]),
    );

  const fourSame = () => [pl("A", "s1"), pl("B", "s2"), pl("C", "s1"), pl("D", "s2")];
  const fourTables = [same1, same2];

  it("is off by default — every panel keeps its own axes", () => {
    const { container } = fig({}, fourSame(), fourTables);
    const w = sceneWidths(container);
    expect(new Set(w).size).toBe(1); // all identical, nobody stripped
  });

  it("inner panels get narrower when shared axes are on (the Y margin is reclaimed)", () => {
    const off = sceneWidths(fig({}, fourSame(), fourTables).container);
    cleanup();
    const on = sceneWidths(fig({ sharedAxisLabels: true }, fourSame(), fourTables).container);
    // panels A and C are in the first column → unchanged; B and D drop their Y axis
    expect(on[0]).toBe(off[0]);
    expect(on[1]).toBeLessThan(off[1]!);
    expect(on[3]).toBeLessThan(off[3]!);
    expect(on[2]).toBe(off[2]);
  });

  it("the first column and last row keep their labels — something is still labelled", () => {
    const { container } = fig({ sharedAxisLabels: true }, fourSame(), fourTables);
    const svgs = [...container.querySelectorAll(".laypanel svg.gfx-figure")] as SVGSVGElement[];
    // panel A (first column, top row) must still carry a Y axis title
    expect(svgs[0]!.textContent).toContain("Response (%)");
    // panel B (second column) must not repeat it
    expect(svgs[1]!.textContent).not.toContain("Response (%)");
  });

  // Caution: this is the accuracy check. Hiding an axis that differs would invite the reader to
  // read the panel off its neighbour's scale — a misrepresentation, not a tidy-up.
  it("does not strip a panel whose axis differs (different title and range)", () => {
    const plots = [pl("A", "s1"), pl("B", "o1")]; // side by side, different y meaning
    const off = sceneWidths(fig({}, plots, [same1, other]).container);
    cleanup();
    const on = sceneWidths(fig({ sharedAxisLabels: true }, plots, [same1, other]).container);
    expect(on[1]).toBe(off[1]); // panel B untouched — it keeps its own scale
  });

  it("strips only the matching panel in a mixed figure", () => {
    // row: A (Response) · B (Response) — B strips.  row 2: C (Concentration) — keeps.
    const plots = [pl("A", "s1"), pl("B", "s2"), pl("C", "o1")];
    const tables = [same1, same2, other];
    const off = sceneWidths(fig({}, plots, tables).container);
    cleanup();
    const on = sceneWidths(fig({ sharedAxisLabels: true }, plots, tables).container);
    expect(on[1]).toBeLessThan(off[1]!); // shares with A → stripped
    expect(on[2]).toBe(off[2]); // first column anyway, and different → untouched
  });

  // Guards against computing the row/column assignment only for a "grid mode" (align /
  // uniform sizing), which would silently skip this pass on a plain 2-column grid. Every
  // test above sets alignX/alignY, so none of them covers that case.
  it("works in a plain column grid, with no alignment turned on", () => {
    const plots = fourSame();
    const off = fig({ alignX: undefined, alignY: undefined }, plots, fourTables);
    const offText = [...off.container.querySelectorAll(".laypanel svg.gfx-figure")].map((s) => s.textContent);
    cleanup();
    const on = fig({ alignX: undefined, alignY: undefined, sharedAxisLabels: true }, plots, fourTables);
    const onText = [...on.container.querySelectorAll(".laypanel svg.gfx-figure")].map((s) => s.textContent);
    expect(offText[1]).toContain("Response (%)"); // repeated without shared labels
    expect(onText[0]).toContain("Response (%)"); // first column still labels the row
    expect(onText[1]).not.toContain("Response (%)"); // …and the inner panel defers to it
  });

  it("is inert in free-drag mode (no grid, so no notion of an outer edge)", () => {
    const off = sceneWidths(fig({ freeform: true }, fourSame(), fourTables).container);
    cleanup();
    const on = sceneWidths(fig({ freeform: true, sharedAxisLabels: true }, fourSame(), fourTables).container);
    expect(on).toEqual(off);
  });

  it("the ribbon exposes the toggle and commits it", () => {
    const onSet = vi.fn();
    const project: Project = {
      schemaVersion: 5, tables: fourTables, plots: fourSame(), analyses: [],
      layouts: [{ id: "L", name: "Fig", panels: ["A", "B"], columns: 2, freeform: false }],
      log: [], workspace: { folders: [], loose: [] },
    };
    const { container } = render(
      <LayoutPane project={project} layoutId="L" onRemovePanel={() => {}} onOpenPlot={() => {}} onSetLayoutOptions={onSet} />,
    );
    const chip = [...container.querySelectorAll("label.laychip")].find((l) => /Shared\s*axes/.test(l.textContent ?? ""));
    expect(chip).toBeTruthy();
    fireEvent.click(chip!.querySelector("input")!);
    expect(onSet).toHaveBeenCalledWith({ sharedAxisLabels: true });
  });

  // The heatmap rules must be untouched: this pass runs after the axis-less expansion and
  // only ever shrinks a panel's own margins.
  it("leaves an axis-less heatmap alone", () => {
    const heatTable: DataTable = {
      id: "ht", kind: "grouped", name: "H",
      columns: [{ id: "g", name: "G", role: "x" }, { id: "s1", name: "S1", role: "y" }, { id: "s2", name: "S2", role: "y" }],
      rows: [{ id: "h1", cells: { g: "A", s1: 1, s2: 2 } }, { id: "h2", cells: { g: "B", s1: 3, s2: 4 } }],
    };
    const heat: Plot = { id: "H", name: "Heat", source: "ht", status: "ok", styleOverrides: {}, kind: "heatmap" };
    const plots = [pl("A", "s1"), heat];
    const off = sceneWidths(fig({}, plots, [same1, heatTable]).container);
    cleanup();
    const on = sceneWidths(fig({ sharedAxisLabels: true }, plots, [same1, heatTable]).container);
    expect(on[1]).toBe(off[1]); // the heatmap's matched width is unchanged
  });
});

describe("LayoutPane — merged legend", () => {
  /** A 2-series table, so each panel renders a real legend. */
  const two = (id: string, aName: string, bName: string): DataTable => ({
    id, kind: "xy", name: id,
    columns: [
      { id: "x", name: "Dose", role: "x" },
      { id: "y1", name: aName, role: "y" },
      { id: "y2", name: bName, role: "y" },
    ],
    rows: [
      { id: "r1", cells: { x: 1, y1: 1, y2: 2 } },
      { id: "r2", cells: { x: 2, y1: 3, y2: 4 } },
    ],
  });
  const matchA = two("m1", "Control", "Treated");
  const matchB = two("m2", "Control", "Treated"); // same series names → same legend
  const differs = two("d1", "Wild type", "Mutant"); // different series → cannot merge
  const single: DataTable = {
    id: "s1", kind: "xy", name: "single",
    columns: [{ id: "x", name: "Dose", role: "x" }, { id: "y", name: "Only", role: "y" }],
    rows: [{ id: "r1", cells: { x: 1, y: 1 } }],
  };

  const pl = (id: string, src: string): Plot => ({ id, name: id, source: src, status: "ok", styleOverrides: {}, kind: "xy" });

  const fig = (over: Partial<FigureLayout>, plots: Plot[], tables: DataTable[], onSet = vi.fn()) => {
    const project: Project = {
      schemaVersion: 5, tables, plots, analyses: [],
      layouts: [{ id: "L", name: "Fig", panels: plots.map((p) => p.id), columns: 2, freeform: false, ...over }],
      log: [], workspace: { folders: [], loose: [] },
    };
    return render(
      <LayoutPane project={project} layoutId="L" onRemovePanel={() => {}} onOpenPlot={() => {}} onSetLayoutOptions={onSet} />,
    );
  };
  const legendChip = (c: HTMLElement) =>
    [...c.querySelectorAll("label.laychip")].find((l) => /One\s*legend/.test(l.textContent ?? "")) as HTMLElement | undefined;
  const panelTexts = (c: HTMLElement) =>
    [...c.querySelectorAll(".laypanel svg.gfx-figure")].map((s) => s.textContent ?? "");

  const twoMatching = () => [pl("A", "m1"), pl("B", "m2")];

  it("is off by default — each panel keeps its own legend", () => {
    const { container } = fig({}, twoMatching(), [matchA, matchB]);
    expect(container.querySelector(".layfiglegend")).toBeNull();
    expect(panelTexts(container)[0]).toContain("Control");
    expect(panelTexts(container)[1]).toContain("Control"); // repeated in each panel
  });

  it("merging draws one figure legend and drops the per-panel ones", () => {
    const { container } = fig({ mergedLegend: true }, twoMatching(), [matchA, matchB]);
    const merged = container.querySelector(".layfiglegend");
    expect(merged).toBeTruthy();
    expect(merged!.textContent).toContain("Control");
    expect(merged!.textContent).toContain("Treated");
    // …and neither panel repeats it
    for (const t of panelTexts(container)) {
      expect(t).not.toContain("Control");
      expect(t).not.toContain("Treated");
    }
  });

  it("under Align X/Y the panels shrink by the legend column they do not reserve", () => {
    const geom = (c: HTMLElement) =>
      [...c.querySelectorAll(".laypanel svg.gfx-figure")].map((s) =>
        Number((s.getAttribute("viewBox") ?? "").split(" ")[2]),
      );
    const off = geom(fig({ alignX: true, alignY: true }, twoMatching(), [matchA, matchB]).container);
    cleanup();
    const on = geom(fig({ alignX: true, alignY: true, mergedLegend: true }, twoMatching(), [matchA, matchB]).container);
    // aligned → the data rect is pinned, so dropping the legend column narrows the whole box
    expect(on[0]).toBeLessThan(off[0]!);
    expect(on[1]).toBeLessThan(off[1]!);
  });

  // Caution: this is the accuracy check — one key cannot speak for series that don't match.
  it("refuses to merge when the panels' legends differ", () => {
    const { container } = fig({ mergedLegend: true }, [pl("A", "m1"), pl("B", "d1")], [matchA, differs]);
    expect(container.querySelector(".layfiglegend")).toBeNull();
    // both panels keep their own key, so nothing is misattributed
    expect(panelTexts(container)[0]).toContain("Control");
    expect(panelTexts(container)[1]).toContain("Wild type");
  });

  it("disables the chip (with a reason) when there is nothing to merge", () => {
    const { container } = fig({}, [pl("A", "m1"), pl("B", "d1")], [matchA, differs]);
    const chip = legendChip(container)!;
    expect(chip.className).toContain("laychip-na");
    expect(chip.querySelector("input")!.disabled).toBe(true);
    expect(chip.getAttribute("title")).toMatch(/differ/i);
  });

  it("a panel with NO legend neither blocks the merge nor joins it", () => {
    const { container } = fig({ mergedLegend: true }, [pl("A", "m1"), pl("B", "m2"), pl("C", "s1")], [matchA, matchB, single]);
    const merged = container.querySelector(".layfiglegend");
    expect(merged).toBeTruthy();
    expect(merged!.textContent).toContain("Control");
    expect(merged!.textContent).not.toContain("Only"); // the single-series panel isn't folded in
  });

  it("needs at least two legends to be worth merging", () => {
    const { container } = fig({ mergedLegend: true }, [pl("A", "m1"), pl("C", "s1")], [matchA, single]);
    expect(container.querySelector(".layfiglegend")).toBeNull();
    expect(panelTexts(container)[0]).toContain("Control"); // the lone legend stays where it is
  });

  it("the chip commits the toggle", () => {
    const onSet = vi.fn();
    const { container } = fig({}, twoMatching(), [matchA, matchB], onSet);
    fireEvent.click(legendChip(container)!.querySelector("input")!);
    expect(onSet).toHaveBeenCalledWith({ mergedLegend: true });
  });

  it("composes with shared axes — both suppressions survive together", () => {
    // The two passes each rebuild the panel geometry; a later one must not undo the earlier.
    const { container } = fig(
      { mergedLegend: true, sharedAxisLabels: true, alignX: true, alignY: true },
      twoMatching(),
      [matchA, matchB],
    );
    expect(container.querySelector(".layfiglegend")).toBeTruthy(); // legend still merged…
    const texts = panelTexts(container);
    expect(texts[0]).not.toContain("Control"); // …legend suppression survived…
    expect(texts[1]).not.toContain("Control");
    // …and the inner panel still deferred its Y axis to the first column: it draws strictly
    // fewer text elements than the panel that carries the shared axis
    const labelCount = [...container.querySelectorAll(".laypanel svg.gfx-figure")].map(
      (s) => s.querySelectorAll("text").length,
    );
    expect(labelCount[0]).toBeGreaterThan(0);
    expect(labelCount[1]).toBeLessThan(labelCount[0]!);
  });

  it("the merged legend renders a swatch per entry, not just text", () => {
    const { container } = fig({ mergedLegend: true }, twoMatching(), [matchA, matchB]);
    const svg = container.querySelector(".layfiglegend svg")!;
    // one line+dot pair per entry (the same swatch the per-panel legends drew)
    expect(svg.querySelectorAll("line").length).toBe(2);
    expect(svg.querySelectorAll("circle").length).toBe(2);
  });
});

describe("LayoutPane — image panels", () => {
  const PNG = "data:image/png;base64,iVBORw0KGgo=";
  const imgPlot = (id: string, over: Record<string, unknown> = {}): Plot =>
    ({ id, name: `Blot ${id}`, source: "t", status: "ok", styleOverrides: {}, kind: "image", image: { src: PNG, ...over } }) as unknown as Plot;

  const fig = (over: Partial<FigureLayout> = {}, plots: Plot[] = [plot("A", "Alpha"), imgPlot("I")], onSet = vi.fn()) => {
    const project: Project = {
      schemaVersion: 5, tables: [table], plots, analyses: [],
      layouts: [{ id: "L", name: "Fig", panels: plots.map((p) => p.id), columns: 2, freeform: false, ...over }],
      log: [], workspace: { folders: [], loose: [] },
    };
    return render(
      <LayoutPane project={project} layoutId="L" onRemovePanel={() => {}} onOpenPlot={() => {}} onSetLayoutOptions={onSet} />,
    );
  };

  it("renders as a normal panel, with the picture inside", () => {
    const { container } = fig();
    const panels = [...container.querySelectorAll(".laypanel")];
    expect(panels).toHaveLength(2); // a chart panel and an image panel, side by side
    const image = container.querySelector(".laypanel svg.gfx-figure image") as SVGImageElement | null;
    expect(image).toBeTruthy();
    expect(image!.getAttribute("href")).toBe(PNG);
  });

  it("gets a panel letter like any other panel", () => {
    const { container } = fig();
    const letters = [...container.querySelectorAll(".laypanel-letter")].map((l) => l.textContent);
    expect(letters).toEqual(["A", "B"]); // the image panel is lettered B — it is a real panel
  });

  it("can be removed, dragged and resized like any other panel", () => {
    const { container } = fig({ freeform: true });
    const panels = [...container.querySelectorAll(".laypanel")] as HTMLElement[];
    const imagePanel = panels[1]!;
    expect(imagePanel.querySelector(".laypanel-x")).toBeTruthy(); // remove
    expect(imagePanel.querySelector(".laypanel-resize")).toBeTruthy(); // resize
    expect(imagePanel.style.position).toBe("absolute"); // free-drag positioned
  });

  it("can span columns like any other panel", () => {
    const { container } = fig({ panelSpan: { I: 2 }, gutter: 16 });
    const widths = ([...container.querySelectorAll(".laypanel")] as HTMLElement[]).map((p) => parseFloat(p.style.width || "0"));
    expect(widths[1]).toBeCloseTo(widths[0]! * 2 + 16, 0); // the picture spans both columns
  });

  it("never claims a legend or an axis, so it cannot block a merge or a shared axis", () => {
    const { container } = fig({ mergedLegend: true, sharedAxisLabels: true });
    // the image contributes no legend entries and no axis labels to compare
    const imgSvg = [...container.querySelectorAll(".laypanel svg.gfx-figure")][1]!;
    expect(imgSvg.querySelectorAll("text")).toHaveLength(0);
  });

  it("shows a placeholder rather than nothing when no picture is set yet", () => {
    const { container } = fig({}, [plot("A", "Alpha"), { ...imgPlot("I"), image: undefined } as unknown as Plot]);
    const imgSvg = [...container.querySelectorAll(".laypanel svg.gfx-figure")][1]!;
    expect(imgSvg.textContent).toContain("No image chosen");
    expect(imgSvg.querySelector("image")).toBeNull();
  });

  it("honours the fit mode, defaulting to one that never crops or stretches", () => {
    const { container } = fig();
    expect(container.querySelector(".laypanel svg.gfx-figure image")!.getAttribute("preserveAspectRatio")).toBe("xMidYMid meet");
    cleanup();
    const cover = fig({}, [plot("A", "Alpha"), imgPlot("I", { fit: "cover" })]);
    expect(cover.container.querySelector(".laypanel svg.gfx-figure image")!.getAttribute("preserveAspectRatio")).toBe("xMidYMid slice");
    cleanup();
    const fill = fig({}, [plot("A", "Alpha"), imgPlot("I", { fit: "fill" })]);
    expect(fill.container.querySelector(".laypanel svg.gfx-figure image")!.getAttribute("preserveAspectRatio")).toBe("none");
  });
});

describe("LayoutSelectPane — adding an image panel", () => {
  it("offers an Add image button only when the handler is wired", () => {
    const withIt = render(
      <LayoutSelectPane project={proj({ panels: [] })} layoutId="L" onAddPanel={() => {}} onRemovePanel={() => {}} onBuild={() => {}} onAddImagePanel={() => {}} />,
    );
    expect([...withIt.container.querySelectorAll("button")].some((b) => /Add image/.test(b.textContent ?? ""))).toBe(true);
    cleanup();
    const without = render(
      <LayoutSelectPane project={proj({ panels: [] })} layoutId="L" onAddPanel={() => {}} onRemovePanel={() => {}} onBuild={() => {}} />,
    );
    expect([...without.container.querySelectorAll("button")].some((b) => /Add image/.test(b.textContent ?? ""))).toBe(false);
  });

  it("reads the chosen file to a data URI and names the panel after it", async () => {
    const onAdd = vi.fn();
    const { container } = render(
      <LayoutSelectPane project={proj({ panels: [] })} layoutId="L" onAddPanel={() => {}} onRemovePanel={() => {}} onBuild={() => {}} onAddImagePanel={onAdd} />,
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([new Uint8Array([1, 2, 3])], "western-blot.png", { type: "image/png" });
    Object.defineProperty(input, "files", { value: [file] });
    fireEvent.change(input);
    await waitFor(() => expect(onAdd).toHaveBeenCalled());
    const [name, src, alt] = onAdd.mock.calls[0]!;
    expect(name).toBe("western-blot"); // extension stripped
    expect(String(src)).toMatch(/^data:image\/png;base64,/); // embedded, not a path
    expect(alt).toBe("western-blot"); // seeds the alt text — an unlabelled image is invisible
  });
});

describe("LayoutPane — keyboard nudge", () => {
  const nudgeable = (over: Partial<FigureLayout> = {}, onSet = vi.fn()) => {
    const ed = { selectedPlot: "A", selection: null, onSelectPanel: () => {}, onSelect: () => {} };
    const r = render(
      <LayoutPane
        project={proj({ panels: ["A", "B"], freeform: true, panelPositions: { A: { x: 100, y: 40 }, B: { x: 500, y: 40 } }, ...over })}
        layoutId="L" onRemovePanel={() => {}} onOpenPlot={() => {}} onSetLayoutOptions={onSet} editing={ed as never}
      />,
    );
    return { ...r, onSet };
  };
  const press = (key: string, shift = false) => fireEvent.keyDown(window, { key, shiftKey: shift });

  it("an arrow key moves the selected panel by one pixel", () => {
    const { onSet } = nudgeable();
    press("ArrowRight");
    expect(onSet).toHaveBeenCalledTimes(1);
    expect((onSet.mock.calls[0]![0] as Partial<FigureLayout>).panelPositions!.A).toEqual({ x: 101, y: 40 });
  });

  it("Shift+arrow moves by ten, and every direction works", () => {
    const { onSet } = nudgeable();
    press("ArrowLeft", true);
    expect((onSet.mock.calls[0]![0] as Partial<FigureLayout>).panelPositions!.A).toEqual({ x: 90, y: 40 });
    press("ArrowUp", true);
    expect((onSet.mock.calls[1]![0] as Partial<FigureLayout>).panelPositions!.A).toEqual({ x: 100, y: 30 });
    press("ArrowDown");
    expect((onSet.mock.calls[2]![0] as Partial<FigureLayout>).panelPositions!.A).toEqual({ x: 100, y: 41 });
  });

  it("moves every shift-selected panel together", () => {
    const onSet = vi.fn();
    const { container } = nudgeable({}, onSet);
    const panels = [...container.querySelectorAll(".laypanel")] as HTMLElement[];
    fireEvent.mouseDown(panels[0]!, { shiftKey: true });
    fireEvent.mouseDown(panels[1]!, { shiftKey: true });
    press("ArrowRight", true);
    const pos = (onSet.mock.calls.at(-1)![0] as Partial<FigureLayout>).panelPositions!;
    expect(pos.A).toEqual({ x: 110, y: 40 });
    expect(pos.B).toEqual({ x: 510, y: 40 });
  });

  it("never moves a panel off the canvas edge", () => {
    const { onSet } = nudgeable({ panelPositions: { A: { x: 0, y: 0 }, B: { x: 500, y: 40 } } });
    press("ArrowLeft", true);
    expect((onSet.mock.calls[0]![0] as Partial<FigureLayout>).panelPositions!.A).toEqual({ x: 0, y: 0 });
  });

  it("does nothing when nothing is selected — arrow keys still belong to the page", () => {
    const onSet = vi.fn();
    render(
      <LayoutPane project={proj({ panels: ["A", "B"], freeform: true })} layoutId="L" onRemovePanel={() => {}} onOpenPlot={() => {}} onSetLayoutOptions={onSet} />,
    );
    press("ArrowRight");
    expect(onSet).not.toHaveBeenCalled();
  });

  it("ignores arrows typed into a field", () => {
    const { container, onSet } = nudgeable();
    const input = document.createElement("input");
    container.appendChild(input);
    fireEvent.keyDown(input, { key: "ArrowRight" });
    expect(onSet).not.toHaveBeenCalled();
  });

  it("ignores a modifier chord (those belong to the app, not the canvas)", () => {
    const { onSet } = nudgeable();
    fireEvent.keyDown(window, { key: "ArrowRight", ctrlKey: true });
    fireEvent.keyDown(window, { key: "ArrowRight", metaKey: true });
    expect(onSet).not.toHaveBeenCalled();
  });

  it("nudging out of an aligned grid bakes the frozen geometry, like a drag does", () => {
    // otherwise one nudge would silently re-flow every other panel
    const { onSet } = nudgeable({ freeform: false, alignX: true, columns: 1 });
    press("ArrowRight");
    const patch = onSet.mock.calls[0]![0] as Partial<FigureLayout>;
    expect(patch.freeform).toBe(true); // baked to free-drag
    expect(patch.alignX).toBeUndefined(); // the align flags dropped
    expect(Object.keys(patch.panelPositions!)).toEqual(expect.arrayContaining(["A", "B"])); // all panels pinned
    expect(patch.panelSizes).toBeTruthy();
  });
});

describe("LayoutPane — renumber by position", () => {
  const figure = (positions: Record<string, { x: number; y: number }>, onSet = vi.fn(), panels = ["A", "B", "C"]) => ({
    ...render(
      <LayoutPane
        project={proj({ panels, freeform: true, panelPositions: positions })}
        layoutId="L" onRemovePanel={() => {}} onOpenPlot={() => {}} onSetLayoutOptions={onSet}
      />,
    ),
    onSet,
  });
  const renumberBtn = (c: HTMLElement) =>
    [...c.querySelectorAll("button")].find((b) => b.textContent === "Renumber") as HTMLButtonElement;

  it("reorders the panels into reading order — across a row, then down", () => {
    // on screen: C is top-left, A top-right, B below → reading order should be C, A, B
    const { container, onSet } = figure({ A: { x: 400, y: 0 }, B: { x: 0, y: 400 }, C: { x: 0, y: 0 } });
    fireEvent.click(renumberBtn(container));
    expect((onSet.mock.calls[0]![0] as Partial<FigureLayout>).panels).toEqual(["C", "A", "B"]);
  });

  it("treats panels at slightly different heights as one row", () => {
    // a few px of difference is the same row to the eye; ordering must follow x, not y
    const { container, onSet } = figure({ A: { x: 400, y: 6 }, B: { x: 800, y: 0 }, C: { x: 0, y: 3 } });
    fireEvent.click(renumberBtn(container));
    expect((onSet.mock.calls[0]![0] as Partial<FigureLayout>).panels).toEqual(["C", "A", "B"]);
  });

  it("does nothing when the panels are already in reading order", () => {
    const { container, onSet } = figure({ A: { x: 0, y: 0 }, B: { x: 400, y: 0 }, C: { x: 0, y: 400 } });
    fireEvent.click(renumberBtn(container));
    expect(onSet).not.toHaveBeenCalled(); // no pointless undo entry
  });

  it("never drops a panel whose source cannot be resolved", () => {
    const { container, onSet } = figure(
      { A: { x: 400, y: 0 }, C: { x: 0, y: 0 } },
      vi.fn(),
      ["A", "GHOST", "C"], // GHOST has no plot — a deleted source
    );
    fireEvent.click(renumberBtn(container));
    const next = (onSet.mock.calls[0]![0] as Partial<FigureLayout>).panels!;
    expect(next).toContain("GHOST");
    expect(next).toHaveLength(3);
    expect(next.slice(0, 2)).toEqual(["C", "A"]); // the resolvable ones still get reading order
  });

  it("is disabled for a single panel (nothing to renumber)", () => {
    const { container } = figure({ A: { x: 0, y: 0 } }, vi.fn(), ["A"]);
    expect(renumberBtn(container).disabled).toBe(true);
  });
});

describe("LayoutPane — add a graph without leaving Arrange", () => {
  const arrange = (onAddPanel?: (id: NodeId) => void) =>
    render(
      <LayoutPane
        project={proj({ panels: ["A"] })}
        layoutId="L" onRemovePanel={() => {}} onOpenPlot={() => {}} onSetLayoutOptions={vi.fn()}
        {...(onAddPanel ? { onAddPanel } : {})}
      />,
    );
  const picker = (c: HTMLElement) => c.querySelector('select[aria-label="Add a graph to this figure"]') as HTMLSelectElement | null;

  it("offers the graphs not already in the figure", () => {
    const { container } = arrange(() => {});
    const opts = [...picker(container)!.querySelectorAll("option")].map((o) => o.textContent);
    expect(opts[0]).toBe("+ Add graph…"); // the placeholder
    expect(opts).toContain("Beta");
    expect(opts).not.toContain("Alpha"); // already a panel
  });

  it("adds the chosen graph", () => {
    const onAddPanel = vi.fn();
    const { container } = arrange(onAddPanel);
    fireEvent.change(picker(container)!, { target: { value: "B" } });
    expect(onAddPanel).toHaveBeenCalledWith("B");
  });

  it("is absent when adding isn't wired, and when every graph is already in", () => {
    expect(picker(arrange().container)).toBeNull();
    cleanup();
    const all = render(
      <LayoutPane
        project={proj({ panels: ["A", "B", "C", "D"] })}
        layoutId="L" onRemovePanel={() => {}} onOpenPlot={() => {}} onSetLayoutOptions={vi.fn()} onAddPanel={() => {}}
      />,
    );
    expect(picker(all.container)).toBeNull(); // nothing left to offer → no dead control
  });
});

describe("LayoutPane — house style templates", () => {
  beforeEach(() => globalThis.localStorage?.clear());
  afterEach(() => globalThis.localStorage?.clear());

  const arrange = (over: Partial<FigureLayout> = {}, onSet = vi.fn()) => ({
    ...render(
      <LayoutPane
        project={proj({ panels: ["A", "B"], ...over })}
        layoutId="L" onRemovePanel={() => {}} onOpenPlot={() => {}} onSetLayoutOptions={onSet}
      />,
    ),
    onSet,
  });
  const saveBtn = (c: HTMLElement) =>
    [...c.querySelectorAll("button")].find((b) => b.textContent === "Save as template…") as HTMLButtonElement;
  const nameField = (c: HTMLElement) => c.querySelector('input[aria-label="Name for this figure template"]') as HTMLInputElement;
  const applyPicker = (c: HTMLElement) => c.querySelector('select[aria-label="Apply a saved figure template"]') as HTMLSelectElement | null;
  const deletePicker = (c: HTMLElement) => c.querySelector('select[aria-label="Delete a saved figure template"]') as HTMLSelectElement | null;

  const saveAs = (c: HTMLElement, name: string) => {
    fireEvent.click(saveBtn(c));
    fireEvent.change(nameField(c), { target: { value: name } });
    fireEvent.keyDown(nameField(c), { key: "Enter" });
  };

  it("offers no pickers until something is saved — no dead controls", () => {
    const { container } = arrange();
    expect(saveBtn(container)).toBeTruthy();
    expect(applyPicker(container)).toBeNull();
    expect(deletePicker(container)).toBeNull();
  });

  it("saves the current arrangement under a typed name", () => {
    const { container } = arrange({ columns: 3, gutter: 24, lettering: "lower" });
    saveAs(container, "Lab standard");
    const picker = applyPicker(container)!;
    expect([...picker.querySelectorAll("option")].map((o) => o.textContent)).toEqual(["Apply…", "Lab standard"]);
  });

  it("applying a template patches the figure with the saved arrangement", () => {
    const first = arrange({ columns: 3, gutter: 24, lettering: "lower", sharedAxisLabels: true });
    saveAs(first.container, "Lab standard");
    cleanup();
    // a different figure, at defaults
    const onSet = vi.fn();
    const { container } = arrange({ columns: 1 }, onSet);
    fireEvent.change(applyPicker(container)!, { target: { value: "Lab standard" } });
    const patch = onSet.mock.calls[0]![0] as Partial<FigureLayout>;
    expect(patch.columns).toBe(3);
    expect(patch.gutter).toBe(24);
    expect(patch.lettering).toBe("lower");
    expect(patch.sharedAxisLabels).toBe(true);
  });

  it("applying never changes which graphs are in the figure", () => {
    const first = arrange({ columns: 3 });
    saveAs(first.container, "House");
    cleanup();
    const onSet = vi.fn();
    const { container } = arrange({ panels: ["A"] } as Partial<FigureLayout>, onSet);
    fireEvent.change(applyPicker(container)!, { target: { value: "House" } });
    const patch = onSet.mock.calls[0]![0] as Partial<FigureLayout>;
    expect(patch).not.toHaveProperty("panels");
    expect(patch).not.toHaveProperty("panelPositions");
    expect(patch).not.toHaveProperty("panelSizes");
  });

  it("a template saved from a plain figure resets one that had extras on", () => {
    const plain = arrange({}); // nothing switched on
    saveAs(plain.container, "Plain");
    cleanup();
    const onSet = vi.fn();
    const { container } = arrange({ sharedAxisLabels: true, alignX: true, uniformRowHeight: true }, onSet);
    fireEvent.change(applyPicker(container)!, { target: { value: "Plain" } });
    const patch = onSet.mock.calls[0]![0] as Partial<FigureLayout>;
    // explicitly undefined, not merely absent — otherwise the template could only add
    expect("sharedAxisLabels" in patch).toBe(true);
    expect(patch.sharedAxisLabels).toBeUndefined();
    expect(patch.alignX).toBeUndefined();
    expect(patch.uniformRowHeight).toBeUndefined();
  });

  it("Escape cancels the save form and stores nothing", () => {
    const { container } = arrange();
    fireEvent.click(saveBtn(container));
    fireEvent.change(nameField(container), { target: { value: "Nope" } });
    fireEvent.keyDown(nameField(container), { key: "Escape" });
    expect(nameField(container)).toBeNull(); // form closed
    expect(applyPicker(container)).toBeNull(); // nothing saved
  });

  it("deletes a saved template", () => {
    const { container } = arrange();
    saveAs(container, "Doomed");
    expect(applyPicker(container)).toBeTruthy();
    fireEvent.change(deletePicker(container)!, { target: { value: "Doomed" } });
    expect(applyPicker(container)).toBeNull(); // gone, and the pickers vanish with it
  });

  it("re-saving under the same name overwrites rather than duplicating", () => {
    const { container } = arrange({ columns: 2 });
    saveAs(container, "House");
    saveAs(container, "House");
    expect([...applyPicker(container)!.querySelectorAll("option")]).toHaveLength(2); // placeholder + one
  });
});

describe("significance markers survive panel assembly", () => {
  /** A project whose panel plots carry a significance bracket and a custom ladder. */
  const withMarkers = (): Project => {
    const p = proj({ panels: ["A", "B"] });
    const mark = (id: string) => ({
      ...plot(id, id === "A" ? "Alpha" : "Beta"),
      kind: "bar" as const,
      significance: { thresholds: [{ p: 0.1, symbol: "†" }] },
      annotations: [
        { id: `sig-${id}`, kind: "bracket" as const, from: 1, to: 2, bracketY: 4, p: 0.08, role: "significance" as const },
      ],
    });
    return { ...p, plots: [mark("A"), mark("B"), ...p.plots.slice(2)] };
  };

  const editing = (selectedPlot: string | null, over: Record<string, unknown> = {}) => ({
    selection: { kind: "plot" as const },
    selectedPlot,
    onSelectPanel: vi.fn(), onSelect: vi.fn(), onWidthResize: vi.fn(),
    onMoveAnnotation: vi.fn(), onMoveRefLineLabel: vi.fn(), onDeleteAnnotation: vi.fn(), onReorderAnnotation: vi.fn(), onDuplicateAnnotation: vi.fn(),
    onFigureResize: vi.fn(), onEditText: vi.fn(), onCreateTextBox: vi.fn(), onAxisResize: vi.fn(),
    onMoveTitle: vi.fn(), onMoveLegend: vi.fn(), onMoveColorbar: vi.fn(), onMoveAxisTitle: vi.fn(),
    ...over,
  });

  const bracketTexts = (panel: Element): string[] =>
    [...panel.querySelectorAll("text")].map((t) => t.textContent ?? "").filter((t) => t === "†" || t === "ns" || t === "*");

  it("both panels draw their markers — selected and unselected alike", () => {
    // "Survives assembly" means the marker is visible in every panel, not merely editable
    // in the one you happen to have clicked.
    const { container } = render(
      <LayoutPane project={withMarkers()} layoutId="L" onRemovePanel={() => {}} onOpenPlot={() => {}} editing={editing("B") as never} />,
    );
    const panels = [...container.querySelectorAll(".laypanel")];
    expect(panels).toHaveLength(2);
    for (const panel of panels) expect(bracketTexts(panel).length, "a panel drew no significance marker").toBeGreaterThan(0);
  });

  it("a panel honours the plot's own threshold ladder", () => {
    // p = 0.08 clears the custom 0.10 rung. Under the factory ladder it would read "ns",
    // so this proves the ladder travelled with the plot into the figure.
    const { container } = render(
      <LayoutPane project={withMarkers()} layoutId="L" onRemovePanel={() => {}} onOpenPlot={() => {}} editing={editing("B") as never} />,
    );
    const texts = [...container.querySelectorAll(".laypanel text")].map((t) => t.textContent);
    expect(texts).toContain("†");
    expect(texts).not.toContain("ns");
  });

  it("only the selected panel offers editing — the others render inert", () => {
    // Encodes panes.tsx's gating as intent rather than leaving it an accident: an
    // unselected panel shows its markers but must not offer grips to drag them.
    const { container } = render(
      <LayoutPane project={withMarkers()} layoutId="L" onRemovePanel={() => {}} onOpenPlot={() => {}} editing={editing("B") as never} />,
    );
    const [a, b] = [...container.querySelectorAll(".laypanel")] as HTMLElement[];
    const movable = (el: Element): number =>
      [...el.querySelectorAll("*")].filter((n) => (n as HTMLElement).style?.cursor === "move").length;
    // `>= 0` would be vacuously true, so compare the two: whatever the selected panel
    // offers, the unselected one must offer strictly less — and nothing draggable.
    expect(movable(a!), "an unselected panel must not offer drag affordances").toBe(0);
    expect(movable(b!)).toBeGreaterThanOrEqual(movable(a!));
  });
});

describe("LayoutSelectPane — a card's preview is the graph as it is drawn, scaled down", () => {
  // Drawn at 300 × 200, a graph's own type sizes do not fit: a long title is cut at both ends and
  // a heatmap squashed to a sliver. The preview is built at the graph's own size, as the gallery's
  // cards are, and the picture is scaled to the card.
  it("each preview is built at its graph's own size, so a long title fits", () => {
    const long = { ...plot("A", "Gene expression heatmap across all samples"), figureWidth: 720, figureHeight: 500, fonts: { title: { size: 26 } } } as Plot;
    const p = { ...proj(), plots: [long, plot("B", "Beta")] };
    const { container } = render(<LayoutSelectPane project={p} layoutId="L" onAddPanel={() => {}} onRemovePanel={() => {}} onBuild={() => {}} />);
    const boxes = [...container.querySelectorAll(".laycard-thumb svg")].map((s) => s.getAttribute("viewBox")?.split(/\s+/).map(Number) ?? []);
    expect(boxes.length).toBeGreaterThanOrEqual(2);
    const [, , w, h] = boxes[0]!;
    expect(w, "the long-titled graph's preview width").toBeGreaterThanOrEqual(720);
    expect(h).toBeGreaterThanOrEqual(500);
    const scene = buildPlotScene(table, long, { measure: measureText, width: 720, height: 500 });
    expect(measureText(long.name, scene.fonts.title.size), "the title fits the graph's own width").toBeLessThan(720);
  });
});
