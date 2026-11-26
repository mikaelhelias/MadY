// @vitest-environment jsdom
// Figure-level annotations: text / arrows / lines / boxes / ellipses drawn
// on the assembler canvas between panels — not inside any one graph. Covers the whole spine:
// the document mutations, the graphics resolver, the LayoutPane overlay + Insert buttons,
// and the export composer that must paint the objects into the composed SVG.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render as rtlRender } from "@testing-library/react";
import { openFigureMenus } from "./figureToolbar.testutil";
import { MadyDocument } from "@mady/core";
import type { DataTable, FigureLayout, Plot, Project } from "@mady/core";
import { resolveFigureAnnotations } from "@mady/graphics";
import { composeFigureSvg } from "./exporters";
import { LayoutPane } from "./panes";
/** The figure toolbar's Align ▾ / Line up ▾ / Insert ▾ / Style ▾ menus are opened right after rendering, as a user
 *  opens them to reach a control inside — this changes only where tests find a control, never what they check. */
const render = ((ui: Parameters<typeof rtlRender>[0], options?: Parameters<typeof rtlRender>[1]) => {
  const r = rtlRender(ui, options);
  openFigureMenus(r.container);
  return r;
}) as typeof rtlRender;

afterEach(cleanup);

// --- document mutations ------------------------------------------------------------------

function docWithLayout(): { doc: MadyDocument; layoutId: string } {
  const doc = new MadyDocument();
  const layout = doc.addLayout("Fig 1");
  return { doc, layoutId: layout.id };
}

describe("figure annotations — document mutations", () => {
  it("addLayoutAnnotation stores the object (canvas px) and is undoable", () => {
    const { doc, layoutId } = docWithLayout();
    const ann = doc.addLayoutAnnotation(layoutId, { kind: "text", label: "Shared heading", x: 240, y: 30 });
    expect(ann.id).toBeTruthy();
    const stored = doc.toJSON().layouts!.find((l) => l.id === layoutId)!.figureAnnotations;
    expect(stored).toHaveLength(1);
    expect(stored![0]!.x).toBe(240);
    doc.commands.undo();
    expect(doc.toJSON().layouts!.find((l) => l.id === layoutId)!.figureAnnotations ?? []).toHaveLength(0);
  });

  it("updateLayoutAnnotation merges a patch; an unknown id throws (no silent no-op)", () => {
    const { doc, layoutId } = docWithLayout();
    const ann = doc.addLayoutAnnotation(layoutId, { kind: "rect", x: 10, y: 10, w: 100, h: 60 });
    doc.updateLayoutAnnotation(layoutId, ann.id, { color: "#ff0000" });
    expect(doc.toJSON().layouts![0]!.figureAnnotations![0]!.color).toBe("#ff0000");
    expect(() => doc.updateLayoutAnnotation(layoutId, "nope", { color: "#000" })).toThrow();
  });

  it("moveLayoutAnnotation coalesces a drag to one undo step", () => {
    const { doc, layoutId } = docWithLayout();
    const ann = doc.addLayoutAnnotation(layoutId, { kind: "text", label: "t", x: 100, y: 100 });
    doc.moveLayoutAnnotation(layoutId, ann.id, { x: 120, y: 110 });
    doc.moveLayoutAnnotation(layoutId, ann.id, { x: 140, y: 120 });
    expect(doc.toJSON().layouts![0]!.figureAnnotations![0]!.x).toBe(140);
    doc.commands.undo(); // one undo returns to the pre-drag position, not the drag midpoint
    expect(doc.toJSON().layouts![0]!.figureAnnotations![0]!.x).toBe(100);
  });

  it("a locked figure annotation ignores moves", () => {
    const { doc, layoutId } = docWithLayout();
    const ann = doc.addLayoutAnnotation(layoutId, { kind: "text", label: "t", x: 100, y: 100, locked: true });
    doc.moveLayoutAnnotation(layoutId, ann.id, { x: 500 });
    expect(doc.toJSON().layouts![0]!.figureAnnotations![0]!.x).toBe(100);
  });

  it("removeLayoutAnnotation deletes; unknown id throws", () => {
    const { doc, layoutId } = docWithLayout();
    const ann = doc.addLayoutAnnotation(layoutId, { kind: "segment", x: 0, y: 0, x2: 100, y2: 0 });
    doc.removeLayoutAnnotation(layoutId, ann.id);
    expect(doc.toJSON().layouts![0]!.figureAnnotations ?? []).toHaveLength(0);
    expect(() => doc.removeLayoutAnnotation(layoutId, ann.id)).toThrow();
  });
});

