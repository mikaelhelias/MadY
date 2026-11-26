// @vitest-environment jsdom
/**
 * Panel-assembly control + interaction matrix.
 *
 * Systematically exercises every control on the figure-assembler ribbon (chips, selects,
 * number inputs, the label-colour swatches/picker, and the Match buttons) plus the drag /
 * resize / bake interactions — asserting the exact onSetLayoutOptions / onMatchStyles patch
 * each emits. Complements LayoutPane.test.tsx (which covers the rendered geometry effects).
 * Runs in the default `npm test` (vitest) routine, so a control that stops emitting its patch fails CI.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render as rtlRender } from "@testing-library/react";
import { openFigureMenus } from "./figureToolbar.testutil";
import type { DataTable, FigureLayout, Plot, Project } from "@mady/core";
import { LayoutPane } from "./panes";
import { MATCH_KEYS } from "./templates";
/** The figure toolbar's Align ▾ / Line up ▾ / Insert ▾ / Style ▾ menus are opened right after rendering, as a user
 *  opens them to reach a control inside. Opening them only makes the controls findable; it does not affect what a test checks. */
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
const proj = (layout: Partial<FigureLayout> = {}): Project => ({
  schemaVersion: 5,
  tables: [table],
  plots: [plot("A", "Alpha"), plot("B", "Beta"), plot("C", "Gamma")],
  analyses: [],
  layouts: [{ id: "L", name: "Figure 1", panels: ["A", "B"], ...layout }],
  log: [],
  workspace: { folders: [], loose: [] },
});

const arrange = (over: Partial<FigureLayout> = {}, onSet = vi.fn(), onMatch?: (plotIds: string[], style: Partial<Plot>, keys: (keyof Plot)[]) => void) =>
  render(
    <LayoutPane
      project={proj(over)} layoutId="L"
      onRemovePanel={() => {}} onOpenPlot={() => {}}
      onSetLayoutOptions={onSet}
      {...(onMatch ? { onMatchStyles: onMatch } : {})}
    />,
  );

const norm = (s: string | null): string => (s ?? "").replace(/\s+/g, " ").trim();
const byLabel = (c: HTMLElement, re: RegExp): HTMLLabelElement =>
  [...c.querySelectorAll("label")].find((l) => re.test(norm(l.textContent))) as HTMLLabelElement;
const setValue = (el: HTMLInputElement | HTMLSelectElement, value: string): void => {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  if (!(el instanceof HTMLSelectElement)) el.dispatchEvent(new Event("change", { bubbles: true }));
};

// ===========================================================================
describe("panel-assembly ribbon — every toggle chip emits the right patch", () => {
  // over sets the starting state so the click direction is deterministic; patch = the emitted keys.
  const CHIPS: { name: string; re: RegExp; patch: Partial<FigureLayout> }[] = [
    { name: "Align X", re: /Align X\b/, patch: { alignX: true, freeform: false } },
    { name: "Align Y", re: /Align Y\b/, patch: { alignY: true, freeform: false } },
    { name: "Stretch last", re: /Stretch last/, patch: { stretchLastPanel: true } },
    { name: "Centre no-axis", re: /Centre no-axis/, patch: { centreNoAxisPanels: true } },
    { name: "Equal rows", re: /Equal rows/, patch: { uniformRowHeight: true, freeform: false } },
    { name: "Equal cols", re: /Equal cols/, patch: { uniformColumnWidth: true, freeform: false } },
    { name: "Align ↕ (labels)", re: /Align ↕/, patch: { labelAlignY: true } },
    { name: "Align ↔ (labels)", re: /Align ↔/, patch: { labelAlignX: true } },
    { name: "Graph titles", re: /Graph titles/, patch: { showPanelTitles: true } },
    { name: "Card titles", re: /Card titles/, patch: { showPanelNames: true } },
    { name: "Keep proportions", re: /Keep proportions/, patch: { panelFontScale: true } },
    { name: "Grid (default on → off)", re: /Grid\b/, patch: { showGrid: false } },
    { name: "Ruler (default on → off)", re: /Ruler/, patch: { showRuler: false } },
    { name: "Free drag (default on → off)", re: /Free drag/, patch: { freeform: false } },
    { name: "Bold (default on → off)", re: /Bold/, patch: { letterBold: false } },
  ];
  for (const c of CHIPS) {
    it(`${c.name}`, () => {
      const onSet = vi.fn();
      const { container } = arrange({}, onSet);
      const input = byLabel(container, c.re).querySelector("input") as HTMLInputElement;
      fireEvent.click(input);
      expect(onSet).toHaveBeenCalledWith(expect.objectContaining(c.patch));
    });
  }

  it("Align all button engages X+Y+↕+↔, drops free-drag, and re-seeds a dense grid", () => {
    const onSet = vi.fn();
    const { container } = arrange({}, onSet);
    fireEvent.click(container.querySelector("button.laychip-go") as HTMLButtonElement);
    expect(onSet).toHaveBeenCalledWith(
      expect.objectContaining({ alignX: true, alignY: true, labelAlignX: true, labelAlignY: true, freeform: false }),
    );
    // and the position reset that guarantees a dense figure from any arrangement
    // (clustering the existing scattered positions would leave the cards spread out)
    const patch = onSet.mock.calls[0]![0] as Partial<FigureLayout>;
    expect(patch.panelPositions).toBeTruthy();
  });
});

