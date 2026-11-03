// @vitest-environment jsdom
/**
 * The second axis line keeps its light grey by default, and the user can change it.
 * Asked of the real Axis tab and the real drawing, on lollipop, raincloud and floating bar
 * plus the box chart as a control: press every colour control the Y2 tab shows, keep
 * the one that writes `y2Axis.lineColor`, rebuild the scene with it, and find that colour on the drawn axis line.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { tableDatasets } from "@mady/core";
import type { AxisSpec, Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { Inspector } from "./Inspector";
import { PlotFigure } from "./PlotFigure";
import { galleryItems } from "./gallery";

afterEach(cleanup);
type Card = { table: never; plot: Plot };
const RED = "#d11a2a";

describe("the second axis line colour is editable where a second axis is drawn", () => {
  it.each(["lollipop", "raincloud", "floatingbar", "box"])("%s: the Y2 tab's colour control reaches the drawn line", (kind) => {
    const c = (galleryItems() as unknown as Card[]).find((x) => x.plot.kind === kind)!;
    const id = tableDatasets(c.table).at(-1)!.id;
    const plot = { ...c.plot, seriesStyles: { ...(c.plot.seriesStyles ?? {}), [id]: { ...(c.plot.seriesStyles?.[id] ?? {}), axis: "y2" } } } as Plot;

    const writes: [string, Partial<AxisSpec>][] = [];
    const f = vi.fn();
    const h = {
      onSelect: f, onSetAxis: (axis: string, patch: Partial<AxisSpec>) => writes.push([axis, patch]), onSetAxisLength: f, onSetAxisTitleFont: f,
      onSetSeriesStyle: f, onSetSeriesStyleAll: f, onSetPointStyle: f, onClearPointStyles: f,
      onSetGrid: f, onSetFrame: f, onSetKind: f, onSetBarLayout: f, onSetBarShape: f, onSetBoxWhisker: f,
      onSetPlotOptions: f, onSetGraphTitle: f, onSetPlotFont: f, onHomogenizeFont: f,
      onSetLegend: f, onSetSignificance: f, onApplyPreset: f,
      onApplyUserPreset: f, onSaveUserPreset: f, onDeleteUserPreset: f, onSetProfileDefault: f,
      annotationOps: { add: f, update: f, remove: f, reorder: f, align: f, group: f, ungroup: f, setLocked: f, addImage: f, replaceImage: f },
    };
    const props = { ...h, activeSection: "graphs", selection: { kind: "axis", axis: "y2" }, plot, table: c.table, userPresets: [], profileDefault: null } as unknown as ComponentProps<typeof Inspector>;
    const { container } = render(<Inspector {...props} />);
    for (const el of container.querySelectorAll<HTMLInputElement>('input[type="color"]')) fireEvent.change(el, { target: { value: RED } });
    const lineWrite = writes.find(([axis, p]) => axis === "y2" && p.lineColor === RED);
    expect(lineWrite, `no colour control on ${kind}'s Y2 tab writes the second axis line colour`).toBeDefined();

    const before = buildPlotScene(c.table, plot, { width: 620, height: 420 });
    expect(before.y2?.lineColor ?? null, "the default stays as it is (no colour set)").toBeNull();
    const after = buildPlotScene(c.table, { ...plot, y2Axis: { ...(plot.y2Axis ?? {}), lineColor: RED } }, { width: 620, height: 420 });
    expect(after.y2?.lineColor).toBe(RED);
    expect(renderToStaticMarkup(createElement(PlotFigure, { scene: after }))).toContain(`stroke="${RED}"`);
  });
});
