// @vitest-environment jsdom
/**
 * What is picked on a figure shows its settings at the top of the Inspector, not in a toolbar row that appears on
 * click: such a row would push the canvas down the moment anything was picked, and a new text would land under the
 * status bar.
 *
 * The figure's own settings (panel lettering, what each card shows, shared axes, one legend) are the
 * Inspector's Figure view while nothing is picked, and a click on empty canvas brings that view back.
 *
 * `figure-controls.census.test` proves every figure control makes its change; this proves where the controls live,
 * that they stay in the toolbar when there is no Inspector to take them (collapsed), and the two Inspector views.
 */
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { Annotation, DataTable, FigureLayout, Plot, Project } from "@mady/core";
import { LayoutPane, PanelBuilderView } from "./panes";
import { Inspector } from "./Inspector";
import { openFigureMenus } from "./figureToolbar.testutil";

afterEach(() => { cleanup(); document.body.innerHTML = ""; });
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

const table: DataTable = {
  id: "t", kind: "xy", name: "T",
  columns: [{ id: "x", name: "X", role: "x" }, { id: "y", name: "Y", role: "y" }],
  rows: [{ id: "r1", cells: { x: 1, y: 2 } }],
};
const plot = (id: string, name: string): Plot => ({ id, name, source: "t", status: "ok", styleOverrides: {}, kind: "xy" });
const TEXT: Annotation = { id: "fa-t", kind: "text", label: "Note", x: 200, y: 40 };
const project = {
  schemaVersion: 5, tables: [table], plots: [plot("A", "Alpha"), plot("B", "Beta")], analyses: [],
  layouts: [{ id: "L", name: "Figure 1", panels: ["A", "B"], freeform: true, figureAnnotations: [TEXT] } as FigureLayout],
  log: [], workspace: { folders: [], loose: [] },
} as unknown as Project;

