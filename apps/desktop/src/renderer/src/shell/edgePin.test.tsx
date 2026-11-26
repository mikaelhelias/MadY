// @vitest-environment jsdom
/**
 * "Custom edge colour" is offered exactly where it reaches the drawing — both directions, over every gallery graph and
 * every series id a panel can carry — and the Inspector shows the row by that rule.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { tableDatasets } from "@mady/core";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import { Inspector } from "./Inspector";
import { galleryItems } from "./gallery";
import { edgePinReachesDrawing, probeRows } from "./edgePin";

afterEach(cleanup);
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

const SIZE = { width: 620, height: 420 };
const items = galleryItems() as unknown as { title: string; table: DataTable; plot: Plot }[];
const drawing = (t: DataTable, p: Plot): string => renderToStaticMarkup(<PlotFigure scene={buildPlotScene(t, p, SIZE)} selected={null} />);
const handlers = () => ({
  onSelect: vi.fn(), wholeGraph: false, onSetWholeGraph: vi.fn(),
  onSetAxis: vi.fn(), onSetAxisLength: vi.fn(), onSetAxisTitleFont: vi.fn(),
  onSetSeriesStyle: vi.fn(), onSetSeriesStyleAll: vi.fn(), onSetPointStyle: vi.fn(), onClearPointStyles: vi.fn(),
  onSetGrid: vi.fn(), onSetFrame: vi.fn(), onSetKind: vi.fn(), onSetBarLayout: vi.fn(), onSetBarShape: vi.fn(), onSetBoxWhisker: vi.fn(),
  onSetPlotOptions: vi.fn(), onSetGraphTitle: vi.fn(), onSetPlotFont: vi.fn(), onHomogenizeFont: vi.fn(),
  onSetLegend: vi.fn(), onSetSignificance: vi.fn(), onApplyPreset: vi.fn(),
  onApplyUserPreset: vi.fn(), onSaveUserPreset: vi.fn(), onDeleteUserPreset: vi.fn(), onSetProfileDefault: vi.fn(),
  annotationOps: { add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() },
});
const pinned = (p: Plot, id: string): Plot => ({ ...p, seriesStyles: { ...(p.seriesStyles ?? {}), [id]: { ...(p.seriesStyles?.[id] ?? {}), twoToneEdge: "#ff00aa" } } });

describe("Custom edge colour is offered where it draws", () => {
  it("offered ⇔ the drawing changes, on every gallery graph and series", () => {
    const wrong: string[] = [];
    let offered = 0;
    for (const it of items) {
      const ids = new Set([...buildPlotScene(it.table, it.plot, SIZE).series.map((s) => s.id), ...tableDatasets(it.table).map((d) => d.id)]);
      const base = drawing(it.table, it.plot);
      for (const id of ids) {
        const reaches = edgePinReachesDrawing(it.table, it.plot, id);
        const draws = drawing(it.table, pinned(it.plot, id)) !== base;
        if (reaches) offered++;
        if (reaches !== draws) wrong.push(`${it.title} · ${id}: offered ${reaches}, draws ${draws}`);
      }
    }
    expect(wrong).toEqual([]);
    // …and it is offered somewhere, so a green run is not an empty one.
    expect(offered).toBeGreaterThan(10);
  });

  it("probeRows keeps a short sheet whole, cuts a long one, and keeps the asked row", () => {
    const xy = items.find((i) => i.plot.kind === "xy")!;
    expect(probeRows(xy.table)).toBe(xy.table);
    const big = { ...xy.table, rows: Array.from({ length: 500 }, (_, i) => ({ ...xy.table.rows[i % xy.table.rows.length]!, id: `r${i}` })) } as DataTable;
    expect(probeRows(big).rows.length).toBe(40);
    expect(probeRows(big, "r321").rows.map((r) => r.id)).toContain("r321");
    // The answer does not depend on the cut: the same on the long sheet as on its first rows.
    const id = buildPlotScene(xy.table, xy.plot, SIZE).series[0]!.id;
    const full = drawing(big, pinned(xy.plot, id)) !== drawing(big, xy.plot);
    expect(edgePinReachesDrawing(big, xy.plot, id)).toBe(full);
  });

  it("a 3D scatter's two-tone markers take the pinned edge", () => {
    const it3 = items.find((i) => i.plot.kind === "scatter3d")!;
    const y = tableDatasets(it3.table)[0]!.id;
    expect(edgePinReachesDrawing(it3.table, { ...it3.plot, seriesStyles: { ...it3.plot.seriesStyles, [y]: { ...it3.plot.seriesStyles?.[y], symbolFill: "twotone" } } }, y)).toBe(true);
  });

  it("the series panel shows the row on an XY graph and withholds it on a population pyramid", () => {
    const rowShown = (kind: string): boolean => {
      const it = items.find((i) => i.plot.kind === kind)!;
      const id = buildPlotScene(it.table, it.plot, SIZE).series[0]?.id ?? tableDatasets(it.table)[0]!.id;
      const u = render(
        <Inspector activeSection="graphs" selection={{ kind: "series", columnId: id }} plot={it.plot} table={it.table} userPresets={[]} profileDefault={null}
          {...handlers()} />,
      );
      const shown = u.container.textContent?.includes("Custom edge colour") ?? false;
      cleanup();
      return shown;
    };
    expect(rowShown("xy")).toBe(true);
    expect(rowShown("pyramid")).toBe(false);
  });
});