describe("panel-assembly ribbon — selects & number inputs emit the right patch", () => {
  it("Columns → fixed count, and back to Auto (undefined)", () => {
    const onSet = vi.fn();
    const { container } = arrange({}, onSet);
    const sel = byLabel(container, /Columns/).querySelector("select") as HTMLSelectElement;
    setValue(sel, "3");
    expect(onSet).toHaveBeenCalledWith({ columns: 3 });
    setValue(sel, "auto");
    expect(onSet).toHaveBeenCalledWith({ columns: undefined });
  });

  it("Gutter → px value", () => {
    const onSet = vi.fn();
    const { container } = arrange({}, onSet);
    setValue(byLabel(container, /Gutter/).querySelector("input") as HTMLInputElement, "12");
    expect(onSet).toHaveBeenCalledWith({ gutter: 12 });
  });

  it("Lettering → each scheme", () => {
    const onSet = vi.fn();
    const { container } = arrange({}, onSet);
    const sel = byLabel(container, /Lettering/).querySelector("select") as HTMLSelectElement;
    for (const v of ["lower", "numeric", "none"] as const) {
      setValue(sel, v);
      expect(onSet).toHaveBeenCalledWith({ lettering: v });
    }
  });

  it("Label font → sets letterFont", () => {
    const onSet = vi.fn();
    const { container } = arrange({}, onSet);
    const sel = byLabel(container, /^Font/).querySelector("select") as HTMLSelectElement;
    const opt = [...sel.options].find((o) => o.value)!; // first non-empty font stack
    setValue(sel, opt.value);
    expect(onSet).toHaveBeenCalledWith({ letterFont: opt.value });
  });

  it("Label size → sets letterSize", () => {
    const onSet = vi.fn();
    const { container } = arrange({}, onSet); // default shows 22
    setValue(byLabel(container, /^Size/).querySelector("input") as HTMLInputElement, "28");
    expect(onSet).toHaveBeenCalledWith({ letterSize: 28 });
  });

  it("Label size → resetting to the 22 default clears the override", () => {
    const onSet = vi.fn();
    const { container } = arrange({ letterSize: 28 }, onSet); // starts at 28 so a change to 22 registers
    setValue(byLabel(container, /^Size/).querySelector("input") as HTMLInputElement, "22");
    expect(onSet).toHaveBeenCalledWith({ letterSize: undefined });
  });
});

describe("panel-assembly ribbon — label colour (swatches + custom picker)", () => {
  it("a preset swatch sets letterColor; the default swatch clears it", () => {
    const onSet = vi.fn();
    const { container } = arrange({}, onSet);
    const swatches = [...container.querySelectorAll("button.layswatch")] as HTMLButtonElement[];
    expect(swatches.length).toBeGreaterThan(2);
    const black = swatches.find((b) => b.title.toLowerCase() === "#000000")!;
    fireEvent.click(black);
    expect(onSet).toHaveBeenCalledWith({ letterColor: "#000000" });
    // the default (#1a1a1a) swatch clears the override
    const dflt = swatches.find((b) => b.title.toLowerCase() === "#1a1a1a")!;
    fireEvent.click(dflt);
    expect(onSet).toHaveBeenCalledWith({ letterColor: undefined });
  });

  it("the custom colour picker sets letterColor", () => {
    const onSet = vi.fn();
    const { container } = arrange({}, onSet);
    const picker = container.querySelector('input[type="color"]') as HTMLInputElement;
    setValue(picker, "#123456");
    expect(onSet).toHaveBeenCalledWith({ letterColor: "#123456" });
  });
});

