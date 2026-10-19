// @vitest-environment jsdom
/**
 * The PCA loading vectors — the arrow and its name are two things, and a vector is a line.
 *
 * PCA biplot: clicking a loading vector offers the same line edits as an axis (thickness,
 * dashes, arrowhead), and the arrow and its name can take different colours.
 *
 * Guards against the arrow and its label sharing one colour: if `pca-arrow-<i>` and
 * `pca-vlabel-<i>` both write the same `arrowColors` map, the two cannot differ, and the panel
 * can offer only "Vector colour" and "Auto colour".
 *
 * Length and direction are not style and never become settable here: an arrow's geometry is
 * the loading. That is the one thing about these that stays refused.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { Plot } from "@mady/core";
import { MadyDocument } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import { Inspector } from "./Inspector";
import { galleryItems } from "./gallery";
import type { GraphSelection } from "./AppShell";

afterEach(cleanup);
afterEach(() => globalThis.localStorage?.clear());

const SIZE = { width: 620, height: 420 };
const item = () => galleryItems().find((g) => (g.plot.kind ?? "xy") === "pcabiplot")!;
const build = (pcaStyle: Record<string, unknown> = {}) => {
  const g = item();
  return buildPlotScene(g.table, { ...g.plot, pcaStyle: { ...(g.plot.pcaStyle ?? {}), ...pcaStyle } } as Plot, SIZE);
};
const arrow = (s: ReturnType<typeof build>, i = 0) => s.annotations.find((a) => a.id === `pca-arrow-${i}`)!;
const vlabel = (s: ReturnType<typeof build>, i = 0) => s.annotations.find((a) => a.id === `pca-vlabel-${i}`)!;

describe("the fixture can exhibit the behaviour", () => {
  it("draws loading arrows and their variable labels", () => {
    const s = build();
    expect(arrow(s)).toBeDefined();
    expect(vlabel(s)).toBeDefined();
    expect(arrow(s).color).toBe(vlabel(s).color); // welded by default — the fallback
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. The arrow and its name can differ.
// ─────────────────────────────────────────────────────────────────────────────
describe("arrow colour vs label colour", () => {
  it("the label follows the arrow while it has no colour of its own", () => {
    const s = build({ arrowColors: { "0": "#ff0000" } });
    expect(arrow(s).color).toBe("#ff0000");
    expect(vlabel(s).color, "the label does not follow its arrow").toBe("#ff0000");
  });

  it("…and `varLabelColors` separates them — each keeps its own colour", () => {
    const s = build({ arrowColors: { "0": "#ff0000" }, varLabelColors: { "0": "#0000ff" } });
    expect(arrow(s).color).toBe("#ff0000");
    expect(vlabel(s).color).toBe("#0000ff");
  });

  it("one vector's label colour does not leak to another's", () => {
    const s = build({ varLabelColors: { "0": "#0000ff" } });
    expect(vlabel(s, 0).color).toBe("#0000ff");
    expect(vlabel(s, 1).color).not.toBe("#0000ff");
  });

  /**
   * The routing: each id must write its own map, not both `arrowColors`.
   * Driven through the real document so the id → map decision is exercised, not asserted.
   */
  it("recolouring via the label's id writes varLabelColors, not arrowColors", () => {
    const doc = new MadyDocument();
    const t = doc.addTable("T", "xy", ["x", "y"]);
    doc.addRow(t.id, [1, 2]);
    const p = doc.addPlot("P", t.id);
    doc.setPlotOptions(p.id, { kind: "pcabiplot", pca: item().plot.pca } as Partial<Plot>);
    doc.updateAnnotation(p.id, "pca-vlabel-0", { color: "#123456" });
    expect(p.pcaStyle?.varLabelColors).toEqual({ "0": "#123456" });
    expect(p.pcaStyle?.arrowColors, "the label's colour was written to the arrow map").toBeUndefined();
  });

  it("recolouring via the arrow's id still writes arrowColors", () => {
    const doc = new MadyDocument();
    const t = doc.addTable("T", "xy", ["x", "y"]);
    doc.addRow(t.id, [1, 2]);
    const p = doc.addPlot("P", t.id);
    doc.setPlotOptions(p.id, { kind: "pcabiplot", pca: item().plot.pca } as Partial<Plot>);
    doc.updateAnnotation(p.id, "pca-arrow-0", { color: "#abcdef" });
    expect(p.pcaStyle?.arrowColors).toEqual({ "0": "#abcdef" });
    expect(p.pcaStyle?.varLabelColors).toBeUndefined();
  });

  it("clearing a label's colour drops the entry — Reset really resets", () => {
    const doc = new MadyDocument();
    const t = doc.addTable("T", "xy", ["x", "y"]);
    doc.addRow(t.id, [1, 2]);
    const p = doc.addPlot("P", t.id);
    doc.setPlotOptions(p.id, { kind: "pcabiplot", pca: item().plot.pca } as Partial<Plot>);
    doc.updateAnnotation(p.id, "pca-vlabel-0", { color: "#123456" });
    doc.updateAnnotation(p.id, "pca-vlabel-0", { color: undefined });
    expect(p.pcaStyle?.varLabelColors).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. A vector is a line: thickness, dashes, head.
// ─────────────────────────────────────────────────────────────────────────────
describe("the vectors' line styling", () => {
  it("draws the default line when unset", () => {
    const a = arrow(build());
    expect(a.width).toBe(1.4);
    expect(a.dash).toBeNull();
    expect(a.arrowHead).toBe("end");
  });

  it("thickness + dash reach the drawing, and the dash scales with the width", () => {
    const a = arrow(build({ arrowWidth: 3, arrowDash: "dashed" }));
    expect(a.width).toBe(3);
    expect(a.dash).toBe("18.0,12.0"); // dashed × 3
  });

  it("the arrowhead can be turned off", () => {
    expect(arrow(build({ arrowHead: false })).arrowHead).toBe("none");
  });

  it("thickness is clamped", () => {
    expect(arrow(build({ arrowWidth: 99 })).width).toBe(8);
  });

  it("…and it is drawn — the head disappears from the figure, not just the scene", () => {
    const withHead = render(<PlotFigure scene={build()} zoom={1} onSelect={vi.fn()} />).container.querySelectorAll("polygon").length;
    cleanup();
    const without = render(<PlotFigure scene={build({ arrowHead: false })} zoom={1} onSelect={vi.fn()} />).container.querySelectorAll("polygon").length;
    expect(without, "turning the arrowheads off removed no polygons").toBeLessThan(withHead);
  });

  it("length and direction stay refused — an arrow's geometry is the loading", () => {
    // If this ever fails, someone has made the vectors draggable/resizable, and the chart can
    // then assert a loading the analysis did not produce.
    const a = arrow(build());
    expect(a.locked).toBe(true);
    expect(a.deletable).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. The panel says which of the two you clicked, and offers the line rows.
// ─────────────────────────────────────────────────────────────────────────────
const handlers = (annUpdate: (id: string, patch: unknown) => void, onSetPlotOptions = vi.fn()) => ({
  onSelect: vi.fn(),
  onSetAxis: vi.fn(), onSetAxisLength: vi.fn(), onSetAxisTitleFont: vi.fn(),
  onSetSeriesStyle: vi.fn(), onSetSeriesStyleAll: vi.fn(), onSetPointStyle: vi.fn(), onClearPointStyles: vi.fn(),
  onSetGrid: vi.fn(), onSetFrame: vi.fn(), onSetKind: vi.fn(), onSetBarLayout: vi.fn(), onSetBarShape: vi.fn(), onSetBoxWhisker: vi.fn(),
  onSetPlotOptions, onSetGraphTitle: vi.fn(), onSetPlotFont: vi.fn(), onHomogenizeFont: vi.fn(),
  onSetLegend: vi.fn(), onSetSignificance: vi.fn(), onApplyPreset: vi.fn(), 
  onApplyUserPreset: vi.fn(), onSaveUserPreset: vi.fn(), onDeleteUserPreset: vi.fn(), onSetProfileDefault: vi.fn(),
  annotationOps: { add: vi.fn(), update: vi.fn(annUpdate), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() },
});

function panel(id: string) {
  const g = item();
  const updates: { id: string; patch: unknown }[] = [];
  const opts: unknown[] = [];
  const { container } = render(
    <Inspector activeSection="graphs" selection={{ kind: "annotation", id }} plot={g.plot} table={g.table}
      userPresets={[]} profileDefault={null} {...handlers((i, p) => updates.push({ id: i, patch: p }), vi.fn((p: unknown) => opts.push(p)))} />,
  );
  return { container, updates, opts };
}

const rows = (c: HTMLElement): string[] =>
  [...c.querySelectorAll(".frow > span:first-child")].map((e) => (e.textContent ?? "").trim());

describe("the panel", () => {
  it("names the arrow as the vector, and offers thickness / dashes / head", () => {
    const { container } = panel("pca-arrow-0");
    expect(container.querySelector(".insphd")!.textContent).toMatch(/— vector$/);
    expect(rows(container)).toEqual(expect.arrayContaining(["Vector colour", "Thickness", "Dashes", "Arrowhead"]));
  });

  it("names the label as the label, and does not repeat the vectors' line rows there", () => {
    const { container } = panel("pca-vlabel-0");
    expect(container.querySelector(".insphd")!.textContent).toMatch(/— label$/);
    const r = rows(container);
    expect(r).toContain("Label colour");
    expect(r, "the label panel offers line controls it does not own").not.toContain("Thickness");
  });

  it("the colour row writes through the clicked id — which is what splits the two maps", () => {
    const { container, updates } = panel("pca-vlabel-0");
    fireEvent.change(container.querySelector<HTMLInputElement>('input[aria-label="Label colour"]')!, { target: { value: "#00ff00" } });
    expect(updates.at(-1)).toEqual({ id: "pca-vlabel-0", patch: { color: "#00ff00" } });
  });

  for (const [label, aria, value, key] of [
    ["Thickness", "Loading arrow thickness", "3", "arrowWidth"],
    ["Dashes", "Loading arrow dashes", "dotted", "arrowDash"],
  ] as const) {
    it(`${label} writes what the builder reads`, () => {
      const { container, opts } = panel("pca-arrow-0");
      const el = container.querySelector<HTMLInputElement>(`[aria-label="${aria}"]`)!;
      expect(el, `${label} is not on the panel`).toBeDefined();
      fireEvent.change(el, { target: { value } });
      const patch = (opts.at(-1) as { pcaStyle?: Record<string, unknown> }).pcaStyle!;
      expect(patch[key]).toBe(key === "arrowWidth" ? 3 : "dotted");
      // Apply it and rebuild: the drawing must show the change, not only the stored option.
      const a = arrow(build(patch));
      expect(key === "arrowWidth" ? a.width : a.dash).not.toBe(key === "arrowWidth" ? 1.4 : null);
    });
  }

  it("clicking the arrow in the figure opens this panel (the id the selection carries)", () => {
    const scene = build();
    const picks: GraphSelection[] = [];
    const { container } = render(<PlotFigure scene={scene} zoom={1} onSelect={(s) => picks.push(s)} />);
    fireEvent.click(container.querySelector('[data-ann-shape="pca-arrow-0"]')!);
    expect(picks[0]).toEqual({ kind: "annotation", id: "pca-arrow-0" });
  });
});
