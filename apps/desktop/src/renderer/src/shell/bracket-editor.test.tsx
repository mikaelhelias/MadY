// @vitest-environment jsdom
/**
 * The clicked bracket's own panel:
 *  - the two endpoints can point at one bar inside a grouped category ("From bar" /
 *    "To bar" pickers), the within-group comparison;
 *  - the p-value is editable, so a typo is corrected in place rather than by deleting
 *    the bracket and starting over;
 *  - two tickboxes choose what the label shows: the significance signs and/or the
 *    p-value, independently.
 *
 * The pickers are withheld where the drawing has no sub-bar to point at (single series,
 * box/violin, stacked bars) — offering them would create endpoints the builder refuses.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { Annotation, DataTable, Plot } from "@mady/core";
import { BRACKET_KINDS, Inspector } from "./Inspector";
import { galleryItems } from "./gallery";

afterEach(cleanup);

const groupedT: DataTable = {
  id: "tg", kind: "grouped", name: "G",
  columns: [
    { id: "g", name: "Day", role: "x" },
    { id: "c", name: "Control", role: "y" },
    { id: "t", name: "Treated", role: "y" },
  ],
  rows: [
    { id: "r1", cells: { g: "Day 1", c: 20, t: 30 } },
    { id: "r2", cells: { g: "Day 2", c: 24, t: 41 } },
  ],
};

const bracket: Annotation = { id: "b1", kind: "bracket", from: 1, to: 1, toSeries: 2, bracketY: 45, p: 0.004, role: "significance" };

function show(plotPatch: Partial<Plot>, table: DataTable = groupedT, selection: { kind: "annotation"; id: string } | { kind: "plot" } = { kind: "annotation", id: "b1" }) {
  const ops = { add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() };
  const plot: Plot = { id: "p1", name: "p1", source: table.id, status: "ok", styleOverrides: {}, kind: "bar", annotations: [bracket], ...plotPatch };
  const r = render(
    <Inspector
      activeSection="graphs"
      selection={selection}
      plot={plot}
      table={table}
      userPresets={[]}
      profileDefault={null}
      onSelect={vi.fn()}
      onSetAxis={vi.fn()} onSetAxisLength={vi.fn()} onSetAxisTitleFont={vi.fn()}
      onSetSeriesStyle={vi.fn()} onSetSeriesStyleAll={vi.fn()} onSetPointStyle={vi.fn()} onClearPointStyles={vi.fn()}
      onSetGrid={vi.fn()} onSetFrame={vi.fn()} onSetKind={vi.fn()} onSetBarLayout={vi.fn()} onSetBarShape={vi.fn()} onSetBoxWhisker={vi.fn()}
      onSetPlotOptions={vi.fn()} onSetGraphTitle={vi.fn()} onSetPlotFont={vi.fn()} onHomogenizeFont={vi.fn()}
      onSetLegend={vi.fn()} onSetSignificance={vi.fn()} onApplyPreset={vi.fn()} 
      onApplyUserPreset={vi.fn()} onSaveUserPreset={vi.fn()} onDeleteUserPreset={vi.fn()} onSetProfileDefault={vi.fn()}
      annotationOps={ops}
    />,
  );
  return { ...r, ops };
}

/** The labelled row's input/select, by the row label text. */
function control(c: HTMLElement, label: string): HTMLInputElement | HTMLSelectElement | null {
  for (const lab of c.querySelectorAll("label")) {
    if ((lab.querySelector("span:first-child")?.textContent ?? "").trim() === label) {
      return lab.querySelector("input, select");
    }
  }
  return null;
}