describe("panel-assembly — the Match buttons copy the right key set to the other panels", () => {
  const ASPECTS: { label: RegExp; aspect: keyof typeof MATCH_KEYS }[] = [
    { label: /Everything/, aspect: "all" },
    { label: /Size/, aspect: "size" },
    { label: /Fonts/, aspect: "fonts" },
    { label: /Axes/, aspect: "axes" },
    { label: /Colours/, aspect: "colours" },
  ];
  for (const a of ASPECTS) {
    it(`Match → ${a.aspect} uses MATCH_KEYS.${a.aspect} on the non-reference panels`, () => {
      const onMatch = vi.fn();
      const { container } = arrange({}, vi.fn(), onMatch);
      const btn = [...container.querySelectorAll("button.layseg-btn")].find((b) => a.label.test(b.textContent ?? "")) as HTMLButtonElement;
      fireEvent.click(btn);
      expect(onMatch).toHaveBeenCalledTimes(1);
      const [ids, , keys] = onMatch.mock.calls[0]!;
      expect(ids).toEqual(["B"]); // ref defaults to A → the others (B) get matched
      expect(keys).toEqual(MATCH_KEYS[a.aspect]);
    });
  }

  it("choosing a different reference flips which panels are matched", () => {
    const onMatch = vi.fn();
    const { container } = arrange({}, vi.fn(), onMatch);
    const refSel = [...container.querySelectorAll("select.selin")].find((s) => [...(s as HTMLSelectElement).options].some((o) => o.value === "B")) as HTMLSelectElement;
    setValue(refSel, "B");
    fireEvent.click([...container.querySelectorAll("button.layseg-btn")].find((b) => /Fonts/.test(b.textContent ?? "")) as HTMLButtonElement);
    expect(onMatch.mock.calls[0]![0]).toEqual(["A"]); // now A is matched to B
  });
});

describe("panel-assembly — drag / resize / bake interactions commit the right layout", () => {
  it("free-drag: press-drag on the graph body commits panelPositions", () => {
    const onSet = vi.fn();
    const { container } = arrange({ freeform: true, panelPositions: { A: { x: 100, y: 40 }, B: { x: 500, y: 40 } } }, onSet);
    const svg = container.querySelector(".laypanel svg.gfx-figure") as Element;
    fireEvent.pointerDown(svg, { clientX: 150, clientY: 150, button: 0, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 220, clientY: 200, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 220, clientY: 200, pointerId: 1 });
    expect(onSet).toHaveBeenCalledTimes(1);
    expect((onSet.mock.calls[0]![0] as Partial<FigureLayout>).panelPositions!.A).toBeTruthy();
  });

  it("resize handle commits a panelSizes entry", () => {
    const onSet = vi.fn();
    const { container } = arrange({}, onSet);
    const handle = container.querySelector(".laypanel-resize") as HTMLElement;
    fireEvent.pointerDown(handle, { clientX: 400, clientY: 300, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 470, clientY: 360, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 470, clientY: 360, pointerId: 1 });
    expect((onSet.mock.calls[0]![0] as Partial<FigureLayout>).panelSizes!.A).toBeTruthy();
  });

  it("nudging a panel while aligned bakes the figure to free-drag (freeform + full maps, one patch)", () => {
    const onSet = vi.fn();
    const { container } = arrange({ alignX: true, columns: 1, freeform: false }, onSet);
    const svg = container.querySelector(".laypanel svg.gfx-figure") as Element;
    fireEvent.pointerDown(svg, { clientX: 150, clientY: 150, button: 0, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 220, clientY: 205, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 220, clientY: 205, pointerId: 1 });
    expect(onSet).toHaveBeenCalledTimes(1);
    const patch = onSet.mock.calls[0]![0] as Partial<FigureLayout>;
    expect(patch.freeform).toBe(true);
    expect(patch.alignX).toBeUndefined();
    expect(Object.keys(patch.panelPositions!).sort()).toEqual(["A", "B"]);
    expect(Object.keys(patch.panelSizes!).sort()).toEqual(["A", "B"]);
  });

  it("dragging an A/B/C label commits a labelPos entry", () => {
    const onSet = vi.fn();
    const { container } = arrange({}, onSet);
    const lbl = container.querySelector(".laypanel-letter-float") as HTMLElement;
    fireEvent.pointerDown(lbl, { clientX: 20, clientY: 20, pointerId: 1 });
    fireEvent.pointerMove(lbl, { clientX: 60, clientY: 50, pointerId: 1 });
    fireEvent.pointerUp(lbl, { clientX: 60, clientY: 50, pointerId: 1 });
    expect((onSet.mock.calls[0]![0] as Partial<FigureLayout>).labelPos!.A).toBeTruthy();
  });
});

describe("panel-assembly — width / length geometry effects actually apply", () => {
  const widthsFor = (over: Partial<FigureLayout>): number[] => {
    const { container } = arrange({ freeform: false, columns: 1, panelSizes: { A: { w: 300, h: 200 }, B: { w: 520, h: 200 } }, ...over });
    const ws = [...container.querySelectorAll<HTMLElement>(".laypanel")].map((el) => parseFloat(el.style.width));
    cleanup();
    return ws;
  };
  it("Uniform column width equalises the stacked cards to the widest", () => {
    const plain = widthsFor({});
    expect(Math.abs(plain[0]! - plain[1]!)).toBeGreaterThan(100); // 316 vs 536
    const uniform = widthsFor({ uniformColumnWidth: true });
    expect(Math.abs(uniform[0]! - uniform[1]!)).toBeLessThan(1); // both at the widest
  });
});
