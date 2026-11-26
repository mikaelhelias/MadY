// @vitest-environment jsdom
/**
 * "Value position" is offered only where a bar carries the value label.
 *
 * Example: the Ranked dots card - a bar chart whose one series is drawn as points.
 * Value position ("Above the bar / Inside, at the top / Inside, at the foot") places a value label
 * against its bar (valueLabelPlace, which runs only for marks that still have one). With every series
 * drawn as points or a line there is no bar, so no label moves.
 *
 * Note: why this does not simply diff the whole drawing: on such a chart the setting still changes the
 * picture - "Above" keeps room free at the top for bar labels that do not exist, the inside settings
 * release it - so every dot shifts with the plot area. A whole-drawing diff reads that as "works" and
 * would demand a control that places nothing. So the census asks what the setting is for: did the
 * builder draw a bar for a label to sit against? And, on a card that has bars, that the setting really
 * moves a label relative to its bar.
 *
 * Measured, and deliberately not gated with it: the Show-values toggle and Value decimals do work on a
 * dot-drawn bar chart (the value rides each dot as its label, formatted by the decimals).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { Inspector } from "./Inspector";
import { galleryItems } from "./gallery";

afterEach(cleanup);
const SIZE = { width: 620, height: 420 };

const handlers = () => ({
  onSelect: vi.fn(),
  onSetAxis: vi.fn(), onSetAxisLength: vi.fn(), onSetAxisTitleFont: vi.fn(),
  onSetSeriesStyle: vi.fn(), onSetSeriesStyleAll: vi.fn(), onSetPointStyle: vi.fn(), onClearPointStyles: vi.fn(),
  onSetGrid: vi.fn(), onSetFrame: vi.fn(), onSetKind: vi.fn(), onSetBarLayout: vi.fn(), onSetBarShape: vi.fn(), onSetBoxWhisker: vi.fn(),
  onSetPlotOptions: vi.fn(), onSetGraphTitle: vi.fn(), onSetPlotFont: vi.fn(), onHomogenizeFont: vi.fn(),
  onSetLegend: vi.fn(), onSetSignificance: vi.fn(), onApplyPreset: vi.fn(),
  onApplyUserPreset: vi.fn(), onSaveUserPreset: vi.fn(), onDeleteUserPreset: vi.fn(), onSetProfileDefault: vi.fn(),
  annotationOps: { add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() },
});

/** The Inspector's control labels for this plot. */
function rows(plot: Plot, table: never): string[] {
  const { container } = render(
    <Inspector activeSection="graphs" selection={{ kind: "plot" }} plot={plot} table={table}
      userPresets={[]} profileDefault={null} {...handlers()} />,
  );
  const out = [...container.querySelectorAll("label.frow > span:first-child")].map((e) => (e.textContent ?? "").trim());
  cleanup();
  return out;
}

const items = (galleryItems() as unknown as { key: string; table: never; plot: Plot }[])
  .filter((i) => i.plot.kind === "bar" || i.plot.kind === "histogram");

describe("Value position is offered exactly where a bar carries the value label", () => {
  it("the census reaches both kinds of card (it cannot pass by measuring nothing)", () => {
    const withBars = items.filter((i) => buildPlotScene(i.table, { ...i.plot, showValues: true } as Plot, SIZE).series.some((s) => s.marks.some((m) => m.bar)));
    expect(withBars.length, "no card draws bars").toBeGreaterThan(3);
    expect(items.length - withBars.length, "no card without bars - Ranked dots should be one").toBeGreaterThan(0);
  });

  for (const item of items) {
    it(`${item.plot.kind} [${item.key}]`, () => {
      const on = { ...item.plot, showValues: true } as Plot;
      const scene = buildPlotScene(item.table, on, SIZE);
      const barMarks = scene.series.flatMap((s) => s.marks.filter((m) => m.bar));
      const offered = rows(on, item.table).includes("Value position");
      expect(
        offered,
        barMarks.length
          ? `${item.key}: bars carry value labels here and Value position is not offered`
          : `${item.key}: Value position is offered and no series draws a bar for it to place a label against`,
      ).toBe(barMarks.length > 0);
    });
  }

  it("where there are bars, the setting really places the label against its bar", () => {
    // Inside-at-the-foot puts the number near the axis end of the bar; above puts it past the far end.
    const bar = items.find((i) => i.key === "bar")!;
    const at = (placement: Plot["valuePlacement"]): number[] => {
      const s = buildPlotScene(bar.table, { ...bar.plot, showValues: true, valuePlacement: placement } as Plot, SIZE);
      return s.series.flatMap((se) => se.marks.filter((m) => m.bar)).map((m) => m.bar!.y);
    };
    expect(at("above").length).toBeGreaterThan(0);
    // Labels are placed by the renderer from scene.valueLabels.placement; the scene must carry the choice.
    expect(buildPlotScene(bar.table, { ...bar.plot, showValues: true, valuePlacement: "insideBase" } as Plot, SIZE).valueLabels?.placement).toBe("insideBase");
  });

  it("the Show-values toggle's neighbours that DO work on dot charts stay offered (the other direction)", () => {
    const dots = items.find((i) => i.key === "rankeddots")!;
    const r = rows({ ...dots.plot, showValues: true } as Plot, dots.table);
    expect(r, "Value decimals formats the dot labels - it must stay").toContain("Value decimals");
  });
});
