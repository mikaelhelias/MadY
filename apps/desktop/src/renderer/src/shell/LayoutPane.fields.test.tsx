// @vitest-environment jsdom
// Size & position fields: type X Y W H for
// the one selected panel or canvas object, in the ruler's unit. Dragging cannot make two panels
// exactly 85 mm wide; a number can.
//
// The fields commit through the same paths a gesture uses — the nudge for X/Y (which freezes a
// computed grid, moves group mates and refuses a lock) and the resize commit for W/H — so a typed
// number can never do something a drag could not. Every case here asserts the patch the pane
// hands the document, exactly as the drag tests in LayoutPane.test.tsx do.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { FigureLayout } from "@mady/core";
import { fmtFieldValue, LayoutPane, parseFieldValue, RULER_UNIT_KEY } from "./panes";
import { proj } from "./layoutPaneFixture";

afterEach(() => { cleanup(); localStorage.removeItem(RULER_UNIT_KEY); });

const ed = { selectedPlot: "A", selection: null, onSelectPanel: () => {}, onSelect: () => {} };
const mount = (over: Partial<FigureLayout> = {}, extra: Record<string, unknown> = {}) => {
  const onSet = vi.fn();
  const r = render(
    <LayoutPane
      project={proj({ panels: ["A", "B"], freeform: true, panelPositions: { A: { x: 100, y: 40 }, B: { x: 500, y: 40 } }, ...over })}
      layoutId="L" onRemovePanel={() => {}} onOpenPlot={() => {}} onSetLayoutOptions={onSet} editing={ed as never} {...extra}
    />,
  );
  return { ...r, onSet };
};
/** The field labelled X / Y / W / H (the label's own text starts with the letter). */
const field = (c: HTMLElement, name: string): HTMLInputElement | null => {
  const lab = [...c.querySelectorAll(".layfields label")].find((l) => (l.textContent ?? "").trim().startsWith(name));
  return lab?.querySelector("input") ?? null;
};
const type = (inp: HTMLInputElement, text: string): void => {
  fireEvent.change(inp, { target: { value: text } });
  fireEvent.blur(inp);
};
const lastPatch = (onSet: ReturnType<typeof vi.fn>): Partial<FigureLayout> => onSet.mock.calls.at(-1)![0] as Partial<FigureLayout>;

describe("the unit helpers", () => {
  it("format: px whole, inches and cm to two decimals", () => {
    expect(fmtFieldValue(96, "px")).toBe("96");
    expect(fmtFieldValue(96, "in")).toBe("1.00");
    expect(fmtFieldValue(96 / 2.54, "cm")).toBe("1.00");
  });
  it("parse: back to whole px, and a non-number is refused", () => {
    expect(parseFieldValue("2.54", "cm")).toBe(96);
    expect(parseFieldValue(" 1 ", "in")).toBe(96);
    expect(parseFieldValue("abc", "px")).toBeNull();
    expect(parseFieldValue("", "px")).toBeNull();
  });
});

