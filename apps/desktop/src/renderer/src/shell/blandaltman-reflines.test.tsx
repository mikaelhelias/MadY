// @vitest-environment jsdom
/**
 * Bland-Altman's reference lines — the caption moves, the line does not, and each line has
 * its own switch.
 *
 * Every element should be editable, and the text near a line and the lines themselves need
 * opposite answers:
 *  • the caption ("+1.96 SD") would otherwise sit welded to the right edge of the plot, on top
 *    of the data. It carries no claim about the numbers, so it drags freely.
 *  • the line sits at a computed statistic — bias = the mean difference, the limits = bias ±
 *    k·SD. Dragging it would draw a bias the data does not have, and deleting it cannot stick
 *    (it has no entry in `plot.annotations`; the builder recomputes it every rebuild, and
 *    `removeAnnotation` refuses it). So the correct form of "get rid of this line" is a
 *    per-line hide, which is what the Plot panel offers.
 *
 * Note: every case here checks the drawing, not just the patch: an Inspector that writes a
 * field nothing reads looks identical to one that works.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import { Inspector } from "./Inspector";
import type { GraphSelection } from "./AppShell";

afterEach(cleanup);
afterEach(() => globalThis.localStorage?.clear());

const table: DataTable = {
  id: "t", kind: "xy", name: "T",
  columns: [
    { id: "a", name: "Method A", role: "y" },
    { id: "b", name: "Method B", role: "y" },
  ],
  rows: [
    { id: "r1", cells: { a: 10, b: 11 } },
    { id: "r2", cells: { a: 20, b: 18 } },
    { id: "r3", cells: { a: 30, b: 33 } },
    { id: "r4", cells: { a: 40, b: 39 } },
    { id: "r5", cells: { a: 50, b: 54 } },
  ],
};
const base: Plot = { id: "p", name: "BA", source: "t", status: "ok", styleOverrides: {}, kind: "blandaltman" };
const build = (over: Partial<Plot> = {}) => buildPlotScene(table, { ...base, ...over }, { width: 520, height: 360 });
const lines = (s: ReturnType<typeof build>) => s.annotations.filter((a) => a.id.startsWith("ba-"));

describe("the fixture can exhibit the behaviour", () => {
  it("draws all three reference lines by default", () => {
    // If it drew fewer, "hiding one" below would prove nothing.
    expect(lines(build()).map((a) => a.id).sort()).toEqual(["ba-bias", "ba-loa-hi", "ba-loa-lo"]);
  });
});

describe("per-line hide", () => {
  it("hides ONE line and leaves the other two drawn", () => {
    const s = build({ refLineHidden: { "ba-loa-hi": true } });
    expect(lines(s).map((a) => a.id).sort()).toEqual(["ba-bias", "ba-loa-lo"]);
  });

  it("is separate from the all-lines switch", () => {
    expect(lines(build({ refLine: { show: false } }))).toHaveLength(0);
    // …and clearing the per-line flag brings that one back, so it is a hide and not a delete.
    expect(lines(build({ refLineHidden: {} }))).toHaveLength(3);
  });
});

describe("the caption's offset", () => {
  it("reaches the scene without moving the line", () => {
    const plain = build();
    const moved = build({ refLineLabelOffsets: { "ba-bias": { dx: -60, dy: -20 } } });
    const a0 = plain.annotations.find((a) => a.id === "ba-bias")!;
    const a1 = moved.annotations.find((a) => a.id === "ba-bias")!;
    expect(a1.labelOffset).toEqual({ dx: -60, dy: -20 });
    // The line's own geometry is byte-identical — this is the claim the whole design rests on.
    expect([a1.x1, a1.x2, a1.y1, a1.y2]).toEqual([a0.x1, a0.x2, a0.y1, a0.y2]);
    // …and the anchor is untouched too: the renderer translates, the builder does not bake in.
    expect([a1.labelX, a1.labelY]).toEqual([a0.labelX, a0.labelY]);
  });

  it("every reference line offers the affordance, and the line stays locked + undeletable", () => {
    for (const a of lines(build())) {
      expect(a.labelOffset).toBeDefined();
      expect(a.locked).toBe(true);
      expect(a.deletable).toBe(false);
    }
  });
});

describe("the renderer", () => {
  const dragLabel = (id: string) => {
    const onMoveRefLineLabel = vi.fn();
    const scene = build();
    const { container } = render(<PlotFigure scene={scene} onMoveRefLineLabel={onMoveRefLineLabel} onMoveAnnotation={vi.fn()} />);
    const text = container.querySelector(`[data-ann-text="${id}"]`);
    expect(text).not.toBeNull();
    // The draggable wrapper is the <g> the label sits in.
    const grp = text!.parentElement as unknown as SVGGElement;
    fireEvent.pointerDown(grp, { clientX: 200, clientY: 100 });
    fireEvent.pointerMove(grp, { clientX: 140, clientY: 82 });
    fireEvent.pointerUp(grp, { clientX: 140, clientY: 82 });
    return { onMoveRefLineLabel, container };
  };

  it("dragging the caption commits an offset", () => {
    const { onMoveRefLineLabel } = dragLabel("ba-bias");
    expect(onMoveRefLineLabel).toHaveBeenCalledTimes(1);
    const [id, dx, dy] = onMoveRefLineLabel.mock.calls[0]!;
    expect(id).toBe("ba-bias");
    // Dragged up and to the left, so both are negative. (jsdom reports a 0-width bounding
    // box, so the px→viewBox scale falls back to 1 and the numbers are the raw client delta.)
    expect(dx).toBeLessThan(0);
    expect(dy).toBeLessThan(0);
  });

  it("does NOT offer to move the line itself", () => {
    const scene = build();
    const onMoveAnnotation = vi.fn();
    const { container } = render(<PlotFigure scene={scene} onMoveAnnotation={onMoveAnnotation} onMoveRefLineLabel={vi.fn()} />);
    const line = container.querySelector('[data-ann="ba-bias"]');
    // Selecting nothing would make every assertion below vacuous — the exact way a guard
    // like this passes while measuring the empty set.
    expect(line).not.toBeNull();
    // No move cursor: a locked shape must not advertise a drag the document layer refuses.
    expect((line as unknown as SVGGElement).style.cursor).toBe("pointer");
    fireEvent.pointerDown(line!, { clientX: 200, clientY: 100 });
    fireEvent.pointerMove(line!, { clientX: 200, clientY: 160 });
    fireEvent.pointerUp(line!, { clientX: 200, clientY: 160 });
    expect(onMoveAnnotation).not.toHaveBeenCalled();
  });

  it("an UNLOCKED annotation still gets the move cursor — the check above measures locking, not the selector", () => {
    // The control case. Without it, "cursor is pointer" could be true of every annotation
    // for some unrelated reason and the locked-line guard would be measuring nothing.
    const scene = build({ annotations: [{ id: "free", kind: "text", x: 0.5, y: 0.5, label: "note" }] });
    const { container } = render(<PlotFigure scene={scene} onMoveAnnotation={vi.fn()} />);
    const free = container.querySelector('[data-ann="free"]');
    expect(free).not.toBeNull();
    expect((free as unknown as SVGGElement).style.cursor).toBe("move");
  });

  it("without the callback the caption still renders (nothing depends on the drag being wired)", () => {
    const { container } = render(<PlotFigure scene={build()} />);
    expect(container.querySelector('[data-ann-text="ba-bias"]')).not.toBeNull();
  });

  it("a committed offset is DRAWN in a read-only render — exports must not put the caption back", () => {
    // The offset must reach the drawing, not only the scene. Applied only inside the draggable
    // wrapper, it would be lost in every render with no callbacks — SVG/PNG export, interactive
    // HTML export, panel thumbnail, gallery card — silently discarding a move the user had made
    // and saved.
    const scene = build({ refLineLabelOffsets: { "ba-bias": { dx: -60, dy: -20 } } });
    const { container } = render(<PlotFigure scene={scene} />);
    const g = container.querySelector('[data-ann-text="ba-bias"]')!.parentElement!;
    expect(g.getAttribute("transform")).toBe("translate(-60 -20)");
    // …and an un-moved caption gains no wrapper at all, so nothing shifts by default.
    const plain = render(<PlotFigure scene={build()} />).container;
    expect(plain.querySelector('[data-ann-text="ba-bias"]')!.parentElement!.getAttribute("transform")).toBeNull();
  });
});

describe("the Plot panel's per-line switches", () => {
  const handlers = (onSetPlotOptions: (patch: Partial<Plot>) => void) => ({
    onSelect: vi.fn(),
    onSetAxis: vi.fn(), onSetAxisLength: vi.fn(), onSetAxisTitleFont: vi.fn(),
    onSetSeriesStyle: vi.fn(), onSetSeriesStyleAll: vi.fn(), onSetPointStyle: vi.fn(), onClearPointStyles: vi.fn(),
    onSetGrid: vi.fn(), onSetFrame: vi.fn(), onSetKind: vi.fn(), onSetBarLayout: vi.fn(), onSetBarShape: vi.fn(), onSetBoxWhisker: vi.fn(),
    onSetPlotOptions, onSetGraphTitle: vi.fn(), onSetPlotFont: vi.fn(), onHomogenizeFont: vi.fn(),
    onSetLegend: vi.fn(), onSetSignificance: vi.fn(), onApplyPreset: vi.fn(), 
    onApplyUserPreset: vi.fn(), onSaveUserPreset: vi.fn(), onDeleteUserPreset: vi.fn(), onSetProfileDefault: vi.fn(),
    annotationOps: { add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() },
  });

  const panel = (plot: Plot) => {
    const patches: Partial<Plot>[] = [];
    const sel: GraphSelection = { kind: "plot" };
    const { container } = render(
      <Inspector
        activeSection="graphs"
        selection={sel}
        plot={plot}
        table={table}
        userPresets={[]}
        profileDefault={null}
        {...handlers((p) => patches.push(p))}
      />,
    );
    return { container, patches };
  };

  /**
   * The per-line switch called `label`.
   *
   * Note: a locator only. These three rows are the generic reference-line list (each row's
   * name is the button that opens that line's style panel), so
   * the row carries no leading `<span>` to read. The `aria-label` is a tighter handle than row
   * text: it names the switch, not the row.
   */
  const control = (container: HTMLElement, label: string): HTMLInputElement | undefined =>
    container.querySelector<HTMLInputElement>(`input[aria-label="Show ${label}"]`) ?? undefined;

  for (const [label, id] of [["Bias line", "ba-bias"], ["Upper limit", "ba-loa-hi"], ["Lower limit", "ba-loa-lo"]] as const) {
    it(`"${label}" turns ${id} off, and the change reaches the drawing`, () => {
      const { container, patches } = panel(base);
      const box = control(container, label);
      expect(box).toBeDefined();
      expect(box!.checked).toBe(true); // shown by default
      fireEvent.click(box!);
      expect(patches).toHaveLength(1);
      // The second half, and the one that matters: apply what the panel wrote and rebuild.
      // A control that commits a field no builder reads looks exactly like one that works.
      const after = build(patches[0]!);
      expect(lines(after).map((a) => a.id)).not.toContain(id);
      expect(lines(after)).toHaveLength(2);
    });
  }

  it("the switches are absent on a kind with no reference lines", () => {
    const { container } = panel({ ...base, kind: "xy" });
    expect(control(container, "Bias line")).toBeUndefined();
  });
});
