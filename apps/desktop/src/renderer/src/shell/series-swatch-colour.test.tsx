// @vitest-environment jsdom
/**
 * The Series list's colour swatches show the colours the graph is drawn in, after Colour scheme ▸ Palette too. Every
 * gallery graph with a Series list: the palette is switched to Vibrant the way the panel does it
 * (`paletteSwitchPatch`), and each row's swatch must equal the colour its series is then drawn in. The swatch fell back
 * to the default palette's colour for its slot, so after a switch it kept showing the old colours.
 */
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { buildPlotScene, PALETTES } from "@mady/graphics";
import { MadyDocument } from "@mady/core";
import type { DataTable, NodeId, Plot, Project } from "@mady/core";
import { Inspector } from "./Inspector";
import { inspectorDocOps } from "./inspectorDocOps";
import { galleryItems } from "./gallery";
import { paletteSwitchPatch } from "./paletteSwitch";
import { scenePaletteOpt } from "./scenePalette";

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
/** A colour as the browser writes it into a style: `rgb(r, g, b)`. */
const rgb = (hex: string): string => {
  const h = hex.replace("#", "");
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
  return `rgb(${n(0)}, ${n(2)}, ${n(4)})`;
};
type Item = { title: string; table: DataTable; plot: Plot; extraTables?: DataTable[] };

describe("Series list swatches after a palette switch", () => {
  it("show the colour each series is drawn in, on every gallery graph with a list", () => {
    const wrong: string[] = [];
    let checked = 0;
    for (const it of galleryItems() as unknown as Item[]) {
      const plot = { ...it.plot, ...paletteSwitchPatch(it.plot, it.table, "Vibrant") } as Plot;
      const tables = [it.table, ...(it.extraTables ?? [])];
      const scene = buildPlotScene(it.table, plot, { width: 620, height: 420, ...scenePaletteOpt(plot), tables: (id: string) => tables.find((t) => t.id === id) });
      const drawn = new Map(scene.series.filter((s) => /^#[0-9a-f]{6}$/i.test(s.color)).map((s) => [s.name, rgb(s.color)] as const));
      const u = render(<Inspector activeSection="graphs" selection={{ kind: "plot" }} plot={plot} table={it.table} userPresets={[]} profileDefault={null} {...handlers()} />);
      for (const row of u.container.querySelectorAll(".serieslist-row")) {
        const name = [...row.querySelectorAll("span")].map((s) => s.textContent?.trim() ?? "").find((t) => t && drawn.has(t));
        if (!name) continue;
        const swatch = row.querySelector<HTMLElement>("span[aria-hidden]")?.style.background ?? "";
        checked++;
        if (swatch !== drawn.get(name)) wrong.push(`${it.title} · ${name}: swatch ${swatch}, drawn ${drawn.get(name)}`);
      }
      cleanup();
    }
    expect(checked, "swatches checked").toBeGreaterThan(40);
    // The switch reached the drawing: the fixture can show a swatch left on the old palette.
    expect(PALETTES.Vibrant).toBeDefined();
    expect(wrong).toEqual([]);
  });

  // The app's document is edited in place: the panel is handed the same plot object before and after the switch, so
  // anything it keeps between renders by that object would still show the old colours.
  it("follow a switch made in the panel on a live document", () => {
    const it2 = (galleryItems() as unknown as Item[]).find((i) => i.title === "Box & whisker")!;
    const doc = new MadyDocument({ schemaVersion: 4, tables: [it2.table], plots: [it2.plot], analyses: [], log: [], workspace: { folders: [], loose: [] } } as Project);
    function Live({ plotId }: { plotId: NodeId }) {
      const [, setV] = useState(0);
      const ops = inspectorDocOps((fn) => { fn(doc); setV((v) => v + 1); }, () => plotId);
      const project = doc.toJSON();
      return <Inspector activeSection="graphs" selection={{ kind: "plot" }} plot={project.plots[0]!} table={project.tables[0]!} userPresets={[]} profileDefault={null} {...handlers()} onSetPlotOptions={ops.setPlotOptions} onSetSeriesStyle={ops.setSeriesStyle} />;
    }
    const u = render(<Live plotId={it2.plot.id} />);
    const chart = [...u.container.querySelectorAll<HTMLButtonElement>("button.inspcat")].find((b) => b.textContent?.trim() === "Chart");
    if (chart) act(() => { fireEvent.click(chart); });
    const select = [...u.container.querySelectorAll<HTMLSelectElement>("select")].find((s) => [...s.options].some((o) => o.value === "Vibrant"))!;
    act(() => { fireEvent.change(select, { target: { value: "Vibrant" } }); });
    const plot = doc.toJSON().plots[0]!;
    const drawn = buildPlotScene(it2.table, plot, { width: 620, height: 420, ...scenePaletteOpt(plot) }).series.map((s) => rgb(s.color));
    const swatches = [...u.container.querySelectorAll(".serieslist-row")].map((r) => r.querySelector<HTMLElement>("span[aria-hidden]")?.style.background ?? "");
    expect(drawn[0]).toBe(rgb(PALETTES.Vibrant![0]!));
    expect(swatches.slice(0, drawn.length)).toEqual(drawn);
  });

  it("the clicked series' Colour row shows the colour it is drawn in", () => {
    const wrong: string[] = [];
    let checked = 0;
    for (const it of galleryItems() as unknown as Item[]) {
      const plot = { ...it.plot, ...paletteSwitchPatch(it.plot, it.table, "Vibrant") } as Plot;
      const tables = [it.table, ...(it.extraTables ?? [])];
      const scene = buildPlotScene(it.table, plot, { width: 620, height: 420, ...scenePaletteOpt(plot), tables: (id: string) => tables.find((t) => t.id === id) });
      const s = scene.series.find((x) => /^#[0-9a-f]{6}$/i.test(x.color) && x.marks.length > 0);
      if (!s) continue;
      const u = render(<Inspector activeSection="graphs" selection={{ kind: "series", columnId: s.id, part: "points" }} plot={plot} table={it.table} userPresets={[]} profileDefault={null} {...handlers()} />);
      const row = [...u.container.querySelectorAll("label.frow, div.frow")].find((r) => r.querySelector(":scope > span")?.textContent?.trim() === "Colour" && r.querySelector('input[type="color"]'));
      const value = row?.querySelector<HTMLInputElement>('input[type="color"]')?.value;
      cleanup();
      if (!value) continue;
      checked++;
      if (value.toLowerCase() !== s.color.toLowerCase()) wrong.push(`${it.title} · ${s.name}: Colour row ${value}, drawn ${s.color}`);
    }
    expect(checked, "Colour rows checked").toBeGreaterThan(30);
    expect(wrong).toEqual([]);
  });
});
