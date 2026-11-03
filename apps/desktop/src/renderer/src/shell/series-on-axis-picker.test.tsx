// @vitest-environment jsdom
/**
 * The Axis tab's "Series on this axis" lists the series the graph plots. A bubble chart's size and colour columns and a
 * volcano's gene-name column are columns of the sheet but not series; ticking one moved nothing.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { DataTable, Plot } from "@mady/core";
import { Inspector } from "./Inspector";
import { galleryItems } from "./gallery";

afterEach(cleanup);
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

const handlers = () => ({
  onSelect: vi.fn(), wholeGraph: false, onSetWholeGraph: vi.fn(),
  onSetAxis: vi.fn(), onSetAxisLength: vi.fn(), onSetAxisTitleFont: vi.fn(),
  onSetSeriesStyle: vi.fn(), onSetSeriesStyleAll: vi.fn(), onSetPointStyle: vi.fn(), onClearPointStyles: vi.fn(),
  onSetGrid: vi.fn(), onSetFrame: vi.fn(), onSetKind: vi.fn(), onSetBarLayout: vi.fn(), onSetBarShape: vi.fn(), onSetBoxWhisker: vi.fn(),
  onSetPlotOptions: vi.fn(), onSetGraphTitle: vi.fn(), onSetPlotFont: vi.fn(), onHomogenizeFont: vi.fn(),
  onSetLegend: vi.fn(), onSetSignificance: vi.fn(), onApplyPreset: vi.fn(),
  onApplyUserPreset: vi.fn(), onSaveUserPreset: vi.fn(), onDeleteUserPreset: vi.fn(), onSetProfileDefault: vi.fn(),
  annotationOps: {} as never,
});
const picker = (title: string): string[] => {
  const item = (galleryItems() as unknown as { title: string; table: DataTable; plot: Plot }[]).find((i) => i.title === title)!;
  const u = render(
    <Inspector activeSection="graphs" selection={{ kind: "axis", axis: "y2" }} plot={item.plot} table={item.table} userPresets={[]} profileDefault={null} {...handlers()} />,
  );
  const group = [...u.container.querySelectorAll("details")].find((d) => d.querySelector("summary")?.textContent?.trim() === "Series on this axis");
  const names = group ? [...group.querySelectorAll("label")].map((l) => (l.textContent ?? "").trim()) : [];
  cleanup();
  return names;
};

describe("Series on this axis", () => {
  it("lists only the plotted series on a bubble chart and a volcano", () => {
    expect(picker("Bubble")).toEqual(["Life expectancy"]);
    expect(picker("Bubbles by category")).toEqual(["NES"]);
    expect(picker("Volcano")).toEqual(["-log10 p"]);
  });
  it("still lists every series of an XY graph", () => {
    expect(picker("XY (points + fitted curve)")).toEqual(["Compound A", "Compound B"]);
  });
});
