// @vitest-environment jsdom
/**
 * The chart-wide tick font letters the drawing on kinds that have no Axis panel to reach it
 * from, so the Text tab offers it there.
 *
 * "Tick label font" lives in the Axis panel. Six kinds draw no cartesian axes, so
 * that tab is removed or greyed on them - and their drawing is still lettered with `fonts.tick`:
 * the chord's node names, the oncoprint's gene rows, the rose's compass and count rings, the
 * sunburst's segments, the ternary's axis numbers, the 3-D scatter's axis numbers. Without the
 * Text-tab control, the font moves every one of those drawings and no reachable control writes it.
 *
 * Two halves, because either alone is satisfiable by doing the wrong thing: the control must be
 * on screen in the Text tab, and the font must reach the drawing on that kind.
 */
import { describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { DataTable, Plot } from "@mady/core";
import { Inspector } from "./Inspector";
import { galleryItems, galleryLookup } from "./gallery";
import { inkDiffers } from "./inkOracle";

Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

const H = () => ({
  onSelect: vi.fn(), onSetAxis: vi.fn(), onSetAxisLength: vi.fn(), onSetAxisTitleFont: vi.fn(),
  onSetSeriesStyle: vi.fn(), onSetSeriesStyleAll: vi.fn(), onSetPointStyle: vi.fn(), onClearPointStyles: vi.fn(),
  onSetGrid: vi.fn(), onSetFrame: vi.fn(), onSetKind: vi.fn(), onSetBarLayout: vi.fn(), onSetBarShape: vi.fn(), onSetBoxWhisker: vi.fn(),
  onSetPlotOptions: vi.fn(), onSetGraphTitle: vi.fn(), onSetPlotFont: vi.fn(), onHomogenizeFont: vi.fn(),
  onSetLegend: vi.fn(), onSetSignificance: vi.fn(), onApplyPreset: vi.fn(),
  onApplyUserPreset: vi.fn(), onSaveUserPreset: vi.fn(), onDeleteUserPreset: vi.fn(), onSetProfileDefault: vi.fn(),
  annotationOps: { add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() },
});

/**
 * The kinds covered: what each letters with `fonts.tick`, and the block a user must see.
 *
 * The expected name is written out here rather than read from `TICK_FONT_LABEL`: an oracle that
 * shares its answer with the thing under test is not an oracle. Asking only for "some font block
 * that is not Title / Subtitle / Legend" would not be enough either, because the 3-D scatter
 * satisfies that with its **Axis title font** even when the Text-tab control is missing.
 */
const COVERED: [string, string, string][] = [
  ["chord", "the node names around the ring", "Node label font"],
  ["oncoprint", "the gene rows", "Gene & sample label font"],
  ["rose", "the compass points and count rings", "Compass & ring label font"],
  ["sunburst", "the segment labels", "Segment label font"],
  ["ternary", "the axis numbers", "Axis number font"],
  ["scatter3d", "the axis numbers", "Axis number font"],
];

/** Render the plot panel with the Text tab open, and list what a user can see and touch. */
function textTab(plot: Plot, table: DataTable) {
  const r = render(<Inspector activeSection="graphs" selection={{ kind: "plot" }} plot={plot} table={table} userPresets={[]} profileDefault={null} {...H()} />);
  const btn = [...r.container.querySelectorAll<HTMLButtonElement>("button.inspcat")].find((b) => (b.textContent ?? "").trim() === "Text");
  if (btn && !btn.classList.contains("disabled")) fireEvent.click(btn);
  return r.container;
}

const blocks = (c: HTMLElement): string[] =>
  [...c.querySelectorAll(".inspsub")].map((e) => (e.textContent ?? "").trim().replace(/^[^\p{L}]+/u, ""));

describe("the chart-wide tick font is reachable on kinds with no Axis panel", () => {
  for (const [kind, what, block] of COVERED) {
    it(`${kind}: the Text tab offers a font block for ${what}, and it reaches the drawing`, () => {
      const item = galleryItems().find((g) => (g.plot.kind ?? "xy") === kind)!;
      const t = item.table as DataTable, p = item.plot as Plot, lk = galleryLookup(item);

      // half 1 - the drawing responds at all. Without this the control would be decoration.
      const font = (size: number): Plot => ({ ...p, fonts: { ...(p.fonts ?? {}), tick: { size, color: size > 20 ? "#ff0000" : "#0000ff" } } }) as Plot;
      expect(inkDiffers(t, font(30), font(7), lk), `${kind}: fonts.tick does not letter this drawing - the premise is gone`).toBe(true);

      // half 2 - a control for it is on screen in the Text tab.
      const c = textTab(p, t);
      const named = blocks(c).filter((b) => /font$/i.test(b));
      expect(named, `${kind}: the Text tab offers only ${named.join(" / ")} — nothing letters ${what}`).toContain(block);
      cleanup();
    });
  }

  /**
   * The control case. These four already carry their own named block writing `fonts.tick` (radar
   * carries two), so a second control for the same text is the confusion this is meant to remove.
   * If one ever loses its own block this fails, and the registry is the place to fix it.
   */
  for (const kind of ["network", "heatmap", "corrmatrix", "radar"]) {
    it(`${kind}: keeps its own named font block, and gains no duplicate`, () => {
      const item = galleryItems().find((g) => (g.plot.kind ?? "xy") === kind)!;
      const c = textTab(item.plot as Plot, item.table as DataTable);
      const named = blocks(c).filter((b) => /font$/i.test(b) && !/^(Title|Subtitle|Legend) font$/.test(b));
      expect(named.length, `${kind}: expected exactly the kind's own block(s), got ${named.join(" / ") || "none"}`).toBeGreaterThan(0);
      expect(named, `${kind}: a generic tick-font block was added on top of its own`).not.toContain("Tick label font");
      cleanup();
    });
  }
});
