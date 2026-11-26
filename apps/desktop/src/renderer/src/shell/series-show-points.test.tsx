// @vitest-environment jsdom
/**
 * "Show points" in a box / violin series' Data tab (`SeriesStyle.showPoints`). It reads the series' own value, else
 * the graph's "Show all points"; a click that matches the graph again stores nothing, so the series follows the graph
 * from then on. Point spread is offered whenever this series draws its points, including when only it does.
 */
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { Plot, SeriesStyle } from "@mady/core";
import { Inspector } from "./Inspector";
import { galleryItems } from "./gallery";

afterEach(cleanup);
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

for (const kind of ["box", "violin"] as const) {
  const card = galleryItems().find((g) => g.plot.kind === kind)!;
  const id = card.table.columns.find((c) => c.role === "y" || c.role === undefined)!.id;

  const panel = (showBoxPoints: boolean | undefined, own: SeriesStyle = {}) => {
    const plot = { ...card.plot, showBoxPoints, seriesStyles: { ...card.plot.seriesStyles, [id]: { ...(card.plot.seriesStyles?.[id] ?? {}), ...own } } } as Plot;
    const onSetSeriesStyle = vi.fn();
    const { container } = render(
      <Inspector {...({} as ComponentProps<typeof Inspector>)} activeSection="graphs" selection={{ kind: "series", columnId: id } as never}
        plot={plot} table={card.table} userPresets={[]} profileDefault={null} wholeGraph={false} onSetWholeGraph={() => {}} onSelect={vi.fn()}
        onSetSeriesStyle={onSetSeriesStyle} onSetSeriesStyleAll={vi.fn()} onSetPointStyle={vi.fn()} onSetPlotOptions={vi.fn()} />,
    );
    const box = container.querySelector(`input[aria-label="Show this group's points"]`) as HTMLInputElement | null;
    const spread = [...container.querySelectorAll(".inspsub")].some((e) => e.textContent === "Point spread");
    return { box, spread, onSetSeriesStyle };
  };

  describe(`${kind}: Show points, per series`, () => {
    it("graph off, series unset: offered, unticked, no Point spread; ticking writes showPoints: true", () => {
      const { box, spread, onSetSeriesStyle } = panel(undefined);
      expect(box, "no Show points box in the series' panel").not.toBeNull();
      expect(box!.checked).toBe(false);
      expect(spread).toBe(false);
      fireEvent.click(box!);
      expect(onSetSeriesStyle).toHaveBeenLastCalledWith(id, { showPoints: true });
    });

    it("graph on, series unset: ticked; unticking writes showPoints: false", () => {
      const { box, onSetSeriesStyle } = panel(true);
      expect(box!.checked).toBe(true);
      fireEvent.click(box!);
      expect(onSetSeriesStyle).toHaveBeenLastCalledWith(id, { showPoints: false });
    });

    it("graph on, series off: unticked; ticking matches the graph, so it stores nothing", () => {
      const { box, onSetSeriesStyle } = panel(true, { showPoints: false });
      expect(box!.checked).toBe(false);
      fireEvent.click(box!);
      expect(onSetSeriesStyle).toHaveBeenLastCalledWith(id, { showPoints: undefined });
    });

    it("graph off, series on: ticked, and Point spread is offered for its points", () => {
      const { box, spread } = panel(undefined, { showPoints: true });
      expect(box!.checked).toBe(true);
      expect(spread, "the series draws points but Point spread is not offered").toBe(true);
    });
  });
}