// --- graphics resolver -------------------------------------------------------------------

describe("resolveFigureAnnotations — canvas-px passthrough", () => {
  it("resolves text + shapes at their stored px (unit-rect passthrough)", () => {
    const anns = resolveFigureAnnotations([
      { id: "t1", kind: "text", label: "hello", x: 300, y: 40 },
      { id: "r1", kind: "rect", x: 100, y: 50, w: 160, h: 100 },
      { id: "a1", kind: "arrow", x: 10, y: 20, x2: 210, y2: 20 },
    ], []);
    const t = anns.find((a) => a.id === "t1")!;
    expect(t.labelX).toBe(300);
    expect(t.labelY).toBe(40);
    const r = anns.find((a) => a.id === "r1")!;
    expect(Math.min(r.x1!, r.x2!)).toBe(100);
    expect(Math.abs(r.x2! - r.x1!)).toBe(160);
    const a = anns.find((a2) => a2.id === "a1")!;
    expect(a.x2).toBe(210);
  });

  it("refuses an axis-locked kind with a warning, never silently", () => {
    const warnings: string[] = [];
    const anns = resolveFigureAnnotations([{ id: "h1", kind: "hline", value: 5 }], warnings);
    expect(anns).toHaveLength(0);
    expect(warnings.length).toBeGreaterThan(0);
  });
});

// --- LayoutPane overlay + Insert group ---------------------------------------------------

const table: DataTable = {
  id: "t", kind: "xy", name: "T",
  columns: [{ id: "x", name: "X", role: "x" }, { id: "y", name: "Y", role: "y" }],
  rows: [{ id: "r1", cells: { x: 1, y: 2 } }, { id: "r2", cells: { x: 2, y: 4 } }],
};
const plot = (id: string, name: string): Plot => ({ id, name, source: "t", status: "ok", styleOverrides: {}, kind: "xy" });

function proj(layout: Partial<FigureLayout>): Project {
  return {
    schemaVersion: 5,
    tables: [table],
    plots: [plot("A", "Alpha"), plot("B", "Beta")],
    analyses: [],
    layouts: [{
      id: "L", name: "Figure 1", panels: ["A", "B"], freeform: true,
      panelPositions: { A: { x: 0, y: 0 }, B: { x: 420, y: 0 } },
      ...layout,
    }],
    log: [],
    workspace: { folders: [], loose: [{ kind: "plot", id: "A" }, { kind: "plot", id: "B" }, { kind: "layout", id: "L" }] },
  };
}