describe("the clicked bracket's panel", () => {
  it("offers From bar / To bar pickers on a grouped two-series bar, naming the series", () => {
    const { container, ops } = show({});
    const from = control(container, "From bar") as HTMLSelectElement;
    const to = control(container, "To bar") as HTMLSelectElement;
    expect(from, "no From bar picker").toBeTruthy();
    expect(to, "no To bar picker").toBeTruthy();
    const names = [...from.options].map((o) => o.textContent);
    expect(names).toContain("Control");
    expect(names).toContain("Treated");
    fireEvent.change(from, { target: { value: "1" } });
    expect(ops.update).toHaveBeenCalledWith("b1", { fromSeries: 1 });
  });

  it("withholds the pickers where no sub-bar exists — stacked bars, one series, box", () => {
    expect(control(show({ barLayout: "stacked" }).container, "From bar"), "stacked bars share one slot").toBeNull();
    cleanup();
    const oneSeries: DataTable = { ...groupedT, columns: groupedT.columns.slice(0, 2) };
    expect(control(show({}, oneSeries).container, "From bar"), "one series has nothing to compare inside a group").toBeNull();
    cleanup();
    expect(control(show({ kind: "box" }).container, "From bar"), "box categories ARE the datasets").toBeNull();
  });

  it("the p-value is editable, and clearing it reverts to a free label", () => {
    const { container, ops } = show({});
    const p = control(container, "p-value") as HTMLInputElement;
    expect(p, "no p-value input — the p-value cannot be edited").toBeTruthy();
    fireEvent.change(p, { target: { value: "0.02" } });
    expect(ops.update).toHaveBeenCalledWith("b1", { p: 0.02 });
    fireEvent.change(p, { target: { value: "" } });
    expect(ops.update).toHaveBeenCalledWith("b1", { p: undefined });
  });

  /**
   * The section offers the action, not a description of it: text pointing at a control two
   * menus away reads as if there were no way to add a bracket, and a section about brackets
   * that cannot create one is a dead end in the place a user goes looking.
   */
  it("the Significance brackets section has a real Add button that creates a bracket", () => {
    const { container, ops } = show({}, groupedT, { kind: "plot" });
    const sec = [...container.querySelectorAll("details.inspsec")].find((d) =>
      /Significance brackets/.test(d.querySelector("summary")?.textContent ?? ""));
    expect(sec, "no Significance brackets section on a bar plot").toBeTruthy();
    const add = [...sec!.querySelectorAll("button")].find((b) => /Add a bracket/i.test(b.textContent ?? ""));
    expect(add, "the section describes adding but offers no button").toBeTruthy();
    fireEvent.click(add!);
    expect(ops.add).toHaveBeenCalledWith(expect.objectContaining({ kind: "bracket" }));
  });

  it("two tickboxes — signs and p-value — write both flags so the choice is explicit", () => {
    const { container, ops } = show({});
    const signs = control(container, "Significance signs") as HTMLInputElement;
    const pval = control(container, "Show p-value") as HTMLInputElement;
    expect(signs?.type).toBe("checkbox");
    expect(pval?.type).toBe("checkbox");
    // Default (plot display "stars"): signs on, p off.
    expect(signs.checked).toBe(true);
    expect(pval.checked).toBe(false);
    fireEvent.click(pval);
    expect(ops.update).toHaveBeenCalledWith("b1", { showSymbol: true, showP: true });
  });

  /**
   * Free position & size: auto placement is a starting point, not a
   * cage. The tickbox unlocks the bracket; unticking must clear the stored ends so the
   * bracket snaps back to its groups rather than remembering a stale freeform position.
   */
  it("the Free position & size tickbox unlocks the bracket, and unticking clears its ends", () => {
    const { container, ops } = show({});
    const box = control(container, "Free position & size") as HTMLInputElement;
    expect(box?.type, "no freeform tickbox on the bracket panel").toBe("checkbox");
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    expect(ops.update).toHaveBeenCalledWith("b1", { freeform: true });
    cleanup();
    const on = show({ annotations: [{ ...bracket, freeform: true, x: 0.1, x2: 0.9 }] });
    const box2 = control(on.container, "Free position & size") as HTMLInputElement;
    expect(box2.checked).toBe(true);
    fireEvent.click(box2);
    expect(on.ops.update).toHaveBeenCalledWith("b1", { freeform: undefined, x: undefined, x2: undefined });
  });
});

/**
 * The Annotate tab carries the bracket controls on every kind that can hold one — every
 * graph type that can carry a relevant statistical analysis.
 * Swept from `BRACKET_KINDS` itself, against the real gallery
 * fixtures, so the list and the panels cannot drift apart: each kind must offer both the
 * Significance section's "Add a bracket" button and the Annotations section's Bracket
 * adder. Kinds outside the list are guarded elsewhere (`bracket-headroom` NO_SECTION,
 * `annotations-drawn`) — nothing meaningful is being withheld there.
 */
describe("Annotate tab — add-bracket on every bracket-capable kind", () => {
  const items = galleryItems();
  for (const kind of [...BRACKET_KINDS].sort()) {
    it(`${kind}: offers Add a bracket + the Bracket adder`, () => {
      const item = items.find((i) => (i.plot.kind ?? "xy") === kind);
      expect(item, `no gallery card for "${kind}" — nothing to sweep`).toBeTruthy();
      const ops = { add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() };
      const { container } = render(
        <Inspector
          activeSection="graphs"
          selection={{ kind: "plot" }}
          plot={item!.plot as Plot}
          table={item!.table as DataTable}
          userPresets={[]}
          profileDefault={null}
          onSelect={vi.fn()}
          onSetAxis={vi.fn()} onSetAxisLength={vi.fn()} onSetAxisTitleFont={vi.fn()}
          onSetSeriesStyle={vi.fn()} onSetSeriesStyleAll={vi.fn()} onSetPointStyle={vi.fn()} onClearPointStyles={vi.fn()}
          onSetGrid={vi.fn()} onSetFrame={vi.fn()} onSetKind={vi.fn()} onSetBarLayout={vi.fn()} onSetBarShape={vi.fn()} onSetBoxWhisker={vi.fn()}
          onSetPlotOptions={vi.fn()} onSetGraphTitle={vi.fn()} onSetPlotFont={vi.fn()} onHomogenizeFont={vi.fn()}
          onSetLegend={vi.fn()} onSetSignificance={vi.fn()} onApplyPreset={vi.fn()} 
          onApplyUserPreset={vi.fn()} onSaveUserPreset={vi.fn()} onDeleteUserPreset={vi.fn()} onSetProfileDefault={vi.fn()}
          annotationOps={ops}
        />,
      );
      const sig = [...container.querySelectorAll("details.inspsec")].find((d) =>
        /Significance brackets/.test(d.querySelector("summary")?.textContent ?? ""));
      expect(sig, "no Significance brackets section").toBeTruthy();
      const add = [...sig!.querySelectorAll("button")].find((b) => /Add a bracket/i.test(b.textContent ?? ""));
      expect(add, "the section offers no Add a bracket button").toBeTruthy();
      fireEvent.click(add!);
      expect(ops.add).toHaveBeenCalledWith(expect.objectContaining({ kind: "bracket" }));
      const annSec = [...container.querySelectorAll("details.inspsec")].find((d) =>
        /^Annotations/.test(d.querySelector("summary")?.textContent ?? ""));
      expect(annSec, "no Annotations section").toBeTruthy();
      const bracketBtn = [...annSec!.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === "Bracket");
      expect(bracketBtn, "the Annotations section offers no Bracket adder").toBeTruthy();
      cleanup();
    });
  }
});