function page(opts: { slot: boolean; selectedPlot?: string }) {
  const slot = opts.slot ? document.body.appendChild(document.createElement("div")) : null;
  const onClearPanel = vi.fn();
  const editing = {
    selection: { kind: "plot" }, selectedPlot: opts.selectedPlot ?? null, onSelectPanel: vi.fn(), onClearPanel, onSelect: vi.fn(),
    onMoveAnnotation: vi.fn(), onMoveRefLineLabel: vi.fn(), onDeleteAnnotation: vi.fn(), onReorderAnnotation: vi.fn(), onDuplicateAnnotation: vi.fn(),
    onFigureResize: vi.fn(), onEditText: vi.fn(), onCreateTextBox: vi.fn(), onAxisResize: vi.fn(),
    onMoveTitle: vi.fn(), onMoveLegend: vi.fn(), onMoveColorbar: vi.fn(), onMoveAxisTitle: vi.fn(),
  };
  const { container } = render(
    <LayoutPane project={project} layoutId="L" onRemovePanel={() => {}} onOpenPlot={() => {}} onSetLayoutOptions={vi.fn()}
      onAddFigureAnnotation={vi.fn(() => ({ ...TEXT }))} onMoveFigureAnnotation={vi.fn()} onUpdateFigureAnnotation={vi.fn()} onRemoveFigureAnnotation={vi.fn()}
      editing={editing as never} inspectorSlot={slot} />,
  );
  const pickText = (): void => {
    openFigureMenus(container); // Text is inside the toolbar's Insert ▾
    fireEvent.click([...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Text")!);
  };
  const ribbonGroups = (): string[] => [...container.querySelectorAll(".laygroup-h")].map((h) => h.textContent?.trim() ?? "");
  return { container, slot, onClearPanel, pickText, ribbonGroups };
}

describe("a picked canvas object's settings", () => {
  it("are drawn in the Inspector's slot, and the toolbar grows no Object row", () => {
    const p = page({ slot: true });
    expect(p.ribbonGroups()).not.toContain("Object");
    p.pickText();
    expect(p.ribbonGroups(), "the toolbar grew a row when the object was picked").not.toContain("Object");
    expect(p.slot!.querySelector(".figsel-h")?.textContent).toBe("Text box");
    const labels = [...p.slot!.querySelectorAll("label")].map((l) => l.firstChild?.textContent?.trim());
    for (const want of ["Colour", "Background", "Border", "Align", "Wrap", "Pad", "Corner", "Size", "X", "Y"]) expect(labels, want).toContain(want);
    expect(p.container.querySelector(".layfields"), "X / Y also left behind in the toolbar").toBeNull();
  });

  it("stay in the toolbar when there is no Inspector to take them (it is collapsed) — never lost", () => {
    const p = page({ slot: false });
    p.pickText();
    expect(p.ribbonGroups()).toContain("Object");
    expect(p.container.querySelector(".layfields")).not.toBeNull();
  });

  it("picking an object deselects the panel — the Inspector shows one thing at a time", () => {
    const p = page({ slot: true, selectedPlot: "A" });
    p.pickText();
    expect(p.onClearPanel).toHaveBeenCalledTimes(1);
  });
});

describe("a single picked panel", () => {
  it("shows its name and X / Y / W / H in the Inspector's slot, not in the toolbar", () => {
    const p = page({ slot: true, selectedPlot: "B" });
    expect(p.slot!.querySelector(".figsel-h")?.textContent).toBe("Panel B — Beta");
    const labels = [...p.slot!.querySelectorAll("label")].map((l) => l.firstChild?.textContent?.trim());
    for (const want of ["X", "Y", "W", "H"]) expect(labels, want).toContain(want);
    expect(p.container.querySelector(".layfields")).toBeNull();
  });
});

describe("the figure's own settings", () => {
  const buttons = (root: ParentNode): string[] => [...root.querySelectorAll("button, label")].map((b) => (b.textContent ?? "").replace(/\s+/g, " ").trim());
  it("with nothing picked they are the Inspector's Figure view, and the toolbar keeps none of them", () => {
    const p = page({ slot: true });
    expect(p.slot!.querySelector(".figsel-h")?.textContent).toBe("Figure");
    const inSlot = buttons(p.slot!);
    for (const want of ["Lettering", "Font", "Size", "Bold", "Renumber", "Graph titles", "Card titles", "Keep proportions", "Shared axes", "One legend"]) {
      expect(inSlot.some((t) => t.startsWith(want)), want).toBe(true);
    }
    expect(p.ribbonGroups()).not.toContain("Labels");
    expect(p.ribbonGroups()).not.toContain("Panels");
    const toolbar = buttons(p.container.querySelector(".layribbon")!);
    for (const gone of ["Renumber", "Shared axes", "One legend"]) expect(toolbar, gone).not.toContain(gone);
  });

  it("are not shown while a panel is being edited (the Inspector is that graph's)", () => {
    const p = page({ slot: true, selectedPlot: "A" });
    expect(p.slot!.querySelector(".figsel-h")?.textContent).toBe("Panel A — Alpha");
    expect(buttons(p.slot!)).not.toContain("Renumber");
  });

  it("stay in the toolbar when there is no Inspector (collapsed)", () => {
    const p = page({ slot: false });
    expect(p.ribbonGroups()).toEqual(expect.arrayContaining(["Labels", "Panels"]));
    expect(buttons(p.container.querySelector(".layribbon")!)).toContain("Renumber");
  });

  it("a click on empty canvas stops editing the panel, so the Figure view is one click away", () => {
    const p = page({ slot: true, selectedPlot: "A" });
    const canvas = p.container.querySelector(".laycanvas")!;
    fireEvent.pointerDown(canvas, { button: 0, clientX: 5, clientY: 5 });
    fireEvent.pointerUp(window, { clientX: 5, clientY: 5 });
    expect(p.onClearPanel).toHaveBeenCalledTimes(1);
  });
});

describe("the toolbar's Insert ▾ and a one-line header", () => {
  const insertPage = () => {
    const { container } = render(
      // A spare graph (C) that is not on the figure, so Add graph has something to offer.
      <LayoutPane project={{ ...project, plots: [...project.plots, plot("C", "Gamma")] }} layoutId="L" onRemovePanel={() => {}} onOpenPlot={() => {}} onSetLayoutOptions={vi.fn()}
        onAddPanel={vi.fn()} onAddImagePanel={vi.fn()} onAddFigureAnnotation={vi.fn()} inspectorSlot={document.body.appendChild(document.createElement("div"))} />,
    );
    return container;
  };
  const texts = (root: ParentNode) => [...root.querySelectorAll("button, option")].map((b) => (b.textContent ?? "").trim());
  it("the header does not carry Choose graphs, Add graph or Add image; Insert ▾ holds them with the five objects", () => {
    const c = insertPage();
    for (const gone of ["← Choose graphs", "+ Add graph…", "Add image…"]) expect(texts(c.querySelector("h2")!.parentElement!), gone).not.toContain(gone);
    const insert = [...c.querySelectorAll<HTMLButtonElement>("button.laymenu-btn")].find((b) => /^Insert/.test(b.textContent ?? ""))!;
    expect(c.querySelector('.laymenu-panel[aria-label="Insert"]')).toBeNull();
    fireEvent.click(insert);
    const panel = c.querySelector('.laymenu-panel[aria-label="Insert"]')!;
    const inside = texts(panel);
    for (const want of ["+ Add graph…", "Add image…", "Text", "Arrow", "Line", "Box", "Ellipse"]) expect(inside, want).toContain(want);
  });
  it("Add image… does not close Insert ▾ (its file picker lives inside it)", () => {
    const c = insertPage();
    fireEvent.click([...c.querySelectorAll<HTMLButtonElement>("button.laymenu-btn")].find((b) => /^Insert/.test(b.textContent ?? ""))!);
    fireEvent.click([...c.querySelectorAll(".laymenu-panel button")].find((b) => b.textContent?.trim() === "Add image…")!);
    expect(c.querySelector('.laymenu-panel[aria-label="Insert"]'), "the menu closed and unmounted the file picker").not.toBeNull();
  });
});

describe("one zoom for the figure", () => {
  it("given the app's zoom, the toolbar slider shows it, and the slider and 100 % set it through the app", () => {
    const onViewZoom = vi.fn();
    const { container } = render(
      <LayoutPane project={project} layoutId="L" onRemovePanel={() => {}} onOpenPlot={() => {}} onSetLayoutOptions={vi.fn()}
        viewZoom={1.5} onViewZoom={onViewZoom} />,
    );
    const slider = container.querySelector('input[aria-label="Canvas zoom"]') as HTMLInputElement;
    expect(slider.value).toBe("1.5");
    expect(slider.max, "the slider cannot show what the status bar can set").toBe("4");
    expect(container.querySelector(".laychip-zoomval")?.textContent).toBe("150%");
    fireEvent.change(slider, { target: { value: "0.5" } });
    expect(onViewZoom).toHaveBeenLastCalledWith(0.5);
    fireEvent.click(container.querySelector(".laychip-zoomval")!);
    expect(onViewZoom).toHaveBeenLastCalledWith(1);
  });
});

describe("arriving at a figure's Arrange page opens the Inspector", () => {
  // The figure's settings live in the Inspector, as a graph's do — so arriving at Arrange
  // opens it, the same rule as arriving at a graph. The page reports the arrival; AppShell opens the dock.
  const builder = (over: Record<string, unknown> = {}) => {
    const onArrangeShown = vi.fn();
    const r = render(
      <PanelBuilderView project={project} layoutId="L" onAddPanel={() => {}} onRemovePanel={() => {}} onSetLayoutOptions={() => {}}
        onOpenPlot={() => {}} onClose={() => {}} onArrangeShown={onArrangeShown} {...over} />,
    );
    const tab = (name: string) => [...r.container.querySelectorAll(".layoutview-tab")].find((t) => t.textContent === name) as HTMLElement;
    return { ...r, onArrangeShown, tab };
  };
  it("Choose graphs does not; arriving at Arrange does, once; coming back to Arrange does again", () => {
    const b = builder();
    expect(b.onArrangeShown, "the Choose graphs tab has nothing for the Inspector").not.toHaveBeenCalled();
    fireEvent.click(b.tab("Arrange"));
    expect(b.onArrangeShown).toHaveBeenCalledTimes(1);
    fireEvent.click(b.container.querySelector(".laypanel")!);
    expect(b.onArrangeShown, "working on the page re-opened it — a collapse would not stick").toHaveBeenCalledTimes(1);
    fireEvent.click(b.tab("Choose graphs"));
    fireEvent.click(b.tab("Arrange"));
    expect(b.onArrangeShown).toHaveBeenCalledTimes(2);
  });
  it("a figure that opens straight on Arrange (just built) counts as arriving", () => {
    const b = builder({ startArranged: true });
    expect(b.onArrangeShown).toHaveBeenCalledTimes(1);
  });
});

describe("the Inspector while a figure is open", () => {
  const inspector = (figureSlot?: (el: HTMLDivElement | null) => void) =>
    render(
      <Inspector {...({} as ComponentProps<typeof Inspector>)} activeSection="graphs" selection={null} plot={undefined} table={undefined}
        userPresets={[]} profileDefault={null} onSelect={vi.fn()} {...(figureSlot ? { figureSlot } : {})} />,
    ).container;

  it("keeps a slot at the top for the figure's selection, and says what to click", () => {
    const got = vi.fn();
    const c = inspector(got);
    const slot = c.querySelector(".inspbody > .figinsp");
    expect(slot).not.toBeNull();
    expect(got).toHaveBeenCalledWith(slot);
    expect(c.textContent).toContain("Click a panel or an object on the figure to edit it.");
  });

  it("has no slot and the graph wording when no figure is open", () => {
    const c = inspector();
    expect(c.querySelector(".figinsp")).toBeNull();
    expect(c.textContent).toContain("Click an axis or a series on the graph to edit it.");
  });
});
