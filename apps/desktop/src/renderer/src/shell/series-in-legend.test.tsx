// @vitest-environment jsdom
/**
 * "Show in legend" in a series' Data tab (`SeriesStyle.inLegend`). Offered only where the legend lists that series:
 * a kind whose legend names zones, slices or values has no row for the series, and the box would do nothing there.
 * Kept while the series is off, so it can be switched back on.
 */
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { Inspector } from "./Inspector";
import { galleryItems, galleryLookup } from "./gallery";

afterEach(cleanup);
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

const listed = (g: ReturnType<typeof galleryItems>[number]) =>
  buildPlotScene(g.table, { ...g.plot, legend: { ...g.plot.legend, show: true } }, { width: 400, height: 300, tables: galleryLookup(g) })
    .legend.filter((e) => e.select?.as === "series");
const xyCard = galleryItems().find((g) => g.plot.kind === "xy" && listed(g).length >= 2)!;
// A volcano's legend names its significance zones, not its series.
const zoneCard = galleryItems().find((g) => g.plot.kind === "volcano")!;
const zoneSeries = buildPlotScene(zoneCard.table, zoneCard.plot, { width: 400, height: 300, tables: galleryLookup(zoneCard) }).series[0]!.id;

const panel = (table: DataTable, plot: Plot, columnId: string) => {
  const onSetSeriesStyle = vi.fn();
  const { container } = render(
    <Inspector {...({} as ComponentProps<typeof Inspector>)} activeSection="graphs" selection={{ kind: "series", columnId } as never}
      plot={plot} table={table} userPresets={[]} profileDefault={null} wholeGraph={false} onSetWholeGraph={() => {}} onSelect={vi.fn()}
      onSetSeriesStyle={onSetSeriesStyle} onSetSeriesStyleAll={vi.fn()} onSetPointStyle={vi.fn()} />,
  );
  const row = [...container.querySelectorAll("label.frow")].find((r) => r.querySelector(":scope > span")?.textContent === "Show in legend");
  return { row, onSetSeriesStyle };
};

describe("Show in legend — the control", () => {
  it("the fixtures can show it: an XY card whose legend lists its series, and a volcano whose legend does not", () => {
    expect(xyCard, "no XY gallery card lists two series in its legend").toBeDefined();
    expect(listed(zoneCard), "the volcano's legend lists its series; pick another card").toEqual([]);
  });

  it("on a series the legend lists: present, ticked, and unticking writes inLegend: false", () => {
    const id = listed(xyCard)[0]!.select!.id;
    const { row, onSetSeriesStyle } = panel(xyCard.table, xyCard.plot, id);
    expect(row, "no Show in legend box in the series' panel").toBeDefined();
    const box = row!.querySelector("input") as HTMLInputElement;
    expect(box.checked).toBe(true);
    fireEvent.click(box);
    expect(onSetSeriesStyle).toHaveBeenLastCalledWith(id, expect.objectContaining({ inLegend: false }));
  });

  it("on a series already left out: present and unticked, so it can be put back", () => {
    const id = listed(xyCard)[0]!.select!.id;
    const plot = { ...xyCard.plot, seriesStyles: { ...xyCard.plot.seriesStyles, [id]: { ...(xyCard.plot.seriesStyles?.[id] ?? {}), inLegend: false } } } as Plot;
    const { row, onSetSeriesStyle } = panel(xyCard.table, plot, id);
    const box = row!.querySelector("input") as HTMLInputElement;
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    expect(onSetSeriesStyle).toHaveBeenLastCalledWith(id, expect.objectContaining({ inLegend: true }));
  });

  it("on a kind whose legend has no row for the series: not offered", () => {
    expect(panel(zoneCard.table, zoneCard.plot, zoneSeries).row).toBeUndefined();
  });
});