describe("Legs — on the clicked bracket, next to Shape; style applies to all brackets unless 'Only this bracket'", () => {
  const two: Annotation[] = [bracket, { id: "b2", kind: "bracket", from: 2, to: 2, toSeries: 2, bracketY: 55, p: 0.03, role: "significance", bracketLegs: "equal" }];
  it("default: Legs / Shape / Thickness write the graph setting and clear every bracket's own override", () => {
    const onSetSignificance = vi.fn();
    const ops = { add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() };
    const plot: Plot = { id: "p1", name: "p1", source: groupedT.id, status: "ok", styleOverrides: {}, kind: "bar", annotations: two };
    const { container } = render(
      <Inspector activeSection="graphs" selection={{ kind: "annotation", id: "b1" }} plot={plot} table={groupedT} userPresets={[]} profileDefault={null}
        onSelect={vi.fn()} onSetAxis={vi.fn()} onSetAxisLength={vi.fn()} onSetAxisTitleFont={vi.fn()} onSetSeriesStyle={vi.fn()} onSetSeriesStyleAll={vi.fn()} onSetPointStyle={vi.fn()} onClearPointStyles={vi.fn()}
        onSetGrid={vi.fn()} onSetFrame={vi.fn()} onSetKind={vi.fn()} onSetBarLayout={vi.fn()} onSetBarShape={vi.fn()} onSetBoxWhisker={vi.fn()} onSetPlotOptions={vi.fn()} onSetGraphTitle={vi.fn()} onSetPlotFont={vi.fn()} onHomogenizeFont={vi.fn()}
        onSetLegend={vi.fn()} onSetSignificance={onSetSignificance} onApplyPreset={vi.fn()} onApplyUserPreset={vi.fn()} onSaveUserPreset={vi.fn()} onDeleteUserPreset={vi.fn()} onSetProfileDefault={vi.fn()} annotationOps={ops} />,
    );
    const legs = container.querySelector<HTMLSelectElement>('select[aria-label="Bracket legs"]');
    expect(legs, "no Legs control on the clicked bracket").not.toBeNull();
    expect([...container.querySelectorAll(".frow > span")].map((x) => x.textContent)).toEqual(expect.arrayContaining(["Shape", "Legs", "Only this bracket"]));
    fireEvent.change(legs!, { target: { value: "reach" } });
    expect(onSetSignificance).toHaveBeenCalledWith({ legs: "reach" });
    // b2 carried its own override — cleared so it follows the graph; b1 had none.
    expect(ops.update).toHaveBeenCalledWith("b2", { bracketLegs: undefined });
    expect(ops.update).not.toHaveBeenCalledWith("b1", expect.objectContaining({ bracketLegs: "reach" }));
    fireEvent.change(container.querySelector('select[aria-label="Bracket shape"]')!, { target: { value: "rounded" } });
    expect(onSetSignificance).toHaveBeenCalledWith({ shape: "rounded" });
  });
  it("'Only this bracket' ticked: the same controls write this bracket alone", () => {
    const { container, ops } = show({});
    fireEvent.click(container.querySelector('input[aria-label="Only this bracket"]')!);
    fireEvent.change(container.querySelector('select[aria-label="Bracket legs"]')!, { target: { value: "reach" } });
    expect(ops.update).toHaveBeenCalledWith("b1", { bracketLegs: "reach" });
    fireEvent.change(container.querySelector('select[aria-label="Bracket legs"]')!, { target: { value: "" } });
    expect(ops.update).toHaveBeenCalledWith("b1", { bracketLegs: undefined });
  });
  it("a box plot's bracket panel does not offer Legs (the builder cannot reach the bars there)", () => {
    const { container } = show({ kind: "box" });
    expect(container.querySelector('select[aria-label="Bracket legs"]')).toBeNull();
  });
});
