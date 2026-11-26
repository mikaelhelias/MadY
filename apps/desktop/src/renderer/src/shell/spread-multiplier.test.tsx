// @vitest-environment jsdom
/**
 * The spread band's multiplier — `spread.k`.
 *
 * `buildPlotScene` reads `spreadSpec?.k ?? 1`; without a control writing it, a spread band could
 * only be mean ± 1 SD, and ± 2 SD — the other common reading — could not be requested.
 *
 * Both halves, because either alone passes on the wrong thing: the drawing must respond to `k`,
 * and a control for it must be on screen where a user looks for it.
 */
import { describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { Inspector } from "./Inspector";
import { inkDiffers, INK_SIZE } from "./inkOracle";

Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

/**
 * An XY sheet with three separate series, because that is what the band is computed from.
 *
 * Three columns grouped as replicates of one series would draw no band at all: `buildPlotScene`
 * pools the spread across series at each X ("a few drawn curves can sit inside the population
 * band"), not across one series' replicates. A fixture that cannot exhibit the band reports its
 * absence just as confidently as a real absence.
 */
const table: DataTable = {
  id: "t", kind: "xy", name: "T",
  columns: [
    { id: "x", name: "Dose", role: "x" },
    { id: "y1", name: "A", role: "y" },
    { id: "y2", name: "B", role: "y" },
    { id: "y3", name: "C", role: "y" },
  ],
  rows: [1, 2, 3, 4].map((i) => ({ id: `r${i}`, cells: { x: i, y1: 10 * i, y2: 11 * i, y3: 16 * i } })),
};
const plot = (extra: Partial<Plot> = {}): Plot =>
  ({ id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "xy", ...extra }) as Plot;

const H = () => ({
  onSelect: vi.fn(), onSetAxis: vi.fn(), onSetAxisLength: vi.fn(), onSetAxisTitleFont: vi.fn(),
  onSetSeriesStyle: vi.fn(), onSetSeriesStyleAll: vi.fn(), onSetPointStyle: vi.fn(), onClearPointStyles: vi.fn(),
  onSetGrid: vi.fn(), onSetFrame: vi.fn(), onSetKind: vi.fn(), onSetBarLayout: vi.fn(), onSetBarShape: vi.fn(), onSetBoxWhisker: vi.fn(),
  onSetPlotOptions: vi.fn(), onSetGraphTitle: vi.fn(), onSetPlotFont: vi.fn(), onHomogenizeFont: vi.fn(),
  onSetLegend: vi.fn(), onSetSignificance: vi.fn(), onApplyPreset: vi.fn(),
  onApplyUserPreset: vi.fn(), onSaveUserPreset: vi.fn(), onDeleteUserPreset: vi.fn(), onSetProfileDefault: vi.fn(),
  annotationOps: { add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() },
});

function chartPanel(p: Plot) {
  const h = H();
  const { container } = render(
    <Inspector activeSection="graphs" selection={{ kind: "plot" }} plot={p} table={table} userPresets={[]} profileDefault={null} {...h} />,
  );
  const tab = [...container.querySelectorAll<HTMLButtonElement>("button.inspcat")].find((b) => (b.textContent ?? "").trim() === "Chart");
  if (tab && !tab.classList.contains("disabled")) fireEvent.click(tab);
  const row = [...container.querySelectorAll<HTMLElement>("label.frow")]
    .find((r) => (r.querySelector(":scope > span")?.textContent ?? "").trim() === "Multiplier");
  return { container, h, input: row?.querySelector("input") ?? undefined };
}

describe("the spread band's multiplier", () => {
  it("the fixture can exhibit it — a band is drawn at all", () => {
    // Note: `scene.spreadBand`, not a series' `bandPath`: the cross-series ribbon is its own scene
    // object (the per-series bandPath is the error ribbon, a different thing entirely).
    const s = buildPlotScene(table, plot({ spread: { mode: "sd" } }), INK_SIZE);
    expect(s.spreadBand, "no spread band drawn, so k could not show either").toBeTruthy();
  });

  it("k reaches the drawing — a wider multiplier draws a wider band", () => {
    expect(inkDiffers(table, plot({ spread: { mode: "sd", k: 1 } }), plot({ spread: { mode: "sd", k: 2 } }))).toBe(true);
    // …and it is wider, not merely different: the low edge must sit further from the mean.
    /*
     * The ribbon's own height, not the spread of every number in the scene object. Measuring
     * max-minus-min across the whole band JSON gives the same value for k=1 and k=2: that number
     * is the plot's extent, which does not move. The ribbon is "low edge out, high edge
     * back", so its two edges are the first and last half of the path's Y values.
     */
    /*
     * The axis is pinned, or the test measures nothing. A wider band makes the Y domain grow
     * to fit it, so the ribbon's pixel height barely moves (e.g. 81.5px → 91.3px from k=1 to
     * k=2, and smaller again at k=3 as the rescale outruns the widening). With a fixed range the
     * pixels per unit are constant and doubling k doubles the reach, which is the claim worth
     * making.
     */
    const reach = (k: number): number => {
      const band = buildPlotScene(table, plot({ spread: { mode: "sd", k }, yAxis: { min: -200, max: 200 } }), INK_SIZE).spreadBand!;
      const ys = [...band.bandPath.matchAll(/[ ,](-?\d+(?:\.\d+)?)(?=[ ,LZ]|$)/gi)].map((m) => Number(m[1]));
      const half = Math.floor(ys.length / 2);
      const out = ys.slice(0, half), back = ys.slice(half).reverse();
      return out.reduce((acc, y, idx) => acc + Math.abs(y - (back[idx] ?? y)), 0) / Math.max(1, out.length);
    };
    const one = reach(1), two = reach(2);
    expect(two, "k=2 must reach further than k=1").toBeGreaterThan(one);
    // …and by the right amount: a multiplier that merely nudged the band would pass the line above.
    expect(two / one, `k=2 should be about twice k=1, got ${(two / one).toFixed(2)}x`).toBeGreaterThan(1.8);
    expect(two / one).toBeLessThan(2.2);
  });

  it("the control is on screen for SD and for SEM, and writes k", () => {
    for (const mode of ["sd", "sem"] as const) {
      const { h, input } = chartPanel(plot({ spread: { mode } }));
      expect(input, `${mode}: no Multiplier row`).toBeTruthy();
      fireEvent.change(input!, { target: { value: "2" } });
      expect(h.onSetPlotOptions).toHaveBeenCalledWith(expect.objectContaining({ spread: expect.objectContaining({ k: 2, mode }) }));
      cleanup();
    }
  });

  it("…and not for range or IQR, where a multiplier would mean nothing", () => {
    // Those two are the data's own extremes; scaling them would state an interval nobody asked for.
    for (const mode of ["range", "iqr"] as const) {
      expect(chartPanel(plot({ spread: { mode } })).input, `${mode}: a multiplier has no meaning here`).toBeUndefined();
      cleanup();
    }
    expect(chartPanel(plot()).input, "no band at all: nothing to multiply").toBeUndefined();
    cleanup();
  });

  it("clearing the box returns to the default of 1 rather than writing 0", () => {
    const { h, input } = chartPanel(plot({ spread: { mode: "sd", k: 2 } }));
    fireEvent.change(input!, { target: { value: "" } });
    expect(h.onSetPlotOptions).toHaveBeenCalledWith(expect.objectContaining({ spread: expect.objectContaining({ k: undefined }) }));
  });
});