describe("a selected panel", () => {
  it("shows its rendered position and size, and typing X moves it through the nudge path", () => {
    const { container, onSet } = mount();
    expect(field(container, "X")!.value).toBe("100");
    expect(field(container, "Y")!.value).toBe("40");
    type(field(container, "X")!, "130");
    expect(onSet).toHaveBeenCalledTimes(1);
    const pos = lastPatch(onSet).panelPositions!;
    expect(pos.A).toEqual({ x: 130, y: 40 });
    expect(pos.B).toEqual({ x: 500, y: 40 });
  });

  it("re-typing the same value writes nothing", () => {
    const { container, onSet } = mount();
    type(field(container, "X")!, "100");
    expect(onSet).not.toHaveBeenCalled();
  });

  it("a grouped mate follows", () => {
    const { container, onSet } = mount({ panelGroups: { A: "g1", B: "g1" } });
    type(field(container, "X")!, "130");
    const pos = lastPatch(onSet).panelPositions!;
    expect(pos.A).toEqual({ x: 130, y: 40 });
    expect(pos.B).toEqual({ x: 530, y: 40 });
  });

  it("a locked panel's fields are disabled and write nothing", () => {
    const { container, onSet } = mount({ panelLocked: { A: true } });
    expect(field(container, "X")!.disabled).toBe(true);
    expect(field(container, "W")!.disabled).toBe(true);
    type(field(container, "X")!, "130");
    expect(onSet).not.toHaveBeenCalled();
  });

  it("typing W from an aligned grid freezes the layout and pins the cards, like the resize handle", () => {
    const { container, onSet } = mount({ freeform: false, alignX: true, alignY: true, columns: 1 });
    type(field(container, "W")!, "500");
    const p = lastPatch(onSet);
    expect(p.freeform).toBe(true);
    expect(p.panelSizes!.A!.w).toBe(500);
    expect(p.panelPositions).toBeDefined();
    expect(p.cardSizes).toBeDefined();
  });

  it("typing W in free-drag writes the graph size alone — no hidden card pinning", () => {
    const { container, onSet } = mount();
    type(field(container, "W")!, "500");
    const p = lastPatch(onSet);
    expect(p.panelSizes!.A).toEqual({ w: 500, h: 260 });
    expect(p.cardSizes).toBeUndefined();
    expect(p.freeform).toBeUndefined();
  });

  it("with Lock aspect on, typing W scales H by the rendered ratio", () => {
    const { container, onSet } = mount();
    const lock = [...container.querySelectorAll(".layfields label")].find((l) => (l.textContent ?? "").includes("Lock aspect"))!.querySelector("input")!;
    fireEvent.click(lock);
    type(field(container, "W")!, "760");
    expect(lastPatch(onSet).panelSizes!.A).toEqual({ w: 760, h: 520 });
  });

  it("under Keep proportions the lock is forced on: W and H change together", () => {
    const { container, onSet } = mount({ panelFontScale: true });
    const lock = [...container.querySelectorAll(".layfields label")].find((l) => (l.textContent ?? "").includes("Lock aspect"))!.querySelector("input")!;
    expect(lock.checked).toBe(true);
    expect(lock.disabled).toBe(true);
    const w0 = Number(field(container, "W")!.value);
    const h0 = Number(field(container, "H")!.value);
    type(field(container, "W")!, "400");
    expect(lastPatch(onSet).panelSizes!.A).toEqual({ w: 400, h: Math.round((h0 * 400) / w0) });
  });

  it("shows inches when the ruler counts in inches, and still commits whole px", () => {
    localStorage.setItem(RULER_UNIT_KEY, "in");
    const { container, onSet } = mount();
    expect(field(container, "X")!.value).toBe("1.04"); // 100 px
    type(field(container, "X")!, "2");
    expect(lastPatch(onSet).panelPositions!.A).toEqual({ x: 192, y: 40 });
  });

  it("is hidden with two panels selected, and with none", () => {
    const { container } = mount();
    const panels = [...container.querySelectorAll(".laypanel")] as HTMLElement[];
    fireEvent.mouseDown(panels[0]!, { shiftKey: true });
    fireEvent.mouseDown(panels[1]!, { shiftKey: true });
    expect(container.querySelector(".layfields")).toBeNull();
  });
});

describe("a selected canvas object", () => {
  const withObject = (ann: Record<string, unknown>) => {
    const onUpdate = vi.fn();
    const r = mount({ figureAnnotations: [ann as never] }, { onUpdateFigureAnnotation: onUpdate, onAddFigureAnnotation: () => {}, onRemoveFigureAnnotation: () => {}, onMoveFigureAnnotation: () => {} });
    fireEvent.click(r.container.querySelector(`.layannot [data-ann-shape="${String(ann.id)}"], .layannot [data-ann-text="${String(ann.id)}"]`)!);
    return { ...r, onUpdate };
  };

  it("a box: X Y W H in canvas px; typing W writes it", () => {
    const { container, onUpdate } = withObject({ id: "o1", kind: "rect", x: 20, y: 30, w: 160, h: 100 });
    expect(field(container, "W")!.value).toBe("160");
    type(field(container, "W")!, "200");
    expect(onUpdate).toHaveBeenCalledWith("o1", { w: 200 });
  });

  it("an arrow: X Y only, and moving X carries both ends", () => {
    const { container, onUpdate } = withObject({ id: "o2", kind: "arrow", x: 20, y: 30, x2: 90, y2: 30 });
    expect(field(container, "W")).toBeNull();
    type(field(container, "X")!, "50");
    expect(onUpdate).toHaveBeenCalledWith("o2", { x: 50, y: 30, x2: 120, y2: 30 });
  });

  it("a locked object's fields are disabled", () => {
    const { container, onUpdate } = withObject({ id: "o3", kind: "rect", x: 20, y: 30, w: 160, h: 100, locked: true });
    expect(field(container, "X")!.disabled).toBe(true);
    type(field(container, "X")!, "50");
    expect(onUpdate).not.toHaveBeenCalled();
  });
});
