// @vitest-environment jsdom
/**
 * Colour / symbol / labels from a column: offered on exactly the charts that draw it.
 *
 * The builder applies these bindings on xy, area, bubble, funnel, ternary and swimmer; two
 * hand-written lists (builder and panel) would drift as kinds are added, leaving e.g. the ternary
 * chart's colouring by texture class with no control to change or remove it.
 *
 * The panel reads the builder's own `DATA_DRIVEN_KINDS`. This guard renders the real panel for
 * every gallery chart of every kind — in the list and out of it — so a kind added to one side only
 * fails here, whichever side it is.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { DataTable, Plot } from "@mady/core";
import { swimmerColumns, tableDatasets } from "@mady/core";
import { buildPlotScene, DATA_DRIVEN_KINDS } from "@mady/graphics";
import { Inspector } from "./Inspector";
import type { GraphSelection } from "./AppShell";
import { galleryItems } from "./gallery";

afterEach(cleanup);

function panel(plot: Plot, table: DataTable, columnId: string): HTMLElement {
  const noop = vi.fn();
  const selection: GraphSelection = { kind: "series", columnId, part: "points" };
  const h = {
    onSelect: noop, onSetAxis: noop, onSetAxisLength: noop, onSetAxisTitleFont: noop,
    onSetSeriesStyle: noop, onSetSeriesStyleAll: noop, onSetPointStyle: noop, onClearPointStyles: noop,
    onSetGrid: noop, onSetFrame: noop, onSetKind: noop, onSetBarLayout: noop, onSetBarShape: noop, onSetBoxWhisker: noop,
    onSetPlotOptions: noop, onSetGraphTitle: noop, onSetPlotFont: noop, onHomogenizeFont: noop,
    onSetLegend: noop, onSetSignificance: noop, onApplyPreset: noop,
    onApplyUserPreset: noop, onSaveUserPreset: noop, onDeleteUserPreset: noop, onSetProfileDefault: noop,
    annotationOps: { add: noop, update: noop, remove: noop, reorder: noop, align: noop, group: noop, ungroup: noop, setLocked: noop, addImage: noop, replaceImage: noop },
  };
  const { container } = render(
    <Inspector activeSection="data" selection={selection} plot={plot} table={table} userPresets={[]} profileDefault={null} wholeGraph={false} onSetWholeGraph={noop} {...h} />,
  );
  return container;
}

const rowSelect = (c: HTMLElement, label: string): HTMLSelectElement | null => {
  const span = [...c.querySelectorAll(".frow > span")].find((s) => s.textContent === label);
  return (span?.parentElement?.querySelector("select") as HTMLSelectElement | null) ?? null;
};
const hasRow = (c: HTMLElement, label: string): boolean => rowSelect(c, label) !== null;

describe("colour / symbol / labels from a column — offered where drawn", () => {
  it("every gallery chart offers Colour by on its drawn series exactly when the builder honours it", () => {
    const wrong: string[] = [];
    const seen = new Set<string>();
    for (const item of galleryItems()) {
      const kind = item.plot.kind ?? "xy";
      if (kind === "swimmer") continue; // two different things drawn — its own test below
      const scene = buildPlotScene(item.table, item.plot, {});
      const drawn = scene.series.find((s) => tableDatasets(item.table).some((d) => d.id === s.id));
      if (!drawn) continue;
      const c = panel(item.plot, item.table, drawn.id);
      const offered = hasRow(c, "Colour by");
      if (offered !== DATA_DRIVEN_KINDS.has(kind)) wrong.push(`${kind} "${item.plot.name}": offered=${offered} builder=${DATA_DRIVEN_KINDS.has(kind)}`);
      seen.add(kind);
      cleanup();
    }
    // The fixture reaches both sides: kinds in the list, and kinds outside it.
    for (const k of ["xy", "bubble", "funnel", "ternary"]) expect(seen.has(k), k).toBe(true);
    expect([...seen].filter((k) => !DATA_DRIVEN_KINDS.has(k)).length).toBeGreaterThan(10);
    expect(wrong).toEqual([]);
  });

  it("ternary: the texture-class colouring shows in the panel and can be removed", () => {
    const item = galleryItems().find((i) => i.plot.kind === "ternary")!;
    const c = panel(item.plot, item.table, "a");
    const sel = rowSelect(c, "Colour by")!;
    expect(sel).not.toBeNull();
    expect(sel.value).toBe(item.plot.seriesStyles!.a!.colorFromColumn);
    expect([...sel.options].map((o) => o.value)).toContain(""); // "None" removes it
    expect(hasRow(c, "Shape by")).toBe(true);
    // A ternary dot's position is inside the triangle, not a table value: no X / Y value labels.
    expect([...rowSelect(c, "Label points")!.options].map((o) => o.value)).toEqual(["none", "col"]);
  });

  it("swimmer: Start colours the bars (by category only); event columns get the full set; End gets none", () => {
    const item = galleryItems().find((i) => i.plot.kind === "swimmer")!;
    const cols = swimmerColumns(item.table);
    const start = panel(item.plot, item.table, cols.start!.id);
    expect(hasRow(start, "Colour bars by")).toBe(true);
    expect(hasRow(start, "Mapping")).toBe(false);
    expect(hasRow(start, "Shape by")).toBe(false);
    expect(hasRow(start, "Label points")).toBe(false);
    cleanup();
    const end = panel(item.plot, item.table, cols.end!.id);
    expect(hasRow(end, "Colour by") || hasRow(end, "Colour bars by")).toBe(false);
    cleanup();
    const ev = panel(item.plot, item.table, cols.events[0]!.id);
    expect(hasRow(ev, "Colour by")).toBe(true);
    expect(hasRow(ev, "Shape by")).toBe(true);
    expect([...rowSelect(ev, "Label points")!.options].map((o) => o.value)).toEqual(["none", "x", "col"]);
  });
});
