// @vitest-environment jsdom
/**
 * Explode the whole pie — an "explode" slider on the Chart tab, under "donut hole", brings the pie together
 * or explodes all slices, so bringing an exploded pie together does not mean zeroing each slice by hand
 * with the per-slice slider. Measured on the drawing: every slice's offset from the centre.
 */
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { tableDatasets, type DataTable, type Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { Inspector } from "./Inspector";
import { galleryItems, galleryLookup } from "./gallery";
import { pieExplodeAll, pieExplodeShown } from "./pieExplode";

afterEach(cleanup);
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

const pie = () => {
  const g = galleryItems().find((x) => x.plot.kind === "pie" && (x.plot.pieDisplay ?? "pie") === "pie");
  if (!g) throw new Error("no pie card");
  return { table: g.table as DataTable, plot: g.plot as Plot, lk: galleryLookup(g) };
};
/** The pie card pulled apart through the shared base (`series: { sliceExplode: 0.12 }` = the value
 *  column's style, every slice's base), written directly - not through the control under test - so "bring it together"
 *  has something to bring together. */
const explodedPie = () => {
  const c = pie();
  const col = tableDatasets(c.table)[0]!.id;
  const seriesStyles = { ...c.plot.seriesStyles, [col]: { ...(c.plot.seriesStyles?.[col] ?? {}), sliceExplode: 0.12 } };
  return { ...c, plot: { ...c.plot, seriesStyles } as Plot };
};
const offsets = (table: DataTable, plot: Plot, lk: ReturnType<typeof galleryLookup>) =>
  buildPlotScene(table, plot, { width: 640, height: 560, tables: lk }).pie!.slices.map((s) => Math.round(Math.hypot(s.ox, s.oy) * 100) / 100);

describe("the whole-pie Explode", () => {
  it("0 brings the pie together — every slice, including one with its own explode", () => {
    const c = explodedPie();
    expect(offsets(c.table, c.plot, c.lk).some((o) => o > 0), "the card is not exploded — this proves nothing").toBe(true);
    // One slice pulled out on its own as well.
    const row0 = c.table.rows[0]!.id;
    const withOwn = { ...c.plot, seriesStyles: { ...c.plot.seriesStyles, [row0]: { ...(c.plot.seriesStyles?.[row0] ?? {}), sliceExplode: 0.3 } } } as Plot;
    const together = { ...withOwn, ...pieExplodeAll(withOwn, c.table, 0) } as Plot;
    expect(offsets(c.table, together, c.lk).every((o) => o === 0)).toBe(true);
  });

  // Every slice pulled out by hand (the per-slice slider) and none on the shared base. Guards against a slider that
  // reads the base only: it would say 0 on a visibly exploded pie - and setting 0 is no change, so it could not bring it together.
  it("a pie whose slices were pulled out one by one: the slider shows it, and 0 brings it together", () => {
    const c = pie();
    const seriesStyles = { ...c.plot.seriesStyles };
    for (const r of c.table.rows) seriesStyles[r.id] = { ...(seriesStyles[r.id] ?? {}), sliceExplode: 0.2 };
    const byHand = { ...c.plot, seriesStyles } as Plot;
    expect(offsets(c.table, byHand, c.lk).every((o) => o > 0), "the slices are not pulled out - this proves nothing").toBe(true);
    expect(pieExplodeShown(byHand, c.table)).toBe(0.2);
    const onSetPlotOptions = vi.fn();
    const { container } = render(
      <Inspector {...({} as ComponentProps<typeof Inspector>)} activeSection="graphs" selection={{ kind: "plot" } as never} plot={byHand} table={c.table}
        userPresets={[]} profileDefault={null} wholeGraph={false} onSetWholeGraph={() => {}} onSelect={vi.fn()} onSetPlotOptions={onSetPlotOptions} />,
    );
    fireEvent.change(container.querySelector<HTMLInputElement>('input[aria-label="Explode all slices"]')!, { target: { value: "0" } });
    expect(onSetPlotOptions).toHaveBeenCalledTimes(1);
    const written = { ...byHand, ...onSetPlotOptions.mock.calls[0]![0] } as Plot;
    expect(offsets(c.table, written, c.lk).every((o) => o === 0)).toBe(true);
  });

  it("a value explodes EVERY slice by the same amount", () => {
    const c = pie();
    const all = { ...c.plot, ...pieExplodeAll(c.plot, c.table, 0.2) } as Plot;
    const o = offsets(c.table, all, c.lk);
    expect(o.every((x) => x > 0)).toBe(true);
    expect(new Set(o).size, `offsets ${o.join(", ")}`).toBe(1);
    expect(pieExplodeShown(all, c.table)).toBe(0.2);
  });

  it("a pie made of COLUMNS (one slice per column) explodes each column's slice", () => {
    const c = pie();
    const cols = { ...c.table, kind: "column" } as DataTable;
    const ids = tableDatasets(cols).map((d) => d.id);
    const patch = pieExplodeAll({}, cols, 0.15);
    for (const id of ids) expect(patch.seriesStyles?.[id]?.sliceExplode).toBe(0.15);
  });

  it("sits under Donut hole in the Pie chart section and writes one patch", () => {
    const c = explodedPie();
    const onSetPlotOptions = vi.fn();
    const { container } = render(
      <Inspector {...({} as ComponentProps<typeof Inspector>)} activeSection="graphs" selection={{ kind: "plot" } as never} plot={c.plot} table={c.table}
        userPresets={[]} profileDefault={null} wholeGraph={false} onSetWholeGraph={() => {}} onSelect={vi.fn()} onSetPlotOptions={onSetPlotOptions} />,
    );
    const labels = [...container.querySelectorAll("label.frow > span:first-child")].map((s) => s.textContent);
    const at = labels.indexOf("Explode (all slices)");
    expect(at, "no whole-pie Explode in the Pie chart section").toBeGreaterThan(-1);
    expect(labels[at - 1]).toBe("Donut hole");
    const slider = container.querySelector<HTMLInputElement>('input[aria-label="Explode all slices"]')!;
    expect(Number(slider.value)).toBe(pieExplodeShown(c.plot, c.table));
    fireEvent.change(slider, { target: { value: "0" } });
    expect(onSetPlotOptions).toHaveBeenCalledTimes(1);
    const written = { ...c.plot, ...onSetPlotOptions.mock.calls[0]![0] } as Plot;
    expect(offsets(c.table, written, c.lk).every((o) => o === 0)).toBe(true);
  });
});
