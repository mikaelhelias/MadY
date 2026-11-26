// @vitest-environment jsdom
/**
 * "Points position" in a box / violin series' Data tab (`SeriesStyle.pointSide`): offered only while the series draws
 * its points; it shows the stored side and writes the chosen one, and choosing "Over" again stores nothing.
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

  const panel = (over: Partial<Plot>, own: SeriesStyle = {}) => {
    const plot = { ...card.plot, ...over, seriesStyles: { ...card.plot.seriesStyles, [id]: { ...(card.plot.seriesStyles?.[id] ?? {}), ...own } } } as Plot;
    const onSetSeriesStyle = vi.fn();
    const { container } = render(
      <Inspector {...({} as ComponentProps<typeof Inspector>)} activeSection="graphs" selection={{ kind: "series", columnId: id } as never}
        plot={plot} table={card.table} userPresets={[]} profileDefault={null} wholeGraph={false} onSetWholeGraph={() => {}} onSelect={vi.fn()}
        onSetSeriesStyle={onSetSeriesStyle} onSetSeriesStyleAll={vi.fn()} onSetPointStyle={vi.fn()} onSetPlotOptions={vi.fn()} />,
    );
    const select = container.querySelector(`select[aria-label="Points position"]`) as HTMLSelectElement | null;
    return { select, onSetSeriesStyle };
  };

  describe(`${kind}: Points position`, () => {
    it("not offered while the series draws no points", () => {
      expect(panel({ showBoxPoints: false }).select).toBeNull();
    });

    it("offered when the series draws points; Over by default; Left writes pointSide: left", () => {
      const { select, onSetSeriesStyle } = panel({ showBoxPoints: true });
      expect(select, "no Points position control while the series draws points").not.toBeNull();
      expect(select!.value).toBe("over");
      fireEvent.change(select!, { target: { value: "left" } });
      expect(onSetSeriesStyle).toHaveBeenLastCalledWith(id, { pointSide: "left" });
    });

    it("shows the stored side; choosing Over again stores nothing", () => {
      const { select, onSetSeriesStyle } = panel({}, { showPoints: true, pointSide: "right" });
      expect(select!.value).toBe("right");
      fireEvent.change(select!, { target: { value: "over" } });
      expect(onSetSeriesStyle).toHaveBeenLastCalledWith(id, { pointSide: undefined });
    });

    it("horizontal: the sides read Above and Below", () => {
      const { select } = panel({ showBoxPoints: true, barOrientation: "horizontal" });
      expect([...select!.options].map((o) => o.textContent)).toEqual([kind === "violin" ? "Over the violin" : "Over the box", "Above", "Below"]);
    });
  });
}
