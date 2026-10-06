// @vitest-environment jsdom
// The swatch must show the colour the element is drawn in.
//
// Synthetic series are selectable: clicking a dendrogram branch emits
// `{kind:"series", columnId:"dendro-0", part:"line"}`, the editor opens, and styling that id
// does change the drawing, so a mis-seeded swatch is reachable.
//
// Seeding the colour with `seriesColor(datasets.findIndex(id))` fails for a synthetic id, which
// is in no dataset: the index collapses to 0 and every element of these five kinds would show
// `#0072b2` — the first palette colour — whatever it is actually drawn in. Parsing the id would
// not fix it either: the dendrogram's branches are coloured by cluster, so `dendro-0` is drawn
// `#e69f00` while `dendro-1` is `#0072b2`. The only accurate seed is the drawing.
//
// ROC and survival are here as the positive control: they already resolve their synthetic ids
// through a hand-built dataset list, so they must keep matching.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { Plot } from "@mady/core";
import type { GraphSelection } from "./AppShell";
import { buildPlotScene } from "@mady/graphics";
import { Inspector } from "./Inspector";
import { galleryItems } from "./gallery";

afterEach(cleanup);
const SIZE = { width: 620, height: 420 };
const KINDS = ["dendrogram", "scree", "pcascore", "pcabiplot", "pcaload", "roc", "survival"];

const handlers = () => ({
  onSelect: vi.fn(),
  onSetAxis: vi.fn(), onSetAxisLength: vi.fn(), onSetAxisTitleFont: vi.fn(),
  onSetSeriesStyle: vi.fn(), onSetSeriesStyleAll: vi.fn(), onSetPointStyle: vi.fn(), onClearPointStyles: vi.fn(),
  onSetGrid: vi.fn(), onSetFrame: vi.fn(), onSetKind: vi.fn(), onSetBarLayout: vi.fn(), onSetBarShape: vi.fn(), onSetBoxWhisker: vi.fn(),
  onSetPlotOptions: vi.fn(), onSetGraphTitle: vi.fn(), onSetPlotFont: vi.fn(), onHomogenizeFont: vi.fn(),
  onSetLegend: vi.fn(), onSetSignificance: vi.fn(), onApplyPreset: vi.fn(), 
  onApplyUserPreset: vi.fn(), onSaveUserPreset: vi.fn(), onDeleteUserPreset: vi.fn(), onSetProfileDefault: vi.fn(),
  annotationOps: { add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() },
});

function swatches(plot: Plot, table: never, seriesId: string): string[] {
  const sel = { kind: "series", columnId: seriesId, part: "line" } as unknown as GraphSelection;
  const { container } = render(
    <Inspector activeSection="graphs" selection={sel} plot={plot} table={table}
      userPresets={[]} profileDefault={null} {...handlers()} />,
  );
  const out = [...container.querySelectorAll("input[type=color]")].map((e) => (e as HTMLInputElement).value.toLowerCase());
  cleanup();
  return out;
}

describe("a per-element editor shows the element's real colour", () => {
  const items = galleryItems() as unknown as { table: never; plot: Plot }[];

  it("guards the guard — these kinds really do draw differently-coloured series", () => {
    const varied = items.filter((i) => {
      if (!KINDS.includes(i.plot.kind ?? "")) return false;
      const cols = new Set(buildPlotScene(i.table, i.plot, SIZE).series.map((s) => String(s.color).toLowerCase()));
      return cols.size >= 2;
    });
    expect(varied.length, "no multi-colour fixture — a wrong seed could not be detected").toBeGreaterThan(3);
  });

  for (const item of items) {
    const kind = item.plot.kind ?? "xy";
    if (!KINDS.includes(kind)) continue;
    it(`${kind}: every series' swatch matches what it is drawn in`, () => {
      const scene = buildPlotScene(item.table, item.plot, SIZE);
      for (const se of scene.series) {
        const drawn = String(se.color).toLowerCase();
        expect(
          swatches(item.plot, item.table, se.id),
          `${kind}: selecting "${se.id}" (drawn ${drawn}) offers no swatch of that colour — the panel misstates the current colour`,
        ).toContain(drawn);
      }
    });
  }
});