describe("LayoutPane — figure-annotation overlay", () => {
  it("renders stored figure annotations on a .layannot overlay above the canvas", () => {
    const { container } = render(
      <LayoutPane
        project={proj({ figureAnnotations: [{ id: "fa1", kind: "text", label: "Between panels", x: 200, y: 40 }] })}
        layoutId="L"
        onRemovePanel={() => {}}
        onOpenPlot={() => {}}
        onSetLayoutOptions={() => {}}
      />,
    );
    const overlay = container.querySelector(".layannot");
    expect(overlay, "no annotation overlay rendered on the arrange canvas").toBeTruthy();
    expect(overlay!.textContent).toContain("Between panels");
  });

  it("renders no overlay when the figure has no annotations", () => {
    const { container } = render(
      <LayoutPane project={proj({})} layoutId="L" onRemovePanel={() => {}} onOpenPlot={() => {}} onSetLayoutOptions={() => {}} />,
    );
    expect(container.querySelector(".layannot")).toBeNull();
  });

  it("Insert ▸ Text adds a text annotation in canvas px via onAddFigureAnnotation", () => {
    const onAdd = vi.fn();
    const { container } = render(
      <LayoutPane
        project={proj({})}
        layoutId="L"
        onRemovePanel={() => {}}
        onOpenPlot={() => {}}
        onSetLayoutOptions={() => {}}
        onAddFigureAnnotation={onAdd}
      />,
    );
    const btn = [...container.querySelectorAll("button")].find((b) => b.textContent === "Text");
    expect(btn, "no Insert ▸ Text button on the arrange ribbon").toBeTruthy();
    fireEvent.click(btn!);
    expect(onAdd).toHaveBeenCalledTimes(1);
    const ann = onAdd.mock.calls[0]![0] as { kind: string; x: number; label?: string };
    expect(ann.kind).toBe("text");
    // canvas px, not a 0..1 fraction
    expect(ann.x).toBeGreaterThan(1);
  });

  it("selected annotation: Delete removes it via onRemoveFigureAnnotation", () => {
    const onRemove = vi.fn();
    const { container } = render(
      <LayoutPane
        project={proj({ figureAnnotations: [{ id: "fa1", kind: "text", label: "Delete me", x: 200, y: 40 }] })}
        layoutId="L"
        onRemovePanel={() => {}}
        onOpenPlot={() => {}}
        onSetLayoutOptions={() => {}}
        onRemoveFigureAnnotation={onRemove}
        onMoveFigureAnnotation={() => {}}
      />,
    );
    const text = container.querySelector('.layannot [data-ann-text="fa1"]');
    expect(text).toBeTruthy();
    fireEvent.click(text!);
    fireEvent.keyDown(window, { key: "Delete" });
    expect(onRemove).toHaveBeenCalledWith("fa1");
  });
});

// --- export composer ---------------------------------------------------------------------

function svgEl(w = 380, h = 260): SVGSVGElement {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", `0 0 ${w} ${h}`);
  s.setAttribute("class", "gfx-figure");
  return s;
}

/** A .layannot-style overlay: canvas-spanning svg whose content sits at canvas px. */
function overlayEl(w: number, h: number, inner: string, bbox: { x: number; y: number; width: number; height: number }): SVGSVGElement {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", `0 0 ${w} ${h}`);
  s.setAttribute("class", "layannot");
  s.innerHTML = inner;
  // jsdom has no layout: stub the ink bbox the composer measures
  (s as unknown as { getBBox: () => { x: number; y: number; width: number; height: number } }).getBBox = () => bbox;
  return s;
}

describe("composeFigureSvg — figure-annotation overlay", () => {
  it("paints the overlay content into the composed SVG, aligned with the panels", () => {
    const panels = [svgEl(), svgEl()];
    const overlay = overlayEl(900, 300, '<text x="500" y="150" data-figann="1">note</text>', { x: 490, y: 130, width: 60, height: 24 });
    const out = composeFigureSvg(panels, {
      background: "white",
      margin: 10,
      places: [{ x: 0, y: 0 }, { x: 420, y: 0 }],
      letters: [null, null],
      overlay: { svg: overlay, x: 0, y: 0 },
    });
    expect(out).toBeTruthy();
    expect(out!.svg).toContain("data-figann");
    expect(out!.svg).toContain(">note<");
  });

  it("grows the page for an annotation outside the panels' box (never clips it away)", () => {
    const panels = [svgEl()];
    const withoutW = composeFigureSvg(panels, { background: "white", margin: 10, places: [{ x: 0, y: 0 }], letters: [null] })!.width;
    // an arrow ending 300px right of the lone panel's edge
    const overlay = overlayEl(900, 300, '<line x1="380" y1="100" x2="680" y2="100"/>', { x: 380, y: 99, width: 300, height: 2 });
    const withOv = composeFigureSvg(panels, {
      background: "white", margin: 10, places: [{ x: 0, y: 0 }], letters: [null],
      overlay: { svg: overlay, x: 0, y: 0 },
    })!;
    expect(withOv.width).toBeGreaterThanOrEqual(withoutW + 290);
  });
});
